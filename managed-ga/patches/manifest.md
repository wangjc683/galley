# Managed GA Patch Stack

Patch stack id: `galley-managed-ga-patches-v1`

Last replay verified: `2026-09-30` against upstream
`1b6442fe4f97d87a3d9d52d76569f69d156af853` (25-patch stack, through `0026`;
same baseline, for the `0023` / `0024` re-export that quiets the run status
message, with `0026` re-exported on top of the new `0023`): the committed
25-patch stack was first rebuilt from a fresh clone and matched the
committed payload, then `build-managed-ga.sh` applied all 25 clean, its
`py_compile` sweep passed, the rebuilt `frontends/dcapp.py`,
`frontends/tgapp.py` and `frontends/galley_im_display.py` matched the
authored versions (the committed payload with only the two status-message
edits) byte-for-byte, and no other payload file changed. The `0026`
re-export changes hunk headers only: its 26 hunks below `_status_content`
move up two lines on both sides, bodies unchanged. The old `0026` replayed
on the new `0023` still exited 0 but put its pure-add hunks two lines off,
which only the `py_compile` sweep caught.

Previous replay (`2026-09-30`, same baseline, 25-patch stack through
`0026`, for the new `0026`): the committed 24-patch stack was first rebuilt
from a fresh clone and matched the committed payload, then
`build-managed-ga.sh` applied all 25 clean, its `py_compile` sweep passed,
the rebuilt `frontends/dcapp.py` matched the authored version
byte-for-byte, and no other payload file changed.

Previous replay (`2026-09-30`, same baseline, 24-patch stack through
`0025`, for the `0023` re-export that drops the status message's stop
button): the committed 24-patch stack was first rebuilt from a fresh clone
and matched the committed payload, then `build-managed-ga.sh` applied all 24
clean with the re-exported `0023`, its `py_compile` sweep passed, the
rebuilt `frontends/dcapp.py` matched the authored version byte-for-byte, and
no other payload file changed.

Previous replay (`2026-09-30`, same baseline, 24-patch stack through `0025`,
for the new `0025`): the committed 23-patch stack was first rebuilt from a
fresh clone and matched the committed payload, then `build-managed-ga.sh`
applied all 24 clean, its `py_compile` sweep passed, and the whole rebuilt
`managed-ga/code` matched the authored payload file-for-file by hash.

Previous replay (`2026-09-30`, same baseline, 23-patch stack through `0024`,
for the `0024` re-export after the first Telegram dogfood round): the
committed stack rebuilt from a fresh clone matched the committed payload,
all 23 applied clean with the re-exported `0024`, the `py_compile` sweep
passed, and the rebuilt `frontends/tgapp.py` and
`frontends/galley_im_display.py` matched the authored versions
byte-for-byte.

Previous replay (`2026-09-30`, same baseline, 23-patch stack through
`0024`, for the new `0024`): the 22-patch stack rebuilt from a fresh clone
matched the committed payload, all 23 applied clean, the `py_compile` sweep
passed, and the rebuilt `frontends/tgapp.py` and new
`frontends/galley_im_display.py` matched the authored versions
byte-for-byte.

Previous replay (`2026-09-30`, same baseline, 22-patch stack through `0023`,
for the new `0023`): the 21-patch stack rebuilt from a fresh clone matched
the committed payload, all 22 applied clean, the `py_compile` sweep passed,
and the rebuilt `frontends/dcapp.py` matched the authored version
byte-for-byte.

Previous replay (`2026-09-23`) against upstream
`1b6442fe4f97d87a3d9d52d76569f69d156af853` (21-patch stack, through `0022`;
same baseline, re-run after the `0016` rewrite: `build-managed-ga.sh`
applied all 21 clean from a fresh clone, its `py_compile` sweep passed, and
the rebuilt payload matched the committed `managed-ga/code` byte-for-byte).
`0016` was regenerated in a commit-chain replay (old chain byte-verified
against the payload first, new `0016` committed on `0015`, `0017`-`0022`
cherry-picked clean). `0017` and `0021` re-exported with header-only drift
(`@@` line numbers, identical bodies). That re-export is required, not
cosmetic: `0017`'s zero-context pure insertions, applied at their old line
numbers, land inside `0016`'s new helper comment without `git apply`
complaining.

Previous replay (`2026-09-18`, `1b6442f`, 21 patches through `0022`):
The `efb3bc6` -> `1b6442f` commit-chain rebase had **two trivial
conflicts**, both an upstream one-line edit adjacent to a Galley insertion:
`0006` / `ga.py` (upstream `str(switch_tab_id)` on the line right below
`browser_control_empty_msg()`) and `0007` / `llmcore.py` (upstream
`default_context_win 35000 → 38000` on the line right below the codex /
credential-IPC fields). Both resolved by keeping Galley's lines and
upstream's new line — no semantic change to either patch. Eight more
patches (`0001`, `0002`, `0003`, `0008`, `0016`, `0017`, `0021`, `0022`)
re-exported with positional drift and identical bodies (verified with
`git diff managed-ga/patches | grep -v '^[-+]@@'` showing no body lines).

Previous replay (`2026-08-31`, `efb3bc6`, 19 patches through `0020`; `0021`
and `0022` later verified against the same baseline):
The `30b24ad` -> `efb3bc6` commit-chain rebase had **one real conflict**:
`0017` / `frontends/cost_tracker.py` — upstream's new per-call token ledger
(`token_ledger.jsonl`, for its own Desktop 2.0 bridge) rewrote the exact
`record_patched` lines `0017` guards. Resolved by composing both sides:
upstream's `_append_ledger` calls are kept (inert on Galley's path —
`init_ledger` is only called by upstream's desktop bridge, so the ledger fd
stays `None` and appends no-op), and Galley's messages-mode guards
(`requests` counted only on the usage-carrying call; zeroed placeholder must
not clobber `last_input`) sit after them, with upstream's new
`inp = cc = cr = 0` init retained. Six more patches (`0001`, `0002`, `0004`,
`0007`, `0008`, `0016`) re-exported with positional drift and identical
bodies — `0007`'s `_stream_with_retry` insertions three-way-merged cleanly
past upstream's interruptible-backoff rewrite. `build-managed-ga.sh` then
applied all 19 clean from a fresh clone at the new baseline, its
`py_compile` sweep passed, and `check-managed-ga-payload.mjs` matched the
committed `managed-ga/code` byte-for-byte.

