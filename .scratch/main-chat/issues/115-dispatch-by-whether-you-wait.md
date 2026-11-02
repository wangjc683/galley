# 115 派活判据换成「你在不在等」：你问的自己答，你交办的差事派出去

Status: ready-for-agent（2026-11-02 开票）

来源：[主对话 PRD](../PRD.md) 裁决 160。只改入口层提示词、对应 Core 断言，和评测；不动 GUI、runner、CLI、Agent API、迁移。外置运行时零变化（外置没有主对话）。

## 为什么

- 现在的条款（`core/src/managed_prompt.rs:433-444`）按「会长时间占着这个对话」判：many steps, several websites, a long batch of files。模型开工前判断不了一件活有多长。两周里它没有一次看了用户的话就自己判断派活：10-28「今天下午五点前把发票整理好」自己干了 10 分 23 秒、11 步；同时 NBA 问答每次看好几个网站，也都自己答了（这一点按新判据恰好是对的）。
- 派出去的代价不小：子任务看不见主对话，从头核实（第一步先读浏览器规范），步数是主对话的 2–3 倍，再加 19–50 秒叫醒交代；一问拆成两条消息；追问时子任务查到的细节回不到主对话；浏览器同一时间只能一个人用，换不来并行。
- 所以判据改成用户在不在等：用户在问、在等答案的，自己答，等的那几分钟由进展小字（三点下面「在做什么 · 用时」）陪着；交办的差事派出去。

## 要做到

### 1. 入口层条款

把 `main_chat_entry_layer` 里从 `Work that would keep this chat busy` 到 `which the user cannot see.` 那一段换成下面这段。措辞可以为字节预算或读起来顺而收紧，意思不能变；改了哪里写进报告。

```text
Answer what the user asks you yourself, even when it takes a few minutes
of looking things up: they are waiting for that answer, and Galley shows
them what you are doing meanwhile. An errand they hand you, where what
comes back is a thing or a change rather than an answer (files sorted or
renamed, a template or a report drafted, a booking), goes to a subtask
once it takes more than two or three steps, and so does anything they ask
you to hand off: end your reply with <subtask>what to do</subtask>.
Galley starts it after this reply, as a separate conversation that cannot
see this one, so write everything it needs: the goal, the facts the user
gave, what you have found so far, and what to hand back, with the evidence
for it (a confirmation number, a file path, a link, a screenshot path).
Tell the user in a sentence that it is on its way. When it finishes, asks
something or fails, Galley wakes you to check it and tell the user, so do
not wait on it or watch it. If a question turns into an errand partway
through, stop there and hand the rest over the same way. Do it yourself
when the errand's material is this conversation (writing up what you two
discussed), and when it is a to-do, a reminder or a memo. Use this, not
the file-based subagent in your memory (subagent.md), which the user
cannot see.
```

- 同步改 `main_chat_entry_layer` 上方讲这段的文档注释（`managed_prompt.rs:360` 一带），写明裁决 160 / 票 115。
- 更新 `managed_prompt.rs` 测试模块里钉着旧原文的断言（`:1350-1370` 一带：`Do quick work yourself`、`goes to a subtask` 的位置断言等），换成新句子里的单行片段（Windows 检出是 CRLF，`contains` 别跨行）。「条款收在入口层末尾」那条位置断言保留，锚点换成新句子里的词。
- 静态提示词有字节预算测试。超了先收紧措辞；实在要抬预算，报告里写清旧值、新值、本机实测长度（Windows 比本机长 18 字节，预算按本机 +18 设）。
- grep 全仓旧原文（`keep this chat busy`、`Do quick work yourself`），会被测试或评测加载器当成镜像读的地方一并改；`.scratch/*/entry-layer-eval/` 下各套件已经生成好的 `galley-prompt/`、`composed/`、结果文件是历史快照，不改。用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。

### 2. 手册

`docs/managed-ga-runtime/galley-assistant-manual/subtasks.md` 与 `unasked.md` 默认不动：判据只在入口层写一份，免得两处漂移。只有字节预算逼你把「做着做着交出去」那一句挪进 `subtasks.md` 时才动，入口层留一句指向它；Core 测试里钉手册原文的断言（`core/src/assistant_manual.rs`）跟着改。

