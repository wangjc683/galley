//! Bounded, read-only Git worktree review. No session attribution or snapshots.
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::{GalleyError, Result};

const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILES: usize = 5000;
const MAX_PATCH_LINES: usize = 5000;
// Git applies directory excludes before descent (engineering invariant I12).
const UNTRACKED_ARGS: &[&str] = &[
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--exclude=.*/",
    "--exclude=Library/",
    "--exclude=AppData/",
    "--exclude=$RECYCLE.BIN/",
    "--exclude=System Volume Information/",
];

/// Most recent commits returned by `log` — enough to pick a baseline
/// from the agent's last few commits, not a history browser.
const MAX_LOG_COMMITS: usize = 30;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum GitReviewRequest {
    List {
        path: String,
        /// Optional comparison baseline (a commit id from `log`). Absent
        /// means the current HEAD, the original semantics.
        #[serde(default)]
        base: Option<String>,
    },
    Diff {
        path: String,
        #[serde(rename = "filePath")]
        file_path: String,
        head: Option<String>,
        #[serde(default)]
        base: Option<String>,
    },
    /// Recent commits on the current branch, newest first, for choosing a
    /// baseline. Additive (2026-09-09).
    Log { path: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitReviewFile {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub id: String,
    pub subject: String,
    pub author: String,
    /// Author date, ISO 8601 as Git prints it (`%aI`).
    pub authored_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitReviewResult {
    pub root: String,
    pub head: Option<String>,
    pub files: Vec<GitReviewFile>,
    pub patch: Option<String>,
    pub content: Option<String>,
    pub notice: Option<String>,
    /// The resolved full id of an explicitly requested baseline; absent
    /// when the comparison used HEAD.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// `log` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commits: Option<Vec<GitCommit>>,
}

fn invalid(message: &str) -> GalleyError {
    GalleyError::InvalidArgs {
        message: message.into(),
    }
}

fn failed(error: impl std::fmt::Display) -> GalleyError {
    GalleyError::Internal {
        message: format!("git_review_failed: {error}"),
    }
}

/// Drain both pipes concurrently; kill the child on timeout, overflow, or cancellation.
async fn git(root: &Path, args: &[&str]) -> Result<(i32, Vec<u8>)> {
    let mut command = Command::new("git");
    crate::process_command::configure_background(&mut command);
    // GUI launch environments may contain a supervisor's Git overrides.
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command
        .args([
            "--no-pager",
            "--no-optional-locks",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-c",
            "diff.relative=false",
            "-c",
            "core.quotePath=true",
            "-C",
        ])
        .arg(root)
        .args(args)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        // A partial clone may otherwise fetch missing blobs during a read.
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_ALLOW_PROTOCOL", "")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            invalid("git_review_unavailable")
        } else {
            failed(e)
        }
    })?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let read = async {
        let output = async {
            let mut bytes = Vec::new();
            stdout
                .take(MAX_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(failed)?;
            if bytes.len() > MAX_BYTES {
                return Err(invalid("git_review_too_large"));
            }
            Ok::<_, GalleyError>(bytes)
        };
        let errors = async {
            let mut bytes = Vec::new();
            stderr
                .take(MAX_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(failed)?;
            if bytes.len() > MAX_BYTES {
                return Err(invalid("git_review_too_large"));
            }
            Ok::<_, GalleyError>(())
        };
        let (bytes, _) = tokio::try_join!(output, errors)?;
        let status = child.wait().await.map_err(failed)?;
        Ok((status.code().unwrap_or(-1), bytes))
    };
    tokio::time::timeout(Duration::from_secs(10), read)
        .await
        .map_err(|_| invalid("git_review_timeout"))?
}

fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| invalid("git_review_encoding"))
}

