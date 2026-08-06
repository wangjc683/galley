# 0017：Anthropic 兼容端点的 input token 记账修复（↑0 bug）

日期：2026-08-06。JC dogfood 发现 Footer telemetry 的 ↑ 恒为 0（↓ 正常），
glm-5.2 会话连续复现。

## 根因

managed 模式的 Zhipu GLM preset 走 `protocol: "anthropic"`（messages
SSE）。上游 llmcore `_parse_claude_sse` 只在 `message_start` 记录 input
usage，`message_delta` 只读 `output_tokens`。真 Anthropic 在 message_start
带 `input_tokens`；**Anthropic 兼容端点（GLM 等）在 message_start 给
零值/空 usage，把完整累计 usage 放在结尾的 message_delta**——input 侧
永远记 0。影响所有 anthropic-protocol 兼容 preset 及 `/cost`、subagent
日志扫描。

## 修复（`0017-managed-compat-usage-accounting.patch`）

- `llmcore.py`：message_delta 上加 input 侧兜底——仅当 message_start 未
  记到 input 时触发（真 Anthropic 流不重复计数）；`output_tokens` 置零，
  `[Output]` print 保持唯一 output 记账；顺带多打的 `[Cache]` 行让
  subagent 日志扫描一并被修复。
- `frontends/cost_tracker.py`：messages 模式的 `requests` 只在携带真实
  usage 的调用上递增（兼容端点每请求两次 `_record_usage` 调用，原计数
  会翻倍），零值占位调用不再清掉 `last_input`。

按补丁纪律全流程：双账本登记（manifest.json + patches/manifest.md 表行，
rebase 风险注明与 0016 同区域、保持顺序）；基线干净 clone 全栈 17 补丁
重放，payload 字节一致，编译扫描过。移除条件：上游自己从 message_delta
记 input，或兼容端点在 message_start 报真实 usage。

教训一条：telemetry 的字段级 bug 在 GUI 只显示为「一个可疑的 0」，
从 GUI 逐层向下（telemetryInputTotal → runner `_final_turn_telemetry` →
cost_tracker → llmcore SSE 解析）排查比猜测快——每层都能用「哪个字段
有值、哪个没有」二分。
