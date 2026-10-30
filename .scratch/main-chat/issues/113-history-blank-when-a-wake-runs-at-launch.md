# 113 启动时有实时动静，打开那个会话不再空白：历史照样从库里读回来

Status: needs-dogfood（2026-10-30 快进合入 `c2221164`…`495c7baf`。主会话验收：读过代码，按 id 去重成立（实时助理轮带 Core 同一主键，`gui/src/lib/ipc-handlers.ts:430`）；另查了开新段时会不会清空内存（不会，清空只在删会话，`forgetDeletedSessions`）；worktree 与合入后的 main 上 typecheck、lint、vitest 本机 / `TZ=UTC` / 洛杉矶各 2622 条全过。原因是 （a） 实时轮先到还是 （b） 启动时读库失败，代码分不出来，（c） 已排除；（b） 时点一下侧栏卡片会重读，没加自动重试（报告未验证第 2 条）。dev 复现第一次没撞上：dev 的 socket 在 Core 起来 87 秒后才通，巡看跑出去时界面早已读过库；JC 屏幕锁着，截不了图。改用确定的复现：界面停在主对话时，用 CLI 给一个本次启动没点开过的旧工作台会话发一句，再点开它，等 JC 解锁后走。2026-10-30 裁决：撤 v0.7.4 草稿、修好重打，JC：「按建议推进」）

来源：[v0.7.4 发布](../../../docs/devlog/2026-10-30-v0.7.4-release.md)。只改 GUI，不动 Core、CLI、Agent API、迁移。内置与外置运行时走同一段代码，两边一起修好。

## 发生了什么

- 10-30 JC 装上 v0.7.4 草稿（Intel），12:20:27 安装版 Core 启动；今天 08:51 的巡看没跑过，调度器同一天内补跑（`core/src/scheduler.rs:9`），12:20:34 就叫醒了主对话。
  它开了新段（第 270 轮），4 步，12:21:34 回 `<no-reply/>`。这一轮是静默的，按票 110 的规则对话里什么都不画。
- 窗口里主区整片空白：没有消息、没有滚动条、没有问候；侧栏的助理卡片写「Galley 12:21」，待办面板正常。
- 库完好：主对话 302 条消息都在，迁移 054 只记一次，没有新备份目录。JC ⌘Q 再打开（今天的巡看已跑过，不再补跑），历史全回来了。

## 原因（主会话读码，代理先核实）

- 打开一个会话时要不要从库里读历史，判的是内存里是不是 0 轮：`gui/src/stores/sessions/lifecycle-slice.ts:345–357` 的 `looksFresh`（注释说「`turns.length === 0` is a safe proxy for "fresh runtime"」）。
- 巡看在启动后 7 秒就开跑，它的实时事件在 GUI 打开主对话、读库之前就落进了 `byId[主对话]`；之后 `looksFresh` 为假，不读库。内存里只剩那一轮静默巡看，于是空白。
- `gui/src/stores/runtime/bridge-slice.ts:309–318` 的 `_attachLive` 写的就是这个竞态（「once live turns land in an empty transcript, activation no longer restores」），但它只防「重载时 run 已经开着」，没防「启动后才开跑」。
- 这段判断从 v0.4.0 就在（`b9a2ce49`）；主对话与巡看是 v0.7.0 起才有。以前没撞上：试用期里启动时那 3 次补跑都因为没东西可看被 Core 跳过了，今天是第一次在启动时真醒。

## 要做到

- 一个会话在这次启动里第一次被打开时，历史一定从库里读回来，不管内存里是不是已经有了先到的实时轮。判据换成「这次启动里读过库没有」一类的确定状态，不再用 0 轮当代理指标。
- 读库时把先到的实时内容并进来：已落库的不重复画，还没落库的（正在跑的那一步、打字气泡、待回答的提问）不丢。Core 每一步都落库，所以库里那一页已经含有先到的已完成步骤；怎么去重（`messageId`、`turn_index`）由代理按现有数据结构定，写进报告。
- 同样的竞态别处还有没有（`turns.length === 0` 当作「没读过」的地方，包括 `_attachLive`、分页 `earlier`、主对话的问候），一起查，能用同一个判据收拢就收拢；查到但不该在本票改的，写进报告交回。
- 不能丢的现有行为：切会话时的原子切换（不画一帧空白，`lifecycle-slice.ts:358–371`）；分页往前读（`loadEarlierTurns`）；重载时 run 开着的那条路；主对话的问候；`derivePendingAskUser`。

