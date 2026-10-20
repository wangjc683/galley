# 69 定稿：拆票 68 的切换器，区名放回线上，19px 软过渡加居中进生产，设计文档定稿

Status: ready-for-agent

来源：主聊天 PRD 裁决 120 第 6 条（2026-10-20，JC：「①′ + 居中，我感觉比较接近我想要的感觉：安静地介绍用户工作台区域」）。依赖 68（已合入）。改 GUI 与文档；Core、runner、CLI 不动。

## 要做成什么样

内置运行时、有主对话时，卡片块与工作台之间那一段（从侧栏顶算，侧栏 296px；数值与今天相同，**高度不变**）：

- 卡片 52–180.8（不动）。
- **软过渡**：从卡片块下沿那 6px 起（180.8），到区名那一行底（199.8），一共 19px，底色由 `chrome` 线性渐变到 `app`；以下照旧整块 `app` 铺到窗口底。不再有任何硬的底色台阶：今天那道在 186.8 + 6px 处的硬切去掉。渐变只在这 19px 里，不压到卡片自己的块上（卡片的悬停底、按下下沉 1px 照旧画在卡片上）。
- **区名行**：186.8–199.8（13px），线 1px 在行内 6px 处（192.8），`line-strong`。
- **居中**：字落在侧栏的中轴上（与舞台卡片同一条轴），线分左右两段，各隔字 8px，左段画到侧栏左缘、右段画到侧栏右缘。区名不再从网格左 18px 线起。
- **字**：配方不变：`text-ui-label`（11px）、常规字重、`ink-muted`、不转大写、不加字距，中文「工作台」、英文「Workbench」（`copy.sidebar.zoneWorkbench`）。
- 新对话按钮仍从 205.8 起；吸顶新对话行、它下沿的渐隐、`scroll-pt-[42px]` 不动。

示意（主会话画的，不是真机）：`/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/c580e5ad-5e9f-499f-a462-4283d029147f/scratchpad/wb-label-mock2.html` 里的「④ 软过渡 + 居中」，换成「①′」那种 19px 渐变。

## 改什么

### 1. 拆票 68 的切换器

- 删 `gui/src/components/layout/sidebar/label-trial/` 整个文件夹与 `gui/src/components/layout/sidebar/SidebarWorkbenchLabel.label-trial.test.tsx`。
- `gui/src/App.tsx`：删 pill 的 import 与挂载（带「票 68」注释的两处）。
- `gui/src/components/layout/sidebar/SidebarWorkbenchLabel.tsx`：删档位钩子与分支，只留生产的一种。
- 完成后 `grep -rn "票 68" gui/src` 为空；生产构建的主包里没有 `label-trial`、`临时 · 区名`、`galley.tmp.workbenchLabelTrial`、`data-label-trial`。
- 照票 67 的做法，把这些名字加进 `gui/src/components/layout/Sidebar.main-chat.test.tsx` 的「遗留清单」，守着不回来。

### 2. 生产的区名

- 在 `SidebarWorkbenchLabel.tsx` 里做居中与 19px 渐变。卡片块现在是 `Sidebar.tsx` 约 456 行的 `pb-1.5 pt-2`：渐变要盖住它下沿那 6px，怎么分你定（比如把这 6px 挪进区名元素，让一个元素拥有整段 19px），写清理由。区名照旧在滚动区外、跟卡片一起不动。
- 改写 `SidebarWorkbenchLabel.tsx` 头部注释与 `Sidebar.tsx` 里提到「工作台 ━━━━」和卡片块留白的注释（约 137、451 行），照新做法写：为什么放回线上、为什么软过渡（台阶只在没画线的两段露出）、为什么居中（票 67 起卡片是居中舞台）。注释密度照周围代码。

### 3. 测试

- 生产区名：一个区名，字在两段线中间、两段线等宽伸展、都是 `line-strong`；行底是 19px 的 chrome → app 渐变（断言样式），没有硬切的那种渐变；高度与今天相同（卡片块加区名行一共 6 + 13）。
- 外置运行时没有区名。
- 原来钉在左对齐、6px 硬切上的断言改成新的。

