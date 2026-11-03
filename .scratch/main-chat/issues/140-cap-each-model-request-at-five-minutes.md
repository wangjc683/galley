# 140 每次模型请求总时长封顶 5 分钟

Status: needs-dogfood（2026-11-03 快进合入 `bb9a9e3c`…`fabc3761`，补丁 0031。主会话验收：读过 `llmcore.py` 新增的 37 行（截止时刻每次请求一份、每读一行看一次钟、过点交 `message_stop` 收尾、截短后不重试）；代理验证 llmcore 测试 80 条、runner 706 条，补丁栈从干净上游重放 29 个逐字节一致，`managed-ga/` 下没有 `__pycache__`。没有真模型端到端，新起的 runner 才带上补丁；等下一次真的退化才看得到）

来源：[主对话 PRD](../PRD.md) 裁决 188（裁决 162 当时没选的乙）。只改内置运行时的 GA（补丁栈加一个补丁）；外置零变化（宪法第 1 条：外置 GA 不打补丁）。

## 为什么

- 两次模型退化，各卡了 15 分钟：
  - 10-21 子任务第 2 步，`web_execute_js` 的参数里吐了 40 万个空白，903 秒（票 116）。票 118（补丁 `0030-managed-tool-args-whitespace-runaway.patch`）加了一道闸：参数里一连 2,000 个空白就截断。
  - 11-03 子任务第 2 步，同一个工具的参数里吐了约 82KB 循环乱码（「}u}g}6}#}t}e}…」，不是空白），901 秒。0030 的闸没拦住。
  - 两次都停在约 900 秒，像是服务端自己的 15 分钟上限；订阅登录这条路线发不了输出上限，读超时只管两段数据之间的空档。
- 底数（内置状态根引擎日志，每对 Prompt / Response 的时间戳）：1,433 次请求，中位 9 秒、p90 18 秒、p99 73 秒，正常请求最长 178 秒；超过 180 秒的只有这两次退化。
- 按裁决 186，主对话要重新自己上网；插话改道（票 136）只能在两步之间把用户的话送进去。一次请求卡 15 分钟，主对话就卡 15 分钟、插话晚 15 分钟。

## 要做到

1. **上限**：每次模型请求从发出到读完，总时长 300 秒。写成一个有名字的常量，注释写明理由（上面的底数、票号、裁决 188）。
2. **所有流式分支都要管**：0030 拦的那几条（Responses 流、chat completions 流、Anthropic 流，`managed-ga/code/llmcore.py` 里 `_parse_claude_sse`、`_parse_openai_sse` 一带）；也核一下别的会话类与非流式路径，一并管住或在报告里写明为什么不用。最好在一个地方管（比如读流的那层），不要每个解析器各写一份；怎么放由你定，写理由。
3. **到点之后**：照 0030 截断的路走：停止读流、关掉连接，不让 `_stream_with_retry` 当成网络错误重试（那会再发一次请求、再等 5 分钟），这一步照常走完。回复或参数截短；要让模型下一步看得出这次回复因为太久被截断，从而重发或换个做法。措辞与位置沿用 0030 与上游现有的截断写法，写进报告。历史里不能留下那几十 KB 的乱码。
4. **用量**：到点时多半拿不到带用量的结束事件，不伪造，照实，报告里写明计数会少一次（同票 116 第 5 条）。
5. **和 0030 的关系**：0030 照留（它在几秒内就触发，不用等 5 分钟）。两者同时命中时行为要确定、不重复截断。
6. **补丁栈**：照 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的规则做成一个新补丁，编号接 `0030` 之后；`managed-ga/manifest.json`、`managed-ga/patches/manifest.md` 照现有条目登记；`managed-ga/code/` 里的 payload 与补丁一致，按 manifest.md 记的做法重放验证。补丁要最小、隔离，能在上游上重放；上游以后有了同样的保护就删掉它。先查上游 GA 现在有没有总时长上限（读 `llmcore.py` 与上游提交记录），有就用上游的，不打补丁。
7. **测试**：`runner/tests/test_managed_ga_llmcore.py` 加用例，喂假流、用可注入的时钟或把上限在测试里调小：①正常的流在上限内读完，不触发；②一直不停吐字的流到上限就停下（断言没把假流读完）、不重试、回复或参数被截短、历史里没有那一大段；各条流式分支各一条；③与 0030 同时命中的一条。不要真的等 300 秒。

