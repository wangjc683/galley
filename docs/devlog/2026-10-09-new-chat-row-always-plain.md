# 侧栏新对话永远是普通新对话，打开会话清空项目上下文

Date: 2026-10-09
Status: 实现完成，typecheck / lint / vitest（906）/ diff check；JC 按推荐定 A，未上切换器
Related: [layout-and-chrome §Sidebar 关键决策](../design/layout-and-chrome.md)、
[10-09 项目体验打磨](./2026-10-09-project-ux-polish-pass.md)、[10-03 侧栏书眉（逃生出口）](./2026-10-03-sidebar-header-masthead.md)、
[05-22 Project Review](./2026-05-22-project-review-sidebar-ux.md)

## 起因

JC：打开一个项目的会话后，侧栏最上面的新对话按钮会变成在这个项目里新建。用户想开普通对话，要先点这个「新对话 · 项目名」，
再去输入框下面关掉项目，步骤多、绕，也缺乏逃生出口的直观。

## 规则从哪来

「新对话落在最后进入的项目里、打开项目会话就设上项目上下文」是 06-18 定的（`5d079550` Make project view a coherent workspace
and clarify its exit），当时 `App.tsx` 的注释：「项目视图是一个连贯工作区——New Chat 落在最后展开 / 最后进入的项目里（由 expand
或 select-session 设置）」。那时有项目视图，进入项目即进入工作区，这条成立。10-08 删掉项目视图、去掉了「展开即设上下文」一半
（D8），「打开会话设上下文」与「新对话不清空」一半留了下来——前提不在了，规则还剩一半在运作。

同日上午我把 ⌘K、消息搜索、「更早」三个入口也改成跟随会话（`aa609e7e`），理由是它们与侧栏行不一致。该质疑的是规则本身，
那次改动反而让这个问题更常出现。

## 为什么站不住

- 逃生出口：10-03 定的三条标准是显眼 / 能读 / 位置固定。这一行位置和样子固定，去处却随上下文变；设计文档把「永远不变」交给了
  ⌘N（「⌘N 是键盘上永远不变的逃生口」），而 07-05 定过 Galley 是鼠标优先——唯一恒定的出口在键盘上。
- 步骤：在项目会话里想开普通对话，要点「新对话 · 项目名」，再找输入框下那个 11px 的 ×，才能开始打字。
- 先例：ChatGPT 的文档说工作不需要项目文件与指令时选 New chat 开一个不属于项目的对话
  （[learn.chatgpt.com](https://learn.chatgpt.com/en-US/docs/projects)）；有用户描述新版侧栏是项目名负责展开 / 收起，旁边的小「新对话」
  图标在项目里开（[OpenAI 社区帖](https://community.openai.com/t/chatgpt-projects-no-longer-opens-the-same-project-page-view-as-before-chats-now-only-appear-in-the-sidebar/1381332)，
  一份用户报告，不是官方说明）。全局新对话保持普通，项目里新建的入口在项目行上——Galley 的组行 `+` 就是这个。

## 方案与裁决

- **A（推荐，JC 定）**：新对话行永远是普通新对话——标签永远「新对话」、⌘N 常显、点它清项目上下文。项目上下文只由明确的
  「在项目里新建」设置：组行 `+`、组行菜单新加的「新建项目对话」（不靠悬停的入口）、空项目 CTA、建完项目。所有打开会话的入口
  清空它（回到 05-22 的「一次性」语义），上午那条「跟随会话」反过来；移动会话不碰它。从组行 `+` 进入的项目新对话空状态不变，
  输入框下的 × 还在。代价：在一个项目里连开新对话要用组行 `+`（悬停才出现）或菜单。
- 被否：B 顶行拆成两个目标（主体普通、行尾「在『项目名』里」），快捷保住了但逃生行里多一个易误点的小目标、窄宽挤；C 现状加 ×
  清项目，仍是两步、行的含义仍随上下文变。

两种运行时无差别，纯 GUI。

## 实现

主会话直接做（四个源文件 + 测试 + 文案）：

- `SidebarQuickActions.tsx`：`NewChatButton` 去掉 `projectName`，标签固定「新对话」、⌘N 提示与悬停提示常在；`Sidebar.tsx` 删掉
  只为这个标签存在的 `activeProjectFilter` prop。
- `App.tsx`：`openSession` 改为清空项目上下文；侧栏 `onNewChat` 清空项目上下文（与 ⌘N、⌘K「新对话」同一动作）；注释改写。
- `useProjectNavigation.ts`：删掉上午加的「移动当前会话时同步上下文」与 `activeSessionId` 参数；测试改为断言移动会话不碰上下文。
- `SidebarProjectGroup.tsx`：组行 ⋯ / 右键菜单首项「新建项目对话」（复用 `sidebar.newProjectConversation`，与 `+` 同一动作）。
- 文案删掉不再使用的 `sidebar.newConversationInProject`。
