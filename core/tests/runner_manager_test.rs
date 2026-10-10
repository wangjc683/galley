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
        reasoning_effort: None,
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
            Ok(Ok(BroadcastItem::Closed { code, signal, .. })) => return Some((code, signal)),
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

/// Mock that emits `ready`, then sleeps forever WITHOUT reading stdin.
/// Reproduces the CONC-1 trigger (concurrency audit 2026-07-04): a child
/// that is alive but not draining stdin, so writes larger than the OS pipe
/// buffer park forever.
fn write_stdin_ignoring_runner(dir: &std::path::Path) {
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

# Never read stdin; stay alive until killed.
while True:
    time.sleep(3600)
"#;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

fn huge_user_message() -> IpcCommand {
    // Comfortably larger than any OS pipe buffer (64KB-1MB) so the write
    // parks on a child that never reads stdin.
    IpcCommand::UserMessage(galley_core_lib::ipc::UserMessageCommand {
        text: "x".repeat(4 * 1024 * 1024),
        images: vec![],
        visibility: None,
        absolute_turn_index: None,
    })
}

/// CONC-1 defect B regression: a wedged child (alive, not reading stdin)
/// with a full pipe buffer must NOT park `send_command` forever — the
/// stdin write is bounded by `STDIN_WRITE_TIMEOUT` (15s) and surfaces as
/// `WriteIo`.
#[tokio::test]
async fn send_command_times_out_when_child_stops_reading() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_stdin_ignoring_runner(dir.path());

    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s_wedged", dir.path().to_path_buf()), None)
        .await
        .expect("spawn");
    let mut rx = mgr.subscribe("s_wedged").await.expect("subscribe");
    let ev = next_event(&mut rx).await.expect("ready event");
    assert!(matches!(ev, IpcEvent::Ready(_)));

    // 15s write timeout + margin. Before the fix this call never returned.
    let result = timeout(
        Duration::from_secs(25),
        mgr.send_command("s_wedged", &huge_user_message()),
    )
    .await;
    let inner = result.expect("send_command must return in bounded time");
    assert!(
        inner.is_err(),
        "write into a non-reading child must surface an error"
    );

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

/// CONC-1 defect A regression: while session A's per-session Mutex is held
/// (wedged stdin write) and readers/writers are queued on it, operations on
/// OTHER sessions must still proceed. Before the fix, `subscribe`/`pid`/
/// `agent_running` parked on A's Mutex while holding the manager map's read
/// guard; one queued `spawn` (write lock, write-preferring RwLock) then
/// stalled every session's commands.
#[tokio::test]
async fn wedged_session_does_not_block_other_sessions() {
    if mock_python_path().is_none() {
        return;
    }
    let dir = TempDir::new().expect("tempdir");
    write_stdin_ignoring_runner(dir.path());
    let dir_ok = TempDir::new().expect("tempdir");
    write_mock_runner(dir_ok.path());

    let mgr = std::sync::Arc::new(RunnerManager::new());
    mgr.spawn(make_args("s_a", dir.path().to_path_buf()), None)
        .await
        .expect("spawn a");
    let mut rx_a = mgr.subscribe("s_a").await.expect("subscribe a");
    let _ = next_event(&mut rx_a).await.expect("ready a");
    mgr.spawn(make_args("s_b", dir_ok.path().to_path_buf()), None)
        .await
        .expect("spawn b");
    let mut rx_b = mgr.subscribe("s_b").await.expect("subscribe b");
    let _ = next_event(&mut rx_b).await.expect("ready b");

    // Wedge A: this parks inside the stdin write holding A's per-session
    // Mutex (until the 15s timeout, far longer than this test's asserts).
    let mgr_wedge = mgr.clone();
    tokio::spawn(async move {
        let _ = mgr_wedge.send_command("s_a", &huge_user_message()).await;
    });
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Queue a reader on A's Mutex (would hold the map read guard before
    // the fix) and a writer on the map (spawn of a third session).
    let mgr_sub = mgr.clone();
    tokio::spawn(async move {
        let _ = mgr_sub.subscribe("s_a").await;
    });
    let mgr_spawn = mgr.clone();
    let dir_c = dir_ok.path().to_path_buf();
    tokio::spawn(async move {
        let _ = mgr_spawn.spawn(make_args("s_c", dir_c), None).await;
    });
    tokio::time::sleep(Duration::from_millis(300)).await;

    // The victim assertion: session B's command path must stay live.
    let result = timeout(
        Duration::from_secs(5),
        mgr.send_command(
            "s_b",
            &IpcCommand::UserMessage(galley_core_lib::ipc::UserMessageCommand {
                text: "still alive?".into(),
                images: vec![],
                visibility: None,
                absolute_turn_index: None,
            }),
        ),
    )
    .await;
    assert!(
        result.is_ok(),
        "session B's send_command stalled behind session A's wedge"
    );
    assert!(result.unwrap().is_ok(), "send to healthy session failed");

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

// ---------------- Core-owned turn persistence (2026-10-07) ----------------
//
// No GUI anywhere below: no emit task, no Tauri listener. The rows and
// session bumps must still land — before 2026-10-07 only a GUI page
// receiving `runner-event` wrote them, so a webview reload lost whole
// runs. Each test runs the real RunnerManager watcher against a
// file-backed SQLite configured like production (WAL, busy_timeout).

use galley_core_lib::api::{GalleyApi, MessageVisibility, Origin, OriginVia, SessionId};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::UserMessageCommand;
use galley_core_lib::runner_manager::RunSignal;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use tokio::sync::mpsc;

/// Mock runner that plays a scripted run per `user_message` text and
/// echoes the dispatch's `absoluteTurnIndex` / `visibility` the way the
/// real bridge does (`base + step - 1`).
fn write_persisting_runner(dir: &std::path::Path) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    let script = r##"
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

def emit(obj):
    obj["sessionId"] = args.session_id
    obj.setdefault("timestamp", "2026-10-07T00:00:00+00:00")
    # ASCII-escaped JSON: a Windows pipe defaults to the ANSI code page.
    print(json.dumps(obj), flush=True)

emit({"kind": "ready", "protocolVersion": "0.1", "gaCommit": "mock",
      "gaCommitDate": "2026-10-07T00:00:00+00:00", "gaPath": args.ga_path,
      "llmName": "mock-llm", "cwd": os.getcwd(), "pid": os.getpid(),
      "availableLLMs": []})

# Keys in byte order: Core's maps iterate that way with or without
# serde_json's preserve_order, so the asserted JSON is build-independent.
READ = [{"args": {"path": "README.md", "timeout": 30.0},
         "toolName": "file_read", "toolUseId": "call-r"}]
READ_RESULT = [{"toolUseId": "call-r", "content": "# Galley"}]

def turn_end(step, base, vis, summary, content, tools=None, results=None,
             exit_reason=None, telemetry=None):
    event = {"kind": "turn_end", "turnIndex": step, "summary": summary,
             "toolCalls": tools or [], "toolResults": results or [],
             "responseContent": content, "exitReason": exit_reason,
             "visibility": vis,
             "absoluteTurnIndex": None if base is None else base + step - 1}
    if telemetry:
        event["telemetry"] = telemetry
    emit(event)

def run_complete(result, vis):
    emit({"kind": "run_complete", "exitReason": {"result": result, "data": None},
          "finalContent": "", "totalTurns": 1, "visibility": vis})

for line in sys.stdin:
    try:
        cmd = json.loads(line)
    except ValueError:
        continue
    kind = cmd.get("kind")
    if kind == "shutdown":
        break
    if kind != "user_message":
        continue
    text = cmd.get("text", "")
    base = cmd.get("absoluteTurnIndex")
    vis = cmd.get("visibility") or "visible"
    emit({"kind": "turn_start", "turnIndex": 1, "visibility": vis})
    if text.startswith("run:"):
        steps = int(text.split(":")[1])
        for step in range(1, steps):
            turn_end(step, base, vis, "第 %d 步" % step,
                     "当前阶段：读文件 %d。" % step, READ, READ_RESULT)
            emit({"kind": "turn_start", "turnIndex": step + 1, "visibility": vis})
        turn_end(steps, base, vis, "给出答案",
                 "<thinking>想一想</thinking>答案是 42。<summary>给出答案</summary>",
                 exit_reason={"result": "CURRENT_TASK_DONE", "data": None},
                 telemetry={"elapsedMs": 1200, "requestCount": steps})
        run_complete("CURRENT_TASK_DONE", vis)
    elif text == "ask":
        ask = [{"toolName": "ask_user", "toolUseId": "call-ask",
                "args": {"question": "选哪个？", "candidates": ["A", "B"]}}]
        turn_end(1, base, vis, "询问用户", "两个都行，我需要你定。", ask,
                 [{"toolUseId": "call-ask", "content": "waiting"}],
                 exit_reason={"result": "EXITED", "data": {"status": "INTERRUPT"}})
        emit({"kind": "ask_user", "question": "选哪个？", "candidates": ["A", "B"]})
        run_complete("EXITED", vis)
    elif text == "limit":
        turn_end(1, base, vis, "第 1 步", "继续。", READ, READ_RESULT)
        turn_end(2, base, vis, "第 2 步", "还没完。", READ, READ_RESULT,
                 exit_reason={"result": "MAX_TURNS_EXCEEDED", "data": {"maxTurns": 2}})
        run_complete("MAX_TURNS_EXCEEDED", vis)
    elif text == "nofinal":
        turn_end(1, base, vis, "第 1 步", "读文件。", READ, READ_RESULT)
        emit({"kind": "error", "message": "task loop crashed", "category": "runtime",
              "severity": "error", "retryable": False, "hint": None,
              "context": "task_end", "traceback": None})
        run_complete("DONE_WITHOUT_EXIT", vis)
    elif text == "release":
        # Ends the turn a "hold" left going (any other text only starts
        # one and leaves it open).
        turn_end(1, base, vis, "收尾", "好了。",
                 exit_reason={"result": "CURRENT_TASK_DONE", "data": None})
        run_complete("CURRENT_TASK_DONE", vis)
"##;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

/// File-backed DB with the production pragmas and the full runtime
/// migration list.
async fn persistence_db() -> (TempDir, SqlitePool, SqliteGalley) {
    let dir = TempDir::new().expect("tempdir");
    let opts = SqliteConnectOptions::new()
        .filename(dir.path().join("workbench.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await
        .expect("open sqlite");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool.clone());
    (dir, pool, galley)
}

async fn seed_session(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO sessions (id, title, status, turn_count, pending_approval_count, \
            error_count, pinned, last_activity_at, created_at, updated_at) \
         VALUES (?, ?, 'idle', 0, 0, 0, 0, ?, ?, ?)",
    )
    .bind(id)
    .bind(format!("title-{id}"))
    .bind("2026-10-07T00:00:00Z")
    .bind("2026-10-07T00:00:00Z")
    .bind("2026-10-07T00:00:00Z")
    .execute(pool)
    .await
    .expect("seed session");
}

/// A manager wired the way `app_setup` wires it: turn store + drain
/// signal (the test stands in for the drain task).
fn persisting_manager(
    galley: &SqliteGalley,
) -> (RunnerManager, mpsc::UnboundedReceiver<RunSignal>) {
    let mgr = RunnerManager::new();
    mgr.set_turn_store(galley.clone(), galley_core_lib::notify::NullNotifier::arc());
    let (tx, rx) = mpsc::unbounded_channel();
    mgr.set_run_signal(tx);
    (mgr, rx)
}

/// Persist the user row (as every dispatch path does) and send the
/// message carrying its turn index, like the GUI / socket / queue do.
async fn dispatch(
    mgr: &RunnerManager,
    galley: &SqliteGalley,
    sid: &str,
    text: &str,
    visibility: MessageVisibility,
) -> u32 {
    let user = galley
        .send_message_with_visibility(
            SessionId(sid.into()),
            text.into(),
            Origin {
                via: OriginVia::Cli,
                supervisor: None,
                reason: None,
                client: None,
            },
            visibility,
        )
        .await
        .expect("persist user row");
    let base = user.turn_index.expect("user row turn index");
    mgr.send_command(
        sid,
        &IpcCommand::UserMessage(UserMessageCommand {
            text: text.into(),
            images: vec![],
            visibility: (visibility == MessageVisibility::Internal).then(|| "internal".into()),
            absolute_turn_index: Some(i64::from(base)),
        }),
    )
    .await
    .expect("send user_message");
    base
}

/// The next `RunComplete` signal, skipping `UserRunStarted`.
async fn next_run_complete(signals: &mut mpsc::UnboundedReceiver<RunSignal>) -> String {
    loop {
        let signal = timeout(Duration::from_secs(10), signals.recv())
            .await
            .expect("run_complete within 10s")
            .expect("signal channel open");
        if let RunSignal::RunComplete { session_id } = signal {
            return session_id;
        }
    }
}

async fn assistant_rows(
    galley: &SqliteGalley,
    sid: &str,
) -> Vec<galley_core_lib::db::PersistedMessageRow> {
    galley
        .persisted_message_rows(&SessionId(sid.into()))
        .await
        .expect("read rows")
        .into_iter()
        .filter(|row| row.role == "assistant")
        .collect()
}

async fn turn_count(galley: &SqliteGalley, sid: &str) -> u32 {
    galley
        .session_brief(SessionId(sid.into()))
        .await
        .expect("session brief")
        .turn_count
        .unwrap_or(0)
}

async fn spawn_persisting(mgr: &RunnerManager, sid: &str, dir: &std::path::Path) {
    mgr.spawn(make_args(sid, dir.to_path_buf()), None)
        .await
        .expect("spawn mock runner");
}

#[tokio::test]
async fn core_persists_every_turn_without_a_gui() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    seed_session(&pool, "s-run").await;
    let (mgr, mut signals) = persisting_manager(&galley);
    spawn_persisting(&mgr, "s-run", bridge.path()).await;

    let base = dispatch(&mgr, &galley, "s-run", "run:3", MessageVisibility::Visible).await;
    assert_eq!(next_run_complete(&mut signals).await, "s-run");

    // Read right after the gate-closing signal, no grace: the watcher
    // writes a run's rows before it settles that run's RunComplete.
    let rows = assistant_rows(&galley, "s-run").await;
    assert_eq!(rows.len(), 3, "one row per turn_end: {rows:#?}");
    assert_eq!(
        rows.iter().map(|r| r.turn_index).collect::<Vec<_>>(),
        vec![i64::from(base), i64::from(base) + 1, i64::from(base) + 2],
        "absolute turn index = user row + step - 1"
    );
    assert_eq!(rows[0].id, format!("msg_s-run_{base}_assistant"));
    // Intermediate tool step: preamble, no final answer, GUI-shaped JSON.
    assert_eq!(rows[0].final_answer, None);
    assert_eq!(rows[0].preamble.as_deref(), Some("当前阶段：读文件 1。"));
    assert_eq!(rows[0].summary.as_deref(), Some("第 1 步"));
    assert_eq!(
        rows[0].tool_calls.as_deref(),
        Some(
            r#"[{"args":{"path":"README.md","timeout":30},"toolName":"file_read","toolUseId":"call-r"}]"#
        )
    );
    // The final answer: derived exactly as the GUI rendered it.
    let last = &rows[2];
    assert_eq!(last.final_answer.as_deref(), Some("答案是 42。"));
    assert_eq!(last.thinking.as_deref(), Some("想一想"));
    assert_eq!(last.summary.as_deref(), Some("给出答案"));
    assert_eq!(last.preamble, None);
    assert_eq!(last.visibility, "visible");
    let telemetry = last.telemetry.as_ref().expect("telemetry persisted");
    assert_eq!(telemetry.elapsed_ms, Some(1200));
    assert_eq!(telemetry.request_count, Some(3));

    // The session bump the GUI used to make.
    let brief = galley
        .session_brief(SessionId("s-run".into()))
        .await
        .unwrap();
    assert_eq!(brief.turn_count, Some(3));
    assert_eq!(brief.summary.as_deref(), Some("给出答案"));
    assert_eq!(brief.has_unread, Some(false), "unread stays the GUI's call");

    // What `session wait` / `session show` read: the real final answer.
    let messages = galley
        .session_messages(SessionId("s-run".into()), Some(1))
        .await
        .unwrap();
    assert_eq!(messages[0].final_answer.as_deref(), Some("答案是 42。"));

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn core_persists_ask_user_step_limit_and_done_without_exit_runs() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    seed_session(&pool, "s-end").await;
    let (mgr, mut signals) = persisting_manager(&galley);
    spawn_persisting(&mgr, "s-end", bridge.path()).await;

    // ask_user: the asking step lands, and the read side sees the question.
    let ask_base = dispatch(&mgr, &galley, "s-end", "ask", MessageVisibility::Visible).await;
    next_run_complete(&mut signals).await;
    let rows = assistant_rows(&galley, "s-end").await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].turn_index, i64::from(ask_base));
    assert_eq!(
        rows[0].final_answer.as_deref(),
        Some("两个都行，我需要你定。")
    );
    let messages = galley
        .session_messages(SessionId("s-end".into()), None)
        .await
        .unwrap();
    let asking = messages.last().expect("asking row");
    assert_eq!(
        asking.ask_user.as_ref().map(|a| a.question.as_str()),
        Some("选哪个？")
    );
    assert_eq!(turn_count(&galley, "s-end").await, 1);

    // The answer arrives as the next message; a step-limit stop lands
    // both steps, the half-done last one included.
    let limit_base = dispatch(&mgr, &galley, "s-end", "limit", MessageVisibility::Visible).await;
    next_run_complete(&mut signals).await;
    let rows = assistant_rows(&galley, "s-end").await;
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[2].turn_index, i64::from(limit_base) + 1);
    assert_eq!(rows[2].final_answer.as_deref(), Some("还没完。"));
    assert_eq!(rows[2].summary.as_deref(), Some("第 2 步"));
    assert_eq!(turn_count(&galley, "s-end").await, 3);

    // DONE_WITHOUT_EXIT: no final turn_end, but the step before the
    // crash is persisted.
    let nofinal_base = dispatch(
        &mgr,
        &galley,
        "s-end",
        "nofinal",
        MessageVisibility::Visible,
    )
    .await;
    next_run_complete(&mut signals).await;
    let rows = assistant_rows(&galley, "s-end").await;
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[3].turn_index, i64::from(nofinal_base));
    assert_eq!(rows[3].final_answer.as_deref(), Some("读文件。"));
    assert_eq!(turn_count(&galley, "s-end").await, 4);

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn internal_turns_are_persisted_without_bumping_the_session() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    seed_session(&pool, "s-int").await;
    let (mgr, mut signals) = persisting_manager(&galley);
    spawn_persisting(&mgr, "s-int", bridge.path()).await;

    let base = dispatch(&mgr, &galley, "s-int", "run:2", MessageVisibility::Internal).await;
    next_run_complete(&mut signals).await;

    // Hidden from the visible read path, present in the table.
    assert!(assistant_rows(&galley, "s-int").await.is_empty());
    let internal: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT turn_index, visibility, final_answer FROM messages \
         WHERE session_id = ? AND role = 'assistant' ORDER BY turn_index",
    )
    .bind("s-int")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        internal,
        vec![
            (i64::from(base), "internal".to_string(), None),
            (
                i64::from(base) + 1,
                "internal".to_string(),
                Some("答案是 42。".to_string())
            ),
        ]
    );
    // Like the GUI: internal traffic never moves the sidebar.
    let brief = galley
        .session_brief(SessionId("s-int".into()))
        .await
        .unwrap();
    assert_eq!(brief.turn_count, Some(0));
    assert_eq!(brief.summary, None);

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn turn_without_absolute_index_keys_on_the_latest_user_row() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    seed_session(&pool, "s-fb").await;
    let (mgr, mut signals) = persisting_manager(&galley);
    spawn_persisting(&mgr, "s-fb", bridge.path()).await;

    // Three earlier user rows (turns 0, 1, 2), then a dispatch that
    // omits the index.
    for text in ["first", "second", "third"] {
        galley
            .send_message(
                SessionId("s-fb".into()),
                text.into(),
                Origin {
                    via: OriginVia::Cli,
                    supervisor: None,
                    reason: None,
                    client: None,
                },
            )
            .await
            .unwrap();
    }
    mgr.send_command(
        "s-fb",
        &IpcCommand::UserMessage(UserMessageCommand {
            text: "run:2".into(),
            images: vec![],
            visibility: None,
            absolute_turn_index: None,
        }),
    )
    .await
    .unwrap();
    next_run_complete(&mut signals).await;

    let rows = assistant_rows(&galley, "s-fb").await;
    // Latest user row is turn 2 ("third"): steps land on 2 and 3, the
    // runner's own `base + step - 1` — not on the bare steps 1 and 2.
    assert_eq!(
        rows.iter().map(|r| r.turn_index).collect::<Vec<_>>(),
        vec![2, 3]
    );

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn concurrent_runners_persist_independently() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    let sids = ["s-c1", "s-c2", "s-c3", "s-c4"];
    for sid in sids {
        seed_session(&pool, sid).await;
    }
    let (mgr, mut signals) = persisting_manager(&galley);
    let mgr = std::sync::Arc::new(mgr);
    for sid in sids {
        spawn_persisting(&mgr, sid, bridge.path()).await;
    }

    // All four runs in flight at once, each writing through the same pool.
    let mut sends = Vec::new();
    for (i, sid) in sids.iter().enumerate() {
        let mgr = mgr.clone();
        let galley = galley.clone();
        let sid = sid.to_string();
        sends.push(tokio::spawn(async move {
            dispatch(
                &mgr,
                &galley,
                &sid,
                &format!("run:{}", i + 3),
                MessageVisibility::Visible,
            )
            .await
        }));
    }
    for send in sends {
        send.await.expect("dispatch task");
    }
    let mut completed = Vec::new();
    for _ in sids {
        completed.push(next_run_complete(&mut signals).await);
    }
    completed.sort();
    assert_eq!(completed, sids.to_vec());

    for (i, sid) in sids.iter().enumerate() {
        let steps = i + 3;
        let rows = assistant_rows(&galley, sid).await;
        assert_eq!(rows.len(), steps, "{sid}: one row per step");
        assert!(
            rows.iter().all(|r| r.session_id == *sid),
            "{sid}: no cross-talk"
        );
        assert_eq!(
            rows.last().unwrap().final_answer.as_deref(),
            Some("答案是 42。")
        );
        assert_eq!(
            turn_count(&galley, sid).await,
            steps as u32,
            "{sid}: turn_count"
        );
    }

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn live_runners_lists_every_alive_runner_with_its_pid() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_mock_runner(bridge.path());
    let mgr = RunnerManager::new();
    assert!(mgr.live_runners().await.is_empty());
    let pid_a = mgr
        .spawn(make_args("s_live_a", bridge.path().to_path_buf()), None)
        .await
        .expect("spawn a");
    let pid_b = mgr
        .spawn(make_args("s_live_b", bridge.path().to_path_buf()), None)
        .await
        .expect("spawn b");
    let mut live = mgr.live_runners().await;
    live.sort();
    assert_eq!(
        live,
        vec![
            ("s_live_a".to_string(), pid_a),
            ("s_live_b".to_string(), pid_b)
        ]
    );
    mgr.shutdown("s_live_a", Some(Duration::from_secs(1)))
        .await
        .expect("shutdown a");
    assert_eq!(
        mgr.live_runners().await,
        vec![("s_live_b".to_string(), pid_b)]
    );
    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn live_runners_leaves_out_a_crashed_runner() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_exiting_runner(bridge.path(), 3);
    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s_crash", bridge.path().to_path_buf()), None)
        .await
        .expect("spawn");
    let mut rx = mgr.subscribe("s_crash").await.expect("subscribe");
    next_closed(&mut rx).await.expect("closed");
    // Still registered (its stderr tail stays readable), but not live: a
    // re-click must respawn it, not attach to a dead process.
    assert!(mgr.pid("s_crash").await.is_some());
    assert!(mgr.live_runners().await.is_empty());
    mgr.shutdown_all(Duration::from_secs(1)).await;
}

