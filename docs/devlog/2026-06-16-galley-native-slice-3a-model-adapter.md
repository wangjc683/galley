# Galley Native Slice 3A Model Adapter

**Date**: 2026-06-16
**Status**: Implemented, hidden experimental OpenAI-compatible no-tool adapter
**Related**: [Galley Native](../galley-native/README.md), [Implementation Slices](../galley-native/implementation-slices.md), [Slice 2 Native Worker Skeleton](./2026-06-16-galley-native-slice-2-native-worker-skeleton.md)

## Summary

Slice 3A lets explicit hidden `galley_native` sessions use existing Galley
managed model records for a real no-tool model turn.

The user-facing point is simple: native does not introduce another model setup
flow. If the user already configured a usable OpenAI-compatible API-key model
in Settings -> Models, the hidden native path can answer with that model. If no
supported model is available and the caller did not explicitly request one,
native keeps the Slice 2 mock fallback.

## What Landed

- Added `core::native_model` as the provider-adapter layer for native runtime.
- Implemented OpenAI-compatible chat completions with `stream: false`.
- Reused existing `managed_models` / `managed_model_providers` records and
  encrypted credential lookup.
- Allowed hidden native `--llm` selection by managed model display name, model
  name, or id.
- Chose the first usable OpenAI-compatible API-key managed model by default
  when no explicit native `--llm` is provided.
- Preserved mock fallback when no supported native model is configured.
- Persisted real model answers through the same visible assistant message path
  as the Slice 2 mock worker.
- Extended native `run_complete` events with `stopReason` and `usage`.
- Published actionable `runtime_error` events before closing native streams on
  model selection or provider-call failures.
- Added adapter fixture tests and an end-to-end fake OpenAI socket test that
  covers model config -> credential decrypt -> HTTP call -> transcript ->
  native watch events.

## Deliberate Non-Changes

- No GUI Settings toggle, runtime picker, or default runtime switch.
- No streaming SSE parser yet; the adapter maps the final provider response to
  one `turn_progress` event.
- No Anthropic adapter yet.
- No ChatGPT Codex OAuth native adapter yet.
- No tools, memory, Browser Control, Goal Hive, Morphling, `session.send`,
  `/btw`, stop, resume, or autonomous loop.
- No native model config tables; native reuses the managed model configuration.

## Why This Shape

The first native model step should reduce product risk, not multiply it.
OpenAI-compatible chat completions are the narrowest useful provider surface,
and reusing Galley's existing model records keeps first-run clean: users do not
learn a new native configuration concept.

The no-streaming choice is intentional. It proves the model boundary and event
shape first. True token streaming is a follow-up once the adapter boundary is
stable.

## Verification

- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `cargo test --manifest-path core/Cargo.toml native_model --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_uses_configured_openai_model --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_mock_persists_visible_turn --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`

## Next

The next implementation should add either:

- Slice 3B: real streaming normalization for OpenAI-compatible providers; or
- Slice 3C: Anthropic-compatible adapter parity.

Do not start native tools until at least one real provider can stream
incremental output through the native event bus.
