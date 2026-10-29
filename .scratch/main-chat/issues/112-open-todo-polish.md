# 112 打开一件后的两处打磨：子项能拖动排序；排版拉开层级，备注里的路径能点

Status: needs-dogfood（2026-10-29 18:24 快进合入 `34ed9d09`…`7f329b3e`（基点 `586a9c04`），合入前 `busy:0`；touch `core/src/assistant_manual.rs`，重编 CLI sidecar 并替换 `core/target/debug/galley`，核过：18:25:30 编出的 `galley-core` 与在跑进程同一 inode、二进制里有「never move one they did not ask you to」。主会话验收：门禁复跑全过（cargo 1282/0，gui 2608 本机与 `TZ=UTC`，typecheck、lint、文档链接、`git diff --check`）；`main..HEAD` 扫过接口主机、服务商名、密钥 0 处，`/Users/jc/…` 10 处是测试里的虚构路径（仓库已有 47 处同写法）；`gui/src/lib/caret-point.ts` 票面没点名，看过：备注分段画、路径只画文件名后，点备注进入修改要把点的位置换回原文位置，原函数行为不变。评测：`items-move-first`、`items-move-news`、`review-done-not-noted` 各 3/3（后者路径三遍都在反引号里），`review-user-news-on-top` 2/3（判定的否定词表认不出「不要只重做」，误判），`progress-review-done` 0/3、main 旧手册对照 1/3（不是本票带来的，反引号在这条上没测到），回归 52/57 同上次，`tick-soil` 过变不过（话只写在 `<summary>` 里）。代理报告没验证到的：真窗口鼠标拖动与松手吞点击（jsdom 无 PointerEvent，只测了键盘与队列）、减少动态下不滑、点文件换掉待办面板与回来时那件收起、实际视觉；文件引用旁 20px 的文件夹按钮会把 16.8px 那一行撑高一点。上一轮 Status：ready-for-agent（2026-10-29 JC 看过「文字稿」：「没问题，开始做」））

来源：[主聊天 PRD](../PRD.md) 裁决 158（2026-10-29，JC：「按你的建议推进」）。第 1 点拖动排序选甲，第 2 点排版选乙。Core、桌面命令、CLI 与 Agent API（`schemaVersion 3` 内加法）、手册与评测、GUI、设计文档。不加迁移（次序已有 `todo_subitems.position`）。只在内置运行时；外置运行时没有主对话与待办，零变化。

## 为什么

- 子项按加的先后排，排错了只能删了重加。设计文档子项一节原写「不做：拖动排序（真机要再说）」，JC 真机后提出来，就是那句「再说」。模型设置已有同样的操作（`ConfiguredModelsPanel.tsx`），用户上手不用学。
- JC 截图里打开的希尔顿（7 项、两条进展）读着乱，原因都在代码里（裁决 158 第 2 条）：
  - 标题与子项同字号同墨（13px `ink`），子项读成与标题平级；
  - 「添加一项」与备注同样子（12px `ink-muted`），读成备注第一行；
  - 块与块之间只有 0–6px，比行距（24px、16.8px）还小，分不出一块在哪结束；
  - 一个绝对路径占约 3 行、点不开；每条进展开头的日子与正文同墨，扫不出下一条从哪起。

## 文字稿（JC 10-29 看过）

只管「你的事」里打开的那一件。收起的样子只改备注那一行的路径写法（见下「收起那一行」）。

### 一、子项拖动排序

**把手**
- 子项那一行悬停或键盘聚焦在它上面时，左边出现一个把手：`DotsSixVertical` 13px bold，在 20px 见方的按钮里，同模型设置那一颗。
- 位置在待办方框正下方那一列（这一列本来空着：行左边留 10px，方框占 16px），把手中心对着上面的待办方框中心。离子项的方框 8px，各项的位置一点不动。
- 墨色：出现时 `ink-muted`，指到把手上 `ink`；鼠标是抓手，拖动时是抓紧的手。
- 无障碍名与悬停提示「拖动调整『订机票』的位置」（`zh.ts` 已有 `dragToReorder` 的句式，照它写一句子项的）。
- 不出现的时候：只有一项；勾下去那 1.5 秒（不能改）；这一项正在改字；还没存进 Core 的那几项；「添加一项」那一行。

