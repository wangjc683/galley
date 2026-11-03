# 128 侧栏助理区挂出 Galley 在办的子任务

Status: needs-dogfood（2026-11-03 收尾快进合入 `bcba4a66`（裁决 177）：只列在跑与在问你、子任务出错不再算要你处理（卡片头像、顶栏身份行、收起徽标）、行定 B3、切换器已拆（`grep -rn "main chat 128\|subtask-rows-trial" gui/src` 为空）。代理 vitest 2755 条过；主会话 rebase 后复跑 typecheck、lint、diff --check 干净。偏离票面主会话认可：头像的脸也不再因子任务出错变；`useSessionsAttention` 加 `askCount`，免得一件出错盖住另一件在问你；`subtaskState` 改成 `subtaskAsking`。代理报的风险：dark 下 `ink-muted` 的圈可能太淡；一件时品牌色的圈本来更像在动；同时出错又在问你的算出错；行跟着待办列表重读、头像跟实时状态，可能差一拍；脸的改动没有直接测试。第一次合入的记录：2026-11-03 快进合入 `df8c956c`：`ccbab53c` 子任务行，`df8c956c` 临时切换器。代理在 worktree 跑过：vitest 247 个文件 2749 条过、typecheck / lint / diff --check 干净，生产构建里没有切换器的字。主会话 rebase 到 `4c75d9a0` 后复跑 typecheck、lint、diff --check 干净，相关 25 个测试文件 287 条过，扫过无私有路径；演示数据是虚构的日常差事；合入后截 dev 窗口确认页面重载、胶囊在右下角、真实数据下没有子任务时侧栏不变。偏离票面主会话认可：状态字复用侧栏的「等你回复」「出错」，不新造「在问你」（一件事一个词）；打开的子任务有自己那一行时，卡片让出选中态（侧栏只有一处选中）；行组件没直接复用 `SidebarSessionRow`（它是 div、带第二行和来源图标），复用了它的图标、渐隐、栅格和选中样式；「还有 N 件在办」照 ⌘K 的打开法开面板并点亮折叠掉的那几件。代理报的看到没改：卡片行里 `fromSubtask` 的分支已走不到；面板与新行的子任务图标映射重复一份；英文无障碍名「Subtask: X, Waiting for you」句中大写。Open risks：行跟着待办列表重读（Core 事件后 150ms），头像是实时的，可能慢半拍；卡片让出选中态是看得见的变化。等 JC 在 tauri dev 里点胶囊比样式 A / B / C × 数据 1 / 3 / 7 件，定了再拆切换器（拆法见报告第 7 条：删 `gui/src/dev/subtask-rows-trial.tsx`，`grep -rn "main chat 128" gui/src`）；卡片第二行、选中态要等票 127 合入后有真实子任务时看）

来源：[主对话 PRD](../PRD.md) 裁决 176（推翻裁决 25、30「子任务不进侧栏的任何地方」）。只改 GUI：侧栏助理区、助手卡片第二行、文案、测试、设计文档，加一个**临时**的 dev 切换器与演示状态；不动 Core、CLI、Agent API、迁移。只影响内置运行时；外置运行时没有主对话，零变化。

与票 126 / 127 并行：那两张票在别的 worktree 里改 Core、`gui/src/lib/ipc/ga-output-cleaning.ts` 与入口层提示词。本票别碰这些文件。子任务的短标题要等 126 合入后才有，本票按会话现在的标题画（会是长句，截断即可）。

## 为什么

裁决 174 起，主对话会同时派出几件子任务。子任务的卡片挂在派活那条回复下面，随对话滚走；侧栏又不列它（`docs/design/layout-and-chrome.md:306`），想看「Galley 的团队现在在干什么、谁在等我」没有地方看。

## 要做到

### 1. 列哪些、怎么排

- **数据**：与待办面板「Galley 在办」里的子任务同一份：`gui/src/stores/assistant-todo.ts` 里 `assistant` 一组中 `kind === "subtask"` 的那些。Core 已经替你筛过（没做完、没升为普通对话、没归档；不在跑且 7 天没动的掉出去，见 `core/src/assistant_todo.rs:16-24`）。`useAssistantTodoSync` 在有主对话时一直在读，不用另读。不另起筛选规则，不读 `subtask_dispatches`。
- **要你处理的**（在问你、出错）：全部列出，排在最前面，永远不藏。
- **其余**（在跑、停在步数上限、中途停下）：排在后面，按开始时间（先开始的在上），最多 5 行。超出的写一行「还有 N 件在办」/「N more in progress」，点开待办面板：同顶栏待办按钮的打开动作，在当前对话旁边开，滚到或聚焦「Galley 在办」那一组。现成的做法能做到就做，做不到在报告里说明。
- `TodoItem` 里如果没有开始时间：先找现成字段（会话的 `createdAt` 在 sessions store 里能按 id 查到）。实在没有，就照面板现在的顺序，在报告里说明。**不为此改 Core。**
- 没有子任务时，这一块一行都不占，侧栏与现在一个像素不差（加一条测试钉住）。
- 纯逻辑（分组、排序、截到 5 行、超出几件）放 `gui/src/lib/`，带单元测试。

