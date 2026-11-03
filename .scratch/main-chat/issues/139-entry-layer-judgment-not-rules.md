# 139 派活条款收成几句判断；拆掉硬闸；评测改量结果

Status: needs-dogfood（2026-11-04 快进合入 `1b3e603d`。主会话验收：读过条款原文（报告第 1 节）、硬闸删除与 `is_managed_main_chat()`；同意多留「what you have found so far」（背景没有这一轮的工具结果）与第 13 条的判法；代理验证 workspace 1,334 条、runner 752 条与门禁过。评测 v5：派活判据 72 遍合格 66、`code_run` 上网 0、讲规则 0；事实 24 遍全自己上网查，差事 15 遍全自己做完；插话 12 遍里 9 遍下一步就在步骤里先说（8.7–15.6 秒），`tell_user` 0 次；写前读几步中位 3 → 2 步。要真机看：主对话自己上网、插话后的回音、记待办的步数）

来源：[主对话 PRD](../PRD.md) 裁决 186 第 3 条（「少规矩、多手」的收尾）。只在内置运行时的主对话；外置零变化（外置没有主对话）；IM 入口层不动（IM 自己养 agent）。

## 为什么

- 派活条款一个月定了六版（10-06、160、174、183、184、185），每次真机冒出新场景就补一句、换一条线；它们在替「主对话一次只能做一件事、做事时你够不着它」打补丁（裁决 186 第 1 条）。
- 三只手已经到位：插话改道（票 136，你跑着时说的话下一步就送到它面前）、先说一句（票 137，`tell_user`）、子任务带着这段对话出门（票 138，最近 10 轮作只读背景）。条款里替这些补的句子可以删了，判断交给模型。

## 要做到

### 1. 入口层派活一段（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）收成几句判断

现在的原文从「You do not go online in this chat, …」起，到「… which the user cannot see.」止（票 134 第四轮之后）。改成几句判断加两条准则，意思如下，措辞由你定，句子要短，照条款现有的写法：

- **判断**：你可以自己做（包括上网查），也可以交给子任务，几件同时做。用户随时能跟你说话，你下一步就看得到；他说的是别的事、手上的还要很久，就把手上的交出去先回他，或者先给他说一句（`tell_user`）再接着做。
- **准则一**：讲世上的事实（人物、事件、比赛、新闻、数据、价格、某人近况），先查、附出处，自己查或交出去都行；概念、道理、怎么做、看法、凭这段对话已有的，直接答（裁决 185 留下的那一半）。
- **准则二**：改他电脑或账号上的东西，照手册 `authority.md` 的三级授权（[助手 PRD](../../assistant/PRD.md) 裁决 3）。裁决 186 第 3 条写的「先问」是主会话的笼统说法，以三级授权为准，不新加规矩。
- **交出去时**：子任务会带着这段对话最近几轮（票 138），派活说明写目标、要交回什么和凭证就够，不用抄前文；删掉「a separate conversation that cannot see this one, so write everything it needs」和「(a subtask cannot see this conversation)」两处。标签与标题（`<subtask title="…">`）、并行那几句（一件一个标签；要合成一份交回的放一个标签；同一个标签页、同一批文件的不拆）、「告诉用户在路上」、不等也不盯、用这个而不用 `subagent.md`，照留。
- **删掉**：「You do not go online in this chat …」整句及其例外清单（天气、比分、curl）、「writing up what you two discussed」那条例外、「do not explain why it is not done here, cite a rule」那半句。「call this chat the main chat」那一点留下（裁决 173：内部叫法不进给用户的话）。
- **字节预算**（`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`）按新条款重定，照第三、四轮的做法写明分项；`\r` 不计。
- 上方文档注释补一段第五轮：裁决 186、为什么删这些句子、三只手各在哪。

### 2. 拆掉票 135 的硬闸

