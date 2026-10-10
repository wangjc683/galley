//! Runner spawn-argument resolution: the managed-vs-external runtime
//! split, the `ga_config` pref, Python interpreter selection, Galley's
//! bridge cwd and the project workspace root.
//!
//! One rule set for every caller. Until ticket 02a there were two: the
//! GUI assembled `SpawnRunnerArgs` in TypeScript (`gui/src/lib/bridge.ts`
//! + `lifecycle-slice.ts`) while the socket path resolved its own here
//! (`socket_listener/spawn_config.rs`). Where they differed, the GUI's
//! behavior won (it was the main path):
//!
//! - Python ([`resolve_python`]) follows the GUI's `shouldUseBundledPython`
//!   + `resolvePythonPath`: dev builds never use the bundle and resolve the
//!   configured `python` for **both** runtimes (the socket path used to
//!   hand managed spawns a blank config, i.e. `python3`); packaged builds
//!   pin the managed runtime to the bundle and let external sessions opt
//!   out with `useExternalPython`.
//! - The stored pref is read the way the GUI's `hydratePrefs` reads it: a
//!   `ga_config` without a `gaPath` counts as no config at all.
//! - External `ga_path` goes through `normalize_external_ga_path` and the
//!   bridge cwd is always Galley's own when an app is present (both paths
//!   already agreed there).
//!
//! Errors are [`SessionRunnerError`]s; each transport renders them its own
//! way (the socket layer byte-for-byte as before, see
//! `socket_listener::common`).

use super::SessionRunnerError;
use crate::api::{GalleyApi, RuntimeKind};
use crate::db::SqliteGalley;
use crate::managed_runtime;
use crate::runner_commands::normalize_external_ga_path;
use crate::runner_manager::{RunnerSpawnError, SpawnArgs};
use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Shape of the `ga_config` pref (and of the GUI's in-memory `gaConfig`,
/// which the Tauri command may pass as an override). Every field is
/// optional so a partial or legacy value still parses.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GaConfigPref {
    #[serde(default)]
    pub python: Option<String>,
    #[serde(default)]
    pub ga_path: Option<String>,
    #[serde(default)]
    pub bridge_cwd: Option<String>,
    #[serde(default)]
    pub use_external_python: Option<bool>,
}

/// What resolution needs from the host app. Production passes the Tauri
/// [`AppHandle`]; headless dispatch (socket handler tests) passes none,
/// and tests that need the managed path pass a fake.
#[async_trait]
pub trait SpawnEnv: Send + Sync {
    /// The bundled interpreter (`$RESOURCE/python/...`), if resolvable.
    fn bundled_python(&self) -> Option<PathBuf>;
    /// Galley's own bridge cwd (repo root in dev, resource dir packaged).
    fn bridge_cwd(&self) -> Result<PathBuf, String>;
    /// Managed-runtime preparation: code root, model config, credentials.
    async fn prepare_managed(&self, args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError>;
}

#[async_trait]
impl SpawnEnv for AppHandle {
    fn bundled_python(&self) -> Option<PathBuf> {
        let resource_dir = self.path().resource_dir().ok()?;
        let rel = if cfg!(windows) {
            "python/python.exe"
        } else {
            "python/bin/python3"
        };
        Some(resource_dir.join(rel))
    }

    fn bridge_cwd(&self) -> Result<PathBuf, String> {
        managed_runtime::bridge_cwd_for_app(self).map_err(|e| e.to_string())
    }

