//! Non-secret managed model config generation.
//!
//! The generated file is a Galley-owned runtime artifact. It deliberately
//! contains `apiKeyRef` only; session start exposes the real key to the
//! managed runner through Core-owned credential IPC.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::api::ManagedModelRecord;
use crate::error::{GalleyError, Result};

pub const GENERATED_CONFIG_FILENAME: &str = "managed-models.json";
pub const REVISION_PREF_KEY: &str = "managed_model_config_revision";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedManagedModelsConfig<'a> {
    schema_version: u32,
    models: &'a [ManagedModelRecord],
}

pub fn write_nonsecret_config(
    model_config_dir: &Path,
    models: &[ManagedModelRecord],
) -> Result<()> {
    fs::create_dir_all(model_config_dir).map_err(|e| GalleyError::Internal {
        message: format!("creating managed model config dir: {e}"),
    })?;
    let path = model_config_dir.join(GENERATED_CONFIG_FILENAME);
    let body = serde_json::to_string_pretty(&GeneratedManagedModelsConfig {
        schema_version: 1,
        models,
    })
    .map_err(|e| GalleyError::Internal {
        message: format!("serializing managed model config: {e}"),
    })?;
    fs::write(&path, body).map_err(|e| GalleyError::Internal {
        message: format!("writing {}: {e}", path.display()),
    })?;
    Ok(())
}

pub fn new_revision() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true)
}

/// Why [`sync_for_app`] failed. Two kinds, because the desktop's model
/// commands have always reported them differently: a layout failure as
/// its bare text, a store or write failure as the serialized
/// [`GalleyError`].
#[derive(Debug)]
pub enum ConfigSyncError {
    Layout(std::io::Error),
    Store(GalleyError),
}

/// After any write to the managed model store: make sure the managed
/// runtime's layout exists, rewrite the generated non-secret config,
/// record a new config revision, and let the IM channels compare their
/// own against it. Every model-settings Tauri command runs it; so does
/// the socket's `llm.set_default` (main chat ticket 35).
pub async fn sync_for_app(
    app: &tauri::AppHandle,
    galley: &crate::db::SqliteGalley,
) -> std::result::Result<(), ConfigSyncError> {
    let diagnostics =
        crate::managed_runtime::ensure_for_app(app).map_err(ConfigSyncError::Layout)?;
    let models = galley
        .list_managed_models()
        .await
        .map_err(ConfigSyncError::Store)?;
    write_nonsecret_config(Path::new(&diagnostics.paths.model_config_dir), &models)
        .map_err(ConfigSyncError::Store)?;
    galley
        .set_pref_json(REVISION_PREF_KEY, serde_json::json!(new_revision()))
        .await
        .map_err(ConfigSyncError::Store)?;
    {
        use tauri::Manager;
        if let Some(manager) =
            app.try_state::<std::sync::Arc<crate::im_supervisor::ImSupervisorManager>>()
        {
            manager.refresh_model_config_staleness(app).await;
        }
    }
    Ok(())
}
