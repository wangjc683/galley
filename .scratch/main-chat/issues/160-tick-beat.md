# 160 勾下去那一拍：方框按下、画勾、弹一下，待办的删除线从左划到右

Status: done（2026-11-11 随 v0.7.8 发出；JC 没在 dev 里看，冒烟时在安装包上勾过一件、没有提意见，「冒烟测试通过，发布」；连着勾几件、对话框里的方框没有单独报，记在 project-status 的「Owed from the v0.7.8 smoke」）

来源：[主聊天 PRD](../PRD.md) 裁决 208 第 2 条（JC 2026-11-11：「方框的按下与画勾进共用的 Checkbox，幅度直接做中档」）。只改 GUI 与设计文档。不碰 Core、CLI、手册、评测。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」、`docs/design/foundations.md` §2.5（按钮的键程、过渡属性表的规矩）与 §2.7（A 类动效、减少动态「只淡不移」）、`docs/design/conversation/reply-cards.md`「待办面板」里「勾掉与取消勾」「勾掉的样子」两条。

## 为什么

现在勾一件待办，方框的填色与对勾在同一帧出现，方框没有按下感（`gui/src/components/ui/checkbox.tsx` 的方框没有任何过渡）；删除线一帧出现，只有字色走 `--motion-base`（`gui/src/components/todo/todo-styles.ts` 的 `todoTitleClass`）。勾完之后特意原位停 1.5 秒让人看清，可是没有东西可看。§2.7 把这类反馈列为 A 类：「追求扎实的物理真实质感」。

## 要做的

### 一、共用的方框（`gui/src/components/ui/checkbox.tsx`）

全应用只有这一个方框，待办、子项、归档、编辑项目对话框、Markdown 任务项都用它。下面的规则对所有用处生效，不加开关。

1. **按下**：没禁用的方框，指针按住时（`:active`，按在方框或它的标签上都算）缩到 0.9（16px 的框缩约 1.6px，14px 的约 1.4px），`--motion-press`、`--ease-firm`。照 §2.5 按钮的规矩：过渡只写在 `:active` 上，基础态没有过渡，松手一步回到 1；属性表里写 `scale`，不许写 `transform`（`gui/src/styles/transition-properties.test.ts` 守着）。
2. **勾上**（`checked` 在挂载之后由假变真的那一下，不管是谁勾的）：
   - 填色与描边：`--motion-fast` 过渡到勾上的颜色（品牌色或 `quiet` 的灰）。
   - 对勾：从左到右露出，`--motion-base`、`--ease-firm`（用 `clip-path` 或同效的办法，图标仍是 Phosphor 的 `Check`，不换图）。
   - 框弹一下：scale 1 → 1.12 → 1（16px 的框最大约 17.9px，每边约 1px），`--motion-slow`、`--ease-spring` 或同手感的关键帧，一次，不循环。
   - 这三样同时起步，全程不超过 `--motion-slow`（240ms）。
3. **取消勾**（由真变假）：填色 `--motion-fast` 退回，对勾直接不见，不弹。
4. **挂载时已经勾着的不放**：清单载入、展开「已完成」、回复下的卡片挂载、翻历史、Markdown 里的 `- [x]`，都是静止的勾。待办从最上面那一段落进「已完成」时方框是另一个实例（品牌色换成灰），那一下不放。
5. **减少动态**（`prefers-reduced-motion`）：按下不缩、不弹、对勾不扫；颜色的过渡可以留。
6. 静止时的样子（尺寸、颜色、聚焦圈、悬停描边、禁用的 40%）与现在逐像素相同。

「挂载之后才变」怎么判断由你定（比如记住上一次的 `checked`）。React 编译器的 lint 规则要过：effect 里不同步 `setState`，渲染期不读 `Date.now()`，状态归零用带守卫的渲染期 `setState`，工具函数不从组件文件导出。

### 二、待办的删除线（`gui/src/components/todo/todo-styles.ts` 与用到 `todoTitleClass` 的标题）

1. 线在挂载之后出现的那一下（勾掉；回复下的卡片写成「已删除」「已跳过」时也是同一条线），从左划到右，约 200ms、`--ease-firm`，在对勾露出之后起步（延后约 `--motion-base`）。字色照旧 `--motion-base` 从 `ink` 走到 `ink-muted`。
2. 标题有几行时（打开的一件），一行接一行划，总时长不变；WebKit 里做不到就几行同时划，写进回报。
3. 线不见的那一下（取消勾、撤销）照现在：一步不见，字色过渡回来。
4. 挂载时已经划着的不放（同上面第 4 条）。
5. **静止后与现在逐像素相同**：划完之后是现在那条真删除线（`line-through`，满色、跟字的颜色）。划的过程多半要用一条假线（渐变背景之类），它的粗细与位置要对上真线，交接时不能跳。对不上（WebKit 里常差 1px）就退成：真删除线的颜色从透明淡入（`text-decoration-color`，`--motion-base`），不划，并在回报里写明为什么。
6. 减少动态：没有过渡，线一步出现（同现在）。
7. 用到 `todoTitleClass` 的地方：`TodoPanel.tsx`（你的行、已完成的行）、`TodoSubitems.tsx`（子项）、`conversation/TodoCards.tsx`（回复下的卡片）。标题需要多包一层行内元素时只加这一层，别动行的结构。标题是按钮时悬停下划线的规则（`hover:decoration-ink-muted/60`）不变。
8. 提醒卡片、备忘卡片的划线不走 `todoTitleClass`，这张票不碰。

