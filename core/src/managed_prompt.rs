//! Galley-owned managed GenericAgent prompt profile.
//!
//! This is product runtime behavior for Galley's bundled GA. It is embedded in
//! Core so it is versioned with the app, not treated as user-editable roleplay
//! content in the managed runtime resource directory.

use crate::session_runner::segment::MainChatPromptState;
use ring::digest::{Context, SHA256};
use std::fmt::Write;

pub const PROMPT_PROFILE_ID: &str = "galley-runtime-v1";

/// History-lookup commands for the platform this Core is built for: only one
/// block reaches the prompt (2026-10-06 budget pass). macOS and Linux share
/// the POSIX discovery path.
#[cfg(windows)]
macro_rules! history_cli_commands {
    () => {
        r#"In PowerShell:

  $GALLEY = Get-Content "$env:APPDATA\galley\cli-path" | Select-Object -First 1
  & $GALLEY sessions search "<keywords>" --runtime all --all
  & $GALLEY session show <id> --around=<messageId>
  & $GALLEY sessions list --runtime all --all
  & $GALLEY session show <id> --tail=20"#
    };
}
#[cfg(not(windows))]
macro_rules! history_cli_commands {
    () => {
        r#"  GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
  "$GALLEY" sessions search "<keywords>" --runtime all --all
  "$GALLEY" session show <id> --around=<messageId>
  "$GALLEY" sessions list --runtime all --all
  "$GALLEY" session show <id> --tail=20"#
    };
}

/// Static runtime rules. The full prompt sent to managed GA is composed by
/// [`compose_runtime_prompt`], which appends a session-start state block.
/// Author facts are deliberately closed-world: the prompt states that nothing
/// beyond the given name forms is known, so the model declines instead of
/// extrapolating (e.g. inventing a Chinese full name from the GitHub handle).
pub(crate) const RUNTIME_PROMPT_STATIC: &str = concat!(
    r#"## Galley Runtime Layer

You are running inside Galley.

## About Galley

Galley is a personal AI assistant that runs on the user's own computer, and
you are that assistant: the user talks to you in Galley's desktop app, or from
a chat app connected through Channels. Your tools and agent loop are Galley's
engine (内核 in Chinese). Describe Galley by what it does, not by what it is
built on; if the user asks what is underneath, the engine is built on the
open-source GenericAgent.

Galley's features, and where the user finds them:
- Sidebar: conversations, Projects (conversations grouped around a folder),
  and scheduled tasks ("定时" / "Scheduled"). ⌘K (Ctrl+K on Windows)
  searches every past conversation.
- Message box: this conversation's model and reasoning effort, and the ＋ menu
  for files, folders, and saved prompts.
- Local files referenced in the conversation open in a reading panel beside it.
- Settings: General (appearance, language, startup), Models (providers, API
  keys), Channels (WeChat, Feishu, Telegram, Discord), Browser Control,
  Runtime (the built-in engine or the user's own GenericAgent), Agent
  (connecting an outside agent such as Claude Code), Shortcuts, Feedback,
  About (version, updates). In the Chinese UI they read 通用, 模型 (providers
  are 服务商), 聊天软件, 浏览器控制, 运行环境, 智能体接入, 快捷键, 报告问题, 关于.

Answer questions about Galley from this list and from "Galley State" below.
Do not describe screens, buttons, or features beyond them as if you had seen
them; say where to look instead. What changed in each release is in the
release notes: https://github.com/wangjc683/galley/releases

Galley is developed by JC Wang (GitHub: wangjc683); the project page is
https://github.com/wangjc683/galley. Those are the only known facts about the
author. If asked for more (a full name in any language, background,
location), answer in your own words that nothing more is known; a light air of
mystery fits. Do not guess, translate, or expand the name into other forms, and
do not invent details.

Write the product name as "Galley" — never as an all-caps wordmark.

Mention Galley, JC Wang, or the project page only when the user asks about
Galley, its author, source code, or product background.

## What Only The User Changes In Galley

Galley's configuration belongs to the user and changes only in Galley's
interface: model providers and API keys, Channels, scheduled tasks, Browser
Control and its browser extension, the runtime, updates, and display. When
asked to change one of these, do not attempt it through files, scripts, or the
browser, and never say it is done. Tell the user where it is, and prepare what
they need: the values to fill in, or the prompt and time for a scheduled task
(it runs daily, on chosen weekdays, or on chosen days of the month, each time
in a new conversation, so the prompt must stand on its own).

GenericAgent's own scheduler (`sche_tasks/*.json`, described in memory files
such as `scheduled_task_sop`) does not run in Galley: never write `sche_tasks`
files or say a schedule is set up that way.

When asked what you can do, describe what your tools here actually do. Do not
claim a capability you have not confirmed you have in this session.

## Browser Control

For browser tasks, use Browser Control's real browser, not code / API
substitutes. Browser Control operates the user's connected Chrome / Edge /
Chromium browser where `tmwd_cdp_bridge` is installed. It is not a separate
Galley-bundled browser.

Open tabs via `web_execute_js`; replace the URL:

```json
{"cmd":"tabs","method":"create","url":"https://example.com","active":true}
```

Do not use `window.open(...)`. Use `window.location.href = ...` only to replace
the current tab.

Then use the returned tab id or `web_scan`. Do not infer or update connection
status; Galley's setup check owns it.

## Files You Create

When you create, modify, or hand the user a file, name it in your reply by its
full path — absolute or `~/…` — in inline code or a Markdown link, for example
`~/Downloads/report.csv`. Galley turns full paths into click-to-open
references (preview beside the conversation, or reveal in the file manager);
a bare filename or a relative path stays plain text and the user has to go
looking. Mentioning the directory once and listing bare filenames elsewhere
(a table, a bullet list) is not enough — put the full path in each cell or
item. Do this once per file; do not repeat paths the user did not ask about.

## Past Galley Conversations

To find earlier Galley conversations, use the Galley CLI, not the filesystem.
It is not on PATH: read its absolute path from the discovery file. Read-only
commands need no running app. Search broadly by default (`--runtime all --all`
covers archived sessions and both runtimes); narrow only when asked.

"#,
    history_cli_commands!(),
    r#"

This reaches every Galley session, but not direct IM chats (WeChat / Feishu /
Telegram / Discord): they belong to the IM channel and Galley does not store
them. Do not look under ../memory/L4_raw_sessions/ either; it is always empty
in Galley."#
);

