# 04: GUI 管理 dialog — 任务清单与创建表单

Status: done
Blocked by: 01, 03
PRD: ../PRD.md（决策 6）

## 范围

- overlay dialog，交互惯例对齐现有 Settings host / overlay 模式，
  不发明新弹层规范。
- 任务清单用**列表行**（不用卡片），每行：
  - 开关（enabled toggle）
  - 重复规则摘要（「每天 09:00」「每周一 10:00」）
  - prompt 摘要（单行截断）
  - 上次运行状态：成功 / 卡在审批 / 失败 / 尚未运行；**可点击跳转**
    到该 session（关 dialog、选中会话）——这是信任闭环的关键一列
  - 下次触发时间
- 「+ 新建」在 dialog 内：表单字段 = project 选择（可空）、prompt、
  重复规则（v1：每天 / 每周几 + 时刻）。编辑复用同一表单。
- 空状态：一句话说明 + 「仅在 Galley 运行时触发」的说明放在这里
  （PRD 决策 4 的 UI 义务）。
- 删除需确认（destructive）。

## 验收

- `pnpm --dir gui typecheck` / `pnpm --dir gui lint` / `git diff --check`
  通过；表单与跳转由 JC 在真实 app 验收。

## 注意

- `last_run_session_id` 悬空（会话已删）时状态列降级为不可点文本。
- 时刻选择控件从简（原生 input / 现有控件），不为 v1 造 time picker。
