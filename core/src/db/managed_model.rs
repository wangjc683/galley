use super::*;

impl SqliteGalley {
    pub async fn list_managed_model_providers(&self) -> Result<Vec<ManagedModelProviderRecord>> {
        let rows = sqlx::query_as::<_, ManagedModelProviderRow>(
            "SELECT p.id, p.display_name, p.protocol, p.auth_kind, p.api_base, p.api_key_ref, \
                    CASE WHEN s.api_key_ref IS NULL THEN 0 ELSE 1 END AS has_secret, \
                    p.created_at, p.updated_at \
             FROM managed_model_providers p \
             LEFT JOIN managed_model_secrets s ON s.api_key_ref = p.api_key_ref \
             ORDER BY p.updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;

        rows.into_iter()
            .map(ManagedModelProviderRow::into_record)
            .collect()
    }

    pub async fn list_managed_models(&self) -> Result<Vec<ManagedModelRecord>> {
        let defaults = self.managed_model_defaults().await?;
        let sql = managed_model_select_sql(
            "ORDER BY m.sort_order ASC, m.is_default DESC, m.updated_at DESC",
        );
        let rows = sqlx::query_as::<_, ManagedModelRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;

        rows.into_iter()
            .map(|row| row.into_record(&defaults))
            .collect()
    }

    /// The defaults layer (`prefs.managed_model_defaults`); `{}` when unset
    /// or not an object. See `managed_model_layers`.
    pub async fn managed_model_defaults(&self) -> Result<serde_json::Value> {
        Ok(self
            .get_pref_json_db(crate::managed_model_layers::DEFAULTS_PREF_KEY)
            .await?
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::Value::Object(Default::default())))
    }

    /// Store an already-normalised defaults object (see
    /// `managed_model_layers::normalize_defaults`).
    pub async fn set_managed_model_defaults(&self, defaults: serde_json::Value) -> Result<()> {
        self.set_pref_json(crate::managed_model_layers::DEFAULTS_PREF_KEY, defaults)
            .await
    }

    pub async fn managed_model_secret_key(&self, key_id: &str) -> Result<Option<Vec<u8>>> {
        sqlx::query_scalar("SELECT key_material FROM managed_model_secret_keys WHERE key_id = ?")
            .bind(key_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)
    }

