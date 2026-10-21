# 74 主对话气泡下挂它交出的文件；巡看那条例行显示成本地化的名字

Status: ready-for-agent

来源：[助手 PRD](../../assistant/PRD.md) 裁决 10「IM 体验两处」的第一处、主聊天 PRD 裁决 124（2026-10-21，JC：「按建议推进」）。只改 GUI；Core、runner、CLI 不动。依赖票 73 的两个契约（见「契约」），可以先按契约写、用测试数据验，不必等 73 合入。

## 起因

JC 读的那篇 Today AI 使用体验里，助理交出的 HTML 计划、飞书文档、Banner 图在对话里各是一条看得见的东西，像同事在 IM 里发文件。Galley 主对话里，回复的 `[FILE:路径]` 标记被清掉（`gui/src/lib/ipc/ga-output-cleaning.ts` 的 `cleanFinalAnswer`），路径收进 `turn.files`（`gui/src/stores/messages/rowsToTurns.ts:94-96`），可只有侧栏卡片读它、写一句「[文件] 名字」（`gui/src/types/conversation.ts:270-276`），对话里什么都看不到。裁决 10 让它主动做事、做完再说；做出来的东西看不见，「顺手弄好了」就只剩一句话。票 73 会教主对话交文件时写 `[FILE:<绝对路径>]`，本票把它画出来。

## 契约（票 73 定）

- **文件**：主对话 assistant 行的原始 `content` 里，一行一个 `[FILE:<绝对路径>]`；现有的 `finalAnswerFileRefs` 已经取得出来。
- **巡看那条例行**：`scheduled_tasks.created_by_supervisor = 'galley-review'`，每天 09:00、`target = assistant`，`prompt` 是给模型看的英文，界面不显示。GUI 拿到的定时任务 / 待办数据里应带着这个 supervisor（`origin.supervisor` 或现有同义字段）；如果今天的 IPC 结构带不出来，在回报里写明，等 73 的回报定字段名，别自己改 Core。

## 一、文件卡片

1. **画在哪**：主对话里 Galley 的回复气泡下面，`turn.files` 有几条画几张，顺序照标记顺序；挂法参照回复下已有的卡片（提醒卡片、子任务卡片，票 37、06a），与它们同一套间距和对齐。叫醒回复同样画；`<no-reply/>` 的回复本来就不画，照旧。
2. **一张卡片**：文件类型图标、文件名（中间省略，保留扩展名）、所在文件夹的短写（`~/…`）；不显示完整绝对路径。图片（png、jpg、jpeg、gif、webp）画成缩略图卡片，点开看大图，复用对话里看图的那条路（`core/src/conversation_image.rs` 与对应的 GUI 调用）。
3. **点了做什么**：先看现有的本地文件预览（`core/src/local_file.rs` 的 inspect / 预览，和主对话右侧阅读面板那个位置，裁决 91 第 5 条），能预览的（文本、Markdown、HTML 源码、图片）在阅读面板里打开；不能预览的用系统默认程序打开。悬停或右键给「在 Finder 中显示」（Windows 是「在资源管理器中显示」，文案照现有同义按钮的 locale 键复用）。
4. **文件不在了**：卡片照画，变淡，文件名后写「已移走或删除」（en：「Moved or deleted」），点了不报错弹窗。存在性检查用现有的 local file 命令，别逐帧查，打开对话时查一次就够。
5. **范围**：只在主对话。工作台会话、子任务、外置运行时零变化（外置没有主对话）。侧栏卡片「[文件] 名字」不变。
6. 视觉：先读 `docs/design/README.md` 及卡片、附件相关章节，grep「不要 / 有意 / 分叉」禁令；能复用的组件（用户消息里的附件 chip、子任务卡片的壳）优先复用，不新造样式体系。

## 二、巡看那条例行

