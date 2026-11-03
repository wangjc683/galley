# 134 派活更积极：除了一两步答得完的，都派子任务；答案型成品原样贴回

Status: needs-dogfood（2026-11-03 与票 135 一起快进合入，`dd81b864`…`629f404a`。三轮：183 的按性质分、Core 叫醒那句与成品贴回、184 的上网就派与提醒巡看不上网。主会话验收：读过入口层条款、`subtask_report.rs` 那句与手册三处 diff；把 135 叠上来以后在 worktree 里 `cargo test --workspace` 1,303 条过、runner 674 条过、mypy、ruff、六个门禁脚本过，`diff --check` 干净、新增行没有本机路径。评测 v3：60 遍里第一个工具是浏览器 0 次、用代码联网 0 次；成品贴回表格 3/3；到点提醒 6/6；三轮共 692 次真调用。要真机看：要上网的问题派出去并带标题、成品原样贴回、到点要查东西的提醒先不出声后一条、凭知识答的讲讲自己答）

来源：[主对话 PRD](../PRD.md) 裁决 183（修正裁决 160 第 2、3 条）。只改入口层提示词、手册 `subtasks.md`、对应 Core 断言，和评测；不动 GUI、runner、CLI、Agent API、迁移。外置运行时零变化（外置没有主对话）。

## 为什么

- 裁决 160 把派活判据定成「你在不在等」：你问的它自己答，哪怕要查几分钟。v0.7.5 草稿冒烟时，「帮我比较 Meze 109 Pro 和森海塞尔 HD490PRO 这两款耳机，整理成一张表」被主对话自己答了：13 步、4 分 4 秒，这几分钟主对话被占住。按 160 的条款这样做是对的（回复里的一张表是答案，不是「一件东西或一个改动」）。
- JC 改了取舍：除了一两步答得完的简单事（查天气那种），都派出去，主对话保持空着；要查好几处才讲得清的「讲讲某件事」也派；能拆成互不相干的几块就并行。
- 派出去以后，子任务的回答要回到主对话里给用户看。手册现在写着「Do not paste the subtask's answer」，表会留在子任务里，要用户点回执才看得到。

## 要做到

### 1. 入口层条款

把 `main_chat_entry_layer`（`core/src/managed_prompt.rs:479` 起，`Answer what the user asks you yourself` 到 `which the user cannot see.` 那一段）换成下面这段。措辞可以为字节预算或读起来顺而收紧，意思不能变；改了哪里写进报告。

```text
Answer yourself only what takes a step or two: a single fact (the
weather, a score, whether someone is injured), a quick conversion, a
follow-up you can answer from what is already in this conversation.
Everything bigger goes to a subtask, so this chat stays free for the
user: a thing to hand back (a table, a list, a comparison, a report, a
file), a change on their computer or accounts (files sorted or renamed, a
booking, a form filled), and a question or story that needs several
places looked up (what happened in some event, a ranking, a prediction).
So does anything they ask you to hand off. End your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
When the user hands you several errands that do not depend on each other,
or one errand splits into parts whose results each stand on their own,
write one tag per part in the same reply: they run at the same time. Keep
in one tag what has to come back as one thing (a comparison, one table,
one report, the answer to one question) and the parts that need the same
browser tab or the same files.
Galley starts each after this reply, as a separate conversation that cannot
see this one, so write everything it needs: the goal, the facts the user
gave, what this conversation already settled that the request leans on,
what you have found so far, and what to hand back, with the evidence for
it (a confirmation number, a file path, a link, a screenshot path).
Tell the user in a sentence that it is on its way. When it finishes, asks
something or fails, Galley wakes you to check it and tell the user, so do
not wait on it or watch it. If something you took for quick turns out
bigger partway through, stop there and hand the rest over the same way.
Do it yourself when the errand's material is this conversation (writing up
what you two discussed), and when it is a to-do, a reminder or a memo. Use
this, not the file-based subagent in your memory (subagent.md), which the
user cannot see.
```

- 同步改 `main_chat_entry_layer` 上方讲这段的文档注释（`managed_prompt.rs:360-475` 一带讲裁决 160、174、175 的几段），写明裁决 183 / 票 134 改了什么、为什么。
- 更新测试模块里钉着旧原文的断言（`:1420-1500` 一带的 `main_chat_entry_layer_answers_questions_and_hands_errands_to_a_subtask` 等，含 `:1490` 用 `Answer what the user asks you yourself` 做锚点的位置断言），换成新句子里的单行片段（Windows 检出是 CRLF，`contains` 别跨行）。测试名跟着改成说得对的名字。
- 入口层与静态提示词都有字节预算测试（`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`、`STATIC_PROMPT_BUDGET_BYTES` 等）。超了先收紧措辞；实在要抬预算，报告里写清旧值、新值、本机实测长度（Windows 比本机长 18 字节，预算按本机 +18 设）。
- `grep` 全仓旧原文（`Answer what the user asks you yourself`、`do not split a question`），会被测试或评测加载器当成镜像读的地方一并改；`.scratch/*/entry-layer-eval/` 下各套件已经生成好的 `galley-prompt/`、`composed/`、结果文件是历史快照，不改。用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。

### 2. 手册 `subtasks.md`

`docs/managed-ga-runtime/galley-assistant-manual/subtasks.md` 的「Checking a result and reporting it」一节，把

```text
- Lead with the result in a sentence or two and name the evidence (the
  number, the full file path, the link). Do not paste the subtask's answer
  or retell how it got there.
```

换成下面的意思（措辞可收紧）：

