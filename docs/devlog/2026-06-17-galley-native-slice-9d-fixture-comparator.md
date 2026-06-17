# Galley Native Slice 9D Fixture Comparator

Date: 2026-06-17

Status: hidden fixture comparator landed. No user-facing runtime behavior,
schema, GUI, managed GA execution, native session execution, or Browser Control
behavior changed.

## Context

Slice 9D-A defined the managed-vs-native report contract. The next useful step
was to make that contract executable without mixing in model variance, live
runtime setup, Browser Control readiness, or external GA state risk.

The product goal is rollout discipline: before native becomes a visible beta,
we need reports that name exactly where native matches managed, where the
difference is accepted for the current phase, and where the scenario is still
blocked.

## Implemented

- Added a hidden CLI command:
  `galley native-parity report`.
- The command emits a local JSON array matching the Slice 9D report contract.
- Default scenario set is the first 9D batch: P01, P03, P04, P08, P14, P18,
  and P19.
- `--scenario <ID>` can be repeated to narrow the report.
- `--output <path>` writes the bundle to disk and returns a small JSON summary.
- `--pretty` formats the bundle for human review.
- Verdicts are derived from comparison dimensions, accepted gaps, and blockers
  instead of being hand-filled per scenario.
- Ordinary `galley --help` keeps the command hidden.

## Fixture Verdicts

- P01: `accepted_gap` because native has additive runtime envelope events.
- P03: `accepted_gap` until real command progress parity is captured.
- P04: `accepted_gap` until real temp-workspace patch parity is captured.
- P08: `blocked` because fixture mode does not launch CDP or a safe browser
  page.
- P14: `pass` for copy-to-native source immutability and copied visible
  context shape.
- P18: `accepted_gap` until real recovery categories are compared.
- P19: `accepted_gap` because fallback is manual while native remains hidden
  beta.

## Decisions

- Keep the comparator hidden and internal. This is not a public Agent API
  command.
- Start with fixture evidence shape rather than live commands. This avoids
  unreliable tests that depend on a model, the desktop app, a running Core
  socket, or a browser.
- Keep blocked scenarios in the report instead of omitting them. Missing P08
  evidence is itself a beta blocker.
- Do not introduce a default report directory yet. The first writer only writes
  to stdout or an explicit `--output` path.

## Deferred

- Live managed/native command runner for P01, P03, P04, P14, and P18.
- Browser Control readiness and safe-page comparison for P08.
- Real operator fallback evidence for P19.
- GUI/Settings surfacing of comparator reports.
- Default report naming and retention policy.

## User Impact

No normal user behavior changes. The impact is on product safety: hidden native
work now has an executable parity-report artifact, so future beta decisions can
be based on explicit pass/fail/accepted-gap/blocker evidence instead of manual
memory.
