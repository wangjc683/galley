# 54 Supervisor SOP 降显示优先级：内置运行时顶栏撤图标，⌘K 加入口，页面改说法

Status: ready-for-agent

来源：主聊天 PRD 裁决 106（2026-10-19，JC 问助手完善后 Supervisor SOP 还要不要常驻顶栏；主会话推荐 B，JC 同意）。同时了结 `docs/devlog/deferred.md`「设置 Agent 页去掉 Supervisor 叙事（SOP 降级）」。只改 GUI 与文档；Core、CLI、Agent API、`core/src/sop_install.rs`、SOP 正文（`docs/integrations/galley-supervisor-sop.md`）、宪法都不动。

## 一、顶栏：内置运行时不显示 Supervisor SOP 图标

- 现在：顶栏工具簇（`gui/src/components/layout/header/UtilityCluster.tsx` 约第 82–88 行，`PlugsConnected`）两种运行时都显示，点了只是 `openSettings("integration")`（`gui/src/components/layout/MainHeaderHost.tsx:156`）。
- 改成：**内置运行时**（managed）一律不显示；**外置运行时**照旧，一个像素不变。判定只看运行时种类，不看有没有主对话、不看窗口宽度。顶栏现在已经有按运行时出现的按钮（待办，见 `docs/design/layout-and-chrome.md` §4.1「待办按钮」的「出现的条件」），照它取运行时的办法取，别另起一套。
- 工具簇里剩下的按钮间距、顺序不变，只是少一颗。

## 二、⌘K 加一条「智能体接入」

- `gui/src/components/overlay/CommandPalette.tsx` 现在只有「打开设置」（约第 533 行）。加一条直接打开「设置 → 智能体接入」（`integration` 页）的项，两种运行时都有，放在「打开设置」旁边。
- 名字用设置页这一页的名字（中文「智能体接入」；英文照设置侧栏这一页在英文界面里叫的名字，`gui/src/i18n/locales/en.ts` 约第 662 行），搜索词带上 supervisor、sop、agent、cli、智能体、接入，让搜「SOP」「Supervisor」的人也找得到。
- 如果打开设置的回调现在不能指定页，就加一个可选参数，不改「打开设置」原来的行为。

## 三、智能体接入页改说法

- 副标题（`gui/src/i18n/locales/zh.ts` 约第 1150 行 `subtitle: "把 Galley 交给本地 Agent 调度"`）改成面向高级用户与开发者、两种运行时都成立的说法。建议中文「让其他 Agent 用命令行操作 Galley」，英文对应一句；你可以按 `docs/copy-language-guidelines.md`（`Agent` 保留英文、`Supervisor SOP` 只在集成语境保留）调整，写理由。
- `sopDescription`（「复制给你的 Agent，让它学会用 Galley 调度对话。」）读一遍：内置运行时里调度对话的主角是助手 Galley，这句如果读作「Galley 要靠外部 Agent 调度」就改成不打架的说法（例如「复制给你在用的其他 Agent，它就能开对话、续对话、看进度。」），两种运行时都要成立；没问题就不动，写一句为什么。
- 按钮（「复制 SOP」）、能力列表、例句、高级选项、页名（侧栏「Agent / 智能体接入」）都不改。中英两边一起改。

## 四、文档

- `docs/design/layout-and-chrome.md`：§4.1 工具簇那条（约第 78 行，「→ Supervisor SOP（`PlugsConnected` thin……）……不按状态隐藏，两种运行时模式都在」）改成「外置运行时才有」，带裁决 106 与理由一句；约第 54 行、第 208 行提到 SOP 进工具簇的地方对齐。
- `docs/design/overlays-and-settings.md`「Agent」一节（约第 757 行）补新副标题与 ⌘K 入口；文档里如果有 ⌘K 项目清单，加上这一条（`docs/copy-language-guidelines.md`「命令面板」一节也看一下）。
- `docs/devlog/deferred.md`「设置 Agent 页去掉 Supervisor 叙事（SOP 降级）」整节删掉（约第 133–145 行，到下一个 `---` 为止）：它的方案由本票做完，「待定」的两条都有了答案（页名不改；#30 队列操作面排在助手之后，那一节自己不动）。来龙去脉主会话写进 devlog。
- 全角标点。

## 别动

- 外置运行时：顶栏、设置页之外的一切逐像素不变（设置页的副标题两边一起改）。
- Core、CLI、Agent API、SOP 正文、`sop_install.rs`、AGENTS.md / CLAUDE.md。
- 侧栏会话行上 Supervisor 来源的 `PlugsConnected` 图标（那是消息来源，不是这个入口）。
- 在途的票 52 改了 `AssistantIdentity.tsx`、`useAssistantState.ts`、`lib/assistant*.ts`、`layout-and-chrome.md` 的 §4.1 身份行与 §4.2 卡片两条，以及 i18n 里 `assistant.typing` 一个键；别碰这些位置，免得合入冲突。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 单测：内置运行时顶栏没有这颗、外置有；⌘K 搜「SOP」「Supervisor」「智能体」都能找到这一条，选中打开的是 integration 页。
- 自查截图（不进仓库，放 scratchpad，文件名带 `t54-` 前缀）：内置与外置的顶栏工具簇各一张（改前改后对照）；⌘K 搜「SOP」；智能体接入页中英文各一张。截完把临时页从工作树删掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：运行时怎么取的、⌘K 怎么打开指定页。
3. 改后的中英文案原文，以及 `sopDescription` 改或不改的理由。
4. 验证命令与结果原样（测试条数、两个时区）。
5. 截图的绝对路径与每张一句话。
6. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 内置运行时：顶栏右边只剩待办、改动（有仓库时）、显示、设置。
2. ⌘K 搜「SOP」：出现「智能体接入」，回车打开那一页，副标题是新说法。
3. （可选）切到外置运行时：顶栏照旧有那颗图标。

## Comments

- 2026-10-19 实现（子代理，分支 `main-chat-54-supervisor-sop-off-the-top-bar`）：顶栏照待办按钮的取法，`MainHeaderHost` 读 `activeRuntimeKind`，内置运行时不传 `onOpenSupervisorSop`，`UtilityCluster` 没有回调就不画这一颗；外置运行时改前改后截图逐字节相同。⌘K 的 `onOpenSettings` 加可选参数 `tab`，「打开设置」不传、照旧落「通用」，「智能体接入」传 `"integration"`，紧跟「打开设置」，两种运行时都有。副标题改为「让其他 Agent 用命令行操作 Galley」/「Let other Agents operate Galley from the command line」；`sopDescription` 改为「复制给你在用的其他 Agent，让它学会操作 Galley 里的对话。」（英文「Copy it to another Agent you use so it learns to drive Galley sessions.」）：内置运行时里助手 Galley 本人就是调度对话的 Agent，「你的 Agent」会读成它。`docs/copy-language-guidelines.md` 副标题那一行一并改了（规范表里记着旧句）。单测两个新文件：`MainHeaderHost.sop.test.tsx`、`CommandPalette.agent.test.tsx`。
