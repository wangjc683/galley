# 102 每次记下都飞进顶栏按钮（切换器试用）

Status: needs-dogfood（2026-10-28 快进合入 `83a7bb28`；主会话机器验收：读过 `lib/fresh-cards.ts`、`hooks/useFreshCards.ts`、`lib/todo-flight-run.ts` 的层级与清理；在 worktree 重跑 `pnpm --dir gui typecheck`、`lint`、`git diff --check` 全过，`test` 本地与 `TZ=UTC` 各 226 个文件、2500 条全过；真窗口第一帧与截图待做）

来源：[主聊天 PRD](../PRD.md) 裁决 147 第 6、7 条（2026-10-28，JC：「按你的推荐做 A+B」）。紧接票 [101](./101-introduce-on-reminder-and-memo-cards.md)，同一个代理、同一个 worktree，先做完 101 再做本票；两张票共用「回复下新出现了哪些卡片」的判断。这是试用票：临时切换器，JC 真机比完定档，另开定稿票拆切换器、写设计文档。只改 GUI。外置运行时零变化（没有主对话与待办按钮）。

## 为什么

回复下的卡片在对话底部，顶栏「待办」按钮在右上角，两者之间没有任何看得见的联系，用户不知道记下的东西去了哪。照 macOS Safari 下载时文件图标飞进工具栏下载按钮的做法：每记下一件，卡片的图标飞进按钮，按钮接住时 pop 一次。每记一次教一次，不推翻任何人的面板开关，不盖对话。

## 现状（读码起点）

- 顶栏按钮：`gui/src/components/layout/header/TodoToggleButton.tsx`（`data-role="topbar-todo"`，28px 方块，`ListChecks` 16px thin，今天有数时右边写 N），由 `MainHeader` 的工具簇放置。位置以后可能变（顶栏正在另议），所以飞行的终点每次起飞时按 `[data-role="topbar-todo"]` 现量，不写死。
- 卡片与左边那颗图标：待办卡片 `components/conversation/TodoCards.tsx`（`data-role="todo-card"`，方框 `TodoCheck` 在 16px 列里）；提醒卡片 `ReminderCards.tsx`（`Alarm` 14px，约 90 行）；备忘卡片 `MemoCards.tsx`（`data-role="memo-card"`，`Notepad` 16px thin，约 91 行）。挂载在 `components/screens/MainView.tsx` 约 720 行起。
- 「新出现的卡片」：票 101 做的判断（三个来源：`stores/assistant-todo.ts` 的 `noted`、`hooks/useReminderCards.ts`、`stores/memo.ts` 的 `events`）。
- 面板在不在屏上：`lib/todo-open.ts` 的 `todoView(...).shown`（App 里算）；自动开一次：票 87 / 101 的 `introduceTodoPanel`。
- 已有的一次性 pop：`gui/src/styles/globals.css` 约 1190 行 `sidebar-state-pop`（0.44s，scale 0.42 → 1.38 → 0.94 → 1），减少动态的关停在约 1406 行；动效 token 约 283–303 行（`--ease-pop`、`--ease-spring`、`--motion-*`）。
- 切换器的先例：票 85 的 `gui/src/components/todo/todo-variants/`（`TodoVariantsPill.tsx`、`todo-variants.ts`、测试；提交 `13092922`），照它的写法与存放（localStorage 键名、pill 的位置与样子）。pill 要 portal 到 body、`pointer-events: auto`，常驻、可点。

## 要做的

1. **什么时候飞**：
   - 主对话本身在屏上，一张待办、提醒或备忘卡片（备忘只算「记下了」「改为」）在回复下新出现，面板不在屏上（`shown` 为假，含窄窗口没开临时面板时）。你发起的一轮和叫醒的一轮都飞。子任务卡片不飞。
   - 不飞：首次读、切到主对话的那次挂载、翻历史、卡片状态变化（勾、取消、划线）；票 87 / 101 的自动开那一次（它开了面板，就不飞；同一轮先判自动开，再判飞）。
   - 卡片那颗图标不在视野里（被滚出去了）：不飞，只 pop。
   - 一条回复几张新卡就飞几颗，相隔 90ms 依次起飞；按钮在最后一颗到达时 pop 一次。
