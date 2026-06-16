//! Tauri-command surface that wraps [`crate::runner_manager::RunnerManager`].
//!
//! Five `#[tauri::command]`s are registered:
//!
//! 1. [`spawn_runner`] — spawn a new Python runner subprocess + start an
//!    emit task that fans broadcast events to the GUI
//! 2. [`send_to_runner`] — write a typed [`IpcCommand`] to the subprocess
//! 3. [`shutdown_runner`] — graceful shutdown (send `{kind:"shutdown"}` +
//!    wait), with a kill fallback on timeout
//! 4. [`kill_runner`] — immediate SIGKILL (no graceful negotiation)
//! 5. [`runner_stderr_tail`] — pull the last 8 stderr lines for the
//!    abnormal-exit toast
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
use crate::{
    codex_oauth, credential_store, managed_model_config, managed_prompt, managed_runtime,
    process_command,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::broadcast::error::RecvError;

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
    let galley =
        SqliteGalley::open()
            .await
            .map_err(|e| RunnerSpawnError::ManagedRuntimeInvalid {
                detail: format!("opening Galley database failed: {e}"),
            })?;
    let models = galley.list_managed_models().await.map_err(|e| {
        RunnerSpawnError::ManagedModelNotConfigured {
            detail: format!("loading managed model records failed: {e}"),
        }
    })?;
    let mut credential_allowlist: codex_oauth::CredentialIpcAllowlist = HashMap::new();
    let mut usable_models = Vec::new();
    for model in models {
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
            managed_prompt::RUNTIME_PROMPT.into(),
        ),
        (
            "GALLEY_PERSONA_PROMPT_TEXT".into(),
            managed_prompt::PERSONA_PROMPT.into(),
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

fn prepare_external_spawn_args(
    mut args: SpawnArgs,
    app: &AppHandle,
) -> Result<SpawnArgs, RunnerSpawnError> {
    args.ga_path = normalize_external_ga_path(&args.ga_path)?;

    // bridgeCwd is Galley's implementation detail, not user GA state.
    // Dev should run from the repo root; production should run from the
    // packaged resources dir. Ignore stale persisted bridgeCwd values such as
    // old developer-machine defaults.
    args.bridge_cwd = managed_runtime::bridge_cwd_for_app(app).map_err(|e| {
        RunnerSpawnError::BridgeCwdInvalid {
            detail: format!("resolving Galley bridge cwd failed: {e}"),
        }
    })?;
    Ok(args)
}

pub(crate) fn normalize_external_ga_path(raw: &PathBuf) -> Result<PathBuf, RunnerSpawnError> {
    normalize_external_ga_path_with_home(
        raw,
        directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()),
    )
}

fn normalize_external_ga_path_with_home(
    raw: &PathBuf,
    home_dir: Option<PathBuf>,
) -> Result<PathBuf, RunnerSpawnError> {
    let raw = raw.to_str().ok_or_else(|| RunnerSpawnError::PathEncoding {
        detail: format!("ga_path not UTF-8: {}", raw.display()),
    })?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(RunnerSpawnError::GaPathInvalid {
            detail: "ga_path is empty".into(),
        });
    }
    let path = expand_home_relative_path(trimmed, home_dir.as_deref())
        .unwrap_or_else(|| PathBuf::from(trimmed));
    if !path.is_dir() {
        return Err(RunnerSpawnError::GaPathInvalid {
            detail: format!("not a directory: {}", path.display()),
        });
    }
    Ok(path)
}

