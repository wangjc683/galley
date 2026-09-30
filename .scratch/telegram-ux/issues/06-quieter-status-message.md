# 06 状态消息去冗余：去掉「已完成 N 步」行，分钟后缀收短（Telegram + Discord）

Status: done
Blocked by: —
PRD：[../PRD.md](../PRD.md)

## 背景（JC 试用 + 裁决，2026-09-30）

JC 试用 Telegram 觉得状态消息偏吵：`已完成 7 步` 下面紧跟 `07 …`，看到 07 就已经知道完成了 7 步。

- 桌面端的「已完成 N 步」是 `RunFoldHeader` 的 live 变体（`gui/src/components/conversation/RunFoldHeader.tsx:96-105`）：可点的
  披露控件 + 工具气味段，数字只是其中一部分。IM 里两样都没有（气味段在 Discord 对齐时已裁掉、状态消息不可点），只剩一个数字，
  而下一行的步号已经说了。
- 单步满一分钟后的 `·· 思考中 · 已 3 分钟 · 仍在运行`：「思考中」与「仍在运行」重复。
- **裁决（方案 1）**：两处都改，Telegram 与 Discord 一起改（两边同结构、同冗余；只改一边会让两渠道分叉）。桌面端不改。

## 做什么

改后的状态消息（逐字）：

```
07 读取会话列表
·· 思考中 · 已 3 分钟
```

1. **去掉「已完成 N 步」行**：
   - Telegram：`tgapp.py` `_live_text`（补丁 `0024`）。
   - Discord：`dcapp.py` `_status_content`（补丁 `0023`）。
   其余行不变：`NN summary`（≥ 1 步落定才有）、`·· 思考中` / `·· 排队中`、Telegram 的 `另有 K 条消息排队中`。
2. **分钟后缀**：` · 已 {M} 分钟 · 仍在运行` → ` · 已 {M} 分钟`（阈值、向下取整、步落定归零都不变）。
   - Telegram：共享文件 `galley_im_display.py` 的 `still_running_suffix`（补丁 `0024`），docstring 同步。
   - Discord：`_status_content` 里的内联拼接（补丁 `0023`）。
3. **不改**：提问消息的 `⏸ 等你回复 · 已完成 N 步` / 回显的 `已回复 · 已完成 N 步`（状态消息那时已删，这是唯一的步数）；回答顶部的
   折叠头（Telegram 的可折叠块 b、Discord 的 `-# N 步 · 用时 X`）；停止定格 `⏹ 已停止 · N 步 · 用时 X`。

## 补丁顺序的坑（必读）

栈里 `0026`（`frontends/dcapp.py`）排在 `0023` 之后，而且是 **zero-context** 补丁：删掉 `0023` 里的行会让 `0026` 所有后续 hunk 的行号
偏移，纯新增的 hunk（`@@ -N,0 +M @@`）没有前像可匹配，可能**静默插到错误位置**。所以：

- dcapp：在克隆里先重放到 `0022`，基于它改出新 `0023` 并导出；再在新 `0023` 之上把 `0026` 的改动重新做一遍（语义不变）并重新导出 `0026`。
  最后的 dcapp 必须等于「当前 payload 的 dcapp 只做本票两处改动」的结果——先手工做出这个期望版本，重建后逐字节比对。
- tgapp / `galley_im_display.py`：只有 `0024`（及其前的 `0014`）触及，重导出 `0024` 即可；同样逐字节比对。
- 最后 `build-managed-ga.sh` 重放全部 26 个补丁 clean，`managed-ga/code` 里只有 `frontends/dcapp.py`、`frontends/tgapp.py`、
  `frontends/galley_im_display.py` 三个文件变化。

## 连带文档（你负责）

- `managed-ga/patches/manifest.md`：`0023`、`0024` 两行里状态消息的描述（`已完成 N 步` (N ≥ 2) 与 `仍在运行` 后缀）按新形态改；`0026` 行
  若提到行号 / 与 `0023` 的依赖，按需补一句；「Last replay verified」按本次重放改写。
- `docs/ga-baseline.md`：若有状态消息逐字描述（Step 8 真机清单等），同步。
- 本票面末尾写 `## Comments`。
- 主会话负责：设计文档 §9、devlog、`project-status.md`。

## 约束

- 补丁流程同 Discord 05 / 06（只读克隆 `~/Documents/GenericAgent` 到 scratchpad 你自己的子目录、checkout
  `1b6442fe4f97d87a3d9d52d76569f69d156af853`、先重建确认干净、导出 zero-context 格式同现有补丁、重建后逐字节一致）。
  **绝不改 `~/Documents/GenericAgent`，绝不手改 `managed-ga/code/` 当交付。**
