# 42 界面：卡片下面的「待办」、对话旁边的面板、对话里的待办卡片

Status: merged（2026-10-17 快进合入 main，提交 `2228971d`、`20e10158`；回报第 4、5 条〔「记下」小字、卡片过 7 天或取消后消失〕转票 43；等 JC 真机与切换器裁决）

来源：主聊天 PRD 裁决 91（2026-10-16，JC：「丙，说说这件也要，按你推荐」）。依赖 39（待办记录、查询四组、「今天 N」、三个界面命令、事件）。只改 GUI。取代票 37 的待办对话框与书眉入口（托管运行时）；外置运行时照旧（◷「定时」与原对话框，一个像素不变）。

## 目标

侧栏 Galley 卡片下面一行「待办」，一点在主对话右边打开面板：你的事带方框、能勾；Galley 在办的只看状态；悬停一行可以「说说这件」把它引用进输入框。它在对话里记下一件待办时，回复下面挂一张带方框的卡片。

## 一、入口：Galley 卡片下面一行

- 托管运行时、有主对话时，侧栏助手卡片正下方一行：清单图标 + 「待办」，右边只写「今天 N」（票 39 的数；0 时不写）。不挂总数、不挂徽标（07-30「角标只放需要处理的数」；N 是今天到期与逾期的，本身就是要处理的）。
- 行的样子照侧栏行的网格（左 18px 线、文字列 42px，`docs/design/layout-and-chrome.md`「侧栏网格」），与卡片的关系做切换器（见六）。
- 面板开着时这一行是选中态（照侧栏选中的通道）。
- 书眉托管下撤掉待办图标，回到搜索与新建项目两个（照 `layout-and-chrome.md` 书眉一节的对齐规则）；⌘K 的「待办」改为打开面板（先进助理）。外置照旧。

## 二、面板：主对话右边

- 复用阅读面板那个位置（`docs/design/layout-and-chrome.md` 主区一节：主区够宽时并排、可拖、全局记住比例；不够宽时覆盖），但待办有自己的默认宽度（比阅读面板的 46% 窄得多，做切换器）与自己记住的比例，不和文件预览共用。待办与文件预览同时只开一个（后开的换掉先开的），写清楚。
- 只在助理空间里开；从工作台点那一行：进助理并打开面板。开着时切到工作台，面板跟着收起，回到助理时恢复。
- 顶部：标题「待办」，关闭按钮；不放输入框（裁决 91 第 6 条）。
- 分组（票 39 的四组）：
  - **你的事**：小标题「今天」「以后」「随时」，空的不画。每行：方框（`ui/checkbox.tsx` 的视觉）、标题（一行，省略）、下一行小字（截止、提醒时刻、「10-16 记下」），逾期的时间用 warning 色写「逾期 N 天」。
  - **Galley 在办**：不给方框，行首用会话行同一套状态图标（在跑、在问你、出错；等着到点的用时钟），标题与状态小字。
  - **例行**：重复图标、标题、规则与下次时刻，暂停的写「已暂停」。
  - **已完成**：默认收起，写件数；展开后对勾（品牌色填）、标题删除线、整行淡化（照 Markdown 删除线的 `ink-muted`）。
- 全空时一行说明加一个例子与「去跟 Galley 说」（文案规范：离开对话时写名字，`docs/copy-language-guidelines.md`「Galley」一行）。

## 三、动作（只有这几个）

- **勾掉 / 取消勾**（只有你的事）：勾下去立刻划线、淡化，原地停约 1.5 秒（照动效 token，时长你定、写理由）再落进「已完成」；这期间再点一次就取消勾。调用票 39 的命令；失败放回原样、行下写一行原因。勾掉带提醒的，行上的提醒小字跟着消失（Core 已取消）。
- **取消提醒**：有提醒的待办悬停时出现（或在提醒小字旁），只去掉提醒、不动待办。
- **说说这件**：悬停一行出现（你的事、Galley 在办、例行都有），点了把这件事的标题作为引用放进主对话输入框（票 07 的 `lib/composer-quote.ts`，上限与去重照旧），聚焦输入框；面板不关。
- **点标题**：跳回 Galley 当初记下它的那句（票 28 的定位与高亮）；子任务打开子任务；没有挂处的不跳。
- 没有删除、编辑、拖动排序、新建。

## 四、对话里的卡片

