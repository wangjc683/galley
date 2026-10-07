# Contributing to Galley

Thanks for taking a look at Galley. The project is still pre-v1, so the most
useful contributions are focused fixes, clear bug reports, Windows/macOS smoke
results, documentation improvements, and small improvements that fit the
existing architecture.

## Start Here

Before changing code, read:

- [AGENTS.md](./AGENTS.md) for non-negotiable project rules
- [docs/README.md](./docs/README.md) for the documentation map
- [docs/engineering-workflow.md](./docs/engineering-workflow.md) for commands,
  repo layout, IPC rules, and git expectations
- [docs/architecture.md](./docs/architecture.md) for the system overview

## Local Development

Galley is a desktop client app. You need Node.js 20+, pnpm (the version pinned
by `packageManager` in the root `package.json`; `corepack enable` picks it up),
a stable Rust toolchain, and Python 3.10+. Windows also needs the MSVC Build
Tools; see [windows-build-checklist](./docs/windows-build-checklist.md).

First-time setup from a fresh clone, from the repo root:

```bash
pnpm --dir gui install
./scripts/bundle-python.sh mac-arm64   # or mac-x64 / win-x64 (Git Bash on Windows)
```

`bundle-python.sh` stages the bundled CPython and the engine's dependencies in
`core/python-bundle/` (gitignored). The Tauri config lists that directory as a
resource, so without it the Core build fails with
`resource path python-bundle/python doesn't exist`. Re-run it when its pinned
dependencies change. Pass the machine's own architecture: on an Intel Mac,
`mac-arm64` fails with "Bad CPU type".

The normal development loop is:

```bash
pnpm --dir gui tauri dev
```

Debug builds run sessions on `python3` from your PATH (`python` on Windows),
not on the staged bundle, so that interpreter needs the engine dependencies
pinned in `GA_DEPS` at the top of `scripts/bundle-python.sh`.

Useful checks (the Cargo workspace root is `core/`; there is no root
`Cargo.toml`):

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
git diff --check
```

On a clean `core/target/`, the cargo commands also need the CLI sidecar that
`tauri dev` prepares; run `node scripts/prepare-cli-sidecar.mjs --profile debug`
first if you have not started the app yet.

When you touch `runner/` (the Python bridge):

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest          # unit tests; e2e is deselected by default
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
```

The e2e suite needs a real GenericAgent and LLM and is opt-in:
`GA_PATH=/path/to/GenericAgent BRIDGE_PYTHON=/path/to/python .venv/bin/python -m pytest -m e2e`.

`pnpm --dir gui dev` only starts the Vite web surface. It is useful for narrow
frontend work, but it is not full app verification.

## Building

```bash
pnpm --dir gui tauri build                                           # .app / .dmg / .exe under core/target/release/bundle/
cargo build --release --manifest-path core/Cargo.toml -p galley-cli  # standalone CLI at core/target/release/galley
```

Releases are built by CI: see the [release / update SOP](./docs/release-update-sop.md)
and its [background and troubleshooting](./docs/release-workflow.md). Manual
Windows builds follow the [windows-build-checklist](./docs/windows-build-checklist.md).

## Architecture Rules

Keep these constraints intact:

- Galley must not modify GenericAgent files, memory, venv, PATH, or runtime
  internals.
- Galley Core stays localhost-only: Unix socket on macOS/Linux, named pipe on
  Windows. No TCP server or token auth.
- Rust Galley Core is authoritative for SQLite writes, session lifecycle,
  runner ownership, and command dispatch.
- The CLI JSON contract is stable. Read [agent-api](./docs/agent-api/README.md)
  before changing CLI output.

## Good First Contributions

- Reproduce and document a bug with exact OS, Galley version, and steps.
- Improve docs clarity or fix stale links.
- Add focused tests around existing behavior.
- Improve Windows smoke coverage using [windows-build-checklist](./docs/windows-build-checklist.md).
- Polish a small GUI interaction while matching the existing design system.

## Pull Request Expectations

- Keep changes scoped.
- Preserve unrelated dirty work.
- Add or update tests for risky behavior changes.
- Update the focused docs when changing a contract or workflow.
- Do not push large rewrites without a clear issue or discussion first.

## Where To Put Context

- Current project state: [project status](./docs/project-status.md)
- Product decisions: [PRD](./docs/PRD.md)
- Technical workflow: [engineering workflow](./docs/engineering-workflow.md)
- Architecture proof / grep gates: [architecture demo](./docs/architecture-demo.md)
- Historical decisions and rejected alternatives: [devlog](./docs/devlog/README.md)
