# 114 主对话里没有回答的一轮收成一行「中途停下 · N 步」，点开是过程卡片

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 159。只改 GUI，不动 Core、CLI、Agent API、迁移。只改主对话（`MainView` 的 `isMainChat`）；工作台会话、从助手点开的子任务、外置运行时零变化。

## 现在是什么样

- 10-30 JC 在主对话里问 Tailscale 的事，它跑到第 4 步时 JC 按了停止。三点气泡淡出后，四步按工作台的样子整段铺开：序号 01–04、竖线、「运行代码」工具行，第 02 步还有一张红色「失败」的 `code_run` 卡片。这块收不起来，也没有消息菜单，删不掉（票 32）。库里就是这一轮：主对话第 282–285 轮，282 是你的消息，283–285 是三步，最后一步没有回答，`telemetry_json` 为空。
- 原因：`gui/src/lib/assistant-conversation.ts` 的 `assistantLinePlan`（`:348` 起）只给四种轮次走 IM 画法：在跑的（`liveGroup`）、有回答的（`g.foldable`）、静默的叫醒（`isSilentReport`）、删过开场的回复（`orphanReply`）。其余都落进 `plan.flat`（`:394`），Conversation 按工作台的步骤区画。中止、出错、停在步数上限的轮次没有收口那一步（`run-groups` 的 `complete` 为假），都落在这里。

## 要做到

1. **画法**：在主对话里，一轮同时满足这几条时，不再进 `plan.flat`：不在跑（不是 `liveGroup`）、没有回答（`!complete`）、轮形可折（`foldEligible`：有开场、没有系统轮次，`/btw` 因此照旧平铺）、不是静默的叫醒、至少有一步落定的 agent 轮次。改成：
   - 它那一边、本该是回复气泡的位置画**一行**：`中途停下 · 4 步`（英文 `Stopped partway · 4 steps`，单数 `1 step`）。步数照过程卡片第一行的算法（`RunStats.stepCount`，提问那一步也算），数字的写法复用 `conversation.foldSteps`。墨色与字号照 `AssistantRunSummary` 那一行：字 `ink-muted`、数字 `ink-soft`，`--conversation-step-size`。行首是过程按钮的 `Footprints` 图标（`MessageActions.tsx:235`）。这一整行就是开关：点一下在下面原地展开过程卡片，再点收起；悬停提示复用 `foldExpand` / `foldCollapse`（「展开过程 / 收起过程」）；有悬停底与键盘焦点，`aria-expanded`。左对齐，与回复气泡同一条左边线，不加气泡底。
   - 卡片就是有回答的轮次用的那张 `AssistantProcessCard`（`ProcessCard`，每步一行，点一行看那一步的工具与细节，8 行上限内滚）。区别只有：没有回答可扣，所有 agent 步都进卡片（只做了提问的那一步照旧不进，`assistantProcessSteps` 的规则）；第一行只有步数（这类轮次没有 telemetry，`AssistantRunSummary` 本来就会退成只写步数，核对一下）。开合状态用现有的 `foldOverrides`，按开场的 ordinal 记，默认收着。
   - 它中途问过的问题与你的回答照旧画在外面当消息（左右气泡），顺序同有回答的轮次：提问、回答都在这一行之前。
   - 一行与上下的间距按 `assistantRowGap` 的规则走：这一行算「它那一边」的一行，但它下面没有行动条的 30px，自己决定下边距并写进报告（目标：与下一条你的气泡之间读起来同「它的回复 → 你」）。卡片展开时照 `AssistantProcessCard` 已有的 6px / 20px。
