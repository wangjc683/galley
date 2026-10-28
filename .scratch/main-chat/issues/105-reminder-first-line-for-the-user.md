# 105 它自己的提醒：第一行写给用户看，卡片与面板只显示第一行

Status: done（2026-10-28 JC 真机：「十分钟后提醒我喝水」记成 `该喝水了`，「明天上午帮我看下京东显示器的物流」第一行 `查看京东显示器物流`、空行后是写给它自己的话，JC：「只写了『查看京东显示器物流』这一句」。主会话起先给的测试句「明天下午四点提醒我给妈妈打电话」按裁决 92 记成了带提醒的待办，没走到本票。2026-10-28 快进合入 `d8f09da6`；主会话机器验收：读过手册 diff 与改动文件表；在 worktree 重跑 `pnpm --dir gui typecheck`、`lint`、`git diff --check` 全过，`test` 本地与 `TZ=UTC` 各 229 个文件、2534 条全过，`cargo test -p galley-core --lib assistant_manual` 12 条全过；评测 28/28、第一行 6/6 照代理回报与结果文件；合入后 touch `core/src/assistant_manual.rs` 让 dev 重编 Core，新手册才装进状态根）

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

### 2026-10-28 实现回报（票 105 代理）

分支 `ticket-105-reminder-first-line`（从本地 main 的 `206ada63` 拉出），worktree 里做。未 push、未合入。

**1. 提交列表**（`git log --oneline main..HEAD`，这条回报自己的提交在它之后）

```
07a4cccf Ticket 105: the schedule eval judges a reminder's first line; rerun
bfba8649 Ticket 105: the manual writes a reminder's first line for the user
d123f3cb Ticket 105: the assistant's reminders show their first line only
```

**2. 手册与 GUI**

手册 `docs/managed-ga-runtime/galley-assistant-manual/reminders.md` 改后的那一条（`schedule create` 那行下面的两条），原文：

```
- The first line of your words is the thing itself, written for the user
  like a to-do's title: short, one thing, in their language, with no time
  or day (the card shows when), no 「用户要求」 or 「提醒用户」, and not
  about them in the third person (「该喝水了」「订上海的酒店」「问 HR 有没有回
  offer」). The card under your reply and the user's list show this line
  only; when it comes due, you get all of your words.
- When you need more, leave a blank line after that line; the rest is for
  you alone, the user does not see it.
  Write the words for yourself at that moment, when this conversation may
  be out of your context: what it is, why it matters, what to do then, and
  what you will need (names, places, numbers, links, session ids). The
  breaks must reach the CLI as real line breaks: in a shell, `\n` inside
  quotes stays two characters.
```

改动那句写成 `` `--prompt="<words>"`, written the same way ``。别的部分（`wake.md`、`todos.md`、`unasked.md`、`cli.md`、`memo.md`）grep 过，没有与之冲突的说法（`wake.md`「The note carries your own words」仍然成立），没动。

GUI 取第一行的函数在新文件 `gui/src/lib/reminder-first-line.ts`（`reminderFirstLine`：第一个非空行、去首尾空白，没有换行时就是整段；`todoItemWords`：`kind` 为 `task` 的取第一行，待办与子任务照旧），单测 `reminder-first-line.test.ts`。改用它的显示处：

