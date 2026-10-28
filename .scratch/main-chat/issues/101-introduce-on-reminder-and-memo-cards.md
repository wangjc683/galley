# 101 只自动开一次也认提醒与备忘卡片；提醒卡片那句话打开面板

Status: needs-dogfood（2026-10-28 JC 跟 Galley 说了「取快递」「喝水」两轮（库里有记录，主会话量到三样读回相隔约 150ms，400ms 够），第 1 站自动开在哪一页、亮没亮没报；第 2 站（备忘那页）没走（当天没有新备忘）；第 3 站（点提醒卡片的字）没报。2026-10-28 快进合入 `83a7bb28`；主会话机器验收：读过 `lib/fresh-cards.ts`、`hooks/useFreshCards.ts`、`lib/todo-flight-run.ts` 的层级与清理；在 worktree 重跑 `pnpm --dir gui typecheck`、`lint`、`git diff --check` 全过，`test` 本地与 `TZ=UTC` 各 226 个文件、2500 条全过；真窗口第一帧与截图待做）

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

### 2026-10-28 实现回报（票 101 代理）

分支 `ticket-101-102-todo-discovery`，从本地 main 的 `00b3dd1c` 起，做完两张票后 rebase 到 `88001d3c`（只多了裁决 148 与票 103 两个文件，没有冲突），与票 102 同一个 worktree。未 push、未合入。

**1. 提交列表**（`git log --oneline main..HEAD` 在本票做完时的样子，号是 rebase 到本地 main `88001d3c` 之后的；这条回报自己的提交、票 102 的提交在它之后）

```
58a5c4ce Design: the panel opens once for any card it lists; a reminder card's words open it (ticket 101, ruling 147)
0c518a36 Ticket 101: the panel opens once for reminder and memo cards too; a reminder card's words open it
```

**2. 判定纯函数的新签名；三个来源怎么收齐、窗口值与理由**

- 判定（`lib/todo-open.ts`）：

```ts
export function todoPanelIntroduces(
  input: TodoIntroduction,
): TodoIntroducing | null; // null = 不开
export interface TodoIntroduction {
  introduced: boolean;
  fresh: readonly FreshCard[]; // 这一轮回复下新出现的卡片，三个来源收齐的
  yourRound: boolean;
  mainChatOnScreen: boolean;
  narrow: boolean;
}
export interface TodoIntroducing {
  page: TodoPanelPage; // "todo" | "memo"
  rows: string[]; // 要亮的行：待办 id、任务 id 或备忘 id
}
export function introduceTodoPanel(introducing: TodoIntroducing): void;
```

  有待办或提醒卡片 → `page: "todo"`，`rows` 只取待办与提醒的；只有备忘 → `page: "memo"`，同一条备忘的几张卡只亮一次。原来输入里的 `previous` / `next` / `mainChatId` 挪进下面的「哪些卡片算新」。
- 哪些卡片算新（新文件 `lib/fresh-cards.ts`，都是纯函数）：

```ts
export interface FreshCard {
  kind: "todo" | "reminder" | "memo";
  row: string;  // 面板那一行：待办 id、任务 id、备忘 id
  card: string; // 卡片本身：同上，备忘是那次改动的事件 id
}
export function freshTodoCards(previous: readonly TodoItem[] | null, next: readonly TodoItem[], mainChatId: string | undefined): FreshCard[];
export function freshReminderCards(previous: readonly ScheduledTask[] | null, next: readonly ScheduledTask[], mainChatId: string | undefined): FreshCard[];
export function freshMemoCards(previous: readonly MemoEventItem[] | null, next: readonly MemoEventItem[], mainChatId: string | undefined): FreshCard[];
```

  `previous` 为 `null`（该来源的首次读）一律不算新。「新」是这一份有卡片（`createdIn` / `sessionId` 是主对话、`turnIndex` 已填）而上一份没有这张卡片的；再在新的里面筛：待办只认 `kind === "todo"`、没取消；提醒不挂在待办上（`!todoId`）、没取消，一次性与重复的都算；备忘只认「记下了」「改为」，且那条备忘还在（`memoExists`）。
