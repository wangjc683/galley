# 137 先说一句：主对话在一轮中间先回你一句，不结束这一轮

Status: ready-for-agent（2026-11-03 票 136 已合入）

来源：[主对话 PRD](../PRD.md) 裁决 186 第 2 条（「少规矩、多手」的第二只手）。只在内置运行时的主对话；外置零变化（宪法第 1 条：外置 GA 不打补丁、不加工具）。

## 为什么

- 有了插话改道（票 136），你在它干活时说的话，下一步就送到它面前。但 GA 一轮只出一个回复：它想先回你，只能把手上的交出去，或者结束这一轮。选项太少，它就容易闷头做完，你还是在等。
- 真人助理会边查边回你一句：「记上了，天气还在查」。
- 136 的 dev 真机（票面 Status 行）：插话「只数 PDF 和图片就行」在第 1 步后读到，第 2 步改了方向；它没有先回一句，因为现在没有这只手。

## 要做到

1. **一个工具**：给主对话一个「先给用户发一句话」的工具，这一轮不结束、接着做。只在主对话里有（runner 已经认得主对话：`GALLEY_MAIN_CHAT` 环境变量，`runner/handlers.py`；Core 在 `core/src/runner_commands.rs` 设）；工作台会话、子任务、IM 渠道、外置都没有这个工具。
   - GA 的工具在 `managed-ga/code/assets/tools_schema.json` / `tools_schema_cn.json` 里声明，`managed-ga/code/ga.py` 里 `do_<name>` 实现（参照 `do_ask_user`，`ga.py:353` 一带）。按 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的补丁规则做：最小、隔离、可重放，编号接现有最后一个之后；先看有没有更小的扩展缝（比如 runner 的 handler 子类那一层就能加），有就用，写理由。
   - 名字、参数由你定：一个参数，给用户的一句话（或一小段）。
2. **工具说明**：只讲它是什么、什么时候有用（用户在你干活时说了话；手上的事要做很久，用户该知道进展），不加规则。一两句，英文，和 GA 工具说明的写法一致；中文 schema 照现有做法配中文。
3. **落库与画法**：这句落成主对话里的一条 Galley 消息，画成气泡，落在它说出来的位置（插话之后、这一轮后面的步骤之前）；思考的点点与进展小字挪到它下面接着跑；这一轮最后的回复照常落在后面。落库顺序沿用票 136 的 `sequence` 做法（同一个 `turn_index` 里排序），冷启动回放给模型的历史要和它当时的一致：它说过这句。手机端照样收到（`remote-protocol/`）。
4. **工具结果**：模型调用后拿到的结果要短，说明已发给用户、接着做；不要让它以为这一轮结束了。
5. **通知**：这句发不发系统通知、算不算「回复完成」，设计时定，写理由。默认倾向：不单发通知，这一轮结束时的通知照旧。
6. **侧栏与摘要**：侧栏助理卡片的第二行、`<summary>` 小字、工作台过程卡片里怎么出现这一步，按现有画法定，写进设计。
7. **评测**（真模型，可以放开用，额度够）：在 `.scratch/main-chat/entry-layer-eval/` 加一套或在现有套件里加用例，至少量三件：
   - 插话后手上的事还要做几步时，它用不用这只手先回一句；
   - 没人插话、事情也不长时，它会不会滥用（每一步都发一句）；
   - 用了之后，接着做的那段对不对。
   模型写死 `mm_1792576875658`（API key 接入），解释器用评测 README 里写的系统 python3.14。用例里的人名、地名用虚构的。

## 怎么做

- **先读**：`AGENTS.md`（宪法，尤其 Rule 1、3、5）；票 136 的「设计」与「报告」（`.scratch/main-chat/issues/136-interject-mid-run.md`）：插话的落库、`sequence`、GUI 画法、回放都在那里，这票照着接；`docs/architecture.md`、`docs/ipc-protocol.md`；`managed-ga/patches/manifest.md`；GUI 主对话画法（`gui/src/lib/assistant-conversation*`、`run-groups`、`gui/src/stores/messages.ts`）。
- **先在本文件写「## 设计」一节**（工具放在哪一层、名字与说明原文、事件与落库、回放、GUI 画法、通知、评测设计），然后直接实现。碰到要改 Agent API 已有字段含义、或画法与 `docs/design/` 主对话一节冲突时，先停下回报。
- 更新 `docs/architecture.md`、`docs/ipc-protocol.md`、`gui/src/types/ipc.ts` 镜像、`docs/managed-ga-runtime/` 相关页、`managed-ga/manifest.json` 与 `managed-ga/patches/manifest.md`（若加补丁）。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv：在 worktree 根目录用 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。import `managed-ga/code` 的探针都用 `python -B`。真机 dev 由主会话合入后走，代理不跑 `tauri dev`。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。
  ```bash
  cd <主树>
  git worktree add -b t137-say-a-line <scratchpad>/wt-137 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  pnpm --dir <wt>/gui install
  ```
- 同时在跑：票 140（每次模型请求封顶 5 分钟，改 `managed-ga/code/llmcore.py` 与它的测试、补丁栈）。补丁编号与 manifest 可能撞，合入时我来对；你别碰 `llmcore.py`。
- 不写 Galley 的真实数据库，不写内置 / 外置 GA 的状态；真实数据库只读。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。GUI 不是 prettier-clean：旧文件只格式化自己的 hunk。Windows CI 检出是 CRLF：Rust 原始字符串的 contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t137-` 前缀命名。票面与文档里不写本机用户目录、worktree 路径、服务商名、接口主机。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：设计要点（含工具名与说明原文）；评测结果（每个用例几遍、用没用、发了什么）；改了哪些文件；测试与验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 依赖

- 票 136 已合入（`f6dfe347`…`e25f079f`）。