- 提醒卡片 `gui/src/components/conversation/ReminderCards.tsx`：`:88` 取一次（`const words = reminderFirstLine(task.prompt)`），无障碍名 `:105`，按钮那一支的悬停 `:135` 与正文 `:143`，字那一支的悬停 `:153` 与正文 `:155`。
- 面板行 `gui/src/lib/todo-panel.ts:324-326`（`todoRowText` 改走 `todoItemWords`）：`components/todo/TodoPanel.tsx:532` 的行标题、`:550`/`:562` 截断悬停、`:557`/`:564` 正文都从它来，「Galley 在办」「例行」「已完成」三组一样。
- 「说说这件」：`TodoPanel.tsx:210` 传的就是 `todoRowText`；`gui/src/lib/todo-open.ts:285` `quoteTodo` 不传标题时的默认值也改成 `todoItemWords(item)`。
- 提醒叫不醒它时的系统通知与提示条 `gui/src/lib/reminder-notify.ts`：`:58` 取一次，`:66` 提示条、`:79` 系统通知（见第 5 条第 1 点，这是票面「触发失败的系统通知」实际对应的那条路）。
- 胶囊（票 104）：`lib/todo-button.ts:78` 的 `first.item.text` 来自 `todoFirstRow(yours)`，只有你的待办，不受影响，确认过。
- 没改：`hooks/useSchedulerSignals.ts` 的 `scheduled-tasks:fire-failed` 通知照旧给全文，只在注释里写明为什么；外置运行时的 `ScheduledTasksDialog.tsx` 不动。

设计文档 `docs/design/conversation.md`：「提醒卡片」的形态一条改成「原文的第一行（……被截断时悬停给这一行的全文）」，加一条「只显示第一行」（写了为什么、旧提醒照旧显示整段、代价、外置与新开会话任务的通知不变），「那句话打开面板」注明是原文第一行；「待办面板」的「Galley 在办」加一句它的提醒（含「例行」「已完成」）标题只取第一行、悬停也只给这一行，「例行」的标题、「说说这件」的引用同样注明。都注「2026-10-28，票 105，裁决 151」。

**3. 评测**

开跑前只读查过（`mode=ro&immutable=1`）：`mm_1792576875658` 在 `managed_models` 里，`model` 是 `gpt-6.1-sol`，服务商 `auth_kind` 是 `api_key`。

第一行的判定（`run.py` 的 `first_line_problems` / `first_line_checks`，规则与理由写在 `schedule/cases.json` 的 `_note` 与 README「第一行写给用户看（票 105）」一节）：对假 CLI 日志里每一次 `schedule create` 与 `schedule update --prompt`（被拒的也算），取第一行（同 GUI 的规则），不含「用户」「JC」（关于用户的记录，不是给用户的标题）、不以「提醒」开头（卡片本来就是提醒）、不含时间或日子（数字加「点」「时」「号」「日」「月」或冒号，中文数字加「点」「号」但不算单独的「一点」，「今天」「明天」「今晚」「明早」等，「早上」「上午」「下午」「晚上」等，「周X」「星期X」「下周」「月底」等，「N 分钟后」「N 小时后」；卡片旁边已经写着时间）、不超过 20 个字（按字符数）；原文里是字面的 `\n` 也不过（GUI 会把它连同后面的字一起显示）。不过的进 `pass`，另留 `pass_before_105` 只按原有判定。原有判定一条没改。判定代码的自测在 `--dry-test` 的 `dry_test_first_line`。

叫醒三条用例预先放着的任务原文改成新写法（内容不变）：`wake-on-time`「收好行李，带上身份证」+ 空行 + 原来那段高铁的话；`wake-late`「给王经理回电话」+ 空行 +「确认下周合同签约的时间。」；`wake-obsolete`「去菜鸟驿站取快递」+ 空行 +「取件码 8-3-2041。」。结果文件里写在 `RERUN_INTROS["105"]`、「注 9」与 README。

两遍的结果（全套 14 条各两遍，14:45 开跑；与票 73 同用例对照，票 73 的运行用现在的判定重判）：

| | 票 73 | 票 105 |
| --- | --- | --- |
| 原有判定 | 28/28 | 28/28（补跑 1 次） |
| 第一行 | 0/6 | 6/6 |
| 加上第一行的总判定 | 22/28 | 28/28 |
| 请求次数（均） | 3.11 | 3.07 |
| 读手册字节（均） | 9225 | 9871 |

每一次 `schedule create` 的第一行（这一次没有一次 `schedule update --prompt`；`move-time` 两遍都只 `--at`）：

