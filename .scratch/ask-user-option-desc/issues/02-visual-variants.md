# 02 GUI 呈现变体实测：tooltip vs 选项下方小字

Status: ready-for-agent
Blocked by: 01

## 流程

按 JC 的真机变体实测惯例：做临时变体切换器（常驻可点击 pill）进
`pnpm --dir gui tauri dev`，两个变体：

- A：hover / 键盘聚焦 tooltip（多行、不截断、无 desc 不留空壳）
- B：按钮下方一行灰色小字（触屏 / 纯键盘可达，代价是纵向占位）

JC 实测裁决后：拆掉切换器，裁决理由进 devlog，落选方案代码删除。

## 硬性体验要求（两变体都要满足才有资格入选）

- Tab 聚焦可见说明；说明多行不截断；无 desc 时外观与现状完全一致。

## 验证

- `pnpm --dir gui typecheck` / `lint`；真机验收 JC 做。
