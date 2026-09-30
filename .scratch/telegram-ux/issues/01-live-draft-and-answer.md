# 01 草稿 live 窗口、单条回答、Markdown 保真、共享文件

Status: done
Blocked by: —
PRD：[../PRD.md](../PRD.md)（先读「平台机制」「裁决」「形态」三节，形态以它为准）
母本：Discord 的同类实现在 `managed-ga/code/frontends/dcapp.py`（补丁 `0023`），票面
`.scratch/discord-ux/issues/01-run-status-message.md` / `02-ask-user-stop-commands.md` 连同其 Comments（实现偏差）值得先读——
本票大量照搬它的口径，差异只在 Telegram 的机制。

## 做什么

重写 `frontends/tgapp.py` 的展示层：删掉「每步一条正式消息 + `LLM Running` 标题 + 摘要引用 + 🛠️ 回显」，换成
**每个 run 一个草稿 live 面 + 结束时一条回答**；回答里的 Markdown 表格 / 标题转换成 Telegram 能渲染的形态；
平台无关逻辑放进补丁新增的共享文件。交付物是**新补丁** `managed-ga/patches/0024-managed-telegram-conversation-ux.patch`
（02 接着往同一补丁里加）。

## 机制前提（已核实，别再推导）

- 频道 agent：`agent.verbose = False`（`runner/managed_im_supervisor.py` `_run_telegram` 也会再设一次）、`agent.inc_out = True`
  （`tgapp.py` 顶部）。display queue item 形态见 `managed-ga/code/agentmain.py:217-235`：`next` 是**增量**文本，带 `turn`（当前步号）与
  `outputs`（`turn_resps[-2:]`，即 [上一步全文，当前步全文]）；`done` 带全量 `done` 文本、`turn`、`outputs`（全部步）；
  GA 后端异常时错误代码块只追加在 `done` 全文尾部。每步以 `\nLLM Running (Turn k) ...\n\n` 开头，
  `verbose=False` 时 LLM 整段完成后一次吐出正文（含 `<summary>`），再出 `🛠️ tool(args)\n` 回显（`agent_loop.py:50-79`）。
- **步 k 落定 = 出现 turn > k 的 item**（与桌面 turn_end、Discord 同口径），最终 `done` 让最后一步落定。
- Galley 自带 PTB 22.8 / Bot API 10.0：`/Applications/Galley.app/Contents/Resources/python/bin/python3` 可 import `telegram`
  核对签名（只读使用）。`Message.reply_text_draft(draft_id, text, parse_mode=...)` / `Bot.send_message_draft(chat_id, draft_id, text=...)`：
  私聊专用临时预览，30 秒不刷新即消失，`text` 允许 0 字符，**不能带 reply_markup**。上游 `_TelegramStreamSession._send_draft`
  已有草稿失败回退与 RetryAfter 处理可参考。

## 共享文件 `frontends/galley_im_display.py`（补丁新增）

Galley 自有、平台无关的 IM run 展示函数。语义**照 dcapp 里 0023 的同名函数原样搬**（dcapp 本轮不改、保留自己的副本），
公开名去掉前导下划线：

- `format_elapsed` / `fold_label` / `stopped_text`（dcapp `_format_elapsed` 等，桌面 `RunFoldHeader.formatDuration` 口径）
- `step_summary`（三级回退：最后一个 `<summary>` → 可见正文首个非空行 → 「调用了{工具中文名}」，含 `TOOL_LABELS`；截 120 字）
- `strip_transcript` / `final_step_text(raw, outputs)` / `answer_body(step_text, raw)`（dcapp `_strip_discord_transcript` 等）
- `candidate_list` / `extract_ask_user_event(ctx)`（含同问题拆分候选合并）/ `candidate_layout`（桌面 `candidateLayout` 同阈值）/ `MULTI_SELECT_RE`
- `one_line` / `clip`
- **新增** `live_elapsed(seconds)`：桌面 TurnMarker 读秒口径（`docs/design/conversation.md:415-421`）——`< 3` 秒返回 `""`；
  `3–59` 秒返回 `"{S} 秒"`；`≥ 60` 秒返回 `"已 {M} 分 {S} 秒 · 仍在运行"`。取整到秒（向下取整即可，读秒不需要四舍五入）。
