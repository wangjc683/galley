# 104 飞入定稿（中档）；顶栏按钮试胶囊（切换器：甲 / 丁 / 戊2 / 戊）

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 149 第 1、2 条（飞入「飞 + pop、中档」，位置定为右边最左、单独成组）、裁决 150（胶囊方向，2026-10-28，JC：「按建议推进」）。接票 [102](./102-cards-fly-into-the-todo-button-trial.md)、[103](./103-topbar-todo-button-place-and-word-trial.md)（都已合入 main，两颗临时 pill 还在）。一半是定稿（飞入），一半是新的试用（胶囊）。只改 GUI 与设计文档。外置运行时没有这颗按钮与卡片，零变化。

## 为什么

- 飞入：JC 真机比完，定「飞 + pop、中档」。
- 顶栏：位置定了；写「待办」二字 JC 觉得「楞」，而且这两个字在用户认识面板以后就不带信息。换成胶囊，一直写面板里你的事的第一行；没有事时才写「待办」，正好是新用户的状态。先和甲（不写字）、丁（认识面板前写字）一起上切换器比。

## 现状（读码起点）

- 飞入：`gui/src/lib/todo-flight.ts`（档位与路径）、`gui/src/lib/todo-flight-run.ts`（起飞、pop，`catcher()` / `catcherCentre()` 取 `[data-role="topbar-todo"]` 与其中的 `svg`）、`gui/src/hooks/useFreshCards.ts`（读 `useFlightVariants`），临时切换器 `gui/src/components/todo/flight-variants/`（`FLIGHT_LEVELS`、pill、键 `galley.tmp.todoFlight`），`globals.css` 约 1218 行起 `todo-catch-pop` / `todo-catch-wash`。
- 顶栏：`gui/src/components/layout/header/TodoToggleButton.tsx`、`MainHeader.tsx`、`UtilityCluster.tsx`；临时切换器 `gui/src/components/todo/todo-button-variants/`（现状 / 甲 / 乙 / 丙、演示数、键 `galley.tmp.todoButtonPlace`），窄时让字的容器查询门槛与算法写在 `TodoToggleButton.tsx` 文件头（票 103 回报第 2 条）。
- 数据：待办 store 的 `todo.yours`（`today` / `later` / `anytime`，`gui/src/lib/assistant-todo.ts` 约 140 行 `AssistantTodo`）、`todayCount`；面板那一行的时间写法 `lib/todo-panel.ts` 的 `todoMetaParts`（约 206 行），文案 `copy.todo.overdueDays`「逾期 N 天」等（`zh.ts` 约 2130 行）；面板组名的文案在同一处。今天的日界用 `hooks/useDayStamp`。
- 认识面板的标记：`lib/todo-panel-memory.ts` 的 `galley.todoPanelIntroduced`（UI store `todoPanelIntroduced`）。
- 切换器先例：票 85、102、103 的 pill（portal、`pointer-events: auto`、`galley.tmp.*` 键）。

## 要做的

### A 飞入定稿

1. 形态固定「飞 + pop」，幅度固定中档（票 102 的中档值：控制点 100px、峰值 20px、pop 1.15、飞 560ms，pop 约 440ms，缓动 `--ease-exit` 不变）。拆掉飞入切换器（`flight-variants/` 整块、pill、`galley.tmp.todoFlight` 的读写），档位常量收进 `lib/todo-flight.ts`，大、小档的值删掉。减少动态照旧。
2. pop 打在哪：甲、丁打整颗按钮（同现在）；戊、戊2 展开成胶囊时只打图标（`svg`，同一个缩放曲线），胶囊不动。飞行终点照旧是图标中心。
3. 设计文档：
   - `docs/design/conversation.md`：待办、提醒、备忘三种卡片各补一句（新出现时图标飞进顶栏按钮，条件见下）；或在「待办面板」的「开与关」旁边单起一小节「飞进顶栏按钮」写全：什么时候飞、什么时候只 pop、什么时候不动（面板在屏上、自动开的那一次、首次读、翻历史、状态变化、子任务卡片），收齐 400ms，中档参数，减少动态。
   - `docs/design/layout-and-chrome.md` 的「禁止」那一条（约 91 行）补：一次性的飞入与接住时的 pop 不算「健康状态用动效」（裁决 147 第 7 条）。
   - 都注「2026-10-28，票 102、104，裁决 147、149」。

### B 顶栏胶囊（切换器试用）

