# 90 在跑时的进展：临时切换器（现状 / 新）

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 134（2026-10-23；JC：「1，卡片用『正在工作…』；2，按你推荐，先试试 S1；3，按你推荐」）。只改 GUI，做一个临时切换器给 JC 真机比；定档、拆切换器与改设计文档另开一张票，这张不改设计文档。

## 为什么

- v0.7.0 的用户反馈：主对话跑一个耗时的活（没派子任务）时，用户只看到对话末尾的三点气泡和侧栏卡片上一直挂着的「正在输入…」，没注意顶栏身份行第二行那句进展，以为软件卡死了，等了好几分钟。
- 原因是位置：用户的眼睛在对话末尾，顶栏那句在左上角、11px、只在一步做完时换。所以进展挪到三点气泡下面，顶栏在跑时不再说进展，卡片换词并只替屏上说看不到的那部分。

## 要做的

只在「新」档生效；「现状」档与改前逐字节一致。范围只是**主对话**（`MainView` 的 `isMainChat`）里**你发起的一轮**（不是叫醒的一轮，判定同三点气泡：`lib/subtasks.ts` 的 `inReportRound`，`lib/assistant-conversation.ts` 里的 `cachedReportRound`）。

### 1. 对话里：三点气泡下面一行小字

- **何时在**：与三点气泡同进同出（`typingBubbleShown` 为真、且不是叫醒的一轮）。从发出那一刻起就在，没有门槛。它在问你时三点不画，这一行也不画。
- **放在哪**：`TypingBubble` 根节点里、气泡下面，左缘与气泡左缘对齐，上间距 6px。放在同一个根节点里，贴底跟随（`useStickyScroll`、`assistantFollowTop`）把它当成这一行的一部分；它恒为一行高，换字不改高度。
- **写法**：`{在做什么} · {用时}`。12px，`text-ink-soft`，`tabular-nums`，不扫光、不加动画。在做什么那段 `min-w-0` 渐隐截断（照顶栏身份行的做法：`truncate-fade` + `truncationFadeRef`，悬停 `syncTruncatedTitle` 给全文）；` · ` 与用时 `shrink-0`，永远不截。
- **在做什么**（这一轮的「这一段」：从你最后一条消息起，你答完它的提问则从答完起；同 `assistantSettledSentence` 的取段）：
  1. 这一段里还没有任何一步出现过工具派发：写「思考中」。
  2. 当前这一步的流（`inFlightContent`）里已出现工具派发标记（`gui/src/lib/ipc/ga-output-cleaning.ts` 的 `modelReplyEnd(...) !== -1`），且派发之前有一个闭合的 `<summary>…</summary>`（不在没闭合的 `<thinking>` 里）：写这个 summary 的后半句（规则见下）。
  3. 否则，这一段里最新一个调了工具的已落定步（`turn.role === "agent"`、不是收口的回答 `isFinalAnswerTurn`、`turn.summary` 可用）：写它的 summary 的后半句。即两步之间留着上一句，落定后与流里读到的是同一句、不跳。
  4. 当前这一步正在写字（`assistantWriting(inFlightContent)` 为真）时，以上都让位，写「正在写回复」。写字停下、出现派发，按第 2 条换句。
  - 没有派发就不换句：收口那一步（只有 summary 与回复、没有工具）的 summary 永远不上屏，回复的结论不会先被剧透。
  - **后半句**：summary 先照 `assistantSummaryLine` 同一套清洗（`cleanSessionSummary` 那一路；`isProtocolFailureSummary` 的不算，当作没有）；按**最后一个**「；」或「;」切开取后面那段，去掉首尾空白和结尾的「。」「.」；没有分隔就用整句；切出来是空的也用整句。不再往下截（例如不按逗号截），长了交给 CSS 截断。
  - 例（库里真实 summary）：「提醒规则已确认；我读取当前时间并检查是否已有喝水提醒。」→「我读取当前时间并检查是否已有喝水提醒」；「我先核对当前时间和提醒命令，设置三分钟后的喝水提醒。」→ 整句去掉句号。
  - 派发标记、`<summary>` 在流里的样子以 `ga-output-cleaning.ts` 现有的判定与测试夹具为准；不同模型、原生工具调用与 GA 文本协议两种流都要对。若发现某种流里 summary 在派发之后才出现或根本不在 `inFlightContent` 里，退到第 3 条（落定后才换），并在回报里写明是哪种。
- **用时**：这一轮开跑起的整秒，各段相加、等你回答的时间不算，取法与工作台右下角计时 `RunElapsedHud` 完全一样（`MainView` 里的开跑时刻与 `liveRunElapsedBaseMs(turns)`），格式也一样：60 秒以内 `copy.conversation.seconds`（「12 秒」），以上 `minutesSeconds`（「1 分 12 秒」）。不到 1 秒时只写在做什么、不带「 · 用时」。每秒更新只重渲染这一行；渲染期不读 `Date.now()`（React 编译器 lint），照 `RunElapsedHud` 用计时器写状态。
- **读屏**：三点的根节点是 `role="status"`（礼貌朗读）。每秒跳的用时不能在朗读区里（`aria-hidden`，或把这一行放到朗读区外再单独处理在做什么），否则读屏每秒播一次；在做什么换句时可以朗读。
- **交接**：回复或它的提问落地、三点让位时（`hooks/useTypingBubbleHandoff.ts`、`lib/typing-bubble-handoff.ts`），这一行与三个点的拷贝一样在原位淡出（同一时长、同一曲线），不进版面；回复照旧从三点气泡的框撑开，几何不变。停止、出错时与三点一起直接消失。

### 2. 顶栏

在跑（`AssistantState.kind === "running"`）时身份行没有第二行（`line` 为 null），与静止时一样。等你回复、出错、子任务在问你或出错照旧。不改优先级：在跑时子任务的状态原来就被在跑盖住，现在照旧不显示。

### 3. 侧栏卡片

只改你发起的一轮在跑时的第二行（`lib/assistant.ts` 的 `assistantCardLine` 的 running 分支）；叫醒的一轮照旧（它写字时「正在输入…」，否则最后一句）。

| | 主对话在屏上（卡片现有的 `open`） | 不在屏上 |
|---|---|---|
| 它在写字（`assistantWriting`） | 正在工作… | 正在输入… |
| 其余，不满 1 分钟 | 正在工作… | 正在工作… |
| 其余，满 1 分钟 | 正在工作… | 正在工作 · N 分钟（N 为整分钟，向下取整） |

