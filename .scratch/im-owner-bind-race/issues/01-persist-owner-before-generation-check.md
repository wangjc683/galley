# owner 绑定事件先持久化后验代际：旧进程可把已解绑的 owner 写回来

Status: done
日期：2026-08-13
来源：Discord 方案外审（Codex / gpt-5.6-sol）发现。影响现有
Feishu / Telegram 两个 channel，与 Discord 决策解耦。

## 现象

`core/src/im_supervisor/manager.rs` 处理子进程 stdout 状态行时，收到
`ownerOpenId` 先调 `persist_owner()` 落库（`:530-537`），之后才对
process slot 做归属检查。而 `unbind_owner`（`:363-395`）的流程是
清 pref + kill 旧进程 + 重启发新配对码。

竞态窗口：unbind 清掉 owner pref 之后，**旧进程** stdout 缓冲里迟到的
状态行（仍带旧 `ownerOpenId`）被 reader 读到并重新持久化——新进程
以「已绑定旧 owner」启动，不再发配对码，解绑静默失效。

## 影响

- 正常解绑操作有小概率静默失败（时序依赖，难复现难自诊）。
- 安全语义受损：用户明确解除的授权可能悄悄恢复。

## 修复要点

1. 状态事件先按 PID / 启动 generation 验证归属（事件必须来自当前
   slot 的活进程），再允许 `persist_owner`。
2. 加 Rust 测试覆盖「unbind 与旧进程迟到 binding 事件并发」的时序。
3. 将来 Discord 接入直接继承修好后的路径，不复制此竞态
   （`.scratch/discord-channel/PRD.md` 已引用本 issue）。

## Comments

- 2026-08-13（agent）：已修，Discord 开工第一步。实际竞态比首报多一层：
  `unbind_owner` 原先「先清 pref、后重启换代」，清完到 slot 换 pid 之间
  旧进程仍是当前代。修复三件套：①事件准入抽成纯函数 `admit_event`——
  pid 不匹配的事件整体拒绝（既不动 slot 也不返回 owner）；②
  `persist_owner` 挪到准入校验之后且留在 slots 锁内，与 unbind 的
  灭代序列原子互斥；③`unbind_owner` 改「杀进程 → slots 锁内 pid 置
  None 灭代 → 清 pref → 重启」，并补拿 lifecycle 锁（顺手关掉与并发
  start 的竞争；`start_inner` 照 stop/stop_locked 先例拆出
  `start_locked` 避免锁重入）。三个回归测试
  （`admit_event_*` / `retired_generation_cannot_resurrect_cleared_owner`）
  + workspace 全量测试通过。
