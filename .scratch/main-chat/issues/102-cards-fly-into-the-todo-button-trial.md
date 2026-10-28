# 102 每次记下都飞进顶栏按钮（切换器试用）

Status: ready-for-agent

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
