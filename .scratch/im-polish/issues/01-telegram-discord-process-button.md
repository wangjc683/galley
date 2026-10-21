# 01 Telegram、Discord 的「过程」按钮

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 1、2。

## 要做的

**Telegram（补丁 `0024`，`frontends/tgapp.py` 与共享的 `frontends/galley_im_display.py`）**

- 回答消息里不再放折叠头（`_fold_header` 那个可折叠引用块），1 步也不放。
- ≥ 2 步的回答下面挂一个内联按钮「过程」。点了把这条消息编辑成「回答 + 末尾一个引用块」：引用块第一行 `N 步 · 用时 X`（`fold_label`），下面逐步 `NN 摘要`（沿用今天的步行与截断规则：最多 30 步、过长时按 60、24 字截）；按钮换成「收起过程」，再点还原。步骤很多、展开后超长时，展开区用可折叠引用块（Telegram 收起时露三行），否则用普通引用块；超出单条消息上限时照今天的预算规则截。
- 步骤清单按回答消息 id 缓存在进程内（有上限的 LRU，不持久化）。渠道重启后旧按钮点了用 callback 的 toast 回一句「过程已不在了（渠道重启过）」，不改消息。
- 回答分成多条消息时（超长），按钮挂在最后一条上，展开只编辑最后一条。
- 不动：在跑时的静音状态消息、`/stop` 定格的 `⏹ 已停止 · …`、提问消息的 `⏸ 等你回复 · 已完成 N 步`、完成报告（`runner/im_reporter.py` 的 `send_report`）。核一遍 reporter 走的 seam（`answer_text`、`markdown_v2_segments`）不受影响。
- 群聊里（若有）同样挂按钮，展开改的是那条消息本身。

**Discord（补丁 `0023`，随后照规矩在新 `0023` 上重导出 `0026`）**

- 撤掉回答首行小字 `-# N 步 · 用时 X`，1 步也不挂。
- ≥ 2 步的回答挂一个按钮「过程」，点了回一条 ephemeral 消息（只有点击者看得到），内容同 Telegram 展开区（第一行 `N 步 · 用时 X`，下面逐步 `NN 摘要`）。方案与实施要点照 `docs/devlog/deferred.md`「Discord 回答的步骤展开」（按回答消息 id 的进程内 LRU、重启后点击回一句过程已不在）。
- 不动：状态消息、停止定格、提问、完成报告、私信照旧关着。

## 约束

- 补丁流程照 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Modify An Existing Patch」：改 `0023` 后必须在其上重导出 `0026`（zero-context 补丁会静默落偏，09-30 devlog 末节有实测）；干净克隆重放全部补丁、重建后 `managed-ga/code` 哈希与工作区一致；台账（manifest / 补丁说明）同步。
- 平台无关的逻辑（展开区文本、步行截断）放进 `galley_im_display.py`；Discord 那边的 `_` 前缀副本能不能换成导入，照 09-30 devlog 裁决 5 的迁移条件判断，不满足就别动。
- import `managed-ga/code` 的脚本与测试用 `python -B`（否则留下 `__pycache__`，payload 检查会报）。
- 写 Telegram 的 MarkdownV2 与 Discord 组件前，读一遍当前 Bot API / discord.py 的按钮、编辑、ephemeral 用法，别凭记忆；编辑消息时保留原有的 `parse_mode` 与回复引用。
- 两边的测试都要补：≥ 2 步挂按钮、1 步不挂、展开与收起的文本、重启后点击的 toast、超长截断、分条时只挂最后一条。

## 验证

- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check`。
- `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs`。
- 干净克隆重放补丁栈全 clean。

## 交付

在 worktree 分支上提交（只点名文件），票 Comments 写实施偏差与没验证到的；Status 改 `needs-dogfood`。真机验收由 JC 在 dev 里「重启 Channels」后做：Telegram 私聊发一个 1 步、一个多步的问题，点「过程」展开、收起，看推送预览从回答开始、有没有「已编辑」；Discord 频道同样，看 ephemeral。

## Comments
