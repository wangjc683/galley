# 121 「备忘」页按时间段分组；具体哪天悬停时在「⋯」左边露出来

Status: needs-dogfood（2026-11-02 快进合入 `305263fa`…`c3c876de`。主会话验收：看过 6 条、25 条演示、悬停最长那条与有期限那条悬停的截图；rebase 到 `0e72f6b4` 后 typecheck、lint 退出码 0，`TZ=UTC` 下 todo、memo、sessions 测试 176 条过，`diff --check` 干净；对整个分支 diff 与提交说明逐条比对 `memos` 正文，只命中通用词。只在 Chrome 无头里量过，等 JC 真窗口看）

来源：[主对话 PRD](../PRD.md) 裁决 166，推翻裁决 164 第 2 条（票 [119](./119-memo-day-in-a-left-column.md) 的左栏）。只改 GUI 的「备忘」页、它的测试与设计文档；不动 Core、CLI、Agent API、迁移、「待办」页、回复下的备忘卡片。外置运行时零变化。

## 为什么

票 119 把日子放进左栏，JC 真机看：左栏只有每天第一条旁边有字，同一天其余几条左边空着，太浪费。JC 定：组按时间段分，同侧栏；具体哪天只在悬停时露出来。

## 要做到

1. **分组**：按每条最后一次记或改的时刻（与现在 `memoPageGroups` 用的同一个时刻）归进四段：今天、本周、本月、更早。归段规则直接复用侧栏的 `bucketForTimestamp`（`gui/src/lib/sessions.ts:107`：今天零点以后、近 7 天、近 30 天、更早；`now` 用页面现有的日子戳，跨午夜重读照旧），不另写一套。组名用侧栏的那几个字（`zh.ts` / `en.ts` 的 `bucketToday` / `bucketWeek` / `bucketMonth` / `bucketEarlier`，读法照你在代码里找到的现成引用方式，别复制字符串）。空的段不画。段内次序照旧：最后改动的时刻、新的在上；同一刻后记的在上。
2. **组名与间距回到票 119 之前**：组名用 `GroupLabel`（同待办页），组与组之间 12px（`space-y-3`）。去掉票 119 的左栏（`MemoDay`、`memoDayParts` 与相关测试），正文回到全宽。
3. **具体哪天，悬停时露出来**：一条在悬停、键盘聚焦（`focus-within`）或菜单开着时，在「⋯」左边写那一天，文字由现有的 `memoDayLabel`（`formatPastDay`：今天、昨天、10月28日，别的年份带年份）给，12px、`ink-muted`、`tabular-nums`，与期限「到 11月1日」同一种写法；平时不显示。「今天」组里也照样写（规则不设例外）。
4. **不让行跳**：悬停时出现的「日子 + ⋯」这一簇浮在这一行第一行的右端、盖在字上（背后垫这一行悬停时的底色，左缘可以做一小段渐隐），不再让出宽度，正文不因悬停而折行，下面的行不动。有期限的那条，悬停时这一簇盖住「到 11月1日」，平时期限照旧在第一行右边、照旧占自己的宽度。这一条推翻现在「⋯ 悬停时这一行右边让出它的宽度」的写法，只在「备忘」页；「待办」页不动。
5. **其余照旧**：13px `ink` 正文、20px 行高、不截断、自然折行；点正文跳回原话、「⋯」与右键菜单只有「删除」、删除与撤销、从卡片打开时那一行亮一下、空状态、刷新。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run src/components/todo src/lib/memo src/lib/sessions
TZ=UTC pnpm --dir gui exec vitest run src/components/todo src/lib/memo src/lib/sessions
TZ=America/Los_Angeles pnpm --dir gui exec vitest run src/components/todo src/lib/memo src/lib/sessions
pnpm --dir gui test        # 全量 vitest，收尾前跑一次
git diff --check
```

- 测试：去掉票 119 左栏的断言；新增：四段归段（含 7 天、30 天边界前后各一条、跨年的一条进「更早」）、空段不画、组名用侧栏的字；悬停簇里有那一天的字、平时没有；悬停簇不让出宽度（结构或 class 上能断言的就断言）。
- **真 CSS 量一次**：一次性静态预览（真 Tailwind 产物、真字体，playwright 无头浏览器，文件放 scratchpad、不进仓库、不放 `gui/` 下）。数据全部用虚构的：①6 条，今天 4 条「养了一只猫，2019年3月领养。」「在做 Web 前端相关的工作。」「历史专业毕业。」「称呼：小林。」，5 天前「办公室在某市海滨区望海路2号。」，7 天前「不吃香菜。」；②票 119 那份约 25 条的演示数据（scratchpad 里 `t119-` 开头的预览里有，人名地名是虚构的）。面板 320px 与 280px、浅色与深色各截一张，再各截一张悬停最长那条的；截图放 scratchpad，报告给路径；量出两档的总高，并确认悬停时没有一行折行或跳动。
- **隐私**：JC 的备忘原文不得出现在任何会提交的文件里（测试、设计文档、报告、提交说明）；收尾前用只读方式读出 `memos` 表的正文（`sqlite3 -readonly "$HOME/Library/Application Support/app.galley/workbench.db" "select text from memos"`），逐条拿去 grep 整个分支的 `git diff main..HEAD` 与提交说明，要 0 处；报告里只写「逐条比对，0 处」，不写这些正文，也不写用来搜的词。
- 中文（报告、设计文档）用全角标点，收尾前自己扫新增行（脚本放 scratchpad，用 `t121-` 前缀）。`gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error。

