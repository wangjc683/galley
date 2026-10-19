# 63 到点时说此刻有用的话（规则挪进 `wake.md`、Core 叫醒说明改措辞）；今晚就去的事不主动跟、提醒不定在开始那一刻；没写就不说「记下了」

Status: ready-for-agent

来源：主聊天 PRD 裁决 115（2026-10-19，JC 读票 60 评测后：「按你推荐推进」）。依赖 60（已合入）。改手册（`wake.md`、`reminders.md`、`todos.md`）、入口层一句、Core 的叫醒说明（`core/src/subtask_report.rs`）与入口层评测；清单、CLI、数据、GUI、runner、`managed-ga/code` 不动。

## 起因（票 60 评测）

1. **到点时的规则没送到它眼前。** 票 60 把「Do not recite it … think what is of use to the user now」写进了 `reminders.md` 的「When one comes due」。可叫醒时入口层让它读的是 `wake.md` 与 `subtasks.md`（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）。`wake-reno` 两遍都没读 `reminders.md`：一遍只读了 `wake.md`，一遍什么都没读，没复述靠的是模型自己。每次叫醒都在眼前的是 Core 的叫醒说明：
   - `core/src/subtask_report.rs` 的 `todo_due_paragraph`（约 456 行）写着「The to-do is the user's own, something they have to do」与「remind the user of it in a sentence or two」，装修完工这种不用用户自己办的事对不上；
   - `due_paragraph`（约 404 行，它自己的提醒）写着「tell the user in a sentence or two」。
2. **两可用例**：「今晚 7 点和朋友吃火锅」两遍都记成待办，提醒就在 7 点整，等于到点才提醒；两遍的下一步建议都是「帮我把火锅提醒改到 6 点 58 分」。医院复查、孩子开学的做法 JC 认可。
3. **「公司成立日」第 2 遍**没有任何工具调用，回复却是「记下了」。

## 一、Core 的叫醒说明

`core/src/subtask_report.rs`：

- `todo_due_paragraph`：「something they have to do」改成清单上的事，不论要不要用户自己办（要办的、或某天会发生、用户想到时听到的）；「remind the user of it in a sentence or two」改成说此刻对用户有用的话，不把标题念回去（例如问一句办好了没、发生了没，或给下一步）。待办的提醒只提醒、用户说办完或发生了才勾，这层意思要留（现在靠手册，挪到 `wake.md` 后照留）。
- `due_paragraph`（它自己的提醒）：「tell the user in a sentence or two」同样改成说此刻有用的话。
- 措辞自定，英文，口吻同现有说明，尽量短；迟到那句（`due_when_and_act`）与 `NO_REPLY_END` 不动。
- 相关测试（约 1749–1803 行）跟着改，Windows 检出是 CRLF，`contains` 只用单行片段。
- 这段说明只在主对话的叫醒里出现，外置运行时没有主对话；回报里确认没有别的调用方（grep）。
- **改了 runner 接缝式的措辞要全仓 grep 旧句**：`.scratch/main-chat/entry-layer-eval/` 里拼叫醒消息的镜像（`run.py`、`wake/wording.md`、各套 `cases.json` 里写死的叫醒文字）都要跟着改，`--dry-test` 能逐字对比的要对上。

## 二、手册

1. **「When one comes due」整节从 `reminders.md` 挪进 `wake.md`**（叫醒时它读的是这一份）。`reminders.md` 留一句指向 `wake.md`。挪的时候看一遍和 `wake.md` 现有的「When Galley wakes you」有没有重复，重复的合并，别留两套说法。`assistant_manual.rs` 里断言规则在哪一部分的测试与跨部分引用计数跟着改。
2. **`todos.md` 第③条加一种不跟的**：今晚就去、刚说出口、没什么要准备的安排（「今晚 7 点和朋友吃火锅」）用户自己记得，不主动跟。和医院复查（要带报告）、孩子开学（要备用品）分清楚：分界是到时有没有要准备或要想起来的事，不是远近。用户明说「记一下」照底线进清单。
3. **它自己选提醒时间时不定在事情开始那一刻**：要准备或要出门的，按要多久提前；用户点了提醒时间的照他说的（「明天早上 8 点提醒我给房东回电话」）。合进 `todos.md` 现有的「hang one reminder on it with `--remind-at`」那条，不另起一段。
4. 措辞、口吻、密度同现有手册；中文例子照现有写法放在「」里。

## 三、入口层

