# issue #27 审阅：历史对话搜索，其实缺的是「定位到那条消息」

日期：2026-09-08

## 来源

社区 issue [#27](https://github.com/wangjc683/galley/issues/27)（作者 yqarmy1，
Windows 10，Galley 0.4.11）：希望用关键词搜历史对话，搜到后跳到那个会话、
那条消息；作者注意到 CLI 有 `galley sessions search`，认为 GUI 没有对应入口。
评论者 sorangegu 另提了一条侧栏问题，见文末。

## 现状对表

- **跨会话全文搜索：早就有。** Sidebar「搜索 Ctrl+K」→ 命令面板，两个字以上
  就查 SQLite FTS5（三元组，2 字走 LIKE），命中片段高亮，按会话最近活动排序，
  分组「在对话内容中」。05-13 和 CLI 同一批做的，同一张 `messages_fts`。
- **没被发现的原因**：入口叫「搜索」，面板长得像命令启动器；「更早」「已归档」
  弹窗里的搜索框只搜标题；GUI 文档没提。
- **真正缺的**：① 点命中只打开会话，不定位到消息——命中带 `turnIndex` 但
  Conversation 没有锚点；② 面板搜索排除已归档（SQL `status != 'archived'`），
  CLI 有 `--all`；③ 会话内 Ctrl+F 没有；命中上限 8 条。

## 裁决（JC，2026-09-08）

- 做「定位到消息」。
- 归档纳入搜索、入口文案改「搜索对话」：都不做。
- 会话内 Ctrl+F：进 deferred。
- 评论者的侧栏问题：回帖问清楚，文案 JC 自拟。

## 落地：定位到消息

锚点选**消息 id** 而不是 turnIndex：GUI 的 `AgentTurn.turnIndex` 是每条用户
消息内的步号（第 N 步），SQLite 存的是会话内绝对轮次，两者不对齐；而行 id
`msg_<会话>_<绝对轮次>_<角色>` 是 Core 定义的确定性主键，恢复时直接从行取，
实时 agent 轮次在 `turn_end` 处按同一格式算出（`absoluteTurnIndex` 本来就在
手里），外部写入的用户消息带着 `turnIndex` 也能算。实时乐观追加的用户消息
没有 id，但那不是搜索的场景（搜的是"以前聊过的"）。

- `UserTurn` / `AgentTurn` 加可选 `messageId`；`rowsToTurns` 取 `row.id`。
- `MessageUser` 的 `data-role="user-msg"` 块和 `MessageAgent` 的根都挂
  `data-message-id`。agent 只挂在最终回答上（FTS 也只索引 `final_answer`），
  折叠的过程区不参与。
- 定位请求放 ui store（`locateRequest`），面板选中命中时先 `requestLocate`
  再 `activateSession`。消费方是 `useStickyScroll`——它本来就拥有整台滚动
  机器：等 `restoring` 清掉、turns 上屏后，30 帧内找节点，找到就按
  `USER_MSG_ANCHOR_TOP_PX` 那根统一锚线 `scrollBy`，加 1.4s 的
  `message-locate-flash` 洗染，然后清请求；找不到静默放弃。会话切换时的
  「回到底部」效果看到同会话的待定位请求就让位，否则 ResizeObserver 那
  500ms 窗口会把人拽回底部。
- 面板的 `onOpenMessage` 缺省回退到 `onOpenSession`，老调用方不受影响。

## 被否 / 搁置

- 归档纳入搜索：JC 裁决不做。已归档在产品语义上是"收起来的"，搜索跟随。
- 入口文案「搜索对话」：JC 裁决不做。
- 会话内 Ctrl+F：deferred，方案已记。
- 用 turnIndex 做锚：两套编号不对齐，见上。

## 评论者 sorangegu 的问题（另一件事）

"找不到之前对话的入口、只能搜索才看到；点活跃项目弹出的是新建会话，和顶部
新建重复"。排查结论：不是回归。一周以前的会话折叠进「更早 N ›」一行（05-13
的 Claude pattern）；项目抽屉只列**归入该项目**的会话，空项目只剩「+ 新建
项目对话」CTA，而"活跃项目"分组把 7 天内的新建空项目也算活跃，展开还会软设
项目过滤让顶部按钮改名——于是他看到两个新建。两种读法（想看清单 / 想直接
打开最近一次）在代码上殊途同归：抽屉里出现新建按钮**只有**项目为空这一种
情况。待用户确认后再议归入规则是否要改（例如空项目抽屉给"移入已有对话"
入口）。

## 验证

`pnpm --dir gui typecheck` / `lint` / `test`（358 通过，含新增的 messageId
恢复测试）/ `build` 通过，`git diff --check` 干净。真机验收留给 JC：搜一个
旧会话里的词、点命中，看落点是否停在锚线、洗染是否安静。
