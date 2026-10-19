//! The assistant manual (main chat ticket 30; assistant PRD rulings 3
//! and 8), one file per part since ticket 59 (main chat PRD ruling 111).
//!
//! The main chat's entry layer ([`crate::managed_prompt`]) names the
//! directory once and each part with when to read it, and sends the model
//! to the parts a Galley CLI write needs before it makes one: the three
//! levels of authority, the CLI commands it uses (and the ones that would
//! hold the main chat), times, the user's to-dos and changing them, its
//! own reminders, what a wake note from Galley is, and who it is with how
//! to check a subtask's result and report it. It is the built-in
//! assistant's counterpart of the Supervisor SOP an outside agent copies
//! ([`crate::sop_install`]), which stays as it is.
//!
//! Parts, not one file: GA's `file_read` takes 200 lines at a time, and
//! GA cuts tool results older than its last ten messages to 800
//! characters, so the model read the whole manual again (about 2k tokens)
//! for each write. A part is a few hundred tokens.
//!
//! Embedded in Core and written into the managed state directory every
//! time a main chat runner is spawned
//! (`runner_commands::prepare_managed_spawn_args`), as IM writes the SOP
//! (`im_supervisor::materialize_sop_reference`): it versions with the
//! app, and an update never leaves an old copy behind: [`materialize`]
//! removes a part no longer on [`PARTS`] and the single file the manual
//! was before ticket 59. Galley-owned and rewritten whole, never user
//! state. Managed runtime only: attach mode has no main chat.

use std::path::{Path, PathBuf};

macro_rules! part {
    ($name:literal) => {
        (
            $name,
            include_str!(concat!(
                "../../docs/managed-ga-runtime/galley-assistant-manual/",
                $name
            )),
        )
    };
}

/// The manual's parts in reading order, file name and text, bundled at
/// build time from the files a developer reads in the repo. The entry
/// layer names every one of them.
pub(crate) const PARTS: [(&str, &str); 8] = [
    part!("authority.md"),
    part!("cli.md"),
    part!("times.md"),
    part!("todos.md"),
    part!("todos-change.md"),
    part!("reminders.md"),
    part!("wake.md"),
    part!("subtasks.md"),
];

/// Where the manual lives under the managed state root; the entry layer
/// names this directory.
pub fn manual_dir(state_root: &Path) -> PathBuf {
    state_root
        .join("assistant")
        .join("reference")
        .join("manual")
}

/// The single file the manual was until ticket 59.
fn single_file_path(state_root: &Path) -> PathBuf {
    state_root
        .join("assistant")
        .join("reference")
        .join("galley-assistant-manual.md")
}

/// Write every part into [`manual_dir`], replacing whatever is there,
/// then remove the `.md` files there that are not on [`PARTS`] (a part an
/// update renamed or dropped) and the single file of before ticket 59.
/// The parts are written first, so a removal that fails leaves the model
/// a whole manual.
pub fn materialize(state_root: &Path) -> std::io::Result<PathBuf> {
    let dir = manual_dir(state_root);
    std::fs::create_dir_all(&dir)?;
    for (name, body) in PARTS {
        std::fs::write(dir.join(name), body)?;
    }
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let markdown = Path::new(&name).extension().is_some_and(|ext| ext == "md");
        if markdown && !PARTS.iter().any(|(part, _)| name == *part) && entry.file_type()?.is_file()
        {
            std::fs::remove_file(entry.path())?;
        }
    }
    if let Err(e) = std::fs::remove_file(single_file_path(state_root)) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(e);
        }
    }
    Ok(dir)
}

