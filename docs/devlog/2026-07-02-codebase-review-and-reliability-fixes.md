# 2026-07-02 · 全 codebase review + 前三档可靠性修复

> Status: 修复进行中（3/7 档完成） · Related:
> [`docs/audits/codebase-review-2026-07-02/`](../audits/codebase-review-2026-07-02/README.md)

## Context

v0.2.16 发布后做了一次全 codebase code review：4 个并行 review agent 分别深读
`gui/` / `core/` / `cli/` / `runner/`，只报经源码验证的真实问题，产出 56 条带
ID 的 findings（3+2+2+1 = 8 条 high）。完整清单和逐条修复状态在 audit 文档里，
**那份文档是修复工作的 cursor**，本文只记决策。

Review 的总体结论：架构纪律好（参数化 SQL、类型化 IPC、错误分类），无注入类
漏洞；真正的问题集中在四个系统性模式——失败路径缺原子性/兜底、fire-and-forget
异步调用、进程生命周期缺互斥、把截断/共享数据当全量/独占用。所有 high 都落在
无测试的失败路径上，所以修复约定为：**每修一个 high 必须补对应失败路径测试**。

## Decisions

- **修复按档推进，不按模块**：quick wins → 数据安全 → Stop/审批链 → Goal 子系统
  → 进程生命周期 → Windows → 飞书访问控制决策。跨模块的同一条用户链路
  （如 Stop/审批横跨 runner + GUI）必须一档内一起修，单侧修了没有意义。
- **CORE-2 选了「删除父表导入」而非「加过滤 JOIN」**：核查 021/023 迁移原文
  确认 rebuild 模式是「父表先复制进 `*_new` 再 DROP」（`goals.proposal_id`
  是 SET NULL 非 CASCADE），父行从不是级联 bug 受害者——backup 有而 main 没有
  的 goal 只可能是用户删的。恢复逻辑因此收窄为只导入子行，与函数文档承诺一致。
- **CORE-1 迁移事务化的附带语义变化**：021 结尾的 `PRAGMA foreign_keys = ON`
  在事务内变 no-op，预检全程 FK 保持关闭。这是修正而非回归——预检的存在目的
  就是 FK-off，此前它会被 021 中途意外重开。
- **GUI 审批/Stop 采用「乐观更新 + 失败回滚」而非「等发送成功再更新」**：
  保住即时反馈，失败时回滚 UI（撤销决定、放回审批卡、解锁 Stop 按钮）+ toast
  引导重试。配套把 `approval_response` / `abort` 提升为 user-visible IPC 命令
  （bridge 缺失时 reject 而非静默返回）——静默丢失才是根因。
- **RUNNER-1 的顺序约定**：Abort 时先 `agent.abort()`（置 stop_sig）再
  `resolve_all_pending("deny")`，被唤醒的 GA 线程立即走退出检查而不是把
  deny 当普通拒绝继续跑完本轮。

## Rejected

- **对 goals/goal_proposals 加恢复过滤 JOIN**（CORE-2 的 review 原建议）：
  父行既然不可能被 bug 删除，过滤后的导入永远是空集，不如删掉代码诚实。
- **Stop/审批「等发送成功再更新 UI」**：多一次 IPC 往返的延迟感知，且失败
  概率极低，不值得为此牺牲常态体验。
- **yolo 同步失败弹 toast**：失败方向安全（bridge 保持 yolo=false 只会多弹
  审批），toast 是噪音，log-only 足够。

## 下一步

第 4 档 Goal 子系统（audit 文档「修复顺序」§4）：CLI-1（50 事件窗口）是根因
先修——信号计数改专门 DB 查询或 since-id 游标；CLI-3 需要把 worker session ids
持久化到 goal（可能加迁移）；CLI-2/4 跟上。这一档有设计决策，动手前值得先读
audit 文档里 CLI-1/2/3/4 和 CLI-9 的完整描述（CLI-9 的空转事件自我放大与
CLI-1 联动）。
