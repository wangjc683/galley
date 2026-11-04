# 143 要拿去做决定的成品交给子任务深做，能拆就并行，回来合成一份

Status: needs-dogfood（2026-11-04 rebase 到含票 144 的 main 后快进合入 `1a42d0a9`。主会话验收：读过条款与手册原文、预算分项（没加 18 的理由成立：入口层测试数字节前去掉 `\r`，票 139 同样设成实测值）、v6 评测表与叫醒对照；合入前在 worktree 跑 workspace 1,344 条全过；diff 扫过私有路径与密钥，0 处。dev 真机走过一遍，见 Comments。Open risk 1、3、5 要 JC 判）

来源：[主对话 PRD](../PRD.md) 裁决 193。只在内置运行时的主对话；外置零变化（外置没有主对话），IM 入口层不动。

## 为什么

- 票 139 把派活收成一句中性的「可以自己做，也可以交出去」，评测 v5 里 72 遍只派 6 遍，对比、整理这类成品几乎全自己做（票 139 报告第 4 节、Open risk 1）。
- JC 11-04：主对话被挡住的问题已经不在了（插话改道，票 136）；积极派活现在为的是质量和并行，复杂的事同时派几个子任务。
- 真机对照（裁决 193 第 2 条）：主对话自己比三款手机 189 秒、3 个出处；拆三个子任务并行 496 秒，表细到每颗镜头、有上市价与版本差异、9 个出处。并行在一个浏览器里跑得通；模型自己等齐了才合表。
- JC 11-04 定甲（成品默认派）与 Core 攒齐（票 144）。
- 挡着的两处：入口层「Keep in one tag what has to come back as one thing (a comparison, one table, one report, the answer to one question)」把对比关进一个标签；手册 `subtasks.md`「用户要的就是答案本身时照子任务写的原样给」碰上拆开的几块，会一块一块贴。

## 要做到

### 1. 入口层（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）

