# 回复里的可视化卡片（富 UI 回复）

Status: needs-triage（暂缓，2026-10-16 JC：方向很好，进暂缓计划；等主对话 / 助理打磨得差不多了再来讨论，目前主对话优先）
Date: 2026-10-16
来源：JC 问 [thesysdev/openui](https://github.com/thesysdev/openui) 是什么，接着提出想让助理的回复不只是 Markdown 文字，而是更生动、更漂亮、甚至可交互的 UI。三路调研（OpenUI 源码、业内横评、Galley 现状）见 [research.md](./research.md)。
关联：[deferred「回复里的可视化卡片」](../../docs/devlog/deferred.md)、[助手 PRD](../assistant/PRD.md)、[主聊天 PRD](../main-chat/PRD.md)、[Artifacts PRD](../artifacts/PRD.md)（另一件事，见文末）。

## 一句话

模型在回复末尾按需写一个 `<visual>` 标签，包住一段 HTML / SVG；Galley 把它剥出来，在沙箱 iframe 里画成一张卡片，挂在助理的气泡下面。正文照旧是 Markdown，不看卡片也读得通。

## 为什么是这条

1. **只改渲染出不来「生动」**。库里 450 条最终回复：带表格 32%（工作台 47%）、代码块 12%，mermaid 与本地 .html 路径都是 0；工具调用里也没写过 .html / .png / .svg（[research.md](./research.md)「Galley 现状」）。模型不会自己画，要生动就得给它一条输出通道。这等于重开 10-06 的否决：「界面渲染能力，804 条最终回答里 mermaid / LaTeX 为 0，没有事故」（[devlog](../../docs/devlog/2026-10-06-runtime-prompt-budget.md) 第 32 行）。这次的驱动是产品方向，不是事故。
2. **落点现成**。助理的对话已经是 IM 气泡，子任务卡片紧贴气泡下 12px（[conversation「助手的对话」](../../docs/design/conversation.md#助手的对话2026-10-15)）；`<subtask>` 已经是「回复里写标签 → GUI 剥掉 → 画成卡片」（`gui/src/lib/ipc/ga-output-cleaning.ts`）；按需读的说明书也有先例：助理手册由 Core 编译进去、主对话启动时写到状态目录（`core/src/assistant_manual.rs`），系统提示只指过去。
3. **业内**：开源桌面助手（Cherry Studio、LobeHub、Open WebUI、Chatbox）基本都是「增强 Markdown + 模型写 HTML 进沙箱」，没有一家在主对话里用组件 DSL；Claude 的内联 visuals（2026-03）与 OpenClaw 的 `show_widget`（本地助手 + IM 渠道 + 手机节点，形态最像 Galley）是同一形态。
4. **不用 OpenUI**：默认整条回复必须是 Lang、聊天库 prompt 约 1.4 万 token、解析失败返回空、没有文本降级与 Swift 渲染器、小模型合法率 44–61%、1.0 刚发且约 90% 提交来自一家公司、默认有联网行为。细节见 [research.md](./research.md)「OpenUI」。

## 方案（重开时的起点）

- **范围**：只在助理的对话（主对话，只有内置有）。工作台不动；外置零变化（没有主对话，也没有提示词通道）。
- **输出**：回复末尾的 `<visual>` 标签，GUI 剥掉后画卡，同 `<subtask>`。复制拿到的是剥掉标签后的正文。落库怎么存（原文留标签、渲染时剥，还是 Core 拆出来），开工时对照 `<subtask>` 的落库（`core/src/turn_persistence/derive.rs`）定，预计不改库结构、不动 Agent API。
- **指南**：写进助理手册（`docs/managed-ga-runtime/galley-assistant-manual.md`）一节，约 1–2KB，系统提示只加一行指针。内容：什么时候画（拿不准就不画）、Galley 色板与深浅两套变量、禁止外联、正文必须自足、尺寸上限。
- **渲染**：iframe `sandbox="allow-scripts"`，**不给 `allow-same-origin`**（08-07 Artifacts 裁决，OpenWorker 与 Open WebUI CVE-2026-45303 都栽在这里），CSP 禁外联；高度由卡片 postMessage 报给宿主；画坏了退回显示源码。
- **形态**：借子任务卡片（hairline `border-line`、`rounded-md`、`bg-app`，不加投影、不抬升），紧贴气泡下 12px，最宽同气泡上限（栏宽 88%）。不是 dashboard，也不是侧栏 artifact（[foundations](../../docs/design/foundations.md) 两条禁令都不撞）。
- **交互 v1**：卡片内部的本地交互（切换、展开、排序、悬停），加上「点选项把文字填进输入框」，不自动发送、不调工具。自动发送要校验用户手势并限频（OpenClaw：每分钟 10 次），留到后面。
- **其他端**：IM 渠道不经主对话（IM 并入仍暂缓），不受影响，将来并入时正文自足即可；iOS（裁决已封存）收到的是原始 Markdown，到时剥掉标签、显示「在电脑上看」占位。

## 已知代价

- **等待**：主对话正文不流式，HTML 写完回复才整条出现。粗估一张卡 600–2,500 token，按 60 tok/s 多等 10–40 秒。
- **上下文**：HTML 留在 GA 的历史里，后面每轮再付一次；4 小时空闲切段兜底。
- **沙箱**：Tauri 的 IPC 会不会注入到沙箱 iframe 里，**没核实**，开工前实测。
- **弱模型**：会画丑、画坏。手册写「拿不准就不画」，渲染失败退回源码；探针里带一个便宜模型看下限。
- **重量**（粗估）：GUI 300–500 行；手册一节；系统提示一行；只在模型决定画时花 token，没有后台调用，上游 GA 没有同类能力。

## 重开时的裁决点

1. 重开 10-06「告诉模型界面能渲染什么」：产品驱动，按[准入测试](../../docs/managed-ga-runtime/prompt-composition.md)（事故驱动）算一个例外；指南放手册按需读，系统提示只一行指针。
2. 交互 v1 的范围（上文）。
3. 探针怎么跑：用 Galley CLI 在内置引擎上开几个临时会话（写动作，要 JC 点头），还是别的方式。

## 第一步：探针（不动代码）

- 从库里挑 8 个真实问题：对比、行程、预算、进度汇报这类回复带表格的。
- 用手册草稿让 JC 常用的模型和一个便宜模型各答一遍。
- 渲染成一页本地对照：左边现在的气泡，右边气泡加卡片，深浅两种主题可切。
- JC 看过再定做不做、指南怎么改。
- 需求数据复测用 [reply-stats.py](./reply-stats.py)（只读打开 `workbench.db`）。探针代码与模型配置只放 scratchpad，不进仓库。

## 不选的路

- **组件白名单**（OpenUI 的 `react-lang` 挂自家组件，或自研 DSL）：每轮固定 prompt（约 750 token 加每个组件约 55 token）；IM 降级与 iOS 渲染器都要自建；上游节奏快、一家在改、默认联网；开源桌面助手没有一家在主对话这么做。可借的思路：按钮动作交给宿主、点按钮等于带着表单状态发一条新消息、先根后叶的流式解析。
- **只扩渲染**（mermaid / svg / KaTeX 代码块 + 手册一行「可以用」）：不能交互，mermaid 的观感与 Galley 排印不搭；svg 已含在本方案里。
- **Artifacts**（交付物面板）：是另一件事，管产物的落点与预览，仍按 08-07 搁置，见 deferred「Artifacts」。
