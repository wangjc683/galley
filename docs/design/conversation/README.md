# Conversation 主区与 Composer

> Galley 设计系统 · 原 DESIGN.md §4.3–§4.4 与 §7（2026-07-04 拆分）：turn 结构、Markdown / 代码块渲染、滚动与流式行为、Composer、Empty State。

2026-11-10 起按一次工作会话通常一起读的内容拆成下面八篇，正文原样搬过来，没有改写；原路径 `docs/design/conversation.md` 留作跳转桩，旧链接的锚点在那里照旧找得到。只读当前任务相关的那一篇即可。

| 篇 | 原章节 |
|---|---|
| [turns.md](./turns.md)：Turn 结构、你的消息与提问 | §4.3 的工作台部分：Turn 结构、User vs Agent 三重区分、杏沙气泡、发送时间、Right Question Rail、Thinking Summary、Goal 章节框（已退役）与叙述 callout、停在步数上限、ask_user 提问气泡、Turn 编号 + 间距、间距演化历史 |
| [assistant.md](./assistant.md)：助手的对话 | 助手的对话（主对话的 IM 画法：气泡、分组间距、在跑时、过程、时间、滚动、子任务叫醒、消息菜单） |
| [reply-cards.md](./reply-cards.md)：回复下的卡片与待办面板 | 回复下的卡片（一框列表）、文件卡片、子任务卡片、提醒卡片、待办卡片、备忘卡片、待办面板 |
| [rendering.md](./rendering.md)：Markdown 与代码块渲染 | Markdown 渲染、流式回溯抖动、纵向节奏、行内代码的暖色预算、代码块 |
| [streaming-and-scroll.md](./streaming-and-scroll.md)：行动条、滚动与流式 | Message Actions、Scroll behaviour、会话切换、长对话按轮分页、Streaming generation、Sticky-bottom 与浮动按钮、Thinking Placeholder、Live Thinking Preview |
| [composer.md](./composer.md)：Composer（输入区） | §4.4 Composer：视觉、会话里的输入框、Goal 模式（已退役）、Submit 按钮、＋ 菜单、常用提示词入口、LLM 切换器、Trigger 与弹层、不显示 |
| [empty-state.md](./empty-state.md)：Empty State 与主对话的问候 | §7 Empty State：视觉、主对话的问候 |
| [files-and-git-review.md](./files-and-git-review.md)：本地文件引用与 Git 工作区改动审阅 | 本地文件引用与 Markdown 预览、Git 工作区改动审阅 |

改这几篇时：一节只住在一篇里；新加的一节放进内容最近的那一篇，并在上表补一笔；跨篇引用写 `./<篇>.md#<锚点>`。
