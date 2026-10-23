# 31 子任务叫醒助手（界面）

Status: done（2026-10-19 JC 真机第 5 站（耳机调研、下载文件夹先问再列方案）：派活与卡片、在办、叫醒后交代、打开与面包屑、升级进侧栏均通过；子任务提问时卡片与主对话各出一份同样的提问，已由裁决 101、102（票 48、49）处理。2026-10-16 合入）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 2、8；[主对话 PRD](../PRD.md) 裁决 80、82。
同批：[29](./29-subtask-wake-core.md)（Core 叫醒，与本票同一个 worktree 并行，它只动 `core/`、你只动 `gui/`），[30](./30-assistant-manual-and-entry-layer.md)（入口层与手册，另一个 worktree）。

## 背景

- **主对话**：内置运行时那条一直在的会话（`main_chat`），界面上是助手「Galley」：侧栏顶上一张助手卡片，主区画成 IM（双侧气泡、过程一行、时间居中、贴底）。
  设计见 `docs/design/layout-and-chrome.md`「有主对话时」与 `docs/design/conversation.md`「助手的对话」。
- **子任务**：主对话在回复里派出去的活，是一个普通会话，`parentSessionId` 指向主对话，未升级时（`promoted` 为假）不进侧栏，在派活回复下面显示成一张卡片（`gui/src/lib/subtasks.ts`）。
- **票 29**：子任务一次运行结束时，Core 叫醒主对话一轮。叫醒是主对话里一条隐藏的用户行，助手读了它，或者给用户交代（一条普通回复），或者把活打回给子任务（回复只写 `<no-reply/>`，不出声）。
  本票让界面配合：藏起叫醒行与不出声的回复，通知改成「一个声音」，子任务卡片显示返工轮次。

## 接口契约（与票 29 一致，名字照抄）

| 东西 | 值 |
|---|---|
| 叫醒行 | 主对话里 `role = "user"`、`created_via = "system"`、`supervisor = "galley-report"`、`visibility = "visible"`；`origin_note` 是逗号分隔的子任务 id。前端常量 `SUBTASK_REPORT_SUPERVISOR = "galley-report"`，放在 `gui/src/stores/messages/rowsToTurns.ts` 里 `MAIN_CHAT_GREETING_SUPERVISOR` 的同类位置，或 `lib/subtasks.ts`，你定 |
| 不出声的回复 | 叫醒那一轮的最终回答是 `<no-reply/>`。Core 的回合推导把这个标签剥掉（同 `<subtask>`，`core/src/turn_persistence/derive.rs:81-114`）；前端镜像剥离在 `gui/src/lib/ipc/ga-output-cleaning.ts`，你改，剥法与 Core 一致（有 golden 夹具就补夹具） |
| 打回次数 | `SubtaskDispatch` 加 `sendBacks?: number`（缺省当 0，兼容旧载荷），在 `gui/src/lib/subtasks.ts`；Core 变化时重发 `subtask-dispatched` 事件 |
| 送不出去 | 新事件 `subtask-report-undelivered`，载荷 `{ mainChatId: string; subtaskIds: string[] }`，常量与类型加在 `gui/src/lib/subtasks.ts`；IPC 类型漂移门禁若要求，也补到 `gui/src/types/ipc.ts` |
| 助手的写命令来源 | 助手往子任务里发的消息：`created_via = "supervisor"`（或 `cli`）、`supervisor = "galley-assistant"` |

## 要做的

### 1. 助手的对话里不画叫醒行

- 历史读回（`rowsToTurns`）与实时事件（`gui/src/lib/ipc-handlers.ts` 里 `user-message-persisted` 的处理，以及别处会把用户行乐观画出来的路径）都认出叫醒行，不画成你的气泡。
- 它后面的回复照常是一条左侧气泡，前面没有你的气泡；时间条只按看得见的行算，参照问候：它也是一条前面没有你的话的回复。
- 叫醒那一轮在跑时，对话末尾那一行（「过程一行」）照常显示它此刻在做什么，同普通一轮。

### 2. 不出声的回复不画

