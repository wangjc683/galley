<!--
GitHub Release notes 草稿 for v0.4.0 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template(English first, 中文 second)。
TAG=v0.4.0  VERSION=0.4.0  PREVIOUS_TAG=v0.3.7
-->

## What's New

- Schedule recurring work: create tasks that auto-start a session on a daily, weekly, or monthly cadence — each with its own model — so routine runs happen without opening Galley.
- Stay in control of scheduled runs: you're notified when a scheduled session is waiting for approval, and runs missed while the app was closed catch up automatically; a first-run example screen makes the feature discoverable on day one.
- Newer engine: the Bundled GA runtime moves to the latest audited baseline, and plan mode is retired following upstream.

## Under the Hood

- Large-scale structural refactor across Rust Core and the GUI (big-file splits, store slicing) with no behavior change, to keep the codebase maintainable.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.0/Galley_0.4.0_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.0/Galley_0.4.0_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.0/Galley_0.4.0_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.3.7...v0.4.0

---

## What's New

- 定时任务:可按每天 / 每周 / 每月的节奏创建自动发起会话的任务,每个任务可单独选模型,日常例行运行无需手动打开 Galley。
- 掌控定时运行:定时会话等待审批时会收到通知,应用关闭期间错过的运行会自动补跑;首次进入定时任务界面有示例引导,第一天就能上手。
- 内核升级:内置 GA 更新到最新审计基线,并随上游移除 plan mode。

## Under the Hood

- Rust Core 与 GUI 的大规模结构性重构(大文件拆分、store 切片),行为零变化,便于长期维护。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.0/Galley_0.4.0_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.0/Galley_0.4.0_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley,可以在终端执行:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.0/Galley_0.4.0_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险,点击「更多信息」->「仍要运行」。
