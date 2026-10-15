# 20 主区的 IM 画法定稿：C 气泡、一行过程、居中时间、贴底滚动

Status: ready-for-agent

来源：主聊天 PRD 裁决 67（2026-10-15，JC 在 tauri dev 里比完票 19：「真机看了，全部按你推荐」）。依赖 19。只改 GUI，不碰 Rust。

## 目标

内置运行时、主区开着助手时，对话就是票 19「全部推荐」的样子（气泡 C、过程一行、时间居中、滚动贴底），不再有切换器和演示。另补两处：问候上面的时间条，它的气泡底换成自己的 token。

工作台的会话、从助手点开的子任务、外置运行时，与本票开工时的 main 逐像素一致。

## 一、按赢家撤掉票 19 的试验

照 `gui/src/components/conversation/im-trial/im-trial.ts` 头部的删除步骤做：

- **「Always」一段**：删掉 pill、选择的 store、演示（`im-trial-demo.ts`、`useImDemo.ts`、MainView 的演示视图、演示时禁用输入框和它的两句文案）、App 里的 `imTrial` 接线、`im-trial.test.tsx`。`galley.tmp.imTrial.*` 不再读写，JC 机器上留下的旧键不用清。
- **四件留赢家、删别的**：气泡留 C，删 B 和只为 B 写的分支；过程留一行；时间留居中；滚动留贴底。主对话不再走现状那一支，但工作台和子任务走的就是它，照旧。
- **生效条件**：从「App 交下来的选择」改成 MainView 的 `isMainChat`，门在哪几处要写清楚。旧组件上加的可选参数（`align`、`bubble`、`leading`、`stickBottom` 等）留着，主对话就是靠它们走 IM 画法；名字里带 trial、tmp 的改掉。
- **留下的部件**：时间条、「N 步 ›」入口与步骤区、在跑时那一行、纯函数与常量，都挪出 `im-trial/`，放哪里你定，写进 Comments。叫法跟 `gui/src/lib/assistant.ts` 走，因为这是助手的对话。
- **`SubtaskCards`**：拆出来的 `SubtaskCardView` 没有别处用的话，并回去，或者留作文件内部组件、不导出，你定。
- **试验残留**：代码与注释里不留「ticket 19」「票 19」「TEMPORARY」。注释改成正式说明，写清为什么助手是双侧气泡、工作台不是（引裁决 66、67）。

## 二、补两处（裁决 67 第 3、4 条）

- **问候上面的时间条**：
  - `rowsToTurns` 把问候那一行的 `created_at` 带上：`AgentTurn` 加可选字段，或别的最小做法，你定。主对话的问候上面画一条居中的时间，格式同其他时间条。
  - 第一条用户消息改成跟问候比：离问候不超过 60 分钟（正好 60 分钟也不算）、又在同一天的，不另起；其余断点照旧（`userTimeMarks`，`gui/src/lib/message-time.ts`）。别的对话没有问候，行为不变。
  - 分页时问候还没加载，第一条用户消息照旧跟 `previousUserCreatedAt` 比。有个边角：页的边界正好落在问候和第一条用户消息之间时，第一条用户消息会先带着时间条，问候那页加载后这条可能收掉。可以接受，不为它改 Core，写进 Comments。
- **它的气泡底换成自己的 token**：取值同现在借用的 `bg-hover`，浅 #F0F0F0、深 #24272C（以 `globals.css` 里的实际值为准），画面不变。名字照 `--color-brand-tint`（用户消息底）那一行的路子起，你定。气泡里的行内代码、代码块（现在是 `bg-line`）和表头照旧。

## 三、文档

