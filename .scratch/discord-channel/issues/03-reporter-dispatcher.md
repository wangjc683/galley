# reporter 改单 dispatcher + 消息 origin 路由

Status: ready-for-agent
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