- **新增** `tables_to_lists(text)`：把 GFM 表格改写成列表（代码围栏内不动），规则见下「Markdown 保真」。

导入方式与 `chatapp_common` 一致（tgapp 用 `from chatapp_common import …` 的同一种路径）。模块 docstring 写明：Galley 自有、
由补丁 `0024` 新增；dcapp 暂留自己的副本，迁移条件见 devlog（`0023` 在栈里排在前面，迁移要先把本文件拆成独立补丁排到 `0023` 前）。

## 行为规格

### live 面（每个聊天同一时刻最多一个）

- 私聊：草稿（`reply_text_draft`，纯文本不带 parse_mode），每个 run 一个 `draft_id`。
- 非私聊，或草稿调用失败（非 RetryAfter 的异常）：回退为**静音状态消息**——`reply_text(..., disable_notification=True)`，原地编辑，
  编辑间隔 ≥ 1.5 秒，读秒刷新节奏 5 秒；run 结束时删除（删除失败则编辑成 `✓ 已完成` 兜底）。
- 内容（纯文本，按条件出现）：
  ```
  已完成 {N} 步                ← N = 已落定步数（含 ask 续跑累加），仅 N ≥ 2
  {NN} {summary}               ← 最后一个落定步：两位补零序号 + step_summary；N = 0 时无此行
  ·· 思考中[ · {live_elapsed}]  ← 当前步已跑的时间；步落定时归零
  另有 {K} 条消息排队中         ← 同一聊天里排在后面的 run 数，K ≥ 1 才出现
  ```
  run 已登记但它的 display queue 还没出第一个 item（GA 在跑别的任务，含 reporter 的报告轮）时，第三行是
  `·· 排队中[ · {S} 秒 | · 已 {M} 分 {S} 秒]`（从入队起算，不带「仍在运行」）。
- 刷新：草稿每 2 秒按当前时间重渲染一次，**文本有变化才发**；另外无论有无变化每 20 秒至少发一次（30 秒过期的保活——
  读秒从 3 秒起每次都在变，这条主要兜底排队 / 刚开始的空窗）。RetryAfter 照上游方式退避。
- run 以任何方式结束（回答、停止、异常、ask 暂停）都会发一条正式消息，草稿随之被取代。正式消息发出后，对该 `draft_id`
  **尽力**发一次空文本草稿清掉残影（异常吞掉只打日志）——这一步是否必要 / 是否有副作用由真机判断，做成一个模块常量开关
  `_CLEAR_DRAFT_AFTER_SEND = True`。

### 回答（一条新消息，会推送）

- 正文 = `final_step_text(done, outputs)` → `answer_body` 清洗（去 Turn 标记、🛠️ 回显与工具输出、标签）→ 上游
  `_render_file_markers`（`[FILE:x]` 显示成文件名）→ Markdown 保真改写 → `_to_markdown_v2`；清洗后为空回退 `answer_body` 的整份 raw
  逻辑；仍为空且有文件时写「已生成附件」。**不再**注入 `<summary>` 引用块、不再有 `LLM Running` 标题。
- 附件：`[FILE:]` 从整份 `done` 里提取（沿用上游 `_files_from_text`），回答发完后以 `disable_notification=True` 逐个发送。
- 长回答按上游 `_markdown_safe_segments` 切段；折叠头只在第一段；**第二段起 `disable_notification=True`**（一轮只推一次）。
- MarkdownV2 被拒时回退纯文本（上游 `_reply_text_once` 已有这条路径，头部也要有纯文本版本）。
- 引用规则（同 Discord）：发回答时，若该聊天在本 run 触发消息之后又出现过别的消息（用户新消息或 bot 发的任何消息），
  回答以 reply 引用触发消息（`do_quote=True`）；否则不引用（`do_quote=False`）。Bot API 拿不到「最后一条消息」，自己按聊天记最后一条
  已知消息的 id（每条收到的用户消息、每条 bot 发出的消息都更新）。

### 折叠头：三个变体（临时切换器）

- 模块变量 `_FOLD_STYLE = "b"`；**临时隐藏命令** `/fold a|b|c` 切换（`/fold` 不带参数回当前值），不进 `/help`、不进
  `TELEGRAM_MENU_COMMANDS`；相关代码行加 `# TEMP(dogfood): remove after JC picks a fold style` 注释。JC 裁决后另开小票拆掉。
