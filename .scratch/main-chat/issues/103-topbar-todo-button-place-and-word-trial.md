# 103 顶栏待办按钮：挪到右边最左、重比加字（切换器试用）

Status: needs-dogfood（2026-10-28 快进合入 `83a7bb28`；主会话机器验收：读过 `lib/fresh-cards.ts`、`hooks/useFreshCards.ts`、`lib/todo-flight-run.ts` 的层级与清理；在 worktree 重跑 `pnpm --dir gui typecheck`、`lint`、`git diff --check` 全过，`test` 本地与 `TZ=UTC` 各 226 个文件、2500 条全过；真窗口第一帧与截图待做）

来源：[主聊天 PRD](../PRD.md) 裁决 148（2026-10-28，JC：「按你推荐推进」）。接在票 [102](./102-cards-fly-into-the-todo-button-trial.md) 后面，同一个代理、同一个 worktree：两张票都动 `TodoToggleButton`（102 加 pop，本票改位置与长相），飞行终点仍按 `[data-role="topbar-todo"]` 里的图标现量。这是试用票：临时切换器，JC 真机比完定档，另开定稿票拆切换器、写设计文档。只改 GUI。外置运行时没有这颗按钮，零变化。

## 为什么

用户反馈不知道有待办面板。顶栏这颗按钮在工具簇（无障碍名「视图与设置」）里，挨着 Aa 与齿轮读作设置；右边五颗同为 16px 细线 `ink-muted`，没数字时与齿轮无从分辨；数字只数今天，多数时候是一颗光图标。它其实是顶栏里唯一通往内容的入口，该单独成组、该有名字。

## 现状（读码起点）

- 按钮：`gui/src/components/layout/header/TodoToggleButton.tsx`（`TopBarIconButton`、`ListChecks` 16px thin、`todayCount > 0` 时右边写 N 并从左缘往右长、`aria-pressed` 选中用 `border-line` + `bg-selected`）。
- 放置与分组：MainHeader / `MainHeaderHost`（`gui/src/components/layout/` 下，测试 `MainHeaderHost.todo.test.tsx`、`MainHeaderHost.sop.test.tsx` 用 `aria-label="视图与设置"` 定位工具簇），状态簇无障碍名「运行状态」；两簇之间的分隔线怎么画、某一簇为空时怎么处理，读代码确认。
- 文案：`gui/src/i18n/locales/zh.ts` 约 370–372 行 `topbar.todo`「待办」、`todoWithToday`「待办 · 今天 N」；`en.ts` 约 330–331 行。面板页签组的无障碍名 `memo.tabsLabel`：zh「待办与备忘」（约 2172 行）、en「To-do and memos」（约 2132 行）。
- D2 的先例（10-17 比过、已撤）：提交 `b26db951` 撤掉的切换器里有 D2（图标加「待办」加数字）与窄时先让字的容器查询（`@container/main-header`）；`git show b26db951` 看被删的那部分，照它的做法，不必照抄数值。
- 切换器的先例：票 85 `gui/src/components/todo/todo-variants/`；票 102 你刚做的切换器 pill。

## 要做的

1. **悬停提示与无障碍名称**（定了，不进切换器，所有档都生效）：zh「待办与备忘」，有数时「待办与备忘 · 今天 N」；en「To-do and memos」「To-do and memos · Today N」。⌘K 里的「待办」不改。
2. **切换器四档**（从最克制排起）：
   - **现状**：工具簇第一颗，长相不变。
   - **甲**：挪到右边最左，单独成组：`[ 待办 ] ┊ [ 状态簇 ] │ [ 视图与设置 ]`，组间用现有的分隔线；状态簇此刻没有任何灯时，待办组与工具簇之间仍隔一道线（它不属于「视图与设置」）。长相不变。它自己一组，给个无障碍名（照两簇的写法，zh「待办与备忘」en「To-do and memos」，或你判断更合适的，写清理由）。
   - **乙**（主会话推荐）：甲加「待办」二字：`[☑ 待办 2]`。图标在左、位置不动，字在图标后 4px，数字在字后 4px；字 13px 常规，墨色跟按钮（静止 `ink-muted`，悬停与选中满墨色），数字照旧 12px 等宽；高 28px，左右内边距你按图标居中时的视觉定（写清数值）。en 写「To-do」。
   - **丙**：乙加静止时一圈 1px `border-line`、圆角同按钮；选中时照旧 `bg-selected`。
   - 默认「乙」。