## 设计文档

`docs/design/conversation.md` 的「备忘」页一节：「分组」改成时间段（规则、组名的字、为什么同侧栏），写明 2026-11-02、票 121、裁决 166，并记一句票 119 的左栏为什么撤（裁决 166 第 1 条）；「⋯ 与右键」改成悬停簇浮在第一行右端、不让宽度、里面先是那一天再是「⋯」，盖住期限；「刷新」里「今天的日子」一类说法对齐。量出来的数写进去。

## 环境与边界

- 只在自建 worktree 里做（主会话已建好，见派单），绝不碰主工作树（JC 的 `tauri dev` 在主树跑着）。不跑 `tauri dev`。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 引用匹配行时用 `grep`，不要用 `rg`。本文件在开源仓库里：不写本机用户名路径。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 改了哪些文件、哪几处；归段怎么复用的。
2. 截图路径（scratchpad），两档总高，悬停时有没有行折行或跳动。
3. 门禁命令与结果行（含两个时区）。
4. 设计文档改了哪几条。
5. 隐私 grep 的结果。
6. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。只改 GUI 的「备忘」页、它的测试与设计文档；没碰 Core、CLI、Agent API、迁移、「待办」页、回复下的备忘卡片。外置零变化。下文 `<scratchpad>` 指主会话这次的 scratchpad 目录。提交 `01fc066b`（代码、测试、设计文档）与本报告一笔。）

### 1. 改了哪些文件、哪几处；归段怎么复用的

- `gui/src/lib/memo.ts`：
  - `memoPageGroups(memos, todayStartMs)`：多一个参数，归段直接调侧栏的 `bucketForTimestamp(memo.updatedAt, new Date(todayStartMs))`（`lib/sessions.ts`），不另写窗口；`now` 用页面的日子戳，`bucketForTimestamp` 自己会取当天零点，所以传零点与传当天任何时刻结果一样，跨午夜随 `useDayStamp` 重算。排序照旧（最后改动的时刻、新的在上；同一刻后记的在上），再按 今天、本周、本月、更早 的固定次序出组，空的段不出。
  - 组的形状从 `{ dayMs, memos }` 改成 `{ bucket, memos }`；新类型 `MemoBucket` 就是 `ReturnType<typeof bucketForTimestamp>`，不复制那四个字面量。
  - 新 `memoDayMs(memo)`：最后一次记或改的本地零点，给悬停簇里的日子用；文字照旧由 `memoDayLabel`（`formatPastDay`）给。两处注释改成新的用法。
