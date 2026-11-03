# 03 步骤行的兜底写中文名；`ga-output-cleaning` 的过期行号

Status: ready-for-agent

来源：票 02 报告的 Open risks 第 1、2 条；2026-11-03 JC：「按你的建议推进」（并进 v0.7.6 收尾）。只改 GUI（一处文案逻辑、注释与测试）和设计文档；不动 Core、runner、CLI、Agent API。两种运行时都受益。

## 1. 步骤行的兜底：一个工具时写它的名字，不写工具原名

- 现在：模型没写 `<summary>`（或 summary 只是回声）、这一步调了工具时，步骤那一行兜底写「调用了 X」，X 是工具原名（`gui/src/i18n/locales/zh.ts:1749-1750` 的 `stepCalledTools`，英文在 `en.ts:1713` 一带；用在 `gui/src/lib/step-heading.ts:66` 与 `gui/src/lib/assistant-process.ts:152`；设计规则在 `docs/design/conversation.md:204`）。于是会出现「调用了 code_run」「调用了 Bash」。
- 改成：只调了一个工具、且这个工具在 `copy.tools` 里有名字时，那一行就写它的名字（「运行代码」「Run code」），不加「调用了」；工具名先过 `gui/src/lib/tool-name.ts` 的 `canonicalToolName`，所以 `Bash` / `PowerShell` 也写「运行代码」。`copy.tools` 里没有的工具照旧「调用了 X」（原名）。调了几个工具的照旧「调用了 N 个工具」。
- 先读 `docs/design/conversation.md:204` 一带与 `:1015`（旁白回声步）的规则和 `docs/devlog/2026-09-23-step-heading-narration-echo.md`，确认这条改法不和已定的规则打架；打架就停下回报，不要改。
- 同步改 `conversation.md:204` 那句的写法。
- vitest：`code_run`、`Bash` 各一步写「运行代码」；未知工具写「调用了 foo_tool」；两个工具写「调用了 2 个工具」；中英各一遍。
- 报告里列一张前后对照表（中文）：每个有名字的工具在兜底时以前写什么、现在写什么，给 JC 看。

## 2. `ga-output-cleaning` 的过期行号

`gui/src/lib/ipc/ga-output-cleaning.ts`（`:133`、`:158`、`:187`、`:212`、`:358` 引 `agent_loop.py:72` / `:73` / `:79-81` 与 `ga.py` 的各个 `do_*` 行号；`:466` 引 `ga.py:594-601`）和 `ga-output-cleaning.test.ts:16`（同引 `ga.py:594-601`）：
- 对照现在的 `managed-ga/code/agent_loop.py` 与 `managed-ga/code/ga.py` 逐处核对，能对上新行号的改行号。
- `ga.py:594-601` 说的「两路兜底」上游已删（基线 `f06d550` 起，见票 02 报告第 2 节），今天只剩整段回答做兜底（`ga.py:578` 一带，以实际为准）。这两处改写成现状，测试里复现上游兜底的那段若已与上游不符，照现状改测试并在报告里说明。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run           # 全量；另用 TZ=UTC 跑一遍
node scripts/check-docs-links.mjs
git diff --check
```

长命令前台跑，别放后台等。中文文字用全角标点，提交前自己写个正则扫一遍新增行，脚本放 scratchpad，用 `gab03-` 前缀命名。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。另外两个代理同时在做票 134（`core/src/managed_prompt.rs`、`core/src/subtask_report.rs`、手册、`.scratch/main-chat/entry-layer-eval/`）和票 135（`core/src/runner_commands.rs`、`runner/handlers.py`、runner 测试、`docs/managed-ga-runtime/`）。不要碰那些文件。
  ```bash
  cd <主树>
  git worktree add -b gab03-step-fallback <scratchpad>/wt-gab03 main
  cp -cR gui/node_modules <wt>/gui/          # APFS 克隆，免装依赖
  ```
- GUI 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化自己改的那几段。React 编译器的 lint 规则：effect 里同步 setState、渲染期 `Date.now` 都是 error；工具函数别从组件文件导出。
- 用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`。提交说明末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：改了哪些文件、前后对照表、新加的测试、验证命令逐条结果、看到但没改的（Open risks）。

