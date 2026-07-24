# Project Status

> Maintainer-facing document. For a user-facing overview, read
> [README](../README.md). For architecture, read [architecture](./architecture.md).

This document tracks the current working state of Galley. Long historical
decision trails live in [devlog](./devlog/README.md); implementation playbooks
live in [refactor](./archive/refactor/README.md).

## Current Target

- Package version: `0.4.0`.
- Git tag / GitHub Release: `v0.4.0` is the current published stable release
  (tagged at `cf4c73f` on 2026-07-24, GitHub Latest).
- Agent API schema: `schemaVersion: 1`
- Release tier: stable minor; default update channel points at `v0.4.0`.
  `beta` is kept as a legacy alias for older builds.
- Product shape: dual-native local agent team orchestrator

Galley GUI and Galley CLI are peer frontends over Rust-side Galley Core. The
GUI is for the human operator at the desk; the CLI is for trusted Agent /
Supervisor automation on the same machine.

`v0.4.0` ships **Scheduled tasks**: tasks that auto-start a session on a
daily, weekly, or monthly cadence, each with its own model, with
approval-blocked notifications, catch-up for runs missed while the app was
closed, and first-run example templates. It is the first release to ship the
audited GA baseline `4086d5c` (two upstream upgrades,
`5257dec → 1d3c1a09 → 4086d5c`), which retires plan mode following upstream.
Under the hood it folds in several rounds of Rust Core and GUI large-file
structural splits with no behavior change. The version bumps minor (not patch)
because of the new user-visible feature. Product shape, Agent API schema
(`schemaVersion: 1`), and update-channel policy stay unchanged. The `06 CLI
schedule` command face stays a deliberate v1 non-goal (GUI is closed-loop;
raise it when a real supervisor use case appears). Known limitation carried
over from `v0.3.7`: on Windows, Alt+Tab back still needs one click before
typing, shelved behind the tauri 2.12 tripwire (`.scratch/win-composer-focus/`,
devlog 2026-07-21-windows-composer-refocus).

## Current Release State

`v0.4.0` is published and promoted as the live stable release (2026-07-24).
The default `updates/stable/latest.json` channel points at `v0.4.0`, with the
legacy `updates/beta/latest.json` alias pointing at the same version for older
installed builds. The live manifest was verified with `--cache-bust` across all
three platforms (darwin-aarch64, darwin-x86_64, windows-x86_64). Smoke passed
on macOS and Win11 (JC, installed builds).

The Windows Alt+Tab caret restore (issue #13's Windows half) ships as a
documented known limitation. The investigation is **shelved behind the
tauri 2.12 tripwire**: when tauri 2.12 releases (tauri#15625), upgrade and
retest Alt+Tab on Win11; only if still broken, reopen the bare-app bisect.
Tracker: `.scratch/win-composer-focus/`; chronicle: devlog
[2026-07-21-windows-composer-refocus](./devlog/2026-07-21-windows-composer-refocus.md).

Post-release follow-up:

1. Dogfood the app-update path from an installed `v0.3.7` build to `v0.4.0`
   (SOP step 10).
2. Verify the reply-done / goal-end / approval notifications on an installed
   Windows build (macOS was smoked at release; `tauri dev` cannot show
   notifications on macOS — see devlog 2026-07-21-reply-done-notification).
3. Keep Windows ARM out of the stable supported matrix. Add it later only after
   the release workflow, bundled Python, updater manifest, and smoke path all
   support `aarch64-pc-windows-msvc`.

## Status Dashboard

| Area | Status | Read More |
|---|---|---|
| Core architecture | Rust Galley Core is authoritative | [architecture demo](./architecture-demo.md) |
| CLI / Agent API | Feature-complete for v0.2; schema frozen | [agent-api](./agent-api.md) |
| Agent surface | Settings -> Agent, copy-first SOP, Claude Skill | [Supervisor SOP](./integrations/galley-supervisor-sop.md) |
| Managed GA runtime | Shipped in v0.2.0; Memory/SOP seed repair shipped in v0.2.6; audited upstream `b1e173dc` baseline shipped in v0.2.16; GUI / CLI split, Provider / Model config, local encrypted SQLite credentials, and Project Workspace are the current baseline | [managed GA runtime](./managed-ga-runtime/README.md) |
| Data migration | v0.2.16 adds managed-model custom `context_win` persistence; v0.2.15 added message telemetry persistence for final-answer footer metadata; v0.2.10 added a safe pre-plugin migration guard through 023 and best-effort child-row recovery from local backups for the v0.2.9 table-rebuild cascade hazard | [B4 M8](./archive/refactor/B4-M8-sub-plan.md) |
| Process lifecycle | v0.2.11 ships bridge parent watchdogs and duplicate-startup suppression to prevent background process pile-up | [release / update SOP](./release-update-sop.md) |
| Scheduled tasks | Shipped in v0.4.0: daily / weekly / monthly auto-start sessions, per-task model, approval-blocked notifications, missed-run catch-up | [devlog](./devlog/2026-07-24-v0.4.0-release.md) |
| Release path | v0.4.0 stable minor is published and promoted on the stable update channel | [release / update SOP](./release-update-sop.md) |
| Windows | Windows x64 remains the supported release target; Windows ARM is deferred until the release workflow and smoke path are added | [Windows checklist](./windows-build-checklist.md) |
| GA baseline | Locked to audited upstream `4086d5c` (audited 2026-07-23; first shipped in `v0.4.0` after the `5257dec → 1d3c1a09 → 4086d5c` upgrades — pre-rewrite SHAs like `1d3c1a09`/`5257dec` no longer resolve on official `main`) | [GA baseline](./ga-baseline.md) |

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

- Current package metadata uses `0.4.0`. For the next release, bump every
  file checked by `scripts/check-version-consistency.mjs` and run it with
  `--tag=vX.Y.Z` before tagging; `release.yml` enforces the same gate at tag
  time.
- Use `vX.Y.Z` for Git tag and GitHub Release title.
- Keep Agent API at `schemaVersion: 1`.
- A breaking Agent API change requires `schemaVersion: 2`, with explicit
  compatibility notes in [agent-api](./agent-api.md).
