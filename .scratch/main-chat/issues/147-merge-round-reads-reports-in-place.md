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

## 报告

2026-11-04，分支 `t147-merge-round-reads-reports-in-place`。甲乙都做了：甲在 runner 层（没加补丁），乙只换 Core 截断回答后那一行。评测细节在 [评测 README](../entry-layer-eval/README.md)「合成那一轮读几步（票 147）」一节与 `wake/results.md` 同名一节。

### S3 那一轮读了什么（引擎日志，只记形状）

那一轮是 6 次模型调用：5 步带工具，加写回复那一步（库里也是 5 行步骤加 1 行回复）。

| 步 | 秒 | 工具 | 读了什么 | 回给模型 | 截断 |
| --- | --- | --- | --- | --- | --- |
| 1 | 0–7 | `file_read`（第 1 行起 220 行，不带行号） | 叫醒说明存成的 `temp/user_prompt_*.md` | 7,942 字，全文 | 文件没截 |
| 2 | 7–19 | `code_run` | 手册 `wake.md` 全文，加两个子任务各一次 `session show --tail=1` | 17,788 字 | 超过 GA `code_run` 的输出上限 17,763 字（10,000 × 1.776，`context_win` 90,000），中间换成「[omitted long output]」，第一份回答的后半又没了 |
| 3 | 19–32 | `code_run` | 两个 `session show --tail=40` 的每步摘要，加第一份 `finalAnswer[5500:]` | 1,246 字 | 切片是空的（`finalAnswer` 4,181 字） |
| 4 | 32–42 | `code_run` | 第一个 `--tail=1` 的 `content[6200:]` | 84 字（空） | `content` 4,308 字 |
| 5 | 42–53 | `code_run` | 第一个 `--tail=1` 的字段名、两个字段的长度和最后 6,500 字 | 8,724 字，全了 | 无 |
| 6 | 53–100 | 回复 | — | 2,955 字 | — |

为什么：

- 第 1 步是上游那条：说明 7,942 字，`agentmain.py` 的 `run()` 存成文件，只给模型「Long user prompt saved to … Read and execute.」。`file_read` 读全了，没有截断，所以乙的前提（文件读被截）不成立。
- 第 2–5 步是截断与读法：Core 把每份回答截在 3,000 字（S3 两份 4,181 字、4,136 字），质保与官方链接在截掉那段；截断后那一行指向 `session show --tail=1`，它打印整行消息，`content`（带 `<summary>` 的整条回复）与 `finalAnswer` 各一份，约是回答的两倍。两行加手册超过 GA `code_run` 的输出上限，GA 截掉中间；模型以为是「CLI 默认截断了长结果」（第 5 步的摘要），猜了两次偏移才读全。CLI 本身没截。

### 评测怎么对上真机那条路

- 2,000 字那条本来就一样：worker 用 `agent.put_task(..., source="workbench")` 交给 GA 自己的 `run()`，超过 2,000 字照样存进这次运行状态根的 `temp/`，`w-merge-three` 旧结果第一步就是读那个文件。没改。
- 截断照 Core（`report_cut`）；`code_run` 的上限是 GA 的，按模型配置的 `context_win` 算，gpt-6.1-sol、glm-5.3-flash 都是 17,763 字（与 S3 相同），deepseek-flash 是 10,000 字。
- 补了一处固定数据：`session show` 的最后一行照 Core 存的样子，`content` 带 `<summary>`、`finalAnswer` 是回答本身（`summary_in_content`）；之前两个字段一样长，读整行不会翻倍。
- 新用例 `w-merge-two-long`（`wake/cases.json` 第 16 条）：两款虚构的车（澄川 E7、朔风 S6，网址虚构），回答 3,864 字、3,698 字，带版本口径、限时价、选装价，出处列表与并表口径在 3,000 字之后，说明 7,943 字。两条合成用例都跑 v9 提示词（Core 今天的）、`core` 措辞，并提供 `tell_user`（runner 每一轮都给）。
- 新参数 `--t147 base|inline|rest|both|full`，结果在 `wake/results.json` 的 `meta.ticket147_runs`；`--dry-test` 加了本票的检查，`--dry-test` 过（下面验证）。

### 改前改后

所有运行里用户最先看到的字都是回复（叫醒的一轮不发步骤里的字，没有一遍调 `tell_user`），第一次见字的秒数与出回复相同，只列一栏。