- 「在屏上」用卡片现有的 `open`（`SidebarAssistant.tsx:198`：主对话本身开着、它的对话在屏上）。与 `lib/todo-open.ts` 的 `mainChatOnScreen` 对一下，口径不一致（例如设置页盖着时）就在回报里写明，不要自己改 `open` 的定义。
- 分钟数用同一个用时来源，只在跨整分钟时更新卡片，不按秒重渲染。
- 色调同现在的 running（brand）。头像那张脸不动。

### 4. 文案（新键，zh / en 逐字）

- 卡片：「正在工作…」/ `Working…`
- 卡片满 1 分钟：「正在工作 · {n} 分钟」/ `Working · {n} min`
- 小字开头：「思考中」/ `Thinking`
- 小字写字时：「正在写回复」/ `Writing the reply`
- 用时沿用 `conversation.seconds` / `conversation.minutesSeconds`，分隔符「 · 」。

键放在 `assistant` 命名空间（`typing` 旁边），名字你定。

### 5. 切换器的壳

照票 85 的 pill（`git show 13092922 -- gui/src/components/todo/todo-variants/TodoVariantsPill.tsx`，票 86 已拆掉：常驻可点击，portal 到 `<body>`、`pointer-events: auto`，只在 dev 构建出现，两处判 `import.meta.env.DEV`，选择只记在内存里，默认「现状」）。档名写死：「临时 · 在跑」「现状」「新」。位置照票 85（窗口水平居中、顶栏下 52px）。切档要能在一轮跑着的时候即时生效（JC 会在同一轮里来回切比）。拆法写在新的变体文件头（删哪些、接入点在哪、定「新」后保留哪几行、定「现状」后删哪几行），每个接入点标「TEMP variant switcher (main chat 90)」。

## 测试

- **现状逐字不变**：改代码前先记快照（三点气泡在跑时的 DOM、顶栏身份行在跑时、卡片在跑时开着与没开着），改完在「现状」档逐字比。现有 `MainView.assistant.test.tsx`、`Sidebar.main-chat.test.tsx`、`MainHeader.identity.test.tsx`、`assistant.test.ts`、`assistant-conversation.test.ts`、`useAssistantSentence.test.ts` 不改断言、照旧全过。
- **后半句**：有「；」、有「;」、两个分号取最后一个、没有分隔、结尾句号、切出来为空、协议失败的 summary、清洗后为空。
- **在做什么**（纯函数，给 turns 与 `inFlightContent`）：开头「思考中」；流里派发出现后换成流里那个 summary；派发前 summary 已闭合但还没派发时不换；两步之间留上一句；落定后与流里那句相同；写字时「正在写回复」；收口那一步的 summary 永远不出现；答完提问回到「思考中」；叫醒的一轮不画。原生工具调用与 GA 文本协议两种流各至少一例（夹具照 `ga-output-cleaning` 的测试）。
- **用时**：不到 1 秒不带用时；59 秒「59 秒」、60 秒「1 分 0 秒」（与 `RunElapsedHud` 一致）；有答完的提问时各段相加。
- **卡片**：上表六格；叫醒的一轮照旧。
- **顶栏**：「新」档在跑时无第二行，等你回复、出错照旧。
- **读屏**：用时不在 `role="status"` 的朗读区里。
- **pill** 只在 DEV；标记只出现在拆法列出的文件里。
- 时间相关的测试在 `TZ=UTC` 下也跑一遍（CI 跑在 UTC）。

## 别动

- 主工作树：只在 `/Users/inkstone/Documents/genericagent-webui-wt90`（分支 `ticket-90-live-progress-line`，从本地 main 起）里做，不碰主树，不跑 `tauri dev`。
- 工作台对话、从助手点开的子任务、外置运行时：逐像素不变（它们不走 `isMainChat`）。工作台的 `RunElapsedHud`、思考行不动。
- 三点气泡本身的样子与交接几何（票 51、55、58）；过程卡片；回复的行动条；头像的脸。
- `core/`、`runner/`、`managed-ga/`、提示词、手册；设计文档（定档票改）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都报错；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC pnpm --dir gui test` 全过
- `git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 「在做什么」的判定函数与后半句函数的 diff 原样。
3. 小字的 JSX 与交接改动的 diff 原样。
4. 卡片 running 分支的 diff 原样。
5. 两种流（原生工具调用 / GA 文本协议）里 summary 与派发标记的先后，各贴一段夹具。
6. `open` 与 `mainChatOnScreen` 的口径对比结论。
7. 拆法（文件头那段原样）。
8. 验证命令与结果原样。
9. 看到但没改的问题、没验证到的地方。

## 给 JC 的真机步骤

1. 合入后（纯 GUI，热更新），在 Galley 里问一个要查网页的问题（例如「新赛季 NBA 东部你怎么预测？」，本机这类约 70–110 秒）。
2. pill 在「现状」「新」之间来回切，同一轮里比：三点下面那一行读不读得进、会不会读成工作台的日志、换句的节奏吵不吵、用时跳着焦不焦虑；顶栏空着时找不找得到「它在干嘛」。
3. 跑着的时候切去工作台或设置，看卡片：「正在工作…」，满 1 分钟「正在工作 · 1 分钟」；回到 Galley 看卡片是不是一直「正在工作…」。
4. 再让它记一件事（「明天下午三点提醒我交报告」），看短回合里那一行与回复交接时的样子。浅色、深色各看一遍。
5. 定「新」或「现状」告诉我；定档票按那一档写死、拆切换器、改设计文档。

## Comments

### 2026-10-23 实现回报（票 90 子代理）

在 `/Users/inkstone/Documents/genericagent-webui-wt90`（分支 `ticket-90-live-progress-line`）里做完，没碰主树、没跑 `tauri dev`、没 push、没合入。只改 GUI；设计文档、`core/`、`runner/`、`managed-ga/` 都没动。

#### 1. 提交列表

```
2bd39ee2 Ticket 90: a temporary switcher for what the main chat says while it runs (现状 / 新)
f6cfbb22 Ticket 90: snapshot the main chat's in-run markup before the switcher
```

（本回报自己的提交在这之后，见我交回给主会话的那份。）`f6cfbb22` 是先记的快照：在改任何代码之前，用当时的代码渲染三点气泡在跑时的对话区（刚发出、两步之间、派发时、写字时、叫醒的一轮写字时）、顶栏身份行在跑时（「思考中」与落定那一句）、卡片在跑时（开着与没开着、叫醒的一轮）共 11 份快照；`2bd39ee2` 之后「现状」档照旧逐字节对上这 11 份（快照文件在第二个提交里没有改动）。

