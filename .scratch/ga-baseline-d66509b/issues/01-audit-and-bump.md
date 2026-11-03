# 01 GA 基线 a9a36b4 → d66509b：审计、补丁栈重放、重建内置 GA

Status: needs-dogfood（2026-11-03 快进合入 `06950b8c`。主会话验收：读过补丁 `0001` 新加的那一行（`managed-ga/code/ga.py:542` 改从状态根读 L0）；worktree 里 `check-managed-ga-payload`、`check-ga-baseline-drift`、`git diff --check` 过，新回归测试 `runner/tests/test_managed_ga_l0_path.py` 2 条过，`managed-ga/` 下没有 `__pycache__`，新增行没有本机路径。合入时 dev 与安装版的 Core 都没开。要真机走：dev 里一个真实浏览器任务；一个会调 `start_long_term_update` 的长任务，看提纯读到 L0（`This is L0:`），飞书、Telegram、Discord 任一渠道让它记一件事同样看一次）

来源：2026-11-03 v0.7.5 发版讨论。v0.7.5 跳过了基线升级（上游 `llmcore.py` 的拆分正好落在补丁 `0007`、`0030` 所在的文件，单开一轮）；JC：「按建议推进」，与主对话票 134 同时跑，一起进 v0.7.6。外置运行时的耦合点要一起审（用户自己的 GA 更新到这个版本后，Galley 照样能用）。

## 目标

- 当前基线：`a9a36b4b219593369de01c3e5973e56ac02e568b`（`managed-ga/manifest.json`）。
- 目标（锁定，不追 `main`）：`d66509bf09f6dd356704a257744a1d7ff899f8f9`（上游 `main`，`git ls-remote` 查于 2026-11-03）。中间经过 `e4d956f`（v0.7.3–v0.7.5 发版时上游所在的提交，只改了 `frontends/conductor.py` 与 `memory/` 种子）。
- 做法照 `docs/ga-baseline.md`「Upgrade Procedure」全套走，下面只补这一轮要特别审的地方。

## 这一轮要逐条审的（每条在报告里给结论和文件行号）

1. **`llmcore.py` 拆分**（上游 `4ca9028`）：旧的文本协议会话（原 `llmcore.py` 第 933–1049 行一带）挪进新文件 `legacy_llmcore.py`，`llmcore.py` 末尾 `try: import legacy_llmcore` 再把名字挂回来（循环 import）。
   - 我们 9 个补丁改 `llmcore.py`：`0001`、`0002`、`0007`、`0008`、`0016`、`0017`、`0021`、`0027`、`0030`。逐个核：有没有改过的代码被挪进了 `legacy_llmcore.py`（有的话补丁要改落点，或者判断它已经不用了）；只是行号移动的用 `rebase-managed-ga-patches.sh` 重导出，不要手改 hunk。
   - 循环 import 在 Galley 的内置加载器下能不能工作：runner 怎么加载 `managed-ga/code`（找 runner 里 import `llmcore` / `agentmain` 的地方），`resolve_session` 走 legacy 路径时类从哪里来。写一个 `python -B` 探针在内置 payload 上 import 一遍、各种会话各建一个（不发请求）。探针放 scratchpad，跑完确认 `managed-ga/` 下没有 `__pycache__`。
   - Galley 的内置模型配置会不会走到 legacy 路径（名字里没有 `native` 的条目）：查 Galley 生成 mykey 的地方。会走到的话，上游新加的 `print(f"[Legacy] …")` 打到标准输出，runner 把标准输出接到 /dev/null、只转发 `Backend Error` / `[LLM Retry]` 开头的行（`runner/ga_print_forward.py`），确认不会混进 IPC。
2. **`claude_compat`**（上游 `be17b0a`，`llmcore.py` 的 `_cc_system`、`NativeClaudeSession.__init__`、`raw_ask`）：主会话初看新旧逻辑在不设 `claude_compat` / `fake_cc_system_prompt` 时等价。核实这一点，并确认 Galley 生成的配置里从不设这两个键。
3. **`agent_loop.py` 把 `Bash` / `PowerShell` 映射到 `code_run`**（上游 `5ec4b12`，`BaseHandler.dispatch`）：
   - 模型回复里记下的工具名是 `Bash`，实际执行的是 `code_run`。查 runner 的工具事件、Core 的 `turn_persistence`（`core/src/turn_persistence/derive.rs` 一带按工具名推导的地方）、GUI 按工具名画图标和文案的地方，看 `Bash` 会不会被当成未知工具画坏、或者漏掉文件写入等推导。只查、写结论；要改 Galley 代码的地方写进报告，别顺手改（这张票不动 GUI）。
   - Galley 的 handler 子类有没有覆盖 `dispatch`（两种运行时都看）。
