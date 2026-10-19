# 12 对话历史按轮分页加载

Status: done（2026-10-19 JC 真机第 6 站：「打招呼与能力介绍」62 轮往上翻加载不跳、⌘K 搜「ssh tokyo」一路加载并高亮、问题轨变多，通过。`0d086e2a`、`53f95367`、`acc3559a`、`db3954fe`，2026-10-13 已推送；滚动手感待 JC 在 dev 里看）

来源：主聊天 PRD 裁决 51（2026-10-13，JC 按建议推进）。

## 为什么

桌面打开任何对话都一次读出全部消息（`gui/src/lib/db.ts:164` → Tauri 命令 `session_message_rows`，`core/src/commands/session.rs:268`），全部渲染。
普通对话短（本机最长约 60 轮），从没碍事；主对话是首页、每次启动都打开、而且一直累积。JC：「如果我引导用户就是在一个主对话里面一直对话，那么这个问题是一定要解决的」。

Core 里已有给手机做的分页读取 `persisted_message_rows_page`（`core/src/db/session.rs:154`），但它按**条**切页，会把一轮切成两半；桌面的 `rowsToTurns` 要整轮。

## 范围

- **所有对话都走分页**（不只主对话）：一条代码路径。内置、外置运行时同样。手机的远程分页（`session.messages`）不动。
- **按轮切页**：每页 50 轮（常量）。打开对话先读最近 50 轮；一轮的所有行要在同一页里。
  新加一个 Tauri 命令（或给现有读取加参数，回报你选哪种），返回整轮的行和「更早还有没有」；`visibility = 'visible'` 等过滤与 `persisted_message_rows` 一致。
  页界不切断一个 run（Goal run、`ask_user` 回答续接的 run，`docs/design/conversation.md:143`）：切到了就往前补到该 run 的第一轮；做不到就回报。
- **往上翻自动加载**：滚到接近顶部时加载上一页，前插后滚动位置不跳（视口里的内容不动）。加载中不加可见元素；没有更早的了，什么都不显示（同今天）。
- **搜索跳转**：⌘K 搜索结果跳到某条消息（`gui/src/App.tsx:769` 的 `requestLocate`，`gui/src/hooks/useStickyScroll.ts` 的 locate）时，目标还没加载就一页页往上加载，直到包含它，再照今天的方式定位、高亮。
- **问题轨**（`UserQuestionRail.tsx`）：只显示已加载部分的问题，加载了更多就跟着变多。
- **在跑的对话**：运行中的事件照旧追加在末尾；分页只管更早的部分。
- **其余默认整条都在的地方**：逐个找出并处理，回报清单与各自的处理。已知的有：发送时间断点（`gui/src/lib/message-time.ts`，第一条已加载的用户消息前面没有上一条可比）、
  Goal 委派 / 收口标记与 run 内连续编号、`sessionCompletedTurnCount` 等读 `messagesStore` 的地方、复制 / 导出类动作（若有）。
- `session_message_rows`（全量）有别的调用方就留着，没有就回报再定。

## 不做

- 虚拟列表（已加载的照常渲染在 DOM 里）。
- 「加载更早的消息」按钮、加载中的骨架或转圈（真机看出停顿再议）。
- 手机端、CLI 的读取。

## 验收