2. **怎么飞**（大档，先做够大的，JC 往回拉）：
   - 一颗图标的复制品（同卡片上的图标、同色），fixed 定位、portal 到 body、`pointer-events: none`，层级在对话与顶栏之上、在对话框与菜单之下。卡片上原来的图标不动。
   - 路径：二次贝塞尔，起点卡片图标中心，终点按钮图标中心，控制点在两点连线中点往上抬 160px（屏幕坐标往上，即向窗口顶）。
   - 时长 700ms，缓动用 `--ease-firm` 或你判断更像「被吸进去」的曲线（写清楚理由）；尺寸 16px → 中途放大到 24px → 到达时 12px；最后 80ms 淡出。
   - 按钮 pop：照 `sidebar-state-pop` 的手感，大档 scale 1 → 1.25 → 0.96 → 1，约 440ms；pop 期间图标与数字是满墨色（`ink`），结束回到原来的墨色。不加颜色、不加徽标（顶栏颜色只给 warning / error 与 `brand` 邀请，`docs/design/layout-and-chrome.md:91`）。
   - 减少动态：不飞，不缩放；按钮铺 `bg-hover` 一下再 600ms 淡回。
3. **切换器**（临时）：
   - 形态：现状（不飞不 pop）/ 只 pop / 飞 + pop。默认「飞 + pop」。
   - 幅度：大（上面的值）/ 中（控制点 100px、峰值 20px、pop 1.15、560ms）/ 小（60px、峰值 16px 不放大、pop 1.08、450ms）。默认大。
   - 演示：一颗「重放」按钮，拿主对话里最后一条带卡片的回复的卡片照当前档位飞一次（面板开着时也飞，演示用）；主对话里没有卡片时从输入框左端起飞一颗方框。
   - 选择存本机（照票 85 的键名写法），切换即时生效。
