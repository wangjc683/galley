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

（代理填写）
