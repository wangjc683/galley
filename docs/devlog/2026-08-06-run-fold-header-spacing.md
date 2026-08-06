# 折叠 run 的垂直节奏：折叠态移除 StrongHr，折叠头贴紧回答

日期：2026-08-06。起因：JC dogfood 高亮笔改版时观察到折叠态「用户消息
→ 折叠头 → 横线 → 回答」之间的留白均匀得可疑，直觉是折叠头到回答应该
更近。

## 实测

折叠态垂直节奏（margin 折叠取大后）：用户消息→折叠头 **24px**
（`my-5` vs `mt-6`）；折叠头→StrongHr **16px**（`mb-2.5` vs `my-4`）；
StrongHr→回答 **16px**。折叠头到回答共 **33px，大于用户消息到折叠头的
24px**——间距层级与语义分组相反：折叠头（`2 步 · 用时 35 秒 ·
读取文件 ×2`）是「回答如何产出」的元数据，是**回答的 eyebrow**，邻近性
却把它绑向了问题。

## 诊断

病灶不是间距参数，是 **StrongHr 在折叠态没有修辞对象**。它的语义
（DESIGN.md "result-first rhythm"，run-fold PRD 亦引）是「行动 →
结论」：展开态一列 tool callout 机件后，用硬线宣告结论开始。折叠态
机件已被折叠头压成一行 metadata，全宽强分隔线横在「一行小字」与正文
之间——修辞失去 referent，还把全场最强的一条线画在最不该有边界的地方
（折叠头与其所属回答之间），而真正的边界（用户 ↔ agent）无线。

## 定案

- **折叠态：不渲染 StrongHr**（`AgentTurnView` 以 `hideMarker` 为键——
  该 flag 仅在 folded 分支置位，展开态收口 turn 走完整渲染，语义精确）。
  折叠头 `mb-2.5`（10px）直接贴回答。节奏变为：问题 —24px—
  [折叠头 —10px— 回答]，方括号内绑定为一个单元。
- **展开态：StrongHr 原样保留**——机件列可见，修辞职责完整。
- **轮间距暂不动**（answer→下一问 20px < 问题→折叠头 24px 的轻微倒挂
  记入 deferred.md 观察项）：一次只改一个变量，高亮笔触已提供强边界，
  等 dogfood 说话。

## 联动

`Conversation.tsx`（`hideMarker` docstring + StrongHr 调用点条件与
供词注释）、run-fold PRD `.scratch/conversation-run-fold/PRD.md`
§4 折叠渲染修订注记、`deferred.md` 新增轮间距观察项。