```text
- When what the user asked for is the answer itself (a table, a list, a
  comparison, an account of something), give it to them in full as the
  subtask wrote it, without its notes on how it got there. When it is
  longer than a screen or so, or is a file, give the gist and where the
  whole is (the full file path).
- Otherwise lead with the result in a sentence or two and name the
  evidence (the number, the full file path, the link); do not retell how
  it got there.
```

- 叫醒的报告里本来就带子任务最后的回答，最多 3,000 字，超出写明怎么读全（`core/src/subtask_report.rs:129`、`:781-791`），所以这里不用改 Core。
- Core 里钉手册原文的断言（`core/src/assistant_manual.rs` 的测试模块）跟着改。手册有字节预算的话同上处理。
- `wake.md` 默认不动；若「Do what it says, then reply to the user」一带与新规则打架，写进报告，不要顺手改。

### 3. 评测

都在 `.scratch/main-chat/entry-layer-eval/` 下，沿用 `run.py`（README「派活判据（票 115）」「并行派活（票 127）」「叫醒措辞评测（票 30）」各节的做法）。提示词都由 Rust 的 `compose_main_chat_runtime_prompt` 生成（README「改了 Rust 提示词之后」那段的临时测试做法，跑完删掉临时测试，产品代码不留改动）。

**a. 派活判据**：`dispatch-criterion/` 加一组 `v2`（本票改过的提示词），与现有 `new`（main 上今天的，即裁决 160）对照；`old` 组不再跑。标注按裁决 183，旧用例改标的照下表，新加的三条用例写进 `cases.json`：

| id | 消息 | 上下文 | 183 下该派吗 |
|---|---|---|---|
| q-injuries | 沿用 | — | 是（要查好几处） |
| q-east | 沿用 | 沿用（上一轮问西部） | 是；派活说明里要带上「接着西部那轮问东部」的前文 |
| q-story | 沿用 | — | 是 |
| q-weather | 沿用 | — | 否 |
| q-notes-apps | 沿用 | — | 不计分，照实列（凭自己知道的一两步答完也合理） |
| quick-usd、quick-downloads、todo-note、conv-writeup | 沿用 | 沿用 | 否 |
| e-invoices、e-template、big-quotes、big-pdfs、big-research、ask-dispatch | 沿用 | 沿用 | 是 |
| q-headphones（新） | 帮我比较 Meze 109 Pro 和森海塞尔 HD 490 PRO 这两款耳机，整理成一张表 | — | 是，且只一个标签（要合成一份对比） |
| q-fact-injury（新） | 查一下湖人队的里夫斯最近是不是受伤了？ | — | 否（一个事实） |
| q-followup-quick（新） | 那他大概什么时候能复出？ | 上一轮问某球员伤情，回答里已写明伤情与预计复出时间 | 否（凭这段对话就能接） |

- 判定沿用：回复里有 `<subtask …>…</subtask>` 算派，记下标签数与每个标签的 `title` 与内容全文。停在浏览器工具上的照 115 单列一类。
- `q-headphones` 派了两个以上标签算不合格（要合成一份的不拆）。

**b. 并行派活**：`dispatch-parallel/` 用 `v2` 提示词重跑全部用例。`p-question-parts`（「新赛季西部和东部各有哪几支队能进季后赛？」）改标 `exact: 1`（183 下这类问题要派，但一个问题不拆）；其余照旧。

**c. 成品贴回**：在叫醒措辞那一套（`wake/`）里加两条用例，用改过的 `subtasks.md`：
1. `w-table`：子任务做完，报告里的最后回答是一张约 8 行的 Markdown 对比表加两句结论（内容虚构，比如两款虚构的耳机）。合格：主对话回复里有这张表（表头与各行都在，数字没改），没有子任务讲自己怎么做的话。
2. `w-long`：子任务做完，最后回答被截断（报告里写着 `[… cut for length; all of it: session show <id> --tail=1]`），或回答里写明结果在一个文件里（给完整路径）。合格：回复给要点，并说全文在哪（文件完整路径，或说明全文在子任务里）；不要求把全文贴出来。

**模型与额度**：模型写死 `mm_1792576875658`（API key 接入的 gpt-6.1-sol），解释器用 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`，带 `PYTHONDONTWRITEBYTECODE=1`。不要换别的模型；这个 id 不在 `managed-models.json` 里就停下回报。先跑 `--dry-test`（零额度）确认加载与判卷；真跑每个用例每组 3 遍。真模型调用合计预计超过 400 次就先停下回报预计数，不超就直接跑。新条款有用例没过时，最多改一轮措辞、只重跑没过的用例，然后回报，不要反复调。

结果写各套件的 `results.json` / `results.md`（逐用例列消息、上下文、`new` / `v2` 各自派没派、标签数与标题、派活说明全文、最终回复）；`meta` 写明模型 id 与「API key 接入」。不写服务商名、接口地址、本机用户目录。README 对应各节补一段票 134 的结果。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml -p galley-core managed_prompt
cargo test --manifest-path core/Cargo.toml -p galley-core assistant_manual
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

（包名以 `core/Cargo.toml` 为准。）长命令前台跑，别放后台等。中文文字（报告、结果 md、README）用全角标点，提交前自己写个正则扫一遍新增行，脚本放 scratchpad，用 `t134-` 前缀命名。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树，改主树的 `core/` 会让它重编、重启 Core、打断在跑的会话）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t134-dispatch-more-eagerly <scratchpad>/wt-134 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：GUI、runner、CLI、Agent API、迁移、IM 提示词（`managed_prompt.rs` 里 IM 那句「keep this chat busy」是 IM 的，不改）、`unasked.md` 的「Quick work you do this turn; longer work goes to a subtask」（巡看时没人在等，那句照旧）。
- 不写 Galley 数据库、不写内置 / 外置 GA 的状态；数据库只读。
- 票面、评测用例与结果里不放 JC 的私人信息；人名、公司名用虚构的（NBA 球员、公开的耳机型号可以）。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`。提交说明末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：

