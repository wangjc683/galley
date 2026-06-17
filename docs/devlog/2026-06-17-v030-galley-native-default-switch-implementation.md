# 2026-06-17 - v0.3.0 Galley Native default switch implementation

## Summary

First implementation slice for the v0.3.0 built-in runtime switch landed.
`galley_native` is now the default Galley-owned runtime in code; Python managed
GA remains available as an Advanced legacy fallback, and external GA remains
user-owned and unchanged.

## What Changed

- Added migration 024 to promote Galley-owned `managed` session / Goal runtime
  metadata to `galley_native`, clearing managed-only prompt profile metadata.
- Preserved `external` runtime rows and external active-runtime preference.
- Removed the native environment gate from runtime filtering, session creation,
  Goal proposals, and CLI `--runtime galley-native`.
- Changed GUI prefs to default to `galley_native` when no external GA path is
  configured.
- Moved Settings -> Runtime primary card to Galley Native and exposed old Python
  managed GA as an Advanced fallback.
- Kept image attachment submission on legacy managed GA only until native accepts
  attachments.
- Updated Agent API docs and tests to treat `galley-native` as a first-class
  runtime value.

## User Impact

Built-in users should keep Galley-owned history, model config, Projects, and
Channels while landing on the native runtime path. External GA users are not
migrated. If dogfood hits a native blocker, Settings -> Runtime -> More can
switch back to the legacy bundled GA path.

## Remaining Gates

- Real dogfood across chat, file/code/browser tools, approvals, memory, Goal,
  recovery, and fallback.
- Native attachments support or a deliberate release-note limitation.
- Visual acceptance of Settings -> Runtime in the desktop app.
- Final release-channel promotion after v0.3.0 packaging.

## Verification

- `cargo test --workspace`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`
