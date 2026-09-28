# 02 「一行」胜出：删落选档、英文 New chat、不截断规则、加 I1 / I2 两档

Status: done

接在票 01 之后（01 的改动还在工作区，未提交）。先读 `../PRD.md` 的「真机第一轮」和「待真机
裁决（第二轮）」，再读票 01 的 `## Comments`（它记了各档代码怎么分布、胜出时删什么）。
只改 `gui/`，不 commit。

## 改哪些文件

- `gui/src/components/layout/sidebar/SidebarQuickActions.tsx`
- `gui/src/components/layout/Sidebar.tsx`
- `gui/src/components/layout/sidebar/SidebarFooter.tsx`（恢复成票 01 之前的样子）
- `gui/src/components/layout/sidebar/SidebarProjectReview.tsx`
- `gui/src/i18n/locales/en.ts`
- 两个临时文件：`gui/src/stores/sidebar-quick-actions-variant.ts`、
  `gui/src/components/layout/sidebar/SidebarQuickActionsVariantSwitcher.tsx`

## 怎么改

### 1. 「一行」转正，删落选档（正式删除）

- 删掉「现状 / 一行·搜索带字 / 两行 / 底栏」四档的全部代码：旧的四行布局
  （`QuickAction` / `ProjectQuickAction` 等不再使用的组件）、`labeledSearch` 分支、
  `TwoRowsAction`、底栏分支。`SidebarFooter.tsx` 用 `git diff` 对照恢复到 HEAD；
  `Sidebar.tsx` 里底栏的判断恢复成原来的 `archivedCount > 0 && <SidebarFooter …/>`。
- 「一行」的代码去掉 `TEMP` 标记，成为正式实现。`SidebarQuickActionIcons` 如果只剩一个
  使用处，就不再导出。
- Project Review 分组标题的「新建项目 +」转正：去掉 `newProjectInGroupHeader` 开关，
  始终显示（顶部已经没有新建项目的「+」了）。注释写成正式说明。
- 保留：定时角标与弹跳逻辑、项目按下态、图标悬停提示（名称 + 快捷键）。

### 2. 不截断规则

新对话的动作文字要么完整显示，要么只剩加号，**不允许截成半截**：
- 去掉动作文字上的 `truncate`，改为按语言的容器查询门槛整体隐藏：中文 `@max-[198px]`，
  英文 `@max-[220px]`（「New chat」在 Inter 500 13px 下实测 58.8px，「新对话」39px，
  198 − 39 + 58.8 ≈ 218，取 220）。用 `useLanguage()` 选 class；两个 class 都写成字面量，
  保证 Tailwind 能生成。注释写清怎么算的。
- 项目版标签（`新对话 · 项目名` / `New chat · …`）拆成两段：动作文字（`shrink-0`，不截断）
  和「 · 项目名」（`min-w-0 truncate`）。门槛只按动作文字算；放不下动作文字时整体只剩加号。
- 文字隐藏时，加号的悬停提示显示完整标签（含项目名）和 ⌘N。

### 3. 英文「New chat」

`en.ts` 里「创建对话」这个动作的标签统一改成 New chat（句首大写，和英文界面一致）：
- `sidebar.newConversation` → `"New chat"`
- `sidebar.newConversationInProject` → `` `New chat · ${projectName}` ``
- `topbar.newConversation` → `"New chat"`
- 命令面板的 `newConversation` → `"New chat"`
- 快捷键说明里的 `newConversation` → `"New chat"`

只改这五处。名词用法（如 "Archived 3 conversations"、"Search conversations…"）不动；
`newConversationInProjectTitle`、`newProjectConversation`、IM 命令说明 "/new Start a new
conversation" 也不动（报告里列出你看到的、可能也算「创建动作」但没改的词条，由主会话定）。
改完 grep 一遍 `New conversation`，确认剩下的都是你有意没改的。

### 4. 新增两档临时变体（TEMP）

在「一行」基础上加两档，只改新对话按钮的形态，三个图标、角标、按下态都不变：

