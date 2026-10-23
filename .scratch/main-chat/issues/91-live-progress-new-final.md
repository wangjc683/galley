# 91 在跑时的进展定「新」：写死、拆切换器、改设计文档

Status: done（2026-10-23 机器验收过、合入 main）

来源：[主聊天 PRD](../PRD.md) 裁决 135（2026-10-23；JC 真机比完票 90：「选『新』，体验会好很多」）。只改 GUI 与设计文档。

## 为什么

票 90 做了临时切换器（现状 / 新）。JC 定「新」：主对话在跑时，对话里三点气泡下面一行「{在做什么} · {用时}」，顶栏身份行在跑时没有第二行，侧栏卡片写「正在工作…」（不在屏上时它写字写「正在输入…」，满 1 分钟起「正在工作 · N 分钟」）。这张票把「新」写成唯一画法，拆掉切换器和现状那一档，删掉已经没人读的顶栏那句，并把设计文档改成定稿。

## 要做的

1. **照拆法做**：`gui/src/components/conversation/live-progress-variants/live-progress-variants.ts` 文件头写着完整拆法（「Removal, after the ruling」一段，按「新 wins」那一列）。要点：
   - 删整个 `live-progress-variants/` 目录（含 pill、两份测试、快照）；`App.tsx` 里 pill 的 import 与那一行；`MainView`、`AssistantIdentity`、`SidebarAssistant` 里的 `useLiveProgressVariant`。
   - 删测试前先把「新」要留的测试挪走：pill 测试里交接那一半挪到 `useTypingBubbleHandoff` 旁边；`live-progress-variants.test.tsx` 里「新」的 describe 挪进 `MainView.assistant`、`MainHeader.identity`、`Sidebar.main-chat` 三处，这三处原来断言现状的地方改成新的说法（顶栏在跑时无第二行、卡片「正在工作…」、三点下面有那一行）。
   - 表里「新 wins: keep」那一列全部留下，去掉 `TEMP variant switcher (main chat 90)` 标记；`MainView` 的 `progressDoing` 不再判档：`typingShown ? assistantDoing(…) : null`。
   - 拆完 `grep -rn "main chat 90" gui/src` 为空。
2. **删顶栏那句**（拆法最后一段）：`assistantSettledSentence`、`assistantCachedSettledSentence`、`useAssistantSettledSentence`、`useAssistantState` 的 `header`、`AssistantStateInput.sentence`、`assistantState` 里 running 分支的文字。删之前 `grep` 确认没有别处在读（过程卡片、IM、CLI 若有读到就别删，回报里写明）。running 时 `AssistantState.line` 直接为 null，`AssistantIdentity` 里不再需要 `quiet` 判断。相关测试跟着删或改。
3. **注释跟上**：`lib/assistant.ts`、`lib/assistant-conversation.ts`（文件头「process」那一段：顶栏写那句、卡片「正在输入…」都改成现在的分工）、`TypingBubble.tsx`、`AssistantIdentity.tsx`、`SidebarAssistant.tsx`、`useAssistantSentence.ts`、`useAssistantState.ts`、`lib/assistant-progress.ts`、`hooks/useAssistantProgress.ts` 里描述在跑时分工的注释改成定稿说法，引用裁决 134、135；不再提「切换器」「现状档」。
4. **设计文档改成定稿**：
   - `docs/design/conversation.md`「助手的对话」里「在跑时：三点气泡」一节：三样东西分在三处 → 两处（对话里三点加一行，卡片），顶栏在跑时留空。写清那一行的规则（写法、在做什么的四条优先级与后半句的切法、用时、叫醒的一轮不画、读屏、交接时随三点淡出）、卡片的表、为什么（裁决 134 第 1、2 条的理由，简述）、历史（10-19 起顶栏写那句不计时，10-23 用户反馈后挪进对话，裁决 134、135，票 90、91）、已知代价（裁决 135 第 3 条三点）。原来「顶栏写做完的那一步的那句话」「卡片写『正在输入…』」两小节改写，不留旧规则当现行。该节开头那段历史概述里「顶栏第二行是做完的那一步的那句话」也改。同文件里其他提到在跑时顶栏那句的地方（`grep -n "顶栏" docs/design/conversation.md` 逐条看）一并对齐。
   - `docs/design/layout-and-chrome.md` §4.1「开着助手时是身份行」：在跑时第二行留空，顶栏只说要你处理的状态；§4.2「助手卡片」：在跑时的第二行按卡片的表。
   - 文档是中文，标点一律全角；引用代码用反引号。

## 别动

- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- 「新」的行为：那一行、卡片、交接的现有实现与测试断言不改（只挪位置、去标记）。
- 工作台对话、从助手点开的子任务、外置运行时；三点气泡本身与交接几何；过程卡片。
- `core/`、`runner/`、`managed-ga/`、提示词、手册；`.scratch/` 下的 PRD（主会话维护）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都报错；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；删文件用 `git rm <文件…>`。提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `grep -rn "main chat 90\|useLiveProgressVariant\|LiveProgressVariant" gui/src` 为空
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过
- `CI=true pnpm --dir gui test` 与 `TZ=UTC CI=true pnpm --dir gui test` 全过
- `git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 删掉的文件与符号清单；第 2 条每个符号删之前 `grep` 的结果。
3. 挪走的测试：从哪到哪、几条。
4. 两份设计文档改动的 diff 原样。
5. 验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方。

## Comments

### 2026-10-23 实现回报（票 91 子代理）

在 `~/Documents/genericagent-webui-wt91`（分支 `ticket-91-live-progress-final`，从本地 main 的 `e6fd4d61` 起）里做完，没碰主树、没跑 `tauri dev`、没 push、没合入。只改了 GUI 与两份设计文档；`core/`、`runner/`、`managed-ga/`、提示词、手册、`.scratch/` 下的 PRD 都没动。「新」的行为（那一行、卡片、交接）、工作台、子任务、外置运行时都没变：代码里只去掉了判档，测试断言只挪了位置。

#### 1. 提交列表

```
72ee7900 Ticket 91: design docs settle the live progress line (rulings 134, 135)
b193d32d Ticket 91: the live progress line is the only way; the switcher and the header's sentence go
```

（本回报自己的提交在这之后，见我交回给主会话的那份。）

**合入时注意**：派单之后本地 main 又进了 8 个提交（票 92，以及移除桌面宠物的票 01）。其中 `bf613e4f` 改了切换器的快照 `gui/src/components/conversation/live-progress-variants/__snapshots__/live-progress-variants.test.tsx.snap`，本分支删了它，`git merge-tree --write-tree --name-only main HEAD` 报一处 modify/delete 冲突，解法是保留删除（`git rm` 那个快照）；`docs/design/conversation.md` 两边都改了，自动合并。我把 merge-tree 的结果（删掉那个快照）用 `git archive` 导进 scratchpad 跑过：205 个测试文件、2263 个测试全过，`eslint src --max-warnings 0` 与 `tsc --noEmit` 都 exit 0。没有动任何分支，也没有 rebase。

#### 2. 删掉的文件与符号

文件（`git rm`）：

- `gui/src/components/conversation/live-progress-variants/live-progress-variants.ts`
- `gui/src/components/conversation/live-progress-variants/LiveProgressVariantsPill.tsx`
- `gui/src/components/conversation/live-progress-variants/LiveProgressVariantsPill.test.tsx`（交接那一半挪走后删；git 把它记成改名到 `gui/src/hooks/useTypingBubbleHandoff.test.tsx`）
- `gui/src/components/conversation/live-progress-variants/live-progress-variants.test.tsx`
- `gui/src/components/conversation/live-progress-variants/__snapshots__/live-progress-variants.test.tsx.snap`

第 1 条（拆切换器）：`App.tsx` 的 pill import 与那一行；`MainView`、`AssistantIdentity`、`SidebarAssistant` 里 `useLiveProgressVariant` 的 import 与调用。`MainView` 的 `progressDoing` 改成 `typingShown ? assistantDoing(turns, inFlightContent, copy) : null`；卡片改成 `useAssistantRound(mainChat.id, state.kind === "running")`。表里「新 wins: keep」那一列全部留下，标记换成定稿注释（`TypingBubble.tsx`、`useTypingBubbleHandoff.ts`、`lib/assistant.ts`、`lib/assistant-progress.ts`、`hooks/useAssistantProgress.ts`、`zh.ts` / `en.ts`，以及两份测试的文件头）。

第 2 条（顶栏那句）删的符号：

- `lib/assistant-conversation.ts`：`assistantSettledSentence`、`assistantCachedSettledSentence`，连同只服务它们的私有 `assistantSummaryLine`、`settledCache`，以及因此不再用的 `isFinalAnswerTurn`、`isProtocolFailureSummary` 两个 import。`assistantFirstLine`（连同 `BLOCK_MARKER`、`LINE_MAX_CHARS`）留着：三点下面那一行用它清洗 summary（`lib/assistant-progress.ts:49`）。
- `hooks/useAssistantSentence.ts`：`selectAssistantSettledSentence`、`useAssistantSettledSentence`。
- `hooks/useAssistantState.ts`：`header` 参数与那一次读取。
- `lib/assistant.ts`：`AssistantStateInput.sentence`；`assistantState` 的 running 分支改成 `{ kind: "running", line: null, fromSubtask: false }`。running 的 line 没了，顺带把 `AssistantLine.tone` 收成 `"warning" | "error"`，`AssistantIdentity` 去掉 `quiet` 判断，也去掉只给 running 用的 `text-brand-strong/85` 那一档（等你回复、出错的类名不变，渲染结果相同）。
- 没删：`copy.sidebar.thinking`（「思考中」），`SidebarSessionRow.tsx:192`、`lib/subtasks.ts:512` 还在读。

删之前的 grep（在 `e6fd4d61` 上跑；为了短，同一文件的行号并成一行，`.scratch/` 除外）。读到的只有顶栏这一路、切换器、测试与文档；过程卡片、IM、CLI、Core、runner 都没有：

```
$ git grep -n 'assistantSettledSentence' e6fd4d61 -- . ':!.scratch'
  docs/design/conversation.md:141
  docs/design/layout-and-chrome.md:59
  gui/src/components/conversation/live-progress-variants/live-progress-variants.ts:83
  gui/src/components/layout/assistant/AssistantIdentity.tsx:24
  gui/src/hooks/useAssistantSentence.test.ts:9,488
  gui/src/hooks/useAssistantSentence.ts:24
  gui/src/lib/assistant-conversation.test.ts:11,145,147,156,166,173,203,213,223,233,243,251,263,274,287
  gui/src/lib/assistant-conversation.ts:36,222,257,269
  gui/src/lib/assistant-progress.test.ts:4,433
  gui/src/lib/assistant-progress.ts:129
  gui/src/lib/assistant.ts:39,89
$ git grep -n 'assistantCachedSettledSentence' e6fd4d61 -- . ':!.scratch'
  gui/src/components/conversation/live-progress-variants/live-progress-variants.ts:83
  gui/src/hooks/useAssistantSentence.ts:2,33
  gui/src/lib/assistant-conversation.test.ts:4,285,286,290
  gui/src/lib/assistant-conversation.ts:265
$ git grep -n 'useAssistantSettledSentence\|selectAssistantSettledSentence' e6fd4d61 -- . ':!.scratch'
  docs/design/layout-and-chrome.md:59,273
  gui/src/components/conversation/live-progress-variants/live-progress-variants.test.tsx:91
  gui/src/components/conversation/live-progress-variants/live-progress-variants.ts:84
  gui/src/components/layout/MainHeader.identity.test.tsx:77
  gui/src/hooks/useAssistantSentence.test.ts:4,296,487,494,497,503,509,529,566
  gui/src/hooks/useAssistantSentence.ts:22,26,41,46
  gui/src/hooks/useAssistantState.ts:3,31,50
