# 118 工具参数吐空白时截断：内置 GA 收参数时加一道闸

Status: ready-for-agent（2026-11-02 开票）

来源：[主对话 PRD](../PRD.md) 裁决 162；诊断见票 [116](./116-subtask-fifteen-minute-stall.md)。只改内置 GA（`managed-ga/` 的补丁栈与 payload）和 runner 的测试；不动 Core、GUI、CLI、Agent API、迁移。外置运行时零变化（外置 GA 不打补丁，宪法第 1 条）。

## 为什么

10-21 一件子任务的第 2 步，模型在 `web_execute_js` 的参数里先写出正常的开头，接着吐了 40 万个空白字符（38 万个制表符、2.2 万个换行），吐了 15 分 03 秒才结束。没有哪一层拦住它：订阅登录这条路线发不了输出上限（`managed-ga/code/llmcore.py:731`）；读超时只管两段数据之间的空档；GA 收函数参数只往缓冲里累加、不往外吐（`llmcore.py:356-361`），界面一直停在那句 summary 上。参数解析失败后落成 `{"_raw": …}`（`llmcore.py:306-319`），工具报「Script missing」，模型下一步重发才恢复；这 40 万字符还进了历史，后两步多背约 92 万输入 token。10-01 起 1,296 次请求里只有这 1 次，但主对话走同一条路线，撞上时主对话卡 15 分钟。详细证据链见票 116 的报告。

## 要做到

1. **判据**：函数参数的缓冲里，一连出现 2,000 个空白字符（空格、制表符、`\n`、`\r`）就算失控。理由：JSON 字符串里的换行和制表符必须转义，真空白只能出现在记号之间，正常参数不会连着出现几千个。阈值写成一个有名字的常量，注释写明这个理由和票号。
2. **两条收参数的分支都要拦**：Responses 流的 `response.function_call_arguments.delta`（`llmcore.py:356-358` 一带）和 chat completions 流的 `tc_buf[idx]["args"] += …`（`llmcore.py:429` 一带）。每次追加后只看缓冲末尾那一段（别每次扫全缓冲）。也核一下别的会话类（`llmcore.py` 里其他流式解析，比如另一种协议的会话）有没有同样的累加，一并拦住或在报告里写明为什么不用。
3. **触发后**：停止读流、关掉连接（不要让 `_stream_with_retry` 当成网络错误去重试，那会再发一次请求），把这次的参数截短（保留开头约 800 字符，去掉末尾空白），让这一步照现在的路走完：参数照旧解析失败、工具报参数缺失、模型下一步重发。要让模型看得出是参数失控被截断（比如沿用上游现有的截断标记写法，`llmcore.py:372-380` 一带），措辞与位置由你按上游现有做法定，写进报告。历史里不能留下那几十万字符。
4. **用量**：触发时这次请求多半拿不到带用量的结束事件。不要为此伪造用量；照实，报告里写明计数会少一次（同票 116 第 5 条）。
5. **补丁栈**：照 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的规则做成一个新补丁（编号接 `0029` 之后），`managed-ga/manifest.json`、`managed-ga/patches/manifest.md` 照现有条目的写法登记；`managed-ga/code/` 里的 payload 与补丁一致（用 `scripts/build-managed-ga.sh` 从干净的上游克隆重放验证，或照 manifest.md 里记的验证做法）。补丁要最小、隔离，能在上游上重放；上游以后有同样的保护就删掉它。
6. **测试**：`runner/tests/test_managed_ga_llmcore.py` 加用例，喂假流：①参数正常，含转义的 `\n`、`\t` 与少量记号间空白，不触发；②参数开头正常、后面一连几千个空白，触发：读流在阈值附近停下（断言没把假流读完）、参数被截短、不重试、历史里没有那一大段；Responses 与 chat completions 两条分支各一条。

## 验证