- 在「You can do the work yourself, on the web too, or hand it to subtasks, several at once.」之后加一句按用途的判断。意思（措辞你定，英文，照这一段的口吻）：用户要拿去做决定、交给别人或留着用、又得查一查的东西（对比、方案、报告、盘点），交给子任务深做；能拆成几块（一款一个、一处一个、一个来源一个）就一块一个标签、同时跑，最后一件回来时你合成一份。问一句、聊一句、一个事实，自己答。用户明说在这里做或派出去的，照办。材料就在这段对话里、不用查的（把讨论写成一份），照旧自己做。
- 并行那段：删掉「Keep in one tag what has to come back as one thing (a comparison, one table, one report, the answer to one question) and」；「the parts that need the same browser tab or the same files」留在一个标签里照留。「one errand splits into parts whose results each stand on their own」改成能涵盖「拆开、回来再合」的说法。
- 其余（插话那几句、事实先查附出处、`authority.md`、标签写法与标题、派活说明写什么、告诉用户在路上、不等不盯、不用 `subagent.md`）不动。
- 字节预算 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`（现 4805）按实际长度重设，照现有注释的分项写法；Windows 检出是 CRLF，预算按本机长度 +18 设（见预算常量上方注释与以往几轮的做法）。入口层上方文档注释加一段第六轮：裁决 193，为什么（真机对照的数），删了哪句。

### 2. 手册 `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`

「When what the user asked for is the answer itself …」那条照子任务原样给，碰上拆开的几块会一块一块贴。补一句（措辞你定）：回来的是你拆开的几块，把它们合成用户要的那一份（一张表、一份报告），附各块的出处；还有没回来的，最多说一句到哪了，等最后一块回来再合。背景：票 144 起，同一条回复派出的几件 Core 等齐了（最多等第一件做完后 5 分钟）一起叫醒，所以通常几块一起到；满 5 分钟还有没回来的，先到的几块会先送来。「When several updates arrive at once, cover them all in one reply.」照留。手册 `include_str!` 进 Core，对应断言在 `core/src/assistant_manual.rs`。

### 3. Core 断言

- `main_chat_entry_layer_leaves_the_hand_off_to_judgment`（或同组）：新句的单行片段在；「Keep in one tag what has to come back as one thing」不在；「the same browser tab」仍在。工作台与 IM 的提示词里都没有这一句。
- 手册新句的单行片段（`assistant_manual.rs` 里钉 `subtasks.md` 的那组）。
- contains 断言别跨行（Windows CRLF）。

### 4. 评测（`.scratch/main-chat/entry-layer-eval/`）

加 `v6`（提示词从 Rust 现生成、与 `managed_prompt.rs` 一字不差，做法照票 139 的 v5；先 `--dry-test`）：

- **派活判据**（`dispatch-criterion` 那套 24 条 × 3）用 v6 重跑，按新判法标注（v6 的 kind 写进 README）：对比、方案、报告、盘点这类得查的成品 → 派出去才合格，能拆的（几款、几处）标签数 ≥2 另记；事实、讲讲、概念、追问 → 自己答合格（事实仍要出处）；材料在这段对话里的整理（`conv-writeup`）→ 自己做合格；差事（整理文件、改名、下单）→ 自己做或派都算合格，记下是哪种；明说派的照派。
- **加几条用例**（每条 3 遍）：两款耳机对比整理成表（预期 2 个标签或 1 个，记下）；三款手机对比（预期 3 个）；「帮我整理一份 X 的调研报告」类（派，拆不拆记下）；「上海明天天气」（自己查）；「讲讲某件事」一条（自己查、附出处）。产品用公开型号，人名用虚构的。
- **并行**（`dispatch-parallel`）用 v6 重跑，看拆不拆、标签数，和 v5 并列。
- **叫醒**（`wake/`）加三条：三块的报告一起到 → 合格是合成一张表、附各块出处，不一块一块贴；满 5 分钟只到了两块、第三块还在跑 → 合格是最多一句进度、不贴半张表；第三块后来回来、前两块的报告在上文 → 合格是合成一张表。用新手册跑。
- 插话套件（`tell-user/`）不用重跑，除非 v6 改动碰到那几句。
- 模型写死 `mm_1792576875658`（API key 接入）；解释器用评测 README 写的系统 python3.14，加 `PYTHONDONTWRITEBYTECODE=1`。额度够（JC 11-03），把结论跑扎实，用量写进报告。新条款有用例没过时，最多改一轮措辞、只重跑没过的，然后回报。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

`rustfmt --check` 只查自己改过的 Rust 文件。预计不动 runner、GUI；动了就加对应检查（runner：`.venv/bin/python -m pytest`、`mypy runner`、`ruff check runner`；GUI：`pnpm --dir gui typecheck`、`lint`、`TZ=UTC pnpm --dir gui exec vitest run`）。真机 dev 由主会话合入后走。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t143-deep-work-fans-out <scratchpad>/wt-143 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：Core 的子任务与叫醒逻辑（票 144 另做，改 `core/src/subtask_report.rs`，别碰它）、GUI、runner、CLI、Agent API、迁移、IM 入口层、外置。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t143-` 前缀。票面与结果里不写本机用户目录、worktree 路径、服务商名、接口主机。
- 长命令前台跑，跑完再往下；别把评测交给后台进程后停下等。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：条款与手册的最终原文；字节预算旧值、新值、分项；改了哪些文件、哪些断言；评测每组每个用例三遍各自的结果（v6 与 v5 并列）、标签数、真模型调用次数；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

（2026-11-04，执行代理。分支 `t143-deep-work-fans-out`，基于 main `b51278ab`。没碰 `core/src/subtask_report.rs` 与叫醒逻辑（票 144）、GUI、runner、CLI、Agent API、迁移、IM 入口层、外置。）

### 1. 条款与手册的最终原文