`main_chat_entry_layer` 加一句底线：这一轮没有写下任何东西（待办、它自己的提醒、记忆）就不说「记下了」一类的话。要放在入口层，因为出错的那一轮什么都没读（手册里写了也看不到）。措辞自定，尽量短；照 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 注释的写法补「Raised 2568 → M by ticket 63」并写理由。工作台、IM 提示词不变，`prompt_hash()` 不变（改前改后各打印一次，回报里贴）。

## 四、评测（`.scratch/main-chat/entry-layer-eval/`）

先修两个老问题（票 59 留下的）：

- 叫醒套件「结果够好」那条的报价日期写死在 10-15 那一周，换个日子跑就被当成上周的；改成相对运行日期。
- 假 CLI 不认 `--ensure-runner`：照真实 CLI 的 `--help`（`wake/cli-help.json`）补上。

新用例（判定写进 `expect`，每条两遍）：

- **待办套件**：
  - `hotpot-tonight`：「今晚 7 点和朋友吃火锅」→ 不设待办、不设它的提醒。
  - `hotpot-asked`：「今晚 7 点和朋友吃火锅，记一下」→ 进清单；挂提醒的话要早于 19:00（判 `remind_at < 19:00`）。
  - `hospital-tomorrow`：「明天去医院复查」→ 跟进，提醒在前一晚或当天早上（原来是两可，现在判定）。
  - `school-monday`：「下周一孩子开学」→ 跟进，提醒在开学前一天。
  - `meeting-3pm`：「下午 3 点要和客户开会，记一下」→ 待办，提醒早于 15:00。
  - `founding-date`（已有）加判定：回复里有「记下了 / 记住了 / 记好了 / 已记」时，这一轮必须有写（CLI 写命令，或写进记忆文件）。评测现在看不到写记忆的话，补上记录。
  - `remind-named-time`（照现有「明天早上 8 点提醒我给房东回电话」那条的判定）：确认第 3 条没把用户点的时间改掉。
- **到点（定时与待办套件里拼叫醒的那几条，用改后的 Core 措辞）**：
  - `wake-reno`（已有）：判不复述（回复不是以「提醒：」开头、不是标题原话）、有一问或一步、不勾、不出 `<no-reply/>`；回复原文贴进回报。
  - `wake-offer`：它自己的提醒「问问 offer 结果」到点 → 问一句结果怎么样；不勾任何东西。
  - `wake-surgery`：它自己的提醒「问问妈妈手术情况」到点 → 问候一句，口吻温和，不念提醒原话；回复原文贴进回报。
  - 叫醒时读了手册哪几部分、读没读 `wake.md`，照票 59 的 `manual_reads` 记下来。
- **不退步**：待办、定时、叫醒三套原有用例全部重跑，通过率不低于票 60 重跑后的结果（叫醒以票 59 的 16/18 为准，修掉日期后应是 18/18）；`chat/` 的 15 条闲聊用例跑一遍，`personal-surgery`（「我妈明天做手术，有点紧张」）照现在的做法（设次日问候并说出来）算过。
- 跟票 59、60 一样记下每条读了手册的哪几部分、多少字节、几次请求、用时。
- 结果文件里不能出现私有接口地址、API host、本机绝对路径。

## 别动

- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`、`runner/`、`managed-ga/code/`、`cli/`、数据与迁移。
- 别的提示词层：静态规则、建议、State、Main Chat 节、In Hand、IM；入口层只加第三节那一句。
- 手册里与本票无关的部分（权限、CLI、交代、改待办）。
- `core/` 不是 rustfmt-clean：只对自己改过的文件跑 `rustfmt --check`，改前先看基线差异数。提交只点名文件，`git add … && git commit …`。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`；`cargo test --manifest-path core/Cargo.toml --workspace` 在 `TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍（带条数）；改过的文件 `rustfmt --check`；`git diff --check`。
- `run.py --dry-test`，再按「四」真跑。
- 中文全角标点（自写脚本扫新增行，文件名带 `t63-` 前缀）。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. Core 叫醒说明两段的新旧原文；手册 diff 原样；入口层新句、字节数、预算注释；`prompt_hash()` 前后。
3. 验证命令与结果原样。
4. 评测：新用例逐条结果；`wake-reno`、`wake-offer`、`wake-surgery` 的回复原文；三套原有用例的「票 60 → 本票」对比（通过、请求次数、用时、读手册字节）；叫醒时读没读 `wake.md`；闲聊组。
5. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

## Comments
