# Galley Native Slice 9A Parity Contract

Date: 2026-06-17

Status: documentation checkpoint landed. No runtime, schema, UI, or test
behavior changed.

## Context

After Slice 8, `galley_native` has hidden native chat/tool execution, memory
resources and low-risk memory writes, workspace continuity, native Goal Hive,
and Morphling proposal mode. The next large milestone is proving native can
replace `managed_ga` for selected built-in users.

The original Slice 9 scope was too broad: parity harness, managed-vs-native
comparison, dogfood metrics, Settings opt-in, fallback routing, and
troubleshooting docs were all listed as one slice.

## Decisions

- Split Slice 9 into 9A-9F:
  - 9A parity contract and scenario manifest;
  - 9B native mock/integration harness coverage;
  - 9C CLI/Supervisor event compatibility;
  - 9D managed-vs-native semantic comparator;
  - 9E dogfood evidence and troubleshooting;
  - 9F opt-in beta and managed fallback.
- Added `docs/galley-native/parity-scenario-manifest.md` as the scenario source
  of truth.
- Defined comparison rules around outcome, tool/action class, event rhythm,
  approval, memory policy, workspace/session persistence, recovery, and
  persisted state.
- Defined harness layers: `unit`, `mock_native`, `native_integration`,
  `managed_native_comparison`, and `dogfood`.
- Defined gate classes: `beta-blocker`, `default-blocker`,
  `dogfood-evidence`, and `support-readiness`.
- Listed required scenario IDs P01-P19, including basic answer, model adapters,
  file/code, approval, ask-user, browser, memory, capability resources,
  workspace, continue/copy, CLI/Supervisor, Goal Hive, Morphling, failure
  recovery, and managed fallback.

## Rejected Alternatives

- Ship Slice 9 as one implementation slice. Rejected because it would hide risk
  by mixing harness infrastructure, UI exposure, fallback, and dogfood evidence.
- Add Settings opt-in first. Rejected because a visible runtime toggle is a
  product promise; it belongs after beta-blocker evidence exists.
- Compare exact model text. Rejected because native parity should be semantic
  and user-visible, not word-for-word.

## Open Questions

- Which P01-P19 scenarios should 9B implement first if time is constrained?
- Should parity evidence stay in devlogs/test output, or should 9D introduce a
  structured local report file?
- What is the smallest useful GUI surface for inspecting parity evidence before
  9F opt-in?

## Next

Start Slice 9B with native mock/integration coverage for the beta-blocker
scenarios that do not require managed comparison or real model dogfood.