- `N` = 本 run 总步数（含最终回答那步、含 ask 续跑累加），`X` = `format_elapsed`（任务真正开始到 done 的墙钟，ask 各段相加、
  等待回答不计，`< 1` 秒整段省略）。1 步也有头（Discord 同裁决）。
  - **a**：第一行斜体 `_{N} 步 · 用时 X_`（MarkdownV2 转义后），换行接正文。
  - **b**：可折叠引用块（MarkdownV2：首行 `**>`，末行尾 `||`，每行以 `>` 开头，内容转义）：首行 `{N} 步 · 用时 X`，其后每步一行
    `{NN} {summary}`（01..N，含最终那步；超过 30 步只留最后 30 行并在第二行写 `… 前 {K} 步略`），块后空一行接正文。
    语法以 Bot API 文档为准（可用 WebFetch 查 core.telegram.org/bots/api#markdownv2-style），写错会 400 → 走纯文本回退，别静默吞。
  - **c**：没有头，只发正文。
- 纯文本回退时三个变体都退化为普通文本行（b 为首行 + 逐步行）。

### 停止 / 异常 / 暂停的终态文案（02 负责触发，本票负责渲染函数）

- 停止：新消息 `⏹ 已停止 · {N} 步 · 用时 {X}`（`stopped_text`），不带正文。
- 前端异常（发送失败之类，不是 GA 后端错误——后者在 done 正文里）：新消息，第一行斜体 `_{N} 步 · 用时 X_`，第二行 `❌ 出错：{e}`。
- ask 暂停：由 02 发提问消息。

### Markdown 保真（回答与报告共用；在 `_to_markdown_v2` 之前做一遍源文本改写）

代码围栏（```）内一律不动。

- 表格（`tables_to_lists`，共享文件）：表头行 + 分隔行（`|---|:--:|` 之类）+ 数据行。
  - 2 列：每个数据行 → `• {c1}：{c2}`（丢表头；单元格内原有粗体等格式保留）。
  - ≥ 3 列：每个数据行 → `• {c1} — {h2}：{c2}；{h3}：{c3}…`（空单元格那一对跳过）。
  - 1 列：`• {c1}`。只有表头没有数据行：`• {h1} · {h2} …`。
  - 单元格里的 `\|` 视为字面竖线。表格前后各保留一个空行。
- 标题（tgapp 内）：`#`–`######` 开头的行 → `**标题文字**`。
- 引用（tgapp 内）：`> ` 开头的连续行 → 上游已有的 `_quote_tag` 引用块。
- 分隔线：单独一行的 `---` / `***` / `___` → 删除（留空行）。
- 无序列表：行首（可带缩进）`- ` / `* ` / `+ ` → `• `（缩进保留）。有序列表不动。

### 运行登记（02 会用到，这里先搭好结构）

删掉 `ctx.user_data['stream_task']` 单槽，换成**全局按序的 run 列表**（只有一个 agent，GA 按入队顺序执行）：每个 run 记
chat_id、触发消息、display queue、状态（queued / running / asking / done / stopped / error）、已落定步的摘要、计时、live 面句柄。
排队的 run 等自己成为列表头才开始读 display queue（Discord 0023 的做法：保证前一个 run 的回答 / 提问先落地；item 在队列里攒着不会丢）。
run 结束只移除自己。

## 约束

- **不要直接改 `managed-ga/code/` 当交付**。流程见 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Add A Patch」：
  1. `git clone --quiet ~/Documents/GenericAgent <scratchpad>/ga-replay`，checkout `managed-ga/manifest.json` 的 upstream commit
     （`1b6442fe4f97d87a3d9d52d76569f69d156af853`）。**只读克隆，别碰 `~/Documents/GenericAgent` 本身**（JC 的工作副本）。
  2. 先 `bash scripts/build-managed-ga.sh <clone>` 重建一次，确认 `git status managed-ga/code` 干净（基线可复现）。
  3. 交付 = zero-context 补丁（`git diff -U0` 形态，路径 `a/frontends/tgapp.py`；新文件照 `0015` 的 `new file mode` 头）+
     `manifest.json` `patchStack.patches` 追加 + `managed-ga/patches/manifest.md` 加一行（reason / touched files / rebase risk /
     removal condition；rebase risk 注明「依赖 `0014` 在前」；更新「Last replay verified」）+ build 脚本重建后 payload 与你的版本逐字节一致。
