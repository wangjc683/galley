# Galley English Copy Draft

> **ARCHIVED 2026-07-04** — the review pass finished and native English UI
> copy shipped. The live source of truth is `gui/src/i18n/locales/en.ts`;
> voice rules live in [copy austerity principles](../copy-austerity-principles.md).
> This draft is kept for provenance only.

This draft is written as native English product copy for Galley. It is not a
literal translation of the Chinese UI. Shared product concepts stay consistent,
but sentence shape and tone are adjusted for English.

## Voice

- Local-first, precise, calm.
- Operational rather than promotional.
- Short labels over explanatory text.
- Keep product and ecosystem terms as-is: Galley, GenericAgent, GA, Agent,
  Supervisor, SOP, Runtime, Health Check, CLI, API, MCP, Socket, Python, API
  Key, YOLO, LLM.
- Use "conversation" for user-facing chats/sessions.
- Use "project" for project grouping.
- Use "tool call" for agent tool execution.
- Use "allowlist" for approval bypass rules.

## Language Preference

| Surface | English copy |
|---|---|
| Settings rail button primary | Language |
| System option | Auto |
| System option helper | Follow system |
| Chinese option | Chinese |
| English option | English |
| Aria label | Choose interface language |

Notes:

- `Auto` remains the default.
- English UI does not show Chinese helper labels under Settings tabs.

## Sidebar

### Runtime Status

| Chinese intent | English copy |
|---|---|
| 配置模型 | Set up model |
| 内置 GA 还没有可用模型 | Bundled GA needs a model |
| 打开 Models 配置内置 GA 模型 | Open Models to set up bundled GA |
| 外部 GA | External GA |
| 正在使用你接入的 GenericAgent | Using your connected GenericAgent |
| 接入外部 GA | Connect external GA |
| 选择一个已有的 GenericAgent 目录 | Choose an existing GenericAgent folder |
| 打开 Runtime 接入外部 GA | Open Runtime to connect external GA |

### Quick Actions

| Chinese intent | English copy |
|---|---|
| 新对话 | New conversation |
| 新对话 · {projectName} | New conversation · {projectName} |
| 搜索 | Search |
| 项目 | Projects |
| 进入项目视图 | Show projects |
| 退出项目视图 | Exit projects |
| 新建项目 | New project |

### Session Rows And Status

| Chinese intent | English copy |
|---|---|
| 新对话 | New conversation |
| 正在工作 | Working |
| 思考中 | Thinking |
| 等你回复 | Waiting for you |
| 未读 | New reply |
| 桌面宠物附着中 | Desktop Pet attached |
| 进入此对话可关闭 | Open this conversation to detach |
| 已 Archive | Archived |
| 已归档 {count} 个对话 | Archived {count} conversations |

Recommendation:

- Keep the visual section anchor `PROJECTS` if it is used as a dense sidebar
  anchor.
- Do not introduce "chat" unless a specific OS/browser convention requires it.
  "Conversation" is the Galley term.

## Top Bar

| Chinese intent | English copy |
|---|---|
| 新对话 | New conversation |
| 设置 · {shortcut} | Settings · {shortcut} |
| 打开设置 | Open Settings |
| 切到紧凑阅读宽度 | Switch to compact width |
| 切到宽松阅读宽度 | Switch to wide width |
| YOLO 模式已开启 | YOLO is on |
| YOLO 模式已开启 · 点击查看 | YOLO is on · View details |
| 所有工具调用跳过审批直接执行 | Tool calls run without approval |
| 立即关闭 | Turn off now |
| 在设置中查看 | View in Settings |

Shortcut display:

- macOS compact hints: `⌘K`, `⌘N`.
- macOS explanatory hints: `⌘ + K`, `⌘ + ,`.
- Windows explanatory hints: `Ctrl + K`, `Ctrl + ,`.

## Composer

