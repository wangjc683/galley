# 2026-07-20 - GA upstream upgrade 1e89c3e -> 5257dec

## Date / Status / Related

- Date: 2026-07-20
- Status: implemented in current worktree, pending release-owner acceptance
- Related:
  - [GA baseline](../ga-baseline.md)
  - [Managed GA patch stack](../../managed-ga/patches/manifest.md)
  - Upstream GA `5257decc8c7ac2484278c977b91d15cb09990fef`

## Context

Refreshing the bundled GA baseline before the `v0.3.4` release. Official
`lsdefine/GenericAgent` `main` advanced 7 commits after Galley's `1e89c3e`
baseline — a small, clean delta: 12 files, ~25 insertions / ~44 deletions.
Most of it is upstream's community desktop frontend (`frontends/desktop*`,
`frontends/desktop_bridge.py`, packaging CI), which is inert on Galley's path.
The two highest-risk contract surfaces — `agent_loop.py` and `pyproject.toml` —
did not change at all, so there is no external bridge protocol or bundled
dependency break.

Engine changes Galley cares about:

- `ga.py`: `GenericAgentHandler`'s blank-response check in `do_no_tool` was
  reverted to a permissive form (`not content.strip() and not thinking.strip()`).
  Upstream's earlier `c921bad` had tightened it by stripping
  `<thinking>`/`<summary>` and treating meta-only replies as empty, which
  force-retried legitimate summary-only / thinking-only turns; `8041554`
  reverted the core path (they also removed the strict handling from their own
  desktop frontend and deleted its `strip_non_user_visible_text` /
  `has_user_visible_text` heuristics entirely). The incomplete-response check
  now also catches `content.endswith('</summary>')`. Galley inherits fewer
  spurious retries. This is internal to the handler's response handling, not
  the dispatch signature or Galley's approval gate — `WorkbenchHandler` rides
  the latter, and Galley's runner never gated turn completion on
  "user-visible prose exists" in the first place (it subscribes to GA's
  turn-end hook), so it never had the false-negative upstream just fixed.
- `llmcore.py`: `NativeClaudeSession.ask()` gained three Anthropic beta headers
  — `thinking-token-count-2026-05-13`, `mid-conversation-system-2026-04-07`,
  `fallback-credit-2026-06-01`. Method signature and history block shape
  unchanged, so `NativeClaudeSession`'s membership in
  `runner/ga_session.py::_VALIDATED_HISTORY_BACKENDS` still holds. These are
  capability signals worth following up on separately (mid-conversation-system
  could let managed `extra_sys_prompt` update mid-session; thinking-token-count
  could feed the final-answer footer telemetry) — no Galley change this round.
- `assets/sys_prompt.txt`: four new execution principles added to the base
  system prompt (action-as-cognition, autonomous-closure with a stop-and-ask
  taxonomy, completion-in-reality, deliver-max-verified-result-on-block).
- `assets/global_mem_insight_template*.txt`: memory insight templates
  de-emphasize `plan_sop`'s hard-coded trigger (dropped from the L3 list and
  the "complex long-running → read plan_sop" SOP line), converging with the
  autonomous-closure principle.

No "upstream absorbed a Galley capability" claim this range — the changes are
upstream's own revert cycle, API-currency, and prompt-philosophy evolution.
Origin discipline (ga-baseline.md step 11) therefore needs no archaeology here.

## Patch stack rebase

The 14-patch stack (`0001`–`0015`, `0005` long removed) replayed clean onto the
new baseline via the commit-chain rebase script (`rebase-managed-ga-patches.sh`).
The old-chain replay byte-matched the checked-in payload first, then rebased
`--onto` the new baseline with zero conflicts.

From the baseline change, only `0001` and `0003` shifted, and only in their
zero-context `ga.py` `@@` line numbers: the empty-response tweak moved
`get_global_memory()` down 2 lines, so those two patches' downstream hunks moved
609→607 / 611→609 / 612→610 / 614→612 / 616→614. The `-`/`+` content is
byte-identical. (`0015` also changed this session, but for a tooling reason
unrelated to the baseline — see the rebase-script section below.) No
semantic conflict; managed state-root routing, Codex backend, and image
attachment path are preserved.

