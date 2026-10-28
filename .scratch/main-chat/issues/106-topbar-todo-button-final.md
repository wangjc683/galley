# 106 顶栏待办按钮定稿：戊2，拆切换器，写设计文档

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 152（2026-10-28，JC：「按建议推进，定戊2」），连同裁决 148 第 2、4 条（位置、悬停提示）、149 第 2 条、150 第 2、5、6 条（胶囊的内容、窄时让位、pop 落点）。接票 [104](./104-flight-final-and-topbar-capsule-trial.md)（已合入 main，切换器还在）。只改 GUI 与设计文档。外置运行时没有这颗按钮，零变化。

## 为什么

JC 比过四档，定戊2：你的事一件都没有时写「待办」；第一件在今天组（含逾期）时展开成胶囊；其余时候是图标加今天的数（0 时只有图标）。试用的切换器与另外三档的代码拆掉，规则写进设计文档。

## 现状（读码起点）

- 规则与胶囊：`gui/src/lib/todo-button.ts`（`todoFirstRow`、胶囊内容），`gui/src/components/layout/header/TodoToggleButton.tsx`（三种样子、窄时让位的容器查询门槛，文件头写着算法）、`MainHeader.tsx`、`UtilityCluster.tsx`。
- 临时切换器：`gui/src/components/todo/todo-button-variants/`（`todoButtonShape`、`TodoButtonVariantsPill.tsx`、演示数据、`galley.tmp.todoButtonPlace` 的读写、丁的 `introducedAtLaunch` / `pretendNew`），「重放」在 `gui/src/lib/todo-flight-run.ts` 的 `replayFlight`（标 TEMP），App 里挂 pill 的那一处。切换器文件头写了拆法。
- 设计文档：`docs/design/layout-and-chrome.md` 约 30–33 行（右侧面板那段说「由顶栏工具簇的『待办』开关」）、约 52 行（书眉那条说「待办的入口在顶栏的工具簇里」）、约 75 行（工具簇列表里有待办）、约 78–84 行（「待办按钮」整段：还写着工具簇第一个、提示「待办」、只有图标与数字 D1）、约 91 行「禁止」（票 104 已补飞入与 pop）。`docs/design/conversation.md` 里说到顶栏按钮的地方自己 grep。

## 要做的

1. **只留戊2**：
   - 规则（写成 `lib/todo-button.ts` 里的纯函数，不再放在切换器里）：`todo.yours` 三组都空 → 写「待办」（图标、字，同票 104 丁 / 戊2 的字样）；第一件在今天组 → 胶囊（票 104 的胶囊，内容、样子、最宽 220px、截断提示都不变）；否则 → 图标加今天的数（0 时只有图标）。
   - 窄时让位照票 104 的门槛与顺序（胶囊先截标题，再收成图标加数；「待办」的字照票 103 / 104 的门槛先让），数值不变。
   - pop：胶囊时只打图标，图标与「待办」样子时打整颗按钮（同票 104）。飞行终点仍是图标中心。
2. **拆切换器**：`todo-button-variants/` 整块、pill、App 里挂它的那一处、`galley.tmp.todoButtonPlace` 的读写、丁的标记读取与「当作没认识」、演示数据、`replayFlight` 与它的入口。确认仓库里不再有 `galley.tmp.todoButtonPlace`、`todo-button-variants`、`replayFlight` 的引用（`grep -rn`）。票 101 的 `galley.todoPanelIntroduced`（自动开一次）照旧，不动。
3. **测试**：按新规则改 `TodoToggleButton.test.tsx`、`MainHeaderHost.todo.test.tsx`、`MainHeaderHost.sop.test.tsx` 与胶囊、门槛的测试；三种样子各一条，第一件在以后组、随时组都是图标，空着是「待办」，今天组与逾期是胶囊并带「+N」。删掉只为切换器存在的测试。
4. **设计文档**（`docs/design/layout-and-chrome.md`）：
   - MainHeader 那一行的版式示意与「右」一段：右边是三组 `[ 待办 ] ┊ [ 状态簇 ] │ [ 视图与设置 ]`；工具簇列表里去掉待办，写它现在剩什么（改动、显示、Supervisor SOP（外置）、设置）。
   - 「待办按钮」整段重写：位置（右边最左、单独成组，裁决 148 第 2 条、149 第 2 条，理由：内容入口不属于「视图与设置」）；三种样子与规则（裁决 152）；胶囊（裁决 150 第 2、6 条：「时间 · 标题」、时间同面板那一行、逾期 warning 色、随时写「随时」、「+N」只在今天组、28px、`rounded-full`、1px `border-line`、字号墨色、最宽 220、截断提示）；悬停提示与无障碍名「待办与备忘」（有数或胶囊时的写法照代码）；窄时让位（裁决 150 第 5 条）；行为（开关、选中底色、记住开关两处、窄窗口临时、只自动开一次）照原文保留；pop 落点。
   - 「只有图标与数字，不写『待办』两个字」那条改成历史：10-17 D1 → 10-28 裁决 148 重比 D2（乙「楞」，JC 原话）→ 裁决 150 胶囊 → 裁决 152 定戊2；没选的甲、丁、戊与「3 天内」变体各一句理由与回头信号（照裁决 152 第 5 条）。
   - 约 30–33 行、52 行里「工具簇」的说法改成新位置。
   - 都注「2026-10-28，票 106，裁决 148–152」。
   - `docs/design/conversation.md` 里说到顶栏按钮样子或位置的地方跟着对齐。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- Core、手册、提示词、Agent API；飞入的档位与判断（票 102、104 已定）；票 101 的自动开与收齐；票 105 的提醒第一行；面板本身。
- 胶囊的内容、样子、门槛数值（票 104 已量过、JC 比过）。
- 外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 106, PRD ruling 152」）；切换器留下的「TEMP」注释与「定稿票要做」的说明都清掉或改成定稿的说法。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t106-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- `grep -rn "todo-button-variants\|todoButtonPlace\|replayFlight\|TEMP variant switcher (main chat 10[234])" gui/src` 为空
- 反向检查：把「以后组是图标」「空着写待办」「今天组是胶囊」各改坏一处，对应测试要红，改回全绿
- 设计文档新增行中文全角标点（自写正则扫，脚本放 scratchpad、文件名带 `t106-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 删了哪些文件、规则函数的签名、设计文档改了哪几段（file:line）。
3. 验证命令与结果原样（含两个时区、反向检查、grep）。
4. 票面没写到、你自己定的边界；看到但没改的问题，没验证到的（逐条）。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新）：

1. 切换器没了；顶栏现在是一颗图标（你的事只有以后的）。
2. 跟 Galley 说「今天下午五点前把发票整理好」：顶栏展开成胶囊「今天 17:00 · 把发票整理好」（或它记下的标题），图标飞进胶囊、只有图标弹一下；勾掉后收回成图标。

## Comments
