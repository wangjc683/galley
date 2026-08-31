use super::*;

#[tauri::command]
pub(crate) async fn list_managed_model_providers(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<api::ManagedModelProviderRecord>, String> {
    galley
        .list_managed_model_providers()
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn list_managed_models(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<api::ManagedModelRecord>, String> {
    galley.list_managed_models().await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn save_managed_model_provider(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    input: SaveManagedProviderInput,
) -> std::result::Result<api::ManagedModelProviderRecord, String> {
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_managed_provider_id);
    let existing_api_key_ref = galley
        .list_managed_model_providers()
        .await
        .map_err(stringify_error)?
        .into_iter()
        .find(|provider| provider.id == id)
        .map(|provider| provider.api_key_ref);
    let is_existing_provider = existing_api_key_ref.is_some();
    let auth_kind = input.auth_kind.unwrap_or(ManagedModelAuthKind::ApiKey);
    let api_key_ref =
        existing_api_key_ref.unwrap_or_else(|| credential_store::managed_provider_api_key_ref(&id));
    let api_key = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if auth_kind == ManagedModelAuthKind::None {
        // No-auth endpoint: drop any stored secret so the blank
        // credential is the persisted truth ("clear key" flows through
        // here). delete_secret is a plain DELETE — idempotent.
        credential_store::delete_secret(&galley, &api_key_ref)
            .await
            .map_err(stringify_error)?;
    } else if let Some(api_key) = api_key {
        credential_store::set_secret(&galley, &api_key_ref, api_key)
            .await
            .map_err(stringify_error)?;
    } else if !is_existing_provider && auth_kind == ManagedModelAuthKind::ApiKey {
        return Err(stringify_error(error::GalleyError::InvalidArgs {
            message: "managed provider API key is required".into(),
        }));
    }

    let display_name = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| input.api_base.trim())
        .to_string();
    let saved = galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id,
            display_name,
            protocol: input.protocol,
            auth_kind,
            api_base: input.api_base,
            api_key_ref,
        })
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await?;
    Ok(saved)
}

#[tauri::command]
pub(crate) async fn delete_managed_model_provider(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    id: String,
) -> std::result::Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err(stringify_error(error::GalleyError::InvalidArgs {
            message: "managed provider id must not be empty".into(),
        }));
    }
    if let Some(api_key_ref) = galley
        .delete_managed_model_provider_metadata(id)
        .await
        .map_err(stringify_error)?
    {
        credential_store::delete_secret(&galley, &api_key_ref)
            .await
            .map_err(stringify_error)?;
    }
    sync_managed_model_config(&app, &galley).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_managed_model(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    input: SaveManagedModelInput,
) -> std::result::Result<api::ManagedModelRecord, String> {
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_managed_model_id);
    let providers = galley
        .list_managed_model_providers()
        .await
        .map_err(stringify_error)?;
    let provider = providers
        .iter()
        .find(|provider| provider.id == input.provider_id)
        .ok_or_else(|| {
            stringify_error(error::GalleyError::InvalidArgs {
                message: format!("managed provider {} not found", input.provider_id),
            })
        })?;
    let display_name = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| input.model.trim())
        .to_string();
    let saved = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id,
            provider_id: input.provider_id,
            display_name,
            model: input.model,
            advanced_options: normalize_managed_model_advanced_options(
                provider.protocol,
                input.advanced_options,
            ),
            make_default: input.make_default.unwrap_or(false),
        })
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await?;
    Ok(saved)
}