| 用例 | 模型 | 改法 | 遍 | 步数 | 出回复（秒） | 中位：步／秒 | 质量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `w-merge-three` | gpt-6.1-sol | 改前 | 6 | 5、5、5、6、4、6 | 60.4、68.0、59.6、85.7、55.0、82.1 | 5／64.2 | 6/6 |
| | | 甲 | 3 | 3、4、6 | 55.6、67.2、82.6 | 4／67.2 | 3/3 |
| | | 甲＋乙 | 6 | 4、3、5、4、4、6 | 53.7、42.9、81.4、62.9、62.3、75.2 | 4／62.6 | 6/6 |
| | glm-5.3-flash | 改前 → 甲＋乙 | 2 | 2、3 → 1、1 | 28.5、52.1 → 39.1、24.8 | 2.5／40.3 → 1／32.0 | 2/2 → 2/2 |
| | deepseek-flash | 改前 → 甲＋乙 | 2 | 3、5 → 3、2 | 12.7、停在浏览器 → 10.1、8.9 | — → 2.5／9.5 | 1/2 → 2/2 |
| `w-merge-two-long` | gpt-6.1-sol | 改前 | 3 | 4、4、4 | 79.1、82.1、90.5 | 4／82.1 | 3/3 |
| | | 甲 | 3 | 3、3、3 | 73.0、65.7、72.5 | 3／72.5 | 3/3 |
| | | 乙 | 3 | 4、4、4 | 82.5、76.4、75.5 | 4／76.4 | 3/3 |
| | | 甲＋乙 | 3 | 3、3、3 | 68.4、68.1、69.5 | 3／68.4 | 3/3 |
| | glm-5.3-flash | 改前 → 甲＋乙 | 2 | 4、5 → 1、1 | 112.7、176.0 → 82.1、76.0 | 4.5／144.4 → 1／79.1 | 2/2 → 0/2 |
| | deepseek-flash | 改前 → 甲＋乙 | 2 | 9、10 → 6、6 | 都没出回复 → 27.8、30.1 | — → 6／29.0 | 0/2 → 0/2 |

- gpt-6.1-sol 两条都过：步数各少一步（就是读文件那一步），`w-merge-two-long` 82.1 → 68.4 秒，`w-merge-three` 中位 64.2 → 62.6、平均 68.5 → 63.1 秒（几遍顺手识图把秒数拉散），质量 9/9 → 9/9。
- 乙单独对 gpt-6.1-sol 看不出作用：它照说明做核对时读 `--tail=40`，最后那一行已经在里面。乙管的是去读剩下那段的模型：deepseek-flash 改前两遍都在猜偏移，10 次工具调用用完没出回复；改后各用一次 `finalAnswer` 切片读到结尾，6 次调用出了合表。
- glm、deepseek 在 `w-merge-two-long` 改后质量 0/2，原因都是回复里没有两块的官网网址（表本身都对）；甲单独也是 0/2。见 Open risks 1。
- 叫醒套件其余 14 条：gpt-6.1-sol 改前、改后各一遍（各自的提示词），判定逐条相同；11 条两遍都过，`done-evidence`、`two-at-once` 两遍都按旧字数上限判不过，`w-long` 两遍都不过（改前超字数，改后想看截图读不出字、打回；票 134 起一直 0/3）。
- 探针 `full`（没做）：把 3,000 字上限放到 8,000，两份回答整份进说明。gpt-6.1-sol 3 步 65 秒，与甲＋乙差不多；glm、deepseek 各 1/2（网址就在眼前也有一遍没带）。要动裁决 183 第 4 条的数字，数据不支持为此改，不建议。

### 选了甲乙两样，为什么，改在哪

- **甲**：根子之一就是上游的 2,000 字那条，S3 与评测里改前每一遍第一步都是读回那个文件。实现在 runner 层，没动 `agentmain.py`：上游自己的插件钩子 `plugins.hooks` 的 `agent_before`（上游 `plugins/project_mode.py` 用它往一轮的用户消息里加东西）在第一次调模型之前拿到循环的局部变量，Galley 注册一次回调，只在这一轮被 runner 标记过时把那句「Long user prompt saved to …」换回说明全文，并把工作记忆里那行 `[USER]:` 换成上游给短输入写的那样。没有走补丁，因为这是上游现成的接缝，不用在每次基线升级时重放；05-22 那次否掉 `tool_before` 钩子是因为当时 handler 已经是现成的接缝，这里 handler 在第一次调模型之前碰不到用户消息。
  - `runner/ga_session.py:150`（`_LONG_PROMPT_POINTER`）、`:156`（`_inline_prompt`，钩子本身）、`:192`（`_register_inline_hook`，每个进程注册一次）、`:283–310`（`GaSession.arm_inline_prompt` 与说明），模块开头的接缝清单加一条。
  - `runner/workbench_bridge.py:1181`（`_arm_inline_prompt`：只在内置主对话）、`:1855`（`user_message` 带 `wake` 的一轮交说明，其余清掉）、`:1887`（`ask_user_response` 清掉）。用户自己打的长消息照旧走上游那条；外置、工作台、子任务、IM 零变化。