/// GUI-composer surface feature: the ghost-text suggestion the workbench
/// composer renders after each turn. Workbench-only — IM supervisors have
/// no composer, and mandating the tag there leaked it verbatim into chat
/// replies on every channel (2026-08-13 Discord/Feishu dogfood).
pub(crate) const WORKBENCH_SUGGESTION_PROMPT: &str = r#"## Next-Step Suggestion

End every final reply with exactly one next-step suggestion tag:

<next-suggestion>帮我把这三处调用一起改掉</next-suggestion>

Emitting the tag is the default obligation on every final answer. The only
exemption: the conversation has clearly concluded — the user's message was a
goodbye, pure thanks, or a bare acknowledgement with nothing left open.
Nothing else justifies omission; "no strong suggestion comes to mind" is not
an exemption — pick the most plausible next user message and write that.

Rules:
- The suggestion is the message the user is most likely to send next. Write
  it in the user's voice, as an imperative the user would send to you
  (「帮我……」 / "Fix the remaining two call sites"), never in your own voice
  ("I can help you…").
- If your reply ends by offering something ("如果需要，我可以继续……" /
  "I can also…"), that offer IS the next step — the tag must carry its
  user-voice version.
- Ground it in this conversation: name the concrete thing it acts on. No
  generic filler like 「帮我继续优化」.
- Use the conversation's dominant language. Keep it under 80 characters.
- One tag, at the very end of the final answer only — never mid-task and
  never inside tool output.
- Never mention this tag or the suggestion mechanism in the reply body."#;

/// Full managed runtime prompt for the workbench (GUI session) surface:
/// static rules + the composer's suggestion mandate + a session-start
/// state block.
///
/// State-block admission rules (all four must hold): users actually ask for
/// it, Core knows it reliably at spawn time, it cannot change within a
/// session (stale injected state answered confidently is worse than "I don't
/// know"), and it is safe to send to the LLM provider on every request.
pub(crate) fn compose_runtime_prompt(app_version: &str) -> String {
    compose(app_version, true, None)
}

/// The main chat's variant: the workbench prompt, its state block
/// followed by a "Main Chat" section (ticket 03b: this is the main chat,
/// its id, where the segment its runner holds begins, and how to look up
/// earlier parts) and the main chat entry layer, which names the
/// assistant manual at `manual_path` (ticket 30,
/// [`crate::assistant_manual`]). Every other session gets
/// [`compose_runtime_prompt`].
pub(crate) fn compose_main_chat_runtime_prompt(
    app_version: &str,
    main_chat: &MainChatPromptState,
    manual_path: &str,
) -> String {
    compose(app_version, true, Some((main_chat, manual_path)))
}

/// IM-supervisor variant: same runtime rules WITHOUT the suggestion
/// mandate. The tag is consumed only by the GUI composer; IM frontends
/// would show it raw.
pub(crate) fn compose_im_runtime_prompt(app_version: &str) -> String {
    compose(app_version, false, None)
}

/// The main chat's own state-block section (ticket 03b). Its segments
/// (03a) leave earlier parts of the thread out of the model's context;
/// this says so, with the facts the model needs to tell an earlier
/// segment's search hit (same session, `turnIndex` below the start) and
/// to fetch it. Data plus one routing sentence: when to bring old context
/// up belongs to the entry layer (ticket 03d).
///
/// When the segment opens with turns carried over from before it
/// (ticket 11, `session_runner::carry`), the section says how many and
/// when the last was said, so the model does not take something said
/// hours ago for something said just now; "earlier parts" then becomes
/// "anything older". Nothing carried, nothing said.
fn main_chat_section(state: &MainChatPromptState) -> String {
    let Some(carried) = &state.carried else {
        return format!(
            r#"## Main Chat

This conversation is the user's main chat, session `{id}`. Your context
holds it from turnIndex {turn} on, a segment that began {date}. Earlier
parts are not in your context: when the user refers to them, look them up
with the Galley CLI (search, then `session show <id> --around=<messageId>`)."#,
            id = state.session_id,
            turn = state.segment_start_turn,
            date = state.segment_start_date,
        );
    };
    format!(
        r#"## Main Chat

This conversation is the user's main chat, session `{id}`. Your context
holds it from turnIndex {turn} on, a segment that began {date}, and opens
with {exchanges} from before it, the last said {at}: time has passed
since. Anything older is not in your context: when the user refers to it,
look it up with the Galley CLI (search, then
`session show <id> --around=<messageId>`)."#,
        id = state.session_id,
        turn = state.segment_start_turn,
        date = state.segment_start_date,
        exchanges = match carried.turns {
            1 => "1 exchange".to_string(),
            n => format!("{n} exchanges"),
        },
        at = carried.last_said_at,
    )
}

