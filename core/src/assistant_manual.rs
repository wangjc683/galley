//! The assistant manual (main chat ticket 30; assistant PRD rulings 3
//! and 8), one file per part since ticket 59 (main chat PRD ruling 111).
//!
//! The main chat's entry layer ([`crate::managed_prompt`]) names the
//! directory once and each part with when to read it, and sends the model
//! to the parts a Galley CLI write needs before it makes one: the three
//! levels of authority, the CLI commands it uses (and the ones that would
//! hold the main chat), times, the user's to-dos and changing them, its
//! own reminders, what a wake note from Galley is (the morning review
//! among them, ticket 73), what it does without being asked and what it
//! asks first (`unasked.md`, ticket 73), and who it is with how to check
//! a subtask's result and report it. It is the built-in
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
pub(crate) const PARTS: [(&str, &str); 9] = [
    part!("authority.md"),
    part!("cli.md"),
    part!("times.md"),
    part!("todos.md"),
    part!("todos-change.md"),
    part!("reminders.md"),
    part!("wake.md"),
    part!("unasked.md"),
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
        // The cross-references the split made (ticket 59's list), and
        // ticket 60's two: reminders.md to the three tests in todos.md,
        // todos.md to cancelling a kind in todos-change.md. Ticket 63
        // moved "When one comes due" into wake.md, and reminders.md's
        // reference to wake.md is now the sentence left in its place.
        // Ticket 73's six: todos.md and wake.md to unasked.md, unasked.md
        // to wake.md, subtasks.md and authority.md, and reminders.md to
        // wake.md for stopping the morning review.
        assert_eq!(referred, 18);
        assert!(
            part("authority.md").contains("needs their yes to what and when (see `reminders.md`).")
        );
        assert!(part("reminders.md")
            .contains("When one comes due, Galley wakes you: what to do then is in `wake.md`."));
        assert!(part("reminders.md").contains("`todos.md`), and without being asked when:"));
        assert!(part("todos.md")
            .contains("own one-off reminder (「半小时后提醒我关火」, see `reminders.md`;"));
        assert!(part("reminders.md")
            .contains("three tests in `todos.md`, and need not stay on their list"));
        assert!(part("todos.md").contains("the kind in `--reason` (see `todos-change.md`)."));
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
        assert!(reminders.contains("## Your own reminders"));
        // Coming due is wake.md's since ticket 63.
        let wake = part("wake.md");
        assert!(wake.contains("## When a reminder comes due"));
        assert!(wake.contains("the user it comes late, and how late."));
        assert!(wake
            .contains("user, or a reminder no longer applies (the user already did it, or said"));
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
            "user sees it in 「待办」 beside this chat and can only tick a to-do off,",
            "new time, new words, they tell you, and you change it; do not send them",
            "- **Your own reminders**: times Galley wakes you to do something yourself,",
            // Information is memory; no tidying unasked.
            "Neither holds information: an address, a flight number or a preference",
            "be of use to raise then is not information: follow it up. Do not tidy the",
            "(search the history if you need to), show them the list first, and note",
            // When: unasked, with a time or without.
            "Note one without being asked when the user mentions something they have",
            // When not, and list first.
            "Not for a wish with nothing to do yet (「我最近想学吉他」), a remark about",
            "said they do not need, or something already there: run `todo list` before",
            // Due, reminder, notes; never `schedule` for a to-do's reminder.
            "- When it has a due date, hang one reminder on it with `--remind-at`: at",
            "the time they named, or else when raising it helps most, which is not",
            "somewhere to go, by as long as that takes (the evening before an early",
            "flight, the day before a deadline, half an hour before a call, a few",
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
        // A to-do's reminder only reminds (wake.md's since ticket 63).
        let wake = part("wake.md");
        assert!(
            wake.contains("work. A to-do's reminder only reminds: do not tick the to-do off until")
        );
        assert!(wake.contains("the user says it is done or has happened."));
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
            "When the user asks to be reminded, or you follow something up, ask",
            "yourself: if they ignored the reminder, would the thing still need to be",
            // No: a nudge, its own one-off reminder.
            "- No (drink water, turn off the stove, leave the house, get up and",
            "stretch, an answer to ask after): it is a nudge, not a to-do. Set your",
            "own one-off reminder (「半小时后提醒我关火」, see `reminders.md`;",
            "has gone off there is nothing left to tick.",
            // Yes: a to-do, reminded at the time named.
            "- Yes (call the landlord back, hand in the report, catch the flight, a",
            "renovation due to finish, a lease running out): it is a to-do with its",
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

    /// Ticket 60 (main chat PRD rulings 112, 113): the list takes what
    /// the user will want followed up, whoever does it, and the model
    /// follows it up unasked when three tests hold; a date with nothing
    /// to do then is information. Where it goes is the nudge-or-to-do
    /// question, its time what it is for (ahead, on the day, after). The
    /// floor: 「记一下」 with a date is never memory alone; every one is
    /// said, the unasked with why and when; a kind turned down is
    /// cancelled with the kind in `--reason`, and "Follow-ups the user
    /// turned down" (the In Hand group's title) is read before setting
    /// one unasked. When one comes due it says what is of use, not the
    /// words. Single-line fragments only (CRLF on Windows).
    #[test]
    fn manual_follows_up_what_comes_up_on_a_date() {
        let todos = part("todos.md");
        for rule in [
            // What the list holds.
            "landlord back, buy potting soil), or something coming up on a date that",
            "they will want to act on or hear about then, whoever does it (their",
            "belongs in your memory, and so does a date with nothing to do when it",
            // Unasked, by three tests.
            "Follow up something they mention without being asked, too, when all three",
            "1. It will happen, fall due or have an outcome at a time to come: a date,",
            "2. Raising it then will be of use to the user: something to do, decide or",
            "3. They may not think of it then by themselves: not a habit, such as going",
            // Not for a date alone; what the user turned down.
            "the past (「昨天开会挺累的」), a date that is only a date, something they",
            "second. Before you follow something up unasked, read",
            "\"Follow-ups the user turned down\" in your \"In Hand\" lines: one of the",
            "same kind there means leave it, unless the user asks for it outright.",
            // The floor: asked with a date, never memory alone.
            "When the user says 「记一下」, 「帮我记着」 or 「提醒我」 about something with",
            "into your memory alone.",
            // Where: an answer to ask after is a nudge; a renovation or a
            // lease a to-do.
            "「HR 说这周五给 offer 答复」: ask on Friday evening how it went); once it",
            // When: ahead, on the day, after.
            "weeks before a lease runs out), on the day when there is something to",
            "comes later, as your own reminder (the evening the answer is due).",
            // Say why and when; cancel, with the kind.
            "they did not ask, the same sentence says why and when",
            "(「11 月 20 号我问你一下装修完没。」). The desktop shows a card for it under",
            "When they say they do not need it (「不用」), cancel it; when they say not",
        ] {
            assert!(todos.contains(rule), "todos.md lost: {rule}");
        }
        assert!(!todos.contains("Do not suggest to-dos"));
        let reminders = part("reminders.md");
        for rule in [
            "- Something the user mentioned has an outcome worth asking after, by the",
            "one unasked, read \"Follow-ups the user turned down\" in your \"In Hand\"",
            "sentence says why (「周五傍晚我问你一下 offer 的结果。」). The desktop",
            "Never set one without saying so.",
            "(「这类别提醒我」), cancel the one you set, and say the kind, briefly, at the",
        ] {
            assert!(reminders.contains(rule), "reminders.md lost: {rule}");
        }
        // Coming due: what is of use now, not the words (wake.md's since
        // ticket 63).
        let wake = part("wake.md");
        assert!(wake
            .contains("- Then do what it says. Do not recite it (「提醒：装修完工」): think what"));
        assert!(wake
            .contains("(「702 装修预计今天完工，完了吗？要不要约个时间验收？」); look something"));
        let change = part("todos-change.md");
        assert!(change.contains(
            "  (「这类别提醒我」), cancel the one you set, and say the kind, briefly, at"
        ));
        // The kind survives the In Hand line's cut (managed_prompt's
        // IN_HAND_TEXT_CHARS, 40 characters). That the group named is
        // the one the In Hand lines print is managed_prompt's test.
        let example = "user: no renovation progress reminders";
        assert!(example.chars().count() <= 40);
        for body in [reminders, change] {
            assert!(body.contains(&format!("`--reason=\"{example}\"`")));
            assert!(body.contains("under \"Follow-ups the user turned down\" in each later"));
        }
    }

    /// Ticket 63 (main chat PRD ruling 115): what to do when a reminder
    /// comes due is in the part a wake reads (`wake.md`, which the entry
    /// layer names for when Galley wakes you), once: reminders.md keeps a
    /// sentence pointing there, and the no-reply rule is the one wake.md
    /// already had. A plan for tonight with nothing to get ready fails the
    /// third test; what decides it is something to get ready or think of,
    /// not how soon. A reminder time the model picks is not the moment the
    /// thing starts, and that rule is part of the `--remind-at` line.
    /// Single-line fragments only (CRLF on Windows).
    #[test]
    fn manual_wakes_with_what_is_of_use() {
        let wake = part("wake.md");
        let woken = wake.find("## When Galley wakes you").unwrap();
        let due = wake.find("## When a reminder comes due").unwrap();
        assert!(woken < due);
        for rule in [
            "The note carries your own words, or the to-do's title and notes, and the",
            "- If it went off late (the computer was asleep, Galley was closed), tell",
            "- Then do what it says. Do not recite it (「提醒：装修完工」): think what",
            "is of use to the user now, and say that in a sentence or two",
            "work. A to-do's reminder only reminds: do not tick the to-do off until",
            "A scheduled task that starts a new conversation (one the user made with",
        ] {
            let at = wake
                .find(rule)
                .unwrap_or_else(|| panic!("wake.md lost: {rule}"));
            assert!(due < at, "{rule} is not under its heading");
        }
        // One set of words for each rule: none left behind in reminders.md.
        // The silent reply is wake.md's alone: once for a send-back or an
        // answer, and (ticket 73) for the morning review.
        let silent: usize = PARTS
            .iter()
            .map(|(_, body)| body.matches("<no-reply/>").count())
            .sum();
        assert_eq!(silent, wake.matches("<no-reply/>").count());
        for rule in [
            "When one comes due",
            "Do not recite it",
            "it comes late, and how late",
            "A to-do's reminder only reminds",
            "A scheduled task that starts a new conversation",
        ] {
            let count: usize = PARTS
                .iter()
                .map(|(_, body)| body.matches(rule).count())
                .sum();
            let here = if rule == "When one comes due" {
                part("reminders.md")
            } else {
                wake
            };
            assert_eq!(count, 1, "{rule} in more than one place");
            assert_eq!(here.matches(rule).count(), 1, "{rule}");
        }
        let reminders = part("reminders.md");
        assert!(!reminders.contains("## When one comes due"));
        assert!(reminders
            .contains("GenericAgent's own scheduler (`sche_tasks`) does not run in Galley: use"));

        let todos = part("todos.md");
        for rule in [
            // The third test: tonight's plan, nothing to get ready.
            "to work every day, nor a plan for tonight they just told you of with",
            "nothing to get ready (「今晚 7 点和朋友吃火锅」). What decides it is",
            "whether there is something to get ready or to think of then, not how",
            "soon: a check-up tomorrow (the reports to bring) or school starting on",
            // The time it picks: not the moment it starts.
            "the time they named, or else when raising it helps most, which is not",
            "the moment it starts: ahead when there is something to get ready or",
            "somewhere to go, by as long as that takes (the evening before an early",
        ] {
            assert!(todos.contains(rule), "todos.md lost: {rule}");
        }
        let test = todos
            .find("3. They may not think of it then by themselves")
            .unwrap();
        let tonight = todos.find("今晚 7 点和朋友吃火锅").unwrap();
        let floor = todos.find("When the user says 「记一下」").unwrap();
        assert!(test < tonight && tonight < floor);
        let line = todos
            .find("- When it has a due date, hang one reminder on it")
            .unwrap();
        let start = todos.find("the moment it starts").unwrap();
        let end = todos.find("Without a due date, no reminder.").unwrap();
        assert!(line < start && start < end);
    }

    /// Ticket 73 (assistant PRD ruling 10): what the user is in the middle
    /// of is a to-do with no date, beside the three tests, and a passing
    /// wish or a complaint is not one; what it does unasked is work, not
    /// advice — done when it can be undone and costs nothing and says
    /// nothing in the user's name, asked first with the groundwork done
    /// otherwise, no offers, the subtask limits, a file handed over as
    /// `[FILE:…]`; the morning review in `wake.md`, stopped by pausing it,
    /// and Galley's, so nothing to say or ask for it. Single-line
    /// fragments only (CRLF on Windows).
    #[test]
    fn manual_acts_unasked_and_reviews_each_morning() {
        let todos = part("todos.md");
        for rule in [
            "Note one without being asked, too, for something the user is in the",
            "(「排查到一半，先吃饭吧」: note 「查清阿里云费用暴涨的原因」). Leave out",
            "`--due`. Then think one step further, as `unasked.md` says.",
            "passing wish, a complaint, or something already finished is not something",
        ] {
            assert!(todos.contains(rule), "todos.md lost: {rule}");
        }
        // Beside the three tests, which stay as they were.
        let third = todos.find("3. They may not think of it then").unwrap();
        let middle = todos.find("for something the user is in the").unwrap();
        let not_for = todos.find("Not for a wish with nothing to do yet").unwrap();
        assert!(third < middle && middle < not_for);

        let unasked = part("unasked.md");
        for rule in [
            "## Doing things without being asked",
            "What you do on your own is work, not advice: get something done, then",
            "- **Just do it**: groundwork you can undo, that costs the user no money",
            "goes to a subtask (see `subtasks.md`), and when it is back Galley wakes",
            "- **Ask first, with the groundwork done**: anything outward-facing",
            "with it in hand (「Banner 草稿做好了，要发群里吗？」).",
            "- **Got nothing done, say nothing**: no offers. Never 「要不要我帮你……」",
            "or 「需要的话我可以……」, in your reply or in the next-step suggestion",
            "- **Limits**: when you note something, at most one subtask for it; in a",
            "morning review, at most two in all.",
            "`[FILE:<absolute path>]` on a line of its own: the desktop shows it as",
            "- **Not**: deciding for the user, changing what is theirs (their files,",
        ] {
            assert!(unasked.contains(rule), "unasked.md lost: {rule}");
        }

        let wake = part("wake.md");
        let review = wake.find("## The morning review").unwrap();
        for rule in [
            "Every morning at 9:00 Galley wakes you to go over what is in hand; the",
            "- Read what is current first: `todo list`, `schedule list`, and your",
            "`unasked.md` says, at most two subtasks in all. Do not raise early a",
            "to-dos, overdue ones included: their reminders do that.",
            "(「早上过了一遍在办的事：……」), so the user knows where it comes from.",
            "the user: the subtask tags and `<no-reply/>`, nothing else (you tell",
            "- When the user says to stop it (「别每天过了」, 「早上那个不用了」),",
            "pause it: `schedule disable <task-id>` on the task in `schedule list`",
            "whose `origin` has `\"supervisor\": \"galley-review\"`, never",
            "ask you to bring it back; when they do, `schedule enable <task-id>`. A",
            "new time: `schedule update <task-id> --time=HH:MM`.",
        ] {
            let at = wake
                .find(rule)
                .unwrap_or_else(|| panic!("wake.md lost: {rule}"));
            assert!(review < at, "{rule} is not under its heading");
        }
        // The label the manual names is the one Core makes it with.
        assert!(wake.contains(&format!(
            "`\"supervisor\": \"{}\"`",
            crate::scheduler::REVIEW_SUPERVISOR
        )));
        assert!(wake.contains("Never write it in any other reply but the morning review's"));
        assert!(
            wake.contains("task ran, or that it is time for the morning review. The user did not")
        );

        let reminders = part("reminders.md");
        for rule in [
            "The morning review is the exception to both: Galley made it, not you, so",
            "there is nothing to say or ask for it. Stopping it or moving it when the",
            "`\"via\": \"gui\"` is the user's form, `\"supervisor\": \"galley-review\"` is",
        ] {
            assert!(reminders.contains(rule), "reminders.md lost: {rule}");
        }
        let both = reminders
            .find("The morning review is the exception")
            .unwrap();
        assert!(reminders.find("Never set one without saying so.").unwrap() < both);
        assert!(reminders.find("set it once they say yes.").unwrap() < both);
    }
}
