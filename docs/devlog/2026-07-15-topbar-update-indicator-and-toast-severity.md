# 2026-07-15 - TopBar update indicator + toast severity retention + OAI restore validation

## Date / Status / Related

- Date: 2026-07-14 / 2026-07-15 (one session)
- Status: shipped on main (`db50c923`, `ceef104f`, `fa47c206`); JC dogfooded
  all four indicator states in dev
- Related:
  - `gui/src/components/layout/header/UpdateIndicator.tsx`
  - `gui/src/components/error-card/ToastHost.tsx`
  - `runner/ga_session.py::_VALIDATED_HISTORY_BACKENDS`

## Context

Update status only lived in Settings: users didn't learn a new version was
downloaded and ready unless they went looking, and the one-shot ready toast
was the only push signal. Separately, JC hit a startup error toast that
auto-dismissed before it could be read — which surfaced both that toasts have
no history, and (once it stayed on screen) a spurious history-restore warning
for OAI-backend sessions.

## Decisions

- **UpdateIndicator badge at the tail of TopBarStatusCluster.** Placement
  rationale: the two right-side clusters have written contracts —
  StatusCluster is conditional state-of-the-world badges, UtilityCluster
  explicitly "never gates on state" — and a conditional update badge belongs
  to the former. Tail position keeps session-scoped indicators grouped,
  avoids shifting the always-on utility buttons (muscle memory), and sits
  adjacent to the Settings gear across the divider.
- **Show `available` / `downloading` / `ready`; never `error`.** `available`
  matters because auto-download defers while sessions run — exactly the
  long-running case where ambient awareness pays. Errors stay with toast +
  Settings; a persistent red TopBar badge for a background nicety is noise.
- **Popover with explicit restart action, not one-click restart.** Restart
  tears down IM supervisor + runner children; the popover carries version
  info and the restart button (disabled with `readyAfterTasks` note while
  sessions run, mirroring the store guard).
- **v1 popover shows no release notes.** The update channel manifest's
  `notes` field defaults to the bare GitHub Release URL (see
  `scripts/generate-tauri-update-manifest.mjs` `--notes`); rendering it would
  show a raw link as prose. Re-add as a pure increment once the release SOP
  produces real notes text (either `--notes` at release time, or a
  URL-detecting "view notes" link in the popover).
- **Ready toast and badge coexist.** Toast = the moment it became ready;
  badge = persistent afterwards. Revisit dropping the toast only if dogfood
  finds it noisy.
- **Warning/error toasts no longer auto-dismiss** (`ToastHost` severity
  gate). There is no toast history, so an auto-dismissed error is
  information the user can never get back. Per-toast `autoDismissMs` still
  overrides (deliberate transient errors like image-paste-blocked feedback).
  A full toast inbox was considered and parked: do the severity gate first,
  re-evaluate the inbox if the need survives (it involves unread state,
  cross-session persistence → Rust Core write boundary).
- **`NativeOAISession` added to the restore-validated set.** The loud
  restore warning (PRD §10) was a false positive for this class: it
  subclasses `NativeClaudeSession` and inherits `ask()`, so its in-memory
  history is the same Claude-block shape; only request-time conversion
  differs (`_msgs_claude2oai` handles both injected block types). Documented
  as a read-only coupling: drop it from the set if upstream stops
  inheriting. `MixinSession` etc. keep the loud warning.
- **Dev-only `window.__appUpdateStore`** (mirrors `__prefs` /
  `__messagesStore`): dev builds are `unconfigured`, so the three indicator
  states are unreachable without forcing store state.

## Rejected Alternatives

- **VS Code-style dot on the Settings gear** as the update entry: zero
  footprint but routes the user back into Settings and can't carry the
  one-action popover. Kept as a possible *supplement*, not the entry point.
- **Placing the badge inside UtilityCluster next to the gear**: violates
  that cluster's unconditional-render contract and shifts the constant
  buttons when the badge appears.
- **Download progress in the popover**: the download happens inside the
  Rust `install_app_update` command with no progress events; not worth new
  event plumbing for v1 — indeterminate spinner suffices.
- **Silencing the OAI restore warning without an audit**: the warning's
  whole design is "corrupted restores become visible"; it was removed only
  after the code audit proved shape identity.

## Verification

- typecheck / lint / vitest green at each step; Playwright drive of Vite dev
  with forced store states screenshotted all four indicator forms (0 console
  errors); JC visually accepted in `tauri dev`.
- runner: 188 pytest / mypy / ruff after the validated-set change; new unit
  test locks OAI-no-warning, `LLMSession` keeps the loud-warning test.
