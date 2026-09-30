# 01 飞书 / Telegram / 微信重启后接回上下文

Status: done
Blocked by: —（Discord `0026` 已提交于 `2cc2a328`，真机通过）
PRD：[../PRD.md](../PRD.md)；模板：[Discord 06](../../discord-ux/issues/06-restart-continuity.md) 的票面与 Comments（锁接管、`restore_wm`、
`/new` 不换日志等坑都在那里）

## 目标行为（三个渠道一致，逐项对齐 Discord `0026`）

1. **启动续接**：渠道进程启动时，若有上次记下的日志文件名且文件存在，用上游 `continue_cmd` 把那段对话接回这个渠道唯一的 agent
   （`continue_inplace` 优先，`restore_wm=True`；锁若是上一个本渠道进程留下的就接管，不等 30 秒；被别的活进程占着才退 `continue_copy`）。
   必须在 reporter 启动与前端 `main()` 之前完成（飞书是懒建 agent，见下），保证第一条用户消息和第一个报告轮都跑在接回的上下文里。
2. **映射**：每个渠道的 state 目录（`managed-ga-state/im/<platform>/`）里存「当前日志文件名」，**只存文件名，不存对话内容**；
   日志文件真实存在后才写（每轮结束时回写即可）；续接成功、换日志后同步更新。
3. **接不上**（有映射，但日志缺失 / 为空 / 解析失败 / 锁与复制都不行）：换新日志；下一条回答（或提问）最前面一行
   `之前的对话没接上，这是新的上下文`，只一次。Telegram 用斜体（tgapp 转换器认单星号 `*…*`，见 Telegram devlog），飞书 / 微信纯文本一行。
   若某渠道做不到「同一条消息的首行」，退而在那条回答之前单发一条短消息——在 Comments 写明是哪个渠道、为什么。**不在启动时主动推送。**
   没有映射（从没说过话、首次升级）不提示。
4. **`/new` 换新日志**：清上下文后 `begin_fresh_session` 换新日志并清掉映射，保证 `/new` 之后重启不会把旧对话接回来。
   Telegram 的 `/new` 在 `0024` 里先停掉正在跑的 run，换日志接在那之后。
5. **`/continue n`**：恢复成功后挪到该日志的副本上并更新映射（同 dcapp `_continue_session`）；若某渠道这样做要付出不成比例的代价，可接受
   「`/continue n` 后到下一轮结束前重启会接回旧上下文」这个小缝，Comments 写明。
6. **微信补 `/new`**：微信前端没有 `/new`（`wechatapp.py` `on_message` 只认 `/switch` `/stop` `/llm`），加一个：行为同 4，回执用上游
   `reset_conversation` 的默认文案（`🆕 已开启新对话，当前上下文已清空`）。正在跑的任务怎么处理，读 `on_message` 的 `/stop` 分支与
   `_task_aborted` 后决定，与 `/stop` 语义一致即可。

## 架构偏好

- **优先 supervisor 侧（`runner/`，Galley 自有代码）**：微信先例（`docs/devlog/2026-09-08-wechat-conductor-mode-dead-path.md`：
  「supervisor 侧已有同类 poke 手法，多一个 patch 只增加 rebase 面」）。可用的现成缝：
  - 续接：`runner/managed_im_supervisor.py` 的 `_run_telegram` / `_run_wechat` 在 `main()` 前对模块级 `tgapp.agent` / `wechatapp.agent`
    做；飞书已有 supervisor 侧的 `_managed_get_agent` 包装（`managed_im_supervisor.py:366-378`），首次建 agent 时在其中做（此时没有任务
    入队，run 线程只在等队列）。
  - 映射回写：`agent._turn_end_hooks`（Galley 已有的缝）。
  - `/new`、`/continue n`：前端按模块全局名调用（`tgapp.reset_conversation` / `tgapp.handle_frontend_command`；飞书经 mixin 调
    `chatapp_common._reset_conversation` / `_handle_continue_frontend`，调用时查模块全局），supervisor 侧替换这些名字即可包一层。
    注意 dcapp 也 import 了 `chatapp_common` 的这两个名字（`from chatapp_common import …` 在 import 时绑定，替换模块属性不影响 dcapp，
    且 Discord 进程不跑飞书的 supervisor 分支）——核实后在 Comments 写一句。
  - 微信 `/new`：supervisor 侧已有的 `on_message` 包装（拦 `/switch` 的那一层）。
