# Galley — Domain Glossary

The ubiquitous language for Galley. Engineering skills read this before
exploring; use these terms in issue titles, refactors, hypotheses, and test
names rather than drifting to synonyms. This file is grown lazily — terms are
added when a decision actually pins them down, not speculatively. See
[docs/agents/domain.md](./docs/agents/domain.md) for how the skills consume it.

## Turn numbering

The most collision-prone arithmetic in the GUI. GA's `agent_runner_loop`
(`agent_loop.py`) restarts its loop counter at `turn = 1` on every `put_task`
— i.e. once per user message — so the same small step numbers recur throughout
a session. Four terms disambiguate them. Their single code home is
[`gui/src/lib/turn-index.ts`](./gui/src/lib/turn-index.ts).

- **GA step** — the per-message loop step (1, 2, 3 …) GA emits on each
  `turn_end`. Resets to 1 on every user message. Rendered to the user as
  **"第 N 步"** (the *per-message display step*).
- **Absolute turn index** — the session-wide `turn_index` SQLite keys on.
  Unique across user messages, so an assistant row's primary key
  `msg_${sessionId}_${absolute}_assistant` never collides. Core assigns it and
  is authoritative for it.
- **Message base** — the absolute turn index of the user row that opens the
  current message block. Restore tracks it to recover the display step.
- **Turn index offset** — `turnCount` at message start. The GUI's fallback for
  events that arrive without Core's absolute index: `absolute = step + offset`.

Invariant: `absolute = step + offset` and `base = offset + 1`, hence
`displayStep = absolute − base + 1 = step` (the restore round-trip is
identity). Forgetting this is what makes two consecutive messages' step-1
replies overwrite each other and a restored conversation "lose replies".

## GA integration seam

The constitution (Rule 1) fixes what Galley may touch inside a
GenericAgent; **GaSession**
([`runner/ga_session.py`](./runner/ga_session.py)) is the module that
IS that seam. Scope rule: it wraps exactly the
internal/underscore/backend surface a baseline upgrade can silently
move (`_turn_end_hooks`, `backend.history`, `last_tools`,
`_ga_project_mode_*`, the `GenericAgentHandler` module binding); GA's
public API stays direct on `bridge.agent`. Baseline-upgrade re-audit =
read that one file, plus two documented non-agent couplings
(`tool_usable_history.json`,
`managed_runtime.install_managed_prompt_profile`). History restore on
backends other than `NativeClaudeSession` emits a loud warning
(PRD §10). (2026-07-11 decision; see devlog.)

## Agent turn construction

The live `turn_end` path and the SQLite restore path build the same
`AgentTurn` shape. Single code home:
[`gui/src/lib/agent-turn.ts`](./gui/src/lib/agent-turn.ts) — tool-event
construction, the **final-answer-turn gate** (`no_tool` / zero tools →
the narrator IS the final answer, no preamble kept), and
empty-final-answer → null normalization all live there once. Persist
consumes the built turn (what rendered live is what lands in SQLite);
live-only derivation of thinking/preamble from raw `responseContent`
stays in `ipc-handlers`. The round-trip invariant — *live turn ===
restored turn for the same data* — is pinned by `agent-turn.test.ts`
(2026-07-11 decision; see devlog).

## Socket protocol

The CLI↔Core socket contract (Agent API, `schemaVersion: 1`). Single code
home: [`core/src/protocol/`](./core/src/protocol/mod.rs) — envelopes,
per-command args structs, error tags. Neither end hand-writes a command
name or camelCase field literal; drift is a compile/test failure, not a
silently dropped argument (2026-07-11 decision; see devlog).

- **Protocol module** — `core/src/protocol/`: the shared schemaVersion 1
  type home. Rule: every `socket_listener` dispatch arm parses an args
  type from here; every CLI request serializes the same type.
- **`SocketCommand`** — trait binding a command's wire name (`NAME`) to
  its args struct, so a name can't be paired with the wrong arguments.
- **`SocketClient`** — the CLI's deep client (`cli/src/client.rs`):
  envelope encode/decode, `ErrorTag` → exit-class mapping. Sits on the
  **Transport seam** (`round_trip` / `open_stream`, string lines in/out)
  so tests replay canned lines — including malformed ones — with no live
  Core.
- **`WatchFrame`** — the one stream-frame parser, with an explicit
  `Unparseable(raw)` variant. Policy is per-caller by design:
  `session watch` passes raw lines through (agents parse the NDJSON);
  programmatic consumers treat `Unparseable` as an error. Results of
  unary calls stay `Value` — typed results would drop additively-added
  server fields on reprint.
- **`HandlerCtx`** — what a Core socket write handler may touch
  (`core/src/socket_listener/ctx.rs`): `DbSource` (global on-disk DB or
  injected test pool), **`RunnerPort`** (the 6-method trait that IS the
  socket→runner coupling), **`Notifier`** (`core/src/notify.rs`, GUI
  event seam replacing `AppHandle` reach-ins). Production composes at
  `dispatch_line`; tests enter via `dispatch_line_with` with fakes —
  see `core/tests/socket_write_handlers_test.rs`.
