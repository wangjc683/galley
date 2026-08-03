<!--
GitHub Release notes 草稿 for v0.4.2 — 发布时贴进 draft Release。
按 docs/release-notes-guide.md 的 stable template(English first, 中文 second)。
TAG=v0.4.2  VERSION=0.4.2  PREVIOUS_TAG=v0.4.1
-->

## What's New

- Know when a scheduled task fails: the sidebar badge now counts runs that need your attention, and a failed run raises a notification instead of failing silently.
- Try a scheduled task without waiting for its next slot: each task gets a Run now action, and the task form previews exactly when the next run will fire as you edit the schedule.
- Scheduled tasks tell you when they cannot fire: if launch-at-login is off, the task list explains that Galley must be running and offers to turn it on.
- Find the right question faster: hovering a marker in the question rail now shows the answer alongside the question, so you can tell two similar prompts apart without jumping into the conversation.
- Stop now really stops: pressing stop tears down the in-flight request immediately instead of letting it finish in the background, and a session no longer hangs when a provider asks for an unreasonably long retry delay.
- Model reasoning stays in the thinking pane: extended reasoning from Claude models is collected there instead of appearing at the top of the reply.

## Under the Hood

- Bundled GA moves to upstream baseline `d8d90ee`, which brings the abort and streaming-robustness work above, including proper handling of Responses API terminal events that previously triggered empty-response retries.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.4.2/Galley_0.4.2_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.4.2/Galley_0.4.2_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.4.2/Galley_0.4.2_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.4.1...v0.4.2

---

## What's New

- 定时任务失败不再无声:侧边栏角标现在统计需要你处理的运行,失败的运行会发出通知。
- 不用等下一个时段就能试跑:每个定时任务新增「立即运行」,任务表单也会在你调整时间时实时预告下一次触发的具体时刻。
- 定时任务会告诉你它为什么跑不了:如果没有开启开机自启,任务列表会说明 Galley 需要处于运行状态,并提供一键开启。
- 更快找到那一问:悬停问题导轨上的标记时,现在会连同回答一起显示,不用跳进对话就能区分两个相似的提问。
- 停止就是立刻停止:按下停止会立即中断在途请求,而不是让它在后台跑完;当服务端要求一个过长的重试等待时,会话也不再卡住。
- 模型思考内容归位:Claude 模型的深度思考会被收进思考面板,不再出现在回答正文的开头。

## Under the Hood

- 内置 GA 升级到上游基线 `d8d90ee`,上面的中断与流式健壮性改进来自这次升级,其中也包含对 Responses API 终止事件的正确处理(此前会触发空响应重试)。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.4.2/Galley_0.4.2_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.4.2/Galley_0.4.2_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley,可以在终端执行:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.4.2/Galley_0.4.2_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险,点击「更多信息」->「仍要运行」。
