//! Managed / bundled GenericAgent runtime layout.
//!
//! This module owns paths and diagnostics for Galley's managed runtime. It
//! never reads or writes a user-owned external GenericAgent checkout.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::managed_model_config;
use crate::managed_prompt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MANIFEST_JSON: &str = include_str!("../../managed-ga/manifest.json");
const STATE_SCHEMA_VERSION: u32 = 1;
const MEMORY_SEED_REL: &str = "state-seed/memory";
const CRITICAL_MEMORY_SEED_FILES: &[&str] = &[
    "memory_management_sop.md",
    "plan_sop.md",
    "tmwebdriver_sop.md",
    "web_setup_sop.md",
    "deliverable_audit_sop.md",
    "supervisor_sop.md",
    "project_mode_sop.md",
    "L4_raw_sessions/salient_mining_sop.md",
    "L4_raw_sessions/compress_session.py",
];
pub use managed_prompt::PROMPT_PROFILE_ID;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRuntimeManifest {
    schema_version: u32,
    upstream: ManagedRuntimeUpstream,
    patch_stack: ManagedRuntimePatchStack,
    state_schema_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRuntimeUpstream {
    source: String,
    branch: String,
    commit: String,
    audited_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRuntimePatchStack {
    id: String,
    patches: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeDiagnostics {
    pub manifest_schema_version: u32,
    pub upstream_source: String,
    pub upstream_branch: String,
    pub upstream_commit: String,
    pub upstream_audited_at: String,
    pub patch_stack_id: String,
    pub patch_count: usize,
    pub state_schema_version: u32,
    pub prompt_profile_id: String,
    pub prompt_hash: String,
    pub paths: ManagedRuntimePaths,
    pub code: ManagedCodeDiagnostics,
    pub state: ManagedStateDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimePaths {
    pub resource_root: String,
    pub code_root: String,
    pub memory_seed_dir: String,
    pub manifest_path: String,
    pub patch_manifest_path: String,
    pub state_root: String,
    pub memory_dir: String,
    pub sop_dir: String,
    pub skills_dir: String,
    pub temp_dir: String,
    pub model_responses_dir: String,
    pub model_config_dir: String,
    pub model_config_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedCodeDiagnostics {
    pub resource_root_exists: bool,
    pub code_root_exists: bool,
    pub agentmain_exists: bool,
    pub manifest_exists: bool,
    pub patch_manifest_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedStateDiagnostics {
    pub initialized: bool,
    pub created_dirs: Vec<String>,
    pub model_config_exists: bool,
    pub memory_seed: ManagedMemorySeedDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedMemorySeedDiagnostics {
    pub source_exists: bool,
    pub critical_files_present: bool,
    pub critical_files_missing: Vec<String>,
    pub copied_files: Vec<String>,
}

pub fn ensure_for_app(app: &AppHandle) -> std::io::Result<ManagedRuntimeDiagnostics> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    ensure_layout(resolve_resource_root(&resource_dir), app_data_dir)
}

/// Apply [`crate::model_responses_prune`] retention to the managed
/// runtime's LLM log directory. Startup-only; see that module for why it
/// must run before any bridge is spawned.
pub fn prune_model_responses_for_app(
    app: &AppHandle,
) -> std::io::Result<crate::model_responses_prune::PruneOutcome> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    let paths = layout_paths(resolve_resource_root(&resource_dir), app_data_dir);
    crate::model_responses_prune::prune_model_responses(&paths.model_responses_dir)
}

/// The bundled memory seed and the managed `memory/`, resolved as
/// [`ensure_for_app`] resolves them (the repo's `managed-ga/` in a debug
/// build, the app resources in a release one).
pub fn memory_paths_for_app(app: &AppHandle) -> io::Result<(PathBuf, PathBuf)> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| io::Error::new(io::ErrorKind::NotFound, e))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| io::Error::new(io::ErrorKind::NotFound, e))?;
    let paths = layout_paths(resolve_resource_root(&resource_dir), app_data_dir);
    Ok((paths.memory_seed_dir, paths.memory_dir))
}

/// `memory/` swapped for the seed but not final yet
/// ([`stage_memory_reset`]): the old one waits beside it until
/// [`Self::commit`] deletes it or [`Self::rollback`] puts it back.
#[derive(Debug)]
#[must_use = "a staged memory reset must be committed or rolled back"]
pub struct StagedMemoryReset {
    memory_dir: PathBuf,
    /// Where the old `memory/` waits; `None` when there was none.
    set_aside: Option<PathBuf>,
}

impl StagedMemoryReset {
    /// Keep the seeded `memory/`: delete the old one.
    pub fn commit(self) -> io::Result<()> {
        match &self.set_aside {
            Some(old) => fs::remove_dir_all(old),
            None => Ok(()),
        }
    }

    /// Put the old `memory/` back as it was, dropping the seeded one.
    pub fn rollback(self) -> io::Result<()> {
        restore_memory(&self.memory_dir, self.set_aside.as_deref())
    }

    /// Where the old `memory/` waits until a commit or a rollback.
    pub fn set_aside(&self) -> Option<&Path> {
        self.set_aside.as_deref()
    }
}

/// Put `memory_dir` back to the installed seed: the only path that
/// rewrites the managed `memory/` whole (resetting the main chat, main
/// chat ticket 15). Upgrades never do — they only add missing seed files
/// ([`ensure_memory_seed`]), so the user's memory survives them.
///
/// Staged, so the caller can still undo it: `memory_dir` is renamed to a
/// sibling `memory.reset-<stamp>`, a fresh `memory_dir` gets a full copy
/// of the seed, and the old one waits for
/// [`StagedMemoryReset::commit`] / [`StagedMemoryReset::rollback`].
/// Nothing moves when the seed is missing or lacks a critical file. When
/// the copy fails, the partial copy is removed and the old `memory/`
/// renamed back before the error returns.
///
/// GA writes `global_mem.txt` and `global_mem_insight.txt` itself, from
/// its templates, the next time a runner starts and finds them missing
/// (`agentmain.py`), as on a fresh install.
pub fn stage_memory_reset(
    memory_seed_dir: &Path,
    memory_dir: &Path,
) -> io::Result<StagedMemoryReset> {
    stage_memory_reset_with(memory_seed_dir, memory_dir, |seed, target| {
        copy_missing_tree(seed, target, seed, &mut Vec::new())
    })
}

/// [`stage_memory_reset`] with the copy step passed in, so a test can
/// make it fail.
fn stage_memory_reset_with(
    memory_seed_dir: &Path,
    memory_dir: &Path,
    copy: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<StagedMemoryReset> {
    let missing: Vec<&str> = CRITICAL_MEMORY_SEED_FILES
        .iter()
        .copied()
        .filter(|rel| !memory_seed_dir.join(rel_to_path(rel)).is_file())
        .collect();
    if !memory_seed_dir.is_dir() || !missing.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "memory seed {} is missing or incomplete (missing: {}); memory/ was not touched",
                memory_seed_dir.display(),
                missing.join(", ")
            ),
        ));
    }
    let set_aside = if fs::symlink_metadata(memory_dir).is_ok() {
        let aside = set_aside_path(memory_dir)?;
        fs::rename(memory_dir, &aside)?;
        Some(aside)
    } else {
        None
    };
    let copied = fs::create_dir(memory_dir).and_then(|()| copy(memory_seed_dir, memory_dir));
    if let Err(copy_err) = copied {
        return Err(match restore_memory(memory_dir, set_aside.as_deref()) {
            Ok(()) => io::Error::new(
                copy_err.kind(),
                format!("copying the memory seed failed, memory/ is back as it was: {copy_err}"),
            ),
            Err(restore_err) => io::Error::new(
                restore_err.kind(),
                format!(
                    "copying the memory seed failed ({copy_err}), and putting memory/ back \
                     failed too ({restore_err}); the old memory is at {}",
                    set_aside
                        .as_deref()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "(there was none)".into())
                ),
            ),
        });
    }
    Ok(StagedMemoryReset {
        memory_dir: memory_dir.to_path_buf(),
        set_aside,
    })
}

