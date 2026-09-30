# 04 集成验收 + 真机 dogfood

Status: ready-for-human
Blocked by: 01, 02, 03

## 主会话集成验收（票与票之间的组合地带）

- 03 的 `send_report` / `render` → 01 的 `answer_text` / `markdown_v2_segments`：真实 tgapp 模块（stub telegram）+ reporter
  `TelegramChannel` 串起来，用一段真实形态的报告轮 `done`（多步、带 🛠️ 回显、带表格）跑一次，确认只剩收尾那一步、表格已列表化、
  标题行 / 脚注 / 分段对得上。补成回归测试。
- reporter 的 `busy()` 仍读 `agent.is_running`：报告轮期间用户发消息 → 用户 run 显示 `·· 排队中`，报告轮结束后接着跑。
- 报告轮里的 ask_user 不被用户 run 认领（02 的按 queue 认领）。
- 补丁栈：干净克隆 + `scripts/build-managed-ga.sh` 重放 0001..0024，payload 与仓库逐字节一致；`check-managed-ga-payload.mjs` 绿。
- 全量：runner pytest / mypy / ruff、`git diff --check`；中文新增行全角标点检查（scratchpad 脚本）。

## 真机（JC）

前置：**先退出 /Applications 里的 Galley**（同 token 两个 polling 进程会互相 Conflict），`pnpm --dir gui tauri dev`，
Settings → Channels → Telegram 关再开（debug 构建直接读仓库 `managed-ga/code`，改动后要重启 IM 进程）。

1. 闲聊一句：草稿显示 `·· 思考中`，3 秒后开始读秒；完成后只剩一条回答，草稿不残留。
2. 多步（例：「看看 Galley 现在有哪些会话」）：草稿三行变化，≥ 2 步出现「已完成 N 步」。
   **折叠头三选一**：默认 b；`/fold a`、`/fold c` 各再问一次（多步、单步各看一眼），看完告诉我选哪个。
3. 表格：「把这台 Mac 的磁盘占用列成表格」→ 显示成列表，没有竖线。
4. 长任务（例：「运行 sleep 45 再告诉我结果」）：读秒过 60 秒变「已 1 分 … · 仍在运行」；**草稿全程不消失**（30 秒过期保活）；
   中途 `/stop` → 只有一条 `⏹ 已停止 · …`。
5. ask_user（例：「用 ask_user 问我今天想做哪件事，给三个候选」）：一条提问 + 按钮；点一个 → 原题变回显并打勾、接着跑，
   最终步数是两段之和。再来一次直接打字回答；再来一次多选。
6. 连发两条：草稿出现「另有 1 条消息排队中」；两条都有回答，第二条的回答引用原消息。
7. 派一个会话任务等完成报告：粗体标题行 + 正文 + 斜体脚注。
8. 手机推送：一轮只推一次（回答）；提问推一次；长回答第二段起不响。

## Comments

### 2026-09-30 · 主会话集成验收（完成）

- seam 契约：真实 tgapp（stub telegram）+ reporter `TelegramChannel` 端到端，多步报告轮 `done`（带 🛠️ 回显、表格）→ 只剩收尾一步、
  表格列表化、标题粗体、脚注斜体、`parse_mode` 为 MarkdownV2；补回归测试 `test_reporter_through_real_tgapp_seams`，第一次跑即通过。
- busy 口径（`agent.is_running`）不变；报告轮期间用户发消息显示 `·· 排队中`（`test_queued_behind_reporter_turn_and_other_messages`）；
  报告轮的 ask 不被认领（`test_ask_from_other_task_is_not_claimed`）。
- 「提问待答时报告可插入」沿用 Discord 的保留裁决；reporter 直发不登记消息 id、报告夹在中间时回答不引用触发消息——影响小，记入 devlog。
- `answer_text` 收尾一步无可见正文时回退整份清洗（同 dcapp `answer_body`）：接受，SKIP 判断不受影响。
- 补丁栈独立复核：新克隆 + `build-managed-ga.sh` 重放 23 个全 clean，`managed-ga/code` 全部文件哈希与工作区一致；payload / baseline-drift 检查绿。
- 全量：pytest 407 passed / mypy / ruff / `git diff --check` 绿；新增中文行全角标点检查 0 处。
- 台账 `0024` 行把 `.scratch/telegram-ux` 引用改为 devlog（`.scratch` 发版后删）。

剩余：上面「真机（JC）」清单；裁决折叠头后另开小票拆 `/fold` 与落选变体（补丁重导出）。

