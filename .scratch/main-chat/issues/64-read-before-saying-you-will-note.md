# 64 先读手册再表态：不在读到门槛之前说要记，没设就不提改口

Status: ready-for-agent

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

## 给 JC 的真机步骤（主会话合入后补全）

## Comments
