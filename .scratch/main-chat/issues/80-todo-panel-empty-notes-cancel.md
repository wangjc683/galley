# 80 待办面板：判空不算巡看、显示备注、它自己的提醒能直接取消

Status: done（2026-10-22 JC 真机第 1、2 站通过：「Galley 在办」里它自己的提醒（站起来活动）悬停取消、行离开、卡片写已取消，库里 `cancelled_at` 已写；702 下的备注行。空状态与巡看共存在真实数据上看不到，靠测试。快进合入 `3f72d529`、`af4de491`、`a3b421c9`）

来源：[主聊天 PRD](../PRD.md) 裁决 128 第 3、5、7 条（2026-10-22，从底层捋一遍待办；JC：「按你的推荐推进」）。只改 GUI 与设计文档。与票 81（Core：巡看判据、手册）同时在跑，不碰同一处。

## 为什么

- **空状态出不来**：票 73 起，有主对话就建好巡看那条例行（`core/src/scheduler.rs:386`，只建一次）；`todoPanelEmpty`（`gui/src/lib/todo-panel.ts:319`）把例行也算进去，票 46 定的空状态（「要办的事，说一声就记在这里。」加例子与「跟 Galley 说」）从此再也不出现，新用户第一次打开只看到一行巡看。
- **备注看不到**：它记待办时写的 `--notes`（到时要用的东西：人名、地点、号码、文件路径）已经在 Core 给面板的 `TodoItem.notes` 里（`core/src/assistant_todo.rs:859`），面板与卡片都不画。票 81 同时把手册改成「备注会显示给用户，写给用户看」。
- **取消不一致**：它自己的一次性提醒在回复下的提醒卡片上能直接取消（`gui/src/components/conversation/ReminderCards.tsx:65`），在面板「Galley 在办」里只能「说说这件」。裁决 91 第 3 条留给清单的两个直接动作之一是「取消一个提醒」，没限定挂在哪。

## 要做的

1. **判空不算巡看**：`todoPanelEmpty` 判空时，例行组里只有巡看（`isDailyReview`，`gui/src/lib/assistant-todo.ts:330`，暂停的巡看也算）时仍算空。空的时候，空状态照旧（文案、按钮、行为一字不动），在它下面照旧画「例行」组（组名与巡看那一行，与非空时同一个样子）；巡看那一行不能因为空状态而消失（助手 PRD 裁决 10：看得见、撤得掉）。例行里还有别的、或别的组有东西时，照现在的列表。空状态与「例行」组之间的间距你按现有组间距定，回报里写出数值。用户把巡看取消了（例行为空）时，就是原来的全空。
2. **你的事显示备注**：今天、以后、随时三组里没做完的待办，`notes` 去掉首尾空白后不为空时，在小字时间那一行下面多一行备注；没有时间那一行（随时组里没有截止、没有提醒的）就直接在标题下面。
   - 12px、`ink-muted`、一行，超出省略；换行与连续空白压成一个空格显示。被截断时悬停给全文，用标题被截断时的同一套做法。
   - 已完成组不显示；逾期的照样显示（备注不跟着用 warning 色）。
   - 回复下的待办卡片（`TodoCards`）不显示，卡片仍是一行。
   - 「说说这件」的引用只带标题，不带备注（照旧）。
   - 行变高以后，「说说这件」浮在行右端的位置、行尾取消提醒的位置照旧对齐它们原来对齐的那一行，回报里说明你怎么处理的。
3. **它自己的提醒能直接取消**：「Galley 在办」里 `kind === "task"`、`state` 为 `scheduled` 或 `paused` 的行（它自己的一次性提醒；不是子任务，不是例行），悬停或键盘聚焦时在小字那一行末尾出现与待办上「取消提醒」同一颗按钮：`BellSimpleSlash`、同尺寸、同位置规则（在被省略号截的范围之外）、同一句无障碍名与悬停文字（`copy.todo.cancelReminder`）。
   - 直接交给 Core，用回复下提醒卡片同一个调用（`cancelScheduledTask`，`gui/src/lib/assistant-todo.ts:484`），不确认、不停留；进行中按钮禁用；失败在那一行下面写原因，用待办上取消提醒失败时的同一套（`TodoFailure`，「这件事已经不在了。」之类，照现有文案，不加新词）。状态放在 `stores/assistant-todo.ts`，照 `cancelReminder` 的做法（同一个 `cancelling` / `failures` 表也行，另起一个也行，回报里说明）。
   - 成功后 Core 发定时任务变化事件，面板重读，这一行离开清单；回复下那张提醒卡片照旧写「已取消」（同一个 store 或同一个事件链，回报里确认卡片会跟着变）。
   - 只读核对、不改 Core：桌面上的这次取消在库里记为 `cancelled_via = 'gui'`（票 61，进「最近不要的跟进」）。核对方法写进回报；若不是，只报告，不改。
   - 子任务、例行、已完成照旧没有这颗按钮。
