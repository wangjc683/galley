//! GUI-event emission seam.
//!
//! Core broadcasts state changes to the GUI as Tauri events. Handlers
//! that must work without a live Tauri app — socket write handlers under
//! test, headless dispatch — emit through [`Notifier`] instead of holding
//! an `AppHandle`. Production wires [`TauriNotifier`]; tests wire a
//! recording fake; [`NullNotifier`] replaces the old `Option::None`
//! "silently skip" semantics.
//!
//! Every [`TauriNotifier`] emit also goes to the process-wide
//! [`RemoteEventSink`] when one is registered — the remote module's
//! hook for paired phones (ticket 05c,
//! `.scratch/ios-client/issues/05-remote-protocol-design.md` §7). The
//! fan-out lives here, not at the ~35 places that construct a
//! `TauriNotifier`, so long-lived tasks that captured one (the runner
//! emit task, the auto-title watcher, the queue drain) forward too.

use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, PoisonError, RwLock};
use tauri::Emitter;

pub trait Notifier: Send + Sync {
    /// Fire-and-forget emit. Implementations must not block or fail the
    /// caller — event delivery is best-effort by contract (a GUI that
    /// missed an event resyncs from the DB, which is authoritative).
    /// That holds only because Core writes everything durable itself:
    /// runner `turn_end`s included, since 2026-10-07
    /// (`crate::turn_persistence`) — before, assistant rows were written
    /// only when a page received `runner-event`, so a webview reload lost
    /// them for good. Never make an emit the trigger of a DB write.
    fn emit(&self, event: &str, payload: Value);
}

/// Serialize + emit helper so call sites keep their typed payload structs.
pub fn notify<T: Serialize>(notifier: &dyn Notifier, event: &str, payload: &T) {
    match serde_json::to_value(payload) {
        Ok(v) => notifier.emit(event, v),
        Err(e) => eprintln!("[notify] serialize {event} payload failed: {e}"),
    }
}

pub struct TauriNotifier {
    app: tauri::AppHandle,
}

impl TauriNotifier {
    pub fn new(app: tauri::AppHandle) -> Arc<dyn Notifier> {
        Arc::new(Self { app })
    }
}

impl Notifier for TauriNotifier {
    fn emit(&self, event: &str, payload: Value) {
        emit_and_forward(event, payload, |event, payload| {
            let _ = self.app.emit(event, payload);
        });
    }
}

/// The body of [`TauriNotifier::emit`]: the webview first, then the
/// remote sink, each exactly once, with the same payload.
fn emit_and_forward(event: &str, payload: Value, webview: impl FnOnce(&str, &Value)) {
    webview(event, &payload);
    forward_to_remote(event, &payload);
}

/// Headless stand-in: events go nowhere, exactly like the pre-seam
/// `Option::<&AppHandle>::None` path.
pub struct NullNotifier;

impl NullNotifier {
    pub fn arc() -> Arc<dyn Notifier> {
        Arc::new(Self)
    }
}

impl Notifier for NullNotifier {
    fn emit(&self, _event: &str, _payload: Value) {}
}

// ---------------- remote fan-out ----------------

/// Where Core's events go besides the webview: the remote module
/// registers one ([`register_remote_sink`]) while phones may be
/// connected. It receives every event a [`TauriNotifier`] emits, after
/// the webview, on the emitting thread — the runner emit task, a Tauri
/// command, the socket listener — so [`Self::forward`] must return at
/// once: copy what it needs into a bounded queue, drop when full, and do
/// the rest on its own task. Delivery is best-effort, the same contract
/// as [`Notifier::emit`]: a phone that missed something re-reads.
pub trait RemoteEventSink: Send + Sync {
    fn forward(&self, event: &str, payload: &Value);
}

/// The registered sink. [`REMOTE_SINK_SET`] mirrors whether it is
/// `Some`, so an emit with nothing registered costs one relaxed load and
/// never touches the lock.
static REMOTE_SINK: RwLock<Option<Arc<dyn RemoteEventSink>>> = RwLock::new(None);
static REMOTE_SINK_SET: AtomicBool = AtomicBool::new(false);

