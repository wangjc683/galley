# 99 删掉的卡片划线；面板的两个页签换成 `SegmentedControl`

Status: done（2026-10-26 合入 `137302fd`–`c71ce992`；JC 真机 OK：分段页签、删掉的待办卡片与备忘卡片的划线在已有卡片上看过；「不再记」与提醒取消的划线没留下新记录，按代理的预览与测试）

来源：[主聊天 PRD](../PRD.md) 裁决 144（2026-10-26，JC 真机走过备忘三张票后；JC：「按你建议推进，不上切换器，直接做 T1」）。依赖票 97（已合入 main）。只改 GUI 与设计文档；`core/` 不动（需要的字段都已在 IPC 里，见下）。与票 98（Core、手册、评测）同时在跑，不碰同一处。

## 为什么

- JC 真机：删掉的备忘，回复下的卡片看起来没变化，只是不能点了；删掉的待办，卡片只在右边写「已删除」，不够直观。
- 划线读作「不要了」。办完是勾上加划线（JC 10-16：「完成的打了勾加上横线划去」），删掉是划线不勾：方框照旧是 40% 的禁用样子、右边照旧写「已删除」，两样东西把它和「办完」分开。推翻票 88 的「不划线（没做，只是不要了）」。
- 面板 header 的两个页签（票 97）只是两段字，JC：「不够像按钮，设计感也不足」。设计规范里本来就有「小型互斥选项组」的组件 `SegmentedControl`（`docs/design/foundations.md:542`，`gui/src/components/ui/segmented-control.tsx`），面板两页正是这种用途；md 档 28px 高，与右边「+」「×」同高，顺手修掉票 97 回报里「页签比 + 和 × 高一点」的错位。

## 要做的

1. **待办卡片**（`gui/src/components/conversation/TodoCards.tsx`，设计文档 `docs/design/conversation.md`「待办卡片」的「删除」一条，现在写着「不划线」）：被删的（你在面板里删的、Galley 替你删的，含删掉后 5 秒撤销条还在的那段）标题加删除线，颜色照旧 `ink-muted`；方框、「已删除」照旧。勾掉的不变。删除线的粗细与颜色照勾掉那种的写法（同一套 `line-through` 与 decoration 颜色），两种划线看起来一样，靠方框与小字分。
2. **备忘卡片**（`gui/src/components/conversation/MemoCards.tsx`，设计文档「备忘卡片」）：只划正文，「记下了 ·」「改为 ·」「不再记 ·」前缀不划。
   - **备忘不在了**（`MemoEventItem.memoExists` 为 false：你删的或它删的；你在面板里删、撤销条还在的那 5 秒也算）：正文划线、退到 `ink-muted`，右边 12px `ink-muted`「已删除」（同待办卡片右边那一格的位置与样式）。
   - **「不再记」那张**：正文划线、`ink-muted`，右边不加字（前缀已经说了）。
   - **过了期限**（`memoExists` 为 true，但不在 `list_memos` 给的当天还有效的备忘里，即票 95 说的过期后行留着、不显示）：正文 `ink-muted`、不划，右边「已过期」。
   - 还在的照旧，正文是按钮、能打开面板。以上三种都不是按钮（现在已经是）。
3. **提醒卡片**（`gui/src/components/conversation/ReminderCards.tsx`，设计文档「提醒卡片」）：已取消的，时间与那句话加删除线（颜色照旧 `ink-muted`），「已取消」照旧；已提醒、已暂停、待提醒不变。
4. **面板页签换成 `SegmentedControl`**（`gui/src/components/todo/TodoPanel.tsx` 里票 97 的 `PanelTabs`，header 外壳 `ReadingPanelHeader`）：
   - 用 md 档，两项「待办」「备忘」；样子照组件全局的写法（轨道 `bg-hover`、选中的 `bg-elevated` 浮起加 `brand-strong` medium，`docs/design/layout-and-chrome.md:98`），不为面板另做变体。
   - 与右边「+」「×」垂直居中对齐；量一下 header 里三者的上下边，回报里写对齐前后。
   - 保留票 97 的行为：`role="tablist"` 与左右方向键（若 `SegmentedControl` 已有键盘行为与无障碍角色，用它的，回报说明有无差别）、面板无障碍名照旧「待办」、开在哪一页的规则、换页时列表回到顶上。
   - `PanelTabs` 若只剩这一处用，删掉；`SegmentedControl` 本身的样式不改（它在设置页、「显示」浮层里也用）。若 md 档在 header 里放不下（面板最窄 280px，减去「+」「×」），回报里写清楚量到的宽度，用 sm 档并说明。
