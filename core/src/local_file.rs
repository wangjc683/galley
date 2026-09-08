//! Local file presentation. Never scans directories or mutates user files.
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{GalleyError, Result};

const MAX_MARKDOWN_BYTES: u64 = 2 * 1024 * 1024;

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

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
}

fn access_sync(request: LocalFileRequest) -> Result<LocalFileResult> {
    let path = absolute_path(&request.path)?;
    let metadata = std::fs::metadata(&path).map_err(io_error)?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        if is_markdown(&path) {
            "markdown"
        } else {
            "file"
        }
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
            let mime = match path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                _ => return Err(invalid("local_file_unsupported")),
            };
            if !metadata.is_file() {
                return Err(invalid("local_file_unsupported"));
            }
            let max = 10 * 1024 * 1024;
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
            if kind != "markdown" {
                return Err(invalid("local_file_unsupported"));
            }
            if metadata.len() > MAX_MARKDOWN_BYTES {
                return Err(invalid("local_file_too_large"));
            }
            let file = std::fs::File::open(&path).map_err(io_error)?;
            if !file.metadata().map_err(io_error)?.is_file() {
                return Err(invalid("local_file_unsupported"));
            }
            // Cap the read itself as well as metadata: a running agent may grow the file.
            let mut bytes = Vec::new();
            file.take(MAX_MARKDOWN_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            if bytes.len() as u64 > MAX_MARKDOWN_BYTES {
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
            // A .md symlink to an executable must never become an execution shortcut.
            let target = std::fs::canonicalize(&path).map_err(io_error)?;
            if kind != "markdown"
                || !is_markdown(&target)
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
        std::fs::write(&path, vec![b'x'; MAX_MARKDOWN_BYTES as usize + 1]).unwrap();
        assert!(access_sync(request(&path, LocalFileAction::Read))
            .unwrap_err()
            .to_string()
            .contains("local_file_too_large"));
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
    fn markdown_symlink_cannot_launch_non_markdown_target() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("script.sh");
        std::fs::write(&script, "echo hi").unwrap();
        let link = dir.path().join("report.md");
        std::os::unix::fs::symlink(script, &link).unwrap();
        assert!(access_sync(request(&link, LocalFileAction::Open)).is_err());
    }
}