3. **窄时字先让**（乙、丙）：顶栏放不下时先收掉字（只剩图标加数字，即甲的样子），再按原来的让法（身份行先截第二行、再截名字）。门槛用顶栏宽度的容器查询，照 `b26db951` 撤掉的那套思路，数值你按顶栏实际内容量定、写清怎么算的；最窄窗口（960，侧栏 296，主区 664）下要验证不挤坏身份行。
4. **演示**：切换器加「今天 2」「没有今天」两个演示状态（只替换按钮显示的数，不写数据），加「真实」回到实际值。
5. 和票 102 的切换器放在同一个 pill 里分两段（「飞入」「顶栏」），或上下两个 pill 不重叠，你定；选择存本机，照票 85 / 102 的键名写法。
6. 102 的飞行终点在乙、丙下仍落在图标中心（不是整个按钮的中心），pop 作用在整颗按钮上；在测试里覆盖终点取法。
7. 测试：每一档的分组顺序与分隔线（含状态簇为空）、字的有无、提示与无障碍名称、演示数；现有 `MainHeaderHost.todo.test.tsx`、`sop.test.tsx` 里断言「待办是工具簇第一颗」的，在「现状」档下仍成立，其余档按新位置断言。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- Core、手册、提示词、Agent API；数字规则（只数今天、0 时不写）；按钮的开关行为、选中样式、记忆；状态簇与工具簇内部的顺序；外置运行时的顶栏（Supervisor SOP、◷ 等一个像素不变）。
- 设计文档本票不写（试用票），定稿票写。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 103, PRD ruling 148」）；切换器相关代码集中放、注明临时，方便定稿票整块拆。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t103-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- 反向检查：把「甲以后待办不在工具簇」「乙的字」「提示写待办与备忘」各改坏一处，对应测试要红，改回全绿
- locale 新增行中文全角标点（自写正则扫，脚本放 scratchpad、文件名带 `t103-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样，含 101、102 的）。
2. 分组与分隔线怎么接、窄时让字的门槛与算法、乙的内边距数值。
3. 验证命令与结果原样（含两个时区、反向检查）。
4. 票面没写到、你自己定的边界（逐条）。
5. 看到但没改的问题，没验证到的（逐条，尤其真窗口才看得出的：最窄窗口、Windows 窗口控制旁、深色）。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新；主会话先在真窗口截图对过四档再交）：

1. 切换器「顶栏」四档各看一遍，演示「今天 2」「没有今天」各看一遍；深色也看一眼。
2. 把窗口拖到最窄：乙、丙的字先收掉，身份行不挤坏。
3. 乙档下点切换器「飞入」的重放：飞进的是图标、整颗按钮 pop。
4. 定档：四选一，或说「往回拉一点」。

## Comments

### 2026-10-28 实现回报（票 103 代理）

分支 `ticket-101-102-todo-discovery`，票 101、102 做完后 rebase 到本地 main 的 `88001d3c`（没有冲突），本票接着做，同一个 worktree。未 push、未合入。

**1. 提交列表**（`git log --oneline main..HEAD`，这条回报自己的提交在它之后）

```
ccd684dc Ticket 103: a temporary switcher for the top bar's 待办 button (现状 / 甲 / 乙 / 丙, 真实 / 今天 2 / 没有今天)
caa64385 Tickets 101, 102: the reports quote the commits as rebased onto 88001d3c
3a20f429 Tickets 101, 102: implementation reports
38f1d259 Ticket 102: a temporary switcher for cards flying into the top bar's 待办 button (现状 / 只 pop / 飞 + pop, 大 / 中 / 小, 重放)
58a5c4ce Design: the panel opens once for any card it lists; a reminder card's words open it (ticket 101, ruling 147)
0c518a36 Ticket 101: the panel opens once for reminder and memo cards too; a reminder card's words open it
```

**2. 分组与分隔线怎么接、窄时让字的门槛与算法、乙的内边距数值**

- **分组与分隔线**（`MainHeader.tsx`）：顶栏右边原来是 `[状态簇]` 分隔线 `[工具簇]` 窗口控制，状态簇与它后面那道线只在有状态项时画（`hasTopBarStatusItems`）。甲、乙、丙档时，最前面加一组 `role="group"`、无障碍名「待办与备忘」（en「To-do and memos」），里面只有待办按钮，后面紧跟一道现有的分隔线（`h-5 w-px bg-line/80`），不看有没有状态簇；工具簇这时拿不到 `onToggleTodo`，就没有待办那一颗。所以有状态时是「待办 │ 状态 │ 视图与设置」两道线，没状态时「待办 │ 视图与设置」一道线。组与组之间仍是右边容器的 `gap-2`。组名用「待办与备忘」不另起：这一组只有这一颗按钮，照它装的东西叫；另起「内容」之类的词，用户在哪里都看不到。现状档一个字节不变（测试里核对过现状档与外置运行时在四档下的输出相同）。
- **窄时让字**：只在乙、丙档、且有待办按钮时，顶栏根元素加 `@container/main-header`（照 `b26db951` 撤掉的那套）；字是 `hidden @min-[Npx]/main-header:inline`，右内边距 7px 也只在同一个门槛以上给。门槛按顶栏内容盒（macOS 减去 `pr-3`，Windows / Linux 没有，窗口控制在里面）在最忙的常见状态下需要的宽度定，保证字在的时候身份行不因它被截：状态簇里「浏览器控制 · 待解锁」、Channels 的灯、「新版本」徽标，工具簇里有「改动」，两位数的今天 N，侧栏收起时的开关，身份行第二行最长的「子任务在问你」/「A subtask is asking you」。文字宽度用 headless Chrome 加应用的字体（Inter、PingFang SC）量，其余照类名：
  - 左：pl 10 + 开关 28 + 间距 6 + 身份行（6 + 头像 28 + 8 + 第二行 66 zh / 123.7 en + 8）+ pr 12 = 172 zh / 229.7 en
  - 右：待办（2 + 5 + 16 + 4 + 字 26 / 36.9 + 4 + 15.6 + 7）+ 分隔（8 + 1 + 8）+ 状态簇（128.1 / 164.7 + 4 + 28 + 4 + 78 / 83.6）+ 分隔 17 + 工具（28 + 4 + 28 + 4 + 28）= 447.6 zh / 490.8 en
  - macOS：左 + 右 = 619.6 → **620** / 720.5 → **721**；Windows / Linux：再加间距 8 与窗口控制 138 = 765.6 → **766** / 866.5 → **867**（macOS 折成主区宽是 632 / 733px）
  - 核对：10-17 那套的右边是 462.6 zh，按当时的组成（工具簇还有 SOP、字 12px、没有第三组）重算也是 462.6，量法一致。
  - 门槛以下字收起，按钮回到甲的样子（28px 方块，有数时 40–48px）；再窄照原来的让法，身份行先淡出第二行、再截名字。
- **乙的内边距**：左 5px（加 1px 边框，图标离左缘 6px，同 28px 方块里的位置，图标不动）；右 7px（加边框 8px）：细线的 `ListChecks` 在 16px 盒子里自带约 2px 空白，左边读起来约 8px，字的墨几乎贴到字框，右边给 8px 才对得上。图标到字、字到数字都是 `gap-1`（4px）。高 28px（`size-7` 的高不变，宽 `w-auto`）。只有图标时 1 + 5 + 16 + 5 + 1 = 28，就是原来的方块。
- **丙**：在乙的基础上静止时 `border-line`（压掉 `TopBarIconButton` 的 `border-transparent`），圆角就是按钮的 `rounded-md`；选中照旧 `bg-selected`。
- **提示与无障碍名称**（所有档）：`topbar.todoLabel`「待办与备忘」/「To-do and memos」，`todoWithToday` 改成「待办与备忘 · 今天 N」/「To-do and memos · Today N」；`topbar.todo`（「待办」/「To-do」）现在是乙、丙写在按钮上的字。⌘K 用的是 `palette.openTodo`，没动。
- **与票 102 的接法**：票 102 的 pop 是往 `[data-role="topbar-todo"]` 上加类名，飞行终点取它里面那颗 `svg` 的中心，本票没改这两处。`lib/todo-flight-run.test.ts` 加了一条：62px 宽的乙按钮、图标在左，飞行中的位置与尺寸落在去往图标中心（1114, 24）的那条路径上（误差 < 0.01px），离去往按钮中心（1131）的路径 > 1px；pop 加在整颗按钮上。
- **切换器**：照票 102 的写法另做一颗 pill（`components/todo/todo-button-variants/`），放在票 102「飞入」那颗下面（`top-[80px]`，前者 52px、约 22px 高，不重叠），两个试用各自能拆。「临时 · 顶栏」：现状 / 甲 挪位 / 乙 加字 / 丙 加框，真实 / 今天 2 / 没有今天。

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
（新文件另用 grep 查过行尾空白：没有）

$ pnpm --dir gui test
 Test Files  226 passed (226)
      Tests  2500 passed (2500)
local exit=0

$ TZ=UTC pnpm --dir gui test
 Test Files  226 passed (226)
      Tests  2500 passed (2500)
UTC exit=0

$ TZ=America/Los_Angeles pnpm --dir gui test
 Test Files  226 passed (226)
      Tests  2500 passed (2500)
LA exit=0
```

