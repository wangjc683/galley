# Windows composer 焦点回归修复:Tauri 窗口事件 + 让位守卫

日期:2026-07-21
状态:已实现;Win11 实机验证待 v0.3.7 构建(macOS 回归已过)
相关:issue #13 · `gui/src/hooks/useFocusOnWindowFocus.ts` ·
devlog 索引关键词:WebView2 / 焦点 / Alt+Tab / onFocusChanged

## Context

v0.3.6 的「切回窗口自动聚焦 composer」(#13)在 macOS 测试通过后发布,
Win11 用户反馈完全不生效。排查确认 v0.3.6 实现依赖两个 WKWebView 特有
行为,在 Windows WebView2 上双双不成立:

1. **DOM `window` focus 事件在 WebView2 上 Alt+Tab 不触发**(上游
   已确认:MicrosoftEdge/WebView2Feedback#4626,Edge 无此问题)。
   v0.3.6 只监听这个事件 → Windows 上 hook 从不运行。
2. **`activeElement === document.body` 守卫是 WKWebView 语义**:
   Windows Chromium 跨窗口失焦保留 `activeElement`(还停在 textarea 上),
   且点击按钮会给按钮 DOM 焦点(macOS WebKit 都不会)→ 守卫在 Windows
   上几乎永远提前 return,把还原寄托给 WebView2 并不可靠执行的原生
   焦点恢复("Alt+Tab 后键盘输入丢失直到用鼠标点一下"是 WebView2
   已知 desync)。

## Decisions

- **触发源换成 Tauri `onFocusChanged`**(Rust `WindowEvent::Focused`,
  全平台可靠),DOM focus 监听保留为非 Tauri 宿主(纯浏览器 Vite dev)
  兜底;双触发时第二次 `focus()` 是 no-op,不需要去重。
- **守卫从「activeElement 必须是 body」改为让位名单**:只让位给其他
  可编辑元素(input/textarea/select/contentEditable)和打开的
  dialog/popover(`role="dialog"`/`alertdialog`,覆盖 Radix 焦点域)。
  activeElement 是 body、null 或 composer textarea 本身时都执行
  `focus()`——textarea 分支正是修复 Windows 保留 activeElement 场景
  的关键。
- **预留第三层(未上)**:若 Win11 验证发现 DOM 焦点到位但键盘输入仍
  不进(WebView2 控件级 Win32 焦点 desync),需要 Rust 侧在
  `WindowEvent::Focused(true)` 时调 `webview.set_focus()`。社区通行
  workaround,但有 setFocus 事件回环 / 死锁报告,没有 Windows 实机
  不盲上。

## 教训

跨 WebView 的焦点行为不可移植:凡是依赖 `document.activeElement`
跨窗口失焦语义、或依赖 DOM window focus/blur 事件时序的逻辑,必须
按 WKWebView(macOS)/ WebView2(Windows)分别验证,macOS 通过不构成
发布依据。用户报的"会话间切换也不聚焦"若在修复后仍复现,即是第三层
(控件级原生焦点)的证据。