**拖**
- 按住把手拖过 4px 才算拖，点一下什么都不做（同模型设置）。
- 只能上下拖，出不了这件的子项列表。拖着的那一项浮起来（`bg-elevated`，压在别的项上面），别的项让出位置、滑过去（`@dnd-kit/sortable` 现成的过渡；减少动态时不滑、直接换位）。
- 松手就是新次序，当即画好，再交给 Core（同一件的写入照旧一个接一个排队，同勾与加）。拖回原位不写。
- 失败：回到拖之前的次序，列表下面写原因（同勾失败那两句：「没能完成，再试一次。」「这件事已经不在了。」）。

**键盘**
- Tab 能走到把手（走到时把手出现）；空格拿起，上下方向键挪，空格放下，Esc 放弃。读屏提示照模型设置那一处的做法。

**Galley 那一边**
- 你跟它说「把筹开预算挪到最前」「酒店放到最后」：它先 `todo show`，再 `todo item move <item-id> --to=<n>`。
- 它不自己排：子项是你的，你没说就不动次序（同裁决 157 第 12 条）。
- 它挪了次序，面板开着时那一行亮一下（比较时次序算这件事的字段）；你自己拖的不亮。
- 挪次序也更新这件事的 `updated_at`，巡看算它动过，同子项的增删改勾（裁决 157 第 8 条）。

**CLI**（措辞照 `todo item` 现有命令）
- `todo item move <item-id> --to=<n>`：n 从 1 起，是挪过去之后它在这件里排第几；大于项数就放到最后，小于 1 报 `invalid_args`。`--supervisor`、`--reason` 照旧，输出同别的子项写入（这件待办带全部子项）。socket 是 `todo.item_move`。

### 二、打开后的排版

从上到下，下面写的都是可见的间距：

1. **方框与标题**：不变（13px `ink`）。
2. **时间那一行**：不变，有子项时末尾的计数照旧。
3. **子项**：离时间那一行 4px。
   - 没勾的字从 `ink` 退到 `ink-soft`；勾了的照旧 `ink-muted` 加删除线。这样整块里只有标题是满墨，同裁决 146「同字号靠墨色分主次」。
   - 方框、字号、行高、项与项之间不变。
4. **「添加一项」**：在方框那一列画一个 `Plus`（12px regular，`ink-muted`），字从子项的字那一列起（12px `ink-muted`）。读起来是这一列的最后一行，不像备注。指上去字与加号都到 `ink-soft`。
5. **备注**：离「添加一项」10px。
   - **段与段之间空 6px**：备注里每一行（按换行分）单独成一段；连续几个空行只算一个间隔。段内照旧 12px、行高 1.4、`ink-muted`、长了换行。
   - **日子提一档墨**：一段开头是日子加冒号的（「10月29日：」，英文 `Oct 29:` 那种月份缩写加日子），这一截用 `ink-soft`、数字等宽（`tabular-nums`），后面照旧 `ink-muted`。这是裁决 146「备注 `ink-muted`」的一个例外，只给日子那一截。
   - **路径能点**：反引号里是一个完整路径（规则同回复：绝对路径、`~/…`、`file://`，Windows 盘符与 UNC 也算；`gui/src/lib/local-file-path.ts` 的 `localFilePath`）的，画成回复里那种文件引用（`LocalFileReference`）。字只写文件名（「希尔顿项目资料收集模板.md」），反引号不显示；悬停、按下的样子，悬停提示，右键「复制路径」都同回复。点了也同回复：能预览的进阅读面板，其余在访达里显示。
   - 反引号里不是路径的、没有反引号的路径：照原样显示成字，同今天。
   - **点了能预览的文件，待办面板会被换掉**：阅读面板与待办面板同一个位置、同时只开一个（设计文档「本地文件引用与 Markdown 预览」末尾）。回来点顶栏的待办按钮，刚才打开的那件是收起的：票 107 定的「打开着的那件不记」。主会话先不改，真机看了嫌再说。
   - **改备注时**照旧是整段原文的输入框，反引号、日子都照原样露出来。
   - 没有备注时，「添加备注」也离「添加一项」10px。
6. **「10月28日记下 · 在对话里查看」**：离备注 10px，样子不变。

希尔顿打开后：标题、「1/7 项」，4px 后 7 项，「＋ 添加一项」；10px 后两段进展，段间 6px，「10月29日：」「10月28日：」深一档，路径只剩一个可点的文件名；10px 后记下那一行。原来 9 行的备注约剩 5 行。

**收起那一行**（备注压成一行的那种）：反引号里的路径也只写文件名、反引号不显示，但不能点（点这一行照旧是打开）。日子不提墨：收起时照三行三档墨。

