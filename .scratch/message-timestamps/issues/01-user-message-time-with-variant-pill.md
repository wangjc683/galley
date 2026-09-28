# 01 用户消息时间（A + B）+ 临时变体切换器

Status: done

先读 `../PRD.md`，那里是全部裁决与格式表。本票实现它，并加一个临时切换器给
JC 真机比较。只改 `gui/`，不 commit。

## 改哪些文件

- 新建 `gui/src/lib/message-time.ts` + `gui/src/lib/message-time.test.ts`
- `gui/src/components/conversation/Conversation.tsx`（算一次、往下传）
- `gui/src/components/conversation/MessageUser.tsx`（B 标签行、A 悬停时间、删相对时间）
- `gui/src/components/conversation/GoalRunMarkers.tsx`（`GoalCommissionMarker` 的 B 标签）
- `gui/src/stores/messages.ts`（乐观 user turn 补 `createdAt`）
- `gui/src/i18n/locales/zh.ts`、`en.ts`（加「今天 / 昨天」，删不再使用的相对时间词条）
- `gui/src/types/conversation.ts`（只改 `UserTurn.createdAt` 的注释，它不再只服务 supervisor）
- 临时切换器：新建一个独立文件（例如 `gui/src/components/conversation/TimeVariantPill.tsx`），
  所有临时代码都带 `TEMP(message-timestamps)` 注释，方便事后 grep 拆除

## 怎么改

### 1. 纯函数（`lib/message-time.ts`）

- `userTimeMarks(turns, thresholdMs = 60 * 60 * 1000)`：按 `turns` 顺序遍历所有
  `role === "user"` 的 turn（含 ask_user 回复、带 `goalId` 的委派 turn），返回
  「turn 下标 → { pinned, withTodayWord }」。
  - `pinned` 为真：会话第一条用户消息；或距上一条用户消息 **> thresholdMs**；
    或与上一条用户消息的本地日期不同；或 `origin?.via === "supervisor"`。
  - `withTodayWord`：该消息与上一条用户消息本地日期不同（用于「今天 09:10」）。
  - 没有 `createdAt` 或解析失败的 turn：不给标签，也不作为下一条的比较基准
    （下一条跟再往前一条有时间的比）。自己权衡后在报告里说明怎么处理的。
- `formatMessageTime(iso, todayStartMs, language, { withTodayWord })`：按 PRD 格式表
  出文本。「今天 / 昨天」判断用 `todayStartMs`（`useDayStamp()` 的返回值），
  **不在渲染期调 `Date.now()`**（React 编译器 lint 会报 error）。中文 24 小时制补零；
  英文用 `Intl.DateTimeFormat` 的英文默认（12 小时制）。「今天 / 昨天」字样从 copy 来
  （可以让函数接收这两个词，或返回结构化结果由组件拼，自选）。
- `formatMessageTimeFull(iso, language)`：常显标签悬停用的完整时间（含星期），
  用 `Intl.DateTimeFormat` 的 full date + short time 即可。
- 单测覆盖：第一条、59/60/61 分钟边界（61 才算，正好 60 不算）、跨零点短间隔、
  ask_user 回复参与序列、supervisor 恒常显、缺 `createdAt`；格式：今天、今天带字、
  昨天、今年更早、往年、中英文、过零点（换 `todayStartMs` 结果随之变化）。
  测试里的时区：用本地时间构造输入，别硬编码 UTC 串去断言本地时刻。

### 2. Conversation 接线

- 在 `Conversation.tsx` 用 `useDayStamp()` + `useLanguage()`，`useMemo` 算一次
  `userTimeMarks`，把**格式化好的字符串**传给 `MessageUser` 和
  `GoalCommissionMarker`（例如 `pinnedTime?: { label, full, iso }` 与
  `hoverTime?: string`；命名自定）。`MessageUser` 是 `memo` 组件，传字符串保持引用稳定。
- 阈值读切换器的值（见 4）。

### 3. 组件

**B（MessageUser）**：现有 supervisor 行（气泡上方 `mb-1 flex items-center`）改成
「元信息行」：supervisor 图标和/或常显时间，有任一就渲染。时间用
`<time dateTime={iso}>`，class 同 `MessageActions.tsx` 里 `AnswerTelemetry` 的档位：
`text-[11.5px] leading-none text-ink-muted [font-variant-numeric:tabular-nums]`，
加 `select-none`；外包 `TooltipLabel`（`@/components/ui/tooltip`，用法见 MessageActions）
显示完整时间。图标与时间之间 `gap-1.5`。行占真实布局高度，不做绝对定位。

Supervisor 图标 tooltip 改成只写来源（不再带时间）；删除 `formatSupervisorTooltip`、
`formatRelativeTime`，以及 zh/en 里只被它们用到的 `justNow` / `minutesAgo` /
`hoursAgo` / `daysAgo`（先 grep 全 `gui/src` 确认没有别处使用）。

**B（GoalCommissionMarker）**：pinned 时在标记上方加同样的时间行，与 MessageUser
同款式；不加悬停时间。尽量少动它的现有结构。

