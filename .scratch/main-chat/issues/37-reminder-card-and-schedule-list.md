# 37 界面：提醒卡片、「待办」、送不出去的通知

Status: done（2026-10-19 真机已验卡片、面板、跳回原话、到点进「已完成」、取消提醒、子任务出现在「Galley 在办」；2026-10-16 合入 main，分支提交 `98e5bd8d`、`fa4b0b01`、`5c70b7ff`，合并提交见 git log；真机随票 36 一起验）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 9，主对话 PRD 裁决 84、86（2026-10-16，JC：「这个按钮应该比较容易找到和点击……却成为了助理的 todo 列表」；四点「按你推荐，落票」）。依赖 33（一次性、叫醒、谁建的、建在哪一句、已触发与取消的状态、事件）。改 GUI，另在 Core 加一个给界面与票 36 共用的查询。

## 目标

它建了提醒，你在那条回复下看到一张从库里画的卡片，能一键取消；侧栏顶上一点就是助理的「待办」：接下来要做的、正在办的、最近做完的；叫醒送不出去时有系统通知。外置运行时一切照旧。

## 一、提醒卡片（只在助理的对话里）

- 挂在建它的那条回复下面（票 33 记下的会话与 `turn_index`），位置照子任务卡片（`docs/design/conversation.md:114`：紧贴气泡下 12px，在行动条之前，最宽同气泡上限）；同一条回复建了几个就几张，和子任务卡片同在时先子任务后提醒（或你定、写理由）。
- 形态借子任务卡片（hairline、`rounded-md`、`bg-app`），一行为主：时间（本地；今天、明天、周几加时刻，远的写日期；重复的写规则，如「每天 8:00」）、它记下的话（一行省略）、状态、「取消」。
- 状态：待提醒 / 已提醒（一次性触发后）/ 已取消 / 已暂停（重复的）。取消后卡片留着、写「已取消」（票 33 的软删除）。
- 「取消」一点就取消，不弹确认（只波及这一件）；失败在卡片上写一行原因。取消后不通知它（它下次看「在办的事」会知道）。主对话在跑时照常可点。
- 不做切换器：形态照子任务卡片，JC 真机看；他要比再加。

## 二、「待办」（托管运行时、有主对话时）

### 入口

- 侧栏书眉的第二个图标（今天的 ◷「定时」，`gui/src/components/layout/sidebar/SidebarNavIcons.tsx`），托管运行时换成清单图标（Phosphor，比如 `ListChecks`，同 16px thin），提示与无障碍名「待办」；顺序照旧：搜索 → 待办 → 新建项目。一点打开。
- **不挂数字徽标**（裁决 86 第 3 条；今天 ◷ 的需处理计数在托管下不显示）。外置运行时照旧是 ◷「定时」、徽标与原对话框，一个像素不变。
- ⌘K 里原来打开定时任务的那一项，托管下打开待办（名字与关键词跟着改，含「定时」「提醒」「待办」）。
- 收起侧栏时书眉看不到（今天已知的限制，`docs/design/layout-and-chrome.md:268`），⌘K 可用。

### 取数（Core）

- 加一个查询（Tauri 命令；名字你定），返回三组，**票 36 的「在办的事」用同一个查询**（「接下来」「在办」两组，同一个排序）：
  - **接下来**：没触发、没取消的定时任务（一次性与重复，含你以前用表单建的），按下次触发时刻排；
  - **在办**：主对话派出、还没升级、还没结束的子任务（在跑、在问你、出错、停在步数上限），按最近动静排；
  - **最近做完**：近 7 天触发过的一次性提醒、跑完的重复任务那一次、结束的子任务，按时间倒序；条数上限你定。
- 每项带：类型、时间、一句话（提醒记下的话 / 子任务标题，截断在界面做）、状态、谁建的（助理 / 你用表单 / 外部 agent）、跳转目标（建它的那条回复的会话与 `turn_index`，或子任务的会话 id）。
- 数据变了（定时任务的增删改与触发、子任务的状态）界面跟着刷新：沿用已有事件，不够就补，写清楚。

