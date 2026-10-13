//! A failed run leaves nothing behind (ticket 04).
//!
//! The model edits the ledger's two files in place over many tool
//! calls; a run that fails, times out or is stopped (the user switching
//! the ledger off) can stop between two of them. So before the model
//! starts, [`snapshot`] copies the files into `galley/rollback/`; when
//! the run settles, a success [`discard`]s the copy and a failure
//! [`restore`]s it — files that did not exist then are deleted. With the
//! position also unmoved, "failed" means exactly "nothing happened": the
//! next run reads the same batch over the same files.
//!
//! The manifest is written last, so a snapshot without one was
//! interrupted before the model started and is simply dropped. A
//! snapshot still there when the next run begins (Galley quit mid-run)
//! is restored then (`super::run::begin`). Everything runs under the run
//! lock, and "clear" removes the whole directory only after the run has
//! settled (`super::control`), so a restore never writes a cleared file
//! back.

use std::fs;
use std::io;

use serde::{Deserialize, Serialize};

use super::{write_atomic, LedgerPaths};

/// The files a run may change (one fewer since ticket 04d moved emotions
/// into their affairs' blocks).
pub const FILES: [&str; 2] = ["activities.md", "ongoing_affairs.md"];

const MANIFEST: &str = "manifest.json";

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    /// Which of [`FILES`] existed (and were copied).
    existed: Vec<String>,
}

fn remove_dir(path: &std::path::Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Copy the files as they are now; replaces any earlier snapshot.
pub fn snapshot(paths: &LedgerPaths) -> io::Result<()> {
    let dir = paths.rollback_dir();
    remove_dir(&dir)?;
    fs::create_dir_all(&dir)?;
    let mut existed = Vec::new();
    for name in FILES {
        match fs::copy(paths.insight_dir().join(name), dir.join(name)) {
            Ok(_) => existed.push(name.to_string()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    let body = serde_json::to_vec(&Manifest { existed }).expect("manifest serializes");
    write_atomic(&dir.join(MANIFEST), &body)
}

/// Put the files back as the snapshot has them and drop it. `false` when
/// there was no complete snapshot (nothing to undo). On an error the
/// snapshot stays, for the next attempt.
pub fn restore(paths: &LedgerPaths) -> io::Result<bool> {
    let dir = paths.rollback_dir();
    let manifest: Manifest = match fs::read(dir.join(MANIFEST)) {
        Ok(raw) => serde_json::from_slice(&raw)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            remove_dir(&dir)?;
            return Ok(false);
        }
        Err(e) => return Err(e),
    };
    for name in FILES {
        let target = paths.insight_dir().join(name);
        if manifest.existed.iter().any(|n| n == name) {
            write_atomic(&target, &fs::read(dir.join(name))?)?;
        } else {
            match fs::remove_file(&target) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        }
    }
    remove_dir(&dir)?;
    Ok(true)
}

/// Drop the snapshot (the run succeeded).
pub fn discard(paths: &LedgerPaths) -> io::Result<()> {
    remove_dir(&paths.rollback_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, LedgerPaths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
        fs::create_dir_all(paths.insight_dir()).unwrap();
        (dir, paths)
    }

    fn read(paths: &LedgerPaths, name: &str) -> Option<String> {
        fs::read_to_string(paths.insight_dir().join(name)).ok()
    }

    #[test]
    fn restore_puts_back_what_was_there_and_removes_what_was_not() {
        let (_dir, paths) = setup();
        fs::write(paths.activities_file(), "原来的活动\n").unwrap();
        fs::write(paths.affairs_file(), "- A001｜原来的\n").unwrap();
        snapshot(&paths).unwrap();

        // The run rewrites one file and empties the other.
        fs::write(paths.activities_file(), "写了一半").unwrap();
        fs::write(paths.affairs_file(), "").unwrap();

        assert!(restore(&paths).unwrap());
        assert_eq!(
            read(&paths, "activities.md").as_deref(),
            Some("原来的活动\n")
        );
        assert_eq!(
            read(&paths, "ongoing_affairs.md").as_deref(),
            Some("- A001｜原来的\n")
        );
        assert!(!paths.rollback_dir().exists());
        // Nothing left to undo.
        assert!(!restore(&paths).unwrap());
    }

    #[test]
    fn restore_removes_a_file_the_run_created() {
        let (_dir, paths) = setup();
        snapshot(&paths).unwrap();
        fs::write(paths.activities_file(), "新建的一半").unwrap();
        fs::write(paths.affairs_file(), "- A001｜").unwrap();
        assert!(restore(&paths).unwrap());
        assert_eq!(read(&paths, "activities.md"), None);
        assert_eq!(read(&paths, "ongoing_affairs.md"), None);
    }

    #[test]
    fn discard_keeps_the_new_files() {
        let (_dir, paths) = setup();
        snapshot(&paths).unwrap();
        fs::write(paths.activities_file(), "新的").unwrap();
        discard(&paths).unwrap();
        assert!(!paths.rollback_dir().exists());
        assert_eq!(read(&paths, "activities.md").as_deref(), Some("新的"));
        assert!(!restore(&paths).unwrap());
        assert_eq!(read(&paths, "activities.md").as_deref(), Some("新的"));
    }

    #[test]
    fn a_snapshot_without_its_manifest_is_dropped_untouched() {
        let (_dir, paths) = setup();
        fs::write(paths.activities_file(), "现在的").unwrap();
        fs::create_dir_all(paths.rollback_dir()).unwrap();
        fs::write(paths.rollback_dir().join("activities.md"), "半个快照").unwrap();
        assert!(!restore(&paths).unwrap());
        assert_eq!(read(&paths, "activities.md").as_deref(), Some("现在的"));
        assert!(!paths.rollback_dir().exists());
    }

    #[test]
    fn nothing_to_snapshot_or_restore_when_cleared() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
        assert!(!restore(&paths).unwrap());
        discard(&paths).unwrap();
        assert!(!paths.state_root().exists());
    }
}