- `docs/design/conversation.md`：
  - **加一节**「助手的对话」，名字可以换。写定稿的四件，数值照票 19 Comments 的实测：
    - 气泡：两边的颜色、圆角、内边距、宽度上限；不放头像和名字；气泡里的代码和表格怎么放；提问与问候也是气泡；子任务卡片的位置；复制按钮挪到气泡左侧外面。
    - 分组间距：4、20、30 三个值，以及为什么两个方向不一样。
    - 过程：在跑时那一行的取句规则、计时、什么时候消失；「N 步 · 用时 ›」入口和展开；提问和回答留在外面；没有回答的运行照旧整段展开。
    - 时间：居中；问候上面那条；第一条用户消息跟问候比。
    - 滚动：贴底；发出后滚到底；停在回复开头的规则。
  - **被它改写的几节**（「User vs Agent 三重区分」「杏沙气泡」「发送时间」「Scroll behaviour」、运行折叠头、ask_user 的气泡、子任务卡片）各加一句，指向那一节。
  - **两条禁令**：「单侧容器，不是 IM 双侧气泡」和「不要 right-align」（`:23`、`:34`）限定为工作台的对话，并写明理由（裁决 66）。理由有两条：这两条的前提是「对话是一份文档」，而助手要改掉的正是这一点；气泡右缘会和问题轨相撞，但主对话没有问题轨。「不要边框、不要投影、不要小尾巴」照守，助手也守。
  - **字体**：新写的段落里不写回复的字体名，写「字体与排版照回复正文」。回复的拉丁字体另有一条 deferred（裁决 67 第 5 条）。
- `docs/design/foundations.md`：色表里给气泡底的 token 加一行，和 `--color-brand-tint` 那行对称。
- 其他设计文档里写着主对话画法的段落（如 `layout-and-chrome.md`），grep 一遍，看要不要加指向。中英两种写法都要搜。
- 不写 devlog（主会话写）。不改 PRD，也不改各票的 Status 行。

## 不做

- 输入框（裁决 66 第 5 条，JC 用几天再谈）；头像与形象；叫法；手机端。
- 回复字体（deferred）。
- Core、库、CLI 的改动；工作台会话、子任务、外置运行时的任何变化。

## 验收

