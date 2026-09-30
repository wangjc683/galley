# 01 状态消息：live 窗口 → 回答首行小字

Status: done
Blocked by: —
PRD：[../PRD.md](../PRD.md)（先读「原则」「对表」两节，形态以它为准）

## 做什么

重写 `frontends/dcapp.py` 的 `DiscordApp.run_agent` 展示层：删掉「思考中...」「⏳ 还在处理中」「步骤N：」三类独立消息，
换成**每个 run 一条状态消息**，原地编辑；run 结束时删掉状态消息，把折叠头作为回答消息的首行小字。
顺带修 PRD 问题 3（排队误导 + 运行登记被错 pop），并加一个给 03 用的严格发送 seam `deliver_embed`。

交付物是**新补丁** `managed-ga/patches/0023-managed-discord-conversation-ux.patch`（02 接着往同一补丁里加）。

## 行为规格

### 状态消息的生命周期

1. 收到要跑的消息（普通文本、`/review`、ask_user 的回答）→ 在该频道发状态消息，**以 reply 挂在触发它的消息下**
   （`reference=原消息, mention_author=False`，`fail_if_not_exists=False`）。
2. 同频道已有 run 在跑或排队 → 状态消息内容为 `·· 排队中`，不起 typing。
3. 该 run 的任务真正开始（它的 display queue 出第一个 item）→ 进入运行态，起 typing，开始计时。
4. 运行态内容（三行，按条件出现）：
   ```
   已完成 {N} 步          ← N = 已落定步数，仅 N ≥ 2 时出现（桌面：第一步折进去时才出现）
   {NN} {summary}         ← 最后一个落定步：两位补零序号 + 摘要；N = 0 时无此行
   ·· 思考中[ · 已 {M} 分钟 · 仍在运行]   ← 当前步已跑 ≥ 60 秒才追加，M 按分钟更新
   ```
   序号与步数都含 ask_user 续跑的累加（见下「ask_user 续跑」）。
5. 终态：
   - **完成**：先发回答（见下），再删状态消息。删除失败则把状态消息编辑成 `-# ✓ 已完成` 兜底，不能留着「思考中」。
   - **停止**（`/stop`，02 会加按钮）：状态消息**不删**，编辑为 `⏹ 已停止 · {N} 步 · 用时 {X}`，去掉按钮。
   - **异常**：删状态消息，发新消息 `-# {N} 步 · 用时 {X}` + 换行 + `❌ 出错：{e}`（新消息才会推送，失败要让人知道）。
   - **ask_user 暂停**：交给 02；01 至少保证此时状态消息被删、typing 停、计数被保存以供续跑。

### 步的落定与摘要

- 频道 agent 是 `verbose=False`、`inc_out=False`：`next` item 是**累积全文**，带 `turn`（当前步号）；每步以
  `LLM Running (Turn k) ...` 标记开头，LLM 整段完成后才出正文（含 `<summary>`），再出一行 `🛠️ tool(args)` 回显。
  见 `agentmain.py:218-231`、`agent_loop.py:50-79`。
- **步 k 落定 = 出现 turn > k 的 item**（与桌面 turn_end 口径一致：工具跑完才算落定）。最终 `done` 让最后一步落定。
- 摘要取法（按序回退）：该步文本里**最后一个** `<summary>` → 该步正文（去掉标签、🛠️ 行、工具输出后）首个非空行 →
  「调用了{工具中文名}」（`code_run` 运行代码、`file_read` 读取文件、`file_write` 写入文件、`file_patch` 修改文件、
  `web_scan` 读取网页、`web_execute_js` 执行网页脚本，其余用原名）→ 空（只显示序号）。空白压成单空格，截 120 字。

### 回答消息

- 首行 `-# {N} 步 · 用时 {X}`，下接正文；文件附件照旧另发（`[FILE:]` 仍从整份 raw 里提取，别丢文件）。
- **正文只取最后一步**：`done` item 的 `outputs` 是逐步文本，`raw` 是全部步的累积全文——现状 `_display_done_text(raw)`
  会把每一步的中间旁白（「我先查一下会话列表」）一起拼进回答。桌面端回答 = 收尾那一步（`finalAnswer`），中间旁白属于过程区。
  改为对 `outputs[-1]` 做同样的清洗；清洗后为空再回退到现有的 `_display_done_text(raw)`。
  - `N` = 本 run 总步数（含最终回答那一步，含 ask_user 续跑累加）；1 步也显示（PRD 裁决）。
  - `X`：`< 60 秒` →「用时 S 秒」；否则「用时 M 分 S 秒」；四舍五入到秒，`< 1 秒` 时整段省略（只剩 `-# N 步`）。
    与桌面 `RunFoldHeader.formatDuration` 同口径。用时 = 任务开始（非入队）到 done 的墙钟，ask_user 各段相加、等待回答的时间不计。
- 切分：小字行只在第一段；沿用 `_split_discord_text`（fence 感知）。
- **引用规则**：发回答时若频道最后一条消息不是本 run 的状态消息（中间插进了别的消息），回答以 reply 引用触发消息
  （`mention_author=False`）；否则不引用。可用 `channel.last_message_id`。

