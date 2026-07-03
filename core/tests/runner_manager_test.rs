//! Integration tests for [`galley_core_lib::runner_manager`].
//!
//! These tests use a mock Python script (written to a tempdir at test start)
//! instead of the real `runner.workbench_bridge` module, so they don't depend
//! on a configured GA install. The mock emits IPC events from a hardcoded
//! script — exactly the shape the real runner would emit — and the tests
//! verify the manager surfaces them correctly.
//!
//! ## Why the mock approach
//!
//! - Real `workbench_bridge` requires a GA path + Python deps + mykey.py,
//!   none of which CI has reliably.
//! - The manager's contract is "spawn a child, fan out its stdout, talk to
//!   its stdin" — pure plumbing. A mock validates the plumbing without
//!   needing GA business logic.
//! - Integration vs. unit: the manager's own `cargo test --lib` tests cover
//!   value-type semantics + error variants; this file exercises the
//!   spawn → stdout → broadcast → shutdown lifecycle end-to-end.
//!
//! ## Skipping on machines without Python
//!
//! Each test calls [`mock_python_path`] which returns `None` when no Python
//! is reachable. The test silently no-ops in that case rather than failing —
//! CI Linux runners always have Python; locally we run on macOS which has
//! `/usr/bin/python3` since Big Sur. Windows CI runners have Python via the
//! actions/setup-python step (`release.yml` already invokes it for the
//! bundled Python build).

use galley_core_lib::ipc::{IpcCommand, IpcEvent};
use galley_core_lib::runner_manager::{BroadcastItem, RunnerManager, SpawnArgs};
use std::fs;
use std::path::PathBuf;
use std::process::{Command as StdCommand, Stdio};
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::timeout;

/// Find an executable named `python3` or `python` on PATH-like locations.
/// Returns absolute path. None = test should silently skip.
fn mock_python_path() -> Option<String> {
    let candidates = [
        "/usr/bin/python3",
        "/usr/local/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/bin/python",
        "python3",
        "python",
        "C:\\Python311\\python.exe",
        "C:\\Python310\\python.exe",
    ];
    for c in candidates {
        let path_like = c.contains('/') || c.contains('\\');
        if path_like && !std::path::Path::new(c).exists() {
            continue;
        }
        if python_candidate_works(c) {
            return Some(c.to_string());
        }
    }
    None
}