- `gui/src/components/todo/MemoPage.tsx`：
  - 组名回到 `GroupLabel`，组与组之间 `space-y-3`，每组一个 `section`（`data-memo-group` 写段名，如 `today`）。组名的字读法照 `SidebarTimeline.tsx`：`copy.sidebar.bucketToday` / `bucketWeek` / `bucketMonth` / `bucketEarlier` 拼成一张 `Record`，不复制字符串。
  - 去掉票 119 的 `MemoDay`、`memoDayParts`、两栏的 `section`；正文回到全宽。
  - `MemoRow`：去掉悬停、聚焦、菜单开着时的 `pr-[42px]`，这一行的内边距任何时候都是 `px-2.5 py-1.5`。原来那颗绝对定位的「⋯」换成一簇 `data-role="memo-hover"`：`absolute right-1.5 top-1.5 flex h-5 items-center gap-0.5 pl-5`，里面先是 `data-role="memo-day"` 的日子（12px、`leading-5`、`tabular-nums`、`ink-muted`、不换行），再是原来的 `TodoRowMenuButton`。显隐照原来「⋯」的条件（`group-hover`、`group-focus-within`、菜单开着）。底：`bg-[linear-gradient(to_right,transparent,var(--memo-ground)_12px)]`，`--memo-ground` 平时是 `--color-app`，悬停或菜单开着时是 `--color-hover`。期限 `memo-until` 在同样的条件下不透明度 0（仍占位）。
- `gui/src/components/todo/GroupLabel.tsx`：只改注释（备忘页的时间段用它）。
- `gui/src/lib/memo.test.ts`：分组测试重写：四段、段内次序；本周与本月的边界上各一条、边界前一分钟各一条，去年的一条进「更早」；与 `bucketForTimestamp` 逐条一致、当天任何时刻的日子戳结果相同；空段不出；改过的一条挪到改的那一段；同一刻次序；跨午夜（明天的日子戳把今天的挪进本周）。日子：`memoDayMs`；`memoDayLabel` 加别的年份（中英）。
- `gui/src/components/todo/MemoPage.test.tsx`：去掉票 119 左栏的三条；新增：四段按次序、组名就是侧栏的字（中英）、组名排在段里第一、`space-y-3`；空段不画；悬停簇里先日子后「⋯」，「今天」组里也写「今天」，平时 `opacity-0`、悬停与聚焦 `opacity-100`；这一行的内边距类不变、没有 `pr-[42px]`，簇是 `absolute right-1.5 top-1.5 h-5 pl-5`、带渐隐与两种底，期限悬停时 `opacity-0`。原有的期限断言只放宽 class 的结尾。
- `gui/src/components/todo/TodoPanel.memo.test.tsx`（jsdom，经真 store）：去掉票 119 那条；新增两条：在「今天」组名下；点开「⋯」菜单时簇显出（`opacity-100`、底换成悬停色）、这一行底色 `bg-hover`、第一行那个 div 的 class 与平时一字不差，另一行照旧隐着。
- `docs/design/conversation.md`：见第 4 节。

### 2. 截图与实测

一次性静态预览：`<scratchpad>/t121-preview/`（Vite 跑真组件 `MemoPage` 与真 `globals.css`，Tailwind 从 worktree 的 `gui/src` 生成，字体是应用自带的 Inter 与系统 PingFang SC；对照用 main 上票 119 的 `MemoPage.tsx` 在同一预览里量），playwright-core 驱动本机 Chrome 无头，2 倍像素，只截列表区域。数据全是虚构的：①票面那 6 条（今天 4 条，5 天前、7 天前各 1 条，落在今天、本周两段）；②票 119 的约 25 条演示（今天 3、本周 7、本月 12、更早 3）。脚本 `<scratchpad>/t121-pw/t121-measure.mjs`、`t121-until.mjs`，原始数在 `<scratchpad>/t121-measure.json`。

