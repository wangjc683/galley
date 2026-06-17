# Galley Native Slice 9B Native Harness

Date: 2026-06-17

Status: first deterministic parity-anchor batch landed. This does not expose
native in Settings, add managed-vs-native comparison, or change runtime
behavior.

## Context

Slice 9A froze the parity scenario manifest. Slice 9B starts turning that
contract into executable evidence for native itself before comparing native to
managed GA.

The codebase already had many native runtime/tool tests from earlier slices,
but they were named by implementation milestone rather than parity scenario.
That made it harder to answer which Pxx scenarios were currently protected.

## Landed

- Added a Slice 9B native parity anchor ledger in `core/src/native_runtime.rs`
  tests.
- The anchor ledger reads the parity scenario manifest and verifies anchored
  Pxx IDs exist in the docs.
- Renamed/anchored deterministic native runtime tests for:
  - P01 basic no-tool answer;
  - P03 `code_run` approval preview;
  - P04 file patch preview approval;
  - P05 large code answer without tool call;
  - P06 high-risk approval block;
  - P07 `ask_user` wait state;
  - P09 `memory://` read through `file_read`;
  - P11 `capability://` read-only resource behavior;
  - P12 workspace resource index;
  - P18 actionable browser/workspace recovery.
- Added direct P09 coverage proving memory resources are read through
  `file_read`, not a new memory tool.
- Added direct P11 coverage proving capability resources are read-only and
  `code_run` refuses `capability://` script execution.
- Added P05 coverage so large code blocks without tool calls stay no-tool final
  answers.

## User Impact

No user-facing behavior changed. The impact is confidence: native beta exposure
now has a growing executable checklist instead of relying only on historical
slice tests and prose.

## Deferred

- Broader native integration harness beyond existing socket/file/code tests.
- CLI/Supervisor schema and event compatibility: Slice 9C.
- Managed-vs-native semantic comparator: Slice 9D.
- Dogfood evidence and troubleshooting: Slice 9E.
- Settings opt-in and managed fallback exposure: Slice 9F.

## Verification

- `cargo test --manifest-path core/Cargo.toml native_runtime::tests --lib`
- Pxx filters for P01, P03, P04, P05, P06, P07, P09, P11, P12, P18.
