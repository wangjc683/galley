# 120 诊断：巡看补跑失败，被当成「没话说」丢掉了

Status: ready-for-human（2026-11-02 诊断完成。主会话核过：`llmcore.py:638` 取令牌超时 `max(5, connect_timeout)` 即 10 秒；`managed_model_secrets.updated_at` 最后一次是 05:34:23，比巡看那次 Prompt 晚 11 秒；`sched_bd75f9d3f8392096` 的 `last_fired_at` 05:34:10、`last_wake` 为空。修不修等 JC 定）

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

（2026-11-02，诊断代理，只读：库用 `sqlite3 -readonly`，凭据表只读了时间字段，没有解密任何凭据；引擎日志只读；没调模型、没碰浏览器，没给 Core 发命令。行号按当前 main。`managed-ga/code/llmcore.py` 13:50 合入了补丁 0030，13:34 跑的那份里，下文引到的位置都比现在靠前 26 行，括号里注当时的行号；Core、runner 与 GA 其余文件从 13:33 编译 dev 到现在没有改动。库里时间是 UTC，dev 日志与引擎日志是本地时间（+08:00）。）

### 结论

巡看这一轮死在取令牌上，模型请求根本没发出去。订阅登录的访问令牌一小时有效，这台机器上一次模型请求在 10-30 17:28，隔了 68 小时，这次请求要先等 Core 联网刷新令牌；Core 这次刷新用了约 11 秒，内置 GA 向 Core 取令牌却只等 10 秒（补丁 0007 的取令牌代码，超时取 `connect_timeout`，订阅登录预设是 10）。超时的异常抛在拼请求头的时候，在 GA 的重试循环之外，不重试，一路冒出任务循环，这一轮在第 0 步以 `DONE_WITHOUT_EXIT` 收尾。Core 照规矩把「叫醒的一轮出错、没有回复就结束」记成 `NoReply`，巡看送不到一律静默丢掉，当天这一期也算用掉了。约 1 秒后 Core 刷新完成、存好了新令牌，所以一分钟后那句一发就通。

严格说这一轮不是「被当成没话说」：Core 的记录里两者分得开（出错：`last_wake` 置空，巡看日志多一条 `dropped`、理由 `no_reply`；真静默：`last_wake = delivered`，日志只有 `woke`）。问题在处理和呈现：出错的叫醒和送不到一样直接丢掉、不补，主对话里也什么都不画，你看到的和真静默一模一样；`NoReply` 这个名字也容易读成 `<no-reply/>`，它的定义其实是「出错或 runner 退出，没有回复」（`core/src/api/schedule.rs:68-70`）。

### 证据链（第 1 问）

