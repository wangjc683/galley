# 2026-07-16 - Windows scrollbar polish (Mac untouched)

## Date / Status / Related

- Date: 2026-07-16
- Status: implemented; static checks green; macOS regression gate pending JC
  dogfood; real Windows verification rides the next smoke pass
  (`docs/windows-build-checklist.md` §4 "Scrollbars")
- Related:
  - `gui/src/styles/globals.css` (scrollbar section)
  - `gui/src/lib/platform.ts`, `gui/src/main.tsx`
  - `gui/src/components/screens/MainView.tsx`, `layout/Sidebar.tsx`,
    `screens/settings/Settings.tsx`
  - `docs/design/foundations.md` §2.6

## Context

The 2026-07-15 desktop-craft audit flagged the bare Windows scrollbar as a
"web tell" and deferred it. The repo had zero custom scrollbar styling —
every surface rode the OS default. That is correct on macOS (native overlay
bars are the ideal form) and wrong on Windows (classic 17px gray tracks
against the warm paper palette). There was also no `scrollbar-gutter`
anywhere, so on Windows the transcript/sidebar/settings panels shift
horizontally the moment content crosses the overflow threshold.

## Decisions

- **Platform-scoped CSS, Mac byte-identical.** All rules are prefixed
  `html[data-platform="windows"]`. The attribute is set at boot by
  `applyPlatformAttribute()` in `lib/platform.ts` (mirrors
  `theme.ts` setting `root.dataset.theme`; no index.html inline script —
  a one-frame-late scrollbar style, unlike a wrong theme, is invisible).
  This honors platform.ts's standing rule that Mac paths stay
  byte-identical: no stylesheet rule matches `data-platform="mac"`.
  Unknown UAs fall through to `"linux"` — unstyled, safe default.
- **`::-webkit-scrollbar` pseudo-elements, not standard properties.**
  Two engine facts decide this: (1) any matching `::-webkit-scrollbar`
  rule makes WKWebView abandon auto-hiding overlay scrollbars — hence the
  hard Windows scope; (2) in Chromium 121+ standard
  `scrollbar-width`/`scrollbar-color` silently disable webkit
  pseudo-element rules on the same element, and the standard properties
  cannot express hover states, radius, or thumb inset. Both constraints
  are documented as load-bearing comments in globals.css and as a rule in
  foundations.md §2.6.
- **One universal rail, token-colored.** 10px bar (both axes), transparent
  track, pill thumb inset 2px via `background-clip: content-box` (reads
  ~6px), `line-strong` resting → `ink-muted` hover → `ink-soft` active;
  colors flip with `data-theme` automatically. Transparent
  `::-webkit-scrollbar-corner` kills the opaque square where code blocks
  scroll both axes. The universal descendant selector covers textareas,
  Radix portals, dialogs, ScrollFade and tool `pre` without per-component
  work; Chromium drops the arrow buttons once the pseudo-element is styled.
- **`.scrollbar-stable` (scrollbar-gutter: stable) on the three primary
  panels** — transcript scroller, sidebar list, settings body — so Windows
  content no longer shifts when the bar appears. Known cosmetic cost: the
  transcript's centered column sits a constant ~5px left of true center on
  Windows; imperceptible, and `stable both-edges` is the documented fallback
  if it ever shows. No-op on macOS (overlay gutter is zero).

## Rejected

- Styling macOS scrollbars at all: native overlay is already the target
  aesthetic; any webkit rule would regress it to always-visible bars.
- JS scroll libraries / Radix ScrollArea: pure CSS keeps native scrolling
  physics and the transcript's scroll contract (conversation.md §scroll)
  untouched.
- `@tauri-apps/plugin-os` for detection: platform.ts already documents why
  UA sniffing suffices (no Rust crate / permission / async init ceremony).

## Verification

- `pnpm --dir gui typecheck` / `lint`, `git diff --check` — green.
- macOS gate: run dev app, confirm `dataset.platform === "mac"` and overlay
  bars still auto-hide. Preview of the Windows rules from a Mac: devtools →
  `document.documentElement.dataset.platform = "windows"`, check both themes,
  reset.
- Windows: new "Scrollbars" section in the smoke checklist covers thin warm
  bars on the three panels, hover/active darkening, dark-theme visibility,
  thin horizontal bar + no corner square in code blocks, and no layout shift
  at the overflow threshold.
