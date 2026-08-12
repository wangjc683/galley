# Onboarding 与卡片家族

> Galley 设计系统 · 原 DESIGN.md §5–§6（2026-07-04 拆分）：Onboarding 流程、Attach / Health Check、Error Card、overlay 层级、首次失败 hint 系统。

## 5. 流程：Onboarding

默认路径是 managed / bundled GA：用户只需要配置模型，不需要理解 GA
checkout、Python、venv、`mykey.py` 或依赖安装。Attach 已有 GA 是次级入口。

顶部左侧显示当前流程进度；顶部右侧常驻低权重语言菜单（Translate icon + 当前
语言短标签），让首次用户不用进入 Settings 就能切换 `跟随系统 / 中文 / English`。
从 Settings 进入时，`返回设置` 或 `取消` 与语言菜单并排显示。

### Step 1 — 配置模型

设计原则（2026-07-17 打磨轮）：把"用户必须手动做的事"压到最少——理想路径
是选渠道 + 粘贴 Key 两步，其余（模型名、API 地址、连接验证）由预设与自动
探测承担。

- 标题：`Galley`；副标题一句衬线体欢迎语（`配置好模型就能开始，大约一分钟。`）
- 渠道选择：**平铺卡片网格**（2 列，全部预设渠道一屏可见），每张卡 = 渠道名
  + 一句描述；选中态高亮，radiogroup 语义。不用下拉——首个决策的成本是
  一次点击而不是「展开 → 扫描 → 选择」。（Settings 端保留紧凑 popover picker。）
- 字段：`API Key`（label 右侧带 `获取 API Key ↗` 跳转链接，仅当 API 地址
  仍指向该预设官方地址时显示，自定义 / 代理端点不误导）、`模型`（预设
  直接预填推荐模型为值，不是灰色 placeholder）；`API 地址` 与
  `提供商显示名称` 收进 `高级` 折叠。
- 模型列表：Key + 地址齐全后 **800ms 防抖静默自动拉取**；成功显示统一样式
  的模型选择 dropdown，模型框为空时自动选中推荐模型；失败静默降级为手输。
  `读取模型列表` 按钮保留为显式刷新路径。
- ChatGPT / Codex 渠道走设备码登录：点击 `打开登录页面` 后**自动开始轮询**，
  浏览器授权完成即自动进入下一步；`完成登录` 按钮保留为超时 / 出错后的重试。
- 模型信息填写完整后自动测试连接：停止输入约 800ms 后发送最小开销真实模型请求；成功显示延迟，失败保留 HTTP code，并用人话解释 401 / 403 / 404 / 429 / 网络 / 超时等常见原因。
- 失败态提供低权重 `重新测试`，但不把测试作为主流程按钮。
- 主 CTA：`开始使用 Galley`；只有当前 API Key / Base URL / 模型组合测试成功后可点。
- 底部左侧低权重 text link：`接入已有 GenericAgent`，进入 attach flow。它与右侧
  action row 同一基线，但视觉权重必须低于主 CTA。
- 成功后进入 Empty state composer，并 focus 输入框。

### Attach Step — Existing GenericAgent

- 路径输入框（mono / 初始为空 / placeholder 示例 `~/Documents/GenericAgent` / 可改）
- 文件夹选择器按钮（Phosphor `FolderOpen`）
- **实时反馈**（路径变化时立刻校验）：
  - 路径不存在 → 深红 X icon + "路径不存在"
  - 路径存在但找不到 `agentmain.py` → 深琥珀 Warning + "未在此路径找到 agentmain.py，确认这是 GA 安装目录？"
  - 路径合法 → 杏沙 Check + "找到 GA 安装"
- 主 CTA `继续`（路径合法时启用）
- 弱链接 muted 文案："还没装 GenericAgent？→ 在这里安装"（外链 GA GitHub）

### Attach Health Check

跑 5 项检查，**全过才能继续**：

1. 路径存在
2. Python 可用（默认 system Python，可在 Settings 改 BRIDGE_PYTHON）
3. `agentmain.py` 可 import
4. `mykey.py` 存在
5. 至少一个 LLM 配置可解析

**故意决策**：跳过 LLM session dry-run（dry-run 真发 API 请求会消耗 quota）。第一次发 message 时如有问题再报错（详见 §7 Error Card 的首次失败引导）。

UI：嵌入 Health Check Card（详见 §6.1），失败项必须 fix 才能继续，**不允许"以只读模式进入"**（Galley 没 LLM 什么都做不了）。

### 进入主界面

本质是"Onboarding 消失"。用户被带到主界面，看到 Empty state hero composer。

### Settings 里的再次进入

Settings → Runtime → More 提供低调入口 `打开设置向导...`。它复用同一套
Onboarding，从第一屏开始，不清空历史、不删除对话、不重置数据库。打开入口本身
没有副作用；只有用户在步骤里主动修改 Runtime / 模型 / GA 路径并完成，才改变
设置。

有 Agent task 正在运行时，该入口禁用。原因是设置向导可能切换 Runtime 或模型，
不应该在长任务中途改变运行时语义。

从 Settings 进入时，Onboarding 顶部进度条右侧保留低权重 `返回设置` / `取消`
出口，贯穿模型、GA 路径、Health Check 步骤；首次安装路径不显示这个出口。
底部 action row 只放当前步骤动作，不混入全局退出。

---

## 6. 卡片家族（Health Check / Error）