反向检查（scratchpad 里的 `t103-reverse.sh`：备份、改坏、跑 `MainHeaderHost.todo`、`MainHeaderHost.sop`、`TodoToggleButton`、`todo-button-variants` 四个测试文件，`cp` 回去再跑）：

```
--- broken: 甲 on: 待办 out of the tool cluster
     × is not there on the managed runtime, with or without a main chat
     × 甲 / 乙 / 丙: first on the right, a group of its own, then the status cluster, then the tools
      Tests  2 failed | 24 passed (26)
--- restored
      Tests  26 passed (26)
--- broken: 乙's word
     × moves it from 甲 on, writes the word at 乙 and 丙
     × 乙 writes 待办 after the icon, 13px in the button's ink, the count after it
     × gives the word way first on a narrow header, by the header's width
     × only 乙 and 丙 write the word, and only then is the header a size container
      Tests  4 failed | 22 passed (26)
--- restored
      Tests  26 passed (26)
--- broken: the tooltip says 待办与备忘
     × is the list icon alone at 0: a 28px square, named 待办与备忘
     × 今天 2 shows and says 2, 没有今天 nothing, 真实 the real count
     × is not there on the managed runtime, with or without a main chat
     × 甲 / 乙 / 丙: first on the right, a group of its own, then the status cluster, then the tools
     × keeps a divider before the tools when the status cluster is empty
      Tests  5 failed | 21 passed (26)
--- restored
      Tests  26 passed (26)
```