## 报告

2026-11-03，执行代理，worktree 分支 `gab03-step-fallback`（从 `5b6f356b` 起）。只动 GUI 的逻辑、注释与测试和 `docs/design/conversation.md` 一句；Core、runner、CLI、Agent API 一行没动，票 134、135 的文件没碰。

### 0. 先核对已定规则：不打架

- `docs/design/conversation.md:204` 只定了「summary 只是回声时兜底」这个位置和「卡片里一行要有字」，没定兜底用哪组字。
- `:1015`（旁白回声步）与 `docs/devlog/2026-09-23-step-heading-narration-echo.md` 定的是：回声步用旁白当标题，`stepCalledTools` 只在旁白清洗后为空时兜底。这次只改那个兜底的字，触发条件不变。
- 字的来历在 `docs/devlog/2026-08-03-turn-summary-echo-dedup.md`：JC 裁 B（结构一致，步号后要有字），措辞「借用 GA 自己的兜底」（旧 `ga.py:599`，工具名）。那段上游代码在 `f06d550` 已删（票 02 报告第 2 节），措辞没有 JC 单独定过，所以不算推翻裁决。
- 09-23 的 devlog 嫌「调用了 X」只是复述下方工具行；改后在工作台标记行上也一样复述（字更像工具行了），见 Open risks 第 1 条。

### 1. 步骤行的兜底

- `gui/src/lib/step-heading.ts` 新增 `stepToolsLine(names, words)`：只有一个工具时先过 `canonicalToolName`，在 `copy.tools` 里有自己的键（`hasOwnProperty`，`constructor` 一类原型上的名字不算）就写那个名字；否则照旧 `stepCalledTools`（「调用了 X」原名 / 「调用了 N 个工具」）。
- `StepMarkerWords` 从 `copy.conversation` 的两句改成 `{ conversation, tools }`，调用处直接传 `copy`（`Conversation.tsx` 的 `stepMarkerSummary`、`ProcessCard.tsx` 的 `assistantStep`）。`stepMarkerSummary` 与 `assistant-process.ts` 的兜底都改走 `stepToolsLine`。locale 不加键、不改 `stepCalledTools`。
- 两个调用面都受益：工作台的步骤标记行（回声且旁白清洗后为空时），助理的过程卡片（同上，另加 GA 没写 summary 的裸步）。

前后对照（只调了这一个工具、走到兜底时）：

| 工具（模型用的名字） | 以前（中文 / 英文） | 现在（中文 / 英文） |
|---|---|---|
| `web_scan` | 调用了 web_scan / Called web_scan | 读取网页 / Read webpage |
| `web_execute_js` | 调用了 web_execute_js / Called web_execute_js | 执行网页脚本 / Run webpage script |
| `file_read` | 调用了 file_read / Called file_read | 读取文件 / Read file |
| `file_write` | 调用了 file_write / Called file_write | 写入文件 / Write file |
| `file_patch` | 调用了 file_patch / Called file_patch | 修改文件 / Modify file |
| `code_run` | 调用了 code_run / Called code_run | 运行代码 / Run code |
| `Bash` | 调用了 Bash / Called Bash | 运行代码 / Run code |
| `PowerShell` | 调用了 PowerShell / Called PowerShell | 运行代码 / Run code |
| `update_working_checkpoint` | 调用了 update_working_checkpoint / Called update_working_checkpoint | 保存关键上下文 / Save key context |
| `start_long_term_update` | 调用了 start_long_term_update / Called start_long_term_update | 写入长期记忆 / Write long-term memory |
| 不在 `copy.tools` 里的（如 `ask_user`、`foo_tool`、小写 `bash`） | 调用了 X / Called X | 不变 |
| 两个及以上（含同一个工具调两次） | 调用了 N 个工具 / Called N tools | 不变 |
| 没有真工具 | 直接回答了用户问题 | 不变 |

