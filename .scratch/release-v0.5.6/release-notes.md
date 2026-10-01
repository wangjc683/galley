## What's New

- A run that reaches GA's per-run step limit now ends as paused, with "Continue" suggested as the reply, instead of staying busy until you press Stop.
- While a session is waiting on a question Galley asked, `galley session send` answers it at once instead of queuing behind messages that can never run.
- Agents supervising Galley can see that state: `live.askPending` and `live.lastExit`, the question on the asking message (`askUser`), and `galley session wait --until-idle`, which returns only once the run has ended.
- The Supervisor SOP (Settings → Agent → Copy SOP) no longer has agents wait with `--after-turn=<turnCount+1>`, which skipped a run's first step; copy it again if your agent uses it.
- With Bundled GA, asking the agent to set up a recurring task points you to Scheduled in the sidebar instead of writing a GA task file that never runs.
- Adding a model provider offers a Custom card for any OpenAI- or Anthropic-compatible endpoint, with the protocol chosen inside it; the OpenAI and Anthropic cards are labeled Official API.
- The first model of a provider on a non-official endpoint no longer sends `reasoning_effort: high`, which some compatible services reject.
- With Bundled GA, base URLs with a `v1beta`-style version, such as Gemini's `…/v1beta/openai/`, work in Test connection and in chat.

## Under the Hood

- A run the engine ends without reporting an exit is closed after a runtime error, so a Goal stops as blocked instead of looping.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.5.6/Galley_0.5.6_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.5.6/Galley_0.5.6_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.5.6/Galley_0.5.6_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.5.5...v0.5.6

---

## What's New

- 一次运行跑满 GA 的单次步数上限后以「已暂停」结束，输入框建议回复「继续」，不再一直显示工作中、直到手动停止。
- 会话停在 Galley 的提问上时，`galley session send` 直接作为回答发出，不再排在永远出不去的消息后面。
- 调度 Galley 的 Agent 能看到这一状态：`live.askPending` 与 `live.lastExit`、提问消息上的 `askUser`，以及运行结束后才返回的 `galley session wait --until-idle`。
- Supervisor SOP（设置 → Agent → 复制 SOP）不再让 Agent 用 `--after-turn=<turnCount+1>` 等待，这个写法会跳过一次运行的第一步；在用的话请重新复制。
- 使用内置 GA 时，让 Agent 设置定期任务会引导你去侧栏「定时」，不再写一个永远不会执行的 GA 任务文件。
- 添加模型提供商时新增「自定义」卡片，可接任意 OpenAI 或 Anthropic 兼容接口，协议在卡片内选择；OpenAI 与 Anthropic 卡片标为「官方 API」。
- 地址不是官方接口的提供商，第一个模型不再带 `reasoning_effort: high`（部分兼容服务会拒绝）。
- 使用内置 GA 时，带 `v1beta` 一类版本段的地址（如 Gemini 的 `…/v1beta/openai/`）在测试连接和对话中都能正常使用。

## Under the Hood

- 引擎未上报退出就结束的运行，会在报出运行时错误后关闭，Goal 随之转为受阻，不再反复续跑。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.5.6/Galley_0.5.6_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.5.6/Galley_0.5.6_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.5.6/Galley_0.5.6_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
