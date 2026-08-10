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

Locked commit: `308153b1c91401a892401dd896e548e587506cc9`

- Tree hash: `6533522b7858869ef93590521466cf3ffdf4aeb7`
- Source: `lsdefine/GenericAgent` upstream `main`
- Date audited: 2026-08-10
- Shipped in: not yet shipped — latest release still carries `d8d90ee`
- Note: "current baseline" = latest **audited** commit. What a released
  build actually **ships** can lag one release behind — see
  [project status](./project-status.md) for the shipped baseline.
- Previous baseline: `d8d90eef8c37cb1ea9aae078a3d099a7d7a759df`
  (tree `d457b6e8b02c7895504c888da5e7ee064fb43f1a`)
- Delta (`d8d90ee..308153b` = 15 commits): 20 files, ~1661 insertions /
  ~305 deletions. Roughly 90% of the diff is upstream's own frontends and is
  inert on Galley's path: the new P2P stack (`frontends/p2p_ws_client.py`
  +1045, `hub_p2p.py` +103), hub iteration (`hub.py` +103, `hub.html`),
  `stapp.py` (297), `desktop_pet_v2.pyw`, the community desktop app
  (`frontends/desktop/**`), and the TUI trio. Engine-core delta is only
  `llmcore.py` (28), `ga.py` (12), `agentmain.py` (+7), and
  `assets/tools_schema.json` (2).
- Result: no bridge protocol or dependency break; `pyproject.toml` did not
  change at all, and `agent_loop.py` had zero diff. Patch-stack rebase had
  one real conflict (`0007` `llmcore.py`: upstream raised the
  `BaseSession.__init__` context defaults on the same line the codex
  credential block is inserted before — resolved by keeping the codex lines
  and adopting upstream's new defaults, since `0007` has no stake in
  `context_win`).
- Devlog: [GA upstream upgrade d8d90ee -> 308153b](./devlog/2026-08-10-ga-upstream-upgrade-d8d90ee-to-308153b.md)

New in the `d8d90ee` -> `308153b` range:

- `llmcore.py` — **rate-limit errors now raise `requests.ConnectionError`**
  from `_parse_claude_sse`'s `error` branch when the SSE error message matches
  `concurrency|retry later|overloaded|rate.?limit`, routing them into
  `_stream_with_retry`'s network retry instead of surfacing as an application
  -layer `!!!Error:` string. Lands two lines above patch `0017`'s
  `message_delta` hunk; no semantic interaction, but it is why the zero-context
  hunks had to be re-derived rather than hand-shifted.
- `llmcore.py` — retry backoff slowed: `_stream_with_retry`'s `_delay` base
  factor `1.5 → 3.0`, and `MixinSession._base_delay` default `1.5 → 3.0`.
  Longer waits between retries on a flaky provider.
- `llmcore.py` — context defaults raised: `default_context_win` `30000 →
  35000`, `default_cut_msg_interval` `5 → 7` (deepseek `70000 → 80000`), and
  `trim_messages_history`'s `cut_msg_interval` fallback `5 → 7`. This is the
  line `0007` conflicted on.

  **Trimming does not change for Galley, and the real effect runs the other
  way.** The trim budget is `cap = sess.context_win * 3`, and Galley sets
  `context_win` explicitly (`MANAGED_MODEL_DEFAULT_CONTEXT_WIN = 90_000`), so
  the cap stays 270000 chars regardless of what upstream's default is. What
  moves is `maxlen_multiplier`, which takes `default_context_win` as its
  **denominator**: `90000/30000*0.75 = 2.25` → `90000/35000*0.75 = 1.93`, a
  14% drop. Its two consumers:

  - **Tool output limits shrink ~14%.** Via `agentmain.get_ctx_multiplier()`
    → `ga.py::_get_tool_maxlen`: `code_run` 22500 → 19285, `file_read` 33750
    → 28928, `web_execute_js` 18000 → 15428, `web_scan` (growth_rate 0.5)
    56875 → 51250 — all before the `/_tool_num` divisor. **This is the one
    observable change; dogfood should watch for tool results hitting
    `...[Truncated]...` sooner, not for trimming behavior.**
  - `cut_msg_interval` `int(5*2.25)=11` → `int(7*1.929)=13`, so history tag
    compression runs slightly less often.

  Note the inversion: upstream raised the default to be more generous, but
  for any downstream that sets a LARGER explicit `context_win`, that constant
  is a denominator, so raising it tightens rather than loosens. deepseek is
  unaffected (both sides clamp to 1.0).
