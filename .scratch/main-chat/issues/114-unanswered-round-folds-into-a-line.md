# 114 主对话里没有回答的一轮收成一行「中途停下 · N 步」，点开是过程卡片

Status: done（2026-10-30。真机：JC 把 dev 窗口切到台前后，主会话用真实鼠标走了步骤 1：Tailscale 那一轮收成「中途停下 · 4 步」，上下离你的气泡各约 30px，点开四步一行一步，点第 2 步展开那次失败的 `code_run`，卡片内滚与渐隐正常；JC 走了步骤 2：「真机试了，中途停下正常，没有闪出铺开的步骤」，库里是 09:26「厦门这个周末天气怎么样」那一轮，4 步、每步都调了工具、没有回答。真机看到一处重复：这一行点开后，卡片第一行也是「4 步」，紧贴在这一行「中途停下 · 4 步」下面；JC 定去掉（裁决 159 第 8 条），随工作台票 04 合入（`73ee3005`），真窗口看过。2026-10-30 快进合入 `c67fa46e`…`f9949968`。主会话验收：读过计划层与渲染的改动；代理加的第六条判据（最后一步调过工具，只派了活的一轮照旧平铺，守住裁决 125）与侧栏「最后一句」不算这一行收起的步，都同意；rebase 到 `29808e36` 后在 worktree 上重跑 typecheck、lint、vitest 本机与 `TZ=UTC` 各 237 个文件 / 2633 条全过，`git diff --check` 干净。报告里删除路径的边角（删这一行前面你那一句后的三种合并、经提问删掉这一行、分页从一轮中途开始时照旧平铺）先不改，真机日常用着再看）

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

### 2026-10-30 实现报告（代理）

基线 `81709d39`，实现提交 `9cb17c2c`（本分支 `ticket-114`）。只改了 `gui/` 与 `docs/design/conversation.md`；Core、CLI、Agent API、迁移都没动。

**改了什么**

- 计划层（`gui/src/lib/assistant-conversation.ts`）：`AssistantLinePlan` 新增 `stopped`，键是这一轮的最后一行（这一行画在它后面），值同 `steps` 的形状（`AssistantRunSteps`：`opener`、`members`、`stats`）。判据是新的 `stoppedPartway`（`:372`），票面五条之外加了一条，见下「看到但没改」第 1 条：最后一步调过工具。这一轮的消息照有回答的轮次处理：开场（叫醒行除外）、你的回答、它的提问进 `message`，提问另进 `question`；`firstDrawn` 也认 `stopped`，所以叫醒那一轮的时间在这一行就是第一样东西时画在它上面。
- 画法：`AssistantProcessCard.tsx` 新增 `AssistantStoppedRun`（`:188`），Conversation 新增 `renderStoppedRun`（`:769`），在这一轮最后一行之后画出来（`:989`）。行首 `Footprints` 14px thin，图标离气泡左缘 5px（`pl-[5px]`，正好落在行动条里过程按钮的图标位置）；隔 6px 写字，字 `ink-muted`、数字 `ink-soft`，`--conversation-step-size`，一行 24px（`h-6`），不加气泡底。整行是 `role="button"`、`tabIndex=0`、回车 / 空格、`aria-expanded`；悬停或聚焦时 `bg-hover`，字与数字提到 `ink`；悬停提示用 `foldExpand` / `foldCollapse`。展开期间字停在 `ink`，底不常显，同过程卡片里展开的一步。卡片就是 `AssistantProcessCard`：`assistantProcessSteps(members, turns, -1)`，所有步都进，只做了提问的不进；不传 telemetry，`stats.elapsedMs` 为空，第一行只有「N 步」。开合用 `foldOverrides`，按开场的 ordinal 记，默认收着。
- 文案键：`conversation.stoppedPartway`，中文「中途停下」，英文 `Stopped partway`。整行是 `${stoppedPartway} · ${foldSteps(n)}`，英文单复数随 `foldSteps`。
- 侧栏卡片的「最后一句」：`lastVisibleMessage` 在静止时也跳过这类轮次里的步（`stoppedRunTurns`，`assistant.ts:350`），提问照旧算。理由见下「看到但没改」第 2 条。
- 文档：`conversation.md`「助手的对话」一节开头的沿革、字号「只两种气泡跟」、分组间距、`:128`「对话里」、「没人接替时走」、「为什么是按钮」、`:207`「没有回答的运行」（重写成一整条规则，引裁决 159）、贴底「回复的开头」、步数上限一节、提问一节的「没有回答的运行」。工作台的 `:23`、`:36` 没改：`:36` 的「助手的对话本来就不画」主语是一步回复的折叠头、步骤标记与 StrongHr，现在仍然成立。代码注释同步了 `assistant-conversation.ts` 文件头的 `process` 段与计划注释（`flat` 那条）、Conversation 的 `agentRunning` 与 `assistant` 两处 prop 注释、`run-groups.ts` 的 `liveRunGroup` 注释，以及 `useBubbleMotion.test.tsx` 里一句测试注释。

