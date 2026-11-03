# 142 模型在调工具那一步写给你的话，工具开跑之前就送到你面前

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 191。只在内置运行时的主对话；外置零变化（外置没有主对话）。

## 为什么

- 11-03 dev 真机：你让它「每隔 20 秒看一次下载文件夹，看 3 次」，15 秒后插话「还要多久？」。插话在第 1 步后送到（票 136）；模型没调 `tell_user`（票 137），把「还需要约 1 分钟……」写在调工具那一步的正文里（`<summary>` 之外）。那一步要等工具跑完（60 秒）才落库，主对话又不把步骤正文画成气泡，你问完 87 秒后才从最后的回复里知道。
- 票 137 评测「还要多久」那条用例 9 遍里 7 遍同样（`.scratch/main-chat/entry-layer-eval/tell-user/results.md`）。模型天然会边调工具边跟你说话，以为你看得到。
- 裁决 191：让它本来就做的事管用。`tell_user` 留着。

## 第一步：先量（只读），不够格就停

只读查真实库（`~/Library/Application Support/app.galley/workbench.db`，`sqlite3 -readonly`），主对话（`sessions.main_chat = 1`）10-20 起：

1. 你发起的那些轮（一轮的开头是 `sequence = 0` 的 user 行，且不是 `[Galley — not a message from the user]` 开头的叫醒），没结束的步骤（一轮里最后一步以外、带工具调用的 assistant 行）有多少；其中 `<summary>` 之外（也去掉 `<next-suggestion>`、`<subtask>` 这类标签，照回复的清洗规则）还有字的有多少。
2. 有字的那些，逐条判：像是对你说的话（「我来查一下……」「还需要约 1 分钟」「好，只数 PDF」），还是自言自语、给自己记的（「先读手册」「检查语法」「重新发送命令」），还是别的。数各类的条数与占比。
3. **门槛**：对你说的话不到八成，就停在这里，把数字与分类写进报告回给主会话，不实现。

**隐私**：这些是 JC 主对话里的真实文字。票面与报告里不抄原文；只写形状与类别，举例用虚构的、不含人名地名金额路径的句子并标明虚构。会话 id、消息 id 不写进票面。

## 第二步：实现（过了门槛才做）

1. **什么字**：主对话里、你发起的那一轮（你发的话或插话开启的运行）中，模型某一步的回复带工具调用、又在 `<summary>` 之外写了字（照回复的清洗规则洗过后不空），这段字在模型这次回复收完、工具开跑之前，就当作「先说的一句」送到你面前。
2. **不送的**：
   - Galley 自己醒来的那几轮（子任务叫醒、到点提醒、巡看）：那几轮可能以 `<no-reply/>` 收尾，不能中途漏话。Core 知道这一轮是谁开的。
   - 这一轮最后的回复那一步：照现在的回复画法。
   - 同一步里又调了 `tell_user` 的：只送 `tell_user` 那句，不重复。
3. **落库与画法**：沿用票 137「先说的一句」：同一个 `turn_index`、`sequence` ≥ 2 的 assistant 行，画成左侧气泡，点点与进展小字在它下面接着跑；不单发通知、不算「回复完成」。手机照样收到。
4. **回放**：冷启动回放时模型看到的仍是它当时写的那一遍，不能因为多了一行而看到两遍（那段字已经在那一步的内容里）。怎么做由你定（比如这一行回放时跳过，或那一步回放时去掉这段），写进设计。
5. **在哪接**：最早拿到「这次回复收完、工具还没跑」的地方。看 `runner/handlers.py` 的 `WorkbenchHandler.dispatch`（工具开跑前、手里有这次回复）与票 137 的 `runner/tell_user.py`、`workbench_bridge.py` 怎么发 `tell_user` 事件；尽量复用那条事件与 Core、GUI 的整条路，不另开一套。
6. **评测或测试**：单测覆盖：你发起的一轮里带字的步骤送到、在工具开跑之前；叫醒的一轮不送；最后一步不送；同一步 `tell_user` 不重复；回放不重复。真模型不必另跑评测（这是确定的画法），票 139 合入后主会话在 dev 里走。

## 怎么做

- **先读**：`AGENTS.md`（宪法）；票 136、137 的「设计」与「报告」（插话与「先说的一句」的落库、`sequence`、回放、GUI 画法）；裁决 186、189、191；`docs/design/conversation.md` 主对话一节。
- 第一步的数字写进本文件「## 量」一节；过了门槛再写「## 设计」一节，然后实现。
- 同时在跑：票 139（改 `core/src/managed_prompt.rs` 主对话入口层、删 `runner/handlers.py` 里票 135 的硬闸、改手册与评测）。你可能也要动 `handlers.py` 的 `dispatch`：只加你的那一段，别碰硬闸那几行；合入时我来对，报告里写明碰了哪些地方。

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

worktree 里跑 runner 测试借主树的 venv，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。import `managed-ga/code` 的探针都用 `python -B`。

## 环境与边界

- 第一步只读，不需要 worktree；过了门槛再建：
  ```bash
  cd <主树>
  git worktree add -b t142-step-text <scratchpad>/wt-142 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  pnpm --dir <wt>/gui install
  ```
- 绝不碰主工作树的代码（JC 的 `tauri dev` 常驻在主树）；不跑 `tauri dev`；不写数据库。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。GUI 不是 prettier-clean：旧文件只格式化自己的 hunk。
- 只停在第一步时：在主树只提交本票文件（`git add <本票> && git commit …`，提交前 `git status` 确认没带上别人的改动）。实现时：在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t142-` 前缀。票面里不写本机用户目录、worktree 路径、服务商名、接口主机。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：第一步的数字与分类（不抄原文）、过没过门槛；过了的话：设计要点、改了哪些文件、测试与验证结果（数字照抄命令输出）、提交号（照抄 `git log --oneline -1`）、看到但没改的（Open risks），原样列出。
