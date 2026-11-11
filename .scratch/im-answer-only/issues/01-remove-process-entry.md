# 01 四个渠道撤掉过程入口

Status: needs-dogfood（2026-11-11 合入；JC 当天在 dev 里验过 Telegram、飞书，「都没有问题」；微信没验，Discord 验不验 JC 没说）

来源：[PRD](../PRD.md) 裁决 1–4、6。先读 `docs/agents/dispatch.md`（执行代理的常设约束）与 `docs/managed-ga-runtime/code-state-and-patches.md`（「How To Modify An Existing Patch」）。

一句话：IM 的回答消息里只有回答。Telegram、Discord 的「过程」按钮、飞书回答卡片里的「过程」折叠面板、微信回答末行的「N 步 · 用时 X」全部撤掉；在跑时的状态消息、停止回执、提问消息、出错消息一律不动。

## 1. 要改的文件

- `managed-ga/code/frontends/tgapp.py`、`managed-ga/code/frontends/galley_im_display.py`（补丁 `0024`）
- `managed-ga/code/frontends/dcapp.py`（补丁 `0023`，随后在新 `0023` 上重导出 `0026`）
- `managed-ga/code/frontends/fsapp.py`（补丁 `0029`；它排在 `0024` 之后，`0024` 变了就要在其上重导出）
- `runner/im_wechat.py`
- `runner/im_resume.py`（只在 `sent` 回调随之删掉时改它的 docstring 与透传）
- `runner/tests/test_managed_telegram_tgapp.py`、`test_managed_discord_dcapp.py`、`test_managed_feishu_fsapp.py`、`test_managed_wechat.py`、`test_im_resume.py`
- `managed-ga/patches/` 下受影响的补丁文件与 `manifest.md` 对应行
- `docs/design/overlays-and-settings.md` §9 Channels 里 Discord、Telegram、飞书、微信各条
- `docs/ga-baseline.md` 的基线冒烟清单（提到「过程」按钮 / 面板的几条），以及 Contract Surface 第 15、16 项里若有随之不成立的话

## 2. 怎么改

**Telegram（`tgapp.py`）**

- `_send_answer`：不再建 `_Process`，不再给最后一段挂 `reply_markup`，不再为过程块给最后一段预留空间（`_md_segments` 的 `room` 回到不留）。回答照旧是收尾那一步，分段、引用触发消息、静默发后续段与文件的规则不变。
- 删掉：`_Process`、`_processes`、`_process_block`、`_process_quote`、`_process_markup`、`_edit_process`、`_PROCESS_BUDGET`、`_PROCESS_CACHE_LIMIT`、`_PROCESS_SHOW` / `_PROCESS_HIDE`，以及只为它们服务的导入。
- `handle_process_callback` 留下来当墓碑（裁决 6）：`^proc:` 的点击照旧过锁定与 owner 检查，然后静默应答（`query.answer()` 不带文字）并把这条消息的按钮摘掉（只改 reply markup，不改文字）；摘按钮失败（消息太旧、已被删）吞掉并打一行日志。`_PROCESS_CALLBACK_PREFIX` 与 `CallbackQueryHandler` 的注册随之保留。已知小缝、不处理：重启前展开着的旧消息，文字收不回去。
- `_reply_markdown` 的 `sent` 回调：今天唯一的调用方是过程按钮（`_send_answer` 里的 `sent=process.sent`）。删前自己再 grep 一遍 `tgapp.py`、`runner/im_resume.py`、`runner/im_reporter.py` 确认没有别的调用方，确认后删掉参数，`im_resume` 里对它的透传与 docstring 同步改。
- `_Run.summaries` 留着：在跑时的状态消息用它画「NN 摘要」。跨提问的 `carry["summaries"]` 若只为过程块服务就删；删前核对状态消息在提问之后的续跑里要不要它。

**`galley_im_display.py`**

- 删 `process_lines`、`fit_process`、`PROCESS_MIN_STEPS`、`PROCESS_STEP_LINES`、`PROCESS_LINE_WIDTHS`、`PROCESS_BUTTON_TEXT`、`PROCESS_HIDE_BUTTON_TEXT`、`PROCESS_GONE_TEXT`。删前 grep `managed-ga/code` 与 `runner/` 全部调用方，确认都在本票删掉的代码里。
- `fold_label`、`stopped_text` 留着：出错消息那一行、停止回执还在用（裁决 4）。

**Discord（`dcapp.py`）**