**Galley 那一边**（手册）
- 往备注里写文件时，写完整路径、放进反引号，同它在回复里写路径（`todos-change.md` 里「a file by its absolute path」那句，及别处教它往备注里写路径的地方）。
- 旧的、没有反引号的路径它不自己去补：手册让它保留原来的备注一字不差。你让它改就改。

### 不做

- 待办本身的拖动排序（次序按时间，裁决 130）；拖动把子项升成待办、把待办拖进别的待办当子项；在「⋯」菜单里加上移、下移（子项没有菜单，键盘走把手）。
- 单开一段「进展」（裁决 154 第 6 条的乙，续缓，见 `docs/devlog/deferred.md`「待办上的进展」）。
- 认没有反引号的路径（回复里也不扫正文，设计文档「本地文件引用」09-08）。
- 改收起时的行高、三档墨，改标题字号或字重；回复下的待办卡片。
- 视觉的轻重（子项退到 `ink-soft`、块间 10px、段间 6px）先按上面做；JC 真机看了想比，再上两档切换器（另一档：子项照旧 `ink`、标题加粗一档）。

## 现状（读码起点）

- 子项：`gui/src/components/todo/TodoSubitems.tsx`（`ITEM_TYPE`、`SubitemAdd`、行的 `py-0.5`、列表外层 `-mt-1 pb-1.5 pl-9`）；在途的写与排队在 `gui/src/stores/assistant-todo.ts`（`subitemTicks`、`subitemAdds` 等）；子项的 TS 封装在 `gui/src/lib/assistant-todo.ts`。
- 打开那一块：`gui/src/components/todo/TodoPanel.tsx` 的 `YourRow`（行 `px-2.5`、方框列 `w-4`、`gap-2.5`，标题起点 36px）；备注 `notesBlock`（约 980–1040 行）、`NOTES_TYPE`（约 1143 行）、收起的 `NotesLine`；记下那一行 `data-role="todo-noted"`。
- 拖动的先例：`gui/src/components/screens/settings/models/ConfiguredModelsPanel.tsx`（`PointerSensor` 的 `distance: 4`、`KeyboardSensor`、把手按钮的类名、拖着时的 `z-10 bg-elevated`）；依赖已在 `gui/package.json`（`@dnd-kit/core`、`sortable`、`utilities`）。
- 文件引用：`gui/src/components/conversation/LocalFileReference.tsx`（没有 `LocalFilesContext` 时只画字，面板里要接上回复那边同一个 context，看 `MarkdownView.tsx` 怎么给的）；路径判定 `gui/src/lib/local-file-path.ts`（`localFilePath`、`previewKindByPath`、`referenceClick`）。
- 亮行比较：`gui/src/lib/todo-panel.ts` 的 `todoPanelChanges`。
- Core 与 CLI：子项在 `core/src/assistant_todo.rs` 一带（票 111 加的，`todo_subitems` 表、`position` 列）；CLI `cli/src/todo.rs`；文档 `docs/agent-api/todo-commands.md`；socket 命令表照 `todo.item_*` 现有几条。
- 手册：`docs/managed-ga-runtime/galley-assistant-manual/todos-change.md`（进展那一条第 17 行附近、子项那一条）、`todos.md`；`unasked.md` 第 31 行是回复里 `[FILE:…]` 文件卡片的规矩，别和备注的写法混。
- 评测：`.scratch/main-chat/entry-layer-eval/todo/`（`progress-review-done` 那类往备注里写文件的用例、`items-*` 用例）；跑法见同目录 README，解释器用系统 python3.14。
- 设计文档：`docs/design/conversation.md`「待办面板」里的「打开一件」「子项」（「不做：拖动排序（真机要再说）」那句）、「三行三档墨」「备注」「动作只有这几个」（「没有拖动排序（待办与子项都没有）」那句）。

## 要做