/// Drop whatever is at `memory_dir` and move `set_aside` back there.
fn restore_memory(memory_dir: &Path, set_aside: Option<&Path>) -> io::Result<()> {
    if fs::symlink_metadata(memory_dir).is_ok() {
        fs::remove_dir_all(memory_dir)?;
    }
    if let Some(old) = set_aside {
        fs::rename(old, memory_dir)?;
    }
    Ok(())
}

/// A free sibling of `memory_dir` to move it aside to:
/// `memory.reset-<UTC stamp>`, with `-2`, `-3`… when taken.
fn set_aside_path(memory_dir: &Path) -> io::Result<PathBuf> {
    let (Some(parent), Some(name)) = (memory_dir.parent(), memory_dir.file_name()) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("memory dir {} has no parent", memory_dir.display()),
        ));
    };
    let base = format!(
        "{}.reset-{}",
        name.to_string_lossy(),
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    );
    (1..=100)
        .map(|n| match n {
            1 => parent.join(&base),
            n => parent.join(format!("{base}-{n}")),
        })
        .find(|candidate| fs::symlink_metadata(candidate).is_err())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("no free name to set {} aside", memory_dir.display()),
            )
        })
}

pub fn bridge_cwd_for_app(app: &AppHandle) -> std::io::Result<PathBuf> {
    if cfg!(debug_assertions) {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("core/ has repo parent")
            .to_path_buf())
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))
    }
}

