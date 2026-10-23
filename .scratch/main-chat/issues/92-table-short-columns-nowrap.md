# 92 表格的短列不折行

Status: needs-dogfood（2026-10-23 机器验收过、合入 main；等 JC 在 dev 里看那张东部预测表）

来源：[主聊天 PRD](../PRD.md) 裁决 136（2026-10-23；JC：「按你推荐推进」）。只改 GUI 与设计文档，不上切换器，JC 在 dev 里看。

## 为什么

- 主对话一条回复里的东部预测表（三列：常规赛排名 / 球队 / 我的判断），球队名被挤成竖排。原因：WebKit 的表格自动布局大致按每列「不折行时有多长」分宽度，中文任意两字之间都能断行，短列最小只有一个字宽。球队列最长 4 个字，判断列一格约 56 个字，球队列只分到约 8%。
- 主会话用 WKWebView 按同一套样式实测（栏宽 760、气泡内宽约 641px、单元格左右各 12px）：标准字号（表格 14px）球队列 52px，两字一行（尼克/斯、凯尔/特人、76/人），表头「常规赛排名」3 行，表高 572px；大一档（15.5px）51px，一字一行（凯尔特人 4 行），表高 706px。短列不折行后：标准 528px、大一档 562px，队名与表头都是一行。
- 2026-10-16 的 `7082870a`（单元格 `anywhere` → `break-word`，`MarkdownView.tsx` 的表格那段注释）保护的是数字与英文词，管不到中文。这张票补上中文那一半。

## 要做的

1. **规则**（纯函数，放 `gui/src/lib/` 下新文件，名字你定）：对一张表，
   - 每一列取所有格（含表头）渲染后的文字（不算 markdown 标记：加粗、链接只算链接文字、行内代码算里面的字），算显示宽度：全角 / 宽字符算 2，其余算 1。`gui/src/lib/composer-quote.ts:131` 一带已有同样的宽度算法（`WIDE` 与它的计数函数），抽出来共用，别再写一份。
   - 一列每一格都 ≤ 16，这一列是短列。
   - 所有短列的最大宽度加起来 ≤ 40：这些短列不折行；> 40：都不启用，整张表照旧。
   - 长列照旧折行。没有短列、或整张表都是短列且合计 ≤ 40（本来就放得下，不折行等于不变）都按规则走即可，不另设例外。
   - 行里格子数不齐时按位置算列，缺的格不参与。
2. **接到渲染上**：`gui/src/components/conversation/MarkdownView.tsx`。现在 `ReactMarkdown` 只有 `remarkPlugins`（gfm、cjk-friendly 等），没有 rehype 插件。做法任选其一，选更简单、更好测的：remark 插件在 mdast 的 `table` 上算，给短列的 `tableCell` 写 `data.hProperties`（例如 `data-short-col`）；或 rehype 插件在 hast 上做同样的事；或 `table` 组件读 `node`。样式用属性选择器挂在现有表格那串类名旁边：短列的 `th`、`td` 加 `white-space: nowrap`。注释写清为什么（中文短列被按比例挤到一个字宽；与 10-16 `break-word` 那段是同一件事的中文一半）和上限 40 的理由（免得新增横向滚动）。
3. **范围**：`MarkdownView` 的所有表格一起生效：主对话气泡、工作台回复、思考摘要、Markdown 文件预览。气泡里的表格覆写（`AssistantParts.tsx` 的 `BUBBLE`）不用动。流式时规则跟着当前内容算，某列先短后长会重排一次，接受。
4. **设计文档**：`docs/design/conversation.md`
   - 「Markdown 渲染」那张表里 `table (GFM)` 一行（约第 424 行）：加上短列不折行的规则与上限，引用主聊天 PRD 裁决 136，保留 10-16 那句。
   - 「助手的对话」里「气泡里的代码和表格」那条（约第 104 行）若写着「单元格折行」，补一句短列不折行。
   - 中文，标点全角，代码用反引号。只改这两处；同文件「在跑时：三点气泡」一节另一张票（91）在改，别碰。

## 测试

