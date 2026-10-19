//! `galley todo …` end to end (main chat ticket 40): the CLI binary talks
//! to a socket server this test runs on the per-user socket path inside a
//! temp `TMPDIR`, which answers with Galley Core's production router
//! (`dispatch_line_with`) over the same database file the CLI's direct
//! reads open. What each command prints and exits with: success, the
//! refusals (`time_in_past:`, `assistant_unavailable:`, `not_found`,
//! clap's), a due date's two forms, a reminder made and cancelled when
//! the to-do is ticked off, the default list and `--all`, `--schema=3`;
//! the exit-4 path with no Core; and the old commands printing the same
//! bytes with to-dos about. Unix only: the server is a Unix socket.
#![cfg(unix)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use chrono::{Duration as ChronoDuration, Local, Utc};
use galley_core_lib::api::schedule::instant_to_utc_iso;
use galley_core_lib::api::Origin;
use galley_core_lib::db::{MainChatSeed, SqliteGalley};
use galley_core_lib::notify::NullNotifier;
use galley_core_lib::runner_manager::RunnerManager;
use galley_core_lib::socket_listener::{dispatch_line_with, DbSource, DispatchResult, HandlerCtx};
use serde_json::{json, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

/// A temp dir short enough for a socket path (macOS caps it near 104
/// bytes; `TMPDIR` there is long).
fn short_tempdir() -> TempDir {
    tempfile::Builder::new()
        .prefix("gtodo-")
        .tempdir_in("/tmp")
        .expect("tempdir")
}

/// The database file, migrated, on the managed runtime with its main
/// chat (or the external one).
async fn database(dir: &Path, managed: bool) -> SqliteGalley {
    let opts = SqliteConnectOptions::new()
        .filename(dir.join("test.db"))
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts).await.expect("open db");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool);
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .expect("managed");
    galley
        .get_or_create_main_chat("s-main", Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    if !managed {
        galley
            .set_pref_json("active_runtime_kind", json!("external"))
            .await
            .expect("external");
    }
    galley
}

/// Serve Core's router on the socket the CLI finds under `dir` (its
/// `TMPDIR`), until the test ends.
fn serve(dir: &Path, galley: SqliteGalley) {
    let uid = dir.metadata().expect("meta").uid();
    let path = dir.join(format!("galley-{uid}.sock"));
    let listener = UnixListener::bind(&path).expect("bind");
    let manager = Arc::new(RunnerManager::new());
    tokio::spawn(async move {
        let db = Arc::new(DbSource::Pool(galley));
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            let db = db.clone();
            let manager = manager.clone();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let ctx = HandlerCtx {
                        db: db.as_ref(),
                        runner: manager.as_ref(),
                        notifier: NullNotifier::arc(),
                        app: None,
                    };
                    let DispatchResult::Unary(resp) = dispatch_line_with(&ctx, &line).await else {
                        return;
                    };
                    let out = serde_json::to_string(&resp).expect("response") + "\n";
                    if write.write_all(out.as_bytes()).await.is_err() {
                        return;
                    }
                }
            });
        }
    });
}

/// Run the CLI against `dir` (its database and socket); stdout and the
/// exit code. Off the async runtime, so the server keeps answering.
async fn galley(dir: &Path, args: &[&str]) -> (String, Option<i32>) {
    let bin = PathBuf::from(env!("CARGO_BIN_EXE_galley"));
    let dir = dir.to_path_buf();
    let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    tokio::task::spawn_blocking(move || {
        let out = Command::new(bin)
            .args(&args)
            .env("GALLEY_DB_PATH", dir.join("test.db"))
            .env("TMPDIR", &dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .expect("spawn galley");
        (
            String::from_utf8_lossy(&out.stdout).into_owned(),
            out.status.code(),
        )
    })
    .await
    .expect("join")
}

/// `galley …` that must succeed; its stdout.
async fn ok(dir: &Path, args: &[&str]) -> String {
    let (out, code) = galley(dir, args).await;
    assert_eq!(code, Some(0), "{args:?}: {out}");
    out
}

fn json_of(stdout: &str) -> Value {
    serde_json::from_str(stdout.trim()).unwrap_or_else(|e| panic!("{e}: {stdout}"))
}

fn ndjson(stdout: &str) -> Vec<Value> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("ndjson line"))
        .collect()
}

