# 135 主对话的浏览器硬闸：一调浏览器工具就回「交给子任务」

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 184 第 4 条。只影响内置运行时的主对话；子任务、工作台会话、IM 渠道、外置运行时零变化。改 Core（给主对话的 runner 多一个标记）、runner（handler 据此拦）、测试与文档；不动 GUI、CLI、Agent API、迁移、内置 GA 补丁栈。

## 为什么

裁决 184 把派活线定成「上网就派」。条款由票 134 写进入口层提示词，但光靠提示词，模型仍可能「顺手查一下」就开浏览器。硬闸让这条线一定生效：主对话里调浏览器工具不执行，工具结果告诉它交给子任务，它最多白走一步。上游 GA 拦「整篇覆盖写 L1」用的是同一个办法（`managed-ga/code/ga.py` 的 `do_file_write` 里，路径含 `global_mem_insight.txt` 就回一条错误、不执行）。

## 要做到

### 1. Core：给主对话的 runner 一个标记

- Core 起主对话的 runner 时，已经在 `context.env` 里换上主对话的提示词（`core/src/runner_commands.rs:447-458` 一带，`GALLEY_RUNTIME_PROMPT_TEXT`）。在同一处给主对话加一个环境变量，名字用 `GALLEY_MAIN_CHAT`，值 `1`。只有主对话有；子任务、工作台会话、IM 都没有。
- 外置运行时没有主对话，这条路径本来就只在内置下走；在代码里写清，并用测试钉住「非主对话不带这个变量」。
- 把这个变量写进 Core 与 runner 之间的环境变量约定所在的文档（先找现有 `GALLEY_RUNTIME_PROMPT_TEXT` 写在哪：`docs/ipc-protocol.md` 或 `docs/managed-ga-runtime/` 下，照它的写法加一条）。

### 2. runner：handler 拦浏览器工具

- runner 的 handler 子类是 `runner/handlers.py` 的 `WorkbenchHandler`（`dispatch` 在 `:123` 起），bridge 在 `runner/workbench_bridge.py:1120` 起装配 `_ConfiguredWorkbenchHandler`。在 `dispatch` 里：`GALLEY_MAIN_CHAT` 为 `1`、且是内置运行时、且工具名以 `web_` 开头（今天是 `web_scan`、`web_execute_js`，见 `managed-ga/code/ga.py` 的 `do_web_*`；按前缀拦，上游以后加的浏览器工具也拦）时，**不调用** `super().dispatch`，直接返回 GA 的 `StepOutcome`（`managed-ga/code/agent_loop.py:7`），`data` 是一条给模型的错误说明，`next_prompt` 照 GA 自己拦 L1 那处的写法。
- 说明的原文（英文，给模型看；可为读起来顺微调，意思不能变；改了写进报告）：

```text
This is the main chat: you do not use the browser here. Hand this to a subtask: end your reply with <subtask title="a few words">what to do</subtask>, with everything it needs (the goal, the facts the user gave, what this conversation already settled). Tell the user in a sentence that it is on its way.
```

- 判「内置运行时」用 runner 里现有的办法（找 `managed_runtime` 相关的判断，别新造）；外置运行时下这段代码不能改变任何工具调度（AGENTS.md Rule 1：附加模式下 handler 子类只能发信号，不能改调度与结果）。代码注释写清这一点与裁决 184。
- 被拦的这一步，照常发出 runner 的工具事件（`tool_before_callback` 之类的 UX 信号照现有路径走），让界面与库里看得到「它伸手了、被拦了」；不要为它造新的事件类型。报告里写清这一步在库里（`messages.tool_calls` / `tool_results`）和过程卡片里会是什么样子（读代码推，不跑 GUI）。
- 不拦：`code_run`、`file_*`、`ask_user`、`no_tool`、`update_working_checkpoint`、`start_long_term_update`。模型在 `code_run` 里用 `curl` 之类联网，这道闸拦不住，是已知缺口，写进报告的 Open risks，不要试图解析脚本去拦。

### 3. 测试

