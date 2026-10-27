# 03 来源标记只分两类：Galley 与 Galley CLI

Status: in-progress（2026-10-27 派出）

来源：[工作台对话 PRD](../PRD.md) 裁决 8（2026-10-27，JC：「按建议推进」）。只改 GUI 与文档，不碰 Rust、runner、CLI。

## 目标

不是你在桌面输入框里打的消息、不是你在桌面开的对话，界面上标出是谁：Galley 自己，或「Galley CLI」。今天两处都写「Supervisor」，普通用户读不懂；且 Galley 自己经 CLI 写的（聊天软件渠道开的对话、助理在子任务里替你答题）也被叫成 Supervisor。

## 现状（主会话 2026-10-27 核对）

- **消息**：`gui/src/components/conversation/MessageUser.tsx:259`，`origin?.via === "supervisor"` 时气泡上方靠右一行画 `PlugsConnected`（12px thin），提示写死英文 `"Supervisor"`（`:361`），aria 是 `copy.conversation.supervisorMessage`（「Supervisor 添加的消息」）。同一行还有子任务说明的 `House`（`via === "subtask"`，提示 `copy.subtask.fromMainChat`「主对话派来的」）。
- **侧栏**：`gui/src/components/layout/sidebar/SidebarSessionRow.tsx:123–127`，`origin.via === "supervisor"` 且标签不是 `galley-scheduler`（`SCHEDULER_SUPERVISOR`）时，标题右端画 `PlugsConnected`，提示与 aria 都是 `copy.sidebar.supervisorCreated`（「Supervisor 创建」）；定时任务那一类画时钟（`:432`），不动。
- **不带标签的 `via=cli`**：两处今天都不画（2026-05-21 devlog 决策 4）。本机库里有 10 条这样的消息、8 个会话。
- **时间**：`gui/src/lib/message-time.ts:118`，`via === "supervisor"` 的消息总有时间。
- **标签从哪来**：`galley-assistant` 是助理所有 CLI 写操作的固定标签（`core/src/managed_prompt.rs:473` 一带的手册说明）；聊天软件渠道是 `galley-im/{platform}`（`core/src/managed_prompt.rs:943` `im_supervisor_id`），Discord 是 `galley-im/discord/ch:<id>`（同文件 `:954` 注释），所以按前缀 `galley-im/` 认。`galley-report`、`galley-review`、`galley-subtask`、`galley-greeting` 都是 `via=system`，今天不画，照旧不画。

## 怎么改

1. **一个判断，两处共用**：在 `gui/src/lib/` 加一个小模块（名字你定，例如 `origin-marker.ts`），输入 `Origin | undefined`，输出 `"galley" | "cli" | null`：
   - `via` 为 `supervisor`、标签是 `galley-assistant` 或以 `galley-im/` 开头 → `"galley"`；
   - `via` 为 `supervisor` 的其他标签，或 `via` 为 `cli`（有没有标签都算）→ `"cli"`；
   - 其余（`gui`、`system`、`subtask`、没有 origin）→ `null`。`subtask` 的 `House` 照旧由 `MessageUser` 自己判，不并进来（它的提示不同）。
   - 两个 Galley 标签在 GUI 里写成常量，注释指向上面的 Core 出处，照 `lib/scheduled-tasks.ts` 的 `SCHEDULER_SUPERVISOR`、`lib/subtasks.ts` 的 `SUBTASK_REPORT_SUPERVISOR` 的写法。
   - 侧栏仍先排除 `galley-scheduler`（时钟优先），再用这个判断。
2. **消息**（`MessageUser.tsx`）：
   - `"galley"`：`House`，提示「Galley 创建」，aria「Galley 创建的消息」；
   - `"cli"`：`PlugsConnected`，提示「Galley CLI」，aria「Galley CLI 创建的消息」；
   - 子任务说明（`subtask`）：图标不变，提示与 aria 改为「Galley 创建」；
   - 写死的英文 `"Supervisor"` 删掉，提示走 locale。图标行的位置、尺寸、颜色不变。
