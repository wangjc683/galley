# Galley Native Slice 4B3 Approved File Read Continuation

## Date / Status / Related

- Date: 2026-06-16
- Status: Landed
- Related:
  - [Galley Native Runtime](../galley-native/runtime.md)
  - [Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)
  - Slice 4B2: [Tool Result Continuation](./2026-06-16-galley-native-slice-4b2-tool-result-continuation.md)

## Context

Slice 4B2 made auto-approved workspace `file_read` useful: the model could ask
for a read, Core executed it, and Core sent the result back to the model for one
final answer. The approval path still stopped one step earlier: an outside
absolute `file_read` could be approved and recorded, but the user only got the
raw tool result rather than the final answer they asked for.

That gap mattered for productization. Approval is an interruption in the same
user task, not a new task. Once the operator allows a read-only file access, the
native runtime should finish the original turn.

## Decisions

- Hidden `galley_native` now continues after an approved successful
  `file_read`.
- The continuation is intentionally one-hop and non-streaming:
  original user task + assistant tool request + approved tool result -> final
  model answer.
- Core updates the existing assistant message for that turn instead of appending
  a second assistant row.
- The tool result remains persisted on `messages.tool_results`; the final answer
  replaces `content` / `final_answer` / `summary` on the assistant row.
- The approval event stream now includes `turn_progress` with
  `source=model_continuation`, a final `turn_end`, and
  `run_complete(mode=approval_response_continuation)`.
- Socket / CLI approval response may include optional `assistantMessage` when a
  continuation answer is produced.
- The GUI message store replaces an existing agent turn with the same
  `turnIndex`, so approval continuation completes the visible waiting turn
  instead of duplicating it.

## Rejected Alternatives

- **Return only the tool result after approval.** This is technically simpler
  but leaves the user to interpret file contents manually after granting access.
- **Append a new assistant turn after approval.** This makes the conversation
  look like the agent started a new step, when the approval actually resumes the
  suspended step.
- **Generalize continuation to every approved tool now.** Too broad. Write,
  process, browser, memory, Goal, and Morphling tools still need their own risk
  and preview contracts.
- **Implement durable `always_allow_project` / `always_allow_global` policy
  storage in this slice.** Approval decisions still unblock only the suspended
  call until a dedicated policy slice exists.

## Open Questions

- Should the later full tool loop support streaming continuation after tools, or
  keep tool-result turns non-streaming for simpler audit and replay?
- Should failed approved `file_read` results also get a model continuation, or
  should failures stay as direct tool-result completions?
- What is the exact preview object shape for `file_patch`, and how much of it
  must be visible before the first write-capable executor lands?

## Next

- Start Slice 4B4 as preview-first `file_patch`, not browser or code execution.
- Keep `file_write` behind the same approval/preview vocabulary after
  `file_patch` is stable.
- Keep Browser Control in Slice 4C so CDP readiness and recovery do not hide
  inside local file executor risk.

## Verification

- `cargo test --manifest-path core/Cargo.toml dispatch_session_approval_response_native_file_read_continues_to_final_answer --lib`
- `cargo test --manifest-path core/Cargo.toml native_ --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`
