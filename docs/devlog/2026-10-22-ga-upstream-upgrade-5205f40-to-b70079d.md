# GA 上游升级 5205f40 -> b70079d

**日期**：2026-10-22
**上下文**：v0.7.0 发版前的例行审计（Upgrade Triggers 第一条）。10-18 审计的 `5205f40` 还没发版，
上游这几天又走了 11 个提交，最后一个是 10-21 晚上的 `b70079d`（`git ls-remote` 取得，ahead 11、behind 0）。
两段一起随 v0.7.0 发出。

## 范围形状

`5205f40..b70079d` 共 11 个提交、12 个文件，+702 / −315。按 SOP 先分类再读 diff：

- 引擎核心：只有 `ga.py` 一行（DSML 判定）。`agent_loop.py`、`agentmain.py`、`llmcore.py`、`pyproject.toml` 零 diff，
  `GA_DEPS` 不用动。
- 补丁触及的文件里，上游改了 `ga.py`（`0001`、`0003`、`0006` 都改它）和 `frontends/continue_cmd.py`（`0001`）两个。
- 上游前端：`desktop_bridge.py`（+180 / −40）、`desktop_history.py`（+38）、`hub.py`（+32 / −3）、`hub_p2p.py`（+2 / −1），
  加四个测试文件。都是上游桌面接入它自己的 Hub、手机会话。
- `memory/` 种子：`memory_management_sop.md` +1 行，`ui_detect.py` +5 / −3。

结论：两种模式都没有断点，Galley 代码和补丁一行不改。

## 引擎 delta：DSML 重试放宽

`7c79515`（10-21）把 `do_no_tool` 的判定从「回复以 `</｜DSML｜ calls>` 结尾」放宽为
「`rstrip` 后末 50 字里有 `</｜DSML｜`，且以 `>` 结尾」，命中就走 `_retry_or_exit` 重新生成（第三次退出，和以前一样）。
上一次升级记的 DSML 重试（`f7e4cc5`）只认一种闭合写法，这次补上 DeepSeek 漏出来的其他闭合标签。

Galley 没有耦合：`WorkbenchHandler` 只把 `no_tool` 经 `dispatch` 转给上游，runner、GUI、补丁里都不认这些字符串。
用打包 Python 对新旧两份 payload 各跑一遍 `do_no_tool`（不花额度）：

| 最终回复 | 旧 payload | 新 payload |
|---|---|---|
| 以 `</｜DSML｜ calls>` 结尾 | 重试 | 重试 |
| 以 `</｜DSML｜function_calls>` 结尾 | 当成答案 | 重试 |
| 内置回复以 `</next-suggestion>` 结尾 | 当成答案 | 当成答案 |
| DSML 漏出后面跟一段 `<next-suggestion>` | 当成答案 | 当成答案 |
| 普通回答 | 当成答案 | 当成答案 |

第四行是老缺口：内置提示词让回复以 `<next-suggestion>` 收尾时，漏出的标签被挤出 50 字窗口，重试照旧接不住。
没有新的误判；内置 DeepSeek 预设受益。

## `continue_cmd`：多了一个 Galley 不读的键

`4f5a928`（10-19）让 `extract_ui_messages_text` 给每条助手消息加 `turn_segs`（每轮一段），`content` 逐字不变。
调用方只有上游自己的界面：`stapp.py`、`tuiapp_v2.py`、`tui_v3.py`、`desktop_history.py`。

Galley 用到的 `continue_cmd` 逐个核对过（`runner/im_resume.py` 与 `runner/im_wechat.py`，契约第 15 条（f）、第 16 条）：
`session_occupant`、`_lock_path`、`continue_inplace` / `continue_copy`（带 `restore_wm`）、`begin_fresh_session`、
`list_sessions(exclude_pid=)`、`reset_conversation(agent, message=None)`、`restore`、`handle_frontend_command`，
以及 `.locks/` 下的锁文件，全部逐字节没变。这次改动不碰 `/continue` 的加载、锁和回复。

## 上游前端：桌面接 Hub、手机会话

`5b48e7b`、`e92ef58`、`4e8029f`、`84ec7d5`、`eaa2e6f`（10-18 至 10-19）：上游桌面把会话懒恢复进 GA（`desktop_history.restore_agent` /
`display_messages`）、不再自存 `llm_history`、每个会话 `hub.connect` 进 Hub，调度器和 conductor 改成只拉起不拥有的共享服务。
`326354b`、`e6b1bce`（10-20）：`hub_p2p` 对已配对但离线的手机不再超时；Hub 加了 `HubClient.close()`、回复后执行的延迟动作，
以及 `POST /api/sessions` 背后的 `phone_session()`（起一个轻量 GA 给手机用）。

这些文件随 payload 一起带上，但 Galley 的进程都不加载：IM supervisor 只 import `wechatapp`、`fsapp`、`tgapp`、`dcapp`（和它们的 helper），
bridge 不 import `desktop_bridge`（runner 里只在 `ga_session.py` 的注释里提到它）。`phone_session` 只能从 Hub 服务端（`python hub.py`）走到，
那要 `fastapi` / `uvicorn`，打包里没有。

