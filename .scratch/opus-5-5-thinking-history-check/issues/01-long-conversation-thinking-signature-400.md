# Opus 5.5 长对话可能撞上思考块的历史校验（未验证）

Status: needs-triage（2026-11-17 读代码得出，没有实测；JC 未裁）
日期：2026-11-17
来源：把 Anthropic 预设的预填模型改成 `claude-opus-5-5` 时主会话读代码发现，见 [devlog](../../../docs/devlog/2026-11-17-official-apis-no-impersonation.md)。

## 担心的是什么

Claude Opus 5.5 的思考块带签名，签名里绑定了它产生时的对话前缀（系统提示词、工具集合、它之前的每一条消息）。把思考块原样发回去时，接口会校验这段前缀有没有被改过；被改过就返回 400：

```text
Invalid `signature` in `thinking` block. The block is bound to a different conversation.
```

按官方迁移说明，这项校验对 2026-08-31 之后创建的账号默认强制执行；更早的账号只记录不拦截。Opus 4.8 没有这项校验。

内核的做法正好会改前缀：

- 带签名的思考块原样存进历史并在下一次请求里发回（`managed-ga/code/llmcore.py` 的 `_parse_claude_sse` 与 `NativeClaudeSession.ask`）。
- `compress_history_tags` 每隔几轮就地截短较早消息里的长文本（保留最近 10 条）。
- `trim_messages_history` 在历史超过上限时从前面裁掉消息，并改写裁剪点上的那条用户消息。

所以一个新账号用 Opus 5.5 跑十几条消息以上的多步工具任务，机制上可能撞上这个 400。短对话不受影响。

## 没验证的

- 没有复现过。2026-11-17 JC 用 Opus 5.5 的对话只有两条回复。
- JC 的 Console 账号是否在强制执行的范围内，没有确认。
- 思考块默认不返回正文（只有签名），截短思考正文那一步是否实际改到东西，没有看。

## 怎么验

用 2026-08-31 之后创建的 Console 账号，在 Galley 里用 `claude-opus-5-5` 跑一个会连续调用工具十几步以上的任务（例如让它读一个目录里的十来个文件再汇总），看有没有上面那句 400。

## 复现之后可选的方向（都没评估）

- 让 Anthropic 协议的会话不把思考块存进历史（内核已有 `omit_thinking` 选项，Galley 没有露出，也没有写它）。
- 请求里声明「前缀不一致时丢掉思考块而不是报错」（接口有对应的控制项，需要一个 beta 头）。
- 把预填模型退回一个不做这项校验的型号。

三条的代价不一样：前两条要动内核的请求，第三条只改一个默认值。只动内置内核，外置 GA 零变化。

## Comments
