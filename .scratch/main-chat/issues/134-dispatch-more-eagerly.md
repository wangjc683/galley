# 134 派活更积极：除了一两步答得完的，都派子任务；答案型成品原样贴回

Status: ready-for-agent

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
