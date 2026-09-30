# PRD: Telegram / 飞书重启后接回上下文

Status: 暂缓（2026-09-30：Discord 先做（`0026`），其余渠道等 Discord 真机跑顺后再推广）
Date: 2026-09-30
来源：JC 真机发现 Discord 重启 Channels 后要重新 @ 才回复；讨论中确认 Telegram / 飞书重启后上下文同样会丢，只是没有激活门槛所以不显眼
关联：[discord-ux 06](../discord-ux/issues/06-restart-continuity.md)（Discord 的实现，本题的模板）·
[deferred「IM 渠道重启后接回上下文」](../../docs/devlog/deferred.md)

## 问题

Telegram 与飞书启动时各新建一个空白 agent（`tgapp.py:46` 模块级 `GeneraticAgent()`、`fsapp.py:562`），重启 Channels、
Galley 重启或更新后，之前的对话上下文全部丢失；用户只能手动 `/restore` 或 `/continue n` 找回，而且不会被告知上下文已丢。

## 方案（照 Discord `0026`）

- 持久化「聊天 → 当前 `agent.log_path`」映射（只存文件名，不存对话内容；宪法第 4 条 2026-08-13 解释）。
- 启动后 agent 首次处理该聊天时，用上游 `continue_cmd.continue_inplace` 按日志续上；锁与失败提示的处理沿用 `0026` 的结论。
- Telegram 是单 agent：映射只有一条，启动时即可续接。飞书看其会话模型再定。

## 启动信号

Discord `0026` 真机跑顺（重启后续接可靠、无锁冲突）；或 JC 在 Telegram / 飞书里遇到「重启后它不记得刚才的事」。

## 运行时影响

外置 GA 零变化（Channels 只跑内置 runtime）。