- `runner/handlers.py`：`_main_chat_refuses`、`MAIN_CHAT_BROWSER_REFUSAL`、`BROWSER_TOOL_PREFIX` 与 `dispatch` 里那一段删掉；测试跟着删改。
- `GALLEY_MAIN_CHAT` 环境变量**留着**：票 137 的 `tell_user` 靠它认主对话。核一下还有谁读它，文档里写明它现在的用处。
- 文档：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`、`prompt-composition.md` 里硬闸的条目改成「11-03 拆掉，裁决 186」。

### 3. 手册（`docs/managed-ga-runtime/galley-assistant-manual/`）

- 撤裁决 184 第 9 条的改动：`wake.md` 到点提醒要查东西时，可以自己查，也可以交给子任务（照判断）；巡看看备忘那条同样；`<no-reply/>` 规则里「提醒的查询交给了子任务」那种情况照留（交出去时仍适用）。
- `unasked.md`：「Quick work that needs no web you do this turn; …」改回不按上不上网分，照判断。
- `subtasks.md`：派活说明那几句随第 1 条改（子任务带着这段对话）；成品原样贴回那几句照留（裁决 183 第 4 条）。
- grep 全部手册，凡是「不上网」「交给子任务因为看不见这段对话」一类的句子都对一遍。

### 4. deferred

`docs/devlog/deferred.md`「主对话用代码上网」撤掉（主对话不再禁止上网）；`docs/project-status.md` 的未发版范围由主会话改。

### 5. 评测改量结果（`.scratch/main-chat/entry-layer-eval/`）

加一组 `v5`（新条款，提示词从 Rust 生成、与 `managed_prompt.rs` 一字不差），不带硬闸。判的是结果，不再判「第一个工具是不是浏览器」：

- **事实**（`fact` 那几条：伤病、讲讲、勇士主教练、天气、汇率、笔记软件）：查了（自己开浏览器，或派出去且说明里要出处）算合格；凭记忆直接答、没有出处算不合格。沙盒里浏览器不执行，停在浏览器那一步就算「自己在查」。
- **概念、怎么做、凭这段对话的追问**：直接答、不调工具算合格；`q-followup-quick` 照旧不计分。
- **差事**（整理、改名、写文件、下单类）：自己做或交出去都算合格，记下是哪种；碰到要授权的，看它有没有照 `authority.md`。
- **插话**：沿用票 137 的 `tell-user` 套件（插话写进 `intervene` 的做法），用 v5 重跑：插话后它多久让用户看到回音（`tell_user`、交出去先回、或者闷头做完），分类计数；不插话的短事、长事看有没有滥用 `tell_user`。
- **几件同时做**：`dispatch-parallel` 用 v5 重跑，看拆不拆、标签数。
- 到点提醒（`schedule/`）用 v5 重跑：查东西的提醒自己查或交出去都行，只提醒的照旧到点说。
- 模型写死 `mm_1792576875658`（API key 接入）；解释器用评测 README 写的系统 python3.14。额度够（JC 11-03），把结论跑扎实，用量写进报告。新条款有用例没过时，最多改一轮措辞、只重跑没过的，然后回报。

### 6. 可能追加

票 141 诊断建议在入口层「read the parts it needs, together」后点名写之前要同一步读的东西（查重的 `list`、改待办前的 `show`、相对时间的时钟），待 JC 定；定了我会发消息给你，放进同一轮措辞、同一次评测。评测放在最后跑。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-docs-links.mjs
git diff --check
```