4. **`ga.py` 的 L1 整篇写入拦截**（`do_file_write` 里路径含 `global_mem_insight.txt` 就报错）：确认 Galley 的手册、补丁、提示词里没有让模型整篇写 L1 的路径（主会话 grep 过手册与 `managed_prompt.rs`，没有）；补丁 `0001` 改过状态根以后，路径判断照样命中。
5. **`ga.py` 的 L0 路径**（上游 `1a44b3f`，`do_start_long_term_update` 里 `./memory/memory_management_sop.md` 改成 `os.path.join(script_dir, 'memory', …)`）：**这一条最要紧。** 内置运行时的 `memory/` 在状态根（`GALLEY_GA_STATE_ROOT`，补丁 `0001`），不在 `managed-ga/code` 下。改成按代码目录找以后，内置的记忆提纯会不会变成「Memory Management SOP not found. Do not update memory.」？
   - 查补丁 `0001` 有没有管这一行（旧的相对路径靠 runner 的工作目录碰巧对上，还是有 hunk 改过）；需要的话在 `0001` 里给这一行加一个落到状态根的 hunk（最小改动，注释写清为什么），并写测试或探针证明内置下读得到 L0。
   - project-status 记着「飞书、Telegram、Discord 的记忆提纯读不到 L0（`ga.py:538` 从渠道的工作目录开相对路径）」（`docs/project-status.md` 搜 `cannot read L0`）：这次之后渠道读不读得到，写结论；读得到了就在 project-status 那条注明。
   - 外置运行时：用户自己的 GA 按 `script_dir` 找，是上游本意，Galley 不管。
6. **记忆提纯提示词改了一句**（`ga.py` 的 `do_start_long_term_update`）：确认没有 Galley 补丁改这段（裁决 161、163 相关的是手册与 L2，不是这里）。
7. **`memory/` 种子**（`memory_management_sop.md`、`vision_sop.md`、`vision_api.template.py`、`L4_raw_sessions/compress_session.py`）：照现有规则处理 `managed-ga/state-seed`（只补缺、不覆盖已装用户的状态）；写清新装用户拿到什么、已装用户拿不到什么。
8. **不进 Galley 的**：`frontends/`（conductor、hub、hub_p2p、p2p_ws_client、desktop_bridge 两处注释、slash_cmds、tui）、`ga_cli/`、`service_manager.pyw`、`assets/` 下的图片与模板、`mykey_template*.py`、`README.md`。逐个确认 Galley 不加载、不打包或不受影响（`desktop_bridge.py` 是附加模式图片接缝的参照，见 AGENTS.md Rule 1，这次只改了注释）。`pyproject.toml` 依赖有没有变；变了要改 `scripts/bundle-python.sh`。
9. **外置运行时的耦合点**：`docs/ga-baseline.md` 列的耦合点（`agent.list_llms()`、`_turn_end_hooks`、`llmclient.backend.history`、`GenericAgentHandler` 子类、图片附件那一次 `ask` 包装等）在 `d66509b` 上逐个确认还成立。runner 测试用 `GA_PATH=<干净克隆>` 跑一遍。
10. **接缝镜像**：改了补丁或 runner 接缝以后，全仓 `grep` 旧名字与旧行号的引用（含 `.scratch/*/entry-layer-eval/` 的加载器、`docs/devlog/deferred.md`、`docs/managed-ga-runtime/`），会被代码或测试读到的跟着改。用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。

## 交付

- `managed-ga/manifest.json` 的 `upstream`（commit、commitDate、treeHash、auditedAt）；`managed-ga/code/` 重建；`managed-ga/patches/` 重导出（若有）；`managed-ga/patches/manifest.md` 加这一轮的重放记录（照上面几轮的写法）。
- `gui/src/lib/ga-baseline.gen.ts` 等由脚本生成的基线镜像（看上一轮 `08c794cc` 改了哪些文件，照做）。
- `docs/ga-baseline.md`：当前基线一节换成 `d66509b`，审计结论写进去；「Shipped in」暂写「未发布（目标 v0.7.6）」。
- devlog：`docs/devlog/2026-11-0X-ga-upstream-upgrade-a9a36b4-to-d66509b.md`（照 `2026-10-26-ga-upstream-upgrade-b70079d-to-a9a36b4.md` 的结构），`docs/devlog/README.md` 加一行。
- project-status 不改版本号；只在第 5 条有结论时改那一句「cannot read L0」。

## 验证

```bash
./scripts/rebase-managed-ga-patches.sh <target_sha> <干净克隆>   # 需要时
./scripts/build-managed-ga.sh <干净克隆>
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
.venv/bin/python -m pytest                       # 在 worktree 根目录借主树 venv，先打印 runner.__file__ 确认读的是 worktree
GA_PATH=<干净克隆> .venv/bin/python -m pytest runner/tests/ -m 'not e2e'
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
./scripts/bundle-python.sh mac-x64               # 这台 Mac 是 Intel，不要传 mac-arm64
./scripts/check-bundled-python-managed-ga.sh
cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck                          # 只有动了 gen.ts 时
node scripts/check-docs-links.mjs
git diff --check
```