- 剥掉 `<no-reply/>` 后没有正文的回复，在叫醒开头的那一轮里：不画气泡、不画行动条与过程按钮、不发通知、不置未读、不当侧栏卡片的「最后一句」。
- 流式时不能闪出 `<no-reply/>` 或它的前半截（`<no-re…`）：对话末尾那一行与卡片在跑时的那句话，都走同一个清洗函数（`assistantLineSentence`、`cleanPartialContent`），未闭合的前缀要扣住。
- 回复刚落定时，那一行消失，什么都不留。
- 不是叫醒开头的轮次里出现 `<no-reply/>`（模型误用）：照只剩派活标签的回复处理。

### 3. 侧栏助手卡片

- 「最后一句」（`gui/src/lib/assistant.ts` 的 `lastVisibleMessage`）跳过叫醒行与不出声的回复，取再往前那条看得见的。时间也取那一条的。
- 在跑时照旧说那句话。

### 4. 通知：一个声音

- 未升级子任务自己的通知（`gui/src/lib/subtask-notify.ts`：在问你、完成、出错，及 `ipc-handlers.ts` 里调它们的几处）**不再发**：这些事都会变成助手的一条消息。
- **退路**：收到 `subtask-report-undelivered` 时，对载荷里的每个子任务，按它此刻的状态发今天那条子任务通知（在问你、完成、出错的规则与文案照旧）。
- 叫醒那一轮的**看得见的回复**照「回复完成」通知：收到叫醒行的 `user-message-persisted` 时，对主对话 `markReplyNotifyPending`（`gui/src/lib/notify.ts`）；回复不出声就清掉、不发。
  窗口在前台且开着助手时不发，照现有闸门（`sendGatedSystemNotification`）。
- 已升级的子任务照普通对话通知，不变。

### 5. 子任务卡片的返工轮次

- 卡片在跑那一行，`sendBacks ≥ 1` 时前面加「第 {sendBacks + 1} 轮 · 」，英文「Round {n} · 」，后面照旧（「第 N 步 · ……」照子任务的写法，裁决 68 说子任务保留步数）。
- 其他状态（在问你、完成、失败）不加。
- 文案加进 `gui/src/i18n/locales/zh.ts` 与 `en.ts`，中文全角标点。

### 6. 子任务对话里助手发的消息

打开一个子任务，助手打回或答题时发的那条消息，照今天 supervisor 来源的消息显示。查一下来源标记显示的是什么：若直接显示 `galley-assistant` 这个原字符串，改成显示助手的名字「Galley」（`copy.assistant.name`）。

### 7. 范围

- 只改内置运行时主对话及其子任务的界面；工作台的会话、外置运行时零变化。
- 搜索（⌘K、查找聊天记录）由 Core 排除叫醒行（票 29），界面不另做，除非你发现界面自己有一份过滤。

## 验证

在 worktree 里跑：

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run      # 至少相关的：rowsToTurns、ga-output-cleaning、assistant、assistant-conversation、subtask-notify、ipc-handlers.subtask、subtasks、卡片组件
git diff --check
```

新测试至少覆盖：

- 叫醒行不出气泡（读回与实时）；它后面的回复单独成气泡，时间条只算看得见的行；
- `<no-reply/>` 剥离（含流式前缀）；不出声的回复不画、不当最后一句；
- 子任务完成时不再自己通知，收到「送不出去」时补发；叫醒后看得见的回复会通知，不出声的不通知；
- 卡片「第 2 轮 · 」。

注意：

- `renderToStaticMarkup` 下 zustand 读的是初始状态，往 store 里塞的值读不到；要用 `vi.mock` 包住对应的 hook（先例 `useSessionsAttention`）。
- lint 带 React 编译器规则：effect 体内同步 `setState`、渲染期调 `Date.now()` 都会报错；组件文件只导出组件，工具函数放 `lib/`。
- `gui/src` 不是 prettier-clean：不要对整个文件跑 `prettier --write` / `pnpm format`，只保证自己写的部分风格一致，新文件可以整篇格式化。
- 中文文案一律全角标点。

## 别动

- `core/`（票 29、30）；`.scratch/main-chat/entry-layer-eval/`（票 30）。
- 工作台会话、外置运行时的界面行为。
- 只在 worktree 里工作：绝不碰主工作树 `~/Documents/genericagent-webui`（JC 的 `tauri dev` 在那里跑），不跑 `tauri dev`，不 `git commit`。
- 票 29 的代理同时在 `core/` 里编译；你看到 Rust 侧或 IPC 门禁的瞬态错误是正常的，别去修 `core/`。

## 回报

- 改了哪些文件，每个一句；
- 契约里各名字最终落在哪；
- 门禁命令的最后输出；
- 票面写错或你改了主意的地方；
- 拿不准、要主会话定的事。

同样的内容写进本票 `## Comments`。

