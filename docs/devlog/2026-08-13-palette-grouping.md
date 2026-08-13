# Command Palette 分组：推翻 §8「结果少时不显示 header」

日期：2026-08-13
关联：`CommandPalette.tsx`、`command-palette.css`、
[overlays-and-settings §8](../design/overlays-and-settings.md)

## 背景与结论

JC 发现 ⌘K palette root 列表混排多种类型条目，探讨是否分组。结论：
**采纳全组头方案**。§8 原条款「大多数情况下不显示 header（结果少时
header 是噪音）」写于 V0.1 收敛期（New chat + 8 session + 4 action）；
实现此后长出全文命中（原定 V0.2）、New project、Reset layout，默认态
15 行、四种语义（新建 / 会话 / 内容命中 / 操作），「结果少」前提不再
成立——判**重审**而非规范赢，条款已随裁决改写。

## 逐项裁决

- **分不分**：分。四类条目选中后果不同（创建 / 跳转 session / 跳转
  消息上下文 / 执行命令），混排要逐行读图标定位；且 cmdk 原生
  `Command.Group` 空组自动隐藏，成本极低。
- **New chat / New project**：不进组，裸置顶（§8「New chat 永远第一
  项」不变）；不加「新建」组头（太隆重），后续「最近会话」组头即断句。
- **header vs 纯 divider**：header。「对话内容」组已有 header，风格
  统一优先；纯 divider 只断句不答「这是什么」。
- **默认态显不显示组头**：始终显示。默认态恰是列表最长（15 行）最需
  断句的时刻；「搜索时才显示」方向反了。
- **组间顺序**：维持 新建 → 会话 → 内容命中 → 操作（主轴在前）。
- **组头规格**：沿用原「对话内容」手写头（10px semibold uppercase
  tracking 0.08em muted），未升到规范纸面的 11px；手写头一并迁入
  `Command.Group` + `[cmdk-group-heading]` CSS。

## 未走真机变体

三档变体（无组头 / 全组头 / 最小版）未开——硬理由已足（前提失效 +
框架原生支持 + 已有组头先例），符合「仅当气质票是决策点才开」边界。
JC 真机验收兜底。
