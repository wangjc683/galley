# GenericAgent Baseline

> Maintainer-facing document. Contributors touching GenericAgent integration
> should read this; most users do not need it.

Galley integrates with GenericAgent in two different ways:

- **External / attach GA**: user-owned GenericAgent. Galley audits
  compatibility but never upgrades or modifies that checkout.
- **Managed / bundled GA**: Galley-owned GenericAgent runtime. Galley vendors
  the audited upstream commit and reapplies its managed-runtime patch stack.

The baseline records the upstream GenericAgent commit that both paths have been
audited against.

## Current Baseline

Locked commit: `1e89c3eece5a54938c06156a0e49de76ca926e07`

- Source: `lsdefine/GenericAgent` upstream `main`
- Date audited: 2026-07-15
- Previous baseline: `502be0a76d04e6d7063c28b3bbb77adb1047ba6b`
- Delta: 362 commits by count, but almost all of it is upstream's merge of the
  community GA Desktop frontend (PR #671, `frontends/desktop/` + packaging CI).
  The engine-core delta is 12 files / ~380 lines.
- Note: "current baseline" = latest **audited** commit. What a released
  build actually **ships** can lag one release behind — see
  [project status](./project-status.md) for the shipped baseline.
- Result: no external bridge protocol or dependency break; `agent_loop.py` and
  `pyproject.toml` did not change at all. Managed runtime picked up the
  `file_write` / `file_patch` newline-preservation fix (LF files no longer
  polluted to CRLF), `_arg` tool-argument type coercion, tool-output limits
  scaled by `context_win`, opt-in `trim_keep_prefix`, `reasoning_effort: max`
  for OpenAI, TMWebDriver `safe_print` hardening, and the MixinSession
  routed-facade refactor. Upstream independently shipped a byte-identical
  `code_run` stdin fix (Galley's `0005` patch → removed) and promoted the
  `_ga_project_mode_name` attribute — the upstream TUI seam Galley already
  rides — to Project Mode's only mechanism.
  The whole managed patch stack was regenerated via a commit-chain rebase
  (see patch manifest); Galley's managed state-root routing, Codex backend,
  and image attachment path are preserved.
- Devlog: [GA upstream upgrade 502be0a -> 1e89c3e](./devlog/2026-07-15-ga-upstream-upgrade-502be0a-to-1e89c3e.md)

Relevant compatibility notes:

- `agent_loop.py`: zero diff in this range — dispatch protocol, hooks, and the
  structured `{'turn': turn}` yield are byte-identical.
- `ga.py`: upstream now sets `stdin=subprocess.DEVNULL` in `code_run` (Galley's
  `0005` patch verbatim → patch removed). `file_write` / `file_patch` preserve
  the target file's existing newline style. Tool handlers use `_arg` type
  coercion and scale output limits via the additive
  `GenericAgent.get_ctx_multiplier()`. `GenericAgentHandler` init signature and
  import path are unchanged.
- `llmcore.py`: `BaseSession` gains `trim_keep_prefix` (default 0, off) and a
  `maxlen_multiplier` derived from `context_win`; hard trims can now keep a
  leading prefix and insert a `"..."` gap turn — history block shape is
  unchanged. `NativeClaudeSession.ask()` and `NativeOAISession` are untouched,
  so the history-restore validation for both classes in
  `runner/ga_session.py::_VALIDATED_HISTORY_BACKENDS` holds at this baseline.
  `MixinSession` became a routed facade: `history` is now facade-owned state
  (still plain get/set — GaSession semantics preserved; the class stays
  outside the validated restore set), but its new `__setattr__` **raises** on
  node-specific attributes. Galley's managed model config never emits mixin
  configs, so `install_managed_prompt_profile`'s `extra_sys_prompt` write is
  unaffected; revisit if managed mode ever grows channel-group models.
- `plugins/project_mode.py` + `memory/project_mode_sop.md`: upstream replaced
  the pid-anchor files with the `_ga_project_mode_name` agent attribute — the
  seam its TUI introduced in June (PR #607) and Galley already sets in
  `runner/ga_session.py::set_project_mode` (`ga.py` gained
  `handler.enter_project_mode()` writing the same attribute).
  `_ga_project_mode_workspace_path` remains Galley-only. `0001`'s project-mode
  hunk shrank to the `GALLEY_GA_STATE_ROOT` temp redirect.
- `memory/`: `verify_sop.md` renamed to `deliverable_audit_sop.md` (plus
  `plan_sop.md` reference updates). The state seed regenerates from upstream,
  and `scripts/check-managed-ga-payload.mjs`'s critical-file list now names
  `deliverable_audit_sop.md`.
- `TMWebDriver.py`: prints wrapped in `safe_print` (survives stdout revoke);
  `0006` rebased over it cleanly.
- `mykey_template.py`: comment/doc updates only — no key renames; the managed
  model config generator is unaffected.
- `frontends/desktop/` and packaging CI: upstream community desktop app,
  vendored into the payload as inert upstream code; not on any Galley path.
- `pyproject.toml`: no dependency diff in this range; bundled Python
  dependencies did not need changes.

## Contract Surface

When auditing a GenericAgent upgrade, focus on these surfaces:

1. `BaseHandler.dispatch` signature and generator protocol
2. Whether `BaseHandler.dispatch` calls callbacks or `plugins.hooks`
3. Galley's `WorkbenchHandler.dispatch` approval gate before `super()`
4. `BaseHandler.turn_end_callback`
5. `agent._turn_end_hooks`
6. `agentmain.GenericAgentHandler` import path
7. `llmclient.backend.history` read/write semantics
8. `agent.list_llms()` behavior
9. `llmclient.last_tools` attribute (reinject-tools reset)
10. `assets/tool_usable_history.json` path + block schema (mirrors
    `stapp.py`'s Reinject Tools)

Galley may read GenericAgent public APIs and stable in-memory objects. Galley
must not write GenericAgent source, memory, venv, PATH, or runtime state.

### Where each coupling lives in Galley (audit entry points)

Since 2026-07-11 the agent-object couplings have a single code home —
start the audit there instead of grepping the bridge:

- **[`runner/ga_session.py`](../runner/ga_session.py)** — items 5, 6, 7,
  9: every internal/underscore/backend touch (`_turn_end_hooks`,
  `backend.history` read/set/extend + context estimation, `last_tools`,
  the `GenericAgentHandler` module rebinding). Read the file top to
  bottom against the new baseline.
- **[`runner/handlers.py`](../runner/handlers.py)** — items 1–4: the
  `WorkbenchHandler` subclass and its dispatch/approval assumptions.
- **`runner/workbench_bridge.py::_handle_reinject_tools`** — item 10:
  the GA asset file read (path + schema noted in its docstring).
- **`runner/managed_runtime.py::install_managed_prompt_profile`** — the
  one backend write outside GaSession (`extra_sys_prompt`); shared with
  the Bridge-less `managed_im_supervisor` path.

GA *public* API usage (items 8, plus `next_llm` / `verbose` / `inc_out`
/ `put_task`) is deliberately not wrapped — verify against upstream
changelog, not a Galley file.

## Upgrade Triggers

Upgrade is event-driven, not calendar-driven.

- Before a Galley minor or patch release, normally audit and bump the baseline.
- If users report that a new GenericAgent behavior does not work in Galley,
  audit immediately.
- If upstream ships a critical stability or security fix, audit immediately.
- Do not upgrade just because time has passed.

## Upgrade Procedure

1. Lock the official upstream target SHA. Do not use floating `upstream/main`
   after this point:

```bash
git ls-remote https://github.com/lsdefine/GenericAgent.git refs/heads/main
```

2. Prepare a clean source checkout at the target SHA. Do not build managed GA
   from a dirty user checkout. A local temporary clone is fine:

```bash
git clone ~/Documents/GenericAgent /tmp/galley-ga-upgrade
git -C /tmp/galley-ga-upgrade checkout <target_sha>
git -C /tmp/galley-ga-upgrade status --short
```

3. Triage the delta shape BEFORE reading any diff. Raw commit counts
   mislead (the 2026-07-15 range was "362 commits" of which ~350 were an
   upstream frontend merge Galley never touches):

```bash
git -C /tmp/galley-ga-upgrade diff <current_baseline>..<target_sha> --stat
```

   Classify the touched files into: engine core / `frontends/` /
   `memory/`+`assets/` / packaging-CI. Then build the must-read set as
   the **union** of:

   - the fixed contract files: `agent_loop.py`, `ga.py`, `agentmain.py`,
     `llmcore.py`, `pyproject.toml`;
   - every file the managed patch stack touches
     (`grep '^diff --git' managed-ga/patches/*.patch`). A hard-coded
     file list rots — in the 2026-07-15 range the files that mattered
     most (`TMWebDriver.py`, `plugins/project_mode.py`, `memory/`
     renames) were all outside the old fixed five.

```bash
git -C /tmp/galley-ga-upgrade log <current_baseline>..<target_sha> --oneline
git -C /tmp/galley-ga-upgrade diff <current_baseline>..<target_sha> -- <must-read set>
```

   For each patch in the stack, read upstream's changes to that patch's
   target files specifically. This predicts, before any replay: patches
   upstream absorbed (delete them — the `code_run` stdin case), patches
   whose mechanism upstream replaced (rework them — the project-mode
   anchor case), and patches that will drift positionally (rebase them).

4. If an interface changed, prefer runtime feature detection over hard-binding
   to a single GenericAgent version. `inspect.signature` is the preferred
   pattern for Python callback signature drift.

5. Rebase the managed runtime only after the external audit is understood:

```bash
cd ~/Documents/genericagent-webui
# update managed-ga/manifest.json upstream.commit / upstream.auditedAt first
./scripts/build-managed-ga.sh /tmp/galley-ga-upgrade
node scripts/check-managed-ga-payload.mjs
```

Then inspect the managed patch stack semantically, not just mechanically:

- Did every patch apply?
- Did every patch land where it was supposed to? Zero-context hunks are
  purely positional and mis-drop **silently** on shifted files.
  `build-managed-ga.sh` runs a full `py_compile` sweep after replay as a
  hard gate (added after the 2026-07-15 upgrade caught two such
  mis-drops only via compilation) — do not bypass it.
- When the audit predicts more than trivial line drift, do not hand-fix
  hunks — regenerate the stack with the commit-chain rebase script
  (replay current stack as commits, byte-verify against the checked-in
  payload, rebase onto the new baseline, re-export as `-U0` patches;
  real conflicts stop for manual resolution):

```bash
./scripts/rebase-managed-ga-patches.sh <target_sha> /tmp/galley-ga-upgrade
```
- Did upstream add new writes to `memory/`, `sop/`, `skills/`, `temp/`, or
  `model_responses/` that bypass `GALLEY_GA_STATE_ROOT`?
- Did upstream add an official state-root/profile option that should replace a
  Galley patch?
- Did upstream rename a key that Galley's managed model config emits?

6. Run the compatibility matrix:

```bash
GA_PATH=/tmp/galley-ga-upgrade \
  .venv/bin/python -m pytest runner/tests/ -m 'not e2e'

# Optional when spending model quota is acceptable:
GA_PATH=/tmp/galley-ga-upgrade \
  BRIDGE_PYTHON=<python-with-ga-deps> \
  .venv/bin/python -m pytest runner/tests/ -m e2e
```

7. Audit bundled Python dependencies and run the bundled runtime smoke:

```bash
./scripts/bundle-python.sh mac-x64
./scripts/check-bundled-python-managed-ga.sh
```

If `[project.dependencies]` changed, update `scripts/bundle-python.sh` before
running the bundle script. `bundle-python.sh` already invokes the bundled
managed-GA smoke; run `check-bundled-python-managed-ga.sh` again when checking an
already-generated bundle without rebuilding it. The smoke must verify
`managed-ga/code`, not `~/Documents/GenericAgent`.

8. Start Galley dev mode and run a real multi-step task in both runtime modes
   when possible:

- External GA: streaming, thinking state, approvals, tool dispatch, LLM display.
- Managed GA: model config injection, streaming, tools, state under app data,
  restart / restore behavior.

9. Sync every surface that repeats the baseline commit, then run the
   drift gate (also enforced in CI):

- `gui/src/stores/defaults.ts`: `gaCommit`, `gaBaseline`, and
  `gaCommitDate` (from `git -C /tmp/galley-ga-upgrade log -1 --format=%cI <sha>`)
- `gui/src/lib/managed-runtime-diagnostics.test.ts` fixture commit/date
- `managed-ga/patches/manifest.md` "Last replay verified" header

```bash
node scripts/check-ga-baseline-drift.mjs
```

10. Update this document with the new hash, date, delta summary, and devlog
    link.

11. Write a devlog entry:

```text
docs/devlog/YYYY-MM-DD-ga-upstream-upgrade-<old>-to-<new>.md
```

    Origin discipline: any "upstream absorbed / adopted / converged with a
    Galley capability" claim must be backed by git archaeology first
    (`git log -S '<code>' --format='%h %an %ad %s'` in the upstream
    checkout) and the devlog must name the source commit/PR. The
    2026-07-15 upgrade initially recorded the `_ga_project_mode_name`
    seam's direction of adoption backwards; two minutes of `log -S`
    corrected it.

12. Keep the upstream upgrade as an independent commit when possible. If the
    upgrade forces a Galley adapter or packaging guard, include that adapter in
    the same branch and document the product impact.

## Bundled Python Dependency Audit

Galley releases bundle CPython plus the GenericAgent core runtime dependencies.
Every baseline upgrade must check GenericAgent `pyproject.toml`:

- If `[project.dependencies]` changes, update `scripts/bundle-python.sh`.
- Rebuild bundled Python for release targets.
- Run `scripts/check-bundled-python-managed-ga.sh` against the generated
  bundle. Managed GA must not depend on the maintainer's `.venv` or external
  `~/Documents/GenericAgent` checkout.
- `optional-dependencies` for GenericAgent UI/frontends are not automatically in
  Galley scope. Galley only bundles frontend deps when a managed product
  surface owns that frontend.

Current bundled GenericAgent core deps:

- `requests`
- `beautifulsoup4`
- `bottle`
- `simple-websocket-server`
- `aiohttp`
- `qrcode[pil]` (managed WeChat IM Supervisor)
- `pycryptodome` (managed WeChat IM Supervisor)
- `python-dotenv` (common external-GA `mykey.py` compatibility)

Runtime packaging details live in [desktop runtime](./desktop-runtime.md).

## Things Galley Does Not Do

- Galley does not automatically upgrade a user's GenericAgent checkout.
- Galley does not prompt users to pull GenericAgent just because upstream moved.
- Galley does not policy-manage GenericAgent's release cadence.
- The Settings GA Version state is informational: aligned / user has upgraded /
  user has older checkout.