### 2. 每一行

- 一行一个子任务，是一个对话：点开在主区打开它，同子任务卡片的「打开」（面包屑「Galley ›」照旧）。它开在主区时，这一行是选中态，同对话行。
- 一行写：状态图标 + 标题（单行截断，右端渐隐，同对话行）。要你处理的在右端加状态字「在问你」/「出错」，色与字重同对话行的等你回复 / 出错；在跑的不写字，图标说。
  - 图标、行高、字号先复用侧栏对话行（`gui/src/components/layout/sidebar/SidebarSessionRow.tsx`、`SidebarTimelineRow.tsx`）现成的状态图标与样式。能直接复用行组件就复用，不另写一套。
- 子任务行没有右键菜单、没有悬停「⋯」：归档、删除这些是 Galley 的事。
- 位置：助理区里，助手卡片下面，助理区与工作台之间那条分隔线（`line-strong`）之上。助理区现在的上下留白（裁决 118 C）读 `SidebarAssistant.tsx` 与设计文档 §4.2 后保持住。侧栏收起时不画。
- 无障碍：每行是按钮，名字「子任务：{标题}」，要你处理的接「，在问你」「，出错」。「还有 N 件在办」那一行的名字同字面。

### 3. 卡片第二行不再替子任务说话

- `gui/src/lib/assistant.ts` 约 `:112-140`：子任务在问你、出错时，卡片第二行原来写「子任务在问你」「子任务出错」。改成不写，第二行回到它没有子任务状态时会写的东西（Galley 自己的状态、最后一句等）。
- 头像的样子与名字加粗照旧汇总子任务的状态（`kind` 与 `fromSubtask` 留着）；侧栏收起时的徽标照旧计数。
- **主区顶栏的身份行**（`AssistantIdentity` / `MainHeader`）共用这份状态，它的第二行照旧写「子任务在问你 / 子任务出错」，不在本条里。改的时候把两处拆开，别把顶栏一起改了。
- 相应的测试跟着改。

### 4. 临时切换器与演示状态（dev 专用，测完拆）

JC 要在 `pnpm --dir gui tauri dev` 里真机比。本机现在没有在跑的子任务，所以要演示状态。

- 一颗常驻、可点的小胶囊，挂在窗口角上：用 portal，`pointer-events: auto`，`z-index` 高过侧栏。只在 `import.meta.env.DEV` 下挂。两个维度，点一下切到下一档，胶囊上写当前档：
  - **样式**：
    - A：同工作台对话行（同行高、同 13px、同图标位）；
    - B：小一号（12px、`ink-soft`、行高比 A 少 4px）；
    - C：同 A，但整行向右缩进一级（像挂在 Galley 下面）。
  - **数据**：
    - 真实：读 store；
    - 1 件：在跑 1；
    - 3 件：在问你 1、在跑 2；
    - 7 件：在问你 1、在跑 6，在跑的只显示 5 行，再加一行「还有 1 件在办」。
- 演示数据只在内存里叠加，不写库、不发 IPC。标题用虚构的日常差事，比如「整理下载文件夹里的发票」「把会议纪要整理成一页」「比较三款扫地机器人的价格」，不写真实人名、公司、地址。点演示行什么也不做。
- 所有 dev 专用代码集中在一个新文件（比如 `gui/src/dev/subtask-rows-trial.tsx`），接线只有一两处，用 `import.meta.env.DEV` 包住。报告里写清拆的时候删哪些。

### 5. 文案

`gui/src/i18n/locales/zh.ts` / `en.ts` 加：「还有 N 件在办」/「N more in progress」，行的无障碍名前缀「子任务：」/「Subtask: 」。状态字复用现有的键（侧栏的等你回复 / 出错，或 `subtask` 一节里现成的），能复用就不新造。键放在 `subtask` 或 `assistant` 一节里，照附近的注释习惯写来由（裁决 176）。

### 6. 设计文档