入口层派活那一段（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`），改动在第一句之后与并行那句：

```text
You can do the work yourself, on the web too, or hand it to subtasks,
several at once. Something the user will use to decide, pass on or keep,
and that takes looking into (a comparison, a plan, a report, a survey),
goes to subtasks to be done in depth: one tag per part when it splits (a
product, a place, a source each), all at once, and when the last part is
back you merge them into one. A question, a remark or a single fact you
answer yourself. When the user says to do it here or to hand it off, do
that. A write-up of what this conversation already holds, with nothing
to look up, you do yourself.
The user can talk to you at any time: what they say reaches you at your
next step. When they bring up something else and what you have in hand
will take long, hand it off and answer them first, or tell them a line
now (`tell_user`) and carry on.
…
When the user hands you several errands that do not depend on each other,
or one piece of work splits into parts done apart, whether they stand on
their own or you merge them when they are back, write one tag per part in
the same reply: they run at the same time. Keep in one tag the parts that
need the same browser tab or the same files.
```

- 删掉的：「or one errand splits into parts whose results each stand on their own」（换成上面那半句）与「Keep in one tag what has to come back as one thing (a comparison, one table, one report, the answer to one question) and」。
- 插话那几句、事实先查附出处、`authority.md`、标签写法与标题、派活说明、「on its way」、不等不盯、`subagent.md` 一字没动（「The user can talk to you…」只是换了行：原来接在 `several at once.` 同一行）。
- 措辞没有按评测改过（理由见 4 与 6）。

手册 `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`「Checking a result and reporting it」，在「Otherwise lead with the result…」那条之后、「When several updates arrive at once…」之前加一条：

```text
- When what comes back are parts you split one piece of work into, merge
  them into the one thing the user asked for (one table, one report), with
  each part's sources, rather than giving each part as it came. While some
  are still out, say at most a line of where it stands, and merge when the
  last is back.
```

「When several updates arrive at once, cover them all in one reply.」照留。没写票 144 的「最多等 5 分钟」：模型要的只是「还有没回来的就说一句」，等多久是 Core 的事。

### 2. 字节预算

`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`：旧值 4805，新值 5268，本机实测 5268（不留余量，`\r` 不计）。分项（+463）：

- 「several at once」之后按用途的判断 +518：成品交给子任务深做、能拆一块一个标签、同时跑、最后一块回来合成一份 +304；问一句、聊一句、一个事实自己答 +59；明说的照办 +61；这段对话里的材料不用查的自己写 +94。
- 并行那句：「parts done apart, whether they stand on their own or you merge them when they are back」换掉「parts whose results each stand on their own」+50；删「what has to come back as one thing (…) and」−105。

没有照票面写的「本机长度 +18」：这个常量的注释写的是「no headroom, `\r` not counted」，测试数字节前先去掉 `\r`（CRLF 检出不会多），入口层也没有按平台分的内容（`main_chat_entry_layer("")` 只拼两段原始字符串）；+18 是静态提示词那一条的做法（它有按平台分的内容，Windows 实测多 18）。票 139 也是设成本机实测值（4805），CI 三个平台都过。分项写在常量注释与 `docs/managed-ga-runtime/prompt-composition.md` 的预算一条里。

### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`：条款两处；入口层上方文档注释加第六轮一段（裁决 193：票 139 评测 72 遍只派 6 遍；插话改道之后派活为的是深度与并行；真机对照 189 秒 3 个出处对 496 秒 9 个出处；删了哪句、并行那句怎么改；`subtasks.md` 与票 144 各管什么）；预算常量与分项。测试 `main_chat_entry_layer_leaves_the_hand_off_to_judgment`：新句 8 个单行片段、换了行的插话 4 个片段、并行那句 4 个片段都在；`Keep in one tag what has to come back as one thing`、`what has to come back as one thing`、`whose results each stand on their own` 都不在；`need the same browser tab or the same files.` 仍在；工作台与 IM 的提示词里没有 `Something the user will use to decide`、`to be done in depth`、`merge them`。所有 contains 都是单行片段。
- `core/src/assistant_manual.rs`：`manual_hands_back_an_answer_in_full` 的有序片段表加新那条的 5 个单行片段和「- When several updates arrive at once, cover them all in one reply.」，都要在「Checking a result and reporting it」之下、按顺序。
- `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`：上面那条。
- `docs/managed-ga-runtime/prompt-composition.md`：入口层「Do it yourself or hand it off, by judgment」一条补裁决 193 的判断，并行那半句改写（写明票 134 到票 143 之间要合成一份的放一个标签）；预算一条 5268 与分项。
- 评测（`.scratch/main-chat/entry-layer-eval/`）：`run.py`（`v6`：`CRIT_VARIANTS`、`PAR_VARIANTS`、`CRIT_PROMPTS`、`RULE_TALK_VARIANTS`；`V6_KINDS`、`crit_judge_v6`、`crit_should_v6`；并行套件的 `tags_v6` 与 `par_want`；叫醒的 `wake_history` 与 `wake_facts` 新判定 `tables`、`one_table_has_all`、`sources_groups`、`absent_values`、`max_lines`，`md_tables`；`results.md` 的 v6 列与统计；`--dry-test` 加的检查见 5）、`dispatch-criterion/galley-prompt/main_chat.v6.txt`（新）、三套的 `cases.json`、各自的 `results.json` / `results.md`、`composed/` 里四份 v6 请求、`README.md`（文件一节，派活判据、并行、叫醒各加票 143 一节）。

