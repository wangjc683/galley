# Managed GenericAgent Runtime

> Design and runtime reference for Galley's bundled / managed GenericAgent
> runtime. Attach-mode GenericAgent remains user-owned and non-invasive.

## Status

The managed runtime **shipped in v0.2.0** and is now the default main path for
ordinary users. Attach mode (an existing user-owned GenericAgent) is an advanced
compatibility entry. Fresh installs derive `managed`; installs with an existing
`ga_config.gaPath` derive `external`. See
[project status](./project-status.md) for the current release, GA baseline, and
update-channel state.

The M0–M9 milestones below were the implementation plan. They are shipped
(per-project-status, every milestone through M9 is complete); each milestone's
"Current implementation slice" records what landed. Treat this document as a
settled runtime reference plus invariants, not an open roadmap. The "Do not
build" items remain the forward guardrails. Managed runtime work must preserve
attach-mode behavior unless a task explicitly changes this document.

## Product Model

Ordinary users should experience this as Galley, not as "installing
GenericAgent." The onboarding path is:

```text
Configure Galley's model -> start using Galley
```

The primary path should ask for only one thing: model access. Users should not
choose a runtime, download an engine, edit config files, install Python, or
understand GenericAgent terminology before they can talk to Galley.

GenericAgent is the internal agent kernel for this mode. Users should not need
to know about GA checkout paths, `mykey.py`, Python, virtual environments,
dependencies, or GA memory layout.

Attach mode is an advanced compatibility path for users who already have their
own GenericAgent environment:

```text
Already have GenericAgent? Connect your existing environment.
```

This entry should be visually secondary. It exists to preserve power-user
control, not to split the first-run product in half.

## First-Run UX Contract

First run should feel like setting up a model, not setting up an agent runtime.

Required first-run fields:

```text
Provider / protocol preset
API key
Base URL
Model
```

Default first-run shape:

```text
One compact setup screen
Primary action: Test and start using Galley
Secondary text link: Already have GenericAgent?
Success destination: first Galley conversation, composer focused
```

Optional first-run behavior:

```text
Display name is auto-filled from model and not shown as a required first-run field
```

Everything else belongs behind advanced disclosure in Settings, not onboarding:
timeouts, retries, proxy, thinking controls, max tokens, generated GA config,
state paths, patch versions, and diagnostic runtime paths.

Good first-run feedback should tell the user what to do next:

```text
Key saved on this Mac. Testing model connection...
Connection works. Start using Galley.
```

Failed first-run checks should keep the user in the same flow, preserve their
inputs, name the failing field, and suggest the next action:

```text
The API key was rejected. Check the key, then try again.
The model endpoint did not respond. Check the base URL or choose another preset.
```

Bad first-run feedback exposes implementation:

```text
mykey.py generated
GenericAgent dependency check passed
NativeOAISession initialized
```

### First-Run Copy Direction

The setup screen should sound like Galley is helping the user connect a model,
not asking them to configure infrastructure.

Recommended Chinese copy:

```text
Title: 为 Galley 配置模型
Body: 填入你的模型 API Key 和 Base URL。
Provider label: 模型服务
Key label: 模型密钥
Base URL label: Base URL
Model label: 模型
Model helper: 自动获取模型列表，或手动填写模型名
Primary button: 测试并开始使用 Galley
Secondary link: 我已有 GenericAgent
Success: 配置完成，可以开始对话了。
```

Avoid copy that makes the user feel they are installing a developer tool:

```text
配置 GenericAgent
生成 mykey.py
选择 NativeOAISession
设置 runtime path
```

Interaction rules:

- Use one screen.
- First managed-runtime onboarding uses a Provider preset dropdown. It may
  expose official-brand shortcuts such as OpenAI, Anthropic, DeepSeek, Kimi,
  MiniMax, OpenRouter, SiliconFlow, Xiaomi MiMo, and GLM, plus protocol-family
  entries when useful.
- A fresh setup must not select a Provider implicitly. Show an explicit empty
  state such as "选择提供商" first, then fill the dependent Provider fields
  from the selected preset.
- Keep onboarding copy plain and low-friction. Settings can use the more precise
  terms `Provider` and `Model`, but first run should not make the user learn the
  Provider / Model data model before starting.
- Preserve all typed values on failure.
- The primary button stays disabled until Provider, API key, Base URL, and model
  are all filled.
- "自动获取模型列表" is an explicit helper action that fills the model field; it
  is not hidden behind the primary button.
- Test the connection before leaving onboarding. The UI may auto-test after all
  required fields are present, but save / continue should still require a
  verified connection.
- Say "model key" or "模型密钥" in first-run copy. Avoid the acronym "BYOK" in
  product UI.
- Never show generated config paths in first-run UI.
- Do not show advanced options in onboarding.
- Keep attach-mode entry visually secondary and label it for users who already
  know they have GenericAgent.

## Browser Control Capability

Managed / bundled GA users should see Browser Control as a core completion
item, not as an optional advanced setting. GA's `web_scan` and
`web_execute_js` capabilities depend on the `tmwd_cdp_bridge` Chromium
extension, and without it the intended Galley experience is materially
incomplete.

Galley cannot silently install a Chromium extension for ordinary users. The
product contract is therefore:

```text
Galley prepares the `tmwd_cdp_bridge` folder -> user opens the Chromium
extensions page -> user drags or loads that folder -> Galley tests the connection ->
Galley offers a simple browser demo
```

Rules:

- The extension shipped in managed GA code is the source payload only.
- Galley syncs it to a stable app-data directory before asking the user to
  load it. Do not ask users to load from inside the app bundle or from a
  developer checkout path.
- Galley must also prepare the extension config automatically. Upstream GA
  tutorials ask users to run GA once before installing the extension because
  that first run generates `tmwd_cdp_bridge/config.js`; in managed mode this is
  Galley's responsibility, not a user-facing prerequisite.
- If the stable extension directory or `config.js` is deleted, reopening Browser
  Control setup should recreate it before showing the browser installation
  steps. If preparation fails, keep the user at the first step and show a retry
  action instead of sending them to the browser.
- If a compatible GA Browser Control extension is already installed and Galley
  verifies the bridge successfully, treat the capability as ready. Do not ask
  the user to reinstall Galley's copy just to match the extension source path.
