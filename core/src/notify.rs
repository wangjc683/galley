//! GUI-event emission seam.
//!
//! Core broadcasts state changes to the GUI as Tauri events. Handlers
//! that must work without a live Tauri app — socket write handlers under
//! test, headless dispatch — emit through [`Notifier`] instead of holding
//! an `AppHandle`. Production wires [`TauriNotifier`]; tests wire a
//! recording fake; [`NullNotifier`] replaces the old `Option::None`
//! "silently skip" semantics.

use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;

pub trait Notifier: Send + Sync {
    /// Fire-and-forget emit. Implementations must not block or fail the
    /// caller — event delivery is best-effort by contract (a GUI that
    /// missed an event resyncs from the DB, which is authoritative).
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
        let _ = self.app.emit(event, payload);
    }
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