长命令前台跑，别放后台等。中文文字用全角标点，提交前自己写个正则扫一遍新增行，脚本放 scratchpad，用 `gab01-` 前缀命名。真模型请求不在这张票里跑：合入后主会话在 JC 的 dev 里跑一个真实浏览器任务。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树，改主树会让它重编、重启 Core）。不跑 `tauri dev`。另一个代理在另一个 worktree 里做主对话票 134（改 `core/src/managed_prompt.rs` 与手册 `subtasks.md`），你不要碰那两处。
  ```bash
  cd <主树>
  git worktree add -b gab01-baseline-d66509b <scratchpad>/wt-gab01 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 上游干净克隆放 scratchpad 自己的目录里（`git clone https://github.com/lsdefine/GenericAgent.git`，再 `checkout` 目标 SHA，`git status --short` 为空）。不要用、也不要改用户自己的 GA 检出（`~/Documents/GenericAgent`）。
- 凡是 import `managed-ga/code` 的探针用 `python -B`；`managed-ga/` 下不能留 `__pycache__`（`check-managed-ga-payload` 会报，打包还会带进 app）。
- Core 只格式化自己动过的文件（`rustfmt --check` 逐文件），不要 `cargo fmt --all`；GUI 不要整文件跑 prettier。
- 不写 Galley 数据库、不写内置 / 外置 GA 的用户状态。不给上游提 PR 或 issue。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`。提交说明末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：

1. 上游 `a9a36b4..d66509b` 提交清单，按「进 Galley / 不进」分。
2. 第 1–10 条逐条结论，带文件行号；第 5 条单独写清内置下 L0 读不读得到、改了什么。
3. 补丁栈：哪些重导出、哪些改了内容、有没有删掉或新增；重建后的 payload 相对旧 payload 的差异是不是正好等于上游的差异加上你说明过的补丁改动。
4. 验证命令逐条结果（条数、通过与否）。
5. 改了哪些文件。
6. 看到但没改的（Open risks），原样列出，特别是要改 Galley 代码（runner / Core / GUI）的地方。

## 报告

2026-11-03，执行代理，worktree 分支 `gab01-baseline-d66509b`。上游干净克隆在 scratchpad 里，检出 `d66509b`，`git status --short` 为空；没碰用户自己的 GA 检出。行号除另注外指本分支重建后的文件。

### 1. 上游 `a9a36b4..d66509b` 提交清单

共 29 个提交（含合并 `6ea8456`），27 个文件，+786 / −307，作者都是上游作者。

**进 Galley（改到内置引擎会加载的代码，或内置种子）**

- `4ca9028` `llmcore.py` 拆出 `legacy_llmcore.py`；`ga.py` 改记忆提纯提示词一句。
- `754acfd` `ga.py` 的 L1 整篇写入拦截。
- `be17b0a` `llmcore.py` 的 `claude_compat`（同提交的 `assets/cc_system_template.txt` 只在 `half` 档读；`configure_mykey.py`、`mykey_template*.py` 不进，见下）。
- `5ec4b12` `agent_loop.py` 把 `Bash` / `PowerShell` 映射到 `code_run`；`memory_management_sop.md` 种子（同提交的 conductor 不进）。
- `1a44b3f` `ga.py` 的 L0 路径。
- 种子（只到新装用户）：`847ca3c`、`0763061`、`695147f`、`2bacbf6`、`e4d956f`（macOS 操控、OCR、L0 索引规则）、`2eab21c`、`9fb4ead`（识图默认不缩图）、`3f66861`、`4812364`（L4 会话文件撞名、历史去重）。

**不进 Galley（随 payload 拷贝，但没有 Galley 进程加载）**

- conductor：`694d3e3`、`5dee7f4`、`a7f55b8`、`8bbdfd8`、`eaba500`、`d4c2c54`（及 `5ec4b12` 的 conductor 部分）。
- hub / p2p：`29c93b8`、`aab769f`、`fede1b2`、`f462eab`、`56547d3`（含群二维码图）。
- `9f358ea` `hub.pyw` 改名 `service_manager.pyw`，连带 `desktop_bridge.py`、`slash_cmds.py`、`tui_v3.py`、`tuiapp_v2.py`、`ga_cli/cli.py` 的注释与命令。
- `9a77a96` 群二维码；`d66509b` README；`6ea8456` 合并提交本身无改动。

### 2. 逐条结论

**第 1 条 `llmcore.py` 拆分：不断，补丁只动行号。**

- 9 个改 `llmcore.py` 的补丁没有一个 hunk 落在挪走的代码里（上游原 `llmcore.py` 第 757–779 行 `ClaudeSession` / `LLMSession`、936–1049 行 `ToolClient`）：`0007`、`0016`、`0017`、`0021`、`0027`、`0030` 的 hunk 都在第 700 行以前，不动；`0001`（`_write_llm_log`，`@@ -1082` → `@@ -950`）、`0002`（`tryparse` 与帮手块，`@@ -1076` → `@@ -944` 等）、`0008`（`NativeToolClient`，`@@ -1418` → `@@ -1286`）在拆分点下面，只动行号。挪走的类调的被改函数都留在 `llmcore`，经 `llmcore.` 在调用时取，补丁照样生效。
- 挪走的代码与原代码逐行相同，只加了 `llmcore.` 前缀（脚本比对 127 行对 127 行）；`legacy_llmcore.py` 没有未定义的名字（AST 扫描）。
- 循环 import：`legacy_llmcore.py:4` `import llmcore`，`:142-144` 把三个名字挂回；`llmcore.py:1401` `try: import legacy_llmcore`；`agentmain.py:9` `from llmcore import … ToolClient …`。runner 的顺序是 `runner/workbench_bridge.py:697` `_setup_ga`：先把代码目录与 `frontends/` 放上 `sys.path`，`install_managed_mykey_loader` 里 `import llmcore`（`runner/managed_runtime.py:200`），再 `import agentmain`。探针 `python -B`、打包 Python，三种顺序（runner 的、外置先 `agentmain`、先 `legacy_llmcore`）各一个进程：`sys.modules` 里只有一份顶层 `llmcore`；`llmcore.ToolClient` 与 `agentmain.ToolClient` 都是 `legacy_llmcore.ToolClient`；`native_claude` / `native_oai` 建出 `NativeToolClient`，`claude_config` / `oai_config` 建出 `legacy_llmcore.ToolClient` 包 `legacy_llmcore.ClaudeSession` / `LLMSession`，非 native 的混合会话也是 `legacy_llmcore.ToolClient`；装了内置加载器的 `GeneraticAgent()` 只有两个 `NativeToolClient`。跑完 `managed-ga/` 下没有 `__pycache__`。
- 内置不走 legacy：Galley 生成的键只有 `native_claude_config_<n>` / `native_oai_config_<n>`（`runner/managed_runtime.py:134`、`:136`）。外置用户 mykey 有非 native 条目时，上游每次重建客户端打 `[Legacy] …`（`llmcore.py:1387`）。bridge 把 fd 1 接 /dev/null、`sys.stdout` 换成转发器（`runner/workbench_bridge.py:76`，在 `:2081` 调用，早于 import GA），只转 `Backend Error` / `[LLM Retry]` 开头的行（`runner/ga_print_forward.py:27`），这一行丢掉，不进 IPC；设置页 GA 探针只取最后一行 `{` 开头的 JSON（`core/src/runner_commands/probe.rs:228`）。
- 测试与评测加载器都按顶层名 `import llmcore`（`runner/tests/test_managed_ga_llmcore.py:35`、`.scratch/main-chat/entry-layer-eval/run.py:3455`），不用改；前者的 `llmcore.LLMSession` 经挂回照样能用，测试全过。

**第 2 条 `claude_compat`：等价，但前提要改一句——Galley 会设 `fake_cc_system_prompt`。**

- Galley 设旧键：Kimi 预设 `fake_cc_system_prompt: true`（`gui/src/lib/managed-model-presets.ts:177`），设置页高级选项有这个开关（`gui/src/components/screens/settings/models/AdvancedModelOptions.tsx:197-202`），runner 把高级选项合进配置（`runner/managed_runtime.py:156`）。从不设 `claude_compat`；只有自由格式的高级覆盖能写进去（`core/src/managed_model_layers.rs:110-119`），界面不暴露。
- 新逻辑：`llmcore.py:1008-1009` 旧键映射成 `simple`，`:999-1002` `_cc_system`，`:1047` 用它拼 system；`:1038` 的 thinking / effort 默认值仍看 `fake_cc_system_prompt`（现在是 `claude_compat != "off"`）。探针在新旧 payload 上拦下 `NativeClaudeSession.raw_ask` 的请求：不设键、旧键真、旧键假，各配空与非空 system，共 6 种，请求体与请求头（去掉随机会话 ID 与 metadata）逐字节相同。

**第 3 条 `Bash` / `PowerShell` 映射：不断，GUI 有外观缺口（没改，见 Open risks）。**

- `agent_loop.py:19` 改名并造新参数字典；记录用的是模型原名与原参数（`agent_loop.py:71`），显示行也是 `Bash`（`:79-80`）。runner 原样发 `toolName`（`runner/workbench_bridge.py:1602`）。
- Core：写库只按 `no_tool` 判最后一步（`core/src/turn_persistence/mod.rs:98-101`），`derive.rs` 不按工具名推导；文件路径只认 `file_write` / `file_patch`（`runner/workbench_bridge.py:278`），`code_run` 本来就不认，`Bash` 写的文件同样不记。
- GUI：层级只按 `no_tool` 与状态分（`gui/src/components/conversation/ToolCallout.tsx:76-83`），不会画坏；`Bash` 不在 `TOOL_META`（`:466-475`），画成只有名字的药丸，参数预览走默认分支取 `command`（`:773-774`）；助理的脸判成「思考」（`gui/src/lib/assistant-face.ts:118-121`）。
- Galley 的 handler 子类：`WorkbenchHandler.dispatch` 不改派发，只在有 `do_<名字>` 时补发 turn_start（`runner/handlers.py:138-149`）；`Bash` 没有，所以不补发，第 1 步由派发命令先发、第 N+1 步由上一步结束时预发（`runner/workbench_bridge.py:1690`、`:1716`、`:1593`），不缺。IM 前端用上游 handler，外置同样，没有覆盖 `dispatch`。

**第 4 条 L1 整篇写入拦截：命中，Galley 没有让模型整篇写 L1 的地方。**

`ga.py:420` 先把路径解析成绝对路径，`:424-425` 按子串拦，与目录无关。探针在状态根下：`../memory/global_mem_insight.txt` 与绝对路径，覆盖、追加都返回 error；`file_patch` 照常改 L1；写 `temp/notes.txt` 照常。`git grep global_mem_insight` 在 `core/src`、runner、手册、`gui/src`、`cli` 只有 Core 的注释与测试，补丁里只有 `0001` 的读路径与 `0003` 的模板路径。

**第 5 条 L0 路径：不修的话内置下所有入口都读不到 L0；已在 `0001` 修好，三个渠道的老问题一起修掉。**

- 旧版：`0001` 没管这一行，`./memory/memory_management_sop.md` 靠进程 cwd 碰巧对上（旧 payload `ga.py:540`）。桌面：Core 起 runner 不给 cwd（`core/src/session_runner/spawn_config.rs:160`），bridge `chdir` 到状态根（`runner/workbench_bridge.py:722-728`），读得到；微信：supervisor 停在状态根（`runner/managed_im_supervisor.py:372`），读得到；飞书、Telegram、Discord：`chdir(state_dir)` 进 `im/<platform>`（同文件 `:519`、`:641`、`:758`；目录见 `core/src/im_supervisor/manager.rs:180`），读不到。
- 上游 `1a44b3f` 改成按代码目录找，内置代码目录里没有 `memory/`（`scripts/build-managed-ga.sh:65` 排除它，种子在 `managed-ga/state-seed/memory/`）。
- 修法：`0001` 加一个 hunk（`@@ -520 +524 @@`），这一行改成 `state_path('memory', 'memory_management_sop.md')`，行尾注释 `# Galley: memory/ is in the state root, not beside the code`（`managed-ga/code/ga.py:542`）。一行换一行，后面的 hunk 不挪位。`memory_management_sop.md` 是种子的关键文件（`core/src/managed_runtime.rs:18-19`），每个内置安装的状态根里都有。
- 证明（打包 Python，`python -B`，不发请求，`current_turn` 设 10）：

  | 代码 | cwd = 状态根（桌面、微信） | cwd = `im/<p>`（飞书、Telegram、Discord） | cwd 在别处 |
  |---|---|---|---|
  | 旧 payload | 读到 L0 | not found | not found |
  | `d66509b` 不加这个 hunk | not found | not found | not found |
  | 新 payload | 读到 L0 | 读到 L0 | 读到 L0 |

  外置（上游干净克隆，不设状态根）：`a9a36b4` 只在 cwd 是 GA 目录时读到，`d66509b` 在哪都读到，是上游本意，Galley 不管。
- 回归测试：`runner/tests/test_managed_ga_l0_path.py`，子进程带状态根跑这个工具，cwd 分别在状态根与 `im/feishu`。指向不加 hunk 的代码时两条都失败，指向新 payload 时都过。
- project-status 那句（「cannot read L0」）已注明：主线上 `d66509b` 之后这三个渠道读得到。

**第 6 条 提纯提示词：没有 Galley 补丁改这段。**

`ga.py:537-540` 是上游原文。补丁在 `ga.py` 的 hunk（`0001`、`0003`、`0006`）都是单行赋值或新加的帮手（状态根、资源路径、浏览器恢复），没有一行落在这段字符串里；离它最近的是 `0001` 这次新加的 `:542`，紧挨着、不重叠。runner、Core、GUI 不认这段文字（`git grep '记忆提纯\|Start distilling'` 只命中文档与票面）。

**第 7 条 `memory/` 种子：只到新装用户与重置主对话的用户。**

7 个都是已有文件：`memory_management_sop.md`、`vision_sop.md`、`vision_api.template.py`、`L4_raw_sessions/compress_session.py`、`ljqCtrl_sop.md`、`macljqCtrl.py`、`ocr_utils.py`。`state-seed` 由 `build-managed-ga.sh` 重建，内容与上游逐行相同。种子只补缺（`core/src/managed_runtime.rs:407` `ensure_memory_seed`、`:438` `copy_missing_tree`）：新装用户拿到全部新版；重置主对话的用户拿到全部新版（`:213` `stage_memory_reset` 换回整份种子）；已装用户 7 个文件都已经有，一个也拿不到，L0 还是装的时候那份。`macljqCtrl.py` 与 `ocr_utils.py` 在打包 Python 里前后都用不了（没有 `numpy`、PyObjC，探针核过）。

**第 8 条 不进 Galley 的：确认不加载、不受影响；依赖没变。**

IM supervisor 只 import `wechatapp`、`fsapp`、`tgapp`、`dcapp` 与帮手；payload 里没有别的模块 import 这次改到的前端（`slash_cmds` 只被两个 TUI import）；`git grep` 在 runner、Core、CLI、脚本、GUI 里没有 `hub.pyw`、`service_manager`、`ga_cli`、`slash_cmds`、`cc_system_template` 的引用（`mykey_template.py` 只在外置引导文案里，文件还在）。`desktop_bridge.py` 只改两处注释，`_patch_chat_for_images` 没动，`run()` 仍不读 `task["images"]`（`agentmain.py` 零 diff）。`pyproject.toml` 零 diff，`scripts/bundle-python.sh` 不用改。`hub.connect` 常驻检查与上次相同。打包检查脚本只对 `desktop_bridge` 做 `find_spec`，不 import。

**第 9 条 外置耦合点：都还在。**

`agentmain.py` 零 diff（`list_llms`、`next_llm`、`put_task`、`run()`、`load_llm_sessions`、`mykeys_store.snapshot()`、`GenericAgentHandler` 的导入路径）；`BaseHandler.dispatch` 签名不变、仍不调 `tool_before_callback`（`agent_loop.py:18-30`）；`turn_end_callback` 与 `_turn_end_hooks` 不变（`ga.py:575`、`:598`）；`NativeClaudeSession.ask` 与 `backend.history`、`NativeToolClient.chat` 的 `backend.ask(merged)`、`response.thinking`、`reasoning_effort`、`auto_make_url` 不在上游 diff 里；IM 前端、`continue_cmd`、`chatapp_common`、`review_cmd`、`btw_cmd` 零 diff。第 14 条的 `ToolClient._parse_mixed_response` 挪进 `legacy_llmcore.py`，代码不变（`docs/ga-baseline.md` 已注明）。`GA_PATH=<d66509b 干净克隆> pytest runner/tests -m 'not e2e'` 657 passed。

**第 10 条 接缝镜像：没有会被代码或测试读到的旧名字或旧行号要改。**

`git grep` 了 `agent_loop.py:<行>`、`llmcore.py:<行>`、`ga.py:<行>`、`legacy_llmcore`、`hub.pyw`、`ToolClient` / `LLMSession` / `ClaudeSession`、`spec_from_file_location`，范围含 `.scratch/*/entry-layer-eval/`、`docs/devlog/deferred.md`、`docs/managed-ga-runtime/`、runner、Core、GUI。命中的行号都在注释、文档或测试用的示例字符串里（如 `runner/tests/test_ga_print_forward.py` 的 `llmcore.py:657` 是写死的样例），代码不读；陈旧的列进 Open risks。`docs/ga-baseline.md` 第 14 条与 5205f40 一节的 L0 记录已补注。另：`legacy_llmcore.py` 加进 `scripts/managed-ga-normalize-files.txt`（见下一节）。

### 3. 补丁栈

- 重导出（只动 hunk 头行号，补丁体不动）：`0002`、`0003`、`0008`；`0001` 的三个旧 hunk（`load_L1`、`get_global_memory`、`_write_llm_log`）也只动行号。
- 改了内容：`0001` 多一个 hunk（L0 路径）。做法：rebase 脚本先在 `a9a36b4` 重放、逐字节对上入库 payload、`rebase --onto d66509b` 无冲突、导出；再在脚本的工作库里改 `0001` 那个提交，其余 27 个重放上去，`--export-only` 导出。没有删补丁，没有新补丁，仍是 28 个。
- 构建名单：`scripts/managed-ga-normalize-files.txt` 加 `legacy_llmcore.py`。上游把带行尾空格的那一行（`user += "=== ASSISTANT ===\n" `）从 `llmcore.py`（在名单上）挪进了新文件，`git diff --check` 报错；加进名单后重建，干净。构建与 rebase 脚本共用这份名单。
- 重建后的 payload 对旧 payload：`code/` 与 `state-seed/` 共 28 个文件有变化（`hub.pyw` 改名算一删一加）。逐个比（两边都去行尾空格）：27 个与上游 `a9a36b4..d66509b` 的 diff 逐行相同（图片逐字节相同），`ga.py` 只差 `0001` 新加的那一行。改好 manifest 后又跑一遍 rebase 脚本（新旧都是 `d66509b`）：新栈逐字节对上 payload，导出的 28 个补丁与入库的逐字节相同。

### 4. 验证

| 命令 | 结果 |
|---|---|
| `./scripts/rebase-managed-ga-patches.sh d66509b… <干净克隆>` | 旧链对上 payload，rebase 无冲突，导出；改 manifest 后再跑一遍，补丁逐字节不变 |
| `./scripts/build-managed-ga.sh <干净克隆>` | 28 个补丁全部应用，`py_compile` 扫描 OK |
| `node scripts/check-managed-ga-payload.mjs` | OK |
| `node scripts/check-ga-baseline-drift.mjs --write` 再跑一次 | OK（`d66509bf`），`gui/src/lib/ga-baseline.gen.ts` 更新 |
| `GA_PATH=managed-ga/code .venv/bin/python -m pytest`（先打印 `runner.__file__`，是 worktree 的） | 657 passed，6 deselected（含新加 2 条） |
| `GA_PATH=<d66509b 干净克隆> .venv/bin/python -m pytest runner/tests/ -m 'not e2e'` | 657 passed，6 deselected |
| 对照 `GA_PATH=<旧 payload>` | 657 passed |
| `.venv/bin/python -m mypy runner` | 37 个文件无问题 |
| `.venv/bin/ruff check runner` | 通过；新测试文件按 `ruff format` 整篇格式化过 |
| `./scripts/bundle-python.sh mac-x64` | 新建 bundle 161M，内置冒烟 `managed GA import OK` |
| `./scripts/check-bundled-python-managed-ga.sh` | OK（它 `import agentmain`，`legacy_llmcore` 随之加载） |
| `cargo test --manifest-path core/Cargo.toml --workspace` | 退出码 0，47 组，1299 passed，0 failed |
| `pnpm --dir gui typecheck` | 退出码 0（`gui/node_modules` 从主树 APFS 克隆） |
| `node scripts/check-docs-links.mjs` | OK，493 个文件 |
| `git diff --check` | 干净 |
| 探针（打包 Python，`python -B`） | L0 表、三种 import 顺序、`claude_compat` 6 种请求、L1 拦截，结论见上；`managed-ga/` 下没有 `__pycache__` |

pytest 的第一条按票面不设 `GA_PATH` 时，conftest 会先找 `~/Documents/GenericAgent`（用户自己的检出），所以改用 `GA_PATH=managed-ga/code`。真模型请求没跑。

### 5. 改了的文件

- 基线记录：`managed-ga/manifest.json`、`gui/src/lib/ga-baseline.gen.ts`、`docs/ga-baseline.md`、`managed-ga/patches/manifest.md`、`docs/project-status.md`（三处：已审未发的基线一句，漂移门禁要求出现 `d66509b`；Unreleased 里「基线单开一轮」那句换成结果；「cannot read L0」那句注明已修）。
- 补丁：`managed-ga/patches/0001`（加一个 hunk 与行号）、`0002`、`0003`、`0008`（行号）。
- payload：`managed-ga/code/` 下 21 个（改名算一删一加；新增 `legacy_llmcore.py`、`service_manager.pyw`、`assets/cc_system_template.txt`，删 `hub.pyw`），`managed-ga/state-seed/memory/` 下 7 个。
- 构建名单：`scripts/managed-ga-normalize-files.txt`。
- 测试：`runner/tests/test_managed_ga_l0_path.py`（新）。
- 文档：`docs/devlog/2026-11-03-ga-upstream-upgrade-a9a36b4-to-d66509b.md`（新）、`docs/devlog/README.md`、本票报告。
- runner、Core、GUI 代码一行没改。`docs/ga-baseline.md` 的「Shipped in」照文档语言写成 `not yet; audited for v0.7.6 (after v0.7.5)`。

### 6. 看到但没改的（Open risks）

1. **GUI（要改 Galley 代码）**：模型调 `Bash` / `PowerShell` 时，工具药丸只有名字、没有图标和中文标签（`ToolCallout.tsx:466-475` 的 `TOOL_META`、i18n 的 `copy.tools` 都没有这两个名字），助理的脸判成「思考」而不是「干活」（`assistant-face.ts:118-121`），用 `Bash` 写 `galley todo add` 也亮不了「记一笔」。改法：GUI 把这两个名字当 `code_run` 的别名（`TOOL_META`、`copy.tools`、预览分支、`classifyTool`）。runner 不该改名，它发的是 GA 记下的原样。只有模型调了工具列表外的名字才会出现，开着 Claude Code 兼容（Kimi 预设）时更可能；升级前同样的调用画成未知工具，还报「未知工具」。
2. **行为变化**：飞书、Telegram、Discord 的提纯从「SOP not found. Do not update memory.」变成拿到 L0，这三个渠道写记忆可能变多（10-22 devlog 选项 A 写过的代价，当时 JC 没裁）。这次是修桌面断点顺带的；要保留三个渠道的旧行为，只能把这一行退回相对路径，那样也丢掉上游「不靠 cwd」的本意，不推荐。
3. **没真机走**（SOP 第 8 步）：主会话合入后在 JC 的 dev 里跑真实浏览器任务。L0 这一行只有模型调 `start_long_term_update` 时才走到（工具说明要求 15 步以上的任务做完时调），短任务碰不到；要实地看，得跑一个长任务，或在飞书 / Telegram / Discord 里让它记一件事。
4. **陈旧行号（注释与文档，代码不读，没改）**：`agent_loop.py:78` / `:79` 现在是 `:79` / `:80`（`gui/src/lib/assistant-face.ts:124`、`:130`，`gui/src/lib/assistant-face.test.ts:16`，`docs/ipc-protocol.md:195`）；`ga.py:599` 的兜底现在在 `:601` 一带（`gui/src/components/conversation/Conversation.tsx:1325`、`gui/src/i18n/locales/zh.ts:1740`、`gui/src/lib/step-heading.ts:51`、`docs/ga-baseline.md` 第 695 行一带）；project-status 的 `ga.py:538` 现在是 `:542`。`gui/src/lib/ipc/ga-output-cleaning.ts` 里的 `agent_loop.py:72/73` 早就不准了。
5. **已装用户拿不到新种子**：L0 新规则（错误与过时信息直接删、L2 只留文件指针）与另外 6 个种子文件，已装内置用户都拿不到（只补缺规则），只有新装与重置主对话的拿到。没改。
6. **`claude_compat` 走自由格式覆盖能设**：`half` 会多发一段 Claude Code 主提示词；`claude_compat: "off"` 同时 `fake_cc_system_prompt: true` 时 off 赢。界面不暴露，Galley 不改。
7. **上游行为**：仿 Claude Code 的 `Bash` 调用常带毫秒的 `timeout`（如 120000），`code_run` 超过 600 秒就拒跑、回报错，模型能重来。
8. **种子里的上游私人配置名**：`vision_sop.md` 写的默认配置是上游作者自己的（`native_oai_config_dsv4f_11`），内置的键是 `native_oai_config_<n>`，和以前一样要模型自己对上；只影响新装。
9. **门禁缺口（可选）**：`scripts/check-managed-ga-payload.mjs` 与 `check-managed-ga-app-bundle.mjs` 没要求 `legacy_llmcore.py` 存在；缺了它 `import llmcore` 就失败，打包冒烟会抓到，但 payload 检查不会。
10. **合并**：`docs/project-status.md` 的 Unreleased 段票 134 的分支也可能改，合入时可能冲突。
11. worktree 里留着被 gitignore 的 `gui/node_modules`（主树 APFS 克隆）与重建的 `core/python-bundle`；借主树 venv 的 `.venv` 符号链接用完已删，要复跑 pytest 得重新链上；scratchpad 里有旧 payload 副本 `gab01-old-managed-ga/`、上游克隆 `gab01-upstream/` 与探针 `gab01-probes/`。rebase 脚本在 `/tmp` 的两个工作库已删。

## Comments

- 2026-11-03 17:47–17:52（UTC+8），主会话在 JC 起的 tauri dev 里走真机：
  - runner 的 `--ga-path` 是仓库里的 `managed-ga/code`（新 payload）。
  - 内置工作台会话里一个浏览器任务（打开 example.com，读标题和第一段）：2 次 `web_execute_js`，答对；`d66509b` 引擎的浏览器路径通。
  - L0：让它调 `start_long_term_update` 并要求不写记忆。上游自己的门槛拦下了：第 10 轮之前调用一律回「start_long_term_update is only used after completing a long turn task!」（`managed-ga/code/ga.py:546`），读 L0 那一行照常执行，但结果被这句覆盖，看不到。模型随后自己用 `file_read` 从状态根读了 L0。所以「内置下提纯读到 L0」在真机上还没看到，要等一个跑满 10 轮的任务收尾时调用它（工具结果里有 `This is L0:`）；代码路径由报告里的打包 Python 探针与回归测试覆盖。
  - 记忆目录事前事后比哈希：只有 `file_access_stats.json` 变了（GA 读记忆文件时自己记的读取计数），其余 45 个文件不变。测试会话已永久删除。
