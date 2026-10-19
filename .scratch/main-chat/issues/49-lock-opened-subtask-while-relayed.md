# 49 Galley 在处理或已转述子任务的提问时，打开的子任务里不能答

Status: needs-dogfood（裁决 102；2026-10-19 合入 main；JC 在 dev 里看锁住时的原因行、「回到 Galley」、停用的输入框，以及「在跑」时提问框顶上仍写「等你回复」要不要换）

来源：主聊天 PRD 裁决 102。依赖 48（卡片只写状态、`askInCard` 兜底态，`081123ed`）。只改 GUI 与设计文档；Core、runner、提示词不动。外置运行时没有主对话、没有子任务，零变化。

## 背景

票 48 第二节（见该票 Comments）查明：GA 的 `ask_user` 没有取消，下一条消息就是回答。Galley 在主对话里转述了子任务的提问之后，如果你点卡片上的「打开」进子任务、在那里答了，主对话里的提问一直挂着：子任务的交代被「在等你回答」挡下、退成通知；你在主对话说的下一句被当成旧问题的回答派发。

## 要做的

在主区打开的子任务（面包屑「Galley ›」那种视图）里：

1. **什么时候锁**：这个子任务此刻在问，且它的提问已经交给 Galley，即以下任一成立：
   - 带着它的叫醒已送到助理、那一轮还在跑（Galley 正在决定替你答还是转述）；
   - 主对话里挂着的 `ask_user` 是那次叫醒那一轮发出的（已转述）。
   判定从现有 store 与事件得出（叫醒行 `supervisor = galley-report`、`origin.reason` 是子任务 id 列表、`dispatched` 送达、主对话的 `pendingAskUser`、票 48 的 `askInCard`），写成一个纯函数，与卡片的判定放在一起（`gui/src/lib/subtasks.ts`），互相引用，别各写一份。
2. **锁住时**：子任务会话里那条提问的候选按钮与回答框不可用；底部输入框也停用（子任务在等回答时，输入框里发什么都算回答）。用一句话说明并指回主对话，点它回到 Galley 对话（复用面包屑「回到 Galley」的动作）。文案中英都要，措辞你提，写理由；先查 `docs/design/` 里输入框不可用、提问气泡的既有画法与禁令（`grep` 「不要」「有意」「禁」），照既有样式，不新造组件。
3. **什么时候不锁**：还没交给 Galley（子任务刚问、叫醒还没送到）、叫醒没送到的兜底（`askInCard`，此时卡片也能答，两处都能答是允许的，都直接进子任务、主对话没有挂着的转述）、子任务不在问。**任何时刻至少有一个地方能答**：写测试守住这一条，尤其是页面重载后 `askInCard` 丢失、叫醒还没送到的情形。
4. **竞态**：叫醒已送到、Galley 那一轮正在跑时你在子任务里答，会让 Galley 转述一个已答掉的问题（票 48 路径 1 的同型）。第 1 条把「那一轮在跑」也算锁住就是为了堵它；写清还剩哪些窗口。
5. 卡片（票 48）的规则不动。

## 文档

- `docs/design/conversation.md`：子任务卡片 / 打开子任务一节写上裁决 102 的锁与「至少一个地方能答」。
- 代码注释同步。

## 验收

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、全量 gui 测试两遍（本机时区与 `TZ=UTC`）、`git diff --check`、`.github/workflows/check.yml` 门禁脚本、`node scripts/check-docs-links.mjs`、新增中文行标点扫描。
- 测试：判定函数各分支（未交、在跑、已转述、兜底、不在问、重载后）；锁住时提问与输入框不可用、有指回主对话的一句；不锁时照旧可答；「至少一个地方能答」。

## Comments

### 2026-10-19 实现回报（子代理）

#### 改动清单（未提交）