- `llmcore.py` — `_record_usage` gained an `_i()` null-coercion helper
  (`None → 0`) for every usage field across all three API modes. From
  `a1e470b` ("llmcore: null-safe usage"), fixing a `TypeError` when a provider
  sends explicit `null`. **Does not supersede patch `0017`**: `_i` is type
  safety on values that arrive, while `0017` covers the compat-provider case
  where the input side never arrives at `message_start` at all. Verified by
  reading `a1e470b`; `0017` stays.
- `agentmain.py` — `hub.connect()` wired into the `--reflect` branch, so a
  reflect script becomes an addressable hub peer accepting `put_task`. **Inert
  on Galley's path and structurally unreachable**: the call sits inside
  `if __name__ == '__main__':`, and Galley imports `agentmain` as a module
  (`runner/workbench_bridge.py:638`) rather than executing it. Worth a guard at
  the next upgrade — see the hub note below.
- `ga.py` — prompt-tag renames only: `[System]` → `[ERROR]` on the three
  `_retry_or_exit` strings, `[SYSTEM]` → `[TIPS]` on the summary reminder, and
  the turn-13 / turn-31 checkpoint nudges → `[DANGER]`. Galley greps none of
  these strings (verified); pure prompt tuning.
- `assets/tools_schema.json` — `code_run`'s `script` description simplified to
  `"script"`. Inert: Galley reads `assets/tool_usable_history.json`, not this
  file.
- `memory/memory_management_sop.md` — L3 guidance now says not to store
  project-specific facts. Regenerated into the state seed, missing-only, so
  existing user memory is untouched.
- `frontends/hub.py` + new `hub_p2p.py` / `p2p_ws_client.py` — upstream's WS
  peer hub grew a **P2P phone-pairing sidecar**: bus/panel ports split with a
  token-authed panel, a 9-digit 2-minute pairing code exchanged for a durable
  room UUID, and the panel's `/api/` prefix exported to a phone over WebRTC
  (falling back to an encrypted relay at a hard-coded third-party signal
  server). Plus incremental polling (`since=` skeleton delta, `nt` rewind
  marker, `seg ?off` tail fetch, `psig` peer-list delta) to cut relay traffic.
  All inert on Galley's path — TCP/HTTP/outbound tunnels are outside Rule 2 —
  but this is now a standing product-direction signal, not a curiosity: hub is
  a federated peer bus with `put`/`abort` on any attached agent, which would
  bypass Core's audit and confirmation gates if a Galley session ever attached
  to it. The isolation today is structural but incidental; a `grep -rn
  "hub.connect" managed-ga/code/` guard at each upgrade is the cheap defense.

Carried forward from the `4086d5c` -> `d8d90ee` range (2026-08-03):

- Previous-previous baseline: `4086d5c858b90e10eb24a106ea3c41ac729bc00e`
  (tree `3ce40434f799347e2ba6a9d07616bc29739a8162`)
- Delta (20 commits): 20 files, ~971 insertions / ~137 deletions. Two thirds
  upstream frontends (`stapp.py` +299, the brand-new `frontends/hub.py` +
  `hub.html` WS peer hub, `conductor.*`, `desktop/static/app.js`,
  `wechatapp.py`, `model_cmd.py`) plus WeChat QR asset churn — all inert.
  Engine-core delta was `llmcore.py` (+78), `agentmain.py`, `ga.py`,
  `agent_loop.py`.