清单面板（`gui/src/components/todo/TodoPanel.tsx`）「例行」组里，`galley-review` 那条不显示它的英文 `prompt`，显示本地化名字：zh「每天 9:00 过一遍在办的事」，en「Go over what’s in hand, daily at 9:00」；时间取任务实际的 `time_of_day`（用户让它改了时间就跟着变），规则与下次时间照 `routineRowLine` 现有写法。它在列表里和别的例行同组、同样式，归在 Galley 的那一类（标明是 Galley 的，照现有区分 Galley 与用户的写法）。停用时照现有停用例行的样子。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `core/`、`runner/`、`cli/`、`managed-ga/`、手册与提示词（都是票 73）。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化自己的 hunk，不跑 `prettier --write` 整文件。
- React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；状态归零用 guarded setState-in-render；工具函数别从组件文件导出。
- 静态渲染测试（`renderToStaticMarkup`）读不到测试里往 zustand 塞的值，读的是初始状态；需要时用 `vi.mock`。
- 提交只点名文件：`git add <文件…> && git commit …`；提交说明英文，结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 中文文案全角标点。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- 相关 vitest：`TZ=UTC` 与 `TZ=America/Los_Angeles` 各跑一遍（时间与日期显示相关）。
- 加测试：有 `[FILE:]` 的主对话回复画出卡片、顺序对；图片走缩略图；文件不在时的样子；工作台会话不画；巡看那条显示本地化名字、时间跟 `time_of_day`。
- 可以用临时渲染页截图给主会话看卡片的样子（中英、浅深色各一张），截图放 scratchpad，用票号前缀命名，测完删掉临时页。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 改了哪些文件、各一句话；复用了哪些现有组件与命令。
3. 验证命令与结果原样。
4. 截图路径（若做了）。
5. 契约：GUI 实际读的字段名；如果今天带不出 `galley-review`，写明缺什么。
6. 看到但没改的问题、没验证到的地方（原样列出）。

## 给 JC 的真机步骤

（合入后补）

## Comments

### 2026-10-21 执行回报（worktree `ticket-74-files-in-bubble`）

- **提交**：`57789e40` Main chat: file cards under a reply, the daily review's own name (ticket 74)。只动 `gui/`。
- **复用**：点卡片走文件引用同一条路（`LocalFilesContext` 的 `activate`：能预览的进阅读面板，其余在文件夹中显示）；存在性用 `local_file` 的 `inspect`（`accessLocalFile`）；文件夹短写用 `FolderPathText` + `useHomeDir`（`~`）；图片用用户附件同款 96px 缩略图、`ImagePreviewDialog` 与 `open_conversation_image`；卡片壳照提醒卡片（hairline、`rounded-md`、`bg-app`、40px 一行、无投影）；文案键复用 `localFiles.locate`「在文件夹中显示」与 `localFiles.copyPath`；右键菜单照 `MarkdownImage` 的样式；例行第二行照旧 `routineRowLine`。
- **GUI 读的字段**：文件读 `AgentTurn.files`（`finalAnswerFileRefs` 取原始 `content` / `responseContent` 里的 `[FILE:]`）。巡看读 `list_assistant_todo` 的 `TodoItem`：`kind === "task"` 且 `agent === "galley-review"`（常量 `REVIEW_SUPERVISOR`，`gui/src/lib/scheduled-tasks.ts`）。今天的 Core 已经带得出：`core/src/assistant_todo.rs` 的 `creator()` 对 `via` 不是 `gui`、supervisor 不是 `galley-assistant` 的任务，给 `createdBy: "agent"`、`agent: <标签>`。前提（请票 73 核对）：种子的 `created_via` 不能是 `gui`；`creator()` 不能把 `galley-review` 改映射成 Assistant（那样 `agent` 为空，GUI 认不出）。
- **截图**（临时页 + 浏览器打桩，Core 的回答是假的，页面已删）：scratchpad 下 `t74-zh-CN-light.png`、`t74-zh-CN-dark.png`、`t74-en-US-light.png`、`t74-en-US-dark.png`、`t74-zh-CN-light-narrow.png`（窄栏看中间省略）。
- **与票面不一致、按代码取的最小选择**：
  1. 「不能预览的用系统默认程序打开」做不到：Core 的 `open` 只放行文档、图片、安全文本（`core/src/local_file.rs` 的 `is_openable`），pdf、docx、xlsx 会被拒；不改 Core，照文件引用现有做法：不能预览的在文件夹中显示并选中。
  2. 「在 Finder 中显示 / 在资源管理器中显示」：现有同义键是平台中性的「在文件夹中显示」/「Show in folder」，照票面直接复用，没有新造分平台的文案。
  3. 组间次序票面没定：文件卡片排第一（这条回复本身交出的东西），后面子任务、待办、提醒各隔 8px；为此 `SubtaskCards` 加了 `afterFiles`。
  4. 「标明是 Galley 的」：例行组现有不分谁建的（主对话 PRD 裁决 86 第 4 条），巡看那条与别的例行同图标同样式，没加标记。
  5. 文件不在时右键只剩「复制路径」，悬停不出「在文件夹中显示」；点它只悄悄再问一次 Core，回来了就照常打开。每次点卡片都先问一次，打开对话之后才被删的文件也不会弹错。