- 访问控制、配对、`main()` 的连接状态机、`_emit_galley_status`、`check_config` 一律不动（这些是 `0014` 的域）。
- 用户可见中文文案按规格逐字，全角标点。上游原有、本票不涉及的文案不顺手改。
- 保持 tgapp 的写法（模块级函数 + async handler、`print(f"[TG …] …", flush=True)` 日志、只记 metadata 不记正文）。
- 上游 `_TelegramStreamSession` / `_TelegramTurnStreamCoordinator` / `_stream` 的 RetryAfter、MarkdownV2 回退、超长编辑溢出等逻辑可复用；
  不再使用的上游代码删或留，以补丁可读、rebase 面小为准，在 Comments 里说明取舍。
- 不碰 `runner/im_reporter.py`（03 的域），但必须提供 03 依赖的两个模块级 seam，**签名与语义定死**：

```python
def answer_text(raw):
    """User-visible answer of a finished task's full `done` text: the closing
    step only (split on the `LLM Running (Turn N) ...` marker lines; tool
    echoes, tool output and tags stripped, same cleaning as a live answer),
    [FILE:] markers rendered as file names. Returns "" when nothing visible
    remains."""

def markdown_v2_segments(text):
    """Split Markdown `text` for sending as Telegram messages: a list of
    (markdown_v2, plain) pairs, each within MessageLimit.MAX_TEXT_LENGTH once
    converted. Applies the same Markdown rewrite as answers (tables to lists,
    headings to bold lines, …) before conversion. `plain` is the fallback the
    caller sends without parse_mode when Telegram rejects the MarkdownV2."""
```

## 验证

- 新增 `runner/tests/test_managed_telegram_tgapp.py`，照 `runner/tests/test_managed_discord_dcapp.py` 的方式从 `managed-ga/code`
  导入 tgapp，用 stub 替掉 `telegram` / `agentmain` / `llmcore` 等重依赖；共享文件单独测。用假 agent（按上面的 item 形态、
  **增量** `next` 往 display queue 喂数据）+ 假 message / bot（记录 draft / send / edit / delete 及其参数）覆盖：
  单步直答、多步（N ≥ 2 出现「已完成 N 步」）、读秒三档与落定归零、排队文案与「另有 K 条消息排队中」、草稿失败回退静音状态消息、
  三个折叠头变体（含 b 的 30 步截断与转义）、`/fold` 切换、长回答只有首段推送、附件静音、引用规则、Markdown 改写（表格 2 / 3 / 1 列、
  仅表头、围栏内不动、标题、引用、分隔线、列表）、`answer_text` 与 `markdown_v2_segments` 契约、共享文件各函数。
  时间用可注入的 clock，别真 sleep。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner` 全绿。
- `python3 -m py_compile` 两个文件；Galley.app 自带 python 核对用到的 PTB 签名。
- `node scripts/check-managed-ga-payload.mjs` 绿；`git diff --check` 干净。

## 回报

在本文件末尾追加 `## Comments` 一节：做了什么、偏差与自行裁量（附理由）、验证命令与结果、集成方（04）要看的点。
回复主会话时给出同样的摘要。**不要 commit**，只碰本票与 02 的文件（`managed-ga/patches/0024-*`、`managed-ga/manifest.json`、
`managed-ga/patches/manifest.md`、`managed-ga/code/`（由 build 脚本重建）、`runner/tests/test_managed_telegram_tgapp.py`、本票与 02 的票面）。

## Comments

### 2026-09-30 · 实现完成（01 + 02 同一补丁 `0024`，同一 agent）

**做了什么**