- `logistics-mon` 第 1 遍：「查看京东显示器物流」，后面空一行：「用户在京东购买了一台显示器，运单号 JD8812345678，商家说下周一前能到。用户明确要求下周一帮忙查看物流。请查询该运单最新物流和是否送达，并在主聊天告知用户；使用真实浏览器查询，不猜测状态。如需要登录或验证，明确告诉用户所需操作。主聊天 session：s-mgn4k2x1-7q3z9w0e。」
- `logistics-mon` 第 2 遍：「查看京东显示器物流」，后面空一行：「京东购买的显示器，物流单号 JD8812345678，承诺2026年11月2日（下周一）前送达。届时通过浏览器查询最新物流和签收状态，并在主聊天 s-mgn4k2x1-7q3z9w0e 告知用户。……不编造状态。」
- `water-10min` 两遍：「该喝水了」（只有这一行）。
- `stove-30min` 两遍：「关火」（只有这一行）。

两条带后面的话的都用 Python `subprocess` 传参，是真换行，假 CLI 存下的原文带着断行；没出现字面的 `\n`。票 73 的 6 条全不过（「提醒用户喝水：用户在主聊天中要求十分钟后提醒喝水……」「提醒用户：时间到了，请关火……」「查询京东显示器物流：用户在京东买了一台显示器……」，最长 169 字）。

原有判定没有退步。唯一一次不过是 `wake-on-time` 第 1 遍：排在第 23 个，14:49:55 才开跑，比叫醒消息写的到点时刻 14:45 晚了约 4 分钟，它看了钟、照实说「这条提醒晚了约 5 分钟」，判成「不该说：晚了」。这是票 64、73 都见过的排队晚到，照惯例只补跑这一条一遍（`--cases wake-on-time --repeats 1 --first-repeat 1 --supersede "票 105 补跑：…"`），过；被替换的那次在 `meta.superseded_runs[9]`（「注 10」）。叫醒那一侧在新写法下：按时的两遍都照第一行和后面的话说了此刻有用的，没复述第一行；晚了 9 小时的两遍都先说晚了 9 小时；已取快递的两遍都只回 `<no-reply/>`。整组被替换的票 73 结果在 `meta.superseded_runs[8]`（「注 9」）。

用量：29 次运行（保留 28 次，替换 1 次），89 次模型调用；`--dry-test` 不连模型。没有超出授权的整组重跑。

**4. 验证（原样）**

