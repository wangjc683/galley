# 05 切换器：输入框长高动画、主对话连发组内圆角

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 6（2026-10-16，JC：「6，按推荐比」）。只改 GUI。纯视觉，做临时切换器进 `tauri dev` 真机比，JC 裁决后拆掉切换器、留下选中的档。
独立子代理做，与 01–04 并行。

## 两个维度（彼此独立，各自一组档位）

### A. 输入框长高的动画（两边同一个输入框）

- 现状：随内容瞬间长高，8 行后在框里滚动（`composer-styles.ts:77-85` 一带）。
- Telegram 两端同一个公式：高度动画时长 `50 × ln|Δh|` ms（多一行约 150ms，48px 涨满到上限约 240ms），ease-out（Web A `src/components/middle/composer/MessageInput.tsx:288-326`；Web K `src/components/inputFieldAnimated.ts:75-80`）。
- 档位（从最克制排起）：
  1. 现状：瞬间。
  2. 固定 100ms ease-out。
  3. 按距离：`50 × ln|Δh|` ms ease-out。
- 长高、变矮（删字、发出后缩回一行）都走同一档。
- 保持贴底（票 27，`lib/viewport-resize.ts`）：对话在底部时，输入框长高的每一帧对话都贴底，别出现最后一条被压到输入框下面、然后跳回来。改完在 Comments 里写怎么确认的。
- 减少动态效果时一律瞬间。

### B. 主对话连发的组内圆角（只主对话）

- 现状：同一边连发的气泡间距 4px（`lib/assistant-conversation.ts:72-78`），每一颗都是 12px 全圆角（`MessageUser.tsx:337`、`AssistantParts.tsx:46-47`）。
- Telegram：一组里靠发送者一侧、挨着组内邻居的角变小（Web A 大 15px、小 6px，`src/components/middle/message/Message.scss:164-183`）。首条：下方那个靠自己一侧的角小；中间：靠自己一侧上下两个角都小；末条：上方那个靠自己一侧的角小。外侧（远离发送者一侧）始终大圆角。我们没有尾巴，末条的下角保持 12px。
- 你的气泡靠右，小角在右侧；助手气泡靠左，小角在左侧。
- 「一组」= 同一边、中间只隔 4px 连发间距的相邻气泡；时间条、换边都断组。按 `assistant-conversation.ts` 里已有的分组 / 间距规则认，别另写一套。
- 档位（从最克制排起）：
  1. 现状：全 12px。
  2. 组内小角 8px。
  3. 组内小角 6px。
  4. 组内小角 4px。
- 禁令照旧：不加尾巴、不加边框投影（`conversation.md:53/78`）。
- JC 的主对话里可能没有现成的连发：Comments 里写一句怎么造（例如在跑时连发两条，或说一段话后马上再补一句）。

## 切换器

- 一颗常驻、可点的小 pill（固定在主区角落，不挡输入框、不挡问题轨），点开选 A、B 各自的档位；比 Radix 菜单内部时 pill 要 portal + `pointer-events: auto`。选择存 localStorage（try/catch），刷新后保持。
- 切换器与档位代码集中、好拆：JC 裁决后一个提交拆掉切换器、把选中的档写死。
- 不进 i18n 文案（临时 UI），代码里标 `TEMP variant switcher (telegram-details 05)`。

## 验收

- typecheck、lint、相关单测过；截图（各档）写进 Comments。
- 合入 main 后 JC 在 `tauri dev` 里切档比，裁决进 PRD 与 devlog。

## Comments