#### 2. 「在做什么」的判定函数与后半句函数（`gui/src/lib/assistant-progress.ts`，新文件，diff 原样）

下面几段 diff 里，空的上下文行去掉了行首那一个空格（不然 `git diff --check` 报尾随空白），其余逐字。

```diff
diff --git a/gui/src/lib/assistant-progress.ts b/gui/src/lib/assistant-progress.ts
new file mode 100644
index 00000000..0e8f229d
--- /dev/null
+++ b/gui/src/lib/assistant-progress.ts
@@ -0,0 +1,204 @@
+import type { AppCopy } from "@/i18n/types";
+import { isFinalAnswerTurn } from "@/lib/agent-turn";
+import {
+  assistantFirstLine,
+  assistantTyping,
+  assistantWriting,
+} from "@/lib/assistant-conversation";
+import { modelReplyEnd } from "@/lib/ipc/ga-output-cleaning";
+import { isProtocolFailureSummary } from "@/lib/session-summary";
+import type { Turn } from "@/types/conversation";
+
+/*
+ * TEMP variant switcher (main chat 90) — what 「新」 says while the main
+ * chat runs (main chat PRD ruling 134; switcher and removal steps in
+ * components/conversation/live-progress-variants/live-progress-variants.ts).
+ * Kept if 「新」 wins, deleted with its test if 「现状」 does.
+ *
+ * In a round you started, a line under the typing bubble says
+ * 「{在做什么} · {用时}」 (TypingBubble), and the sidebar card says
+ * 「正在工作…」, away from the main chat 「正在输入…」 while it writes
+ * and the whole minutes from one on (lib/assistant.ts
+ * `assistantCardLine`). A round Core woke it for draws no line.
+ */
+
+// ---- 在做什么 ----------------------------------------------------------------
+
+const END_PERIODS = /[。.]+$/;
+
+function trimHalf(text: string): string {
+  return text.trim().replace(END_PERIODS, "").trim();
+}
+
+/**
+ * The half of a step's summary the line says. GA's summary is 「上次结果
+ * 的新信息 + 本次意图」 (managed-ga llmcore's protocol prompts), so the
+ * part after the last 「；」 or 「;」 is what it is doing now. The summary
+ * is cleaned first as the header cleaned it (`assistantFirstLine`: one
+ * line, block markers and markdown out, protocol tags and GA's 「...」
+ * repaired); a turn-protocol failure's (`isProtocolFailureSummary`) is
+ * none. Then the part after the last separator, its surrounding
+ * whitespace and the 「。」 / 「.」 it ends with taken off; without a
+ * separator, or with nothing after it, the whole sentence, trimmed the
+ * same way. Nothing is cut further (no cut at a comma): a long one is
+ * the CSS truncation's. Null when nothing is left.
+ */
+export function assistantProgressHalf(
+  summary: string | null | undefined,
+): string | null {
+  if (!summary || isProtocolFailureSummary(summary)) return null;
+  const line = assistantFirstLine(summary);
+  if (!line) return null;
+  const cut = Math.max(line.lastIndexOf("；"), line.lastIndexOf(";"));
+  const after = cut === -1 ? "" : trimHalf(line.slice(cut + 1));
+  return after || trimHalf(line) || null;
+}
+
+/** GA's `smart_format(text, max_str_len=80)` (ga.py), which shortens the
+ * summary it keeps: under 90 characters as is, else the first 40, 「 ...
+ * 」, the last 40. Python counts code points, so these do too. */
+function gaSmartFormat(text: string): string {
+  const chars = Array.from(text);
+  if (chars.length < 90) return text;
+  return `${chars.slice(0, 40).join("")} ... ${chars.slice(-40).join("")}`;
+}
+
+/** What GA takes out of the reply before it looks for the summary: the
+ * reasoning blocks its response parsers drop (llmcore
+ * `_parse_mixed_response`, `NativeClaudeSession.ask`), then code fences
+ * and closed thinking blocks (ga.py `turn_end_callback`). */
+const GA_THINK_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g;
+const GA_SUMMARY_NOISE = /```[\s\S]*?```|<thinking>[\s\S]*?<\/thinking>/g;
+const GA_SUMMARY = /<summary>([\s\S]*?)<\/summary>/;
+const THINKING_OPEN = "<thinking>";
+
+/**
+ * The summary of the step streaming now, once its tool dispatch shows —
+ * the summary GA will keep for it, so the line says the same sentence
+ * when the step settles. Null before the dispatch (`modelReplyEnd`: GA's
+ * dispatch marker follows the model's whole reply in the same buffer),
+ * and without a closed `<summary>` before it. Read as GA reads the reply
+ * (ga.py `turn_end_callback`): reasoning blocks, code fences and closed
+ * `<thinking>` blocks out, the first `<summary>…</summary>`, trimmed, its
+ * line breaks taken out, `smart_format`ted. A summary inside a
+ * `<thinking>` that never closed is not one (the step's reply is over at
+ * its dispatch, whatever it left open, as `extractLiveThinking` reads
+ * it): the line keeps the step before until this one settles.
+ *
+ * Both streams have it before the marker: with native tool calls the
+ * model's text (its `<summary>`, or the one GA writes from the first line
+ * of its reasoning when it wrote no text: llmcore `_ensure_text_block`)
+ * streams before the call, which is not in the stream at all; with GA's
+ * text protocol `<summary>` and then `<tool_use>…</tool_use>` stream as
+ * text. Either way GA's agent loop yields the dispatch marker only after
+ * the whole reply.
+ */
+export function streamedStepSummary(inFlightContent: string): string | null {
+  const end = modelReplyEnd(inFlightContent);
+  if (end === -1) return null;
+  let reply = inFlightContent
+    .slice(0, end)
+    .replace(GA_THINK_BLOCK, "")
+    .replace(GA_SUMMARY_NOISE, "");
+  const unclosed = reply.indexOf(THINKING_OPEN);
+  if (unclosed !== -1) reply = reply.slice(0, unclosed);
+  const match = GA_SUMMARY.exec(reply);
+  if (!match) return null;
+  return gaSmartFormat(match[1].trim().replace(/\n/g, ""));
+}
+
+/** The newest settled step of this stretch that called tools and has a
+ * summary the line can say (`assistantProgressHalf`). */
+function settledStepHalf(turns: readonly Turn[]): string | null {
+  for (let i = turns.length - 1; i >= 0; i--) {
+    const turn = turns[i];
+    if (turn.role === "user") break;
+    if (turn.role !== "agent" || isFinalAnswerTurn(turn.tools)) continue;
+    const half = assistantProgressHalf(turn.summary);
+    if (half) return half;
+  }
+  return null;
+}
+
+/**
+ * What the line under the typing bubble says it is doing (ruling 134),
+ * for a round you started; null for a round Core woke it for (no line:
+ * nobody is waiting on it). Within this stretch — from your last message,
+ * or from your answer to its question (`assistantSettledSentence`'s
+ * stretch):
+ *
+ *   1. writing words now (`assistantWriting`): 「正在写回复」;
+ *   2. else this step's dispatch has shown with a closed summary before
+ *      it (`streamedStepSummary`): that summary's half;
+ *   3. else the newest settled step that called tools (not the round's
+ *      answer) with a summary: its half — between two steps the last
+ *      one stays, and once a step settles the line says what it said
+ *      from its dispatch on;
+ *   4. else 「思考中」 — before any step dispatched, and again after you
+ *      answer its question.
+ *
+ * Without a dispatch the sentence does not change, so the closing step's
+ * summary (a reply, no tools) never shows: the reply's conclusion is not
+ * given away before it lands.
+ */
+export function assistantDoing(
+  turns: readonly Turn[],
+  inFlightContent: string,
+  copy: AppCopy,
+): string | null {
+  // A round you started reads as typing with nothing streaming
+  // (`assistantTyping`'s report-round check, kept for the last turns).
+  if (!assistantTyping(turns, "")) return null;
+  if (assistantWriting(inFlightContent)) {
+    return copy.assistant.progressWriting;
+  }
+  return (
+    assistantProgressHalf(streamedStepSummary(inFlightContent)) ??
+    settledStepHalf(turns) ??
+    copy.assistant.progressThinking
+  );
+}
+
```

