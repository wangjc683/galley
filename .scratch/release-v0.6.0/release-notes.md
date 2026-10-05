## What's New

- Tool approval is removed: tool calls always run directly, as in upstream GenericAgent, and the per-session approval mode, the auto-run switch, always-allow rules and the Approval settings page go with it. GA's own system prompt still tells the agent to ask before irreversible actions.
- With Bundled GA, Browser Control stays connected in the background: the extension connects as soon as Chrome is open, the launch-time check and its "checking" badge are gone, and the first connection verifies itself, then offers "Try it".
- Browser steps in the conversation name the site: "Read webpage" shows the page title and host, "Run webpage script" shows the host.
- The top bar always shows Browser Control and Channels, plain when live and dimmed when not; each opens a menu with its status (tab count, one row per channel you have set up) and Settings….
- Until Browser Control is set up, the top bar invites you to unlock it ("Browser Control · Unlock") instead of showing a warning.
- Display in the top bar holds reading width, font size and theme; font size also has ⌘= / ⌘- / ⌘0 (Ctrl on Windows) and a submenu in the macOS View menu, and reading width joins Settings → General.
- The repository changes button appears once Galley knows a repository; "Review repository changes" in the command palette is always available.
- The composer's ＋ menu holds "Files or images…", "Folders…" and "Saved prompts…"; the Goal toggle becomes a plain icon.
- The sidebar opens with a masthead row (search, scheduled, projects) above a full-width New chat row; Supervisor SOP moves to the top bar toolbar, and the engine status to the top bar status icons.
- Finished sessions show a check circle instead of the "Done · " prefix, and the selected session always stays visible in the sidebar, even when it is older than the recent list.
- The interface says "model" instead of "LLM".

## Under the Hood

- Agent API stays at `schemaVersion: 2`: `waiting_approval` is no longer produced, so `galley status` reports `waitingInput: 0`, and the undocumented `SessionBrief.approvalMode` is gone; no command, flag or documented field was removed.
- Bundled GA gives every session a live default browser tab, not just the first one, so page scripts no longer wait 3 seconds on a dead tab.
- Old approval settings and records stay in the database unread; no migration.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/v0.6.0/Galley_0.6.0_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/v0.6.0/Galley_0.6.0_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/v0.6.0/Galley_0.6.0_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/v0.5.6...v0.6.0

---

## What's New

- 去掉工具审批：工具调用一律直接执行，与上游 GenericAgent 一致；按会话的审批模式、自动执行开关、常驻允许规则和设置里的审批页一并移除。GA 自带的系统提示词仍要求 Agent 在不可逆操作前先询问。
- 使用内置 GA 时，浏览器控制在后台常驻：Chrome 一打开扩展就连上，启动时的检测和「检测中」徽标不再出现，第一次连上自动完成验证，并提示「试一试」。
- 对话里的浏览器步骤标出网站：「读取网页」显示页面标题和域名，「执行网页脚本」显示域名。
- 顶栏常驻浏览器控制与 Channels 两个图标，在线时是普通图标，不在线时变淡；点开是菜单，显示状态（标签页数、每个已设置的平台一行）和「设置…」。
- 浏览器控制还没设置时，顶栏改为邀请你解锁（「浏览器控制 · 待解锁」），不再显示警告。
- 顶栏「显示」收纳阅读宽度、字号和主题；字号另有 ⌘= / ⌘- / ⌘0（Windows 用 Ctrl）和 macOS View 菜单里的子菜单，设置 → 通用新增「阅读宽度」。
- 仓库改动按钮在 Galley 知道仓库后才出现；命令面板里的「查看仓库改动」始终可用。
- 输入框的 ＋ 菜单收纳「文件或图片…」「文件夹…」「常用提示词…」；Goal 开关改为无底色图标。
- 侧栏顶部改为书眉行（搜索、定时、项目）加独占一行的「新对话」；Supervisor SOP 移到顶栏工具区，内核状态移到顶栏状态图标。
- 已完成的会话改用对勾圈标识，不再加「已完成 · 」前缀；当前选中的会话始终在侧栏可见，即使它不在最近列表里。
- 界面里的「LLM」统一改称「模型」。

## Under the Hood

- Agent API 仍是 `schemaVersion: 2`：`waiting_approval` 不再出现，`galley status` 的 `waitingInput` 恒为 `0`；未写入文档的 `SessionBrief.approvalMode` 字段移除；没有删除任何命令、参数或已写入文档的字段。
- 内置 GA 为每个会话（不只第一个）维持一个可用的默认标签页，网页脚本不再空等 3 秒。
- 旧的审批设置与记录留在数据库里不再读取，不做迁移。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/v0.6.0/Galley_0.6.0_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/v0.6.0/Galley_0.6.0_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/v0.6.0/Galley_0.6.0_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
