# PRD: ask_user 快捷选项携带说明（tooltip / 小字）

Status: wontfix
Date: 2026-08-11
关联: [galley#21](https://github.com/wangjc683/galley/issues/21)
（Kinda2419）

## 取消结论（2026-09-14，JC）

**不做。** 本机 workbench.db 四个月、107 个会话的全部 ask_user 调用（16 条
消息、21 次调用、13 组候选、55 条候选项）里，没有一条是「标签太短看不出
后果」：模型自己把后果写进标签（「不是/不确定，先不要发送」「~/Downloads/
_归档(留在原地,风险最小)」），6 字以内的短标签（编程 / 外语 / 结束任务）
本身无需解释。13 组候选 10 次点选、1 次自由回复（否定前提，非看不懂）、
2 次未答。报告人描述的痛点在本地零次出现，更像其特定模型 / 外部 GA 的
产出习惯。

同日 D2 的 row / list 自适应排布已解决候选侧真实出现过的问题（句子级候选
横排成标签云）。数据依据与重启信号见
[devlog](../../docs/devlog/2026-09-14-ask-user-option-desc-cancelled.md) 与
[deferred.md](../../docs/devlog/deferred.md) 「ask_user 候选项携带说明」。

下文为 8 月定案原稿，保留作历史。核对时另发现两处过期：01 漏了 GUI 侧
`mergedAskUserArgs` 这条从持久化 tool_calls 重建的读路径；03 的真实补丁点
是 `assets/tools_schema.json` / `_cn.json` 的 `candidates.items.type`，不是
docstring；且对象形状会被 GA 其余表面（`_compact_tool_args`、tgapp、tui）
`str()` 成 dict 字面量。若将来重启，先读这段。

## 背景与动机

Agent 经 ask_user 提问时，快捷选项按钮只有短标签（「方案A」「用 CDP」），
用户看不出选了会发生什么，结果是盲选或放弃按钮再追问一轮——快捷选项
本为省一轮交互，反而多花一轮。高影响确认（覆盖 / 不可逆 / 二选一方案）
标签越短后果越模糊，误点代价越大。

报告人方案（采纳其两步走建议）：候选项从纯字符串扩展为可带说明的对象
`{"label": "...", "desc": "..."}`，兼容纯字符串；UI 悬浮 / 键盘聚焦时
展示说明；Agent 侧约束模型为不可自解释的选项补说明。

现状触点（2026-08-11 核对）：

- `runner/workbench_bridge.py:1324` `_extract_ask_user` 把 candidates
  强转 `[str(c) for c in ...]` —— 对象形状会被字符串化，需先改这里；
- `AskUserEvent.candidates` 及 GUI `AskUserBubble.tsx` 均按 `string[]`
  处理；
- `gui/src/lib/ipc/ga-output-cleaning.ts` `stripGATags` 清洗
  question / candidates 文本，desc 也应过同一清洗。

## 定案决策（2026-08-11，JC）

1. **两步走**：先做 IPC / GUI 兼容扩展（`string | {label, desc}`，无
   desc 时行为与现状完全一致，纯 additive），再做 managed runtime patch
   里 ask_user 工具描述的「为选项补说明」约束。
2. **Rule 1 边界**：Agent 侧约束只进 managed GA patch stack；attach 模式
   外部 GA 不碰——外部 GA 自然不产出 desc，GUI 向后兼容正好覆盖，无需
   模式判断。
3. **视觉方案（tooltip vs 选项下方小字）走真机变体实测流程**：临时变体
   切换器（常驻可点击 pill）进 tauri dev 实测，测完拆、裁决进 devlog。
   初步倾向 tooltip 首选，但小字方案的触屏 / 纯键盘可达性是真实优势，
   以实测定。

## 报告人的体验要求（实现时对照）

- 键盘焦点（Tab）也能看到说明，不只 hover；
- 说明长时允许多行，不截断成单行省略号；
- 未提供说明时不留空 tooltip，外观与现状一致。

## 出口标准

- 老形状（纯字符串 candidates）端到端行为与外观零变化（含 attach 模式）；
- 新形状 desc 在选中变体方案下可见、可键盘触达、多行不截断；
- managed patch 后，涉及不可逆 / 覆盖 / 方案二选一的提问，模型稳定为
  选项补说明（dogfood 验证）；patch 遵循 managed-runtime 规则（最小、
  隔离、可重放，上游若提供同能力则移除）。

## Issues

- 01 数据面兼容扩展：runner 提取 + IPC 事件 + GUI 类型（`string |
  {label, desc}`）
- 02 GUI 呈现变体（tooltip / 小字）+ 变体切换器实测 + 裁决落 devlog
- 03 managed GA patch：ask_user 工具描述补「选项说明」约束
