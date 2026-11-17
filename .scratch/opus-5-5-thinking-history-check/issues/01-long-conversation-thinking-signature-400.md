# Opus 5.5 长对话可能撞上思考块的历史校验（未验证）

Status: done（2026-11-17 发版前在 dev 里复现；修法见票 02，JC 裁「官方地址不发回思考块」）
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

## Comments

**2026-11-17 复现（主会话，dev，官方地址，`claude-opus-5-5`）**

- 第一轮让它读 16 个文件：模型并行读，7 次请求做完，只有第一步带思考块，没有报错。这一轮不算数：没有出现「旧消息被截短之后还有思考块」的情形。
- 第二轮是逐步推理的链式任务：第 8–13 次回复都带签名的思考块，第 14 次请求返回 400，`Content before this block differs from when it was created, first at messages.2.content.0`。`messages.2` 是第一批工具结果，被 `compress_history_tags` 截短（第 7 次截过一遍，第 14 次又截了一遍）。
- 再发一句：同一个 400。JC 的 Console 账号在强制范围内。
- 停掉 runner 再发一句（历史从 Galley 的库恢复，不带思考块）：这一次接口返回的是 `stop_reason: refusal`，内核只留下 `[Error: Claude refusal]`，类别没有记下来。只有这一次，原因没查。
- 「怎么验」里写的「用 2026-08-31 之后创建的账号」之外，老账号也能强制复现：请求里显式设 `thinking.block_binding.prefix_mismatch_behavior`（beta `thinking-binding-controls-2026-08-01`）。这次没用到。

**三种修法与裁决**见 [v0.7.9 发版 devlog](../../../docs/devlog/2026-11-17-v0.7.9-release.md)。

