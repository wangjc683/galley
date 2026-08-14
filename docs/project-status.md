# Project Status

> Maintainer-facing document. For a user-facing overview, read
> [README](../README.md). For architecture, read [architecture](./architecture.md).

This document tracks the current working state of Galley. Long historical
decision trails live in [devlog](./devlog/README.md); implementation playbooks
live in [refactor](./archive/refactor/README.md).

## Current Target

- Package version: `0.4.8`.
- Git tag / GitHub Release: `v0.4.8` is the current published stable release
  (tagged at `8a6c4998` on 2026-08-14, GitHub Latest).
- Agent API schema: `schemaVersion: 1`
- Release tier: stable patch; default update channel points at `v0.4.8`.
  `beta` is kept as a legacy alias for older builds.
- Shipped GA baseline: `f06d550` (audited 2026-08-14) — audited and released
  the same day, so audited and shipped are aligned for the first time since
  `v0.4.5`.
- Product shape: dual-native local agent team orchestrator

Galley GUI and Galley CLI are peer frontends over Rust-side Galley Core. The
GUI is for the human operator at the desk; the CLI is for trusted Agent /
Supervisor automation on the same machine.

`v0.4.8` is the smallest release so far, and the first whose headline is the
engine rather than the GUI: the **GA baseline bump `308153b` -> `f06d550`** is
the only substantial item. Its two user-visible effects both come from upstream
— a finished reply that ends with its summary is no longer misclassified as a
truncated stream and regenerated, and OpenAI-protocol models now retry provider
overload at the network layer instead of surfacing `!!!Error:` in the reply.
Riding along, both subtractions: the Channels auto-expand predicate narrowed to
attention states, and the sidebar's Archived entry lost its ever-growing count.
`patch` was uncontested — the largest single item is maintenance, not a
feature. The decision worth remembering is *why now rather than batching*: an
audited-but-unshipped baseline thickens the next release's untested delta, and
nothing else was close enough to be worth waiting for. Full narrative: devlog
[2026-08-14-v0.4.8-release](./devlog/2026-08-14-v0.4.8-release.md).

`v0.4.7` returned to self-directed work after two user-issue-driven releases.
Its single headline is the **Discord channel** — Channels' fourth card and the
first **parallel supervision context**: one channel (or thread) in a private
Server is an independent supervisor context with its own GA agent instance and
its own history, under supervisor ids shaped `galley-im/discord/ch:<id>`. The
single-thread semantics of WeChat / Feishu / Telegram are unchanged. Riding
along: the Telegram bundling gap (`python-telegram-bot` was missing from
`GA_DEPS`, so Telegram could not start from a real package), the model-config
toast missing Telegram, the owner-bind generation race (Feishu and Telegram
benefit immediately), the next-suggestion leak into IM replies, and channel
setup-copy polish.

The release also carries a **reading-experience and motion polish marathon**
(13 commits), the same shape as `v0.4.3`'s six-pass run: markdown vertical
rhythm scaling with the reading tier, warm ink for inline code, GFM task-list
checkboxes, closing hanging code spans and link destinations while streaming,
the thinking-row timer reworked onto shimmer, a grid-rows sweep for the run
fold, the streaming caret moved inline with block-level soft fade, provider
cards scrolled into view, toast countdown pausing on hold, a scheduled-badge
count pop, semantic command-palette grouping, and sidebar mode-switch
transition edges. Two reference audits landed at **zero adoption** (code block,
sidebar sliding hover highlight) and are recorded to prevent re-proposal.

Version grading stays **patch** (JC ruling, 2026-08-13) even though precedent
pointed at minor: Telegram, the third channel, was the headline of `v0.3.0`.
The polish marathon does not move the grade — the `v0.4.1` rule judges the
largest single feature, not batch size, exactly as it did for `v0.4.3`.
Two reasons override that precedent — `v0.3.0` also carried the CONC-1..8
concurrency audit, a 55-finding review, and the independent-product
repositioning, so its minor was plausibly batch-driven, which the `v0.4.1` rule
explicitly rejects as grounds; and the parallel-supervision semantics apply to
Discord alone, making this a fourth card with a channel-local routing
semantic rather than a product-line reshape. CLI / Agent API are **untouched**
— supervisor ids are opaque strings and per-channel routing reuses existing
message-origin schema fields. Product shape, Agent API schema
(`schemaVersion: 1`), GA baseline (`308153b`), and update-channel policy are
unchanged. Because `GA_DEPS` and `managed-ga/` both changed, the
bundled-runtime gate is **mandatory** this release. Full narrative: devlog
[2026-08-13-v0.4.7-release](./devlog/2026-08-13-v0.4.7-release.md).

