# Windows 切换应用后 composer 聚焦(调查重启)

Status: ready-for-agent

## 问题

Win11 上 Alt+Tab 切回 Galley 后,DOM 焦点正常(`hasFocus=true`、
`activeElement=textarea`)但键盘输入不进,必须鼠标点一下才能打字。
macOS 无此问题(#13 已修,`useComposerFocus` 契约生效)。

## 历史(必读,避免重走死路)

前一轮调查全记录在
[devlog 2026-07-21](../../docs/devlog/2026-07-21-windows-composer-refocus.md)。
`debug/win-focus` 分支已删除(2026-07-22),结论沉淀如下:

- 激活钩子里无条件 `webview.set_focus()` / MoveFocus = 焦点死循环
  (每秒数百轮 HWND 弹跳)。上游社区独立复现同样的循环
  (tauri#15624 提到 app 侧尝试全部回滚)。**此路封死。**
- 幂等守卫、仅救援搁浅态、`MoveFocus(NEXT)`、强制 SetFocus 内层
  HWND——全部试过,循环可止但光标不活。程序化 JS/Rust 手段到顶。
- 实机探针:Alt+Tab 后 Win32 焦点搁浅在父窗 "Tauri Window",
  webview 子树之外。

## 上游情报(2026-07-22 收集)

- wry 本有内建还原链:顶层 `WM_SETFOCUS` → subclass →
  `MoveFocus(PROGRAMMATIC)`(`src/webview2/mod.rs`)。
- [tauri#15624](https://github.com/tauri-apps/tauri/issues/15624)
  失败模式 B:Alt+Tab 回来 Windows 把焦点直接给 `Chrome_WidgetWin_1`
  子窗,顶层 `WM_SETFOCUS` 不触发 → 还原链失效。**但标记为仅
  `unstable` 多 webview 特性受影响**,Galley 未启用 unstable
  (core/Cargo.toml 无此 feature),标准单 webview 上游称不受影响。
- 修复中:[wry#1755](https://github.com/tauri-apps/wry/pull/1755)
  (open,被标 ai-slop)、
  [tauri#15625](https://github.com/tauri-apps/tauri/pull/15625)
  (open,milestone 2.12,主要覆盖 unstable 路径)。
- WebView2 Runtime v134 有焦点回归前科(134.0.3124.68 修复)。
- 我们的搁浅方向(焦点停在**父窗**)与上游失败模式 B(焦点直达
  **子窗**)相反 → 我们的症状很可能不是纯上游问题。

## 假设(按可能性排序)

1. **H1:Galley 的 Windows 窗口栈打断了 wry 还原链。**
   嫌疑组件:运行时 `set_decorations(false)`(lib.rs ~717)、
   `window-shadows-v2`(对窗口做 subclass,可能吞/重排
   `WM_SETFOCUS`/`WM_ACTIVATE`)、`tauri-plugin-window-state`。
   支持证据:标准单 webview 上游不复现;我们的搁浅方向异于上游;
   window-shadows-v2 的 subclass 与 wry 的 subclass 同挂一窗。
2. **H2:上游 wry 失败模式仍部分存在**,即使 H1 修掉也可能残留;
   跟踪 tauri 2.12 / wry 0.56。
3. **H3:该机 WebView2 Runtime 版本回归**(核对版本 + 更新 Edge)。

## 出口标准

Alt+Tab 切回后直接打字即入 composer;无焦点抖动/循环;冷启动
Tab 键导航不坏;在 v134 与 v149 两代 WebView2 Runtime 上都成立。

## Issues

- 01 裸 app 对照 + 窗口栈二分(实机,判 H1)
- 02 上游跟踪 + Runtime 版本审计(远程可做,判 H2/H3)
- 03 残余原生手段实验(仅当 01 洗清 H1 后进行)
