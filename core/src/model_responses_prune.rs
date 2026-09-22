//! Retention for the bundled engine's `model_responses_*.txt` LLM logs.
//!
//! GenericAgent appends the full prompt and the raw response of every
//! LLM call to `managed-ga-state/temp/model_responses/model_responses_<pid>.txt`
//! (upstream `llmcore._write_llm_log`). Because each prompt carries the
//! whole conversation history, a long session's log grows quadratically,
//! and upstream never deletes anything. The logs serve `/restore` and
//! debugging, both of which only look at recent files, so Galley prunes
//! them at startup:
//!
//! 1. delete every log whose mtime is older than [`MAX_AGE`];
//! 2. if what remains still exceeds [`MAX_TOTAL_BYTES`], delete oldest
//!    first until it fits.
//!
//! Only `model_responses_*.txt` files are touched. The directory also
//! holds upstream's `session_names.json` sidecar and whatever the model
//! wrote there with the dir as cwd; those are left alone. This is
//! managed-runtime state only: attach mode never sees a user-owned GA
//! checkout's `temp/` (Rule 1).
//!
//! Call it before any bridge process is spawned (see `app_setup`): the
//! ordering is mtime-based, so a live log would be the last candidate,
//! but "no writer exists yet" is the simpler guarantee.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Logs older than this are removed regardless of total size.
pub const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Total size the surviving logs may occupy; oldest go first above it.
pub const MAX_TOTAL_BYTES: u64 = 500 * 1024 * 1024;

const LOG_PREFIX: &str = "model_responses_";
const LOG_SUFFIX: &str = ".txt";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PruneOutcome {
    /// `model_responses_*.txt` files found before pruning.
    pub scanned: usize,
    pub removed_by_age: usize,
    pub removed_by_size: usize,
    pub bytes_freed: u64,
    /// Bytes of logs still on disk after pruning.
    pub remaining_bytes: u64,
    /// Removals that failed (logged, never fatal).
    pub failed: usize,
}

struct LogFile {
    path: PathBuf,
    len: u64,
    modified: SystemTime,
}

/// Prune with the production thresholds and the current time. A missing
/// directory is not an error: nothing to prune.
pub fn prune_model_responses(dir: &Path) -> io::Result<PruneOutcome> {
    prune_model_responses_at(dir, SystemTime::now(), MAX_AGE, MAX_TOTAL_BYTES)
}

pub(crate) fn prune_model_responses_at(
    dir: &Path,
    now: SystemTime,
    max_age: Duration,
    max_total_bytes: u64,
) -> io::Result<PruneOutcome> {
    let mut logs = match collect_logs(dir) {
        Ok(logs) => logs,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(PruneOutcome::default()),
        Err(err) => return Err(err),
    };
    // Oldest first: both passes consume from the front.
    logs.sort_by_key(|log| log.modified);

    let mut outcome = PruneOutcome {
        scanned: logs.len(),
        ..PruneOutcome::default()
    };
    let mut kept: Vec<LogFile> = Vec::with_capacity(logs.len());
    for log in logs {
        let age = now.duration_since(log.modified).unwrap_or(Duration::ZERO);
        if age > max_age {
            remove(&log, Reason::Age, &mut outcome);
            continue;
        }
        kept.push(log);
    }

    let mut total: u64 = kept.iter().map(|log| log.len).sum();
    let mut kept = kept.into_iter();
    while total > max_total_bytes {
        let Some(log) = kept.next() else { break };
        total -= log.len;
        remove(&log, Reason::Size, &mut outcome);
    }
    outcome.remaining_bytes = total;
    Ok(outcome)
}

fn collect_logs(dir: &Path) -> io::Result<Vec<LogFile>> {
    let mut logs = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !(name.starts_with(LOG_PREFIX) && name.ends_with(LOG_SUFFIX)) {
            continue;
        }
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        logs.push(LogFile {
            path: entry.path(),
            len: metadata.len(),
            modified: metadata.modified()?,
        });
    }
    Ok(logs)
}

#[derive(Clone, Copy)]
enum Reason {
    Age,
    Size,
}