改到 GUI 就加 `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui exec vitest run`（预计不用改 GUI）。worktree 里跑 runner 测试借主树的 venv，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。`rustfmt --check` 只查自己改过的 Rust 文件。真机 dev 由主会话合入后走。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t139-judgment-not-rules <scratchpad>/wt-139 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：GUI（除非测试要）、CLI、Agent API、迁移、IM 入口层、外置。
- Windows CI 检出是 CRLF：Rust 原始字符串的 contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t139-` 前缀。票面与结果里不写本机用户目录、worktree 路径、服务商名、接口主机；用例里的人名用虚构的（NBA 球员、公开的产品型号可以）。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：条款与手册的最终原文；字节预算旧值、新值、分项；改了哪些文件、哪些断言；评测每组每个用例三遍各自的结果、插话套件的分类计数、真模型调用次数；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

（2026-11-04，执行代理。分支 `t139-judgment-not-rules`，已 rebase 到 main `ab297508`（含票 142），无冲突。第 6 条（票 141 的乙）与主会话 11-04 的两条同步（rebase 保住票 142 那段；`tell_user` 说明改回 r1）都在这一轮里。）

### 1. 条款与手册的最终原文

入口层派活一段（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）：

```text
You can do the work yourself, on the web too, or hand it to subtasks,
several at once. The user can talk to you at any time: what they say
reaches you at your next step. When they bring up something else and
what you have in hand will take long, hand it off and answer them first,
or tell them a line now (`tell_user`) and carry on.
A fact in the world (a person, an event, a game, the news, a figure, a
price, how someone is doing lately): look it up before you answer,
yourself or by a subtask, and give your sources. An idea, a reason, how
to do something, your view, or what this conversation already answers
(what a subtask brought back included): answer it directly, without
looking it up again.
To change things on the user's computer or accounts, go by the three
levels of authority in `authority.md`.
To hand something off, end your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
When the user hands you several errands that do not depend on each other,
or one errand splits into parts whose results each stand on their own,
write one tag per part in the same reply: they run at the same time. Keep
in one tag what has to come back as one thing (a comparison, one table,
one report, the answer to one question) and the parts that need the same
browser tab or the same files.
Galley starts each after this reply, with this conversation's last turns
as background, so write the goal, what you have found so far, and what to
hand back, with the evidence for it (a confirmation number, a file path, a
link, a screenshot path).
Tell the user in a sentence that it is on its way, without calling this
chat the main chat. When it finishes, asks something or fails, Galley
wakes you to check it and tell the user, so do not wait on it or watch it.
Use this, not the file-based subagent in your memory (subagent.md), which
the user cannot see.
```

手册那段（第 6 条，票 141 的乙）在「`wake.md` and `subtasks.md` when Galley wakes you.」之后加一句：

```text
Run
with them, in the same step, what the parts will ask for: `todo list` or
`schedule list` before adding one, `todo show <todo-id>` before changing a
to-do, `todo list` to say what is left, and `date` for a time relative to
now.
```

- 措辞没有按评测改过（只改评测夹具，见 4）。
- 「what you have found so far」留着：背景（票 138）里是这段对话的用户话与回复，没有这一轮的工具结果，把手上的交出去时，已查到的只能靠派活说明带。票面写的「目标、要交回什么和凭证」之外多了这一项，请看。
- 删掉的：「You do not go online in this chat …」整句与例外清单（天气、比分、curl）、「Everything else you do yourself …」清单（含「writing up what you two discussed, even into a file (a subtask cannot see this conversation)」）、「as a separate conversation that cannot see this one, so write everything it needs」与其中的「the facts the user gave, what this conversation already settled」、「do not explain why it is not done here, cite a rule」。「call this chat the main chat」留下，写成「without calling this chat the main chat」。

手册（`docs/managed-ga-runtime/galley-assistant-manual/`）：

- `wake.md`「When a reminder comes due」：

  ```text
  - When it says to check something (a parcel, a price, the weather),
    check it before you speak, yourself or by a subtask. Handed to a
    subtask, write nothing for the user yet, the subtask tag and
    `<no-reply/>`, nothing else, and tell them when it is back, in one
    message, how late it came included.
  ```

  （删了「you do not go online here」与「Other long work goes to a subtask too」。）开头 `<no-reply/>` 那条照留：「Never write it in any other reply but two (both below): a reminder whose check you handed to a subtask, and the morning review's.」
- `wake.md` 巡看看备忘那条：「that changes (a team they follow, a policy they watch): look it up, yourself or by a subtask, and speak only when there is something they would want to know.」
- `unasked.md`：改回裁决 184 第 9 条之前的原话「Quick work you do this turn; longer work goes to a subtask (see `subtasks.md`), and when it is back Galley wakes you to tell the user.」
- `subtasks.md`：没改。它没有写派活说明的句子（票 138 Open risk 2 记过）；成品原样贴回那几句照留。
- grep 全部手册（online、web、cannot see、instructions、everything it needs、look … up、from what you know）：「不上网」只有上面三处；「交给子任务因为看不见这段对话」没有。`subtasks.md`「no browsing」是验收不重查来源，没动。

`tell_user` 的说明（`runner/tell_user.py`，主会话 11-04 要求）：改回票 137 评测的 r1 原话，「Send the user a message right away, without ending your turn. Useful when the user says something while you are working, or when what you are doing will take a while and they would want to know how it is going.」；中文「立即给用户发一条消息，不结束这一轮。用户在你干活时说了话，或手上的事要做很久、用户该知道进展时有用。」

### 2. 字节预算

`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`：旧值 4983，新值 4805，本机实测 4805（不留余量，`\r` 不计，入口层没有按平台分的内容）。分项（−178）：

- 开头 1059 → 809（−250）：判断 332（自己做或交出去、几件同时做；随时够得着、下一步看得到；交出去先回或先说一句）、准则一 368（事实先查附出处；概念、怎么做、看法、凭这段对话直接答）、准则二 107（照 `authority.md` 三级）、两处换行 2。
- 派活说明那句 361 → 247（−114）。
- 「on its way」那句 136 → 91（−45）。
- 手册那段同一步读的一句 +231（第 6 条）。

写在常量注释与 `docs/managed-ga-runtime/prompt-composition.md` 的预算一条里。

### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`：条款与手册那句；入口层上方文档注释首段补一句，末尾加第五轮两段（裁决 186、为什么删、三只手各在哪；票 141 的乙）；预算常量与分项。测试：`main_chat_entry_layer_hands_the_web_facts_and_changes_to_a_subtask` 改名 `main_chat_entry_layer_leaves_the_hand_off_to_judgment`，换成新原文的单行片段，另断言 `go online in this chat`、`curl`、`Everything else you do yourself`、`answering from what you know`、`even one you think you`、`cannot see this conversation`、`cannot see this one`、`write everything it needs`、`cite a rule` 都不在，`authority.md` 有「## Three levels of authority」，工作台与 IM 的提示词里没有这一段也没有 `tell_user`；`main_chat_entry_layer_sends_the_model_to_the_manual` 加手册那句的单行片段，并断言五处手册原文（`todos.md` 的 `todo list` before、`reminders.md` 的 `schedule list`、`todos-change.md` 的 `todo show <todo-id>` 与「run `todo list` first」、`times.md` 的 `date`）；`main_chat_entry_layer_is_main_chat_only` 跟着改一个片段。
- `core/src/assistant_manual.rs`：`manual_hands_web_checks_on_wake_to_a_subtask` 改名 `manual_checks_on_wake_by_judgment`（新原文五行，十个部分里都没有 `go online`、`needs the web`、`needs no web`）；`manual_wakes_with_what_is_of_use`、`manual_acts_unasked_and_reviews_each_morning`、巡看备忘那组钉旧句的片段跟着改。
- `core/src/runner_commands.rs`：只改注释（`MAIN_CHAT_ENV` 现在谁读：`tell_user`、步骤正文（票 142）、插话）与一条断言的说明文字。
- `runner/handlers.py`：删 `_main_chat_refuses`、`MAIN_CHAT_ENV`、`BROWSER_TOOL_PREFIX`、`MAIN_CHAT_BROWSER_REFUSAL` 与 `dispatch` 里那一段，`import os`、`managed_runtime` 不再用也删了；模块与类文档串改写，补一句票 142 那段做什么（只读，第一次派工具前把这一步的回复交给 bridge）。票 142 加的构造参数与那一段原样保住。
- `runner/managed_runtime.py`：新 `GALLEY_MAIN_CHAT_ENV` 与 `is_managed_main_chat()`（标记正好是 `1` 且内置运行时），注释写明谁读它。`runner/tell_user.py` 的 `offered_here` 与 `runner/workbench_bridge.py` 的 `_interjections_allowed` 都改走它（票 142 的 `_tell_step_text` 经 `offered_here` 也走它）。
- `runner/tell_user.py`：说明改回 r1（英文、中文），注释写为什么。
- `runner/tests/test_handlers.py`：删硬闸的 17 条（参数化展开后），加 `test_browser_tools_run_in_the_managed_main_chat_too`（主对话与非主对话各一，浏览器工具与 `file_read` 照常执行、结果不改）。`runner/tests/test_tell_user.py`：`MAIN_CHAT_ENV` 改从 `managed_runtime` 取；`test_the_main_chat_variable_is_the_browser_guards` 改名 `test_the_main_chat_variable_is_cores`；说明的断言钉 r1 原文，另断言那半句（中英）不在。
- 文档：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（「The Main Chat Does Not Browse」改成「The Main Chat's Browser Guard (Removed)」：11-03 拆掉、裁决 186，标记留着、现在给谁用；`tell_user` 一节的说明原文）、`prompt-composition.md`（开头 `GALLEY_MAIN_CHAT` 一句、入口层那条改写成「Do it yourself or hand it off, by judgment」、手册一条、预算一条）、`docs/ipc-protocol.md`（§6 例外改成 `tell_user`，硬闸写明拆掉；两处「与浏览器闸门同一组条件」改指 `is_managed_main_chat`）、`docs/ga-baseline.md`（契约面第 3 条与 `runner/handlers.py` 一条：`web_` 前缀不再是耦合点）、`docs/devlog/deferred.md`（删「主对话用代码上网」）。`docs/project-status.md` 没动（主会话改）。没动 GUI、CLI、Agent API、迁移、IM 入口层、外置。
- 评测（`.scratch/main-chat/entry-layer-eval/`）：`run.py`、三套的 `cases.json`、`dispatch-criterion/galley-prompt/main_chat.v5.txt`、各套件 `results.*`、新 `write-steps/`、`composed/` 新加的 v5 请求、`README.md`（见 4）。