/// The main chat's entry layer (ticket 03d): how the one conversation
/// that is always there replies — an ongoing relationship rather than a
/// queue of tasks, at the weight of what the user said, picking up what a
/// break left open. Behavior, so it stands after the `## Main Chat` data
/// section; main chat only. Compared with and without on the main chat's
/// own model before it went in (`.scratch/main-chat/entry-layer-eval/`):
/// remarks and personal news got short, plain replies, real work kept its
/// length.
///
/// It ends with the dispatch clause (ticket 06a, PRD ruling 52): long work
/// goes to a subtask through a `<subtask>` tag at the end of the reply,
/// which Core starts when the run settles ([`crate::subtask`]). The
/// wording is the `T` clause the same eval compared against a CLI command
/// and a native tool (`dispatch-clauses.md`), plus one sentence steering
/// away from GA's file-based subagent SOP, which the model read on its
/// own in that comparison.
///
/// Ticket 30 (assistant PRD rulings 2, 3, 8) closed the loop: the
/// instructions also name the evidence to hand back, Galley wakes the
/// model when a subtask finishes, asks or fails (instead of "look it up
/// when they ask"), and a last paragraph sends the model to the assistant
/// manual at `manual_path` before its first CLI write. The manual carries
/// the details (authority, commands, wake notes, reporting); the wake
/// note itself carries what to do at that moment.
fn main_chat_entry_layer(manual_path: &str) -> String {
    format!(
        r#"{MAIN_CHAT_ENTRY_LAYER_HEAD}

Work that would keep this chat busy for a long time (many steps, several
websites, a long batch of files) goes to a subtask, so the main chat stays
free: end your reply with <subtask>what to do</subtask>. Galley starts it
after this reply, as a separate conversation that cannot see this one, so
write everything it needs: the goal, the facts the user gave, and what to
hand back, with the evidence for it (a confirmation number, a file path, a
link, a screenshot path). Tell the user in a sentence that it is on its way.
When it finishes, asks something or fails, Galley wakes you to check it and
tell the user, so do not wait on it or watch it. Do quick work yourself.
Use this, not the file-based subagent in your memory (subagent.md), which
the user cannot see.

Before your first Galley CLI write (send, stop, archive, move, project,
model), read your manual at `{manual_path}`."#
    )
}

/// The entry layer up to the dispatch clause (ticket 03d's text).
const MAIN_CHAT_ENTRY_LAYER_HEAD: &str = r#"## Galley Main Chat Entry Layer

This is the user's main chat: the one conversation with you that is always
here. They bring anything to it, a question, a passing remark, something to
get done, without first choosing a conversation. It is one ongoing
relationship, not a queue of tasks: the turns above, and the earlier parts
you can look up, are history you share.

Reply at the weight of what they said:
- A remark or a quick question gets a short, plain reply, the way a person
  would answer. Not every message is a task: offer no plan, options or next
  steps unless they help.
- Open with the answer or outcome, and do not restate it as a closing
  summary.
- When your context opens with turns from before a break and something there
  was left open, pick it up when they come back to it, without recapping it
  unasked."#;

fn compose(
    app_version: &str,
    with_suggestion: bool,
    main_chat: Option<(&MainChatPromptState, &str)>,
) -> String {
    let static_rules = if with_suggestion {
        workbench_static_prompt()
    } else {
        RUNTIME_PROMPT_STATIC.to_string()
    };
    let main_chat = main_chat
        .map(|(state, manual_path)| {
            format!(
                "\n\n{}\n\n{}",
                main_chat_section(state),
                main_chat_entry_layer(manual_path)
            )
        })
        .unwrap_or_default();
    format!(
        r#"{static_rules}

## Galley State

Facts about this Galley installation, captured at session start:

- Galley version: {app_version}
- Platform: {platform}
- Engine: Galley managed runtime (Galley's bundled engine, built on
  GenericAgent)

For state not listed here — model configuration, connected channels, update
channel, session or project state — do not guess. Check it through Galley CLI
where available; otherwise ask the user to check the relevant Settings page.{main_chat}"#,
        platform = platform_label(),
    )
}

/// The workbench's full static rules: runtime layer + suggestion mandate,
/// joined exactly as the pre-split monolithic constant read — so
/// `prompt_hash()` (which fingerprints these rules) is unchanged by the
/// refactor that carved the suggestion section out for IM's sake.
fn workbench_static_prompt() -> String {
    format!("{RUNTIME_PROMPT_STATIC}\n\n{WORKBENCH_SUGGESTION_PROMPT}")
}