- 跑这几项：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui test`，再用 `TZ=America/Los_Angeles` 全量跑一遍；`git diff --check`；全角标点自查。gui 只格式化自己改的 hunk，新文件可以整篇格式化。
- **测试**：把 `im-trial.test.tsx` 里赢家的用例并进各组件自己的测试（Conversation、MainView、useStickyScroll、message-time 等），删掉切换器、B、演示的用例。至少覆盖：
  - 只在主对话生效：普通会话、子任务、外置运行时不变。
  - C：两边都是气泡；提问与问候也是气泡；子任务卡片紧贴气泡。
  - 一行：取句规则；3 秒后带计时；右下角计时不显示；两步以上有入口、一步的没有；展开后不重复提问与回答；没有回答的运行照旧展开。
  - 居中：断点照旧；问候上面有一条；第一条用户消息跟问候比，59、60、61 分钟和跨天各一条。
  - 贴底：短对话的结构；发出后滚到底；停在回复开头。
- **反向检查**：改坏几处，确认测试会挂；恢复后逐字节一致。例如：一步的回复也出入口、提问折进步骤、普通会话也换成气泡、问候没有时间条、第一条用户消息在问候后 30 分钟仍另起一条、贴底不在回复开头停。
- **逐像素**：
  - 工作台的会话、子任务、外置运行时，与开工时的 main 比，静止、在跑、在问你，浅色与深色，要全部一致。
  - 主对话与开工时的 main 在「全部推荐」下比，用同一份合成对话：把票 19 的演示对话挪进 harness 的模拟数据，不进仓库。差别只能是问候上面多出的时间条，以及因此收掉的第一条用户消息上面那条。每一处差别都列出来、解释。
- **自查截图**（Chrome harness，可以复用会话草稿目录里 `s19/harness/`、`s19/shoot/` 的脚本，复制到新目录再改）：
  - 画面：静止、在跑、在问你、长回复停在开头、只有问候（重置后）、「N 步」展开；
  - 组合：浅色与深色、中英文、默认窗口与小窗口、宽屏；
  - 出总览图。截完把 harness 从工作树删掉。WebKit 由 JC 真机看。
- **JC 在 tauri dev 里走一遍**：
  1. 打开助手，看 pill 没了，画法同「全部推荐」；
  2. 发一句要查一会儿的话，看在跑时那一行和落定后的「N 步 ›」；
  3. 让它先问你再做，看提问气泡与候选，答完看那一行；
  4. 要一份长清单，看是否停在回复开头；
  5. 打开一个工作台会话和一个子任务，确认没变；
  6. 以后重置主对话时，看问候上面的时间，以及你第一句上面没有第二条。

## Comments

2026-10-15 实现（子代理，分支 `assistant-im-20`，基于 `afc09d6e`，未合入）：

提交：`01214080` 代码与测试；`ccff1eab` 设计文档；本条记录随后单独提交。

**代码去了哪里**（叫法跟 `lib/assistant.ts` 走，一律 `assistant` / `Assistant`）：

- `gui/src/lib/assistant-conversation.ts`（新）：助手对话的规则，都是纯函数与常量。`assistantRowGap`（分组间距）、`assistantLineSentence` 与 `assistantFirstLine`（那一行取句）、`assistantLineClock` 与 `ASSISTANT_LINE_CLOCK_AFTER_MS`（超过 3 秒的计时）、`assistantLinePlan`（哪些轮次画成消息、哪些收进「N 步」）、贴底的 `assistantFollowTop` / `assistantReplyStart` / `assistantFollowBottom` / `assistantScrollToBottom`。头部注释写定稿的四件，和为什么助手是双侧气泡、工作台不是（裁决 66、67：两条禁令的前提是「对话是一份文档」，而且主对话没有问题轨；不加边框、投影、小尾巴两边都守）。
- `gui/src/components/conversation/AssistantParts.tsx`（新）：部件。`AssistantBubble`（左侧气泡，回复、提问、问候共用这一个组件，试验里是三处各写一遍 class）、`ASSISTANT_BUBBLE_MAX`、`AssistantTimeDivider`（居中时间条，里面直接用 MessageUser 导出的 `PinnedMessageTime`，不再复制一份样式）、`AssistantRunEntry`、`AssistantRunSteps`、`AssistantLiveLine`。
- 你的气泡上限 `min(80%, 560px)` 只有 MessageUser 用，写回 MessageUser。
- `SubtaskCardView` 并回 `SubtaskCard`（只有演示用过它）。`SubtaskCards.tsx`、`App.tsx` 与票 19 之前的版本逐字节一致。
- data-role 改成 `assistant-bubble`、`assistant-time-divider`、`assistant-run-entry`、`assistant-run-steps`、`assistant-live-line`。时间条没叫 `assistant-time`：侧栏助手卡片的时间已经用了这个名字（比对时撞上才发现）。
- 删掉的：整个 `im-trial/`（模块、演示、`useImDemo`、切换器、29 条试验测试），App 的接线与 pill，MainView 的演示视图、演示时禁用输入框和它的两句文案，B 与各件现状那一支（Conversation 里 `sideBubbles` / `agentBubble` / `centeredTime` / `imProcess` 合成一个 `assistant`，测试用的 `stepsOpen` 也删了）。那两句文案写在 `im-trial-demo.ts` 里，试验没在 locale 加键，所以 locale 不用动；留下的部件全用现有的文案键，没有新文案。`galley.tmp.imTrial.*` 不再读写。

**生效条件**：App 不再往下交选择，MainView 的 `isMainChat` 是唯一的门，管五处：① Conversation 的 `assistant`（双侧气泡、「N 步 ›」与步骤区、居中时间、问候上面的时间条）；② 在跑时那一行代替思考行、思考预览与流式正文（`useTypewriter` 拿空串）；③ 右下角计时不画；④ `AskUserBubble` 的 `bubble`；⑤ 贴底：`useStickyScroll` 的 `stickBottom`，加滚动容器的纵向 flex 与对话栏的 `mt-auto`。试验的 App 另外看过「内置运行时、screen 是 main」：主对话只有内置运行时有，`isMainChat` 本来就只在主区开着它时为真，问题轨也是这么分的。旧组件上的可选参数都留着：MessageUser `align` / `rowClassName`，MessageAgent `bubble` / `className` / `leading` / `attachment`，MessageActions `leading`，AskUserBubble 与 AnsweredAskUser `bubble`（后者还有 `className`），AgentTurnView `bubble` / `answerClassName` / `entry` / `noRule` / `attachment`，useStickyScroll `stickBottom`。名字里本来没有 trial / tmp，只把注释改成正式说明。

**问候的时间与断点**：

- `rowsToTurns` 认出问候时，把那一行的 `created_at` 带到 `AgentTurn.createdAt`（新加的可选字段，只有问候带）。问候只从库里来，实时路径的回复照旧没有时间，live 与 restore 的一致性不受影响。
- Conversation 只在 `assistant` 时从问候那条 turn 取时间，在它上面画一条居中的时间，格式同其他时间条，不带「今天」。
- `userTimeMarks`：遇到问候、此前又没有基准时，把问候的时间当作上一条用户消息的时间，第一条用户消息就跟它比，规则不变：不超过 60 分钟（正好 60 分钟也不算）又在同一天的不另起，超过或跨天另起；跨了天、落在今天的照规则带「今天」（「今天 09:10」）。别的对话没有问候，行为不变。
- 分页：问候那页没加载时，第一条用户消息照旧跟 `previousUserCreatedAt` 比；Core 给的是 null，所以它照旧算第一条、带时间条。页界正好落在问候和第一条用户消息之间时，问候那页加载后这条可能收掉。接受，没改 Core。

**新 token**：`--color-assistant-tint`（`bg-assistant-tint`），浅 `#f0f0f0`（`@theme`，紧跟 `--color-brand-tint`）、深 `#24272c`（`html[data-theme="dark"]`，同样紧跟 brand-tint），与 `bg-hover` 在主区的取值相同；侧栏 `.chrome-hover-scope` 只覆写 `--color-hover`，碰不到它。气泡里的行内代码、代码块（`bg-line`）与表头照旧。实测气泡底浅 `rgb(240, 240, 240)`、深 `rgb(36, 39, 44)`，与试验一致。

