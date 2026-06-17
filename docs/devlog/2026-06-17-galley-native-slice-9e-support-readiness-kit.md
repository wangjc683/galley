# Galley Native Slice 9E Support Readiness Kit

Date: 2026-06-17

Status: P08/P18/P19 dogfood prep kit landed. No runtime behavior, schema, GUI,
command execution, fallback routing, or telemetry changed.

## Context

Slice 9E-A defined the general dogfood evidence format. Before JC starts real
dogfood, the first pass needs a narrower runnable kit so the evidence does not
scatter across ad hoc notes.

The first dogfood pass should focus on support readiness:

- P08 Browser Control;
- P18 failure recovery;
- P19 managed fallback.

These determine whether hidden native can fail clearly and remain reversible.

## Implemented

- Added `docs/galley-native/dogfood/README.md`.
- Added `docs/galley-native/dogfood/support-readiness-runbook.md`.
- Added `docs/galley-native/dogfood/support-readiness-record-template.md`.
- Added `scripts/init-native-dogfood.mjs` to create the ignored local artifact
  directories and dated support-readiness record.
- Linked the kit from `dogfood-evidence.md` and the Galley Native README.
- Updated Slice 9E status to distinguish prep kit from real dogfood evidence.
- Added `.cache/galley-native-dogfood/` to `.gitignore` for raw local notes,
  screenshots, parity reports, browser context, workspace paths, and model
  output.

## Decisions

- Keep raw evidence local by default. Commit only sanitized verdicts, accepted
  gaps, blockers, and next actions.
- Start with P08/P18/P19 before memory, continuation, Goal Hive, or Morphling.
  The first question is whether native can recover and fall back safely.
- Use hidden command evidence only as an attachment. It is not the dogfood
  verdict, especially for Browser Control.

## User Impact

No normal user behavior changes. The impact is on dogfood quality: JC can now
run the first native support-readiness pass with a fixed checklist and privacy
boundary.

## Next

- JC runs the P08/P18/P19 support-readiness pass locally.
- Summarize sanitized verdicts, accepted gaps, blockers, and next actions in a
  follow-up devlog.
- Use that evidence before adding Settings opt-in work.
