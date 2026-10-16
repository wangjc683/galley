# 04 平滑滚动：远跳先瞬移、认「减少动态效果」；顺带四处小出入

Status: done（2026-10-16 合入 main，`892ee6d5`、`0bfafd54`，合并提交 `e949d162`；同日 JC 真机验收：「其他验收 OK，可以 push」）

来源：[PRD](../PRD.md) 裁决 5（2026-10-16，JC：「5，做」）。只改 GUI 与文档，不碰 Rust。两边都上。
独立子代理做，与 01–03、05 并行。

## 目标

对话里的程序化平滑滚动统一走一个我们自己的滚动函数：时长与曲线由我们定，远距离跳转不再「刷」过去，系统开了「减少动态效果」时一律瞬时。

## 依据

- Telegram Web A `src/util/animateScroll.ts:164-168,241-272`：
  - 时长 = 300ms + 距离 / 800px × 300ms，封顶 600ms。
  - 距离 ≤ 300px 用 `1 - (1 - t)^3.5`，更远用 `1 - (1 - t)^6`。
  - 距离超过 800px 时，先瞬移到离目标 800px 处，只动画最后 800px。
- 我们的规范 `docs/design/foundations.md:609`：「`prefers-reduced-motion` 下 A/B 动效一律退化为静止或瞬时」。今天对话里四处 smooth 写死，不认这个设置：`useStickyScroll.ts:216`（回到底部）、`:258`（回到底部追移动靶）、`:449`（工作台发送后贴顶）、`:510`（⌥↑ / ⌥↓）。
- Web K 的分档语义（`src/scss/mixins/_animationLevel.scss:5-20`）：开了减少动态，只保留淡入淡出、颜色与原地缩放，「没有东西在屏幕上移动」。

## 要做

1. 新建一个滚动函数（如 `gui/src/lib/animate-scroll.ts`，名字你定）：按上面的时长、曲线、远跳规则把一个滚动容器滚到目标 `scrollTop`。
   - 用户中途滚轮、触控板、按键滚动 → 立刻放手（不和人抢）。
   - 同一容器上新的滚动请求取消旧的。
   - 能在动画中途改目标（回到底部「追移动靶」要用：流式增长时底部在动）。
   - `prefers-reduced-motion: reduce` 时直接写 `scrollTop`。用 `matchMedia` 实时读，不缓存到启动时。
   - 数值与出处写进文件头注释（只写思路与数值，不抄 GPL 代码）。
2. 把上面四处换成它。回到底部的监视器（`onClickScrollToBottom`）今天的三条语义保持：底部长高时改瞄准、用户中途往上拉就放手且不挂上跟随、1600ms 超时直接到底并挂上跟随。
3. grep 整个 `gui/src` 里对话区的其他 `behavior: "smooth"` / `scrollIntoView` / `scrollTo`（问题轨点击、⌘F 定位等），确认各自是否该走新函数；设置页、侧栏、提示词管理里的列表内滚不在本票范围，列出来即可。
4. 顺带四处小出入：
   - 回到底部按钮在中文界面的 aria-label 是英文 `Scroll to latest`（`gui/src/i18n/locales/zh.ts:1740` 附近）：改成中文（如「回到最新」，对照英文语义与界面里已有的叫法）。
   - `docs/design/conversation.md:541` 说回到底部是「ghost 按钮」，代码是带边框、半透明底、模糊加阴影的浮起按钮（`MainView.tsx:691-732`）：文档改成代码现状。
   - `docs/design/conversation.md:557-563` 对在跑计时的描述（「3 秒才显示计时、60 秒后显示仍在运行、三点」）与代码不符：按 `Conversation.tsx:1573-1695`、`AssistantParts.tsx:72-103` 的现状改写。
   - `docs/devlog/deferred.md`「轮间距层级」节的「现状」数值过时：按工作台票 01 之后的实际间距重量（上一回答 → 下一条你的消息、你的消息 → 折叠头），改写现状，结论（是否仍倒挂）照实写。