- 除本票两处文案外行为零变化；不动 `runner/im_resume.py` 与 reporter。
- 中文全角标点。

## 验证

- 更新 `runner/tests/test_managed_telegram_tgapp.py` 与 `runner/tests/test_managed_discord_dcapp.py` 里断言状态消息内容的用例（多步状态行、
  分钟行、续跑计数的状态行等），补一条「≥ 2 步时状态消息没有『已完成』行」的断言。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check` 全绿；
  `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs` 绿。
- `grep -n "仍在运行" managed-ga/code/frontends/{dcapp,tgapp,galley_im_display}.py` 无残留（注释里解释改动的除外）。

## 回报

**不要 commit / add。** 只碰：`managed-ga/patches/0023-*.patch`、`0024-*.patch`、`0026-*.patch`、`managed-ga/patches/manifest.md`、
`managed-ga/code/`（build 产出）、上述两个测试文件、`docs/ga-baseline.md`、本票面。完成后把本票 `Status:` 改成 `done`，写 Comments
（做了什么、偏差与理由、门禁实际输出、主会话要看的点），并回复同样内容的中文摘要。

## Comments

### 2026-09-30 · 实现完成（`0023`、`0024` 原地重导出，`0026` 在新 `0023` 之上重导出）

**做了什么**

- 补丁流程：只读克隆到 scratchpad 的 `quiet-status/ga-replay`，checkout `1b6442fe`；先用它重建一次，`git status managed-ga/` 干净。另起两个只放目标文件的工作仓：
  - dcapp：上游文件 → 叠 `0018`（base）→ 叠旧 `0023` → 叠旧 `0026`。先验证配方 `git diff -U0 <前> <后> -- frontends/dcapp.py | grep -v '^index '` 能逐字节复现现有 `0023` 和 `0026`，末态也与 payload 逐字节一致。然后在旧 `0023` 上改出新 `0023` 并导出；再把旧 `0026` 那次提交 cherry-pick 到新 `0023` 之上（git 按上下文合并，无冲突），导出新 `0026`。
  - tgapp：上游 `tgapp.py` → 叠 `0014`（base）→ 叠旧 `0024`。`0024` 本来就带 `index` 行，配方是不滤 `index` 的 `git diff -U0 <前> <后>`（新文件 `galley_im_display.py` 排在前面），先逐字节复现现有 `0024`，再改、重导出。`index` 行的新侧 blob 哈希随内容更新（`de2e39e` → `81ba31b`、`5bc912a` → `6f3cc9b`），与仓库里 payload 的 blob 一致。
  - 期望版本：先把当前 payload 的三个文件拷出，只做本票两处改动（脚本逐处断言恰好命中一次）。cherry-pick 出的 dcapp、改后的 tgapp 与 `galley_im_display.py` 都与期望版本逐字节一致（`cmp`）。
  - 装回三个补丁后用克隆重建：25 个补丁全部 clean，`py_compile` 通过；`managed-ga/code` 只有 `frontends/dcapp.py`、`frontends/tgapp.py`、`frontends/galley_im_display.py` 三个文件变，三者都与期望版本逐字节一致。
- 代码改动只有这两处：
  - dcapp `_status_content`、tgapp `_live_text`：删掉 `if settled >= 2: lines.append(f"已完成 {settled} 步")`。
  - 分钟后缀：dcapp `_status_content` 的内联拼接、`galley_im_display.still_running_suffix` 的返回值与 docstring，从 ` · 已 {M} 分钟 · 仍在运行` 改为 ` · 已 {M} 分钟`。阈值、向下取整、步落定归零都没动；函数名 `still_running_suffix` 没改（改名要连带 tgapp 的 import，票面没要求）。
- 新 `0026` 只改了 hunk 头：35 个 hunk 里，位于 `_status_content` 之后的 26 个新旧两侧起始行都上移 2 行，行数与 hunk 正文逐字节不变；前面 9 个完全不变。
- 坑的实测：旧 `0026` 直接叠到新 `0023` 上，`git apply --unidiff-zero` 退出码是 0，但纯新增 hunk 落偏 2 行（`return active`、`_forget_active_channel`、`run_agent` 的签名等插错了位置），这次只靠 `py_compile` 报 IndentationError 才抓住；换一种偏法未必编译失败。
- 测试：
  - `test_managed_discord_dcapp.py`：多步状态消息、限流合并后的那次编辑、长步骤分钟行、`_status_content` 纯渲染（2 步、续跑到 11 步）、按钮回答与打字回答后续跑的状态消息（`02 确认方向\n·· 思考中`），按新形态改。
  - `test_managed_telegram_tgapp.py`：多步状态消息、分钟行与步落定归零、`still_running_suffix` 三条、按钮回答后续跑的两条状态行，按新形态改。
  - 两个文件的多步用例各补一条断言：状态消息从发出到每次编辑都没有「已完成」。
  - 变异检查（scratchpad 副本，把 payload 的三个文件换回 HEAD 版本，没动仓库）：两个模块共 87 条，正好这 10 条改过的用例失败，其余 77 条通过。
- 文档：`manifest.md` 的 `0023`、`0024` 两行状态消息描述按新形态改，`0023` 行补一句删改的来由（指向本票）；`0023` 行的依赖处补「`0026` 叠在它上面，每出一个新 `0023` 都要在其上重导出 `0026`」；`0026` 行补一句为什么必须重导出（zero-context，`0023` 行数一变，纯新增 hunk 会静默落偏）；Last replay 按本次改写，原段落挪成 Previous replay。

**偏差与自行裁量（附理由）**

1. 票面写「重放全部 26 个补丁」，实际栈是 25 个（编号到 `0026`，`0005` 空缺），全部 clean。
2. `docs/ga-baseline.md` 没改：里面没有状态消息的逐字描述，Step 8 的 Discord、Telegram 清单只写「status message edits in place」，改后仍然成立。
3. `0026` 没有手工重做，而是把旧 `0026` 那次提交 cherry-pick 到新 `0023` 上。git 按上下文合并，不靠行号，语义不变；另有两条事实兜底：末态与期望版本逐字节一致，新旧 `0026` 除 hunk 头外逐字节一致。
4. Telegram 那条新断言写成 `"已完成" in (text or "")`：`shown()` 的类型是 `list[str | None]`，直接写 `in text` 过不了 mypy。

**门禁实际输出**

- `.venv/bin/python -m pytest`：`461 passed, 6 deselected in 5.05s`（两个模块单跑 `87 passed`）
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 28 source files`
- `.venv/bin/ruff check runner`：`All checks passed!`
- `git diff --check`：无输出，exit 0
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`，exit 0
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (1b6442fe)`，exit 0
- `grep -n "仍在运行" managed-ga/code/frontends/{dcapp,tgapp,galley_im_display}.py`：无匹配（exit 1）