2. **叫醒的一轮**：Core 叫醒、没有回答、又不是静默的一轮（今天它会冒出一段没有开场的平铺步骤），同样画成这一行；叫醒行本身照旧不画，`plan.reports` 指向这一行，叫醒的时间在断点时画在它上面（`firstDrawn` 要认这一行）。
3. **按停止的那一下**：三点气泡照现在在原位淡出（票 94 / 裁决 138 的 `useTypingBubbleHandoff`），这一行出现在同一位置，不能先闪一帧平铺的步骤或别的东西。这一行要不要淡入，照「出现与离开」的现有做法定（只放在眼前发生的那一次，切会话、重载、冷启动恢复都不放），写进报告。
4. **不变的**：
   - 一步都没落定就停下的：照现在什么都不画。
   - 停在步数上限时，末尾的 `StepLimitTail`（「已达步数上限 · 回复「继续」接着跑」）、输入框灰字「继续」照旧；出错照旧弹 toast（`ipc-handlers.ts` 的 `error` 分支）。
   - 侧栏助理卡片与顶栏的「最后一句」：这一行不是气泡，不算最后一句（`lastVisibleMessage`），卡片照旧停在「你：……」。核对后写进报告。
   - 贴底滚动：`assistantReplyStart` 会把这一行当成回复开头，核对行为合理。
   - 消息菜单：这一行不带菜单、不能删（裁决 159 第 6 条）；它前面你那一句照旧能删。查一下票 32 的删除路径：删掉一条回复后，那一轮会不会变成「没有回答」而改画成这一行；会的话写清楚现在与改后各画什么，是不是想要的，交回主会话判断，不自行扩范围。
   - 工作台会话、子任务（`isMainChat` 为假）：没有回答的运行照旧整段平铺，逐像素不变。
5. **文档**：`docs/design/conversation.md` 里「助手的对话」一节写主对话的「没有回答的运行」那几处（`:128`、`:207`，以及 `:315` 提问一节「没有回答的运行」那一条的助手部分）改成新规则，引裁决 159；工作台那几处（`:23`、`:36`）照旧，只把「助手的对话本来就不画」一类的说法核对一遍。`gui/src/lib/assistant-conversation.ts` 头部注释（`flat` 那一条、文件顶上 `process` 段落的「a run without an answer unfolds in full」）同步。

## 测试

- `gui/src/lib/assistant-conversation.test.ts`：计划层，先写红：中止的一轮（3 步、无回答、不在跑）不进 `flat`、进新的入口；带提问的中止轮，提问与回答进 `message`；叫醒、无回答、非静默的一轮进新入口且 `reports` 指向它；0 步的不画；`/btw` 的、带系统轮次的照旧 `flat`；在跑的照旧什么都不画。
- `gui/src/components/conversation/Conversation.assistant.test.tsx`：有这一行、字是「中途停下 · 3 步」、没有序号与竖线与工具行；展开后是过程卡片、每步一行（静态渲染点不了，照文件里已有的 `vi.mock` ExpandSection 全展开的做法）；工作台画法（不开 `assistant`）下同一组轮次照旧平铺。
- 门禁：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui exec vitest run` 本机与 `TZ=UTC` 各一遍、`git diff --check`。中文文案与文档用全角标点。

## 约束

- 只改 `gui/` 与 `docs/design/conversation.md`。gui 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；工具函数别从组件文件导出。
- 静态渲染测试（`renderToStaticMarkup`）读不到 zustand 里塞的值，store 行为用 store 层测试测。
- 新文案进 `gui/src/i18n/locales/zh.ts` 与 `en.ts` 的 `conversation` 下，键名自定，写进报告。
- 不 commit 到 main；在本 worktree 的分支上提交，提交只点名文件（禁用 `git add -A` / `git commit -a`），提交信息末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 票面、提交、报告里别写本机绝对路径和 worktree 路径。

## 给 JC 的真机步骤（主会话先在 dev 里走）

1. 合入后打开主对话，往上翻到 10-30 15:59 Tailscale 那一轮：四步收成一行「中途停下 · 4 步」，点开是卡片、每步一行，点第 2 步能看到那次失败的 `code_run`；再点收起。⌘R 重载后照旧。
2. 在主对话里让它做一件要好几步的事（例如「看看我下载文件夹里最大的五个文件」），跑出两三步后按停止：三点淡出，原位出现这一行，没有一闪而过的平铺步骤。

## Comments
