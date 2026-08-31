//! Tauri-command surface that wraps [`crate::runner_manager::RunnerManager`].
//!
//! Seven `#[tauri::command]`s are registered:
//!
//! 1. [`spawn_runner`] — spawn a new Python runner subprocess + start an
//!    emit task that fans broadcast events to the GUI
//! 2. [`send_to_runner`] — write a typed [`IpcCommand`] to the subprocess
//! 3. [`shutdown_runner`] — graceful shutdown (send `{kind:"shutdown"}` +
//!    wait), with a kill fallback on timeout
//! 4. [`kill_runner`] — immediate SIGKILL (no graceful negotiation)
//! 5. [`runner_stderr_tail`] — pull the last 8 stderr lines for the
//!    abnormal-exit toast
//! 6. [`probe_ga_runtime`] — validate an external GA checkout before a
//!    session is created (implementation in the `probe` submodule)
//! 7. [`shutdown_all_runners`] — graceful shutdown of every live runner
//!
//! External-runtime spawn-arg preparation lives in the `external_spawn`
//! submodule; the managed-runtime spawn path stays in this file.
//!
//! ## Event channel contract
//!
//! After [`spawn_runner`] succeeds, a per-session task subscribes to the
//! [`RunnerManager`]'s broadcast and re-emits as Tauri events:
//!
//! | Event name       | Payload                                          |
//! |------------------|--------------------------------------------------|
//! | `runner-event`   | `{ sessionId: string, event: IpcEvent }`        |
//! | `runner-malformed` | `{ sessionId, line }`                          |
//! | `runner-closed`  | `{ sessionId, code: number\|null, signal: number\|null }` |
//!
//! `runner-closed` fires when the subprocess exits. `code` is captured when
//! available; user-initiated shutdown / kill maps to a clean close so the GUI
//! does not show a crash toast for deliberate lifecycle transitions.
//!
//! Stderr is NOT pushed event-by-event. The TS side pulls the tail buffer
//! via [`runner_stderr_tail`] when it needs to surface a toast — this is
//! the pull-style API decided in [B2 M1 running note N3].
//!
//! ## Error shape
//!
//! Errors return `String` rather than the typed Rust error enum because
//! Tauri commands serialize `Result<T, E>` with `serde_json::to_string` on
//! the error half. The string is the JSON form of the typed error (e.g.
//! `{"error":"python_not_found","detail":"..."}`) so the TS side can
//! parse and pattern-match on the `error` discriminant — same convention
//! as B1's [`list_sessions`].

use crate::api::{ManagedModelAuthKind, ManagedModelProtocol, RuntimeKind};
use crate::db::SqliteGalley;
use crate::ipc::IpcCommand;
use crate::runner_manager::{
    BroadcastItem, RunnerManager, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use crate::{codex_oauth, credential_store, managed_model_config, managed_prompt, managed_runtime};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::sync::broadcast::error::RecvError;

mod external_spawn;
mod probe;

pub(crate) use external_spawn::normalize_external_ga_path;
use external_spawn::prepare_external_spawn_args;
use probe::run_ga_runtime_probe;
pub use probe::{ProbeGaRuntimeArgs, ProbeGaRuntimeLlm, ProbeGaRuntimeResult};

/// JSON-friendly mirror of [`SpawnArgs`]. The TS side sends camelCase keys
/// (per the broader serde convention used by all our Tauri commands).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRunnerArgs {
    pub python: String,
    pub ga_path: String,
    pub session_id: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    pub bridge_cwd: String,
    #[serde(default)]
    pub llm_index: Option<i64>,
    /// Stable model identity. Managed runtime interprets this as
    /// managed_models.id; external runtime forwards it as GA's raw LLM name.
    #[serde(default)]
    pub llm_key: Option<String>,
    /// Extra environment variables as a flat list of [key, value] pairs.
    /// (Object form would mean JS could pass a plain Record<string,string>,
    /// which serde would happily parse — but pair-form is unambiguous and
    /// preserves insertion order if that ever matters.)
    #[serde(default)]
    pub env: Vec<(String, String)>,
    /// Which GA runtime profile to spawn. Omitted means external for
    /// compatibility with older GUI/socket callers.
    #[serde(default)]
    pub runtime_kind: Option<RuntimeKind>,
    /// Optional: if Some, the manager treats this id as the
    /// eviction-protected active session for the LRU walk.
    #[serde(default)]
    pub active_session_id: Option<String>,
}

