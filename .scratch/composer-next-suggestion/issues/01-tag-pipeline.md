# 01: `<next-suggestion>` 标签链路（prompt → 提取 → IPC）

Status: ready-for-human（已实现，待 dogfood 验收）

## 范围

- **Prompt 落点（勘误 PRD 定案 1）**：managed 模式的注入 seam 就是 core 的
  `managed_prompt.rs::RUNTIME_PROMPT_STATIC`（经
  `GALLEY_RUNTIME_PROMPT_TEXT` env → `install_managed_prompt_profile` →
  `backend.extra_sys_prompt`），Galley 自有代码，无需 managed-ga patch 文件。
  新增一节：最终回复末尾输出 `<next-suggestion>`，用户口吻祈使句、跟随会话
  主要语言、≤80 字符、无合适建议不输出。注意 `prompt_hash()` 会随之翻新
  （预期行为，新 prompt generation）。
- `runner/workbench_bridge.py`：`_on_turn_end` 从 `responseContent` 正则提取
  标签 → `TurnEndEvent.nextSuggestion`（可选字段）；标签加进 runner 剥离表
  （`workbench_bridge.py:102`）。
- 四处联动：`runner/ipc.py`、`core/src/ipc.rs`、`gui/src/types/ipc.ts`、
  `docs/ipc-protocol.md` §4.7，纯增量。
- GUI 剥离：`normalizeFinalAnswer`（`agent-turn.ts`）与流式渲染路径均剥
  `<next-suggestion>`（流式 delta 是 GA-raw，沿用 `<summary>` 同一条剥离机制,
  含尾部未闭合标签处理）。

## 验收

- runner pytest（提取/剥离）、cargo test（serde 往返）、gui 单测若有对应
  strip 测试则补 case。
