# 2026-07-15 - GA upstream upgrade 502be0a -> 1e89c3e

## Date / Status / Related

- Date: 2026-07-15
- Status: implemented in current worktree
- Related:
  - [GA baseline](../ga-baseline.md)
  - [Managed GA patch stack](../../managed-ga/patches/manifest.md)
  - Upstream GA `1e89c3eece5a54938c06156a0e49de76ca926e07`

## Context

Official `lsdefine/GenericAgent` `main` advanced 362 commits after Galley's
`502be0a` baseline — but the count is misleading. Upstream merged the
community GA Desktop frontend (PR #671: `frontends/desktop/`, packaging CI,
release workflows), which accounts for nearly all of it. The engine-core
delta is 12 files / ~380 lines, and the two highest-risk contract surfaces —
`agent_loop.py` and `pyproject.toml` — did not change at all.

Engine changes Galley cares about:

- `ga.py`: `code_run` now sets `stdin=subprocess.DEVNULL` natively (Galley's
  `0005` patch, absorbed); `file_write` / `file_patch` preserve the target
  file's newline style (LF no longer polluted to CRLF); `_arg` type coercion
  for tool args; tool-output limits scale with `context_win` via the additive
  `GenericAgent.get_ctx_multiplier()`.
- `llmcore.py`: opt-in `trim_keep_prefix`; `maxlen_multiplier` /
  `cut_msg_interval` scaling; `reasoning_effort: 'max'`; MixinSession
  rewritten as a routed facade.
- `plugins/project_mode.py`: pid-anchor files replaced by the
  `_ga_project_mode_name` agent attribute as the only mechanism. Origin
  check (git archaeology, 2026-07-15): the attribute seam was introduced
  by upstream's TUI work (PR #607, 2026-06-14); Galley adopted it on
  2026-06-18 (`runner/ga_session.py::set_project_mode`). So this is
  upstream promoting its own seam — which Galley already rides — not
  upstream adopting Galley's.
- `memory/verify_sop.md` → `deliverable_audit_sop.md` rename.
- `TMWebDriver.py`: `safe_print` hardening.

## Decisions

- Upgrade the audited baseline from `502be0a` to `1e89c3e` (locked from
  `refs/heads/main` on 2026-07-15), riding the pre-release audit trigger:
  the topbar update indicator, toast severity fix, and OAI history-restore
  validation are queued for the next patch release.
- Drop `0005-code-run-noninteractive-stdin.patch` — upstream now carries a
  byte-identical fix (PR #678, motivated by their TUI-v2 hitting the same
  inherited-stdin bug; independent convergence, not an import of Galley's
  patch). First "upstream provides the capability → remove the patch" case
  that deletes an entire patch rather than shrinking one.
- Regenerate the **whole patch stack via a commit-chain rebase** instead of
  fixing patches one by one: replay the historical 14-patch stack as git
  commits on the old normalized baseline (byte-identical to the shipped
  payload — verified), then `git rebase --onto` the new normalized baseline
  with `--empty=drop`. Two real conflicts (0001's project_mode hunk, 0007's
  import/`BaseSession.__init__` lines) were resolved by hand; every other
  patch relocated correctly through git's content-aware merge. Exported back
  to zero-context patch files with `git diff -U0`.
- Slim `0001`'s `plugins/project_mode.py` hunk to just the
  `GALLEY_GA_STATE_ROOT` temp redirect; the anchor-file cleanup machinery it
  used to carry was deleted upstream along with the anchors.
- Keep `MixinSession` **out** of `_VALIDATED_HISTORY_BACKENDS`. The facade
  refactor keeps `history` as plain get/set state, so GaSession's restore
  write still lands, but block-shape validity depends on the routed group
  and stays unaudited. Also noted: the facade's new `__setattr__` raises on
  node-specific attributes; `install_managed_prompt_profile`'s
  `extra_sys_prompt` write is safe because managed model config never emits
  mixin configs — revisit if managed mode grows channel-group models.
- Update `scripts/check-managed-ga-payload.mjs`'s critical memory-seed list
  for the `deliverable_audit_sop.md` rename (the state seed itself
  regenerates from the upstream archive during the build).
- Sync the GUI fallback baseline metadata (`gui/src/stores/defaults.ts`,
  diagnostics test) to the new manifest commit.
- Leave bundled Python dependencies unchanged (`pyproject.toml` zero diff);
  rebuilt the mac-x64 bundle and reran the managed-GA import smoke anyway.

## Rejected Alternatives

- **Per-patch spot fixes.** The first replay attempt showed why not: `0002`
  and `0006` "applied cleanly" but landed mid-function after upstream line
  shifts — zero-context hunks fail silently by design. Only a compile sweep
  caught them. The chain rebase makes git's three-way merge do the
  relocation and surfaces real conflicts as conflicts. Follow-up hygiene now
  lives in the build flow: `python -m py_compile` over the payload is part
  of the upgrade checklist.
- **Excluding `frontends/desktop/` from the payload.** It is ~1.1 MB of
  inert upstream source; the payload has always vendored `frontends/`
  wholesale, and a curated exclude list is one more thing to drift. Revisit
  if payload size ever matters.
- **Waiting out the post-merge cooldown.** The desktop merge landed upstream
  on 07-14, one day before this audit. Since Galley touches none of the
  desktop code and the engine delta audits clean file-by-file, waiting
  bought nothing.

## Verification

- `build-managed-ga.sh` replays the 13-patch stack clean;
  `check-managed-ga-payload.mjs` OK; payload byte-identical to the audited
  rebase chain; full-payload `py_compile` sweep clean.
- `GA_PATH=<new checkout> pytest runner/tests -m 'not e2e'`: 188 passed.
  mypy + ruff clean.
- `bundle-python.sh mac-x64` + bundled managed-GA import smoke: OK.
- Dogfood (JC): managed-mode multi-step task + external-attach sanity pass
  pending in the real app.
