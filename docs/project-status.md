# Project Status

> Maintainer-facing document. For a user-facing overview, read
> [README](../README.md). For architecture, read [architecture](./architecture.md).

This document tracks the current working state of Galley. Long historical
decision trails live in [devlog](./devlog/README.md); finished implementation
playbooks are archived in [refactor](./archive/refactor/README.md) (history,
not current rules).

## Current Target

- Package version: `0.7.8`.
- Git tag / GitHub Release: `v0.7.8` is the current published stable release
  (tagged at `ec5a3e1d` on 2026-11-11, published 2026-11-11, GitHub Latest).
- Agent API schema: `schemaVersion: 3` (since the Goal removal on
  2026-10-13, first shipped in `v0.7.0`; `2` first shipped in `v0.5.0`). The
  server keeps answering `1` and `2` for every command that did not change;
  every goal command, v1 and v2, is `unknown_command` under every pin.
- Release tier: stable patch; default update channel points at `v0.7.8`.
  `beta` is kept as a legacy alias for older builds.
- Shipped GA baseline: `d66509b` (audited 2026-11-03, shipped in
  `v0.7.6` … `v0.7.8`; `llmcore.py`'s text protocol split into `legacy_llmcore.py`,
  one `0001` hunk so managed memory distillation still reads L0, no Galley
  code change). The previous `a9a36b4` shipped `v0.7.1` … `v0.7.5`,
  `b70079d` `v0.7.0`, on top of `5205f40` (audited 2026-10-18, never
  shipped on its own; upstream's new mykey store broke the managed loader,
  fixed in the runner); `f308ee7` shipped `v0.6.1` … `v0.6.2`, `1b6442f`
  `v0.5.1` … `v0.6.0`, `efb3bc6` before it `v0.4.11` … `v0.5.0`. See
  [GA baseline](./ga-baseline.md).
- Product shape: a personal assistant on the user's own computer that
  scales into a local agent team (since `v0.7.0`; before it, a dual-native
  local agent team orchestrator)

Galley GUI and Galley CLI are peer frontends over Rust-side Galley Core. The
GUI is for the human operator at the desk; the CLI is for trusted Agent /
Supervisor automation on the same machine.

Release paragraphs (newest first) keep only the latest three releases;
every older release's narrative lives in its release devlog (the
[devlog index](./devlog/README.md) lists them). Two older paragraphs stay
for now, `v0.6.1` and `v0.4.16`: each holds one fact its devlog does not.