4. 判断（飞哪几颗、只 pop 还是不动、档位参数）写成纯函数单测；路径计算（给定起止点与档位，第 t 帧的位置与尺寸）也写成纯函数单测。jsdom 不排版，起飞、落点、pop 类名的接线用 mock 的 `getBoundingClientRect` 测到就够，观感交真机。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- Core、手册、提示词、Agent API；顶栏按钮的位置、尺寸、图标、数字规则（另议中）；卡片几何；面板。
- 设计文档本票不写（试用票），定稿票写。
- 外置运行时的任何东西。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 都报错；工具函数别从组件文件导出。
- 注释照周围的写法（英文、引票号与裁决，如「main chat ticket 102, PRD ruling 147」），密度相当；切换器相关的代码集中放、注明是临时的，方便定稿票整块拆。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- scratchpad 里的新文件用 `t102-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍 `pnpm --dir gui test`
- `git diff --check`
- 反向检查：把「面板在屏上不飞」「自动开那一次不飞」「状态变化不飞」各改坏一处，对应测试要红，改回全绿

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样，含票 101 的）。
2. 飞行层放在哪、怎么拿起点与终点、缓动的选择与理由；与票 101 共用的判断怎么接。
3. 验证命令与结果原样（含两个时区、反向检查）。
4. 票面没写到、你自己定的边界（逐条）。
5. 看到但没改的问题，没验证到的（逐条，尤其真窗口里才看得出的：第一帧位置、滚动中起飞、窄窗口）。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新；主会话先在真窗口量过第一帧再交）：

1. 面板关着，点切换器「重放」，三档形态、三档幅度各看一遍。
2. 面板关着，跟 Galley 说「明天下午三点提醒我取快递」：回复落定时闹钟飞进右上角，按钮 pop。
3. 打开面板再记一件：不飞，面板里那一行亮。
4. 定档：形态、幅度各选一个，或说「往回拉一点」。

## Comments

### 2026-10-28 实现回报（票 102 代理）

分支 `ticket-101-102-todo-discovery`，接在票 101 之后，同一个 worktree。未 push、未合入。

**1. 提交列表**（`git log --oneline main..HEAD` 在本票做完时的样子，含票 101 的，号是 rebase 到本地 main `88001d3c` 之后的；两张票的回报提交在它之后）

```
38f1d259 Ticket 102: a temporary switcher for cards flying into the top bar's 待办 button (现状 / 只 pop / 飞 + pop, 大 / 中 / 小, 重放)
58a5c4ce Design: the panel opens once for any card it lists; a reminder card's words open it (ticket 101, ruling 147)
0c518a36 Ticket 101: the panel opens once for reminder and memo cards too; a reminder card's words open it
```

**2. 飞行层放在哪、怎么拿起点与终点、缓动的选择与理由；与票 101 共用的判断怎么接**

- **分三块**：判断与路径是纯函数，放 `lib/todo-flight.ts`（`cardFlightPlan` 飞哪几颗、只 pop 还是不动；`flightSchedule` 起飞与 pop 的时刻；`flightFrame` 给定起止点、档位与已飞的毫秒数，算出那一刻的位置、尺寸、不透明度；`cubicBezier`）；量 DOM、动 DOM 的放 `lib/todo-flight-run.ts`（`flyFreshCards`、切换器用的 `replayFlight`）；临时切换器整块放 `components/todo/flight-variants/`（`flight-variants.ts` 的档位与本机记忆、`FlightVariantsPill.tsx`、测试），每个接触点都写着 `TEMP variant switcher (main chat 102)`，拆法写在 `flight-variants.ts` 文件头，测试里有一条扫全 `src` 核对接触点只有那五个文件。
- **飞行层**：`<body>` 上一个 `position: fixed`、铺满窗口的层（`data-role="todo-flight-layer"`），`inert`、`aria-hidden`、`pointer-events: none`，`z-index: 40`：对话与顶栏用到的是 10–30（顶栏本身没设），对话框与菜单从 50 起，所以在前者之上、后者之下。没有飞行时层就拿掉。用命令式 DOM 而不是 React portal：每帧改 `transform`，不经过渲染。
- **起点**：三种卡片放图标的那一列（16px 宽）加了 `data-card-icon`，提醒卡片加 `data-reminder-id`、备忘卡片加 `data-memo-event`（同一条备忘可能在几条回复下各有一张，按改动的事件 id 找）；待办卡片本来有 `data-todo-id`。起点是那一列的中心，每一颗在自己起飞的那一刻量。复制品是那一列整个克隆（同图标、同样式类），去掉 `id` 与所有 `data-*`，颜色取那一列的计算色；卡片上原来的图标不动。尺寸以 16px 为基准整体缩放（提醒的闹钟本来 14px，跟着按比例缩）。
- **终点**：每颗起飞时现量 `[data-role="topbar-todo"]` 里那颗 `svg` 的中心（找不到就用按钮中心），不写死位置。
- **是否在视野里**：图标中心落在对话的滚动区（`[data-conversation-backdrop]`）与窗口之内；在收齐那一刻判。
- **缓动**：选 `--ease-exit`（`cubic-bezier(0.4, 0, 1, 1)`，globals.css 里「离场：加速离开」那一个），JS 里照它的四个数解曲线。理由：「被吸进去」是起步缓、越飞越快、以最快的速度撞进按钮，由 pop 接住这一下，一拍完成；`--ease-firm` 是 ease-out，越飞越慢、轻轻落定，落定之后再 pop，读起来是两拍，像「放下」不像「吸进」。位置按缓动后的进度走二次贝塞尔（控制点是两点连线中点往上抬 `lift`），尺寸也按同一个进度：前半段 16px 平滑长到峰值，后半段平滑缩到 12px，所以最大时正在弧顶；不透明度按时间，最后 80ms 淡到 0。
- **按钮 pop**：React 外给按钮加减类名（同票 87 亮行的做法），`todo-catch-pop` 的关键帧 `scale(1 → 峰值 → 回落 → 1)`、0.44s，峰值与回落值作为按钮上的 CSS 变量按档位给；这期间 `color: var(--color-ink)`（不分层的 CSS，压过 Tailwind 的 `text-ink-muted`），结束摘掉类名回到原来的墨色。减少动态：`todo-catch-wash`，只有 `from { background-color: var(--color-hover) }` 的关键帧，0.6s 淡回按钮原来的底色；`.todo-catch-pop` 也加进了 globals.css 末尾减少动态的那组 `animation: none`。不加颜色、不加徽标。
- **与票 101 怎么接**：同一个 `hooks/useFreshCards.ts`、同一份收齐好的 `FreshBatch`。收齐后先判自动开（`todoPanelIntroduces`），开了就 `return`，这一批不飞；没开才 `flyFreshCards({ fresh, mainChatOnScreen, panelShown, form, level })`。`panelShown` 用 `todoView(...).shown` 按等完那一刻的 store 算（窄窗口没开临时面板时为假）；`form` 与 `level` 从切换器的 store 读。`cardFlightPlan` 不看是不是你发起的一轮，叫醒的一轮同样飞。首次读、切回主对话那次挂载、状态变化都不会进 `fresh`（票 101 的判定），所以这里不用另判。

**3. 验证命令与结果原样**

```
$ pnpm --dir gui typecheck
> galley-desktop@0.7.2 typecheck …/gui
> tsc --noEmit

