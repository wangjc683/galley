# 11 新段带上段首之前的最近几轮

Status: ready-for-agent

来源：主聊天 PRD 裁决 50（2026-10-13，JC 按建议推进）。deferred「主对话的跨段连续性」第 1 级，不等两周信号提前做。

## 为什么

主对话空闲超过 4 小时，下一条消息开新段（03a，`core/src/session_runner/segment.rs`），新 runner 只拿到本段（`core/src/session_runner/replay.rs:234`）。
用户发一条，4 小时后接着发，助理已经不记得上一次说了什么；界面上那几句还在眼前。JC：「这体验非常不好」。
事项账本撤掉（裁决 49）之后，段首没有任何东西垫着，这一条要先补上。

## 规则（确定式，Core 内，不加模型调用）

- **只在主对话、只在新段**：主对话有段界（`main_chat_segment_start` 不为 `None`）时，回放在本段之前带上**段首之前最近 3 轮**。第一段（没有段界）照旧从头回放；其他会话、外置运行时零变化。
- **一轮**：同一 `turn_index` 的用户消息与它的回复（`rows_to_conversation_messages` 认的 `user` / `assistant` 行）。只算有用户消息、也有回复的完整轮；问候（`shown_only`，`turn_index -1`）不算、不带。
  取的是段首之前最近的 3 轮，不管它们在哪一段（上一段只有 1 轮，就再往前取）。
- **字数上限 6,000 字**（按 Unicode 字符计，带过去的部分合计）：超了从最早的一轮整轮丢。
  最近一轮单独就超限时：用户的话完整保留，回复只留结尾（最终答案在结尾），截掉处用明确的标记（如 `[…]`）让模型知道被截过；
  用户的话本身就超过上限的一半时，也截到一半，规则一样（回报你怎么定的）。
- **常量**：3 轮、6,000 字写成常量，不做 prefs、不进设置。
- **确定、可重放**：带哪几轮只由库里的行与段界算出，Core 重启、runner 变冷再回放，结果一样。建议回放与状态块共用一个算「带过去的窗口」的函数，免得两边对不上。

## 告诉模型

- 状态块的「## Main Chat」一节（`core/src/managed_prompt.rs` `main_chat_section`，`segment.rs` 的 `MainChatPromptState`）补一句：
  上下文开头那几轮来自上一段，最后一条是什么时候说的（本地时间，精确到分钟），中间隔了一段时间。不然用户 5 小时前说的「我出门了」会被当成刚说的。
- 没有带过去的轮（第一段，或段首之前没有完整轮）时，这一句不出现。
- 「Earlier parts are not in your context」的说法跟着改准：更早的部分仍要查历史。
- `MAIN_CHAT_SECTION_BUDGET_BYTES` 跟着调，测试里写清新的最长取值与理由（这一节每次请求都带）；字节数去掉 `\r` 计（Windows CI 检出是 CRLF）。

## 文档

- `docs/managed-ga-runtime/runtime-modes-and-sessions.md`「main chat segments」一节（回放只给当前段那条）。
- `docs/managed-ga-runtime/prompt-composition.md`「Main Chat」一节的原文块。
- `docs/architecture.md:138-144` 如有说法对不上就改。
- 不改：devlog、票 03、PRD 的历史裁决、`docs/devlog/deferred.md`（主会话结票时改）。

## 验收

- 新测试覆盖：第一段不带；新段带最近 3 轮；上一段不足 3 轮时往前取；问候不带；未完成的轮（只有用户消息）不带；整轮丢弃与最近一轮截尾；重放结果一致；状态块那一句有 / 无两种情况。
- 用 03a 的真机办法能复现（PRD 票 03 第 101 行：把 `main_chat_segment_idle_hours` 设成 `0.01`，发一句、等 36 秒再发，问「我们刚才聊了什么」），这次应接得上。这一步在合入后由主会话做，子代理只写清步骤。
- `cargo test --manifest-path core/Cargo.toml --workspace`，并在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍（状态块里有本地时间）。
- 六个门禁脚本：`node scripts/check-{ipc-protocol-drift,supervisor-sop-drift,docs-links,version-consistency,managed-ga-payload,ga-baseline-drift}.mjs`；`git diff --check`。
- 只对自己动过的文件跑 `rustfmt`（core 不是 rustfmt-clean）。

## Comments