### 4. 评测

模型 `mm_1792576875658`（API key 接入），解释器 README 写的系统 python3.14 加 `PYTHONDONTWRITEBYTECODE=1`；先 `--dry-test`。v5 由 Rust 现生成（临时测试，跑完删掉），`--dry-test` 核对入口层与 Rust 一字不差、与 v4 只差派活那一段和手册那句。v5 没有硬闸（v4 那句冻在 `run.py` 的 `GUARD_TEXT_V4`），浏览器工具在沙盒里不执行、运行停在那里，算它自己在查。判结果，按每条的 `v5` 标注（`V5_KINDS`：fact、direct、errand、either、self、handoff、self-web，见 README）。

**a. 派活判据 v5**（24 条 × 3）：合格 66、不合格 2、单列 1、不计分 3；第一个工具是浏览器 12 遍，`code_run` 上网 0 遍，给用户的字里讲规则或「主对话」0 遍。

| 用例 | 判法 | 三遍 |
| --- | --- | --- |
| q-injuries | fact | 自己上网查 ×3 |
| q-east | either | 自己上网查 ×3 |
| q-story | fact | 自己上网查 ×3 |
| q-weather | fact | 自己上网查 ×3 |
| q-notes-apps | fact | 自己上网查 ×3 |
| quick-usd | fact | 自己上网查 ×3 |
| quick-downloads | either | 自己看一眼答 ×3 |
| todo-note | self | 自己记下 ×3（2 次工具调用，第 2 步写） |
| conv-writeup | errand | 自己写 ×3 |
| e-invoices | errand | 自己整理完 ×3（4–6 次工具调用） |
| e-template | errand | 自己做完 ×3 |
| big-quotes | errand | 自己上网抓 ×3 |
| big-pdfs | errand | 自己整理完 ×3 |
| big-research | errand | 派 1 个 ×3（「本地笔记软件调研报告」「本地笔记软件同步与价格调研」「本地笔记软件同步与价格报告」） |
| ask-dispatch | handoff | 派 1 个「昨日 NBA 新闻」×3 |
| midway-invoices | errand | 自己归档完 ×3 |
| q-headphones | fact | 自己上网查 ×3 |
| q-fact-injury | fact | 自己上网查 ×3 |
| q-followup-quick | direct（不计分） | 上网核实 ×3 |
| q-followup-sourced | direct | 读两次子任务记录后上网核实 ×2（不合格）、读两次后答 1（单列） |
| q-recent-fact | fact | 自己上网查 ×3 |
| q-concept | direct | 直接答 ×3（0 次工具调用） |
| q-howto | direct | 直接答 ×3（0 次工具调用） |
| q-browser-insist | self-web | 自己开浏览器 ×3 |

