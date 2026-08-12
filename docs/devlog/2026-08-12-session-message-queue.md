# 会话消息队列：把 GA 的不可控串行队列，换成 Core 拥有的可插队队列

**日期**：2026-08-11（设计 / 实现）～ 2026-08-12（验收）
**关联**：[galley#19](https://github.com/wangjc683/galley/issues/19)、
[galley#20](https://github.com/wangjc683/galley/issues/20)（同一位报告人
Kinda2419）
**发布**：`v0.4.6`
**动作槽视觉裁决单记**：[定 B](./2026-08-12-queue-slot-variant-verdict.md)

## 为什么两个 issue 合成一个 feature

- #19：运行中发的消息默认排队，任务结束自动按序执行，每条可「插队」。
- #20：点暂停后立刻释放输入区，停止期间发的消息在停止完成后自动发出。

**#20 是队列在 stopping 态下的特例；#19 的「插队」= 自动执行一次
「暂停 → 排队 → 停止完成自动发出」。** 公共底座是同一个：composer 与
运行状态解耦 + 单会话出站队列。队列原语建好后 #20 近乎免费。分开做
会得到两套互相打架的状态机。

## 调查推翻了两个前提

设计轮拿 file:line 逐条核实现状，其中两条直接改写了方案：

### 1. 「运行中 send 是错误路径」——不是，是**事件流损坏的 de facto 排队**

Core 的 `dispatch_session_send` 落库后直接透传 bridge，**不检查
`agent_running`**（对比 `session.stop` 是检查的）。而 bridge 收到
mid-run 的 `UserMessageCommand` 会立刻 `run_in_progress.set()` +
`_emit_turn_start(1)`——**消息其实排进了 GA 的串行队列还没开跑，事件
流却谎报它已开跑**，两个进度 drain 线程互踩。

这条推翻了原定案 4（CLI 加 `--queue` 附加参数、保持现有行为不变）：
「现有行为」本身是坏的，保它没有意义。改为 **CLI 默认走 Core 队列**，
`dispatch` 字段新增 `"queued"` 值（additive），另加 `--jump` 供
supervisor 插队。

### 2. GA 引擎层已有串行队列——但**不可控，不能拿来用**

`agentmain.py` 的 `put_task` / `run()` 天然串行，「运行中发消息自动
排队」在引擎层本来就成立。但 `abort()` 开头就是
`if not self.is_running: return`——**对「排队中尚未开跑」的任务无效**。
排进 GA 队列的消息无法撤销、无法插队、abort 之后照跑。

所以队列必须建在 GA **之前**：Core 侧 per-session `VecDeque`，
**GA 的内部队列永远只持有当前活跃任务**。这也是唯一同时满足 Rule 5
（业务权威在 Rust）、可插队可撤销、CLI 与 GUI 同权的位置。

## 关键决策

1. **不持久化**：in-memory，进程内有效，重启即空。理由：重启丢队列
   ≈ 重启丢未发送的草稿，用户心智一致；不动 SQLite schema。
2. **落库时机 = 出队下发时**，排队项不进 messages 表、不进 transcript。
   否则会出现「消息序 ≠ 执行序」，以及被撤销项留下的幽灵行。
3. **统一入口 `dispatch-or-enqueue`**：原子判定「在跑或队列非空 → 入
   队，否则立即下发」。GUI 的运行中/停止中发送与 CLI 的运行中 send 都
   收敛到这一个 Core 内的判定，**天然免掉「点发送的瞬间 run 恰好结束」
   的竞态**。
4. **出队门用 `open_run`，不用 `agent_running`**（实现期修正）：
   后者在 TurnEnd 也清零，轮与轮之间存在假空闲窗口，队列会抢在下一轮
   开跑前挤进去。`send_command` 是所有派发路径的 funnel，成功发出
   UserMessage / AskUserResponse 即开门（`/btw` 豁免，与 bridge 旁路
   同形状，两侧 keep-in-sync）。
5. **ask_user 挂起时队列让路**：Agent 提问期间不出队，应答或被抢占后
   恢复。否则队列会替用户把问题「答」掉。
6. **崩溃兜底 = 队列原地保留 + 手动「立即发送」**，不自动重拉 runner。
   队列挂在 session 键下而非 `RunnerProcess`，respawn 不丢。
7. **连发多条严格按序**，不做「以最后一条为准」的合并——不丢消息优先。
8. **bridge 留一道防御闸**：mid-run 的 `UserMessageCommand` /
   `AskUserResponseCommand` 直接业务拒绝。Core 接管队列后合法流量不会
   再 mid-run 到达 bridge，这道闸是防止事件流将来再被别的路径打乱。
9. **排队消息 v1 纯文本**：与 CLI v1 text-only 契约一致。GUI 运行中带
   图发送沿用 image-block toast 提示等空闲再发，省掉附件 data URL 在
   Core 内存里排队的整套 plumbing。

## 实现期踩到的两个坑

- **dev 启动 panic**：全局 drain task 误用裸 `tokio::spawn`，而 Tauri
  setup hook 里没有 tokio runtime。改 `tauri::async_runtime::spawn`，
  教训已记进代码注释。
- **插队抢占后提问气泡残留**（验收轮 JC 发现）：气泡清理原本依赖
  user-row append 事件，插队路径不走那里。改为 GUI 的 `turn_start`
  处理器**无条件失效** `pendingAskUser`——新 run 开跑即问题不可回答
  （bridge 也会拒绝迟到的应答），队列插队 / CLI send 等一切抢占路径
  统一覆盖。

## 契约面（additive，schemaVersion 仍为 1）

- `session send` 响应新增 `dispatch: "queued"` 与
  `queue: {queueId, position}`，此时 `message: null`。
- 新增 `--jump`。
- 新事件 `session-queue:changed`，全量快照 payload，仿 scheduled-tasks
  模式（常量 + 类型化 payload）。给 string enum 加新值是 non-breaking。

文档：agent-api session-commands §5.5a、stability dispatch 表、
ipc-protocol §5.1。

## 明确不做

- 跨会话全局调度（非目标）。
- 队列项拖动重排；「编辑」= 撤销 + 文本回填 composer，不做独立编辑 UI。
- Goal 编排流、`/btw` 旁路、ask_user 应答不入队。

## 真机验收（2026-08-12，JC）

运行中发送入队 → 任务结束自动接续；停止中发送 → 停止后自动发出；插队
打断；chips 编辑 / 删除；CLI 对运行中会话返回 queued 形状；ask_user
挂起时队列不抢跑（全链路：不抢跑 / 应答后自动接续 / 回答不误入队列）。
边界「插队抢占后提问气泡残留」当场发现并已修（见上）。