- 收齐：`freshCardsGatherer(onGathered, wait = FRESH_CARDS_GATHER_MS)`，第一张新卡到时起等 **400ms**，期间到的都并进来（同一张只算一次），等完按卡片在回复下的次序（待办、提醒、备忘）交给 `onGathered`。理由（常量注释里也写了）：一轮结束时 Core 先后给任务、待办、备忘填 `turnIndex`、各发一个事件（`core/src/message_queue.rs`）；提醒卡片的列表收到事件当即重读，待办与备忘的同步 hook 防抖 150ms 再读，之后各一次来回。400ms 盖住 150ms 防抖与两次读，还留余量；又短到面板打开仍读作卡片出现的那一下。等的期间条件变了：标记、主对话在不在屏上、宽窄在等完那一刻重读；「是不是你发起的一轮」按第一张新卡到的那一刻读（那时正在落定的就是这一轮；等的期间若又开始一轮叫醒的，不会把它判成叫醒的）。
- 三个来源怎么接（`hooks/useFreshCards.ts`，原 `useTodoPanelIntroduction.ts` 改名，App 里挂一次）：订阅待办 store 的 `noted`、备忘 store 的 `events`（`previous.loaded` 为假即首次读），以及提醒卡片的读数。提醒卡片原来只是 `hooks/useReminderCards.ts` 里的模块缓存，不是 store：加了 `subscribeReminderReads(listener)`，每次读回来告诉听的人上一份与这一份；每次 MainView 挂载的第一次读给 `null`（只当起点），所以离开主对话期间建的提醒，切回来时不算新。

**3. 验证命令与结果原样**

```
$ pnpm --dir gui typecheck
> galley-desktop@0.7.2 typecheck …/gui
> tsc --noEmit

typecheck exit=0

$ pnpm --dir gui lint
> galley-desktop@0.7.2 lint …/gui
> eslint src --max-warnings 0

lint exit=0

$ git diff --check
diff-check exit=0

$ pnpm --dir gui test
 Test Files  222 passed (222)
      Tests  2450 passed (2450)
local exit=0

$ TZ=UTC pnpm --dir gui test
 Test Files  222 passed (222)
      Tests  2450 passed (2450)
UTC exit=0

$ TZ=America/Los_Angeles pnpm --dir gui test
 Test Files  222 passed (222)
      Tests  2450 passed (2450)
LA exit=0
```

反向检查（scratchpad 里的 `t101-reverse.sh`：每次先把文件备份到 scratchpad，改坏一处，跑 `fresh-cards`、`todo-open`、`useFreshCards` 三个测试文件，用备份 `cp` 回去再跑）：

```
--- broken: reminder cards count
     × are new once their reply settles, one-off or repeating
     × opens on 待办 at one of Galley's own reminders
      Tests  2 failed | 71 passed (73)
--- restored
      Tests  73 passed (73)
--- broken: memo cards count
     × are new for 记下了 and 改为, by the write: the memo's row, the write's card
     × opens on 备忘 at a memo when only memos came
     × waits for the reads that land later: a memo first, the to-do 200ms after, opens on 待办
      Tests  3 failed | 70 passed (73)
--- restored
      Tests  73 passed (73)
--- broken: the 待办 page wins
     × opens on 待办 when a to-do or a reminder came with memos, lighting those alone
     × waits for the reads that land later: a memo first, the to-do 200ms after, opens on 待办
      Tests  2 failed | 71 passed (73)
--- restored
      Tests  73 passed (73)
--- broken: a reminder cancelled before its card does not count
     × do not count one cancelled before its card came, nor a to-do's, nor another session's
      Tests  1 failed | 72 passed (73)
--- restored
      Tests  73 passed (73)
--- broken: a to-do cancelled before its card does not count
     × count only your to-dos in this main chat, not one cancelled before its card
      Tests  1 failed | 72 passed (73)
--- restored
      Tests  73 passed (73)
--- broken: 不再记 does not count
     × do not count 不再记, nor a write whose memo is already gone
      Tests  1 failed | 72 passed (73)
--- restored
      Tests  73 passed (73)
```

设计文档新增行的全角标点：scratchpad 里的 `t101-cjk-punct.py` 扫 `git diff -- docs/` 的新增行（跳过行内代码、代码块、链接目标；半角 `, ; : ? ! ( )` 贴着中文即报），结果 `0 hit(s) of half-width punctuation next to CJK in added lines`；脚本先用四个样例自测过（半角逗号、半角括号贴中文会报，英文与全角不报）。这条回报也照样扫过。

