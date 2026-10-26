# GA 上游升级 b70079d -> a9a36b4

**日期**：2026-10-26
**上下文**：v0.7.1 发版前的例行审计（Upgrade Triggers 第一条）。v0.7.0 带的是 10-22 审计的 `b70079d`，
之后上游只走了两个提交，最后一个是 10-23 早上的 `a9a36b4`（`git ls-remote` 取得，ahead 2、behind 0）。随 v0.7.1 发出。

## 范围形状

`b70079d..a9a36b4` 共 2 个提交、1 个文件：`ga.py` +4 / −2，都是工具处理函数里的 bug 修复。
`agent_loop.py`、`agentmain.py`、`llmcore.py`、`pyproject.toml` 零 diff，`GA_DEPS` 不用动；没有前端、`memory/` 种子、打包改动。

补丁触及 `ga.py` 的是 `0001`、`0003`、`0006`。上游两处都是一行换两行，后面的零上下文 hunk 会整体下移：
`0001` 的 `load_L1`、`get_global_memory` 两个 hunk 和 `0003` 的 `get_global_memory` 一个 hunk 各下移两行；
`0006` 改的都在第 200 行以前，不动。

结论：两种模式都没有断点，Galley 代码一行不改，补丁只改行号。

## `web_execute_js`：非字符串脚本不再打断运行（`545017c`）

`do_web_execute_js` 原来直接对 `script` 调 `.strip()`。模型把 `script` 写成对象、数组或数字时抛 `AttributeError`，agent 循环中断，
这一轮直接结束。上游改成：对象、数组用 `json.dumps` 转成文本，其他非字符串走 `str()`；只有空白的脚本返回「Script missing」。

用打包 Python 对新旧两份 payload 各跑一遍（浏览器调用换成桩，不花额度）：

| `script` 参数 | 旧 payload | 新 payload |
|---|---|---|
| `"return 1"` | 执行 | 执行 |
| `{"code": "return 1"}` | `AttributeError` | 按文本执行 `{"code": "return 1"}` |
| `["return 1"]` | `AttributeError` | 按文本执行 `["return 1"]` |
| `42` | `AttributeError` | 按文本执行 `42` |
| `"   "` | 当空脚本执行 | 「Script missing」 |

转成文本的对象不是能用的页面脚本，模型拿到的是一条 JS 报错，可以重试，运行不会中断。

Galley 没有耦合：`0006` 补的是模块级的 `web_execute_js`（驱动恢复），不是这个 `do_` 方法；runner 不认这些字符串，
GUI 只在助理脸的工具分类里按工具名认 `web_execute_js`（`gui/src/lib/assistant-face.ts`），名字没变。浏览器控制是头号能力，这条直接受益。

## DSML 重试：未闭合的标记也接住（`a9a36b4`）

`do_no_tool` 的判定从「末 50 字含 `</｜DSML｜`、以 `>` 结尾」放宽为「末 50 字同时含 `DSML` 和 `｜`、以 `>` 结尾」。
上一次升级只认闭合标签，这次补上 DeepSeek 漏出开标签就停下的情况。同样用打包 Python 跑新旧两份：

| 最终回复结尾 | 旧 payload | 新 payload |
|---|---|---|
| `</｜DSML｜function_calls>` | 重试 | 重试 |
| `<｜DSML｜invoke name="web_scan">` | 当成答案 | 重试 |
| `<｜DSML｜parameter name="code" string="true">` | 当成答案 | 重试 |
| 内置回复以 `</next-suggestion>` 结尾 | 当成答案 | 当成答案 |
| 普通回答以 `>` 结尾（`见 <https://…>`） | 当成答案 | 当成答案 |
| 回答里有全角 `｜` 但没有 `DSML` | 当成答案 | 当成答案 |
| 普通回答 | 当成答案 | 当成答案 |

没有新的误判。上一次记的老缺口（漏出的标签后面跟一段长 `<next-suggestion>`，被挤出 50 字窗口）照旧。
Galley 没有耦合：`WorkbenchHandler` 只把 `no_tool` 经 `dispatch` 转给上游。内置 DeepSeek 预设受益。

## 补丁栈重放

审计时就预测到三个 hunk 会下移两行。`build-managed-ga.sh` 用的是 `git apply --unidiff-zero --recount`，
带 `-` 行的 hunk 能靠偏移找到位置，但每次构建都靠偏移是潜在的错位风险，所以按 SOP 走 `rebase-managed-ga-patches.sh`，不手改：

1. 在 `b70079d` 上把当前补丁栈重放成提交链，逐字节比对已入库的 payload（脚本的硬门禁），通过。
2. `rebase --onto` 到 `a9a36b4`，没有冲突，重新导出。只有 `0001` 和 `0003` 变了，变的只是三个 hunk 头的行号
   （`-577` → `-579`、`-587` → `-589`、`-590` → `-592`），补丁体一行不动。
3. 更新 `managed-ga/manifest.json` 的 `upstream` 块，`build-managed-ga.sh <a9a36b4 干净克隆>`：27 个补丁全部应用，
   `py_compile` 全量扫描通过，`check-managed-ga-payload.mjs` 通过。
4. 重建后的 payload 相对上一份的 diff，与上游 `b70079d..a9a36b4` 的 diff 逐行相同（`ga.py`，6 行）。

`deferred.md` 里挂在基线升级上的启动信号都没触发：`0023`、`0024`、`0026`、`0008` 没有冲突，`llmcore.py` 零 diff。

## 验证

- runner（`.venv`）：`GA_PATH=managed-ga/code pytest` 628 passed（6 deselected）；兼容矩阵 `GA_PATH=<a9a36b4 干净克隆> pytest runner/tests -m 'not e2e'` 628 passed；
  对照 `GA_PATH=<上一份 payload>` 也是 628 passed（比 10-22 的 640 少，是 10-23 删桌面宠物时一起删的测试）。`mypy runner`、`ruff check runner` 通过。
- 打包门禁：`pyproject.toml` 零 diff；`bundle-python.sh mac-x64` 新建 bundle，`check-bundled-python-managed-ga.sh`：`managed GA import OK`。
- `check-ga-baseline-drift.mjs --write` 之后通过（`gui/src/lib/ga-baseline.gen.ts` 随之更新）。
- 打包 Python 探针（`python -B`，不花额度）：上面两张表。
- 没有 Rust 改动，cargo 没跑：Core 用 `include_str!` 嵌入 `managed-ga/manifest.json`，这次只改了 `upstream` 块的值。

## SOP 第 8 步：待在 tauri dev 里走

本次没跑。两处都是引擎在异常输入下的兜底，正常路径不变；要在 dev 里看，重点是：

1. 内置，桌面：做一个用浏览器的多步任务，执行 JS 的步骤正常出结果。
2. 内置，桌面：用 DeepSeek 预设做一个多步任务，最终回答里没有 `｜DSML｜` 原文。

## 起源纪律

两个提交都出自 Liang Jiaqing：`545017c`（10-22，`web_execute_js` 参数归一化）、`a9a36b4`（10-23，DSML 判定放宽）。
本次没有「上游吸收了 Galley 能力」这类说法，补丁一个不删。
