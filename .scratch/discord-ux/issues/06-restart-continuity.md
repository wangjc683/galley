# 06 重启后无缝续接 + 激活文案收短

Status: done
Blocked by: —（05 已提交于 `38e86de1`）
PRD：[../PRD.md](../PRD.md)

## 背景（JC 真机 + 裁决，2026-09-30）

- **现象**：点「重启 Channels」后，在已激活的频道里直接说话没有任何回复，@ 之后才正常。
- **原因**：`0018` 在 managed 模式启动时释放全部持久化的激活频道（`dcapp.py:720-728`，理由是「频道历史只活在进程里，
  重启后仍激活等于悄悄给一个空白 agent」）。「待提示」集合 `_stale_channels` 只在内存里，连续重启几次后提示丢失、
  消息被静默忽略——这是缺陷，不只是摩擦。
- **前提已不成立**：每个频道 agent 都把完整对话写进自己的 `agent.log_path`（上游 `agentmain.py:59-60`，
  `temp/model_responses/model_responses_<logid>.txt`）；上游 `frontends/continue_cmd.py` 有 `continue_inplace(agent, path, ...)`
  （`:1129`）按日志原地续接，`/continue` 用的就是它。
- **裁决**：激活跨重启保留、重启后接回上下文（R3）；激活提示收成一行加小字（T2）；退出回执同口径收短；
  重启前派出的任务在重启后跑完时报告主动投递（加项：reporter 的现成路径一直是 no-op，补上调用时机即可）。
- 宪法第 4 条：不新增任何对话存储。对话本来就在引擎自己的 `model_responses` 里（CLAUDE.md 第 4 条 2026-08-13 解释），
  新增的只是「频道 → 日志文件名」映射。

## 做什么

### 1. 新补丁 `0026-managed-discord-restart-continuity.patch`（dcapp）

`0023` 在台账里声明不碰 activation，这是激活与上下文生命周期，独立成新补丁，排在 `0025` 之后（依赖 `0018`、`0023` 在前），
`managed-ga/manifest.json` 的 `patchStack.patches` 加入。

a. **激活跨重启保留**：删掉 managed 模式启动时的释放（`_stale_channels` 及其分支、`RESTARTED_TEXT`）。30 天 TTL 保留（上游语义）。

b. **频道 → 日志映射**：`discord_active_channels.json` 的每个条目多存一个日志字段（推荐只存 basename，按 model_responses
   目录拼回，避免目录变动后失效；实现方定）。映射要跟着 `/new`、`/continue n`、`/restore` 换日志而更新——最稳是频道 agent 创建后
   和每个 run 结束时回写当前 `agent.log_path`。**只存文件名，不存任何对话内容。** `_load_active_channels` 兼容没有该字段的旧条目
   （上游格式、本补丁之前的文件）。

c. **续接**：`_get_agent` 为频道新建 agent 时，若有映射且日志存在，用上游 `continue_cmd` 续上（`continue_inplace` 优先）。
   - 锁：上游锁 30 秒无心跳才算过期（`continue_cmd.py:899-900`），重启常快于 30 秒。读 `acquire_lock` / `session_occupant` /
     `_read_lock`：持锁者若是已死进程（`supervisor.lock` 保证同一 state 目录只有一个 dcapp 进程）就接管；做不到再退到
     `continue_copy`。不要靠等 30 秒。
   - `restore_wm` 取 True 还是 False，读码决定，在 Comments 写理由。
   - 续接是文件读 + 解析，注意别长时间卡住事件循环（`_get_agent` 也会从 reporter 线程进来）。

d. **续接失败**（有映射，但日志缺失 / 为空 / 解析失败 / 锁抢不到且无法复制）：该频道下一个 run 发出的第一条收尾消息
   （回答或提问）最前面加一行，逐字：`-# 之前的对话没接上，这是新的上下文`。只提示一次。**没有映射**（频道从没说过话、旧格式条目）
   不提示。

e. **LRU 驱逐**（`AGENT_CACHE_LIMIT`）不再取消激活、不再发 `RETIRED_TEXT`：频道保持激活，下一条消息（或报告轮）重建 agent 并同样续接。
   驱逐前回写映射。注意 reporter 一致性：现在 `_retire_agent` 调 `_forget_active_channel`，会经 released hook 让 reporter
   `detach_channel`；改后频道仍激活，而 `DiscordChannel.agent()` 缓存了旧 agent 对象（`runner/im_reporter.py:667-678`）——
   被关掉的 agent 绝不能再被报告轮使用。选最小改法（例如驱逐时让 reporter 换成无 agent 的通道，之后经 `app._get_agent` 懒建），
   测试覆盖。

