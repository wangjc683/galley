# 146 你派出去的子任务回来、Galley 合成时看得见它在干活；待办面板不再列子任务

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 197（JC 11-04：「按你推荐推进」）。只改 GUI、设计文档与 `core/src/assistant_todo.rs` 的注释；只影响内置运行时的主对话；工作台零变化，外置运行时没有主对话。和票 [147](./147-merge-round-reads-reports-in-place.md)（合成那一轮变快，runner / 内置 GA / 评测）并行做，互不碰文件。

## 为什么

- v0.7.6 草稿冒烟 S3：两件子任务 07:59:54、07:59:55 做完，Core 同一秒叫醒主对话；合成那一轮 100 秒，前约 54 秒对话里什么都不画。那一刻四处同时说「完了」：回复下的回执打勾、侧栏子任务行离开（裁决 177）、侧栏 Galley 卡片第二行停在上一条消息、只剩那张脸在动（裁决 110）、主对话不画三点也不画「在做什么 · 用时」（裁决 134 第 2 条「叫醒的一轮不画这一行：没人在等它」）。JC 以为卡死了。
- 库里你那一轮派出去的子任务回来的 13 轮，从叫醒到回复中位 56 秒、8 轮过 50 秒，全都开口（0 轮 `<no-reply/>`）。一声不出的叫醒全是巡看与提醒。
- JC 同时定：待办面板是将要做的事（你的、Galley 的），不是正在做什么；正在做的在侧栏。

## 要做到

### 1. 认出「下半场」

叫醒它的子任务是**你那一轮**派出去的，这一轮就是那一轮的下半场。

- 现在 `isReportRound`（`gui/src/lib/subtasks.ts`）只看开头那行的来源是 `via: "system"` + `galley-report`，巡看、提醒的叫醒也是这个来源。子任务回报那行的 reason 是子任务 id（逗号分隔，同文件 `SUBTASK_REPORT_SUPERVISOR` 的注释）；巡看、提醒的是 `sched_…`。先核实再用，别凭这句。
- 「你那一轮」：派出它的那条回复所在的一轮，开头是你的消息（GUI、手机、IM 发来的都算），或者那一轮本身就是下半场（合成时它把一件打回去重做，回来那一轮仍是你在等的）。巡看、提醒那一轮派出去的，回来时照旧。
- 一次叫醒同时带着你的子任务与别的（提醒、巡看那一轮派的）：有一件是你的就算下半场。
- 判定写成一个纯函数放进 `lib/`，配测试；别在组件里拼。

### 2. 下半场怎么画

同你发起的一轮（裁决 134、135、138）：

- 主对话：从叫醒起末尾是三点气泡，下面一行「{在做什么} · {用时}」，用时从这一轮叫醒起算（这一轮自己的运行时钟），在做什么照现规则（「思考中」，每步派发时换成 summary 的后半句，写字时「正在写回复」）。回报那行照旧不画。
- 侧栏 Galley 卡片：同你发起的一轮（`assistantCardLine` 的 `working`：主对话在屏上「正在工作…」，不在屏上写字时「正在输入…」，满 1 分钟起「正在工作 · N 分钟」）。头像那张脸照旧。
- 下半场以 `<no-reply/>` 收尾时（罕见：库里 0 次）：三点与那一行照裁决 138「三点没人接替时淡出」，不留东西。
- 你在下半场里插话（票 136）：已经按你那一轮算，照旧。
- 巡看、提醒的叫醒，以及它们那一轮派的子任务回来的那一轮：一字不改（`assistantTyping` 的「只在写字时」、卡片跟着三点走）。

### 3. 待办面板不再列子任务

- 「Galley 在办」与「已完成」里的子任务都不画；它自己的一次性提醒照旧在「Galley 在办」。一组空了就不出组名（照现在空组的规则）。
- 面板里子任务出现时亮一下（裁决 131 第 5 条）随之去掉。
- **只在 GUI 过滤**：Core 的 `assistant_todo` 那一份不动，模型每段开头的「在办的事」照旧列它的子任务；`galley todo list` 等 CLI 输出是 Agent API，不动。
- `core/src/assistant_todo.rs` 文件头「What you see is what it sees」那段改写：面板是你和它将要做的事；它在跑的子任务你在侧栏看、每件的结果在回复下的回执，模型在「在办的事」里看；两份从此不逐行相同。只改注释，不改代码。