    pub async fn insert_managed_model_secret_key(
        &self,
        key_id: &str,
        key_material: &[u8],
    ) -> Result<()> {
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO managed_model_secret_keys (key_id, key_material, created_at) \
             VALUES (?, ?, ?) \
             ON CONFLICT(key_id) DO NOTHING",
        )
        .bind(key_id)
        .bind(key_material)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(())
    }

    pub async fn upsert_managed_model_secret(
        &self,
        api_key_ref: &str,
        key_id: &str,
        algorithm: &str,
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<()> {
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO managed_model_secrets (
               api_key_ref, key_id, encryption_version, algorithm, nonce,
               ciphertext, created_at, updated_at
             ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
             ON CONFLICT(api_key_ref) DO UPDATE SET
               key_id = excluded.key_id,
               encryption_version = excluded.encryption_version,
               algorithm = excluded.algorithm,
               nonce = excluded.nonce,
               ciphertext = excluded.ciphertext,
               updated_at = excluded.updated_at",
        )
        .bind(api_key_ref)
        .bind(key_id)
        .bind(algorithm)
        .bind(nonce)
        .bind(ciphertext)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(())
    }

    pub async fn managed_model_secret(
        &self,
        api_key_ref: &str,
    ) -> Result<Option<ManagedModelSecretRow>> {
        sqlx::query_as::<_, ManagedModelSecretRow>(
            "SELECT key_id, encryption_version, algorithm, nonce, ciphertext \
             FROM managed_model_secrets \
             WHERE api_key_ref = ?",
        )
        .bind(api_key_ref)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }

    pub async fn delete_managed_model_secret(&self, api_key_ref: &str) -> Result<()> {
        sqlx::query("DELETE FROM managed_model_secrets WHERE api_key_ref = ?")
            .bind(api_key_ref)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(())
    }

    pub async fn active_runtime_kind(&self) -> Result<RuntimeKind> {
        let mut conn = self.pool.acquire().await.map_err(map_sqlx_err)?;
        active_runtime_kind_inner(&mut conn).await
    }

    pub async fn upsert_managed_model_provider_metadata(
        &self,
        record: UpsertManagedModelProviderMetadata,
    ) -> Result<ManagedModelProviderRecord> {
        let id = record.id.trim();
        if id.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed provider id must not be empty".into(),
            });
        }
        let display_name = record.display_name.trim();
        if display_name.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed provider displayName must not be empty".into(),
            });
        }
        let api_base = record.api_base.trim();
        if api_base.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed provider Base URL must not be empty".into(),
            });
        }
        let now = chrono_now_iso();
        let protocol = managed_model_protocol_sql(record.protocol);
        let auth_kind = managed_model_auth_kind_sql(record.auth_kind);

        sqlx::query(
            "INSERT INTO managed_model_providers (
               id, display_name, protocol, auth_kind, api_base, api_key_ref, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               display_name = excluded.display_name,
               protocol = excluded.protocol,
               auth_kind = excluded.auth_kind,
               api_base = excluded.api_base,
               api_key_ref = excluded.api_key_ref,
               updated_at = excluded.updated_at",
        )
        .bind(id)
        .bind(display_name)
        .bind(protocol)
        .bind(auth_kind)
        .bind(api_base)
        .bind(&record.api_key_ref)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("upsert_managed_model_provider", e))?;

        self.managed_model_provider_by_id(id).await
    }

    pub async fn delete_managed_model_provider_metadata(&self, id: &str) -> Result<Option<String>> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed provider id must not be empty".into(),
            });
        }
        let row: Option<(String,)> =
            sqlx::query_as("SELECT api_key_ref FROM managed_model_providers WHERE id = ?")
                .bind(trimmed)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        let Some((api_key_ref,)) = row else {
            return Ok(None);
        };

        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let was_default_deleted: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM managed_models WHERE provider_id = ? AND is_default = 1",
        )
        .bind(trimmed)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;
        sqlx::query("DELETE FROM managed_models WHERE provider_id = ?")
            .bind(trimmed)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        sqlx::query("DELETE FROM managed_model_providers WHERE id = ?")
            .bind(trimmed)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        if was_default_deleted > 0 {
            set_latest_model_default(&mut tx).await?;
        }
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(Some(api_key_ref))
    }

    pub async fn upsert_managed_model_metadata(
        &self,
        record: UpsertManagedModelMetadata,
    ) -> Result<ManagedModelRecord> {
        let id = record.id.trim();
        if id.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed model id must not be empty".into(),
            });
        }
        let provider_id = record.provider_id.trim();
        if provider_id.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed model providerId must not be empty".into(),
            });
        }
        let display_name = record.display_name.trim();
        if display_name.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed model displayName must not be empty".into(),
            });
        }
        let model = record.model.trim();
        if model.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed model name must not be empty".into(),
            });
        }

        let provider_exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM managed_model_providers WHERE id = ?")
                .bind(provider_id)
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        if provider_exists == 0 {
            return Err(GalleyError::InvalidArgs {
                message: format!("managed model provider {provider_id} not found"),
            });
        }
        let existing_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM managed_models")
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        let existing_row: Option<(i64, i64, String, String)> = sqlx::query_as(
            "SELECT is_default, sort_order, preset_options, advanced_options \
             FROM managed_models WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let make_default = record.make_default || existing_count == 0;
        let target_sort_order = if make_default {
            0_i64
        } else if let Some((_, sort_order, _, _)) = &existing_row {
            *sort_order
        } else {
            let max_order: Option<i64> =
                sqlx::query_scalar("SELECT MAX(sort_order) FROM managed_models")
                    .fetch_one(&self.pool)
                    .await
                    .map_err(map_sqlx_err)?;
            max_order.unwrap_or(-1) + 1
        };
        let now = chrono_now_iso();
        // `None` keeps the stored layer on an update; a fresh row with no
        // seed gets `{}` (the protocol defaults are the command layer's job).
        let preset_options = match (&record.preset_options, &existing_row) {
            (Some(preset), _) => preset.to_string(),
            (None, Some((_, _, stored, _))) => stored.clone(),
            (None, None) => "{}".to_string(),
        };
        let advanced_options = match (&record.advanced_overrides, &existing_row) {
            (Some(overrides), _) => overrides.to_string(),
            (None, Some((_, _, _, stored))) => stored.clone(),
            (None, None) => "{}".to_string(),
        };
        let existing_row =
            existing_row.map(|(was_default, old_order, _, _)| (was_default, old_order));

        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        if make_default {
            sqlx::query("UPDATE managed_models SET is_default = 0")
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_err)?;
            if let Some((was_default, old_order)) = existing_row {
                if was_default == 0 {
                    sqlx::query(
                        "UPDATE managed_models
                         SET sort_order = sort_order + 1
                         WHERE id != ? AND sort_order < ?",
                    )
                    .bind(id)
                    .bind(old_order)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_sqlx_err)?;
                }
            } else {
                sqlx::query("UPDATE managed_models SET sort_order = sort_order + 1")
                    .execute(&mut *tx)
                    .await
                    .map_err(map_sqlx_err)?;
            }
        }
        sqlx::query(
            "INSERT INTO managed_models (
               id, provider_id, display_name, model, preset_options, advanced_options,
               is_default, sort_order, last_validated_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               provider_id = excluded.provider_id,
               display_name = excluded.display_name,
               model = excluded.model,
               preset_options = excluded.preset_options,
               advanced_options = excluded.advanced_options,
               is_default = excluded.is_default,
               sort_order = excluded.sort_order,
               updated_at = excluded.updated_at",
        )
        .bind(id)
        .bind(provider_id)
        .bind(display_name)
        .bind(model)
        .bind(&preset_options)
        .bind(&advanced_options)
        .bind(if make_default { 1_i64 } else { 0_i64 })
        .bind(target_sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err("upsert_managed_model", e))?;
        tx.commit().await.map_err(map_sqlx_err)?;

        self.managed_model_by_id(id).await
    }

    pub async fn delete_managed_model_metadata(&self, id: &str) -> Result<bool> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed model id must not be empty".into(),
            });
        }
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT is_default FROM managed_models WHERE id = ?")
                .bind(trimmed)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        let Some((was_default,)) = row else {
            return Ok(false);
        };

        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        sqlx::query("DELETE FROM managed_models WHERE id = ?")
            .bind(trimmed)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        if was_default != 0 {
            set_latest_model_default(&mut tx).await?;
        }
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(true)
    }

    pub async fn reorder_managed_models(&self, ordered_ids: Vec<String>) -> Result<()> {
        if ordered_ids.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "managed model order must not be empty".into(),
            });
        }
        let mut seen = std::collections::HashSet::new();
        let ordered_ids: Vec<String> = ordered_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .collect();
        for id in &ordered_ids {
            if id.is_empty() {
                return Err(GalleyError::InvalidArgs {
                    message: "managed model id must not be empty".into(),
                });
            }
            if !seen.insert(id.clone()) {
                return Err(GalleyError::InvalidArgs {
                    message: format!("duplicate managed model id in order: {id}"),
                });
            }
        }

        let existing_ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM managed_models ORDER BY sort_order ASC")
                .fetch_all(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        if existing_ids.len() != ordered_ids.len()
            || !existing_ids.iter().all(|id| seen.contains(id))
        {
            return Err(GalleyError::InvalidArgs {
                message: "managed model order must include every configured model".into(),
            });
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        sqlx::query("UPDATE managed_models SET is_default = 0")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        for (idx, id) in ordered_ids.iter().enumerate() {
            sqlx::query("UPDATE managed_models SET sort_order = ? WHERE id = ?")
                .bind(idx as i64)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_err)?;
        }
        sqlx::query("UPDATE managed_models SET is_default = 1 WHERE id = ?")
            .bind(&ordered_ids[0])
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(())
    }

    async fn managed_model_by_id(&self, id: &str) -> Result<ManagedModelRecord> {
        let defaults = self.managed_model_defaults().await?;
        let sql = format!("{} WHERE m.id = ? LIMIT 1", managed_model_select_sql(""));
        let row = sqlx::query_as::<_, ManagedModelRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?
            .ok_or_else(|| GalleyError::NotFound {
                message: format!("managed model {id} not found"),
            })?;
        row.into_record(&defaults)
    }

    async fn managed_model_provider_by_id(&self, id: &str) -> Result<ManagedModelProviderRecord> {
        let row = sqlx::query_as::<_, ManagedModelProviderRow>(
            "SELECT p.id, p.display_name, p.protocol, p.auth_kind, p.api_base, p.api_key_ref, \
                    CASE WHEN s.api_key_ref IS NULL THEN 0 ELSE 1 END AS has_secret, \
                    p.created_at, p.updated_at \
             FROM managed_model_providers p \
             LEFT JOIN managed_model_secrets s ON s.api_key_ref = p.api_key_ref \
             WHERE p.id = ? \
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("managed provider {id} not found"),
        })?;
        row.into_record()
    }
}
