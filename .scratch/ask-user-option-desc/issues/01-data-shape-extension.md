# 01 数据面兼容扩展：`string | {label, desc}`

Status: ready-for-agent

## 范围

- `runner/workbench_bridge.py:1324` `_extract_ask_user`：停止无条件
  `str(c)` 强转，识别 dict 形状（`label` 必填，`desc` 可选），非法形状
  降级为字符串化（不抛错、不丢选项）。
- `AskUserEvent.candidates` 事件形状：additive 扩展，纯字符串仍合法。
  核对 `docs/ipc-protocol.md` 是否需要同步记录。
- GUI：`gui/src/types/ipc.ts` 类型、`AskUserBubble.tsx` 消费端、
  `stripGATags` 对 label 与 desc 都过清洗。
- CLI 面若透出 ask_user 候选项（核对 agent-api 文档），同样 additive。

## 验证

- runner 单测：纯字符串 / dict / 混合 / 非法形状；GUI 单测：类型与
  清洗。老形状端到端零变化（含 attach 模式）。
- runner 三件套 + `pnpm --dir gui typecheck` / `lint`。