async fn safe_diff(root: &Path, args: &[&str]) -> Result<(i32, Vec<u8>)> {
    // --no-textconv/--no-ext-diff do not disable clean/process filters.
    // Override configured drivers so merely reviewing cannot run user helpers.
    let (status, bytes) = git(
        root,
        &[
            "config",
            "--null",
            "--name-only",
            "--get-regexp",
            r"^filter\..*\.(clean|smudge|process|required)$",
        ],
    )
    .await?;
    if status != 0 && status != 1 {
        return Err(failed("Cannot read filter configuration"));
    }
    let names = text(bytes)?;
    let overrides: Vec<String> = names
        .split_terminator('\0')
        .flat_map(|name| {
            vec![
                "-c".into(),
                format!(
                    "{name}={}",
                    if name.ends_with(".required") {
                        "false"
                    } else {
                        ""
                    }
                ),
            ]
        })
        .collect();
    let mut arguments: Vec<&str> = overrides.iter().map(String::as_str).collect();
    arguments.extend_from_slice(args);
    git(root, &arguments).await
}

async fn checked(root: &Path, args: &[&str]) -> Result<String> {
    let (status, bytes) = if args.first() == Some(&"diff") {
        safe_diff(root, args).await?
    } else {
        git(root, args).await?
    };
    if status != 0 {
        return Err(failed("Git command did not complete"));
    }
    text(bytes)
}

async fn discover(value: &str) -> Result<PathBuf> {
    let path = if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        directories::BaseDirs::new()
            .ok_or_else(|| invalid("git_review_invalid_path"))?
            .home_dir()
            .join(rest)
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() || value.contains('\0') {
        return Err(invalid("git_review_invalid_path"));
    }
    // Also permits a recently deleted file. Ascend only; never scan directories.
    let mut directory = path.as_path();
    while !directory.is_dir() {
        directory = directory
            .parent()
            .ok_or_else(|| invalid("git_review_not_repository"))?;
    }
    let (ok, bytes) = git(directory, &["rev-parse", "--show-toplevel"]).await?;
    if ok != 0 {
        return Err(invalid("git_review_not_repository"));
    }
    let root = text(bytes)?;
    Ok(PathBuf::from(
        root.strip_suffix('\n')
            .unwrap_or(&root)
            .trim_end_matches('\r'),
    ))
}

async fn head(root: &Path) -> Result<Option<String>> {
    let (ok, bytes) = git(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).await?;
    if ok == 0 {
        return Ok(Some(text(bytes)?.trim().to_owned()));
    }
    // An unborn branch is supported; a broken/detached HEAD is an error.
    let (symbolic, _) = git(root, &["symbolic-ref", "--quiet", "HEAD"]).await?;
    if symbolic == 0 {
        Ok(None)
    } else {
        Err(failed("HEAD is unreadable"))
    }
}

/// Resolve a caller-supplied baseline to a full commit id. Only hex ids
/// are accepted (never refspecs or revision expressions), so a chat-borne
/// value cannot smuggle `--flags` or `:(...)` magic into Git.
async fn resolve_base(root: &Path, value: &str) -> Result<String> {
    let hex = value.len() >= 7 && value.len() <= 40 && value.bytes().all(|b| b.is_ascii_hexdigit());
    if !hex {
        return Err(invalid("git_review_invalid_base"));
    }
    let spec = format!("{value}^{{commit}}");
    let (ok, bytes) = git(root, &["rev-parse", "--verify", "--quiet", &spec]).await?;
    if ok != 0 {
        return Err(invalid("git_review_invalid_base"));
    }
    Ok(text(bytes)?.trim().to_owned())
}

async fn log(root: &Path) -> Result<Vec<GitCommit>> {
    let count = MAX_LOG_COMMITS.to_string();
    let (ok, bytes) = git(
        root,
        &[
            "log",
            "-z",
            "--no-decorate",
            "--format=%H%x1f%s%x1f%an%x1f%aI",
            "-n",
            &count,
        ],
    )
    .await?;
    if ok != 0 {
        return Err(failed("Git log did not complete"));
    }
    let output = text(bytes)?;
    Ok(output
        .split_terminator('\0')
        .filter_map(|record| {
            let mut fields = record.split('\x1f');
            Some(GitCommit {
                id: fields.next()?.to_owned(),
                subject: fields.next()?.to_owned(),
                author: fields.next()?.to_owned(),
                authored_at: fields.next()?.to_owned(),
            })
        })
        .collect())
}

