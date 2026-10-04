# 顶栏「显示」：宽度 / 字号 / 主题合进一个 popover，改动按钮只在知道仓库时出现

Date: 2026-10-04
Status: committed (`d83e9b36`), unpushed; static gates green (typecheck / lint / vitest 587 /
cargo check + test / diff check); awaiting JC's live acceptance in `tauri dev`; unreleased
Related: [layout-and-chrome §4.1](../design/layout-and-chrome.md)（工具簇、外观控件标准形态）、
[overlays-and-settings](../design/overlays-and-settings.md)（General、命令面板、§10 快捷键）、
[conversation.md 本地文件引用与预览](../design/conversation.md#本地文件引用与-markdown-预览)（改动入口）、
[07-05 外观控件语法](./2026-07-05-topbar-appearance-controls-grammar.md)、
[09-08 Git 工作区审阅](./2026-09-08-git-worktree-review.md)、
[07-15 View 菜单宽度子菜单](./2026-07-15-desktop-craft-polish-round.md)

## 起因

顶栏右侧的工具簇按钮越来越多，新手要认的图标也越来越多。JC 想降低这份认知负担，同时坚持外观
偏好要能**就地调、看着对话即时变化**，而不是只能去 Settings 里调。

## 事实底座

- 工具簇 07-05 定形时四个按钮：宽度 → 字号 → 主题 → 齿轮。之后 09-08 加了「改动」（`GitDiff`），
  10-03 加了 Supervisor SOP，涨到六个。其中三个（宽度 / 字号 / 主题）是同一类低频阅读偏好。
- 07-05 devlog 的被否方案「字号 + 宽度合并为一个『阅读显示』面板」留了重评条件：「若工具簇继续
  膨胀可重新评估」。这个条件已经触发。
- 主题、字号在 Settings → General 已有；阅读宽度没有（overlays-and-settings 记着「有意不进
  General」）。macOS View 菜单早有 Conversation Width 子菜单（07-15），字号没有。
- 页面缩放已关（`zoomHotkeysEnabled: false` + 滚轮 / 手势拦截），`⌘+ / ⌘− / ⌘0` 空着。
- 「改动」按钮无条件常驻。没有候选仓库时（会话不属于项目、本窗口也没审阅过仓库），点它只打开
  一个「选择仓库」空面板。

## 方案与裁决

- **A** 保持三个按钮：零改动，工具簇维持六个。
- **B** 三个合成一个「显示」按钮，popover 里三行（推荐，JC 选定）。代价：宽度从一击变两击。
- **C** 只合并字号 + 主题，宽度保留一键按钮：宽度不变慢，但工具簇只少一个，且外观偏好分两处。
- 只放 Settings：Settings 是遮住对话区的模态，切了看不到效果，即时预览没了，不符合 JC 的要求。

JC 选 B，接受宽度从 1 击变 2 击。这翻了 07-05 的被否方案，且是按它自己写下的重评条件翻的：
当时被否的理由是「宽度切换从 1 击变 2 击」，那时工具簇四个按钮；现在六个，省位置的收益压过了
多一击。

## 定案

1. **「显示」按钮**：`TopBarIconButton` + `TextAa` 16px thin，tooltip「显示」/ Display，aria
   「显示设置」/ Display settings。Radix Popover（不是 DropdownMenu），选后不关闭；打开时的
   autofocus 抑制、打开态下沉、`align="end"` 都照旧字号控件。
2. **popover 内三行**：左列 muted 小标签（`text-ui-tertiary`），右列共享 `SegmentedControl`，
   三个控件左缘对齐（CSS grid 两列）。阅读宽度「紧凑 / 宽松」、字号「小 / 标准 / 大」、主题
   「跟随系统 / 浅色 / 深色」。「跟随系统」的解析结果（「当前浅色」）照旧做主题分段下方的
   caption，只在选中「跟随系统」时出现。按钮面仍不显示任何状态、不着色（07-05 决定 5 不变）。
3. **工具簇顺序**：改动 → 显示 → Supervisor SOP → 齿轮。状态簇与 SOP 按钮不动（主会话另有讨论）。
   宽度箭头的 14px 视觉补偿随宽度按钮退役，工具簇图标一律 16px。
4. **改动按钮只在知道仓库时出现**：当前项目有根目录（`repositoryHint`），或本窗口审阅过某个仓库，
   才显示；面板开着时一直显示，好用它关面板。「审阅过的仓库」原是 `LocalFileWorkspace` 里的一个
   ref，改成 state，第一次记住仓库时按钮才会出现；它只活在本窗口内存里，不持久化。
5. **命令面板「查看仓库改动」**（`GitDiff`）：始终可用，与按钮同一动作（有候选打开候选，没有就打开
   选择仓库的面板；面板已开时只聚焦，不重置仓库 / 文件 / 基线）。命令面板渲染在
   `LocalFileWorkspace` 之外，够不到 `GitReviewContext`，于是照 `requestLocate` 的先例走 UI store：
   `requestReview()` 递增 `reviewRequest`，`LocalFileWorkspace` 在 effect 里订阅 store、在回调中
   打开面板（不在渲染期、也不在 effect 体内同步 setState）。
6. **字号快捷键**：`⌘= / ⌘+` 放大一档、`⌘−` 缩小一档、`⌘0` 恢复标准（Windows / Linux 用 Ctrl），
   两端不循环。`+` 与 `=` 都认：US 键盘上 + 要按 Shift，别的布局 + 是独立键。带 Alt 不认，免得
   Windows 上 AltGr（= Ctrl+Alt）打字符被当成快捷键。
7. **macOS View 菜单**加 Conversation Font Size 子菜单：Small / Standard / Large 三个勾选项（单选
   语义，Rust 侧点击即刻翻勾，照宽度），分隔线下 Bigger / Smaller 两个普通项。加速键：Standard ⌘0、
   Bigger ⌘=、Smaller ⌘-。GUI 经新命令 `set_font_size_menu_state` 在 hydrate（持久值不是
   standard 时）和每次改字号时向内镜像，与 `set_width_menu_state` 同一套。
8. **一次按键只生效一次**：与 `⌘N` / `⌘,` 同一机制。AppKit 先拿到就由菜单处理，webview 收不到；
   webview 先拿到则 JS 处理器 `preventDefault`，WebKit 不再转给菜单。两条路径做的是同一件事，
   哪条先到结果都一样。
9. **阅读宽度不给快捷键**：没有约定俗成的键位，造一个没人记得。留在「显示」popover、General、
   View 菜单三处。
10. **Settings → General 加「阅读宽度」行**（字号行之后），同 `PreferenceRow` + 分段语法。这翻了
    「对话宽度有意不进 General」：那条的理由（模态遮住对话、切了看不到效果）仍然成立，所以即时预览
    的家仍是「显示」popover；但三项既然在顶栏合成了一个入口，General 作为权威清单只缺宽度就名不
    副实。
11. **Settings → Shortcuts** 的 Conversation 组加两行：`⌘= / ⌘-` 放大 / 缩小对话字号、`⌘0` 恢复
    标准字号。显示 ⌘= 而不是 ⌘+：Tauri 把加速键解析成物理键，没有 `+` 这个键；⌘= 也是 US 键盘
    实际按的键。

## 落地

- 新文件 `gui/src/components/layout/header/DisplayMenu.tsx`；删除 `WidthToggleButton.tsx`、
  `ConversationFontSizeMenu.tsx`、`components/theme/ThemePreferenceMenu.tsx`（其侧栏变体 07-17 起
  已无调用方，随文件一并清掉）。
  `EffortPill` / `LLMPill` 注释里的「兄弟 popover」引用改指 `DisplayMenu`。
- `MainHeader` 的 `onToggleConversationWidth` 换成 `onChangeConversationWidth(width)`；
  `GitReviewContext` 加 `repositoryKnown`，由 `MainHeaderHost` 决定是否传 `onToggleChanges`
  （照状态簇里渠道指示的条件传参写法）。
- `lib/conversation-font-size.ts` 加 `stepConversationFontSize`（带测试）；`useGlobalShortcuts`
  的按键与菜单事件共用一个从 store 读当前值的步进函数。
- 文案：新增 `topbar.display` / `topbar.conversationWidth` / `command.reviewChanges` /
  `settings.general.widthRow*` / `settings.shortcuts.fontSize*`；删掉随组件退役的
  `theme.button` / `theme.triggerLabel` / `topbar.compactWidth` 等四条宽度文案 /
  `conversationFontSize.small|standard|large`。
- Core：`app_menu.rs` 加 `FontSizeMenuState` 与 `set_font_size_menu_state`，`tray.rs` 菜单事件
  分派，`lib.rs` 注册命令。这是 Tauri 命令，不是 runner IPC，`gui/src/types/ipc.ts` 不用镜像。
- 两种运行时模式：外置与内置零差别（全是 GUI 与菜单层）。runner / CLI / Agent API 不动。

## 被否

- **A 保持三个按钮**：工具簇已到六个，正是 07-05 写下的重评条件。
- **C 只合并字号 + 主题**：宽度不变慢，但工具簇只省一个，外观偏好拆在两处，新手仍要认两个图标。
- **只放 Settings**：模态遮住对话区，即时预览没了。
- **字号加速键挂在三个勾选项上**（Small ⌘−、Standard ⌘0、Large ⌘+）：菜单里成了「选定某档」，
  JS 里是「走一档」；macOS 上哪条路径先到决定行为，从大号按 ⌘− 可能直接跳到小号。改用 Bigger /
  Smaller 两个步进项，与 TextEdit 的 Bigger / Smaller、Safari 的放大 / 缩小同一种语法。
- **Bigger 用 NumpadAdd 让菜单显示 ⌘+**：muda 会把它映射成 `+` 键位，能显示 ⌘+，但语义是小键盘加号，
  可读性差；与 Settings 里显示的 ⌘= 也对不上。

## 已知边角

- 「审阅过的仓库」只在本窗口内存里，重启后回到只看项目目录：不属于项目的会话里，改动按钮要等
  用户从命令面板或文件预览菜单再审阅一次才回来。
- 字号在最大 / 最小档时，菜单的 Bigger / Smaller 不置灰，按下无效果。
- Core 改动（菜单、命令）不热更，看效果要重启 `pnpm --dir gui tauri dev`。