fn remove(log: &LogFile, reason: Reason, outcome: &mut PruneOutcome) {
    match fs::remove_file(&log.path) {
        Ok(()) => {
            match reason {
                Reason::Age => outcome.removed_by_age += 1,
                Reason::Size => outcome.removed_by_size += 1,
            }
            outcome.bytes_freed += log.len;
        }
        Err(err) => {
            // A failed removal still counts against the budget the way
            // it was planned; the file just stays. Never fatal.
            outcome.failed += 1;
            let reason = match reason {
                Reason::Age => "age",
                Reason::Size => "size",
            };
            eprintln!(
                "[model-responses] removing {} ({reason}) failed: {err}",
                log.path.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    fn write_log(dir: &Path, name: &str, len: usize, age: Duration, now: SystemTime) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, vec![b'x'; len]).unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(now - age).unwrap();
        path
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn missing_dir_is_a_noop() {
        let tmp = tempfile::tempdir().unwrap();
        let out = prune_model_responses(&tmp.path().join("nope")).unwrap();
        assert_eq!(out, PruneOutcome::default());
    }

    #[test]
    fn removes_logs_older_than_max_age_only() {
        let tmp = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        write_log(tmp.path(), "model_responses_old.txt", 10, 31 * DAY, now);
        write_log(tmp.path(), "model_responses_fresh.txt", 10, 29 * DAY, now);

        let out = prune_model_responses_at(tmp.path(), now, 30 * DAY, u64::MAX).unwrap();
        assert_eq!(out.scanned, 2);
        assert_eq!(out.removed_by_age, 1);
        assert_eq!(out.removed_by_size, 0);
        assert_eq!(out.bytes_freed, 10);
        assert_eq!(out.remaining_bytes, 10);
        assert_eq!(names(tmp.path()), vec!["model_responses_fresh.txt"]);
    }

    #[test]
    fn trims_oldest_first_until_under_size_budget() {
        let tmp = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        write_log(tmp.path(), "model_responses_a.txt", 40, 3 * DAY, now);
        write_log(tmp.path(), "model_responses_b.txt", 40, 2 * DAY, now);
        write_log(tmp.path(), "model_responses_c.txt", 40, 1 * DAY, now);

        let out = prune_model_responses_at(tmp.path(), now, 30 * DAY, 100).unwrap();
        assert_eq!(out.removed_by_age, 0);
        assert_eq!(out.removed_by_size, 1);
        assert_eq!(out.bytes_freed, 40);
        assert_eq!(out.remaining_bytes, 80);
        assert_eq!(
            names(tmp.path()),
            vec!["model_responses_b.txt", "model_responses_c.txt"]
        );
    }

    #[test]
    fn age_pass_runs_before_size_pass() {
        let tmp = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        // The stale file alone would satisfy the size budget once gone;
        // the size pass must not touch the fresh ones after that.
        write_log(tmp.path(), "model_responses_stale.txt", 90, 40 * DAY, now);
        write_log(tmp.path(), "model_responses_b.txt", 30, 2 * DAY, now);
        write_log(tmp.path(), "model_responses_c.txt", 30, 1 * DAY, now);

        let out = prune_model_responses_at(tmp.path(), now, 30 * DAY, 100).unwrap();
        assert_eq!(out.removed_by_age, 1);
        assert_eq!(out.removed_by_size, 0);
        assert_eq!(out.remaining_bytes, 60);
    }

    #[test]
    fn leaves_non_log_files_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        write_log(tmp.path(), "model_responses_old.txt", 10, 40 * DAY, now);
        write_log(tmp.path(), "session_names.json", 10, 40 * DAY, now);
        write_log(tmp.path(), "article_1.txt", 10, 40 * DAY, now);
        fs::create_dir(tmp.path().join("model_responses_dir.txt")).unwrap();

        let out = prune_model_responses_at(tmp.path(), now, 30 * DAY, 0).unwrap();
        assert_eq!(out.scanned, 1);
        assert_eq!(out.removed_by_age, 1);
        assert_eq!(
            names(tmp.path()),
            vec![
                "article_1.txt",
                "model_responses_dir.txt",
                "session_names.json"
            ]
        );
    }
}
