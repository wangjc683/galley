# GA upstream upgrade: 1d3c1a09 -> 4086d5c (and the history rewrite)

Date: 2026-07-23

## Why this upgrade happened now

Not calendar-driven. The trigger was discovering that upstream
`lsdefine/GenericAgent` **force-pushed a rewritten `main`**: every commit
message was anglicized into conventional-commit form, which changes every
commit SHA from the rewrite point onward. Our recorded baseline
`1d3c1a09dfdaa76ba5dee82725fa599df7c16be4` (audited 2026-07-22, one day
earlier) became unreachable on official `main` — `1d3c1a09..origin/main`
suddenly showed "1162 new commits" with a merge-base back in March.

Tree-hash comparison resolved the illusion: new-history `8a75b39` has the
**same tree** as old `1d3c1a09` (`3817cec4…`), proving the rewrite was
message-only at that point. The real content delta was 5 commits
(`8a75b39..4086d5c`, 2026-07-22 evening through 2026-07-23 afternoon):
11 files, ~109 insertions / ~64 deletions.

Decision (JC, structured choice): full upgrade to the new-history tip
`4086d5c` rather than a minimal doc re-anchor to `8a75b39` — the audit was
already done as part of diagnosing the rewrite, the delta was unusually
small, and upgrading re-anchors every recorded SHA onto reachable history
in one move. Rejected alternatives: minimal re-anchor (leaves the 5 commits
for a second audit later), wait-and-observe (leaves the maintainer clone as
the only evidence link for the old SHA while upstream moves fast — 3
commits landed on 07-23 alone).

## What the 5 commits contain

- `400c9ef` / `733615d` — LLM-session reload robustness in `agentmain.py`
  (sticky `llm_no` re-matched by backend name across mykey reloads, empty
  `llmclients` guard), `reload_mykeys` thread lock + `sys.modules.pop`
  reload in `llmcore.py`, `resolve_session` stamps `cfg['_mykey_name']`,
  stapp/portal UX, mainland-China no-Git installer.
- `7fede5a` — conductor/desktop frontend controls; inert for Galley.
- `0a54c74` — `BADMIXIN_i` placeholder for invalid mixin configs on reload.
- `4086d5c` — working-memory tool tightening: `update_working_checkpoint`
  loses `related_sop`, `start_long_term_update` refuses before turn 10.
- `memory/tmwebdriver_sop.md` — one-line login-flow change (direct CDP
  click on the login button, old field-release sequence as fallback). The
  browser extension itself did not change in this range; the extension
  changes people heard about (legacy DOM bridge removal, HTTP-origin
  guard) were the previous range, audited 2026-07-22.

Contract surface: `agent_loop.py` and `pyproject.toml` zero diff; dispatch,
hooks, history shape, `NativeClaudeSession.ask()` all untouched.

## The one real compat point

`get_llm_name()` display format dropped the `Session` suffix
(`NativeClaudeSession/x` -> `NativeClaude/x`). Galley's
`Bridge._initial_llm_index` restored persisted LLM selections by exact name
match, so old persisted names would silently fall back to LLM 0 after the
upgrade (and new-format names would fail against an old attach-mode GA).
Fix: `_normalize_llm_name` strips `Session` from the class segment on both
sides of the comparison — one normalization covers both GA generations in
both runtime modes. `_llm_display_name` was already immune (it drops the
class segment entirely in managed mode).

## Patch stack

Commit-chain rebase (`scripts/rebase-managed-ga-patches.sh`), one real
conflict, exactly where the pre-replay audit predicted: `0001`'s
`agentmain.py` `log_path` state-root redirect vs upstream's new
`self.llmclient = None` on the adjacent line — resolved by keeping both.
The other 13 patches replayed clean; `llmcore.py` hunks shifted ~4 lines
(new thread lock at top of file) and `ga.py` hunks ~2 lines
(working-memory handler edits), which is precisely the silent-mis-drop
scenario the -U0 stack + rebase script exists for. `py_compile` sweep and
payload check passed.

## Process hardening from the rewrite

- `docs/ga-baseline.md` now records the baseline **tree hash** next to the
  commit SHA — tree identity survives message-only rewrites and is the
  proof mechanism if this happens again.
- New upgrade trigger documented: upstream history rewrite -> re-anchor
  promptly while a pre-rewrite clone still exists.
- Standing caveat recorded: `git log -S` archaeology against pre-rewrite
  ranges must run in a clone that fetched the old objects (the maintainer's
  `~/Documents/GenericAgent`); a fresh clone of upstream can no longer see
  them.

## Verification

- `GA_PATH=/tmp/galley-ga-upgrade pytest runner/tests -m 'not e2e'` — 189
  passed (includes new cross-format LLM-name restore test).
- `mypy runner`, `ruff check runner` — clean.
- `build-managed-ga.sh` compile sweep, `check-managed-ga-payload.mjs`,
  `check-bundled-python-managed-ga.sh` — all OK; `pyproject.toml` unchanged
  so no bundle dependency work.
- `check-ga-baseline-drift.mjs`, `pnpm --dir gui typecheck` / `lint` — run
  after syncing `gui/src/stores/defaults.ts`, the diagnostics test fixture,
  and `managed-ga/patches/manifest.md`.

Shipped-baseline note: `v0.3.7` (released 2026-07-22) ships `5257dec`; this
audit moves the **audited** baseline only, per the usual one-release lag.