## 测试

- 新 vitest 先复现：实时轮（含一轮静默的叫醒轮）先落进空的 store，再打开那个会话 → 库里的历史在、实时轮在、没有重复。修之前这条要红，报告里写明。
- 再加两条：先到的是还在跑的一步（run 没结束）时打开；同一会话第二次打开不再读库（不多读、不闪）。
- 门禁：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui exec vitest run` 本机与 `TZ=UTC` 各一遍、`git diff --check`。

## 约束

- 只改 `gui/`。gui 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；工具函数别从组件文件导出。
- 静态渲染测试（`renderToStaticMarkup`）读不到 zustand 里塞的值，store 行为用 store 层测试测。
- 票面、提交、报告里别写本机绝对路径和 worktree 路径。

## 给 JC 的真机步骤（主会话先在 dev 里走）

1. 主会话在 dev 里复现：Core 重启后头几秒内用 CLI 手动跑一次巡看（`schedule run`，一定会醒），看主对话的历史还在不在。合入前后各走一次，合入前应当空白。
2. JC 装新草稿后启动：主对话照常有历史（若那天巡看在启动时补跑，正好再撞一次）。

## Comments

### 2026-10-30 实现报告（代理）

**根因：时序从代码只能排除一种，另两种代码都允许**

启动时主对话怎么成为主区里的会话（行号按基线 `09c8e2da`）：

- 活动指针不持久化：`activeSessionId` 初值 `undefined`（`gui/src/stores/sessions/lifecycle-slice.ts:291`），`screen` 初值 `"empty"`（`gui/src/stores/ui.ts:215`）；会话水合只保留或清空已有指针，从不设置（`gui/src/stores/sessions/hydrate-slice.ts:50`）。
- `App` 首次提交时同时挂上 `useAppHydrationEffects()`（`gui/src/App.tsx:277`）和 `useExternalCoreEvents()`（`:280`）。后者的 `user-message-persisted`（`gui/src/hooks/useExternalCoreEvents.ts:43`，不管会话开没开都写进 `messagesStore.byId`）和 `runner-spawned-external`（`:82`，给该会话接上 `runner-event` 监听）从这一刻起生效。
- `hydrateApp` 依次 await：版本号、`hydratePrefs`（十来次串行 `get_pref`）、常用语、`ensure_managed_runtime_layout`（同步命令）、托管模型，然后才是第 5b 步 `await openMainChat()`（`gui/src/lib/hydrate.ts:112`），排在会话水合（`:118`）和重连（`:124`）之前。
- `landOnMainChat` 拿到主对话后调 `void sessions.activateSession(brief.id, { ensureRunner: false })`（`gui/src/lib/main-chat.ts:77`）。启动时让主对话上屏的只有这一条路；点侧栏卡片走 `handleSelectSession` → `openSession` → `activateSession`（`gui/src/components/layout/Sidebar.tsx:470`、`gui/src/App.tsx:551–553`）。其余直接写指针的只有新建会话和清空，没有不经 `activateSession` 就把主对话设为活动会话的路径。
- Core 侧：共享 SQLite 池在窗口出现前已 `manage`（`core/src/app_setup.rs:23`），调度器在同一个 setup 里启动（`:37`），首个 tick 立即执行（`core/src/scheduler.rs:221`）。

三种读法：

- （c）启动路径不读库就把主对话放上屏：代码排除，启动路径只有 `activateSession`。
- （a）实时轮先落，激活时 `looksFresh` 为假，跳过读库（票面读法）：代码允许。监听器在 `hydrateApp` 之前就挂上，激活在第 5b 步，中间隔着一串串行 IPC；只要第 5b 步晚于 12:20:35 的报告行广播（进程起来后约 8 秒），结果就是这样。
- （b）读库失败或读出空页，之后没人重试：代码也允许。`restoreSessionTurns` 的 `catch` 只打一条 `console.debug` 就返回（`gui/src/stores/messages.ts:563`）；之后实时轮一落，`looksFresh` 就一直为假，这次启动里不会再读。但我没找到启动时这次读会失败的原因：池在窗口出现前已就绪，WAL 下读不会被调度器的写挡住，sqlx 遇忙会等待；302 条消息的主对话也不会读出空页。
- “读得慢”也排除了：读在实时轮之后才返回时，旧代码整页替换，历史照样出来，不会空白。空白只可能是没读，或读失败。

结论：只看代码分不出（a）和（b）。能区分的只有 webview 控制台里的 `[perf] sessions.activateSession.restore`、`[perf] messages.restoreSessionTurns`（带 `rowCount`）和失败时那条 `console.debug`，这些都不落盘。我倾向（a）：它只要求第 5b 步晚了几秒，（b）则需要一个找不到来源的 Core 错误。这是推断。下面的修法两种都覆盖。

**新规则**

- 新字段 `PerSessionMessages.historyRead`：这次启动里本页读过这个会话的库（`restoreSessionTurns` 拿到了页，空页也算），或这个会话是本页新建的（`markHistoryRead`，在 `createSession` / `createSessionPersisted` 里调用）。只有成功的读才会置真，失败时保持假；条目删掉时它才跟着消失。
- 激活：`needsRestore = !historyRead && hasHistory`（`lifecycle-slice.ts:360`）。`hasHistory`（`turnCount > 0` 或是主对话）不变，原子切换、`deferFlip` 和 epoch 守卫也不变。
- 同一会话的并发读合并成一个（`restoreReads`），例如重载时 `_attachLive` 和激活同时读。

**去重**（`gui/src/stores/messages/mergeRestoredTurns.ts`）

- Core 每一步都先落库再广播，所以库里那一页在 Core 读它的时刻是完整的；`live` 按到达顺序排列。
- 按行 id 匹配：实时 user / agent 轮的 `messageId` 和库行 id 同形（`msg_<session>_<turn_index>_<role>`；`turn_end` 的 id 用 Core 给的 `absoluteTurnIndex`，`gui/src/lib/ipc-handlers.ts:411,430`）。
  - 页里已有的实时轮只画一次：用屏幕上那个实时对象，放在页里的位置上（`clientRequestId` 这类只在内存里的字段得以保留）。
  - 最后一个共有轮之后的实时轮：读之后才到，或还没落库（乐观回显、`/btw` 一问一答、bridge 系统消息），按到达顺序接在后面。叙述（narration）没有 id：页里在该位置之后有同文本的，就算同一行，不再重复画。
  - 共有轮之前、页里没有的实时轮：会落库的（带 id，或是叙述），说明它在页的范围之外，丢掉（`earlier` 能读到）；临时的放在那个共有轮前面。
- 正在跑的一步、打字气泡和待回答的提问都不在 `turns` 里（`currentTurnIndex`、`inFlightContent`、`pendingAskUser`、`agentRunning`），读库不碰它们；`pendingAskUser` 仍是实时值优先，没有时从合并后的轮推出来。
- `earlier` 取自页，`prependedTurns` / `removedOrdinals` 归零，与原恢复一致。

**同一代理指标的其他位置**

- `gui/src/stores/runtime/bridge-slice.ts` 的 `_attachLive`（基线 `:316`）：改为 `!historyRead`。激活已经读过时，重连不再读第二遍。
- `gui/src/lib/main-chat.ts:72` 主对话已在屏时直接返回：加了 `historyRead` 条件，读失败后再落地一次就会读。
- `gui/src/hooks/useAssistantState.ts:128,151` 侧栏卡片：原来缓存非空就用缓存。现在历史未读时卡片自己读一页（原来静默巡看单独在内存里时，卡片什么都引用不到）；自读的这一页也按 `liveRound` 算，与缓存路径一致。
- 分页 `earlier`：没读过的会话 `earlier` 为 null，更早的历史根本够不着。合并后 `earlier` 从页里来，这个问题一并消失，代码只改了字段注释。
- 主对话问候：`hasHistory` 里的 `mainChat === true` 没动，问候随读库回来，原有测试仍通过。
- 查到但没改：
  - `gui/src/lib/subtasks.ts:288` + `gui/src/components/conversation/SubtaskCards.tsx:119–124`：子任务卡片以“0 轮且 `turnCount > 0`”判 loading，每个 sid 每次启动只读一次（`restoreRequested`），失败不重试。改成 `historyRead` 会让这次启动里实时在跑的子任务都先变 loading 再多读一次，不该在本票改。读本身现在会合并，卡片的读和实时轮撞上也不会再丢东西。
  - `lifecycle-slice.ts:143` `takePendingLLMPick` 的 `isFreshSession`：判的是“是不是新会话”，不是“读没读过”，不改。
  - `gui/src/components/screens/MainView.tsx:673` 只在 `restoring && turns.length === 0` 时画骨架：纯显示。读库期间已有实时轮就画实时轮，合理，不改。
  - `messages.ts:149` `runStepBase` 注释里的已知缺口（本次启动没读过的会话里，CLI 发来的回复从第 1 步数起）：同源，但合并后也不会重算 `runStepBase`，没动。

**测试**（先红后绿）

- `gui/src/stores/sessions.activate-after-live.test.ts`（新，4 条）：
  - 「reads the history when a silent wake landed first: history and the wake, nothing twice」：票面复现。报告行、一步和 `<no-reply/>` 先实时落进空 store，再打开主对话。
  - 「keeps a step still running, and a step the read did not see, when it opens mid-run」：读库期间又落一步，下一步正在流式输出。
  - 「does not read again when the same session is opened a second time」：指针同步切换，只读一次，`turns` 引用不变。
  - 「reads it on a later activation when the first read failed」：情况（b）。
  - 修之前在基线代码上 4 条全红：`expected +0 to be 1`（没读库）两条，`expected [] to have a length of 1`（没发起读），`expected 1 to be 2`（失败后不再读）。修之后全绿。
- `gui/src/stores/messages/mergeRestoredTurns.test.ts`（新，6 条，纯函数）。
- `gui/src/lib/main-chat.test.ts`：新加「lands again while on screen when its history read failed, and reads it (ticket 113)」，换回旧 `main-chat.ts` 时红（`expected false to be true`）。`beforeEach` 改为返回一页空历史；「asks again but changes nothing…」等读完再断言只读一次。
- `gui/src/stores/runtime.live-runners.test.ts`：新加「activating a running session reads its history once, re-attach included (ticket 113)」，换回旧 `_attachLive` 时红（`expected 2 to be 1`）。
- `gui/src/hooks/useAssistantLastMessage.dom.test.tsx`（新，2 条，jsdom）：换回旧 hook 时第一条红（`expected '(none)' to be '记下了。'`）。

**门禁**（本分支最终树）

- `pnpm --dir gui typecheck`：通过。
- `pnpm --dir gui lint`：通过，0 warning。
- `pnpm --dir gui exec vitest run`：237 个文件、2622 条全过（基线 234 / 2608）；`TZ=UTC` 再跑一遍，237 / 2622 全过。
- `git diff --check`：干净。
- 新文件整篇跑了 prettier，旧文件只格式化了自己的 hunk。

**没验证到 / Open risks**

1. 没起 tauri dev，没碰 Core，真机步骤 1、2 都没走。历史落进来那一刻的滚动和闪烁只在 store 层验过。
2. （a）和（b）从代码分不出来（见上）。如果当时其实是（b）：失败的读现在会在下一次激活或落地时重试，但启动时那次失败之后，主区仍会空着，直到用户再打开一次主对话（点卡片、面包屑）；没加自动重试。Core 与页面同进程，状态在窗口出现前就已 manage，没有可挂的“Core ready”信号。
3. 历史落进来时 `prependedTurns` / `removedOrdinals` 归零（与原恢复一致），先到的实时行会重挂载一次，展开状态随之复位。静默巡看没有可见行，不受影响；进行中的可见运行会在这时重挂一次。
4. 叙述没有 id，只按文本去重：同文本的两条叙述一条在读之前、一条在读之后时，可能少画一条。
5. 乐观回显还没被认领、它的行却已在页里时，会画两次。GUI 发送路径先 await 激活（含读库）再回显，所以走不到；别的路径没覆盖。
6. 读挂起（invoke 一直不返回）时，后来的激活会 join 同一个读，不再发新读；没加超时。目前没有证据说这种故障存在。
7. 子任务卡片的同类判断和 `runStepBase` 的已知缺口没动（见上）。
8. 历史未读时，卡片在 `lastActivityAt` 每次变化后都会自己读一页（旧逻辑在缓存为空时也是这样）。卡片自读的那页现在会跳过进行中那一轮的步骤，所以“缓存为空、后台在跑”时卡片的显示和以前不同（与缓存路径一致了）。
