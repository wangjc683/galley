# Project Status

> Maintainer-facing document. For a user-facing overview, read
> [README](../README.md). For architecture, read [architecture](./architecture.md).

This document tracks the current working state of Galley. Long historical
decision trails live in [devlog](./devlog/README.md); implementation playbooks
live in [refactor](./refactor/README.md).

## Current Target

- Package version: `0.3.0` in development.
- Git tag / GitHub Release: `v0.2.8` is the current published GitHub Latest.
- Agent API schema: `schemaVersion: 1`
- Release tier: `v0.3.0` feature release target; default update channel still
  points at `v0.2.8` until the release is published and promoted, with `beta`
  kept as a legacy alias for older builds.
- Product shape: dual-native local agent team orchestrator
- v0.3.0 direction: make `galley_native` the default built-in Galley runtime;
  move Python managed GA to an Advanced fallback; keep external GA unchanged.

Galley GUI and Galley CLI are peer frontends over Rust-side Galley Core. The
GUI is for the human operator at the desk; the CLI is for trusted Agent /
Supervisor automation on the same machine.

## Current Release State

`v0.2.8` is the current published stable patch, GitHub Latest, and default
update-channel target. The main branch now targets `v0.3.0`, whose product
theme is the built-in runtime migration from Python managed GA to Rust
`galley_native`. The first default-switch implementation has landed in code;
release promotion still requires dogfood and parity gates.

`v0.2.8` shipped Goal V1 and master-session Goal delivery, the post-`v0.2.7`
main-workbench / Settings / Browser Control polish set, Browser Control
reconnect timing improvements, Core / CLI structure splits, and the audited
bundled GenericAgent baseline at upstream `0def7441`.

The default update channel was promoted to `v0.2.8` after publish. The live
channel verifier passed with cache-busting for both `stable` and the legacy
`beta` alias, and the `galley-update-channel` branch manifest reports version
`0.2.8`. `GALLEY_UPDATER_ENDPOINT` points at
`updates/stable/latest.json`; `updates/beta/latest.json` is kept as a legacy
alias for builds compiled before the stable endpoint rename.

Post-promote follow-up:

1. Dogfood update from an installed `v0.2.7` or older build if an older install
   is still available.
2. On Windows, smoke in-app update while Galley has loaded bundled Python, then
   repeat manual overwrite install over a backgrounded Galley process.
3. Keep Windows ARM out of the stable supported matrix. Add it later only after
   the release workflow, bundled Python, updater manifest, and smoke path all
   support `aarch64-pc-windows-msvc`.

## Status Dashboard

| Area | Status | Read More |
|---|---|---|
| Core architecture | Rust Galley Core is authoritative | [architecture demo](./architecture-demo.md) |
| CLI / Agent API | Feature-complete for v0.2; schema frozen | [agent-api](./agent-api.md) |
| Agent surface | Settings -> Agent, copy-first SOP, Claude Skill | [Supervisor SOP](./integrations/galley-supervisor-sop.md) |
| Galley Native runtime | v0.3.0 built-in default implementation landed; release still gated by dogfood/parity | [Galley Native](./galley-native/README.md) |
| Managed GA runtime | Shipped in v0.2.0; now an Advanced legacy fallback for v0.3.0 dogfood; v0.2.8 ships audited upstream `0def7441` | [managed GA runtime](./managed-ga-runtime.md) |
| Data migration | Backup mechanism exists; current schema covers runtime identity, managed models/providers, Goal state, internal message visibility, GUI-created message attachments, and native-default metadata migration 024 | [B4 M8](./refactor/B4-M8-sub-plan.md) |
| Release path | v0.3.0 is the next feature target; v0.2.8 remains GitHub Latest and the live update-channel target | [release / update SOP](./release-update-sop.md) |
| Windows | Windows x64 remains the supported release target; Windows ARM is deferred until the release workflow and smoke path are added | [Windows checklist](./windows-build-checklist.md) |
| GA baseline | Locked to audited upstream `0def7441` | [GA baseline](./ga-baseline.md) |

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

- [refactor README](./refactor/README.md) for B-phase execution state
- [devlog README](./devlog/README.md) for chronological decision history
- [PRD](./PRD.md) for product intent and roadmap

## Release Version Rules

- Current package metadata uses `0.3.0`. For a release version bump, update:
  - `package.json`
  - `core/tauri.conf.json`
  - `core/Cargo.toml`
  - `cli/Cargo.toml`
  - `gui/package.json`
- Use `vX.Y.Z` for Git tag and GitHub Release title.
- Keep Agent API at `schemaVersion: 1`.
- A breaking Agent API change requires `schemaVersion: 2`, with explicit
  compatibility notes in [agent-api](./agent-api.md).
