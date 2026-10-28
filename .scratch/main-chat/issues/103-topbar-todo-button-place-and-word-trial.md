# 103 顶栏待办按钮：挪到右边最左、重比加字（切换器试用）

Status: ready-for-agent

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
