# 93 三点下面那一行动起来：换句滚一行、「在做什么」慢扫光

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 137（2026-10-23；JC：「不做切换器，直接定 2，开始做」）。只改 GUI 与设计文档，不上切换器，JC 在 dev 里看。

## 为什么

- 主对话你发起的一轮在跑时，三点气泡下面有一行小字「{在做什么} · {用时}」（裁决 134、135，部件 `gui/src/components/conversation/TypingBubble.tsx` 的 `ProgressLine`）。JC 真机：「现在比较呆板没有动态，只有秒数变化是动的，前面一个长句子就是完全静态，稍微不够灵动」。
- 「在做什么」只在每一步派出工具时换（`gui/src/lib/assistant-progress.ts` 的 `assistantDoing`），约每十来秒一次，最长一步 40 秒一字不变；换的那一下是瞬间替换。所以要补两半：换句那一下有动静（滚一行），两次换句之间句子上也在动（慢扫光）。

## 要做的

1. **换句滚一行**（`ProgressLine` 的「在做什么」那段）：
   - 「在做什么」的字变了（与上一句不同才算；同一句重渲染不算），旧句往上滚出、新句从下滚进，各走一整行（18px，行高就是 18px），行框外的部分裁掉（这一段 `overflow: hidden`，`truncate-fade` 本来就是）。时长 `--motion-slow`，曲线 `--ease-firm`（`globals.css` 的 motion token；新代码不写 duration / easing 字面量）。
   - 第一次出现（随三点一起出来）不滚。「 · 用时」不滚，照旧每秒换数（`ProgressElapsed` 不动）。
   - 过渡期间这一段的宽度取新旧两句里宽的那个，滚完落到新句的宽度，「 · 用时」一步跟过去，不做水平滑动。宽度照旧受行宽上限（`ASSISTANT_BUBBLE_MAX`）约束。
   - 上一次还没滚完又来新句：从当前位置直接换到最新那句，不排队、不补放中间那句。
   - 离场那句 `aria-hidden`；新句在 `role="status"` 区里照旧被读出（区在 `TypingBubble` 根上）。
   - 截断渐隐照旧：只按屏上那句（新句）判是否截断（`truncationFadeRef` 的 `data-truncated` 是按元素 `scrollWidth > clientWidth` 判的，留意离场那句不要把它撑出误判）；悬停给全文照旧给新句（`syncTruncatedTitle`）。
   - 实现方式你定（Web Animations 或 CSS 类切换都行；`useTypingBubbleHandoff.ts` 用的是 Web Animations，可参考）。遵守 React 编译器 lint：effect 里不同步 setState、渲染期不读 `Date.now`（见 `docs/engineering-workflow.md` 或现有代码的做法）；需要「上一句」可用 guarded setState-in-render 或 ref + layout effect。
2. **慢扫光**：
   - 只扫「在做什么」那一段（「思考中」、步骤那句、「正在写回复」都扫），「 · 用时」不扫。
   - 新起一个类（名字你定，例如 `progress-shimmer`），放在 `gui/src/styles/globals.css` 的 `thinking-shimmer` 旁边，不改 `thinking-shimmer`（工作台思考行在用，`Conversation.tsx:1730`）。几何照抄 `thinking-shimmer`（`linear-gradient(90deg, A 35%, B 50%, A 65%)`、`background-size: 200% 100%`、`background-position` 200% → -200%、`linear`、`infinite`、`background-clip: text` 加 `-webkit-` 前缀、`color: transparent`）；颜色与周期改成：底色 `var(--color-ink-soft)`，光带中心 `var(--color-ink)`，周期 2.4s（B 类循环的周期按语义取值，不在 motion token 里，注释写清）。
   - 注释写清：比工作台淡（底色 `ink-soft` 而不是 `ink-muted`，幅度约一半）、慢（2.4 秒，工作台 1.4 秒与三点同一拍）；为什么允许（foundations §2.7 豁免一，主对话视图里只有这一处；主聊天 PRD 裁决 137）。
   - 与 `truncate-fade[data-truncated]` 的遮罩同时生效（遮罩作用在扫光之后，WebKit 支持；在 dev 里或用测试确认类名同时挂上即可）。如果滚动实现里同一时刻有两个元素（旧句、新句），两句都带扫光。
