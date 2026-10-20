# 68 切换器：工作台区名的位置（现状 / A 字落进工作台 / B 字站在线上）× 线（加重 / 默认）

Status: ready-for-agent

来源：主聊天 PRD 裁决 120（2026-10-20，JC：「按你推荐推进」）。只改 GUI；设计文档等定档后由拆除票改。Core、runner、CLI 不动。

## 为什么

区名「工作台」现在坐在 `line-strong` 的断口里，底色由 chrome 转 app 的台阶正好从字的中线穿过：上半个字在灰上、下半个字在白上（JC 截图 2x：字墨 402–422 行、台阶 412 行）。同一条边界被画成三种：0–18px 只有底色台阶、18–51px 台阶穿过字、59px 往右是实线。JC 嫌的就是「字背后的色块」。断口语法的前提是线两边同底，这条线同时是底色交界，所以只能让字整个归上或整个归下。详见裁决 120。

## 现状（内置运行时、有主对话时）

- `gui/src/components/layout/sidebar/SidebarWorkbenchLabel.tsx`：一行 `h-[13px] items-center`；字 `shrink-0 whitespace-nowrap pl-4.5 pr-2 text-ui-label leading-[13px] text-ink-muted`；后面 `h-px min-w-0 flex-1 bg-line-strong`；行底 `linear-gradient(to bottom, transparent 6px, var(--color-app) 6px)`（`:34`），上半透明露出 chrome。
- 挂在 `gui/src/components/layout/Sidebar.tsx` 约 456 行的卡片块（`pb-1.5 pt-2`）后面，在滚动区外，跟卡片一起不动。滚动区整块 `bg-app`；吸顶的「＋ 新对话」行 `sticky top-0 z-20 bg-app pb-1 pt-1.5`；滚动区 `scroll-pt-[42px]`。
- 实测（票 67，生产构建、侧栏 296px，从侧栏顶算）：卡片 52–180.8，区名行 186.8，线 192.8，新对话按钮从 205.8 起。
- 规则出处：`docs/design/layout-and-chrome.md` §4.2「区名『工作台』」（字、和线的关系、底在线上转）与「下面那块的底与分隔线」。外置运行时（`sectioned` 为假）没有区名，一套冻结。

## 档位

两个维度，档位只在开发版有（`import.meta.env.DEV`），默认是「现状 + 加重」，与生产一个像素都不差。

**位置**

- **现状**：一个像素都不变。
- **A 字落进工作台**：
  - **线**：1px，从侧栏左缘画到右缘，不断开，就是 chrome 与 app 的交界：线以上 chrome，线以下 app。
  - **字**：整个在 app 上，是工作台区的第一行，从侧栏网格左线（18px）起。字的配方不变（`text-ui-label`、常规字重、`ink-muted`、不转大写、不加字距）。
  - **距离**：主会话的示意是线到字的行框顶 6px、字的行框底到新对话按钮 6px，比现在多 7px。你定实际数，约束：线到字顶 ≥4px，字底到新对话按钮 ≥4px，总共比现在多出 ≤7px，尽量压到 3–5px。写数和理由。
  - 区名照旧在滚动区外、跟卡片一起不动；列表滚动时行滑进吸顶新对话行下沿的渐隐照旧。
- **B 字站在线上**：
  - **字**：整个在 chrome 上，同样的配方与左线。
  - **线**：通栏 1px，从左缘到右缘，在字下面，字墨底到线约 3px（中文字墨贴近行框底，量实际像素定）；线以下 app。
  - **距离**：线到新对话按钮现在是 13px，B 里保持 10–13px；总共比现在多出 ≤7px。写数。
  - 卡片悬停时的 `bg-hover` 铺在卡片自己的圆角块上，确认它不压到字。

**线**

- **加重**：`line-strong`（现在）。
- **默认**：`line`。
- 三档位置都能配。两种线在浅色、深色下分别对 chrome、app 算一下 CIE ΔL*，写进回报（票 62 的算法：浅色 app 比 chrome 亮 3.85、深色暗 2.57 那一套）。

