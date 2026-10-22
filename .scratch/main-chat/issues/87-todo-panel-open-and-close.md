# 87 待办面板的开与关：窄窗口只临时看一眼、卡片标题打开面板、只自动开一次、它动过的行亮一下

Status: done（2026-10-22 JC 真机：第 1–3 站与合入后补修那一步通过，「真机看了，没问题」；第 4、5 站 JC 让主会话代走（「你可以用 computer use 直接在 dev 上自己测试吗？」），全部通过，走查中发现并修掉一处滚动问题，见 Comments 最后一条。快进合入 `31f37af7`，补修 `13265760`；主会话机器验收：读过 `lib/todo-open.ts`、`lib/todo-panel.ts`、`stores/ui.ts`、两个新 hook、`LocalFileWorkspace`、`TodoCards`、`App.tsx` 的 diff；在代理的 worktree 里重跑 `pnpm --dir gui typecheck`、`lint`、`test`（200 个文件、2177 条全过）、`git diff --check` 干净，设计文档新增行全角标点扫描 0 处；rebase 到 `2fb578a2` 时没有重叠文件）

来源：[主聊天 PRD](../PRD.md) 裁决 131 第 2–5 条（2026-10-22，JC：「按建议推进」）。只改 GUI 与设计文档。外置运行时没有待办面板，零变化。

## 现状（读码起点）

- 开关记忆：`gui/src/lib/todo-panel-memory.ts`（两处 `galley` / `elsewhere`，localStorage，只认 `"1"`，「关」是删键），`gui/src/stores/ui.ts` 的 `todoPanelOpen` / `setTodoPanelOpen`，测试 `gui/src/stores/ui.todo-memory.test.ts`。
- 进出口：`gui/src/lib/todo-open.ts`（`todoView`、`openTodoPanel` ⌘K、`toggleTodoPanel` 顶栏按钮、`goToTodoTarget` / `quoteTodo` / `talkToGalley` / `backToGalley` 面板里点出去的跳转，目的地那一处记为开）。`gui/src/App.tsx` 约 463–474 行算 `todoView`，约 630–686 行把面板作为 `aside` 交给 `LocalFileWorkspace`、顶栏按钮接 `toggleTodoPanel`，约 833 行 ⌘K。
- 宽窄：`gui/src/components/conversation/LocalFileWorkspace.tsx` 用 ResizeObserver 量主区，`ASIDE_SPLIT_MIN_WIDTH = 760`（`asideWide`）；`asideSplit` 时并排，否则 `asideOpen && aside && !asideSplit` 画覆盖层（约 679 行，盖住对话右边，不是对话框）。文件预览、「改动」审阅与面板互换的规则在 `lib/todo-panel.ts` 的 `readingPanelClosesTodo` / `todoPanelOpened`。
- 面板：`gui/src/components/todo/TodoPanel.tsx`（Esc 关闭约 117–133 行；行 `data-todo-row={item.id}`；标题按钮约 386–410 行；`TodoPanelGroups` 的 `doneOpen` 约 210 行，已完成默认收起）。
- 卡片：`gui/src/components/conversation/TodoCards.tsx`（标题现在是纯文字），数据来自 `gui/src/stores/assistant-todo.ts` 的 `noted`；面板数据是同一 store 的 `todo`，勾的停留（flips，1.5 秒 `TODO_SETTLE_MS`）、取消提醒（`cancelling`）也在这个 store。
- 高亮：`gui/src/styles/globals.css` 约 1020–1033 行 `.message-locate-flash`（1.4 秒，查找聊天记录定位那一种）。
- 叫醒的一轮与你发出的一轮：`gui/src/lib/assistant-conversation.ts` 文件头、`typingBubbleShown`（「a round you started from the send on, a woken one only while it writes words」）一带的判定，照它取，不另造。

## 要做的