- 纯函数：短列 / 长列分界（16 与 17）；表头参与判断（表头长、格子短 → 不是短列）；合计 40 与 41；半角算 1、全角算 2；加粗、链接、行内代码只算文字；行里格子数不齐；整张表都是短列。
- 用库里那张真实的表做夹具（下面原样贴了）：常规赛排名、球队两列是短列，判断列不是；渲染后前两列的 `th`、`td` 带上不折行的标记，第三列没有。
- 一张会超过上限的表（例如 6 列、每列 8 个汉字）：哪一列都没有标记。
- 工作台与主对话气泡里各渲染一次，标记一样。
- 现有 `MarkdownView` 相关测试照旧全过。

夹具（主对话 2026-10-23 一条回复里的表，原样）：

```markdown
| 常规赛排名 | 球队 | 我的判断 |
|---|---|---|
| **1** | **尼克斯** | 卫冕核心仍在，布伦森的关键球、主力之间的默契最值得信任。隐患是失去米切尔·罗宾逊后，护筐和内线深度下降。 |
| **2** | **凯尔特人** | 布朗离队损失很大，但塔图姆领衔，配上怀特、普里查德和成熟体系，常规赛下限仍高。乔治的健康和状态决定季后赛上限。 |
| **4** | **76人** | 马克西、布朗、詹姆斯、恩比德加埃奇库姆，纸面天赋最吓人。但阵容磨合、恩比德出勤和老将体能，让我不敢押常规赛第一。 |
| **7** | **步行者** | 我愿意押哈利伯顿回归带来的反弹。卡莱尔的调整能力、哈利伯顿与祖巴茨的挡拆值得期待，但不能默认跟腱伤后马上恢复巅峰。 |
```

## 别动

- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- 表格的其他样式（格线、内边距、字号、表头、`break-word` 与行内代码 / 链接的 `anywhere`、外层 `overflow-x-auto`）；气泡覆写。
- `core/`、`runner/`、`managed-ga/`、提示词；`.scratch/` 下的 PRD（主会话维护）。另一张票（91）同时在改 `MainView`、`TypingBubble`、`lib/assistant*.ts`、侧栏与 `conversation.md` 的「在跑时」一节，这些你都用不到，别碰。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过
- `CI=true pnpm --dir gui test` 全过
- `git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 规则函数与接线（插件或组件）的 diff 原样。
3. 宽度算法抽出来放在哪、`composer-quote.ts` 怎么改的。
4. 设计文档两处 diff 原样。
5. 验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方。

## Comments

### 2026-10-23 回报（票 92 代理）

**1. 提交列表**（`git log --oneline main..HEAD`，写本回报之前；本回报另起一个提交）

````text
bf613e4f Ticket 92: refresh the ticket-90 switcher snapshot for the table classes
2a5574fc Ticket 92: short table columns don't wrap (main chat ruling 136)
c35c1ed8 Ticket 92: share the display-width count as lib/text-columns
````

**2. 规则函数与接线**

接线选 remark 插件：仓里已有同一形态的 `lib/remark-document-headings.ts`（在 mdast 上写 `data.hProperties`）；mdast 里加粗、链接、行内代码已经是结构，取渲染后的文字不用再剥 markdown 记号；`mdast-util-to-hast` 的单元格会把 `hProperties` 带到 `<th>` / `<td>` 上，测试直接看渲染出来的属性。规则函数与插件都在新文件 `gui/src/lib/table-short-columns.ts`（`shortTableColumns` 是纯函数，`remarkTableShortColumns` 是插件），组件文件不导出工具函数。

````diff
diff --git a/gui/src/components/conversation/MarkdownView.tsx b/gui/src/components/conversation/MarkdownView.tsx
index 581185d5..48dfe75f 100644
--- a/gui/src/components/conversation/MarkdownView.tsx
+++ b/gui/src/components/conversation/MarkdownView.tsx
@@ -20,6 +20,7 @@ import {
 import { CodeBlockContext } from "@/lib/code-block-context";
 import { DocumentPathContext } from "@/lib/local-files";
 import { remarkDocumentHeadings } from "@/lib/remark-document-headings";
+import { remarkTableShortColumns } from "@/lib/table-short-columns";
 import { markdownUrlTransform } from "@/lib/markdown-image-src";
 import { cn } from "@/lib/utils";

@@ -164,6 +165,7 @@ export const MarkdownView = memo(function MarkdownView({
             remarkPlugins={[
               remarkGfm,
               remarkCjkFriendly,
+              remarkTableShortColumns,
               ...(documentPath ? [remarkDocumentHeadings] : []),
               ...(softBreaks ? [remarkBreaks] : []),
             ]}
@@ -284,6 +286,17 @@ const PROSE_BASE = cn(
   // cell (the long unbroken addresses and paths) may break anywhere.
   "[&_th]:border [&_th]:border-line [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-ink",
   "[&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-ink [&_td]:[overflow-wrap:break-word] [&_td_code]:[overflow-wrap:anywhere] [&_td_a]:[overflow-wrap:anywhere]",
+  // Short columns do not wrap (2026-10-23, main chat PRD ruling 136):
+  // the Chinese half of the 10-16 fix above. Chinese breaks between any
+  // two characters, so a column of short Chinese cells has a min-content
+  // width of one character, and next to a long prose column it was
+  // squeezed by proportion until 「凯尔特人」 stood one character a
+  // line. A column whose every cell is at most 16 columns (8 CJK
+  // characters) carries `data-short-col` (lib/table-short-columns.ts)
+  // and stays on one line; the long columns wrap as before. The short
+  // columns may take 40 columns between them, or none is kept whole, so
+  // that keeping them whole does not add a sideways scroll.
+  "[&_th[data-short-col]]:whitespace-nowrap [&_td[data-short-col]]:whitespace-nowrap",
   // hr inside markdown.
   "[&_hr]:[margin-block:calc(var(--conversation-block-gap)*1.6667)] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-line",
   // Strong / em — keep weight in line with the prose body. Body is normal
diff --git a/gui/src/lib/table-short-columns.ts b/gui/src/lib/table-short-columns.ts
new file mode 100644
index 00000000..2f28fde9
--- /dev/null
+++ b/gui/src/lib/table-short-columns.ts
@@ -0,0 +1,99 @@
+import { textColumns } from "@/lib/text-columns";
+
+/**
+ * Which columns of a Markdown table keep their cells on one line (main
+ * chat PRD ruling 136, ticket 92).
+ *
+ * WebKit's automatic table layout shares the width out roughly by how
+ * long each column is unwrapped, and Chinese may break between any two
+ * characters, so a short Chinese column can be squeezed down to one
+ * character: next to a column of 56-character cells, a column of team
+ * names got 8% of the table and stood 「凯尔特人」 one character a line.
+ * A column whose every cell, header included, is short does not wrap;
+ * the rest wrap as before. The rule reads the text only, so it comes
+ * out the same in every surface and at every reading size.
+ */
+
+/** A column is short when no cell of it, header included, is wider than
+ * this many columns (8 CJK characters; `textColumns`). */
+export const SHORT_COLUMN_MAX = 16;
+
+/** The most columns the short columns may take between them, about 20
+ * CJK characters (at most 310px of text at the largest table size, under
+ * half the ~641px inside a bubble in the 760 column). Past it none of
+ * them is kept whole and the table wraps as before: an unwrapped cell
+ * raises the least width the table can take, and without the cap 7 of
+ * the 269 tables in the database would newly scroll sideways (ruling
+ * 136 item 3). */
+export const SHORT_COLUMNS_BUDGET = 40;
+
+/**
+ * The columns to keep on one line, by position. `rows` is each row's
+ * cells as they read (Markdown markers off), the header row included.
+ * Rows may be ragged: a column is measured on the cells it has.
+ */
+export function shortTableColumns(
+  rows: readonly (readonly string[])[],
+): Set<number> {
+  const widest: number[] = [];
+  for (const row of rows) {
+    row.forEach((cell, column) => {
+      widest[column] = Math.max(widest[column] ?? 0, textColumns(cell));
+    });
+  }
+  const short = new Set<number>();
+  let total = 0;
+  widest.forEach((width, column) => {
+    if (width > SHORT_COLUMN_MAX) return;
+    short.add(column);
+    total += width;
+  });
+  return total > SHORT_COLUMNS_BUDGET ? new Set() : short;
+}
+
+interface Node {
+  type: string;
+  value?: string;
+  align?: unknown[];
+  children?: Node[];
+  data?: { hProperties?: Record<string, unknown> };
+}
+
+/** A cell's text as it renders: text and inline code by their value,
+ * emphasis and links by their children; whitespace collapses. */
+function renderedText(node: Node): string {
+  const text = (n: Node): string =>
+    n.value ?? n.children?.map(text).join("") ?? "";
+  return text(node).replace(/\s+/g, " ").trim();
+}
+
+/** Marks the cells of each table's short columns (`shortTableColumns`)
+ * with `data-short-col`, which MarkdownView's table styles key
+ * `white-space: nowrap` off. */
+export function remarkTableShortColumns() {
+  return (tree: Node) => {
+    const visit = (node: Node) => {
+      if (node.type === "table") markShortColumns(node);
+      else node.children?.forEach(visit);
+    };
+    visit(tree);
+  };
+}
+
+function markShortColumns(table: Node) {
+  // GFM draws as many columns as the delimiter row has; a row's cells
+  // past that are parsed but never drawn, so they do not count.
+  const rows = (table.children ?? []).map((row) =>
+    (row.children ?? []).slice(0, table.align?.length),
+  );
+  const short = shortTableColumns(rows.map((cells) => cells.map(renderedText)));
+  for (const cells of rows) {
+    cells.forEach((cell, column) => {
+      if (!short.has(column)) return;
+      cell.data = {
+        ...cell.data,
+        hProperties: { ...cell.data?.hProperties, "data-short-col": "" },
+      };
+    });
+  }
+}
````

**3. 宽度算法放在哪**

抽到新文件 `gui/src/lib/text-columns.ts`：`WIDE` 原样搬过去（与 `main` 上那一行逐字节比对过，相同），导出 `charColumns(char)` 与 `textColumns(text)`。`composer-quote.ts` 删掉私有的 `WIDE` 与 `columns`，`headWithin` 改用 `charColumns`，`wholeMessageQuote` 改用 `textColumns`，行为不变（`composer-quote.test.ts` 照旧全过）。

````diff
diff --git a/gui/src/lib/composer-quote.ts b/gui/src/lib/composer-quote.ts
index 4407b2e6..7cb49e72 100644
--- a/gui/src/lib/composer-quote.ts
+++ b/gui/src/lib/composer-quote.ts
@@ -1,4 +1,5 @@
 import { isSideQuestion } from "@/lib/side-question";
+import { charColumns, textColumns } from "@/lib/text-columns";

 /**
  * Quoting a conversation selection (telegram-details tickets 02, 07).
@@ -128,24 +129,13 @@ export function splitQuotedMessage(text: string): QuotedMessage {
 export const WHOLE_QUOTE_LINES = 3;
 export const WHOLE_QUOTE_COLUMNS = 240;

-/** A code point that takes two columns: CJK, Hangul, fullwidth forms,
- * emoji. */
-const WIDE =
-  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
-
-function columns(text: string): number {
-  let width = 0;
-  for (const char of text) width += WIDE.test(char) ? 2 : 1;
-  return width;
-}
-
 /** The longest head of `line` within `budget` columns, and whether that
  * is all of it. */
 function headWithin(line: string, budget: number): [string, boolean] {
   let width = 0;
   let head = "";
   for (const char of line) {
-    width += WIDE.test(char) ? 2 : 1;
+    width += charColumns(char);
     if (width > budget) return [head, false];
     head += char;
   }
@@ -271,7 +261,7 @@ export function wholeMessageQuote(text: string, markdown: boolean): string {
     }
     const [head, whole] = headWithin(lines[i], left);
     if (head !== "") out.push(head);
-    left -= columns(head);
+    left -= textColumns(head);
     if (!whole) {
       more = true;
       break;
diff --git a/gui/src/lib/text-columns.ts b/gui/src/lib/text-columns.ts
new file mode 100644
index 00000000..0853875d
--- /dev/null
+++ b/gui/src/lib/text-columns.ts
@@ -0,0 +1,25 @@
+/**
+ * How wide text sets, counted in columns the way a monospace grid counts
+ * it: a wide character (CJK, Hangul, fullwidth forms, emoji) takes two,
+ * anything else one. An estimate, not a measurement, for rules that have
+ * to decide from the text alone: how much of a whole message a quote
+ * takes (composer-quote.ts) and which table columns are short enough to
+ * keep on one line (table-short-columns.ts).
+ */
+
+/** A code point that takes two columns: CJK, Hangul, fullwidth forms,
+ * emoji. */
+const WIDE =
+  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
+
+/** One character's columns: 2 if it is wide, else 1. */
+export function charColumns(char: string): number {
+  return WIDE.test(char) ? 2 : 1;
+}
+
+/** A text's columns: its characters' added up. */
+export function textColumns(text: string): number {
+  let width = 0;
+  for (const char of text) width += charColumns(char);
+  return width;
+}
````

**4. 设计文档两处**

````diff
diff --git a/docs/design/conversation.md b/docs/design/conversation.md
index d5e0eedc..83f7741d 100644
--- a/docs/design/conversation.md
+++ b/docs/design/conversation.md
@@ -101,7 +101,7 @@
     - **工作台**里你的消息照旧只有一颗悬停复制（2026-10-16 起在气泡下方、右对齐），零变化；要不要也加引用，等这边真机看过再说。两边仍有意不统一（JC 2026-10-15；理由 2026-10-16 改说为密度差异，[工作台对话 PRD](../../.scratch/workbench-conversation/PRD.md) 裁决 1）：工作台常贴长文档、长提示词，超过 6 行就折叠，折叠后选中拿不到全文，悬停复制能整段复制。
   - **你引用的话**（2026-10-16，票 07；画法票 08 定稿，[PRD](../../.scratch/telegram-details/PRD.md) 裁决 3a 的切档裁决）：消息开头的 Markdown 引用（引用条发出的，`lib/composer-quote.ts` 的 `splitQuotedMessage` 只认开头连续的 `>` 行，几块之间可隔空行；正文中间的 `>` 照旧是文字；手打的以 `>` 开头的消息同样画成引用）从你的话里拆出来，画在**气泡里的顶部**（`MessageQuotes`，Telegram 的回复样式）：一段一块，`brand-strong` 10% 的底、左边 2px 45% 的竖线、`rounded-sm`，字号 `--conversation-echo-size`（标准 13px，正文 15px）、`ink-soft`、正常字重，每块最多三行，块间 4px，下面隔 6px 是你的话。被省略的引用点一下原地展开，再点收起（`role="button"`、`aria-expanded`，只在真被截断时才是按钮）。为什么在气泡里：引用就写在你这条消息的文字里，助理收到的、悬停复制的都是全文，气泡装的就是你发出的东西，像邮件回复里引用原文，块有自己的底与竖线，和你的话分得开；画在气泡外上方（试过的另一档）要为停靠开例外。所以带引用的消息停靠（提交贴顶、⌥↑ / ⌥↓、问题轨、定位）照旧停气泡的上缘，引用在气泡里一起露出来。代价：短回话被引用撑宽、气泡变高（所以最多三行）。引用不能选中（选它的原处）；长消息折叠（6 行或 500 字）只算你的话；工作台的悬停复制照旧复制原文全文（含 `>`）；只有引用的消息只画引用块。回复里的 Markdown 引用（3px brand 竖线 + 斜体，见下表）不变；这里有意不用斜体（中文的斜体是假斜体）、竖线也细一档，读作「摘的一句」而不是正文的一部分。
   - **它的在左**：回复、它问你的问题、问候都是同一种气泡，底色 `bg-assistant-tint`（浅 `#F0F0F0`、深 `#24272C`，[foundations](./foundations.md) 色表），离页面底 ΔL* 浅 −3.2、深 +8.0，离杏沙 ΔE 两种主题都约 12，两边靠色相分开，不只靠深浅。圆角 12px、内边距 10 / 14px，与你的同档。宽度上限栏宽的 `88%`：比你的宽，因为它的内容是 markdown、列表和表格；右边至少留 12%（760 栏是 91px），读得出在左边。不设像素上限（2026-10-15，裁决 79）：阅读宽度切到「宽松」就是要给代码块和表格更多地方，而它们都在回复气泡里，所以回复跟着栏变宽，1200 栏下到 1056；紧凑栏 760 的 88% 是 669，原来的 680 上限只在宽松下起作用，作用是把宽松抵掉，只剩两边拉开。你的气泡照旧停在 560。字体与排版照回复正文，markdown 的列表、标题、引用、加粗、链接照旧，只是装进气泡；选中文字后的浮动复制照旧。
