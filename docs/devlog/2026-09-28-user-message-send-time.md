# 用户消息发送时间：只在断点常显

Date: 2026-09-28
Status: implemented; two live-test rounds on JC's desktop the same day (hover
time cut, pinned style c picked); switcher removed; static gates green;
Goal commission surface not yet looked at live; unreleased
Related: [conversation design §发送时间](../design/conversation.md),
[deferred「长时间运行的完成时刻」](./deferred.md),
[09-17 杏沙气泡](./2026-09-17-user-message-bubble.md),
[09-23 折叠头行内分层](./2026-09-23-run-fold-header-hierarchy.md)

## 起因

JC：用户消息完全没有时间，几点发的、哪天发的都看不到。要不要加、精确到多细、
用什么样式和交互，想法还乱，一起梳理。

## 现状核查

- `messages.created_at` 一直在存（`core/migrations/001_init.sql:74`），GUI 也已
  传进 `MessageUser`，唯一用途是 Supervisor 图标 tooltip 的相对时间。
- 助手侧只有时长（折叠头「用时」），没有时刻。run-fold PRD 当初写过「时间戳如需，
  进 hover title」。
- 本地发送的乐观 user turn 不带 `createdAt`；`AgentTurn` 没有时间字段。
- `foundations.md` 的字号表写着问题轨用 `text-ui-micro` 显示时间戳，实际问题轨
  没有时间，是过时说明（本次改掉）。

## 数据（workbench.db 只读，2026-05-15 → 09-23）

- 130 个会话、415 条用户消息；124 个会话（95%）的全部提问在同一天。
- 同一会话相邻提问间隔 285 个：<5 分钟 187、5–60 分钟 77、1–6 小时 14、
  6–24 小时 5、1–7 天 2。超过 1 小时 21 处；跨日 7 处，其中不到 1 小时的 0 处。
- 断点按「上一条用户消息」算和按「上一条任意消息」算，都是 21 处。
- 409 轮运行（提问 → 最后一条助手行）：<1 分钟 281、1–5 分钟 115、
  5–30 分钟 13，最长 28.9 分钟。
- 数据来自开发者 dogfood，社区用户的跨天使用可能多得多。

## 讨论与裁决

先拆「要时间干什么」：隔天回来接着聊（断点感知）、偶尔查一条几点发的、追查
Supervisor / IM 来源、回找以前问过的问题。四个候选：A 只悬停、B 只在断点常显、
C 每条常显、D 只进问题轨等外围。C 否：93% 的间隔在一小时内，每条都挂时间大多
是重复数字，也和这段时间一直在减元数据的方向相反（09-16 步号去竖线、折叠头
降墨）。JC 选 A + B。

- **断点**：距上一条用户消息超过 60 分钟，或跨了本地日期（兜底，数据里 0 例）。
  只跟上一条用户消息比：和「任意消息」结果一样，不用给 `AgentTurn` 补时间。
- **第一条消息一直显示**，相当于标出会话从什么时候开始。
- **ask_user 回复**参与序列，下一个问题只跟上一条用户消息（含回复）比。
  已知代价：回复藏在折叠的 run 里时，折叠态看不到那段等待。
- **Supervisor 来源消息一直显示**（图标行本来就在）；图标 tooltip 的相对时间退役。
- **Goal 委派标记**参与断点。
- **格式**：分钟粒度的绝对时间（相对时间会漂移、截图失真）；中文 24 小时制
  补零、手工拼（不随 ICU 变），英文用 en-US 12 小时制；表见设计文档。
- **只给用户消息，不给助手回答**：同一规则套到回答上，409 轮 0 次触发；回答
  操作栏是常显的，放进去就等于每条都有；空档都出在用户离开又回来。**更正**：我
  最初给的理由「提问时刻 + 折叠头用时能推出完成时刻」不成立——用时不含
  ask_user 等待，提问时刻平时也不显示。长时间无人看管的运行（过夜 Goal、定时
  任务）的完成时刻进 deferred。
