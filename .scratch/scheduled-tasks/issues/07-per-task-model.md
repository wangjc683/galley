# 07: 每任务模型选项

Status: done
PRD: ../PRD.md（决策 8）

## 背景

JC 提出（2026-07-24）：定时任务不一定要用默认主力模型。正当性来自
「无人值守 × 周期重复」：模型成本按周期累积，且触发时无人在场可换。

## 实现

- migration 037：`scheduled_tasks.llm_name TEXT`（可空 = 默认模型）。
- 存模型 display name，与 `--llm=<name>` 同语义，不发明新引用格式。
- 调度器 fire 前经 `resolve_llm_selection_for_runtime` 预解析：
  解析失败（模型被删 / 切了 runtime）**降级到默认模型照常触发**，
  stderr 记录——与 Goal 启动模型选择同契约，绝不因模型失效杀掉任务。
- GUI 表单「模型」下拉与「项目」同行，选项来自 Composer 同源的
  `llms` 列表，首项「默认模型」；已固定但不在当前列表的模型名保留为
  独立选项显示，不静默改写。列表行摘要仅在非默认时显示模型名。
- 范围刹车（PRD 决策 8）：不再加 per-task runtime / 审批模式等配置；
  模型字段的正当性来自无人值守×周期成本，其他配置项没有这个属性。

## 测试

DB roundtrip（trim 存储、`Some(None)` 清除）；调度器降级路径为
best-effort 日志行为，由类型与现有 resolve 测试覆盖。
