# 84 已完成定 B：写死、拆切换器

Status: needs-dogfood（2026-10-22 快进合入 `9b5b6189`、`59da91bf`、`c49576c6`；主会话机器验收：代理中途用 `git checkout --` 误撤过一次未提交的改动后重做，主会话核对了自票 83 第 5、6 条以来 GUI 的净改动只有 B 的写死、走不到的例行分支与注释，票 80 与票 83 的定稿都在、切换器无残留；rebase 前在代理的 worktree 里重跑 `pnpm --dir gui typecheck`、`lint`、`vitest run`（199 个文件、2113 条全过）、`git diff --check` 干净）

来源：[主聊天 PRD](../PRD.md) 裁决 129 第 2 条「定 B」（2026-10-22，JC 真机后：「定B」）。只改 GUI 与设计文档。依赖票 82、83（都已合入 main）。

## 要做的

1. **写死 B**：照 `gui/src/components/todo/todo-variants/todo-variants.ts` 文件头的拆法「B」一段：已完成里非待办的行标题 `ink-muted`；`DoneRow` 与 `TodoCard` 给做完（`state === "done"`、没取消）的待办方框传 `checkedTone="quiet"`；`ui/checkbox.tsx` 与 `TodoCheck` 留着 `checkedTone`（去掉临时标记注释，注释改写成定稿的说法：已完成里勾着的方框是中性灰实心、对勾 `ink-soft`，勾下去停留的 1.5 秒里照旧品牌色，依据裁决 129 第 2 条）；`RowShell` 去掉 `rowClass`。
2. **拆**：照文件头「Always」一段删掉切换器（整个 `todo-variants/` 目录与快照、`App.tsx` 的 pill）与演示档（`useDemoDone`、`DoneRow` 的 `inert` 与 `ignore`、`TodoCheck` 的 `onToggle`）；`grep -rn "main chat 83" gui/src` 拆完应当只剩票 83 第 5、6 条（定稿）那几处，或者为零，回报里列出剩下的。
3. **删走不到的分支**：票 82 起已完成里没有例行，`DoneRow` 里画例行（`Repeat` 图标）那一支删掉；类型镜像与注释里若还说已完成有例行，一并改。
4. **旧注释**：`MetaLine` 注释里「the day it was noted」（裁决 97 起小字里没有记下的日子）改成现状。
5. **设计文档** `docs/design/conversation.md`：
   - 「待办面板」的「已完成」一条：待办方框勾着时是中性灰实心（`line-strong` 填色与描边、对勾 `ink-soft`），不是品牌色；子任务、提醒的标题 `ink-muted`，与勾掉的待办同一档。
   - 「勾掉的样子」一条：写上 B 与由来（10-17 C1 只删除线加 `ink-muted`、没选 C2 整行 60%；10-22 切换器比现状 / A / B / C，定 B，没选 C 整行 70% 的理由照裁决 129 第 2 条），勾下去那一下照旧品牌色。
   - 「待办卡片」的「做完」：方框同面板（中性灰实心），删掉「品牌色填」。
   - Markdown 的 `- [x]` 那一行不动（仍是品牌色）。
   - 都注「2026-10-22，票 84，裁决 129」。