- 新补丁 `managed-ga/patches/0024-managed-telegram-conversation-ux.patch`（1857 行、74 个 zero-context hunk；+1097 / −677，其中新文件 275 行，tgapp +822 / −677）：改 `frontends/tgapp.py`，新增 `frontends/galley_im_display.py`（`new file mode` 头照 `0015`）。两本账已记：`managed-ga/manifest.json` 的 `patchStack.patches` 追加一项；`managed-ga/patches/manifest.md` 加一行（rebase risk 注明依赖 `0014` 在前），「Last replay verified」改为 23 个补丁，原先 `0023` 那段挪成 Previous replay。payload 由 build 脚本重建产出。
- 共享文件：dcapp `0023` 的同名函数按原语义搬过来、去掉前导下划线（`format_elapsed` / `fold_label` / `stopped_text` / `step_summary` 连同 `TOOL_LABELS` / `strip_transcript` / `display_done_text` / `visible_text` / `final_step_text` / `answer_body` / `candidate_list` / `extract_ask_user_event` / `candidate_layout` / `MULTI_SELECT_RE` / `one_line` / `clip`），新增 `live_elapsed`、`tables_to_lists`。dcapp 未动。
- live 面：私聊用草稿（纯文本，每个 run 一个 `draft_id`），群聊或草稿失败时回退为静音状态消息；三行加「另有 K 条消息排队中」；读秒三档，步落定时归零；排队文案；草稿每 2 秒重渲染、有变化才发、20 秒保活；状态消息编辑间隔 1.5 秒、读秒 5 秒一刷；RetryAfter 退避。
- 回答：只取收尾那一步；先做 Markdown 保真改写，再转 MarkdownV2；折叠头 a / b / c（`_FOLD_STYLE`、隐藏命令 `/fold`，相关行已加 TEMP 注释）；b 超过 30 步截断；第二段起与附件静音；MarkdownV2 被拒回退纯文本（头部同样有纯文本版）；引用规则按聊天自记的最后消息 id 判断。
- 运行登记：`ctx.user_data['stream_task']` 换成全局按序的 `_RUNS`，只有表头读 display queue，run 结束只移除自己。
- 03 依赖的两个 seam `answer_text(raw)`、`markdown_v2_segments(text)` 按定死的签名与 docstring 实现，均在模块顶层。
- 02 的实现要点并入下面的偏差一节；本票与 02 的测试名见 02 票面。
- `docs/ga-baseline.md`：item 15 扩成 Discord / Telegram 两个前端，写清 `inc_out` 增量与累积的差别，补第（e）条：`/continue n` 的 abort 探针；「Where each coupling lives」加 tgapp 与共享文件的函数名；Step 8 加一条 Telegram 真机清单。

**偏差与自行裁量（附理由）**