截图在 `<scratchpad>/t121-shots/`：

- 平时：`t121-six-320-light.png`、`t121-six-320-dark.png`、`t121-six-280-light.png`、`t121-six-280-dark.png`、`t121-demo-320-light.png`、`t121-demo-320-dark.png`、`t121-demo-280-light.png`、`t121-demo-280-dark.png`
- 悬停最长那条（6 条里是写「10月28日」那条，演示里是折成两三行、写「昨天」那条）：同名加 `-hover`，共 8 张
- 另加：有期限那条悬停（`t121-until-320-light-hover.png`、`t121-until-320-dark-hover.png`，「到 周五」被「今天 ⋯」盖住）；只有键盘聚焦、指针不在时（`t121-focus-320-light.png`、`t121-focus-320-dark.png`，簇垫面板底色）

总高（`memo-groups` 的高）：

| | 票 119 左栏（改前） | 改后 | 裁决 166 估 |
|---|---|---|---|
| 6 条，320px | 208px | **249px** | 约 248px |
| 6 条，280px | 248px | **249px**（没有一条折行） | — |
| 演示约 25 条，320px | 1,012px | **946px** | 约 950px |
| 演示约 25 条，280px | 1,092px | **966px** | — |

浅色深色同高。6 条：今天一段 150.5px（组名 22.5 + 4 行各 32），本周一段 86.5px。

悬停：两份数据、两档宽、浅色深色，每一行各悬停一遍，量全部行的位置、高度、正文折成几行、正文宽度：**0 行变高、0 行挪动、0 行多折一行**，正文宽度不变；每次只有被悬停那一行的簇不透明度为 1。

簇的几何（Chrome 实测）：离这一行右边 6px，顶在这一行下 6px、高 20px（第一行的行盒），28px 的「⋯」顶在 2px；写「今天」「昨天」宽 74px，写「10月28日」宽 109.6px；日子字末到「⋯」按钮里的图标 9px（再到第一个点约 2.4px）。有期限的那条悬停时「到 …」不透明度 0。只有键盘聚焦时，簇底是面板底色（浅色 `rgb(250, 249, 248)`，深色 `rgb(20, 23, 26)`）。

### 3. 门禁

```text
pnpm --dir gui typecheck          → tsc --noEmit，exit 0
pnpm --dir gui lint               → eslint src --max-warnings 0，exit 0
pnpm --dir gui exec vitest run src/components/todo src/lib/memo src/lib/sessions
                                  → Test Files  13 passed (13)；Tests  176 passed (176)（本机时区）
TZ=UTC …同上                      → Test Files  13 passed (13)；Tests  176 passed (176)
TZ=America/Los_Angeles …同上      → Test Files  13 passed (13)；Tests  176 passed (176)
pnpm --dir gui test               → Test Files  238 passed (238)；Tests  2658 passed (2658)
git diff --check main..HEAD       → 无输出，exit 0
```

另：

- 多跑了 `TZ=Europe/London`、`Asia/Shanghai`、`Australia/Sydney` 下的 `src/lib/memo` 与 `MemoPage` 测试，都是 33 passed。第一版边界条用墙上时间写死（10-19 00:00、9-26 00:00），在 `Europe/London` 下失败：欧洲 10-25 切夏令时，侧栏的窗口按 24 小时乘天数算，边界差一小时。改成照侧栏同样的算法构造边界（`WEEK_WINDOW_DAYS`、`MONTH_WINDOW_DAYS`），各时区都过。
- `MemoPage.test.tsx`、`memo.test.ts` 在 main 上是 prettier-clean，整文件格式化只动了自己的 hunk；其余 4 个 `gui` 文件 `prettier --check` 通过。
- 新增的 Markdown 行（设计文档与本报告）用 `<scratchpad>/t121-cjk-punct.py` 扫半角标点（中文字旁的 `, ; : ? ! ( )`，去掉行内代码、链接地址与网址）：命中 5 处，都在上面门禁输出的代码块里（`passed (13)` 一类原样输出，旁边是全角分号），设计文档 0 处。

