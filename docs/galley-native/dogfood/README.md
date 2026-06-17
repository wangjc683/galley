# Galley Native Dogfood Kit

Status: Slice 9E-B prep kit, 2026-06-17.

This folder turns the Slice 9E evidence format into runnable maintainer
checklists. It does not add telemetry, runtime behavior, schema, UI, or
automatic fallback.

## First Pass

Run the support-readiness pass first:

- [P08/P18/P19 Support Readiness Runbook](./support-readiness-runbook.md)
- [Support Readiness Record Template](./support-readiness-record-template.md)

Why this pass first:

- P08 Browser Control is the highest-friction desktop dependency.
- P18 failure recovery tells us whether native can guide the next action.
- P19 fallback determines whether hidden beta remains reversible.

Do not start with memory, Goal Hive, or Morphling dogfood unless support
readiness already has a usable baseline. Those workflows are more useful after
browser/recovery/fallback friction is visible.

## Local Artifact Paths

Recommended local-only paths:

```text
.cache/galley-native-dogfood/9e-b/
.cache/galley-native-dogfood/9e-b/parity/
.cache/galley-native-dogfood/9e-b/screenshots/
```

`.cache/galley-native-dogfood/` is ignored by git. Keep raw dogfood notes,
screenshots, parity reports, session ids, browser URLs, and model output there
unless they have been sanitized.

Commit only sanitized conclusions:

- verdicts;
- accepted gaps;
- blockers;
- non-sensitive next actions;
- links to committed docs, not private local paths.

## What To Capture

Capture enough to answer:

- Did the user-visible task complete?
- If it failed, did native name the problem and next action?
- Did any side effect require approval?
- Is state still readable?
- Can managed still continue the work?
- Is the gap safe for hidden dogfood, opt-in beta, or neither?

Avoid over-capturing:

- no credentials;
- no private browser page content;
- no proprietary workspace paths;
- no full model transcript unless explicitly sanitized;
- no external GA state writes for fallback evidence.

## Output

After a run, the maintainable output should be one short sanitized summary:

- overall verdict;
- scenario verdicts for P08/P18/P19;
- accepted gaps and blockers;
- next implementation/documentation action.

The raw local notes can stay uncommitted.
