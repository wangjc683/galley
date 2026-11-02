# 119 「备忘」页：日子挪进左边一栏，与那天的第一条并排

Status: wontfix（被取代，2026-11-02 主对话裁决 166、票 121：JC 真机看左栏太空，改按时间段分组。左栏随票 121 合入撤掉）

来源：[主对话 PRD](../PRD.md) 裁决 164。只改 GUI 的「备忘」页与它的测试、设计文档；不动 Core、CLI、Agent API、迁移、「待办」页、回复下的备忘卡片。外置运行时零变化（备忘只在内置主对话）。

## 为什么

「备忘」页按最后改动的本地日子分组（`gui/src/lib/memo.ts` 的 `memoPageGroups`），每组上面一个组名（`GroupLabel`，11px semibold `ink-muted`，上下 3px，约 22px 高），组与组之间 12px（`MemoPage.tsx` 外层 `space-y-3`）；每条一行 32px（13px / 20px 行高，`py-1.5`）。JC 平时一天多是 1 条，一条备忘约 66px，一半是组名与空隙；一行能写约 21 个汉字，备忘平均 11 个字，右边一半空着。JC 定：照旧按日子分组，日子换个摆法。

## 要做到

1. **两栏**：每一天是一块，左边一栏写日子，右边一栏是那天的几条。日子与那天第一条的第一行并排，同一个 20px 行盒、同样的上内边距（与正文第一行的行盒上下对齐）；那天其余几条只在右栏，左栏空着。
2. **日子的字**：12px、`ink-muted`、`tabular-nums`、常规字重，与同一行右边的期限（「到 11月1日」，`memo-until`）同一种写法，一行里两处日子不是两种样子。文字照旧由 `memoDayLabel` 给（今天、昨天、再早写「10月28日」，跨年带年份；英文同理），不改措辞。
3. **左栏宽度固定**，不随内容变：取常见标签里最宽的那个，中文的「10月28日」「12月31日」与英文的 Today / Yesterday / 月日写法都放得下、不折行、不截断；用字体文件或真浏览器量，不要估。跨年的标签（带年份，比如「2025年12月31日」）放不下时在左栏里折成两行，不截断、不撑宽左栏。左栏与正文之间的间距由你定，报告里写清左栏宽、间距、正文栏剩多宽（面板 320px 与 280px 两种宽度各算一次）。
4. **正文一栏照旧**：13px `ink`、20px 行高、不截断、自然折行，折行的第二行与正文对齐（不跑到日子底下）；有期限的照旧在第一行右边；点正文跳回原话、「⋯」与右键菜单、删除与撤销、从卡片打开时那一行亮一下，全部照旧。悬停与菜单开着时的底色只盖正文这一格（日子不属于某一条）。
5. **天与天之间 8px**（原来组间 12px），第一天上面不加。组的语义照旧：每一天仍是一个 `section`，无障碍名还是那个日子（屏幕阅读器先读日子再读那几条），现在用什么关联方式（`aria-labelledby` 等）就沿用。
6. **不做**：日子吸顶、显示时去掉末尾句号（JC 没选）；不改分组规则、排序、空状态、刷新、「待办」页。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run src/components/todo src/lib/memo
TZ=UTC pnpm --dir gui exec vitest run src/components/todo src/lib/memo
TZ=America/Los_Angeles pnpm --dir gui exec vitest run src/components/todo src/lib/memo
pnpm --dir gui test        # 全量 vitest，收尾前跑一次
git diff --check
```

- 测试：`MemoPage.test.tsx` / `TodoPanel.memo.test.tsx` 里钉着旧结构（组名单占一行）的断言改掉；新增断言：每天一个日子标签、在那天第一条旁边、其余几条没有；跨年标签存在时结构不变。静态渲染测试读不到 zustand 里塞的值，照现有测试的做法喂数据。
- **真 CSS 量一次**：用一次性的静态预览（真的 Tailwind 产物、真字体，playwright 无头浏览器，文件放 scratchpad、不进仓库、不放 `gui/` 下）渲染这一页，两档数据：①照 JC 现在那 6 条的形状（今天 4 条、另两天各 1 条，长短相近：最长约 16 个字、带数字，最短 5–6 个字），字用虚构的：今天「养了一只猫，2019年3月领养。」「在做 Web 前端相关的工作。」「历史专业毕业。」「称呼：小林。」；10月28日「办公室在某市海滨区望海路2号。」；10月26日「不吃香菜。」。JC 的备忘原文不进仓库里的任何文件；②约 25 条、跨十几天的演示数据，里面有带期限的、折两行的、跨年日子的各至少一条（演示数据里的人名、地名用虚构的）。面板 320px 与 280px、浅色与深色各截一张，截图放 scratchpad，报告里给路径；量出 6 条那一档的总高、一天 1 条时每条占多高，与裁决 164 的估算（约 208px、约 40px）对照。
- 中文（报告、设计文档）用全角标点，收尾前自己写个正则扫新增行（脚本放 scratchpad，用 `t119-` 前缀）。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化你自己的 hunk，不要 `prettier --write` 整个文件。

## 设计文档

`docs/design/conversation.md` 的「备忘」页一节：「分组」那一条改成新的摆法（左栏日子、字号字重墨色、左栏宽与间距、天与天 8px、悬停只盖正文、跨年折两行），写明 2026-11-02、票 119、裁决 164，以及为什么与待办页的组名分家（裁决 142 第 5 条「形态分开」）；「每行」一条里与此相关的说法顺手对齐。量出来的数写进去。

## 环境与边界

- 只在自建 worktree 里做（主会话已建好，见派单），绝不碰主工作树（JC 的 `tauri dev` 在主树跑着）。不跑 `tauri dev`。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 引用匹配行时用 `grep`，不要用 `rg`。本文件在开源仓库里：不写本机用户名路径。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 改了哪些文件、哪几处；左栏宽、间距、正文栏宽（320 / 280）与量法。
2. 截图路径（scratchpad），6 条那一档的实测高度与一天 1 条时每条的高度。
3. 门禁命令与结果行（含两个时区）。
4. 设计文档改了哪几条。
5. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。只改 GUI 的「备忘」页、它的两份测试与设计文档；没碰 Core、CLI、Agent API、迁移、「待办」页、回复下的备忘卡片。外置零变化。下文 `<scratchpad>` 指主会话这次的 scratchpad 目录。）

### 1. 改了哪些文件、哪几处

- `gui/src/components/todo/MemoPage.tsx`：
  - 列表外层 `space-y-3` 改 `space-y-2`：天与天之间 8px，第一天上面不加。
  - 每一天的 `section` 改成两栏（`flex items-start`）：先是新的 `MemoDay`（左栏），后是一栏 `min-w-0 flex-1`，那天的 `MemoRow` 全在里面；不再用 `GroupLabel`。日子在 `section` 里排第一，屏幕阅读器先读日子再读那几条。原来也没有 `aria-labelledby`（组名只是第一个子元素），沿用，不加。
  - 新的 `MemoDay`：`w-[76px] shrink-0 break-words py-1.5 pl-2.5 text-[12px] leading-5 tabular-nums text-ink-muted`，常规字重，写法同右边的 `memo-until`；文字照旧来自 `memoDayLabel`。
  - 新的 `memoDayParts`：中文跨年标签在「年」后面分成两段，各自 `whitespace-nowrap`。不加时 Chrome 实测折成「2025年12」「月31日」（「2025年12」放得进 66px）；加了折成「2025年」「12月31日」。英文与其余标签是一段，照常断行（「Dec 31,」「2025」）。
  - `MemoRow` 的行为一处没改（点正文跳回、「⋯」与右键菜单、删除与撤销、失败提示、`data-memo-row` 上的亮一下）；它现在只在正文一栏里，悬停、菜单开着的底色与亮一下都只盖正文这一格。只改了注释。组件头注释按新摆法重写。
- `gui/src/components/todo/GroupLabel.tsx`：只改注释（备忘页票 97 起用它，票 119 起不用）。
- `gui/src/components/todo/MemoPage.test.tsx`：旧断言（11px semibold 组名、`space-y-3`）改掉；新增两条：每天一个日子、在 `section` 里排第一、紧挨着那天第一条，其余几条没有，不在任何一行里面，字号字重墨色同期限，悬停底色的类只在行上；跨年标签（去年 12 月 30 日，任何一天跑都不会是「昨天」）结构不变，中文分「年」与日子两段，英文一段。
- `gui/src/components/todo/TodoPanel.memo.test.tsx`：新增一条（jsdom，经真实 store）：`section` 两个子元素，先日子后正文栏，两条都在正文栏，日子不在任何 `data-memo-row` 里。
- `docs/design/conversation.md`：见第 4 节。
- 本票第①档数据换成主会话给的虚构句子，与 main 上 `43e154d2` 同一改法（逐字一致）。

**尺寸**（面板列表左右各 8px，`px-2`）：

| | 320px | 280px |
|---|---|---|
| 左栏宽（固定，含左边 10px） | 76px | 76px |
| 左栏放字的宽度 | 66px | 66px |
| 正文一格（悬停底色的宽） | 228px | 188px |
| 正文字宽（不悬停） | 208px，约 16 个汉字 | 168px，约 13 个汉字 |
| 正文字宽（悬停或聚焦，让出「⋯」32px） | 176px | 136px |
| 改前的正文字宽 | 284px | 244px |

间距：正文一格紧接左栏，悬停底色从左栏边上起，字再往里 10px（行的 `px-2.5`）。最宽的日子末尾到悬停底色约 6.4px，到正文字约 16.4px。

量法：一次性静态预览（`<scratchpad>/t119-preview/`，Vite 跑真组件 `MemoPage` 与真 `globals.css`，Tailwind 从 `gui/src` 生成，字体是应用自带的 Inter 与系统 PingFang SC），playwright-core 驱动本机 Chrome 无头，读 `getBoundingClientRect`。标签宽（12px、等宽数字）：「10月28日」「11月11日」「12月31日」59.63px，「1月1日」44.06px，「今天」「昨天」24px；Yesterday 56.34px，Today 34.67px，月日写法最宽「May 28」42.94px、最窄「Jul 28」35.64px；跨年「2025年12月31日」105.75px、「Dec 31, 2025」78.88px。最宽的常见标签 59.63px，66px 留 6.4px 余量。

### 2. 截图与实测高度

截图（2 倍像素，只截列表区域，不含面板 header）在 `<scratchpad>/t119-shots/`：

- 6 条那一档：`t119-six-320-light.png`、`t119-six-320-dark.png`、`t119-six-280-light.png`、`t119-six-280-dark.png`
- 约 25 条那一档：`t119-demo-320-light.png`、`t119-demo-320-dark.png`、`t119-demo-280-light.png`、`t119-demo-280-dark.png`
- 悬停第一条（看底色只盖正文一格）：`t119-six-320-light-hover.png`、`t119-six-280-light-hover.png`、`t119-demo-320-light-hover.png`、`t119-demo-280-light-hover.png`
- 英文：`t119-demo-320-light-en.png`、`t119-demo-280-light-en.png`

实测（改前用 `4769b25f` 的 `MemoPage.tsx` 在同一预览里量）：

| | 改前 | 改后 | 裁决 164 估 |
|---|---|---|---|
| 6 条，320px，总高 | 283.5px | **208px** | 约 208px |
| 6 条，280px，总高 | 283.5px | 248px（两条折成两行） | — |
| 一天 1 条（一行），每天占 | 66.5px（组名 22.5 + 一行 32 + 组间 12） | **40px**（一行 32 + 8） | 约 40px |
| 演示 25 条、15 天，320px | 1,325.5px | 1,012px | — |
| 演示 25 条、15 天，280px | 1,345.5px | 1,092px | — |

日子与正文第一行：每一天里日子的字框顶与第一条正文第一行的字框顶都在 `section` 顶下 8px，上下对齐。跨年那一天左栏折两行，高 52px（正文只一行时下面空 20px）。

### 3. 门禁

```text
pnpm --dir gui typecheck          → tsc --noEmit，无输出，通过
pnpm --dir gui lint               → eslint src --max-warnings 0，无输出，通过
pnpm --dir gui exec vitest run src/components/todo src/lib/memo
                                  → Test Files  12 passed (12)；Tests  157 passed (157)（本机 CST）