- **乙**：根子之二不在 `file_read`，在读法：截断后那一行指向整行消息（约回答的两倍），两个子任务一起读就撑破 GA 的输出上限。照票面「改说明里怎么读全文那句」，只换这一行：`[… cut for length; the rest is \`finalAnswer[3000:]\` of the JSON line \`session show <id> --tail=1\` prints]`。叫醒说明其余措辞、3,000 字上限、一批一次叫醒都没动。
  - `core/src/subtask_report.rs:835`（`cut_answer`）、`:844`（`cut_then`，原 `cut` 的身子），`:662`（定时任务跑完那段）与 `:748`（子任务做完那段）改用 `cut_answer`；停在步数上限的「最后说的话」在步骤行里不在 `finalAnswer`，照旧用 `cut` 的老那一行（`:823`）。测试 `a_long_answer_is_cut_with_where_to_read_it` 跟着改并补了步数上限那种。

### 改了哪些文件

- `runner/ga_session.py`、`runner/workbench_bridge.py`、`runner/tests/test_inline_prompt.py`（新：钩子的单元测试、bridge 只在内置主对话标记、内置 GA 子进程端到端两条）
- `core/src/subtask_report.rs`
- `docs/ga-baseline.md`（接缝第 24 条，审计入口清单）、`docs/ipc-protocol.md`（`wake` 那段补一句）
- `.scratch/main-chat/entry-layer-eval/`：`run.py`、`README.md`、`wake/cases.json`、`wake/results.json`、`wake/results.md`、`schedule/rust-samples.json`（带截断的那条叫醒样本，临时 Rust 测试重新写出，跑完删掉）
- 本票文件

### 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`：退出 0，47 组 `test result: ok`，合计 1345 passed、0 failed。
- `rustfmt --edition 2021 --check core/src/subtask_report.rs`：无输出（过）。
- `.venv/bin/python -m pytest`：`766 passed, 6 deselected in 13.62s`。
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 44 source files`。
- `.venv/bin/ruff check runner`：`All checks passed!`
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`；`node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (d66509bf)`。`managed-ga/` 没动，没有 `__pycache__`。
- 评测 `--dry-test`：`DRY TEST PASSED`（1363 条 PASS，0 条 FAIL）。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 494 files checked.`；`git diff --check` 过。
- 结果文件扫过本机路径、接口主机、密钥：只剩 `$TMPDIR`、`$PYTHON` 占位与模型自己写的省略路径（`/Users/...`）。

### Open risks

1. glm-5.3-flash、deepseek-flash 在长结果合成（`w-merge-two-long`）改后 0/2：回复里没有两块的官网网址。glm 拿到说明全文就一步写回复，不再去读截掉的那段（改前它经 CLI 读了，2/2 带网址）；deepseek 读到了出处，一遍只写名字、一遍没写。探针（回答整份进说明）也只有 1/2，一部分是模型合表时不带链接。gpt-6.1-sol 不受影响。真机若常用这两个模型做合成，要看出处丢没丢。
2. gpt-6.1-sol 照说明做核对时，两个长子任务的 `--around` 与 `--tail=40` 在一步里一起读，`w-merge-two-long` 每一遍（改前改后）都超过 GA `code_run` 的输出上限（17,788 字，中间被截）。评测里没多花步数，S3 那种找结尾的步数就是从这里来的；乙只去掉了指向整行的那一半，核对那句是说明本身的措辞，没动。
3. `w-merge-three` 的秒数只降了一点（中位 64.2 → 62.6），省下的那一步约 5 秒，被识图之类的绕路盖住；步数稳定少一步。
4. 评测的「第一次见字」就是出回复；票 146 让合成那一轮在 GUI 上看得见过程，评测没有模拟。
5. 甲依赖上游三处：那句话的措辞与 2,000 的门槛、`agent_before` 在第一次调模型前带着 `messages` / `user_input` / `handler` 触发、`run()` 往 handler 的历史里写的那行。上游改了，钩子什么都不做，说明照旧走文件（退回改前，不会坏）；`test_the_engine_hands_a_woken_main_chat_its_note_in_full` 会红。已写进 `docs/ga-baseline.md` 第 24 条。
6. 上游仍会为每次超过 2,000 字的叫醒写一个 `temp/user_prompt_*.md`（钩子在写之后才换），状态根 `temp/` 里会一直攒着（以前就这样，Galley 只清 `model_responses`）。
7. 评测用的是 API key 接入的 gpt-6.1-sol；JC 主对话走 ChatGPT 登录那一行，`context_win` 没核，S3 日志里的输出上限 17,763 字与评测一样，推测相同。
8. 没有 dev 真机走查（不许跑 `tauri dev`）：合入后要在 dev 里重走 S3，看合成那一轮第一步不再读文件。
9. 探针 `full` 第 3 遍第一次撞上接口流中断（379 秒，回复被截），同一遍重跑，被替换的那次没留。