- 回答的最后一段不再挂「过程」按钮；删 `self._processes`、存取它的代码、`_process_lines`、`_fit_process`、`_PROCESS_*` 常量、`PROCESS_BUTTON_TEXT`、`PROCESS_GONE_TEXT`，以及只为它们服务的辅助函数。`_fold_label` 若还被停止回执 / 出错行用就留。
- 旧按钮（`custom_id` 以 `proc` 结尾的那个）：去掉它在「旧进程留下的按钮」处理里的例外，走与旧「停止」按钮相同的路：静默应答并摘掉按钮，不回 ephemeral。
- 跨提问累加的 `summaries`（`_DiscordRun.summaries`、`carry`）同 Telegram 的判法。

**飞书（`fsapp.py`）**

- `_answer_card` 不再接 `process`，回答卡片只有可选的提示行与正文；删 `_process_panel`、本票范围内的 `_process_lines`、`_PROCESS_STEP_LINES`、`_PANEL_ICON`（若再无别处用），以及 `_send_answer` 一带为面板算宽度、选最后一段的代码。
- 文件里上游原有的 `_step_panel`（`Turn N · …` 那个类）不是本票的东西，核对它是否还被调用；不管结果如何都不动它，写进报告。
- 旧卡片里的面板在客户端里，照旧能开，不处理。

**微信（`runner/im_wechat.py`）**

- `_post_answer`：不再接 `N 步 · 用时 X` 末行，回答就是收尾那一步；正文为空又没有文件时照旧发 `...`。docstring 与文件头注释同步。
- `_post_question` 的「⏸ … · 已完成 N 步」、`_post_stopped` 不动。

**这条规则不覆盖的**（一律原样）：在跑时的状态消息（含「NN 摘要」「·· 思考中」「排队中」）、停止回执 `⏹ 已停止 · N 步 · 用时 X`、提问消息的「已完成 N 步」、出错消息上面那行 `N 步 · 用时 X`、完成汇报（`runner/im_reporter.py` 与它走的 seam：`answer_text`、`markdown_v2_segments`、`deliver_embed` 等）、访问控制、配对、连接状态机、`/stop` `/new` `/restore` `/continue`。

**补丁流程**

- 在临时克隆上按 manifest 顺序重放成提交链，先核对链与已提交的 payload 逐字节一致，再改 `0023`、`0024`、`0029` 对应的链提交；`0026` 在新 `0023` 上重导出，`0024` 之后、依赖它的补丁依次重放。零上下文补丁会静默落偏，冲突按「两边的改动都留、本票要删的删」解决，逐处写进报告。
- 从干净上游重放全部补丁无差异；重建后 `managed-ga/code` 与工作区一致。
- `manifest.md` 的 `0023`、`0024`、`0029` 行改成现状（不留「过程按钮」的描述，写明 2026-11-11 撤掉与票的路径 `.scratch/im-answer-only/issues/01-remove-process-entry.md`）。

**测试**

- 删掉只测过程按钮 / 面板 / 末行的用例；改掉断言里带末行的用例（微信那几条断言的文字去掉 `\n\nN 步 · 用时 X`）。
- 新增：四个渠道各一条「多步回答发出去时什么都不挂」（Telegram 无 `reply_markup`、最后一段不为过程留空；Discord 无 view；飞书卡片元素里没有 `collapsible_panel`；微信文字以回答结尾）；Telegram、Discord 旧按钮点击各一条（静默应答、按钮被摘、文字不变、非 owner 照旧被拒）；Telegram 摘按钮失败不抛。
- 停止回执、提问消息、出错行的现有用例应当原样通过，别改它们的期望。

**文档**

- `docs/design/overlays-and-settings.md` §9：四个渠道的回答一律写成「回答里只有回答，过程不留入口，问它就说」，指向 `docs/devlog/` 里主会话稍后写的条目（先写占位链接 `./../devlog/2026-11-11-im-answer-only.md`，主会话验收时补文件）；微信那条里对比 TG / Discord 按钮的话随之改掉。先 grep 这一节里的「不要 / 有意 / 分叉」，看有没有与本票冲突的定论，有就写进报告、不自己裁。
- `docs/ga-baseline.md` 冒烟清单同步。
- 新增的中文文字用全角标点。

## 3. 验证命令

在 worktree 根目录跑，长命令前台跑。Python 用主工作树的虚拟环境解释器（派活说明里给路径），pytest 要把 `GA_PATH` 指到本 worktree 的 `managed-ga/code`，否则测到的是别处的 GA 检出。

