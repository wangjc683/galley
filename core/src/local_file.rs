//! Local file presentation. Never scans directories or mutates user files.
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{GalleyError, Result};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// How much of an unknown-extension file is inspected to decide whether
/// it is previewable text. Enough to catch a binary header; cheap enough
/// to run on every `inspect`.
const SNIFF_BYTES: u64 = 8 * 1024;

/// Extensions classified as previewable text without sniffing. Code and
/// data files an agent commonly writes; the list is a fast path, not a
/// gate — unknown extensions fall through to a content sniff.
#[rustfmt::skip]
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "log", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg",
    "conf", "env", "xml", "html", "htm", "css", "scss", "less", "js", "jsx", "mjs", "cjs", "ts",
    "tsx", "py", "pyi", "rs", "go", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp",
    "cs", "rb", "php", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "r", "lua", "pl",
    "pm", "ex", "exs", "erl", "dart", "scala", "hs", "clj", "cljs", "vue", "svelte", "graphql",
    "gql", "proto", "diff", "patch", "mdx", "rst", "tex", "bib", "gitignore", "gitattributes",
    "editorconfig", "dockerfile", "makefile", "lock", "properties", "plist", "srt", "vtt",
];
/// Extension-less files that are text by convention.
#[rustfmt::skip]
const TEXT_BASENAMES: &[&str] = &[
    "makefile", "dockerfile", "license", "licence", "readme", "changelog", "authors",
    "contributing", "gemfile", "rakefile", "procfile", "justfile", "pipfile", "brewfile",
];
/// Text kinds whose default application is a viewer or editor. Scripts
/// (`.sh`, `.py`, `.bat`, `.ps1`, …) are deliberately absent: on some
/// desktops "open with default app" executes them, so a chat link must
/// never become an execution shortcut. Reveal-in-folder stays available.
#[rustfmt::skip]
const OPENABLE_TEXT_EXTENSIONS: &[&str] = &[
    "txt", "log", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml", "toml", "xml", "ini",
    "cfg", "conf", "rst", "tex", "srt", "vtt",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalFileAction {
    Inspect,
    Read,
    ReadImage,
    Reveal,
    Open,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRequest {
    pub path: String,
    pub action: LocalFileAction,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileResult {
    pub path: String,
    pub kind: String,
    pub content: Option<String>,
}

pub async fn access(request: LocalFileRequest) -> Result<LocalFileResult> {
    // File and OS operations must not block the async executor / desktop UI.
    tokio::task::spawn_blocking(move || access_sync(request))
        .await
        .map_err(|e| GalleyError::Internal {
            message: format!("local_file_io: {e}"),
        })?
}

fn absolute_path(value: &str) -> Result<PathBuf> {
    let path = if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        directories::BaseDirs::new()
            .ok_or_else(|| invalid("local_file_absolute_required"))?
            .home_dir()
            .join(rest)
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() || value.contains('\0') {
        return Err(invalid("local_file_absolute_required"));
    }
    Ok(path)
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_markdown(path: &Path) -> bool {
    matches!(extension(path).as_str(), "md" | "markdown")
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match extension(path).as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn is_text_by_name(path: &Path) -> bool {
    let ext = extension(path);
    if !ext.is_empty() {
        return TEXT_EXTENSIONS.contains(&ext.as_str());
    }
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    // Dotfiles (`.gitignore`, `.env`) have no extension in the OS sense;
    // their whole name after the dot is the type.
    if let Some(dotfile) = name.strip_prefix('.') {
        return TEXT_EXTENSIONS.contains(&dotfile);
    }
    TEXT_BASENAMES.contains(&name.as_str())
}

/// Extension-less name outside the basename list: look at the first
/// bytes. No NUL and valid UTF-8 (allowing a multibyte sequence cut at
/// the sniff boundary) reads as text; anything else is an opaque file the
/// OS should handle. Files with an unknown extension are not sniffed —
/// the extension is the author's statement of type, and guessing past it
/// would make `.docx`-style containers flicker between kinds.
fn sniff_text(path: &Path) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut bytes = Vec::new();
    if file.take(SNIFF_BYTES).read_to_end(&mut bytes).is_err() {
        return false;
    }
    if bytes.contains(&0) {
        return false;
    }
    match std::str::from_utf8(&bytes) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none() && bytes.len() as u64 == SNIFF_BYTES,
    }
}

/// Presentation kind of a regular file. `markdown` renders as a document,
/// `image` through `read_image`, `text` as numbered plain lines; `file`
/// is everything the reading panel does not open and only reveals.
fn classify_file(path: &Path) -> &'static str {
    if is_markdown(path) {
        "markdown"
    } else if image_mime(path).is_some() {
        "image"
    } else if is_text_by_name(path) || (extension(path).is_empty() && sniff_text(path)) {
        "text"
    } else {
        "file"
    }
}

/// Whether "open with the default application" is safe for this target:
/// documents and images, never scripts (see `OPENABLE_TEXT_EXTENSIONS`).
fn is_openable(path: &Path) -> bool {
    is_markdown(path)
        || image_mime(path).is_some()
        || OPENABLE_TEXT_EXTENSIONS.contains(&extension(path).as_str())
}

fn access_sync(request: LocalFileRequest) -> Result<LocalFileResult> {
    let path = absolute_path(&request.path)?;
    let metadata = std::fs::metadata(&path).map_err(io_error)?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        classify_file(&path)
    } else {
        // Never try reading FIFOs, devices, sockets, etc.
        return Err(invalid("local_file_unsupported"));
    };
    let mut result = LocalFileResult {
        path: path.to_string_lossy().into_owned(),
        kind: kind.into(),
        content: None,
    };
    match request.action {
        LocalFileAction::Inspect => {}
        LocalFileAction::ReadImage => {
            let Some(mime) = image_mime(&path) else {
                return Err(invalid("local_file_unsupported"));
            };
            if !metadata.is_file() {
                return Err(invalid("local_file_unsupported"));
            }
            let max = MAX_IMAGE_BYTES;
            if metadata.len() > max {
                return Err(invalid("local_file_too_large"));
            }
            let file = std::fs::File::open(&path).map_err(io_error)?;
            if !file.metadata().map_err(io_error)?.is_file() {
                return Err(invalid("local_file_unsupported"));
            }
            let mut bytes = Vec::new();
            file.take(max + 1)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            if bytes.len() as u64 > max {
                return Err(invalid("local_file_too_large"));
            }
            result.content = Some(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
        LocalFileAction::Read => {
            if kind != "markdown" && kind != "text" {
                return Err(invalid("local_file_unsupported"));
            }
            if metadata.len() > MAX_TEXT_BYTES {
                return Err(invalid("local_file_too_large"));
            }
            let file = std::fs::File::open(&path).map_err(io_error)?;
            if !file.metadata().map_err(io_error)?.is_file() {
                return Err(invalid("local_file_unsupported"));
            }
            // Cap the read itself as well as metadata: a running agent may grow the file.
            let mut bytes = Vec::new();
            file.take(MAX_TEXT_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            if bytes.len() as u64 > MAX_TEXT_BYTES {
                return Err(invalid("local_file_too_large"));
            }
            let text = String::from_utf8(bytes).map_err(|_| invalid("local_file_encoding"))?;
            if text.contains('\0') {
                return Err(invalid("local_file_encoding"));
            }
            result.content = Some(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned());
        }
        LocalFileAction::Reveal => {
            if kind == "directory" {
                tauri_plugin_opener::open_path(&path, None::<&str>)
            } else {
                tauri_plugin_opener::reveal_item_in_dir(&path)
            }
            .map_err(|e| GalleyError::Internal {
                message: format!("local_file_io: {e}"),
            })?;
        }
        LocalFileAction::Open => {
            // A document-looking symlink to an executable must never become an
            // execution shortcut: the canonical target decides, by its own name.
            let target = std::fs::canonicalize(&path).map_err(io_error)?;
            if !is_openable(&path)
                || !is_openable(&target)
                || !std::fs::metadata(&target).map_err(io_error)?.is_file()
            {
                return Err(invalid("local_file_unsupported"));
            }
            tauri_plugin_opener::open_path(&target, None::<&str>).map_err(|e| {
                GalleyError::Internal {
                    message: format!("local_file_io: {e}"),
                }
            })?;
        }
    }
    Ok(result)
}

fn invalid(reason: &str) -> GalleyError {
    GalleyError::InvalidArgs {
        message: reason.into(),
    }
}

fn io_error(error: std::io::Error) -> GalleyError {
    match error.kind() {
        std::io::ErrorKind::NotFound => GalleyError::NotFound {
            message: "local_file_missing".into(),
        },
        std::io::ErrorKind::PermissionDenied => GalleyError::Internal {
            message: "local_file_permission".into(),
        },
        _ => GalleyError::Internal {
            message: format!("local_file_io: {error}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &Path, action: LocalFileAction) -> LocalFileRequest {
        LocalFileRequest {
            path: path.to_string_lossy().into_owned(),
            action,
        }
    }

    #[test]
    fn reads_unicode_and_bom_and_rejects_binary_or_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("报告 with spaces.MD");
        std::fs::write(&path, "\u{feff}# 报告").unwrap();
        let result = access_sync(request(&path, LocalFileAction::Read)).unwrap();
        assert_eq!(result.content.as_deref(), Some("# 报告"));
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(access_sync(request(&path, LocalFileAction::Read))
            .unwrap_err()
            .to_string()
            .contains("local_file_encoding"));
        std::fs::write(&path, vec![b'x'; MAX_TEXT_BYTES as usize + 1]).unwrap();
        assert!(access_sync(request(&path, LocalFileAction::Read))
            .unwrap_err()
            .to_string()
            .contains("local_file_too_large"));
    }

    #[test]
    fn classifies_text_by_extension_basename_and_sniff() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("analysis.PY");
        std::fs::write(&script, "print('hi')\n").unwrap();
        let result = access_sync(request(&script, LocalFileAction::Read)).unwrap();
        assert_eq!(result.kind, "text");
        assert_eq!(result.content.as_deref(), Some("print('hi')\n"));

        let makefile = dir.path().join("Makefile");
        std::fs::write(&makefile, "all:\n\techo hi\n").unwrap();
        assert_eq!(
            access_sync(request(&makefile, LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "text"
        );
        let dotfile = dir.path().join(".gitignore");
        std::fs::write(&dotfile, "target/\n").unwrap();
        assert_eq!(
            access_sync(request(&dotfile, LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "text"
        );

        // Unknown extension: content decides. UTF-8 without NUL is text …
        let notes = dir.path().join("notes.unknownext");
        std::fs::write(&notes, "中文 notes\n").unwrap();
        assert_eq!(
            access_sync(request(&notes, LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "file",
            "an unknown extension is not sniffed; only extension-less names are"
        );
        let bare = dir.path().join("NOTES");
        std::fs::write(&bare, "中文 notes\n").unwrap();
        assert_eq!(
            access_sync(request(&bare, LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "text"
        );
        // … and a binary header is not.
        let blob = dir.path().join("blob");
        std::fs::write(&blob, [0x89, b'P', b'N', b'G', 0, 1]).unwrap();
        assert_eq!(
            access_sync(request(&blob, LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "file"
        );
        assert!(access_sync(request(&blob, LocalFileAction::Read)).is_err());

        let image = dir.path().join("chart.png");
        std::fs::write(&image, [137, 80, 78, 71]).unwrap();
        assert_eq!(
            access_sync(request(&image, LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "image"
        );
        assert!(access_sync(request(&image, LocalFileAction::Read)).is_err());
    }

    #[test]
    fn open_with_default_app_excludes_scripts() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["run.sh", "tool.py", "job.bat", "task.ps1", "Makefile"] {
            let path = dir.path().join(name);
            std::fs::write(&path, "echo hi\n").unwrap();
            // Previewable as text …
            assert_eq!(
                access_sync(request(&path, LocalFileAction::Inspect))
                    .unwrap()
                    .kind,
                "text",
                "{name}"
            );
            // … but never handed to the default application.
            assert!(
                access_sync(request(&path, LocalFileAction::Open)).is_err(),
                "{name} must not open with the default app"
            );
        }
        // Documents pass the name gate; the opener itself is not exercised
        // here (it would launch an application on the test machine), so the
        // symlink guard is asserted through a document-named link to a script.
        assert!(is_openable(Path::new("/tmp/report.csv")));
        assert!(is_openable(Path::new("/tmp/chart.PNG")));
        assert!(!is_openable(Path::new("/tmp/run.sh")));
    }

    #[test]
    fn reads_raster_images_with_a_bound_and_rejects_active_formats() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chart.PNG");
        std::fs::write(&path, [137, 80, 78, 71]).unwrap();
        let result = access_sync(request(&path, LocalFileAction::ReadImage)).unwrap();
        assert_eq!(
            result.content.as_deref(),
            Some("data:image/png;base64,iVBORw==")
        );
        let svg = dir.path().join("chart.svg");
        std::fs::write(&svg, "<svg></svg>").unwrap();
        assert!(access_sync(request(&svg, LocalFileAction::ReadImage)).is_err());
        std::fs::File::create(&path)
            .unwrap()
            .set_len(10 * 1024 * 1024 + 1)
            .unwrap();
        assert!(access_sync(request(&path, LocalFileAction::ReadImage))
            .unwrap_err()
            .to_string()
            .contains("local_file_too_large"));
    }

    #[test]
    fn rejects_relative_missing_and_non_markdown_without_opening() {
        assert!(absolute_path("output/report.md").is_err());
        assert!(absolute_path("file:///tmp/report.md").is_err());
        assert!(absolute_path("~/report.md").unwrap().is_absolute());
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            access_sync(request(dir.path(), LocalFileAction::Inspect))
                .unwrap()
                .kind,
            "directory"
        );
        assert!(access_sync(request(dir.path(), LocalFileAction::Read)).is_err());
        let path = dir.path().join("missing.md");
        assert!(matches!(
            access_sync(request(&path, LocalFileAction::Read)),
            Err(GalleyError::NotFound { .. })
        ));
        let path = dir.path().join("script.sh");
        std::fs::write(&path, "echo hi").unwrap();
        assert!(access_sync(request(&path, LocalFileAction::Open)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn document_symlink_cannot_launch_non_document_target() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("script.sh");
        std::fs::write(&script, "echo hi").unwrap();
        for name in ["report.md", "data.csv", "chart.png"] {
            let link = dir.path().join(name);
            std::os::unix::fs::symlink(&script, &link).unwrap();
            assert!(
                access_sync(request(&link, LocalFileAction::Open)).is_err(),
                "{name} -> script.sh must not open"
            );
        }
    }
}
