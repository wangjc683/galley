//! Retiring the Codex CLI login (PRD decision 5, ticket 05).
//!
//! Until 2026-10-20 the ChatGPT provider could also hold a credential
//! from Galley's Codex CLI login, which borrowed the Codex CLI's OAuth
//! client and shared its refresh token. That login is gone. At every Core
//! start this sweep makes such a provider read as signed out:
//!
//! - a stored value that is not a Sign in with ChatGPT credential is
//!   deleted from the encrypted store, locally only. It is never revoked:
//!   the refresh token may be the one the Codex CLI itself uses, and
//!   revoking it would sign the user out of the Codex CLI as well. The
//!   Codex CLI's own files are not touched either;
//! - the provider's `api_base` becomes [`SIWC_API_BASE`].
//!
//! Provider and model records stay, and so does every session bound to
//! them, so the next sign-in with ChatGPT takes them over in place. The
//! sweep is re-entrant: once done, a run finds nothing to change and
//! writes nothing.

use crate::api::ManagedModelAuthKind;
use crate::credential_store;
use crate::db::{SqliteGalley, UpsertManagedModelProviderMetadata};
use crate::error::Result;

use super::refresh::refresh_gate;
use super::{is_siwc_secret, SIWC_API_BASE};

/// What one sweep changed, by provider id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LegacySweepOutcome {
    /// Providers whose Codex CLI login credential was deleted.
    pub credentials_removed: Vec<String>,
    /// Providers whose `api_base` was moved to [`SIWC_API_BASE`].
    pub api_bases_rewritten: Vec<String>,
}

impl LegacySweepOutcome {
    pub fn changed(&self) -> bool {
        !self.credentials_removed.is_empty() || !self.api_bases_rewritten.is_empty()
    }
}

/// The startup sweep (see the module docs). Only `chatgpt_codex_oauth`
/// providers are looked at; a SIWC credential, an API-key provider and
/// the SIWC registration are left alone.
pub async fn retire_codex_cli_credentials(galley: &SqliteGalley) -> Result<LegacySweepOutcome> {
    let mut outcome = LegacySweepOutcome::default();
    for provider in galley.list_managed_model_providers().await? {
        if provider.auth_kind != ManagedModelAuthKind::ChatgptCodexOauth {
            continue;
        }
        // Under the refresh gate, like every write of this credential: a
        // sign-in storing a fresh SIWC credential is never deleted here.
        let removed = {
            let gate = refresh_gate(&provider.api_key_ref);
            let _guard = gate.lock().await;
            let stored = credential_store::try_get_secret(galley, &provider.api_key_ref).await?;
            match stored {
                Some(raw) if !is_siwc_secret(&raw) => {
                    credential_store::delete_secret(galley, &provider.api_key_ref).await?;
                    true
                }
                _ => false,
            }
        };
        if removed {
            outcome.credentials_removed.push(provider.id.clone());
        }
        if provider.api_base.trim() != SIWC_API_BASE {
            galley
                .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
                    id: provider.id.clone(),
                    display_name: provider.display_name,
                    protocol: provider.protocol,
                    auth_kind: provider.auth_kind,
                    api_base: SIWC_API_BASE.into(),
                    api_key_ref: provider.api_key_ref,
                })
                .await?;
            outcome.api_bases_rewritten.push(provider.id);
        }
    }
    Ok(outcome)
}
