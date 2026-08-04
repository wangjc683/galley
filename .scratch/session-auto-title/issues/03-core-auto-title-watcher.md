# 03: core 自动标题 watcher + GUI 应用

Status: ready-for-human（已实现，待 dogfood 验收）

## 范围

- `core/src/ipc.rs`：镜像 `GenerateTitle` 命令与 `TitleGenerated` 事件
  （camelCase 字段 + session_id() 分支 + 序列化测试）。
- 新模块 `core/src/auto_title.rs`：`spawn_auto_title_task(galley, manager,
  notifier, session_id, rx)`——订阅 broadcast：
  - `RunComplete`（visible、非 ABORTED）→ 查 `title_source ∈ {seed,derived}`
    → 取首条可见用户消息（messages 表）→ 发 `GenerateTitle{first, final}`
    （两段各截 ~500 字符）。
  - `TitleGenerated` → `try_apply_auto_title` CAS → 成功则以既有
    `session-updated-external` 事件广播 brief（GUI 的
    `applyExternalSessionUpdated` 直接吃，**GUI 会话列表零改动**）。
  - `Closed` → 退出。
- 挂载点：**v1 只挂 GUI spawn 路径**（`runner_commands.rs::spawn_runner`，
  与 `spawn_emit_task` 并列第二次 subscribe）。socket 两处 spawn 不挂：
  `HandlerCtx` 的 RunnerPort 窄接口是有意的隔离 seam，为 watcher 传
  `Arc<RunnerManager>` 会拓宽它；且 CLI / Goal 会话按合同自带真实标题，
  本就极少处于 seed/derived 态。此取舍记录于此，后续有真实需求再议。
- GUI：`maybeDeriveTitle` 的 invoke 加 `titleSource: "derived"`；
  `gui/src/types/ipc.ts` 补 `title_generated` 事件类型（ipc-handlers 无需
  处理，default 忽略）。

## 验收

- cargo test：watcher 触发条件（资格态/ABORTED/internal 跳过）、CAS 后事件
  广播（recording Notifier）。
- pnpm typecheck / lint。
