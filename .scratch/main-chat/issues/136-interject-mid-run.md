# 136 插话改道：主对话跑着时你说的话，下一步就送到它面前

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 186 第 2 条（「少规矩、多手」的第一只手）。只在内置运行时的主对话；工作台会话、子任务、IM 渠道照旧排队；外置零变化（外置没有主对话）。

## 为什么

- 主对话一次只能做一件事。它跑着的时候（含叫醒、到点提醒、巡看那几轮），你发的话进 Core 的队列，等这一轮跑完才一条一轮地发出（裁决 71 第 4 条；`core/src/message_queue.rs` 文件头）。连发三句是三轮三条回复；「上海的」「算了，查后天」这类补充与纠正，要等前一件做完它才看到。
- 方向（裁决 186）：不再靠条款限制它做什么来避免占住主对话，而是让你随时够得着它，由它自己决定怎么办。真人助理在 IM 上就是这样：你补一句、改一句，它下一刻就看到。

## 要做到（行为）

1. **送进正在跑的那一轮**：主对话有一轮在跑时，你发的文字不进队列，经 runner 设上游的 `intervene`（`managed-ga/code/ga.py:594`：每一步结束时读 `self.parent.intervene`，以 `[MASTER] …` 拼进下一步的提示，读完清空），这一轮的下一步就看到。
2. **送进去的那段话**要让模型知道这是用户在它干活时新发的话，由它决定接着做、改方向，还是把手上的交给子任务、先回他。只写这个意思，不加规则；一两句，英文，与入口层的写法一致。
3. **同一步里到了几句**：按发出顺序合成一段，同一次送进去。
4. **送不进去就退回**：这一轮在它读到之前就结束了（比如正在写最后的回复），这句照旧作为下一轮发出；不丢、不重复、不漏进下一轮的第一步（runner 在一轮结束时清掉没读的 `intervene`，并告诉 Core 哪几句没送到）。
5. **照旧的**：带图片的发送、`/btw`、有待回答的 `ask_user` 时的发送（那是回答）、停止键、停止中的排队，行为不变。
6. **所有走 Core 发送的入口一致**：GUI、CLI（`galley session send` 发给主对话）、手机。`session send` 的返回值如有变化只能加不能改（宪法 Rule 3；`docs/agent-api/stability-and-versioning.md:105` 的 `dispatch` 取值，`queued` 当年是按加法加进来的）。
7. **界面照 IM**：
   - 你发出去的话马上作为你的气泡落在对话底部，不进输入框上方的队列条；
   - 它做事的进展小字（裁决 135）挪到你这句下面，接着跑；
   - 这一轮的回复落在你这句之后，一条回复回应全部；过程卡片仍挂在这条回复下，含插话前后的所有步骤（一轮一张）；
   - 退回作为下一轮时看起来一样：你的气泡已经在，下一轮的回复跟在后面；
   - 工作台会话的队列条与排队照旧。
8. **落库与回放**：对话里的顺序是你发出的顺序。冷启动回放给模型的历史要和它当时看到的一致（插话出现在它读到的那一步之后），不能拼成接口不接受的形状（比如连着两条 user 消息）。手机端（`remote-protocol/`）收到的消息形状若受影响一并处理。

## 怎么做

- **先读**：`AGENTS.md`（宪法，尤其 Rule 1、3、5）；`docs/architecture.md`「How a user message is sent」与队列、运行闸门各节；`docs/ipc-protocol.md`；`docs/adr/0003-gui-and-phone-send-through-core.md`；`docs/agent-api/session-commands.md` §5.5a 与 `stability-and-versioning.md`；`core/src/session_send.rs`、`core/src/message_queue.rs`、`runner_manager` 的队列；runner 里用户消息怎么到 GA、轮次结束的钩子（`runner/ga_session.py`、`runner/handlers.py` 里主对话的 `GALLEY_MAIN_CHAT` 标记是现成的识别办法）；`managed-ga/code/ga.py:585-600`；GUI 主对话的画法（`gui/src/lib/assistant-conversation*`、`run-groups`、队列条）。
- **先设计再实现**：在本文件写「## 设计」一节（数据流、落库与顺序、回放、退回的竞态、Agent API 与 IPC 的改动、GUI 画法），然后直接实现，不用等主会话。遇到下面任一情况先停下回报，不要自己定：
  - 要改 Agent API 已有字段的含义（只加不改）；
  - 第 7 条的画法做不到，或做到要牺牲别处已定的画法（`docs/design/` 里主对话一节）。
- 要新开迁移可以，记得 `core/tests` 4 处、`cli/tests` 2 处手写的迁移列表都要补，验证必须 `--workspace`。
- **宪法 Rule 1**：`intervene` 是 GA 自己的属性，只在内置运行时的主对话里设；外置永远不设。写进设计一节。
- 更新 `docs/architecture.md`、`docs/ipc-protocol.md`、`gui/src/types/ipc.ts` 镜像（Core 侧新增的 IPC 命令、事件也要进镜像）、Agent API 文档（若 `session send` 的返回有新值）。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
node scripts/check-docs-links.mjs
git diff --check
```

测试至少覆盖：主对话跑着时发送 → 发给 runner、不进队列；同一步几句合成一段；没送到的退回、恰好跑一次；工作台会话照旧排队；带图片照旧；runner 一轮结束清掉没读的 `intervene` 并上报；GUI 的顺序与进展小字的位置。真模型真机我在合入后的 dev 里走，代理不跑 `tauri dev`。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树，改主树的 `core/` 会让它重编、重启 Core）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t136-interject-mid-run <scratchpad>/wt-136 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  pnpm --dir <wt>/gui install
  ```
- 不写 Galley 的真实数据库，不写内置 / 外置 GA 的状态；真实数据库只读。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。GUI 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可整篇。Windows CI 检出是 CRLF：Rust 原始字符串里的提示词，contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t136-` 前缀命名。票面与文档里不写本机用户目录、worktree 路径、服务商名、接口主机。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：设计要点；改了哪些文件；测试与验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。