### 4. 侧栏「还有 N 件在办」原地展开

- 在跑的超过 5 件时那一行现在打开待办面板并点亮折叠掉的几件（票 128）。改成在侧栏原地展开其余几件，那一行变成收起；不再碰待办面板。展开状态不用记住。

### 5. 文档

- `gui/src/lib/assistant-conversation.ts` 文件头 process、reports 两段，`gui/src/lib/assistant.ts` 卡片第二行那段，按下半场改写。
- `docs/design/` 里写叫醒的一轮、待办面板「Galley 在办」与「已完成」、侧栏子任务行与「还有 N 件在办」的地方，grep 出来逐处改（中文英文各 grep 一遍）；写明出处裁决 197。
- 改之前 grep `docs/design` 该组件一节的「不要 / 有意 / 分叉」与 `docs/devlog/deferred.md`，撞了就停下写进报告。

## 测试

- 判定函数：你发起的一轮派的、下半场里派的、巡看那一轮派的、提醒叫醒、混合叫醒、插话后的下半场。
- `assistantTyping` / `typingBubbleShown` / `selectAssistantRound` 在下半场与巡看各一条。
- 面板：有子任务、提醒、做完的子任务时，「Galley 在办」只剩提醒、「已完成」没有子任务；只有子任务时两组都不出。
- 侧栏溢出：7 件在跑时点「还有 2 件在办」原地展开、再点收起，不打开面板。
- 把判定临时改成恒假（或恒真）跑一遍，新测试要失败，写进报告。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run
TZ=UTC pnpm --dir gui exec vitest run
node scripts/check-docs-links.mjs
git diff --check
```

prettier 只格式化自己的 hunk，旧文件别整篇 `--write`。真机 dev 由主会话合入后走 S3。

## 环境与边界

- 只在自建 worktree 里做（放 scratchpad，从 main 起分支 `t146-merge-round-shows-it-works`），worktree 里 `pnpm install --frozen-lockfile`；绝不碰主工作树，不跑 `tauri dev`。
- 不动：Core 逻辑与 CLI、Agent API、runner、内置 GA、提示词与手册、评测（票 147 的文件）、迁移、IM、外置。
- 在分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t146-` 前缀。报告里不写绝对路径。
- 长命令前台跑，跑完再往下；别交给后台任务。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：判定怎么认的（在哪个函数、读哪几样东西）；三点、那一行、卡片各改在哪；面板与溢出怎么改的；改了哪些文件、加了哪些测试；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

2026-11-04，分支 `t146-merge-round-shows-it-works`（从 `23b3be00` 起）。只改 GUI、设计文档、`docs/devlog/deferred.md` 两条的事实，与 `core/src/assistant_todo.rs` 的文件头注释；Core 逻辑、CLI、Agent API、runner、内置 GA、提示词与手册、评测都没动。没跑 `tauri dev`，真机 S3 留给主会话。

### 判定怎么认的

- 先核实票面那句：Core 叫醒时写的备注就是它带着的 id，逗号分隔（`core/src/subtask_report.rs:1669` 的 `note_ids`：有会话的取子任务会话 id，到点的取任务 id；`:1704` 交给 `core/src/api/origin.rs:205` 的 `Origin::subtask_report`）。子任务回报是子任务的会话 id，提醒与巡看是 `sched_…`（同文件 `:905` 的重放兜底就按这个前缀分）。另有两种：定时任务在自己会话里跑完的报告，id 是那个会话（不是子任务，没有派活记录）；没起来的标签没有会话 id，不进备注。
- 纯函数 `inSecondHalf(turns, dispatches)`，在 `gui/src/lib/subtasks.ts`。读三样：叫醒行的 `origin.reason`；主对话的派活记录（`SubtaskDispatch` 的 `sessionId` → `messageId`）；`buildRunGroups` 分出的轮。最新一轮是叫醒轮、备注里有一个 id 能对上一条记录、那条回复在更早的一轮里，而那一轮是「你那一轮」，就是下半场。「你那一轮」三种：开头不是叫醒行（GUI、手机、IM、CLI 发来的都算）；它本身是下半场（递归，带记忆）；你在那条回复之前插过话（票 136 的「插了话就按你那一轮算」推过来的，票面没明说，见 Open risks）。有一件是你的就算。打回去重做的子任务派活记录不变，回来照它第一次派出的那一轮认。认不出的（没有记录、派出它的回复不在已读的页里、没起来的子任务）一律按叫醒画，旧画法是安全的一边。
- 接进去的地方只有一处：`gui/src/lib/assistant-conversation.ts` 的 `cachedReportRound(turns, dispatches)`，叫醒轮里减去插过话的、再减去下半场；`assistantTyping`、`typingBubbleShown` 多一个可选的 `dispatches`。缓存按 turns 与记录两个引用记。