typecheck exit=0

$ pnpm --dir gui lint
> galley-desktop@0.7.2 lint …/gui
> eslint src --max-warnings 0

lint exit=0

$ git diff --check
diff-check exit=0
（新文件不在 diff --check 的范围里，另用 grep 查过行尾空白：没有）

$ pnpm --dir gui test
 Test Files  225 passed (225)
      Tests  2483 passed (2483)
local exit=0

$ TZ=UTC pnpm --dir gui test
 Test Files  225 passed (225)
      Tests  2483 passed (2483)
UTC exit=0

$ TZ=America/Los_Angeles pnpm --dir gui test
 Test Files  225 passed (225)
      Tests  2483 passed (2483)
LA exit=0
```

反向检查（scratchpad 里的 `t102-reverse.sh`，做法同票 101：备份、改坏、跑 `todo-flight`、`todo-flight-run`、`fresh-cards`、`useFreshCards` 四个测试文件，`cp` 回去再跑）：

```
--- broken: the panel on screen: nothing flies
     × does not fly while the panel is on screen: its rows light instead
     × does nothing while the panel is on screen
      Tests  2 failed | 48 passed (50)
--- restored
      Tests  50 passed (50)
--- broken: the once the panel opens by itself: nothing flies
     × the once the panel opens by itself, nothing flies
      Tests  1 failed | 49 passed (50)
--- restored
      Tests  50 passed (50)
--- broken: a to-do card ticked: nothing flies
     × are new once their reply settles, or noted and settled between two reads
     × do not count a card changing: ticked, cancelled
     × once the panel is met, the new cards are flown, at the trial's pick
     × a card changing — ticked, cancelled, gone off, its memo deleted — flies nothing
      Tests  4 failed | 46 passed (50)
--- restored
      Tests  50 passed (50)
--- broken: a reminder card gone off: nothing flies
     × do not count a card changing: fired, cancelled
     × a card changing — ticked, cancelled, gone off, its memo deleted — flies nothing
      Tests  2 failed | 48 passed (50)
--- restored
      Tests  50 passed (50)