**票面让我定的**

- 下边距：这一行自带 24px（`pb-6`），下一条照 `agent-bar` 不再加（`prevSide = "agent-bar"`）。算法：回复气泡底到你的下一条是 30px；这一行没有底色，看得见的下缘是字形，字形离 24px 行框底约 5px（14px 图标居中），所以留 24px，你的气泡离字形约 29–30px。展开时这 24px 用 `padding-bottom` 过渡到 0，与卡片的 `mt-1.5` 和 `pb-5` 同一段 `--motion-slow` / `ease-firm` 扫开，展开后就是卡片原有的 6px 和 20px。上边距照 `assistantRowGap(previous, "agent")`：跟在你的气泡后面是 `mt-0`，正好是三点气泡原来站的位置；跟在它的提问后面 4px；隔着时间条 20px。都没在真窗口量过。
- 淡入：不另写。按停止那一下，这一行是同一次提交里出现在 `lastRow` 后面的根节点子元素，裁决 138 现成的 `typingSuccessors` / `playTypingLeave` 会让它从三点淡出的一半开始淡入（`--motion-base`、`--ease-pop`）。只在 `track.live` 的那次提交播放，切会话、重载、冷启动恢复都直接出现。`useBubbleMotion.test.tsx`「fades a copy of its row where it stood… (a stop)」用的是通用的「新的一行」，已经覆盖这条路径。也不会先闪一帧平铺：这一轮一不在跑，计划就直接产出 `stopped`，中间没有走 `flat` 的状态。中止不追加系统行（`system_message` 只有 `/btw` 与斜杠命令会发），所以 `foldEligible` 不会在停止的那一下变假。
- 每一步都只做了提问（问了、你答了、然后停了）：卡片里一行都没有。这时这一行只是字，不是开关，没有底、没有提示、不可 Tab，沿用 `ProcessStepRow`「没东西可开就是纯文字」的语法。工作台遇到同样情况是折叠头照旧可点、点开什么都没有，我没照搬。

**核对（票面「不变的」）**

- 一步都没落定：没有 agent 轮，`stoppedPartway` 为假，照旧只有你那一句；叫醒那一轮的时间也不记（`reports` 没有条目）。
- 步数上限的 `StepLimitTail`、输入框灰字「继续」、出错 toast：`MainView` 与 `ipc-handlers.ts` 没动，尾巴照旧画在对话后面，接在这一行下面。
- 侧栏卡片 / 顶栏的「最后一句」：这一行不是 turn，`lastVisibleMessage` 本来就碰不到它。票面说「照旧停在『你：……』」，Tailscale 那一轮成立（四步的 `final_answer` 全是空的）；一般情况下原代码在静止时会把带旁白的步算作最后一句，见下「看到但没改」第 2 条。改后停在你那一句，或停在它问你的问题上。
- 贴底：`assistantReplyStart` 取你那一句后面第一个有高度的元素，就是这一行（叫醒轮在断点时是时间条）。这一行连同下边距 48px，跟随不会因它停下；在底部展开卡片时跟随卡片长高，与回复下面的卡片是同一套机制。
- 消息菜单：这一行没有 `data-message-id`，右键的 `closest("[data-message-id]")` 取不到它，也没有「⋯」，删不掉。它前面你那一句照旧有菜单。
- `AssistantRunSummary` 退成只写步数：已核对，`elapsedMs` 为空所以不写用时，不传 telemetry 所以没有 token 段；测试断言卡片第一行是「3 步」。
- 工作台与子任务（`assistant` 为假）：只有 `linePlan` 分支变了（`renderStoppedRun` 只在那里调用，跳过条件也只在 `linePlan` 时生效），`ProcessCard` 与原 `AssistantProcessCard` 没改。测试「leaves the workbench's rendering of the same turns flat, in full」改前改后都绿，工作台的全部既有用例也都绿。

