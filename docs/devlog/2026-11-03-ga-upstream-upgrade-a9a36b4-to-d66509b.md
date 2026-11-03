# GA 上游升级 a9a36b4 -> d66509b

**日期**：2026-11-03
**上下文**：v0.7.5 发版时跳过的基线升级，单开一轮（票 `.scratch/ga-baseline-d66509b/issues/01-audit-and-bump.md`）。上游 `main` 在
`git ls-remote` 时是 `d66509b`（11-03 17:04），锁定它，不追之后的提交。中间经过 `e4d956f`（v0.7.3–v0.7.5 发版时上游所在的提交）。目标 v0.7.6。

## 范围形状

`a9a36b4..d66509b` 共 29 个提交（含 1 个合并），27 个文件，+786 / −307，全部出自上游作者。

- 引擎核心：`llmcore.py` +13 / −140 与新文件 `legacy_llmcore.py` +145（文本协议拆出去）、`ga.py` +4 / −2、`agent_loop.py` +1。
  `agentmain.py` 与根目录 `pyproject.toml` 零 diff，`GA_DEPS` 不用动。
- Galley 不加载的：`frontends/` 下 conductor、hub、hub_p2p、p2p_ws_client、desktop_bridge（两处注释）、slash_cmds、tui_v3、tuiapp_v2，
  `ga_cli/cli.py`，`hub.pyw` 改名 `service_manager.pyw`，`assets/` 的群二维码、`configure_mykey.py`、新模板 `cc_system_template.txt`，
  `mykey_template*.py`，`README.md`。
- `memory/` 种子 7 个文件。

补丁触及的文件里，上游改了 `llmcore.py` 与 `ga.py`。补丁 `0001` 要加一行，其余只动行号。

结论：只有一处断点，就是 L0 路径（下一节），在 `0001` 里修；其余在两种模式下都不断。Galley 代码一行不改，只加一个测试，构建用的去行尾空格名单加一行。

## L0 路径：内置下改到状态根（`1a44b3f`，补丁 `0001`）

`do_start_long_term_update` 把 L0（`memory/memory_management_sop.md`）交给模型，找不到就回「Memory Management SOP not found. Do not update memory.」。
上游把这一行从相对进程 cwd 的 `./memory/…` 改成 `os.path.join(script_dir, 'memory', …)`，也就是代码目录旁边。

内置运行时的代码目录里没有 `memory/`：`build-managed-ga.sh` 拷代码时排除它，种子另放 `managed-ga/state-seed/memory/`，
装到状态根（`GALLEY_GA_STATE_ROOT`）。`0001` 原来没管这一行，旧版是靠 cwd 碰巧对上：

- 桌面会话：Core 起 runner 时不给 cwd（`core/src/session_runner/spawn_config.rs:160`），bridge `chdir` 到状态根（`runner/workbench_bridge.py:722-728`），读得到。
- 微信：supervisor 停在状态根（`runner/managed_im_supervisor.py:372`），读得到。
- 飞书、Telegram、Discord：import 前端后 `chdir(state_dir)` 进了 `im/<platform>`（同文件 `:519`、`:641`、`:758`），读不到。这是 10-22 记下的老问题。

不加 hunk 直接升级，内置下所有入口都会变成「not found」，记忆提纯整个关掉，而且不报错。修法：`0001` 给这一行加一个 hunk，
改成 `state_path('memory', 'memory_management_sop.md')`，行尾注释写原因（`managed-ga/code/ga.py:542`）。一行换一行，下面的 hunk 不挪位。

用打包 Python（`python -B`，不发请求）在三份代码上跑 `do_start_long_term_update`，`current_turn` 设成 10：

| 代码 | 桌面 / 微信（cwd = 状态根） | 飞书 / Telegram / Discord（cwd = `im/<p>`） | cwd 在别处 |
|---|---|---|---|
| 旧 payload（`a9a36b4`） | 读到 L0 | not found | not found |
| `d66509b` 不加这个 hunk | not found | not found | not found |
| 新 payload | 读到 L0 | 读到 L0 | 读到 L0 |

外置用上游干净克隆、不设状态根跑同一个探针：`a9a36b4` 只在 cwd 是 GA 目录时读到，`d66509b` 在哪都读到。

所以这次之后三个渠道的提纯也读得到 L0 了，10-22 devlog 里的选项 A 随这次升级落地。代价那时就写过：这三个渠道写记忆可能变多。
没选的做法：把这一行退回旧的相对路径。那样桌面行为不变，但三个渠道的老问题还在，也和上游「不靠 cwd」的本意反着来。