- **I1 纯图标**（`icon`）：新对话在任何宽度下都只有加号（品牌色 `text-brand-strong`、
  `Plus` bold，尺寸与其余图标按钮一致，32px 命中区）。加号在左，三个图标在右
  （`justify-between`）。悬停提示同上（完整标签 + ⌘N）。
- **I2 描边**（`outlined`）：同 I1，但加号按钮带一圈中性细描边（`border border-line`，
  `rounded-sm`，**不加底色、不用品牌色描边**），悬停 `bg-hover`，按压 `translate-y-px`，
  悬停瞬时。不要和项目按钮的按下态（`bg-selected/85` + `shadow-inner`）撞外观。

所有临时代码带 `TEMP(sidebar-quick-actions)` 标记，定案后只需保留胜出档。

### 5. 切换器

- 只剩一组「侧栏顶部：一行 / 纯图标 / 描边」，默认「一行」。选值换一个新的 localStorage
  key（旧值结构已变）。非开发构建一律用「一行」，不读存储。挂载位置与形态不变。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
grep -rn "New conversation" gui/src/i18n/locales/en.ts
```

全部贴输出尾部。不要启动 `tauri dev`，JC 自己真机看（会切中英文各看一遍）。

## 别动什么

- 不碰 `gui/` 以外；不动会话行、时间线分桶、SidebarHeader、命令面板结构；`zh.ts` 不改
  （中文文案不变）。
- 悬停一律瞬时，不加过渡；按压是 `translate-y-px` 键程。
- gui ESLint 带 React 编译器规则：渲染期不能调 `Date.now()`，effect 体内不能同步 setState，
  组件文件不能导出非组件函数。
- **不要对既有文件跑 `prettier --write` / `pnpm --dir gui format`**，只保证自己写的 hunk
  风格一致。
- tailwind-merge：字号 class 排在 `leading-*` 之后会把 `leading-*` 吞掉。
- 注释跟周边一致（日期 2026-09-28）；理由用 PRD 里的，不要把你推断的理由写成 JC 的裁决。
- 不写 docs / devlog；不 commit；工作区里与本票无关的改动不要碰。

## 回报格式

1. 改动文件清单，每个一句话。
2. 票面没写清、你自己做的决定。
3. 验证输出尾部（含 grep 结果，逐条说明剩下的 `New conversation` 为什么没改）。
4. `SidebarFooter.tsx` 是否已与 HEAD 一致；grep `TEMP(sidebar-quick-actions)` 还剩哪些，
   以及 I1 / I2 / 一行 各自胜出时要删什么。
5. 注意到但没处理的边角。

## Comments

### 2026-09-28 实现（子代理，未提交）

- 落选四档代码已删；`SidebarFooter.tsx` 与 HEAD 一致；`Sidebar.tsx` 底栏恢复 `archivedCount > 0 && …`。`SidebarQuickActionIcons` 只剩一处，直接内联进 `SidebarQuickActions`（不再存在、不再导出）；定时角标只剩角标形态（去掉 `placement` / `title`）。`SidebarQuickActions` 的 `onNewProject` 已无用处，连同 `Sidebar.tsx` 的传参一起删。
- 不截断：动作文字 `shrink-0`、「 · 项目名」`min-w-0 truncate`（前导空格用 NBSP 转义 `\u00a0`，普通空格在 flex 子项行首会被折叠），整段按语言 `@max-[198px]` / `@max-[220px]` 隐藏；已用 Tailwind 4.2.4 编译器确认两个 class 都被提取、生成且排在 `.flex` 之后。
- I1 / I2：`NewChatIconButton`（`size-8 shrink-0 mr-auto`，`Plus` 15 bold 沿用「一行」的加号字号）；I2 仅加 `border border-line`。切换器三档「一行 / 纯图标 / 描边」，新 key `galley_temp_sidebar_quick_actions_variant_v2`。
- en.ts 只改票面五处；`grep "New conversation"` 仅剩 1764 行（名词 "New conversations apply it…"）。
- 验证：typecheck / lint / test（62 files, 542 tests）/ `git diff --check` 全绿。
