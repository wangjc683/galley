# 155 重复的待办：手册与评测

Status: ready-for-agent（等票 154 合入后派）

来源：[主聊天 PRD](../PRD.md) 裁决 204（重复的待办；第 9 条主动发现到第 2 档、第 12 条没了结的这一期照样提醒）、裁决 205（用户能在面板上手改日子、提醒、重复）。只改助理手册、评测与 Core 里的手册测试，不动别的代码。只在内置运行时；外置运行时零变化。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」、`docs/agent-api/todo-commands.md`（票 154 之后的版本：`repeat`、`seriesId`、`skipped`、`todo skip`、`--series`、`--no-repeat`、`done` 与 `skip` 输出里的 `next`）、手册全部十份。

## 为什么

- 票 154 让待办能重复：规则单独存，清单上任何时候只有「这一期」，勾掉或跳过时 Core 生出下一期。手册还不知道：它现在把「每周一提醒我交周报」记成自己的重复提醒（`memo.md` 那一句），没有方框、不会逾期。
- 写规则这件事交给它，用户不用学；但日子由 Core 算，它只负责判断是不是重复、规则是什么、说清楚。

## 要做的

### 一、手册

起点措辞如下（英文，照手册现有的口气）；评测里可以改，改了在回报里写原因。与现有规则打架的句子以最少的改动理顺。

1. **`todos.md`**，「Noting a to-do」一节之后新增一小节：

   > ### A to-do that repeats
   >
   > Something the user has to finish each time it comes round (「每周一交周报」, 「房租每月 15 号交」, 「每季度报一次税」) is a repeating to-do: ask the question above of one time round, and when ignoring that reminder would still leave it to do, it repeats as a to-do. A nudge that comes round with nothing to finish (「每天晚上 10 点提醒我睡觉」) stays your own repeating reminder (see `reminders.md`).
   >
   >     todo add "<title>" --due=<the first day or time it is due> --weekly=<days> --remind-at=<…> --supervisor=galley-assistant --reason="<why>"
   >
   > - The rule is one of `--daily`, `--weekly=<days>` (1 = Monday … 7 = Sunday), `--monthly=<days>` (1–31; a month without that day takes its last) or `--yearly`, with `--every=<n>` for every n-th (「每两周的周一」: `--weekly=1 --every=2`; 「每季度 15 号」: `--monthly=15 --every=3`). `--due` is the first time it is due, and a repeating to-do must have one.
   > - Galley keeps the rule: the user's list holds one of them at a time, this time's. When it is ticked off or skipped, Galley makes the next at once, due on the rule's next day after today, with the title, the items (unticked) and the notes it had when you set the rule; `todo done` and `todo skip` print it as `next`. One left unticked stays where it is, overdue: no second one comes, and its reminder comes again at each later time's.
   > - `--remind-at` on the first one sets how each one is reminded: as many days before its day, at that time. Give a daily one no reminder unless the user named a time: each one wakes you.
   > - Set a rule when the user states the cycle (「每周一要交周报」); do not ask, and say the rule in the sentence that says you noted it (「记下了：每周一交周报，周一早上 9 点提醒你。」). When the cycle only shows through (「又该交季报了」, 「这个月的物业费」), note this one and ask in the same reply whether to note it each time (「以后每季度都记吗？」). Never set a rule on a guess.
   > - A cycle Galley cannot hold (the last working day of each month, a day by the lunar calendar, days moved for a public holiday): note this one as an ordinary to-do, set your own reminder for after its day to note the next, and tell the user you will note each as it comes.

2. **`todos.md`** 开头说用户在清单上能做什么的那一句：补上用户能改一件事的日子、时刻、提醒、让它重复或不再重复、跳过这一次（面板上的手改是票 156，「跳过这一次」「不再重复」是之后那张面板票；手册写的是定下来的样子）。「改之前先读这件事现在的样子」那条规矩照旧，范围跟着扩大到日子与提醒。

3. **`todos-change.md`** 加一条：

   > - A repeating to-do. 「这周的不用交了」 skips this one, `todo skip <todo-id>`, and the next comes; 「以后不用了」 deletes it and ends its rule, `todo cancel <todo-id>`; 「这次做完就不用再重复了」 keeps this one and ends the rule, `todo update <todo-id> --no-repeat`. A new cycle is `todo update <todo-id>` with the rule's flag (「改成每两周」: `--weekly=1 --every=2`). `todo update` otherwise changes this one only, its title, notes, day and reminder; add `--series` when the user means every one from now on (「以后都叫……」, 「以后都提前两天提醒」): the later ones then take this one's title, items and reminder, and its notes too when you give `--notes` in the same command. When you tick one off, say in a few words when the next is due (「已勾掉，下一次是 11 月 23 日。」).