| Chinese intent | English copy |
|---|---|
| 问点什么… | Ask anything... |
| 继续这个对话… | Continue this conversation... |
| 回复以继续，或选择上方候选 | Reply to continue, or choose an option above |
| 发送 | Send |
| 发送 · Enter | Send · Enter |
| 停止 | Stop |
| Enter 发送 · Shift+Enter 换行 | Enter to send · Shift+Enter for a new line |
| 切换 LLM 不会丢失上下文 | Switching LLMs keeps the conversation context |
| 运行中无法切换 LLM | Cannot switch LLMs while a run is active |
| 切换 LLM · 当前 {name} | Switch LLM · Current: {name} |
| 修改 mykey.py 后重启 Galley 生效 | Restart Galley after editing mykey.py |
| 在 Models 调整内置 GA 模型 | Manage bundled GA models in Models |
| 将创建到 {projectName} | Will be created in {projectName} |

Paste-fold placeholder:

| Chinese intent | English copy |
|---|---|
| Pasted text placeholder | `[Pasted text #{id} +{lineCount} lines]` |

## Empty State And Main View

| Chinese intent | English copy |
|---|---|
| Scroll to latest | Scroll to latest |
| 第 {index} 步 | Step {index} |
| 思考中... | Thinking... |
| {seconds} 秒 | {seconds}s |
| 已 {minutes} 分 {seconds} 秒 | {minutes}m {seconds}s |
| 刚刚 | Just now |
| {minutes} 分钟前 | {minutes}m ago |
| {hours} 小时前 | {hours}h ago |
| {days} 天前 | {days}d ago |

## Command Palette

| Chinese intent | English copy |
|---|---|
| 命令面板 | Command palette |
| 搜索对话或输入命令… | Search conversations or type a command... |
| 搜索 LLM… | Search LLMs... |
| 新对话 | New conversation |
| 新建项目 | New project |
| 在对话内容中 | In conversation content |
| 切换 LLM | Switch LLM |
| 当前：{llm} | Current: {llm} |
| 跑一次 Health Check | Run Health Check |
| 打开设置 | Open Settings |
| 切换 GA 路径 | Change GA folder |
| 返回 | Back |
| 主菜单 | Main menu |
| 你的提问 | Your message |
| Agent 回复 | Agent reply |

Search aliases can include both English and Chinese. Visible copy should use
the English labels above.

## Settings Shell

### Tabs

English UI shows only the English tab labels:

```text
Runtime
Models
Approval
Agent
Shortcuts
About
```

| Control | English copy |
|---|---|
| Close Settings | Close |
| Language button | Language |
| Choose interface language | Choose interface language |

## Settings: Runtime

| Chinese intent | English copy |
|---|---|
| Runtime subtitle | GenericAgent runtime used by Galley |
| Runtime Mode | Runtime Mode |
| 内置 GA | Bundled GA |
| 推荐 | Recommended |
| 正在使用 | Active |
| 正在使用内置 GA | Using bundled GA |
| 需要先配置模型 | Set up a model first |
| 内置 GA 已可用 | Bundled GA is ready |
| 外部 GA | External GA |
| 接入外部 GA | Connect external GA |
| 外部 GA 路径 | External GA folder |
| 点「选择」走文件夹选取，或直接在框里输入 / 粘贴路径 · 回车提交 | Choose a folder, or paste a path and press Enter |
| 选择 | Choose |
| 更多 | More |
| Health Check | Health Check |
| 不知道哪儿出问题了？跑一次完整体检 —— 重新探测 Python 解释器、检查 GA 路径和必要文件。 | Not sure what is wrong? Run a full Health Check to re-detect Python, verify the GA folder, and check required files. |
| 跑一次 Health Check | Run Health Check |
| Python | Python |
| Galley 内置 · 已附带 GA 依赖，零配置可用 | Bundled with Galley · GA dependencies included |
| 使用外部 Python… | Use external Python... |
| 外部 Python · 改变后用下方 Re-run 重新探测 | External Python · Re-run Health Check after changing it |
| 改回 Galley 内置 Python | Use Galley's bundled Python |
| 高级诊断 | Advanced diagnostics |
| 当前模式 | Current mode |
| 内核版本 | Runtime version |
| 模型 | Models |
| 完整 | Complete |
| 缺失 | Missing |
| 未加载 | Not loaded |
| 未配置 | Not configured |
| 密钥按需读取 | API keys are read on demand |
| 诊断只显示路径、版本和凭据是否存在。API Key 不会显示在这里。 | Diagnostics only show paths, versions, and whether credentials exist. API Keys are never shown here. |

