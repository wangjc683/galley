# 11 拆票 10 的切换器，V1 写死

Status: ready-for-agent

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
