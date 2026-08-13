# Discord Channel 开工：暂缓转在办 + owner 竞态先行修复

日期：2026-08-13
关联：`.scratch/discord-channel/`（PRD + issues 01-07）、
[外审四票裁决](./2026-08-13-discord-review-verdicts.md)、
`core/src/im_supervisor/manager.rs`

## 开工

Discord Channel 从 deferred 台账转在办（台账小节按惯例已删，本 entry
接棒）。启动信号：JC 直接拍板（原定信号之一「JC 决定推向 Discord 系
社区」）。方案状态：同日两轮设计 + Codex 外审 + 四票投毕，PRD 无
悬空项。PRD 已拆成 7 个实施 issues（补丁 → 打包 → reporter
dispatcher → runner → Rust core → GUI → 规范/验收），阻塞关系在
issue 头部 `Blocked by:` 行。体量共识：1.5~2 × Telegram；后段验收
需 JC 建真实 Discord 应用 dogfood。

## 先行落地：owner 绑定竞态修复（阻塞项清零）

PRD 标注「Discord 接入前必修」的
[im-owner-bind-race](../../.scratch/im-owner-bind-race/issues/01-persist-owner-before-generation-check.md)
已修（现有飞书/Telegram 立即受益）。实际竞态比首报多一层：
`unbind_owner` 原先「先清 pref、后重启换代」，清 pref 到 slot 换 pid
之间旧进程仍是当前代，其缓冲的绑定事件可把刚清掉的 owner 写回。

修复（`manager.rs`）：

- 事件准入抽成纯函数 `admit_event`：pid 与 slot 当前代不符的事件
  **整体拒绝**——既不动 slot，也不返回 owner 供持久化。
- `persist_owner` 挪到准入校验之后，且**留在 slots 锁内**执行，与
  unbind 的灭代序列原子互斥。
- `unbind_owner` 重排为「杀进程 → slots 锁内 pid 置 None 灭代 →
  清 pref → 重启」，并补拿 lifecycle 锁（顺手关掉与并发 start 的
  竞争）；`start_inner` 照 stop/stop_locked 先例拆出 `start_locked`
  避免锁重入。
- 三个回归测试：匹配代准入并交出 owner、异代整体拒绝、
  「灭代后迟到绑定事件不能复活已清 owner」。

原「persist BEFORE touching the slot」的崩溃时序理由保留（仍在
emit 前持久化），只是从「先于校验」改成「先于发布」。