- The first supported browser family is Chromium. The UI provides one-click
  open buttons for Chrome and Edge, while copy should mention that other
  Chromium browsers can load the same unpacked extension manually. Safari and
  Firefox are out of scope for the first version because this bridge is
  Chrome-extension / CDP based.
- While Browser Control is missing, TopBar must keep a persistent, high-weight
  setup entry. The entry may use low-frequency motion, but should not use red
  error styling or repeated modal spam.
- On each app launch, Galley may show the setup dialog once until the
  connection is verified. Users can close it for the current session, but the
  TopBar entry remains visible.
- The success test must be deterministic and model-free: verify extension
  layout, bridge connection, tab discovery, and a minimal JavaScript execution
  such as reading `document.title`.
- Browser Control probes must tolerate Chromium MV3 service-worker wake-up and
  reconnect timing, especially on Windows. Do not collapse the probe window
  back to a few seconds unless the extension has an equivalent immediate
  wake-up path. Fast recovery should come from an in-worker retry while it is
  awake; `chrome.alarms` is only a 30-second-level fallback.
- After the test succeeds, Galley may offer a beginner demo. In Chinese UI,
  use Baidu for the weather-search demo to avoid making Google reachability
  part of the setup experience. The demo should validate the managed GA browser
  flow without adding a new GA tool or modifying extension source: managed GA
  must open new tabs through the existing `web_execute_js` extension protocol
  (`{"cmd":"tabs","method":"create",...}`), not page-level `window.open`,
  because Chromium may block non-user-gesture popups. Demo success or failure
  must not mutate the Browser Control connection status; that status belongs to
  the deterministic probe.
- A lightweight `图文指南` link may appear near the folder-install step and open
  the official Datawhale tutorial directly at the Chrome install section
  (`#_2-1-1-chrome-安装步骤`). It is an auxiliary visual guide, not a
  replacement for Galley's setup flow and not a bottom-row CTA. Avoid linking
  to the chapter top because the upstream prerequisites mention raw GenericAgent
  paths and "run GA once", both of which Galley handles for managed users.

Recommended Chinese copy:

```text
TopBar missing: 浏览器控制 · 待连接
TopBar ready: icon-only browser button, tooltip: 浏览器控制已可用
Setup title: 连接浏览器控制
Permission line: 安装后，Galley 可以读取和操作浏览器，并沿用你的登录态。
Ready line: Galley 已能读取和操作浏览器，并沿用你的登录态。
Connected evidence: 已连接浏览器 / 检测到 N 个可操作标签页
Reload action: 重新加载插件
Success demo: 试用浏览器控制
Demo tooltip: 让 Galley 打开浏览器并搜索天气
Demo prompt: 请打开百度，搜索今天的天气，并告诉我结果。不要用代码或外部 API 查询。
```

## Runtime Modes

Galley has two runtime modes.

```text
managed_ga
- Default path for new users.
- Galley owns the runtime code and model configuration.
- Galley may apply minimal managed-runtime patches.
- Galley Runtime Prompt applies.
- Sessions shown in the UI are managed-runtime sessions.

external_ga
- Advanced attach path for an existing user-owned GA checkout.
- User owns code, memory, SOP, skills, model config, venv, and behavior.
- Galley does not inject Galley prompt extensions or use Galley's model config.
- Sessions shown in the UI are external-runtime sessions.
```

Mode switching lives in Settings -> Runtime. Do not show a prominent runtime
toggle in the main workspace. The main UI does not need a managed-mode badge
because managed mode is the product default. When the user is in attach mode,
the sidebar should show a small "Existing GenericAgent" badge in a suitable
place and link to Settings -> Runtime.

When modes switch, the visible session list switches with the mode. This is
intentional: it reinforces that these are different agent kernels, not one
history with a different skin.

The first time a mode switch hides the previous mode's sessions, show a small
one-time explanation:

```text
Showing sessions for Existing GenericAgent. Galley sessions are still available
when you switch back.
```

## Session History

Store sessions in the same Galley database, tagged by runtime kind, but display
only the current mode's sessions by default.

Suggested session metadata:

```text
ga_runtime_kind: managed | external
ga_runtime_id: string
prompt_profile: string | null
```

Rules:

- Creating a session snapshots the current runtime kind.
- Restoring a session uses the runtime kind it was created with.
- Changing the default runtime only affects new sessions.
- External sessions do not silently migrate to managed runtime.
- Managed sessions do not silently migrate to external runtime.
- A future "Copy to Galley runtime" action can explicitly duplicate selected
  external history into a managed session, but v1 should not auto-convert.

## CLI Runtime Contract

Galley has not shipped a stable CLI release before managed runtime, so the CLI
can adopt the clean runtime contract from the start.

Rust Core owns a persisted current runtime:

```text
prefs.active_runtime_kind = managed | external
```

GUI mode switches update this value. CLI commands read it as their default
runtime context. If it has never been set, Galley derives the initial value
once:

```text
existing ga_config.gaPath -> external
otherwise                 -> managed
```

This preserves existing attach users after upgrade while making managed runtime
the default for fresh installs.

If the current runtime is not configured, CLI writes should fail with a specific
actionable error instead of falling back to another runtime:

```text
managed_model_not_configured # managed runtime has no usable model
managed_runtime_invalid      # managed runtime code/prompt layout is incomplete
ga_path_invalid              # external runtime path is invalid
runner_error                 # generic runtime setup incomplete
```

### Defaults

Session listing defaults to the current runtime:

```bash
galley sessions list
```

This is equivalent to:

```bash
--runtime=current
```

Explicit read scopes:

```bash
--runtime=current
--runtime=managed
--runtime=external
--runtime=all
```

`sessions search` and `llm list` should become runtime-aware before release if
we expose them prominently to supervisors. They are not part of the first
invisible-session prevention slice because they do not create work.

`session new` also defaults to the current runtime:

```bash
galley session new "task"
```

If the GUI currently shows Existing GenericAgent, this creates an external
session. If the GUI currently shows Galley, it creates a managed session. This
prevents the worst UX failure: an agent creates a session successfully, but the
user cannot see it in the current GUI mode.

Explicit cross-runtime creation is allowed only when requested:

```bash
galley session new "task" --runtime=managed
galley session new "task" --runtime=external
```

Supervisor SOPs should say: do not pass `--runtime` unless the user explicitly
asks to use another runtime. Let CLI follow the GUI's current mode.

