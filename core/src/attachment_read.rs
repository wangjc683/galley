//! Read one conversation attachment, for the remote module (ticket 05c;
//! `attachment.read` in `.scratch/ios-client/issues/05-remote-protocol-design.md`
//! §6.3). A Core function only — no transport, no Tauri command.
//!
//! An attachment is addressed by its session id and its attachment id —
//! the `attachments[].id` every message row carries
//! (`att_<message id>_<n>`) — never by a path. The files sit one level
//! below the session, under the message they belong to
//! (`conversation-attachments/<session>/<message>/<id>.<ext>`, written by
//! `send_message_with_attachments_db`), so a file name alone does not
//! locate one, and the row's stored path is an absolute desktop path a
//! phone has no use for. The database says which file; this module then
//! refuses anything that is not a regular file inside that session's
//! attachment directory once symlinks are resolved.
//!
//! Contrast [`crate::local_file::access`], which takes any absolute path
//! the caller names: a phone's request must never be routed there.

use crate::db::SqliteGalley;
use std::fmt;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The largest attachment returned. A send caps an image at 10 MB
/// (`commands::session`), so a bigger file is not one Galley wrote.
pub const ATTACHMENT_READ_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// One attachment's content.
pub struct AttachmentBytes {
    pub bytes: Vec<u8>,
    /// Guessed from the file's extension; `application/octet-stream`
    /// when it is not an image type Galley knows.
    pub mime_type: &'static str,
}

impl fmt::Debug for AttachmentBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AttachmentBytes")
            .field("len", &self.bytes.len())
            .field("mime_type", &self.mime_type)
            .finish()
    }
}

/// Why an attachment was not returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentReadError {
    /// The session id or the attachment id is not one plain name: empty,
    /// absolute, `.` / `..`, or holding a path separator or a NUL.
    InvalidId,
    /// No such attachment in this session (an id of another session's
    /// attachment included), or its file is gone.
    NotFound,
    /// The file resolves outside the session's attachment directory: a
    /// stored path elsewhere, or a symlink leading out.
    OutsideDirectory,
    /// The path names something other than a regular file.
    NotAFile,
    /// Bigger than the cap.
    TooLarge { size: u64, limit: u64 },
    /// The database or the file system failed.
    Io(String),
}

impl AttachmentReadError {
    /// Stable tag, for the remote protocol's error codes.
    pub fn tag(&self) -> &'static str {
        match self {
            Self::InvalidId => "attachment_invalid_id",
            Self::NotFound => "attachment_not_found",
            Self::OutsideDirectory => "attachment_outside_directory",
            Self::NotAFile => "attachment_not_a_file",
            Self::TooLarge { .. } => "attachment_too_large",
            Self::Io(_) => "attachment_io",
        }
    }
}

impl fmt::Display for AttachmentReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge { size, limit } => {
                write!(f, "{}: {size} bytes, limit {limit}", self.tag())
            }
            Self::Io(detail) => write!(f, "{}: {detail}", self.tag()),
            _ => f.write_str(self.tag()),
        }
    }
}

impl std::error::Error for AttachmentReadError {}

/// Read attachment `attachment_id` of session `session_id` from the
/// app's attachment directory (next to `workbench.db`).
pub async fn read_conversation_attachment(
    galley: &SqliteGalley,
    session_id: &str,
    attachment_id: &str,
) -> Result<AttachmentBytes, AttachmentReadError> {
    let root = crate::app_paths::conversation_attachments_root()
        .ok_or_else(|| AttachmentReadError::Io("attachment directory unavailable".into()))?;
    read_conversation_attachment_in(
        galley,
        &root,
        session_id,
        attachment_id,
        ATTACHMENT_READ_MAX_BYTES,
    )
    .await
}

/// [`read_conversation_attachment`] against an explicit attachments root
/// and cap.
pub(crate) async fn read_conversation_attachment_in(
    galley: &SqliteGalley,
    root: &Path,
    session_id: &str,
    attachment_id: &str,
    max_bytes: u64,
) -> Result<AttachmentBytes, AttachmentReadError> {
    if !is_plain_name(session_id) || !is_plain_name(attachment_id) {
        return Err(AttachmentReadError::InvalidId);
    }
    let stored = galley
        .attachment_file_path(session_id, attachment_id)
        .await
        .map_err(|e| AttachmentReadError::Io(e.to_string()))?
        .ok_or(AttachmentReadError::NotFound)?;
    let root = root.to_path_buf();
    let session_id = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        read_confined(&root, &session_id, Path::new(&stored), max_bytes)
    })
    .await
    .map_err(|e| AttachmentReadError::Io(e.to_string()))?
}

