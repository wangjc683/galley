# 124 往回翻主对话时，顶上浮一颗日期胶囊

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 171；落实 deferred「滚动时浮动日期（主对话往回翻）」（`docs/devlog/deferred.md:840`）。只改 GUI 的主对话、它的测试与文档；不动 Core、CLI、Agent API、迁移；工作台会话零变化；外置运行时没有主对话，零变化。

## 为什么

主对话是一条没有尽头的对话，时间只在断点画成两条消息中间居中的一行（第一条、隔 60 分钟以上、跨天）。往回翻时要找到时间行才知道翻到了哪天。JC 往回翻了两周的主对话，定现在做。

## 要做到

1. **写什么**：视口最上面那一行属于哪天。文字用 `formatPastDay`（`gui/src/lib/message-time.ts:450`），日子的字照备忘页现成的取法（`gui/src/lib/memo.ts:167` 的 `memoDayLabel` 用 `copy.todo.dayToday` / `dayYesterday`；你可以复用它，或者照它的取法，别复制字符串）：昨天、10月28日，别的年份带年份；不写星期、不写钟点。英文照 `formatPastDay` 的英文。
2. **「最上面那一行」怎么定**：对话的行是 `[data-role="conversation"]` 的子元素（`gui/src/lib/scroll-anchor.ts` 的 `ROWS_SELECTOR`；`firstRowBelow` 已导出，按二分找视口顶边穿过的那一行）。行上现在没有时刻：在 `Conversation.tsx` 生成行的地方给有消息的行带上它的时刻（比如 `data-at`，毫秒），没有自己时刻的行（时间行、间隔、过程窗口等）取它下面最近一个有时刻的行。哪条消息的时刻代表一行、取 `created_at` 还是别的，读代码后按「这一行画的是哪天说的话」定，在报告里说明。只读不写滚动位置。
3. **什么时候出现**：
   - 主对话的滚动容器（`MainView.tsx` 里 `data-conversation-backdrop` 那个）有滚动事件就出现，停手 1000ms 后淡出；滚动中日子变了就换字。
   - **最上面那一行是今天时不出现**（正在显示时滑回今天就照常淡出）。比今天还晚的时刻（时钟偏差）按今天算，同 `formatPastDay`。
   - 打开主对话、切会话、从工作台回到主对话那一下贴底不算滚动。怎么区分请读 `gui/src/hooks/useStickyScroll.ts`（会话切换后有 500ms 的窗口，`:874` 附近的注释）与 `useEarlierTurns.ts` 现在怎么判「已滚动」，取一个现成信号，不另造计时；报告里说明用了哪个。
   - ⌘K 定位、⌥↑ / ⌥↓、点「回到底部」引起的滚动照样算：落在旧日子上就出现（落到底是今天，自然不出现）。
   - 「今天」用 `useDayStamp()`（跨午夜照它重读）。
4. **在哪、什么样**：
   - 位置：对话区（`MainView.tsx:633`，`data-conversation-area` 那个 `relative` 容器）顶部正中，`absolute inset-x-0 top-3 z-10 flex justify-center pointer-events-none`，与底部的「回到底部」（`MainView.tsx` 约 `:982`，`bottom-4`）上下对称。只在 `isMainChat` 时渲染。
   - 外观同「回到底部」那颗的材质：`border border-line bg-elevated/92 shadow-[var(--shadow-float)] backdrop-blur-md`，`rounded-full`，高 24px（`h-6`），左右内边距 10px（`px-2.5`），字 12px、`leading-none` 或对齐到 24px 居中、`text-ink-soft`、`tabular-nums`、不换行。不可点、不抢焦点，`aria-hidden="true"`（对话里的时间行照旧给读屏）。
