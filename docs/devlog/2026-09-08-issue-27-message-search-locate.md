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

## 真机验收撞到的第二个问题（同日）

JC 点命中进去是**整块空白**（rail 的点都在、回底部按钮也在），鼠标一滚内容
就出来。这不是新 bug，是 `useStickyScroll` 注释里写明的 WKWebView 老毛病：
DOM 快速换掉后有时跳过重绘，直到一次输入事件才画。原来靠会话切换时那次
`scrollTop = scrollHeight` 硬写入兼作重绘触发，而定位让那个效果让位后，落点
用的是平滑 `scrollBy`，不算硬写入，重绘触发就一起没了。修法：落点改成硬写
`scrollTop`（同像素时先弹一像素再回来，避免被优化掉），并照抄会话切换那套
500ms 的 ResizeObserver 窗口在后续 reflow 时重新停靠、用户一滚就退出。教训：
那个 snap 效果承担着两个职责，只看到"回底部"没看到"触发重绘"。

## 第三轮：看不到搜的那个词

重绘修好后 JC 反馈"跳过去没看到搜索词"。结构性原因：停靠的是消息块顶端，
词可能在块里几百像素以下，洗染又是整块。裁决两件一起做、生命周期选"停留到
下一次定位 / 切会话 / Esc"：

- 搜索词随 `LocateRequest.query` 带过去；在定位到的块里 TreeWalker 扫文本
  节点做不分大小写子串匹配（跨文本节点的命中不管，块级洗染兜底），
  上限 200 个 Range。
- 高亮用 **CSS Custom Highlight API**（`CSS.highlights.set("galley-locate")`
  + `::highlight()`），不往 react-markdown 的 DOM 里塞 `<mark>`——那会和
  React 调和打架。WKWebView（macOS 12 更新后的 WebKit）和 WebView2 都支持；
  没有就静默退回块级洗染。
- 锚线停第一个命中的行（`Range.getBoundingClientRect()`），ResizeObserver
  重停靠也跟着这个焦点走。
- 被否：rehype 插件包 `<mark>`（侵入 MarkdownView 且破坏 memo）；只停行不
  高亮（词还是要靠眼睛找）；高亮跟洗染 1.4s 一起消失（读的时间不够）。

## 第四轮：面板候选里的高亮

JC 问"搜索 dialog 的候选里是不是也该高亮"，截图里 `Terminal` 两边有空隙
但没底色。往下挖出两件事加一项裁决：

- **搜索 mark 一直在，只是画不出来。** 产物里是 `color-mix(in oklab,
  var(--color-brand) var(--opacity-soft), transparent)`，而 token 值是 `0.12`，
  `color-mix` 只认百分比，整条声明作废。全仓 `bg-xxx/[var(--opacity-*)]` 写法
  **77 处、31 个文件**全部静默透明：按钮的 accent-secondary / warning 填充、
  ToolCallout 十处、审批表单、健康检查卡、侧栏行、TopBar 徽章、模型设置原语。
  JC 裁决现在修：四个 token 改成百分比（light 4/12/20/40，dark 10/20/28/46），
  `globals.css` 里唯一一处 `calc(var(--opacity-strong) * 100%)` 去掉乘法。
  产物 grep 确认 `12%` / `20%` 且 hex fallback 带对了 alpha。**全局观感变化**，
  几十处填充第一次真正长出来，等 JC 真机过一遍。规则写进 foundations。
- **"没找到"和命中同屏。** cmdk 在查询变化时统计匹配数；防抖后才到的
  FTS 命中挂载晚、值注册在条目之后，渲染了却不更新 `filtered.count`。
  修法：有命中就不渲染 `Command.Empty`。
- **裁决**：面板 mark 响度和对话内统一（都用 `--opacity-strong`，一个常量
  `SEARCH_MARK_CLASS` 供两处 `<mark>`）；「最近会话」组改**子串匹配**（cmdk
  `filter` 自定义，全面板一种包含语义），标题 / 摘要按子串切片打 mark；候选池
  有查询时扩到全部会话、最多 8 条——原来只在最近 8 条里模糊匹配，按标题找
  老会话根本够不到。被否：保留模糊只在子串命中时高亮（两套规则）。

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
