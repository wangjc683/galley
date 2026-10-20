# 70 工作台不挂区名：有对话时只留线，名字挪进空状态那句提示

Status: needs-dogfood（2026-10-20 合入 `c0799813`、`e91a55db`、`99e0a775`；主会话复跑门禁：typecheck、lint、`git diff --check`、文档链接门禁、`TZ=UTC` 与 `TZ=America/Los_Angeles` 各 178 个文件 1946 条测试全过，新增行没有本机路径，`gui/src` 里 `SidebarWorkbenchLabel`、`zoneWorkbench` 只剩遗留清单；看过有对话与新用户的浅深截图。等 JC 真机看一眼）

来源：主聊天 PRD 裁决 121（2026-10-20，JC：「按你推荐推进」）。依赖 69（已合入）。改 GUI 与文档；Core、runner、CLI 不动。

## 为什么

区名「工作台」的两件事都不再需要它常驻：两区现在由票 67 的舞台卡片、`line-strong` 与底色分开；这个词在产品里只出现在区名上，是一次性的说明，不是要记住的地名。所以名字只在列表还空着、最需要解释的时候出现，在空状态那句提示里；有对话时只留线。详见裁决 121。

## 要做成什么样

只在内置运行时、有主对话时（`sectioned` 为真）；外置运行时逐像素不变。

- **不挂区名**：卡片块与列表之间没有「工作台」那一行。
- **线**：卡片块下沿一条通栏 1px `line-strong`，从侧栏左缘到右缘，就是 chrome 与 app 的交界：线以上卡片块的 chrome，线以下滚动区的 app。底色在线下转、被线盖住，不再有渐变。这是 10-12 至 10-19（票 09 起、票 62 之前）的画法，当时是卡片块上的 `border-b border-line-strong`（`git show f913a212^:gui/src/components/layout/Sidebar.tsx` 约 446 行）。
- **间距**：卡片块照票 67 的 `pt-2` 加 `pb-1.5`（卡片上方 8px、下方 6px，卡片自带上下 6px），线在卡片块下沿；线到新对话按钮是吸顶行原有的 `pt-1.5`。从侧栏顶算（296px），预期：卡片 52–180.8，线 186.8，新对话按钮 193.8（今天 205.8，列表上移 12px）。量实际数写进回报；如果你看着卡片到线太挤，写出来，别自己改间距。
- **空状态提示**：人开的对话一条都没有时（`!hasHumanChats`，规则不变：「其他来源」里 agent 开的不算），新对话行下面那句从「你的对话会出现在这里。」改成「工作台：你另开的对话会出现在这里。」，英文「Workbench: conversations you start will appear here.」。只改内置那一处（`SidebarAssistantEmptyHint`，`gui/src/components/layout/sidebar/SidebarAssistant.tsx:388`）：新加一个文案键（比如 `sidebar.emptyWorkbench`），中英两份；外置用的 `sidebar.emptySessions`（`Sidebar.tsx:554`）不动。样式照旧。

## 改什么

1. **区名拆掉**：删 `gui/src/components/layout/sidebar/SidebarWorkbenchLabel.tsx`；`Sidebar.tsx` 删它的 import 与挂载（约 28、478 行）；删 `zoneWorkbench` 文案键（`zh.ts:173`、`en.ts:190`，以及类型里若有）。
2. **卡片块**（`Sidebar.tsx:469`，今天是 `pt-2 has-[:focus-visible]:relative`）：改成带下边线的块。票 69 加 `has-[:focus-visible]:relative` 是因为区名元素画在卡片块后面、渐变盖住了卡片焦点环的下沿；区名没了，焦点环（卡片外 2px）落在卡片块自己的 6px 下内边距里，确认它不再被盖住后把这个定位去掉；被盖住就留着并写清楚。
3. **注释**：`Sidebar.tsx` 头部注释（约 132–145 行，「━━ 工作台 ━━」那段）与卡片块上方那段注释（约 444–468 行）照新做法改写：为什么不挂区名（裁决 121 第 1 条）、名字在哪（空状态提示）、线与底色的关系、什么时候重新考虑（第 5 条）。`SidebarAssistantEmptyHint` 的注释跟着改。注释密度照周围代码。
4. **测试**：`gui/src/components/layout/Sidebar.main-chat.test.tsx` 等处原来钉在区名上的断言改掉：内置有主对话时没有 `data-sidebar-zone-label`、卡片块带 `border-line-strong` 下边线；内置空列表时提示是新文案；外置空列表时提示仍是「你的对话会出现在这里。」；外置没有那条卡片块的线。照票 67、69 的做法把 `SidebarWorkbenchLabel`、`zoneWorkbench`、`WORKBENCH_GROUND`、`data-sidebar-zone-label` 加进「遗留清单」。
5. **设计文档**（`docs/design/layout-and-chrome.md` §4.2）：
   - 「区名『工作台』」那一节改成「工作台不挂区名」（2026-10-20 起，裁决 121）：理由、名字在空状态提示里（中英原文）、规则（只看列表空不空）、没选的（学会后隐藏、直接去掉、保持常显）、什么时候重新考虑；历史一段：10-19 至 10-20 区名坐在线上（票 62 左对齐、6px 硬切；票 68 比过 A / B；票 69 居中加 19px 软过渡），台阶与色块的诊断链到 devlog。
   - 「有主对话时」的示意图：区名那行去掉，只画线。
   - 「侧栏网格」：去掉区名居中那句。
   - 「助手卡片」的「构造」：卡片块下方 6px、焦点时定位、区名行与按钮的实测数值照实改。
   - 「下面那块的底与分隔线」：线回到卡片块的下边线、底色在线下转；去掉软过渡。
   - 全文 grep「区名」「工作台」「zoneWorkbench」「软过渡」，凡是说区名现状的都照实改；历史句保留。
   - 空状态：§4.2 里写内置空状态提示文案的地方（grep「你的对话会出现在这里」）改成新文案，外置的照旧。