5. **设计文档**：`docs/design/conversation.md`「待办卡片」的删除一条（改掉「不划线」，写新规则与理由，链裁决 144）、「备忘卡片」、「提醒卡片」的已取消、「待办面板」的「两个页签」一条（改成 `SegmentedControl`，写没选的 T2、T3、T4 与理由，推翻票 97 的「放在 header 里太重」）。
6. **测试**：vitest 覆盖待办卡片被删时标题带划线、勾掉的不受影响；备忘卡片四种（还在、不在了、「不再记」、过期）的划线、颜色、右边小字、能不能点；提醒卡片已取消带划线、已提醒不带；页签换成 `SegmentedControl` 后点击与方向键切页、从备忘卡片打开时在「备忘」。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`、不开 Vite 页面验 Tauri 相关的流程。
- `core/`、`cli/`、手册、评测（票 98 在改）；`SegmentedControl` 组件本身；面板「待办」页与「备忘」页的行、分组、动作；卡片的位置与次序。
- `gui/` 不是 prettier-clean：旧文件只格式化自己改的 hunk，别对整个文件跑 `prettier --write`。React 编译器的 lint 规则：effect 里同步 setState、渲染期读 `Date.now()` 都是 error；工具函数别从组件文件导出。静态渲染测试读不到 store 里塞的值，照现有测试的 mock 写法。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。新增行不能有本机路径、会话 id、真实数据。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`。
- `git diff --check`；新增中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 四种卡片状态各一段 className 的 diff 原样。
3. 页签：用的档位、对齐前后的量法与数值、键盘与无障碍跟原来的差别。
4. 设计文档改了哪几节。
5. 验证命令与结果原样。
6. 看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

1. 打开待办面板：顶上是两段的分段控件，与「+」「×」齐平；点和左右方向键都能切。
2. 让它记一件待办再在面板里删掉：回复下那张卡片的标题划线，右边「已删除」。
3. 在备忘页删一条：回复下「记下了 · ……」那张的正文划线，右边「已删除」；让它删一条（「别记我不喝酒了」），「不再记 · ……」那张正文划线。
4. 取消一个它自己的提醒：提醒卡片的时间与那句话划线，右边「已取消」。

## Comments

### 2026-10-26 实现报告（代理，分支 `ticket-99-struck-cards`）

**1. 提交**（`git log --oneline main..HEAD`，本条报告另起一个提交）：

- `2b0888b2 main-chat ticket 99: strike what is gone on the cards, SegmentedControl for the panel's pages`

**2. 四种卡片状态的 className diff**（原样，注释行略）

待办卡片被删（`gui/src/components/todo/todo-styles.ts`；卡片的标题按钮与字两条路径都用它，`TodoCards.tsx` 只改了注释）：

```diff
     "transition-colors duration-(--motion-base) motion-reduce:transition-none",
-    cancelled
-      ? "text-ink-muted"
-      : checked
-        ? "text-ink-muted line-through"
-        : "text-ink",
+    checked || cancelled ? "text-ink-muted line-through" : "text-ink",
```

备忘卡片（`gui/src/components/conversation/MemoCards.tsx`；状态由新函数 `lib/memo.ts` 的 `memoCardState` 给：`listed` / `deleted` / `dropped` / `expired`，取代 `memoCardOpens`）：

