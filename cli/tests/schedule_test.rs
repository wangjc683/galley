//! `galley schedule …` end to end (main chat ticket 34): the CLI binary
//! talks to a socket server this test runs on the per-user socket path
//! inside a temp `TMPDIR`, which answers with Galley Core's production
//! router (`dispatch_line_with`) over the same database file the CLI's
//! direct reads open. What each command prints and exits with: success,
//! the refusals (`time_in_past:`, `assistant_unavailable:`, clap's), the
//! default list and `--all`, `--schema=3`; and the exit-4 path with no
//! Core. Unix only: the server is a Unix socket.
#![cfg(unix)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use chrono::{Duration as ChronoDuration, Utc};
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
        .prefix("gsch-")
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

fn in_minutes(minutes: i64) -> String {
    instant_to_utc_iso(&(Utc::now() + ChronoDuration::minutes(minutes)))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn create_show_list_update_and_the_rest() {
    let td = short_tempdir();
    let galley_db = database(td.path(), true).await;
    serve(td.path(), galley_db.clone());

    // A reminder for the assistant, as the assistant sets one.
    let at = in_minutes(10);
    let (out, code) = galley(
        td.path(),
        &[
            "--schema=3",
            "schedule",
            "create",
            "提醒用户喝水",
            &format!("--at={at}"),
            "--target=assistant",
            "--supervisor=galley-assistant",
            "--reason=user asked",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    let reminder = json_of(&out)["task"].clone();
    let rid = reminder["id"].as_str().unwrap().to_string();
    assert_eq!(reminder["repeat"], json!({"kind": "once"}));
    assert_eq!(reminder["fireAt"], json!(at));
    assert_eq!(reminder["target"], "assistant");
    assert_eq!(reminder["origin"]["supervisor"], "galley-assistant");

    // A repeating session task, the default target.
    let (out, code) = galley(
        td.path(),
        &[
            "schedule",
            "create",
            "每周整理下载",
            "--weekly=5,1",
            "--time=17:00",
            "--supervisor=ga-claude-1",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    let weekly = json_of(&out)["task"].clone();
    let wid = weekly["id"].as_str().unwrap().to_string();
    assert_eq!(
        weekly["repeat"],
        json!({"kind": "weekly", "weekdays": [1, 5]})
    );
    assert_eq!(weekly["target"], "session");

    // show prints the task itself.
    let (out, code) = galley(td.path(), &["schedule", "show", &rid]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["id"], json!(rid));

    // update: only what is given.
    let (out, code) = galley(
        td.path(),
        &[
            "schedule",
            "update",
            &wid,
            "--prompt=每周五整理下载",
            "--daily",
            "--time=08:00",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    let updated = json_of(&out)["task"].clone();
    assert_eq!(updated["prompt"], "每周五整理下载");
    assert_eq!(updated["repeat"], json!({"kind": "daily"}));
    assert_eq!(updated["timeOfDay"], "08:00");
    assert_eq!(
        updated["origin"]["supervisor"], "ga-claude-1",
        "who made it stays"
    );

    // disable / enable.
    let (out, code) = galley(td.path(), &["schedule", "disable", &wid]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["task"]["enabled"], false);

    // list: only what may still fire, NDJSON; --all has the rest.
    let (out, code) = galley(td.path(), &["schedule", "list"]).await;
    assert_eq!(code, Some(0), "{out}");
    let listed: Vec<String> = ndjson(&out)
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(listed, vec![rid.clone()]);
    let (out, _) = galley(td.path(), &["schedule", "list", "--all"]).await;
    assert_eq!(ndjson(&out).len(), 2);

    let (out, code) = galley(td.path(), &["schedule", "enable", &wid]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["task"]["enabled"], true);

    // run: the reminder fires now (a pending wake), its planned fire stays.
    let (out, code) = galley(td.path(), &["schedule", "run", &rid]).await;
    assert_eq!(code, Some(0), "{out}");
    let ran = json_of(&out)["task"].clone();
    assert_eq!(ran["lastWake"], "pending");
    assert_eq!(ran["nextFireAt"], json!(at));

    // delete cancels: gone from the list, still shown; twice is not_found.
    let (out, code) = galley(
        td.path(),
        &["schedule", "delete", &rid, "--supervisor=galley-assistant"],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    assert!(json_of(&out)["task"]["cancelledAt"].is_string());
    let (out, _) = galley(td.path(), &["schedule", "list"]).await;
    assert!(!out.contains(&rid));
    let (out, _) = galley(td.path(), &["schedule", "list", "--all"]).await;
    assert!(out.contains(&rid));
    let (out, code) = galley(td.path(), &["schedule", "delete", &rid]).await;
    assert_eq!(code, Some(3), "{out}");
    assert_eq!(json_of(&out)["error"], "not_found");
    // The direct read of an unknown id.
    let (out, code) = galley(td.path(), &["schedule", "show", "sched_nope"]).await;
    assert_eq!(code, Some(3), "{out}");
    assert_eq!(json_of(&out)["error"], "not_found");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refusals_exit_2_with_their_prefix() {
    let td = short_tempdir();
    let galley_db = database(td.path(), true).await;
    serve(td.path(), galley_db.clone());

    let (out, code) = galley(
        td.path(),
        &[
            "schedule",
            "create",
            "x",
            &format!("--at={}", in_minutes(-2)),
        ],
    )
    .await;
    assert_eq!(code, Some(2), "{out}");
    let err = json_of(&out);
    assert_eq!(err["error"], "invalid_args");
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .starts_with("time_in_past: "),
        "{out}"
    );
    // A repeating rule without its time.
    let (out, code) = galley(td.path(), &["schedule", "create", "x", "--daily"]).await;
    assert_eq!(code, Some(2), "{out}");
    // clap: neither a time nor a rule, both, a misspelt target.
    for args in [
        vec!["schedule", "create", "x"],
        vec![
            "schedule",
            "create",
            "x",
            "--at=2030-01-01T09:00",
            "--daily",
        ],
        vec![
            "schedule",
            "create",
            "x",
            "--daily",
            "--weekly=1",
            "--time=09:00",
        ],
        vec![
            "schedule",
            "create",
            "x",
            "--at=2030-01-01T09:00",
            "--target=robot",
        ],
        vec!["schedule", "create", "x", "--weekly=mon", "--time=09:00"],
    ] {
        let (out, code) = galley(td.path(), &args).await;
        assert_eq!(code, Some(2), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "invalid_args", "{args:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_external_runtime_has_no_assistant_to_wake() {
    let td = short_tempdir();
    let galley_db = database(td.path(), false).await;
    serve(td.path(), galley_db.clone());
    let (out, code) = galley(
        td.path(),
        &[
            "schedule",
            "create",
            "x",
            &format!("--at={}", in_minutes(30)),
            "--target=assistant",
        ],
    )
    .await;
    assert_eq!(code, Some(2), "{out}");
    assert!(
        json_of(&out)["message"]
            .as_str()
            .unwrap()
            .starts_with("assistant_unavailable: "),
        "{out}"
    );
    // A session task is fine there.
    let (out, code) = galley(
        td.path(),
        &[
            "schedule",
            "create",
            "x",
            &format!("--at={}", in_minutes(30)),
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_core_the_writes_exit_4_and_the_reads_still_work() {
    let td = short_tempdir();
    let galley_db = database(td.path(), true).await;
    drop(galley_db);
    for args in [
        vec!["schedule", "create", "x", "--at=2030-01-01T09:00"],
        vec!["schedule", "update", "sched_x", "--prompt=y"],
        vec!["schedule", "delete", "sched_x"],
        vec!["schedule", "enable", "sched_x"],
        vec!["schedule", "disable", "sched_x"],
        vec!["schedule", "run", "sched_x"],
    ] {
        let (out, code) = galley(td.path(), &args).await;
        assert_eq!(code, Some(4), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "db_unavailable");
    }
    let (out, code) = galley(td.path(), &["schedule", "list", "--all"]).await;
    assert_eq!(code, Some(0), "{out}");
    assert!(out.is_empty());
}
