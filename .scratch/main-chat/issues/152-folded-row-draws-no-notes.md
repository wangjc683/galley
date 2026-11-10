# 152 待办面板：收起的一行不画备注

Status: done（2026-11-10 JC：「现在电脑我不使用，可以完全交给你，你直接在 dev 上真机验就行」。主会话在 dev 真窗口代验：面板 320px，两件带备注的事收起时各两行（标题、时间那一行或「1/7 项」），行距约 50px（此前带备注约 68px）；用真实鼠标点开第一件，备注全文、「添加一项」、记下的日子都在；Esc 收起，库里那件的 `updated_at` 没变。观感留给 JC 回来一眼，不合意再开票。此前：needs-dogfood（2026-11-10 代理交回，rebase 后快进合入 `7fafedff`。主会话验收：逐块读过 `TodoPanel.tsx`、`lib/todo-panel.ts`、`lib/todo-notes.ts` 与设计文档的改动（`NotesLine`、`todoNotesLine`、`todoNotesFolded` 三个删掉的东西各只有本票删掉的调用方）；在 worktree 复跑 typecheck、lint 过，`TZ=UTC` vitest 266 个文件 2,982 条全过，`check-docs-links` 507 个文件过，`git diff --check` 干净，新增行没有本机路径。dev 服务器给出的 `TodoPanel.tsx` 里已没有 `NotesLine`。没验到：合入时屏幕锁着，截不了 dev 窗口，收起的行高（带时间约 51px、只有标题约 32px）与底边间距还没在真窗口量，等 JC 回来看一眼，或解锁后主会话补截））

来源：[主聊天 PRD](../PRD.md) 裁决 206（JC 2026-11-10：「同意」「不留『有备注』的记号」「直接改」）；定位那句来自裁决 202。只改 GUI 与设计文档；只在内置运行时有主对话时有这个面板，外置运行时零变化。不碰 Core、库、CLI、runner、手册。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」。

## 为什么

- 面板里你要办的事，收起时一行最多三行字：标题、时间那一行、备注一行（截断）。带备注的一行约 68px，不带的约 51px。
- 备注是 Galley 写的（到时用得上的东西，最前面叠着进展），有备注的件件是长句；备注那一行约 256px 宽，放约 21 个汉字，露出来的只是半句，扫清单时用不上，却是每行里墨最多的一行。
- 2026-10-28 起点一行就原地打开（票 107），备注全文在打开后看；收起时那一行半句的前提（票 80：当时备注哪儿都看不到）已经不在。

## 要做的

1. **`gui/src/components/todo/TodoPanel.tsx`**（`YourRow`）：收起时（`!open`）不画备注，`notesBlock` 为空。删掉 `NotesLine` 组件。打开后的三种样子（在改、能改、只读）不变。`notesWords` 现在从 `todoNotesLine(item)?.full` 取，改成直接取这件事去掉首尾空白的备注，行为不变。
2. **`gui/src/lib/todo-panel.ts`**：`todoNotesLine` 没有别的调用方就删；**`gui/src/lib/todo-notes.ts`** 的 `todoNotesFolded` 同理（先 grep 全仓，确认每个调用方都在本票删掉的代码里，再删）。`RowShell` 的 `notes` 槽照留，打开后还用。
3. **不变的**：
   - 时间那一行（日子、铃铛与时刻、「2/5 项」）、悬停的「说说这件」「⋯」「取消提醒」、整行点了打开。
   - 没有时间也没有子项的事，收起时只剩标题一行（约 32px）。
   - 「它动过的行亮一下」（`lib/todo-panel.ts` 里判 `notes` 变了的那一处）不动：它改了备注，面板开着时那一行照旧亮。
   - 「Galley 在办」「例行」「已完成」、回复下的待办卡片：本来就不画备注，不动。
   - 勾下去停留的 1.5 秒：照旧，只是那一行本来就没有备注了。
4. **测试**：`TodoPanel.notes.test.tsx`、`TodoPanel.test.tsx`、`TodoPanel.items.test.tsx`、`TodoPanel.open.test.tsx`、`lib/todo-notes.test.ts`、`lib/todo-panel.test.ts` 里凡断言「收起的行里有 `data-role="todo-notes"`」的，改成断言没有；断言打开后备注在、次序（时间、子项、备注）对的照留。补一条：一件带备注的事，收起时这一行里没有备注的字，点开后备注全文在。
5. **设计文档 `docs/design/conversation/reply-cards.md`「待办面板」一节**：
   - 开头那句「Galley 的记事本（[主聊天 PRD](…) 裁决 91）：」换成：「你的主清单，Galley 打理（2026-11-10，[主聊天 PRD](../../../.scratch/main-chat/PRD.md) 裁决 202：清单是你的，打理是它的；此前裁决 91 叫它「Galley 的记事本」）：」，后面的字不动。
   - 「备注」那一条改写成现状：收起时不画（2026-11-10，票 152，裁决 206），打开后全文；把原来的理由与样式留成「此前（票 80 至票 151）」一句，写清为什么改（上面「为什么」三条，加上没选的三样：让它把备注写短、只给今天到期的行画、滴答式单行把日期放标题右端）。
   - 「三行三档墨」那一条：收起时只剩两行两档（标题 `ink`、时间那一行 `ink-soft`）；备注的 `ink-muted` 只在打开后。标题改成说得通的名字，别的地方引用这个小节名的一并改。
   - 「打开一件」「子项的计数」「提醒」等条目里凡说到「收起时备注……」「备注照旧在它下面」「悬停给全文」的句子，照现状改。grep 一遍 `docs/design/` 里「备注」二字，逐处核对，别留下说收起时有备注的句子。
   - 别的文档（`docs/agent-api/todo-commands.md`、`docs/managed-ga-runtime/` 下非手册的散文）只在说法与现状冲突时改一句。
6. 格式：`gui/` 里只格式化自己动过的 hunk，不要整文件 `prettier --write`。注释照周围的写法（英文，说现在是什么、为什么）。

## 别动

- 手册（`docs/managed-ga-runtime/galley-assistant-manual/`）：票 153 在改，本票一个字不碰。
- `.scratch/main-chat/PRD.md` 与别的票。
- 打开后的版面、间距、墨色（票 107、111、112 定的）。
- 不加「有备注」的图标或任何新记号。
- 主工作树；不跑 `tauri dev`。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui test
node scripts/check-docs-links.mjs
git diff --check
```

新增的中文行自写正则扫一遍半角标点（脚本放 scratchpad，文件名带 `t152-` 前缀）；新增行里不许有本机路径。

## 回报格式

照 dispatch「The report has four parts」。另外列出：删掉了哪些函数与组件、各自 grep 到的调用方；设计文档改了哪几处（小节名）。

## 真机步骤

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 合入后截 dev 窗口：带备注的两件事各两行，行高约 51px；点开一件，备注全文在 | 看一眼面板：还吵不吵；点开看备注是否顺手 |

## Comments
