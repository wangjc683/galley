# 2026-07-16 - Native feel round: instant hover, cursor policy, motion tokens, skeleton, drag/zoom guards

## Date / Status / Related

- Date: 2026-07-16
- Status: implemented; static checks green; visual acceptance pending JC
  dogfood (hover-instant is the one to feel out in the real app)
- Related:
  - `gui/src/styles/globals.css` (motion tokens, skeleton-breath, user-drag)
  - `gui/src/components/ui/Button.tsx` (canonical hover-instant pattern)
  - `gui/src/components/ui/skeleton.tsx`,
    `gui/src/components/conversation/ConversationSkeleton.tsx`
  - `gui/src/stores/messages.ts` (`restoring` flag)
  - `gui/src/hooks/useGlobalShortcuts.ts`, `core/tauri.conf.json` (zoom)
  - `docs/design/foundations.md` §2.5 / §2.6 / §2.7
  - Sweep touched ~30 component files (hover transitions, duration/easing
    literals, `cursor-pointer`)

## Context

JC's read on the app: "UI/UX 没有大厂成熟产品那样扎实,有点轻飘飘". An audit
against 14 desktop-craft dimensions found the foundation solid (selection
model, press physics, focus discipline, drag regions, scrollbars, density
all handled) and narrowed the flimsy feel to a small set of residual web
tells. This round closes all five.

## Decisions

- **Hover is instant, app-wide.** The classic native-vs-web divergence:
  native apps flip hover state immediately; the web eases it. Previously
  every button/row faded hover over 120–140ms by deliberate choice
  (§2.5 old text). Reversed: base states carry no transition; the only
  transition on a control lives on `:active` (press sinks over
  `--motion-press`, release snaps back instantly). The old asymmetric
  "70ms down / 140ms settle up" is gone — release is now a native snap.
  Selection/toggle flips (sidebar row active state, segmented controls,
  menu `data-[highlighted]`) count as hover-equivalent: instant.
- **Cursor is the native arrow on all chrome.** Removed ~29
  `cursor-pointer` on menu items / rows / cards / buttons. Pointer is
  hyperlink semantics — kept only on real `<a href>` links. Content stays
  `cursor: text`, disabled stays `cursor-not-allowed`. In
  `components/conversation/**` removals use explicit `cursor-default`
  when a selectable ancestor would otherwise leak `text`.
- **Motion tokens.** ~14 scattered duration literals and 6 easing curves
  collapsed to 4 durations (`--motion-press/fast/base/slow` =
  70/120/160/240ms) + 3 easings (`--ease-firm/pop/spring`). Durations are
  plain `:root` custom properties used via `duration-(--motion-*)` —
  Tailwind v4 has no duration theme namespace; easings live in `@theme`
  and emit `ease-*` utilities. B-class loop periods (breath 2.4s etc.)
  deliberately stay outside this scale.
- **Skeleton, not shimmer.** New `Skeleton` primitive with a slow opacity
  breath (§2.7 bans shimmer sweeps; reduced-motion → static). Applied
  where content lands in its own shape: conversation cold-start restore
  (`ConversationSkeleton`, driven by a new `restoring` flag on
  `PerSessionMessages` — warm switches never see it thanks to the
  existing atomic swap) and the Settings model-provider list. Action-busy
  spinners (probes, connects) stay spinners.
- **Drag/zoom defense in depth.** Global `img, a { -webkit-user-drag:
  none }`; `zoomHotkeysEnabled: false` asserted in tauri.conf.json (was
  implicit default); Ctrl+wheel and WKWebView `gesturestart/gesturechange`
  intercepted in `useGlobalShortcuts` (Chromium reports trackpad pinch as
  Ctrl+wheel, WKWebView uses gesture events — both paths needed).

## Rejected alternatives

- **Keeping animated hover as a brand signature.** It was documented and
  intentional ("firm planted" §2.5), but it is also the single strongest
  "web app" tell, and the press physics — the part that actually carries
  the tactile identity — survives intact. If dogfood says buttons lost
  too much life, the revert is one line in Button.tsx (restore a base
  `transition-[...]`), not a re-sweep: component-level removals stay
  correct either way.
- **`--duration-*` inside `@theme`.** Unused-var pruning semantics for
  non-namespace keys are murkier than a plain `:root` block; the var
  shorthand `duration-(--motion-*)` works identically with both, so the
  guaranteed-emission option won.
- **Skeleton with delay gate (only show after ~150ms).** More moving
  parts for a local-SQLite read that is usually fast; a brief skeleton
  flash is visually equivalent to content arriving. Revisit only if a
  flash is actually observed in dogfood.

## Verification

- `pnpm --dir gui typecheck` / `pnpm --dir gui lint` / `git diff --check`
- Hover/cursor/skeleton feel: JC visual acceptance in `tauri dev`
  (per engineering-workflow default for stateful desktop surfaces).
