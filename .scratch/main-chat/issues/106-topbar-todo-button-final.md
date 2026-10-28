# 106 顶栏待办按钮定稿：戊2，拆切换器，写设计文档

Status: done（2026-10-28 JC 真机：「真机看了，胶囊效果 OK」。2026-10-28 快进合入 `936c587c`；主会话机器验收：rebase 到 `c04cc9f4` 后在 worktree 重跑 `pnpm --dir gui typecheck`、`lint`、`git diff --check` 全过，`test` 本地与 `TZ=UTC` 各 228 个文件、2523 条全过；读过设计文档 §4.1「待办按钮」整段；切换器残留 grep 为空）

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

### 2026-10-28 实现回报（票 106 代理）

分支 `ticket-106-topbar-final`（从本地 main 的 `3ed9eb5d` 拉出），worktree 里做。未 push、未合入。

**1. 提交列表**（`git log --oneline main..HEAD`，这条回报自己的提交在它之后）

```
0a94e1c6 Design: the top bar's 待办 button — place, three looks, capsule, narrow rule (ticket 106, rulings 148–152)
6eab8e75 Ticket 106: the top bar's 待办 button settles on 戊2; the switcher goes
```

**2. 删了哪些文件、规则函数的签名、设计文档改了哪几段**

- **删掉的文件**：`gui/src/components/todo/todo-button-variants/` 整块三个文件（`todo-button-variants.ts`：四档、七种演示、`galley.tmp.todoButtonCapsule` 的读写、丁的 `introducedAtLaunch` 与 `pretendNew`；`TodoButtonVariantsPill.tsx`；`todo-button-variants.test.tsx`）。另删：`App.tsx` 挂 pill 的 import 与那一处；`lib/todo-flight-run.ts` 的 `replayFlight` 与它的三条测试。`galley.tmp.todoButtonPlace` 票 104 已经不读不写，代码里只剩切换器文件头的一处提及，随文件删掉。
- **规则函数**（`gui/src/lib/todo-button.ts:55`、`:68`）：

  ```ts
  export type TodoButtonShape = "icon" | "word" | "capsule";
  export function todoButtonShape(yours: YourTodos): TodoButtonShape
  ```

  `todoFirstRow` 为空 → `"word"`；第一件在 `today` → `"capsule"`；否则 `"icon"`。`yours` 是面板那一份（`todoWithoutDeleting` 之后）。`TodoToggleButton` 直接读 store（不再读演示），`MainHeader` 有 `onToggleTodo` 就设 `@container/main-header`（原来是「甲以外三档」）。胶囊的内容、类名表、门槛数值、`popTarget` 一个字没动。
- **设计文档**：
  - `docs/design/layout-and-chrome.md:31`（右侧面板那段：顶栏右边最左的「待办」按钮）、`:52`（书眉那条：入口在右边最左、单独成组）、`:56`（MainHeader 版式示意加「待办 ┊」）。
  - `:73`「右」改为三组 `[ 待办 ] ┊ [ 状态簇 ] │ [ 视图与设置 ]`，并说明 ┊ 与 │ 在代码里是同一种 1px 竖线（`h-5 w-px bg-line/80`）。
  - `:74–89`「待办按钮」整段重写，挪到「右」列表的第一个（同顶栏里的先后）：`:74` 总述；`:75` 位置；`:76` 没有你的事写「待办」；`:77` 胶囊；`:78` 其余是图标加今天的数；`:79` 三种样子共用的规矩与代价；`:80` 悬停提示与无障碍名称；`:81` 窄时让位；`:82` 接住时的 pop；`:83–86` 行为、出现的条件、记住开关两处（含窄窗口临时、只自动开一次）、⌘K，照原文挪过来、没改字；`:87` 样子的来历（D1 → 裁决 148 重比 D2 → 裁决 149「楞」→ 裁决 150 胶囊 → 裁决 152 戊2，原来「只有图标与数字，不写『待办』两个字」那条并进这里）；`:88` 没选（甲、丁、戊、「3 天内」各一句理由与回头信号）；`:89` 入口位置的旧历史，末尾补一句 10-28 挪出工具簇。
  - `:91` 工具簇去掉待办，写现在剩什么；`:92` SOP 那条的「剩待办、改动……」改掉；`:94` 分隔线规则（三组；没有状态项时待办隔一道线接工具簇；没有待办时照旧两组）。
  - `docs/design/conversation.md:412`（「待办面板」开头：按钮的位置与三种样子）、`:429`（「接住」：去掉「切换器上试用、定稿时写进」，指到 layout-and-chrome）、`:435`（「你要办的事」：顶栏的「今天 N」在胶囊上换成「+N」，提示照旧）。
  - 都注「2026-10-28，票 106，裁决 148–152」（新写的「待办按钮」整段注在总述那一行，子条各引自己的裁决条目）。

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
 Test Files  228 passed (228)
      Tests  2523 passed (2523)
local exit=0

$ TZ=UTC pnpm --dir gui test
 Test Files  228 passed (228)
      Tests  2523 passed (2523)
UTC exit=0

