# Managed Runtime: Model Configuration

> Part of the [managed GA runtime reference](./README.md).

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
