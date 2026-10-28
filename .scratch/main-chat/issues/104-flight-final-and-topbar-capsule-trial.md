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

### 2026-10-28 实现回报（票 104 代理）

分支 `ticket-104-flight-final-capsule`（从本地 main 的 `19a78819` 拉出），worktree 里做。未 push、未合入。

**1. 提交列表**（`git log --oneline main..HEAD`，这条回报自己的提交在它之后）

```
92fba27b Design: cards fly into the top bar's 待办 button; a one-off flight and pop are not health motion (tickets 102, 104, rulings 147, 149)
8861aff5 Ticket 104: the flight settles on fly + pop, mid; the 待办 button stands apart and trials a capsule (甲 / 丁 / 戊2 / 戊)
```

A、B 两半落在同一批文件上（`lib/todo-flight-run.ts` 既定档又加了胶囊的 pop 落点），代码合成一个提交，设计文档单独一个。

**2. 胶囊的内边距、窄时门槛与算法；丁「下次启动」怎么读**

- **内边距**：左 5px（加 1px 边框是 6px，图标就在 28px 方块里原来的位置，正好落在左端半圆的圆心：6 + 8 = 14，即半径），右 9px（加边框 10px）。理由：圆端在字高范围内往里弯约 1.2px，字墨离边约 8.8px，对上左边读起来的 8px（6px 加细线图标在 16px 盒子里自带的约 2px）。图标到正文 4px（`gap-1`），标题到「+N」4px（`ml-1`）；高 28px（`size-7` 的高不变，宽 `w-auto`），最宽 220px。
- **飞行与 pop**：飞行终点照旧是按钮里那颗 `svg` 的中心；按钮带 `data-shape="capsule"` 且正文画着（`[data-capsule-body]` 有 client rect）时，`todo-catch-pop` 加在 `svg` 上（同一条曲线，`transform-origin: center`），胶囊不动；甲、丁、戊2 的甲与字、被窄顶栏收成甲的胶囊，都整颗弹（`lib/todo-flight-run.ts` 的 `popTarget`）。
- **窄时门槛与算法**：照票 103，顶栏是尺寸容器（`@container/main-header`，甲以外三档才设），门槛按内容盒在最忙的常见状态下需要的宽度定。数都在 `lib/todo-button.ts` 的 `todoButtonFit`，`TodoToggleButton.tsx` 的 `WORD`、`CAPSULE` 两张类名表照写（Tailwind 要字面量），测试读源码把表里的数与函数逐个对上。
  - **其余部分（rest）**：左 pl 10 + 侧栏开关 28 + 间距 6 + 身份行（6 + 头像 28 + 8 + 「子任务在问你」66 / 「A subtask is asking you」123.69 + 8）+ pr 12 = 172 / 229.69；右边除待办以外：四个间距 8、两道分隔线，状态簇（浏览器控制 · 待解锁、Channels、新版本）242.05 / 284.3，工具簇（改动、显示、设置）92，共 368.05 / 410.3；Windows / Linux 再加窗口控制与间距 146。向上取整：macOS 541 / 640，Windows / Linux 687 / 786。
  - **胶囊最宽**：`min(220px, 100cqw - rest)`，顶栏变窄时它先变窄、截标题。
  - **收起（fold）**：rest 加胶囊最窄的样子：框 36（1 + 5 + 图标 16 + 4，9 + 1）+ 一个常见的今天时间（「今天 15:00」61.58 / 「Today 3:00 PM」86.19）+「 · 」10.22 + 四个字加省略号（4 × 12 + 10.38 = 58.38，英文用同一个框）+「+N」（4 + 15.56）。macOS 726 / 851，Windows / Linux 872 / 997；macOS 折成主区宽是 738 / 863。低于它胶囊收成甲（图标加今天的数），再窄才轮到身份行。
  - **字（丁，戊与戊2 没有事时）**：rest 加带字与两位数的按钮（1 + 5 + 16 + 4 + 待办 26 / To-do 36.91 + 4 + 15.6 + 7 + 1）：macOS 620 / 731，Windows / Linux 766 / 877。
  - **怎么量的**：文字先在 headless Chrome 里用应用的字体与设置量（Inter 带 cv11、ss01，PingFang SC，等宽数字，`text-autospace`）；然后 `vite build` 出真的 CSS，用 jsdom 渲染真的 `MainHeader`（最忙状态：浏览器控制待解锁、Channels、新版本、改动、侧栏开关、身份行第二行最长；身份行与开关是同结构的替身），四档 × 六种演示 × 中英 × 两个平台，在 headless Chrome 里把主区从 560 到 1300px 逐像素扫一遍。结果见第 3 条：胶囊或字出现时身份行一次都没被截；胶囊变宽变窄时它的右缘到顶栏右缘的距离是一个定值（只动左缘）。
  - **票 103 的英文门槛错了 10px**：它的右边加和写成 490.8，实际 90.5 + 17 + 284.3 + 17 + 92 = 500.8，所以英文字的门槛该是 731 / 877，不是 721 / 867。扫描在原门槛下抓到身份行被截（两位数时最多约 10px），这次改了，注释里写了出处。