- `gui/src/lib/subtasks.ts`：新增 `SubtaskQuestionHolder`（谁拿着子任务的提问）、纯函数 `subtaskQuestionHolder`、`subtaskQuestionLocked`、`subtaskQuestionPlaces`，以及内部的 `wakeCarries`；放在卡片的 `answeredInCard` 后面，两边注释互相指。
- `gui/src/hooks/useSubtaskQuestionHolder.ts`（新）：从 sessions、messages、subtasks 三个 store 取输入喂给纯函数；只对没升级的子任务算，其余一律 `none`。
- `gui/src/components/screens/MainView.tsx`：主区打开子任务时算 holder。锁住时：
  - `AskUserBubble` 传 `disabled`；
  - 候选下面一行写原因，加「回到 Galley」（`openMainChat`，与面包屑同一个动作）；
  - `Composer` 传 `disabled`，占位换成「在和 Galley 的对话里回答」。
- `gui/src/lib/composer-register.ts`：新增 `withGalley` 语域（`questionWithGalley`，压过其余占位），对应文案键 `answerWithGalley`。
- `gui/src/i18n/locales/zh.ts`、`en.ts`：新增 `subtask.withGalleyWorking`、`subtask.withGalleyAsked`、`composer.answerWithGalley`。
- `gui/src/components/conversation/AskUserBubble.tsx`：只改 `disabled`、`children` 两处注释。
- `docs/design/conversation.md`：子任务卡片一节「打开」后面新增「打开的子任务在问、提问在 Galley 手里时不能答」，写了锁、不锁、至少一处能答与代价。
- 测试：`lib/subtasks.test.ts`（holder 各分支与不变式）、`lib/composer-register.test.ts`、`hooks/useSubtaskQuestionHolder.test.tsx`（新，接线）、`components/screens/MainView.subtask-lock.test.tsx`（新，画法）。

#### 判定函数的各分支与理由（`subtaskQuestionHolder`，`lib/subtasks.ts:386`）

按顺序判：

1. **`none`**：子任务没有待答的提问。
2. **`card`**：`answeredInCard(askInCard, pending)` 成立，即 Core 说叫醒没送到，这一问在卡片里答（票 48）。
   - 不锁：卡片与打开的子任务都能答，都直接进子任务，主对话里没有转述。
   - 排在 Galley 的分支前面：叫醒行在 `pending` 阶段就会进页面，到派发失败（`persisted_only`）后，兜底仍然有效。
3. **`subtask`**：页面看不到「带着这一问的叫醒」，就算还没交给 Galley，照旧可答。认叫醒要同时满足（`wakeCarries`，`:438`）：
   - 主对话最新一轮（`buildRunGroups` 的最后一组）由叫醒行开头（`isReportRound`：`via: system`、`supervisor: galley-report`）；
   - 行备注 `origin.reason` 按逗号拆开后含这个子任务；
   - 行的 `createdAt` 严格晚于子任务最后一条用户消息的 `createdAt`，即这一问所在那一轮开始之后。
   - 主对话的轮次没读进来（`mainChat` 为 undefined）也落在这里，失败时放开。
   - 理由：只认这一问的叫醒。更早的叫醒（上一问、完成、打回）不算。Core 的 `created_at` 精确到秒（`db/helpers.rs:584` `chrono_now_iso`），而叫醒至少隔一次模型调用，所以用严格大于，同一秒的旧叫醒不会被误认。
4. **`galleyWorking`**：认到叫醒，且主对话 `agentRunning`，锁。
   - 覆盖两段：Galley 在决定替你答还是来问你；你在主对话答完、它正在转给子任务（回答并进同一组）。
   - 这一段把票 48 路径 1 的同型竞态也堵上了：它在转述时你在子任务里答，它会转述一个已答掉的问题。
5. **`galleyAsked`**：认到叫醒，主对话不在跑，且有 `pendingAskUser`，锁，在主对话里答。
6. 认到叫醒，但那一轮已结束、主对话没在问（一句话说了、出错、被停、`persisted_only`）：回到 **`subtask`**，放开。

