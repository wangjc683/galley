# 122 取令牌等够 Core 刷完；叫醒失败的报错落到看得见的地方

Status: ready-for-agent（2026-11-02 开票）

来源：[主对话 PRD](../PRD.md) 裁决 167；诊断见票 [120](./120-review-failure-read-as-no-reply.md) 的报告（证据链、行号、「没查实的，下次要补的日志」一节都在那里，先读）。改内置 GA 补丁 0007、Core、runner 与它们的测试和文档；不动 GUI、CLI、Agent API、迁移。失败的叫醒补跑（120 报告里的甲 2）不在本票，挂在 deferred「失败的叫醒补跑一次」。

## 为什么

11-02 巡看补跑那一轮，内置 GA 向 Core 取令牌只等 10 秒（`managed-ga/code/llmcore.py:638`，`max(5, connect_timeout)`），Core 这次刷新令牌用了约 11 秒；超时在 GA 的重试之外，这一轮第 0 步就结束，Core 判 `NoReply`，巡看丢掉。异常原文哪里都没留下：GA 的打印去了 /dev/null，runner 发给 Core 的错误事件只在 Core 内存里，界面的 toast 不落库；刷新用了多久也没人记。

## 要做到

1. **取令牌至少等 30 秒**（Core 刷新的 HTTP 超时是 20 秒，`core/src/chatgpt_siwc/mod.rs` 一带，再留余量）：改 `llmcore.py:638` 那一行（比如 `max(30, …)`，写成有名字的常量更好，但**不能改变 `llmcore.py` 的行数**：`managed-ga/patches/manifest.md` 写着 0007 的行数一变，0008、0021 的零上下文 hunk 要重导）。原地改 `managed-ga/patches/0007-managed-codex-backend.patch`，`managed-ga/patches/manifest.md` 里 0007 那一条补一句（为什么、票号），并更新「Last replay verified」。`managed-ga/code/` 的 payload 与补丁一致：用 `scripts/build-managed-ga.sh` 从干净的上游克隆重放全栈验证（scratchpad 里有票 118 留下的干净克隆 `t118-ga-upstream`，先确认它干净、在 manifest 记的上游提交上），逐字节对 payload。Windows 命名管道那一支不动。`runner/tests/test_managed_ga_llmcore.py` 加一条：Core 那头 12 秒才答（用替身或打桩，别真睡 12 秒）时照样拿到令牌。
2. **Core 收到 runner 的错误事件时打一行**：`severity = error` 的错误事件（runner 在 `_close_run_without_exit` 等处发的 `runtime` 类，`runner/workbench_bridge.py:1385-1429`），往标准错误打一行，带会话 id 与内容（单行化、截到合理长度）。它进 Core 的地方见 `core/src/runner_manager/manager.rs:1129-1133` 一带。
3. **巡看日志带上报错**：巡看因这一轮出错被丢时（`core/src/subtask_report.rs` 的 `drop_review_wake` 一带，日志 `prefs.assistant_review_log`，`core/src/scheduler.rs:161`），`dropped` 那条多一个字段放这条报错（截短）。新字段是加法；读这个 pref 的只有 `.scratch/assistant/closed-loop-snapshot.py`，确认它不受影响。拿不到报错时不写这个字段。
4. **凭据 IPC 记刷新**：Core 在请求路上刷新令牌时打一行耗时与结果（成功 / 暂时失败 / 被拒，不打令牌与任何凭据内容）；回写给 runner 失败时（runner 已放弃、对面已关，现在是 `credential_ipc/mod.rs:206` 的 `let _ =`），改为打一行「runner 已放弃，刷新用了 N 秒」一类的话。
5. **runner 转发两类 GA 打印**：runner 把 `sys.stdout` 换成 /dev/null（`runner/workbench_bridge.py` 的 `_silence_python_stdout`，fd 1 也 dup2 到 /dev/null 保护 IPC）。改成：`sys.stdout` 换成一个只认行首的写入器，以 `Backend Error` 或 `[LLM Retry]` 开头的行写到标准错误，其余照旧丢掉；fd 1 照旧接 /dev/null，子进程与 C 扩展照旧碰不到 IPC 管道。按行缓冲（GA 的 `print` 可能分段写）。这对外置运行时也生效：只给 GA 自己打印的字换个去处，不写 GA 的文件、不改 GA 的代码，合宪法第 1 条；别的打印（有的会带配置）照旧丢掉。
6. **不打敏感内容**：以上每一行都不能带令牌、密钥、Authorization 头；报错原文里如果可能带接口主机或 URL，照 runner 现有的脱敏做法处理（找找有没有现成的 scrub；没有就至少去掉 query 串与凭据样式的串），写清你怎么做的。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest          # 在 worktree 根目录借主树 venv，先打印 runner.__file__
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
git diff --check
```

- Core 只格式化自己动过的文件（`rustfmt --check` 逐文件），不要 `cargo fmt --all`。
- 凡是 import `managed-ga/code` 的探针用 `python -B`；`managed-ga/` 下不能留 `__pycache__`。
- 能写测试的都写：Core 打错误行、巡看日志带报错字段、凭据刷新耗时行与「runner 已放弃」行、runner 转发器只转那两类行且按行缓冲、fd 1 仍是 /dev/null。
- 文档：凡是描述这几处日志或 0007 取令牌超时的文档（grep `docs/`、`managed-ga/patches/manifest.md`、`.scratch/runtime-logging/`）照实更新；中文用全角标点。

## 环境与边界

- 只在主会话建好的 worktree 里做（见派单，已克隆 `core/target`、`core/python-bundle`、`core/gen`），绝不碰主工作树（JC 的 `tauri dev` 在主树）。不跑 `tauri dev`，不调真模型，不碰浏览器，不读写 `~/Library/Application Support/app.galley/` 下的任何东西。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。临时脚本放 scratchpad，用 `t122-` 前缀。
- 引用匹配行时用 `grep`，不要用 `rg`。本文件在开源仓库里：不写本机用户名路径、服务商接口主机、密钥。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 每一处改了哪些文件、哪几行、新增多少行；0007 的行数是否不变、重放验证的做法与结果。
2. 每类新日志行的原文样例（用假数据），以及脱敏怎么做的。
3. 测试与门禁的命令与结果行。
4. 文档改了哪些。
5. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。只在 worktree 分支 `t122-token-wait` 上改，没碰主工作树、没调模型、没开浏览器、没读写 `app.galley` 目录。代码、测试与文档在提交 `74de88e0`，行号按这个提交。）

### 1. 改了什么

**① 取令牌至少等 30 秒（内置补丁 0007）**

- `managed-ga/code/llmcore.py:627-628`、`:638`：`_galley_codex_access_token(sess)` 改成 `_galley_codex_access_token(sess, min_wait=30)`（有名字的值放在参数默认值上，不加行），文档串写明为什么；套接字超时由 `max(5, connect_timeout)` 改成 `max(min_wait, connect_timeout)`，订阅登录预设下是 30 秒。改了 3 行、没有增删行，**`llmcore.py` 仍是 1529 行**，0007 的 hunk 头一个都没动，`0008`、`0021`、`0030` 不用重导。Windows 命名管道那一支没动。
- `managed-ga/patches/0007-managed-codex-backend.patch`：同样 3 行原地改（补丁里第 14、15、25 行）。`managed-ga/manifest.json` 只列文件名，没改。
- 重放验证：先确认 `t118-ga-upstream` 干净（`git status --short` 无输出）、在 `a9a36b4b219593369de01c3e5973e56ac02e568b`。改动前先用 `scripts/build-managed-ga.sh` 从它重放已提交的 28 个补丁，worktree 的 `git status` 保持干净（补丁与 payload 本来一致）。改完补丁与 payload 后再重放一遍：28 个全部应用、`py_compile` 全过，重建的 `llmcore.py` 与手改的那份逐字节一致（`cmp` 无差异，sha256 都是 `ec476b1237fa…250e8d`），`managed-ga/code` 与 `state-seed` 别的文件无变化，`managed-ga/` 下没有 `__pycache__`。
- 测试 `runner/tests/test_managed_ga_llmcore.py`（+57/−6）：假套接字 `_FakeIpcSocket` 加 `answers_after`（不真睡：引擎设的超时短于它就像真套接字一样抛 `TimeoutError`，否则作答）；新增 `test_codex_backend_waits_for_a_token_core_refreshes_slowly`（预设 `timeout: 10`，Core 12 秒才答，照样拿到令牌，超时是 30）与 `test_codex_backend_token_wait_is_bounded`（31 秒才答时照旧失败，报错是 `Galley Codex credential refresh failed: timed out`）。把 payload 临时退回旧代码跑，前一条失败、后一条通过，再还原（逐字节核过）。

**② Core 收到 runner 的错误事件时打一行**

- `core/src/runner_manager/manager.rs`：`error_event_line`（`:1116-1137`，新增 22 行）与 `queue_bookkeeping` 里一行 `eprintln!`（`:1152`）；只打 `severity = error`，`warning` / `info` 不打。内容单行化、脱敏、截到 500 字符。测试 `an_error_event_is_logged_on_one_scrubbed_line`（`:1475-1518`）。

**③ 巡看日志带上报错**

- `core/src/subtask_report.rs`（+16/−4）：`record_wake_run_end` 在 `NoExit` / `RunnerExited` 时取 `runner.last_run_error(session_id)`（`:1797`），经 `return_due_tasks` 多出的 `error` 参数（`:1685`）传给 `drop_review_wake`（`:1738`），再交给 `log_review`；其余三处调用传 `None`。
- `core/src/scheduler.rs`（+26/−2）：`log_review` 加 `detail` 参数（`:647`），有报错时写 `detail` 字段（脱敏、单行、截到 300 字符，`REVIEW_LOG_DETAIL_MAX_CHARS`，`:166-167`、`:661-666`），拿不到或为空时不写。其余三处调用补一个 `None`。
- 读这个 pref 的只有 `.scratch/assistant/closed-loop-snapshot.py`：它只读每条的 `event` 和 `at`（`:175`），多一个字段不受影响。全仓 grep 过，GUI、CLI 都不读。
- 测试 `core/tests/schedule_wake_test.rs` 新增 `a_dropped_review_keeps_the_error_its_turn_ended_on`（`:1919-1978`）：这一轮 `DONE_WITHOUT_EXIT`、runner 报过错，`dropped` 条目带 `detail`（已脱敏、已单行）；runner 中途退出、没报错，条目没有 `detail`。

**④ 凭据 IPC 记刷新**

- `core/src/chatgpt_siwc/refresh.rs`（+42/−1）：`resolve_access_token_with_refresh` 在真正刷新的地方计时（`:71-77`），打一行耗时与结果（`refresh_log_line`，`:112-144`）：成功 / 暂时失败 / 被拒 / 被拒且要重新登录。只打凭据引用名、耗时、分类后的状态码或错误码、已脱敏的错误文字，不打令牌。测试 `a_refresh_is_logged_with_its_time_and_end_never_a_token`（`core/src/chatgpt_siwc/tests.rs:1330-1376`），断言四种行原文、且都不含测试里放的假凭据。
- `core/src/credential_ipc/mod.rs`（+39/−13）：读完请求后开始计时（`:361`）；回写失败（runner 已放弃、对面已关）不再吞掉，变成带耗时的错误（`runner_gave_up`，`:329-342`）；两处 `tokio::spawn` 里的 `let _ =`（`:206`、`:250`，Unix 与 Windows）改为 `serve_credential_ipc_stream`（`:312-327`），把连接上出的任何错打一行。回写合成一次写（正文加换行），字节不变。测试（`core/src/credential_ipc/tests.rs`，+48/−2）：`credential_ipc_reports_a_runner_that_stopped_waiting`（发完请求就挂断，拿到「the runner stopped waiting」错误）、`runner_gave_up_names_how_long_answering_took`（耗时格式）。

**⑤ runner 转发两类 GA 打印**

- 新文件 `runner/ga_print_forward.py`（147 行）：`GaPrintForwarder` 只认行首，以 `Backend Error` 或 `[LLM Retry]` 开头的行，等换行到了整行写到标准错误（脱敏、截到 1000 字符）；其余行一看行首不是就丢掉、不缓存（一行最多缓存 4000 字符）；`flush()` 不把半行送出；`fileno`、`encoding`、`buffer` 等都是原来那个 /dev/null 文件的，所以把 `sys.stdout` 交给子进程的代码拿到的仍是 /dev/null。标准错误已关时静默。
- `runner/workbench_bridge.py`（+10/−3）：`_silence_python_stdout`（`:76-95`）照旧先 `dup2` /dev/null 到 fd 1，再把 `sys.stdout` 换成转发器；模块头注释同步。外置运行时同样生效：只换 GA 自己打印的去处，不写 GA 的文件、不改 GA 的代码。
- 测试新文件 `runner/tests/test_ga_print_forward.py`（194 行）：只转两类行、行首以外不算；分段写入按行缓冲；不转的长行不缓存；超长截断；转发的行已脱敏；其余属性是 /dev/null 的；标准错误关了不报错；脱敏规则逐条；以及一个真进程用例：`_silence_python_stdout` 之后 fd 1 和 `sys.stdout.fileno()` 都是 /dev/null，直接写 fd 1、子进程 `stdout=sys.stdout` 的输出都到不了 IPC，IPC 那头只有干净的一行，标准错误恰好是那两类行。

**⑥ 脱敏**

- 仓里没有现成的通用 scrub：IM 渠道的 `_SecretRedactor`（runner）与 `redact_credentials`（Core）只认已知的凭据原值；评测脚本的 `scrub` 是为提交文件换主机名。所以新写了一套按形状的规则，Core 一份（新文件 `core/src/log_excerpt.rs`，164 行，含测试；`lib.rs` 加一行 `mod log_excerpt;`），runner 一份（`ga_print_forward.scrub_log_text`），规则相同、两边测试用例相同：
  - URL 的 query 串（`?a=b&…`，含裸路径后的）换成 `?[redacted]`；URL 里的 `user:password@` 换成 `[redacted]@`；
  - `Bearer` / `Basic` 后面的值；键名像凭据的 `key=value` / `"key": "value"`（`api_key`、`x-api-key`、`access_token`、`refresh_token`、`id_token`、`client_secret`、`secret`、`password`、`passwd`、`token`）的值；
  - `sk-` 开头的 key、JWT（`eyJ….….…`）、Google API key（`AIza…`），以及 40 字符以上、字母数字混排的串，整段换成 `[redacted]`。
  - 主机名与路径保留（说明哪一端出错；这些行只在本机）。Core 这边脱敏之后再单行化、截断（错误行 500、巡看 `detail` 300、刷新细节 300 字符）。

新增合计（`git diff --numstat` 加新文件）：Core 约 510 行，其中测试约 280 行；runner 约 410 行，其中测试约 250 行；补丁与 payload 各改 3 行。

### 2. 日志行原文样例（假数据）

```text
[runner error s-main] runtime/task_end: RuntimeError: Galley Codex credential refresh failed: timed out
[runner stderr s-main] Backend Error: RuntimeError: Galley Codex credential refresh failed: timed out @ llmcore.py:657, _galley_codex_access_token -> `raise RuntimeError(f"Galley Codex credential refresh failed: {e}") from e`
[runner stderr s-main] [LLM Retry] HTTP 503, retry in 3.0s (1/4)
[runner stderr s-main] [LLM Retry] ConnectionError, retry in 6.0s (2/4)
[chatgpt-siwc] managed-provider:mp_chatgpt_codex: refreshed the access token in 11.2s
[chatgpt-siwc] managed-provider:mp_chatgpt_codex: refreshing the access token failed for now after 20.0s: token request failed: error sending request for url (https://auth.example/oauth/token?[redacted])
[chatgpt-siwc] managed-provider:mp_chatgpt_codex: refreshing the access token was rejected after 0.8s: HTTP 400 invalid_request
[chatgpt-siwc] managed-provider:mp_chatgpt_codex: refreshing the access token was rejected after 0.8s, sign in again: refresh_token_invalidated
[credential-ipc] runner_error: the runner stopped waiting: answering took 31.2s and the answer could not be written back (Broken pipe (os error 32))
```

巡看日志（`prefs.assistant_review_log`）里的 `dropped` 条目：

```json
{"event": "dropped", "taskId": "sched_example", "firedAt": "2026-11-02T05:34:10Z", "dueAt": "2026-11-02T00:51:00Z", "at": "2026-11-02T05:34:22Z", "reason": "no_reply", "detail": "RuntimeError: Galley Codex credential refresh failed: timed out"}
```

（`[runner stderr …]` 前缀是 Core 原有的转发前缀；转发器自己只写 `Backend Error …` / `[LLM Retry] …` 本身。）

### 3. 测试与门禁

```text
cargo test --manifest-path core/Cargo.toml --workspace     → exit 0：47 组 test result 全是 ok，合计 1290 passed、0 failed
.venv/bin/python -m pytest（worktree 根，runner.__file__ 指向 worktree）→ 655 passed, 6 deselected
.venv/bin/python -m mypy runner                             → Success: no issues found in 36 source files
.venv/bin/ruff check runner                                 → All checks passed!
node scripts/check-managed-ga-payload.mjs                   → [managed-ga-payload] OK
node scripts/check-ga-baseline-drift.mjs                    → [ga-baseline-drift] OK (a9a36b4b)
node scripts/check-docs-links.mjs                           → docs link gate OK: 487 files checked.
node scripts/check-ipc-protocol-drift.mjs                   → aligned（15 events, 8 commands）
node scripts/check-supervisor-sop-drift.mjs                 → 4 reference copies verbatim
node scripts/check-version-consistency.mjs                  → 5 files agree on 0.7.4
git diff --check                                            → 无输出
```

- Core 只格式化自己动过的：`rustfmt --check` 逐文件看，`manager.rs`、`subtask_report.rs`、`credential_ipc/*`、`chatgpt_siwc/tests.rs`、`schedule_wake_test.rs` 干净；新文件 `log_excerpt.rs` 整篇格式化；`refresh.rs` 只改了自己那一处；`scheduler.rs`（`:909`、`:1263` 一带）与 `lib.rs`（模块排序）剩下的差异都是原有的，没动。
- runner 新文件没有跑 `ruff format`：仓里多数文件不是 format 干净的（27 个会被重排），新文件照仓里习惯写。
- 全角标点：自写脚本扫了 `docs/`、`.scratch/` 新增的中文行，只命中一处 Markdown 链接的右括号，不是问题。

### 4. 文档

- `managed-ga/patches/manifest.md`：「Last replay verified」换成这次（原来那段降为「Previous replay」）；0007 那一行补一句取令牌至少等 30 秒、为什么、票号、行数不变。
- `docs/managed-ga-runtime/model-configuration.md`：订阅登录一节写明取令牌等多久、为什么，Core 的刷新行与「runner 已放弃」行。
- `docs/managed-ga-runtime/runtime-modes-and-sessions.md`：巡看日志的 `dropped` 条目多 `detail`。
- `docs/ipc-protocol.md`：stderr 一条写明转发的两类 GA 行；`error` 事件一节写明 Core 打的那一行。
- `.scratch/runtime-logging/issues/01-file-logging-infrastructure.md`：追加 11-02 一条，记下这几行新日志与脱敏做法。

### 5. Open risks（看到但没改的）

- 取令牌最多等 30 秒：刷新慢时第一步多等十几秒；这时按停止，GA 线程要等这次取令牌返回才放手，下一句最多排后 30 秒（票 120 已写）。
- Core 的刷新 HTTP 超时是 20 秒，但两个请求同时排在刷新闸门上、第一次刷新又暂时失败时，第二个请求会再刷一次，最坏约 40 秒，仍会超过 30 秒。罕见，没处理。
- 转发的两类行也进了 Core 那 8 行标准错误尾巴，runner 异常退出时的 toast 可能显示 `[LLM Retry]` 一类的行（以前只有 runner 自己的行）。界面上的小变化，没改 GUI。
- GA 的 `print` 分两次写（正文、换行），多线程同时打印时别的线程的字可能插进来，被转发的行可能拼上别的字或被拆开。罕见，只影响这几行日志的样子。
- 多行的 `Backend Error`（异常信息里带换行）只转第一行；完整内容仍在错误事件的 `traceback` 里。
- 打包版 Core 的标准错误不落盘：错误事件行、刷新行、「runner 已放弃」行、转发的 GA 行都只在 dev 里看得到；打包版只留巡看日志里的 `detail`。
- 脱敏按形状来：不带前缀、不到 40 字符、也不以 `key=value` 出现的凭据会漏过；主机名与路径保留；报错原文里引到的用户文件路径或模型回复片段没有处理。
- 刷新行在设置页的连接测试、模型列表触发的刷新上也会打，不只请求路上。
- Windows 那一处 `serve_credential_ipc_stream`（`credential_ipc/mod.rs:250`）在 `cfg(windows)` 下，本机编不到，要靠 CI 的 Windows job。
- 巡看日志的 `detail` 只在 `no_reply` 时写；`not_started`（runner 起不来、派发失败）那条 `keep_for_later` 手里有原因文字（`why`），没写进去；提醒到点失败也没把报错带进它那行日志（前面那条 `[runner error …]` 已经打了）。
- `detail` 取的是这一轮最近一条 `severity = error` 的错误事件：runner 中途退出前若有过一条不相干的 error，会被当成这一轮的报错。
- 转发器按 GA 现在的前缀文字认行（`Backend Error`、`[LLM Retry]`）；上游改了措辞就认不出，要跟着改。
