# Galley

> This is the short startup constitution for AI coding agents working in this
> repository. Keep it small. Put task-specific detail in `docs/` and link it
> from here.

> Galley started as a workbench for GenericAgent. The first two letters of our
> name are a quiet bow to where we came from.

## Product Shape

Galley is a local agent team orchestrator. Human and agent are both first-class
operators:

- Galley GUI is for the human operator at the desktop.
- Galley CLI is for trusted Agent / Supervisor automation on the same machine.

Positioning (2026-07-03): Galley is an **independent product built on
GenericAgent** — a derivative work, not a GUI for GA. The bundled managed
runtime (upstream GA + Galley's patch stack) is the product's engine and the
primary development focus; attaching a user-owned external GA remains supported
as the compatibility mode. User-facing copy follows the 内核 / engine naming
rule and the "GA budget" in
[copy-language-guidelines](./docs/copy-language-guidelines.md).

Current target:

- Agent API: `schemaVersion: 1` (frozen for the `0.2.x` line; see Rule 3)

Read [project status](./docs/project-status.md) for the current version, release
tag, release gates, update-channel state, and compact phase state. Those values
change every release and are intentionally not pinned here.

## Names And Terms

- Use `Galley` in prose, docs, comments, and commit messages.
- Use `Galley` for the product name in UI display too; do not introduce an
  all-caps product wordmark.
- Use `GenericAgent` / `GA` for the upstream engine, never as a synonym for
  Galley.
- `macOS` means the operating system; `Mac` means the hardware / user device.

## Non-Negotiable Rules

Violating any rule below breaks the core project contract.

### 1. GenericAgent Runtime Boundaries

Galley has two GenericAgent runtime modes:

- **Attach / external GA**: user-owned GenericAgent. Galley wraps it.
- **Managed / bundled GA**: Galley-owned runtime. Galley ships and maintains it.

For attach / external GA, Galley must not modify GenericAgent state:

- Do not edit files under the user's GenericAgent checkout.
- Do not write external GA `memory/`, SOP, skills, or other user state.
- Do not overwrite external GA venv, PATH, or environment variables.
- Do not inject Galley Persona or managed-runtime patches.
- Do not monkey-patch `agent_runner_loop` or GA tool implementations.

Allowed attach-mode integration points:

- Start external GA as a child process per session.
- Use GA public APIs such as `agent.list_llms()`.
- Register `agent._turn_end_hooks`.
- Subclass `GenericAgentHandler` for approval interception and for
  turn-lifecycle UX signals (emit-only; must not alter tool dispatch or
  results).
- Read / inject `llmclient.backend.history` for restore.
- Set Galley-namespaced in-memory attributes on the agent object (e.g.
  `_ga_project_mode_*`) as process-local coordination state. These live and
  die with the child process and must never be persisted into GA files.

Reading GA internals is allowed only when read-only and documented as a coupling
point. Anything that reads and then writes GA files counts as modification and
is forbidden.

Supervisor SOP is copy-first: Settings -> Agent provides "Copy SOP". Galley does
not install SOP content into GA memory. Read
[Supervisor SOP](./docs/integrations/galley-supervisor-sop.md).

For managed / bundled GA, Galley may patch and configure only its own managed
runtime, under the managed-runtime rules in
[managed GA runtime](./docs/managed-ga-runtime.md):

- Keep patches minimal, isolated, documented, and replayable on top of upstream.
- Prefer explicit extension seams over broad edits.
- Do not fork GenericAgent into a divergent product.
- If upstream GA provides the same capability, remove the Galley patch.
- Code is replaceable; user state is not. Runtime upgrades may replace managed
  GA code, but must not overwrite managed GA memory, SOP, skills, or other
  user state.
- Managed-runtime changes must never write into or depend on a user-owned
  external GA checkout.

### 2. Localhost Only

Galley Core listens only on AF_UNIX socket / Windows named pipe. It does not
open TCP, expose HTTP, or hold remote auth tokens.

Remote use cases belong to the external Supervisor transport layer, such as an
IM bot, SSH, or another agent frontend.

Any proposal to add HTTP server, token auth, remote login, or TLS must first
change this constitution.

### 3. CLI Surface Is Public Contract

Galley CLI JSON is the stable contract for agents. Read
[agent-api](./docs/agent-api.md) before changing it.

- `schemaVersion: 1` is frozen for `v0.2.x`.
- v1 changes are additive-only.
- Breaking change requires `schemaVersion: 2`.
- CLI callers pin with `--schema=1`.
- Socket callers pin with `schemaVersion: 1`.
- Exit code classes and error identifiers are stable.

Changing the Agent API is riskier than changing GUI copy: a GUI change affects
humans; schema drift breaks downstream agents and SOPs.

### 4. Data Stays In Galley

Galley stores session data and supervisor action metadata. It does not store the
conversation between a supervisor and the user in IM / Claude / another agent.

Supervisor history belongs to the supervisor. Galley is an orchestrator, not a
chat platform.

### 5. Rust Core Is Authoritative

Since v0.2, business authority lives in Rust Galley Core:

- SQLite writes: Rust
- Bridge subprocess ownership: Rust
- Session lifecycle and command dispatch: Rust
- GUI / CLI: presenter frontends that invoke commands and subscribe to events

Do not reintroduce GUI-side authoritative writes, GUI-side Python subprocess
ownership, or a new monolithic frontend state owner.

### 6. Tauri Identifier Is Data-Critical

The Tauri identifier controls the user data directory. Do not change
`app.galley` without a migration plan and dogfood. Read
[desktop runtime](./docs/desktop-runtime.md).

## Repo Map

```text
runner/      Python bridge into GenericAgent
core/        Rust Galley Core + Tauri backend
cli/         Rust `galley` command for agents
gui/         React / Tauri frontend
managed-ga/  Galley-managed GenericAgent runtime (code, patches, manifest)
scripts/     Build, bundle, and release / update-channel scripts
docs/        Product, architecture, workflow, and history
```

## Read On Demand

| If you are doing this | Read first |
|---|---|
| Need current state / release gates | [project status](./docs/project-status.md) |
| Understand architecture | [architecture](./docs/architecture.md) |
| Product or roadmap change | [PRD](./docs/PRD.md) |
| CLI / Agent API change | [agent-api](./docs/agent-api.md) |
| Core ↔ runner wire protocol change | [IPC protocol](./docs/ipc-protocol.md) |
| Supervisor / Agent integration | [Supervisor SOP](./docs/integrations/galley-supervisor-sop.md), then [Supervisor reference](./docs/integrations/galley-supervisor-reference.md) |
| GenericAgent compatibility | [GA baseline](./docs/ga-baseline.md) |
| Managed / bundled GA runtime | [managed GA runtime](./docs/managed-ga-runtime.md) |
| Desktop packaging / runtime | [desktop runtime](./docs/desktop-runtime.md) |
| Rust core refactor / B-phase work | [refactor README](./docs/refactor/README.md) |
| Architecture invariant proof | [architecture demo](./docs/architecture-demo.md) |
| Release work | [release / update SOP](./docs/release-update-sop.md) (runbook), [release workflow](./docs/release-workflow.md) (background) |
| Closing a long coding session or syncing project knowledge | [session close SOP](./docs/session-close-sop.md) |
| Windows smoke | [Windows checklist](./docs/windows-build-checklist.md) |
| GUI / engineering conventions | [engineering workflow](./docs/engineering-workflow.md) |
| Visual design | [DESIGN.md](./docs/DESIGN.md) |
| Historical decisions | [devlog](./docs/devlog/README.md) |
| All docs | [docs index](./docs/README.md) |

## Working Defaults

- Prefer the existing architecture and local patterns over new abstractions.
- Keep edits scoped to the user's request.
- Preserve unrelated dirty work.
- For code changes, run the smallest verification set that covers the risk.
- Node tooling is pnpm — the `packageManager` field pins it and CI runs it.
  `npm` / `yarn` ignore `pnpm-lock.yaml` and can resolve a different tree, so
  use `pnpm --dir gui …` (not `npm`) for every gui command below.
- For release or contract changes, broaden verification.

Common verification:

```bash
cargo check --workspace
cargo test --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
git diff --check
```

When the change touches `runner/` (Python bridge), also run:

```bash
.venv/bin/python -m pytest          # unit tests (e2e is deselected by default)
.venv/bin/python -m mypy runner     # strict typing
.venv/bin/ruff check runner         # lint
```

The e2e suite needs a real GA + LLM and is opt-in:
`GA_PATH=… BRIDGE_PYTHON=… .venv/bin/python -m pytest -m e2e`.

Desktop dogfood:

```bash
pnpm --dir gui tauri dev
```

This is a client app. Do not treat `pnpm dev` alone as full verification unless
the task is explicitly web-only. Do not spend verification time opening the
Vite-only app in a browser for Settings, updater, IPC, database, menu/tray, or
other Tauri-dependent flows: it lacks the Tauri runtime and will produce
expected API errors. Use `pnpm --dir gui tauri dev` or static checks instead.
For small GUI copy / polish changes on Tauri-dependent or stateful desktop
surfaces, prefer `pnpm --dir gui typecheck`, `pnpm --dir gui lint`, and
`git diff --check`; JC will do final visual acceptance in the real app unless
explicitly asking the agent to run desktop/browser dogfood.

## Documentation Discipline

- `AGENTS.md` should stay short and global.
- Put task detail in focused docs under `docs/`.
- Put decision history and rejected alternatives in [devlog](./docs/devlog/README.md).
- Update [docs index](./docs/README.md) when adding a major new document.

## Session Close

When the user asks to end, close, or "session close" a long coding session,
follow [Session Close SOP](./docs/session-close-sop.md): summarize outcome,
persist durable decisions, update docs/devlog if needed, verify, clean the
workspace, commit, and leave a short handoff. When the user asks to sync or
tidy project knowledge without ending the session, run only the SOP's knowledge
sync parts.