- runner（pytest）：标记为 `1` 时 `web_scan`、`web_execute_js` 和一个虚构的 `web_future_tool` 被拦，返回上面的说明且没调用底层实现；`code_run`、`file_read` 照常；标记缺省或为别的值时什么都不拦；外置运行时下即使标记为 `1` 也不拦（防误设）。
- Core：主对话的 runner 环境里有 `GALLEY_MAIN_CHAT=1`，普通会话与子任务没有。照现有 `runner_commands` 或 runner 启动参数的测试写法加。
- 加了迁移以外的东西不用碰六处手写迁移列表；这张票不加迁移。

### 4. 文档

- `docs/managed-ga-runtime/` 里讲主对话运行时的地方加一段：主对话不上网，浏览器工具被 runner 拦下，指回裁决 184 与本票。
- `AGENTS.md` 的 Rule 1 不改：这是内置运行时的行为，附加模式的允许清单不变。

## 验证

```bash
.venv/bin/python -m pytest          # 在 worktree 根目录借主树 venv，先打印 runner.__file__ 确认读的是 worktree；GA_PATH 指向 worktree 的 managed-ga/code
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-ipc-protocol-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

长命令前台跑，别放后台等。中文文字用全角标点，提交前自己写个正则扫一遍新增行，脚本放 scratchpad，用 `t135-` 前缀命名。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。另外两个代理同时在做：票 134（`core/src/managed_prompt.rs`、`core/src/subtask_report.rs`、手册 `subtasks.md`、`.scratch/main-chat/entry-layer-eval/`）和基线收尾票（GUI 的工具名别名、几处注释行号、`scripts/check-managed-ga-*.mjs`）。不要碰那些文件；`docs/ipc-protocol.md` 若两边都改，只改你自己那一条，合入时主会话解冲突。
  ```bash
  cd <主树>
  git worktree add -b t135-main-chat-browser-guard <scratchpad>/wt-135 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。凡是 import `managed-ga/code` 的探针用 `python -B`，`managed-ga/` 下不能留 `__pycache__`。
