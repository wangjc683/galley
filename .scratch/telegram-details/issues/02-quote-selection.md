# 02 选中文字可以「引用」进输入框

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 3（2026-10-16，JC：「3，做」）。只改 GUI，不碰 Rust。助手对话与工作台都上。
与票 01、03 同一个子代理按序做，接在 01 后面。

## 目标

在对话里选中一段文字，浮出的工具条除了「复制」，再给一个「引用」：把所选以 Markdown 引用（`> `）放进输入框并聚焦，你接着打「这一句什么意思」就能发。

## 依据

- Telegram：选中正文后右键，「回复」变成「引用并回复」（Web A `src/components/middle/message/ContextMenuContainer.tsx:432-453`）。
- 对 AI 的追问里，「这一句什么意思」「这段改一下」是最常见的一类。发出去就是普通文字，外置与内置运行时一样，Agent API 不受影响。
- 设计文档与 deferred 里搜过「引用并」「quote selection」，没有否决。

## 要做

- `SelectionCopyToolbar.tsx`：今天是一颗 28px 的复制按钮，贴在栏的左右侧沟里（`side: left / right / viewport-left`）。加第二颗「引用」（图标用 Phosphor 的引号类，tooltip 与 aria-label：中文「引用」、英文「Quote」）。两颗怎么排（竖排适合侧沟）你定，位置计算跟着改，别越出视口；截图写进 Comments。
- 工具条今天出现的范围不变：工作台只在选中回复时出现，主对话选中回复或你的气泡都出现（`lib/selection-copy.ts` 的 scope）。
- 点「引用」：
  - 所选文字每一行前加 `> `（空行也加 `>`，保持一个引用块），后面跟一个空行，光标停在空行之后。
  - 输入框为空就直接填；已有文字就接在末尾，与已有文字之间空一行。光标位置在选中对话文字时已经丢了，不去猜。
  - 聚焦输入框，清掉对话里的选区，工具条收起。
  - 走已有的「填入输入框」路子（ask_user 候选的 ⌘ / Ctrl 点击就是填入输入框：`AskUserBubble.tsx` 的 `onFillCandidate`，往上找它接到哪），别另起一套。填进去的文字照旧进草稿（票 01）。
  - 在跑时也能引用（Enter 照旧是排队）。
- 选区跨了两条消息、或一部分在消息外：照今天复制按钮的处理（它取什么，引用就取什么）。

## 不做

- 不放开右键菜单（`useGlobalShortcuts.ts:53` 的全局拦截照旧）；不做 Telegram 那种挂在输入框上方的「正在回复」条，引用就是输入框里的文字。
- 不改粘贴折叠（超过 10 行折成占位块的只在粘贴时发生，引用填入的是普通文字）。

## 验收

- 单测：引用文本的生成（单行、多行、含空行、输入框已有文字时的拼接）。
- 文档：`docs/design/conversation.md` 里讲选中复制工具条的一节（grep「SelectionCopyToolbar」「选中」）改写，写清两颗按钮与引用规则。
- 真机（JC）：主对话与工作台各选一段回复点「引用」，输入框里是引用块 + 空行，光标在后面，直接打字能发。

## Comments

### 2026-10-16 实现（子代理，分支 `td-composer`）

**做了什么**