4. 拆掉票 103 的切换器四档（现状 / 甲 / 乙 / 丙）与它的键，位置固定为右边最左、单独成组（票 103 的甲，裁决 149 第 2 条）。悬停提示「待办与备忘」照旧。
5. 新切换器四档（从最克制排起），默认「戊」：
   - **甲**：图标加今天的数（0 时只有图标），不写字。
   - **丁**：本机还没认识面板时（`galley.todoPanelIntroduced` 没设）写「待办」（同票 103 的乙：图标、4px、字 13px、4px、数）；认识以后从下次启动起是甲。标记只在启动时读一次，这次启动里认识了也不变。切换器里加一个演示开关「当作没认识」，只换显示。
   - **戊2**：你的事的第一行在今天组（含逾期）时展开成胶囊（见第 6 条）；你的事不空但今天组为空时是甲；你的事一件都没有时写「待办」（同丁的字样，不展开胶囊框）。
   - **戊**：你的事不空时一律是胶囊，写第一行；一件都没有时写「待办」。
6. **胶囊**：
   - 内容：「时间 · 标题」，第一行是 `todo.yours` 按 今天 → 以后 → 随时 的第一件（组内顺序同面板）。时间用面板那一行同一套写法（`todoMetaParts` 的截止那一段，不要铃铛与提醒时刻）；逾期的那段用 warning 色，同面板；随时组写组名「随时」。第一行在今天组时，标题后写「+N」（N = `todayCount - 1`，0 不写）。
   - 样子：28px 高、`rounded-full`、1px `border-line`，左右内边距你按图标的视觉定（写清数值）；图标 16px thin 在左，同其他按钮；时间与「 · 」12px `ink-muted`（逾期 warning），标题 12px `ink-soft`，「+N」12px 等宽 `ink-muted`；面板开着时选中底色照旧（`bg-selected`）。最宽 220px，超了截标题（省略号），被截时悬停提示写全「待办与备忘 · 时间 · 标题」。
   - 宽度变化只动它自己的左缘（它在右边最左，右边的东西不动），验证这一点。
7. **窄时胶囊先让**：先截胶囊里的标题，标题剩不到 4 个字时整颗收成甲（图标加今天的数），再往窄才轮到左边身份行照原来的规则截。门槛照票 103 的容器查询做法与算法，数值按胶囊的最宽、最窄状态重算，写清怎么算的；最窄窗口（主区 664）、最忙的常见状态下身份行不被截。
8. **演示**（只换显示，不写数据）：真实 / 空 / 只有以后（「周五 15:00 · 取快递」）/ 今天 3 件（「今天 15:00 · 交周报 +2」）/ 逾期（「逾期 2 天 · 交季度报告」）/ 只有随时（「随时 · 整理发票」）/ 长标题（标题 30 个字）。演示数据写在切换器文件里，不进 store。
9. 判断（四档各自画什么、胶囊内容、截与收的门槛）写成纯函数单测；现有 `MainHeaderHost.*.test.tsx`、`TodoToggleButton.test.tsx` 按新档位改。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。主树里现在有主会话的临时探针（`gui/src/main.tsx` 末行与 `gui/src/zz-harness-t102.ts`，未提交），worktree 里没有，不要加进来。
- Core、手册、提示词、Agent API；面板本身；卡片几何；票 101 的自动开与收齐；`galley.todoPanelIntroduced` 的读写规矩。
- 「Galley 在办」不进胶囊（裁决 150 第 4 条）。
- 顶栏颜色规则：除逾期那段 warning 字，不加颜色、不加徽标。
- 外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 104, PRD ruling 150」）；切换器相关代码集中放、注明临时。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t104-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- 反向检查：把「戊2 今天组为空时是甲」「胶囊第一行的组序」「+N 只在今天组」「丁只在启动时读标记」「胶囊上 pop 只打图标」各改坏一处，对应测试要红，改回全绿
- 设计文档与 locale 新增行中文全角标点（自写正则扫，脚本放 scratchpad、文件名带 `t104-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 胶囊的内边距、窄时门槛与算法；丁「下次启动」怎么读。
3. 验证命令与结果原样（含两个时区、反向检查）。
4. 票面没写到、你自己定的边界（逐条）。
5. 看到但没改的问题，没验证到的（逐条，尤其真窗口才看得出的）。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新；主会话先在真窗口截过四档与演示再交）：

1. 切换器四档各看一遍，每档把演示七种状态切一遍；深色看一眼。
2. 记一件新的待办：飞进胶囊的图标，只有图标弹一下（戊、戊2），甲、丁整颗弹。
3. 定档：四选一，或说哪一档哪里要改。

## Comments