### 4. 评测

模型 `mm_1792576875658`（API key 接入），解释器 README 写的系统 python3.14 加 `PYTHONDONTWRITEBYTECODE=1`；先 `--dry-test`。v6 由 Rust 现生成（临时测试写出文件，跑完删掉），`--dry-test` 核对入口层与 Rust 一字不差、与 v5 只差派活那一段。判结果，按每条的 `v6` 标注（`V6_KINDS`，写进了 README 与 `cases.json` 的说明）。

**a. 派活判据**（25 条原有 + 5 条新加，各 3 遍；新五条另跑 v5 各 3 遍作对照）：

| 用例 | v6 判法 | v5 三遍 | v6 三遍 |
| --- | --- | --- | --- |
| q-injuries | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| q-east | question | 自己上网查 ×3 | 自己上网查 ×3 |
| q-story | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| q-weather | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| q-notes-apps | either | 自己上网查 ×3 | 派 1 个 ×3（「筛选 Mac 本地笔记软件」等，说明里要官方来源） |
| quick-usd | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| quick-downloads | question | 看一眼自己答 ×3 | 看一眼自己答 ×3 |
| todo-note | self | 自己记下 ×3 | 自己记下 ×3 |
| conv-writeup | conv | 自己写 ×3 | 自己写 ×3 |
| e-invoices | errand | 自己整理完 ×3 | 看了文件夹后派 1 个 ×3 |
| e-template | errand | 自己做完 ×3 | 派 1 个 ×1、自己做完 ×2 |
| big-quotes | deliverable（3 块） | 自己上网查 ×3 | 自己上网查 ×3（不合格） |
| big-pdfs | errand | 自己整理完 ×3 | 自己整理完 ×3 |
| big-research | deliverable | 派 1 个 ×3 | 派 6 个 ×3（一款软件一个） |
| ask-dispatch | handoff | 派 1 个 ×3 | 派 1 个 ×3 |
| midway-invoices | errand | 自己归档完 ×3 | 自己归档完 ×3 |
| q-headphones | deliverable（2 块） | 自己上网查 ×3 | 派 2 个 ×3（一款一个） |
| q-fact-injury | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| q-followup-quick | direct（不计分） | 上网核实 ×3 | 上网核实 ×3 |
| q-followup-sourced | direct | 上网核实 ×2（不合格）、读子任务记录后答 1（单列） | 读一次子任务记录后上网核实 ×1（不合格）、读两三次后答 ×2（单列） |
| q-followup-shown | direct | 直接答 1、读一次子任务再答 2（单列） | 直接答 1、读一次再答 1（单列）、读一次后上网核实 1（不合格） |
| q-recent-fact | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| q-concept | direct | 直接答 ×3 | 直接答 ×3 |
| q-howto | direct | 直接答 ×3 | 直接答 ×3 |
| q-browser-insist | self-web | 自己开浏览器 ×3 | 自己开浏览器 ×3 |
| c-headphones-pair（新：索尼 XM6 对 Bose QC Ultra 二代） | deliverable（2 块） | 自己上网查 ×3 | 派 2 个 ×3（一款一个） |
| c-phones-three（新：裁决 193 真机那句） | deliverable（3 块） | 自己上网查 ×3 | 派 3 个 ×3（一款一个） |
| c-research-report（新：扫地机器人调研报告） | deliverable | 派 1 个 ×3 | 派 5 个 ×1（一个品牌一个）、派 3 个 ×2 |
| c-weather-sh（新：上海明天天气） | fact | 自己上网查 ×3 | 自己上网查 ×3 |
| c-story-finals（新：讲讲 2016 年总决赛 1 比 3 翻盘） | fact | 自己上网查 ×3 | 自己上网查 ×3 |

