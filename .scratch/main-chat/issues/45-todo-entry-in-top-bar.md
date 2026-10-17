# 45 待办入口挪到 Galley 对话的顶栏，面板定 B1 + C1

Status: merged（2026-10-17 快进合入 main，提交 `96ba26cf`、`af139533`；JC 真机选 D1〔2026-10-17〕，切换器已拆）

来源：主聊天 PRD 裁决 93（2026-10-17，JC：「甲」）。依赖 42、43（面板、卡片、切换器）。只改 GUI。

## 目标

待办的入口从侧栏 Galley 卡片下面那一行，挪到 Galley 对话顶栏右边的一个按钮；面板默认宽定为约 320px，已完成定为只删除线加 `ink-muted`；票 42 的 A、B、C 三组切换器拆掉，换成只比按钮样子的一组。

## 要做

- **顶栏按钮**：
  - 位置：主区顶栏右侧工具簇（`视图与设置`）的第一个，在「改动」之前。
  - 样子：清单图标（票 42 侧栏那一行用的同一个），16px thin，`TopBarIconButton`；今天有到期与逾期的，图标旁写数字 N（票 39 的 `todayCount`，不是徽标，0 不写）。
  - 行为：点开、再点收起右边的待办面板；开着时选中底色，照「改动」按钮（`docs/design/conversation.md`「本地文件引用」一节的 `bg-selected`）。tooltip 写「待办」。
  - 出现的条件：托管运行时，主区开着的是主对话本身（裁决 87 的「开着」：子任务不算）；工作台、子任务、外置都不出现。外置零变化（照票 42 的做法对比）。
- **记住开关**：开着离开、回到 Galley 时还开着，重启也记得（存本机，try/catch，读不到当关）；默认关。被文件预览换掉时算关。
- **侧栏**：撤掉 `SidebarTodoRow` 与它的变体；侧栏回到票 42 之前有主对话时的样子（书眉两个图标不变）。
- **⌘K「待办」**：照旧先进 Galley 再开面板。
- **面板定档**：默认宽约 320px（B1），已完成只删除线加 `ink-muted`（C1），写死，删掉 B、C 两组变体与它们的接入点。
- **临时切换器**：只比按钮样子，从最克制的排起：D1 图标加数字；D2 图标加「待办」两个字加数字。照票 42 的做法（常驻 pill、portal + `pointer-events: auto`、存本机 try/catch、默认第一档、接入点标 `TEMP variant switcher (main-chat 45)`、拆法写在文件头、临时 UI 不进 i18n）。顶栏挤的时候（窄窗口、身份行在跑时第二行）两档都要放得下，写清窄到多少时怎么让。

## 文档

- `docs/design/layout-and-chrome.md`：顶栏工具簇加这一个（条件、顺序、选中态）；侧栏那一行撤掉（历史写一句，指裁决 93）。
- `docs/design/conversation.md`：待办面板一节的入口、默认宽、已完成的样子。
- `docs/design/overlays-and-settings.md`：如有提到侧栏那一行的地方跟着改。

## 验收