- Core 只格式化自己动过的文件（`rustfmt --check` 逐文件），不要 `cargo fmt --all`。
- 不写 Galley 数据库、不写内置 / 外置 GA 的状态。不给上游提 PR 或 issue。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`。提交说明末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：

1. 改了哪些文件；标记在哪里设、在哪里读、怎么判内置。
2. 给模型的说明最终原文。
3. 被拦的那一步在库里与过程卡片里的样子（读代码推的，标明没跑 GUI）。
4. 验证命令逐条结果。
5. 看到但没改的（Open risks），原样列出（至少包括 `code_run` 联网这个缺口）。

## 报告

代理在 worktree 分支 `t135-main-chat-browser-guard` 上完成，基于 `c14e8591`。没跑 `tauri dev`、没调真模型、没看 GUI；界面那一节是读代码推的。

### 1. 改了哪些文件；标记在哪设、在哪读、怎么判内置

- `core/src/runner_commands.rs`：
  - 新常量 `MAIN_CHAT_ENV = "GALLEY_MAIN_CHAT"`（约 `:372`），文档注释写明只有主对话的 runner 有、外置的 spawn 不经过这里。
  - 把 `prepare_managed_runtime_context` 里那串环境变量字面量抽成 `managed_runtime_env(...)`（约 `:377`），内容与顺序一字不变；所有内置 runner（工作台会话、子任务、IM 渠道）都从它起，里面没有标记。
  - 新函数 `mark_main_chat_env(env, prompt)`（约 `:399`）：换上主对话的提示词（原来那段 `iter_mut().find(...)` 搬进来），再加 `GALLEY_MAIN_CHAT=1`。
  - `prepare_managed_spawn_args` 的主对话分支（`if let Some(main_chat) = main_chat`，约 `:486`）改为调用它。分支的门照旧：`segment::prompt_state` 只在会话 id 等于 `main_chat_id()` 时给 `Some`。这个函数只在内置 spawn 走（`spawn_runner` 的 `RuntimeKind::Managed` 分支、`session_runner::spawn_config` 的 `SpawnEnv::prepare_managed`）；IM 直接用 `prepare_managed_runtime_context`，不经过它。
  - 两条新测试：`only_marking_adds_the_main_chat_flag`（底座没有标记，标记后正好一条 `1`、提示词换掉、常量名钉死）；`only_the_main_chat_runner_gets_the_flag`（内存库里建主对话、内置工作台会话、主对话的子任务、外置会话，按 `prompt_state` 这道门重放：只有主对话带 `GALLEY_MAIN_CHAT=1`）。`prepare_managed_spawn_args` 本身要 Tauri app，没法直接测，所以测的是门加两个纯函数。
- `runner/handlers.py`：
  - 新常量 `MAIN_CHAT_ENV`、`BROWSER_TOOL_PREFIX = "web_"`、`MAIN_CHAT_BROWSER_REFUSAL`，新函数 `_main_chat_refuses(tool_name)`（约 `:88`）。三条同时成立才拦：工具名以 `web_` 开头；`os.environ.get("GALLEY_MAIN_CHAT") == "1"`（只认正好 `1`）；`managed_runtime.is_managed_runtime()`。最后这条用的是 runner 现成的判法（`runner/managed_runtime.py:26`，`GALLEY_RUNTIME_KIND == "managed"`，bridge 装内置专属的东西都用它），没新造。
  - `WorkbenchHandler.dispatch` 开头（约 `:183`）：拦下时不调用 `super().dispatch`，先照常调 `tool_before_callback`（轮次信号照发），再 `return StepOutcome({"status": "error", "msg": MAIN_CHAT_BROWSER_REFUSAL}, next_prompt="\n")`。`StepOutcome` 在分支里才 import，附加模式碰都不碰。不 yield 任何东西（GA 自己的工具提前返回也是这样，循环读 `StopIteration` 的值）。
  - 模块与类的文档注释写清：这是 Rule 1 下唯一的例外，只在内置运行时的主对话，附加模式下这段不改任何调度与结果（即使标记被误设，`GALLEY_RUNTIME_KIND` 不是 `managed` 就不拦）；注明裁决 184 与本票。
- `runner/tests/test_handlers.py`：新增 17 条（参数化展开后）：标记为 `1` 时 `web_scan`、`web_execute_js`、虚构的 `web_future_tool` 被拦，底层 `do_*` 没跑、没有 yield、返回上面的信封与 `"\n"`；说明原文逐字钉死；被拦这一步轮次信号照发；`code_run`、`file_read` 照常；标记缺省、空串、`0`、`true`、`yes`、` 1`、`1 ` 什么都不拦；外置（`GALLEY_RUNTIME_KIND` 缺省、`external`、大写的 `Managed`）下标记为 `1` 也不拦。
- 文档：
  - `docs/managed-ga-runtime/runtime-modes-and-sessions.md`：在「Main Chat Subtasks」后加一节「The Main Chat Does Not Browse」（约 `:217`），写标记、闸、这一步照样是一步、不拦的工具与缺口、附加模式不变，指回裁决 184 与本票。
  - `docs/managed-ga-runtime/prompt-composition.md`：开头讲 `GALLEY_RUNTIME_PROMPT_TEXT` 与主对话分支的那段末尾加一句 `GALLEY_MAIN_CHAT=1`（`:31-35`）。票 134 改这个文件的 `:450` 以后，不相邻。
  - `docs/ipc-protocol.md`：§6「Approval Flow（已删除）」里「`WorkbenchHandler` 不改工具派发或结果」后补一段例外（`:672-676`）。基线收尾票只改 `:195`，不相邻。
  - `docs/ga-baseline.md`：Contract Surface 第 3 条与「Where each coupling lives」的 `runner/handlers.py` 一条补上浏览器闸（`web_` 前缀与 `StepOutcome(data, next_prompt)` 从此是升级审计要看的接缝）。
  - `AGENTS.md` 没动（按票面）。没动 GUI、CLI、Agent API、迁移、内置 GA 补丁栈。

### 2. 给模型的说明最终原文

按主会话中途的追加要求放宽了第一句：闸只拦 `web_*`，被拦后模型可能改用 `code_run` 里的 `curl` 之类上网，所以说明改成「主对话根本不上网，浏览器和 `code_run` 里的命令都不行」，后半句与票面一致（`runner/handlers.py` `MAIN_CHAT_BROWSER_REFUSAL`，测试 `test_main_chat_refusal_text` 逐字钉死）：

```text
This is the main chat: you do not go online here, neither with the browser nor with commands such as curl in code_run. Hand this to a subtask: end your reply with <subtask title="a few words">what to do</subtask>, with everything it needs (the goal, the facts the user gave, what this conversation already settled). Tell the user in a sentence that it is on its way.
```

机制没变：仍只拦 `web_` 开头的工具，`code_run` 照常执行。

包在 GA 的错误信封里：`{"status": "error", "msg": "<上面这段>"}`，`next_prompt="\n"`，与 GA 拦整篇写 L1 那处（`managed-ga/code/ga.py` `do_file_write`）同形。选信封而不是纯字符串，是因为桌面只把这个形状画成「失败」（`gui/src/lib/tool-outcome.ts` `settledToolStatus`），纯字符串会画成一次成功的读取网页。

### 3. 被拦的那一步在库里与过程卡片里的样子（读代码推的，没跑 GUI）

用 scratchpad 里的探针（`python -B`）拿内置 GA 真的 `agent_runner_loop` 跑了一遍：第 1 步同时调 `web_scan` 与 `code_run`，第 2 步回一句带 `<subtask>` 的话。`turn_end` 钩子看到的与模型第 2 步收到的一致，循环照常进入第 2 步，第 2 步以 `CURRENT_TASK_DONE` 结束。

- 库里（`messages` 那一步的行，经 bridge `_serialize_tool_call` / `_serialize_tool_result` 与 Core `turn_persistence` 落库）：
  - `tool_calls`：`[{"toolName":"web_scan","args":{"tabs_only":false}}, …]`，调用照记。被拦的调用没经过 GA 的 dispatch，所以 GA 内部的 `_index` / `_tool_num` 没写进参数；bridge 本来就去掉 `_` 开头的键，落库形状与平常一样。
  - `tool_results`：`[{"toolUseId":"call_1","content":"{\"status\": \"error\", \"msg\": \"This is the main chat: …\"}"}, {"toolUseId":"call_2","content":"…"}]`。结果数组与调用一一对上（数据非空，GA 会 append）。
  - 下一步是带 `<subtask>` 的最终回答，没有真工具调用，Core 照 `subtask.rs` 的规则派出、画卡片。
- 过程卡片（`gui/src/lib/assistant-process.ts`）：这一步有一行；行文字是模型写的 `<summary>`，模型没写时兜底为「调用了 web_scan」；行尾不带网站（`browserFactsFromResult` 对错误信封返回空，取不到站点）。展开后是 `web_scan` 的工具条，状态 `failed-historical`（红色强调、默认收起），首行取 `msg` 的第一行、超过 200 字截断加「…」（这段约 370 字，会被截），展开正文是全文。
- 实时：GA 循环在 dispatch 前就流出 `🛠️ Tool: \`web_scan\`` 那一行，助理脸会短暂按「看网页」（`assistant-face.ts` `classifyTool`），直到下一步的流开始；闸不 yield，没有五个反引号包着的工具输出。轮次信号照发（探针里第 1 步的信号来了两次，bridge 的 `_emit_turn_start` 去重）。