1. 条款与手册的最终原文；相对票面原文改了哪几处、为什么。
2. 字节预算：旧值、新值、本机实测。
3. 改了哪些文件、哪些断言。
4. 评测：每个用例 `new` / `v2` 派没派（三遍各自的结果）、标签数与标题、停在浏览器的单列；成品贴回两条的回复原文；没过的用例原文与你的判断；真模型调用次数。
5. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-03，执行代理；worktree 分支 `t134-dispatch-more-eagerly`，没合入 main。）

### 1. 条款与手册的最终原文

入口层派活那一段（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）：

```text
Answer yourself only what takes a step or two: a single fact (the
weather, a score, whether someone is injured), a quick look on their
computer (what is in a folder), a quick conversion, a follow-up you can
answer from what is already in this conversation.
Everything bigger goes to a subtask, so this chat stays free for the
user: a thing to hand back (a table, a list, a comparison, a report, a
file), a change on their computer or accounts (files sorted or renamed, a
booking, a form filled), and a question or story that needs several
places looked up (what happened in some event, a ranking, a prediction).
So does anything they ask you to hand off. End your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
When the user hands you several errands that do not depend on each other,
or one errand splits into parts whose results each stand on their own,
write one tag per part in the same reply: they run at the same time. Keep
in one tag what has to come back as one thing (a comparison, one table,
one report, the answer to one question) and the parts that need the same
browser tab or the same files.
Galley starts each after this reply, as a separate conversation that cannot
see this one, so write everything it needs: the goal, the facts the user
gave, what this conversation already settled that the request leans on,
what you have found so far, and what to hand back, with the evidence for
it (a confirmation number, a file path, a link, a screenshot path).
Tell the user in a sentence that it is on its way. When it finishes, asks
something or fails, Galley wakes you to check it and tell the user, so do
not wait on it or watch it. If something you took for quick turns out
bigger partway through, stop there and hand the rest over the same way.
Do it yourself when the errand's material is this conversation (writing up
what you two discussed), and when it is a to-do, a reminder or a memo. Use
this, not the file-based subagent in your memory (subagent.md), which the
user cannot see.
```

相对票面只改了一处：自己答的那几样里加了「a quick look on their computer (what is in a folder)」（+54 字节，第一行之后跟着重新折行）。这是评测允许的那一轮改措辞：票面原文下 `quick-downloads`（「帮我看看下载文件夹里有哪些超过 1GB 的文件。」）三遍都先读 `subtasks.md` 或看一眼文件夹，再把它当成「a thing to hand back (… a list …)」派了出去；加上这一句后三遍都自己答了。我认为这没改意思（裁决 183 的界线是「一两步答得完」，看一眼文件夹是一两步），但它是票面没有的例子，请 JC 定。其余逐字照票面。

手册 `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`「Checking a result and reporting it」一节，逐字照票面：

```text
- When what the user asked for is the answer itself (a table, a list, a
  comparison, an account of something), give it to them in full as the
  subtask wrote it, without its notes on how it got there. When it is
  longer than a screen or so, or is a file, give the gist and where the
  whole is (the full file path).
- Otherwise lead with the result in a sentence or two and name the
  evidence (the number, the full file path, the link); do not retell how
  it got there.
```

### 2. 字节预算

- `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`：旧值 4344，新值 4729，本机实测 4729（不留余量）。票面原文是 4675（+331），评测那一轮加了 54。入口层没有按平台分的内容，`\r` 不计，Windows 与本机相同，所以没加 18。分项（写在常量的注释里）：开头自己答什么、派什么 +203（其中 +54 来自评测），一个标签装要合成一份的 +102，派活说明带上这段对话定下的前文 +66，「做着发现比想的大」+14。
- 静态提示词预算（`STATIC_PROMPT_BUDGET_BYTES` 6869）没动：入口层不在静态部分里。手册没有字节预算。

### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`：派活那一段换成上面的原文；`main_chat_entry_layer` 上方加了票 134 一段文档注释（判据怎么变、为什么、代价），第一段里「Since ticket 115」那句跟着改；预算常量与它的注释。测试 `main_chat_entry_layer_answers_questions_and_hands_errands_to_a_subtask` 改名 `main_chat_entry_layer_answers_only_quick_things_and_hands_the_rest_to_a_subtask`，换成新原文的单行片段，位置锚点换成 `Answer yourself only what takes a step or two`，另断言旧句 `even when it takes a few minutes`、`do not split a question` 不在。
- `core/src/assistant_manual.rs`：新测试 `manual_hands_back_an_answer_in_full`，钉住新的两条（在这一节、按顺序），并断言哪一部分都没有「Do not paste the subtask's answer」。原来没有断言钉旧句。
- `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`：上面那两条。
- `docs/managed-ga-runtime/prompt-composition.md`：入口层「Hand … to a subtask」一条与预算一条照新条款改（4344 → 4729 的分项），这份文档会被注释当成预算规则的出处引用。
- 评测（`.scratch/main-chat/entry-layer-eval/`）：`run.py`、三套的 `cases.json`、`wake/wording.md`（新加 `core` 措辞）、`dispatch-criterion/galley-prompt/main_chat.v2.txt`（最终）与 `main_chat.v2-r1.txt`（第一轮措辞）、三套的 `results.json` / `results.md`、两套的 `composed/` 新加的 v2 请求、`README.md`。
- 全仓 grep 旧原文：会被当成镜像读的只有 `run.py`（`dry_test_crit`、`dry_test_par` 拿旧句切条款，new 那份提示词还是旧句，照旧能用）；各套件已有的 `galley-prompt/` 没改。`dispatch-criterion/composed/` 里 `e-invoices.new-1.txt`、`q-east.new-1.txt` 两份被这次的 new-1 覆盖了（new 换了提示词，见下），票 115 的版本在 git 历史里。
- 产品代码里没留临时测试（生成提示词的临时测试跑完删了，`git diff` 里没有 `t134_tmp`）。