两个 card 共享同一个视觉骨架：

- `surface-elevated` 背景 + 1px `border-default` + `shadow-card`
- 圆角 12px / 内边距 16px
- 左侧 16px Phosphor thin icon + severity 色

### 6.1 Health Check Card

#### 5 个出场场合

1. Onboarding Step 2
2. Settings → Runtime "Re-run health check"
3. Sidebar runtime dot 处于 `GA 未配置` 时，引导进入 Settings → Runtime
4. 系统检测 GA 异常时主动弹
5. Onboarding 后的后台复检失败 toast（候选）

#### 视觉

- 标题："Health Check" + 总状态 pill（All passed / N failed）
- 5 项目列表，每项一行：
  - 16px Phosphor thin icon + 状态色：
    - pending: muted dot
    - running: `CircleNotch` 杏沙旋转
    - success: `Check` muted 灰
    - failed: `X` 深红
    - warning: `Warning` 深琥珀
    - blocked: `Pause` muted
  - 13px Inter / 项目名
  - 失败项 expand 显示错误简要 + inline action button："打开 GA 安装指南" / "选择其他路径" / "View details"
- 底部："All checks passed" 或 "Fix N issue(s) to continue"

#### 行为差异

- onboarding：失败必须 fix（阻断）
- 其他场合：允许查看 unhealthy，但 Sidebar runtime indicator 显示 unhealthy / unconfigured

### 6.2 Error Card

#### 三种 severity

| Severity | icon | 色 | token |
|---|---|---|---|
| error | `X` | 深红 `#B14545` | `error` |
| warning | `Warning` | 深琥珀 `#BF7A1F` | `warning` |
| info | `Info` | muted 灰蓝 `#7A7A8E` | `info` |

#### 三种出场场合

| Category | 场合 | 形态 |
|---|---|---|
| `runtime` | Tool 执行失败 / LLM 调用失败 / agent 报错 | **Conversation 流内 inline message bubble**（紧跟出错 tool 之后，Tool callout 行保持失败状态） |
| `bridge` | bridge crash / IPC 协议 mismatch | **Top-level toast**（5s auto-dismiss 或手动叉） |
| `business` | Attach 路径非法 / 历史恢复失败 / SQLite 损坏 | **Top-level toast** |

Inline 类**不可 dismiss**（属于对话历史）；toast 类可手动 dismiss。

**自动消失的倒计时会暂停**（2026-08-12）：鼠标悬停在 toast 上、或焦点落在
toast 内部（动作按钮可 Tab 到）时，计时停住；离开后从**剩余时间**继续，且
保证至少再显示 `TOAST_RESUME_FLOOR_MS = 800ms`——否则一个只剩 40ms 的 toast
会在指针刚移开的瞬间消失，读起来像「toast 在躲鼠标」，而且把动作按钮一起带走。
这条对 Galley 是必需而非打磨：toast 带 `重启 Channels` / `查看项目` /
`查看 Goal` / `重启更新` 这类 CTA，鼠标伸过去的路上消失会点空。下限不会超过
toast 自己的总时长（调用方要 300ms 就是 300ms）。计时规则是纯函数
`lib/toast-timing.ts`，可单测。

#### Overlay 层级

- 普通 modal / Settings 使用 `z-50`：当前主任务面板。
- 二级阻断确认使用 `z-60`：删除确认、危险确认等必须压过父 modal。
- 当前 modal 内的 menu / popover 使用 `z-70`，tooltip 使用 `z-80`。
- Top-level toast 使用 `z-[90]`：系统反馈层，高于 Settings 等普通 modal。Toast container 保持 `pointer-events-none`，只有 toast 本体可交互，避免遮住 modal 的周边操作面。

#### 标准展示

- 标题（14px Inter medium）+ 一行简要（13px muted）
- 主 action button（杏沙轮廓 ghost / 28px / Phosphor icon + label）
- 可折叠 details panel（点 `CaretDown` 展开）：
  - stack trace / 完整 error message / source 字段
  - 等宽 12px JetBrains Mono
  - 给 power user 看的，普通用户不需要看

#### 重试语义

- bridge **不主动 retry**
- desktop 根据 IPC 字段 `retryable=true` 显示 Retry button
- 点击 Retry = 触发新的 send_message（参数复用上次），不是隐藏副作用

#### 首次 message 失败的友好引导（hint 系统）

bridge 端检测错误类型，emit 时附 `hint` 字段，desktop 渲染专用引导卡片：

| hint | 触发条件 | 卡片内容 |
|---|---|---|
| `check_llm_config` | 401/403/`api_key`/`unauthorized` keyword | 标题 "LLM 配置可能有问题" / 一行 "首次发送失败，通常是 API key 或配置问题" / Actions: "检查 mykey.py" / "查看 GA 文档" / "View raw error" |
| `network` | 网络超时 / DNS 失败 | 标题 "网络无法连接" / Actions: "Retry" / "View raw error" |
| `quota_exceeded` | 429 / quota keyword | 标题 "API 配额耗尽" / 一行 "可切换其他 LLM 继续" / Actions: "Switch LLM" (打开 Composer LLM dropdown) / "View raw error" |
| （无 hint） | 其他错误 | 标准 Error Card |

**为什么不直接显示 "401 Unauthorized"**：普通用户看到原始错误不知道下一步。"哪里出错 → 怎么解决"的翻译是 Galley 比裸跑 GA 增值的关键点。
