//! Platform paths that must match Tauri's runtime resolver.
//!
//! `tauri-plugin-sql` resolves `sqlite:workbench.db` against
//! `app.path().app_config_dir()`, which is `<config_dir>/app.galley`.
//! Galley Core and the CLI do not always have an `AppHandle`, so they
//! reproduce that resolver here with `directories::BaseDirs`.

use std::path::{Path, PathBuf};

use directories::BaseDirs;

/// Tauri bundle identifier. Changing this moves the user data directory.
pub(crate) const APP_IDENTIFIER: &str = "app.galley";

/// Main SQLite filename used by `tauri-plugin-sql`'s `sqlite:workbench.db`.
pub(crate) const DB_FILENAME: &str = "workbench.db";

const DB_PATH_ENV: &str = "GALLEY_DB_PATH";

pub(crate) fn app_config_dir() -> Option<PathBuf> {
    BaseDirs::new().map(|dirs| app_config_dir_from_base(dirs.config_dir()))
}

pub(crate) fn db_path() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var(DB_PATH_ENV) {
        if !override_path.is_empty() {
            return Some(PathBuf::from(override_path));
        }
    }
    app_config_dir().map(|dir| dir.join(DB_FILENAME))
}

fn app_config_dir_from_base(base_config_dir: &Path) -> PathBuf {
    base_config_dir.join(APP_IDENTIFIER)
}

/// Galley-owned durable media directory for conversation attachments.
/// Kept next to `workbench.db` so backups and `GALLEY_DB_PATH`-based test
/// runs keep the database and attachment files together.
pub(crate) fn conversation_attachment_session_dir(session_id: &str) -> Option<PathBuf> {
    let db = db_path()?;
    let base = db.parent()?;
    Some(conversation_attachment_session_dir_from_base(
        base, session_id,
    ))
}

pub(crate) fn conversation_attachment_dir(session_id: &str, message_id: &str) -> Option<PathBuf> {
    let db = db_path()?;
    let base = db.parent()?;
    Some(conversation_attachment_dir_from_base(
        base, session_id, message_id,
    ))
}

fn conversation_attachment_session_dir_from_base(base: &Path, session_id: &str) -> PathBuf {
    base.join("conversation-attachments").join(session_id)
}

fn conversation_attachment_dir_from_base(
    base: &Path,
    session_id: &str,
    message_id: &str,
) -> PathBuf {
    conversation_attachment_session_dir_from_base(base, session_id).join(message_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_config_dir_matches_tauri_sql_layout() {
        let base = Path::new("/Users/alice/Library/Application Support");
        assert_eq!(app_config_dir_from_base(base), base.join(APP_IDENTIFIER));
    }

    #[test]
    fn db_path_sits_directly_under_app_config_dir() {
        let base = Path::new("/tmp/galley-config");
        let app_dir = app_config_dir_from_base(base);
        let db = app_dir.join(DB_FILENAME);

        assert_eq!(db, base.join(APP_IDENTIFIER).join(DB_FILENAME));
        assert!(!db.components().any(|c| c.as_os_str() == "data"));
    }

    #[test]
    fn conversation_attachment_dir_is_message_scoped_next_to_db() {
        let base = Path::new("/tmp/galley-config/app.galley");
        assert_eq!(
            conversation_attachment_session_dir_from_base(base, "sess_1"),
            base.join("conversation-attachments").join("sess_1"),
        );
        assert_eq!(
            conversation_attachment_dir_from_base(base, "sess_1", "msg_1"),
            base.join("conversation-attachments")
                .join("sess_1")
                .join("msg_1"),
        );
    }
}