## Settings: Models

| Chinese intent | English copy |
|---|---|
| Models subtitle | Configure model providers and models for Galley |
| 当前使用外部 GA。这里配置的模型只会在内置 GA 中使用，不会修改外部 GA。 | External GA is active. Models configured here are only used by bundled GA and will not change external GA. |
| 已接入的模型提供商 | Connected model providers |
| 还没有模型提供商。 | No model providers yet. |
| 添加模型提供商 | Add model provider |
| 编辑模型提供商 | Edit model provider |
| 模型提供商 | Model provider |
| 模型密钥 | API Key |
| 密钥留空会继续使用已保存的 Key | Leave the key blank to keep the saved one |
| 留空表示不修改现有 Key | Leave blank to keep the existing key |
| API 地址 | API URL |
| 模型 | Model |
| 获取列表 | Fetch list |
| 自动获取模型列表 | Fetch model list |
| 选择检测到的模型 | Choose a detected model |
| 更多 | More |
| 提供商名称 | Provider name |
| 可选；默认使用模型提供商或 API 地址 | Optional; defaults to the provider or API URL |
| 测试连接 | Test connection |
| 保存 | Save |
| 取消 | Cancel |
| 模型名 | Model name |
| 显示名称 | Display name |
| 可选；默认使用模型名 | Optional; defaults to the model name |
| 筛选模型 | Filter models |
| 编辑模型提供商 | Edit model provider |
| 删除模型提供商 | Delete model provider |
| 编辑模型 | Edit model |
| 移除模型 | Remove model |
| 配置完成 | Setup complete |
| 找到 {count} 个模型 | Found {count} models |
| 连接成功，但没有返回模型列表 | Connected, but no model list was returned |
| 操作失败 | Action failed |

## Settings: Approval

| Chinese intent | English copy |
|---|---|
| Approval subtitle | Configure approval rules for Agent actions |
| YOLO 模式 | YOLO mode |
| You Only Live Once helper | You Only Live Once · Let Agent run without approval. Use only in trusted, isolated workspaces. |
| 跳过所有操作的审批，Agent 自主执行 — 适合完全信任 Agent 的沙盒环境 | Skip approval for every action. Agent runs on its own; best for trusted sandbox work. |
| 切换 YOLO 模式 | Toggle YOLO mode |
| YOLO 已启用 · 顶部栏显示状态 | YOLO is on · Shown in the top bar |
| 立即关闭 | Turn off now |
| YOLO 已开启，下列规则当前不生效（关闭 YOLO 后恢复）。 | YOLO is on. The rules below are paused until YOLO is turned off. |
| 需要审批的工具 | Tools requiring approval |
| 项目白名单 ({count}) | Project allowlist ({count}) |
| 全局白名单 ({count}) | Global allowlist ({count}) |
| 没有项目级白名单 | No project allowlist rules |
| 没有全局白名单 | No global allowlist rules |
| 在审批弹窗里加入白名单后，规则会显示在这里。 | Rules appear here after you add them from an approval prompt. |
| Remove {tool} | Remove {tool} |
| Remove rule | Remove rule |

YOLO activation modal:

| Chinese intent | English copy |
|---|---|
| 打开 YOLO 模式？ | Turn on YOLO mode? |
| YOLO = "You Only Live Once"。所有工具调用将不经审批直接执行——包括： | YOLO means "You Only Live Once." Tool calls will run without approval, including: |
| file_patch（修改文件） | file_patch (modify files) |
| file_write（写入文件） | file_write (write files) |
| code_run（执行命令） | code_run (run commands) |
| 其他高风险操作 | Other high-risk actions |
| 适合：完全信任 Agent + 在沙盒环境工作（个人 repo / 临时虚拟机） | Good for: a trusted Agent in a sandboxed workspace, personal repo, or temporary VM |
| 不适合：生产代码 / 共享系统 / 不熟悉的 Agent / 敏感数据 | Not for: production code, shared systems, unfamiliar Agents, or sensitive data |
| 打开后顶部栏会显示闪电图标和 YOLO 标识，随时可一键关闭。 | Galley will show a YOLO indicator in the top bar, and you can turn it off anytime. |
| 取消 | Cancel |
| 是的，我知道在做什么 | Yes, I understand the risk |

Approval prompt:

| Chinese intent | English copy |
|---|---|
| 允许 | Allow |
| 拒绝 | Deny |
| 加入「{projectName}」白名单 | Always allow in "{projectName}" |
| 加入全局白名单 | Always allow globally |
| 高敏感工具不允许全局自动通过 | High-risk tools cannot be globally allowed |
| 默认审批列表里的工具，需要你确认后才能执行 | This tool requires approval before it can run |
| 修改现有文件的内容 | Modifies an existing file |
| 写入或覆盖文件 | Writes or overwrites a file |
| 执行代码或 shell 命令 | Runs code or shell commands |
| 更新 GA 的长期记忆（持久化） | Updates GA long-term memory |
| 将修改文件：{path} | Will modify: {path} |
| 将写入文件：{path} | Will write: {path} |
| 将运行代码或命令 | Will run code or a command |
| 已通过 · 本次执行 | Allowed · This run |
| 已拒绝 · 已通知 AI | Denied · AI notified |
| 已加入此项目白名单 | Added to project allowlist |
| 已加入全局白名单 | Added to global allowlist |

## Settings: Agent

| Chinese intent | English copy |
|---|---|
| Agent subtitle | Let Agents inspect and operate Galley |
| Discovery file | Discovery file |
| Agent SOP | Agent SOP |
| 复制这份 SOP，发给你信任的 Agent。它就能帮你查看、创建和管理 Galley 对话。 | Copy this SOP for a trusted Agent. It can then inspect, create, and manage Galley conversations. |
| 命令行快捷入口 | CLI shortcut |
| API 文档 | API docs |
| 自己写脚本、Skill 或接入别的 Agent 时看这里。包括 schemaVersion。 | Use this when writing scripts, Skills, or another Agent integration. Includes schemaVersion. |
| 查看 Agent API 文档 | Open Agent API docs |
| 可以发给 Agent 了 | Ready to send to an Agent |

## Settings: Shortcuts

| Chinese intent | English copy |
|---|---|
| Shortcuts subtitle | Keyboard shortcuts |
| Navigation | Navigation |
| 打开命令面板 | Open command palette |
| 新建对话 | New conversation |
| 打开设置 | Open Settings |
| Composer | Composer |
| 发送消息 | Send message |
| 换行（不发送） | New line without sending |
| Conversation | Conversation |
| 跳到上 / 下一条提问 | Jump to previous / next question |
| 焦点在 Composer 时不生效（macOS 文本编辑原生快捷键保留） | Does not apply while Composer is focused; native text editing shortcuts are preserved. |
| 焦点在 Composer 时不生效（保留原生文本编辑快捷键） | Does not apply while Composer is focused; native text editing shortcuts are preserved. |
| Overlays | Overlays |
| 关闭当前浮层或退出编辑状态 | Close the current overlay or leave edit mode |
| 在命令面板 / 列表中上下选择 | Move through command palette and list items |
| 在命令面板中进入二级菜单 | Enter the command palette submenu |

## Settings: About

