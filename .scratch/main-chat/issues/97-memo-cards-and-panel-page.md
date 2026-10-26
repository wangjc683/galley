# 97 备忘的卡片与面板页：回复下的备忘卡片、面板 header 两个页签、「备忘」页

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 140、142 第 5 条（2026-10-26，主对话的备忘；面板 JC：「3，甲」，文字稿 JC：「4，暂无」；最后 JC：「按你建议推进」）；devlog [主对话的备忘](../../../docs/devlog/2026-10-26-main-chat-memo.md)。依赖票 [95](./95-memo-core-and-cli.md)（IPC 命令、`gui/src/types/ipc.ts` 的类型、`memos:changed` 事件）。与票 96（手册与评测）同时在跑，不碰同一处。不上切换器：JC 定了先写文字稿，本票照文字稿直接做。

## 为什么

备忘是 Galley 替你记下的、关于你的事（裁决 140）。它当轮记，你要当面看得到（回复下的卡片），也要能回头看它一共记了什么、删掉不要的（面板里的「备忘」页）。待办记动作，备忘记信息，形态要分开：同一个面板、两个页签，不加新容器（裁决 142 第 5 条甲；没选乙「清单最下面一组」、丙「顶栏再加一颗按钮」）。

## 要做的

现有的待办面板是 `gui/src/components/todo/TodoPanel.tsx`，设计文档 `docs/design/conversation.md`「待办面板」（`:386` 起）与「待办卡片」（`:370` 起）；回复下的卡片照 `gui/src/components/conversation/TodoCards.tsx` 与 `ReminderCards.tsx`。先读这两节设计文档，再动手。

1. **面板 header 两个页签**：标题「待办」换成「待办」「备忘」两个页签，「+」（跟 Galley 说）与 × 不动、两页都在。页签的样子用现有的分段 / 页签组件（找仓库里已有的，没有就照 header 里文字按钮的现有样式做，回报里说用的哪个）；选中的一页满墨色，另一页 `ink-muted`。
   - 打开面板默认是「待办」；从回复下的备忘卡片打开时是「备忘」。面板开着时切过去的页签，关了再开回到「待办」（不进 localStorage，不进 Core）。
   - 顶栏按钮的数字照旧只数待办；⌘K 的「待办」照旧打开「待办」页。
   - 面板在哪条对话旁边都能开（裁决 95），两页都一样。
2. **「备忘」页**（文字稿，内容是示意）：

   ```
     待办   备忘                       +   ×
     ────────────────────────────────────────
     今天
       你不吃香菜
       这周在上海出差                 到 11-01
       看你这周常问 76 人、雷霆的比赛
     10-23
       回复里的中文标点用全角
     10-20
       叫你小林；做室内设计
   ```

   - 按最后一次记或改的本地日子分组，新的在上；组名照面板现有的组名样式（11px semibold `ink-muted`，组间距照 `TodoPanelGroups` 的规则）。组名的日子写法照面板与时间条现有的日期规则（今天、昨天，再早写日子；找现成的格式化函数，回报里说用的哪个）。组里按最后改动的时刻、新的在上。
   - 每行一句，13px，不截断、自然折行。有期限的在行的右边写「到 11-01」，12px `ink-muted`，照待办行写时间的样式；正文折行时期限留在第一行右边（正文 flex 伸缩、期限不缩）。没有图标、方框、标签。
   - 点正文回到当初那句话：跳到主对话里最近一次记或改它的那一轮（IPC 给的出处），照待办「点文字跳回它当初记下的那句」的做法；没有出处的（比如 CLI 在别处记的）正文是字，不是按钮。
   - 「⋯」与右键一份菜单，只有「删除」：照待办的删除（`TodoRowMenu`、票 88 的 5 秒撤销条），不确认，5 秒后才交给 Core，撤销条在的时候这一行先藏起来、撤销放回。不能改。
   - 空状态一句加一个例子：「值得记住的事，它会记在这里。比如：「我不吃香菜」。」（英文版你按 copy 规则写，回报原样给出）。空状态里不放按钮（header 里有「+」）。
   - 听 `memos:changed` 刷新。它动过的行不另外亮（不做待办那套「它动过的行亮一下」），只有从卡片打开时那一行亮一下（第 3 条）。