1. **`_CLEAR_DRAFT_AFTER_SEND` 默认 `False`，票面写的是 `True`。** Bot API 文档 sendMessageDraft 一节：text 参数写着「Pass an empty text to show a “Thinking…” placeholder」，keep_on_stop 参数说明里写着「The draft will still disappear after a short time or if the bot sends a message」；PTB 22.8 `Bot.send_message_draft` 的 docstring 同样写明空文本显示 Thinking 占位。也就是说，正式消息发出时草稿已经消失，再发空草稿反而会把「Thinking…」占位重新挂出来，最长 30 秒。开关保留，`test_clear_draft_switch` 两个取值都测了；真机第 1 步若看到草稿残留，改成 `True` 即可。
2. **停止回执在 `/stop` 当下发，不等 `done`。** 票面写的是「收到 done 后……发 ⏹ 已停止」。改为立即发，理由有二：`/new` 要求先发 ⏹ 再发 🆕，等 `done` 就排不出这个顺序；立即发也不依赖 GA 及时交出 `done`。被停的 run 在任何 await 之前就同步标记为 stopped，读循环看到状态即退出；被 abort 的任务交出的 `done` 无人读取，不会被当成回答发出。用时按停止那一刻计算。做法与 Discord `0023` 相同。
3. **「正在跑的 run」判定更严。** 除了表头的 queue 已出过 item，还要求 `agent.is_running` 为真、且 `agent._current_queue` 就是它的 queue。表头任务其实已经跑完（`done` 还在队列里没读）时，`/stop` 回「当前没有在跑的任务」，`/new` 也不会把它标成停止，它的回答照常落地；abort 也不会误伤报告轮或下一个任务。
4. **`/continue n` 用一次性探针判断是否真的重置。** 上游 `handle_frontend_command` 只在索引有效时调 `reset_conversation`（其中 `agent.abort()`）；索引越界时不 abort。若照 `/new` 的做法先把 run 标成停止，越界的 `/continue 9` 就会重演「显示已停止、后台照跑」。做法：调用期间在 agent 实例上临时包一层 `abort`，记录调用时是否 `is_running`，`finally` 里删除恢复。它只在 Galley 自己的 managed agent 进程内、单次同步调用内生效，已记入 ga-baseline item 15 的第（e）条。`/new` 必然 abort，不需要探针；`/restore` 的 abort 本来就写在 tgapp 里，直接处理。待答提问的清理同理：`/restore` 只在恢复成功时清，`/continue n` 只在确实重置时清，`/continue`（只列会话）不清。
5. **`[FILE:]` 在清洗之前渲染成文件名，用新 helper `_file_names`，没有用上游 `_render_file_markers`。** 票面管线是「`answer_body` 清洗 → `_render_file_markers`」，但 dcapp 的清洗（`strip_transcript` 里的 `strip_files`）会把标记整个删掉，删完就没有可渲染的了。先渲染也不能用 `_render_file_markers`：它会 `.strip()` 掉步文本结尾的换行，而 🛠️ 回显的剥离正则要靠这个换行定位（测试当场抓到，ask 提问里漏出了 `🛠️ ask_user(...)`）。`_render_file_markers` 本身没改，reporter 的旧路径照常读它。
6. **`·· 排队中` 按 GA 当前在跑哪个任务动态判断**（`_is_waiting`：不是表头，或 GA 正在跑别的 queue）。GA 空闲、刚登记还没出第一个 item 时显示 `·· 思考中`，避免每次都闪一下「排队中」；这段读秒从登记时起算。
7. **共享 `live_elapsed` 加了可选参数 `still_running=True`。** 排队读秒传 `still_running=False`，去掉「仍在运行」。票面签名 `live_elapsed(seconds)` 不变。
8. **折叠头 b 的步行在超长时收窄。** 30 步乘以 120 字摘要再加转义，单是这个块就可能超过 4096；块超过半条消息（2048）时，依次把每行截到 60 字、24 字。正常长度不截。
9. **ask_user 细节。** 候选超过 50 条的 text 形态不加「多选：点选后按「提交」……」提示（没有按钮可点）；旁白加问题超过一条消息时，旁白先静音单独发，问题与按钮留在同一条；问题截到 3000 字。多选问题里点到数字按钮这类非法 action：静默应答、保留按钮；已答、失效、进程重启前留下的按钮：静默应答并去掉按钮。点按钮续跑的触发消息取 `query.message`；若它是没有回复方法的 inaccessible stub，改用当初发出的提问消息。
10. **删掉的上游代码**：`_TelegramStreamSession`、`_TelegramTurnStreamCoordinator`、`_stream`、`_visible_segments`、Turn 标记与摘要注入一组、`_send_files_from_text`、上游的 ask 提取 / 全局事件队列 / 菜单渲染一组、`_cancel_stream_task`，以及相关常量。重写之后它们都是死代码；上游 tgapp 自 2026-05-26 未动（见 PRD），而 zero-context 的删除 hunk 在上游改到这些行时会直接 apply 失败，不会悄悄错位。保留并复用的：`_markdown_safe_segments`、`_to_markdown_v2`、`_quote_tag`、`_render_file_markers`、`_files_from_text`、`_resolve_files`、`_send_files`（改为静音发送并记录消息 id）、转义函数、LLM 菜单、`_clear_ask_reply_markup`、`_reply_command_text`。
11. **轮询重启。** `main()` 崩溃后会换一个新的事件循环，旧循环里的 run 已经死了。新 run 登记时，把不属于当前循环的 run 从 `_RUNS` 里剔掉，否则之后每条消息都会永远排在死 run 后面。`main()` 本身没动。
12. **`/restore` 的顺序。** 保持上游 abort 与 `history.extend` 紧挨着，停止回执在两者之后、「✅ 已恢复」之前发出。
13. **空回答。** 没有折叠头（c 形态或 0 步）、也没有正文和文件时发「...」（同 dcapp）；有折叠头时只发头。

**验证（全部通过）**

