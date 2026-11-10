# 08 ⌘K 的「Enter 直接发问？」按设计接线

Status: ready-for-agent

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 A6。主会话最初建议删掉它，派单前发现设计文档把它定为要做的功能，退回 JC；JC 当天改裁：「按你建议第一个」，即按设计文档接线。

先读 `docs/agents/dispatch.md`、`docs/design/overlays-and-settings.md` 的命令面板一节（「Empty state」那一条，以及「在这个对话里」范围下「空的时候」那一条）。

## 背景

设计文档的定义：⌘K 里输入有内容但没有匹配时，中央一行「没找到。Enter 直接发问？」，回车就新建一个对话，把输入的字当第一句发出去。

现状：`gui/src/App.tsx` 传给 `CommandPalette` 的 `onSubmitFreeText` 只打一行 `console.info` 再切到主屏，输入被丢掉；从新对话页触发时还会落到一个没有活动会话的主区。这个处理函数自 V0.1 起就是没接线的桩。

## 1. 改哪些文件

- `gui/src/App.tsx`（`onSubmitFreeText` 的处理函数）
- `gui/src/hooks/useMessageSend.ts`（只在需要把现成的首发路径暴露出来时）
- `gui/src/components/overlay/CommandPalette.tsx`（只在回车与按钮两条路径行为不一致时）
- 对应的测试

## 2. 怎么改

- `onSubmitFreeText(text)`：关闭面板，然后走新对话页首发的同一条路径（`useMessageSend` 的 `submitFromEmpty`：先 `createSessionPersisted` 等 Core 建好行，再激活、发送），把 `text` 当第一句，不带图片。不另写一套建会话与发送的逻辑。
- 新对话是普通对话：不继承当前会话的项目（与侧栏「新对话」、⌘N 的规则一致，核对 `submitFromEmpty` 现在怎么取项目，照它在新对话页上的行为）。
- 去掉 `console.info`。失败时的表现与新对话页首发失败时一致（它已有回滚与提示）。
- 「在这个对话里」的查找范围不变：那里的无结果状态没有这一行，回车是查找。先确认现在的代码确实如此；不如此就按设计文档改对，并写进回报。
- 文案不动（`command.askDirectly` 两份 locale 里已有）。不加新的界面元素。
- 测试：无匹配时回车与点按钮都会建一个新会话并把输入作为第一条用户消息发出、面板关闭；输入只有空白时不发；「在这个对话里」的范围下没有这一入口。

## 3. 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
TZ=UTC pnpm --dir gui test
git diff --check main..HEAD
```

`gui/` 里只格式化自己的 hunk。

## 4. 别动什么

- ⌘K 的其他状态、分组、排序、样式与文案。
- `createSessionPersisted` 与 `submitFromEmpty` 的现有行为（只复用）。
- 设计文档（代码改成与它一致，文档不用改）。
- `core/`、`cli/`、`runner/`。

## 5. 回报格式

按 `docs/agents/dispatch.md`。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| JC 走完后查库：新会话的第一条用户消息就是那句话 | ⌘K 输入一个搜不到的词，回车：面板关上，进入一个新对话，那句话已经发出、它开始回复。再试一次用鼠标点那一行。在某个对话里按 ⌘F 搜不到时，没有这一行 |

## Comments