fn file_path(value: &str) -> Result<()> {
    if value.is_empty()
        || value.contains('\0')
        || Path::new(value)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(invalid("git_review_invalid_path"));
    }
    if value
        .split(['/', '\\'])
        .any(|s| s.eq_ignore_ascii_case(".git"))
    {
        return Err(invalid("git_review_invalid_path"));
    }
    Ok(())
}

async fn files(root: &Path, base: Option<&str>) -> Result<Vec<GitReviewFile>> {
    let mut files = Vec::new();
    if let Some(base) = base {
        let output = checked(
            root,
            &[
                "diff",
                "--name-status",
                "-z",
                "--no-renames",
                "--no-ext-diff",
                "--no-textconv",
                "--ignore-submodules=none",
                base,
                "--",
            ],
        )
        .await?;
        let fields: Vec<_> = output.split_terminator('\0').collect();
        if fields.len() % 2 != 0 {
            return Err(failed("Invalid Git file list"));
        }
        for pair in fields.chunks_exact(2) {
            let status = match pair[0] {
                "A" => "added",
                "D" => "deleted",
                "T" => "type_changed",
                "U" => "conflicted",
                _ => "modified",
            };
            files.push(GitReviewFile {
                path: pair[1].into(),
                status: status.into(),
            });
        }
    } else {
        let output = checked(root, &["ls-files", "--cached", "-z"]).await?;
        files.extend(
            output
                .split_terminator('\0')
                .filter(|path| std::fs::symlink_metadata(root.join(path)).is_ok())
                .map(|path| GitReviewFile {
                    path: path.into(),
                    status: "added".into(),
                }),
        );
    }
    let conflicts = checked(root, &["ls-files", "--unmerged", "-z"]).await?;
    for record in conflicts.split_terminator('\0') {
        if let Some((_, path)) = record.split_once('\t') {
            if let Some(file) = files.iter_mut().find(|f| f.path == path) {
                file.status = "conflicted".into();
            } else {
                files.push(GitReviewFile {
                    path: path.into(),
                    status: "conflicted".into(),
                });
            }
        }
    }
    let untracked = checked(root, UNTRACKED_ARGS).await?;
    files.extend(untracked.split_terminator('\0').map(|path| GitReviewFile {
        path: path.into(),
        status: "untracked".into(),
    }));
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files.dedup_by(|a, b| a.path == b.path);
    if files.len() > MAX_FILES {
        return Err(invalid("git_review_too_large"));
    }
    Ok(files)
}

async fn read_untracked(root: &Path, relative: &str) -> Result<(Option<String>, Option<String>)> {
    let root = root.to_owned();
    let relative = relative.to_owned();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let mut path = root;
        // Never dereference untracked symlinks (including parent directories).
        for component in Path::new(&relative).components() {
            path.push(component);
            let metadata = std::fs::symlink_metadata(&path).map_err(failed)?;
            if metadata.file_type().is_symlink() {
                return Ok((None, Some("unsupported".into())));
            }
        }
        let metadata = std::fs::metadata(&path).map_err(failed)?;
        if !metadata.is_file() {
            return Ok((None, Some("unsupported".into())));
        }
        if metadata.len() > MAX_BYTES as u64 {
            return Ok((None, Some("too_large".into())));
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&path)
            .map_err(failed)?
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(failed)?;
        if bytes.len() > MAX_BYTES {
            return Ok((None, Some("too_large".into())));
        }
        if bytes.contains(&0) {
            return Ok((None, Some("binary".into())));
        }
        match String::from_utf8(bytes) {
            Ok(content) => Ok((Some(content), None)),
            Err(_) => Ok((None, Some("encoding".into()))),
        }
    })
    .await
    .map_err(failed)?
}

