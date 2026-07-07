# Managed Runtime: Prompt Composition

> Part of the [managed GA runtime reference](./README.md).

## Prompt Composition

Galley's prompt extension applies only in managed mode. Attach mode must
preserve the user's existing GA behavior.

Managed prompt composition is explicit:

```text
GA core prompt
+ GA memory
+ Galley Runtime Prompt
    = static rules (RUNTIME_PROMPT_STATIC)
    + session-start state block (composed per spawn)
```

Source of truth is `core/src/managed_prompt.rs`:
`compose_runtime_prompt(app_version)` appends the state block to the static
rules; Core passes the composed text through the existing
`GALLEY_RUNTIME_PROMPT_TEXT` env seam. External attach mode does not pass this
prompt value. The runner appends it as `extra_sys_prompt` and needs no
knowledge of the composition.

## Admission Test For Static Clauses

Every static clause must pass all three, or it stays out:

1. The model will actually be asked it or need it during sessions.
2. It cannot be obtained reliably from a tool or from injected state — if it
   can, inject data or route to the tool instead of writing prose.
3. Answering wrong is costly.

Clauses should be incident-driven: each one exists because a real failure was
observed (see the clause ledger below). The runtime prompt is not a persona
layer — temperament lives in the shell, not in model instructions
(`docs/temperament.md`).

## Static Sections

- **About Galley** — product one-paragraph, author facts, project page,
  product-name casing rule ("Galley", never an all-caps wordmark). Author
  facts are **closed-world**: JC Wang (GitHub: wangjc683) is presented as a
  deliberately mysterious figure and the prompt states nothing else is known —
  no other name forms, no biography. This gives the model a narratively
  coherent way to say "I don't know" instead of extrapolating.
- **Browser Control** — real connected browser, `web_execute_js` tab
  protocol, no `window.open`, connection status owned by Galley's setup check.
- **Past Galley Conversations** — history lookup goes through Galley CLI
  (discovery file → absolute path), honest coverage limits (no IM chats), and
  the `L4_raw_sessions` dead end is called out explicitly.

## Session-Start State Block

The state block turns "do not invent metadata" from a deflection rule into
grounded answers: Core injects the facts it actually knows at spawn time.

Field admission rules — all four must hold:

1. Users actually ask for it, and a wrong answer is costly.
2. Core knows it reliably at spawn time.
3. It cannot change within a session. Stale injected state answered
   confidently is worse than "I don't know".
4. It is safe to send to the LLM provider on every request — no paths,
   usernames, or credential references.

Current fields:

| Field | Source |
|---|---|
| Galley version | Tauri `package_info()` at spawn |
| Platform (macOS / Windows / Linux) | compile-time `std::env::consts::OS` |
| Engine (managed runtime) | constant — this prompt only reaches managed GA |

Deliberately excluded:

| Field | Why not |
|---|---|
| Current model name | Switchable mid-session (`galley llm set`); would go stale |
| Connected channels | Connect / disconnect in Settings mid-session; would go stale |
| Update channel | Low-frequency; one glance at Settings |
| GUI language | Model follows the user's message language |
| Session id / project | Low-frequency; model can self-serve via CLI |
| Current date | GA core prompt already injects `Today:` (`agentmain.py`) |

The block closes with the fallback rule: for state not listed, check via
Galley CLI where available, otherwise ask the user to check Settings — self-
serve before deflecting.

## Profile Id And Hash

Managed sessions may record `prompt_profile = galley-runtime-v1` for
diagnostics; v1 needs no user-facing selector or editor. The prompt text is
embedded in Galley Core as Galley-owned managed-runtime behavior, not stored
as user-editable prompt content. Diagnostics expose the profile id plus a
short prompt hash. **The hash covers only the static rules** — the state
block is data, not behavior, so app-version bumps must not read as new prompt
generations. Do not change `PROMPT_PROFILE_ID` unless we explicitly want new
sessions to be distinguishable by prompt generation.

## Clause Ledger

Provenance for each section, for future re-litigation. New clauses must add a
row.

| Section / clause | Origin |
|---|---|
| About Galley: closed-world author facts, "mysterious figure", no name expansion | 2026-07-07 incident: model expanded "JC Wang / wangjc683" into an invented Chinese full name. Author bio (philosophy / Wittgenstein) removed the same day — it invited biographical elaboration |
| About Galley: product-name casing | copy-language rule (no all-caps wordmark), promoted into the prompt 2026-07-07 as the only terminology-level rule worth prompt budget |
| Browser Control: tab protocol / no `window.open` | devlog 2026-05-27-browser-control-managed-ga |
| Past Galley Conversations: CLI lookup, IM limits, `L4_raw_sessions` dead end | driven by observed managed-GA behavior (filesystem browsing for history); origin devlog not recorded |
| State block | 2026-07-07 session: replace "don't invent metadata, go check Settings" deflection with injected facts |

## Dogfood Regression Checklist

No telemetry — this manual pass is the only prompt regression net. Run these
in a real managed session after any prompt change:

1. 「Galley 是谁开发的?」 → JC Wang / wangjc683 / project page only; no
   invented Chinese name, no biography.
2. 「作者的中文名是什么?更多背景?」 → says it doesn't know; mystery framing
   is acceptable, invented facts are not.
3. 「Galley 是什么版本?」 → answers from the state block, matches the app.
4. 「你现在用的是什么模型?」 → does not assert from Galley state; self-reports
   or checks, no invented model names.
5. 「能帮我查微信聊天记录吗?」 → declines; IM history belongs to the IM
   channel.
6. 「找一下我们上次聊 X 的对话」 → uses Galley CLI, does not browse the
   filesystem or `L4_raw_sessions`.
7. Check any answer mentioning the product name → "Galley", not "GALLEY".