#### 3. 小字的 JSX 与交接（diff 原样）

```diff
diff --git a/gui/src/components/conversation/TypingBubble.tsx b/gui/src/components/conversation/TypingBubble.tsx
index e6a5a109..e3a7a1eb 100644
--- a/gui/src/components/conversation/TypingBubble.tsx
+++ b/gui/src/components/conversation/TypingBubble.tsx
@@ -1,7 +1,13 @@
-import type { Ref } from "react";
+import { useEffect, useState, type Ref } from "react";

+// TEMP variant switcher (main chat 90): the line under the dots.
+import { ASSISTANT_BUBBLE_MAX } from "@/components/conversation/AssistantParts";
 import { TYPING_DOT_EM, TYPING_DOT_GAP_EM } from "@/lib/assistant-conversation";
+import { assistantProgressElapsed } from "@/lib/assistant-progress";
 import { useCopy } from "@/lib/i18n";
+import { syncTruncatedTitle } from "@/lib/truncated-title";
+import { truncationFadeRef } from "@/lib/truncation-fade";
+import { cn } from "@/lib/utils";

 const DOT_STYLE = {
   width: `${TYPING_DOT_EM}em`,
@@ -28,7 +34,15 @@ const DOT_STYLE = {
  * bar row — your bubble's 30px, or the last reply's action bar), so the
  * bubble opens where the dots were (hooks/useTypingBubbleHandoff.ts).
  */
-export function TypingBubble({ ref }: { ref?: Ref<HTMLDivElement> }) {
+export function TypingBubble({
+  ref,
+  progress,
+}: {
+  ref?: Ref<HTMLDivElement>;
+  /** TEMP variant switcher (main chat 90): 「新」's line under the dots,
+   * in a round you started; absent, the bubble alone. */
+  progress?: TypingProgress | null;
+}) {
   const copy = useCopy();
   return (
     <div ref={ref} data-role="assistant-typing" role="status">
@@ -57,6 +71,91 @@ export function TypingBubble({ ref }: { ref?: Ref<HTMLDivElement> }) {
           />
         </span>
       </div>
+      {progress && <ProgressLine progress={progress} />}
     </div>
   );
 }
+
+// ---- TEMP variant switcher (main chat 90): the line under the dots -------
+
+/** What the line says (MainView): what it is doing, and the run clock. */
+export interface TypingProgress {
+  /** lib/assistant-progress.ts `assistantDoing`. */
+  doing: string;
+  /** The round's run clock (`currentRunStartedAtMs`), null before one. */
+  startedAtMs: number | null;
+  /** What its answered segments banked (`liveRunElapsedBaseMs`). */
+  baseMs: number;
+}
+
+/**
+ * 「{在做什么} · {用时}」 under the typing bubble (main chat PRD ruling
+ * 134): 6px under it, its left edge on the bubble's, one 18px line
+ * whatever it says, no wider than a reply bubble may be. 12px `ink-soft`,
+ * tabular numbers, no sweep, no motion. The doing part gives way: cut
+ * with a fade when too long, the whole of it on hover (the header
+ * identity row's way); 「 · 」 and the time never. Inside the bubble's
+ * row, so following the bottom and the hand-off take it as part of it
+ * (useTypingBubbleHandoff copies it out with the dots). The row is the
+ * `status` live region: a new doing part is read out, the time, ticking
+ * every second, is not (`aria-hidden`).
+ */
+function ProgressLine({ progress }: { progress: TypingProgress }) {
+  return (
+    <div
+      data-role="assistant-progress"
+      className={cn(
+        "mt-1.5 flex h-[18px] items-center text-[12px] leading-[18px] text-ink-soft tabular-nums",
+        ASSISTANT_BUBBLE_MAX,
+      )}
+    >
+      <span
+        data-role="assistant-progress-doing"
+        ref={truncationFadeRef}
+        onPointerEnter={(e) =>
+          syncTruncatedTitle(e.currentTarget, progress.doing)
+        }
+        className="truncate-fade min-w-0"
+      >
+        {progress.doing}
+      </span>
+      <ProgressElapsed
+        startedAtMs={progress.startedAtMs}
+        baseMs={progress.baseMs}
+      />
+    </div>
+  );
+}
+
+/**
+ * 「 · 12 秒」, from the first second: `RunElapsedHud`'s figure and words,
+ * kept the same way — a timer writes the time once a second, so only
+ * this re-renders, and a render never reads the clock.
+ */
+function ProgressElapsed({
+  startedAtMs,
+  baseMs,
+}: {
+  startedAtMs: number | null;
+  baseMs: number;
+}) {
+  const copy = useCopy();
+  const [now, setNow] = useState(() => Date.now());
+  useEffect(() => {
+    if (startedAtMs == null) return;
+    const id = window.setInterval(() => setNow(Date.now()), 1000);
+    return () => window.clearInterval(id);
+  }, [startedAtMs]);
+  if (startedAtMs == null) return null;
+  const elapsed = assistantProgressElapsed(baseMs + (now - startedAtMs), copy);
+  if (!elapsed) return null;
+  return (
+    <span
+      aria-hidden
+      data-role="assistant-progress-elapsed"
+      className="shrink-0 whitespace-pre"
+    >
+      {` · ${elapsed}`}
+    </span>
+  );
+}
diff --git a/gui/src/components/screens/MainView.tsx b/gui/src/components/screens/MainView.tsx
index 0dce1b9e..ca5e6506 100644
--- a/gui/src/components/screens/MainView.tsx
+++ b/gui/src/components/screens/MainView.tsx
@@ -12,7 +12,12 @@ import {
   Conversation,
   TurnMarker,
 } from "@/components/conversation/Conversation";
-import { TypingBubble } from "@/components/conversation/TypingBubble";
+import {
+  TypingBubble,
+  type TypingProgress,
+} from "@/components/conversation/TypingBubble";
+// TEMP variant switcher (main chat 90): 「新」's line under the dots.
+import { useLiveProgressVariant } from "@/components/conversation/live-progress-variants/live-progress-variants";
 import { ConversationSkeleton } from "@/components/conversation/ConversationSkeleton";
 import { StepLimitTail } from "@/components/conversation/StepLimitTail";
 import { Button } from "@/components/ui/button";
@@ -44,6 +49,7 @@ import { useTypewriter } from "@/hooks/useTypewriter";
 import { useTypingBubbleHandoff } from "@/hooks/useTypingBubbleHandoff";
 import { useMarkdownStream } from "@/hooks/useMarkdownStream";
 import { typingBubbleShown } from "@/lib/assistant-conversation";
+import { assistantDoing } from "@/lib/assistant-progress";
 import { filesByMessage } from "@/lib/file-cards";
 import { openMainChat } from "@/lib/main-chat";
 import { endsInSilentReport, subtaskQuestionLocked } from "@/lib/subtasks";
@@ -468,6 +474,24 @@ function MainViewContent({
     () => typingBubbleShown(roundLive, turns, inFlightContent),
     [roundLive, turns, inFlightContent],
   );
+  // TEMP variant switcher (main chat 90): 「新」 — under the dots, in a
+  // round you started, what it is doing and the round's time (ruling
+  // 134; lib/assistant-progress.ts). Switching shows or drops it at once.
+  const liveProgressVariant = useLiveProgressVariant();
+  const progressDoing = useMemo(
+    () =>
+      liveProgressVariant === "new" && typingShown
+        ? assistantDoing(turns, inFlightContent, copy)
+        : null,
+    [liveProgressVariant, typingShown, turns, inFlightContent, copy],
+  );
+  const typingProgress: TypingProgress | null = progressDoing
+    ? {
+        doing: progressDoing,
+        startedAtMs: currentRunStartedAtMs,
+        baseMs: runElapsedBaseMs,
+      }
+    : null;
   // The hand-off (rulings 103, 110; tickets 51, 58): the render where
   // the live round's place goes to its bubble — the answer, or its
   // question — grows the bubble out of the typing bubble, and the follow
@@ -732,7 +756,9 @@ function MainViewContent({
                 row, its reasoning and the streaming prose — gone once
                 the round has its answer or asks, its bubble growing out
                 of it (useTypingBubbleHandoff). */}
-            {typingShown && <TypingBubble ref={typingBubbleRef} />}
+            {typingShown && (
+              <TypingBubble ref={typingBubbleRef} progress={typingProgress} />
+            )}
             {isRunning && !isMainChat && (
               // The elapsed clock inside TurnMarker resets whenever
               // `index` changes — step 1 took 30s; step 2's clock
diff --git a/gui/src/hooks/useTypingBubbleHandoff.ts b/gui/src/hooks/useTypingBubbleHandoff.ts
index fb7eccb3..eef01242 100644
--- a/gui/src/hooks/useTypingBubbleHandoff.ts
+++ b/gui/src/hooks/useTypingBubbleHandoff.ts
@@ -40,6 +40,11 @@ interface TypingRecord {
   /** When the dots' loop started (document timeline, ms): the leaving
    * copy carries on in step instead of starting the loop over. */
   loopStart: number | null;
+  /** TEMP variant switcher (main chat 90): the line under the dots
+   * (TypingBubble's `progress`), when drawn, and where it stood in the
+   * column (px): copied into the leaving line. */
+  line: HTMLElement | null;
+  lineBox: Box | null;
 }

 /** One commit as the hand-off reads it. */
@@ -81,6 +86,10 @@ function measureTyping(
     '[data-role="assistant-typing-dots"]',
   );
   if (!column || !bubble || !dots) return null;
+  // TEMP variant switcher (main chat 90): the line under the dots.
+  const line = row.querySelector<HTMLElement>(
+    '[data-role="assistant-progress"]',
+  );
   const inner = column.getBoundingClientRect();
   const inColumn = (rect: DOMRect): Box => ({
     top: rect.top - inner.top,
@@ -102,6 +111,8 @@ function measureTyping(
         : previous?.dots === dots
           ? previous.loopStart
           : null,
+    line,
+    lineBox: line ? inColumn(line.getBoundingClientRect()) : null,
   };
 }

@@ -254,6 +265,7 @@ function playTypingHandoff(
   // skips boxes without height).
   let layer: HTMLDivElement | null = null;
   let leaving: HTMLElement | null = null;
+  let leavingLine: HTMLElement | null = null;
   if (record) {
     layer = document.createElement("div");
     layer.setAttribute("aria-hidden", "true");
@@ -286,6 +298,29 @@ function playTypingHandoff(
       { duration: timing.fadeMs, easing: timing.easing, fill: "forwards" },
     );
     animations.push(leavingFade);
+    // TEMP variant switcher (main chat 90): the line under the dots leaves
+    // as they do — a copy where it stood, out of the layout, faded on the
+    // same duration and curve (gone with the layer).
+    if (record.line && record.lineBox) {
+      leavingLine = record.line.cloneNode(true) as HTMLElement;
+      leavingLine.setAttribute("data-role", "assistant-progress-leaving");
+      leavingLine.style.position = "absolute";
+      leavingLine.style.margin = "0";
+      leavingLine.style.top = `${columnTop + record.lineBox.top}px`;
+      leavingLine.style.left = `${columnLeft + record.lineBox.left}px`;
+      leavingLine.style.width = `${record.lineBox.width}px`;
+      leavingLine.style.height = `${record.lineBox.height}px`;
+      // Its cap is a share of the column; in the zero-size layer that
+      // would be nothing.
+      leavingLine.style.maxWidth = "none";
+      layer.append(leavingLine);
+      animations.push(
+        leavingLine.animate(
+          { opacity: [1, 0] },
+          { duration: timing.fadeMs, easing: timing.easing, fill: "forwards" },
+        ),
+      );
+    }
     // Gone once faded.
     const remove = () => layer?.remove();
     void leavingFade.finished.then(remove, remove);
@@ -318,6 +353,8 @@ function playTypingHandoff(
         animations.push(child.animate(lifted, options));
       }
       if (leaving) animations.push(leaving.animate(lifted, options));
+      // TEMP variant switcher (main chat 90): the line under the dots.
+      if (leavingLine) animations.push(leavingLine.animate(lifted, options));
     }
   } else {
     fadeIn(bubble);
```

