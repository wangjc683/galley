# Galley Native Slice 3C Anthropic Adapter

**Date**: 2026-06-16
**Status**: Implemented, hidden experimental Anthropic-compatible adapter
**Related**: [Galley Native](../galley-native/README.md), [Implementation Slices](../galley-native/implementation-slices.md), [Slice 3B Streaming](./2026-06-16-galley-native-slice-3b-streaming.md)

## Summary

Slice 3C adds Anthropic-compatible API-key managed models to the hidden
`galley_native` no-tool path.

Native now reuses the same Galley Provider/Model records for both
OpenAI-compatible and Anthropic-compatible API-key models. Explicit
`--llm`/`llmName` selection can target either protocol by display name, model
name, or model id. The default native model picker also accepts either protocol
when credentials are present.

## What Landed

- Added Anthropic-compatible `/v1/messages?beta=true` endpoint normalization.
- Reused the same Anthropic headers as managed model probes, including
  `anthropic-version`, beta headers, and `x-api-key` for `sk-ant-*` secrets.
- Added no-stream Anthropic messages payload and response parsing.
- Added Anthropic SSE parsing for `message_start`, `content_block_delta`,
  `message_delta`, and `message_stop`.
- Normalized Anthropic text deltas into native `turn_progress` events with
  `source: "model_stream"`.
- Accumulated Anthropic streamed deltas into the final visible assistant
  transcript.
- Captured Anthropic `stop_reason` as `run_complete.stopReason`.
- Merged Anthropic `message_start.usage` and `message_delta.usage` into
  `run_complete.usage`.
- Added fake Anthropic non-stream and streaming socket tests covering config ->
  credential -> HTTP -> transcript -> native watch replay.

## Deliberate Non-Changes

- No ChatGPT Codex OAuth native adapter yet.
- No Responses API native adapter.
- No tool parsing, tool execution, approvals, memory, Browser Control, Goal
  Hive, Morphling, `session.send`, `/btw`, stop, resume, or autonomous loop.
- No GUI live projection yet.
- No durable persisted event log; native watch replay remains same-process
  backlog only.

## Why This Shape

Anthropic parity matters before native tools because Galley's existing managed
runtime users can already configure both OpenAI-compatible and
Anthropic-compatible providers. If native only worked for OpenAI-compatible
models, early dogfood would overfit one provider family and give a false sense
of portability.

This still stays no-tool on purpose. The model adapter boundary is now broad
enough to support the next runtime-layer work without mixing provider parsing
with tool semantics.

## Verification

- `cargo test --manifest-path core/Cargo.toml native_model --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_uses_configured_anthropic_model --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_streams_anthropic_deltas --lib`

## Next

The next implementation should start Slice 4A: native tool control plane
schemas, parsing, approval events, and deterministic stubs. Real file/process
and Browser Control side effects should stay in later slices.
