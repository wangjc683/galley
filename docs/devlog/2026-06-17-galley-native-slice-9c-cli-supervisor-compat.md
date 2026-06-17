# Galley Native Slice 9C CLI Supervisor Compatibility

Date: 2026-06-17

Status: P15 schema/event compatibility landed. No Settings opt-in,
managed-vs-native comparator, or runtime behavior change.

## Context

Slice 9B anchored native runtime behavior with deterministic Pxx tests. Slice 9C
checks the public Agent/Supervisor contract: schema v1 callers must tolerate the
hidden `galley_native` runtime value and native watch event payloads without a
breaking parser update.

## Landed

- Added CLI integration coverage:
  `p15_cli_schema_v1_lists_native_runtime_with_legacy_projection`.
- The CLI test runs `--schema=1 sessions list --runtime galley-native` with the
  native gate enabled and verifies:
  - `runtimeKind = "galley_native"`;
  - legacy `gaRuntimeKind = "galley_native"`;
  - `runtimeLabel = "Galley Native"`.
- Added socket/Core coverage:
  `p15_socket_schema_v1_native_watch_events_are_additive`.
- The socket test creates a native session with `schemaVersion: 1`, watches it
  with `schemaVersion: 1`, wraps native events in the normal stream envelope,
  and deserializes them through a legacy view that only reads `stream`,
  `requestId`, `data.kind`, `data.sessionId`, and end-frame `reason`.
- Updated Agent API docs to state native stream frames are additive and unknown
  native event fields should be ignored by Supervisor callers.

## User Impact

No user-facing runtime behavior changed. The impact is compatibility confidence:
trusted local agents and Supervisors can handle hidden native sessions without
depending on every native-specific event field.

## Deferred

- Real Supervisor dogfood process.
- `session follow` parity-specific tests.
- Managed-vs-native semantic comparator: Slice 9D.
- Opt-in beta Settings exposure and managed fallback UI: Slice 9F.

## Verification

- `cargo test --manifest-path cli/Cargo.toml p15_cli_schema_v1_lists_native_runtime_with_legacy_projection`
- `cargo test --manifest-path core/Cargo.toml p15_socket_schema_v1_native_watch_events_are_additive --lib`