1. **窄窗口只临时看一眼**（裁决 131 第 2 条）：
   - 主区窄于 760px 时，记住的「开」不显示。顶栏按钮、⌘K、卡片标题（第 2 项）打开的是一次临时的；×、Esc、再点按钮、离开这条对话（切会话、切到别的屏）就收起。从面板点出去的跳转照旧带到目的地（裁决 95 第 2 条），带过去的仍是临时的，跳转本身不算「离开」。
   - 窄窗口下的任何动作都不读也不写记住的开关（含文件预览、「改动」审阅换掉面板时的那条「记为关」）。
   - 窗口拉宽：记着开的照常并排出现；正临时开着的，留在屏上（并排），离开这条对话照样收起，记忆仍不改。从宽拉窄：并排的那一块收起（记忆不动），再拉宽回来又出现。
   - 顶栏按钮的选中底色跟着「屏上有没有面板」走，临时开着也算。
   - 临时状态不进 localStorage、不进 Core。宽窄与临时状态在哪里汇合（量宽的在 `LocalFileWorkspace`，算 `shown` 的在 `App.tsx` / `todoView`）由你定，进出口的规则仍集中在 `lib/todo-open.ts`；尽量写成纯函数便于测。
2. **卡片标题打开面板**（第 3 条）：
   - `TodoCards` 的标题在面板的 `todo` 里有这一件时成为按钮，样子照面板标题按钮（悬停下划线、`focus-visible` 圈、截断时悬停给全文）；面板里没有（取消的、已完成超过 7 天被放下的）照旧是文字。不加新文案。
   - 点了：面板不在屏上就在当前对话旁边打开（宽窗口同顶栏按钮，记为开；窄窗口照第 1 项临时开），已在屏上就不动开关；然后那一行亮一下（第 4 项的同一个亮法），不在视野里先滚过去；在「已完成」里且已完成收着的，先展开。
3. **只自动开一次**（第 4 条）：
   - 新标记 `galley.todoPanelIntroduced`，写在 `lib/todo-panel-memory.ts`，同那里的读写规矩（只认 `"1"`、try/catch、读不到当没设）。启动时 `galley.todoPanelOpen` 或 `galley.todoPanelOpenElsewhere` 为 `"1"` 也算已设。
   - 你自己开或关面板的任何动作（按钮、⌘K、×、Esc、面板里点出去的跳转、卡片标题，宽窄都算）写上标记。
   - 触发：标记没设时，一张待办卡片在你眼前出现：你在主对话里发出的那一轮正在落定，这一轮记下了你的待办（`noted` 里新出现、`createdIn` 是主对话这一轮的那件）；不是首次载入、不是翻历史、不是叫醒的一轮；只认你的待办（`kind === "todo"`），子任务与它自己的提醒不算。同时要求 Galley 对话本身在屏上（`mainChatOnScreen`）且主区不窄。满足就在 Galley 一处打开（`setTodoPanelOpen("galley", true)`，记为开）、亮那一行、写标记。窄窗口时不开，标记也不写，留给下一次。
   - 判定写成纯函数（输入：标记、上一份与这一份 `noted`、这一轮是否你发出、主对话是否在屏上、宽窄），单测覆盖每个条件。
   - 改 `lib/todo-panel-memory.ts` 文件头「nothing opens it but you」那段：除了第一次，写依据（裁决 131 第 4 条：巡看那一条要看得见、撤得掉，助理 PRD 裁决 10）。
