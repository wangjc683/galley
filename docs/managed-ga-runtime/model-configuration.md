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
presetOptions       # preset-layer baseline written at creation
advancedOverrides   # this model's deviations; JSON null = tombstone
advancedOptions     # effective = presetOptions ⊕ defaults ⊕ advancedOverrides
isDefault
```

Advanced options are layered (since 2026-09-22, migration 042; authority:
`core/src/managed_model_layers.rs`). A single user-owned defaults object
lives in `prefs.managed_model_defaults` and may only hold the six
protocol-agnostic keys (`max_retries`, `read_timeout`, `max_retry_after`,
`trim_keep_prefix`, `stream`, `reasoning_effort`); protocol-dialect keys
(`api_mode`, `thinking_type`, `fake_cc_system_prompt`, `codex_backend`) stay
in the preset layer or a model's overrides. The runtime, the connection
probe and the composer effort pill only ever read the effective
`advancedOptions`.

First-run Provider preset dropdown:

```text
ChatGPT           (Sign in with ChatGPT, no key)
OpenAI            (official API)
Anthropic         (official API)
DeepSeek
Kimi for Coding
MiniMax
OpenRouter
SiliconFlow
Xiaomi MiMo
Zhipu GLM
Custom            (any OpenAI- or Anthropic-compatible endpoint; protocol chosen in the card)
```

These are UI shortcuts, not separate runtime families. Custom (2026-10-01,
galley#32) is the neutral entry for relays, other vendors and local servers:
empty URL and model, the chosen protocol's defaults, no first-party options.
A new provider's first model takes its preset layer from the final URL (the
matching shipped preset, else protocol defaults), so an official card repointed
elsewhere behaves exactly like Custom. They should still compile
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
- presetOptions      # column preset_options
- advancedOverrides  # column advanced_options (overrides since 042)
- isDefault

prefs
- managed_model_defaults   # JSON object, the defaults layer
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

### ChatGPT (Sign in with ChatGPT)

The ChatGPT provider runs on the user's ChatGPT plan through Galley's own
Sign in with ChatGPT (SIWC) client (`core/src/chatgpt_siwc/`; product rulings
and probe findings in `.scratch/chatgpt-siwc/PRD.md`). Galley registers its own
OAuth client and spends the user's plan usage through `api.openai.com`. It is
the provider's only sign-in: the Codex CLI login that came before it (it
borrowed the Codex CLI's OAuth client and talked to `chatgpt.com`) was removed
on 2026-10-20 (PRD decision 5, ticket 05). The data values it introduced stay:
provider `mp_chatgpt_codex`, model record `mm_chatgpt_codex_gpt_55`, auth kind
`chatgpt_codex_oauth`. A stored credential counts only when it carries
`"flow": "siwc"`.

What sets it apart from an API-key provider:

- Core owns the access token, refresh token and expiry in the encrypted local
  credential store. The generated managed model config contains only
  `apiKeyRef`, the ChatGPT backend options and the credential IPC connection
  metadata, never a token.
- Managed GA asks Core for a short-lived access token over the local credential
  IPC (`core/src/credential_ipc/`) before each request. The reply carries the
  access token and its expiry, never the refresh token.
- The engine sends a Codex-shaped Responses request (`{api_base}/responses`,
  `store: false`, forced streaming, no `max_output_tokens`); a configured
  `minimal` reasoning effort is raised to `medium`.

In detail:

- **Sign-in**: authorization code + PKCE (S256) + `state` + `nonce` against
  `https://auth.openai.com/api/accounts/authorize`, `resource` and
  `redirect_uri` as below, scope
  `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
  The first sign-in on an installation registers a client
  (`client_id=dynamic_agent_client`, `agent_name_hint=Galley`); later ones
  re-use the issued client id with `id_token_hint`. Every request carries
  `ext_agent_host_id`, a `urn:uuid:<v4>` created once per installation.
  A sign-in that re-used the saved client and ends without a callback (timed
  out, cancelled, or replaced by a newer one) forgets that client and its ID
  token but keeps the host id, so the next sign-in registers afresh — a client
  disconnected in ChatGPT settings never redirects back, and a plain cancel
  paying for one extra registration is the accepted cost.
- **Loopback callback**: the redirect goes to `http://127.0.0.1:<port>/auth/callback`
  on an ephemeral port — the narrow Rule 2 exception in `AGENTS.md`. The
  listener lives only while that sign-in is pending (10 minutes, cancellable,
  a newer sign-in cancels it), answers 404 to any other method or path and
  400 to a wrong `state` without counting either, and closes after the one
  callback whose `state` matches. That callback gets a short static page.
- **Token exchange and ID token**: the code is exchanged with the client id
  the callback names (`oaiapp_…`), `code_verifier`, the same `redirect_uri`
  and `resource=https://api.openai.com/v1`. The ID token is verified with
  RS256 against `https://auth.openai.com/.well-known/jwks.json` (key by `kid`,
  `ring`), then `iss`, `aud` (the issued client id), `exp` and `nonce`. A
  grant without `chatgpt.tokens.use.direct` keeps the registration, revokes
  the unused refresh token and fails with `chatgpt_plan_usage_not_granted`.