    async fn prepare_managed(&self, args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError> {
        crate::runner_commands::prepare_managed_spawn_args(args, self).await
    }
}

/// Everything [`resolve_spawn_args`] needs besides the DB and the env.
#[derive(Debug, Clone)]
pub struct SpawnRequest<'a> {
    pub session_id: &'a str,
    pub project_id: Option<&'a str>,
    pub runtime_kind: RuntimeKind,
    pub llm_index: Option<i64>,
    pub llm_key: Option<String>,
    pub reasoning_effort: Option<String>,
    /// Use this config instead of the stored `ga_config` pref. Only the
    /// GUI passes one (its in-memory `gaConfig`, transitional — see the
    /// Tauri `ensure_session_runner` command).
    pub ga_config: Option<GaConfigPref>,
}

/// Resolve the [`SpawnArgs`] for one session runner.
pub async fn resolve_spawn_args(
    galley: &SqliteGalley,
    env: Option<&dyn SpawnEnv>,
    req: SpawnRequest<'_>,
) -> Result<SpawnArgs, SessionRunnerError> {
    let workspace_root = workspace_root_for_project(galley, req.project_id).await?;
    if req.runtime_kind == RuntimeKind::Managed {
        let env = env.ok_or(SessionRunnerError::ManagedNeedsApp)?;
        // The managed runtime needs no GA path; the config only picks the
        // dev-build interpreter, so an unusable pref is not an error.
        let config = match req.ga_config {
            Some(config) => config,
            None => stored_config_for_python(galley).await,
        };
        let args = SpawnArgs {
            python: resolve_python(&config, RuntimeKind::Managed, Some(env))?,
            ga_path: PathBuf::new(),
            session_id: req.session_id.to_string(),
            cwd: None,
            workspace_root,
            bridge_cwd: PathBuf::new(),
            llm_index: req.llm_index,
            llm_key: req.llm_key,
            reasoning_effort: req.reasoning_effort,
            env: Vec::new(),
        };
        return env
            .prepare_managed(args)
            .await
            .map_err(SessionRunnerError::Spawn);
    }

    let config = match req.ga_config {
        Some(config) => config,
        None => {
            let raw = galley
                .get_pref_json("ga_config")
                .await
                .map_err(SessionRunnerError::Db)?
                .ok_or(SessionRunnerError::GaConfigMissing)?;
            serde_json::from_value::<GaConfigPref>(raw)
                .map_err(|e| SessionRunnerError::GaConfigShape(e.to_string()))?
        }
    };
    let ga_path = normalize_external_ga_path(&PathBuf::from(non_empty(
        config.ga_path.as_deref(),
        "gaPath",
    )?))
    .map_err(SessionRunnerError::Spawn)?;
    let bridge_cwd = resolve_bridge_cwd(&config, env)?;
    let python = resolve_python(&config, RuntimeKind::External, env)?;

    Ok(SpawnArgs {
        python,
        ga_path,
        session_id: req.session_id.to_string(),
        cwd: None,
        workspace_root,
        bridge_cwd,
        llm_index: req.llm_index,
        llm_key: req.llm_key,
        reasoning_effort: req.reasoning_effort,
        env: Vec::new(),
    })
}

/// The stored `ga_config`, read the way the GUI's `hydratePrefs` reads
/// it: missing, unreadable, or without a `gaPath` means "no config" and
/// the defaults apply.
async fn stored_config_for_python(galley: &SqliteGalley) -> GaConfigPref {
    let Ok(Some(raw)) = galley.get_pref_json("ga_config").await else {
        return GaConfigPref::default();
    };
    match serde_json::from_value::<GaConfigPref>(raw) {
        Ok(config) if config.ga_path.as_deref().is_some_and(|p| !p.is_empty()) => config,
        _ => GaConfigPref::default(),
    }
}

async fn workspace_root_for_project(
    galley: &SqliteGalley,
    project_id: Option<&str>,
) -> Result<Option<PathBuf>, SessionRunnerError> {
    let Some(project_id) = project_id else {
        return Ok(None);
    };
    let projects = galley
        .list_projects()
        .await
        .map_err(SessionRunnerError::Db)?;
    let Some(project) = projects.into_iter().find(|p| p.id.as_str() == project_id) else {
        return Ok(None);
    };
    if !project.workspace_enabled {
        return Ok(None);
    }
    Ok(project
        .root_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from))
}

fn non_empty(value: Option<&str>, key: &'static str) -> Result<String, SessionRunnerError> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or(SessionRunnerError::GaConfigKeyMissing(key))
}

fn resolve_bridge_cwd(
    config: &GaConfigPref,
    env: Option<&dyn SpawnEnv>,
) -> Result<PathBuf, SessionRunnerError> {
    // bridgeCwd is Galley's implementation detail, not user GA state: with
    // an app, always Galley's own (a persisted value may be a stale
    // developer-machine default). Headless dispatch has no app to ask.
    if let Some(env) = env {
        return env
            .bridge_cwd()
            .map_err(SessionRunnerError::BridgeCwdResolve);
    }
    let bridge_cwd = PathBuf::from(non_empty(config.bridge_cwd.as_deref(), "bridgeCwd")?);
    if !bridge_cwd.is_dir() {
        return Err(SessionRunnerError::BridgeCwdNotDir(bridge_cwd));
    }
    Ok(bridge_cwd)
}

/// Mirror of the GUI's `shouldUseBundledPython` (`gui/src/lib/bridge.ts`):
/// dev builds never use the bundle (it only exists after `tauri build`);
/// packaged managed sessions always do (a release contract); packaged
/// external sessions do unless the user switched to an external Python.
pub(crate) fn wants_bundled_python(
    release_build: bool,
    runtime_kind: RuntimeKind,
    use_external_python: bool,
) -> bool {
    if !release_build {
        return false;
    }
    runtime_kind == RuntimeKind::Managed || !use_external_python
}

