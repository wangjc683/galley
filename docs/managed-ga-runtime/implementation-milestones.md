# Managed Runtime: Implementation Plan And Verification

> Part of the [managed GA runtime reference](./README.md).

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
