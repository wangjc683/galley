# 123 往回翻不撞墙、不跳页：垫层接住补页，提前十屏补

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 170（诊断）与裁决 172（做法，修正 170 第 2 条）。只改 GUI 的对话分页滚动、它的测试与设计文档；不动 Core、CLI、Agent API、迁移、页大小（`MESSAGE_TURN_PAGE` 照旧 50）。所有对话一条分页路径：主对话、工作台、内置与外置运行时都生效；没有更早的页的对话零变化。

## 为什么（探针实测，dev 版，主对话两周约 30,480px、6 页）

- 现在离已加载内容的顶一屏才读上一页（`gui/src/hooks/useEarlierTurns.ts:13`），且要等第一次滚动（`:66` 的 `scrolled`）。
- 读一页 12–74ms；渲染一页时主线程停 150–280ms。macOS（WKWebView）的滚动不归主线程管，这段时间画面照样在滚；JC 往回甩每秒一万到三万多像素，起手那一下到五万。
- 补页后，`useLayoutEffect` 写 `scrollTop`，把读者那一行放回原位（`lib/scroll-anchor.ts` 的 `holdScrollAnchor`）。**惯性滚动途中这一笔会被 WebKit 的滚动线程按它自己的位置盖掉**：
  - 撞顶时 3 次都丢，画面落在新页的顶上，等于跳过一页；
  - 提前到离顶 6 屏补、不撞顶时，途中补的几次也全乱了：或闪一两帧更早的内容再跳回，或干脆跳过一页。
  - 停手时写 `scrollTop` 都没丢。
- **验证过的做法**：已加载内容上面垫一段空白（两万像素），补页时新页多高、垫层就缩多高，内容在文档里的位置不变，不写 `scrollTop`。途中补的 3 次，总高一像素没变、位置逐帧连续；失败的 2 次正好是不得不写 `scrollTop` 的两处（一页比垫层剩下的还高；最后收垫层）。
- 探针在主树里（`gui/src/zz-probe-t123.ts`，临时、不提交，你那边没有），垫层是它在内层栏 `firstElementChild` 上用 `style.marginTop` 模拟的。注意：第一次误把垫层加成滚动容器自己的 `padding-top`，滚动容器是 `absolute inset-0`、`border-box`，内边距一大整个盒子被撑高到两万多像素、画面全白——别加在滚动容器的内边距上。

## 要做到

1. **垫层**：会话还有更早的页（messages store 里这个会话的 `earlier` 不为 null）时，滚动容器里、已加载内容之上有一段空白垫层；从这一页渲染起就在（第一次渲染就带着，别等装好后再写 `scrollTop` 挪过去）。放在哪由你读 `MainView.tsx`（滚动容器 `:634` 起，内层栏 `:657` 起；主对话的内层栏是 `mt-auto`）与 `Conversation.tsx` 后定：不能成为 `[data-role="conversation"]` 的子元素（锚点按它的子元素找行）。高度改动要在补页那次提交的 layout 阶段同步生效（绘制前），所以按 ref 直接改样式，别走 React state 的重渲染。
2. **凡是靠写 `scrollTop` 把视口放回原位的，有垫层时改成缩放垫层**：
   - 补页那一次（`useEarlierTurns.ts` 的 `useLayoutEffect`）；
   - 补页后 1.5 秒内的晚到排版（同一处的 `settle`）；
   - 删除消息让上面变矮（`useRemovedTurnsAnchor.ts` → `holdFirstScrollAnchor`）。

   修正量照现有的 `anchorCorrection` 算：上面长高了 `d`，垫层缩 `d`；上面变矮了，垫层长回 `d`。
   - 垫层不够缩（`d` 大于垫层高度）：垫层缩到 0，剩下的照旧写 `scrollTop`。
   - 没有垫层（没有更早的页）：照旧写 `scrollTop`，行为与现在一模一样。

   建议把「放回原位」收成一个函数，由它决定缩垫层还是写 `scrollTop`，三处共用；接口放 `lib/scroll-anchor.ts` 或新文件，你定。
3. **离顶十屏就补，打开稳定后不等滚动**：触发条件改成「视口顶离已加载内容的顶（扣掉垫层）不到 10 屏」（10 个 `clientHeight`）。打开对话稳定后（会话切换后的贴底、恢复读完；照 `useEarlierTurns.ts` 现有注释说的原因，用现成信号判断，别另造计时），不等第一次滚动就按这条检查一次。主对话打开后会因此先补一页。
   - 照旧一次只读一页、读完再看（现在 `.then(() => requestAnimationFrame(check))` 的连锁）；
   - 照旧不在 `restoring` 时读；
   - 补页落在气泡动效途中的处理（`settleBubbleMotion`）照旧。
4. **停手时把垫层补回目标高度**：200ms 没有滚动事件（惯性结束也就不再有滚动事件）、还有更早的页、垫层低于目标时，把垫层补回目标，同时写 `scrollTop` 加上补的量，让内容不动。停手时写是可靠的。
   - 目标：20,000px 与「这个对话本次挂载里见过的最高一页的两倍」取大。一页的高度就是补那一页时垫层缩掉的量。
   - 只在不跟随底部时补；在底部本来就没事，补了也不影响贴底，你核一下。
