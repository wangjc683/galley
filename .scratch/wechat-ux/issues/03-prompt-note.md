# 03 入口层提示词去掉微信注记

Status: done（主会话做）
PRD：[../PRD.md](../PRD.md)（问题 8）

10-06 IM 入口层给微信单开一条：「WeChat shows only a Markdown link's text and drops `1.` list numbers: write URLs bare and number steps `1、` `2、`.」
（`core/src/managed_prompt.rs:279-283`）。原因是上游 `_strip_md` 删 `1.`、剥链接地址；01 不再调用它，2026-10-10 探针证实微信原生渲染
`1.` 编号与链接，这条成了多余的平台分支。

- 删 `platform_note` 分支与相关断言 / 回归项（`managed_prompt.rs` 测试、`docs/managed-ga-runtime/prompt-composition.md` 的说明与回归清单第 17 条）。
- 字节预算只会变小。

## Comments
- 2026-10-10 主会话完成：删 `platform_note` 分支；`im_supervisor_prompt_shapes_replies_for_a_phone` 改为四个平台都不含 `write URLs bare`；
  `IM_PROMPT_BUDGET_BYTES` 1503 → 1383（零余量口径不变：最长变体换成 Telegram，微信版 1381 字节）；`prompt-composition.md` 的说明与回归第 17 条改写。
  `cargo test --lib managed_prompt` 18 passed，`rustfmt --check` 绿。
