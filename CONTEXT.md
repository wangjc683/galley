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