- 续接逻辑抽成一个 Galley 自有的共享模块（例如 `runner/im_resume.py`），三个渠道共用；它调用 managed GA 的 `continue_cmd`（runner 已经
  import 各前端模块，方向不变）。dcapp `0026` 保留自己那份（managed GA 代码不能反向 import `runner`），Comments 里点名两份逻辑的对应关系。
- **只有 supervisor 侧确实做不到的**（最可能是第 3 条「回答首行」的注入点），才加新补丁 `0027-managed-im-restart-continuity.patch`
  （排在 `0026` 之后；不要重导出 `0024`）。每一处 poke / 包装 / 补丁 hunk 都是耦合点，记进 `docs/ga-baseline.md`。

## 连带文档（你负责）

- `docs/ga-baseline.md`：Contract Surface / 耦合地图补新耦合（被替换的模块全局名、`_turn_end_hooks` 用法、`continue_cmd` 的续接与锁函数、
  模块级 agent 名）；Step 8 三个渠道的真机清单各加一条「重启 Channels 后接得上之前的话」，微信再加「`/new` 生效」。
- 若加了补丁：`managed-ga/patches/manifest.md` 新行 + Last replay、`managed-ga/manifest.json` 的 `patchStack`。
- 本票面末尾写 `## Comments`。
- 主会话负责：devlog、`project-status.md`、设计文档、deferred、GUI 命令参考表（微信卡片若列命令，由主会话补 `/new`）。

## 约束

- 若动补丁：流程同 Discord 05 / 06（只读克隆 `~/Documents/GenericAgent` 到 scratchpad 你自己的子目录、checkout
  `1b6442fe4f97d87a3d9d52d76569f69d156af853`、先重建确认干净、导出 zero-context、重建后逐字节一致）。**绝不改 `~/Documents/GenericAgent`，
  绝不手改 `managed-ga/code/` 当交付。**
- 不动 dcapp / `0023` / `0026`；不动配对与访问控制；飞书 / Telegram 的报告投递语义不变（reporter 的 seam 签名不变）。
- 中文文案全角标点；不整文件格式化无关代码。

## 验证