新增的测试：`lib/fresh-cards.test.ts`（三种卡片各自的新与不新、首次读、取消的、「不再记」、备忘已删、状态变化，收齐的等待、合并、次序、丢弃）；`lib/todo-open.test.ts` 的「opening by itself」整段按新签名重写（每个条件、每种卡片、页签优先级）；`hooks/useFreshCards.test.tsx`（真 store 接线：等满 400ms 才开、提醒开在「待办」、只有备忘开在「备忘」、备忘先到待办 200ms 后到仍开「待办」、各来源首次读不开、等的期间离开主对话或拉窄不开、叫醒的一轮与已认识不开、卸载后不再听）；`hooks/useReminderCards.test.tsx`（挂载的第一次读给 `null`、之后给上一份、重新挂载又是 `null`、退订后不再告诉）；`components/todo/TodoPanel.flash.test.tsx` 加提醒卡片那句话的三条（列着时是按钮、样式同待办卡片的标题按钮；已取消、id 撞上待办的不是按钮；点了开面板亮那一行；到点了的退到 `ink-muted`、在「已完成」里先展开）。

**4. 票面没写到、我自己定的边界**

1. **`showTodoRow` 现在也翻到「待办」页**（与票面的出入）：票面写提醒卡片那句话「照 `showTodoRow` 的做法……翻到『待办』页」，可代码里的 `showTodoRow` 原来不翻页：面板新开时本来就落在「待办」，但面板已开在「备忘」页时点待办卡片的标题，亮行请求在「备忘」页上找不到那一行，什么也不发生。我让 `showTodoRow` 先请求「待办」页再请求亮行，所以待办卡片的标题也跟着翻页；`lib/todo-open.test.ts` 原来那条「the button and a to-do card's title ask for nothing」改成按钮不请求、卡片标题与提醒那句话请求「待办」；`conversation.md`「两个页签」的「开在哪一页」写上这一条。
2. 「新」按卡片在不在比，不按算不算比：上一份里已经有卡片的（哪怕当时已取消）都算已有，所以勾、取消、划线、到点、备忘被删都不会让一张卡变成新的（票 102 的「状态变化不飞」靠的也是这一条）。
3. 卡片出现前那条备忘已经删掉的（`memoExists` 为假）不算，同「建了又在卡片出现前取消的提醒不算」：页上没有那一行可亮。票面只写了「不再记」不算。
4. 自动开时也显式请求页签（`requestTodoPage`），不只靠面板挂上默认落在「待办」。
5. 提醒卡片那句话是不是按钮用新函数 `reminderListed(todo, taskId)`（`lib/todo-panel.ts`，只在「Galley 在办」「例行」「已完成」里找 `kind === "task"`、同 id 的），没有改 `todoListed`。按钮的 `mainChatId` 取任务自己的 `createdIn.sessionId`。
6. hook 改名 `useFreshCards`：票 102 的飞行接在同一个收齐之后。
7. `conversation.md`「开与关」开头那句「顶栏按钮、⌘K、……回复下待办卡片的标题打开它」补上提醒卡片的那句话与备忘卡片的字（票 97 漏写的那一个也顺手写了），票面没要求。
8. 没有加新文案。

**5. 看到但没改的问题，没验证到的**

1. 400ms 是按读码估的，没在真机量过三样实际到齐的间隔。某一类读得慢、超过 400ms 才到，会落进下一批：比如备忘先到、待办 400ms 以后才到，第一批只有备忘，先开在「备忘」页（标记随之写上，待办那张不再触发）。
2. 自动开时要亮的提醒那一行，靠待办 store 的 `todo` 当时已列着这件任务。任务在建的那一刻 Core 就发了 `scheduled-tasks:changed`，一般早已列着；没列着时面板照开，那一行不亮（亮行请求取走即清，同票 87）。
3. 每日巡看若在主对话的某一轮里建出来（带 `createdIn`），会被当成提醒卡片触发，开「待办」页却没有行可亮（面板不画巡看，裁决 145）。没见过这种建法，没加排除。
4. 刚切回主对话的那一刻回复正好落定：MainView 挂载的第一次读把新提醒当起点，这次不开（方向安全，留给下一次）。待办与备忘全程在读，不受影响。
5. 没在真机（`tauri dev`）看过：提醒卡片那句话的悬停下划线、截断提示、点了以后面板与亮行；自动开在「备忘」页那一下；400ms 的等待读起来是否像卡片出现的那一下。
6. 外置运行时没跑：没有主对话时 hook 不挂、提醒卡片不画。
7. 全量测试里 Node 的 `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.` 是原来就有的。
