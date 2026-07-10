# 2026-07-10 - GA upstream upgrade b1e173dc -> 502be0a

## Date / Status / Related

- Date: 2026-07-10
- Status: implemented in current worktree
- Related:
  - [GA baseline](../ga-baseline.md)
  - [Managed GA patch stack](../../managed-ga/patches/manifest.md)
  - Upstream GA `502be0a76d04e6d7063c28b3bbb77adb1047ba6b`

## Context

Official `lsdefine/GenericAgent` `main` advanced 10 commits after Galley's
`b1e173dc` baseline. The delta is mostly additive on the external / attach
contract surface:

- `llmcore.py`: Claude `stop_reason == "refusal"` handling (no retry),
  `ChunkedEncodingError` added to the retry set, suppression of the
  intermittent retry-error yield, and two opt-in session config keys —
  `extra_sys_prompt` / `extra_sys_prompt_file` and `omit_thinking`.
- `agentmain.py`: additive `--no-user-tools` flag that filters `ask_user` /
  `start_long_term_update` out of the tool schema.
- `agent_loop.py`: whitespace-only tweaks to the yielded turn / tool markers.
- `assets/ga_ultraplan.py`: an UltraPlan orchestration refactor that also
  introduced a `GA_ULTRAPLAN_RUNDIR` env override for the run directory.
- `mykey_template*.py`, TUI worldline / session-control work, a background
  `ljqCtrl` tool, GUI SOP guardrails, and a WeChat QR refresh — none on
  Galley's authoritative path.

`pyproject.toml` did not change, so bundled Python dependencies are unchanged.

## Decisions

- Upgrade the audited baseline from `b1e173dc` to `502be0a`.
- Rebuild `managed-ga/code` from a clean official checkout at the exact target
  SHA and replay the managed patch stack.
- Keep attach / external GA non-invasive: no external checkout is pulled,
  patched, or mutated.
- Rebase `0001-managed-state-root.patch`'s `ga_ultraplan.py` hunk to a single
  line that **adopts upstream's new `GA_ULTRAPLAN_RUNDIR` env seam** and falls
  back to `GALLEY_GA_STATE_ROOT/temp` (never the read-only code payload). This
  is the "upstream now provides the capability" case in the patch discipline:
  the previous multi-line `_CODE_ROOT` / `_STATE_ROOT` scaffolding and the
  now-redundant `_subagent` dedup hunk were dropped.
- Regenerate `0007-managed-codex-backend.patch` against the shifted
  `llmcore.py` line numbers. The old patch inserted the ~151-line Codex helper
  via a pure-positional zero-context hunk; upstream's line shift moved the
  insertion into the middle of `_stream_with_retry`, orphaning the retry loop.
  Regenerating with `git diff -U0` from a content-anchored reconstruction fixed
  the placement and a latent off-by-one in the insertion hunk's line count
  (152 added lines, header claimed 151 — previously masked by git's fuzzy
  apply).
- Sync the GUI fallback baseline metadata (`gui/src/stores/defaults.ts` and its
  diagnostics test) to the new manifest commit so first paint and diagnostics
  do not drift.
- Leave bundled Python dependencies unchanged because upstream `pyproject.toml`
  did not change.

## Rejected Alternatives

- Drop the `ga_ultraplan.py` run-dir hunk entirely and set `GA_ULTRAPLAN_RUNDIR`
  from Galley's Rust env-injection points instead: upstream's default still
  writes into `_ROOT/temp` (the read-only code payload) when the env var is
  unset, so Galley must still guarantee a safe fallback. Keeping the guarantee
  inside the one-line patch is lower-risk than editing three Rust env sites plus
  the runner, and it still honors the upstream env var as the primary override.
- Hand-edit the `0007` insertion anchor line number in place: git apply's fuzzy
  offset for a pure-add hunk is target-dependent and unpredictable, so a
  hand-tuned anchor would be fragile. A full `git diff -U0` regeneration
  produces self-consistent, correct line numbers and counts for all hunks.
- Auto-upgrade user-owned external GenericAgent checkouts: still violates the
  attach-mode contract.

## Verification

- `scripts/build-managed-ga.sh` replays all 14 patches clean; payload check OK.
- Built `llmcore.py` and `ga_ultraplan.py` compile; Codex markers
  (`_galley_codex_access_token`, `ChatGPT-Account-ID`, `store=False`,
  `codex_cli_rs`) and state-root routing (`GALLEY_GA_STATE_ROOT`,
  `GA_ULTRAPLAN_RUNDIR`) present in the built code.
- Runner: 173 pytest passed (non-e2e), `mypy runner` clean, `ruff check runner`
  clean.
- Drift gates: supervisor-SOP drift, managed-GA app-bundle, and docs-link
  checks all pass.

## Open Questions

- The `0007` Codex helper block is still inserted via a zero-context hunk keyed
  on line position. If upstream keeps churning `llmcore.py` around
  `_stream_with_retry`, consider anchoring the insertion to a stable context
  landmark (or upstreaming the Codex backend) to avoid repeated regeneration.

## Next

- JC to dogfood managed mode (model config injection, streaming, tools, state
  under app data, restart / restore) before this baseline ships in a release.
