# Galley Native Slice 8 Morphling Mode

Date: 2026-06-17

Slice 8 makes Morphling launchable as a hidden native Goal proposal. It is a
structured Goal mode, not a new model-facing tool and not an automatic
self-evolution path.

## Landed

- Added `galley goal morphling <target>`.
- The command requires `GALLEY_NATIVE_EXPERIMENTAL=1` and creates a
  `runtimeKind = galley_native` Goal proposal.
- The generated objective captures target/source lock, user objective,
  same-test evidence, component strategy, requested output, safety boundaries,
  and final deliverable requirements.
- Built-in `capability://morphling` resources now describe Morphling as a Goal
  mode with same-test comparison and disabled capability-pack promotion gates.
- Existing Goal confirmation, budget, worker limit, task board, deliverable, and
  final synthesis semantics stay in control.

## User Impact

Morphling dogfood can now start from one command while preserving the user's
control point: proposal first, explicit confirmation second. The user gets a
clear target and evidence contract instead of asking an agent to vaguely "learn
this thing."

## Boundaries

- No database `goal_mode` field was added.
- No standalone `morphling` tool was added.
- No capability-pack script execution or activation path was added.
- Candidate capability packs are deliverables for review, not active runtime
  extensions.

## Verification

- Added template unit tests for same-test evidence, proprietary-code blocking,
  fallback test construction, and empty target validation.
- Added CLI integration coverage for `goal morphling` creating a native proposal.
- Updated capability resource tests for Morphling same-test and promotion-gate
  resources.