(From the 2026-08-21 `30b24ad` upgrade: the `f06d550` -> `30b24ad`
commit-chain rebase finished with **zero conflicts** — the first clean one
since the stack reached 19 patches. Three patches (`0001`, `0002`, `0008`)
re-exported with new line numbers and identical bodies, all shifted by the
same +3 lines upstream added above their `llmcore.py` hunks.)

(From the 2026-08-14 `f06d550` upgrade: commit-chain rebase with two real
conflicts, both in the browser extension and both from the same upstream
commit `e519734`, which touches the exact lines `0006` and `0015` own.
`0006` / `background.js`, four sites: three are pure additive collisions
where upstream's new `status` command, `setStatus()` broadcast, and
`setStatus('connected')` landed on `0006`'s insertion points — both sides
kept. The fourth is semantic and forced: upstream added
`setStatus('disconnected')` to the `else` branch of an `isServerAlive()`
gate that **`0006` deletes**, so keeping upstream's side would call a
function that no longer exists in the patched tree. Resolved to `0006`'s
unconditional `connectWS()` with a comment recording why upstream's gate
cannot come back. Consequence: `disconnected` is unreachable in the managed
extension, which costs nothing because `0015` removes the only consumer.
`0015` / `content.js`: upstream rewrote the in-page badge block that `0015`
deletes wholesale — resolved to the deletion, i.e. status quo. `0015` /
`background.js`: `setStatus('connected')` vs `updateActionIcon(true)`, both
kept. Net: upstream's `status` / `setStatus` machinery survives in the
managed payload as dead code — deliberately, since deleting it would grow
the patch for no behavioral gain. The other 16 patches replayed clean;
`0016` / `0017`'s zero-context `_parse_claude_sse` hunks drifted purely
positionally past upstream's new `_raise_if_retryable_overload` helper and
were carried by the rebase, which is exactly why the hunks are not
hand-fixed.)

(`0020` landed `2026-08-18` against the same baseline, initially verified as a
top-of-stack `git apply --unidiff-zero` plus `py_compile`; the full fresh-clone
replay above ran the same day for the `v0.4.9` pre-flight, so unlike
`0018`/`0019` it carried no unreplayed debt into its release.)

(This replay retired the `v0.4.7` release debt: `0018` and `0019` both landed on
`2026-08-13` against the same baseline and had only been verified in isolation
until this run — `0018` against the checked-in pre-patch `frontends/dcapp.py`,
while `0019` had none, and it is the riskier of the two to leave unreplayed
because it edits `frontends/fsapp.py`, a file `0009` / `0011` / `0012` / `0013`
already patch. Note the numbering gap: `0005` is retired, so 18 patches run
through `0019`.)
(History from the 2026-08-10 `308153b` upgrade: commit-chain rebase with one
real conflict. `0007`: upstream raised `BaseSession.__init__`'s context
defaults (`default_context_win` 30000→35000, `default_cut_msg_interval` 5→7)
on the same line the patch inserts its codex credential block before —
resolved by keeping the codex lines and adopting upstream's new defaults,
since `0007` has no stake in context sizing. The other 15 patches replayed
clean; only `0001`, `0002`, `0007`, and `0008` changed on re-export, all of it
`llmcore.py` line drift from upstream's new `_parse_claude_sse` rate-limit
branch and `_record_usage` null-coercion helper. Explicitly checked and kept:
`0017` is **not** superseded by upstream's `_i()` null coercion (`a1e470b`) —
`_i` is type safety on usage values that arrive, while `0017` covers the
compat-provider case where the input side never arrives at `message_start` at
all. `0016`'s ledger row was also added in this pass; it had been described
only in this header since it landed.)
(`0016-managed-native-thinking-tags.patch` was added in the 2026-08-03 upgrade:
upstream started yielding `thinking_delta` raw, putting untagged native
reasoning into the same stream as the answer. The patch accumulates the block
and emits it once wrapped in `<thinking>` at `content_block_stop`, normalizing
it onto the tag convention every frontend already strips. Remove this patch if
upstream ever tags or channels native thinking itself. Rewritten 2026-09-23:
it now streams the reasoning live inside the tag instead of once per block,
and also covers the chat_completions `reasoning_content` / `reasoning` path;
see the ledger row.)
(History from the 2026-08-03 `d8d90ee` upgrade: commit-chain rebase with one
real conflict. `0007`: upstream capped `retry-after` (`max_retry_after`,
default 60s) by rewriting the same `_stream_with_retry` `err =` line the
patch's codex 429 quota enrichment targets — resolved by keeping both in
order, since the enrichment mutates `body` and upstream's fuller `err` format
then consumes it. The other 13 patches replayed clean; `llmcore.py` hunks
shifted from the new `STATS`, `active_response`, and Responses-API terminal
event handling, all handled positionally by the rebase.
History from the 2026-07-23 `4086d5c` upgrade: upstream force-pushed a
rewritten `main` (commit messages anglicized; old SHAs unreachable), so the
old baseline `1d3c1a09` only resolves in clones that fetched the pre-rewrite
history — its tree is identical to new-history `8a75b39`. Commit-chain rebase
with one real conflict. `0001`: upstream added `self.llmclient = None` on the
`agentmain.py` line the patch's `log_path` state-root redirect targets —
resolved by keeping both. The other 13 patches replayed clean; `llmcore.py`
hunks shifted ~4 lines from the new `reload_mykeys` thread lock and `ga.py`
hunks ~2 lines from the working-memory tool changes, all handled positionally
by the rebase.
History from the 2026-07-22 `1d3c1a09` upgrade: commit-chain rebase with two
real conflicts and one pre-existing drift repair. `0001`: upstream `51f76929`
made long-prompt temp filenames unique (`pid`+`nanos`) on the same `agentmain.py`
line the patch relocates — resolved by combining both:
`state_path('temp', f'user_prompt_{os.getpid()}_{time.time_ns()}.md')`.
`0003`: upstream `6788fb21` deleted the legacy CDP DOM bridge including the
`cdp_cfg` seeding block, so the patch's `cdp_cfg` normalization hunk was
dropped (target code gone); the rest of `0003` is unchanged. `0015`: the
byte-identity gate caught that repo commit `2848c4b` (2026-07-20, icon-state
UX iteration) had edited `managed-ga/code` extension files without
re-exporting the patch — `0015` was regenerated from the checked-in payload
(the shipped, intended state) before rebasing, and then merged with upstream's
legacy-DOM-bridge removal in `content.js` (both deletions kept).
History from the 2026-07-20 `5257decc` upgrade: the whole 14-patch stack
replayed clean onto the new baseline via commit-chain rebase; only `0001` and
`0003` changed, and only in their zero-context `ga.py` `@@` line numbers —
upstream's empty-response tweak in `GenericAgentHandler` shifted
`get_global_memory()` down by 2 lines. No semantic conflict.
History from the 2026-07-15 `1e89c3ee` upgrade: 13-patch stack replayed clean
at that baseline. For that upgrade
the whole stack was regenerated via a commit-chain rebase — old baseline +
patch commits rebased onto the new baseline — because the zero-context hunks
are purely positional and two of them "applied" into wrong locations after
upstream line shifts. `0005` was dropped: upstream now sets
`stdin=subprocess.DEVNULL` in `code_run` natively. `0001`'s
`plugins/project_mode.py` hunk shrank to the `GALLEY_GA_STATE_ROOT` temp
redirect: upstream replaced the pid-anchor files with the
`_ga_project_mode_name` agent attribute — the same seam Galley already sets
from `runner/ga_session.py`. `0007` was merged with upstream's new `copy`
import and `BaseSession.__init__` defaults.)

