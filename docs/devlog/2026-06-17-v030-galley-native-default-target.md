# 2026-06-17 - v0.3.0 Galley Native default target

## Summary

Galley is moving the next release target from the `v0.2.x` patch line to
`v0.3.0`.

The reason is product semantics, not Agent API breakage: the built-in runtime
path is planned to move from Python managed GA to Rust `galley_native`.

## Decision

- `galley_native` becomes the v0.3.0 target default runtime for built-in Galley
  users after dogfood gates pass.
- Python managed GA moves to an Advanced legacy fallback, not a peer default
  path.
- `external_ga` remains unchanged for user-owned GenericAgent checkouts.
- Existing Galley-owned data must remain continuous: sessions, messages, tool
  events, attachments, projects, model config, and Channels config.
- Old Python managed GA internal state is not migrated: managed GA memory,
  skills, SOP, and self-edit traces stay with the legacy runtime.

## Why v0.3.0

`v0.2.x` releases were stable patches around the existing built-in Python
managed GA experience. Making Rust `galley_native` the default changes the
default user path and warrants a minor version bump even if `schemaVersion: 1`
remains stable.

## Release Gate

Do not promote v0.3.0 until:

- native dogfood covers ordinary chat, file/code/browser tools, approvals,
  memory, Goal, and recovery;
- old built-in users can see and continue their Galley-owned history;
- managed model config is reused without re-entry;
- Channels config stays available under `galley_native`;
- Python managed GA fallback is reachable from Advanced;
- external GA users are not migrated or modified.

## Implementation Notes

- Version metadata now targets `0.3.0`.
- Follow-up implementation has landed the first default-switch slice:
  `galley_native` is the persisted built-in default, migration 024 promotes
  Galley-owned managed metadata to native, CLI `galley-native` no longer
  requires `GALLEY_NATIVE_EXPERIMENTAL`, and Settings presents Python managed GA
  as an Advanced fallback.
- `v0.2.8` remains the current published GitHub Latest and default update
  channel target until a real v0.3.0 release is published and promoted.
- Public v0.3.0 promotion still remains gated by dogfood and parity work.