**文档**（`ccff1eab`）：

- `docs/design/conversation.md` 新加一节「助手的对话（2026-10-15）」，放在「发送时间」后面：为什么这里是双侧气泡；气泡（两边的底色、圆角、内边距、宽度上限，不放头像与名字，气泡里的代码与表格，提问与问候也是气泡，子任务卡片紧贴气泡，复制挪到左侧，行动条）；分组间距 4 / 20 / 30 与两个方向不同的理由；过程一行（取句、计时、消失的时机、「N 步 · 用时 ›」与展开、提问与回答留在外面、没有回答的运行照旧平铺）；时间居中（问候上面那条、第一条用户消息跟问候比、分页边角）；贴底；不做。字体写「字体与排版照回复正文」，没写字体名。数值是本票重新量的，与票 19 一致。
- 被它改写的几节各加一句指向：「Turn 结构」（折叠头）、「User vs Agent 三重区分」、「杏沙气泡」、「发送时间」、「ask_user 提问气泡」、「子任务卡片」、「Message Actions」、「Scroll behaviour」、「Streaming generation」（连带思考行与思考预览）、「Sticky-bottom」、「主对话的问候」。
- 两条禁令：在「三重区分」里加一段，写明「单侧容器」与「不要 right-align」只管工作台的对话，理由两条：前提是「对话是一份文档」，助手要改掉的正是这一点；主对话没有问题轨。「不要边框、不要投影、不要小尾巴」照守，助手也守。原有段落和小标题没改。
- `docs/design/foundations.md`：两张色表各在 `--color-brand-tint` 下面加一行 `--color-assistant-tint`；「设计哲学」那句「不是双侧气泡的 chat IM」和设计源头表 Claude.ai 一行「不借用：双侧 / 右对齐气泡」各加一句：助手的对话是有意的例外。
- `docs/design/layout-and-chrome.md`「有主对话时」开头加一句指向；`docs/design/README.md` 索引行加「助手的对话」。中英两种写法都搜过（IM、气泡、右对齐、right-align、bubble、问候、主区），别的设计文档没有写主对话画法的段落。

**测试**：`TZ=UTC` 与 `TZ=America/Los_Angeles` 全量各一遍，124 个文件、1211 条全过；typecheck、lint、`git diff --check` 通过；全角扫描只剩英文注释与英文测试标题里夹的中文词。试验的 29 条删掉，赢家的用例并进各自的测试：