4. **`wake.md`**「When a reminder comes due」加一条：到点的是一件已经逾期的重复待办（它的到期日在今天之前，是上一期没了结、提醒又来了）：用户可能做了没勾，先问一句做了没有，做了就勾掉（下一期随之出现），不要把同一句提醒再说一遍。

5. **`memo.md`**「每周一提醒我交周报」那一句：改成每次都要办完的是重复的待办（「每周一交周报」），每次只是提醒一下的才是重复提醒（举一个没有东西要办完的例子），只知道作息的是备忘。

6. **`reminders.md`**：说重复提醒的地方补一句分界，指向 `todos.md` 新的那一小节。**`authority.md`**「Ask the user first」里 A repeating task 那一条：说明用户说出了周期的重复待办不用问（它每期不花钱，只在提醒响时叫醒一轮）；没说出周期的不设。**`cli.md`**：若列着 `todo` 的命令，补 `skip` 与新旗标。

7. **Core 的手册测试**（`core/src/assistant_manual.rs`）：片段、交叉引用计数跟上。顺带把一处过时的测试注释改准：写着「the collapsed row shows the start」的那一句（票 108 的理由；票 152 起收起的一行不画备注）。

### 二、评测

评测在 `.scratch/main-chat/entry-layer-eval/`。先读 `README.md` 的「怎么跑」「待办评测（票 41）」「定时与提醒评测（票 36）」「下一步在谁手里（票 153）」。模型只用默认的 `mm_1792576875658`（API key 接入的 gpt-6.1-sol，推理强度 high），拿不到就停下回报，不换别的模型；解释器用 README「怎么跑」里那个；先 `--dry-test`。脚本读的手册与 CLI 帮助要是你 worktree 里的。

1. **镜像跟上票 154**（位置以你 grep 到的为准，票 154 回报的清单供参考）：
   - `run.py` 里照 Core `in_hand_section` 写的 `in_hand_block` / `todo_line`：重复的待办那一行带 `repeats …`（口径照 `core/src/todo_repeat.rs` 的 `repeat_words`：`repeats weekly on Mon`、`repeats every 3 months on the 15th` 等）。
   - `schedule/rust-samples.json` 的 `in_hand` 样本：加一条重复的。
   - `schedule/cli-help.json`、`wake/cli-help.json`：`todo add`、`todo update` 的帮助变了，`todo skip` 是新的，照 README 说的办法重出。
   - 假 CLI：`todo add` / `update` 认规则旗标、`--series`、`--no-repeat`，`todo skip`，`done` 与 `skip` 的 `next`，`list` / `show` 带 `repeat`、`seriesId`、`skipped`；错误照真实 CLI（`repeat_needs_due:`、`not_repeating:`、旗标组合），报错原文用开发版二进制在假 HOME 下抓。下一期的日子用与 Core 相同的算法算，`--dry-test` 里拿几组日子与 Rust 单测的期望对上。