### 4. 设计文档与 devlog

- `docs/design/layout-and-chrome.md` §4.2：
  - 「侧栏网格」（约 231 行）：左 18px 线的清单里去掉区名，写明区名居中在舞台的轴上（2026-10-20 起，裁决 120 第 6 条；10-19 至 10-20 在左 18px 线上）。
  - 「有主对话时」的示意图（约 253 行）：区名那行改成居中「━━━━ 工作台 ━━━━」。
  - 「区名『工作台』」（约 275–279 行）：「和线的关系」重写（居中、两段线、8px、到两缘；为什么居中；和桶标题怎么分：居中 vs 左线、不带计数、坐在线上、在滚动区外）；「底在线上转」改写成软过渡（机制、19px、从卡片块下沿起；历史一句：10-19 至 10-20 在行内 6px 硬切，台阶从字的中线穿过）；加一句票 68 比过 A 字落进工作台、B 字站在线上，都不要，理由照裁决 120 第 6 条。
  - 「助手卡片」的「构造」（约 266 行）里卡片块下方 6px 的写法与代码出处，若你挪了这 6px，照实改；实测数值不变就照旧。
  - 「下面那块的底与分隔线」（约 280–283 行）：补软过渡与线的关系，「线以下整块铺 `bg-app`」照实改。
- devlog：新建 `docs/devlog/2026-10-20-workbench-label-on-the-line.md`（起因、诊断、票 68 的 A / B 与线的两档、主会话推荐 A 被 JC 的真机实感推翻、放回线上的几种做法与没选的、定下的做法、真机要看的两点），在 `docs/devlog/README.md` 的「2026-10-20」下登记一行。来源都在 `.scratch/main-chat/PRD.md` 裁决 120 与票 68 的 Comments。

## 要守住的

- 外置运行时逐像素不变。
- 窄宽（最窄 134px）、深色、中英文、侧栏收起：不出错；区名在最窄宽度下不换行、不截断，两段线可以缩到很短。
- 卡片的选中描边、悬停、按下照旧，渐变不盖到卡片上。
- 选中行滚进视野照旧。
- Windows：区名行在滚动区外，中轴与卡片同一条；说清楚它和 10px 滚动条通道的关系。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。
- 中文文档与注释用全角标点。

## 别动

