# 01 草稿存到磁盘

Status: done（2026-10-16 合入 main，`3a088ad7`，合并提交 `7eefcd48`；同日 JC 真机验收：「其他验收 OK，可以 push」）

来源：[PRD](../PRD.md) 裁决 1（2026-10-16，JC：「1，做」）。只改 GUI，不碰 Rust。
与票 02、03 同一个子代理按序做（都动输入框），本票先。

## 目标

输入框里没发出去的话，关掉 App、装更新重启之后还在。今天草稿只在内存（`gui/src/lib/composer-draft.ts`），App 一关就没了。

## 依据

- `composer-draft.ts:13` 不存的理由是「drafts die with the app — same contract as every chat client」。Telegram 推翻了这个前提：每个对话一份草稿，停手后保存（Web A 10 秒、Web K 2.5 秒；它们要同步到服务器才防抖），清空立刻删，切走、窗口失焦、关窗时一定保存（Web A `src/components/middle/composer/hooks/useDraft.ts:122,159-200`）。
- localStorage 已有先例（`stores/prefs.ts`、`lib/theme.ts`）。草稿是界面上的便利，不是业务数据，不进 SQLite、不经 Core（Rule 5 不受影响）。

## 要做

- 存什么：**只存文字**（`text`，已经是展开后的全文）。图片不存：对象 URL 关 App 就失效，WebKit 的 localStorage 配额约 5MB，一张图就可能撑爆。重启后恢复的草稿只有文字，这个代价写进代码注释。
- 怎么存：每个草稿一个 localStorage 键（如 `galley.draft.<surface key>`），只序列化被改的那一份；写入时机你定（逐次写入或短防抖都行），原则是**关 App 前最后一次改动不丢**：Tauri 关窗时 `beforeunload` / `pagehide` 不一定触发，别只靠它们兜底。清空、发出、`dropComposerDraft` 都要同步删掉对应的键。
- 什么时候读：模块初始化时把存着的草稿读回内存 map，之后照旧只读内存（`readComposerDraft` 的调用方不用改）。读回的条目要通知 `subscribeComposerDrafts` 的订阅者（侧栏助手卡片「草稿：…」重启后应该照样显示）。
- 清理：会话被删掉后，它的草稿键要清掉，别越积越多。在哪清你定（会话列表加载后比对、删除会话的路径上……），写进 Comments。
- 读写都包 try/catch：localStorage 抛错（配额、隐私模式）时退回今天的纯内存行为，不报错、不弹提示。
- 改掉 `composer-draft.ts` 开头那段「Deliberately NOT persisted」的注释，写清现在的约定与依据。

## 不做

- 不跨设备、不进 iOS 端；不存图片；不改草稿在侧栏的显示规则（主对话 PRD 票 18）。
- 不存排队中的消息（队列是另一回事）。

## 验收

- 单测：存、读回、清空即删、发出即删、配额抛错退回内存、删会话后清键。
- 文档：`docs/design/conversation.md` 里讲 composer 草稿的地方（grep「草稿」「draft」）补一句：重启后文字草稿还在、图片不在。
- 真机（JC）：主对话与工作台各写半句不发 → 退出 App 重开（或 `tauri dev` 重启）→ 草稿还在，侧栏助手卡片显示「草稿：…」。

## Comments

### 2026-10-16 实现（子代理，分支 `td-composer`）

**做了什么**

- `gui/src/lib/composer-draft.ts`：每次 `saveComposerDraft` 在改内存的同时把这一份草稿的文字写进 localStorage，一个草稿一个键 `galley.draft.<草稿键>`（会话 id、`empty-state`、`main-composer`），值就是展开后的全文（不包 JSON）。清空（`saveComposerDraft` 收到空草稿）、发出与删除（`dropComposerDraft`）当场 `removeItem`。模块加载时把 `galley.draft.*` 全部读回内存 map（`images: []`），之后照旧只读内存；`readComposerDraft` 的调用方一处没改。开头「Deliberately NOT persisted」那段换成现在的约定、依据（Telegram）与代价（图片不存，只有图片的草稿重启后没了）。
- `gui/src/stores/sessions/shared.ts`：`forgetDeletedSessions` 里对每个被删的会话 `dropComposerDraft`。
- 文档：`docs/design/conversation.md` §4.4「视觉」那条草稿规则改写；`docs/design/layout-and-chrome.md` 助手卡片「草稿从内存草稿来」一句跟着改。

