# 01 微信对话处理器（runner 侧接管 `on_message`）

Status: done
PRD：[../PRD.md](../PRD.md)（先读「问题」「平台机制」「裁决」「形态」四节）
参照实现：`managed-ga/code/frontends/tgapp.py`（补丁 `0024`，run 列表、停止、ask_user、续跑计数的口径）、
`managed-ga/code/frontends/galley_im_display.py`（共享规则，直接导入）、`runner/im_resume.py`（续接）

## 做什么

新增 Galley 自有模块 `runner/im_wechat.py`，`_run_wechat`（`runner/managed_im_supervisor.py`）把它的 `on_message` 交给
`bot.run_loop`，**不再调用上游 `wechatapp.on_message`**。上游模块其余照用：`wechatapp.agent`、`WxBotClient`
（`send_text` / `get_typing_ticket` / `send_typing` / `send_image` / `send_file` / `send_video` / `extract_text`）、`_dl_media`、`_TEMP_DIR`。
**不改任何 `managed-ga/` 文件、不加补丁。**

修 PRD 问题 1–9（A + B + C）。02 并行做完成汇报，本票提供它要的接口（见「给 02 的接口」）。

## 入站

- 文字 = 各 `ITEM_TEXT` 的文字（同 `extract_text`）。
- **语音**：`voice_item.text` 非空 → 当作文字（与文字项按 item 顺序拼接），**不下载**该语音；转写为空的语音才走 `_dl_media`（上游行为）。
- 图片 / 文件 / 视频：`wechatapp._dl_media`，`[用户发送文件: <path>]` 行追加在文字后（上游语义不变）。
- 文字与媒体都没有 → 忽略（上游同）。
- 每条用户消息：记下发送者 `from_user_id` 为 owner（见接口），内存里记最近的 `context_token`。
- 日志沿用上游口径 `[WX] 收到: <前 80 字>`（`file=sys.__stdout__` 那套不必照抄，打到当前 stdout 即渠道日志）。

## 命令（整条消息 strip 后精确匹配）

- `/switch`、`/help`、`/status`：现有 `_managed_wechat_on_message` 的回复照旧（常量可留在 supervisor 或挪进新模块，测试跟着改）。
- `/llm`、`/llm n`：与上游 `wechatapp.on_message` 的 `/llm` 分支逐字同文案（`LLMs:` 列表、`切换到 [n] …`、`用法: /llm <0-k>`）。
- `/stop`、`/abort`：见「停止」。
- `/new`：在跑的 run 先按 `/stop` 停（发停止回执），再 `continue_cmd.reset_conversation(agent)`（上游回执 `🆕 已开启新对话，当前上下文已清空`）；
  有 `resume` 时同时 `resume.fresh(agent)`（今天 `im_resume.wechat_new_conversation` 的语义）。清掉待答提问与续跑计数。排队的 run 照跑（新上下文里）。
- 其余以 `/` 开头的消息：照上游，作为任务原样入队（不加 FILE_HINT）。

## run（一条用户消息 = 一个 run）

- 普通消息入队：`agent.put_task(prompt, source="wechat")`，`prompt` 同上游（非 `/` 开头时前缀
  `If you need to show files to user, use [FILE:filepath] in your response.\n\n`）。
- **按序的 run 列表**（同 tgapp `_RUNS`）：登记顺序 = GA 任务队列顺序。**只有列表头读自己的 display queue**，保证前一个 run 的回答 / 提问先落地。
  线程模型自定（上游是每条消息一个线程、`run_loop` 在轮询线程同步调 `on_message`；`on_message` 不得阻塞轮询）。
- **没有超时**：删掉上游 `dq.get(timeout=300)` 的「超时即完成」；等 `done` 为止（可以带短超时轮询，用来响应停止 / 刷新输入中）。
- 运行中**不发任何过程消息**（PRD 裁决 2）。删掉上游 9 条上限、`6 * mi` 间隔、`_task_aborted`。
- 步计数与用时：同 tgapp `run.observe` 口径（出现 turn > k 的 item 才算步 k 落定；用时从该 run 的第一个 item 起算，排队时间不算）。

### 输入中

