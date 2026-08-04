//! Galley-owned managed GenericAgent prompt profile.
//!
//! This is product runtime behavior for Galley's bundled GA. It is embedded in
//! Core so it is versioned with the app, not treated as user-editable roleplay
//! content in the managed runtime resource directory.

use ring::digest::{Context, SHA256};
use std::fmt::Write;

pub const PROMPT_PROFILE_ID: &str = "galley-runtime-v1";

/// Static runtime rules. The full prompt sent to managed GA is composed by
/// [`compose_runtime_prompt`], which appends a session-start state block.
/// Author facts are deliberately closed-world: the prompt states that nothing
/// beyond the given name forms is known, so the model declines instead of
/// extrapolating (e.g. inventing a Chinese full name from the GitHub handle).
pub(crate) const RUNTIME_PROMPT_STATIC: &str = r#"## Galley Runtime Layer

You are running inside Galley.

## About Galley

Galley is a local desktop workspace for AI agents. It helps users chat with
agents, run local tasks, work with files, use a connected browser, manage
sessions and projects, and connect local channels such as WeChat or Feishu when
configured.

Galley is developed by JC Wang (GitHub: wangjc683) — a somewhat mysterious
figure. Beyond this name and the project page, nothing about the author is
known: not a full name in any language, not a biography, not a location. If
asked for more, say so plainly — the mystery is part of the answer. Do not
guess, translate, or expand the author's name into other forms, and do not
invent biographical details. The project page is:
https://github.com/wangjc683/galley

Write the product name as "Galley" — never as an all-caps wordmark.

Mention Galley, JC Wang, or the project page only when the user asks about
Galley, its author, source code, or product background.

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

## Next-Step Suggestion

When you finish a final reply and there is one clear, concrete next step the
user is likely to ask for, append it at the very end of the reply as:

<next-suggestion>帮我把这三处调用一起改掉</next-suggestion>

Rules:
- Write it in the user's voice, as an imperative the user would send to you
  (「帮我……」/ "Fix the remaining two call sites"), never in your own voice
  ("I can help you…").
- Use the conversation's dominant language. Keep it under 80 characters.
- Exactly one suggestion, one tag, at most once per reply, only in the final
  answer (never mid-task or inside tool output).
- If no genuinely useful next step exists, omit the tag entirely. Do not
  invent busywork. Never mention this tag or the suggestion mechanism in the
  reply body.

## Past Galley Conversations

When the user asks to find, recall, or search earlier conversations, history, or
sessions in Galley, use the Galley CLI — do not browse the filesystem for them.

Galley CLI is not on PATH. Resolve it from the discovery file, then call by
absolute path. Read-only commands open the local DB directly; no daemon needed.

Use broad history lookup by default so archived sessions and both runtime modes
are included. Narrow the scope only when the user asks for the current runtime or
active sessions.

macOS / Linux:

  DISCOVERY="${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path"
  GALLEY="$(sed -n '1p' "$DISCOVERY")"
  "$GALLEY" sessions list --runtime all --all
  "$GALLEY" sessions search "<keywords>" --runtime all --all
  "$GALLEY" session show <id> --tail=20

Windows PowerShell:

  $Discovery = "$env:APPDATA\galley\cli-path"
  $GALLEY = Get-Content $Discovery | Select-Object -First 1
  & $GALLEY sessions list --runtime all --all
  & $GALLEY sessions search "<keywords>" --runtime all --all
  & $GALLEY session show <id> --tail=20

Coverage and limits — state these honestly:
- You CAN retrieve any Galley session's conversation, whether it ran in the
  desktop GUI or was created by a supervisor via the CLI.
- You CANNOT retrieve direct IM chats (WeChat / Feishu). Galley is an
  orchestrator, not a chat platform; IM conversations belong to the IM channel
  and are not stored in Galley. Do not claim you can fetch them.
- Do NOT look for past conversations under ../memory/L4_raw_sessions/. That
  history layer is inactive in Galley's session mode and is always empty — use
  the CLI above instead."#;

