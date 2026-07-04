# Composer image-intake split + drag affordance

## Date / Status / Related

- Date: 2026-06-22
- Status: shipped on `main` (not yet in a release tag)
- Related: [large component split guardrails](../archive/refactor/large-component-split-2026-06.md), [project status](../project-status.md)

## Context

Composer.tsx was the next target of the large-component split (App.tsx is
settled — see the guardrails doc). It is the tangled file in the GUI: a ~1620
line `forwardRef` body with interdependent effect/state clusters, unlike
App.tsx which is flat prop-threading. The governing rule for this whole
refactor is **split by tangle / change-cost, not by file size** — only the
cohesive interdependent regions reward extraction.

The image-attachment concern was the most cohesive cluster and the chosen first
cut.

## What shipped

Structural (behavior-preserving), two steps:

1. `gui/src/lib/composer-images.ts` — the pure substrate lifted out of
   Composer: size/mime/long-edge constants, `ImageBlockReason`, `ImageError`,
   `readImageFile`, `randomImageId`. Composer re-exports `ImageBlockReason`
   because `MainView` / `EmptyState` import it for their `onImageBlocked`
   wiring.
2. `gui/src/hooks/useImageAttachments.ts` — the stateful concern: pending
   tiles, preview-dialog index, the unmount URL-revoke effect, and the three
   intake paths (paste / drop / picker) funneled through one `acceptImageFiles`.
   Composer just wires DOM events to it; the long-text paste-fold path stayed
   in Composer (it is tangled with text + submit, a later cut).

Composer 1620 → 1350 lines; its own effects 7 → 5.

Then two UX gaps found in dogfood, each as its **own** commit (not folded into
the move):

- **Silent at cap** — adding a 5th image (cap is 4) silently dropped it, no
  feedback. Pre-existing bug. Added a `too-many` block reason → toast, emitted
  from the shared intake funnel so paste / drop / picker and the partial-overflow
  case are covered uniformly.
- **No drag affordance** — dragging a file over the Composer gave only the OS
  copy cursor, nothing in-app. Added a drop overlay (dashed brand panel +
  "Drop to add images"), with a muted "not supported on this runtime" state for
  external GA so the user learns it before letting go.

## Decisions and rejected paths

**Drop-zone scope: rejected the full conversation area, chose Composer-scoped.**
The first instinct was a generous drop zone spanning the whole conversation
(drop an image anywhere in the chat). Reading the tree killed it: the
conversation scroll region and the Composer live under the `MainView` root,
while the image state lives in the Composer's hook. A conversation-wide zone
would force the drag state up to `MainView` plus imperative plumbing back down
into the Composer — and `EmptyState` has its own Composer, so it would
duplicate the whole drag apparatus. That re-tangles exactly what the split just
separated. Composer-scoped keeps the entire concern inside
`useImageAttachments`, so **both** the MainView and EmptyState composers get
drag-drop for free. The target is the bottom composer block (full width, larger
than the textarea) rather than the message area — an acceptable trade for a
self-contained module. A generous wrapper can be added later without touching
the hook.

**Ship UX changes separate from the structural move.** The refactor commits
stayed strictly behavior-preserving; the cap toast and drag overlay are a
`fix` and a `feat` on top. This keeps the "did the move change behavior?"
question answerable from the diff.

**One incidental correctness fix** fell out of sharing a `clearImages`
primitive: `prefillText` used to clear pending images without revoking their
object URLs (a leak) or resetting the preview index; it now does both.

## Verification

The vitest env is `node` (no jsdom), and `readImageFile` needs Image / canvas /
FileReader, so its decode path is not unit-testable as-is — only its
validation gates (unsupported / too-large reject before touching the DOM) are
covered in `composer-images.test.ts`. The real acceptance was typecheck + lint
+ JC dogfood (paste / drop / picker / preview / remove / submit / prefill, plus
the cap toast and the drag overlay's invite / disabled / no-flicker states).
The win here is cohesion, not test coverage.

## Next

Remaining Composer hook clusters, ranked: `usePasteFold` (tangled with text +
submit, the hard one) → `useAutosizeTextarea` (small, clean) →
`useBlurOnOutsidePointer` (clean but DOM-only, low value) → `useGoalLaunch`.