- Rust 测试：按轮切页（含问候 `turn_index -1`、多行的一轮、run 跨页时补齐）、`has_more`、空会话。
- vitest：前插合并成正确的 turns；locate 目标在更早页时会一直加载到它；问题轨只含已加载的；运行中追加不受影响。
- 本机最长的普通对话约 62 轮（超过一页），可在真机上试往上翻；合入后由主会话在 tauri dev 里给 JC 看，子代理不开 tauri dev。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui exec vitest run`（本机时区与 `TZ=UTC` 各一遍）、`cargo test --manifest-path core/Cargo.toml --workspace`、六个门禁脚本、`git diff --check`。
- gui 只格式化自己的 hunk（不是 prettier-clean），core 只对自己动过的文件跑 `rustfmt`。

## Comments

### 2026-10-13 实现回报（子代理）

**命令形态：新加命令，不给旧命令加参数。** Tauri `session_message_turns_page(sessionId, beforeTurnIndex?)` → Core `SqliteGalley::persisted_message_turns_page(session, before, turns)`，返回 `{ rows, hasMore, previousUserCreatedAt }`；每页轮数是 Core 常量 `MESSAGE_TURN_PAGE = 50`。不改 `session_message_rows`：返回值要多带 `hasMore` 和上一条用户消息时间，加参数等于换它的返回形状；新命令与手机按行切的 `persisted_message_rows_page` 并列，各管各的切法。行的形状、`visibility = 'visible'` 过滤、`(turn_index, sequence)` 排序与 `persisted_message_rows` 相同。游标就是 `turn_index`：页按整轮切，下一页取「本页第一轮之前」；运行中新写的行 `turn_index` 只会更大，往回翻不漏不重。

**run 不跨页（都做得到，没有回报的不可行项）。** 页首候选 = 最近 50 个可见 `turn_index` 里最早的一个，然后往前补到它所在 run 的开头：最近一条可见用户行，若它之前最近的 user / assistant 行（system、tool 行不算）是带 `ask_user` 调用的 assistant 行，它就是回答，接着往前找——与 `run-groups.ts` 的 `awaitingReply` 同一规则，判定也同为「tool_calls 里有 `toolName = ask_user`」。找不到开头（无头的开场段，例如主聊天问候 -1）就补到第一轮。开头若是发进某个 Goal 段里的消息（之前最近一条带本会话 Goal 的 `goal_id` 用户行之后，且 Goal 未结束或在 `ended_at` 之前发出，与 `goal-thread.ts` 的 `endsGoalSegment` 一致），再补到委派那一轮；循环到稳定。Goal 续跑的用户行是 internal、不可见，所以委派加续跑本来就是一个 run。因此一页可能多于 50 轮；进行中的 Goal 段总是从委派起整段读出。旧的无 `goal_id` 的 Goal（迁移 031 前）在 Core 判不了段，只按 run 补。

**往上翻与视口不跳。** `hooks/useEarlierTurns.ts`：滚到距顶部一屏以内读上一页；已加载内容本身不足这段距离（页短、滚不动）时不等滚动接着读。前插不跳靠手工滚动锚定（WebKit 没有 `overflow-anchor`，`lib/scroll-anchor.ts`）：store 前插那次写入时（zustand `subscribe`，React 尚未渲染，DOM 还是读者看到的），记下视口顶部那一行（`data-role="conversation"` 的子元素，二分查找）和它的位置；渲染新页的那次 commit 在绘制前（`useLayoutEffect`）把那一行放回原位；之后 1.5 秒内新页的代码高亮、图片解码在上方长高，由 ResizeObserver 和滚动事件继续压住，校正量扣掉读者自己的滚动（`anchorCorrection`）。Conversation 的行 key、折叠开关、live 窗口与离场步的状态改为按「下标 − 已前插轮数」（`prependedTurns`）记，前插不重挂载任何已渲染的行，也不会把展开的折叠挪到别的 run；无头开场段的 region 用固定 key。已知边界：① 1.5 秒后才解码的大图仍会把内容往下推；② 锚定行本身是很长的一块、且它的上半部分在视口外继续长高时压不住（这块是已渲染的旧内容，实际很少变）；③ macOS 触控板惯性滚动中改 `scrollTop`，WKWebView 会不会掐断惯性没法在这里验，要真机看；④ 前插的那一刻读者恰好在底部时，原有的贴底逻辑与锚定结果一致，不打架。

**⌘K 跳转。** `useStickyScroll` 的定位 effect 先查目标在不在已加载的 turns 里；不在且还有更早的，就 `loadEarlierThrough` 一页页读，每页落地重跑 effect，读到后照旧定位、高亮；读完仍没有（或读失败）就清掉这次定位，与「节点一直不出现」同样收场。

**默认整条都在的地方，逐个清单与处理：**

1. 发送时间断点（`lib/message-time.ts`）：Core 随页给 `previousUserCreatedAt`（页前最后一条可见用户消息的时间），`userTimeMarks` 用它当第一条已加载用户消息的比较基准，结果与整段加载相同，往上翻不会让时间行出现或消失。签名改为选项对象 `{ previousUserCreatedAt, thresholdMs }`。
2. run 分组、折叠、`stepNumberOf` 的 run 内连续编号、`replyUserIndices`、`askUserReplyContent`、`pendingReplyStepBase`、`liveRunElapsedBaseMs`、`derivePendingAskUser`：页首总是 run 开头，按页各自 `rowsToTurns` 再拼接与整段一样（stepper 在每条用户行重置），最后一个 run 总在首页里。不用改。
3. Goal 委派 / 收口标记、goal 组的折叠与编号（`goal-thread.ts` / `goal-run-groups.ts`）：委派总与它的段在同一页（见上），段完全在未加载部分的 Goal 不匹配、不出标记，加载到时出现。旧的无 `goal_id` Goal 走文本启发式，委派未加载时理论上可能误认一条同文的后来消息（极少，未处理）。
4. 问题轨（`UserQuestionRail` / `rail-preview`）：本就从 turns 与 DOM 推，只含已加载的；序号按已加载的数，往上翻后重排。
5. 写过的文件名解析（`written-files`）与浏览器站点（`browser-site`）：整会话的扫描变成只扫已加载部分；引用在未加载页里写的文件 / 打开的标签页时，那一页加载后才解析。未另做处理。
6. `sessionCompletedTurnCount` 与其他读 `messagesStore` 的地方：它只读会话行的 `turnCount`，只进 perf 日志；`appendUserTurn` / `applyUserMessagePersisted` 的 `turnIndexOffset` 也取 `turnCount`；`activateSession` / `_attachLive` / `takePendingLLMPick` 只看 `turns.length === 0`；侧栏状态、注意力、发送、队列只读运行字段。都不受影响。`clearConversation` 同时清 `earlier` 与 `prependedTurns`。
7. 复制 / 导出：只有单条消息的复制和选区复制，都按 DOM，没有整段导出。无需处理。
8. ⌥↑ / ⌥↓：按 DOM 找用户消息，到已加载的顶端为止；顺手滚到顶会触发加载。

**`session_message_rows`**：GUI 已无调用方（`lib/db.ts` 的 `loadMessagesBySession` 已删，换成 `loadMessageTurnsPage`）。Tauri 命令照旧注册，没删，等定。Core 的 `persisted_message_rows` 仍被普通会话的 runner 历史回放（`session_runner/replay.rs`）使用。

**测试**：Rust 新增 `core/tests/message_turn_page_test.rs` 9 个（整轮与多行一轮、往回走完、空会话与首轮之前、问候 -1、多步 run 补齐、ask_user 回答不当页首（含 internal 回答与仅提到 ask_user 的工具）、Goal 续跑、发进 Goal 段的消息补到委派（进行中 / 结束前 / 结束后 / 别的会话的 Goal）、`previousUserCreatedAt`、只取可见行与附件）。vitest 新增 17 个：`stores/messages.paging.test.ts` 8 个（恢复读最新页、前插后与整段 `rowsToTurns` 相等、并发合并、运行中追加不受影响、turns 被替换后丢弃迟到的页、读失败可重试、locate 一直读到目标且只读到那里、问题轨只含已加载的），`lib/scroll-anchor.test.ts` 6 个，`message-time.test.ts` 1 个，`Conversation.test.tsx` 2 个；`runtime.ensure-runner.test.ts` 的「ready 不读历史」断言加上新命令。

**门禁**：`pnpm --dir gui typecheck`、`lint` 通过；vitest 109 个文件 1078 个测试，本机时区与 `TZ=UTC` 各一遍全过；`cargo test --workspace` 919 个通过、0 失败；六个门禁脚本全过；`git diff --check` 干净。core 只对自己的 hunk 核对过 `rustfmt`（`session.rs` 里有一处原有未格式化的代码没动），新测试文件整篇格式化；gui 新文件整篇 prettier、旧文件只格式化自己的 hunk。

**真机怎么看**：在 tauri dev 里打开本机最长的普通对话（约 62 轮）：先只出最近 50 轮（遇到 run 会多出几轮）；往上滚到距顶部一屏内，更早的内容在上方出现，视口里正在看的那段不动、没有提示；⌘K 搜一句最早几轮里的话，回车应一路加载到它并高亮；右侧问题轨在加载后变多；运行中的对话往上翻时，新步照旧落在末尾。