### 列表

- 沿用现有定时对话框的外壳与尺寸（`ScheduledTasksDialog`），托管下内容换成待办（组件拆开也行：外置照旧用原来那个）。
- 三组：「接下来」「在办」「最近做完」（默认收起，写条数）。空的组不画；全空时一行说明加一个例子（大意「它记下的提醒和派出去的活会出现在这里」「跟它说『明天早上 9 点提醒我开会』」）和「去跟它说」按钮（打开助理、聚焦输入框）。
- 每行：时间（与卡片同一套格式）、一句话（一行省略）、状态；重复的写规则；你用表单建的、外部 agent 建的给一个小标记（文案你写；不分「它自己建的」与「你让它建的」，裁决 86 第 4 条）。
- 动作：
  - 「接下来」：取消（一次性与重复都有）、暂停 / 恢复（重复的）；你用表单建的还能「编辑」，打开原来的表单。
  - 点一行：提醒跳到建它的那条回复（复用查找聊天记录的跳转与高亮，票 28），关掉列表；没有挂处的（表单建的、外部 agent 建的）打开编辑表单或不跳；子任务打开那个子任务（与点子任务卡片同一个动作）。
- 列表顶上一行开机自启提示（复用 scheduled-tasks 票 14 的条件与文案：没设开机自启、没开托盘常驻时才出；大意 Galley 退出后提醒不会响）。
- 托管下没有「新建」表单入口（裁决 84）。

## 三、叫醒

- 票 33 的新报告行在页面上藏起来，规则照票 31（按 supervisor 认）；确认手机端的转发与渲染规则不受影响。
- 送不出去的事件：票 33 已在 `useSchedulerSignals.ts` 加了监听，收到就用原话弹系统通知。这张票补齐：标题写「提醒」或那件事的第一句；窗口在前台、开着助理时照子任务的规矩处理（票 31）；点通知打开助理。
- **定时会话跑完只有一个声音**：托管运行时有主对话时，`target = session` 的定时会话跑完会叫醒助理交代（票 33），会话自己的完成通知就不再发，通知跟着助理的消息走（助手 PRD 裁决 8 对子任务的同一条规矩）。外置运行时照旧由会话自己通知。

## 四、文案与文档

- 新文案进 i18n，中英两版，照 `docs/copy-language-guidelines.md`（「助理」「内核」的用词）。英文「待办」你定（如 To-do / Agenda）。
- `docs/design/layout-and-chrome.md`：书眉一节写托管下第二个图标是「待办」、不挂徽标、外置照旧。
- `docs/design/conversation.md`：助理对话一节加提醒卡片。
- `docs/design/overlays-and-settings.md`（或定时对话框所在的设计文档）：待办的分组、行、动作、空状态、开机自启提示。

## 验收

- typecheck、lint、全量 gui 测试两遍（本机时区与 `TZ=UTC`：时间显示是重点，跨时区的「今天 / 明天」要测）、Core 查询的 Rust 测试、`cargo test --manifest-path core/Cargo.toml --workspace`、`git diff --check`、六个门禁、中文标点扫新增行。
- 测试：卡片各状态；取消调对的命令；工作台与外置不画卡片；书眉托管下是待办、外置是定时（含徽标）；查询三组的成员、排序与 7 天边界；列表分组、空状态、点行的跳转目标、表单建的有编辑。
- 真机（JC）：让它「十分钟后提醒我喝水」，看卡片；点书眉的待办看到它；点那一行跳回原话；取消；派一个子任务，看它出现在「在办」；等提醒到点，看它进「最近做完」。

## Comments

### 2026-10-16 实现回报（子代理，分支 `mc-todo`）

**改了哪些文件**

