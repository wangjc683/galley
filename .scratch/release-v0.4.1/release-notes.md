<!--
GitHub Release notes 草稿 for v0.4.1 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template(English first, 中文 second)。
TAG=v0.4.1  VERSION=0.4.1  PREVIOUS_TAG=v0.4.0
-->

## What's New

- Hand files to your agent by dragging them in: drop any file or folder into the window (or click 📎 → "Add files…") and Galley inserts a compact reference that expands to the full path when you send; images keep attaching as before. Note: dropping plain text or URLs no longer pastes them — a toast points you to copy & paste instead.
- One move back to a tidy window: double-click the sidebar divider (a hover tip shows the way), or use Window → Reset to Default Layout / the command palette, and the window returns to its default size, position, and 20/80 split. First launches now open centered, and oversized windows snap to fit small displays.
- Scheduled tasks run more reliably: fixed a timestamp-format mismatch that could mis-order the due check on exact-second ties, and one corrupt task row can no longer stop all scheduled runs from firing.
- Easier on the eyes in dark mode: the dark theme's warm tint is dialed back a notch, and CJK text no longer renders overly bold.
- The composer's status hint now reflects your actual keyboard state instead of a canned message.

## Under the Hood

- File drops now arrive through the OS-native drag-drop pipeline (real filesystem paths, no browser sandboxing) — this is what retired HTML5 text drops.
- Continued structural cleanup in Rust Core and the GUI (scheduler fire path behind an explicit seam, composer policy modules, send-path consolidation) with no intended behavior change.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.1/Galley_0.4.1_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.1/Galley_0.4.1_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.1/Galley_0.4.1_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.0...v0.4.1

---

## What's New

- 拖进来就能交给 agent:把任意文件或文件夹拖进窗口(或点 📎 →「添加文件…」),Galley 会插入一个简洁的文件引用,发送时自动展开为完整路径;图片仍像以前一样作为附件。注意:纯文本 / 链接拖进窗口不再直接粘贴,会有提示引导改用复制粘贴。
- 一步找回整洁的窗口:双击侧边栏分隔条(悬停有提示),或用 Window 菜单 → Reset to Default Layout / 命令面板,窗口即恢复默认大小、位置和 20/80 分栏。首次启动现在居中打开,超出小屏幕的窗口会自动收进显示器。
- 定时任务更可靠:修复了时间戳格式不一致在整秒相同时可能导致到期判断错乱的问题;单条损坏的任务记录不再阻断所有定时任务的触发。
- 深色模式更护眼:暗色主题的暖色调回收一档,中文等 CJK 文本不再显得过粗。
- Composer 的状态提示改为反映当前真实的键盘状态,不再是固定文案。

## Under the Hood

- 文件拖放改走操作系统原生管线(拿到真实文件路径,不受浏览器沙箱限制)——HTML5 文本拖放因此退役。
- Rust Core 与 GUI 持续结构清理(调度触发路径收进显式接缝、composer 策略模块化、发送链路合并),无预期行为变化。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.1/Galley_0.4.1_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.1/Galley_0.4.1_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley,可以在终端执行:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.1/Galley_0.4.1_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险,点击「更多信息」->「仍要运行」。
