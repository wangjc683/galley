# 131 回复下的卡片：宽度与高度的临时切换器

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 180。只改 GUI，而且是临时的：一个只在 dev 版出现的切换器，JC 在 `tauri dev` 里比完，另开票把选中的一档写定、拆掉切换器。生产包画现状，不带切换器的任何代码路径。只影响内置运行时（外置运行时没有主对话，工作台不画这些卡片）。

## 为什么

主对话一条回复下面挂五种卡片（`gui/src/components/screens/MainView.tsx:713-746`：文件、子任务、待办、提醒、备忘，次序如此）。它们都包在 `gui/src/components/conversation/Conversation.tsx:621` 的 `<div className={ASSISTANT_BUBBLE_MAX}>` 里（`max-w-[88%]`，`AssistantParts.tsx:23`）。块级元素默认撑满，所以每张卡片都和气泡上限一样宽：紧凑栏 669px，宽松栏 1056px。字本身很短：子任务标题「创建科学知识文档」连图标与内边距 158px，「制作76人赛季战况网页」186px，紧凑栏里空 72–76%；文件卡片 332px、420px。JC 嫌空白太多、卡片偏大。

## 要做到

一个临时切换器，三组开关，比较五种卡片的宽度与高度。

1. **宽度**（四档，按这个次序排在 pill 上；默认乙）：
   - **现状**：同现在，逐像素不变（包括文件卡片悬停时右端让位）。
   - **甲 随字宽**：每张卡片只有自己的字那么宽，左对齐；上限照旧是气泡上限，超了照旧省略（文件名中间截、标题尾部截）。
   - **乙 同组同宽**：同一条回复下的所有卡片一样宽，取其中最宽那张的字宽，上限照旧是气泡上限。提示：给 `Conversation.tsx:621` 那个外壳加 `width: fit-content`（`w-fit`）时，里面块级的卡片会自然撑到最宽那张；核实各卡片里 `flex-1`、`truncate`、`max-w-[45%]` 在 fit-content 下照常截断。
   - **丙 固定 320**：每张卡片 320px（`max-width: 100%` 兜底），左对齐。
   - 图片缩略图（`FileCards` 的 96px 那一排）四档都不变。
   - **文件卡片的「在文件夹中显示」**（`FileCards.tsx:229-231` 悬停时 `pr-11` 让位，`:256-265` 那颗按钮）：甲、乙两档里卡片不再为它让位（不能出现悬停一下卡片或整组变宽），按钮浮在卡片右边外侧、垂直居中；从卡片移到按钮的路上悬停不能断（按钮仍在 `group/file-card` 里面，中间不要留出不算悬停的缝）。丙宽度固定，照现状在里面让位即可。
   - **子任务在卡片里答提问**（裁决 101 的兜底，`SubtaskCards.tsx` 的 `answering`）：甲、乙、丙里这一张（乙是这一组）撑到气泡上限，提问气泡与输入框不能被挤窄。演示不必覆盖这一种，但要有测试或静态核对。
2. **高度**（两档；默认 40）：
   - **40**：同现在（`min-h-10 py-1.5`）。
   - **32**：五种卡片都是 32px（含提醒卡片带「取消」的那张，`ReminderCards.tsx:108-109` 的注释要求有没有「取消」一样高；`ui/button.tsx` 的 `sm` 是 `py-1 text-[12px]`，在 32 里放不下就在这一档里把它压到放得下，比如 `h-6`）。水平内边距、图标列、字号不变。
3. **状态**（三档；默认真实）：只改子任务卡片显示的状态，内存里，不写库、不发 IPC：
   - **真实**：照 store。
   - **在问你**：每条回复下的第一张子任务卡片画成在问你（「等你回复」），其余画成在跑。
   - **出错**：第一张画成失败（「出错」，悬停原因写一句虚构的，比如「出错：网页打不开」），第二张画成没有跑完，其余画成在跑。
   - 目的：JC 现在的对话里两张子任务都已做完，要看到右边的短词出现时乙那一组变宽多少，以及 179 还没真机看过的在跑、在问你两种样子。走 `subtaskCardWord` / `CardIcon` 的真实画法，不要另画一套。
