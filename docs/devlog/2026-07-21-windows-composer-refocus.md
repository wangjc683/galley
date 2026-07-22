# Windows composer 焦点回归修复:Tauri 窗口事件 + 让位守卫

日期:2026-07-21(实机调查续 2026-07-22)
状态:**未决**。JS 双层 + Rust 多种原生焦点断言均无效;JC 在 Win11
实机上继续调查(`debug/win-focus` 分支)。v0.3.7 tag 已打、draft 已
构建但**挂起不发布**;stable 更新通道停留在 v0.3.6。
相关:issue #13 · `gui/src/hooks/useFocusOnWindowFocus.ts` ·
`core/src/lib.rs`(`win_focus_assist`)· devlog 索引关键词:
WebView2 / 焦点 / Alt+Tab / onFocusChanged / MoveFocus / HWND

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
- **第三层(Rust 原生焦点)**:`WindowEvent::Focused(true)`(仅
  Windows)时经 `AsRef<Webview<Wry>>` 调 webview 级 `set_focus()`
  (wry `controller.MoveFocus(PROGRAMMATIC)`)。`WebviewWindow::
  set_focus` 只是 window 级 focus,无效。

## 2026-07-22 Win11 实机调查纪事(dev 环境 + 探针)

新 Win11 机器配好 dev 工具链后逐轮实测(探针:Rust 侧 Focused 事件 +
GetFocus 类名;JS 侧 hasFocus/activeElement/focusin/keydown 快照),
按时间序:

1. **无条件 `webview.set_focus()` = 死循环**:MoveFocus 把 Win32 焦点
   移进 WebView2 子窗口 → 父窗口 KILLFOCUS → tao 翻拍
   `Focused(false)/Focused(true)` → handler 再断言 → 每秒数百轮、界面
   抖动。v0.3.7 draft 装机版的"焦点丢失"实为此循环:焦点在 HWND 间
   无限弹跳、永不停稳。
2. **幂等守卫(焦点已在 webview 子树内则跳过)** 终止了循环,但
   Alt+Tab 后光标仍死:此时 **DOM 层完全正常**(`hasFocus=true`、
   `activeElement=textarea`、`focusin` 已触发)而键盘不进——故障在
   JS 够不到的 Win32 / Chromium 浏览器进程层。
3. **类名探针揭示 HWND 布局**:正常打字态 Win32 焦点停在 webview 顶层
   子窗 `Chrome_WidgetWin_1`;Alt+Tab 后焦点搁浅在父窗 "Tauri Window"
   (webview 子树之外)。
4. **强制 SetFocus 到内层 `Chrome_RenderWidgetHostHWND` 是反模式**:
   Chromium 把焦点抢回去,拉锯战把正常打字态也打死(光标凭空消失)。
   铁律:**焦点在 webview 子树内的任何 HWND 上都不得干预**。
5. **仅救援搁浅态**(焦点在子树外 → SetFocus `Chrome_WidgetWin_1`,
   即时 + 150ms 延迟断言、generation 去重)+ **controller
   `MoveFocus(NEXT)`**(经 `with_webview` 拿 ICoreWebView2Controller,
   走完整 tab-into-webview 管线)——不churn、不循环,但 Alt+Tab 后
   光标依然不活。程序化手段全部到顶,唯一确认有效的动作仍是真实
   鼠标点击。

### 未试线索(按性价比排序,留给实机继续)

1. **裸 tauri app 对照**:同机起 hello-world 测 Alt+Tab。裸 app 也死
   → 纯上游(wry/WebView2 运行时),上报 + 产品层绕行;裸 app 正常 →
   凶手在 Galley 窗口配置,头号嫌疑:`decorations: false` 自绘窗口、
   **window-shadows-v2(会 subclass 窗口,可能吞/重排激活消息)**、
   tauri-plugin-window-state,逐个关掉二分。
2. `AttachThreadInput` + SetFocus 组合(跨线程焦点不粘的经典偏方)。
3. 模拟真实点击(PostMessage WM_LBUTTONDOWN/UP 到 Chrome_WidgetWin_1)。
4. 核对 WebView2 Runtime 版本(v134 有已知焦点回归前科)+ 更新 Edge。
5. 关 DevTools 复测(DevTools 自身是另一个 Chrome_WidgetWin 窗口)。

### 顺带修复(已 cherry-pick 回 main)

本地 Windows dev 路径首次被走通,趟出并修掉:`prepare-cli-sidecar`
bash-only → 移植为跨平台 `.mjs`(tauri.conf 两个 before 命令随改);
未文档化的 `bundle-python.sh win-x64` 前置、PowerShell ExecutionPolicy、
16GB 内存并行编译 OOM(`CARGO_BUILD_JOBS=2`)记入 windows-build-checklist。

## 教训

跨 WebView 的焦点行为不可移植:凡是依赖 `document.activeElement`
跨窗口失焦语义、或依赖 DOM window focus/blur 事件时序的逻辑,必须
按 WKWebView(macOS)/ WebView2(Windows)分别验证,macOS 通过不构成
发布依据。用户报的"会话间切换也不聚焦"若在修复后仍复现,即是第三层
(控件级原生焦点)的证据。