fn ensure_layout(
    resource_root: PathBuf,
    app_data_dir: PathBuf,
) -> std::io::Result<ManagedRuntimeDiagnostics> {
    let manifest = parse_manifest()?;
    let paths = layout_paths(resource_root, app_data_dir);
    let mut created_dirs = Vec::new();
    for dir in [
        &paths.state_root,
        &paths.memory_dir,
        &paths.sop_dir,
        &paths.skills_dir,
        &paths.temp_dir,
        &paths.model_responses_dir,
        &paths.model_config_dir,
    ] {
        if !dir.exists() {
            fs::create_dir_all(dir)?;
            created_dirs.push(path_to_string(dir));
        }
    }

    let memory_seed = ensure_memory_seed(&paths.memory_seed_dir, &paths.memory_dir)?;

    let state_initialized = [
        &paths.state_root,
        &paths.memory_dir,
        &paths.sop_dir,
        &paths.skills_dir,
        &paths.temp_dir,
        &paths.model_responses_dir,
        &paths.model_config_dir,
    ]
    .iter()
    .all(|dir| dir.is_dir());

    Ok(ManagedRuntimeDiagnostics {
        manifest_schema_version: manifest.schema_version,
        upstream_source: manifest.upstream.source,
        upstream_branch: manifest.upstream.branch,
        upstream_commit: manifest.upstream.commit,
        upstream_audited_at: manifest.upstream.audited_at,
        patch_stack_id: manifest.patch_stack.id,
        patch_count: manifest.patch_stack.patches.len(),
        state_schema_version: manifest.state_schema_version,
        prompt_profile_id: PROMPT_PROFILE_ID.into(),
        prompt_hash: managed_prompt::prompt_hash(),
        paths: ManagedRuntimePaths {
            resource_root: path_to_string(&paths.resource_root),
            code_root: path_to_string(&paths.code_root),
            memory_seed_dir: path_to_string(&paths.memory_seed_dir),
            manifest_path: path_to_string(&paths.manifest_path),
            patch_manifest_path: path_to_string(&paths.patch_manifest_path),
            state_root: path_to_string(&paths.state_root),
            memory_dir: path_to_string(&paths.memory_dir),
            sop_dir: path_to_string(&paths.sop_dir),
            skills_dir: path_to_string(&paths.skills_dir),
            temp_dir: path_to_string(&paths.temp_dir),
            model_responses_dir: path_to_string(&paths.model_responses_dir),
            model_config_dir: path_to_string(&paths.model_config_dir),
            model_config_path: path_to_string(&paths.model_config_path),
        },
        code: ManagedCodeDiagnostics {
            resource_root_exists: paths.resource_root.is_dir(),
            code_root_exists: paths.code_root.is_dir(),
            agentmain_exists: paths.code_root.join("agentmain.py").is_file(),
            manifest_exists: paths.manifest_path.is_file(),
            patch_manifest_exists: paths.patch_manifest_path.is_file(),
        },
        state: ManagedStateDiagnostics {
            initialized: state_initialized,
            created_dirs,
            model_config_exists: paths.model_config_path.is_file(),
            memory_seed,
        },
    })
}

