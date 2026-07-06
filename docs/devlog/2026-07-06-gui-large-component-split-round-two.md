# GUI 大组件拆分 · 第二轮（重开 settled 结论）+ 项目上下文逃生口

- **Date**: 2026-07-06
- **Status**: completed
- **Related**: `gui/src/App.tsx` · `gui/src/components/layout/MainHeader.tsx` + `layout/header/*` · `layout/SessionTitleEditor.tsx` · `layout/sidebar/SidebarSessionRow.tsx` + `sidebar/SidebarSessionMenuItems.tsx` / `ArchiveRunningConfirmDialog.tsx` · `components/conversation/Composer.tsx` + `GoalConfirmDialog.tsx` / `LLMPill.tsx` / `composer-styles.ts` · `hooks/useMessageSend.ts` / `useGoalActions.ts` / `useOnboardingFlow.ts` · `screens/EmptyState.tsx` · commit `b9875ee`（拆分）/ `5e247e1`（bug fix）
- **Supersedes**: [2026-06-23 Composer paste-fold + split closeout](./2026-06-23-composer-paste-fold-and-split-closeout.md) 的 "App.tsx settled、Composer settled — 不再按尺寸拆" 结论（见下「与 settled 结论的关系」）

## Context

JC 让全面排查"过大、值得拆的组件"。量化后真正该拆的是四个 React 组件：MainHeader（1335）、App.tsx（1758）、SidebarSessionRow（862）、Composer（1428）。i18n locales 和 Zustand stores 虽行数高但内聚合理，明确不拆。

这条"大组件拆分"叙事线在 6 月已经走过一轮（image-split → paste-fold closeout），并在 2026-06-23 宣布"GUI large-component split complete，App.tsx / Composer settled，不再按尺寸拆"。本次在 JC 明确指示下**重新打开这条线**——不是推翻当时的判断标准，而是把导航性（navigability）的优先级提到了尺寸洁癖之上，且严格沿用当时确立的同一条拆分原则。

## Decisions

### 拆分原则：沿内聚缝拆，状态机 / 接线枢纽保留

四个组件的"大"分两类，处理方式不同：

- **多个独立子组件堆在一个文件**（MainHeader）→ 纯搬家，逐个抽成文件。
- **一个内聚的状态机 / 接线枢纽 + 捆进来的独立大件**（App.tsx / SidebarSessionRow / Composer）→ 只抽"能干净分离的关注点"，**内聚的核心保留在原文件**。硬拆状态机只会把纠缠挪到 prop 边界，是漏抽象（与 2026-06-23 对 `useGoalLaunch` 判"net-negative"同一条推理）。

沿用仓库既有约定，不发明新抽象：逻辑切片进 `hooks/useX.ts`（deps 传入、返回 handler，对齐 `useProjectNavigation`）；自成一体的子组件 / 样式常量进同级文件。

### 各组件落地

- **MainHeader 1335 → 286**：13 个 in-file 子组件（两个 cluster、各状态指示器、标题菜单、共享 badge tokens）搬进 `layout/header/`。注：这是 2026-06-24 "topbar 拆双栏列头" 之后的**新一步**——那次拆的是全宽 TopBar → SidebarHeader + MainHeader 的结构，没动 MainHeader 内部。
- **App.tsx 1758 → 1136**：密集的 IPC / 业务逻辑抽成 `useMessageSend`（含那段 140 行 inline onSubmit）/ `useGoalActions` / `useOnboardingFlow`，onboarding 接管屏抽成 `OnboardingScreen`。App 仍是"selector→hook→JSX"的接线枢纽（符合其文件头"App is mostly wiring"定位），弹窗簇留在 return（JC 选 1-3，不抽 40-prop 的 AppOverlays——那只是把 prop-drilling 挪个地方，非真正降耦）。
- **SidebarSessionRow 862 → 560**：菜单体 + 归档确认弹窗抽出，行状态模型（railKind / subline / attention / pop）保留一体。
- **Composer 1428 → 937**：GoalConfirmDialog（含预算/Agent 常量）+ LLMPill（含 `ComposerLLMOption`，Composer 再导出保 API 不变）+ 按钮样式常量抽出。输入状态机保留——**没有抽 `useGoalArm` / `useGoalLaunch`**，goal-arming 与 `handleSubmit` / `handleKeyDown` 咬合，抽出是把纠缠挪到边界（照 2026-06-23 的结论）。这正是那篇 closeout 授权的"为导航可迁出 GoalConfirmDialog / LLMPill（pure move）"选项。

### SessionTitleEditor 消重

header 和 sidebar 各有一份**逐字节相同**的 inline 重命名逻辑（settledRef 防双触发 + focus/select + IME 守卫）。header 那份是 2026-06-24 topbar 拆分时随 SessionTitleMenu 带出来的。统一成 `layout/SessionTitleEditor.tsx`（两个子目录的共同父级），三处差异用 prop 门控：`dragRegionOptOut`（MainHeader 是 Tauri 拖拽区）/ `stopRowActivation`（Sidebar 行本身是点击目标）/ `className`（布局）。防双触发守卫从此一处即真理。

### Bug fix：项目上下文的逃生口（EmptyState）

在非项目视图里选中某个属于项目的 session，会把 `activeProjectFilter` 绑到该项目，之后 New Chat 落在项目里——而唯一能清掉的可见路径是 ⌘K → New Chat，普通用户发现不了（"没有入口"）。

根因是**一个不可见状态（扁平列表里看不出"进了"项目）在悄悄改变 New Chat 行为**。取了最小修法（JC 在 A/B 里选 A）：把已有的"将创建到 X"被动提示做成带 × 的可撤销 chip，点 × 清 filter → 普通新对话，草稿不丢。即"反馈引导行动"——把已经显示的后果变成可操作的出口，而非新增藏在别处的按钮。

## 与 settled 结论的关系

2026-06-23 的 "App.tsx settled、do not split further on size grounds" 是当时基于"再拆是把纠缠挪到边界"的合理判断。本次没有否定这条推理——恰恰相反，四个组件都保留了内聚核心，只抽真正可分离的部分。变的是**优先级**：JC 判定导航性收益（想改发送逻辑直接开 `useMessageSend`，不用在 1700 行里翻；降 merge-conflict 面）值得重开。故本篇 supersede 那条"不再拆"的 Next 指令，但继承其拆分方法论。

全程行为等价、每步 typecheck 卡关、prettier + lint + git diff --check 全绿，JC 真机 dogfood 通过。公共 API 未变（`ComposerLLMOption` 从 Composer 再导出；MainHeader / Composer import 路径不变）。

## Rejected / Deferred

- **AppOverlays（把弹窗簇抽成组件）**：否。~40 prop 透传，只挪 prop-drilling 位置，不降耦；App 弹窗簇本就是一个个干净的调用，读着不费劲只是长。
- **抽 `useGoalArm` / `useGoalLaunch`**：仍 deferred（与 2026-06-23 一致）。Composer 输入状态机是一体的。
- **bug fix 选项 B（扁平列表里选中不自动绑定项目）**：未采纳。A 已堵住报障；B 触及"三入口一致"的旧决策，属产品方向调整，留待 JC 之后若觉更顺再加，两者不冲突。