```diff
-  const opens = useMemoStore((s) => memoCardOpens(event, s.memos, s.deleting));
+  const state = useMemoStore((s) => memoCardState(event, s.memos, s.deleting));
+  const struck = state === "deleted" || state === "dropped";
+  const side =
+    state === "deleted"
+      ? copy.todo.stateDeleted
+      : state === "expired"
+        ? copy.memo.stateExpired
+        : null;
   const line = (
     <>
       <span className="text-ink-muted">{prefix} · </span>
-      {text}
+      <span className={struck ? "line-through" : undefined}>{text}</span>
     </>
   );
…
+      data-memo-state={state}
…
-        {opens ? (
+        {state === "listed" ? (
…
-            className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink"
+            className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-muted"
…
+        {side && (
+          <span
+            data-role="memo-card-state"
+            className="shrink-0 select-none text-[12px] tabular-nums text-ink-muted"
+          >
+            {side}
+          </span>
+        )}
```

即：还在的照旧（正文 `ink`、按钮）；不在了的正文划线、整行 `ink-muted`、右边「已删除」；「不再记」正文划线、`ink-muted`、右边无字；过期的 `ink-muted`、不划、右边「已过期」。前缀那一段从来不划。右边那一格的 className 与待办卡片的 `todo-meta` 一格逐字相同。

提醒卡片已取消（`gui/src/components/conversation/ReminderCards.tsx`）：

```diff
   const settled = state === "fired" || state === "cancelled";
+  const struck = state === "cancelled";
…
             settled ? "text-ink-muted" : "text-ink-soft",
+            struck && "line-through",
           )}
…
             settled ? "text-ink-muted" : "text-ink",
+            struck && "line-through",
           )}
```

「已取消」三个字那一格不变、不划。

新增文案只有一条：`memo.stateExpired`「已过期」/「Expired」。「已删除」沿用 `todo.stateDeleted`（一件事一个词）。

**3. 页签**

- **档位**：md（`size="md"`）。宽度够：最窄 280px 的面板标题栏 182px，中文两段共 96px，英文（To-do / Memos）125.4px，没用到 sm。
- **量法**：worktree 里临时起一个 Vite 静态页（假数据、真 CSS、真 `TodoPanel` 与真 store，不走 Tauri），并排放票 97 的旧 header（从 main 抄的 `PanelTabs`）与新面板（320px、280px、280px 英文），headless Chrome 跑完后用 `getBoundingClientRect` 量 header、页签／分段、「+」「×」相对 header 顶边的上下沿，再截浅色、深色两张图看样子。量完删掉，没提交。
- **数值**（相对 header 顶边，px）：

  | | header 高 | 页签／轨道 | 每段 | 「+」「×」 | 中线 |
  |---|---|---|---|---|---|
  | 票 97（前） | 53 | 12–32（字，20 高） | 同左 | 12–40 | 页签 22，按钮 26，差 4 |
  | 票 99（后） | 59 | 轨道 12–46（34 高） | 15–43（28 高） | 15–43 | 都是 29 |

- **和票面不一样的一处**：票面与裁决说「md 档 28px 高，与右边「+」「×」同高」。28px 是每一段（`h-7`），整个控件还有 `p-0.5` 内边距与 1px 边框，共 34px。所以做法是让「+」「×」在 header 里竖直居中（两颗 `IconButton` 加 `self-center`），结果是选中那一段的上下沿与两颗按钮正好齐平（都是 15–43），代价是 header 从 53px 高到 59px。控件本身加 `self-start`，只贴着两段，不然它在标题那一栏（`flex-col`）里会被撑满整栏宽。没选：给控件加负的上下外边距把 header 留在 53px（等于为面板改控件的摆法）；sm 档（轨道 30px、每段 24px，与 28px 的按钮对不齐）。
- **键盘与无障碍**，和票 97 的差别：
  - 角色用 `SegmentedControl` 自己的：`role="radiogroup"`（无障碍名照旧「待办与备忘」），每段 `role="radio"` + `aria-checked`；原来是 `tablist` / `tab` + `aria-selected`。
  - 组件本身没有方向键。面板在控件外层用 `onKeyDown` 补回票 97 的左右方向键：切页并把焦点带到另一段（走组件已有的 `...rest` 透传，组件文件没动；设置页等别处的 `SegmentedControl` 照旧没有方向键）。
  - Tab 现在两段都停（组件没有 roving tabindex）；票 97 只停选中的那一页。
  - 组件的按钮不带 `id`，列表没法再用 `aria-labelledby` 指回页签，所以去掉了列表的 `role="tabpanel"`，改由控件 `aria-controls` 指着列表。
  - 面板无障碍名照旧「待办」；开在哪一页的规则（每次打开是待办、备忘卡片打开是备忘、⌘K 翻回待办、关了再开回到待办）与换页回到顶上（列表按页 `key` 重挂）都没动，测试照旧过。