5. 文档：`docs/design/conversation.md`「Scroll behaviour」写清滚动函数的规则与数值；`foundations.md` 动效一节如果还没有 Web K 那句「开了减少动态，只淡不移」的语义，补上。

## 验收

- 单测：时长与曲线（短、中、远跳）、减少动态时瞬时、用户滚轮打断、中途改目标。
- 已有的 `useStickyScroll` / 定位相关测试全过；`TZ=UTC` 与本机时区各跑一遍全量 gui 测试。
- 真机（JC）：长工作台会话里 ⌥↑ 连跳、点回到底部（在跑与不在跑各一次）、系统设置里打开「减少动态效果」后同样操作都是瞬时。

## Comments

### 实现（2026-10-16，子代理，分支 `td-scroll`）

提交：`892ee6d5`（代码与测试）；文档与本节另一个提交。

**滚动函数** `gui/src/lib/animate-scroll.ts`：

- 接口：`animateScroll(el, top, onEnd?)` 返回 `{ retarget(top), cancel(), ended, target }`。`onEnd(end)` 只调一次，`end` 是 `arrived` / `interrupted` / `superseded` / `cancelled`；减少动态、或已经在目标上时，返回之前就调。另有 `scrollDestination(el)`：这个容器上在跑的动画的目标，没有就是 null。
- 规则：目标先夹到 `[0, scrollHeight − clientHeight]`（不夹的话「滚到 `scrollHeight`」多算一个视口高，时长、远跳都算错，最后一段写的值被浏览器夹住，看着像提前停）；超过 800px 先瞬移到离目标 800px，只动画最后 800px；时长 300 + 距离 ÷ 800 × 300ms，封顶 600；≤ 300px 指数 3.5，更远 6；`matchMedia` 每次调用实时读，开着就直接写。
- 放手：容器上的 wheel、touchstart、容器本身（滚动条）上的 pointerdown；文档上的滚动键（方向键、Page Up / Down、Home / End、空格；目标是输入框、或已被别人 `preventDefault` 的不算，所以 ⌥↑ 自己那一下不会打断自己）；两帧之间 `scrollTop` 被别的代码挪了 2px 以上也放手（同原生平滑滚动被一次写入打断）；同一容器的新请求接替旧的。
- 中途改目标：`retarget` 从当前位置按同一套规则重新起步（远跳规则照样）；已结束的动画上 `retarget` 不生效，要新开一个。
- 给 live tail 留的口：滚到任意 `scrollTop`、`retarget` 改目标、`onEnd("interrupted")` 知道被用户或别的代码打断，不用再改接口。
- 数值与出处写在文件头（只写思路与数值，代码自写）。

**回到底部**：监视器挪到 `gui/src/lib/chase-bottom.ts` 的 `chaseBottom(el, onSettle)`，hook 里只剩开、停与回调。三条语义不变：底部变了就 `retarget`；往上拉超过 2px 就放手、不挂上；1600ms 还没到就瞬时到底并挂上。改了三处细节：「底部变了」改看 `scrollHeight − clientHeight`（视口变矮也算）；离底 24px 以内挂上时不掐断还在走的动画（掐断会停在离底 ≤ 24px 处，原生 smooth 时监视器停了动画照走）；用户滚轮接手后不再 `retarget`（不和人抢），结局仍按三条判。

**⌥↑ / ⌥↓**：只换了焦点判断以下的部分，没动焦点判断（另一个子代理在改那几行，两处隔着十来行，合并应不冲突）：

1. 动画途中再按，从 `scrollDestination` 算上一条 / 下一条。原生 smooth 下连按第二下常被吃掉：第一下还差几十 px 没到，那条仍在锚线上方 8px 容差之外，第二下又瞄同一条。
2. 找到目标后 `setAtBottom(false)`，同问题轨的 `onJump`。不这样的话，在底部流式时每帧的跟随贴底会挪 `scrollTop`，动画按「别人挪了就放手」松手，⌥↑ 被吃。

