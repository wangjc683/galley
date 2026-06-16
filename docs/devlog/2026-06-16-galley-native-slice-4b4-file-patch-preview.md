# Galley Native Slice 4B4 File Patch Preview

## Date / Status / Related

- Date: 2026-06-16
- Status: Landed
- Related:
  - [Galley Native Runtime](../galley-native/runtime.md)
  - [Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)
  - Slice 4B3: [Approved File Read Continuation](./2026-06-16-galley-native-slice-4b3-approved-file-read-continuation.md)

## Context

After `file_read` became useful, the next product risk was write approval. A
native runtime that asks the user to approve "modify file" without showing the
actual change recreates the approval black box Galley is supposed to remove.

Existing Galley UI already has a `file_patch` approval renderer backed by
`PatchView`. That renderer expects the same shape GenericAgent uses:
`path`, `old_content`, and `new_content`.

## Decisions

- Hidden `galley_native` now implements `file_patch` as GA-style targeted text
  replacement.
- The model-facing schema uses `path`, `old_content`, and `new_content`.
- Core normalizes `oldContent` / `newContent` aliases to snake_case before
  emitting tool events and persisting approval args.
- A valid `file_patch` always pauses for approval before writing.
- Patch execution rereads the target file at approval time and writes only when
  `old_content` matches exactly once.
- Successful patch results set `sideEffectsPerformed: true`.
- `patch`-only or otherwise opaque calls fail without approval, so the user is
  not asked to approve an edit that cannot be previewed.

## Rejected Alternatives

- **Parse arbitrary unified diff strings in V1.** Too much surface for the first
  write-capable native executor. GA's unique `old_content` replacement is
  narrower, mature, and already matched by Galley's approval UI.
- **Ask for approval even when preview args are missing.** That would force the
  user to approve a black-box write. Invalid patch requests should fail and let
  the model correct itself in a later full tool loop.
- **Auto-apply workspace patches without approval.** Not acceptable for a first
  write path. Even safe-looking workspace edits need explicit visible consent.
- **Trigger model continuation after successful patch.** Deferred. The immediate
  value is trustworthy approval and file mutation; continuation policy should be
  decided after write semantics are stable.

## Open Questions

- Should successful `file_patch` trigger one model continuation like
  `file_read`, or should write tools stay tool-result-only until the full loop?
- Should Core store a file fingerprint at preview time and require it to match
  before applying, or is exact unique `old_content` enough for V1?
- What is the safest `file_write` contract: full replacement preview only,
  append/prepend modes, or create-only first?

## Next

- Implement `file_write` only after its preview contract is explicit.
- Keep `code_run` separate because command policy needs timeout/cwd/stdout/stderr
  semantics, not just approval plumbing.
- Keep Browser Control in Slice 4C.

## Verification

- `cargo test --manifest-path core/Cargo.toml file_patch --lib`
- `cargo test --manifest-path core/Cargo.toml native_ --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`