f. **文案（逐字）**：
   - `ACTIVATED_TEXT`：`✅ 已激活，本频道的发言都会交给 Galley\n-# 频道成员都能看到回复 · 发「退出频道」可退出`
   - 退出回执：`✅ 已退出，重新 @ 我即可激活`（不再区分频道 / 子区：退出分支对两组退出词一视同仁，都退出当前所在的频道或子区）
   - `DISCORD_HELP_TEXT` 末行：`退出频道 - 停止在本频道或子区响应`
   - 退出词表不变（六个词都仍然有效）。
   - 删除 `RESTARTED_TEXT`、`RETIRED_TEXT`（被 d 的小字取代）。

### 2. reporter：app 就绪后恢复激活频道的路由（`runner/im_reporter.py`）

`start_discord_reporter` 调 `restore_active_channels()` 时 dcapp 的 app 还不存在（`managed_im_supervisor.py` 里 `dcapp.main()`
在其后），加上旧的启动释放，这条路径在 managed 下一直是 no-op（08-13 devlog 已记）。改为 app 就绪后执行一次（例如 reporter
轮询里 app 首次可用时补做一次；优先不动补丁的做法）。效果：重启前派出的任务在重启后跑完，报告直接投到频道（无 agent 的通道经
`app._get_agent` 懒建，走 1c 的续接）。飞书 / Telegram 行为逐字节不变。

## 连带文档（你负责这几处，其余主会话写）

- `managed-ga/patches/manifest.md`：新增 `0026` 行（三列同现有格式；removal：上游 dcapp 自己能跨重启续接频道上下文时删）；
  `0018` 行若写了「启动时释放激活频道」或 `RETIRED` 语义，注明被 `0026` 取代；「Last replay verified」按本次重放改写。
- `managed-ga/manifest.json`：`patchStack` 加 `0026`。
- `docs/ga-baseline.md`：Contract Surface item 15 / 耦合地图补 `0026` 的新耦合（`agent.log_path`、`continue_cmd` 的续接与锁函数、
  model_responses 日志格式）；Step 8 Discord 真机清单加一条：重启 Channels 后在已激活频道直接说话——不用 @、接得上之前的话。
- `check-ga-baseline-drift.mjs` 若按补丁清单校验，按其要求补齐。
- 本票面末尾写 `## Comments`。

## 约束

- 补丁流程同 05（`docs/managed-ga-runtime/code-state-and-patches.md`）：只读克隆 `~/Documents/GenericAgent` 到 scratchpad、checkout
  `1b6442fe4f97d87a3d9d52d76569f69d156af853`，先重建确认 `git status managed-ga/code` 干净，再在克隆里应用到 `0025` 之后改 dcapp，
  按 `0023` 的格式（zero-context）导出 `0026`；重建后 payload 与你的版本逐字节一致，其他文件不变。
  **绝不改 `~/Documents/GenericAgent` 本身，绝不手改 `managed-ga/code/` 当交付。**
- 不动 tgapp、飞书、微信前端；不动配对与访问控制；不改 `0023`（若确实绕不开，停下来在 Comments 说明）。
- 中文文案全角标点；不整文件格式化无关代码。

## 验证

