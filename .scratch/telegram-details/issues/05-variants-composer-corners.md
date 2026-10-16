# 05 切换器：输入框长高动画、主对话连发组内圆角

Status: merged（2026-10-16 合入 main，`00ae635c`、`ad1a581d`，合并提交 `8be9a089`；等 JC 在 `tauri dev` 里切档裁决）

来源：[PRD](../PRD.md) 裁决 6（2026-10-16，JC：「6，按推荐比」）。只改 GUI。纯视觉，做临时切换器进 `tauri dev` 真机比，JC 裁决后拆掉切换器、留下选中的档。
独立子代理做，与 01–04 并行。

## 两个维度（彼此独立，各自一组档位）

### A. 输入框长高的动画（两边同一个输入框）

- 现状：随内容瞬间长高，8 行后在框里滚动（`composer-styles.ts:77-85` 一带）。
- Telegram 两端同一个公式：高度动画时长 `50 × ln|Δh|` ms（多一行约 150ms，48px 涨满到上限约 240ms），ease-out（Web A `src/components/middle/composer/MessageInput.tsx:288-326`；Web K `src/components/inputFieldAnimated.ts:75-80`）。
- 档位（从最克制排起）：
  1. 现状：瞬间。
  2. 固定 100ms ease-out。
  3. 按距离：`50 × ln|Δh|` ms ease-out。
- 长高、变矮（删字、发出后缩回一行）都走同一档。
- 保持贴底（票 27，`lib/viewport-resize.ts`）：对话在底部时，输入框长高的每一帧对话都贴底，别出现最后一条被压到输入框下面、然后跳回来。改完在 Comments 里写怎么确认的。
- 减少动态效果时一律瞬间。

### B. 主对话连发的组内圆角（只主对话）

- 现状：同一边连发的气泡间距 4px（`lib/assistant-conversation.ts:72-78`），每一颗都是 12px 全圆角（`MessageUser.tsx:337`、`AssistantParts.tsx:46-47`）。
- Telegram：一组里靠发送者一侧、挨着组内邻居的角变小（Web A 大 15px、小 6px，`src/components/middle/message/Message.scss:164-183`）。首条：下方那个靠自己一侧的角小；中间：靠自己一侧上下两个角都小；末条：上方那个靠自己一侧的角小。外侧（远离发送者一侧）始终大圆角。我们没有尾巴，末条的下角保持 12px。
- 你的气泡靠右，小角在右侧；助手气泡靠左，小角在左侧。
- 「一组」= 同一边、中间只隔 4px 连发间距的相邻气泡；时间条、换边都断组。按 `assistant-conversation.ts` 里已有的分组 / 间距规则认，别另写一套。
- 档位（从最克制排起）：
  1. 现状：全 12px。
  2. 组内小角 8px。
  3. 组内小角 6px。
  4. 组内小角 4px。
- 禁令照旧：不加尾巴、不加边框投影（`conversation.md:53/78`）。
- JC 的主对话里可能没有现成的连发：Comments 里写一句怎么造（例如在跑时连发两条，或说一段话后马上再补一句）。

## 切换器

- 一颗常驻、可点的小 pill（固定在主区角落，不挡输入框、不挡问题轨），点开选 A、B 各自的档位；比 Radix 菜单内部时 pill 要 portal + `pointer-events: auto`。选择存 localStorage（try/catch），刷新后保持。
- 切换器与档位代码集中、好拆：JC 裁决后一个提交拆掉切换器、把选中的档写死。
- 不进 i18n 文案（临时 UI），代码里标 `TEMP variant switcher (telegram-details 05)`。

## 验收

- typecheck、lint、相关单测过；截图（各档）写进 Comments。
- 合入 main 后 JC 在 `tauri dev` 里切档比，裁决进 PRD 与 devlog。

## Comments

### 2026-10-16 实现（子代理，分支 `td-variants`，提交 `00ae635c`）

**做了什么**

