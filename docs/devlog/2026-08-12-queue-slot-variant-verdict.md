# 运行中动作槽变体裁决：定 B（槽保持 Stop，Enter 排队）

日期：2026-08-12
关联：`.scratch/message-queue/`（galley#19/#20 会话消息队列）、
`ComposerActionSlot.tsx`、`lib/composer-hint.ts`

## 背景

消息队列上线后（运行中发送默认排队），composer 右下角动作槽在
running 态的形态出现分叉。三个候选做成临时变体切换器（常驻 pill，
localStorage 记忆）进 tauri dev 实测：

- **A**：有草稿时槽变回发送钮（点击=排队），Stop 缩为旁侧小钮；
- **B**：槽全程保持 Stop，排队只走 Enter，footer hint 教学
  （「Enter 排队 · 本轮结束后自动发送」）；
- **C**：Stop + 发送双钮并排常驻。

## 裁决

JC 真机实测后倾向 B；agent 独立判断同为 B；定 B。

## 理由

1. **几何稳定先例**：armed-Goal 116px 宽 pill 曾因槽位变形挤出死区
   点击而回滚（"Geometry stability beats the wide-label emphasis"，
   见 ComposerActionSlot 注释），并定下 32px 圆钮全状态不变的规矩。
   A 在同一槽位重新引入变形，且触发条件是「打字」——高频、连续、
   注意力不在按钮上。
2. **失败模式不对称**：A 的最坏情况有实害（想停止时草稿恰好非空，
   槽位已变成发送——任务没停还排进半句话；Stop 恰在不耐烦状态下
   使用，对 UI 变化觉察最差）。C 是慢性代价（常驻占位、灰钮噪声、
   相邻双圆钮互误点、稀释「运行中=槽即 Stop」的信号）。B 的最坏
   情况仅是「没发现能排队」——退化为等任务结束再发，零损失。
   一次性学习成本 vs 永久误操作风险，选前者。
3. **B 的发现性短板有三层缓解**：打字时 footer hint 立即出现在
   视线必经处；首次 Enter 后队列 chips 自我展示；核心场景
   （#19「排好几条然后离开」）本就是键盘流，发送钮的真实点击率低。
4. **可逆性**：B 对既有 UI 零改动，日后如收到「找不到怎么排队」的
   dogfood 反馈可升级 A/C；反向（先上按钮再拿掉）成本高得多。

## 落地

切换器 pill、`lib/queue-slot-variant.ts`、A/C 分支代码已拆除；
ComposerActionSlot 回到固定 Stop 槽并在注释记录本裁决。落选方案
勿重提（升级触发条件：真实用户反馈排队入口不可发现）。
