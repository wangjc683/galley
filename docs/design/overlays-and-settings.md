# Command Palette、Settings 与快捷键

> Galley 设计系统 · 原 DESIGN.md §8–§10（2026-07-04 拆分）：⌘K Command Palette、Settings modal 全部 tab、全局快捷键表。

## 8. Command Palette（⌘K Overlay）

### 触发与形态

- `⌘K` 开 / `Esc` 或点遮罩关
- **居中 overlay**（不贴顶；居中更聚焦，不遮 Top Bar 状态）
- 宽度 **560px**（不顶天立地）
- 高度自适应，max 420px（约 8 行结果），超出 scroll
- 背景 `surface-elevated` + `shadow-elevated` + 圆角 14px
- 触发后页面其余加 `surface-overlay` 遮罩，**无模糊**（模糊太花）

### 不加 ⌘P 别名

只 `⌘K`，少而精（VS Code/macOS `⌘P` 习惯不引入）。

### 内容范围（V0.1 收敛）

#### Session 类（主轴）

- 最近 8 个 session（按 `lastActiveAt` 倒序）
- 搜索：按 title 模糊匹配（V0.2 加 message 内容全文搜索）
- "New chat" 永远固定在第一项

#### Action 类（少而精）

- Switch LLM → 嵌套二级（展开当前 availableLLMs 列表）
- Re-run health check
- Open settings
- Attach GA folder（仅 onboarding 已完成、想换路径时）

#### 故意排除（V0.1 不做）

- 跨 session 全文搜索
- Theme switcher（V0.1 light-only）
- Quick prompt insertion（empty state 已经有）
- 任何 destructive action（删除 session 之类，Palette 不该让破坏太轻松）

### 视觉细节

- **Input row**：48px 高 / 17px Inter / placeholder italic muted "搜索 session 或输入命令…" / 左侧 16px Phosphor `MagnifyingGlass` thin / 右侧 `Esc` shortcut hint（13px muted）
- **Divider**：1px `border-default`
- **Result row**：36px 高 / 13px Inter / 左侧 16px Phosphor icon / 中间 label / 右侧 keyboard shortcut（如 `⌘N`）灰色 hint
- **Section header**（仅多组结果时）：11px Inter uppercase tracked `RECENT` / `ACTIONS` / `LLMS` —— 大多数情况下不显示 header（结果少时 header 是噪音）
- **Hover / 键盘选中态**：背景 `hover-tint`，左侧 2px charcoal 竖条
- **Empty state**：输入有内容但无匹配 → 中央一行 muted "没找到。Enter 直接发问？" + Enter shortcut（**做** —— 输入框里写的字 Enter 直接 new chat + 把它当第一句 prompt，是对"文档对话工作台"心智的延伸）

### 关键交互

- ↑↓ 选 / Enter 执行 / Tab 进二级（如 Switch LLM 子菜单）
- 输入"#"前缀强制只搜 session（V0.2 留）；输入">"前缀只搜 action（V0.2 留）
- **没有最近搜索历史持久化**（V0.1 简化）

### 排序规则

- Session 类按 lastActiveAt
- Action 类按内置优先级：New chat > Switch LLM > Re-run health check > Open settings > Attach GA folder
- Switch LLM 嵌套二级而不是平铺（避免 LLM 多时淹没 session）

---

## 9. Settings（modal overlay）

### 形态决策

当前实现是 **Radix Dialog modal overlay**，720 × 560px，左侧 tab list + 右侧内容区。独立 settings window 是历史方向，已从当前基准移出。

理由：

- Tauri 多窗口需要第二 React entry + WebviewWindow 生命周期，成本不应压过 v0.2 beta 的核心任务。
- 当前 settings 多数是即时保存的低频配置，modal 的短暂停留成本可接受。
- 用固定 overlay frame 先统一 Settings 内部信息架构，未来若升级为独立窗口，tab/content API 可以保留。

### 规格

- **720 × 560px / centered modal / `bg-overlay` scrim**
- 左侧 180px Tab list（垂直），右侧主内容区
- 右上角 28px close icon，Esc 可关闭
- 触发：主窗口 ⌘, / Sidebar runtime unconfigured / Command Palette "Open settings" / TopBar Gear
- 内容区 `px-8 py-7`，可滚动；Tab list 固定

### 语言与 Tabs