1. **异常抛在请求里，而且不在重试循环里。** `NativeToolClient.chat` 发请求前写 Prompt（`llmcore.py:1504`，当时 1478），整条回复读完才写 Response（`:1510`，当时 1484）。`_stream_with_retry` 里的建连失败、超时、HTTP 错误、流中断都会被接住，重试用尽（或流已断）就把报错文字当回复正文返回（`:569-625`），照样写一条 Response。`model_responses_518928.txt` 第 1 行是 13:34:12 的 Prompt，下一条是第 5 行 13:35:15 的 Prompt，中间没有 Response：只能是重试循环之外抛了异常。
2. **重试循环之外、请求路上会抛的，只有取令牌和拼请求体。** 订阅登录这条路在拼请求头时调补丁 0007 加的取令牌函数（定义在 `llmcore.py:627`，调用在 `:748`，当时 601、722），排在 `_stream_with_retry`（`:772`）之前；它出任何错都包成 `RuntimeError` 往上抛（`:656-657`，当时 630-631）。拼请求体（历史整理、格式转换）只看历史，出错会在 1 秒内，而且下一次带着同样的历史还会出；同一个进程一分钟后带着同样的历史就发通了。
3. **时长对得上取令牌的超时。** Unix 套接字等 `max(5, connect_timeout)` 秒（`llmcore.py:638`，当时 612）。主对话用的是默认那条订阅登录模型，库里 `preset_options.connect_timeout = 10`、没有覆盖值，来自订阅登录预设（`core/src/chatgpt_siwc/mod.rs:145-156`）；runner 把它映射成 GA 的 `timeout`（`runner/managed_runtime.py:157-158`），GA 读进 `connect_timeout`（`llmcore.py:895`）。Prompt 写在 05:34:12，这一轮收尾、巡看被丢在 05:34:22（巡看日志 `dropped` 的 `at`；`scheduled_tasks.updated_at` 也是 05:34:22），正好 10 秒。
4. **这次确实要刷新，而且刷新超过了 10 秒。** 令牌最长一小时就要刷新（`gui/src/lib/ipc-handlers.ts:431-434` 的注释，过期时刻取令牌里的 `exp`，`core/src/chatgpt_siwc/secret.rs:306-307`）；离过期不到 120 秒就在请求路上同步刷新（`core/src/chatgpt_siwc/refresh.rs:57-73`，`mod.rs:103`），刷新的 HTTP 超时是 20 秒（`mod.rs:104`、`:512`）。引擎日志里上一条 Response 是 10-30 17:28:33，之后 68 小时没有请求。库里订阅登录那条凭据（`managed_model_secrets`，只读了 `updated_at`）的最后写入是 **05:34:23**：Prompt 后 11 秒，这一轮收尾后 1 秒，此后再没写过；而 05:35:15 那句一次就通了。刷新失败时 Core 也会写凭据：暂时失败或被拒，记下错误、令牌不变（`refresh.rs:88-99`、`:270-283`），下一次请求得再刷新、再写一次；令牌作废，清空令牌（`:82-87`），下一次请求直接失败。两种都对不上 05:35 那句一次就通、此后再没写入，所以 05:34:12 开始的这次刷新是成功的，只是晚了：runner 第 10 秒放弃，Core 第 11 秒才存好。Core 回写时对面已经关了，这个错误被丢掉（`core/src/credential_ipc/mod.rs:206`）。启动时也没有别的刷新：要是有，05:34:12 就用不着刷新，也不会有 05:34:23 这次写入；那几秒 `prefs` 里的写入只有渠道状态、界面偏好和巡看自己的记录。
5. **后面的收尾都按代码走。** 异常冒出 `agent_runner_loop`，`agentmain.run()` 的 `except` 先 `print("Backend Error: …")`，打到标准输出，被 runner 接到 /dev/null（`runner/workbench_bridge.py:73-88`），再把 `format_error(e)` 接在任务的 `done` 后面（`agentmain.py:251-253`）。runner 收到 `done` 时运行还开着，走 `_close_run_without_exit`（`workbench_bridge.py:1385-1429`）：往标准错误打 `[run-complete] … after turn 0`（`current_turn` 只在 turn_end 钩子里更新，`:1490`，一步都没结束所以是 0），发一条 `runtime` 类错误事件（`task_end`，内容就是那条异常），再发 `DONE_WITHOUT_EXIT`。Core 只把错误内容存在内存里，留给子任务回报用（`core/src/runner_manager/manager.rs:1129-1133`），不打日志，下一次运行开始就清掉（`:1009`）；界面弹一条 toast（`gui/src/lib/ipc-handlers.ts:375-377`），不落库。
6. **Core 的判定。** `record_wake_run_end`（`core/src/subtask_report.rs:1768-1811`）按 `DONE_WITHOUT_EXIT` 判成 `RunEnd::NoExit`（`:894`），把这一轮带着的到点任务交给 `return_due_tasks(…, NoReply)`（`:1783-1795`）；巡看走 `drop_review_wake`（`:1688-1691`、`:1726-1760`），`last_wake` 置空（`core/src/db/schedule.rs:723-735`），巡看日志记 `dropped`、`reason: no_reply`。库里 `sched_bd75f9d3f8392096` 现在是 `last_fired_at = 05:34:10`、`last_due_at = 00:51`、`last_wake` 为空；主对话第 293 轮只有那条系统行（05:34:12），没有助理行。

