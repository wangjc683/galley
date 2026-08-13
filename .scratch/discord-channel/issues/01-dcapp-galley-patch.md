# dcapp Galley 集成补丁

Status: ready-for-agent
日期：2026-08-13

照 `0014-managed-telegram` 模板给 `managed-ga/code/frontends/dcapp.py`
打集成补丁，**保留** per-channel agent 路由 / @提及激活 / thread 处理，
**替换**访问控制。清单（细节全在 [PRD](../PRD.md)）：

- `GALLEY_DISCORD_CONFIG_JSON` env 注入（`_GALLEY_MANAGED` 旗标绕开
  mykeys）、`GALLEY_STATUS_HOOK` 状态回调、可调用 `main()` /
  `check_config()`。
- owner 绑定：**配对只认 DM**（外审票 3），6 位配对码，错误尝试按
  用户限流（单用户 5 次拉黑），无全局作废；Server 频道只做 @ 激活；
  非 owner 消息静默忽略。
- 激活语义沿用上游隐式（外审票 2），激活确认文案含退出命令；**禁用
  绑定后的 DM 对话**（V1 裁决）。
- 连接状态机：token/intent 类永久错误立即 error 退出；网络类才
  reconnecting；`on_ready` 才 running；停止关 client 与后台任务。
- agent 生命周期：LRU 压 8~16 + 真 close 协议（sentinel + stop event
  + join；`abort()` 不够）；重启/驱逐同步取消频道 active。
- 状态文件迁 `--state-dir`（active 集 / 附件 / 日志）；消息日志去
  内容化；附件每 turn 临时目录用后即清（外审票 4 卫生活）。
- Polish：1900 字符切分避开 code fence。

补丁登记进 `managed-ga/manifest.json` + `patches/manifest.md`
（touched files / rebase 风险 / 移除条件）。