```bash
.venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-managed-ga-payload.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv：在 worktree 根目录用 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。凡是 import `managed-ga/code` 的探针都用 `python -B`（否则留下 `__pycache__`，payload 检查会报 generated artifact）。payload / 基线相关的其他检查脚本（`scripts/` 下 `check-*`）按 manifest.md 记的验证步骤跑。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 在主树）。不跑 `tauri dev`，不调真模型，不碰浏览器。
- 不动：Core、GUI、CLI、Agent API、迁移、`managed-ga/state-seed/`、用户状态（内置状态根下的任何文件）、外置 GA。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。临时脚本放 scratchpad，用 `t118-` 前缀。
- 引用匹配行时用 `grep`，不要用 `rg`。中文（报告）用全角标点。本文件在开源仓库里：不写本机用户名路径、服务商接口主机、密钥。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 补丁文件名、改了哪几处（`file:line`）、新增多少行；阈值、截短长度与理由。
2. 触发后模型看到的是什么（原文），历史里留下什么。
3. 有没有别的流式分支要拦，处理方式。
4. 测试与门禁的输出（命令 + 结果行）。
5. 补丁重放验证的做法与结果。
6. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。只改内置 GA 的补丁栈与 payload、runner 的测试；没碰 Core、GUI、CLI、Agent API、迁移、`state-seed`、状态根，没调真模型，没开浏览器。外置零变化。行号按补丁后的 `managed-ga/code/llmcore.py`。）

### 1. 补丁与改动

补丁 `managed-ga/patches/0030-managed-tool-args-whitespace-runaway.patch`，只动 `llmcore.py`：新增 27 行（含 1 个空行），改写 1 行，文件从 1,503 行变成 1,529 行。已登记进 `managed-ga/manifest.json` 与 `managed-ga/patches/manifest.md`（表格加一行，「Last replay verified」更新）。

- `llmcore.py:209-226`：说明注释、常量与判定函数 `_galley_args_cut`。`_GALLEY_ARGS_WS_RUN = 2000`：缓冲末尾 2,000 个字符全是 JSON 空白（空格、制表符、`\n`、`\r`）就算失控。只看末尾：最后一个字符不是空白就直接放行，是才切末尾 2,000 个字符看有没有非空白。理由照票面：JSON 字符串里的换行、制表符必须转义，这么长一串只能落在记号之间，正常参数用不到。`_GALLEY_ARGS_KEEP = 800`：截短后最多留开头 800 个字符，再去掉末尾空白。800 取的是 GA 自己压缩旧工具参数的长度（`compress_history_tags` 的 `max_len=800`，`llmcore.py:77`）；10-21 那次的开头（157 个字符加一段乱码）整段留得下。
- `llmcore.py:380-381`：Responses 流，`response.function_call_arguments.delta` 追加之后检查。订阅登录走这条，`_chatgpt_plan_parse_sse` 套在它外面。
- `llmcore.py:428`、`455-456`：chat completions 流，`tool_calls[].function.arguments` 追加之后检查。判定在内层循环里，要跳出外层读流循环，所以加了一个 `ws_cut` 变量。
- `llmcore.py:278-280`：Anthropic 流，`input_json_delta` 追加之后检查（见第 3 节）。

三条分支触发后做的事一样：截短参数，在回复正文里加一行标记，`break` 跳出读流循环。解析函数正常返回，`_stream_with_retry` 随之退出 `with requests.post(...)`，`requests` 关掉没读完的响应和连接。返回值里有工具调用，不是空响应，所以不进重试，不会再发一次请求。之后照原路走：参数照旧解析，10-21 那种解析失败的落成 `{"_raw": …}`（`llmcore.py:340`），工具报缺参数，模型下一步重发。按 10-21 每秒约 450 个字符的速度，失控开始后约 4–5 秒截住。

### 2. 模型看到什么，历史里留下什么

标记原文（三条分支同一句，沿用上游 `response.incomplete` 的写法 `[!!! output truncated: {reason}]`，`llmcore.py:402`）：

```text
[!!! output truncated: tool call arguments ran into 2000 whitespace characters in a row and were cut to at most 800 characters]
```

位置：Responses 与 chat completions 接在这一步已经流出的正文后面，正文不空时前面空一行（`\n\n`）；Anthropic 走上游自己的 `warn` 位置，作为工具调用前单独一个 text 块，前面固定 `\n\n`（`llmcore.py:321-324`）。它会像上游别的截断标记一样流到界面，出现在这一步的文字里。标记里没有 `!!!Error:`、`[Error:`、`流异常中断`、`max_tokens !!!]`，所以 `MixinSession` 不会把它当失败去换线路（`llmcore.py:1422`、`1438`），`do_no_tool` 的重来判据也碰不到（`ga.py:500`、`505`；何况这一步有工具调用，不走 `do_no_tool`）。

以 10-21 那次为例，下一次请求里模型看到：

- 自己上一步的正文：`<summary>开始查 NBA ……</summary>`，空一行，接上面那句标记；
- 自己上一步的调用：`web_execute_js`，参数 `{"_raw": "{\"script\":\"{\\\"cmd\\\":\\\"tabs\\\",…,\\\"active\\\":true}蛋蛋 switching?}(\""}`（开头整段，不到 800 个字符；下一次请求时由 `llmcore.py:836` 序列化）；
- 工具结果：`[Error] Script missing. Use ```javascript block or 'script' arg.`（`ga.py:379`，与 10-21 相同）。

