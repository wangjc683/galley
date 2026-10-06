# 03 减法与预算闸

Status: done（2026-10-06 实施；真机回归清单第 6、9 条待 JC 在 `tauri dev` 里跑）

起因：JC「既然是 less harness，又需要控制系统提示词的量，不能放太多」。

实测（估算，CJK 约 1 tok/字、其余约 3.8 字符/tok）：工作台固定前缀约 4860 tok，其中 GA 核心提示词约 480、GA 记忆约 680、
工具定义约 1510、Galley 静态规则约 1710、下一步建议约 360、状态块约 115。Galley 层合计约占 45%。

改动（`core/src/managed_prompt.rs`）：

- **定时任务一节并进配置边界**：「去侧栏定时、帮用户拟提示词和时间」已被功能地图和边界一节覆盖，只保留两件事：
  拟的提示词要能独立运行（每次运行开新对话）；GA 自带调度器在 Galley 里不运行，不写 `sche_tasks`、不说已设置。
- **历史查询一节只带本平台的命令**：`history_cli_commands!` 按 `cfg(windows)` 选一套，`RUNTIME_PROMPT_STATIC` 改为
  `concat!`，仍是 `&str`。措辞压缩（IM 限制与 `L4_raw_sessions` 死路保留）。
- **预算闸**：测试 `static_prompt_stays_within_budget`，`workbench_static_prompt()` 不超过 `STATIC_PROMPT_BUDGET_BYTES = 6688`
  （按较长的 Windows 变体定，不留余量）。计字节不计 token（CI 没有分词器），不计 `\r`：Windows 检出会把原始字符串变成 CRLF，
  模拟 CRLF 后总长 6822，不排除 `\r` 会在 Windows CI 上误报。

结果：静态规则约 1710 → 1400 tok（−315）。保留不动：浏览器控制（`tabs create` 用了 135 次）、你创建的文件、
下一步建议（每轮遵从率 8 月 76%、9 月 86%、10 月 100%；用户后续 92 条消息里 15 条原样采纳）。

测试：新增本平台命令一条、预算闸一条，改定时一条；`cargo test -p galley-core --lib managed_` 38 passed。