#[tauri::command]
pub(crate) async fn delete_managed_model(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    id: String,
) -> std::result::Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err(stringify_error(error::GalleyError::InvalidArgs {
            message: "managed model id must not be empty".into(),
        }));
    }
    galley
        .delete_managed_model_metadata(id)
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn reorder_managed_models(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    input: ReorderManagedModelsInput,
) -> std::result::Result<(), String> {
    galley
        .reorder_managed_models(input.model_ids)
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_managed_model_options(
    input: ManagedModelProbeInput,
) -> std::result::Result<api::ManagedModelListResult, String> {
    managed_model_probe::list_models(input)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn test_managed_model_connection(
    input: ManagedModelProbeInput,
) -> std::result::Result<api::ManagedModelConnectionResult, String> {
    managed_model_probe::test_connection(input)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn start_chatgpt_codex_login(
) -> std::result::Result<codex_oauth::CodexDeviceLoginStart, String> {
    codex_oauth::start_device_login()
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn complete_chatgpt_codex_login(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    input: codex_oauth::CompleteCodexDeviceLoginInput,
) -> std::result::Result<codex_oauth::CodexAuthSetupResult, String> {
    let result = codex_oauth::complete_device_login(input)
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn import_chatgpt_codex_cli_login(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
) -> std::result::Result<codex_oauth::CodexAuthSetupResult, String> {
    let result = codex_oauth::import_cli_login()
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn logout_chatgpt_codex_provider(
    galley: State<'_, SqliteGalley>,
    app: tauri::AppHandle,
    input: codex_oauth::CodexProviderActionInput,
) -> std::result::Result<(), String> {
    codex_oauth::logout_provider(input)
        .await
        .map_err(stringify_error)?;
    sync_managed_model_config(&app, &galley).await
}

async fn sync_managed_model_config(
    app: &tauri::AppHandle,
    galley: &SqliteGalley,
) -> std::result::Result<(), String> {
    let diagnostics = managed_runtime::ensure_for_app(app).map_err(|e| e.to_string())?;
    let models = galley
        .list_managed_models()
        .await
        .map_err(stringify_error)?;
    managed_model_config::write_nonsecret_config(
        std::path::Path::new(&diagnostics.paths.model_config_dir),
        &models,
    )
    .map_err(stringify_error)?;
    let revision = managed_model_config::new_revision();
    galley
        .set_pref_json(
            managed_model_config::REVISION_PREF_KEY,
            serde_json::json!(revision),
        )
        .await
        .map_err(stringify_error)?;
    {
        use tauri::Manager;
        if let Some(manager) = app.try_state::<std::sync::Arc<im_supervisor::ImSupervisorManager>>()
        {
            manager.refresh_model_config_staleness(app).await;
        }
    }
    Ok(())
}

fn new_managed_model_id() -> String {
    format!("mm_{}", chrono::Utc::now().timestamp_millis())
}

fn new_managed_provider_id() -> String {
    format!("mp_{}", chrono::Utc::now().timestamp_millis())
}

pub(crate) const MANAGED_MODEL_DEFAULT_CONTEXT_WIN: i64 = 90_000;

fn normalize_managed_model_advanced_options(
    protocol: api::ManagedModelProtocol,
    advanced_options: Option<serde_json::Value>,
) -> serde_json::Value {
    let defaults = managed_model_advanced_defaults(protocol);
    match advanced_options {
        None => defaults,
        Some(serde_json::Value::Object(provided)) => {
            let mut merged = defaults.as_object().cloned().unwrap_or_default();
            for (key, value) in provided {
                merged.insert(key, value);
            }
            serde_json::Value::Object(merged)
        }
        Some(provided) => provided,
    }
}

fn managed_model_advanced_defaults(protocol: api::ManagedModelProtocol) -> serde_json::Value {
    match protocol {
        api::ManagedModelProtocol::Anthropic => serde_json::json!({
            "context_win": MANAGED_MODEL_DEFAULT_CONTEXT_WIN,
            "thinking_type": "adaptive",
            "temperature": 1,
            "max_retries": 3,
            "connect_timeout": 10,
            "read_timeout": 180,
            "stream": true
        }),
        api::ManagedModelProtocol::Openai => serde_json::json!({
            "context_win": MANAGED_MODEL_DEFAULT_CONTEXT_WIN,
            "api_mode": "chat_completions",
            "temperature": 1,
            "max_retries": 3,
            "connect_timeout": 10,
            "read_timeout": 180,
            "stream": true
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_managed_model_advanced_options_adds_openai_defaults_when_absent() {
        let options =
            normalize_managed_model_advanced_options(api::ManagedModelProtocol::Openai, None);

        assert_eq!(options["context_win"], serde_json::json!(90_000));
        assert_eq!(options["api_mode"], serde_json::json!("chat_completions"));
    }

    #[test]
    fn normalize_managed_model_advanced_options_adds_defaults_for_empty_object() {
        let options = normalize_managed_model_advanced_options(
            api::ManagedModelProtocol::Anthropic,
            Some(serde_json::json!({})),
        );

        assert_eq!(options["context_win"], serde_json::json!(90_000));
        assert_eq!(options["thinking_type"], serde_json::json!("adaptive"));
    }

    #[test]
    fn normalize_managed_model_advanced_options_preserves_explicit_context_win() {
        let options = normalize_managed_model_advanced_options(
            api::ManagedModelProtocol::Openai,
            Some(serde_json::json!({
                "context_win": 16_000,
                "api_mode": "responses",
            })),
        );

        assert_eq!(options["context_win"], serde_json::json!(16_000));
        assert_eq!(options["api_mode"], serde_json::json!("responses"));
        assert_eq!(options["stream"], serde_json::json!(true));
    }
}