- Galley 在一条回复里记下的待办，回复下面挂一张待办卡片（取代票 37 提醒卡片在这一情况下的样子）：方框、标题、截止与提醒；你在卡片上也能勾（同一个命令），状态与面板同步。Galley 自己回头查的定时任务照旧是票 37 的提醒卡片。
- 排序照票 37：先子任务卡片，后待办与提醒卡片。

## 五、事件与刷新

- 收到待办与定时任务的变化事件就刷新面板、卡片、「今天 N」；跨午夜重算今天（照 `useDayStamp`）。

## 六、临时切换器（裁决 91 第 8 条：视觉真机比）

照票 10 的做法（一颗常驻可点的 pill，portal + `pointer-events: auto`，选择存 localStorage、try/catch，默认第一档，接入点标 `TEMP variant switcher (main-chat 42)`，拆法写在文件头，临时 UI 不进 i18n）。只比这三件，每件 2–3 档、从最克制的排起：

- **A 卡片下面那一行**：独立一行（和会话行同高）/ 贴着卡片、缩进到卡片文字列的一行小字 / 你提的另一种（写理由）。
- **B 面板默认宽**：约 320px / 约 380px（主区不够宽时都覆盖）。
- **C 已完成的淡化**：只删除线 + `ink-muted` / 再整行降不透明度。

## 七、文案与文档

- 新文案进 i18n（中英）；照文案规范，离开对话的地方写「Galley」。
- 设计文档：`layout-and-chrome.md`（侧栏那一行、书眉撤图标、面板占位）、`conversation.md`（待办卡片、面板）、`overlays-and-settings.md`（票 37 的待办对话框一节改写为面板或指向新节）。
- 重置主对话的确认框「会删除」加一条待办（票 39 的数据层）。

## 验收

