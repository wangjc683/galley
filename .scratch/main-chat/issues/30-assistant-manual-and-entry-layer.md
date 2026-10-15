# 30 助手手册、入口层改写与叫醒措辞的真模型评测

Status: ready-for-agent

来源：[助手 PRD](../../assistant/PRD.md) 裁决 2、3、8；[主对话 PRD](../PRD.md) 裁决 80、82。
同批：[29](./29-subtask-wake-core.md)（Core 叫醒，另一个 worktree）、[31](./31-subtask-wake-gui.md)（界面）。

## 背景

- **主对话**：内置运行时那条一直在的会话，界面上是助手「Galley」，用户的私人助理。它的系统提示词由 `core/src/managed_prompt.rs` 的 `compose_main_chat_runtime_prompt` 拼出：
  静态规则 + 状态块 + `## Main Chat` 数据节 + `MAIN_CHAT_ENTRY_LAYER`（入口层，`managed_prompt.rs:277-306`）。
- **派活**：入口层让它把长活写成回复末尾的 `<subtask>…</subtask>`，Core 开子任务。现在的条款说「卡片显示进度，用户问起再查」（`:300-301`）。
- **地基改了**（助手 PRD）：助手对派出去的活负责到底。票 29 让 Core 在子任务结束、提问、出错时叫醒助手一轮，叫醒消息里带着这一刻该怎么做的指令（29 的「措辞草稿」）。
  本票做常驻的两件，并用真模型评测叫醒措辞：
  1. 入口层的派活条款改写；
  2. 一份**助手手册**：用户让它管会话、项目、模型时怎么做，即三级授权和 CLI 写命令。

## 要做的

### 1. 入口层派活条款改写

改 `MAIN_CHAT_ENTRY_LAYER` 末段。保留：标签写法、「另一个看不到这条对话的会话，所以说明要写全」、「快活自己做」、「别用 GA 的文件式子代理 subagent.md」。改的是：

- 派活说明除了目标、用户给的信息、交回什么，还要写**交回什么证据**，例如确认号、文件路径、链接、截图路径；
- 删掉「its card shows the progress, and you can look it up when they ask」，换成：子任务完成、提问或出错时 Galley 会叫醒你，你验收后给用户交代；不要自己去等它、守着它；
- 加一句指向手册：第一次用 Galley 写命令（send、stop、archive、move、project、model）之前，先读手册（给出绝对路径，见第 2 条）。