- `hub.connect` 守卫多了一处：`desktop_bridge.py` 的 `make_agent`（`5b48e7b`），加上原来的 `agentmain.py --reflect`、`hub.py` 自身和 `stapp.py`，
  都不在 Galley 路径上。打包里有 `websockets`，所以守卫靠的是「Galley 不 import 这几个模块」，不是「连不上」。
- 契约第 12 条参照的 `_patch_chat_for_images` 逐字节没变（从 1034 行挪到 1108 行），`run()` 仍不读 `task["images"]`，
  `0008` 和外置模式的图片包装都保留。
- 产品信号：上游在做「手机经 P2P 连 Hub、开轻量会话」。和 Galley 的 iOS 远程方向同题，路线不同（上游是 Hub 中转 GA 实例，
  Galley 是桌面 Core 为唯一权威、端到端加密 relay）。只记一笔。

## 种子：一条新的 L0 规则怎么到达用户

`b70079d`（10-21）在 `memory_management_sop.md` 的核心公理后面加了一句：
「绝对禁止写入：非用户要求的模型固有臆想规定或限制，如“不准删除，需要备份，需要比对sha”等等」。

它走的是种子：`build-managed-ga.sh` 把上游 `memory/` 导到 `managed-ga/state-seed/memory/`（不进 `code/`），
Core 每次准备内置运行时（起 runner 或 IM 渠道之前，`prepare_managed_runtime_context`）都跑一遍 `ensure_memory_seed`，
只补缺失的文件（`core/src/managed_runtime.rs` `copy_missing_tree`，`!target_path.exists()` 才拷）。所以：

- **新装用户**：拿到新文件。
- **已有内置用户**：保留旧文件，升级不覆盖（宪法「Code is replaceable; user state is not」）。他们拿不到这条规则，除非重置主对话
  （`stage_memory_reset` 把 `memory/` 整个换回种子）或自己让模型改。
- **外置用户**：自己 `git pull` 时拿到，Galley 不碰。

查到达路径时顺带发现一个**早于本次范围**的问题：引擎在 `do_start_long_term_update` 里按**进程 cwd** 读 L0
（`./memory/memory_management_sop.md`，`0001` 没有改这一行）。各进程的 cwd：

- 桌面内置会话：Core 起 runner 时不给 cwd（`core/src/session_runner/spawn_config.rs`），bridge 落在状态根
  （`runner/workbench_bridge.py` `os.chdir(managed_state_root)`），读到的是用户自己的 L0。
- 微信：supervisor 停在状态根，同上。
- 飞书、Telegram、Discord：import 前端之后 `os.chdir(state_dir)` 进了渠道自己的状态目录（`runner/managed_im_supervisor.py`），
  那里没有 `memory/`。工具结果是「Memory Management SOP not found. Do not update memory.」，同一步的 next prompt 却仍要求提纯；
  模型还能顺着 L1 的指针（从 `temp/` 出发的 `../memory/…`）自己读到 L0。

用打包 Python 对重建后的 payload 复现过：cwd 在状态根时结果是 L0 全文、含新规则；cwd 在渠道状态目录时是上面那句。
外置模式 bridge 落在用户的 GA 目录，读用户自己的 L0，不受影响。

这一处本次不改（不属于上游 delta，改了会改变三个渠道写记忆的行为），留给 JC 裁：

- A. `0001` 加一行，把这个路径改成 `state_path('memory', 'memory_management_sop.md')`。只影响内置，外置零变化；
  三个渠道的提纯从此读得到 L0、不再被告知「不要更新记忆」，记忆写入可能变多。补丁一行，顺着 `0001` 本来的用途。
- B. IM supervisor 不再 `chdir(state_dir)`。动的是 runner；代码里没写这个 chdir 为什么在，前端有没有按相对路径往 cwd 写东西要另查，
  风险比 A 大。
- C. 不动。三个渠道一直是这样，没有用户报告。

推荐 A，作为单独的一张票，不混进这次基线提交。

## 种子：`ui_detect` 的 CUDA 开关

`b70079d` 把 RapidOCR 构造改成 `RapidOCR(det_use_cuda=True, rec_use_cuda=True, cls_use_cuda=True)`，注释说没有 CUDA 时回退 CPU。
它和上一节一样是种子文件，只到新装用户。

- 打包 Python（mac-x64，新建）里 `ui_detect` 本来就 import 不了，新旧版都一样：打包里没有 `numpy`（第 21 行 `import numpy`），
  也没有 `rapidocr_onnxruntime` / `onnxruntime`，`GA_DEPS` 里都不带。
- 在打包外单独装 `rapidocr-onnxruntime` 1.4.4 + `onnxruntime` 1.23.2（Intel Mac，无 CUDA）验证上游的说法：新构造不报错，
  日志里一条 WARNING 说 `CUDAExecutionProvider` 不可用、改用 `CoreMLExecutionProvider`，外加每个模型八行 INFO，OCR 正常出字。
  模型在 `code_run` 里用它时，这些日志会进工具输出，只是噪音。

## 补丁栈重放