- 语言与外观自 2026-07-17 起住在 `General / 通用` tab（此前在左侧 tab
  list 底部的轻量菜单；General tab 落地后底部菜单移除，入口唯一）。
- 语言选项为 `Auto / 跟随系统`、`中文`、`English`；默认 `Auto / 跟随系统`。
- 首次启动没有保存偏好时，根据 OS / WebView language preference 推断：
  `zh-*` 显示中文，其余显示 English。不要根据 IP、地区或时区判断。
- 用户显式选择 `中文` 或 `English` 后持久化；之后不再跟随系统语言变化，
  除非用户切回 `Auto / 跟随系统`。
- 中文 UI 的左侧 tab 使用英文主标签 + 小号中文辅助标签；英文 UI 只显示
  英文标签。

```text
General          / 通用
Runtime          / 运行环境
Models           / 模型
Approval         / 审批
Agent            / 智能体接入
Channels         / 聊天软件
Browser Control  / 浏览器控制   （仅 managed 运行时显示）
Shortcuts        / 快捷键
About            / 关于
```

视觉上不要真的使用斜杠；主标签和辅助标签上下两行显示。辅助标签
只做注释，不与英文主标签同权重：英文约 14px medium，中文约 10.5px
normal muted，两行之间保留明确间距。即使 tab 处于 active 状态，中文也
不要抬到主标签权重。该双层标签只用于 Settings 左侧导航，正文不做大面积
双语。

### 当前 Tabs

#### General（2026-07-17 新增）

桌面应用自身的偏好，与引擎配置（Runtime）严格分家。整个 tab 只有一种行
语法 `PreferenceRow`：左侧标题 + 一行说明，右侧控件。

- **外观与语言**分区三行：主题 / 对话字号 / 语言，右侧都是
  `SegmentedControl` 三段平铺（与 topbar 主题控件同一交互）。选
  `跟随系统` 时说明行动态显示当前解析值（`跟随系统 · 当前深色`）。
- **启动**分区：`开机自动启动` 开关（默认关）。机制与静默启动细节见
  [desktop-runtime.md](../desktop-runtime.md) §Launch at Login；设计要点
  是**操作系统为唯一事实源**——开关状态实时读插件 `isEnabled()`，不在
  prefs 存副本，系统侧移除登录项不产生漂移。
- **通知**分区（2026-07-18 新增）两行开关：`任务结束时通知` /
  `等待审批时通知`（默认都开）。系统通知只在窗口非聚焦时发送——聚焦时
  应用内 toast 已覆盖，gating 全在 `gui/src/lib/notify.ts`（pref →
  节流 → isFocused → 权限 → send）。权限是独立于 pref 的第二层事实源：
  开关拨开时才请求权限，被拒**不回弹开关**，分区下方出提示行引导去
  系统设置；启动时从不主动弹权限框。审批通知按 session 5 秒节流，
  防 GA 并行工具连发刷屏。
- **应用行为**分区（2026-07-18 新增）两行开关：
  - `关闭窗口时保持后台运行`（默认开 = Background Mode 现状）。关闭后
    关窗走真退出（有任务运行时先弹确认框）。pref 语义存
    `keep_in_background_on_close`，Rust 侧 CloseRequested 回调读
    process-local atomic（setup 时从 pref 种入 + 开关切换时实时
    push）。首次关窗由应用内 FirstCloseDialog 询问并给这个 pref 赋值
    （2026-07-18 取代原生一次性提示框，机制见
    [desktop-runtime.md](../desktop-runtime.md) §Background Mode）；
    在 Settings 里显式拨过这个开关同样计为已选择，不再弹窗。
  - `自动下载更新`（默认开 = 现状）。关掉后启动静默检查照常、TopBar
    仍显示 available，只是不自动下载；手动下载永不受此开关限制。
- 与「启动」分区的事实源区分：自启开关 OS 为唯一事实源；通知与应用
  行为四个开关 pref（SQLite）为事实源，仅通知**权限**沿用 OS 事实源
  的提示模式。
- 主题与字号在 topbar 保留快捷入口（双入口：topbar 快捷调节，General
  权威清单）。**对话宽度（compact/wide）有意不进 General**：Settings 是
  遮住对话区的模态，切宽度看不到任何效果；它是视图控制，入口保持
  topbar + macOS 菜单栏。

#### Runtime