- 只要还有 run（排队或在跑）就保持「对方正在输入」：`get_typing_ticket(uid, ctx)` 一次，之后每 ~2 秒 `send_typing`（上游节奏）。
- 最后一个 run 落定（回答、提问、停止回执发出）时 **`send_typing(uid, ticket, cancel=True)`**——探针证实取消立即消失。
  取消要在发最后那条消息**之前或紧随其后**（实现自定，真机看哪个不闪）。ticket 拿不到时静默跳过输入中。

## 回答

- 正文 = `galley_im_display.answer_body(final_step_text(done, outputs), done)`（收尾那一步，GA 追加在 `done` 尾部的后端错误块也算它的；
  `strip_transcript` 已去掉 Turn 标记、🛠️ 回显、`<summary>`、`<thinking>`、next-suggestion 等——逐项核对 `chatapp_common.clean_reply`
  覆盖了 `<goal-status>`、`<next-suggestion>`，没覆盖就补在本模块）。
- **`[FILE:path]` → 文件名**：在清洗**之前**把标记渲染成 `os.path.basename(path)`（tgapp `_render_file_markers` 的口径与原因：
  `strip_files` 会整个删掉标记）。文件照上游逻辑在文字之后另发（`bad` 占位集、`media_paths` 排除、按扩展名选 `send_image` / `send_video` / `send_file`、
  相对路径拼 `_TEMP_DIR`），文件发送失败只记日志。
- **Markdown 不再改写**（探针：微信全部渲染）：不删 `1.`、不剥链接、不截代码块、不改列表符号。只删图片语法 `![…](…)`（官方插件同样删除）。
  不调用上游 `_strip_md` / `_clean`。
- **末行**：步数 ≥ 2 时正文后空一行接 `fold_label(steps, seconds)`（`3 步 · 用时 42 秒`）；1 步不挂。去掉 `[任务已完成]`。
- **分段**：单条 ≤ 4000 字（官方 `textChunkLimit`），在段落 / 换行处切，尽量不切进代码块（切进去时补关 / 补开围栏）；末行跟在最后一段。
  不截断、不丢字。每段一次 `send_text`（上游每次生成新 `client_id`，**不要复用**——探针：同 `client_id` 的后续消息被丢弃）。
- 正文为空（只有工具调用、没有可见文字）：与 tgapp 空回答口径一致（读 tgapp `answer_text` / `_send_answer`），
  做法写进 Comments。
- **续接提示**：`resume.take_notice()` 非空时作为该聊天下一条回答 / 提问的首行（今天 `WechatNoticeBot` 做的事，直接在本模块做；
  命令回执与停止回执不带）。发送失败 `restore_notice()`。

## ask_user

- 捕获：注册 `agent._turn_end_hooks`，用 `galley_im_display.extract_ask_user_event`；**按 display queue 认领**（hook 触发时记
  `agent._current_queue`，只交给拥有该 queue 的 run；reporter 报告轮的事件没人认领就丢弃）。hook 在 GA 线程里调，交接线程安全。
  与 `im_resume` 已注册的 turn-end hook 共存（不同 key）。
- run 以 ask_user 结束时发**一条**提问消息，不发回答：

```
<该步旁白（answer_body 清洗后，非空才有）>
<问题>                       ← 保留单换行
1. 候选一                    ← 有候选时逐条编号（不分 row / list，微信没有按钮）
2. 候选二

⏸ 等你回复 · 已完成 N 步      ← 末行；有候选时 `⏸ 回复序号或文字 · 已完成 N 步`；多选（MULTI_SELECT_RE）`⏸ 可多选，回复序号或文字 · 已完成 N 步`
```

- 保存续跑计数（步数、用时），同 tgapp：下一条普通文本消息（非命令）就是回答，起续跑 run，步号接着编，回答末行与停止回执的 `N 步 · 用时 X`
  是各段之和（等待回答的时间不计）。图片 / 文件消息不算回答。
- **单选 + 回复是范围内的纯整数**（全角数字也认）→ 交给 GA 的是该候选全文（= 桌面点 chip）；其余（多选、文字、越界数字）原样交给 GA。
- `/new` 清掉待答提问与续跑计数。

## 停止

