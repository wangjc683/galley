# 整体布局与窗口 Chrome

> Galley 设计系统 · 原 DESIGN.md §3–§4.2（2026-07-04 拆分）：两栏布局、SidebarHeader / MainHeader、YOLO / Browser Control indicator、Sidebar 结构、Session Row、Project 行。

## 3. 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│ Top Bar（44px）— traffic light reserve · Title menu · actions │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  Sidebar     │   Conversation + Tool Timeline               │
│  14–30%      │                                              │
│  resizable   │   ┌──────────────────────────────────────┐   │
│              │   │ Approval Dock（sticky, pending only） │   │
│              │   ├──────────────────────────────────────┤   │
│              │   │ Composer                             │   │
│              │   └──────────────────────────────────────┘   │
└──────────────┴──────────────────────────────────────────────┘
```

- 两栏布局：Sidebar / Main，整体 minimum window width 960px，minimum height 600px。
- Sidebar 用 `react-resizable-panels`，默认 20%，约束 14–30%；宽度持久化到 localStorage。
- Sidebar **不可折叠**。多 session 是 Galley 的核心产品形态，隐藏 Sidebar 等于隐藏差异化；需要更少 chrome 时通过拖拽缩到 14%。
- 右侧 Inspector 已退役。详情分散到各自最相关的上下文：Tool callout inline 展示工具细节，Approval Dock/Approval Card 处理审批，Runtime/Approval metadata 进入 Settings。
- 主区只有 Conversation column；阅读宽度由 TopBar 的 compact / wide toggle 控制，而不是靠右侧面板挤压。

---

## 4. 组件 Spec

### 4.1 列头（SidebarHeader + MainHeader）

**不存在全宽 top bar。** 两栏各自在 panel 内部长出自己的 header，均 **44px 高**、底边对齐成顶部一条连续 chrome，被全高 `ResizeSeparator` 分隔；两栏两色（Sidebar `bg-chrome` 暗 / Main `bg-app` 亮）。根因：全宽 bar 与下方两栏结构错配——session title 语义属于「当前对话」（Main），全宽 bar 里左对齐会落到 Sidebar 上方、长标题还横跨分割线；在 bar 内按 sidebar 宽度切两段又得追可拖拽 + 持久化的宽度（脆弱）。让每栏各管自己的 header，宽度天然继承、分割线天然全高，两平台的 OS 窗口控制也各自落回本属的那一栏。

两个 header 都带 `data-tauri-drag-region`，共同作为窗口拖动 handle（Tauri v2 需 `core:window:allow-start-dragging` 权限，buttons 自动豁免）；非 mac 双击 header 空白处切最大化（`isWindowActionTarget` 判定），mac 由 overlay 接管。

**SidebarHeader（Sidebar 栏顶，y=0）**
- `Galley` 字标（左）+ runtime / Supervisor SOP 状态指示（右），单行。
- macOS：traffic light 浮于窗口左上 = 本 header 左上，故左 padding 让出 **~78px**（红绿灯簇右缘约 68px + ~10px 间隙）。**不要**退回贴近 flush 70px，否则字标与红绿灯糊成一团。非 mac 用 16px 常规 gutter。
- narrow（最小窗 960 × 14% sidebar ≈ 134px）：~78px reserve 吃掉大半，字标保留、runtime 指示靠 `truncate` / `max-w` 优雅截断。

**MainHeader（Main 栏顶）** —— `[ 标题 ▾  ··· drag ···  状态簇 │ 工具簇 │ (Win 窗口控制) ]`
- session title 左对齐贴 main 栏左 gutter（**不对齐居中的对话列**——对话列宽随 compact/wide 变，对齐它会让标题左右跳）。title 属于「当前对话」，放在对话区上方、视线最先到达处。本栏左侧无 OS chrome 保留区。
- **Session title menu**：有 active session 时 title + `CaretDown` 是一个按钮，打开 session-scoped 菜单（Rename / Reinject Tools / Desktop Pet）。空状态渲染 italic muted "新对话"，不可点。Rename 进入 inline edit（Enter 提交 / Esc 取消）。
- 右：两个清晰 group，最后才是 Windows window controls（不属于工具簇）：
  - **状态簇**（aria label：`运行状态`）：YOLO（条件渲染）→ Goal（条件渲染）→ Browser Control → Channels。
  - **工具簇**（aria label：`视图与设置`）：conversation width toggle（compact / wide）→ Appearance icon-only menu → Settings 入口（Phosphor `Gear` thin，中文 UI tooltip "设置 · ⌘ + ,"）。
  - 两组之间用 1px 竖向分隔线；没有任何状态项时不显示状态簇和分隔线。
- Windows window controls（min / max-restore / close）贴 MainHeader 最右端 = 窗口右上；macOS 不渲染（由左上 overlay traffic light 接管窗口控制）。

**两 header 共通视觉规约**
- 状态控件统一视觉语法：文字 badge 统一 28px 高度、6px 圆角、12px 字号、border / hover / press 节奏；icon-only 状态统一 28px 方形按钮、Radix tooltip，且不显示浏览器默认 focus outline。`warning` / `error` / `success` / `neutral` 只表达状态，不给某个功能单独造身份视觉。
- Topbar 内会打开 menu / popover 的 trigger，打开态需要保留轻微下沉 + press shadow，帮助用户把浮层和来源按钮对应起来；YOLO 因为是风险态，可额外升为实心 warning，其它常规工具只做温和 opened 态。
- icon-only controls 必须使用项目统一的 Radix tooltip（`TooltipLabel` / `IconButton` tooltip），不使用原生 `title` 作为 hover 提示（延迟 / 样式 / 出现时机不可控，会让相邻按钮反馈节奏不一致）；可访问名称用 `aria-label` 保留。
- **不放 Command Palette 按钮**：Sidebar 已有 Search quick action，`⌘K` 全局可用；重复 click affordance 只增加 chrome 噪音。
- **不放 Sidebar toggle**：Sidebar 当前不可折叠，只可拖拽调整宽度。
- **不显示**：runtime 详情（留在 SidebarHeader 指示，不进入 MainHeader）/ Stop（在 Composer Submit 位置）/ Context Window / 价格。

> 命名注记：组件文件为 `MainHeader.tsx`；其内部 helper（`TopBarStatusCluster` 等）与 i18n 命名空间 `copy.topbar` 保留历史名，仅为限制 churn，不代表仍存在全宽 top bar。下文 YOLO / Browser Control / Channels indicator 小节中的「TopBar」措辞即指 MainHeader 状态簇。

#### YOLO Indicator（条件渲染，PRD §11.5）

YOLO mode 开启时在右侧状态簇最前渲染 persistent badge：

```
[ YOLO ]
```

- 视觉：使用统一 TopBar 状态 badge，`warning` tone；TopBar 折叠态不使用 Phosphor `Lightning`，也不建立 YOLO 专属视觉体系。
- Hover 时 badge 可升为实心 warning + 轻微上浮；popover open 时保持实心 warning，
  但改为轻微下沉 + press shadow，表达“当前浮层归属于此按钮”。
- 内容："YOLO" 12px Inter medium 大写
- 不闪烁、不脉动——视觉警示靠颜色对比，动效会让用户疲劳后忽略
- 永远可见（不 hover 显示），这是核心承诺
- **点击行为**：弹 popover（Radix Popover，宽 280px，14px padding）
  - Header：Phosphor `Lightning` thin 16px + 标题 13px Inter medium："YOLO 模式已开启"
  - 一行 12px muted："所有工具调用跳过审批直接执行"
  - 一个深琥珀 button："立即关闭"——点击直接关 + 关闭 popover + indicator 消失
  - secondary link "在设置中查看 →"（打开 Settings → Approval tab）
- **未开启时不渲染**——这个位置完全空（不留占位），TopBar 视觉跟现在一致

设计判断：YOLO 需要可扫视，但不能破坏 Galley 的安静风格。风险由 `warning` tone 表达；折叠态不要用图标、闪烁或专属色系把它做成单独品牌。Popover 是展开后的风险说明面板，可以使用 Lightning 强化语义。

#### Browser Control Indicator

Browser Control 是 managed GA 的核心能力完成项，位于状态簇的 Goal 后、Channels 前。未连接时，TopBar 必须常驻：

```text
[ 浏览器控制 · 待连接 ]
```

- 视觉：使用统一 TopBar 状态 badge；`not_connected` 用 `warning`，`unknown` 用 `neutral`，`error` 用 `error`。
- `connected` / `connected_no_tabs` / `offline` 收敛为安静的 icon-only button：`PuzzlePiece` thin icon，tooltip 展示具体状态，无状态点、无文字、无 warning 底色。
- 未连接时不允许隐藏、不允许 dismiss。禁止闪烁、抖动、红色警报或反复弹窗抢焦点。
- 每次启动如果未连接，可以自动打开一次 Browser Control setup dialog；用户关闭后本次启动不再自动弹，但 TopBar 继续强提醒。
- 点击 indicator 打开 Browser Control setup dialog，不跳 Settings。
- setup dialog 使用 Radix Dialog，信息量保持短：未连接时先展示准备 `tmwd_cdp_bridge` 文件夹和配置；只有准备成功后，才展示打开 Chrome / Edge 扩展页、把 `tmwd_cdp_bridge` 文件夹拖到扩展页（拖拽无效时再点"加载已解压的扩展程序"选择该文件夹）、测试连接。若准备失败，停留在第一步并提供重试；第 3 步可放一个轻量 `图文指南` ghost link 指向官方教程的 Chrome 安装步骤锚点，作为带图救急入口，不进入底部 action row，避免先看到原生 GA 的前置条件和 `GenericAgent\assets` 路径；已连接时，连接证据降权为安静信息行（`已连接浏览器` + `检测到 N 个可操作标签页`），维护动作收敛到底部左侧（`重新测试`、`重新加载插件`），右侧保留 demo。
- 成功后提供轻量 demo 按钮 `试用浏览器控制`，作为新手理解真实浏览器控制的入口；连接测试本身不走模型，demo 由 managed GA 通过现有 `web_execute_js` / `tabs.create` 协议主动打开搜索页，不依赖 `window.open`，也不写回 Browser Control 连接状态。

### 4.2 Sidebar

#### 结构（自上而下）

```
┌──────────────────────────────────┐
│ Galley                    ● GA 就绪 │  product name + runtime dot
├──────────────────────────────────┤
│ + 新对话                   ⌘N    │  Quick action
│ 搜索                       ⌘K    │  打开 Command Palette
│ 项目                       [+]    │  进入/退出 Project Review；+ 新建项目
│                                  │
│ ACTIVE PROJECTS                  │  Project Review: 点击项目行展开/收起
│   FolderOpen Galley        +     │  行点击展开/收起；+ 新建项目对话
│     ◐ Session A                  │
│   FolderOpen Website       +     │
│     + 新建项目对话               │  空项目 CTA，点击新建到该项目
│ OLDER PROJECTS              12   │  默认折叠；点击展开 7 天前项目
├──────────────────────────────────┤
│ PINNED                           │  仅有 pin session 时显示
│   ◐ Session A                    │
├──────────────────────────────────┤
│ TODAY                            │
│   ◐ Session 1                    │
│   ◐ Session 2                    │
│ THIS WEEK                        │
│ EARLIER                          │  单行 "查看全部 N"，打开 EarlierDialog
├──────────────────────────────────┤
│ Archived                   N     │  底部
└──────────────────────────────────┘
```

#### 关键决策

- **单行 Header**：`Galley` product name + runtime dot 同行。产品名使用 sentence case，不使用全大写 wordmark，避免读成 acronym。`GA 就绪` 只是状态；`GA 未配置` 才可点并进入 Settings → Runtime。
- **Quick Actions 靠顶部**：New Chat / Search / Project Review 是最高频入口。Project Review 入口在同一组里，避免旧方案里「PROJECTS 标题行」和项目 row 叠在一起。右侧轻量 `+` 只负责新建项目；创建后进入 Project Review 并展开新项目。
- **普通 sidebar 不再显示项目列表**：普通视图只保留时间线，减少重复层级；需要看项目时显式进入 Project Review。
- **Project row 不用 emoji**：用 Phosphor `Folder` / `FolderOpen` 表达层级与 filter，避免跨平台 emoji 造成的视觉重量和渲染差异。
- **Project Review 由 Quick Action `项目` 切换**：开启后隐藏普通 timeline，展示完整 project list；项目 row 只负责展开/收起，允许多项目同时展开；再次点击 `项目` 退出 Project Review。入口用 selected tint 表示开启状态，不额外加说明文案；active 时 tooltip / aria-label 为「退出项目视图」。
- **Project Review 进出动效**：模式切换不是硬替换。进入时 Project Review 从 0 高度轻展开并 fade in，普通 timeline 下沉 fade out；退出时 Project Review 保留约 150ms 完成上收 fade out，普通 timeline 从下方回到原位。项目内部 drawer 继续使用独立展开动画，避免两层动效互相抢戏。
- **Project Review 按活跃度分组**：pinned 或 7 天内有非归档 session 活动的项目进入 `ACTIVE PROJECTS`；其余进入 `OLDER PROJECTS`，默认折叠。新建但 7 天内为空的项目视作 active，避免刚建完就被藏起来。
- **项目对话创建是独立动作**：项目 row 右侧轻量 `+` 和空项目 CTA `+ 新建项目对话` 才会把右侧切到 project-aware EmptyState（placeholder: `在 {Project} 里交代什么？`，第一句话 lazily create 到该 project）。展开/收起项目不改变右侧当前对话。
- **去掉 ACTIVE / WAITING FOR YOU 区块**：普通 timeline 不做状态队列，也不按 failed / waiting / running / unread 重排；状态只在 row 内用 rail / icon / subline / tint 表达，Approval Dock 兜底审批处理。
- **去掉 "UNFILED" 命名**：通用 Agent 工作台 80%+ 对话本就 free-floating，时间分组就是主体
- **PINNED section** 仅在有 pin session 时显示，空时不占位
- **时间桶 header 显示总数**：`PINNED 3` / `今天 5` / `本周 8` / `更早 24 ›`。数字只表示桶内 session 总数，不拆 running / waiting / failed 分项。
- **EARLIER 折叠成单行入口**：sidebar 是当前工作面，不是无限历史列表；完整旧 session 浏览进入 `EarlierDialog`。Earlier 入口沿用同一 header + count 视觉族，只多一个 caret 表达可打开。
- **Archived 不叫 Trash**：archive 是保留数据；真正永久删除只在 Archived dialog 里出现。
- Sidebar 不可折叠；可拖拽调整宽度。`⌘K` 全局 Command Palette。对象级低频操作由右键菜单和 row hover / focus `⋯` 共同承载：session row 提供 rename / pin / move to project / archive，project row 提供 pin / edit / delete。右键是熟练用户快捷入口，`⋯` 是可发现入口；两者必须共享同一组动作、排序和 destructive 样式。row contextual actions 和 attention dot 都使用 overlay，不在非 hover 状态制造额外右侧 gutter；hover / focus / menu open 时文字临时让位给操作按钮。
- WebView 默认右键菜单在非编辑区禁用，避免空白处出现 `Reload / Inspect Element`。输入框、textarea、contenteditable、`role="textbox"` 等可编辑区域保留系统编辑菜单。

#### Session Row（参考 PRD §7.5）

Sidebar 的设计目标是一块**可一眼扫描的多 session 状态板**：很多 session 同时跑时，扫一眼左列就能 triage 每个 session 的处境——还在跑 / 等你回复 / 等审批 / 出错 / 完成未读 / 闲置。外围 liveness 在这里是被**加强**的，不是被削弱的（对照 §2.7：A/B 原则在外围监控面是例外，环境 liveness 有价值）。

状态由三条独立信号承载，不互相覆盖：**左侧 status spine（rail + icon）→ 状态行文案 → 标题字重**。

##### 1. 左侧 status spine（rail）

左缘一条 3px 连续状态通道，是整列最先被扫到的信号：

- **running**：brand `bg-brand-strong` **呼吸**（`sidebar-liveness-rail` 底 + `sidebar-liveness-tick` 每步跳动）。**只有 running 会动**——动 = 仍在推进。
- **ask_user / approval**：`bg-warning` 静态。
- **error**：`bg-error` 静态。
- **completed / idle**：无 rail。

motion 语义专属于 running：静态彩条表示「卡在这、需要你」，呼吸表示「正在前进」，无条表示「无事发生」。rail 不表达百分比，不得从左到右推进成 progress bar。running row 另叠轻量 `bg-brand-soft/60` 底 tint；ask_user / approval 使用极轻 warning tint，error 使用极轻 error tint，强化可扫性但不改变时间线排序。

##### 2. 左侧 status icon（兼承未读）

行最左 14px Phosphor 图标，颜色随状态（见 `status-icon.tsx` `STATUS_MAP`）：

- idle `Circle` muted / connecting `CircleNotch` 旋转 / running `CircleNotch` **bold** 杏沙旋转 / ask_user `PauseCircle` 深琥珀 / error `XCircle` 深红 / cancelled `Prohibit` muted（区别于 error：用户主动）/ completed `CheckCircle` 杏沙 / archived `Archive` muted。
- **未读并入左图标，不再用右侧独立点**。旧方案的右侧静点在 hover 时会被 `⋯` 菜单顶替而消失，体验割裂；现在「完成未读」= 把左侧那个本就存在的图标渲染成 `weight="fill"` + `text-brand`（空心环→实心点），无需新增元素。
- **光学权重而非几何直径对齐**：plain `Circle` 是整列唯一的实心盘 / 空心环，按视觉重量调尺寸——实心未读点 `size*0.7`（≈10px，填充墨量重），空心 idle 环 `size*0.78`（≈11px），让环略大于点但两者视觉重量相当；idle（最低优先级）也因此是整列最安静的标记。其它有内部结构的图标（spinner / check / pause / x）保持 14px。
- 未读优先级低于进行中状态：`showUnread` 仅在 settled（非 active、非 running、非 ask_user、非 approval、非 error）时为真。

##### 3. 状态行文案（subline = 状态行）

第二行直接当状态行用，始终状态着色、**直立不斜体**，blocking 状态给显式文案，扫一眼即读懂、不靠解码图标：

- running：`第 N 步 · {summary}`（brand-strong，N=最近完成步 `lastStepIndex`，故意比实时滞后一步）或首步未完成时 `思考中…`。
- ask_user：`等你回复`（warning，copy key `waitingForYou`）。
- approval：`等待审批 · N`（warning，`waitingApproval`）。
- error：`出错 · N`（error，`errored`）。
- completed：`已完成 · {summary}`（muted）。

计数（approval / error）折进 subline，不再单设角标行。`{summary}` 在 running→settled 间保持稳定，只换前缀 + 图标翻面（spinner→check），给用户视觉连续性。legacy `第 N 步 · ` 前缀在渲染时 strip，无需 DB migration。

##### 4. 标题字重 + 入场 pop

- 标题 13px Inter，进行中 / 未读 / 各 blocking 状态 `font-semibold`，其余 `font-medium`。
- **一次性入场 pop**（`sidebar-state-pop`）：进入 error / ask / approval / unread 时图标弹一下（keyed on `attentionKey`，replay on entry，不在 in-state 时循环）。强 overshoot（scale 0.42→1.38→0.94→1，0.44s `cubic-bezier(0.22,1,0.36,1)`）确保在繁忙状态板上是明确的「看这里」一拍。**running 不 pop**（它已有呼吸 rail + 旋转图标）。
- 所有 sidebar 状态动效都遵守 §2.7 与 reduced-motion：呼吸 rail 属外围 liveness 例外保留；pop / step-tick 是一次性入场，禁止无限闪烁 / shimmer / 大面积背景呼吸；`prefers-reduced-motion` 下 `sidebar-liveness-rail` / `sidebar-liveness-tick` / `sidebar-step-tick` / `sidebar-state-pop` 全部关停。
- **Desktop Pet**：Cat icon 是 session status badge，仅在绑定 session 出现。
- **Supervisor 来源徽标**：`origin.via === "supervisor"` 的 session 在标题右侧显示 `PlugsConnected` 小徽标，tooltip / aria 为「Supervisor 创建」。这是 provenance，不是运行状态；不得参与排序，也不得覆盖 running / waiting / error 的 rail、icon、subline。

#### Project 行

- Project Review list：`pinned desc`，再按项目内容活跃度排序（项目内非归档 session 的最大 `lastActivityAt`；空项目回退 `createdAt`）。Project Review 显示全部项目；`OLDER PROJECTS` 默认折叠来承接长期增长。
- Row：Phosphor `Folder` / `FolderOpen` + name + optional pinned icon + project conversation `+`。项目行右侧 `+` 是 32px 透明 hit area 的 contextual action：默认收敛，row hover / active 时显现为裸 `+`；button hover 只给轻量 `bg-hover` + 文字色变化，不加常驻边框或阴影。Quick Action 里的新建项目 `+` 使用同一套轻按钮规则，但常驻可见。空项目 CTA 用显性 `+ 新建项目对话`。当前右侧项目上下文或展开 row 用 `bg-selected`。
- Right-click menu：Pin / Unpin、Edit、Delete。Delete 走 confirm dialog；删除 Project 不删除 session。
- `CreateProjectDialog` / `EditProjectDialog` 是 420px modal，收 `name` 和可选项目文件夹。选择文件夹即绑定到 GA Project Mode，清除文件夹即关闭；它不是 cwd-binding，不能悄悄改变 GA 相对路径语义。
