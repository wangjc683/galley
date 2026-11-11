# 01 四个渠道撤掉过程入口

Status: ready-for-agent

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