locale 新增行的全角标点：scratchpad 里的 `t103-cjk-punct.py`（同票 101 的脚本）扫 `git diff -- gui/src/i18n/locales/` 的新增行，结果 `0 hit(s) of half-width punctuation next to CJK in added lines`；这条回报也照样扫过。

测试：`MainHeaderHost.todo.test.tsx` 原有四条在现状档照旧成立，加一段六条（现状档在工具簇里、没有自己的组、没有尺寸容器；甲乙丙的次序「待办组 → 状态簇 → 工具簇」、工具簇里没有它、两道线各在哪；没有状态簇时仍隔一道线（直接渲染 `MainHeader`：宿主在内置运行时总有 Channels 的灯）；只有乙丙写字、只有那时是尺寸容器；自己一组时照样按下；没有按钮与外置运行时四档输出不变）；`MainHeaderHost.sop.test.tsx` 现状档工具簇是「待办与备忘、工作区改动、显示设置、打开设置」，甲乙丙档是后三个，外置运行时四档输出相同；`TodoToggleButton.test.tsx` 改名字与提示，加乙（字在图标后、数字在字后、13px、不另上色、英文 To-do）、窄时让字的类名与中英文两个门槛、丙的细线（乙、甲、现状没有）、演示数（今天 2 显示也说 2、没有今天什么都不写、真实回到实际值）；`todo-button-variants.test.tsx`（默认乙、四档各改什么、演示数、本机记忆的读与回退、没有 document 不画、接触点核对）。