### Existing Sessions

Commands that target an existing session id use that session's recorded runtime,
not the current runtime:

```bash
galley session send <id> "..."
galley session stop <id>
galley session archive <id>
galley session move <id> --to=<project-id>
galley llm set <id> "<llm-name>"
```

The session id is the user's explicit target. Dispatching by the session's own
runtime avoids accidentally applying managed model config to an external
session, or external GA config to a managed session.

### Output Shape

All session-facing CLI responses must include runtime metadata:

```json
{
  "runtimeKind": "managed",
  "runtimeLabel": "Galley"
}
```

```json
{
  "runtimeKind": "external",
  "runtimeLabel": "Attached GenericAgent"
}
```

If a command explicitly creates or mutates something in a non-current runtime,
the response should include a warning:

```json
{
  "warning": {
    "id": "non_current_runtime",
    "message": "session created outside the current GUI runtime",
    "currentRuntimeKind": "external",
    "requestedRuntimeKind": "managed"
  }
}
```

If GUI receives a non-current session-created event, it should show a small
toast that tells the user where the session went and how to see it.

### Status

`sessions list` defaults to current runtime only. `status` should still avoid
hiding active work in another runtime. It can return current runtime detail plus
aggregate counts for other runtimes:

```json
{
  "activeRuntimeKind": "external",
  "current": { "running": 1, "idle": 8 },
  "otherRuntimes": [
    { "runtimeKind": "managed", "running": 1, "idle": 3 }
  ]
}
```

Supervisor agents should summarize current runtime first. If another runtime has
running work, mention it briefly and ask whether to inspect that mode.

## Model Configuration

Managed mode owns Galley's model configuration. Attach mode never uses it.

Onboarding and Settings should expose two protocol families:

```text
Anthropic-compatible
OpenAI-compatible
```

Users may add multiple Providers and multiple Models. Settings should make the
relationship explicit:

```text
Provider = protocol + API key + Base URL
Model    = one enabled model name under a Provider
```

This matters for providers such as OpenRouter: one API key and Base URL can back
many model names. The user should enter those credentials once, then add or edit
Models without retyping secrets.

Each Provider record should contain:

```text
id
displayName
protocol: anthropic | openai
apiBase
apiKeyRef
```

Each Model record should contain:

```text
id
providerId
displayName
model
advancedOptions
isDefault
```

First-run Provider preset dropdown:

```text
OpenAI
Anthropic
DeepSeek
Kimi for Coding
MiniMax
OpenRouter
SiliconFlow
Xiaomi MiMo
Zhipu GLM
```

These are UI shortcuts, not separate runtime families. They should still compile
down to one of the two protocol families unless there is a real protocol
difference.

First-run onboarding does not expose advanced model options. Galley owns good
defaults so the user can start without understanding GA tuning fields.

Recommended first-version defaults:

```text
Anthropic-compatible
- context_win: 90000
- thinking_type: adaptive
- temperature: 1
- max_retries: 3
- connect_timeout: 10
- read_timeout: 180
- stream: true

OpenAI-compatible
- context_win: 90000
- api_mode: chat_completions
- temperature: 1
- max_retries: 3
- connect_timeout: 10
- read_timeout: 180
- stream: true
```

Settings -> Models -> model edit exposes a folded Advanced section for
connection adaptation, not as a full `mykey.py` editor. First-version exposed
fields are `max_retries`, `read_timeout`, `stream`, OpenAI-compatible
`api_mode` / `reasoning_effort`, and Anthropic-compatible `thinking_type`,
`reasoning_effort`, and `fake_cc_system_prompt` surfaced as "Claude Code
passthrough". `thinking_budget_tokens`, `max_tokens`, `temperature`,
`context_win`, proxy, TLS verify, user agent, and mixin/fallback stay hidden
until there is a concrete product flow for them. Leave `reasoning_effort` unset
by default unless a provider preset later has a clear product reason to set it.

Unsigned beta builds store API keys as encrypted payloads in Galley's SQLite
database. The database also stores the local encryption key so app-data backups
and machine moves preserve model credentials with the rest of the managed model
configuration.

This is a UX-first beta tradeoff, not a system credential-store boundary. It
protects generated config, diagnostics, logs, and casual DB browsing from
plaintext keys, but someone with the full Galley database can decrypt managed
model API keys. Signed builds can later migrate these rows to macOS Keychain /
Windows Credential Manager.

Official GenericAgent expects a user-owned `mykey.py` or `mykey.json` with
plain-text `apikey` values. That is acceptable for attach mode because the user
owns that GA checkout and its security tradeoffs. It is not the managed-mode
product contract.

Managed mode must not persist real API keys in generated GA-compatible config.
If Galley needs to generate a managed-only `mykey.py` or equivalent config, it
should contain only non-secret metadata and a key reference. At session start,
Galley resolves the key reference from the local encrypted credential store and
injects the secret into the managed runtime in memory.

Cold start, sidebar rendering, Settings list rendering, and passive diagnostics
may check whether an encrypted credential row exists, but must not decrypt or
display real API key values. Secret decrypts are lazy and user-initiated:
connection tests, model-list fetches, and starting a managed session. Saving and
deleting a Provider secret write or remove the encrypted row.

Recommended managed records:

```text
managed_model_providers
- id
- displayName
- protocol: anthropic | openai
- apiBase
- apiKeyRef        # reference only; not the key

managed_models
- id
- providerId
- displayName
- model
- advancedOptions
- isDefault
```

Recommended secret flow:

```text
Onboarding / Settings
-> save non-secret Provider record to Galley DB
-> save encrypted API key payload to Galley DB under Provider apiKeyRef
-> save Model record that references the Provider
-> test model connection
-> start managed session with runtime-resolved secret
```

Editing an existing Provider may leave the API key field blank, meaning "keep
the saved key." Deleting a Provider deletes its Models and then removes the
Provider secret row from local encrypted storage. Deleting a Model never deletes a
Provider key.

The generated config path is an implementation detail. Users should not edit or
rely on it. Advanced diagnostics may show that a generated config exists, but
must not display API key values.

### ChatGPT / Codex OAuth

ChatGPT / Codex is a managed OpenAI-compatible provider with a different auth
contract from normal API-key providers:

- Core owns the OAuth access token, refresh token, expiry, and ChatGPT account
  id in the encrypted local credential store.