页面骨架是「Runtime Mode 主区 + 更多 低频组 + 底部版本行」三段，
内置内核是主推路径（产品站位见根 CLAUDE.md），外部 GA 是兼容模式，
入口整体降级进「更多」。

- **Runtime Mode**：内置内核卡（`推荐` badge；激活时 `正在使用`
  badge）。未配置模型时右侧 primary 按钮是「配置模型」，已配置未激活
  时是「切换到内置内核」。有运行中对话时切换禁用并显示原因。
- **更多**：一个 hairline 分行的带边框容器，三行共用一套行语法——
  整行可点，尾部字形区分行为：caret = 原地展开（手风琴），arrow =
  跳走（导航）。
  - **设置向导**：导航行，一行短说明（「重新走一遍首次设置，现有对话
    会保留」）；有任务运行时禁用，subtitle 换成禁用原因。
  - **接入外部 GA**：手风琴。外部 GA 激活时头部常驻 `正在使用`
    badge——状态可见性不依赖展开状态。展开内容依次是：状态 + 「切换
    到外部 GA」行（激活时整行不渲染，badge 已承担状态）、外部 GA 路
    径（mono 输入 + 文件夹选择器，输入可手打、Enter/blur 提交、
    debounce 校验，`not-found` 拒绝保存；改动后 toast 提示重启
    Galley 生效，不弹 confirm dialog）、Python（默认内置 CPython
    只读展示，「使用外部 Python…」ghost link 切到外部模式，路径由
    python-probe 决定、只读回显）、GenericAgent 版本（当前 / 已验证
    commit + 对齐 badge）、Health Check（说明 + accent-secondary sm
    按钮重跑）。
  - **高级诊断**：手风琴，仅内置内核激活时出现；key-value 只读行。
- **底部**：`border-line` 分隔后一行 mono `Galley v{x}`，纯文本事实行。
  更新的发现与安装由 TopBar 更新指示器承担，手动检查控件只保留在
  About（2026-07-18 收敛，此前 Runtime 底部也带更新控件）。

层级规则（这轮打磨的决策，后续改动不要破坏）：

- 展开区内部一律用 `SettingsFieldLabel`（12px、非 uppercase、无
  tracking），不复用页面级 `SettingsSectionLabel` 眉标——展开一个二级
  入口不允许再引入「一级章节」，否则层级塌平。
- 手风琴内部内容 borderless 平铺（key-value 行 / 纯文本行），不做
  卡片套卡片；输入框因交互需要保留边框，只读展示一律不带框。
- 嵌套内容的按钮不超过 `sm`；页面最重的按钮必须属于主区动作。
- 切换运行时的确认脉冲（`runtime-mode-highlight`）落在有边框的容器
  上：内置侧是 Runtime Mode 卡，外部侧是「更多」组容器（行头无边框、
  容器 `overflow-hidden` 会裁掉行级 shadow）。

#### Models