dev 日志（第 44、46–49 行）与引擎日志的条目头：

```text
[segment s-mvfzje17-ds10bbno] idle since 2026-10-30T09:28:33+00:00: new segment from turn 293
[session_runner s-mvfzje17-ds10bbno] load_history (20 messages, opening with 10 turns carried over) into pid 45074: confirmed in 1.1ms
[subtask-report s-mvfzje17-ds10bbno] woke the main chat for 1 report(s)
[runner stderr s-mvfzje17-ds10bbno] [run-complete] task ended without an exit after turn 0; closing the run as DONE_WITHOUT_EXIT
[subtask-report s-mvfzje17-ds10bbno] morning review sched_bd75f9d3f8392096 not delivered (NoReply), dropped

model_responses_518928.txt
1: === Prompt === 2026-11-02 13:34:12              ← 巡看的叫醒，之后没有 Response
5: === Prompt === 2026-11-02 13:35:15              ← 一分钟后 CLI 发的那句
9: === Response === 2026-11-02 13:35:32 model=<模型>
```

### 第一次请求可能走的几条路

| 路 | GA 里怎么走 | 引擎日志 | 标准输出（现在丢掉） | 怎么收尾 | 和这次对得上吗 |
|---|---|---|---|---|---|
| 1 取令牌超时（Core 10 秒内没答） | `llmcore.py:638` 套接字超时，`:657` 包成 `RuntimeError`，在重试外（`:748`） | 只有 Prompt | `Backend Error: RuntimeError: …` | `DONE_WITHOUT_EXIT`，第 0 步 | 对得上：10 秒，凭据 11 秒后写入，下一次即通 |
| 2 取令牌被拒（要重新登录、刷新暂时失败） | 同上，Core 一答错就抛，报错里带错误码 | 只有 Prompt | 同上 | 同上 | 对不上：要重新登录的话下一次也会失败；刷新暂时失败的话下一次要再刷新、再写一次凭据 |
| 3 拼请求体出错 | 历史整理、格式转换抛异常，也在重试外 | 只有 Prompt | `Backend Error: …` | 同上 | 对不上：1 秒内就会抛，同样的历史下一次还会抛 |
| 4 建连失败、读超时、连接断开、空响应 | `_stream_with_retry` 退避重试 3 次（3、6、12 秒，`:558-561`、`:614-622`，预设 `max_retries: 3`），用尽后回复正文是 `!!!Error: …` | Prompt 和 Response | 每次一行 `[LLM Retry] …` | 正文从第一个字起就是报错，GA 只查第 50 字以后（`ga.py:500`），当成最终回答：第 1 步 `CURRENT_TASK_DONE`，Core 判 `Done` | 对不上：有 Response，光退避就要 21 秒 |
| 5 HTTP 错误 | 可重试的状态码按 Retry-After 退避，套餐类终止错误不重试（`:579-593`），最后正文 `!!!Error: HTTP …` | Prompt 和 Response | `[LLM Retry] HTTP …` | 同 4 | 对不上 |
| 6 流中途断开 | 正文末尾 `[!!! 流异常中断 …]`（`:623-625`） | Prompt 和 Response | 无 | GA 判不完整、让模型重来（`ga.py:500-501`），三次后 `EXITED` | 对不上 |
| 7 你按了停止、runner 退出 | 无 | 只有 Prompt | 无 | `ABORTED`、runner 退出 | 对不上：收尾是 `DONE_WITHOUT_EXIT`，同一个 runner 一分钟后还在 |

只有路 1–3（重试循环外的异常）会落成「第 0 步没有 exit 就结束」；路 4、5 落成一个正常收尾的「回答」，路 6 在这一轮里重来。近一个月的引擎日志里一次 `!!!Error`、流中断、空响应都没有。

