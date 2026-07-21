# 回复完成通知：只通知 GUI 发起的 run

日期：2026-07-21
状态：已实现，随 v0.3.6 发布
相关：`gui/src/lib/notify.ts` · `gui/src/lib/ipc-handlers.ts` ·
`gui/src/hooks/useMessageSend.ts` · issue #13（同版本的窗口聚焦功能）

## Context

发布 v0.3.6 前 JC 提出：Settings 里"任务结束时通知"看起来该覆盖日常
对话，实际只覆盖 Goal 终态——普通会话回复完成不发任何系统通知，用户
切走后 Agent 跑完了没人叫。文案"任务"与 Goal 语义混用是根因之一。

## Decisions

- **新增第三种通知 `replyDone`**：GUI Composer 提交成功后按会话打
  pending 标记，最终 `turn_end`（带 `exitReason` 且 visible）消费标记
  才通知。复用 notify.ts 既有门控链（pref → 节流 → 窗口聚焦跳过 →
  惰性权限）。
- **触发范围 = 只通知 GUI 发起的 run（方案 A）**：Goal nudge 驱动的可
  见 turn（solo Goal 每个 nudge 周期都有一次 run 完成）和 CLI /
  Supervisor 驱动的 run 天然不打标记、静默。否决方案 B（通知所有完成
  + 反查 Goal 隶属排除）：覆盖 CLI 场景的收益不抵通知链路对 Goal 内部
  结构（`goal_context_for_session` 反查）的耦合；且 Supervisor 对话的
  答案本来由 IM 转发（宪法第 4 条），桌面重复叫人是噪音。
- **标记生命周期**：成功送达 bridge 才 mark;`error`、`run_complete`
  （ABORTED/DENIED 兜底）、bridge `onClose` 三处 clear——桥关闭后它的
  `turn_end` 永不再来，残留标记只会在下一次非 GUI run 上误触发（此洞
  由 code review 的 Spec 轴发现补上）。`ask_user_response` 也 mark：
  追问的回复完成同样值得通知。`/btw` 侧问不 mark。
- **标记放模块级 Set 而非 zustand**：它从不参与渲染，进 store 只会
  制造无意义的订阅。
- **文案**："任务结束时通知"改"目标结束时通知"（en "When a task
  finishes" → "When a goal finishes"），Goal 语义归 Goal；新开关按使
  用频率排在通知区首位。

## 发现：macOS dev 模式通知不可见

`tauri dev` 跑裸二进制不在 .app bundle 里，macOS 把通知路由到启动
dev 的终端应用名下，终端没通知权限就什么都不显示（tauri#4965）。已存
在的 goalEnd / approval 通知在 dev 下同样发不出——此坑一直在，本次
实测才暴露。应对：notify.ts 每个门控分支加 `[notify]` console.debug，
dev 下看 console 验证门控；真通知用安装版验收。

## Rejected alternatives

1. **方案 B（排除法）**——见上，耦合不值。
2. **键入即聚焦 / 通知点击跳转会话**——范围外，未来单独议。
