# 08: 调度会话来源标识修正

Status: done
PRD: ../PRD.md（决策 2 补充）

## 背景

JC 问（2026-07-24）：定时任务启动的 session 需不需要来源标识？
调研发现问题比"要不要加"更严重：调度器会话带
`supervisor=galley-scheduler`，命中 sidebar 现有的
`origin.via === "supervisor"` 标记，显示为**"Supervisor 创建"+
插头图标**——用陌生概念解释用户自己配置的行为，比无标识更糟。

## 实现

`SidebarSessionRow` 特判 `origin.supervisor === SCHEDULER_SUPERVISOR`：
时钟图标 + "定时任务创建" 提示；其余 supervisor 会话保持原标记。
复用现有来源标记槽位，无新机制。

## 明确不做

- 会话内部不再加"由定时任务启动"横幅/系统消息：首条消息即任务
  prompt，加 sidebar 标记后来源已完整可读，会话内重复是噪音。
- 从会话反查任务：`origin.reason` 已存 `scheduled task <id>`，
  有真实需求时再把 tooltip 升级为任务摘要。