验证：`cargo test -p galley-core managed_prompt`（46 过）、`assistant_manual`（13 过）、`cargo test --workspace`（1,300 过、0 不过）、`node scripts/check-docs-links.mjs`（492 个文件 OK）、`git diff --check` 干净；两份改过的 Rust 文件 `rustfmt --check` 干净；`run.py --dry-test` 全过。

### 4. 评测

模型 `mm_1792576875658`（API key 接入的 gpt-6.1-sol），解释器 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3` 加 `PYTHONDONTWRITEBYTECODE=1`；先 `--dry-test` 全过再真跑。**真模型调用合计 389 次**（派活判据 258、并行 38、成品贴回 93），没超 400。

两处与票面做法不同，原因：

- `dispatch-criterion` 现有的 `new`（`galley-prompt/main_chat.new.txt`）是票 115 那一版，没有票 126 的标题和票 127 的并行，不是 main 今天的。为了对照的是 main 今天，这一套的 `new` 改读 `dispatch-parallel/galley-prompt/main_chat.new.txt`（我用 Rust 现生成一份比过，与 main 今天逐字相同）；票 115 那 16 次 `new-1` 移进 `meta.superseded_runs`。
- `dispatch-parallel` 的 v2 只重跑本票 6 条。带进来的 19 条在 v2 下与 `dispatch-criterion` 的 v2 是同一个实验（同一份提示词、沙盒与判定），全跑会让合计约 470 次，超 400；结果在 `dispatch-criterion` 那边。

**a. 派活判据**（19 条，new / v2 各 3 遍；格里是派没派、标签数与标题；「浏览器」是停在浏览器）：

| 用例 | 183 下 | new（3 遍） | v2（3 遍） |
| --- | --- | --- | --- |
| q-injuries | 派 | 自己答（看记忆、搜对话历史后凭知道的答，2–3 次调用），合规 ×3 | 派 1 个「NBA 历史严重伤病」×3 |
| q-east | 派，带前文 | 浏览器 ×3（单列） | 派 1 个「NBA 东部新赛季预测」「NBA 东部预测」「NBA 东部新赛季预测」，三遍派活说明都带上了西部那轮 |
| q-story | 派 | 浏览器 ×3（单列） | 派 1 个「保罗·乔治断腿始末」「乔治断腿始末」「保罗·乔治断腿始末」 |
| q-weather | 不派 | 浏览器 ×3 | 浏览器 ×3 |
| q-notes-apps | 不计分 | 浏览器 1、直接答 2 | 派 1 个「Mac 本地笔记软件推荐」「Mac 本地笔记推荐」×2 |
| quick-usd | 不派 | 浏览器 ×3 | 浏览器 ×3 |
| quick-downloads | 不派 | 自己答 ×3 | 第一轮措辞：派 1 个 ×3（不合格，已替换）；改后：自己答 ×3 |
| todo-note | 不派 | 自己记待办 ×3 | 自己记待办 ×3 |
| conv-writeup | 不派 | 自己写 ×3 | 自己写 ×3 |
| e-invoices | 派 | 派 1 个「整理下载文件夹发票」×3 | 同左 ×3 |
| e-template | 派 | 派 1 个「制作酒店开业资料收集模板」×3 | 派 1 个「制作酒店开业资料收集模板」「酒店开业资料收集模板」×2 |
| big-quotes | 派 | 问用户（单列）、自己答（合规）、派 1 个「三家供应商钢材报价对比」 | 派 1 个「三家钢材报价对比」×2、问用户 1（单列） |
| big-pdfs | 派 | 派 1 个 ×3（「按内容整理下载文件夹 PDF」等） | 派 1 个 ×3（「按内容整理下载目录 PDF」等） |
| big-research | 派 | 派 1 个 ×3（「本地笔记软件调研报告」等） | 派 1 个「本地笔记软件调研报告」×3 |
| ask-dispatch | 派 | 派 1 个 ×3（「整理昨日 NBA 要闻」等） | 派 1 个 ×3（「昨日 NBA 新闻简报」等） |
| midway-invoices | 派 | 派 1 个 ×3（「下载发票分类归档」等） | 派 1 个 ×3（「下载文件夹发票归档」等） |
| q-headphones（新） | 派，一个标签 | 浏览器 ×3（单列） | 派 1 个「耳机对比表」×3 |
| q-fact-injury（新） | 不派 | 浏览器 ×3 | 浏览器 ×3 |
| q-followup-quick（新） | 不派 | 浏览器 ×3 | 浏览器 ×3 |

合计：new 合格 40、合规 4、不合格 0、单列 10、不计分 3；v2 合格 53、不合格 0、单列 1、不计分 3。停在浏览器单列的：new 10 遍（q-east、q-story、q-headphones 各 3，加 big-quotes 问用户 1）；v2 只有 big-quotes 问用户 1 遍。v2 没有一条要合成一份的被拆开。

**b. 并行派活**（本票 6 条，v2 各 3 遍）：18 遍 17 合格、1 单列、0 不合格。三件差事三遍都是 3 个标签；一件拆三块三遍都是 3 个（A、B、C）；同一批文件三遍 1 个；同一个标签页两遍 1 个「京东购物车下单」、一遍自己开浏览器（单列，同票 127）；`p-question-parts` 改标 1 个后三遍都派 1 个（「NBA东西部季后赛预测」「预测东西部季后赛球队」「预测东西部季后赛名单」），没拆；`p-errand-and-question` 三遍都 1 个标签，判定为合格，但派出去的是天气（「厦门周末天气」），订票先问用户从哪出发（见 Open risks）。标题 6–15 个字，都是中文。

**c. 成品贴回**（`wake/` 新加 `w-table`、`w-long`，用 v2 提示词与 Core 今天的叫醒写法 `core`，各 3 遍）：

- `w-table`：2/3 过。两遍都把 8 行表原样贴回，数字没改，没带「一共打开 7 个页面」那句；第 3 遍打回子任务（截图读不出字，要它描述截图上的文字，并删掉没证据的结论）。第 1 遍回复原文：

```text
整理如下。**数字以官网为准**；两张规格截图已确认存在，但我这边未能读取截图文字做逐项复核，因此下表参数仍待核实。