/// Install `sink` as the process's remote sink, replacing any earlier
/// one. Emits already past the check may still reach the old sink.
pub fn register_remote_sink(sink: Arc<dyn RemoteEventSink>) {
    let mut slot = REMOTE_SINK.write().unwrap_or_else(PoisonError::into_inner);
    *slot = Some(sink);
    REMOTE_SINK_SET.store(true, Ordering::Release);
}

/// Remove the remote sink (the remote module stopping). Idempotent.
pub fn clear_remote_sink() {
    let mut slot = REMOTE_SINK.write().unwrap_or_else(PoisonError::into_inner);
    REMOTE_SINK_SET.store(false, Ordering::Release);
    *slot = None;
}

/// Hand one emitted event to the remote sink, if one is registered. The
/// sink is called outside the lock, and a panicking sink is contained
/// here: forwarding must never fail the emitting task.
fn forward_to_remote(event: &str, payload: &Value) {
    if !REMOTE_SINK_SET.load(Ordering::Acquire) {
        return;
    }
    let sink = REMOTE_SINK
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    let Some(sink) = sink else {
        return;
    };
    let forwarded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sink.forward(event, payload);
    }));
    if forwarded.is_err() {
        eprintln!("[notify] remote sink panicked on {event}; event dropped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    /// The sink is process-wide; tests that register one take turns.
    static SINK_TESTS: Mutex<()> = Mutex::new(());

    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<(String, Value)>>,
    }

    impl RemoteEventSink for RecordingSink {
        fn forward(&self, event: &str, payload: &Value) {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload.clone()));
        }
    }

    struct PanickingSink;

    impl RemoteEventSink for PanickingSink {
        fn forward(&self, _event: &str, _payload: &Value) {
            panic!("sink bug");
        }
    }

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        SINK_TESTS.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[test]
    fn an_emit_reaches_the_webview_then_the_sink_once_each() {
        let _turn = lock();
        let sink = Arc::new(RecordingSink::default());
        register_remote_sink(sink.clone());
        let order = Mutex::new(Vec::new());
        let payload = json!({ "sessionId": "s1", "via": "gui" });

        emit_and_forward("session-updated-external", payload.clone(), |event, p| {
            order.lock().unwrap().push(format!("webview:{event}"));
            assert_eq!(p, &payload);
            // The sink has not seen it yet: the webview goes first.
            assert!(sink.events.lock().unwrap().is_empty());
        });
        clear_remote_sink();

        assert_eq!(
            *order.lock().unwrap(),
            vec!["webview:session-updated-external"]
        );
        assert_eq!(
            *sink.events.lock().unwrap(),
            vec![("session-updated-external".to_string(), payload)]
        );
    }

    #[test]
    fn nothing_registered_reaches_only_the_webview() {
        let _turn = lock();
        clear_remote_sink();
        let mut webview = 0;
        emit_and_forward("runner-event", json!({}), |_, _| webview += 1);
        assert_eq!(webview, 1);
    }

    #[test]
    fn a_cleared_sink_hears_nothing_more_and_a_replacement_takes_over() {
        let _turn = lock();
        let first = Arc::new(RecordingSink::default());
        let second = Arc::new(RecordingSink::default());
        register_remote_sink(first.clone());
        emit_and_forward("a", json!(1), |_, _| {});
        register_remote_sink(second.clone());
        emit_and_forward("b", json!(2), |_, _| {});
        clear_remote_sink();
        clear_remote_sink();
        emit_and_forward("c", json!(3), |_, _| {});

        let names = |s: &RecordingSink| {
            s.events
                .lock()
                .unwrap()
                .iter()
                .map(|(n, _)| n.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&first), vec!["a"]);
        assert_eq!(names(&second), vec!["b"]);
    }

    #[test]
    fn a_panicking_sink_does_not_fail_the_emit() {
        let _turn = lock();
        register_remote_sink(Arc::new(PanickingSink));
        let mut webview = 0;
        emit_and_forward("goal-updated", json!({}), |_, _| webview += 1);
        clear_remote_sink();
        assert_eq!(webview, 1);
    }
}