### 三、样式放哪

关键帧与类写在 `gui/src/styles/globals.css`，挨着 `todo-catch-pop` 那一段后面，自带一段 `@media (prefers-reduced-motion: reduce)`，不要往文件后面那张共用的减少动态名单里加行：票 161 同时在这个文件里加自己的一段，各写各的免得冲突。

### 四、设计文档

- `docs/design/foundations.md` §2.5：加方框的按下与勾上（数值、只在挂载之后变的那一下放、减少动态）。只动 §2.5，§2.7 有别的票在改。
- `docs/design/conversation/reply-cards.md`「勾掉与取消勾」里「删除线与淡化本身用 `--motion-base`」那一句，与「勾掉的样子」：照现状改，写明 2026-11-11、票 160、裁决 208，原来的写法留成「此前」。这两条由你改；票 161 在这份文档里只新增自己的一条，不改这两条。

## 别动

- `stores/assistant-todo.ts` 的勾与停留的时序（1.5 秒、什么时候交给 Core）；`TodoCheck.tsx` 的逻辑。
- 行的结构、行高、悬停的按钮、「已完成」的灰方框规则（裁决 129）。
- `TodoPanel.tsx` 里清单与分组的部分：票 161 同时在改（行的离开与合拢），你只碰标题那几处。
- 提醒卡片、备忘卡片；`MarkdownView.tsx` 的任务项怎么渲染（它用这个方框，跟着变是对的，但别改它自己）。
- `.scratch/main-chat/PRD.md` 与别的票。主工作树；不跑 `tauri dev`。
- `gui/` 现有文件只格式化自己的 hunk。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui test
node scripts/check-docs-links.mjs
git diff --check
```

测试至少覆盖：挂载时已勾的没有动效的类；由假变真才有、由真变假没有弹；禁用的没有按下；`quiet` 色调照旧；标题的线在挂载之后出现才带划的类、挂载时已划的不带；`transition-properties.test.ts` 照过。新增的中文行扫半角标点（脚本放 scratchpad，文件名带 `t160-` 前缀）；新增行不许有本机路径。

## 回报格式

照 dispatch「The report has four parts」。另外：假线是怎么做的、有没有退成淡入、为什么；多行标题怎么划；「挂载之后才变」怎么判断的；Markdown 任务项是不是能点（能点的话勾上会放动效，写一句）。

## 真机步骤

只动 `gui/`，合入后 dev 热更新。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 在 dev 真窗口用探针量第一帧：按下的缩放、弹的峰值、假线与真线交接处有没有跳 1px；展开「已完成」、切页签、重载后已勾的不放；减少动态下不动 | 按下去的手感、弹的大小（嫌大嫌小改常量）、线划过去顺不顺；归档与编辑项目对话框里的方框跟着变了，看着合不合适 |

## Comments

### 2026-11-11 主会话验收

- 读了 `git diff main...ticket/160-tick-beat` 全部 hunk；在票的工作树里 rebase 后跑门禁：`typecheck`、`lint` 通过，`TZ=UTC` 测试 269 个文件、3081 个全过，文档链接与 `git diff --check` 干净。
- **删除线没有从左划到右，退成了淡入**（裁决 208 第 8 条的退路，JC 2026-11-11：「四处补法保留」）。代理在离屏 WebKit 里量：假线（背景画的）与真删除线的取整方式不同，4 个字号 × 8 个亚像素位置的 32 种组合里，2x 屏 18 种、1x 屏 21 种差一个设备像素，加固定偏移也消不掉；卡片在对话里常落在小数像素上，交接必跳。现在是真线的颜色在对勾露出后淡入，几行的标题一起淡入。
- 票面前提不对的一处：Markdown 的任务项不用共用方框（`MarkdownView` 自己画只读的），不跟着变。
- 代理报的风险，原样记下：
  - 这一拍里（约 0.4 秒）方框的悬停描边也跟着走 120ms 过渡，之后恢复瞬时。
  - 摘掉动效类的两个时间是写死的数（方框 400ms、删除线 500ms），改 token 时要一起改。
  - 弹的途中再点一下取消勾，缩放一步回到 1，最多约 1px 的跳。
  - 弹的 240ms 内再按，没有按下的过渡（这一拍的类盖过了 `:active` 的过渡）。
  - 与票 161 叠在一起：勾下后 0.4 秒内那一行被挪动时动画可能重放一次（停留是 1.5 秒，正常走不到）。
- 票外发现：「已完成」里有挂处的标题是按钮，悬停时 `hover:underline` 可能顶掉删除线（按 CSS 推断，原来就有，没在真窗口看）。

### 2026-11-11 主会话 dev 真窗口逐帧量（2x 屏，探针脚本点方框）

- 勾上：点下去后下一帧带上 `checkbox-tick`；框的缩放逐帧 1.054、1.087、1.108、1.118、1.121（约 85ms 到峰值，16px 的框最大 17.9px），约 235ms 回到 1，回位时低过 1 约 0.1%（看不见）；对勾约 170ms 露完；填色约 120ms 走到品牌色。
- 删除线：对勾露完那一帧起从透明淡入，约 150ms 到满色；字色同时从 `ink` 走到 `ink-muted`。动效类约 0.4 秒（方框）、0.5 秒（标题）后摘掉。
- 展开「已完成」：一帧多出 6 行，没有任何动效类、没有动画。
- 没量到的：按下的缩放（脚本点击不触发 `:active`，只有离屏 WebKit 的读数）；减少动态；取消勾。
