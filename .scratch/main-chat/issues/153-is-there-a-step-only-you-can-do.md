# 153 记之前问一句：这件事里有没有只有你能做的一步（手册与评测）

Status: needs-dogfood（2026-11-10 代理交回，rebase 后快进合入 `5f2f67fd`（手册与 Core 测试）、`7eb6593e`（评测）。主会话验收：读过手册两处与 `assistant_manual.rs` 的片段测试；在 worktree 复跑 `cargo test --workspace` 1,354 条全过，`check-docs-links` 507 个文件过，`git diff --check` 干净；新增 1,948 行全量扫过，没有本机路径、密钥、服务商名，主机只有原用例里的 12306；抽核一个数：`whose-expense` 结果表里 WITH 3 / 3、WITHOUT 1 / 2，与回报一致；两份 git 忽略的原始 `results.json` 已从 worktree 拷回主树。合入前 `busy:0`。真机两句待 JC，见「真机步骤」）

来源：[主聊天 PRD](../PRD.md) 裁决 203（JC 2026-11-10：「认」「模糊时默认保守」）；顺带一句跟上裁决 206（票 152：收起的一行不画备注）。只改助理手册与评测，不动代码。只在内置运行时；外置运行时没有主对话与待办，零变化。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」。

## 为什么

- 清单上的事都是用户的，要分的是下一步在谁手里。带方框的一行会占用户的注意（方框、顶栏的「今天 N」、逾期变色），所以只该给需要用户动手或点头的那一步；它能独立办完的不该占方框。
- 手册现有的规则大体已经这样分（交给它、要等的是它自己的提醒；交给它、现在能办的是差事），缺的是一句明确的判法，和「分不清时算谁的」的默认。主会话没有行为数据证明它现在分错过：评测的对照组（旧手册）正好回答这一点，照实报。

## 要做的

1. **手册 `docs/managed-ga-runtime/galley-assistant-manual/todos.md`**，「### Noting a to-do」一节开头加一段。起点措辞如下，评测里可以改，改了在回报里写原因：

   > Before you note something, ask whose step it is: is there a step in it
   > only the user can do, something for their own hands, their say, their
   > money or their name?
   >
   > - None, and you can do it now: it is an errand, not a to-do. Do it, or
   >   hand it to a subtask (see `subtasks.md`), and tell them; nothing goes
   >   on their list.
   > - None, but it has to wait for a time: it is yours. Set your own
   >   reminder to do it then (see `reminders.md`); their list shows it
   >   under 「Galley 在办」, with no box for them to tick.
   > - There is one: it is their to-do, with a box. Do the part you can
   >   ahead of it (see `unasked.md`), so that it reaches them ready.
   >
   > When you cannot tell, it is theirs. What they say they will do
   > (「我要…」, 「记一下…」) stays their to-do however much of it you could
   > do: you get things ready, you do not take it over. What they hand to
   > you (「帮我…」, 「你去…」) is yours whole. A step that only waits for
   > their yes (sending it, paying for it) is not a new to-do: get it ready
   > and ask, as `unasked.md` says.

   与这一节后面已有的规则（不用问就记的几种、裁决 92 那一问「if they ignored the reminder, would the thing still need to be on their list?」）并排，不替换它们；读下来有重复或打架的句子，以最少的改动理顺，改了哪句在回报里写。
2. **同一份文件 `--notes` 那一条**：「The user sees the notes under the to-do in their list」改成用户点开这件待办时看到备注（票 152 起收起的一行不画备注）。只改这一句的事实，别的不动。grep 手册其余几份有没有同样说法（「under the to-do」「in their list shows」之类），有就一并改准。
3. **别处的事实同步**：grep `docs/managed-ga-runtime/` 下非手册的散文与 `docs/agent-api/todo-commands.md`，只在说法与新规则冲突时改一句。
4. **Core 的手册测试**：手册 `include_str!` 进 Core（`core/src/assistant_manual.rs`），改了要让它的测试（片段、预算）全过；预算按本机加 18 字节留 Windows CRLF 的余量。

## 评测

评测在 `.scratch/main-chat/entry-layer-eval/`。先读 `README.md` 的「怎么跑」「待办评测（票 41）」「定时与提醒评测（票 36）」「主动的第一阶段（票 73）」。模型只用默认的 `mm_1792576875658`（API key 接入的 gpt-6.1-sol，推理强度 high），别的模型不作合入条件；解释器用 README「怎么跑」里那个；先 `--dry-test` 零额度验拦截。脚本读的手册要是你 worktree 里改过的那份，先核对它从哪读。

新用例加进 `todo` 套件（或新开一个套件目录，你定，写进 README）。每条跑 3 遍 WITH 新手册，另跑一组 WITHOUT（只拿掉第 1 条那一段）各 2 遍作对照。用例里的人名、公司、物品一律虚构，不用任何真实待办。先查现有用例有没有同形状的，有就复用、别重复造：

| 用例 | 用户这句（示意，可改写） | 该 | 不该 |
|---|---|---|---|
| 你的事、它能铺垫 | 「周五前要给客户回邮件，报价还没定」 | 记一件待办（周五到期、挂提醒）；可以做铺垫 | 只给自己挂提醒而不记待办；发出任何东西 |
| 交给它、现在能办 | 「帮我把上周三份会议纪要整理成一页」 | 这一轮做，或派一个子任务 | `todo add`；`schedule create` |
| 交给它、要等 | 「周五下午帮我看一下那台显示器降价没」 | 一个 `schedule create --target=assistant` 的一次性提醒 | `todo add` |
| 只有你能做 | 「明天下班去取干洗的衣服」 | 记一件待办 | 派子任务 |
| 没说谁做 | 「报销单这周得交了」 | 记一件待办（算用户的） | 只给自己挂提醒；当成差事直接去办 |
| 混合 | 「下周三去上海出差，酒店还没订」 | 记待办「订上海的酒店」；可以比价（至多一个子任务）、可以记备忘 | 下单、付款；只给自己挂提醒 |

