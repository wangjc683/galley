# Code block 参考审计：零采纳（参考落后于现状）

日期：2026-08-13
关联：`CodeBlock.tsx`、[流式正文打磨](./2026-08-13-streaming-prose-polish.md)
（`streaming-prose` 光标/块入场）

## 背景与结论

对照一段外部 CodeBlock 参考组件（头部栏 + 常驻 Copy + 行号 + 逐行
入场 + 手工 token 染色）审计对话区代码块。结论：**零采纳，JC 裁决
零改动**——参考演示的能力 Galley 均已有更成熟实现或已有反向裁决，
留痕以防重提案。

## 逐项裁决

- **语法高亮**：参考是手工 token 数组（演示假货）；Galley 是 Shiki
  细粒度加载 + LRU 缓存 + 流式防频闪 + 度量同一性（异步交换零回流），
  参考未意识到这些问题存在。
- **头部栏（文件名/语言/常驻 Copy）**：已有反向裁决（CodeBlock 注释：
  头部栏浪费整行、语言标签抑制后读作死白带；控件右上角悬浮、hover
  显现）。文件名是伪需求——GA fence 不携带文件名，带路径的代码走
  tool callout。
- **逐行入场动画**：架构性否决，比词级 blur 的否决（见流式正文打磨
  entry）更硬——Shiki 输出走 `dangerouslySetInnerHTML`，每 chunk 整块
  重建 DOM，行级入场会让所有已有行每 chunk 重播 = 整块频闪；要修需
  行级 diff + 稳定行元素，推翻 innerHTML 架构。块级入场昨日已由
  `streaming-prose > *` 覆盖。
- **行号**（参考唯一的真新元素）：否决——对话区代码块是「读完即复制」
  的交付物而非编辑器导航面，无「跳到第 N 行」场景；与换行模式打架
  （软换行后视觉行 ≠ 逻辑行）；需 Shiki 行级 transformer + 复制污染
  处理。Claude/ChatGPT/Cursor 对话代码块均不做行号，惯例正确。
- **流式尾部代码块的 ::after 光标排除**（顺带发现的候选微调，
  `:not(:has(pre))` 一行）：JC 裁决不做，维持「块状尾巴停块边缘」的
  已知可接受态。
