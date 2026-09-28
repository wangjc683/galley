# 01 侧栏顶部快捷入口四档临时切换器（现状 / A / B / E）

Status: done

先读 `../PRD.md` 和 `docs/design/layout-and-chrome.md` §4.2 Sidebar。本票做三种新布局和一个
临时切换器，给 JC 真机比较。只改 `gui/`，不 commit。

## 改哪些文件

- `gui/src/components/layout/sidebar/SidebarQuickActions.tsx`（主要改动）
- `gui/src/components/layout/Sidebar.tsx`（按档位决定顶部 / 底部放什么、底栏是否常驻）
- `gui/src/components/layout/sidebar/SidebarFooter.tsx`（E 档底栏）
- `gui/src/components/layout/sidebar/SidebarProjectReview.tsx`（新建项目「＋」的新位置）
- `gui/src/i18n/locales/zh.ts`、`en.ts`（仅当悬停提示需要新文案时）
- 新建临时文件：切换器状态与切换器组件，所有临时代码带 `TEMP(sidebar-quick-actions)`
  注释，方便事后 grep 拆除。

## 四档

**现状**（`current`）：不变，作对照。

**A 一行**（`row`，默认）：
- 一行里左边是新对话（保留现在的品牌色加号、medium 字重、文字），右边是搜索 / 定时 /
  项目三个图标按钮（图标沿用现在的 `MagnifyingGlass` / `Clock` / `Folder`·`FolderOpen`）。
- 图标按钮用 `IconTooltip`，提示写名称和快捷键：「搜索 ⌘K」「定时」「项目」/「退出项目
  视图」（项目开启时）。新对话的 ⌘N 也移进它自己的悬停提示，行尾不再显示快捷键。
  快捷键用 `formatShortcut`。
- 定时徽标：缩成图标右上角的小数字（保留 warning 色、只在计数 > 0 时出现、保留计数
  增加时的 `sidebar-state-pop` 与挂载抑制逻辑）。
- 项目按钮开启时：按下态沿用现在 `ProjectQuickAction` 的语言（`bg-selected/85` +
  `shadow-inner` + `FolderOpen` + `text-brand-strong`），落在图标按钮上。
- 新建项目的「＋」不再在顶部（见下方「新建项目」）。
- 窄宽度：侧栏最窄约 134px。用容器查询（Tailwind v4 的 `@container` / `@max-[…]:`，
  仓库里还没人用过，自行确认写法）在放不下时把新对话的文字隐藏、只留加号（加号仍有
  悬停提示）。英文标签更长，项目上下文里新对话的标签也会变长（`newConversationInProject`），
  文字要能 truncate。门槛按实际宽度算，写成注释说明怎么算的。
- 图标按钮的尺寸、间距、悬停、按压参照现有 32px 图标按钮（`ProjectQuickAction` 里新建
  项目那个按钮的写法），悬停瞬时，按压是 `translate-y-px` 键程。

**B 两行**（`two-rows`）：
- 第一行新对话，同现状（保留 ⌘N 提示）。
- 第二行：搜索 / 定时 / 项目三个带图标和文字的小按钮平分一行（定时徽标跟在「定时」后面，
  项目开启时同样的按下态）。
- 窄宽度：放不下文字时退成只剩图标（容器查询）。

**E 底栏**（`footer`）：
- 顶部只留新对话一行（同现状，保留 ⌘N）。
- 底部 `SidebarFooter` 改成常驻的一行：左边搜索 / 定时 / 项目三个图标按钮（样式同 A），
  右边是归档入口（仅在 `archivedCount > 0` 时出现，样式保持现在的样子）。
- 其他档位下底栏行为不变（只在有归档时出现）。

## 新建项目（A / B / E 三档都适用）

- 顶部不再有新建项目的「＋」。改为 Project Review 里第一个分组标题（有活跃项目时是
  「活跃项目」，只有更早项目时是那个分组）右侧的轻量「＋」按钮，悬停提示「新建项目」，
  调 `onNewProject`。样式参照现有项目行右侧的「＋」。
