//! Affairs-ledger eval harness, the Core half (.scratch/main-chat/
//! ledger-eval/, ticket 01 「合成语料与验收」). Development only: an
//! example is in no build that ships.
//!
//! Builds a throwaway `workbench.db` and managed state root from the
//! synthetic corpus inside `--workdir` — never the real ones — and runs
//! the production ledger code on them: `prepare` is
//! `ledger::run::begin` (IM archive, source selection, batch file,
//! pending position) at a chosen local time, and writes the mining task
//! to `<workdir>/task.txt`; `commit` / `fail` are `ledger::run::finish`
//! with the run's verdict; `delete` is the Memory page's delete of an
//! entry (`LedgerControl::delete_entry`, ticket 04). The model run in
//! between is `run_eval.py`'s, against the same state root.
//!
//! ```text
//! cargo run --manifest-path core/Cargo.toml -p galley-core --example ledger_eval_prepare -- \
//!   --corpus .scratch/main-chat/ledger-eval/corpus.json --workdir /tmp/x prepare --now "2026-09-14 04:00"
//! cargo run … --example ledger_eval_prepare -- --corpus … --workdir /tmp/x commit
//! cargo run … --example ledger_eval_prepare -- --corpus … --workdir /tmp/x fail --reason "…"
//! cargo run … --example ledger_eval_prepare -- --corpus … --workdir /tmp/x delete --id A003
//! ```
//!
//! Prints one JSON line: `{"status": "ready" | "empty" | "committed" |
//! "failed" | "deleted", …}`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, TimeZone, Utc};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ledger::im_archive::FILE_HINT;
use galley_core_lib::ledger::run::{begin, finish, Begun};
use galley_core_lib::ledger::state::LedgerState;
use galley_core_lib::ledger::{LedgerConfig, LedgerControl, LedgerPaths};
use serde::Deserialize;
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    since: String,
    utc_offset: String,
    #[serde(default)]
    projects: Vec<Project>,
    sessions: Vec<Session>,
    #[serde(default)]
    im: Vec<ImLog>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    id: String,
    #[serde(default = "gui")]
    created_via: String,
    #[serde(default = "managed")]
    runtime: String,
    #[serde(default)]
    project: Option<String>,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct Message {
    at: String,
    role: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImLog {
    log: String,
    #[serde(default)]
    channel: Option<String>,
    /// `native` (NativeToolClient JSON) or `text` (ToolClient protocol).
    protocol: String,
    /// IM frontends prefix the hint; `false` stands for a GUI / CLI
    /// session's log, which the archive must ignore.
    #[serde(default = "yes")]
    hint: bool,
    turns: Vec<ImTurn>,
}

#[derive(Deserialize)]
struct ImTurn {
    at: String,
    text: String,
    reply: String,
}

fn gui() -> String {
    "gui".into()
}
fn managed() -> String {
    "managed".into()
}
fn yes() -> bool {
    true
}

fn fail(msg: impl std::fmt::Display) -> ! {
    eprintln!("ledger_eval_prepare: {msg}");
    std::process::exit(2);
}

fn local(tz: &FixedOffset, s: &str) -> DateTime<FixedOffset> {
    let naive = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .unwrap_or_else(|_| fail(format!("bad time {s:?} (want YYYY-MM-DD HH:MM)")));
    tz.from_local_datetime(&naive)
        .single()
        .expect("fixed offset")
}

fn iso(t: &DateTime<FixedOffset>) -> String {
    t.with_timezone(&Utc).to_rfc3339()
}

async fn seed_db(pool: &SqlitePool, galley: &SqliteGalley, corpus: &Corpus, tz: &FixedOffset) {
    galley_core_lib::apply_all_migrations_for_tests(pool)
        .await
        .unwrap_or_else(|e| fail(format!("migrations: {e}")));
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .unwrap_or_else(|e| fail(e));
    for p in &corpus.projects {
        let at = "2026-01-01T00:00:00+00:00";
        sqlx::query(
            "INSERT INTO projects (id, name, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&p.id)
        .bind(&p.name)
        .bind(at)
        .bind(at)
        .bind(at)
        .execute(pool)
        .await
        .unwrap_or_else(|e| fail(format!("project {}: {e}", p.id)));
    }
    for s in &corpus.sessions {
        let first = s
            .messages
            .first()
            .map(|m| iso(&local(tz, &m.at)))
            .unwrap_or_else(|| fail(format!("session {} has no messages", s.id)));
        let last = iso(&local(tz, &s.messages.last().expect("non-empty").at));
        sqlx::query(
            "INSERT INTO sessions (id, project_id, title, status, last_activity_at, created_at, \
               updated_at, created_via, created_by_supervisor, ga_runtime_kind) \
             VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?)",
        )
        .bind(&s.id)
        .bind(&s.project)
        .bind(&s.id)
        .bind(&last)
        .bind(&first)
        .bind(&last)
        .bind(&s.created_via)
        .bind((s.created_via == "supervisor").then_some("eval-supervisor"))
        .bind(&s.runtime)
        .execute(pool)
        .await
        .unwrap_or_else(|e| fail(format!("session {}: {e}", s.id)));
        for (i, m) in s.messages.iter().enumerate() {
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
                   created_at, created_via, visibility) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'visible')",
            )
            .bind(format!("msg_{}_{i}", s.id))
            .bind(&s.id)
            .bind(i as i64)
            .bind(&m.role)
            .bind(&m.text)
            .bind(iso(&local(tz, &m.at)))
            .bind(&s.created_via)
            .execute(pool)
            .await
            .unwrap_or_else(|e| fail(format!("message {}#{i}: {e}", s.id)));
        }
    }
}