3. **回复下的备忘卡片**：
   - 外形照待办卡片（hairline `border-line`、`rounded-md`、`bg-app`，一行，至少 40px），左边一颗 16px 的图标（从现有图标库里挑一颗记事一类的，先查 `docs/design/` 有没有禁用或撞脸的规定，挑完截图看同屏有没有撞脸，回报里说挑了哪颗、为什么）。
   - 文字：「记下了 · 你不吃香菜」；改了一条写「改为 · ……」；它删掉一条写「不再记 · ……」。一条备忘的一次改动一张卡（票 95 的 `memo_events`），正文是那次改动时的正文。被截断时悬停给全文。
   - 位置：跟在同一条回复的待办卡片后面（要你动手的在前），间距照待办卡片跟在子任务卡片后面的 8px；没有待办卡片时离气泡 12px（照现有规则）。
   - 点字：这条备忘还在时，打开面板到「备忘」页（面板不在屏上就打开，宽窗口记 Galley 一处为开，窄窗口临时开，照待办卡片标题的规则，`lib/todo-open.ts`），那一行亮一下（同待办卡片标题的亮法），不在视野里先滚过去。这条备忘已经删了，或那张卡是「不再记」，字不是按钮。
   - 卡片上不放删除、不放撤销。
   - 只在主对话里画；叫醒那一轮的不出声回复照旧什么都不画（设计文档「不出声的回复」）。
4. **文案**：中英两套（`gui/src/i18n/locales/`），照 `docs/copy-language-guidelines.md`；新增的中文用全角标点。页签名「待办」「备忘」；卡片三种前缀；期限「到 {日子}」；删除菜单与撤销条照待办现有的写法。重置主对话的确认文案若列了会清掉什么，补上「备忘」（票 95 的回报会说有没有）。
5. **设计文档**：`docs/design/conversation.md`「待办面板」一节加页签与「备忘」页的规则（写清没选的乙、丙与理由，链裁决 142），「待办卡片」后面加「备忘卡片」一节；`docs/design/overlays-and-settings.md` 里讲待办面板与 ⌘K 的那几处，有要补的补（⌘K 不加新项）。
6. **测试**：vitest 覆盖分组与排序、期限的显示、点正文的跳转目标与没有出处时不是按钮、删除与撤销、空状态、页签默认与从卡片打开时在「备忘」、卡片三种文字与能不能点、卡片排在待办卡片后面。静态渲染测试读不到 store 里塞的值（renderToStaticMarkup 下 zustand 读初始状态），照现有面板测试的 mock 写法。

## 票 95 合入后补（主会话）

- 票 95 已合入 main（`64d1489e`、`4d78db86`）。IPC 命令名与字段在票 95 的 Comments「实现报告」第 6 条。
- 票 95 把备忘的 Tauri 类型放进了 `gui/src/types/ipc.ts`（单独一节、没有 `kind` 字段，漂移检查不管它）；待办的 Tauri 类型其实在 `gui/src/lib/assistant-todo.ts`。照待办的放法挪到 `gui/src/lib/` 下（如 `memo.ts`）更一致，你定，挪了就删掉 `ipc.ts` 里那一节。
- 重置主对话的确认里「会删除」的清单（`resetMainChat.deletes`）没有备忘，补一行，如「备忘里它记下的关于你的事」（中英两套）。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `core/`、`cli/`、手册、评测（票 95、96）；IPC 有缺的写进回报，不在本票改 Core。
- 待办页的分组、行、动作、开与关的规则（裁决 128–133 定的）；顶栏按钮；文件预览与面板互换的规则。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化自己改的 hunk，别对整个文件跑 `prettier --write`。React 编译器的 lint 规则：effect 里同步 setState、渲染期读 `Date.now()` 都是 error；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`（或仓库里跑 vitest 的那条命令）。
- `git diff --check`；新增中文全角标点。
- 不跑 `tauri dev`、不开 Vite 页面验 Tauri 相关的流程；真机由 JC 走。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 页签用的组件、图标挑的哪颗与理由、日期格式化用的哪个函数。
3. 新增文案中英原样。
4. 设计文档改了哪几节。
5. 验证命令与结果原样。
6. 看到但没改的问题（尤其 IPC 缺什么），没验证到的地方。

## 给 JC 的真机步骤（票 95、96、97 都合入后）

1. dev 重启 Core 后，主对话里说一句关于你的事，比如「我不吃香菜」：回复下有一张「记下了 · ……」卡片，点它打开面板的「备忘」页，那一行亮一下。
2. 再说一句会过期的，比如「这周我在上海出差」：备忘页里那一行右边写「到」某天。
3. 说一句要办的事加一句信息，比如「下周三去上海出差，周二提醒我订酒店」：回复下先是待办卡片、再是备忘卡片，各写各的那一半。
4. 在备忘页里删一条：5 秒内能撤销；过了 5 秒再说「你还记得我……吗」，它不再提。
5. 第二天早上巡看过后：前一天记的备忘若有能推进的，它可能来说一句；多数时候不出声。主会话查库与 dev 日志看它醒没醒、为什么。

## Comments

### 2026-10-26 实现报告（代理，分支 `ticket-97-memo-gui`）

**1. 提交**（`git log --oneline main..HEAD`，本条报告另起一个提交）：

- `5214b98e main-chat ticket 97: memo cards, the panel's two tabs, the 备忘 page`