- 零项目空态的「新建第一个项目」CTA 不变。
- 现状档保持原样（顶部项目行的「＋」还在，分组标题不加「＋」）。

## 切换器（TEMP）

- 常驻、可点击的分段 pill，只在 `import.meta.env.DEV` 下渲染；一组「侧栏顶部：现状 /
  一行 / 两行 / 底栏」，默认「一行」。当前项高亮。
- 选值存 `localStorage`（新 key），读写包 try/catch；非开发构建一律用「一行」，不读存储。
- 放在不挡侧栏的位置：挂在主区（例如用 portal 挂进 MainView 滚动列外层带定位的容器，
  `anchor.closest(".overflow-y-auto")?.parentElement`，`absolute bottom-4 left-3`），因为要比的
  是侧栏本身。用 `@/components/ui/segmented-control` 的 `SegmentedControl`（`size="sm"`）。
  要保证没有打开会话（空状态页）时也能看到并切换；如果那个挂载点在空状态下不存在，
  换一个始终存在的挂载点，并在报告里说明。
- 状态可用小 zustand store。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
```

全部贴输出尾部。不要启动 `tauri dev`，JC 自己真机看。

## 别动什么

- 不碰 `gui/` 以外；不动会话行、时间线分桶、SidebarHeader、命令面板。
- 不做常驻搜索框；悬停一律瞬时，不加滑动高亮或过渡动画。
- gui ESLint 带 React 编译器规则：渲染期不能调 `Date.now()`，effect 体内不能同步
  setState，组件文件不能导出非组件函数（工具函数放 `lib/`）。
- **不要对既有文件跑 `prettier --write` / `pnpm --dir gui format`**：`gui/src` 不是
  prettier-clean。新文件可以整篇格式化，旧文件只保证自己写的 hunk 风格一致。
- tailwind-merge：字号 class 排在 `leading-*` 之后会把 `leading-*` 吞掉；`cn()` 拼 class
  时字号在前。
- 注释密度与语气跟周边一致（日期 2026-09-28）；写理由用 PRD 里的理由，不要把你推断的
  理由写成 JC 的裁决。
- 不写 docs / devlog；不 commit；工作区里与本票无关的改动不要碰。

## 回报格式

1. 改动文件清单，每个一句话。
2. 票面没写清、你自己做的决定（逐条，附理由）。
3. 验证命令输出尾部。
4. 切换器在哪、怎么用；拆除时要删哪些（grep `TEMP(sidebar-quick-actions)` 能否删干净），
   以及每一档胜出时要保留 / 删除的代码。
5. 各档在窄宽度下的表现（按代码推算：门槛多少 px、怎么退化），以及注意到但没处理的边角。

## Comments

### 2026-09-28 实现（子代理，未提交）

- 追加第五档「一行·搜索带字」（`row-search`，切换器里排在一行与两行之间）：协调者当天转达 JC 的新事实——他主要靠点侧栏搜索行搜索而不是 ⌘K，搜索是他的第二高频入口，缩成 32px 图标对他代价比定时 / 项目大。布局同 A，但搜索保留文字（常规字重，⌘K 进悬停提示），定时 / 项目仍是图标；默认档仍是一行。
- 切换器：`SidebarQuickActionsVariantSwitcher.tsx` + `stores/sidebar-quick-actions-variant.ts`，仅 dev 渲染；有会话时挂在对话滚动列左下角，空状态没有该挂载点，改挂主区主体（`main > .relative`）左下角。localStorage key `galley_temp_sidebar_quick_actions_variant`。`grep -rn "TEMP(sidebar-quick-actions)" gui/src` 列出全部改动点。
- 窄宽度门槛（容器宽 = 侧栏宽 − 1px 边框，按中文标签算）：一行 < 198px 新对话只剩加号；一行·搜索带字 < 232px 搜索先去字，< 198px 新对话再去字；两行 < 187px 三钮只剩图标；底栏 < 187px「已归档」只剩图标。英文标签更长，在门槛之上会先截断。