- Core：`core/src/assistant_todo.rs`（新：查询、纯函数分组、单测 12 条）、`core/src/db/subtask.rs`（`todo_subtask_rows`、`latest_run_last_reply`、`TodoSubtaskRow`、`LastRunReply`）、`core/src/commands/schedule.rs`（Tauri 命令 `list_assistant_todo`）、`core/src/lib.rs`（注册模块与命令）、`core/src/db/mod.rs`（导出）、`core/tests/assistant_todo_test.rs`（新，库上 4 条）。没有迁移、没有新事件、CLI 与 Agent API 不动。
- 界面：`gui/src/lib/assistant-todo.ts`（线上类型镜像、时间与状态文字、点行去哪、能做什么、卡片按回复分组、取消）、`gui/src/lib/message-time.ts`（`formatScheduleTime`）、`gui/src/lib/reminder-notify.ts`（送不出去的提醒）、`gui/src/components/conversation/ReminderCards.tsx`、`gui/src/hooks/useReminderCards.ts`、`gui/src/components/screens/scheduled/TodoDialog.tsx`；`MainView.tsx`（卡片挂在回复下）、`SidebarNavIcons.tsx` / `SidebarHeader.tsx` / `SidebarAssistant.tsx` / `Sidebar.tsx`（书眉第二个图标）、`App.tsx`（入口分流、跳转、去跟它说）、`CommandPalette.tsx`（⌘K 一项）、`useSchedulerSignals.ts`、`ScheduledTasksDialog.tsx`（只把 `TaskForm` 导出，供待办编辑用）、`zh.ts` / `en.ts`。
- 测试：`assistant-todo.test.ts`、`message-time.test.ts`（加一组）、`ReminderCards.test.tsx`、`TodoDialog.test.tsx`、`reminder-notify.test.ts`、`ipc-handlers.scheduled.test.ts`（新），`MainView.assistant.test.tsx`、`CommandPalette.scope.test.tsx`、`Sidebar.main-chat.test.tsx`、`Sidebar.mac.test.tsx`（改与加）。
- 文档：`docs/design/layout-and-chrome.md`（书眉第二个图标）、`docs/design/conversation.md`（新节「提醒卡片」）、`docs/design/overlays-and-settings.md`（新节「待办」、尺寸表、⌘K 动作）、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（新节「The Assistant's To-Do List」）。

**票面留给我定的**