- 设计文档：`docs/design/conversation.md:204` 改写成新规则（一个有名字的工具写名字、没名字写「调用了 X」原名、几个写「调用了 N 个工具」；裸步「也走这条兜底」）。`:1015` 是 09-23 的历史条目，所述触发条件仍对，没改。
- 注释：`step-heading.ts`、`assistant-process.ts`、`Conversation.tsx`、`zh.ts`（`stepCalledTools` 上方）各补一句。

### 2. `ga-output-cleaning` 的过期行号

对照现在的 `managed-ga/code/agent_loop.py` 与 `ga.py`（基线 `d66509b`）逐处核对：

| 位置 | 以前 | 现在 | 指的是 |
|---|---|---|---|
| `ga-output-cleaning.ts:133` | `agent_loop.py:73` | `:80` | 非 verbose 的 `🛠️ name(args)` |
| `:158` | `agent_loop.py:72` | `:79` | verbose 的 `🛠️ Tool: … 📥 args:` |
| `:187` | `agent_loop.py:79-81` | `:85-87` | 五个反引号包工具输出 |
| `:212` | `ga.py:18, :360, :378, :408, etc.`（「每个 `do_*` 的第一行」） | `ga.py:28`（`code_run`）、`:405` / `:423` / `:456`（`do_file_patch` / `do_file_write` / `do_file_read`） | `[Action]` 行；今天只有代码和文件工具写这一行，网页工具不写，所以措辞一并改了 |
| `:358` | `agent_loop.py:73` | `:80` | 同第一行 |
| `:466` | `ga.py:594-601` | `ga.py:575-581`，改写成现状 | 见下 |
| `ga-output-cleaning.test.ts:16` | `ga.py:594-601` | `ga.py:575-581` | 同上 |

- 没动的：`:116` 不带行号；`:227` 的 `sys_prompt.txt:4`、`:474` 与测试 `:28` 的 `ga.py:291`（`smart_format`）核对后仍对。
- `:466` 那段改写：今天的 `turn_end_callback` 没有 `<summary>` 就取整段回答（去代码块与 `<thinking>`、`strip`、去换行、`smart_format` 80），伪代码里 `summary = _c.strip()` 改成与源码同名的 `raw`；补一段：清洗后为空的回答今天不写 summary，`f06d550` 以前会再兜底成「直接回答了用户问题」或第一个工具的名字和参数，上游已删。「asks the LLM for」改成「系统提示要求写一句」（`sys_prompt.txt:4`）。
- 测试里复现兜底的 `gaFallbackSummary` 与今天的 `ga.py:576-580` 一致（去围栏与思考、`strip`、去换行、`smart_format(…, 80)`），只改注释，没改测试代码。唯一差别是 GA 用一条交替正则一次删完，测试分两次删；只在代码块套在 `<thinking>` 里这类输入上不同，现有用例不涉及。

### 3. 新测试

- `gui/src/lib/step-heading.test.ts`：新 `describe("stepToolsLine …")` 四条：`code_run`、`Bash`、`PowerShell` 中英都写「运行代码」/「Run code」；`copy.tools` 中英每个键都写自己的名字；`foo_tool` 中英写「调用了 foo_tool」/「Called foo_tool」，小写 `bash` 与 `constructor` 写「调用了 X」；两个工具（含同一个调两次）写「调用了 2 个工具」/「Called 2 tools」。原有的回声兜底用例改成 `web_scan` →「读取网页」，加 `foo_tool` →「调用了 foo_tool」。
- `gui/src/lib/assistant-process.test.ts`：卡片兜底用例改成 `code_run` →「运行代码」、裸步 `web_scan` →「读取网页」，加 `Bash` →「运行代码」、`foo_tool` →「调用了 foo_tool」、两个工具 →「调用了 2 个工具」。
- `gui/src/components/conversation/Conversation.test.tsx`：新加一条静态渲染，旁白清洗后为空（`**`）时标记行写「读取网页」、不含「调用了」；原有「回声步不出兜底」那条的反面断言从「不含调用了 web_scan」改成「标记行不含读取网页」，否则改后它永远成立。
- 反证：把 `stepToolsLine` 的单工具分支临时关掉，上面新加或改过的 5 条全部失败；改回后通过。