- `PanelTabs` 只此一处用，删了；`ReadingPanelHeader` 只改了注释。

**4. 设计文档**（`docs/design/conversation.md`）

- 「提醒卡片」：「形态」一条补已取消的时间与那句话划线、「已取消」不划；「取消」一条补划线。
- 「待办卡片」：「三种样子」的「删除」改成标题删除线（同 `todoTitleClass`），下面新增「为什么划线」（推翻票 88 的「不划线」，链裁决 144 第 1 条），并写明下面第 6 节那一档 60% 的差别。
- 「备忘卡片」：新增「不在了的划线」（四种状态、只划正文、`memoCardState`、理由）；「点字」改指 `memoCardState` 为 `listed`。
- 「待办面板」：「顶部」补票 99 起是 `SegmentedControl`；「两个页签」的「样子」改写（T1、md、量法与数值），新增「键盘与无障碍」与「由来」（票 97 原来的做法、推翻「放在 header 里太重」、代价、没选 T2、T3、T4）。

**5. 验证**（都在 worktree 里跑过，看到输出）

- `pnpm --dir gui typecheck`：通过（`tsc --noEmit` 无输出）。
- `pnpm --dir gui lint`：通过（`eslint src --max-warnings 0` 无输出）。
- `pnpm --dir gui test`：`Test Files  215 passed (215)`，`Tests  2394 passed (2394)`。
- 改过的七个测试文件再用 `TZ=UTC`、`TZ=America/Los_Angeles` 各跑一遍：两遍都是 `Test Files  7 passed (7)`、`Tests  118 passed (118)`。
- `git diff --check`：干净。`node scripts/check-docs-links.mjs`：`docs link gate OK: 479 files checked.`
- prettier：改前干净的文件改后 `prettier --check` 全过；`zh.ts`、`en.ts` 改前就不干净，没整篇跑，prettier 差异块数改前改后相同（4、13）。
- 全角标点：scratchpad 里的脚本扫新增行，中文语境零处；命中的都是英文注释、测试名里引用的中文词，与 Markdown 链接的右括号。
- 新增行查过本机路径、会话 id、密钥格式：没有。

新测试：`MemoPage.test.tsx` 加一组「strike what is gone, the words only」（还在、不在了、页上刚删撤销条还在、「不再记」、过期：划线只在正文、颜色、右边小字、能不能点、英文）；`lib/memo.test.ts` 的 `memoCardOpens` 一条换成 `memoCardState` 各状态；`TodoPanel.test.tsx` 被删的卡片改为带划线、与勾掉的同一个 class、没做的不带；`ReminderCards.test.tsx` 加已取消划时间与那句话、「已取消」不划，已提醒、已暂停、待提醒不划；`TodoPanel.memo.test.tsx` 页签改用分段：radiogroup、md、选中的 `brand-strong`、`self-start`、「+」「×」`self-center`、`aria-controls`，点击与左右方向键切页、焦点跟过去、别的键不动，换页是新的列表，从备忘卡片打开在「备忘」（原有用例照旧过）。

**6. 看到但没改的、没验证到的**

看到但没改：

