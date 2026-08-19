# Managed GA Patch Stack

Patch stack id: `galley-managed-ga-patches-v1`

Last replay verified: `2026-08-14` against upstream
`f06d5503808ba9d164fb583e4c500d5ce01efd4c` (18-patch stack, through `0019`).
All 18 patches applied clean from a fresh clone at the audited baseline and the
rebuilt payload matched the committed `managed-ga/code` byte-for-byte.

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

(`0020` landed `2026-08-18` against the same baseline, verified as a
top-of-stack `git apply --unidiff-zero` onto the committed payload plus a
`py_compile` of the two touched files — not a fresh-clone full replay. Same
standing debt shape as `0018`/`0019` had: retire it at the next full rebase
run.)

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
upstream ever tags or channels native thinking itself.)
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
| `0016-managed-native-thinking-tags.patch` | `llmcore.py` | Normalize native Anthropic reasoning onto the `<thinking>` tag convention. Upstream `d8d90ee` started yielding `thinking_delta` raw, putting **untagged** native reasoning into the same character stream as the answer — a different channel from the prompted `<thinking>` convention (which arrives as ordinary `text_delta`) that `runner/workbench_bridge.py`'s `_TAG_PATS` strips. Since `core/src/commands/managed_model.rs` ships `"thinking_type": "adaptive"` as the Anthropic-protocol default, thinking is requested on every managed Anthropic session, so untagged deltas would render as assistant body text and land in `final_answer` + the FTS index. The patch accumulates the block and emits it once, wrapped, at `content_block_stop` (whole block at once so a literal `</thinking>` inside the reasoning can be neutralized without straddling a chunk boundary). | Low-Medium: touches `_parse_claude_sse`'s `content_block_delta` / `content_block_stop` handling — the same region patch `0017` touches, so keep `0016` before `0017`. Upstream's `error`-branch changes land nearby and drift these zero-context hunks positionally. | Remove when upstream tags or channels native thinking itself. |
| `0017-managed-compat-usage-accounting.patch` | `llmcore.py`, `frontends/cost_tracker.py` | Correct input-token accounting for Anthropic-COMPATIBLE providers (e.g. Zhipu GLM, Galley's managed `anthropic`-protocol presets): they send zero/absent usage at `message_start` and the full cumulative usage on the final `message_delta`, which upstream only reads `output_tokens` from — so the input side was never counted (Galley telemetry showed `↑0`, `/cost` likewise). llmcore gains a delta-side input fallback (recorded only when `message_start` carried no input, so real Anthropic streams don't double-count; `output_tokens` zeroed so the `[Output]` print stays the only output accounting, and the extra `[Cache]` print keeps subagent log scanning consistent). cost_tracker counts a messages-mode request only on the call that carries usage, keeping `requests` at one per LLM call on both provider shapes and stopping the zeroed placeholder from clobbering `last_input`. | Low-Medium: touches `_parse_claude_sse`'s `message_start`/`message_delta` handling (same region patch 0016 touches — keep 0016 before 0017) and cost_tracker's `record_patched`. | Remove when upstream records the input side from `message_delta` usage itself, or when compat providers report real usage at `message_start`. |
| `0018-managed-discord-galley-integration.patch` | `frontends/dcapp.py` | Galley managed-integration seams for the upstream Discord frontend, following the `0014` Telegram template but **keeping** dcapp's per-channel agent routing, `@`-mention activation, active-set TTL, and thread handling (a Discord channel = one supervisor context) while **replacing** its access control: env-injected config (`GALLEY_DISCORD_CONFIG_JSON`: `discord_bot_token`, `discord_allowed_users`, `discord_owner_bind_code`, optional `proxy`), an optional `GALLEY_STATUS_HOOK` status pipe, callable `main()` / `check_config()`, and DM-only owner pairing (a guild-visible bot must never pair in a channel) whose wrong guesses are rate-limited **per user** (5 attempts) instead of invalidating the code globally, which in a shared server would be a DoS button. Also carries the upstream debts the channel form makes mandatory: a real agent close protocol (stop event + a `str`-subclass sentinel that survives upstream `run()`'s `task.get("images")`-before-`isinstance(task, str)` ordering + thread join) with the agent LRU cut from 200 to 12 and eviction/restart releasing the channel's active flag with an explanatory notice; a connection state machine (permanent `LoginFailure` / `PrivilegedIntentsRequired` / gateway 4004·4013·4014 / HTTP 401 report `error` and exit instead of backing off forever, transient errors report `reconnecting` with a 3-strike startup limit, `on_ready` reports `running` with `botId`, stop closes the client and joins every agent); state files (active-channel JSON, attachment scratch) moved to the Galley-injected `GALLEY_DISCORD_STATE_DIR`; message logging reduced to event metadata (no bodies); attachments downloaded into a per-turn scratch dir removed when the turn ends; and `1900`-char splitting that closes and reopens a ``` fence across the cut. Adds two seams for the Galley runner: `GALLEY_AGENT_HOOK(agent, chat_id)` on every freshly created channel agent (per-channel supervisor id `galley-im/discord/ch:<id>`) and `DiscordApp.deliver_text()`, a strict send that raises instead of swallowing so the completion reporter cannot mark an undelivered report delivered. File-based (non-managed) config keeps upstream semantics, DM conversation included. | Medium-High: rewrites `DiscordApp.__init__` / `_get_agent` / `_handle_message` / `start()` and the `__main__` block; upstream changes to the activation flow, agent cache, or reconnect loop need a manual rebase. Depends on upstream `agentmain.GenericAgent.run()`'s sentinel branch shape and on `discord.py` exception names (looked up via `getattr`, so a rename degrades to "transient" rather than crashing). | Remove when the upstream Discord frontend supports explicit config injection, connection status callbacks, owner pairing, an agent close protocol, and an explicit state directory. |
| `0019-managed-im-strip-next-suggestion.patch` | `frontends/chatapp_common.py`, `frontends/fsapp.py` | Adds `next-suggestion` to both IM display tag-strip lists. The Galley workbench composer's ghost-text tag was mandated by the shared managed runtime prompt and leaked verbatim into every IM reply (2026-08-13 Discord/Feishu dogfood). The root fix removes the mandate from IM compositions core-side (`compose_im_runtime_prompt`); this patch is the defensive layer — a model can still imitate the tag from pre-fix conversation history. | Low: one comment + one tuple entry per file; rebases trivially unless upstream reshapes the tag lists. | Remove if the strip lists become Galley-configurable upstream, or if the suggestion feature is redesigned to be consumed on IM surfaces (deferred: IM suggestion buttons). |
| `0020-managed-windows-no-console-spawns.patch` | `frontends/workspace_cmd.py`, `assets/ga_ultraplan.py` | Suppress flashing console windows on Windows (Galley issue #23): the bridge runs with `CREATE_NO_WINDOW`, so any console-subsystem child it spawns without `creationflags` gets a freshly allocated visible console. Adds `CREATE_NO_WINDOW` (`0x08000000`) to `workspace_cmd`'s `cmd /c mklink /J` call — the literal blank CMD window at project-workspace session create/restore — and to the UltraPlan daemon `Popen`. The runner-side siblings (git probe, galley CLI, desktop pet) are fixed directly in `runner/process_command.py`; upstream `ga.py` / `agentmain.py` / `code_run_header.py` already carry the flag, these two were the leftovers. | Low: one-line kwargs additions inside existing calls; `workspace_cmd.py` is also touched by `0001` (different function) — keep after `0001`. | Remove when upstream passes `CREATE_NO_WINDOW` on these spawns itself (candidate for an upstream PR). |

Rules:

- Keep each patch small and product-scoped.
- Patch files are zero-context unified diffs; replay them through
  `scripts/build-managed-ga.sh` so `git apply --unidiff-zero` is used.
- Record the upstream files touched, reason, rebase risk, and removal condition.
- Remove a Galley patch when upstream GenericAgent provides the same capability.
- Never apply these patches to a user-owned external GenericAgent checkout.