/// One normal path component: no separator of either platform, no NUL,
/// not empty, not `.` / `..`, no drive or root.
fn is_plain_name(name: &str) -> bool {
    if name.is_empty() || name.contains(['/', '\\', '\0']) {
        return false;
    }
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    )
}

/// Read `file` if, symlinks resolved, it is a regular file inside
/// `<root>/<session_id>` — a session directory that is not itself a
/// symlink out of the root.
fn read_confined(
    root: &Path,
    session_id: &str,
    file: &Path,
    max_bytes: u64,
) -> Result<AttachmentBytes, AttachmentReadError> {
    // Stored paths are absolute; a relative one would resolve against
    // the process's working directory.
    if !file.is_absolute() {
        return Err(AttachmentReadError::OutsideDirectory);
    }
    let dir = canonical(root)?.join(session_id);
    if canonical(&dir)? != dir {
        return Err(AttachmentReadError::OutsideDirectory);
    }
    let file = canonical(file)?;
    if file == dir || !file.starts_with(&dir) {
        return Err(AttachmentReadError::OutsideDirectory);
    }
    let metadata = std::fs::metadata(&file).map_err(io_error)?;
    if !metadata.is_file() {
        return Err(AttachmentReadError::NotAFile);
    }
    if metadata.len() > max_bytes {
        return Err(AttachmentReadError::TooLarge {
            size: metadata.len(),
            limit: max_bytes,
        });
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    // `take`: a file that grew since the size check still stops at the cap.
    std::fs::File::open(&file)
        .map_err(io_error)?
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > max_bytes {
        return Err(AttachmentReadError::TooLarge {
            size: bytes.len() as u64,
            limit: max_bytes,
        });
    }
    Ok(AttachmentBytes {
        mime_type: mime_from_extension(&file),
        bytes,
    })
}

fn canonical(path: &Path) -> Result<PathBuf, AttachmentReadError> {
    path.canonicalize().map_err(io_error)
}

fn io_error(e: std::io::Error) -> AttachmentReadError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AttachmentReadError::NotFound
    } else {
        AttachmentReadError::Io(e.to_string())
    }
}

