# 01 裸 app 对照 + 窗口栈二分

Status: ready-for-human

需要 Win11 实机(dev 工具链已配好,见
docs/windows-build-checklist)。目标:一次实验判定 H1。

## 步骤

1. **裸 app 基线**:`pnpm create tauri-app` hello-world(默认装饰窗,
   一个 textarea + autofocus),同机构建运行,Alt+Tab 往返测光标。
   - 裸 app 也死 → H1 出局,上游问题实锤:上报 wry(附探针数据),
     转 issue 02 跟踪 + issue 03 实验。
   - 裸 app 正常 → 进入二分。
2. **逐项叠加 Galley 的 Windows 窗口栈**,每加一项测一轮 Alt+Tab:
   a. `window.set_decorations(false)`(运行时调用,同 lib.rs 位置)
   b. + `window-shadows-v2::set_shadows(app, true)`
   c. + `tauri-plugin-window-state`
   d. + 隐藏启动再 `show()`(tauri.conf `visible:false` 路径)
3. 首个复现故障的叠加项即为凶手;在裸 app 里最小化复现后:
   - `window-shadows-v2` 若是凶手:评估替代(tauri v2 原生
     `shadow` 配置 / 自绘阴影 / 放弃 frameless),或修它的
     subclass 转发并上游 PR。
   - `decorations(false)` 若是凶手:改用 tauri.conf 静态配置对照
     运行时调用;仍复现则上报 tauri 附最小复现。
4. 结论回写本文件 `## Comments`,并同步 devlog。

## 记录约定

每轮记录:叠加项、Alt+Tab 后 `GetFocus` 类名(探针代码见已删分支
提交 7f62aca,devlog 有描述,可按 devlog 重建)、光标是否活。
