# Galley Native Slice 4B6 Code Run

## Date / Status / Related

- Date: 2026-06-16
- Status: Landed
- Related:
  - [Galley Native Runtime](../galley-native/runtime.md)
  - [Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)
  - Slice 4B5: [File Write Preview](./2026-06-16-galley-native-slice-4b5-file-write-preview.md)

## Context

After read and write file executors landed, `code_run` was the remaining local
executor in Slice 4B. The product risk is different from file writes: the user
must know which command will run, where it will run, how long it may run, and
what happened afterward.

This slice turns hidden native `code_run` from an approval stub into a real
approval-gated process executor. It does not add Browser Control, memory writes,
Goal Hive, Morphling, streaming stdout/stderr progress, or durable allow-policy
storage.

## Decisions

- Hidden `galley_native` now implements `code_run` as approval-gated shell
  command execution.
- Core normalizes `cmd` / `code` into `command`.
- Core normalizes `timeout_seconds` into `timeoutSeconds`, defaults timeout to
  30 seconds, and rejects values above 120 seconds.
- Omitted `cwd` resolves to the Project workspace.
- Relative `cwd` must resolve inside the Project workspace.
- Explicit absolute `cwd` is allowed only through the normal approval path.
- Core adds `resolved_cwd` to pending approval args before persistence and event
  emission.
- Missing command, invalid timeout, missing workspace, or unresolvable cwd fails
  without approval and without spawning a process.
- Approved execution closes stdin, captures stdout/stderr with caps, records
  exit code, timeout state, and duration, and kills timed-out commands.
- Once a process is spawned, `sideEffectsPerformed` is `true` even when the
  command exits non-zero or times out.
- The GUI `code_run` approval renderer now shows resolved cwd and timeout.
- Managed GA and external GA behavior is unchanged.

## Rejected Alternatives

- **Use the current process cwd when no Project workspace exists.** That would
  recreate the old cwd coupling Native is explicitly avoiding. No workspace and
  no explicit cwd means the tool request is invalid.
- **Run command requests with missing preview fields after approval.** Rejected
  for the same reason as file write previews: the approval card must show a
  Core-resolved command, cwd, and timeout.
- **Add streaming stdout/stderr in this slice.** Useful, but it changes live
  event semantics. First land deterministic execution and final result capture.
- **Treat non-zero exit as no side effect.** A process ran; it may have touched
  files or external state before exiting. The audit bit should stay true.

## Open Questions

- Should `code_run` stream stdout/stderr progress before `tool_end`?
- Should successful `code_run` trigger one model continuation like approved
  `file_read`, or wait for the full autonomous loop?
- Should command risk classification eventually inspect command intent instead
  of treating every runnable command as the same risk policy?
- Should native add a shell-less argv form for capability packs that want less
  quoting ambiguity?

## Next

- Decide continuation policy for write/process tools.
- Decide whether stdout/stderr streaming belongs before Browser Control.
- Keep Browser Control as Slice 4C.
- Keep memory, Goal Hive, and Morphling in later slices.

## Verification

- `cargo test --manifest-path core/Cargo.toml code_run --lib`
- `cargo test --manifest-path core/Cargo.toml native_ --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`