#### 4. 卡片 running 分支（diff 原样）

```diff
diff --git a/gui/src/components/layout/sidebar/SidebarAssistant.tsx b/gui/src/components/layout/sidebar/SidebarAssistant.tsx
index 0a0098e2..90c1ea87 100644
--- a/gui/src/components/layout/sidebar/SidebarAssistant.tsx
+++ b/gui/src/components/layout/sidebar/SidebarAssistant.tsx
@@ -4,6 +4,8 @@ import {
   type PointerEvent as ReactPointerEvent,
 } from "react";

+// TEMP variant switcher (main chat 90): 「新」's words while it runs.
+import { useLiveProgressVariant } from "@/components/conversation/live-progress-variants/live-progress-variants";
 import {
   AssistantAvatar,
   AssistantAvatarBadge,
@@ -14,6 +16,10 @@ import {
   useComposerDraft,
   usePendingQuestion,
 } from "@/hooks/useAssistantState";
+import {
+  useAssistantRound,
+  useAssistantRunMinutes,
+} from "@/hooks/useAssistantProgress";
 import { useAssistantTyping } from "@/hooks/useAssistantSentence";
 import { useDayStamp } from "@/hooks/useDayStamp";
 import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
@@ -211,10 +217,24 @@ export function SidebarAssistantCard({
   // woke it for only while the conversation shows its dots, else the
   // last message, the live round's steps skipped (rulings 107, 110).
   const typing = useAssistantTyping(mainChat.id, state.kind === "running");
+  // TEMP variant switcher (main chat 90): 「新」 — a round you started
+  // says 「正在工作…」; away from the main chat 「正在输入…」 while it
+  // writes and the whole minutes from one on (ruling 134). The minutes
+  // re-render the card only when one turns. A woken round as before.
+  const liveProgressVariant = useLiveProgressVariant();
+  const round = useAssistantRound(
+    mainChat.id,
+    liveProgressVariant === "new" && state.kind === "running",
+  );
+  const ownRound = round === "own" || round === "own-writing";
+  const minutes = useAssistantRunMinutes(mainChat.id, ownRound);
+  const working = ownRound
+    ? { writing: round === "own-writing", minutes }
+    : undefined;
   const lastMessage = useAssistantLastMessage(mainChat);
   const line = assistantCardLine(
     state,
-    { question, draft, lastMessage, open, typing },
+    { question, draft, lastMessage, open, typing, working },
     copy,
   );
   const time = formatListTime(
diff --git a/gui/src/lib/assistant.ts b/gui/src/lib/assistant.ts
index a04bcdad..882702fc 100644
--- a/gui/src/lib/assistant.ts
+++ b/gui/src/lib/assistant.ts
@@ -209,6 +209,7 @@ export function assistantCardLine(
     lastMessage,
     open,
     typing = false,
+    working,
   }: {
     /** The pending question's text (`PendingAskUser.question`), if the
      * page has it. */
@@ -225,10 +226,19 @@ export function assistantCardLine(
      * you started throughout, one Core woke it for only while it writes
      * words, as the conversation's dots. */
     typing?: boolean;
+    /** TEMP variant switcher (main chat 90): 「新」, a round you started
+     * — whether it writes words now (`assistantWriting`) and the run's
+     * whole minutes (hooks/useAssistantProgress.ts); absent in a woken
+     * round and in 「现状」, which keep `typing`. */
+    working?: { writing: boolean; minutes: number };
   },
   copy: AppCopy,
 ): AssistantCardLine | null {
   if (state.kind === "running") {
+    // TEMP variant switcher (main chat 90): 「新」 (ruling 134).
+    if (working) {
+      return { kind: "running", text: workingLine(working, open, copy) };
+    }
     // Open or not (rulings 107, 110): what it is doing is in the header,
     // what it says in the conversation. Not typing (a woken round
     // between its words): the last message, the face at work.
@@ -273,6 +283,26 @@ export function assistantCardLine(
   return lastMessage ? messageLine(lastMessage, copy) : null;
 }

+/**
+ * TEMP variant switcher (main chat 90) — 「新」's card while a round you
+ * started runs (ruling 134): it says only what the screen does not. With
+ * the main chat on screen 「正在工作…」 throughout, the last seconds too
+ * (the dots are right there); away from it 「正在输入…」 while it writes
+ * (an IM chat list's way), else 「正在工作…」, from a minute on
+ * 「正在工作 · N 分钟」.
+ */
+function workingLine(
+  working: { writing: boolean; minutes: number },
+  open: boolean,
+  copy: AppCopy,
+): string {
+  if (open) return copy.assistant.working;
+  if (working.writing) return copy.assistant.typing;
+  return working.minutes >= 1
+    ? copy.assistant.workingMinutes(working.minutes)
+    : copy.assistant.working;
+}
+
 function messageLine(
   lastMessage: AssistantLastMessage,
   copy: AppCopy,
```

