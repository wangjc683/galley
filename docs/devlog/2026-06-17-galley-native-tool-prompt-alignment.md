# Galley Native Tool Prompt Alignment

**Date:** 2026-06-17  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Slice 4C2 Web Execute JS](./2026-06-17-galley-native-slice-4c2-web-execute-js.md)

## Context

After Slice 4C2, hidden native could read files, patch/write files with
approval, run commands with approval, scan browser pages, and execute browser
JavaScript with approval. The native model system prompt still said that
`file_read` was the only real local executor and that browser capabilities were
not available.

That mismatch is a product bug, not just documentation drift: the selected
model may avoid using capabilities that Core already supports, making native
feel weaker than it is.

## Decisions

- Update the compact initial native system prompt to list the landed 9-tool
  parity surface.
- State that `file_patch`, `file_write`, `code_run`, and `web_execute_js`
  require approval before side effects.
- State that `web_scan` and `web_execute_js` use Browser Control, while still
  forbidding claims of browser access when Browser Control is unavailable.
- Keep the durable boundary explicit: `update_working_checkpoint` and
  `start_long_term_update` are recognized, but durable memory/capability writes,
  Goal Hive, and Morphling are not implemented yet.
- Add a regression test so the prompt does not drift back to the old
  `file_read`-only framing.

## Rejected Alternatives

- Inject full tool schemas into every initial turn. Rejected for now because the
  native charter still prioritizes compact context and the hidden runtime is
  early; concise capability truth beats large prompt payloads.
- Wait for memory / Goal slices before updating the prompt. Rejected because the
  mismatch already affects today’s file/code/browser user experience.

## Verification

- `cargo test --manifest-path core/Cargo.toml native_model --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `git diff --check`

## Next

- Continue Browser Control recovery work: disconnected extension, connected
  with no tabs, and service-worker wakeup should become more actionable for
  native tool failures.
