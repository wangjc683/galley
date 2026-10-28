# 107 待办能打开：点一行在原地打开，标题与备注全文、就地改

Status: needs-dogfood（2026-10-28 JC 看过「文字稿」：「没问题，开始做」。2026-10-28 快进合入 `c5443ecd`–`f61032a4`；主会话机器验收：读过 `update_todo` 命令与 `TodoPatch::words`、手册两处（`--notes` 那句与「用户能做的」那句的事实同步）、`YourRow` 的编辑流程与 `TodoTextEditor`、设计文档新增各段；在 worktree 重跑 `pnpm --dir gui typecheck`、`lint`、`git diff --check`、文档链接全过，`test` 本地与 `TZ=UTC` 各 229 个文件、2553 条全过，`cargo test --workspace` 1257 条全过；主会话补设计文档「待办面板」开头的总述（`f61032a4`）。代理查出票面前提错：待办命令的 TS 封装与 `TodoBrief` 镜像在 `gui/src/lib/assistant-todo.ts`，`gui/src/types/ipc.ts` 只镜像 runner 协议。面板的 `bg-selected` 是全局值 #f8edda，配面板的 `bg-app`；侧栏的 #e7d8c0 是侧栏底色上的覆盖，不用跟。真机六步待 JC）

来源：[主聊天 PRD](../PRD.md) 裁决 153（2026-10-28，JC：「按你推荐推进」）。改写裁决 91 第 3、4 条与裁决 128 第 5 条的「悬停看全文」。Core 一条桌面命令、GUI、手册一句、设计文档。只在内置运行时；外置运行时没有主对话与待办，零变化。

## 为什么

- 备注只画一行、截断，看全文只有系统悬停提示（`gui/src/components/todo/TodoPanel.tsx` 的 `NotesLine`，`gui/src/lib/truncated-title.ts`）。面板 320px，备注那一行 258px，一行约 21 字；库里 2 条备注 43、48 字，全被截。
- 面板只有列表一层，没有能打开一件事的地方；将来挂在一件事下面的子任务与进展（deferred「待办上的进展」）也要这个地方。
- 改一个字，在对话里要先说清改哪、改成什么，再等它回；就地改是选中、删、回车。改文字不需要判断（裁决 91 第 3 条的尺子）。时间要判断（提醒的提前量），仍靠说。

## 文字稿（待 JC 看）

只管「你的事」里没做完的待办（最上面那一段）。已完成、Galley 在办、例行不变：它们的标题照旧点了跳到那句话或那个会话。

### 收起

- 样子不变：方框、标题一行、时间那一行、备注一行；悬停的「说说这件」「⋯」、时间那一行末尾的「取消提醒」照旧；截断时的悬停提示照旧（只想瞄一眼的人还用得上）。
- 变的是点：点这一行任何地方（方框、悬停按钮、「取消提醒」以外）就打开它。标题不再是跳转按钮，悬停不再画下划线；整行的悬停底色照旧。
- 键盘：标题仍是能聚焦的按钮，回车或空格打开（`aria-expanded`）。

### 打开

- 一次只开一件：点别的行，前一件收起、那一件打开。收起：按 Esc（焦点不在编辑框时）、点面板里这一件以外的空白处、点它自己的空白处、关面板。开过哪件不记：关了面板再开，全收起。
- 底色铺 `bg-selected`（同侧栏选中的会话行），不加边框与阴影；不加展开动效（真机看了要加再说）。打开后超出视野的，滚到刚好看全。
- 从上到下：
  1. **方框 + 标题**：标题全文换行，不截。悬停时文本光标，点了就地改（见下「改」）。
  2. **时间那一行**：写法同收起。打开后它是按钮，悬停提示「改时间跟 Galley 说」，点了同「说说这件」（标题引用进 Galley 的输入框，光标落进去，面板不关）。末尾的「取消提醒」照旧。没有时间的不画。
  3. **备注**：全文换行，保留原来的换行（收起时才压成一行），12px `ink-muted` 不变（裁决 146）。点了就地改。没有备注时画一行「添加备注」（同样 12px `ink-muted`），点了就是加。
  4. **最下面一行**：12px `ink-muted`「10月28日记下 · 在对话里查看」。日子写法同时间那一行（今天、昨天、几月几日）。「在对话里查看」是链接样子（同开机自启提示里那颗按钮：`ink-soft`、下划线 `ink-muted/60`），点了做原来点标题做的事（`lib/todo-open.ts` 的 `goToTodoTarget`：定位那句、面板跟过去）。没有挂处的（不在回复里建的、外部 agent 建的、重置之前的）只写「10月28日记下」。
- 「说说这件」「⋯」打开时一直显示在标题那一行右端（同菜单开着时），标题照旧让出宽度。
- 「⋯」菜单与右键（收起、打开都一样）：说说这件、在对话里查看（有挂处时）、取消提醒（有还会响的提醒时）── 删除。
- 从回复下待办卡片的标题点进来（裁决 131 第 3 条：打开面板、定位、亮一下），那一行同时打开。
- 打开着的这件被勾掉（你勾的停留 1.5 秒后、Galley 勾的）、被删、离开清单：收起。

### 改（标题、备注）