- **没验证到、看到没改的**：
  - 没在 tauri dev 里看过（按约束没跑），资源协议加载缩略图、阅读面板、在文件夹中显示都只有静态测试与打桩截图。
  - 回复只有 `[FILE:]`、没有字时，`buildAgentTurn` 在 `finalAnswer` 为空时丢掉 `files`（`gui/src/lib/agent-turn.ts:196`），没有气泡也没有卡片；靠票 73 入口层要求「话里也说一句」，没改。
  - 中文名字中间省略时，省略号后会留不到一个字宽的空（CSS 按整字退），同 `FolderPathText` 现状。
  - 巡看到点后（含被跳过但记了 `last_fired_at` 的那次）在「已完成」里有一行，第二行照 `doneRowLine` 写「今天 09:00 · 已提醒」，「已提醒」对巡看不太贴切，没改。
  - 外置运行时的定时任务对话框（`ScheduledTasksDialog`）照旧直接显示 `prompt`：从内置切到外置时，库里的巡看那条会以英文出现在那里。票面范围只在待办面板，没改。
  - 巡看送不出去的系统通知走 `reminder-undelivered` 的 `prompt`（`gui/src/hooks/useSchedulerSignals.ts`）；票 73 定的是 Core 直接丢掉不发，若仍发，GUI 会弹英文。
  - 每次进主对话（MainView 按会话重挂）每个文件问一次 `inspect`，没做并发去重；文件很多的长历史没量过。

### 2026-10-21 补改：巡看的名字不带时间

- 主会话看截图后改（票面原写法的问题）：名字里写时间、第二行例行规则又写一遍，时间重复、格式也不一致（「每天 9:00 过一遍在办的事 / 每天 09:00 · 下次 明天 09:00」）。改成名字不带时间：zh「过一遍在办的事」，en「Go over what’s in hand」；时间只在第二行，照旧 `routineRowLine`，跟着任务实际的 `time_of_day` 变。
- `todo.dailyReview` 改成不带参数的字符串；`DAILY_REVIEW_SEED_TIME` 与去前导零的逻辑删掉；测试与 locale 注释跟着改。
- 上面回报里「巡看在『已完成』里出一行、写『已提醒』」那条，主会话已让票 73 在 Core 的读取里排除，GUI 不改。

### 2026-10-21 补改：文档用默认应用打开（JC：「按建议推进，并进 73」）