`v0.4.6` is the second user-issue-driven release, and all four of its issues
came from **one reporter** (Kinda2419): galley#19 / #20 / #22 ship here;
galley#21 has only a PRD and three `ready-for-agent` sub-issues and is **not**
in this release. Where `v0.4.5` fixed the *channel* (silent notifications, no
findable feedback entry), `v0.4.6` fixes the *workflow*: the **session message
queue** (mid-run and mid-stop sends queue instead of being blocked, auto-run on
`run_complete`, one-click jump-queue, chips to cancel or pull a message back
into the composer; CLI gains `dispatch: "queued"` and `--jump`, additive) and
**failure-output readability** (headline-first collapsed tool errors, decoded
tracebacks, localized placeholders for leaked tool-call markup in session
summaries, and a protocol-failure callout when markup arrives as message text).

Both lines share a shape: **the capability was already there; what was broken
was the layer between it and the human.** GA's engine already serialized
queued tasks — it just could not cancel or reorder them; #22's payload had
every field it needed — it just rendered unreadably.

Version grading stays patch under the `v0.4.1` rule (largest single feature,
not batch size). Product shape, Agent API schema (`schemaVersion: 1`), GA
baseline (`308153b`), and update-channel policy are unchanged. `managed-ga/`
is untouched, so the bundled-runtime gate is correctly skipped this release.
Full narrative: devlog
[2026-08-12-v0.4.6-release](./devlog/2026-08-12-v0.4.6-release.md).