3. **侧栏**（`SidebarSessionRow.tsx`）：
   - `"galley"`：`House`，提示与 aria「Galley 创建」；
   - `"cli"`：`PlugsConnected`，提示「Galley CLI」，aria「Galley CLI 创建」；
   - 位置、尺寸、颜色、悬停提墨不变。先确认会话对象上 `via=cli` 的会话确实带着 `origin`（`stores/sessions/shared.ts:173` 一带往回追到 Core 下发的字段）；带不着就停下来写进 Comments，别自己改 Core。
4. **时间**（`message-time.ts:118`）：`via` 为 `supervisor` 或 `cli` 的消息总有时间。
5. **文案**（zh / en 两份 locale，逐字照下表；键名你定，旧键 `supervisorCreated`、`supervisorMessage` 改名或删掉，别留着不用的键）：

   | 处 | zh | en |
   |---|---|---|
   | 消息 · Galley 提示 | Galley 创建 | Created by Galley |
   | 消息 · Galley aria | Galley 创建的消息 | Message created by Galley |
   | 消息 · CLI 提示 | Galley CLI | Galley CLI |
   | 消息 · CLI aria | Galley CLI 创建的消息 | Message created through Galley CLI |
   | 子任务说明（提示与 aria） | Galley 创建 | Created by Galley |
   | 侧栏 · Galley（提示与 aria） | Galley 创建 | Created by Galley |
   | 侧栏 · CLI 提示 | Galley CLI | Galley CLI |
   | 侧栏 · CLI aria | Galley CLI 创建 | Created through Galley CLI |

6. **注释**：`gui/src/types/conversation.ts`（`:110` 一带、`:189` 一带）与 `types/db.ts` 里「robot icon」「supervisor provenance marker」的说法照实改成两类。

## 文档

- `docs/design/layout-and-chrome.md:352`「Supervisor 来源徽标」一条改写为两类（标题也改，例如「来源徽标」），守住原来的那句：是 provenance，不参与排序，不覆盖 running / waiting / error 的 rail、icon、subline。
- `docs/design/conversation.md`：`:355`（子任务第一条消息与 `galley-assistant` 那句，「不显示来源的原字符串」保留）、`:84`（时间断点里的「Supervisor 来源消息」）、`:86`、`:98` 里指来源图标的「Supervisor」照实改。**只改指来源标记的地方**；`:354`「别的 supervisor 用 CLI 直接答……」这类指角色的保留。其余位置你 grep「Supervisor 来源」「Supervisor 图标」自己找全。
- `docs/copy-language-guidelines.md`：`:190` 那张术语表里加一行或在 `Supervisor` 那行补一句：来源标记写「Galley CLI」「Galley 创建」，不写 Supervisor（2026-10-27，工作台对话 PRD 裁决 8）。
- 不写 devlog、不改 PRD 与 deferred、不改本票 Status 行（主会话写）。`docs/devlog/deferred.md:245` 一带描述的是 10-16 当时的样子，不改。

## 不做

- Core、CLI、runner、Agent API、库的任何改动；标签的存法与 CLI JSON 不变。
- 图标行的位置、气泡颜色（deferred「派活说明的颜色」）、定时任务时钟徽标、「其他来源」分组的归组规则。
- 不显示原标签字符串（消息与侧栏都不显示，提示里也不显示）。

## 验收

