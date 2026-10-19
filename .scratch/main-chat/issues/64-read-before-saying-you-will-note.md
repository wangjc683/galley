# 64 先读手册再表态：不在读到门槛之前说要记，没设就不提改口

Status: done（2026-10-19 JC 真机：「63、64 标完成」。主会话查库：「今晚 8 点和朋友吃饭」最终回复没有改口，第一轮摘要是先核对规则、没有先表态要记；「明天去医院复查」照样记下并提醒。合入 `145f9ef5`、`7ca57450`、`1d2908fa`）

来源：主聊天 PRD 裁决 116（2026-10-19，JC 读票 63 评测：「A 先按你推荐修掉」）。依赖 63（已合入）。只改入口层待办那一段与入口层评测；手册、Core 别处、CLI、数据、GUI、runner、`managed-ga/code` 不动（评测证明手册要补一句时再动，回报里写理由）。

## 起因（票 63 评测）

`hotpot-tonight`（「今晚 9 点和朋友吃火锅」，没说记一下）两遍判定都过（没设待办、没设提醒），可最终回复都带一句改口：

- 第 1 遍：「今晚有火锅局呀，吃得开心！刚才说要加待办有点多此一举，就不加了。」
- 第 2 遍：「吃得开心！刚才说记待办有点多余，就不特意设提醒打扰你了。……」