**4. 票面没写到、我自己定的边界**

1. 组名就用「待办与备忘」（理由见第 2 条）。
2. 演示数也替换提示与无障碍名称里的数（「今天 2」时说「待办与备忘 · 今天 2」），票面只说替换按钮显示的数。
3. 档位存本机，演示数只在内存：演示是假数，重启后还显示「今天 2」容易被当真。键名 `galley.tmp.todoButtonPlace`：照票 42、45、102 的 `galley.tmp.*` 写法（票 85 只存内存，没有键）；不复用票 45 的 `galley.tmp.todoButtonVariant`，JC 本机里可能还存着「D1」「D2」。
4. 门槛按最忙的常见状态定死，不按当时实际的内容量算：Windows 最窄窗口（主区 664）下，即使顶栏很空，乙丙的字也收起、看起来同甲；macOS 中文 664 下字在，英文不在。
5. 尺寸容器只在乙丙档、且有待办按钮时加，其他时候顶栏的 CSS 不变。
6. 两颗 pill 分开（票面允许），各自拆得掉；位置照票 85 的正中，上下排。
7. 设计文档没写（试用票）。

**5. 看到但没改的问题，没验证到的**

1. **最窄窗口**只按算的核对，没在真窗口里看：960 宽、侧栏 296、主区 664 时，macOS 中文最忙状态右边 447.6 + 左边 138（侧栏开着、没有收起开关）= 585.6 ≤ 内容盒 652，字在、身份行不被截；常见状态（两盏灯、没有徽标、没有今天的数）右边 246 + 左边约 133.5，富余很多。Windows 最忙状态下字已收起，右边 415.6 + 窗口控制 146 + 左边 138 = 699.6 > 664，身份行被截约 36px；同样状态下现状档是 686.6，也已经截约 23px，甲乙丙多出的 13px 就是多出来的那道分隔线（裁决 148 第 2 条写的代价之一）。
2. **Windows 窗口控制旁**：门槛里窗口控制算 3 × 46 = 138 加间距 8，没在 Windows 真机看过；Windows 上 Microsoft YaHei 的「待办」与 PingFang 宽度一样是 13px 一个字，英文 Inter 自带，量值应一致，但没核对。
3. **深色**：丙的 `border-line`、乙的字的墨色在深色下没看过。
4. 门槛用到的文字宽度是在 headless Chrome（Blink）里量的，真窗口是 WKWebView，字宽可能差零点几像素；门槛向上取整留了不到 1px 的余量。
5. 甲乙丙下状态簇有灯出现或消失时，待办按钮会跟着平移一格（裁决 148 第 2 条已列为代价），真窗口没看这一下是否显眼。
6. 乙按钮比现状宽约 32px（中文：字 26 + 间距 4 + 右边多 2），面板打开时按钮下方与面板左缘的相对位置变了，没看。
7. 外置运行时只在测试里核对了四档输出不变，没跑真机。

### 2026-10-28 主会话真窗口检查（dev，macOS 中文）

- 四档浅色、深色各截一张（演示「今天 2」）：现状、甲、乙、丙都按票面画出，分组与两道分隔线对；丙的细线框浅色下很淡、深色下清楚。乙档默认生效，面板开着时选中底色照旧。
- 窄：Tauri 没开改窗口尺寸的权限、`osascript` 没有辅助功能权限，改为把顶栏容器临时限宽。664px（最窄窗口 960 减侧栏 296 的主区）时字在、身份行完整、留白很多；600px（拖宽侧栏才到得了）时字收起，只剩图标加数字，同甲。
- 没验：真窗口拖到 960 的整体观感；英文与 Windows 的门槛；状态簇灯多时（更新、内核）的挤压。