- **Storage**: the credential lives in the encrypted store under the
  provider's `apiKeyRef` (`flow`, `clientId`, `accessToken`, `refreshToken`,
  `idToken`, `scopes`, `expiresAt`, `earliestRefreshAt`, `sub`,
  `lastRefreshAt`, `lastRefreshError`). The registration (`hostId`,
  `clientId`, `idToken`, `sub`) lives under `chatgpt-siwc:registration` and
  survives sign-out and provider deletion.
- **Model record** (JC, 2026-10-20): a sign-in takes over
  `mm_chatgpt_codex_gpt_55`. Its slug is kept when the account's `/v1/models`
  catalog lists it (`visibility == "list"`) — that is the user's choice;
  otherwise it becomes the catalog's first visible entry, in the order the
  API returns it (the probe saw `gpt-6.1-sol` first). When the catalog cannot
  be fetched or is empty, the stored slug stays, and a record created then
  gets the fallback `gpt-5.6-sol`. The display name follows the slug only if
  it was just the old slug; the model's option settings are kept.
- **Refresh**: behind a per-`apiKeyRef` async gate (read before locking,
  read again after locking, reuse a token another request already refreshed;
  every write of the credential takes the same gate), 120 s before expiry,
  `grant_type=refresh_token` + `client_id` + `refresh_token` + `resource`. Access token, rotated refresh token, expiry and scopes are
  replaced together. `invalid_grant`, `invalid_refresh_token`,
  `token_expired`, `refresh_token_expired`, `refresh_token_invalidated` and
  `refresh_token_reused` — in `error` or `error_reason` — clear the tokens,
  keep the registration and the credential row, and turn every later request
  into `chatgpt_plan_reauth_required`. A 401 `token_revoked` on Core's own
  model list or connection test does the same. Network errors, 5xx and 429
  keep the credential. If a refresh fails because another process already
  rotated the stored credential, Core adopts that newer credential when it
  belongs to the same account (`sub`); it never switches a request to another
  account.
- **Runtime**: a `chatgpt_codex_oauth` model reaches the runner only with a
  SIWC credential, always with `apiBase: https://api.openai.com/v1`. Credential
  IPC returns `accessToken` and `expiresAt`, no account id (SIWC access tokens
  carry no `chatgpt_account_id`). The runner turns the auth kind alone into the
  engine's `codex_backend` key; there is no separate plan flag (the
  `chatgptPlan` / `chatgpt_plan` pair that chose between the two sign-ins
  went with the Codex CLI login).
- **Requests from Core** (model list `GET /v1/models`, keeping
  `visibility == "list"`; connection test `POST /v1/responses` with
  `store: false`, `stream: true`) send `User-Agent: Galley (<os>; <arch>)`,
  named like Python's `platform.system()` / `platform.machine()`, and no
  `originator` or `ChatGPT-Account-ID`.
- **Sign-out**: removes the stored credential, then revokes a SIWC refresh
  token (RFC 7009 form to `https://auth.openai.com/api/accounts/oauth/revoke`,
  retried on network errors / 5xx / 429) and reports
  `remoteRevokeConfirmed`. A stored value that is not a SIWC credential is
  only deleted, never revoked.
- **Retiring the Codex CLI login** (`chatgpt_siwc::retire_codex_cli_credentials`,
  run at every Core start before the background services, a no-op once done):
  for every `chatgpt_codex_oauth` provider, a stored credential without
  `"flow": "siwc"` is deleted from the encrypted store and the provider's
  `api_base` becomes `https://api.openai.com/v1`. The credential is never
  revoked (its refresh token may be the one the Codex CLI itself uses, and
  revoking it would sign the user out there too), and nothing outside Galley's
  store is written. Provider and model records and the sessions bound to them
  stay, so the card reads "sign in" and the next sign-in takes the provider
  over in place. A change rewrites the generated model config.

Tauri commands (errors are `{"error": "<code>", "message": "..."}`; the
plan codes are `chatgpt_plan_` followed by `access_denied`,
`usage_not_granted`, `login_cancelled`, `login_timed_out`,
`login_not_found`, `reauth_required`, `temporary` or `failed`):
`start_chatgpt_plan_login`, `complete_chatgpt_plan_login`,
`cancel_chatgpt_plan_login`, `list_chatgpt_plan_models`,
`get_chatgpt_plan_status`, `logout_chatgpt_plan`.
`test_managed_model_connection` and `list_managed_model_options` use the
plan's connection test and catalog for a `chatgpt_codex_oauth` provider.
`get_chatgpt_plan_status` reports `flow: "siwc"` or `null`. Never log the
authorize URL (it may carry `id_token_hint`), tokens or authorization codes.

Engine side (patch `0007`): with `codex_backend` the engine takes the access
token from Core's credential IPC, keeps the Codex request body against
`https://api.openai.com/v1`, sends Galley's own `User-Agent`
(`Galley (<system>; <machine>)`) without `originator` or
`ChatGPT-Account-ID`, and handles plan errors by `error.code`: terminal codes
(usage limit, not eligible, unsupported capability, a revoked or disconnected
sign-in, and the other rejections) fail at once with an English message that
names the code, and the two `*_unavailable` codes use GA's normal backoff. The ledger row for `0007` in `managed-ga/patches/manifest.md` lists
the codes.

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