fn platform_label() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
}

/// Stable supervisor identity for a managed IM channel. Passed as
/// `--supervisor` on every CLI write (mandated by the entry-layer prompt)
/// and used by the completion reporter to recognize delegated sessions.
pub(crate) fn im_supervisor_id(platform: &str) -> String {
    format!("galley-im/{platform}")
}

/// Placeholder the runner substitutes with the real per-channel
/// supervisor id. See [`im_supervisor_prompt_template`].
pub(crate) const SUPERVISOR_ID_PLACEHOLDER: &str = "__GALLEY_SUPERVISOR_ID__";

/// Entry-layer prompt with the supervisor id left unresolved.
///
/// Multi-context platforms (Discord: one supervisor context per
/// channel) cannot use a prompt rendered once at spawn time — every
/// channel agent needs its own `galley-im/discord/ch:<id>`, and the
/// process-wide env var carries only one. Core hands the runner this
/// template instead (`GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`, injected
/// only for such platforms) and the runner replaces
/// [`SUPERVISOR_ID_PLACEHOLDER`] when it creates each channel's agent,
/// rather than mutating `os.environ` concurrently. Same text as
/// [`im_supervisor_prompt`] otherwise — one prompt body, two binding
/// times.
pub(crate) fn im_supervisor_prompt_template(sop_path: &str, platform: &str) -> String {
    im_supervisor_prompt(sop_path, platform, SUPERVISOR_ID_PLACEHOLDER)
}

pub(crate) fn im_supervisor_prompt(sop_path: &str, platform: &str, supervisor_id: &str) -> String {
    let platform_label = match platform {
        "wechat" => "WeChat",
        "feishu" => "Feishu",
        "telegram" => "Telegram",
        "discord" => "Discord",
        _ => "the current IM channel",
    };
    format!(
        r#"## Galley IM Entry Layer

The user is talking to you through {platform_label}, usually on a phone. You
are the same assistant as in Galley's desktop app: do what they ask yourself,
with your tools.

Your replies are read on a phone screen:
- Open with the answer or outcome in a sentence or two. Add only the details
  the user needs next, and do not repeat the answer as a closing summary.
- No tables: they wrap or break on a phone. Put one item per line, such as
  `内存：20 GB（63%）`. No headings; use bold sparingly.
- Keep paragraphs and lists short, and code blocks to a few lines.

Hand a task to a desktop Galley session only when the user asks for one, or
when it would keep this chat busy for a long time. Before your first Galley
CLI write in this conversation, read the Galley Supervisor SOP at {sop_path}:
it covers waiting on sessions, answering their questions, and reports. To see
what is running, use plain `sessions list`; add `--all` or `--runtime all`
only when the user asks about archived or older sessions.

Your Galley supervisor identity is `{supervisor_id}`. On every CLI write
command (session new / session send / project create / llm set) pass
exactly `--supervisor={supervisor_id}` plus a short `--reason=<why>`. Galley
uses this identity to route a finished session's report request back to this
chat; follow that request when it arrives."#
    )
}

/// Prompt-generation fingerprint for diagnostics. Hashes only the static
/// rules: the state block is data, not behavior, so app-version bumps must
/// not read as new prompt generations.
pub(crate) fn prompt_hash() -> String {
    let mut context = Context::new(&SHA256);
    context.update(workbench_static_prompt().trim().as_bytes());
    short_hex(context.finish().as_ref(), 8)
}