- 新测试进 `runner/tests/test_managed_discord_dcapp.py`（reporter 部分进 `runner/tests/test_im_reporter.py`）：
  - 重启：旧进程留下激活 + 日志映射 → 新 app 启动后该频道不 @ 直接说话即进 agent，backend history 从日志续上（用真实格式的
    model_responses 样例）。
  - 旧格式激活文件（无日志字段）→ 仍激活、不提示、不续接。
  - 日志缺失 / 损坏 → 回答最前面多一行指定小字，只出现一次。
  - 锁：旧进程的锁文件 mtime 在 30 秒内但 pid 已死 → 仍能续接。
  - `/new` 之后映射指向新日志。
  - 驱逐：频道保持激活、无提示，下一条消息重建并续接；报告轮不会用到被关掉的 agent。
  - 文案：激活提示、退出回执、`/help` 末行逐字。
  - reporter：app 就绪后激活频道被挂上；持有的报告在用户不说话的情况下投递。
  - 现有测试里断言旧释放 / `RESTARTED_TEXT` / `RETIRED_TEXT` / 旧文案的，按新语义改。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check` 全绿；
  `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs` 绿。

## 回报

**不要 commit / add。** 只碰：`managed-ga/patches/0026-*.patch`（新）、`managed-ga/patches/manifest.md`、`managed-ga/manifest.json`、
`managed-ga/code/`（build 脚本产出）、`runner/im_reporter.py`、`runner/tests/test_managed_discord_dcapp.py`、`runner/tests/test_im_reporter.py`、
`docs/ga-baseline.md`、`scripts/check-ga-baseline-drift.mjs`（仅当必须）、本票面。完成后把本票 `Status:` 改成 `done`，写 Comments
（做了什么、偏差与理由、门禁实际输出、主会话要看的点），并回复同样内容的中文摘要。

## Comments

### 2026-09-30 · 实现完成（新补丁 `0026`，reporter 补做恢复）

**做了什么**

- 补丁流程：只读克隆到 scratchpad 的 `t06/ga-replay`，checkout `1b6442fe`；先用它重建一次，`git status managed-ga/code managed-ga/state-seed` 干净。另起只放 `frontends/dcapp.py` 的工作仓，以重建后的 dcapp（栈到 `0025`）为 base 改，按 `0023` 的配方导出：`git diff -U0 -- frontends/dcapp.py | grep -v '^index '`。`manifest.json` 加 `0026` 后重建：25 个补丁全部 clean，`py_compile` 通过，`managed-ga/code` 只有 `frontends/dcapp.py` 变，与我改好的版本逐字节一致（`cmp`），补丁文件与重新导出的结果也逐字节一致。
- dcapp（`0026`）：
  - 删掉启动释放（`_stale_channels` 分支）、`RESTARTED_TEXT`、`RETIRED_TEXT` 和随之无用的 `_notify_threadsafe`。30 天 TTL 不动。
  - 激活条目多一个 `log` 字段，只存 `model_responses_<logid>.txt` 的文件名，读回时按 `agent.log_path` 所在目录拼回；`_load_active_channels` 用正则校验，没有该字段的旧条目照常激活。`_touch_active_channel` 改为只更新 `last_seen`，不再整条覆盖，否则每条消息都会把映射冲掉（有测试钉住：run 进行到一半时映射仍在）。
  - 映射回写时机：每个 run 的 `finally`（完成、提问、停止、出错都算）、驱逐前、复制续接后。只在日志文件已存在时写：一个还没说过话的上下文没有可接的东西。
  - 续接：`_ChannelAgent` 加一个 prepare 步骤，在 agent 自己的 worker 线程里、开始处理任务之前执行 `_resume_channel`，结束后置 `ready`。期间到来的任务在队列里等，事件循环和 reporter 线程都不读文件；斜杠命令先等 `ready`（最多 20 秒），免得 `/new` 和续接互相踩。先 `continue_inplace(..., restore_wm=True)`；目标被别的活进程占着时退到 `continue_copy`，映射改指副本。
  - 锁：`session_occupant` 返回的持锁者如果 `agent_id` 以 `galley-discord:` 开头、pid 又不是本进程，就是上一个 dcapp 进程留下的。`supervisor.lock` 保证同一 state 目录只跑一个 dcapp，所以它一定已经退出。这种锁直接删掉（`continue_cmd._lock_path`）再原地续接，不等 30 秒。
  - 续接失败（映射存在，但日志缺失、为空或解析不了）时，用 `begin_fresh_session` 换到新日志，并在 GA agent 上标 `_galley_context_lost`。该频道下一个 run 的第一条收尾消息最前面加 `-# 之前的对话没接上，这是新的上下文`，回答和提问都算，长 narration 先发时加在最先发出的那条上，只加一次。报告轮、`/stop`、出错回执都不消耗它。没有映射就不提示。
  - 驱逐：不再取消激活，不再发通知，也不再触发 released hook。驱逐前回写映射，照旧 `_release_channel_ui` 并关闭 agent；关闭前在 GA agent 上标 `_galley_closed`，下一条消息或下一个报告轮经 `_get_agent` 重建并同样续接。
  - `/new`：先照旧 `_reset_conversation`（回执文字不变），再 `begin_fresh_session` 换新日志，清掉映射，也清掉待提示标记；下一个 run 结束后映射指向新日志。
  - `/continue N`：沿用 chatapp_common 的列表与回执（同一个 `list_sessions(exclude_pid=…)`，再 `reset_conversation` 加 `restore`），native 全量恢复后再 `continue_copy` 到该日志的副本，映射改指副本。裸 `/continue` 和越界序号仍直接交给上游处理。
  - 文案逐字：`ACTIVATED_TEXT`，一条退出回执 `EXITED_TEXT`（两组退出词共用），`DISCORD_HELP_TEXT` 末行。
