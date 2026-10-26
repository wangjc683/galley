//! `galley memo …` end to end (main chat ticket 95): the CLI binary talks
//! to a socket server this test runs on the per-user socket path inside a
//! temp `TMPDIR`, which answers with Galley Core's production router
//! (`dispatch_line_with`) over the same database file the CLI's direct
//! read opens. What each command prints and exits with: success (`add`
//! with and without a last day, `update`, `delete`, the NDJSON `list` in
//! the order the memos were noted), past the total (`overLimit`, exit 0),
//! the refusals (a text of 0 or 101 characters, a last day before today
//! with `time_in_past:`, `assistant_unavailable:`, `not_found`, clap's),
//! every schema pin; the exit-4 path with no Core. Unix only: the server
//! is a Unix socket.
#![cfg(unix)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use chrono::{Duration as ChronoDuration, Local};
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
        .prefix("gmemo-")
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

fn assert_refused(out: &str, code: Option<i32>, prefix: &str) {
    assert_eq!(code, Some(2), "{out}");
    let err = json_of(out);
    assert_eq!(err["error"], "invalid_args", "{out}");
    assert!(
        err["message"].as_str().unwrap().starts_with(prefix),
        "{prefix}: {out}"
    );
}

fn day(days_from_today: i64) -> String {
    (Local::now().date_naive() + ChronoDuration::days(days_from_today))
        .format("%Y-%m-%d")
        .to_string()
}