- 「正在跑的 run」= 列表头、已出过 item、`agent.is_running` 且 `agent._current_queue is run.dq`（tgapp `_running_run`，避免误停报告轮或下一个任务）。
- `/stop`：有正在跑的 run → 在任何阻塞调用之前同步标记它 stopped，`agent.abort()`，**当下**发 `galley_im_display.stopped_text(steps, seconds)`
  （`⏹ 已停止 · N 步 · 用时 X`）；它之后到来的 `done` 不发回答。排队的 run 照跑。没有 → 回 `当前没有在跑的任务`（tgapp `_NO_RUNNING_TASK_TEXT`）。
  只回一条。
- 不再有「空闲 `/stop` 留标记误伤下一条」（问题 5）。

## 给 02 的接口（契约，02 并行按此写）

模块 `runner/im_wechat.py` 提供 `WechatConversation`（名字可改，改了在 Comments 写明），`_run_wechat` 创建一个实例，
02 的 `start_wechat_reporter(conversation, state_dir)` 拿它：

- `conversation.agent` → GA agent（`wechatapp.agent`）
- `conversation.connected() -> bool`：`run_loop` 已开始轮询（登录完成）后为真
- `conversation.owner_id() -> str | None`：最近一个发消息的用户 id；**持久化**在 `state_dir / "wechat_owner.json"`（`{"userId": "<id>"}`，只存 id，
  原子写；进程启动时读回，所以重启后没人说话也能汇报）
- `conversation.busy() -> bool`：run 列表非空（排队或在跑）或 `agent.is_running`
- `conversation.send_text(user_id: str, text: str) -> None`：按本票的 4000 字分段发出（带内存里最近的 `context_token`，没有就不带——探针证实可达）；
  **失败必须抛异常**（不吞）；不加末行、不处理 `[FILE:]`、不带续接提示
- 02 在 `_run_wechat` 里的接线：本票在 `run_loop` 开始前加
  `im_reporter.start_wechat_reporter(conversation, state_dir)`，包在 try / except 里打日志、失败不拖垮渠道（同 telegram 的写法）；
  02 未合入前该函数不存在，except 兜住即可。

## 清理

- `runner/im_resume.py`：`WechatNoticeBot`、`WECHAT_STOPPED_TAG`、`WECHAT_TEXT_LIMIT`、`wechat_new_conversation` 不再需要——删除或改成新模块用的形态；
  模块头注释与 `docs/ga-baseline.md` Contract Surface item 16 的相关描述交给主会话改（本票在 Comments 列出要改的点）。
- `runner/managed_im_supervisor.py`：`_managed_wechat_on_message` 并入新模块或改为委托；`WECHAT_MANAGED_MODE` 与 `/switch` 拦截保留
  （上游 `_MODE` 仍要钉住：别的代码路径可能读它）。

## 测试（runner/tests/，新文件 `test_managed_wechat.py`，必要时改 `test_managed_im_supervisor.py` / `test_im_resume.py`）

用 stub `WxBotClient` + stub agent（`put_task` 返回可控 queue，模拟 `next` / `done` item、`_turn_end_hooks`、`abort`、`is_running`、
`_current_queue`），覆盖至少：

1. 3 步 run → 只发一条回答，内容只有收尾那一步，末行 `3 步 · 用时 …`，无 `[任务已完成]`、无 `<summary>`、无 🛠️ 回显。
2. 1 步 run → 无末行。
3. 单步 6 分钟（模拟时钟或绕开超时）后完成 → 照常发回答（问题 4 回归）。
4. 空闲 `/stop` → `当前没有在跑的任务`；之后一个正常 run 的回答不带停止字样（问题 5 回归）。
5. 运行中 `/stop` → 立即一条停止回执，之后的 `done` 不发回答；排队的下一个 run 照常回答。
6. 9000 字回答 → 按 ≤ 4000 分 3 段，开头不丢、末行在最后一段（问题 6 回归）；代码块不被切坏。
7. `[FILE:/abs/x.png]` → 正文显示 `x.png`，文件另发；占位 `[FILE:filepath]` 不发文件。
8. Markdown 原样：`1.` 列表、`[文字](url)`、表格不被改写；`![a](b)` 被删。
9. ask_user（带候选）→ 一条提问消息含问题、编号候选、`⏸ 回复序号或文字 · 已完成 N 步`；回复 `2` → GA 收到候选二全文；续跑 run 的末行步数累加。
   无候选 ask_user → 只有问题和 `⏸ 等你回复 · …`。多选回复 `1 3` 原样交给 GA。
