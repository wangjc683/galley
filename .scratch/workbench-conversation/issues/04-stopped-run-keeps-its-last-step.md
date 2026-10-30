# 04 停下的运行折进头里，最后一步留在外面

Status: needs-dogfood（第 2 步待走。2026-10-30 快进合入 `75c3e75f`…`73ee3005`，含主聊天裁决 159 第 8 条（从「中途停下」那一行点开的卡片不画第一行）。主会话验收：读过判据、折叠计划、头与停下那一下的改动，判据挪到 `run-groups.ts` 后与票 114 的写法等价；rebase 到 `7b91b80c` 后重跑 typecheck、lint、vitest 本机与 `TZ=UTC` 各 238 个文件 / 2649 条全过，`git diff --check` 干净。第 8 条真窗口看过：主对话天气那一行点开，卡片从第一步起，没有「4 步」。真机：JC「真机看了 OK」（10-30）；库里合入后没有工作台会话写过新行，所以第 1 步（汕尾那一轮的历史）算过，第 2 步（看着它停下）还没走。报告第 1 条（答完提问就停下时，提问与回答留在窗口里原位、不挪到头前面）照代码现状记进裁决 9 第 4 条，JC 没单独表态，要挪是 `run-fold-plan.ts` 一个条件）

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

### 2026-10-30 实现报告（代理）

基线是 main `e9f2cf51`（主聊天票 114 已合入），实现提交 `8a293a6e`，分支 `workbench-04`。只改了 `gui/` 与 `docs/design/conversation.md`；Core、CLI、Agent API、迁移都没动。

**改了什么**

- **判据挪到 `run-groups`**：`stoppedPartway(group, turns, liveGroup)` 从 `assistant-conversation.ts` 挪到 `gui/src/lib/run-groups.ts:371`，两边共用，主对话的那一行与工作台的定住窗口用同一个判据。原来主对话里显式的 `isSilentReport` 检查删了，因为它已经包含在「最后一步调过工具」里：静默回复的那一步只有 `no_tool`（`buildAgentTurn` 只在那时置 `silent`）。另外 `run-groups` 不能反过来 import `subtasks`，否则成环。114 的用例全绿。
- **计划层**（`gui/src/lib/run-fold-plan.ts:151`）：停下的运行直接走 live 窗口那条分支，所以锚点、窗口成员、卡片的行、`foldedSteps`、开合，都和停下前一帧算得一样。`FoldHead` 新增 `stopped`。只在一处与 live 不同：live 头后面收着的提问与回答（在跑时不画）停下后进 `outside`，画在头前面，同落定的运行。头注释加了 `stopped` 一条，`flat` 那条删掉「stopped, failed, at the step cap」，改写成「GA 自己收了尾、只剩标签的」。
- **头**：`RunFoldHeader` 新增 `stopped` 变体。结构段写「中途停下 · N 步」，复用 `conversation.stoppedPartway` 与 `foldSteps`，N 是 `stats.stepCount`（同 live 头，停下那一下数字不变）。没有用时，气味段照旧。英文是 `Stopped partway · N steps`。
- **Conversation**：
  - `renderHead` 遇到 `stopped` 且 `foldedSteps === 0`（只落定一步）时不画头，同 live。
  - 新增 `stoppingOpener`：在眼前停下的那一次，在定住的窗口下面放一个 `SettleGap`（`:967`），300ms 后撤掉（见下「在跑那一行怎么离开」）。
  - 只在工作台（`!assistant`）设这个状态。
- **注释**：`liveRunGroup`、`SettleGap`、Conversation 的 settling 段、`AssistantProcessCard` 与 `assistant.ts` 里指向判据的两处注释都同步了。
- **文档**：`conversation.md`「Turn 结构」开头示意图下面那句；新加一段「停下的运行：live 窗口原样定住」，带一张小示意图，写了为什么、头、卡片、最后一步、提问与回答、判据、按停止那一下和不变的；「一步就答完」一段的末尾；「助手的对话」→「没有回答的运行」里的判据出处与工作台那一条；步数上限一节；提问一节「没有回答的运行」的工作台部分；「live 两行窗口」一条（中止那句，外加「停下瞬间」）。都引工作台对话 PRD 裁决 9。

**114 的第六条（最后一步调过工具）在工作台也用了**

- 理由：最后一步只有 `no_tool`、又没话说的一轮，是 GA 自己收了尾，不是中途停下，头上写「中途停下」是假话。工作台里这种轮次只可能是标签之外什么都没写，或误用了 `<no-reply/>`。
- 数据：只读查了库，工作台（`main_chat = 0`）474 个只有 `no_tool` 的收口步全都有回答，一次也没出现过。所以这一条在工作台实际不改变任何画面，只保证字不说谎。
- 代价：万一出现，这一轮照旧整段平铺，停下那一下也会铺开（与今天一样）。
- 两边共用一个判据，以后改一处，两种对话一起变。