| 项目 | 声岚 S7 | 北极星 HP-60 |
|---|---|---|
| 价格 | 2,499 元 | 3,199 元 |
| 类型 | 开放式头戴 | 封闭式头戴 |
| 驱动单元 | 50 mm 动圈 | 45 mm 平板振膜 |
| 阻抗 | 32 Ω | 64 Ω |
| 灵敏度 | 102 dB/mW | 96 dB/mW |
| 重量 | 285 g | 390 g |
| 线材与接口 | 可换线，3.5 mm + 4.4 mm 平衡 | 可换线，3.5 mm + 6.35 mm 转接 |
| 佩戴 | 头梁轻、夹力小，适合长时间听 | 耳罩厚、隔音好，夹力偏大 |

按这份参数，**声岚 S7 更适合安静环境下长时间聆听**，优势是轻、相对容易驱动，但开放式结构不适合需要隔音的场景。**北极星 HP-60 更适合看重隔音的人**，不过重量更大、驱动要求相对更高，舒适度和前端搭配建议试听确认。

子任务交回的规格页截图：
- 声岚 S7：`~/Downloads/耳机规格/声岚_S7_规格.png`
- 北极星 HP-60：`~/Downloads/耳机规格/北极星_HP-60_规格.png`
```

  第 2 遍同样整表贴回，结论改写成两段，另加「核验说明」，全文在 `wake/results.md`。注意两遍都没照原样贴子任务的两句结论，而是自己重写了。
- `w-long`：0/3，三遍都没走到交代，回复都是 `<no-reply/>`，打回子任务（指令要每张截图的完整路径，回答只给了文件夹；行程「每天一个主景点」与第 2 天的安排自相矛盾等）。「比一屏长给要点、说全文在哪」这一条没测到。
- 固定数据改了两次，被替换的 9 次运行都在 `wake/results.json` 的 `meta.superseded_runs`：第一次 6 遍全被打回（证据链接是 `.example` 占位域名、攻略里写了「虚构名」、七天算成七晚、几处建议不实），改成截图证据、内容改实；第二次 `w-long` 3 遍又被打回（「住哪」只写「一家连锁酒店」、写「淡季」），改了只重跑 `w-long`。再跑一轮需要先在回答里列出每张截图的完整路径，约 25 次调用，额度不够，没跑。

README 三节（「派活判据（票 115）」「并行派活（票 127）」「叫醒措辞评测（票 30）」）各补了票 134 的结果。

### 5. 看到但没改的（Open risks）

1. Core 的叫醒消息（`core/src/subtask_report.rs` 的完成那段）还写着「If it holds, tell the user the result in a sentence or two and name the evidence」，`wake.md` 的「Do what it says, then reply to the user」指向它，字面上与手册新那条打架。`w-table` 过的两遍照手册把表贴回了，没被这句压住，但样本只有 2 遍。没改 Core 与 `wake.md`。
2. 长回答「给要点、说全文在哪」没测到（见上，`w-long` 0/3，都卡在验收）。
3. 验收很严：答案型结果也照证据去核，截图读不出字就打回或加「待核实」，攻略类挑出的毛病多。派活更积极以后，问答类的子任务交回时被打回、多跑一轮的可能变大，答案更晚到。值得真机留意。
4. `p-errand-and-question`（订票加天气）v2 三遍派出去的都是天气，订票先问用户；天气本该自己答。判定只数标签数，算合格。单问天气（`q-weather`）时三遍都自己查。
5. `q-followup-quick` 两组六遍都没凭上一轮的回答直接接，而是开浏览器再查一遍（没派，算合格，但不是用例的本意）。
6. 不计分的 `q-notes-apps` 在 v2 下三遍都派了：凭自己知道就能答的推荐类问题，新条款下会派出去。
7. 条款里加的「a quick look on their computer (what is in a folder)」是票面没有的例子（见 1），请 JC 定。
8. 沙盒里浏览器不执行、子任务不真跑：自己查的那些看不到步数与最终答复；派出去以后「叫醒 → 贴回」这条链只在 `wake/` 里用编好的报告测了。
9. `docs/project-status.md`「Unreleased On Main」还写着裁决 160 的判据（「what you ask it answers itself, even when that takes minutes」），合入时要改；我没碰。
10. `dispatch-parallel` 的 v2 没重跑带进来的 19 条（理由见 4），与票面「重跑全部用例」不同。
11. `dispatch-criterion/composed/` 的 `e-invoices.new-1.txt`、`q-east.new-1.txt` 被这次的 new-1 覆盖（new 换了提示词），票 115 的版本只在 git 历史里。
12. 裁决 183 第 6 条（main 上 `236f5702`，在本分支的基点之后）要本票的评测量两个误判方向。快的「讲讲」被派出去：`q-notes-apps`（凭自己知道就能答的推荐）v2 三遍都派了，其余 7 条该自己答的在最终措辞下没有一遍派出去（`quick-downloads` 在第一轮措辞下三遍都派了，见 1）。慢的事实题留下：沙盒里浏览器不执行，`q-weather`、`q-fact-injury` 停在第 1–2 次调用，量不出自己答要多久，这个方向本评测测不到，要等真机。

### 第二轮（2026-11-03，主会话要求：Core 的叫醒说明一并改）

第一轮 Open risks 第 1 条属实：Core 叫醒消息里子任务完成那段（`core/src/subtask_report.rs` 的 `report_paragraph`）写着「If it holds, tell the user the result in a sentence or two and name the evidence」，每一件派出去的答案都经过它，与手册新那条正面冲突。裁决 183 第 4 条原写「只改手册」，11-03 已更正。

**新句子**（逐字）：

```text
If it holds, tell the user what they asked for, as `subtasks.md` says: the answer itself in full when it is a table, a list, a comparison or an account of something; otherwise the result in a sentence or two with the evidence (a confirmation number, a file path, a link).
```

规则写在手册一处，叫醒消息点名 `subtasks.md`，同时把两种情形各说半句，免得没读手册时又退回「一两句」。依据：本票评测的 21 次叫醒运行（两轮，含被替换的），每一遍都读了 `subtasks.md`，最晚在第 4 次工具调用，多数在第 1–2 次。定时任务那段（「Tell the user the result in a sentence or two」）没动，`wake.md` 对定时任务也是这么写的。

**改了哪些文件、哪些断言**：

- `core/src/subtask_report.rs`：上面那句，加一段注释说为什么改。测试 `one_report_has_the_opening_and_no_closing` 加断言钉住新句，并断言没有「tell the user the result in a sentence or two」；`a_mix_of_kinds_opens_in_general` 加断言：定时任务那段不提 `subtasks.md`。全仓 grep 过 `core/src`、`core/tests`，原来没有测试钉旧句。
- 评测里的 Core 原文镜像：`wake/wording.md` 的 `core`、`run.py` 的 `done_paragraph`、`schedule/rust-samples.json` 里带完成那段的两条样本、`todo/cases.json` 里两条带过来的叫醒消息（`review-handed-over`、`review-done-not-noted`，`--dry-test` 要它们与 Core 原话一致；它们以前的结果是旧原话下跑的）。用临时 Rust 测试写出 `report_text` 的原文（第 1 轮一件、打回两次后超长被截断的一件），与 `done_paragraph` 和 `core` 措辞逐字相同，测试跑完删掉。
- `w-long` 的固定数据：回答开头逐张列出 5 张截图的完整路径和各自写着什么，每天一个必去、其余可选，景点之间默认坐出租车，门到门的换乘，不换城市的雨天备选，回程按航班分两种，没核实的写明待核实；3,205 字，叫醒消息里照样被截断。

**评测**（v2 提示词，Core 新原话，各 3 遍；被替换的 6 次在 `wake/results.json` 的 `meta.superseded_runs`）：

| 运行 | 结果 | 模型调用 |
| --- | --- | --- |
| `w-table` 第 1 遍 | 过：整张表原样贴回，结论自己写成两条，截图用 `[FILE:…]` 交出 | 7 |
| `w-table` 第 2 遍 | 不过：一直想读出截图里的字（查 OCR、读图片），做到 10 次工具调用上限，没回复 | 10 |
| `w-table` 第 3 遍 | 过：整张表原样贴回，另加「核验说明」 | 8 |
| `w-long` 第 1 遍 | 过：读了全文，自己把完整攻略写成一个文件，回复给概览表、预算和要紧的几条，`[FILE:…]` 交出全文 | 7 |
| `w-long` 第 2 遍 | 不过：打回子任务（下车位置、不可避免的步行与台阶没核实） | 10 |
| `w-long` 第 3 遍 | 不过：也一直想读截图，做到上限 | 11 |

`w-table` 第 1 遍回复原文：

```text
两款耳机的对比如下。**数字以官网为准；规格截图文件已确认存在，但本轮未能读取图中文字作独立复核。**