/// Engine logs as upstream writes them, holding the turns said before
/// `now` (rewritten whole each step: the earlier bytes never change, so
/// the archive's offsets stay valid, as with a real appended log).
fn write_engine_logs(
    paths: &LedgerPaths,
    corpus: &Corpus,
    tz: &FixedOffset,
    now: &DateTime<FixedOffset>,
) {
    let dir = paths.model_responses_dir();
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| fail(e));
    let mut channel_logs: BTreeMap<&str, &str> = BTreeMap::new();
    for log in &corpus.im {
        let mut body = String::new();
        for turn in log.turns.iter().filter(|t| local(tz, &t.at) < *now) {
            let ts = local(tz, &turn.at).format("%Y-%m-%d %H:%M:%S").to_string();
            let said = if log.hint {
                format!("{FILE_HINT}\n\n{}", turn.text)
            } else {
                turn.text.clone()
            };
            let prompt = match log.protocol.as_str() {
                "native" => {
                    let block = json!({"type": "text", "text": said});
                    format!("{{\"role\": \"user\", \"content\": [\n{block}]}}")
                }
                "text" => format!(
                    "你是一个本地助手。\n### 交互协议 (必须严格遵守，持续有效)\n…\n=== USER ===\n{said}\n=== ASSISTANT ===\n"
                ),
                other => fail(format!("unknown protocol {other:?}")),
            };
            body.push_str(&format!("=== Prompt === {ts}\n{prompt}\n\n"));
            body.push_str(&format!(
                "=== Response === {ts} model=eval\n{}\n\n",
                turn.reply
            ));
        }
        std::fs::write(dir.join(&log.log), body).unwrap_or_else(|e| fail(e));
        if let Some(channel) = log.channel.as_deref() {
            channel_logs.insert(channel, log.log.as_str());
        }
    }
    // Galley's channel state names each channel's current log.
    for (channel, log) in channel_logs {
        let state_dir = paths.im_state_dir().join(channel);
        std::fs::create_dir_all(&state_dir).unwrap_or_else(|e| fail(e));
        let file = if channel == "discord" {
            state_dir.join("discord_active_channels.json")
        } else {
            state_dir.join("context_log.json")
        };
        let body = if channel == "discord" {
            json!({"eval": {"log": log}})
        } else {
            json!({"log": log})
        };
        std::fs::write(file, body.to_string()).unwrap_or_else(|e| fail(e));
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut corpus_path: Option<PathBuf> = None;
    let mut workdir: Option<PathBuf> = None;
    let mut command: Option<String> = None;
    let mut now_arg: Option<String> = None;
    let mut reason = String::from("the model run failed");
    let mut entry_id: Option<String> = None;
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--corpus" => corpus_path = it.next().map(PathBuf::from),
            "--workdir" => workdir = it.next().map(PathBuf::from),
            "--now" => now_arg = it.next(),
            "--reason" => reason = it.next().unwrap_or(reason),
            "--id" => entry_id = it.next(),
            "prepare" | "commit" | "fail" | "delete" => command = Some(a),
            other => fail(format!("unknown argument {other:?}")),
        }
    }
    let corpus_path = corpus_path.unwrap_or_else(|| fail("--corpus is required"));
    let workdir = workdir.unwrap_or_else(|| fail("--workdir is required"));
    let command = command.unwrap_or_else(|| fail("prepare | commit | fail | delete"));
    guard_workdir(&workdir);

    let corpus: Corpus = serde_json::from_str(
        &std::fs::read_to_string(&corpus_path)
            .unwrap_or_else(|e| fail(format!("{}: {e}", corpus_path.display()))),
    )
    .unwrap_or_else(|e| fail(format!("corpus: {e}")));
    let tz: FixedOffset = corpus
        .utc_offset
        .parse()
        .unwrap_or_else(|_| fail(format!("utcOffset {:?}", corpus.utc_offset)));
    // The corpus names a day; the switch holds an instant: that day's
    // local midnight, as "from now" turned on at 00:00 would.
    let since_day = NaiveDate::parse_from_str(&corpus.since, "%Y-%m-%d")
        .unwrap_or_else(|_| fail(format!("since {:?}", corpus.since)));
    let config = LedgerConfig {
        since: tz
            .from_local_datetime(&since_day.and_hms_opt(0, 0, 0).expect("midnight"))
            .single()
            .expect("fixed offset")
            .with_timezone(&Utc),
        look_back: false,
        not_before: None,
    };
    let paths = LedgerPaths::new(workdir.join("managed-ga-state"));

    std::fs::create_dir_all(&workdir).unwrap_or_else(|e| fail(e));
    let db = workdir.join("workbench.db");
    let fresh = !db.exists();
    let pool = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(&db)
            .create_if_missing(true),
    )
    .await
    .unwrap_or_else(|e| fail(format!("db: {e}")));
    let galley = SqliteGalley::from_pool(pool.clone());
    if fresh {
        seed_db(&pool, &galley, &corpus, &tz).await;
    }

    let mut state = LedgerState::load(&paths.state_file()).unwrap_or_else(|e| fail(e));
    match command.as_str() {
        "prepare" => {
            let now = local(&tz, &now_arg.unwrap_or_else(|| fail("prepare needs --now")));
            write_engine_logs(&paths, &corpus, &tz, &now);
            let begun = begin(
                &galley,
                &paths,
                &config,
                &mut state,
                now.with_timezone(&Utc),
                &tz,
            )
            .await
            .unwrap_or_else(|e| fail(e));
            match begun {
                Begun::Empty => println!("{}", json!({"status": "empty"})),
                Begun::Ready { batch, task } => {
                    let task_file = workdir.join("task.txt");
                    std::fs::write(&task_file, &task).unwrap_or_else(|e| fail(e));
                    println!(
                        "{}",
                        json!({
                            "status": "ready",
                            "groups": batch.groups.len(),
                            "turns": batch.turn_count,
                            "batch": paths.batch_file(),
                            "task": task_file,
                            "stateRoot": paths.state_root(),
                        })
                    );
                }
            }
        }
        "commit" => {
            finish(&paths, &mut state, &Ok(()), Utc::now()).unwrap_or_else(|e| fail(e));
            println!("{}", json!({"status": "committed", "mined": state.mined}));
        }
        "fail" => {
            finish(&paths, &mut state, &Err(reason), Utc::now()).unwrap_or_else(|e| fail(e));
            println!("{}", json!({"status": "failed", "mined": state.mined}));
        }
        "delete" => {
            // The Memory page's delete, production code.
            let id = entry_id.unwrap_or_else(|| fail("delete needs --id"));
            LedgerControl::new()
                .delete_entry(&galley, &paths, &id)
                .await
                .unwrap_or_else(|e| fail(format!("delete {id}: {e}")));
            println!("{}", json!({"status": "deleted", "id": id}));
        }
        _ => unreachable!(),
    }
    pool.close().await;
}

/// Refuse anything that looks like the real Galley data directory.
fn guard_workdir(workdir: &Path) {
    let shown = workdir.to_string_lossy();
    if shown.contains("app.galley") || shown.contains("managed-ga-state") {
        fail(format!(
            "refusing workdir {shown}: it looks like real Galley data"
        ));
    }
}