审计时就预测不会漂移：`ga.py` 那行是一换一，所有补丁行号不动；`continue_cmd.py` 新增的三行在 `0001` 两个 hunk（第 5、12 行）下面。
所以直接 `build-managed-ga.sh <b70079d 干净克隆>`，没走 rebase 脚本：27 个补丁全部应用，`py_compile` 全量扫描通过，
`check-managed-ga-payload.mjs` 通过。

再做一次比对：重建后的 payload 相对上一份的 diff，与上游 `5205f40..b70079d` 的 diff 在 12 个文件里逐行相同
（`code/` 下 10 个、`state-seed/memory/` 下 2 个），没有补丁体挪位。补丁文件一个不改，也不用重新导出。
`deferred.md` 里挂在基线升级上的启动信号都没触发：`0023`、`0024`、`0026`、`0008` 没有冲突，`desktop_bridge` 没有放弃
`_patch_chat_for_images`，`llmcore.py` 零 diff。

## 验证

- runner（Python 3.11，按 CI 只装 `.[dev]`）：`GA_PATH=managed-ga/code pytest` 640 passed（6 deselected）；
  兼容矩阵 `GA_PATH=<b70079d 干净克隆> pytest runner/tests -m 'not e2e'` 640 passed；
  对照 `GA_PATH=<上一份 payload>` 也是 640 passed。`mypy runner`、`ruff check runner` 通过。
- 打包门禁：`pyproject.toml` 零 diff、依赖不变；`bundle-python.sh mac-x64` 新建 bundle，
  `check-bundled-python-managed-ga.sh` 对重建后的 payload：`managed GA import OK`。
- `check-ga-baseline-drift.mjs --write` 之后通过。
- 打包 Python 探针（都不花额度）：上面的 DSML 表、L0 按 cwd 的两种结果、`ui_detect` 的 import。
- 没有 Rust 改动，cargo 没跑：Core 用 `include_str!` 嵌入 `managed-ga/manifest.json`，这次只改了 `upstream` 块的值，没有代码或测试读这些值。

## SOP 第 8 步：待在 tauri dev 里走

本次没跑，合入后由 JC 在 dev 里走。重点是「上游前端没有被带进 Galley 路径」和上一次欠下的四个 IM 渠道重启检查：

1. 内置，桌面：用 DeepSeek 预设做一个多步任务（会调工具），流式、工具、最终回答里没有 `｜DSML｜` 原文。
2. 内置，桌面：用另一个模型做多步任务，回答带 `<next-suggestion>`；引擎日志里没有「Tool call format invalid」的重试提示（确认没误判）。
3. 内置，桌面：重启 runner 后接着聊，历史恢复、模型配置注入、状态写在 app data 下。
4. 外置：指向一份 `b70079d` 的干净克隆（不是自己日常用的 GA 目录），做多步任务：流式、思考状态、工具派发、模型显示；
   再带一张图片发一轮（契约第 12 条），并改一次推理强度（第 13 条）。
5. Discord（先退出已安装的 Galley，否则两个 bot 抢同一个 token）：多步请求（状态消息原地编辑，最后只剩答案，「过程」按钮只给点的人看步骤）、
   按钮回答 ask_user、长运行中 `/stop`（状态消息冻结成 `⏹ 已停止 · …`，之后没有别的消息）；「重启 Channels」后在已激活的频道不 `@` 说话，
   没有激活提示，接得上重启前的内容。
6. Telegram（同上）：私聊多步请求（静默状态消息原地编辑，最后只剩答案，「过程」按钮展开 / 收起）、按钮回答 ask_user、长步骤中 `/stop`；
   「重启 Channels」后问重启前说过的事，接得上。
7. 飞书（同上）：私聊多步请求（运行中只在你的消息上有 `Typing` 表情，最后一张卡片带折叠的「过程」，表情随之消失）、运行中再发一条
   （排队不拒绝，轮到时才有 `Typing`，各自回复各自的消息）、用数字回答 ask_user（问题卡片变成回显）、长步骤中 `/stop`
   （一条 `⏹ 已停止 · …`，之后没有答案）；说一件要记住的事，「重启 Channels」，再问，接得上。
8. 微信（同上）：多步请求（运行中只有「对方正在输入」，最后一条带 `N 步 · 用时 X` 的消息）、用数字回答 ask_user、长步骤中 `/stop`；
   说一件要记住的事，「重启 Channels」，再问，接得上；再发 `/new`，回复是「🆕 已开启新对话，当前上下文已清空」，下一轮不再知道，
   再重启一次也不知道。

## 起源纪律

本次没有「上游吸收了 Galley 能力」这类说法。11 个提交都出自 Liang Jiaqing（10-18 至 10-21）：
DSML 判定 `7c79515`，`turn_segs` `4f5a928`，L0 新规则与 OCR CUDA 开关 `b70079d`，桌面接 Hub `5b48e7b`，手机会话 `e6b1bce`。
上游没有动 `auto_make_url`，也还没有消费 `task["images"]`，`0027`、`0008` 都保留。L0 读路径那一行出自上游 `9bc79db`（2026-02-08），
与本次范围无关。
