# 01 IM supervisor 一问就读全量会话列表，上下文暴涨、答得慢

Status: needs-triage
Date: 2026-09-30
来源：Discord 体验讨论时读 `discord.log` 顺带发现（[discord-ux PRD](../../discord-ux/PRD.md)），JC 同意另立题
影响面：四个 IM 渠道共享（问题在 IM supervisor 提示词 / CLI 用法，不在 Discord 前端）

## 现象（2026-09-30 14:38，Discord，模型 `NativeClaude/glm-5.3-flash`）

JC 在频道里发了 3 条短消息（2 / 5 / 12 字）。第三条之后 supervisor：

1. 跑 `galley llm --help`（先摸命令用法）；
2. 同一步里跑 `galley llm list` 和 **`galley sessions list --runtime all --all`**——`--all` 含 archived，
   `--runtime all` 含外置 GA 会话，日志里这一次吐出 37 条 archived 在内的上百条会话 JSON 行；
3. 上下文从 658 字符涨到 28574 字符（`[Debug] Current context`），三轮模型调用才给出回答。

证据：`~/Library/Application Support/app.galley/managed-ga-state/im/discord/discord.log` 499–670 行
（`COMMAND ('sessions', 'list', '--runtime', 'all', '--all')`）。

## 可能的方向（未评估）

- IM 提示词（`core/src/managed_prompt.rs` `im_supervisor_prompt`）写明「默认 `sessions list` 即可，不要加 `--all` / `--runtime all`，除非用户问归档或外置会话」。
- CLI 加 `--limit N`（Agent API 属于公共契约，按 Rule 3 只能增量添加）。
- 与问题无关的读动作：12 字的问题为什么要列会话？可能是提示词「Inspect current Galley state before creating or changing sessions」被过度执行——但这条问题本身未必要建会话。

## 待定

- 是否先量一次：`workbench.db` 里 supervisor 发起的 CLI 调用中 `--all` 的占比（需要看 supervisor 侧日志，GA 的 `model_responses` 里有）。
