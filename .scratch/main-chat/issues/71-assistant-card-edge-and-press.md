# 71 助理卡片：静止时一圈淡轮廓、选中铺选中底、按下缩一下；按下先画出来再打开主对话

Status: done（2026-10-20 JC 真机：「真机看过了，按下手感可以」。米底的启动重量在第二轮切换器里已真机定过；随后又看了深色与跑完那一跳越出卡片上沿：「深色模式卡片看了，没问题；超过卡片上沿一点点也没问题」。2026-10-20 主会话在主树直接做：两轮临时切换器 JC 真机比完定档，切换器已拆。门禁：typecheck、lint、`git diff --check`，layout 与 hooks 目录 24 个文件 192 条测试全过。按下先画出来（裁决 123 的 A）用临时探针实测：pointerdown 到第一帧从约 200ms 降到 3–5ms）

来源：主聊天 PRD 裁决 122、123 第 3 条（2026-10-20）。只改 GUI。

## 做了什么

- **两轮切换器**（主树，开发版专用，已拆）：
  - 第一轮比静止时的边：现状 / 轮廓 / 铺底。JC：「轮廓最接近我想要的」。
  - 第二轮在轮廓上比选中（头像圈 / 品牌边 / 米底）和按下（1px / 压缩 / 点头）。JC：「米底 + 压缩 感觉是最舒服的」。
- **定档进生产**（`gui/src/components/layout/sidebar/SidebarAssistant.tsx`）：
  - `stageFill`：静止时 `inset-ring inset-ring-line-strong/60` 加悬停铺底；选中时 `bg-selected`，轮廓 `inset-ring-(--color-selected-hover)`，按住时深一档，不响应悬停。
  - 头像外的品牌色圈（`assistant-selected-ring`）删掉。
  - 按下 `active:translate-y-px active:scale-[0.98]`，过渡写在 `translate`、`scale` 属性上。
  - pointerdown 经 `afterPaint` 打开：等下一帧之后的一个任务再打开，页面隐藏时 100ms 兜底。
- **测试**（`gui/src/components/layout/Sidebar.main-chat.test.tsx`）：
  - 改了钉在旧画法上的四条：静止的轮廓与按下、选中铺底不加阴影、通栏线只数 `border-line-strong`。
  - 切换器与头像圈的标识符进了遗留清单。
- **文档**：设计文档 `layout-and-chrome.md` §4.2「构造」与「头像标记与字重」，`foundations.md` 的按下规则加卡片例外；devlog [助理卡片的边与回主对话的卡顿](../../../docs/devlog/2026-10-20-assistant-card-edge-and-switch-hitch.md)。

## 真机要看

- 从工作台对话按下卡片：按压（缩一下加悬停底）是否立刻出现，之后主对话出现时是否还觉得「卡」。票 72 合入前，停顿的总时长不变。
- 启动时那块杏色卡重不重（裁决 64、118 第 3 条的顾虑）。
- 深色。
- 跑完一轮那一跳越出卡片上沿约 2px。