### 编辑节流与 typing

- 两次编辑间隔 ≥ 1.5 秒，合并中间状态、终态前必 flush；discord.py 自带 429 退避，但不要依赖它。
- typing 用 `channel.typing()`（2.x 是会自我续期的 async context manager），放后台 task，终态 / 暂停 / 停止时取消。

### 运行登记（修问题 3）

- `self.user_tasks[chat_id]` 目前是单个 dict，被第二个 run 覆盖、又被第一个 run 的 `finally` 误 pop。改为**该频道的活动 run 列表**
  （或等价结构）：只移除自己；`/stop` 只停正在跑的那个（队首），不动排队的。
- **耦合点，别破坏**：`runner/im_reporter.py` `DiscordChannel.busy()` 读 `app.user_tasks.get(chat_id)` 的真值来判断忙闲——
  频道有任何 run（跑或排队）时它必须为真，没有时为假/缺席。`_deactivate_channel` / `_retire_agent` 目前把
  `state["running"] = False`，改后要对该频道所有 run 生效。

### seam：`deliver_embed`（给 03 用，接口定死）

```python
async def deliver_embed(self, chat_id, *, title, description, color=None, footer=None):
    """Strict send of one embed for programmatic callers (the completion reporter):
    raises on resolve/send failure like deliver_text. Truncates title to 256 and
    footer to 2048 chars; raises ValueError when description exceeds 4096 —
    splitting long reports is the caller's job."""
```
`color` 是 int（`0xRRGGBB`）或 None。放在 `deliver_text` 旁边。

## 约束

- **不要直接改 `managed-ga/code/` 当交付**。流程见 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Add A Patch」：
  1. `git clone --quiet ~/Documents/GenericAgent <scratchpad>/ga-replay` 后 checkout `managed-ga/manifest.json` 里的 upstream commit。
     **只读克隆，不要碰 `~/Documents/GenericAgent` 本身**（那是 JC 的工作副本，有未跟踪文件）。
  2. 先用 `scripts/build-managed-ga.sh <clone>` 重建一次，确认 `git status managed-ga/code` 干净（基线可复现）。
  3. 在副本或 payload 上迭代都行，但最终交付 = zero-context 补丁（`git diff -U0` 形态，路径 `a/frontends/dcapp.py`，参考 0018 的头）+
     `manifest.json` `patchStack.patches` 追加 + `patches/manifest.md` 加一行（reason / touched files / rebase risk / removal condition，
     rebase risk 注明「依赖 0018 在前」）+ 用 build 脚本重建后 payload 与你的版本逐字节一致。
- 文案按上面规格逐字；中文全角标点。
- 与上游 upstream 语义的差异只在展示层：访问控制、激活、配对、关闭协议一律不动。
- 保持 dcapp 现有写法（模块级函数 + `DiscordApp` 方法、`print("[Discord] …")` 日志、只记 metadata 不记正文）。

## 验证

- 新增 `runner/tests/test_managed_discord_dcapp.py`，照 `runner/tests/test_managed_feishu_fsapp.py` 的方式从 `managed-ga/code` 导入 dcapp，
  用 stub 替掉 `discord` / `agentmain` / `llmcore` 等重依赖；用假 agent（按上面的 item 形态往 display queue 喂数据）+ 假 channel（记录 send / edit / delete）覆盖：
  单步直答、多步（N≥2 出现「已完成 N 步」）、摘要三级回退、排队、停止、异常、完成时删除失败兜底、引用规则、登记不被错 pop、
  `deliver_embed` 截断与 ValueError。时间用可注入的 clock，别真 sleep。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner` 全绿（`.venv` 已建好）。
- `python3 -m py_compile managed-ga/code/frontends/dcapp.py`；`/Applications/Galley.app/Contents/Resources/python/bin/python3`
  带 discord.py 2.7.1，可用它核对你用到的 discord API 签名（只读使用）。
- `node scripts/check-managed-ga-payload.mjs` 绿。

## Comments

### 2026-09-30 · 实现完成（01 + 02 同一补丁 `0023`，同一 agent）

**做了什么**

- 新补丁 `managed-ga/patches/0023-managed-discord-conversation-ux.patch`，只动 `frontends/dcapp.py`。两本账已记：`managed-ga/manifest.json` 的 `patchStack.patches` 追加一项；`managed-ga/patches/manifest.md` 加一行（rebase risk 注明依赖 `0018` 在前），并更新「Last replay verified」。payload `managed-ga/code/frontends/dcapp.py` 由 build 脚本重建产出。
- 状态消息按规格实现：reply 挂在触发消息下；排队、运行、完成即删、停止定格、异常删后另发、ask 暂停即删；三行渲染与分钟行；摘要三级回退；回答只取最后一步，首行 `-# N 步 · 用时 X`；引用规则；1.5 秒编辑节流；typing 放后台 task。
- 运行登记：`user_tasks[chat_id]` 改为该频道按序排列的 run 列表，每个 run 只移除自己。`_deactivate_channel` / `_retire_agent` 对该频道所有 run 生效；两者经 `_on_loop` 回到事件循环线程执行，因为 `_retire_agent` 可能从 reporter 线程经 `_get_agent` 进来。
- `deliver_embed` 按定死的接口实现，放在 `deliver_text` 旁边。