### 4. 设计文档

`docs/design/conversation.md` 的「「备忘」页」一节：

- **分组**：换成时间段：规则（`memoPageGroups` 调 `bucketForTimestamp`，滚动窗口，日子戳与跨午夜）、组名的字（`copy.sidebar` 四个键，中英），空段不画，段内次序，具体哪天挪到悬停；写明 2026-11-02、票 121、裁决 166。子项：组名与间距回到票 119 之前（`GroupLabel`、`space-y-3`、正文全宽）；为什么同侧栏（组名最多 4 个、同一种找法、复用不另写；代价是粒度从天变成时间段）；量得的数（第 2 节那张表的改后与改前）；票 119 的左栏为什么撤（裁决 166 第 1 条），并把左栏那一版与再此前票 97 按日子分组的样子各记一句。原来左栏的八条子项删掉，要点并进这一句。
- **每行**：去掉「在右边一栏」「不跑到日子底下」，写回与列表同宽、20px 行高；期限「占自己的宽度」，悬停时被那一簇盖住。
- **「⋯」与右键**：删除那一段不变；新增三条子项：悬停簇（何时出现、先日子再「⋯」、日子的字与写法、「今天」组里也写、到「⋯」的距离）；浮着不让宽度（位置、两种底与 12px 渐隐、盖住正文末尾几个字、盖住并隐去「到 …」、菜单开着保持悬停样子）；由来（JC 的原话、为什么不让宽度、此前让宽度的写法、只改「备忘」页）。
- **刷新**：「今天的日子」改成「各条挪进新的时间段，悬停露出的『今天』『昨天』跟着变」。

### 5. 隐私

用只读方式读出 `memos` 表的正文，逐条拿去比对 `git diff main..HEAD` 与 `git log main..HEAD` 的提交说明（整句，以及去掉句末句号后的整句）：逐条比对，0 处。另用每条的任意 6 字窗口比对新增行与提交说明，0 处；4 字窗口只撞到英文注释里的常见字母组合，与备忘无关。预览数据只在 scratchpad，没进仓库。

### 6. 看到但没改的（Open risks）

1. 悬停时那一簇盖住正文第一行的末尾：写「今天」「昨天」时实盖约 4 个半字再加 12px 渐隐，写「10月28日」时约 7 个字；跨年的「2025年12月31日」按标签宽推算簇约 156px，实盖约 10 个半字。悬停时这几个字看不见，那一段也点不到正文按钮（点到的是簇，什么都不做）；要看被盖住的字得把指针移开。
2. 簇的底平时写死面板的 `--color-app`（只在键盘聚焦、指针不在这一行时用到）。面板背景哪天换成别的颜色，这种情况下会露出一块色差。
3. 从卡片打开、那一行亮一下的 1.4 秒里，指针恰好停在这一行上时，簇垫的是灰色悬停底色，行是品牌色在渐淡，会看到一小块灰底。没处理。
4. 屏幕阅读器：簇里的日子平时只是不透明度 0，仍在无障碍树里，读成「正文、到 …、10月28日、更多」。日子对读屏的人有用，没加 `aria-hidden`。
5. 「⋯」按钮自己的悬停底色也是 `bg-hover`，与这一行的悬停底色同色，指针移到「⋯」上看不出按钮的悬停态（票 97 起就这样，没改）。
6. 侧栏的 `bucketForTimestamp` 按 24 小时乘天数算窗口，夏令时切换那几天里本周、本月的边界差一小时（侧栏同样，没改）；测试已按同样算法构造边界。
7. 只在 Chrome 无头里量过，真窗口（WKWebView）没看：任意属性 `[--memo-ground:…]` 加分组变体、`linear-gradient` 里用变量，WebKit 应当支持，但没实测。
8. `docs/project-status.md` 第 873 行与票 119 的 Status 仍写着等 JC 真机看票 119 的左栏；这次没动，留给主会话合入时改。