- **标题**：点了变成输入框，字的位置与字号不动，外面出现输入框的焦点圈，光标落在点的位置（做不到就落在末尾）。回车保存，Esc 放弃，点到别处保存。不能换行。清空了保存等于放弃：标题不能为空，不要了用「删除」。
- **备注**：点了变成多行输入框，随字长高。回车换行，⌘回车保存，Esc 放弃，点到别处保存。清空了保存等于去掉备注。
- 没有保存、取消按钮。字没变不写。
- 保存直接交给 Core，不确认、不停留。失败时输入框留着你写的字，下面写原因（同勾的失败那套：「没能完成，再试一次。」「这件事已经不在了。」），可以再存，Esc 放弃回到原来的字。
- 自己改的不亮（算进 `todoWritesOnTheirWay`，同勾与删）。回复下的卡片跟着变（卡片按这件事现在的样子画）；提醒到点时 Galley 收到的是改后的标题与备注（`core/src/subtask_report.rs:225`）。Galley 不另外收到通知，同勾掉：它回答前读最新清单。
- 正在改时 Galley 改了同一件：输入框里的字不被冲掉；你保存时整段写入，后写的为准。
- Esc 的顺序：在编辑框里先放弃编辑；再按收起这一件；再按关面板。

### 不做

- 时间就地改（裁决 153 第 5 条，T2）；已完成、Galley 在办、例行的打开；子任务挂在待办下面（deferred「待办上的进展」，打开后的那一块是它将来的位置）；记谁改的（`todos` 表没有 `updated_via`，要用再加）。

## 现状（读码起点）

- 面板：`gui/src/components/todo/TodoPanel.tsx` 的 `RowShell`（标题按钮、悬停按钮、菜单开着时的样子）、`YourRow`、`MetaLine`、`NotesLine`；Esc 关面板在 `TodoPanel` 的 keydown（焦点在输入框时已经让开）。
- 菜单：`gui/src/components/todo/TodoRowMenu.tsx`。
- 跳转与卡片点进来：`gui/src/lib/todo-open.ts`（`goToTodoTarget`、`showTodoRow`），亮一下在 `gui/src/hooks/useTodoPanelFlash.ts`。
- 写与失败：`gui/src/stores/assistant-todo.ts`（`flips`、`failures`、`cancelling`、`todoWritesOnTheirWay`）。
- Core：`TodoPatch`（`core/src/api/todo.rs:322`）、更新（`core/src/db/todo.rs` 约 468–487 行）、桌面命令（`core/src/commands/schedule.rs:194–241` 的 `complete_todo` 等），IPC 类型镜像在 `gui/src/types/ipc.ts`。
- 手册：`docs/managed-ga-runtime/galley-assistant-manual/todos.md` 约 110–116 行（`--notes`）。
- 设计文档：`docs/design/conversation.md`「待办面板」一节（「点标题」「不写记下的日子」「备注」「动作只有这几个」里的「没有编辑、拖动排序、新建」「悬停的按钮」）。

## 要做的

1. **Core**：桌面命令 `update_todo`，只收标题与备注两项（复用 `TodoPatch` 与 db 的更新，时间与提醒不收），发清单变化的事件（同 `complete_todo`）；进 `gui/src/types/ipc.ts`。Agent API 与 CLI 不动。
2. **GUI**：照「文字稿」做打开、改、菜单项、卡片点进来打开；文案进 `zh.ts` 与 `en.ts`。
3. **手册**：`--notes` 那段加一句：用户可能在面板里改过标题与备注；改之前先读现在的，在上面改，别盖掉。不收紧它写什么（裁决 153 第 6 条）。
4. **设计文档**：`conversation.md`「待办面板」改「点标题」「不写记下的日子」两处，加「打开一件」「改标题与备注」，「没有编辑、拖动排序、新建」改成「没有拖动排序、新建；时间不在面板改」；备注一节补「打开后全文」。都注「2026-10-28，票 107，裁决 153」。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。Rust 用克隆的 target（`cp -cR`），记得补 sidecar 占位文件、python-bundle 与 gen。
- 收起时的样子、行高、三档墨（裁决 130、146）；已完成、Galley 在办、例行；顶栏按钮、飞入、自动开一次；备忘页。
- Agent API、CLI、提示词；外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk；`core/` 不是 rustfmt-clean，只 `rustfmt --check` 你动过的文件。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 107, PRD ruling 153」）。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t107-` 前缀。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`（含 `assistant_manual` 的预算测试）
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- 测试覆盖：点行打开与收起、一次一件、Esc 三步的顺序、标题与备注的键（回车、⌘回车、Esc、失焦、清空）、字没变不写、失败留字、卡片点进来打开、没有挂处只写日子、打开的那件被勾或被删后收起
- 反向检查：把「一次一件」「清空标题等于放弃」「Esc 先放弃编辑」各改坏一处，对应测试要红，改回全绿
- 手册与设计文档新增行中文全角标点（自写正则扫，脚本放 scratchpad、文件名带 `t107-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 新命令的签名、改了哪些组件、设计文档改了哪几段（file:line）、手册那一句原文。
3. 验证命令与结果原样（含两个时区、反向检查）。
4. 票面没写到、你自己定的边界；看到但没改的问题，没验证到的（逐条）。

## 给 JC 的真机步骤

合入前主会话看 `busy:0`；合入后 Core 会重编重启（改了 `core/`），手册等主对话 runner 下次启动才写进状态根。

1. 打开待办面板，点希尔顿那一行：5 条收集要点全文，最下面「10月28日记下 · 在对话里查看」。
2. 点备注，删掉一个字，点别处：存上；关面板再开，还是改后的。
3. 点标题改一个字，回车。
4. 点 702 的时间那一行：标题引用进 Galley 的输入框。
5. 点「在对话里查看」：跳到记下它的那句。
6. 点回复下某张待办卡片的标题：面板里那一行亮一下并打开。

## Comments