### 没查实的，下次要补的日志

- **异常原文没看到。** 按代码应是套接字超时，被包成 `llmcore.py:657`（当时 631）那条取令牌失败的 `RuntimeError`。原文三处都留不下：GA 的打印去了 /dev/null；runner 发给 Core 的错误事件只在 Core 内存里，05:35 下一次运行开始就清了；界面的 toast 不落库。
- **Core 这次刷新为什么要 11 秒。** Core 不记刷新的耗时与结果。本机 09:31 开机，13:34 网络早已就绪，不是开机初期的事；每次刷新都新建 HTTP 客户端（`chatgpt_siwc/mod.rs:510-520`），慢在解析、握手还是对端，看不到。凭据里存着 `last_refresh_at`（设置页的状态命令读得到，`mod.rs:280-321`，界面没显示），我没解密凭据，刷新时刻只能从 `updated_at` 推，精度到秒。
- **下次要能直接分辨，补这几行：** ① Core 收到 `severity = error` 的错误事件时打一行到标准错误（会话 id 加内容），这次的异常原文就会出现在 dev 日志里；巡看的 `dropped` 条目、提醒那行日志带上这条内容（巡看日志在打包版也落盘）。② 凭据 IPC 记一行刷新的耗时与结果；回写失败（对面已经走了）现在被 `let _ =` 吞掉（`credential_ipc/mod.rs:206`），改打一行「runner 已放弃，刷新用了 N 秒」，这一行就能直接认出本案。③ runner 把 GA 打到标准输出的 `Backend Error`、`[LLM Retry]` 两类行转到标准错误（fd 1 照旧接 /dev/null，子进程与 IPC 不受影响）。打包版 Core 的标准错误不落盘，②③ 只对 dev 有用，① 里的巡看日志打包版也有。

### 第 2 问：一次叫醒的各种结局，Core 怎么判、去哪

Core 不看回复内容，只看这一轮怎么收尾（`run_end`，`subtask_report.rs:886-897`）。行号都在 `core/src/subtask_report.rs`。

| 结局 | Core 的判定与日志 | 子任务回报 | 提醒到点 | 巡看 |
|---|---|---|---|---|
| 叫醒前，主对话在等你回答（`:1367-1382`） | `Asking` | 留着，告诉桌面「没送到」，界面改由子任务自己通知；下一次运行信号再试 | 消耗，`last_wake = notified`，桌面用提醒原话通知（窗口在前台时是不自动消失的提示，`gui/src/lib/reminder-notify.ts`） | 丢掉，`dropped / asking` |
| 叫醒前，主对话在跑，或你有排队的话（`:1384`） | 不判 | 等主对话这一轮跑完再问 | 同左（库里仍是 `pending`） | 同左 |
| 送前复查，主对话已不是这一个（`:1560-1577`） | `NoMainChat` | 丢掉，不告诉 | 通知 | 丢掉，`dropped / no_main_chat` |
| runner 起不来、写叫醒行失败、派发失败（`keep_for_later`，`:1645-1667`） | `NotStarted`；日志「could not wake the main chat」「wake failed, kept for the next try」 | 留着下次再试，告诉桌面 | 通知（日志虽说 kept，到点任务其实已消耗） | 丢掉，`dropped / not_started` |
| 送达后，这一轮以 `DONE_WITHOUT_EXIT` 收尾或 runner 中途退出（`:1783-1795`，本案） | `NoReply` | **丢掉，不告诉**：派发时已出队（`:1387`），`in_flight` 只放到点任务（`:1470`），收尾时只看 `in_flight`（`:1778`）；不发「没送到」，界面也就不补子任务自己的通知；同一份回报本进程内不会再加（`:1134`），也不落库 | 通知原话，助理不做事，不再试 | **丢掉**，`dropped / no_reply` |
| 送达后，引擎把请求失败写成回复正文（上表路 4、5） | `Done`，当送达（`:1796-1811`） | 算送达：主对话里一条报错气泡，回报没被处理 | `delivered`：助理没做事，也不会再通知 | `delivered`：日志看不出没跑成 |
| 送达后，正常回复、`<no-reply/>`、问你、停在步数上限 | `Done` / `Asking` / `StepLimit`，送达 | 送达 | `delivered` | `delivered`；静默时界面什么都不画（`gui/src/lib/subtasks.ts:584-607`） |
| 送达后，你按了停止 | `run_end` 为空，当送达 | 送达 | `delivered` | `delivered` |