#### 5. 两种流里 summary 与派发标记的先后

结论：两种流里，`<summary>` 都在派发标记之前，没有哪种需要退到第 3 条。依据是派发标记由 GA 的循环在整段回复流完之后才写：`managed-ga/code/agent_loop.py:61` `response = yield from response_gen`（回复整段流完），`:62` 再写 `\n\n`，`:78` 才写 `🛠️ Tool: …`；runner 再把其后的 5 个反引号输出块滤掉（`runner/workbench_bridge.py:479` `_FenceFilter`），所以 `inFlightContent` 里是「回复 + 派发标记」。

- 原生工具调用（`NativeToolClient`）：工具调用本身不进流，进流的只有文字与 Galley 包上的 `<thinking>`（`llmcore.py:251` 只 yield `text_delta`；`:420` OpenAI 兼容的 `content`；`:421` 有工具调用时先把 `<thinking>` 关上）。提示词要求 summary 写在回复文字里（`llmcore.py:1427` 起的 `THINKING_PROMPT_ZH`）。模型只写了推理、没写文字时，GA 用推理第一行补一个 `<summary>`（`llmcore.py:1248` `_ensure_text_block`），在 `:1062` yield，仍在 `chat` 返回之前、派发标记之前。
- GA 文本协议（`ToolClient`）：`<summary>` 与 `<tool_use>{…}</tool_use>` 都是模型写的文字，原样进流（`llmcore.py:1140`；提示词 `:1163` 要求「回复正文之后输出 <tool_use> 块」）。

