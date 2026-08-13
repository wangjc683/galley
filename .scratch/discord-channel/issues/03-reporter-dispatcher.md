# reporter 改单 dispatcher + 消息 origin 路由

Status: done
日期：2026-08-13
注意：动现有飞书/Telegram 路径，必须带测试走。

外审票后的定案设计（PRD「硬骨头一」）：

- 路由真相从 session origin 改为**消息 origin**：按最终轮同 turn 的
  user message 的 `origin.supervisor` 路由；状态键改
  `(final_message_id, supervisor_id)`。修掉现有缺陷：频道/渠道 A 建的
  session 被 B 续聊结果推回 A、GUI 建的 session 被渠道续聊不推送。
- 单 dispatcher：一次轮询、一个状态写者、按 origin 分发到 channel
  registry；进程启动即恢复路由（不等频道来消息）。
- `ChannelAdapter.send()` 的异步桥：`run_coroutine_threadsafe` + 带
  超时 ACK；发送不得吞异常；失败不重复烧 synthetic turn（attempt
  计数修正）。
- 现有 `FeishuChannel` / `TelegramChannel` 迁到 dispatcher 下，行为
  等价验证（`runner/test_im_reporter.py` 扩展）。

**先做本 issue 再做 04**——04 的 DiscordChannel 挂在新 dispatcher 上。

## Comments

- 2026-08-13（agent/Fable）：已实施，runner 全量验证绿（pytest 220 通过
  / mypy strict / ruff）。要点：
  - `ImReporter` 改为进程级 dispatcher：channels registry（threading.Lock
    保护，`register_channel`/`unregister_channel` 供 04 动态挂频道）、
    单一轮询 + 单一状态写者；`FeishuReporter`/`TelegramReporter` 与
    `start_*_reporter` 工厂签名不变（补丁侧零改动）。
  - 路由改按消息 origin：`routing_supervisor` 取最终答案同 turnIndex 的
    user message 的 `origin.supervisor`（无 turnIndex 退位置序，尾部截断
    /GUI 轮退 session origin——保持旧行为不扩权）。修掉两个现有缺陷：
    A 渠道建的 session 被 B 续聊推错、GUI 建的被渠道续聊不推。
  - 候选集从「本 supervisor 建的 session」扩为「全部非 archived 且有
    活动变化的 session」，配 `ReporterState.prune`（session 从 DB 消失
    即清 entry）防状态膨胀；异己路由只 mark_seen 不 mark_reported。
  - `_deliver` 的 render/send 异常改计入 reportAttempts（有界重试），
    不再逃逸到 run_forever 的兜底导致每 tick 重烧 synthetic turn；busy
    从「中断整轮」改「跳过该报告」（多频道下其他频道继续流动）。
  - `ChannelAdapter.send` 文档化失败契约：必须抛错，异步平台用
    `run_coroutine_threadsafe(...).result(timeout)` 拿真 ACK（04 的
    DiscordChannel 按此实现）。
  - 与票面字面的偏差：状态键保持 per-session 的 `lastReportedMessageId`
    而非 `(final_message_id, supervisor_id)` 元组——一条 final 只路由到
    一个 supervisor，per-session 键已达成同等幂等性且状态更简单。
  - 测试：25 个（含新增路由单测 ×4、GUI 续聊回归、异己 turn 不误报、
    发送失败有界放弃、双频道路由 + busy 隔离 + 注销、prune）。
- 2026-08-13 集成修补（Fable，验收 04 时发现）：01 的「managed 重启释放
  全部活跃频道」× 03 的「未注册路由目标一律当外人 mark_seen」组合出
  重启后漏报——重启前派出的任务在频道重新激活前完成即被永久吞掉。
  dispatcher 新增 `owned_prefixes`：前缀命中但未注册的路由目标改为
  挂起（entry 不动、逐 tick 重查），频道重新激活即补投。
  `DiscordReporter` 以 `galley-im/discord/` 前缀声明所有权；单频道
  平台不受影响。回归测试
  `test_owned_prefix_report_is_held_until_channel_reactivates`。