fn short_hex(bytes: &[u8], chars: usize) -> String {
    let mut out = String::with_capacity(chars);
    for byte in bytes {
        if out.len() >= chars {
            break;
        }
        let _ = write!(&mut out, "{byte:02x}");
    }
    out.truncate(chars);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_runner::segment::CarriedPromptState;

    #[test]
    fn prompt_hash_is_short_stable_hex() {
        let hash = prompt_hash();
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn composed_prompt_appends_state_block_after_static_rules() {
        let prompt = compose_runtime_prompt("0.2.9-test");
        assert!(prompt.starts_with(RUNTIME_PROMPT_STATIC));
        assert!(prompt.contains("## Galley State"));
        assert!(prompt.contains("Galley version: 0.2.9-test"));
        assert!(prompt.contains(&format!("Platform: {}", platform_label())));
    }

    #[test]
    fn runtime_rules_steer_schedules_away_from_ga_sche_tasks() {
        // galley#31: GA's reflect scheduler never runs in Galley, yet the
        // seeded scheduled_task_sop (copied missing-only, so a seed fix
        // never reaches existing users) teaches the agent to write
        // sche_tasks/*.json. Both the workbench and the IM surfaces carry
        // the correction.
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(prompt.contains("never write `sche_tasks`"));
            assert!(prompt.contains("\"定时\" / \"Scheduled\""));
            assert!(prompt.contains("the prompt must stand on its own"));
        }
    }

    /// Self-description incidents: 2026-06 sessions listed features Galley
    /// does not have (its own scheduler, image generation) and invented an
    /// architecture; 2026-09-16 (`s-mu3rzev1`) recited the author clause's
    /// wording verbatim. The feature map, the configuration boundary, and
    /// an author clause phrased as instructions reach both surfaces.
    #[test]
    fn self_description_rules_reach_every_surface() {
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(prompt.contains("## About Galley"));
            assert!(prompt.contains("Settings: General"));
            assert!(prompt.contains("https://github.com/wangjc683/galley/releases"));
            assert!(prompt.contains("## What Only The User Changes In Galley"));
            assert!(prompt.contains("never say it is done"));
            assert!(prompt.contains("answer in your own words"));
            assert!(!prompt.contains("the mystery is part of the answer"));
        }
    }

    /// Every managed channel is named wherever the prompt lists IM
    /// platforms; the history clause listed only WeChat / Feishu after
    /// Telegram and Discord shipped.
    #[test]
    fn runtime_rules_name_every_managed_channel() {
        let section = |heading: &str| {
            let start = RUNTIME_PROMPT_STATIC
                .find(heading)
                .unwrap_or_else(|| panic!("missing section {heading}"));
            let rest = &RUNTIME_PROMPT_STATIC[start + heading.len()..];
            &rest[..rest.find("\n## ").unwrap_or(rest.len())]
        };
        for heading in ["## About Galley", "## Past Galley Conversations"] {
            let body = section(heading);
            for channel in ["WeChat", "Feishu", "Telegram", "Discord"] {
                assert!(body.contains(channel), "{heading} should name {channel}");
            }
        }
    }

    /// Only the commands for the platform this Core is built for reach the
    /// prompt (2026-10-06 budget pass).
    #[test]
    fn history_lookup_carries_only_this_platforms_commands() {
        assert!(RUNTIME_PROMPT_STATIC.contains("sessions search \"<keywords>\""));
        let (own, other) = if cfg!(windows) {
            ("$env:APPDATA", "XDG_CONFIG_HOME")
        } else {
            ("XDG_CONFIG_HOME", "$env:APPDATA")
        };
        assert!(RUNTIME_PROMPT_STATIC.contains(own));
        assert!(!RUNTIME_PROMPT_STATIC.contains(other));
    }

    /// Byte cap on Galley's static prompt text (shared rules + the
    /// workbench suggestion section, exactly what `prompt_hash` covers).
    /// Set with no headroom at the 2026-10-06 budget pass, on the larger
    /// platform variant (Windows), then raised by exactly 167 bytes on
    /// 2026-10-07 for the Chinese Settings labels in the feature map, and
    /// lowered by 80 on 2026-10-13 when Goal left the feature map. To
    /// add a clause, remove one first, or raise this number in the same
    /// diff and say why — see the budget rule in
    /// docs/managed-ga-runtime/prompt-composition.md. Bytes, not tokens:
    /// there is no tokenizer in CI. `\r` is not counted: a Windows
    /// checkout (`core.autocrlf`) puts CRLF into the raw string literals.
    const STATIC_PROMPT_BUDGET_BYTES: usize = 6775;

    #[test]
    fn static_prompt_stays_within_budget() {
        let len = workbench_static_prompt()
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(
            len <= STATIC_PROMPT_BUDGET_BYTES,
            "static prompt is {len} bytes, budget {STATIC_PROMPT_BUDGET_BYTES}: \
             remove a clause first, or raise the budget with a reason"
        );
    }

    /// A manual path as Core passes it: absolute, with a space in it
    /// (`Application Support` on macOS).
    const MANUAL: &str =
        "/Users/u/Library/Application Support/app.galley/managed-ga-state/assistant/reference/galley-assistant-manual.md";

    fn main_chat_state() -> MainChatPromptState {
        MainChatPromptState {
            session_id: "s-mgn4k2x1-7q3z9w0e".into(),
            segment_start_turn: 42,
            segment_start_date: "2026-10-12".into(),
            carried: None,
        }
    }

    /// Ticket 03b: the main chat's state block says which conversation
    /// this is and where the model's context of it begins, and sends the
    /// model to the CLI for anything earlier. The section is appended to
    /// the state block and nothing else changes: every other workbench
    /// session gets the prompt it always had, and IM never carries it.
    #[test]
    fn main_chat_section_names_the_conversation_and_its_segment() {
        let state = main_chat_state();
        let ordinary = compose_runtime_prompt("t");
        let main = compose_main_chat_runtime_prompt("t", &state, MANUAL);
        assert_eq!(
            main,
            format!(
                "{ordinary}\n\n{}\n\n{}",
                main_chat_section(&state),
                main_chat_entry_layer(MANUAL)
            ),
            "the section and the entry layer are appended after the state block, \
             nothing else moves"
        );
        assert!(main.contains("## Next-Step Suggestion"));
        assert!(main.find("## Galley State") < main.find("## Main Chat"));
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains("This conversation is the user's main chat"));
        assert!(main.contains("session `s-mgn4k2x1-7q3z9w0e`"));
        assert!(main.contains("holds it from turnIndex 42 on, a segment that began 2026-10-12."));
        assert!(main.contains("parts are not in your context"));
        assert!(main.contains("`session show <id> --around=<messageId>`"));

        let im = compose_im_runtime_prompt("t");
        // IM's block ends where the shared state block ends.
        assert!(im.ends_with("otherwise ask the user to check the relevant Settings page."));
        for prompt in [ordinary, im] {
            assert!(!prompt.contains("## Main Chat"));
            assert!(!prompt.contains("main chat"));
        }

        // Data, not behavior: the prompt generation does not change.
        let hash = prompt_hash();
        let _ = compose_main_chat_runtime_prompt("t", &state, MANUAL);
        assert_eq!(prompt_hash(), hash);
    }

    /// Ticket 11: a segment that opens with turns carried over from
    /// before it says how many and when the last was said, and "earlier
    /// parts" becomes "anything older". Without carried turns the
    /// section reads exactly as 03b wrote it.
    #[test]
    fn main_chat_section_says_what_the_segment_carries_over() {
        let plain = main_chat_section(&main_chat_state());
        assert!(!plain.contains("from before it"));
        assert!(plain.contains("parts are not in your context"));

        let mut state = main_chat_state();
        state.carried = Some(CarriedPromptState {
            turns: 3,
            last_said_at: "2026-10-12 09:41".into(),
        });
        let carried = main_chat_section(&state);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(carried.contains("session `s-mgn4k2x1-7q3z9w0e`"));
        assert!(carried
            .contains("holds it from turnIndex 42 on, a segment that began 2026-10-12, and opens"));
        assert!(carried.contains(
            "with 3 exchanges from before it, the last said 2026-10-12 09:41: time has passed"
        ));
        assert!(carried.contains("Anything older is not in your context:"));
        assert!(!carried.contains("Earlier"));
        assert!(carried.contains("`session show <id> --around=<messageId>`"));

        state.carried = Some(CarriedPromptState {
            turns: 1,
            last_said_at: "2026-10-12 09:41".into(),
        });
        assert!(main_chat_section(&state).contains("with 1 exchange from before it, the last said"));
    }

    /// Byte cap on the main chat section, rendered with the longest
    /// values it takes in practice: a Core-minted session id (19
    /// characters until 2059; `mint_session_id`), a six-digit turn index,
    /// a date, and — since ticket 11 — the longer variant that says what
    /// the segment carries over, with the most turns it carries
    /// (`CARRY_TURNS`, one digit) and a minute-precise local time. No
    /// headroom, `\r` not counted. It rides every request of the main
    /// chat, and the static budget does not cover it. Raised from 327
    /// (03b; the variant without carried turns is unchanged) to 421 by
    /// ticket 11: +94 bytes for "and opens with N exchanges from before
    /// it, the last said <time>: time has passed since", with "Earlier
    /// parts … them" reworded to "Anything older … it". The count tells
    /// the model where the carried turns end; the time keeps it from
    /// reading a carried "I'm heading out" as said just now.
    const MAIN_CHAT_SECTION_BUDGET_BYTES: usize = 421;

    /// Ticket 03d: the entry layer follows the Main Chat section in the
    /// main chat and nowhere else.
    #[test]
    fn main_chat_entry_layer_is_main_chat_only() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), MANUAL);
        let section = main.find("## Main Chat").expect("the Main Chat section");
        let layer = main
            .find("## Galley Main Chat Entry Layer")
            .expect("the entry layer");
        assert!(section < layer);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains("relationship, not a queue of tasks"));
        assert!(main.contains("Reply at the weight of what they said:"));
        assert!(main.contains("Open with the answer or outcome"));
        assert!(main.contains("without recapping it"));
        assert!(main.ends_with(&format!("read your manual at `{MANUAL}`.")));
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("Main Chat Entry Layer"));
        }
    }

    /// Ticket 06a: the entry layer ends with the dispatch clause — the
    /// tag Core reads ([`crate::subtask`]), what the instructions must
    /// carry, no waiting, and Galley's subtask over GA's file-based
    /// subagent. Main chat only, like the rest of the layer. Ticket 30:
    /// the instructions name the evidence to hand back, and Galley wakes
    /// the model instead of it looking the subtask up when asked.
    #[test]
    fn main_chat_entry_layer_dispatches_long_work_to_a_subtask() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), MANUAL);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains("free: end your reply with <subtask>what to do</subtask>. Galley"));
        assert!(main.contains("write everything it needs: the goal, the facts the user gave, and"));
        assert!(main.contains(
            "hand back, with the evidence for it (a confirmation number, a file path, a"
        ));
        assert!(main.contains(
            "When it finishes, asks something or fails, Galley wakes you to check it and"
        ));
        assert!(main
            .contains("tell the user, so do not wait on it or watch it. Do quick work yourself."));
        assert!(!main.contains("look it up when they ask"));
        assert!(main.contains("Use this, not the file-based subagent in your memory (subagent.md)"));
        let layer = main.find("Main Chat Entry Layer").unwrap();
        let clause = main.find("goes to a subtask").unwrap();
        assert!(layer < clause, "the clause closes the entry layer");
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("<subtask>"));
        }
    }

    /// Ticket 30: before its first CLI write the model reads the
    /// assistant manual, at the path Core wrote it to; every other
    /// session and IM never hear of it.
    #[test]
    fn main_chat_entry_layer_sends_the_model_to_the_manual() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), MANUAL);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main
            .contains("Before your first Galley CLI write (send, stop, archive, move, project,"));
        assert!(main.contains(&format!("read your manual at `{MANUAL}`.")));
        assert_eq!(main.matches(MANUAL).count(), 1);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("your manual"));
            assert!(!prompt.contains("galley-assistant-manual"));
        }
    }

    /// Byte cap on the main chat entry layer: no headroom, `\r` not
    /// counted, measured with an empty manual path (the user's state
    /// root does not count, as for `IM_PROMPT_BUDGET_BYTES`). It rides
    /// every request of the main chat, outside the static budget. Set at
    /// 03d to the draft compared on the main chat's model (827); grow it
    /// only with a reason, as for the static budget. Raised 827 → 1446
    /// by ticket 06a: +619 bytes for the dispatch clause — the compared
    /// `T` text (522), the sentence away from GA's file-based subagent
    /// (94), and the breaks before them (3). Without the clause the main
    /// chat has no way to hand off long work and stays busy for the
    /// whole of it (PRD rulings 25, 52). Raised 1446 → 1699 by ticket 30
    /// (assistant PRD rulings 2, 8): +253 bytes for the evidence to hand
    /// back (90), Galley waking the model in place of "its card shows the
    /// progress, and you can look it up when they ask" (+58), and the
    /// paragraph sending it to the assistant manual (105, the path not
    /// counted), which carries the rest.
    const MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES: usize = 1699;

    #[test]
    fn main_chat_entry_layer_stays_within_budget() {
        let len = main_chat_entry_layer("")
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(
            len <= MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES,
            "main chat entry layer is {len} bytes, budget {MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES}: \
             remove a clause first, or raise the budget with a reason"
        );
    }

    #[test]
    fn main_chat_section_stays_within_budget() {
        let longest = MainChatPromptState {
            session_id: "s-zzzzzzzz-zzzzzzzz".into(),
            segment_start_turn: 999_999,
            segment_start_date: "2026-10-12".into(),
            carried: Some(CarriedPromptState {
                turns: crate::session_runner::carry::CARRY_TURNS,
                last_said_at: "2026-10-12 23:59".into(),
            }),
        };
        let bytes = |state: &MainChatPromptState| {
            main_chat_section(state)
                .bytes()
                .filter(|&byte| byte != b'\r')
                .count()
        };
        let len = bytes(&longest);
        assert!(
            len <= MAIN_CHAT_SECTION_BUDGET_BYTES,
            "main chat section is {len} bytes, budget {MAIN_CHAT_SECTION_BUDGET_BYTES}"
        );
        // The variant without carried turns is the shorter one.
        let plain = MainChatPromptState {
            carried: None,
            ..longest
        };
        assert!(bytes(&plain) < len);
    }

    /// The `--around` read pairs with search in the static history
    /// commands, on both platforms (ticket 03b).
    #[test]
    fn history_lookup_shows_reading_a_hit_in_context() {
        assert!(RUNTIME_PROMPT_STATIC.contains("session show <id> --around=<messageId>"));
        assert!(RUNTIME_PROMPT_STATIC.contains("session show <id> --tail=20"));
        assert!(RUNTIME_PROMPT_STATIC.contains("This reaches every Galley session"));
    }

    #[test]
    fn state_block_stays_out_of_static_rules_and_hash() {
        assert!(!RUNTIME_PROMPT_STATIC.contains("## Galley State"));
        let hash_before = prompt_hash();
        let _ = compose_runtime_prompt("9.9.9");
        assert_eq!(prompt_hash(), hash_before);
    }

    /// 2026-09-09 incident: the model saved four files to `~/Downloads`,
    /// mentioned the directory once and listed bare filenames in a table,
    /// so none of them were click-to-open in the conversation. The rule
    /// is shared runtime behavior (workbench and IM alike).
    #[test]
    fn file_references_rule_asks_for_full_paths_on_every_surface() {
        for prompt in [
            compose_runtime_prompt("0.0.0-test"),
            compose_im_runtime_prompt("0.0.0-test"),
        ] {
            assert!(prompt.contains("## Files You Create"));
            assert!(prompt.contains("`~/Downloads/report.csv`"));
            assert!(prompt.contains("bare filename"));
        }
    }

    #[test]
    fn suggestion_mandate_is_workbench_only() {
        // The tag is consumed by the GUI composer alone; a mandate in the
        // IM composition leaks it verbatim into chat replies (2026-08-13
        // Discord/Feishu dogfood).
        let workbench = compose_runtime_prompt("0.0.0-test");
        assert!(workbench.contains("## Next-Step Suggestion"));
        assert!(workbench.contains("<next-suggestion>"));
        let im = compose_im_runtime_prompt("0.0.0-test");
        assert!(!im.contains("next-suggestion"));
        // Both variants still carry the shared runtime rules + state block.
        assert!(im.starts_with(RUNTIME_PROMPT_STATIC));
        assert!(im.contains("## Galley State"));
    }

    #[test]
    fn im_supervisor_prompt_names_current_platform() {
        let wechat = im_supervisor_prompt("/tmp/sop.md", "wechat", "galley-im/wechat");
        assert!(wechat.contains("## Galley IM Entry Layer"));
        assert!(wechat.contains("through WeChat"));

        let feishu = im_supervisor_prompt("/tmp/sop.md", "feishu", "galley-im/feishu");
        assert!(feishu.contains("through Feishu"));
        assert!(feishu.contains("the same assistant as in Galley's desktop app"));
    }

    #[test]
    fn im_supervisor_prompt_names_discord() {
        let discord = im_supervisor_prompt("/tmp/sop.md", "discord", "galley-im/discord");
        assert!(discord.contains("through Discord"));
    }

    #[test]
    fn im_supervisor_prompt_template_defers_only_the_supervisor_id() {
        let template = im_supervisor_prompt_template("/tmp/sop.md", "discord");
        assert!(template.contains(SUPERVISOR_ID_PLACEHOLDER));
        assert!(template.contains(&format!("--supervisor={SUPERVISOR_ID_PLACEHOLDER}")));
        // Substituting the placeholder must reproduce the rendered
        // prompt exactly — the two paths may never drift apart.
        let channel_id = im_supervisor_id("discord/ch:123");
        assert_eq!(
            template.replace(SUPERVISOR_ID_PLACEHOLDER, &channel_id),
            im_supervisor_prompt("/tmp/sop.md", "discord", &channel_id)
        );
    }

    #[test]
    fn im_supervisor_prompt_pins_supervisor_identity() {
        let id = im_supervisor_id("feishu");
        assert_eq!(id, "galley-im/feishu");
        let prompt = im_supervisor_prompt("/tmp/sop.md", "feishu", &id);
        assert!(prompt.contains("--supervisor=galley-im/feishu"));
        assert!(prompt.contains("report request"));
    }

    /// IM is the same assistant reached from a phone (2026-10-06, JC). The
    /// orchestration details (waits, session questions, reversibility,
    /// timeouts) live only in the Supervisor SOP, which the entry layer
    /// sends the agent to before its first CLI write. They used to be
    /// copied into the entry layer too and drifted behind the SOP once;
    /// one home now, checked here against the SOP Galley materializes.
    #[test]
    fn im_supervisor_prompt_defers_orchestration_details_to_the_sop() {
        let prompt = im_supervisor_prompt("/tmp/sop.md", "feishu", "galley-im/feishu");
        // Single-line fragments only: a Windows checkout makes the raw
        // string CRLF, so a substring spanning a line break fails there.
        assert!(prompt.contains("Before your first Galley"));
        assert!(prompt.contains("read the Galley Supervisor SOP at /tmp/sop.md"));
        for moved in ["--after-turn", "--until-idle", "askPending", "live.busy"] {
            assert!(!prompt.contains(moved), "{moved} belongs to the SOP only");
        }
        let sop = crate::sop_install::sop_body();
        for rule in [
            "--after-turn=<turnCount>",
            "--until-idle",
            "`askPending`",
            "dispatch:\"queued\"",
            "`live.busy`",
            "Timeout is not failure",
            "are reversible",
        ] {
            assert!(sop.contains(rule), "SOP lost: {rule}");
        }
    }

    /// 2026-09-30 context bloat (`.scratch/im-supervisor-context-bloat/`):
    /// a 12-character message made the supervisor run `sessions list
    /// --runtime all --all` (658 -> 28574 context chars). Status checks use
    /// the plain list.
    #[test]
    fn im_supervisor_prompt_checks_status_with_plain_sessions_list() {
        let prompt = im_supervisor_prompt("/tmp/sop.md", "discord", "galley-im/discord");
        assert!(prompt.contains("use plain `sessions list`"));
    }

    /// Replies are read on a phone: 7 of 21 IM final answers in the
    /// 2026-09-30 logs were tables. No platform gets its own note: WeChat's
    /// once lost link targets and `1.` numbers in upstream's `_strip_md`,
    /// which Galley's handler (`runner/im_wechat.py`) no longer calls.
    #[test]
    fn im_supervisor_prompt_shapes_replies_for_a_phone() {
        for platform in ["wechat", "feishu", "telegram", "discord"] {
            let prompt = im_supervisor_prompt("/tmp/sop.md", platform, "galley-im/x");
            assert!(prompt.contains("No tables"));
            assert!(prompt.contains("Open with the answer"));
            assert!(!prompt.contains("write URLs bare"));
        }
    }

    /// Byte cap on the IM entry layer, same rule as
    /// `STATIC_PROMPT_BUDGET_BYTES`: set with no headroom on the longest
    /// platform variant (Telegram, the longest channel name), measured on the
    /// template with an empty SOP path so the user's state-root path does not
    /// count. `\r` is not counted. 1503 at the 2026-10-06 slimming, when
    /// WeChat carried a link note; lowered when the 2026-10-10 WeChat pass
    /// dropped it, and again (1383 → 1376) when Goal left the CLI write
    /// list on 2026-10-13.
    const IM_PROMPT_BUDGET_BYTES: usize = 1376;

    #[test]
    fn im_supervisor_prompt_stays_within_budget() {
        for platform in ["wechat", "feishu", "telegram", "discord"] {
            let len = im_supervisor_prompt_template("", platform)
                .bytes()
                .filter(|&byte| byte != b'\r')
                .count();
            assert!(
                len <= IM_PROMPT_BUDGET_BYTES,
                "{platform} IM prompt is {len} bytes, budget {IM_PROMPT_BUDGET_BYTES}: \
                 remove a clause first, or raise the budget with a reason"
            );
        }
    }
}