- Managed / bundled GA 的模型配置入口；attach mode 不读取这里。
- 支持添加多个模型：`OpenAI-compatible` / `Anthropic-compatible`、API Key、Base URL、模型名、可选显示名。
- Provider picker 中，`OpenAI` / `Anthropic` 保留品牌主标题；下拉项用低权重副标题说明“官方 API 或 compatible endpoint”，帮助用户理解第三方中转站 / 兼容接口也应该选择这两个入口。
- 页面分为主视图和维护区：
  - `我的模型` 是主视图，显示 Galley 当前会使用的模型队列、默认模型和排序。（早期文档名「当前配置模型」已演进为「我的模型」；维护区同期演进为「服务商」。）
  - `我的模型` 的标签行（标题 + `Info` tooltip + 模型数量）放在卡片外，和 `服务商` 的 section 标签同构——卡片只装列表，标签属于页面骨架；配置生效范围放在 `Info` tooltip。标签行下保留一行小字副标题（「按顺序排列，第一个为默认」）：这是「header 不放常驻说明文字」的**有意例外**——顺序 = 切换菜单顺序、第一个 = 默认是不可推断的核心语义，tooltip 藏不起。
  - 模型新增、编辑、排序或设为默认成功后，用短 toast 提醒：新对话立即使用最新配置；如果存在已启用 Channels，toast 带 `重启 Channels` CTA，直接重启已启用 Channel 进程，不要求重新登录。
  - `我的模型` 行 hover / focus 只做轻底色和排序箭头显性化，提示可操作但不做抬升、缩放或阴影；Provider 名称使用低权重 metadata chip，默认模型标签保留可见但不做重 Badge。
  - `服务商` 是维护区，标题右侧按钮只写 `添加`，accessible label 保留完整的 `添加模型提供商`；`添加` 按钮只在没有任何服务商时用 primary（此时它是当前唯一的下一步），已有配置后降为 secondary。Provider 摘要压成单行，长名称截断，不撑高卡片；协议类型放在模型数量之后，用低权重 metadata chip 显示，不使用明显边框或等宽字体，避免和 Provider 名称、模型数量抢层级。
  - Provider 卡的 hover 语法必须比主视图安静或同级：轻底色 + caret 显性化，不做抬升、阴影或品牌色 hover——主视图是这个 Tab 视觉上最重的表面，维护区不抢。
  - Provider 摘要行的正常状态不显示 Key 图标或 `Key 已保存`；只有缺少密钥 / 状态异常时才显示 warning badge。
  - 新增 Provider 表单贴着 `服务商` 标题区展开，位于 Provider 列表上方；新增表单不重复显示标题，Provider picker 不显示额外 label，placeholder 用 `选择提供商`，关闭按钮与 picker 同行，避免小区域反复出现“模型提供商”或形成空标题区；编辑已接入 Provider 时，编辑表单必须贴着对应 Provider 原地展开，不跳回页面上方。
  - 全 Tab 只有一种「正在内联编辑」的表面语法：brand 左边条（3px）+ `bg-elevated`，无阴影。Provider 编辑器和 Model 编辑器共用，不因入口不同改变视觉层级；嵌套表单的字段标签用 field 级标签（非 uppercase），页面级眉标不进入编辑器内部。
  - Provider / Model 的局部编辑表单关闭入口统一用右上角 `X` icon button；不要混用右上角文字「取消」。
  - Provider 展开后才显示模型维护操作；展开时自动读取一次模型列表（有 Key 且无缓存时；Codex 跳过；失败静默降级），`读取模型列表` 按钮保留为手动刷新入口，零模型 Provider 的卡片 header 不再重复放同名按钮。
  - 获取模型列表后的模型选择必须使用 Galley 自定义 popover dropdown，不使用浏览器原生 `select`。
  - `可添加模型` 列表里的模型行操作使用低权重 `+ 添加`；已加入配置的模型在同一位置显示 `✓ 已添加`，两者高度和占位保持一致，避免形成一列重按钮。
  - 编辑模型里可以折叠显示 `高级配置`，默认关闭。第一版只开放排障/适配项：`max_retries`、`read_timeout`、`stream`、OpenAI-compatible 的 `api_mode` / `reasoning_effort`，以及 Anthropic-compatible 的 `thinking_type`、`reasoning_effort`、`Claude Code 兼容透传`。`thinking_budget_tokens` 不开放，因此 `thinking_type` 暂不提供 `enabled`，避免用户选了实际会被 GA 忽略的配置。
- 新增 / 编辑 Provider 表单和 Onboarding 首次模型配置中，`提供商显示名称` 是可选身份字段，不放进折叠的 `更多`；它常驻在连接信息和模型字段之后、保存按钮之前，作为最后一步轻量命名。
- Provider 检查成功态使用低权重 inline 文本，不长期占用绿色块；失败态保留说明块并贴近对应 Provider。
- `我的模型` 行首用 radio 圆点承担默认模型：实心 = 默认，点击空心圆点一键设为默认（移到顶部）；标题旁保留轻量 `默认` badge。行右侧常驻控件收敛为 `↑ ↓ ⋯` 三个——测试 / 移除收进与服务商卡片同语法的 `⋯` 菜单，编辑 = 点击行本身，不再放冗余编辑图标（2026-07-17 改版，此前每行最多 6 个 hover 图标按钮）。
- API Key 字段只用于保存到本地加密凭据存储；列表正常态不展示凭据状态，只有缺少密钥 / 状态异常时显示提示，诊断可显示 `apiKeyRef` 对应状态但不显示密钥。
- Session 选中模型持久化必须用稳定身份：managed 用 `managed_models.id`，external 用 GA raw LLM name；`llm_index` 只能作为 bridge 命令和旧数据 fallback，不能作为长期身份。
- 第一版保留为 Settings 高级入口；first-run onboarding 会复用同一套能力，但不暴露高级参数。

