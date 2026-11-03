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