10. 报告轮（另一个 queue）期间的 ask_user 事件不被用户 run 认领。
11. 语音 `voice_item.text="继续"` → GA 收到「继续」，`_dl_media` 未被调用；转写为空的语音仍走 `_dl_media`。
12. 输入中：run 期间发送、最后一个 run 落定后发 `cancel=True`；有两个排队 run 时第一个落定不取消。
13. `/new` 运行中 → 先停止回执再 `🆕` 回执；有 resume 时调用 `fresh`。
14. 续接提示：只在下一条回答 / 提问首行出现一次；停止回执、命令回执不带。
15. owner：收到消息后 `wechat_owner.json` 写入；新实例读回；`send_text` 失败抛异常；`busy()` 三态。
16. 每次 `send_text` 的 `client_id` 不同（若测试走真实 `WxBotClient.send_text` 的 body）。

## 验证

```bash
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
git diff --check
```

不提交（主会话审码后统一提交）；不碰 `managed-ga/`、`core/`、`gui/`、`docs/`（文档主会话写）。

## Comments

### 2026-10-10 实现记录（01 子代理）

落地：新增 `runner/im_wechat.py`（`WechatConversation`，类名未改）与 `runner/tests/test_managed_wechat.py`（31 条）；`_run_wechat` 改为
`conversation.run()`；`im_resume.py` 的 `WechatNoticeBot`、`WECHAT_STOPPED_TAG`、`WECHAT_TEXT_LIMIT`、`wechat_new_conversation` 已删；
`_managed_wechat_on_message`、`_wechat_status_reply` 并入新模块。

**自定的做法**

1. **线程**：轮询线程只做解析、命令、登记 run，`/stop` `/new` 的停止回执也在这里当场发。一个 worker 线程按需启动（登记 run 时），
   没有 run 且输入中已撤下就退出；它只读列表头的 display queue（每 0.5 秒醒一次看停止），也负责输入中的刷新与取消，不另开输入中线程。
   停止的 run 在回执发出前仍留在列表里（`_head()` 跳过它），所以取消输入中一定在回执之后。
2. **输入中取消在最后那条消息（及其文件）发出之后**，即「紧随其后」，真机看闪不闪再定。
3. **`connected()`**：新增 `run()` 包住 `bot.run_loop(self.on_message)`，进入时为真、退出时为假；`_run_wechat` 调它。
4. **`context_token`**：所有发送（回答、提问、回执、命令回复、输入中 ticket、reporter 的 `send_text`）都带该用户最近一条消息的 token，
   而不是触发那条的（上游用触发那条）；没有就不带。
5. **owner**：只在 id 变化时写，tmp + `os.replace` 原子写；写失败记日志，下一条消息重试。
6. **空正文**：有文件时「已生成附件」（同 tgapp；但标记已渲染成文件名，实际几乎走不到），否则 ≥ 2 步只发末行，1 步发 `...`（同 tgapp 无头时的兜底）。
7. **分段**：`split_message`（公开）。在至少填满三分之一的切点里依次偏好：代码块外的空行 > 代码块外的行尾 > 代码块内的行尾（补关 / 按原开栏行补开）；
   都不够就取最晚能放下的切点，单行超长则行内硬切。续接提示与末行的空间在每段都预留。4000 按 Python 字符（码点）计，不按 UTF-16。
8. **续接提示自成一段**（`notice\n\n正文`），提问里旁白与问题之间也空一行：微信按 Markdown 渲染，单换行接在列表 / 表格后会被并进上一块。
   TG 是单换行，这里是有意分叉。
9. **ask_user 认领时机**：在认领 `done` 时（加锁）就记下待答提问，再发提问消息，快速回复不会落空。一条普通文本消息，若该用户前面没有
   别的待认领 run，登记时就认领并把序号映射成候选全文；否则到它成为列表头时再认领（提问发出前就已排队的消息，在 GA 看来也是回答，同 tgapp），
   这种情况序号不映射。图片 / 文件消息既不算回答也不清掉待答提问；转写出文字的语音算文字。
