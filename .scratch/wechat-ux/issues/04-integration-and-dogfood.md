# 04 集成验收 + 真机

Status: ready-for-human
Blocked by: 01, 02, 03
PRD：[../PRD.md](../PRD.md)

## 集成（主会话）

- 01 / 02 的接缝：`start_wechat_reporter(conversation, state_dir)` 真接上；`render` 与回答正文同口径（去重成一个函数）；
  `busy()` 在排队 / 在跑 / 空闲 / 报告轮四种状态下的真值。
- 报告轮的 ask_user 不被用户 run 认领；报告轮期间用户发消息正常排队。
- 全量门禁：pytest、mypy strict、ruff、cargo test --workspace、gui typecheck / lint（未动 GUI 也跑一遍）、`git diff --check`、全角标点检查。
- 文档：devlog、`docs/design/overlays-and-settings.md` §9（微信对话形态）、`docs/ga-baseline.md`（耦合点：`wechatapp.agent` / `WxBotClient` /
  `_dl_media` / `_TEMP_DIR` 由 runner 直接用；item 16 续接描述）、`docs/devlog/deferred.md`（删「微信渠道的任务完成汇报」，加「微信引用消息」）、
  `docs/project-status.md`、`.scratch/wechat-ux/` 状态。

## 真机清单（JC，dev 窗口；先确认 /Applications 里的 Galley 没在跑）

1. 闲聊一句（1 步）→ 一条回答、无末行、无 `[任务已完成]`；「对方正在输入」随回答消失。
2. 多步任务（如「看看磁盘还剩多少，再看看下载文件夹多大」）→ 运行中只有「对方正在输入」、不推过程；一条回答，末行 `N 步 · 用时 X`。
3. 让它列步骤 / 给链接 → `1.` 编号、链接正常。
4. 触发 ask_user（如「帮我清理缓存，先问我清哪个」）→ 一条提问，编号候选 + `⏸ 回复序号或文字 · 已完成 N 步`；回 `2` → 按第二项继续；回答末行步数累加。
5. 长任务中 `/stop` → 立即 `⏹ 已停止 · …`，之后不再有回答；空闲时 `/stop` → `当前没有在跑的任务`，再问一句，回答正常。
6. 连发两条（第一条还在跑）→ 两条回答按顺序到，中间不提前取消「正在输入」。
7. 语音说一句问题 → 当文字处理。
8. 让它生成一个文件发给你 → 正文是文件名、文件随后到。
9. `/new`（运行中）→ `⏹` 回执后 `🆕` 回执；重启 Channels 后说话 → 接得上（09-30 续接未回归）。
10. 委派：「开一个 Galley 会话帮我……做完告诉我」→ 任务结束后微信收到 `✅ {标题}` 汇报，末行 `已完成 · {id}`；重启 Channels 后
    再委派一次、不说话等它完成 → 汇报照到（owner 持久化）。

## Comments
