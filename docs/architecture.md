# Architecture

Galley is a local agent team orchestrator with two first-class frontends:

- **Galley GUI** for the human operator at the desktop.
- **Galley CLI** for trusted Agent / Supervisor automation on the same machine.

Both frontends talk to the same Rust-side authority layer: Galley Core.

```text
Galley GUI (Tauri/React)        Galley CLI (Rust)
          \                         /
           \                       /
            v                     v
              Galley Core (Rust)
              - session lifecycle
              - SQLite writes
              - runner ownership
              - local socket / named pipe
                       |
                       v
          Runner processes (Python, one per session)
                       |
                       v
              GenericAgent subprocesses
```

## Design Goals

Galley is built around four ideas:

1. **Local-first orchestration.** Galley runs on the user's machine and keeps
   data local.
2. **Human and agent parity.** A person can use the GUI; another trusted agent
   can use the CLI.
3. **Non-invasive GenericAgent integration.** Galley wraps GA without modifying
   GA files, memory, venv, or tool internals.
4. **Stable agent-facing contract.** The CLI and socket schema are treated as a
   public API for downstream agents and SOPs.

## Core Components

### GUI

The GUI lives in `gui/` and is built with Tauri, React, TypeScript, and
Tailwind. It presents sessions, messages, settings, and supervisor activity. It does not own business authority; it invokes Rust commands and
subscribes to events.

Local file references use `LocalFileWorkspace` for session-scoped transient
preview state. Rust `local_file` validates paths, bounds reads, and invokes the
OS file manager/default Markdown application. Both Tauri `access_local_file`
and socket `local_file.access` call `GalleyApi::access_local_file`. This seam
does not persist file contents, change session state, or touch the runner.

Git worktree review shares the same reading panel. `git_review` in Rust owns
repository discovery, bounded read-only Git subprocesses, and HEAD validation.
Tauri `review_git` and socket `git.review` share `GalleyApi::review_git`.
The GUI lazily loads `react-diff-view` for presentation and keeps only transient
repository/file/layout selection at window scope: switching sessions or
projects preserves the open Git panel and its selection. Markdown preview
still closes on session change. Git data is not stored in the database and
is never claimed to be attributable to the active session.

### CLI

The CLI lives in `cli/` and exposes the `galley` command. Agents use it to list
sessions, inspect context, create sessions, send messages, move sessions,
switch LLMs, and archive or restore work.

The CLI contract is documented in [agent-api](./agent-api.md).
`schemaVersion: 2` is current (since v0.5.0, for the Goal v2 family);
`1` stays frozen and is still served for every command that did not change.
Changes within a version are additive-only; a breaking change requires the
next version. Since 2026-07-11 the schema's single code home is
`core/src/protocol/` — command args, envelopes, and error tags shared
by Core's socket listener and the CLI's `SocketClient`.

### Galley Core

Galley Core lives in `core/`. It owns:

- SQLite reads and writes
- migrations and pre-migration backup
- session lifecycle
- runner process lifecycle
- local socket / named pipe listener
- Tauri command surface

This is the authoritative layer. New write behavior should be modeled here
first, then exposed to GUI and CLI.

#### Runner events and turn persistence

Each runner's stdout becomes a broadcast inside Core, with two kinds of
subscribers:

- **Core's runner watcher**, attached in `RunnerManager::spawn` so every
  spawn path (GUI, CLI `session new`, Goal, scheduler) gets one. It writes
  every `turn_end` as an assistant `messages` row and, for visible turns,
  bumps the session (`turn_count`, `summary`, `last_activity_at`)
  ([`core/src/turn_persistence`](../core/src/turn_persistence/mod.rs)),
  then does the outbound-queue bookkeeping. One ordered consumer does
  both, so a run's rows are in SQLite before its `run_complete` closes the
  run gate.
- **Presentation subscribers**: the `runner-event` emit task (GUI pages)
  and the auto-title watcher. Nothing durable depends on a page receiving
  an event.

The GUI renders, flags unread (only it knows which session is on screen;
`mark_session_unread`) and notifies. Until 2026-10-07 the assistant row and
the session bump were written only when a page handled `turn_end`, so a
webview reload (macOS WebContent crash recovery, Windows F5, dev HMR)
silently dropped whole runs. A reloaded page now re-attaches to the runners
Core still holds (`list_live_runners`) instead of re-spawning them, which
would have killed a running turn. The row's derived columns come from a
Rust port of the GUI's derivation; shared golden fixtures under
`core/tests/fixtures/` keep vitest and cargo test on the same output. See
the [devlog](./devlog/2026-10-07-core-owned-turn-persistence.md).

### Runner

The runner lives in `runner/`. It is the Python bridge into GenericAgent. It
starts GA as a child process, registers supported hooks, captures events, and
keeps the integration non-invasive.

Each Galley session maps to its own GenericAgent subprocess.

Core also owns long-lived runner processes that are not sessions, all
managed-runtime only and all spawned, restarted and stopped by Core:

- IM supervisors (`runner/managed_im_supervisor.py`, one per enabled channel,
  `core/src/im_supervisor/`).
- The resident browser bridge (`runner/managed_browser_bridge.py`,
  `core/src/browser_bridge.rs`): hosts GA's TMWebDriver master so the browser
  extension's connection state is live. See
  [browser control](./managed-ga-runtime/browser-control.md).

## Localhost Only

Galley Core accepts local control through:

- AF_UNIX socket on macOS/Linux
- Windows named pipe on Windows

It does not expose a TCP server, HTTP API, token auth, OAuth flow, or remote
login. Remote workflows belong to the user's trusted Supervisor Agent or IM
transport; Galley stays local.

The managed GA engine's own browser driver binds 127.0.0.1:18765 / 18766
(TMWebDriver, for the browser extension and for GA processes talking to its
master). Those ports belong to GA code, not to Core: managed sessions open
them when they first use the browser, and the resident browser bridge keeps
one such master alive.

## Data Boundaries

Galley stores:

- session metadata
- messages inside Galley sessions
- supervisor action origin fields, such as who issued a command and why

Galley does not store the conversation between the user and their external
Supervisor Agent. That history belongs to the supervisor platform.

## Document Map

- [architecture demo](./architecture-demo.md): code-level proof and grep gates
  for the architecture principles
- [agent-api](./agent-api.md): CLI and socket contract
- [engineering workflow](./engineering-workflow.md): repo map, commands, IPC
  workflow, and contribution conventions
- [desktop runtime](./desktop-runtime.md): Tauri identifier, bundled Python,
  release artifacts, signing policy
- [PRD](./PRD.md): product definition and roadmap
