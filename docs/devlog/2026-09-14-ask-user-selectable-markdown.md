# 2026-09-14 · ask_user 提问改走 MarkdownView：可选中 + 软换行保留

> Status: implemented · Related:
> `docs/design/conversation.md` §ask_user 提问气泡 ·
> `gui/src/components/conversation/AskUserBubble.tsx` ·
> `gui/src/components/conversation/MarkdownView.tsx`

## Context

社区反馈：AskUser 界面不能复制文字，需要引用问题内容时体验很差。

排查：`globals.css` 的 `body` 是 `user-select: none`（桌面纪律，防拖拽出蓝色
选区），内容面靠各组件加 `select-text` 逐个开回来。`AskUserBubble` 的实时
提问和 `AnsweredAskUser` 回显都是裸 `<div>{question}</div>`，两处都漏了。
同类组件全都开了：`SystemMessageBubble` 的 side_question 走 `MarkdownView`
自带 `select-text`，用户消息 / agent 正文 / 工具输出 `<pre>` / 审批路径也都
可选。foundations.md §2.6 写得很直白：内容区域必须保留可选择文本，
「Galley 是工作台，复制内容是核心任务」——所以是遗漏，不是取舍，规范赢。

## Decisions

### D1. 不止加 `select-text`，正文改走 `MarkdownView`

一行加 `select-text` 就能修复反馈；但 GA 的 ask_user 问题里常见编号选项、
路径、行内代码，纯文本 `whitespace-pre-wrap` 渲染把这些都摊平了。改走
`MarkdownView variant="agent"` 与同一黄框里的 side_question 对齐：同一套
markdown 排版、同一字体寄存（CJK 衬线）。JC 裁决做。

### D2. 单换行保留为换行：加 remark-breaks，`softBreaks` opt-in prop

风险点：`MarkdownView` 只挂 remark-gfm，段落内单换行会合并。GA 的
`ask_user(question)`（`managed-ga/code/ga.py`）只是透传字符串，TUI /
Telegram 前端按纯文本打印，从没承诺 markdown；LLM 写「第一行\n第二行」时
合并会把两个问句并成一句，改变问题意思。

两个选项：接受 markdown 语义靠 dogfood 观察 vs 加 remark-breaks。选后者：
问题文本来源不受我们控制，塌行直接改变语义；remark-breaks 只碰段落内软
换行，列表 / 代码块 / 空行分段不受影响。代价是一个依赖 + 一个 prop。prop
默认关，只给 ask_user 用——agent 回答是按 markdown 写的，软换行就该折行。

### D3. 回显同路径，降权靠 `[&_p]/[&_li]` 覆盖

`AnsweredAskUser` 也走 `MarkdownView` + `softBreaks`，用与 Goal 叙述 callout
相同的手法把字号压到 `--conversation-echo-size`、墨色到 ink-soft。同一段
文字实时与回显只差大小和墨色，避免两处渲染语义分叉。

### D4. 不接：selectionCopyScope / MessageActions / chip 复制

`selectionCopyScope` 的浮动复制工具栏语义是「复制回答」，不开；不挂
`MessageActions` 的 Copy 按钮。候选 chip 是 `<Button>`，全局
`.select-text button { user-select: none }` 明确压掉，且 40 字截断只在
tooltip 里展示全文——想复制某个选项改几个字再回目前做不到。需求真实度
没数据，JC 裁决先不做，进 [deferred](./deferred.md)。

### D5. Composer 占位文案按候选数分支（真机验收时浮出）

JC 真机验收时看到问题正文下没有 chip，怀疑渲染吃掉了选项。查原始模型
响应日志（`managed-ga-state/temp/model_responses`）：gpt-6-astra 的
`ask_user` 调用参数只有 `question`，没有 `candidates`——模型对开放式问题
就是不给选项，渲染没问题。误导来自 Composer 占位「回复，或选择上方候选」
是无条件的：只要有待回答的提问就显示，上面一个候选也没有时它让人去找
不存在的东西。

改法：`composer-register.ts` 的 `reply` 寄存按 `askUserHasCandidates`
分成 `reply`（有 chip，「回复，或选择上方候选」）和 `replyOpen`（无 chip，
「回复上方提问」）。引导模型多给候选属于
[.scratch/ask-user-option-desc](../../.scratch/ask-user-option-desc/PRD.md)
03 票的 managed patch 范围，本次不碰。

顺带印证 D2：库里 2026-08-24 那条 ask_user 的问题正文是
「…流程\nA. …\nB. …\nC. …」，单换行排选项，正是 softBreaks 要保住的形状。

## Verification

`pnpm --dir gui typecheck` / `lint` / `vitest`（新增 `MarkdownView.test.tsx`
覆盖 softBreaks 开关、列表与代码块不受影响、`select-text` 常在；
`composer-register.test.ts` 覆盖占位分支）/
`git diff --check`。衬线寄存与换行效果由 JC 真机验收。