impl From<SpawnRunnerArgs> for SpawnArgs {
    fn from(args: SpawnRunnerArgs) -> Self {
        Self {
            python: args.python,
            ga_path: PathBuf::from(args.ga_path),
            session_id: args.session_id,
            cwd: args.cwd.map(PathBuf::from),
            workspace_root: args.workspace_root.map(PathBuf::from),
            bridge_cwd: PathBuf::from(args.bridge_cwd),
            llm_index: args.llm_index,
            llm_key: args.llm_key,
            env: args.env,
        }
    }
}

/// Payload of the `runner-closed` event. Matches the shape the TS-side
/// `BridgeHandlers.onClose` callback expects (`code: number | null,
/// signal: number | null`) for parity with the legacy `plugin-shell`
/// close event.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunnerClosedPayload {
    pub session_id: String,
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

/// Payload of the `runner-event` envelope.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunnerEventEnvelope {
    pub session_id: String,
    /// Parsed event. Serialized with its `kind` discriminator preserved
    /// (the [`IpcEvent`] enum is tagged via `#[serde(tag = "kind")]`).
    pub event: IpcEvent,
}

/// Payload of the `runner-malformed` event — for stdout lines that didn't
/// parse as JSON (Python tracebacks that escaped the runner's stdout
/// discipline, partial flushes on crash, etc).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunnerMalformedPayload {
    pub session_id: String,
    pub line: String,
}

