# 26 你的气泡不挂悬停复制，选中文字时弹浮动复制

Status: done（2026-10-15 `3b029e56`；同日 JC 真机看过：「效果很好」。他问过普通会话要不要也改，想过后决定保留工作台的悬停复制，见 PRD 裁决 73 第 4 条）

来源：主聊天 PRD 裁决 73（2026-10-15，JC：「现在 hover 用户消息，消息左侧会出现一个复制按钮，我感觉这个按钮位置也需要调整」，三案选 C）。改动小，主会话直接做。只改 GUI 与文档。

## 做了什么

- `MessageUser`：助手的对话里（`align="end"`）不渲染悬停复制；气泡带 `data-selection-copy-scope="user-message"`。工作台那一支的输出逐字节不变（复制按钮外层的类名与改前相同）。
- 选中复制的范围挪到 `gui/src/lib/selection-copy.ts`（`SELECTION_COPY_SCOPE`），在原来的 `assistant-answer` 之外加上 `user-message`；`SelectionCopyToolbar` 引用它。选区要起止都在同一个范围里才弹，所以只在单个气泡内选中时出现。
- 测试：`Conversation.assistant.test.tsx` 改为断言你的五个气泡都是选中范围、旁边没有复制按钮，另加一条「工作台照旧有悬停复制、没有选中范围」；`lib/selection-copy.test.ts` 断言范围正好是这两个。
- 文档：`docs/design/conversation.md` 三处原写「复制挪到气泡左侧」的地方改为裁决 73 的写法。

## JC 在 tauri dev 里看

1. 鼠标移到你自己的消息上，不再出现复制按钮；
2. 选中你消息里的一段字，旁边弹出浮动复制，点它复制；
3. 打开一个工作台会话，你的消息悬停时照旧有复制。