- 事实 24 遍全是自己上网查，没有一遍派、没有一遍凭记忆答；差事 21 遍自己做 15、自己上网 3、派 3；72 遍里派出去 6 遍。自己做的差事没有删用户没要删的文件。
- `q-followup-sourced` 没过的原因是评测夹具：它去 `session show` 那件子任务，假 CLI 里没有记录，看不到出处，就上网核实（第三、四轮同一处）。加了 `q-followup-shown`（一字不差，只是假 CLI 里有那件子任务带出处的交回），v4 直接答 ×3；v5 直接答 1、读一次子任务再答 2（单列），没有上网。没为它改措辞。

**b. 并行 v5**（本票 7 条 × 3）：18 合格、3 不合格。几件差事 3 个标签 ×3；一件拆三块：3 个 ×2、自己做完 1；同一个标签页：自己开浏览器 ×3；同一批文件：自己做完 ×3；东西部的问题：自己上网查 ×3；写全出发地的订票加天气：2 个 ×3；`p-errand-and-question`：只派天气、订票先问出发地 ×3（不合格，v3、v4 同样）。标题都在、都合规。

**c. 到点提醒 v5**（`rem-parcel-online-v5`、`rem-water-only-v5` 各 3 遍，`check: self_or_subtask`）：6/6。查物流三遍都自己开浏览器去查，没派；喝水三遍都到点说一句。

