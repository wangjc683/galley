# 58 定第 2 档：拆掉切换器与第 1 档，设计文档定稿

Status: needs-dogfood（2026-10-19 合入 `3d9232f4`、`7cf949db`；主会话复跑门禁：typecheck、lint、两个时区各 1853 条全过，grep 为空）

来源：主聊天 PRD 裁决 110（2026-10-19，JC 真机比完票 55 定第 2 档）。依赖 55（已合入，`b44520a9`）。只改 GUI 与文档；Core、runner、提示词不动。

## 一、代码：第 2 档成为唯一画法

- **删掉切换器与演示**：`gui/src/components/conversation/typing-trial/` 里的档位 store、`TypingTrialSwitcher.tsx`、`typing-trial-demo.ts`；`gui/src/App.tsx` 里挂 pill 的那段；`MainView.tsx` 里演示时停用输入框与占位说明的那几处；只给 pill 和演示用的 i18n 键（中英一起删）。每个分支点都带「票 55 临时切换器，定档后由拆除票删掉」的注释，`grep -rn "票 55" gui/src` 找全，删完这条 grep 应为空。
- **第 2 档的部件挪到常驻的位置**：`TypingBubble.tsx`、`useTypingBubbleHandoff.ts`、规则函数（`typingBubbleShown`、`assistantSettledSentence` 等）从 `typing-trial/` 挪到照本地习惯该在的地方（部件放 `components/conversation/`，规则并进 `lib/assistant-conversation.ts` 或同类文件，钩子放 `hooks/`），名字去掉 trial 字样；`typing-trial/` 目录删空。
- **删掉只服务第 1 档的代码**（先 grep 确认没有别的调用方，有就留着并在回报里写明）：
  - 对话末尾那一行灰字：`AssistantParts.tsx` 的 `AssistantLiveLine`、它的计时（`assistantLineClock`、`ASSISTANT_LINE_CLOCK_AFTER_MS` 一类）；`MainView.tsx` 里画它的分支。
  - 从灰字那一行起长的交接：`useLiveLineHandoff.ts` 里记那一行位置、离场拷贝、量字宽的部分。气泡展开、`bubbleGrowInsets`、`handoffFadeIn`、跟随物、`findBubble`、`useStickyScroll` 的定时落地、`liveLineHandoff` 的「放不放」判断照留，必要时并进三点气泡的交接里，别留两套。
  - 顶栏在跑时「思考中 / 正在输入…」两个词的那套（裁决 104 的 `useAssistantWriting` 给顶栏的那条路）；`assistantWriting` 本身还给叫醒的一轮判三点，留着。
  - 卡片在主对话没开着时说那句过程的那条路（`useAssistantSentence`、`assistantCachedSentence` 给卡片的那条），第 2 档卡片在跑时一律「正在输入…」，叫醒的一轮写字前是最后一句。还被别处用的留着。
- **行为与票 55 的第 2 档逐像素一致**：拆完后，主对话在你发起的一轮、叫醒的一轮、不出声的一轮、提问、减少动态这些情形下，与拆之前把档位固定在 2 时的画面相同（用票 55 留下的 harness 思路拍前后对照，逐像素相减）。工作台、子任务、外置运行时零变化。
- 测试：删掉只测切换器、演示、第 1 档的用例；第 2 档的规则测试跟着挪过去；第 1 档被删掉的行为若有测试守着，改成守第 2 档。

## 二、文档定稿

- `docs/design/conversation.md`「助手的对话」：
  - 「**过程：一行**」整节改写成「**在跑时：三点气泡**」：对话里的规则（你发起的一轮从发出起；叫醒的一轮写字才有、写字停下就收起；不出声的一轮什么都不画；问你时不画；三点气泡的尺寸、底色、节奏、读屏、减少动态；撑成回复的交接、同步跟随、对话不满一屏时的上移）；顶栏写做完的那一步的那句话、不计时、没有就「思考中」、截断与悬停全文；卡片在跑时「正在输入…」、叫醒的一轮跟着三点。带裁决 107、110，写一两句为什么（普通用户、IM 习惯、每样东西只在一处说、计时为什么去掉），历史压成一句（「2026-10-15 到 10-19 是一行灰字，裁决 103 起长成气泡」）。
  - 「过程：一行」里「没有旁白时用 summary」「summary 的清洗」两条现在服务顶栏那句，挪到新节里，说明不取正在流出的文字。「落定后」「过程卡片」等后续小节不变，标题若带「一行」改成合适的名字。
  - 全文 grep「那一行」「`AssistantLiveLine`」「在跑时那一行」「对话末尾那一行」，逐处改成三点气泡或删掉（Streaming generation、Thinking Placeholder、Sticky-bottom、Scroll behaviour、叫醒、不出声的回复、时间条、分组间距、你的气泡那一行的间距说明都提到过）。改的时候保留裁决号与日期，不把历史全删，压成一句。
