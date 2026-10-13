# 12 对话历史按轮分页加载

Status: ready-for-agent

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
