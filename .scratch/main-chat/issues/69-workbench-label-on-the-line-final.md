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