- 测试进 `runner/tests/`（supervisor 侧用 `test_managed_im_supervisor.py` 的现有模拟前端风格；续接用真实 `continue_cmd` 与真实格式的
  model_responses 样例，照 `test_managed_discord_dcapp.py` 里 `0026` 的做法）。每个渠道至少：
  - 有映射 → 启动后 agent 的 backend history 从日志续上；reporter / `main()` 之前完成。
  - 旧状态（无映射）→ 不续接、不提示。
  - 日志缺失 / 损坏 → 下一条回答首行（或前置短消息）提示一次。
  - 上一进程留下的新鲜锁 → 仍能续接。
  - `/new` 之后映射清掉、换了新日志。
  - 每轮结束映射回写。
  - 微信 `/new` 回执与行为；`/switch` 拦截照旧。
  - 现有 tgapp / 飞书 / 微信 / reporter 测试全绿（`test_reporter_through_real_tgapp_seams` 必须保持通过）。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check` 全绿；
  `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs` 绿。

## 回报

**不要 commit / add。** 只碰：`runner/`（含新模块与测试）、`docs/ga-baseline.md`、本票面；若加补丁再加 `managed-ga/patches/0027-*.patch`、
`managed-ga/patches/manifest.md`、`managed-ga/manifest.json`、`managed-ga/code/`（build 产出）。完成后把本票 `Status:` 改成 `done`，写 Comments
（做了什么、每个渠道用的是哪条缝、偏差与理由、门禁实际输出、主会话要看的点、真机要验的点），并回复同样内容的中文摘要。

## Comments

### 2026-09-30 · 实现完成（全在 supervisor 侧，没有加补丁 `0027`）

**做了什么**

- 新模块 `runner/im_resume.py`（三个渠道共用）：
  - `ChannelResume` 管一个单 agent 渠道的对话生命周期。渠道 state 目录里新增 `context_log.json`，内容只有 `{"log": "model_responses_<logid>.txt"}` 这一个文件名，不存任何对话内容（宪法第 4 条）。写入用临时文件加 `os.replace`，`/new` 时删除。读回时用 dcapp 同款正则校验文件名，不合法、读不了或不是对象都当作没有映射。
  - `resume`：有映射就按 `agent.log_path` 所在目录拼回路径。持锁者的 agent_id 是本渠道的 `galley-<platform>` 且 pid 不是本进程时，锁是上一个本渠道进程留下的（`supervisor.lock` 保证一个 state 目录只跑一个进程），直接删掉再续，不等 30 秒。先 `continue_inplace(..., restore_wm=True)`，被别的活进程占着时退到 `continue_copy`，映射改指副本。接不上（缺失、为空、解析失败、锁与复制都不行）就 `begin_fresh_session` 换新日志，并记一个待提示标记。没有映射不续接、不提示。
  - `record`：挂在 `agent._turn_end_hooks["galley_im_resume"]` 上，每个 LLM 轮结束时，日志文件已存在才回写映射，名字没变不写盘。`agent_loop.py:59` 的 `client.chat` 先由 llmcore 把 Prompt、Response 写进日志（`llmcore.py:1493`、`:1499`），之后 `agent_loop.py:101` 才调 `turn_end_callback`，其最后一步调 hooks（`ga.py:622`），所以 hook 触发时这一轮一定已在盘上。
  - `fresh`（`/new`）：在前端自己的 reset 之后 `begin_fresh_session`，清掉映射和待提示标记。映射等新日志里说过话再写，所以 `/new` 之后重启不会接回旧对话。
  - `continue_session`（`/continue N`）：列表与回执同上游（`list_sessions(exclude_pid=os.getpid())`，再 `reset_conversation` 加 `restore`），native 全量恢复后 `continue_copy` 到该日志的副本，并立即回写映射。裸 `/continue`、越界、非数字都交回上游原函数。
  - `take_notice` 与 `restore_notice`：提示只给一次；带提示的那条消息发送抛异常时还回去，下一条再带。
  - 与 dcapp `0026` 的对应（managed GA 代码不能反向 import `runner`，所以 dcapp 保留自己那份）：`resume` 对应 `_resume_channel`，`record` 对应 `_record_channel_log`，`fresh` 对应 `/new` 分支，`continue_session` 对应 `_continue_session`，`take_notice` 对应 `_take_context_lost_notice`。模块 docstring 里也写了这张对照。
- `runner/managed_im_supervisor.py`：新增 `_start_resume`，出任何错只打日志、渠道照常跑（重启后照旧是空上下文），与 reporter 的「增强不能拖垮渠道」同一原则。三个 `_run_*` 的接线见下一节。
- 测试 `runner/tests/test_im_resume.py`，39 条，全部用 payload 里真实的 `continue_cmd` 和 dcapp `0026` 测试里同款 native 格式日志样例（直接 import `native_log` / `SAMPLE_TURNS`）：
  - `ChannelResume` 本身：原地续上并恢复工作记忆；四种无效映射都不续不提示；缺失、为空、损坏三种都换新日志并只提示一次（含 `restore_notice`）；上一进程留下的新鲜锁被接管；活的外部持锁者走副本且不碰其锁；轮末回写（日志存在前不写，文件里只有文件名）；`/new` 换日志并清映射，之后无话时重启不续不提示，说话后重启续的是新日志；`/new` 清掉待提示；`/continue N` 挪到副本并回写。
  - 启动接线：三个渠道各一条，按「有映射、上一进程的新鲜锁、无映射、日志缺失」四种场景参数化，用 `test_managed_im_supervisor.py` 的假前端风格跑真实的 `_run_*`。Telegram 断言 reporter 启动时和 `main()` 里看到的 backend history 已是续上的；飞书断言 reporter 启动和 `main()` 时 agent 还没建，四个线程并发首次 `get_agent` 拿到同一个已续上的 agent，prompt 只装一次；微信断言 `agent.run` 线程和 `run_loop` 看到的是续上的历史，`/switch` 仍被拦，`/new` 回执与行为正确，同步命令回复不带提示。每条都验证轮末回写和 `/new`。
  - 真实前端 payload：Telegram（复用 tgapp 测试的桩与 FakeBot）验证回答首行斜体提示只一次、Markdown 被拒时纯文本同样带提示、首段没有余量时提示单发在前、提问首行带提示、`/stop` 回执、前端出错回执和 reporter 的 render 都不消耗提示、`/new` 与 `/continue 1` 走真实 `handle_command`。飞书（真实 `chatapp_common` 挂在 `frontends.chatapp_common` 名下）验证卡片回答首行提示只一次、`fail` 的卡片不消耗、`/new` 与 `/continue 1` 走真实 `AgentChatMixin.handle_command`。微信（桩掉 requests / qrcode / Crypto）验证 run 的第一条消息带提示只一次、`/llm` 回复不带、`[已停止]` 那条不带、到 3000 字截断线时提示单发在前、`/new` 在有任务在跑时让那条任务以 `[已停止]` 收尾。
  - 变异检查（scratchpad 副本 `im-resume/mut/`，没动仓库）：33 个变体 32 个被测试抓到。唯一没抓到的是去掉 Telegram 布防作用域里的 `pop`，它与 `take_notice` 的「只一次」语义重复，属于防御性写法，行为上不可区分。
- `docs/ga-baseline.md`：Contract Surface 新增 item 16（单 agent 渠道重启续接：沿用 item 15 `(f)` 的日志契约，另列 `(a)` 各前端的模块级 agent 名与飞书的 `get_agent` 包装、`(b)` `_turn_end_hooks` 触发时这一轮已落盘、`(c)` 被替换的模块全局名、`(d)` 上游 IM 的 `/new`、`/continue N` 仍不换日志）；耦合地图加 `runner/im_resume.py` 条目；Step 8 的 Telegram 条补「重启 Channels 后接得上」，新增飞书、微信两条，微信再加 `/new` 生效。
- 实数据只读核对：用 payload 的 `continue_cmd.parse_native_log` 解析本机 managed state 最近 12 个真实日志，只打印计数，12 个全部是 native（4 到 52 条消息，工作记忆 3 到 27 行）。

**每个渠道用的缝**

| | 启动续接 | 映射回写 | 接不上的提示 | `/new` | `/continue N` |
|---|---|---|---|---|---|
| 飞书 | `_run_feishu` 的 `_managed_get_agent` 包装：首次建 agent 时加锁，装完 prompt 就续接，调用方拿到 agent 之前完成（此时没有任务入队）。`get_app` 和 reporter 的 `FeishuChannel.agent()` 都经过它 | `_turn_end_hooks` | 把 `fsapp._TaskCard` 换成子类，`done(text)` 在回答（或提问）首行加一行纯文本。报告轮不建卡片，停止、超时、出错走 `fail`，都不消耗 | 替换 `frontends.chatapp_common._reset_conversation` | 替换 `frontends.chatapp_common._handle_continue_frontend` |
| Telegram | `_run_telegram` 在装完 prompt 之后、reporter 启动与 `tgapp.main()` 之前对 `tgapp.agent` 做 | `_turn_end_hooks` | 包 `_send_answer`、`_post_ask`（布防），再包 `_reply_markdown`、`_reply`（在布防作用域里发出的第一条消息首行加斜体 `_…_`，纯文本回退加同一行不带样式）。布防用 ContextVar，按 asyncio task 隔离，别的 run 的回执拿不到 | 替换 `tgapp.reset_conversation`（`0024` 已先把正在跑的 run 定格为已停止，换日志接在其后） | 替换 `tgapp.handle_frontend_command`（直接调用和经 `_call_noting_abort` 调用都走它） |
| 微信 | `_run_wechat` 在装完 prompt 之后、`agent.run` 线程与 `run_loop` 之前对 `wechatapp.agent` 做 | `_turn_end_hooks` | `_managed_wechat_on_message` 把 `WechatNoticeBot` 递给上游 `on_message`，它包 `send_text`：从 `_handle` 工作线程发出的第一条消息首行加一行纯文本 | 同一个 `on_message` 包装拦截 `/new` | 不适用，见偏差 5 |

dcapp 的核实：dcapp 用 `from chatapp_common import (… _handle_continue_frontend, _reset_conversation …)`（`dcapp.py:11-16`）在 import 时绑定，而且绑的是顶层 `chatapp_common`；fsapp 用的是 `from frontends.chatapp_common import`（`fsapp.py:82`），两者是不同的模块对象。替换的是 `AgentChatMixin.__module__` 指向的那个模块（即 `frontends.chatapp_common`）的属性，影响不到 dcapp；Discord 进程也不跑 `_run_feishu`。

**偏差与自行裁量（附理由）**

1. 没有加补丁 `0027`。三个渠道的五件事在 supervisor 侧都有现成的模块全局名可包，包括最可能需要补丁的「回答首行」注入点。代价是多了一批耦合点，都记进了 item 16。
2. Telegram 的斜体是在 `_reply_markdown` 这一层直接写 MarkdownV2 的 `_…_`，不是在 Markdown 源里写 `*…*` 再过转换器。注入点拿到的已经是转换后的文本，效果相同。
3. 放不下时单发（票面允许的退路），只在边界上出现：Telegram 首段加上提示会超过 4096 时，提示作为一条短消息先发，再发原来那条；微信同理，以上游 `_handle` 自己的 3000 字截断为预算。平常的回答都是同一条消息的首行。
4. 飞书的提示加在卡片回答区（分隔线下的 `final`）的首行，不在卡片顶部状态行「✅ 已完成」上方。`done(text)` 拿到的就是回答，状态行是卡片自己的。
5. 微信没有 `/continue`。wechatapp 不 import `chatapp_common`，`continue_cmd.install` 在微信进程里从未执行，`/continue 2` 会作为普通文本交给模型。所以第 5 条对微信不适用，也没有为它新增命令（不在票面范围）。
6. 微信 `/new` 遇到正在跑的任务：先在 `_task_aborted[uid]` 记上，再走上游 `reset_conversation`（它会 abort），所以那条任务以 `[已停止]` 收尾，与 `/stop` 一致；排队中的任务在新上下文里照跑。与 `/stop` 的一处不同：只在 `agent.is_running` 时才记标记。上游 `/stop` 无条件记，空闲时发 `/stop` 会让下一条任务被错标为 `[已停止]`；`/new` 不复制这个问题。顺序上 🆕 回执先到，那条任务的 `[已停止]` 消息由 `_handle` 线程稍后发出（Telegram 是停止回执在前），可接受。
7. 微信「哪条消息算回答」按线程判定：只有从 `_handle` 工作线程发出的 `send_text` 才可能带提示，`on_message` 调用线程上的同步回复（`/llm`）不带；结尾是 `[已停止]` 的那条也不带。run 的第一条消息可能是中间某一步的文字，也就是这次回答的开头。
8. 映射回写挂在轮末 hook 上，报告轮也会触发。与 dcapp 的边角正好相反：续接失败后如果先来的是报告轮，映射已指向新日志，报告内容能接上；但待提示标记只在内存里，这时再重启一次，这条提示就丢了。概率很低，没有为它把标记落盘。
9. 飞书的续接跑在第一个调用 `get_agent` 的线程里，通常是 lark 长连接的事件处理线程（上游在同一线程里同步下载图片），会阻塞它一次文件读取加解析的时间。本机真实日志 4 KiB 到 315 KiB，毫秒到百毫秒级。票面指定的就是这条缝，没有另起线程。
10. 与 dcapp 一致的几处：`restore_wm=True`（理由见 Discord 06 的偏差 4）；无映射的新上下文不抢出生锁；`/restore` 不换日志；`/new` 与正在跑的任务之间有一个窄竞态，飞行中那一轮的 Response 可能落进新日志（`_retarget_log` 与 llmcore 写日志之间），没有处理。

**门禁实际输出**

- `.venv/bin/python -m pytest`：`461 passed, 6 deselected in 4.92s`（基线 422，新增 39；`test_im_resume.py` 单跑 `39 passed`；`test_reporter_through_real_tgapp_seams` 仍通过）
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 28 source files`
- `.venv/bin/ruff check runner`：`All checks passed!`
- `git diff --check`：无输出，exit 0（两个新文件另用 `git diff --no-index --check` 核对，同样无输出）
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`，exit 0
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (1b6442fe)`，exit 0
- `managed-ga/code` 下没有新写出的 `__pycache__` 或 `.pyc`。

