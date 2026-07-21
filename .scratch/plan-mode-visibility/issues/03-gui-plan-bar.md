# 03: GUI — 活跃期薄条 + 展开 checklist

Status: ready-for-human

## 目标

Plan mode 活跃时会话头部出现薄进度条（当前步骤 + n/N），点击展开完整
checklist；plan 退出自动消失。Composer 不动。

## 方案

- `gui/src/types/ipc.ts`：`PlanUpdateEvent` 加入 `IPCEvent` union。
- `gui/src/stores/messages.ts`：`PerSessionMessages` 加 `plan:
  PlanStatus | null`；action `setPlanStatus`；bridge close 时清空
  （runtime 状态，桥没了即失效；重启后下一个 turn_end 会重新出现）。
- `gui/src/lib/ipc-handlers.ts`：`case "plan_update"` → active 写入 /
  inactive 置 null。
- 新组件 `components/conversation/PlanContextBar.tsx`：
  - 挂载位置与 `GoalWorkerContextBar` 同级（MainView 滚动区上方）。
  - 收起态一行：图标 + 「计划 n/N」 + 当前步骤（truncate）+ 展开 chevron。
  - 展开态列出 checklist（done 划掉/淡化，open 正常）。
  - placeholder 态（plan.md 未落盘）：显示 pathHint + 「制定计划中」。
  - 无 plan 状态时返回 null，零占位。
- i18n：zh/en 各加 copy。

## 不做

- 计划确认 ask_user 气泡不特殊化（PRD 决策）。
- 不持久化到 SQLite；重启后靠运行中 turn_end 重新点亮。

## 验证

`pnpm --dir gui typecheck` / `pnpm --dir gui lint`；视觉验收 JC 在真实
app 里做（CLAUDE.md 约定）。

## Comments