4. **面板开着时它动过的行亮一下**（第 5 条）：
   - 只在面板在屏上时比：面板挂上时记下当前清单作起点（不亮），之后每次清单刷新与上一份逐件比（面板的 `TodoItem` 没有 `updatedAt`，按字段比），亮：
     - 你的事、Galley 在办、例行里新出现的一件（含子任务）；
     - 你的事里改了 `text`、`due`、`reminder`（时间或暂停）、`notes` 的；
     - Galley 在办里它自己的一次性提醒改了 `text` 或 `at` 的；例行改了 `text`、`repeat`、`timeOfDay` 或暂停的；
     - 它替你勾掉的（`doneBy` 不是你，或不是这个窗口发出的勾）：照你勾的样子在原位停 `TODO_SETTLE_MS`（打勾、删除线），亮一下，再落进「已完成」。
   - 不亮：这个窗口里你自己做的（勾、取消勾、取消提醒、取消它的提醒，store 里有在途记录）；子任务出现之后的状态、标题、`at` 变化；例行响过后 `at` 的推进；一次性提醒到点进「已完成」；已完成里新出现的（除了上面它替你勾掉的那种）；被取消的照旧直接离开。
   - 亮法：行上用 `message-locate-flash`（照它的减少动态处理）；同一次刷新亮几件就几件，滚到第一件（不在视野里才滚）。比较写成纯函数放 `lib/todo-panel.ts`，单测逐条覆盖上面的亮与不亮。
5. **设计文档**：
   - `docs/design/conversation.md`「待办面板」：开与关一段写上窄窗口只临时看一眼、只自动开一次（条件与标记）、它动过的行亮一下（亮与不亮）；「待办卡片」写上标题按钮。
   - `docs/design/layout-and-chrome.md`「待办按钮」的「记住开关，分两处」那一条补窄窗口不读不写、只自动开一次；§ 开头「主区窄于 760px 时盖住对话的右边」那句补「临时的」。
   - 都注「2026-10-22，票 87，裁决 131」。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- Core、`core/`、手册、提示词、Agent API；两处记忆的键名与读法（只加新标记）。