$ TZ=America/Los_Angeles pnpm --dir gui test
 Test Files  228 passed (228)
      Tests  2523 passed (2523)
LA exit=0

$ grep -rn "todo-button-variants\|todoButtonPlace\|replayFlight\|TEMP variant switcher (main chat 10[234])" gui/src
grep exit=1
```

（`grep` 退出码 1 即没有匹配。）

反向检查（scratchpad 里的 `t106-reverse.py`：先把 `lib/todo-button.ts` 备份到 scratchpad，每次改坏一处，跑 `todo-button`、`TodoToggleButton`、`TodoToggleButton.dom`、`MainHeaderHost.todo`、`todo-flight-run` 五个测试文件，再用备份 `cp` 回去重跑；最后 `cmp` 过，恢复后与备份逐字节相同）：

```
--- broken: the first later's is the icon
     × is the icon while the first of yours is later's or anytime's 6ms
     × is the list icon alone while the first of yours is later's or anytime's: a 28px square 11ms
     × writes today's count beside the icon, as text and not a badge 4ms
      Tests  3 failed | 45 passed (48)
--- restored
      Tests  48 passed (48)
--- broken: none of yours writes 待办
     × writes 「待办」 with none of yours 7ms
     × writes 待办 after the icon with none of yours, 13px in the button's ink, the count after it 29ms
     × gives way first on a narrow header, by the header's width 2ms
     × renders this platform's numbers (Windows / Linux in a test run) 4ms
      Tests  4 failed | 44 passed (48)
--- restored
      Tests  48 passed (48)
--- broken: the first today's is the capsule
     × is the capsule while the first of yours is one of today's, overdue too 7ms
     × is the capsule while the first of yours is one of today's, 「+N」 for today's others 10ms
     × is the capsule while the first of yours is overdue, 「+N」 for today's others 3ms
     × writes the first row 「时间 · 标题」 and 「+N」 for today's others, named in full 2ms
     × draws time and 「 · 」 ink-muted, the title ink-soft and cut, 「+N」 tabular ink-muted 2ms
     × writes the overdue part in warning, as the panel's row, and nothing else in colour 1ms
     × is a 28px hairline pill from the fold up: rounded-full, border-line, 5px left, 9px right, 220px at most 2ms
     × folds to the icon and today's count under the fold: the body hidden until the header is wide enough 1ms
     × reads the panel's list: a to-do deleted there and waiting on its undo is not the first row 2ms
     × writes To-do and memos in English 3ms
     × renders this platform's numbers (Windows / Linux in a test run) 2ms
     × writes the row in full while the title is cut, else what the button opens 46ms
      Tests  12 failed | 36 passed (48)
--- restored
      Tests  48 passed (48)
--- broken: a stray name from the switcher in src
     × leaves no pill, store, storage key, replay or marker behind 63ms
      Tests  1 failed | 17 skipped (18)
+   "lib/t106-leftover-probe.ts: replayFlight",
--- restored (probe removed)
      Tests  1 passed | 17 skipped (18)