6. **测试**：切换器测试随目录删掉；`TodoPanel.test.tsx`、`TodoCards` 的测试改成断言 B 的样子（已完成方框 quiet、非待办标题 `ink-muted`、停留期间品牌色、没做完的方框不变）；`ui/checkbox.tsx` 的默认样子不变。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 票 80 与票 83 第 5、6 条的定稿（备注、空状态、取消按钮、自启提示、组间距）；分组、排序、停留时长。
- `core/`、手册。
- 不加新文案键。`gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。删文件用 `git rm` 点名。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过
- `git diff --check`
- 设计文档新增行中文全角标点

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `grep -rn "main chat 83" gui/src` 的结果原样。
3. 定稿后 `DoneRow`、`TodoCard` 方框那几行的 diff 原样。
4. 验证命令与结果原样。
5. 看到但没改的问题。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新）切换器那一排不见了；已完成里勾掉的待办是灰方框，子任务、提醒的标题和勾掉的待办一样淡；勾下去那一下照旧是品牌色。

## Comments

### 2026-10-22 实现回报（票 84 代理）

- **提交**（分支 `ticket-84-done-b`，从 main `9aa1fa9e` 起，未 push、未合入）：`c05198c8` GUI 与测试；`3eacb727` 设计文档；本条回报另一个提交。
- **写死 B**：`DoneRow` 里待办的方框写死 `checkedTone="quiet"`（已完成只列做完的待办；停留里取消勾时方框是空的，色调不起作用）；子任务、提醒的标题写死 `text-ink-muted`。`TodoCard` 只在 `item.state === "done"` 且没取消时传 `quiet`，正在勾的卡片（待办还是 open、勾在停留里）照旧品牌色。`ui/checkbox.tsx` 与 `TodoCheck` 保留 `checkedTone`，注释改写成定稿说法（只给 Core 里已做完的待办用，依据裁决 129 第 2 条，停留的 1.5 秒照旧品牌色）。`RowShell` 去掉 `rowClass`，C 的整行淡化跟着没了。
- **拆**：`git rm` 了整个 `gui/src/components/todo/todo-variants/`（`todo-variants.ts`、`TodoVariantsPill.tsx`、`todo-variants.test.tsx` 与快照），去掉 `App.tsx` 的 pill 与 import；演示档的 `useDemoDone`、`DoneRow` 的 `inert` 与 `ignore`、`TodoCheck` 的 `onToggle` 都删了，已完成照旧读 `todo.done`、件数 `todo.done.length + todo.doneOmitted`、「还有 N 件没有列出」照旧。`grep -rn "main chat 83" gui/src` 为零：票 83 第 5、6 条的注释写的是「main chat ticket 83」，不含这个标记，两处定稿（`todoAutostartHintVisible` 不算巡看、`TodoPanelGroups` 外层 `space-y-3`）原样保留。
- **删走不到的分支**：`DoneRow` 里非待办只剩子任务（`StatusIcon`）与一次性提醒（`Clock`）两支，画例行的 `Repeat` 那一支删了（`Repeat` 仍给「例行」组的 `RoutineRow` 用）。`AssistantTodo.done` 的类型镜像注释写上只有三种、例行响过不进（票 82）；`doneRowLine` 注释里的「a fire」改成「a one-off's fire」；面板文件头的分组表补上已完成的三种和灰方框。
- **旧注释**：`MetaLine` 的注释改成现状：小字是截止与铃铛加时刻（裁决 97 起不写记下的日子），末尾是悬停的取消提醒，窄的时候截字不截按钮。
- **设计文档**（`docs/design/conversation.md`）：「待办面板」的「已完成」写上方框中性灰实心、子任务与提醒标题 `ink-muted`；「勾掉的样子」写上 B、勾下去那一下照旧品牌色，加一条由来（10-17 C1 / C2，10-22 现状 / A / B / C 定 B，没选 C 的理由照裁决 129 第 2 条），另起一条写 Markdown 的 `- [x]` 不跟着改；「待办卡片」的「做完」把「品牌色填」改成同面板的中性灰，补一句正在勾的卡片照旧品牌色。都注了「2026-10-22，票 84，裁决 129」。顺手改了一处同类的过时说法：「点标题」里「到点开过会话的例行打开那个会话」改成「一次性任务」（票 82 起例行响过不进已完成，这一行已走不到）。Markdown 渲染那一节 `- [x]` 那一行没动。
- **测试**：切换器测试随目录删掉。`TodoPanel.test.tsx` 加了：已完成里做完的待办方框是 `border-line-strong bg-line-strong text-ink-soft`、不带 `bg-brand`、仍可点、整行没有降不透明度；上面没做完的方框照旧是空框；停留中（`settling`、`saving`）的勾是品牌色，读回来落进已完成后是灰的，已完成里停留中取消勾是空框；已完成里子任务与送到的提醒标题 `ink-muted`、不再有 `ink-soft`。卡片测试加了：做完的卡片灰方框、不带 `bg-brand`；正在勾的卡片品牌色；没做的、取消的（含取消前做过的）是空框。新加 `ui/checkbox.test.tsx`：默认勾着的类名与改前逐字相同，`quiet` 的类名，没勾时色调不起作用。临时把 B 改回去跑过一次，这几条会失败（4 条失败），再恢复。

### 看到但没改的

1. 深色下灰实心方框（`line-strong` `#41464e`）和没做完的空框（同色描边、`bg-elevated` 底）靠填色与对勾区分，没在真机看；裁决 129 第 2 条留的跳出路线是灰底再深一档。
2. 没跑 `tauri dev`，WebKit 下的样子没看。
3. 已完成的子任务行用 `StatusIcon` 的完成图标，墨色是它自己的 `ink-muted`；这次只降了标题，图标没动（票面「图标、小字不变」）。