1. **查询**：`crate::assistant_todo::assistant_todo(galley, runners, now) -> AssistantTodo`，Tauri 命令 `list_assistant_todo`（无参数）。票 36 在组 state block 时直接调这个函数（要 `SqliteGalley` 与 `RunnerManager`），不另写一份。形状：`{ upcoming, active, recent, recentOmitted }`，每项 `{ kind: task|subtask, id, text, state, at?, createdBy: assistant|user|agent, agent?, target?, repeat?, timeOfDay?, createdIn?: {sessionId, turnIndex?}, runSessionId? }`；`state` 为 `scheduled / paused / fired / running / asking / failed / step_limit / stopped / done`；时间都是 UTC ISO，本地格式由读的一方做（界面 `formatScheduleTime`，票 36 自己写）。`text` 不截断。
2. **三组的规则**：接下来 = 没取消、还会响的任务（一次性没触发的、重复的），启用的按下次时刻，暂停的排最后（一次性暂停的带原定时刻，重复的暂停的没有 `at`）；已取消的哪一组都不进（卡片照旧写已取消）。在办 = 主对话的子任务，没升级、没归档、没完成；状态先看 Core 的运行闸门（在跑、在问），再看最近一轮最后一条看得见的回复（问你 → 在问你，回答 → 完成），再看这个 Core 进程见到的结束原因（`MAX_TURNS_EXCEEDED` → 停在步数上限，`DONE_WITHOUT_EXIT` 或没能启动 → 出错），都不是就是「没有跑完」。最近做完 = 近 7 天触发过的一次性、重复任务的上一次（一个重复任务可以同时在接下来与最近做完）、完成的子任务，倒序。
3. **7 天与条数**：滚动 7×24 小时（`RECENT_WINDOW_DAYS`），恰好 7 天前算在内、再早一秒不算（单测钉着）。最近做完最多 50 条（`RECENT_LIMIT`），多的数在 `recentOmitted`，列表最后写「还有 N 件没有列出」，组名的条数写总数。
4. **卡片与子任务卡片的次序**：先子任务、后提醒，两组之间 8px（单独时离气泡 12px）。理由：派出去的活是这条回复的主事，回头要做的事是附带的；子任务卡片高、带状态竖条，放前面不会被一排一行高的提醒压住。
5. **图标**：书眉用 Phosphor `ListChecks`（16px thin，行内 14px），卡片用 `Alarm`（14px）。列表行尾动作用 `PencilSimple` / `Pause` / `Play` / `X`。
6. **英文**：待办 To-do，接下来 / 在办 / 最近做完 = Coming up / In progress / Done lately，状态 Set / Scheduled / Paused / Reminded / Ran / Cancelled / Working / Waiting for you / Error / Hit the step limit / Didn't finish / Done，标记 Manual / Agent，去跟它说 Tell Galley，时间 Today / Tomorrow / Yesterday + Intl en-US 时刻。
7. **标记文案**：你用表单建的写「手动」（悬停「你在定时任务表单里建的」），外部 agent 建的写「Agent」（悬停「{名字} 建的」）；它建的与你让它建的不标、不分。
8. **定时会话「只有一个声音」怎么做到的**：查下来**本来就只有一个**。会话的「回复完成 / 在问你」通知只给从这个界面发出的那一轮（`markReplyNotifyPending` 只在输入框发送时打，scheduled-tasks 决策 7），定时任务开的会话从来不自己通知；送不出去时的退路（`subtask-report-undelivered`）只对没升级的子任务补发，定时会话不补。所以没有要关的开关，外置运行时也照旧（照旧不响）。加了 `ipc-handlers.scheduled.test.ts` 钉住：定时会话跑完不发、它的报告送不出去也不发；提醒的叫醒行被藏、对它的回复照「回复完成」通知一次。

**与票面不同、或我加的**

1. **⌘K 里原来没有「定时任务」那一项**（`git log -S` 查过，从没有过）。所以是新加一项「待办」，只在内置运行时有主对话时出现，放在「操作」组第一项，关键词含 待办 / 提醒 / 定时 / 定时任务 / todo；外置运行时 ⌘K 不变。
2. **开机自启提示的条件照票 14 原样**：「没设开机自启、且有一件会响的事」。票面括号里的「没开托盘常驻」票 14 明确不覆盖（用户自己选过、默认开），照它。文案改说提醒：「Galley 未设为开机自动启动，电脑重启后提醒不会响。」；按钮沿用「设为开机自动启动」。原对话框底部那行常显说明在待办里不放。
3. **窗口在前台时补了一个应用内提示**：票 31 的闸门是「窗口在前台就不弹系统通知」，子任务的状态在卡片上看得到，提醒的原话却哪儿都没有（它就是因为没送到才走这条路）。所以前台时弹一个不自动消失的提示条（标题「提醒」、正文原话），后台时才发系统通知。不这样做，主对话在问你时到点的提醒会无声丢掉。
4. **「点通知打开助理」**：桌面的通知插件没有点击回调（`tauri-plugin-notification` 2.3.3 的 desktop 实现只有发送；`onAction` 只在手机端），Galley 现有通知也都不路由（galley#18 记过）。做法是：发系统通知的同时把主区切到助理，点通知把窗口带到前面时看到的就是助理。代价：人不在时主区被换了（侧栏点一下就回去）。标题照票 33 写「提醒」，不取第一句：那句话是写给到点的它自己的，当标题读着怪。
5. **点一行**：最近做完里「到点开新会话」的那一次，点了打开那次产出的会话（原对话框「上次运行」的信任回路）；一次性的表单任务（旧表单表达不了）与外部 agent 建的不跳。提醒跳回原话用查找聊天记录的定位：先 `requestLocate` 再打开会话，分页历史会一页页读到那条为止。
6. **回复被删的卡片**（票 33 的遗留问题 5）：卡片跟着回复一起不见，任务照旧在待办里；点那一行时定位找不到那条，就只打开助理。删除不因提醒卡片置灰（Core 也不拦），区别于子任务卡片。
7. **在办的过期**：不在跑、7 天没有动静的子任务不再列（运行中的不受限）。票面没写；不加的话一个两周前出错、助理早已交代过的子任务会一直挂在在办和「在办的事」里。改上限只动一个常量。
8. **列表行的动作位**：每行都留三个按钮宽的位置，状态在各组之间对成一列（只在悬停时出现的按钮宽窄不一会让状态左右跳）。