## Comments

### 实现回报（界面，2026-10-16）

**改了哪些文件**

- `gui/src/lib/ipc/ga-output-cleaning.ts`：`<no-reply/>` 进标签组（`/<\s*\/?\s*no-reply\s*\/?\s*>/gi`，与 Core `derive.rs` 同一个式子），`extractPreamble` 同剥，流式时扣住它的前缀（`NO_REPLY_PARTIAL`）；新 `isSilentReply(raw)`。
- `gui/src/lib/agent-turn.ts`、`gui/src/types/conversation.ts`：`AgentTurn.silent`（只剩 `<no-reply/>` 的收口回复）与 `AgentTurn.settledAt`（这一步落定的时间）。
- `gui/src/stores/messages/rowsToTurns.ts`：读回时从 `content` 认 `silent`，带 `settledAt`。
- `gui/src/lib/subtasks.ts`：契约名（见下表）、`sendBacks`、卡片在跑那一行的轮次、报告轮的判定（`isReportRound`、`isSilentReport`、`hiddenReportTurns`、`inReportRound`、`endsInSilentReport`）。
- `gui/src/lib/assistant-conversation.ts`：`assistantLinePlan` 不画叫醒行；不出声的一轮只留它问你的问题与你的回答；新增 `reports`（叫醒行 → 这一轮第一条画出来的行）。
- `gui/src/components/conversation/Conversation.tsx`：时间条跳过画不出来的叫醒行；叫醒行的时间画在这一轮第一条看得见的行上方（回复、提问、平铺的一轮、还在等你回答的提问都算）。
- `gui/src/lib/message-time.ts`：`userTimeMarks` 加 `skip`。
- `gui/src/components/screens/MainView.tsx`：不出声的回复一落定，那一行就消失；它也不点亮「回到底部」的未读点。
- `gui/src/lib/assistant.ts`：`lastVisibleMessage` 跳过叫醒行与不出声的一轮；回复与提问带自己的时间（`settledAt`）。
- `gui/src/lib/ipc-handlers.ts`：未升级子任务的在问你、完成、出错、没派出去都不再自己通知；新 `applySubtaskReportUndelivered`（退路）与 `noteSubtaskReportPersisted`（叫醒行 `pending` / `dispatched` 时对主对话 `markReplyNotifyPending`，`persisted_only` 时清掉）；turn_end 认出叫醒那一轮不出声的回复：清标志、不通知、不置未读、不改写幽灵建议；实时的 turn 带 `silent`、`settledAt`。`notifySubtaskRunnerCrash` 删掉。
- `gui/src/lib/subtask-notify.ts`：`dispatchFailureNotifications` 换成 `subtaskFallbackNotification`：按 `deriveSubtaskCard` 此刻的状态出今天那条通知，完成仍要跑满 2 分钟（用这一轮的 telemetry 量，没有就从会话创建算，同旧规则）。
- `gui/src/stores/runtime/bridge-slice.ts`：去掉崩溃时的子任务通知调用。
- `gui/src/stores/messages.ts`：叫醒行不加 `userSubmitTick`（不挪视口），也不清幽灵建议。
- `gui/src/hooks/useExternalCoreEvents.ts`：听 `subtask-report-undelivered`；`user-message-persisted` 后调 `noteSubtaskReportPersisted`。
- `gui/src/i18n/locales/zh.ts`、`en.ts`：`subtask.roundPrefix`（「第 N 轮 · 」/「Round N · 」）。
- `docs/design/conversation.md`：「助手的对话」加「子任务叫醒助手」一条；子任务卡片表「在跑」加轮次；助手发进子任务的消息怎么显示。`docs/design/layout-and-chrome.md`：助手卡片「最后一句」「时间」两条。
- 测试：`ga-output-cleaning`、`rowsToTurns`、`agent-turn`（往返）、`subtasks`、`subtask-notify`、`ipc-handlers.subtask`（重写）、`assistant`、`assistant-conversation`、`message-time`、`Conversation.assistant`、`MainView.assistant`、`SubtaskCards`。