- 跑：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui test`，再用 `TZ=America/Los_Angeles` 全量跑一遍；`git diff --check`；全角标点自查（自写脚本扫 diff 新增行，脚本放 scratchpad、文件名带 `wb03` 前缀，别覆盖别人的）。gui 不是 prettier-clean：旧文件只格式化自己改的 hunk，新文件可整篇格式化。React 编译器 lint：effect 内同步 setState、渲染期 `Date.now` 都是 error。
- **测试**至少覆盖：判断函数的各类输入（`galley-assistant`、`galley-im/wechat`、`galley-im/discord/ch:123`、`codex-supervisor/v1`、`via=cli` 无标签、`via=cli` 带标签、`gui`、`system`、`subtask`、无 origin）；消息三种画法的图标与 aria（改写 `Conversation.test.tsx:509`、`Conversation.assistant.test.tsx:491` 现有断言）；侧栏三种（Galley、CLI、`galley-scheduler` 仍是时钟、`via=cli` 的会话有 CLI 徽标）；`via=cli` 的消息总有时间。
- **反向检查**：改坏几处确认测试会挂，例如 `galley-im/` 前缀判成 CLI、`via=cli` 不画、提示退回写死的英文；恢复后逐字节一致。
- **JC 在 tauri dev 里走一遍**（数据都在本机库里）：
  1. 侧栏找 2026-05-21 那批 Codex 开的对话（「其他来源」里），悬停标题右端的图标，读「Galley CLI」；点开，第一条消息上方的图标同样读「Galley CLI」；
  2. 找 10-10 在微信里让它查厦门天气开的那个对话，侧栏是房子图标「Galley 创建」，第一条消息上方同样「Galley 创建」；
  3. 找 10-10 的「天空为什么是蓝色」（不带标签的 CLI），现在有「Galley CLI」图标，第一条消息上面有时间；
  4. 打开 Galley，点一张子任务卡片的「打开」，第一条消息上方的房子读「Galley 创建」；
  5. 切到英文界面看一眼上面任意两处。

## 回报格式

在本票末尾 `## Comments` 下写：改了哪些文件；新判断函数的位置与签名；会话 `origin` 的来源核对结果（第 3 步）；门禁输出摘要（两个时区的测试数）；反向检查做了哪几处；看到但没改的（票外问题、文档里拿不准该不该改的「Supervisor」）。代码、文档、记录分开提交，提交号只抄命令输出。

## Comments

### 实现回报（2026-10-27，worktree 分支 `workbench-origin-03`）

**文案按 2026-10-27 更新过**：Galley 那一类在消息、子任务说明、侧栏三处都是「Galley 创建」（消息读屏「Galley 创建的消息」，CLI 读屏「Galley CLI 创建的消息」），上面的文案表、第 2 条与验收第 2、4 步已同步。

**改了哪些文件**

- 新增 `gui/src/lib/origin-marker.ts`（判断与两个标签常量）、`gui/src/lib/origin-marker.test.ts`、`gui/src/components/conversation/MessageUser.origin.test.tsx`、`gui/src/components/layout/sidebar/SidebarSessionRow.origin.test.tsx`。
- 改 `gui/src/components/conversation/MessageUser.tsx`（图标行只画一个图标：子任务说明与 Galley 画 `House`，CLI 画 `PlugsConnected`，提示走 locale；写死的 `"Supervisor"` 删掉；文件头与 props 注释）、`gui/src/components/layout/sidebar/SidebarSessionRow.tsx`（先判时钟，再用判断）、`gui/src/lib/message-time.ts`（`via` 为 `supervisor` 或 `cli` 总有时间）、`gui/src/i18n/locales/zh.ts` 与 `en.ts`、`gui/src/types/conversation.ts`、`gui/src/types/db.ts`、`gui/src/types/session.ts`（`:107`「Sidebar only surfaces Supervisor-created rows」也因这次改动失真，一并改了，票面没点名）。
- 测试：`Conversation.test.tsx`（`:509` 一带改为 `galleyCreatedAria`，并补了 `> -1` 的守卫：原断言在找不到 aria 时 `indexOf` 为 -1 也会通过；子任务说明那条 `:334` 改成「Galley 创建」；新增不带标签的 `via=cli` 有图标、有时间一条）、`Conversation.assistant.test.tsx:491`（改为 `cliCreatedAria`）、`lib/message-time.test.ts`（原来断言 `via=cli` 不钉时间，改为钉）。
- 文档：`docs/design/layout-and-chrome.md`（「Supervisor 来源徽标」改为「来源徽标」两类，守住 provenance 那句）、`docs/design/conversation.md`（`:84`、`:86`、`:98`、`:355`，并在 `:355` 下加「来源图标只分两类」一条）、`docs/copy-language-guidelines.md`（术语表 `Supervisor` 那行补一句；`:363` 的「主对话派来的」也是来源图标的文案，照实改成「Galley 创建」，票面没点名）。
- 键名：`conversation.galleyCreated / galleyCreatedAria / cliCreated / cliCreatedAria`、`subtask.galleyCreated`（取代 `fromMainChat`）、`sidebar.galleyCreated / cliCreated / cliCreatedAria`（取代 `supervisorCreated`）；`supervisorMessage`、`supervisorCreated`、`fromMainChat` 已删，全仓 grep 无残留。