- 面板的分组、行几何、宽度（票 84、86 的定稿）；勾的停留时长。
- 外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；状态归零用渲染期带守卫的 setState；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 87, PRD ruling 131」），密度相当。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- 反向检查：把窄窗口判定、标记判定、亮行比较各改坏一处，对应测试要红，改回全绿
- 设计文档新增行中文全角标点（自写正则扫 diff 新增行，脚本放 scratchpad、文件名带 `t87-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 宽窄与临时状态放在哪、为什么；触发判定与亮行比较两个纯函数的签名。
3. 验证命令与结果原样（含两个时区、反向检查）。
4. 票面没写到、你自己定的边界（逐条）。
5. 看到但没改的问题，没验证到的（逐条）。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新；窄窗口要把窗口拖到主区不到 760px，约窗口 1000px 以下视侧栏宽而定）：

1. 宽窗口，Galley 里打开面板，再把窗口拖窄：面板收起；拖宽回来又出现。
2. 窄窗口里点顶栏「待办」：盖在右边；切到工作台再回来：没了；重启：宽窗口下仍是原来记住的样子。
3. 点回复下 702 那张卡片的标题：面板打开，那一行亮一下。
4. 面板开着，跟 Galley 说「702 那件改到 11 月 25 日」：那一行亮一下，日子变了。再说「加一个待办：明天交周报」：新的一行亮。
5. 只自动开一次：dev 窗口右键「检查元素」，控制台跑 `["galley.todoPanelIntroduced","galley.todoPanelOpen","galley.todoPanelOpenElsewhere"].forEach(k=>localStorage.removeItem(k)); location.reload()`（右键要点在输入框里，别处的右键菜单被应用拦掉了；其他那一处记着开也算「认识了」，三个键都要删）；关着面板跟 Galley 说「记一下周五交报告」，回复落定时面板自己打开、那一行亮；关掉后再记一件，不再自己开。

## Comments

### 2026-10-22 实现回报（票 87 代理）

worktree `/Users/inkstone/Documents/genericagent-webui-wt87`，分支 `ticket-87-todo-open-close`，从 `b72df393` 起；本地 main 之后多了 `2fb578a2`（只动 `.scratch/dedicated-browser/PRD.md` 与 `docs/devlog/deferred.md`，与本票没有重叠文件）。未 push、未合入。

**1. 提交列表**（这条回报自己的提交在它之后）

```
fca6857e Design: the to-do panel's open and close (ticket 87, ruling 131)
4c7d99c7 Ticket 87: the to-do panel's open and close (narrow look, card title, opens once, rows light)
```

**2. 宽窄与临时状态放在哪、为什么；两个纯函数的签名**

- 宽窄：`LocalFileWorkspace` 的 ResizeObserver 照旧量主区，结果写进 UI store 的 `todoNarrow`（`setTodoNarrow`，值不变不写）；它自己排并排还是覆盖也改读这个值，原来的本地 `asideWide` state 删了，一处来源。初值为 `true`（测到之前当窄）。
- 临时状态：UI store 的 `todoGlance: { at, arrived } | null`，`at` 是这条对话（`todoConversationKey(screen, activeSessionId)`：`main:<会话 id>` 或 `empty`），不进 localStorage、不进 Core。
- 汇合：`lib/todo-open.ts` 的纯函数 `todoView(hasMainChat, open, screen, session, look: { sessionId, narrow, glance })` 算 `{ entry, here, at, narrow, shown }`，`shown = hasMainChat && (glance.at === at || (!narrow && open[here]))`；App 照它给 `aside`、顶栏按钮的选中底色、⌘K。所有进出口（按钮、⌘K、×／Esc、面板里点出去的跳转、卡片标题、自动开）都收一个 `TodoSpot`（`here`、`at`、`narrow`），宽窄的分支只在 `lib/todo-open.ts` 里。离开这条对话：`todoGlanceAfterMove(glance, at)`（纯）由 `hooks/useTodoGlanceFollow.ts` 在 `at` 变化时套用。
- 为什么放 store：进出口函数在 React 之外、本来就读写 UI store；自动开的判定是待办 store 的订阅回调，也要在 React 之外读宽窄。App 只接线（文件里没有 `useEffect`），所以跟随与自动开各是一个 hook。
- 自动开的判定（`lib/todo-open.ts`）：

```ts
export function todoPanelIntroduces(input: TodoIntroduction): string[];
export interface TodoIntroduction {
  introduced: boolean;
  previous: readonly TodoItem[] | null; // null = first read
  next: readonly TodoItem[];
  mainChatId: string | undefined;
  yourRound: boolean; // !inReportRound(main chat turns)
  mainChatOnScreen: boolean;
  narrow: boolean;
}
```

  返回刚出现卡片的待办 id，空数组即不开；`hooks/useTodoPanelIntroduction.ts` 在 `noted` 变化时调用，非空则 `introduceTodoPanel(ids)`（`setTodoPanelOpen("galley", true)`、写标记、请求亮那几行）。
- 亮行比较（`lib/todo-panel.ts`）：

```ts
export function todoPanelChanges(
  previous: AssistantTodo,
  next: AssistantTodo,
  mine: ReadonlySet<string>, // todoWritesOnTheirWay(previousState, nextState)
): TodoPanelChange; // { flash: string[]; held: TodoHold[] }
export function todoPanelRows(
  todo: AssistantTodo,
  held: readonly TodoHold[],
): { yours: TodoItem[]; done: TodoItem[]; holding: ReadonlySet<string> };
```

  `hooks/useTodoPanelFlash.ts` 在面板挂着时订阅待办 store 调用它，停留 `TODO_SETTLE_MS` 后放下 `held`，一帧后给行加 `message-locate-flash`；卡片标题与自动开走 UI store 的 `todoRowRequest`，同一个亮法。

**3. 验证命令与结果原样**

```
$ pnpm --dir gui typecheck
> galley-desktop@0.6.2 typecheck /Users/inkstone/Documents/genericagent-webui-wt87/gui
> tsc --noEmit

typecheck exit=0

$ pnpm --dir gui lint
> galley-desktop@0.6.2 lint /Users/inkstone/Documents/genericagent-webui-wt87/gui
> eslint src --max-warnings 0

lint exit=0

$ git diff --check
diff-check exit=0

$ pnpm --dir gui test
 Test Files  200 passed (200)
      Tests  2177 passed (2177)
