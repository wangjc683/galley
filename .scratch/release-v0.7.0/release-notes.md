Galley is now your personal assistant: you talk to one person, and it runs a team for you and reports back on everything. With Bundled GA that person is Galley, in a main chat that is always there: it hands longer jobs to subtasks in the workbench, checks what comes back and tells you how they went, and keeps your to-dos and reminders. Your existing conversations stay in the workbench; Channels keep their own chats and share long-term memory with the desktop.

With an external GenericAgent there is no main chat and the sidebar stays as it was; below, the workbench and conversation changes apply to you, the assistant does not. To meet the assistant, switch to Bundled GA in Settings → Runtime; it keeps its own memory, separate from your GenericAgent's.

## What's New

- The main chat opens at launch at the top of the sidebar as Galley's card: its face moves with what the assistant is doing (Reduce Motion keeps it still), and its second line shows the state, a question waiting for you, your draft or the last message. The workbench sits below a line; ⌘\ (Ctrl+\ on Windows) folds the sidebar, leaving a badge that counts the conversations waiting for you.
- The main chat reads like a messaging app: bubbles on both sides, a typing bubble that grows into the reply, send times as centred lines. Hover a message for copy, quote and ⋯; a reply adds save and, from two steps on, a process button that opens one line a step. A single message can be deleted from ⋯ or the right-click menu, with undo.
- After four idle hours the main chat starts a new context segment that carries the last ten turns (up to 15,000 characters), and the assistant looks back through earlier history when it needs to. Reset main chat… (its title menu, or Settings → Runtime) takes a 5-second hold and clears its messages, your to-dos and its long-term memory, back to a fresh install.
- The assistant hands longer jobs to subtasks: a card under its reply, a run in the workbench with a "Galley ›" breadcrumb back, and no sidebar row until you write in it. When a subtask finishes, asks or fails, the assistant wakes to check it against what was asked, sends it back (at most twice) or tells you in a line or two; it answers a subtask's questions when it can and asks you in its own chat when it can't. A subtask that asks, fails, or finishes after more than two minutes sends a notification.
- The assistant runs Galley for you: it starts conversations, creates projects, tidies up into the archive and sets one-off reminders on its own, then tells you how to undo it. API keys, sign-ins and the browser extension stay yours; it tells you where to fill them in.
- The assistant keeps your to-dos: mention that the materials are due next Wednesday and it decides whether to note it and when to remind you; "no need" cancels it. It follows up unasked on things coming up on a date, remembers the kinds of follow-up you turned down, and when a reminder comes due says what is of use now rather than reading the item back.
- Every conversation's top bar has a To-do button with today's count, opening the to-do panel beside the conversation. There you tick items off or back, read their notes, delete your own (five seconds to undo) and cancel Galley's own reminders; anything new goes through ＋ (Tell Galley). While the panel is open, rows Galley adds or changes light up; a to-do card's title opens the panel at its row; the panel opens by itself once, the first time a to-do card appears.
- The assistant acts unasked where it can: groundwork it can undo it just does, anything outward-facing it prepares and then asks about, and when nothing got done it says nothing. It notes what you set aside unfinished, and every morning around 9:00 it runs "Go over what's in hand", waking only for undated to-dos, ones due within three days or overdue, and unfinished subtasks.
- Files the assistant hands over show as cards under its reply. PDF, Word, Excel, PowerPoint, Pages, Numbers and HTML files open from a card in their default app, and a link to such a document in any conversation opens there too (HTML links still preview in the reading panel).
- Goal is removed: the composer's Goal toggle, the top-bar indicator, goal markers in the conversation, the "When a Goal ends or needs you" notification and the `galley goal` commands are gone. Past goal conversations read as ordinary ones.
- Workbench conversations, the whole window with an external GenericAgent, follow the main chat's grammar: your words on the right, times as centred lines, a finished run's fold opening one line a step, and no fold header on one-step replies. After you send, your words stay at the top while the reply grows below them instead of being followed; a question the run asks scrolls into view.
- In every conversation, drafts survive a restart (text only); selected text can be quoted into the composer, shown as a strip above the input and as a quote block in your bubble; clicking a button or blank space keeps the composer focused; smooth scrolling honours Reduce Motion.
- Every composer is one line (＋, input, model · effort, send), with its popovers centred on their buttons; the workbench keeps its hint row underneath, and the effort list puts the highest tier first.
- ⌘F (Ctrl+F) finds in the open conversation through the palette scoped to it, with dated hits; Backspace widens it to every conversation. Every title menu has Find in chat….
- Long conversations load 50 turns at a time as you scroll back, never splitting a run.
- A reply whose answer was only in its closing summary now shows that summary instead of coming up empty.
- The ChatGPT provider signs in with OpenAI's official Sign in with ChatGPT (Continue with ChatGPT) and uses your Plus / Pro plan; you can see, cap and disconnect Galley in your ChatGPT settings. It replaces the Codex CLI login: if you signed in that way, sign in again. Only Plus and Pro plans can be used; on another plan, use a provider with an API key.
- Models that use your ChatGPT plan carry the ChatGPT logo before their name wherever they are listed (the composer, its model menu, ⌘K, Your Models in Settings → Models), and plan errors in a conversation offer Manage usage or Sign in in Settings.
- Settings → Models says how each provider connects (ChatGPT plan, Official API, OpenAI-compatible), Add opens the provider list directly, and a provider that needs no API key, such as a local Ollama, can be saved again.
- WeChat: while Galley works you see only that it is typing, then one message: the answer (from two steps on, ending in an "N 步 · 用时 X" line), a question with numbered choices you answer by number, or a stop notice. Answers are no longer cut at 3,000 characters, the "[任务已完成]" message is gone, and reports on jobs handed to desktop sessions now reach WeChat.
- Telegram and Discord answers no longer open with their steps: from two steps on, a 过程 button shows them, expanding the message in place as a quote on Telegram and replying on Discord so that only whoever clicked sees it.
- Feishu: a Typing reaction on your message replaces the status card, and the answer is one card with its steps in a collapsed 过程 panel; a message sent mid-run queues instead of being refused, /stop works, questions are numbered, headings become bold lines, the answer quotes your message when others came in between, and completion reports carry only the final step.
- A new app icon, the flat wooden robot G, drawn on Apple's icon grid on macOS; the assistant's avatar is the same icon in a circle.
- With Bundled GA the top bar no longer has the Supervisor SOP icon; Settings → Agent and Agent in ⌘K open the page. External GA keeps the icon.
- Presses, the Settings carets and the project group's slide-in now animate as designed; Settings tabs are evenly spaced; short words no longer break inside table cells.