6. **devlog**：在 `docs/devlog/2026-10-20-workbench-label-on-the-line.md` 末尾加一节「同日再收：区名挪进空状态提示（裁决 121）」（JC 的原话、两件事的账、做法、没选的、推翻了什么、重新考虑的条件、真机要看的）；`docs/devlog/README.md` 里这篇那一行的摘要末尾补一句。
7. **project-status**：`docs/project-status.md` 约 804 行「「工作台」 sits on the line between the assistant and the workbench」那句照实改（区名不再常驻，名字在空状态提示里），英文，同一段落的其余文字不动。

## 要守住的

- 外置运行时逐像素不变（侧栏、空状态提示都是）。
- 窄宽（最窄 134px）、深色、中英文、侧栏收起：不出错；新提示在最窄宽度下照现在的提示一样换行或截断（照旧样式，不要另做）。
- 卡片的选中描边、悬停、按下、键盘焦点环照旧。
- 选中行滚进视野（`scroll-pt-[42px]`）照旧。
- Windows：线在滚动区外、画到侧栏右缘，与 10px 滚动条通道的关系写一句。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。
- 中文文档、注释、devlog 用全角标点。

## 别动

- 主区、顶栏、卡片内部、会话行、项目组、时间桶、「已归档」、吸顶新对话行。
- 外置运行时的一切。
- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`、`pnpm --dir gui build`、`node scripts/check-docs-links.mjs`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 生产构建自查截图（放 `/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/c580e5ad-5e9f-499f-a462-4283d029147f/scratchpad/t70/`，文件名带 `t70-`，不进仓库）：浅色 / 深色 × 中文 / 英文，有对话与新用户（列表空）各一套；最窄 134px（含新提示）；卡片悬停、按下、键盘焦点；列表滚动后；Windows 滚动条（去掉 `--hide-scrollbars`）；外置运行时与基点逐像素比。另拼一张给 JC 先看的：浅色中文，有对话与新用户并排，外加深色同一组。截完自己起的 Vite / 浏览器进程全部停掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：线怎么画、焦点环的处理、空状态提示的文案键、实测数值（卡片、线、按钮）。
3. 拆了什么、遗留清单加了什么、生产包 grep（`SidebarWorkbenchLabel`、`zoneWorkbench`、`工作台：你另开的对话`）。
4. 文档改了哪些段落。
5. 验证命令与结果原样（测试条数、两个时区）。
6. 截图的绝对路径与每张一句话；给 JC 的那张单列。
7. 看到但没改的问题。

## 给 JC 的真机步骤

只改 GUI，tauri dev 热更即可，不用重启。

1. 看卡片和列表之间：只剩一条线，会不会显得光秃、生硬。
2. 看间距：列表上移约 12px，卡片到线够不够透气。
3. 新用户的空状态你的机器上看不到，看回报里那张截图。

## Comments

- 2026-10-20（实现子代理）：已在分支 `main-chat-70-workbench-empty-hint`（基点 `02d19289`）做完，代码一个提交 `c0799813`，设计文档与 devlog 一个提交 `e91a55db`，本说明一个提交，待主会话合入与 JC 真机。
  - **拆了什么**：`git rm` 了 `gui/src/components/layout/sidebar/SidebarWorkbenchLabel.tsx`；`Sidebar.tsx` 删它的 import 与挂载（连同包着卡片块与区名的 fragment）；`zh.ts`、`en.ts` 删 `zoneWorkbench` 与它的注释（类型由 `zh.ts` 推出，没有单独的类型要改）。`Sidebar.main-chat.test.tsx` 的「遗留清单」加上 `SidebarWorkbenchLabel`、`zoneWorkbench`、`WORKBENCH_GROUND`、`data-sidebar-zone-label`。生产构建主包（`gui/dist/assets/index-*.js`）grep：`SidebarWorkbenchLabel`、`zoneWorkbench`、`data-sidebar-zone-label`、`has-[:focus-visible]:relative`、`h-[19px]`、`var(--color-chrome), var(--color-app)` 都是 0 处；`工作台：你另开的对话`、`Workbench: conversations you start`、`你的对话会出现在这里`（外置那一句）、`border-b border-line-strong pb-1.5 pt-2` 各 1 处。
  - **线**：卡片块 `Sidebar.tsx:471` 现在是 `border-b border-line-strong pb-1.5 pt-2`，块是侧栏竖排的直接子元素、没有左右内缩，所以线从侧栏左缘画到右缘；块以下紧接滚动区（`bg-app`），底色就在线下转，台阶被线盖住。卡片块上方那段注释（`:446` 起）照新做法改写：为什么不挂区名（裁决 121 第 1 条）、名字在空状态提示里、线与底色的关系、Windows 滚动条通道、什么时候加回来（第 5 条，从票 69 的做法起步）；头部注释（`:135` 起）同改；滚动区上那句「底从区名下面起」改成从线下起。
  - **焦点环**：`has-[:focus-visible]:relative` 去掉了。卡片外 2px 的环落在卡片块自己的 6px 下内边距里（180.8–182.8），后面的滚动区从 187.8 起，碰不到它。探针：浅深各拍一组「焦点 / 给卡片块加 `position: relative; z-index: 50` 后焦点 / 无焦点」，前两张逐像素差最大 2 级（整张卡片都有，是定位带来的光栅化差，同票 69 记过的那种），环下沿那几行最大 1 级；环下沿的颜色浅色 `rgb(232,217,207)`、深色 `rgb(82,68,62)`，与无焦点时的底差 20 级以上，说明环完整画出、没被盖。
  - **空状态提示**：新文案键 `copy.sidebar.emptyWorkbench`（`zh.ts:174`「工作台：你另开的对话会出现在这里。」，`en.ts:191`「Workbench: conversations you start will appear here.」），只在 `SidebarAssistantEmptyHint`（`SidebarAssistant.tsx:394`）用，样式照旧（`mx-1.5 px-3 py-2 text-[12.5px] italic text-ink-muted`），出现规则照旧（`!hasHumanChats`，`Sidebar.tsx:547`）；注释跟着改。外置的 `emptySessions` 与 `Sidebar.tsx` 里那一处没动。
  - **实测**（生产构建、无头 Chrome 2x，从侧栏顶算，侧栏 296px）：卡片 52–180.8；线 186.8（1px，浅色 rgb(212,210,207)、深色 rgb(65,70,78)，侧栏左缘到右缘取色都是线色）；列表从 187.8 起；新对话按钮 193.8（基点 205.8，上移 12px），与票面预期一致。静止时第二行字墨底到线 14.8px；悬停底止于卡片下沿，离线 6px，按下下沉 1px 时 5px。看着不挤，没改间距。新用户：提示框从 229.8 起（基点 241.8），296px 时中文一行、英文两行；134px 时中文三行、英文四行（基点那句中文两行、英文四行），照常换行，不截断，侧栏不横向溢出。选中行滚进视野：行在列表里的位置与基点相同（514.8–562.8，列表底 570.5），`scrollTop` 899（基点 911，列表高了 12px）。Windows：线在滚动区外、横在 10px 滚动条通道上方画到侧栏右缘，通道从线下开始，滑块顶约 190（离线底约 2px；基点有区名那一行时 202，离线底约 8px）。
  - **测试**：`Sidebar.main-chat.test.tsx` 钉区名与软过渡的两条换成两条：一条钉「不挂区名」（中英文都没有 `data-sidebar-zone-label`、没有「工作台」「Workbench」那个字，`line-strong` 只有一处、就是卡片块的下边线，卡片块是侧栏竖排的直接子元素）；一条钉「底在线下转」（卡片块只装卡片、不定位，卡片块之后紧接滚动区，没有 chrome → app 渐变，只剩吸顶行那一道渐隐，吸顶行不变）。空状态那条改成新文案（整段 `<p>` 样式照旧、在吸顶行之后、不是外置那句、agent 开的不算、第一条人开的对话来了连「工作台」一起消失），英文那条改成新英文；外置那条加上空列表仍是「你的对话会出现在这里。」（中英、整段样式）且不含「工作台」，没有卡片块、线与渐变。其余用到 `EMPTY` 的子任务两条照旧通过（常量换成新文案）。
  - **文档**：`layout-and-chrome.md` §4.2：「侧栏网格」删掉区名居中那句；「已归档」那条的指向改到「『已归档』归工作台」；「有主对话时」开头写明 10-19 至 10-20 挂过区名、10-20 起不挂；示意图区名那行换成通栏的线、卡片下方 6px 的注释改成仍是 chrome；「构造」里卡片块下方 6px、下边线与出处、焦点环不定位与探针、实测（线 186.8、列表 187.8、按钮 193.8、字墨到线、悬停底到线），票 67 至 69 的数挪进历史；「区名『工作台』」整节（连同「字」「和线的关系」「底是软过渡」三条）换成「工作台不挂区名」（JC 原话、为什么、名字在哪、规则、没选、什么时候重新考虑、历史：票 62 左对齐与硬切、票 68 的 A / B、票 69 的居中加 19px 软过渡、推翻了哪些裁决，诊断链到 devlog），「『已归档』归工作台」留在这一节下、两处「区名那条线」改实；「下面那块的底与分隔线」标题补票 70，底与线两条改回卡片块下边线、底色在线下转、去掉软过渡，补 Windows 一句；「空态」改成新文案（中英、文案键、外置照旧、两个组件两个键、换行实测、历史）。devlog `2026-10-20-workbench-label-on-the-line.md` 末尾加「同日再收：区名挪进空状态提示（裁决 121）」，`docs/devlog/README.md` 那一行末尾补一句；`project-status.md` 那句改成线上不常驻名字、名字在空列表那一句里（英文，同段其余文字与折行不动）。另外顺手改了票面没列的 `docs/copy-language-guidelines.md` 一处：「叫法」下面那条写着内置空列表是「你的对话会出现在这里。」，补上 10-20 起的新句与外置照旧。
  - **验证**：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check 02d19289 HEAD`、`pnpm --dir gui build` 通过；`node scripts/check-docs-links.mjs` 463 个文件通过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 的 `pnpm --dir gui test` 各 178 个文件 1946 条全过（与票 69 相同：换掉两条、加回两条）。新增行没有本机路径；中文文档与注释的半角标点扫过，只剩英文注释、英文 project-status 里嵌的中文引号。
  - **自查**（scratchpad，文件名带 `t70-`，不进仓库）：harness 用真 `Sidebar`（收起用真 `AppShell`），合成数据（有对话 29 个内置会话加 1 个项目；新用户只有主对话；外置 14 个与空列表），分支与基点 `02d19289` 各打一个生产包静态服务，无头 Chrome 2x 各 40 张：浅深 × 中英（有对话、新用户各一套）、134px（有对话中英与深色英文、新用户中英与深色中文）、卡片悬停 / 按下 / 键盘焦点 / 选中与深色悬停 / 按下 / 焦点、滚动后浅深、选中行滚进视野、侧栏收起、Windows 浅深 / 滚动后 / 新用户（去掉 `--hide-scrollbars`）、外置运行时 11 组（含空列表中英、深色、134px）。外置 11 组与基点逐像素、DOM 都相同；侧栏收起逐像素相同；内置各组的差别都从 181 行起（卡片下沿以下），卡片本身逐像素不动。另拼了给 JC 的一张（浅色中文有对话与新用户并排，下面深色同一组）与改前改后对照。
  - **看到没改**：一、Windows 下滑块顶离线底只剩约 2px（有区名时 8px）：列表从线下直接开始，系统滑块贴着线，票 68 记过 B 档 5px 时「滑块像从线上垂下来」；10-12 至 10-19 也是这样，要拉开得给滚动区加上内边距、动 `scroll-pt`，票面没要，没动。二、英文提示在 296px 下就折成两行（「Workbench: conversations you start / will appear here.」），中文一行；照票面不另做样式。三、`docs/devlog/2026-10-20-workbench-label-on-the-line.md` 的标题仍是「放回线上：19px 软过渡加居中」，最终状态在末尾一节与索引那一行的补句里，标题没改。四、harness 的新用户场景卡片第二行是一条合成消息，真新用户是问候那一行，只影响截图里卡片的字，不影响线与提示。