**在跑那一行怎么离开**（票面让我定）

- 现成的做法有两种：
  - 瞬间消失：每一轮 `run_complete` 时、提问到来时都是这样，在跑那一行由 MainView 画，`isRunning` 一假就卸载。
  - `SettleGap`：一步就答完的落定，占住那一行的位置一帧，再随 `ExpandSection` 扫掉。
- 我选了 `SettleGap`，放在定住的窗口下面，只在眼前发生的那次停下才放（`watchedOpener` 判出「live → 没有回答且 `stoppedPartway`」，同 settling 的守卫式 setState-in-render，所以第一帧就在），重载、切回来都不放。
- 理由：
  - 停下以后窗口留着，下面要么什么都没有，要么是新出现的步数上限尾巴。瞬间撤掉时，贴着底部的长对话会被滚动钳位往下推一整行高度，就是一跳。用 `SettleGap` 以后，尾巴从那一行的位置滑上来，贴底的对话往下滑而不是跳。
  - 对话不满一屏、没贴底时，它是空白，看不出来。
- 高度：`SettleGap` 是「步骤字号 × 1.6 + 段距」。在跑那一行是它的 marker 一行加上方 10px（窗口 `-mb-2.5` 之后 marker 的 `mt-2.5`），标准档约差 2px。
- 停下时那一行如果正带着思考预览或流式正文，会更高，多出的部分照旧瞬间消失。

**按停止那一下：不重挂载**

- 没有 DOM 测不了真动画，但节点同一性可以测。新文件 `Conversation.stop.dom.test.tsx`（jsdom）的做法：先以在跑渲染并点开头，再以停下重渲。
- 断言结果：
  - 头、卡片、最后一步都还是同一个 DOM 节点（`toBe`），`aria-expanded` 仍为 true。
  - 头的字从「已完成 4 步」换成「中途停下 · 4 步」。
  - 只落定一步的那一步也还是同一个节点，且没有头。
  - 停下那一帧有收合的空位，约 300ms 后消失；直接以停下状态挂载（重载）则没有。
- 静态渲染测试「draws the live window's markup but for the header's words」比对了停下前后整段 markup：除了头的字与 live 头的 `animate-fade-in`，逐字相同，收着与展开都比了。`animate-fade-in` 没有 fill-mode，停下时去掉它不影响画面；只有头刚出现、淡入那 160ms 内正好按停止，淡入会直接到底。

**提问与回答**（票面「在头前面」的一处细化）

- live 头后面收着的（在跑时不画）：停下后画在头前面，顺序同落定的运行（裁决 6）。
- 还是窗口末尾的（你答完、它还没跑出下一步就停了）：留在窗口里原来的位置，带回显，按裁决 9 的「停下时画面原样定住」。如果照落定的做法把它们也拿到头前面，停下那一下回显和回答会从窗口里跳到头上面，窗口里只剩一个光秃秃的「问用户」步。主会话要统一成全部在头前面，改 `run-fold-plan.ts` 里一个条件即可。

**核对（票面「不变的」）**

- 有回答的运行、一步就答完的、在跑的 live 窗口：计划层那几条分支没改，`stopped` 只在 `!live && !complete` 时为真。工作台既有的计划与渲染用例全绿；新增的「leaves an answered run as it was」作为守卫，改前改后都绿。
- 步数上限尾巴、输入框灰字「继续」、出错 toast、侧栏「已中止 / 已暂停 · 摘要」：MainView、`ipc-handlers.ts`、侧栏都没动。
- 主对话：`assistantLinePlan` 只换了判据的出处；工作台计划在主对话里不跑（`linePlan` 存在时 `foldPlan` 为 null）。新用例断言同一组轮次在主对话里仍是那一行。
- 分组、步数、replySet、`askUserReplyContent`、侧栏「第 N 步」：都是 `run-groups` 的，没动（只加了一个函数）。
- 问题轨：只索引开场的 `user-msg`，开场照旧画在自己的位置。

**测试**（先写后改，改前 15 条红）

- `gui/src/lib/run-fold-plan.test.ts`，5 条红：
  - 「folds every step but the last behind its header…」
  - 「is the live window's plan from the stop on…」（含正在扫出窗口的那一步）
  - 「puts the questions and answers behind the header out before it…」
  - 「leaves a question and its answer in the window while they are its tail, as live」
  - 「draws a run stopped after one step as that step alone…」
  - 旧的「draws a run without an answer that is not running in full」换成守卫「draws a run GA ended on its own with nothing but tags in full」，改前改后都绿。
- `Conversation.steps.test.tsx`，5 条红：
  - 「folds behind 「中途停下 · 4 步」 with its tool scent and no time…」
  - 「opens the card of every step but the last」
  - 「draws the live window's markup but for the header's words」
  - 「puts its questions and your answers out before the header…」
  - 「says it in English」
  - 另外两条是守卫，改前就绿：「draws a run stopped after one step as that step alone, no header」（今天平铺的那一步也是一个 marker）、「leaves an answered run as it was, and the main chat its one line」。
  - 旧的「unfolds a run without an answer in full, the step region as before」删了。