- typecheck、lint、全量 gui 测试两遍（本机时区与 `TZ=UTC`）、`git diff --check`、六个门禁、中文标点扫新增行。
- 测试：按钮只在托管且主对话本身开着时出现，子任务、工作台、外置都没有；数字是 `todayCount`、0 不写；点开收起、选中态；记住开关（离开再回来、重新挂载）；文件预览换掉面板后算关；侧栏没有那一行；面板宽与已完成的样子定档；切换器默认档与拆法。
- 真机（JC）：比 D1、D2；开着面板去工作台再回来；关掉 app 再开。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-todo-topbar`）

**改了哪些文件**

- 新：`components/layout/header/TodoToggleButton.tsx`（按钮）、`lib/todo-panel-memory.ts`（记住开关）、`components/todo/todo-button-variant/`（D1 / D2 切换器，拆法在 `todo-button-variant.ts` 文件头）；测试 `TodoToggleButton.test.tsx`、`MainHeaderHost.todo.test.tsx`、`stores/ui.todo-memory.test.ts`、`todo-button-variant.test.tsx`。
- 改：`UtilityCluster.tsx`（工具簇第一个）、`MainHeader.tsx`（透传；有按钮时才设 `@container/main-header`）、`MainHeaderHost.tsx`（只在内置运行时透传）、`App.tsx`（主对话本身开着时给按钮；面板写死 320px、id `todo-panel`；换切换器）、`stores/ui.ts`（`todoPanelOpen` 从本机读、每次设都写）、`lib/todo-open.ts`（`mainChatOnScreen`；`toggleTodoPanel` 改为原地开关）、`lib/todo-panel.ts`（`TODO_PANEL_WIDTH`、`TODO_PANEL_ID`、`readingPanelClosesTodo`）、`LocalFileWorkspace.tsx`（文件预览只在换掉屏上的面板时算关）、`Sidebar.tsx`（撤那一行）、`TodoPanel.tsx`、`TodoCards.tsx`、`todo-styles.ts`（C1 写死）、`zh.ts` / `en.ts`（加 `topbar.todo`、`topbar.todoWithToday`，删 `sidebar.todo`、`sidebar.todoToday`）、`TopBarIconButton.tsx` 与三个侧栏文件的注释。
- 删：`SidebarTodoRow.tsx` 与它的测试；`components/todo/todo-variants/` 整个文件夹（票 42 的 A / B / C）与全部接入点：App 的 pill 和 B（`todoPanelId`、`PANEL_WIDTH`）、`TodoPanel` 两处 C、`TodoCards` 一处 C、`todo-styles` 的 `DoneVariant` 与 `todoDoneClass`（连同只为它存在的 `RowShell` 的 `rowClass`）。gui 里「main chat 42」标记 0 处，测试守着。
- 文档：`layout-and-chrome.md`（工具簇加「待办」；新节「待办按钮」：条件、顺序、样子、选中态、记住、切换器、窄时怎么让、历史；§3 一句；书眉一节两处；侧栏示意图去掉那一行，「『待办』那一行」改为撤掉的历史；「已知」）、`conversation.md`（面板的入口、记住、默认宽、与预览互换的规则、勾掉的样子；卡片「做完」）、`overlays-and-settings.md`（⌘K「待办」、「待办（内置运行时）」）、`copy-language-guidelines.md`（「Galley」一行去掉「侧栏卡片下的待办」）、`runtime-modes-and-sessions.md`（一句）。

**票面留给我定的**

1. **数字的样子**：12px 等宽数字，按钮自己的墨色（静止 `ink-muted`，悬停与选中满墨色），与图标同色，不另起一档灰。按钮有数字或字时 `w-auto gap-1 px-[5px]`，从 28px 方块向右长，图标留在方块里的位置（5px + 1px 边框 = 方块的 6px）。宽度：D1 一位数 39.8px、两位数 47.6px；D2 中文 67.8 / 75.6px，英文两位数 85.6px。
2. **窄时怎么让**：只让 D2 的「待办」两个字，按钮回到 D1；图标与数字不让。门槛按顶栏内容宽度的容器查询，平台、语言各一个，取最挤的常见状态也不压身份行（状态簇里「浏览器控制 · 待解锁」与新版本徽章、工具簇里有「改动」、N 两位数、身份行第二行最长的「子任务在问你」/「A subtask is asking you」），Chrome 实测：macOS 中文 640px、英文 750px（即主区 652 / 762px），Windows / Linux 中文 780px、英文 890px。主区最窄约 671px（960 窗口、侧栏拉到 30%），所以 macOS 中文下这两个字不会让。再窄，身份行照旧先截第二行（渐隐）、再截名字：671px 主区、英文、最挤状态时，「A subtask is asking you」被截（没有按钮时刚好放得下，按钮占了 48px）；中文最挤状态 D2 整个放得下、身份行不截。在跑时第二行只写「思考中」，比名字那一行短，不添挤。算式在 `TodoToggleButton.tsx` 的 `WORD_DISPLAY`。
3. **本机怎么存**：localStorage `galley.todoPanelOpen`，开着写 `"1"`，关掉删掉这一项；读时只认 `"1"`，别的值、读不到、没有 window 都当关；写失败只在这次运行里记得。
4. **按钮只原地开关**：它只在 Galley 里，不再走 `openMainChat`；⌘K「待办」照旧先进 Galley 再开。

**与票面不同、或我加的**

1. **提示写「待办 · 今天 N」**（N 为 0 时只写「待办」），无障碍名同一句；票面写「tooltip 写『待办』」。理由：D1 按钮上只有一个数字，提示不说就不知道它数的是什么；先例是侧栏开关的「展开侧栏 · N 个对话在等你」。要严格只写「待办」，把 `TodoToggleButton.tsx` 里给 `TooltipLabel` 的 `label` 换成 `copy.todo` 即可。
2. **在工作台或子任务里开文件预览，不再把面板算关**（票 42 算关）。理由：裁决 93「开着离开，回到 Galley 时还开着」；那个预览是那个对话的，离开就收起，回到 Galley 时这个位置是空的，面板该回来。改动审阅照旧在哪里开都算关：它是整个窗口的，换会话也开着，回到 Galley 会占住这个位置，按钮要是还亮着就和屏幕对不上。判断在 `readingPanelClosesTodo`；`LocalFileWorkspace` 用一个在 effect 里同步的 ref 知道面板此刻在不在屏上。
3. **面板 id 从 `todo-panel-b1` 改为 `todo-panel`**（照票 42 的拆法）：dogfood 里拖过的比例会丢一次，回到 320px。
4. **外置零变化不是逐字节**，见验证第 7 条。

**查过的设计禁令**（`docs/design/` 与 `docs/devlog/deferred.md` grep「不要 / 有意 / 分叉 / 禁止 / 被否 / 没选」与顶栏、工具簇、状态簇、徽标；`.scratch/main-chat/` 下没有 `deferred.md`）

- layout-and-chrome「禁止」：状态点、健康状态用颜色或动效、按钮面显示已定型的偏好，「颜色只给 warning / error 文字 badge 和 `brand` 邀请 badge」→ N 是字，不上色、不做胶囊；测试守着没有 `rounded-full`、没有 warning / error / brand。
- 「角标只放需要你处理的数」（07-30；裁决 86 第 3 条、91 第 5 条）→ 不是徽标，0 不写，不挂总数。
- 「外观类偏好…按钮面不用 brand tint」→ 选中用 `bg-selected`（与悬停不同材料，2026-08-21），照「改动」按钮。
- 「会打开 menu / popover 的 trigger 打开态要下沉 + press shadow」→ 它不是浮层触发器，用 `aria-pressed`、不带 `aria-expanded`，与「改动」一致，测试守着。
- 工具簇「按钮共用 `TopBarIconButton`，图标一律 16px thin」、「icon-only 控件用 Radix tooltip」→ 照用。
- tools-and-approvals §4.7「右侧常驻面板让 Galley 读起来像 IDE」→ 默认关。
- 记忆「加新容器（图标栏、开关）的方案被否」→ 没有新容器，进的是现有工具簇。
- deferred.md 里没有约束顶栏工具簇的条目；「长工具输出在右侧阅读面板」「Artifacts 面板」说沿用右侧面板，与面板的位置不冲突。

**验证**（分支开在 `bd3f5dbc`；开工后 main 合入票 44（`4d043463`，只动 core、文档与评测，gui 零改动），已 rebase，无冲突，下面是 rebase 之后重跑的）

1. `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：exit 0。
2. vitest 全量：本机时区与 `TZ=UTC` 各一遍，都是 `Test Files 166 passed`、`Tests 1723 passed`。
3. 六个门禁 exit 0：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check main` 无输出；新增行 grep `http`、`api_host`、`apibase`、`/Users/`、`/private/tmp`、`/var/folders`：0 处。
4. 中文标点扫新增行（自写脚本，先用坏例子自测）：中文句子 0 处；13 处是英文注释或测试名里夹中文界面词，用英文标点，不改。
5. 格式：新文件整篇 prettier；改过的旧文件 prettier 差异行数与开工时相同（`App.tsx` 11、`LocalFileWorkspace.tsx` 21、`en.ts` 40、`zh.ts` 13，其余 0）。
6. 反向检查 17 处都挂（每处改完跑对应测试，再按 sha256 还原）：0 也写数字、数字做成徽标、不给选中态、外置也出按钮、排到「改动」后面、顶栏总是容器、不写本机、启动不读本机、读值放宽、别处的预览也算关、审阅不算关、子任务算开着、按钮去落地 Galley、面板宽 380、勾掉的整行淡化、切换器默认 D2、字总是显示。
7. 外置零变化：从 `bd3f5dbc` 用 `git archive` 解出一份，与本分支跑同一段临时测试（不进仓库）：外置运行时的顶栏（中英、有无「改动」、有无标题，外加硬塞一个待办开关看宿主挡不挡）、内置的工作台与子任务顶栏、外置侧栏（同票 42）、内置有主对话的侧栏（基线不接那一行，即票 42 之前的样子），macOS / Windows / Linux 共 102 份标记。30 份侧栏 sha256 逐字节相同；72 份顶栏只差一个 React `useId`：「显示」按钮的 `aria-controls`（`radix-_R_9p_` → `radix-_R_dp_`），因为工具簇多了一个子节点槽位，后面兄弟的 id 路径跟着变；把 `useId` 归一后 102 份全部相同。这个 id 只在一次渲染内把「显示」按钮和它的浮层配对，不显示、不存。要逐字节相同，得把待办塞进「改动」那个槽位的条件里，代码更绕，没做。
8. 看界面：临时 Vite（5197 端口，不碰 Tauri）+ headless Chrome，跑真的 `MainHeader`、`AssistantIdentity`、`Sidebar`、`LocalFileWorkspace`、`TodoPanel`、`TodoCards`。1440 宽：D1、D2 各关、开，浅深色；开着时 `aria-pressed`、选中底色（浅 `rgb(248,237,218)`、深 `rgb(62,48,38)`），本机写入 `"1"`，刷新页面后仍开着；悬停提示「待办 · 今天 2」；671px 主区：中英、在跑、子任务在问你、最挤状态、深色开着面板（覆盖）。文件预览：面板在屏上时点文件，面板收起、按钮弹起、本机那一项删掉；面板想开着但不在屏上（模拟在工作台）时点文件，本机仍是 `"1"`。截图在会话草稿目录 `t45-harness/shots/`，不进仓库。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：WebKit 下的字宽（门槛是 Chrome 量的，字体随应用打包，差几 px 以内）、关掉 app 再开的记住、Windows。
- 文件预览「在屏上才算关」在 gui 测试里只有纯函数（gui 测试没有 DOM 环境），交互只在 harness 里看过。

**发现、没改的**

- core 的共用提示词功能地图（`core/src/managed_prompt.rs` 约第 102–103 行）仍写待办在侧栏：`Sidebar: conversations, Projects …, and the assistant's to-do ("待办" / "To-do": …)`。票 45 起入口在 Galley 对话的顶栏（与 ⌘K）。本票只改 GUI，没动；要改是这一行（静态提示词有字节预算）加 Rust 测试。手册里的「「待办」 beside this chat」仍然对。