fn ensure_memory_seed(
    memory_seed_dir: &Path,
    memory_dir: &Path,
) -> io::Result<ManagedMemorySeedDiagnostics> {
    let source_exists = memory_seed_dir.is_dir();
    let mut copied_files = Vec::new();
    if source_exists {
        copy_missing_tree(
            memory_seed_dir,
            memory_dir,
            memory_seed_dir,
            &mut copied_files,
        )?;
    }
    copied_files.sort();

    let critical_files_missing = CRITICAL_MEMORY_SEED_FILES
        .iter()
        .filter(|rel| !memory_dir.join(rel_to_path(rel)).is_file())
        .map(|rel| (*rel).to_string())
        .collect::<Vec<_>>();
    let critical_files_present = critical_files_missing.is_empty();

    Ok(ManagedMemorySeedDiagnostics {
        source_exists,
        critical_files_present,
        critical_files_missing,
        copied_files,
    })
}

fn copy_missing_tree(
    source_root: &Path,
    target_root: &Path,
    current: &Path,
    copied_files: &mut Vec<String>,
) -> io::Result<()> {
    let mut entries = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let source_path = entry.path();
        let file_type = entry.file_type()?;
        let rel = source_path
            .strip_prefix(source_root)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let target_path = target_root.join(rel);

        if file_type.is_dir() {
            fs::create_dir_all(&target_path)?;
            copy_missing_tree(source_root, target_root, &source_path, copied_files)?;
        } else if file_type.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &target_path)?;
            copied_files.push(path_to_slash(rel));
        }
    }

    Ok(())
}

fn parse_manifest() -> std::io::Result<ManagedRuntimeManifest> {
    let manifest = serde_json::from_str::<ManagedRuntimeManifest>(MANIFEST_JSON)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    if manifest.state_schema_version != STATE_SCHEMA_VERSION {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "managed runtime state schema mismatch: manifest={}, code={}",
                manifest.state_schema_version, STATE_SCHEMA_VERSION
            ),
        ));
    }
    Ok(manifest)
}

fn resolve_resource_root(resource_dir: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("core/ has repo parent")
            .join("managed-ga")
    } else {
        resource_dir.join("managed-ga")
    }
}

struct ManagedLayoutPaths {
    resource_root: PathBuf,
    code_root: PathBuf,
    memory_seed_dir: PathBuf,
    manifest_path: PathBuf,
    patch_manifest_path: PathBuf,
    state_root: PathBuf,
    memory_dir: PathBuf,
    sop_dir: PathBuf,
    skills_dir: PathBuf,
    temp_dir: PathBuf,
    model_responses_dir: PathBuf,
    model_config_dir: PathBuf,
    model_config_path: PathBuf,
}

