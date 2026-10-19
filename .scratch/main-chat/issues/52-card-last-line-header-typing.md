# 52 主对话开着时卡片第二行只写最后一句；顶栏写字时「正在输入…」

Status: needs-dogfood（2026-10-19 快进合入 main，`d76fa6fc`、`fc5fc127`；主会话复跑门禁：typecheck、lint、两个时区各 1807 条、diff-check 全过）

来源：主聊天 PRD 裁决 104（2026-10-19，JC：侧栏卡片与顶栏在回复时都写「思考中」，重复了；顶栏能不能更像 IM 的「正在输入」）。依赖 47（已合入）。推翻裁决 87 第 2、3 条。只改 GUI 与设计文档；Core、runner、提示词不动。与在途的票 51（回复气泡从那一行长出来，改 `MainView`、`AssistantParts`、滚动）不碰同一处，别去改它那些文件。

## 一、卡片：主对话开着时第二行只写最后一句

- 现在（`gui/src/lib/assistant.ts` 的 `assistantCardLine`，约第 192 行）：出错、在跑的 `state.line` 优先；在问你时开着只写「等你回复」（`open` 时不接原文）；然后草稿（开着不写）；最后才是最后一句。`assistantState`（约第 138 行）在跑时给 `line` 写那一句或「思考中」。
- 改成：`open` 为真（主对话本身在屏上；开着它的子任务不算，`useAssistantState` 的 `open` 语义照旧）时，第二行**一律是最后一句**（`lastMessage`，「你：」前缀照旧），不看状态：在跑、在问你、出错、子任务在问你、子任务出错都一样。没有最后一句时照现在的空第二行处理（名字居中）。
- **在问你时**最后一句应当是它问的那句。先查 `lastVisibleMessage` 在提问挂着时拿到的是不是这个提问（设计文档说「它用 ask_user 问过的问题算它说的话」）；如果挂着的提问还不在 turns 里、拿到的是你的上一句，就用 `PendingAskUser.question` 走同一套 `plainLine` 补上（不加「等你回复：」前缀）。写清楚你查到的是哪种。
- **状态照旧由头像角标与名字字重说**（转圈、暂停、叉；在跑、在问你、出错时名字 semibold），这些不动。只是第二行的字不再跟状态变。确认开着时第二行没有品牌色、琥珀色、红色的状态前缀；颜色照「最后一句」的 `ink-muted`。
- 主对话没开着（在工作台、开着它的子任务）时：完全照旧（那一句、等你回复接原文、草稿、出错红字）。
- 开着时在跑也不用再为卡片订阅那一句的流（`useAssistantSentence` 的第二个参数今天已经是 `!open`，核对一下，别引入多余的重渲染）。

## 二、顶栏：在跑时写字写「正在输入…」，其余「思考中」

- 顶栏身份行（`gui/src/components/layout/assistant/AssistantIdentity.tsx`，它用 `useAssistantState({ open: true })` 的 `line`）在跑时今天写「思考中」（`copy.sidebar.thinking`）。
- 改成：主对话在跑、而且它此刻在写字时写「正在输入…」，否则「思考中」。「在写字」的判断（确定式，不猜）：主对话的原始流（消息缓存里的 `inFlightContent`）满足三条：没有没闭合的 `<thinking>`（`gui/src/lib/ipc/ga-output-cleaning.ts` 的 `extractLiveThinking(...).open` 为假）、还没出现工具派发标记（同文件 `modelReplyEnd`，约第 624 行，现在没导出，需要就导出或包一个小函数，放在 lib 里，别放组件文件）、清洗后（`cleanPartialContent`，主区那一行用的同一份清洗）有非空白的字。`<no-reply/>` 被清洗扣住时没有字，照「思考中」。
- 选择器只返回布尔值（或那两个词之一），相同就不更新：流出几十个 chunk 时顶栏只在翻转时重渲染。照 `assistantCachedSentence`（`gui/src/lib/assistant-conversation.ts` 约第 193–220 行）与 `useAssistantSentence` 的缓存做法，清洗结果能共用就共用，别每个 chunk 多清洗一遍。
- 其余状态不变：等你回复、出错、子任务在问你、子任务出错，以及静止时只有名字。顶栏第二行有字时的高度照旧（「正在输入…」与「思考中」都是有字，切换不改高度）。
- 文案：新键中英各一，中文「正在输入…」（全角省略号 `…`，一个字符），英文 `Typing…`。键名、放在哪个命名空间照 `gui/src/i18n/` 现有习惯，`types.ts` 同步。
- 侧栏卡片在主对话没开着时照旧说那一句，不改成「正在输入…」。

## 三、文档

