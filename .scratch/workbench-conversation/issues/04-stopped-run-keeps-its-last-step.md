# 04 停下的运行折进头里，最后一步留在外面

Status: ready-for-agent（等主聊天票 114 合入 main 后开工，由做 114 的代理接着做，先 rebase 到新 main）

来源：[工作台对话 PRD](../PRD.md) 裁决 9（2026-10-30，JC：「按你的推荐推进」）。只改 GUI 与 `docs/design/conversation.md`，不动 Core、CLI、Agent API、迁移。改的是工作台的画法（`MainView` 的 `isMainChat` 为假：工作台会话、从助手点开的子任务），内置与外置运行时一起变；主对话（票 114 的那一行）不动。

## 现在是什么样

- 在跑时：live 窗口。`RunFoldHeader` 的 `live` 头「已完成 N 步」（`stats.stepCount`），点开是一行一步的卡片；头下面是最近完成的那一步（步骤区的阅读形态：序号、竖线、旁白、工具行），再下面是在跑那一行。规则在 `gui/src/lib/run-fold-plan.ts`（头注释的 `live`、`settling`、`flat`，`heads` / `windowOwner` / `regionOwner`）。
- 按停止后：这一轮没有回答，不在跑，落进 `flat`，整段平铺，头后面收着的步骤一下全部铺开。落定的收合只给有回答的运行（`gui/src/components/conversation/Conversation.tsx:412` 的 `watched?.complete`）。
- 历史里同样：库里的例子是会话「Goal · 收集和整理汕尾旅游的相关信息」（idle，内置）里那一轮 18 步、下一句是「继续」。

## 要做到

1. **画法**：工作台里，一轮同时满足这几条时不再进 `flat`：不在跑、没有回答（`!complete`）、轮形可折（`foldEligible`：有开场、没有系统轮次，`/btw` 因此照旧平铺）、至少落定了两步 agent 轮次。改成：
   - 折叠头，字是「中途停下 · N 步」（N 是整轮的 `stats.stepCount`，同 live 头，停下那一下数字不变；英文 `Stopped partway · N steps`，与票 114 用同一个文案键，114 已经加了就复用），后面照旧是工具气味段；没有用时（没有回答的运行没有 telemetry）。默认收着，点开是一行一步的卡片（`RunFoldSection` / `ProcessCard`，同有回答的运行），卡片里是除最后一步以外的步骤（只做了提问的那一步照旧不进）。
   - 头下面是这一轮的最后一个 agent 步，照 live 窗口里那一步的阅读形态画（序号、竖线、旁白、工具行、单步细节），和在跑时一模一样。
   - 中途提问与你的回答在头前面，顺序同有回答的运行（裁决 6）。
   - 只落定了一步就停下的：只画那一步（阅读形态），不画头，同「一步就答完的只有回复」（裁决 7）。一步都没落定的：照旧什么都不画。
2. **按停止的那一下**：只拿走在跑那一行；头的字换掉、数字不变；头、卡片（开着就保持开着，`foldOverrides` 同一个 key，不重挂载）、最后那一步都不动、不重挂载、不闪。在跑那一行怎么离开，照现有的收合做法（`ExpandSection` / `SettleGap` 一类）定，写进报告。
3. **不变的**：
   - 有回答的运行、一步就答完的、在跑的 live 窗口：逐像素不变。
   - 停在步数上限时，末尾的 `StepLimitTail` 与输入框灰字「继续」照旧；出错照旧弹 toast。
   - 主对话（`isMainChat`）里的画法是票 114 的，不动。
   - 侧栏「已中止 · 摘要」「已暂停 · 摘要」照旧。
   - 分组、步数、问题轨的 replySet、`askUserReplyContent`、侧栏「第 N 步」都是 run-groups 的，不变。
4. **文档**：`docs/design/conversation.md` 工作台那几处写「没有回答的运行……整段平铺」的（开头示意图下面那句、「一步就答完的运行只有回复」一段末尾、提问一节「没有回答的运行」那一条的工作台部分）改成新规则，引工作台对话 PRD 裁决 9；示意图要不要补一个「停下的运行」的小图，自己定。`gui/src/lib/run-fold-plan.ts` 头注释加上这一种（建议叫 `stopped`），`flat` 那一条删掉「stopped, failed, at the step cap」。

## 测试

- `run-fold-plan` 的单元测试，先写红：停下的 4 步运行有头、卡片行是前 3 步里的非提问步、最后一步在外面；带提问的停下运行，提问与回答在头前面；只落定一步的只有那一步、没有头；`/btw` 的、带系统轮次的照旧 `flat`；在跑的照旧 live 窗口。
- `Conversation` 的渲染测试：头的字是「中途停下 · 4 步」、没有用时；最后一步有序号与工具行；工作台里有回答的运行照旧（快照或逐项断言不变）；主对话（`assistant`）里同一组轮次照旧是票 114 的那一行。
- 停下那一下：在跑 → 停下的切换不重挂载头与最后一步（例如断言同一个 DOM 节点、或卡片开着时保持开着），能测就测，测不了写进报告。
- 门禁：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui exec vitest run` 本机与 `TZ=UTC` 各一遍、`git diff --check`。中文文案与文档用全角标点。

## 约束

- 只改 `gui/` 与 `docs/design/conversation.md`。gui 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；工具函数别从组件文件导出。
- 静态渲染测试（`renderToStaticMarkup`）读不到 zustand 里塞的值，store 行为用 store 层测试测。
- 在本票分支上提交，提交只点名文件（禁用 `git add -A` / `git commit -a`），提交信息末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不合入 main、不 push。
- 票面、提交、报告里别写本机绝对路径和 worktree 路径。

## 给 JC 的真机步骤（主会话先在 dev 里走）

1. 合入后打开会话「Goal · 收集和整理汕尾旅游的相关信息」：18 步那一轮是一个头「中途停下 · 18 步」加最后一步，下面是你的「继续」；点开头是一行一步的卡片。
2. 打开会话「测试：请分五步完成……」，把第一句再发一遍，跑到第 3 步时按停止：在跑那一行离开，头的字换成「中途停下 · 3 步」，其余不动、不闪。

## Comments
