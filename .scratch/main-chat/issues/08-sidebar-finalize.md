# 08 侧栏收尾：B′ 转正

Status: done（`a3d7254b` 已推送；英文文案待 JC 过目）

来源：主聊天 PRD 裁决 34–36（2026-10-12，JC 真机比 07 后定 B′ + 其他对话，删主对话空态副行）。依赖 07（已本地合入 `6df6ec44`）。只改 GUI 与文档，不碰 Rust。

## 目标

把 07 的试验收成正式代码：有主对话时侧栏就是 B′，外置运行时保持今天的侧栏；试验脚手架全部删掉；设计文档与文案规范跟着改。

## 代码

- 删除：切换器（`MainChatLayoutSwitcher.tsx` 及 `App.tsx` 那一行）、演示叠加层（`main-chat-demo.ts` 及两个状态 hook 里的读取，hook 回到试验前）、
  A3 分支与新对话行的 `quiet` / `newChatLabel`、不可收起的 B 路径、`main-chat-layout.ts`（试验 store 与文案表）。
  步骤见 `main-chat-layout.ts` 头部注释「B′ wins」。
- 有主对话 ⇒ 分区式侧栏 + 可收起；没有主对话（外置）⇒ 今天的侧栏，不可收起，没有收起按钮与 ⌘\。
- 收起状态存 Core prefs，照项目分区折叠的做法（`gui/src/hooks/useSidebarProjectsCollapsed.ts` 的 `getPref` / `setPref`），不用 localStorage。
- 删掉主对话行的空态副行（`idleSubline` 及「什么都可以跟它说」）。
- 文案进语言包（中文定稿，英文按 `docs/copy-language-guidelines.md`「英文版出稿流程」重写，不逐字翻译，回报里列出供 JC 过目）：

  | 位置 | 中文 |
  |---|---|
  | 主对话行、顶栏标题、⌘K | 主对话 |
  | 分区头 | 其他对话 |
  | 分区头加号提示、占位行、⌘N | 新对话 |
  | 分区空态说明 | 另开一个对话聊一件事，主对话不受打扰。 |
  | 其他来源组 | 其他来源 |
  | 收起 / 展开按钮 | 收起侧栏 / 展开侧栏 |
  | 收起时徽标提示 | N 个对话在等你 |
  | 忙时选择 | 主对话正在忙；排队（本轮结束后接着交给主对话）；开新对话（用这句话开一个新对话，马上开始）；带图的消息不能排队，可以开新对话 |
  | 输入框提示 | Enter 后选择排队或开新对话 |

  `sidebar.newSideChat`（「新旁聊」）等不再使用的键删掉。
- 设置 → 快捷键：加 ⌘\（Windows / Linux 为 Ctrl+\）「收起 / 展开侧栏」一行，只在内置运行时有意义的话照现有表的写法处理。

## 文档

- `docs/design/layout-and-chrome.md`：
  - 改「Sidebar 不可折叠」（`:22`）、「不放 Sidebar toggle」（`:71`）、第 193 行同义处：内置运行时有主对话时可收起，外置仍不可；写明前提为什么变了（主聊天 PRD 裁决 30）。
  - 「新对话独占一行 = 逃生出口」（`:172`）、「新对话是列表的开头，空状态时是选中行」（`:173`）：有主对话时由主对话行（逃生出口）与分区头加号、占位行（「你在这里」）承接；外置照旧。
  - 新增：主对话行（固定、启动即选中、满墨色标题、无菜单、状态照会话行）、「其他对话」分区头（字号与时间桶标题的层级关系）、空态说明的出现规则、「其他来源」组（复用项目组的收起与挂出）、收起按钮与徽标（不用状态点）、⌘\、macOS 红绿灯让位。
  - 「去掉 ACTIVE / WAITING FOR YOU 区块」（`:183`）补一句新理由：当初的「Approval Dock 兜底」已随 10-05 移除审批失效，现在的理由是在跑的对话本来就在时间线顶部、子任务状态汇到主对话行。
- `docs/copy-language-guidelines.md`：「项目与对话」一节加：主对话 / 其他对话 / 新对话；「主聊天」「旁聊」只作内部术语，不进界面。快捷键正文表加 ⌘\。
- `AppShell.tsx` 头部注释里「不可折叠」的说法同步。`core/src/app_menu.rs:247` 的注释同义，但本票不碰 Rust，在回报里列出留给下次碰 Rust 的票。

## 不做

- 原生菜单里的「显示 / 隐藏侧栏」（要 Rust）。
- 07 已知的两点照旧：从项目组加号新建时占位行出现在分区顶部；收起侧栏时书眉的搜索 / 定时 / 新建项目看不到（⌘K 可用）。

## 验收

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`、`git diff --check`、`node scripts/check-docs-links.mjs`。
- 测试：有主对话 ⇒ 分区与收起；外置 ⇒ 今天的侧栏、无收起；收起状态读写 prefs；文案定稿。

## Comments

2026-10-12 实现回报要点（主会话复核：GUI 1054 通过、typecheck / lint / diff check、文档链接检查通过）：
- prefs 键 `sidebar_collapsed`，照项目分区：读回之前的切换优先、读回后写回。
- 与试验的两处不同：收起时的徽标把主对话也计入（不在主对话里时）；⌘K 与顶栏标题跟随界面语言（试验时总是中文）。
- 设置 → 快捷键：「导航」里 ⌘N 之后加「收起 / 展开侧栏」，注「使用外部 GA 时不生效」。
- 英文待过目：分区头 Chats（直译备选 Other chats）；空态 Give one thing its own chat. The main chat stays uncluttered.；忙时 New chat / Start a new chat with this message now；徽标 N chats need you；开关 Hide sidebar / Show sidebar。
- 留给下次碰 Rust 的票：`core/src/app_menu.rs:247` 注释仍写侧栏不可折叠；原生菜单「显示 / 隐藏侧栏」。
