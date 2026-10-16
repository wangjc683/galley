# 01 草稿存到磁盘

Status: ready-for-agent

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