改完更新预算闸 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`（现 1446）与相关测试（`main_chat_entry_layer_dispatches_long_work_to_a_subtask` 等），
记账照 [prompt-composition](../../../docs/managed-ga-runtime/prompt-composition.md) 的规矩：入口层一节、条款台账、回归清单。增量尽量小，手册承担细节。

### 2. 助手手册

- **放哪**：英文 markdown，内嵌在 Core 里（`include_str!` 一个仓库里的 `.md`，或常量），随主对话 runner 启动写进内置状态目录，
  例如 `<state_root>/assistant/reference/galley-assistant-manual.md`。先例：IM 启动时 Core 把 SOP 写进 `<state_root>/im/reference/`（`core/src/im_supervisor/mod.rs:227-237` 的 `materialize_sop_reference`），入口层再把路径交给模型。
  主对话的路径怎么进提示词，照 IM 的做法；`MainChatPromptState` 或 compose 的参数，你定。预算闸里路径不计入，同 IM。
- **写什么**（每条命令照 `cli/src/args.rs` 与 `docs/agent-api/` 核对拼写，例如 `session move <id> --to=<project-id>`，不是 `--project`）：
  1. **身份**：你是用户的私人助理，派出去的活由你负责到底；用户只跟你说话。
  2. **三级授权**：
     - 自己做，做完告诉用户怎么撤：读任何会话与项目；继续、停止、归档 / 恢复你派出的子任务；建项目、把会话移进项目、改名；给你派出的子任务换模型（`llm list` / `llm set`）。
     - 先问：对外的事（替用户发消息、发邮件、发帖、下单付款）、删除（如 `project delete`）、往用户自己开的对话里写、改默认设置。
     - 只能用户来：API Key 与模型服务商、聊天软件的登录、浏览器插件、切换运行环境、更新、重置主对话、定时任务（现在还没有命令）。你备好要填的内容，告诉用户在哪改。
       这与静态规则里「What Only The User Changes In Galley」一致；那一节本步不改。
  3. **CLI 写命令**：每条都带 `--supervisor=galley-assistant --reason="<为什么>"`；用到的命令列全（`session send / stop / archive / restore / move`、`project create`、`llm list / set`，读的 `sessions list / search`、`session brief / show`）。
     **主对话里不用** `session wait`、`session follow`、`session watch`、`project follow`：它们会把这条对话卡住，Galley 会叫醒你。
  4. **叫醒**：是 Galley 的通知，不是用户说的；照里面的指令做，不提这条通知本身。打回最多两次；`<no-reply/>` 只在你打回了或替用户答了子任务的问题、没有话要对用户说时用，整条回复就是它。
     替用户答子任务的提问：用户说过的事实与偏好、从用户要的东西里显然能推出来的，可以答；涉及钱、对外、不可逆、只有用户有的东西（发到手机的验证码、密码），问用户。
  5. **验收与交代**：核对证据，不转述子任务的说法；核不了就直说「没核实到」。交代先给结果，一两句，点名证据；不贴子任务全文，不复述过程。几件一起来时，一条回复说完。
  6. **别碰别人的**：外部 agent（`via` 为 `supervisor` 且不是你）开的会话，用户没开口就不碰。
- 测试：照 `materialize_sop_reference_writes_galley_owned_copy` 写一条，手册写出来了、路径对、里面链接（如果有）都解析得到。手册内容要有测试守住几条硬规矩：`--supervisor=galley-assistant`、不用 `session wait`、`<no-reply/>`、三级授权的标题。

### 3. 真模型评测

在 `.scratch/main-chat/entry-layer-eval/` 里加一组叫醒用例，沿用那里的 `run.py` 机制（README 讲了怎么跑、怎么解 key、怎么拦截）：

- **提示词**：用你改过的入口层，由真实 Rust 代码生成（同 `galley-prompt/` 的做法）。
- **历史**：一段很短的对话。用户提了要求，助手已经派了子任务（回复末尾的回放标记照 `subtask::replay_marker` 的格式）。
- **新消息**：按票 29「措辞草稿」逐字填出来的叫醒消息。
- **工具**：模型调的 CLI（`session show`、`session send` 等）要拦下来，记下参数，返回预先写好的 JSON；不能真的动 JC 的 Galley。
- **模型**：用 JC 主对话现在用的那个（只读查 `workbench.db` 的 `sessions.llm_key`，条件 `main_chat = 1`），或者 eval README 的默认；结果里写明用了哪个的显示名。

用例至少九条：

1. 结果够好，有证据 → 一两句交代，点名证据；
2. 子任务说「已订好」但没交订单号 → `session send` 打回，写明要什么，回复只有 `<no-reply/>`；
3. 提问，答案在前文里（用户说过要靠窗）→ 替答，`<no-reply/>`；
4. 提问要短信验证码 → 问用户，不替答；
5. 提问要确认付款 → 问用户；
6. 出错 → 一句话说什么失败、建议什么，不自己重开；
7. 停在步数上限、在推进 → 发 `continue`，`<no-reply/>`；
8. 一条叫醒里两件 → 一条回复说完两件；
9. 已打回两次 → 不再打回，交代现有结果与缺的部分。

每条跑两遍看稳不稳。结果写成表：用例、期望、实际（调了什么命令、回复原文、是否 `<no-reply/>`、字数）、过 / 不过。

叫醒措辞在票 29 的文件里（`core/src/subtask_report.rs`，另一个 worktree），**你不改它**：有不过的用例时，把建议的改法写成对「措辞草稿」的逐字改动，放进本票 Comments，并用改过的措辞重跑那几条，证明改了能过。
入口层和手册是你的，评测不过可以直接改。

**开源仓库**：`.scratch` 会提交到公开仓库。结果文件里不许出现 API 地址、域名、key、本机绝对路径或用户名，提交前 grep 一遍（`http`、`api_host`、`/Users/`）。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
cargo check --manifest-path core/Cargo.toml --workspace
rustfmt --edition 2021 --check <你动过的 .rs 文件>
git diff --check
```

文档里的中文用全角标点。

## 别动

- 票 29 的文件（`core/src/subtask_report.rs`、`message_queue.rs`、`subtask.rs`、`turn_persistence/`、`session_runner/replay.rs`、`carry.rs`、`db/search.rs`）。手册的写出若要挂在 `session_runner` 的启动路径上，尽量只动拼提示词与 spawn 配置那一处，并在 Comments 里写明动了哪个函数，合入时主会话要对冲突。
- `gui/`，外部 agent 用的 `docs/integrations/galley-supervisor-sop.md`，以及静态规则里的「What Only The User Changes」一节（本步不改）。
- 只在 worktree 里工作：绝不碰主工作树 `/Users/inkstone/Documents/genericagent-webui`（JC 的 `tauri dev` 在那里跑），不跑 `tauri dev`，不 `git commit`，不写 JC 的数据库。

## 回报

- 改了哪些文件，每个一句；
- 入口层新旧字节数；
- 手册全文的位置；
- 评测结果表的位置与摘要；
- 对叫醒措辞的改字建议（逐字）；
- 门禁命令的最后输出；
- 拿不准、要主会话定的事。

同样的内容写进本票 `## Comments`。

## Comments