1. **Core**：挪子项次序的写入（同一件里重排 `position`，一个事务）；更新所属待办的 `updated_at`；拖回原位不写。
2. **桌面命令**：GUI 用的挪位置命令，类型镜像进 `gui/src/lib/assistant-todo.ts`。
3. **CLI 与 Agent API**：`todo item move <item-id> --to=<n>`（见文字稿），`schemaVersion 3` 内加法，`--schema=1`、`2` 是否也认照 `todo item` 现有命令；`docs/agent-api/todo-commands.md` 加一节，错误码照现有的。
4. **手册**：`todos-change.md` 子项那条加挪次序（用户说了才挪）；往备注里写路径改成写进反引号（找全教它写路径的地方）。照现有手册的英文写法，例句用中文。
5. **GUI**：照文字稿做把手与拖动（含键盘与失败）、亮行比较加次序、打开后的间距与墨色、「添加一项」的加号、备注分段与日子提墨、备注里反引号路径的文件引用（打开时可点、收起时只写文件名）。文案进 `zh.ts` 与 `en.ts`。
6. **评测**（真模型，`mm_1792576875658`，`meta` 写明模型 id），每条 3 遍：
   1. 一件带 7 项的待办（同希尔顿），用户说「把筹开预算挪到第一个」：先 `todo show`，再 `todo item move <那一项> --to=1`；不加、不删、不勾别的。
   2. 同一件，用户说「业主说筹开预算下周给」：照旧备注最前面补一行进展，不挪次序。
   3. 往备注里写文件的用例（`progress-review-done` 等现有的几条）：备注里的路径在反引号里；原来的判定照旧过。
   旧的 `todo` 用例全套跑一遍看有没有回退。判定写进结果文件。
7. **设计文档**：`docs/design/conversation.md`「待办面板」补拖动排序（把手、拖、键盘、Galley、亮行）、打开后的间距与墨色、备注的分段、日子、路径；改掉「不做：拖动排序（真机要再说）」与「没有拖动排序（待办与子项都没有）」两句；「三行三档墨」「备注」两处写明日子那一截的例外。照周围写法写理由与没选的。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 不加迁移，不升 `schemaVersion`；「已完成」「Galley 在办」「例行」的行；回复下的卡片；回复里的文件引用规则本身（只是拿来用）；runner、`managed-ga/`、入口层提示词里待办以外的部分。改「要做」以外的东西先停下来问。
- 不加叫醒、不加后台调用（裁决 49）。
- `core/` 不是 rustfmt-clean，只用 `rustfmt --check` 核对自己动过的文件；`gui/` 不是 prettier-clean，旧文件只格式化自己的 hunk，新文件可整篇。
- 跑评测用 `PYTHONDONTWRITEBYTECODE=1`，`managed-ga/code/` 下不许出现 `__pycache__`；结果里不写服务商名、接口地址、本机路径（`/Users/…`、临时目录），提交前对整个分支全量扫一遍（`run.py` 的 `scrub` 已会换掉接口主机）。
- 注释与提交说明照周围写法；提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- 中文全角标点：手册例句、设计文档、文案、结果文件新增的中文行，自写正则扫，脚本放 scratchpad、文件名带 `t112-` 前缀。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`（挪次序的读写、`updated_at` 跟着动、拖回原位不写、CLI 集成测试、越界与小于 1）。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`（本机与 `TZ=UTC` 各一遍）；新 vitest 覆盖：把手什么时候出现、拖完的次序与排队写入、失败回到原次序、键盘挪、它挪了那一行亮、备注分段、日子那一截的识别（中英文，开头不是日子的不提墨）、反引号路径画成文件名、不是路径的反引号照原样、收起那一行只写文件名。
- `node scripts/check-docs-links.mjs`、`git diff --check main..HEAD`。
- 评测见「要做」第 6 条。

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 挪次序在 Core 里怎么写的；CLI 命令与 JSON 的最终样子；Agent API 文档改了哪几节。
3. 手册的最终原文（新增与改动的段落）。
4. GUI 要点：拖动怎么接的（sensor、约束、失败回滚）、文件引用的 context 怎么接进面板、英文文案。
5. 评测：每条过了几遍，没过的原文摘录；回归有没有掉；花了多少次真调用。
6. 验证命令与结果原样。
7. 票面没写到、你自己定的边界；看到但没改的问题；没验证到的（逐条）。

## 给 JC 的真机步骤

合入前主会话看 `busy:0`；合入后 touch `core/src/assistant_manual.rs`、重编 CLI sidecar 并替换 `core/target/debug/galley`（`tauri dev` 不重编 CLI），核二进制与进程。

1. 打开希尔顿：看间距、子项的墨色、「＋ 添加一项」、备注分段与日子（文字稿里主会话替你定的几处视觉）。
2. 拖一项换位置，再拖回去；用键盘挪一次（Tab 到把手、空格、方向键、空格）。
3. 跟 Galley 说「希尔顿备注里那个文件路径照新写法改一下」：路径变成一个可点的文件名，点开是那份模板。
4. 跟 Galley 说「把筹开预算挪到第一个」：那一项到最上面，那一行亮一下。