- 切换器：MainView 里一颗常驻 pill，portal 到 `<body>`、`pointer-events: auto`、z 1000；挂在顶栏下面、离窗口右缘 48px（`right-12 top-[50px]`），闭合时写「临时 · A1 B1」（开着演示时后面加「· 演示」），点一下展开面板：A 三档、B 四档、「演示连发」，再点收起。离右缘 48px 是为了让开工作台的问题轨（离右缘 12px、宽 20px），输入框、回到底部都碰不到。选择存 localStorage `galley.tmp.tdVariants.grow / corners / demo`（读写都包了 try/catch），刷新后保持。默认 A1、B1、演示关，与现在一模一样。临时 UI 不进 i18n。
- 代码集中在 `gui/src/components/conversation/td-variants/`（`td-variants.ts` 存档位与拆法、`TdVariantsPill.tsx`、`td-demo.ts`、测试）；A 的做法在 `gui/src/lib/composer-grow.ts`，B 的规则在 `gui/src/lib/assistant-conversation.ts`（`assistantJoinsGroup`、`assistantGroupCornerClass`）。接入点 4 处，都标 `TEMP variant switcher (telegram-details 05)`：MainView 的 pill，Composer 自动长高 effect 开头两行，Conversation 的演示替换与 `withCorners` / `lastLineRow`。

**各档的确切数值**

A，输入框长高（会话里的一行式，主对话与工作台都是；新对话空状态的大卡片不在内）：

| 档 | 时长 | 缓动 |
|---|---|---|
| A1（现状） | 瞬间：`height: auto` 量 `scrollHeight` 再写回 | 无 |
| A2 | 固定 100ms | CSS `ease-out`，即 cubic-bezier(0, 0, 0.58, 1) |
| A3 | `round(50 × ln Δh)` ms（Δh 取绝对值）：多一行（Δ 约 22px）155ms，一行到三行（Δ45）190ms，一行到八行或发出后从八行缩回（Δ157）253ms | 同上 |

- 长高、变矮同一档；Δ 不到 1px 不动；减少动态效果时一律瞬间；输入框刚挂载（进会话）时第一次定高是瞬间。半路又多一行，从当前高度接着走，不跳回也不跳前。
- 量高不再把真输入框收成 `auto`：在它旁边放一个看不见的副本（零高、`contain: strict`、`inert`、`aria-hidden` 的盒子里，克隆真输入框的 class 与内边距），读副本的 `scrollHeight`。没到 8 行上限时输入框 `overflow-y: hidden`（长高途中不出滚动条），到上限照旧框里滚动。

B，主对话连发的组内圆角（工作台不受影响）：B1 全 12px（现状）；B2 组内小角 8px；B3 6px；B4 4px。小角是靠自己一侧、挨着组内邻居的角：首条下角、中间上下两角、末条上角；你的在右（右上、右下），它的在左（左上、左下）。外侧与末条的下角始终 12px，不加尾巴、边框、投影。Chrome 里读到的计算值（左上 右上 右下 左下）：B3 三连发依次是 `12 12 6 12`、`12 6 6 12`、`12 6 12 12`。

**组内圆角怎么认组**

用的就是 `assistantRowGap` 那条：从里面抽出 `assistantJoinsGroup(previous, side)`（`previous === side`，也就是给 4px `mt-1` 的那个条件；回复带行动条记作 `agent-bar`，不算同一边），再加「中间没画别的」：你的消息看断点时间条（`pinnedTimes`），它的行看问候与报告轮的时间条，和现在决定 `mt-5` 的条件是同一组。下一条接不接得上，要画到下一条才知道，所以接上时把上一条带 `below` 再画一次（`lastLineRow`）。圆角是挂在行容器上的 class（如 `[&>[data-role^=user-msg]]:rounded-tr-(--bubble-group-radius)`），半径是切换器写在根元素上的 CSS 变量；B1 时一个 class 都不加。

- 发现：按这条规则，它那一边在实际对话里不会成组。回复下面是行动条（30px），下一条从它下面起；只有它问你的问题后面直接跟着它的另一行、中间没有你的回答时才是 4px，正常对话里不出现。所以 B 实际上只改你这一边；左侧的小角照规则做了、有测试，真机看不到。
- 长消息（超过 6 行）在主对话里气泡下面有「展开」那一行，它在组中间时下角照样变小（规则只看间距）；Supervisor 来源的图标行同理。主对话里少见，没加例外。

**怎么在 JC 的主对话里造一组连发**