**第 3 步 grep**（`behavior: "smooth"`、`scrollIntoView`、`scrollTo`、`scrollBy`、写 `scrollTop`）：

- 换成新函数：问题轨的点击（`UserQuestionRail.tsx` `handleJump`；原来自己读 reduced-motion，现在交给函数）。
- 对话区，不换：⌘K / ⌘F 定位（`useStickyScroll` 的 locate 效果硬写 `scrollTop`：新挂载的会话靠真实的 `scrollTop` 变化触发 WKWebView 重绘，落定后 500ms 内还要按停靠位置重停，注释里写着）；切换会话落底、跟随贴底（layout effect 与 ResizeObserver）、视口变矮保持贴底（`viewport-resize.ts`）、往上加载保位（`useEarlierTurns.ts`、`scroll-anchor.ts`）、助手发出后到底（`assistantScrollToBottom`）、助手的跟随（`assistantFollowBottom`）：都是瞬时写，本来就不动画。
- 不在本票范围，列出：smooth 的 8 处仍不认减少动态——侧栏项目组展开 `SidebarProjectGroup.tsx:596`；设置页 `SettingsModels.tsx:95`、`:226`，`ProviderEditor.tsx:171`，`ModelDraftEditor.tsx:68`，`ProviderCard.tsx:160`、`:172`；提示词管理 `PromptManagerDialog.tsx:386`。瞬时的：侧栏 `Sidebar.tsx:362`、`:373`，`SidebarProjectGroup.tsx:675`，`ModelCombobox.tsx:76`，文件预览的标题跳转 `LocalFileReference.tsx:141`，diff 的 hunk 跳转 `GitPatchView.tsx:57`，`GitReviewPane.tsx:88`、`LocalFileWorkspace.tsx:444`（复位）。那 8 处要统一认减少动态，可以另开一张小票（换成 `behavior: prefersReducedMotion() ? "instant" : "smooth"` 即可，不必走对话的滚动函数）。

**四处小出入**：

1. `zh.ts` 的 `scrollLatest`：`Scroll to latest` → 「回到最新」。对照英文的 latest；设计文档里这个按钮叫「回到底部」，那是设计名，留着，读屏念的是去哪：最新的消息。文档里注了读屏文案。英文不变。
2. `conversation.md`「浮动按钮」：ghost → 代码现状（1px 边框、`elevated` 92% 底、`backdrop-blur-md`、`--shadow-float`；悬停上浮 2px、换 `line-strong` 与 `--shadow-float-hover`、瞬时；按下回落、缩到 95%），与右下角运行计时同一套材质。
3. `conversation.md`「Thinking Placeholder」的计时：按代码改写——0.0 立即起跳，一分钟内带十分位，满一分钟整秒，不加「已」，没有「仍在运行」和三点，在动的指示是扫光，换步按 `index` 原地归零；另写了右下角整秒计时和助手那一行（过 3 秒才接整秒用时）。`foundations.md` §2.5 有同一段过时描述（「3 秒后读秒、60 秒后补仍在运行」），一并改了，免得两处打架。
4. `deferred.md`「轮间距层级」：现状改写，结论**已不倒挂**（对间 50 / 60.5 > 对内 30 > 头到回答 10），「待定」写了「可以关掉，由 JC 定」，`状态` 行没动。

**量到的间距**（CSS px，元素盒）：

| 间距 | 值 |
|---|---|
| 上一回答（最后一个段落盒的底）→ 下一条你的气泡，不在断点 | 50.0 |
| 同上，隔时间断点：回答 → 时间条 / 时间条高 / 时间条 → 气泡 | 30.0 / 10.5 / 20.0（合计 60.5） |
| 你的气泡 → 折叠头（整行盒，32px 高） | 30.0 |
| 你的气泡 → 一步就答完的回答正文 | 30.0 |
| 折叠头 → 回答正文 | 10.0 |

