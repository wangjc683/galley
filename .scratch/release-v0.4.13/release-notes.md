<!--
GitHub Release notes 草稿 for v0.4.13 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template（English first, 中文 second）。
TAG=v0.4.13  VERSION=0.4.13  PREVIOUS_TAG=v0.4.12
-->

## What's New

- Code, data, log and image files referenced in replies open in the reading panel beside the conversation, not only Markdown: CSV / TSV render as a table, single-line JSON is re-indented, images show at full size with their pixel dimensions. "Open with default app" is offered for documents and images only, never for scripts.
- The Git review panel gets a baseline picker: compare the worktree against any recent commit instead of only the latest one, so a review survives the Agent committing its work.
- The Bundled GA names the files it creates by full path, so they are click-to-open in the conversation instead of bare filenames.
- The sidebar adds a 本月 / This month section (rolling 30 days) between This week and Earlier; the Project view's active window widens to 30 days to match, and a sidebar with nothing recent now surfaces the last 10 conversations instead of 5.
- Tables in replies fill the reading column and wrap their cells instead of scrolling sideways; the Git review gutter sizes to the patch.

## Under the Hood

- `galley sessions list`, `session brief` and `status` attach a `live` object (`busy`, `openRun`, `queuedCount`) read from Galley Core, the truthful "is it running" signal the persisted status column never carried; `galley … | head` exits quietly instead of panicking; help text drops internal codenames. All additive under `schemaVersion: 1`.
- The Supervisor SOP, reference and both skill copies now teach `session wait --after-turn`, `dispatch: "queued"`, Goal `--mode=solo`, and the reversibility split consistently; the Claude / Codex skill is a thin pointer to the SOP instead of a hand-maintained paraphrase.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.13/Galley_0.4.13_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.13/Galley_0.4.13_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.13/Galley_0.4.13_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.12...v0.4.13

---

## What's New

- 回复中引用的代码、数据、日志和图片文件都能在对话旁的阅读面板打开，不再只有 Markdown：CSV / TSV 渲染为表格，单行 JSON 自动缩进，图片原尺寸显示并标出像素尺寸。「用默认应用打开」只对文档和图片提供，脚本文件不提供。
- Git 改动面板新增比较基线：可以选最近任意一个提交作为基线，而不只是最新提交，Agent 提交之后改动仍然看得到。
- 内置 GA 会用完整路径写出它创建的文件，对话里可以直接点开，而不是只给文件名。
- 侧栏在「本周」和「更早」之间新增「本月」（滚动 30 天）；项目视图的活跃范围同步放宽到 30 天；侧栏近期为空时改为显示最近 10 个对话。
- 回复中的表格占满阅读栏并自动换行，不再横向滚动；Git 改动视图的行号栏按补丁宽度排版。

## Under the Hood

- `galley sessions list`、`session brief`、`status` 附带从 Galley Core 读取的 `live` 对象（`busy`、`openRun`、`queuedCount`），这是持久化状态列从来给不出的真实忙闲信号；`galley … | head` 静默退出不再 panic；帮助文案去掉内部代号。全部为 `schemaVersion: 1` 下的增量。
- Supervisor SOP、参考文档和两份 skill 副本统一补上 `session wait --after-turn`、`dispatch: "queued"`、Goal `--mode=solo` 与可逆操作分档；Claude / Codex skill 改为指向 SOP 的薄封装，不再手写改编。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.13/Galley_0.4.13_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.13/Galley_0.4.13_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.13/Galley_0.4.13_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
