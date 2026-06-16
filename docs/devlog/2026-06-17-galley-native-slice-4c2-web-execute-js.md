# Galley Native Slice 4C2 Web Execute JS

**Date:** 2026-06-17  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Agent API](../agent-api.md),
[Slice 4C1 Web Scan](./2026-06-17-galley-native-slice-4c1-web-scan.md)

## Context

Slice 4C1 proved hidden native can consume Galley's existing Browser Control
layout through `TMWebDriver.py`, but only for read-only page inspection. That
left a major GA semantic gap: `web_execute_js` is how GenericAgent opens tabs,
clicks, fills pages, reads dynamic page state, and uses the extension protocol
for precise browser control.

The product risk is different from `web_scan`. JavaScript can mutate a page,
submit forms, navigate tabs, or trigger remote side effects. Native therefore
needs GA-compatible browser power, but not silent browser writes.

## Decisions

- Hidden native now implements `web_execute_js` through the same prepared
  Browser Control context used by `web_scan`.
- The helper preserves upstream GA semantics by routing execution through
  `simphtml.execute_js_rich(script, driver, no_monitor=...)`.
- `script` is the canonical argument; `code` remains an accepted alias.
- `switch_tab_id` is canonical; `switchTabId`, `tabId`, and `tab_id` remain
  accepted aliases.
- `no_monitor` is supported, with `noMonitor` as an alias.
- `web_execute_js` is `risk_based` only when a browser context exists and the
  call has executable arguments. Missing Browser Control or invalid arguments
  fail without asking the user to approve a no-op.
- `save_to_file` is explicitly rejected before approval. Native browser tools
  must not bypass the preview-first `file_write` / `file_patch` path for local
  file writes.
- Approved `web_execute_js` results join the one-pass continuation path, so the
  selected native model can interpret browser results in the same assistant
  turn.
- GUI approval cards now show JavaScript content directly instead of falling
  back to generic JSON args.

## Rejected Alternatives

- Treat `web_execute_js` as read-only by default. Rejected because the same API
  can click, navigate, submit, and call the extension tab protocol.
- Implement `save_to_file` inside `web_execute_js`. Rejected for now because it
  would create a hidden file-write path outside native file approval previews.
- Replace `TMWebDriver.py` with a Rust CDP bridge in this slice. Rejected
  because 4C is still proving browser parity at the semantic level.

## Open Questions

- Should native later split browser JS into read-only and action categories,
  possibly with different approval policies?
- Should approved browser execution move to a background lifecycle that can
  publish live page-action progress while `session.approval_response` is still
  running?
- Should Browser Control disconnected / no tab / sleeping service-worker states
  become dedicated runtime events instead of failed tool results?
- When `save_to_file` is needed, should the model call `web_execute_js` then
  `file_write`, or should native add a composed tool that still reuses file
  previews?

## Verification

- `cargo test --manifest-path core/Cargo.toml web_execute_js --lib`
- `cargo test --manifest-path core/Cargo.toml web_scan --lib`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`

## Next

- Decide whether browser execution needs live progress before moving deeper into
  memory / Goal Hive work.
- Keep managed and external Browser Control behavior unchanged while hidden
  native matures behind the experimental entry point.