**契约名落在哪**

| 名字 | 位置 |
|---|---|
| `SUBTASK_REPORT_SUPERVISOR = "galley-report"` | `gui/src/lib/subtasks.ts`，附 `isSubtaskReport(origin)`、`isSubtaskReportTurn(turn)` |
| `<no-reply/>` 剥离 | `gui/src/lib/ipc/ga-output-cleaning.ts`：`GA_TAG_PATTERNS` 末项、`extractPreamble`、`cleanPartialContent` 第 3 步；判定 `isSilentReply` |
| `SubtaskDispatch.sendBacks?: number` | `gui/src/lib/subtasks.ts`；`mergeDispatches` 比较它，缺省当 0 |
| `SUBTASK_REPORT_UNDELIVERED_EVENT`、`SubtaskReportUndeliveredPayload { mainChatId; subtaskIds }` | `gui/src/lib/subtasks.ts`；处理在 `ipc-handlers.ts` 的 `applySubtaskReportUndelivered` |
| `galley-assistant` | 界面不需要常量，显示照 Supervisor 来源（见下第 6 条） |

**门禁的最后输出**

- `pnpm --dir gui typecheck`：`tsc --noEmit`，exit 0。
- `pnpm --dir gui lint`：`eslint src --max-warnings 0`，exit 0。
- `pnpm --dir gui exec vitest run`：`Test Files 135 passed (135)`，`Tests 1351 passed (1351)`；`TZ=UTC` 与 `TZ=America/Los_Angeles` 各跑一遍都全过。本地时区 00:03 跑时 `Sidebar.main-chat.test.tsx` 有一条挂：它的夹具用 `minutesAgo(5)`，零点后几分钟「今天」桶是空的，与本票无关，23:54 那一次全过。
- golden：`turn-persistence.golden.test.ts` 37 条全过，含票 29 加的 4 条 `no-reply-*`；Core 用的正是同一个式子。
- `node scripts/check-ipc-protocol-drift.mjs`：aligned。`subtask-report-undelivered` 是 Tauri 广播事件，不在 runner IPC 门禁里（`subtask-dispatched` 也不在），`types/ipc.ts` 不用改。
- `git diff --check`：无输出。只格式化了自己的 hunk（HEAD 时就 prettier-clean 的测试文件整篇格式化，其余逐 hunk 对过）。

**票面写错或我改了主意的地方**

1. 票面说 `user-message-persisted` 的处理在 `ipc-handlers.ts`；实际在 `hooks/useExternalCoreEvents.ts` → `stores/messages.ts` 的 `applyUserMessagePersisted`。叫醒行照常进 turns（它是这一轮的开头，分组、步数、计时都靠它），不画放在 `assistantLinePlan` 里做，读回与实时走同一条路。
2. 「时间条只按看得见的行算，参照问候」：我照问候的做法让叫醒行带时间：断点时它的时间画在这一轮第一条看得见的行上方，下一条你的消息也跟它比；不出声、又没问你什么的一轮，它的叫醒行不算（`skip`）。若本意只是「叫醒行不算」，把 `reports` 清空即可。
3. 「时间也取那一条的」需要回复自己的时间，界面原来没有（只有问候带 `createdAt`，票 20 有测试钉着别的回复不带）。我另加了 `AgentTurn.settledAt`（读回是那一行的 `created_at`，实时是 turn_end 的 `timestamp`），只给卡片用，没动 `createdAt`。卡片对回复一律用它，取不到才用 `lastActivityAt`；两者平时只差毫秒。
4. 回复同时带 `<subtask>` 与 `<no-reply/>` 时不算不出声（`isSilentReply` 排除），否则新派的子任务卡片会跟着藏起来。
5. 不出声的一轮也不清幽灵建议：叫醒行到达时不清，不出声的 turn_end 不改写，上一条看得见的回复的建议照留。
6. 第 6 点：来源标记显示的不是原字符串，是 `PlugsConnected` 图标、提示「Supervisor」、读屏「Supervisor 添加的消息」，所以没改代码，只在设计文档记了一句。
7. 「没派出去」（标签为空、没写完、没能启动）原来在 `subtask-dispatched` 时就通知；现在也只走助手（票 29 生成 NotStarted 待报）。

