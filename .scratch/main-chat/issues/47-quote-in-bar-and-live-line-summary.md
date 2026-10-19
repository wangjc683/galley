# 47 回复行动条加「引用」；运行中那一行没有旁白时用 summary

Status: ready-for-agent（裁决 99、100，2026-10-19）

来源：主聊天 PRD 裁决 99、100（2026-10-19 JC 真机走查票 38 与喝水提醒时提出）。依赖 38（已合入，`ab4b0783`）。只改 GUI 与设计文档；Core、runner、提示词不动。

## 一、回复的行动条加「引用」（裁决 99）

- 助手的对话里，回复下的行动条（`gui/src/components/conversation/MessageActions.tsx`，`assistant` 分支）变成：**复制 · 引用 · 保存 · 过程 · ⋯**。过程照旧只在两步以上的回复出现；`processOnly`（漏出工具调用标记、没东西可复制）时也不出引用。
- 引用按钮做的事与消息菜单里的「引用」**完全相同**：整条放进输入框上方的引用条，长的截断（`wholeMessageQuote`，见 `lib/message-menu.ts` 与 `docs/design/conversation.md`「消息菜单」的「引用整条」）。共用同一个动作，不另写一份。
- 外观照行动条现有的 chip（`ActionChip`：24px、14px thin 图标、`tabIndex={-1}`）；图标用 Phosphor `Quotes`（菜单与选区浮动工具条已用它）；提示与读屏名复用现有的「引用」文案，不新增 i18n 键（真需要新键就中英各加，写理由）。点了之后要不要闪对勾：引用条出现、光标进输入框本身就是回执，**不闪对勾**；如果你认为需要，写理由。
- 工作台的行动条不变。你的气泡照旧不加悬停按钮（裁决 73）。
- 菜单的项与顺序不变（复制、引用、保存、展开过程 ── 删除）。

## 二、运行中那一行没有旁白时用 summary（裁决 100）

- `gui/src/lib/assistant-conversation.ts` 的 `assistantLineSentence`（约第 140–158 行）：现在正在流出的第一行优先，否则从最新一步往回找第一条有旁白（`finalAnswer ?? preamble`）的步。改为：从最新一步往回找第一个**有字**的步，这一步旁白优先，没有旁白就用这一步的 `summary`（同样取第一行，走 `assistantFirstLine` 或等价的清洗）。正在流出的第一行照旧最优先。
- 效果：模型每步只写 summary 时，那一行跟着步骤走（「本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。」）；第 1 步写了旁白、第 2 步只写 summary 时，那一行换成第 2 步的 summary，不停在旧旁白上。
- 查清 `assistantLineSentence` 的所有调用方（主区那一行、侧栏卡片等）与它的缓存（`sentenceCache`），确认 summary 变化能刷新。顶栏按裁决 87 在跑时只写「思考中」，不动。
- summary 里可能带的标记、换行按现有清洗处理；如果发现 summary 需要额外清洗（比如带 `<summary>` 标签残留），写清楚怎么处理的。
- 诊断依据（T02，2026-10-19）：那一行只读旁白是裁决 68 第 4 条的设计；10-19 喝水那轮四个工具步只有 summary，整轮显示「思考中」。

## 三、文档

- `docs/design/conversation.md`：行动条那几处（约第 116 行「行动条照旧在回复下面…里面只有图标：复制、保存…」、第 124 行、「消息菜单」一节提到行动条的地方、「Message Actions」一节助手对话的说明）写成新的五个按钮与顺序，引用裁决 99。
- 同文件里描述运行中那一行取字规则、以及「summary 是 agent 的工作记忆，不写给读者」（约第 123 行附近）的地方，改成裁决 100 的规则，写明部分推翻裁决 68 第 4 条的理由。
- 代码注释里描述这两处规则的（`MessageActions.tsx` 顶部注释、`assistant-conversation.ts`）同步改。
- **不要改** `.scratch/main-chat/PRD.md`（裁决已由主会话写好）。

## 验收

- `pnpm --dir gui install --frozen-lockfile`（worktree 里没有 node_modules）后跑：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、全量 gui 测试两遍（本机时区与 `TZ=UTC`）、`git diff --check`、`.github/workflows/check.yml` 里的门禁脚本、`node scripts/check-docs-links.mjs`、中文标点扫新增行。
- 测试：
  - 行动条：助手对话下按钮顺序为复制、引用、保存、（过程）、⋯；`processOnly` 没有引用；工作台没有引用；点引用走与菜单同一个动作。
  - `assistantLineSentence`：最新一步只有 summary → 用 summary；最新一步有旁白 → 用旁白；前一步有旁白、最新一步只有 summary → 用最新一步的 summary；正在流出的第一行最优先；遇到用户消息就停（不越过你最后一条消息）。

## Comments
