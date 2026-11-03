# 138 子任务带着这段对话出门

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 186 第 2 条（「少规矩、多手」的第三只手）。只对主对话派出的子任务；工作台会话、IM 渠道照旧；外置零变化（外置没有主对话）。

## 为什么

- 子任务现在是一个看不见主对话的新会话（`core/src/subtask.rs` 的 `dispatch_reply`：照普通内置会话经 Core 的发送起跑，第一条消息就是派活说明）。
- 入口层条款有好几句在补这一点：派活说明要写全目标、用户给的事实、这段对话定下的、已查到的（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）；「把我们聊的整理成文件」不能派，因为子任务看不见这段对话；追问派出去时前文要抄进说明（裁决 185 第 5 条）。说明漏一句，子任务就做偏。
- 方向（裁决 186）：交出去不丢上下文，派活就便宜，条款也就短。

## 要做到

1. **带什么**：主对话派出子任务的那一刻，把主对话最近几轮作为只读背景交给这件子任务。取法与截断复用开新段时的做法（`core/src/session_runner/carry.rs`：`CARRY_TURNS` 10 轮、`CARRY_MAX_CHARS` 15,000 字、`CUT_MARKER`），只取当前段。子任务的标签与派活说明不算在背景里重复一遍。
2. **放在哪**：放在子任务自己的上下文里，不当成子任务的对话：
   - 工作台里看这件子任务，第一条用户消息仍是派活说明，背景不画出来（或者只在你决定的某个不打眼的地方，写理由）；
   - 不能让它以为自己就是主对话、去对用户说话；它交回的东西仍照派活说明，交回给 Galley；
   - 放在运行时提示词的一节，还是首条消息前的注入，由你定，写理由；配给它的说明一两句，英文，说清这是派活那一刻用户与 Galley 的对话、只读、以派活说明为准。
3. **存快照**：派活那一刻取好存下，子任务冷启动、重启续跑、被送回重做时用同一份，不在重启时重取（那时主对话已经往前走了）。存哪里由你定（`subtask_dispatches` 加一列、或别处），新迁移记得 `core/tests` 4 处、`cli/tests` 2 处手写的迁移列表都要补，验证必须 `--workspace`。
4. **不改主对话条款**：入口层派活一段与手册 `subtasks.md` 留给票 139 一起收。子任务这头新加的说明文字按第 2 条，要短。
5. **量一下**：只读查真实的 `workbench.db`，量主对话近两周每次派活时「最近 10 轮、15,000 字以内」实际多大（字数中位、最大），写进报告，估一下每件子任务多花的 token。
6. **Agent API**：`session show` 等命令若因此多出字段，只加不改（宪法 Rule 3）；能不暴露就不暴露。

## 怎么做

- 先读：`AGENTS.md`（宪法）；`docs/architecture.md` 主对话分段与子任务两节；`core/src/subtask.rs`、`core/src/subtask_report.rs` 文件头；`core/src/session_runner/carry.rs`；`core/src/managed_prompt.rs` 里内置会话的提示词怎么组（子任务是普通内置会话）；`docs/managed-ga-runtime/runtime-modes-and-sessions.md`。
- 先在本文件写「## 设计」一节（取法、放在哪、快照存哪、冷启动与送回重做、GUI 有没有变化），然后直接实现。要动 GUI 才能把背景藏好时先停下回报。
- 同时在跑的还有票 134 第四轮（改 `managed_prompt.rs` 主对话入口层与 `runner/handlers.py`）和票 136（插话改道，改 `session_send.rs`、`message_queue.rs`、runner 与 GUI）。尽量别碰这些地方；碰了在报告里写明，合入时我来对。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

改到 runner 就加 `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`；改到 GUI 就加 `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui exec vitest run`。

测试至少覆盖：派活时取到快照、截断照 `carry.rs`；子任务第一次起跑时模型看得到背景；冷启动、重启后用的是同一份快照；工作台会话、手动开的会话不带背景。真模型真机我在合入后的 dev 里走，代理不跑 `tauri dev`。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t138-subtask-carries-the-chat <scratchpad>/wt-138 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 真实数据库只读；不写内置 / 外置 GA 的状态。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。Windows CI 检出是 CRLF：Rust 原始字符串里的提示词，contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t138-` 前缀命名。票面与文档里不写本机用户目录、worktree 路径、服务商名、接口主机；量出来的数字只写字数与轮数，不抄对话原文。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：设计要点；第 5 条量的数；改了哪些文件；测试与验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。
