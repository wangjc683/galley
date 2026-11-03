# 02 基线收尾：`Bash` / `PowerShell` 在界面里当 `code_run` 画；过期行号；门禁要求 `legacy_llmcore.py`

Status: needs-dogfood（2026-11-03 快进合入 `524fe7f9` 的 rebase 版。主会话验收：读过 `gui/src/lib/tool-name.ts` 与调用处，分支相对 main `diff --check` 干净、新增行没有本机路径；代理报 typecheck、lint、vitest 本机与 `TZ=UTC` 各 2,780 条全过，两个检查脚本在缺 `legacy_llmcore.py` 时报错。真机要等模型真的调一次 `Bash`（Kimi 预设开着 Claude Code 兼容时更容易），只改 GUI，热更即可）

来源：票 01（基线 `a9a36b4 → d66509b`）报告的 Open risks 第 1、4、9 条；2026-11-03 JC：「按你的建议推进」。只改 GUI、两个检查脚本与几处注释和文档；不动 Core、runner、CLI、Agent API、迁移、内置 GA 补丁栈。两种运行时都受益（外置用户更新到上游新版后同样会遇到 `Bash`）。

## 为什么

上游 `5ec4b12` 让 `agent_loop.py` 把模型调用的 `Bash` / `PowerShell` 转去执行 `code_run`（`managed-ga/code/agent_loop.py:19`），但记录里的工具名仍是 `Bash`、参数原样，runner 原样上报。界面于是把它画成没有图标、没有中文名的药丸（`gui/src/components/conversation/ToolCallout.tsx:466`、`:773-774`），助理的脸判成「思考」（`gui/src/lib/assistant-face.ts:118-121`），用 `Bash` 跑 `galley todo add` 也亮不了「记一笔」。开着 Claude Code 兼容（Kimi 预设）时更容易出现。

## 要做到

### 1. 界面：两个名字当 `code_run` 的别名

- 凡是按工具名查表或分支的地方，`Bash`、`PowerShell` 都按 `code_run` 处理：`TOOL_META`、`copy.tools`（中英两份 locale）、工具调用的预览分支（参数里的命令在 `command` 键，`code_run` 在 `script` 键，预览要读得出命令）、`assistant-face.ts` 的 `classifyTool`，以及 grep 出来的其他按名字分支的地方（`grep -rn "code_run" gui/src`）。
- 用一个集中的别名映射（比如一个小函数把工具名归一），别在每处各写一遍。不要改 runner 或库里的工具名。
- 加 vitest：`Bash` / `PowerShell` 的调用画成 `code_run` 的样子（图标、中文名、命令预览）；助理的脸按 `code_run` 判；用 `Bash` 跑 `galley todo add` 也算「记一笔」（照现有判定的测试写法）。

### 2. 过期行号（只在注释和文档里，代码不读）

把下面这些引用改成现在的行号（先打开文件核对，以实际为准）：
- `agent_loop.py:78` / `:79` → `:79` / `:80`：`gui/src/lib/assistant-face.ts:124`、`:130`，`gui/src/lib/assistant-face.test.ts:16`，`docs/ipc-protocol.md:195`。
- `ga.py:599` → `:601`：`gui/src/components/conversation/Conversation.tsx:1325`、`gui/src/i18n/locales/zh.ts:1740`、`gui/src/lib/step-heading.ts:51`。
- `docs/project-status.md` 里的 `ga.py:538` → `:542`（若票 01 已改过，跳过）。

### 3. 门禁要求 `legacy_llmcore.py`

`scripts/check-managed-ga-payload.mjs`（以及 `check-managed-ga-app-bundle.mjs`，若它也列必需文件）把 `legacy_llmcore.py` 加进必须存在的文件：`llmcore.py` 末尾会 import 它，缺了只有打包冒烟能抓到。跑一遍确认现在的 payload 过；临时挪走这个文件确认会报错，再挪回来。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run           # 全量；另用 TZ=UTC 跑一遍
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

长命令前台跑，别放后台等。中文文字用全角标点，提交前自己写个正则扫一遍新增行，脚本放 scratchpad，用 `gab02-` 前缀命名。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。另外两个代理同时在做票 134（`core/src/managed_prompt.rs`、`core/src/subtask_report.rs`、手册、`.scratch/main-chat/entry-layer-eval/`）和票 135（Core 的 `runner_commands.rs`、`runner/handlers.py`、runner 测试、`docs/managed-ga-runtime/`）。不要碰那些文件；`docs/ipc-protocol.md` 只改那一处行号。
  ```bash
  cd <主树>
  git worktree add -b gab02-bash-alias <scratchpad>/wt-gab02 main
  cp -cR gui/node_modules <wt>/gui/          # APFS 克隆，免装依赖
  ```