**票 32 的删除路径**（拿计划层逐例跑过）

- 删一条回复（它的回答、提问或一步）：Core 的 `message_unit` 会删掉这一轮里它说的每一行（`core/src/message_delete.rs`），剩下你的话和你的回答，没有一步了，所以什么都不画，不会变成这一行。改前改后一样。
- 删这一行前面你那一句（Core 只删那一行），剩下的步跟着前一轮走（`splitAfterAnswer`）：
  - 前一轮有回答：这些步自成一个没有开场的组，`foldEligible` 为假，进 `flat`。改前本来就平铺，删前删后都平铺；改后删前是这一行，删后又摊开成工作台的步骤区（没有开场）。
  - 前一轮也是这一行：两轮并成一行。例如「2 步」与「3 步」并成「中途停下 · 5 步」，一张卡片装两轮的步。
  - 前一轮是只派了活的一轮（照旧平铺、卡片挂在派活那条下面）：并起来的这一轮最后一步调过工具，就变成一行「5 步」。派活那条不再画，它下面的子任务卡片也跟着不见了。
  - 这三种都不是想要的，要不要处理交回主会话判断。
- 这一轮里的提问与你的回答：改前它们在平铺区里，`isMenuBubble` 判否，没有菜单；改后它们是消息，有菜单，同有回答的轮次。所以删它的提问会删掉这一轮它说的每一行，这一行也随之消失：「这一行不能删」可以经由提问绕过去。删你的回答只删那一行。

**测试**（先写后改，改前 15 条红）

- `gui/src/lib/assistant-conversation.test.ts`，7 条红：
  - 「draws a live run as its opener and its asked-and-answered pairs, and a run without an answer as one line after them」：旧用例「…and a run without an answer in full」改写，旧断言是 `flat` 为 `[1, 2, 3, 4]`。
  - 新加 `describe("a run without an answer")` 的 5 条：「is one line after its last step…」「comes after your answer when it stopped right after you answered」「draws nothing when no step landed before it stopped」「stands for a woken round that said something and stopped, its time above the line」「leaves /btw and system rows the workbench way, and a live run to the typing bubble」。
  - 「draws the user's own dispatch as before…」：只加了一条 `stopped.size === 0`，红在字段不存在，是守卫。
  - 7 条的红法：断言值不对，或 `plan.stopped` 不存在（TypeError）。
- `gui/src/lib/assistant.test.ts`，2 条红：「stays on your message while a step narrates before its tools」（静止时的旧断言是旁白，改成你那一句）、新加的「stays on what the conversation draws once a run stopped…」。
- `gui/src/components/conversation/Conversation.assistant.test.tsx`，6 条红：
  - 新加 `describe("…: a run without an answer")` 的 5 条：一行与它的墨色、可达性、没有平铺；展开是卡片、第一行只有「3 步」；提问与回答在这一行之前；只做了提问时是纯文字；英文单复数。
  - 「draws a report round with no answer as the line, its time above it」：替换旧的「…the workbench way, minus the report」。
  - 改后「is plain words…」又红了一次，是我测试里的 `"role="` 匹配到了 `data-role=`，改成 `' role="'` 后变绿；代码没因此改动。