**拿不准、要主会话定的**

1. 后台时切到助理（上面第 4 条）是否太主动；另一案是「发通知后下一次窗口回到前台时再切」，更像点了通知才切，但也会把从 Dock 回来的那次算进去（要推断）。
2. 英文的每周规则沿用旧对话框的「Fri 17:00」，和一次性的「Fri 9:00 AM」放在同一列时不易分；改成「Every Fri 17:00」会改动外置运行时旧对话框的英文，这张票没动。
3. Core 重启后，停在步数上限或出错结束的子任务只能读成「没有跑完」（结束原因只在内存）；子任务卡片也是同样的降级。要持久的话得在库里记结束原因，另开票。

**验证**（分支 rebase 到 `cfbcbaca`，票 35 合入之后，没有冲突）

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各一遍，都是 42 组 `test result: ok`，合计 1070 passed、0 failed。本票新增：`assistant_todo` 单测 12 条（排序、暂停排最后、7 天边界正好一秒、手动运行不吃掉一次性、重复任务同时在两组、谁建的、子任务各状态、在办的过期、条数上限）、`assistant_todo_test` 4 条（库上的子任务分组与 7 天、打回后的新一轮不算完成、任务与已取消、没有主对话）。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：exit 0。vitest 全量本机与 `TZ=UTC` 各一遍：`Test Files 158 passed`、`Tests 1649 passed`；另把时间相关的几组（`src/lib`、卡片、待办）在 `TZ=America/Los_Angeles` 跑过一遍，全过。
- 六个门禁：IPC 漂移 aligned（没动 runner 协议）、Supervisor SOP、文档链接 446 个文件、版本 0.6.2、内置 GA 载荷、GA 基线，全过。`git diff --check` 无输出；新增行无私有域名与本机路径。
- 中文标点扫新增行：中文句子 0 处；英文注释里夹中文词的 20 处是英文句子的标点，不改。
- `rustfmt --check`：新文件与 `db/subtask.rs`、`commands/schedule.rs` 干净；`lib.rs`、`db/mod.rs` 原本不干净，只加了一行。gui 新文件整篇 prettier；原本干净的旧文件整篇干净，原本不干净的（`App.tsx`、`CommandPalette.tsx`、`ScheduledTasksDialog.tsx`、`zh.ts`、`en.ts`）prettier 差异条数与 HEAD 相同。
- 看界面：临时 Vite + Chrome（playwright，假的 Tauri 桥）跑了真的 `MainView`、`TodoDialog`、`Sidebar`、`ToastHost`：卡片四种状态与子任务卡片同在、待办三组与悬停动作、最近做完展开、取消失败的那一行、编辑打开原表单、空状态、托管与外置的书眉、前台的提醒提示条；浅色深色、中英文。harness 已删，截图不进仓库。
- 没验：真机 `tauri dev`（按约定不跑）；macOS 打包版点系统通知是否把隐藏的窗口带出来；Windows。

### 2026-10-16 主会话：后台不切到助理（裁决 88）

JC 定后台时不切。`remindUndelivered` 去掉 `openAssistant`，只发系统通知；前台的提示条不变。卡片此时挂「等你回复」（提醒没进主对话，不是未读），原话在系统通知中心与待办「最近做完」。另两条拿不准的（英文每周规则的写法、Core 重启后子任务结束原因只在内存）先不动。