（子任务又跑起来、问题已答、被你接手或删掉，到点任务被取消或又响了一次，这些在送前复查时剔掉，是有意的，不算失败。）

哪几种失败会被读成「没话说」：

- **巡看：所有送不到的结局都静默丢掉**，等你回答、runner 起不来、这一轮出错（本案）一样处理；出错的这一轮一步都没落定，界面照票 114 的规则什么都不画，和真静默看起来完全一样。区别只在巡看日志（`dropped` 和理由）与 `last_wake`。
- **子任务回报：送达后这一轮出错，回报就没了**，主对话不说，界面也不补通知。从你这边看就是「子任务做完了、主对话没吭声」。
- 反过来被读成「已送达」的：引擎把失败写成回复正文（路 4、5），按代码走得通，近一个月的引擎日志与库里都没出现过。

### 第 3 问：以前发生过没有

10-20 主对话建立以来，Core 叫醒它 13 次（库里 `created_via = system` 的行）：

| 叫醒类别 | 次数 | 有助理行 | 没有任何助理行 |
|---|---|---|---|
| 巡看（到点 5 次，含 10-30、11-02 两次启动后补跑；手动 4 次） | 9 | 8：每次 4–5 步，都以 `<no-reply/>` 静默收尾 | 1：11-02 第 293 轮 |
| 子任务回报 | 3 | 3：都回了话 | 0 |
| 提醒到点 | 1 | 1 | 0 |
| 合计 | 13 | 12 | 1 |

- **叫醒行写进库之前就失败的**：巡看日志里只有 11-02 这一条 `dropped`；`target = assistant` 的提醒 10-20 以来只响过 1 次，`last_wake = delivered`，没有一条是 `notified`；主对话派过 3 个子任务，3 份回报都送到了。
- **巡看自己的落库记录**：`prefs.assistant_review_log`（`core/src/scheduler.rs:161`），到点记 `woke` 或 `skipped`，手动记 `run`，送不到记 `dropped` 和理由；外加 `scheduled_tasks.last_wake`，只留最近一次。10-21 以来 13 条：`run` 4、`woke` 5、`skipped` 3、`dropped` 1（就是这次，`no_reply`）。能看出哪天没跑成：有 `dropped` 的就是。`woke` / `run` 后面没有 `dropped` 的都送达了，但送达后怎么收尾（回了话、静默，还是路 4、5 那种报错正文）日志不记，要对主对话的行，project-status 那句「只记 `woke`」说的就是这个。10-24、10-25、10-31、11-01 一条都没有：这四天库里没有任何消息、引擎日志也没有请求，是 Galley 没开；补跑只补当天（`scheduler.rs:793-797`），这几天本来就没有巡看，不是失败。
- **别的迹象**：引擎日志（最早到 09-30 22:19，共 1287 次请求，含渠道与已删的会话）里「只有 Prompt、没有 Response」的只有两次，本案和 10-23 18:48:27。后者是主对话第 118 轮从桌面发的一句：这一行库里已经没有了（第 117 轮后直接是 119 轮），引擎日志里那条 Prompt 的原文与 51 秒后第 119 轮从桌面发的那句一字不差；删一条主对话消息会让 runner 退休、重开（`core/src/message_delete.rs:43-53`），第 119 轮也确实换了新进程，10 秒后答出来。看起来是第一次没回应，删掉重发。那一次距上一次模型请求 64.7 分钟，也正是令牌要刷新的时候。行已经删了，它是出错收尾还是你按了停止已经看不到，所以原因没查实，只能说征兆一样。
- **刷新的那几次最危险**：照「一小时、离过期 120 秒内刷新」把 10-20 以来 917 次请求重放一遍，约 40 次要在请求路上等刷新（设置页触发的刷新算不进来，是估计）。没有回应的两次都落在这 40 次里，其余 877 次一次也没有。10-20 以来 9 次巡看里至少 7 次正是「闲了一小时以上后的第一次请求」：早上第一件事、启动后补跑。