fn layout_paths(resource_root: PathBuf, app_data_dir: PathBuf) -> ManagedLayoutPaths {
    let code_root = resource_root.join("code");
    let state_root = app_data_dir.join("managed-ga-state");
    // Upstream GA writes its LLM logs under `temp/` (`state_path('temp',
    // 'model_responses', ...)` in agentmain.py); until 2026-09-22 Galley
    // created and reported a sibling `managed-ga-state/model_responses/`
    // that nothing wrote to.
    let model_config_dir = app_data_dir.join("managed-model-config");
    let model_config_path = model_config_dir.join(managed_model_config::GENERATED_CONFIG_FILENAME);
    ManagedLayoutPaths {
        manifest_path: resource_root.join("manifest.json"),
        patch_manifest_path: resource_root.join("patches").join("manifest.md"),
        memory_seed_dir: resource_root.join(rel_to_path(MEMORY_SEED_REL)),
        code_root,
        resource_root,
        memory_dir: state_root.join("memory"),
        sop_dir: state_root.join("sop"),
        skills_dir: state_root.join("skills"),
        temp_dir: state_root.join("temp"),
        model_responses_dir: state_root.join("temp").join("model_responses"),
        model_config_dir,
        model_config_path,
        state_root,
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn path_to_slash(path: &Path) -> String {
    path.to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn rel_to_path(rel: &str) -> PathBuf {
    rel.split('/').collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_layout_creates_only_missing_managed_state_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resource_root = tmp.path().join("resources").join("managed-ga");
        fs::create_dir_all(resource_root.join("patches")).expect("resource dirs");
        fs::write(resource_root.join("manifest.json"), "{}").expect("manifest placeholder");
        fs::write(
            resource_root.join("patches").join("manifest.md"),
            "# patches",
        )
        .expect("patch manifest");

        let app_data = tmp.path().join("app-data");
        let first = ensure_layout(resource_root.clone(), app_data.clone()).expect("ensure first");
        assert_eq!(first.prompt_profile_id, PROMPT_PROFILE_ID);
        assert_eq!(first.prompt_hash.len(), 8);
        assert!(first.state.initialized);
        assert!(!first.state.created_dirs.is_empty());
        assert!(app_data.join("managed-ga-state").join("memory").is_dir());
        assert!(app_data.join("managed-ga-state").join("skills").is_dir());
        assert!(app_data.join("managed-model-config").is_dir());
        assert!(!first.state.model_config_exists);

        let second = ensure_layout(resource_root, app_data).expect("ensure second");
        assert!(second.state.initialized);
        assert!(second.state.created_dirs.is_empty());
    }

    #[test]
    fn ensure_layout_preserves_existing_managed_state_files() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resource_root = tmp.path().join("resources").join("managed-ga");
        fs::create_dir_all(resource_root.join("patches")).expect("resource dirs");
        fs::write(resource_root.join("manifest.json"), "{}").expect("manifest placeholder");
        fs::write(
            resource_root.join("patches").join("manifest.md"),
            "# patches",
        )
        .expect("patch manifest");

        let app_data = tmp.path().join("app-data");
        let state_root = app_data.join("managed-ga-state");
        let model_config_dir = app_data.join("managed-model-config");
        let seeded = [
            (
                state_root.join("memory").join("user.md"),
                b"memory" as &[u8],
            ),
            (state_root.join("sop").join("user.md"), b"sop"),
            (state_root.join("skills").join("tool.md"), b"skill"),
            (state_root.join("temp").join("scratch.txt"), b"temp"),
            (
                state_root
                    .join("temp")
                    .join("model_responses")
                    .join("trace.jsonl"),
                b"response",
            ),
            (
                model_config_dir.join(managed_model_config::GENERATED_CONFIG_FILENAME),
                br#"{"schemaVersion":1,"models":[]}"#,
            ),
        ];
        for (path, body) in seeded {
            fs::create_dir_all(path.parent().expect("parent")).expect("state dir");
            fs::write(path, body).expect("seed state file");
        }

        let diagnostics = ensure_layout(resource_root, app_data.clone()).expect("ensure");
        assert!(diagnostics.state.initialized);
        assert!(diagnostics.state.created_dirs.is_empty());
        assert!(diagnostics.state.model_config_exists);
        assert_eq!(
            fs::read(state_root.join("memory").join("user.md")).expect("memory"),
            b"memory"
        );
        assert_eq!(
            fs::read(state_root.join("sop").join("user.md")).expect("sop"),
            b"sop"
        );
        assert_eq!(
            fs::read(state_root.join("skills").join("tool.md")).expect("skill"),
            b"skill"
        );
        assert_eq!(
            fs::read(state_root.join("temp").join("scratch.txt")).expect("temp"),
            b"temp"
        );
        assert_eq!(
            fs::read(
                state_root
                    .join("temp")
                    .join("model_responses")
                    .join("trace.jsonl")
            )
            .expect("response"),
            b"response"
        );
    }

    #[test]
    fn ensure_layout_copies_missing_memory_seed_files() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resource_root = tmp.path().join("resources").join("managed-ga");
        fs::create_dir_all(resource_root.join("patches")).expect("resource dirs");
        fs::write(resource_root.join("manifest.json"), "{}").expect("manifest placeholder");
        fs::write(
            resource_root.join("patches").join("manifest.md"),
            "# patches",
        )
        .expect("patch manifest");
        write_critical_memory_seed(&resource_root, b"seed");
        write_memory_seed_file(&resource_root, "custom/custom_sop.md", b"extra");

        let app_data = tmp.path().join("app-data");
        let diagnostics = ensure_layout(resource_root.clone(), app_data.clone()).expect("ensure");
        let memory_dir = app_data.join("managed-ga-state").join("memory");

        assert!(diagnostics.state.memory_seed.source_exists);
        assert!(diagnostics.state.memory_seed.critical_files_present);
        assert!(diagnostics
            .state
            .memory_seed
            .critical_files_missing
            .is_empty());
        assert!(diagnostics
            .state
            .memory_seed
            .copied_files
            .contains(&"memory_management_sop.md".to_string()));
        assert_eq!(
            fs::read(memory_dir.join("memory_management_sop.md")).expect("memory sop"),
            b"seed"
        );
        assert_eq!(
            fs::read(memory_dir.join("custom").join("custom_sop.md")).expect("custom sop"),
            b"extra"
        );

        let second = ensure_layout(resource_root, app_data).expect("ensure again");
        assert!(second.state.memory_seed.copied_files.is_empty());
    }

    #[test]
    fn ensure_layout_never_overwrites_existing_memory_seed_files() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resource_root = tmp.path().join("resources").join("managed-ga");
        fs::create_dir_all(resource_root.join("patches")).expect("resource dirs");
        fs::write(resource_root.join("manifest.json"), "{}").expect("manifest placeholder");
        fs::write(
            resource_root.join("patches").join("manifest.md"),
            "# patches",
        )
        .expect("patch manifest");
        write_critical_memory_seed(&resource_root, b"seed");

        let app_data = tmp.path().join("app-data");
        let memory_dir = app_data.join("managed-ga-state").join("memory");
        fs::create_dir_all(&memory_dir).expect("memory dir");
        fs::write(memory_dir.join("memory_management_sop.md"), b"user-edited")
            .expect("existing sop");

        let diagnostics = ensure_layout(resource_root, app_data).expect("ensure");

        assert!(diagnostics.state.memory_seed.critical_files_present);
        assert!(!diagnostics
            .state
            .memory_seed
            .copied_files
            .contains(&"memory_management_sop.md".to_string()));
        assert_eq!(
            fs::read(memory_dir.join("memory_management_sop.md")).expect("memory sop"),
            b"user-edited"
        );
    }

    #[test]
    fn managed_code_payload_excludes_user_state_artifacts() {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("core/ has repo parent")
            .to_path_buf();
        let code_root = repo_root.join("managed-ga").join("code");
        assert!(
            code_root.join("agentmain.py").is_file(),
            "managed GA payload must include code files"
        );

        for rel in [
            "mykey.py",
            "mykey.json",
            "memory",
            "sop",
            "skills",
            "temp",
            "model_responses",
        ] {
            assert!(
                !code_root.join(rel).exists(),
                "managed GA payload must not include user state artifact: {rel}"
            );
        }
        assert_no_generated_artifacts(&code_root);
    }

    #[test]
    fn managed_state_seed_contains_critical_memory_sop_files() {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("core/ has repo parent")
            .to_path_buf();
        let memory_seed_dir = repo_root
            .join("managed-ga")
            .join(rel_to_path(MEMORY_SEED_REL));

        assert!(
            memory_seed_dir.is_dir(),
            "managed GA must ship a memory seed directory"
        );
        for rel in CRITICAL_MEMORY_SEED_FILES {
            assert!(
                memory_seed_dir.join(rel_to_path(rel)).is_file(),
                "managed GA memory seed missing critical file: {rel}"
            );
        }
    }

    // ---------------- resetting memory/ (main chat ticket 15) ----------------

    /// Every file under `root`, by slash path, with its bytes.
    fn tree(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        let mut out = std::collections::BTreeMap::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(dir) = pending.pop() {
            for entry in fs::read_dir(&dir).expect("read dir") {
                let path = entry.expect("entry").path();
                if path.is_dir() {
                    pending.push(path);
                } else {
                    let rel = path_to_slash(path.strip_prefix(root).expect("under root"));
                    out.insert(rel, fs::read(&path).expect("read file"));
                }
            }
        }
        out
    }

    /// Names in `memory_dir`'s parent other than `memory` itself: a
    /// set-aside copy left behind would show here.
    fn siblings(memory_dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(memory_dir.parent().expect("parent"))
            .expect("read parent")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .filter(|name| name != "memory")
            .collect();
        names.sort();
        names
    }

    /// A seed (every critical file plus one extra) and a used `memory/`
    /// under one temp dir: GA's own files, an edited seed file, a SOP the
    /// engine wrote, a nested note.
    fn used_memory(tmp: &tempfile::TempDir) -> (PathBuf, PathBuf) {
        let resource_root = tmp.path().join("resources").join("managed-ga");
        write_critical_memory_seed(&resource_root, b"seed");
        write_memory_seed_file(&resource_root, "custom/custom_sop.md", b"extra");
        let seed = resource_root.join(rel_to_path(MEMORY_SEED_REL));
        let memory = tmp
            .path()
            .join("app-data")
            .join("managed-ga-state")
            .join("memory");
        for (rel, body) in [
            (
                "global_mem.txt",
                b"# [Global Memory - L2]\nuser likes tea" as &[u8],
            ),
            ("global_mem_insight.txt", b"insight"),
            ("memory_management_sop.md", b"edited by the engine"),
            ("learned_sop.md", b"a way of working"),
            ("notes/about_user.md", b"facts"),
        ] {
            let path = memory.join(rel_to_path(rel));
            fs::create_dir_all(path.parent().expect("parent")).expect("memory dir");
            fs::write(path, body).expect("memory file");
        }
        // Everything these tests move or delete is in the temp dir.
        assert!(seed.starts_with(tmp.path()) && memory.starts_with(tmp.path()));
        (seed, memory)
    }

    #[test]
    fn a_memory_reset_puts_memory_back_to_the_seed() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (seed, memory) = used_memory(&tmp);
        let before = tree(&memory);

        let staged = stage_memory_reset(&seed, &memory).expect("stage");

        // memory/ is exactly the seed: its files all there, the edited one
        // back to the seed's, everything else gone (GA's global_mem*
        // included — it writes them anew from its templates).
        assert_eq!(tree(&memory), tree(&seed));
        assert!(!memory.join("global_mem.txt").exists());
        assert!(!memory.join("global_mem_insight.txt").exists());
        // The old one waits beside it until the commit.
        let aside = staged.set_aside().expect("set aside").to_path_buf();
        assert_eq!(tree(&aside), before);
        assert_eq!(siblings(&memory).len(), 1);

        staged.commit().expect("commit");
        assert!(!aside.exists());
        assert!(siblings(&memory).is_empty());
        assert_eq!(tree(&memory), tree(&seed));
    }

    #[test]
    fn a_rolled_back_memory_reset_leaves_memory_as_it_was() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (seed, memory) = used_memory(&tmp);
        let before = tree(&memory);

        let staged = stage_memory_reset(&seed, &memory).expect("stage");
        // Something the engine wrote into the fresh memory/ meanwhile goes
        // with it.
        fs::write(memory.join("global_mem.txt"), b"new").expect("write");
        staged.rollback().expect("rollback");

        assert_eq!(tree(&memory), before);
        assert!(siblings(&memory).is_empty());
    }

    #[test]
    fn a_failed_seed_copy_leaves_memory_as_it_was() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (seed, memory) = used_memory(&tmp);
        let before = tree(&memory);

        // The copy gets one file in, then fails (a full disk, say).
        let err = stage_memory_reset_with(&seed, &memory, |seed, target| {
            fs::copy(seed.join("plan_sop.md"), target.join("plan_sop.md"))?;
            Err(io::Error::other("disk full"))
        })
        .expect_err("copy fails");

        assert!(err.to_string().contains("disk full"), "{err}");
        assert!(err.to_string().contains("back as it was"), "{err}");
        assert_eq!(tree(&memory), before);
        assert!(siblings(&memory).is_empty());
    }

    #[test]
    fn an_incomplete_seed_moves_nothing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (seed, memory) = used_memory(&tmp);
        let before = tree(&memory);
        fs::remove_file(seed.join("plan_sop.md")).expect("remove a critical seed file");

        let err = stage_memory_reset(&seed, &memory).expect_err("refused");

        assert!(err.to_string().contains("plan_sop.md"), "{err}");
        assert_eq!(tree(&memory), before);
        assert!(siblings(&memory).is_empty());
        // No seed at all: the same.
        let err = stage_memory_reset(&tmp.path().join("nowhere"), &memory).expect_err("refused");
        assert!(err.to_string().contains("not touched"), "{err}");
        assert_eq!(tree(&memory), before);
    }

    #[test]
    fn a_memory_reset_without_a_memory_dir_seeds_one() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (seed, memory) = used_memory(&tmp);
        fs::remove_dir_all(&memory).expect("no memory yet");

        let staged = stage_memory_reset(&seed, &memory).expect("stage");
        assert!(staged.set_aside().is_none());
        assert_eq!(tree(&memory), tree(&seed));
        staged.rollback().expect("rollback");
        assert!(!memory.exists());
    }

    fn assert_no_generated_artifacts(root: &Path) {
        let mut pending = vec![root.to_path_buf()];
        while let Some(dir) = pending.pop() {
            for entry in fs::read_dir(&dir).expect("read managed GA payload dir") {
                let entry = entry.expect("read managed GA payload entry");
                let path = entry.path();
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                assert_ne!(
                    name,
                    ".DS_Store",
                    "managed GA payload must not include macOS metadata: {}",
                    path.display()
                );
                assert_ne!(
                    name,
                    "__pycache__",
                    "managed GA payload must not include Python bytecode cache dirs: {}",
                    path.display()
                );
                assert!(
                    path.extension().and_then(|ext| ext.to_str()) != Some("pyc"),
                    "managed GA payload must not include Python bytecode files: {}",
                    path.display()
                );
                if path.is_dir() {
                    pending.push(path);
                }
            }
        }
    }

    fn write_critical_memory_seed(resource_root: &Path, body: &[u8]) {
        for rel in CRITICAL_MEMORY_SEED_FILES {
            write_memory_seed_file(resource_root, rel, body);
        }
    }

    fn write_memory_seed_file(resource_root: &Path, rel: &str, body: &[u8]) {
        let path = resource_root
            .join(rel_to_path(MEMORY_SEED_REL))
            .join(rel_to_path(rel));
        fs::create_dir_all(path.parent().expect("memory seed parent")).expect("memory seed dir");
        fs::write(path, body).expect("memory seed file");
    }
}