**d. 插话（`tell-user`）v5**（8 条 × 3）：说明是改回的 r1，照票 142 把调工具那一步写在 `<summary>` 外的字算送到（读法同 `runner/step_text.py`）。插话用例 12 遍的回音：步骤里先说 9（`i-question`、`i-howlong`、`i-todo` 各 3，都在读到插话的下一步，8.7–15.6 秒）、下一步就回 1（`i-correction`，10.3 秒）、做完才回 2（`i-correction`，2 步，14.4–15.0 秒）；先说一句（`tell_user`）0、交出去先回 0。不插话的 12 遍没用 `tell_user`；`n-long`、`n-wait` 6 遍里 5 遍在调工具那一步写了一两句开场（142 之后会送到）。对照（被替换的第一遍：r2 说明、142 之前，步骤里的字不算送到）：先说一句 5（`i-howlong` 3、`i-question` 1、`i-todo` 1，11.6–35.1 秒）、下一步就回 1、做完才回 6（16.5–119.7 秒）。两遍里手上的长活都是自己做完，没有一遍交出去（票 137 的 v4 下几乎都派了）。

**e. 写之前读几步（第 6 条）**（`write-steps/`，待办、定时两套 7 条，v4、v5 各 3 遍）：第几步写的中位 v4 3、v5 2（平均 3.14 → 2.48）；共几步的中位 4 → 3；写之前读的步数中位 2 → 1；读手册与读清单分两步 13 遍 → 2 遍；秒的中位 32.2 → 41.6（没省）。`water-10min`、`move-time` 六遍都从第 3 步写变第 2 步；`note-report`、`remind-landlord-8am` 3 → 2–3；`tick-soil` 2–3 → 2；`quote-move`、`news-budget` 没少（第 2 步又补读另一部分手册，`reminders.md`、`authority.md` 或 `todos-change.md`，和一次清单）。派活判据里的 `todo-note`：v4 三遍第 3 步写（4 步），v5 三遍第 2 步写（3 步）。两套原有判定：两组一样，`note-report` 六遍「截止不对」是零点在星期三跑的日期问题；v5 `tick-soil` 一遍回复正文空。

**真模型调用**：195 次运行、582 次模型调用。派活判据 v5 72 次运行 171 次；`q-followup-shown` 6 次 8 次；并行 21 次 61 次；到点提醒 6 次 10 次；写之前读几步 42 次 161 次；插话 v5 24 次 83 次，被替换的第一遍 24 次 88 次。

**`--dry-test`**：除一条备忘到期的检查外全过。那一条在零点到一点之间跑会不过（In Hand 的「as of」是一小时前、跨了日子），main 上同样，没改。顺手修了 main 上一直不过的 7 条（第四轮 JC 改了 `q-notes-apps`、`q-followup-quick` 的标注，检查没跟上；换成 `q-concept`、`q-followup-sourced`）。

