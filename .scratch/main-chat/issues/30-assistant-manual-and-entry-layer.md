# 30 助手手册、入口层改写与叫醒措辞的真模型评测

Status: done（2026-10-19 JC 真机第 5 站（耳机调研、下载文件夹先问再列方案）：派活与卡片、在办、叫醒后交代、打开与面包屑、升级进侧栏均通过；子任务提问时卡片与主对话各出一份同样的提问，已由裁决 101、102（票 48、49）处理。2026-10-16 合入）

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
- 只在 worktree 里工作：绝不碰主工作树 `~/Documents/genericagent-webui`（JC 的 `tauri dev` 在那里跑），不跑 `tauri dev`，不 `git commit`，不写 JC 的数据库。

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

### 回报（2026-10-16，worktree `assistant-manual-30`，未提交）

**改了哪些文件**

- `core/src/managed_prompt.rs`：入口层派活条款改写（要交回的证据、Galley 会叫醒你、写命令前读手册）；原常量拆成 `MAIN_CHAT_ENTRY_LAYER_HEAD` 加函数 `main_chat_entry_layer(manual_path)`；`compose_main_chat_runtime_prompt` 多一个参数 `manual_path: &str`；预算闸 1446 → 1699，测试改写并新增 `main_chat_entry_layer_sends_the_model_to_the_manual`。
- `core/src/assistant_manual.rs`（新）：`include_str!` 内嵌手册；`manual_path(state_root)` 与 `materialize(state_root)`；3 条测试（写出、路径、链接解析、重写覆盖；硬规矩；命令拼写）。
- `core/src/lib.rs`：一行 `mod assistant_manual;`（在 `app_update` 之后）。
- `core/src/runner_commands.rs`：只动 `prepare_managed_spawn_args` 里主对话那一支：先写手册（失败只记日志、照常启动），再把路径交给 compose。`session_runner/` 没动。
- `docs/managed-ga-runtime/galley-assistant-manual.md`（新）：手册全文，英文。
- `docs/managed-ga-runtime/prompt-composition.md`：入口层一节（证据、叫醒、读手册）、预算、叫醒评测证据、条款台账一行、回归清单第 24 条改写并新增 25–27 条。
- `docs/managed-ga-runtime/README.md`、`docs/managed-ga-runtime/code-state-and-patches.md`、`docs/README.md`：手册的路由行、状态目录布局两行（`im/reference/`、`assistant/reference/`）、更新触发一行。
- `.scratch/main-chat/entry-layer-eval/run.py`、`README.md`：新增 `--suite wake`（同一套沙盒，按固定数据回答的假 CLI，干跑测试覆盖）；`wake/`（新）：用例、措辞、真实 Rust 生成的提示词、真实 CLI 的 `--help` 原文、结果。

**入口层字节数**：旧 1446，新 1699（+253：证据 90；叫醒一句替掉「its card shows the progress, and you can look it up when they ask」+58；读手册一段 105，路径不计，同 IM 的算法）。

**手册**：全文在 `docs/managed-ga-runtime/galley-assistant-manual.md`，运行时写到 `<state_root>/assistant/reference/galley-assistant-manual.md`，入口层末段写的就是这个绝对路径。六节对应票面六条：身份、三级授权、CLI（读写命令全列，写命令带 `--supervisor=galley-assistant --reason="<why>"`，`llm set` 例外；主对话里不用 `session wait` / `follow` / `watch`、`project follow`；新活用 `<subtask>` 不用 `session new`）、叫醒（打回最多两次，`<no-reply/>` 整条回复就是它、不带建议标签，替答与问用户的界线）、验收与交代、别碰别人的。

**评测**：结果表在 `.scratch/main-chat/entry-layer-eval/wake/results.md`（开头一览表：用例、期望、措辞、遍次、调了什么命令、回复原文、是否 `<no-reply/>`、字数、读手册、过 / 不过），原始结果在 `results.json`，方法与摘要在该目录 `README.md` 的「叫醒措辞评测（票 30）」。模型是 JC 主对话现在用的 gpt-6.1-sol（只读查 `sessions.llm_key`，`main_chat = 1`），推理强度 high。