### 4. 验证命令逐条结果

- `.venv/bin/python -m pytest`（worktree 根目录软链主树 `.venv`，`GA_PATH` 指向 worktree 的 `managed-ga/code`，加 `-B`）：先用一个 scratchpad 里的 pytest 插件打印，`runner.__file__`、`runner.handlers.__file__`、`agent_loop.__file__` 都在 worktree 里；全量 `674 passed, 6 deselected`（e2e 默认不跑），其中 `test_handlers.py` 22 条全过；放宽说明之后重跑，结果相同。
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 37 source files`。
- `.venv/bin/ruff check runner`：`All checks passed!`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：退出码 0，47 组共 1301 条过、0 失败（含新加的 `only_marking_adds_the_main_chat_flag`、`only_the_main_chat_runner_gets_the_flag`）。
- `rustfmt --edition 2021 --emit stdout < core/src/runner_commands.rs`：与文件无差异（经标准输入，不跟进子模块；主树原文件同法也无差异）。
- `node scripts/check-ipc-protocol-drift.mjs`：退出码 0（15 events、8 commands 对齐）。
- `node scripts/check-docs-links.mjs`：退出码 0（493 个文件）。
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (d66509bf)`。
- `git diff --check`：干净。
- `managed-ga/` 下 `find -name __pycache__` 为空；`.venv` 软链跑完已删。
- 新增行全角标点：`t135-cjk-punct.py` 扫 `git diff main` 的新增行，只命中一处，是测试里的 Rust 字符串字面量 `Some("查明天的天气".into())`，不是文字，其余 0 处。
- 私有信息：扫过整个分支 diff，没有本机路径、用户名、服务商名或接口主机；报告里只出现 scratchpad 这个词，没写路径。

