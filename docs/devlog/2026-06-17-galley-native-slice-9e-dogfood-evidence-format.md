# Galley Native Slice 9E Dogfood Evidence Format

Date: 2026-06-17

Status: local dogfood evidence/checklist format landed. No runtime behavior,
schema, GUI, command execution, fallback routing, or telemetry changed.

## Context

Slice 9D made the managed-vs-native report contract executable. That is still
not enough for dogfood-heavy scenarios: Browser Control, memory trust,
continuation, Goal Hive, Morphling, recovery, and fallback need real operator
judgment.

The next step is to standardize what a dogfood record must contain before any
Settings opt-in work starts.

## Implemented

- Added `docs/galley-native/dogfood-evidence.md`.
- Defined a local markdown evidence template.
- Scoped Slice 9E dogfood to:
  - P08 Browser Control;
  - P10 memory write;
  - P13 continue;
  - P16 Goal Hive;
  - P17 Morphling;
  - P18 failure recovery;
  - P19 managed fallback.
- Added scenario checklists with run steps, pass signals, and accepted-gap
  boundaries.
- Added troubleshooting matrix for model, browser, workspace, approval, memory,
  continuation, Goal Hive, Morphling, and fallback issues.
- Added a privacy rule: dogfood evidence stays local unless intentionally
  sanitized and committed.

## Decisions

- Keep dogfood metrics local/devlog-based for now. No telemetry is added.
- Treat dogfood evidence as separate from parity reports. A parity report is
  structured comparison evidence; a dogfood record is the lived operator
  outcome and recovery judgment.
- Use markdown records first. A database or GUI surface would be premature
  before the evidence shape proves useful.

## User Impact

No normal user behavior changes. The impact is rollout discipline: native
Settings opt-in should now be gated by real evidence records, not by scattered
notes or memory.

## Next

- Record the first real P08/P18/P19 support-readiness dogfood pass.
- Then record P10/P13 memory and continuation evidence.
- Then record P16/P17 Goal Hive and Morphling evidence.
