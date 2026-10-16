# 11 拆票 10 的切换器，V1 写死

Status: done（2026-10-16 合入 main，`16711262`、`cd89fbbd`，合并提交 `e6a0ee38`；同日 JC 真机：「票 11 真机看了，没问题」）

来源：[PRD](../PRD.md) 裁决 8 的切档裁决（2026-10-16，JC：「按你推荐」，取 V1）。只改 GUI 与文档。

## 要做

拆法以 `gui/src/components/conversation/td-density/td-density.ts` 头注释为准，逐条核对；`TEMP variant switcher (telegram-details 10)` 标记清零（grep 确认）。

1. 删 `td-density/` 整个文件夹与 MainView 的 pill、`useTdDensity` 那一行。
2. V1 的三档值（字号 / 行高 / 段距：小 13.5 / 1.5 / 9.5，标准 15 / 1.55 / 10.5，大 16.5 / 1.6 / 12.5）连同「只在两种气泡上重新声明三个变量」的那组 class，挪进 `lib/conversation-font-size.ts`（或 AssistantParts 旁边，你定，理由一句）；MainView 在主对话的对话列上常带。工作台照旧逐像素不变。
3. 文档：
   - `docs/design/conversation.md`「助手的对话」气泡一节：写明气泡里的正文行高与段距比工作台收一档（三档的表、只两种气泡跟、气泡外的小字不跟），理由一句并指向 PRD 裁决 8。
   - 若 `conversation-font-size.ts` 头注释或 `docs/design/foundations.md` 里有「对话正文一套变量」之类的说法，补上主对话气泡这一组。

## 验收

- grep `td-density`、`tdDensity`、`TEMP variant switcher` 在 `gui/src` 里零命中。
- typecheck、lint、全量 gui 测试两遍（本机时区、`TZ=UTC`）、`git diff --check`；中文标点脚本扫新增行。
- 删掉的测试有定稿测试接上：三档的值、只两种气泡带、工作台逐字节不变、⌘= 换档跟着变。
- 真机（JC）：主对话的小按钮没了；气泡正文是 V1 的样子；工作台不变。

## Comments

### 2026-10-16 实现（子代理，分支 `td-density`，提交 `16711262`）

- **拆**：照 `td-density.ts` 头注释逐条：删 `td-density/` 整个文件夹（pill、存档、`galley.tmp.tdDensity`、试验测试），删 MainView 的 pill 与 `useTdDensity`。`gui/src` 里 grep `td-density`、`tdDensity`、`TEMP variant switcher` 零命中（守住它的测试把这几个词拆开拼，免得自己被 grep 到）。
- **值放在 `lib/conversation-font-size.ts`**：它们由档位表推出来（行高三档都比工作台少 0.15，段距照「行框的 0.47」），⌘= / ⌘− 也是这张表在管，放在一起，改档位时不会漏。`assistantBubbleTextStyle(档)` 给两个值（`--conversation-bubble-leading`、`--conversation-bubble-block-gap`），`ASSISTANT_BUBBLE_TEXT_CLASS` 只在两种气泡上重新声明 `--conversation-body-leading` 与 `--conversation-block-gap`；MainView 在主对话的对话列上常带。V1 的字号与档位相同，定稿不再重新声明字号。
- **核对**（Chrome，真 MainView 的 harness，不进仓库）：定稿的主对话与 `05ab45cb` 上切到 V1、藏掉 pill 的样子逐像素相同（760、1200、深色，小、标准、大三档，6 个画面）；工作台与 `05ab45cb` 逐像素相同、`#root` 的标记哈希相同（5 个画面）。读到的值：气泡正文 13.5px / 20.25px / 段距 9.5px、15 / 23.25 / 10.5、16.5 / 26.4 / 12.5；对话列和时间条照旧是档位表的值。
- **定稿测试**：`conversation-font-size.test.ts`（三档的值、行高少 0.15 与段距约 0.47、class 正好覆盖两种气泡）；`MainView.assistant.test.tsx`（主对话的对话列带 class 与当前档的值、⌘= / ⌘− 跟着换、工作台三档都不带、树里没有切换器的残留）。反向检查 5 处都挂：留一个标记、工作台也带、忽略字号档、标准档行高改回 1.7、漏掉你的气泡。
- **文档**：`conversation.md`「助手的对话」气泡一节加「气泡里的字比工作台收一档」（三档表、只两种气泡跟、气泡外的小字不跟、理由指向裁决 8），「纵向节奏」补一句；`foundations.md` 阅读面字号表补 `--conversation-block-gap` 一行与主对话气泡这一组、行高 tier 表注明气泡里 1.55。
- **测试**：typecheck、lint、`git diff --check` 通过；新增行全角标点扫描 0；全量 gui 本机时区与 `TZ=UTC` 各一遍，都是 145 个文件、1527 条（删掉试验的 8 条，加了定稿的 5 条）。