10. **`/new`** 清掉所有用户的待答提问（单 agent）；已认领续跑计数、仍在排队的 run 保留计数（同 tgapp）。
11. **出错**：`put_task` 抛错或 worker 内异常，发一条 `❌ 出错：{error}`（tgapp `_fail_run` 的措辞，不带步数）；已停止的 run 不再发。
12. **发送失败**：回答 / 提问 / 回执某段发不出就记日志、不再发后续段（首段带续接提示时 `restore_notice()`），文件照常尝试。
13. `_dl_media` 仍在轮询线程同步调用（上游如此）；只传没被当成文字的条目，没有就不调用。`agent.inc_out` 保持上游默认，只读 `turn` / `outputs`。
14. `/llm` 判定为首词恰好是 `/llm`（上游是 `startswith('/llm')`，`/llmfoo` 现在是任务）；回复文案逐字照上游。

**与票面的偏离**

- 提问旁白用 `visible_text`（`answer_body` 同一套清洗，但不带它对整段 transcript 的回退），同 tgapp `_finish_run`。按票面用 `answer_body`
  的话，提问那一步没写旁白时会把前几步的文字或最后一个 `<summary>` 塞进提问消息。
- `send_text(user_id, text)` 文本为空时抛 `ValueError`（契约只说失败要抛；静默返回会被 reporter 记成已送达）。

**主会话两条集成意见（已并入）**

- iLink 业务错误：`_check_sent` 检查每次 `send_text` 与发文件的返回，`ret` 不是 `None` / `0` 或 `errcode` 为真即抛 `WechatSendError`；
  `send_text`（reporter 契约）向外抛，普通回答 / 回执 / 文件只记日志。测试覆盖 `ret=-2`、`errcode=-14`、HTTP 异常。
- `/continue`、`/continue N` 改在本模块当命令处理：有续接时走 `resume.continue_session`（日志映射随之迁移，同 TG / 飞书），否则走
  `continue_cmd.handle_frontend_command`。在跑的 run 在那次 `abort` 里同步标记停止（临时包一层 `agent.abort`，同 tgapp `_call_noting_abort`），
  回执先于命令回复；中止过就清掉待答提问。未加入 `HELP_COMMANDS`。剩余缺口：`/btw` 仍是 GA 斜杠命令走任务队列，会排在在跑的任务后面，
  起不到「插问」的作用（与票无关，未处理）。

**其他**

- `chatapp_common.clean_reply` 的 `TAG_PATS` 已含 `goal-status`、`next-suggestion`，本模块未补。
- 导入 `galley_im_display` 会带入 `chatapp_common`，GA 类因此装上 `/continue` `/btw` `/review`（与其他渠道一致）。
- `answer_text(raw)`（公开纯函数）：按 Turn 标记取收尾一步、清洗、`[FILE:]` 显示文件名、删图片语法、不带末行。02 的 `wechat_answer_text` 待主会话去重。
- 测试：新文件 31 条；`test_im_resume.py` 的微信部分按新模块重写（续接提示，即票面第 14 条，在这里对真实 `ChannelResume` 测）；
  `test_managed_im_supervisor.py` 的启动测试改为验证新会话、reporter 接线，`/help` `/status` 测试并入新文件。
  测试辅助 `load_display` / `load_wechatapp` 放在 `test_managed_wechat.py`，另两个测试文件引用。

**交给主会话改的文档点**

- `docs/ga-baseline.md` item 16 的（c）：删去 wechatapp `on_message(bot, msg)`、`_handle`、`[已停止]`、`_task_aborted` 那段，改为 WeChat 的续接提示与
  `/new` `/continue` 在 `runner/im_wechat.py`。
- 同文件 Contract Surface 的 `runner/im_resume.py` 条：去掉 `WechatNoticeBot`、`wechat_new_conversation` 与「WeChat `on_message` wrapper」；
  新增 `runner/im_wechat.py` 一条，耦合点见其模块 docstring（`WxBotClient` 的 `send_text` / `get_typing_ticket` / `send_typing` / `send_*` /
  `run_loop` 回调签名、`_dl_media`、`_TEMP_DIR`、`ITEM_TEXT`、`voice_item.text`、iLink 返回体的 `ret` / `errcode`、`galley_im_display` 各函数、
  `continue_cmd.reset_conversation` / `handle_frontend_command`、`agent._current_queue` / `_turn_end_hooks`）。
- `runner/im_resume.py` 模块头注释仍准确（微信照旧用 `ChannelResume`），可补一句微信的续接提示在 `runner/im_wechat.py`。
- Step 8 的微信手测（`/new` 回执）仍成立。
