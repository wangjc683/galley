# 101 只自动开一次也认提醒与备忘卡片；提醒卡片那句话打开面板

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 147 第 4、5 条（2026-10-28，JC：「1，直接推进；2，按你的推荐做 A+B」）。前情：票 [87](./87-todo-panel-open-and-close.md)（只自动开一次、卡片标题打开面板、亮行）、票 [97](./97-memo-cards-and-panel-page.md)（备忘卡片、面板两页）。同一个代理接着做票 [102](./102-cards-fly-into-the-todo-button-trial.md)（每次记下都飞进顶栏按钮，切换器），两张票共用「回复下新出现了哪些卡片」的判断，先做本票。只改 GUI 与设计文档。外置运行时没有主对话与待办面板，零变化。

## 为什么

用户反馈：很多人不知道有待办面板，不去顶栏点，也不点回复下的卡片，面板就像一直不会出现。票 87 的「只自动开一次」一旦触发，面板会被记为开、一直在，所以这些人多半没触发过。最可能的原因：新用户第一句要记的常是「明天 10 点提醒我……」，按裁决 92 记成 Galley 自己的提醒，挂的是提醒卡片；判定只认你的待办（`kind === "todo"`），提醒卡片不触发，也点不进面板。备忘卡片（票 97）同样不触发。

## 现状（读码起点）

- 判定：`gui/src/lib/todo-open.ts` 的 `todoPanelIntroduces`（约 381 行，`TodoIntroduction` 约 348 行），只看待办 store 的 `noted`（`gui/src/stores/assistant-todo.ts`）；打开：同文件 `introduceTodoPanel`（约 406 行：`setTodoPanelOpen("galley", true)`、写标记、`requestTodoRows`）。订阅：`gui/src/hooks/useTodoPanelIntroduction.ts`（App 里挂一次）。
- 三种卡片的数据源各不相同、各自刷新：
  - 待办卡片：`stores/assistant-todo.ts` 的 `noted`（Core `list_noted_todos`），`hooks/useTodoCards.ts`；
  - 提醒卡片：`hooks/useReminderCards.ts`（Core 定时任务列表，模块级缓存 `lastRead`，`scheduled-tasks:changed` 时重读，按 `created_in_turn_index` 找回复；不是 zustand store）；面板里同一件是 `kind === "task"`、`id` 为任务 id 的 `TodoItem`；
  - 备忘卡片：`stores/memo.ts` 的 `events`（Core `list_memo_events`，`memos:changed`），`hooks/useMemoCards.ts`。
  - 三者都在一轮结束时才带上 `turnIndex`，卡片在那时出现；刷新先后可能差几百毫秒。挂载在 `gui/src/components/screens/MainView.tsx` 约 720 行起。
- 卡片通往面板：待办卡片标题 `showTodoRow`、备忘卡片的字 `showMemoRow`（`todo-open.ts` 约 309、321 行，翻页用 UI store 的 `requestTodoPage`）；提醒卡片那句话是纯 `span`（`gui/src/components/conversation/ReminderCards.tsx` 约 100–110 行），唯一能点的是「取消」。面板里有没有这一件：`lib/todo-panel.ts` 的 `todoListed`；备忘是 `lib/memo.ts` 的 `memoCardState`。

## 要做的

1. **触发也认提醒与备忘卡片**（裁决 147 第 4 条）：
   - 在原来的条件（标记没设、不是首次读、你发起的一轮、主对话在屏上、主区不窄，票 87 第 3 条）不变的前提下，「这一轮回复下新出现的卡片」从只认你的待办，扩到三种：你的待办（不变）；Galley 自己的提醒（提醒卡片那种：建在主对话这一轮、不挂在待办上；一次性与重复的都算；建了又在卡片出现前取消的不算）；备忘的「记下了」「改为」（「不再记」不算：页上没有那一行可亮）。子任务卡片不算。
   - 页签：同一轮里有待办或提醒卡片 → 「待办」页，亮这一轮新出现的待办与提醒那几行；只有备忘 → 「备忘」页，亮那几条。
   - 三个来源刷新有先后，要做到「同一轮记了待办又记了备忘，开的是『待办』页」。怎么收齐由你定（比如第一张新卡出现后等一个短窗口再判），常量写清楚为什么是这个值；收齐期间如果条件变了（离开主对话、拉窄），照变了之后的条件判。
   - 「首次读」按来源各算：某个来源第一次读回来时已有的卡片不算新。
   - 判定仍写成纯函数，单测覆盖每个条件、每种卡片、页签的优先级、取消的与「不再记」不算。
2. **提醒卡片那句话打开面板**（第 5 条）：面板的 `todo` 里有这件任务（`kind === "task"`、同 id）时，那句话是按钮，样子照待办卡片的标题按钮（只有字那么宽、悬停下划线、`focus-visible` 圈、截断时悬停给全文），点了照 `showTodoRow` 的做法：面板不在屏上就在 Galley 旁边打开（宽窗口记为开，窄窗口临时开），翻到「待办」页，那一行亮，在「已完成」里且收着的先展开。面板里没有这件（取消了、已完成超过 7 天、到点新开会话那种不进面板的）照旧是字。已取消卡片的划线、已提醒的 `ink-muted` 照旧，作为按钮时颜色与划线规则同待办卡片（悬停下划线 60%、平时删除线随字，票 99）。不加新文案。
3. **设计文档**：
   - `docs/design/conversation.md`：「提醒卡片」加一条「那句话打开面板」；「待办面板」的「开与关」里只自动开一次的条件改成三种卡片与页签规则。
   - `docs/design/layout-and-chrome.md` 约 81 行「只自动开一次：本机第一次有待办卡片在你眼前出现时」一句改成三种卡片。
   - 都注「2026-10-28，票 101，裁决 147」。
   - `gui/src/lib/todo-panel-memory.ts` 文件头里说只认待办卡片的话（若有）跟着改。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- Core、`core/`、手册、提示词、Agent API；标记 `galley.todoPanelIntroduced` 与两处开关的键名、读写规矩；票 87 的窄窗口、亮行、跟随滚动修补。
- 面板的分组、行几何、宽度；卡片的几何与已定的颜色。
- 外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；状态归零用渲染期带守卫的 setState；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 101, PRD ruling 147」），密度相当。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t101-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- 反向检查：把「提醒卡片算」「备忘卡片算」「待办页优先」「取消的不算」各改坏一处，对应测试要红，改回全绿
- 设计文档新增行中文全角标点（自写正则扫 diff 新增行，脚本放 scratchpad、文件名带 `t101-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 判定纯函数的新签名；三个来源怎么收齐、窗口值与理由。
3. 验证命令与结果原样（含两个时区、反向检查）。
4. 票面没写到、你自己定的边界（逐条）。
5. 看到但没改的问题，没验证到的（逐条）。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新）。清标记：dev 窗口输入框里右键「检查元素」，控制台跑 `["galley.todoPanelIntroduced","galley.todoPanelOpen","galley.todoPanelOpenElsewhere"].forEach(k=>localStorage.removeItem(k)); location.reload()`。

1. 面板关着，跟 Galley 说「十分钟后提醒我喝水」：回复落定时面板自己打开在「待办」页，「Galley 在办」里那一行亮。
2. 再清一次标记，说「我不吃香菜」（或别的关于你的事）：面板自己打开在「备忘」页，那一条亮。
3. 关掉面板，点第 1 站那张提醒卡片上的「提醒我喝水」：面板打开，那一行亮。

## Comments
