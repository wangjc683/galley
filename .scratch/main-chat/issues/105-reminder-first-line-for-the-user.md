# 105 它自己的提醒：第一行写给用户看，卡片与面板只显示第一行

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 151（2026-10-28，JC：「甲，可以花」：手册改写法、GUI 只显示第一行、为它重跑提醒评测花额度）。改手册、GUI、评测与设计文档；Core、Agent API、入口层提示词不动。外置运行时零变化（它的定时任务对话框 `ScheduledTasksDialog.tsx` 显示的是用户自己在表单里填的原文，不改）。

## 为什么

JC 10-28 走查时看到，提醒卡片上写着「提醒用户喝水。这是用户要求的一次性提醒，请在主聊天简短提醒：该喝水了。」。原因是手册要它「Write the words for yourself at that moment」（`docs/managed-ga-runtime/galley-assistant-manual/reminders.md:34`），卡片和面板却把这段原文直接显示出来。到点时 Core 交回给它的也只有这段原文（「What you noted when you set it」，`core/src/subtask_report.rs:466-473`），`--reason` 不会送到它眼前，所以不能把写给自己的话挪到那里去。改成和待办「标题 + 备注」一样的分法：第一行给人看，后面给它自己看。

## 现状（读码起点）

- 手册：`docs/managed-ga-runtime/galley-assistant-manual/reminders.md` 第 27–36 行（`schedule create "<your words>"` 与「Write the words for yourself…」）；改动是 `schedule update <id> --prompt="<words>"`（约 54 行）。别的部分里说到提醒原文的，自己 grep（`wake.md`、`todos.md`、`unasked.md` 等）。入口层（`core/src/managed_prompt.rs`）没有这句，不动。
- GUI 显示原文的地方（至少这些，自己 grep 全）：
  - `gui/src/components/conversation/ReminderCards.tsx` 约 97、128、137、148、151 行（`task.prompt`：无障碍名、截断提示、正文）；
  - 面板里 Galley 在办与例行的行，`TodoItem.text`（Core 给的是任务原文，不截，`gui/src/lib/assistant-todo.ts` 约 92 行注释），画在 `gui/src/components/todo/TodoPanel.tsx`；
  - 面板「说说这件」把那一行的字引进输入框（`lib/todo-open.ts` 的 `quoteTodo` 一带）；
  - 触发失败的系统通知（Core 事件 `scheduled-tasks:fire-failed` 带 `prompt`，GUI 收到后发通知，自己找）；
  - 胶囊（票 104）只写你的事、不写它的提醒，不受影响；确认一下。
- 评测：`.scratch/main-chat/entry-layer-eval/`（`README.md` 写了怎么跑、要哪个解释器、`PYTHONDONTWRITEBYTECODE=1`），定时与提醒套件在 `schedule/`（`cases.json` 14 个用例，`expect` 里有 `words_any` 等判定，结果 `results.json` / `results.md` 记着历次重跑与被替换的运行）。

## 要做的

1. **手册**（`reminders.md` 那一条改写，英文，照周围写法）：原文的第一行是要提醒的那件事，写给用户看，像一条待办的标题：短，一件事，不写时间（卡片旁边已经有时间），不写「用户要求」「提醒用户」，不用第三人称（「该喝水了」「订上海的酒店」「问 HR 有没有回 offer」）。需要时空一行，再写到点时自己要的：是什么、为什么、到时做什么、要用的名字地点数字链接会话 id；这部分只有它看得到。说明一句为什么：卡片和面板只显示第一行，到点时它拿到全文。`schedule update --prompt` 同样的写法。别的部分里有冲突的说法一起改。
2. **GUI 只显示第一行**：一个取「第一行」的函数（第一个非空行、去首尾空白；没有换行时就是整段，旧提醒照旧显示），放 `lib/` 里，单测。上面列的每一处显示原文的地方都改用它：卡片正文、无障碍名、截断时的悬停提示（只给第一行的全文，不给后面写给它自己的）、面板行、「说说这件」的引用、触发失败通知的正文。只影响内置运行时这几处，`ScheduledTasksDialog.tsx`（外置）不动。
3. **评测**：
   - `schedule/` 套件加第一行的判定，对每一次 `schedule create` / `schedule update --prompt`：第一行不含「用户」「JC」、不以「提醒」开头、不含时刻或日子（数字加「点」「:」「号」，「今天」「明天」「周X」等）、不超过 20 个字；写清判定规则与理由，判定代码有自测。旧判定照旧。
   - 叫醒用例（`wake-on-time` 等）里预先放着的任务原文，改成新写法（第一行给人、空行、写给自己的），让叫醒那一侧在新写法下也测到；改了什么在结果里写明。
   - 先 `--dry-test`，再全套 14 个用例各两遍真跑，模型 `mm_1792576875658`（API key 接入的 gpt-6.1-sol，脚本默认就是它；跑之前只读查一次它在 `managed_models` 里、服务商 `auth_kind` 是 `api_key`，不在就停下回报，别换模型）。结果照这个套件的惯例写进 `results.json` / `results.md`（被替换的运行留在 `meta.superseded_runs`，加一条注说明票 105 改了什么），并和上一次（票 73）同用例对照：第一行合格率、原有判定有没有退步。
   - 结果文件只写模型 id 与「API key 接入」，不写服务商名、接口地址、本机路径。
4. **设计文档**：`docs/design/conversation.md`「提醒卡片」里「它记下的话」改成「原文的第一行」并写一句为什么；「待办面板」里 Galley 在办与例行行的字同样只取第一行。注「2026-10-28，票 105，裁决 151」。
5. 不改 Core：`subtask_report.rs` 的叫醒说明照旧把全文给它。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。主树里有主会话未提交的临时探针（`gui/src/main.tsx` 末行、`gui/src/zz-harness-t102.ts`），不要带进来。
- Core、`core/`、入口层提示词、Agent API、CLI。
- 票 104 的顶栏与切换器（还在试用）。
- 外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；工具函数别从组件文件导出。
- 评测脚本与 `managed-ga/code` 相关的探针一律 `python -B` 或 `PYTHONDONTWRITEBYTECODE=1`，不留 `__pycache__`。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 105, PRD ruling 151」）。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t105-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`；`git status` 里没有 `__pycache__`
- 反向检查：把「取第一行」改成取整段、卡片的悬停提示改回全文，对应测试要红，改回全绿
- 评测：`--dry-test` 输出、真跑的汇总（每个用例两遍的判定），原样贴
- 手册、设计文档新增行中文全角标点（自写正则扫，脚本放 scratchpad、文件名带 `t105-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 手册改后的那一条原文；GUI 改了哪几处显示（逐处 file:line）。
3. 评测：第一行判定的规则、两遍的结果、与票 73 的对照，每一次 `schedule create` 的第一行原样列出。
4. 验证命令与结果原样（含两个时区、反向检查）。
5. 票面没写到、你自己定的边界；看到但没改的问题，没验证到的（逐条）。

## 给 JC 的真机步骤

合入后（手册改动要重启 runner 才读到；纯 GUI 部分热更新）：

1. 第 3 站那条「喝水」的卡片仍显示旧原文（旧提醒不改）。
2. 跟 Galley 说「明天下午四点提醒我给妈妈打电话」：卡片上只写一句给你看的话（如「给妈妈打电话」），面板「Galley 在办」那一行同样。

## Comments