fn expand_home_relative_path(raw: &str, home_dir: Option<&Path>) -> Option<PathBuf> {
    let suffix = match raw {
        "~" => "",
        s if s.starts_with("~/") || s.starts_with("~\\") => &s[2..],
        _ => return None,
    };
    let home = home_dir?;
    if suffix.is_empty() {
        Some(home.to_path_buf())
    } else {
        Some(home.join(suffix))
    }
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
    match crate::runtime::route_for_runtime(runtime_kind) {
        crate::runtime::RuntimeRoute::PythonGa(RuntimeKind::Managed) => {
            spawn_args = prepare_managed_spawn_args(spawn_args, &app)
                .await
                .map_err(err_to_json::<RunnerSpawnError>)?;
        }
        crate::runtime::RuntimeRoute::PythonGa(RuntimeKind::External) => {
            spawn_args = prepare_external_spawn_args(spawn_args, &app)
                .map_err(err_to_json::<RunnerSpawnError>)?;
        }
        crate::runtime::RuntimeRoute::PythonGa(RuntimeKind::GalleyNative)
        | crate::runtime::RuntimeRoute::GalleyNative => {
            return Err(err_to_json(RunnerSpawnError::NativeRuntimeUnavailable {
                detail: crate::runtime::galley_native_execution_unavailable_message(),
            }));
        }
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

    spawn_emit_task(app, session_id.clone(), rx);

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

/// JSON-friendly args for a lightweight external-GA runtime probe.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeGaRuntimeArgs {
    pub python: String,
    pub ga_path: String,
    #[serde(default)]
    pub smoke_test: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeGaRuntimeLlm {
    pub index: i64,
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeGaRuntimeResult {
    pub ok: bool,
    #[serde(default)]
    pub llms: Vec<ProbeGaRuntimeLlm>,
    #[serde(default)]
    pub smoke_tested: bool,
    #[serde(default)]
    pub error_stage: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub traceback: Option<String>,
    #[serde(default)]
    pub stderr: Option<String>,
}

const GA_RUNTIME_PROBE_SCRIPT: &str = r#"
import json
import os
import sys
import traceback

_real_stdout = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr

def emit(payload):
    _real_stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _real_stdout.flush()

def collect_llms(agent):
    rows = []
    for index, name, is_current in agent.list_llms():
        rows.append({
            "index": int(index),
            "name": str(name),
            "isCurrent": bool(is_current),
        })
    if not rows:
        raise RuntimeError("GA did not report any configured LLMs.")
    return rows

def run_smoke(agent):
    client = getattr(agent, "llmclient", None)
    backend = getattr(client, "backend", None)
    if backend is None or not hasattr(backend, "raw_ask"):
        raise RuntimeError("Current LLM backend does not expose raw_ask().")

    saved = {}
    for name, value in (
        ("stream", False),
        ("max_tokens", 1),
        ("max_retries", 0),
        ("connect_timeout", 10),
        ("read_timeout", 30),
    ):
        if hasattr(backend, name):
            saved[name] = getattr(backend, name)
            setattr(backend, name, value)
    try:
        messages = [{"role": "user", "content": "Reply with OK only."}]
        text = ""
        for chunk in backend.raw_ask(messages):
            text += str(chunk)
            if len(text) > 240:
                break
        compact = text.strip()
        if "!!!Error" in compact:
            raise RuntimeError(compact[:500])
    finally:
        for name, value in saved.items():
            setattr(backend, name, value)

def main():
    ga_path = os.environ["GALLEY_PROBE_GA_PATH"]
    smoke_test = os.environ.get("GALLEY_PROBE_SMOKE_TEST") == "1"
    stage = "runtime"
    llms = []
    try:
        if ga_path not in sys.path:
            sys.path.insert(0, ga_path)
        frontends_dir = os.path.join(ga_path, "frontends")
        if frontends_dir not in sys.path:
            sys.path.insert(0, frontends_dir)
        os.chdir(ga_path)

        import agentmain

        agent = agentmain.GeneraticAgent()
        llms = collect_llms(agent)
        if smoke_test:
            stage = "llm"
            run_smoke(agent)
        emit({
            "ok": True,
            "llms": llms,
            "smokeTested": smoke_test,
        })
    except Exception as exc:
        emit({
            "ok": False,
            "llms": llms,
            "smokeTested": smoke_test and stage == "llm",
            "errorStage": stage,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        })
        raise SystemExit(1)

main()
"#;

#[tauri::command]
pub async fn probe_ga_runtime(args: ProbeGaRuntimeArgs) -> Result<ProbeGaRuntimeResult, String> {
    Ok(run_ga_runtime_probe(args).await)
}

async fn run_ga_runtime_probe(args: ProbeGaRuntimeArgs) -> ProbeGaRuntimeResult {
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(45_000));
    let ga_path = PathBuf::from(&args.ga_path);
    if !ga_path.is_dir() {
        return probe_failure(
            "runtime",
            format!("GA path is not a directory: {}", ga_path.display()),
            None,
            None,
        );
    }

    let state_root = std::env::temp_dir().join(format!(
        "galley-ga-probe-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    if let Err(e) = std::fs::create_dir_all(&state_root) {
        return probe_failure(
            "runtime",
            format!("creating probe state dir failed: {e}"),
            None,
            None,
        );
    }

    let mut cmd = tokio::process::Command::new(&args.python);
    cmd.args(["-c", GA_RUNTIME_PROBE_SCRIPT])
        .current_dir(&ga_path)
        .env("GALLEY_PROBE_GA_PATH", &args.ga_path)
        .env(
            "GALLEY_PROBE_SMOKE_TEST",
            if args.smoke_test { "1" } else { "0" },
        )
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("GALLEY_GA_STATE_ROOT", &state_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    process_command::configure_python(&mut cmd);

    let output = match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            let _ = std::fs::remove_dir_all(&state_root);
            return probe_failure(
                "spawn",
                format!("could not run '{}': {e}", args.python),
                None,
                None,
            );
        }
        Err(_) => {
            let _ = std::fs::remove_dir_all(&state_root);
            return probe_failure(
                "timeout",
                format!(
                    "GA runtime probe did not finish within {}ms",
                    timeout.as_millis()
                ),
                None,
                None,
            );
        }
    };
    let _ = std::fs::remove_dir_all(&state_root);

    parse_probe_output(&output.stdout, &output.stderr).unwrap_or_else(|| {
        probe_failure(
            "runtime",
            "GA runtime probe did not return JSON".into(),
            Some(String::from_utf8_lossy(&output.stderr).into_owned()),
            Some(String::from_utf8_lossy(&output.stdout).into_owned()),
        )
    })
}

fn parse_probe_output(stdout: &[u8], stderr: &[u8]) -> Option<ProbeGaRuntimeResult> {
    let stdout = String::from_utf8_lossy(stdout);
    let stderr = compact_output(&String::from_utf8_lossy(stderr));
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{'))?;
    let mut result: ProbeGaRuntimeResult = serde_json::from_str(line).ok()?;
    if !stderr.is_empty() {
        result.stderr = Some(stderr);
    }
    Some(result)
}

fn probe_failure(
    stage: &str,
    error: String,
    stderr: Option<String>,
    traceback: Option<String>,
) -> ProbeGaRuntimeResult {
    ProbeGaRuntimeResult {
        ok: false,
        llms: Vec::new(),
        smoke_tested: false,
        error_stage: Some(stage.into()),
        error: Some(error),
        traceback,
        stderr: stderr.map(|s| compact_output(&s)).filter(|s| !s.is_empty()),
    }
}

fn compact_output(raw: &str) -> String {
    let lines: Vec<&str> = raw.lines().filter(|line| !line.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(12);
    lines[start..].join("\n")
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
    app: AppHandle,
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
                    let _ = app.emit("runner-event", payload);
                }
                Ok(BroadcastItem::Malformed(line)) => {
                    let payload = RunnerMalformedPayload {
                        session_id: session_id.clone(),
                        line,
                    };
                    let _ = app.emit("runner-malformed", payload);
                }
                Ok(BroadcastItem::Closed { code, signal }) => {
                    let payload = RunnerClosedPayload {
                        session_id: session_id.clone(),
                        code,
                        signal,
                    };
                    let _ = app.emit("runner-closed", payload);
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
                    let _ = app.emit("runner-closed", payload);
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

    #[test]
    fn spawn_args_from_json_camelcase() {
        let line = r#"{
            "python": "/usr/bin/python3",
            "gaPath": "/home/u/GA",
            "sessionId": "s1",
            "cwd": null,
            "bridgeCwd": "/repo/runner",
            "llmIndex": 0,
            "runtimeKind": "managed",
            "env": [["FOO", "bar"]]
        }"#;
        let parsed: SpawnRunnerArgs = serde_json::from_str(line).expect("parse");
        assert_eq!(parsed.session_id, "s1");
        assert_eq!(parsed.bridge_cwd, "/repo/runner");
        assert_eq!(parsed.runtime_kind, Some(RuntimeKind::Managed));
        assert_eq!(parsed.env, vec![("FOO".to_string(), "bar".to_string())]);
    }

    #[test]
    fn spawn_args_accept_native_runtime_identity() {
        let line = r#"{
            "python": "python3",
            "gaPath": "",
            "sessionId": "s1",
            "bridgeCwd": ".",
            "runtimeKind": "galley_native"
        }"#;
        let parsed: SpawnRunnerArgs = serde_json::from_str(line).expect("parse");
        assert_eq!(parsed.runtime_kind, Some(RuntimeKind::GalleyNative));
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
        assert!(parsed.llm_index.is_none());
        assert!(parsed.runtime_kind.is_none());
        assert!(parsed.env.is_empty());
        assert!(parsed.active_session_id.is_none());
    }

    #[test]
    fn external_ga_path_normalization_trims_pasted_whitespace() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let raw = PathBuf::from(format!(" {} ", dir.path().display()));
        let normalized = normalize_external_ga_path(&raw).expect("normalize");
        assert_eq!(normalized, dir.path());
    }

    #[test]
    fn external_ga_path_normalization_rejects_empty_after_trim() {
        match normalize_external_ga_path(&PathBuf::from("  ")) {
            Err(RunnerSpawnError::GaPathInvalid { detail }) => {
                assert_eq!(detail, "ga_path is empty");
            }
            Err(other) => panic!("expected GaPathInvalid, got {}", other),
            Ok(_) => panic!("expected error, got Ok"),
        }
    }

    #[test]
    fn external_ga_path_normalization_expands_home_relative_paths() {
        let home = tempfile::TempDir::new().expect("home tempdir");
        let dir = home.path().join("GenericAgent");
        std::fs::create_dir(&dir).expect("ga dir");
        let normalized = normalize_external_ga_path_with_home(
            &PathBuf::from(" ~/GenericAgent "),
            Some(home.path().to_path_buf()),
        )
        .expect("normalize");
        assert_eq!(normalized, dir);
    }

    #[test]
    fn external_ga_path_normalization_expands_windows_style_home_relative_paths() {
        let home = tempfile::TempDir::new().expect("home tempdir");
        let dir = home.path().join("GenericAgent");
        std::fs::create_dir(&dir).expect("ga dir");
        let normalized = normalize_external_ga_path_with_home(
            &PathBuf::from(" ~\\GenericAgent "),
            Some(home.path().to_path_buf()),
        )
        .expect("normalize");
        assert_eq!(normalized, dir);
    }

    #[test]
    fn parse_probe_output_reads_last_json_line_and_keeps_stderr_tail() {
        let stdout = br#"
noise before json
{"ok":true,"llms":[{"index":0,"name":"NativeClaudeSession/sonnet","isCurrent":true}],"smokeTested":true}
"#;
        let stderr = b"line 1\nline 2\n";
        let parsed = parse_probe_output(stdout, stderr).expect("parse probe output");
        assert!(parsed.ok);
        assert!(parsed.smoke_tested);
        assert_eq!(parsed.llms.len(), 1);
        assert_eq!(parsed.llms[0].index, 0);
        assert_eq!(parsed.llms[0].name, "NativeClaudeSession/sonnet");
        assert_eq!(parsed.stderr.as_deref(), Some("line 1\nline 2"));
    }

    #[test]
    fn probe_failure_compacts_long_stderr() {
        let stderr = (0..20)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let failure = probe_failure("runtime", "failed".into(), Some(stderr), None);
        assert!(!failure.ok);
        let compact = failure.stderr.expect("stderr");
        assert!(!compact.contains("line 0"));
        assert!(compact.contains("line 8"));
        assert!(compact.contains("line 19"));
    }

    #[tokio::test]
    async fn ga_runtime_probe_loads_fake_ga_and_runs_smoke() {
        let Some(python) = available_python() else {
            return;
        };
        let ga = tempfile::TempDir::new().expect("fake ga");
        std::fs::write(
            ga.path().join("agentmain.py"),
            r#"
class Backend:
    name = "demo"
    model = "demo"
    stream = False
    max_tokens = None
    max_retries = 0
    connect_timeout = 1
    read_timeout = 1
    def raw_ask(self, messages):
        yield "OK"

class Client:
    def __init__(self):
        self.backend = Backend()

class GeneraticAgent:
    def __init__(self):
        self.llmclient = Client()
    def list_llms(self):
        return [(0, "Fake/demo", True)]
"#,
        )
        .expect("write fake ga");

        let result = run_ga_runtime_probe(ProbeGaRuntimeArgs {
            python,
            ga_path: ga.path().to_string_lossy().into_owned(),
            smoke_test: true,
            timeout_ms: Some(5_000),
        })
        .await;

        assert!(result.ok, "{result:?}");
        assert!(result.smoke_tested);
        assert_eq!(result.llms.len(), 1);
        assert_eq!(result.llms[0].name, "Fake/demo");
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

    fn available_python() -> Option<String> {
        for candidate in ["python3", "python"] {
            if std::process::Command::new(candidate)
                .arg("--version")
                .output()
                .is_ok_and(|output| output.status.success())
            {
                return Some(candidate.into());
            }
        }
        None
    }
}