## 验证

```bash
.venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv：在 worktree 根目录用 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。凡是 import `managed-ga/code` 的探针都用 `python -B`（否则留下 `__pycache__`，payload 检查会报 generated artifact）。其他 payload / 基线检查按 manifest.md 记的验证步骤跑。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 在主树）。不跑 `tauri dev`，不调真模型，不碰浏览器。
  ```bash
  cd <主树>
  git worktree add -b t140-cap-request-time <scratchpad>/wt-140 main
  ```
- 不动：Core、GUI、CLI、Agent API、迁移、`managed-ga/state-seed/`、用户状态（内置状态根下的任何文件）、外置 GA。
- 同时在跑：票 136（插话改道，改 runner 的消息路径、Core、GUI）。它可能碰 `runner/` 里别的文件，不碰 `managed-ga/`；你只改 `managed-ga/` 与它的测试。碰了同一个文件在报告里写明。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。临时脚本放 scratchpad，用 `t140-` 前缀。
- 引用匹配行时用 `grep`，不要用 `rg`。中文（报告）用全角标点。本文件在开源仓库里：不写本机用户名路径、服务商接口主机、密钥；引擎日志里的页面内容不抄进票面。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 补丁文件名、改了哪几处（`file:line`）、新增多少行；上限放在哪一层、为什么。
2. 到点后模型看到的是什么（原文），历史里留下什么。
3. 各条分支与非流式路径的处理。
4. 测试与门禁的输出（命令 + 结果行）。
5. 补丁重放验证的做法与结果；上游有没有同样的保护。
6. 提交号（照抄 `git log --oneline -1`）。
7. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-03，执行代理。只改内置 GA 的补丁栈与 payload、runner 的测试；没碰 Core、GUI、CLI、Agent API、迁移、`state-seed`、状态根，没调真模型，没开浏览器。外置零变化。行号按补丁后的 `managed-ga/code/llmcore.py`。分支已 rebase 到 main `725704c1`（票 136 合入之后），门禁在 rebase 后重跑。）

### 1. 补丁与改动

补丁 `managed-ga/patches/0031-managed-request-deadline.patch`，只动 `llmcore.py`：新增 37 行（含 1 个空行），上游的行一行没改，文件从 1,402 行变成 1,439 行。已登记进 `managed-ga/manifest.json` 与 `managed-ga/patches/manifest.md`（表格加一行；「Last replay verified」换成这次，原来那段改成「Previous replay」）。

- `llmcore.py:554-587`：说明注释、三个常量与 `_galley_deadline_cut`。`_GALLEY_REQUEST_MAX_SEC = 300`，注释写了底数（1,433 次请求的中位、p90、p99、正常最长 178 秒）、两次退化、票 116 / 140、裁决 188。
- `llmcore.py:607`：每次尝试发请求前记下这次的截止时刻（`time.monotonic()`，不受系统改钟影响）和一个 `cut` 标记。
- `llmcore.py:634`：在 `_stream_with_retry` 现成的读行探针（上游用来记首字时间的 `iter_lines` 包装）里，每读到一行先看钟；过了截止时刻就丢掉这一行，交给解析器一行 `data: {"type": "message_stop"}`，不再读。
- `llmcore.py:646`：解析器收尾返回后，`cut` 为真就把它的块交给 `_galley_deadline_cut` 截短、流出标记、直接返回；不走「空响应」那条 `ConnectionError`，不重试。返回即退出 `with requests.post`，没读完的响应和连接随之关掉（同 0030）。

上限放在读行这一层，理由：

1. 只有这一层看得到每一行。三个解析器收工具参数时只往缓冲里累加、不往外吐（两次退化都卡在这里），`_stream_with_retry` 取块的循环这时一个字也收不到，在那里看钟拦不住。读行这层对所有流式解析一视同仁：Anthropic 的 `_parse_claude_sse`，`_parse_openai_sse` 的 Responses 与 chat completions 两条，套在 Responses 外面的订阅登录解析 `_chatgpt_plan_parse_sse`，连同 legacy 的 `ClaudeSession` / `LLMSession`（也走 `_stream_with_retry`）。
2. 一处改，解析器一行不动。停读的办法是让流「正常结束」：每个解析器照自己的收尾把已经读到的东西组成块（没收完的工具参数照旧落成 `{"_raw": …}`），再由一个函数统一截短、加标记；不像 0030 那样每个解析器各写一份。
3. 交给解析器的那行 `message_stop`：不给它，`_parse_claude_sse` 见流没收到 `message_stop` 就自己加一句 `[!!! 流异常中断，未收到完整响应 !!!]`（`llmcore.py:313`），界面上会出现两句标记（测试里试过，见第 4 节）。两条 OpenAI 分支与订阅登录解析都不认这个事件类型，直接跳过。

### 2. 模型看到什么，历史里留下什么

标记原文（`_GALLEY_DEADLINE_MARKER`，47 个字符）：

```text
[!!! 流异常中断，请求超过 300 秒被截断，正文与工具参数只留前 800 字符 !!!]
```

写法：用上游「流中断」这一类（`llmcore.py:313` 的 `[!!! 流异常中断，未收到完整响应 !!!]`，`_stream_with_retry` 流到一半出异常时的 `[!!! 流异常中断 {异常}: … !!!]`），没用 0030 的 `[!!! output truncated: …]`。理由：0030 只截参数，截完这一步一定有工具调用，走不到 `do_no_tool`；这里正文、思考也可能失控，截完可能没有工具调用。没有工具调用的回复进 `do_no_tool`，`ga.py:502` 认 `'[!!! 流异常中断' in content[-100:]`，回 `[ERROR] Incomplete response. Regenerate and tooluse.` 让模型重来；`output truncated` 它不认，会把截断的半截当成最终回答，这一轮就此结束（上游自己的 `response.incomplete` 标记在同样情形下就是这样）。用这一类写法，不用给 `ga.py` 打补丁。标记控制在 100 个字符以内，正是为了落进这个判据。

位置：接在第一个工具调用之前的最后一个正文块后面，正文不空时前面空一行（`\n\n`）；那里没有正文块，就在那个位置单独插一个正文块（上游 Anthropic 的警告位）。界面上它跟在已经流出的内容后面（思考的 `</thinking>` 之后）。

截短：正文块、没有签名的思考块、没解析成功的工具参数（`{"_raw": …}`），各留前 800 个字符（沿用 0030 的 `_GALLEY_ARGS_KEEP`，即 `compress_history_tags` 的 `max_len=800`），参数再去掉末尾的 JSON 空白。有签名的思考块（Anthropic 收完整的思考，签名覆盖全文，改了下一次请求会被拒）和已经解析成功的参数整段留着。

以 11-03 那次为例（订阅登录、Responses），下一次请求里模型看到：

- 自己上一步的正文：`<summary>…</summary>`，空一行，接上面那句标记；
- 自己上一步的调用：`web_execute_js`，参数 `{"_raw": "<开头加乱码，共 800 个字符>"}`；
- 工具结果：`[Error] Script missing. Use ```javascript block or 'script' arg.`（`ga.py:379`，同 0030 与 10-21），模型重发。