### 5. 验证

rebase 到 `ab297508` 之后，数字照抄输出：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1334 passed，0 failed，0 ignored。
- `.venv/bin/python -m pytest`（worktree 根目录借主树 venv，`GA_PATH` 指向 worktree 的 `managed-ga/code`，先确认 `runner.__file__` 在 worktree）：`752 passed, 6 deselected`。
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 43 source files`。
- `.venv/bin/ruff check runner`：`All checks passed!`。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`。另跑 `check-ipc-protocol-drift`（18 events、9 commands 三边对齐）、`check-ga-baseline-drift`（`OK (d66509bf)`）。
- `git diff --check main`：无输出。
- `rustfmt --check`：`managed_prompt.rs`、`assistant_manual.rs`、`runner_commands.rs` 干净（三份在 main 上本来干净）。
- `run.py --dry-test`：1211 条 PASS、1 条 FAIL（零点那一小时的备忘到期检查，见 4；同一函数在 13:38 跑是过的）。
- `managed-ga/` 下没有 `__pycache__`；新增行没有本机用户目录、临时目录、密钥、服务商名或接口主机；全角标点扫过新增行，命中的只有英文注释里夹的「乙」「派出去」一类中文词。

### 6. 看到但没改的（Open risks）

1. **v5 下主对话几乎什么都自己做**：派活判据 72 遍只派 6 遍（`big-research`、明说派的）；事实 24 遍全自己上网；整理发票、按内容归档 PDF 这类差事 15 遍自己做完。裁决 186 第 4 条接受了「主对话重新会被占住」，但评测里没有插话，看不出它在你插话时会不会交出去；插话套件里 12 遍长活也全是自己做完、没有一遍交出去（回音靠调工具那一步的字）。真机上一件十分钟的差事会占住主对话十分钟。
2. **`q-followup-sourced` 两遍上网核实**：假 CLI 看不到子任务记录时，它不信上一轮带回的结论、自己去查；看得到时（`q-followup-shown`）不上网，但三遍里两遍多读一次子任务记录再答（多一步）。真机上子任务记录若被清（引擎日志 30 天）或读不到，会照前一种走。
3. **`p-errand-and-question`**：订票缺出发地时只派天气、订票先问，三轮都一样；按标签数判不合格，内容上说得通。
4. **写之前读几步：步数少了，秒数没少**：中位第几步写 3 → 2、分两步 13 → 2，秒的中位反而 32.2 → 41.6（同一批同时跑，单步更长）；每条 3 遍，样本小。`quote-move`、`news-budget` 没少步（第 2 步补读另一部分手册）。
5. **插话套件里「步骤里先说」是推的**：按 `runner/step_text.py` 的读法从评测记下的回复正文算，时刻取那一步第一次派工具；没有经 runner、Core 与界面，真机上那句话什么时候出现、和三点怎么排没测。`tell_user` 在 v5 下 12 遍插话用例用了 0 遍，回音全从步骤正文来；叫醒的轮次（票 142 不送步骤正文）里它还用不用 `tell_user` 没测。
6. **`authority.md` 那条准则没有用例真正碰到**：沙盒里下单、发东西都停在浏览器；整理文件时没有一遍删用户没要删的文件。`authority.md` 的三级大多讲 Galley 的会话、待办、定时；用户电脑上的文件只写了「删除先问」，整理、改名、挪动由用户的直接要求算同意（`authority.md` 开头那句），条款没有另加规矩。
7. **派活说明不再抄前文**：靠票 138 的背景（最近 10 轮、15,000 字）。评测里子任务不跑、背景没模拟，没验证派活说明变短以后子任务做得对不对；超过 10 轮之前定下的事只能靠派活说明里的「what you have found so far」或模型自己写进去。
8. **到点提醒自己查**：`rem-parcel-online-v5` 三遍都自己开浏览器，一次提醒到点会在主对话里开一段浏览器，用户可能不在跟前，也可能正要说话（插话照样送得到）。
9. **`code_run` 上网不再有任何拦或记**：`deferred.md` 那条撤了，按裁决 186 这是允许的；评测里 v5 也没出现。
10. **GUI 测试里一处注释还写着主对话不上网**：`gui/src/lib/assistant-conversation.test.ts:580`（票 134 第三轮加的 vitest 的注释），只是注释，测试本身（只派活加 `<no-reply/>` 的提醒叫醒不画）仍成立；票面不让动 GUI，没改。
11. **`docs/project-status.md`** 的未发版范围（硬闸、上网就派、`tell_user` 说明那半句）没改，留给主会话。
12. **评测的旧套件**：`--dry-test` 里 7 条过时检查顺手修了；零点那一小时的备忘到期检查没修（`sched_memo_lines` 用一小时前作 as of）。`note-report` 的「截止不对」是星期三零点跑的日期问题，判定没改。
13. **`v5` 判法是我定的**：`q-east`（东部预测）标 either、`quick-downloads` 标 either、`conv-writeup` 标 errand、`q-browser-insist` 在 v5 下计分（自己开浏览器才合格）、`q-followup-quick` 在 v5 下仍不计分；派出去的事实要求派活说明里有「出处、来源、链接、网址、引用、url、source、link、http」之一。请看是否同意。