- `docs/design/layout-and-chrome.md:306`「子任务……不进侧栏的任何地方」改写：现在子任务会挂在助理区（2026-11-03，裁决 176，推翻 25、30），写清列哪些、怎么排、5 行上限、做完就离开、昨天以前在哪（卡片、面板「已完成」、⌘K、成了普通对话的进时间分组）。其余「不进置顶、项目、时间桶、其他来源、更早」照旧。
- §4.2 助手卡片第二行那一段，写明不再写子任务的状态（裁决 176 第 5 条），顶栏身份行照旧。
- 行高、字号、缩进写「待真机定（切换器 A / B / C）」。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
git diff --check main...HEAD
```

- `gui/` 不是 prettier-clean，只管自己的 hunk；新文件可以整篇格式化。
- React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；状态归零用 guarded setState-in-render；工具函数别从组件文件导出。
- `renderToStaticMarkup` 的静态渲染测试读不到测试里往 zustand 塞的值（读初始状态）。要测带数据的渲染，把逻辑放 `lib/` 测，或用 `vi.mock` 包住读 store 的 hook。
- 中文全角标点：在 scratchpad 写 `cjk-punct-128.py`，扫新增行。

## 别动

- 只在 worktree 里改，绝不碰主工作树 `~/Documents/genericagent-webui`；不跑 `tauri dev`、不跑 `galley` 写命令、不读写用户的应用数据目录。
- Core、CLI、`gui/src/lib/ipc/ga-output-cleaning.ts`、`core/src/managed_prompt.rs`（票 126 / 127 在改）不动。待办面板、子任务卡片、工作台列表、「其他来源」不动。主区顶栏身份行不动。

## 提交与回报

- 在 worktree 分支上提交，只点名本票文件，禁用 `git add -A` / `git commit -a`。提交说明用英文，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，命令后接 `git log --oneline -1`，提交号只抄输出。dev 切换器单独一个提交，方便之后撤掉。
- 报告：①改了哪些文件 ②提交号（哪个是切换器）③每条验证命令与结果 ④偏离票面的地方与理由 ⑤看到没改的 ⑥Open risks ⑦拆切换器时要删的东西。

## 收尾（2026-11-03，裁决 177）

JC 真机比过 A / B / B2 / B3 / C，定 B3；又问出错、停住的子任务挂多久，定甲。由原代理在新 worktree 里做（从 main 起，main 已含本票与切换器）。

1. **只列在跑与在问你**：`gui/src/lib/sidebar-subtasks.ts` 只收 `running` 与 `asking`；`failed`、`stepLimit`（或这里的叫法）、`stopped` 一律不列。在问你的排前面、全列；在跑的按开始时间从早到晚、最多 5 行，超出照旧「还有 N 件在办」（`more` 只数在跑的）。`subtaskNeedsYou` 只剩 `asking`。测试改成：出错、步数用完、停住都不出现；几件旧的停住不会把在跑的挤进「还有」。
2. **子任务出错不再算要你处理的事**：卡片头像与名字加粗、主区顶栏身份行（「子任务出错」那一句）、侧栏收起时的徽标计数，都不再因子任务出错而变；子任务在问你照旧算。读 `gui/src/hooks/useAssistantState.ts`（`subtaskAttention`）、`gui/src/lib/assistant.ts`、侧栏收起徽标的来源，找到子任务出错进来的那几处，只拿掉子任务的出错，主对话自己的出错照旧。系统通知（`gui/src/lib/subtask-notify.ts` 子任务自己的出错通知，只在报告送不到 Galley 时补发）不动。`copy.subtask.sidebarErrored` 若没人用了就删，连同测试。
3. **行定 B3，写进正式组件**：`SidebarSubtaskRows.tsx` 行 `min-h-7 py-1`，标题 `text-[12px]`；在跑的标题 `font-medium`、在问你的 `font-semibold`；在跑的转圈颜色 `text-ink-muted`（照转、照粗线；`StatusIcon` 不收 className 的话，在 `SubtaskGlyph` 里自己画同一颗 `CircleNotch`，别改 `status-icon.tsx`，它管工作台的行）；选中时标题 `text-ink`，其余 `text-ink-soft`。
4. **拆切换器**：照报告第 7 条，删 `gui/src/dev/subtask-rows-trial.tsx`（主会话后来加过 B2、B3 两档，一并删）；`Sidebar.tsx` 去掉 `main chat 128` 那几行，换回 `<SidebarSubtaskRows`。删完 `grep -rn "main chat 128\|subtask-rows-trial" gui/src` 应为空。组件文档注释里「still on trial」改成定稿。
5. **文档**：`docs/design/layout-and-chrome.md` 子任务那一条：列哪些改成「在跑与在问你」（裁决 177，修正 176 第 2 条），「待真机定」换成 B3 的尺寸与理由；卡片第二行、头像汇总、顶栏身份行那几处写明子任务出错不再算；`docs/copy-language-guidelines.md` 若写了「子任务出错」在卡片或顶栏出现，跟着改。
6. 验证、别动、提交与回报同上面；只改 GUI 与文档，Core 不动。