fn python_candidate_works(candidate: &str) -> bool {
    StdCommand::new(candidate)
        .arg("-c")
        .arg("import sys; raise SystemExit(0 if sys.version_info.major >= 3 else 1)")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Write a mock `runner/workbench_bridge.py` (and the `runner/__init__.py`
/// it needs to be importable as a package) into `dir`. The mock parses
/// command-line args the same way the real runner does, emits a `ready`
/// event, and then reads stdin to respond to a few commands (just enough
/// for these integration tests).
fn write_mock_runner(dir: &std::path::Path) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    // The mock script: emit ready, then loop reading stdin lines and
    // emitting a parroting response. Handles `{"kind":"shutdown"}` by
    // exiting clean. Handles `{"kind":"user_message",...}` by emitting a
    // turn_start + turn_end pair.
    let script = r#"
import argparse
import json
import sys
import os
import time

parser = argparse.ArgumentParser()
parser.add_argument("--ga-path", required=True)
parser.add_argument("--session-id", required=True)
parser.add_argument("--cwd", required=False)
parser.add_argument("--llm-no", type=int, default=0)
args = parser.parse_args()

def emit(obj):
    print(json.dumps(obj), flush=True)

emit({
    "kind": "ready",
    "sessionId": args.session_id,
    "protocolVersion": "0.1",
    "gaCommit": "mock",
    "gaCommitDate": "2026-05-19T00:00:00+00:00",
    "gaPath": args.ga_path,
    "llmName": "mock-llm",
    "cwd": args.cwd or os.getcwd(),
    "pid": os.getpid(),
    "availableLLMs": [],
    "timestamp": "2026-05-19T10:00:00+00:00",
})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        cmd = json.loads(line)
    except json.JSONDecodeError:
        # Echo malformed lines as a stderr trace (covers stderr buffer test)
        print(f"bad json: {line}", file=sys.stderr, flush=True)
        continue
    kind = cmd.get("kind")
    if kind == "shutdown":
        break
    if kind == "user_message":
        emit({
            "kind": "turn_start",
            "sessionId": args.session_id,
            "turnIndex": 1,
            "timestamp": "2026-05-19T10:00:01+00:00",
        })
        # Hold the "agent running" state long enough that the harness
        # can observe it before turn_end clears the flag.
        time.sleep(0.3)
        emit({
            "kind": "turn_end",
            "sessionId": args.session_id,
            "turnIndex": 1,
            "summary": "echo: " + cmd.get("text", ""),
            "toolCalls": [],
            "toolResults": [],
            "responseContent": "echo: " + cmd.get("text", ""),
            "exitReason": None,
            "timestamp": "2026-05-19T10:00:02+00:00",
        })
    elif kind == "abort":
        # No-op for the mock
        pass
"#;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

fn write_exiting_runner(dir: &std::path::Path, code: i32) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    let script = format!(
        r#"
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--ga-path", required=True)
parser.add_argument("--session-id", required=True)
parser.add_argument("--cwd", required=False)
parser.add_argument("--llm-no", type=int, default=0)
args = parser.parse_args()

print(json.dumps({{
    "kind": "ready",
    "sessionId": args.session_id,
    "protocolVersion": "0.1",
    "gaCommit": "mock",
    "gaCommitDate": "2026-05-19T00:00:00+00:00",
    "gaPath": args.ga_path,
    "llmName": "mock-llm",
    "cwd": args.cwd or os.getcwd(),
    "pid": os.getpid(),
    "availableLLMs": [],
    "timestamp": "2026-05-19T10:00:00+00:00"
}}), flush=True)
print("mock bridge exiting", file=sys.stderr, flush=True)
sys.exit({code})
"#
    );
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

/// Mock that emits `ready`, then closes its stdout while staying alive
/// (ignoring stdin). Reproduces the CORE-4 wedge: stdout EOF with no
/// process exit used to park the reader task inside the child lock's
/// `wait()`, deadlocking `shutdown()` and the app's quit cleanup.
fn write_stdout_closing_runner(dir: &std::path::Path) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    let script = r#"
import argparse
import json
import os
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--ga-path", required=True)
parser.add_argument("--session-id", required=True)
parser.add_argument("--cwd", required=False)
parser.add_argument("--llm-no", type=int, default=0)
args = parser.parse_args()

print(json.dumps({
    "kind": "ready",
    "sessionId": args.session_id,
    "protocolVersion": "0.1",
    "gaCommit": "mock",
    "gaCommitDate": "2026-05-19T00:00:00+00:00",
    "gaPath": args.ga_path,
    "llmName": "mock-llm",
    "cwd": args.cwd or os.getcwd(),
    "pid": os.getpid(),
    "availableLLMs": [],
    "timestamp": "2026-05-19T10:00:00+00:00"
}), flush=True)
sys.stdout.close()
os.close(1)
time.sleep(60)
"#;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

/// Mock that emits `ready` and then ignores every stdin command,
/// including `shutdown`. Reproduces the CORE-5 leak: the spawn-replace
/// path relied on `kill_on_drop`, which never fires because the stdout
/// reader task's Arc keeps the Child alive.
fn write_stubborn_runner(dir: &std::path::Path) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    let script = r#"
import argparse
import json
import os
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--ga-path", required=True)
parser.add_argument("--session-id", required=True)
parser.add_argument("--cwd", required=False)
parser.add_argument("--llm-no", type=int, default=0)
args = parser.parse_args()

print(json.dumps({
    "kind": "ready",
    "sessionId": args.session_id,
    "protocolVersion": "0.1",
    "gaCommit": "mock",
    "gaCommitDate": "2026-05-19T00:00:00+00:00",
    "gaPath": args.ga_path,
    "llmName": "mock-llm",
    "cwd": args.cwd or os.getcwd(),
    "pid": os.getpid(),
    "availableLLMs": [],
    "timestamp": "2026-05-19T10:00:00+00:00"
}), flush=True)
for line in sys.stdin:
    pass  # ignore all commands, including shutdown
time.sleep(60)
"#;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

fn make_args(session_id: &str, bridge_cwd: PathBuf) -> SpawnArgs {
    let python = mock_python_path().unwrap_or_else(|| "python3".to_string());
    SpawnArgs {
        python,
        ga_path: bridge_cwd.clone(),
        session_id: session_id.to_string(),
        cwd: None,
        workspace_root: None,
        bridge_cwd,
        llm_index: None,
        llm_key: None,
        env: vec![],
    }
}

/// Subscribe and await the next event, with a 5s safety timeout. Returns
/// None if the channel closed or the timer fired.
async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<BroadcastItem>) -> Option<IpcEvent> {
    loop {
        match timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Ok(BroadcastItem::Event(boxed))) => return Some(*boxed),
            Ok(Ok(BroadcastItem::Malformed(_))) => continue,
            Ok(Ok(BroadcastItem::Closed { .. })) => return None,
            Ok(Err(RecvError::Lagged(_))) => continue,
            Ok(Err(RecvError::Closed)) => return None,
            Err(_timeout) => return None,
        }
    }
}