local exit=0

$ TZ=UTC pnpm --dir gui test
 Test Files  200 passed (200)
      Tests  2177 passed (2177)
UTC exit=0

$ TZ=America/Los_Angeles pnpm --dir gui test
 Test Files  200 passed (200)
      Tests  2177 passed (2177)
LA exit=0
```

反向检查（每次先把文件备份到 scratchpad，改坏、跑、用备份 `cp` 回去、再跑）：

```
--- broken: narrow ignored in todoView
     × does not show the remembered open; widened, it is back 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 46 passed (47)
--- restored
      Tests  47 passed (47)
--- broken: the flag ignored in todoPanelIntroduces
     × not once met 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 46 passed (47)
--- restored
      Tests  47 passed (47)
--- broken: narrow ignored in todoPanelIntroduces
     × not in a narrow main area 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 46 passed (47)
--- restored
      Tests  47 passed (47)
--- broken: a place left open no longer counts as met
     × counts a place left open as met 6ms
     × starts from what was written, a place left open counting 10ms
     × is written by every remembered open or close, so a close keeps it met 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
      Tests  3 failed | 16 passed (19)
--- restored
      Tests  19 passed (19)
--- broken: notes no longer compared
     × lights a to-do of yours with new words, due time, reminder or notes 9ms
     × lights what Galley changed in a fresh list 63ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 54 passed (56)
--- restored
      Tests  56 passed (56)
--- broken: this window's own tick held and lit
     × does not light this window's own writes on their way 10ms
     × holds a to-do Galley ticked off for you where it stood, lit, before 已完成 2ms
     × does not light this window's own write 40ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
      Tests  3 failed | 53 passed (56)
--- restored
      Tests  56 passed (56)