| 项目 | 声岚 S7 | 北极星 HP-60 |
| --- | --- | --- |
| 价格 | 2,499 元 | 3,199 元 |
| 类型 | 开放式头戴 | 封闭式头戴 |
| 驱动单元 | 50 mm 动圈 | 45 mm 平板振膜 |
| 阻抗 | 32 Ω | 64 Ω |
| 灵敏度 | 102 dB/mW | 96 dB/mW |
| 重量 | 285 g | 390 g |
| 线材与接口 | 可换线，3.5 mm + 4.4 mm 平衡 | 可换线，3.5 mm + 6.35 mm 转接 |
| 佩戴 | 头梁轻、夹力小，适合长时间听 | 耳罩厚、隔音好，夹力偏大 |

- **声岚 S7**：更轻、相对容易驱动，适合在家等安静环境长时间听；开放式结构不适合需要隔音或避免漏音的场合。
- **北极星 HP-60**：封闭式结构更适合有隔音需求的人，但重量更大、驱动要求相对更高，是否需要耳放还要结合播放设备和实际音量判断。

两款耳机的规格页截图：

[FILE:~/Downloads/耳机规格/声岚_S7_规格.png]

[FILE:~/Downloads/耳机规格/北极星_HP-60_规格.png]
```

`w-long` 第 1 遍的回复在 `wake/results.md`（1,193 字：七天概览表、预算、给长辈的几条，末尾 `[FILE:…/关西七日游攻略_长辈慢游版.md]` 与一段「需要说明」）。

真模型调用：第二轮 53 次（上限 80）；两轮合计 442 次。

验证：第二轮的全量测试被第三轮打断，合在第三轮末尾一起跑（见第三轮）；当时跑过的 `managed_prompt`、`assistant_manual`、`subtask_report` 三组过滤、`rustfmt --check`、`check-docs-links`、`git diff --check`、`run.py --dry-test` 全过。

**第二轮看到的（Open risks）**：

1. 验收想读截图：6 遍里 2 遍做到工具调用上限也没回复，都在找 OCR、读 PNG。沙盒里没有能读图的工具，真机上 GA 能不能读图、会不会也这样耗步数，要真机看；手册写着核不了就明说，模型没照做。
2. 主对话把长回答自己写成一个文件再交出（`w-long` 第 1 遍），没有说「全文在子任务里」；手册说的是「where the whole is (the full file path)」，模型读成要有一个文件。多写一个文件算不算想要的，请 JC 定。
3. `w-table` 第 1 遍的 `[FILE:~/Downloads/…]` 用的是 `~`，入口层要的是绝对路径，卡片可能画不出来（第 3 遍写的是绝对路径）。
4. 按严格验收打回仍会发生（`w-long` 第 2 遍）：派活更积极以后，答案型结果多一轮打回、更晚到的风险还在。
5. `todo/cases.json` 两条用例带过来的叫醒消息换成了新原话，它们的旧结果是旧原话下跑的，重跑那两条时会有差别。
6. 叫醒评测的结束标签写「达到 8 次上限」，叫醒这一套的上限其实是 10 次（`STOP_LABELS` 用的是派活套件的常数），是评测脚本的旧问题，没改。

### 第三轮（2026-11-03，裁决 184「上网就派」与第 9 条「到点提醒不上网」）

第二轮已提交（Core 叫醒那句、成品贴回评测），这一轮在它上面改条款、手册与评测。

**条款最终原文**（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）：

```text
You do not go online in this chat, neither with the browser nor any
other way (curl and the like in code_run). Anything that needs the web
goes to a subtask, always, the weather or a score included. So does
anything that changes things on the user's computer or accounts (files
sorted, renamed or written, an order placed, a form filled, something
sent), and anything they ask you to hand off. Everything else you do
yourself: talking, answering from what you know or from this
conversation, to-dos, reminders and memos, the time, a read-only look on
their computer (what is in a folder), and writing up what you two
discussed, even into a file (a subtask cannot see this conversation).
To hand something off, end your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
When the user hands you several errands that do not depend on each other,
or one errand splits into parts whose results each stand on their own,
write one tag per part in the same reply: they run at the same time. Keep
in one tag what has to come back as one thing (a comparison, one table,
one report, the answer to one question) and the parts that need the same
browser tab or the same files.
Galley starts each after this reply, as a separate conversation that cannot
see this one, so write everything it needs: the goal, the facts the user
gave, what this conversation already settled that the request leans on,
what you have found so far, and what to hand back, with the evidence for
it (a confirmation number, a file path, a link, a screenshot path).
Tell the user in a sentence that it is on its way. When it finishes, asks
something or fails, Galley wakes you to check it and tell the user, so do
not wait on it or watch it. Use this, not the file-based subagent in your
memory (subagent.md), which the user cannot see.
```

- 相对主会话给的要点：「如果拿不准是小事、做着发现变大」那句删了。现在要答的是「要不要上网、要不要改东西」，开工前就分得清；只读看一眼发现要改的，靠派活说明里的「what you have found so far」把看到的交出去，用不着单列一句。
- 评测改了一轮措辞：「writing up what you two discussed」后加「, even into a file」。第一轮措辞下「把我们今天聊的整理成一份 Markdown，放到桌面」三遍里有一遍被当成「写文件」派了出去。
- 评测之后按主会话的补充，把开头改成「neither with the browser nor any other way (curl and the like in code_run)」，与票 135 硬闸的新说法一致；这一处没有再跑评测（评测用的是 `dispatch-criterion/galley-prompt/main_chat.v3.txt`，开头是「the browser, or going online any other way」）。

**Core 叫醒那句**（第二轮定的，这一轮没改）：「If it holds, tell the user what they asked for, as `subtasks.md` says: the answer itself in full when it is a table, a list, a comparison or an account of something; otherwise the result in a sentence or two with the evidence (a confirmation number, a file path, a link).」

**字节预算**：`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 4729 → 4524，本机实测 4524（不留余量；入口层没有按平台分的内容，`\r` 不计，Windows 相同）。分项：按要碰的东西重写开头 +6，留在这里的那句并进开头 −146，「turns out bigger」删掉 −114（到 4475）；评测加的「, even into a file」+18（4493）；curl 那句 +31（4524）。

