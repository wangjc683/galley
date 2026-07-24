# 06: CLI `galley schedule` 命令面（additive）

Status: needs-triage
Blocked by: 01, 02
PRD: ../PRD.md（决策 1；v1 非目标节）

## 范围（若做）

- `cli/src/args.rs` 顶层新增 `Schedule` 命令组：`list` / `create` /
  `toggle` / `delete`，JSON 输出。
- additive-only：不动 `schemaVersion: 1` 既有面；错误标识与退出码
  沿用现有分类（`docs/agent-api/errors-and-exit-codes.md`）。
- 写命令支持 `--supervisor=<id>` / `--reason=<why>`，与 Supervisor
  SOP 的写命令惯例一致。
- 同步更新 `docs/agent-api/`（新命令文档）。

## 待触发的决策

目标场景是桌面人类（PRD），GUI 已闭环；CLI 面是给 supervisor 的
可见性/管理能力，**不是 v1 必需**。等出现真实的 supervisor 用例
（比如 IM 里问「我有哪些定时任务」）再升为 ready-for-agent。
Agent API 契约变更风险高于 GUI（Rule 3），不要顺手做。

## 验收（若做）

- `cargo check --workspace` / `cargo test --workspace` 通过；
  `docs/agent-api/` 文档与实现一致；按 Rule 3 做契约级验证。