```bash
GA_PATH="$PWD/managed-ga/code" <venv python> -B -m pytest
<venv python> -B -m mypy runner
<venv ruff> check runner
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
git diff --check
```

另：干净克隆重放补丁栈全 clean；`grep -rn "过程" managed-ga/code/frontends/{tgapp,dcapp,fsapp,galley_im_display}.py runner/im_wechat.py` 的剩余命中逐条说明为什么留。

## 4. 不要碰

- `core/`、`gui/`、`cli/`、IM 入口层提示词（`core/src/managed_prompt.rs`）：裁决 5 定了先不加。
- `.scratch/im-polish/`（旧票与旧评测）、`.scratch/im-answer-only/ask-process-eval/`（票 02 的目录）。
- `docs/devlog/`：devlog 由主会话写。
- 上面「这条规则不覆盖的」各项。

## 5. 报告格式

照 `docs/agents/dispatch.md`：改了什么（文件与提交号）、验证命令与输出、未解决的风险与没验证到的、票外发现。另加一节「删掉的东西各自的调用方核对」，逐个列出删前 grep 到的调用方。票面与 Comments 不写本机路径、私有地址、真实数据。

## 6. 真机

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 逐 hunk 读 diff；独立 worktree 里重跑上面的门禁；干净克隆重放补丁；dev 里「重启 Channels」后看四个渠道日志无异常 | Telegram：发一个多步问题，回答下面没有按钮；点一条旧消息的「过程」，按钮消失、没有提示；问一句「刚才怎么查的」。飞书：多步回答的卡片里没有面板。微信：多步回答末尾没有「N 步 · 用时」。Discord 免测与否由 JC 定 |

## Comments

### 2026-11-11 执行代理（实现提交，合入 `main` 后是 `bb360a2b`）

**改了什么**

- Telegram：`_send_answer(run, raw, step_text)` 只发回答，不挂 `reply_markup`，最后一段不再留空间（`_md_segments` 去掉 `room`，回到只按消息上限切）；`_reply_markdown` 去掉 `sent` 回调，回到 10-21 之前的样子。删 `_Process`、`_processes`、`_process_block`、`_process_quote`、`_process_markup`、`_edit_process`、`_PROCESS_BUDGET`、`_PROCESS_CACHE_LIMIT`、`_PROCESS_SHOW` / `_PROCESS_HIDE`，以及只为它们服务的 `OrderedDict` 导入和四个过程名的导入。`handle_process_callback` 成墓碑：锁定、owner 检查照旧，`query.answer()` 不带文字，`edit_message_reply_markup(reply_markup=None)` 只摘按钮；摘不掉吞掉，打一行 `[TG process button cleanup]`。`_PROCESS_CALLBACK_PREFIX` 与 `^proc:` 的注册保留。`_send_answer` 的 `steps` / `seconds` 参数随之去掉（`runner/im_resume.py` 的 `arming` 以 `*args, **kwargs` 透传，不受影响）。
- `galley_im_display.py`：删 `process_lines`、`fit_process` 与六个 `PROCESS_*` 常量；`fold_label`、`stopped_text` 留着。
- Discord：回答不挂 view；删 `_PROCESS_*`、`PROCESS_BUTTON_TEXT`、`PROCESS_GONE_TEXT`、`_process_lines`、`_fit_process`、`_process_text`、`_send_answer_text`、`_remember_process`、`_on_process_click`、`self._processes`。`galley-dc:proc` 不再例外，落到 `_ack_stale`（defer，摘按钮，不回 ephemeral）。`_send_answer` 去掉 `steps` / `elapsed`，`_finish_run` 随之不再算它们。`_fold_label` 留着（出错行、停止回执）。
- 飞书：`_answer_card(body, notice="")`；删 `_process_panel`、`_process_lines`、`_PROCESS_STEP_LINES`、`_PANEL_ICON`，`_post_answer` 里按宽度挑面板、只给最后一段挂面板的循环，以及只为这个循环存在的 `_CARD_BYTES_LIMIT`（连同它上面那行 30 KB 的注释）；`_post_answer` 去掉 `seconds`。票里写的是 `_send_answer`，飞书里对应的函数叫 `_post_answer`。
- 微信：`_post_answer` 不接末行，正文为空又没有文件时照旧发 `...`；去掉 `seconds` 参数；文件头注释与 coupling 列表同步（`fold_label` 不再用）。`_post_question`、`_post_stopped` 没动。
- `runner/im_resume.py`：只改 docstring。它对 `sent` 没有专门的透传代码，走的是通用的 `**kwargs`。

**summaries 怎么判的**