TZ=UTC …同上                      → Test Files  12 passed (12)；Tests  157 passed (157)
TZ=America/Los_Angeles …同上      → Test Files  12 passed (12)；Tests  157 passed (157)
pnpm --dir gui test               → Test Files  238 passed (238)；Tests  2652 passed (2652)
git diff --check                  → 无输出
```

另：改过的 4 个 `gui` 文件 `prettier --check` 都通过（没有整文件格式化）；新增的 Markdown 行用 `<scratchpad>/t119-cjk-punct.py` 扫半角标点（中文字旁的 `, ; : ? ! ( )`，去掉行内代码与链接地址），命中 8 处，都是原文不是中文标点：英文标签「Dec 31,」3 处（设计文档 1 处，本报告 2 处），门禁输出里的 `passed (12)` 一类 5 处。

### 4. 设计文档

`docs/design/conversation.md` 的「「备忘」页」一节：

- **分组**：组名那半句换成八条子项：日子在左边一栏（2026-11-02、票 119、裁决 164，写法同期限，文字照旧）；左栏宽 76px 与量得的标签宽、跨年在「年」后折两行；正文栏的宽（320 / 280，悬停时）与代价（悬停多折一行的条数）；天与天 8px；悬停与菜单开着的底色只盖正文一格；语义照旧（`section`、日子排第一、不加 `aria-labelledby`）；为什么与「待办」页的组名分家（裁决 142 第 5 条）；量得的数；由来与没选的，以及此前的组名摆法。
- **每行**：加「在右边一栏」「折行的第二行与正文对齐、不跑到日子底下」。
- **「⋯」与右键**：「浮在这一行（正文那一格）右端」，菜单开着时底色同样只盖正文那一格。
- **刷新**：「今天的组名」改「今天的日子」。

### 5. 看到但没改的（Open risks）

1. **悬停时更多的备忘会多折一行，下面的行跟着跳。** 「⋯」悬停时让出 32px 宽度是照旧的（票面第 4 条要求照旧），但正文一格窄了，字宽在 176～208px（320）或 136～168px（280）之间的备忘，平时一行、悬停变两行（32 → 52px）。实测：6 条那一档 320px 有 2 条（改前 0 条），280px 有 1 条（改前 0 条）；演示 25 条 320px 有 3 条（改前 1 条），280px 有 13 条（改前 2 条）。320px 下约 13.5～16 个汉字的备忘会跳，JC 的备忘平均 11 个字、长的 15～16 个字。没改：「⋯」怎么让位是新的设计决定。可选方向：甲，「⋯」浮在正文上、不让宽度（带悬停底色，盖住第一行末尾一两个字，行不跳）；乙，一直给「⋯」留着宽度（行不跳，但平时就多折行、页更高）。
2. **只在 Chrome 量过，没在 WKWebView 或 Windows 上量。** 两边用的是同一份 Inter 文件与 PingFang SC，`text-autospace: normal` 在应用里是显式设的；最宽常见标签 59.63px 对 66px，留 6.4px。Windows 的中文落在 Microsoft YaHei，没量。
3. **`memoDayParts` 认的是标签里的「年」。** `formatPastDay` 的中文跨年写法将来若不带「年」，会退回整段交给断行规则（可能折成「2025年12」「月31日」那种），不会截断或撑宽。
4. 面板可视高度约 475px 是裁决 164 的底数，我没有重新量；「约放 11 天」按 475 ÷ 40 算。
5. 预览只截了列表区域，没有面板 header 与真实窗口里的滚动条；macOS 的覆盖式滚动条不占宽，Windows 上列表滚得动时滚动条占 10px（`globals.css` 的 `html[data-platform="windows"] ::-webkit-scrollbar`），正文栏再窄 10px，没量。

### 6. 隐私核对

对整个分支 `git diff 4769b25f..HEAD` 用主会话给的 7 个词（`grep -E` 一条正则，词不抄进本文件）搜：新增行 0 处；提交说明 0 处；删除行 1 处，就是本票第①档那一行原文被换成虚构句子（换上的那一行与 main 上 `43e154d2` 逐字一致）。在临时 worktree 里把本分支两个提交 cherry-pick 到 `43e154d2` 上：无冲突，搬过去后 `git diff 43e154d2..HEAD` 搜这 7 个词 0 处（临时 worktree 已删）。测试、设计文档、本报告、预览数据里都只有虚构句子；scratchpad 的预览（`<scratchpad>/t119-preview/main.tsx`）用的就是主会话给的那组。