- `docs/design/layout-and-chrome.md`：§4.1 身份行那条（约第 59 行，「在跑（「思考中」；……）」那段）改写顶栏在跑时的两个词与判断，带裁决 104；§4.2 助手卡片「第二行」那条（约第 261 行）末尾「**主对话本身开着时只写状态**」那几句改成「开着时只写最后一句、状态交给头像角标与顶栏」，带裁决 104、注明推翻 87 第 2、3 条；「在跑时说什么」里提到开着时写「思考中」的地方一并对齐。
- `docs/design/conversation.md`「助手的对话」→「过程：一行」→「在跑时」那条末尾（约第 123 行）「顶栏身份行与开着主对话时的卡片只写「思考中」」改成新规则的一句话并链到 layout-and-chrome。只改这一句，别碰同一节的「消失」那条（票 51 在改）。
- 全角标点；devlog 主会话写。

## 别动

- 工作台会话行、子任务卡片、外置运行时：零变化。
- 对话末尾那一行（`AssistantLiveLine`、`assistantLineSentence`）、票 51 的文件（`MainView.tsx`、`AssistantParts.tsx`、`MessageAgent.tsx`、`AskUserBubble.tsx`、`useStickyScroll.ts`、`animate-scroll.ts`、`globals.css`）。
- 头像角标、名字字重、卡片的时间、未读规则。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 单测：`assistantCardLine` 开着时各状态（在跑、在问你、出错、子任务在问你、子任务出错、有草稿）都给最后一句、没开着时照旧；「在写字」的判断（空流、只有开着的 thinking、thinking 闭合后有字、字后面出现工具派发标记、部分派发标记、`<no-reply/>`、只有空白）；顶栏在跑时两个词的切换。
- 重渲染：照 layout-and-chrome「数据只在界面里取」那条量法，模拟流出几十个 chunk，报顶栏与卡片各重渲染几次。
- 自查截图（不进仓库，放 scratchpad，文件名带 `t52-` 前缀）：开着主对话时卡片与顶栏在「刚发出（思考中）」「工具步」「回复流出（正在输入…）」「落定」「在问你」「出错」六个时刻；没开着主对话时同样几刻的卡片（证明不变）；浅色深色、中英文。截完把临时页从工作树删掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：卡片规则改在哪、在问你时最后一句取的是什么（查到的结论）、「在写字」的判断函数与缓存。
3. 验证命令与结果原样（测试条数、两个时区）、重渲染次数。
4. 截图的绝对路径与每张一句话。
5. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 开着主对话发一句要跑几步的：卡片第二行停在「你：……」、头像转圈；顶栏先「思考中」，回复流出时变「正在输入…」，气泡出来后只剩名字。
2. 让它问你一个问题：卡片第二行是它问的那句、头像暂停；顶栏「等你回复」。
3. 切到工作台会话再看卡片：照旧说那一句 / 等你回复接原文。

## Comments

- 2026-10-19（实现子代理）：卡片规则在 `assistantCardLine` 开头的 `open` 分支（`gui/src/lib/assistant.ts`），开着时一律最后一句，不再看状态；没开着的分支照旧。在问你时查到的是第三种：提问那一步在挂起之前就进了 turns（turn_end 先于 ask_user 事件；重载时挂着的提问本来就是 `derivePendingAskUser` 从最后一步推出来的），但那一步若同时写了字，`lastVisibleMessage` 先读 `finalAnswer`，拿到的是那段字而不是提问（对话里提问那一步只画问题），所以开着且自己在问你时用 `PendingAskUser.question` 走 `plainLine`，不加前缀。「在写字」是 `assistantWriting`（`gui/src/lib/assistant-conversation.ts`），与卡片那句共用一份清洗缓存（`cleanedStream`），`modelReplyEnd` 改为导出；只有顶栏读它（`useAssistantState` 的 `header`）。重渲染用 Vite 临时页加 React Profiler 量：两步、51 个 chunk 的一轮，顶栏 5 次（四次翻转加 run_complete），开着时的卡片 3 次（两次 turn_end 加 run_complete），chunk 期间 0 次。没改、留给主会话：在跑时某个工具步写了旁白，它的 `finalAnswer` 非空，`lastVisibleMessage` 会把这段旁白当最后一句，开着时卡片第二行会换成它，与对话末尾那一行重复（真机步骤 1 用不写旁白的模型时才稳定停在「你：……」）；layout-and-chrome「数据只在界面里取」一条仍写「卡片与顶栏共用那句、量得 3 次」，不在本票点名的句子里，没动。
- 2026-10-19（跟进，主会话要求）：上一条留下的两处都改了。旁白：主对话开着且在跑时，你最后一条消息之后调了工具又不是提问的步不算最后一句（`lastVisibleMessage` 的 `liveRound`，由 `useAssistantLastMessage(mainChat, open)` 在开着且在跑时打开），卡片停在「你：……」，直到提问或回复落地；静止时与没开着时不变。这是裁决 104 第 1 条「最后一句」（对话里画成气泡的最后一条）的落实，不是新规则。「数据只在界面里取」一条已按现状改写，换上 51 个 chunk 的新量数。
