# 121 「备忘」页按时间段分组；具体哪天悬停时在「⋯」左边露出来

Status: ready-for-agent（2026-11-02 开票）

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

（代理填写）
