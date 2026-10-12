# 02（B）主聊天形态

Status: in-review（`034b9169` 本地合入未推送，2026-10-12；待 JC 用切换器真机比 A1 / A2；CLI 归档守卫待裁，见 Comments）

来源：主聊天 PRD 裁决 1、3、12、14、24（2026-10-09、10-12）。

## 目标

桌面上有一条一直在的主聊天，启动就打开它；侧栏层级按 A1 / A2 做切换器真机比；主聊天在跑时发消息有「排队 / 开旁聊」两个选择。

## 范围

- **会话类型**：库里标记主聊天（迁移；加迁移要补 core/tests 与 cli/tests 的六处手写列表）。每个内置运行时最多一条，首次需要时创建。
  不能归档、删除、重开，菜单里对应项不出现。CLI / Agent API 只做加法（Rule 3）。
- **启动**：打开主聊天，替代今天的空白新对话（`gui/src/stores/ui.ts:73`）。第一次用时为空，按空状态规则不放欢迎文案、不放快捷提示
  （`docs/design/conversation.md:765`、`:788`）。
  2026-10-12 改（PRD 裁决 47，票 04c）：主聊天建出来时已经有 AI 的第一句问候，主聊天不再按空状态规则留空。
- **侧栏切换器**（PRD「桌面形态」表）：
  - A1：主聊天行在新对话行上面，其余不变。
  - A2：主聊天行接任逃生出口（固定、不随列表滚动、启动即选中）；新对话改名「新旁聊」进书眉成为第四个图标，⌘N 不变；窄宽回落（`docs/design/layout-and-chrome.md:45`）重做。
  - 两案共同：主聊天行用会话行同一套样式，靠位置和图标区分，不用品牌色（`:59`）；状态照会话行规则。
  - 切换器是常驻可点击 pill（portal + `pointer-events: auto`），测完拆，裁决进 devlog 与 `docs/design/layout-and-chrome.md`。
  - 动手前查 `docs/design/` 侧栏一节的禁令（`:172`、`:173`、`:178`、`:183`、`:189` 已知相关）。
- **排队 / 开旁聊**：主聊天在跑时发消息，给两个选择。补充说明（「要靠窗的座位」）应排队进正在跑的任务，所以不能一律自动开旁聊。
  开旁聊 = 用这句话新建一个普通会话。默认选中哪个待定，真机定。
- 只在内置：外置模式不出现主聊天行，侧栏与启动照旧（外置零变化）。

## 不做

- 切段与注入（03）、子任务卡片（06）、主动提醒（05）。上线时上下文由 GA 现有裁剪兜底。

## 验收

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`cargo test --manifest-path core/Cargo.toml --workspace`、`git diff --check`。
- JC 在 tauri dev 里用切换器比 A1 / A2 并裁决。

## Comments

2026-10-12 实现回报要点（Opus 子代理，主会话复核门禁：Rust 871 通过、GUI 1033 通过、typecheck / lint / diff check 通过）：
- 迁移 044：`sessions.main_chat`，CHECK 只允许内置行，部分唯一索引保证最多一条；标题存「主聊天」，自动标题与空会话清扫都不碰它。
- Core：Tauri 命令 `get_or_create_main_chat`；桌面写路径 `Writes::protecting_main_chat()` 拒绝单条归档 / 删除、批量时跳过；被 CLI 归档的主聊天下次启动自动恢复。
- 待裁：socket（CLI / supervisor）写路径不拦，agent 仍能 `session archive` 主聊天。选项：（a）保持；（b）用现有 `invalid_args` 拒绝（不新增错误标识，但让一个已有命令在 schemaVersion 2 内对一条会话开始失败，不算严格加法）；（c）等 schemaVersion 3。
- A2 窄宽回落：四个图标放不下时（mac 283px）落到书眉下单独一行；代价是跨过门槛时主聊天行与列表下移一行。
- 粗糙处：启动时空白新对话先闪一下再切到主聊天；⌘K、设置快捷键页、空屏标题仍叫「新对话」，A2 胜出后再改名。
- 切换器移除步骤见子代理回报：删 `main-chat-layout.ts`、`MainChatLayoutSwitcher.tsx`，`App.tsx` 一行，`Sidebar.tsx` 按胜出方收拢，测试去掉 mock。

2026-10-12 JC 裁：CLI 归档守卫选（a）保持现状——Rule 3 要求 schemaVersion 内只做加法；被 CLI 归档的主对话下次启动自动恢复，代价只是侧栏暂时少一行。真遇到 agent 误归档再议。
