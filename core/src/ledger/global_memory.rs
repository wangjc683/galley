//! GA's global memory in the managed state root (ticket 04): the two
//! files the engine puts in every system prompt, `memory/global_mem.txt`
//! (L2 facts) and `memory/global_mem_insight.txt` (L1 index). Shown on
//! the Memory page as text and editable there. Not the ledger and not
//! under its switch: the assistant writes them itself during
//! conversations (upstream's memory SOPs).
//!
//! Upstream creates either file only when it is missing
//! (`managed-ga/code/agentmain.py`, module level), the memory seed copies
//! only missing files and ships neither (`crate::managed_runtime`,
//! `copy_missing_tree`), and runtime upgrades replace code, not the state
//! root — so an edit here is never overwritten (Rule 1, "user state is
//! not").
//!
//! Optimistic concurrency: `revision` is a hash of the bytes on disk; a
//! write must name the revision it edited, and a file the assistant
//! changed in between is refused ([`WriteError::ChangedOnDisk`]).

use std::fs;
use std::io;
use std::path::Path;

use ring::digest::{digest, SHA256};
use serde::Serialize;

use super::LedgerPaths;

/// The two files, in page order.
pub const NAMES: [&str; 2] = ["global_mem.txt", "global_mem_insight.txt"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemoryFile {
    pub name: String,
    pub exists: bool,
    /// The text (lossy UTF-8); empty when the file does not exist.
    pub content: String,
    pub revision: String,
}

/// Hex SHA-256 of the file's bytes; a missing file hashes as empty.
pub fn revision(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn read_bytes(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Both files; an unreadable one reads as missing (logged).
pub fn read_all(paths: &LedgerPaths) -> Vec<GlobalMemoryFile> {
    NAMES
        .iter()
        .map(|name| {
            let path = paths.memory_dir().join(name);
            let bytes = read_bytes(&path).unwrap_or_else(|e| {
                eprintln!("[ledger] reading {} failed: {e}", path.display());
                None
            });
            GlobalMemoryFile {
                name: (*name).to_string(),
                exists: bytes.is_some(),
                content: bytes
                    .as_deref()
                    .map(|b| String::from_utf8_lossy(b).into_owned())
                    .unwrap_or_default(),
                revision: revision(bytes.as_deref().unwrap_or_default()),
            }
        })
        .collect()
}

#[derive(Debug)]
pub enum WriteError {
    /// Not one of [`NAMES`].
    UnknownName,
    /// The file is not the revision the edit started from.
    ChangedOnDisk,
    Io(io::Error),
}

/// Replace file `name` with `content` if it is still at `expected`
/// (temp file + rename). Returns the new revision.
pub fn write(
    paths: &LedgerPaths,
    name: &str,
    content: &str,
    expected: &str,
) -> Result<String, WriteError> {
    if !NAMES.contains(&name) {
        return Err(WriteError::UnknownName);
    }
    let path = paths.memory_dir().join(name);
    let current = read_bytes(&path).map_err(WriteError::Io)?;
    if revision(current.as_deref().unwrap_or_default()) != expected {
        return Err(WriteError::ChangedOnDisk);
    }
    super::write_atomic(&path, content.as_bytes()).map_err(WriteError::Io)?;
    Ok(revision(content.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_write_and_a_concurrent_change() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LedgerPaths::new(dir.path().to_path_buf());
        let files = read_all(&paths);
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|f| !f.exists && f.content.is_empty()));
        assert_eq!(files[0].revision, revision(b""));

        // A missing file can be written from its (empty) revision.
        let rev = write(
            &paths,
            "global_mem.txt",
            "# [Global Memory - L2]\n",
            &files[0].revision,
        )
        .unwrap();
        let files = read_all(&paths);
        assert!(files[0].exists);
        assert_eq!(files[0].revision, rev);
        assert_eq!(files[0].content, "# [Global Memory - L2]\n");

        // The assistant writes in between: the stale edit is refused and
        // the file keeps the assistant's text.
        fs::write(paths.memory_dir().join("global_mem.txt"), "助理刚写的\n").unwrap();
        assert!(matches!(
            write(&paths, "global_mem.txt", "用户的编辑", &rev),
            Err(WriteError::ChangedOnDisk)
        ));
        assert_eq!(read_all(&paths)[0].content, "助理刚写的\n");

        assert!(matches!(
            write(&paths, "../secrets.txt", "x", &rev),
            Err(WriteError::UnknownName)
        ));
        assert!(!dir.path().join("secrets.txt").exists());
    }
}
