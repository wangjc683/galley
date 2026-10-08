# 01 时间线项目组 + 删项目视图 + 临时切换器

Status: done

设计全文见 [PRD](../PRD.md)，D1–D10 是契约。

## 改哪些文件

- `gui/src/lib/sessions.ts`（或新 `gui/src/lib/sidebar-timeline.ts`）：把会话 + 项目编排成
  「每桶顶层行 = 会话行 | 项目组」的纯函数（D1 / D2 / D3 门槛参数 / D4 窗口与尾行 / 计数 /
  按顶层行 backfill），配 vitest。
- `gui/src/components/layout/sidebar/`：新组件文件承载组行 + 抽屉 + 露出行（D5–D7、D10），
  复用 `SidebarProjectReview.tsx` 里的 `SidebarProjectRow` / `SidebarProjectDrawer` /
  `SidebarProjectMenuItems` / `SidebarProjectEmptyHint` 的样式与菜单，删掉 Review 外壳；
  `SidebarTimeline.tsx` 渲染组；`Sidebar.tsx` 去掉模式切换与两个 Presence；`types.ts` 清掉只服务
  Review 的常量。
- 组的汇总状态：新 hook，按 `useSessionStatusView` 同样的窄投影 + `useShallow` 订阅多个会话
  （不能在循环里调 hook），加上 `hasUnread` 与 `sessionGoalStatus`。
- `SidebarHeader.tsx` / `SidebarNavIcons.tsx` / `SidebarQuickActions.tsx`：项目图标改为下拉菜单
  （两种形态都要），去掉按下态。
- `gui/src/hooks/useProjectNavigation.ts`、`gui/src/App.tsx`：去掉 `projectViewOpen` /
  `toggleProjectView` / `projectReviewNowMs`；`expandedProjectIds` 保留为本次运行内状态；
  `openProjectInSidebar` 改为展开 + 滚进视野；D8：展开不再设 `activeProjectFilter`。
- `gui/src/i18n/locales/zh.ts` / `en.ts`：新文案（汇总副行、尾行「更早 N 个」、归档全部对话
  及确认框、菜单空态），删掉不再使用的键（`exitProjects` / `activeProjects` /
  `olderProjects` 等，先 grep 确认无引用）。UI 名词用「对话」，状态词沿用现有的
  「正在工作 / 等你回复 / 未读 / 出错」。
- grep 一遍 `gui/src` 里其余提到 Project Review / 项目视图的地方（引导教程、命令面板、
  快捷键说明），文案或行为跟着改。
- 临时切换器（dev only，`import.meta.env.DEV`）：常驻右下角分段 pill，`createPortal` 到
  body + 行内 `pointerEvents: "auto"`，四个维度见 PRD「待真机裁决」，localStorage 存档；
  「演示状态」在 `useSessionStatusView` / 汇总 hook 处做 dev 覆盖。切换器代码集中、好拆。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
```

## 别动什么

- 不 commit；不碰 `core/`、`cli/`、`runner/`、`managed-ga/`、`docs/`。
- 既有文件不跑 prettier / format 整文件，只保证自己的 hunk 风格一致；新文件可以整篇格式化。
- React 编译器 lint：effect 内不同步 setState、渲染期不调 `Date.now()`、组件文件不导出
  非组件函数（工具函数放 `lib/`）。
- `bg-selected` 不给组行用（PRD「组行」）。
- 不动会话行自身的视觉与交互规则（`SidebarSessionRow.tsx`），只在外面组装。

## 回报格式

改动文件清单；D1–D10 每条落在哪（file:line）；切换器怎么拆（要删的文件 / 代码块）；门禁输出
尾部；没做到或拿不准的点。

## Comments

- 2026-10-08 实现完成（一张 Opus 执行票）；JC 真机定双行 / 一律折 / 默认折叠，同一代理追加拆切换器。
- 2026-10-08 同日真机翻案（PRD「第二轮」S1–S6），同一代理实现项目分区 + 第二轮切换器；JC 定置顶之下 / 可折叠 / 双行，同一代理拆切换器。
