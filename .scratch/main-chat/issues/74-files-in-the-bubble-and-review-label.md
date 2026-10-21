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