- `pnpm --dir gui typecheck`：`> tsc --noEmit`，无输出、退出 0。
- `pnpm --dir gui lint`：`> eslint src --max-warnings 0`，无输出、退出 0。
- `pnpm --dir gui test`（本地时区）：`Test Files  229 passed (229)`、`Tests  2534 passed (2534)`。
- `TZ=UTC pnpm --dir gui test`：`Test Files  229 passed (229)`、`Tests  2534 passed (2534)`。
- `TZ=America/Los_Angeles pnpm --dir gui test`：`Test Files  229 passed (229)`、`Tests  2534 passed (2534)`。
- `git diff --check main..HEAD`：无输出；`git status` 干净，worktree 里（除了从主树克隆来的 gitignored `core/python-bundle` 自带的 pip 缓存）没有 `__pycache__`，`managed-ga/` 下没有。
- 反向检查 1（`reminderFirstLine` 改成直接 `return prompt.trim()`，先备份到 scratchpad，跑完用 `cp` 还原）：`Test Files  8 failed (8)`、`Tests  12 failed | 159 passed (171)`，红的是 `reminder-first-line.test.ts` 4 条、`ReminderCards.test.tsx` 1 条、`ReminderCards.hover.test.tsx` 2 条、`reminder-notify.test.ts` 1 条、`todo-open.test.ts` 1 条、`todo-panel.test.ts` 1 条、`TodoPanel.test.tsx` 1 条、`TodoPanel.click.test.tsx` 1 条；还原后 `git diff --stat` 为空、全绿。
- 反向检查 2（卡片两处悬停改回 `task.prompt`，同样备份与 `cp` 还原）：`Test Files  1 failed | 30 passed (31)`、`Tests  2 failed | 239 passed (241)`，红的是 `ReminderCards.hover.test.tsx` 两条（字与按钮两支）；还原后全绿。
- `--dry-test`：`DRY TEST PASSED`，691 条 PASS、0 条 FAIL。票 105 加的几条原样：`PASS first line passes: '给妈妈打电话\n\n用户周五说的，周日晚上 9 点打。' -> '给妈妈打电话' []`、`PASS first line fails: '明天下午 4 点给妈妈打电话' -> ['有时间或日子：「明天」、「下午」、「4 点」']`、`PASS first line fails: '该喝水了\\n\\n到时简短提醒' -> ['原文里是字面的「\\n」，不是换行']`、`PASS first_line_checks: creates and updates with --prompt, not a help page or a new time alone ([('schedule create', '该喝水了', True, True), ('schedule update', '明天 9 点转房租', False, False), ('schedule update', '转房租', False, True)])`、`PASS sched_facts: the earlier rules pass, the first line fails (['schedule create 的第一行「提醒用户十分钟后喝水」：写了「用户」，以「提醒」开头，有时间或日子：「分钟后」'])`、`PASS the wake cases' words are in the new form, handed over whole as Core does`、`PASS words in the new form: stored with their breaks, the first line passes (…'first_line': '关火', 'notes': True, …)`、`PASS the first-line judge reads each create from the log (…)`（另 12 条过与不过的字表全 PASS）。
- 真跑：`28 runs, model gpt-6.1-sol, parallel 3`，28 次都 `ok`，`failed: none`（这是运行状态）；判定见第 3 条与 `schedule/results.md` 的通过率表（补跑后 28/28）。补跑：`1 runs, model gpt-6.1-sol, parallel 3`、`[1/1] wake-on-time r1: ok 20.94s calls=2`。
- Core（见第 5 条第 2 点，worktree 里用从主树克隆的 target）：`cargo test --manifest-path core/Cargo.toml -p galley-core --lib assistant_manual`：`test result: ok. 12 passed; 0 failed`；加上 `managed_prompt`：`test result: ok. 57 passed; 0 failed`。
- 中文全角标点：scratchpad 的 `t105-cjk-punct.py` 扫 `main..HEAD` 新增行（设计文档、评测 README、`cases.json` 按中文扫，手册按英文文档只扫「」里的中文）：`added lines scanned: 61, lines with half-width punctuation in Chinese: 0`；这条回报写完后同样扫过。
- 结果文件只写了模型 id 与「API key 接入」；扫过 `results.json`、`results.md`、`composed/`、README 的本次改动：没有服务商名、接口地址、本机路径（`composed/` 里的 `github.com/wangjc683/galley` 与 `example.com` 是提示词原有的）。

**5. 票面与代码不符的地方、我自己定的边界、看到没改的、没验证到的**

票面与代码不符：

1. **「触发失败的系统通知（`scheduled-tasks:fire-failed`）」指错了事件**：Core 只在 `scheduler::fire` 里发它（`core/src/scheduler.rs:921-931`），而 `fire` 只处理 `target = session` 的任务（`scheduler.rs:245`、`:660`），也就是外置运行时表单建的或别的 agent 建的新开会话任务，它自己的提醒（`target = assistant`）从不走这条。它的提醒叫不醒它时走的是 `scheduled-tasks:reminder-undelivered`（`core/src/subtask_report.rs:1652-1682`），GUI 在 `lib/reminder-notify.ts` 发系统通知或提示条。我按票面的意图改了后者（第一行），前者照旧给全文，只在 `useSchedulerSignals.ts` 的注释里写明原因；改前者会让外置运行时用户自己写的多行任务在通知里只剩第一行，违反「外置运行时零变化」。
2. **「不改 Core」与手册改写有冲突**：`core/src/assistant_manual.rs` 用 `include_str!` 把手册编进 Core，它的测试逐字钉着 `reminders.md` 的两段：`schedule create "<your words>" …` 那一行（`:389-392`）和「Write the words for yourself at that moment, when this conversation may」（`:453`）。照票面整句换掉，`cargo test` 会红。我没动 `core/`，把这两段原样留在新写法里（「Write the words for yourself…」现在说的是空行之后那部分），在 worktree 跑了 Core 的 `assistant_manual` 与 `managed_prompt` 测试，全过。以后要换措辞得同时改那个测试。