### 3. 评测

在 `.scratch/main-chat/entry-layer-eval/` 下新建一个套件目录 `dispatch-criterion/`，复用 `run.py` 的 `--mode sandbox`（README「派活方式对照（票 06）」一节：假 HOME、假 `galley`、`sandbox-exec`、浏览器工具停下、最多 8 次工具调用）。两组：`old` 是 main 上今天的主对话提示词，`new` 是本票改过的；提示词都由 Rust 的 `compose_main_chat_runtime_prompt` 生成（README「改了 Rust 提示词之后」那段的临时测试做法，跑完删掉临时测试，产品代码不留改动）。判定沿用 T 组：回复里有 `<subtask>…</subtask>` 算派，记下标签内容全文。

用例按用户的真实轮次仿写。人名、公司名、项目名用虚构的（NBA 球员等公开人物可以），不要照抄用户原话里的私人细节。标注按裁决 160：

| id | 消息 | 上下文 | 该派吗 |
|---|---|---|---|
| q-injuries | NBA 历史上还有哪些很严重的伤病？ | — | 否 |
| q-east | 东部呢？ | 上一轮问「新赛季 NBA 西部你怎么预测？」，附一段像样的回答 | 否 |
| q-story | 讲讲保罗·乔治当年断腿那件事 | — | 否 |
| q-weather | 厦门明天天气怎么样？ | — | 否 |
| q-notes-apps | Mac 上有哪些好用的本地笔记软件？ | — | 否（与 big-research 成对） |
| quick-usd | 沿用 `dispatch-cases.json` | — | 否 |
| quick-downloads | 沿用 `dispatch-cases.json` | — | 否 |
| todo-note | 记一个待办：周五前把酒店项目的资料清单发给业主 | — | 否 |
| conv-writeup | 把我们今天聊的整理成一份 Markdown，放到桌面 | 前面几轮像样的对话 | 否（材料是这段对话） |
| e-invoices | 今天下午五点前把下载文件夹里的发票整理好 | — | 是 |
| e-template | 帮我做一份酒店开业前的资料收集模板，能直接发给同事填 | — | 是 |
| big-quotes | 沿用 `dispatch-cases.json` | — | 是 |
| big-pdfs | 沿用 `dispatch-cases.json` | — | 是 |
| big-research | 沿用 `dispatch-cases.json` | — | 是 |
| ask-dispatch | 派个子任务，把昨天 NBA 的主要新闻整理一份给我 | — | 是 |

- 沙盒的下载文件夹里要有几张名字像发票的占位 PDF，供 e-invoices 用（沿用现有 fixture 就够的话不必加）。
- 停在浏览器工具上的运行单列一类「停在浏览器（第 N 次调用）」：对「否」的用例算它自己在做，合格；对「是」的用例不算合格也不算失败，照实列出，并在报告里说要不要给浏览器工具回一个假结果、让它能走到第三步。
- 可选：加 1 个「做着做着发现是差事」的用例（比如先问一句、看了文件夹才知道要整理一大批）。harness 显示不出来就别硬加，写进报告。
- 结果写 `dispatch-criterion/results.json` 与 `results.md`（逐用例列消息、上下文、old / new 各自派没派、在第几次调用、派活说明全文、最终回复）；`meta` 写明模型 id 与「API key 接入」。不写服务商名、接口地址、本机用户目录。

**模型与额度**：模型写死 `mm_1792576875658`（API key 接入的 gpt-6.1-sol），解释器用 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`，带 `PYTHONDONTWRITEBYTECODE=1`。不要换别的模型；这个 id 不在库里就停下回报。**真模型运行要等主会话放行**：先只跑 `--dry-test`（零额度），然后停下回报预计的调用次数，主会话会用 SendMessage 告诉你开跑。放行后如果新条款有用例没过，最多改一轮措辞、只重跑没过的用例，然后回报，不要反复调。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml -p galley-core managed_prompt
cargo test --manifest-path core/Cargo.toml -p galley-core assistant_manual
cargo test --manifest-path core/Cargo.toml --workspace
git diff --check
```

