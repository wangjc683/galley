# 03: GUI 入口行 — quick actions 第四行与角标

Status: done
Blocked by: 01
PRD: ../PRD.md（决策 5、7）

## 范围

- `gui/src/components/layout/sidebar/SidebarQuickActions.tsx` 新增
  「定时」行，位置在「搜索」与「项目」**之间**（JC 定案）。
- 视觉与现有 `QuickAction` 行同构：phosphor thin 图标 + 13px 标签；
  点击打开管理 dialog（04），无按压 toggle 态（与「项目」行的
  toggle 行为不同但外观一致，不发明新样式）。
- 角标：有定时会话卡在审批时，行尾显示计数角标（数据来自 01 的
  事件 + 现有会话审批状态）。正常完成不打扰。
- 用户可见文案按 `docs/copy-language-guidelines.md` 定（「定时」
  还是「定时任务」等），走 `useCopy()` i18n 通路。

## 验收

- `pnpm --dir gui typecheck` / `pnpm --dir gui lint` / `git diff --check`
  通过；视觉由 JC 在真实 app 验收。

## 注意

- 这个块是 sidebar 最贵地段，本行不带快捷键提示、不带 inline `+`
  （创建入口在 dialog 内，PRD 决策 6）；将来若要 inline `+`，复用
  「项目」行的模式。