- Telegram 留：提问之后续跑时，状态消息第一行读 `run.summaries.get(base_steps)`，也就是从提问那边带过来的那条摘要（既有用例 `test_ask_row_click_continues_run_with_carried_counts` 里第二条状态消息的「02 确认方向」就是它）。`carry["summaries"]` 原样保留。
- Discord 删：状态消息读的是 `last_summary`，跨提问带的是 `carry["summary"]`，`summaries` 字典只供过程按钮。`observe` 回到 10-21 之前直接算 `last_summary` 的写法，行为等价。
- 飞书也删。票面没点名，按同一判法：飞书没有状态消息，`summaries` 只供面板。删了 `_FsRun.summaries`、`carry["summaries"]` 和 `step_summary` 导入；`turn_texts` 随之只写不读，一并删掉，`observe` 只算步数（等价改写）。这一条超出票面字面，验收时请看这几个 hunk。

**补丁**

- 先把已提交的栈在临时克隆里重放成提交链：与 payload 逐字节一致，导出的 29 个补丁也逐字节一致。改 `0023`（dcapp）、`0024`（tgapp、galley_im_display）、`0029`（fsapp）三个链提交，其余 cherry-pick。
- 只有 `0026` 在新 `0023` 上有冲突，两处，与 10-21 那次同一位置。`DiscordApp.__init__`：`0026` 删 `_stale_channels` 块，`0023` 不再加 `_processes` 那行，两边的删除都留。`_send_answer`：`0023` 去掉 `steps` / `elapsed` 与过程那句，`0026` 加 `notice`，两边都留。新 `0026` 仍是 34 个 hunk，正文只有这两处不同，其余只是 hunk 头行号。
- 解完冲突后的 `dcapp.py` 与工作区逐字节一致。`build-managed-ga.sh` 从干净克隆重建：四个文件逐字节等于测试跑的版本，`managed-ga/code` 与 `state-seed` 其余无变化。再从干净克隆把新栈重放成链、导出，29 个补丁与入库的逐字节一致。`0025`、`0027`、`0028`、`0030`、`0031` 不碰这几个文件，没变。manifest 的 `0023`、`0024`、`0029` 行与顶部重放记录已更新。

**删掉的东西各自的调用方核对**

删前 grep 了 `managed-ga/code`、`runner/`、`core/src`、`cli`、`gui/src`、`scripts`，另查了 `.scratch` 与 `docs`。

- `process_lines`、`fit_process`、`PROCESS_MIN_STEPS`：只在 galley_im_display 自身、tgapp 被删的过程代码、两份测试里。
- `PROCESS_STEP_LINES`、`PROCESS_LINE_WIDTHS`：只在 galley_im_display 自身。
- `PROCESS_BUTTON_TEXT`、`PROCESS_GONE_TEXT`：galley_im_display、tgapp 被删的代码、dcapp 自己那一份、测试。
- `PROCESS_HIDE_BUTTON_TEXT`：galley_im_display、tgapp 被删的代码、测试。
- tgapp 的 `_Process`、`_processes`、`_process_block`、`_process_quote`、`_process_markup`、`_edit_process`、`_PROCESS_BUDGET`、`_PROCESS_CACHE_LIMIT`、`_PROCESS_SHOW` / `_PROCESS_HIDE`：只在 tgapp 被删的代码与 Telegram 测试里。`OrderedDict` 导入只为 `_processes`（`0024` 加的）。
- `_reply_markdown` 的 `sent`：`tgapp.py` 里唯一的 `sent=` 是 `_send_answer` 里的 `sent=process.sent`；`runner/im_resume.py` 只经 `**kwargs` 透传；`runner/im_reporter.py` 不调 `_reply_markdown`。没有别的调用方。
- dcapp 的 `_process_lines`、`_fit_process`、`_process_text`、`_PROCESS_*`、`self._processes`、`_remember_process`、`_on_process_click`、`_send_answer_text`：只在 dcapp 被删的代码与 Discord 测试里。
- fsapp 的 `_process_panel`、`_process_lines`、`_PROCESS_STEP_LINES`、`_PANEL_ICON`、`_CARD_BYTES_LIMIT`：只在 fsapp 被删的代码里。
- `.scratch` 与 `docs/devlog` 里的命中都是旧票与历史，没有评测脚本或接缝镜像导入这些名字。
- 上游原有的 `_step_panel`（`_TaskCard` 里）：没动。它只被 `_TaskCard._build` 调，而全文件没有任何地方实例化 `_TaskCard`，`_make_task_hook` 也没人调，所以它不在任何运行路径上（ledger 的 `0029` 行早写了 off the run path）。

