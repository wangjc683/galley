# Galley Native Slice 3B Streaming

**Date**: 2026-06-16
**Status**: Implemented, hidden experimental OpenAI-compatible streaming
**Related**: [Galley Native](../galley-native/README.md), [Implementation Slices](../galley-native/implementation-slices.md), [Slice 3A Model Adapter](./2026-06-16-galley-native-slice-3a-model-adapter.md)

## Summary

Slice 3B lets hidden `galley_native` no-tool model turns stream
OpenAI-compatible chat-completions deltas through the existing native event bus
when the selected managed model has `"stream": true` in advanced options.

The final answer is still persisted as a normal visible assistant message after
the turn completes. Streaming only changes the runtime event shape and timing:
watchers can now see multiple `turn_progress` deltas with
`source: "model_stream"` instead of waiting for one final model event.

## What Landed

- Added OpenAI-compatible SSE parsing for `data:` frames and `[DONE]`.
- Normalized streaming content deltas from both string content and text-block
  content into `NativeTurnProgressEvent`.
- Accumulated streamed deltas into the final assistant answer for transcript
  persistence.
- Captured `finish_reason` as `run_complete.stopReason`.
- Captured optional streaming `usage` chunks as `run_complete.usage`.
- Published `runtime_ready`, `turn_start`, each streamed `turn_progress`,
  `turn_end`, and `run_complete` directly into `NativeRuntimeEventBus` during
  the model call.
- Preserved non-stream model behavior when `"stream"` is absent or false.
- Preserved mock fallback when no supported managed model is configured.
- Added fake OpenAI chunked `text/event-stream` socket test covering config ->
  credential -> streaming HTTP -> transcript -> native watch replay.

## Deliberate Non-Changes

- No GUI live projection yet.
- No Anthropic streaming adapter.
- No ChatGPT Codex OAuth native adapter.
- No tool parsing, tool execution, approvals, memory, Browser Control, Goal
  Hive, Morphling, `session.send`, `/btw`, stop, resume, or autonomous loop.
- No durable persisted event log. Native watch replay is still same-process
  backlog only.

## Why This Shape

Streaming is where the native runtime starts feeling like a live agent instead
of a synchronous request wrapper. Keeping it inside the same no-tool OpenAI
adapter proves the event contract before native tools multiply the number of
event types and failure modes.

The implementation intentionally keeps non-stream mode available. Some
OpenAI-compatible relays are less reliable with SSE, and Galley should not make
that a hard requirement for early native dogfood.

## Verification

- `cargo check --manifest-path cli/Cargo.toml`
- `cargo test --manifest-path core/Cargo.toml native_model --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_streams_openai_deltas --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_uses_configured_openai_model --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_mock_persists_visible_turn --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`

## Next

The next implementation should choose between:

- Slice 3C: Anthropic-compatible native adapter parity; or
- Slice 4A: native tool control plane with schemas/stubs, still no real local
  file/process/browser side effects.

Anthropic parity is lower product risk before tools because it keeps model
coverage closer to the managed runtime users already configure.