#### Channels

- TopBar 中 Channels 位于状态簇最后，常驻但默认安静。`setup` / `not_connected` / `stopped` 显示 neutral icon-only `ChatCircleText`，作为可选扩展入口而不是待办；`running` 同样收敛为 icon-only。只有已经进入连接或需要处理时才升级为文字 badge：`starting` 显示 `Channels · 连接中`；`waiting_scan` 显示 `Channels · 扫码`；`expired` / `error` / load error 显示 `Channels · 需处理`。
- Channels 使用 managed model config revision 判断配置 freshness。模型配置变更后，已启用 Channel 若仍记录旧 revision，Settings -> Channels 卡片列表顶部显示 warning 状态条：标题 `Channels 正在使用旧模型配置` + 一行说明 + `重启 Channels` CTA。stale 信号只靠状态条传达，不再改按钮变体——反馈要引导行动，不是暗示。
- `重启 Channels` 语义是重启所有已启用 Channel；手动 Stop / Disconnect 会把 Channel 置为未启用，不会被这个按钮重新拉起。
- Models toast 里的 `重启 Channels` CTA 直接执行；Channels 页（状态条或底部按钮）先弹轻确认，说明可能中断当前回复、不会退出登录。
- 卡片下方的常驻 `重启 Channels` 按钮保持 ghost 权重，且只在存在已启用 Channel 且非 stale 时渲染——没有可重启对象时不占位，stale 时让位给状态条。
- 重启不删除微信 token，不主动要求重新扫码；token 过期仍走现有 expired / scan 流程。
- 飞书卡片与微信并列，但流程不是扫码：展开区提供开放平台步骤、App ID / App Secret 输入和启动按钮。App Secret 保存后不回显，留空表示沿用已保存凭据。使用者通过配对码绑定：服务启动后未绑定时展示配对码，首个在飞书私聊发送配对码的用户成为机器人唯一响应的使用者，可在卡片内解绑（早期「不做绑定码」的定位已被 owner-binding 实现取代）。
- Telegram 是第三张卡，凭据只有一个 Bot Token（来自 @BotFather），保存后
  不回显、留空沿用；设置指引用微信同款编号步骤列表（不需要飞书那种多段开
  放平台指引）。配对码绑定与飞书同一套交互和视觉（`OwnerBoundRow` /
  `BindCodeCallout` 共享组件）；与飞书的有意差异是换 Bot Token 不清除绑定
  （Telegram user id 全局，飞书 open_id 是应用作用域）。「保存凭证 / 启动
  服务」沿用 primary = 当前可执行下一步的互斥规则。不做代理配置 UI：默认
  Telegram 用户具备网络解决能力，错误 hint 提示网络可达性即可。
- 卡内层级规则（与 Runtime tab 同源）：
  - 每张卡同时至多一颗 primary 按钮，primary = 当前可执行的下一步。
    飞书的「保存凭证」和「启动服务」按此互斥：凭证未就绪时保存是
    primary、启动是 secondary，就绪后互换。
  - 卡内表单标签、错误块 / 配对码块的标题用 field 级标签（非
    uppercase、无 tracking），页面级眉标语法不进入卡内。
  - StatusBadge（带边框 + 语义色 + 图标的 chip）是有意比 Runtime tab
    的 badge 语法重一档的分叉：连接状态是 Channels 卡的核心信息，
    值得这个权重。不要把两处强行统一。
  - 四个确认弹窗（微信断开、飞书断开、飞书解绑、重启）共用一个
    shell（`ConfirmActionDialog`），取消键默认聚焦，回车不会误触
    执行。

#### Browser Control

从独立 setup dialog 迁移而来的 Tab（仅 managed 运行时显示，与 Channels 同
一 gating）。TopBar indicator 和 attention banner 都深链到这里；配置只有
这一个家（见 [layout-and-chrome](./layout-and-chrome.md) §4.1 Browser
Control Indicator）。

- **结构按验证状态二分**：未验证（`unknown` / `error`）显示设置指引卡；
  验证过（`connected` / `connected_no_tabs` / `offline`）显示状态卡 +
  卡下维护行，指引卡降级为「重新安装或修复插件」toggle 展开的修复卡。
