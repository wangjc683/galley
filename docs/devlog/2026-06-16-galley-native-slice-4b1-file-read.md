# Galley Native Slice 4B1 File Read

## Date / Status / Related

- Date: 2026-06-16
- Status: landed in working tree
- Related:
  - [Galley Native implementation slices](../galley-native/implementation-slices.md)
  - [RFC 2: Model And Tool Loop](../galley-native/rfc-2-model-tool-loop.md)
  - [RFC 5: Workspace And Session Continuity](../galley-native/rfc-5-workspace-session-continuity.md)

## Context

Slice 4A/4A2 gave `galley_native` the hidden tool control plane: tool parsing,
events, approval pause/resume, `ask_user`, and GUI projection. Every executor
still returned deterministic no-side-effect stubs.

The next safe step is not a broad file/code/browser batch. The first real
executor should be read-only, small enough to verify, and useful enough to test
the native executor path end to end.

## Decisions

- Slice 4B1 implements only `file_read`.
- `file_read` remains hidden behind `galley_native`; managed GA and external GA
  behavior is unchanged.
- The executor returns `sideEffectsPerformed: false` because it performs no
  file, process, browser, memory, Goal, or runtime-state mutation.
- Relative paths do not fall back to the process cwd.
- A relative path is accepted only when the hidden native session belongs to a
  Project with `root_path`; the path is canonicalized and must stay inside that
  workspace.
- Existing absolute paths outside the Project workspace, or absolute paths
  without any workspace, require the existing native approval flow before
  reading.
- `Project.root_path` is treated as the current native-only workspace source
  when present. This does not revive managed/external cwd binding.
- `file_read` supports inclusive `startLine` / `endLine` ranges.
- Reads are capped at 256 KiB and decoded with UTF-8 lossy fallback so a bad
  byte sequence does not crash the runtime.
- Other parity tools remain stubbed or disabled:
  `file_patch`, `file_write`, `code_run`, browser tools, memory writes, Goal
  Hive, and Morphling.

## Rejected Alternatives

- Use process cwd for relative paths.
  - Rejected because it creates invisible behavior. The user cannot tell what
    native thinks the current directory is, and a desktop app cwd is not a
    product concept.
- Treat `Project.root_path` as a global runtime cwd again.
  - Rejected because the prior managed/external cwd coupling was deliberately
    rolled back. This slice reads it only as a native workspace hint.
- Implement `file_patch`, `file_write`, and `code_run` in the same slice.
  - Rejected because write/process execution needs preview, approval, timeout,
    cancellation, stdout/stderr, and recovery semantics. Bundling it with
    `file_read` would hide risk.
- Allow absolute path reads without approval.
  - Rejected because read-only can still expose secrets. Workspace-local reads
    are the low-friction path; workspace-external reads require operator
    consent.

## Open Questions

- Should native workspace get its own explicit Project metadata field instead
  of reusing historical `root_path`?
- Should `file_read` expose binary/large-file summaries instead of lossy text
  truncation?
- Should native implement the tool-result continuation loop before adding
  writes, so `file_read` content is fed back into the model rather than only
  displayed/persisted as a tool result?
- How should future memory and capability resources share the same `file_read`
  surface (`memory://`, `capability://`) without weakening filesystem policy?

## Next

- Run the targeted Rust checks for native tools/runtime and the broader native
  regression subset.
- Decide whether Slice 4B2 should be tool-result continuation or
  preview-first `file_patch`.
- Keep Browser Control in Slice 4C, separate from local file/code executors.