- 合计：v6 合格 79、不合格 5（`big-quotes` 3、`q-followup-sourced` 1、`q-followup-shown` 1）、单列 3、不计分 3；v5（按 v5 标注）合格 82、不合格 2、单列 3、不计分 3。派出去的：v6 90 遍里 25 遍（成品 15、两可 3、差事 4、明说派 3），v5 9 遍。第一个工具是浏览器 v6 12 遍、v5 14 遍；`code_run` 上网 0；讲规则或「主对话」0。
- 成品的标签数（每遍）：`q-headphones` 2、2、2；`c-headphones-pair` 2、2、2；`c-phones-three` 3、3、3；`big-research` 6、6、6；`c-research-report` 5、3、3；`big-quotes` 0、0、0。15 遍派出去的每个标签说明里都要了出处，回复都说回来合成一张表或一份报告。
- 问一句与事实 30 遍（8 条事实、2 条问一句）没有一遍派出去，凭记忆答 0 遍。
- `big-quotes` 三遍：先在历史会话里搜三家（名字是虚构的，搜不到），第 3 次调用 `web_scan` 看浏览器开着哪些标签页，沙盒停在那里，看不到找到官网后派不派。

**b. 并行**（本票 7 条 × 3，v6 与 v5 并列）：

| 用例 | v5 三遍 | v6 三遍 |
| --- | --- | --- |
| p-three-errands | 3 个 ×3 | 3 个 ×3 |
| p-split-one | 自己做完 1、3 个 ×2 | 3 个 ×3 |
| p-same-tab | 自己开浏览器 ×3 | 自己开浏览器 ×3 |
| p-same-files | 自己做完 ×3 | 自己做完 ×2、1 个 ×1 |
| p-question-parts | 自己上网查 ×3 | 2 个 ×3（西部、东部各一），不合格 |
| p-errand-and-question | 只派天气、订票先问 ×3 | 只派天气、订票先问 ×2，先问再自己查天气 ×1 |
| p-errand-and-question-full | 2 个 ×3 | 2 个 ×3 |

v6 合格 18、不合格 3（都是 `p-question-parts`）；v5 合格 18、不合格 3（`p-errand-and-question`，当时按 2 个判；v6 按 `tags_v6` 1 到 2 个判，天气算一个事实）。标题都在、都合规。

**c. 叫醒**（新加三条，v6 提示词、`core` 措辞，各 3 遍；另跑一组把 `subtasks.md` 换回 main 上的对照，同一时段、其余不变，存在 `meta.ticket143_control`）：

| 用例 | 新手册 | 对照：手册改之前 |
| --- | --- | --- |
| `w-merge-three`（三块一起到） | 过 ×3：一张三列的表，三块的官网出处都在，914–994 字 | 过 ×3 |
| `w-two-of-three`（到了两块，第三块在跑） | 过 ×3：一句话（「星澜 S9、青梧 P70的规格已查齐，还差远岫 M5；等它返回后，我会把三款合成一张对比表。」），45–53 字，没有表 | 不过 ×3：先把两块填进三列的表、第三列写「待返回」，734–753 字 |
| `w-third-back`（第三块后到，前两块的报告在上文） | 过 ×3：合成一张表，出处都在，848–929 字 | 过 ×3 |