- 保留的 20 次运行 19 次过。9 条都按期望做了：打回没有确认号的「订好了」并写明要什么、回复只有 `<no-reply/>`；替用户答「靠窗」；验证码与付款都问用户；出错一句话加建议、不重开；步数上限发 `continue`；两件一条说完；打回两次后不再打回、交代缺什么。唯一不过是「结果够好」第 2 遍：内容对、点名了表格路径，但 177 字超过脚本定的 160 字上限。
- 全部 50 次运行（含作废的）里：每次 `session send` 都带 `--supervisor=galley-assistant`，第一次写命令之前都读了手册，没有一次用 `session wait` / `follow` / `watch`，`<no-reply/>` 回复都没带建议标签。
- 作废重跑了 30 次，原因都写在 `results.json` 的 `meta.superseded_runs`：第一批固定数据有错（截图是文字占位、日期星期写错），14 次；手册验收一节改了两次，16 次。手册改动的起因：证据齐全时模型回源头重查（开浏览器、想 OCR 截图、要派活说明没要的链接）后打回。按助手 PRD 反方 2「核对证据在不在，核不了就明说没核实到」改写后不再这样。每次运行记了读的是哪版手册（`manual_sha`）。
- 用量：50 次运行，166 次模型调用。超出票面「约 20 次」，多出来的都是上面两类重跑和 `v2` 的 2 次。

**叫醒措辞的改字建议**（对票 29「措辞草稿」，只改 Step limit 一件，其余逐字不变）

草稿在 9 条上行为都对，只有 Step limit 看得出缺口。消息里没有子任务停下时的文字（票 29 第 3 条要它带说明，草稿没留填空），「the same way」单独来时也没有可以照着的命令。`draft` 两遍都先去翻引擎的 `model_responses` 日志找进度，再 `session show`，用了 4～5 次模型调用。改成下面这样后，`v2` 两遍都直接 `session send … "continue"`，3 次调用，`<no-reply/>`，过：

1. 在「paused at the engine's step limit, mid-work.」之后插入：

   ```text
    Its last message:
   <<<
   {last_text}
   >>>
   ```

   （`{last_text}` 即票 29 第 1 条 StepLimit 的「最后一段看得见的文字」，换行同 Done 的 `<<<` / `>>>` 写法。）
2. 把 `send it "continue" the same way` 换成 `` send it "continue" with `session send {id} "continue" --supervisor=galley-assistant --reason="continue"` ``。

改后全文（与 `wake/wording.md` 的 `v2` 一致）：

```text
Subtask `{id}` "{title}" (round {round}) paused at the engine's step limit, mid-work. Its last message:
<<<
{last_text}
>>>
If it is getting somewhere, send it "continue" with `session send {id} "continue" --supervisor=galley-assistant --reason="continue"` and end your reply with exactly <no-reply/>; this counts as a round. Otherwise tell the user how far it got.
```

**门禁的最后输出**

