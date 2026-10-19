# 43 待办卡片长留、行上写「记下」的日子

Status: needs-dogfood（2026-10-17 快进合入 main，提交 `7b57b8c9`、`e82428e1`；真机随票 42 一起验）

来源：票 42 回报第 4、5 条（2026-10-17）。票 42 的票面要求行下小字写「10-16 记下」、待办卡片挂在记下它的那条回复下面；因为票 39 的查询少两样东西，没做全。这张票补齐，不新增裁决。改 Core（只加字段、加一个只读命令）与 GUI。

## 缺什么

- 票 39 查询给界面的待办条目（`TodoItem`）不带记下的时刻，所以面板上没有「记下」那行小字。
- 卡片和面板读的是同一份查询，只有没做完的、7 天内做完的才在里面。做完超过 7 天、被 Galley 取消的待办，回复下面的卡片就消失了。挂在一条回复下面的东西不该过一阵自己没了。

## 要做

- **Core**：
  - `TodoItem` 加 `createdAt`，只加不改。
  - 加一个给界面的只读 Tauri 命令，读主对话里记下的全部待办（含做完、取消），带状态与建在哪一轮，供卡片用。命令名和形状你定，可以包票 40 的 `assistant_todo::todo_list(galley, all)`。镜像进 `gui/src/types/ipc.ts`。
- **GUI**：
  - 面板「你的事」每行的小字加记下的日子，写法照现有的消息时刻格式（`lib/message-time.ts`）。
  - 卡片改读新命令，三种状态：
    - 没做：照现在；
    - 做完：不论多久以前都照面板「已完成」的样子，能取消勾；
    - 取消：方框不能点，标题淡化，旁边写「已取消」。
  - 同一条回复里记了几件时，按记下的先后排。
  - 变化事件照旧刷新。
- 外置运行时零变化。

## 验收

- Rust 测试：`createdAt` 有值；新命令列出做完、取消的待办，不出外置。
- gui 测试：小字里记下的日子（今天与跨午夜）；卡片三种状态；做完超过 7 天仍在；取消的不能勾；同一条回复按先后排。
- `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区、`TZ=UTC`），gui typecheck、lint、全量测试两遍（本机时区、`TZ=UTC`），六个门禁，`git diff --check`，中文标点扫新增行。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-todo-cards`）

**改了哪些文件**

- Core：`core/src/assistant_todo.rs`（`TodoItem` 加 `createdAt`、`cancelledAt`；新函数 `noted_todos` 与纯函数 `noted_items`；单测加 1 条、改 1 条）、`core/src/commands/schedule.rs` 与 `core/src/lib.rs`（Tauri 命令 `list_noted_todos`）、`core/tests/todo_test.rs`（加 1 条）、`core/src/managed_prompt.rs`（只在测试里的 `TodoItem` 字面量补两个 `None`，见下）。
- GUI：`lib/assistant-todo.ts`（两个字段、`listNotedTodos`）、`lib/message-time.ts`（`formatMessageDay`）、`lib/todo-panel.ts`（`todoCancelled`；`todoChecked` 对取消的一律不勾；`todoMetaParts` 加 `{ noted }`；`todosByMessage` 改吃待办数组、按记下的先后；删掉 `allTodos` 与按截止排的 `dueOrder`）、`stores/assistant-todo.ts`（`noted`，与清单一起读；`toggle` 不理取消的）、`hooks/useTodoCards.ts`（读 `noted`）、`components/conversation/TodoCards.tsx`（三种样子、`data-todo-state`）、`components/todo/TodoCheck.tsx`（取消的方框禁用）、`todo-styles.ts`（取消的标题）、`TodoPanel.tsx`（你的事每行带记下的日子）、`zh.ts` / `en.ts`（三条）。
- 测试：`lib/todo-panel.test.ts`、`stores/assistant-todo.test.ts`、`components/todo/TodoPanel.test.tsx`（改与加）。
- 文档：`docs/design/conversation.md`（待办卡片的「从哪来」「三种样子」「看得见多久」，面板「你的事」的小字与「取消提醒」的位置）、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（`createdAt`，卡片读的第二个只读命令）。

**票面留给我定的**

1. **命令名与形状**：`list_noted_todos`，没有参数，返回 `TodoItem[]`：和 `list_assistant_todo` 同一种条目，由同一个 `todo_item` 写出，逾期在 Core 读的那一刻算；只含 `createdIn` 在当前主对话的待办（`turnIndex` 还没填的也给，界面等它填了再挂），按记下的先后（`createdAt`，同一秒按 id，同 `list_todos` 的 SQL 顺序）。外置运行时、还没有主对话时返回空数组，由 Core 判（Rule 5）；界面在外置下本来就不读。没有包 `todo_list(galley, all)`：它给的是 `TodoBrief`，不带 `overdue`（票 40 有意不加），卡片上「逾期 · 今天 15:00」就得在界面拿钟点算（渲染期不许取 `Date.now()`），写法也会和面板分叉。
2. **取消怎么带**：`TodoItem` 加 `cancelledAt`（只加），`state` 是取消时的样子（open，或取消前勾过的 done），`at` 同理；取消的不算逾期。没有加 `TodoState::Cancelled`：`managed_prompt.rs` 的 In Hand 有一处穷举 `TodoState` 的 `match`，加变体就要改那段格式化代码，而这个状态只在卡片这一处出现。界面只在 `todoCancelled(item)` 一处判断。
3. **「记下」的写法**：新函数 `formatMessageDay`（消息时刻的形状去掉钟点）：今天、昨天、`10月16日`、别的年份 `2025年10月16日`；英文 today、yesterday、`Oct 16`、`Oct 16, 2025`。文案 `${day} 记下` / `Noted ${day}`，空格照票 42 票面的「10-16 记下」。没用 `formatScheduleDay`：它 2–6 天写星期几，是排期的写法，不是消息时刻的。过了零点跟着 `useDayStamp` 变成「昨天」，不等重读。
4. **取消的卡片**：方框留着，用 `ui/checkbox.tsx` 的禁用样子（降到 40%、`cursor-not-allowed`），不勾（取消前勾过的也不勾）；标题 `ink-muted`、不划线（没做，只是不要了）；右边截止与提醒的位置只写「已取消」（12px `ink-muted`，复用提醒卡片的 `stateCancelled`）；不跟 C 档淡化。
5. **做完的卡片**：照旧 `todoMetaParts`（截止照写、不算逾期、不写提醒），淡化跟 C 档（C2 整张 60%），能取消勾（`reopen_todo`，同一套停留）。