| Chinese intent | English copy |
|---|---|
| About title | Galley |
| About subtitle | Open-source local Agent workbench built on GenericAgent |
| Links | Links |
| 反馈建议 | Feedback |

## Onboarding

### Welcome

| Chinese intent | English copy |
|---|---|
| GenericAgent 的本地 agent team 编排器 | A local Agent team orchestrator for GenericAgent |
| 帮我安装 GenericAgent | Help me install GenericAgent |
| 敬请期待 | Coming later |
| 接入已经安装的 GenericAgent | Connect an existing GenericAgent |
| Galley 不会修改你的 GenericAgent。删除 Galley 后 GenericAgent 仍可独立运行。 | Galley will not modify your GenericAgent. If you remove Galley, GenericAgent can still run on its own. |

### Model Setup

| Chinese intent | English copy |
|---|---|
| 为 Galley 配置模型 | Set up a model for Galley |
| 填入你的模型 API Key 和 API 地址。 | Enter your model API Key and API URL. |
| 模型提供商 | Model provider |
| 模型密钥 | API Key |
| API 地址 | API URL |
| 模型 | Model |
| 自动获取模型列表 | Fetch model list |
| 选择检测到的模型 | Choose a detected model |
| 接入已有的 GenericAgent | Connect existing GenericAgent |
| 测试并开始使用 Galley | Test and start using Galley |
| 配置完成 | Setup complete |
| 找到 {count} 个模型 | Found {count} models |
| 连接成功，但没有返回模型列表 | Connected, but no model list was returned |

### External GA Attach

| Chinese intent | English copy |
|---|---|
| 接入已经安装的 GenericAgent | Connect an existing GenericAgent |
| 指向你本地的 GA 安装目录 · Galley 会用它启动 GA。 | Point Galley to your local GA folder. Galley will use it to start GA. |
| GA Path | GA Path |
| 选择 | Choose |
| 找到 GA 安装 · agentmain.py 可见 | Found GA installation · agentmain.py visible |
| 路径存在但未找到 agentmain.py — 确认这是 GA 安装目录？ | The path exists, but agentmain.py was not found. Is this the GA folder? |
| 路径不存在 | Path not found |
| 查看教程：下载 GA | Open guide: download GA |
| 查看教程：选对 GA 目录 | Open guide: choose the GA folder |
| 还没装 GenericAgent？前往安装 | Need GenericAgent? Open install page |
| 返回 | Back |
| 继续 | Continue |

### Health Check

| Chinese intent | English copy |
|---|---|
| 检查 GA 运行环境 | Check GA runtime |
| 全部通过后才能进入主界面 · Galley 不会修改你的 GA。 | All checks must pass before entering Galley. Galley will not modify your GA. |
| 跳过了 LLM 连接测试以节省费用。第一次发送消息时如有问题会提示具体错误并给出修复路径。 | LLM connection testing is skipped to avoid cost. If the first message fails, Galley will show the specific error and the next step. |
| 重新检查 | Re-run checks |
| 进入 Galley | Enter Galley |
| 返回设置 | Back to Settings |
| 取消 | Cancel |

Health Check rows:

| Chinese intent | English copy |
|---|---|
| GA 路径存在 | GA folder exists |
| agentmain.py 可见 | agentmain.py visible |
| mykey.py 存在 | mykey.py exists |
| memory/ 目录可见 | memory/ folder visible |
| assets/ 目录可见 | assets/ folder visible |
| Python 解释器 | Python interpreter |
| Galley 内置 Python | Galley bundled Python |
| 查找能加载 GA 的 Python | Find Python that can load GA |
| GA 入口模块 | GA entry module |
| LLM 配置文件 | LLM config file |
| L1-L4 记忆存储 | L1-L4 memory storage |
| GA 资源目录 | GA resources |
| CPython {version} · 已附带 GA 依赖 | CPython {version} · GA dependencies included |
| 在常见路径未找到能加载 GA 的 Python · 请先在 GA 目录把依赖装到一个 .venv 里 | No Python found that can load GA. Install GA dependencies into a .venv in the GA folder first. |