- reporter（`runner/im_reporter.py`）：
  - `DiscordReporter.tick()` 在第一次拿到 app 时补做一次 `restore_active_channels()`，之后不再扫描。启动时那次调用保留，app 已存在时它照常生效。恢复时跳过已被 agent hook 挂上的频道，不把带 agent 的注册换成无 agent 的。
  - `DiscordChannel.agent()` 遇到标了 `_galley_closed` 的缓存 agent 时，改经 `app._get_agent` 取频道当前的 agent（没有就新建并续接）。
  - 三处注释里「restart 会让频道失活」的说法随之改掉。飞书和 Telegram 的代码路径没动。
- 测试：
  - `test_managed_discord_dcapp.py` 改用真实的 `continue_cmd`（只把 `install` 换成空函数；`GALLEY_GA_STATE_ROOT` 指向 tmp，并且在加载前设好）。FakeAgent 补了 `log_path`、`llmclient.backend.history` 和 `history`。样例日志按 `_write_llm_log` 的分帧和 NativeToolClient 的 Prompt、Response 写法手工生成，含一轮 tool_use 与 tool_result。
  - 新增 11 条，全部对应「验证」一节：重启后不 @ 直接续上（backend history 与工作记忆都从日志恢复，run 中途映射仍在）；旧格式条目；日志缺失、为空、损坏三种参数化，各只提示一次；提问同样带提示；已死进程 30 秒内的新鲜锁被接管；活的外部持锁者时走副本；`/new` 之后映射指向新日志，重启后续的是新日志；驱逐后频道保持激活、无提示、reporter 不用已关闭的 agent、下一条消息落在续上的 agent 上；两组退出词共用一条回执。另外 3 条旧断言按新文案改了。
  - `test_im_reporter.py` 新增 2 条：app 就绪后恢复路由，持有的报告在用户不说话时投递，只恢复一次，不覆盖 hook 已挂的频道；已关闭的 agent 绝不接报告轮。「持有」那条的 docstring 按新语义改了。
  - 变异检查（scratchpad 副本，没动仓库）：新测试在 `0026` 之前的 dcapp 上 13 条失败；再逐一去掉锁接管、关闭标记、`restore_wm`、touch 保留映射、提示清零，以及 reporter 的 tick 恢复、跳过已关闭 agent、跳过已注册频道，每个变体都有测试失败。
- 文档：
  - `managed-ga/patches/manifest.md`：新增 `0026` 行；`0018` 行注明启动释放和两条通知已被 `0026` 取代；Last replay 按本次改写，原段落挪成 Previous replay。
  - `managed-ga/manifest.json` 加 `0026`。
  - `docs/ga-baseline.md`：item 15 新增 `(f)`，写明新耦合；耦合地图 dcapp 条补上 `0026` 的入口；Step 8 Discord 真机清单加了「重启 Channels 后不 @ 直接说话，接得上」。
  - `check-ga-baseline-drift.mjs` 不校验补丁清单，没有改。

**偏差与自行裁量（附理由）**