## Comments

- 2026-11-04 00:42–00:46 主会话 dev 真机（真实模型，屏幕锁着，用 CLI 发、查库；新 Core 带 139、142）：
  1. 「勇士现在的主教练是谁？」：自己开浏览器查，10 步、91 秒，一条消息，附官方公告出处，没派子任务。
  2. 「明天上海天气怎么样？」12 秒后插话「后天的也一起说一下」：第 2 步后读到，改成一起查两天，30 秒一条表格回复，附中国天气网出处。这一轮短，读到插话后 14 秒就答完，中途没有先说一句。
  3. 「十分钟后提醒我喝水」：3 步、24 秒；第 1 步就把手册、时间与已有提醒一起读完（裁决 192），第 2 步设提醒，第 3 步回复。旧数据同一句 3 步、31 秒、读两次手册。测试提醒已用 `schedule delete` 撤掉。
  4. 「讲讲 2019 年东部半决赛抢七，伦纳德那个四次弹框的绝杀」25 秒后插话「简短点，三五句话就行」：第 3 步后读到（发出后 7 秒），下一步的进展小字是「按三五句话简述……」，27 秒后四句话的回复。中途没有 `tell_user`，步骤正文也没有 `<summary>` 之外的字，所以没有先说的一句。
  界面没截到（锁屏），气泡、进展小字的位置等 JC 在 dev 里看。

- 2026-11-04 06:34–06:36 主会话 dev 真机补测 Open risk 1（真实模型，CLI 发、查库）：发裁决 183 那句「帮我比较 Meze 109 Pro 和森海塞尔 HD490PRO 这两款耳机，整理成一张表」，35 秒后插话「对了，现在美元兑人民币汇率是多少？」（要上网的插话，评测四种插话都是马上能答的，没有这一类）。
  1. 没派子任务。前 4 步 43 秒查完两家官网规格；第 4 步后读到插话（发出后 8 秒）。
  2. 读到后没有先说：没有 `tell_user`，步骤里也只有 `<summary>`（「耳机规格已核对；再查最新美元兑人民币汇率，一起给你」只在进展小字里）。接着 4 步查汇率（Google 搜索后打开 Wise 核实），第 9 步一条回复：汇率在前、附出处，耳机表在后、附四个出处。
  3. 从发出到回复 118 秒；插话到回复 75 秒，查汇率本身占了约 60 秒。
  4. 副作用：第 8 步顺手 `memo add`「看你多次比较 Meze 109 Pro 和森海塞尔 HD 490 PRO……」，理由是同一对耳机问了至少三次。那几次是冒烟与这次测试问的，不是 JC 的兴趣，已用 `memo delete` 删掉。
  5. 读法：这件「比较整理成表」在主对话里一分钟出头就做完，不是十分钟的差事；插话也要上网时，它并进同一条回复，没有交出去，也没先说一句。十分钟级的差事（本机整理发票 623 秒那类）带插话还没在真机测。