一起到的几块，入口层「最后一块回来时合成一份」已经够它合表；手册新那条管的是没回齐时：没有它三遍都先贴半张表，有它三遍都只说一句。18 遍没有打回、没有上网、没有带出子任务「一共打开 N 个页面」那句。三款手机是虚构的（同 `w-table`，免得模型拿自己知道的规格去核、跟固定数据打架）。

插话套件（`tell-user/`）没重跑：v6 没碰插话那几句（只换了行）。

**没改措辞**：因新条款不合格的是 `big-quotes`（停在开标签页那一步，改措辞对不上它）与 `p-question-parts`（一句问题被拆成两个标签派出去）。后者要拉回来，得把「问一句」与「盘点」的界线写得更细，这会碰到同样以问句出现的对比；票面只许重跑没过的，看不到对比那几条会不会跟着退，所以留给 JC 判这句算问一句还是盘点（见 6 第 1 条）。

**真模型调用**：144 次运行、383 次模型调用（输入 3,040,210 token，缓存 1,645,184，输出 156,596）。派活判据 v6 90 次运行 209 次；新五条的 v5 对照 15 次 32 次；并行 v6 21 次 62 次；叫醒 9 次 38 次；叫醒对照 9 次 42 次。没有失败、超时或断连的运行。

### 5. 验证