**主会话要看的点**

- 没有 commit、add。我碰过的文件：`managed-ga/patches/0023-managed-discord-conversation-ux.patch`、`0024-managed-telegram-conversation-ux.patch`、`0026-managed-discord-restart-continuity.patch`、`managed-ga/patches/manifest.md`、`managed-ga/code/frontends/{dcapp,tgapp,galley_im_display}.py`（build 产出）、`runner/tests/test_managed_discord_dcapp.py`、`runner/tests/test_managed_telegram_tgapp.py`、本票面（未跟踪，提交时一并带上）。工作树里的 `.scratch/telegram-ux/PRD.md`、`docs/design/overlays-and-settings.md` 不是我改的。
- 三个补丁要放进同一个提交：新 `0026` 只对新 `0023` 成立，拆开提交会让中间那个提交的 payload 重建失败或静默落偏。
- 仍写着旧形态、但不在我可碰范围的地方：`.scratch/im-chrome-i18n/PRD.md:15` 的 Discord 外壳清单还列着 `已完成 N 步` 与 `已 N 分钟 · 仍在运行`，做本地化前要改；`.scratch/discord-ux/PRD.md:41`、`:56` 与 `.scratch/telegram-ux/PRD.md:82` 是历史 PRD，看要不要补一句。
- 小边角：某步既没有 `<summary>`、也没有可见正文和工具调用可回退时，那一行只剩步号（如 `11`）。以前上面有「已完成 11 步」垫着，现在就是一个孤零零的数字。回退链保证这很少见，这次没为它加分支。
- 真机要验：Telegram、Discord 各跑一个多步任务，状态消息只有 `NN 摘要` 和 `·· 思考中` 两行；单步满 60 秒后第二行是 `·· 思考中 · 已 1 分钟`，之后每分钟变一次，步落定归零；提问与回显里的「已完成 N 步」、回答折叠头、停止定格都照旧。