## Under the Hood

- Agent API moves to `schemaVersion: 3`: Goal is removed with no successor, so every `goal` command answers `unknown_command` under every pin, `galley goal …` exits 2, and `MessageBrief.goalId` is no longer produced; `1` and `2` are still served for every command that did not change. Added, and also served under `1` / `2`: the `schedule` and `todo` families; `session rename / pin / unpin / delete`; `project update / pin / unpin / archive-sessions`; `llm set-default`; `session send --ensure-runner`; `session show --around / --since / --until` and `sessions search --session`; `mainChat`, `parentSessionId`, `promoted` and `origin.via: "subtask"` on sessions; `cancelledBy` on to-dos and scheduled tasks. Migration notes in `docs/agent-api/stability-and-versioning.md` §7.1.
- Bundled GA moves to upstream as of 2026-10-21: upstream's plan mode is gone; long tasks get fewer turn-end reminders and memory re-injections; a DeepSeek reply that ends in a leaked tool-call marker is regenerated instead of taken as the answer. It also fixes a v0.6.x bug: switching models in an open conversation after a Settings model edit (or `/llm` in a channel) dropped Galley's prompt from that conversation until its runner restarted.
- With an external GenericAgent recent enough to rebuild its model clients when a task starts, Galley re-applies the conversation's reasoning effort and image attachments after the rebuild; saving `mykey.py` mid-session used to drop both from the next task.
- Sign in with ChatGPT opens a one-shot HTTP listener on `127.0.0.1` while a sign-in is pending: it accepts the single matching callback and closes, or closes when it times out.
- Core now starts every runner and restores its history itself, for the window, the CLI and the assistant's own wakes alike; conversations started from the CLI now get automatic titles too.
- Deleting a conversation now also deletes its text from the search index; text that earlier deletions left there is not cleaned up.
- Database migrations 043–052 run once on first launch, after Galley's usual automatic backup of the data directory. v0.6.x quits at launch on the upgraded database, so going back means restoring that backup (`app.galley.backup.*`, next to the data directory), and losing what you did after the upgrade. Goal records stay in the database, unread.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.7.0/Galley_0.7.0_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.7.0/Galley_0.7.0_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.7.0/Galley_0.7.0_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.6.2...v0.7.0

---

Galley 从这一版起是你的私人助理：你只跟一个人说话，它替你带一支团队，事事给你交代。使用内置 GA 时，这个人就是一直在的主对话 Galley：费时间的活它派给工作台里的子任务，回来验收、给你交代，你的待办和提醒也由它记着。已有的对话都留在工作台里；聊天软件里的对话各归各，与桌面共用长期记忆。