- `cargo test --manifest-path core/Cargo.toml --workspace`：exit 0；33 组，937 passed，0 failed（最后一组 `test result: ok. 0 passed; 0 failed; …`）。
- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished dev profile`；唯一的警告在 `relay/src/channels.rs`（`fetch_update` 弃用），不是本票的。
- `rustfmt --edition 2021 --check core/src/assistant_manual.rs core/src/managed_prompt.rs core/src/runner_commands.rs`：exit 0（`managed_prompt.rs` 在 HEAD 是 rustfmt 干净的，只动了自己的 hunk）。
- `git diff --check`：exit 0；新文件另扫过行尾空白，无。
- `run.py --dry-test`：`DRY TEST PASSED`（含叫醒路径：手册路径、叫醒消息逐字、`sed` 读 CLI 路径、读写都到假 CLI、`llm set --supervisor` 被拒、`session wait` 被判出，读真实 HOME、`/etc`、名单外的程序、往沙盒外写都失败）。
- 公开仓库检查：`wake/` 下 grep `http`、`api_host`、`apibase`、`/Users/`、用户名、`/var/folders` 均无本机或 API 信息。`http` 只命中项目主页、release 链接、`example.com`，以及模型在沙盒里读到的 GA 种子记忆 `vision_sop.md` 里的 modelscope 链接（仓库里本来就有）。

**拿不准、要主会话定的事**

1. **`llm set` 不收 `--supervisor` / `--reason`**（`cli/src/args.rs` 的 `LlmCmd::Set`；Agent API §5.18「No Origin flags」；用开发版二进制只跑解析验证过，带上就 exit 2 `invalid_args`）。票面「每条都带」对它不成立，手册写成唯一例外。另外 IM 入口层（`im_supervisor_prompt`）写着「On every CLI write command (session new / session send / project create / llm set) pass exactly --supervisor」，对 `llm set` 是错的。本票没动它，要不要另开票修？
2. **改名没有 CLI 命令**（Core 有 `rename_session`，CLI 没有）。票面把改名放在「自己做」，手册只能写「说从这里改不了」。要不要加 `session rename`（Rule 3 只加不改）？
3. **Done 的 `session show {id} --tail=40`**：子任务超过 39 步时，派活说明（第一条消息）不在最后 40 条里。评测的子任务都短，没测到。可选做法：叫醒里带派活说明的头几行，或让 `session show` 能取开头。
4. **`<no-reply/>` 与建议标签**：手册写了不带建议标签，50 次运行也都没带。万一带了，票 29 的推导与票 31 的界面要定怎么处理；建议是剥完只剩建议也算空回复、不显示建议。
5. **Step limit 的打回上限**：草稿写「this counts as a round」，但 `send_backs ≥ 2` 的替换句只给了 Done。第 3 轮停在步数上限时还续不续，归票 29 定。
6. **手册写出失败**：我选了记日志、照常启动主对话（IM 那边是启动失败）。理由是没有手册的主对话好过没有主对话；主会话可以改。
7. **合入冲突**：`core/src/lib.rs` 加了一行（在文件开头附近，和票 29 的 `subtask_report` 不相邻）；`core/src/runner_commands.rs` 只动了 `prepare_managed_spawn_args` 的主对话分支。
8. **其他**：清理 `__pycache__` 时顺手删了本 worktree `core/python-bundle/` 下的字节码缓存。那是 worktree 自己的构建产物副本，会自动重新生成，主工作树没碰。

### 集成（主会话，2026-10-16）

三张票在一个分支上合起来，主会话补了五处：

1. **Done 指向派活说明**：子任务超过 39 步时说明不在 `--tail=40` 里（票 30 的问题 3），叫醒改为写明第一条消息 `session show {id} --around=msg_{id}_0_user`，最后几步照旧 `--tail=40`。没选把说明整段塞进叫醒：同一段里助手的上下文本来就有它，只在冷启动后才缺，按需查更省。
2. **步数上限写明续跑命令**：采纳票 30 的评测建议，「the same way」换成完整的 `session send … "continue" … --ensure-runner`（票 29 已补上最后一段文字，与建议 1 同义）。
3. **「不出声」只认剥完为空**：界面原先只要带了标签就藏（「已打回。<no-reply/>」也藏），Core 的推导是剥完为空才算。改成两边一致：剥完还有字就照常显示。理由：模型把交代写完又误加标签时，丢掉交代比多一句「已打回。」代价大。后面跟着建议标签的仍算不出声（票 30 的问题 4）。
4. **手册补 `--ensure-runner`**：手册写在这个参数出现之前，补上用法与一句为什么；测试照新拼写。
5. **IM 入口层的 `llm set`**：它不收 `--supervisor` / `--reason`，带了就 exit 2（票 30 的问题 1），IM 入口层却要求带，删掉它在那串命令里的名字。

没改、记下的：改名没有 CLI 命令（助手 PRD 次序第 3 步补）；派活本身失败且叫醒送不出去时没有通知（票 31 问题 1）；打回后新一轮第一步落定前卡片还写上一轮的步数摘要（旧行为）；手机端要按来源藏起叫醒行与 `<no-reply/>`（手机开工时）；叫醒在等回答时按住会有两个声音（裁决 8 本来如此）；手册写失败只记日志、照常启动（票 30 的问题 6，可改）。

门禁：`cargo test --workspace` 35 组 974 条（本机时区与 `TZ=UTC` 各一遍），`cargo check`；`pnpm --dir gui typecheck`、`lint`、vitest 1351 条（本机与 UTC 各一遍）；文档链接、Supervisor SOP 漂移、IPC 漂移、`git diff --check` 都过。