外置运行时按上游本意，读用户自己 GA 目录下的 L0，Galley 不管；而且不再依赖 bridge 落在 GA 目录。

回归测试：`runner/tests/test_managed_ga_l0_path.py`，子进程里带状态根跑这个工具，cwd 分别在状态根与 `im/feishu`。
指向不加 hunk 的代码时两条都红，指向新 payload 时都绿。

## `llmcore.py` 拆分（`4ca9028`）

`ClaudeSession`、`LLMSession`、`ToolClient`（文本协议）挪进 `legacy_llmcore.py`。它 `import llmcore` 后定义三个类，在文件尾把名字挂回 `llmcore`；
`llmcore.py` 末尾 `try: import legacy_llmcore`（`managed-ga/code/llmcore.py:1401`）。

- 挪走的代码与原来逐行相同，只是引用 `llmcore` 的名字加了 `llmcore.` 前缀（脚本比对：127 行对 127 行）；`legacy_llmcore.py` 里没有未定义的名字。
- 9 个改 `llmcore.py` 的补丁（`0001`、`0002`、`0007`、`0008`、`0016`、`0017`、`0021`、`0027`、`0030`）没有一个 hunk 落在挪走的代码里。
  `0001`、`0002`、`0008` 的 hunk 在拆分点下面，只动行号；其余在上面，不动。挪走的类调用的 `_write_llm_log`（`0001`）、`tryparse`（`0002`）、
  `_parse_claude_sse`（`0016`、`0017`、`0030`）、`_stream_with_retry`（`0021`）、`auto_make_url`（`0027`）都留在 `llmcore`，
  经 `llmcore.` 在调用时取，补丁照样生效。
- 循环 import：runner 先在 `install_managed_mykey_loader` 里 `import llmcore`（`runner/managed_runtime.py:200`），再 `import agentmain`，
  模块名都是顶层 `llmcore`。探针按三种顺序（runner 的顺序、外置先 `agentmain`、先 `legacy_llmcore`）各起一个进程：
  `sys.modules` 里只有一份 `llmcore`，`llmcore.ToolClient`、`agentmain.ToolClient` 都是 `legacy_llmcore` 里的那个；
  `native_claude` / `native_oai` 建出 `NativeToolClient`，`claude_config` / `oai_config` 与混合会话建出 `legacy_llmcore.ToolClient`；
  走内置加载器的 `GeneraticAgent()` 只有两个原生客户端。
- 内置不会走 legacy：Galley 生成的键只有 `native_claude_config_<n>` 与 `native_oai_config_<n>`（`runner/managed_runtime.py:134`、`:136`）。
  外置用户的 mykey 有非 native 条目时，上游每次重建客户端打一行 `[Legacy] …`（`llmcore.py:1387`）。runner 的 fd 1 接 /dev/null，
  `sys.stdout` 只把 `Backend Error`、`[LLM Retry]` 开头的行转给 stderr（`runner/ga_print_forward.py:27`），这一行丢掉，不进 IPC；
  设置页的 GA 探针取最后一行 `{` 开头的 JSON（`core/src/runner_commands/probe.rs` `parse_probe_output`），也不受影响。
- 测试与评测的加载器（`runner/tests/test_managed_ga_llmcore.py`、`.scratch/main-chat/entry-layer-eval/run.py`）都按顶层名 `import llmcore`，不用改。

## `claude_compat`（`be17b0a`）

`fake_cc_system_prompt` 换成三档的 `claude_compat`（`off` / `simple` / `half`），旧键映射成 `simple`。Galley 会设旧键：Kimi 预设
`fake_cc_system_prompt: true`（`gui/src/lib/managed-model-presets.ts:177`），设置页也有这个开关；从不设 `claude_compat`
（只有自由格式的高级覆盖能写进去，界面不暴露）。探针在新旧 payload 上拦下 `NativeClaudeSession.raw_ask` 的请求体：
不设键、`fake_cc_system_prompt` 真、假，各配空与非空的 system，请求体与请求头（去掉随机的会话 ID 与 metadata）新旧逐字节相同。

## `Bash` / `PowerShell` 映射到 `code_run`（`5ec4b12`）

`BaseHandler.dispatch` 开头把这两个名字改成 `code_run`，`command` 当脚本（`managed-ga/code/agent_loop.py:19`）。以前模型叫 `Bash` 得到「未知工具」，现在真跑。

- `WorkbenchHandler.dispatch` 不改派发，只在有 `do_<名字>` 时补发 turn_start（`runner/handlers.py:140`）。`Bash` 没有，这一步不补发；
  第 1 步由派发命令先发、第 N+1 步由上一步结束时预发（`runner/workbench_bridge.py:1690`、`:1593`），不缺。和升级前一样。