- **设置指引卡**：浏览器选择（Chrome / Edge SegmentedControl）+ 三步编号
  步骤（打开扩展页并开开发者模式 → 定位 / 拖入 `tmwd_cdp_bridge` 文件夹
  → 测试连接）。步骤 3 内并排「打开测试页」（secondary）和「测试连接」
  （primary）+ 内嵌状态行。准备失败停留在步骤 2 并给重试；「遇到问题？」
  折叠区放加载已解压扩展的兜底说明和官方图文指南 ghost link。
- **动作锚定规则（本 Tab 的核心决策）**：推进状态的动作住在它作用的对象
  里——「测试连接」在步骤 3 内，「打开测试页 ×2 + 重新检测」在等待网页的
  状态卡内。卡下的裸按钮行只放维护动作（重新测试 ghost / 修复 toggle
  ghost / 右侧 demo accent-secondary）。dialog 时代的底部 action bar 语
  义不进 Settings 页：动作漂在卡外无锚定即是回归。
- **primary = 当前下一步**：未连接时全 Tab 唯一 primary 是「测试连接 /
  重新检测」；已连接后无 primary，一切收敛为安静维护。
- **浏览器选择有意存在两种语法**：状态卡里直给「打开 Chrome / Edge 测试
  页」两个按钮（快速路径，用户可能没进过指引、无浏览器选择上下文）；指
  引卡里用 SegmentedControl 驱动各步骤（引导路径）。不要强行统一。
- 已连接的状态卡降权为 `line-subtle` 安静信息行（✓ + `已连接浏览器` +
  `检测到 N 个可操作标签页`）；demo 按钮（`试用浏览器控制`）保留：连接
  测试本身不走模型，demo 由 managed GA 通过现有 `web_execute_js` /
  `tabs.create` 协议主动打开搜索页，不写回连接状态。

#### Approval（2026-07-20 修订：审批模式 per-session 化）

- **新会话默认**（原 YOLO toggle）—— Tab 顶部第一项，中性 bordered card
  （不再用 warning 色相——自动执行是产品默认态，不是警报态）：
  - 左侧标题「新会话默认」14px semibold + 一行 muted 说明「未单独设置的
    会话跟随此默认；每个会话可在输入框旁单独调整。」
  - 右侧共享 `SegmentedControl` 两段：「自动执行 / 逐步审批」（段名复用
    `copy.composer.approvalMode`，与 Composer pill 用词强一致）。
  - 逐步审批 → 自动执行触发 confirm modal（见下）；反向直接生效。
  - 会话级控件在 Composer 审批模式 pill（conversation.md §4.4）；改默认
    只影响未覆盖的会话，已覆盖会话钉住不动。
- **需要审批的工具**：复选列表（默认 `code_run` / `file_write` /
  `file_patch` / `start_long_term_update`），用户可勾选。**常显可编辑,
  不再因默认为自动执行而置灰**——规则作用于任何处于「逐步审批」的会话。
  区块上方一行 muted hint：「以下规则作用于「逐步审批」模式下的会话。」
- **白名单规则**：分两组显示
  - **Per-project** —— 列出 tool name + remove 按钮
  - **Global** —— 同上
  - 同样常显，不再 dimmed
- 改动后弹 toast "已应用到所有 session"（避免"太隐式"）
- 底部 muted hint："在审批弹窗里加入白名单后，规则会显示在这里。"

##### 自动执行默认 confirm modal

Radix Dialog，~480，组件 `AutoDefaultConfirmModal`。仅在本页把**新会话
默认**从逐步审批切为自动执行时出现——默认值的唯一编辑入口就是本页
（Composer pill 的 popover 只放「审批设置…」深链，不放默认控件，见
conversation.md §4.4）。Composer pill 的**会话级**切换不弹确认（会话级、
可逆）。
文案（中文）：

```
把新会话默认设为自动执行？

所有跟随默认的会话中，工具调用将不经审批直接执行——包括：

  · file_patch（修改文件）
  · file_write（写入文件）
  · code_run（执行命令）
  · 其他高风险操作

适合：完全信任 Agent + 在沙盒环境工作（个人 repo / 临时虚拟机）
不适合：生产代码 / 共享系统 / 不熟悉的 Agent / 敏感数据

每个会话仍可在输入框旁随时切换为逐步审批。

  [取消]  [是的，我知道在做什么]
```

视觉细节：