- Result: no bridge protocol or dependency break. Patch-stack rebase had one
  real conflict (`0007` `llmcore.py`: upstream's `retry-after` cap rewrote the
  same `_stream_with_retry` `err =` line as the codex 429 quota enrichment —
  both kept, enrichment first so it mutates `body` before upstream's format
  consumes it).
- Devlog: [GA upstream upgrade 4086d5c -> d8d90ee](./devlog/2026-08-03-ga-upstream-upgrade-4086d5c-to-d8d90ee.md)

Detail for that range:

- `llmcore.py` — abort responsiveness: `_stream_with_retry` stores the live
  response on `sess.active_response` and skips retrying when
  `sess.should_stop()` is set, so a user stop actually tears the stream down
  instead of letting it run to completion. Pairs with the `agentmain.abort()`
  change below.
- `llmcore.py` — `retry-after` capped by a new `max_retry_after` session
  option (default 60s); an oversized server `Retry-After` used to hang the
  session. This is the line `0007` conflicted on.
- `llmcore.py` — Responses API robustness: `response.incomplete` and
  `response.failed` are now handled as valid terminal events (that stream
  never sends `[DONE]`, which previously triggered an empty-response retry
  storm), and `reasoning_text` is captured into a thinking block.
- `llmcore.py` — **`thinking_delta` now yields into the output stream**
  (`_parse_claude_sse`), emitting *untagged* reasoning text. This was a
  coupling break, **default-on for managed Anthropic models**, closed in this
  same upgrade by patch `0016-managed-native-thinking-tags.patch` (accumulate
  the block, emit it once wrapped in `<thinking>` at `content_block_stop`). See
  [the devlog](./devlog/2026-08-03-ga-upstream-upgrade-4086d5c-to-d8d90ee.md)
  for the full chain. Short version: the `<thinking>` tags Galley strips are a
  *prompted convention* (GA's system prompt at `llmcore.py:894` asks the model
  to wrap its reasoning in them, and it arrives as ordinary `text_delta`),
  which is a different channel from the Anthropic API's native thinking blocks
  that arrive as `thinking_delta`. Galley's
  `core/src/commands/managed_model.rs` ships `"thinking_type": "adaptive"` as
  the Anthropic-protocol default; GA's `_apply_claude_thinking` sends any
  non-`enabled` value straight through, so thinking is requested on every
  managed Anthropic session. The resulting untagged deltas defeat
  `runner/workbench_bridge.py`'s `_TAG_PATS` strip and render as normal
  assistant text, breaking the "GA-raw, with tags" contract documented on
  `TurnProgressEvent` in `runner/ipc.py`. `omit_thinking` is not a mitigation
  (it only controls history inclusion, not the stream).
- `llmcore.py` — `_fix_messages` no longer inserts a `{"type":"text","text":"\n"}`
  separator when merging same-role messages, and now drops empty text blocks
  (substituting `"."` when a message would end up empty) to avoid HTTP 400.
  Relevant to Galley's history injection on restore.
- `llmcore.py` — new module-level `STATS` dict feeding upstream `stapp`
  runtime stats; additive, unused by Galley. `reasoning_effort: 'max'` now
  maps to Claude `output_config.effort` alongside `xhigh`.
- `agentmain.py` — `abort()` reaches into `llmclient.backend._sessions` to set
  `should_stop` and close the live response. Guarded by
  `if not self.is_running: return`, so patch `0001`'s `llmclient = None`
  initial state is not reachable here. New `all_outputs` accumulator (input +
  outputs per turn, capped 10000 → trimmed to 5000) and `_current_queue` let a
  refreshed upstream UI re-attach to a live task; both are memory growth in
  Galley's long-lived per-session child processes.
- `ga.py` — `code_run` refuses `timeout > 600` with a message telling the model
  to background long work; `file_patch` error strings changed from Chinese to
  English.
- `agent_loop.py` — the `proxy()` generator wrapper around the first dispatch
  chunk is gone; in verbose mode that chunk is now concatenated onto the
  opening fence marker. Content-equivalent, but a stream chunk-boundary change.
  (First change to this file since the `5257dec` baseline.)