- **丁「下次启动」怎么读**：切换器的 store 建立时（模块加载，即启动时）调一次 `readTodoPanelIntroduced()`（同 `lib/todo-panel-memory.ts` 的规矩：只认 `"1"`，启动时面板在任一处开着也算认识过，读不到算没认识），存成 `introducedAtLaunch`，之后不再读；不看 ui store 里会随这次认识变成真的 `todoPanelIntroduced`。所以这次启动里认识了面板，丁照旧写字，下次启动才是甲。「当作没认识」只在内存里把它当成假，只换显示。

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

$ git diff --check main..HEAD
diff-check exit=0

$ pnpm --dir gui test
 Test Files  227 passed (227)
      Tests  2519 passed (2519)
local exit=0

$ TZ=UTC pnpm --dir gui test
 Test Files  227 passed (227)
      Tests  2519 passed (2519)
UTC exit=0

$ TZ=America/Los_Angeles pnpm --dir gui test
 Test Files  227 passed (227)
      Tests  2519 passed (2519)
LA exit=0
```

反向检查（scratchpad 里的 `t104-reverse.py`：备份、改坏一处、跑 `todo-button`、`todo-button-variants`、`TodoToggleButton`、`TodoToggleButton.dom`、`todo-flight-run`、`MainHeaderHost.todo` 六个测试文件，`cp` 回去再跑）：

```
--- broken: 戊2: nothing today is 甲
    × 戊2 is a capsule only for today's, 甲 when none of yours is today's, the word when you have none 7ms
    × 戊 is a capsule whenever you have things, the word when none 1ms
    × writes the word with nothing of yours, no capsule frame; 戊2 is 甲 with nothing today 10ms
     Tests  3 failed | 56 passed (59)
--- restored
     Tests  59 passed (59)
--- broken: the capsule's first row: today, later, anytime
    × is today's first, else later's, else anytime's: the panel's order 12ms
    × writes the first row 「时间 · 标题」 and 「+N」 for today's others, named in full 12ms
    × draws time and 「 · 」 ink-muted, the title ink-soft and cut, 「+N」 tabular ink-muted 3ms
    × reads the panel's list: a to-do deleted there and waiting on its undo is not the first row 3ms
    × shows a demo in place of the list, and only the button changes 4ms
     Tests  5 failed | 54 passed (59)
--- restored
     Tests  59 passed (59)
--- broken: +N only for today's
    × writes later's day and time, and no 「+N」 off today, whatever today's count says 7ms
     Tests  1 failed | 58 passed (59)
--- restored
     Tests  59 passed (59)
--- broken: 丁 reads the flag once, at launch
    × is 甲 once the panel was met at launch, and the word again as 「当作没认识」 9ms
    × keeps the word when the panel is met now; the next launch reads it met 51ms
     Tests  2 failed | 57 passed (59)
--- restored
     Tests  59 passed (59)
--- broken: a capsule pops its glyph alone
    × pops only the glyph on a capsule, the capsule still; the whole button otherwise 14ms
    × pops the glyph alone on a capsule, as for real 14ms
     Tests  2 failed | 57 passed (59)
--- restored
     Tests  59 passed (59)