4. **设计文档**：`docs/design/conversation.md`「待办面板」一节改成现行做法：「全空」那条写上判空不算巡看、空状态下面照旧画「例行」；「今天、以后、随时」加备注那一行（位置、字号、颜色、省略、悬停、已完成与卡片不画）；「Galley 在办」与「动作只有这几个」写上它自己的提醒也能取消（同一颗、直接、行离开、卡片写已取消、记为桌面取消）；「待办卡片」一节写一句不显示备注。每处注明「2026-10-22，票 80，裁决 128」。不改历史段落的原意。
5. **测试**：`gui/src/lib/` 判空的单元测试（只有巡看、巡看暂停、巡看加别的例行、巡看加一件待办、巡看被取消）；`TodoPanel.test.tsx` 补：只有巡看时空状态与「例行」组都在；备注一行出现在时间行下面、没有时间时在标题下面、空白备注不画、已完成不画；它自己的提醒行悬停有取消按钮、点了调用 `cancelScheduledTask`、失败写原因、子任务与例行没有这颗按钮；`TodoCards` 不画备注。照现有测试的写法（`vi.mock`、静态渲染测试读不到 store 塞的值，见 `gui/src/components/todo/TodoPanel.test.tsx` 已有的做法）。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `core/`、`cli/`、`runner/`、`managed-ga/`、手册（`docs/managed-ga-runtime/galley-assistant-manual/`）：票 81 在改 Core 与手册。
- 分组结构、组名、排序、勾掉的停留、「说说这件」、点标题跳转、顶栏按钮与数字、开机自启提示。
- 外置运行时的定时对话框。
- 不加新文案键；需要的话停下来在回报里说明，不要自己起词。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化你改的 hunk，别对整文件 `prettier --write`。
- React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都报错；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据。

## 验证

- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `pnpm --dir gui test`（或 `pnpm --dir gui exec vitest run`，照 `gui/package.json`）全过
- `git diff --check`
- 中文全角标点（设计文档新增行）。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `todoPanelEmpty` 与面板空状态那段的 diff 原样；备注一行与取消按钮的 JSX diff 原样。
3. 空状态与「例行」组的间距、行变高后悬停按钮的对齐做法。
4. `cancelled_via` 的核对方法与结果。
5. 验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方（比如真机下 WebKit 的对齐）。

## 给 JC 的真机步骤

1. 合入后（纯 GUI，热更新即可）打开待办面板：现在只有 702 那件和巡看，面板照旧是列表；702 那行时间下面多一行备注（库里那条是旧写法「JC 告知：……」，票 81 之后新记的会写给你看）。
2. 跟它说「十分钟后提醒我站起来活动一下」，打开面板，「Galley 在办」里那一行悬停时小字末尾有划掉的铃铛；点了，这一行离开清单，回复下那张提醒卡片写「已取消」。
3. 空状态现在的库里看不到（702 还在），测试覆盖；以后清单真清空时顺带看一眼：空状态的一句、例子、按钮都在，下面是「例行」里巡看那一行。

## Comments

### 2026-10-22 实现回报（票 80 代理）

