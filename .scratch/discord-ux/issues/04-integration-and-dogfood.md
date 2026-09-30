# 04 集成验收 + 真机 dogfood

Status: done
Blocked by: 01, 02, 03

## 主会话集成验收（票与票之间的组合地带）

- 03 的 `send_report` → 01 的 `deliver_embed`：真实 dcapp 模块 + 03 的 `DiscordChannel` 串起来跑一次（stub discord），
  确认签名、截断、异常冒泡对得上。
- reporter 的 `busy()` 读 `app.user_tasks.get(chat_id)`：01 改了登记结构后，排队 / 运行 / 空闲三态下它的真值是否正确。
- reporter 的报告轮直接 `agent.put_task(...)`，不经 `run_agent`：报告轮运行期间用户发消息 → 应显示「排队中」，报告轮结束后再跑。
- 补丁栈：干净克隆 + `scripts/build-managed-ga.sh` 重放 0001..0023，payload 与仓库逐字节一致；`check-managed-ga-payload.mjs` 绿。
- 全量：runner pytest / mypy / ruff、`git diff --check`。

## 真机（JC）

前置：**先退出 /Applications 里的 Galley**（两个进程同 token 会双回复），`pnpm --dir gui tauri dev`，Settings → Channels → Discord 打开
（debug 构建直接读仓库 `managed-ga/code`，改动后要关再开 Discord 开关让 IM 进程重启）。

1. 闲聊一句：只有一条回答，首行小字 `1 步 · 用时 N 秒`；没有「思考中...」残留。**→ 1 步也带小字，看了再定留不留**
2. 让它查 Galley 状态（多步）：状态消息原地变化，≥ 2 步出现「已完成 N 步」，底部有「正在输入…」；结束后状态消息消失，只剩回答。
3. 长任务中点「停止」：状态消息定格「⏹ 已停止 · …」。
4. 让它给几个选项问你（例：「用 ask_user 问我今天想做哪件事，给三个候选」）：看到问题 + 按钮；点一个 → 提问消息变回显并勾选，接着跑，
   最终小字步数是两段之和。再试一次直接打字回答。
5. 连发两条：第二条显示「排队中」，第一条的回答以引用原问题的形式出现（如果中间插了消息）。
6. 派一个会话任务后等完成报告：卡片形态，标题是 session 标题，色条和 footer 状态对。
7. `/btw 进展如何`、`/help`（含退出词）。
8. 手机上看一遍推送：一轮对话只推一次（回答），提问推一次。

## Comments

### 2026-09-30 · 主会话集成验收（完成）

- seam 契约：真实 dcapp（stub discord）+ reporter `DiscordChannel.send_report` 端到端发 > 4096 报告，卡片 / 余段 / 颜色 / footer 全对；
  补回归测试 `test_reporter_card_through_real_deliver_embed`。
- busy 口径：排队 / 运行 / 空闲三态正确；补回归测试 `test_reporter_busy_tracks_queued_and_running_runs`。
- 报告轮期间用户发消息 → 「排队中」（01 偏差 1，测试已覆盖）。
- 「提问待答期间报告可插入」：裁决保留，理由见 devlog「集成验收」节；真机若见模型把报告当回答再重审。
- 补丁栈独立复核：干净克隆 + `build-managed-ga.sh` 重放 22 个全 clean，`dcapp.py` 哈希与工作区一致；payload 检查绿。
- 全量：pytest 343 passed / mypy / ruff / `git diff --check` 绿。
- 台账 0023 行把 `.scratch/discord-ux` 引用改为 devlog（`.scratch` 发版后删）。

剩余：上面「真机（JC）」清单。

### 2026-09-30 · 真机验收（JC）

通过。三个判断点（1 步回答带小字、回显保留旁白、typing 残留）按现状保留。`.scratch/discord-ux/` 随下个版本发布后删除（durable 内容已在 devlog）。
