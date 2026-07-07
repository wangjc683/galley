// The single owner of GA loop-numbering translation.
//
// GA's `agent_runner_loop` (agent_loop.py) declares `turn = 0` locally and
// increments per LLM call within one invocation. Every `put_task`
// (one per user message) starts a fresh loop, so the first turn of every
// user message arrives as `turn = 1` — regardless of how many turns the
// session already holds. Four numbers describe one turn:
//
//   - GA step        the per-message loop step (1, 2, 3 …). What the user
//                    sees as "第 N 步". Resets to 1 on each user message.
//   - absolute index the session-wide `turn_index` SQLite keys on. Unique
//                    across user messages so assistant primary keys
//                    (`msg_${sid}_${abs}_assistant`) never collide — a
//                    collision silently overwrites the older reply.
//   - message base   the absolute index of the user row that opens the
//                    current message block.
//   - offset         `turnCount` at message start.
//
// Invariant:  absolute = step + offset   and   base = offset + 1
//        ⇒    displayStep = absolute − base + 1 = step   (round-trip identity)
//
// Core is authoritative: it assigns the user-row `turn_index`, the GUI ships
// it to the runner (as `absoluteTurnIndex`), and the runner echoes
// `absoluteTurnIndex` on each event. The offset path is the fallback for
// events / rows that predate that or arrive without it.

/** An event carrying GA's per-message step and, when Core supplied it, the
 *  authoritative absolute index. */
interface TurnIndexed {
  turnIndex: number;
  absoluteTurnIndex?: number | null;
}

/**
 * Forward (live): resolve the absolute, session-wide turn index for an
 * incoming event. Prefers Core's authoritative `absoluteTurnIndex`; falls
 * back to `step + offset` for events that don't carry one.
 */
export function resolveAbsoluteTurnIndex(event: TurnIndexed, offset: number): number {
  return event.absoluteTurnIndex ?? event.turnIndex + offset;
}

/** A single-pass cursor over SQLite rows in (turn_index, sequence) order. */
export interface MessageStepper {
  /** Open a new message block at the user row's absolute turn index. */
  onUserRow: (absoluteTurnIndex: number) => void;
  /** Map an assistant row's absolute index back to its per-message step. */
  stepFor: (absoluteTurnIndex: number) => number;
}

/**
 * Inverse (restore): a stepper that maps absolute SQLite turn indices back
 * to per-message display steps ("第 N 步"). Owns the block-base state and
 * its reset rule so restore never re-derives the arithmetic that guards
 * against primary-key collisions. Defensive: before any user row is seen,
 * the absolute index is returned unchanged (an orphaned assistant row).
 */
export function makeMessageStepper(): MessageStepper {
  let base: number | null = null;
  return {
    onUserRow(absoluteTurnIndex) {
      base = absoluteTurnIndex;
    },
    stepFor(absoluteTurnIndex) {
      return base !== null ? absoluteTurnIndex - base + 1 : absoluteTurnIndex;
    },
  };
}
