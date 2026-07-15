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
        model_responses_dir: state_root.join("model_responses"),
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
                state_root.join("model_responses").join("trace.jsonl"),
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
            fs::read(state_root.join("model_responses").join("trace.jsonl")).expect("response"),
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
