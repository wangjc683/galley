# Project Status

> Maintainer-facing document. For a user-facing overview, read
> [README](../README.md). For architecture, read [architecture](./architecture.md).

This document tracks the current working state of Galley. Long historical
decision trails live in [devlog](./devlog/README.md); implementation playbooks
live in [refactor](./archive/refactor/README.md).

## Current Target

- Package version: `0.3.0`.
- Git tag / GitHub Release: `v0.3.0` is the current published stable release.
- Agent API schema: `schemaVersion: 1`
- Release tier: stable minor; default update channel points at `v0.3.0`.
  `beta` is kept as a legacy alias for older builds.
- Product shape: dual-native local agent team orchestrator

Galley GUI and Galley CLI are peer frontends over Rust-side Galley Core. The
GUI is for the human operator at the desk; the CLI is for trusted Agent /
Supervisor automation on the same machine.

`v0.3.0` is a Telegram-channel, interface-polish, and reliability release.
Telegram joins WeChat and Feishu as a managed Channel, and the Feishu
supervisor now pushes proactive completion reports and binds to a single owner
via a pairing code. The sidebar status board, conversation area, and every
Settings tab (Runtime, Channels, Models, Browser Control) share one visual
hierarchy; denied tool calls now surface in the transcript; the top bar's theme
and font-size controls are unified; and on macOS the sidebar wordmark lines up
with the traffic lights. A concurrency audit (CONC-1..8) and a 55-finding
codebase review are fully resolved, giving race-free runner / IM / process
lifecycles, a shared per-process DB pool, and dependable Stop / approval
delivery. Product shape, Agent API schema, and update-channel policy stay
unchanged. `v0.3.0` ships the audited Bundled GA baseline `b1e173dc`.

## Current Release State

`v0.3.0` is published and promoted as the live stable release. The default
`updates/stable/latest.json` channel points at `v0.3.0`, with the legacy
`updates/beta/latest.json` alias pointing at the same version for older
installed builds. The live manifest was verified with `--cache-bust` across all
three platforms (darwin-aarch64, darwin-x86_64, windows-x86_64).

Post-release follow-up:

1. Dogfood the app-update path from an installed older Galley build to
   `v0.3.0`.
2. Connect Telegram in Settings -> Channels and confirm a session can be
   supervised end to end; re-verify the Feishu owner pairing code and the
   proactive completion report.
3. On macOS, visually confirm the sidebar wordmark / traffic-light alignment
   across window sizes and the unified top-bar theme / font-size controls.
4. Visually verify that denied tool calls render in the transcript.
5. On Windows, continue smoke coverage for duplicate startup / named-pipe
   behavior and manual overwrite install over a backgrounded Galley process,
   including the new named-pipe / long-path backup fixes.
6. Keep Windows ARM out of the stable supported matrix. Add it later only after
   the release workflow, bundled Python, updater manifest, and smoke path all
   support `aarch64-pc-windows-msvc`.

## Status Dashboard

| Area | Status | Read More |
|---|---|---|
| Core architecture | Rust Galley Core is authoritative | [architecture demo](./architecture-demo.md) |
| CLI / Agent API | Feature-complete for v0.2; schema frozen | [agent-api](./agent-api.md) |
| Agent surface | Settings -> Agent, copy-first SOP, Claude Skill | [Supervisor SOP](./integrations/galley-supervisor-sop.md) |
| Managed GA runtime | Shipped in v0.2.0; Memory/SOP seed repair shipped in v0.2.6; audited upstream `b1e173dc` baseline shipped in v0.2.16; GUI / CLI split, Provider / Model config, local encrypted SQLite credentials, and Project Workspace are the current baseline | [managed GA runtime](./managed-ga-runtime.md) |
| Data migration | v0.2.16 adds managed-model custom `context_win` persistence; v0.2.15 added message telemetry persistence for final-answer footer metadata; v0.2.10 added a safe pre-plugin migration guard through 023 and best-effort child-row recovery from local backups for the v0.2.9 table-rebuild cascade hazard | [B4 M8](./archive/refactor/B4-M8-sub-plan.md) |
| Process lifecycle | v0.2.11 ships bridge parent watchdogs and duplicate-startup suppression to prevent background process pile-up | [release / update SOP](./release-update-sop.md) |
| Release path | v0.3.0 stable minor is published and promoted on the stable update channel | [release / update SOP](./release-update-sop.md) |
| Windows | Windows x64 remains the supported release target; Windows ARM is deferred until the release workflow and smoke path are added | [Windows checklist](./windows-build-checklist.md) |
| GA baseline | Locked to audited upstream `b1e173dc` | [GA baseline](./ga-baseline.md) |

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

- Current package metadata uses `0.3.0`. For the next release, bump every
  file checked by `scripts/check-version-consistency.mjs` and run it with
  `--tag=vX.Y.Z` before tagging; `release.yml` enforces the same gate at tag
  time.
- Use `vX.Y.Z` for Git tag and GitHub Release title.
- Keep Agent API at `schemaVersion: 1`.
- A breaking Agent API change requires `schemaVersion: 2`, with explicit
  compatibility notes in [agent-api](./agent-api.md).
