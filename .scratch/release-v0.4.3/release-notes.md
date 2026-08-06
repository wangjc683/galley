<!--
GitHub Release notes 草稿 for v0.4.3 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template（English first, 中文 second）。
TAG=v0.4.3  VERSION=0.4.3  PREVIOUS_TAG=v0.4.2
-->

## What's New

- Sessions name themselves: after the first exchange completes, Galley asks the model for a short, specific title, so the session list reads like a table of contents instead of truncated first messages. Titles you typed yourself are never overwritten.
- The composer drafts your next message: when a reply ends by offering a follow-up, that follow-up appears as ghost text already written in your voice — accept it with the arrow key, Tab, or a click. Available with the bundled GA.
- Long sessions read like a document: once a run finishes, its intermediate steps fold behind a one-line header, so the conversation becomes clean questions and answers with every step still one click away. The run you are watching stays expanded until you send the next message.
- Your words stand out: user messages drop the boxy callout for a highlighter-marked look that hugs the text, so scanning a long conversation for your own voice is faster.
- Usage stats no longer show 0 input tokens: providers on Anthropic-compatible endpoints (such as GLM) report input usage at the end of the stream, which the bundled GA previously missed — the footer telemetry and `/cost` now count both directions.
- Settings opens on General: the gear button, the command palette, and ⌘, now always land on the first tab, instead of wherever you last left the settings window.
- A cross-app visual polish pass: unified dialog pop-in, consistent menu radii and press feedback, deeper sidebar chrome that lifts the main stage, and the About page now shows the release date beside the version.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.3/Galley_0.4.3_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.3/Galley_0.4.3_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.3/Galley_0.4.3_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.2...v0.4.3

---

## What's New

- 会话自己起名字：首轮问答完成后，Galley 会请模型生成一个简短贴切的标题，会话列表从「截断的第一句话」变成一张目录。你手动改过的标题永远不会被覆盖。
- 输入框替你起草下一条消息：当回复以「需要的话我可以继续……」收尾时，这条后续会以幽灵文字的形式出现在输入框里，并且已经换成你的口吻——按方向键、Tab 或点击即可接受。内置 GA 可用。
- 长会话读起来像一篇文档：run 结束后，中间步骤会折叠进一行折叠头，对话变成干净的一问一答，而每个步骤仍然一键可展开。你正在看的 run 会保持展开，直到你发出下一条消息。
- 你的话更醒目：用户消息不再是方盒子，改为贴合文字的荧光笔标记样式，在长对话里回找自己说过的话更快。
- 用量统计不再显示 0 输入 token：走 Anthropic 兼容端点的服务商（如 GLM）把输入用量放在流的末尾上报，此前内置 GA 会漏记——现在底部遥测和 `/cost` 两个方向都能数对。
- 设置固定落在「通用」：齿轮按钮、命令面板、⌘, 三个入口现在总是打开第一个 tab，而不是停在你上次离开的位置。
- 一轮全局视觉打磨：统一的对话框弹入动画、一致的菜单圆角与按压反馈、更深的侧栏底色让主舞台立起来，「关于」页的版本号旁也新增了发布日期。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.3/Galley_0.4.3_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.3/Galley_0.4.3_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.3/Galley_0.4.3_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
