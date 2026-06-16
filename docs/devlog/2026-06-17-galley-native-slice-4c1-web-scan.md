# Galley Native Slice 4C1 Web Scan

**Date:** 2026-06-17  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Managed GA Runtime](../managed-ga-runtime.md)

## Context

After Slice 4B8, hidden native had real local file/code executors but browser
tools were still Slice 4A stubs. Browser Control is a core GenericAgent
capability, so native cannot be a credible managed-GA replacement without real
browser perception.

The existing Galley product already prepares `tmwd_cdp_bridge`, verifies
extension connectivity, and uses upstream `TMWebDriver.py` for managed GA.
Rewriting the bridge in Rust immediately would add risk before proving the
native runtime can consume the same browser capability.

## Decisions

- Slice 4C1 implements only read-only `web_scan`.
- Native runtime now receives a host context. GUI and socket paths with a Tauri
  `AppHandle` populate that context from Galley's existing Browser Control
  layout; no-app/test paths get an explicit unavailable reason.
- `web_scan` calls bundled `TMWebDriver.py` through a small helper script,
  preserving the existing extension protocol and GA-shaped scan semantics.
- `web_scan` supports GA-compatible `tabs_only`, `switch_tab_id`, and
  `text_only`, with `tabId` retained as a Galley alias.
- Successful `web_scan` results join `file_read` in the one-pass read-only
  continuation path so the selected native model can answer from page content.
- Missing Browser Control no longer looks like a deterministic stub. It becomes
  a failed tool result with an actionable unavailable message.

## Rejected Alternatives

- Implement a pure Rust WebSocket/CDP bridge first. Rejected for this slice
  because it duplicates a proven, already-shipped bridge before native has
  browser parity at the semantic level.
- Land `web_scan` and `web_execute_js` together. Rejected because browser write /
  navigation actions need a separate approval and recovery discussion.
- Add a separate GUI surface for native browser events. Rejected because the
  existing tool card/event stream already carries local tool execution state.

## Open Questions

- Should `web_execute_js` use `risk_based` approval for all scripts, or split
  read-only scripts from navigation/mutation scripts?
- Should Browser Control unavailable states become dedicated runtime events, or
  remain failed tool results until `web_execute_js` lands?
- When should `TMWebDriver.py` be replaced with a Rust bridge: after full 4C
  parity, or only if Python bridge maintenance becomes a concrete cost?

## Next

- Add native `web_execute_js` with explicit browser action policy.
- Preserve managed Browser Control behavior and setup flow while native browser
  tools mature.
- Keep service-worker recovery and live browser-action progress as focused
  follow-up slices, not part of `web_scan`.
