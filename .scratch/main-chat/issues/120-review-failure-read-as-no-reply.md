# 120 诊断：巡看补跑失败，被当成「没话说」丢掉了

Status: ready-for-agent（2026-11-02 开票；只查不改）

来源：[主对话 PRD](../PRD.md) 裁决 165。

## 发生了什么

- 11-02 本机重启后，主会话在本地 13:33 左右起了 `tauri dev`（日志在主会话 scratchpad 的 `tauri-dev.log`，路径见派单；Core 启动段只有十几行）。调度器补跑当天 08:51 的巡看（`sched_bd75f9d3f8392096`）。
- dev 日志，按先后：
  ```text
  [segment s-mvfzje17-ds10bbno] idle since 2026-10-30T09:28:33+00:00: new segment from turn 293
  [session_runner s-mvfzje17-ds10bbno] load_history (20 messages, opening with 10 turns carried over) into pid 45074: confirmed in 1.1ms
  [subtask-report s-mvfzje17-ds10bbno] woke the main chat for 1 report(s)
  [runner stderr s-mvfzje17-ds10bbno] [run-complete] task ended without an exit after turn 0; closing the run as DONE_WITHOUT_EXIT
  [subtask-report s-mvfzje17-ds10bbno] morning review sched_bd75f9d3f8392096 not delivered (NoReply), dropped
  ```
- 引擎日志 `~/Library/Application Support/app.galley/managed-ga-state/temp/model_responses/model_responses_518928.txt`：只有一条 `=== Prompt === 2026-11-02 13:34:12`（巡看的提示），没有 Response。
- 库里主对话第 293 轮只有那条系统消息（`created_via = system`，05:34:12Z），没有任何助理行。
- 一分钟后（05:35:15Z）主会话用 CLI 给主对话发了一句，同一个 runner（pid 45074）正常跑完 6 步。所以不是模型一直不通。
- 主对话的模型走订阅登录路线（runner 向 Core 取令牌，`managed-ga/code/llmcore.py:612` 一带有 10 秒超时）；这是重启后第一次请求。GA 的重试、报错打在标准输出上，runner 把标准输出接到了 `/dev/null`（`runner/workbench_bridge.py:73-88`，票 116「没查实」一节）。

## 要查清

1. **第一次请求为什么没有回应**：从代码与现有日志能推到哪一步。GA 这一步走了哪条路（取令牌失败、建连失败、请求异常、空响应、重试用尽），每条路在 GA / runner 里会留下什么、结果是不是都落成「第 0 步没有 exit 就结束」。Core 这边在 13:34 前后有没有令牌刷新、凭据 IPC 的记录（dev 日志、库里相关表）。能确定就给证据链；确定不了就列出各种可能，写清缺哪份证据才能分辨，以及要补什么日志才能下次分辨。
2. **Core 怎么把这一轮判成 `NoReply`**：读 `core/src/subtask_report.rs`（`[subtask-report]` 那几行）和 runner 的 run-complete 收尾（`DONE_WITHOUT_EXIT`），列出一次叫醒（巡看、子任务回报、提醒到点）的几种结局各被判成什么、各自去哪（丢掉、留着下次再试 `kept for the next try`、交给用户）。哪几种失败会被读成「没话说」。
3. **以前发生过没有**：10-20 以来 Core 叫醒主对话的轮次（系统消息）里，没有任何助理行就结束的有几轮；分别是哪类叫醒、当时有没有别的迹象。巡看自己有没有落库的记录（project-status 提过「the review log records only `woke`」），能不能看出哪天的巡看没跑成。
4. **影响**：巡看一天只跑一次，这一次丢了，当天就没有了吗（调度器会不会再补）；子任务回报、提醒到点遇到同样的失败会怎样（回报丢了，主对话就不会告诉用户子任务做完了）。

## 交回

- 原因：一句话结论，加证据链（`file:line`、日志行与时刻、库里字段值）。查不实的写「没查实」和缺什么证据。
- 第 2 条的结局表，第 3 条的统计。
- 2–4 个修法选项，带一个推荐。至少覆盖：失败与没话说分开判（失败的叫醒重试一次或留着下次，或者告诉用户）；让这类失败下次查得到（GA 的标准输出、关键报错落到哪里）。每个写清：harness 重量（大概改哪些文件、多少行）、会不会在用户没要求时多花 token、上游 GA 有没有现成的、外置运行时的影响。修不修由主会话和 JC 定。

## 边界

- **只读**：数据库用 `sqlite3 -readonly`；不写 Galley 数据库，不写内置或外置 GA 的任何文件，不动代码，不调模型，不碰浏览器；不给 Galley Core 发会改状态的命令（`galley status`、`session show` 这类只读查询可以）。JC 的 `tauri dev` 正在跑，别停它、别重启它。
- 不建 worktree；只改本文件的「## 报告」一节，不提交（主会话验收后提交）。临时脚本放 scratchpad，用 `t120-` 前缀命名。
- 引用匹配行时用 `grep`，不要用 `rg`。
- 本文件在开源仓库里：路径写成 `~/…`，不写本机用户名；不写服务商名、接口主机、密钥、令牌；摘日志时把这些涂掉。
- 中文用全角标点。

## 报告

（代理填写）
