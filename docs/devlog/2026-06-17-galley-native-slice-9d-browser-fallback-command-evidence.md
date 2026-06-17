# Galley Native Slice 9D Browser/Fallback Command Evidence

Date: 2026-06-17

Status: hidden command evidence extended to P08 and P19. No public Agent API,
schema, GUI, automatic Browser Control, runtime fallback, or default runtime
behavior changed.

## Context

Slice 9D-C added explicit command mode for P01, P03, P04, P14, and P18. The two
remaining first-batch scenarios were heavier:

- P08 Browser Control depends on browser readiness, CDP attachment, safe test
  pages, and recovery hints.
- P19 fallback depends on operator-visible state readability and a designed
  user action, not surprise automatic rerouting.

The next safe step is not to auto-launch browser flows. It is to let operators
capture explicit Browser/fallback evidence in the same report shape.

## Implemented

- Extended hidden `galley native-parity report --mode command` to all first
  batch scenarios: P01, P03, P04, P08, P14, P18, and P19.
- P08 success now produces `accepted_gap`, not `pass`, because command mode
  proves operator-supplied Browser readiness commands completed but does not
  prove automatic Browser Control parity.
- P08 success replaces the fixture-only blocker with an explicit
  `browserControl` accepted gap.
- P19 success preserves the fallback accepted gaps from the fixture report while
  adding command evidence.
- Verdict derivation now treats any `blocked` comparison dimension as
  `blocked`, even if a report accidentally omits a blocker row.

## Decisions

- Keep automatic CDP readiness, safe-page DOM/JS comparison, and browser
  recovery probes out of this slice.
- Keep fallback manual in this evidence layer. Native does not auto-reroute a
  turn to managed.
- Keep command mode hidden and operator-supplied. The comparator still does not
  invent managed/native commands.

## User Impact

No normal user behavior changes. For native rollout work, the impact is that
Browser/fallback risk is now visible in report artifacts instead of living only
as prose in the roadmap.

## Next

- Dogfood real P08 commands against a safe browser fixture page.
- Dogfood P19 fallback evidence with real native-readable state and managed
  continuation commands.
- Add automatic Browser/fallback presets only after those explicit commands
  prove stable.