$ git grep -nE 'header: true|header = false|header\?: boolean|&& header' e6fd4d61 -- gui/src
gui/src/components/layout/assistant/AssistantIdentity.tsx:52:    header: true,
gui/src/hooks/useAssistantSentence.test.ts:563:      // AssistantIdentity: useAssistantState({ open: true, header: true }).
gui/src/hooks/useAssistantState.ts:40:  header = false,
gui/src/hooks/useAssistantState.ts:45:  header?: boolean;
gui/src/hooks/useAssistantState.ts:50:  const sentence = useAssistantSettledSentence(mainChat.id, running && header);
$ git grep -n 'assistantState(' e6fd4d61 -- gui/src
gui/src/hooks/useAssistantSentence.test.ts:291:    assistantState(
gui/src/hooks/useAssistantState.ts:52:  return assistantState(
gui/src/lib/assistant.test.ts:29:  assistantState({ ...base, ...input }, copy);
gui/src/lib/assistant.test.ts:365:      assistantState({ ...base, hasPendingAskUser: true }, en),
gui/src/lib/assistant.ts:107:export function assistantState(
$ git grep -nwE 'sentence' e6fd4d61 -- gui/src/lib/assistant.ts gui/src/hooks/useAssistantState.ts
gui/src/hooks/useAssistantState.ts:31: * reads the newest settled step's sentence (useAssistantSettledSentence;
gui/src/hooks/useAssistantState.ts:33: * card reads no sentence: running, it says 「正在输入…」
gui/src/hooks/useAssistantState.ts:50:  const sentence = useAssistantSettledSentence(mainChat.id, running && header);
gui/src/hooks/useAssistantState.ts:62:      sentence,
gui/src/lib/assistant.ts:38: *     a subtask's — and nothing at rest. Running, it says the sentence
gui/src/lib/assistant.ts:88:  /** While it runs: the header's sentence, the newest settled step's
gui/src/lib/assistant.ts:90:  sentence?: string | null;
gui/src/lib/assistant.ts:146:        text: input.sentence || copy.sidebar.thinking,
gui/src/lib/assistant.ts:335: * behind the typing bubble and the header's sentence, not in a bubble.
$ git grep -n 'copy.sidebar.thinking' e6fd4d61 -- gui/src
gui/src/components/layout/sidebar/SidebarSessionRow.tsx:192:          : copy.sidebar.thinking
gui/src/lib/assistant.ts:146:        text: input.sentence || copy.sidebar.thinking,
gui/src/lib/subtasks.ts:512:          : copy.sidebar.thinking;
$ git grep -nE 'SettledSentence|useAssistantState' e6fd4d61 -- core cli runner relay remote-protocol ios managed-ga/patches
（无输出，exit 1）
```

`AssistantState.line` 在改之前的读者（工作树上 `grep -rn "state\.line\|\.line?\.\|\.line\.text" gui/src | grep -v test`）：`AssistantIdentity.tsx:59`（顶栏）、`lib/assistant.ts:263-270`（卡片的出错、提问两支，不读 running），`lib/subtasks.ts:518` 是子任务卡片自己的类型，不相干。

#### 3. 挪走的测试

- `LiveProgressVariantsPill.test.tsx`「新's line in the hand-off」→ `gui/src/hooks/useTypingBubbleHandoff.test.tsx`（新文件，整篇 prettier 过）：2 条，断言不变；第二条改名「copies nothing more without a line (a round Core woke it for)」（原名带「现状」）。同文件「the pill」3 条随切换器删掉。
- `live-progress-variants.test.tsx`「新: the line under the dots, in a round you started」→ `MainView.assistant.test.tsx` 新 describe「the line under the dots, in a round you started」：7 条。两条去掉了和现状比的那一句（叫醒的一轮在现状下逐字节相同；工作台、子任务两档相同），其余断言不变；后一条改名「leaves the workbench and a subtask without it」。夹具与取片段的小函数放在这个 describe 里。
- 「新: the header has no second line while it runs」→ `MainHeader.identity.test.tsx` describe「the header has no second line while it runs」：2 条。第一条去掉「塞进那句也照样不画」那一步（读那句的 hook 已删）；第二条从「和现状一样」改成直接断言「等你回复」「出错」。
- 「新: the card says 「正在工作…」, and away from the main chat what the screen would」→ `Sidebar.main-chat.test.tsx` 同名 describe：3 条。六格那条不变；「keeps the running tone and the face」去掉和现状比头像以上那一段，改名「keeps the running tone」（在跑时脸在动、名字加粗由同文件的「lets the face say it runs」守着）；叫醒一轮那条去掉跨档循环，留下最后两句文字断言。为此 `Sidebar.main-chat` 加了 `@/hooks/useAssistantProgress` 的 mock（`card.round`、`card.minutes`，`afterEach` 复位）。
- 随文件删掉、没有挪的：现状 3 条（快照）、「the switcher」1 条（标记清单）。

三处原来断言现状的地方改成新说法：

- `MainView.assistant.test.tsx`：「while it runs, shows only the typing bubble: no steps, no streaming prose, no sentence」→「while it runs, shows the typing bubble and the line under it: no steps, no streaming prose」，加了那一行在、写「正在写回复」两句断言；「shows no clock: neither in the conversation nor in the corner」→「keeps the time to the line under the dots: no clock in the corner」：「14 秒」只出现一次、在那一行的用时里，右下角计时照旧没有。
- `MainHeader.identity.test.tsx`：「says what it is doing while it runs…」→「says nothing while it runs…」：在跑时没有第二行、没有「思考中」；渐隐截断的断言挪到「等你回复」那一行上；删掉 `useAssistantSettledSentence` 的 mock。
- `Sidebar.main-chat.test.tsx`：在跑时 4 处「正在输入…」改成「正在工作…」；叫醒一轮那段同时设 `card.round = "woken"`。

第 2 条跟着改的测试：

- `lib/assistant-conversation.test.ts`：「the header's sentence」9 条删掉，留 1 条「assistantFirstLine」（原来夹在里面的那句断言）。
- `hooks/useAssistantSentence.test.ts`：「the header's sentence」6 条删掉；其中「reads the main chat's cache while another session is on screen」改成读卡片在叫醒一轮里的 `selectAssistantTyping`，挪进 typing 那组，保住「主对话不在屏上时事件照样进它的缓存」这层覆盖。重渲染那条的顶栏读数只剩状态，预期改成你发起的一轮「you send」「run complete」、叫醒的一轮「report row」「run complete」。
- `lib/assistant.test.ts`：顶栏状态那条改成在跑时 line 为 null；卡片「正在输入…」那条只留叫醒一轮的 `typing`，去掉 sentence。
- `lib/assistant-progress.test.ts`：去掉 `assistantSettledSentence(answered)` 那一句；卡片那组 `running` 夹具的 line 改成 null，名字去掉「新」；「is cleaned as the header cleans a summary first」改名。

数目：测试文件 205 → 204，测试 2271 → 2251（切换器删 21：pill 5、variants 16；挪入 14；顶栏那句删 15、补 2）。

#### 4. 两份设计文档的 diff（原样）

`git diff e6fd4d61..HEAD -- docs/design/conversation.md docs/design/layout-and-chrome.md`。空的上下文行去掉了行首那一个空格（不然 `git diff --check` 报尾随空白），其余逐字。

````diff
diff --git a/docs/design/conversation.md b/docs/design/conversation.md
index d5e0eedc..6707729a 100644
--- a/docs/design/conversation.md
+++ b/docs/design/conversation.md
@@ -37,7 +37,7 @@

 **没有 turn 之间的 SoftHr** —— TurnMarker 自带视觉重量 + 上方间距，承担 turn-to-turn 的章节分隔。不再有水平横线。

-助手的对话不画折叠头和步骤区：在跑时只有一行，落定后两步以上的回复，悬停行里有一个「过程」按钮，点开是一张过程卡片，头一行是这一轮的步数、用时与 token，下面每步一行，点一行才展开那一步在本节步骤区里的样子，见「[助手的对话](#助手的对话2026-10-15)」。工作台折叠头点开的是同一张卡片，没有数字行、不设上限，见「过程卡片」的「工作台也用这张卡片」。
+助手的对话不画折叠头和步骤区：在跑时只有三点气泡（你发起的一轮下面还有一行「在做什么 · 用时」），落定后两步以上的回复，悬停行里有一个「过程」按钮，点开是一张过程卡片，头一行是这一轮的步数、用时与 token，下面每步一行，点一行才展开那一步在本节步骤区里的样子，见「[助手的对话](#助手的对话2026-10-15)」。工作台折叠头点开的是同一张卡片，没有数字行、不设上限，见「过程卡片」的「工作台也用这张卡片」。

 #### User vs Agent 三重区分（单侧容器，不是 IM 双侧气泡）

@@ -90,7 +90,7 @@

 #### 助手的对话（2026-10-15）

-内置运行时、主区开着助手（主对话）时，对话画成和一个人的长期 IM，不再是工作台的任务记录（[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 60、66）。JC 在 tauri dev 里比完四件各自可切的试验（票 19），四件都取推荐档（裁决 67）：气泡 C、过程一行、时间居中、滚动贴底；定稿是票 20。随后裁决 68（票 21）把看过程的入口从常显的「N 步 ›」改成悬停行里的一个按钮，步数、用时与 token 收进展开区的第一行，上下文百分比不画，卡片与顶栏在跑时说主区那一行的同一句；裁决 69（票 22）把点开后的步骤区换成一张过程卡片：每步一行，最多 8 行，超出在卡片里滚动；2026-10-19 裁决 107、110（票 55、58）把在跑时分到三处：对话里三点气泡，顶栏写做完的那一步的那句话，卡片写「正在输入…」（见下「在跑时：三点气泡」）。工作台的会话、从助手点开的子任务、外置运行时照本文其余各节；2026-10-16 起两边语法统一（你的话在右、时间居中、一步的回复上面什么都不画），密度各按各的，分界见「[User vs Agent 三重区分](#user-vs-agent-三重区分单侧容器不是-im-双侧气泡)」。门只有一个，`MainView` 的 `isMainChat`；规则在 `lib/assistant-conversation.ts`（过程卡片的在 `lib/assistant-process.ts`），部件在 `components/conversation/AssistantParts.tsx`（三点气泡在 `TypingBubble.tsx`，过程卡片在 `AssistantProcessCard.tsx`，卡片本身 2026-10-16 起与工作台共用 `ProcessCard.tsx`）。
+内置运行时、主区开着助手（主对话）时，对话画成和一个人的长期 IM，不再是工作台的任务记录（[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 60、66）。JC 在 tauri dev 里比完四件各自可切的试验（票 19），四件都取推荐档（裁决 67）：气泡 C、过程一行、时间居中、滚动贴底；定稿是票 20。随后裁决 68（票 21）把看过程的入口从常显的「N 步 ›」改成悬停行里的一个按钮，步数、用时与 token 收进展开区的第一行，上下文百分比不画，卡片与顶栏在跑时说主区那一行的同一句；裁决 69（票 22）把点开后的步骤区换成一张过程卡片：每步一行，最多 8 行，超出在卡片里滚动；2026-10-19 裁决 107、110（票 55、58）把在跑时分到三处（对话里三点气泡，顶栏写做完的那一步的那句话，卡片写「正在输入…」）；2026-10-23 裁决 134、135（票 90、91）收成两处：对话里三点气泡下面加一行「在做什么 · 用时」，卡片只说屏上看不到的，顶栏在跑时留空（见下「在跑时：三点气泡」）。工作台的会话、从助手点开的子任务、外置运行时照本文其余各节；2026-10-16 起两边语法统一（你的话在右、时间居中、一步的回复上面什么都不画），密度各按各的，分界见「[User vs Agent 三重区分](#user-vs-agent-三重区分单侧容器不是-im-双侧气泡)」。门只有一个，`MainView` 的 `isMainChat`；规则在 `lib/assistant-conversation.ts`（过程卡片的在 `lib/assistant-process.ts`，三点下面那一行的在 `lib/assistant-progress.ts`），部件在 `components/conversation/AssistantParts.tsx`（三点气泡在 `TypingBubble.tsx`，过程卡片在 `AssistantProcessCard.tsx`，卡片本身 2026-10-16 起与工作台共用 `ProcessCard.tsx`）。

 **为什么这里是双侧气泡**：工作台的回复是纸上的散文（单侧容器），助手的回复也装进气泡（裁决 66）：「对话是一份文档」正是助手要改掉的（裁决 60：像跟一个真人助理的长期对话），它的回复也短（中位 390 字）。这是密度的差别，不是语法的：你的话在右，2026-10-16 起两边一样（[工作台对话 PRD](../../.scratch/workbench-conversation/PRD.md) 裁决 2）。「不要边框、不要投影、不要小尾巴」照守，助手也守。

@@ -123,25 +123,40 @@
     - 行动条里没有任何数字：token 挪进过程卡片的第一行，上下文百分比不画（见下「上下文与 token」）。隐藏时照旧保留占位（`opacity`），回复下面的 30px 不变（前后都量过：气泡下 6px、行动条高 24px）。
     - **让位**（2026-10-19，[PRD](../../.scratch/main-chat/PRD.md) 裁决 108）：选中这条回复里的字、选中工具条出现时，行动条不出现，过程展开或闪对勾钉住时也一样；工具条收起后照常。工作台的行动条同此。规则见「Message Actions」的「复制入口统一」。
 - **分组间距**：换边两头都是 30px，各由上一条气泡下面那一行占着。它 → 你：回复下面那一行行动条（悬停才出现，隐藏时照旧占位）本来就占着这 30px，就把它当间距，下一条不再加，否则换边一边 50px、一边 20px，对话读成一问一答的一对对。你 → 它（2026-10-19 起，裁决 105；此前 20px，工作台用户消息原来的 `my-5`）：你的气泡下面那一行复制 · 引用 · ⋯ 同样占着 30px，挂在这一行的下外边距里（工作台同一做法），下一样东西自己的上边距并进来、不再叠加。你的两条连着时也是 30px，不再是 4px 的分组（罕见，不另做一套）；它那一边连着的消息之间照旧 4px（IM 的分组）。在跑时对话末尾的三点气泡没有上边距：跟在你的气泡后面是 30px，叫醒那一轮跟在上一条回复的行动条后面也是 30px，接替它的回复（`mt-0`）站在同一个位置，交接时从三点气泡撑开的起点不变（裁决 110；此前那一行灰字有自己的 20px，跟在你的气泡后面并进 30px，叫醒那一轮在行动条下面 20px）。时间条紧接在你的气泡下面时，上面不再加（同紧接在回复下面时）。中间隔着别的东西（时间条、整段展开的运行）时，下一条从 20px 起。规则在 `assistantRowGap`：带行的两种是 `agent-bar` 与 `user-bar`，下一条都是 `mt-0`，时间条读同一个判断 `endsWithActionRow`。连发的一组里气泡照旧四角 12px，不学 Telegram 把挨着组内邻居的角变小（2026-10-16 真机比过 12 / 8 / 6 / 4px，留 12：主对话里几乎凑不成连发，在跑时发的话进队列、隔着回复单独跑，助理一侧又有 30px 的行动条；排队的消息若改成对话里的气泡、连发变常见时重比，[PRD](../../.scratch/telegram-details/PRD.md) 裁决 6 的切档裁决）。量得（1480 窗口）：它的提问气泡到你的回答 46px（中间是候选列表）；带子任务卡片的回复到下一条 173px（卡片和行动条都在其中）。2026-10-19 量得（主区 1220 宽、标准字号，你的气泡底到下一样东西，改前 → 改后；竖向间距与窗口宽无关）：回复 20 → 30px，那一行 20 → 30px，时间条 16 → 30px，它的提问（答完的、正在问的）20 → 30px，你的下一条 4 → 30px，带「展开」的长消息到回复 48 → 30px；回复到你 30px、叫醒那一轮回复到那一行 50px、它的提问到你的回答 46px 不变（那一行即当时在跑时的灰字；裁决 110 起换成三点气泡，叫醒那一轮回复到它 30px）。
-- **在跑时：三点气泡**（2026-10-19，[PRD](../../.scratch/main-chat/PRD.md) 裁决 107、110，票 55、58）：在跑时三样东西分在三处，每样只在一处说：对话里是三点气泡（它在回你），顶栏第二行是做完的那一步的那句话（它在做什么），侧栏卡片写「正在输入…」（它在忙）。历史：2026-10-15 到 10-19 是对话末尾一行灰字（那句话加这一轮的计时，12px `ink-soft`、思考行的扫光；裁决 67、68、100），裁决 103 起它在落地时长成气泡；JC 在 tauri dev 里比过票 55 的两档（现状 / 三点气泡），定三点气泡（裁决 110：「进度 2 是明显更接近我想要的 IM 原生体验」）。
-  - **为什么**（裁决 107 第 3 条）：对普通用户，打字气泡读作「它在回我」，是 IM 里人人认得的信号；对话里只放说出口的话与三个点，过程细节进顶栏、想看的人看，列表行只说状态，每样东西只在一处说（合裁决 87「只说一次」的本意，改它「顶栏只写短状态」的字面）。裁决 103 第 4 条否掉三点气泡的一条理由（「§2.7 的扫光豁免就是 08-12 真机把三点换掉的」）站不住：§2.7 把三点 working 指示列为允许的约定俗成指示，08-12 换掉的是工作台思考行上与 0.1 秒计时并列的第三个信号；这里计时不在对话里，三点是唯一的在忙信号（[foundations](./foundations.md) §2.7）。
-  - **对话里**：你发起的一轮，从你发出起（页面一标在跑就算，不等第一个事件），它那一边末尾就是三点气泡，直到回复或它的提问到了、由它撑开（见下「交接」）。不列步骤、不显示思考预览、不流式显示正文（打字机与 markdown 管线拿到空串，不白做每个字的活），也没有计时与右下角计时。它在问你时不画（它在等你，不在忙），提问一到就收起，不等这一轮关掉；中止、出错、停在步数上限照工作台整段平铺（见下「没有回答的运行」），三点气泡直接消失。
-  - **叫醒的一轮**（从 Core 写的叫醒行开始的一轮，`lib/subtasks.ts` 的 `inReportRound`）：它开始写字才有三点气泡，之前对话里什么都不画；写字停下（出现工具派发标记）就收起，再写再出现，不加「出现后留着」的规则（IM 里对方打打停停也这样）。「在写字」是确定的判断，不猜（裁决 104 的 `assistantWriting`）：这一步的原始流（`inFlightContent`）里没有没闭合的 `<thinking>`、还没出现工具派发标记（`modelReplyEnd`），清洗后（`cleanPartialContent`）有字。不出声的一轮（`<no-reply/>` 被清洗扣住、没有字）全程什么都不画。代价（裁决 107 第 4 条）：叫醒的一轮先写旁白再调工具时，三点会出现、消失、再出现。
+- **在跑时：三点气泡**（2026-10-19，[PRD](../../.scratch/main-chat/PRD.md) 裁决 107、110，票 55、58；2026-10-23 裁决 134、135，票 90、91）：在跑时说话的只有两处：对话里是三点气泡（它在回你），你发起的一轮三点下面还有一行小字「{在做什么} · {用时}」（它在做什么、做了多久，见下「三点下面那一行」）；侧栏卡片只说屏上看不到的那部分（见下「卡片只说屏上看不到的」）。顶栏身份行在跑时没有第二行，同静止，只说要你处理的状态（见下「顶栏在跑时留空」）。历史：2026-10-15 到 10-19 是对话末尾一行灰字（那句话加这一轮的计时，12px `ink-soft`、思考行的扫光；裁决 67、68、100），裁决 103 起它在落地时长成气泡；JC 在 tauri dev 里比过票 55 的两档（现状 / 三点气泡），定三点气泡（裁决 110：「进度 2 是明显更接近我想要的 IM 原生体验」）。10-19 起三样东西分在三处：对话里只有三点；顶栏第二行写做完的那一步的那句话（有旁白写旁白，没有写它的 summary，裁决 100），不计时；卡片写「正在输入…」，主对话开着、没开着都一样（裁决 107、110）。10-23 v0.7.0 发布后用户反馈：安排了一件耗时的事，只看到对话里的三个点和侧栏长时间的「正在输入」，以为软件卡死了，等了好几分钟，顶栏那句没注意到。裁决 134 把进展挪到眼前、收成两处，票 90 上切换器与现状在真机上比，JC 定「新」（裁决 135：「选『新』，体验会好很多」），票 91 写成唯一画法，删掉顶栏那句（`assistantSettledSentence` 一路）。
+  - **为什么**：三点气泡本身（裁决 107 第 3 条）：对普通用户，打字气泡读作「它在回我」，是 IM 里人人认得的信号；对话里只放说出口的话与三个点（你发起的一轮加下面那一行），不列步骤。进展为什么放在三点下面（裁决 134 第 1 条）：用户发出后对话贴底，眼睛在输入框正上方的三点上；顶栏那句在主区左上角、11px，只在一步做完时换（本机一轮 NBA 预测最长的一步 40 秒里一字不变），在用户不看的地方，做醒目也没用。三点循环只证明界面没死，不证明活在推进；「正在输入」挂几分钟违反 IM 常识（裁决 104 第 3 条当时就写过）。裁决 107 不计时的前提「主对话回合短（本机 12 轮最长 31 秒，重活派给子任务）」也不成立了：10-20 到 10-23 本机主对话你发起的 16 轮里 14 轮调了工具，中位 31.5 秒，最长 109 秒；派不派子任务靠模型开工前判断，查着查着变长的它预判不到。那一行要做三件事（第 2 条）：没卡住（每秒在变的用时）、在推进（每步在变的一句）、好读字少；只有用时只证明活着、不给进展。§2.7：裁决 103 第 4 条否掉三点气泡的一条理由（「§2.7 的扫光豁免就是 08-12 真机把三点换掉的」）站不住：§2.7 把三点 working 指示列为允许的约定俗成指示，08-12 换掉的是工作台思考行上与 0.1 秒计时、扫光并列的第三个信号；这里是两样（三点，与下面那行整秒的用时），不扫光（[foundations](./foundations.md) §2.7）。三点加一行仍是新组合，列在下面「代价」里真机留意。
+  - **对话里**：你发起的一轮，从你发出起（页面一标在跑就算，不等第一个事件），它那一边末尾就是三点气泡，下面一行「在做什么 · 用时」（见下「三点下面那一行」），直到回复或它的提问到了、由它撑开（见下「交接」）。不列步骤、不显示思考预览、不流式显示正文（打字机与 markdown 管线拿到空串，不白做每个字的活），也没有右下角计时：用时在三点下面那一行里。它在问你时不画（它在等你，不在忙），提问一到就收起，不等这一轮关掉；中止、出错、停在步数上限照工作台整段平铺（见下「没有回答的运行」），三点气泡连同下面那一行直接消失。
+  - **叫醒的一轮**（从 Core 写的叫醒行开始的一轮，`lib/subtasks.ts` 的 `inReportRound`）：它开始写字才有三点气泡，之前对话里什么都不画；三点下面也不画那一行（没人在等它，裁决 134 第 2 条）；写字停下（出现工具派发标记）就收起，再写再出现，不加「出现后留着」的规则（IM 里对方打打停停也这样）。「在写字」是确定的判断，不猜（裁决 104 的 `assistantWriting`）：这一步的原始流（`inFlightContent`）里没有没闭合的 `<thinking>`、还没出现工具派发标记（`modelReplyEnd`），清洗后（`cleanPartialContent`）有字。不出声的一轮（`<no-reply/>` 被清洗扣住、没有字）全程什么都不画。代价（裁决 107 第 4 条）：叫醒的一轮先写旁白再调工具时，三点会出现、消失、再出现。
   - **样子**：`AssistantBubble` 同一个底色（`bg-assistant-tint`）、12px 圆角、10 / 14px 内边距，一行高（正文字号乘气泡的行高，与一行字的回复同高：标准字号 54 × 43.25px），宽度只包住三个点。三个点 `ink-muted`，是 `LiveDots` 的点放大一倍（点 6px、间距 4px，按 em 写，跟着 ⌘= / ⌘− 的字号档变），节奏照 `live-dot`（1.4 秒一轮、依次错开 0.16 秒的明暗，iMessage 的样子）。它没有上边距，站在上面那一行下面：你的气泡下面那一行复制 · 引用 · ⋯、叫醒那一轮上一条回复的行动条，都已经留了 30px（接替它的回复由 `assistantRowGap` 给 `mt-0`），所以回复撑开时站在同一个位置。读屏：`role="status"`，念「Galley 正在输入」（`copy.assistant.typingLabel`）。减少动态下三个点静止（`live-dot` 自己的规则）。部件 `components/conversation/TypingBubble.tsx`；画不画在 `lib/assistant-conversation.ts` 的 `typingBubbleShown`，「在打字」的判断 `assistantTyping` 与卡片共用。
   - **交接：回复从三点气泡撑开**（2026-10-19，裁决 103，票 51 起；裁决 110 起点换成三点气泡，票 55、58；票 51 之前是那一行当即消失、回复整条瞬间出现）：这一轮有了收口的回复（最后一步是回答），三点气泡当即让位，不等 `run_complete`；它问你时也让位。接替它的气泡（回复，或它的提问）从三点气泡的位置撑开，只放一次：
-    - **怎么长**：气泡的底色（`bg-assistant-tint`，四角同气泡）从三点气泡的框展开到气泡的尺寸，用 `clip-path`。底色相同，所以不留离场的气泡拷贝：只有三个点的一份拷贝在原位淡出（接着原来的相位走，不从头跳），气泡里的字淡入。展开 `--motion-slow`，每段都是 `--ease-pop`。不用启发式猜流出的那段是不是回复，所以长回复要等写完才整条出现（已知代价）。叫醒的一轮落地时屏上没有三点（没流式，或刚被工具步收起），就从气泡自己左上角一个三点气泡大小的框长出来。
+    - **怎么长**：气泡的底色（`bg-assistant-tint`，四角同气泡）从三点气泡的框展开到气泡的尺寸，用 `clip-path`。底色相同，所以不留离场的气泡拷贝：只有三个点的一份拷贝在原位淡出（接着原来的相位走，不从头跳），三点下面那一行也是一份拷贝在原位、同一段淡出（裁决 134），气泡里的字淡入。展开 `--motion-slow`，每段都是 `--ease-pop`。不用启发式猜流出的那段是不是回复，所以长回复要等写完才整条出现（已知代价）。叫醒的一轮落地时屏上没有三点（没流式，或刚被工具步收起），就从气泡自己左上角一个三点气泡大小的框长出来。
     - **淡入淡出的分段**：三个点用 `--motion-fast` 淡出；字从这段的一半开始淡入，到展开结束。`--ease-pop` 前段很陡，到 60ms（240 的四分之一）点只剩 3%、底色已展开 83%：点和字不会同时出现（字进来的地方就是点站的地方），底色也不会空着太久。字等到展开结束才进来的那一案，60–130ms 是一个空的灰框，票 51 自查帧条里看着像闪了一下，没选。
     - **气泡下面跟着的东西**（子任务、待办、提醒卡片，提问的候选，行动条；汇报那一轮第一条回复上方新出现的时间条）与气泡里的字同一段淡入，不比气泡先冒出来。行动条本身的透明度是它的悬停显示，淡入的是它里面的按钮，悬停规则不变。
-    - **版面从第一帧起就是最终的**：只动 `clip-path`、透明度与 `transform`，不动画高宽与外边距，跟随与「回到底部」读的是真实高度。三个点离开时是它们最后一帧的一份拷贝，放在原来的位置、不占版面。
+    - **版面从第一帧起就是最终的**：只动 `clip-path`、透明度与 `transform`，不动画高宽与外边距，跟随与「回到底部」读的是真实高度。三个点和下面那一行离开时是各自最后一帧的一份拷贝，放在原来的位置、不占版面。
     - **跟随同步**：落地时在跟随（`atBottom`），这一次跟随不再瞬时钉底，用 `animateScroll` 的定时模式（`ScrollTiming`：同一个时长、同一条 `--ease-pop` 曲线，从第一帧起算，整段都动画、没有远跳，中途改目标不改结束时刻）走到 `assistantFollowTop` 算出的同一个目标，滚动与展开同一个时钟；对话不满一屏、没有可滚的时候，换成把对话栏里的内容按回原处、沿同一条曲线放上去（见下）。短回复读作贴着输入框往上撑出来：气泡底边留在三点气泡附近，只让出行动条的 30px，顶边往上走。长回复一边往上走一边往下展开，开头停在视口顶部下方 32px，跟随照规则放开，「回到底部」照常出现（与瞬时停住时一样，一开始就出现）。滚动途中尾部又长了（代码高亮、卡片晚到）就改瞄新目标，不写 `scrollTop`。用户中途滚动就放手（`animateScroll` 的中途接手）；往回翻着、没在跟随时不滚，气泡在原地撑开。
     - **对话不满一屏时**（贴底的 `mt-auto`）：内容往上挪的不是滚动而是版面，气泡落地那一刻上面的消息就已经在新位置。这时把对话栏里的内容先按回原处、沿同一条曲线放上去（`transform`；栏只在这 240ms 里 `overflow: clip`，按下去的那截不算进滚动区，不会闪出滚动条），效果与滚动时相同。
-    - **减少动态**：只淡不移（[foundations](./foundations.md) §2.7）：三个点淡出、气泡整个淡入，不展开、不平滑滚动、不按住版面，跟随照旧瞬时。
-    - **只放在眼前发生的那次交接上**：上一帧这一轮在跑、在对话末尾（不在冷启动恢复中）、同一个会话，这一帧它的位置交给了气泡才放；叫醒的一轮三点不在屏上也算（从气泡左上角长）。切会话、整页重载、从工作台回到主对话（`MainView` 按会话重挂载，从现状起）、翻历史、分页加载、删除后放回都不放；停止、出错没有气泡接替，三点气泡直接消失；不出声的回复（`<no-reply/>`）什么都不长。回复只剩派活标签、没有气泡时也不长（三点消失，卡片照旧直接出现）。三点气泡在视口外时照样放，看不见。
+    - **减少动态**：只淡不移（[foundations](./foundations.md) §2.7）：三个点和下面那一行淡出、气泡整个淡入，不展开、不平滑滚动、不按住版面，跟随照旧瞬时。
+    - **只放在眼前发生的那次交接上**：上一帧这一轮在跑、在对话末尾（不在冷启动恢复中）、同一个会话，这一帧它的位置交给了气泡才放；叫醒的一轮三点不在屏上也算（从气泡左上角长）。切会话、整页重载、从工作台回到主对话（`MainView` 按会话重挂载，从现状起）、翻历史、分页加载、删除后放回都不放；停止、出错没有气泡接替，三点气泡连同下面那一行直接消失；不出声的回复（`<no-reply/>`）什么都不长。回复只剩派活标签、没有气泡时也不长（三点消失，卡片照旧直接出现）。三点气泡在视口外时照样放，看不见。
     - **代码**：放不放在 `lib/typing-bubble-handoff.ts` 的 `typingBubbleHandoff`（时长、曲线从 token 读，同文件），页面上的部分在 `hooks/useTypingBubbleHandoff.ts`，跟随在 `useStickyScroll` 的 `landingTick`。工作台、从助手点开的子任务、外置运行时没有三点气泡，逐像素不变（票 51、55、58 的自查帧与改前逐帧相减为零）。
-  - **顶栏写做完的那一步的那句话**（裁决 107、110）：在跑时顶栏身份行的第二行写已经做完的步里最新那一句：从你最后一条消息（叫醒的一轮从叫醒行）之后往回找第一个有字的步，有旁白写旁白，没有旁白写它的 summary，同一套清洗；收口的回答那一步不算（它落地成气泡，接着就是 `run_complete`）。还没有做完的步就写「思考中」；你答完它的提问后回到「思考中」：提问前写的已经过时。**不取正在流出的文字**，免得回复落地前先在顶栏剧透它的第一句；这一句只在一步落定时变，选择器只返回字符串，流出 chunk 时顶栏不重渲染。**不计时**（裁决 107 第 3 条）：IM 的标题栏不计时；挪到顶栏会在余光里每秒跳；主对话的回合短（本机 12 轮最长 31 秒，重活派给子任务）；三点在跳、顶栏每做完一步换一句，已经说明在推进；用时在过程卡片的第一行。代价：某一步卡很久时分不清慢与卡，退路记在 [deferred](../devlog/deferred.md)「顶栏在跑超过 1 分钟接用时」。太长就截断（渐隐），悬停给全文；截断、颜色与等你回复、出错时写什么见 [layout-and-chrome](./layout-and-chrome.md) §4.1「开着助手时是身份行」。规则在 `assistantSettledSentence`。
-    - **没有旁白时用 summary**（2026-10-19，裁决 100，票 47；部分推翻裁决 68 第 4 条的理由；当时用在对话末尾那一行，裁决 110 起只在顶栏）：原来只读旁白，68 第 4 条的理由是「summary 是 agent 的工作记忆，不写给读者」（见下「[不用 `AgentTurn.summary`](#hover-tooltip-的内容契约)」）。它假定每步都有旁白，可主力模型多半不写：gpt-6.1-sol 10 月有工具步的 29 轮里，24 轮所有工具步都没写旁白，整轮只剩「思考中」（JC 10-19 建喝水提醒时就是这样）。summary 跑完后本来就在过程卡片里给读者看（每步那一句，票 22），顶栏这一句与卡片里那一步的那句同源。最新的一步优先：第 1 步写了旁白、第 2 步只写 summary 时，换成第 2 步的 summary，不停在旧旁白上（另一案「整轮没有旁白才用 summary」没选，就是因为会停在旧话上）。代价：summary 是工作记录的口吻（「本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。」），裁决 110 列为日常使用里留意的翻车点。
-    - **summary 的清洗**同旁白（`assistantFirstLine`：取第一行，去块记号与 markdown，`cleanSessionSummary` 修协议标签与 GA 的「...」省略）。runner 送来的已经干净、只有一行（GA 取 `<summary>` 里面的字、把换行去掉；`workbench_bridge._clean_turn_summary`），不会带 `<summary>` 标签残留；回合协议错误的 summary（runner 的固定标记，或开头就是漏出的工具调用标记）不当这一句，同没有 summary 的步。
-  - **卡片写「正在输入…」**（裁决 107、110，推翻裁决 104 的「开着时卡片在跑也只写最后一句」）：在跑时侧栏助手卡片的第二行写「正在输入…」，主对话开着、没开着都一样；叫醒的一轮跟着三点走：三点在时写「正在输入…」，不在时是最后一句（跳过在跑这一轮的工具步），头像那张脸照旧在干活（减少动态下是转圈，2026-10-20 票 67）。代价：你不在主对话时，卡片不再说那句过程（点卡片进主对话看顶栏）。见 [layout-and-chrome](./layout-and-chrome.md) §4.2「助手卡片」。
+  - **三点下面那一行**（2026-10-23，裁决 134 第 2 条、135；票 90 做，票 91 定稿）：你发起的一轮，从你发出起与三点同时在，没有门槛，直到三点让位。部件是 `TypingBubble.tsx` 的 `ProgressLine`，`MainView` 给它在做什么与这一轮的计时。
+    - **写法**：「{在做什么} · {用时}」，一行：在三点气泡下面 6px（`mt-1.5`），左缘对齐气泡，18px 高，最宽同回复气泡（`ASSISTANT_BUBBLE_MAX`）；12px `ink-soft`、等宽数字，不扫光、不动。在做什么太长就渐隐截断（`truncate-fade`），悬停给全文（`syncTruncatedTitle`）；「 · 」和用时永远不截。它在三点那一行（`role="status"`）里面，跟随到底与交接都把它当三点的一部分。
+    - **在做什么**（`lib/assistant-progress.ts` 的 `assistantDoing`）：只看这一段，从你最后一条消息起，你答完它的提问则从答完起；按优先级取第一条：一，它正在写字（`assistantWriting`），写「正在写回复」；二，这一步的原始流里已经出现工具派发标记、标记前有闭合的 `<summary>`（`streamedStepSummary`），写这一步 summary 的后半句；三，这一段里最新一个调了工具、已经落定的步（收口的回答那一步不算）有能说的 summary，写它的后半句，所以两步之间留着上一句，一步落定后说的与它派发时同一句；四，都没有就写「思考中」：开头到第一次派出工具，以及你答完它的提问之后。没有派发就不换句，所以收口那一步的 summary 不上屏，回复的结论不会先被剧透。
+    - **后半句**（`assistantProgressHalf`）：GA 的 summary 是「上次结果的新信息 + 本次意图」（`managed-ga/code/llmcore.py:1162`、`:1429`），本次意图在后面。先照一步的第一行清洗（`assistantFirstLine`：取第一行，去块记号与 markdown，`cleanSessionSummary` 修协议标签与 GA 的「...」省略；回合协议错误的 summary 当作没有），再按**最后一个**「；」或「;」切开取后面那段，去掉两头空白和末尾的「。」「.」；没有分隔、或分隔后面是空的，就用整句，同样去掉末尾的句号与分隔符。不再往下截（不在逗号处切），长的交给渐隐截断。流里的 summary 照 GA 自己的读法取（去掉推理块、代码围栏与闭合的 `<thinking>`，取第一个 `<summary>`，去换行，90 字以上照 GA 的 `smart_format` 缩成前 40 … 后 40），所以这一步落定后说的还是同一句；没闭合的 `<thinking>` 里的 summary 不算。为什么用 summary：库里主对话的工具步 50 个都有 summary、0 个有旁白；后半句中位 20 字、p90 30 字；GA 先写 summary 再调工具，派发那一刻就读得到，说的是正在做的事，比顶栏原来「做完的那一步」早一步（裁决 134 第 2 条）。
+    - **用时**：这一轮开跑起的整秒，各段相加、等你回答的时间不算，同工作台右下角计时（`RunElapsedHud`）与过程卡片的「用时」同一个数、同一套字（这一段的开跑时刻加 `liveRunElapsedBaseMs`；`assistantProgressElapsed`）：1 秒起显示，「12 秒」「1 分 12 秒」；不到 1 秒、或还没有开跑时刻时只写在做什么。计时器每秒写一次，只重渲染用时那一小段，渲染期不读时钟。
+    - **叫醒的一轮不画**：没人在等它；三点照旧只在它写字时出现（见上「叫醒的一轮」）。它在问你时三点不画，这一行也不画。
+    - **读屏**：这一行在三点那一行的 `status` 区里，在做什么换了会念出来；用时每秒在跳，`aria-hidden`，不念。
+    - **交接**：回复或它的提问接替三点时，这一行随三点淡出：一份拷贝在原位、不占版面，同一段时长与曲线（`--motion-fast`、`--ease-pop`），对话不满一屏时跟着内容一起放上去（`hooks/useTypingBubbleHandoff.ts`）；停止、出错时随三点直接消失（见上「交接」）。
+  - **顶栏在跑时留空**（裁决 134 第 3 条，推翻裁决 107、110 的「顶栏写做完的那一步的那句话」）：身份行在跑时没有第二行，同静止；等你回复、出错、子任务在问你或出错照旧写。身份行静止时本来就是一行，开跑时不跳。顶栏从此只说要你处理的状态。见 [layout-and-chrome](./layout-and-chrome.md) §4.1「开着助手时是身份行」。
+  - **卡片只说屏上看不到的**（裁决 134 第 4 条，推翻裁决 107、110 的「卡片在跑时写『正在输入…』，开着没开着都一样」）：你发起的一轮在跑时，侧栏助手卡片的第二行：
+
+    | 你发起的一轮 | 主对话在屏上 | 不在屏上（在工作台、在它的子任务里） |
+    |---|---|---|
+    | 它在写字（`assistantWriting`） | 「正在工作…」 | 「正在输入…」 |
+    | 其余，不到 1 分钟 | 「正在工作…」 | 「正在工作…」 |
+    | 其余，满 1 分钟起 | 「正在工作…」 | 「正在工作 · N 分钟」 |
+
+    主对话在屏上时全程「正在工作…」，最后几秒也不翻成「正在输入…」：三点和那一行就在眼前。不在屏上时它在写字写「正在输入…」（Telegram 的会话列表也这样），其余「正在工作…」，满 1 分钟起接整分钟数（同那一行的用时，向下取整，按分钟不按秒跳；计时器只在整分钟时让卡片重渲染，`hooks/useAssistantProgress.ts` 的 `useAssistantRunMinutes`）。一句话：卡片只替你说屏上看不到的那部分。「在屏上」是卡片的 `open`，与待办面板的 `mainChatOnScreen` 同口径（裁决 104 起如此）：主区是主对话就算，不看盖在上面的设置或对话框。叫醒的一轮照旧跟着三点走：三点在时写「正在输入…」，不在时是最后一句（跳过在跑这一轮的工具步，`lastVisibleMessage` 的 `liveRound`）；头像那张脸照旧在干活（减少动态下是转圈，2026-10-20 票 67）。用词：「在忙」在 IM 里是「忙碌、顾不上你」，读反了；「正在工作…」与「正在输入…」同一句式；不写「正在工作中」（两次进行时，界面里没有这种写法）。规则在 `lib/assistant.ts` 的 `assistantCardLine`（`workingLine`），这一轮是谁发起的、在不在写字在 `useAssistantRound`。见 [layout-and-chrome](./layout-and-chrome.md) §4.2「助手卡片」。
+  - **代价**（裁决 135 第 3 条，日常使用里看，碰到再议）：一是它向你提问时，提问那一步也算派出工具，问题到来前那一下小字会写那一步的后半句（「我问用户…」一类），交接给问题时淡出的也是这句；二是设置页盖着主对话时卡片仍算主对话在屏上，看不到「正在输入…」与分钟数；三是 summary 在两种流（原生工具调用、GA 文本协议）里都先于派发标记，是读 GA 代码推出的（`managed-ga/code/agent_loop.py` 在整段回复流完之后才写派发标记），没从真流抓过。裁决 134 第 7 条另记的真机留意：三点加一行是新组合（裁决 110「更接近 IM 原生」比的是纯三点），一直跳的用时也可能放大等待感，summary 偶有内部用语（「提醒命令」「提醒规则已确认」），它在调工具前写旁白时「正在写回复」会闪一下（库里 0/50），小字约每十来秒换一句。嫌小字长或像工作记录时的升级路线（主对话入口层让模型调工具前写一句不超过 15 字的状态，走旁白通道）见裁决 134 第 6 条。
 - **过程（落定后）**：
   - **落定后**：回复下面平时什么都不常显（裁决 68，推翻裁决 67 第 2 条的「常显」）。两步以上的回复，悬停时行动条在保存后面、「⋯」前面多一个「过程」按钮（裁决 68 时它在最后；裁决 99 起「⋯」收尾，见上「行动条」）：与复制、引用、保存同一族（`ActionChip`：24px 见方、`ink-muted`、悬停 `bg-hover` 提墨、`tabIndex={-1}`），图标默认 Phosphor `Footprints`，与 `ListChecks` 二选一由 JC 真机验收时定，认不出就退回文字按钮（输入框 ＋ 菜单就因「不带字的图标要悬停才认得」改过文字）。悬停提示用折叠头现有的「展开过程 / 收起过程」，不带数字。一步就答完的回复只有复制、引用、保存与「⋯」。
     - **点开**在行动条下面原地展开这一轮的过程卡片（见下「过程卡片」），再点收起，动画同 `ExpandSection`。展开期间过程按钮呈按下态：常显 `bg-hover` 底、墨提到 `ink`；不换成对勾，对勾是复制、保存的「已完成」。整条行动条跟着常显，同「已复制」闪现期间的做法；只钉住按钮不行：复制、引用、保存透明后仍占位，按钮会悬在右边。收起后回到悬停才出现。
@@ -234,7 +249,7 @@
 单 dot 的 hover tooltip 是**两行**（2026-08-03 起）：`序号 │ 提问` + 下方缩进对齐的**回答预览**。dot 数量不变——加第二行补的是**辨识**（"这一问我当时得到了什么"），不是导航；用增加标记来解决 tooltip 的信息量问题会把密度翻倍去换一个它解决不了的东西。

 - 回答预览 = final answer 的**首个正文行**（跳过空行与 ATX 标题），再走与提问同一套 `buildPreview`（折叠空白、剥首个 markdown 标记、50 字预截）。跳标题是因为长回答高频以 `## 结论` 开头，预览成"结论"两字等于零信息。规则只跳标题、不跳代码围栏或列表标记——一句话能说完的规则才可预测。
-- **不用 `AgentTurn.summary`**：它是 agent 的工作记忆而非给读者的概括。managed runtime 的 prompt 要的是"上次工具调用结果产生的新信息 + 本次工具调用意图"，GA 直接把它 append 进自己的 `history_info`；它指向下一步工具调用，而最终答案轮是 `no_tool`，没有"本次意图"可指，框架失配。预览应当是用户点进去会看到的东西的缩略图，那就是 final answer 本身。Sidebar 显示 summary 不构成同源理由——Sidebar 那一格的语义是 session 的**进行状态**（`第 N 步 · …`），不是某次问答的内容。**唯一的例外是兜底**（2026-10-16，[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 89）：收尾那一轮除了标签什么都没写（没有 `<no-reply/>`、没有 `<subtask>`），话全写进了 `<summary>` 时，summary 当作这一轮的回答显示，否则什么都看不到；票 36 的真模型评测 95 次里出现过 4 次。规则在 `isSummaryOnlyReply` 与 `buildAgentTurn`，工作台与助理的对话同一条。**助手对话在跑时顶栏那一句**另说（2026-10-19，裁决 100；当时在对话末尾那一行，裁决 110 起挪到顶栏）：那一句说的是进行中的状态，不是哪次问答的内容；一步没写旁白时写这一步的 summary，见「助手的对话」的「在跑时：三点气泡」。裁决 68 第 4 条曾援引本条只读旁白，裁决 100 部分推翻了这条理由；这里的 tooltip 预览不变。
+- **不用 `AgentTurn.summary`**：它是 agent 的工作记忆而非给读者的概括。managed runtime 的 prompt 要的是"上次工具调用结果产生的新信息 + 本次工具调用意图"，GA 直接把它 append 进自己的 `history_info`；它指向下一步工具调用，而最终答案轮是 `no_tool`，没有"本次意图"可指，框架失配。预览应当是用户点进去会看到的东西的缩略图，那就是 final answer 本身。Sidebar 显示 summary 不构成同源理由——Sidebar 那一格的语义是 session 的**进行状态**（`第 N 步 · …`），不是某次问答的内容。**唯一的例外是兜底**（2026-10-16，[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 89）：收尾那一轮除了标签什么都没写（没有 `<no-reply/>`、没有 `<subtask>`），话全写进了 `<summary>` 时，summary 当作这一轮的回答显示，否则什么都看不到；票 36 的真模型评测 95 次里出现过 4 次。规则在 `isSummaryOnlyReply` 与 `buildAgentTurn`，工作台与助理的对话同一条。**助手对话在跑时三点下面那一行**另说（2026-10-23，裁决 134、135；此前 10-19 裁决 100 起是顶栏那一句、一步没写旁白时写它的 summary，更早在对话末尾那一行）：那一行说的是进行中的状态，不是哪次问答的内容；写的是这一步 summary 的后半句（本次意图），见「助手的对话」的「在跑时：三点气泡」。裁决 68 第 4 条曾援引本条只读旁白，裁决 100 部分推翻了这条理由；这里的 tooltip 预览不变。
 - 配对规则：取该提问与下一条提问之间**最后一个** `finalAnswer !== null` 的 agent turn。`finalAnswer` 每个 `turn_end` 都会算（不只最终轮），中间工具轮偶尔会漏出散话；取最后一个在正常情况即真正的收口轮，在 run 被中断的情况下也还留得下预览。
 - 回答缺席（仍在进行 / run 中断 / 首行无可预览正文）→ **不渲染第二行**，盒子缩回单行，不留幽灵空行。
 - 两行的层级差**拉满 ink 三档中的两档**：盒子设 `text-ink`（提问继承），回答行覆盖为 `text-ink-muted`（色阶底）。字号、字数预算两行相同。先试过 `text-ink-soft` + `text-ink-muted` 的一档差，实机上"除了稍微淡一点点并没有拉开差距"——两行在结构上完全并列（同字号、同起始列、同 50 字预算、均匀行距），一档色差压不住这种对等。修法在**加大反差**与**缩小回答**（降字号 / 砍字数）之间选了前者：后者要把 CJK 推向 10.5px 的可读边界，而 tooltip 的正文字号只有一档余量。
@@ -723,7 +738,7 @@ Conversation 主区是 `overflow-y-auto` 的列。用户提交新消息时**不*

 #### Streaming generation（流式 partial 渲染）

-助手的对话不流式显示正文，也没有思考行、思考预览与右下角计时：在跑时对话里只有三点气泡，见「[助手的对话](#助手的对话2026-10-15)」。本节与下面的 Thinking Placeholder、Live Thinking Preview 讲工作台的对话。
+助手的对话不流式显示正文，也没有思考行、思考预览与右下角计时：在跑时对话里只有三点气泡（你发起的一轮下面一行「在做什么 · 用时」），见「[助手的对话](#助手的对话2026-10-15)」。本节与下面的 Thinking Placeholder、Live Thinking Preview 讲工作台的对话。

 Bridge 订阅 GA 的 `display_queue`（`agentmain.put_task` 返回），把每个 partial chunk 通过 IPC `turn_progress` event 推给 desktop。这里的流式单位是 GA display_queue chunk，不是 token-level 合约；desktop 累积成 `inFlightContent`，跑 `cleanPartialContent` strip 掉 GA 内部 tag 后用 `MarkdownView` 实时渲染，并可用本地 typewriter 平滑 chunk 间隔。

@@ -773,7 +788,7 @@ Bridge 订阅 GA 的 `display_queue`（`agentmain.put_task` 返回），把每
   - `0–59.9s` → `思考中 · 12.3 秒`（状态文字也可能是「正在回答…」或这一步的说明，见下「状态行优先级」）
   - `60s+` → `思考中 · 1 分 23 秒`
   - 整个运行的用时另在对话右下角的浮起计时（`RunElapsedHud`）：`工作中 1 分 23 秒`，整秒，没有动画。
-  - 助手的对话没有这一行和右下角计时，在跑时哪里都不计时：对话里只有三点气泡（`TypingBubble.tsx`），顶栏写做完的那一步的那句话，用时在过程卡片的第一行，见「[助手的对话](#助手的对话2026-10-15)」。2026-10-15 到 10-19 对话末尾那一行灰字过 3 秒接这一轮的整秒用时，裁决 110 随那一行去掉；顶栏超过 1 分钟再接用时的退路见 [deferred](../devlog/deferred.md)「顶栏在跑超过 1 分钟接用时」。
+  - 助手的对话没有这一行和右下角计时：你发起的一轮，用时在三点气泡下面那一行（「{在做什么} · {用时}」，整秒，1 秒起，与右下角计时同一个数、同一套字，各段相加、等你回答的时间不算；`TypingBubble.tsx`），落定后在过程卡片的第一行，见「[助手的对话](#助手的对话2026-10-15)」的「在跑时：三点气泡」（2026-10-23 裁决 134、135）。历史：2026-10-15 到 10-19 对话末尾那一行灰字过 3 秒接这一轮的整秒用时，裁决 110 随那一行去掉，此后在跑时哪里都不计时；[deferred](../devlog/deferred.md)「顶栏在跑超过 1 分钟接用时」作废：用户不看顶栏，用时挪进对话。

 历史设计（已废弃）：原本占位走 ThinkingSummary callout（bg-surface + 左竖条 + 💭 emoji），跟正式 ThinkingSummary 块视觉同款。问题是 callout chrome 是给"GA 真实 emit `<thinking>` 多段内容"设计的容器，套在 10 字占位上视觉权重严重失衡。2026-05-14 改成 TurnMarker thinking 态。

diff --git a/docs/design/layout-and-chrome.md b/docs/design/layout-and-chrome.md
index e489f3aa..e009780f 100644
--- a/docs/design/layout-and-chrome.md
+++ b/docs/design/layout-and-chrome.md
@@ -56,7 +56,7 @@
 **MainHeader（Main 栏顶）** —— `[ 标题 ▾  ··· drag ···  状态簇 │ 工具簇 │ (Win 窗口控制) ]`
 - session title 左对齐贴 main 栏左 gutter（**不对齐居中的对话列**——对话列宽随 compact/wide 变，对齐它会让标题左右跳）。title 属于「当前对话」，放在对话区上方、视线最先到达处。本栏左侧无 OS chrome 保留区（例外：有主对话且侧栏收起时，标题前的侧栏开关替红绿灯让位，见下「侧栏开关只在有主对话时出现」）。
 - **Session title menu**：有 active session 时 title + `CaretDown` 是一个按钮，打开 session-scoped 菜单：「查找聊天记录… ⌘F」「重命名」，分隔线，「重新注入工具」「桌面宠物」（查找是 2026-10-15 票 28 加的，见下「标题菜单里的查找与重置」）。空状态渲染 italic muted "新对话"，不可点。Rename 进入 inline edit（Enter 提交 / Esc 取消）。
-- **开着助手时是身份行**（2026-10-14，主聊天票 18，裁决 64）：主对话开着时，标题的位置换成助手的身份行：28px 头像（应用图标裁成圆、加 1px 内描边，与侧栏助手卡片同一张图，2026-10-15 裁决 70，见 §4.2「有主对话时」助手卡片的「头像」；**一律静止**：侧栏卡片上那张会动，这里不动、不挂徽标，它在做什么由下面那行字说，主对话开着时对话里还有三点气泡，同一时刻只有一张脸在动，侧栏收起时也不接过去，2026-10-20 裁决 119 第 6 条，`gui/src/components/layout/assistant/AssistantIdentity.tsx:60`）、「Galley」（标题同款 13px medium），名字后面紧跟标题按钮那个 11px 小箭头，名字下一行写它在做什么或状态。整行就是标题菜单的触发器：悬停、按下与打开态同标题按钮（`hover:bg-hover`、`data-[state=open]:bg-hover`），内边距收成 `py-0.5 pl-1.5 pr-2`，填色离开 44px 顶栏的上下边（静止时 32px 高，有状态时 35.4px）；点开是主对话的标题菜单：查找聊天记录、重新注入工具、桌面宠物、重置主对话（查找与重置是 2026-10-15 票 28 加的，见下条），没有重命名（主对话不改名），像 IM 里点对方名字进资料页。第二行照 IM 会话的标题栏：在跑时写它在做什么（见本条末「在跑时那句话」），等你回复（不接问题原文，原文就在下面的对话里）、出错、子任务在问你、子任务出错写状态；静止时只有名字，不写最后一句，也不写草稿。它与侧栏助手卡片的第二行有意不同：卡片在你不在助手里时替它说话，这里最后一句和草稿都已经在下面的对话与输入框里。**在跑时那句话**（2026-10-19 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 107、110，票 55、58）：写已经做完的步里最新那一句：从你最后一条消息（叫醒的一轮从叫醒行）之后往回找第一个有字的步，有旁白写旁白，没有旁白写它的 summary（同一套清洗，裁决 100），收口的回答那一步不算；还没有做完的步写「思考中」，你答完它的提问后也回到「思考中」。规则在 `assistantSettledSentence`（`useAssistantSettledSentence` 从主对话的消息缓存读）。不取正在流出的文字，免得回复落地前先在这里剧透它的第一句，所以只在一步落定时换句；选择器只返回字符串，流出 chunk 时身份行不重渲染。不计时：IM 的标题栏不计时，挪到这里会在余光里每秒跳，三点在跳、这里每做完一步换一句已经说明在推进，用时在过程卡片的第一行；某一步卡很久时分不清慢与卡，退路记在 [deferred](../devlog/deferred.md)「顶栏在跑超过 1 分钟接用时」。品牌色（`text-brand-strong/85`），与等你回复、出错同一行同高，换句不改身份行高度；太长就截断、右端渐隐（`truncate-fade`），悬停给全文（`syncTruncatedTitle`：真被截断时才挂原生 `title`）。对话里只有三点气泡、侧栏卡片写「正在输入…」，三样东西各在一处说（[conversation](./conversation.md)「助手的对话」的「在跑时：三点气泡」）。历史：10-14 票 18 写「第 N 步 · 摘要」；10-15 裁决 68 起与对话末尾那一行写同一句；10-16 裁决 87 起只写「思考中」（JC 真机：顶栏、侧栏卡片、对话区三处同一句「完全是重复多余的」）；10-19 裁决 104 起分「正在输入…」（它在写字）与「思考中」；裁决 110 起写做完的那一步的那句话，那句话从对话末尾挪到这里，对话里只剩三点，「正在输入…」交给侧栏卡片。身份行在按钮里，不带拖窗属性（`data-tauri-drag-region` 不冒泡，按钮里的元素带上它，按下就成了拖窗）。
+- **开着助手时是身份行**（2026-10-14，主聊天票 18，裁决 64）：主对话开着时，标题的位置换成助手的身份行：28px 头像（应用图标裁成圆、加 1px 内描边，与侧栏助手卡片同一张图，2026-10-15 裁决 70，见 §4.2「有主对话时」助手卡片的「头像」；**一律静止**：侧栏卡片上那张会动，这里不动、不挂徽标，主对话开着时它在做什么由对话里的三点气泡和下面那一行说，同一时刻只有一张脸在动，侧栏收起时也不接过去，2026-10-20 裁决 119 第 6 条，`gui/src/components/layout/assistant/AssistantIdentity.tsx:53`）、「Galley」（标题同款 13px medium），名字后面紧跟标题按钮那个 11px 小箭头，名字下一行只写要你处理的状态。整行就是标题菜单的触发器：悬停、按下与打开态同标题按钮（`hover:bg-hover`、`data-[state=open]:bg-hover`），内边距收成 `py-0.5 pl-1.5 pr-2`，填色离开 44px 顶栏的上下边（静止时 32px 高，有状态时 35.4px）；点开是主对话的标题菜单：查找聊天记录、重新注入工具、桌面宠物、重置主对话（查找与重置是 2026-10-15 票 28 加的，见下条），没有重命名（主对话不改名），像 IM 里点对方名字进资料页。第二行照 IM 会话的标题栏，只说要你处理的状态：等你回复（不接问题原文，原文就在下面的对话里）、出错、子任务在问你、子任务出错；静止时只有名字，不写最后一句，也不写草稿；在跑时也只有名字，同静止（见本条末「在跑时留空」）。它与侧栏助手卡片的第二行有意不同：卡片在你不在助手里时替它说话，这里最后一句和草稿都已经在下面的对话与输入框里。**在跑时留空**（2026-10-23 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 134 第 3 条、135，票 90、91）：在跑时第二行留空，同静止；等你回复、出错、子任务的状态照旧写（在跑时它问你，写「等你回复」）。身份行静止时本来就是一行，开跑时不跳。顶栏从此只说要你处理的状态：它在做什么、做了多久是对话里三点气泡下面那一行（「{在做什么} · {用时}」），侧栏卡片只替你说屏上看不到的（[conversation](./conversation.md)「助手的对话」的「在跑时：三点气泡」）。为什么（裁决 134 第 1 条）：用户发出后眼睛在输入框正上方的三点上，这一行在主区左上角、11px，只在一步做完时换，v0.7.0 的用户在长回合里没注意到它，以为软件卡死了；把它做醒目也没用，进展要放到眼前。状态字：等你回复 `text-warning`、出错 `text-error`，都是 `font-medium`，与名字下一行同高；太长就截断、右端渐隐（`truncate-fade`），悬停给全文（`syncTruncatedTitle`：真被截断时才挂原生 `title`）。历史：10-14 票 18 写「第 N 步 · 摘要」；10-15 裁决 68 起与对话末尾那一行写同一句；10-16 裁决 87 起只写「思考中」（JC 真机：顶栏、侧栏卡片、对话区三处同一句「完全是重复多余的」）；10-19 裁决 104 起分「正在输入…」（它在写字）与「思考中」；裁决 110 起写做完的那一步的那句话（有旁白写旁白，没有写它的 summary，裁决 100），品牌色，不计时，那句话从对话末尾挪到这里，对话里只剩三点，「正在输入…」交给侧栏卡片；10-23 裁决 134、135 起在跑时留空，那句话随之删掉（`assistantSettledSentence` 一路），用时挪进对话（[deferred](../devlog/deferred.md)「顶栏在跑超过 1 分钟接用时」作废）。身份行在按钮里，不带拖窗属性（`data-tauri-drag-region` 不冒泡，按钮里的元素带上它，按下就成了拖窗）。
 - **标题菜单里的查找与重置**（2026-10-15，[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 77，票 28）：照 IM 资料页给菜单派实用的活——微信资料页的「查找聊天记录」「清空聊天记录」。此前主对话的菜单只有两个低频按钮。

   ```
@@ -263,14 +263,22 @@ Browser Control 是 managed GA 的核心能力，位于状态簇的内核后、C
 - **书眉**：红绿灯区与搜索、新建项目两个图标，没有字标（§4.1 SidebarHeader「有主对话时没有字标」「有主对话时书眉没有第二个图标」）。
 - **卡片下面没有「待办」那一行**（2026-10-17 撤，主聊天票 45，[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 93）：票 42 在助手卡片正下方、`line-strong` 之上放过一行「待办」，右边写「今天 N」，三档（A1 照侧栏网格的独立一行、A2 卡片文字列下的一行小字、A3 照卡片网格的一行）JC 真机都不满意：既不是对话也不是新建，A1 像没归位的对话、A2 弱、A3 像卡片的子菜单。入口挪到 Galley 对话顶栏（§4.1「待办按钮」），侧栏回到助手卡片加对话列表（顶上放动作、列表放对象），卡片块里只有卡片，书眉的两个图标不变。
 - **助手卡片**（2026-10-14，票 18，裁决 64、65；2026-10-20 起是居中舞台，裁决 118、119，票 65 做、票 67 进生产）：IM 会话列表里的一段对话。侧栏左上角的「头像加名字」在 Slack、Notion、Linear 里是切换工作区或账号的地方，资料卡式的「头像、名字、静止时空着」也读不成一段对话；IM 列表的一行能被认成对话，靠的是最后一句话和时间，所以第二行用满，不压矮。舞台把头像放大到 72px、居中：裁决 64 否「头像放大」时头像是静止的标志，放大只为显得重要；现在放大是为了看清一张会动的脸（眼睛直径约是头像的 6%，40px 时 2.5px 基本看不出眨眼与看向哪边，72px 时 4.5px），是功能（裁决 118 第 1、3 条）；最后一句与时间都在，裁决 65「看得出是一段对话」不丢；JC 提两区时说过「在空间占用上也可以考虑再多一点」（裁决 114），舞台是唯一真正把空间给助理的版式。没选：大头像行（64px 左对齐在 18px 线上，裁决 119 第 1 条）、放进书眉、侧栏底部放一个伙伴、放进对话（裁决 118 第 4 条）。
-  - **构造**（`gui/src/components/layout/sidebar/SidebarAssistant.tsx:185` `SidebarAssistantCard`）：整块一个按钮，竖排、居中：72px 头像（会动的脸，见下「头像」）居中在 72px 高的槽里；下面 6px 是名字那一行（20px 高）：「Galley」14px（会话标题 13px），右边隔 6px 是 11px 时间，两个一起居中，放不下时时间整个让位（换到被裁掉的第二排），名字不截断；再下 2px 是第二行（下条），单行居中，截断时渐隐。卡片 `mx-1.5`、上下内边距各 6px（`:270`）、圆角 12px（会话行 6px）；侧栏 296px 时卡片 283×128.8。头像槽与名字行高度固定，第二行换内容时下面的列表不动；还没有任何消息、没有第二行时卡片 110px，第二行出现时列表下移 18.8px（只在新主对话问候落地前出现一次）。**静止**时卡片内侧一圈 1px 淡线（`line-strong` 六成，`inset-ring`：不占尺寸，下面的列表不动，焦点环照旧），不铺底、不加阴影（2026-10-20 起，裁决 122，票 71；`stageFill`，`:100`）。没有边时，静止的卡片是 chrome 上的一片区域，居中的大头像加名字读作资料页头，第一眼认不出是一整块能点的东西；轮廓补的是「这是一个东西」，「能点」靠侧栏的位置与悬停确认。代价是助理区多了两道横线（书眉线 44，卡片上沿 52、下沿 180.8，通栏线 186.8），此前不加边框就是为了避开它。静止时不铺工作台底色（`app`）：底色是「选中」的专属通道，深色下还读成凹下去的槽（第一轮切换器比过）。**选中**（助手或它的子任务开着）铺会话行同值的选中色（侧栏里加深过的 `bg-selected`），不加抬起阴影，轮廓换成同色系深一档（`--color-selected-hover`），名字由 `ink-soft` 变满墨（`:308`）。选中必须压过悬停（`globals.css` 记着 08-21 会话行的同一个毛病）；卡片又在按下那一刻就打开，原来按下时悬停底消失、只多出头像外一圈 2px，按的动作反而让卡片变空。一启动就是一块杏色卡，是裁决 64、118 第 3 条的顾虑，JC 真机看过定为可以；没选轮廓变 1.5px 品牌色（只靠色相、线又细）。**悬停**整块铺 `bg-hover`，选中时不响应悬停；鼠标移上去也是给脸的一个「看你一眼」（`signalAssistantLook`，`:267`）。**按下**下沉 1px 并缩到 98%（约收进 3px），`--motion-press` 70ms、`ease-firm` 缓入，松开立刻回弹；选中时按住，底色再深一档。会话行只给极轻的按下（[foundations](./foundations.md) §2.5），卡片的面积是一行的三倍，1px 按比例看等于没有。过渡写在 `translate`、`scale` 属性上：Tailwind v4 把下沉与缩放写成这两个独立属性，`transform` 过渡管不到。按下（pointerdown）就打开，同会话行，但要等按压那一帧画出来（下一帧之后的一个任务，页面隐藏时 100ms 兜底；`afterPaint`，`:109`）：主对话挂载会占住主线程约 0.2 秒（dev 实测，裁决 123），放在同一个任务里打开，按压要等它结束才画得出。跟着的那次 click 吞掉；回车、空格照常，立即打开。**窄侧栏**：侧栏内容宽窄于 184px 时头像缩到 48px（容器查询 `@min-[184px]/sidebar`，`STAGE_AVATAR`，`:127`；184 以下 72 的头像占卡片宽四成以上，像海报不像列表的头），头像槽仍是 72 高，跨门槛时列表不动。**跳出圆框的空间**（裁决 119 第 5 条，票 66 实测，侧栏 296px）：头像框上沿在 58px，离书眉下沿（44px）14px；人物静止时在圆内，做完那一跳的顶点约 50px，离书眉还有 6px；派出子任务时舌尖伸出圆框；往下最低是出错与打盹的低头，约 126px，名字从 136px 起；左右各有 100px 以上。卡片块在 chrome 上，卡片上方 8px、下方 6px（卡片块的 `pt-2`、`pb-1.5`），下沿就是那条通栏的 `line-strong`（卡片块的 `border-b`，`gui/src/components/layout/Sidebar.tsx:471`；2026-10-20 起，票 70，见下「工作台不挂区名」与「下面那块的底与分隔线」）。卡片的键盘焦点环在卡片外 2px，落在卡片块自己的 6px 下内边距里，后面画的东西碰不到它，卡片块不定位（票 70 实测：给卡片块加上定位与层级再比，环的下沿只差光栅化的 1 级色值）。卡片自带上下 6px，助理区实测 142.8px：书眉下沿 44 到线 186.8，裁决 118 第 2 条的「约 140px」。从侧栏顶算：卡片 52–180.8，头像 58–130，名字行 136，第二行 158，线 186.8（1px），列表从 187.8 起，新对话按钮从 193.8 起（生产构建、无头 Chrome 实测，票 70）。静止时第二行字墨底到线约 14.8px；悬停底止于卡片下沿，离线 6px，按下下沉 1px 时 5px。历史：2026-10-14 至 10-20 是 IM 行式卡片（裁决 65）：40px 头像左缘在 18px 线上，名字与时间分在两端，固定 58px，选中用选中三通道（选中底色、抬起阴影、满墨色），在跑时头像角上转圈；10-19 票 62 的 C 档起块上 12px、下 10px，卡片 56–114、线 130、按钮 143。10-19 至 10-20 票 65、66 在开发版里用临时切换器比过行 64 与舞台 72（裁决 118、119）。10-20 票 67 起到票 71 之前，静止时没有边，选中不铺底，是头像外 2px 空隙一圈 2px 品牌色描边（浅深两色都一眼可见，又是侧栏里唯一的品牌色圆圈），按下只下沉 1px、与打开在同一个任务里。10-20 票 67 至 69 卡片下面有区名那一行，线在 192.8，按钮从 205.8 起；票 69 把卡片块下方那 6px 挪给区名元素，底色从卡片下沿起渐变，卡片块只在焦点环亮着时定位（`has-[:focus-visible]:relative`），把环画在渐变上面。
-  - **第二行**，一句话：它说的最后一句，有状态时写状态。优先级从高到低：出错（「出错」「出错 · N」，子任务的写「子任务出错」，红）> 在问你（「等你回复：」琥珀色，接问题原文 `PendingAskUser.question`，原文用第二行的普通颜色、去 markdown 摊成一行；取不到原文时只写「等你回复」；子任务在问你照旧写「子任务在问你」）> 在跑（「正在输入…」，主对话开着、没开着都一样；品牌色与换句时的轻跳同会话行，见下「在跑时说什么」）> 草稿（助手没开着、它的输入框里有没发出的字或图时，「草稿：」品牌色接草稿的字，只有图时写「[图片]」；开着主对话时不写，草稿就在输入框里，与未读同理；开着它的子任务不算开着，主对话不在眼前（2026-10-16 裁决 87，此前算开着）；红色留给出错）> 最后一句。中止、停在步数上限都不算状态，回到最后一句。12px、行高 1.4、`ink-muted`：会话行副行是 11px，12 / 14 守住副行与标题 11 / 13 的比例（真机对照见票 18 的总览图；当时放在 40px 头像旁，11px 像注脚）。截断时渐隐；悬停**不**给全文（2026-10-15 裁决 75：此前照会话行挂原生 `title`，可这一行是它说的最后一段话，回复动辄几百字、几乎总被截断，停一下就是一大块；全文点一下就在主区，开着助手时就在眼前，IM 的会话列表也不悬停预览；读屏用的 `aria-label` 照旧带整句）。 **主对话本身开着时只写最后一句**（2026-10-19 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 104，票 52；推翻裁决 87 第 2、3 条；在跑那一档同日裁决 110 起改写「正在输入…」，见下「在跑时说什么」）：卡片是列表里的选中行，第二行不跟状态变，在问你、出错、子任务在问你、子任务出错都写最后一句（「你：」前缀照旧，`ink-muted`，没有品牌色、琥珀色、红色的状态字），也不写草稿；状态交给头像（在跑时那张脸，在问你、出错时角标的暂停、叉）与名字加粗，字在顶栏（§4.1「开着助手时是身份行」）与对话里，照微信的会话列表不报对方在输入、标题栏报（在跑这一档裁决 110 起不照这条：列表行只说「正在输入…」这个状态，它在做什么在顶栏）。「最后一句」是对话里画成气泡的最后一条，所以在跑时，你最后一条消息之后调了工具又不是提问的步不算：主对话不把它画成气泡；卡片停在「你：……」，直到它提问或回复落地（`lastVisibleMessage` 的 `liveRound`，在跑时生效，主对话开着、没开着都一样，裁决 110；叫醒的一轮不在写字时卡片写的就是它）。在问你时最后一句就是它问的那句（`PendingAskUser.question`，去 markdown 摊成一行，不加「等你回复：」）：提问那一步已在消息缓存里（它的 turn_end 先于 ask_user 事件到；重载时挂着的提问本来就是从这一步推出来的），可那一步若还写了字，按消息算取到的是那段字，而对话里提问那一步只画问题。没有最后一句时没有第二行，名字居中。开着它的子任务不算开着，照上面写全（裁决 87 第 4 条）。代价：在问你时卡片写出问题原文，与对话里的提问重复（静止时最后一句本来就重复主区，裁决 65 接受为 IM 常态）；出错时卡片只剩红叉角标，红字在顶栏与对话里。此前（10-16 裁决 87 起）开着时只写状态：在问你只写「等你回复」，在跑只写「思考中」，卡片与顶栏同时报同一个词。
-  - **在跑时说什么**（2026-10-19 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 107、110，票 55、58）：「正在输入…」（`copy.assistant.typing`），主对话开着、没开着都一样，品牌色，头像那张脸在干活的样子（减少动态下转圈）。叫醒的一轮跟着对话里的三点走：它在写字、对话里有三点气泡时写「正在输入…」，不在时是最后一句（跳过在跑这一轮的工具步，同上条），这时说在忙的只有那张脸（减少动态下是转圈）。判断与三点气泡是同一个（`assistantTyping`：你发起的一轮一直算，叫醒的一轮看 `assistantWriting`），卡片与对话不会一个在打字、一个没有。优先级照上面那条，在问你、出错时写那些，不写这句。为什么不说那句过程（裁决 107 第 3 条）：IM 的会话列表只说状态；过程细节在顶栏（§4.1「开着助手时是身份行」的「在跑时那句话」），对话里是三点，每样东西只在一处说。代价（裁决 107 第 4 条、110 第 3 条）：你不在主对话时卡片不再说那句过程，要看就点卡片进主对话看顶栏；你在工作台时卡片只写「正在输入…」。规则：助手本人在哪里都不报步数；它派出去的子任务是任务对话，子任务卡片的「第 N 步」照旧（`lib/subtasks.ts`），工作台的会话行照旧（下面「状态行文案」）。截断、渐隐、品牌色照旧。历史：10-14 票 18 写「第 N 步 · 摘要」（`summary` 是 agent 的工作记忆，不写给读者，[conversation](./conversation.md)「不用 `AgentTurn.summary`」；同一刻两处说两句话：天气那次第 2 步，主区「我按 10 月 17 日和 18 日这两天查。」，卡片「第 2 步 · 已明确查询日期；接下来打开天气搜索页核对预报。」）；10-15 裁决 68 第 4 条（票 21）起说主区对话末尾那一行的同一句，10-19 裁决 100（票 47）起没有旁白时用 summary；10-19 裁决 104（票 52）起主对话开着时在跑也只写最后一句；裁决 110（票 58）起一律「正在输入…」，那句话只在顶栏。
+  - **构造**（`gui/src/components/layout/sidebar/SidebarAssistant.tsx:192` `SidebarAssistantCard`）：整块一个按钮，竖排、居中：72px 头像（会动的脸，见下「头像」）居中在 72px 高的槽里；下面 6px 是名字那一行（20px 高）：「Galley」14px（会话标题 13px），右边隔 6px 是 11px 时间，两个一起居中，放不下时时间整个让位（换到被裁掉的第二排），名字不截断；再下 2px 是第二行（下条），单行居中，截断时渐隐。卡片 `mx-1.5`、上下内边距各 6px（`:287`）、圆角 12px（会话行 6px）；侧栏 296px 时卡片 283×128.8。头像槽与名字行高度固定，第二行换内容时下面的列表不动；还没有任何消息、没有第二行时卡片 110px，第二行出现时列表下移 18.8px（只在新主对话问候落地前出现一次）。**静止**时卡片内侧一圈 1px 淡线（`line-strong` 六成，`inset-ring`：不占尺寸，下面的列表不动，焦点环照旧），不铺底、不加阴影（2026-10-20 起，裁决 122，票 71；`stageFill`，`:104`）。没有边时，静止的卡片是 chrome 上的一片区域，居中的大头像加名字读作资料页头，第一眼认不出是一整块能点的东西；轮廓补的是「这是一个东西」，「能点」靠侧栏的位置与悬停确认。代价是助理区多了两道横线（书眉线 44，卡片上沿 52、下沿 180.8，通栏线 186.8），此前不加边框就是为了避开它。静止时不铺工作台底色（`app`）：底色是「选中」的专属通道，深色下还读成凹下去的槽（第一轮切换器比过）。**选中**（助手或它的子任务开着）铺会话行同值的选中色（侧栏里加深过的 `bg-selected`），不加抬起阴影，轮廓换成同色系深一档（`--color-selected-hover`），名字由 `ink-soft` 变满墨（`:325`）。选中必须压过悬停（`globals.css` 记着 08-21 会话行的同一个毛病）；卡片又在按下那一刻就打开，原来按下时悬停底消失、只多出头像外一圈 2px，按的动作反而让卡片变空。一启动就是一块杏色卡，是裁决 64、118 第 3 条的顾虑，JC 真机看过定为可以；没选轮廓变 1.5px 品牌色（只靠色相、线又细）。**悬停**整块铺 `bg-hover`，选中时不响应悬停；鼠标移上去也是给脸的一个「看你一眼」（`signalAssistantLook`，`:284`）。**按下**下沉 1px 并缩到 98%（约收进 3px），`--motion-press` 70ms、`ease-firm` 缓入，松开立刻回弹；选中时按住，底色再深一档。会话行只给极轻的按下（[foundations](./foundations.md) §2.5），卡片的面积是一行的三倍，1px 按比例看等于没有。过渡写在 `translate`、`scale` 属性上：Tailwind v4 把下沉与缩放写成这两个独立属性，`transform` 过渡管不到。按下（pointerdown）就打开，同会话行，但要等按压那一帧画出来（下一帧之后的一个任务，页面隐藏时 100ms 兜底；`afterPaint`，`:113`）：主对话挂载会占住主线程约 0.2 秒（dev 实测，裁决 123），放在同一个任务里打开，按压要等它结束才画得出。跟着的那次 click 吞掉；回车、空格照常，立即打开。**窄侧栏**：侧栏内容宽窄于 184px 时头像缩到 48px（容器查询 `@min-[184px]/sidebar`，`STAGE_AVATAR`，`:131`；184 以下 72 的头像占卡片宽四成以上，像海报不像列表的头），头像槽仍是 72 高，跨门槛时列表不动。**跳出圆框的空间**（裁决 119 第 5 条，票 66 实测，侧栏 296px）：头像框上沿在 58px，离书眉下沿（44px）14px；人物静止时在圆内，做完那一跳的顶点约 50px，离书眉还有 6px；派出子任务时舌尖伸出圆框；往下最低是出错与打盹的低头，约 126px，名字从 136px 起；左右各有 100px 以上。卡片块在 chrome 上，卡片上方 8px、下方 6px（卡片块的 `pt-2`、`pb-1.5`），下沿就是那条通栏的 `line-strong`（卡片块的 `border-b`，`gui/src/components/layout/Sidebar.tsx:471`；2026-10-20 起，票 70，见下「工作台不挂区名」与「下面那块的底与分隔线」）。卡片的键盘焦点环在卡片外 2px，落在卡片块自己的 6px 下内边距里，后面画的东西碰不到它，卡片块不定位（票 70 实测：给卡片块加上定位与层级再比，环的下沿只差光栅化的 1 级色值）。卡片自带上下 6px，助理区实测 142.8px：书眉下沿 44 到线 186.8，裁决 118 第 2 条的「约 140px」。从侧栏顶算：卡片 52–180.8，头像 58–130，名字行 136，第二行 158，线 186.8（1px），列表从 187.8 起，新对话按钮从 193.8 起（生产构建、无头 Chrome 实测，票 70）。静止时第二行字墨底到线约 14.8px；悬停底止于卡片下沿，离线 6px，按下下沉 1px 时 5px。历史：2026-10-14 至 10-20 是 IM 行式卡片（裁决 65）：40px 头像左缘在 18px 线上，名字与时间分在两端，固定 58px，选中用选中三通道（选中底色、抬起阴影、满墨色），在跑时头像角上转圈；10-19 票 62 的 C 档起块上 12px、下 10px，卡片 56–114、线 130、按钮 143。10-19 至 10-20 票 65、66 在开发版里用临时切换器比过行 64 与舞台 72（裁决 118、119）。10-20 票 67 起到票 71 之前，静止时没有边，选中不铺底，是头像外 2px 空隙一圈 2px 品牌色描边（浅深两色都一眼可见，又是侧栏里唯一的品牌色圆圈），按下只下沉 1px、与打开在同一个任务里。10-20 票 67 至 69 卡片下面有区名那一行，线在 192.8，按钮从 205.8 起；票 69 把卡片块下方那 6px 挪给区名元素，底色从卡片下沿起渐变，卡片块只在焦点环亮着时定位（`has-[:focus-visible]:relative`），把环画在渐变上面。
+  - **第二行**，一句话：它说的最后一句，有状态时写状态。优先级从高到低：出错（「出错」「出错 · N」，子任务的写「子任务出错」，红）> 在问你（「等你回复：」琥珀色，接问题原文 `PendingAskUser.question`，原文用第二行的普通颜色、去 markdown 摊成一行；取不到原文时只写「等你回复」；子任务在问你照旧写「子任务在问你」）> 在跑（你发起的一轮「正在工作…」，主对话不在屏上时它在写字写「正在输入…」、满 1 分钟起「正在工作 · N 分钟」；叫醒的一轮跟着三点走；品牌色与换句时的轻跳同会话行，见下「在跑时说什么」）> 草稿（助手没开着、它的输入框里有没发出的字或图时，「草稿：」品牌色接草稿的字，只有图时写「[图片]」；开着主对话时不写，草稿就在输入框里，与未读同理；开着它的子任务不算开着，主对话不在眼前（2026-10-16 裁决 87，此前算开着）；红色留给出错）> 最后一句。中止、停在步数上限都不算状态，回到最后一句。12px、行高 1.4、`ink-muted`：会话行副行是 11px，12 / 14 守住副行与标题 11 / 13 的比例（真机对照见票 18 的总览图；当时放在 40px 头像旁，11px 像注脚）。截断时渐隐；悬停**不**给全文（2026-10-15 裁决 75：此前照会话行挂原生 `title`，可这一行是它说的最后一段话，回复动辄几百字、几乎总被截断，停一下就是一大块；全文点一下就在主区，开着助手时就在眼前，IM 的会话列表也不悬停预览；读屏用的 `aria-label` 照旧带整句）。 **主对话本身开着时只写最后一句**（2026-10-19 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 104，票 52；推翻裁决 87 第 2、3 条；在跑那一档同日裁决 110 起改写「正在输入…」，10-23 裁决 134 起写「正在工作…」，见下「在跑时说什么」）：卡片是列表里的选中行，第二行不跟状态变，在问你、出错、子任务在问你、子任务出错都写最后一句（「你：」前缀照旧，`ink-muted`，没有品牌色、琥珀色、红色的状态字），也不写草稿；状态交给头像（在跑时那张脸，在问你、出错时角标的暂停、叉）与名字加粗，字在顶栏（§4.1「开着助手时是身份行」）与对话里，照微信的会话列表不报对方在输入、标题栏报（在跑这一档不照这条：裁决 110 起列表行只说状态，10-23 裁决 134 起写「正在工作…」，它在做什么在对话里三点下面那一行）。「最后一句」是对话里画成气泡的最后一条，所以在跑时，你最后一条消息之后调了工具又不是提问的步不算：主对话不把它画成气泡；卡片停在「你：……」，直到它提问或回复落地（`lastVisibleMessage` 的 `liveRound`，在跑时生效，主对话开着、没开着都一样，裁决 110；叫醒的一轮不在写字时卡片写的就是它）。在问你时最后一句就是它问的那句（`PendingAskUser.question`，去 markdown 摊成一行，不加「等你回复：」）：提问那一步已在消息缓存里（它的 turn_end 先于 ask_user 事件到；重载时挂着的提问本来就是从这一步推出来的），可那一步若还写了字，按消息算取到的是那段字，而对话里提问那一步只画问题。没有最后一句时没有第二行，名字居中。开着它的子任务不算开着，照上面写全（裁决 87 第 4 条）。代价：在问你时卡片写出问题原文，与对话里的提问重复（静止时最后一句本来就重复主区，裁决 65 接受为 IM 常态）；出错时卡片只剩红叉角标，红字在顶栏与对话里。此前（10-16 裁决 87 起）开着时只写状态：在问你只写「等你回复」，在跑只写「思考中」，卡片与顶栏同时报同一个词。
+  - **在跑时说什么**（2026-10-23 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 134 第 4 条、135，票 90、91；推翻裁决 107、110 的「在跑时写『正在输入…』，开着没开着都一样」）：卡片只替你说屏上看不到的那部分。你发起的一轮：
+
+    | 你发起的一轮 | 主对话在屏上 | 不在屏上（在工作台、在它的子任务里） |
+    |---|---|---|
+    | 它在写字（`assistantWriting`） | 「正在工作…」 | 「正在输入…」 |
+    | 其余，不到 1 分钟 | 「正在工作…」 | 「正在工作…」 |
+    | 其余，满 1 分钟起 | 「正在工作…」 | 「正在工作 · N 分钟」 |
+
+    主对话在屏上时全程「正在工作…」（`copy.assistant.working`），最后几秒也不翻成「正在输入…」：三点气泡和它下面那一行「在做什么 · 用时」就在眼前。不在屏上时它在写字写「正在输入…」（`copy.assistant.typing`，Telegram 的会话列表也这样），其余「正在工作…」，满 1 分钟起接整分钟数（`copy.assistant.workingMinutes`：这一轮的用时，各段相加、等你回答的不算，同对话里那一行的用时，向下取整；按分钟不按秒跳，计时器只在整分钟时让卡片重渲染）。「在屏上」是卡片的 `open`（主区是主对话），与待办面板的 `mainChatOnScreen` 同口径，不看盖在上面的设置或对话框。品牌色，头像那张脸在干活的样子（减少动态下转圈）。叫醒的一轮照旧跟着对话里的三点走：它在写字、对话里有三点气泡时写「正在输入…」，不在时是最后一句（跳过在跑这一轮的工具步，同上条），这时说在忙的只有那张脸（减少动态下是转圈）；判断与三点气泡是同一个（`assistantTyping`，叫醒的一轮看 `assistantWriting`），卡片与对话不会一个在打字、一个没有。优先级照上面那条，在问你、出错时写那些，不写这句。为什么（裁决 134 第 4 条）：IM 的会话列表只说状态，卡片只替你说屏上看不到的；主对话在屏上时三点与那一行就在眼前，卡片不必再翻成「正在输入…」；不在屏上时卡片是唯一看得到它的地方，「正在输入…」挂几分钟读作卡住（裁决 134 第 1 条），所以写「正在工作…」并接分钟数。用词：「在忙」在 IM 里是「忙碌、顾不上你」，读反了；「正在工作…」与「正在输入…」同一句式；不写「正在工作中」（两次进行时，界面里没有这种写法）。代价（裁决 135 第 3 条）：设置页盖着主对话时卡片仍算在屏上，看不到「正在输入…」与分钟数。规则在 `lib/assistant.ts` 的 `assistantCardLine`（`workingLine`），读数在 `hooks/useAssistantProgress.ts`（`useAssistantRound`、`useAssistantRunMinutes`）。助手本人在哪里都不报步数；它派出去的子任务是任务对话，子任务卡片的「第 N 步」照旧（`lib/subtasks.ts`），工作台的会话行照旧（下面「状态行文案」）。截断、渐隐、品牌色照旧。历史：10-14 票 18 写「第 N 步 · 摘要」（`summary` 是 agent 的工作记忆，不写给读者，[conversation](./conversation.md)「不用 `AgentTurn.summary`」；同一刻两处说两句话：天气那次第 2 步，主区「我按 10 月 17 日和 18 日这两天查。」，卡片「第 2 步 · 已明确查询日期；接下来打开天气搜索页核对预报。」）；10-15 裁决 68 第 4 条（票 21）起说主区对话末尾那一行的同一句，10-19 裁决 100（票 47）起没有旁白时用 summary；10-19 裁决 104（票 52）起主对话开着时在跑也只写最后一句；裁决 110（票 58）起一律「正在输入…」，那句话只在顶栏。10-23 裁决 134、135（票 90、91）起你发起的一轮写「正在工作…」，只说屏上看不到的。
   - **最后一句**：这条对话最后一条看得见的消息，纯文字一行（`lib/assistant.ts` 的 `lastVisibleMessage`、`plainLine`）。去掉 markdown：标题、强调、删除线、行内代码的记号，链接取文字，列表、引用、表格摊成一行，代码照原文，空白合并。附件写「[图片]」（几张都写一次）、「[文件] 文件名」；回复里的 `[FILE:路径]` 也写「[文件] 文件名」（回复正文清洗时会去掉这个标记，界面另记一份路径，`AgentTurn.files`）。你说的前面加「你：」，普通颜色，CLI、Supervisor 发进主对话的也算。第一次打开时就是问候那一行，它也是一条消息。跳过的：只调了工具的步骤、`/btw` 旁问与它的回答（不入库，不算对话）、旁白行（`session.checkpoint`）；一条回复只剩派活标签、没有正文时也跳过，写它前一句；子任务的叫醒行与叫醒那一轮不出声的回复（`<no-reply/>`，票 31）也跳过（`hiddenReportTurns`）。它用 ask_user 问过的问题算它说的话。重复主区是 Telegram、iMessage 的常态：人在工作台时，这是唯一能看到它刚说了什么的地方（裁决 65 因此推翻裁决 58 的「静止时不写」）。
   - **时间**：最后一句的时间。你说的取消息的发送时间；它的回复与提问取那一步落定的时间（`AgentTurn.settledAt`：读回是那一行的 `created_at`，实时是 turn_end 的时间，票 31：叫醒那一轮也会挪动 `lastActivityAt`，不出声时最后一句还是前一条，时间要跟着它）；取不到时与没有消息时用会话的 `lastActivityAt`。11px `ink-muted` 等宽数字，右缘在 18px 文字边、与时间桶计数同列：它是元数据，与侧栏的计数同一档安静，IM 列表的时间也比名字小一号、偏灰。格式照 IM 列表（`message-time.ts` 的 `formatListTime`）：今天「11:50」，昨天「昨天」，再往前 6 天内写星期（「周一」；满 7 天会撞上今天的星期，改写日期），今年更早「10月7日」，跨年「2025年10月7日」；英文照 Intl en-US：「11:50 AM」「Yesterday」「Mon」「Oct 7」「Oct 7, 2025」。过了零点跟着 `useDayStamp` 重写。名字那一行放不下名字和时间时，时间整个让位（换到被裁掉的第二排），名字不截断，时间也不剩半截：中文「11:50」侧栏 167px 以上显示，英文「11:50 AM」188px 以上（Chrome 实测）。
   - **头像**（2026-10-15，裁决 70，票 23）：就是应用图标。助手叫 Galley，和应用同名；它不在眼前时靠系统通知找你，macOS 通知左边只能是应用图标（平台决定），Dock 也是，同名就该同脸；图标本身是一个有脸的角色（木头机器人吐出长舌头形成 G），天然适合当 IM 头像。一张母图、两种裁切：母图（`core/icons/master/galley-icon.svg`）铺满方形、图形在中心圆内，应用图标裁成圆角方形，头像裁成圆。资源是同一张 SVG（`gui/src/assets/galley-icon.svg`，测试保证与母图逐字节相同），任何尺寸、任何缩放都锐利。圆内侧画一圈 1px 描边，压在图上、不改变 28 / 48 / 72 的外尺寸：浅色黑 12%、深色白 10%（`--color-avatar-ring`，跟着主题走）。浅色要它是因为图标的浅底（L* 89）和浅色侧栏的底只差 L* 1–5（chrome 94、悬停 90、选中 87），没有描边就没有边界。**会动的脸**（2026-10-20，裁决 117、119，票 65、66、67）：侧栏卡片上的头像是同一张图拆开画的一张脸（`AssistantFace`，从母图原样画出，静止时与图标逐像素相同），眼睛、嘴、舌头卷成的 G 跟着它在做的事动：干活时一直在动，闲着时偶尔眨眼、左右看，很久没碰它就打盹；只有浅底裁在圆里，人物可以跳出圆框。规则、状态表、数值出处与减少动态下的退路见 [foundations](./foundations.md) §2.7「豁免二：助理的脸」。顶栏身份行的 28px 头像一律静止（§4.1），同一时刻只有一张脸在动。不可点（点到的是它所在的卡片或身份行）、不可拖、不可选中，屏幕阅读器忽略（`aria-hidden`，卡片的无障碍名已经有「Galley」）。此前（票 18 起）是品牌色圆盘上一个 Newsreader 斜体「G」，是占位（裁决 65「助手的形象另议」）。
   - **头像标记与字重**：头像右上角挂会话行的状态图标：在问你暂停、出错叉、未读实心点（微信的位置）；在跑不挂转圈，那张脸一直在动就是在忙（裁决 117 第 1、8 条：转圈读作「程序在加载」），只在减少动态下脸不动时转圈放回来（`gui/src/components/layout/assistant/AssistantAvatar.tsx:156`，`faceRuns`）。徽标按头像大小算，中心在圆的 45° 点上：72px 头像用 20px 徽标、16px 字形，48px 用 16px、13px（`:109`）；两个都画、按侧栏宽度只显示一个。圈色跟着卡片此刻的底色（chrome、悬停底或选中底，按住时是深一档的选中底），像嵌进头像的一角；进入在问你、出错、未读时 pop 一次，挂载不 pop。在跑、在问你、出错、未读时名字 semibold，草稿与静止时 medium。未读只在主对话本身没开着时出现，不写条数（只记有没有）；开着它的子任务时卡片仍是选中态，但主对话来了新回复照样标未读（裁决 87：子任务跑完、它被叫醒来交代时，你人在子任务里）。不做：在线点（助手一直在，又会和未读的点撞）、已读回执、置顶与免打扰标记。
-  - **数据只在界面里取**：最后一句从界面的消息缓存来（启动就打开主对话，所以通常在）。缓存里还没有它的消息时（启动没打开它，比如先要配模型），卡片自己用激活时同一个读取（`session_message_turns_page`）读最新一页，读到的只给卡片用：不进缓存、不激活、不标已读、不动滚动；缓存一有消息，以缓存为准。问候不算一轮（`turn_count` 仍是 0），激活时也一律读回主对话（2026-10-14 起，票 18；此前只在 `turn_count > 0` 时读回，新主对话打开是空的）。草稿从 `composer-draft.ts` 的草稿来（2026-10-16 起文字草稿也存到本机，重启后卡片照旧显示），侧栏订阅它（`subscribeComposerDrafts`），输入框的行为不变。在跑时顶栏那句话与卡片的「正在输入…」也从消息缓存来：主对话的 turns 与正在流出的 `inFlightContent`（`hooks/useAssistantSentence.ts`）。顶栏读做完的那一步的那句话（`useAssistantSettledSentence`，只看 turns）；卡片读一个布尔值，它此刻算不算在打字（`useAssistantTyping`，与对话里的三点同一个判断：你发起的一轮不看流，叫醒的一轮才看）。主对话不在屏上时 runner 的事件照样写进它的缓存（`ipc-handlers.ts` 按事件的会话追加，不看哪个会话开着），所以开着工作台会话时卡片也跟得上。`inFlightContent` 每个 chunk 都变，卡片和顶栏不跟着每个 chunk 重渲染：顶栏的选择器只返回字符串、卡片的只返回布尔值，相同就不更新；清洗流（`cleanPartialContent`）只在叫醒的一轮在跑时、只在流变了时做一次，卡片与对话的三点共用结果（`cleanedStream`）。量得（2026-10-19，票 58，按选择器数）：你发起的两步一轮，14 个 chunk 期间顶栏、卡片都不重渲染（顶栏在开跑、两步落地、跑完时各一次，卡片在开跑、跑完与 turns 每次变化时）；叫醒的一轮只多卡片在第一个字流出时的一次。此前（票 52，裁决 104）顶栏读「在不在写字」的布尔值，两步一轮流出 51 个 chunk 时重渲染 5 次。
+  - **数据只在界面里取**：最后一句从界面的消息缓存来（启动就打开主对话，所以通常在）。缓存里还没有它的消息时（启动没打开它，比如先要配模型），卡片自己用激活时同一个读取（`session_message_turns_page`）读最新一页，读到的只给卡片用：不进缓存、不激活、不标已读、不动滚动；缓存一有消息，以缓存为准。问候不算一轮（`turn_count` 仍是 0），激活时也一律读回主对话（2026-10-14 起，票 18；此前只在 `turn_count > 0` 时读回，新主对话打开是空的）。草稿从 `composer-draft.ts` 的草稿来（2026-10-16 起文字草稿也存到本机，重启后卡片照旧显示），侧栏订阅它（`subscribeComposerDrafts`），输入框的行为不变。在跑时卡片的字也从消息缓存来：主对话的 turns、正在流出的 `inFlightContent` 与这一轮的开跑时刻。卡片读这一轮是谁发起的、它此刻在不在写字（`useAssistantRound`，一个字符串：你发起的、你发起的且在写字、叫醒的），满几分钟（`useAssistantRunMinutes`：开跑时刻加已答完各段的用时，渲染期不读时钟，计时器只在整分钟时触发），叫醒的一轮算不算在打字（`useAssistantTyping`，与对话里的三点同一个判断：你发起的一轮不看流，叫醒的一轮才看；`hooks/useAssistantSentence.ts`）。顶栏在跑时什么都不读（裁决 134、135）。主对话不在屏上时 runner 的事件照样写进它的缓存（`ipc-handlers.ts` 按事件的会话追加，不看哪个会话开着），所以开着工作台会话时卡片也跟得上。`inFlightContent` 每个 chunk 都变，卡片不跟着每个 chunk 重渲染：选择器只返回字符串或布尔值，相同就不更新；判断在不在写字要清洗流（`cleanPartialContent`），只在流变了时做一次，卡片与对话共用结果（`cleanedStream`、`assistantWriting` 的单条缓存）。量得（2026-10-19，票 58，按选择器数）：你发起的两步一轮，14 个 chunk 期间顶栏、卡片都不重渲染（顶栏在开跑、两步落地、跑完时各一次，卡片在开跑、跑完与 turns 每次变化时）；叫醒的一轮只多卡片在第一个字流出时的一次。10-23 起顶栏不再读那句话，只在开跑、跑完时重渲染；卡片在你发起的一轮里另在「在不在写字」翻转时（`useAssistantRound` 换值）与每满一分钟时各重渲染一次（按代码推的，没有按选择器重新量过）。此前（票 52，裁决 104）顶栏读「在不在写字」的布尔值，两步一轮流出 51 个 chunk 时重渲染 5 次。
 - **新对话行**：外置运行时那颗「＋ 新对话 ⌘N」按钮，独占一行，是滚动列表吸顶的第一行（`sticky top-0`、不透明、压在行之上），上缘与左右各内缩 6px，下面第一个时间桶标题离按钮 18px（与外置相同，没有票 09 给分区头的首行收紧）；滚动定位留出它的 42px（`scroll-pt-[42px]`）。空白新对话的输入框开着时（项目的也算）整行亮，直到发出第一句、新会话行接替（上文「关键决策」）。mac 侧栏窄于 152px 时书眉的两个图标挪进这一行，此时只剩加号（票 42 前是 184px、三个图标）；这一行一直在，所以跨门槛时列表不上下动。Windows / Linux 没有窄态，最窄几档只让出 Ctrl+N（上文「关键决策」）。
 - **工作台不挂区名**（2026-10-20 起，[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 121，票 70，[devlog](../devlog/2026-10-20-workbench-label-on-the-line.md)「同日再收」；JC 真机看完票 69：「从 UI 简洁性上看，这个工作台是不是还是应该隐藏掉？因为只要用了一两次后，用户就知道这个区域是工作台了，后面非常长时间里这个是不是可能是一种多余的噪音呢？」）：侧栏照旧分成两个区，上面助理、下面工作台，有对话时两区之间只有那条线，哪个区都不挂区名。
   - **为什么**（裁决 121 第 1 条）：裁决 114 给区名的是两件事，「两区明显分开」与「说清下面那块做什么」，两件都不再需要它常驻。分开：票 62 JC 选带区名的 C 时，卡片还是 58px 的一行，他当时的不安是助理的视觉重心不够；后来解决重心的是票 67 的舞台（129px、居中、脸会动），现在分开两区的是舞台、`line-strong` 与底色。说用途：「工作台」这个词在界面上只出现在区名上（文案只有区名那一个键，助理手册里 0 处），没有任何地方叫用户「去工作台」，它不是要记住的地名，只是一次性的说明；用过一两次后，新对话行和列表自己说清了这块是什么。助理区不挂区名的理由照旧：卡片只有一个对象且自报家门，上面再挂「助理」等于名字上顶一个职位（[助手 PRD](../../.scratch/assistant/PRD.md) 裁决 7）。
@@ -330,7 +338,7 @@ motion 语义专属于 running：静态彩条表示「卡在这、需要你」

 第二行直接当状态行用，始终状态着色、**直立不斜体**，blocking 状态给显式文案，扫一眼即读懂、不靠解码图标：

-- running：`第 N 步 · {summary}`（brand-strong，N=最近完成步 `lastStepIndex`，故意比实时滞后一步）或首步未完成时 `思考中…`。这是工作台的会话行（子任务卡片同源）；助手卡片在跑时不报步数，写「正在输入…」（见上「助手卡片」，裁决 110；10-15 裁决 68 起曾说主区那一行的同一句）。N 是 run 内按位置的连续序号（2026-09-18）：GA 每次 `put_task` 步号从 1 重数，ask_user 回复也是一次 `put_task`，侧栏把 GA 步号加上回复前已完成的步数（messages `runStepBase`），与主视图序号栏同源，不再在回答后跳回「第 1 步」。
+- running：`第 N 步 · {summary}`（brand-strong，N=最近完成步 `lastStepIndex`，故意比实时滞后一步）或首步未完成时 `思考中…`。这是工作台的会话行（子任务卡片同源）；助手卡片在跑时不报步数，你发起的一轮写「正在工作…」（不在屏上时它在写字写「正在输入…」，满 1 分钟起「正在工作 · N 分钟」；见上「助手卡片」，裁决 134、135；裁决 110 起曾一律写「正在输入…」，10-15 裁决 68 起曾说主区那一行的同一句）。N 是 run 内按位置的连续序号（2026-09-18）：GA 每次 `put_task` 步号从 1 重数，ask_user 回复也是一次 `put_task`，侧栏把 GA 步号加上回复前已完成的步数（messages `runStepBase`），与主视图序号栏同源，不再在回答后跳回「第 1 步」。
 - ask_user：`等你回复`（warning，copy key `waitingForYou`）。
 - error：`出错 · N`（error，`errored`；N=1 时不显示计数）。
 - settled：只留 `{summary}`（muted）——「已完成」由左侧对勾圈说（2026-10-03；05-12 选的 `已完成 · ` 前缀当时只与「第 N 步 · 」和完成徽章比过，没测过不加前缀）。只有没跑完的才带词：cancelled `已中止 · {summary}`——用户主动中止的会话不得声称完成；步数上限暂停 `已暂停 · {summary}`（空心环）。标记例外、不标记常态，同「· 1 是噪音」。
````

#### 5. 验证命令与结果

在最终代码状态上跑（两个提交之前的工作树，内容与 `72ee7900` 相同，提交后 `git status` 干净）：

```
$ grep -rn "main chat 90\|useLiveProgressVariant\|LiveProgressVariant" gui/src
（无输出，exit 1）

$ pnpm --dir gui typecheck
> galley-desktop@0.7.0 typecheck ~/Documents/genericagent-webui-wt91/gui
> tsc --noEmit
（exit 0）

$ pnpm --dir gui lint
> galley-desktop@0.7.0 lint ~/Documents/genericagent-webui-wt91/gui
> eslint src --max-warnings 0
（exit 0）

$ CI=true pnpm --dir gui test
 Test Files  204 passed (204)
      Tests  2251 passed (2251)
   Start at  17:05:11
   Duration  44.26s (transform 14.76s, setup 4.62s, import 493.08s, tests 29.20s, environment 18.87s)

$ TZ=UTC CI=true pnpm --dir gui test
 Test Files  204 passed (204)
      Tests  2251 passed (2251)
   Start at  09:06:03
   Duration  44.99s (transform 11.54s, setup 4.69s, import 487.59s, tests 30.59s, environment 17.47s)

$ git diff --check
（无输出，exit 0；暂存区 git diff --cached --check 同样 exit 0）
```

另外跑过的：挪过的与改过的 7 个测试文件在 `TZ=America/Los_Angeles` 下 130 条全过；旧文件只格式化自己的 hunk（逐文件比 HEAD 版与改后版被 prettier 改动的行数，22 个文件两边相同；新文件 `useTypingBubbleHandoff.test.tsx` 过 `prettier --check`）；两份文档与 `zh.ts` 新增行扫过半角标点，只命中下面第 5 条那一处有意的「;」。合入后的状态见第 1 条。

#### 6. 看到但没改的、没验证到的

看到但没改：

1. `docs/design/foundations.md` 三处还是旧说法（不在派单的两份文档里，没动）：`:572` 起「助手的对话在跑时不读秒，对话里是三点气泡，用时在过程卡片第一行」；`:649` 起三点气泡「是对话里唯一的在忙信号，计时不在同一处（顶栏不计时，用时在过程卡片）」；`:655`「那一行字已经说它在做什么」，同一处引的 `AssistantIdentity.tsx:60` 现在是 `:53`（同句的 `App.tsx:796` 早在票 90 之前就不准，`AssistantFaceDriver` 在 `:826`）。
2. `layout-and-chrome.md:285`「名字在哪」引的 `SidebarAssistant.tsx:394` `SidebarAssistantEmptyHint` 票 90 之前就不准（当时 411），现在是 `:428`；那一条不在助手卡片里，没动。§4.2 助手卡片「构造」里的行号（票 90 已经挪偏）我按现在的代码改了。
3. `hooks/useAssistantSentence.ts` 现在只剩卡片的打字判断，文件名没改。它的测试里 typing 那组的标题仍写「the card's 「正在输入…」 with it」「says the card types as the dots do: throughout a round you start」：断言的是选择器的值（没变），而你发起的一轮里卡片现在由 `working` 说话；重渲染那条的卡片读数模型也没加 `useAssistantRound` 与分钟数的选择器（它们的换值在 `useAssistantProgress.test.tsx` 里测）。
4. `conversation.md` 里 grep「顶栏」以外、同样描述在跑时的三处我也对齐了：开头「Turn 结构」那段「在跑时只有一行」（裁决 110 起就不准）、Response Handling 开头「在跑时对话里只有三点气泡」、Thinking Placeholder 里「在跑时哪里都不计时」。
5. 文档里「按**最后一个**「；」或「;」切开」的半角分号是有意的（说的就是这个字符）。
6. 票 90 记下的边界照旧（裁决 135 第 3 条已写进文档的「代价」）：`ask_user` 那一步的后半句会在问题到来前出现一下；设置页盖着时卡片算在屏上；两种流里 summary 先于派发是读码推的；卡片的分钟计时在主对话开着时也每整分钟重渲染一次（输出不变）；你发起的一轮里每个 chunk 多算一次 `assistantWriting`（两处共用单条缓存，没测过开销）。
7. `layout-and-chrome.md`「数据只在界面里取」里写的「卡片在你发起的一轮里另在『在不在写字』翻转时与每满一分钟时各重渲染一次」是按代码推的，没有照票 58 的办法按选择器重新量过，文档里写明了。

没验证到：

1. 真机：没跑 `tauri dev`。「新」的外观、交接、读屏没动，只靠测试断言（同票 90 的「没验证到」）。
2. VoiceOver 实听、Windows 都没跑。
3. 合入后的状态只在 scratchpad 的 `git archive` 副本里跑了 gui 的测试、eslint、tsc；这张票没动 Rust，没跑 `cargo`。

### 2026-10-23 主会话验收

- 在 worktree 里 `git rebase main`：票 92 的 `bf613e4f` 改过切换器快照、本票删了整个目录，modify/delete 冲突按预告保留删除（`git rm`）；`docs/design/conversation.md` 两票不同节，自动合并，裁决 135 与 136 的段落都在。
- 抽查 `MainView`、`AssistantIdentity`、`lib/assistant.ts` 的改动与注释，与裁决 134、135 一致。
- 代理报的 `docs/design/foundations.md` 三处旧说法改掉（第 572 行一带「在跑时不读秒」、§2.7 的三点豁免段「唯一的在忙信号，计时不在同一处」、助理的脸那条「那一行字已经说它在做什么」），顺手更新两处过时的行号（`AssistantIdentity.tsx:53`、`App.tsx:826`）。
- 门禁在 rebase 后的最终状态上重跑：`pnpm --dir gui typecheck`、`pnpm --dir gui lint` exit 0；`CI=true pnpm --dir gui test` 与 `TZ=UTC CI=true pnpm --dir gui test` 各 205 文件 2263 测试全过；`node scripts/check-docs-links.mjs` 通过；`git diff --check` 干净；`grep` 切换器与 `assistantSettledSentence` 残留为空。
