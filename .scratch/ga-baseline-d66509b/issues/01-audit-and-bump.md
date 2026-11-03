# 01 GA 基线 a9a36b4 → d66509b：审计、补丁栈重放、重建内置 GA

Status: ready-for-agent

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