- 基线：`git clone --quiet ~/Documents/GenericAgent <scratchpad>/ga-replay` 后 checkout `1b6442f`；加入 `0024` 之前先 `bash scripts/build-managed-ga.sh <clone>` 重建一次，22 个补丁全部 clean apply，`git status managed-ga/code` 干净。
- 加入 `0024` 后重建：23 个补丁全部 clean apply，编译扫描通过；`cmp` 比对重建出的 `tgapp.py`、`galley_im_display.py` 与作者版本，逐字节一致（最后一处改动之后又完整重建了一遍，结果相同）。
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`；`node scripts/check-ga-baseline-drift.mjs`：`OK (1b6442fe)`。
- `.venv/bin/python -m pytest`：406 passed，6 deselected（运行时工作树里有另一个 agent 对 `runner/im_reporter.py` / `test_im_reporter.py` 的改动，一并通过）。新增的 `runner/tests/test_managed_telegram_tgapp.py` 共 42 条，单独连跑 8 次均稳定通过。
- `.venv/bin/python -m mypy runner`：Success（25 个文件，含新测试）；`.venv/bin/ruff check runner`：All checks passed；`git diff --check`：干净。
- `py_compile`：系统 python 3.14.4 与 Galley.app 自带的 3.11.15 各编译两个文件，均通过（编译产物写到 scratchpad，payload 里没有 `__pycache__`）。
- PTB 22.8 签名核对：用 Galley.app 自带 python 以真实的 `telegram` 包导入 tgapp，把用到的每个调用按真签名 `inspect.signature(...).bind` 了一遍：`Message.reply_text_draft(draft_id, text)`、`Message.reply_text(...)` 带 `parse_mode` / `do_quote` / `disable_notification` / `reply_markup`、`Message.edit_text`、`Message.edit_reply_markup(reply_markup=)`、`Message.delete()`、`Message.reply_photo` / `reply_document` 带 `disable_notification`、`CallbackQuery.answer(text, show_alert=)`、`CallbackQuery.edit_message_text(..., parse_mode=, reply_markup=)`、`CallbackQuery.edit_message_reply_markup(reply_markup=)`。用真实 `InlineKeyboardButton` / `InlineKeyboardMarkup` 建出的 callback_data 最长 29 字节（上限 64），50 个候选的 list 形态排成 8 个一行共 7 行。MarkdownV2 可折叠引用块的语法对照 core.telegram.org/bots/api#markdownv2-style（首行 `**>`，每行以 `>` 开头，末行尾加 `||`）。
- 中文新增文案的全角标点：扫描补丁新增行里的字符串字面量，唯一命中是 `MULTI_SELECT_RE` 的正则本身。

**集成方（04）要看的**

- **seam 语义的一个边界。** `answer_text` 与 live 回答用同一套清洗，所以收尾那一步没有可见正文时（例如最后一步只有 🛠️ 回显），会回退到整份 transcript 的清洗结果，也就是前面各步的旁白；整份都没有可见内容才返回 `""`。reporter 的 SKIP 判断不受影响（SKIP 就在收尾那一步里）。如果 03 需要「严格只看收尾那一步」，要由主会话裁决是否改 seam。
- **待答提问期间 reporter 的 `busy()` 为假**（它读的是 `agent.is_running`），报告轮可能插进「提问」与「回答」之间，GA 视角下报告 prompt 就成了 ask_user 的回答。报告轮里若调了 ask_user，按 queue 认领不会发出提问，但 GA 那边仍停在等回答。这与 Discord 04 是同一个问题。
- **reporter 的 HTTP 直发不经过 `_note_message`。** 报告落在触发消息与回答之间时，回答不会引用触发消息。影响小；要补的话，可以给 reporter 一个通知 tgapp 的钩子。
- 真机要看：①回答发出后草稿是否残留（决定 `_CLEAR_DRAFT_AFTER_SEND`）；②折叠头 b 的 `**>` 可折叠块 Telegram 是否接受——被拒会走纯文本回退，并在 `telegram.log` 留下 `[TG markdown fallback]`，出现这行就是语法问题；③长任务草稿 30 秒后不消失（20 秒保活）；④`/stop` 只有一条回执；⑤群聊里的静音状态消息默认会引用触发消息（PTB 在群聊的 `do_quote` 默认值），票面没有规定，真机若嫌多余可改成 `do_quote=False`。
- `galley_im_display.py` 的模块 docstring 指向「2026-09-30 Telegram conversation UX devlog」里记录的迁移条件（`0023` 下次重导出时，先把本文件拆成独立补丁排到 `0023` 前面，再迁 dcapp）。这篇 devlog 由主会话写，写时请把这一条放进去，或改掉 docstring 的指向。
- dcapp 未动，Discord 行为逐字节不变；外置 GA、飞书、微信零变化。