**2. 页签、图标、日期函数**

- **页签**：仓库里没有现成的页签组件。`SegmentedControl`（`gui/src/components/ui/segmented-control.tsx`）是带轨道、浮起滑块、选中写 `brand-strong` 的设置控件，和票面「选中满墨色、另一页 `ink-muted`」对不上，放进 header 也太重。所以照 header 原来的标题字做：`TodoPanel.tsx` 里的 `PanelTabs`，14px medium（`text-sm font-medium`，同 `ReadingPanelHeader` 的标题），选中 `ink`、另一页 `ink-muted`（悬停 `ink-soft`），间距 12px，`focus-visible` 圈，`role="tablist"`/`tab`，左右方向键切换。`ReadingPanelHeader` 的 `title` 改成 `string | ReactElement`，不是字符串就原样放在标题的位置（GitReviewPane 照旧传字符串，不受影响）。
- **图标**：`Notepad`，16px thin，`ink-muted`，放在待办卡片放方框的那一列（16px）。`docs/design/` 里没有禁用记事类图标的规定（查了 foundations §2.3 与各节的「不要」）。挑法：在 scratchpad 里用真 Phosphor SVG 拼了一页（文件卡片、待办卡片、提醒卡片、备忘卡片，加顶栏的 `ListChecks`、`GitDiff`、`TextAa`、`Gear`、`ChatCircleText` 与面板的 `Plus`、`X`），headless Chrome 截图逐个比：`Note` 是折角的纸，和回复下文件卡片的文件图标一家；`NoteBlank` 只剩一个方块，像待办卡片的空方框；`NotePencil` 读作「编辑」；`Notebook` 像侧栏、版式类图标；`Notepad` 顶上一排线圈，同屏没有撞脸的。同一张截图里也比了 14px regular（提醒卡片的 `Alarm` 是 14px regular）：照票面与 foundations「默认 16px、Phosphor Thin」定 16px thin，代价是和提醒卡片叠在一起时笔画比 `Alarm` 细一档，要统一改一行。
- **日期**：组名用新加的 `formatPastDay`（`gui/src/lib/message-time.ts`）。没有现成函数正好是「今天、昨天，再早写日子」：`formatScheduleDay` 前后 2–6 天写星期，`formatMessageTime` 带钟点，`formatListTime` 今天写钟点、2–6 天写星期。新函数用时间条的日子词加 `formatScheduleDay` 的日期写法（「10月23日」，跨年带年份；英文「Oct 23」「Oct 23, 2025」），不写星期，比今天晚的（钟不准）当今天。期限「到 …」的日子直接用 `formatScheduleDay`（今天、明天、周五、11月6日），照待办截止的写法。

**3. 新增文案**（中 / 英原样）

| key | 中文 | English |
|---|---|---|
| `memo.tab`（第二个页签；第一个沿用 `todo.title`「待办」） | 备忘 | Memos |
| `memo.tabsLabel`（页签组的无障碍名） | 待办与备忘 | To-do and memos |
| `memo.empty` | 值得记住的事，Galley 会记在这里。 | Galley keeps what's worth remembering here. |
| `memo.emptyExample` | 比如「我不吃香菜」 | For example: “I don't eat cilantro.” |
| `memo.until(day)` | 到 {day} | Until {day} |
| `memo.cardNoted` / `cardChanged` / `cardDropped`（卡片写成「{前缀} · {正文}」） | 记下了 / 改为 / 不再记 | Noted / Changed to / No longer noted |
| `memo.deleteMemo.deleted(text)` | 已删除「{text}」 | Deleted "{text}" |
| `memo.deleteMemo.deletedCount(n)` | 已删除 {n} 条备忘 | Deleted {n} memos |
| `memo.deleteMemo.undo` | 撤销 | Undo |
| `settings…resetMainChat.deletes` 新增一行（排在待办那条后面） | 备忘里它记下的关于你的事 | Its memos: what it noted about you |