- `frontends/hub.py` + `hub.html` (new) — upstream WS peer hub: multiple
  frontends attach to one agent with a shared composer, busy-reject and abort;
  `stapp` adopts hub tasks as real bubbles. Inert on Galley's path (WS/TCP is
  outside Rule 2) but a product-direction signal worth tracking.

Carried forward from the `8a75b39` -> `4086d5c` range (2026-07-23):

- Baseline before that: `1d3c1a09dfdaa76ba5dee82725fa599df7c16be4` — **no longer
  reachable on upstream `main`**: upstream force-pushed a rewritten history
  (commit messages anglicized to conventional commits; code content
  untouched). The old baseline's tree is byte-identical to new-history
  `8a75b39` (tree `3817cec4be64604501cd97dc5798b295db050cad`), which is the
  equivalence anchor this delta was computed against. The pre-rewrite objects
  survive only in clones that fetched them (e.g. the maintainer's
  `~/Documents/GenericAgent`).
- Delta (content, `8a75b39..4086d5c` = 5 new commits): 11 files,
  ~109 insertions / ~64 deletions. Engine-core delta is LLM-session reload
  robustness in `agentmain.py` (sticky `llm_no` by backend name, empty/BADMIXIN
  guards, display-name format change, CN tool-schema switch removed),
  `reload_mykeys` thread lock + `resolve_session` `_mykey_name` stamp in
  `llmcore.py`, and working-memory tool tightening in `ga.py` +
  `assets/tools_schema.json` (`related_sop` param removed,
  `start_long_term_update` refused before turn 10). The rest is upstream
  frontends (`stapp.py`, `conductor.*`, `desktop/`) and `ga_install.ps1`,
  all inert on Galley's path, plus a one-line `tmwebdriver_sop.md` login-flow
  edit.
- Result: no bridge protocol or dependency break; `agent_loop.py` and
  `pyproject.toml` did not change at all. One real compat point:
  `get_llm_name()` dropped the `Session` suffix from the class segment
  (`NativeClaudeSession/x` → `NativeClaude/x`), which broke
  `_initial_llm_index`'s exact-match restore of persisted LLM names —
  Galley now normalizes both sides (strip `Session`) so names persisted by
  either GA generation keep resolving in both managed and attach modes.
  Patch-stack rebase had one real conflict (`0001` `agentmain.py`: upstream's
  `self.llmclient = None` on the patched `log_path` line — both kept).
- Devlog: [GA upstream upgrade 1d3c1a09 -> 4086d5c](./devlog/2026-07-23-ga-upstream-upgrade-1d3c1a09-to-4086d5c.md)

Detail for that range:

- `agentmain.py`: `load_llm_sessions` keeps the previously selected backend
  across mykey reloads by re-matching `backend.name` (sticky `llm_no`),
  guards empty `llmclients`, and renders bad mixin configs as `BADMIXIN_i`
  placeholders instead of crashing. `next_llm` no longer switches to a CN
  tool schema for glm/minimax/kimi. `get_llm_name` display format lost the
  `Session` suffix (see compat point above).
- `llmcore.py`: `reload_mykeys` is now thread-locked and uses
  `sys.modules.pop` instead of `importlib.reload`; `resolve_session` stamps
  `cfg['_mykey_name']` (additive). History shape and
  `NativeClaudeSession.ask()` untouched.
- `ga.py` + `assets/tools_schema.json`: working-memory tool guidance
  tightened — `update_working_checkpoint` lost its `related_sop` parameter,
  `start_long_term_update` refuses before turn 10, first-turn checkpoint
  calls get a "don't call again" tip. Behavior tuning at the handler level;
  dispatch signature unchanged.
- `memory/tmwebdriver_sop.md`: autofill login flow now prefers a direct CDP
  click on the login button (ignoring `disabled`), with the old
  field-release sequence as fallback. The extension itself
  (`assets/tmwd_cdp_bridge/`) did not change in this range.