- 标题左侧用 Phosphor `Lightning` + 标题 Newsreader medium 18px
- 主体 13px Inter，bullet 列表用 mono `·` 锚点
- "是的，我知道在做什么" 按钮：深琥珀 `bg-warning` 背景 + 白色文字（不是品牌杏沙——视觉上要显眼但不像"OK"那种条件反射按钮）
- "取消"：ghost button 默认 focus，回车默认是取消（避免误触确认）
- ESC 关闭 = 取消

#### About（版权页 colophon，2026-07-03）

按文库本版权页的逻辑组织（[temperament.md](../temperament.md)：引文只住题词位与版权页），
隐喻沉在结构里——分区标签用人话（版式），不用行话（印次 / 奥付）：

- `Galley` wordmark + tagline（Newsreader medium 18px）
- Origin story（serif italic surface callout——GA 致意）
- 版本：Galley 版本（含更新控件）/ 内置 GA kernel commit + audit date
- 版式：一行陈述正文与等宽字体（Newsreader / 苹方 / 雅黑 / JetBrains Mono）
- 题词：PI §43（产品论题「意义即用法」）——译文 + 德文原句 + 出处行；
  不加框，与 origin 的 callout 卡片区分（页面上的引文，不是 UI 里的卡片）
- Links（Phosphor `ArrowSquareOut`）：GitHub / Feedback / GenericAgent 上游 / maker links
- Footer：`由 JC Wang 开发 · MIT License`

连带决策（2026-07-03 当日二审翻案）：曾把空状态题词收敛为仅 `silent`
渲染（稀缺性论证），owner dogfood 后**完全恢复**为每次空状态按条件渲染
——状态绑定轮换 + 每次驻留冻结本就是反墙纸机制，章节题词式的反复是正当
形式；理论担忧让位于一个月的实际体验。§43 与版权页双住所（不同寄存器）
接受。

#### Agent

- Copy Supervisor SOP：复制 Galley Agent SOP，不写入 GenericAgent memory。
- CLI install / path 指引：帮助可信 Agent 找到 `galley` CLI。
- Agent API reference：链接到 `docs/agent-api.md`，强调 `schemaVersion: 1`。

#### Shortcuts（read-only）

- 三个 group：Navigation / Composer / Overlays。
- 每行：左侧 kbd chip（`bg-surface` + `border-line` + mono）+ action label + 可选 note。
- 当前只展示，不提供自定义；重绑入口留到未来版本。

### 视觉

- **Tab list**：每项 32px 高 / 13px Inter / 左侧 16px Phosphor icon
  - General: `Gear`
  - Runtime: `Cpu`
  - Approval: `ShieldCheck`
  - Agent: `PlugsConnected`
  - Shortcuts: `Keyboard`
  - About: `Info`
- 选中态：`hover-tint` 背景 + 左侧 2px charcoal 竖条
- **主内容区**：内边距 32px / 标题 18px Newsreader medium / 描述 13px Inter muted / 控件之间 24px 垂直间距
- **Form 控件**：路径 input + 文件夹选择器按钮（Phosphor `FolderOpen`）/ 复选框跟 Approval Dock 同款 / Button 体系跟主界面一致
- **没有 sticky save button**：所有改动**即时生效 + 自动持久化**（违反"不要让用户思考"），破坏性改动单独 confirm dialog

### 推到未来版本的 Tab

- ~~**General / Preferences**~~ —— 2026-07-17 已落地（外观 / 字号 / 语言 / 开机自启，见上「当前 Tabs → General」）；telemetry 等更多全局偏好仍待未来按需加入。
- **LLM**（custom displayName / default index）—— per-app preference 已够，custom name V0.2
- **Data**（SQLite 位置 / export / clear history）—— V0.1 不做高危数据 UI
- **Developer**（Logs / IPC trace）—— V0.1 用 stderr 调试

---

## 10. 全局快捷键

| 键位 | 动作 |
|---|---|
| `⌘K` | 命令面板 |
| `⌘N` | 新对话 |
| `⌘ + ,` | 打开设置 |
| `Esc` | 关闭浮层 / 退出编辑状态 |
| `Enter` | 输入框发送 / 命令面板执行 |
| `Shift + Enter` | 输入框换行 |
| `↑ / ↓` | 命令面板选项 |
| `Tab` | 命令面板进二级 |
| `⌥↑ / ⌥↓` | 跳到对话中上 / 下一条用户提问（焦点在 Composer 时不生效） |