- 记录里的工具名是 `Bash`、参数是 `command`（`agent_loop.py:71`，改名生成的是新字典），runner 原样发 `toolName`（`runner/workbench_bridge.py:1602`）。
  Core 写库只按 `no_tool` 判最后一步（`core/src/turn_persistence/mod.rs:101`），不按其他名字推导。文件路径只认 `file_write` / `file_patch`，`code_run` 本来也不认。
- GUI：`Bash` 不在 `TOOL_META` 里（`gui/src/components/conversation/ToolCallout.tsx:466`），画成只有名字的药丸，参数预览走默认分支，显示 `command`（`:774`），
  这是给未知工具设计好的样子，不会画坏；助理的脸把它判成「思考」而不是「干活」（`gui/src/lib/assistant-face.ts:118-121`），
  用 `Bash` 写 `galley todo add` 也亮不了「记一笔」。这张票不动 GUI，记进待办。
- IM 前端与外置都用上游自己的 handler，没有覆盖 `dispatch`。

## L1 整篇写入拦截（`754acfd`）

`do_file_write` 路径里含 `global_mem_insight.txt` 就报错，按子串判断，和目录无关。探针在状态根下：`../memory/global_mem_insight.txt` 与绝对路径，
覆盖、追加都被拦；`file_patch` 照常改；写 `temp/notes.txt` 照常。Galley 的手册、`managed_prompt.rs`、补丁里没有让模型整篇写 L1 的话。

## 记忆提纯提示词（`4ca9028`）

改了一句：去掉「不得为缩短而丢失关键事实、适用条件和踩坑信息」，加「非必要不可增加触发词」。Galley 没有补丁改这段（`0001`、`0003`、`0006` 在 `ga.py` 的 hunk 都不在这里），
runner、Core、GUI 不认这段文字。裁决 161、163 动的是手册与 L2，不在这里。

## `memory/` 种子

7 个文件都是已有文件：`memory_management_sop.md`（错误与过时信息直接删、L2 只留精华与文件指针、少加触发词）、`vision_sop.md` 与
`vision_api.template.py`（默认不缩图）、`L4_raw_sessions/compress_session.py`（同名文件加后缀、历史行去重），以及 `e4d956f` 那段的
`ljqCtrl_sop.md`、`macljqCtrl.py`（进程内 Quartz 截图）、`ocr_utils.py`（macOS 默认用系统 OCR）。

种子只补缺（`core/src/managed_runtime.rs:438` `copy_missing_tree`）：新装用户与重置主对话的用户（`stage_memory_reset` 换回整份种子）拿到新版；
已装用户 7 个文件都已经有，一个也拿不到，`memory_management_sop.md` 还是装的时候那份。外置用户自己 `git pull` 时拿到。
`macljqCtrl.py` 与 `ocr_utils.py` 在打包 Python 里前后都用不了（没有 `numpy`、PyObjC）。`vision_sop.md` 里的默认配置名是上游作者自己的，内置的键是 `native_oai_config_<n>`，和以前一样要模型自己对上。

## 不进 Galley 的

IM supervisor 只 import `wechatapp`、`fsapp`、`tgapp`、`dcapp` 与它们的帮手，runner 只按名字取 `btw_cmd` 等；没有进程 import 这次改到的前端、`ga_cli` 或 `service_manager.pyw`。
`desktop_bridge.py` 只改两处注释，附加模式图片接缝的参照 `_patch_chat_for_images` 没动，`run()` 仍不读 `task["images"]`，`0008` 与外置的包装都留着。
`cc_system_template.txt` 只在 `claude_compat` 为 `half` 时读。`hub.connect` 的常驻检查与上次相同（`agentmain.py --reflect`、`desktop_bridge.py`、`stapp.py`、`hub.py` 本身）。

## 外置运行时的耦合点

`docs/ga-baseline.md` 列的耦合点在 `d66509b` 上都还在：`agentmain.py` 零 diff（`list_llms`、`next_llm`、`put_task`、`run()`、`load_llm_sessions`、`GenericAgentHandler` 的导入路径），
`BaseHandler.dispatch` 签名不变、仍不调 `tool_before_callback`，`turn_end_callback` 与 `_turn_end_hooks`（`ga.py:598`）不变，
`NativeClaudeSession.ask` 与 `backend.history`、`NativeToolClient.chat` 的 `backend.ask(merged)`、`response.thinking`、`reasoning_effort`、`mykeys_store`、`auto_make_url` 不变；
IM 前端、`continue_cmd`、`chatapp_common`、`review_cmd` 零 diff。第 14 条提到的 `ToolClient._parse_mixed_response` 挪进了 `legacy_llmcore.py`，代码不变。
runner 测试用 `GA_PATH=<d66509b 干净克隆>` 跑，657 passed。