- **提交**（分支 `ticket-80-todo-panel`，未 push、未合入）：`de6e0f86` GUI 与测试；`1e65873e` 设计文档；本条回报另一个提交。
- **判空**：`todoPanelEmpty`（`gui/src/lib/todo-panel.ts:359`）把「例行为空」改成「例行里全是巡看」（`todo.routine.every(isDailyReview)`），暂停的巡看照样是巡看；巡看取消以后 Core 不再列它，例行为空，就是原来的全空。面板里空状态与列表不再二选一：空的时候先画空状态（一字不动），后面照常画 `TodoPanelGroups`，此时它只画得出「例行」一组，组名与巡看那一行和列表里同一份标记（测试逐字比过）；第一次读回来之前两样都不画，照旧。
- **空状态与「例行」的间距**：不另加，与组与组之间相同。组与组之间实际是 0 外边距：`GroupLabel` 写着 `mt-3 … first:mt-0`，可组名在每组的 `section` 里都是第一个子元素，`mt-3` 从票 42 起就没生效过；看到的是上一行 6px 底边加组名 6px 上内边距。这里看到的是空状态自己的 32px 下内边距（`py-8`，没动）加组名 6px 上内边距：按钮底到组名那一块的顶 32px，到「例行」两字的行框顶 38px。
- **备注**：新增纯函数 `todoNotesLine`（`:248`）：只给没做完的待办，`notes` 去首尾空白后为空就不画，换行与连续空白压成一个空格；悬停给的「全文」是去了首尾空白的原文（带换行，系统悬停提示会分行显示）。画法是 `NotesLine`：12px、`ink-muted`、`leading-[1.4]`、一行省略，被截断时 `syncTruncatedTitle` 给全文（同标题）。逾期的照样画、不用 warning 色；勾下去停留的 1.5 秒里照旧在（还没交给 Core，行不跳）。已完成走 `DoneRow`，不画；`TodoCards` 本来就不画，没改，补了测试。「说说这件」的引用照旧只带标题（`todoRowText`）。
- **行变高后的对齐**：备注不放进标题那一栏，而是 `RowShell` 新加的 `notes` 槽，画在装着行首、标题、小字和悬停按钮的那一块（`relative … py-1.5`）下面，自己一块：`-mt-1 pb-1.5 pl-9 pr-2.5`。往上收 4px 进那块的 6px 底边，所以离上一行 2px（同小字离标题的 `mt-0.5`），起点 36px 与标题对齐（同失败那一行的 `pl-9`），下面照旧 6px 底边。悬停按钮是 `absolute inset-y-0` 在那一块里居中，那一块的高度与没有备注时一模一样，所以「说说这件」照旧在标题与时间两行之间居中（只有标题时对着标题），「取消提醒」照旧在时间那一行末尾，靠结构保证，不靠写死的高度。备注那一行悬停时不让宽度：两行的行里按钮下沿（39.4px）在备注上沿（46.8px）之上，碰不到；只有标题的行里按钮下沿压进备注行框顶 2px，字形到不了那里。
- **它自己的提醒能取消**：新增 `assistantTaskCancellable`（`:232`）：`kind === "task"`、一次性（`repeat` 缺省也当一次性）、`scheduled` 或 `paused`。待办上那颗按钮抽成 `CancelReminder` 组件，两处用同一颗（测试比过两处按钮的标记逐字相同）。`PlainLine` 加了可选的 `after`：给了才换成 `MetaLine` 那种「截断的字 + 后面一颗按钮」的 flex 写法，子任务、例行、已完成的小字标记不变。store 里 `cancelReminder` 的写法抽成内部的 `cancel(id, write)`，新加 `cancelTask` 走 `cancelScheduledTask`，共用 `cancelling` / `failures` 两张表（待办 id `todo_…`、任务 id `sched_…`，碰不到一起）；成功后 `load()` 读回，这一行离开。失败照 `cancelReminder`：写原因、不重读，所以「这件事已经不在了。」会留到下一次事件触发的重读把这一行带走。
- **卡片会跟着变**：同一条事件链，不经 store。`delete_scheduled_task` 在 Core 的 `Writes::delete_scheduled_task`（`core/src/session_writes.rs:788`）里成功后发 `scheduled-tasks:changed`（`:747`），回复下的提醒卡片由 `useRemindersByMessage` 监听它重读（`gui/src/hooks/useReminderCards.ts:50`），读回带 `cancelledAt` 的那条，`reminderCardState` 给「已取消」；面板这边 `TODO_REFRESH_EVENTS` 也含这个事件，与 store 自己的 `load()` 叠在一起由读取票号去重。卡片自己的「取消」也是靠这同一个事件变成「已取消」的。
- **`cancelled_via` 核对**（只读，没改 Core）：链条是 `cancelScheduledTask`（`gui/src/lib/assistant-todo.ts:484`）→ `deleteScheduledTask`（`gui/src/lib/scheduled-tasks.ts:182`）带 `origin: GUI_ORIGIN`，即 `{ via: "gui" }`（`:140`）→ Tauri 命令 `delete_scheduled_task`（`core/src/commands/schedule.rs:132`）把 `origin` 原样交下去 → `db/api_impl.rs:225` → `cancel_scheduled_task`（`core/src/db/schedule.rs:596`）写 `cancelled_via = origin.via.as_sql()`，`OriginVia::Gui` 是 `"gui"`（`core/src/api/origin.rs:48`）。Core 现有测试 `every_cancel_records_who_and_why`（`core/tests/todo_test.rs:1055`）正是用 `Origin::gui()` 删一条一次性提醒，断言那一行是 `("gui", NULL, NULL)`（`:1163`）；进「最近不要的跟进」靠 `declined_one`（`core/src/assistant_todo.rs:542`，`Gui` 记为用户取消，前提是 `created_by_supervisor = 'galley-assistant'`）。GUI 这边 store 测试与点击测试都钉了 `invoke("delete_scheduled_task", { id, origin: { via: "gui" } })`。结论：记为 `gui`，与票面一致。这个 worktree 没编 Core，没跑那条 cargo 测试，也没查真实库。
- **测试**：`lib/todo-panel.test.ts` 加判空五种（只有巡看、巡看暂停、巡看加别的例行、巡看加一件待办或别组的东西、巡看被取消）、`assistantTaskCancellable`、`todoNotesLine`；`TodoPanel.test.tsx`（静态渲染、mock store）加只有巡看时空状态与「例行」都在且巡看那一行与列表里逐字相同、有别的就照列表、备注在时间行下面 / 没有时间时在标题下面 / 空白不画 / 已完成不画 / 卡片不画 / 在悬停按钮那一块之外、它自己的提醒行有按钮（暂停的也有）、进行中禁用、失败写原因、子任务 / 例行 / 巡看 / 已完成没有按钮；`stores/assistant-todo.test.ts` 加 `cancelTask` 三条。「点了调用 `cancelScheduledTask`」要真点击，静态渲染做不到，而 `TodoPanel.test.tsx` 整个文件 mock 了 store，所以另起 `TodoPanel.click.test.tsx`（jsdom，照 `FileCards.click.test.tsx`）：真 store，包一层 `cancelScheduledTask` 记下调用，点了以后这一行随新清单离开；Core 拒绝时行下写「这件事已经不在了。」、按钮恢复可点。