fn mime_from_extension(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";

    /// A database with sessions `s1` / `s2`, a message in each, and an
    /// attachments root in a temp dir.
    struct Fixture {
        galley: SqliteGalley,
        root: TempDir,
    }

    impl Fixture {
        async fn new() -> Self {
            let pool = sqlx::SqlitePool::connect("sqlite::memory:")
                .await
                .expect("open in-memory sqlite");
            for m in crate::db_migrations::all() {
                sqlx::raw_sql(m.sql)
                    .execute(&pool)
                    .await
                    .expect("migration");
            }
            for sid in ["s1", "s2"] {
                sqlx::query(
                    "INSERT INTO sessions (id, title, status, turn_count, \
                        pending_approval_count, error_count, pinned, \
                        last_activity_at, created_at, updated_at) \
                     VALUES (?, 't', 'idle', 0, 0, 0, 0, 'x', 'x', 'x')",
                )
                .bind(sid)
                .execute(&pool)
                .await
                .expect("seed session");
                sqlx::query(
                    "INSERT INTO messages (id, session_id, turn_index, sequence, role, \
                        content, created_at) VALUES (?, ?, 0, 0, 'user', 'hi', 'x')",
                )
                .bind(format!("msg_{sid}"))
                .bind(sid)
                .execute(&pool)
                .await
                .expect("seed message");
            }
            Self {
                galley: SqliteGalley::from_pool(pool),
                root: TempDir::new().expect("tempdir"),
            }
        }

        /// `<root>/<sid>/msg_<sid>/<name>` with `bytes`.
        fn file(&self, sid: &str, name: &str, bytes: &[u8]) -> PathBuf {
            let dir = self.root.path().join(sid).join(format!("msg_{sid}"));
            std::fs::create_dir_all(&dir).expect("mkdir");
            let path = dir.join(name);
            std::fs::write(&path, bytes).expect("write");
            path
        }

        /// An attachment row of `sid` whose stored path is `path`.
        async fn row(&self, sid: &str, id: &str, path: &Path) {
            sqlx::query(
                "INSERT INTO message_attachments (id, message_id, session_id, kind, \
                    file_path, mime_type, byte_size, created_at) \
                 VALUES (?, ?, ?, 'image', ?, 'image/png', 0, 'x')",
            )
            .bind(id)
            .bind(format!("msg_{sid}"))
            .bind(sid)
            .bind(path.to_string_lossy().into_owned())
            .execute(self.galley.pool())
            .await
            .expect("seed attachment");
        }

        async fn read(&self, sid: &str, id: &str) -> Result<AttachmentBytes, AttachmentReadError> {
            self.read_capped(sid, id, ATTACHMENT_READ_MAX_BYTES).await
        }

        async fn read_capped(
            &self,
            sid: &str,
            id: &str,
            max: u64,
        ) -> Result<AttachmentBytes, AttachmentReadError> {
            read_conversation_attachment_in(&self.galley, self.root.path(), sid, id, max).await
        }
    }

    #[tokio::test]
    async fn reads_an_attachment_of_the_session_with_its_type() {
        let fx = Fixture::new().await;
        let path = fx.file("s1", "att_msg_s1_1.png", PNG);
        fx.row("s1", "att_msg_s1_1", &path).await;
        let read = fx.read("s1", "att_msg_s1_1").await.expect("read");
        assert_eq!(read.bytes, PNG);
        assert_eq!(read.mime_type, "image/png");
        // Debug never dumps the bytes.
        assert!(!format!("{read:?}").contains("PNG"));
    }

    #[tokio::test]
    async fn ids_that_are_not_one_plain_name_are_refused() {
        let fx = Fixture::new().await;
        let path = fx.file("s1", "att_msg_s1_1.png", PNG);
        fx.row("s1", "att_msg_s1_1", &path).await;
        for bad in [
            "",
            ".",
            "..",
            "../s2",
            "a/b",
            "a\\b",
            "/etc/passwd",
            "\\\\server\\share",
            "C:\\x",
            "att\0x",
        ] {
            assert_eq!(
                fx.read("s1", bad).await.unwrap_err(),
                AttachmentReadError::InvalidId,
                "attachment id {bad:?}"
            );
            assert_eq!(
                fx.read(bad, "att_msg_s1_1").await.unwrap_err(),
                AttachmentReadError::InvalidId,
                "session id {bad:?}"
            );
        }
    }

    #[tokio::test]
    async fn unknown_ids_other_sessions_and_missing_files_are_not_found() {
        let fx = Fixture::new().await;
        let path = fx.file("s1", "att_msg_s1_1.png", PNG);
        fx.row("s1", "att_msg_s1_1", &path).await;
        assert_eq!(
            fx.read("s1", "att_nope").await.unwrap_err(),
            AttachmentReadError::NotFound
        );
        // Another session's attachment is not this session's.
        assert_eq!(
            fx.read("s2", "att_msg_s1_1").await.unwrap_err(),
            AttachmentReadError::NotFound
        );
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            fx.read("s1", "att_msg_s1_1").await.unwrap_err(),
            AttachmentReadError::NotFound
        );
    }

    #[tokio::test]
    async fn a_stored_path_outside_the_session_directory_is_refused() {
        let fx = Fixture::new().await;
        fx.file("s1", "att_msg_s1_1.png", PNG);
        // A row of s1 pointing at s2's file.
        let other = fx.file("s2", "att_msg_s2_1.png", PNG);
        fx.row("s1", "att_cross", &other).await;
        assert_eq!(
            fx.read("s1", "att_cross").await.unwrap_err(),
            AttachmentReadError::OutsideDirectory
        );
        // Out of the attachments root through `..`: a sibling directory.
        let parent = fx.root.path().parent().unwrap();
        let outside = TempDir::new_in(parent).unwrap();
        std::fs::write(outside.path().join("secret.png"), b"secret").unwrap();
        let dotted = fx
            .root
            .path()
            .join("s1")
            .join("..")
            .join("..")
            .join(outside.path().file_name().unwrap())
            .join("secret.png");
        fx.row("s1", "att_dotted", &dotted).await;
        assert_eq!(
            fx.read("s1", "att_dotted").await.unwrap_err(),
            AttachmentReadError::OutsideDirectory
        );
        // `..` that stays inside is only a spelling.
        let inside = fx
            .root
            .path()
            .join("s1")
            .join("msg_s1")
            .join("..")
            .join("msg_s1")
            .join("att_msg_s1_1.png");
        fx.row("s1", "att_inside", &inside).await;
        assert_eq!(fx.read("s1", "att_inside").await.unwrap().bytes, PNG);
        // A relative stored path.
        fx.row(
            "s1",
            "att_relative",
            Path::new("s1/msg_s1/att_msg_s1_1.png"),
        )
        .await;
        assert_eq!(
            fx.read("s1", "att_relative").await.unwrap_err(),
            AttachmentReadError::OutsideDirectory
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlinks_leading_out_of_the_session_directory_are_refused() {
        let fx = Fixture::new().await;
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.png");
        std::fs::write(&secret, b"secret").unwrap();

        // A file inside the directory that is a link to one outside.
        let dir = fx.root.path().join("s1").join("msg_s1");
        std::fs::create_dir_all(&dir).unwrap();
        let link = dir.join("att_link.png");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        fx.row("s1", "att_link", &link).await;
        assert_eq!(
            fx.read("s1", "att_link").await.unwrap_err(),
            AttachmentReadError::OutsideDirectory
        );

        // A session directory that is itself a link out of the root.
        std::os::unix::fs::symlink(outside.path(), fx.root.path().join("s2")).unwrap();
        let through = fx.root.path().join("s2").join("secret.png");
        fx.row("s2", "att_through", &through).await;
        assert_eq!(
            fx.read("s2", "att_through").await.unwrap_err(),
            AttachmentReadError::OutsideDirectory
        );

        // A link that stays inside the directory is fine.
        let real = fx.file("s1", "att_real.png", PNG);
        let inner = dir.join("att_inner.png");
        std::os::unix::fs::symlink(&real, &inner).unwrap();
        fx.row("s1", "att_inner", &inner).await;
        assert_eq!(fx.read("s1", "att_inner").await.unwrap().bytes, PNG);
    }

    #[tokio::test]
    async fn a_directory_is_not_a_file() {
        let fx = Fixture::new().await;
        let file = fx.file("s1", "att_msg_s1_1.png", PNG);
        fx.row("s1", "att_dir", file.parent().unwrap()).await;
        assert_eq!(
            fx.read("s1", "att_dir").await.unwrap_err(),
            AttachmentReadError::NotAFile
        );
        // The session directory itself is not an attachment either.
        fx.row("s1", "att_session_dir", &fx.root.path().join("s1"))
            .await;
        assert_eq!(
            fx.read("s1", "att_session_dir").await.unwrap_err(),
            AttachmentReadError::OutsideDirectory
        );
    }

    #[tokio::test]
    async fn a_file_over_the_cap_is_refused() {
        let fx = Fixture::new().await;
        let path = fx.file("s1", "att_big.png", b"12345");
        fx.row("s1", "att_big", &path).await;
        assert_eq!(
            fx.read_capped("s1", "att_big", 4).await.unwrap_err(),
            AttachmentReadError::TooLarge { size: 5, limit: 4 }
        );
        assert_eq!(
            fx.read_capped("s1", "att_big", 5).await.unwrap().bytes,
            b"12345"
        );
    }

    #[test]
    fn mime_types_follow_the_extension() {
        for (name, mime) in [
            ("a.png", "image/png"),
            ("a.PNG", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.webp", "image/webp"),
            ("a.gif", "image/gif"),
            ("a.txt", "application/octet-stream"),
            ("a", "application/octet-stream"),
        ] {
            assert_eq!(mime_from_extension(Path::new(name)), mime, "{name}");
        }
    }

    #[test]
    fn error_tags_are_stable() {
        assert_eq!(
            AttachmentReadError::InvalidId.tag(),
            "attachment_invalid_id"
        );
        assert_eq!(AttachmentReadError::NotFound.tag(), "attachment_not_found");
        assert_eq!(
            AttachmentReadError::OutsideDirectory.tag(),
            "attachment_outside_directory"
        );
        assert_eq!(AttachmentReadError::NotAFile.tag(), "attachment_not_a_file");
        assert_eq!(
            AttachmentReadError::TooLarge { size: 2, limit: 1 }.tag(),
            "attachment_too_large"
        );
        assert_eq!(AttachmentReadError::Io("x".into()).tag(), "attachment_io");
    }
}