pub async fn review(request: GitReviewRequest) -> Result<GitReviewResult> {
    let (path, requested_base) = match &request {
        GitReviewRequest::List { path, base } | GitReviewRequest::Diff { path, base, .. } => {
            (path, base.as_deref())
        }
        GitReviewRequest::Log { path } => (path, None),
    };
    let root = discover(path).await?;
    let current_head = head(&root).await?;
    // The comparison baseline: an explicit commit when the caller chose
    // one, otherwise HEAD (which may be absent on an unborn branch).
    let explicit_base = match requested_base {
        Some(value) => Some(resolve_base(&root, value).await?),
        None => None,
    };
    let comparison = explicit_base.clone().or_else(|| current_head.clone());
    let mut result = GitReviewResult {
        root: root.to_string_lossy().into_owned(),
        head: current_head.clone(),
        files: vec![],
        patch: None,
        content: None,
        notice: None,
        base: explicit_base,
        commits: None,
    };
    match request {
        GitReviewRequest::Log { .. } => {
            result.commits = Some(if current_head.is_some() {
                log(&root).await?
            } else {
                Vec::new()
            });
        }
        GitReviewRequest::List { .. } => {
            result.files = files(&root, comparison.as_deref()).await?;
        }
        GitReviewRequest::Diff {
            file_path: relative,
            head: expected,
            ..
        } => {
            file_path(&relative)?;
            if expected != current_head {
                return Err(invalid("git_review_changed"));
            }
            let index = checked(&root, &["ls-files", "--stage", "-z", "--", &relative]).await?;
            let tree = if let Some(base) = &comparison {
                checked(&root, &["ls-tree", "-z", base, "--", &relative]).await?
            } else {
                String::new()
            };
            if !index.is_empty() || !tree.is_empty() {
                let exact = index
                    .split_terminator('\0')
                    .chain(tree.split_terminator('\0'))
                    .any(|record| {
                        record
                            .split_once('\t')
                            .is_some_and(|(_, path)| path == relative)
                    });
                if !exact || tree.starts_with("040000 ") {
                    return Err(invalid("git_review_invalid_path"));
                }
            }
            if index.is_empty() && tree.is_empty() {
                let mut args = UNTRACKED_ARGS.to_vec();
                args.extend(["--", &relative]);
                let untracked = checked(&root, &args).await?;
                if !untracked.split_terminator('\0').any(|p| p == relative) {
                    return Err(invalid("git_review_changed"));
                }
                (result.content, result.notice) = read_untracked(&root, &relative).await?;
            } else if index.starts_with("160000 ") || tree.starts_with("160000 ") {
                result.notice = Some("submodule".into());
            } else if index.split_terminator('\0').any(|line| {
                line.split_once('\t')
                    .is_some_and(|(meta, _)| !meta.ends_with(" 0"))
            }) {
                result.notice = Some("conflicted".into());
            } else {
                let patch = if let Some(base) = &comparison {
                    checked(
                        &root,
                        &[
                            "diff",
                            "--patch",
                            "--no-color",
                            "--no-ext-diff",
                            "--no-textconv",
                            "--no-renames",
                            "--src-prefix=a/",
                            "--dst-prefix=b/",
                            "--unified=3",
                            "--ignore-submodules=none",
                            base,
                            "--",
                            &relative,
                        ],
                    )
                    .await
                } else {
                    // With no commit, every tracked regular file is an addition.
                    let (content, notice) = read_untracked(&root, &relative).await?;
                    result.notice = notice;
                    if content.is_none() {
                        return Ok(result);
                    }
                    let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
                    // --no-index returns 1 when files differ; that is success here.
                    safe_diff(
                        &root,
                        &[
                            "diff",
                            "--no-index",
                            "--no-color",
                            "--no-ext-diff",
                            "--no-textconv",
                            "--src-prefix=a/",
                            "--dst-prefix=b/",
                            "--",
                            null,
                            &relative,
                        ],
                    )
                    .await
                    .and_then(|(status, bytes)| {
                        if status == 0 || status == 1 {
                            text(bytes)
                        } else {
                            Err(failed("Git diff did not complete"))
                        }
                    })
                };
                match patch {
                    Ok(patch) if patch.is_empty() => result.notice = Some("unchanged".into()),
                    Ok(patch) if patch.contains("\nBinary files ") || patch.contains('\0') => {
                        result.notice = Some("binary".into())
                    }
                    Ok(patch)
                        if patch.lines().take(MAX_PATCH_LINES + 1).count() > MAX_PATCH_LINES =>
                    {
                        result.notice = Some("too_large".into())
                    }
                    Ok(patch) => result.patch = Some(patch),
                    Err(GalleyError::InvalidArgs { message })
                        if message == "git_review_too_large" =>
                    {
                        result.notice = Some("too_large".into())
                    }
                    Err(GalleyError::InvalidArgs { message })
                        if message == "git_review_encoding" =>
                    {
                        result.notice = Some("encoding".into())
                    }
                    Err(error) => return Err(error),
                }
            }
        }
    }
    if head(&root).await? != current_head {
        return Err(invalid("git_review_changed"));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Repo(tempfile::TempDir);
    impl Repo {
        fn new() -> Self {
            let repo = Self(tempfile::tempdir().unwrap());
            repo.run(&["init", "-b", "main"]);
            repo.run(&["config", "user.name", "Galley Test"]);
            repo.run(&["config", "user.email", "test@example.invalid"]);
            repo.run(&["config", "commit.gpgsign", "false"]);
            repo
        }
        fn path(&self) -> &Path {
            self.0.path()
        }
        fn run(&self, args: &[&str]) {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(self.path())
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        fn write(&self, path: &str, content: impl AsRef<[u8]>) {
            fs::write(self.path().join(path), content).unwrap();
        }
        fn commit(&self) {
            self.run(&["add", "."]);
            self.run(&["commit", "-m", "fixture"]);
        }
        async fn list(&self) -> GitReviewResult {
            review(GitReviewRequest::List {
                path: self.path().to_string_lossy().into(),
                base: None,
            })
            .await
            .unwrap()
        }
        async fn diff(&self, list: &GitReviewResult, file: &str) -> GitReviewResult {
            review(GitReviewRequest::Diff {
                path: list.root.clone(),
                head: list.head.clone(),
                file_path: file.into(),
                base: list.base.clone(),
            })
            .await
            .unwrap()
        }
    }

    #[tokio::test]
    async fn baseline_selection_reviews_against_an_older_commit() {
        let repo = Repo::new();
        repo.write("report.md", "v1\n");
        repo.commit();
        repo.write("report.md", "v2\n");
        repo.write("second.txt", "added in v2\n");
        repo.commit();
        repo.write("report.md", "v3 uncommitted\n");

        let commits = review(GitReviewRequest::Log {
            path: repo.path().to_string_lossy().into(),
        })
        .await
        .unwrap()
        .commits
        .unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "fixture");
        assert_eq!(commits[0].author, "Galley Test");
        assert!(commits[0].authored_at.contains('T'));
        let first = &commits[1].id;

        // Default: working tree vs HEAD — only the uncommitted edit.
        let against_head = repo.list().await;
        assert_eq!(against_head.base, None);
        assert_eq!(against_head.files.len(), 1);

        // Against the first commit: v2's addition shows up too, and the
        // patch spans both commits plus the working tree.
        let against_first = review(GitReviewRequest::List {
            path: repo.path().to_string_lossy().into(),
            base: Some(first[..10].into()),
        })
        .await
        .unwrap();
        assert_eq!(against_first.base.as_deref(), Some(first.as_str()));
        assert_eq!(
            against_first
                .files
                .iter()
                .map(|f| (f.path.as_str(), f.status.as_str()))
                .collect::<Vec<_>>(),
            vec![("report.md", "modified"), ("second.txt", "added")]
        );
        let patch = repo.diff(&against_first, "report.md").await.patch.unwrap();
        assert!(patch.contains("-v1\n+v3 uncommitted\n"));
        assert!(repo
            .diff(&against_first, "second.txt")
            .await
            .patch
            .unwrap()
            .contains("+added in v2"));

        // Only hex ids resolve; refspecs and expressions are rejected before Git sees them.
        for base in ["HEAD~1", "main", "--output=/tmp/x", "0000000", "abc"] {
            let result = review(GitReviewRequest::List {
                path: repo.path().to_string_lossy().into(),
                base: Some(base.into()),
            })
            .await;
            assert!(
                matches!(result, Err(GalleyError::InvalidArgs { ref message }) if message == "git_review_invalid_base"),
                "{base}: {result:?}"
            );
        }
    }

    #[tokio::test]
    async fn log_is_empty_on_an_unborn_branch() {
        let repo = Repo::new();
        let result = review(GitReviewRequest::Log {
            path: repo.path().to_string_lossy().into(),
        })
        .await
        .unwrap();
        assert!(result.head.is_none());
        assert_eq!(result.commits.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn combines_staged_and_unstaged_without_mutating_index() {
        let repo = Repo::new();
        repo.write("report.md", "original\n");
        repo.write("reverted.txt", "keep\n");
        repo.write("deleted.txt", "delete me\n");
        repo.write(".gitignore", "ignored*\n");
        repo.commit();
        repo.write("report.md", "intermediate\n");
        repo.write("reverted.txt", "temporary\n");
        repo.run(&["add", "."]);
        repo.write("report.md", "final\n");
        repo.write("reverted.txt", "keep\n");
        fs::remove_file(repo.path().join("deleted.txt")).unwrap();
        repo.write("new.txt", "untracked\n");
        repo.write("ignored.txt", "hidden\n");
        let index = fs::read(repo.path().join(".git/index")).unwrap();
        let list = repo.list().await;
        assert_eq!(
            list.files
                .iter()
                .map(|f| (f.path.as_str(), f.status.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("deleted.txt", "deleted"),
                ("new.txt", "untracked"),
                ("report.md", "modified")
            ]
        );
        let patch = repo.diff(&list, "report.md").await.patch.unwrap();
        assert!(patch.contains("-original\n+final\n"));
        assert!(!patch.contains("intermediate"));
        assert_eq!(
            repo.diff(&list, "new.txt").await.content.as_deref(),
            Some("untracked\n")
        );
        assert!(repo
            .diff(&list, "deleted.txt")
            .await
            .patch
            .unwrap()
            .contains("-delete me"));
        assert_eq!(index, fs::read(repo.path().join(".git/index")).unwrap());
    }

    #[tokio::test]
    async fn supports_unborn_repositories_and_binary_limits() {
        let repo = Repo::new();
        repo.write("added.txt", "hello\n");
        repo.write("removed.txt", "gone\n");
        repo.run(&["add", "removed.txt"]);
        fs::remove_file(repo.path().join("removed.txt")).unwrap();
        repo.run(&["add", "added.txt"]);
        repo.write("image.bin", [0, 1, 2]);
        repo.write("large.txt", vec![b'x'; MAX_BYTES + 1]);
        for name in [".hidden", "Library", "AppData"] {
            fs::create_dir(repo.path().join(name)).unwrap();
            repo.write(&format!("{name}/private.txt"), "not listed");
        }
        let list = repo.list().await;
        assert!(list.head.is_none());
        assert!(!list.files.iter().any(|file| file.path == "removed.txt"));
        assert!(!list
            .files
            .iter()
            .any(|file| file.path.ends_with("private.txt")));
        assert!(repo
            .diff(&list, "added.txt")
            .await
            .patch
            .unwrap()
            .contains("+hello"));
        assert_eq!(
            repo.diff(&list, "image.bin").await.notice.as_deref(),
            Some("binary")
        );
        assert_eq!(
            repo.diff(&list, "large.txt").await.notice.as_deref(),
            Some("too_large")
        );
    }

    #[tokio::test]
    async fn literal_paths_and_head_change_are_not_silently_misrepresented() {
        let repo = Repo::new();
        let name = "report [1] 中文.txt";
        repo.write(name, "before\n");
        repo.write("other.txt", "before\n");
        repo.commit();
        repo.write(name, "after\n");
        let list = repo.list().await;
        assert_eq!(list.files[0].path, name);
        assert!(repo
            .diff(&list, name)
            .await
            .patch
            .unwrap()
            .contains("+after"));
        for path in ["../outside", "/tmp/outside", ".git/config", ":(glob)*"] {
            let result = review(GitReviewRequest::Diff {
                path: list.root.clone(),
                head: list.head.clone(),
                file_path: path.into(),
                base: None,
            })
            .await;
            assert!(result.is_err(), "must reject or not find {path}");
        }
        repo.commit();
        let stale = review(GitReviewRequest::Diff {
            path: list.root,
            head: list.head,
            file_path: name.into(),
            base: None,
        })
        .await;
        assert!(
            matches!(stale, Err(GalleyError::InvalidArgs { message }) if message == "git_review_changed")
        );
    }

    #[tokio::test]
    async fn repository_discovery_supports_nested_paths_and_worktrees() {
        let repo = Repo::new();
        repo.write("tracked.md", "hello");
        repo.commit();
        let sibling = tempfile::tempdir().unwrap();
        repo.run(&[
            "worktree",
            "add",
            "--detach",
            sibling.path().to_str().unwrap(),
        ]);
        fs::create_dir(sibling.path().join("nested")).unwrap();
        let result = review(GitReviewRequest::List {
            path: sibling
                .path()
                .join("nested/missing.md")
                .to_string_lossy()
                .into(),
            base: None,
        })
        .await
        .unwrap();
        assert_eq!(
            fs::canonicalize(result.root).unwrap(),
            fs::canonicalize(sibling.path()).unwrap()
        );
        let outside = tempfile::tempdir().unwrap();
        assert!(review(GitReviewRequest::List {
            path: outside.path().to_string_lossy().into(),
            base: None,
        })
        .await
        .is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn untracked_symlinks_are_not_followed_and_filters_do_not_execute() {
        let repo = Repo::new();
        repo.write("tracked.txt", "before\n");
        repo.commit();
        repo.write("tracked.txt", "after\n");
        repo.write(".gitattributes", "*.txt filter=probe\n");
        repo.run(&["config", "filter.probe.clean", "touch helper-ran; cat"]);
        repo.run(&["config", "filter.probe.required", "true"]);
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), repo.path().join("link")).unwrap();
        let list = repo.list().await;
        assert!(repo
            .diff(&list, "tracked.txt")
            .await
            .patch
            .unwrap()
            .contains("+after"));
        assert_eq!(
            repo.diff(&list, "link").await.notice.as_deref(),
            Some("unsupported")
        );
        assert!(!repo.path().join("helper-ran").exists());
    }

    #[tokio::test]
    async fn detects_conflicts_and_submodules() {
        let repo = Repo::new();
        repo.write("file.txt", "base\n");
        repo.commit();
        let base = repo.list().await.head.unwrap();
        repo.run(&["checkout", "-b", "other"]);
        repo.write("file.txt", "other\n");
        repo.commit();
        repo.run(&["checkout", "main"]);
        repo.write("file.txt", "main\n");
        repo.commit();
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["merge", "other"])
            .output()
            .unwrap();
        assert!(!output.status.success());
        let list = repo.list().await;
        assert_eq!(
            list.files
                .iter()
                .find(|file| file.path == "file.txt")
                .unwrap()
                .status,
            "conflicted"
        );
        assert_eq!(
            repo.diff(&list, "file.txt").await.notice.as_deref(),
            Some("conflicted")
        );
        repo.run(&["merge", "--abort"]);
        repo.run(&[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{base},module"),
        ]);
        let list = repo.list().await;
        assert_eq!(
            repo.diff(&list, "module").await.notice.as_deref(),
            Some("submodule")
        );
    }
}