```

「状态变化不飞」改坏的是卡片的身份：把待办卡片的 `card` 写成 `id:state`、提醒卡片的写成 `id + lastFiredAt`，勾一下、到点一下就会被当成新卡。

新增的测试：`lib/todo-flight.test.ts`（飞的条件：面板在屏上、主对话不在屏上、没有卡、现状都不动；只 pop；滚出视野的不飞、全不在只 pop；减少动态铺底色。时刻：90ms 依次起飞、最后一颗到达时 pop、没飞的立即 pop、回落值。路径：缓动两端与单调、起飞在图标中心 16px、落在按钮图标中心 12px 且已淡出、弧中点抬高 `lift/2` 且正是峰值尺寸（三档）、最后 80ms 才淡、小档不放大）；`lib/todo-flight-run.test.ts`（jsdom，手设 `getBoundingClientRect`：第一帧位置、依次起飞、层的层级与不可点、落地后移除、pop 的类名与 CSS 变量与时刻、复制品的颜色与去掉的属性、滚出视野只 pop、面板在屏上不动、只 pop、减少动态铺底色，以及「重放」的三条）；`components/todo/flight-variants/flight-variants.test.tsx`（默认飞 + pop、大；三档的值；本机记忆的读与回退；没有 document 时不画；接触点核对）；`hooks/useFreshCards.test.tsx` 加五条（自动开那一次不飞；认识以后照切换器的档位飞，告诉的内容原样；叫醒的一轮也飞；面板在屏上、窄窗口、离开主对话时告诉的条件；勾、取消、到点、备忘被删都不飞）。

**4. 票面没写到、我自己定的边界**

1. **中、小档的「560ms」「450ms」读作飞行时长**，与大档的 700ms 对应；pop 各档都是约 440ms。票面写的是「pop 1.15、560ms」，挨着 pop 的倍数，也可以读成 pop 的时长，可那样中档的 pop 比大档还慢，不像「往回拉」，所以按飞行时长做。若意思是 pop 时长，改 `flight-variants.ts` 的 `FLIGHT_LEVELS` 与 `CATCH_POP_MS` 的用法即可。
2. pop 的回落值票面只给了大档（0.96）；中、小档按比例：`1 − (峰值 − 1) × 0.16`，即 0.976、0.987（`catchDip`）。
3. **切换器存本机的键名**：票面说「照票 85 的键名写法」，可票 85 的选择只存在内存里、没有键（它的文件头写着「Both choices live in memory」）。照更早的票 42、45 切换器的写法，用 `galley.tmp.todoFlight`（JSON，读写包 try/catch，读不懂的回到默认）。
4. pill 只在 dev 构建里出现（照票 85），生产构建没有 pill、按默认（飞 + pop、大）飞。位置照票 85：顶栏下面、窗口正中（`top-[52px]`），不挡往右上角的飞行路线；`z-[1000]`、`pointer-events: auto`、portal 到 `<body>`。
5. 有的在视野里、有的不在：在的照飞，pop 仍在最后一颗到达时；全都不在：立即 pop。「在不在」在收齐那一刻判，起飞时只重量位置。
6. 卡片出现前就取消了的待办、提醒，出现前已删掉的备忘，不飞（同票 101：不算新卡）。
7. 起飞比卡片出现晚约 400ms：用的是票 101 的收齐窗口，没有另设。
8. 同时有两批：互不影响；新的 pop 会打断正在进行的 pop、从头再来。
9. 「重放」：现状什么都不做；只 pop 只 pop；减少动态铺底色；卡片滚出视野时照真实规则只 pop。「最后一条带卡片的回复」取 DOM 里最后一张待办、提醒或备忘卡片所在的 `[data-message-id]`，飞它下面的全部卡片。没有卡片时从输入框（`composer-one-line`，没有就找 `textarea`）左边 24px、竖直居中起飞一颗空方框（照 `ui/checkbox.tsx` 的 md 空框画）。
10. pop 期间按钮的 `className` 若被 React 改写（例如恰好此时今天的数字从无到有），类名会被冲掉、pop 截断。数字在卡片出现时就随清单刷新变了，pop 在那之后约 1.1 秒，撞上的机会很小，没处理。
11. 没有加文案；pill 上的字是临时的、不进语言包（同票 85）。

**5. 看到但没改的问题，没验证到的**

1. **第一帧位置**没在真窗口量过：jsdom 不排版，起飞点只用手设的盒子测。图标列是 16×20，复制品放进 16×16 的盒子里居中，竖直方向各溢出 2px；方框（待办卡片的 checkbox）克隆后在盒子里的位置、是否正好叠在卡片的方框上，要真窗口看。
2. **滚动中起飞**：回复落定时对话正在平滑跟随到底（票 51），卡片出现后的 400ms 里还可能在动。起点在每颗起飞的那一刻量，之后不再跟着卡片走；「在不在视野里」是收齐那一刻的判断，与起飞那一刻可能差一点（例如收齐时刚好在视野边上，起飞时已滚出）。
3. **窄窗口**：没开临时面板时照飞；窄窗口下顶栏按钮的位置、飞行路线经过侧栏或覆盖层的样子没看过。
4. 按钮有数字（变宽）时 pop 的观感、满墨色是否压得过（用的是不分层 CSS 的优先级）、减少动态的铺底色，都没在真窗口看过。
5. z 40 与侧栏、macOS 标题栏拖拽区的关系没看过；顶栏本身没有 z-index，飞行层在它上面。
6. 性能：每颗一个 `requestAnimationFrame` 循环，一次飞几颗时的帧率没量。
7. 外置运行时没跑：没有主对话，hook 不挂、pill 不画、卡片不画。
8. 设计文档本票没写（试用票），定稿票写；定稿时顶栏的动效规则（`layout-and-chrome.md` 的「禁止」一条）要补「一次性飞入」这一类（裁决 147 第 7 条）。