// ---------------- Ready cache + shared ensure path (ticket 02a) ----------------
//
// A page that attaches after a runner's `ready` went by gets the folded
// state from Core instead of waiting for an event that will not come
// again; and concurrent "ensure a runner" calls for one session must
// start exactly one real process.

use galley_core_lib::ipc::{SetLlmCommand, SetReasoningEffortCommand};
use galley_core_lib::session_runner::{ensure_session_runner, EnsureOptions, RunnerHost};

/// Mock that reports two models on `ready` and answers `set_llm` /
/// `set_reasoning_effort` like the real bridge (§4.12 / §4.18).
fn write_model_switching_runner(dir: &std::path::Path) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    let script = r#"
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

def emit(obj):
    obj["sessionId"] = args.session_id
    obj.setdefault("timestamp", "2026-10-10T00:00:00+00:00")
    print(json.dumps(obj), flush=True)

NAMES = ["A/model-a", "B/model-b"]
emit({"kind": "ready", "protocolVersion": "0.1", "gaCommit": "mock",
      "gaCommitDate": "2026-10-10T00:00:00+00:00", "gaPath": args.ga_path,
      "llmName": NAMES[0], "cwd": os.getcwd(), "pid": os.getpid(),
      "availableLLMs": [
          {"index": i, "name": n, "displayName": n, "isCurrent": i == 0}
          for i, n in enumerate(NAMES)],
      "imagesSupported": True, "reasoningEffort": "high",
      "configuredReasoningEffort": "medium"})