- 最省事：pill 里点「演示连发」。主对话换成一段固定的演示（只显示，不发、不存，当作没在跑）：一组三条、一组两条（第二条两行）、一条单独的。再点一下回到自己的对话。
- 造真的：票里写的「在跑时连发两条」「说一段话后马上补一句」造不出来：在跑时发的那条进队列，Core 等这一轮结束才发出、单独跑一轮（`core/src/message_queue.rs:11-16`，每个 RunComplete 发一条），中间隔着回复。能成组的是「上一条没有回复」：发一句，趁第一步还没落地（JC 主对话里第一条回复都在 5 秒以后才落库）点停止，再发一句。停止不落库任何一步（`runner/workbench_bridge.py:1718`，GA 的 abort 不触发 turn_end）。或者：发一句、马上再打一句回车排进队列、立刻点停止，停下后排队那条自动发出，两条挨着。代价：这几句留在主对话里，GA 的上下文里也有。
- 现状：JC 的主对话（37 行，含问候）里没有连着的两条你的消息；整个库里只有 5 处，都在工作台。

**怎么确认长高时每一帧都贴底**

1. Chrome 实测（会话草稿目录里的 harness：真的 Conversation、一行式 Composer、`useStickyScroll`，按 MainView 的排法；没开 tauri dev）。在 `useStickyScroll` 之后再挂一个 ResizeObserver，它在同一帧里排在贴底那个后面、绘制之前，读到的就是画出来的样子；另挂一个 scroll 监听，读 `useStickyScroll` 判「在底部」时读的那个离底距离。主对话、工作台各跑一遍：

   | 情形 | A1 | A2 | A3 |
   |---|---|---|---|
   | 多一行（48 → 70） | 1 帧 | 8 帧，约 120ms | 11 帧，约 170ms |
   | 贴一整页（48 → 205） | 1 帧 | 6 帧，约 110ms | 16 帧，约 263ms |
   | 三行发出后缩回（93 → 48） | 1 帧 | 8 帧，约 124ms | 14 帧，约 216ms |

   所有档、所有情形，每一帧对话离底 0px，滚动事件里读到的离底也都是 0（「在底部」没翻成过 false，回到底部按钮不会闪）；最后一条离输入框上沿 24 ± 1px（对话区的 `py-6`，工作台你的消息下面再加 30px 的行）。往上翻着时打字长高，scrollTop 不动（主对话 35 → 35，工作台 60 → 60）。减少动态效果下 A3 也是 1 帧。
2. 发现与改法：一开始照 Telegram 用 CSS transition，A2 贴一整页（100ms 涨 157px，一帧最多约 45px）有一帧没贴底，对话低了 17px。原因：浏览器在一帧开头就把 transition 推进了，上一帧贴底留下的滚动事件这时才读离底距离，读到超过 24px 就判成「翻上去了」，`atBottomRef` 晚一帧跟上，下一帧贴底被跳过。改成 requestAnimationFrame 逐帧写高度后，高度只在帧回调里变，滚动事件读的是上一帧贴好底的样子，上面那张表就是改后的。A3 按 60 帧算一帧最多约 17px，用 transition 一般撞不上，但两档用同一套。
3. vitest：`composer-grow.test.ts` 把一帧的先后建模（滚动事件先读 24px 的「在底部」、`atBottomRef` 晚一次渲染，然后帧回调动输入框、排版、滚动容器的 ResizeObserver），A2、A3 的多一行、贴一整页、缩回，每一帧离底 0、「在底部」始终为真；对照组让输入框在滚动事件读之前就动（transition 的时序），贴一整页会有一帧没贴底，与 Chrome 里看到的一致。

**默认档逐像素不变的依据**

同一个 harness 放进本分支与 `06948df5`（`git archive` 出来、各起一个 Vite），1480 × 920、1x，11 个画面两边截图逐像素相同，`#root` 的 innerHTML 的 SHA-256 也相同：主对话浅、深、宽屏，工作台浅、深、960 × 600，主对话打三行、打十二行（过了上限）、发出一句之后，工作台深色打三行，工作台往上翻着打三行。harness 不渲染 MainView，所以不含 pill：真机里默认档唯一的变化就是那颗 pill。代码上：A1 时 `animateTextareaHeight` 什么都不碰就交回原来的瞬间路径；B1 时 `withCorners` 原样返回间距 class；单测 `td-variants.test.tsx` 也核对了 B1 的行 class 与现在相同、工作台在 B4 下逐字节不变。

