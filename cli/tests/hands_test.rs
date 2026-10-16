//! The remaining hands (main chat ticket 35) end to end: `session rename /
//! pin / unpin / delete`, `project update / pin / unpin /
//! archive-sessions`, `llm set-default`. The CLI binary talks to a socket
//! server this test runs on the per-user socket path inside a temp
//! `TMPDIR`, answering with Galley Core's production router
//! (`dispatch_line_with`) over the same database file the CLI's direct
//! reads open — so a write is checked by the read an agent would make
//! next (`session brief`, `sessions list`, `project list`, `llm list`).
//! Success, the refusals (`main_chat_protected:`, `managed_runtime_only:`,
//! not found, clap's) with their exit codes, and exit 4 with no Core.
//! Unix only: the server is a Unix socket.
#![cfg(unix)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use galley_core_lib::api::{
    CreateProjectInput, CreateSessionInput, GalleyApi, ManagedModelAuthKind, ManagedModelProtocol,
    Origin, RuntimeKind,
};
use galley_core_lib::credential_store;
use galley_core_lib::db::{
    MainChatSeed, SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata,
};
use galley_core_lib::notify::NullNotifier;
use galley_core_lib::runner_manager::RunnerManager;
use galley_core_lib::socket_listener::{dispatch_line_with, DbSource, DispatchResult, HandlerCtx};
use serde_json::{json, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

const MAIN: &str = "s-main";

/// A temp dir short enough for a socket path (macOS caps it near 104
/// bytes; `TMPDIR` there is long).
fn short_tempdir() -> TempDir {
    tempfile::Builder::new()
        .prefix("ghnd-")
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
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
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

async fn session(galley: &SqliteGalley, id: &str, project: Option<&str>) {
    galley
        .create_session(
            CreateSessionInput {
                id: id.into(),
                title: format!("title {id}"),
                project_id: project.map(str::to_string),
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::desktop(),
        )
        .await
        .expect("session");
}

async fn project(galley: &SqliteGalley, id: &str) {
    galley
        .create_project(
            CreateProjectInput {
                id: id.into(),
                name: format!("project {id}"),
                root_path: None,
                workspace_enabled: false,
                icon: None,
                color: None,
            },
            Origin::desktop(),
        )
        .await
        .expect("project");
}

/// Two usable models (the first saved is the default) and one without a
/// key, which `llm list` skips.
async fn models(galley: &SqliteGalley) {
    for (provider, secret) in [("mp_key", true), ("mp_nokey", false)] {
        let api_key_ref = format!("managed-provider:{provider}");
        galley
            .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
                id: provider.into(),
                display_name: provider.into(),
                protocol: ManagedModelProtocol::Openai,
                auth_kind: ManagedModelAuthKind::ApiKey,
                api_base: "https://example.test/v1".into(),
                api_key_ref: api_key_ref.clone(),
            })
            .await
            .expect("provider");
        if secret {
            credential_store::set_secret(galley, &api_key_ref, "sk-test")
                .await
                .expect("secret");
        }
    }
    for (id, provider, name, model) in [
        ("mm_sol", "mp_key", "GPT 6.1 Sol", "gpt-6.1-sol"),
        ("mm_nokey", "mp_nokey", "No Key", "nokey-1"),
        ("mm_flash", "mp_key", "GLM Flash", "glm-5.3-flash"),
    ] {
        galley
            .upsert_managed_model_metadata(UpsertManagedModelMetadata {
                id: id.into(),
                provider_id: provider.into(),
                display_name: name.into(),
                model: model.into(),
                preset_options: None,
                advanced_overrides: None,
                make_default: false,
            })
            .await
            .expect("model");
    }
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

/// Exit 2, `invalid_args`, the message starting with `prefix`.
fn assert_refused(out: &str, code: Option<i32>, prefix: &str) {
    assert_eq!(code, Some(2), "{out}");
    let err = json_of(out);
    assert_eq!(err["error"], "invalid_args", "{out}");
    assert!(
        err["message"].as_str().unwrap().starts_with(prefix),
        "{out}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_rename_pin_unpin_delete() {
    let td = short_tempdir();
    let db = database(td.path(), true).await;
    session(&db, "s-a", None).await;
    session(&db, "s-b", None).await;
    serve(td.path(), db.clone());

    let (out, code) = galley(
        td.path(),
        &[
            "--schema=3",
            "session",
            "rename",
            "s-a",
            "周报草稿",
            "--supervisor=galley-assistant",
            "--reason=user asked",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["session"]["title"], "周报草稿");
    let (out, _) = galley(td.path(), &["session", "brief", "s-a"]).await;
    assert_eq!(json_of(&out)["title"], "周报草稿");

    let (out, code) = galley(td.path(), &["session", "pin", "s-a"]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["session"]["pinned"], true);
    // Pinned first in the list the desktop and agents read.
    let (out, _) = galley(td.path(), &["sessions", "list"]).await;
    assert_eq!(ndjson(&out)[0]["id"], "s-a");
    let (out, code) = galley(td.path(), &["session", "unpin", "s-a"]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["session"]["pinned"], false);

    let (out, code) = galley(
        td.path(),
        &["session", "delete", "s-b", "--supervisor=galley-assistant"],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out), json!({"deleted": true, "sessionId": "s-b"}));
    let (out, code) = galley(td.path(), &["session", "brief", "s-b"]).await;
    assert_eq!(code, Some(3), "{out}");
    let (out, code) = galley(td.path(), &["session", "delete", "s-b"]).await;
    assert_eq!(code, Some(3), "{out}");
    assert_eq!(json_of(&out)["error"], "not_found");

    // The main chat takes none of them.
    for args in [
        vec!["session", "rename", MAIN, "x"],
        vec!["session", "pin", MAIN],
        vec!["session", "unpin", MAIN],
        vec!["session", "delete", MAIN],
    ] {
        let (out, code) = galley(td.path(), &args).await;
        assert_refused(&out, code, "main_chat_protected: ");
    }
    let (out, code) = galley(td.path(), &["session", "brief", MAIN]).await;
    assert_eq!(code, Some(0), "{out}");

    // clap: no title.
    let (out, code) = galley(td.path(), &["session", "rename", "s-a"]).await;
    assert_eq!(code, Some(2), "{out}");
    assert_eq!(json_of(&out)["error"], "invalid_args");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn project_update_pin_unpin_archive_sessions() {
    let td = short_tempdir();
    let db = database(td.path(), true).await;
    project(&db, "p1").await;
    project(&db, "p2").await;
    session(&db, "s-1", Some("p1")).await;
    session(&db, "s-2", Some("p1")).await;
    session(&db, "s-other", Some("p2")).await;
    serve(td.path(), db.clone());

    let (out, code) = galley(
        td.path(),
        &[
            "project",
            "update",
            "p1",
            "--name=季度复盘",
            "--icon=📊",
            "--color=#00aa88",
            "--supervisor=galley-assistant",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    let p = json_of(&out)["project"].clone();
    assert_eq!(
        (p["name"].clone(), p["icon"].clone(), p["color"].clone()),
        (json!("季度复盘"), json!("📊"), json!("#00aa88"))
    );
    let (out, code) = galley(td.path(), &["project", "update", "p1", "--icon="]).await;
    assert_eq!(code, Some(0), "{out}");
    assert!(json_of(&out)["project"].get("icon").is_none(), "{out}");
    // Nothing to change; an empty name; an unknown project.
    let (out, code) = galley(td.path(), &["project", "update", "p1"]).await;
    assert_refused(&out, code, "project.update: ");
    let (out, code) = galley(td.path(), &["project", "update", "p1", "--name="]).await;
    assert_eq!(code, Some(2), "{out}");
    let (out, code) = galley(td.path(), &["project", "update", "p-nope", "--name=x"]).await;
    assert_eq!(code, Some(3), "{out}");

    let (out, code) = galley(td.path(), &["project", "pin", "p2"]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["project"]["pinned"], true);
    let (out, _) = galley(td.path(), &["project", "list"]).await;
    assert_eq!(ndjson(&out)[0]["id"], "p2");
    let (out, code) = galley(td.path(), &["project", "unpin", "p2"]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["project"]["pinned"], false);

    let (out, code) = galley(
        td.path(),
        &[
            "project",
            "archive-sessions",
            "p1",
            "--supervisor=galley-assistant",
            "--reason=wrapped up",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    let archived = json_of(&out);
    assert_eq!(archived["projectId"], "p1");
    assert_eq!(archived["archivedSessions"], 2);
    let (out, _) = galley(td.path(), &["sessions", "list", "--project=p1"]).await;
    assert!(out.trim().is_empty(), "{out}");
    let (out, _) = galley(
        td.path(),
        &["sessions", "list", "--project=p1", "--archived"],
    )
    .await;
    assert_eq!(ndjson(&out).len(), 2);
    // The project and the other project's session stay.
    let (out, _) = galley(td.path(), &["project", "list"]).await;
    assert_eq!(ndjson(&out).len(), 2);
    let (out, _) = galley(td.path(), &["sessions", "list", "--project=p2"]).await;
    assert_eq!(ndjson(&out).len(), 1);
    let (out, code) = galley(td.path(), &["project", "archive-sessions", "p-nope"]).await;
    assert_eq!(code, Some(3), "{out}");
    assert_eq!(json_of(&out)["error"], "not_found");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn llm_set_default_moves_what_llm_list_reads_first() {
    let td = short_tempdir();
    let db = database(td.path(), true).await;
    models(&db).await;
    serve(td.path(), db.clone());

    let (out, _) = galley(td.path(), &["llm", "list", "--runtime=managed"]).await;
    assert_eq!(ndjson(&out)[0]["key"], "mm_sol");

    let (out, code) = galley(
        td.path(),
        &[
            "llm",
            "set-default",
            "glm flash",
            "--supervisor=galley-assistant",
            "--reason=user agreed",
        ],
    )
    .await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(
        json_of(&out),
        json!({"llm": {"index": 0, "name": "GLM Flash", "key": "mm_flash",
                       "displayName": "GLM Flash", "isCurrent": true},
               "changed": true})
    );
    let (out, _) = galley(td.path(), &["llm", "list"]).await;
    let rows = ndjson(&out);
    let keys: Vec<&str> = rows.iter().map(|r| r["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["mm_flash", "mm_sol"]);
    assert_eq!(rows[0]["isCurrent"], true);
    assert_eq!(rows[1]["isCurrent"], false);

    // Again: already the default.
    let (out, code) = galley(td.path(), &["llm", "set-default", "GLM Flash"]).await;
    assert_eq!(code, Some(0), "{out}");
    assert_eq!(json_of(&out)["changed"], false);

    // Not a name `llm list` prints: unknown, or a model with no key.
    for name in ["nope", "No Key"] {
        let (out, code) = galley(td.path(), &["llm", "set-default", name]).await;
        assert_refused(&out, code, "unknown managed llm");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn llm_set_default_is_managed_only() {
    let td = short_tempdir();
    let db = database(td.path(), false).await;
    models(&db).await;
    serve(td.path(), db.clone());
    let (out, code) = galley(td.path(), &["llm", "set-default", "GLM Flash"]).await;
    assert_refused(&out, code, "managed_runtime_only: ");
    // The session and project hands work there as anywhere.
    session(&db, "s-a", None).await;
    let (out, code) = galley(td.path(), &["session", "pin", "s-a"]).await;
    assert_eq!(code, Some(0), "{out}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_core_the_hands_exit_4() {
    let td = short_tempdir();
    let db = database(td.path(), true).await;
    drop(db);
    for args in [
        vec!["session", "rename", "s-a", "x"],
        vec!["session", "pin", "s-a"],
        vec!["session", "unpin", "s-a"],
        vec!["session", "delete", "s-a"],
        vec!["project", "update", "p1", "--name=x"],
        vec!["project", "pin", "p1"],
        vec!["project", "unpin", "p1"],
        vec!["project", "archive-sessions", "p1"],
        vec!["llm", "set-default", "x"],
    ] {
        let (out, code) = galley(td.path(), &args).await;
        assert_eq!(code, Some(4), "{args:?}: {out}");
        assert_eq!(json_of(&out)["error"], "db_unavailable");
    }
}