- Generated managed model config contains only `apiKeyRef`, Codex backend
  metadata, and credential IPC connection metadata; it never contains the
  refresh token.
- Managed GA asks Core for a short-lived access token over local credential IPC
  before Codex requests. The IPC response may include access token, account id,
  and expiry, but must never return the refresh token.
- Core refreshes access tokens behind a per-`apiKeyRef` async gate. It reads the
  credential before locking, reads again after locking, and reuses a token that
  another request already refreshed.
- Refresh responses may rotate the refresh token. If the response omits a new
  refresh token, Core preserves the previous refresh token.
- If JWT expiry is missing, Core may use OAuth `expires_in` as the expiry
  fallback.
- After refresh failure, Core may recover from a newer usable DB credential or
  from Codex CLI `auth.json`, but only when the ChatGPT account id is compatible
  with the credential that was being refreshed. It must not silently switch a
  running request to another account's quota or billing context.

The managed GA Codex backend uses Codex-specific request behavior: Responses
API endpoint under the ChatGPT Codex base URL, `store=false`, Codex user-agent
and `originator` headers, `ChatGPT-Account-ID` when available, forced streaming,
and no `max_output_tokens` field. If a configured Codex reasoning effort is
`minimal`, managed GA normalizes it to `medium`.

When Codex returns HTTP 429, Core connection tests and managed GA request
failures may query ChatGPT WHAM usage as a best-effort diagnostic. If usage
windows report a reset, show the latest reset among exhausted windows; if WHAM
is unavailable or malformed, fall back to the original quota/rate-limit error.
Never let the WHAM probe block or replace the original Codex failure path.

Do not expose non-native text-protocol sessions, mixin failover, IM bot config,
Langfuse, or arbitrary GA template fields in first-run onboarding. Those can
become advanced Settings later if there is real demand.

Managed Channels is the first advanced Settings exception. It lives under
Settings -> Channels, not Onboarding. WeChat keeps the user flow to: connect,
scan, chat. Feishu targets personal users and small teams: users create an
internal app in Feishu Open Platform, paste App ID / App Secret into Galley,
and Galley owns the process, state paths, bundled dependencies, managed model
config, and managed prompt injection.

WeChat token, QR image, and logs live under Galley's managed state
`managed-ga-state/im/wechat/`. The official GA default `~/.wxbot/token.json`
must not be used by Galley's managed launcher.

Feishu App Secret uses Galley's local encrypted secret store. Feishu media temp
files and logs live under `managed-ga-state/im/feishu/`; the managed launcher
injects app config into the child process and must not write `mykey.py` /
`mykey.json` into the bundled GA code payload or a user-owned external GA
checkout.

Attach mode never reads Galley's model records, and managed mode never reads the
user's external GA `mykey.py`. Keeping model ownership separate is part of the
trust boundary.

## Prompt Composition

Galley's prompt extension applies only in managed mode. Attach mode must
preserve the user's existing GA behavior.

Managed prompt composition should be explicit:

```text
GA core prompt
+ GA memory
+ Galley Runtime Prompt
```

The Galley Runtime Prompt stays compact. It gives managed GA enough user-facing
Galley context to answer product-background questions without turning the
runtime prompt into a persona layer:

- Galley is a local desktop workspace for AI agents: chat, local tasks, files,
  connected browser, sessions, projects, and configured local channels such as
  WeChat or Feishu.
- Galley is developed by JC Wang, an AI application builder with a philosophy
  background and interests in Wittgenstein, philosophy of language, and LLMs.
- The project page is `https://github.com/wangjc683/galley`.
- Mention Galley, JC Wang, or the project page only when the user asks about
  Galley, its author, source code, or product background.
- Do not invent exact current metadata such as version, release channel, model
  configuration, runtime mode, session state, project state, or available
  integrations. Use exposed Galley state when available; otherwise ask the user
  to check the relevant Settings page.

Browser Control guidance remains in the Runtime Prompt but should stay terse:
browser tasks use the real browser, new tabs use the existing `web_execute_js`
extension tab protocol rather than `window.open(...)`, and connection status is
owned by Galley's setup check. The prompt must also make clear that Browser
Control operates the user's connected Chrome / Edge / Chromium browser where
`tmwd_cdp_bridge` is installed, not a separate Galley-bundled Chromium browser.

Prefer a small extension seam in managed GA:

```text
GALLEY_RUNTIME_PROMPT_TEXT
```

External attach mode does not pass this prompt value.

Storage:

```text
core/src/managed_prompt.rs
```

Managed sessions may record `prompt_profile = galley-runtime-v1` for diagnostics,
but v1 does not need a user-facing selector or editor. The runtime prompt text is
embedded in Galley Core as Galley-owned managed-runtime behavior, not stored as
user-editable prompt content. Diagnostics expose the profile id plus
a short prompt hash for dogfood and support. Do not change `PROMPT_PROFILE_ID`
unless we explicitly want new sessions to be distinguishable by prompt
generation.

## Code And State

The managed runtime follows one central rule:

```text
Code is replaceable. State is user-owned.
```

Managed GA code is part of Galley's shipped product runtime. It may be replaced
when Galley updates to a newer upstream GenericAgent baseline plus the Galley
managed patch stack.

Managed GA state is user-owned Galley state. Runtime upgrades must not
overwrite it.

Normal managed GA upgrades are code-only. They should feel like a user-owned GA
checkout receiving `git pull`: the kernel code moves forward, while the user's
memory, SOP, skills, temp state, model responses, and generated model config
remain in place.

State migration is exceptional. It is only required when upstream GenericAgent
changes the format or location contract of user state. In that case, treat it as
a high-risk migration: back up first, document the upstream reason, and dogfood
with real managed-runtime state.

Compatibility note: migrations `021`-`024` are retained byte-for-byte from the
abandoned Galley Native experiment so dogfood databases that already applied
them can still pass SQLx migration validation after returning to main. Migration
`025` restores persisted `galley_native` runtime values back to `managed`.
Keeping these migration records does not re-enable the Rust native runtime on
main; it only protects local user state from a development downgrade trap.

Suggested layout:

```text
App Resources/
  managed-ga/
    manifest.json               # pinned upstream baseline + patch stack id
    code/                       # read-only managed GA code payload
    state-seed/
      memory/                   # upstream tracked GA memory/SOP defaults
    patches/
      manifest.md

Application Support/app.galley/
  galley.db
  managed-ga-state/
    memory/                   # the ONLY dir GA reads SOPs from
    sop/                      # vestigial: created but GA never reads it
    skills/                   # vestigial: created but GA never reads it
    temp/
    model_responses/
  managed-model-config/
    generated-mykey.py          # or model-config.json
```

> **SOP home is `memory/`, not `sop/` or `skills/`.** GenericAgent discovers and
> reads SOPs via `file_read ../memory/*.md` and the L1 index
> `global_mem_insight.txt`; there is no loader for a sibling `sop/` or `skills/`
> directory. A separate Galley-owned SOP directory was considered and rejected
> (see devlog 2026-06-03) because it changes upstream GenericAgent semantics and
> creates a second source of truth. New tooling that installs SOPs must write
> into `managed-ga-state/memory/`. The empty `sop/` and `skills/` entries above
> are vestigial layout shells and may be removed; do not treat them as a target
> for SOP content.

Initial setup may seed default state only when the target file or directory is
missing. Existing state must not be overwritten:

```text
if missing: create default
if exists: leave it alone
```

The default GA memory/SOP seed lives under app resources, but runtime reads and
writes still go through `managed-ga-state/memory/`. The seed is copied
missing-only so existing `global_mem.txt`, `global_mem_insight.txt`, custom SOPs,
skills, and edited memory files survive normal Galley updates.

## Patch Discipline

Managed GA can be patched, but Galley must not become a divergent GA fork.

Recommended source strategy:

```text
managed-ga/manifest.json        # pinned upstream baseline + patch stack id
managed-ga/code/                # generated code-only payload
managed-ga/patches/
  0001-managed-state-root.patch
  0006-managed-browser-control-recovery.patch
  ...                          # see patches/manifest.md for the full stack
managed-ga/patches/manifest.md
scripts/build-managed-ga.sh
```

Rules:

- Keep every patch small and product-scoped.
- Prefer upstream public APIs or config first.
- Prefer environment-variable or file-path extension seams before code edits.
- Document every patch with reason, touched upstream files, rebase risk, and
  removal condition.
- Patches must be replayable on top of a newer upstream baseline.
- If upstream provides the same capability, delete the Galley patch.
- Changes touching agent loop, tool protocol, memory semantics, or backend
  history shape are high risk and require a baseline audit.

### How To Add A Patch

Never edit `managed-ga/code/` directly. It is a generated payload: a direct
edit is silently discarded on the next baseline rebuild, and it bypasses the
patch ledger that makes the stack auditable and replayable. To change managed
runtime behavior:

1. Author the change as the next numbered **zero-context** unified diff in
   `managed-ga/patches/` (for example `0014-<slug>.patch`).
2. Record it in **both** ledgers: append the filename to
   `managed-ga/manifest.json` (`patchStack.patches`), and add a row to
   [`managed-ga/patches/manifest.md`](../managed-ga/patches/manifest.md) with
   reason, touched upstream files, rebase risk, and removal condition.
3. Verify the stack replays: `scripts/build-managed-ga.sh` regenerates
   `code/` from the pinned upstream baseline and applies every patch in
   manifest order via `git apply --unidiff-zero`.
4. Mind ordering dependencies between patches touching the same upstream
   file (for example, the fsapp patches rebase `0009` first); record them in
   the manifest row's rebase-risk column.

`managed-ga/patches/manifest.md` is the authoritative ledger for the current
stack, including the last verified replay date.

## Backup And Device Migration

Managed GA memory, SOP, skills, temp state, and model response state belong to
Galley-managed state and should be included in Galley backup / migration.

External GA memory, SOP, skills, venv, and model config belong to the user's
external GA checkout and are never included or modified by Galley unless the
user explicitly backs up that checkout outside Galley.

Ordinary Galley backup should not include API keys. On a new machine, restored
managed sessions and memory can appear, but the user should re-enter model
credentials.

Future encrypted export can include API keys behind an explicit migration
password, but that is out of scope for the first managed-runtime version.

## Implementation Plan

Build the first managed-runtime slice around the shortest path to a useful
conversation:

```text
Configure Galley's model -> start first managed session -> talk to the model
```

The plan below is ordered for implementation. Each milestone should be small
enough to review independently and should preserve attach-mode behavior.

### M0 · Contract Freeze

Goal: lock the product and architecture boundaries before code changes.

Scope:

- Keep this document and the project constitution aligned.
- Treat attach mode as non-invasive and managed mode as Galley-owned.
- Keep "for Galley, configure model" as the first-run product story.

Acceptance:

- `AGENTS.md` points managed-runtime work to this document.
- The document states that managed code is replaceable and managed state is not.
- The document states that Galley Runtime Prompt applies only in managed mode.

Do not build:

- Runtime switches in onboarding.
- Persona settings.
- Memory / SOP management UI.

Current implementation slice:

- This document, `AGENTS.md`, and the project constitution are aligned on the
  managed / attach boundary.
- The document states that managed code is replaceable and managed state is not
  (see "Code And State").
- The document states that the Galley Runtime Prompt applies only in managed
  mode (see "Prompt Composition", and M6 below).

### M1 · Runtime Identity And Session Separation

Goal: make runtime identity a first-class Galley concept before starting a
second GA kernel.

Scope:

- Add persisted `prefs.active_runtime_kind = managed | external`.
- Add session runtime metadata:
  - `ga_runtime_kind`
  - `ga_runtime_id`
  - `prompt_profile`
- Filter GUI session lists by the active runtime.
- Restore and mutate sessions through the runtime they were created with.

Acceptance:

- Existing attach users remain in external mode after upgrade.
- New installs default to managed mode.
- Initial runtime derivation is explicit: existing `ga_config.gaPath` means
  `external`; otherwise `managed`.
- Switching Settings -> Runtime changes the visible session list.
- Creating a session snapshots the current runtime kind.
- Existing-session commands use the session's recorded runtime kind.

Do not build:

- Cross-mode session merge.
- Automatic migration from external sessions to managed sessions.
- "Copy to Galley runtime" yet.

Current implementation slice:

- Migration `008_runtime_identity.sql` adds `prefs.active_runtime_kind`, the
  session columns `ga_runtime_kind` / `ga_runtime_id` / `prompt_profile`, and
  seeds the initial runtime by the documented derivation (`gaPath` → `external`,
  else `managed`).