历史里留下的就是这三样，没有那几十 KB 乱码；引擎日志的 Response 条目记的是截短后的块（`resp.raw`）。测试里整段历史 JSON 后不到 2,000 个字符，本地探针里是 1,125 个字符。

没有工具调用的两种：

- 正文失控：历史里正文留前 800 个字符加标记，`do_no_tool` 让它重来；界面上已经流出的部分照样显示过（正文边生成边显示）。
- 思考失控、还没出正文（比如 chat completions 的 `reasoning_content` 一直吐）：思考留前 800 个字符，回复就是那句标记本身，`do_no_tool` 让它重来。

用量：到点时读不到带用量的结束事件（Responses 的 `response.completed`、chat completions 末尾的 usage、Anthropic 的 `message_delta`）。补丁不补、不估，`cost_tracker` 的请求数照实少记一次（同票 116 第 5 条）；Anthropic 流在 `message_start` 已记的输入侧照常记。

### 3. 各条分支与非流式路径

- **流式**：`llmcore.py` 里所有模型请求都经 `_stream_with_retry`：`NativeClaudeSession`、`NativeOAISession`，legacy 的 `ClaudeSession`、`LLMSession`；`MixinSession` 只是转给它们，`fast_ask` 也走 `raw_ask`。读行探针一处管住全部流式解析（`_parse_claude_sse`、`_parse_openai_sse` 两条分支、`_chatgpt_plan_parse_sse`）。`managed-ga/code` 里别的 `requests.post` 都不是模型请求（浏览器桥、IM 渠道、`supergrok_proxy`）。
- **legacy 会话**：Galley 只生成 `native_claude_config_<n>` / `native_oai_config_<n>`（`runner/managed_runtime.py:134-136`），内置不走这条。它照样到点停读、不重试、带标记，但它的历史由流出的正文拼成（`BaseSession.ask`），正文失控时历史不截。
- **非流式**（`stream: false`，高级选项里可以设）：不管。`requests.post` 把整个响应体读完才返回，解析器拿到的是整块 JSON，没有读到一半可以停的地方；等待由读超时兜着（GA 非流式默认 240 秒），超时照上游当网络错误重试。订阅登录强制流式（`llmcore.py:930`）。
- **一行都不来的空档**：只在有行到达时看钟，空档只有读超时管（Galley 的模型预设与订阅登录 180 秒，GA 流式默认 40 秒）。最坏是 300 秒再加不到一个读超时；过了 300 秒后流整个不动，仍是上游的超时重试。两次退化都是字一直在流，到点几乎立刻截住。要分秒不差，得另起计时线程从别的线程关套接字（上游 `abort()` 那套，macOS 与 Windows 唤醒方式不同，见补丁 0025）；为一个没见过的形状加这套机制不值，没做。
- **与 0030**：0030 照留。哪一行先到，哪个就截：0030 在补齐 2,000 个空白的那一行停读，之后探针不再取行、不再看钟；到点时探针在解析器看到那一行之前就把它丢掉，0030 之后也不会再触发。一次请求只截一次、只有一句标记。