- typecheck、lint、全量 gui 测试两遍（本机时区与 `TZ=UTC`：今天、逾期、跨午夜是重点）、`git diff --check`、六个门禁、中文标点扫新增行。
- 测试：侧栏行只在托管有主对话时出现、「今天 N」；书眉托管下两个图标、外置照旧；面板分组与空组不画；勾掉、停留、取消勾、失败放回；取消提醒；说说这件进输入框；点标题的跳转目标；卡片与面板同步；切换器默认档与拆法。
- 真机（JC）：跟 Galley 说「周三下午 3 点前要交季度报告」看卡片与面板；在面板里勾掉、再取消勾；对一件点「说说这件」说「改到周四」；从工作台点卡片下面那一行；切三件变体。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-todo-panel`）

**改了哪些文件**

- 数据：`gui/src/stores/assistant-todo.ts`（新：待办那一份数据、勾与取消勾的停留与写、取消提醒）、`gui/src/hooks/useAssistantTodoSync.ts`（新：App 里挂一次，读、听事件、跨午夜、到点重读）、`gui/src/lib/todo-panel.ts`（新：纯函数，第二行的字、逾期、标题去哪、卡片挂哪条回复、下次重读）、`gui/src/lib/todo-open.ts`（新：开面板、标题跳转、「说说这件」）、`gui/src/lib/assistant-todo.ts`（删对话框的部分，加 `todoFailureKind`，导出 `scheduleTime`）、`gui/src/lib/message-time.ts`（加只有日期的 `formatScheduleDay`、`calendarDaysBefore`）、`gui/src/stores/ui.ts`（`todoPanelOpen`、`quoteRequest`）。
- 界面：`components/todo/TodoPanel.tsx`、`TodoCheck.tsx`、`todo-styles.ts`（新）；`components/conversation/TodoCards.tsx`（新）、`hooks/useTodoCards.ts`（新）；`components/layout/sidebar/SidebarTodoRow.tsx`（新）；`LocalFileWorkspace.tsx`（`aside`）、`MainView.tsx`（卡片、引用）、`Sidebar.tsx`、`SidebarHeader.tsx`、`SidebarNavIcons.tsx`、`SidebarAssistant.tsx`、`sidebar-width.ts`、`App.tsx`；`zh.ts` / `en.ts`。
- 切换器：`components/todo/todo-variants/`（`todo-variants.ts`，拆法在文件头；`TodoVariantsPill.tsx`；测试）。
- 删掉：`components/screens/scheduled/TodoDialog.tsx` 与它的测试、`legacyTodoGroups` / `LegacyTodoGroups`、`todoIsEmpty`、`todoBadge`、`todoCanCancel` / `Pause` / `Resume` / `Edit`、跳转目标里的 `edit`、只有对话框用的文案（接下来 / 在办 / 最近做完、手动 / Agent 标记、暂停 / 恢复 / 编辑；「还有 N 件没有列出」改名 `doneOmitted` 留着），书眉托管下的 `ListChecks`。`ScheduledTasksDialog.tsx` 一个字没动（`TaskForm` 的 export 留着，免得动外置的文件）。
- 测试：`lib/todo-panel.test.ts`、`lib/todo-open.test.ts`、`stores/assistant-todo.test.ts`、`components/todo/TodoPanel.test.tsx`（面板与卡片）、`SidebarTodoRow.test.tsx`、`todo-variants.test.tsx`、`LocalFileWorkspace.aside.test.tsx`（新）；`message-time.test.ts`、`assistant-todo.test.ts`、`Sidebar.main-chat.test.tsx`、`Sidebar.mac.test.tsx`、`MainView.assistant.test.tsx`（改与加）。
- 文档：`docs/design/layout-and-chrome.md`（书眉两个图标与 152px、卡片下那一行、面板占阅读面板的位置）、`conversation.md`（新节「待办卡片」「待办面板」，提醒卡片与阅读面板两处各一句）、`overlays-and-settings.md`（「待办」一节改为指向面板、留历史；尺寸表；⌘K 一项；重置「会删除」四条）、`copy-language-guidelines.md`（重置一表加一条；「Galley」一行）、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（桌面怎么读这一份）。

**票面留给我定的**

1. **A 的第三档：照卡片的网格的一行**。32px，图标居中在头像那 40px 列，「待办」在名字的 68px 线上，「今天 N」在时间的右缘，圆角同卡片。理由：A1 是列表的网格，放在 `line-strong` 以上读着像一行没归位的会话；A2 是卡片的注脚，裁决 91 的起因正是入口太弱；A3 读成 Galley 那一块的一部分（它的记事本），又是整行可点。A1 的「和会话行同高」我取 32px：这一行只有一行字，侧栏单行的行（新对话行、项目里的子会话）是 32px，双行的 48px 会空一大块。
2. **停留 1.5 秒**（`TODO_SETTLE_MS`）。不是动效 token：token 是动作的时长（最长 240ms），这是停留，与撤销提示条的 5 秒同类。够看清勾落下、点错了来得及再点一下（反应加重新瞄准约 0.75 秒，再留一倍），又短到清单不显得卡住；Apple 提醒事项、Things 勾完的停留在同一量级。删除线、变色、C2 的淡化用 `--motion-base`，减少动态时没有过渡，停留照旧（它不是动效）。
3. **面板怎么占阅读面板的位置、怎么记自己的宽度**：`LocalFileWorkspace` 加 `aside`，与文件预览同一个 `react-resizable-panels` 组。主区 ≥ 760px 并排（对话 440 + 面板最窄 280 + 阅读面板同样的 40 余量），可拖；面板用自己的 panel id，`useDefaultLayout` 按「组 id + 面板 id」分开存，所以比例全局记住、和文件预览互不相干；第一次打开用 px 默认宽（切换器 B）。双击分隔线回默认宽。< 760px 盖住对话右边（贴右、同宽、`shadow-elevated`），**不是对话框**：对话框会拦住输入框，「说说这件」要往输入框里放字、面板不关。同时只开一个：开面板时关掉预览或改动审阅（store 订阅，不在渲染与 effect 体里 setState）；开预览或审阅时把 `todoPanelOpen` 清掉。切换器期间 B1、B2 各用一个 panel id（`todo-panel-b1` / `-b2`），各从自己的默认宽开始、各记各的；拆的时候合成一个 id。
4. **「说说这件」与点标题在工作台与助理里**：面板只在主对话本身开着时出现（子任务不算，裁决 87 的「开着」），所以这两个动作永远对着旁边那条主对话。「说说这件」经 `ui` store 的 `quoteRequest` 交给 MainView 的输入框（`Composer.quote`：最多 3 段、同一段不重复、光标落进输入框），只认主对话、只认新请求；面板不关。点标题跳回记下它的那句：对话就在旁边，原地 `requestLocate`（票 28 的定位、翻页与高亮），面板不关；子任务、到点开过会话的例行打开那个会话，面板跟着收起，回 Galley 时恢复；没有挂处的标题不是按钮。在工作台或子任务里没有面板，从卡片下那一行或 ⌘K 进来会先进 Galley。
5. **重置确认框的文案**：「会删除」第二条「待办里你的事和挂在上面的提醒（它自己要回头查的提醒和例行留着）」/ "Your to-dos and the reminders on them (its own reminders and routines stay)"。括号那半句是因为 Core 只删挂在待办上的任务（票 39），Galley 自己的提醒和例行还会响，不写会让人以为待办里的东西全没了。
6. **英文**：你的事 / 今天 / 以后 / 随时 / Galley 在办 / 例行 / 已完成 = Yours / Today / Later / Anytime / Galley's on it / Routine / Done；说说这件 Talk about this；取消提醒 Cancel reminder；截止 Due；逾期 N 天 N days overdue；今天 N Today N。

**与票面不同、或我加的**

1. **勾掉在停留结束时才交给 Core**（票面「调用票 39 的命令」没说何时）。勾下去界面立刻打勾、划线、藏掉提醒那一段，1.5 秒内再点一下就收回，Core 不知道；停够了才 `complete_todo` / `reopen_todo`，读回新清单，这一行跟着新清单一次挪走。理由：勾掉会取消它没响的提醒，取消勾不恢复（票 39），点错了马上收回不该赔掉提醒。这段状态在 store 里：关面板、离开主对话照样写；停留中退出 Galley 就没写（安全的方向，同票 38 的撤销删除）。取消勾也是同一条规矩（已完成里的待办点一下回到你的事）。
2. **组名不转大写**：票面没说字体，我原照侧栏分区头（10px、英文大写），可「Galley 在办」会变成「GALLEY 在办」，宪法 Names And Terms 不许品牌名全大写。改为 11px semibold `ink-muted`、不转大写；「今天 / 以后 / 随时」同号常规字重，低一档。
3. **「取消提醒」在提醒小字后面**（票面允许的另一处），不和「说说这件」并排放在行尾：两个精密目标并排、行的悬停变吵，是 deferred「session 行 hover 置顶按钮」否掉行内第二颗按钮的理由。行尾只有「说说这件」一颗。
4. **没有「10-16 记下」**：票 39 的查询给待办的 `TodoItem` 不带记下的时刻（只在三个命令返回的 `TodoBrief` 里有）。没有诚实的办法在界面上补（从消息缓存找那一轮的时刻，分页没读到就没有），所以不写。要的话 Core 的 `TodoItem` 加一个 `createdAt`（只加），界面一行就能接。
5. **卡片看得见多久**：卡片从同一份查询来，所以只有没做完的与 7 天内做完的有卡片；做完超过 7 天、被 Galley 取消的，卡片不画了。Core 没有给界面读全部待办的 Tauri 命令；票 40 已经加了 `assistant_todo::todo_list(galley, all)`，包一层只读命令就能让卡片长久留在回复下面。同一条回复记了几件时按截止排（数据里没有记下的先后）。
6. **面板去掉了对话框的另外几样**：Galley 的提醒与例行的取消、暂停 / 恢复、编辑（表单建的），「手动 / Agent」标记（裁决 91 第 3 条：清单上只留勾与取消提醒）。开机自启提示一行原样搬进面板顶上。
7. **刷新多两处**：跨午夜重读（`useDayStamp`），以及有时刻的待办到点时重读一次（Core 不为钟点发事件，逾期从这一刻起算）。逾期的天数按本机日子在界面算，过了零点、重读回来之前已经对。
8. **书眉托管下两个图标**：mac 窄宽门槛 184 → 152px（80 + 2 × 28 + 4 + 12），挪进新对话行时只剩加号（字要 163 / 183px）；Windows / Linux 仍没有窄态。外置的三个图标与 251 / 189 / 179px 不动。
9. **⌘K「待办」**：总是打开（先进 Galley）；卡片下那一行是开关，面板开着时再点关掉。
10. **窄窗口覆盖时盖住输入框右端**（发送键）：回车照常发送，Esc 或 X 关面板。默认侧栏（20%）下最窄的 960 窗口主区约 767px，仍并排，所以只在侧栏拉宽时出现。

**查过的设计禁令**（`docs/design/` 与 `docs/devlog/deferred.md` 里 grep 了「不要 / 有意 / 分叉 / 禁止 / 被否 / 没选」）

- layout-and-chrome「禁止」：状态点、健康状态用颜色或动效、常驻高亮 → 「今天 N」是 11px 灰字，不是胶囊、不是点；角标只放要你处理的数（07-30）→ 没有总数与徽标。
- 侧栏选中三通道（底色、抬起、满墨色）→ 那一行照用；「静止时不画分隔线」与卡片下那条加重线 → 没有加线，那一行放在卡片块里、线以上。
- 外置这一套冻结 → 外置侧栏与定时对话框逐字节不变（见验证）。
- 「交互输入模型：鼠标优先」→ 悬停的按钮键盘聚焦时也出现，没有另做键盘故事。
- deferred「session 行 hover 置顶按钮」→ 见上第 3 条；「长工具输出在右侧阅读面板」「Artifacts 面板」都说沿用右侧面板，面板复用同一位置不冲突。
- foundations §2.7 动效：只用 token，减少动态时只淡不移；宪法：品牌名不全大写（第 2 条）。
- 记忆里的「加新容器（图标栏、开关）被否，要在现有侧栏里解」→ 那一行进的是现有卡片块，不是新容器。

**验证**（分支开在 `5f56da21`；开工后 main 合入了票 40（`c6db8edd`），已 rebase 到它上面，没有冲突，下面是 rebase 之后重跑的结果）

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：exit 0。
- vitest 全量：本机时区与 `TZ=UTC` 各一遍，都是 `Test Files 164 passed`、`Tests 1698 passed`；`src/lib`、`src/components/todo`、`src/stores`、`src/components/conversation` 另在 `TZ=America/Los_Angeles` 跑一遍，125 个文件 1368 条全过。
- 六个门禁全过：IPC 漂移 aligned（18 events、11 commands，没动 runner 协议）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check`（含新文件）无输出。新增行 grep 域名、`http`、`api_host`、`/Users/`、`/private/tmp`、`/var/folders`：0 处。
- 中文标点扫新增行（自写脚本，先用坏例子自测）：中文句子 0 处；36 处是英文注释里夹中文界面词，用英文标点，不改。
- gui 格式：新文件整篇 prettier；原本干净的旧文件整篇干净；原本不干净的（`App.tsx`、`LocalFileWorkspace.tsx`、`zh.ts`、`en.ts`）prettier 差异条数与开工时相同，我的 hunk 都干净。
- 反向检查 18 处都挂（每处改完跑对应测试，再按 sha256 还原）：书眉托管下留着定时、空的分段也画、勾了立刻写 Core、停留中再点收不回、失败不记原因、勾着的待办还写提醒、过了零点不算逾期、别的主对话的卡片也挂、引用进任意对话、点标题关掉面板、切换器默认不是 A1、提醒卡片排到待办前面（两种改法）、C2 淡化不分档、「今天 0」也写、外置也出那一行、覆盖改成对话框、「取消提醒」不在提醒旁边。
- 外置零变化：从 `c6db8edd` 用 `git archive` 解出一份，与本分支各跑同一段临时测试，渲染外置侧栏（中英、徽标 0 / 2、空与有会话）与定时对话框，mac / Windows / Linux 三种平台 30 份标记的 sha256 全部相同；`ScheduledTasksDialog.tsx`、`CommandPalette.tsx` 没有改动。
- 看界面：临时 Vite（5199 端口，不碰 Tauri）+ Chrome（playwright-core，假的 invoke）跑了真的 `Sidebar`、`LocalFileWorkspace`、`TodoPanel`、`TodoCards`：1440 宽时面板 320px 并排、B2 380px、960 宽时覆盖；勾下去原地打勾划线、1.5 秒后 `complete_todo` 再读、挪进已完成；停留中再点不调 Core；开文件预览面板让位、再点那一行预览让位；A1 / A2 / A3、C2、浅深色、中英文、空状态。截图在会话草稿目录 `t42-harness/shots/`，不进仓库。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：拖分隔线后记住的比例、Esc 与别的浮层同时开着时、Windows。
- 票 41（手册）还没合入，Galley 还不知道该用 `galley todo` 记待办；在那之前真机要么明说让它用这个命令，要么自己用 CLI 加（没有「建在哪一句」就没有卡片）。