1. 票面默认 `/new`、`/continue n`、`/restore` 会换日志，实际不会。IM 前端的 `reset_conversation` 和 `restore` 都不动 `agent.log_path`（`continue_cmd.py:475`、`:502`），只有 TUI 用 `begin_fresh_session`、`continue_inplace` 换日志。所以光在 run 结束时回写 `log_path`，`/new` 之后映射仍指旧日志，重启会把 `/new` 清掉的对话又接回来。做法是 `/new` 与 `/continue N` 显式换日志，见上。`/restore` 只往工作记忆追加摘要行，backend history 不动，频道日志仍然如实，所以不换；代价是重启后这几行摘要不在了（工作记忆从日志重新推导）。
2. 驱逐时没有让 reporter 换成无 agent 的通道，而是给被关掉的 agent 打 `_galley_closed` 标记，由 reporter 在取 agent 时跳过。要在驱逐时换通道，得给 launcher 加一个新 hook（`managed_im_supervisor.py`，不在我可碰的文件里）；标记也覆盖所有关闭路径，并且是在调度关闭之前同步打上的。效果与票面例子相同：之后经 `app._get_agent` 懒建。
3. 判断持锁者已死，依据的是 `agent_id` 前缀加 `supervisor.lock`，不查 pid 存活。Windows 上 `os.kill(pid, 0)` 会直接结束那个进程，不能拿来探活；而票面括号里给的依据本身就足以证明它已退出。删锁用的是私有的 `continue_cmd._lock_path`，已记入耦合。
4. `restore_wm=True`。backend history 越长越会被 `trim_messages_history` 裁掉（`llmcore.py:107`），被裁掉的早期上下文只靠工作记忆的 `<history>` / `<earlier_context>` 摘要（`ga.py:582`）带着；不重启时 `agent.history` 会跨任务一直保留这份摘要。False 会让续上的频道一裁剪就丢掉早期上下文，比不重启时差。上游 worldline TUI 续接时也传 True（`tuiapp_v2.py:5743`）。代价见「要看的点」。
5. 续接放在 worker 线程的 prepare 步骤里，而不是 `_get_agent` 同步执行或丢给 `to_thread`。这样任何先入队的任务（包括 reporter 直接 `put_task` 的报告轮）都排在续接之后，不需要别处加锁。`_ChannelAgent` 因此多了 `_work` 和 `ready`。
6. 没有只在 managed 模式下启用（`0018` 的释放当初是 managed-only）。文件配置模式下上游本来就跨重启保留激活，只是给一个空白 agent；续上上下文只会更好，少一个分支。Galley 也不跑这个模式。
7. 驱逐仍走 `_release_channel_ui`：这个频道在跑的 run 定格为已停止，待回答问题的按钮被去掉。问题本身在日志里，续上后打字回答照样接得上。只有同时活跃超过 12 个频道才会触发，没有为它另开保留待答问题的分支。
8. 等 `ready` 复用了 `AGENT_CLOSE_TIMEOUT_SECONDS`（20 秒），没新增常量。

**门禁实际输出**

- `.venv/bin/python -m pytest`：`422 passed, 6 deselected in 4.19s`（dcapp 与 reporter 两个模块单跑 `114 passed`）
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 26 source files`
- `.venv/bin/ruff check runner`：`All checks passed!`
- `git diff --check`：无输出，exit 0
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`，exit 0
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (1b6442fe)`，exit 0
- 额外只读核对：用 payload 里的 `continue_cmd.parse_native_log` 解析本机 managed state 最近 12 个真实 model_responses 日志，只打印计数、不打印内容，12 个全部解析为 native（10 到 52 条消息，工作记忆 7 到 27 行）。

**主会话要看的点**

- 没有 commit、add。我碰过的文件：`managed-ga/patches/0026-managed-discord-restart-continuity.patch`（新）、`managed-ga/patches/manifest.md`、`managed-ga/manifest.json`、`managed-ga/code/frontends/dcapp.py`（build 产出）、`runner/im_reporter.py`、`runner/tests/test_managed_discord_dcapp.py`、`runner/tests/test_im_reporter.py`、`docs/ga-baseline.md`、本票面（未跟踪，提交时一并带上）。工作树里另有 `.scratch/discord-ux/PRD.md`、`docs/design/`、`docs/devlog/deferred.md`、`gui/src/i18n/locales/*.ts` 的改动和未跟踪的 `.scratch/im-restart-continuity/`，都不是我改的。
- 真机要验：
  - 重启 Channels 后在已激活频道不 @ 直接说话，能接上之前的话，也没有激活提示。
  - 连续重启两次（间隔少于 30 秒）仍能接上，这就是锁接管那条路径。
  - 重启前派出的 session 在重启后跑完，报告卡片在没人说话时投到频道。
  - `/new` 之后重启，不应把旧对话接回来。
- 工作记忆会比不重启时大：`_derive_hist_info` 推导出的 `[USER]` 行不截断，含 FILE_HINT 和报告提示全文（最长约 2k 字），而进程内是截到 200 字。窗口仍是最后 30 行，真实日志推导出 7 到 27 行。要收紧只能改上游函数或在 dcapp 里截断，这次没做。
- 锁文件：续接过或 `/new` 过的日志会在 `model_responses/.locks/` 留一个小锁文件，dcapp 进程里多一个心跳线程。进程被杀时锁文件不删，下次重启走接管；Core 的 prune 只删 `model_responses_*.txt`，这些锁文件不会被清，每个日志一个，很小，与上游 TUI 相同。
- 小边角：续接失败后，如果新上下文里第一件事是报告轮而不是用户 run，映射要等下一次 run 结束或驱逐时才更新；这之前再重启一次，还会提示一次、报告轮的内容接不上。
- 设计文档、devlog、PRD 里关于「重启释放频道」「上下文已释放」的旧说法我没碰，归主会话。
