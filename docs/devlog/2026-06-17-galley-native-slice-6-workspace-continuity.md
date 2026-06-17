# Galley Native Slice 6 Workspace And Continuity

## Date / Status / Related

- Date: 2026-06-17
- Status: landed minimal Slice 6 implementation
- Related:
  - [Galley Native RFC 5](../galley-native/rfc-5-workspace-session-continuity.md)
  - [Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)

## Context

Slice 5 made native memory and capability resources readable/writable enough to
move into continuity. The user-facing goal for Slice 6 is not a new visible
workspace UI yet; it is the safer product invariant: native sessions must know
where work belongs, avoid concurrent writes into an occupied session, and offer
a copy-to-native path before native becomes a default runtime.

## Decisions

- Reuse existing Project `root_path` as the V1 native-only primary workspace.
  This avoids a migration in the first continuity slice and keeps
  managed/external cwd behavior untouched.
- Add Galley-owned native scratch directories under
  `native-session-scratch/<session_id>`. Slice 6 keeps scratch conservatively and
  does not implement cleanup jobs yet.
- Expose workspace state as read-only resources:
  `workspace://snapshot`, `workspace://index`, and `workspace://scratch`.
  `file_read` can read these resources without approval.
- Treat missing configured Project workspace as an actionable degraded state,
  not as implicit scratch fallback. The native context tells the operator to
  locate the folder, clear the binding, or continue scratch-only.
- Mark native sessions `running` while a native turn is executing. A second
  native `session.send` or GUI native run is refused before writing a user row,
  returning `session_occupied`.
- Add `session.copy_to_native` and CLI `galley session copy-to-native <id>`.
  The new session copies visible transcript, Project association, summary/turn
  count, and compatible managed model selection. It does not mutate the source.
  Message attachments are not copied in this slice.
- Define the Slice 6 restore guarantee narrowly: after app/Core restart, an idle
  native session can rebuild a later turn from Galley DB transcript, latest
  working checkpoint, memory/capability resources, and workspace resources.

## Rejected Alternatives

- Do not add a new Project workspace schema column yet. The existing
  `root_path` is enough to prove native-only semantics and avoids schema churn.
- Do not silently fallback to scratch when a configured Project workspace is
  missing. That would hide a user-relevant problem and could make edits land in
  the wrong place.
- Do not auto-run the model after copy-to-native. Copy is a state operation;
  continuing should be explicit through the next `session.send`.
- Do not copy external GA model selection into native. External model names
  belong to the user-owned GA checkout and are not a stable native model key.
- Do not copy message attachments yet. Native multimodal migration needs its
  own resource policy instead of silently duplicating files.
- Do not persist the native event bus in this slice. Transcript restore matters
  first; replaying old live events after restart is a different product problem.

## Open Questions

- Should Project workspace graduate from legacy `root_path` into a dedicated
  native workspace field once the UI exists?
- What should the scratch retention window be, and where should users inspect or
  clean old scratch directories?
- How should GUI file mention autocomplete rank `workspace://index`, recent
  files, memory refs, and capability refs?
- What is the exact recovery UI for mid-approval or mid-ask-user native sessions
  after app restart?
- Should copy-to-native add an explicit system message linking the source
  session, or is origin metadata plus title enough?

## Next

- Add GUI affordances for native workspace binding, missing-workspace recovery,
  and copy-to-native.
- Add parity tests around `workspace://` prompt/resource behavior.
- Add native memory inspect/undo UI so Slice 5 durable memory becomes operable.
- Design a heartbeat/lease table before native background workers or native Goal
  Hive create true multi-owner concurrency.

## Verification

- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_copy_to_native_copies_visible_context_only --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_send_native_running_session_is_occupied_without_write --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo test --manifest-path core/Cargo.toml app_paths --lib`
- `git diff --check`
