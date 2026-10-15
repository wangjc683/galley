# 31 子任务叫醒助手（界面）

Status: ready-for-agent

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
- 只在 worktree 里工作：绝不碰主工作树 `/Users/inkstone/Documents/genericagent-webui`（JC 的 `tauri dev` 在那里跑），不跑 `tauri dev`，不 `git commit`。
- 票 29 的代理同时在 `core/` 里编译；你看到 Rust 侧或 IPC 门禁的瞬态错误是正常的，别去修 `core/`。

## 回报

- 改了哪些文件，每个一句；
- 契约里各名字最终落在哪；
- 门禁命令的最后输出；
- 票面写错或你改了主意的地方；
- 拿不准、要主会话定的事。

同样的内容写进本票 `## Comments`。

## Comments
