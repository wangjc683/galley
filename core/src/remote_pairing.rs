//! The phone pairing master key (ticket 05c;
//! `.scratch/ios-client/issues/05-remote-protocol-design.md` §3.1).
//!
//! 32 random bytes from the OS RNG ([`generate_master_key`]). The desktop
//! shows it to the phone in the pairing QR code; both sides derive the
//! relay channel, the Noise PSK and the push key from it
//! (`remote-protocol`). A new key lives only in memory while the remote
//! module waits for the first phone; once that phone completes its
//! handshake the module stores it ([`store_master_key`]) in Core's
//! credential store ([`crate::credential_store`], AES-256-GCM like the IM
//! channel secrets) under [`PAIRING_MASTER_KEY_REF`], and from then on
//! this desktop is paired (design §3.1). Holding it is remote control of
//! this computer, so:
//!
//! - it never reaches a log, a file or a `Debug` string from here
//!   ([`PairingMasterKey`] prints as `PairingMasterKey(..)`), and its bytes
//!   are zeroed when it is dropped;
//! - unpairing is [`clear_master_key`]: remote access is off (the remote
//!   module connects at launch only while a key is stored), and the next
//!   pairing makes a new key, so every phone has to scan again.
//!
//! Not a system keychain: the credential store keeps its own key in the
//! same SQLite database (`credential_store.rs` module docs). P1 moves this
//! to the keychain.

use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ring::rand::{SecureRandom, SystemRandom};
use std::fmt;
use zeroize::{Zeroize, Zeroizing};

/// Credential-store key of the master key.
pub const PAIRING_MASTER_KEY_REF: &str = "remote:pairing:mk";

/// Length of the master key in bytes.
pub const PAIRING_MASTER_KEY_LEN: usize = 32;

/// The pairing master key. No `Debug` of the bytes, no `Display`, no
/// equality (compare [`Self::as_bytes`] in tests only); zeroed on drop.
#[derive(Clone)]
pub struct PairingMasterKey([u8; PAIRING_MASTER_KEY_LEN]);

impl PairingMasterKey {
    pub fn as_bytes(&self) -> &[u8; PAIRING_MASTER_KEY_LEN] {
        &self.0
    }

    fn generate() -> Result<Self> {
        let mut bytes = [0_u8; PAIRING_MASTER_KEY_LEN];
        SystemRandom::new()
            .fill(&mut bytes)
            .map_err(|_| GalleyError::Internal {
                message: "pairing key generation failed".into(),
            })?;
        Ok(Self(bytes))
    }

    /// The stored form: unpadded base64url (the credential store keeps
    /// UTF-8 text).
    fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }

    fn decode(stored: &str) -> Result<Self> {
        // The error never quotes the stored value.
        let malformed = || GalleyError::Internal {
            message: format!("stored pairing key ({PAIRING_MASTER_KEY_REF}) is malformed"),
        };
        let bytes = URL_SAFE_NO_PAD.decode(stored).map_err(|_| malformed())?;
        let bytes: [u8; PAIRING_MASTER_KEY_LEN] = bytes.try_into().map_err(|_| malformed())?;
        Ok(Self(bytes))
    }
}

impl fmt::Debug for PairingMasterKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PairingMasterKey(..)")
    }
}

impl Drop for PairingMasterKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// The stored master key; `None` when this desktop is not paired.
pub async fn read_master_key(galley: &SqliteGalley) -> Result<Option<PairingMasterKey>> {
    credential_store::try_get_secret(galley, PAIRING_MASTER_KEY_REF)
        .await?
        .map(|stored| PairingMasterKey::decode(&stored))
        .transpose()
}

/// A fresh master key, not stored: the remote module holds it in memory
/// until the first phone pairs with it.
pub fn generate_master_key() -> Result<PairingMasterKey> {
    PairingMasterKey::generate()
}

/// Store `key` as this desktop's master key (the first phone completed
/// its handshake with it), replacing any stored one.
pub async fn store_master_key(galley: &SqliteGalley, key: &PairingMasterKey) -> Result<()> {
    let encoded = Zeroizing::new(key.encode());
    credential_store::set_secret(galley, PAIRING_MASTER_KEY_REF, &encoded).await
}

/// Remove the master key. Idempotent.
pub async fn clear_master_key(galley: &SqliteGalley) -> Result<()> {
    credential_store::delete_secret(galley, PAIRING_MASTER_KEY_REF).await
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
    async fn a_generated_key_is_stored_only_when_asked() {
        let g = galley().await;
        let first = generate_master_key().unwrap();
        assert_ne!(first.as_bytes(), &[0_u8; PAIRING_MASTER_KEY_LEN]);
        assert!(read_master_key(&g).await.unwrap().is_none());
        store_master_key(&g, &first).await.unwrap();
        let read = read_master_key(&g).await.unwrap().expect("stored");
        assert_eq!(read.as_bytes(), first.as_bytes());
        // Each generated key is new.
        assert_ne!(generate_master_key().unwrap().as_bytes(), first.as_bytes());
    }

    #[tokio::test]
    async fn storing_replaces_the_key_and_clearing_removes_it() {
        let g = galley().await;
        let first = generate_master_key().unwrap();
        store_master_key(&g, &first).await.unwrap();
        let second = generate_master_key().unwrap();
        store_master_key(&g, &second).await.unwrap();
        let read = read_master_key(&g).await.unwrap().expect("stored");
        assert_eq!(read.as_bytes(), second.as_bytes());

        clear_master_key(&g).await.unwrap();
        clear_master_key(&g).await.unwrap();
        assert!(read_master_key(&g).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn stored_encrypted_under_its_own_ref() {
        let g = galley().await;
        let key = generate_master_key().unwrap();
        store_master_key(&g, &key).await.unwrap();
        let row = g
            .managed_model_secret(PAIRING_MASTER_KEY_REF)
            .await
            .unwrap()
            .expect("credential row");
        let encoded = URL_SAFE_NO_PAD.encode(key.as_bytes());
        assert!(!row
            .ciphertext
            .windows(encoded.len())
            .any(|w| w == encoded.as_bytes()));
        assert!(!row
            .ciphertext
            .windows(PAIRING_MASTER_KEY_LEN)
            .any(|w| w == key.as_bytes()));
    }

    #[tokio::test]
    async fn a_malformed_stored_key_is_an_error_that_does_not_quote_it() {
        let g = galley().await;
        for stored in ["not base64!", "c2hvcnQ"] {
            credential_store::set_secret(&g, PAIRING_MASTER_KEY_REF, stored)
                .await
                .unwrap();
            let err = read_master_key(&g).await.unwrap_err().to_string();
            assert!(err.contains("malformed"), "{err}");
            assert!(!err.contains(stored), "{err}");
        }
    }

    #[test]
    fn debug_never_shows_the_bytes() {
        let key = PairingMasterKey([0xAB; PAIRING_MASTER_KEY_LEN]);
        let shown = format!("{key:?} {:?}", Some(key.clone()));
        assert_eq!(shown, "PairingMasterKey(..) Some(PairingMasterKey(..))");
        assert!(!shown.contains("171") && !shown.to_lowercase().contains("ab"));
    }

    #[test]
    fn encoding_round_trips() {
        let key = PairingMasterKey::generate().unwrap();
        let decoded = PairingMasterKey::decode(&key.encode()).unwrap();
        assert_eq!(decoded.as_bytes(), key.as_bytes());
        assert_eq!(key.encode().len(), 43);
    }
}