**取舍（票里「你定」的）**

- 写入时机：**每次改动当场写，不防抖**。票的原则是关 App 前最后一次改动不丢，Tauri 关窗不保证 `beforeunload` / `pagehide`，防抖窗口里 ⌘Q 就丢；当场写之后页面这一侧没有「还没写」的状态，也就不用挂任何关窗兜底。代价是长草稿（粘贴了几千行再打字）每一键都整段 `setItem` 一次；写入前比对上次写下的文字，相同就跳过（加删图片、重新挂载时的回写都不会再写一遍）。WebKit 把 localStorage 落盘本身还有它自己的节奏，页面管不到，这一点只能真机看（见下）。
- 清理放在哪：放在 `forgetDeletedSessions`。它是删除的唯一汇合点：本页删（`deleteSessionPermanently`、批量删、清空归档）在 Core 确认后走它，别处删（CLI、手机、另一页）由 Core 的 `session-deleted-external` 广播走它，重置主对话也经 `applyExternalSessionDeleted` 走它（`main-chat-reset.ts` 原本就逐个 drop，留着，幂等）。写操作都要经 Core，Core 跑在 App 里，所以 App 关着时不会有会话被删，不需要启动时再比对一遍。没选「会话列表加载后比对」：`hydrate` 的 `list_sessions` 按当前运行时过滤（`runtimeKind`），拿它比会把另一个运行时的会话草稿当孤儿删掉；要比就得另发一次不过滤的 `list_sessions`，为一个已经封住的口子多一次启动 IPC，不值。归档的会话不清（还能恢复）。
- 写失败（配额满、存储被禁）：内存照旧，同时把这个键在盘上的旧文字删掉，免得重启后冒出一份更早的草稿；之后写入恢复时下一次改动照常写。读 `window.localStorage` 本身抛错时整模块退回纯内存。全部静默，不弹提示。
- 键名照票里的例子用 `galley.draft.`（与已有的 `galley_theme_preference` 风格不同，按票走）。

**测试**

- `lib/composer-draft.test.ts` 新增 7 条（node 没有 localStorage，测试里放一个内存版 `Storage`，`vi.resetModules()` 后重新 import 模拟重启）：重启后文字还在、图片不在；只写改了的那个键、文字没变不写；清空 / 发出 / drop 即删，只剩图片时盘上不留；读回后再发出即删；配额抛错退回内存且不留旧文字、恢复后照写；拿不到 storage 时纯内存；不碰别的 localStorage 键、读回时删掉空白键。
- `stores/sessions.core-broadcast.test.ts` 删除那条加断言：删 `a` 后 `a` 的草稿没了、`b` 的还在。
- `pnpm --dir gui typecheck`、`lint` 通过；相关 5 个文件 91 条通过。

**JC 真机验收**

1. 主对话写半句不发；工作台某个会话写半句不发；新对话空状态也写半句。
2. ⌘Q 退出（最好打完最后一个字立刻 ⌘Q，测「最后一次改动不丢」）→ 重开（或 `tauri dev` 重启）。
3. 三处草稿都在；不在主对话时侧栏助手卡片显示「草稿：…」。
4. 带一张图的草稿重启后只剩文字（预期如此）。
5. 发出 / 清空后再重启，草稿不回来。
6. 若第 2 步立刻 ⌘Q 丢了最后几个字：那是 WebKit 落盘的节奏，页面这一侧已经当场写了，告诉主会话再议（可选的补救是 Rust 侧退出前等一下，超出本票「只改 GUI」）。