使用外部 GA 时没有主对话，侧栏保持原样；下面的条目里，工作台和对话的改动对你同样适用，助理相关的不适用。想用助理，到「设置 → 运行环境」切到内置 GA；它有自己的记忆，与你的 GenericAgent 分开。

## What's New

- 主对话在启动时打开，在侧栏顶部显示为 Galley 的卡片：脸会随助理在做的事动起来（开启「减弱动态效果」时保持静止），第二行显示状态、等你回复的问题、你的草稿或最后一条消息。工作台在一条分隔线下方；⌘\（Windows 用 Ctrl+\）收起侧栏，收起后的徽标显示有几个对话在等你。
- 主对话像聊天软件：两侧都是气泡，助理在忙时出现「正在输入」气泡，回复到了就在原处长成回复，发送时间以居中的一行显示。悬停消息可以复制、引用、点 ⋯；回复另有保存，两步以上还有过程按钮，打开后一步一行。单条消息可以从 ⋯ 或右键菜单删除，能撤销。
- 主对话空闲 4 小时后开新的一段上下文，带上最近 10 轮（不超过 1.5 万字符），需要时助理会回头翻更早的历史。「重置主对话…」（标题菜单，或「设置 → 运行环境」）要按住 5 秒，清掉主对话的消息、你的待办和它的长期记忆，回到全新安装的状态。
- 费时间的活助理派给子任务：回复下面一张卡片，在工作台里跑，标题前的「Galley ›」可以回到主对话，你在里面说话之前不占侧栏的位置。子任务跑完、提问或出错时助理被叫醒：对照要求验收，不够就打回去（最多两次），够了用一两句告诉你；子任务的提问它答得了就替你答，答不了就在自己的对话里问你。子任务提问、出错，或跑了 2 分钟以上才完成时，会发系统通知。
- 助理替你管 Galley：开对话、建项目、整理归档、设一次性提醒都自己动手，做完告诉你怎么撤；API Key、登录和浏览器扩展只能你来，它会告诉你去哪填。
- 助理替你记待办：你说一句「下周三交材料」，它自己判断要不要记、什么时候提醒；说一声「不用」就取消。日子临近、到时用得上的事它不等你开口就跟进，你回绝过的那类跟进它会记住；提醒到点时，它说的是此刻用得上的话，不是把条目念一遍。
- 每个对话的顶栏都有「待办」按钮，显示今天的件数，点开后待办面板在对话旁边打开：可以勾掉或取消勾选、看备注、删除你自己的待办（5 秒内可撤销）、取消 Galley 自己设的提醒；新的事点 ＋（跟 Galley 说）。面板开着时，Galley 新加或改过的行会亮一下；点待办卡片的标题，面板打开并定位到那一行；第一次出现待办卡片时，面板会自己打开一次。
- 能自己办的事助理不等你开口：能撤回的准备工作直接做，对外的事先准备好再问你，什么都没办成就不出声。你中途放下的事它会记下；每天上午 9 点前后它「过一遍在办的事」，只为没定日期的待办、3 天内到期或已过期的待办、没完成的子任务醒来。
- 助理交给你的文件以卡片显示在回复下面。PDF、Word、Excel、PowerPoint、Pages、Numbers 和 HTML 文件从卡片用默认应用打开；任何对话里指向这类文档的链接也一样（HTML 链接仍在阅读面板里预览）。
- 移除 Goal：输入框的 Goal 开关、顶栏的 Goal 指示、对话里的目标标记、「Goal 结束或需要介入时通知」和 `galley goal` 命令一并移除。以前的 Goal 对话按普通对话显示。
- 工作台的对话（使用外部 GA 时就是整个窗口）改用主对话的写法：你的话在右边，时间以居中的一行显示，跑完的折叠打开后一步一行，只有一步的回复不再带折叠头。发送之后你的话停在上方，回复在它下面长出来，不再跟着滚动；运行中的提问会滚进视野。
- 所有对话里：草稿重启后还在（仅文字）；选中的文字可以引用进输入框，在输入框上方显示为一条引用，在你的气泡里画成引用块；点按钮或对话空白处，输入框不会失焦；平滑滚动遵循「减弱动态效果」。
- 所有输入框改成一行：＋、输入、「模型 · 强度」、发送，弹出菜单以按钮为中心；工作台的提示行留在输入框下方，推理强度列表最高档排在最前。
- ⌘F（Windows 用 Ctrl+F）用限定在当前对话的 ⌘K 面板查找，命中带日期，按退格扩大到全部对话；每个标题菜单都有「查找聊天记录…」。
- 长对话往上翻时每次加载 50 轮，一次运行不会被拆开。
- 答案只写在收尾摘要里的回复，现在显示那段摘要，不再是空的。
- ChatGPT 服务商改用 OpenAI 官方的 Sign in with ChatGPT（「用 ChatGPT 登录」），使用你的 Plus / Pro 订阅；可以在 ChatGPT 设置里查看、限制或断开 Galley。它取代了 Codex CLI 登录：以前用那种方式登录的，需要重新登录。只有 Plus 和 Pro 订阅可用；其他订阅请改用填 API Key 的服务商。
- 使用 ChatGPT 订阅的模型，在列出它的地方名字前都有 ChatGPT 标志（输入框、模型菜单、⌘K、「设置 → 模型」里的「我的模型」）；对话里的订阅报错带「管理用量」或「去设置登录」按钮。
- 「设置 → 模型」写明每个服务商怎么接（ChatGPT 订阅、官方 API、OpenAI 兼容），「添加」直接打开服务商列表；不需要 API Key 的服务商（例如本地的 Ollama）又能保存了。
- 微信：Galley 在忙时只显示「对方正在输入」，然后发一条消息：回答（两步以上时末行是「N 步 · 用时 X」）、带编号选项的提问（回编号即可作答），或停止通知。回答不再在 3000 字处截断，不再另发「[任务已完成]」；交给桌面会话的活办完后，汇报也会发到微信。
- Telegram 与 Discord 的回答不再以步骤开头：两步以上时下面挂一个「过程」按钮，Telegram 在原消息里展开成引用，Discord 回一条只有点击者看得到的消息。
- 飞书：在你的消息上贴「Typing」表情，不再先发状态卡片；回答是一张卡片，步骤收在折叠的「过程」面板里；运行中再发的消息排队，不再被拒；支持 /stop；提问带编号；标题转成粗体行；中间插进了别的消息时，回答会引用你的原话；完成汇报只带最后一步。
- 新的应用图标：扁平的木头机器人 G，macOS 上按 Apple 的图标网格绘制；助理的头像就是这个图标裁成圆形。
- 使用内置 GA 时，顶栏不再有 Supervisor SOP 图标，从「设置 → 智能体接入」或 ⌘K 的「智能体接入」打开这一页。外部 GA 保留这个图标。
- 按钮按下的下沉、设置页的展开箭头和项目组的滑入动画现在按设计播放；设置页侧栏各项间距均匀；表格单元格里的短词不再被拆开换行。