**拿不准、要主会话定的事**

1. Core 的 `subtaskIds` 只带有会话的子任务（`mark_announced` 滤掉了 `subtask_id` 为空的）：空标签、没写完的标签叫不醒助手时，界面没有 id 可补发，用户就听不到。要不要让 Core 带上派活键（`main#turn#ordinal`），还是接受。
2. 「第 2 轮」刚开始时，卡片会写「第 2 轮 · 第 5 步 · 上一轮的摘要」，直到这一轮第一步落定：`session.lastStepIndex` 在新一轮开头不清，工作台侧栏行对第二条消息也是这样（旧行为，没改）。
3. 贴底的「这一轮回复的开头」（`assistantReplyStart`）按你最后一条气泡找；叫醒的一轮没有你的气泡，量到的是上一轮。叫醒的回复照指令只有一两句，影响小，没改。
4. 分页边界：Core 给的 `previousUserCreatedAt` 可能是一条叫醒行的时间；只在页界正好落在那里时影响一条时间条，属 Core，留给主会话判断。
5. 外置运行时的界面行为零变化，但 `<no-reply/>` 的剥离与 Core 一样对所有会话生效（golden 夹具要求两边一致），外置会话里有人真打这个字面量才看得出差别。
6. 没跑真机（按约定不跑 `tauri dev`），视觉验收留给 JC。

### 集成（主会话，2026-10-16）

三张票在一个分支上合起来，主会话补了五处：

1. **Done 指向派活说明**：子任务超过 39 步时说明不在 `--tail=40` 里（票 30 的问题 3），叫醒改为写明第一条消息 `session show {id} --around=msg_{id}_0_user`，最后几步照旧 `--tail=40`。没选把说明整段塞进叫醒：同一段里助手的上下文本来就有它，只在冷启动后才缺，按需查更省。
2. **步数上限写明续跑命令**：采纳票 30 的评测建议，「the same way」换成完整的 `session send … "continue" … --ensure-runner`（票 29 已补上最后一段文字，与建议 1 同义）。
3. **「不出声」只认剥完为空**：界面原先只要带了标签就藏（「已打回。<no-reply/>」也藏），Core 的推导是剥完为空才算。改成两边一致：剥完还有字就照常显示。理由：模型把交代写完又误加标签时，丢掉交代比多一句「已打回。」代价大。后面跟着建议标签的仍算不出声（票 30 的问题 4）。
4. **手册补 `--ensure-runner`**：手册写在这个参数出现之前，补上用法与一句为什么；测试照新拼写。
5. **IM 入口层的 `llm set`**：它不收 `--supervisor` / `--reason`，带了就 exit 2（票 30 的问题 1），IM 入口层却要求带，删掉它在那串命令里的名字。

没改、记下的：改名没有 CLI 命令（助手 PRD 次序第 3 步补）；派活本身失败且叫醒送不出去时没有通知（票 31 问题 1）；打回后新一轮第一步落定前卡片还写上一轮的步数摘要（旧行为）；手机端要按来源藏起叫醒行与 `<no-reply/>`（手机开工时）；叫醒在等回答时按住会有两个声音（裁决 8 本来如此）；手册写失败只记日志、照常启动（票 30 的问题 6，可改）。

门禁：`cargo test --workspace` 35 组 974 条（本机时区与 `TZ=UTC` 各一遍），`cargo check`；`pnpm --dir gui typecheck`、`lint`、vitest 1351 条（本机与 UTC 各一遍）；文档链接、Supervisor SOP 漂移、IPC 漂移、`git diff --check` 都过。
