# Galley Native Slice 4A2C GUI Projection

## Date / Status / Related

- Date: 2026-06-16
- Status: implemented as hidden native GUI projection
- Related:
  - [Slice 4A2B Approval State](./2026-06-16-galley-native-slice-4a2b-approval-state.md)
  - [Galley Native Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)

## Context

Native tool and approval state existed in Rust Core and the socket/CLI path, but
the desktop GUI still understood only Python bridge IPC events. A hidden native
session opened in the GUI could therefore show persisted rows but not live
native tool progress, approval prompts, ask-user state, or approval results.

Before real local executors, the GUI must show the interaction shell clearly:
what native wants to do, what the human is approving or answering, and what
Core recorded after the decision.

## Decisions

- Rust Core now emits `native-runtime-event` Tauri events for native turns and
  native approval resolutions.
- The GUI maps native events into the existing message store and existing UI
  components instead of creating native-only conversation widgets.
- Native sessions opened in the GUI no longer attempt to spawn a Python bridge.
- GUI native sends call `native_session_run_turn` after the existing
  user-message persistence path, so the user turn still uses the current Core
  authority path.
- GUI native approvals call `native_approval_response`; Rust Core remains the
  source of truth for pending tool events, decisions, assistant `tool_results`,
  and session status.
- Restore now understands native-shaped `tool_calls` / `tool_results`
  (`name`, `argumentsJson`, `toolCallId`) as well as Python bridge-shaped
  payloads.

## Rejected Alternatives

- Add a parallel native approval UI: rejected because it would split user
  experience and duplicate the existing ApprovalForm / ToolCallout semantics.
- Make Rust native events pretend to be Python IPC events: rejected because the
  native runtime should keep its own semantic event shape; GUI owns projection.
- Let GUI write native `tool_events` decisions through the old
  `persist_tool_event_approval_decision` command: rejected because native
  approval state is already owned by Rust Core.
- Continue spawning Python bridge for native sessions just to reuse event
  plumbing: rejected because `galley_native` has no Python runner and fake
  bridge errors would confuse users.

## Open Questions

- Should hidden native get a small experiment badge in the conversation header
  before real executors land?
- Should native running tool progress become visible before Slice 4B, or is
  pending/settled projection enough until real file/code tools exist?
- Should GUI expose a read-only native event log once event persistence exists?

## Next

1. Start Slice 4B local file/code executors using the landed GUI approval
   surface.
2. Keep Browser Control separate as Slice 4C.
3. Add durable allow-policy UI only after project/global approval policy is
   defined.

## Verification

- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo test --manifest-path core/Cargo.toml native_ --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_ --lib`
- `cargo check --manifest-path cli/Cargo.toml`