- GUI 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化自己改的那几段，不要整文件跑 prettier。React 编译器的 lint 规则：effect 里同步 setState、渲染期 `Date.now` 都是 error；工具函数别从组件文件导出。
- 用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`。提交说明末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：改了哪些文件、别名放在哪、新加的测试、验证命令逐条结果、看到但没改的（Open risks）。

## 报告

2026-11-03，执行代理，worktree 分支 `gab02-bash-alias`（从 `c14e8591` 起）。只动 GUI、两个检查脚本和几处注释与文档；Core、runner、CLI、Agent API、迁移、补丁栈一行没动，票 134、135 的文件没碰。

### 1. 别名

- 集中在新文件 `gui/src/lib/tool-name.ts`：`canonicalToolName(name)`，`Bash`、`PowerShell` 归成 `code_run`，别的名字原样返回（大小写照上游精确匹配，`bash` 不算）。runner 与库里的工具名不改。
- 用它的地方（`grep -rn "code_run\|tool.name\|toolName" gui/src` 逐处过了一遍）：
  - `ToolCallout.tsx` 的 `InlineToolPill`：`TOOL_META` 查图标、`copy.tools` 查中文名（中英两份 locale 都走这一次查表，所以 locale 不用加键）、`previewArgs` 的分支。`code_run` 预览原来就读 `script` 再读 `command`，这次补上 `cmd`，与上游 `agent_loop.py:19` 取命令的三个键一致。展开后的等宽名字、失败与运行中的块状卡片仍写模型用的原名 `Bash`，便于核对。
  - `assistant-face.ts` 的 `classifyTool`：先归一再判，`Bash` 写 `galley todo add` 算「记一笔」，其他命令算「干活」。
  - `run-groups.ts` 的工具计数：按归一后的名字计，折叠头（`RunFoldHeader`）不会出现两个「运行代码」。
- 没改的按名字分支：`browser-site.ts`、`assistant-process.ts` 的浏览器与文件工具集合与这两个名字无关；「调用了 X」（`step-heading.ts`、`stepCalledTools`）写的是原样的工具名，`code_run` 本来也写原名，保持一致没改。

### 2. 过期行号

- `agent_loop.py:78` / `:79` → `:79` / `:80`：`assistant-face.ts` 两处、`assistant-face.test.ts` 一处、`docs/ipc-protocol.md` 第 195 行。
- 同一行里 `assistant-face.ts:148` / `:114` 因这次加了 import 和归一行，改成 `:151` / `:116`；`docs/design/foundations.md` 第 665 行的 `assistant-face.ts:209` 同理改成 `:212`。`docs/ipc-protocol.md` 只改了第 195 行。
- `ga.py:599`：票面说改成 `:601`，打开核对后不对。现在的 `ga.py:601` 是 `def load_L1()`；这三处注释说的「两种兜底」（不调工具写「直接回答了用户问题」，调了工具写工具名）在基线 `f06d550` 的审计提交 `a95bdd57` 里已被上游删掉，旧代码在当时的 `ga.py:599`。现在的 `turn_end_callback` 只剩一种兜底：没有 `<summary>` 就拿整段回答（`ga.py:578`）。所以三处（`Conversation.tsx`、`zh.ts`、`step-heading.ts`）改写成「沿用 `f06d550` 以前 GA 的两种兜底；现在只剩整段回答，`ga.py:578`」，不写一个指向别处的行号。
- `docs/project-status.md`：票 01 只加了注，`ga.py:538` 还在（那是 `v0.7.0` 的行号，`v0.7.1` 起是 `:540`）。直接换成 `:542` 会变成「`:542` 用相对路径打开」，与事实相反；改成「旧版 `ga.py` 按渠道工作目录的相对路径打开 L0……主线上 `0001` 在 `ga.py:542` 从状态根读」。

### 3. 门禁

`scripts/check-managed-ga-payload.mjs` 与 `scripts/check-managed-ga-app-bundle.mjs` 在 `llmcore.py` 后面都加了 `legacy_llmcore.py` 必须存在（附一行注释：`llmcore.py` 末尾的 `try: import legacy_llmcore` 只接 `AttributeError`，缺文件就是 `ModuleNotFoundError`）。

- payload 检查：现状 OK；挪走 `legacy_llmcore.py` 后报 `missing file: managed-ga/code/legacy_llmcore.py`、退出码 1；挪回后 OK。
- app 包检查：没有现成的 `.app`，在 scratchpad 造了只有 `Contents/Resources/managed-ga`（APFS 克隆）的假包：有这个文件时输出里没有它，删掉后报 `missing file: …/managed-ga/code/legacy_llmcore.py`；假包已删。真包没跑。

### 4. 新测试

- `gui/src/lib/tool-name.test.ts`（新）：两个名字归成 `code_run`；其他名字（含小写 `bash`、`powershell`）原样。
- `gui/src/components/conversation/ToolCallout.test.tsx`（新）：静态渲染，`Bash` / `PowerShell` 带 `command`（以及 `Bash` 带 `cmd`）的药丸与 `code_run` 带 `script` 的逐字节相同；`code_run` 那个有图标、「运行代码」、跳过注释后的第一行命令；不认识的 `bash` 仍是只有名字的药丸。
- `gui/src/lib/assistant-face.test.ts`：`Bash` / `PowerShell` 写 `galley todo add` 判「记一笔」（`note`），`todo list` 与普通命令判「干活」；从派发行读出的 `Bash` 同样。
- `gui/src/lib/run-groups.test.ts`：`code_run`、`Bash`、`PowerShell` 合计成一条 `code_run ×3`。
- 反证：把 `canonicalToolName` 临时改成原样返回，上面新加的 5 条全部失败，改回后通过。

### 5. 验证

| 命令 | 结果 |
|---|---|
| `pnpm --dir gui typecheck` | 退出码 0 |
| `pnpm --dir gui lint` | 退出码 0 |
| `pnpm --dir gui exec vitest run` | 250 个文件，2780 条通过 |
| `TZ=UTC pnpm --dir gui exec vitest run` | 250 个文件，2780 条通过 |
| `node scripts/check-managed-ga-payload.mjs` | OK；挪走 `legacy_llmcore.py` 时报缺、退出码 1 |
| `node scripts/check-ga-baseline-drift.mjs` | OK（`d66509bf`） |
| `node scripts/check-docs-links.mjs` | OK，493 个文件 |
| `git diff --check` | 干净 |
| 全角标点扫描（scratchpad 的 `gab02-cjk-punct.py`，扫新增行） | 只命中 `step-heading.ts` 英文注释里 `tools, 「调用了 X」` 的英文逗号，原文就是这样，不算 |

prettier：新文件整篇格式化；旧文件只核了自己的 hunk（`assistant-face.test.ts` 一处按 prettier 手改），其余文件 prettier 报的都是原有的行。

### 6. 改了的文件

- 新：`gui/src/lib/tool-name.ts`、`gui/src/lib/tool-name.test.ts`、`gui/src/components/conversation/ToolCallout.test.tsx`。
- GUI：`gui/src/components/conversation/ToolCallout.tsx`、`gui/src/lib/assistant-face.ts`、`gui/src/lib/assistant-face.test.ts`、`gui/src/lib/run-groups.ts`、`gui/src/lib/run-groups.test.ts`；只改注释的 `gui/src/components/conversation/Conversation.tsx`、`gui/src/lib/step-heading.ts`、`gui/src/i18n/locales/zh.ts`。
- 脚本：`scripts/check-managed-ga-payload.mjs`、`scripts/check-managed-ga-app-bundle.mjs`。
- 文档：`docs/ipc-protocol.md`（第 195 行）、`docs/design/foundations.md`（第 665 行）、`docs/project-status.md`（一句）、本票报告。

### 7. 看到但没改的（Open risks）

1. 「调用了 X」兜底写原名：模型漏写 `<summary>` 且旁白清洗后为空时，`Bash` 的步骤写「调用了 Bash」，`code_run` 写「调用了 code_run」，两者都是原名，没归一。要显示成中文名得另开一票，两种名字一起改。
2. `gui/src/lib/ipc/ga-output-cleaning.ts` 的 `agent_loop.py:72` / `:73` / `:79-81` 和 `ga.py:594-601`（还有 `ga-output-cleaning.test.ts:16`）早就不准，票面没列，没改；`ga.py:594-601` 说的也是 `f06d550` 以前的兜底，改时要像本票第 2 节那样改写，不是换个数字。
3. 没在真机看：GUI 改动只有静态渲染与单测；要实地看，得让模型真调一次 `Bash`（开着 Kimi 预设的 Claude Code 兼容更容易出现）。这是 GUI 改动，合入后 HMR 即可，不用重启 Core。
4. 运行中、失败、被拒的块状卡片标题仍写 `Bash`（与所有工具一样，块状卡片只写等宽原名，没有图标和中文名），这是现有设计，不是别名问题。
5. app 包检查只在假包上验过，真 `.app` 没跑；这个文件随 `managed-ga/` 整目录打包，按理会在。
6. 合并：`docs/project-status.md` 与 `docs/ipc-protocol.md` 票 134 / 135 的分支也可能改，只要不是同一行就不冲突；`assistant-face.ts` 的行号若别的分支也加了行，第 195 行与 `foundations.md` 的行号会再偏。
7. worktree 里留着被 gitignore 的 `gui/node_modules`（主树 APFS 克隆）；scratchpad 里有 `gab02-cjk-punct.py`、`gab02-vitest-local.log`、`gab02-vitest-utc.log`。