### 看到但没改、没验证到的

1. `GroupLabel` 的 `mt-3` 一直没生效（见上「间距」）：组与组之间只靠两边各 6px 内边距。要不要按原意补上 12px，属于分组的视觉，票面列在「别动」里，没改。
2. 判空之后 `TodoPanelGroups` 一直挂着，不再在「空 ↔ 有东西」之间重新挂载：已完成展开过、清单清空、后来又有做完的事时，「已完成」保持展开；原来回到列表时总是收起。没处理。
3. 没开自启时，开机自启提示的条件把巡看算作「会响的事」（票 73 起就如此），所以新用户的空状态下面可能是「例行」加一句「电脑重启后，要先打开 Galley，提醒才会响。」。条件没改（票面「别动」里有开机自启提示）。
4. 「Galley 在办」里的一次性任务不分谁建的：别的 agent 或旧表单建的也有这颗按钮（票面的条件只看 kind 与 state），到点开会话的（待运行）也有，同回复下提醒卡片。这种取消也记 `gui`，但不是 Galley 建的，不进「最近不要的跟进」（`declined_one` 的前提）。
5. `MetaLine` 的注释还写着「the day it was noted」，裁决 97 起小字里已经没有记下的日子，旧注释，没改。
6. 没跑 `tauri dev`，WebKit 下备注往上收 4px 后的实际间距、悬停按钮与备注行在只有标题的行里那 2px 的重叠、系统悬停提示对换行的显示，都没在真机看过；中文后备字体如果把行框撑高，备注离上一行会比 2px 多一点。