## 补丁栈重放

1. `rebase-managed-ga-patches.sh d66509b <干净克隆>`：在 `a9a36b4` 上重放现有 28 个补丁，逐字节对上已入库的 payload；`rebase --onto` 到 `d66509b`，没有冲突。
   导出后变的只有 `0001`、`0002`、`0003`、`0008` 的 hunk 头行号，补丁体一行不动。
2. 在脚本的工作库里改 `0001` 那个提交（`ga.py` 那一行），其余 27 个提交重放到它上面，再 `--export-only` 导出。
   `0001` 多了一个 hunk（`@@ -520 +524 @@`），其他补丁与第 1 步一样。
3. 改 `managed-ga/manifest.json` 的 `upstream`，`build-managed-ga.sh <干净克隆>`：28 个补丁全部应用，`py_compile` 全量扫描通过。
   `git diff --check` 报 `legacy_llmcore.py` 一处行尾空格、文件尾多一个空行：这一行原来在 `llmcore.py` 里，那个文件在去行尾空格的名单上。
   把 `legacy_llmcore.py` 加进 `scripts/managed-ga-normalize-files.txt`（构建与 rebase 脚本共用这份名单），重建，`git diff --check` 通过。
4. 重建后的 payload 相对旧 payload，`code/` 与 `state-seed/` 共 28 个文件有变化（改名算一删一加），逐个比对（两边都去掉行尾空格）：27 个与上游 `a9a36b4..d66509b` 的 diff 逐行相同，
   `ga.py` 只差 `0001` 新加的那一行；图片逐字节相同。
5. 改好 manifest 后再跑一次 rebase 脚本（新旧都是 `d66509b`）：新补丁栈在干净克隆上重放，逐字节对上入库的 payload，导出的 28 个补丁与入库的逐字节相同。

`deferred.md` 里挂在基线升级上的启动信号都没触发：`0023`、`0024`、`0026`、`0008` 没有冲突，上游没改 `auto_make_url`，`run()` 仍不读图片。

## 验证

- runner（借主树 `.venv`，先确认 `runner.__file__` 在 worktree）：`GA_PATH=managed-ga/code pytest` 657 passed（6 deselected，含新加的 2 个）；
  兼容矩阵 `GA_PATH=<d66509b 干净克隆> pytest runner/tests -m 'not e2e'` 657 passed；对照 `GA_PATH=<旧 payload>` 657 passed。`mypy runner`、`ruff check runner` 通过。
- 打包：`pyproject.toml` 零 diff；`bundle-python.sh mac-x64` 新建 bundle，`check-bundled-python-managed-ga.sh`：`managed GA import OK`（它 import `agentmain`，`legacy_llmcore` 随之加载）。
- `check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs --write` 之后的 `check-ga-baseline-drift.mjs` 通过（`gui/src/lib/ga-baseline.gen.ts` 随之更新），`pnpm --dir gui typecheck` 通过。
- `cargo test --manifest-path core/Cargo.toml --workspace` 通过（Core 用 `include_str!` 嵌 `managed-ga/manifest.json`，种子与 payload 卫生测试读 `managed-ga/`）。
- `check-docs-links.mjs` 通过，`git diff --check` 通过。
- 探针（打包 Python，`python -B`，不花额度，脚本在 scratchpad）：L0 表、三种 import 顺序、`claude_compat` 请求体比对、L1 拦截。跑完 `managed-ga/` 下没有 `__pycache__`。

## SOP 第 8 步：在 tauri dev 里走

这张票不跑。合入后主会话在 JC 的 dev 里跑一个真实浏览器任务（内置，桌面）。L0 那一行只有模型调 `start_long_term_update` 时才走到（工具说明要求 15 步以上的任务做完时调），
一个短任务碰不到；要实地看，得跑一个长任务，或在飞书 / Telegram / Discord 里让它记一件事。

## 起源纪律

29 个提交都出自上游作者（Liang Jiaqing / ljq）。`git log -S`：L1 拦截出自 `754acfd`（10-31），`claude_compat` 出自 `be17b0a`（10-31），
`Bash` 映射出自 `5ec4b12`（11-02），拆分出自 `4ca9028`（10-30），L0 路径出自 `1a44b3f`（11-03）。本次没有「上游吸收了 Galley 能力」这类说法，补丁一个不删。