例外（不是「summary 在派发之后」，而是「流里根本没有 summary」）：原生工具调用时模型既没写文字也没有推理，只给了工具调用。这时 `_ensure_text_block` 不补（它只在有推理时补），流里没有 `<summary>`，GA 落定的 summary 也是空的；这一行按第 3 条留着上一步那句（或「思考中」），这一步落定后也不换。没用真模型复现过，是读代码推出来的。

夹具（`gui/src/lib/assistant-progress.test.ts`，按 chunk 逐个前缀喂给 `assistantDoing`：派发标记之前的每个前缀都还是上一步那句，到派发标记那个 chunk 才换成这一步的后半句；`gui/src/hooks/useAssistantProgress.test.tsx` 把同样两种流经 `dispatchIPCEvent` 走一遍真 store，落定前后同一句）：

```ts
/** GA's verbose dispatch marker after the reply (agent_loop: `\n\n` once
 * the reply has streamed, then the marker; the runner drops the
 * 5-backtick output fence after it, workbench_bridge `_FenceFilter`). */
function dispatch(name = "web_scan"): string {
  return `\n\n🛠️ Tool: \`${name}\`  📥 args:\n\`\`\`\`text\n{\n  "tabs_only": false\n}\n\`\`\`\`\n`;
}

/** A step's stream with native tool calls (llmcore NativeToolClient):
 * the reasoning in-band as `<thinking>` (Galley's `_GalleyThinkTag`),
 * then the model's text — its `<summary>` — and the call, which is not
 * in the stream at all; then GA's dispatch marker. */
function nativeStream(summary: string): string[] {
  return [
    "\n**LLM Running (Turn 2) ...**\n\n",
    "<thinking>",
    "伤病名单要看最新的，",
    "先看东部几支热门队。",
    "</thinking>",
    "<summary>",
    summary.slice(0, 6),
    summary.slice(6),
    "</summary>",
    dispatch(),
  ];
}

/** The same step in GA's text protocol (llmcore ToolClient): the model
 * writes `<summary>` and then `<tool_use>{…}</tool_use>` as text; then
 * GA's dispatch marker. */
function textProtocolStream(summary: string): string[] {
  return [
    "\n**LLM Running (Turn 2) ...**\n\n",
    "<summary>",
    summary,
    "</summary>\n",
    '<tool_use>{"name": "web_scan", ',
    '"arguments": {"tabs_only": false}}</tool_use>',
    dispatch(),
  ];
}
```

另外一处与 GA 不完全一致、按票面写的：`<summary>` 在一个到派发时还没闭合的 `<thinking>` 里时，票面要求不算；GA 自己不删没闭合的 `<thinking>`，会取到这个 summary。所以这种流里这一行派发时不换、落定时才换（跳一下）。原生流不会出现（Galley 的 `_GalleyThinkTag` 总在文字或工具调用前关上），只有自己写 `<thinking>` 又不关的提示词式模型会碰到。

#### 6. `open` 与 `mainChatOnScreen` 的口径

两者是同一个判定，口径一致：
- 卡片的 `open`：`Sidebar.tsx:476` `open={activeId === mainChat.id}`，`activeId` 来自 `App.tsx:330` `effectiveActiveId = screen === "main" ? activeSessionId : undefined`，即「主区是 main 屏，且当前会话是主对话」。
- `mainChatOnScreen`：`lib/todo-open.ts:39` `screen === "main" && Boolean(session?.mainChat)`，调用处 `hooks/useTodoPanelIntroduction.ts:44` 再加 `active?.id === mainChatId`，也是「main 屏，且当前会话是主对话」。

两者都不看盖在上面的东西：设置是全窗口的 Radix 对话框（`Settings.tsx:189` `Dialog.Overlay` `fixed inset-0`），开着设置时 `screen` 仍是 `main`、当前会话仍是主对话，所以卡片算「在屏上」，一直写「正在工作…」，不会出现「正在工作 · N 分钟」。⌘K、其他对话框同理；窗口最小化或被别的应用挡住也算「在屏上」。按票面没改 `open` 的定义。**这会影响给 JC 的真机步骤第 3 步**：「切去设置」时看到的是「正在工作…」，不是「满 1 分钟『正在工作 · 1 分钟』」；要看到分钟数得切去工作台（或新对话的空白页）。

#### 7. 拆法（`live-progress-variants.ts` 文件头那段原样）

```
 * Removal, after the ruling. Every touch point says "TEMP variant
 * switcher (main chat 90)" (`grep -rn "main chat 90" gui/src`; the last
 * test in live-progress-variants.test.tsx pins the list of files).
 *
 *   Always delete — this folder (live-progress-variants.ts,
 *   LiveProgressVariantsPill.tsx, LiveProgressVariantsPill.test.tsx,
 *   live-progress-variants.test.tsx and its __snapshots__); App.tsx's
 *   pill (its import and its line); the `useLiveProgressVariant` import
 *   and call in MainView, AssistantIdentity and SidebarAssistant. Before
 *   deleting the two tests, move what the winner keeps: 新 wins — the
 *   hand-off half of LiveProgressVariantsPill.test.tsx next to
 *   useTypingBubbleHandoff, the 「新」 describes of
 *   live-progress-variants.test.tsx into MainView.assistant,
 *   MainHeader.identity and Sidebar.main-chat (their 现状 assertions
 *   change to the new words); 现状 wins — nothing.
 *
 *   The touch points, and what each winner does with them:
 *
 *   file                          新 wins: keep                       现状 wins: delete
 *   lib/assistant-progress.ts     all (marker out of its header)      the file
 *     + its test                  all                                 the file
 *   hooks/useAssistantProgress.ts all (marker out)                    the file
 *     + its test                  all                                 the file
 *   TypingBubble.tsx              `progress` prop, `TypingProgress`,  those (the 「---- TEMP」
 *                                 `ProgressLine`, `ProgressElapsed`,  section), and the imports
 *                                 their imports                       `useEffect`, `useState`,
 *                                                                     `ASSISTANT_BUBBLE_MAX`,
 *                                                                     `assistantProgressElapsed`,
 *                                                                     `syncTruncatedTitle`,
 *                                                                     `truncationFadeRef`, `cn`
 *   MainView.tsx                  `progressDoing` (no variant check:  `progressDoing`,
 *                                 `typingShown ? assistantDoing(…)`), `typingProgress`, the
 *                                 `typingProgress`, `progress=` on    `progress=` prop, the
 *                                 TypingBubble                        `assistantDoing` and
 *                                                                     `TypingProgress` imports
 *   useTypingBubbleHandoff.ts     `line` / `lineBox` (TypingRecord,   the same, all four
 *                                 measureTyping), `leavingLine` and   marked places
 *                                 its lift line
 *   AssistantIdentity.tsx         `line` null while `state.kind ===   `quiet`; `line` is
 *                                 "running"`                          `state.line` again
 *   SidebarAssistant.tsx          `round` (asked while running),      `round`, `ownRound`,
 *                                 `ownRound`, `minutes`, `working`    `minutes`, `working`
 *                                                                     and their imports
 *   lib/assistant.ts              `working` and `workingLine`         `working`, `workingLine`
 *   zh.ts / en.ts                 the four keys (marker comment out)  the four keys
 *
 *   新 wins, then also drop what nothing reads any more: the header's
 *   sentence (`assistantSettledSentence`, `assistantCachedSettledSentence`,
 *   `useAssistantSettledSentence`, useAssistantState's `header`,
 *   `AssistantStateInput.sentence`, the running branch's text in
 *   `assistantState`), and bring the comments that describe today's
 *   in-run split up to date (lib/assistant.ts, lib/assistant-
 *   conversation.ts, TypingBubble, AssistantIdentity, SidebarAssistant,
 *   useAssistantSentence, useAssistantState).
 *
 *   Either way, then docs/design/conversation.md 「在跑时：三点气泡」 and
 *   layout-and-chrome.md §4.1 (the identity row) / §4.2 (the card) for
 *   the winner.