4. **pill**：常驻、可点、写着各档名字、当前档高亮，放在窗口右下角；`createPortal` 到 `body`、行内 `pointerEvents: "auto"`、`z-index` 1000。三组之间用细分隔。选择存 `localStorage`（读写都包 try/catch），重载后还在。参照票 128 的切换器：`git show df8c956c:gui/src/dev/subtask-rows-trial.tsx`（pill 与 portal 的写法）、`git show a9034331:gui/src/dev/subtask-rows-trial.tsx`（之后加的一档）。
5. **只在 dev 版**：所有试验代码放在一个新文件 `gui/src/dev/reply-cards-trial.tsx`（可以再配一个同前缀的 CSS 或测试文件）；接入点只用 `import.meta.env.DEV` 判断，生产包画现状、摇树后不带这些代码。推荐的做法：pill 把当前档写到 `<html>` 的 `data-*` 属性上，再用一段**不进 Tailwind 层**的 `<style>`（不分层的样式压过 Tailwind 的 utilities 层，票 128 就这样做）按 `data-role` 改宽度、高度、文件卡片按钮的位置；为此可以给 `Conversation.tsx:621` 的外壳加一个永久的 `data-role="reply-cards"`。演示状态需要在 `SubtaskCard` 里加一个 dev-only 的钩子，越小越好。文件开头的注释写清：这是什么、每一档是什么、拆除步骤（删哪个文件、撤哪几处接入、选中某一档时要写进哪些组件哪些类）。
6. **量**（vitest 的 jsdom 不排版，宽度要在真的排版里量）：用真 Tailwind 产物、真字体做一次性静态页，playwright 无头 Chrome 量（`playwright-core` 可借 `~/Documents/top-plaza/node_modules`，在 scratchpad 里建软链接；`chromium.launch({ channel: "chrome" })`）。量：紧凑栏（760）与宽松栏（1200）下，四档宽度 × 两档高度，下面四张卡片的宽与高：子任务「创建科学知识文档」「制作76人赛季战况网页」（同一条回复下两张、做完），文件「GPS 为什么必须考虑相对论.docx」在 `~/Downloads`、「费城76人_2026-27赛季战况_截至2026-11-03.html」在 `~/Desktop`（各自一条回复）；再量一张带「取消」的提醒卡片在 32 档的高度；悬停文件卡片时甲、乙两档卡片宽度不变。这些都是虚构展示用的字，路径里不要出现真实的用户目录名，静态页与脚本都放 scratchpad、不进提交，文件名带 `131` 前缀（scratchpad 是共用的，别覆盖别人的脚本）。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
pnpm --dir gui build
git diff --check main...HEAD
```

- 新 worktree 先 `pnpm --dir gui install`。
- `pnpm --dir gui build` 之后在 `gui/dist` 里 grep 切换器的特征字串（比如 pill 上的「同组同宽」），确认生产包不带它。
- 长命令在前台跑，别交给后台任务（后台跑完不会叫醒你）。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只管自己的 hunk。
- React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error。
- 静态渲染测试读不到测试里塞进 zustand 的值；要测的逻辑放进纯函数测。
- 中文全角标点：在 scratchpad 写 `cjk-punct-131.py`，扫新增行（注释里的中文、pill 上的字）。

## 别动

- 只在 worktree 里改，绝不碰主工作树；不跑 `tauri dev`、不跑 `galley` 命令、不读写用户的应用数据目录。
- 现状档必须和现在逐像素一样；过程卡片（`AssistantProcessCard`）、回复气泡、行动条、侧栏、待办面板不动。
- 卡片的状态判定（`lib/subtasks.ts` 的 `deriveSubtaskCard` 等）、文案、i18n 不动；pill 上的字是 dev 临时字，直接写中文，不进 locale。
- 不改 `docs/design/`：写定是下一张票的事。

## 提交与回报

- 在 worktree 分支上提交，只点名本票文件，禁用 `git add -A` / `git commit -a`；英文说明，第一行写明 TEMP 切换器与票号，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，命令后接 `git log --oneline -1`，提交号只抄输出。
- 报告：①改了哪些文件 ②提交号 ③每条验证命令与结果 ④「量」那一步的表（档位 × 卡片 → 宽、高） ⑤偏离票面的地方与理由 ⑥看到没改的 ⑦Open risks。