量法：在 worktree 里临时起 Vite（1432 端口，不是 tauri dev），临时页面用工作台滚动容器的类名（`px-8 py-6`、`@container/conversation`、760 栏）渲染真实的 `Conversation`，固定四轮数据（两步运行、两步运行、隔 3 小时的一步回答、两步运行）；playwright-core 驱动本机 Chrome，视口 1220 宽、标准字号、浅色，`getBoundingClientRect` 量盒子，四轮一致。截图核过画面正常。harness 已删，不进仓库。与工作台票 01、02 Comments 里的数一致（50、30、10、30 / 10.5 / 20）。

**文档**：`conversation.md`「Scroll behaviour」加「平滑滚动」一条（规则、数值、谁说了算、`retarget`、⌥ 连按、不走它的），实现细节那行改成 `animateScroll`；「Sticky-bottom」的点按钮一条改写成 `chaseBottom`；`foundations.md` §2.7 补「只淡不移」（Web K 的分档；淡入淡出、颜色、原地缩放可以留但不强求，已退成静止的不必改回），Motion tokens 补一句：程序滚动的时长随距离变，不在 token 刻度里。

**测试**：`animate-scroll.test.ts` 17 个（时长、两条曲线、远跳的纯函数；短 / 中 / 远跳的逐帧位置；向上远跳；夹目标；减少动态瞬时且每次实时读；滚轮、触摸、滚动键打断；滚动条打断而内容不算；已被处理的键和非滚动键不算；别的代码挪了就放手；中途改目标；新请求接替；取消；外加一条读源码确认对话里没有 `behavior: "smooth"`、四处都走函数），`chase-bottom.test.ts` 6 个（到底挂上、底部长高时改瞄且不靠超时、往上拉放手不挂上、追不上 1600ms 瞬时到底挂上、减少动态下一帧挂上、停下不回调）。假滚动容器与逐帧时钟在 `gui/src/test/scroll-frames.ts`。全量 gui 测试：本机时区 141 个文件 / 1419 个用例全过，`TZ=UTC` 141 / 1419 全过；typecheck、lint、`git diff --check` 通过。

**JC 真机验收**：

1. 长工作台会话里 ⌥↑ 快速连按三四下：每下多走一条，不吃键；远处那一条先瞬移、再滑最后一段（最长约 0.6 秒）；⌥↓ 同样。
2. 在跑时往上翻、点「回到底部」：滑到底、挂上跟随（流式继续往下长时跟得上），按钮消失；中途往上滚一下：停住、不挂上、按钮留着。
3. 不在跑时点「回到底部」（离底很远）：先瞬移再滑。
4. 在底部看着流式时按 ⌥↑：能跳上去，不被跟随拉回。
5. 问题轨点远处的点：先瞬移再滑。
6. 动画途中碰一下触控板：立刻停在手底下，不被拉回去。
7. 系统设置 → 辅助功能 → 显示 → 打开「减少动态效果」（不用重启 Galley）：1–5、工作台发送后贴顶，全部瞬时；关掉立即恢复动画。
8. 可选：VoiceOver 念回到底部按钮是「回到最新」；Windows 上拖滚动条打断动画。

**风险**：

- 「别人挪了 `scrollTop` 就放手」在 Windows WebView2（Chromium）上多一个来源：CSS 滚动锚定在上方内容长高时会改 `scrollTop`，动画可能停在半路。macOS WKWebView 没有 `overflow-anchor`，不受影响。真机见到再议（可以只对向下的偏移放宽）。
- 工作台提交贴顶仍和以前一样会被跟随贴底接管（动画途中流式第一块到来、跟随写到底、动画放手），即 JC 今天看到的「新消息停在底部附近」；live tail 若做，要先让列表底下留白，再用 `animateScroll` + `retarget` 停到位置。
- `retarget` 是从当前位置重新起步，ease-out 起步快：「回到底部」追长得快的尾巴时，会看到一次次轻微的再加速（同以前原生 `scrollTo` 重发）。底部一帧长几百 px 这种极端情况会反复远跳，1600ms 照旧兜底。