5. **最后一页插上后收掉垫层**：`earlier` 变成 null 后，等停手（同第 4 条的 200ms），把垫层收到 0，同时写 `scrollTop` 减掉同样的量，让内容不动。读者正停在垫层里（视口顶在内容之上）时，收掉后落到最顶。
6. **用到滚动长度或 `scrollTop` 的地方都要对垫层核一遍**：`grep -rn "scrollTop\|scrollHeight" gui/src --include='*.ts' --include='*.tsx'`（不要用 `rg`），逐个判断要不要扣掉垫层，报告里列一张表（文件:行、做什么、要不要扣、改了没有）。已知要改的：
   - 工作台的问题轨（`components/conversation/UserQuestionRail.tsx` 约 `:314`）：按 `scrollHeight` 的比例摆点，要改成按已加载内容摆；
   - `useEarlierTurns.ts` 自己的「页太短」判断。

   已知不受影响：贴底、跟随、「回到底部」，这些按离底距离算；⌘K 定位、⌥↑ / ⌥↓，这些按元素位置算。也请核实。
7. **页大小、Core、CLI 不动**。170 第 2 条第③条「顶端不回弹」不做。

## 别动

- `MESSAGE_TURN_PAGE`、Core 的分页读法、`loadEarlierTurns` 的读法与去重。
- 贴底、跟随、落地动画（裁决 138）、`animateScroll` 的规则。
- 票 124 在并行做「主对话往回翻时顶上浮一颗日期胶囊」：它在 `MainView.tsx` 对话区顶部加一个浮层，给 `Conversation.tsx` 的行带上时刻，会用到 `firstRowBelow`。你别改 `firstRowBelow` 的签名与语义，`MainView.tsx` 的改动尽量局部，方便之后 rebase。
- 主工作树（JC 的 `tauri dev` 在那里跑着）。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run src/hooks src/lib/scroll-anchor src/components/conversation src/stores/messages
TZ=UTC pnpm --dir gui exec vitest run src/hooks src/lib/scroll-anchor src/components/conversation src/stores/messages
pnpm --dir gui test        # 全量 vitest，收尾前跑一次
git diff --check
```

- **测试**（jsdom 不排版，量法做成可注入或 mock `getBoundingClientRect` / `scrollHeight`，参照现有 `useEarlierTurns`、`scroll-anchor` 的测试与 `src/test/scroll-frames.ts`）：
  - 放回原位：有垫层时只缩垫层、`scrollTop` 不被写（断言 setter 没被调用）；垫层不够时缩到 0、剩下的写 `scrollTop`；上面变矮时垫层长回；没有垫层时与现在一致。
  - 触发：离已加载内容的顶（扣垫层）9 屏触发、11 屏不触发；打开稳定后不滚动也会补；`restoring` 时不补。
  - 停手补回与收掉：假时钟下 199ms 不动、200ms 动；补回时 `scrollTop` 同步加；`earlier` 变 null 后停手收掉、`scrollTop` 同步减；读者在垫层里时落到 0。
  - 问题轨扣掉垫层后点位不变。
  - 没有更早的页的对话：DOM 里没有垫层，行为与现在逐项一致。
- 真机由主会话做：合入后 JC 在 tauri dev 里用同一个探针再甩一遍对比。你不跑 `tauri dev`。
- 中文（报告、设计文档）用全角标点，收尾前自己扫新增行（脚本放 scratchpad，用 `t123-` 前缀）。`gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；状态归零用 guarded setState-in-render，工具函数别从组件文件导出。

## 文档

`docs/design/conversation.md`「长对话按轮分页（2026-10-13）」一节的「往上翻自动加载」（`:869`）改写：10 屏、打开后先补、垫层（为什么：探针数据与 WebKit 惯性滚动途中盖掉 `scrollTop` 的事实，写数不写本机路径）、停手补回与收掉、单页高过垫层的退路、滚动条多算的代价；「真机看出停顿再议」改成已在 2026-11-02 再议（裁决 170、172，票 123）。如果「不做：虚拟列表」那条要补一句为什么垫层不算虚拟列表，就补。

## 环境与边界

- 只在主会话建好的 worktree 里做（路径见派单），先 `pnpm --dir gui install`。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 引用匹配行用 `grep`，不要用 `rg`。本文件在开源仓库里：不写本机用户名路径、worktree 路径，报告里 scratchpad 写成 `<scratchpad>/…`。

## 回报

写在本文件末尾「## 报告」一节（开头 `Status:` 改成 `needs-review`），并在最后一条消息里给主会话：

1. 改了哪些文件、哪几处；垫层放在哪、为什么；「放回原位」的函数接口。
2. 第 6 条的表。
3. 门禁命令与结果行。
4. 设计文档改了哪几条。
5. 主会话真机复测时该盯的点（你认为最可能出问题的两三处）。
6. 看到但没改的（Open risks），原样列出。