两遍的第一轮都先表态要记（一遍正文写「我把今晚的安排记到待办里。」，一遍写在 `<summary>` 里），读了 `todos.md` 第③条（今晚就去、没什么要准备的不跟）才改主意。入口层待办那一段（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`，约 386–392 行）只说了「Do it unasked」，门槛只在手册里。主对话里第一轮的正文与 `<summary>` 用户在运行中那一行看得到，最终回复里的改口更是直接给用户看。

## 一、入口层

改待办那一段，目标两条：

1. **先读再表态**：在说要记、要提醒之前先读 `todos.md`（门槛在那里）。不要求把门槛搬进入口层。
2. **没设就不提**：最终决定不记时，回复里不提「本来要记」「刚才说要加」这类改口。

措辞自定，英文，尽量短；先试只改现有句子（例如把「Do it unasked」改成带「after reading `todos.md`」的说法），不够再加一句。照 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 注释的写法补「Raised 2675 → M by ticket 64」并写理由（若字节没涨就写清没涨）。相关测试跟着改；工作台、IM 提示词不变，`prompt_hash()` 不变（改前改后各打印一次，回报里贴）。

## 二、评测（`.scratch/main-chat/entry-layer-eval/`，待办套件为主）

- **判定加一条**：不设任何东西的用例，最终回复（去掉 `<summary>`、`<next-suggestion>`）不得出现改口：「刚才说」「多此一举」「多余」「本来要」「就不加了」「不特意设」一类（写成正则，列进 `expect`），另记第一轮的正文与 `<summary>` 里有没有「记到待办」「设个提醒」一类表态（只记录，交主会话看）。这条判定加到所有不该设的用例上（`hotpot-tonight`、`past-trip`、`founding-date`、`reno-no-remind`、`guitar`、`flight-number`、`declined-before` 等，以 `cases.json` 实际为准），不只火锅。
- **先跑基线**：用现在的提示词（票 63）只跑这些不该设的用例各两遍，记下改口与第一轮表态出现几次；再用改后的提示词跑同一组，对比。基线不改口的用例多，就在回报里说清楚改口集中在哪几条。
- **不退步**：待办套件整组重跑一遍（该设的照样设，`hotpot-asked`、`hospital-tomorrow`、`school-monday`、`meeting-3pm`、`reno-mention`、`offer-friday` 等），通过率不低于票 63。定时、叫醒两套不用重跑（入口层待办那一段之外不动）；`chat/` 闲聊组跑一遍，看改口有没有在闲聊里出现。
- 时间相关用例照票 63 的做法：消息里的钟点按运行时间取还在前面的那个。
- 照票 59、60、63 记下每条读了手册哪几部分、多少字节、几次请求、用时；改后请求次数若明显变多（先读再表态可能多一轮），写清多了多少。
- 结果文件里不能出现私有接口地址、API host、本机绝对路径。

## 别动

- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`、`runner/`、`managed-ga/code/`、`cli/`、数据与迁移；Core 里除 `main_chat_entry_layer` 与它的测试外不动。
- 别的提示词层：静态规则、建议、State、Main Chat 节、In Hand、IM。
- `core/` 不是 rustfmt-clean：只 `rustfmt --check` 自己改过的文件，改前先记基线差异数。提交只点名文件，`git add … && git commit …`。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`；`cargo test --manifest-path core/Cargo.toml --workspace` 在 `TZ=UTC` 与 `TZ=America/Los_Angeles` 下各一遍（带条数）；改过的文件 `rustfmt --check`；`git diff --check`。
- `run.py --dry-test`，再按「二」真跑。
- 中文全角标点（自写脚本扫新增行，文件名带 `t64-` 前缀）。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 入口层那一段的新旧原文、字节数、预算注释；`prompt_hash()` 前后。
3. 验证命令与结果原样。
4. 评测：基线与改后的改口次数、第一轮表态次数（逐条）；`hotpot-tonight` 改后每遍的最终回复原文；待办整组「票 63 → 本票」对比（通过、请求次数、用时、读手册字节）；闲聊组。
5. 看到但没改的问题。

## 给 JC 的真机步骤

合入改了 Core，dev 已重编、重启 Core（2026-10-19 22:06）。

1. 发「今晚 8 点和朋友吃饭」：不记、不设提醒，回复里也不提「记」的事（没有「刚才说要加……就不加了」）；运行中那一行的摘要里最好也没有「我先记到待办」。
2. 发「明天去医院复查」：照样记下、提醒在前一晚或当天早上（确认改动没让它该记的不记）。

## Comments

### 2026-10-19 实现说明（分支 `main-chat-64-read-before-saying`）

- **提交**：入口层 `3b4aa37d`，评测 `d0dd308b`，本条另一提交。
- **入口层**（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）：「Do it unasked, and read `todo list` before saying what is left: see `todos.md` in your manual.」改成「Do it unasked, but read `todos.md` in your manual before saying you will (it says when), and `todo list` before saying what is left.」（+38 字节，`todos.md` 从句末挪到前面）；「记下了」那句末尾接「; if you write nothing down, do not bring up noting it.」（+54）。门槛没搬进入口层。预算 2675 → 2767，照注释的写法写了理由。两个旧测试的片段跟着改，新加 `main_chat_entry_layer_reads_todos_before_saying_it_will_note`（只在主对话，工作台、IM 提示词没有这两句；指去的 `todos.md` 里有三条门槛）。`prompt_hash()` 改前改后都是 `c033e8d3`。
- **评测**（细节在评测 README 的「先读手册再表态（票 64）」一节与 `todo/results.md`、`chat/results.md` 的「票 64 重跑」「票 64：改口与第一轮表态」两节）：不该设的 7 条加 `expect.no_retract`（最终回复不能有 `RETRACT_RE`），第一轮的正文与 `<summary>` 按 `STANCE_RE` 只记录；闲聊组不该设的 12 条同样加上。这个正则对三套以前的 362 次运行只命中票 63 火锅那两遍。21:23 用票 63 的提示词跑 7 条各两遍做基线（新参数 `--control 64`，存在 `meta.ticket64_control`），21:27 换成票 64 的提示词整组重跑，之后闲聊组一遍。改口 / 表态（14 次运行里）：票 63 的运行 2 / 5，基线 0 / 5，票 64 0 / 1。待办整组按现在的判定 62/64 → 64/64，请求次数 3.56 → 3.55，用时 28.8 → 27.9 s，读手册 9270 → 8776 字节；不该设的 7 条请求次数 2.43 → 2.43（基线 2.64），没有多一轮。闲聊 14/14 → 14/14，12 条两次都没有改口与表态。一次也没改措辞，共 94 次运行、296 次模型调用。
- **与票不一样的地方**：
  - 措辞没有先只改「Do it unasked」那一句：裁决 116 写明要加「没设就不提」这条底线，而且火锅两条 22:15 以后跑不了，来不及先试一轮再补一句，所以第一轮两条一起上。第一轮就是上面的结果。
  - 21:11 开始做这张票，真跑时已过票 63 写的 21:15 截止，火锅两条的 `hours` 加了 23（「今晚 11 点」，夜宵），截止挪到 22:15；`--dry-test` 的「太晚拒绝」从 21:30 改到 22:30，另加 21:30 取「今晚 11 点」。所以基线与重跑的消息都是「今晚 11 点和朋友吃火锅」，不是票 63 的「今晚 9 点」。
  - 基线没有复现改口：「今晚 11 点」下只有一遍在 `<summary>` 里写了「记下安排」，两遍都没改口，同一时段的改口对比是 0 → 0，能比的是第一轮表态 5 → 1。改口从票 63 的 2 次到 0 次，消息的钟点不同，不能全算在措辞上。
  - 「改后跑同一组」用的是整组重跑里那 7 条（同一时段、同一提示词），没再单跑一遍，省了 14 次。
  - `wake-reno` 第 2 遍补跑了一次：它在 64 次运行的队尾附近，比叫醒消息写的到点时刻晚约 8 分钟才开跑，查了时间后回复末尾说「这次提醒晚了约 8 分钟」（判定不许说「晚了」）。与入口层无关，原来那遍留在 `meta.superseded_runs` 的「票 64 补跑」一组。
- **看到但没改**：
  - 基线里 `reno-no-remind` 第 1 遍「我就不加待办，也不提醒了」、`declined-before` 第 2 遍「按你之前的意思，装修进度就不另设提醒了」：提的是「不记」而不是「本来要记」，正则没收（「就不加了」要紧挨着「了」）；票 64 下这两条都没再出现。算不算改口留给主会话。
  - 票 64 下第一轮的 `<summary>` 还有一次表态（火锅第 1 遍「我先确认时间并记入待办。」，最终没改口）：入口层说的是「saying」，没点名 `<summary>`。
  - 评测拼叫醒消息时，到点时刻取的是整组开跑的时间，队伍一长就晚（上面 `wake-reno` 那次）；改成按每次运行开跑的时间取会更稳，没改。
  - 定时评测与待办共用 `schedule/galley-prompt/`，这次换成了票 64 的提示词，但定时没跑，`schedule/results.*` 仍是票 63 提示词下的结果（README 写了）。
  - `docs/managed-ga-runtime/prompt-composition.md` 的入口层预算与原句停在票 59（2463），票 60、63、64 都没跟；devlog、PRD 留给主会话。
- **验证**：`cargo check --manifest-path core/Cargo.toml --workspace` 通过；`cargo test --manifest-path core/Cargo.toml --workspace` 在 `TZ=UTC` 与 `TZ=America/Los_Angeles` 下各 1141 条全过（评测跑完之后才跑）；`rustfmt --edition 2021 --check core/src/managed_prompt.rs` 改前改后都干净；`git diff --check` 干净；`run.py --dry-test` 通过。新增行没有私有接口地址、API host 与本机绝对路径；中文全角标点用 scratchpad 里的脚本扫过新增行，标出的都是英文语境（英文注释里的括号、正则）。
