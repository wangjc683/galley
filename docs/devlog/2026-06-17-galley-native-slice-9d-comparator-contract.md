# Galley Native Slice 9D Comparator Contract

Date: 2026-06-17

Status: report-contract checkpoint landed. No comparator runner, runtime
behavior, schema, UI, or managed GA execution changed.

## Context

Slice 9C proved the schema v1 CLI/Supervisor compatibility path for hidden
native sessions. The next phase is managed-vs-native semantic comparison.

Starting by writing a runner would mix three unstable things: model variance,
managed/native environment setup, and unclear pass/fail rules. Slice 9D-A fixes
the report contract first so future runner output is reviewable.

## Decisions

- Added `docs/galley-native/parity-comparator-report.md`.
- Split Slice 9D into:
  - 9D-A report contract;
  - 9D-B first local report writer;
  - 9D-C managed/native command comparison for P01/P03/P04/P14/P18;
  - 9D-D Browser and fallback scenarios P08/P19.
- First scenario batch: P01, P03, P04, P08, P14, P18, P19.
- Verdicts: `pass`, `fail`, `accepted_gap`, `blocked`, `not_run`.
- Comparison dimensions: outcome, tool/action, event rhythm, approval,
  side effects, memory policy, workspace policy, recovery, and persisted state.
- Report JSON keeps both `managed` and `native` objects present even when one
  side is blocked.
- Safety rules forbid external GA state writes and require temporary
  workspaces/test pages for side-effect scenarios.

## Rejected Alternatives

- Start with Goal Hive or Morphling. Rejected because those need dogfood
  evidence in Slice 9E before semantic comparison is meaningful.
- Use exact text matching. Rejected because parity is user-visible semantic
  equivalence, not prose identity.
- Let a model judge the report. Rejected for the first runner because the
  comparator itself must produce inspectable evidence, not a second opaque
  opinion.

## User Impact

No user-facing behavior changed. The impact is rollout discipline: native
opt-in beta will require reports with explicit verdicts and accepted gaps
instead of anecdotal "seems comparable" claims.

## Next

Implement Slice 9D-B: a first local report writer that can produce the contract
shape for fixture scenarios before it runs real managed/native commands.