/// Helper: convert a typed error to its JSON-string form for the Tauri
/// transport. `serde_json::to_string` always succeeds for our typed errors
/// (they have flat shapes); the unwrap-or-fallback is defense in depth.
fn err_to_json<T: Serialize + std::fmt::Display>(e: T) -> String {
    serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRuntimeModelConfig {
    schema_version: u32,
    models: Vec<ManagedRuntimeModel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRuntimeModel {
    display_name: String,
    protocol: ManagedModelProtocol,
    auth_kind: ManagedModelAuthKind,
    api_base: String,
    model: String,
    api_key: String,
    api_key_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_ipc: Option<codex_oauth::CodexCredentialIpcConfig>,
    advanced_options: serde_json::Value,
}

pub(crate) struct ManagedRuntimeProcessContext {
    pub diagnostics: managed_runtime::ManagedRuntimeDiagnostics,
    pub bridge_cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub requested_model_index: Option<i64>,
}

pub(crate) async fn prepare_managed_runtime_context(
    app: &AppHandle,
    requested_model_id: Option<&str>,
) -> Result<ManagedRuntimeProcessContext, RunnerSpawnError> {
    let diagnostics = managed_runtime::ensure_for_app(app).map_err(|e| {
        RunnerSpawnError::ManagedRuntimeInvalid {
            detail: format!("layout initialization failed: {e}"),
        }
    })?;
    if !diagnostics.code.agentmain_exists {
        return Err(RunnerSpawnError::ManagedRuntimeInvalid {
            detail: format!(
                "managed GA code is missing agentmain.py at {}",
                diagnostics.paths.code_root
            ),
        });
    }
    let galley = app.state::<SqliteGalley>().inner().clone();
    let models = galley.list_managed_models().await.map_err(|e| {
        RunnerSpawnError::ManagedModelNotConfigured {
            detail: format!("loading managed model records failed: {e}"),
        }
    })?;
    let mut credential_allowlist: codex_oauth::CredentialIpcAllowlist = HashMap::new();
    let mut usable_models = Vec::new();
    for model in models {
        // No-auth models carry no secret at all — usable as-is, and
        // deliberately kept out of the credential IPC allowlist.
        if model.auth_kind == ManagedModelAuthKind::None {
            usable_models.push(model);
            continue;
        }
        let has_secret = credential_store::get_secret(&galley, &model.api_key_ref)
            .await
            .map(|secret| !secret.trim().is_empty())
            .unwrap_or(false);
        if !has_secret {
            continue;
        }
        credential_allowlist.insert(model.api_key_ref.clone(), model.auth_kind);
        usable_models.push(model);
    }
    let mut credential_ipc: Option<codex_oauth::CodexCredentialIpcConfig> = None;
    let mut runtime_models = Vec::new();
    let mut requested_model_index: Option<i64> = None;
    for model in usable_models {
        let (api_key, model_credential_ipc) = match model.auth_kind {
            ManagedModelAuthKind::ApiKey => {
                let config =
                    shared_credential_ipc_config(&mut credential_ipc, &credential_allowlist)
                        .await?;
                ("galley-managed-api-key".into(), Some(config))
            }
            ManagedModelAuthKind::ChatgptCodexOauth => {
                let config =
                    shared_credential_ipc_config(&mut credential_ipc, &credential_allowlist)
                        .await?;
                ("galley-codex-oauth".into(), Some(config))
            }
            // The empty key is the real credential: the runner passes it
            // through to the engine verbatim, no IPC round-trip.
            ManagedModelAuthKind::None => (String::new(), None),
        };
        if requested_model_id == Some(model.id.as_str()) {
            requested_model_index = Some(runtime_models.len() as i64);
        }
        runtime_models.push(ManagedRuntimeModel {
            display_name: model.display_name,
            protocol: model.protocol,
            auth_kind: model.auth_kind,
            api_base: model.api_base,
            model: model.model,
            api_key,
            api_key_ref: model.api_key_ref,
            credential_ipc: model_credential_ipc,
            advanced_options: model.advanced_options,
        });
    }
    if runtime_models.is_empty() {
        return Err(RunnerSpawnError::ManagedModelNotConfigured {
            detail: "no managed model has a usable credential; open Settings -> Models to re-enter the model key".into(),
        });
    }

    let model_config_dir = PathBuf::from(&diagnostics.paths.model_config_dir);
    let model_config_path = model_config_dir.join(managed_model_config::GENERATED_CONFIG_FILENAME);
    if !model_config_path.is_file() {
        std::fs::create_dir_all(&model_config_dir).map_err(|e| {
            RunnerSpawnError::ManagedRuntimeInvalid {
                detail: format!("creating managed model config dir failed: {e}"),
            }
        })?;
        std::fs::write(&model_config_path, "{\"schemaVersion\":1,\"models\":[]}\n").map_err(
            |e| RunnerSpawnError::ManagedRuntimeInvalid {
                detail: format!("creating managed model config marker failed: {e}"),
            },
        )?;
    }

    let runtime_config = serde_json::to_string(&ManagedRuntimeModelConfig {
        schema_version: 1,
        models: runtime_models,
    })
    .map_err(|e| RunnerSpawnError::ManagedRuntimeInvalid {
        detail: format!("serializing managed runtime model config failed: {e}"),
    })?;

    let bridge_cwd = managed_runtime::bridge_cwd_for_app(app).map_err(|e| {
        RunnerSpawnError::ManagedRuntimeInvalid {
            detail: format!("resolving managed bridge cwd failed: {e}"),
        }
    })?;
    let env = vec![
        ("GALLEY_RUNTIME_KIND".into(), "managed".into()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        (
            "GALLEY_GA_STATE_ROOT".into(),
            diagnostics.paths.state_root.clone(),
        ),
        (
            "GALLEY_MANAGED_MODEL_CONFIG_PATH".into(),
            model_config_path.to_string_lossy().into_owned(),
        ),
        (
            "GALLEY_RUNTIME_PROMPT_TEXT".into(),
            managed_prompt::compose_runtime_prompt(&app.package_info().version.to_string()),
        ),
        ("GALLEY_MANAGED_MODEL_CONFIG_JSON".into(), runtime_config),
    ];

    Ok(ManagedRuntimeProcessContext {
        diagnostics,
        bridge_cwd,
        env,
        requested_model_index,
    })
}

async fn shared_credential_ipc_config(
    credential_ipc: &mut Option<codex_oauth::CodexCredentialIpcConfig>,
    allowlist: &codex_oauth::CredentialIpcAllowlist,
) -> Result<codex_oauth::CodexCredentialIpcConfig, RunnerSpawnError> {
    if let Some(config) = credential_ipc.clone() {
        return Ok(config);
    }
    let config = codex_oauth::start_credential_ipc(allowlist.clone())
        .await
        .map_err(|e| RunnerSpawnError::ManagedRuntimeInvalid {
            detail: format!("starting credential IPC failed: {e}"),
        })?;
    *credential_ipc = Some(config.clone());
    Ok(config)
}

pub(crate) async fn prepare_managed_spawn_args(
    mut args: SpawnArgs,
    app: &AppHandle,
) -> Result<SpawnArgs, RunnerSpawnError> {
    let requested_model_id = args.llm_key.clone();
    let context = prepare_managed_runtime_context(app, requested_model_id.as_deref()).await?;
    if requested_model_id.is_some() {
        // The selected managed model may have been deleted or lost its
        // credential since the session last ran. Falling back to the current
        // default is safer than reusing the stale numeric index, which could
        // silently point at a different model after reordering.
        args.llm_index = context.requested_model_index;
    }
    args.llm_key = None;

    args.ga_path = PathBuf::from(&context.diagnostics.paths.code_root);
    args.bridge_cwd = context.bridge_cwd;
    args.cwd = None;
    args.env.extend(context.env);
    Ok(args)
}

fn elapsed_ms(started_at: Instant) -> f64 {
    started_at.elapsed().as_secs_f64() * 1000.0
}

#[tauri::command]
pub async fn spawn_runner(
    args: SpawnRunnerArgs,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
) -> Result<u32, String> {
    let total_started_at = Instant::now();
    let active = args.active_session_id.clone();
    let session_id = args.session_id.clone();
    let runtime_kind = args.runtime_kind.unwrap_or(RuntimeKind::External);
    let mut spawn_args: SpawnArgs = args.into();
    let prepare_started_at = Instant::now();
    if runtime_kind == RuntimeKind::Managed {
        spawn_args = prepare_managed_spawn_args(spawn_args, &app)
            .await
            .map_err(err_to_json::<RunnerSpawnError>)?;
    } else {
        spawn_args = prepare_external_spawn_args(spawn_args, &app)
            .map_err(err_to_json::<RunnerSpawnError>)?;
    }
    eprintln!(
        "[perf] core.spawn_runner.prepare session_id={} runtime_kind={:?} elapsed_ms={:.1}",
        session_id,
        runtime_kind,
        elapsed_ms(prepare_started_at)
    );

    let process_started_at = Instant::now();
    let pid = manager
        .spawn(spawn_args, active.as_deref())
        .await
        .map_err(err_to_json::<RunnerSpawnError>)?;
    eprintln!(
        "[perf] core.spawn_runner.process session_id={} pid={} elapsed_ms={:.1}",
        session_id,
        pid,
        elapsed_ms(process_started_at)
    );

    // Subscribe BEFORE returning so the receiver is registered against the
    // broadcast channel — guarantees we don't miss the `Ready` event that
    // the subprocess emits ~430ms after spawn. The manager handed us a
    // fresh receiver against the just-installed RunnerProcess; we move it
    // into the long-lived emit task below.
    let rx = manager
        .subscribe(&session_id)
        .await
        .ok_or_else(|| "subscribe failed after spawn (race?)".to_string())?;

    // Second, independent subscriber: the auto-title watcher (v1 scope:
    // GUI spawn path only — see core/src/auto_title.rs module docs).
    if let Some(title_rx) = manager.subscribe(&session_id).await {
        crate::auto_title::spawn_auto_title_task(
            app.state::<SqliteGalley>().inner().clone(),
            manager.inner().clone(),
            crate::notify::TauriNotifier::new(app.clone()),
            session_id.clone(),
            title_rx,
        );
    }

    spawn_emit_task(
        crate::notify::TauriNotifier::new(app),
        session_id.clone(),
        rx,
    );

    eprintln!(
        "[perf] core.spawn_runner.total session_id={} pid={} elapsed_ms={:.1}",
        session_id,
        pid,
        elapsed_ms(total_started_at)
    );

    Ok(pid)
}

#[tauri::command]
pub async fn send_to_runner(
    session_id: String,
    command: IpcCommand,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> Result<(), String> {
    manager
        .send_command(&session_id, &command)
        .await
        .map_err(err_to_json::<SendCommandError>)
}

#[tauri::command]
pub async fn shutdown_runner(
    session_id: String,
    timeout_ms: Option<u64>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> Result<(), String> {
    let timeout = timeout_ms.map(Duration::from_millis);
    match manager.shutdown(&session_id, timeout).await {
        Ok(()) => Ok(()),
        // NotFound is idempotent-success: the GUI may try to shutdown a
        // session whose runner already crashed; surfacing that as an error
        // would force every caller to ignore one specific variant. Treat
        // as success at the transport boundary instead.
        Err(ShutdownError::NotFound { .. }) => Ok(()),
        Err(e) => Err(err_to_json::<ShutdownError>(e)),
    }
}

#[tauri::command]
pub async fn kill_runner(
    session_id: String,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> Result<(), String> {
    // Kill is just shutdown with a near-zero timeout — the manager's
    // shutdown path already falls back to forced kill after the timeout.
    match manager
        .shutdown(&session_id, Some(Duration::from_millis(10)))
        .await
    {
        Ok(()) => Ok(()),
        Err(ShutdownError::NotFound { .. }) => Ok(()),
        Err(e) => Err(err_to_json::<ShutdownError>(e)),
    }
}

/// Tauri's async-command harness requires the return type to be `Result`
/// (so an `Err` short-circuits the JSON envelope). Stderr-tail can't
/// really fail — it just returns an empty Vec for unknown session ids —
/// so the `Err` half is `()` and callers never see it.
#[tauri::command]
pub async fn runner_stderr_tail(
    session_id: String,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> Result<Vec<String>, ()> {
    Ok(manager.stderr_tail(&session_id).await.unwrap_or_default())
}

#[tauri::command]
pub async fn probe_ga_runtime(args: ProbeGaRuntimeArgs) -> Result<ProbeGaRuntimeResult, String> {
    Ok(run_ga_runtime_probe(args).await)
}

#[tauri::command]
pub async fn shutdown_all_runners(
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> Result<(), String> {
    manager.shutdown_all(Duration::from_secs(5)).await;
    Ok(())
}

/// Background task that subscribes to a session's broadcast and re-emits
/// as Tauri events to the GUI. Lives for the lifetime of the subprocess —
/// when the broadcast channel closes (subprocess exited, all senders
/// dropped) the task emits a final `runner-closed` event and terminates.
pub(crate) fn spawn_emit_task(
    notifier: std::sync::Arc<dyn crate::notify::Notifier>,
    session_id: String,
    mut rx: tokio::sync::broadcast::Receiver<BroadcastItem>,
) {
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(BroadcastItem::Event(boxed)) => {
                    let payload = RunnerEventEnvelope {
                        session_id: session_id.clone(),
                        event: *boxed,
                    };
                    crate::notify::notify(notifier.as_ref(), "runner-event", &payload);
                }
                Ok(BroadcastItem::Malformed(line)) => {
                    let payload = RunnerMalformedPayload {
                        session_id: session_id.clone(),
                        line,
                    };
                    crate::notify::notify(notifier.as_ref(), "runner-malformed", &payload);
                }
                Ok(BroadcastItem::Closed { code, signal }) => {
                    let payload = RunnerClosedPayload {
                        session_id: session_id.clone(),
                        code,
                        signal,
                    };
                    crate::notify::notify(notifier.as_ref(), "runner-closed", &payload);
                    break;
                }
                Err(RecvError::Lagged(skipped)) => {
                    // Subscriber lagged past the broadcast capacity (1024
                    // events). Surface this as a structured warning event
                    // — the broadcast channel auto-skips, but the GUI
                    // should know it lost data. Re-loop; recv() will
                    // resume from the next live event.
                    eprintln!(
                        "[runner emit {session_id}] subscriber lagged, skipped {skipped} events"
                    );
                    continue;
                }
                Err(RecvError::Closed) => {
                    // Last-resort fallback: the stdout reader should normally emit
                    // BroadcastItem::Closed with an exit status before the
                    // channel closes, but channel closure still means this
                    // stream is over.
                    let payload = RunnerClosedPayload {
                        session_id: session_id.clone(),
                        code: None,
                        signal: None,
                    };
                    crate::notify::notify(notifier.as_ref(), "runner-closed", &payload);
                    break;
                }
            }
        }
    });
}

// Re-export IpcEvent locally so the envelope type can name it.
use crate::ipc::IpcEvent;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn spawn_args_from_json_camelcase() {
        let line = r#"{
            "python": "/usr/bin/python3",
            "gaPath": "/home/u/GA",
            "sessionId": "s1",
            "cwd": null,
            "workspaceRoot": "/home/u/project",
            "bridgeCwd": "/repo/runner",
            "llmIndex": 0,
            "runtimeKind": "managed",
            "env": [["FOO", "bar"]]
        }"#;
        let parsed: SpawnRunnerArgs = serde_json::from_str(line).expect("parse");
        assert_eq!(parsed.session_id, "s1");
        assert_eq!(parsed.bridge_cwd, "/repo/runner");
        assert_eq!(parsed.workspace_root.as_deref(), Some("/home/u/project"));
        assert_eq!(parsed.runtime_kind, Some(RuntimeKind::Managed));
        assert_eq!(parsed.env, vec![("FOO".to_string(), "bar".to_string())]);
        let spawn_args: SpawnArgs = parsed.into();
        assert_eq!(
            spawn_args.workspace_root.as_deref(),
            Some(Path::new("/home/u/project"))
        );
    }

    #[test]
    fn spawn_args_optional_fields_default_correctly() {
        let line = r#"{
            "python": "python3",
            "gaPath": "/ga",
            "sessionId": "s1",
            "bridgeCwd": "/cwd"
        }"#;
        let parsed: SpawnRunnerArgs = serde_json::from_str(line).expect("parse");
        assert!(parsed.cwd.is_none());
        assert!(parsed.workspace_root.is_none());
        assert!(parsed.llm_index.is_none());
        assert!(parsed.runtime_kind.is_none());
        assert!(parsed.env.is_empty());
        assert!(parsed.active_session_id.is_none());
    }

    #[test]
    fn runner_closed_payload_serializes_camelcase() {
        let p = RunnerClosedPayload {
            session_id: "s1".into(),
            code: Some(0),
            signal: None,
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"sessionId\":\"s1\""));
        assert!(s.contains("\"code\":0"));
        assert!(s.contains("\"signal\":null"));
    }

    #[test]
    fn runner_event_envelope_carries_kind_tag() {
        // The envelope wraps the IpcEvent in `event:` — the inner event
        // must retain its `kind` discriminator (serde tag).
        use crate::ipc::{IpcEvent as E, ReadyEvent};
        let envelope = RunnerEventEnvelope {
            session_id: "s1".into(),
            event: E::Ready(ReadyEvent {
                session_id: "s1".into(),
                protocol_version: "0.1".into(),
                ga_commit: "abc".into(),
                ga_commit_date: "x".into(),
                ga_path: "/".into(),
                llm_name: "l".into(),
                cwd: "/".into(),
                pid: 1,
                available_llms: vec![],
                timestamp: "t".into(),
            }),
        };
        let s = serde_json::to_string(&envelope).unwrap();
        assert!(s.contains("\"sessionId\":\"s1\""));
        assert!(s.contains("\"event\":"));
        assert!(s.contains("\"kind\":\"ready\""));
        assert!(s.contains("\"protocolVersion\":\"0.1\""));
    }
}