- `prefs.active_runtime_kind` is read/written in `core/src/db/helpers.rs` and
  surfaced via `core/src/db/managed_model.rs`.
- Runtime kind is captured at session creation, carried on every session row,
  and used to filter the GUI session list and to dispatch existing-session CLI
  commands by the session's own runtime.
- Settings -> Runtime exposes the mode switch ("Galley" / "Attached GA"); the
  sidebar shows a runtime indicator.

### M2 · Managed Runtime Layout

Goal: package Galley-owned GA code without mixing it with user-owned state.

Scope:

- Add a pinned upstream GA baseline for the managed runtime.
- Add a replayable managed patch stack.
- Create managed code and managed state locations:
  - shipped code in app resources
  - mutable state in Galley Application Support
- Seed state only when missing.
- Add advanced diagnostics for managed code version, patch version, and state
  paths.

Acceptance:

- Managed runtime initialization never writes into an external GA checkout.
- Re-running initialization does not overwrite existing managed state.
- Diagnostics can show code version and state paths without exposing secrets.
- A normal Galley update can replace managed GA code while leaving state in
  place.

Do not build:

- A general plugin/runtime marketplace.
- Automatic upstream GA update outside Galley releases.
- State migration unless an upstream GA format change requires it.

Current implementation slice:

- `managed-ga/manifest.json` pins the audited upstream baseline (commit
  `b1e173dc`) plus a replayable `galley-managed-ga-patches-v1` patch stack
  (`0001`–`0010`), each documented in `managed-ga/patches/manifest.md`.
- `managed-ga/code/` is the generated code-only payload (no `mykey.py`,
  `memory/`, `skills/`, `temp/`, or `model_responses/`).
- `managed-ga/state-seed/memory/` holds the upstream-tracked GA memory/SOP
  defaults, copied missing-only into the live `managed-ga-state/memory/`.
- `scripts/build-managed-ga.sh` regenerates the payload by copying the baseline
  and reapplying `patches/*.patch`.
- Advanced diagnostics surface code version, patch stack, prompt readiness, and
  state paths without exposing secrets.

### M3 · Managed Model Config

Goal: let a non-technical user add a model without learning `mykey.py`, while
protecting API keys better than official GA's plain-file default.

Scope:

- Add managed model records in Galley DB with non-secret metadata only.
- Store API keys in encrypted SQLite rows for unsigned release builds.
- Use `apiKeyRef` in Galley DB and generated runtime config.
- Add model connection test before first conversation.
- Add Settings -> Runtime / Models management for adding, testing, renaming,
  and removing managed model entries.
- Ensure attach mode never reads Galley's model records.
- Ensure managed mode never reads the user's external GA `mykey.py`.

Current implementation slice:

- `managed_model_providers` and `managed_models` store Provider / Model
  metadata only.
- `managed_model_secrets` stores encrypted API key payloads keyed by
  `apiKeyRef`; `managed_model_secret_keys` stores the local encryption key
  so backups can restore credentials with the DB.
- Passive model/provider list APIs return credential status from encrypted row
  presence (`present` / `missing`) without decrypting API key values.
- `managed-model-config/managed-models.json` is generated with `apiKeyRef`
  values, never real API keys.
- Settings -> Models supports adding, listing, deleting, model-list fetch, and
  connection testing.
- First-run onboarding starts with "为 Galley 配置模型" and uses the same
  connection-test + save path before entering the empty composer.
- Managed model spawn failures surface actionable GUI copy that sends the user
  to Settings -> Models instead of exposing GA `mykey.py` language.

Acceptance:

- The database and generated config do not contain real API key values.
- Deleting an encrypted secret row makes the corresponding model fail with an
  actionable `managed_model_not_configured` / credential error.
- Galley backup includes encrypted managed model credentials and the local key;
  restored backups can use configured managed models without re-entering API
  keys.
- A user can complete first-run model setup without seeing `mykey.py`, Python,
  venv, GA checkout paths, or generated config.

Do not build:

- Encrypted key export.
- Provider marketplace.
- Arbitrary GA `mykey.py` template editing.
- First-run access to every GA model field.

### M4 · First-Run Onboarding

Goal: make a fresh Galley install usable immediately after model setup.

Scope:

- Show one compact setup screen: "为 Galley 配置模型".
- Ask only for Provider preset, model key, Base URL, and model.
- Keep Base URL required in first-run onboarding.
- Do not show advanced model options.
- Keep "我已有 GenericAgent" as a secondary entry into attach mode.
- Preserve input after failed tests.
- Route successful setup to the first Galley conversation with composer
  focused.

Acceptance:

- Fresh install enters managed onboarding by default.
- Fresh install starts with no Provider selected, so the user's first action is
  choosing the model provider they intend to connect.
- The primary action is "测试并开始使用 Galley".
- Successful setup routes to the empty composer with focus; the first managed
  session is created lazily when the user sends the first message.
- Failed setup names the failing field and suggests the next action.
- Onboarding copy does not mention GenericAgent setup internals.

Do not build:

- A multi-page setup wizard unless a provider truly needs it.
- Runtime education content.
- Advanced diagnostics inside onboarding.

Current implementation slice:

- First run opens one compact "为 Galley 配置模型" screen; the user picks a
  Provider preset, enters the model key, Base URL, and model, and the primary
  action is "测试并开始使用 Galley".
- Onboarding starts with no Provider selected and requires all four fields
  before enabling the primary action.
- A successful connection test routes to the empty composer with focus; the
  first managed session is created lazily on first send.
- "我已有 GenericAgent" remains the visually secondary entry into attach mode.

### M5 · Managed Conversation Path

Goal: run the first real managed GA conversation through Galley Core.

Scope:

- Extend Rust runner spawning to support managed runtime profiles.
- Pass managed code path, state path, model config path, and secret resolver
  context to the Python bridge.
- Start, restore, send, stop, and archive managed sessions through the same
  Galley Core authority as external sessions.
- Keep external runner spawning unchanged except for shared runtime metadata.

Current implementation slice:

- `managed-ga/code` is a generated, code-only GenericAgent payload copied from
  the pinned baseline. `mykey.py`, `mykey.json`, `memory`, `skills`, `temp`, and
  `model_responses` are excluded.