### The rebase script could not round-trip added binary files (fixed)

`0015` is the first patch in the stack that **adds** files — the Galley
extension icon PNGs, carried as git binary hunks. Re-running the rebase to
validate exposed that `rebase-managed-ga-patches.sh` silently dropped them, in
three compounding layers (all pre-existing; `0015` is simply the first patch to
trip them, since every other patch only *modifies* existing upstream files):

1. **Replay** (`git commit -am`) stages only modifications to tracked files, so
   `git apply` wrote the new PNGs to the worktree but they never entered the
   chain commit. Fixed: `git add -A` before commit.
2. **Byte-identity verify** built its file list from `+++ b/` lines, which
   binary hunks don't have — so the missing icons were never checked. Fixed:
   parse `diff --git a/… b/…` headers instead.
3. **Export** used `git diff -U0` without `--binary`, degrading any binary hunk
   to a `Binary files … differ` placeholder, and its `sed '/^index /d'` stripped
   the `index` lines that binary apply requires. Fixed: `git diff --binary` plus
   an awk that strips `index` lines from text hunks only (they churn and aren't
   needed) while keeping them on binary hunks, and a per-commit guard that fails
   the export if a binary-touching commit produced no `GIT binary patch` block.

Validation: an isolated round-trip test (commit a binary + text change, export,
re-apply to a fresh tree) confirms the PNG comes back byte-identical and the
guard rejects the old broken output. Re-running the full rebase with the fix now
regenerates `0015` with all four icon blocks intact and byte-identical binary
payloads; `build-managed-ga.sh` reproduces the checked-in payload exactly.

`0015` was normalized to the canonical form the fixed exporter produces — the
five text-hunk `index` lines dropped (consistent with the rest of the stack),
icons and every code hunk unchanged. Verified payload-equivalent: rebuilding
from it leaves `managed-ga/code` byte-identical (no `tmwd_cdp_bridge` churn).
The script fix and this `0015` normalization land as a separate tooling commit,
ahead of the baseline bump.

## Verification

- `rebase-managed-ga-patches.sh`: old-chain byte-matches payload; clean rebase.
- `build-managed-ga.sh`: all 14 patches applied; `py_compile` mis-drop sweep OK.
- `check-managed-ga-payload.mjs`: OK.
- Confirmed in the regenerated payload: `ga.py` permissive empty-response check,
  `llmcore.py` three new beta headers, `sys_prompt.txt` four new principles.
- `GA_PATH=/tmp/galley-ga-upgrade pytest runner/tests -m 'not e2e'`: 188 passed
  (6 e2e deselected) — empirically confirms `ga.py`/`llmcore.py` semantic compat
  against the new engine, including the managed llmcore and Feishu suites.
- `bundle-python.sh mac-arm64` + bundled managed-GA smoke: managed payload
  imports under isolated bundled Python (bridge-ready); GA deps unchanged
  (`pyproject.toml` had no dependency diff).
- `check-ga-baseline-drift.mjs`: OK — manifest, `defaults.ts`, `ga-baseline.md`,
  and patch `manifest.md` all name `5257decc`.

Synced baseline-repeating surfaces: `managed-ga/manifest.json`
(commit + auditedAt), `gui/src/stores/defaults.ts` (gaCommit / gaCommitDate /
gaBaseline), `gui/src/lib/managed-runtime-diagnostics.test.ts` fixture,
`managed-ga/patches/manifest.md` replay header, and `docs/ga-baseline.md`.

## Follow-up

- Dual-mode dogfood (external + managed) in `tauri dev` is the remaining manual
  gate before folding this into `v0.3.4` — JC's acceptance step.
- The `llmcore.py` beta headers open two concrete Galley opportunities
  (mid-session persona via `mid-conversation-system`, thinking-token telemetry
  in the footer) — tracked separately, not in this upgrade.