for line in sys.stdin:
    cmd = json.loads(line)
    kind = cmd.get("kind")
    if kind == "shutdown":
        break
    if kind == "set_llm":
        i = cmd["llmIndex"]
        emit({"kind": "llm_changed", "index": i, "name": NAMES[i],
              "displayName": NAMES[i], "imagesSupported": False,
              "reasoningEffort": "high", "configuredReasoningEffort": "low"})
    elif kind == "set_reasoning_effort":
        emit({"kind": "reasoning_effort_changed", "reasoningEffort": cmd["value"],
              "configuredReasoningEffort": "low"})
"#;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

async fn next_event_of(
    rx: &mut tokio::sync::broadcast::Receiver<BroadcastItem>,
    kind: &str,
) -> IpcEvent {
    loop {
        let event = next_event(rx).await.expect("event before timeout");
        let matches = matches!(
            (&event, kind),
            (IpcEvent::Ready(_), "ready")
                | (IpcEvent::LlmChanged(_), "llm_changed")
                | (
                    IpcEvent::ReasoningEffortChanged(_),
                    "reasoning_effort_changed"
                )
        );
        if matches {
            return event;
        }
    }
}

#[tokio::test]
async fn ready_snapshot_follows_ready_llm_changed_and_effort_changes() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_model_switching_runner(bridge.path());
    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s_ready", bridge.path().to_path_buf()), None)
        .await
        .expect("spawn");
    let mut rx = mgr.subscribe("s_ready").await.expect("subscribe");

    next_event_of(&mut rx, "ready").await;
    let snapshot = mgr.ready_snapshot("s_ready").await.expect("after ready");
    assert_eq!(snapshot.llm_name, "A/model-a");
    assert_eq!(snapshot.available_llms.len(), 2);
    assert_eq!(snapshot.available_llms[0]["isCurrent"], true);
    assert!(snapshot.images_supported);
    assert_eq!(snapshot.reasoning_effort.as_deref(), Some("high"));

    mgr.send_command(
        "s_ready",
        &IpcCommand::SetLlm(SetLlmCommand { llm_index: 1 }),
    )
    .await
    .expect("set_llm");
    next_event_of(&mut rx, "llm_changed").await;
    let snapshot = mgr.ready_snapshot("s_ready").await.expect("after switch");
    assert_eq!(snapshot.llm_name, "B/model-b");
    assert_eq!(snapshot.available_llms[0]["isCurrent"], false);
    assert_eq!(snapshot.available_llms[1]["isCurrent"], true);
    assert!(!snapshot.images_supported);
    assert_eq!(snapshot.configured_reasoning_effort.as_deref(), Some("low"));

    mgr.send_command(
        "s_ready",
        &IpcCommand::SetReasoningEffort(SetReasoningEffortCommand {
            value: Some("xhigh".into()),
        }),
    )
    .await
    .expect("set_reasoning_effort");
    next_event_of(&mut rx, "reasoning_effort_changed").await;
    let snapshot = mgr.ready_snapshot("s_ready").await.expect("after effort");
    assert_eq!(snapshot.reasoning_effort.as_deref(), Some("xhigh"));
    assert_eq!(snapshot.llm_name, "B/model-b");

    mgr.shutdown("s_ready", Some(Duration::from_secs(2)))
        .await
        .expect("shutdown");
    assert!(mgr.ready_snapshot("s_ready").await.is_none());
}