-  - **气泡里的代码和表格**：在纸上比纸深一级的东西，进了气泡就比气泡再深一级。行内代码和代码块的底换成 `bg-line`（浅色比气泡深 ΔL* 3.1，深色亮 4.6，方向同页面上「行内代码比纸深一级」），代码块去掉 hairline，读作气泡里的一段，不是框里套框；放不下时照旧在块里横向滚动、可切换行。表格保留格线（那是它的结构），表头去掉比气泡亮的 `bg-surface`、坐在气泡底上，靠字重区分；表格本来满宽、单元格折行，所以宽表格把气泡撑到上限，真放不下时在气泡里横向滚动，不让气泡撑满栏宽。图片照 `MarkdownImage`，最宽是气泡的内宽、最高 420px。
+  - **气泡里的代码和表格**：在纸上比纸深一级的东西，进了气泡就比气泡再深一级。行内代码和代码块的底换成 `bg-line`（浅色比气泡深 ΔL* 3.1，深色亮 4.6，方向同页面上「行内代码比纸深一级」），代码块去掉 hairline，读作气泡里的一段，不是框里套框；放不下时照旧在块里横向滚动、可切换行。表格保留格线（那是它的结构），表头去掉比气泡亮的 `bg-surface`、坐在气泡底上，靠字重区分；表格本来满宽、单元格折行，所以宽表格把气泡撑到上限，真放不下时在气泡里横向滚动，不让气泡撑满栏宽；短列不折行（2026-10-23，裁决 136）：队名、名次这类每格不超过 8 个汉字的列一行写完，不再被长段落的列挤成一两个字一行，规则与上限见下「Markdown 渲染」表的 `table` 一行。图片照 `MarkdownImage`，最宽是气泡的内宽、最高 420px。
   - **气泡里的字比工作台收一档**（2026-10-16，[telegram-details PRD](../../.scratch/telegram-details/PRD.md) 裁决 8：票 10 真机比四档，票 11 定稿）：字号照字号档不变，行高与段距收一档（字号 / 行高 / 段距）：

     | | 小 | 标准 | 大 |
