# PRD: 飞书 / Telegram / 微信重启后接回上下文

Status: 实现已提交、真机待验（2026-09-30 JC 裁 F2：三个渠道一起做）
Date: 2026-09-30
来源：Discord 重启续接（`0026`）真机通过后，JC 问飞书和 Telegram 是否也该保留；讨论后 JC 选 F2（飞书 + Telegram + 微信）
关联：[Discord 06](../discord-ux/issues/06-restart-continuity.md)（`0026`，本题的模板）·
[Discord 对齐 devlog](../../docs/devlog/2026-09-30-discord-conversation-ux.md)「重启后无缝续接」节

## 问题

飞书、Telegram、微信都是整个进程一个 agent（`fsapp.py:562` 懒建、`tgapp.py:46`、`wechatapp.py:305` 模块级），没有激活门槛，
重启后照常回复——但上下文被**静默**清空，连提示都没有。重启远比想象频繁：`feishu.log` 里「飞书 Agent 已启动」353 次，2026-09-30 一天
8 次；来源包括手动「重启 Channels」、改模型配置后 toast 的「重启 Channels」CTA（`overlays-and-settings.md:284`）、app 更新、tauri dev。
「重启 Channels」确认弹窗只写「可能中断当前回复；不会退出登录」（`zh.ts:1284`），没告知上下文会丢。用量：飞书日志 6319 行、
Telegram 746 行、微信 368 行。

## 裁决（JC，2026-09-30）

- **F2：三个渠道一起做**（否决 F1 飞书 + Telegram、F3 只飞书、F4 暂缓）。
- 行为照 Discord `0026`：记当前 GA 日志文件名、启动时接管上一进程留下的锁并续接、接不上时下一条回答提示一次、`/new` 换新日志。
- **微信补 `/new`**（主会话补裁，F2 的直接后果）：微信前端没有 `/new`（`on_message` 只认 `/switch` `/stop` `/llm`），重启是它清空上下文的
  唯一途径；续接之后若不补，微信的上下文将永远清不掉。
- **断开连接清掉续接状态**（主会话补裁，实施中子代理提出）：Core `logout` 删 `context_log.json`，Discord 另删 `discord_active_channels.json`，
  重连从头开始；解绑使用者不清。理由见 [devlog](../../docs/devlog/2026-09-30-im-restart-continuity.md)。
- 不加「闲置 N 小时后不续接」的过期规则：上下文长度由 GA 裁剪兜住（`llmcore.py:107`），「有时记得有时不记得」比「一直记得、要清就 `/new`」
  更难理解。代价：每轮 token 贴着裁剪线；频繁重启的开发者感受最明显。

## 实施

- [01 三个单 agent 渠道重启续接](./issues/01-single-agent-channels.md)

## 运行时影响

外置 GA 零变化（Channels 只跑内置 runtime）。宪法第 4 条：只持久化日志文件名，不存对话内容（同 `0026`）。GUI 弹窗文案不用改。