- `Conversation.test.tsx`，1 条红：「folds a run without an answer behind its header, its last step out (ruling 9)」，替换旧的「unfolds a run without an answer in full, as before」。
- `Conversation.stop.dom.test.tsx`（新），4 条全红。
- 改后又调整了几条，代码都没因此改动：
  - 「draws the live window's markup…」里我比对时没考虑数字是单独的 span，改成替换「已完成 <span」。
  - 「Conversation browser step site」两条：两步没回答的运行现在第一步收在头后面，加了 `expand.all` 打开卡片与那一行再看工具条。
  - 114 的守卫「leaves the workbench's rendering of the same turns flat, in full」改成工作台的新画法。
  - 改前还修了两处测试自身的错：收合空位的选择器写宽了，会匹配到序号栏；有一处没去掉标签就比文字。

**门禁**（提交 `8a293a6e` 的树）

- `pnpm --dir gui typecheck`：通过。
- `pnpm --dir gui lint`：通过，0 warning。
- `pnpm --dir gui exec vitest run`：238 个文件、2648 条全过（基线 237 / 2633）；`TZ=UTC` 再跑一遍，238 / 2648 全过。
- `git diff --check e9f2cf51..HEAD`：干净。
- prettier：
  - 改前就是 prettier-clean 的 `run-fold-plan.ts`、`run-fold-plan.test.ts`、`Conversation.steps.test.tsx` 与新文件整篇格式化。
  - 其余旧文件改前改后的漂移行数相同：`Conversation.tsx` 8、`RunFoldHeader.tsx` 9、`run-groups.ts` 5，其他为 0。
  - 中文新增行用脚本扫过半角标点，0 处。

**看到但没改 / Open risks**

1. 停下那一下，live 头后面收着的提问与回答会出现在头前面，头连同窗口被往下推它们的高度。落定的运行在 settling 时也是这样，而且中途提问罕见（裁决 6：同期 7 次）。
2. `SettleGap` 的高度是估的（见上）。停下时在跑那一行正带着思考预览或流式正文的，多出的部分瞬间消失。
3. 主对话删了显式的 `isSilentReport` 检查，靠「静默的那一步只有 `no_tool`」这条构造上的不变式；以后要是有别的路径给带工具的步置 `silent`，主对话会把静默叫醒画成那一行。
4. 没起 tauri dev，真机步骤 1、2 都没走。头换字时是否不闪、`SettleGap` 和在跑那一行的高度是否接得上、贴底时的滑动，都留给 JC。
5. 汕尾那一轮只读查过库：开场之后 18 个助理行，下一句是「继续」，第 18 步调的是带路径参数的工具，不是提问。按判据它会是「中途停下 · 18 步」加第 18 步，但没有拿库里的行实际渲染过。

### 2026-10-30 附：主对话「中途停下」那一行点开的卡片不画第一行（代理）

主聊天 PRD 裁决 159 第 8 条，随本票顺手改，单独一个提交。这条写在这里而不是票 114：main 上票 114 的文件这期间改过，避免合并冲突。

- 代码：`AssistantProcessCard` 新增 `numbers`（默认开），开着才画第一行 `AssistantRunSummary`。`AssistantStoppedRun` 传 `numbers={false}`。回复下面的卡片不变。
- 卡片顶部：没有第一行时，第一步那一行离卡片上边框 4px（`ProcessCard` 自己的 `pt-1`），下面照旧 4px，左右照旧 4px，与工作台没有数字行的卡片一样，不会贴着边框。8 行上限的滚动盒不变，卡片整体矮 24px。顶部渐隐照旧挂在滚动盒顶上，步骤往上滚时出现。
- 测试（`Conversation.assistant.test.tsx`）：
  - 改写「opens the reply's process card under it…」：卡片里没有 `assistant-run-summary`，`process-card` 带 `pt-1`，后面直接是滚动盒。
  - 新加「keeps the first line on the card under a reply, and drops it only from the line's card」：同一段对话里，那一行的卡片没有第一行，回复下面的卡片仍有，内容是「2 步 · 用时 9 秒…」。
  - 两条在旧的 `AssistantProcessCard` 上都红，换回新代码后都绿。
- 文档：`conversation.md`「助手的对话」→「没有回答的运行」→「卡片」那一句改成没有第一行、引第 8 条；「字只一类」里的「卡片第一行的算法」改成「回复下面卡片第一行的算法」。
- 门禁（这个提交的树）：
  - typecheck 通过；lint 通过，0 warning。
  - vitest 238 个文件、2649 条全过；`TZ=UTC` 再跑一遍，238 / 2649 全过。
  - `git diff --check` 干净。
  - 两个改动文件改前就是 prettier-clean，整篇格式化。
- 没在真窗口看。
