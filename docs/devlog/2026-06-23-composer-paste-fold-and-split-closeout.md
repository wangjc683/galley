# Composer paste-fold split + hook-split closeout

## Date / Status / Related

- Date: 2026-06-23
- Status: shipped on `main` (not yet in a release tag)
- Related: [large component split guardrails](../archive/refactor/large-component-split-2026-06.md), [composer image-intake split](2026-06-22-composer-image-split.md)

## Context

Continuing the Composer split (App.tsx is settled; see the guardrails doc). The
image-intake concern came out on 2026-06-22; this session took the long-paste
**fold** concern — the one deliberately left behind last time because it is
tangled with the textarea value and the submit path. The governing rule holds:
**split by tangle, not by file size.**

## What shipped

`usePasteFold`, in the established two steps:

1. `gui/src/lib/composer-paste.ts` — the pure substrate: `PASTE_FOLD_THRESHOLD_LINES`,
   the placeholder regex, `normalizePastedText` (CRLF/CR → LF + line count),
   `foldPastedText` (splice the `[Pasted text #N +M lines]` placeholder over the
   selection, return the caret), `expandPlaceholders` (restore originals from a
   registry, leaving unknown ids and mangled placeholders alone).
2. `gui/src/hooks/usePasteFold.ts` — the stateful concern: the `id → text`
   registry, the monotonic counter, the post-commit caret-restore effect.
   Exposes `handleTextPaste` / `expandPastePlaceholders` / `resetPasteRegistry`.
   Composer's `onPaste` is now a two-liner: try images, else fold.

Then `useBlurOnOutsidePointer` — the ~50-line WebView blur/click-forward focus
workaround, lifted DOM-only (two refs in, nothing out, zero prop-threading).

Composer 1373 → 1252. Commits: `8557d031` (lib + test), `71633811` (hook +
wiring), `5674585b` (blur hook).

## Decisions and rejected paths

**Extract a pure substrate first, because here it actually gets tested.** Unlike
`readImageFile` (needs Image/canvas/FileReader → not unit-testable under the
`node` vitest env, dogfood-only), paste-fold's core is pure string math. Pulling
it into `composer-paste.ts` bought 13 real node tests — line normalization, the
fold splice + caret, and the expansion edge cases that are easy to regress
(unknown-id passthrough, a user typing inside the brackets mangling the
placeholder). Prefer a pure lib layer whenever the logic is string/data shaped.

**The hook-split is now settled — stop here.** The two genuinely tangled +
cleanly separable concerns (image object-URL lifetime, paste registry + caret)
are out. What is left does not clear the bar, and the bar is *tangle*, not size:

- **`useAutosizeTextarea` — not extracted.** A 5-line, single-point effect that
  reads `text` and writes `height`, disjoint from everything. Lifting it buys
  pure indirection with zero prop-threading saved — the same anti-pattern that
  sank the App.tsx region containers. "Small + clean + single-point" was
  mis-read earlier as a reason *to* extract; it is the opposite. The earlier
  ranked list (in the image-split devlog) put it first — that ranking was wrong.
- **`useGoalLaunch` — deferred, likely net-negative.** The goal-arming state
  (4 useState + 3 handlers + ~6 derived flags) is genuinely tangled, but it
  co-spawns with the submit main path (`handleSubmit` / `handleKeyDown` branch
  on `effectiveGoalArmed`). A hook would thread ~10 inputs in and ~10 values
  back out — moving the tangle to a boundary rather than removing it. Only worth
  revisiting if the in-file sub-components move out first and it still reads
  noisy.
- **Sub-component relocation (GoalConfirmDialog ~200L, LLMPill ~155L) — optional,
  not done.** They are already self-contained in-file; moving them to their own
  files is pure file-org (solves navigation, not tangle). A judgment call left
  to whether the file should be shorter, not a refactor obligation.

## Verification

`pnpm --dir gui typecheck`, `lint`, and the full `vitest run` (56 tests, 11
files — including the 13 new `composer-paste.test.ts` cases) all green. The blur
hook is DOM-only and not unit-tested; its acceptance is typecheck/lint + dogfood.
Behavior-preserving throughout — Composer's public contract (`ComposerHandle`,
all props) is unchanged.

## Next

Composer is settled like App.tsx — do not split it further on size grounds. If
the file should be shorter for navigation, relocate GoalConfirmDialog / LLMPill
to their own files (pure move, low risk). Otherwise the GUI large-component
split is complete.
