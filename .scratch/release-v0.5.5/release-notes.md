## What's New

- Discord and Telegram runs read like the desktop: one silent status message tracks progress and gives way to a single answer headed by the step count and duration (on Telegram, an expandable step list).
- Questions Galley asks mid-task always reach Discord and Telegram, with the options as buttons and your pick ticked on the question.
- Discord, Feishu, Telegram and WeChat continue the same conversation after a Channels restart, and activated Discord channels stay activated; `/new` starts over (now on WeChat too), and Disconnect ends the conversation.
- Completion reports arrive as cards on Discord, and on Telegram with a bold title and a status line instead of turn markers and tool calls.
- On Telegram, `/stop` and `/new` no longer leave a queued message running unseen.
- On Telegram, tables and headings render as lists and bold lines instead of raw `|` and `#`.
- On Discord, `/btw` and `/review` run instead of replying with the help text.
- On macOS with Bundled GA, Stop interrupts a request the model provider has not started answering, instead of holding your next message for up to three minutes.
- `galley llm list` lists the current runtime's models (Galley's model list under Bundled GA) and takes `--runtime current|managed|external`.
- With an external GA, `galley llm set` and `galley session new --llm` no longer fail with `llm_list pref shape mismatch`.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.5.5/Galley_0.5.5_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.5.5/Galley_0.5.5_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.5.5/Galley_0.5.5_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.5.4...v0.5.5

---

## What's New

- Discord 与 Telegram 里的对话与桌面端一致：一条静音状态消息显示进度，结束后换成一条回答，开头标出步数与用时（Telegram 为可展开的步骤列表）。
- Galley 在任务中向你提问时，问题一定会发到 Discord 与 Telegram，候选项显示为按钮，所选项在原题上打勾。
- Discord、飞书、Telegram、微信在重启 Channels 后接着原来的对话继续，Discord 已激活的频道保持激活；`/new` 开始新对话（微信新增），断开连接即结束该渠道的对话。
- 完成报告在 Discord 以卡片发出；在 Telegram 带粗体标题与状态行，不再夹带轮次标记和工具调用。
- Telegram 里 `/stop`、`/new` 不再让排队中的消息在后台无声运行。
- Telegram 里表格与标题显示为列表与粗体行，不再露出 `|` 与 `#`。
- Discord 里 `/btw`、`/review` 正常执行，不再只回帮助。
- macOS 上使用内置 GA 时，停止能打断模型服务尚未开始回复的请求，下一条消息不再最多等三分钟。
- `galley llm list` 列出当前运行时的模型（内置 GA 下为 Galley 的模型列表），并支持 `--runtime current|managed|external`。
- 使用外置 GA 时，`galley llm set` 与 `galley session new --llm` 不再报 `llm_list pref shape mismatch`。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.5.5/Galley_0.5.5_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.5.5/Galley_0.5.5_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.5.5/Galley_0.5.5_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