@@ -421,7 +421,7 @@ px 值是三档字号系统的 **standard 档**——所有阅读面尺寸都由
 | 块代码 ` ```python ` | 详见下方 Shiki 段 |
 | `blockquote` | 左 3px brand 竖线 + italic + ink-soft |
 | `a` | text-ink + ink-muted 1px 下划线，hover 才转 brand-strong + 安全 _blank（暖色预算让给行内代码，2026-08-12） |
-| `table` (GFM) | `overflow-x-auto` 容器 + border-collapse + th `bg-surface` + 单元格 padding 12px×8px；单元格 `overflow-wrap: break-word`，单元格里的行内代码与链接 `anywhere`（2026-10-16：整格 `anywhere` 会把列的最小宽度算成一个字，序号列被长地址列挤到「10」拆成上下两行） |
+| `table` (GFM) | `overflow-x-auto` 容器 + border-collapse + th `bg-surface` + 单元格 padding 12px×8px；单元格 `overflow-wrap: break-word`，单元格里的行内代码与链接 `anywhere`（2026-10-16：整格 `anywhere` 会把列的最小宽度算成一个字，序号列被长地址列挤到「10」拆成上下两行）；短列不折行（2026-10-23，[主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 136）：一列的每一格（含表头）按渲染后的文字算（不算 markdown 记号，全角算 2、其余算 1）都不超过 16，这一列的 `th`、`td` 加 `white-space: nowrap`；所有短列的最宽一格加起来超过 40（约 20 个汉字）就都不启用、整张表照旧，免得新增横向滚动；长列照旧折行（`lib/table-short-columns.ts` 的 remark 插件给短列的格子标 `data-short-col`）。为什么：表格自动布局大致按各列不折行时的长度分宽度，中文任意两字之间都能断行，短列最小只有一个字宽，队名列被长段落的列挤成一两个字一行；10-16 的 `break-word` 护的是数字与英文词，这是中文那一半 |
 | `hr` | 1px line + my-5 |
 | `strong` | font-medium（正文 normal 400，strong 500，一档可见加粗） |
 | `em` | italic |
````

**5. 验证**（最终提交状态上跑的，输出原样摘尾部，本机路径换成 `<worktree>`）

````text
$ pnpm --dir gui typecheck
> galley-desktop@0.7.0 typecheck <worktree>/gui
> tsc --noEmit

typecheck exit: 0

$ pnpm --dir gui lint
> galley-desktop@0.7.0 lint <worktree>/gui
> eslint src --max-warnings 0

lint exit: 0

$ CI=true pnpm --dir gui test
 Test Files  206 passed (206)
      Tests  2283 passed (2283)
   Start at  16:57:24
   Duration  52.81s (transform 11.99s, setup 5.00s, import 580.28s, tests 38.88s, environment 22.26s)

test exit: 0

$ git diff --check main..HEAD
diff-check exit: 0
````

另外：把插件从 `remarkPlugins` 里拿掉跑过一次，表格的三条渲染测试红；把插件里按分隔行截断去掉跑过一次，截断那条红；都已恢复。新文件 prettier 整篇格式化，旧文件逐个比过 prettier 输出，与现状无差异。设计文档新增的文字扫过半角标点，只剩 `table` 一行原有的 `(GFM)`。

**6. 看到但没改的、没验证到的**

- **快照与票 91 会冲突**：票 90 切换器的 `live-progress-variants.test.tsx`「现状」快照逐字节存着 MarkdownView 的 prose 类名，加了两个类之后「woken, writing」那条不过。单独一个提交 `bf613e4f` 更新了快照，word-diff 只多这两个类。票 91 要删整个 `live-progress-variants/` 目录，合入时这里是 modify/delete 冲突，保留删除即可（或先合 91，再丢掉 `bf613e4f`）。
- **格子数不齐的一种解释**：纯函数按位置算给它的所有格子；插件喂给它之前先按分隔行的列数截断，因为 GFM 只画分隔行那么多列，多出来的格子解析了但不画（`mdast-util-to-hast` 的 `tableRow`），不该影响上限（有测试：算进去会到 42、整张表不标）。缺的格子由 to-hast 补成空 `<td>`，不带标记。
- **取文字的细节**：连续空白压成一个空格、去首尾（与 HTML 显示一致）；行内 HTML 在 react-markdown 里原样显示成文字，也按文字算；图片不算宽度，所以只放图片的列会被当作短列（一格一张图不受影响，一格多张图会排成一行）。
- `table` 组件把 react-markdown 传进来的 `node` 也展开到了 `<table>` 上，静态渲染里能看到 `node="[object Object]"` 属性（本票之前就有），没动。
- 设计文档「Markdown 渲染」开头那句渲染栈（`react-markdown` + `remark-gfm` + `remark-cjk-friendly` + Shiki）没写新插件；票里说只改两处，没动。
- `WIDE` 的表情范围只到 U+1F300–1FAFF，✅（U+2705）这类算 1：原算法如此，照搬没改。
- **没验证到**：真实 WebKit 里的列宽与表高（没跑 `tauri dev`，按票留给 JC 在 dev 里看）。两个任意变体用 `tailwindcss` 的 `compile` 编过，生成 `& th[data-short-col] { white-space: nowrap; }` 与 `& td[data-short-col] { white-space: nowrap; }`；流式时某列先短后长那一次重排没在界面上看。

### 2026-10-23 主会话验收

- 逐处看过 diff（`table-short-columns.ts`、`text-columns.ts` 与 `composer-quote.ts` 的抽取、`MarkdownView` 的接线与类名、设计文档两处），与票面一致。
- 顺手修了代理报的原有问题：`table` 组件把 react-markdown 的 `node` 展开到 `<table>` 上（DOM 里多出 `node="[object Object]"`），改为解构掉 `node: _node`；没有快照依赖它。
- 门禁在最终状态上重跑：`pnpm --dir gui typecheck`、`pnpm --dir gui lint` exit 0；`CI=true pnpm --dir gui test` 206 文件 2283 测试全过；`git diff --check` 干净。
- 列宽与表高沿用裁决 136 的 WKWebView 实测（同语义：短列 `white-space: nowrap`）；真 App 里的样子留给 JC 在 dev 里看那张东部预测表。