## Errors

| Chinese intent | English copy |
|---|---|
| 发送失败 | Send failed |
| 历史会话恢复超时 | Restoring the conversation timed out |
| Bridge 进程崩溃 | Bridge process crashed |
| Bridge 启动失败 | Bridge failed to start |
| LLM 配置可能有问题 | LLM configuration may be wrong |
| 首次发送失败，通常是 API key 或配置问题。 | The first send failed. This is usually an API key or configuration issue. |
| 检查 mykey.py | Check mykey.py |
| 查看 GA 文档 | Open GA docs |
| 查看技术详情 | Show technical details |
| 网络无法连接 | Network connection failed |
| 请求未能到达 LLM provider，可能是超时或 DNS 问题。 | The request could not reach the LLM provider. It may be a timeout or DNS issue. |
| API 配额耗尽 | API quota exhausted |
| 可切换其他 LLM 继续。 | Switch to another LLM to continue. |
| 重试 | Retry |
| 切换 LLM | Switch LLM |
| 内置 GA 模型不可用。请在 Models 添加模型，或重新输入 API Key。 | Bundled GA has no usable model. Add a model in Models or re-enter the API Key. |
| Galley 内置运行时不完整。请重新安装或更新 Galley。 | Galley's bundled runtime is incomplete. Reinstall or update Galley. |
| 接入的 GenericAgent 路径不可用。请到设置的 Runtime 页面重新选择 GA 目录。 | The connected GenericAgent folder is unavailable. Choose the GA folder again in Settings > Runtime. |
| 更新检查失败。 | Update check failed. |
| 暂时无法连接更新通道，请稍后重试。 | Could not reach the update channel. Try again later. |

## Toasts

| Chinese intent | English copy |
|---|---|
| 已移到 {projectName} | Moved to {projectName} |
| 已加入 {projectName} | Added to {projectName} |
| 查看项目 | View project |
| 已从 {projectName} 移除 | Removed from {projectName} |
| 已从项目移除 | Removed from project |
| 已切换到内置 GA | Switched to bundled GA |
| 已切换到外部 GA | Switched to external GA |
| 原来的对话已保留，可切回查看。 | Existing conversations are preserved; you can switch back to view them. |
| 已保存路径配置 | Path settings saved |
| 重启 Galley 才能让现有对话生效 | Restart Galley to apply this to existing conversations |
| 工具已重新注入 | Tools reinjected |
| 已为本 session 注入 {count} 条工具定义。 | Injected {count} tool definitions into this conversation. |
| 桌面宠物已启动 | Desktop Pet started |
| 宠物会实时显示本对话的进展。 | It will show this conversation's progress in real time. |
| 桌面宠物已关闭 | Desktop Pet closed |
| 已是最新版本。 | Galley is up to date. |
| 正在检查更新 | Checking for updates |
| 发现新版本，正在后台准备更新 | New version found. Preparing it in the background. |
| 新版本已下载，重启 Galley 生效 | New version downloaded. Restart Galley to apply it. |

## Project Dialogs And Archives

| Chinese intent | English copy |
|---|---|
| 新建项目 | New project |
| 名称 | Name |
| 项目名 | Project name |
| 关闭 | Close |
| 按标题或摘要过滤… | Filter by title or summary... |
| 永久删除所有归档 | Permanently delete all archived conversations |
| 恢复 | Restore |
| 永久删除 | Permanently delete |

## Copy Still Needing A Second Pass

These are intentionally not finalized in this draft:

- Long onboarding tutorial bodies in `onboarding-tutorials.ts`.
- Deep managed-model edge-case messages.
- Update-channel edge cases beyond the common statuses above.
- Developer-facing comments and logs.

Before implementation, run a string sweep and append any missed user-facing
copy to this draft instead of inventing English during coding.