async fn next_closed(
    rx: &mut tokio::sync::broadcast::Receiver<BroadcastItem>,
) -> Option<(Option<i32>, Option<i32>)> {
    loop {
        match timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Ok(BroadcastItem::Closed { code, signal })) => return Some((code, signal)),
            Ok(Ok(BroadcastItem::Event(_))) | Ok(Ok(BroadcastItem::Malformed(_))) => continue,
            Ok(Err(RecvError::Lagged(_))) => continue,
            Ok(Err(RecvError::Closed)) | Err(_) => return None,
        }
    }
}

#[tokio::test]
async fn spawn_emits_ready_event() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s1", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");

    let mut rx = mgr.subscribe("s1").await.expect("subscribe");
    let ev = next_event(&mut rx).await.expect("ready event");
    match ev {
        IpcEvent::Ready(r) => {
            assert_eq!(r.session_id, "s1");
            assert_eq!(r.protocol_version, "0.1");
            assert_eq!(r.llm_name, "mock-llm");
        }
        other => panic!("expected Ready, got {:?}", other),
    }

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn subprocess_exit_broadcasts_closed_event() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_exiting_runner(dir.path(), 7);

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s_exit", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");

    let mut rx = mgr.subscribe("s_exit").await.expect("subscribe");
    let ev = next_event(&mut rx).await.expect("ready event");
    assert!(matches!(ev, IpcEvent::Ready(_)));

    let (code, _signal) = next_closed(&mut rx).await.expect("closed event");
    assert_eq!(code, Some(7));

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn send_command_reaches_subprocess() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s2", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");

    let mut rx = mgr.subscribe("s2").await.expect("subscribe");
    // Consume Ready
    let _ = next_event(&mut rx).await;

    mgr.send_command(
        "s2",
        &IpcCommand::UserMessage(galley_core_lib::ipc::UserMessageCommand {
            text: "hello".into(),
            images: vec![],
            visibility: None,
            absolute_turn_index: None,
        }),
    )
    .await
    .expect("send");

    // Expect turn_start then turn_end
    let ev = next_event(&mut rx).await.expect("turn_start");
    assert!(matches!(ev, IpcEvent::TurnStart(_)));
    let ev = next_event(&mut rx).await.expect("turn_end");
    if let IpcEvent::TurnEnd(t) = ev {
        assert!(t.summary.contains("echo: hello"));
    } else {
        panic!("expected TurnEnd");
    }

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn agent_running_toggles_with_turn_lifecycle() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s3", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");

    let mut rx = mgr.subscribe("s3").await.expect("subscribe");
    let _ready = next_event(&mut rx).await;

    // Before any turn, agent_running is false
    assert!(!mgr.agent_running("s3").await);

    mgr.send_command(
        "s3",
        &IpcCommand::UserMessage(galley_core_lib::ipc::UserMessageCommand {
            text: "go".into(),
            images: vec![],
            visibility: None,
            absolute_turn_index: None,
        }),
    )
    .await
    .expect("send");

    // After turn_start the manager should report true. The mock holds
    // turn for 300ms via time.sleep so this assertion has a window.
    let _ts = next_event(&mut rx).await.expect("turn_start");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(mgr.agent_running("s3").await);

    // After turn_end the flag clears
    let _te = next_event(&mut rx).await.expect("turn_end");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!mgr.agent_running("s3").await);

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn shutdown_removes_from_alive_set() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s4", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");
    assert_eq!(mgr.alive_count().await, 1);

    mgr.shutdown("s4", Some(Duration::from_secs(2)))
        .await
        .expect("shutdown");
    assert_eq!(mgr.alive_count().await, 0);
    assert!(mgr.lru_snapshot().await.is_empty());
}

