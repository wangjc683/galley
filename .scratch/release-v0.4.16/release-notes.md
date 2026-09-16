<!--
GitHub Release notes 草稿 for v0.4.16 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template（English first, 中文 second）。
TAG=v0.4.16  VERSION=0.4.16  PREVIOUS_TAG=v0.4.15
-->

## What's New

- Process steps in a conversation now sit in a numbered gutter (`01`, `02`, …) with a rail; tool rows recede a level below the step summary, the expand caret follows the text, and the in-flight row stays unnumbered until the step settles.
- The fetched model list is now a dropdown inside the model field: click the caret or type to filter. The auto-fetch after entering API base and key shows "loading" and "found N models" instead of a list appearing out of nowhere.
- Chinese UI: the Settings sidebar leads with the Chinese label; the English tab name becomes the small secondary term (community report: too small and faint to read).
- Icons on 1x / low-DPI screens (Windows at 100–150 % scaling, non-Retina external displays) render at regular stroke weight instead of a blurred half-pixel line; Microsoft YaHei is named in the font stack (community report).
- Pin / Unpin is the first item in the session row menu (⋯ and right-click).

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.16/Galley_0.4.16_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.16/Galley_0.4.16_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.16/Galley_0.4.16_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.15...v0.4.16

---

## What's New

- 对话过程区改为序号栏（`01`、`02`……）加左侧 rail；工具行退到步骤摘要之下一级，展开箭头贴在文字末尾，进行中的步骤落定后才显示序号。
- 拉取到的模型列表并进模型输入框做下拉：点右侧箭头或直接输入筛选。填完 API 地址和 Key 后的自动拉取会显示「读取中」和「找到 N 个模型」，列表不再凭空出现。
- 中文界面下 Settings 侧栏以中文为主标签，英文 tab 名退为小字副标签（社区反馈：太小太淡看不清）。
- 1x / 低 DPI 屏幕（Windows 100–150 % 缩放、非 Retina 外接屏）上的图标按常规线宽绘制，不再是发虚的半像素细线；字体栈显式加入微软雅黑（社区反馈）。
- 会话行菜单（⋯ 与右键）第一项改为「置顶 / 取消置顶」。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.16/Galley_0.4.16_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.16/Galley_0.4.16_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.16/Galley_0.4.16_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