- `lib/assistant-conversation.test.ts`（新）：分组间距；取句（流出的第一行、你最后一条消息之后的旁白、答完提问回到「思考中」）；3 秒后带计时；计划（两步以上才有入口、提问与回答留在外面、在跑的运行、没有回答的运行平铺）；贴底跟随到回复开头为止、找回复开头、发出后滚到底。贴底的规则是纯函数，测在这里，没有另开 useStickyScroll 的测试文件。
- `Conversation.assistant.test.tsx`（新，仿 `MainView.question-rail.test.tsx` 按主题命名）：不开 `assistant` 时是工作台的画法；两边都是气泡、提问与问候也是气泡、复制在左；分组间距；子任务卡片在气泡下、行动条之前；入口只给两步以上；展开后不重复提问与回答；没有回答的运行照旧展开；断点照旧、问候上面一条、一小时内的第一条用户消息不另起。静态渲染点不了入口，「展开」那条用 `vi.mock` 让 ExpandSection 全部展开。
- `MainView.assistant.test.tsx`（新）：主对话是助手的画法，普通会话（子任务、外置运行时走的也是这条路）照旧；贴底的结构；提问是气泡；在跑时只有一行，不画步骤与流式正文；「思考中」，回复落地或在问你时那一行消失；那一行超过 3 秒带计时、右下角计时不画、别处照旧有；前 3 秒不带计时。
- `message-time.test.ts`：问候后 59、60、61 分钟与跨天各一条，后面的断点照旧，问候没时间或那页没加载时第一条照旧带时间。`rowsToTurns.test.ts`：只有问候带上 `created_at`。
- 反向检查 12 处，都挂了，恢复后 sha256 逐字节一致：一步的回复也出入口（挂 3 条）、提问折进步骤（6）、普通会话也换成气泡（1）、问候没有时间条（1）、第一条用户消息在问候后 30 分钟仍另起一条（4）、问候的时间没带到 AgentTurn 上（1）、贴底不在回复开头停（2）、不到 3 秒就带计时（2）、在问你时也显示那一行（1）、右下角计时照旧显示（1）、子任务卡片不在回复气泡下（1）、气泡底换回悬停色（1）。

**逐像素比对**（Chrome harness：真 App 加模拟 Core。`afc09d6e` 用 `git archive` 放在会话草稿目录的 `s20/base/`，两个 Vite 各占一个非 1420 的端口，跑完已关。藏掉切换器、关动画、冻结时钟。票 19 的演示对话挪进了 harness 的模拟数据，以普通消息行喂给主对话；问候行带 `created_via = 'system'`、supervisor `galley-greeting` 与 `created_at`；两张子任务卡片由模拟的派活记录与子任务会话画出来。harness 已从两棵树删掉，不进仓库）：

- **工作台的会话、子任务、外置运行时**：29 个画面全部逐像素一致。三处各自的静止、在跑、在问你，浅深两种主题，加英文、宽屏、小窗口、流式中、悬停你的气泡与回复，以及 `afc09d6e` 里存着「全部推荐」加演示时这三处的在跑。
- **主对话**（`afc09d6e` 存着「全部推荐」、演示关）：33 个画面，20 个逐像素一致：合成对话的静止、在跑、在问你各在浅 / 深 × 中 / 英（12 个），宽屏 2 个，长回复停在开头，harness 自己那段对话的在跑、流式中、在问你，悬停回复与你的气泡。其余 13 个的差别都解释得了：
  - 9 个只差在票里说的两处。整段对话的高窗口 5 个（浅 / 深 / 英；静止、在跑、在问你）与 harness 对话的静止 1 个，差别全在第一条用户消息以上：定稿在问候上面多一条时间（演示里是「10月13日 08:40」），第一条用户消息上面那条（「10月13日 09:12」，比问候晚 32 分钟、同一天）收掉；票 19 正相反。所以问候气泡下移 30.5px（收掉的那条 10.5 加它下面的 20），第一条用户消息往下逐像素一致。算下来第一条用户消息以上比票 19 短 4px：问候那条时间条在最上面，上边距 16，取代了问候自己的 20。harness 对话里问候在昨天 13:30、第一条用户消息在 14:30，正好 60 分钟，所以也收掉了。只有问候的 3 个（浅、深、英）差别只在新加的那条时间里。
  - 4 个只有看不出来的微小差别。960 小窗口的静止与在问你，各有 4 个像素差 1/255，在子任务卡片的两个下圆角上：滚动位置与第一条用户消息的位置两边一样；把定稿的问候时间条加高 4px、让两边版面完全对齐，它还在；把气泡底换回 `bg-hover`，它也还在；卡片那一组的 DOM 两边逐字一致（只差 data-role 的名字）。原因没再往下追，属于栅格化的抖动。「4 步」展开的深色剪裁图有 6 个字形边缘像素差 1/255，版面对齐后消失，是上面那 4px 带来的。「9 步」展开的剪裁图只有侧栏最上面 2 行不同：剪裁按入口定位，两边对话栏差 4px，没滚动的侧栏就落在不同的偏移上，对话栏里逐像素一致（`afc09d6e` 自己跑两次，那张图的列表圆点也有 1/255 的抖动）。
