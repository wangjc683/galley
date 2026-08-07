# 滚动按钮双态信号：运行 pulse ring + 未读静态点，及追尾修复

日期：2026-08-07。起因：JC 提出打磨 Composer 上方的一键置底圆形按钮——
它实际存在两种状态（流式回复中 / 回答已完成），讨论是否应在按钮上做出
区分。三轮讨论 + 一轮真机 A/B 后定案为双态信号，顺带修掉一个流式追尾
bug。

## 讨论轨迹（三次语义翻转，最终双态）

1. **第一轮**：行为早已分叉（流式中点击 = 重新挂上 sticky-follow；
   完成后点击 = 一次性跳底），视觉未表达。裁决：区分，轻信号不换图标
   ——箭头永远回答"点了去哪"，换图标会破坏 affordance。
2. **真机 A/B**（小圆点呼吸 vs pulse ring，先 ⌥V 切换器后升级为右下角
   可点击分段 pill——鼠标点选 + 常驻显示变体名，比纯快捷键好用，
   后续视觉分叉沿用 pill 形态）：JC 视觉上偏好小圆点。
3. **第二轮翻转（JC 提出）**：信号语义反了——运行中已有
   `RunElapsedHud` 常驻承载"正在跑"（滚到哪都可见），信号冗余；真正的
   信息真空在**完成那一刻**：HUD 消失、流式停止，没人告诉上翻的用户
   "答案好了在下面"。未读徽标语义（类聊天软件）精确填这个洞。
4. **第三轮合成（JC 提出，agent 收回反对）**：双态并存——运行中
   pulse ring、完成未读静态点。成立理由：两种视觉语法各自自解释
   （**动 = 正在发生，静态徽标 = 有东西等你**），无学习成本；且
   ring→dot 的切换本身是余光可感知的"跑完了"信号，单态方案给不了。

## 定案

- **运行中**（挂 `isRunning`，非 streamingContent——tool-heavy 步骤
  无文本流但内容仍在落地，与 follow-mode 拓宽依赖同一教训）：圆周
  pulse ring（`scroll-live-ring`），run 结束 200ms 淡出。
- **完成且未读**：右上 45° 静态 brand-strong 小圆点，pop 弹入
  （`scroll-unread-pop`，沿用 sidebar 未读 glyph 的弹入语言）。
  **未读必须边沿触发**，不能用 `!isRunning && !atBottom` 近似——那会把
  读过的答案标未读，徽标立刻失去可信度。状态机：run 结束瞬间不在底部
  → 置位；回底 / 切 session → 清除。实现用 render 阶段 prev 比较
  （react.dev "storing information from previous renders"），因 lint
  禁止 effect 内直接 setState。
- **追尾修复**：点击语义是"挂上尾部"而非"滚到某坐标"。旧监视器对
  点击瞬间的 `scrollHeight` 做 smooth scroll，快流式下底部是移动靶，
  1600ms 超时走 `setAtBottom(false)` 放弃——按钮弹回、用户要点第二次。
  改为：文档长高就对新底重发 `scrollTo`（仅增长时重发，避免动画每帧
  重启）；超时改瞬时 snap + attach；唯一不 attach 的出口是用户主动上拉。
- reduced-motion：ring 静态低透明度光环、dot 跳过弹入。

## 被否方案

- 运行中呼吸小圆点（A/B 视觉胜者）：语义翻转后出局——呼吸放在
  已完成态误导"仍在进行"，运行态则输给 ring 的圆周扩散隐喻。
- 单态未读（运行中裸箭头）：agent 曾推荐，被双态方案说服——丢掉了
  运行中点击 = 挂直播的视觉区分和 ring→dot 完成信号。
- tooltip 文案随状态变：讨论过，双态信号落定后无必要，未做。

## 联动

`useStickyScroll.ts`（追踪监视器）、`MainView.tsx`（未读状态机 +
按钮信号）、`globals.css`（`scroll-live-ring` / `scroll-unread-pop`）、
`docs/design/conversation.md` 滚动按钮小节回写。