fn ids(stdout: &str) -> Vec<String> {
    ndjson(stdout)
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect()
}

fn in_minutes(minutes: i64) -> String {
    instant_to_utc_iso(&(Utc::now() + ChronoDuration::minutes(minutes)))
}

fn assert_refused(out: &str, code: Option<i32>, prefix: &str) {
    assert_eq!(code, Some(2), "{out}");
    let err = json_of(out);
    assert_eq!(err["error"], "invalid_args", "{out}");
    assert!(
        err["message"].as_str().unwrap().starts_with(prefix),
        "{prefix}: {out}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn add_show_list_update_done_reopen_cancel() {
    let td = short_tempdir();
    let dir = td.path();
    serve(dir, database(dir, true).await);

    // A day with no time, and a reminder, as Galley notes one.
    let friday = (Local::now() + ChronoDuration::days(3))
        .format("%Y-%m-%d")
        .to_string();
    let remind = in_minutes(30);
    let out = ok(
        dir,
        &[
            "--schema=3",
            "todo",
            "add",
            "交季度报告",
            "--notes=带合同",
            &format!("--due={friday}"),
            &format!("--remind-at={remind}"),
            "--supervisor=galley-assistant",
            "--reason=user mentioned it",
        ],
    )
    .await;
    let report = json_of(&out)["todo"].clone();
    let rid = report["id"].as_str().unwrap().to_string();
    assert!(rid.starts_with("todo_"));
    assert_eq!(report["due"], json!({"date": friday, "hasTime": false}));
    assert_eq!(report["status"], "open");
    assert_eq!(report["origin"]["supervisor"], "galley-assistant");
    let reminder = report["reminder"].clone();
    assert_eq!(reminder["at"], json!(remind));
    assert_eq!(reminder["state"], "scheduled");
    let task_id = reminder["taskId"].as_str().unwrap().to_string();
    // The reminder is a scheduled task on this to-do.
    let task = json_of(&ok(dir, &["schedule", "show", &task_id]).await);
    assert_eq!(task["todoId"], json!(rid));
    assert_eq!(task["target"], "assistant");

    // A day with a time, local.
    let local = (Local::now() + ChronoDuration::days(1))
        .format("%Y-%m-%dT15:00")
        .to_string();
    let out = ok(
        dir,
        &["todo", "add", "回房东电话", &format!("--due={local}")],
    )
    .await;
    let call = json_of(&out)["todo"].clone();
    let cid = call["id"].as_str().unwrap().to_string();
    assert_eq!(call["due"]["date"], json!(&local[..10]));
    assert_eq!(call["due"]["hasTime"], true);
    assert_eq!(call["due"]["time"], "15:00");
    assert!(call["due"]["at"].is_string());
    assert_eq!(call["origin"], json!({"via": "cli"}));

    // No due date.
    let out = ok(dir, &["todo", "add", "买营养土"]).await;
    let soil = json_of(&out)["todo"]["id"].as_str().unwrap().to_string();

    // show prints the to-do itself.
    let shown = json_of(&ok(dir, &["todo", "show", &rid]).await);
    assert_eq!(shown, report);

    // list: due soonest first, no due date last; NDJSON.
    assert_eq!(
        ids(&ok(dir, &["todo", "list"]).await),
        vec![cid.clone(), rid.clone(), soil.clone()]
    );

    // update: only what is given.
    let out = ok(
        dir,
        &[
            "todo",
            "update",
            &cid,
            "--title=给房东回电话",
            "--no-due",
            "--supervisor=galley-assistant",
        ],
    )
    .await;
    let changed = json_of(&out)["todo"].clone();
    assert_eq!(changed["title"], "给房东回电话");
    assert!(changed.get("due").is_none());
    assert_eq!(
        changed["origin"],
        json!({"via": "cli"}),
        "who made it stays"
    );
    let later = in_minutes(120);
    let out = ok(
        dir,
        &[
            "todo",
            "update",
            &soil,
            &format!("--remind-at={later}"),
            "--notes=阳台用",
        ],
    )
    .await;
    let soil_reminded = json_of(&out)["todo"].clone();
    assert_eq!(soil_reminded["reminder"]["at"], json!(later));
    assert_eq!(soil_reminded["notes"], "阳台用");
    let soil_task = soil_reminded["reminder"]["taskId"]
        .as_str()
        .unwrap()
        .to_string();
    let out = ok(dir, &["todo", "update", &soil, "--no-remind", "--notes="]).await;
    let soil_plain = json_of(&out)["todo"].clone();
    assert!(soil_plain.get("reminder").is_none());
    assert!(soil_plain.get("notes").is_none());
    // Removing the reminder is the caller's own cancel (ticket 61).
    let removed = json_of(&ok(dir, &["schedule", "show", &soil_task]).await);
    assert_eq!(removed["cancelledBy"], json!({"via": "cli"}));

    // done: ticked off by Galley, its reminder cancelled.
    let out = ok(
        dir,
        &["todo", "done", &rid, "--supervisor=galley-assistant"],
    )
    .await;
    let done = json_of(&out)["todo"].clone();
    assert_eq!(done["status"], "done");
    assert_eq!(done["doneBy"]["supervisor"], "galley-assistant");
    assert!(done.get("reminder").is_none());
    let task = json_of(&ok(dir, &["schedule", "show", &task_id]).await);
    assert!(task["cancelledAt"].is_string(), "{task}");
    // Core cancelled it with its to-do (ticket 61): `system`.
    assert_eq!(task["cancelledBy"], json!({"via": "system"}));
    assert!(!ok(dir, &["schedule", "list"]).await.contains(&task_id));
    // Both left have no due date now, noted in the same second: their
    // order falls to the ids, so compare them as a set.
    let mut left = ids(&ok(dir, &["todo", "list"]).await);
    left.sort();
    let mut want = vec![cid.clone(), soil.clone()];
    want.sort();
    assert_eq!(left, want);

    // reopen: open again, the reminder stays cancelled.
    let out = ok(dir, &["todo", "reopen", &rid]).await;
    let reopened = json_of(&out)["todo"].clone();
    assert_eq!(reopened["status"], "open");
    assert!(reopened.get("doneBy").is_none() && reopened.get("reminder").is_none());

    // cancel: gone from the list, still shown and in --all.
    let out = ok(
        dir,
        &["todo", "cancel", &soil, "--reason=user said never mind"],
    )
    .await;
    assert_eq!(json_of(&out)["todo"]["status"], "cancelled");
    ok(dir, &["todo", "done", &cid]).await;
    assert_eq!(ids(&ok(dir, &["todo", "list"]).await), vec![rid.clone()]);
    assert_eq!(
        ids(&ok(dir, &["todo", "list", "--all"]).await),
        vec![rid.clone(), cid.clone(), soil.clone()]
    );
    // Who cancelled it and why (ticket 61), in `show` and `list --all`.
    let gone = json_of(&ok(dir, &["--schema=3", "todo", "show", &soil]).await);
    assert!(gone["cancelledAt"].is_string());
    let by = json!({"via": "cli", "reason": "user said never mind"});
    assert_eq!(gone["cancelledBy"], by);
    let all = ndjson(&ok(dir, &["--schema=3", "todo", "list", "--all"]).await);
    let row = all.iter().find(|t| t["id"] == json!(soil)).expect("listed");
    assert_eq!(row["cancelledBy"], by);
    assert!(all
        .iter()
        .filter(|t| t["id"] != json!(soil))
        .all(|t| t.get("cancelledBy").is_none()));
    // Twice is not_found, as for every write on a cancelled one.
    let (out, code) = galley(dir, &["todo", "cancel", &soil]).await;
    assert_eq!(code, Some(3), "{out}");
    assert_eq!(json_of(&out)["error"], "not_found");
    // Every pin the binary accepts answers.
    for pin in ["--schema=1", "--schema=2"] {
        assert_eq!(
            ids(&ok(dir, &[pin, "todo", "list"]).await),
            vec![rid.clone()]
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refusals_exit_with_their_category() {
    let td = short_tempdir();
    let dir = td.path();
    serve(dir, database(dir, true).await);

    let past = format!("--remind-at={}", in_minutes(-2));
    let (out, code) = galley(dir, &["todo", "add", "x", &past]).await;
    assert_refused(&out, code, "time_in_past: ");
    assert!(
        ok(dir, &["todo", "list", "--all"]).await.is_empty(),
        "nothing half made"
    );
    let id = json_of(&ok(dir, &["todo", "add", "x"]).await)["todo"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (out, code) = galley(dir, &["todo", "update", &id, &past]).await;
    assert_refused(&out, code, "time_in_past: ");
    // Core's checks: a bad due date, an empty title.
    for args in [
        vec!["todo", "add", "x", "--due=Friday"],
        vec!["todo", "add", " "],
        vec!["todo", "update", id.as_str(), "--title= "],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(2), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "invalid_args", "{args:?}");
    }
    // clap: no title, nothing to change, a value and its "no", an empty
    // time, an unknown flag.
    for args in [
        vec!["todo", "add"],
        vec!["todo", "update", id.as_str()],
        vec![
            "todo",
            "update",
            id.as_str(),
            "--due=2026-10-23",
            "--no-due",
        ],
        vec![
            "todo",
            "update",
            id.as_str(),
            "--remind-at=2030-01-01T09:00",
            "--no-remind",
        ],
        vec!["todo", "update", id.as_str(), "--due="],
        vec!["todo", "add", "x", "--remind-at="],
        vec!["todo", "done"],
        vec!["todo", "add", "x", "--at=2030-01-01T09:00"],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(2), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "invalid_args", "{args:?}");
    }
    // Unknown ids: the direct read and a write.
    for args in [
        vec!["todo", "show", "todo_nope"],
        vec!["todo", "done", "todo_nope"],
        vec!["todo", "update", "todo_nope", "--title=y"],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(3), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "not_found");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_external_runtime_reads_but_does_not_write() {
    let td = short_tempdir();
    let dir = td.path();
    let galley_db = database(dir, true).await;
    serve(dir, galley_db.clone());
    let kept = ok(dir, &["todo", "add", "记下的事"]).await;
    let id = json_of(&kept)["todo"]["id"].as_str().unwrap().to_string();
    galley_db
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    for args in [
        vec!["todo", "add", "x"],
        vec!["todo", "update", id.as_str(), "--title=y"],
        vec!["todo", "done", id.as_str()],
        vec!["todo", "reopen", id.as_str()],
        vec!["todo", "cancel", id.as_str()],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_refused(&out, code, "assistant_unavailable: ");
    }
    assert_eq!(ids(&ok(dir, &["todo", "list"]).await), vec![id.clone()]);
    assert_eq!(
        json_of(&ok(dir, &["todo", "show", &id]).await),
        json_of(&kept)["todo"]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_core_the_writes_exit_4_and_the_reads_still_work() {
    let td = short_tempdir();
    let dir = td.path();
    drop(database(dir, true).await);
    for args in [
        vec!["todo", "add", "x"],
        vec!["todo", "update", "todo_x", "--title=y"],
        vec!["todo", "done", "todo_x"],
        vec!["todo", "reopen", "todo_x"],
        vec!["todo", "cancel", "todo_x"],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(4), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "db_unavailable");
    }
    assert!(ok(dir, &["todo", "list", "--all"]).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_old_commands_print_the_same_bytes_with_todos_about() {
    let td = short_tempdir();
    let dir = td.path();
    serve(dir, database(dir, true).await);
    // A scheduled task of its own, so `schedule list` has a row to print.
    ok(
        dir,
        &["schedule", "create", "整理下载", "--daily", "--time=09:00"],
    )
    .await;
    let old: [&[&str]; 7] = [
        &["version"],
        &["status"],
        &["sessions", "list"],
        &["session", "brief", "s-main"],
        &["project", "list"],
        &["schedule", "list", "--all"],
        &["--schema=1", "sessions", "list", "--all"],
    ];
    let mut before = Vec::new();
    for args in old {
        before.push(ok(dir, args).await);
    }
    // To-dos noted, changed, ticked off, unticked, cancelled — none with a
    // reminder, so no scheduled task is made.
    let id = json_of(&ok(dir, &["todo", "add", "a", "--due=2026-10-23"]).await)["todo"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    ok(dir, &["todo", "add", "b", "--supervisor=galley-assistant"]).await;
    ok(dir, &["todo", "update", &id, "--title=c", "--no-due"]).await;
    ok(dir, &["todo", "done", &id]).await;
    ok(dir, &["todo", "reopen", &id]).await;
    ok(dir, &["todo", "cancel", &id]).await;
    for (args, was) in old.iter().zip(&before) {
        assert_eq!(&ok(dir, args).await, was, "{args:?}");
    }
}