**截图**（会话草稿目录 `td05/shots/`，不进仓库）

- B 各档，浅深两行：`td05/shots/overview-B-corners.png`；三连发放大：`td05/shots/detail-B-burst-light.png`；单张 `b1-light.png` … `b4-dark.png`（同目录，2x）。
- A 逐帧曲线（三种情形 × 三档）：`td05/shots/chart-A-grow.png`；A3 长高途中的 6 帧（页面时钟放慢 20 倍拍的，字贴着下沿、上面的行从框顶滑进来、没有滚动条）：`td05/shots/slow-A3-frames.png`。
- pill：主对话闭合 `pill-main-closed.png`，展开并开着演示、B3（浅、深）`pill-main-open-demo-B3.png`、`pill-main-open-demo-B3-dark.png`，工作台带问题轨 `pill-workbench-rail-open.png`、960 × 600 `pill-workbench-rail-small.png`（同目录）。
- 数据：逐像素结论 `pixels-result.txt`，逐帧记录 `grow.json`、`grow-summary.txt`（同目录）。

**测试**

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check` 通过；新文件整篇 prettier，旧文件只看自己的 hunk（其余差异是原有的）。
- 全量 gui：本机时区与 `TZ=UTC` 各一遍，都是 141 个文件、1422 条通过。
- 新增：`lib/composer-grow.test.ts`（时长公式、ease-out 曲线、逐帧到位、半路接着走、上限、首次瞬间、切回 A1 清干净、减少动态、帧序模型与对照组、Composer 接线）；`lib/assistant-conversation.test.ts`（`assistantJoinsGroup` 与 4px 间距同一条件、各位置的圆角 class）；`td-variants/td-variants.test.tsx`（默认档、B1 不加东西、B3 首中末与时间条断组、左侧、工作台不变、演示只在主对话、静态渲染无 pill）。
- 反向检查 8 处，都挂了，恢复后 SHA-256 一致：不重画上一条、时间条不断组、去掉 B1 的门、你的小角放错边、忽略减少动态、高度在帧前就动、演示漏到工作台、Composer 没接上。

**留意**

1. 与设计文档的冲突：`docs/design/foundations.md:638` 写「新代码禁止再写 duration / easing 字面量」。A2 的 100ms 不在 token 里（最近的是 `--motion-fast` 120ms），A3 的时长是算出来的，本来就不会是 token；缓动用的是 CSS 的 `ease-out`（票面所写），不是我们的 `--ease-firm`（cubic-bezier(0.2, 0, 0, 1)）。试验照票做；JC 选了 A2 或 A3 的话，定稿时要么在 foundations 记一条豁免（类似 shimmer 那条），要么换成 token（A2 用 120ms、缓动用 `--ease-firm`），需要主会话定。
2. 票里说 Telegram 是 ease-out，查到的是 Web A `src/components/common/Composer.scss:883` 的 `transition: height 100ms ease`（时长再按公式内联覆盖）；这里照票用了 ease-out。
3. 做法与 Telegram 不同：用逐帧而不是 CSS transition，原因见上「怎么确认」第 2 条。
4. 只在 Chrome 里量过，Tauri 的 WKWebView 没量；WebKit 推进动画的时机可能本来就不会撞上第 2 条那一帧，逐帧的写法两边都成立。
5. 现状 A1 的一个旧现象（`06948df5` 上同样复现，不是本票带来的）：工作台里一次贴一整页时，「量高先收成 auto」让浏览器先把 scrollTop 夹回去，滚动事件读到离底 158px 一次，「在底部」可能闪成 false 一下；画出来的帧仍贴底。A2、A3 用副本量高，没有这一下。
6. 演示开着时主对话的真实内容不显示；主对话若正在跑，MainView 的那一行照旧画在演示下面。
7. 面板展开时占右上角约 280 × 110px，会盖住那里的对话，看完收起。

### 2026-10-16 切档裁决（主会话）

JC：「按你推荐，A3 和 B1」。理由见 [PRD](../PRD.md) 裁决 6。定稿（拆 A、B 档位与「演示连发」、A3 写死且缓动换 `--ease-firm`、删组内圆角代码、`foundations.md` 记时长随距离变的例外）等票 07 的切档裁决后一起做；在那之前 JC 在 pill 里把 A 停在 A3。
