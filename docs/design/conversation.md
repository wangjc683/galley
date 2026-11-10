# Conversation 主区与 Composer

> 本文件已于 2026-11-10 拆分为 [docs/design/conversation/](./conversation/README.md)（路由表在那里），此处只保留跳转桩：下面每个标题是原文的一节，原样保留标题，旧链接的锚点因此照旧落在这里，再点一下到它现在的位置。请勿在本文件继续追加设计内容。

### 4.3 Conversation 主区

→ [conversation/turns.md](./conversation/turns.md#43-conversation-主区)

#### Turn 结构

→ [conversation/turns.md](./conversation/turns.md#turn-结构)

#### User vs Agent 三重区分（单侧容器，不是 IM 双侧气泡）

→ [conversation/turns.md](./conversation/turns.md#user-vs-agent-三重区分单侧容器不是-im-双侧气泡)

#### 杏沙气泡（2026-09-17 起；此前 08-06 高亮笔、05-14 callout 色板）

→ [conversation/turns.md](./conversation/turns.md#杏沙气泡2026-09-17-起此前-08-06-高亮笔05-14-callout-色板)

#### 发送时间（2026-09-28 起：只在断点常显）

→ [conversation/turns.md](./conversation/turns.md#发送时间2026-09-28-起只在断点常显)

#### 助手的对话（2026-10-15）

→ [conversation/assistant.md](./conversation/assistant.md#助手的对话2026-10-15)

#### Right Question Rail

→ [conversation/turns.md](./conversation/turns.md#right-question-rail)

##### Hover tooltip 的内容契约

→ [conversation/turns.md](./conversation/turns.md#hover-tooltip-的内容契约)

#### Thinking Summary

→ [conversation/turns.md](./conversation/turns.md#thinking-summary)

#### Goal 章节框（已退役）与叙述 callout

→ [conversation/turns.md](./conversation/turns.md#goal-章节框已退役与叙述-callout)

#### 停在步数上限 = 可恢复态（2026-10-01，[galley#29](https://github.com/wangjc683/galley/issues/29)）

→ [conversation/turns.md](./conversation/turns.md#停在步数上限--可恢复态2026-10-01galley29)

#### ask_user 提问气泡（`AskUserBubble` / `AnsweredAskUser`）

→ [conversation/turns.md](./conversation/turns.md#ask_user-提问气泡askuserbubble--answeredaskuser)

#### 回复下的卡片（一框列表）（2026-11-03，主聊天票 133）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#回复下的卡片一框列表2026-11-03主聊天票-133)

#### 文件卡片（2026-10-21，主聊天票 74）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#文件卡片2026-10-21主聊天票-74)

#### 子任务卡片（2026-10-13，主聊天票 06a）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#子任务卡片2026-10-13主聊天票-06a)

#### 提醒卡片（2026-10-16，主聊天票 37）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#提醒卡片2026-10-16主聊天票-37)

#### 待办卡片（2026-10-17，主聊天票 42）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#待办卡片2026-10-17主聊天票-42)

#### 备忘卡片（2026-10-26，主聊天票 97）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#备忘卡片2026-10-26主聊天票-97)

#### 待办面板（2026-10-17，主聊天票 42）

→ [conversation/reply-cards.md](./conversation/reply-cards.md#待办面板2026-10-17主聊天票-42)

#### Markdown 渲染

→ [conversation/rendering.md](./conversation/rendering.md#markdown-渲染)

#### 流式回溯抖动（2026-08-12）

→ [conversation/rendering.md](./conversation/rendering.md#流式回溯抖动2026-08-12)

#### 纵向节奏（2026-08-12）

→ [conversation/rendering.md](./conversation/rendering.md#纵向节奏2026-08-12)

#### 行内代码的暖色预算（2026-08-12 定案）

→ [conversation/rendering.md](./conversation/rendering.md#行内代码的暖色预算2026-08-12-定案)

#### 代码块（容器 + Shiki 高亮）

→ [conversation/rendering.md](./conversation/rendering.md#代码块容器--shiki-高亮)

#### Message Actions（reply 级行动条）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#message-actionsreply-级行动条)

#### Scroll behaviour（stick to user message top）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#scroll-behaviourstick-to-user-message-top)

#### 会话切换：原子换入，不做 skeleton（2026-07-15）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#会话切换原子换入不做-skeleton2026-07-15)

#### 长对话按轮分页（2026-10-13）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#长对话按轮分页2026-10-13)

#### Streaming generation（流式 partial 渲染）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#streaming-generation流式-partial-渲染)

#### Sticky-bottom + Scroll-to-bottom 浮动按钮

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#sticky-bottom--scroll-to-bottom-浮动按钮)

#### Thinking Placeholder（in-flight 占位）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#thinking-placeholderin-flight-占位)

#### Live Thinking Preview（实时思考预览）

→ [conversation/streaming-and-scroll.md](./conversation/streaming-and-scroll.md#live-thinking-preview实时思考预览)

#### Turn 编号 + 间距

→ [conversation/turns.md](./conversation/turns.md#turn-编号--间距)

#### 间距演化历史

→ [conversation/turns.md](./conversation/turns.md#间距演化历史)

### 4.4 Composer

→ [conversation/composer.md](./conversation/composer.md#44-composer)

#### 视觉

→ [conversation/composer.md](./conversation/composer.md#视觉)

#### 会话里的输入框（2026-10-15）

→ [conversation/composer.md](./conversation/composer.md#会话里的输入框2026-10-15)

#### Goal 模式（armed）（已退役）

→ [conversation/composer.md](./conversation/composer.md#goal-模式armed已退役)

#### Submit 按钮（杏沙 CTA 例外）

→ [conversation/composer.md](./conversation/composer.md#submit-按钮杏沙-cta-例外)

#### ＋ 菜单（2026-10-03）

→ [conversation/composer.md](./conversation/composer.md#-菜单2026-10-03)

#### 常用提示词入口（V0.2.16；2026-10-03 移入 ＋ 菜单）

→ [conversation/composer.md](./conversation/composer.md#常用提示词入口v02162026-10-03-移入--菜单)

#### LLM 切换器（V0.1）

→ [conversation/composer.md](./conversation/composer.md#llm-切换器v01)

#### Trigger 与弹层（2026-07-20 定稿；2026-10-05 移出审批模式）

→ [conversation/composer.md](./conversation/composer.md#trigger-与弹层2026-07-20-定稿2026-10-05-移出审批模式)

#### 不显示

→ [conversation/composer.md](./conversation/composer.md#不显示)

## 7. Empty State（无 session 时主区）

→ [conversation/empty-state.md](./conversation/empty-state.md#7-empty-state无-session-时主区)

### 视觉

→ [conversation/empty-state.md](./conversation/empty-state.md#视觉)

### 主对话的问候（例外，2026-10-12，PRD 裁决 47，票 04c；2026-10-13 裁决 49 只留第一段）

→ [conversation/empty-state.md](./conversation/empty-state.md#主对话的问候例外2026-10-12prd-裁决-47票-04c2026-10-13-裁决-49-只留第一段)

## 本地文件引用与 Markdown 预览

→ [conversation/files-and-git-review.md](./conversation/files-and-git-review.md#本地文件引用与-markdown-预览)

## Git 工作区改动审阅

→ [conversation/files-and-git-review.md](./conversation/files-and-git-review.md#git-工作区改动审阅)