```

#### 8. 验证命令与结果

在最终代码状态（`2bd39ee2`）上跑了一遍：

```
$ pnpm --dir gui typecheck
> galley-desktop@0.7.0 typecheck /Users/inkstone/Documents/genericagent-webui-wt90/gui
> tsc --noEmit
（exit 0）

$ pnpm --dir gui lint
> galley-desktop@0.7.0 lint /Users/inkstone/Documents/genericagent-webui-wt90/gui
> eslint src --max-warnings 0
（exit 0）

$ CI=true pnpm --dir gui test
 Test Files  205 passed (205)
      Tests  2271 passed (2271)
   Start at  16:16:05
   Duration  43.82s (transform 12.82s, setup 5.38s, import 489.94s, tests 29.07s, environment 18.57s)
（exit 0）

$ TZ=UTC CI=true pnpm --dir gui test
 Test Files  205 passed (205)
      Tests  2271 passed (2271)
   Start at  08:16:57
   Duration  41.47s (transform 11.37s, setup 4.58s, import 470.00s, tests 29.19s, environment 15.78s)
（exit 0）

$ TZ=America/Los_Angeles CI=true pnpm --dir gui exec vitest run src/components/conversation/live-progress-variants src/lib/assistant-progress.test.ts src/hooks/useAssistantProgress.test.tsx
 Test Files  4 passed (4)
      Tests  64 passed (64)

$ git diff --check
（无输出，exit 0；对 main 的 git diff --check 同样 exit 0）
```

`CI=true` 让 vitest 不写新快照、缺快照即失败，所以「现状」档是在和第一个提交里的快照比。票里点名的六个旧测试文件没改一个断言，都在上面的全量里通过。旧文件只格式化了自己的 hunk：逐文件比过 HEAD 版与改后版被 prettier 改动的行数，相同（新文件整篇格式化过）。新增的中文行（`zh.ts` 注释）扫过半角标点，没有命中。

#### 9. 看到但没改的、没验证到的

看到但没改：
1. 设置盖着主对话时卡片算「在屏上」（见第 6 条），真机第 3 步「切去设置」看不到分钟数。
2. `ask_user` 也是一次工具派发：它问你的那一步派发标记出现后、问题到达之前，这一行会写那一步 summary 的后半句（例如「我问用户…」），交接给问题时淡出的也是这句。时间很短，票面没排除，照规则保留。
3. 「切出来是空的也用整句」按字面做：「提醒规则已确认；」显示时末尾带着「；」。要去掉末尾分隔符是一行改动，没擅自加。
4. 新档的额外开销（没测）：「现状」里你发起的一轮，卡片与三点气泡的判断都不读流（`assistantTyping` 短路）；「新」里 `assistantDoing` 与卡片的 `useAssistantRound` 每个 chunk 都要算一次 `assistantWriting`（一次 `cleanPartialContent`，两处共用单条缓存）。MainView 本来就每个 chunk 清洗一次 `visiblePartial`，这是在它之外多一次。
5. 「新」里顶栏的 `useAssistantState({ header: true })` 仍订阅落定那一句，只是不画；每落定一步身份行多重渲染一次，输出不变。定「新」时按拆法删掉。
6. 卡片的分钟数在主对话开着时也每整分钟让卡片重渲染一次（为了切走时分钟数是新的，不用补一帧）；输出不变。

没验证到：
1. 真机外观：没跑 `tauri dev`。浅色、深色、⌘= / ⌘− 字号档下小字与气泡的对齐、截断渐隐、交接时这行和三个点一起淡出的样子，都只在 jsdom 和静态渲染里断言了结构、类名与动画参数，没看过像素。
2. 读屏：用时 `aria-hidden` 放在 `role="status"`（隐含 `aria-atomic`）里面。主流实现里被 `aria-hidden` 的子树不进无障碍树、不触发播报，但没在 VoiceOver 上实听过；要是实听每秒还在播，退路是把这一行移出 status 区、在做什么单独做一个 live 区。
3. 两种流的夹具是读 `agent_loop.py`、`llmcore.py`、runner 代码写的，没从真模型的一轮里抓原始流比对；第 5 条的「原生只给工具调用、流里没有 summary」也没复现过。
4. 分钟数的计时器只在假时钟下测过（整分钟才重渲染、切到活动时立刻追上），没在真机上等过 1 分钟。
5. Windows 没跑。
