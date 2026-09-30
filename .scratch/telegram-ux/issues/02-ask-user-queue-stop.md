# 02 ask_user、排队与停止、命令

Status: done
Blocked by: 01（同一补丁 `0024`、同一文件，同一 agent 接着做）
PRD：[../PRD.md](../PRD.md)；母本 `.scratch/discord-ux/issues/02-ask-user-stop-commands.md`（含 Comments 里的实现偏差）

## 做什么

修 PRD 问题 3、4：ask_user 对齐桌面；排队显示正确、`/stop` 与 `/new` 类命令不再制造「显示已停止、后台照跑」的孤儿任务；
命令回执收成一条。

## ask_user

### 捕获

- 沿用上游 `_turn_end_hooks` seam（`_register_ask_user_hook`），事件提取换成共享文件的 `extract_ask_user_event`
  （无候选也返回事件；同问题拆分候选合并）。
- **按 display queue 认领**：hook 触发时记下 `agent._current_queue`，事件只交给拥有该 queue 的 run（在它收到 `done` 时取）；
  别的任务（reporter 的报告轮 `source="galley_reporter"`）的事件没人认领就丢弃。删掉全局 `_ask_menu_events` 队列。
- hook 在 GA 线程里调，交接要线程安全。

### 提问消息（新消息，会推送）

run 以 ask_user 结束时：保存续跑计数（步数、用时），然后以一条新消息取代草稿：

```
_⏸ 等你回复 · 已完成 {N} 步_
<该步旁白（final_step_text 清洗后，非空才有）>
<问题>                         ← 保留单换行（GA 的 question 是纯文本，换行有语义）
<list / text 形态：1. 候选一 …>
<多选时：_多选：点选后按「提交」，也可以直接打字回复_>
[inline 按钮]
```

斜体行是 Discord `-#` 的对应物（PRD 约定）。文本走 MarkdownV2（问题与候选要转义），被拒回退纯文本。

- 形态（`_ask_layout`，同 Discord 口径，按 Telegram 限制调整）：
  - `none`：无候选，只有问题，打字回答。
  - `row`（`candidate_layout` 判 row）：每个候选一个按钮、**每行一个**，按钮文字 = 候选全文。
  - `list`（`candidate_layout` 判 list）：正文编号列出全文，按钮只写 `1` `2` `3`…，每行最多 8 个。
  - `text`：候选超过 50 条时不给按钮，纯文本编号，打字回答。
  - 多选（`MULTI_SELECT_RE` 命中问题）：**保留上游的 toggle 多选**（Telegram 独有、已可用）：row 形态按钮写全文、list 形态写序号，
    选中的按钮前缀 `✓ `；末尾一行按钮「提交」。未选任何项就点「提交」→ `query.answer("请至少选择一项，或直接打字回复", show_alert=True)`。
- **去掉**上游的「none of these above」按钮与「已取消选择…」那条消息（打字即可回答，它多余）；「Done」→「提交」。
- callback_data 沿用上游 `ask:<menu_id>:<action>` 形态（≤ 64 字节）。

### 回答

- **点按钮**（访问控制沿用上游：锁定态 `query.answer()`、非 owner `query.answer("no", show_alert=True)`，不改）：
  owner 点选 → 先 `query.answer()`，把提问消息编辑成回显（见下）并去掉按钮，然后以候选全文起续跑 run（上游 `_build_text_prompt`），
  续跑 run 的触发消息是这条提问消息。多选以 `；` 连接所选候选全文。
- **直接打字**：该聊天有待答提问时，下一条普通文本消息（非命令）就是回答——提问消息改成不带勾的回显、去按钮，以这条消息起续跑 run。
  图片 / 文件消息不算回答（提问保持待答）。
- 已答 / 已失效 / 进程重启后残留的旧按钮：`query.answer()` 静默应答并去掉该消息的按钮，不起 run（上游是 toast「菜单已过期」，改为静默，同 Discord）。
- `/new`、`/restore`、`/continue n`：清掉该聊天的待答提问（去按钮）与续跑计数。

### 回显（编辑提问消息）

```
_已回复 · 已完成 {N} 步_
<旁白>
<问题>
✓ 被选的候选        ← 正常字重（多选：每个被选项都打勾）
_其余候选_          ← 每条一行斜体（Discord 的 -#）
```

list / text 形态保留编号（`✓ 2. …`、`_1. …_`）。打字回答时所有候选都是斜体、无勾（桌面：自由回复不勾）。

### 续跑计数

与桌面 09-18「提问不切断 run」一致：续跑 run 的步号从 N+1 接着编；live 面的「已完成 N 步」、折叠头的 `N 步 · 用时 X`、
折叠头变体 b 的逐步列表都是各段之和（b 的列表含前面各段的步）；等待回答的时间不计。

## 排队与停止

- 忙时再发消息：run 进 01 的 run 列表排队，不另发任何消息；同聊天的头 run 的 live 面出现「另有 K 条消息排队中」；
  成为列表头但 GA 还在跑别的任务时显示 `·· 排队中`（01 已定文案）。
