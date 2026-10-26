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

### 2026-10-26 实现报告（代理，分支 `ticket-100-review-row`）

**1. 提交列表**（`git log --oneline main..HEAD`，本报告另作一个提交，不在其中）

```
ed75957f Main chat ticket 100: take the daily review off the to-do panel
```

**2. 过滤放在哪一处、理由；面板之外的消费者**

- 放在 store 收到 Core 清单时：`stores/assistant-todo.ts` 的 `read()` 返回 `withoutDailyReview(todo)`（新函数，在 `lib/assistant-todo.ts`，紧挨 `isDailyReview`）。`load()`、勾掉 / 取消勾写完后的读回、删除提交后的读回都走这一个 `read()`。
- 理由：面板的读者不只 `TodoPanel` 一个。`useTodoPanelFlash` 直接订阅 store 的前后两份比 `todoPanelChanges`，回复下卡片 `TodoCards` 直接从 store 算 `todoListed`；放在面板入口（`TodoPanel` 里 `todoWithoutDeleting` 那一步），亮行比较会漏掉。放在 store，所有读 `s.todo` 的地方一次都看不到它。没放进 `listAssistantTodo()`：那是 Core 命令的原样镜像，测试里也按原样钉着。
- 范围：不只滤「例行」，「Galley 在办」「已完成」也滤。Core 把巡看手动改成一次性时会把它放进「Galley 在办」（`core/src/assistant_todo.rs` 分组处 `if once { assistant_tasks.push }`）；「已完成」Core 本来就不收它，滤了也无害。`yours` 只有待办，不动。没有巡看时返回同一个对象。
- `AssistantTodo` / store 的 `todo` 在面板之外的消费者：
  - 顶栏「今天 N」（`TodoToggleButton`）：只读 `todayCount`，是 Core 数的待办，与巡看无关，不动。
  - 回复下待办卡片（`TodoCards` 的 `todoListed`）：只会按待办 id 匹配，巡看是任务，本来就碰不到；读的是 store 那一份，也已滤掉。
  - `useAssistantTodoSync` 的 `nextTodoRefreshMs`：只读你的待办，不动。
  - store 自己的 `sendDeletes`：只看 `done` 里的待办，不动。
  - `useTodoPanelIntroduction`：只读 `noted`（待办），不动。
  - 侧栏、⌘K：不读 `routine`，⌘K 只是打开面板（`App.tsx`、`lib/todo-open.ts`）。远程模块（`core/src/remote`）不读待办。
  - 回复下提醒卡片（`useReminderCards` / `remindersByMessage`）读的是定时任务列表，按 `createdIn` 挂；巡看没有 `createdIn`，本来就没卡片，不动。
  - 面板之外、该看得到巡看的照旧看得到：CLI `galley todo list` 与助理的「在办的事」都走 Core 的 `assistant_todo`，未改；定时对话框的 `isDailyReviewTask` 过滤未改（只改了 `lib/scheduled-tasks.ts` 那段注释）。

**3. 删掉的例外与 locale 键**

- `todoPanelEmpty`：`todo.routine.every(isDailyReview)` 改回 `todo.routine.length === 0`。
- `todoAutostartHintVisible`：删 `!isDailyReview(item)`（面板的清单里已不可能有巡看）。
- `todoRowText`：删巡看名字分支 `if (isDailyReview(item)) return copy.todo.dailyReview;`；`lib/todo-panel.ts` 不再 import `isDailyReview`。
- locale `todo.dailyReview`：`zh.ts` 删一行（连同上面那行注释）、`en.ts` 删一行；删前确认只有 `todoRowText` 引用。
- 注释改了的：`lib/assistant-todo.ts`（文件头「你看到的就是它看到的」补上巡看这个例外、`todoAutostartHintVisible`）、`lib/todo-panel.ts`（`todoRowText`、`todoPanelEmpty`）、`components/todo/TodoPanel.tsx`（组件头、空状态下的 JSX 注释、组间距注释）、`lib/todo-open.ts`（`quoteTodo` 的 `title`）、`lib/todo-panel-memory.ts`（票 87「只自动开一次」的理由：行为不动，改写理由并指向裁决 145）、`lib/scheduled-tasks.ts`（`REVIEW_SUPERVISOR` 注释里「the to-do panel shows a name of its own instead」）、`stores/assistant-todo.ts`（store 头与 `read()`）。

**4. 设计文档**（`docs/design/conversation.md`「待办面板」）

- 「开与关」下「只自动开一次」：理由改成它本身的（第一张待办卡片出现时带你看一眼面板），票 87 时那条巡看理由写明被裁决 145 第 5 条拿掉、行为不动。
- 「分组」第一句：去掉「空状态下面的『例行』也算第一组」，改为由来一句，指向「全空」。
- 「例行」：写明巡看不在这里（链裁决 145 与 devlog），在一处拿掉、照旧每天跑、理由、由来（票 74 的名字、票 80 的空状态下也画）、代价（第一次做事之前无从知道它、停掉后面板上看不到「已暂停」）。
- 「全空」下原「判空不算巡看」改名「判空」：现在自然成立；保留由来，写明票 80「巡看那一行不因为空状态而消失」被裁决 145 推翻；删掉只适用于空状态下画「例行」时的像素距离。
- 「开机自启提示」：「会响的事」里没有巡看，因为清单里没有它；票 83 的点名例外留作由来。
- 其余提到巡看的逐处看过：「不出声的回复」（巡看派子任务）、「已完成」（「巡看早在票 73 就不进」，仍属实）不是说巡看在面板里出现，没改。`docs/design/` 其他文件没有巡看。

