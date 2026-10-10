//! Push notifications (design §4.3): the phones' APNs device tokens and
//! the push counter, kept in prefs, and the sealing of one push for
//! every registered device. Ticket 08 decides when to push; this is the
//! "send it" half ([`super::RemoteModule::send_push`]).
//!
//! The relay never stores a token: a phone hands its token to Core over
//! the end-to-end session (`device.registerPush`), and every `PUSH` frame
//! carries the token it is for. APNs answering 410 for a token
//! (`PUSH_RESULT` `Unregistered`) removes it here.

use crate::api::GalleyApi;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};
use galley_remote_protocol::frame::{device_token_from_hex, device_token_to_hex, PushEnv};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Pref holding the registered devices, a JSON array of [`PushDevice`].
pub const PUSH_DEVICES_PREF: &str = "remote_push_devices";
/// Pref holding the last push `seq` sent.
pub const PUSH_SEQ_PREF: &str = "remote_push_seq";
/// Devices kept; registering one more drops the oldest. P0 has one
/// phone, P1 keys devices properly (design §3.2).
pub const MAX_PUSH_DEVICES: usize = 8;

/// Read-modify-write of the push prefs, one at a time.
static PREFS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// One phone that can receive pushes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushDevice {
    /// The APNs device token, lowercase hex.
    pub token: String,
    pub env: PushEnv,
    /// ISO 8601, the last registration.
    pub registered_at: String,
}

/// The registered devices, oldest registration first. A pref that does
/// not parse reads as none (it is rebuilt by the next registration).
pub async fn push_devices(galley: &SqliteGalley) -> Result<Vec<PushDevice>> {
    let Some(value) = galley.get_pref_json(PUSH_DEVICES_PREF).await? else {
        return Ok(Vec::new());
    };
    match serde_json::from_value(value) {
        Ok(devices) => Ok(devices),
        Err(e) => {
            eprintln!("[remote] {PUSH_DEVICES_PREF} is malformed, ignoring it: {e}");
            Ok(Vec::new())
        }
    }
}

async fn store_devices(galley: &SqliteGalley, devices: &[PushDevice]) -> Result<()> {
    let value = serde_json::to_value(devices).map_err(|e| GalleyError::Internal {
        message: format!("serialize push devices: {e}"),
    })?;
    galley.set_pref_json(PUSH_DEVICES_PREF, value).await
}

/// Register (or refresh) a device token given as hex. The list is keyed
/// by token: a token already there moves to the end with its new `env`.
pub async fn register_push_device(galley: &SqliteGalley, token: &str, env: PushEnv) -> Result<()> {
    let bytes = device_token_from_hex(token.trim()).ok_or_else(|| GalleyError::InvalidArgs {
        message: "push token must be the device token in hex".into(),
    })?;
    let token = device_token_to_hex(&bytes);
    let _turn = PREFS_LOCK.lock().await;
    let mut devices = push_devices(galley).await?;
    devices.retain(|device| device.token != token);
    devices.push(PushDevice {
        token,
        env,
        registered_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    });
    if devices.len() > MAX_PUSH_DEVICES {
        let excess = devices.len() - MAX_PUSH_DEVICES;
        devices.drain(..excess);
    }
    store_devices(galley, &devices).await
}

/// Remove a token (APNs said it is no longer valid). Returns whether it
/// was registered.
pub async fn remove_push_device(galley: &SqliteGalley, token: &str) -> Result<bool> {
    let _turn = PREFS_LOCK.lock().await;
    let mut devices = push_devices(galley).await?;
    let before = devices.len();
    devices.retain(|device| device.token != token);
    if devices.len() == before {
        return Ok(false);
    }
    store_devices(galley, &devices).await?;
    Ok(true)
}

/// The next push `seq`: `max(last + 1, now in ms)`, stored before it is
/// used, so it never goes backwards — not across restarts, and not below
/// what a phone has seen even if the pref is lost (design §4.3).
pub async fn next_push_seq(galley: &SqliteGalley) -> Result<u64> {
    let _turn = PREFS_LOCK.lock().await;
    let last = galley
        .get_pref_json(PUSH_SEQ_PREF)
        .await?
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let now_ms = u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0);
    let seq = last.saturating_add(1).max(now_ms);
    galley
        .set_pref_json(PUSH_SEQ_PREF, Value::from(seq))
        .await?;
    Ok(seq)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn galley() -> SqliteGalley {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        for m in crate::db_migrations::all() {
            sqlx::raw_sql(m.sql)
                .execute(&pool)
                .await
                .expect("migration");
        }
        SqliteGalley::from_pool(pool)
    }

    #[tokio::test]
    async fn devices_are_keyed_by_token_and_bounded() {
        let g = galley().await;
        assert!(push_devices(&g).await.unwrap().is_empty());
        register_push_device(&g, "ABCD", PushEnv::Sandbox)
            .await
            .unwrap();
        register_push_device(&g, "abcd", PushEnv::Production)
            .await
            .unwrap();
        let devices = push_devices(&g).await.unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].token, "abcd");
        assert_eq!(devices[0].env, PushEnv::Production);

        assert!(register_push_device(&g, "xyz", PushEnv::Sandbox)
            .await
            .is_err());
        assert!(register_push_device(&g, "", PushEnv::Sandbox)
            .await
            .is_err());

        for i in 0..MAX_PUSH_DEVICES + 2 {
            register_push_device(&g, &format!("{i:04x}"), PushEnv::Sandbox)
                .await
                .unwrap();
        }
        let devices = push_devices(&g).await.unwrap();
        assert_eq!(devices.len(), MAX_PUSH_DEVICES);
        assert_eq!(
            devices.last().unwrap().token,
            format!("{:04x}", MAX_PUSH_DEVICES + 1)
        );

        assert!(remove_push_device(&g, "0009").await.unwrap());
        assert!(!remove_push_device(&g, "0009").await.unwrap());
    }

    #[tokio::test]
    async fn seq_never_goes_backwards() {
        let g = galley().await;
        let first = next_push_seq(&g).await.unwrap();
        assert!(first > 1_700_000_000_000, "seeded from the clock: {first}");
        let second = next_push_seq(&g).await.unwrap();
        assert!(second > first);
        // A counter ahead of the clock keeps counting from itself.
        let ahead = first + 10_000_000;
        g.set_pref_json(PUSH_SEQ_PREF, Value::from(ahead))
            .await
            .unwrap();
        assert_eq!(next_push_seq(&g).await.unwrap(), ahead + 1);
    }
}