- `/stop`：
  - 列表头 run 正在跑（它的 queue 已出过 item）→ 标记它为 stopping，`agent.abort()`；它收到 `done` 后**不发回答**，发
    `⏹ 已停止 · N 步 · 用时 X`（01 的渲染），草稿随之被取代；回退状态消息模式下把状态消息定格成这句、不删。**不另发**
    「⏹️ 正在停止...」。
  - 没有正在跑的 run（包括 GA 正在跑 reporter 报告轮、用户 run 都在排队的情况）→ 回一行「当前没有在跑的任务」，**不** abort
    （报告轮对用户不可见，与 Discord 同裁决）。
  - 排队的 run 不受影响：它们照常执行、照常显示。
- `/new`：上游 `reset_conversation(agent)` 会 abort 正在跑的任务——正在跑的 run 按停止终态处理（发 `⏹ 已停止 …`），随后回上游的
  「🆕 已开启新对话…」；排队的 run 照常执行、照常显示（它们会在新上下文里跑）。`/restore`、`/continue n` 同理：只处理正在跑的，
  不再「取消最新一条的显示」。
- 删除 `_cancel_stream_task` 及其所有调用；`ctx.user_data['stream_task']` 不再使用。
- `handle_photo`（图片 / 文件）也走 run 列表与 01 的展示流程；提示词不变（D 项暂缓）。
- `/review`：走 run 列表与 01 的展示流程（上游 `_handle_review_command` 的 `handle_review_command` 调用保留；GA 直接回 `done`
  的情况——如 `/review help`——就是 0 步回答，不带折叠头）。
- `/btw`、`/status`、`/llm`、`/help` 行为不变。

## 文档

`docs/ga-baseline.md`：Contract Surface item 15 目前只写 Discord（补丁 `0023`）。把它扩成「managed Discord / Telegram 前端」——
tgapp 用到的是同一组 GA 内部形态（display queue item、`inc_out=True` 的增量 `next`、ask_user exit payload、`_current_queue`、
`/review` 拦截），差异（增量 vs 累积）写清楚；「Where each coupling lives」补一条 `managed-ga/code/frontends/tgapp.py`（补丁 `0024`）
+ `frontends/galley_im_display.py` 的函数名；Step 8 的真机清单补一条 Telegram（多步请求草稿变化后只剩回答、ask_user 按钮、`/stop`）。

## 约束 / 验证 / 回报

同 01（补丁流程、ledger 行在 01 那行上补充描述、不动访问控制与 `0014` 的域、不 commit）。测试加进
`runner/tests/test_managed_telegram_tgapp.py`：none / row / list / text / 多选五种形态、hook 按 queue 认领（报告轮的 ask 不被认领）、
owner 点选起续跑且计数累加（含变体 b 列表跨段）、非 owner 点击、旧按钮静默去除、打字回答无勾回显、多选 toggle 与空提交提示、
`/stop` 三种情况（在跑 / 无 run / 只有排队）、排队 run 在 `/stop` `/new` 后照常显示（回归：孤儿任务缺陷）、`/new` `/restore` 清待答、
图片走 run 流程、`/review` 分支。按钮回调用假 `CallbackQuery` 测，不连 Telegram。

Comments 与 01 可以合写在 01 的票面，本票 Comments 写「见 01」并列出本票相关的测试名即可。

## Comments

### 2026-09-30 · 实现完成（与 01 同一补丁 `0024`）

见 01 的 Comments：做了什么、偏差（与本票直接相关的是第 2、3、4、9、11、12 条）、验证命令与结果、集成方要看的点都写在那里。

本票相关的测试都在 `runner/tests/test_managed_telegram_tgapp.py`：

- ask_user：`test_ask_layouts`（none / row / list / 每行 8 个 / 超过 50 条的 text，含 list 形态回显的编号）、`test_ask_multi_select_toggles_and_submits`（toggle、空提交提示、以 `；` 连接所选全文）、`test_ask_row_click_continues_run_with_carried_counts`（owner 点选、回显打勾、续跑计数与变体 b 列表跨段累加、已答按钮再点静默）、`test_ask_non_owner_and_locked_clicks`、`test_stale_button_after_restart_is_silent`、`test_ask_typed_answer_echoes_without_tick`、`test_ask_from_other_task_is_not_claimed`（报告轮的 ask 不被认领）、`test_photo_does_not_answer_a_pending_question`（图片走 run 流程，且不算回答）、`test_new_and_restore_drop_pending_question`、`test_shared_ask_user_helpers`。
- 排队与停止：`test_stop_running_run_keeps_queue`（在跑的停下，排队的照常显示）、`test_stop_without_running_run`（没有 run、只有排队且 GA 在跑报告轮，两种都不 abort）、`test_stop_in_group_freezes_status_message`、`test_new_stops_running_run_and_queued_run_still_answers`（孤儿任务缺陷的回归）、`test_continue_n_stops_only_when_it_resets`、`test_queued_behind_reporter_turn_and_other_messages`。
- 命令：`test_help_btw_review_commands`（`/review help` 直接回、`/review scope` 走 run 流程）、`test_fold_styles_and_fold_command`、`test_unauthorized_message_is_refused_without_a_run`。
- 文档：`docs/ga-baseline.md` 的 item 15、耦合入口与 Step 8 已改，见 01。
