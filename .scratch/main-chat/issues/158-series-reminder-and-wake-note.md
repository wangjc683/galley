# 158 重复的待办两处收尾：只改规则的提醒也行得通；叫醒说明写明这件事在重复、已逾期

Status: done（2026-11-10 代理交回，rebase 后快进合入 `e17f77f4`、`eae17c0b`、`6d0675f9`、`07ba840d`、`b7f76707`。主会话验收：在 worktree 复跑 `cargo test --workspace` 本机与 `TZ=UTC` 各 1,424 条全过，文档链接、`git diff --check` 过；新增 2,022 行全量扫过，没有本机路径、密钥、服务商名，网址只有叫醒套件里原有的虚构域名；两份 git 忽略的 `results.json` 已拷回主树。合入前 `busy:0`，合入后二进制里核到新的叫醒说明。dev 代验（CLI，测试数据测完取消）：明天到期的每周重复待办，`todo update --remind-at=<前天 9:00> --series` 一次成：规则的偏移改成提前 2 天 9:00，这一期的提醒落在下一期对应的时刻（同一个任务）；不带 `--series` 同样的时刻照旧 `time_in_past:`；面板上这一期没画铃铛（提醒在到期日之后、没逾期）。叫醒说明的新句子要等一个提醒真的响才看得到，没有在真实库里触发）

来源：票 155 的回报（没验证到的前两条），[主聊天 PRD](../PRD.md) 裁决 204 第 8、12 条。动 Core（`update_todo` 带 `series` 的那一支、到点叫醒的说明）、Agent API 文档、助理手册两句、评测的镜像与用例。只在内置运行时；外置运行时零变化。Agent API 在 `schemaVersion: 3` 内只做加法。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」、`docs/agent-api/todo-commands.md`、票 [154](./154-repeating-todos-core-and-cli.md)（行为第 7、13 条与 Comments）、票 [155](./155-repeating-todos-manual-and-eval.md) 的 Comments。

## 为什么

1. 用户说「以后周报都提前两天提醒我」，手册教它 `todo update <id> --remind-at=<这一期到期前两天> --series`。这一期两天内就到期时，那个时刻已经过了，Core 以 `time_in_past:` 整条拒绝，规则的提醒偏移也没改成。没有办法只改规则。
2. 重复的待办没了结、提醒在后面每一期的时刻再响时，Core 给它的叫醒说明和第一次响一模一样：没写这件事在重复，没写它已经逾期几天。手册（`wake.md`）让它自己去 `todo show`，多一步，也可能不查。

## 要做的

### 一、`--series` 时过去的提醒时刻不再整条拒绝（Core）

- `update_todo` 带 `series: true` 且给了 `remind_at`、而那个时刻不晚于现在：不报 `time_in_past:`。规则的提醒偏移照这个时刻相对这一期到期日算出来、存进规则；这一期自己的提醒改挂到规则后面第一个还没过的提醒时刻（`core/src/todo_repeat.rs` 的 `next_reminder_ahead`，从这一期自己的到期日数起，先看它自己的那一个）；一个都没有（规则已结束等）就不挂。
- 不带 `series` 的 `--remind-at` 过去的时刻照旧 `time_in_past:`；不重复的待办带 `--series` 照旧 `not_repeating:`。
- 输出照旧是 `{"todo": …}`，这一期的 `reminder` 是实际挂上的那一个，`repeat.remind` 是新偏移。
- 文档 `docs/agent-api/todo-commands.md` §5.32 写明，标「Added 2026-11-10（main chat ticket 158）」。

### 二、叫醒说明写明重复与逾期（Core，`core/src/subtask_report.rs` 的 `todo_due_paragraph` 一带）

- 待办的提醒到点时的说明里，补上这件待办什么时候到期（已有就不重复）；它在重复的写一句规则（口径照 `repeat_words`，如 `It repeats weekly on Mon.`）；它已经过了到期日的写明逾期几天，并写一句这是没了结的这一期在后面一期的时刻又响（英文，照这一段现有的口气，短）。不重复、没逾期的待办，说明一个字不变（用现有测试钉住）。
- 这是 Core 发给模型的字，改了要跟上评测里它的 Python 镜像（`.scratch/main-chat/entry-layer-eval/run.py` 的 `due_paragraph`）；顺带把镜像里缺的票 111「Its items not ticked yet」那一段补上（票 155 的票外发现），`--dry-test` 里逐字对 Core 的输出。

### 三、手册两句

- `todos-change.md` 重复的那一条：「以后都提前两天提醒」的写法不变，补半句：这一期离得太近、那个时刻已过也照给，Galley 照样改规则，这一期的提醒落在后面第一个还没过的时刻。
- `wake.md` 那一条：说明里已经写着它在重复、逾期几天，不必为此再 `todo show`；先问做了没有的规矩不变。
- `core/src/assistant_manual.rs` 的测试跟上。

### 四、评测

模型只用默认的 `mm_1792576875658`（API key 接入的 gpt-6.1-sol，推理强度 high），拿不到就停下回报；解释器与跑法照 README；先 `--dry-test`。假 CLI 跟上第一条的新行为（报错与不报错的分界用开发版二进制或内存库抓，照票 155 的做法）。

