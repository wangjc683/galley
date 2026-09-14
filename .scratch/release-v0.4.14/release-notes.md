<!--
GitHub Release notes 草稿 for v0.4.14 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template（English first, 中文 second）。
TAG=v0.4.14  VERSION=0.4.14  PREVIOUS_TAG=v0.4.13
-->

## What's New

- When the Agent asks you a question, the question text can now be selected and copied (community report). Questions render as Markdown, so numbered options, paths and inline code read the way they do in replies, and single line breaks are kept.
- Sentence-length or numerous candidate options stack as a list instead of wrapping as chips, so their order stays readable; short options stay inline.
- Right-click a candidate (or ⌘ / Ctrl + click) to fill it into the composer without sending, so you can edit an option before replying. A plain click still sends it.
- After you answer, the question stays in the conversation with the options it offered and a check on the one you picked.
- The composer placeholder says "choose an option above" only when there are options above; open questions no longer look like their options failed to render.

## Fixes

- Models that split one question into several single-option calls (seen with grok-4.6) showed only the first option; Galley now merges them into one question with all its options, live and after a restart.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.14/Galley_0.4.14_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.14/Galley_0.4.14_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.14/Galley_0.4.14_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.13...v0.4.14

---

## What's New

- Agent 向你提问时，问题文字现在可以选中和复制（社区反馈）。问题按 Markdown 渲染，编号选项、路径和行内代码与回复里一致，单个换行也会保留。
- 句子级或数量较多的候选项改为竖排列表，不再横排折行，顺序一目了然；短选项仍然横排。
- 右键候选项（或 ⌘ / Ctrl + 点击）可以把它填进输入框而不发送，改几个字再回复。直接点击仍然立即发送。
- 回答之后，问题连同当时的候选项一起留在对话里，并勾出你选的那一项。
- 输入框占位只在上方确有候选项时才提示「选择上方候选」，开放式提问不再让人误以为选项没显示出来。

## Fixes

- 有的模型会把一个问题拆成多次单候选调用（grok-4.6 出现过），此前只显示第一个候选；现在会合并成一个问题和完整的候选列表，实时与重启后都如此。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.14/Galley_0.4.14_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.14/Galley_0.4.14_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.14/Galley_0.4.14_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
