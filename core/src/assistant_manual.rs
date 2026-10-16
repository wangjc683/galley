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
            // `--ensure-runner`: a send reaches a subtask whose runner is
            // gone (socket `ensureRunner`, ADR-0003; tickets 29 / 30).
            "`session send <id> \"<message>\" --ensure-runner`",
            "`--jump`",
            "`session stop <id>`",
            "`session archive <id>`",
            "`session restore <id>`",
            "`session move <id> --to=<project-id>`",
            "`project create \"<name>\"`",
            "`llm set <session-id> \"<model name>\"`",
            // Ticket 35's hands (ticket 36).
            "`session rename <id> \"<title>\"`",
            "`session pin <id>`, `session unpin <id>`",
            "`session delete <id>`",
            "`project update <project-id> --name=\"<name>\"`",
            "`project pin <project-id>`, `project unpin <project-id>`",
            "`project archive-sessions <project-id>`",
            "`llm set-default \"<model name>\"`",
            // Ticket 34's `schedule` family (ticket 36).
            "`schedule list`",
            "`schedule show <task-id>`",
            "`schedule update <task-id> --at=<time>`",
            "`--prompt=\"<words>\"`",
            "`schedule delete <task-id>`",
            "`schedule disable <task-id>`",
            "`schedule run <task-id>`",
            "`--weekly=<days>`",
            "`--monthly=<days>`",
            "`--time=HH:MM`",
            // Ticket 40's `todo` family (ticket 41).
            "`todo list`",
            "`todo show <todo-id>`",
            "`todo update <todo-id>`",
            "`--no-due`",
            "`--no-remind`",
            "`todo done <todo-id>`",
            "`todo reopen <todo-id>`",
            "`todo cancel <todo-id>`",
        ] {
            assert!(body.contains(command), "manual lost: {command}");
        }
        assert!(!body.contains("--project="));
        // The create line as the CLI parses it (`cli/src/args.rs`
        // `ScheduleCmd::Create`): the words, `--at`, the target.
        assert!(body.contains(
            "schedule create \"<your words>\" --at=<YYYY-MM-DDTHH:MM> --target=assistant \
             --supervisor=galley-assistant --reason=\"<why>\""
        ));
        // The add line as the CLI parses it (`cli/src/args.rs`
        // `TodoCmd::Add`): the title, `--due`, `--remind-at`, `--notes`.
        assert!(body.contains(
            "todo add \"<title>\" --due=<date or time> --remind-at=<YYYY-MM-DDTHH:MM> \
             --notes=\"<details>\" --supervisor=galley-assistant --reason=\"<why>\""
        ));
    }

    /// Ticket 36: the section on reminders and scheduled tasks — when to
    /// set one unasked, when not, saying so, the words for later,
    /// changing and cancelling, the target the CLI does not default to,
    /// and what to do when one comes due — and the authority the new
    /// hands carry. Ticket 41 folded it into "To-dos and reminders": the
    /// reminders are the model's own now (a follow-up, a check on the
    /// outside world), the times its rules share with to-dos. Single-line
    /// fragments only (CRLF on Windows).
    #[test]
    fn manual_covers_reminders_and_the_new_hands() {
        let body = manual_body();
        for heading in [
            "## To-dos and reminders",
            "### Times",
            "### Your own reminders",
            "### When one comes due",
        ] {
            assert!(body.contains(heading), "manual lost: {heading}");
        }
        for rule in [
            // When: a nudge the user asks for (ticket 44); unasked,
            // promises, waiting on the outside world.
            "Set one when the user asks for a nudge with nothing to finish (see",
            "\"Noting a to-do\"), and without being asked when:",
            "- You promise a follow-up",
            "- Something waits on the outside world (a delivery, a review, a reply),",
            "later (「下周一帮我看下物流」): set a time to check again.",
            // Already there: list first.
            "Before you create one, run `schedule list`: when the thing is already",
            // Say so, every time; no silent wake-ups.
            "Each time you set one, say in your reply, in one sentence, when and what",
            "Never set one without saying so.",
            // The words are for its later self.
            "Write the words for yourself at that moment, when this conversation may",
            // The CLI defaults to `session`.
            "- Always pass `--target=assistant`, repeating ones too. The CLI's default",
            // An ambiguous day: the next one still ahead, named, not
            // asked (the eval's first round, ticket 36 Comments).
            "- When a day could mean two dates, take the next one still ahead",
            "date in your sentence so the user can correct it; do not ask first.",
            // Ask before a repeating task that works each time.
            "costs money every day, so ask first, in one question, with the time and",
            // Coming due: late, act, no longer applies.
            "the user it comes late, and how late.",
            "reply with exactly `<no-reply/>`.",
            // galley#31.
            "GenericAgent's own scheduler (`sche_tasks`) does not run in Galley: use",
        ] {
            assert!(body.contains(rule), "manual lost: {rule}");
        }
        // Authority: scheduled tasks left the user-only level, the main
        // chat itself is off limits, deleting for good is asked first.
        assert!(!body.contains("there is no command for them yet"));
        assert!(!body.contains("Renaming a session or project has no CLI command"));
        assert!(
            body.contains("- Set a one-off reminder, or a one-off time to wake yourself and do")
        );
        assert!(
            body.contains("- Changing, pausing or cancelling a scheduled task someone else made:")
        );
        assert!(body.contains("- Deleting anything for good, such as `session delete` or"));
        assert!(body.contains("Never archive, rename, pin or delete the main chat itself (this"));
        assert!(body.contains("these, but `session archive` would still go through."));
    }

    /// Ticket 41 (main chat PRD ruling 91): the user's to-dos — noted
    /// unasked for what the user has to do (a reminder on it when it has
    /// a date, never through `schedule`), not for information, wishes or
    /// what is already there; said in a sentence; changed when the user
    /// says so, found by its title when quoted from the list; ticked off
    /// when done; `todo list` before saying what is left; no suggesting or
    /// tidying unasked; the list's own few controls; a to-do's reminder
    /// only reminds. Ticket 44 moved the request for a nudge out (see
    /// [`manual_tells_a_nudge_from_a_to_do`]). Single-line fragments only
    /// (CRLF on Windows).
    #[test]
    fn manual_covers_the_users_to_dos() {
        let body = manual_body();
        for heading in [
            "### Noting a to-do",
            "### Changing a to-do, ticking it off, what is left",
        ] {
            assert!(body.contains(heading), "manual lost: {heading}");
        }
        for rule in [
            // Two lists; the user's only controls on theirs.
            "- **The user's to-dos**: what they have to do (hand in a report, call the",
            "「待办」 beside this chat and can only tick a to-do off, untick it, or",
            "words, they tell you, and you change it; do not send them to the list",
            "- **Your own reminders**: times Galley wakes you to do something yourself,",
            // Information is memory; no suggesting or tidying unasked.
            "Neither holds information: an address, a flight number or a preference",
            "belongs in your memory. Do not suggest to-dos or tidy the list on your",
            "history if you need to), show them the list first, and note them once",
            // When: unasked, with a time or without.
            "Note one without being asked when the user mentions something they have",
            // When not, and list first.
            "Not for a wish with nothing to do yet (「我最近想学吉他」), a remark about",
            "something already there: run `todo list` before you add; when it is",
            // Due, reminder, notes; never `schedule` for a to-do's reminder.
            "- When it has a due date, hang one reminder on it with `--remind-at`: at",
            "the time they named, or else ahead by what it is: the evening before an",
            "early flight, the day before a deadline, half an hour before a call.",
            "Without a due date, no reminder.",
            "- `--notes`: what you will need when the reminder comes (names, places,",
            "- A to-do's reminder is set, moved and removed only with `todo add` and",
            "commands: a reminder made with `schedule create` is not on the to-do.",
            // Say it.
            "Say what you noted in one sentence, and when you will remind them if you",
            "Never note one without saying so.",
            // Change, quote, tick, what is left.
            "- The user changes a to-do by telling you: `todo update <todo-id>` with",
            "- A message that opens with a quote of a line from the list",
            "When nothing matches, or more than one thing does, ask which.",
            "- When the user says it is done (「营养土买好了」), or you saw it done",
            "so in a few words (「已勾掉。」); do not recite the list.",
            "- Asked what is left (「我还有什么没办」), run `todo list` first and answer",
            // A to-do's reminder only reminds.
            "subtask for long work. A to-do's reminder only reminds: do not tick the",
            "to-do off until the user says it is done.",
            // Authority.
            "- Note, change, tick off or cancel the user's to-dos, and their",
        ] {
            assert!(body.contains(rule), "manual lost: {rule}");
        }
        assert!(!body.contains("## Reminders and scheduled tasks"));
    }

    /// Ticket 44 (main chat PRD ruling 92): a request to be reminded is
    /// told apart by one question — ignored, would it still need to be on
    /// the list? No (water, the stove) is a nudge: the model's own one-off
    /// reminder, not a to-do. Yes (the landlord, the report, the flight) is
    /// a to-do, its reminder at the time named. Ticket 41's line making
    /// every request to be reminded a to-do is gone. Single-line fragments
    /// only (CRLF on Windows).
    #[test]
    fn manual_tells_a_nudge_from_a_to_do() {
        let body = manual_body();
        for rule in [
            // Your own reminders take a nudge.
            "such as checking on a delivery, or to nudge the user when there is",
            "nothing for them to finish (「十分钟后提醒我喝水」). These are scheduled",
            "a time, and you set your own reminders for what you promised and for a",
            // The question.
            "When the user asks to be reminded, ask yourself: if they ignored the",
            "reminder, would the thing still need to be on their list?",
            // No: a nudge, its own one-off reminder.
            "- No (drink water, turn off the stove, leave the house, get up and",
            "stretch): it is a nudge, not a to-do. Set your own one-off reminder",
            "(「半小时后提醒我关火」, see \"Your own reminders\"); once it has gone off",
            "there is nothing left to tick.",
            // Yes: a to-do, reminded at the time named.
            "- Yes (call the landlord back, hand in the report, catch the flight): it",
            "is a to-do with its reminder at the time they named",
            "(「明天早上 8 点提醒我给房东回电话」: the call, due that day, reminded at",
        ] {
            assert!(body.contains(rule), "manual lost: {rule}");
        }
        assert!(!body.contains("is one too, with its reminder"));
        // The question comes after the to-do's "when" and "not for", the
        // nudge's examples sit on the reminders' side.
        let note = body.find("### Noting a to-do").unwrap();
        let question = body.find("When the user asks to be reminded").unwrap();
        let own = body.find("### Your own reminders").unwrap();
        assert!(note < question && question < own);
    }
}