**手册**（裁决 184 第 9 条）：

- `wake.md`「When a reminder comes due」：去掉「look something up first when it says to check something」；加一条：提醒说要查网上的东西（快递、价格、天气），这里不上网，交给子任务，这一轮只写子任务标签和 `<no-reply/>`，回来时一条消息说清，晚到的话一并说；只提醒的照旧到点说。「A to-do's reminder only reminds」挪到一行开头，保持能整句搜到。
- `wake.md` 开头 `<no-reply/>` 那条：除巡看外，加上「提醒的查询交给了子任务」这一种。
- `wake.md` 巡看看备忘那条：「look it up」改成「have a subtask look it up (you do not go online here)」，与硬闸一致（主会话没点名这一处，我顺手改了，请看）。
- `unasked.md`：「Quick work you do this turn; longer work goes to a subtask」改成「Quick work that needs no web you do this turn; anything that needs the web, and longer work, goes to a subtask」。
- 手册没有字节预算。

**改了哪些文件、哪些断言**：

- `core/src/managed_prompt.rs`：条款、上方文档注释加第三轮一段（裁决 184、为什么删「turns out bigger」、与硬闸同一句话）、预算与理由。测试改名 `main_chat_entry_layer_hands_the_web_and_changes_to_a_subtask`，换成新原文的单行片段，锚点 `You do not go online in this chat,`，另断言 `takes a step or two`、`turns out` 不在，工作台与 IM 的提示词里没有这一句。
- `core/src/assistant_manual.rs`：新测试 `manual_hands_web_checks_on_wake_to_a_subtask`；`manual_covers_the_users_to_dos`、`manual_follows_up_what_comes_up_on_a_date`、`manual_wakes_with_what_is_of_use`、`manual_acts_unasked_and_reviews_each_morning`、`manual_keeps_the_users_memos` 里钉旧句的片段跟着改。
- 手册 `wake.md`、`unasked.md`；`docs/managed-ga-runtime/prompt-composition.md` 的入口层一条与预算一条。
- `gui/src/lib/assistant-conversation.test.ts`：加一条 vitest，只派活加 `<no-reply/>` 的提醒叫醒轮次界面不画（只动测试，没动 GUI 代码）。
- 评测：`run.py`（v3、按裁决 184 判、第一个工具是不是浏览器、`code_run` 上网、到点提醒的判定）、三套的 `cases.json` 与 `schedule/cases.json`、`dispatch-criterion/galley-prompt/main_chat.v3.txt` 与 `main_chat.v3-r1.txt`、各套件结果、`README.md`。

