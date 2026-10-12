//! The ledger's own bookkeeping, `history_insight/galley/state.json`.
//!
//! Core is its only writer (the startup archive pass, then the daily job,
//! never both at once). It lives next to what it describes — the IM
//! archive and the mining outputs — so the state root stays the one unit
//! a backup or a device move carries, and deleting `history_insight/`
//! resets the ledger as a whole.
//!
//! Two positions, each advanced by exactly one step:
//!
//! - `imLogs`: how far the IM archive has read each engine log (byte
//!   offset of the first block not yet consumed), plus the channel the
//!   log was attributed to. Advanced by every archive pass.
//! - `mined`: what the mining has processed — GUI turns before
//!   `guiUntil`, archive bytes before `imArchiveOffset`. A run is handed
//!   `pending`; only a run that completed successfully turns `pending`
//!   into `mined`. A failed run leaves `mined` alone, so its batch is part
//!   of the next one.
//!
//! Plus `dueAt`, a one-off "run from this instant on" beside the daily
//! schedule: set when the user turns the ledger on with "look back" (the
//! first run starts within a minute) and after a successful run that
//! stopped at the read cap (the rest follows ten minutes later); every
//! other attempt clears it (`run::begin` / `run::finish`).

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerState {
    /// Engine-log read positions, by log file name.
    #[serde(default)]
    pub im_logs: BTreeMap<String, LogCursor>,
    /// What successful runs have processed. `None` before the first one:
    /// everything from the switch's `since` is new.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mined: Option<MinedCursor>,
    /// The position the last started run was given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<MinedCursor>,
    /// Local date (`YYYY-MM-DD`) of the last scheduled attempt; the daily
    /// job makes one per day, successful or not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_attempt_date: Option<String>,
    /// What the last attempt did, for whoever looks (ticket 04, a human).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run: Option<LastRun>,
    /// RFC 3339 instant from which a run is due whatever the daily
    /// schedule says (see the module notes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    /// The pending batch stopped at the read cap: more is left to read
    /// after it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pending_more: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCursor {
    pub offset: u64,
    /// IM channel the log belongs to, when Galley's channel state named
    /// it at some pass (`wechat` / `feishu` / `telegram` / `discord`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinedCursor {
    /// RFC 3339 UTC instant; GUI turns created before it are processed.
    pub gui_until: String,
    /// Byte length of `im_archive.jsonl` that is processed.
    pub im_archive_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    /// RFC 3339 UTC instant the attempt started. (No session id: the
    /// mining session is deleted once the run settles. A `sessionId` in
    /// a state file from before ticket 04 is ignored.)
    pub started_at: String,
    /// `running`, `succeeded`, `empty` (nothing new, no model call) or
    /// `failed`.
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Size of the batch: user turns in it.
    pub turns: usize,
}

impl LedgerState {
    /// Read the state file; a missing file is the empty state. A file
    /// that does not parse is an error: guessing would re-read and
    /// re-archive from the beginning.
    pub fn load(path: &Path) -> io::Result<Self> {
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e),
        };
        serde_json::from_str(&raw).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{} does not parse: {e}", path.display()),
            )
        })
    }

    /// Write the state file atomically (temp file + rename), creating its
    /// directory.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let body = serde_json::to_string_pretty(self).expect("ledger state serializes");
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, body + "\n")?;
        fs::rename(&tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_the_empty_state() {
        let dir = tempfile::tempdir().unwrap();
        let state = LedgerState::load(&dir.path().join("galley/state.json")).unwrap();
        assert_eq!(state, LedgerState::default());
    }

    #[test]
    fn round_trips_and_creates_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("galley/state.json");
        let mut state = LedgerState::default();
        state.im_logs.insert(
            "model_responses_1.txt".into(),
            LogCursor {
                offset: 42,
                channel: Some("feishu".into()),
            },
        );
        state.mined = Some(MinedCursor {
            gui_until: "2026-10-12T04:00:00+00:00".into(),
            im_archive_offset: 7,
        });
        state.save(&path).unwrap();
        assert_eq!(LedgerState::load(&path).unwrap(), state);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn a_state_file_from_before_ticket_04_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(
            &path,
            r#"{"lastAttemptDate": "2026-10-12", "lastRun": {"startedAt": "2026-10-12T00:00:00+00:00", "sessionId": "s-old", "outcome": "succeeded", "turns": 3}}"#,
        )
        .unwrap();
        let state = LedgerState::load(&path).unwrap();
        assert_eq!(state.last_run.unwrap().turns, 3);
        assert_eq!(state.due_at, None);
    }

    #[test]
    fn a_corrupt_file_is_an_error_not_a_fresh_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, "{not json").unwrap();
        assert!(LedgerState::load(&path).is_err());
    }
}
