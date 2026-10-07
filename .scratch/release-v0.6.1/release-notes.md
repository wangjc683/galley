## What's New

- With Bundled GA, asking what Galley is or what it can do gets an answer drawn from Galley's actual features; asking it to change a setting (an API key, Channels, a scheduled task) gets the Settings page and the values to fill in, not an attempt through files.
- Over Channels, replies are shaped for a phone screen, answer first and lists instead of tables; the assistant opens a desktop session only when you ask or the task would run long.
- Settings reads the same across tabs: in the Chinese UI, page headers and section labels are in Chinese and 「提供商」 is now 「服务商」; status badges and expandable rows share one look; the sidebar groups pages by how often they are used; About describes Galley as a lightweight local AI assistant.
- A run keeps every step and its final answer when the window reloads mid-run (macOS recovering a crashed page, F5 / Ctrl+R on Windows), and opening it afterwards no longer restarts it.
- Sessions started from Agent / CLI, Channels or a scheduled task are no longer deleted when Galley launches or reloads before their first reply finishes.

## Under the Hood

- Galley Core saves each step itself instead of relying on the window, so `galley session wait --until-idle` returns the run's real final answer even when no window is listening.
- Bundled GA moves to upstream as of 2026-09-30: long-term memory consolidation may now merge duplicate entries and compress existing ones, not only add new ones.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.6.1/Galley_0.6.1_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.6.1/Galley_0.6.1_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.6.1/Galley_0.6.1_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.6.0...v0.6.1

---

## What's New

- 使用内置 GA 时，问 Galley 是什么、能做什么，回答以 Galley 实际有的功能为准；让它改设置（API Key、聊天软件、定时任务），它会指到对应的设置页并给出要填的内容，不再尝试改文件。
- 通过聊天软件对话时，回复按手机屏幕排版：先给结论，用列表不用表格；只在你要求或任务会跑很久时才在桌面开会话。
- 设置各页统一：中文界面的页头和分组标题改为中文，「提供商」改称「服务商」；状态徽标与可展开行统一样式；侧栏按使用频率分组；关于页把 Galley 介绍为极简 harness 的本地全能 AI 助手。
- 运行中途窗口重载（macOS 恢复崩溃的页面、Windows 按 F5 / Ctrl+R）时，这一轮的每个步骤和最终回答都完整保留；重载后点开还在跑的对话，也不会再把它重启。
- 由 Agent / CLI、聊天软件或定时任务发起的会话，在首次回复完成前遇到 Galley 启动或重载，不会再被删除。

## Under the Hood

- 每个步骤改由 Galley Core 自己保存，不再依赖窗口；即使没有窗口在接收，`galley session wait --until-idle` 也返回这一轮真正的最终回答。
- 内置 GA 更新到上游 2026-09-30 的版本：长期记忆整理除了新增条目，还可能合并重复条目、压缩已有条目。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.6.1/Galley_0.6.1_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.6.1/Galley_0.6.1_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.6.1/Galley_0.6.1_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。

