<!--
GitHub Release notes 草稿 for v0.4.15 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template（English first, 中文 second）。
TAG=v0.4.15  VERSION=0.4.15  PREVIOUS_TAG=v0.4.14
-->

## What's New

- Model advanced settings gain "Max retry wait": when a provider asks to retry later, Galley waits at most this long before resending (default 60 s, unchanged). Raise it for relays that ask for longer waits (community report).
- `!!!Error: HTTP … (retry-after > 60s)` now names the wait the provider asked for, e.g. `(retry-after 120s > 60s cap)`, so you can see what to set.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.15/Galley_0.4.15_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.15/Galley_0.4.15_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.15/Galley_0.4.15_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.14...v0.4.15

---

## What's New

- 模型高级配置新增「重试等待上限」：服务商要求稍后重试时，Galley 最多等这么久再重发（默认 60 秒，不变）。中转站要求等待更久时可调大（社区反馈）。
- `!!!Error: HTTP … (retry-after > 60s)` 现在会写明服务商要求的等待秒数，例如 `(retry-after 120s > 60s cap)`，一看就知道该设多少。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.15/Galley_0.4.15_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.15/Galley_0.4.15_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.15/Galley_0.4.15_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