- 问题轨卡片不加时间。

## 真机第一轮

- 第一条消息显示时间：OK。
- **悬停时间砍掉**，JC：「有点吵，也没有必要」。原本要比的三种放法（复制按钮
  右侧 / 气泡下方 / 关）不用再定；「右侧」在窄窗口下会越出对话区右缘的代价也
  随之消失。
- 阈值 60 分钟确认，1 分钟调试档去掉。
- **常显时间「稍微有点吵」**。我推断的来源：字号 11.5px 是我在票里让它照抄
  `AnswerTelemetry` 的，而规范给时间戳的是 `text-ui-micro` 10.5px（我的错）；
  它在每段对话的开头，扫视时眼睛先落在它上面；「9月21日」「昨天」笔画密；离
  气泡 4px 像标题；深色下 `ink-muted` 对比度 5.23:1，比浅色的 3.63:1 高。

## 真机第二轮：c

三档：a 现状 11.5px `ink-muted` / b 10.5px `ink-muted`（我推荐）/ c 10.5px
`ink-muted/70`。JC 选 c。

- c 的对比度约 2.30:1（浅）/ 3.19:1（深），低于 AA。成立的前提是它是可有可无
  的辅助信息，悬停有完整日期兜底。
- **和 09-23 不矛盾**：那次折叠头的「气味段降到 70%」被否，对象是要读的 12px
  文字，而且是我在选项里预先否掉、没上真机；这次对象是时间标签，是 JC 真机选的。
  以后别拿其中一条去推翻另一条。
- 位置没动。b、c 都嫌吵才会试「移到气泡右侧」，现在不需要。

## 与既有规则的关系

- 设计文档 09-17 有一条「不给普通消息加 eyebrow / 图标」（防稀释 Goal 委派的
  加冠行）。讨论时我漏查了，定案后补看。判断不冲突：那条防的是每条都戴的装饰行；
  时间行稀疏、最浅墨色、没有品牌色和大写字距。已在那条旁注例外。
- **Goal 委派待看**：每个 Goal 会话的第一条就是委派，所以每个 Goal 会话开头都是
  「时间行 + 加冠 eyebrow + 竖条色板」。两轮真机都没看这个面。

## 实现

- `lib/message-time.ts`：`userTimeMarks`（哪些 turn 常显、是否带「今天」）、
  `formatMessageTime`、`formatMessageTimeFull`；「今天」由调用方传
  `useDayStamp()`，渲染期不取当前时间（React 编译器 lint）。17 条单测，在多个
  时区下都过。
- `Conversation` 算一次，只为常显的 turn 生成字符串，传给 `MessageUser` 与
  `GoalCommissionMarker`。
- `MessageUser`：Supervisor 图标行改成元信息行（图标和 / 或时间）；
  `PinnedMessageTime` 两处共用；删 `formatRelativeTime` 及 zh / en 的
  `justNow` / `minutesAgo` / `hoursAgo` / `daysAgo`。
- `stores/messages.ts`：`appendUserTurn` 与 `/btw` 的乐观 turn 补
  `createdAt`。副作用（算修正）：Goal 运行中发出的消息，Goal 结束后留在该 Goal
  的段落里，与重开会话一致。
- tailwind-merge 坑：字号 class 排在 `leading-none` 之后会把 `leading-none`
  吞掉，所以 `MESSAGE_TIME_TEXT` 里字号在前。
- 执行分两张 Opus 票（实现 + 切换器；砍悬停 + 样式三档），拆切换器由主会话做。

## 已知边角

- `/btw` 消息不入库，重开后前后断点可能不同。
- 乐观 turn 用本机时间，恰好跨分钟时重开可能差 1 分钟。
- 10.5px 汉字在 Windows 低 DPR 下可能发虚（见 deferred「Windows 低 DPR 下
  chrome 文字字重 / 字号变体」），没在 Windows 真机看过。

纯前端，内置 / 外置两种运行时模式零差异；不动 Core、迁移、Agent API。