### 4. 验证

| 命令 | 结果 |
|---|---|
| `pnpm --dir gui typecheck` | 退出码 0 |
| `pnpm --dir gui lint` | 退出码 0 |
| `pnpm --dir gui exec vitest run` | 250 个文件，2785 条通过 |
| `TZ=UTC pnpm --dir gui exec vitest run` | 250 个文件，2785 条通过 |
| `node scripts/check-docs-links.mjs` | OK，493 个文件 |
| `git diff --check` | 干净 |
| 全角标点扫描（scratchpad 的 `gab03-cjk-punct.py`，扫新增行） | 只命中 `assistant-process.ts`、`step-heading.ts` 英文注释里括住「调用了 X」「运行代码」的英文括号，英文句子用英文括号，不算 |

prettier：只核了自己改的几段（`step-heading.ts`、两个测试、`ProcessCard.tsx` 按 prettier 收成一行）；`Conversation.tsx`、`zh.ts`、`ga-output-cleaning*.ts` 里 prettier 报的都是原有的行，没碰。

### 5. 改了的文件

- GUI 逻辑：`gui/src/lib/step-heading.ts`、`gui/src/lib/assistant-process.ts`、`gui/src/components/conversation/Conversation.tsx`、`gui/src/components/conversation/ProcessCard.tsx`。
- 只改注释：`gui/src/i18n/locales/zh.ts`、`gui/src/lib/ipc/ga-output-cleaning.ts`、`gui/src/lib/ipc/ga-output-cleaning.test.ts`。
- 测试：`gui/src/lib/step-heading.test.ts`、`gui/src/lib/assistant-process.test.ts`、`gui/src/components/conversation/Conversation.test.tsx`。
- 文档：`docs/design/conversation.md`（第 204 行）、本票报告。

### 6. 看到但没改的（Open risks）

1. 工作台标记行走到兜底时（回声且旁白清洗后为空，很少见），标记行「运行代码」正上方压着工具行「运行代码 · …」，一字不差地复述。以前是「调用了 code_run」压着等宽名 `code_run`，也是复述，只是不同字。09-23 devlog 嫌的正是复述；要不要在工作台改成别的（比如只留序号），是另一个设计问题，没动。
2. 过程卡片里这条兜底今天可能比以前常见：上游 `f06d550` 起，清洗后为空的回答（只调工具、一个字没写）不再有 summary，成了裸步，卡片一律走兜底。所以卡片里会更常看到「运行代码」「读取网页」这类行；后面跟着的对象（域名、文件名）不变。没在真机看过。
3. 与此相关的过期说法没改：`gui/src/i18n/locales/zh.ts` 的 `stepCalledTools` 注释与 `Conversation.tsx` 那段注释都说「GA 从不产出空 summary（686/686），所以裸步号是 Galley 自己造出来的形态」，这是 `f06d550` 以前的事实；今天清洗后为空的回答就没有 summary（`ga.py:579` 的 `if raw:`）。票面没列，属于另一处口径，留给后续。
4. `ga-output-cleaning.ts:116` 的 `LLM_RUNNING_MARKER` 只认 `LLM Running (Turn N) ...`；今天 `agent_loop.py:53` 在 `handler.parent.task_dir` 有值时写 `Turn N ...`，这个形状不会被剥。Galley 的会话是否会设 `task_dir` 没核；票面范围外，没改。
5. 没在真机看，只有单测和静态渲染。这是 GUI 改动，合入后 HMR 即可，不用重启 Core。
6. worktree 里留着被 gitignore 的 `gui/node_modules`（主树 APFS 克隆）；scratchpad 里有 `gab03-cjk-punct.py`、`gab03-vitest-local.log`、`gab03-vitest-utc.log`、`gab03-prettier/`。
