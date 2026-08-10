# Project Status

> Maintainer-facing document. For a user-facing overview, read
> [README](../README.md). For architecture, read [architecture](./architecture.md).

This document tracks the current working state of Galley. Long historical
decision trails live in [devlog](./devlog/README.md); implementation playbooks
live in [refactor](./archive/refactor/README.md).

## Current Target

- Package version: `0.4.4`.
- Git tag / GitHub Release: `v0.4.4` is the current published stable release
  (tagged at `84eaf737` on 2026-08-07, GitHub Latest).
- Agent API schema: `schemaVersion: 1`
- Release tier: stable patch; default update channel points at `v0.4.4`.
  `beta` is kept as a legacy alias for older builds.
- Product shape: dual-native local agent team orchestrator

Galley GUI and Galley CLI are peer frontends over Rust-side Galley Core. The
GUI is for the human operator at the desk; the CLI is for trusted Agent /
Supervisor automation on the same machine.

`v0.4.4` is a one-day stable patch on top of `v0.4.3`, all of it incremental
work on existing surfaces: **ask_user reachability** (waiting-for-you
notification, pending question restored after restart, no duplicate echo
while the live bubble is up), run-fold header scent (count-desc tools,
pinned question count, overflow tooltip), the **scroll-to-bottom two-state
live signal** plus a moving-target chase fix, the **sidebar hover
regression fix** (v0.4.3's chrome deepening had left `--color-hover`
brighter than its own ground), the overlay 920 content-workbench tier with
dual-end session-recap cleaning (`_clean_turn_summary` /
`cleanSessionSummary`), and reasoning-effort legibility in Models
(explicit "follow the provider" default, first-party presets at high, a
per-row tier badge). The release trigger was the hover regression, not
batch size. Version grading stays patch under the `v0.4.1` rule. Zero Rust
changes; managed GA untouched, so the bundled-runtime gate was correctly
skipped. Product shape, Agent API schema (`schemaVersion: 1`), GA baseline
(`d8d90ee`), and update-channel policy are unchanged. Full narrative:
devlog [2026-08-07-v0.4.4-release](./devlog/2026-08-07-v0.4.4-release.md).

`v0.4.3` shipped **session intelligence** (LLM auto-titles with the
seed/derived/auto/user four-state source model, and next-step ghost-text
suggestions in the composer — mandatory-by-default tag with mouse and AT
accept paths, bundled-GA only) and a **reading-experience rework of the
conversation view** (settled runs fold behind a one-line header; user
messages restyled as highlighter-marked passages), plus the six-pass UI
polish marathon, managed-runtime patch `0017` (input-token accounting for
Anthropic-compatible endpoints — footer `↑` and `/cost` no longer read 0),
and deterministic Settings entry on General. Release prep fixed two CI gate
gaps that had kept `check.yml` red on main since 2026-08-04: the missing
`generate_title` mirror in `gui/src/types/ipc.ts`, and the baseline drift
gate's replay-date-equals-auditedAt assumption, broken by the first
patch-only stack addition (now: replay date must not predate `auditedAt`).
The version bumps patch per the `v0.4.1` rule — grading follows single-
feature magnitude, not batch size (JC ruling, 2026-08-06). Product shape,
Agent API schema (`schemaVersion: 1`), GA baseline (`d8d90ee`), and
update-channel policy stay unchanged. Known limitation carried over from
`v0.3.7`: on Windows, Alt+Tab back still needs one click before typing,
shelved behind the tauri 2.12 tripwire (`.scratch/win-composer-focus/`,
devlog 2026-07-21-windows-composer-refocus).

## Current Release State

`v0.4.4` is published and promoted as the live stable release (2026-08-07).
The default `updates/stable/latest.json` channel points at `v0.4.4`, with the
legacy `updates/beta/latest.json` alias pointing at the same version for older
installed builds. Both were verified with `--cache-bust` across all three
platforms (darwin-aarch64, darwin-x86_64, windows-x86_64). The release went
through in one draft cut; JC's install smoke passed on the first build.
`v0.4.3` (2026-08-06) went through the same path and is now superseded.