### 5. Open risks（看到但没改）

1. **`code_run` 联网拦不住**：主对话在 `code_run` 里用 `curl`、`wget`、`python` 的 `urllib` / `requests` 之类直接上网，这道闸看不见，只能靠条款与说明里那句「`code_run` 里的命令也不行」。按票面没去解析脚本。主会话数过主对话的历史：09-01 以来 111 次 `code_run` 没有一次上网，但那是没有闸的时候；有了闸，被拦之后改走 `curl` 的动机变大，真机要留意。
2. **GA 自带子代理绕得过去**：主对话在 `code_run` 里按 `memory/subagent.md` 起 `agentmain.py --func` / `--task`，那个进程用的是 GA 自己的 `GenericAgentHandler`，不是 Galley 的 runner，可以照常开浏览器。它会继承 `GALLEY_MAIN_CHAT=1`，但没人读。
3. **用户会在过程卡片里看到一条红色的英文失败**：每次主对话伸手，过程卡片就多一行，展开是 `web_scan` 失败、首行是给模型的英文说明。裁决 184 接受「最多白走一步」，但这条红色失败读起来像出错；票面不让动 GUI，没改。要不要给这种结果单独画法，留给真机看了再定。
4. **真模型的反应没测**：说明在 JSON 信封里，`title="a few words"` 的引号会以 `\"` 出现，模型会不会照抄反斜杠、会不会被拦后换 `web_execute_js` 再试一次（每次白走一步，只受 GA 的步数上限约束），都没跑真模型。真机：在主对话问「明天上海天气怎样」，看第一步是不是浏览器、被拦后下一步是不是一条带标题的 `<subtask>` 和一句告知，再查库里那一步的 `tool_results`。
5. **只对新起的主对话 runner 生效**：标记在 spawn 时写进环境，`handlers.py` 在 runner 启动时加载。合入后 dev 里已经热着的主对话 runner 两样都没有，要等它重起（Core 重启、新的一段、重置）才生效；真机前先确认主对话 runner 是合入后起的。
6. **前缀假设**：闸认 `web_` 前缀。上游若把浏览器工具改名成别的前缀，闸会悄悄失效；反过来，上游若加一个 `web_` 开头但不碰浏览器的工具，主对话也用不了。已写进 `docs/ga-baseline.md` Contract Surface 第 3 条，升级审计时看。
7. **GA 插件钩子不触发**：被拦的调用不经过 `BaseHandler.dispatch`，GA 的 `plugins.hooks` 的 `tool_before` / `tool_after`（如 langfuse 追踪）不会为它触发，同 GA 处理未知工具的路径。Galley 自己没注册这类钩子。
8. **标记会被子进程继承**：主对话 runner 起的所有子进程（`code_run` 的 shell、`galley` CLI）都带着 `GALLEY_MAIN_CHAT=1`。今天只有 `runner/handlers.py` 读它，Core 起 runner 用的是 Core 自己的环境，不会传下去；以后若有别的东西读这个名字，要记得这一点。
