## What's New

- Projects have their own section in the sidebar, under Pinned: each project is one row that opens to its five newest chats, with Show more for the rest; projects quiet for 30 days sit behind More projects; chats waiting for you or erroring stay visible when a project or the section is folded. The separate projects view is gone.
- New chat in the sidebar always starts a chat outside any project, like ⌘N; to start one inside a project, use the project's + or New chat in its menu.
- Deleting a project can archive its conversations in the same step (ticked by default) instead of returning them to the timeline.
- In the sidebar, titles too long for the row fade out instead of ending in `…`, and New chat stays highlighted while the empty composer is open.
- The dark theme's background and text are now a cool blue-grey.
- Updates download in the background and install only when you click Restart to update, so Channels and Browser Control keep running until then; About names the new version, and About and the top bar offer Download update when automatic download is off. Updating from v0.6.1 or earlier still uses the old flow once: on macOS, Channels and Browser Control stop when the update installs in the background and stay off until you restart Galley.
- Channel secrets (Telegram and Discord bot tokens, the Feishu App Secret, the WeChat login token) show only their last four characters in status lines, the Channels menu and logs; a rejected Telegram token used to appear in full.
- Channels: a set-up channel that is paused, failing or reconnecting keeps its status view instead of falling back to the setup guide; an enabled channel can be paused in any state; WeChat answers /help and /status; Restart Channels restarts each channel even if one of them fails.
- Browser Control: a verified install keeps its status card when the browser bridge errors or restarts, instead of showing the install guide again; Other covers Chromium browsers such as Vivaldi, Brave and Arc; connection test results follow the UI language.
- Models: number fields keep what you type until you leave the field (backspacing a read timeout to 1 and typing 60 used to give 560); an unsaved provider form is no longer replaced when you open another one; Move up / Move down are in each model's ⋯ menu.
- With Bundled GA, chats started from the window always use the bundled Python, as Agent / CLI already did; Use external Python… applies to external GA only.
- On macOS, only ⌘ triggers Galley's shortcuts, so Ctrl+K and Ctrl+N stay text-editing keys; Help → Report an Issue… opens Settings → Report an Issue.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.6.2/Galley_0.6.2_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.6.2/Galley_0.6.2_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.6.2/Galley_0.6.2_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.6.1...v0.6.2

---

## What's New

- 侧栏新增「项目」区，位于「置顶」之下：每个项目占一行，展开后列出最近 5 条对话，其余点「显示更多」；30 天没有动静的项目收在「更多项目」里；项目或整个区折叠时，等你回复和出错的对话仍会显示。单独的项目视图已移除。
- 侧栏的「新对话」和 ⌘N 一样，总是开一条不属于任何项目的对话；要在项目里新开，用项目行的 ＋ 或菜单里的「新建项目对话」。
- 删除项目时可以一并归档里面的对话（默认勾选），不再全部退回时间线。
- 侧栏里放不下的标题改为淡出，不再以 `…` 截断；空白输入框打开时，「新对话」一行保持选中。
- 深色主题的底色与文字改为冷调蓝灰。
- 更新在后台只下载，点「重启并更新」时才安装，在此之前渠道和浏览器控制照常运行；关于页写出新版本号，关闭自动下载时关于页和顶栏都提供「下载更新」。从 v0.6.1 及更早版本升级的这一次仍走旧流程：macOS 上更新在后台装好后，渠道和浏览器控制会停止，重启 Galley 后恢复。
- 渠道密钥（Telegram 与 Discord 的 bot token、飞书 App Secret、微信登录 token）在状态行、Channels 菜单和日志里只显示末 4 位；此前 Telegram token 被拒时会完整显示。
- 渠道：接入完成的渠道在暂停、出错或重连时保留自己的状态页，不再退回接入引导；已启用的渠道在任何状态下都能暂停；微信支持 /help 与 /status；「重启 Channels」逐个重启，某个渠道失败也不影响其他渠道。
- 浏览器控制：已验证的安装在浏览器桥出错或重启时保留状态卡片，不再重新显示安装引导；新增「其他」，适用于 Vivaldi、Brave、Arc 等 Chromium 浏览器；测试连接的结果跟随界面语言。
- 模型：数字输入框在离开时才校正（读取超时退格到 1 再输入 60，过去会变成 560）；打开另一个服务商编辑时，不再覆盖未保存的表单；「上移 / 下移」移到每个模型的 ⋯ 菜单里。
- 使用内置 GA 时，从窗口发起的对话总是用内置 Python，与 Agent / CLI 一致；「使用外部 Python…」只对外部 GA 生效。
- macOS 上只有 ⌘ 触发 Galley 快捷键，Ctrl+K、Ctrl+N 保留为文本编辑键；「Help → Report an Issue…」打开「设置 → 报告问题」。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.6.2/Galley_0.6.2_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.6.2/Galley_0.6.2_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.6.2/Galley_0.6.2_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