- `scripts/build-managed-ga.sh` reapplies `managed-ga/patches/*.patch` after
  copying the upstream baseline, so Galley-managed changes are replayable.
- `0001-managed-state-root.patch` redirects managed GA memory, temp, model
  response logs, `/continue` log lookup, and upstream Workspace
  temp/registry/anchor files to `GALLEY_GA_STATE_ROOT`.
- GUI bridge spawns now include `runtimeKind`; managed spawns are resolved in
  Rust Core to the managed code path, managed state path, managed model config
  marker, and in-memory model credential injection.
- CLI/socket `session.new` uses the created session's recorded runtime kind.
  This prevents the bad case where the GUI is showing one runtime while CLI
  creates invisible work in the other runtime.
- Managed bridge `ready` reports the pinned GA baseline from
  `managed-ga/manifest.json`, not the surrounding Galley git commit.

Acceptance:

- A fresh managed install can send a message and receive a streamed response.
- Managed sessions persist and restore after app restart.
- External attach sessions still work as before.
- Runtime errors identify whether the failure came from managed or external
  runtime.

Do not build:

- Cross-runtime failover.
- Running the same session against two runtime kinds.
- External GA mutation to make managed mode easier.

### M6 · Prompt Profile And Runtime Layer

Goal: add the managed Galley interaction layer without changing attach-mode
voice or policy.

Scope:

- Add managed prompt composition:
  - GA core prompt
  - GA memory
  - Galley Runtime Prompt
- Embed prompt text in Galley Core.
- Record `prompt_profile = galley-runtime-v1` on managed sessions.

Current implementation slice:

- Prompt text lives in `core/src/managed_prompt.rs`.
- Managed runtime diagnostics expose `promptProfileId` plus a short
  `promptHash`, not prompt file paths.
- Rust Core passes `GALLEY_RUNTIME_PROMPT_TEXT` only for managed spawns.
- The Python bridge reads that managed-only env value and appends it as
  `backend.extra_sys_prompt`, after GA's core prompt and memory.
- The managed IM channel launcher adds a short `GALLEY_IM_SUPERVISOR_PROMPT_TEXT`
  Galley IM Entry Layer for IM dispatch behavior. It does not inject the full
  Supervisor SOP on every turn.
- Rust Core also passes `GALLEY_SUPERVISOR_ID` (`galley-im/<platform>`), the
  stable identity the entry layer mandates on every CLI write and the
  completion reporter (`runner/im_reporter.py`) filters delegated sessions by.
- Rust Core materializes the bundled Supervisor SOP as a Galley-owned reference
  file for the IM agent to read when orchestration rules are needed.
- `prompt_profile` defaults to `galley-runtime-v1` for managed sessions at the
  DB insertion boundary. External sessions keep `prompt_profile = null`.

Acceptance:

- Managed sessions receive Galley Runtime Prompt.
- External sessions receive no Galley prompt extension.
- Prompt files are visible in advanced diagnostics but not editable in v1 UI.
- Runtime instructions remain narrow and do not override GA tool protocol,
  approval policy, safety constraints, or user instructions.

Do not build:

- Persona editor.
- Persona marketplace.
- Per-session persona switching.

### M7 · CLI Runtime Contract

Goal: prevent Agent / Supervisor CLI use from creating invisible work in the
wrong runtime.

Scope:

- Make CLI default to `prefs.active_runtime_kind`.
- Add explicit `--runtime=current|managed|external|all` where needed.
- Include `runtimeKind` and `runtimeLabel` in session-facing CLI output.
- Add warnings when a CLI command explicitly creates or mutates a non-current
  runtime.
- Make writes fail with actionable errors when the selected runtime is not
  configured.

Acceptance:

- If GUI is in attach mode, `galley session new` creates an external session by
  default.
- If GUI is in managed mode, `galley session new` creates a managed session by
  default.
- Existing-session commands dispatch by the session's own runtime metadata.
- No successful CLI command creates a session that is invisible in the current
  GUI mode unless the caller explicitly passed a non-current runtime.

Do not build:

- Backward compatibility for unreleased CLI behavior.
- A separate CLI-only runtime preference.
- Silent fallback from one runtime to another.

Current implementation slice:

- `galley sessions list` now accepts
  `--runtime=current|managed|external|all`; default `current` reads
  `prefs.active_runtime_kind`, so CLI sees the same session set as the GUI.
- `galley session new` accepts `--runtime=current|managed|external`; default
  `current` captures the GUI active runtime before the DB transaction.
- `session.new` socket handling accepts optional `runtimeKind`, preflights the
  selected runtime before inserting rows, and only commits the session/message
  after runtime configuration is usable enough to spawn.
- Settings -> Runtime exposes `Runtime Mode` with `Galley` and `Attached GA`.
  Switching mode persists `prefs.active_runtime_kind`, clears the active
  session, and reloads the sidebar with that runtime's session history.
- Composer and Command Palette model pickers are runtime-aware: managed mode
  reads Galley's usable managed model records, while attach mode continues to
  read the external GA model cache from bridge `ready` events.
- Session model persistence uses stable identity, not just list position:
  managed sessions store `managed_models.id`; external sessions store the raw
  GA LLM name. The numeric index is retained only to talk to the current
  bridge and to migrate old rows.
- New session-facing output includes `runtimeKind` and `runtimeLabel` alongside
  the existing `gaRuntimeKind` / `gaRuntimeId` fields.
- Explicit cross-runtime `session new` returns a structured
  `non_current_runtime` warning in the success envelope.

Open item:

- The socket layer resolves and attaches `runtimeLabel` ("Galley" / "Attached
  GenericAgent") to every session brief, and the GUI renders it. The Rust CLI,
  however, currently emits `runtimeKind` in its session output but does not emit
  `runtimeLabel` in its own JSON wrapper (`cli/src/session.rs`). Surfacing the
  label in CLI session output is the remaining M7 detail against the
  "All session-facing CLI responses must include runtimeKind and runtimeLabel"
  contract above.

### M8 · Backup, Upgrade, Diagnostics, And Release Gates

Goal: make managed runtime reliable enough to ship as the default path.

Scope:

- Include managed sessions and managed GA state in Galley backup.
- Exclude API keys from ordinary backup.
- Verify code-only managed GA upgrade behavior.
- Add advanced diagnostics for runtime mode, code version, patch stack, state
  location, and generated model config status.
- Add attach-mode preservation tests and managed-mode smoke tests.

Acceptance:

- Galley backup restores managed sessions and managed state.
- A restored backup on a new machine preserves encrypted managed model
  credentials for unsigned release builds.
- Managed GA code can be replaced without overwriting memory, SOP, skills,
  temp state, or model responses.
- Existing attach users do not see changed GA behavior after upgrade.
- Release verification includes both managed and attach runtime smoke paths.

Do not build:

- Memory management UI.
- Encrypted all-in-one migration export.
- Automatic external-GA import.

Current implementation slice:

- Existing Galley pre-migration backup copies the whole app data directory, so
  managed sessions, `managed-ga-state/`, non-secret `managed-model-config/`,
  and encrypted managed model credentials in `workbench.db` are included.
- Plaintext API keys are never written to generated config, diagnostics, or
  backup sidecar files. The unsigned release DB contains both encrypted payloads
  and the local key by design.
- Settings -> Runtime -> Advanced Diagnostics now shows active runtime mode,
  managed GA baseline, patch stack, code/prompt readiness, state path,
  configured managed model metadata, and generated non-secret config presence.
- Diagnostics never display plaintext API keys.
- Rust release-gate tests verify that managed runtime layout preserves existing
  state files and that the shipped `managed-ga/code` payload excludes
  user-state artifacts such as `mykey.py`, `memory/`, `skills/`, `temp/`, and
  `model_responses/`.
- Managed spawns set `PYTHONDONTWRITEBYTECODE=1` so dev dogfood and packaged
  runtime execution do not write Python bytecode caches into the managed code
  payload.
- Release-gate tests also reject generated source-tree artifacts such as
  `.DS_Store`, `__pycache__/`, and `*.pyc` under `managed-ga/code`.

### M9 · Packaged Runtime Release Gate

Goal: make sure the managed runtime that works in dev is the same runtime that
ships inside the app bundle.

Scope:

- Verify `core/tauri.conf.json` bundles `../managed-ga` as app resource
  `managed-ga`.
- Verify `core/tauri.conf.json` bundles the Galley CLI as a Tauri
  `externalBin`, so packaged GUI startup can write the Supervisor discovery
  file and Agent / Supervisor users get the same CLI path as the GUI runtime.
- Verify `managed-ga/manifest.json` pins an upstream commit and lists the
  replayable patch stack.
- Verify required runtime files exist:
  - `managed-ga/code/agentmain.py`
  - `managed-ga/code/agent_loop.py`
  - `managed-ga/code/llmcore.py`
  - `managed-ga/patches/manifest.md`
- Reject generated, local, or secret-bearing artifacts in the managed code
  payload:
  - `.DS_Store`
  - `__pycache__/`
  - `*.pyc`
  - `.git/`
  - venv directories
  - `.env`
  - `auth.json`
  - `mykey.py`
  - `mykey.json`
  - root user-state directories such as `memory/`, `skills/`, `temp/`, and
    `model_responses/`

Acceptance:

- Local release-prep can run `node scripts/check-managed-ga-payload.mjs`.
- Local package-prep can run
  `node scripts/check-managed-ga-app-bundle.mjs <Galley.app>`.
- `check.yml` runs the managed GA payload gate on macOS and Windows.
- `release.yml` runs the same gate before `tauri build`, so bad payloads fail
  before artifacts are uploaded.
- `release.yml` prepares the CLI sidecar before Cargo / Tauri validation and
  runs the app-bundle gate on macOS artifacts before upload.
- The packaged `.app` contains:
  - `Contents/MacOS/galley`
  - `Contents/Resources/runner/`
  - `Contents/Resources/python/`
  - `Contents/Resources/managed-ga/`
- The gate does not inspect or require API keys.
- The gate is structural; it does not replace real managed-mode dogfood.

Do not build:

- A dynamic upstream GA downloader.
- A runtime marketplace.
- A production package-size optimizer unless measured bundle size becomes a
  release blocker.

Current implementation slice:

- `scripts/check-managed-ga-payload.mjs` parses `tauri.conf.json` and
  `managed-ga/manifest.json`, verifies required files and patch entries, and
  recursively rejects generated / local / secret / user-state artifacts.
  It also verifies `state-seed/memory` contains the critical GA memory/SOP
  defaults and does not contain generated long-term memory files.
- `scripts/prepare-cli-sidecar.sh` builds `galley-cli` for the target triple
  and places it at the Tauri `externalBin` source path.
- `scripts/check-managed-ga-app-bundle.mjs` inspects the finished macOS
  `.app`, including the CLI sibling, managed runtime resources, and memory/SOP
  seed.
- `.github/workflows/check.yml` runs the payload gate after frontend lint and
  prepares the CLI sidecar before Cargo validation.
- `.github/workflows/release.yml` runs the payload gate after bundled Python is
  prepared, prepares the CLI sidecar before `tauri build`, and runs the
  app-bundle gate on macOS artifacts after packaging.

### Milestone Dependencies

Recommended execution order:

```text
M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8 -> M9
```

Useful parallelism:

- M2 and M3 can be partially developed in parallel after M1 schema direction is
  settled.
- M4 can start with mocked model records, but cannot ship before M3 credential
  storage and connection testing work.
- M7 can begin after M1, but its write-path verification needs M5.
- M8 should accumulate runtime reliability checks throughout.
- M9 is the final packaging gate before release ceremony / RC.

Avoid building a general runtime manager, provider marketplace, encrypted key
export, memory UI, persona UI, or cross-mode session copy before the first
managed conversation works end to end.

## Verification

Before shipping managed runtime, verify:

- New users can configure a model and start without seeing GA setup details.
- First-run UI does not mention `mykey.py`, Python, venv, GA checkout paths, or
  generated config.
- Existing attach users stay in attach mode after upgrade.
- Attach mode does not use Galley model config or Galley prompt extensions.
- Managed mode applies Galley Runtime Prompt.
- Switching modes changes the visible session list.
- Attach mode shows an "Existing GenericAgent" badge; managed mode does not need
  a runtime badge.
- Session restore uses the session's original runtime kind.
- Managed runtime upgrade replaces code without overwriting memory, SOP, skills,
  or other state.
- Galley backup restores managed sessions, state, and encrypted managed model
  credentials on a new machine for unsigned release builds.
- `node scripts/check-managed-ga-payload.mjs` passes locally and in CI.