/// One part's text, by file name.
#[cfg(test)]
pub(crate) fn part(name: &str) -> &'static str {
    PARTS
        .iter()
        .find(|(part, _)| *part == name)
        .map(|(_, body)| *body)
        .unwrap_or_else(|| panic!("no manual part {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .expect("read manual dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .into_string()
                    .expect("utf-8")
            })
            .collect();
        names.sort();
        names
    }

    /// Ticket 59: every part on the table is written, each a
    /// Galley-owned copy that says so, and nothing else is.
    #[test]
    fn materialize_writes_every_part() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = materialize(tmp.path()).expect("write manual");
        assert_eq!(dir, manual_dir(tmp.path()));
        assert!(dir.ends_with("assistant/reference/manual"));
        let mut expected: Vec<String> = PARTS.iter().map(|(name, _)| name.to_string()).collect();
        expected.sort();
        assert_eq!(names_in(&dir), expected);
        for (name, body) in PARTS {
            assert_eq!(
                std::fs::read_to_string(dir.join(name)).expect("read part"),
                body
            );
            // Whichever part the model reads, it learns not to edit it.
            // Single-line fragments only (a Windows checkout makes the
            // bundled files CRLF).
            assert!(body.starts_with("# Galley Assistant Manual: "), "{name}");
            assert!(
                body.contains(
                    "Galley rewrites this manual's files each time the main chat starts; do"
                ),
                "{name}"
            );
        }

        // A second spawn rewrites them, whatever was there.
        std::fs::write(dir.join("todos.md"), "stale").expect("overwrite");
        materialize(tmp.path()).expect("rewrite manual");
        assert_eq!(
            std::fs::read_to_string(dir.join("todos.md")).expect("read part"),
            part("todos.md")
        );
    }

    /// Ticket 59: an update leaves no old copy behind. A `.md` the table
    /// no longer has (a part renamed or dropped) goes, and so does the
    /// single file the manual was before; what is not a part stays.
    #[test]
    fn materialize_removes_old_parts_and_the_single_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let reference = tmp.path().join("assistant").join("reference");
        let dir = manual_dir(tmp.path());
        std::fs::create_dir_all(&dir).expect("manual dir");
        std::fs::write(dir.join("old-part.md"), "renamed since").expect("old part");
        std::fs::write(dir.join("notes.txt"), "not a part").expect("other file");
        let single = single_file_path(tmp.path());
        assert!(single.ends_with("assistant/reference/galley-assistant-manual.md"));
        std::fs::write(&single, "the manual before ticket 59").expect("single file");

        materialize(tmp.path()).expect("write manual");
        assert!(!dir.join("old-part.md").exists());
        assert!(!single.exists());
        assert!(dir.join("notes.txt").exists());
        assert_eq!(names_in(&reference), vec!["manual".to_string()]);

        // Nothing to remove the next time is not an error.
        materialize(tmp.path()).expect("rewrite manual");
    }

    /// Ticket 59: a part points to another by its bare file name
    /// (`` `reminders.md` ``), and only to parts on the table; a sibling
    /// `./*.md` link (none so far) would have to be a part too.
    #[test]
    fn parts_refer_only_to_parts_on_the_table() {
        let names: Vec<&str> = PARTS.iter().map(|(name, _)| *name).collect();
        let mut referred = 0;
        for (name, body) in PARTS {
            for code in body.split('`').skip(1).step_by(2) {
                if code.ends_with(".md") {
                    assert!(names.contains(&code), "{name} refers to {code}, not a part");
                    assert_ne!(code, name, "{name} refers to itself");
                    referred += 1;
                }
            }
            for target in body.split("](./").skip(1) {
                let file = target.split(')').next().expect("link target");
                assert!(names.contains(&file), "{name} links to {file}, not a part");
            }
        }
        // The cross-references the split made (ticket 59's list).
        assert_eq!(referred, 10);
        assert!(
            part("authority.md").contains("needs their yes to what and when (see `reminders.md`).")
        );
        assert!(part("reminders.md").contains("Galley wakes you with a note (see `wake.md`) that"));
        assert!(part("reminders.md").contains("`todos.md`), and without being asked when:"));
        assert!(part("todos.md")
            .contains("(「半小时后提醒我关火」, see `reminders.md`); once it has gone off"));
        for part_name in ["authority.md", "cli.md", "todos.md", "reminders.md"] {
            for section in [
                "\"To-dos and",
                "\"Your own reminders\"",
                "\"Noting a to-do\"",
                "(see below)",
            ] {
                assert!(
                    !part(part_name).contains(section),
                    "{part_name} still says {section}"
                );
            }
        }
    }

    /// The hard rules the ticket names, each in its part. Single-line
    /// fragments only (a Windows checkout makes the bundled files CRLF).
    #[test]
    fn manual_keeps_its_hard_rules() {
        let cli = part("cli.md");
        // Identity on every write; `llm set` is the one write without it.
        assert!(cli.contains("--supervisor=galley-assistant --reason=\"<why>\""));
        assert!(cli.contains("The one exception is `llm set`"));
        // The three levels of authority.
        let authority = part("authority.md");
        for heading in [
            "## Three levels of authority",
            "### Do it yourself, then tell the user how to undo it",
            "### Ask the user first",
            "### Only the user can do it",
        ] {
            assert!(authority.contains(heading), "authority.md lost: {heading}");
        }
        // Nothing that holds the main chat: the waiting commands appear
        // only in the sentence that forbids them, in any part.
        assert!(cli.contains("Never use `session wait`, `session follow`, `session watch` or"));
        for held in [
            "session wait",
            "session follow",
            "session watch",
            "project follow",
        ] {
            let count: usize = PARTS
                .iter()
                .map(|(_, body)| body.matches(held).count())
                .sum();
            assert_eq!(count, 1, "{held} outside the ban");
            assert_eq!(cli.matches(held).count(), 1, "{held} not in cli.md's ban");
        }
        // The silent reply after a send-back or an answered question.
        let wake = part("wake.md");
        assert!(wake.contains("`<no-reply/>`: no other text and no next-step suggestion."));
        assert!(wake.contains("Send a subtask back at most twice."));
    }

    /// Every command the manual names is spelled as the CLI parses it
    /// (`cli/src/args.rs`): `session move` takes `--to`, not `--project`;
    /// `llm set` takes the session id, then the model name. Each in the
    /// part that teaches it.
    #[test]
    fn manual_spells_commands_as_the_cli_does() {
        for (name, commands) in [
            (
                "cli.md",
                &[
                    "`sessions list`",
                    "`sessions search \"<keywords>\"`",
                    "`session brief <id>`",
                    "`session show <id>`",
                    "`--tail=40`",
                    "`project list`",
                    "`project brief <project-id>`",
                    "`project show <project-id>`",
                    "`llm list`",
                    // `--ensure-runner`: a send reaches a subtask whose
                    // runner is gone (socket `ensureRunner`, ADR-0003;
                    // tickets 29 / 30).
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
                    // The reads of tickets 34 and 40 (tickets 36, 41).
                    "`schedule list`",
                    "`schedule show <task-id>`",
                    "`todo list`",
                    "`todo show <todo-id>`",
                ][..],
            ),
            (
                // Ticket 34's `schedule` family (ticket 36).
                "reminders.md",
                &[
                    "`schedule list`",
                    "`schedule update <task-id> --at=<time>`",
                    "`--prompt=\"<words>\"`",
                    "`schedule delete <task-id>`",
                    "`schedule disable <task-id>`",
                    "`schedule run <task-id>`",
                    "`--weekly=<days>`",
                    "`--monthly=<days>`",
                    "`--time=HH:MM`",
                ][..],
            ),
            (
                // Ticket 40's `todo` family (ticket 41).
                "todos-change.md",
                &[
                    "`todo list`",
                    "`todo update <todo-id>`",
                    "`--no-due`",
                    "`--no-remind`",
                    "`todo done <todo-id>`",
                    "`todo reopen <todo-id>`",
                    "`todo cancel <todo-id>`",
                ][..],
            ),
        ] {
            let body = part(name);
            for command in commands {
                assert!(body.contains(command), "{name} lost: {command}");
            }
        }
        for (name, body) in PARTS {
            assert!(!body.contains("--project="), "{name}");
        }
        // The create line as the CLI parses it (`cli/src/args.rs`
        // `ScheduleCmd::Create`): the words, `--at`, the target.
        assert!(part("reminders.md").contains(
            "schedule create \"<your words>\" --at=<YYYY-MM-DDTHH:MM> --target=assistant \
             --supervisor=galley-assistant --reason=\"<why>\""
        ));
        // The add line as the CLI parses it (`cli/src/args.rs`
        // `TodoCmd::Add`): the title, `--due`, `--remind-at`, `--notes`.
        assert!(part("todos.md").contains(
            "todo add \"<title>\" --due=<date or time> --remind-at=<YYYY-MM-DDTHH:MM> \
             --notes=\"<details>\" --supervisor=galley-assistant --reason=\"<why>\""
        ));
    }

    /// Ticket 36: the rules on reminders and scheduled tasks — when to
    /// set one unasked, when not, saying so, the words for later,
    /// changing and cancelling, the target the CLI does not default to,
    /// and what to do when one comes due — and the authority the new
    /// hands carry. Ticket 41 folded them into "To-dos and reminders": the
    /// reminders are the model's own now (a follow-up, a check on the
    /// outside world), the times its rules share with to-dos. Ticket 59
    /// gave the times and the model's own reminders a part each.
    /// Single-line fragments only (CRLF on Windows).
    #[test]
    fn manual_covers_reminders_and_the_new_hands() {
        assert!(part("todos.md").contains("## To-dos and reminders"));
        assert!(part("times.md").contains("## Times"));
        let reminders = part("reminders.md");
        for heading in ["## Your own reminders", "## When one comes due"] {
            assert!(reminders.contains(heading), "reminders.md lost: {heading}");
        }
        for rule in [
            // When: a nudge the user asks for (ticket 44); unasked,
            // promises, waiting on the outside world.
            "Set one when the user asks for a nudge with nothing to finish (see",
            "`todos.md`), and without being asked when:",
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
            // Ask before a repeating task that works each time.
            "costs money every day, so ask first, in one question, with the time and",
            // Coming due: late, act, no longer applies.
            "the user it comes late, and how late.",
            "reply with exactly `<no-reply/>`.",
            // galley#31.
            "GenericAgent's own scheduler (`sche_tasks`) does not run in Galley: use",
        ] {
            assert!(reminders.contains(rule), "reminders.md lost: {rule}");
        }
        // An ambiguous day: the next one still ahead, named, not asked
        // (the eval's first round, ticket 36 Comments).
        let times = part("times.md");
        assert!(times.contains("- When a day could mean two dates, take the next one still ahead"));
        assert!(
            times.contains("date in your sentence so the user can correct it; do not ask first.")
        );
        assert!(times.contains("read the clock first (`date`)."));
        // Authority: scheduled tasks left the user-only level, the main
        // chat itself is off limits, deleting for good is asked first.
        for (name, body) in PARTS {
            assert!(!body.contains("there is no command for them yet"), "{name}");
            assert!(
                !body.contains("Renaming a session or project has no CLI command"),
                "{name}"
            );
        }
        let authority = part("authority.md");
        for rule in [
            "- Set a one-off reminder, or a one-off time to wake yourself and do",
            "- Changing, pausing or cancelling a scheduled task someone else made:",
            "- Deleting anything for good, such as `session delete` or",
            "Never archive, rename, pin or delete the main chat itself (this",
            "these, but `session archive` would still go through.",
        ] {
            assert!(authority.contains(rule), "authority.md lost: {rule}");
        }
    }

    /// Ticket 41 (main chat PRD ruling 91): the user's to-dos — noted
    /// unasked for what the user has to do (a reminder on it when it has
    /// a date, never through `schedule`), not for information, wishes or
    /// what is already there; said in a sentence; changed when the user
    /// says so, found by its title when quoted from the list; ticked off
    /// when done; `todo list` before saying what is left; no suggesting or
    /// tidying unasked; the list's own few controls; a to-do's reminder
    /// only reminds. Ticket 44 moved the request for a nudge out (see
    /// [`manual_tells_a_nudge_from_a_to_do`]). Ticket 59: noting is
    /// `todos.md`, changing `todos-change.md`. Single-line fragments only
    /// (CRLF on Windows).
    #[test]
    fn manual_covers_the_users_to_dos() {
        let todos = part("todos.md");
        assert!(todos.contains("### Noting a to-do"));
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
        ] {
            assert!(todos.contains(rule), "todos.md lost: {rule}");
        }
        let change = part("todos-change.md");
        assert!(change.contains("## Changing a to-do, ticking it off, what is left"));
        for rule in [
            // Change, quote, tick, what is left.
            "- The user changes a to-do by telling you: `todo update <todo-id>` with",
            "- A message that opens with a quote of a line from the list",
            "When nothing matches, or more than one thing does, ask which.",
            "- When the user says it is done (「营养土买好了」), or you saw it done",
            "so in a few words (「已勾掉。」); do not recite the list.",
            "- Asked what is left (「我还有什么没办」), run `todo list` first and answer",
        ] {
            assert!(change.contains(rule), "todos-change.md lost: {rule}");
        }
        // A to-do's reminder only reminds.
        let reminders = part("reminders.md");
        assert!(reminders
            .contains("subtask for long work. A to-do's reminder only reminds: do not tick the"));
        assert!(reminders.contains("to-do off until the user says it is done."));
        // Authority.
        assert!(part("authority.md")
            .contains("- Note, change, tick off or cancel the user's to-dos, and their"));
        for (name, body) in PARTS {
            assert!(!body.contains("## Reminders and scheduled tasks"), "{name}");
        }
    }

    /// Ticket 44 (main chat PRD ruling 92): a request to be reminded is
    /// told apart by one question — ignored, would it still need to be on
    /// the list? No (water, the stove) is a nudge: the model's own one-off
    /// reminder, not a to-do. Yes (the landlord, the report, the flight) is
    /// a to-do, its reminder at the time named. Ticket 41's line making
    /// every request to be reminded a to-do is gone. Ticket 59: the
    /// question is `todos.md`'s, and sends a nudge to `reminders.md`.
    /// Single-line fragments only (CRLF on Windows).
    #[test]
    fn manual_tells_a_nudge_from_a_to_do() {
        let todos = part("todos.md");
        for rule in [
            // Your own reminders take a nudge.
            "such as checking on a delivery, or to nudge the user when there is",
            "nothing for them to finish (「十分钟后提醒我喝水」). These are scheduled",
            // The question.
            "When the user asks to be reminded, ask yourself: if they ignored the",
            "reminder, would the thing still need to be on their list?",
            // No: a nudge, its own one-off reminder.
            "- No (drink water, turn off the stove, leave the house, get up and",
            "stretch): it is a nudge, not a to-do. Set your own one-off reminder",
            "(「半小时后提醒我关火」, see `reminders.md`); once it has gone off",
            "there is nothing left to tick.",
            // Yes: a to-do, reminded at the time named.
            "- Yes (call the landlord back, hand in the report, catch the flight): it",
            "is a to-do with its reminder at the time they named",
            "(「明天早上 8 点提醒我给房东回电话」: the call, due that day, reminded at",
        ] {
            assert!(todos.contains(rule), "todos.md lost: {rule}");
        }
        assert!(part("subtasks.md")
            .contains("a time, and you set your own reminders for what you promised and for a"));
        for (name, body) in PARTS {
            assert!(!body.contains("is one too, with its reminder"), "{name}");
        }
        // The question comes after the to-do's "when" and "not for", and
        // only the to-dos' part asks it.
        let note = todos.find("### Noting a to-do").unwrap();
        let question = todos.find("When the user asks to be reminded").unwrap();
        assert!(note < question);
        assert!(!part("reminders.md").contains("When the user asks to be reminded"));
    }
}
