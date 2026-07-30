# 02: 原生 drop 事件接入 + 图片拖放迁移

Status: done（2026-07-29 实现完成；typecheck/lint/vitest 全过。真机手工拖拽
验证 agent 无法执行，并入 05 smoke 清单与 JC 的 macOS dogfood。实现要点：
`hooks/useNativeDragDrop.ts` 订阅原生事件流、`lib/file-drop.ts` 纯函数分流、
图片经 plugin-fs 读回 File 喂 `acceptImageFiles`，fs 读失败降级为路径引用；
文本拖拽 toast 走 `useImageBlockedToast.handleTextDropBlocked`。）
Blocked by: 01

## 范围

正式翻转 `core/tauri.conf.json` 的 `dragDropEnabled: true`，把拖放入口
从 HTML5 事件迁到 Tauri 原生 `onDragDropEvent`，保证图片拖放在用户视角
零变化：

- 新增原生事件监听层（hooks），维护 enter/over/leave/drop 生命周期，
  替代现有 `dragDepthRef` 计数方案；overlay 视觉复用
  `ComposerDropOverlay`。
- 接收范围按 PRD 定案 6：会话视图内整窗接受，composer 可输入时生效；
  Settings 等无 composer 界面忽略。
- 分流：图片扩展名（PNG/JPEG/WebP）的路径经 `plugin-fs` 读字节构造
  File/Blob → 喂回 `acceptImageFiles`（`hooks/useImageAttachments.ts`），
  下游校验/降采样/toast/上限全部不动。非图片路径先留 TODO 挂钩，03 接。
- 拆除 Composer.tsx 上旧的 `onDragEnter/Over/Leave/Drop` HTML5 wiring。
- 粘贴图片、📎 选图片两条路径不受影响，确认不回归。

## 验证

- macOS `pnpm --dir gui tauri dev` 手工过一遍图片拖放全流程
  （单张/多张/超限 toast/overlay 闪烁）。
- 纯文本 / URL 拖拽不回归（01 的结论复核）。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、能单测的抽纯函数单测。