### 第 4 问：影响

- **巡看：今天这一期没了，调度器不会再补。** 到点判断以 `last_fired_at` 为基线（`scheduler.rs:814-816`），05:34:10 已晚于今天的 08:51，今天不再到点；只有手动 `schedule run` 或桌面上的「立即运行」能再跑。明天 08:51 照常。另有两处会被这次失败带偏：明天判断「上次巡看以来动过什么」从今天 05:34 算起（`core/src/assistant_todo.rs:226`、`:259-265`），备忘的窗口也从今天这一天算起（`MemoReviewWindow::before`）。10-30 那次之后到今天之间动过的东西，今天本该看、没看成，明天也不会再算「动过」。这一次窗口里没有新备忘，动过的待办 1 条（10-30 06:45Z，就在 10-30 那次手动巡看的那一轮里），实际损失很小。
- **提醒到点：同样失败会被消耗，改成桌面通知原话第一行**（`return_due_tasks`，`gui/src/lib/reminder-notify.ts`）。你看得到提醒，但助理不会去做它该做的事，也不会再试。
- **子任务回报：回报丢掉，主对话不会告诉你子任务做完了**，界面也不补子任务自己的通知（`gui/src/lib/subtask-notify.ts` 头注：只有收到「没送到」才自己通知），结果只留在子任务卡片和待办面板里。实际风险比巡看低：子任务跑的时候一直在用同一份令牌，回报叫醒主对话时令牌通常是新的。
- **最容易撞上的是巡看**，它多半就是一天里的第一次请求。你自己发的第一句也会撞上（10-23 那次征兆一样），但你看得到 toast，会重发。
- **平台**：Windows 走命名管道，那一支取令牌没有超时（`llmcore.py:646-648`），会一直等到 Core 刷完，按代码这个毛病只出在 macOS 上。
- **顺带**：失败那一轮的叫醒原文还留在 GA 的内存历史里（`llmcore.py:1080` 先进历史再发请求），下一句来时和它并成一条用户消息发给模型（`_fix_messages` 合并相邻的同角色消息，`:992`）。05:35 那一轮的第一步除了记忆与备忘相关的文件，还读了手册里讲巡看的 `wake.md`，与此相符；它没有做巡看，回的是 CLI 发的那句。

### 修法选项

**甲（推荐）：等令牌等够 Core 刷完，失败的叫醒补一次，报错落到看得见的地方。**