- **分工**：Core 那一半在票 73（`core/src/local_file.rs` 的 `is_openable` 加 `pdf`、`docx`、`xlsx`、`pptx`、`pages`、`numbers`、`html`、`htm`；不放 `doc`、`xls`、`ppt`、`docm`、`xlsm`、`pptm`、`key`）。两票一起合：票 73 合入前，GUI 对 pdf 等发 `open` 会被 Core 拒，弹「无法预览或打开此路径」，正常。
- **白名单镜像**：`gui/src/lib/local-file-path.ts` 新常量 `OPENABLE_DOCUMENT_EXTENSIONS`，与上面一字不差，`isOpenableWithDefaultApp` 带上它；注释写明镜像 Core `is_openable` 的文档清单。Core 那边还没有这个常量，建议票 73 用同名常量，两边一眼对得上。
- **文件卡片**（`fileCardClick`，`gui/src/lib/file-cards.ts`）：这组文档（含 HTML，交出的成品要看渲染效果）→ `fileOperation(…, "open")` 用默认应用打开；Markdown、文本 → 阅读面板；图片照旧缩略图、看图；其余（zip 等）→ 照旧在文件夹中显示。Core 回答是文件夹的，不论叫什么都照文件夹走，不发 `open`。
- **正文里的文件链接**（`referenceClick`，`LocalFileReference`）：能预览的照旧进阅读面板，HTML 照旧看源码；不能预览、在白名单里的（pdf、docx 等）改为用默认应用打开；其余照旧交给阅读面板的判断（在文件夹中显示，或 Core 嗅出是文本）。跟着同一判断改的两处：这类链接的悬停提示由「在文件夹中显示」改为「用默认应用打开」，链接旁补上文件夹按钮（原来点链接就是在文件夹中显示，改成打开后不补这颗按钮，就没处去文件夹了；同可预览文件的样子）。工作台里写入步骤那颗打开按钮没动，仍走阅读面板的判断。
- **阅读面板**：所有预览共用一个顶栏（`LocalFileWorkspace.tsx` 的 `markdownHeader`），「更多」里的「用默认应用打开」看 `isOpenableWithDefaultApp`，HTML 预览自动出现；PDF 不进阅读面板，不涉及。
- 上面第一份回报「与票面不一致」第 1 条（不能预览的用系统默认程序打开做不到）由本节取代。
- **风险**：`.pages`、`.numbers` 若是包格式（其实是文件夹），Core 的 `open` 要求是普通文件，会拒；卡片这边 Core 答 directory 就走文件夹路线，正文链接仍会发 `open` 并弹错。没在真机验证。
- **补（`.pages` / `.numbers` 包）**：票 73 让 Core 的 `open` 对扩展名是 `pages`、`numbers` 的文件夹放行。GUI 配合：文件卡片里 Core 报 directory、扩展名是这两个的，走用默认应用打开，图标也画文档（Pages 画文档、Numbers 画表格）而不是文件夹；其余文件夹（含 `.key`）照旧在文件夹中显示。正文链接本来就发 `open`，没改。上一条风险随之收掉。剩一处没改：这种包的卡片悬停「在文件夹中显示」，Core 对文件夹的 reveal 是直接打开它（`open_path`），在 macOS 上等于用 Pages 打开，不是在 Finder 里选中。

### 2026-10-21 补改：「定时」对话框不列巡看那条

- 票 73 回报的契约与这边读的一致：`list_assistant_todo` 里巡看在 `routine` 组，`kind === "task"`、`agent === "galley-review"`；`list_scheduled_tasks` 里它的 `origin` 是 `{"via":"system","supervisor":"galley-review"}`。
- 「定时」对话框（`ScheduledTasksDialog`）只在没有主对话时打得开，即外置运行时；之前用过内置的，库里有巡看这一行，它在外置下本来就不跑。改成：对话框读回列表后去掉 `origin.supervisor === REVIEW_SUPERVISOR` 的任务（`isDailyReviewTask`，`gui/src/lib/scheduled-tasks.ts`），件数与开机自启提示也只算剩下的。第一份回报里「外置的定时对话框照旧显示 prompt」那条由此收掉。