**剩下的「过程」命中**：四处，都是注释，说的是墓碑或历史。tgapp 的 `_PROCESS_CALLBACK_PREFIX` 那行与 `handle_process_callback` 的 docstring；dcapp `_handle_interaction` 里说明旧 `galley-dc:proc` 走过期按钮那条路的注释；fsapp `0029` 段头注释里的「no 「过程」 panel since 2026-11-11」。

**测试**：Telegram 删 12 条只测过程的用例，1 条改名去掉过程断言（`/fold` 那条），新增 5 条：多步回答什么都不挂、多步回答与一步同样分段（最后一段不留空）、旧按钮静默应答并摘掉（含展开过的）、陌生人和锁定时旧按钮不动、摘按钮失败不抛。Discord 删 6 条，新增 2 条：多步回答（含分段）不带 view、旧按钮静默应答并摘掉且陌生人点了不动。飞书改写 3 条：卡片元素里只有正文、没有 `collapsible_panel`；分段卡片只有正文；卡片被拒时纯文字只有回答；提问续跑的步数累计改用 `_RUNS[0].total_steps()` 核。微信去掉断言里的末行，并新增 1 条：回复之后 `/stop`，回执跨提问累计步数与用时、不算等待（补回末行删掉后丢的覆盖）。`test_im_resume` 里展开过程那条改成多步回答只有通知行与回答。停止回执、提问消息、出错行的既有用例没改期望，原样通过。

**文档**：§9 里没有飞书的对话形态条目（票面说四条，实际只有 Discord、Telegram、微信三条），所以在 Discord 条目前新加一条「四个渠道：回答里只有回答」，三条改成指向它。devlog 链接是占位的 `../devlog/2026-11-11-im-answer-only.md`，主会话补上文件之前，`node scripts/check-docs-links.mjs` 会报这一处断链。§9 里 grep「不要 / 有意 / 分叉」，没有与本票冲突的定论：命中的是 Telegram 与飞书换 token 的差异、状态消息不要「已完成 N 步」头、StatusBadge 的分叉，以及微信条里「要不要跟进见 IM 打磨 PRD 待定」，本票裁决 3 正好结了它。`docs/ga-baseline.md` 冒烟清单四条已同步；Contract Surface 15、16 里没有随之不成立的话。

**门禁**：pytest 754 passed、6 deselected；`mypy runner` 无问题；`ruff check runner` 通过；`check-managed-ga-payload`、`check-ga-baseline-drift` 都 OK；`git diff --check` 干净；`check-docs-links` 只有上面那一处占位断链。

**没验证到的**：四个真渠道都没跑（第 6 节两列都还在）。旧按钮的墓碑只在假对象上测过：Telegram 对很旧的消息 `edit_message_reply_markup` 会不会报错、Discord 对旧消息 defer 后 `edit(view=None)` 能不能成，都靠吞错兜底，没在真平台上看过。

- 2026-11-11 补测（只动测试）：Telegram、Discord 各加两条，提问前 2 步 10 秒，等回复 60 秒，续跑 2 步后 `/stop`，回执是 `⏹ 已停止 · 4 步 · 用时 15 秒`；续跑出错时，错误上面那行是 `4 步 · 用时 13 秒`。等待不计，提问两边的步数与用时相加，现有代码原样通过。
- 过程中只有一处是测试自身的问题，没碰产品代码：Discord 那条起初还断言续跑状态消息是「02 确认方向」，可检查时第 3 步已经落定，消息正确地显示「03 改第一处」，这条额外断言依赖时序，已删掉。

### 2026-11-11 真机（JC，dev）

JC：「telegram 和飞书我刚刚真机测试了，都没有问题」。主会话对着渠道日志与内核日志核了走到哪几步（IM 对话不进 Galley 库）：

- Telegram：一个 2 步的任务答完（回答下面有没有按钮只有 JC 看得到，他报没问题）；接着问「过程给我看看」，只有一次模型回复、后面没有工具结果，即没有重跑；渠道重启并接回之后问「刚才怎么查的」，同样一次回复、没有工具调用。
- 飞书：重启接回后一个 2 步的任务答完，卡片里有没有面板只有 JC 看得到，他报没问题。
- 日志里看不出来的：点旧消息的「过程」按钮（摘除成功不写日志，也没有摘除失败的那一行）。JC 没单独提这一步。
- 没验：微信的多步回答末尾；Discord 全部。