2. **新用例**（加进 `todo` 套件，组名「重复的待办（票 155）」；人名、公司、物品一律虚构；每条 WITH 新手册 3 遍）：

   | 用例 | 用户这句或情形（示意，可改写） | 该 | 不该 |
   |---|---|---|---|
   | 说出周期，每周 | 「每周一要交周报」 | 一件重复的待办（`--weekly=1`，到期是下一个周一）；回复里说清规则 | 记成自己的重复提醒；先问要不要重复 |
   | 说出周期，带提醒 | 「房租每月 15 号交，提前一天晚上提醒我」 | `--monthly=15`，`--remind-at` 在到期前一天晚上 | 每期各记一件；没挂提醒 |
   | 每季度 | 「每季度报一次税，下次是 1 月 15 号」 | `--monthly=15 --every=3`，到期 1 月 15 日 | `--every` 漏掉；记成每月 |
   | 每天，没说几点 | 「以后每天要背 20 个单词」 | `--daily`，不挂提醒 | 每天一个提醒 |
   | 带出周期没明说 | 「又该交季报了，周五前」 | 只记这一次，同一句里问以后每季度记不记 | 直接设规则；只问不记 |
   | 只是提醒 | 「每天晚上 10 点提醒我睡觉」 | 它自己的重复提醒（`schedule create --daily`，照 `reminders.md` 原有的规矩） | 记成重复的待办 |
   | Core 表达不了 | 「每个月最后一个工作日要发工资条」 | 记这一期的普通待办，另给自己挂一个提醒到时记下一期，告诉用户 | 设成每月固定某一号；不说明 |
   | 办完了 | 清单里有重复的「交周报」，用户说「周报交了」 | `todo done`；回复里说下一次的日子 | `todo cancel`；另记下一期 |
   | 这次不用 | 「这周的周报不用交了」 | `todo skip` | `todo cancel`（规则跟着没了）；`todo done` |
   | 以后不用 | 「以后不用每周交周报了」 | `todo cancel`，或用户说明这次还要交时 `--no-repeat` | `todo skip` |
   | 换周期 | 「周报以后改成每两周交一次」 | `todo update` 带 `--weekly=… --every=2` | 删了重建 |
   | 以后都这样 | 「以后周报都提前两天提醒我」 | `todo update --remind-at=… --series` | 不带 `--series`（只改了这一期） |
   | 逾期的又响 | 上周一到期的「交周报」没勾，它的提醒今天又到点 | 先问做了没有；不重复同一句提醒；用户没说做了就不勾 | 直接勾掉；另记一件 |
   | 已经有了 | 清单里有重复的「交周报」，用户说「下周一要交周报」 | 不再记，说已经有、下一次是哪天 | 再记一件 |

   对照组：拿掉 `todos.md` 新小节与 `todos-change.md` 新的那一条（别的改动留着），跑「说出周期，每周」「说出周期，带提醒」「这次不用」「办完了」各 2 遍，看没有这些字它会怎么做。
3. **回归**：`todo`、`schedule`、`memo` 三个套件现有用例各重跑一遍（WITH）。
4. **顺带修两处票 153 回报的毛病**：跑完当场写的 `results.md` 与 `--render-only` 重出的「读手册字节」不一致（当场那份按没换成占位的临时路径算），改成两处同一个算法；`todo` 与 `schedule` 套件撞上工具调用上限时判定文案写死成「第 9 次，达到 8 次上限」，实际上限是 10，改成读各套件自己的上限。
5. 判定写进结果文件：每条该做的、实际做的、算过还是没过；对照组单列一段。结果里不写服务商名、本机路径、接口主机；提交前对全部新增行全量扫一遍。README 加一节「重复的待办（票 155）」。原始的 `results.json` 是 git 忽略的本地文件：开工时从主树只读拷来，回报里提醒主会话在删 worktree 前拷回去。

## 别动

- 代码（Core 的逻辑、CLI、GUI、runner）、Agent API、入口层提示词（`core/src/managed_prompt.rs`）。手册、评测、`assistant_manual.rs` 的测试以外的东西，写进回报，不要动手。发现票 154 的行为与手册该怎么写对不上，也写进回报。
- `docs/design/` 与 `docs/agent-api/`：票 156 在改。
- `.scratch/main-chat/PRD.md` 与别的票。主工作树；不跑 `tauri dev`。
- 跑评测用 `PYTHONDONTWRITEBYTECODE=1`，`managed-ga/code/` 下不许出现 `__pycache__`。长命令前台跑，不留后台等待循环。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

加上评测：`--dry-test` 过；新用例 14 条 × 3 遍，对照 4 条 × 2 遍，三个套件回归各一遍。新增的中文行自写正则扫半角标点（脚本放 scratchpad，文件名带 `t155-` 前缀）。

## 回报格式

照 dispatch「The report has four parts」。另外：

1. 手册每一处的最终原文；跟起点措辞比改了什么、为什么。
2. 评测：每条用例 WITH / 对照各过了几遍、没过的原文摘录；回归有没有掉；花了多少次真调用。
3. 假 CLI 与镜像各改了哪里；与真实 CLI 对过的错误原文。
4. 票面没写到、你自己定的边界。

## 真机步骤

合入前主会话看 `busy:0`；合入后 touch `core/src/assistant_manual.rs` 让 dev 重编 Core，另外重编替换 dev 的 CLI；手册等主对话 runner 下次启动才写进状态根。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 二进制里 grep 到新手册的小节；JC 走完下面几句后逐步查库：规则、第一期的到期与提醒、勾掉后的下一期、跳过后的下一期 | 在主对话里说一件每周或每月要办的事（内容自拟），看回复有没有把规则说清；过后说「这次的办完了」，看它勾掉并说下一次的日子；再说「这一次不用了」，看它跳过而不是删掉 |

## Comments