**5. 验证命令与结果**（输出原样，只把本机路径换成 `…`）

```
$ pnpm --dir gui typecheck
> galley-desktop@0.7.1 typecheck …/gui
> tsc --noEmit
（exit 0）

$ pnpm --dir gui lint
> galley-desktop@0.7.1 lint …/gui
> eslint src --max-warnings 0
（exit 0）

$ pnpm --dir gui test
 Test Files  216 passed (216)
      Tests  2401 passed (2401)
（exit 0）

$ git diff --check main..HEAD
（无输出，exit 0）

$ grep -rn "dailyReview\|isDailyReview" gui/src
gui/src/components/screens/scheduled/ScheduledTasksDialog.tsx:23:  isDailyReviewTask,
gui/src/components/screens/scheduled/ScheduledTasksDialog.tsx:141:      .then((all) => setTasks(all.filter((task) => !isDailyReviewTask(task))))
gui/src/lib/assistant-todo.ts:358:export function isDailyReview(item: TodoItem): boolean {
gui/src/lib/assistant-todo.ts:377:    items.some(isDailyReview)
gui/src/lib/assistant-todo.ts:378:      ? items.filter((item) => !isDailyReview(item))
gui/src/lib/scheduled-tasks.ts:66:export function isDailyReviewTask(task: ScheduledTask): boolean {
gui/src/lib/assistant-todo.test.ts:11:  isDailyReview,
gui/src/lib/assistant-todo.test.ts:445:    expect(isDailyReview(REVIEW)).toBe(true);
gui/src/lib/assistant-todo.test.ts:446:    expect(isDailyReview(theirs)).toBe(false);
gui/src/lib/assistant-todo.test.ts:447:    expect(isDailyReview(labelled)).toBe(false);
gui/src/lib/scheduled-tasks.test.ts:15:  isDailyReviewTask,
gui/src/lib/scheduled-tasks.test.ts:123:describe("isDailyReviewTask", () => {
gui/src/lib/scheduled-tasks.test.ts:138:      isDailyReviewTask(task({ via: "system", supervisor: "galley-review" })),
gui/src/lib/scheduled-tasks.test.ts:141:      isDailyReviewTask(
gui/src/lib/scheduled-tasks.test.ts:145:    expect(isDailyReviewTask(task({ via: "gui" }))).toBe(false);
gui/src/lib/scheduled-tasks.test.ts:146:    expect(isDailyReviewTask(task())).toBe(false);
```

- 测试：删掉断言巡看在面板里出现的用例（`TodoPanel.test.tsx` 两条、`todo-panel.test.ts` 的巡看名字三条）；`todo-open.test.ts` 那条测的是引用逻辑，改用没有标题的子任务（「子任务」）照留；`TodoPanel.test.tsx` 其余用到巡看的三处改成不带巡看。新增：`lib/assistant-todo.test.ts`（`withoutDailyReview`：例行里拿掉、运行或暂停都拿、一次性的也拿、其余原样、没有时同一对象、按标签认且只认任务；只有巡看时开机自启提示不出现、有别的会响的事照旧）、`lib/todo-panel.test.ts`（经过滤后判空；巡看改时刻、暂停、恢复、出现都不亮，别的例行照亮）、`stores/assistant-todo.test.ts`（读入时拿掉，写完读回时也拿掉）、新文件 `components/todo/TodoPanel.review.test.tsx`（jsdom，真 store、模拟 Core 返回带巡看的清单：只有巡看时空状态且没有「例行」组；与普通例行同在时「例行」只画那一条；只有巡看（含暂停）时开机自启提示不出现、有别的会响的事时出现；面板在屏上时巡看的时刻、暂停变化不亮行）。静态渲染测试读不到 store 里滤过的值，所以面板级的巡看用例放在 jsdom 这一份里。
- 变异检查：临时把 store 的过滤去掉，新增的 6 条（store 2、面板 4）全红；已还原。
- prettier：只格式化自己的 hunk。`TodoPanel.test.tsx`、`todo-panel.test.ts`、`stores/assistant-todo.test.ts` 在 HEAD 时 prettier 干净，整篇格式化只动我的行；新文件整篇格式化；`en.ts`、`zh.ts`、`scheduled-tasks.ts` 原有的 prettier 差异（40 / 13 / 4 行）没动。
- 全角标点：自写脚本扫新增行，中文语境零处；4 处命中都是英文注释或英文测试名里引用的中文词（如 `under 「Galley 在办」, and`），按英文标点。新增行扫过本机路径、会话 id、密钥格式，零处。

**6. 看到但没改的，没验证到的**

- `core/src/managed_prompt.rs` 「In Hand」那段文档注释写着拒掉的跟进是「the one exception to "what you see is what it sees"」；现在巡看也是一个例外（助理的「在办的事」里有它，面板没有）。`core/` 不在本票范围，没改。
- 没开 `tauri dev`、没在真机上看：「例行」里没有那一行、只有巡看时只剩空状态，留给「给 JC 的真机步骤」。
- 没验证 Windows；改动只在纯函数与 store，不碰平台相关代码。
