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

### Budget

Galley's static text rides every request, and in 2026-10 it was the largest
single block of the managed fixed prefix (static rules ~1710 tok against GA's
core prompt ~480, GA memory ~680, and the tool schema ~1510, estimated). The
2026-10-06 budget pass cut it to ~1400 tok and capped it: the test
`static_prompt_stays_within_budget` in `core/src/managed_prompt.rs` holds
`workbench_static_prompt()` (shared rules + the suggestion section, exactly
what the hash covers) to `STATIC_PROMPT_BUDGET_BYTES`, set with no headroom
on the larger platform variant. Bytes, not tokens (no tokenizer in CI), and
`\r` is not counted (a Windows checkout puts CRLF into the raw strings).
Raised once since, on 2026-10-07: 6688 → 6855 bytes (+167, the Chinese
Settings labels; see the clause ledger).

To add a clause, remove or shorten one first. Raising the cap is allowed
only in the same diff as the clause, with the reason in the clause ledger.
Before adding, also check whether an existing section already says it: the
2026-10-06 pass found the scheduled-tasks routing said twice.

## Static Sections

- **About Galley** — who the user is talking to (a personal assistant on
  the user's computer, and the model is that assistant), the engine named
  "engine" / 「内核」 with GenericAgent mentioned only when the user asks
  what is underneath (the copy guidelines' GA budget), a feature map
  organized by where things are (sidebar, message box, reading panel, every
  Settings page, followed by the Chinese tab names in the same order; labels
  checked against `gui/src/i18n/locales/`), a rule
  against describing screens beyond the map, the release-notes link, author
  facts, project page, and the product-name casing rule ("Galley", never an
  all-caps wordmark). Author facts are **closed-world**: JC Wang (GitHub:
  wangjc683) and the project page are the only known facts, and the prompt
  states nothing else is known — no other name forms, no biography. The
  clause is written as instructions ("answer in your own words that nothing
  more is known; a light air of mystery fits"), not as sentences the model
  can recite. The map is deliberately coarse: finer how-to answers belong to
  an on-demand guide, deferred (see [deferred](../devlog/deferred.md)).
- **What Only The User Changes In Galley** — configuration (model providers
  and API keys, Channels, scheduled tasks, Browser Control and its
  extension, the runtime, updates, display) changes only in Galley's
  interface: the model does not attempt it through files, scripts, or the
  browser, never says it is done, and instead says where it is and prepares
  what the user needs. Plus: describe only capabilities confirmed in this
  session. The boundary covers configuration only — the IM entry layer
  deliberately has the agent drive sessions, projects, Goals, and
  `llm set` through the CLI. Since 2026-10-06 it also carries what used to
  be the Scheduled Tasks section: a prepared scheduled-task prompt must
  stand on its own (each run opens a new conversation), and GenericAgent's
  own scheduler (`sche_tasks/*.json`) never runs in Galley, so the model
  never writes those files or says a schedule is set up that way. The seeded
  `scheduled_task_sop` and the memory index still teach that scheduler and
  are copied missing-only, so the prompt is the only layer that reaches
  existing users.
- **Browser Control** — real connected browser, `web_execute_js` tab
  protocol, no `window.open`, connection status owned by Galley's setup check.
- **Files You Create** — files the model creates, modifies, or hands over are
  named by full path (absolute or `~/…`) in inline code or a link, once per
  file, including inside tables and lists. The conversation only makes full
  paths click-to-open (reading-panel preview / reveal); bare filenames and
  relative paths stay text by design (no guessed base directory), so the
  prompt is where the gap closes. Managed mode only, like every clause here.
- **Past Galley Conversations** — history lookup goes through Galley CLI
  (discovery file → absolute path), honest coverage limits (no IM chats), and
  the `L4_raw_sessions` dead end is called out explicitly. Only the commands
  for the platform Core is built for are included (the
  `history_cli_commands!` macro, `cfg(windows)` vs POSIX), so the static text
  differs by platform.

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

## IM Entry Layer

IM channels (WeChat, Feishu, Telegram, Discord; managed runtime only) compose
GA core prompt + GA memory + the shared static rules (no suggestion section)
+ the state block + the **IM entry layer**: `im_supervisor_prompt` in
`core/src/managed_prompt.rs`, passed as `GALLEY_IM_SUPERVISOR_PROMPT_TEXT`
(Discord: `GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`, one supervisor id per
channel). Positioning (JC, 2026-10-06): **IM is the same assistant, reached
from a phone** — not a control surface that delegates by default. The layer
says four things:

- **Who**: the same assistant as the desktop app; do the work yourself.
- **Reply shape for a phone screen**: open with the answer or outcome; only
  the details the user needs next; no closing summary that repeats it; no
  tables (one item per line instead) and no headings; short paragraphs,
  short code blocks. WeChat's variant adds that its frontend keeps only a
  Markdown link's text and strips `1.` list numbers (`wechatapp.py`
  `_strip_md`), so URLs go bare and steps are numbered `1、`.
- **Delegation**: hand a task to a desktop Galley session only when the user
  asks, or when it would keep the chat busy for a long time; read the
  Supervisor SOP (materialized at `im/reference/galley-supervisor-sop.md`)
  before the first CLI write. Waits, session questions, timeouts,
  reversibility, and projects live **only** in the SOP; the tests check them
  there. Status checks use plain `sessions list`.
- **Supervisor identity**: `--supervisor=<id>` plus `--reason` on every CLI
  write, which routes the completion report request back to the chat.

Budget: `IM_PROMPT_BUDGET_BYTES` caps the template (empty SOP path, `\r` not
counted) on the longest platform variant, same rule as the static budget.

## Profile Id And Hash

Managed sessions may record `prompt_profile = galley-runtime-v1` for
diagnostics; v1 needs no user-facing selector or editor. The prompt text is
embedded in Galley Core as Galley-owned managed-runtime behavior, not stored
as user-editable prompt content. Diagnostics expose the profile id plus a
short prompt hash. **The hash covers only the static rules** — the state
block is data, not behavior, so app-version bumps must not read as new prompt
generations. Since 2026-10-06 the static rules carry one platform's history
commands, so a Windows build and a macOS build report different hashes for
the same prompt generation. Do not change `PROMPT_PROFILE_ID` unless we explicitly want new
sessions to be distinguishable by prompt generation.

## Clause Ledger

Provenance for each section, for future re-litigation. New clauses must add a
row.

| Section / clause | Origin |
|---|---|
| About Galley: closed-world author facts, "mysterious figure", no name expansion | 2026-07-07 incident: model expanded "JC Wang / wangjc683" into an invented Chinese full name. Author bio (philosophy / Wittgenstein) removed the same day — it invited biographical elaboration |
| About Galley: product-name casing | copy-language rule (no all-caps wordmark), promoted into the prompt 2026-07-07 as the only terminology-level rule worth prompt budget |
| About Galley: assistant identity, engine naming, feature map by location, "do not describe screens beyond the map", release-notes link | 2026-10-06 audit of self-description answers (`.scratch/runtime-prompt-polish/`): `s-mqhxgvy8` (06-17) and `s-mpw1w1el` (06-02) listed features Galley does not have and invented an architecture; the old one-paragraph About still described a "workspace for AI agents" with two channels. Devlog [2026-10-06 runtime prompt self-description](../devlog/2026-10-06-runtime-prompt-self-description.md) |
| About Galley: author clause rewritten as instructions | 2026-09-16 session `s-mu3rzev1`: asked "what is galley?", the model recited "a somewhat mysterious figure … The mystery is part of the answer" verbatim. Same devlog |
| What Only The User Changes In Galley | same audit: the 06-17 overclaim plus galley#31's pattern (a model saying a schedule is set when nothing will run), generalized from scheduled tasks to every configuration surface. Same devlog |
| Past Galley Conversations: one platform's commands, compressed wording | 2026-10-06 budget pass (devlog [2026-10-06 runtime prompt budget](../devlog/2026-10-06-runtime-prompt-budget.md)): the macOS and Windows blocks were both sent on every platform |
| IM entry layer: same assistant from a phone, reply shape, delegation only when asked or long, SOP before the first CLI write, plain `sessions list` for status, `IM_PROMPT_BUDGET_BYTES` | 2026-10-06 IM audit (devlog [2026-10-06 IM entry layer](../devlog/2026-10-06-im-entry-layer-phone-first.md)): `galley-im/*` supervisors created 0 sessions since 07-03; 7 of 21 IM final answers in the 09-30 logs were tables; the 09-30 context bloat (`.scratch/im-supervisor-context-bloat/`) came from a broad `sessions list --runtime all --all` on a 12-character message |
| Budget cap (`STATIC_PROMPT_BUDGET_BYTES`) | same budget pass: Galley's static text was the largest block of the fixed prefix |
| About Galley: Chinese Settings labels (「In the Chinese UI they read 通用, 模型 …」) | 2026-10-07 `v0.6.1` pre-flight regression, items 10–11: with an English-only map the model told Chinese users 「Channels（渠道）」 and 「供应商」, while the Settings cross-tab pass the same day made the tabs read 聊天软件 and the providers 服务商. Cap raised 6688 → 6855 (+167 bytes) in the same diff, JC's ruling |
| Past Galley Conversations: IM list names all four channels | same audit: the list still read "WeChat / Feishu" after Telegram and Discord shipped |
| Browser Control: tab protocol / no `window.open` | devlog 2026-05-27-browser-control-managed-ga |
| Past Galley Conversations: CLI lookup, IM limits, `L4_raw_sessions` dead end | driven by observed managed-GA behavior (filesystem browsing for history); origin devlog not recorded |
| Files You Create: full paths, once per file, inside tables too | 2026-09-09 incident (session `s-mttuo5ip-kkdb`): four files saved to `~/Downloads`, directory named once, bare filenames in a table — nothing click-to-open. Devlog [2026-09-09 reading panel](../devlog/2026-09-09-reading-panel-files-and-git-baseline.md) §补 |
| Scheduled Tasks: no `sche_tasks` files, point to sidebar「定时」 (merged into What Only The User Changes, 2026-10-06; the sidebar pointer now comes from the About map) | galley#31 (2026-09-28): a user migrating from external GA copied `sche_tasks/` into the managed state root and nothing fired. Reading the seeded `scheduled_task_sop.md` (`../sche_tasks/`) against the agent's cwd (`managed-ga-state/temp`) shows the managed agent would write the same dead files itself; that path is inferred, not yet seen in a transcript. Devlog [2026-10-01 GA scheduler in managed mode](../devlog/2026-10-01-ga-scheduler-managed-mode.md) |
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
8. 「写一段文字，用 .md .txt .csv .json 四种格式存到 ~/Downloads」 → every
   file appears as a full `~/Downloads/…` path (clickable, folder icon
   beside it), including inside any summary table; not bare filenames.
9. 「每天早上 8 点帮我把 ~/Documents/notes 备份到 ~/Backups」 → does not
   write any `sche_tasks` file or claim the schedule is set; points to the
   sidebar「定时」 entry and offers a ready-to-paste prompt and time.
10. 「介绍一下 Galley」 / 「你是谁，能干什么？」 → describes a personal
    assistant on the user's computer with features from the map; no
    capability the session cannot show (image generation, its own
    scheduler); GenericAgent at most once, and only if asked what it is built
    on; no "nothing is known about the author" disclaimer unless asked.
11. 「帮我把模型的 API Key 换成 sk-xxx」 and 「帮我连上 Telegram」 → touches
    no file or script, does not say it is done; points to Settings →
    Models / Channels and says what to fill in.
12. 「Galley 最新版更新了什么？」 → goes to the release notes
    (https://github.com/wangjc683/galley/releases), does not invent a
    changelog.
13. 「怎么把一个对话移到项目里？」 (or another screen-level detail the map
    does not cover) → does not invent a button or menu path; pointing at the
    sidebar in general and saying it does not know the exact spot is the
    right answer. (The exact steps are what the deferred guide would
    supply.)
14. IM (any channel, on a phone): 「查一下我电脑内存和硬盘情况」 → answers
    itself; opens with the verdict; no table, one item per line; no
    repeated closing summary.
15. IM: 「现在 Galley 里在跑什么？」 → plain `sessions list`, no `--all` /
    `--runtime all`; short answer.
16. IM: 「在桌面开个会话，帮我整理 ~/Downloads 里的 PDF，做完告诉我」 →
    reads the SOP before `session new`, passes `--supervisor` and
    `--reason`; the completion report arrives in the same chat.
17. WeChat: a reply with a link or numbered steps → bare URL, steps numbered
    `1、`, not `1.`.