1. 补丁 0007：取令牌的套接字超时由 `max(5, connect_timeout)`（10 秒）改成至少 30 秒（Core 刷新的 HTTP 上限 20 秒，再留余量）。`managed-ga/code/llmcore.py:638` 一行，原地改 `managed-ga/patches/` 里的 0007、不动行数（manifest 写明 0007 行数一变，0008、0021 的零上下文 hunk 要重导；`managed-ga/manifest.json` 只列补丁文件名，不用改），`managed-ga/patches/manifest.md` 的 0007 补一句；`runner/tests/test_managed_ga_llmcore.py` 加一条「IPC 12 秒才答」的用例。连测试约 30 行。代价：刷新慢时第一步多等十几秒；这时你按停止，GA 线程要等这次取令牌返回才放手，下一句最多排后 30 秒。另一种做法是 Core 在拉起 runner 时先在后台刷新，但叫醒的第一次请求在拉起后约 1 秒就发，照样撞上，不推荐。
2. Core：叫醒的一轮以 `NoExit` / `RunnerExited` 收尾时，第一次不消耗，补一次。到点任务在库里本来还是 `pending`：不 settle，把它从 `seen` 里放出来，下一分钟的 tick 会重新叫醒（`restore_pending_reminders`）。这一轮带着的子任务回报也放进 `in_flight`，失败时放回等待队列，并让 tick 在有等待的回报时也试一次（`scheduler.rs` 的 `wake_for_pending`，几行）。第二次还失败，再走今天的路（提醒通知、巡看丢掉），子任务回报改为发「没送到」，让界面按子任务自己的规则通知。补过的次数记在内存（重启后到点任务本来就从库里重读，最多多补一次），不加迁移。`core/src/subtask_report.rs` 约 60–90 行，`scheduler.rs` 几行，测试约 100 行。要一起定的小事：失败那条叫醒行留在库里（没有步，界面不画），重放时模型会看到两条同一期的巡看叫醒，GA 内存历史里也会有两份（见第 4 问「顺带」）；是删掉前一条，还是在重放里标成「没跑成」，票里定。
3. 报错落地：第 1 问最后一节的 ①②③。Core 约 30 行、runner 约 20 行，加测试。巡看日志加的 `detail` 是新字段，只有 `.scratch/assistant/closed-loop-snapshot.py` 读这个 pref，不碰 Agent API。

- Token：1、3 零。2 只在叫醒失败后多一轮叫醒；像这次请求根本没发出去，失败那次没花 token，补的这一轮就是本来该花的那份。10-26 以来巡看一轮约 5–8.5 万输入 token（其中 3–6 万读缓存）、约 1 千输出。
- 上游：都没有。取令牌是 Galley 自己的 0007；叫醒是 Galley 的；GA 的异常原文上游已经接在 `done` 后面，runner 也已经解析成错误事件，只差落盘。
- 外置：1、2 零变化（外置不打补丁，也没有主对话）。3 里 runner 转发那两类行对外置也生效：只是把 GA 自己打印的字换个去处，不写 GA 的文件，合规则 1；只转这两类前缀，别的打印（有的会带配置）照旧丢掉。Core 记日志与运行时无关。

**乙（廉价出口）：只做甲的 1 和 3，不补跑。** 根因修掉，下次查得到；别的第一步失败（断网、刷新真失败、runner 崩）照旧静默丢掉，但巡看日志里会带着报错。约 50 行代码加测试，token 零，上游没有，外置同甲。启动甲 2 的信号：甲 1 合入后巡看日志里再出现 `dropped / no_reply`，或者子任务做完了主对话没吭声。

**丙：失败时告诉你，不补跑。** 界面把「叫醒了、一步都没落定就结束」的一轮画成一行（照票 114「中途停下」的样子，比如「没跑成」），点开看报错；Core 把报错存下来给它显示（同甲 3 的 ①）。GUI 约 40 行、Core 约 20 行，加测试；token 零；外置零变化；上游没有。问题是你看到了也只能自己说「再巡看一次」，而且多一种要认的标记。

**丁：不改，挂信号。** 重量与 token 都是零。信号：巡看日志再出现 `dropped / no_reply`，或者引擎日志里再出现「只有 Prompt、没有 Response」的请求。代价是同样的事还会发生：10-20 以来约 40 次请求路上的刷新出了 2 次（10-23 那次没查实）。

推荐甲：1 修的是根因，Core 的刷新最长 20 秒，等 30 秒就总能拿到它的答复，刷新慢不再变成失败，而这种失败几乎只打在巡看身上；2 才是这张票要的「失败不等于没话说」，对所有叫醒、所有第一步失败都管用，还补上了子任务回报静默丢失的洞；3 让下次不必再靠时间戳推。只想先动最小的，乙是廉价出口。