### 4. 测试与门禁

`runner/tests/test_managed_ga_llmcore.py` 新增 14 条（66 条变 80 条）。假流跑在假的单调钟上（每读一行走 1 秒，第一行前可加等待），不真的等 300 秒：

- `test_deadline_cut_keeps_heads_and_places_the_marker`：截短与放标记的规则：上限与标记的写法、长度；有签名的思考与解析成功的参数不动，没签名的思考、正文、`_raw` 参数截到 800，`_raw` 去掉末尾空白；第一个工具调用前没有正文时单独插块；什么都没有时只剩标记；解析器原来的块不被改动。
- `test_do_no_tool_regenerates_on_the_deadline_marker`：`ga.py` 里 `do_no_tool` 那行判据和它后面的「Regenerate」还在（没有工具调用的截断靠它重来；上游改了这行，这条先红）。
- ① `test_a_normal_stream_read_by_the_deadline_is_untouched[plan_responses|chat_completions|claude]`：正常回复，最后一行正好落在第 300 秒：读完，参数原样解析，没有标记。
- ② `test_a_junk_runaway_in_tool_arguments_is_cut_at_the_deadline[plan_responses|chat_completions|claude]`：11-03 的形状（开头正常，后面 2,000 段 `}u}g}6}#}t}e}`）：读到第 301 行（第 301 秒）停下，当时就退出 `with`，假流没读完；只发了 1 次 POST；正文流是 summary 和标记；参数是 `{"_raw": 开头加乱码的前 800 个字符}`；历史末条正好是「正文 + 标记」和 `_raw` 调用，整段历史不到 2,000 个字符；两条 OpenAI 分支 `_record_usage` 一次没调，Anthropic 只有 `message_start` 那一次。三条都跑完整的会话（订阅登录的 `NativeOAISession`、chat completions 的 `NativeOAISession`、`NativeClaudeSession`），经 `_stream_with_retry`。
- `test_a_runaway_reply_without_a_tool_call_is_cut_and_regenerated`：正文失控：界面照样流出，历史里正文留前 800 加标记，回复结尾落进 `do_no_tool` 的判据。
- `test_a_reasoning_runaway_is_cut_to_the_marker_alone`：思考失控：`</thinking>` 照常闭合，思考留前 800，回复就是标记。
- ③ `test_the_whitespace_guard_and_the_deadline_never_both_cut[185.0|186.0]`：同一条空白失控的流，让第 115 行（补齐 2,000 个空白、0030 触发的那一行）分别落在第 300 秒与第 301 秒：前者 0030 截，后者到点截；两种都读到第 115 行为止，历史里只有一句标记，参数都是开头。

