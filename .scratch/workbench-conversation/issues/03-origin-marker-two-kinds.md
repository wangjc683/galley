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