- 主区、顶栏、卡片内部、会话行、项目组、时间桶、「已归档」、吸顶新对话行。
- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`、`pnpm --dir gui build`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 文档链接门禁：`node scripts/check-docs-links.mjs`。
- 生产构建自查截图（放 `/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/c580e5ad-5e9f-499f-a462-4283d029147f/scratchpad/t69/`，文件名带 `t69-`，不进仓库）：浅色 / 深色 × 中文 / 英文，最窄 134px，卡片悬停与按下，列表滚动后，Windows 滚动条（去掉 `--hide-scrollbars` 才截得到滑块），外置运行时与基点逐像素比。交界那一段 2x 放大，浅深各一张，给 JC 先看。量一遍上面的数值（卡片、渐变起止、线、按钮），写进回报。截完自己起的 Vite / 浏览器进程全部停掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：渐变怎么铺（哪个元素、19px 从哪到哪）、卡片块那 6px 怎么分的、居中怎么做、实测数值。
3. 拆了什么、遗留清单加了什么、生产包 grep 的结果。
4. 文档改了哪些段落。
5. 验证命令与结果原样（测试条数、两个时区）。
6. 截图的绝对路径与每张一句话；交界放大图单列。
7. 看到但没改的问题。

## 给 JC 的真机步骤

只改 GUI，tauri dev 热更即可，不用重启；pill 没了。

1. 看卡片和列表之间那一段：字背后还有没有色块，「工作台」是不是安静地坐在线的正中。
2. 切深色：渐变会不会像卡片块投下的影子。
3. 扫一眼：居中的区名会不会读成对话里那种时间分隔。
4. 拉到最窄，看区名有没有被截断。

## Comments

- 2026-10-20（实现子代理）：已在分支 `main-chat-69-workbench-label-final`（基点 `50dc9ef9`）做完，代码一个提交 `ef58915c`，设计文档与 devlog 一个提交 `f4d6896d`，本说明一个提交，待主会话合入与 JC 真机。
  - **拆了什么**：`gui/src/components/layout/sidebar/label-trial/` 整个文件夹（store、A / B 两档、pill、两个测试；票面写的 `SidebarWorkbenchLabel.label-trial.test.tsx` 实际在这个文件夹里，一并删了）；`App.tsx` 里 pill 的 import 与挂载两处（`App.tsx` 与票 68 之前的 `5223a293` 逐字节相同）；`SidebarWorkbenchLabel.tsx` 的档位钩子与分支。`grep -rn "票 68" gui/src` 为空。`Sidebar.main-chat.test.tsx` 的「遗留清单」加上 `galley.tmp.workbenchLabelTrial`、`label-trial`、`WorkbenchLabelTrial`、`labelLineClass`、`LABEL_TIERS`、`data-label-trial`、`临时 · 区名` 与拆开拼写的「票 68」。生产构建主包（`gui/dist/assets/index-*.js`）grep：`label-trial`、`临时 · 区名`、`galley.tmp.workbenchLabelTrial`、`data-label-trial`、`WorkbenchLabelTrial`、`transparent 6px` 都是 0 处；`var(--color-chrome), var(--color-app)`、`h-[19px]` 各 1 处。
  - **渐变**：区名元素一个人拥有整段 19px（`SidebarWorkbenchLabel.tsx:66` 起，`:71` `flex h-[19px] shrink-0 items-center pt-1.5`），底是 `linear-gradient(to bottom, var(--color-chrome), var(--color-app))`（`:51` `WORKBENCH_GROUND`），没有色标、没有透明段。卡片块下面那 6px 从卡片块的 `pb-1.5` 挪进区名元素的 `pt-1.5`（`Sidebar.tsx:469` 现在是 `pt-2`）：一个元素画一整段渐变，不用在两个元素之间拼色标（拆成卡片块底 6px 加区名行 13px 要算 6/19 处的中间色，两处必须对得上）；两端分别就是卡片块的 chrome 与列表的 app，没有边。
  - **焦点环**：区名元素画在卡片块后面，卡片外 2px 的键盘焦点环下沿会被渐变盖住（探针：去掉定位后环下沿那 4 个物理像素变成渐变色）。卡片块只在环亮着时定位（`Sidebar.tsx:469` 的 `has-[:focus-visible]:relative`），把卡片画在区名上面。先试过常驻 `relative`：无头 Chrome 在带 Windows 滚动条的页面上把卡片（脸、名字、第二行）光栅化得差一两级色值（基点上加 `relative` 与分支逐像素相同、分支去掉后与基点相同，确认是它），所以只在焦点时定位，静止的卡片与基点逐像素相同。悬停底止于卡片下沿；按下时卡片的 `translate` 本来就把它画在渐变上面。
  - **居中**：左段线、字、右段线三个兄弟，两段线都是 `h-px min-w-0 flex-1 bg-line-strong`（`:39`），字 `shrink-0 whitespace-nowrap px-2`（`:37`），等宽伸展，字落在侧栏中轴，与卡片同一条轴，各隔字 8px，两段画到两缘。
  - **实测**（生产构建、无头 Chrome 2x，从侧栏顶算，aside 296px、内容 295px）：卡片 52–180.8；区名元素 180.8–199.8（渐变起止）；字行 186.8–199.8；线 192.8（1px）；新对话按钮 205.8；列表从 199.8 起。中文字框 123–172、中轴 147.5，两段线各 123px；英文字框 109.66–185.33、中轴 147.5，两段各 109.66 / 109.67；卡片中轴 147.5。134px 时中文每段 42px、英文 28.66 / 28.67，字不换行、不截断，侧栏不横向溢出。左缘取色（浅色）：180.8 处 239，逐行升到 199.5 处 250，线所在两行 212，基点是 192.8 处 239 → 250 一步跳；深色 25 → 20。Windows：滑块顶 201.8，离线底 8px，与基点相同。
  - **测试**：`Sidebar.main-chat.test.tsx` 原来钉左对齐与 6px 硬切的那条换成两条：一条钉区名元素的整段标记（左段线、字、右段线，`line-strong` 只有这两段，不再有 `pl-4.5`，中英文各一遍）；一条钉渐变样式（只有 chrome → app 一段、没有 px / % 色标与 `transparent`）与高度（区名元素 `h-[19px] pt-1.5`、行 13px，卡片块只剩 `pt-2` 并在焦点时定位，吸顶行与 `scroll-pt-[42px]` 不变）。外置运行时那条加上没有渐变、没有这个卡片块。
  - **文档**：`layout-and-chrome.md` §4.2「侧栏网格」左 18px 的清单去掉区名、写明居中在舞台的轴上；示意图区名行改成居中；「构造」里卡片块下方 6px 改写（归区名元素、焦点时定位、出处 `Sidebar.tsx:469`，实测数照旧）；「区名『工作台』」标题括注加票 68、69 与 devlog，「和线的关系」重写（居中、两段、8px、到两缘、最窄宽度的数、为什么居中、和桶标题怎么分、线固定 `line-strong` 的理由、Windows 滚动条通道、A / B 为什么都不要、主会话推荐 A 被推翻、没选的小签与同底、历史一句），「底在线上转」改成「底是软过渡」（机制、19px、出处、为什么、渐变不压卡片、真机要看、没选的 13px、历史一句）；「下面那块的底与分隔线」标题、底、线三处补了软过渡。新 devlog `docs/devlog/2026-10-20-workbench-label-on-the-line.md`，`docs/devlog/README.md` 的「2026-10-20」下登记一行。顺手把 `Sidebar.tsx` 头部注释里「卡片是 IM 列表的一行」改成舞台（票 67 起就不是了）。
  - **验证**：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`、`pnpm --dir gui build` 通过；`node scripts/check-docs-links.mjs` 463 个文件通过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 的 `pnpm --dir gui test` 各 178 个文件 1946 条全过（票 68 时 180 / 1959，少的是删掉的两个试验测试文件 14 条，多一条新测试）。新增行没有本机路径；中文文档与注释的半角标点扫过，只剩英文注释里嵌的中文引号。
  - **自查**（scratchpad，文件名带 `t69-`，不进仓库）：harness 用真 `Sidebar`（收起用真 `AppShell`），合成数据，分支与基点 `50dc9ef9` 各打一个生产包静态服务，无头 Chrome 2x 各 27 张：浅深 × 中英、134px 中英与深色英文、卡片悬停 / 按下 / 键盘焦点 / 选中 / 深色悬停与按下、列表滚动后浅深、选中行滚进视野、侧栏收起、Windows 浅深与滚动后（去掉 `--hide-scrollbars`）、外置运行时 7 组。外置运行时 7 组与基点逐像素、DOM 都相同；侧栏收起逐像素相同；内置运行时 19 组的差别全部落在 181–199.5 这一段（区名元素），卡片与列表逐像素不动，选中行滚进视野的 `scrollTop` 两边都是 911。
  - **看到没改**：一、深色的渐变只跨 5 级色值（25 → 20）、浅色 11 级，Chrome 画渐变带抖色，WKWebView 若不抖，深色下可能看得出 3–4px 一级的细台阶，真机顺带看。二、Windows 下列表内容在 10px 滚动条通道左边，它的中轴比区名与卡片偏左 5px（列表一直如此，写进了文档，没改）。三、常驻定位改变卡片光栅化这件事只在无头 Chrome 的 Windows 滚动条模式下测到，真 WebView2 与 WKWebView 测不了；现在只在键盘焦点时定位，焦点那一下若卡片字有一两级色值的跳动属于同一原因。四、`App.tsx` 本来就不是 prettier-clean，没动它的格式。
