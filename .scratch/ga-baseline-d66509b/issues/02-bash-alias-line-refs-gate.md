# 02 基线收尾：`Bash` / `PowerShell` 在界面里当 `code_run` 画；过期行号；门禁要求 `legacy_llmcore.py`

Status: ready-for-agent

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
