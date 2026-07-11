# 2026-07-11 — AgentTurn construction gets a single home (`lib/agent-turn.ts`)

## Outcome

The live `turn_end` path (`lib/ipc-handlers.ts`) and the SQLite restore
path (`stores/messages/rowsToTurns.ts`) used to build the same
`AgentTurn` shape independently, kept in sync by "keep in sync" /
"Mirrors turnFromTurnEnd's gate" comments across three sites. All shared
rules now live once in `gui/src/lib/agent-turn.ts` (same single-home
pattern as `lib/turn-index.ts`):

- `toolEventsFromRaw(calls, results, idPrefix)` — defensive narrowing,
  id resolution, ≤500-char preview, denial detection. `idPrefix` keeps
  each caller's id namespace (live `t-`, restore `t-${turn_index}-` for
  session-wide React keys).
- `isFinalAnswerTurn(tools)` — the `no_tool` / zero-tools gate.
- `normalizeFinalAnswer(raw)` — empty/whitespace/null → null.
- `buildAgentTurn(fields)` — assembly + presence normalization.

Live-only derivation (thinking/preamble out of raw `responseContent`)
stays in ipc-handlers by design — restore reads the persisted columns.
Legacy-row notes stay in rowsToTurns (history repairs, not shape rules).

Motivating friction (2026-07-11 architecture review, candidate 4): a
one-sided edit rendered a session one way live and another way after
reopen, and no test could catch it.

## Decisions (grilling 2026-07-11)

1. **New `lib/agent-turn.ts`**, not folded into rowsToTurns — the module
   name must not lie about who it serves.
2. **Persist consumes the built turn.** `turn_end` builds the
   `AgentTurn` unconditionally (also for `visibility: internal`);
   `persistTurnEndToMessages` receives it and persists
   `turn.thinking/preamble/finalAnswer/summary/telemetry` directly. The
   third re-derivation (the mirrored gate in the persist body) is
   deleted — "what rendered live is what lands in SQLite" is now data
   flow, not comment discipline.
3. **The already-diverged null-preview behavior unifies to "no
   preview".** Before: live rendered a literal `"null"` preview for a
   null tool-result content; restore showed nothing. `"null"` was noise;
   changing the transient live rendering is safer than changing how all
   historical sessions reopen.
4. **Round-trip test** (`agent-turn.test.ts`): drives the REAL
   `dispatchIPCEvent` → store for the live turn, captures the real
   `persist_assistant_message` payload, rebuilds a `MessageRow` from it,
   runs the REAL `rowsToTurns`, and asserts field-for-field equality —
   including `restored displayStep === live GA step` (crossing the
   turn-index identity invariant). Two variants: intermediate tool turn,
   final-answer turn.

## Findings along the way

- The `rowsToTurns` comment attributing the `""`-final_answer fix to
  commit `1d0c404` pointed at an unrelated commit (LLM list caching),
  and the deeper claim was wrong in a useful way: **persist still stored
  `""`** for tool-only turns (Core passes `final_answer` through
  verbatim), so the restore-side normalization was load-bearing for
  current rows, not just legacy ones. Hence `normalizeFinalAnswer` lives
  in the shared module. Post-change, persist stores NULL for tool-only
  turns (matches the rendered `finalAnswer: null`); restore handles both
  generations of rows.

## Verification

- `pnpm --dir gui test`: 21 files / 124 tests green (new: 5 unit + 2
  round-trip + assertions on the null-preview unification).
- `pnpm --dir gui typecheck`, `pnpm --dir gui lint`, `git diff --check`
  clean. No Tauri-dependent surface touched (pure lib/store change);
  visual acceptance in the real app stays with JC per the workflow
  defaults.