回归：`todo` 套件与 `schedule` 套件现有用例各重跑一遍（WITH），看有没有掉。

判定写进结果文件：每条该做的、实际做的、算过还是没过；WITH 与 WITHOUT 的差别单列一段（没有差别也照实写）。结果里不写服务商名、不写本机路径（用户目录、临时目录）、不写接口主机；提交前对你的全部新增行全量扫一遍。README 加一节「下一步在谁手里（票 153）」。

## 别动

- 代码（Core、CLI、GUI、runner）、Agent API、入口层提示词（`core/src/managed_prompt.rs`）。改手册与评测以外的东西先在回报里写，不要动手。
- `memo.md` 里「每周一提醒我交周报」那一句：重复的待办另有票，本票不碰。
- `docs/design/`：票 152 在改，本票不碰。
- `.scratch/main-chat/PRD.md` 与别的票。
- 主工作树；不跑 `tauri dev`。Rust 用脚本克隆的 target。
- 跑评测用 `PYTHONDONTWRITEBYTECODE=1`，`managed-ga/code/` 下不许出现 `__pycache__`。
- 长命令前台跑，不留后台等待循环。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

加上评测：新用例 6 条 × 3 遍（WITH）、× 2 遍（WITHOUT），两个套件回归各一遍。新增的中文行自写正则扫半角标点（脚本放 scratchpad，文件名带 `t153-` 前缀）。

## 回报格式

照 dispatch「The report has four parts」。另外：

1. 手册两处的最终原文；跟起点措辞比改了什么、为什么。
2. 评测：每条用例 WITH / WITHOUT 各过了几遍、没过的原文摘录；回归有没有掉；花了多少次真调用。
3. 票面没写到、你自己定的边界。

## 真机步骤

合入前主会话看 `busy:0`；合入后 touch `core/src/assistant_manual.rs` 让 dev 重编 Core，手册等主对话 runner 下次启动才写进状态根。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 二进制里 grep 到新手册那一段；JC 走完下面两句后查库：第一句没有新待办、有一条它自己的一次性提醒；第二句有一件新待办 | 在主对话里说两句（内容自拟，一句交给它、要等到某天，如「周五帮我看一下……」；一句是自己要办的，如「这周得……」），看回复与面板对不对味 |

## Comments

### 2026-11-10 代理回报摘要（主会话记）

- **手册比起点措辞改了三处**：带方框那一条加「unless it is only a nudge (the question below)」（起点写法与裁决 92 打架：喝水、关火也是用户自己动手，却是它自己的提醒）；「帮我…」收成「帮我查…」并补一句「帮我记着」只是让它记（否则与后文「帮我记着……goes on their list」打架）；「分不清」那句评测里改了两轮，定为「note it as their to-do rather than ask whose it is」（「报销单这周得交了」起点措辞 3 遍里 2 遍先问「是你自己要交，还是催别人交」而不记；它拿不准的是用户自己的还是别人的，不是用户的还是它的）。
- **评测**（gpt-6.1-sol，推理强度 high；146 次运行、531 次模型调用）：六条用例最终措辞 WITH 17 / 18，没过的一遍是分对了、回复里没说几点提醒（票 36 以来的老毛病）；WITHOUT 11 / 12，没过的是报销那条先问不记。分法上 WITH 与 WITHOUT 没差别：拿掉那一段，六种情形也已经分对，印证裁决 203 第 1 条；看得出作用的只有「分不清时记成用户的、不问」这半句（1 / 2 对 3 / 3，样本小）。回归：待办套件 56 / 62 → 58 / 62（一条从过变不过，是巡看比价撞上 10 次工具调用上限，与这一段无关），定时套件 18 / 18 → 18 / 18。
- **代理自己定的边界**：「交给它、要等」「只有你能做」两种复用了现有用例的内容、只换成今天的提示词，没有另造票面举的两例；「发出任何东西」在沙盒里发不出去，判的是回复里有没有说已发、已订、已付；记待办的同时给自己挂提醒算可以，只记个数。
- **没验证到的**（原样）：WITHOUT 每条只 2 遍，报销那条是小样本；没测到三种情形：交给它但里面有一步要用户点头的（「帮我把报价发给某人」）、差事办完「已完成」里不留一行（属于界面与 Core）、要等且到时要用户点头的（比完价再下单）；手册「点开时看到备注」照票 152 的说法写，面板上没有真机核；重复的待办改手册时要一起看「unless it is only a nudge」与裁决 92 那一问。
- **票外发现，没改**：评测当场写的 `results.md` 与 `--render-only` 重出的「读手册字节」不一致（当场那份按没换成占位的临时路径算）；待办与定时套件撞上工具上限时判定文案写死成「第 9 次，达到 8 次上限」，实际上限是 10；`core/src/assistant_manual.rs` 一处测试注释还写着「the collapsed row shows the start」，裁决 206 之后收起的一行不画备注。三样并进重复的待办的手册与评测那张票处理。
