# 2026-07-16 - Updater download progress bar + spinner unification

## Date / Status / Related

- Date: 2026-07-16
- Status: implemented; static checks + unit tests green; pending JC visual
  acceptance in dev
- Related:
  - `core/src/app_update.rs`
  - `gui/src/stores/app-update.ts`, `gui/src/lib/app-update.ts`
  - `gui/src/components/layout/header/UpdateIndicator.tsx`
  - `gui/src/components/screens/settings/SettingsUpdateControl.tsx`
  - `gui/src/styles/globals.css`

## Context

The 2026-07-15 TopBar update-indicator round explicitly deferred download
progress: "the download happens inside the Rust `install_app_update` command
with no progress events; not worth new event plumbing for v1 — indeterminate
spinner suffices." This round pays that debt. It does not conflict with the
"no fake progress" design line (2026-05-26 devlog): that rule rejects bars for
quantities the app cannot know (model progress); updater download progress is
real bytes against a server-declared Content-Length.

A second, smaller inconsistency rode along: two spinner conventions coexisted —
the house `.spin` class (globals.css, 1.4s linear, ~41 usages incl. the shared
`status-icon.tsx` helper) and Tailwind v4 `animate-spin` (1s, 10 usages in 6
files, all in Settings/IM surfaces + confirm dialog). Neither had a
reduced-motion story.

## Decisions

- **Broadcast event, not `ipc::Channel`.** `app-update-progress` follows the
  existing `im_supervisor` pattern (`const` event name + `app.emit`, GUI
  `listen()`); the repo has zero Channel precedent and one updater download at
  a time, so broadcast semantics are fine.
- **Tagged two-phase payload.** `{ phase: "downloading", downloaded, total }`
  | `{ phase: "installing" }`. The install phase exists because after the
  download finishes, `install_app_update` still stops the IM supervisor +
  runner children (5s budget) and runs `update.install` — seconds of work
  during which the UI must not freeze at 100%. The finished callback flips the
  copy to "Installing update" and returns to the spinner.
- **Rust-side throttle.** `ProgressThrottle` emits on first chunk, integer
  percent change, or ≥150ms — whichever first; time is a parameter so the
  policy is unit-tested without sleeping. Caps event traffic at
  ~max(100, ~7/s) instead of one per network chunk.
- **Store listens before invoking** (same ordering rule as `lib/bridge.ts`),
  unlistens in `finally`, and drops late events unless the status is still
  `downloading` — a stale chunk event must not resurrect a terminal
  ready/error state. `downloading` gained additive optional fields
  (`phase`, `progress`); no existing consumer breaks.
- **Determinate bar only where there is room.** UpdateIndicator popover gets
  the 3px `bg-brand/15` track + `bg-brand` fill (same idiom as the Goal pill
  fill) with `role="progressbar"` semantics and a `tabular-nums` percent; the
  24px Settings chip gets a `· NN%` label suffix instead of a second bar.
  `total: null` (no usable Content-Length) and the pre-first-event window keep
  the indeterminate spinner; percent is clamped so a lying Content-Length
  cannot push the fill past 100%.
- **Spinner standardized on `.spin`.** 10 `animate-spin` call sites converted
  (6 files vs 17, keeps animations centralized in globals.css per the design
  discipline). Behavior note: those sites slow from Tailwind's 1s to the house
  1.4s tempo. Reduced-motion now slows `.spin` to 4s rather than freezing —
  a static CircleNotch is an ambiguous glyph, and spinners convey state, not
  decoration (DESIGN.md §2.7). The new bar fill's width transition turns off
  entirely under reduced motion.

## Rejected

- Progress bar inside the TopBar badge itself (under-badge ambient fill):
  popover-only keeps the badge quiet; revisit if dogfood wants ambient
  percent.
- `tauri::ipc::Channel` for progress: new one-off pattern for no benefit.
- Freezing `.spin` under reduced motion: loses the only "busy" signal.

## Verification

- `cargo check --workspace`, `cargo test --workspace` (5 new throttle tests).
- `pnpm --dir gui typecheck` / `lint` / `test` (137 passed; new
  `lib/app-update.test.ts` + `stores/app-update.test.ts` cover percent
  clamping, null-total fallback, listen-before-invoke ordering, unlisten on
  success/failure, and the stale-event guard).
- Manual states drivable in dev via `__appUpdateStore.setState(...)` (progress
  examples added to the store's dev comment).