菜单里的「删除」沿用 `todo.deleteTodo.menuItem`；组名、期限里的「今天」「明天」「昨天」沿用 `todo.dayToday` 等；失败原因沿用 `todo.actionFailed` / `actionGone`。

空状态和票面不一样的两处（自己定的，没回头问，设计文档里写了由来）：票面与裁决 142 的文字稿是「值得记住的事，它会记在这里。比如：「我不吃香菜」。」。① 「它」改成「Galley」：文案规范「Galley」一行明写面板里不写没有先行词的「它」（10-16 JC 看待办空状态：「这个它是谁？」），面板也开在工作台旁边。② 拆成一句加一个例子两行，例子不加冒号与句号，照「待办」页空状态（「比如「周三下午 3 点前要交季度报告」」）：两页挨着，切页签时写法一致。要回到文字稿原样，改 `zh.ts` 两个字符串即可。

**4. 设计文档**

- `docs/design/conversation.md`：「提醒卡片」的「位置」补一句备忘卡片在最后；新增「备忘卡片」一节（在「待办卡片」后面）；「待办面板」开头一句说两页、「顶部」改成两个页签，末尾新增「两个页签」（样子、开在哪一页、没选乙与丙的理由，链裁决 142）与「「备忘」页」（分组、每行、点正文、菜单与删除、空状态、刷新）。
- `docs/design/overlays-and-settings.md`：⌘K「待办」项补「打开的是待办页，面板在备忘页时翻回，不加备忘项」；「待办（内置运行时）」开头补两个页签与备忘卡片的去处；重置主对话的「会删除」四条改五条。
- `docs/copy-language-guidelines.md`：「重置主对话」表的说明与「会删除」中英两格加备忘；「Galley」一行补备忘页空状态的写法与改「它」的由来。

**5. 验证**（都在 worktree 里跑过，看到输出；pnpm 命令在 `gui/` 里跑，等同 `pnpm --dir gui …`）

- `pnpm typecheck`：通过（`tsc --noEmit` 无输出）。
- `pnpm lint`：通过（`eslint src --max-warnings 0` 无输出）。
- `pnpm test`：`Test Files  215 passed (215)`，`Tests  2387 passed (2387)`。
- 新测试与改过的几组再用 `TZ=UTC`、`TZ=America/Los_Angeles` 各跑一遍：两遍都是 `Test Files  12 passed (12)`、`Tests  247 passed (247)`。
- `git diff --check`：干净。`node scripts/check-docs-links.mjs`：`docs link gate OK: 478 files checked.`。`node scripts/check-ipc-protocol-drift.mjs`：aligned（15 events、8 commands；挪走 `ipc.ts` 的备忘一节后，那个文件与票 95 之前逐字节相同）。
- prettier：新文件整篇格式化；旧文件里 `TodoPanel.tsx` 改前是干净的，整篇格式化只动了自己的 hunk；`App.tsx`、`en.ts`、`zh.ts` 改前就不干净，没整篇跑，核过 prettier 差异块数改前改后相同（2、13、4），自己的 hunk 没有新增差异；其余旧文件 `prettier --check` 通过。
- 全角标点：scratchpad 里一个脚本扫新增行（中文旁边的半角 `,;:?!()`），中文语境零处；命中的 16 行都是英文注释与测试名里引用的中文词（如 `/** 删除: a memo off the page at once */`），照现有注释的写法。
- 新增行查过本机路径、会话 id、密钥格式：没有。

新测试：`gui/src/lib/memo.test.ts`（分组与排序、组名、期限、跳转目标与没有出处、卡片三种文字、能不能点）、`gui/src/stores/memo.test.ts`（一起读、删除与撤销、5 秒后交给 Core、连删合并、按删的先后、发送前提交、拒绝后带原因）、`gui/src/components/todo/MemoPage.test.tsx`（静态渲染照面板测试的 mock 写法：分组顺序、13px 不截断、期限样式、按钮与字、删除中的行不画、失败原因、空状态与读回来之前不画；卡片的三种文字、外形、能不能点、12px / 8px）、`gui/src/components/todo/TodoPanel.memo.test.tsx`（jsdom 走真 store：页签默认待办、点击与方向键切换、关了再开回到待办、⌘K 翻回待办、从卡片打开在备忘页且那一行亮、面板已开在待办时翻到备忘、点正文跳回、「⋯」菜单只有删除且无分隔线、右键同一份、删除撤销、Core 拒绝回来带原因）；`message-time.test.ts`、`todo-open.test.ts`、`MainView.assistant.test.tsx`（卡片排在待办卡片、提醒卡片后面，8px / 12px，只在主对话）、`useMessageSend.test.ts`（发送前先提交备忘删除）各加了几条。