`v0.7.8` (2026-11-11) is a patch five days after `v0.7.7`, 146 commits. The
to-do list becomes the user's main list (main chat rulings 202–208, tickets
152–163): a to-do can repeat as a rule plus its current period, the next
made in the same write when one is ticked off or skipped, one left open
reminded again at each later period's time (migration 057; `todo skip`, the
repeat flags, `--series` and `--no-repeat`, additive under schema 3); an
open row's day, reminder and repeat change by hand in a popover; a folded
row draws no notes; ticking moves (the shared checkbox's beat, rows leaving
and closing up, the today count, the face's nod). The memo page drops the
ending full stop and a lone group label (ruling 209). The 2026-11-10 audit's
fixes ship with it: the new-chat effort pick, ⌘K's Enter, the rollback when
Core refuses a write, five notices in the UI language, one search-index
rule, three CLI behavior fixes inside schema 3, three undocumented socket
commands answering `unknown_command`, the shell plugin gone, the bundled
engine payload without upstream's demo media (installers 22–23 MB smaller),
the NSIS hook closing the app and the CLI. Graded patch: the largest piece
(repeating to-dos) extends the to-do list; nothing removed has a
user-facing surface. GA baseline unchanged at `d66509b`: upstream `main`
still at `68d996a`, judged at `v0.7.7`. Pre-flight: the six gate scripts and
the bundled-runtime gate on `mac-x64` in a `git archive` copy of `0b98e84b`;
typecheck, lint, vitest in two time zones (276 files, 3,178 tests);
`check.yml` green on the bump commit `ec5a3e1d` (run 42957710875), all seven
jobs. No `release.yml` dry-run (JC's ruling of 11-10), so the release run
was the first real check of the `runner/*.py` resource mapping, the `.mjs`
sidecar script and the dropped Setup Python: one draft, green (run
42960094826); the agent checked the Intel DMG read-only (17 runner `.py`
files and no tests, a 5.0 MB engine payload without the demo media) and the
`latest.json` candidate. JC did not look at tickets 160–163 in dev before
the tag (asked to; answered 「继续推进」, and the database showed no to-do
ticked), so their feel was first seen on the draft. JC's Mac smoke passed:
the database shows the main chat dispatching subtasks that drove the
browser and merging their reports, and a repeating to-do noted, ticked in
the window 18 seconds later with its next period made the same second. W1
not done. Stable promoted and verified the same session (run 42965351992).
Full narrative: devlog
[2026-11-11-v0.7.8-release](./devlog/2026-11-11-v0.7.8-release.md).

`v0.7.7` (2026-11-06) is a patch two days after `v0.7.6`, 22 commits, all
in `gui/src`. Main chat bubbles sit like an IM thread, 4px within a side and
16px across, and their hover buttons moved outside the bubble, level with
its bottom edge (ruling 199, ticket 148); a line told mid-run grows out of
the typing dots, which slide down (ruling 200, ticket 149); rows trail your
scroll on one spring, 6px at most and scaled by speed (ruling 201, ticket
150), and new bubbles land with a 1.5px bounce on the same spring (ticket
151); with Reduce Motion on, neither moves. No Rust, runner, bundled GA,
migration or Agent API change, so no bundled-runtime gate. GA baseline
unchanged at `d66509b`: upstream `main` was 8 commits past it at `68d996a`
(reflect mode, the p2p and hub frontends, an opt-in Claude `show_thinking`
key Galley does not set), not followed. JC looked at tickets 149 and 151 in
dev before the tag (the main session's recommendation: a release that is
all feel costs a withdrawn draft to fix on the draft). Pre-flight: the six
gate scripts in a `git archive` copy of `f4e755be`; typecheck, lint, vitest
in two time zones (261 files, 2,950 tests); `check.yml` green on the bump
commit `a5d376b9` (run 42184840221), all seven jobs. One draft (release run
42187309646); the agent checked the Intel DMG read-only and the
`latest.json` candidate. JC chose to skip W1 (the main session had
recommended it: the scroll spring tells your scroll from the program's by
`wheel` events and was only measured in WKWebView) and approved publish
after a Mac smoke; the database shows the draft's first launch woke the
main chat for a due reminder and answered it, with no message from JC
after it, so the told line's growth was not seen on a packaged build.
Stable promoted and verified the same session (run 42192633408). Full
narrative: devlog
[2026-11-06-v0.7.7-release](./devlog/2026-11-06-v0.7.7-release.md).

`v0.7.6` (2026-11-04) is a patch one day after `v0.7.5`, 86 commits (the
first draft's 77, the retag's 9). The main chat leans on the model with a few judgments
instead of dispatch rules (main chat ruling 186, ticket 139): it looks
things up on the web itself and gives sources; a deliverable the user will
decide on, pass on or keep goes to subtasks, one per part and all at once,
and comes back merged (ruling 193, ticket 143); the user's memos on how
they want such work done come first, and work of its own starts with a
line of how (rulings 194–196, ticket 145). Text sent while it runs is
interjected and read at its next step (ticket 136; `session send` may
answer `dispatch: "interjected"`); a `tell_user` tool and words outside
`<summary>` reach the user mid-run (tickets 137, 142); a subtask starts
with the main chat's last turns as background (ticket 138, migration 056);
one reply's batch of subtasks wakes the main chat once, when all are back
or 5 minutes after the first (ticket 144). A merge round for subtasks the
user dispatched draws like the user's own round, the to-do panel no longer
lists subtasks, and the sidebar's 「还有 N 件在办」 unfolds in place (ruling
197, ticket 146); the managed runner hands the main chat its wake note in
full instead of upstream's 「Long user prompt saved to …」 file, and a cut
answer points at `finalAnswer[3000:]` (ruling 198, ticket 147). Bundled
GA: patch `0031` cuts a model request still streaming at 300 s (ticket
140); baseline `a9a36b4` -> `d66509b`. Process cards draw `Bash` /
`PowerShell` as running code and name a lone tool when a step has no
summary (baseline tickets 02–03). Graded patch: the largest piece (the
main chat's judgments and interjection) extends the `v0.7.0` main chat;
`dispatch: "interjected"` is additive under schema 3. The first draft was
withdrawn: on smoke S3 the merge round ran 100 s with nothing drawn for
its first ~54 s; JC chose to fix both the drawing and the speed before
shipping (rulings 197–198). Pre-flight for the retag: `check.yml` green on
`a6ccf951` (run 41811337897), all seven jobs; the six gate scripts in a
`git archive` copy of `9254fdbd`; the bundled-runtime gate on `mac-x64`;
vitest in two time zones. JC's smoke of the second draft: S3 passed, the
merge round 73 s and 3 steps from the wake, the first step 13 s in, no
read of the saved prompt file (S1 and S2 passed on the first draft). Stable
promoted and verified the same session (run 41826253185). W1 not done.
Full narrative: devlog
[2026-11-04-v0.7.6-release](./devlog/2026-11-04-v0.7.6-release.md).

`v0.6.1` (2026-10-07) is a patch two days after `v0.6.0`, 16 commits. It
ships the GA baseline `f308ee7` and three managed prompt rounds: the runtime
prompt describes Galley from a feature map and points configuration requests
at the Settings page (naming the Chinese tabs) instead of touching files, its
static text is byte-capped (`STATIC_PROMPT_BUDGET_BYTES = 6855`), and the IM
entry layer shapes replies for a phone and delegates only when asked or for
long tasks. Against `v0.6.0` the static prompt grew ~240 tok and the IM layer
shrank ~420 tok. The Settings cross-tab pass (Chinese headers, 服务商, two
badge and two disclosure primitives, the sidebar grouped by use) and the
About tagline 「极简 harness 的本地全能 AI 助手」 ship with it. **Two data-loss
fixes from the pre-tag dev regression**: Core persists every step itself
(`core/src/turn_persistence/`, from the runner watcher, before RunComplete),
so a page reload mid-run no longer drops the run and `session wait
--until-idle` returns the real final answer; and the GUI hydrate sweep no
longer deletes a 「新对话」 session that already has messages (it ate
first-turn CLI, IM and scheduled sessions). The IM reference directory now
also ships the Supervisor reference the SOP links to. Graded patch
(enhancements, nothing removed). The regression ran in `tauri dev` before the
tag: desktop prompt checklist 1–13 by CLI, IM 14–16 plus the restart check by
JC on Telegram (17, WeChat, skipped), GA upgrade SOP step 8 in both runtime
modes; the bundled-runtime gate passed on `mac-x64`; upstream was still the
audited `f308ee7`. `check.yml` was green on the release head (run
37631144963, all six jobs) before the tag; JC approved publish without an
item-by-item smoke report; stable promoted and verified the same session (run
37638595946). Full narrative: devlog
[2026-10-07-v0.6.1-release](./devlog/2026-10-07-v0.6.1-release.md).

`v0.4.16` (2026-09-16) is a five-commit GUI-only patch, two days after
`v0.4.15`: the **conversation step markers become an ordinal gutter**
(`01`, `02`, … in JetBrains Mono with a process-region rail, tool rows a level
below the step summary, disclosure carets on the text, in-flight rows
unnumbered until settled; five same-day live-adjudication rounds against an
external ReasoningTrace reference), the **fetched model list folds into the
model field as a combobox** with the auto-fetch announcing its loading /
"found N models" state, the **Chinese Settings sidebar flips to
Chinese-primary tab labels** (community report: 10.5px helper unreadable),
**Phosphor hairlines thicken on ≤1.5dppx screens** with Microsoft YaHei named
in the sans stack (community Windows report), and **Pin leads the session row
menu**. Core, `runner/` and `managed-ga/` untouched, so the bundled-runtime
gate was not mandatory. JC smoked the draft before publish; stable channel
promoted and verified the same session. Issue
#28 (upstream extension's in-page badge, not Galley's) was answered the same
day. Full narrative: devlog
[2026-09-16-v0.4.16-release](./devlog/2026-09-16-v0.4.16-release.md).

## Current Release State

`v0.7.8` is published and promoted as the live stable release (published
2026-11-11 05:22 UTC). The default `updates/stable/latest.json` channel points
at `v0.7.8`, with the legacy `updates/beta/latest.json` alias pointing at the
same version for older installed builds. The live verifier passed for both
channels across all three platforms (darwin-aarch64, darwin-x86_64,
windows-x86_64), in the promote run (42965351992) and again locally (channel
branch at `34d88ef5`); a plain `curl` read 0.7.8 at 05:23 UTC, right after
promote. One draft cut (release run 42960094826, tag on `ec5a3e1d`); JC
smoked the Mac and approved publishing; W1 was not done and is owed under
Unreleased On Main. The bundled-runtime gate passed on `mac-x64` (`runner/`
and `managed-ga/` both changed); `check.yml` was green on `ec5a3e1d` (run
42957710875), all seven jobs.

`v0.7.7` (2026-11-06): one draft cut (release run 42187309646, tag on
`a5d376b9`), JC smoked the Mac and approved publishing, W1 skipped by JC;
promote run 42192633408; no bundled-runtime gate (no managed GA change).

`v0.7.6` (2026-11-04): two drafts cut; the first (release run 41790806641,
on `559ea1af`) was withdrawn after smoke S3 and its tag deleted; the second
(release run 41813629971, tag on `a6ccf951`) was published after JC smoked
S3 on it; promote run 41826253185; bundled-runtime gate passed on
`mac-x64`.

`v0.7.3` (2026-10-28) went through the same path as `v0.7.2`: one draft cut
(release run 40662506980), JC approved publishing without reporting smoke
items, both channels verified with `--cache-bust`, no bundled-runtime gate
(no managed GA change).

`v0.7.2` (2026-10-27) went through the same path: one draft cut (release run
40440956486), JC approved publishing without reporting smoke items, both
channels verified with `--cache-bust`, bundled-runtime gate passed on
`mac-x64`.

`v0.7.1` (2026-10-26) went through the same path: one draft cut (release run
40269618292), JC approved publishing without reporting smoke items, both
channels verified with `--cache-bust`, bundled-runtime gate passed on
`mac-x64`.

`v0.7.0` (2026-10-23) went through the same path: one draft cut (release run
39802407918), JC smoked part of it and approved publishing without the rest,
both channels verified with `--cache-bust`, bundled-runtime gate passed on
`mac-x64`.

`v0.6.1` (2026-10-07) went through the same path: one draft cut (release run
37632655144), JC approved publishing without reporting smoke items, both
channels verified with `--cache-bust`, bundled-runtime gate passed on
`mac-x64`.

`v0.6.0` (2026-10-05) went through the same path: one draft cut (release run
37333557134), JC approved publishing without reporting smoke items, both
channels verified with `--cache-bust`, bundled-runtime gate passed on
`mac-x64`.

`v0.5.6` (2026-10-01) went through the same path: one draft cut (release run
36856754423), JC approved the draft, both channels verified with
`--cache-bust`, bundled-runtime gate passed on `mac-x64`. The first in-app
check after promote hit the raw CDN's 300 s cache and reported "up to date";
SOP step 10 now waits that out.

`v0.5.5` (2026-09-30) went through the same path: one draft cut (release run
36738236573), JC approved the draft, both channels verified with
`--cache-bust`, bundled-runtime gate passed on `mac-x64`.

`v0.5.4` (2026-09-28) went through the same path: one draft cut, JC approved
the draft, both channels verified with `--cache-bust`; its bundled-runtime
gate was skipped (no `managed-ga/`, `runner/` or dependency change), and the
promote workflow's download-by-release-id fix (`d42c727f`) promoted on the
first run.

`v0.5.3` (2026-09-23) went through the same path: one draft cut, JC smoked
the draft, both channels verified with `--cache-bust`. Its bundled-runtime
gate was mandatory (`managed-ga/` and `runner/` changed) and passed on
`mac-x64`; the first promote run failed on GitHub's stale by-tag release
lookup, and the workflow fix (`d42c727f`, download by release id) promoted on
the second run.

`v0.5.1` (2026-09-18) went through the same path: one draft cut, JC smoked
the draft on macOS Intel and Windows, both channels verified with
`--cache-bust`. Its bundled-runtime gate was mandatory (`managed-ga/`
baseline bump and `runner/` changed) and passed on `mac-x64`.

`v0.4.16` (2026-09-16), `v0.4.15` (2026-09-14), `v0.4.14` (2026-09-14), `v0.4.13` (2026-09-09) and
`v0.4.12` (2026-09-08) went through the same path: one draft cut each, JC
smoked the draft before publish, both channels verified with `--cache-bust`.
`v0.4.15`'s, `v0.4.14`'s and `v0.4.12`'s bundled-runtime gates were mandatory
(`managed-ga/` or `runner/` changed) and passed on `mac-x64`, `mac-arm64` and
`mac-x64` respectively; `v0.4.13` touched neither
`runner/` nor `managed-ga/`.

`v0.4.11` (2026-08-31) went through the same path: one draft cut, JC smoked
the draft build (no-auth provider flows plus multi-step sessions on the new
GA baseline), bundled-runtime gate from scratch on `mac-x64` with `runner/`
and `managed-ga/` both changed.

For `v0.4.9` (2026-08-18/19): both channels were verified with `--cache-bust`
across all three platforms (darwin-aarch64, darwin-x86_64, windows-x86_64).
The release went through in one draft cut. Smoke was a Windows real-machine
pass by JC on the draft build — multiple sessions, no black CMD windows —
which doubles as the fix's effectiveness verification (the maintainer's Mac
cannot show the bug).

The mandatory gates closed as follows. The **bundled-runtime gate** passed on
`mac-x64` from scratch (`managed-ga` changed via patch `0020`); `mac-arm64`
and `win-x64` remain physically unverifiable on the maintainer's Intel machine
and are covered by `release.yml`'s per-platform runners, which fail the build
at tag time. The **full patch-stack replay** ran in the same pre-flight: all
19 patches applied clean from a fresh clone at the audited `f06d550` baseline
and the rebuilt payload matched the committed `managed-ga/code` byte-for-byte
— unlike `0018`/`0019`, patch `0020` carried no unreplayed debt into its
release.

`v0.4.8` (2026-08-14) went through the same path and is now superseded.

The Windows Alt+Tab caret restore (issue #13's Windows half) ships as a
documented known limitation. The investigation is **shelved behind the
tauri 2.12 tripwire**: when tauri 2.12 releases (tauri#15625), upgrade and
retest Alt+Tab on Win11; only if still broken, reopen the bare-app bisect.
Tracker: `.scratch/win-composer-focus/`; chronicle: devlog
[2026-07-21-windows-composer-refocus](./devlog/2026-07-21-windows-composer-refocus.md).

Post-release follow-up:

1. App-update dogfood (SOP step 10): `v0.7.7` → `v0.7.8` passed on a
   user's Windows machine the day of the release (JC, 2026-11-11, relaying
   the user: 「windows 用户更新到 0.7.8，更新和使用暂时看一切正常」; the
   user takes every version through the updater, was on 0.7.7 before, and
   has had no problem with any of them). By that user's word the earlier
   Windows hops passed too and migrations 053–057 each ran on a real older
   database there, 057 in this update. It is the first update through the
   new NSIS pre-install hook, and it did not break the restart. This is a
   user's report passed on, not a walk of the Windows checklist. The macOS hops `v0.7.0` → … → `v0.7.8` stay unobserved: JC's Mac
   was installed straight from the draft all eight times; the CDN served
   0.7.8 without cache-bust at 05:23 UTC, right after promote. `v0.6.2` → `v0.7.0` passed on JC's
   Windows machine (2026-10-23, same session as the release; H1 in the
   release devlog): after the restart the app reads 0.7.0, the old sessions
   and model settings are there, and the main chat works, so migrations
   043–052 ran on a real older database; the release's Windows installer
   was fetched by updaters right after promote (its download count went
   0 → 5 within fifteen minutes). Not reported: the About page's downloaded
   line, a `_bz2.pyd` lock dialog, `galley version` from the bundled CLI and
   the `app.galley.backup.*` file. The macOS hop through the
   install-at-restart path is still unobserved. `v0.6.1` → `v0.6.2` passed
   (JC reported 2026-10-23, at the `v0.7.0` release); `v0.6.0` → `v0.6.1` and
   `v0.5.6` → `v0.6.0` were never reported; `v0.5.5` → `v0.5.6` passed on JC's
   Windows machine (2026-10-01, same session; the bundled CLI came out at
   0.5.6 too); `v0.5.4` → `v0.5.5` passed on an
   installed build (JC reported 2026-10-01, same session as the release);
   `v0.5.3` → `v0.5.4` was never reported and is written off (asked again at
   the `v0.5.5` release, no result; no `v0.5.3` build is left installed);
   `v0.5.2` → `v0.5.3` passed on an
   installed build (JC reported 2026-09-23, same session as the release);
   `v0.5.1` → `v0.5.2` passed (JC reported 2026-09-23);
   `v0.5.0` → `v0.5.1` was never reported and is written off;
   `v0.4.16` → `v0.5.0` passed (JC confirmed 2026-09-17).
   The `v0.4.8` → … → `v0.4.16`
   hops were never explicitly reported and can no longer be run (no older
   build left installed) — write them off next pass unless JC recalls them.
   All earlier hops through `v0.4.7` → `v0.4.8` passed
   (JC confirmed 2026-08-13 / 2026-08-14), except **`v0.4.6` → `v0.4.7`,
   never run and off the normal path**: a hop can only be tested from the
   older build still installed, so it needs a deliberate downgrade or a
   write-off — do not let it sit here reading as pending. Keep asking for the
   step 10 result explicitly during step 9 — the smoke happens outside any
   agent tool call, so silence is not evidence it was skipped.
2. Watch tool-output truncation. The cap follows `maxlen_multiplier` (a
   denominator): the `308153b` baseline (shipped in `v0.4.5`) took it
   2.25 → 1.93 (~14% tighter), and `1b6442f` (shipped in `v0.5.1`, upstream
   `default_context_win` 35000 → 38000) took it to 1.78 (−8%); no baseline
   since has moved it, `d66509b` included. `...[Truncated]...` arriving
   sooner is the regression direction that only long real sessions surface.
3. Verify the reply-done / ask_user notifications on an installed
   Windows build (macOS was smoked at release; `tauri dev` cannot show
   notifications on macOS — see devlog 2026-07-21-reply-done-notification).
   `v0.4.5` adds sounds to these, so the Windows pass now also covers the
   three tones. Now live in issue #16: the reporter says the system sound is
   inaudible; a clarifying comment (2026-08-18) asks for their version,
   whether toasts appear, and the Windows per-app sound / Focus Assist
   settings. An in-app bundled-audio playback design is the standing
   candidate if the OS-toast sound path proves unreliable.
4. Keep Windows ARM out of the stable supported matrix. Add it later only after
   the release workflow, bundled Python, updater manifest, and smoke path all
   support `aarch64-pc-windows-msvc`.

## Unreleased On Main

Release-scope truth is `git log v0.7.8..HEAD`. Merged since `v0.7.8`:
the release docs, and one change to the app:

- **IM answers carry only the answer** (2026-11-11,
  [devlog](./devlog/2026-11-11-im-answer-only.md)): the 过程 button on
  Telegram and Discord, the 过程 panel on Feishu and WeChat's
  `N 步 · 用时 X` last line are gone; the live status message, stop
  receipts, questions and the error line are as they were; a 过程 button
  already sent loses itself when tapped. The IM entry layer gained a
  paragraph: the user never sees the steps, and asked for the process the
  agent retells it and does not run it again (eval on gpt-6.1-sol: 9 of 12
  without it, 12 of 12 with it). `managed-ga/` (patches `0023`, `0024`,
  `0026`, `0029`), `runner/` and `core/` changed, so the next release runs
  the bundled-runtime gate. Not yet seen on a real channel: JC's dogfood is
  open (`.scratch/im-answer-only/`, ticket 01 section 6), stripping an old
  button was tested on fakes only, and a task with side effects asked
  「过程给我看看」 was not measured.

**Owed from the `v0.7.8` smoke** (the list is in the release devlog). JC
smoked the Mac draft and approved publish. What the database and the
process list show of it: the packaged app up with its browser bridge and
four IM supervisors and no report of a capability error (the shell plugin's
removal, `--sop-path`'s removal); the main chat answered through two
subtasks that drove the browser (the `runner/*.py` mapping and the slimmed
payload work on a packaged build); a repeating to-do noted by the main chat,
ticked in the window 18 seconds later, its next period made in the same
second and cancelled 50 seconds after. Not seen or not reported:

- Repeating to-dos: a reminder actually going off (the period was ticked
  before any could) and being re-armed for a period left open, and the new
  wake note, still have automated tests only; a 280px panel, the English
  time line, the keyboard focus ring on the date trigger.
- Tickets 160–163 (the panel's rows move): JC ticked one to-do on the
  packaged build and said nothing against the feel; several ticks in a row
  and the archive / edit-project dialogs' checkbox were not reported. Not
  measured: the press itself, reduced motion, a narrow header, a row
  changing place while its date popover is open.
- The memo page in the dark theme.
- From the audit: the rollback when Core refuses a write, the new error
  copy, ⌘K's row by mouse and its blank-text and in-conversation cases.
- W1, the Windows checklist: not walked. A Windows update to 0.7.8 and use
  after it were reported normal the same day (post-release follow-up 1), so
  the hook does not break an in-app update's restart (the risk audit ticket
  04 named). Still not reported: the manual upgrade with the old app and a
  `galley` CLI command running (both closed, no file-lock dialog,
  `where.exe galley` at the app's version), which keeps audit ticket 04
  open, and every Windows checklist item below. The migration half of the
  W1 notes in the older sections below (053–056 on an older Windows
  database) is answered by the same user's report; JC's own Windows machine
  has still not run them.
- The eval's `w-long` case stays record-only, and the `wake` suite has no
  case for a hand-over that asked for a screenshot whose file is missing.

**Owed from the `v0.7.7` smoke** (the list is in the release devlog). JC
smoked the Mac draft and approved publish. The database shows the draft's
first launch (09:00:44 UTC) caught up a due reminder that woke the main
chat, which answered in 3 steps at 09:01:26; no message from JC followed,
so the S1 sentence was not sent: the told line growing out of the dots
(ticket 149) and a told line's landing bounce were not seen on a packaged
build. In dev, ticket 149's 「连着 4 句」 was not walked either (the 07:58
dogfood turn had one told line). Tickets 148–151 keep their Open risks in
their reports; the ones only Windows can show (ticket 150: the step look at
1.25 / 1.5 pixel ratios, Chromium scroll anchoring read as your own scroll)
wait for W1. Not done: W1 (JC skipped it; the main session recommended it
this time).

**Owed from the `v0.7.6` smoke** (the list is in the release devlog). S1
(it looks the weather up itself, a line first, sources) and S2 (an
interjection read at the next step) passed on the first draft; S3 failed
there (the merge round drew nothing for ~54 s) and passed on the second:
two subtasks dispatched 33 s after the message, back 323 s apart, one
wake carrying both, the merge round's first step 13 s after the wake and
its answer at 73 s in 3 steps, no read of the saved prompt file (upstream
still writes one per long wake into the state root's `temp/`, ticket 147
Open risk 6). JC said S3 passed; the merge round's first-frame slide and
ruling 197's sidebar and panel parts were not reported one by one. Ticket
147's other Open risk stands: on glm and deepseek a merge of long results
dropped its sources (evals run on gpt-6.1-sol only from 11-04). Not done:
W1, a Windows install, which would also be the first packaged build to
run migrations 053–056 on an older database (the Windows machine's is
likely at 052).

**Owed from the `v0.7.5` smoke** (the list is in the release devlog). S1
and S3 passed by JC's word: the reply notification read 「Galley · …」 and
the one frame looked right (ticket 133's three daily-use risks, a lone item
reading as a card, 12px file names and two frames with 过程 open, were not
reported one by one). S2: the weather question was answered in the main
chat (8 steps); the first dispatch sentence was answered too, correctly
under ruling 160 (the sentence was wrong), and became ruling 183; the two
replacement sentences (a research report; two independent file errands in
one message) were not sent; parallel dispatch on a packaged build was
first seen in `v0.7.6`'s S3 (two subtasks, both drafts). Ticket 129's
undelivered-report notification was not provoked. W1 is carried under
`v0.7.6` above. Still owed from before: ticket 04's second
real-machine step (stopping a workbench run you watch); ticket 98's noticed
interest (from `v0.7.2`).

**Owed from the 10-28 trial review** (run in the `v0.7.4` pre-flight, verdict
do not tighten; the report is in the release devlog). JC's answers: whether
the two times it spoke unasked were useful (10-21 21:50, the NBA answer it
thought was missing; 10-28 23:53, the client-project intake template); whether the
10-28 invoice run counts as 「别这样」 (a ticket 106 test sentence meant to
note a to-do; it renamed six real invoice files in the Downloads folder,
wrote a summary sheet and put the folder rule into GA memory; the memory
goes, JC 2026-11-02, main chat PRD ruling 163); why 905's reminder was cancelled on 10-29; and the
feelings the remaining deferred signals ask for. One mismatch to settle: the
10-28 23:53 reply's `content` does carry a `[FILE:]` line, while ruling 154
point 7 and the deferred 「Galley 做的文件放哪」 say it did not; if JC saw no
file card that night, the cause is elsewhere.

**Owed from the `v0.7.4` smoke** (the list is in the release devlog). S1
passed on the second draft: the main session fired the morning review 8
seconds after launch (the first draft went blank with the catch-up 7 seconds
after), and the main chat showed its history while the review ran and after
it ended silent (window screenshots; 312 messages in the database). Whether
the GUI got the live turns before its history read that time cannot be seen
from outside (the timing logs stay in the webview console), so ticket 113's
real-window repro is still owed: the next launch where the morning review
catches up and wakes is the natural one. S2: the drag is in the database (an
item moved to first at 06:45 UTC, while the review ran); ticking and
unticking an item and opening the file named in the notes were not
reported. Not done: W1, a Windows install, which would also be the first
packaged build to run migration 054 on an older database (dev migrated the
Mac's database on 10-29) and the first Windows run of the item drag. Ticket
110's first morning ran on the first draft: the catch-up at launch woke (the
client-project to-do changed on 10-29; the review log records only `woke`), read the
lists, wrote nothing and ended `<no-reply/>`.

**Owed from the `v0.7.3` smoke** (JC approved publish without reporting
smoke items, 2026-10-28; the list is in the release devlog). JC installed the
draft on the Mac and the main chat noted a to-do on it (09:44 UTC,
`todo_4b6c10feee22e419`, read from the database), so a to-do card appeared
on a packaged build. Not reported: the card's glyph flying into the 待办
button (S1), a reminder card showing only its first line and its words
opening the panel (S2). Skipped by JC before the tag: ticket 101's station 2,
the panel opening by itself on the 「备忘」 page for a memo card (D1); the
tickets' dev records do not cover it either (station 1's page and highlight
and station 3 were not reported), so the reminder / memo auto-open has only
vitest coverage. Not done: a Windows install (W1), which would also cover
ticket 105's open risk: how the model passes the reminder's line break to
the CLI under PowerShell / cmd was never tested (the manual's hint assumes a
POSIX shell); at worst the card shows a literal `\n` and the notes after it.

**Owed from the `v0.7.2` smoke** (JC approved publish without reporting
smoke items, 2026-10-27; the list is in the release devlog). JC installed the
draft on the Mac at 03:17 UTC and the main chat ran one browser task on it
(`web_execute_js` ×3, `web_scan` ×1, to a final answer; ChatGPT plan, six
requests with 77,952 tokens read from cache against 18,464 uncached, read from
the database), so M3 (the prompt cache on a packaged build) passed. Migration
053 did not run on the packaged build: dev had already migrated the shared
database on 2026-10-26, so no new `app.galley.backup.*`. Not reported: a memo
card and deleting it on the 「备忘」 page (M2); not done: a model switch in a
new workbench session (M4), a Windows install (W1).

**Owed from the `v0.7.1` smoke** (JC approved publish without reporting
smoke items, 2026-10-26; the list is in the release devlog). JC installed the
draft on the Mac and the main chat ran two browser tasks on it
(`web_execute_js` ×6, `web_scan` ×3, both to a final answer, read from the
database), so the `a9a36b4` engine's browser path ran on a packaged build.
Not reported: the main chat's progress line and its card, no flash of old
messages when a reply lands, bubble motion on send and delete, the title
menus without the pet; not done: a model switch in a new workbench session,
quitting with a live runner leaves no Python process, a Windows install.

**Owed from the `v0.7.0` smoke** (JC approved publish after part of it,
2026-10-23; the plan and results are in the release devlog):

- Windows: the main chat works after the H1 upgrade (JC, 2026-10-23), the
  first Windows run of the `5205f40` / `b70079d` engine; a fresh NSIS
  install, the black CMD window check and a model switch (G1) were not
  reported. Not walked: Sign in with ChatGPT (G4): the loopback sign-in
  listener (watch for a firewall prompt) and the credential pipe renamed
  `galley-codex-*` → `galley-credential-*` (CI's Windows job compiles and
  tests it; the runtime smoke is what's owed), with no fallback login left
  for Windows ChatGPT users; browser control's new-user walkthrough and the
  resident bridge (G5, G6, `.scratch/browser-control-ux/PRD.md`).
- Discord's restart continuity (D4): its resume is patch `0026`'s own copy,
  so Telegram, Feishu and WeChat passing does not cover it.
- The main chat's notifications on an installed build (F5): the reminder
  and a subtask that ran over two minutes fired on 2026-10-23, but whether
  the toasts showed was not reported; a review that only dispatches
  subtasks should show none.
- A1.5 (pausing and resuming the morning review by a sentence), A2.3 (an
  undated to-do noted mid-thing; a review run that only dispatches, then
  speaks when the subtask reports), A1.6's HTML / PDF hand-over and how the
  file card opens (the Markdown hand-over wrote its `[FILE:]` line).
- Sign in with ChatGPT on a packaged Mac build (F7; dev passed 2026-10-20).
- Tickets 73–79 on device: the morning review skipped for real on
  2026-10-23 and a new segment carried 10 turns with the 10-21 questions in
  it; the review speaking on a real model is still unverified, and the
  trial runs to 2026-10-28 (its "cancelled or found noisy by half, tighten
  the bar" conclusion goes into the next release). Tickets 81 (notes
  written for the user), 82 (a daily reminder's fire stays out of done) and
  86 (the unlabelled part); the two remembered to-do panel states across a
  restart and its empty state.
- IM, at first use: Feishu's queue, `/stop` and questions, Telegram's
  plain-quote expansion, Discord's conversation pass; WeChat's `/stop`
  (running and idle), two queued messages, a file sent back, `/new` mid-run.
- Main chat: JC's live look at subtask cards and the 「Galley ›」 breadcrumb
  (ticket 06a's four open points) and ticket 12's scroll feel; the Core send
  takeover (tickets 02a–02d) still has no GUI acceptance; APNs sending has
  not been tried against real APNs. Old orphaned `messages_fts` rows are not
  cleaned.

Follow-ups noted at the release (no tickets yet): prompt checklist item 10 answers 「我是你的
AI 助手」 without saying it is Galley (the role word is still 助手; only the
IM entry layer says 助理) and item 14's reply repeats its verdict in a closing
line, both for one `0.7.x` prompt ticket with its eval; the
comment at `core/src/migration_backup.rs:13` says the opposite of its test.

Carried forward. The README screenshots were re-shot (v3, 2026-10-21).
`.scratch/sidebar-project-groups/issues/03` (ready-for-agent) holds two
follow-ups from the 10-09 project passes: the edit dialog's folder hint should
follow `workspaceEnabled` (a CLI-created project without
`--enable-workspace` gets the wrong line), and 「收起」 vanishes when every
tail session is borrowed. Still owed from the `v0.6.2` smoke: the
packaged-build external-Python fix, the composer focus after creating a
project and 加入项目 → 新建项目…; on Windows F5 / Ctrl+R mid-run (steps and
final answer kept, the run not restarted; owed since `v0.6.1`, and that
WebView2 reloads on these keys is inferred, not observed) and the
CLI-directory PATH hint in Settings → 智能体接入. The new update path is
post-release follow-up 1.
Still owed from `v0.6.0`: the resident browser bridge (stdin EOF exit, the `GALLEY_CORE_PID` watchdog, a port held by another program), the
browser new-user flow (待解锁 → install → auto-verify → 试一试), which has not
been walked live on any platform, the ＋ menu's native file and folder
pickers, and the thin sidebar check circle on a 100% display. Watch the first
managed memory distillations on `f308ee7`: the one that ran in the `v0.6.1`
regression wrote nothing, so the merge-and-compress path is still unobserved
(fallback: a one-line managed patch back to minimal updates). Windows
drag-to-reorder in Settings → Models has still not been reported on, nor has
WeChat `/help` / `/status` on a paired account. The README social preview image
waits for JC to upload it in the repo settings. Regression leftovers were
cleared on 2026-10-23, except a Chrome tab from the `v0.6.1` round that was
not looked for. Small observations from the regression, none acted
on: over IM,
「现在 Galley 里在跑什么？」 ran the plain `sessions list` as the prompt says,
then filtered it and ran `status` (3 steps where `status` alone would do); a
reattached live runner does not replay `ready`, so its model list keeps the
seed values; CLI-created external sessions record no model display name. (The
「sticky provider header slides under the close button」 note is dropped: Settings
has no sticky header; it was ordinary scrolled content passing under the X,
which the pane's top safe zone and fade already handle, 2026-08-07.)
The #16 reply about approval waits is on hold (JC, 2026-10-06: no reply for
now).

The four community threads #29–#32 shipped in
`v0.5.6` and were answered 2026-10-01, all kept open:
[#29](https://github.com/wangjc683/galley/issues/29#issuecomment-5931634906),
[#30](https://github.com/wangjc683/galley/issues/30#issuecomment-5931635387)
(asks for `where.exe galley`, `galley version` and the `cli-path` line),
[#31](https://github.com/wangjc683/galley/issues/31#issuecomment-5931635868),
[#32](https://github.com/wangjc683/galley/issues/32#issuecomment-5931636343)
(asks for errors if Gemini / xAI reject a request; neither is tested).
`.scratch/windows-cli-version-lag/` is needs-info: the #29 / #30 reporter's
CLI reported 0.5.2 under app 0.5.3, but JC's Windows in-app update replaced the
bundled CLI, and Galley does not put the CLI on the Windows PATH, so the
leading lead is a user-made copy; the #30 reply asks for `where.exe galley`.
Found on the way: the NSIS pre-install hook's `Galley.exe` match (meant for the
main app, which is `galley-core.exe`) hits the CLI case-insensitively. Default since 2026-10-01: no upstream PRs
or issues unless JC asks; the upstream drafts in deferred are reference only.

Filed during the `v0.5.5` IM round and still
open: `.scratch/im-supervisor-context-bloat/` (done 2026-10-06 by the IM
entry layer rewrite; the IM live trial passed 2026-10-07, so the directory
can go) and
`.scratch/im-chrome-i18n/` (the IM chrome follows the UI language; deferred
to the end of the Discord / Telegram polish). The three open judgment calls
from the IM dogfood (subtext on one-step answers, narration kept in the
answered-question echo, the typing indicator lingering up to ~10 s) stay as
built.

Standing follow-ups: the ticket `.scratch/live-run-window/PRD.md`
stays `ready-for-human` until a few more live runs pass;
`.scratch/goal-simplify/` is `done` (and Goal itself was removed on
2026-10-13); the long-task resume path, should Goal ever be wanted back, and
the user-message typography re-review are in
[deferred](./devlog/deferred.md). The community 524 thread that prompted
`v0.4.15` has not yet been answered (reply draft agreed in session, awaiting
JC's per-item confirmation); the #21 thread has not yet been told the
ask_user option-description PRD was cancelled (2026-09-14, see
[devlog](./devlog/2026-09-14-ask-user-option-desc-cancelled.md)). Carried
over from `v0.4.12`: a scheduled task's same-day catch-up fire produced no
session twice in a row; the likely cause, found 2026-10-07 and fixed in
`6124cc16`, is the GUI hydrate sweep deleting a 「新对话」 session still on its
first turn (`last_run_session_id` is `ON DELETE SET NULL`), not yet confirmed
with a real scheduled task (see deferred); issues #26 and #27
stay open by JC's ruling, with the #27 commenter still owing a clarification
of their sidebar / project report. The managed WeChat channel's end-to-end
reply (the 2026-09-08 supervisor-side fix) was confirmed on JC's paired account
on 2026-10-10.

The GA baseline `1b6442f` (audited 2026-09-18) shipped again in `v0.5.2`
and `v0.5.3` without a re-audit — the pre-release audit was missed both times
(now a pre-flight item in the release SOP). At `v0.5.3`, upstream `main` was
two commits ahead (`e86ca72`: a WeChat QR docs update and upstream TUI
polish, neither of which Galley uses), so the shipped engine code is
current. At `v0.5.4` upstream was still `e86ca72`, so the audit was skipped
with that reason recorded in the release devlog. At `v0.5.5` upstream was at
`f308ee7`, eight commits ahead and the first skip with an engine-code delta
(`ga.py`'s memory-distill prompt rewrite, a claude-cli UA bump in
`llmcore.py`, one reflect-only line in `agentmain.py`); skipped as not
critical and still moving that day, with the full reasoning in the release
devlog. At `v0.5.6` upstream was still `f308ee7` and the audit was skipped a
fifth time; the memory-distill prompt got its own verdict (it moves from
"minimal update" to "merge duplicates, compress", letting the model rewrite
existing memory entries — user state — so it belongs in a separate audit with
observed long-term-update runs, not a fix release). The devlog recommends
running that baseline audit on its own, outside a release; whether and when
is JC's call. At `v0.6.0` upstream was still `f308ee7` and the audit was
skipped a sixth time on the same reasoning. On 2026-10-06 the audit ran on
its own, outside a release, and `f308ee7` became the audited baseline; it
shipped in `v0.6.1` and again in `v0.6.2`, both times with upstream still at
`f308ee7`. Upstream's default-constant line (`default_context_win`) has now
collided with patch `0007` twice in a row — expect it again. `5205f40`
(2026-10-18) and `b70079d` (2026-10-22) were audited on their own too;
`b70079d` shipped in `v0.7.0`, with upstream `main` still at it when the tag
was cut. `a9a36b4` was audited in the `v0.7.1` pre-flight (2026-10-26) and
shipped in it, then again in `v0.7.2` with upstream `main` still at it, and
in `v0.7.3` with upstream at `e4d956f`: six commits that touch only
`frontends/conductor.py` and `memory/` seed files, so the audit was skipped
(reasoning in the `v0.7.3` release devlog), and in `v0.7.4` with upstream
still at `e4d956f`, and in `v0.7.5` with upstream 17 commits past
`e4d956f`: among them `llmcore.py`'s split into `legacy_llmcore.py`, right
where patches `0007` and `0030` sit, so the bump gets its own round
(reasoning in the `v0.7.5` release devlog). That round audited `d66509b`
(2026-11-03), which shipped in `v0.7.6` with upstream 4 commits past it
(`38085e0`: reflect mode in `agentmain.py` and `frontends/p2p_ws_client.py`,
neither of which Galley loads, so not followed; reasoning in the `v0.7.6`
release devlog), and again in `v0.7.7` with upstream 8 commits past it
(`68d996a`: those four, the hub frontends' FastAPI lifespan fix and an
opt-in Claude `show_thinking` key Galley does not set, so not followed;
reasoning in the `v0.7.7` release devlog), and in `v0.7.8` with upstream
still at `68d996a`.

The `30b24ad` baseline bump filed one deferred item of its own — giving
`api_key_header` a GUI entry point in the Settings -> Models advanced panel,
which no user has yet asked for.

Two debts were found during the dark-theme work and deliberately left for
later, both in [deferred](./devlog/deferred.md): Tailwind v4 inlines `@theme --shadow-*`
values into the utilities it generates, so the dark `--shadow-*` block is
dead for the call sites writing the bare utilities (2026-11-10: 47
`shadow-elevated`, 9 `shadow-card`, one each `shadow-selected` and
`shadow-composer-stop`) rather than `shadow-[var(--shadow-card)]` and the
like; and dark's `--color-brand-tint` is still
carrying a `provisional` marker whose review this very dark pass should have
done.

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
| CLI / Agent API | `schemaVersion: 3` since v0.7.0 (Goal removed 2026-10-13); `2` (since v0.5.0) and `1` still served for unchanged commands | [agent-api](./agent-api.md) |
| Agent surface | Settings -> Agent, copy-first SOP, Claude Skill | [Supervisor SOP](./integrations/galley-supervisor-sop.md) |
| Managed GA runtime | Shipped in v0.2.0; Memory/SOP seed repair shipped in v0.2.6; upstream baseline: see the GA baseline row; GUI / CLI split, Provider / Model config, local encrypted SQLite credentials, and Project Workspace are the current baseline | [managed GA runtime](./managed-ga-runtime/README.md) |
| Data migration | Migrations run through `057_todo_series.sql`; v0.2.16 added managed-model custom `context_win` persistence; v0.2.15 added message telemetry persistence for final-answer footer metadata; v0.2.10 added a safe pre-plugin migration guard through 023 and best-effort child-row recovery from local backups for the v0.2.9 table-rebuild cascade hazard | [B4 M8](./archive/refactor/B4-M8-sub-plan.md) |
| Process lifecycle | v0.2.11 ships bridge parent watchdogs and duplicate-startup suppression to prevent background process pile-up | [release / update SOP](./release-update-sop.md) |
| Scheduled tasks | Shipped in v0.4.0: daily / weekly / monthly auto-start sessions, per-task model, approval-blocked notifications (gone with approval, 2026-10-05), missed-run catch-up; v0.4.2 adds the trust surface (failure badge / notifications, next-fire preview, Run now, launch-at-login hint) | [devlog](./devlog/2026-07-30-scheduled-tasks-trust-polish.md) |
| Release path | v0.7.8 stable patch is published and promoted on the stable update channel | [release / update SOP](./release-update-sop.md) |
| Channels | Four managed IM channels: WeChat, Feishu, Telegram, Discord. Discord (v0.4.7) is the first parallel-supervision-context channel — one channel = one supervisor context | [Discord shipping devlog](./devlog/2026-08-13-discord-channel-shipped.md) |
| Windows | Windows x64 remains the supported release target; Windows ARM is deferred until the release workflow and smoke path are added | [Windows checklist](./windows-build-checklist.md) |
| GA baseline | Audited upstream `d66509b` (2026-11-03), shipped in `v0.7.6` … `v0.7.8` (`a9a36b4` shipped `v0.7.1` … `v0.7.5`, `b70079d` shipped `v0.7.0`, `f308ee7` shipped `v0.6.1` … `v0.6.2`, `1b6442f` shipped `v0.5.1` … `v0.6.0`, `efb3bc6` shipped `v0.4.11` … `v0.5.0`; pre-rewrite SHAs like `1d3c1a09`/`5257dec` no longer resolve on official `main`) | [GA baseline](./ga-baseline.md) |

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

- Current package metadata uses `0.7.8`. For the next release, bump every
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
- Removals grade too (JC ruling, 2026-10-05, v0.6.0): removing a whole
  user-facing system that changes product behavior or the safety model
  (e.g. tool approval) is minor even when nothing is added. The magnitude
  rule above judges additions; a patch number would tell auto-updating users
  that nothing they rely on was taken away.
- `v1.0.0` waits for three conditions (JC ruling, 2026-10-22, when the
  main chat release was graded `v0.7.0` rather than `v1.0.0`): the phone
  client ships with the release build (the release workflow sets the relay
  URL and the iOS app is at least on TestFlight); the assistant and main
  chat get through one whole `0.7.x` line with no breaking schema or CLI
  change and no removal; and the Windows smoke owed in this document is
  cleared. Until then a product-shape change grades minor like any other
  line-sized feature; the release notes' opening carries the shape change,
  not the number.
- Use `vX.Y.Z` for Git tag and GitHub Release title.
- Agent API is at `schemaVersion: 3` (first shipped in `v0.7.0`); changes
  within a version are additive-only.
- A breaking Agent API change requires the next `schemaVersion`, with explicit
  compatibility notes in [agent-api](./agent-api.md) (how `1` and `2` are
  still served after the `3` bump is the template: stability §7).
