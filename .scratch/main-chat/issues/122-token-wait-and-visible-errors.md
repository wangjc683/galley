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

（代理填写）
