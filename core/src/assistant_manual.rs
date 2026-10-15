//! The assistant manual (main chat ticket 30; assistant PRD rulings 3
//! and 8).
//!
//! The main chat's entry layer ([`crate::managed_prompt`]) sends the
//! model here before its first Galley CLI write: who it is, the three
//! levels of authority, the CLI commands it uses (and the ones that would
//! hold the main chat), what a wake note from Galley is, and how to check
//! a subtask's result and report it. It is the built-in assistant's
//! counterpart of the Supervisor SOP an outside agent copies
//! ([`crate::sop_install`]), which stays as it is.
//!
//! Embedded in Core and written into the managed state directory every
//! time a main chat runner is spawned
//! (`runner_commands::prepare_managed_spawn_args`), as IM writes the SOP
//! (`im_supervisor::materialize_sop_reference`): it versions with the
//! app, and an update never leaves an old copy behind. Galley-owned and
//! rewritten whole, never user state. Managed runtime only: attach mode
//! has no main chat.

use std::path::{Path, PathBuf};

/// The manual, bundled at build time from the file a developer reads in
/// the repo.
const MANUAL_BODY: &str = include_str!("../../docs/managed-ga-runtime/galley-assistant-manual.md");

/// The embedded manual.
pub fn manual_body() -> &'static str {
    MANUAL_BODY
}

/// Where the manual lives under the managed state root; the entry layer
/// names this path.
pub fn manual_path(state_root: &Path) -> PathBuf {
    state_root
        .join("assistant")
        .join("reference")
        .join("galley-assistant-manual.md")
}

/// Write the manual to [`manual_path`], replacing whatever is there.
pub fn materialize(state_root: &Path) -> std::io::Result<PathBuf> {
    let path = manual_path(state_root);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, manual_body())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materialize_writes_galley_owned_copy() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = materialize(tmp.path()).expect("write manual");
        assert_eq!(path, manual_path(tmp.path()));
        assert!(path.ends_with("assistant/reference/galley-assistant-manual.md"));
        assert_eq!(
            std::fs::read_to_string(&path).expect("read manual"),
            manual_body()
        );

        // Every sibling `./*.md` link resolves inside the copy (none yet:
        // the manual stands alone).
        let dir = path.parent().expect("reference dir");
        for target in manual_body().split("](./").skip(1) {
            let file = target.split(')').next().expect("link target");
            assert!(dir.join(file).exists(), "manual links to missing {file}");
        }

        // A second spawn rewrites it, whatever was there.
        std::fs::write(&path, "stale").expect("overwrite");
        materialize(tmp.path()).expect("rewrite manual");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read manual"),
            manual_body()
        );
    }

    /// The hard rules the ticket names. Single-line fragments only (a
    /// Windows checkout makes the bundled file CRLF).
    #[test]
    fn manual_keeps_its_hard_rules() {
        let body = manual_body();
        // Identity on every write; `llm set` is the one write without it.
        assert!(body.contains("--supervisor=galley-assistant --reason=\"<why>\""));
        assert!(body.contains("The one exception is `llm set`"));
        // The three levels of authority.
        for heading in [
            "## Three levels of authority",
            "### Do it yourself, then tell the user how to undo it",
            "### Ask the user first",
            "### Only the user can do it",
        ] {
            assert!(body.contains(heading), "manual lost: {heading}");
        }
        // Nothing that holds the main chat: the waiting commands appear
        // only in the sentence that forbids them.
        assert!(body.contains("Never use `session wait`, `session follow`, `session watch` or"));
        for held in [
            "session wait",
            "session follow",
            "session watch",
            "project follow",
        ] {
            assert_eq!(body.matches(held).count(), 1, "{held} outside the ban");
        }
        // The silent reply after a send-back or an answered question.
        assert!(body.contains("`<no-reply/>`: no other text and no next-step suggestion."));
        assert!(body.contains("Send a subtask back at most twice."));
    }

    /// Every command the manual names is spelled as the CLI parses it
    /// (`cli/src/args.rs`): `session move` takes `--to`, not `--project`;
    /// `llm set` takes the session id, then the model name.
    #[test]
    fn manual_spells_commands_as_the_cli_does() {
        let body = manual_body();
        for command in [
            "`sessions list`",
            "`sessions search \"<keywords>\"`",
            "`session brief <id>`",
            "`session show <id>`",
            "`--tail=40`",
            "`project list`",
            "`project brief <project-id>`",
            "`project show <project-id>`",
            "`llm list`",
            "`session send <id> \"<message>\"`",
            "`--jump`",
            "`session stop <id>`",
            "`session archive <id>`",
            "`session restore <id>`",
            "`session move <id> --to=<project-id>`",
            "`project create \"<name>\"`",
            "`llm set <session-id> \"<model name>\"`",
        ] {
            assert!(body.contains(command), "manual lost: {command}");
        }
        assert!(!body.contains("--project="));
    }
}
