# 143 要拿去做决定的成品交给子任务深做，能拆就并行，回来合成一份

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 193。只在内置运行时的主对话；外置零变化（外置没有主对话），IM 入口层不动。

## 为什么

- 票 139 把派活收成一句中性的「可以自己做，也可以交出去」，评测 v5 里 72 遍只派 6 遍，对比、整理这类成品几乎全自己做（票 139 报告第 4 节、Open risk 1）。
- JC 11-04：主对话被挡住的问题已经不在了（插话改道，票 136）；积极派活现在为的是质量和并行，复杂的事同时派几个子任务。
- 真机对照（裁决 193 第 2 条）：主对话自己比三款手机 189 秒、3 个出处；拆三个子任务并行 496 秒，表细到每颗镜头、有上市价与版本差异、9 个出处。并行在一个浏览器里跑得通；模型自己等齐了才合表。
- 挡着的两处：入口层「Keep in one tag what has to come back as one thing (a comparison, one table, one report, the answer to one question)」把对比关进一个标签；手册 `subtasks.md`「用户要的就是答案本身时照子任务写的原样给」碰上拆开的几块，会一块一块贴。

## 要做到

### 1. 入口层（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）

- 在「You can do the work yourself, on the web too, or hand it to subtasks, several at once.」之后加一句按用途的判断。意思（措辞你定，英文，照这一段的口吻）：用户要拿去做决定、交给别人或留着用、又得查一查的东西（对比、方案、报告、盘点），交给子任务深做；能拆成几块（一款一个、一处一个、一个来源一个）就一块一个标签、同时跑，最后一件回来时你合成一份。问一句、聊一句、一个事实，自己答。用户明说在这里做或派出去的，照办。材料就在这段对话里、不用查的（把讨论写成一份），照旧自己做。
- 并行那段：删掉「Keep in one tag what has to come back as one thing (a comparison, one table, one report, the answer to one question) and」；「the parts that need the same browser tab or the same files」留在一个标签里照留。「one errand splits into parts whose results each stand on their own」改成能涵盖「拆开、回来再合」的说法。
- 其余（插话那几句、事实先查附出处、`authority.md`、标签写法与标题、派活说明写什么、告诉用户在路上、不等不盯、不用 `subagent.md`）不动。
- 字节预算 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`（现 4805）按实际长度重设，照现有注释的分项写法；Windows 检出是 CRLF，预算按本机长度 +18 设（见预算常量上方注释与以往几轮的做法）。入口层上方文档注释加一段第六轮：裁决 193，为什么（真机对照的数），删了哪句。

### 2. 手册 `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`

「When what the user asked for is the answer itself …」那条之前或之后补一句：回来的是你拆开的几块之一、别的还在跑，最多说一句到哪了（或不说）；最后一块回来时，合成用户要的那一份（一张表、一份报告），附各块的出处。「When several updates arrive at once, cover them all in one reply.」照留。手册 `include_str!` 进 Core，对应断言在 `core/src/assistant_manual.rs`。

### 3. Core 断言

- `main_chat_entry_layer_leaves_the_hand_off_to_judgment`（或同组）：新句的单行片段在；「Keep in one tag what has to come back as one thing」不在；「the same browser tab」仍在。工作台与 IM 的提示词里都没有这一句。
- 手册新句的单行片段（`assistant_manual.rs` 里钉 `subtasks.md` 的那组）。
- contains 断言别跨行（Windows CRLF）。

### 4. 评测（`.scratch/main-chat/entry-layer-eval/`）

加 `v6`（提示词从 Rust 现生成、与 `managed_prompt.rs` 一字不差，做法照票 139 的 v5；先 `--dry-test`）：

- **派活判据**（`dispatch-criterion` 那套 24 条 × 3）用 v6 重跑，按新判法标注（v6 的 kind 写进 README）：对比、方案、报告、盘点这类得查的成品 → 派出去才合格，能拆的（几款、几处）标签数 ≥2 另记；事实、讲讲、概念、追问 → 自己答合格（事实仍要出处）；材料在这段对话里的整理（`conv-writeup`）→ 自己做合格；差事（整理文件、改名、下单）→ 自己做或派都算合格，记下是哪种；明说派的照派。
- **加几条用例**（每条 3 遍）：两款耳机对比整理成表（预期 2 个标签或 1 个，记下）；三款手机对比（预期 3 个）；「帮我整理一份 X 的调研报告」类（派，拆不拆记下）；「上海明天天气」（自己查）；「讲讲某件事」一条（自己查、附出处）。产品用公开型号，人名用虚构的。
- **并行**（`dispatch-parallel`）用 v6 重跑，看拆不拆、标签数，和 v5 并列。
- **叫醒**（`wake/`）加两条：拆成三块、第一块回来、另两块还在跑 → 合格是最多一句进度、不贴半张表；第三块回来、前两块的结果在上文 → 合格是合成一张表、附各块出处。用新手册跑。
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
- 不动：Core 的子任务与叫醒逻辑（裁决 193 第 5 条：不做 Core 攒齐）、GUI、runner、CLI、Agent API、迁移、IM 入口层、外置。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t143-` 前缀。票面与结果里不写本机用户目录、worktree 路径、服务商名、接口主机。
- 长命令前台跑，跑完再往下；别把评测交给后台进程后停下等。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：条款与手册的最终原文；字节预算旧值、新值、分项；改了哪些文件、哪些断言；评测每组每个用例三遍各自的结果（v6 与 v5 并列）、标签数、真模型调用次数；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

## Comments