```

改坏的写法：以后组 → 胶囊（`first.group === "anytime" ? "icon" : "capsule"`，随时组仍是图标，只坏以后组）；空着 → `"icon"`；今天组 → `"icon"`（以后、随时不变）。第四条是顺带的：在 `gui/src/lib/` 临时放一个写着切换器旧名字的文件，新加的残留守卫要红，删掉转绿。

设计文档与 locale 新增行的全角标点：scratchpad 里的 `t106-cjk-punct.py`（中文或全角标点旁的半角 `, ; : ! ? ( )`，以及全角括号配半角括号；先去掉行内代码与链接目标；`--self-test` 拿五条坏样例、五条好样例自测过）扫 `git diff -U0 main..HEAD -- docs/design gui/src/i18n/locales` 的新增行：

```
self-test ok
0 hit(s) of half-width punctuation next to CJK in 26 line(s)
```

这条回报也照样扫过。

改与加的测试：`lib/todo-button.test.ts` 加「the look」三条（空着是字；今天组、逾期、三组都有时是胶囊；以后、随时、以后加随时是图标）；`TodoToggleButton.test.tsx` 新增「the three looks」四条（字；以后、随时各是 28px 方块、不写行也不写字；今天三件是胶囊带「+2」；逾期在前是胶囊带「+1」），胶囊与门槛的测试去掉切换器改用真实列表，删掉丁、「当作没认识」、演示、戊 / 戊2 对比那几条，加一条残留守卫（名字分段拼出来，票面的 `grep` 抓不到它自己）；`TodoToggleButton.dom.test.tsx` 删掉丁「下次启动」那条与只为它存在的 localStorage 替身，标题被截的提示改用 store 里的一件长标题；`MainHeaderHost.todo` / `.sop` 去掉档位循环，尺寸容器改为「有按钮就是、没有就不是」；`todo-flight-run.test.ts` 删「重放」三条。

**4. 票面没写到、我自己定的边界；看到但没改的；没验证到的**

自己定的边界：

1. **规则函数收的是列表**：`todoButtonShape(yours)`，不是票 104 那种传组名加档位；`TodoToggleButton` 先 `todoWithoutDeleting` 再判断，与胶囊读同一份。
2. **「图标加今天的数」实际上几乎没有数**：Core 的 `today_count` 就是今天组的件数（`core/src/assistant_todo.rs:751`），第一件不在今天组时它是 0，所以这一样子平时只有图标；数字只在面板里删了今天的、撤销条还在的 5 秒里出现，常见的「图标加数」是窄顶栏把胶囊收起时。代码路径照留（收起的胶囊要用），设计文档 `:78` 写明了。「今天的数在图标旁」那条测试因此改用撤销期间的数据。
3. **票面与规则对不上的一处：「随时写『随时』」**。票面让设计文档写胶囊的「随时写『随时』」（裁决 150 第 2 条），可戊2 只在今天组展开，随时组与以后组的写法在胶囊上画不出来。我没把它写成现行规则：文档 `:77` 记为「是裁决 150 戊档的写法，戊2 下见不到，`todoCapsule` 照留」，`zh.ts` 里 `todoAnytime` 的注释同样改了；`todoCapsule` 与 `topbar.todoAnytime` 照票面「内容不变」没删。要不要删这条死分支，留给主会话。
4. **┊ 的写法**：票面与裁决 148 写 `[ 待办 ] ┊ [ 状态簇 ] │ [ 视图与设置 ]`，代码里两道是同一种分隔线。文档照抄了这个示意，紧跟一句说明两者相同，免得以后有人照着做一道虚线。
5. **回头信号**：裁决 152 第 5 条只给了「3 天内」的回头信号。丁的取自裁决 150 第 8 条（「真机觉得胶囊太重，退路是丁」）；甲、戊两条是我按没选的理由推的（甲：新用户靠飞入与自动开已经找得到面板；戊：「3 天内」也嫌安静、想让顶栏一直写下一件），文档 `:88` 标明了「裁决原文没写，按理由推」，请 JC 过目。
6. **「待办按钮」挪到「右」列表的第一个**，照顶栏的先后；原来的行为、出现的条件、记住开关、⌘K 四条一字不改挪过来。
7. **残留守卫**：删掉的 `todo-button-variants.test.tsx` 里原有「票 102、103 的标记一个不剩」的检查，我把它挪进 `TodoToggleButton.test.tsx` 并扩到票 104 的名字与键（`todo-button-variants`、`useTodoButtonVariants`、`TodoButtonVariantsPill`、三个 `galley.tmp.*` 键、`introducedAtLaunch`、`replayFlight`、三档标记），照 `MainView.assistant.test.tsx` 票 telegram-details 10 的先例跳过 `zz-harness` 探针文件。
8. **`zh.ts` 两行注释**：一处写着「票 104 的切换器上，丁档……戊与戊2……」，改成定稿的说法；另一处见第 3 条。只改注释，字面量没动。

看到但没改的：

1. **撤销那 5 秒里的数字**：删掉你唯一的、今天的那件后，撤销条还在时按钮是「☑ 待办 1」（列表已空写字，`todayCount` 还算着它）；有以后的事时是图标加 1。同票 104 回报第 4 条第 2 点「+N」多算一件的口径，没改。
2. **JC 本机 localStorage 里旧的 `galley.tmp.todoButtonCapsule`（可能还有票 103 的 `galley.tmp.todoButtonPlace`、票 102 的 `galley.tmp.todoFlight`）**：没人再读，也没加清理代码。
3. **「3 天内」没进 `docs/devlog/deferred.md`**：它是带回头信号的没选项，按惯例可能要进 deferred；票面只说写进设计文档，我没动 devlog，留给主会话定。
4. `docs/design/overlays-and-settings.md:117`、`:198` 写「每条对话顶栏的『待办』按钮」，没说位置与样子，仍然成立，没改。
5. `gui/src/App.tsx`、`gui/src/i18n/locales/zh.ts` 本来就不是 prettier-clean（我的 hunk 只删行或改注释，没整篇格式化）；`layout-and-chrome.md:91` 工具簇那行原有的半角引号 `"设置 · ⌘ + ,"` 不是这次加的。
6. 主树里票 104 回报提过的探针（`gui/src/zz-harness-t102.ts`）现在已经不在（只读看过主树的 `git status`，没碰），合入不会撞它。

没验证到的：

1. **真窗口没看**（照票面不跑 `tauri dev`）：三种样子、胶囊、窄时让位都只在静态渲染与 jsdom 里测过。门槛与胶囊类名一个没改；顶栏尺寸容器的条件从「甲以外三档」变成「有按钮就设」，生产构建原来是默认档戊（容器本来就开着），所以生产里顶栏的 CSS 不变，JC 的 dev 若之前停在甲，这次会第一次看到容器生效。
2. **胶囊上的飞行与 pop**、减少动态、深色、Windows、外置运行时：只有单测（外置运行时核对了四种顶栏都没有按钮、不设容器）。
3. **一天之内变形**（过午夜、勾掉今天最后一件）：`useDayStamp` 与 store 一变就重算，没写跨日的动态测试，也没在真窗口看。
4. 给 JC 的真机步骤两条都没走。