**6. 我自己定的细节、看到但没改的、没验证到的**

自己定的：

- **卡片位置排在提醒卡片后面**：票面写「跟在待办卡片后面」，没说提醒卡片。回复下的卡片照面板的页序排：「待办」页上的（子任务、待办、提醒）在前，「备忘」页的在后；没有提醒卡片时就是紧跟待办卡片。前缀与「 · 」用 `ink-muted`，正文 `ink`。
- **页签是面板组件自己的状态**（`useState`），卸载就回到待办；卡片与 ⌘K 通过 `ui` store 新加的 `todoPageRequest` 要页，面板挂上或在屏上时取走、清掉。换页时列表容器按页重挂，回到顶上（「待办」页的「已完成」展开状态因此回到收起）。
- **亮行复用待办的 `todoRowRequest`**：`useTodoPanelFlash` 的查找加上 `[data-memo-row]`。
- **备忘的删除也在主对话发送前提交**（`sendThroughCore` 里挨着待办的提交），照票 88 的理由：它回答前若 `memo list`，删掉的不该还在。
- `GroupLabel` 从 `TodoPanel.tsx` 原样挪到 `components/todo/GroupLabel.tsx`，两页共用。`TodoRowMenu` 的 `onTalkAbout`、`canCancelReminder`、`onCancelReminder` 改成可选，没有上面两项时不画分隔线；待办行照旧全传，行为不变。
- 备忘的 Tauri 类型从 `gui/src/types/ipc.ts` 挪到 `gui/src/lib/memo.ts`（和调用放在一起，同待办的放法），`ipc.ts` 那一节删了。
- 备忘行：正文与期限顶端对齐、都是 20px 行高。先用过基线对齐，静态预览里期限跑到了折行正文的最后一行（正文按钮是 inline-block，基线取最后一行），改成顶端对齐。「⋯」对着第一行，悬停时这一行右边让出 42px（同待办标题的 pr-8 加行的 10px），期限跟着往左让。

看到但没改的：

- IPC 这张票用到的都有，没缺。`MemoEventItem.memoExists` 没用上：卡片能不能点看「备忘」页的列表（过了期限的备忘 `memoExists` 为真，却不在页上，没有可亮的行）。
- 只自动开一次（票 87 的 `todoPanelIntroduces`）只认待办卡片，第一次出现备忘卡片不会自动开面板；票面没要，没加。
- 面板开着时主区跨过 760px（并排与覆盖两种画法在 `LocalFileWorkspace` 里是两处 JSX），面板会重挂，页签回到「待办」。
- header 里页签贴在上沿、「+」和 × 在 28px 按钮里居中、看着低一点：是 `ReadingPanelHeader` 原来的 `items-start` 版式，标题「待办」原来也在这个位置，没动。
- 英文的期限写「Until Tomorrow」「Until Today」（`formatScheduleDay` 的英文日子词首字母大写），同现有「Next Tomorrow 8:00 AM」的写法，没单独处理。
- 重置弹窗正文里「它记住的关于你的事」原指 GA 记忆，现在和备忘那一行意思有重叠；票面只要补清单，正文没动。

没验证到的：

- 没跑 `tauri dev`（按要求）：真 Core 的 `list_memos` / `list_memo_events` / `delete_memo` 与 `memos:changed` 只在 mock 的 invoke 下测过；真机的一轮结束后卡片出现、点卡片开面板与亮行、5 秒撤销后 Core 真删，都等 JC 走真机步骤。
- 布局只在 scratchpad 的一次性 Vite 静态预览里看过（假数据、无 Tauri，浅色与深色各一张，悬停用 CSS 覆盖模拟），没进真窗口；窄窗口覆盖态、Windows 低 DPR 下 16px thin 图标的粗细、读屏软件都没看。
- 没跑 CI。