- `gui/src/lib/composer-quote.ts`（新）：`markdownQuote`（每行 `> `，空行 `>`，连续空行并成一个，两头不留空行，行尾空格去掉、行首缩进保留，`\r\n` 当一个换行）与 `textWithQuote`（空输入框：引用 + `\n\n`；已有文字：去掉末尾空白后 `\n\n` + 引用 + `\n\n`；选区没有字：原样返回）。
- `ComposerHandle` 加 `quote(selected)`（`composer-props.ts`、`Composer.tsx`）：与 `prefillText` 同走 `applyComposerText`，新增一个 `keepPlaceholders` 选项：接在后面时不清粘贴折叠与文件引用的登记（不然输入框里已有的 `[Pasted text #1 …]` 发出去就成了字面量），也不清图片。聚焦与光标放到末尾照旧在下一帧做。
- `SelectionCopyToolbar.tsx`：加 `onQuote` 属性，有它才画第二颗；点了调 `onQuote(选中文字)`、`removeAllRanges()`、收起工具条。文字就是复制拿到的那一段（`selection.toString().trim()`），选区跨消息或出了消息照旧不出工具条，所以引用也不出。
- `MainView.tsx`：`onQuote={(text) => composerRef.current?.quote(text)}`。工作台与主对话是同一个 `MainView`，两边都上；出现范围（`lib/selection-copy.ts`）没动。
- 文案：zh「引用」、en「Quote」（`conversation.quoteSelection`），tooltip 与 aria-label 同一个。
- 文档：`docs/design/conversation.md`「复制入口统一」里选中那条改写，写清两颗按钮、排法、引用规则、走哪个口子、不做什么。

**取舍（票里「你定」的）**

- 两颗怎么排：**竖排，复制在上、引用在下，间距 4px（`gap-1`），整列 60px**。侧沟只有一颗按钮宽，横排会伸出侧沟、压到正文或越出窗口；复制留在原来的位置（中线对着选区最后一行），手感不变，引用挂在它下面。左右侧沟、`viewport-left` 的选法与 10px / 12px 间距都没动；纵向夹紧改按整列 60px 算，贴窗口底时整列往上收，不越出视口。图标 Phosphor `Quotes`，thin 14px，同复制。
- 引用块与已有文字的拼法照票：已有文字末尾的空行先收掉再空一行，避免空三四行；连着引用两处就是两个引用块，中间一个空行。
- 连续空行并成一个 `>`：选中跨段时 `toString()` 在段间常给两个换行，逐行照搬会出现 `>`、`>` 两行，读着像排版坏了。

**量到的数值（Chrome 无头，临时 harness：真 `MarkdownView` + `SelectionCopyToolbar` + 一行式 `Composer`，1000 × 560）**

- 栏右缘 880 → 两颗都在 x = 890（离栏 10px），复制 y = 22.5、引用 y = 54.5，各 28 × 28，间距 4px。
- 输入框里先有「先说一句」，选「要追问的话」点引用：值 `先说一句\n\n> 要追问的话\n\n`，光标 15 = 全长，焦点在输入框，对话里选区清空，工具条收起。
- 再选「第二段：」到「列表二项」点引用：`…\n\n> 第二段：\n>\n> 列表一项\n> 列表二项\n\n`，接着打「这两处什么意思」落在最后一行。
- 截图两张（两颗竖排、悬停引用的 tooltip；两次引用后接着打字）在实现会话的 scratchpad 里，路径交给了主会话，不进仓库（本机路径）。harness 没进提交。

**测试**

- `lib/composer-quote.test.ts` 8 条：单行、多行、含连续空行、两头空行与行尾空格、缩进与 CRLF、空输入框（含只有空白）、已有文字（含末尾多个空行）、连着引用两处、选区没有字。
- `ComposerHandle.quote` 本身没有单测：node 环境下的静态渲染不跑 `useImperativeHandle`，用上面的 harness 在 Chrome 里走通了。
- `pnpm --dir gui typecheck`、`lint` 通过；`components/conversation`、`components/screens` 与本票测试 33 个文件 307 条通过。

**JC 真机验收**

1. 主对话：选一段回复点「引用」→ 输入框里是引用块 + 空行，光标在下面那行，直接打字能发；再选你自己气泡里的一句也有「引用」。
2. 工作台：选一段回复点「引用」，同上；你的消息上选中不出工具条（照旧）。
3. 输入框里已有半句时引用：接在后面、中间空一行，原来的字、粘贴折叠的占位块、图片都还在。
4. 在跑时引用，按 Enter 是排队。
5. 看一眼两颗竖排在侧沟里的样子，窄窗口（侧沟不够时退到窗口左边）与选区贴窗口底时整列不越界。
