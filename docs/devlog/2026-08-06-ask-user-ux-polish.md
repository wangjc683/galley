# ask_user 三连修：重复提问、通知语气、重启丢 pending + 折叠头截断策略

日期：2026-08-06。起因：JC 打磨 ask_user 主对话区体验，第一刀是「提问
时问题出现两次，回答完一个消失」的观感问题；排查后顺藤摸出通知与恢复
两处真缺陷，附带裁决了折叠头 scent 的长任务截断策略。

## 1. 回显与活动气泡同屏（d0fc053c）

**机制**：ask_user 回合在 bridge 发 `AskUserEvent` 前已走完 `turn_end`
落进 `turns[]`，`Conversation.tsx` 对任何带 ask_user tool call 的回合
无条件渲染 `AnsweredAskUser` 静态回显——于是 pending 期间回显与尾部
`AskUserBubble` 紧邻同屏，完全相同的问题连打两遍。回显的设计意图本是
只为回答后/重启后保住问题文本，pending 期出现纯属无条件渲染的副作用。

**定案**：`Conversation` 增 `askUserPending` prop，对「最后一个带
ask_user 的 agent 回合」抑制回显（位置匹配，不比对问题文本——两条
路径各自 stripGATags，文本相等是脆弱 join key；从尾部反向找兼容 /btw
侧线追加）。回答后 pending 清空，回显在原位接棒，视觉上是「活动卡片
沉降为安静引用」。

**被否**：合并为单一原地组件（pending 渲染活动态、回答后原地退化）。
状态转换最优雅，但要动尾部锚定，`useStickyScroll` 与尾部组件排序均有
牵连，改动面与收益不成比例——两者本就相邻，修法一效果几乎等同。

## 2. 通知语气错位 + 重启丢 pending（d9075ab8）

**通知**：GA 的 ask_user 带 `should_exit=True` 退出循环（ga.py），
turn_end 的 exitReason 非空，走进了 replyDone 通知分支——人不在时
agent 提问，系统通知弹「回复完成」，语气与实际状态（agent 卡住等人）
完全相反，且不带问题文本。定案：turn_end 检测 toolCalls 含 ask_user
即跳过 replyDone，把 notify-pending 标记留给紧随的 AskUserEvent；其
handler 消费标记后发新 `askUser` 类通知（标题「等你回复」，正文
「会话标题 · 问题文本」）。开关**复用 `notifyOnReplyDone`**（JC 裁决：
两者同属 run 终点「需要你」信号，单独开关是 Settings 噪音）；throttle
key 亦共用 `reply:`——同一 run 二者互斥不会都响。

**恢复**：`pendingAskUser` 是瞬态，重启即丢，只剩安静回显——chips
没了，侧栏黄点不亮，用户可能意识不到 agent 在等他。关键事实是数据
全在：question + candidates 都在持久化的 ask_user tool args 里。定案：
新增 `derivePendingAskUser(turns)`（rowsToTurns.ts 纯函数），规则为
「会话最后一个非 system 回合是未应答的 ask_user 回合」即重建 pending，
`restoreSessionTurns` 恢复时写回——气泡、chips、黄点整套复活。安全性
依据：bridge 侧 `ask_user_response` 与 `user_message` 都汇入
`agent.put_task`，kind 之分只是审计语义，不是与等待循环的握手协议。

**已知边界**（未裁决，留待后续）：恢复发生在会话激活时，重启后未点开
的会话侧栏黄点不亮；冷启动全量点亮需启动时按会话扫 DB 尾行，另一个
量级，值不值得做待 JC 裁决。

## 3. 折叠头 scent 的长任务截断策略（a82bf4fe）

**排查结论**：百步长任务不会撑破折叠头——toolCounts 按去重工具名
统计，GA 工具全集 10 个（扣 no_tool / ask_user）scent 封顶 8 段 +
提问计数，渲染是单行 truncate。真问题是**截断牺牲顺序错**：工具按
first-appearance 排，截掉的尾巴可能恰是高频主活动；「N 次提问」固定
垫底，是截断的第一个牺牲品，但它与 denied 同属「折叠但留疤」级信号。

**定案**（scent 的职责是构成不是叙事，时间线该点开折叠看）：

- 渲染层按次数降序（稳定排序，同次数保持首次出现序）；
  `RunStats.toolCounts` 数据层保持 first-appearance——排序是渲染关切。
- 「N 次提问」移出可截断区，与 denied 徽章并列 `shrink-0` 固定段，
  用行内 muted 墨色——denied 保持全行唯一彩色疤。
- 溢出时 tooltip 兜底显示完整列表：`useLayoutEffect` + ResizeObserver
  布局期测量 `scrollWidth > clientWidth`（保证指针到达前 Radix trigger
  已挂载），仅溢出时挂 TooltipLabel，短 scent 行保持精简 DOM。

**被否**：cap top-N + 「等 N 类」汇总——全集才 8 种，cap 解决的是
不存在的无限增长，反而在放得下时也藏信息。

## 未完成

问答视觉配对：`askUserReply` 目前只切 `data-role`（服务 rail 索引），
用户的回答与普通消息视觉无别。候选方案是黄色系小 eyebrow（「↳ 回复
提问」），属纯视觉分叉，按 JC 工作法留待真机变体实测裁决。
