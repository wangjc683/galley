# 系统提示词减法与预算闸

**日期**：2026-10-06
**上下文**：[方向一](./2026-10-06-runtime-prompt-self-description.md)做完后，JC 问还有什么可推进，并提出「既然是 less harness，
又需要控制系统提示词的量，不能放太多」。讨论后回「按建议推进下一步」。跟踪：`.scratch/runtime-prompt-polish/issues/03`。

## 预算实际花在哪

本机没有分词器，按 CJK 约 1 tok/字、其余约 3.8 字符/tok 估算（绝对值有出入，比例可信）。工作台每次请求的固定前缀约 4860 tok：

| 组成 | 约 tok |
|---|---|
| GA 核心提示词 `sys_prompt.txt` | 480 |
| GA 记忆（固定结构 + `global_mem_insight.txt`，`ga.py:605` 每 10 轮还会再注入一次） | 680 |
| GA 工具定义 `tools_schema.json` | 1510 |
| **Galley 静态规则** | **1710** |
| Galley 下一步建议（仅工作台） | 360 |
| Galley 状态块 | 115 |

Galley 层合计约占 45%，是整个前缀里最大的一块，比 GA 内核自己的提示词加记忆还多将近一倍。「less harness」落在提示词上，
主要空间在减法。

## 逐节核对（workbench.db 只读）

- **浏览器控制**：上游 `tmwebdriver_sop` 只教 `{cmd:'tabs'}`，不教带 URL 的 `tabs create`；后者用了 135 次。`window.open`
  在内置会话里最后一次出现是 05-26（这条规则 05-27 加入），09-18 那几次出在外置会话里，外置不注入这一层。规则在起作用，保留。
- **下一步建议**：先按消息算出 38% 的遵从率，是错的：同一次运行会存好几条带 final answer 的消息。改按用户轮次重算，
  8 月 76%、9 月 86%、10 月 100%（7/7）。采纳：92 次用户接着发消息，15 次原样采纳（16%）。保留，不压缩，
  08-05 的教训是措辞一松遵从率就掉。
- **历史查询**：4 个会话调了 10 次，在用；但 macOS 和 Windows 两套命令（各约 70 tok）在每个平台都发。
- **定时任务**：「去侧栏定时、帮用户拟提示词和时间」已被方向一的功能地图和配置边界覆盖，等于说了两遍。
- **加法候选**：界面渲染能力，804 条最终回答里 mermaid / LaTeX 为 0，没有事故；和 GA「禁止推诿」的张力已由配置边界覆盖。
  都不加，符合准入测试的「由事故驱动」。

## 做了什么

- 定时任务一节并进配置边界，只留两件事：拟的提示词要能独立运行（每次运行开新对话，这条原文里有、对拟稿质量有用）；
  GA 自带调度器在 Galley 里不运行，不写 `sche_tasks`、不说已设置。
- 历史查询只带本平台的命令：`history_cli_commands!` 按 `cfg(windows)` 选一套，`RUNTIME_PROMPT_STATIC` 改为 `concat!`，
  仍是 `&str`，现有的 `starts_with` / `contains` 断言不用改（先在 scratchpad 里验证过 `concat!` 能展开嵌套的 `macro_rules!`）。
  措辞压缩，IM 限制与 `L4_raw_sessions` 死路保留。代价：静态文本因平台而异，Windows 与 macOS 的提示词哈希不同（只作诊断）。
- **预算闸**：测试 `static_prompt_stays_within_budget` 限制 `workbench_static_prompt()`（共享规则 + 建议一节，正是哈希覆盖的范围）
  不超过 `STATIC_PROMPT_BUDGET_BYTES = 6688`，按较长的 Windows 变体定，不留余量。规则写进
  [prompt-composition](../managed-ga-runtime/prompt-composition.md) 的 Budget 一节：加条款先删或缩；要抬上限，必须和条款同一个 diff，
  理由进条款台账。
  - 计字节不计 token：CI 没有分词器。
  - 不计 `\r`：仓库没有 `.gitattributes`，GitHub Windows runner 的 Git 默认 `core.autocrlf=true`，检出后原始字符串是 CRLF。
    模拟 CRLF 后总长 6822，直接计长度会在 Windows CI 上误报；排除 `\r` 后正好 6688。
- 按需指南（[deferred](./deferred.md)）的启动信号加一条：预算闸卡住新条款时，把 About 的功能地图挪进指南，常驻可再省约 350 tok。
  指南因此也是减法工具。

结果：静态规则约 1710 → 1400 tok（−315）。

## 验证

- `cargo test -p galley-core --lib managed_`：38 passed（新增本平台命令、预算闸两条，改定时一条）。Windows 分支的断言靠 CI 的
  Windows Core job 跑。
- **未做**：真机回归。改动涉及清单第 6 条（历史查询）、第 9 条（定时），连同方向一的第 10–13 条，一起留给 JC 在 `tauri dev` 里跑。

## 下一轮候选

IM 入口层约 790 tok，只在 IM 渠道带，是剩下最大的一块。它关系到 Supervisor 行为是否正确，测试也多，单独一轮看。