- `frontends/stapp.py` / `conductor.*` / `desktop/`, `assets/ga_install.ps1`:
  portal/desktop UX and mainland-China no-Git install — all inert on
  Galley's path.

Baseline history note (2026-07-23): upstream rewrote `main` history once
(force push). If a recorded SHA stops resolving, diff by tree equivalence
from a clone that still has the old objects, and record the new-history
anchor here. `git log -S` archaeology against pre-rewrite history must also
use such a clone.

Carried forward from the `5257dec` -> `1d3c1a09` range (2026-07-22, audited
against pre-rewrite SHAs; equivalent new-history tip `8a75b39`):

- Previous-previous baseline: `5257decc8c7ac2484278c977b91d15cb09990fef`
- Delta: 8 commits, 18 files, ~90 insertions / ~63 deletions. Engine-core
  delta is two one-line changes (`agentmain.py` temp-file naming,
  `llmcore.py` trim factor) plus the legacy CDP DOM bridge removal; the rest
  is `memory/` + insight templates (plan-mode deprecation), the tmwebdriver
  extension, and upstream frontends (`conductor.py`, `stapp.py`,
  `frontends/desktop*`) that are inert on Galley's path.
- Result: no external bridge protocol or dependency break; `agent_loop.py`,
  `ga.py`, and `pyproject.toml` did not change at all. Headline change is
  **upstream formally deprecating plan mode** (`plan_sop.md` gains a
  deprecation banner: do not enter plan mode, file will be deleted; replacement
  routing is ultraplan / project_mode / direct execution) — Galley removed its
  plan-mode visibility chain in the same change set. Managed runtime also
  picked up: unique long-prompt temp filenames under concurrency
  (`pid`+`nanos` — directly relevant to Galley's multi-session use),
  tmwebdriver HTTP-origin guard + legacy DOM bridge removal, a more
  aggressive context-trim factor (`maxlen_multiplier` 0.85 → 0.75), and
  `project_mode_sop` indexed in the L1 templates. Patch-stack rebase had two
  real conflicts (`0001` temp-file line, `0003` dead `cdp_cfg` hunk) and
  repaired one pre-existing drift (`0015` regenerated from the shipped
  payload; see `managed-ga/patches/manifest.md`).
- Devlog: [GA upstream upgrade 5257dec -> 1d3c1a09](./devlog/2026-07-22-ga-upstream-upgrade-5257dec-to-1d3c1a09.md)

New in the `5257dec` -> `1d3c1a09` range:

- `memory/plan_sop.md` + insight templates: plan mode formally deprecated.
  The SOP text now forbids entering plan mode and routes to `ultraplan_sop`
  (explicit user opt-in only) / `project_mode_sop` / direct execution;
  `project_mode_sop` joined the L1 template index. The `ga.py` plan-mode
  machinery (`enter_plan_mode`, `in_plan_mode` stash, 📌 step injection,
  `frontends/plan_state.py`) is still present upstream but has lost its only
  trigger source for newly seeded state. Galley's plan-visibility chain
  (`plan_watch.py` → `plan_update` IPC → PlanContextBar) was removed with
  this upgrade; no Galley code couples to plan state anymore, so upstream
  deleting the machinery later requires no Galley action. Existing seeded
  user state keeps the old SOP (missing-only seed copy) — residual triggers
  are possible but rare, and now simply render as ordinary turns.
- `agentmain.py`: long-prompt temp filename is now
  `user_prompt_{pid}_{time_ns}.md` (concurrency-safe); the legacy CDP config
  seeding block is gone. `0001` combines the new naming with the managed
  state root; `0003` dropped its dead `cdp_cfg` hunk.
- `llmcore.py`: `maxlen_multiplier` factor 0.85 → 0.75 — context trimming
  kicks in earlier. Not a contract change (history shape untouched), but
  long-session behavior may be observably different; watch during dogfood.
- `TMWebDriver.py` + `assets/tmwd_cdp_bridge/`: local bottle server now
  rejects requests carrying an `Origin` header (blocks web-page CSRF against
  the localhost driver), and the legacy in-page DOM bridge
  (MutationObserver + `config.js`) is fully removed — CDP is the only path.
  `0006`/`0015` rebased over it (both deletions kept in `content.js`).
- `frontends/conductor.py` / `stapp.py` / `frontends/desktop*`: conductor now
  notifies on user chat messages; stapp/desktop UX tweaks. All inert on
  Galley's path (Galley does not bridge these frontends).

Carried forward from earlier ranges (unchanged this range, still describes
the current surface — `ga.py` items below were last touched in `1e89c3e` ->
`5257dec`):

- `agent_loop.py`: still zero diff — dispatch protocol, hooks, and the
  structured `{'turn': turn}` yield are byte-identical.
- `ga.py`: `GenericAgentHandler`'s blank-response check in `do_no_tool` stays
  the permissive form (`not content.strip() and not thinking.strip()`); the
  incomplete-response check catches `content.endswith('</summary>')`. Internal
  to the handler's response handling, not the dispatch signature or Galley's
  approval gate. Init signature and import path unchanged.
- `llmcore.py`: `NativeClaudeSession.ask()` carries the three Anthropic beta
  headers (`thinking-token-count-2026-05-13`, `mid-conversation-system-2026-04-07`,
  `fallback-credit-2026-06-01`); method signature and history block shape
  unchanged, so `runner/ga_session.py::_VALIDATED_HISTORY_BACKENDS` still holds.
- `assets/sys_prompt.txt`: the four execution principles from `5257dec`
  (action-as-cognition, autonomous-closure, completion-in-reality,
  deliver-on-block) are unchanged.

- `ga.py`: upstream sets `stdin=subprocess.DEVNULL` in `code_run` (Galley's
  `0005` patch verbatim → removed). `file_write` / `file_patch` preserve the
  target file's existing newline style. Tool handlers use `_arg` type coercion
  and scale output limits via the additive `GenericAgent.get_ctx_multiplier()`.
- `llmcore.py`: `BaseSession` has `trim_keep_prefix` (default 0, off) and a
  `maxlen_multiplier` derived from `context_win`. `MixinSession` is a routed
  facade: `history` is facade-owned state (still plain get/set — GaSession
  semantics preserved; the class stays outside the validated restore set), but
  its `__setattr__` **raises** on node-specific attributes. Galley's managed
  model config never emits mixin configs, so `install_managed_prompt_profile`'s
  `extra_sys_prompt` write is unaffected; revisit if managed mode ever grows
  channel-group models.
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
- If upstream rewrites published history so the recorded baseline SHA is no
  longer reachable on `main` (observed 2026-07-23), re-anchor promptly while
  a clone with the pre-rewrite objects still exists: prove code identity via
  tree hashes, then bump to a commit on the new history.
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

9. Sync the baseline metadata. `managed-ga/manifest.json`'s `upstream`
   block is the single source of truth — update all four fields there:
   `commit`, `commitDate`
   (`git -C /tmp/galley-ga-upgrade log -1 --format=%cI <sha>`), `treeHash`
   (`git rev-parse '<sha>^{tree}'`), and `auditedAt`. Then regenerate the
   GUI constants and run the drift gate (also enforced in CI):

```bash
node scripts/check-ga-baseline-drift.mjs --write   # regenerates gui/src/lib/ga-baseline.gen.ts
node scripts/check-ga-baseline-drift.mjs           # verifies the doc surfaces below
```

   Hand-edited prose the gate still checks: this document's "Current
   Baseline" block (locked commit, tree hash, audited date),
   `managed-ga/patches/manifest.md`'s "Last replay verified" header, and
   the shipped-baseline short SHA in `docs/project-status.md`.
   (`defaults.ts` and the diagnostics test fixture are no longer sync
   surfaces: the GUI imports the generated constants, and the fixture
   uses synthetic values on purpose.)

10. Update this document with the new hash, tree hash
    (`git rev-parse '<sha>^{tree}'` — the durable anchor if upstream ever
    rewrites history again), date, delta summary, and devlog link.

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