### 三点、那一行、卡片

- 三点：`MainView.tsx` 多读一份主对话的派活记录（`stores/subtasks.ts` 的 `useSubtaskDispatches`），传给 `typingBubbleShown`；下半场从叫醒起末尾就是三点。
- 那一行：同一份记录传给 `lib/assistant-progress.ts` 的 `assistantDoing`（多一个可选参数）。在做什么照旧（这一段从叫醒行起：叫醒行是一行 user，`settledStepHalf` 本来就在它那里停）；用时照旧读这一轮的时钟，叫醒轮的时钟本来就从叫醒行的 `created_at` 起（`stores/messages.ts` 的 `runOpenedBy`），没改。
- 卡片：`hooks/useAssistantProgress.ts` 的 `selectAssistantRound`、`hooks/useAssistantSentence.ts` 的 `selectAssistantTyping` 多一个可选的 `dispatches`；`useAssistantRound`、`useAssistantTyping` 自己读记录，用新的 `hooks/useSubtaskCards.ts` 的 `useLoadedSubtaskDispatches`（读一次 Core，页面一辈子一次，主对话没打开过也认得出；`useSubtaskDispatchesByMessage` 改为用它）。下半场里 `round` 是 `own` / `own-writing`，卡片走 `workingLine`，分钟从叫醒起。脸没动。
- `<no-reply/>` 收尾：没加代码，MainView 本来就把不出声的叫醒轮当落定，三点走「没人接替时走」的淡出。

### 面板与溢出

- 面板：`lib/todo-panel.ts` 新加 `withoutSubtasks`（拿掉「Galley 在办」与「已完成」里的子任务，没有时原对象返回）。`TodoPanel.tsx` 读清单处先过它再过 `todoWithoutDeleting`，分组、判空、`todoRowsInDone`、开机自启提示都看这份；`todoPanelChanges` 比较的两份也先过它，子任务出现时亮一下随之没了。store 里的清单不动（侧栏子任务行从这里取）。面板行组件里子任务专属的画法删了（`AssistantGlyph`、`DoneRow` 的完成图标），「Galley 在办」与「已完成」的非待办行都是时钟。
- 溢出：`lib/sidebar-subtasks.ts` 的 `more` 从 id 改成折起来的那几行，新加 `sidebarSubtaskRowsShown(list, unfolded)`。展开状态在 `Sidebar.tsx` 自己的 state（不记住；折起来的都走了时用带守卫的渲染期 setState 回到收起），因为选中落在哪也看它：开着的子任务展开后选中它那一行，收起时选中回到卡片。`SidebarSubtaskRows.tsx` 那一行换成项目组的 `SidebarShowMoreRow`（「还有 N 件在办」向下的箭头，展开后是「收起」向上的箭头，收起时留在指针下），为此给它加了一个可选的 `dataRole`。删了 `lib/todo-open.ts` 的 `showSubtasksInTodo` 与 `App.tsx`、`Sidebar.tsx` 的 `onShowSubtasks` 接线。

### 文件

