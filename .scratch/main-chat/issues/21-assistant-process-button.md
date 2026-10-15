# 21 助手回复的过程按钮：步数、用时、token 收进展开区，卡片与顶栏说主区那一句

Status: ready-for-agent

来源：主聊天 PRD 裁决 68（2026-10-15，JC：「按你推荐和建议推进」）。依赖 20。只改 GUI，不碰 Rust。

## 目标

助手的回复下面平时什么都不常显；鼠标移上去出现复制、保存、过程三个图标。点过程，在下面展开这一轮的步骤，展开区第一行写步数、用时与 token。上下文百分比在助手的对话里不画。助手在跑时，侧栏卡片和顶栏说的是主区那一行的同一句话。

工作台的会话、从助手点开的子任务、外置运行时，与本票开工时的 main 逐像素一致。

## 一、行动条与过程按钮

- **现状**：`AssistantRunEntry`（`gui/src/components/conversation/AssistantParts.tsx`）作为 `MessageActions` 的 `leading` 常显在行动条最前面；复制、保存与 token、上下文（`AnswerTelemetry`）悬停才出现。
- **改成**：助手的回复，行动条里只有图标：复制、保存，两步以上的回复再加一个「过程」，放在最后。三个同一族（`ActionChip` 的尺寸、墨色、悬停底、`tabIndex={-1}`）。行动条里不再有任何数字。
- **过程按钮**：
  - 悬停提示用现有的 `foldExpand`「展开过程」/ `foldCollapse`「收起过程」，不加新文案，不带数字。
  - 展开时呈按下态，做法你定（比如常显 `bg-hover` 底并提墨）；不要换成对勾，对勾是复制、保存的「已完成」。`aria-expanded` 照旧。
  - 展开期间整条行动条常显（同「已复制」闪现期间保持可见的做法），收起后回到悬停才出现。
  - 图标默认 `Footprints`。另出一张对照图：同一条回复的悬停行，`Footprints` 与 `ListChecks` 各一张（浅、深），给 JC 真机验收时选。
- **一步就答完的回复**：只有复制、保存，与今天一样什么都不常显。
- **版面**：行动条隐藏时照旧保留占位（opacity），分组间距（`assistantRowGap`）与回复下面那 30px 不变；前后各量一次，写进 Comments。
- **键盘**：今天的入口能 Tab 到、Enter / Space 展开；行动条的 chip 是 `tabIndex={-1}`（06-29 指针优先规则）。过程按钮跟 chip 走，这点损失写进 Comments。确认 ⌥↑ / ⌥↓ 跳转不受影响。

## 二、展开区的第一行

- 展开后，步骤区最上面一行写这一轮的概括：「4 步 · 用时 45 秒 · ↑33k ↓1.1k」。
  - 步数、用时的文字与今天的入口相同（`foldSteps`、`foldDurationSeconds` / `foldDurationMinutes`）；字 `ink-muted`、数字 `ink-soft`，字号同今天的入口（`--conversation-step-size`）。
  - ↑ ↓ 用 `AnswerTelemetry` 现有的 `Metric` 与它们的悬停说明（含缓存的拆分照旧）；上下文的 `Gauge` 不画。
  - 用时缺（某段没有 telemetry）时照今天的规则只写步数；token 缺就不写那一段。
- 这一行不可点、没有悬停底、不画 caret。放在竖线（rail）上面还是与步骤同一缩进，你定，以读起来是「这一区的头」为准；截图里要有。
- 展开 / 收起的动画照旧（`ExpandSection`）；展开区与行动条之间的间距重新量，写进 Comments。

## 三、上下文与 token

- 助手的对话里，回复下面任何地方都不画上下文百分比；token 只在展开区第一行出现。
- 工作台的回复照旧：行动条悬停出现复制、保存 | ↑ ↓ 与上下文。不带助手参数时 `MessageActions` 的输出最好逐字节不变。
- `MessageActions` 的 `leading` 参数若不再有人用就删掉；新加的参数按助手的叫法起名。

## 四、卡片与顶栏在跑时说同一句