- `docs/design/layout-and-chrome.md`：§4.1「开着助手时是身份行」在跑时那句话的规则；§4.2「助手卡片」的「第二行」「在跑时说什么」「数据只在界面里取」改成第 2 档（带裁决 110）。
- `docs/design/foundations.md` §2.7：补一句主对话的三点气泡是允许的约定俗成指示（三点 working 指示，计时不在同一处，所以不与扫光豁免冲突）；扫光豁免「当前独占 thinking 行」如果提到主对话那一行，改掉。
- `docs/devlog/deferred.md`：新增一节「顶栏在跑超过 1 分钟接用时」，固定字段照文件开头的说明：**状态** 暂缓（2026-10-19 裁决 107、110）；**提出** 裁决 107 讨论计时时；**启动信号** 真机碰到一次某一步卡很久、分不清慢与卡；**方案** 主对话在跑超过 60 秒时，顶栏那句后面接「· 1 分 12 秒」（整秒，与过程卡片的用时同源）；**待定** 阈值；**关联** `docs/design/conversation.md`「在跑时：三点气泡」、`AssistantIdentity.tsx`。
- 不写 devlog（主会话写）；不改 PRD。全角标点。

## 别动

- 工作台、子任务、外置运行时；票 53、56、57 的悬停行、选中工具条与悬停区。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk；挪过去的新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- `grep -rn "票 55\|typing-trial\|TypingTrial" gui/src` 为空。
- 前后对照：拆之前（main，档位固定 2）与拆之后，主对话各情形逐像素相减为零；工作台、外置运行时零变化。截图放 scratchpad、文件名带 `t58-` 前缀，截完删临时页，**自己起的 Vite / 浏览器进程收尾时全部停掉**（上一张票留下过一个没关的 Vite）。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 删了什么、挪了什么、留了什么（各列文件或函数，带 `file:line`；留下的写清还有谁在用）。
3. 文档改了哪些节（列标题），deferred 新节的标题。
4. 验证命令与结果原样（测试条数、两个时区）、grep 结果、逐像素对照结果。
5. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 切换器的 pill 不见了；主对话发一句要跑几步的，照第 2 档：三点气泡、顶栏换句、卡片「正在输入…」，回复从三点气泡撑开。
2. 等一次到点提醒（或子任务交代），看叫醒的一轮：写字前对话里什么都不冒，写字时才出三点，卡片跟着三点。
3. 切到工作台会话跑一轮：右下角计时、过程那一行照旧，和拆之前一样。

## Comments

- 2026-10-19（实现子代理）：已在分支 `main-chat-58-typing-bubble-final` 做完，待主会话合入与 JC 真机（代码 `f6d981d6`，文档另一提交）。
  - **删**：切换器、演示与档位 store（`typing-trial/` 整个目录）；`AssistantLiveLine` 与它的计时（`assistantLineClock`、`ASSISTANT_LINE_CLOCK_AFTER_MS`）；`hooks/useLiveLineHandoff.ts`（记那一行的位置、离场拷贝、`lineTextWidth`）；顶栏两个词那套（`assistantState` 的 `writing`、`useAssistantWriting`）；卡片在主对话没开着时说那句的那条（`useAssistantSentence`、`assistantCachedSentence`）；`assistantLineSentence` 并进 `assistantSettledSentence`（只给顶栏，不再读流）。只给 pill 和演示用的 i18n 键原本就没有（它们的字写在组件里），`typingLabel` 给三点气泡读屏，留着。
  - **挪**：`TypingBubble.tsx` → `components/conversation/`；交接 → `hooks/useTypingBubbleHandoff.ts`（`findBubble`、`followersOf` 并进来，只剩一套）；规则 → `lib/assistant-conversation.ts`（`typingBubbleShown`、`assistantTyping`、`assistantSettledSentence`、点的尺寸常量）；`lib/live-line-handoff.ts` 改名 `lib/typing-bubble-handoff.ts`（`liveLineHandoff` → `typingBubbleHandoff`，判断不变）；卡片的规则并进 `assistantCardLine`（`typing` 参数）。
  - **前后对照**：同一个 harness（票 55 的思路，演示脚本拷进 harness，不进仓库）在 `f2cd8a34`（档位固定 2）与本分支上逐帧相减：你发起的一轮、叫醒的一轮、不出声的一轮、深色、减少动态、工作台三段脚本共 145 帧，交接帧条（你发起、叫醒、没流式、长回复、提问、减少动态、提问减少动态、深色、工作台）63 帧，全为零。GPU 光栅化下头像边缘一个像素会在同一棵树的两次运行之间随机跳，换成软件光栅化（`--disable-gpu` 等）后稳定，最终一轮用的是它。截图在主会话 scratchpad，文件名带 `t58-`。
