//! The "do not record again" list, `history_insight/galley/forgotten.json`
//! (ticket 04).
//!
//! Deleting an entry on the page is deterministic: Core removes its block
//! ([`super::entries::remove_entry`]). Whether the same thing comes back
//! is up to the model: every mining task lists these entries and tells
//! it not to rebuild them, nor to write the same thing into another
//! entry or an emotional event (`super::batch::task_prompt`). That half
//! is inferential and cannot be made certain; the certain way out is
//! "not used to understand me" on the conversation (migration 045).
//!
//! Galley's file, read-only to the model. To keep it working, Galley
//! keeps the deleted entry's title here — the page says so. "Remove from
//! the list" ([`remove`]) lets it be recorded again; the deleted content
//! does not come back.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::entries::EntryKind;

/// One deleted entry. Wire shape: `{id, kind, title, deletedAt}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forgotten {
    pub id: String,
    pub kind: EntryKind,
    pub title: String,
    /// RFC 3339.
    pub deleted_at: String,
}

/// The list; a missing file is an empty list. A file that does not parse
/// is an error (the caller decides: the page shows nothing, the mining
/// task goes without the list, a delete refuses to overwrite it).
pub fn load(path: &Path) -> io::Result<Vec<Forgotten>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    serde_json::from_str(&raw).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} does not parse: {e}", path.display()),
        )
    })
}

pub fn save(path: &Path, list: &[Forgotten]) -> io::Result<()> {
    let body = serde_json::to_string_pretty(list).expect("forgotten list serializes");
    super::write_atomic(path, format!("{body}\n").as_bytes())
}

/// Add `entry` unless its id is listed already.
pub fn add(path: &Path, entry: Forgotten) -> io::Result<()> {
    let mut list = load(path)?;
    if list.iter().any(|f| f.id == entry.id) {
        return Ok(());
    }
    list.push(entry);
    save(path, &list)
}

/// Take `id` off the list. Writes only when it was there, so a missing
/// list stays missing.
pub fn remove(path: &Path, id: &str) -> io::Result<()> {
    let mut list = load(path)?;
    let before = list.len();
    list.retain(|f| f.id != id);
    if list.len() == before {
        return Ok(());
    }
    save(path, &list)
}

/// The lines the mining task lists: `编号｜标题`, one per entry.
pub fn prompt_lines(list: &[Forgotten]) -> String {
    list.iter()
        .map(|f| format!("{}｜{}", f.id, f.title.replace('\n', " ")))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, title: &str) -> Forgotten {
        Forgotten {
            id: id.into(),
            kind: EntryKind::of_id(id).unwrap(),
            title: title.into(),
            deleted_at: "2026-10-12T08:00:00+00:00".into(),
        }
    }

    #[test]
    fn add_remove_and_wire_shape() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("galley/forgotten.json");
        assert!(load(&path).unwrap().is_empty());
        // Removing from a missing list writes nothing.
        remove(&path, "A001").unwrap();
        assert!(!path.exists());

        add(&path, entry("A003", "日语 N3 备考")).unwrap();
        add(&path, entry("E002", "房东加价")).unwrap();
        add(&path, entry("A003", "又删一次")).unwrap();
        let list = load(&path).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "日语 N3 备考");
        assert_eq!(
            serde_json::to_value(&list[1]).unwrap(),
            serde_json::json!({
                "id": "E002", "kind": "emotion", "title": "房东加价",
                "deletedAt": "2026-10-12T08:00:00+00:00"
            })
        );
        assert_eq!(prompt_lines(&list), "A003｜日语 N3 备考\nE002｜房东加价");

        remove(&path, "A003").unwrap();
        assert_eq!(load(&path).unwrap(), vec![entry("E002", "房东加价")]);
    }

    #[test]
    fn a_corrupt_list_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("forgotten.json");
        fs::write(&path, "[{").unwrap();
        assert!(load(&path).is_err());
        assert!(add(&path, entry("A001", "x")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "[{");
    }
}
