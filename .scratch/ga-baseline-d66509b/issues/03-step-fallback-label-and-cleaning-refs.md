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