- `subtaskQuestionLocked`：只有 `galleyWorking` 与 `galleyAsked` 锁。
- `subtaskQuestionPlaces`：给出卡片、打开的子任务、主对话三处各能不能答。
- 「至少一个地方能答」由测试守住：主对话 13 种形态乘 `askInCard` 4 种取值逐个组合，断言以下三条：
  - 除 `galleyWorking` 外至少一处能答；
  - 卡片能答当且仅当卡片自己的 `deriveSubtaskCard(...).inCard` 为真，两份判定读的是同一组事实；
  - 主对话算作一处，仅当它真的有提问。
- 另有专门一条：重载后 `askInCard` 丢失、叫醒还没送到（主对话没读进来，或在问它自己的问题）时，打开的子任务能答。
- 例外只有 `galleyWorking`：那一段任何地方都不能答，是为堵竞态有意为之。它结束后只会落到 `none`（替你答了）、`galleyAsked`（问你了）或 `subtask`（没问就结束），都有地方能答。

#### 文案与样式依据

- **画法**：沿用「灰掉的控件，下面一行写原因，不调淡」的规矩。
  - 出处：`conversation.md`「消息菜单」的「不能删的时候」（「删除」是灰的，下面一行写原因）；`layout-and-chrome.md`「标题菜单里的查找与重置」（重置置灰，原因那行不调淡，它是唯一值得读的一行）。
  - 所以候选用 `AskUserBubble` 原有的 `disabled`（灰、`cursor-not-allowed`），原因行 12px `ink-soft`，放在候选下面（`children` 槽，卡片兜底时也用它）。
- **「回到 Galley」**：`ghost` 小按钮，同子任务卡片的「打开」；文字复用面包屑的读屏名 `assistant.backTo`，动作同面包屑（`openMainChat`）。
  - 依据：`foundations.md` §2.6「禁止 `cursor-pointer`，小手只留给真实外链」，所以用按钮，不用链接。
- **输入框**：用 `Composer` 原有的 `disabled`（一行式整条 `opacity-60`，`ComposerOneLine.tsx:61`），不新造组件。
  - 占位走 `composer-register` 的语域体系（`conversation.md`「ask_user 提问气泡」的「Composer 占位随候选数变」、4.4 的「占位照旧」各条）。
  - 用真 `disabled`、不用 `aria-disabled`：`conversation.md` 模型切换器一节那条「禁用元素吞掉指针事件」管的是靠 tooltip 解释的禁用控件，这里的解释是看得见的一行，不需要悬停。
- **不用横幅或提示条**：`foundations.md`「不要 toast，不要 banner」。原因就写在提问下面。
- **用词**：界面说 Galley 不说「主对话」（`layout-and-chrome.md`「叫法」：「主对话」退为内部用语）。
- **措辞**：
  - 在跑：「Galley 正在处理这个问题」（en「Galley is handling this question」）。这时它可能替你答，也可能来问你，所以不说「问你」。
  - 已问：「Galley 正在问你这个问题」（en「Galley is asking you this question」）。现在时：它在那边等。
  - 输入框占位：「在和 Galley 的对话里回答」（en「Answer in your chat with Galley」）。说出这个框原本要做的事去哪做；两种状态都成立，替你答了的话你本来也不用答。
- **没改的**：提问框顶上的「等你回复」头沿用 `AskUserBubble`。在跑那一段它不太准，留给真机看（见下）。

#### 验证

