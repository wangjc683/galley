# Large Component Split Guardrails · 2026-06

This refactor is structural only. Its purpose is to reduce maintenance cost in
large files without changing user-visible behavior or public contracts.

## Non-Goals

- Do not change SQL semantics, migrations, indexes, or DB row shapes.
- Do not change socket command names, request payloads, response payloads, or
  `schemaVersion: 1`.
- Do not change Tauri command names or frontend IPC contracts.
- Do not change CLI JSON schema, error identifiers, or exit-code mapping.
- Do not change GUI copy, navigation, Settings, Goal, or Browser Control flows.
- Do not introduce new runtime behavior while moving code.

## Module Rules

- `core/src/db/` keeps a single `impl GalleyApi for SqliteGalley`; domain files
  expose inherent methods and helpers only.
- `core/src/socket_listener/` keeps lifecycle and `dispatch_line` in `mod.rs`.
  Wire types live in `wire.rs`; shared command helpers live in `common.rs`;
  command-specific args and dispatchers live in focused command modules.
- `core/src/commands/` is only for thin Tauri wrappers that previously lived in
  `lib.rs`. Existing standalone modules such as `runner_commands`,
  `app_update`, and `conversation_image` stay where they are.
- `cli/src/main.rs` stays a thin binary entrypoint: parse CLI args, enforce the
  schema pin, dispatch top-level commands, and print stable error JSON.
- `cli/src/args.rs` owns the clap schema. Moving code must not change command
  names, flags, defaults, help text, JSON/NDJSON output, socket request shape,
  or exit-code mapping.
- `cli/src/goal/` is a structural split only. Goal prompt strings, controller
  decisions, runtime-aware memory/SOP policy, and worker socket helper calls
  must remain behavior-equivalent to the pre-split CLI.
- `gui/src/App.tsx` is settled — do not split it further. It has no effects of
  its own (flat prop-threading hub); its only extractions were pure helpers
  into `gui/src/lib/`. Region-container splitting was piloted and rejected
  (the indirection tax outweighed the gain).
- `gui/src/components/conversation/Composer.tsx` is settled — the hook-split is
  complete. Three cohesive concerns were lifted into `gui/src/hooks/use*.ts`
  over pure `gui/src/lib/` substrate, each behavior-preserving (UX changes
  shipped as separate commits): `useImageAttachments` (state, paste/drop/picker
  intake, drag overlay) over `composer-images.ts`; `usePasteFold` (long-paste
  fold registry + caret restoration) over `composer-paste.ts`; and
  `useBlurOnOutsidePointer` (the WebView blur/click-forward focus workaround,
  DOM-only). What remains is deliberately NOT extracted: the textarea auto-grow
  effect (5 lines, single-point, disjoint — extraction buys pure indirection,
  the anti-pattern that also sank the App.tsx region containers), and the
  goal-launch state machine (genuinely tangled but co-spawned with the submit
  path, so a hook would thread ~10 values in and ~10 back out — moving the
  tangle to a boundary rather than removing it). The extraction signal is
  *tangle*, never file size; small + clean + single-point is a reason to leave
  code in place, not a reason to lift it.
- `gui/src/components/screens/MainView.tsx` is settled — its conversation
  scroll machine (sticky-bottom follow, scroll-to-bottom button + monitor,
  session-switch snap with ResizeObserver race-hardening, stick-to-user-message,
  ⌥↑/↓ jump, advance-to-approval: 2 state / 4 ref / 7 effect / 3 handler) was
  lifted verbatim into `gui/src/hooks/useStickyScroll.ts`, leaving MainView a
  flat render tree. DOM-only hook (no `lib/` substrate; RAF/ResizeObserver/scroll
  aren't node-testable — verify by typecheck/lint + dogfood). This was the last
  genuine effect cluster in the GUI; a 2026-06-23 codebase survey confirmed the
  rest of the large GUI files (TopBar, MarkdownView, SidebarSessionRow, the
  stores, the i18n tables) are large-but-flat/cohesive and must not be split on
  size. The one non-component candidate still open is `gui/src/lib/ipc-handlers.ts`
  (an IPC router bundling a pure GA-text stripper + a history-replay machine).

## Verification

After Rust phases:

```bash
cargo check --manifest-path core/Cargo.toml
cargo test --manifest-path core/Cargo.toml
cargo check --manifest-path cli/Cargo.toml
cargo test --manifest-path cli/Cargo.toml
git diff --check
```

After GUI phases:

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
git diff --check
```

Use `wc -l` only as a smell check. A file being smaller is not the acceptance
criterion; unchanged behavior and clearer ownership are.
