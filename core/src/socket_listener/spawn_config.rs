//! Runner spawn-argument resolution for socket-created sessions:
//! managed-vs-external runtime config, the `ga_config` pref shape,
//! python interpreter aliases, bridge cwd, and the project workspace
//! root. Shared by `session.new` (`session_new_cmds`) and the goal-turn
//! runner ensure path (`session_goal_cmds`).

use super::common::SocketResponseLite;
use super::*;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GaConfigPref {
    #[serde(default)]
    python: Option<String>,
    #[serde(default)]
    ga_path: Option<String>,
    #[serde(default)]
    bridge_cwd: Option<String>,
    #[serde(default)]
    use_external_python: Option<bool>,
}

pub(super) async fn spawn_args_for_session_new(
    galley: &SqliteGalley,
    app: Option<&AppHandle>,
    session_id: &str,
    project_id: Option<&str>,
    llm_index: Option<u32>,
    llm_key: Option<String>,
    runtime_kind: RuntimeKind,
) -> Result<SpawnArgs, SocketResponseLite> {
    let workspace_root = workspace_root_for_project(galley, project_id).await?;
    if runtime_kind == RuntimeKind::Managed {
        let app = app.ok_or_else(|| {
            SocketResponseLite::runner_error(
                "managed runtime is unavailable without a Galley app handle",
            )
        })?;
        let args = SpawnArgs {
            python: resolve_python_for_socket(&GaConfigPref::default(), Some(app))?,
            ga_path: PathBuf::new(),
            session_id: session_id.to_string(),
            cwd: None,
            workspace_root,
            bridge_cwd: PathBuf::new(),
            llm_index: llm_index.map(i64::from),
            llm_key,
            env: Vec::new(),
        };
        return prepare_managed_spawn_args(args, app)
            .await
            .map_err(SocketResponseLite::runner_spawn_error);
    }

    let raw = galley
        .get_pref_json("ga_config")
        .await
        .map_err(SocketResponseLite::from_err)?
        .ok_or_else(|| {
            SocketResponseLite::runner_error(
                "session.new runner config is missing; open Galley Settings once to save runtime paths",
            )
        })?;
    let config: GaConfigPref = serde_json::from_value(raw).map_err(|e| {
        SocketResponseLite::runner_error(format!("ga_config pref shape mismatch: {e}"))
    })?;
    let ga_path = normalize_external_ga_path(&PathBuf::from(non_empty_pref(
        config.ga_path.as_deref(),
        "gaPath",
    )?))
    .map_err(SocketResponseLite::runner_spawn_error)?;

    let bridge_cwd = resolve_bridge_cwd(&config, app)?;
    let python = resolve_python_for_socket(&config, app)?;

    Ok(SpawnArgs {
        python,
        ga_path,
        session_id: session_id.to_string(),
        cwd: None,
        workspace_root,
        bridge_cwd,
        llm_index: llm_index.map(i64::from),
        llm_key,
        env: Vec::new(),
    })
}

async fn workspace_root_for_project(
    galley: &SqliteGalley,
    project_id: Option<&str>,
) -> Result<Option<PathBuf>, SocketResponseLite> {
    let Some(project_id) = project_id else {
        return Ok(None);
    };
    let projects = galley
        .list_projects()
        .await
        .map_err(SocketResponseLite::from_err)?;
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

fn non_empty_pref(value: Option<&str>, key: &str) -> Result<String, SocketResponseLite> {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Err(SocketResponseLite::runner_error(format!(
            "session.new runner config missing {key}"
        )));
    };
    Ok(v.to_string())
}

fn resolve_bridge_cwd(
    config: &GaConfigPref,
    app: Option<&AppHandle>,
) -> Result<PathBuf, SocketResponseLite> {
    if let Some(app) = app {
        return managed_runtime::bridge_cwd_for_app(app).map_err(|e| {
            SocketResponseLite::runner_error(format!("resolving Galley bridge cwd failed: {e}"))
        });
    }
    let bridge_cwd = PathBuf::from(non_empty_pref(config.bridge_cwd.as_deref(), "bridgeCwd")?);
    if !bridge_cwd.is_dir() {
        return Err(SocketResponseLite::runner_error(format!(
            "bridge cwd invalid: not a directory: {}",
            bridge_cwd.display()
        )));
    }
    Ok(bridge_cwd)
}

fn resolve_python_for_socket(
    config: &GaConfigPref,
    app: Option<&AppHandle>,
) -> Result<String, SocketResponseLite> {
    let want_bundled = !cfg!(debug_assertions) && !config.use_external_python.unwrap_or(false);
    if want_bundled {
        if let Some(app) = app {
            if let Ok(resource_dir) = app.path().resource_dir() {
                let rel = if cfg!(windows) {
                    "python/python.exe"
                } else {
                    "python/bin/python3"
                };
                return path_to_utf8(resource_dir.join(rel), "bundled python");
            }
        }
    }

    let fallback = default_python_name();
    let raw = config
        .python
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback);
    Ok(resolve_python_alias(raw).unwrap_or_else(|| fallback.to_string()))
}

fn default_python_name() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn resolve_python_alias(raw: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
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
        p if p.starts_with('/') || p.starts_with('\\') || looks_like_windows_abs_path(p) => {
            p.to_string()
        }
        _ => return None,
    };
    Some(path)
}

fn looks_like_windows_abs_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn path_to_utf8(path: PathBuf, label: &str) -> Result<String, SocketResponseLite> {
    path.into_os_string().into_string().map_err(|_| {
        SocketResponseLite::runner_error(format!("{label} path contains non-UTF-8 characters"))
    })
}