数字照抄输出：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1334 passed，0 failed，0 ignored（`exit 0`）。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`
- `git diff --check main`：无输出。
- `rustfmt --check`：`managed_prompt.rs`、`assistant_manual.rs` 干净（main 上本来干净）。
- `run.py --dry-test`：1266 条 PASS、0 条 FAIL，`DRY TEST PASSED`（票 139 时是 1211 条；新加的是 v6 的提示词与标注、判法、并行的 `tags_v6`、叫醒三条的消息、上文、假 CLI 与判法）。
- 没动 runner、GUI，没跑那几组检查。`managed-ga/`、`runner/`、`.scratch/` 下没有 `__pycache__`。新增行里没有本机用户目录、worktree 路径、临时目录、密钥、服务商名或接口主机（`results.*` 照 `scrub` 写成 `$TMPDIR`）；全角标点扫过新增行（`results.*` 是模型原文，不扫），命中 1 处：`prompt-composition.md` 英文句子里原有的「乙」后跟半角逗号（英文语境，票 139 也这样留着）。

### 6. 看到但没改的（Open risks）

1. **`p-question-parts` 三遍都拆成两个标签派出去**：「新赛季西部和东部各有哪几支队能进季后赛？」被当成能按「一处一个」拆的成品（西部、东部各一），正是裁决 193 第 6 条写的翻车点；v5 下三遍都自己查。我按裁决 193 标它问一句、判不合格；同样是预测的 `q-east`（「东部呢？」）三遍都自己查。它算问一句还是盘点，请 JC 判；若算问一句、要拉回来，措辞得另起一轮并连对比几条一起重跑。
2. **`big-quotes` 三遍停在主对话自己看浏览器标签页**：三家供应商名字不熟（虚构），它先想确认官网，沙盒在第一次浏览器调用就停，看不到之后派不派。按判法记不合格；真机上可能是先在主对话里找到官网再派，也可能整件自己做。公开型号的对比 9 遍都是读了手册或记忆（1–2 次调用）就直接派，没开浏览器。
3. **两可的那条也派了**：`q-notes-apps`（「Mac 上有哪些好用的本地笔记软件？」）三遍都派 1 个标签，说明里写「通过真实浏览器查证官方来源…交回推荐与官方链接」。我标两可（问法是一句问题，用处像选软件）；按「问一句自己答」读，这是 3 遍不合格。标注都是我按裁决 193 定的（`q-notes-apps` 两可、`q-injuries` 事实、`q-east` 与 `quick-downloads` 问一句、`e-template` 差事、`big-quotes` 与 `big-research` 成品），请看是否同意。
4. **差事也更多派出去了**：`e-invoices`（整理下载文件夹里的发票）从 v5 的三遍自己做变成三遍派（先看文件夹，说明里列了文件）；`e-template` 一遍派。按判法都合格，但这是新句子溢出到差事上：一件文件整理多一个子任务的固定开销（开头读规范、结尾写记忆、回来叫醒一轮）。
5. **拆得多**：调研报告拆成 3–6 块（`big-research` 三遍都是 6 款软件各一个）。条款与 Core 都没有数量上限；一句话起 6 个子任务、6 个浏览器标签页，真机上并行能不能稳、token 是多少，评测里子任务不跑，没测到（11-04 真机只测过 3 件）。
6. **天气照旧被派**：`p-errand-and-question` 里天气 2 遍派出去（订票缺出发地，先问），按裁决 193 天气是自己答的一类；`tags_v6` 判法放过了它（1 到 2 个都合格）。
7. **Core 的完成那段仍写「the answer itself in full」**：`core/src/subtask_report.rs` 每一件完成的报告都写「tell the user what they asked for, as `subtasks.md` says: the answer itself in full when it is a table…」，拆开的几块各自也有这一句。评测里手册新那条压住了它（合表 6/6、没回齐时一句 3/3），但两边的字面在拉扯；那个文件归票 144，我没碰。
8. **叫醒只测了活着的 runner**：`w-third-back` 的上文是前一次叫醒的完整消息（runner 一直活着时的样子）。runner 中途重启过的话，回放里那一轮只剩「[Galley: subtask … finished — details: session show …]」，前两块要 `session show` 才拿得到，没测。票 144 的攒齐与 5 分钟是按样子拼的消息，没经 Core；`w-two-of-three` 里叫醒消息没说第三块还在跑，模型是从上文的三个标签自己看出来的。
9. **成品在沙盒里一上网就停**：v6 下成品「自己上网查」判不合格，但运行停在第一次浏览器调用，「先查一下再派」与「整件自己做」分不开（第 2 条就是这样）。
10. **预算没加 18**：理由见 2；若主会话要按票面留 18 字节余量，改常量一处即可，注释里的分项不变。
11. **`q-followup-sourced` / `q-followup-shown` 的老问题**：追问先 `session show` 子任务再上网核实，v5、v6 各有 1–2 遍，与新条款无关（票 139 Open risk 2）。
12. **没动的文档**：`docs/project-status.md` 的未发版范围、主对话 PRD、devlog 都没改，留给主会话；`docs/devlog/deferred.md` 里没有「同一批子任务的结果攒一攒」那条（它在 `docs/devlog/2026-11-03-galley-name-and-subtask-visibility.md` 的「挂信号」里），撤不撤归票 144 或主会话。

## Comments

- 2026-11-04 08:48–08:57 主会话 dev 真机（真实模型，CLI 发、查库；Core 带票 143、144）：发「比较索尼 Xperia 1 VI、华为 Pura 70 Ultra 和荣耀 Magic6 至臻版这三款手机，整理成一张表」，没说拆。
  1. 主对话读手册一步，35 秒后回「我会分三路同时查，最后合成一张对照表」，派出 3 个（一款一个）。
  2. 三件分别在 5 分 41 秒、6 分 20 秒、7 分 15 秒做完（相差 94 秒）。前两件做完时 Core 没叫醒；第三件做完立刻叫醒一次，那条叫醒带三份报告。主对话 59 秒合成一张表，附三款各三个出处，回「简单选」与选购倾向。从发出到表 8 分 14 秒；一条回复，没有进度句。
  3. 中间 08:51 到了 JC 的晨检（真实定时），主对话查了待办、提醒与在跑的任务，回 `<no-reply/>`；那时还没有报告在等，与攒齐无关。
  4. 没写备忘、待办、提醒或文件。界面没截（CLI 走查），子任务卡片与那条合成回复的样子等 JC 在 dev 里看。
