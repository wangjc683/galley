# 70 工作台不挂区名：有对话时只留线，名字挪进空状态那句提示

Status: ready-for-agent

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