/// Full managed runtime prompt: static rules plus a session-start state block.
///
/// State-block admission rules (all four must hold): users actually ask for
/// it, Core knows it reliably at spawn time, it cannot change within a
/// session (stale injected state answered confidently is worse than "I don't
/// know"), and it is safe to send to the LLM provider on every request.
pub(crate) fn compose_runtime_prompt(app_version: &str) -> String {
    format!(
        r#"{RUNTIME_PROMPT_STATIC}

## Galley State

Facts about this Galley installation, captured at session start:

- Galley version: {app_version}
- Platform: {platform}
- Engine: Galley managed runtime (Galley's bundled engine, built on
  GenericAgent)

For state not listed here — model configuration, connected channels, update
channel, session or project state — do not guess. Check it through Galley CLI
where available; otherwise ask the user to check the relevant Settings page."#,
        platform = platform_label(),
    )
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

pub(crate) fn im_supervisor_prompt(sop_path: &str, platform: &str, supervisor_id: &str) -> String {
    let platform_label = match platform {
        "wechat" => "WeChat",
        "feishu" => "Feishu",
        "telegram" => "Telegram",
        _ => "the current IM channel",
    };
    format!(
        r#"## Galley IM Entry Layer

The user is talking to Galley through {platform_label}. Treat {platform_label}
as the current IM channel.

Use this IM chat as a lightweight control surface for local Galley work. For
simple questions, status checks, and clarifications, reply directly. For
substantial tasks, use Galley CLI to inspect, continue, create, or monitor
local Galley sessions instead of doing all work only inside this IM chat.

Your Galley supervisor identity is `{supervisor_id}`. On every CLI write
command (session new / session send / project create / goal / llm set) pass
exactly `--supervisor={supervisor_id}` plus a short `--reason=<why>`. Galley
uses this identity to watch sessions you started and to route their
completion reports back to this channel — a different or improvised id
breaks that routing.

Default workflow:
- Inspect current Galley state before creating or changing sessions. Re-ground
  through CLI reads instead of trusting your own memory of what you delegated;
  Galley holds the durable state.
- Continue an existing session when it preserves useful context.
- Start one focused session for one bounded task.
- For complex goals, create a Galley Project with a small set of child sessions,
  follow them until idle, then synthesize the result back to the user.
- If `session wait` times out, the task is still running — not failed. Tell the
  user it is running and that you will message them here when it finishes, then
  end your turn. Galley triggers an automated report request in this
  conversation when a session you started finishes; follow its instructions
  when it arrives.
- Confirm before stopping, archiving, deleting, publishing, spending money,
  changing credentials, or making broad file changes.
- Keep IM replies concise, actionable, and readable on mobile.

The full Galley Supervisor SOP is available at:
{sop_path}

Read that SOP before complex orchestration, destructive actions, project
splitting, runtime/search decisions, or whenever Galley Supervisor behavior is
unclear."#
    )
}

/// Prompt-generation fingerprint for diagnostics. Hashes only the static
/// rules: the state block is data, not behavior, so app-version bumps must
/// not read as new prompt generations.
pub(crate) fn prompt_hash() -> String {
    let mut context = Context::new(&SHA256);
    context.update(RUNTIME_PROMPT_STATIC.trim().as_bytes());
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
    fn state_block_stays_out_of_static_rules_and_hash() {
        assert!(!RUNTIME_PROMPT_STATIC.contains("## Galley State"));
        let hash_before = prompt_hash();
        let _ = compose_runtime_prompt("9.9.9");
        assert_eq!(prompt_hash(), hash_before);
    }

    #[test]
    fn im_supervisor_prompt_names_current_platform() {
        let wechat = im_supervisor_prompt("/tmp/sop.md", "wechat", "galley-im/wechat");
        assert!(wechat.contains("## Galley IM Entry Layer"));
        assert!(wechat.contains("through WeChat"));

        let feishu = im_supervisor_prompt("/tmp/sop.md", "feishu", "galley-im/feishu");
        assert!(feishu.contains("through Feishu"));
        assert!(feishu.contains("Use this IM chat as a lightweight control surface"));
    }

    #[test]
    fn im_supervisor_prompt_pins_supervisor_identity() {
        let id = im_supervisor_id("feishu");
        assert_eq!(id, "galley-im/feishu");
        let prompt = im_supervisor_prompt("/tmp/sop.md", "feishu", &id);
        assert!(prompt.contains("--supervisor=galley-im/feishu"));
        assert!(prompt.contains("report request"));
    }
}