`v0.4.5` is the first release driven by **real user issues** rather than our
own dogfood: galley#15–#18 came from people running installed Galley. That
changed the ordering — the feedback path itself was broken (#15's reporter
could not find the report entry; #17 meant notifications were silent), so it
shipped first. Contents: notification sounds keyed by state
(done / needs-you / alert) with a `notify_sound` pref and session-titled
approval toasts, a Settings -> Feedback tab (prefilled GitHub issue forms
plus a verbatim environment-payload preview, with matching entries in About,
the macOS Help menu, and the Windows tray), the auto-title meta-leakage fix
(`side_ask` carries the session system prompt, so `<summary>` /
`<next-suggestion>` mandates collided with "output the title only"), footer
telemetry unit disambiguation (dimensionless inline meter, absolutes in a
tooltip, cache reads split out), three Settings motion / classification
fixes, and the managed GA baseline bump `d8d90ee` -> `308153b`.

The baseline bump made the **bundled-runtime gate mandatory** this release
(`v0.4.4` correctly skipped it — it touched neither managed GA nor the
baseline). Its user-visible edge is a ~14% tighter tool-output cap: upstream
raised `default_context_win`, which Galley overrides, so the effect lands not
on trimming but on `maxlen_multiplier` as a denominator (2.25 -> 1.93,
`file_read` 33750 -> 28928). Disclosed in the release notes under the hood.
Version grading stays patch under the `v0.4.1` rule (largest single feature,
not batch size). Product shape, Agent API schema (`schemaVersion: 1`), and
update-channel policy are unchanged. Full narrative: devlog
[2026-08-10-v0.4.5-release](./devlog/2026-08-10-v0.4.5-release.md).

`v0.4.4` was a one-day stable patch on top of `v0.4.3`, all of it incremental
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

`v0.4.7` is published and promoted as the live stable release (2026-08-13).
The default `updates/stable/latest.json` channel points at `v0.4.7`, with the
legacy `updates/beta/latest.json` alias pointing at the same version for older
installed builds. Both were verified with `--cache-bust` across all three
platforms (darwin-aarch64, darwin-x86_64, windows-x86_64). The release went
through in one draft cut; JC's install smoke passed on the first build.

The mandatory gates for this release closed as follows. The **bundled-runtime
gate** passed on `mac-x64` from scratch (`import discord` and
`find_spec("frontends.dcapp")` verified under the bundle's own Python);
`mac-arm64` and `win-x64` cannot be built on the maintainer's Intel machine,
because `bundle-python.sh` installs deps by *running* the bundled interpreter —
`release.yml` runs the same script on each platform's runner and fails the
build at tag time. The **full patch-stack replay** was brought current: all 18
patches applied clean from a fresh clone at the audited baseline and the
rebuilt payload matched the committed `managed-ga/code` byte-for-byte, retiring
the `0018` debt and an unrecorded `0019` debt found in the same pass.

`v0.4.6` (2026-08-12) went through the same path and is now superseded.

The Windows Alt+Tab caret restore (issue #13's Windows half) ships as a
documented known limitation. The investigation is **shelved behind the
tauri 2.12 tripwire**: when tauri 2.12 releases (tauri#15625), upgrade and
retest Alt+Tab on Win11; only if still broken, reopen the bare-app bisect.
Tracker: `.scratch/win-composer-focus/`; chronicle: devlog
[2026-07-21-windows-composer-refocus](./devlog/2026-07-21-windows-composer-refocus.md).

Post-release follow-up:

1. App-update dogfood (SOP step 10): **no open gaps.** JC confirmed on
   2026-08-13 that every in-app update up to this release was tested and
   behaved normally, which closes the two previously unrecorded hops
   (`v0.4.1` → `v0.4.2` and `v0.4.4` → `v0.4.5`) alongside the already
   recorded `v0.4.2` → `v0.4.3`, `v0.4.3` → `v0.4.4`, and `v0.4.5` →
   `v0.4.6`. `v0.4.7` → `v0.4.8` passed on 2026-08-14. **`v0.4.6` → `v0.4.7`
   was never run and is now off the normal path**: the dogfood machine went
   `v0.4.7` → `v0.4.8`, and a hop can only be tested from the older build
   still installed, so this one needs a deliberate downgrade or it stays open
   forever. Decide to reinstall `v0.4.6` or write the hop off — do not let it
   sit here reading as pending. Keep asking for the step 10 result explicitly
   during step 9 — the smoke happens outside any agent tool call, so silence
   is not evidence it was skipped.
2. Watch tool-output truncation, carried forward from the `308153b` baseline
   (shipped in `v0.4.5`), which tightened the tool-output cap ~14%
   (`maxlen_multiplier` 2.25 → 1.93 as a denominator). `f06d550` did not move
   it again, so the watch is unchanged: `...[Truncated]...` arriving sooner is
   the regression direction that only long real sessions surface.
3. Verify the reply-done / goal-end / approval notifications on an installed
   Windows build (macOS was smoked at release; `tauri dev` cannot show
   notifications on macOS — see devlog 2026-07-21-reply-done-notification).
   `v0.4.5` adds sounds to these, so the Windows pass now also covers the
   three tones.
4. Keep Windows ARM out of the stable supported matrix. Add it later only after
   the release workflow, bundled Python, updater manifest, and smoke path all
   support `aarch64-pc-windows-msvc`.

## Unreleased On Main

One docs-only change: the **release-notes writing rules were replaced**
(2026-08-14, after the `v0.4.8` draft). The old
`<User outcome>: <what changed>, so <why it matters>` template assumed the
outcome and the change are two pieces of information; for this product's
readers they usually are not, so it reliably produced bullets that stated one
thing three times. The new standard is one clause per bullet stated once, with
concrete tokens the reader has met in the product (`!!!Error:` in a reply)
named directly while internals they could not have seen (files, functions,
patch numbers, upstream SHAs) stay out. See
[release notes guide](./release-notes-guide.md); the `v0.4.8` ❌/✅ pair is
inlined there.

Everything else: nothing. All post-`v0.4.7` work shipped in the `v0.4.8` cut
described above.

Open tracker carried forward: `.scratch/ga-log-retention/` (needs-triage) —
the hygiene half left over after Rule 4's interpretation ruling; a retention
policy for engine-written logs under the managed state root. Unscoped, so it
waits for the next release.

Deferred and explicitly bound together (2026-08-14): redirecting the native
macOS About panel to Settings -> About, and making the sidebar wordmark
interactive. Two sides of one brand-surface question, so neither starts alone —
see [deferred](./devlog/deferred.md). The wordmark discussion's conclusions are
recorded there: the wordmark is currently the sidebar column's window drag
handle (a click target costs that, and costs it worst at the 134px minimum
width), the epigraph precedent's misclick-unrecoverability test rules out
"open a new session", and an easter-egg motion is the only candidate whose
misfire is harmless.

The upstream `dc_*` / `discord_*` key-name mismatch **will not be reported**
(JC ruling, 2026-08-13): it cannot affect Galley's managed mode, which injects
config through env and aligns with dcapp's read side. That vote is closed.

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
| Release path | v0.4.7 stable patch is published and promoted on the stable update channel | [release / update SOP](./release-update-sop.md) |
| Channels | Four managed IM channels: WeChat, Feishu, Telegram, Discord. Discord (v0.4.7) is the first parallel-supervision-context channel — one channel = one supervisor context | [Discord shipping devlog](./devlog/2026-08-13-discord-channel-shipped.md) |
| Windows | Windows x64 remains the supported release target; Windows ARM is deferred until the release workflow and smoke path are added | [Windows checklist](./windows-build-checklist.md) |
| GA baseline | Locked to audited upstream `f06d550` (audited 2026-08-14, shipped in `v0.4.8` the same day) (pre-rewrite SHAs like `1d3c1a09`/`5257dec` no longer resolve on official `main`) | [GA baseline](./ga-baseline.md) |

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

- Current package metadata uses `0.4.7`. For the next release, bump every
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
