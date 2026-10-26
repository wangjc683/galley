# 100 巡看那一行拿出待办面板

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 145（2026-10-26，JC：「按建议推进」）。推翻 [助手 PRD](../../assistant/PRD.md) 裁决 10「巡看要无感」里的「面板『例行』里那一条留着」与票 80 的「巡看那一行不因为空状态而消失」。只改 GUI 与设计文档；`core/`、手册、评测不动。

## 为什么

- 巡看那一行（「过一遍在办的事」「每天 08:51 · 下次 明天 08:51」）展示的是机制，不是效果：它派的子任务在「Galley 在办」，开口时来源随话带出；这一行看不出它做了什么，天天一个样子。
- 清单的规矩一直给它开例外（判空、开机自启提示、已完成、名字），它不是清单里的一件事。
- 巡看本身照旧每天跑：Core 的种子、叫醒判据、叫醒说明、手册里的停用与改时间都不变。

## 要做的

1. **面板看不到巡看**：在一处把巡看（`lib/assistant-todo.ts` 的 `isDailyReview`：`kind === "task"` 且 `agent === REVIEW_SUPERVISOR`）从面板用的清单里拿掉，让面板的每个消费者都看不到它：分组（`TodoPanel.tsx` 的「例行」）、判空（`lib/todo-panel.ts` 的 `todoPanelEmpty`）、开机自启提示（`lib/assistant-todo.ts` 的 `todoAutostartHintVisible`）、亮行比较（`todoPanelChanges`）、`todoListed`、`todoRowsInDone` 等。拿在哪一处（store 收到 Core 清单时，还是面板的入口函数）由你读码定，回报里写理由；先查清 `AssistantTodo` 还有没有面板之外的消费者（顶栏「今天 N」用的是 Core 的 `todayCount`，侧栏、⌘K、远程模块等若读了 `routine`，列出来，判断它们要不要也看不到巡看）。只有巡看时「例行」一组不出现（空的组本来就不画）。
2. **删掉随之失效的例外**：`todoPanelEmpty` 的 `todo.routine.every(isDailyReview)` 改回「例行为空」；`todoAutostartHintVisible` 的 `!isDailyReview(item)` 若已不可能命中就删；`todoRowText` 的巡看名字分支与 locale 键 `todo.dailyReview`（`zh.ts`、`en.ts` 两处）若再没有引用就删。注释里讲这些例外由来的段落一并改，指向裁决 145。`isDailyReview` 留给过滤用。`lib/scheduled-tasks.ts` 的 `isDailyReviewTask`（定时对话框过滤，理由不同）不动，只改它注释里「the to-do panel shows a name of its own instead」这类过时的话。
3. **票 87「只自动开一次」行为不动**：只改它注释与设计文档里那段理由（「新用户可能一直不知道它每天在巡看」不再成立，它本身的理由还在）。
4. **测试**：删掉或改写断言巡看在面板里出现的用例（`TodoPanel.test.tsx` 里 `>过一遍在办的事<` 两处、`todo-panel.test.ts` 的 `todoRowText` 巡看用例、`todo-open.test.ts` 引用巡看名字的那条：若它测的是引用逻辑而非巡看，换一个普通标题照留）；加：清单里只有巡看时面板是空状态且没有「例行」组；巡看与一条普通例行同在时「例行」只画普通那条；只有巡看（含暂停的）时开机自启提示不出现、有别的会响的事时照旧出现；巡看的时刻或暂停变化不亮行。
5. **设计文档** `docs/design/conversation.md`「待办面板」：「例行」一条写明巡看不在这里（链裁决 145）；「判空不算巡看」一段改写（现在是自然成立：面板根本看不到它；保留由来一句，指出票 80 那条「行不因空状态消失」被裁决 145 推翻）；「开机自启提示」里「会响的事」不算巡看的写法对齐；「只自动开一次」的理由一句对齐。其他提到巡看的地方（`grep -n 巡看 docs/design/*.md`）逐处看一遍，只改说巡看在面板里出现的。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`、不开 Vite 页面验 Tauri 相关的流程。
- `core/`（种子、判据、叫醒说明）、`cli/`、手册 `docs/managed-ga-runtime/galley-assistant-manual/`、评测、`.scratch/` 下的 PRD 与票（主会话已写好裁决）。定时对话框的过滤。面板其他组、行、动作、空状态文案。
- `gui/` 不是 prettier-clean：旧文件只格式化自己改的 hunk，别对整个文件跑 `prettier --write`。React 编译器的 lint 规则：effect 里同步 setState、渲染期读 `Date.now()` 都是 error；工具函数别从组件文件导出。静态渲染测试读不到 store 里塞的值，照现有测试的 mock 写法。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。新增行不能有本机路径、会话 id、真实数据。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`。
- `git diff --check`；新增中文全角标点。
- `grep -rn "dailyReview\|isDailyReview" gui/src` 的结果原样贴进回报。

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 过滤放在哪一处、理由；`AssistantTodo` 面板之外的消费者清单与各自的处理。
3. 删掉的例外与 locale 键，各一行。
4. 设计文档改了哪几节。
5. 验证命令与结果原样。
6. 看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

1. 打开待办面板：「例行」里没有「过一遍在办的事」；没有别的例行时整组不出现。
2. 清单里没有别的事时（或在一份干净的数据上）：只看到空状态，下面没有「例行」。

## Comments