- `assistantState`（`gui/src/lib/assistant.ts`，`input.status === "running"` 那一段）在跑时不再用 `lastStepIndex` 与 `summary`，改用主区那一行同一个函数 `assistantLineSentence(turns, visiblePartial)` 的结果，没有就写 `copy.sidebar.thinking`「思考中」。
- `useAssistantState` 从消息缓存里取主对话的 turns 与 `inFlightContent`（主对话启动就打开，裁决 65 卡片的「最后一句」就是这么取的）。先确认主对话不在屏上时 `appendAgentTurn` / `appendInFlightDelta` 照样写进它的缓存，写进 Comments。
- **性能**：`inFlightContent` 每个 chunk 都变。卡片和顶栏不能跟着每个 chunk 重渲染：选择器只返回那句话的字符串（相同就不更新），`cleanPartialContent` 只在需要时算。做法写进 Comments，量一下流式时卡片渲染多少次。
- 取句的边角与主区一致：你答完它的提问后回到「思考中」。优先级照裁决 65 第 3 条（出错 > 在问你 > 在跑 > 草稿 > 最后一句），在问你时不显示这句。
- 截断、shimmer、品牌色照今天卡片与顶栏在跑时的样式。
- **不动**：子任务卡片里的「第 N 步」（`gui/src/lib/subtasks.ts`）、工作台会话行（`SidebarSessionRow`）的「第 N 步 · 摘要」、`copy.sidebar.stepSummary` 文案（工作台还在用）。
- `assistant.ts` 头部那张表（running「第 N 步 · 摘要」）与 `AssistantIdentity.tsx` 的注释跟着改。

## 五、文档

- `docs/design/conversation.md`「助手的对话」一节：行动条（三个图标、过程按钮的按下态、展开期间常显）、过程（入口改为按钮、展开区第一行）、上下文不画与 token 的位置，各写理由（引裁决 68）。写着入口「常显」的几处改掉；「Message Actions」一节里指向助手的那句跟着改。
- 写着助手卡片与顶栏在跑状态的段落（`docs/design/layout-and-chrome.md` 等，grep「第 N 步」「思考中」，中英两种写法都搜）改成「主区那一行的同一句」，并写清子任务卡片与工作台会话行照旧。
- `MessageActions.tsx` 头部注释与 `AnswerTelemetry` 的注释：加一句助手的对话不走这条（数字在展开区）。
- 不写 devlog（主会话写），不改 PRD，不改各票的 Status 行。

## 不做

- 删过程入口；一步的回复也给入口。
- 工作台、子任务、外置运行时的任何变化；子任务卡片的步数。
- 新文案键（过程按钮用现有的展开 / 收起过程；确实需要新键时先停下来，在 Comments 里说明）。
- 手机端；输入框；回复字体。

## 验收

- 跑这几项：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui test`，再用 `TZ=America/Los_Angeles` 全量跑一遍；`git diff --check`；全角标点自查（扫新增行）。gui 只格式化自己改的 hunk，新文件可以整篇格式化。
- **测试**至少覆盖：
  - 助手的回复：平时行动条里没有数字；两步以上有过程按钮、一步的没有；展开后第一行有步数、用时、↑ ↓，没有上下文；展开时过程按钮按下、行动条常显；提问与回答照旧留在外面、展开区里不重复。
  - 工作台的回复照旧有 ↑ ↓ 与上下文。
  - 卡片与顶栏：在跑时说主区那一行的句子；流出的第一行优先；没有就「思考中」；答完提问回到「思考中」；不再出现「第 N 步」；子任务卡片与工作台会话行仍有「第 N 步」。
- **反向检查**：改坏几处，确认测试会挂；恢复后逐字节一致。例如：行动条里又出现步数、助手的回复画了上下文、一步的回复出了过程按钮、展开区第一行丢了 token、卡片又写「第 N 步」、工作台的回复丢了上下文。
- **逐像素**：工作台的会话、子任务、外置运行时，与开工时的 main 比，静止、在跑、在问你，浅色与深色，要全部一致。
- **自查截图**（Chrome harness，可以复用上一个会话草稿目录里 `s20/harness/`、`s20/shoot/` 的脚本，复制到新目录再改，不进仓库）：
  - 回复静止（行动条不可见）、悬停（三个图标）、展开（按下态、第一行、步骤）、一步的回复悬停；
  - 卡片与顶栏在跑：思考中、有旁白、流出中，各一张，与主区那一行同屏；
  - 图标对照：`Footprints` / `ListChecks`，浅与深；
  - 浅色与深色、中英文；出总览图。截完把 harness 从工作树删掉。
- **JC 在 tauri dev 里走一遍**：
  1. 打开助手，看旧回复下面什么都不常显；
  2. 鼠标移到一条多步的回复上，看三个图标，停在过程上看提示；
  3. 点过程，看展开区第一行与按下态；鼠标移开行动条还在，再点收起；
  4. 发一句要查一会儿的话，看侧栏卡片、顶栏与主区那一行说的是同一句；
  5. 打开一个工作台会话和一个子任务，看 token、上下文与「第 N 步」都还在；
  6. 两个图标里挑一个。

## Comments