```

设计文档新增行的全角标点：scratchpad 里的 `t87-cjk-punct.py` 扫 `git diff -- docs/` 的新增行（跳过行内代码、代码块、链接目标），结果 `0 added line(s) with half-width punctuation next to CJK`；这条回报也照样扫过。

**4. 票面没写到、我自己定的边界**

1. 「这条对话」按会话认：`main:<id>` 或 `empty`。空白新对话发出第一句（从 `empty` 变成 `main:<新会话>`）算离开，临时开着的收起。
2. 跳转途中不算离开：跳转把临时状态先送到目的地（`arrived: false`），落地前经过别的对话（目的地要先 restore，切换会先停在旧会话上）不收起，落地后才 `arrived`；跳到屏上这条对话即已到达。回 Galley 落不了地（Core 失败）时，送出去的临时状态跟定位、引用请求一起撤掉。
3. 临时开着以后拉宽：留在屏上；之后的关、跳转、卡片标题按宽窗口的规矩写记忆，拉宽本身不写。
4. 标记的写入比票面多一处：`setTodoPanelOpen` 每写一次记忆也写标记（包括文件预览换掉屏上面板那次）；`markTodoPanelIntroduced` 每次都写 localStorage，不因内存里已是 `true` 就跳过。原因：启动时因 `galley.todoPanelOpen` 为 `"1"` 而算已设的人，之后关掉面板会删掉那个键，标记若没写，下次启动又算没设、会自动开一次。
5. 自动开排除已取消的（卡片写「已取消」，面板里没有那一行可亮）；同一轮记了几件就亮几件。没有另外核对新卡片的 `turnIndex` 是不是最后一轮：Core 的 `settle_todo_created_in` 只在一轮结束时给这一轮记的待办填 `turnIndex`，`noted` 里新出现卡片的就是正在落定的那一轮。「你发出的」在 `noted` 刷新的那一刻读 `!inReportRound(主对话 turns)`。
6. 它替你勾掉的：停留时用勾之前那一份画（备注、截止照旧，同你自己勾的停留），方框打勾、不能点（照写入中的样子：不变暗）；停留期间「已完成」的件数不算它。「是不是这个窗口发出的勾」只看 store 的在途记录（`flips`、`cancelling`，刷新前后两份都算），不看 `doneBy`。
7. 「新出现」也包括它替你取消勾、从「已完成」回到你的事里的；提醒加上、去掉都算改了提醒；提醒只比时刻与是否暂停，响过（`scheduled` 到 `fired`）不算。
8. 卡片标题按钮：外层 span 占 `flex-1`，按钮只有字那么宽（同面板的标题按钮）；已完成的卡片在面板里有时照样是按钮，悬停时下划线替换删除线，同面板「已完成」的行。
9. 亮的时长与类名挪进新文件 `lib/locate-flash.ts`（`LOCATE_FLASH_MS`、`LOCATE_FLASH_CLASS`），`useStickyScroll` 改为从这里取，`globals.css` 的注释跟着改，一处常量。滚动手算（只滚面板自己的列表，留 8px 给光晕），不用 `scrollIntoView`：它会带动 `overflow-hidden` 的祖先，jsdom 里也没有。
10. `todoNarrow` 初值为窄：启动时记着开的面板先不画、测到宽再并排出现，不再先以覆盖层闪一帧（原来 `asideWide` 初值为 `false` 时会）。
11. 没有加新文案。

**5. 看到但没改的问题，没验证到的**

1. 窄窗口里记着开、打开文件预览、再拉宽：预览照旧占位（`LocalFileWorkspace` 里阅读面板赢），可 `shown` 为真，顶栏按钮是选中底色、面板却没画；这时点卡片标题不会开面板，亮行请求挂到面板下次挂上。起因是窄窗口不写记忆（票面），App 不知道预览开着。要修得让 `LocalFileWorkspace` 把「阅读面板占着」告诉 App，或拉宽时另定谁让位，超出本票，没改。
2. 自动开那一次若 Galley 里开着文件预览或改动审阅，会照「后开的换掉先开的」关掉它（只在宽窗口触发）。照票面做，没加条件。
3. 跳转途中（目的地 restore 的几十毫秒里）又点去第三个对话：送出去的临时状态停在未到达，之后去到那个目的地时会出现。概率低，没处理。
4. 你的一轮结束后、`noted` 刷新之前（防抖 150ms 加读的时间）紧接着开始一轮叫醒的：会被当成叫醒的一轮、这次不开，留给下一次（方向安全）。
5. 没在真机（`tauri dev`）看过：ResizeObserver 写 store 的时机、并排与覆盖切换时面板重新挂上、亮行与滚动的观感、`message-locate-flash` 的 6px 光晕在面板行间会叠到相邻行上。jsdom 测的是接线（类名、顺序、停留、展开「已完成」、请求清掉）；jsdom 的 `getBoundingClientRect` 全是 0，滚动那一支没测到。
6. 外置运行时没跑：没有主对话时 `shown` 恒假，`todoNarrow` 照样被写但没人用到。
7. 全量测试里 Node 的 `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.` 是原来就有的（改动前单跑 `TodoPanel.click.test.tsx` 也有）。

### 2026-10-22 主会话补修「看到但没改的」第 1 条（JC：「顺手修掉第 1 条」）

- **问题**：面板记着开、在窄窗口里开了文件预览（或改动审阅），再把窗口拉宽：预览占着位置，`shown` 却为真，顶栏按钮显示选中、面板没画出来，点卡片标题的亮行请求挂着。根子是窄窗口下开预览不写记忆（裁决 131 第 2 条），拉宽时两边都要那个位置。
- **修法**：拉宽的那一刻，还开着的预览或审阅是后开的，照「后开的换掉先开的」把它换掉的那几处记为关，同宽窗口下开它时一样（文件预览记这条对话那一处，审阅两处）。纯函数 `readingPanelClosesTodoOnWiden(reading, here, wasNarrow, narrow)` 放 `lib/todo-panel.ts`；`LocalFileWorkspace` 的 ResizeObserver 在写 `todoNarrow` 时调用它，读的是 ref 里当前开着的阅读面板与新 prop `todoPlace`（App 传这条对话的那一处，没有主对话时不传）。
- **顺带**：`replaceTodoPanel` 与拉宽这一支都只把原来记着开的记为关（`closeTodoPlaces`）。原来改动审阅在哪开都对两处写一次关，`setTodoPanelOpen` 每写一次都记「认识了」，没见过面板就先开了审阅的人会错过那一次自动打开。
- **验证**：`lib/todo-panel.test.ts` 加一条（预览换这一处、审阅换两处、没有那一处、没开东西、仍窄、本来就宽各一例）；`pnpm --dir gui typecheck`、`lint`、`test` 全过，`git diff --check` 干净。没在真机上拉窗口看过。

### 2026-10-22 主会话代走第 4、5 站

- **做法**：`main.tsx` 临时挂 dev-only 测试脚本（`zz-harness-t87.ts`），配 scratchpad 里 127.0.0.1:1421 的小服务下指令、收日志：清本机标记、往输入框填字发出、点面板 ×、记面板出现与行上 `message-locate-flash` 的时刻、按 50ms 记对话的滚动位置；`screencapture -l` 截窗口。走完撤掉，`main.tsx` 无改动。
- **第 5 站**：清掉三个键、重载后面板关着；发「记一下：周五交报告」，回复落定时面板自己打开（`introduced` 变真、Galley 一处记为开），「交报告」那一行亮。关掉面板再记「周六取快递」，卡片出现，面板不再打开。
- **第 4 站**：面板开着，「702 那件改到 11 月 25 日」那一行亮、日子变了（Galley 顺手改写了备注）；「加一个待办：明天交周报」Galley 先问是不是和「交报告」同一件，答「不是同一件，另加交周报」后新行亮；「周五的报告交了」那一行打勾、删除线、原地停住并亮，随后落进「已完成」（4 → 5），Core 记 `done_via = supervisor`。
- **发现的问题**：第 5 站面板打开那一刻，对话没留在底部，新回复和它的卡片在视野下方。重现三次并加探针：回复落定的平滑跟随（票 51）刚走到离底 1px，面板打开、对话从 1179px 变 740px、内容高出约 260–320px；跟随动画的最后一帧按旧目标收尾，滚动监听用重排后的布局读出离底约 280px，判成「不在底部」，尺寸监听晚几帧到、看到不在底部就不跟了。用按钮在静止时打开面板没有这个问题（离底 0）。
- **修法**（`gui/src/hooks/useStickyScroll.ts`）：跟随动画本来要落到底的（`attached`），自然走完时落在当时真正的底部；动画途中尺寸监听看到列宽变了，不再按开始时量的回复开头重新瞄准，当即结束动画、照平常的规则跟到底（这一种顺序是读代码推出的，真机没撞到）。修后重现：面板打开后离底 0，新回复和卡片在视野里。没有单元测试：要真实布局与 ResizeObserver，jsdom 量不出来，证据是修前修后的真机对照。
- **测试数据已清**：六件测试待办用 CLI 取消（`via = cli`，不进「最近不要的跟进」，见 `core/src/assistant_todo.rs` 的 `declined_one`），各自的提醒随之取消；702 用 CLI 改回 11 月 20 日、提醒 09:00、原来的备注（从 10-20 那次 `todo add` 的调用里抄回）。「交报告」已勾掉，留在「已完成」。回报时曾误说主对话不能删单条消息（票 32、38 早已能删），已更正。JC 随后让删掉测试对话：第 52–79 轮（10 句你的话与它们的回复）经桌面同一条删除路径（`delete_main_chat_message`）从早到晚删掉（倒着删会先剩下那句反问，主对话被当作在等回答而拒删）；「交报告」也用 CLI 取消，免得在「已完成」里成了没有卡片的孤儿。测试期间 GA 长期记忆没有改动；引擎日志里的这几轮照规矩 30 天后清。