- 新用例两条，各 3 遍：① 重复的待办这一期明天到期，用户说「以后周报都提前两天提醒我」：该 `todo update … --series` 一次成，回复说清以后怎么提醒；不该报错后放弃、不该另建一条。② 「逾期的又响」换成新的叫醒说明重跑（票 155 的 `rep-overdue-ring`）：该先问做了没有；记下它还去不去 `todo show`。
- 回归：`todo` 套件里组名「重复的待办（票 155）」的 14 条各跑一遍，`wake` 套件跑一遍。
- 结果、README 一节「重复的待办收尾（票 158）」；结果里不写服务商名、本机路径、接口主机。原始 `results.json` 是 git 忽略的本地文件：开工时从主树只读拷来，回报里提醒主会话删 worktree 前拷回去。

## 别动

- GUI、`docs/design/`、`core/src/todo_by_hand.rs`：票 157 在改。
- 票 154 的生成、每个 tick 的重挂与补挂；`schedule` 命令；入口层提示词（`core/src/managed_prompt.rs`）。
- 手册其余部分。`.scratch/main-chat/PRD.md` 与别的票。主工作树；不跑 `tauri dev`。
- 跑评测用 `PYTHONDONTWRITEBYTECODE=1`；长命令前台跑，不留后台等待循环；`core/` 逐文件 `rustfmt --check`。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
TZ=America/Los_Angeles cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

测试至少覆盖：`--series` 加过去的提醒时刻改了规则的偏移、这一期的提醒落在后面第一个没过的时刻；不带 `--series` 仍是 `time_in_past:`；叫醒说明四种（不重复没逾期逐字不变、不重复逾期、重复没逾期、重复逾期）；手册片段。评测：`--dry-test` 过，新用例与回归如上。新增的中文行扫半角标点（脚本放 scratchpad，文件名带 `t158-` 前缀）。

## 回报格式

照 dispatch「The report has four parts」。另外：叫醒说明四种的最终原文；手册两句的最终原文；评测每条过了几遍、花了多少次真调用；自己定的边界。

## 真机步骤

合入前主会话看 `busy:0`；合入后重编替换 dev 的 CLI 不需要（没动 `cli/`），手册等主对话 runner 下次启动才写进状态根。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 用 CLI 建一件明天到期的每周重复测试待办，`todo update … --series` 给一个已过的提醒时刻，查库：规则偏移改了、这一期的提醒落在未来；测完清掉 | 无 |

## Comments

### 2026-11-10 代理回报摘要（主会话记）

- **叫醒说明四种**：不重复、没逾期的逐字不变（如 `It is due 2026-10-21 15:00 (Wed), local time.`）；不重复、逾期：`It was due …, 1 day ago.`；重复、没逾期：在到期那句后面加 `It repeats every 2 weeks on Mon, Thu.`；重复、逾期、在后面一期的时刻又响：`It was due … 7 days ago. It repeats weekly on Tue: this one was left unticked, and its reminder came again at a later one's time.`；重复、逾期但只是自己的提醒晚到：只加规则那一句。
- **评测**（gpt-6.1-sol，推理强度 high；35 次运行、107 次模型调用）：新用例「这一期离得太近时以后都提前两天」3 / 3，三遍都是一次 `todo update --remind-at=<已过> --series` 就成；「逾期的又响」在新说明下 3 / 3（此前 2 / 3）；票 155 那一组 14 条各一遍 13 / 14（此前 12 / 14）；叫醒套件 16 / 16。
- **判卷放宽过一次**（代理自己报的）：新用例起初要求回复里有「两天」，有一遍说的是「都在周一上午 9 点提醒你」，意思对但没这两个字；放宽成也认提醒落在的那个星期，并在 `--dry-test` 里两个方向都加了检查。按原标准是 2 / 3。
- **手册那半句没改变行为**：`wake.md` 说不必为此再 `todo show`，「逾期的又响」3 遍里 3 遍照样查了，其中 2 遍与读手册并在同一步，模型调用前后都是 7 次。
- **没验证到的**（原样）：`--series` 的新路径只在内存库与假 CLI 里测过（主会话合入后在 dev 的真实 Core 上补验了，见状态行）；规则给不出还没过的提醒时刻时旧提醒由 Core 放掉，这条路没有测试（实际到不了）；新提醒时刻在写入前算、几秒内刚好过去会在规则已写之后被拒，任何 `--remind-at` 都有同样的窗口；逾期按日历日数算（昨晚 23:30 到期、今早 8:00 提醒读作 1 天前，今天早些时候到期的不算逾期）；「又响」也按日子判，逾期的重复待办上被手动挪到后面某天的提醒也会被说成又响；回归里 `rep-quarterly-hint` 一遍从过变不过（记对了、没问以后记不记，来自没动的 `todos.md`，同一条另两遍过）；没有覆盖的用例：`--due` 与 `--series` 加已过的时刻一起给、不重复但逾期、重复逾期但只是自己的提醒晚到、拿掉 `wake.md` 那半句的对照。
- **票外发现**：CLI 的帮助（`cli/src/args.rs`）没写带 `--series` 时接受已过的时刻，评测的 `cli-help.json` 照它镜像，都没动；叫醒套件回归改写了两份 `composed` 文件、差别只是随机的临时目录名，代理还原了没提交。