**界面判静默**：看报告行的来源（`gui/src/lib/subtasks.ts:95-99` 的 `isSubtaskReport`：`via: "system"` 加 `supervisor: "galley-report"`），Core 给每种叫醒都盖这个来源（`core/src/subtask_report.rs` 的 `deliver`，`Origin::subtask_report`），提醒也在内，不只认巡看。新加的 vitest 过了。

**评测**（模型 `mm_1792576875658`，API key 接入的 gpt-6.1-sol；先 `--dry-test` 全过）：

1. 派活判据 v3（20 条 × 3 遍）：合格 49、合规 6（`q-injuries`、`q-story` 凭已有知识自己答）、不合格 5（`q-followup-quick` 3、`q-followup-sourced` 2）。60 遍里第一个工具是浏览器 0 遍，`code_run` 上网 0 遍；对照 new 4 遍、v2 8 遍第一个工具是浏览器。逐条见 README「派活判据（票 115）」里第三轮那张表。
2. 并行 v3（本票 6 条 × 3 遍，另加 1 条 × 3）：几件差事 3 个标签、一件拆三块 3 个、同一批文件 1 个、同一个标签页 1 个、分东西部的问题 1 个，都三遍合格；`p-errand-and-question` 三遍只派了天气、订票先问出发地，按 2 个标签判不合格；写全出发地的 `p-errand-and-question-full` 三遍都派了 2 个（「订厦门高铁票」「查厦门周末天气」）。我的判断：裁决 184 下两件都该派，缺了只有用户才知道的东西时先问那一件、能派的先派，也说得过去。
3. 成品贴回 v3：`w-table` 3/3，三遍都把表原样贴回；`w-long` 0/3，第 3 遍给了要点并 `[FILE:…]` 交出全文，只因 1,568 字超过脚本定的 1,500 字判为不过，另两遍做到 10 次工具调用上限没回复。
4. 到点提醒（`schedule/` 新加两条，v3）：6/6。查物流三遍都是一个子任务标签加 `<no-reply/>`，没给用户写字；喝水三遍都到点说一句，没派子任务。

真模型调用：第三轮 250 次（派活判据 148，并行 50，成品贴回 41，到点提醒 11），上限 390。

验证（rebase 到 main `9cfa26f8` 之后）：`cargo test --workspace` 1,301 过、0 不过；`managed_prompt` 46、`assistant_manual` 14、`subtask_report` 20 全过；三份改过的 Rust 文件 `rustfmt --check` 干净；`check-docs-links` 493 个文件 OK；`git diff --check` 干净；`run.py --dry-test` 全过；新 vitest 所在文件 26 条全过，eslint、prettier 干净。

**第三轮看到的（Open risks）**：

1. 上线的条款开头（curl 那句）没跑过评测，评测用的是前一版说法；两版只差开头那半句。
2. `code_run` 上网硬闸拦不到，只靠条款；这一轮 96 遍 v3 运行里没有一遍这样做，但样本里没有专门诱导它的用例（比如「用 curl 查一下汇率」）。
3. `q-followup-quick`、`q-followup-sourced`：凭这段对话就能接的追问，模型总想先核实出处，核不到就派子任务重查。真机上前一轮是子任务查回来的、`session show` 看得到，可能好些；评测的假 CLI 里没有那件子任务，测不出来。
4. `q-injuries`、`q-story`（讲过去的事）按裁决 184 第 2 条③「凭已有知识答」自己答了，按主会话给的标注（派）落在「合规」。这类到底派不派，裁决的两条（上网就派 / 凭已有知识答）会打架，请 JC 定。
5. `w-long` 验收仍会做到工具调用上限：反复读手册、想读截图。长回答的「给要点、说全文在哪」只在第二轮 1 遍、第三轮 1 遍（超字数）走到。
6. 主对话把长回答写进文件时放在状态根的 `temp` 下（`managed-ga-state/temp/…`），不在用户的文件夹里；文件卡片能点开，但位置不直观。
7. 巡看看备忘那条我顺手改成交给子任务（裁决 184 第 9 条只点了提醒与 `unasked.md`），请看是否同意。
8. 评测各套件的旧结果都按新标注（裁决 184）重判了，README 里票 115、134 第一轮写的数字是当时的标注下的。