**判断函数**：`gui/src/lib/origin-marker.ts`，`export function originMarker(origin: Origin | undefined): OriginMarker | null`，`OriginMarker = "galley" | "cli"`；常量 `ASSISTANT_SUPERVISOR = "galley-assistant"`、`IM_SUPERVISOR_PREFIX = "galley-im/"`，注释指向 `core/src/managed_prompt.rs`（助理手册那句与 `im_supervisor_id`），测试钉住字面值。`via=cli` 一律 `"cli"`（带 `galley-assistant` 标签也是，`via` 说了算）；`via=supervisor` 缺标签也算 `"cli"`。

**会话 `origin` 核对（第 3 步）**：下发得到，没改 Rust。Core `SessionRow::into_brief`（`core/src/db/rows.rs:47`）把 `created_via` 经 `origin_from_stored`（`core/src/db/helpers.rs:175`）读回，只滤掉 `gui`，`cli` 照下发；`SessionBriefEvent` 从 brief 逐字段搬（`core/src/session_writes.rs:112`），事件也带；GUI `sessionFromBrief`（`gui/src/stores/sessions/shared.ts:173`）原样接。本机库只读查过：`sessions` 里 `cli` 无标签 8 个，`messages` 里 `cli` 无标签 10 条，与票面一致。

**门禁**（输出都在本机跑过）

- `pnpm --dir gui typecheck`：`tsc --noEmit` 无输出、退出 0。
- `pnpm --dir gui lint`：`eslint src --max-warnings 0` 退出 0。
- `TZ=UTC pnpm --dir gui test`：219 个文件、2420 条全过。
- `TZ=America/Los_Angeles pnpm --dir gui test`：219 个文件、2420 条全过。
- `git diff --check`：退出 0（新文件 `git add -N` 后一起查）。
- prettier：新文件整篇格式化；旧文件只看自己的 hunk，`SidebarSessionRow.tsx`、`zh.ts`、`en.ts`、`types/conversation.ts` 的 prettier 差异在 HEAD 上就有、条数没变，没碰。
- 全角标点：自写 `wb03-cjk-punct.py` 扫 diff 新增行与新文件，7 处命中都是 Markdown 链接的 `](`、`)` 与英文注释 / 英文测试标题里的英文标点，中文文案与文档无半角。

**反向检查**（每处改坏后跑六个相关测试文件，恢复后 `cmp` 逐字节一致）

1. `galley-im/` 前缀判成 CLI：4 条挂（判断、消息、侧栏、英文界面）。
2. `via=cli` 不画：7 条挂（判断、消息、侧栏、对话里的时间与图标）。
3. 消息提示退回写死的 `"Supervisor"`：5 条挂。
4. `via=cli` 不再总有时间：2 条挂（`message-time.test.ts`、`Conversation.test.tsx`）。
5. 侧栏不先判定时任务：1 条挂（时钟那条）。
6. 侧栏 CLI 的读屏丢掉「创建」：2 条挂。

**看到但没改**