- **两种划线差一档**：做完 7 天内、面板里还有这一件的待办卡片，标题是按钮，按钮为悬停下划线设的 `decoration-ink-muted/60` 也作用在删除线上，划线是 60% 的 `ink-muted`（computed `oklab(… / 0.6)`）；被删的卡片标题不是按钮，划线是满的 `ink-muted`（`rgb(135, 130, 122)`），同做完超过 7 天的卡片。截图里做完的那条划线明显更淡。票面同时要「两种划线看起来一样」和「勾掉的不变」，我守了后一条，没动。要拉齐只需一处：把卡片标题按钮的 `decoration-ink-muted/60` 改成 `hover:decoration-ink-muted/60`（划线都变满色；面板 `TodoPanel.tsx:553`、`MemoPage.tsx:137` 同样的写法要不要一起改另说），或者反过来给被删的字也加 60%（更淡，与「不够直观」相反）。
- **悬停做完的标题时划线换成下划线**：按 CSS 推的（`hover:underline` 覆盖 `line-through`，都是 `text-decoration-line`），面板与卡片的标题按钮原来就这样，没在浏览器里悬停看。
- **深色下选中那一段与轨道明度差小**，主要靠杏色字认出选中的；这是 `SegmentedControl` 全局的配色（只在面板的预览截图里看到，别处没截），没改。
- 过期的判定按票面用「`memoExists` 为真但不在 `list_memos` 里」，不看卡片自己的 `until`（那是那一次改动时的期限，后来可能改过）。将来 `list_memos` 若因别的原因不列某条，卡片也会写「已过期」。
- 票 97 回报里「`memoExists` 没用上」这条，这张票用上了。

没验证到的：

- 没跑 `tauri dev`（按要求）：真 Core 的 `memos:changed`、删备忘与取消提醒后卡片跟着变，只在 mock 与静态预览里看过；票面「给 JC 的真机步骤」都等 JC。
- 布局只在一次性静态预览里看过（浅色、深色各一张，2x），没进真窗口；窄窗口覆盖态、Windows 低 DPR 下的划线粗细、读屏软件、截断时省略号的颜色都没看。
- 没跑 CI。

### 2026-10-26 补记：两种划线拉齐（代理，同分支）

主会话按上面第 6 节第一条要拉齐（JC 读「做完」是「打了勾加上横线划去」，淡的那条是错的一方）。

- **提交**：`5143684b main-chat ticket 99: one full-colour strike for done and deleted`。
- **改法**：标题按钮的 `decoration-ink-muted/60` 改成 `hover:decoration-ink-muted/60`，悬停下划线照旧 60%，平时删除线跟字的颜色走。改了四处：待办卡片标题（`TodoCards.tsx`）、面板待办页标题（`TodoPanel.tsx` 的 `RowShell`）、备忘页正文（`MemoPage.tsx`），以及主会话没点名的备忘卡片正文按钮（`MemoCards.tsx`）。最后这处从来不划线，改它只为四颗标题按钮写法一致，行为不变。面板里自启提示那颗常驻下划线的按钮（`TodoPanel.tsx` 的 `underline decoration-ink-muted/60`）不是标题、不划线，没动。
- **预览**（一次性静态页重搭，量完删掉，没提交）：面板「已完成」里的「交房租」、卡片上做完的「交房租」、删掉的「买营养土」、已取消提醒的时间与那句话、备忘的「不在了」与「不再记」，computed `text-decoration-color` 都是 `rgb(135, 130, 122)`，与字同色（改前做完的两处是 `oklab(… / 0.6)`）。截图里做完那条现在和删掉那条一样清楚。悬停的样子没看（headless 不悬停）。
- **测试**：`TodoPanel.test.tsx` 新增一条，钉住卡片上做完的标题按钮、删掉的标题、面板已完成的标题按钮都带 `line-through` 与 `text-ink-muted`、自己不带任何 `decoration-*`，两颗按钮带 `hover:underline` 与 `hover:decoration-ink-muted/60`；临时把卡片按钮改回旧写法，这条会挂（`expected [ 'decoration-ink-muted/60' ] to deeply equal []`）。原有一条按钮 class 的正则跟着改了。
- **设计文档**（`docs/design/conversation.md`）：「待办卡片」的「做完」注明满色、与「删除」同一条线（裁决 144 第 1 条）；「为什么划线」里原来写的「还差一档没拉齐」改成现在的写法与由来；「勾掉的样子」补删除线满色、按钮的 60% 只在悬停时给。
- **验证**：`pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过、无输出；`pnpm --dir gui test`：`Test Files  215 passed (215)`，`Tests  2395 passed (2395)`；`git diff --check` 干净；`docs link gate OK: 479 files checked.`；改过的文件 `prettier --check` 全过；新增中文全角，没有本机路径。
- **一处连带变化**：面板里勾下去停留的 1.5 秒（标题是按钮）划线也从 60% 变成满色，同已完成。
