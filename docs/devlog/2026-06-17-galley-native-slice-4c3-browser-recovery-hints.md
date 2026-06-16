# Galley Native Slice 4C3 Browser Recovery Hints

**Date:** 2026-06-17  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Slice 4C1 Web Scan](./2026-06-17-galley-native-slice-4c1-web-scan.md),
[Slice 4C2 Web Execute JS](./2026-06-17-galley-native-slice-4c2-web-execute-js.md)

## Context

After `web_scan` and `web_execute_js` became real native browser executors,
Browser Control failure states still collapsed into generic failed tool text.
That is not enough for a product runtime: the common recovery path differs
between no desktop host, extension not connected, and extension connected with
no operable page.

Galley's managed Browser Control setup already has product language and probe
states for `connected_no_tabs` and `not_connected`. Native should reuse that
direction before introducing a new GUI-specific event schema.

## Decisions

- Native browser helper failures can now include a stable `recovery` JSON object
  in the failed tool result content.
- `host_unavailable` covers no Tauri host / no browser bridge context and points
  the operator back to the Galley desktop app plus Settings > Browser Control.
- `connected_no_tabs` covers the extension being connected while no normal page
  is operable. The next action is to open any normal webpage or the Browser
  Control test page.
- `not_connected` covers the extension not connecting to `TMWebDriver`. The
  next action is to open the configured Chrome / Edge browser and run the
  Browser Control test connection if needed.
- `web_execute_js` now records `sideEffectsPerformed=false` when JavaScript was
  not delivered because Browser Control had no connected tab/session.

## Rejected Alternatives

- Add new native runtime event variants for browser recovery immediately.
  Rejected for this slice because the current CLI/GUI already display tool
  result content, and changing event schema should wait for a clearer GUI action
  model.
- Auto-open the Browser Control test page from a failed native tool. Rejected
  because browser side effects should stay explicit; Galley already has a
  Settings action for the test page.
- Classify sleeping service-worker separately now. Deferred because the current
  helper already waits through the MV3 reconnect window; deeper classification
  needs real failure samples.

## Verification

- `cargo test --manifest-path core/Cargo.toml web_scan --lib`
- `cargo test --manifest-path core/Cargo.toml web_execute_js --lib`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo test --manifest-path core/Cargo.toml browser_control --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`

## Next

- Decide whether these recovery hints should be promoted into first-class GUI
  actions in the approval/tool card surfaces.
- Continue deferring live browser-action progress until approval execution moves
  to a background lifecycle.