The Windows Alt+Tab caret restore (issue #13's Windows half) ships as a
documented known limitation. The investigation is **shelved behind the
tauri 2.12 tripwire**: when tauri 2.12 releases (tauri#15625), upgrade and
retest Alt+Tab on Win11; only if still broken, reopen the bare-app bisect.
Tracker: `.scratch/win-composer-focus/`; chronicle: devlog
[2026-07-21-windows-composer-refocus](./devlog/2026-07-21-windows-composer-refocus.md).

Post-release follow-up:

1. App-update dogfood (SOP step 10) is **current**: the `v0.4.3` → `v0.4.4`
   pass **succeeded** (JC confirmed 2026-08-10 while opening `v0.4.5` prep;
   backfilled then), as did `v0.4.2` → `v0.4.3`. Only the `v0.4.1` →
   `v0.4.2` pass remains unrecorded. Keep asking for the step 10 result
   explicitly during step 9 — the smoke happens outside any agent tool call,
   so silence is not evidence it was skipped.
2. Verify the reply-done / goal-end / approval notifications on an installed
   Windows build (macOS was smoked at release; `tauri dev` cannot show
   notifications on macOS — see devlog 2026-07-21-reply-done-notification).
3. Keep Windows ARM out of the stable supported matrix. Add it later only after
   the release workflow, bundled Python, updater manifest, and smoke path all
   support `aarch64-pc-windows-msvc`.

## Unreleased On Main (post-`v0.4.4`)

The `v0.4.4` tag sits at `84eaf737`. Since then main carries 18 commits
staged for `v0.4.5`: a Settings -> Feedback tab (prefilled issue forms plus
an environment payload) with matching GitHub issue templates, notification
sounds keyed by state and session-titled approval toasts, four fixes
(auto-title leaking session system-prompt meta, Models-tab motion from
provider auto-expand and the loading flash, the Channels collapse-flash,
soft model-list failures misreported as errors), a `DialogCloseButton`
unification, footer telemetry unit disambiguation, the user-message copy
chip retune, and the managed GA baseline bump `d8d90ee` -> `308153b`.

The baseline bump is the release-risk item: upstream raised
`default_context_win`, which Galley overrides, so the observable effect is
**not** later trimming but a ~14% smaller tool-output cap via
`maxlen_multiplier` (`file_read` 33750 -> 28928). Draft smoke should watch
for `...[Truncated]...` arriving sooner. See devlog
[2026-08-10-ga-upstream-upgrade-d8d90ee-to-308153b](./devlog/2026-08-10-ga-upstream-upgrade-d8d90ee-to-308153b.md).

## Status Dashboard

| Area | Status | Read More |
|---|---|---|
| Core architecture | Rust Galley Core is authoritative | [architecture demo](./architecture-demo.md) |
| CLI / Agent API | Feature-complete for v0.2; schema frozen | [agent-api](./agent-api.md) |
| Agent surface | Settings -> Agent, copy-first SOP, Claude Skill | [Supervisor SOP](./integrations/galley-supervisor-sop.md) |
| Managed GA runtime | Shipped in v0.2.0; Memory/SOP seed repair shipped in v0.2.6; audited upstream `b1e173dc` baseline shipped in v0.2.16; GUI / CLI split, Provider / Model config, local encrypted SQLite credentials, and Project Workspace are the current baseline | [managed GA runtime](./managed-ga-runtime/README.md) |
| Data migration | v0.2.16 adds managed-model custom `context_win` persistence; v0.2.15 added message telemetry persistence for final-answer footer metadata; v0.2.10 added a safe pre-plugin migration guard through 023 and best-effort child-row recovery from local backups for the v0.2.9 table-rebuild cascade hazard | [B4 M8](./archive/refactor/B4-M8-sub-plan.md) |
| Process lifecycle | v0.2.11 ships bridge parent watchdogs and duplicate-startup suppression to prevent background process pile-up | [release / update SOP](./release-update-sop.md) |
| Scheduled tasks | Shipped in v0.4.0: daily / weekly / monthly auto-start sessions, per-task model, approval-blocked notifications, missed-run catch-up; v0.4.2 adds the trust surface (failure badge / notifications, next-fire preview, Run now, launch-at-login hint) | [devlog](./devlog/2026-07-30-scheduled-tasks-trust-polish.md) |
| Release path | v0.4.4 stable patch is published and promoted on the stable update channel | [release / update SOP](./release-update-sop.md) |
| Windows | Windows x64 remains the supported release target; Windows ARM is deferred until the release workflow and smoke path are added | [Windows checklist](./windows-build-checklist.md) |
| GA baseline | Locked to audited upstream `308153b` (audited 2026-08-10, not yet shipped); latest shipped is `d8d90ee` in `v0.4.2` (pre-rewrite SHAs like `1d3c1a09`/`5257dec` no longer resolve on official `main`) | [GA baseline](./ga-baseline.md) |

## Compact Timeline

| Phase | Status | Notes |
|---|---|---|
| Stage 0-2 | Complete | Infrastructure, bridge POC, desktop skeleton |
| Stage 3 | Complete | v0.1 desktop workbench, multi-session, projects, polish |
| v0.1.1 release path | Shipped | Bundled Python, macOS DMG, Windows NSIS artifact path |
| Bridge-owner prototype | Complete | Validated Rust-side process ownership direction |
| B1 | Complete | Rust core skeleton + read-only CLI |
| B2 | Complete | Bridge ownership moved to Rust + local socket / named pipe |
| B3 | Complete | `useAppStore.ts` removed; state split into domain stores |
| B4 | Shipped with v0.2.0 | CLI writes, schema freeze, discovery file, Settings -> Agent, SOP, Claude Skill, activity UI, backup mechanism |

Detailed phase narratives are intentionally not duplicated here. Use:

- [refactor README](./archive/refactor/README.md) for B-phase execution state
- [devlog README](./devlog/README.md) for chronological decision history
- [PRD](./PRD.md) for product intent and roadmap

## Release Version Rules

- Current package metadata uses `0.4.4`. For the next release, bump every
  file checked by `scripts/check-version-consistency.mjs` and run it with
  `--tag=vX.Y.Z` before tagging; `release.yml` enforces the same gate at tag
  time.
- Version grading follows feature magnitude (JC ruling, 2026-07-30): minor
  requires a feature big enough to stand as its own product line (e.g.
  Scheduled tasks in v0.4.0); user-visible but incremental enhancements
  (e.g. composer file drop in v0.4.1) are patch. Grading judges the largest
  single feature, not the batch total — a release that accumulates several
  patch-tier features stays patch (JC ruling, 2026-08-06, v0.4.3). When
  unsure, list the decision points and ask JC.
- Use `vX.Y.Z` for Git tag and GitHub Release title.
- Keep Agent API at `schemaVersion: 1`.
- A breaking Agent API change requires `schemaVersion: 2`, with explicit
  compatibility notes in [agent-api](./agent-api.md).
