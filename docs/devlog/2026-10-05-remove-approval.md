# 去掉审批系统：工具一律直接执行，与上游 GA 一致

Date: 2026-10-05
Status: 已实施，静态门禁全绿；真机未验（清单见文末）；unreleased
Related: [票面](../../.scratch/remove-approval/PRD.md)、
[审批调研（票 04）](../../.scratch/browser-control-ux/issues/04-approval-read-write-split.md)、
[10-04 浏览器控制一轮](./2026-10-04-browser-control-ux-round.md)、
[tools-and-approvals §4.6（退役）](../design/tools-and-approvals.md)、
[Agent API 稳定性 §7.1](../agent-api/stability-and-versioning.md)、
[07-20 审批模式改名与按会话设置](./2026-07-20-approval-mode-rename-and-per-session.md)、
[05-09 YOLO 模式](./2026-05-09-yolo-mode.md)

## 起因

10-04 浏览器控制一轮的票 04 调研「审批读写分离」（能不能拦住已登录账号里的点击与提交），
查下去发现整个审批系统既没人用、保护面又窄。JC 在 A（完全去掉）/ 按读写分离补拦浏览器 /
维持现状三者里裁 A，留到本 session 实施。

## 事实底座

- **零使用**（`workbench.db` 只读）：136 个会话 `sessions.approval_mode` 全为 NULL，全局
  `yolo_mode=true`，`approval_rules` 与 `tool_events` 都是 0 行，从未出现审批拒绝。
- **保护面窄且部分是坏的**：逐步审批只拦 `code_run` / `file_write` / `file_patch` /
  `start_long_term_update`，从不拦 `web_execute_js`；设置 → 审批页是摆设——runner 用写死的
  `DEFAULT_APPROVAL_TOOLS`，`set_approval_rules` 三层都有类型却没有发送方，GUI 的规则只在内存。
- **上游已有对应的提示词**：GA 自己的系统提示词写着「不可逆操作先询问用户」
  （`managed-ga/code/assets/sys_prompt.txt:5`，英文版 `sys_prompt_en.txt:7`），内置运行时照常加载
  （补丁 0003 只改路径拼接）。
- **升级瞬间不需要恢复逻辑**：`sessions.status` 从未存过 `waiting_approval`——GUI 只持久化
  durable 状态（`toDurableStatus` 把运行态归 idle），Core 只写 `idle` / `archived`；这个值只在
  `tool_events` 里写过。

## 裁决（JC）

1. **完全去掉**（10-04）。理由：零使用、保护面窄、违背「Less harness. More model.」，上游 GA 没有审批。
2. **提示词规则不加**（10-05，按建议）。上游原文已覆盖内置与较新的外置 GA，Galley 再写一遍是重复的
   harness。落选：在 `managed_prompt.rs` 加一条点名浏览器提交 / 付款 / 发送的强化版——只覆盖内置，
   豁免句写不好时无人值守的 Goal / 定时任务会卡在 `ask_user` 上等人；进 deferred——上游已覆盖，
   没有要等的信号。
3. **重启信号沿用票面**：社区有人要回审批时重新评估，届时按脚本内容判定（票 04 的方案 D），
   不恢复按工具名拦。

## 做了什么

四张 Opus 票并行（runner / Core+CLI / GUI / 文档），接口契约写死在每张票里，主会话集成验收；0 返工，主会话只补了一处内边距（见 GUI 一条）。

- **wire**：`tool_call_pending`、`approval_response`、`set_approval_rules`、`set_yolo_mode` 三边同删，
  漂移门禁对齐在 18 个事件、11 条命令。
- **runner**：`WorkbenchHandler` 只剩轮次信号合成与 `tool_num` 兼容转发，不改派发与结果；bridge 删审批
  往返（`SessionState`、10 分钟审批超时、abort / shutdown 时唤醒审批线程）。补了 `tool_num` 转发与
  「`code_run` 直接执行」的测试。
- **Core**：删 Tauri 命令 `set_session_approval_mode` 与只服务审批的 `persist_tool_event_pending` /
  `persist_tool_event_approval_decision` / `load_tool_events_by_session`（最后一个在 GUI 本就无调用方），
  `db/tool_event.rs` 整个删；`SessionBrief.approvalMode` 删除。按 Rule 3 保留 `WaitingApproval` 变体
  （不再产生）与 `waitingInput` 计数（恒为 0），CLI 的 `--status waiting_approval` 仍接受。
- **GUI**：删 7 个文件（`ApprovalDock`、`ApprovalForm`、`approval-renderers`、`lib/approval-mode`、
  `SettingsApproval`、`AutoDefaultConfirmModal`、`YoloIntroDialog`）。模型 pill 去掉模式行与 ⚡ / ✋
  图标；设置去掉审批页与「等待审批时通知」；侧栏不再有琥珀色等待审批态；定时任务徽标只数触发失败；
  去掉跳到下一张审批卡的滚动逻辑与首启 YOLO 引导。历史转录里 `denied` 的工具结果仍显示「已拒绝」。
  外置模式下模型弹层底部提示走的是生产从没走过的分支，内边距按原先实际呈现的 12 / 8 / 6px 保留。
- **数据**：不加迁移。旧列 / 表 / prefs（`approval_mode`、`pending_approval_count`、`approval_rules`、
  `tool_events`、`yolo_mode`、`yolo_intro_seen`、`notify_on_approval`）留在库里，不再读写。
- **文档**：CLAUDE.md Rule 1 的允许点只剩轮次信号；设计文档 §4.6 改为退役短节（文件名不改，免断链）；
  IPC 文档留编号桩，不重排（代码注释引用着 `§4.10`）；Agent API 稳定性 §7.1 记一笔：`approvalMode`
  可选、从未输出，去掉不算破坏；README 中英文去掉审批卖点；Supervisor SOP 去掉「别替用户批审批」一条。

规模：127 个文件，+578 / −4461（GUI −3007、runner −727、文档 −392、Core −316）。

## 真机未验（JC 验收清单）

先重启 `tauri dev`：Core 与 runner 都改了，旧 Core 连新 runner 会给每个会话多报一条未知命令错误。

- [ ] 内置、外置各跑一次带 `file_write` / `code_run` 的任务：直接执行，无待审批卡、无 Dock。
- [ ] 模型 pill 弹层：没有模式行，运行中也能打开（模型行置灰）；外置模式底部提示的留白不变。
- [ ] 设置 → 通用 → 通知：只剩「回复完成」「Goal 结束」加提示音；两个都关时提示音开关变灰。
- [ ] 设置侧栏没有「审批」页，顺序与间距正常。
- [ ] 侧栏会话行四态（等你回复 / 出错 / 运行中 / 未读）不变。
- [ ] 定时任务徽标只在触发失败时出现，「上次运行」一格没有琥珀态。
- [ ] 打开一段带被拒工具的旧会话（若本机有）：仍是灰色折叠的「已拒绝」卡。
- [ ] 全新 profile 首启不再弹 YOLO 引导，首次关窗的询问正常。

## 遗留

- **#16 回帖**：该 issue 把「等待审批」列为一类提示音；发版时按社区回帖惯例先出草稿。
- **定时徽标的空位**：只剩「触发失败」一半，没有拿「等你回复」（`ask_user`）补位，待 JC 定。