我自己定的边界：

1. **面板里所有 `kind: task` 的行都取第一行**，不只是它自己建的：外置运行时表单建的任务、别的 agent 建的任务在内置运行时的面板里出现时（Core 的清单两种 target 都列），标题也只剩第一行，悬停也不再给后面的。一条规则，判定不看创建者。
2. **提醒叫不醒它时的提示条与通知只给第一行**（见上第 1 条）：后面写给它自己的话（名字、号码）这时你也看不到。
3. **`quoteTodo` 的默认值**也改成第一行，免得以后有人不传标题时把备注引进输入框。
4. **判定数的是日志里每一次命令**（被拒的也算），同一个原文被拒后重试会数两次；这次没有发生。中文数字加「点」不算单独的「一点」；「早上」「下午」等时段词算时间；20 个字按 Python 的字符数；字面的 `\n` 是我加的一条（票面没写）。
5. **只改了三条叫醒用例的原文**；`already-set`、`no-need`、`move-time` 预先放着的任务照旧是旧写法，正好是库里旧提醒的样子。
6. **手册多了一句**「in a shell, `\n` inside quotes stays two characters」（票面没写）：shell 双引号里的 `\n` 不是换行，GUI 会整段显示；这次两次多行都走 Python，没撞到。
7. **旧的重跑表**（票 59、60、63、73）照旧按各自当时的判定比（`sched_facts_before_105`），逐字没变（重出前后比过）；只有通过率表与一览用加上第一行的判定。
8. **设计文档**多写了一句提醒叫不醒它时的通知与提示条、外置对话框与新开会话任务的通知不变。

看到没改的：

1. `schedule/results.md` 开头那句「即 JC 主对话现在用的模型」是旧文：主对话用的是 ChatGPT 登录的 gpt-6.1-sol 条目，评测用的是 API key 接入的同一个模型。
2. Core 的「In Hand」把原文压成一行（`managed_prompt.rs` 的 `in_hand_cut`），新写法下第一行和备注接在一起出现在它眼前，读起来不影响，没改（Core）。
3. Core 的叫醒说明里的 `(not your words read back)`：第一行现在本来就是写给用户的话，照念也不算错；这次叫醒用例没有照念，没改（Core）。

没验证到的：

1. 真机（票面两步）没走；没跑 `tauri dev`，卡片、面板、提示条与系统通知的样子只在测试里看过。卡片的悬停测试是 jsdom 里手设 `scrollWidth` / `clientWidth` 模拟截断，真窗口（WKWebView）没看。
2. Core 只跑了 `assistant_manual`、`managed_prompt` 两个模块（57 条），没跑全量 `cargo test --workspace`；target 是从主树 APFS 克隆的（`cp -cR`，只读主树）。
3. `schedule update --prompt` 在真跑里一次都没出现，它的第一行只有 `--dry-test` 的合成数据测过。
4. 待办、叫醒、闲聊、备忘四套没在新手册下重跑（它们也会读 `reminders.md`）。
5. 判定的时间词表是写死的：「过两天」「年底」「节后」「晚点」这类判不出来；英文第一行没有用例，时间判定只认中文。
6. Windows 上它怎么把换行传给 CLI（PowerShell / cmd）没测，手册那句提示是按 POSIX shell 写的。
7. 库里已有的旧提醒照旧显示整段，直到响过（裁决 151 第 4 条的代价，按票面不改）。