历史里留下的就是这三样：assistant 消息是一个「正文 + 标记」的 text 块，加一个 `_raw` 不超过 800 个字符的 tool_use 块，没有那几十万字符。引擎日志的 Response 条目记的是 `resp.raw`（`llmcore.py:1510`），也是截短后的内容。测试里整段历史（用户一句加这一步）JSON 后不到 2,000 个字符；本地探针里是 474 个字符。

用量：截断的请求读不到带用量的结束事件（Responses 的 `response.completed`、chat completions 末尾的 usage、Anthropic 的 `message_delta`）。补丁不补、不估，`cost_tracker` 的请求数照实少记一次，与 10-21 相同（票 116 第 5 条）。Anthropic 流在 `message_start` 已记的输入侧照常记。

### 3. 别的流式分支

`llmcore.py` 里累加函数参数的流式解析一共三处，都拦了：票面点名的 Responses 与 chat completions 两条，加上 Anthropic 协议的 `_parse_claude_sse`（`ClaudeSession`、`NativeClaudeSession` 用；`MixinSession` 只是转给它们）。Anthropic 这条 GA 默认带 8,192 的输出上限（`llmcore.py:965`、`1034`），吐不了 15 分钟，但 8,192 个 token 的空白也要吐上一阵，而且全进历史；同一个判定函数，多一行，所以一并拦了。`_chatgpt_plan_parse_sse` 套在 Responses 分支外，自动覆盖。非流式的 `_parse_openai_json`、`_parse_claude_json` 不拦：整个响应一次到手，没有可以提前停的地方，等待由非流式读超时（默认 240 秒，`llmcore.py:894`）兜着；订阅登录路线强制流式（`llmcore.py:893`）。

### 4. 测试与门禁

`runner/tests/test_managed_ga_llmcore.py` 新增 7 条（59 条变 66 条）：

- `test_whitespace_runaway_threshold_is_a_run_at_the_tail`：1,999 个不触发，2,000 个触发；中间夹一个记号的不算；全角空格不算 JSON 空白；开头超过 800 个字符的截到 800；截完去掉末尾空白。
- `test_normal_tool_arguments_are_untouched[responses|chat_completions|claude]`：缩进排版的合法参数（字符串里有转义的 `\n`、`\t`，记号之间有换行和空格，总长超过 2,000），每 7 个字符一段流进来：假流读完，参数原样解析，正文里没有标记。
- `test_whitespace_runaway_cut_on_the_plan_backend_responses_stream`：订阅登录的 Responses 会话（`NativeOAISession`，`codex_backend`），10-21 的开头，后面 2,000 段「换行 + 17 个制表符」（36,000 个空白）：读到第 3 + 112 行停下（空白刚满 2,000），停下当时就退出了 `with`，后面的行没读；只发了 1 次 POST；参数是 `{"_raw": 开头}`；正文流里是 summary 和标记；历史末条正好是「正文 + 标记」和 `_raw` 工具调用，整段历史不到 2,000 个字符；`_record_usage` 一次也没调。
- `test_whitespace_runaway_cut_on_a_chat_completions_stream`：chat completions 会话，开头 1,511 个字符：同上，参数截成开头 800 个字符。
- `test_whitespace_runaway_cut_on_a_claude_stream`：Anthropic 解析器：读到第 6 + 112 行停下，标记作为 text 块排在工具调用前面。

红绿核对：把 payload 换回补丁前的 `llmcore.py`（只补上测试要读的常量与判定函数）跑新用例，三条截断用例全部失败，四条不触发与阈值用例通过；换回补丁后全过。