```

改坏的写法：戊2 有事一律胶囊；`todoFirstRow` 的组序换成以后 → 今天 → 随时；「+N」去掉组的判断；丁改读 ui store 的 `todoPanelIntroduced`（活的那个）；`popTarget` 一律返回整颗按钮。

设计文档与 locale 新增行的全角标点：scratchpad 里的 `t104-cjk-punct.py`（中文旁的半角 `, ; : ! ? ( )`，以及全角括号配半角括号，先去掉行内代码与链接目标；拿一份样例自测过能抓到这两类）扫 `git diff -U0 HEAD -- docs/design gui/src/i18n/locales` 的新增行：`0 hit(s) of half-width punctuation next to CJK in 20 line(s)`。这条回报也照样扫过。

布局扫描（headless Chrome，主区 560–1300px 逐像素，每个平台与语言 24 页：四档 × 六种演示，最忙状态）：

```
mac zh-CN: pages=24 widths=560..1300 violations=0 capsule-from=[738] word-from=[632] capsule-right-to-header-right=[380.05] long-capsule-width=185..220 identity-cut-at-664=[False]
mac en-US: pages=24 widths=560..1300 violations=0 capsule-from=[863] word-from=[743] capsule-right-to-header-right=[422.3] long-capsule-width=211..220 identity-cut-at-664=[True]
other zh-CN: pages=24 widths=560..1300 violations=0 capsule-from=[872] word-from=[766] capsule-right-to-header-right=[514.05] long-capsule-width=185..220 identity-cut-at-664=[True]
other en-US: pages=24 widths=560..1300 violations=0 capsule-from=[997] word-from=[877] capsule-right-to-header-right=[556.3] long-capsule-width=211..220 identity-cut-at-664=[True]
```

`violations` 是胶囊或字显示着、身份行却被截的宽度个数；`capsule-right-to-header-right` 每组只有一个值，即胶囊宽窄变化时右缘不动。浅色、深色各截了一张（scratchpad 的 `t104-layout/t104-shots-light.png`、`t104-shots-dark.png`），四档与演示都按票面画出。

新增与改的测试：`lib/todo-button.test.ts`（第一行的组序；时间同面板行，逾期 warning、今天时刻已过「逾期 · 今天 09:00」、不要铃铛；「+N」只在今天组，今天的数还算着正在撤销的行时也不写；「随时」与英文；门槛的数）；`todo-button-variants.test.tsx`（四档各画什么；七种演示各写什么、长标题 30 个字、各自在哪一组；键名与回退；接触点核对，且票 102、103 的标记一个不剩）；`TodoToggleButton.test.tsx`（甲的方块、数字、按下；丁的字、认识后是甲、「当作没认识」；胶囊的次序、各段墨色、warning 只有逾期那一段、外框类名、收起时的类名、你一件都没有时写字、戊2 没今天时是甲、读面板那一份、演示、英文；两张类名表对上 `todoButtonFit`）；`TodoToggleButton.dom.test.tsx`（jsdom 真挂载：丁在这次启动里认识了面板仍写字、重新加载模块才读成认识过；标题被截时提示写全、没截时照旧）；`todo-flight.test.ts`、`todo-flight-run.test.ts`（中档的值与时刻；胶囊只弹图标、收起时整颗弹、减少动态铺整颗胶囊；落点是胶囊里的图标中心）；`useFreshCards.test.tsx`、`MainHeaderHost.todo.test.tsx`、`MainHeaderHost.sop.test.tsx` 按新位置与新档位改。

**4. 票面没写到、我自己定的边界**

1. **「随时」的文案是新加的**：票面说「面板组名的文案在同一处」，实际票 86（`3aa7585e`）已经删了 `todo.groupToday` / `groupLater` / `groupAnytime`，面板你的事不再挂组名。新加 `topbar.todoAnytime`「随时」/「Anytime」，和胶囊的无障碍名称 `topbar.todoWithFirst`「待办与备忘 · 时间 · 标题」/「To-do and memos · …」。
2. **胶囊读的是面板那一份**：去掉面板里刚删、撤销条还在的那几件（`todoWithoutDeleting`，同面板）。「+N」照票面用 Core 的 `todayCount - 1`，数字跟 Core 走，所以那 5 秒里删的若是今天的，「+N」会多算一件（同按钮原来的数字口径）。
3. **无障碍名称与提示**：胶囊的无障碍名称一律写全「待办与备忘 · 时间 · 标题」（读屏读不到被截的那段）；悬停提示没截时照旧「待办与备忘」，有今天的数时「待办与备忘 · 今天 N」（顺带说清「+N」数的是什么），被截时写全。被截与否在指针移入、键盘聚焦时量（`scrollWidth > clientWidth`）。「+N」不进无障碍名称。
4. **戊、戊2 一件事都没有时的「待办」**：照丁的字样，窄时同样先让（丁的 `word` 门槛）。
5. **时间段**：用面板行那一段的原样，包括今天有时刻且已过的「逾期 · 今天 15:00」（整段 warning）；warning 的写法同面板（`font-medium text-warning`）；时间与「+N」用等宽数字（面板那一行也是 `tabular-nums`）。
6. **尺寸容器**：甲以外三档都把顶栏设成尺寸容器（丁认识以后、戊2 没今天时其实用不到，判断只看档位、不读数据）；甲与外置运行时，顶栏的 CSS 不变。
7. **「重放」留着、挪进新切换器**：票面只说拆飞入切换器。留它是为了四档各看接住的样子不必真记待办（固定飞 + pop、中档）；标 `TEMP variant switcher (main chat 104)`，随切换器一起拆。
8. **切换器**：两行的 pill 放在原来两颗的位置（顶栏下、窗口正中，top 52px）：第一行四档、「当作没认识」、「重放」，第二行七种演示。键名 `galley.tmp.todoButtonCapsule`，不复用票 103 的 `galley.tmp.todoButtonPlace`（JC 本机里可能还存着「B」）；演示与「当作没认识」只在内存，重启回到真实。
9. **演示数据**：日期按今天算。「只有以后」是后天 15:00，今天周三所以写「周五 15:00」，别的日子是别的星期；「今天 3 件」另两件是「回复客户邮件」今天 18:00、「订下周的机票」今天；「长标题」放在今天 15:00、今天只有它一件（没有「+N」），标题 30 个字。演示的项除「逾期」外都不带逾期标记，过了 15:00 也照样写「今天 15:00」。
10. **「剩不到 4 个字」按框算**：12px 中文 4 个字加省略号（58.38px），英文用同一个框（约 7 个字母）。门槛按常见的今天时间加一位数「+N」算；时间更长的状态（见第 5 条第 2 点）收起前剩下的字少于 4 个。
11. **修了票 103 的英文门槛**（721 / 867 → 731 / 877），理由见第 2 条。
12. **设计文档**：`conversation.md` 两种写法都做了：「待办面板」里「开与关」后面单起一小节「飞进顶栏按钮」写全，三种卡片各加一句指过去。

**5. 看到但没改的问题，没验证到的**

1. **主树的探针合入后会挂**（只读看过，没碰）：主会话的 `gui/src/zz-harness-t102.ts` import 了 `@/components/todo/flight-variants/flight-variants`（`FLIGHT_LEVELS`、`useFlightVariants`）和 `replayFlight(form, level)`；本票删了前者，`replayFlight` 改成不带参数。合入后主树的 typecheck 会报错，dev 里 `main.tsx` 末行那个动态 import 会失败；合入前要先改或删掉探针。
2. **英文时间太长**：「Overdue · Today 3:00 PM」145.84px，在 220px 的胶囊里标题只剩约 8px（只够一个省略号）；中文「逾期 · 今天 15:00」带「+2」时 220px 里标题约 4 个字。时间写法照票面沿用面板行，没改。
3. **最窄窗口（主区 664）**：macOS 中文最忙状态下身份行不被截（扫描验证，胶囊此时已收成甲，字在）。macOS 英文与 Windows / Linux 最忙状态下，664 时四档（包括甲）身份行都已被截，胶囊已收起，与胶囊无关（票 103 回报第 5 条第 1 点同样的情况）。
4. **真窗口没看**：门槛与胶囊宽度是在 headless Chrome（Blink）里排的，真窗口是 WKWebView，字宽可能差零点几像素，门槛向上取整只留了不到 1px；布局扫描里身份行与侧栏开关是同结构的替身（caret 用 9px 占位）。悬停（`hover:text-ink` 只把图标变满墨，时间与标题各保持各的墨色）、按下、深色都只在截图里看过。
5. **设计文档 §4.1「待办按钮」没改**：它还写着工具簇第一个、提示「待办」、只有图标与数字（D1），与代码不符。位置与提示已定（裁决 148 第 4 条、149 第 2 条），但票面只让本票写飞入那两处，我照票面没动；切换器文件头的拆法里写了定稿票要一起写。
6. **pop 打在 `svg` 上**：React 若恰好在这 440ms 里改写那颗图标的 `className`，pop 会被冲掉（同票 102 回报第 4 条第 10 点）；Phosphor 图标的 className 不变，机会很小。
7. **没验证**：减少动态（要改系统设置）、Windows、外置运行时（只在测试里核对了四档下外置的顶栏不变）、胶囊上飞行的第一帧与落点（jsdom 只用手设的盒子测了终点取图标中心）。
8. **状态簇有灯出现或消失时，胶囊整个跟着平移一格**（裁决 148 第 2 条列过的代价）；胶囊更宽，位移不变，但视觉上可能更显，真窗口没看。