3. **减少动态**（`prefers-reduced-motion: reduce`，CSS 侧 `@media` 实时生效；JS 侧如需判断，每次读 `matchMedia`，不缓存，同 `lib/animate-scroll.ts`）：
   - 扫光关掉：`animation: none; background-image: none; color: var(--color-ink-soft)`（同 `thinking-shimmer` 的写法）。
   - 换句只淡出淡入、不滚：旧句原位淡出、新句原位淡入，同一时长与曲线。
4. **交接**（`gui/src/hooks/useTypingBubbleHandoff.ts:303` 起，那一行的拷贝原位淡出）：
   - 拷贝只带当前那句：克隆时若正有离场那句，从拷贝里去掉，宽度按当前那句。
   - 扫光接着原来的相位走，不从头跳：照同文件 `:285` 起三个点的做法（读原元素扫光动画已跑的时间，给拷贝设负的 `animation-delay`）；减少动态时没有扫光，不用管。
   - 别的交接逻辑不动。
5. **设计文档**（中文，标点全角，代码用反引号）：
   - `docs/design/conversation.md`「在跑时：三点气泡」一节：
     - 「三点下面那一行」的「写法」那条（约第 142 行）：把「不扫光、不动」改成本票的画法（换句滚一行、「在做什么」慢扫光、用时不滚不扫，数值与 token 写上），引用裁决 137。
     - 「为什么」那条（约第 127 行）末尾「这里是两样……不扫光」：改成现状（三点、扫光、跳秒三样，是 JC 按真机实感直接定的，裁决 137），保留 08-12 先例的来龙去脉。
     - 「交接」（约第 132 行）与「减少动态」（约第 138 行）各补一句本票的规则。
     - 「代价」（约第 159 行）补裁决 137 第 7 条的翻车点。
   - `docs/design/foundations.md` §2.7：
     - 豁免一的「豁免边界」（约第 643 行）「当前独占 thinking 行」改成两处各在自己的视图（工作台思考行、主对话三点下面那一行的「在做什么」）。
     - 约第 647–652 行那段（主对话三点气泡与那一行、「两样并列、不扫光」）：改写成现状，写清 10-23 先定不扫光、同日 JC 嫌呆板直接定扫光（裁决 137），三样同时动是有意接受的代价；保留 10-15 到 10-19 那一行用过扫光的历史。
   - 别处若还写着这一行「不扫光」「不动」，`grep -n "不扫光" docs/design` 一并改；`.scratch/` 下的 PRD 与旧票不改（主会话维护）。

## 测试

- `TypingBubble` 渲染：「在做什么」那段带扫光类，「 · 用时」那段不带。
- 换句：字变了才进入滚动状态，同一句重渲染不进入；第一次出现不滚；连续两次换句只留最新那句（可用 fake timers 或直接测你抽出的纯函数 / hook）。
- 离场那句带 `aria-hidden`，`status` 区里能读到的只有新句。
- 交接：克隆出的那一行不含离场那句（`useTypingBubbleHandoff` 现有测试旁加一条）。
- 现有 `TypingBubble`、`MainView.assistant.test.tsx`、`useTypingBubbleHandoff` 与 `assistant-progress` 相关测试照旧全过。

## 别动

- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- 「在做什么」的内容规则（`assistant-progress.ts` 的 `assistantDoing` 及其优先级）、用时的算法与字、行的位置与尺寸（`mt-1.5`、18px、12px、`ink-soft`、`ASSISTANT_BUBBLE_MAX`）、三点本身、侧栏卡片、顶栏、工作台思考行的 `thinking-shimmer`。
- `core/`、`runner/`、`managed-ga/`、提示词；`.scratch/` 下的 PRD（主会话维护）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过
- `CI=true pnpm --dir gui test` 全过，再 `TZ=UTC CI=true pnpm --dir gui test` 一遍
- `node scripts/check-docs-links.mjs`
- `git diff --check`
- 报告写在本票末尾「## Comments」下：改了哪些文件、怎么实现滚动与相位接续、没验证到的（例如真机上扫光与渐隐遮罩叠加的样子、四样一起动的观感）原样列出。