**A（MessageUser）**：只对非 pinned 消息。按切换器取值：
- `右侧`：放进现有复制按钮的绝对定位容器（`left-full … ml-1.5` 那个 div），
  改成 `flex items-center gap-1.5`，复制按钮后跟时间文字；和复制按钮共用
  `copyVisible` 显隐，淡入淡出的过渡跟 `ActionChip` 的 `revealed` 一致
  （读 `ActionChip.tsx` 看它怎么做的）；`whitespace-nowrap`；字同 B。
- `下方`：气泡正下方左对齐，绝对定位（`top-full`，不占布局，不能让悬停引起位移）；
  长消息有展开/收起行时，改为放在那一行按钮后面。同样跟随 `copyVisible`。
- `关`：不渲染。

### 4. 临时切换器（TEMP）

- 常驻、可点击的分段 pill，放在不遮挡输入框、问题轨、滚动按钮的角落（左下角通常
  可以）。两组：「悬停时间：关 / 右侧 / 下方」（默认右侧）、「断点阈值：60 分钟 /
  1 分钟」（默认 60 分钟）。当前项高亮，名称可见。
- 选值存 `localStorage`，读写包 try/catch。只在 `import.meta.env.DEV` 下渲染。
- 状态怎么共享给 Conversation / MessageUser 自选（小 zustand store 或模块级
  store + `useSyncExternalStore`），但要都在 TEMP 标记范围内，拆除时一处删干净后
  只剩正式默认值（右侧 / 60 分钟）。

### 5. 乐观 turn 补时间

`stores/messages.ts` 的 `appendUserTurn` 在乐观插入的 user turn 上加
`createdAt: new Date().toISOString()`（store action 里取时间没问题，不是渲染期）。
再 grep `stores/` 里其他构造 `role: "user"` turn 的地方（例如排队消息派发、
外部消息 `appendUserTurnExternal` 已带），缺的一并补，报告里列出。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
```

全部贴输出尾部。不要启动 `tauri dev`，JC 自己真机看。

## 别动什么

- 不碰 `core/`、`cli/`、`runner/`、`managed-ga/`、迁移、IPC 类型；不改 Agent API。
- 不改 `useDayStamp`、Sidebar、问题轨；不给助手回答加任何时间。
- **不要对既有文件跑 `prettier --write` / `pnpm --dir gui format`**：`gui/src` 不是
  prettier-clean，会重排几十行无关代码。新文件可以整篇格式化，旧文件只保证自己写的
  hunk 风格一致。
- 注释密度与语气跟周边一致（这个仓库组件顶部有较长的设计注释，带日期）。
  在 MessageUser 顶部注释里补一段 2026-09-28 的时间规则说明；写理由时写 PRD 里的
  理由，不要把你自己推断的理由写成 JC 的裁决理由。
- 不写 docs / devlog（真机裁决后主会话写）。
- 不 commit；工作区里与本票无关的改动不要碰。

## 回报格式

1. 改动文件清单，每个一句话说改了什么。
2. 票面没写清、你自己做的决定（逐条，附理由）。
3. 验证命令输出尾部。
4. 切换器在哪、怎么用、拆除时要删哪些（grep `TEMP(message-timestamps)` 能否删干净）。
5. 你注意到但没处理的边角或风险。

## Comments

### 2026-09-28 实现（子代理，未提交）

- 已做：`lib/message-time.ts`（`userTimeMarks` / `formatMessageTime` / `formatMessageTimeFull`，17 条单测，UTC / 纽约 / +14 时区下也全过）；Conversation 用 `useDayStamp` + `useLanguage` 算一次、往下传字符串；MessageUser 元信息行（Supervisor 图标 + 常显时间）、悬停时间三种放法；GoalCommissionMarker 断点时间行；乐观 user turn 与 /btw user turn 补 `createdAt`；zh / en 加「今天 / 昨天」、删 `justNow` / `minutesAgo` / `hoursAgo` / `daysAgo`；`UserTurn.createdAt` 注释更新。
- 临时切换器：`TimeVariantPill.tsx` + `lib/message-time-variant.ts`，仅 dev 渲染，挂在对话区左下角；`grep -rn "TEMP(message-timestamps)" gui/src` 列出全部拆除点。
- 偏离票面一处：悬停时间不是「透明但保留盒子」，而是可见时才挂载。ActionChip 的显隐本身没有过渡（`transition-none`），视觉上等价；保留盒子会让「右侧」放法在气泡撑满整列时永久越出滚动容器右缘，窄窗口下对话区可以横向滚动。
- 待真机看：复制按钮容器改成 flex 后高度正好 24px，按钮可能比原来低 1–3px（原先的块级容器有正文行高撑出的行框）；「右侧」放法在窄窗口、气泡撑满时悬停期间仍会越出右缘（macOS 常显滚动条或 Windows 下可能闪出横向滚动条）；无 `createdAt` 的 turn 不给标签、也不作基准，第一条带时间的 turn 按「会话第一条」常显。