/// The interpreter a runner is spawned with.
pub(crate) fn resolve_python(
    config: &GaConfigPref,
    runtime_kind: RuntimeKind,
    env: Option<&dyn SpawnEnv>,
) -> Result<String, SessionRunnerError> {
    let want_bundled = wants_bundled_python(
        !cfg!(debug_assertions),
        runtime_kind,
        config.use_external_python.unwrap_or(false),
    );
    if want_bundled {
        // An unresolvable resource dir falls back to the configured
        // interpreter, as the GUI's `resolvePythonPath` does.
        if let Some(path) = env.and_then(|env| env.bundled_python()) {
            return path
                .into_os_string()
                .into_string()
                .map_err(|_| SessionRunnerError::NonUtf8Path("bundled python"));
        }
    }
    Ok(resolve_user_python(
        config.python.as_deref(),
        &std::env::var("HOME").unwrap_or_default(),
    ))
}

/// The configured (non-bundled) interpreter: an alias from the v0.1
/// candidate table, a bare `python3` / `python`, or a path — anything
/// else falls back to the platform default. Same table and rules as the
/// GUI's `resolvePythonPath` + `python-probe.ts`; the shared fixture
/// `core/tests/fixtures/python-aliases.json` holds both sides to it.
pub fn resolve_user_python(raw: Option<&str>, home: &str) -> String {
    let fallback = default_python_name();
    let raw = raw
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback);
    resolve_python_alias(raw, home).unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn default_python_name() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn resolve_python_alias(raw: &str, home: &str) -> Option<String> {
    let path = match raw {
        "python-ga-venv" => format!("{home}/Documents/GenericAgent/.venv/bin/python"),
        "python-ga-venv-alt" => format!("{home}/Documents/GenericAgent/venv/bin/python"),
        "python-brew-arm" => "/opt/homebrew/bin/python3".to_string(),
        "python-brew-intel" => "/usr/local/bin/python3".to_string(),
        "python-framework-3-14" => {
            "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3".to_string()
        }
        "python-framework-3-13" => {
            "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3".to_string()
        }
        "python-framework-3-12" => {
            "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3".to_string()
        }
        "python-framework-3-11" => {
            "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3".to_string()
        }
        "python3" | "python" => raw.to_string(),
        p if is_path_like(p) => p.to_string(),
        _ => return None,
    };
    Some(path)
}

/// Passes through untouched, like the GUI: POSIX / UNC-ish roots, an
/// upper-case drive prefix (`resolvePythonPath`'s `/^[A-Z]:/`), or a drive
/// letter followed by a separator (`python-probe.ts`'s `isAbsolutePath`).
fn is_path_like(path: &str) -> bool {
    if path.starts_with('/') || path.starts_with('\\') {
        return true;
    }
    let bytes = path.as_bytes();
    if bytes.len() < 2 || bytes[1] != b':' {
        return false;
    }
    bytes[0].is_ascii_uppercase()
        || (bytes[0].is_ascii_alphabetic()
            && bytes.len() >= 3
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_python_rule_matches_the_gui() {
        // Dev never uses the bundle.
        assert!(!wants_bundled_python(false, RuntimeKind::Managed, false));
        assert!(!wants_bundled_python(false, RuntimeKind::External, false));
        // Packaged managed ignores the external-Python switch.
        assert!(wants_bundled_python(true, RuntimeKind::Managed, true));
        assert!(wants_bundled_python(true, RuntimeKind::Managed, false));
        // Packaged external honors it.
        assert!(!wants_bundled_python(true, RuntimeKind::External, true));
        assert!(wants_bundled_python(true, RuntimeKind::External, false));
    }

    /// `core/tests/fixtures/python-aliases.json` is also asserted by the
    /// GUI's resolver (`gui/src/lib/python-aliases.fixture.test.ts`).
    #[test]
    fn python_alias_table_matches_the_shared_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/python-aliases.json"))
                .expect("fixture parses");
        let home = fixture["home"].as_str().expect("home");
        let cases = fixture["cases"].as_array().expect("cases");
        assert!(!cases.is_empty());
        for case in cases {
            let input = case["input"].as_str().expect("input");
            let expected = case["expected"]
                .as_str()
                .expect("expected")
                .replace("$HOME", home)
                .replace("$FALLBACK", default_python_name());
            assert_eq!(
                resolve_user_python(Some(input), home),
                expected,
                "python alias {input:?}"
            );
        }
        assert_eq!(resolve_user_python(None, home), default_python_name());
    }

    #[test]
    fn path_like_rule_matches_the_gui() {
        assert!(is_path_like("/usr/bin/python3"));
        assert!(is_path_like("\\\\server\\python.exe"));
        assert!(is_path_like("C:\\Python311\\python.exe"));
        assert!(is_path_like("c:/python/python.exe"));
        assert!(is_path_like("C:python"));
        assert!(!is_path_like("c:python"));
        assert!(!is_path_like("1:\\python"));
        assert!(!is_path_like("python-brew-arm"));
    }
}