- 守卫（改前改后都绿）：「leaves the workbench's rendering of the same turns flat, in full」、「keeps the card under the user's own dispatch…」。

**门禁**（实现提交 `9cb17c2c` 的树）

- `pnpm --dir gui typecheck`：通过。
- `pnpm --dir gui lint`：通过，0 warning。
- `pnpm --dir gui exec vitest run`：237 个文件、2633 条全过；`TZ=UTC` 再跑一遍，237 / 2633 全过。
- `git diff --check`（`81709d39..HEAD`，本报告提交前后各跑一次）：干净。
- prettier：改前就是 prettier-clean 的四个文件（`AssistantProcessCard.tsx`、`Conversation.assistant.test.tsx`、`assistant-conversation.ts`、`assistant-conversation.test.ts`）整篇格式化；其余旧文件改前改后的 prettier 漂移行数相同（`Conversation.tsx` 8、`en.ts` 40、`zh.ts` 13、`run-groups.ts` 5），自己的 hunk 没有引入新的漂移。中文新增行用脚本扫过半角标点，0 处。

**看到但没改 / Open risks**

1. **票面前提缺了一类轮次**。票面说落进 `plan.flat` 的没有回答的轮次都是中止、出错、停在步数上限。还有第四类：GA 自己收了尾，只是除了标签没话说。最后一步只有 `no_tool`，回复只有 `<subtask>`，或在叫醒以外写了 `<no-reply/>`。照票面五条判，你自己发起、只派了活的那一轮会画成「中途停下 · 3 步」，它的子任务卡片（挂在那条回复下面）就没了。这违背裁决 125「用户自己发起的一轮不动」，也会让既有用例「keeps the card under the user's own dispatch」变红。所以我加了第六条：最后一步调过工具。这类轮次照旧平铺、卡片照旧。中止、出错、步数上限留下的最后一步都调过工具（不调工具的那一步就是 GA 收尾），不受影响。叫醒、只派了活、又没写 `<no-reply/>` 的一轮同理照旧平铺。要不要给它们另一种画法，交回主会话。
2. **「卡片照旧停在『你：……』」只在实践中成立**。原 `lastVisibleMessage` 有意在静止时把带旁白（`finalAnswer` 非空）的步算作最后一句，注释写「a run stopped half-way is drawn in full」，`assistant.test.ts` 也断言了这一点。改后旁白不在屏上，卡片却会说一句屏上没有、它也没对你说过的话，与裁决 159 第 3 条否掉丙的理由相反。只读查了 `workbench.db`：主对话 197 个调过工具的步里，`final_answer` 非空的 0 个，所以实际一直停在「你：……」。我让它在构造上也成立（`stoppedRunTurns`），并改了那条断言。主会话不同意的话，回退 `assistant.ts` 的两处改动和那条断言即可。
3. **删除路径**：见上「票 32 的删除路径」。删这一行前面你那一句后，步会摊回平铺区，或并进前一轮；新增的删除入口是这一轮里的提问。都没改。
4. **分页**：已加载的第一页如果从一轮中途开始（开场在更早那页），这一轮是没有开场的组，在更早那页加载前照旧平铺。与第 3 条同类，没改。
5. **没在真窗口看**：没起 tauri dev。24px 下边距读起来像不像「回复 → 你」、图标的 5px 内缩、悬停底的位置、展开时 padding 过渡与卡片扫开是否同步、停止那一下的淡入，都只在静态渲染与计划层验过，留给 JC 的真机步骤 1、2。
6. 这一行的提示框在挂载时就挂上 Radix 根，没有像票 72 的 chip 那样等第一次悬停。这类轮次很少（库里 10-20 起 49 轮里 1 轮），代价可以忽略。
7. 这一行是对话里的一个 Tab 停靠点（`tabIndex=0`，票面要求键盘焦点）。回复下面的过程按钮是 `tabIndex=-1`，两者对键盘不一致，这是有意的：这一行是这类轮次看过程的唯一入口。