#[tokio::test]
async fn ready_snapshot_is_cleared_when_the_runner_exits() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_exiting_runner(bridge.path(), 3);
    let mgr = RunnerManager::new();
    mgr.spawn(make_args("s_ready_exit", bridge.path().to_path_buf()), None)
        .await
        .expect("spawn");
    let mut rx = mgr.subscribe("s_ready_exit").await.expect("subscribe");
    next_closed(&mut rx).await.expect("closed");
    // Still registered, but dead: no snapshot, no live pid.
    assert!(mgr.pid("s_ready_exit").await.is_some());
    assert!(mgr.live_pid("s_ready_exit").await.is_none());
    assert!(mgr.ready_snapshot("s_ready_exit").await.is_none());
    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn concurrent_ensures_start_one_real_runner_and_later_ones_get_its_ready() {
    let Some(python) = mock_python_path() else {
        eprintln!("[skip] no python on this machine");
        return;
    };
    let bridge = TempDir::new().expect("tempdir");
    write_mock_runner(bridge.path());
    let (_db_dir, pool, galley) = persistence_db().await;
    seed_session(&pool, "s_ensure").await;
    galley
        .set_pref_json(
            "ga_config",
            serde_json::json!({
                "gaPath": bridge.path().to_str().unwrap(),
                "bridgeCwd": bridge.path().to_str().unwrap(),
                "python": python,
            }),
        )
        .await
        .expect("seed ga_config");
    let mgr = RunnerManager::new();
    let host = RunnerHost {
        galley: &galley,
        runner: &mgr,
        notifier: galley_core_lib::notify::NullNotifier::arc(),
        env: None,
    };
    let options = || EnsureOptions {
        via: "gui",
        active_session_id: None,
        llm_override: None,
        ga_config: None,
        holds_run_gate: false,
        timeouts: Default::default(),
    };

    let (a, b) = tokio::join!(
        ensure_session_runner(&host, "s_ensure", options()),
        ensure_session_runner(&host, "s_ensure", options()),
    );
    let (a, b) = (a.expect("first"), b.expect("second"));
    assert_eq!(a.pid, b.pid);
    assert_ne!(a.spawned, b.spawned);
    assert_eq!(
        mgr.live_runners().await,
        vec![("s_ensure".to_string(), a.pid)]
    );

    // Once the runner has reported, an ensure hands its state out.
    let mut snapshot = None;
    for _ in 0..100 {
        snapshot = mgr.ready_snapshot("s_ensure").await;
        if snapshot.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(snapshot.is_some(), "mock runner reported ready");
    let again = ensure_session_runner(&host, "s_ensure", options())
        .await
        .expect("third");
    assert!(!again.spawned);
    assert_eq!(again.pid, a.pid);
    assert_eq!(again.ready.expect("snapshot").llm_name, "mock-llm");

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

// ---------------- history replay on real processes (ticket 02b) ----------------
//
// The mock bridge below answers `load_history` from a plan file in its
// directory (one behavior per attempt, across processes) and logs every
// `load_history` / `user_message` it receives, so a test can see what a
// restarted runner got.

use galley_core_lib::api::{GoalId, GoalStatus};
use galley_core_lib::db::PersistAssistantMessage;
use galley_core_lib::goal_engine::GoalEngine;
use galley_core_lib::notify::Notifier;
use galley_core_lib::session_runner::SessionRunnerError;
use galley_core_lib::socket_listener::{DbSource, HandlerCtx};
use std::sync::{Arc, Mutex};

fn write_replaying_runner(dir: &std::path::Path, plan: &str) {
    let runner_dir = dir.join("runner");
    fs::create_dir_all(&runner_dir).expect("mkdir runner");
    fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    fs::write(dir.join("plan"), plan).expect("write plan");
    let script = r##"
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--ga-path", required=True)
parser.add_argument("--session-id", required=True)
args, _ = parser.parse_known_args()
HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def emit(obj):
    obj["sessionId"] = args.session_id
    obj.setdefault("timestamp", "2026-10-10T00:00:00+00:00")
    print(json.dumps(obj), flush=True)

def log(name, record):
    with open(os.path.join(HOME, name), "a") as f:
        f.write(json.dumps(record) + "\n")

def attempts():
    try:
        with open(os.path.join(HOME, "load_history.jsonl")) as f:
            return sum(1 for _ in f)
    except FileNotFoundError:
        return 0

emit({"kind": "ready", "protocolVersion": "0.1", "gaCommit": "mock",
      "gaCommitDate": "2026-10-10T00:00:00+00:00", "gaPath": args.ga_path,
      "llmName": "mock-llm", "cwd": os.getcwd(), "pid": os.getpid(),
      "availableLLMs": []})

def load_history_error(severity):
    emit({"kind": "error", "message": "History restore: " + severity,
          "category": "business", "severity": severity, "retryable": False,
          "hint": None, "context": "load_history", "traceback": None})

for line in sys.stdin:
    try:
        cmd = json.loads(line)
    except ValueError:
        continue
    kind = cmd.get("kind")
    if kind == "shutdown":
        break
    if kind == "load_history":
        with open(os.path.join(HOME, "plan")) as f:
            plan = f.read().strip().split(",")
        n = attempts()
        step = plan[n] if n < len(plan) else "loaded"
        log("load_history.jsonl", {"pid": os.getpid(), "messages": cmd["messages"]})
        if step == "refuse":
            load_history_error("error")
        elif step == "warn":
            load_history_error("warning")
            emit({"kind": "history_loaded", "messageCount": len(cmd["messages"])})
        elif step == "exit":
            sys.exit(3)
        elif step == "loaded":
            emit({"kind": "history_loaded", "messageCount": len(cmd["messages"])})
    elif kind == "user_message":
        log("user_messages.jsonl", {"pid": os.getpid(), "text": cmd.get("text")})
        # The run starts and stays open.
        emit({"kind": "turn_start", "turnIndex": 1})
"##;
    fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

fn read_log(dir: &std::path::Path, name: &str) -> Vec<serde_json::Value> {
    fs::read_to_string(dir.join(name))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).expect("log line"))
        .collect()
}

/// The log once it has `lines` entries (the mock writes it as it reads
/// stdin, after the send already returned).
async fn wait_for_log(dir: &std::path::Path, name: &str, lines: usize) -> Vec<serde_json::Value> {
    for _ in 0..100 {
        let log = read_log(dir, name);
        if log.len() >= lines {
            return log;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    read_log(dir, name)
}

#[derive(Default)]
struct RecordingNotifier {
    events: Mutex<Vec<(String, serde_json::Value)>>,
}

impl Notifier for RecordingNotifier {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl RecordingNotifier {
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }
    fn replay_phases(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == "runner-history-replay")
            .map(|(_, p)| p["phase"].as_str().unwrap().to_string())
            .collect()
    }
}

/// A session with two completed exchanges, written the way Core writes
/// them, and a ga_config pointing at the mock bridge.
async fn replay_session(
    pool: &SqlitePool,
    galley: &SqliteGalley,
    sid: &str,
    python: &str,
    bridge: &std::path::Path,
) {
    seed_session(pool, sid).await;
    for (user, reply) in [("记住暗号：蓝鲸 4721", "好"), ("复述一遍", "蓝鲸 4721")] {
        let row = galley
            .send_message(
                SessionId(sid.into()),
                user.into(),
                Origin {
                    via: OriginVia::Cli,
                    supervisor: None,
                    reason: None,
                    client: None,
                },
            )
            .await
            .expect("user row");
        galley
            .persist_assistant_message(PersistAssistantMessage {
                session_id: SessionId(sid.into()),
                turn_index: row.turn_index.expect("turn index"),
                content: reply.into(),
                tool_calls: None,
                tool_results: None,
                thinking: None,
                final_answer: Some(reply.into()),
                summary: None,
                preamble: None,
                visibility: MessageVisibility::Visible,
                telemetry: None,
            })
            .await
            .expect("assistant row");
        galley
            .bump_session_after_turn(SessionId(sid.into()), Some(reply.into()), None, false)
            .await
            .expect("bump");
    }
    galley
        .set_pref_json(
            "ga_config",
            serde_json::json!({
                "gaPath": bridge.to_str().unwrap(),
                "bridgeCwd": bridge.to_str().unwrap(),
                "python": python,
            }),
        )
        .await
        .expect("seed ga_config");
}

fn replayed_history() -> serde_json::Value {
    serde_json::json!([
        {"role": "user", "content": "记住暗号：蓝鲸 4721"},
        {"role": "assistant", "content": "好"},
        {"role": "user", "content": "复述一遍"},
        {"role": "assistant", "content": "蓝鲸 4721"},
    ])
}

/// Every signal the watchers sent so far (after a short settle).
async fn drain_signals(signals: &mut mpsc::UnboundedReceiver<RunSignal>) -> Vec<RunSignal> {
    tokio::time::sleep(Duration::from_millis(400)).await;
    let mut out = Vec::new();
    while let Ok(signal) = signals.try_recv() {
        out.push(signal);
    }
    out
}

#[tokio::test]
async fn ensure_replays_into_a_real_runner_and_restarts_it_quietly_once() {
    let Some(python) = mock_python_path() else {
        eprintln!("[skip] no python on this machine");
        return;
    };
    let bridge = TempDir::new().expect("tempdir");
    write_replaying_runner(bridge.path(), "refuse,loaded");
    let (_db_dir, pool, galley) = persistence_db().await;
    replay_session(&pool, &galley, "s_replay", &python, bridge.path()).await;
    let (mgr, mut signals) = persisting_manager(&galley);
    let notifier = Arc::new(RecordingNotifier::default());
    let host = RunnerHost {
        galley: &galley,
        runner: &mgr,
        notifier: notifier.clone(),
        env: None,
    };

    let outcome = ensure_session_runner(
        &host,
        "s_replay",
        EnsureOptions {
            via: "gui",
            active_session_id: None,
            llm_override: None,
            ga_config: None,
            holds_run_gate: false,
            timeouts: Default::default(),
        },
    )
    .await
    .expect("ensure");

    assert!(outcome.spawned);
    let attempts = read_log(bridge.path(), "load_history.jsonl");
    assert_eq!(attempts.len(), 2, "refused once, restarted, loaded");
    assert_ne!(attempts[0]["pid"], attempts[1]["pid"], "a fresh process");
    assert_eq!(attempts[1]["pid"], outcome.pid);
    for attempt in &attempts {
        assert_eq!(attempt["messages"], replayed_history());
    }
    assert_eq!(
        mgr.live_runners().await,
        vec![("s_replay".to_string(), outcome.pid)]
    );
    assert!(mgr.history_confirmed("s_replay", outcome.pid).await);
    assert_eq!(
        notifier.replay_phases(),
        ["started", "failed", "started", "done"]
    );
    // The retired runner's close reached neither the drain task nor a
    // page; its replacement was announced.
    assert!(!drain_signals(&mut signals)
        .await
        .iter()
        .any(|s| matches!(s, RunSignal::Closed { .. })));
    assert!(!notifier.names().iter().any(|n| n == "runner-closed"));
    assert_eq!(
        notifier
            .names()
            .iter()
            .filter(|n| *n == "runner-spawned-external")
            .count(),
        2
    );

    // A second ensure finds it confirmed and sends nothing.
    let again = ensure_session_runner(
        &host,
        "s_replay",
        EnsureOptions {
            via: "gui",
            active_session_id: None,
            llm_override: None,
            ga_config: None,
            holds_run_gate: false,
            timeouts: Default::default(),
        },
    )
    .await
    .expect("second ensure");
    assert!(!again.spawned);
    assert_eq!(read_log(bridge.path(), "load_history.jsonl").len(), 2);

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn a_real_runner_that_keeps_refusing_is_a_history_replay_error() {
    let Some(python) = mock_python_path() else {
        eprintln!("[skip] no python on this machine");
        return;
    };
    let bridge = TempDir::new().expect("tempdir");
    write_replaying_runner(bridge.path(), "refuse,refuse");
    let (_db_dir, pool, galley) = persistence_db().await;
    replay_session(&pool, &galley, "s_refuse", &python, bridge.path()).await;
    let mgr = RunnerManager::new();
    let host = RunnerHost {
        galley: &galley,
        runner: &mgr,
        notifier: galley_core_lib::notify::NullNotifier::arc(),
        env: None,
    };

    let err = ensure_session_runner(
        &host,
        "s_refuse",
        EnsureOptions {
            via: "gui",
            active_session_id: None,
            llm_override: None,
            ga_config: None,
            holds_run_gate: false,
            timeouts: Default::default(),
        },
    )
    .await
    .expect_err("refused twice");
    assert!(
        matches!(err, SessionRunnerError::HistoryReplay(_)),
        "{err:?}"
    );
    // The second runner is left alive and unconfirmed.
    let live = mgr.live_runners().await;
    assert_eq!(live.len(), 1);
    assert!(!mgr.history_confirmed("s_refuse", live[0].1).await);

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

/// What the app's drain task does with one signal
/// (`message_queue::spawn_queue_drain_task`): close / reopen the gate,
/// then let the Goal engine react.
async fn drain_like_the_app(
    galley: &SqliteGalley,
    mgr: &RunnerManager,
    notifier: Arc<dyn Notifier>,
    signal: RunSignal,
) {
    let session_id = match &signal {
        RunSignal::RunComplete { session_id }
        | RunSignal::Closed { session_id }
        | RunSignal::UserRunStarted { session_id } => session_id.clone(),
    };
    if mgr.queue_take_next(&signal).await.is_some() {
        return;
    }
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: mgr,
        notifier,
        app: None,
    };
    let engine = GoalEngine { galley, ctx: &ctx };
    match signal {
        RunSignal::RunComplete { .. } => engine.on_run_settled(&session_id).await,
        RunSignal::Closed { .. } => engine.on_runner_closed(&session_id).await,
        RunSignal::UserRunStarted { .. } => engine.on_user_run_started(&session_id).await,
    }
}

#[tokio::test]
async fn a_goal_survives_the_quiet_restart_of_its_runner() {
    let Some(python) = mock_python_path() else {
        eprintln!("[skip] no python on this machine");
        return;
    };
    let bridge = TempDir::new().expect("tempdir");
    write_replaying_runner(bridge.path(), "refuse,loaded");
    let (_db_dir, pool, galley) = persistence_db().await;
    replay_session(&pool, &galley, "s_goal_race", &python, bridge.path()).await;
    let (mgr, mut signals) = persisting_manager(&galley);
    let notifier: Arc<dyn Notifier> = Arc::new(RecordingNotifier::default());
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &mgr,
        notifier: notifier.clone(),
        app: None,
    };
    let engine = GoalEngine {
        galley: &galley,
        ctx: &ctx,
    };

    let started = engine
        .start(
            SessionId("s_goal_race".into()),
            "暗号是什么？".into(),
            None,
            Origin {
                via: OriginVia::Cli,
                supervisor: None,
                reason: None,
                client: None,
            },
        )
        .await
        .expect("goal start");
    assert_eq!(started.dispatch, "dispatched");
    let goal_id: GoalId = started.goal.id.clone();

    // The objective reached the restarted runner, after its history.
    let attempts = read_log(bridge.path(), "load_history.jsonl");
    assert_eq!(attempts.len(), 2);
    let sent = wait_for_log(bridge.path(), "user_messages.jsonl", 1).await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["pid"], attempts[1]["pid"]);
    assert!(sent[0]["text"].as_str().unwrap().contains("暗号是什么？"));

    // Feed whatever the watchers reported through the drain, as the app
    // would. The retired runner must have reported nothing.
    let reported = drain_signals(&mut signals).await;
    assert!(
        !reported
            .iter()
            .any(|s| matches!(s, RunSignal::Closed { .. })),
        "the quiet restart sent no Closed: {reported:?}"
    );
    for signal in reported {
        drain_like_the_app(&galley, &mgr, notifier.clone(), signal).await;
    }

    // The gate the goal reserved is still the open run, and the goal is
    // still active — not paused by the runner it replaced.
    let state = mgr.run_state("s_goal_race").await;
    assert!(state.open_run, "{state:?}");
    assert_eq!(
        galley.get_goal(goal_id).await.expect("goal").status,
        GoalStatus::Active
    );
    // A user message offered now queues behind the goal's run.
    assert!(matches!(
        mgr.queue_offer("s_goal_race", "插话".into(), None).await,
        galley_core_lib::runner_manager::QueueOffer::Queued { .. }
    ));

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

// ---------------- what Core announces about runs (ticket 05c) ----------------

use galley_core_lib::runner_manager::{publish_run_states, SESSION_RUN_STATE_EVENT};
use galley_core_lib::turn_persistence::VIA_TURN_PERSIST;
use serde_json::json;

/// [`persisting_manager`] plus everything `app_setup` wires for the
/// phone: turn bumps announced and the `session-run-state` publisher,
/// both into one recording notifier.
fn announcing_manager(
    galley: &SqliteGalley,
) -> (
    Arc<RunnerManager>,
    mpsc::UnboundedReceiver<RunSignal>,
    Arc<RecordingNotifier>,
) {
    let mgr = Arc::new(RunnerManager::new());
    let notifier = Arc::new(RecordingNotifier::default());
    mgr.set_turn_store(galley.clone(), notifier.clone());
    let (tx, rx) = mpsc::unbounded_channel();
    mgr.set_run_signal(tx);
    let (feed_tx, feed_rx) = mpsc::unbounded_channel();
    mgr.set_run_state_feed(feed_tx);
    tokio::spawn(publish_run_states(mgr.clone(), notifier.clone(), feed_rx));
    (mgr, rx, notifier)
}

/// Payloads of one event name, in emit order.
fn payloads_of(notifier: &RecordingNotifier, event: &str) -> Vec<serde_json::Value> {
    notifier
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|(name, _)| name == event)
        .map(|(_, payload)| payload.clone())
        .collect()
}

/// The `session-run-state` payloads of one session, in emit order.
fn run_states(notifier: &RecordingNotifier, sid: &str) -> Vec<serde_json::Value> {
    payloads_of(notifier, SESSION_RUN_STATE_EVENT)
        .into_iter()
        .filter(|p| p["sessionId"] == sid)
        .collect()
}

/// Wait until `pred` holds for the run states of `sid`.
async fn wait_run_states(
    notifier: &RecordingNotifier,
    sid: &str,
    pred: impl Fn(&[serde_json::Value]) -> bool,
) -> Vec<serde_json::Value> {
    for _ in 0..200 {
        let states = run_states(notifier, sid);
        if pred(&states) {
            return states;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("run states never matched: {:#?}", run_states(notifier, sid));
}

/// What the drain task does with a RunComplete: close the run gate.
async fn settle(mgr: &RunnerManager, sid: &str) {
    mgr.queue_take_next(&RunSignal::RunComplete {
        session_id: sid.to_string(),
    })
    .await;
}

#[tokio::test]
async fn each_visible_turn_bump_is_announced_with_the_bumped_row() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    seed_session(&pool, "s-ann").await;
    let (mgr, mut signals, notifier) = announcing_manager(&galley);
    spawn_persisting(&mgr, "s-ann", bridge.path()).await;

    dispatch(&mgr, &galley, "s-ann", "run:3", MessageVisibility::Visible).await;
    next_run_complete(&mut signals).await;

    let bumps: Vec<serde_json::Value> = payloads_of(&notifier, "session-updated-external")
        .into_iter()
        .filter(|p| p["via"] == VIA_TURN_PERSIST)
        .collect();
    assert_eq!(bumps.len(), 3, "one announcement per visible turn_end");
    let counts: Vec<u64> = bumps
        .iter()
        .map(|p| p["session"]["turnCount"].as_u64().unwrap())
        .collect();
    assert_eq!(counts, vec![1, 2, 3], "each carries the row after its bump");
    let last = &bumps[2]["session"];
    assert_eq!(last["id"], "s-ann");
    assert_eq!(last["summary"], "给出答案");
    // The event form: optional fields present, null when empty.
    assert!(last.get("projectId").is_some_and(|v| v.is_null()));
    assert!(last.get("reasoningEffort").is_some_and(|v| v.is_null()));
    let brief = galley
        .session_brief(SessionId("s-ann".into()))
        .await
        .unwrap();
    assert_eq!(last["lastActivityAt"], brief.last_activity_at.as_str());

    // Internal turns bump nothing, so announce nothing.
    dispatch(&mgr, &galley, "s-ann", "run:2", MessageVisibility::Internal).await;
    next_run_complete(&mut signals).await;
    let after = payloads_of(&notifier, "session-updated-external");
    assert_eq!(after.len(), 3);

    mgr.shutdown_all(Duration::from_secs(1)).await;
}

#[tokio::test]
async fn run_state_events_follow_a_run_and_an_ask_without_repeats() {
    if mock_python_path().is_none() {
        eprintln!("[skip] no python on this machine");
        return;
    }
    let bridge = TempDir::new().expect("tempdir");
    write_persisting_runner(bridge.path());
    let (_db, pool, galley) = persistence_db().await;
    seed_session(&pool, "s-rs").await;
    let (mgr, mut signals, notifier) = announcing_manager(&galley);
    spawn_persisting(&mgr, "s-rs", bridge.path()).await;

    // Registered runner: the first change away from idle.
    let states = wait_run_states(&notifier, "s-rs", |s| !s.is_empty()).await;
    assert_eq!(
        states[0],
        json!({
            "sessionId": "s-rs",
            "runnerAlive": true,
            "agentRunning": false,
            "openRun": false,
            "queuedCount": 0,
            "askPending": false,
            "lastExit": null,
        })
    );

    // A turn left going is seen going …
    dispatch(&mgr, &galley, "s-rs", "hold", MessageVisibility::Visible).await;
    wait_run_states(&notifier, "s-rs", |s| {
        s.last()
            .is_some_and(|p| p["agentRunning"] == true && p["openRun"] == true)
    })
    .await;
    // … and its end settles everything. The publisher reads the state
    // when it gets to a report, so a run this mock finishes within a
    // millisecond may show no `agentRunning: true` of its own: events
    // carry states, not every edge; the last one is always current.
    dispatch(&mgr, &galley, "s-rs", "release", MessageVisibility::Visible).await;
    next_run_complete(&mut signals).await;
    settle(&mgr, "s-rs").await;
    let states = wait_run_states(&notifier, "s-rs", |s| {
        s.last()
            .is_some_and(|p| p["openRun"] == false && p["lastExit"] == "CURRENT_TASK_DONE")
    })
    .await;
    assert_eq!(
        states.last().unwrap(),
        &json!({
            "sessionId": "s-rs",
            "runnerAlive": true,
            "agentRunning": false,
            "openRun": false,
            "queuedCount": 0,
            "askPending": false,
            "lastExit": "CURRENT_TASK_DONE",
        })
    );

    // An ask_user run ends asking; the answer's dispatch clears it.
    dispatch(&mgr, &galley, "s-rs", "ask", MessageVisibility::Visible).await;
    next_run_complete(&mut signals).await;
    settle(&mgr, "s-rs").await;
    let states = wait_run_states(&notifier, "s-rs", |s| {
        s.last()
            .is_some_and(|p| p["askPending"] == true && p["openRun"] == false)
    })
    .await;
    assert_eq!(states.last().unwrap()["lastExit"], "EXITED");

    // Shut down: the runner is gone (the queue state stays).
    mgr.shutdown("s-rs", Some(Duration::from_secs(1)))
        .await
        .unwrap();
    let states = wait_run_states(&notifier, "s-rs", |s| {
        s.last().is_some_and(|p| p["runnerAlive"] == false)
    })
    .await;

    // Deduplicated: no two consecutive events say the same thing.
    for pair in states.windows(2) {
        assert_ne!(pair[0], pair[1], "repeated snapshot in {states:#?}");
    }
}