fn memo_id(stdout: &str) -> String {
    json_of(stdout)["memo"]["id"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn add_list_update_delete() {
    let td = short_tempdir();
    let dir = td.path();
    serve(dir, database(dir, true).await);

    // A last day, as Galley notes one.
    let friday = day(4);
    let out = ok(
        dir,
        &[
            "--schema=3",
            "memo",
            "add",
            "下周三起在上海出差",
            &format!("--until={friday}"),
            "--supervisor=galley-assistant",
            "--reason=user mentioned it",
        ],
    )
    .await;
    let written = json_of(&out);
    let trip = written["memo"].clone();
    let tid = trip["id"].as_str().unwrap().to_string();
    assert!(tid.starts_with("memo_"));
    assert_eq!(trip["text"], "下周三起在上海出差");
    assert_eq!(trip["until"], json!(friday));
    assert_eq!(
        trip["origin"],
        json!({"via": "supervisor", "supervisor": "galley-assistant", "reason": "user mentioned it"})
    );
    assert!(trip["createdAt"].is_string() && trip["updatedAt"].is_string());
    // No main chat run open: noted in no turn.
    assert!(trip.get("createdIn").is_none());
    assert!(written.get("overLimit").is_none());
    let keys: Vec<&String> = written.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["memo"]);

    // No last day, no label.
    let out = ok(dir, &["memo", "add", "  不吃香菜  "]).await;
    let cilantro = json_of(&out)["memo"].clone();
    let cid = cilantro["id"].as_str().unwrap().to_string();
    assert_eq!(cilantro["text"], "不吃香菜");
    assert!(cilantro.get("until").is_none());
    assert_eq!(cilantro["origin"], json!({"via": "cli"}));

    // list: NDJSON, in the order they were noted.
    assert_eq!(
        ids(&ok(dir, &["memo", "list"]).await),
        vec![tid.clone(), cid.clone()]
    );
    assert_eq!(ndjson(&ok(dir, &["memo", "list"]).await)[0], trip);

    // update: only what is given; who noted it stays.
    let out = ok(
        dir,
        &[
            "memo",
            "update",
            &tid,
            "--text=下周三起在上海出差，住静安",
            "--supervisor=galley-assistant",
        ],
    )
    .await;
    let changed = json_of(&out)["memo"].clone();
    assert_eq!(changed["text"], "下周三起在上海出差，住静安");
    assert_eq!(changed["until"], json!(friday));
    assert_eq!(changed["origin"], trip["origin"]);
    let out = ok(dir, &["memo", "update", &tid, "--no-until"]).await;
    assert!(json_of(&out)["memo"].get("until").is_none());
    let out = ok(
        dir,
        &["memo", "update", &cid, &format!("--until={}", day(0))],
    )
    .await;
    assert_eq!(json_of(&out)["memo"]["until"], json!(day(0)));

    // delete: gone from the list; prints the memo as it was.
    let out = ok(
        dir,
        &[
            "memo",
            "delete",
            &cid,
            "--supervisor=galley-assistant",
            "--reason=user said so",
        ],
    )
    .await;
    let gone = json_of(&out);
    assert_eq!(gone["memo"]["id"], json!(cid));
    assert_eq!(gone["memo"]["text"], "不吃香菜");
    assert_eq!(ids(&ok(dir, &["memo", "list"]).await), vec![tid.clone()]);
    // Twice is not_found, and so is a change.
    for args in [
        vec!["memo", "delete", cid.as_str()],
        vec!["memo", "update", cid.as_str(), "--text=x"],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(3), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "not_found");
    }
    // Every pin the binary accepts answers.
    for pin in ["--schema=1", "--schema=2", "--schema=3"] {
        assert_eq!(
            ids(&ok(dir, &[pin, "memo", "list"]).await),
            vec![tid.clone()]
        );
        let id = memo_id(&ok(dir, &[pin, "memo", "add", "喜欢喝茶"]).await);
        ok(dir, &[pin, "memo", "delete", &id]).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_two_thousand_characters_the_write_is_kept_and_says_so() {
    let td = short_tempdir();
    let dir = td.path();
    serve(dir, database(dir, true).await);
    let hundred = "字".repeat(100);
    for _ in 0..19 {
        ok(dir, &["memo", "add", &hundred]).await;
    }
    let ninety_nine = "字".repeat(99);
    let out = ok(dir, &["memo", "add", &ninety_nine]).await;
    assert!(json_of(&out).get("overLimit").is_none(), "1,999: {out}");
    let (out, code) = galley(dir, &["memo", "add", "两字"]).await;
    assert_eq!(code, Some(0), "kept: {out}");
    let written = json_of(&out);
    assert_eq!(
        written["overLimit"],
        json!({
            "chars": 2001,
            "limit": 2000,
            "over": 1,
            "message": "Memos now total 2001 characters, 1 over the 2000 the start of each \
                        segment holds, so the last ones noted will be left out of it: merge \
                        memos or delete the ones out of date first."
        })
    );
    assert_eq!(ndjson(&ok(dir, &["memo", "list"]).await).len(), 21);
    // Brought back under by a change.
    let id = written["memo"]["id"].as_str().unwrap().to_string();
    let out = ok(dir, &["memo", "update", &id, "--text=一"]).await;
    assert!(json_of(&out).get("overLimit").is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refusals_exit_with_their_category() {
    let td = short_tempdir();
    let dir = td.path();
    serve(dir, database(dir, true).await);

    // Core's checks: the text's length, in characters, and the last day.
    let past = format!("--until={}", day(-1));
    let too_long = "🏀".repeat(101);
    for (args, wants) in [
        (
            vec!["memo", "add", " "],
            "a memo is 1 to 100 characters once trimmed; this one is 0",
        ),
        (
            vec!["memo", "add", too_long.as_str()],
            "a memo is 1 to 100 characters once trimmed; this one is 101",
        ),
        (vec!["memo", "add", "x", past.as_str()], "time_in_past: "),
        (
            vec!["memo", "add", "x", "--until=Friday"],
            "until is a local date YYYY-MM-DD",
        ),
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(2), "{args:?}: {out}");
        let err = json_of(&out);
        assert_eq!(err["error"], "invalid_args", "{args:?}");
        assert!(
            err["message"].as_str().unwrap().contains(wants),
            "{args:?}: {out}"
        );
    }
    assert!(
        ok(dir, &["memo", "list"]).await.is_empty(),
        "nothing written"
    );
    let hundred = "🏀".repeat(100);
    let id = memo_id(&ok(dir, &["memo", "add", &hundred]).await);
    let (out, code) = galley(dir, &["memo", "update", &id, &past]).await;
    assert_eq!(code, Some(2), "{out}");
    assert!(json_of(&out)["message"]
        .as_str()
        .unwrap()
        .starts_with("time_in_past: "));
    // clap: no text, nothing to change, a day and its "no", an empty day,
    // an unknown flag, no id; no `show` in this family.
    for args in [
        vec!["memo", "add"],
        vec!["memo", "update", id.as_str()],
        vec![
            "memo",
            "update",
            id.as_str(),
            "--until=2030-01-01",
            "--no-until",
        ],
        vec!["memo", "add", "x", "--until="],
        vec!["memo", "add", "x", "--due=2030-01-01"],
        vec!["memo", "delete"],
        vec!["memo", "show", id.as_str()],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(2), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "invalid_args", "{args:?}");
    }
    // Unknown ids.
    for args in [
        vec!["memo", "update", "memo_nope", "--text=y"],
        vec!["memo", "delete", "memo_nope"],
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
    let kept = ok(dir, &["memo", "add", "不吃香菜"]).await;
    let id = memo_id(&kept);
    galley_db
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    for args in [
        vec!["memo", "add", "x"],
        vec!["memo", "update", id.as_str(), "--text=y"],
        vec!["memo", "delete", id.as_str()],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_refused(&out, code, "assistant_unavailable: ");
    }
    assert_eq!(
        ndjson(&ok(dir, &["memo", "list"]).await),
        vec![json_of(&kept)["memo"].clone()]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_core_the_writes_exit_4_and_the_list_still_reads() {
    let td = short_tempdir();
    let dir = td.path();
    drop(database(dir, true).await);
    for args in [
        vec!["memo", "add", "x"],
        vec!["memo", "update", "memo_x", "--text=y"],
        vec!["memo", "delete", "memo_x"],
    ] {
        let (out, code) = galley(dir, &args).await;
        assert_eq!(code, Some(4), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "db_unavailable");
    }
    assert!(ok(dir, &["memo", "list"]).await.is_empty());
}