（包名以 `core/Cargo.toml` 为准。）中文文字（报告、结果 md）用全角标点，提交前自己写个正则扫一遍新增行，脚本放 scratchpad，用 `t115-` 前缀命名。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树，改主树的 `core/` 会让它重编、重启 Core、打断在跑的会话）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t115-dispatch-criterion <scratchpad>/wt-115 main
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/   # 先 mkdir -p <wt>/core/target
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：GUI、runner、CLI、Agent API、迁移、IM 提示词（`managed_prompt.rs:998` 那句「keep this chat busy」是 IM 的，不改）、`unasked.md` 的「Quick work you do this turn; longer work goes to a subtask」（巡看时没人在等，那句照旧）。
- 不写 Galley 数据库、不写内置 / 外置 GA 的状态；数据库只读（评测脚本本来就 immutable 打开）。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`。提交说明末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：

1. 条款最终原文；相对票面原文改了哪几处、为什么。
2. 字节预算：旧值、新值、本机实测。
3. 改了哪些文件、哪些断言。
4. `--dry-test` 结果与预计真调用次数（放行前停在这里）。
5. 放行后：每个用例 old / new 派没派、在第几次调用、停在浏览器的单列；没过的用例原文与你的判断。
6. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。第 1–4、4a、6 条是放行前写的；第 5 条是放行后补的。）

### 1. 条款最终原文

与票面原文逐字相同，换行也照票面，没有收紧：

```text
Answer what the user asks you yourself, even when it takes a few minutes
of looking things up: they are waiting for that answer, and Galley shows
them what you are doing meanwhile. An errand they hand you, where what
comes back is a thing or a change rather than an answer (files sorted or
renamed, a template or a report drafted, a booking), goes to a subtask
once it takes more than two or three steps, and so does anything they ask
you to hand off: end your reply with <subtask>what to do</subtask>.
Galley starts it after this reply, as a separate conversation that cannot
see this one, so write everything it needs: the goal, the facts the user
gave, what you have found so far, and what to hand back, with the evidence
for it (a confirmation number, a file path, a link, a screenshot path).
Tell the user in a sentence that it is on its way. When it finishes, asks
something or fails, Galley wakes you to check it and tell the user, so do
not wait on it or watch it. If a question turns into an errand partway
through, stop there and hand the rest over the same way. Do it yourself
when the errand's material is this conversation (writing up what you two
discussed), and when it is a to-do, a reminder or a memo. Use this, not
the file-based subagent in your memory (subagent.md), which the user
cannot see.
```

为什么没收紧：多出来的 548 字节分属裁决 160 第 2 条的五条规则（见第 2 条的分项），每一块删掉都少一条规则；能省的只有措辞上的几处（比如「once it takes more than two or three steps」写成「past two or three steps」、「that answer」写成「it」），合起来不到 40 字节，读起来反而更拗或更含糊，所以照票面原文、抬预算。

### 2. 字节预算

- 旧值 3383（main 上实测入口层正好 3383 字节，没有余量）。
- 新值 3931；本机实测 3931（`main_chat_entry_layer("")`，`\r` 不计）。
- 分项共 +548：开头那句「问的自己答，哪怕要查几分钟，因为对方在等、Galley 显示你在做什么」+181；差事的定义（拿回来的是东西或状态、不是答案，三个例子）、超过两三步、明说派的照派，替换「work that would keep this chat busy for a long time (many steps, several websites, a long batch of files)」那半句，+117；派活说明里写上「what you have found so far」+28；「问着问着变成差事就交出剩下的」一句 +100；「Do quick work yourself.」换成「材料是这段对话的、待办提醒备忘自己做」+122。
- Windows：这条预算本来就不数 `\r`，CRLF 检出不影响，不用按「本机 +18」设；「+18」是静态提示词预算 `STATIC_PROMPT_BUDGET_BYTES` 的规矩，入口层不在静态提示词里，静态提示词这一票没变。
- 理由写进了 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 的注释（「Raised 3383 → 3931 by ticket 115」一段）。

### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`
  - 条款换成上面的原文。
  - `main_chat_entry_layer` 的文档注释：票 06a 那段末尾加一句「Since ticket 115 (below) what goes is decided by whether the user is waiting」；末尾加票 115（裁决 160）一段：新判据、为什么换（模型开工前判断不了多长；问答派出去从头核实、步数两三倍、一问拆成两条、追问时查到的回不来）、判据只写在入口层、`unasked.md` 那句是给没人在等的活用的。
  - 测试 `main_chat_entry_layer_dispatches_long_work_to_a_subtask` 改名为 `main_chat_entry_layer_answers_questions_and_hands_errands_to_a_subtask`，文档注释补了票 115。拿掉钉旧原文的 5 条（`free: end your reply with <subtask>…`、`write everything it needs: the goal, the facts the user gave, and`、`hand back, with the evidence for it (…`、`When it finishes, asks something or fails, …`、`… Do quick work yourself.`），换成新原文的 15 个单行片段（每一行一个，不跨行）；加反向断言：整个主对话提示词里没有 `keep this chat busy`、`Do quick work yourself`，入口层里没有 `websites`。「条款收在入口层末尾」那条位置断言保留，锚点从 `goes to a subtask` 换成 `Answer what the user asks you yourself`。`look it up when they ask`、`<subtask>` 不进别的提示词两条照旧。
  - `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 3383 → 3931，注释写理由。
  - 这个文件在 HEAD 上 rustfmt 是干净的，只对它跑了 rustfmt。
- `core/src/subtask.rs`：模块文档第 6 行原来复述旧判据（「for work that would keep the chat busy for a long time」），改成「交出去的活，哪些活由入口层说（票 115 起是差事而不是问答）」，只动注释。这一处票面没点名：它说的是 `keep the chat busy`，票面让 grep 的 `keep this chat busy` 搜不到。
- `docs/managed-ga-runtime/prompt-composition.md`：「Hand long work to a subtask」那一条改写为新判据，旧判据与为什么换写在里面。票面没点名；票 96、98 改入口层时都一起改了这份，照那个做法。
- 没动：手册（`subtasks.md`、`unasked.md`）、`core/src/assistant_manual.rs` 的断言、IM 提示词（第 1027 行一带那句「keep this chat busy」，票面写的是 `:998`，行号随上面的注释挪了）、GUI、runner、CLI、Agent API、迁移。
- grep 全仓 `keep this chat busy`、`Do quick work yourself`（用 `grep`）：其余命中都是各套件已经生成好的 `galley-prompt/`、`composed/`，和 `dispatch-clauses.md`（票 06 对照的三段原文），按票面不改；`core/tests/` 与 CLI 测试里没有钉这段的。
- 评测（`.scratch/main-chat/entry-layer-eval/`）：
  - `run.py`：新套件 `--suite dispatch-criterion`。`crit_cases`（`from` 的用例消息从 `dispatch-cases.json` 读，标注要一致）、`crit_prompt`（`sched_prompt` 加了可选的模板参数，别的套件不受影响）、`make_crit_jobs`、`crit_facts`、`render_crit_md`、`dry_test_crit`，假模型加了三段脚本；`build_sandbox` 的 `dispatch_fixtures` 让这一套用待办评测的假 `galley` 时也放派活对照那套 `~/Downloads`；`build_result` 对这一套按 T 组的办法读标签，另记标签个数、在不在最后一条回复里；`--repeats` 不写时这一套是 1 遍（别的套件照旧 2）。
  - `dispatch-criterion/cases.json`：票面 15 条，加了可选的 `midway-invoices`（「下载文件夹里有发票吗？有的话帮我按类型归个档」：先问，看了文件夹才知道要归档一批；判派没派，另记派活说明里有没有提到已经看到的文件名）。harness 显示得出来：结果里有标签之前几次调用和派活说明全文。
  - `dispatch-criterion/galley-prompt/main_chat.old.txt`、`main_chat.new.txt`：在 `managed_prompt.rs` 的测试模块里临时加一个测试，改条款前写出 old、改条款后写出 new，跑完删掉（产品代码没留改动，删后 `git diff` 里没有它）。占位与 `schedule/galley-prompt/` 相同；old 与 `schedule/galley-prompt/main_chat.plain.txt` 只差版本号那一行（0.7.4 对 0.6.2），两份之间只差派活那一段。
  - `README.md`：文件列表加一行，新加「派活判据（票 115）」一节（输入、沙盒、判定、干跑测了什么、怎么跑）。
  - 沙盒是待办评测那套（假 HOME、按 fixture 回答的假 `galley`、`sandbox-exec`、手册放在状态根、几个系统命令可用），不是票 06 那个只认 `subtask start` 的假 `galley`：新旧提示词都是真主对话提示词，会读手册、会 `todo add`，票 06 的假 `galley` 对这些一律回 `unknown_command`。票面要的几样都在：派活对照那套 `~/Downloads`、浏览器工具停下、最多 8 次工具调用。

### 4. `--dry-test` 与预计真调用次数

- 模型 `mm_1792576875658` 在库里（只读、immutable 打开查的：gpt-6.1-sol，API key 接入）。
- `--dry-test`（不连模型）：`DRY TEST PASSED`，952 条 PASS，0 条 FAIL。这一套的检查：16 条用例（9 条不该派，沿用的 5 条逐字相同）；两份提示词（old 即待办评测那份、两份只差派活一段且位置相同、新的一段里裁决 160 的几句都在、占位填好、没有 In Hand 与 Memo）；判定（问答派了不过；差事做到 8 次上限、或直接回复，不过；差事停在问用户不计；问答做到上限过；超时不过；派活说明没提已经看到的照实记）；假模型在真沙盒里走五次：看一眼下载文件夹再派（新旧各一次，占位文件真的列得出，标签之前 1 次调用），停在浏览器（问答过、差事不计），带上下文的直接回复（问答过、差事不过），记一个待办（落进假 `galley`，手册从状态根读到）；再出一份 `results.md`。沙盒越界、金丝雀文件、护栏都照旧检查，全过。
- 别的套件 `--render-only` 重出：entry、wake、schedule、todo、chat、memo、dispatch（firststop）逐字不变；dispatch（沙盒）的 `dispatch-results.md` 在截断处差几个字，用 HEAD 的 `run.py` 重出也是同样的差异，是此前就有的，已还原、没提交。
- Core：`cargo test -p galley-core managed_prompt` 46 过，`assistant_manual` 12 过，`subtask` 33 过；`cargo test --workspace` 全过（1282 过、0 失败）；`git diff --check` 干净。
- 真跑的命令（放行后）：

```bash
PY=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
PYTHONDONTWRITEBYTECODE=1 $PY .scratch/main-chat/entry-layer-eval/run.py --suite dispatch-criterion --parallel 4
```

- 预计：16 条 × 2 组 × 1 遍 = 32 次运行。每次运行最多 9 次模型调用（8 次工具调用的上限，加上回复或撞上限的那一次），上限约 288 次；按以往套件的平均（票 06 的 T 组每次 1–3 次，闲聊套件约 2.2 次，备忘套件约 3.3 次），估 80–130 次。如果新条款有用例没过、改一轮措辞，只重跑没过的 new 用例，最多 7 次运行、63 次调用。
- 这一步停在这里，没有连真模型。

### 4a. 主会话验收后改的五处（零额度）

主会话验收第一版提交后要的五处，都在放行真模型之前做完：

1. 判定只认最终回复里的标签：`dispatched` 以最终回复（不再调用工具的那一条，同 Core 的 `subtask::pending_reply`）里的 `<subtask>` 为准；只写在还调用了工具的中间回复里的，单列为「中间回复里写了标签（真机不会派）」，不算派（`build_result` 记在 `dispatch.mid_tags`）。
2. 「该派」用例按裁决 160「超过两三步就派」分四类：①最终回复派了，合格；②三次工具调用以内自己做完、给了最终回复，合规（条款允许，单列）；③超过三次工具调用还没派，不合格；④停在浏览器，单列（停在问用户同样单列）。阈值是 `CRIT_SMALL_CALLS = 3`。`results.md` 每格与每次运行都写明用了几次工具调用。
3. `e-invoices` 的消息改成「明天下午五点前把下载文件夹里的发票整理好」，`note` 里写明仿 10-28 那轮、改「明天」是为了结果不随开跑时刻变；`results.md` 每个用例下面显示 `note`。
4. 先 `git rebase main` 到本地 main（`01885ecf`，只多了票 117 的报告），再提交。
5. README「派活判据（票 115）」一节补了一句：其他套件的 `galley-prompt/` 模板还是旧条款，重跑那些套件前先重生成。

`--dry-test` 重跑：`DRY TEST PASSED`，963 条 PASS，0 条 FAIL（多出来的是四类各自的合成用例，和一次标签写在调用了工具的那条回复里、最终回复没有标签的假模型运行）。四类的样例输出（干跑测试打印的原文）：

- ①：`e-template: 最终回复派了（之前 2 次工具调用）：合格`
- ②：`e-template: 3 次以内自己做完（3 次工具调用）：合规（三次以内自己做完）`
- ③：`e-template: 超过 3 次还没派（4 次工具调用，自己做完）：不合格`
- ④：`big-quotes: 停在浏览器（第 2 次调用）：单列`
- 中间回复里的标签：`big-pdfs: 中间回复里写了标签（真机不会派）（1 次工具调用）：单列`（假模型在真沙盒里那一次）

### 5. 放行后

（待放行后补。）

### 6. 看到但没改的（Open risks）

1. 沙盒可能太容易：占位 PDF 每个只有一行字，`e-invoices`、`big-pdfs`、`midway-invoices` 可能一两次 `code_run` 就做完，「超过两三步」在沙盒里不一定成立；这三条没派，不一定是条款没起作用。真实环境要逐个读 PDF（10-28 那次 11 步）。（已处理：三次以内自己做完的落进②「合规」，不算条款失效，见 4a。）
2. 「两三步」怎么数由模型自己定：一个脚本挪完十个文件算一步还是十步，条款没说。（评测按工具调用次数数，见 4a；条款本身仍没说。）
3. `unasked.md` 的「Quick work you do this turn; longer work goes to a subtask」仍按长短判，用在「记下一件事时多想一步」和巡看。`todo-note` 这类记完待办顺手做准备的，可能照它派一个子任务；入口层「待办自己做」说的是记这一下，两处的边界没写明。
4. 别的套件的提示词模板还是旧派活条款：`schedule/galley-prompt/`（schedule、todo、chat、memo 四套用它）、`wake/galley-prompt/`、入口层套件的 `galley-prompt/`。按票面没重新生成；下次重跑这些套件测到的是旧条款，除非先重生成。（README 已写明，见 4a。）
5. IM 提示词仍按「keep this chat busy for a long time」判（`managed_prompt.rs` 第 1027 行一带），与主对话的判据现在不一致（按票面不改）。
6. Core 只派最终回复里的 `<subtask>`（`core/src/subtask.rs` 的 `pending_reply` 要求是最终回答）；评测把任何一条回复里的标签都算派，另记了 `in_final`。带工具调用的中间回复里写的标签，真机上不会派出去。（已处理：判定只认最终回复，中间回复里的单列，见 4a。）
7. 每条用例每组只跑 1 遍，不衡量随机波动。
8. 入口层每次主对话请求多 548 字节（多半命中缓存）。
9. 票 06 沙盒结果的 `dispatch-results.md` 用 HEAD 或本分支的 `run.py` 重出都在截断处差几个字，此前就有，与这一票无关。
10. `e-invoices` 的「今天下午五点前」：17:00 以后跑，期限已过，模型可能为此先问或改口；17:00 前开跑更接近真实。（已处理：改成「明天」，见 4a。）