- `pnpm --dir gui typecheck`：通过。`pnpm --dir gui lint`：通过（0 warning）。
- 全量 gui 测试：本机时区 169 个文件 1778 个用例全过；`TZ=UTC` 再跑一遍，同样 1778 个全过。
- `check.yml` 门禁：六个脚本（含 `check-docs-links`）全部 exit 0。没动 IPC。
- `git diff --check`：干净；新文件也查过，无行尾空白。
- prettier：新文件与 HEAD 时干净的 `subtasks.ts`、`subtasks.test.ts` 整篇格式化。`composer-register.test.ts` 被 prettier 顺带改的一处旧代码已手工还原；`MainView.tsx` 格式化后无差异；`zh.ts`、`en.ts` 的差异都是原有行。
- 标点扫描：中文行 0 处；命中的是测试里的正则和一处英文注释的英文标点，属于误报。
- 中途为了让 `git diff --check` 覆盖新文件用过一次 `git add -N`，已用 `git restore --staged` 撤回，索引是干净的。

#### 剩下的竞态窗口

1. **Core 读完现状到页面收到叫醒行之间**：`deliver` 持闸读 `still_due`（`subtask_report.rs:1268`），写行，再发 `pending`；页面收到 `user-message-persisted` 之前，打开的子任务还没锁。这时答，Galley 会转述已答掉的问题。窗口约一次 SQLite 写加一次事件投递，毫秒级。在这之前答没有问题：`still_due` 会把这份汇报丢掉。
2. **一次叫醒带了几个子任务**：列着的子任务全锁。Galley 先转述其中一个时，另一个在主对话里还没有它的问题（`subtaskQuestionPlaces` 把主对话算作一处，但那条问题不是它的），要等你答完第一个、Galley 那一轮接着处理。不会无处可答，只是要排队。
3. **页面读不准时放开**：主对话轮次没读进来，或子任务最后一条用户消息没有时间，都不锁，回到票 48 的老问题。重载后页面会落在主对话（`openMainChat`），轮次会读进来；在跑的 runner 由 `_attachLive` 恢复 `agentRunning`，所以正常路径能锁住。
4. **锁卡住的风险**：如果页面错过主对话的 `run_complete` 或 `error`，`agentRunning` 不清，子任务会一直锁着，而主对话里也没有提问，于是无处可答。这是页面状态漂移的既有风险，但本票把它的后果从「显示在跑」放大成「不能答」；重载能恢复。
5. **Galley 重启**：Core 的 `ask_pending` 丢了（票 50）。主对话的提问从历史恢复后，子任务仍按 `galleyAsked` 锁住；在主对话里答会被当普通消息发出，属于票 50 的范围。
6. **界面之外**：CLI 或别的 supervisor 直接 `session send` 子任务（裁决 102 的代价，见 deferred）；手机看不到没升级的子任务。

#### 需要维护者在 dev 里看的点

- 让子任务提问、Galley 用 `ask_user` 转述后，从卡片「打开」：候选灰、下面一行「Galley 正在问你这个问题　回到 Galley」、输入框灰、占位「在和 Galley 的对话里回答」；点「回到 Galley」回到主对话。
- 在 Galley 那一轮还在跑时打开：那一行应是「Galley 正在处理这个问题」。这时提问框顶上仍写「等你回复」，看要不要换。
- 兜底：让主对话先挂着它自己的问题，再派一个会提问的子任务，卡片与打开的子任务都应能答。
- 观感：原因行（12px `ink-soft`）加 ghost 按钮在琥珀色提问框里的样子；一行式输入框 60% 不透明，以及模型短语跟着一起灰的样子。

#### 票外发现（只报，没修）

- `Composer` 停用时 `LLMPill` 跟着停用（`Composer.tsx:644`），`EffortPill` 却没传 `disabled`（`:657`），所以锁住时推理强度仍可点。这是 `disabled` 态原有的不一致，以前没人用到这个状态。
- 选中文字后的「引用」（`SelectionCopyToolbar` 到 `composerRef.quote`）在锁住时仍能把引用放进停用的输入框，发不出去，无害。
- `AskUserBubble` 的 `disabled` 原注释写「例如 bridge 没连上」，但全仓没有任何地方传过它；本票是第一个用法，注释已改。