5. **动效**：只动透明度。出现 `--motion-fast` 淡入，消失 `--motion-slow` 淡出（`duration-(--motion-fast)` 这类写法，见 `globals.css:292` 附近的说明）。不位移、不缩放。减少动态效果下照留淡入淡出（`docs/design/foundations.md` §2.7「只淡不移」），不另加分支。
6. **性能**：滚动时每帧最多读一次（rAF 合并），二分找行；字没变不 setState。`gui/` 有 React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；状态归零用 guarded setState-in-render，工具函数别从组件文件导出。
7. 纯逻辑放 `gui/src/lib/`（比如给定最上面那一行的时刻、今天零点、语言与字，返回要写的字或 `null`），接线放 hook，画法放组件；命名照附近文件的习惯。

## 别动

- `gui/src/hooks/useEarlierTurns.ts`、`gui/src/lib/scroll-anchor.ts` 的逻辑：票 123（补页跑道）在并行改它们。只读、可以 import 已导出的函数，不改。
- 工作台会话的任何行为与样子；时间行本身（`MessageTimeDivider`）的规则与样子；「回到底部」按钮。
- 主工作树（JC 的 `tauri dev` 在那里跑着）。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run <你新增和改到的测试文件> src/components/conversation src/lib/message-time
TZ=UTC pnpm --dir gui exec vitest run <同上>
TZ=America/Los_Angeles pnpm --dir gui exec vitest run <同上>
pnpm --dir gui test        # 全量 vitest，收尾前跑一次
git diff --check
```

- 测试：纯逻辑（今天 → 不出现；昨天；今年更早；别的年份；比今天晚 → 不出现；中英）；行的时刻（有时刻的行、没有时刻的行取下面最近的）；出现与淡出的时序（假时钟：滚动后显示、1000ms 后隐去、滚动中日子变了换字、最上面是今天不显示、贴底那一下不显示）；只在主对话渲染、工作台不渲染。jsdom 不排版，位置相关的用可注入的量法或 mock `getBoundingClientRect`。
- **真 CSS 看一次**：一次性静态预览（真 Tailwind 产物、真字体，playwright 无头浏览器；文件放 scratchpad、用 `t124-` 前缀，不进仓库、不放 `gui/` 下）。内容全部虚构。截：胶囊压在你的气泡上、压在回复气泡上、压在时间行附近各一张，浅色与深色，2 倍像素；量出胶囊的宽高与离对话区顶的距离。报告给截图路径。
- 中文（报告、设计文档、deferred）用全角标点，收尾前自己扫新增行（脚本放 scratchpad，用 `t124-` 前缀）。`gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可以整篇格式化。

## 文档

- `docs/design/conversation.md`「助手的对话」里，靠近「时间：居中」（`:243`）加一条「浮动日期」：写什么、什么时候、在哪、样子、动效、只主对话，标 2026-11-02、裁决 171、票 124；写明与时间行「不加胶囊底」不冲突的理由（浮在滚动内容上没底读不出），以及「当天第一条的时间行滑到顶上时会和胶囊同写一天，先不处理」。
- `docs/devlog/deferred.md:840` 那一条：状态改成已做（2026-11-02，裁决 171、票 124），写明与原方案的两处不同（最上面是今天不出现；减少动态下照留淡入淡出），原记录保留。

## 环境与边界

- 只在主会话建好的 worktree 里做（路径见派单），先 `pnpm --dir gui install`。不跑 `tauri dev`。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 引用匹配行时用 `grep`，不要用 `rg`（本机 `rg` 输出会改写搜索词）。本文件在开源仓库里：不写本机用户名路径、worktree 路径，报告里 scratchpad 写成 `<scratchpad>/…`。

## 回报

写在本文件末尾「## 报告」一节（同时把开头 `Status:` 改成 `needs-review`），并在最后一条消息里给主会话：

1. 改了哪些文件、哪几处；行的时刻怎么带、取哪条消息的时刻；「贴底那一下不算」用了哪个现成信号。
2. 截图路径（scratchpad），胶囊实测宽高与离顶距离。
3. 门禁命令与结果行（含两个时区）。
4. 设计文档与 deferred 改了哪几条。
5. 看到但没改的（Open risks），原样列出。
