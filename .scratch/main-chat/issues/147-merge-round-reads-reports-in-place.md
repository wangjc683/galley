# 147 合成那一轮少走几步：子任务的结果直接读到，不先绕文件

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 198（JC 11-04：「丙，0.7.6 不急着发布」「按你推荐推进」）。只在内置运行时的主对话；外置零变化（外置没有主对话，也没有子任务回报）。和票 [146](./146-merge-round-shows-it-works.md)（只动 GUI）并行做，互不碰文件。**先量，再改。**

## 为什么

- v0.7.6 草稿冒烟 S3（两款车对比，按款拆成两个子任务）：两件同一秒回来，Core 一次叫醒，合成那一轮 5 步、100 秒才出回复。前 4 步约 54 秒都在读结果，步骤摘要依次是「收到文件形式的补充内容，先读取全文确认要求」「两款资料已返回，先补齐来源和版本说明」「已确认……主表选……」「核心数据已齐，补读小米资料末尾的质保与官方链接后交付」「CLI默认截断了长结果，改为提取末条完整正文，保留出处」，最后一步约 46 秒写回复。
- 主会话查到的一处：上游 GA 收到超过 2,000 字的输入，先存成文件，只把一句「Long user prompt saved to … Read and execute.」交给模型（`managed-ga/code/agentmain.py:211`）。S3 那条叫醒说明 7,942 字（两份结果各约 4,100 字全文）。裁决 183 第 4 条让结果整份交回、票 144 一批合成一次叫醒，所以合成的叫醒说明几乎总超过 2,000 字。为什么读完文件还要去 CLI 翻、又被截断，主会话没查清，你来查。
- 库里你派出去的子任务回来的 13 轮，从叫醒到回复中位 56 秒、8 轮过 50 秒。票 146 让这段时间看得见；这张票让它短一些。

## 要做到

### 1. 先量（不改代码）

- **看 S3 那一轮的引擎日志**：JC 本机状态根 `temp/model_responses/` 里 2026-11-04 07:59:55 UTC 起那一轮（只读；内容是两款车的公开资料，但报告里只写形状：每一步调了什么工具、读了多少字、哪里被截断、截断提示原文那一句），弄清 4 步各读了什么、为什么读文件之后还去 CLI。
- **评测**：`.scratch/main-chat/entry-layer-eval/` 的叫醒套件已有 `w-merge-three`（三款手机三块合成一张表）。先看沙盒里叫醒说明走不走 `agentmain.py` 那条 2,000 字的路（评测怎么把说明交给模型，和真机一样吗；不一样就先让它一样，写清楚怎么做到的）。再加一条接近 S3 的：两块、每块约 4,000 字的中文结果（产品、网址都虚构，带版本口径与出处）。
- 每一遍记：合成那一轮的步数、读了什么（工具与字数）、第一次见字的秒数、出回复的秒数，以及合成表的质量（每块的出处都在、口径同价位或标明、没有一块一块贴、没打回、没 `<no-reply/>`）。gpt-6.1-sol 每条 3 遍。

### 2. 再改（按量出来的根子选最小的改法）

候选，按你查到的选，报告里写为什么：

- **甲**：内置 runner 让 Galley 自己的叫醒说明（子任务回报、到点提醒、巡看那几种 Core 写的系统消息）不走 2,000 字存文件那条，模型直接在上下文里读到全文；你打的长消息照旧走上游那条。实现上优先 runner 层的接缝；必须动 `agentmain.py` 就照补丁规则加一个最小补丁（[managed GA runtime](../../../docs/managed-ga-runtime/README.md)：最小、隔离、有文档、能在上游上重放；`check-managed-ga-payload`、`check-ga-baseline-drift`、补丁栈从干净上游重放逐字节一致）。
- **乙**：如果读完文件还去 CLI 是因为文件读被截断（GA `file_read` 的默认行数或单行长度），那根子不在 2,000 字，在读法；改说明或手册里「怎么读全文」那句，别动引擎。
- 两样都有就都做，各自量。
- 叫醒说明本身的措辞、结果整份交回（裁决 183 第 4 条）、一批一次叫醒（票 144）都不改。

### 3. 改后再量

- 同一组用例（`w-merge-three`、新加的那条）gpt-6.1-sol 各 3 遍：步数、第一次见字、出回复的秒数下来，合成表质量不退，才算过。
- 叫醒套件其余用例重跑一遍，不退步；glm-5.3-flash、deepseek-flash 在两条合成用例上各 2 遍，看有没有只在它们身上出的问题。
- 模型：`mm_1792576875658`（gpt-6.1-sol）、`mm_1787796272610`（glm-5.3-flash）、`mm_1789025687188`（deepseek-flash），都是 API key 接入，`--model-id` 换。解释器是 README 写的系统 python3.14，加 `PYTHONDONTWRITEBYTECODE=1`。JC 说过额度够，测试尽管用。

## 验证

- runner 动了：`.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`。
- 内置 GA 动了：`node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs`，补丁栈从干净上游重放；探针 import `managed-ga/code` 用 `python -B`，`managed-ga/` 下不能留 `__pycache__`。
- Core 动了（预计不动）：`cargo test --manifest-path core/Cargo.toml --workspace`，`rustfmt --check` 只查自己改的文件。
- 评测：`--dry-test` 过；结果文件不记接口地址、本机路径（`run.py` 的 `scrub`）。
- `node scripts/check-docs-links.mjs`、`git diff --check`。

## 环境与边界

- 只在自建 worktree 里做（放 scratchpad，从 main 起分支 `t147-merge-round-reads-reports-in-place`）；动 Rust 才需要克隆 target（`cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/`，删 `incremental`，再 `cp -cR core/python-bundle core/gen <wt>/core/`）。绝不碰主工作树，不跑 `tauri dev`。
- 不动：GUI（票 146）、CLI 与 Agent API、迁移、IM、外置、入口层的派活条款。手册只在乙需要时改「怎么读全文」那一句。
- 在分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t147-` 前缀。报告与评测结果里不写绝对路径、接口主机、服务商名。
- 长命令（评测、全量测试）前台跑，跑完再往下；别交给后台任务或分叉代理。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：S3 那一轮 4 步各读了什么、为什么；评测怎么对上真机的那条路；改前改后的表（步数、见字、出回复、质量，按模型与用例）；选了甲还是乙、为什么、改在哪几行；改了哪些文件；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。