红绿核对：去掉 `_stream_with_retry` 里那三行（helper 留着）跑新用例，六条截断用例全红，其余六条（规则、判据、三条正常流、0030 先到那条）照过；把交给解析器的那行换成一行会被忽略的注释行，Anthropic 那条红，红在多出一句 `[!!! 流异常中断，未收到完整响应 !!!]`；换回补丁后全过。

本地探针（scratchpad，不入库）：系统 Python 3.14 加真 `requests` 2.33.1、`urllib3` 2.6.3，`python3 -B -I`，本机起一个假 SSE 服务，照 11-03 的样子每 10 毫秒吐一段乱码（上限 200 万段），上限临时调成 2 秒（标记文字在导入时已定，仍写 300）。客户端 2.06 秒返回；服务端只收到 1 次 POST，写到第 167 段发现断连，比客户端返回晚 25 毫秒；参数是 `{"_raw": …}`，历史 1,125 个字符。真 `requests` 下退出 `with` 确实关掉了连接。

门禁（worktree 根目录，借主树 venv；`runner.__file__` 已核，指向 worktree）：

```text
$ .venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py
============================== 80 passed in 0.50s ==============================
$ .venv/bin/python -m pytest
====================== 706 passed, 6 deselected in 8.72s =======================
$ .venv/bin/python -m mypy runner
Success: no issues found in 39 source files
$ .venv/bin/ruff check runner
All checks passed!
$ node scripts/check-managed-ga-payload.mjs
[managed-ga-payload] OK
$ node scripts/check-ga-baseline-drift.mjs
[ga-baseline-drift] OK (d66509bf)
$ node scripts/check-docs-links.mjs
docs link gate OK: 493 files checked.
$ git diff --check main...HEAD
（无输出）
```

`managed-ga/` 下没有 `__pycache__`。测试文件本来就不是 `ruff format` 干净的，新增那段没有格式化差异。

### 5. 重放验证；上游

