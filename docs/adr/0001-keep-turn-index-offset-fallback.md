# ADR-0001 — Keep the `turnIndexOffset` forward fallback

- Status: accepted
- Date: 2026-07-07
- Area: GUI turn numbering (`gui/src/lib/turn-index.ts`, `gui/src/lib/ipc-handlers.ts`, `gui/src/stores/messages.ts`)

## Context

GA's `agent_runner_loop` restarts its step counter at `turn = 1` on every
`put_task` (one per user message). The GUI must map that per-message step onto
the **absolute** session-wide `turn_index` SQLite keys on, or two consecutive
messages' step-1 assistant rows collide on `msg_${sid}_1_assistant` and the
`ON CONFLICT UPDATE` silently overwrites the older reply. See
[CONTEXT.md → Turn numbering](../../CONTEXT.md).

The GUI resolves the absolute index as:

```ts
event.absoluteTurnIndex ?? event.turnIndex + offset   // resolveAbsoluteTurnIndex
```

where `offset = turnIndexOffset` is `turnCount` at message start.

During the architecture review (2026-07-07) it looked like the offset path had
become dead code, because Core now supplies `absoluteTurnIndex` end-to-end:
the GUI ships the Core-assigned user-row `turn_index` into the runner command,
the runner stores it as `_current_message_turn_base`, and echoes it on every
event. A candidate deepening ("Direction 1") proposed deleting `turnIndexOffset`
and the fallback entirely.

## Investigation

Traced every path that could make `event.absoluteTurnIndex` null:

- **`/btw` side questions** send a command with `absolute_turn_index: None`, but
  the dispatcher `return`s on the `/btw` branch (`workbench_bridge.py:1409`)
  **before** the base assignment (`:1417`), and `/btw` emits only a
  `SystemMessageEvent` — never a `turn_end`. Eliminated.
- **GUI / socket / CLI sends** all persist the user row through
  `RawMessageRow::into_brief`, which always sets `turn_index: Some(...)`
  (`core/src/db/rows.rs:99`). Core reliably returns the index; the runner
  reliably echoes it.

So in the **normal flow the fallback never fires**.

## Decision

**Keep `turnIndexOffset` and the fallback.** Do not delete it for tidiness.

Two load-bearing reasons:

1. **The nullable contract is real and not GUI-owned.** Both tiers declare the
   field nullable (`Option<u32>` in Rust, `number | null` in TS). The GUI does
   not control Core; it must not assume Core's value is always present (error
   paths, future changes, legacy IPC lines repaired in `runner/ipc.py`).
2. **When the fallback *does* fire, it produces the correct answer.** In the one
   realistic case — a GUI-originated message whose Core index is momentarily
   absent — `offset` was just set correctly by `appendUserTurn`, so
   `turnIndex + offset` is the correct absolute index. Removing the guard and
   falling back to the raw per-message `turnIndex` would reintroduce the
   primary-key collision (silent lost-reply bug) it exists to prevent.

The trade is asymmetric: the payoff of removal is one store field plus one `??`;
the risk is silent conversation-history corruption on restore. Not worth it.

## Consequences

- `resolveAbsoluteTurnIndex` keeps its two-argument shape (`event`, `offset`).
- Future architecture reviews should not re-suggest removing the offset; this
  ADR is the answer.
- If Core is ever made to **guarantee** a non-null absolute index at the type
  level (non-`Option`) across every send path, this decision can be revisited —
  that guarantee, not GUI tidiness, is the precondition for removal.