- 定时任务开的会话，第一条消息的来源是 `via=supervisor`、`galley-scheduler`（`core/src/scheduler.rs:878` 经 `session.new`）。票面只让侧栏先排除时钟，消息这边照判断落到 `"cli"`：气泡上方会读「Galley CLI」（今天读「Supervisor」），侧栏同一个会话是时钟「定时任务创建」。本机库里眼下 0 条这样的消息。要不要在消息上也先排除定时任务（例如不画，或画时钟），留给主会话定。
- `README.md:180`、`README.zh-CN.md:180` 写「Supervisor 创建的 session 和发出的消息……带一个 Supervisor 标记」（英文版「carry a Supervisor mark」），描述的正是这次改掉的标记，且只说了 `via=supervisor`。
- `docs/screenshot-playbook.md:113`、`:169` 写 `tools.png` 里派活说明「标『主对话派来的』」：那是 v3 已拍截图的样子，重拍前改文字会与图不符。
- 指角色、不指标记，保留：`docs/design/conversation.md:98`「Supervisor、CLI 发进主对话、靠右的消息也一样」、`:354`「别的 supervisor 用 CLI 直接答……」、`:757`「CLI、Supervisor、system 发进来的（`external`）」；`docs/design/layout-and-chrome.md:295`、`:328`、`:363`。
- `docs/devlog/deferred.md:245` 一带照票面不改；`.scratch/main-chat/issues/31-subtask-wake-gui.md:161`、`.scratch/scheduled-tasks/` 里描述「Supervisor 创建」的是当时的记录，没改。
- `gui/src/stores/messages.ts:898` 的 `lastSubmitSource` 按 `cli / supervisor / system` 分滚动来源，与标记无关，没动。iOS 端（`ios/GalleyRemote/.../Types.swift`）只有 `OriginVia` 类型，没有来源标记的界面。

### 追加（2026-10-27，主会话验收后两处）

- **定时任务**（上面「看到但没改」第 1 条，主会话定）：`originMarker` 的类型变成 `"galley" | "cli" | "scheduled"`，标签等于 `SCHEDULER_SUPERVISOR`（`galley-scheduler`）时返回 `"scheduled"`，判在最前面、不看 `via`。侧栏的时钟改读这个返回值，不再单独判标签；消息上 `"scheduled"` 画 `Clock`（12px thin），提示与读屏同一句，新加 `conversation.scheduledCreated`（zh「定时任务创建」，en「Created by scheduled task」，与 `sidebar.scheduledCreated` 同值，测试钉住两者一致）。时间规则没动。补测试：判断函数（含 `via=cli` / `system` 带这个标签也是 `"scheduled"`，`galley-review` 不标）、消息（图标、提示、读屏、英文）、侧栏（`via=cli` 带这个标签照样是时钟）。`origin-marker.ts` 注释、`layout-and-chrome.md`「来源徽标」、`conversation.md` 的「来源图标」一条与 `:86`、`copy-language-guidelines.md` 术语表照实补上第三种。
- **README**：`README.md:180`、`README.zh-CN.md:180` 改为经 CLI 创建的会话和消息，带不带 `--supervisor` 都带「Galley CLI」标记（Galley 自己写的标 Galley，定时任务标时钟），`--supervisor` 的标签照旧记在 `origin`、界面不显示；英文用「Galley CLI mark」。`docs/screenshot-playbook.md` 照旧不改。
- **门禁**：`pnpm --dir gui typecheck` 退出 0；`pnpm --dir gui lint` 退出 0；`TZ=UTC` 与 `TZ=America/Los_Angeles` 全量各 219 个文件、2423 条全过；`git diff --check` 退出 0；全角标点扫新增行，5 处命中都是 Markdown 链接括号与英文注释里的英文标点。
- **反向检查**：去掉 `originMarker` 里的 `"scheduled"` 分支，4 条挂（判断、消息、侧栏两条）；恢复后 `cmp` 逐字节一致。