## 切换器

照票 62 的做法：`git show f913a212` 里的 `gui/src/components/layout/sidebar/zones-trial/`（store、pill、测试），票 65 把它拆掉了，可以抄结构。

- 一个常驻可点击的 pill，portal，`pointer-events: auto`，不挡侧栏；位置同以往（主区顶栏下沿右端，top 50px、right 12px）。文字「临时 · 区名 现状 A B | 线 加重 默认」。
- 只在开发构建、内置运行时且有主对话时挂；生产构建一直是现状 + 加重。
- 选择存 `localStorage` 的 `galley.tmp.workbenchLabelTrial.tier` 与 `.line`，读写都包 try/catch，读不到当默认。
- 每个分支点都带注释「票 68 临时切换器，定档后由拆除票删掉」，`grep -rn "票 68" gui/src` 能找全，测试也守着这一条。临时代码放一个新文件夹（如 `sidebar/label-trial/`），旧文件只在分支点加判断。

## 要守住的

- 外置运行时逐像素不变。
- 「现状 + 加重」与基点逐像素一致。
- 侧栏收起、窄宽（最窄 134px）、深色、中英文（英文「Workbench」更宽）：各档都不出错；区名在最窄宽度下不换行、不截断。
- 卡片的选中描边、悬停、按下照旧。
- 选中行滚进视野（`scroll-pt-[42px]`）照旧；你若改了吸顶行的内边距，`scroll-pt` 跟着算。
- Windows：区名行在滚动区外，A、B 的通栏线横过滚动条通道上方，说清楚它和下面 10px 通道的关系。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。

## 别动

- 主区、顶栏、卡片内部与卡片块的 `pt-2`、会话行、项目组、时间桶、「已归档」。
- 设计文档（定档后由拆除票改）。
- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 单测：默认档的 DOM 与 class 和现状一致；A、B 各渲染出一个区名，字在对的底上（A 在 app、B 在 chrome），线通栏；线档切换 `line-strong` / `line`；外置运行时不受档位影响；生产构建（非 DEV）忽略本机存的档位；「票 68」都找得到。
- 自查截图（放 `/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/c580e5ad-5e9f-499f-a462-4283d029147f/scratchpad/t68/`，文件名带 `t68-` 前缀，不进仓库）：三档 × 两种线 × 浅色 / 深色 × 中文，外加英文、最窄 134px、列表滚动后、侧栏收起、外置运行时；「现状 + 加重」与基点同一个 harness 逐像素比。另拼一张总览图（三档 × 两种线，浅色、中文），给 JC 先看。数据用合成的，或 `workbench.db` 的只读副本（副本放 scratchpad，用完删）。截完删掉临时页，**自己起的 Vite / 浏览器进程全部停掉**。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：A、B 各自的结构与数值（线在哪、字在哪块底上、实际多出的高度、线到字与字到按钮的距离），线档怎么切，切换器在哪。
3. 两种线在两个主题、两种底上的 ΔL*。
4. 验证命令与结果原样（测试条数、两个时区）。
5. 截图的绝对路径与每张一句话；总览图单列。
6. 看到但没改的问题。

## 给 JC 的真机步骤

只改 GUI，tauri dev 热更即可，不用重启。pill 在主区顶栏下沿的右端：「临时 · 区名 现状 A B | 线 加重 默认」。

1. 在现状、A、B 之间切，看卡片和列表之间那一段：字背后还有没有色块，边界是不是一条。
2. 每档再切「线 加重 / 默认」，看通栏的线是不是太重。
3. A 档专门看一眼「工作台」和下面「项目」「本周」的层级：常规字重的区名比 semibold 的桶标题还淡，能不能接受。
4. 切深色再看一遍；拉到最窄，看区名有没有被截断。
5. 已知：pill 会压住待办面板打开时的右上角（同票 55、62）。

## Comments