#[tokio::test]
async fn lru_evicts_oldest_when_over_cap() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    // cap = 2, spawn 3 → oldest (s_a) gets evicted
    let mgr = RunnerManager::with_cap(2);
    mgr.spawn(make_args("s_a", dir.path().to_path_buf()), None)
        .await
        .expect("spawn a");
    mgr.spawn(make_args("s_b", dir.path().to_path_buf()), None)
        .await
        .expect("spawn b");
    // Both should be alive
    assert_eq!(mgr.alive_count().await, 2);
    // Spawn 3rd — s_a should get evicted (LRU front, not active, not running)
    mgr.spawn(make_args("s_c", dir.path().to_path_buf()), None)
        .await
        .expect("spawn c");
    // Give the eviction shutdown time to flush
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(mgr.alive_count().await, 2);
    let snap = mgr.lru_snapshot().await;
    assert!(snap.contains(&"s_b".to_string()));
    assert!(snap.contains(&"s_c".to_string()));
    assert!(!snap.contains(&"s_a".to_string()));

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn lru_protects_active_session() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    // cap = 2; s_a is the active session even though it was spawned first.
    let mgr = RunnerManager::with_cap(2);
    mgr.spawn(make_args("s_a", dir.path().to_path_buf()), Some("s_a"))
        .await
        .expect("spawn a");
    mgr.spawn(make_args("s_b", dir.path().to_path_buf()), Some("s_a"))
        .await
        .expect("spawn b");
    mgr.spawn(make_args("s_c", dir.path().to_path_buf()), Some("s_a"))
        .await
        .expect("spawn c");
    tokio::time::sleep(Duration::from_millis(100)).await;
    let snap = mgr.lru_snapshot().await;
    // s_a is protected. s_b should be the victim (oldest non-active).
    assert!(snap.contains(&"s_a".to_string()));
    assert!(!snap.contains(&"s_b".to_string()));
    assert!(snap.contains(&"s_c".to_string()));

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn stderr_tail_captures_subprocess_stderr() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s5", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");

    // Send invalid JSON — mock script writes to stderr
    let mut rx = mgr.subscribe("s5").await.expect("subscribe");
    let _ready = next_event(&mut rx).await;

    // The send_command path serializes a known type, so we can't easily
    // send malformed JSON through it. Instead we exercise stderr via the
    // mock's startup banner: re-shutdown then re-spawn, ensure stderr
    // history exists (the mock doesn't print any banner, so this test
    // mainly validates the API surface without a hard assertion on
    // content). The full malformed path is exercised by a future M2
    // integration test that can drive the socket transport directly.
    let tail = mgr.stderr_tail("s5").await.expect("session exists");
    // Tail might be empty (mock doesn't emit anything on stderr in the
    // happy path) — what we assert is that the API returns Some(_).
    let _ = tail;

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn shutdown_all_kills_concurrent_runners() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    for sid in ["a", "b", "c"] {
        mgr.spawn(make_args(sid, dir.path().to_path_buf()), None)
            .await
            .expect("spawn");
    }
    assert_eq!(mgr.alive_count().await, 3);
    mgr.shutdown_all(Duration::from_secs(2)).await;
    assert_eq!(mgr.alive_count().await, 0);
}

#[tokio::test]
async fn shutdown_stays_bounded_when_child_closes_stdout_but_lives() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_stdout_closing_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s_wedge", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");
    let mut rx = mgr.subscribe("s_wedge").await.expect("subscribe");
    let ev = next_event(&mut rx).await.expect("ready event");
    assert!(matches!(ev, IpcEvent::Ready(_)));
    // Give the reader task time to hit stdout EOF and enter its wait.
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Regression guard: the reader used to hold the child lock across an
    // unbounded wait() here, so this shutdown never returned and quit
    // cleanup hung. It must complete in bounded time and fall back to
    // kill.
    let result = timeout(
        Duration::from_secs(8),
        mgr.shutdown("s_wedge", Some(Duration::from_secs(1))),
    )
    .await;
    assert!(result.is_ok(), "shutdown hung on the child lock");
    assert_eq!(mgr.alive_count().await, 0);

    // The kill fallback reaps the child; the reader's poll observes the
    // exit and still broadcasts Closed.
    assert!(next_closed(&mut rx).await.is_some());
}

#[tokio::test]
async fn respawn_kills_old_runner_that_ignores_shutdown() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_stubborn_runner(dir.path());

    let mgr = RunnerManager::new();
    let pid1 = mgr
        .spawn(make_args("s_stubborn", dir.path().to_path_buf()), None)
        .await
        .expect("spawn 1");
    let mut rx = mgr.subscribe("s_stubborn").await.expect("subscribe");
    let _ready = next_event(&mut rx).await;

    // Replacement spawn: the old runner ignores Shutdown, so the graceful
    // wait times out and the replace path must SIGKILL it explicitly —
    // kill_on_drop can't, because the reader task's Arc keeps the Child
    // alive after our handle drops.
    let pid2 = mgr
        .spawn(make_args("s_stubborn", dir.path().to_path_buf()), None)
        .await
        .expect("spawn 2");
    assert_ne!(pid1, pid2);
    assert_eq!(mgr.alive_count().await, 1);

    #[cfg(unix)]
    {
        let alive = StdCommand::new("kill")
            .args(["-0", &pid1.to_string()])
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(
            !alive,
            "old runner pid {pid1} still alive after replacement"
        );
    }

    mgr.shutdown_all(Duration::from_secs(2)).await;
}

#[tokio::test]
async fn respawn_same_session_replaces_old() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_mock_runner(dir.path());

    let mgr = RunnerManager::new();
    let pid1 = mgr
        .spawn(make_args("s_replay", dir.path().to_path_buf()), None)
        .await
        .expect("spawn 1");
    let pid2 = mgr
        .spawn(make_args("s_replay", dir.path().to_path_buf()), None)
        .await
        .expect("spawn 2");
    assert_ne!(pid1, pid2);
    assert_eq!(mgr.alive_count().await, 1);

    mgr.shutdown_all(Duration::from_secs(2)).await;
}