照 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Add A Patch」做：在 scratchpad 新克隆上游 `lsdefine/GenericAgent`，检出 manifest 记的 `d66509bf09f6dd356704a257744a1d7ff899f8f9`，工作区干净。先用 `scripts/build-managed-ga.sh <克隆>` 重放现有 28 个补丁，`git status` 干净，说明改之前 payload 与补丁栈一致。然后改 `llmcore.py`，用 `git diff -U0 --relative=managed-ga/code` 导出零上下文补丁（去掉 `index` 行，与其他补丁同格式），登记两份清单，再用同一个干净克隆重放全部 29 个：`0031` 应用成功，`py_compile` 全过，重建出的 `llmcore.py` 与手改的那份逐字节相同（sha256 `dfb4c83e…`），`managed-ga/code` 与 `state-seed` 的其他文件没变；`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 通过。rebase 到 main 之后又重放一遍，结果相同。`0031` 在栈顶，前面的补丁都没动。

上游没有同样的保护。克隆时上游 `main` 在 `f47403a`（比基线多两个提交，只动 `frontends/p2p_ws_client.py`）；`_stream_with_retry` 只有连接超时与读超时（`timeout=(connect_timeout, read_timeout)`），没有总时长。`llmcore.py` / `legacy_llmcore.py` 的提交记录里，和超时有关的只有调读超时的几次（`da398d9` 流式读超时 30 改 40 秒，`84fcc9a` 非流式 10 / 240 秒，`d7b60b0`，`9e3f01a`）和 `85bae54`（重试时不吐中间错误、接住 `ChunkedEncodingError`）。所以打补丁；上游以后有了就删（manifest 的 Removal condition 写了）。

### 6. 提交号

```text
bb9a9e3c Ticket 140: cap each model request at five minutes (patch 0031)
```

（补丁、payload、两份清单与测试；这份报告另起一个提交。）

### 7. 看到但没改的（Open risks）

1. 只在有行到达时看钟（见第 3 节）：一行都不来的空档只有读超时管；流在 300 秒后整个停住，要等到读超时（Galley 180 秒），然后照上游当网络错误重发一次请求。两次退化都不是这个形状。
2. 正常但真要写 5 分钟以上的长输出（比如很慢的路线上一次写几万字的文件）会被截：参数不合法，模型多半原样重发，再被截。底数里正常请求最长 178 秒，没见过。标记只说为什么截，没叫它分步；真遇上了，廉价的改法是标记末尾加一句「太长的内容分几步写」（仍在 100 个字符内）。
3. 正文失控时，界面与 Galley 消息里照样留着已经流出的部分（正文边生成边显示），只有 GA 的历史与引擎日志是截短的。
4. 标记是中文，会出现在这一步的正文里，界面与 IM 渠道上都看得到；与 0030 的英文标记写法不同（理由见第 2 节）。
5. 截短一刀切：到点时这一步里本来正常、超过 800 个字符的正文（比如工具调用前一段长说明）也被截；只有签了名的思考和解析成功的参数整段留下。
6. `MixinSession`（Galley 不生成）见最后一段里有 `[!!! 流异常中断`，会当成半途失败，下一次请求换到下一条线路。
7. 靠 Anthropic 的 `message_stop` 让 `_parse_claude_sse` 照正常结束收尾：依赖它见了 `message_stop` 就不加自己的警告、两个 OpenAI 解析器不认这个事件类型。上游改了这两处，测试会红（Anthropic 那条多一句警告）。
8. 「没有工具调用就重来」依赖上游 `ga.py:502` 的 `流异常中断` 判据；上游改了这行，`test_do_no_tool_regenerates_on_the_deadline_marker` 先红。重来最多 3 次（`_retry_or_exit` 的 `_empty_ct`），每次最坏又是 5 分钟。
9. 非流式请求不管（见第 3 节）。
10. 用量照实少记一次；服务端在断连前已经生成的那 5 分钟多半计了费，Galley 的计数里没有。关掉连接后服务端是不是立刻停止生成，本机看不到。
11. 用了 0030 的 `_GALLEY_ARGS_KEEP`、`_GALLEY_ARGS_WS`：0030 先删的话，要把这两个常量挪进 0031。零上下文补丁按行号定位：`0001`、`0002`、`0007`、`0008`、`0016`、`0017`、`0021`、`0027`、`0030` 改了 `llmcore.py` 在它上面的行数，要重导 `0031`（两条都写进了 manifest.md 的 Rebase risk）。
12. 没在真 GA 进程或 tauri dev 里端到端跑（不调真模型）。停读、断连、只发一次请求由单测与本地探针验证；模型看到标记和工具报错后会重发，是按代码、0030 与 11-03 那次「之后几步自己纠正」推的。新起的 runner 才带上补丁。

交接：`docs/project-status.md` 的未发版范围、`docs/ga-baseline.md` 契约面里 `_stream_with_retry` 那一处（现在只写 `0021`，`0031` 也改它）没动，留给主会话合入时写；票头 Status 也没改。与票 136：rebase 前后查过，136 没碰 `managed-ga/` 和 `runner/tests/test_managed_ga_llmcore.py`，本票没碰 136 改的任何文件。