本地探针（scratchpad，不入库）：系统 Python 3.14 加真 `requests` 2.33.1、`urllib3` 2.6.3，`python3 -B -I`，本机起一个假 SSE 服务，照 10-21 的样子不停地吐（上限 200 万段）。客户端 0.018 秒返回；服务端只收到 1 次 POST，写到第 132 段就收到断连（客户端读了 112 段，其余在套接字缓冲里），比客户端返回晚 1 毫秒；参数是 `{"_raw": 开头}`，历史 474 个字符。也就是说，真 `requests` 下退出 `with` 确实关掉了连接，没有放回连接池接着读。

门禁（worktree 根目录，借主树 venv；`runner.__file__` 已核，指向 worktree）：

```text
$ .venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py
============================== 66 passed in 0.27s ==============================
$ .venv/bin/python -m pytest
====================== 635 passed, 6 deselected in 9.00s =======================
$ .venv/bin/python -m mypy runner
Success: no issues found in 34 source files
$ .venv/bin/ruff check runner
All checks passed!
$ node scripts/check-managed-ga-payload.mjs
[managed-ga-payload] OK
$ node scripts/check-ga-baseline-drift.mjs
[ga-baseline-drift] OK (a9a36b4b)
$ node scripts/check-docs-links.mjs
docs link gate OK: 487 files checked.
$ git diff --check
（无输出）
```

`managed-ga/` 下没有 `__pycache__`。

### 5. 重放验证

照 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Add A Patch」做：在 scratchpad 新克隆上游 `lsdefine/GenericAgent`，检出 `a9a36b4b219593369de01c3e5973e56ac02e568b`，工作区干净。先用 `scripts/build-managed-ga.sh <克隆>` 重放现有 27 个补丁，`git status` 干净，说明改之前 payload 与补丁栈一致。然后改 `llmcore.py`，用 `git diff -U0 --relative=managed-ga/code` 导出零上下文补丁（去掉 `index` 行，与其他补丁同格式），登记两份清单，再用同一个干净克隆重放全部 28 个：`0030` 应用成功，`py_compile` 全过，重建出的 `llmcore.py` 与手改的那份逐字节相同（sha256 一致），`managed-ga/code` 与 `state-seed` 的其他文件没变；`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 通过。`0030` 在栈顶，前面的补丁都没动。

### 6. 看到但没改的（Open risks）

1. 判据照票面把空格也算进去：一个字符串值里真有连着 2,000 个空格（这是合法 JSON）会被误截，截到 800 个字符多半解析失败，工具报缺参数，模型重发。没见过这样的参数。
2. 参数本身完整合法、之后才吐空白的：截完不超过 800 个字符的照常解析，工具照跑（标记照样加上）；超过 800 个字符的会被截成不合法，多一步重发，长的 `file_write` 一类要整段重写。照票面「保留开头约 800 字符」做，没加「合法就整段留」的分支。
3. 只拦函数参数。正文里吐空白或重复文字、写在正文里的文本协议工具调用、思考通道里失控，都不拦（正文至少会流到界面上，看得见）；兜这些要裁决 162 没选的乙（单次请求总时长上限）。
4. 非流式解析不拦（见第 3 节）。
5. 标记是英文，会出现在这一步的正文里，界面与 IM 渠道上都看得到这一行，和上游别的截断标记一样，没做中文化或隐藏。
6. 用量照实少记一次；服务端在断连前已经生成的那部分（开头加约 2,000 个空白）多半也计了费，Galley 的计数里没有。关掉连接后服务端是不是立刻停止生成，本机看不到。
7. 没在真 GA 进程或 tauri dev 里端到端跑（不调真模型）。停读、断连、只发一次请求由单测与本地探针验证；模型看到标记和「Script missing」后会重发，是按代码与 10-21 日志（第 31–33 行）推的。
8. 零上下文补丁按行号定位：以后 `0001`、`0002`、`0007`、`0008`、`0016`、`0017`、`0021`、`0027` 改了 `llmcore.py` 的行数，要重导 `0030`（已写进 manifest.md 的 Rebase risk）。

交接：`docs/project-status.md` 的未发版范围没动，留给主会话合入时写；票头 Status 也没改。