**与票面不同、或我加的**

1. **「记下」放在小字最后**（截止 · 提醒 · 记下，即票 42 票面列的次序）。我先做的是「截止 · 记下 · 提醒」（好让「取消提醒」紧贴提醒），截图一看：面板默认 320px 下「截止 周三 15:00 · 提醒 周三 14:00 · 今天 记下」放不下，悬停时右边再让出「说说这件」更窄，记下的日子在中间就把提醒挤进省略号。放到最后，省略号先吃掉最不要紧的那段。代价两条，要真机看：「取消提醒」不再紧贴提醒文字，而在这一行末尾、记下的日子后面（仍在提醒那一行、在省略号之外，不和行尾的「说说这件」并排）；同时有截止与提醒的行在 320px 下记下的日子常被截成「今天…」，B2 的 380px 放得下。
2. **卡片上不写「记下」**：卡片挂在记下它的那条回复下面，回复本身就是那一天。
3. **镜像的位置**：命令与两个字段镜像在 `gui/src/lib/assistant-todo.ts`（另外三个待办命令与 `list_assistant_todo` 都在这里），没有进 `gui/src/types/ipc.ts`：那是 runner 协议（bridge ↔ Core）的镜像，IPC 漂移门禁比的是 `runner/ipc.py`、`core/src/ipc.rs` 与它三方，Tauri 命令不在其中，往里加 `…Command` 接口反而会被当成 runner 命令报漂移。
4. **两份一起读**：store 用 `Promise.all` 同时读清单与 `noted`，一份失败就两份都不换（同一刻的样子）；勾的停留（`flips`）本来就按 id 存在同一个 store，卡片和面板照旧同步。
5. **动了 `managed_prompt.rs`**：只在测试 `item()` 的 `TodoItem` 字面量补 `created_at: None`、`cancelled_at: None` 两行（加字段不补就编不过）；提示词与格式化代码一字未动，In Hand 的测试原样通过。变基到票 41 之后没有冲突。

**验证**（分支开在 `0ab8e009`；交回报前 main 合入了票 41（`6a5d5358`），已变基，没有冲突，下面是变基后重跑的结果）

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `galley-relay` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区与 `TZ=UTC` 各一遍，都是 45 组 `test result: ok`，合计 1127 passed、0 failed。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：exit 0。vitest 全量本机时区与 `TZ=UTC` 各一遍，都是 `Test Files 164 passed`、`Tests 1712 passed`（票 42 合入时 1698）；`src/lib`、`src/components/todo`、`src/stores`、`src/components/conversation` 另在 `TZ=America/Los_Angeles` 跑一遍，125 个文件 1382 条全过。
- 六个门禁 exit 0：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check main` 无输出。
- 新增行 grep 域名、`http`、`api_host`、`apibase`、`/Users/`、`/private/tmp`、`/var/folders`：0 处。
- 中文标点扫新增行（自写脚本，先用坏例子自测）：中文句子 0 处；1 处是测试代码 `toEqual([...])` 里的中文字符串，25 处是英文注释或代码里夹中文词，用英文标点，不改。
- 格式：`rustfmt --check` 下 `assistant_todo.rs`、`todo_test.rs`、`commands/schedule.rs`、`managed_prompt.rs` 整篇干净；`lib.rs` 原本不干净，我的 hunk 不在差异里。prettier：原本干净的 12 个 gui 文件整篇干净；`zh.ts`、`en.ts` 差异条数与开工时相同（13、40）。
- 反向检查都挂（每处改完跑对应测试，再按 sha256 还原）：Rust 3 处（不判运行时、不按主对话过滤、取消的也算逾期）；gui 13 处（卡片按截止排、同一秒不按 id、取消的方框能点、取消前勾过的显示勾着、store 去勾取消的、取消的标题划线、取消的卡片还写截止、卡片也写记下、面板不写记下、记下放到提醒前面、读时不读 `noted`、记下用排期写法带星期、做完的卡片不跟 C 档）。
- 看界面：临时 Vite（5198 端口，不碰 Tauri）+ headless Chrome，跑真的 `TodoCards` 与 `TodoPanel`（320px）：浅色、深色、英文、C2；三张卡片（没做、30 天前做完、取消）与面板四行（「10月14日 记下」「今天 记下」「昨天 记下」「2025年12月30日 记下」）；点取消的方框不变，点 30 天前做完的那张进入取消勾的停留；悬停「交季度报告」那一行：提醒完整、记下的日子被截、「取消提醒」在。截图在会话草稿目录 `t43-harness/shots/`，不进仓库。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：真的 Core 下记一件、让 Galley 取消一件、把一件的勾放到 7 天以前看卡片还在；开着过零点。
- 外置零变化没有像票 42 那样做 sha256 对比：外置下 App 不挂 `useAssistantTodoSync`（没有主对话），MainView 不画待办卡片，面板不出现，本票改的组件在外置下都不渲染；Core 的新命令在外置下返回空（有测试）。
- Windows。