- 总览在会话草稿目录的 `s20/shots/overview/`：`01-whole-conversation.png`（整段对话，浅 / 深 / 英 / 英深）、`02-running-asking.png`（在跑与在问你）、`03-greeting-time.png`（只有问候；问候上面的时间条，定稿对票 19）、`04-small-and-wide.png`、`05-interactions.png`（「N 步」展开、悬停、选中、宽度上限、气泡里的图片）、`06-scroll.png`（贴底）、`07-live-line.png`（那一行随时间）、`08-pixel-diffs.png`（主对话的差别，左定稿右 `afc09d6e`）、`09-workbench-unchanged.png`（工作台不变）。自查截图 57 张在 `s20/shots/`（2x），比对图在 `s20/cmp-final/`，比对结论在 `s20/cmp-result.txt`，量测在 `s20/measure.json`。
- 量得（1480 窗口，CSS px），与票 19 一致：你的上限 560、它的 668.8（88%，右边至少空 91.2）；宽屏下 560 / 680；960 × 600 小窗口 559.4 / 615.3；两边圆角 12、内边距 10 / 14；同一边 4，你 → 它 20，它 → 你 30，回复 → 时间条 → 你 30 + 10.5 + 20，提问气泡到你的回答 46.1，带子任务卡片的回复到下一条 172.8，卡片在气泡下 12、宽同气泡；时间条 10.5px、水平居中（偏差不超过 0.1）；入口在气泡下 6、高 24、文字左缘与气泡左缘对齐、悬停底向左出 8；那一行 12px、行高 19.2、在上一条消息下 20；只有问候时问候离输入框卡片上沿 54；长回复整条出现后回复开头停在视口顶部下方 32、离底 150，「回到底部」出现；往上翻到顶再发一句，回到底部（离底 0）。

**与票的出入**：

1. 时间条的 data-role 叫 `assistant-time-divider`，因为 `assistant-time` 已经是侧栏卡片的时间。
2. 「发出后滚到底」测的是一行的 `assistantScrollToBottom`：hook 要真 DOM，node 测试环境跑不起来。
3. 「展开后不重复」用 `vi.mock` 让 ExpandSection 全展开（静态渲染点不了），Conversation 上没留试验那种 `stepsOpen` 测试口。
4. 测试分到按主题命名的新文件（`Conversation.assistant`、`MainView.assistant`）与 `lib/assistant-conversation.test.ts`，没有塞进 `Conversation.test.tsx`：要 mock ExpandSection，放进原文件会波及那里所有用例。
5. 问候后跨了天、落在今天的第一条用户消息，时间条写「今天 09:10」，不是「09:10」：这是同一套断点规则（与上一条跨天就带「今天」）的结果，票里没写到这一层。
6. 门只看 `isMainChat`，不像试验的 App 那样另看运行时与 screen，理由见「生效条件」。
7. 三处左侧气泡收成一个 `AssistantBubble` 组件，时间条直接用 MessageUser 的 `PinnedMessageTime`；DOM 与试验一样（只多了 data-role），画面不变。

**风险**：

- 一行的已知代价：长回复写完才整条出现，写的过程中那一行只显示正在流出那段的第一行。
- 回复的开头按 DOM 顺序找最后一个用户气泡之后第一个有高度的元素；以后在用户消息后面插别的东西，它会被当成开头。
- `userTimeMarks` 认问候只看 `greeting` 标记；以后别处也写同样来源的行，同样会拿它当基准。
- 分页边角（见上）：第一条用户消息的时间条可能等问候那页加载后才收掉。
- 宽度与间距都是 Chrome 量的；WebKit 的字宽可能差一点，由 JC 真机看。
- 气泡底与悬停色现在同值但不再联动：以后调悬停色，气泡不跟着变，这是本票要的；哪天想让两者一起变，要记得改两处。

**给 JC 的真机步骤补充**（票里六步之外）：

- 这票没动 Rust，dev 热更就行；如果主区还挂着「临时 · IM 画法」的 pill 或画面没变，`touch gui/index.html` 整页重载。机器上留下的 `galley.tmp.imTrial.*` 不用清，已经没人读。
- 不用等重置：现在这条主对话的问候上面也会出现时间（之前没有）；你的第一句如果在问候后 60 分钟内、同一天，它上面那条会收掉，否则照旧。
- 深色下看一眼它的气泡底：取值没变（`#24272c`），应该与试验时一样。
- 想对照试验那版的样子，看 `s20/shots/overview/08-pixel-diffs.png`。