**主会话要看的点**

- 没有 commit、add。我碰过的文件：`runner/im_resume.py`（新）、`runner/managed_im_supervisor.py`、`runner/tests/test_im_resume.py`（新）、`docs/ga-baseline.md`、本票面（未跟踪目录，提交时一并带上）。工作树里另有 `.scratch/im-restart-continuity/PRD.md`、`docs/devlog/deferred.md`、`gui/src/i18n/locales/*.ts` 的改动，不是我改的。
- 裁决点：映射在「断开连接」后还在。Core 断开时只删 token 或配置（`core/src/im_supervisor/manager.rs:371-382`），不删 state 目录，微信 `--relogin` 也不动它。所以断开后换一个账号或 bot 重新连上，会接回上一个账号的对话。Discord 的 `discord_active_channels.json` 也是这个性质。要改的话最小做法是 Core 断开时删掉 `context_log.json`（Rust，不在我可碰的范围），或者微信 relogin 时由 supervisor 清掉映射。
- 微信卡片如果列了命令，需要补 `/new`（票面归主会话）；devlog、`project-status.md`、设计文档也归主会话。
- `test_im_resume.py` 从四个现有测试模块 import 了辅助件（tgapp 与飞书的桩、dcapp 的日志样例、supervisor 测试的 `_args`）。这些辅助件改名时，它会在 import 阶段失败，不会静默跳过。
- 顺带看到的上游问题（没改）：微信 `/stop` 无条件记 `_task_aborted`（偏差 6）；微信 `/continue` 不是命令（偏差 5）。

**真机要验的点**

- 三个渠道各一遍：先说一句要记住的话，点「重启 Channels」，再问它，回答要接得上。对应的渠道日志（`feishu.log`、`telegram.log`、`wechat.log`）里应出现 `[galley-im-resume] resumed from model_responses_…txt`。飞书重启后第一条消息会先跑续接，可能稍慢一点。
- 30 秒内连续重启两次仍能接上，这是锁接管那条路径。
- `/new` 之后回执正常，下一条回答不再记得；再重启一次，仍不应把旧对话接回来。微信重点验 `/new`：回执是 `🆕 已开启新对话，当前上下文已清空`；任务在跑时发 `/new`，那条任务以 `[已停止]` 收尾。
- 接不上的提示在真机上很难自然触发。可以手动把某渠道 `managed-ga-state/im/<platform>/context_log.json` 里的文件名改成不存在的名字再重启：下一条回答的首行应是「之前的对话没接上，这是新的上下文」（Telegram 斜体，飞书在卡片回答区首行，微信是第一条消息首行），再下一条就没有了。
- Telegram、飞书各验一次重启前派出的 session 在重启后跑完：报告照常投递，之后问起能接上。