**偏差与自行裁量（附理由）**

1. 排队判定多一条：频道里没有别的 run、但 agent 正在跑（`ga.is_running`，即 reporter 直接 `put_task` 的报告轮）时，也显示 `·· 排队中`。用户的任务此时确实在 GA 队列里等。
2. 排队的 run 等自己成为队首才开始读 display queue（GA 本来就按序执行，item 在队列里攒着不会丢）。这样前一个 run 的回答、提问、状态编辑一定先落地；前一个 run 以 ask_user 结束时，后一个 run 开始时能看到待答提问并接上计数。代价：排队 run 的计时起点比 GA 实际开始晚，差值是前一个 run 发回答、删状态消息的耗时，通常不到 1 秒。
3. 「终态前必 flush」解读为：终态写入（停止定格、删除失败兜底）不受节流限制。完成时状态消息要被删掉，被节流压住的中间态直接丢弃，不再多编辑一次。
4. 回答正文取 `outputs[-1]` 时，把 `done` 超出逐步文本拼接的那段尾巴也算进最后一步。GA 后端异常分支只把错误代码块追加在 `done` 全文上（`agentmain.py` `run()` 的 except 分支），不补上的话错误信息会从回答里消失。
5. `deliver_embed` 在接口之内多一道护栏：Discord 还限制单个 embed 的文本总长为 6000，超出时截 footer（title 256 加 description 4096 之后，footer 只剩 1648）。`ValueError` 在解析频道之前就抛。
6. 删状态消息失败时的兜底文案，规格只给了完成态的 `-# ✓ 已完成`；暂停用 `-# ⏸ 等你回复`，异常用 `-# ❌ 出错`。
7. 文件发送从 `send_done` 抽成 `_send_files` 共用，`send_done` 行为不变（`run_agent` 已不再调用它，保留作 mixin 接口）。

**验证（全部通过）**

- `bash scripts/build-managed-ga.sh <scratchpad>/ga-replay`（`~/Documents/GenericAgent` 的只读克隆，checkout `1b6442f`）：改动前重建一次，`git status managed-ga/code` 干净；加入 `0023` 后重建，22 个补丁全部 clean apply，编译扫描通过，重建出的 `dcapp.py` 与作者版本 `cmp` 逐字节一致（收尾时再重建一次，结果相同）。
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`。
- `python3 -m py_compile managed-ga/code/frontends/dcapp.py`：系统 python3 与 Galley.app 自带的 3.11 各跑一次，均通过。
- `.venv/bin/python -m pytest`：341 passed，6 deselected。新增 `runner/tests/test_managed_discord_dcapp.py` 共 32 条，单独连跑 8 次均稳定通过。
- `.venv/bin/python -m mypy runner`：Success；`.venv/bin/ruff check runner`：All checks passed；`git diff --check`：干净。
- 用 Galley.app 自带的 discord.py 2.7.1 核对了用到的签名：`View(timeout=)`、`Button(style=, label=, custom_id=)`、`Message.to_reference(fail_if_not_exists=)`、`Messageable.send(reference=, mention_author=, view=, embed=)`、`Message.edit(content=, view=)`、`Message.delete()`、`InteractionResponse.edit_message` / `defer`、`Messageable.typing()`（`__aenter__` 起一个每 5 秒续发的 task）、`Embed(title=, description=, color=)` / `set_footer(text=)`。另实测：`stop()` 过的 View 照常序列化出 5×5 按钮，且不进 ViewStore。

**集成方（04）需要看的**

- `runner/im_reporter.py` 的 `DiscordChannel.busy()`：频道有 run（在跑或排队）时 `app.user_tasks.get(chat_id)` 是非空列表，没有时键不存在，口径保持不变。但**待答提问期间没有 run**，busy 为假，reporter 可以在「提问」与「回答」之间插入报告轮，GA 视角下报告 prompt 就成了对 ask_user 的回答。要不要让 busy 同时看 `chat_id in app._pending_asks`，由 03 / 04 决定（本票不碰 reporter）。
- 报告轮直接调 `agent.put_task`，不进 `user_tasks`：此时用户发消息会显示 `·· 排队中`（见偏差 1）；`/stop` 回「当前没有在跑的任务」，且**不再 abort 报告轮**（旧行为是 abort 任何在跑的任务）。报告轮里若模型调了 ask_user，hook 按 display queue 认出那不是用户 run 的任务，不会发提问消息。
- 真机要看：停止或暂停后 typing 指示可能还挂几秒（Discord 没有「停止输入」API，最长约 10 秒，bot 发出新消息即消失）。
- file-based（非 managed）私信：discord.py 不从网关更新 `DMChannel.last_message_id`，引用规则在私信里会总是引用触发消息。managed 模式私信不处理对话，不受影响。