Current patches:

| Patch | Upstream files | Reason | Rebase risk | Removal condition |
|---|---|---|---|---|
| `0001-managed-state-root.patch` | `agentmain.py`, `ga.py`, `llmcore.py`, `frontends/continue_cmd.py`, `assets/ga_ultraplan.py`, `frontends/workspace_cmd.py`, `plugins/project_mode.py` | Keep Galley-managed user state under `Application Support/app.galley/managed-ga-state` instead of the shipped code payload, including model response logs, long prompt temp files, `/continue` cache, UltraPlan run artifacts, Workspace registry/session maps, and Project Mode project memory files. | Medium: upstream may rename state paths, model response logging, continue-session cache paths, UltraPlan run directories, workspace storage, or project-mode storage paths. | Remove when GenericAgent supports an explicit state root / profile path upstream. |
| `0002-repair-windows-path-tool-json.patch` | `llmcore.py` | Keep managed GA tolerant when models copy Windows paths into `path` / `file_path` / `filepath` tool JSON fields with raw backslashes or doubled quotes. | Low: touches only fallback text-tool JSON parsing for path fields. | Remove when GenericAgent upstream normalizes Windows path values or handles these malformed tool JSON cases. |
| `0003-normalize-asset-path-joins.patch` | `agentmain.py`, `ga.py` | Join managed GA bundled asset paths with platform path segments so Windows verbatim paths never mix `\\?\` with `/`. | Low: only wraps existing `assets` reads behind an `asset_path` helper. | Remove when upstream stops using slash-containing asset path strings under `script_dir`. |
| `0004-managed-wechat-state-paths.patch` | `frontends/wechatapp.py` | Let Galley's managed IM launcher keep WeChat token and temp files under Galley managed state instead of `~/.wxbot` / bundled code paths. | Low: two path constants near module startup. | Remove when upstream WeChat frontend supports explicit token/temp paths. |
| `0006-managed-browser-control-recovery.patch` | `TMWebDriver.py`, `ga.py`, `assets/tmwd_cdp_bridge/background.js`, `assets/tmwd_cdp_bridge/content.js` | Preserve Galley's managed Browser Control recovery semantics: extension-connected/no-tabs diagnostics, page wake-up messages, and MV3 service-worker keepalive / fast reconnect behavior. | Medium-High: upstream frequently touches the browser bridge service-worker loop, and this patch **deletes `isServerAlive()`** — any upstream code added inside that gate cannot be taken as-is (hit on the 2026-08-14 rebase). Check the alarm probe branch and `handleExtMessage` first. | Remove when upstream exposes equivalent extension status and recovery hints. |
| `0007-managed-codex-backend.patch` | `llmcore.py` | Preserve Galley's ChatGPT / Codex managed model backend, including credential IPC refresh, account header propagation, Codex-specific Responses payload shape, forced streaming, and best-effort WHAM quota reset hints on final 429 failures. | Medium: upstream OpenAI request assembly changes can alter nearby contexts. | Remove when upstream supports Galley's Codex credential, request contract, and quota-reset diagnostics directly. |
| `0008-managed-image-attachments.patch` | `agentmain.py`, `llmcore.py` | Let Galley's managed runtime receive local image attachment paths from the bridge, encode them as real multimodal content blocks, and preserve non-text image blocks through the native tool client. | Medium: touches the managed task loop and native content-block filtering. | Remove when GenericAgent upstream exposes a stable public image-input contract for frontend callers. |
| `0009-managed-feishu-config-env.patch` | `frontends/fsapp.py` | Let Galley's managed IM launcher inject Feishu app config from process memory, keep Feishu media temp files under Galley managed state, observe reconnect retries, tear down the lark websocket connection / event-loop tasks on each reconnect cycle so dead connections don't linger as zombies that divide by zero, log the lark-oapi hook path, and keep final-turn cards showing the turn summary/detail panel before final output. | Medium: touches config loading, temp path constants, an optional status hook, final-turn card rendering, and lark-oapi websocket lifecycle internals (module-level event loop, `_disconnect`). Re-verify `_teardown_lark_client` and the `GalleyStatusWsClient` private seams (`_connect`/`_reconnect`/`_try_connect`) before upgrading lark-oapi. | Remove when upstream Feishu frontend supports explicit config, temp paths, reconnect status callbacks, final-turn card summary panels, and a clean connection stop API. |
| `0010-managed-keychain-state-path.patch` | `assets/code_run_header.py` | Keep Galley-managed keychain secrets under `managed-ga-state/ga_keychain.enc` instead of the user's real home `~/ga_keychain.enc`, so secrets written by any keychain-using SOP (e.g. Sophub self-bootstrap) stay inside the managed state root and don't collide with an external GA checkout's keychain. Applied at the `code_run` preamble so the in-memory `keychain` module is rebound (`_PATH` + rebuilt `keys`) before the agent imports it. Attach mode has no `GALLEY_GA_STATE_ROOT`, so the block is a no-op there. | Low: appends a tail block to the code_run preamble after the `sys.path.append` line; only runs when the agent emits a `code_run` that imports `keychain`. | Remove when GenericAgent upstream keychain respects an explicit state root / profile path, or when `code_run_header.py` is restructured so keychain is no longer importable at preamble time. |
| `0011-managed-feishu-owner-binding.patch` | `frontends/fsapp.py` | Owner-locked access for the Galley-managed Feishu bot: with Galley-injected config (`GALLEY_FEISHU_CONFIG_JSON`), an empty allow-list means "locked awaiting pairing" instead of public access; a p2p text message matching `fs_owner_bind_code` binds the sender as the sole allowed user (wrong codes are ignored silently, the code is invalidated after 10 wrong attempts) and reports `ownerOpenId` through the status hook, which now forwards extra keyword fields. File-based (non-managed) config keeps upstream semantics untouched. | Medium: touches `_load_config` / `_feishu_config` / `_handle_message_impl` / `_emit_galley_status`, which patch 0009 also touches — rebase 0009 first, then this. Binding relies on `message.chat_type == "p2p"` from lark-oapi event models; re-verify on lark-oapi upgrades. | Remove when the upstream Feishu frontend supports explicit per-user access control / owner pairing. |
| `0012-managed-feishu-file-marker-echo.patch` | `frontends/fsapp.py` | Stop messaging Feishu users "文件不存在: filepath" when the model echoes `FILE_HINT`'s literal `[FILE:filepath]` example (or another bare-word placeholder) in its reply: filter the known placeholder set and log-skip bare words that are not existing files, keeping the user-facing warning for real-looking (separator-containing) paths that are genuinely missing. Mirrors the placeholder guard the upstream WeChat frontend already has (`wechatapp.py` `bad` set). | Low: replaces only the `_send_generated_files` loop body. | Remove when upstream fsapp gains the same placeholder/echo guard as wechatapp. |
| `0013-managed-feishu-report-turn-guard.patch` | `frontends/fsapp.py` | Card isolation for the Galley proactive completion reporter (`runner/im_reporter.py`): while the reporter drains its synthetic report turn, a user task registered in the same window must not stream the report turn's steps into its own card. GA doesn't tag turns with a task identity, so the reporter marks its window via a module flag (`_GALLEY_REPORT_TURN_ACTIVE`) and `_make_task_hook` returns early while it is set. No-op for upstream/file-based use: the flag is only ever set by Galley's reporter. | Low: adds one module constant and a two-line early return at the top of `_make_task_hook`'s hook; patch 0009 also touches nearby card code — rebase 0009 first. | Remove when GA tags agent turns with the originating task (letting card hooks filter by task identity), or if the reporter moves off synthetic in-conversation turns. |
| `0014-managed-telegram-galley-integration.patch` | `frontends/tgapp.py` | Galley managed-integration seams for the upstream Telegram frontend, mirroring the Feishu 0009+0011 pair in one patch (both concerns land together): env-injected config (`GALLEY_TELEGRAM_CONFIG_JSON`: `tg_bot_token`, `tg_allowed_users`, `tg_owner_bind_code`), an optional `GALLEY_STATUS_HOOK` status pipe (running via `post_init` after getMe accepts the token, reconnecting/error with a 3-strike startup limit, immediate error on `InvalidToken`), callable `main()` / `check_config()` entrypoints for the launcher, and owner-locked access: with managed config an empty allow-list means "locked awaiting pairing", a private-chat text matching the bind code binds the sender as sole allowed user (silent wrong-guess handling, code invalidated after 10 wrong attempts) and reports `ownerOpenId` through the hook. File-based (non-managed) config keeps upstream semantics untouched. | Medium: restructures the `__main__` block into `main()` and touches the per-handler access gates; upstream changes to the polling loop or handler registration will need a manual rebase. Binding relies on `update.message.chat.type == ChatType.PRIVATE` from python-telegram-bot v20 models. | Remove when the upstream Telegram frontend supports explicit config injection, connection status callbacks, and per-user access pairing. |
| `0015-managed-extension-galley-branding.patch` | `assets/tmwd_cdp_bridge/manifest.json`, `assets/tmwd_cdp_bridge/content.js`, `assets/tmwd_cdp_bridge/background.js`, `assets/tmwd_cdp_bridge/popup.html`, `assets/tmwd_cdp_bridge/popup.js`, `assets/tmwd_cdp_bridge/icons/*` (new, binary) | De-intrude and rebrand the managed browser extension. The load-bearing decision is **bridge status belongs on the toolbar, not injected into the user's pages** — so the upstream always-on in-page `ljq_driver: 已连接` badge is removed outright. (It also covered page content, swallowed clicks, and claimed "connected" regardless of real bridge state. Those were the evidence, not the reason: upstream fixed the first two and made the third truthful in `e519734` on 2026-08-13, and the removal still stands, because a quieter injected node is still an injected node and a second indicator for a state the toolbar already shows. Do not re-open this on the strength of upstream polishing its badge.) Also rename the display name to "Galley Browser Bridge" with the Galley app icon set (16/32/48/128, from `core/icons/`), surface the real WS connection state on the toolbar icon badge (`ON` only while connected, via a new `bridge_status` extension-internal command; the idle state reads `待命（Galley 未运行）`, not an alarming "disconnected"), and turn the popup into a status panel with cookie copy behind an explicit button instead of auto-copying cookies to the clipboard on open. Wire protocol, folder name, and DOM marker ids are unchanged, so the extension stays usable by an external GA. | Medium: same extension files as 0006; zero-context hunks assume 0006 is applied first — keep 0015 after 0006 in the stack. Upstream is actively working on the same badge (`e519734`, 2026-08-13, which conflicted here), so expect the `content.js` deletion to keep colliding. The icon PNGs are git binary hunks: they carry `index` lines (required for binary apply) and re-add the files whole on replay. | Remove when upstream stops injecting page UI on its own **and** ships an equivalent truthful toolbar status **and** the branding / icon / popup-cookie parts become unnecessary — all three, since this patch is three concerns in one. Upstream improving the in-page badge is not a trigger. |
| `0016-managed-native-thinking-tags.patch` | `llmcore.py` | Stream native model reasoning **in-band, tagged, live**. Upstream yields native reasoning **untagged** into the same character stream as the answer on two channels: Anthropic `thinking_delta` (`_parse_claude_sse`, since `d8d90ee`) and OpenAI-compatible `reasoning_content` / `reasoning` (`_parse_openai_sse` chat_completions branch). Frontends tell reasoning from answer only by the `<thinking>` tag convention (`runner/workbench_bridge.py` `_TAG_PATS`, the GUI's streaming strip, the IM frontends' `clean_reply`), so untagged deltas render as body text and, on the display-stream-built `done` text, land in the final reply. `core/src/commands/managed_model.rs` ships `"thinking_type": "adaptive"` as the Anthropic-protocol default, so this is every managed Anthropic session. A small helper (`_GalleyThinkTag`) opens `<thinking>` at the first non-whitespace reasoning text (a whitespace-only block emits nothing), passes each delta through as it arrives, and closes: Anthropic at every `content_block_stop`, before an SSE `error` exit, and after the loop; chat_completions before the first non-empty `delta.content`, at the first `tool_calls` delta, and after the loop (`[DONE]` or exhaustion). A literal `</thinking>` in the reasoning is yielded as `</ thinking>` even when split across deltas (a tail that is a proper prefix of `</thinking>` is held back and flushed at the next delta or close). Display only: the returned content blocks (and so history, `response.thinking`, tool calls) are byte-identical to upstream's. First version (2026-08-03) buffered each Anthropic block and emitted it once at `content_block_stop`, so reasoning was never visible live; rewritten 2026-09-23 for the live reasoning preview. Not covered: the Responses-API branch (upstream never streams its reasoning), the JSON parsers, and exits by a transport exception or Stop, which can leave the tag open at the stream tail. Of the managed IM frontends only Feishu runs `verbose = True` and so sees the raw stream, and it renders only the settled `done` text; Telegram, WeChat and Discord run `verbose = False` and never see LLM deltas. | Low-Medium: touches `_parse_claude_sse`'s delta / `content_block_stop` / `error` handling (same function patch `0017` touches — keep `0016` before `0017`; `0016`'s init line sits *above* `stop_reason = …` so it never collides with `0017`'s insertion *below* it) and the chat_completions loop of `_parse_openai_sse`. Any change in `0016`'s line count shifts `0017`'s and `0021`'s zero-context hunks: re-export them via a commit-chain replay, never by hand. | Remove when upstream tags or channels native thinking itself. |
| `0017-managed-compat-usage-accounting.patch` | `llmcore.py`, `frontends/cost_tracker.py` | Correct input-token accounting for Anthropic-COMPATIBLE providers (e.g. Zhipu GLM, Galley's managed `anthropic`-protocol presets): they send zero/absent usage at `message_start` and the full cumulative usage on the final `message_delta`, which upstream only reads `output_tokens` from — so the input side was never counted (Galley telemetry showed `↑0`, `/cost` likewise). llmcore gains a delta-side input fallback (recorded only when `message_start` carried no input, so real Anthropic streams don't double-count; `output_tokens` zeroed so the `[Output]` print stays the only output accounting, and the extra `[Cache]` print keeps subagent log scanning consistent). cost_tracker counts a messages-mode request only on the call that carries usage, keeping `requests` at one per LLM call on both provider shapes and stopping the zeroed placeholder from clobbering `last_input`. | Low-Medium: touches `_parse_claude_sse`'s `message_start`/`message_delta` handling (same region patch 0016 touches — keep 0016 before 0017) and cost_tracker's `record_patched`. | Remove when upstream records the input side from `message_delta` usage itself, or when compat providers report real usage at `message_start`. |
| `0018-managed-discord-galley-integration.patch` | `frontends/dcapp.py` | Galley managed-integration seams for the upstream Discord frontend, following the `0014` Telegram template but **keeping** dcapp's per-channel agent routing, `@`-mention activation, active-set TTL, and thread handling (a Discord channel = one supervisor context) while **replacing** its access control: env-injected config (`GALLEY_DISCORD_CONFIG_JSON`: `discord_bot_token`, `discord_allowed_users`, `discord_owner_bind_code`, optional `proxy`), an optional `GALLEY_STATUS_HOOK` status pipe, callable `main()` / `check_config()`, and DM-only owner pairing (a guild-visible bot must never pair in a channel) whose wrong guesses are rate-limited **per user** (5 attempts) instead of invalidating the code globally, which in a shared server would be a DoS button. Also carries the upstream debts the channel form makes mandatory: a real agent close protocol (stop event + a `str`-subclass sentinel that survives upstream `run()`'s `task.get("images")`-before-`isinstance(task, str)` ordering + thread join) with the agent LRU cut from 200 to 12 and eviction/restart releasing the channel's active flag with an explanatory notice (that release and both notices are superseded by `0026`: activation survives restarts and evictions, and the channel's conversation is picked back up from its engine log); a connection state machine (permanent `LoginFailure` / `PrivilegedIntentsRequired` / gateway 4004·4013·4014 / HTTP 401 report `error` and exit instead of backing off forever, transient errors report `reconnecting` with a 3-strike startup limit, `on_ready` reports `running` with `botId`, stop closes the client and joins every agent); state files (active-channel JSON, attachment scratch) moved to the Galley-injected `GALLEY_DISCORD_STATE_DIR`; message logging reduced to event metadata (no bodies); attachments downloaded into a per-turn scratch dir removed when the turn ends; and `1900`-char splitting that closes and reopens a ``` fence across the cut. Adds two seams for the Galley runner: `GALLEY_AGENT_HOOK(agent, chat_id)` on every freshly created channel agent (per-channel supervisor id `galley-im/discord/ch:<id>`) and `DiscordApp.deliver_text()`, a strict send that raises instead of swallowing so the completion reporter cannot mark an undelivered report delivered. File-based (non-managed) config keeps upstream semantics, DM conversation included. | Medium-High: rewrites `DiscordApp.__init__` / `_get_agent` / `_handle_message` / `start()` and the `__main__` block; upstream changes to the activation flow, agent cache, or reconnect loop need a manual rebase. Depends on upstream `agentmain.GenericAgent.run()`'s sentinel branch shape and on `discord.py` exception names (looked up via `getattr`, so a rename degrades to "transient" rather than crashing). | Remove when the upstream Discord frontend supports explicit config injection, connection status callbacks, owner pairing, an agent close protocol, and an explicit state directory. |
| `0019-managed-im-strip-next-suggestion.patch` | `frontends/chatapp_common.py`, `frontends/fsapp.py` | Adds `next-suggestion` to both IM display tag-strip lists. The Galley workbench composer's ghost-text tag was mandated by the shared managed runtime prompt and leaked verbatim into every IM reply (2026-08-13 Discord/Feishu dogfood). The root fix removes the mandate from IM compositions core-side (`compose_im_runtime_prompt`); this patch is the defensive layer — a model can still imitate the tag from pre-fix conversation history. | Low: one comment + one tuple entry per file; rebases trivially unless upstream reshapes the tag lists. | Remove if the strip lists become Galley-configurable upstream, or if the suggestion feature is redesigned to be consumed on IM surfaces (deferred: IM suggestion buttons). |
| `0020-managed-windows-no-console-spawns.patch` | `frontends/workspace_cmd.py`, `assets/ga_ultraplan.py` | Suppress flashing console windows on Windows (Galley issue #23): the bridge runs with `CREATE_NO_WINDOW`, so any console-subsystem child it spawns without `creationflags` gets a freshly allocated visible console. Adds `CREATE_NO_WINDOW` (`0x08000000`) to `workspace_cmd`'s `cmd /c mklink /J` call — the literal blank CMD window at project-workspace session create/restore — and to the UltraPlan daemon `Popen`. The runner-side siblings (git probe, galley CLI, desktop pet) are fixed directly in `runner/process_command.py`; upstream `ga.py` / `agentmain.py` / `code_run_header.py` already carry the flag, these two were the leftovers. | Low: one-line kwargs additions inside existing calls; `workspace_cmd.py` is also touched by `0001` (different function) — keep after `0001`. | Remove when upstream passes `CREATE_NO_WINDOW` on these spawns itself (candidate for an upstream PR). |
| `0021-managed-retry-after-value-in-error.patch` | `llmcore.py` | Put the server's actual `Retry-After` value into the give-up error text. Upstream's `max_retry_after` cap (default 60s) makes `_stream_with_retry` surface `!!!Error: HTTP 524 (retry-after > 60s)` when a relay asks for a longer wait, but the message drops the value the relay sent, so a user cannot tell whether raising the cap (Settings -> Models advanced `max_retry_after`, exposed 2026-09-14) would ever be enough. Now reads `(retry-after 120s > 60s cap)`. | Low: one-line rewrite of the `err =` line in `_stream_with_retry`; `0007` inserts its codex 429 enrichment two lines above — keep after `0007`. | Remove when upstream prints the `Retry-After` value itself. |
| `0022-managed-strip-goal-status.patch` | `frontends/chatapp_common.py`, `frontends/fsapp.py` | Adds `goal-status` to both IM display tag-strip lists (the shared one and Feishu's own, the same pair `0019` touched). Galley Goal dispatch asks the model to close its final answer with `<goal-status>complete</goal-status>` (or `blocked`); `runner/workbench_bridge.py` extracts it into `TurnEndEvent.goalStatus` and strips it from Galley's own display, so on an IM surface the tag is never reply prose either — same defensive layer `0019` added for `next-suggestion`. | Low: one comment + one tuple entry; `0019` rewrites the same line — keep `0022` after `0019`. | Remove if the strip lists become Galley-configurable upstream, or if Goal completion stops being signalled through a text tag. |
| `0023-managed-discord-conversation-ux.patch` | `frontends/dcapp.py` | Discord conversation UX aligned with the desktop (`docs/devlog/2026-09-30-discord-conversation-ux.md`), display layer only: access control, activation, pairing, the agent close protocol and the connection state machine are untouched. **Run status message**: upstream's per-run 「思考中...」, per-step 「步骤N：」 and 20-second 「⏳ 还在处理中」 messages (each one a push) become one status message per run, replied under the triggering message (`mention_author=False`) and edited in place at most every 1.5 s: last settled step as `NN summary` / `·· 思考中` (plus ` · 已 M 分钟` once a step passes 60 s), or `·· 排队中` while queued (the `已完成 N 步` line above the step and the ` · 仍在运行` tail were dropped after the Telegram dogfood, `.scratch/telegram-ux/issues/06-quieter-status-message.md`: the step number already gives the count and 思考中 already says it runs); liveness is Discord's typing indicator. It is deleted once the answer lands; the answer's first line is a `-# N 步 · 用时 X` subtext (the desktop fold header) and its body is the closing step only (`outputs[-1]`), not every step's narration. A stop freezes it as `⏹ 已停止 · N 步 · 用时 X`. `user_tasks[chat_id]` becomes the channel's ordered run list, so a second message no longer overwrites the running run's registration and the first run's `finally` no longer pops the second's; a queued run reads its display queue only once it heads the channel. Adds `DiscordApp.deliver_embed()`, a strict embed send for the completion reporter (same contract as `deliver_text`). **ask_user, stop, commands**: ask_user is captured from `agent._turn_end_hooks` (tgapp's seam; the event is tagged with the asking task's display queue, so a completion-reporter turn's ask is never claimed by a user run) and posted as a question message whose buttons follow the desktop `candidateLayout` thresholds (row: candidate labels; list: numbered text + number buttons; more than 25 or multi-select: numbered text, answered by typing). A click, or the next plain message typed in the channel, answers it: the question is edited into an echo (chosen one ✓, the rest `-#`) and the continuation run carries the step count and elapsed time. Stopping is text `/stop` only: the status message carries no button, it freezes as the receipt and 「⏹️ 正在停止...」 is no longer posted; a 停止 button left by an earlier version is acknowledged silently and stripped when clicked, stopping nothing. `/btw` and `/review` work instead of falling through to help (`/review` is sent raw so GA's own slash interception sees it); `/help` lists the exit words. Buttons are render-only views routed by `custom_id` in `on_interaction`, so a click on a button left by an earlier process is acknowledged and its buttons removed instead of failing. | Medium: rewrites `DiscordApp.run_agent` / `handle_command` and `send_done`'s file loop, adds module helpers and methods. **Depends on `0018` in front**: it edits code `0018` introduced (`_deactivate_channel`, `_retire_agent`, `_get_agent`, the `deliver_text` neighbourhood, `get_app`'s docstring), so keep `0023` after `0018` and re-export it whenever `0018` changes. `0026` is stacked on it: re-export `0026` on top of every new `0023`. Couples (tracked as `docs/ga-baseline.md` Contract Surface item 15) to GA's display-queue item shape (`next` / `done` with `turn` and `outputs`, `agentmain.py` `run()`), the ask_user exit payload (`ga.py` `ask_user`, `agent_loop.py` EXITED branch), `agent._current_queue`, and `review_cmd`'s `/review` interception. `runner/im_reporter.py` reads `app.user_tasks.get(chat_id)` truthiness and calls `deliver_embed`. | Remove the overlapping parts when the upstream Discord frontend ships an equivalent run status presentation, ask_user buttons and a `/stop` receipt; `deliver_embed` goes with `0018`'s reporter seams. |
| `0024-managed-telegram-conversation-ux.patch` | `frontends/tgapp.py`, `frontends/galley_im_display.py` (new) | Telegram conversation UX aligned with the desktop (`docs/devlog/2026-09-30-telegram-conversation-ux.md`; `0023` is the mother implementation), display layer only: access control, pairing, `main()`'s connection state machine, `_emit_galley_status` and `check_config` (all `0014`'s) are untouched. **Live status message, then one answer**: upstream's per-step formal messages (`LLM Running (Turn k) ...` title, `<summary>` quote block, 🛠️ echo, each one a push) become one live surface per run: a silent status message (`disable_notification`, plain text), in private chats and groups alike, the same shape as `0023`'s Discord status message. It is edited in place only when its text changes, at least 1.5 s apart: last settled step as `NN summary` / `·· 思考中`, plus dcapp's ` · 已 M 分钟` once the current step has run a full minute (no seconds readout; back to zero when a step settles) / `另有 K 条消息排队中`, or a bare `·· 排队中` while GA is on another task. It is deleted once the run's message is out, and frozen into the stop receipt when the run is stopped. Private chats first used a `sendMessageDraft` draft; the first dogfood round dropped it (2026-09-30): the client reserves a streaming area for a draft and pushes the chat up, leaving a blank gap. The run then posts one new message: the answer is the closing step only (`outputs[-1]`, dcapp's cleaning, `[FILE:]` shown as file names) under the fold header, an expandable MarkdownV2 quote opening with `N 步 · 用时 X` and one `NN summary` line per step (the last 30), then a blank line; later parts and files arrive silently, and it quotes the trigger only when something landed after it (the run's own status message does not count when it went out right below the trigger). Markdown tables become lists, headings bold lines, `>` runs quote blocks; rules go, bullets become •. `ctx.user_data['stream_task']` becomes a global ordered run list (one agent, FIFO), and only its head reads its display queue. **ask_user, stop, commands**: ask events are claimed by display queue (a completion-reporter turn's ask is never claimed; the global `_ask_menu_events` queue is gone), questions without candidates are posted too, buttons follow the desktop `candidateLayout` (row: one full-text button per row; list: numbered text, number buttons 8 per row; more than 50: numbered text, no buttons), and multi-select keeps upstream's toggles with 「提交」; `none of these above` and its cancel message are gone. A click, or the next plain text message, answers (echo: chosen ✓, the rest italic; a typed answer ticks nothing) and the continuation carries the step count, elapsed time and step summaries. `/stop` stops the running run only (receipt `⏹ 已停止 · N 步 · 用时 X` in the frozen status message, no 「⏹️ 正在停止...」; 「当前没有在跑的任务」 otherwise, never aborting a reporter turn); `/new`, `/restore` and `/continue n` end the running run as stopped instead of cancelling the newest display, so no task keeps running unseen, and queued runs go on. Adds two seams for `runner/im_reporter.py`: `answer_text(raw)` and `markdown_v2_segments(text)`. `frontends/galley_im_display.py` is Galley's platform-neutral helper file (`0023`'s dcapp helpers under public names, plus `still_running_suffix` and `tables_to_lists`); dcapp keeps its own copies for now. | Medium: rewrites tgapp's display layer (the stream session, turn coordinator and `_stream` are deleted) and the run-starting tails of the message, callback, photo and command handlers. **Depends on `0014` in front**: its hunks sit next to `0014`'s access gates in `handle_msg` / `handle_ask_callback` / `handle_photo` / `handle_command` and keep `0014`'s bind flow, so re-export `0024` whenever `0014` changes. The new file carries no upstream risk; it imports `chatapp_common` (`clean_reply`, `strip_files`, with the `0019` / `0022` tag list). Couples (tracked as `docs/ga-baseline.md` Contract Surface item 15) to the display-queue item shape with `inc_out=True` (incremental `next`, whole step texts in `outputs`), the ask_user exit payload through `_turn_end_hooks`, `agent._current_queue` and `agent.is_running` (claiming asks, `·· 排队中`, `/stop`), `review_cmd.handle`, and `continue_cmd`'s reset aborting through `agent.abort()` (probed by an instance-level wrapper for the duration of one `/continue n` call). `runner/im_reporter.py` reads `answer_text` / `markdown_v2_segments`, `clean_reply`, `_render_file_markers` and `split_text`. | Remove the overlapping parts when the upstream Telegram frontend ships an equivalent single-answer presentation, a run queue that `/stop` and `/new` respect, and ask_user without the global event queue; the reporter seams go with the reporter. Moving dcapp onto `galley_im_display.py` (split into its own patch ahead of `0023`) goes with the IM chrome localisation (`.scratch/im-chrome-i18n/`); until then, display-only fixes to dcapp re-export `0023` in place. |
| `0025-managed-abort-wakes-on-macos.patch` | `agentmain.py` | `GenericAgent.abort()` wakes a recv() still waiting for response headers on macOS (`docs/devlog/2026-09-30-macos-abort-wake.md`). Upstream's `abort()` shuts the in-flight socket down and then force-closes it with CPython's `_real_close()` (`3d62523`: on Windows only the close wakes a blocked recv). On macOS that immediate close races the shutdown's wake-up: a request the relay has not answered yet stayed blocked until `read_timeout` (180 s in Galley's model presets) in 6 of 13 repro trials, so desktop Stop and every IM channel's `/stop` looked stopped while the next task queued behind it (Telegram, 2026-09-30). The close now runs on Windows only (`os.name == 'nt'`); on macOS the shutdown alone woke 22 of 22 trials (Linux untested; shutdown normally wakes a blocked recv there). | Low: two lines re-indented under an `if` in `abort()`'s socket block; any upstream edit to that block conflicts loudly. `runner/tests/test_managed_ga_abort.py` loads `abort()` from the payload source and pins the per-platform calls. | Remove when upstream stops force-closing right after the shutdown off Windows (or wakes the recv another way that holds on macOS); an upstream PR is drafted in `docs/devlog/deferred.md`. |
| `0026-managed-discord-restart-continuity.patch` | `frontends/dcapp.py` | A Discord channel keeps its activation and its conversation across a restart (「重启 Channels」, an app restart) and an agent-cache eviction (`.scratch/discord-ux/issues/06-restart-continuity.md`). Supersedes `0018`'s release: the startup release of every persisted active channel (`_stale_channels`, 「服务已重启…」) and the eviction's deactivation and 「上下文已释放」 notice are gone; activation keeps upstream's 30-day TTL. Each active-channel entry gains `log`, the basename of the `model_responses_<logid>.txt` file the channel agent writes (`agent.log_path`): a file pointer, never conversation content (constitution rule 4; the conversation is already in the engine's own log). It is written once that log exists, at the end of every run, before an eviction, and after a resume that had to copy. `/new` moves the agent onto a fresh log (`continue_cmd.begin_fresh_session`) and drops the mapping until something is said; `/continue N` keeps chatapp_common's list and reply, then moves the channel onto a copy of the restored log (`continue_copy`), so the mapped log always holds exactly the conversation the agent has. `/restore` only appends working-memory lines and leaves the log accurate, so it changes nothing. Entries without `log` (upstream, pre-`0026`) load as active with a fresh context. A new channel agent resumes from its mapped log on its own worker thread before serving any task (tasks queue behind it, the event loop and the completion reporter never wait on the read, slash commands wait for it): `continue_inplace(..., restore_wm=True)`, re-deriving working memory from the same log, because backend history is trimmed as it grows and the `<history>` digest is what carries early context past the trim, as it would have in-process. A lock that is still fresh (< 30 s) but carries dcapp's `galley-discord:` agent_id and another pid was left by the previous dcapp process, which is gone (`supervisor.lock` runs one dcapp per state dir), so it is taken over instead of waiting out `_STALE_AFTER`; a log held by another live process falls back to `continue_copy`. A mapping that cannot be picked back up (missing, empty, unparseable) leaves a fresh log and puts `-# 之前的对话没接上，这是新的上下文` once at the top of the channel's next answer or question. An evicted agent is marked `_galley_closed`, so the completion reporter's `DiscordChannel.agent()` resolves the channel's next agent through `app._get_agent` instead of queueing a report turn on a closed one. Copy: activation `✅ 已激活，本频道的发言都会交给 Galley` over `-# 频道成员都能看到回复 · 发「退出频道」可退出`; one exit receipt `✅ 已退出，重新 @ 我即可激活` for both exit-word sets (each exits the channel or thread it is sent in); `/help`'s last line `退出频道 - 停止在本频道或子区响应`. | Medium: edits code `0018` and `0023` introduced (`_ChannelAgent`, `DiscordApp.__init__`, the active-channel helpers, `_get_agent` / `_retire_agent` / `_close_agent_async`, `handle_command`, `run_agent`'s `finally`, `_finish_run` / `_send_answer` / `_post_ask`, the exit branch, `DISCORD_HELP_TEXT`), so keep it after both and re-export it whenever either changes: it is zero-context, so a line-count change in `0023` makes its pure-add hunks land off by that many lines without `git apply` failing. Couples (`docs/ga-baseline.md` Contract Surface item 15 (f)) to `agent.log_path` and agentmain's `model_responses_<logid>.txt` naming, `llmcore._write_llm_log`'s framing and the native clients' Prompt / Response bodies (parsed by `continue_cmd`), and `continue_cmd`'s `continue_inplace` / `continue_copy` / `begin_fresh_session` / `session_occupant` / `restore` / `list_sessions`, plus the private `_lock_path` and the lock file's `pid` / `agent_id` fields. `runner/im_reporter.py` reads `_galley_closed` and restores the active channels' routing on its first tick after dcapp's app exists. | Remove when the upstream Discord frontend picks a channel's conversation back up across restarts itself; drop the `/new` and `/continue N` log moves once upstream's IM frontends retarget the agent's log on those commands. |

Rules:

- Keep each patch small and product-scoped.
- Patch files are zero-context unified diffs; replay them through
  `scripts/build-managed-ga.sh` so `git apply --unidiff-zero` is used.
- Record the upstream files touched, reason, rebase risk, and removal condition.
- Remove a Galley patch when upstream GenericAgent provides the same capability.
- Never apply these patches to a user-owned external GenericAgent checkout.
