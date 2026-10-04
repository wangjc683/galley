# 去掉审批系统（与上游 GA 一致，只有自动执行）

Status: done（2026-10-05 实施，静态门禁全绿；真机未验，见 devlog）

来源：2026-10-04 浏览器控制 UX 讨论（`.scratch/browser-control-ux/`）票 04 调研的延伸。
JC 裁定选 **A：完全去掉**，下个 session 实施。

## 依据（2026-10-04 核实）

- **零使用**：本机 135 个会话 `sessions.approval_mode` 全为 NULL（全部跟随默认），全局 `yolo_mode=true`；
  从未出现审批拒绝。GitHub issue 无人要求审批；#16 只是把「等待审批 / 需要人工输入」列为一类提示音，
  其中「需要人工输入」（ask_user）去掉审批后仍存在。
- **保护面窄且部分是坏的**：逐步审批只拦 `code_run` / `file_write` / `file_patch` / `start_long_term_update`，
  从不拦 `web_execute_js`（已登录账号里的点击与提交）。设置 → 审批页是摆设：runner 用写死的
  `DEFAULT_APPROVAL_TOOLS`（`runner/handlers.py:100`，bridge 不传，`runner/workbench_bridge.py:1232-1256`），
  `set_approval_rules` 三层都有类型却无人发送，GUI 的 `approvalConfig` 只在内存（`gui/src/stores/prefs.ts:41`），
  `approval_rules` 表为空，卡片「加入白名单」只活在当前会话进程里。详见
  `.scratch/browser-control-ux/issues/04-approval-read-write-split.md`。
- **违背定位**：「Less harness. More model.」；上游 GA 没有审批，这是 Galley 加的较重一层 harness。

## 范围（按层，2026-10-04 grep；实施前复核）

- **runner**：`handlers.py`（`WorkbenchHandler` 的审批门：`needs_approval`、`request_approval`、always-allow 集合、
  `update_approval_rules`、`yolo_check`；**保留子类本身**，它还发轮次信号 `turn_started_callback`）、
  `workbench_bridge.py`（`_request_approval`、`SetYoloModeCommand` / `SetApprovalRulesCommand` 处理、
  审批请求 / 回应往返）、`ipc.py`（对应命令与事件模型）及其测试。
- **Core**：`ipc.rs`（`SetYoloMode` / `SetApprovalRules` / 审批请求与回应）、`db/tool_event.rs`（写
  `'waiting_approval'`）、`db/session.rs` / `db/helpers.rs`（`waiting_approval` 状态、`pending_approval_count`、
  `set_session_approval_mode_db`）、`commands/session.rs` + `lib.rs`（`set_session_approval_mode`）、
  `api.rs` / `api/session.rs`（`approval_mode` 字段与方法）、`goal_engine.rs`、`scheduler.rs`、
  `migration_backup.rs`、`tray.rs`（YOLO 引导相关）。
- **CLI**：`cli/src/common.rs`、`cli/src/project.rs`（`waiting_approval` 计数）。
- **GUI**：`ApprovalDock.tsx`、`ApprovalForm.tsx`、`approval-renderers.tsx`、`ToolCallout.tsx` 的待审批分支、
  `Composer.tsx` / `composer-props.ts` / `LLMPill.tsx` 的审批模式段、`lib/approval-mode.ts`、
  `SettingsApproval.tsx` + `AutoDefaultConfirmModal.tsx` + 设置侧栏 / 类型里的 approval tab、
  `YoloIntroDialog.tsx`（及 `FirstCloseDialog.tsx`、`dialog-close-button.tsx` 里的引用）、
  `stores/prefs.ts` / `stores/defaults.ts`（`approvalConfig`、`yoloMode`、`yoloIntroSeen`）、
  `stores/runtime/bridge-slice.ts`、`stores/sessions/*`、`lib/ipc-handlers.ts`、`lib/sessions.ts`、
  `lib/status-icon.tsx`、`lib/step-limit.ts`、`lib/notify.ts`、`SidebarSessionRow.tsx`、`MainView.tsx`、
  `AppShell.tsx`、`EmptyState.tsx`、`ScheduledTasksDialog.tsx` + `hooks/useSchedulerSignals.ts`
  （定时任务「等待审批」徽标）、`hooks/useMessageSend.ts`、`types/{ipc,conversation,session,db}.ts`、i18n。
- **文档**：`docs/design/tools-and-approvals.md`、`conversation.md` §4.4、`overlays-and-settings.md`（Approval 节）、
  `layout-and-chrome.md`、`foundations.md`、`polish-checklist.md`、`docs/ipc-protocol.md`、
  `docs/agent-api/*`（见下）、`docs/copy-language-guidelines.md`（YOLO / 审批术语）、
  `docs/windows-build-checklist.md`、`docs/integrations/galley-supervisor-reference.md`、
  `CLAUDE.md` Rule 1 允许点里「Subclass GenericAgentHandler for approval interception and for turn-lifecycle
  UX signals」改为只剩轮次信号。

## 契约与数据（不破坏）

- **Agent API**：`SessionBrief.status` 的 `waiting_approval` 值保留在文档里，标注「不再产生」（同 schema 内只增不删）；
  `waitingInput` 等计数随之恒为 0，文档注明。`SessionBrief.approvalMode` 是 `skip_serializing_if = None` 的可选
  字段，本机从未输出过；去掉后行为等同「缺省＝跟随默认」，不算破坏，但要在 stability 文档记一笔。
- **数据库**：`sessions.approval_mode` 列、`pending_approval_count` 列、`approval_rules` 表、`yolo_mode` /
  `yolo_intro_seen` prefs 原样保留，**不做迁移**（风险最低；加迁移要补六处手写列表）。
- **升级瞬间**：库里若有 `waiting_approval` 状态的会话，启动恢复时要归到合适的终态（核对现有把
  running / connecting 复位的逻辑是否覆盖）。
- 外置模式：少一个对外置 GA 的介入点；handler 子类仍在，只发轮次信号。

## 建议拆票（实施时按接口契约先行）

1. runner + IPC：删审批往返、`set_yolo_mode`、`set_approval_rules`；先写死「删掉哪些消息类型」的契约。
2. Core + CLI：停止产生 `waiting_approval`，删 `set_session_approval_mode` 链路、Goal / 定时任务里的审批分支。
3. GUI：上面 GUI 列表全部移除；状态图标、侧栏、定时任务徽标、通知回归无审批态。
4. 文档 + 发版说明：设计文档、IPC / Agent API 文档、CLAUDE.md Rule 1 措辞；发版说明写明「审批已移除」。

验证：`cargo check/test --workspace`、`pnpm --dir gui typecheck/lint/test`、`pytest`、`mypy runner`、`ruff check runner`、
`git diff --check`，加 IPC 漂移检查脚本与 docs 链接检查。

## 待定

- **提示词规则**：2026-10-05 JC 裁不加——上游 `managed-ga/code/assets/sys_prompt.txt:5` 已有「不可逆操作先询问用户」（英文版 `:7`），内置照常加载。
- **#16 回帖**：该 issue 把「等待审批」列为一类提示音；发版时是否回帖说明（按社区回帖惯例先出草稿给 JC 确认）。
- **重启信号**：社区有人要回审批时重新评估；届时按脚本内容判定（票 04 调研的方案 D），不恢复按工具名拦。

## Comments

- 2026-10-05：四张 Opus 票（runner / Core+CLI / GUI / 文档）并行实施，0 返工；记录见 [devlog](../../docs/devlog/2026-10-05-remove-approval.md)。
