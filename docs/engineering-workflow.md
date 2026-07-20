# Engineering Workflow

> Contributor-facing document. Coding agents should still start from
> [AGENTS.md](../AGENTS.md); human contributors should start from
> [CONTRIBUTING](../CONTRIBUTING.md).

This document holds the engineering conventions that do not need to live in
every agent startup context.

## Repository Map

```text
galley/
├── README.md
├── README.zh-CN.md
├── AGENTS.md
├── runner/                  # Python bridge into GenericAgent
├── core/                    # Rust Galley Core + Tauri backend
├── cli/                     # Rust `galley` CLI
├── gui/                     # React / Tauri frontend
├── managed-ga/              # Galley-managed GenericAgent runtime (code, patches, manifest)
├── scripts/                 # Build, bundle, and release / update-channel scripts
├── docs/                    # Product, architecture, workflow, devlog
└── .github/workflows/       # CI and release workflows
```

Key directories:

- `runner/`: Python bridge, GenericAgent handler subclass, IPC dataclasses,
  runner tests.
- `core/`: Rust authoritative layer, SQLite migrations, Tauri commands,
  socket / named pipe listener, bundled resources.
- `cli/`: Agent-facing `galley` command.
- `gui/`: React 19 + Tauri frontend, Zustand domain stores, visual components.
- `managed-ga/`: Galley-managed GenericAgent runtime — vendored code, Galley
  patches, and the runtime manifest.
- `scripts/`: build, bundle, and release / update-channel automation.
- `docs/devlog/`: decision provenance and historical narrative.
- `docs/archive/`: completed-mission docs kept for provenance (B-phase
  refactor playbooks, one-off handoffs, superseded drafts).

## Common Commands

From repo root unless noted:

```bash
cargo check --workspace
cargo test --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui build
pnpm --dir gui tauri dev
pnpm --dir gui tauri build
git diff --check
```

Inside `gui/`, the shorter forms also work:

```bash
pnpm typecheck
pnpm lint
pnpm tauri dev
pnpm tauri build
```

`pnpm tauri dev` is the normal desktop dogfood command. It runs the client app,
not a web-only experience.

Avoid opening the Vite-only app in a browser for Settings, updater, IPC,
database, menu/tray, or other Tauri-dependent flows. The page lacks the Tauri
runtime, so `invoke` / `listen` / plugin APIs fail with expected errors and do
not provide useful GUI verification. Use static checks for fast feedback, and
use `pnpm --dir gui tauri dev` when the rendered desktop surface matters.

## Python Runner Rules

- Python 3.10+.
- Type annotations are expected.
- Keep runner code independent from GUI.
- Do not introduce third-party packages beyond GenericAgent dependencies unless
  the need is clear.
- Cover IPC schema, hook behavior, and subprocess isolation in `runner/tests/`.

## TypeScript / GUI Rules

Toolchain:

- Tauri v2
- Vite 7
- React 19
- TypeScript strict
- Tailwind v4 CSS-first tokens in `gui/src/styles/globals.css`
- Phosphor Icons as the product icon set
- Self-hosted fonts through npm packages
- pnpm only

Component guidance:

- Use shadcn/Radix-style primitives for standard accessible behaviors:
  dialog, dropdown menu, popover, tabs, tooltip, command, input, button.
- Use local product components for domain-specific surfaces:
  Sidebar, Composer, Tool callouts, Approval Dock, Health Check, Onboarding,
  Empty State.
- Keep UI state in the relevant domain store. The old monolithic
  `useAppStore.ts` no longer exists.

Design references:

- [DESIGN.md](./DESIGN.md)
- [devlog design entries](./devlog/README.md)

## Hard Engineering Invariants

These rules were forged during the B-phase refactor and remain binding after
v0.2.0. Violating one is grounds for revert. The IDs are stable because
devlog entries, playbooks, and commit messages reference them; the retired
refactor-execution rules (I1, I2, I4, I7, I8, I10) live in the
[archived invariants file](./archive/refactor/invariants.md).

- **I3 — SQLite migration numbering.** Migrations increment by commit order.
  Never skip, reuse, or edit a shipped migration — dogfood databases have
  already run that number, and editing it makes the two sides drift. A wrong
  migration is fixed by adding a new one on top.
  **Adding the `.sql` file is not enough** — the runtime does not scan the
  directory. A new migration must also be registered in BOTH runtime lists:
  the `Migration` vec in `core/src/lib.rs` and `MIGRATION_SPECS` in
  `core/src/migration_backup.rs` (plus its latest-version test assertions),
  or the shipped app silently never applies it and every query touching the
  new column fails (2026-07-20: sidebar went empty in dogfood exactly this
  way). Test fixtures keep their own per-file migration lists
  (`core/tests/*.rs`, `cli/tests/*.rs`) — extend the ones whose tables you
  touched.
- **I5 — API surface single source of truth.** The Rust `GalleyApi` trait is
  the only definition of commands. Both transports (Tauri command, socket)
  thin-wrap it. No command may exist on only one transport, and no business
  logic may live in a transport layer — protocol adaptation (framing, event
  emit) only.
- **I6 — GUI stays a stateless presenter.** `gui/` never reads or writes
  SQLite directly, never owns runner subprocesses, and never holds
  authoritative state. The test: if the CLI performed the same action, would
  the React store's value now be wrong? If yes, that state belongs in Rust.
- **I9 — Shipped data formats are contracts.** Once a SQLite schema, prefs
  format, or file location ships, changes are additive only: new columns with
  compatible defaults, new tables, new prefs keys. Never delete a shipped
  column, change its semantics, or move data without a real migration.
- **I11 — Keep `panic = "unwind"`.** Bridge children are reclaimed by
  `kill_on_drop(true)` during unwind. `panic = "abort"` skips Drop and
  orphans every live bridge process. No `[profile.*] panic = "abort"` in
  `core/Cargo.toml`, ever — the ~5% binary-size saving is not worth it.

Code-level proofs and grep gates for the architecture-layer principles are in
[architecture demo](./architecture-demo.md).

## IPC Protocol Changes

Protocol is a contract. Change docs first, then code.

1. Update [ipc-protocol](./ipc-protocol.md).
2. Update Python IPC dataclasses in `runner/ipc.py` when runner protocol is
   affected.
3. Update TypeScript mirror types in `gui/src/types/ipc.ts` when GUI protocol is
   affected.
4. Update Rust command / event types when Galley Core protocol is affected.
5. Add or adjust tests in the same change.

For Agent-facing CLI JSON, read [agent-api](./agent-api.md). That surface is
more stable than internal GUI IPC.

## Git Discipline

- Preserve user or other-agent work in a dirty tree.
- Keep commits independently working when the user asks for commits.
- Use English commit messages that explain intent.
- Do not push unless explicitly asked.
- Keep baseline upgrades as separate commits when possible.

## Devlog Workflow

Use [devlog](./devlog/README.md) for decision provenance:

- major architecture or product decisions
- meaningful rejected alternatives
- phase changes
- release or dogfood retrospectives

File naming:

```text
docs/devlog/YYYY-MM-DD-topic-in-kebab-case.md
```

Each entry should cover:

1. Date / Status / Related
2. Context
3. Decisions
4. Rejected alternatives
5. Open questions
6. Next

After writing a devlog, update [devlog README](./devlog/README.md).
