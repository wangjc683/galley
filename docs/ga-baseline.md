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

Locked commit: `502be0a76d04e6d7063c28b3bbb77adb1047ba6b`

- Source: `lsdefine/GenericAgent` upstream `main`
- Date audited: 2026-07-10
- Previous baseline: `b1e173dcbb3cf1a0c7fdeab4211a12a44461c841`
- Delta: 10 commits
- Note: "current baseline" = latest **audited** commit. What a released
  build actually **ships** can lag one release behind — see
  [project status](./project-status.md) for the shipped baseline.
- Result: no external bridge protocol or dependency break; `pyproject.toml`
  did not change. Managed runtime picked up upstream Claude-refusal handling,
  `ChunkedEncodingError` retry, suppressed intermittent retry-error yields, the
  additive `--no-user-tools` flag, opt-in `extra_sys_prompt` / `omit_thinking`
  session config, an UltraPlan orchestration refactor, and TUI worldline /
  session-control work. Two managed patches were rebased: `0001` adopts
  upstream's new `GA_ULTRAPLAN_RUNDIR` env seam (falling back to
  `GALLEY_GA_STATE_ROOT`), and `0007`'s Codex helper block was regenerated for
  the shifted `llmcore.py` line numbers (also fixing a latent off-by-one in the
  insertion hunk's line count). Galley's managed state-root routing, Codex
  backend payload shape, and managed image attachment path are preserved.
- Devlog: [GA upstream upgrade b1e173dc -> 502be0a](./devlog/2026-07-10-ga-upstream-upgrade-b1e173dc-to-502be0a.md)

Relevant compatibility notes:

- `agent_loop.py`: whitespace-only tweaks to the yielded turn / tool-call
  markers. `BaseHandler.dispatch`, hook calls (`turn_before` / `llm_before`),
  and the structured `{'turn': turn}` yield are unchanged; the runner reads the
  turn number from the `turn_before` hook context, not the text markers, so
  `WorkbenchHandler` is unaffected.
- `agentmain.py`: upstream added an additive `--no-user-tools` flag that filters
  `ask_user` / `start_long_term_update` from the tool schema. Galley does not
  pass it, so behavior is unchanged; managed image attachment injection and
  state-root temp routing remain intact.
- `llmcore.py`: upstream added Claude `stop_reason == "refusal"` handling (no
  retry), `ChunkedEncodingError` in the retry set, suppression of the
  intermittent retry-error yield, and two opt-in config keys —
  `extra_sys_prompt` / `extra_sys_prompt_file` and `omit_thinking`. Default
  `omit_thinking=False` keeps `llmclient.backend.history` shape identical; the
  raw-repr / prompt-log formatting changes are logging-only. Galley's Codex
  patch (`0007`) was regenerated so credential IPC, `ChatGPT-Account-ID`,
  `store=false`, WHAM quota hints, and forced streaming coexist with the new
  code.
- `assets/ga_ultraplan.py` and `memory/ultraplan_sop.md`: upstream refactored
  UltraPlan orchestration and introduced a `GA_ULTRAPLAN_RUNDIR` env override
  for the run directory. Galley's `0001` patch now honors that env var first and
  falls back to `GALLEY_GA_STATE_ROOT/temp` (never the read-only code payload),
  replacing the previous multi-line `_CODE_ROOT` / `_STATE_ROOT` scaffolding.
- `mykey_template.py` / `mykey_template_en.py`: upstream simplified the vendor
  tables and dropped non-native / antigravity configs. Managed mode generates
  its own model config, and external / attach GA owns its own `mykey.py`, so
  neither path is affected.
- `assets/*` and TUI worldline / session-control changes (`frontends/`,
  `hub.pyw`, background `ljqCtrl` tool, GUI SOP guardrails): bundled as upstream
  code or state seed with no Galley contract change. Galley does not use the
  upstream TUI as its authoritative GUI / Core path.
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

3. Review the external / attach integration surface:

```bash
git -C /tmp/galley-ga-upgrade log <current_baseline>..<target_sha> --oneline
git -C /tmp/galley-ga-upgrade diff <current_baseline>..<target_sha> -- \
  agent_loop.py ga.py agentmain.py llmcore.py pyproject.toml
```

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

9. Update this document with the new hash, date, delta summary, and devlog link.

10. Write a devlog entry:

```text
docs/devlog/YYYY-MM-DD-ga-upstream-upgrade-<old>-to-<new>.md
```

11. Keep the upstream upgrade as an independent commit when possible. If the
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