## Under the Hood

- Agent API 升到 `schemaVersion: 3`：Goal 移除，没有替代命令；所有 `goal` 命令在任何 pin 下都返回 `unknown_command`，`galley goal …` 以 exit 2 退出，`MessageBrief.goalId` 不再出现；没有改动的命令仍照常响应 `1` 和 `2`。新增（在 `1` / `2` 下同样可用）：`schedule` 与 `todo` 命令族；`session rename / pin / unpin / delete`；`project update / pin / unpin / archive-sessions`；`llm set-default`；`session send --ensure-runner`；`session show --around / --since / --until` 与 `sessions search --session`；会话上的 `mainChat`、`parentSessionId`、`promoted` 与 `origin.via: "subtask"`；待办与定时任务上的 `cancelledBy`。迁移说明见 `docs/agent-api/stability-and-versioning.md` §7.1。
- 内置 GA 更新到上游 2026-10-21 的版本：上游移除了 plan mode；长任务里的回合末提醒和记忆重复注入更少；DeepSeek 的回复末尾漏出工具调用标记时会重新生成，不再当作最终回答。同时修掉 v0.6.x 的一个问题：在设置里改过模型后，在已打开的对话里切换模型（或在渠道里用 `/llm`），这个对话会丢掉 Galley 的提示词，直到 runner 重启。
- 使用会在任务开始时重建模型客户端的较新外部 GenericAgent 时，Galley 在重建后重新应用这个对话的推理强度和图片附件；此前会话中途保存 `mykey.py`，下一个任务会丢掉这两样。
- 「用 ChatGPT 登录」进行中时，会在 `127.0.0.1` 上开一个一次性的 HTTP 监听：只接收一次匹配的回调，然后关闭；超时也会关闭。
- 每个 runner 都由 Core 自己启动并恢复历史，窗口、CLI 和助理被叫醒时都一样；从 CLI 开的对话现在也会自动起标题。
- 删除对话时，它在搜索索引里的文字现在一并删除；以前删除的对话留在索引里的文字不会补删。
- 数据库迁移 043–052 在首次启动时执行一次，执行前照常自动备份数据目录。升级后的数据库会让 v0.6.x 一启动就退出，要退回只能恢复那份备份（数据目录旁的 `app.galley.backup.*`），升级之后做的改动会丢失。Goal 的记录留在数据库里，不再读取。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.7.0/Galley_0.7.0_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.7.0/Galley_0.7.0_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.7.0/Galley_0.7.0_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
