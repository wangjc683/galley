# Galley 设计系统

这里是 Galley 的设计系统文档，2026-07-04 从原单文件 `docs/DESIGN.md` 拆分而来
（机械拆分，正文保持原样；原文件保留为跳转 stub）。按「一次工作会话通常一起用到
什么」分篇，只读当前任务相关的那一篇即可。

原文件的文档级状态注记原样保留如下：

> Status: **v0.2.0 — current implementation baseline**
> Last updated: 2026-06-24
> 2026-06-24（二）：§4.1 全宽 TopBar 拆解为双栏各自 header（`SidebarHeader` + `MainHeader`，原 `TopBar.tsx` 更名）。承接当日「标题左对齐」——左对齐后短标题落在 Sidebar 上方、长标题横跨分割线，暴露「一条全宽 bar」与「下方两栏」的结构错配。改为每栏 panel 内长出自己的 44px header，宽度天然继承、`ResizeSeparator` 全高分隔、两栏两色（chrome/app），OS 窗口控制各归本栏（Mac 红绿灯→SidebarHeader 让 ~78px；Win window controls→MainHeader 右上）。
> 2026-06-24（一）：§4.1 session title 由「居中」改为「左对齐」（已被当日「二」进一步演进为双栏 header）。
> 2026-06-23：§2.2 字体重构为表格化 typography scale——浮出已有的对话阅读面 3-tier token（`conversation-font-size.ts`），新增 UI chrome `--text-ui-*` / `--leading-*` token（`globals.css`），收拢 eyebrow 配方 / serif kerning / 字重 tier；旧散文注记移入「设计注记」小节保留。
> 2026-06-09：Conversation metadata 瑞士化打磨（TurnMarker / thinking 态 / ToolCallout），并新增 §2.7 动效分类原则。
> v0.1（dark-first / Linear 风）已被 v0.2 整体方向替换，Notion 历史稿仅作对照。
> 本文件以当前两栏 Galley GUI 为准：旧三栏 Inspector、独立 Settings window、Project emoji tree 等历史 spec 已退役。
> 决策叙事与 rejected alternatives 见 [docs/devlog/](../devlog/) 中 2026-05-07 / 2026-05-08 的设计相关 entry。

## 路由表

| 主题（原章节） | 文件 | 内容 |
|---|---|---|
| 设计哲学与 Tokens（§1–§2） | [foundations.md](./foundations.md) | 设计哲学、源头分级；色板 / dark theme、typography scale、icon、圆角阴影、UI primitives、WebView discipline、动效分类 |
| 整体布局与窗口 Chrome（§3–§4.2） | [layout-and-chrome.md](./layout-and-chrome.md) | 两栏布局；SidebarHeader / MainHeader、YOLO / Browser Control indicator；Sidebar 结构、Session Row、Project 行 |
| Conversation 主区与 Composer（§4.3–§4.4、§7） | [conversation.md](./conversation.md) | turn 结构、Goal 章节框、Markdown / 代码块渲染、滚动与流式行为、Message Actions、Composer、Empty State |
| Tool Callout 与审批（§4.5–§4.7） | [tools-and-approvals.md](./tools-and-approvals.md) | Tool Event Callout 状态映射、Approval Dock / Card、工具特定渲染（diff 等）、Inspector 退役记录 |
| Onboarding 与卡片家族（§5–§6） | [onboarding-and-cards.md](./onboarding-and-cards.md) | Onboarding 流程、Attach / Health Check、Error Card、overlay 层级、首次失败 hint 系统 |
| Command Palette、Settings 与快捷键（§8–§10） | [overlays-and-settings.md](./overlays-and-settings.md) | ⌘K Command Palette、Settings modal 全部 tab（Runtime / Models / Channels / Approval / About / Agent / Shortcuts）、全局快捷键表 |
| 未决事项与历史对照（§11–§12） | [status-and-history.md](./status-and-history.md) | 当前 open 问题、推到未来版本的扩展、与 Notion 历史稿的关系 |

相关的「why」层文档：品牌气质见 [temperament.md](../temperament.md)，文本渲染红线见
[typography-principles.md](../typography-principles.md)，决策叙事见 [devlog](../devlog/README.md)。
