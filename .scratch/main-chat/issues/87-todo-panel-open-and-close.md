# 87 待办面板的开与关：窄窗口只临时看一眼、卡片标题打开面板、只自动开一次、它动过的行亮一下

Status: ready-for-agent

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
5. 只自动开一次：dev 窗口右键「检查元素」，控制台跑 `localStorage.removeItem("galley.todoPanelIntroduced"); localStorage.removeItem("galley.todoPanelOpen"); location.reload()`；关着面板跟 Galley 说「记一下周五交报告」，回复落定时面板自己打开、那一行亮；关掉后再记一件，不再自己开。

## Comments
