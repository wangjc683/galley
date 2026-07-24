# 10: 每月重复类型

Status: done
PRD: ../PRD.md（决策 2；v1 非目标节更新）

## 背景

JC 验收 v1 时提出：缺每月选项，「每月定时一个任务」无法实现
（GA 自带 cron 也支持 monthly，属合理平价）。

## 实现（2026-07-23）

- migration 036：SQLite 无法原地拓宽 CHECK，重建 `scheduled_tasks`
  表把 `repeat_kind` CHECK 拓为 `('daily','weekly','monthly')`，
  同时 `weekdays` 列改名为通用的 `repeat_days`（copy-then-rename，
  保留 035 下已建的行）。
- Rust `ScheduledTaskRepeat::Monthly { monthdays: Vec<u8> }`
  （1..=31，排序去重）；`allows(weekday)` 重构为 `allows_date(date)`。
- **月末钳制语义**：选 29/30/31 时，小月在当月最后一天触发
  （2 月 28/29、4 月 30），不做 cron 式静默跳过——月末任务半年
  消失是信任杀手。[30,31] 在 2 月同钳到 28 日，只触发一次。
- 调度循环 `due_fire` 与补跑逻辑对 repeat 类型无感知，零改动。
- GUI：重复 segmented 加「每月」，1–31 七列格网选择，选到 ≥29 时
  显示钳制提示文案；摘要「每月 1·15 日 09:00」。
- 测试：Rust +8（2 月/闰年钳制、跨年、prev 镜像、钳制去重、校验、
  serde）、DB roundtrip +1。