- GUI：`gui/src/lib/subtasks.ts`、`lib/assistant-conversation.ts`、`lib/assistant-progress.ts`、`lib/assistant.ts`（注释）、`lib/assistant-todo.ts`（注释）、`lib/todo-panel.ts`、`lib/sidebar-subtasks.ts`、`lib/todo-open.ts`、`hooks/useSubtaskCards.ts`、`hooks/useAssistantProgress.ts`、`hooks/useAssistantSentence.ts`、`hooks/useFreshCards.ts`（注释）、`hooks/useSidebarSubtasks.ts`（注释）、`stores/assistant-todo.ts`（注释）、`components/screens/MainView.tsx`、`components/conversation/TypingBubble.tsx`（注释）、`components/layout/Sidebar.tsx`、`components/layout/sidebar/SidebarAssistant.tsx`（注释）、`components/layout/sidebar/SidebarSubtaskRows.tsx`、`components/layout/sidebar/SidebarProjectGroup.tsx`、`components/todo/TodoPanel.tsx`、`App.tsx`。
- 测试：新 `gui/src/test/second-half.ts`（夹具）、`components/layout/Sidebar.subtask-more.dom.test.tsx`；改 `lib/subtasks.test.ts`、`lib/assistant-conversation.test.ts`、`lib/assistant-progress.test.ts`、`hooks/useAssistantProgress.test.tsx`、`lib/todo-panel.test.ts`、`components/todo/TodoPanel.test.tsx`、`lib/sidebar-subtasks.test.ts`、`components/layout/sidebar/SidebarSubtaskRows.dom.test.tsx`、`components/layout/Sidebar.subtask-rows.test.tsx`、`lib/todo-open.test.ts`（删 `showSubtasksInTodo` 两条）。
- Core：`core/src/assistant_todo.rs` 文件头注释（「what you see is what it sees」那段改写；Declined 那段的「唯一例外」一起改）。
- 文档：`docs/design/conversation.md`（新「下半场」一条：怎么认、照旧的、`<no-reply/>`、为什么、一批子任务的一生；「对话里」「叫醒的一轮」「三点下面那一行」「在做什么」「用时」「叫醒的一轮不画」「卡片只说屏上看不到的」「叫醒行不画」「不出声的回复」；子任务卡片的「三处各管一件事」；待办面板的开头、亮行、「Galley 在办」「例行」理由、「已完成」「勾掉的样子」「点标题」「删除」「刷新」、只自动开一次的判定）、`docs/design/layout-and-chrome.md`（§4.2 第二行与「在跑时说什么」；子任务的「列哪些」「怎么排」「做完就离开」「昨天以前在哪」「每一行」）、`docs/devlog/deferred.md`（「巡看把你停掉的子任务又派出去」「全部子任务」两条的事实）。
- 改之前 grep 过 `docs/design` 相关各节的「不要 / 有意 / 分叉」与 `docs/devlog/deferred.md`（中英文各一遍），没有撞的禁令；deferred 只有上面两条的事实要跟着改。

### 加的测试

- 判定（`lib/subtasks.test.ts`「the second half of your round」，9 条）：你发起的一轮派的（两件回来一件也算）；下半场里又派的；打回去两次的；巡看那一轮派的、提醒叫醒、巡看自己的叫醒；混合叫醒（带你的为真，只带别的为假）；巡看一轮里你插话后派的；下半场里插话；没有记录、派出它的回复不在页里、没起来的子任务；最新一轮是你的。
- `typingBubbleShown` / `assistantTyping`（`lib/assistant-conversation.test.ts`，3 条）：下半场从叫醒起、有字没字都在；巡看派的回来与提醒叫醒照旧；下半场里插话。
- `assistantDoing`（`lib/assistant-progress.test.ts`，2 条）：下半场从「思考中」起、派发换句、写字「正在写回复」；巡看派的回来不画。
- 按事件驱动（`hooks/useAssistantProgress.test.tsx`，3 条）：那一行在下半场的变化序列、用时的时钟等于叫醒行的时刻、没有记录时照旧不画；巡看派的回来不画；`selectAssistantRound` 下半场是 `own` / `own-writing`，巡看派的回来是 `woken`。
- 面板（`components/todo/TodoPanel.test.tsx` 新 1 条、改 5 条、另 1 条只改注释，夹具 `FULL` 的「Galley 在办」「已完成」加了在跑与做完的子任务；`lib/todo-panel.test.ts` 新 1 条、改 1 条）：有子任务、提醒、做完的子任务时「Galley 在办」只剩提醒、「已完成」没有子任务；只有子任务时两组都不出、是空状态；子任务出现、做完都不亮。
- 侧栏溢出（`components/layout/Sidebar.subtask-more.dom.test.tsx` 新 2 条，jsdom 渲染整个侧栏）：7 件在跑时点「还有 2 件在办」原地展开、变「收起」、再点收起，待办面板的开关、一眼、亮行请求、翻页请求都没动；开着的子任务展开后选中那一行、收起后选中卡片。另 `SidebarSubtaskRows.dom.test.tsx` 新 4 条（替掉原来交出 id 的 1 条）、`lib/sidebar-subtasks.test.ts` 新 1 条改 1 条、`Sidebar.subtask-rows.test.tsx` 改 1 条。
- 变异：`inSecondHalf` 临时改成恒假，跑上面四个文件：`Tests  10 failed | 105 passed (115)`；恒真：`Tests  16 failed | 99 passed (115)`。已还原。

