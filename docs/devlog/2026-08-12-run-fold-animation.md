# 折叠头展开/收起动画：grid-rows 扫掠 + 最终步标记入区

日期：2026-08-12
关联：`RunFoldSection.tsx`（新）、`Conversation.tsx`（渲染循环重组 +
`markerOnly`/`hideMarker` 拆分）、`RunFoldHeader.tsx`（三角时长同步）、
[foundations.md §2.7](../design/foundations.md)（A 类）、
[polish-checklist P9](../design/polish-checklist.md)

## 背景

折叠头（conversation-run-fold）的折叠/展开是瞬时 DOM 进出：折叠时
run 的中间 turns 直接 `return null`，展开一帧内全部挂载，几百到几千
像素瞬移，唯一动效是三角旋转——反衬更生硬。对照一段外部 Thinking
trace 组件（grid 0fr/1fr + shimmer 头 + 逐行 stagger + trace 竖线）
逐项评估借鉴。

## 采纳与否决

- **采纳：`grid-template-rows: 0fr ↔ 1fr` + opacity**。height:auto
  动画的现代标准解法，免测量；CSS transition 可中断可反向，正合 P9
  「toggle 类交互用 transition 禁 keyframe」。§2.7 里展开/折叠明文
  属 A 类（不削减、必要时加强），无需重审规则。时长走 token：
  `--motion-slow`（240ms，表内用途「较大结构位移：行重排、树展开」）
  + `ease-firm`；参考的 400ms 字面量不进代码。
- **否决：逐行 stagger 入场**。参考里 stagger 服务于工作过程中新行
  陆续出现（一次性入场，合法）；我们是手动展开已存在的内容，每次
  展开重放入场动画正是 P9 禁的模式；且展开物是任意长的真实文档流
  而非四行 trace，stagger 不可伸缩。
- **否决：trace 竖线**（参考自家列表装饰，无对应物）；**免做：working
  态自动展开/settle 收起**（keep-expanded 指针已是等价物）、shimmer
  头（同日已在 thinking 行落地，折叠头无 working 态）。

## 两处非显然设计

1. **最终步 marker + StrongHr 搬进动画区**。原 `answerOnly` 让最终步
   标记和分隔线在折叠瞬间弹出/弹入（约 80px 突跳，生硬感的另一半）。
   `AgentTurnView` 拆两半：`markerOnly`（marker + StrongHr，动画区
   收尾节点）+ `hideMarker`（回答体，常驻区外、展开与否都平铺）。
   折叠/展开由此成为纯粹一次高度扫掠：回答体永远可见，只平滑滑动。
2. **margin 编排**。grid 容器是 BFC，首个 TurnMarker 的 mt-6（24px）
   不再与折叠头 mb-2.5（10px）做兄弟折叠——平铺 24px、天真包装
   34px。包装器 `-mt-2.5 ↔ mt-0` 跟随 rows 同步过渡：展开静止精确
   还原 24px，收起终点落在折叠态 10px「header 紧贴回答」，两端点
   无缝。底边免补偿（区内收尾是 StrongHr my-4=16px，区外回答体根
   节点零 margin，BFC 与否都是 16px）。耦合点已注释：假设折叠头
   （mb-2.5）紧邻区前、TurnMarker（mt-6）开区。

## 取舍（已注释）

- DOM 经济性保留：闭合区不渲染子树（同改前）；挂载/卸载由组件内
  状态机管理（render-phase adjust 模式，同 `keepOpener`；卸载定时器
  300ms 而非 transitionend——`motion-reduce:transition-none` 下
  transitionend 永不触发，300ms 内不可见的 0fr DOM 是免费的）。
- run 在展开态完成的瞬间，过程 turns 从平铺换进包装器会重挂载：
  callout 默认展开态按相同规则重建（`success-current` 仍默认展开），
  仅用户 run 中手动收起过的 callout 弹回默认。接受并注释。
- 超大内容的性能保险丝（跳过动画阈值）裁决先不做，真机观察。

## 验收

真机验收通过（2026-08-12）：静止布局与改前一致，240ms 扫掠、
回答体滑动、reduced-motion 瞬时均符合预期。