### 验证（照抄输出）

- `pnpm --dir gui typecheck`：`> tsc --noEmit`，无报错。
- `pnpm --dir gui lint`：`> eslint src --max-warnings 0`，无报错。
- `pnpm --dir gui exec vitest run`：`Test Files  255 passed (255)`，`Tests  2836 passed (2836)`。
- `TZ=UTC pnpm --dir gui exec vitest run`：`Test Files  255 passed (255)`，`Tests  2836 passed (2836)`。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 494 files checked.`
- `git diff --check`：无输出，退出码 0。
- prettier：改动的文件都 `--check` 过（原本就干净的文件只动了自己的 hunk，`App.tsx` 原本不干净、只删了几行，没格式化）；`rustfmt --check core/src/assistant_todo.rs` 退出码 0。中文全角标点用自写脚本扫过新增行。

### Open risks

1. 下半场的三点与那一行在叫醒那一刻是瞬间出现的：同一次提交里这一轮由「不在跑」变「在跑」，`hooks/useBubbleMotion.ts` 只在上一次提交已经在跑时才放入场（叫醒轮随写字的淡入），也没有发出那一下的滑动，所以整栏会瞬间上跳约一个三点加一行的高度。裁决 138 没为这一种入场定动效，没改；S3 真机会看到。
2. 判定要派出它的那条回复在已读的页里：主对话一页 50 个 turn（`core/src/db/session.rs` 的 `MESSAGE_TURN_PAGE`），派出后又聊了很多、回复翻到了没读的页时，这一轮照旧按叫醒画。
3. 被巡看或提醒叫醒的一轮里你插了话、它之后派出去的子任务，回来算下半场：是从票 136「插了话就按你那一轮算」推的，票面「你那一轮」只列了另外两种。
4. 面板自动开一次与卡片飞进顶栏的「你那一轮」（`hooks/useFreshCards.ts`、`lib/todo-open.ts` 的 `yourRound`）仍用 `inReportRound`，下半场在那里照旧算叫醒；裁决 197 没提，只改了注释和设计文档的说明。
5. `core/src/managed_prompt.rs:956` 的注释「what you see is what it sees, but for the daily review」与 `docs/managed-ga-runtime/prompt-composition.md` 「Source」那段「so what the user sees is what the main chat is told」在子任务上已不成立；票面 Core 只许改 `assistant_todo.rs` 的注释，prompt-composition 在内置 GA 文档下、可能与票 147 撞，都没改。
6. 「已完成」的件数是列出的加 Core 的 `doneOmitted`（超过 50 件没列出的），`doneOmitted` 里的子任务拿不掉，7 天内做完超过 50 件时件数会多算。
7. 「还有 N 件在办」换成 `SidebarShowMoreRow` 后照它的规矩 `tabIndex={-1}`、按下不取焦点（鼠标优先，`layout-and-chrome.md` 的交互输入模型），此前那一行是能 Tab 到的按钮。
8. `lib/todo-panel.ts` 的 `assistantRowLine`、`todoRowText`、`doneRowLine` 与 `lib/todo-open.ts` 跳到子任务的分支还在（纯函数，测试还在），面板已走不到；面板行组件里的子任务画法已删。
9. 卡片在下半场写「正在工作…」只在 selector 层测了：`Sidebar.main-chat.test.tsx` 把 `useAssistantRound`、`useAssistantTyping` 整个替换掉，卡片里的接线（两个 hook 各挂一个 `loadFor`，同一个主对话去重）没有组件级测试。
10. 裁决 197 第 3 条记下的代价照旧：巡看、提醒在不出声的一轮里派的子任务，停下后桌面上哪儿都看不到；`deferred.md`「全部子任务」补了一句。
