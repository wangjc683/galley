# 整体布局与窗口 Chrome

> Galley 设计系统 · 原 DESIGN.md §3–§4.2（2026-07-04 拆分）：两栏布局、SidebarHeader（书眉）/ MainHeader、Browser Control / 内核 / Channels indicator、Sidebar 结构、Session Row、Project 组行。

## 3. 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│ Top Bar（44px）— traffic light reserve · Title menu · actions │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  Sidebar     │   Conversation + Tool Timeline               │
│  14–30%      │                                              │
│  resizable   │   ┌──────────────────────────────────────┐   │
│              │   │ Composer                             │   │
│              │   └──────────────────────────────────────┘   │
└──────────────┴──────────────────────────────────────────────┘
```

- 两栏布局：Sidebar / Main，整体 minimum window width 960px，minimum height 600px。
- Sidebar 用 `react-resizable-panels`，默认 20%，约束 14–30%；宽度持久化到 localStorage。
- Sidebar **不可折叠**。多 session 是 Galley 的核心产品形态，隐藏 Sidebar 等于隐藏差异化；需要更少 chrome 时通过拖拽缩到 14%。
- 右侧 Inspector 已退役。详情分散到各自最相关的上下文：Tool callout inline 展示工具细节，Runtime metadata 进入 Settings。
- 主区默认只有 Conversation column；阅读宽度（compact / wide）在 MainHeader 的「显示」popover 里切换（另有 Settings → General 与 macOS View 菜单）。
  点击 Markdown 文件或顶部「改动」时可临时打开右侧阅读面板：主区至少 1080px 时支持拖拽调整，
  预览默认占 46%，全局记住比例，双击分隔线复位；
  否则进入内容工作台档的覆盖预览。关闭后恢复原对话布局。完整行为见
  [本地文件引用与预览](./conversation.md#本地文件引用与-markdown-预览)。

---

## 4. 组件 Spec

### 4.1 列头（SidebarHeader + MainHeader）

**不存在全宽 top bar。** 两栏各自在 panel 内部长出自己的 header，均 **44px 高**、底边对齐成顶部一条连续 chrome，被全高 `ResizeSeparator` 分隔；两栏两色（Sidebar `bg-chrome` 暗 / Main `bg-app` 亮）。根因：全宽 bar 与下方两栏结构错配——session title 语义属于「当前对话」（Main），全宽 bar 里左对齐会落到 Sidebar 上方、长标题还横跨分割线；在 bar 内按 sidebar 宽度切两段又得追可拖拽 + 持久化的宽度（脆弱）。让每栏各管自己的 header，宽度天然继承、分割线天然全高，两平台的 OS 窗口控制也各自落回本属的那一栏。

两个 header 都带 `data-tauri-drag-region`，共同作为窗口拖动 handle（Tauri v2 需 `core:window:allow-start-dragging` 权限，buttons 自动豁免）；非 mac 双击 header 空白处切最大化（`isWindowActionTarget` 判定），mac 由 overlay 接管。

**SidebarHeader（Sidebar 栏顶，y=0）—— 书眉**（2026-10-03）
- `Galley` 字标（左）+ 搜索 / 定时 / 项目三个图标（右），单行。角色是**书眉**：顶部两栏像摊开的书，左页印书名（Galley），右页印章名（会话标题）。整体感靠这个角色和共用的网格，不靠把字标和按钮焊在一起。字标不可点（08-14：它是拖窗把手；按题词先例，误点不能烧掉一个会话）。
- 字标 17px Newsreader 斜体 500，**不缩**：Newsreader 的 x 高只有 0.43em（Inter 0.55em），17px 的 x 高 7.24px 与右栏 13px Inter 标题的 7.10px 同档（字体文件实测）；缩到 14px 小写反而比右栏小一号。宽 46.8px。
- macOS：traffic light 浮于窗口左上 = 本 header 左上，故左 padding 让出 **88px**（红绿灯簇右缘约 68px + ~20px 间隙；代码现状，2026-09-18 回写——早先记的 ~78px 已被实机否掉：10px 间隙让斜体衬线字标看起来挤着彩色圆点）。**不要**退回 78px 或更贴。非 mac 用 16px 常规 gutter。
- 三个图标用 MainHeader 同款 `TopBarIconButton`（28px、16px thin、`gap-1`），左右两栏顶上的按钮是同一种东西；顺序 搜索 → 定时 → 项目。右边距让「项目」图标与会话行 hover `⋯` 落在同一竖列（行 `mx-1.5` + 触发器 `right-1.5`，同为 28px）：mac / Linux 12px；Windows 22px，多出的 10px 是会话列表 `scrollbar-gutter: stable` 留的滚动条槽位。项目菜单、定时徽标见 §4.2。
- **窄宽回落，单一门槛**：放不下「字标 + 三图标」时，三个图标回到新对话那一行，即 09-28 的一行布局，顶行只剩字标。新对话行两态都在，所以切换时列表不上下跳；字标始终在。门槛按侧栏内容宽度（`@container/sidebar`，面板宽减 aside 的 1px 右边框）：mac 251px、Windows 189px、Linux 179px，算式在 `sidebar/sidebar-width.ts`。
- 运行时状态与 Supervisor SOP 已移出（2026-10-03）：前者进 MainHeader 状态簇（见下「内核 Indicator」），后者进工具簇。2026-09-18「外置模式 SOP 退成 icon-only」一条随之作废。

**MainHeader（Main 栏顶）** —— `[ 标题 ▾  ··· drag ···  状态簇 │ 工具簇 │ (Win 窗口控制) ]`
- session title 左对齐贴 main 栏左 gutter（**不对齐居中的对话列**——对话列宽随 compact/wide 变，对齐它会让标题左右跳）。title 属于「当前对话」，放在对话区上方、视线最先到达处。本栏左侧无 OS chrome 保留区。
- **Session title menu**：有 active session 时 title + `CaretDown` 是一个按钮，打开 session-scoped 菜单（Rename / Reinject Tools / Desktop Pet）。空状态渲染 italic muted "新对话"，不可点。Rename 进入 inline edit（Enter 提交 / Esc 取消）。
- 右：两个清晰 group，最后才是 Windows window controls（不属于工具簇）：
  - **状态簇**（aria label：`运行状态`）：Goal（条件渲染）→ 内核（2026-10-03 从 SidebarHeader 移入）→ Browser Control → Channels → 应用更新。只放有状态的东西。Browser Control 与 Channels 就绪后是「灯」（见下「两 header 共通视觉规约」），点开状态菜单（菜单式浮层）。
  - **工具簇**（aria label：`视图与设置`）：改动（`GitDiff`，条件渲染，见下）→ 显示（`TextAa`，popover 内三行：阅读宽度 / 字号 / 主题，2026-10-04 由三个按钮合并）→ Supervisor SOP（`PlugsConnected` thin，tooltip 只写名字「Supervisor SOP」，2026-10-03 从 SidebarHeader 移入）→ Settings 入口（Phosphor `Gear` thin，中文 UI tooltip "设置 · ⌘ + ,"）。按钮共用 `TopBarIconButton`，图标一律 16px thin（原宽度箭头的 14px 视觉补偿随宽度按钮退役）。SOP 放这里而不进状态簇：它没有状态，本质是「设置 → 智能体接入」的深链，挨着齿轮读作「设置里一个常用页」；不按状态隐藏，两种运行时模式都在。
  - **改动按钮只在知道仓库时出现**（2026-10-04）：当前会话所属项目（空状态取当前项目）有根目录，或本窗口审阅过某个仓库，才显示；改动面板开着时一直显示（要能关掉它）。否则不显示——不知道仓库时它只能打开一个「选择仓库」空面板。始终可用的入口是命令面板「查看仓库改动」。行为细节见 [conversation.md](./conversation.md#本地文件引用与-markdown-预览)。
  - 两组之间用 1px 竖向分隔线；没有任何状态项时不显示状态簇和分隔线。
- Windows window controls（min / max-restore / close）贴 MainHeader 最右端 = 窗口右上；macOS 不渲染（由左上 overlay traffic light 接管窗口控制）。

**两 header 共通视觉规约**
- 状态控件统一视觉语法：文字 badge 统一 28px 高度、6px 圆角、12px 字号、border / hover / press 节奏；icon-only 状态统一 28px 方形按钮、Radix tooltip，且不显示浏览器默认 focus outline。色调只表达**状态类别**，不给某个功能单独造身份视觉：`brand` = Galley 在为你做事或邀请你开始（Goal 运行中、浏览器控制待解锁）；`warning` = 要你动手（如等扫码）；`error` = 坏了；`success` = 做完待看；`neutral` = 过渡中或安静的设置缺口。（2026-10-04 把 `brand` 写进这条：此前条文只列四色，Goal 运行中早已用 `brand`；浏览器控制待解锁从 `warning` 改 `brand`，见下。）
- **灯（lamp）**（2026-10-04，Browser Control 与 Channels）：macOS 菜单栏语法（蓝牙关掉时的样子）——单色，状态画在字形本身。**亮** = 此刻有活连接：就是普通的 16px thin 图标，和相邻工具图标完全一样；**不亮** = 同一图标 50% 不透明度。极性是刻意的：在线是常态，所以融进整排，只有掉线才偏离。墨色与其他顶栏图标相同，亮灭切换无过渡，悬停照常给按钮底板。实现只有一处：`header/TopBarLampIcon.tsx`。当日真机修订：初版把「亮」画成 thin 轮廓下垫一层淡填充（`fill` 字重、`--opacity-medium`），两颗实心图标在细线行里重了一档、不统一，JC 改为现行反转极性；同时否掉的还有斜线 / 叉变体（带斜线的气泡读作「通知已静音」，拼图也没有斜线版）、图标下短线（16px 下看不见）、描边加粗一档（仍不同族）。50% 而非更低：要读作「关着」，不是「不可点」。
- **禁止**（勿回退）：状态点（05-31：聊天图标上的点读作未读消息；05-27：浏览器控制就绪后「无状态点、无动效」）；健康状态用颜色或动效；按钮面显示已定型的偏好。颜色只给 warning / error 文字 badge 和 `brand` 邀请 badge。
- Topbar 内会打开 menu / popover 的 trigger，打开态需要保留轻微下沉 + press shadow，帮助用户把浮层和来源按钮对应起来。打开态按 `aria-expanded="true"` 取（`TopBarIconButton` 与 `TOPBAR_POPOVER_OPEN_STATE`）：每个 trigger 都套着 `TooltipLabel`，Tooltip trigger 自己的 `data-state` 会盖掉 popover 的 `data-state="open"`，只认后者时打开态从没显示过（2026-10-04 查出，显示 / Goal / 更新 popover 一并修好）。
- **顶栏浮层两套形态，按用途分工**（2026-10-04）：**入口类用菜单式，决策类用卡片式。**
  - **菜单式**（「显示」、Browser Control、Channels，与会话标题菜单、Composer ＋ 菜单同一套）：`galley-pop-in`、`z-[70]`、`align="end"`、6px 偏移、`p-1` 紧凑容器、宽度随内容（最小 200px；Browser Control / Channels 两个灯菜单 168px，见下；最大 300px）、13px 行；状态行不可点、与菜单项同内边距（`px-2 py-1.5`）；动作是整行悬停高亮的菜单项（14px thin 图标 + 文字），分隔线 `my-1 h-px bg-line`。Browser Control / Channels 用 Radix DropdownMenu（有方向键导航），样式常量在 `header/status-menu.ts`；「显示」用 Popover 是因为选后不关。macOS 菜单栏图标的先例：状态在上、分隔线、最后一行「Wi‑Fi 设置…」是菜单项不是按钮。
  - **卡片式**（Goal、应用更新）：Radix Popover、`z-50`、8px 偏移、`p-3`／`p-4`、标题 13px medium + 说明正文 + 明确按钮（停止 / 延长 / 重启）。它们是带决定的通知，需要说明文字和按钮，塞进菜单行会挤。
  - 曾经四个状态浮层统一用卡片式（16px 留白 + 凸起的「XX 设置…」secondary 按钮），JC 真机指出 Browser Control / Channels 与「显示」字体和样式不统一，当日改为上面的分工。
- **外观类偏好控件的标准形态**（2026-07-05 定形，2026-10-04 合并为一个「显示」按钮）：一个 28px 图标按钮（`TopBarIconButton` + `TextAa`，tooltip「显示」）→ 一个小 popover → 每个偏好一行：左列 muted 小标签（`text-ui-tertiary`），右列共享 `SegmentedControl`，三个控件左缘对齐。现有三行：阅读宽度「紧凑 / 宽松」、字号「小 / 标准 / 大」、主题「跟随系统 / 浅色 / 深色」。用 Popover 而非 DropdownMenu 是刻意的：选后**不自动关闭**，用户可来回切档、看着背后的对话即时重排。按钮面**不用 brand tint 表达「偏离默认」**——已定型的偏好不是可行动信息，常驻高亮是安静工作台的噪音；当前状态只放在 popover 内（「跟随系统」的解析结果做主题分段下方 caption，只在选中「跟随系统」时出现）。新增外观偏好时加一行，不再加按钮、不再发明新样式。合并的理由与被否方案见 [devlog 2026-10-04](../devlog/2026-10-04-topbar-display-popover.md)。
- `SegmentedControl` 选中态（全局，`ui/segmented-control.tsx`）：`bg-hover` 轨道上的白色浮起块 + `text-brand-strong` medium 文字。轨道不用 `bg-surface`——它和 `bg-elevated` 在浅色下几乎同白，放进 elevated 父容器（popover）时选中态会不可读。
- icon-only controls 必须使用项目统一的 Radix tooltip（`TooltipLabel` / `IconButton` tooltip），不使用原生 `title` 作为 hover 提示（延迟 / 样式 / 出现时机不可控，会让相邻按钮反馈节奏不一致）；可访问名称用 `aria-label` 保留。
- **不放 Command Palette 按钮**：Sidebar 已有 Search quick action，`⌘K` 全局可用；重复 click affordance 只增加 chrome 噪音。
- **不放 Sidebar toggle**：Sidebar 当前不可折叠，只可拖拽调整宽度。
- **不显示**：runtime 详情（状态簇只放内核状态的入口，详情在 Settings → 运行时 / 模型；2026-10-03 前这条写的是「留在 SidebarHeader，不进入 MainHeader」，随内核指示移入状态簇改写——状态簇早已有渠道、更新这些 app 级状态）/ Stop（在 Composer Submit 位置）/ Context Window / 价格。

> 命名注记：组件文件为 `MainHeader.tsx`；其内部 helper（`TopBarStatusCluster` 等）与 i18n 命名空间 `copy.topbar` 保留历史名，仅为限制 churn，不代表仍存在全宽 top bar。下文 Browser Control / Channels indicator 小节中的「TopBar」措辞即指 MainHeader 状态簇。

#### Browser Control Indicator

Browser Control 是 managed GA 的核心能力，位于状态簇的内核后、Channels 前（仅内置模式）。状态是常驻浏览器桥报来的实时状态（[browser-control.md](../managed-ga-runtime/browser-control.md)）。

| 状态 | 形态 | 点击 |
|---|---|---|
| `connected` / `connected_no_tabs` | `PuzzlePiece` 灯，**亮** | 菜单 |
| `offline`（验证过，插件没连上，多半浏览器没开） | `PuzzlePiece` 灯，**不亮** | 菜单 |
| `not_connected`（从没验证过） | `浏览器控制 · 待解锁` 文字 badge，`brand` | 直达 Settings → Browser Control |
| `error` | 按桥的 `errorKind` 命名的 `error` badge：缺少组件 / 端口被占用 / 连接中断 / 未能启动；无 kind（脚本测试失败、插件目录同步失败）为 `需检查` | 菜单 |
| `unknown`（桥首次报告前、或重启中） | 验证过 → 不亮的灯；没验证过 → 待解锁 badge；验证标记读出前的几毫秒不渲染 | 同对应形态 |

- **待解锁不是待修**（2026-10-04，改 05-27 的 `warning` 规约）：浏览器控制是 Galley 的头号能力，第一印象该是邀请，不是「坏了」。`brand` 而不是 `neutral`：`neutral` 会把它降到「新版本可用」那一档；`brand` 在本簇的含义是「Galley 在为你做事或邀请你开始」，是一类状态，不是这个功能的身份色。
- **`unknown` 不再闪「检测中」**：启动时它只持续约一秒，旧的 neutral「检测中」badge 每次启动闪一下再换成别的。改为按已持久化的验证标记先画结论：待解锁的含义就是「设置没完成过」，这个标记启动时已知。
- **菜单**（菜单式，见上「两套形态」）：只讲状态，行写法与 Channels 菜单相同——**拼图图标**（14px thin，与「设置…」的图标同列）+「浏览器」+ **右列状态词**（与 Channels 的状态词同字号、同色规则）；次行缩进到名称列。
  - 已连接：右列「已连接」克制的 success 绿（与 Channels 的「已接入」同一健康色），次行「N 个标签页」/「暂无网页」浅墨。
  - 未连接 / 检测中：图标 50%、「浏览器」降为 `ink-soft`（灯的语法逐行用，同 Channels 的暂停行）；右列「未连接」/「正在检测」浅墨；未连接次行「打开装了插件的浏览器后自动连接。」。
  - error：右列红字写原因（端口被占用 / 连接中断 / 缺少组件 / 未能启动 / 需检查，即徽章后半截）；次行是桥自己的中文原文（两行截断，全文在 Settings）；探测失败造成的 error 次行是技术原文（2026-10-08 起 store 只存明细，探测的中文整句不再进顶栏）；桥类错误再单独一行「正在自动重试。」（接在原文后会被两行截断吃掉）。连接中断不加这行：桥的原文已经以「正在重试」结尾。**不另起红色标题**：它只是把徽章再说一遍。
  - → 分隔线 →「设置…」菜单项。宽度同 Channels：最小 168px，报错原文可撑到 300px。
  - 2026-10-04 真机三档（A2 标签页数跟在名称后 / A1 标签页数放次行 / B 保留「已连接 · N 个标签页」一句只补图标列），JC 选 A1（见 [devlog](../devlog/2026-10-04-browser-control-ux-round.md)「当日真机修订」）。
**范围说明不进菜单**（2026-10-04 JC 嫌长）：瞄状态的浮层每次打开都要重读，「它能看到什么」读一次就够，只留在 Settings 已连接卡（见 [overlays-and-settings](./overlays-and-settings.md) Browser Control）。
- **不放「重新检测」**：状态是实时的，手动检测只会重复桥已经报告的内容；脚本测试失败这类偶发错误去设置页点「测试连接」。
- tooltip 仍说出状态（共享 Radix tooltip，不用原生 `title`）。
- 未连接时（从没验证过）badge 与下方 banner 常驻：不可隐藏、不可 dismiss，无动效、无弹窗。
- **配置只有一个家：Settings → Browser Control。** 待解锁 badge 与 banner 直达该 Tab，灯与 error badge 经菜单里的「设置…」进入。早期的独立 setup dialog（含「每次启动自动弹一次」的规则）已在 Tab 迁移中退役——不再有任何自动弹窗。
- **邀请 banner**：从没验证过、且此刻没有连上时（`browserControlInviteVisible`），主内容区顶部显示 banner：与待解锁 badge 同一材质（`border-brand/30` + `bg-brand-soft`）、`PuzzlePiece` 小方块、文案说清用户得到什么，右侧 `brand-soft` 按钮「解锁浏览器控制」直达设置。按持久化的验证标记而不是实时状态判断，所以从第一帧就在、不会启动一秒后才挤下来。验证过的安装出了桥错误时不显示：没有可解锁的东西，error badge 已经在说。
- **试一试**：自动验证成功的那一刻弹一条 info toast「浏览器控制已连接」+「试一试」（跑 Settings 里同一个 demo），不自动消失——它发生时用户多半还在浏览器扩展页里。只在自动验证由失败转成功时弹一次，手动「测试连接」成功不弹（设置页旁边就有 demo 按钮），以后的启动不弹。空状态保持全空（[conversation.md](./conversation.md) §7 勿回退条），这条 toast 就是那里说的「非空状态发现机制」。
- Tab 内容（设置指引 / 状态卡 / 维护动作 / demo）的规范在
  [overlays-and-settings](./overlays-and-settings.md) §9 Browser Control。

#### Channels Indicator

位于状态簇 Browser Control 后（仅内置模式）。Channels 是可选能力，只用桌面的用户不被催。

| 状态 | 形态 | 点击 |
|---|---|---|
| 从没设置过任何平台 | `ChatCircleText` 灯，不亮 | 直达 Settings → Channels |
| 设置过、至少一个在运行 | 灯，**亮** | 菜单 |
| 设置过、全部已暂停 | 灯，不亮 | 菜单 |
| 连接中 / 等扫码 / 需处理（含读取失败） | `Channels · 连接中`（`neutral`）/ `Channels · 扫码`（`warning`）/ `Channels · 需处理`（`error`），优先于灯 | 菜单 |

- **「设置过」怎么算**：照 Core 的派生状态（`im_supervisor/manager.rs` `derived_status`）——没有凭据（微信无 `token.json`、飞书 / Telegram / Discord 无已保存配置）的停止平台报 `not_connected`，有凭据报 `stopped`；断开连接清凭据回到 `not_connected`。所以「设置过」= `enabled`（用户启动过且没停）或状态不是 `not_connected`。Settings → Channels 用的是同一组信号（`enabled` 决定重启按钮，状态决定卡片徽标）。
- **菜单**（菜单式）：每个设置过的平台一个状态行：**平台图标**（14px、`ink-muted`，与 Settings 卡片同一套单色图形 `ChannelPlatformMark`；和下方菜单项的图标同列，文字也同列）+ 名称 + **右列状态词**（与 Settings 卡片徽标同一个函数出词，`im/channel-view.ts` `channelStatusBadgeKind`：已接入 / 服务已启动（飞书运行中但还没绑定使用者）/ 已暂停 / 未启动 / 正在接入 / 等待扫码 / 接入已失效 / 异常 …，2026-10-08 起此前卡片三个渠道写「服务已启动」、与菜单不一致；已接入用克制的 success 绿（与 Settings 卡片徽标同色，一眼扫过去颜色即健康，JC 2026-10-04）、异常 / 失效标红、等扫码标琥珀，已暂停等其余状态浅墨）。**已暂停（以及刚启用、还没起来）的行，图标 50%、名称降为 `ink-soft`**——灯的语法逐行用。异常行下加两行以内的 `lastError`，缩进到名称列 → 分隔线 →「重启 Channels」菜单项（只在有已启用平台时出现，先弹与设置页同一个轻确认 `ConfirmActionDialog`）→「设置…」菜单项（浮层已说明是 Channels，不重复，与浏览器同词）。
- **宽度**：最小 168px（两个灯菜单共用，`status-menu.ts`），低于其他紧凑菜单的 200px——加了图标后行宽约 166px，原先多出的宽度全落在名称与状态词之间。报错原文可以把菜单撑到 300px 上限：异常态，全文比整齐重要。
- **图标单色、不用品牌色**：同 Settings 卡片的规矩；况且微信绿挨着「已接入」会被读成健康绿。2026-10-04 真机三档里 JC 选的 A′（见 [devlog](../devlog/2026-10-04-browser-control-ux-round.md)「当日真机修订」）。
- **只列设置过的平台，不放占位**：05-31 否掉的是「平台清单」——这里只列用户自己设置过的。
- 不放状态点：聊天图标上的点读作未读消息（05-31）。

#### 内核 Indicator

2026-10-03 从 SidebarHeader 移入状态簇，位于 Goal 后、Browser Control 前（内核是后面那些能力的前提）。没就绪时文字 badge，就绪后收成安静图标或不显示。

| 状态 | 形态 | 点击 |
|---|---|---|
| 内置、无可用模型 | `配置模型` 文字 badge，`neutral` | Settings → 模型 |
| 外置、未配置 GA 目录或 Python | `接入外部 GA` 文字 badge，`neutral` | Settings → 运行时 |
| 外置、就绪 | `Cpu` thin 图标（Settings 运行时 tab 的图标），tooltip「使用你接入的 GenericAgent」 | Settings → 运行时 |
| 内置、就绪 | 不显示 | — |

- 色调刻意用 `neutral`：在侧栏时它们是灰点 + 浅墨文字，搬家不顺手升级严重度。
- 外置就绪的图标是新增的可点入口（在侧栏时只是不可点的徽标），直接深链到设置页。它不是灯：没有可报告的实时连接，所以不点灯、不开菜单（Browser Control / Channels 的灯点开菜单，见上）。

### 4.2 Sidebar

#### 结构（自上而下）

```
┌──────────────────────────────────┐
│ Galley               ⌕   ◷   ▭  │  书眉：字标 + 搜索 / 定时 / 项目（2026-10-03 起）
├──────────────────────────────────┤
│ + 新对话                     ⌘N  │  独占一行：唯一主动作，全宽带字；列表的开头，空状态时是选中行
┊┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┊  （分隔线只在列表滚动后出现；窄于门槛时三个图标回到这一行）
│ PINNED                           │  仅有 pin session 时显示（项目里的置顶会话也在这里）
│   ◐ Session A                    │
├──────────────────────────────────┤
│ 项目                        2 ⌄  │  项目分区（2026-10-08）：计数 = 列出的项目数；可折叠，跨重启记住
│ ▌ Folder 发版回归                │  项目组行：启动时折叠，点击展开/收起
│     1 个等你回复 · 共 19 个      │  第二行：最高优先级状态 + 总数
│     ┃ ⏸ 回归 #7                  │  组折叠时露出：等你回复 / 出错 / 选中的子会话
│   Folder 官网改版                │
│     共 4 个对话                  │
│ TODAY                         3  │  时间桶只装项目以外的会话；计数 = 会话数
│   ◐ Session 1                    │
│ THIS WEEK                        │  滚动 7 天
│ THIS MONTH                       │  滚动 30 天（2026-09-09 新增）
│ EARLIER                          │  单行 "查看全部 N"，打开 EarlierDialog
│   ◐ 当前会话                     │  仅当当前会话在「更早」里：借位挂一行（2026-10-03）
├──────────────────────────────────┤
│ Archived                   N     │  底部
└──────────────────────────────────┘
```

#### 关键决策

- **书眉 Header**（2026-10-03）：`Galley` 字标 + 搜索 / 定时 / 项目三个图标同行，规格与窄宽回落见 §4.1 SidebarHeader。产品名使用 sentence case，不使用全大写 wordmark，避免读成 acronym。字标自带 `data-tauri-drag-region`（该属性不冒泡）。运行时状态与 Supervisor SOP 不在这里（移入 MainHeader，见 §4.1）。
- **新对话独占一行 = 逃生出口**（2026-10-03）：侧栏这个按钮是窗口里唯一一直看得见的新对话入口（主区顶栏的「新对话」只是空状态标题；⌘N / ⌘K / mac 菜单栏都要用户先知道，Windows 没有菜单栏）。用户找不到它，会像被困在旧会话里。所以它按逃生出口的三条标准设计：**显眼**（品牌色粗加号 + medium 文字，这一带唯一的颜色）、**能读**（任何宽度都带字）、**位置固定**（不随宽度或状态挪去别处）。代价是不省高度：笔记本宽度下「字标常驻 / 新对话带字 / 省一行」只能三选二，JC 定带字优先于省一行。搜索 / 定时 / 项目是低频入口，上顶行是**降级不藏**（JC 本机项目与定时 0 使用，社区用法未知）。定时徽标在时钟图标右上角（只在有待处理事项时出现、增加时 pop）；「项目」按钮打开项目菜单，新建项目是菜单首项（命令面板也有「新建项目」），见下方「书眉『项目』是菜单」。演进：四行（约 152px）→ 一行（2026-09-28，[devlog](../devlog/2026-09-28-sidebar-quick-actions-one-row.md)）→ 书眉 + 独占一行（[devlog](../devlog/2026-10-03-sidebar-header-masthead.md)）。
- **新对话是列表的开头，空状态时是选中行**（2026-10-08，JC 真机比五档后定）：主区是空的新对话输入框时（`screen === "empty"`，含项目上下文的「新对话 · 项目名」），这一行用与打开的会话行相同的选中样式（`bg-selected` + 抬起阴影，`aria-current`），侧栏因此永远恰好有一行在说「你在这里」——此前点了新对话，侧栏里没有任何一行亮着。发出第一句后选中交给「今天」里那条新会话。它是动作按钮，选中时悬停也要有反馈（选中时再点一下会把焦点送回输入框）：选中底色朝正文墨色再走一个悬停步（`--color-selected-hover`，浅色混 5%、深色 12%，与侧栏普通悬停的 OKLab 明度步一致）；选中的会话行仍然不响应悬停。它与列表之间**静止时不画分隔线**：列表在顶部时没有东西被裁，那条线只是把新对话隔成一条孤立的工具带；列表一滚动，线出现，标出会话行滑进去的裁切边（macOS 工具栏随滚动出现分隔线的同一行为；1px 边框常在、静止时透明，出现时不跳）。被否：保留分隔线只加选中态（选中被两条线夹在一条带子里，读作工具条上按下的按钮，而不是列表里的一行）、去线不加选中、去线且滚动时也不出线（会话行被看不见的边硬切）。⌘N 常显。
- **新对话文字不截断**：独占一行时任何宽度都带字（中文约需 96px、英文约 116px，都低于最窄的 134px）。只有窄宽回落态（三个图标回到这一行）沿用 09-28 规则：动作文字要么完整显示，要么只剩加号，门槛中文 198px、英文 220px（「New chat」Inter 500 13px 实测 58.8px）。这两个数只在 mac 上起作用（都低于 251）；Windows / Linux 的回落门槛本身就低于它们，回落态一律只剩加号。项目版「新对话 · 项目名」只截项目名。
- **行末 ⌘N 与项目上下文**：行末淡色快捷键提示只在**无项目上下文**且三个图标不在本行时显示；右缘离侧栏边 18px，mac 上与顶行「项目」图标的字形右缘对齐。项目上下文里新对话落进项目，而 ⌘N 总是普通新对话（`useGlobalShortcuts` 清项目上下文）——⌘N 是键盘上永远不变的逃生口，所以项目上下文里行末不显示 ⌘N，悬停提示也不写 ⌘N（2026-10-03 修正：此前提示写「新对话 · 项目名 ⌘N」，与 ⌘N 的实际行为不符）。
- **项目是侧栏里的一个分区，没有项目视图**（2026-10-08，[devlog](../devlog/2026-10-08-sidebar-project-groups.md)）：侧栏只有一个列表，自上而下 置顶 → 项目 → 今天 / 本周 / 本月 / 最近 / 更早。项目会话不进时间桶，折进「项目」分区里所属项目的组行；分区与组行规则见下方「Project 组行」。同一天先试过把组行按活动时间混排进时间桶，JC 真机后翻案：一个列表混两种东西，项目位置随活动跳动，「本周」下的组还装着更早的会话，对普通用户是认知负担。此前（05-22 起）项目要按书眉「项目」进 Project Review 模式看，时间线同时列出全部项目会话、行上不标所属项目——Supervisor 拆一次任务、或一批回归，就把「本周」刷满（JC 库 10-08：近 7 天 25 条里 19 条是一个回归项目）。直接把项目会话从时间线藏起来被否：等你回复 / 出错会在默认视图里失明，也破坏「选中行必在侧栏里」。
- **Project row 不用 emoji**：用 Phosphor `Folder` / `FolderOpen` 表达层级与 filter，避免跨平台 emoji 造成的视觉重量和渲染差异。
- **书眉「项目」是菜单**（2026-10-08）：不再是模式开关，没有按下态。点开是下拉菜单（与 10-04 顶栏两个灯菜单同语域）：第一项「新建项目」，分隔线，下面是全部项目（`sortProjectsForNavigation`：置顶在前，再按内容活跃度）；没有项目时「新建项目」下面一行 muted「还没有项目」。点项目 = 在该项目里新建对话，同时在项目分区里展开它的组（分区折叠时先展开分区）。已经沉到「更早」的项目只能从这里找到，它的旧会话靠搜索 / EarlierDialog——这是删掉项目视图的已知代价。窄宽回落态（三个图标回到新对话行）是同一个菜单。
- **项目对话创建是独立动作**：组行右侧轻量 `+`、空项目 CTA `+ 新建项目对话`、书眉菜单里的项目项，才会把右侧切到 project-aware EmptyState（placeholder: `在 {Project} 里交代什么？`，第一句话 lazily create 到该 project）。展开 / 收起组不设项目上下文，也不改变右侧当前对话——侧栏里展开多半只是看一眼（2026-10-08；Project Review 时代展开即软设项目上下文）。
- **新建项目 / 「查看项目」**：建完项目、或「移到项目」提示里点「查看项目」，在项目分区里展开该组并滚进视野；分区折叠时先展开分区，这次展开会记住（是用户自己要看项目）。新建的空项目出现在分区里，展开即见 `+ 新建项目对话`。
- **去掉 ACTIVE / WAITING FOR YOU 区块**：普通 timeline 不做状态队列，也不按 failed / waiting / running / unread 重排；状态只在 row 内用 rail / icon / subline / tint 表达。
- **去掉 "UNFILED" 命名**：通用 Agent 工作台 80%+ 对话本就 free-floating，时间分组就是主体
- **PINNED section** 仅在有 pin session 时显示，空时不占位
- **时间桶是滚动窗口，四桶**：`今天`（自然日）/ `本周`（滚动 7 天）/ `本月`（滚动 30 天）/ `更早`。不用日历周 / 月：日历月在每月 1 号会把上月全部掉进「更早」，那天体验最差；「本周」叫日历名走滚动窗口从未被抱怨过，「本月」照此办理。`本月` 桶 2026-09-09 新增——一周对轻度用户偏短（JC 库里 8–30 天区间的会话数是 1–7 天的近三倍，正是「上次那个任务」最常落的区间），而一个月以上的确可以接受多两步去「更早」里找。加桶而不是把「本周」改名「本月」：重度用户一个月可能四五十条，保留「本周」这一段近的仍然近，一整块「本月」扫起来才有结构。
- **时间桶 header 显示总数**：`PINNED 3` / `今天 5` / `本周 8` / `本月 14` / `更早 24 ›`。数字是桶内的会话数（时间桶里没有项目会话，2026-10-08 起），不拆 running / waiting / failed 分项。「项目」分区头的数字是列出的项目数。「更早」入口的数字是 30 天前的会话数（EarlierDialog 的列表），含项目会话。
- **EARLIER 折叠成单行入口**：sidebar 是当前工作面，不是无限历史列表；完整旧 session 浏览进入 `EarlierDialog`（文案「N 个 30 天前的对话」）。Earlier 入口沿用同一 header + count 视觉族，只多一个 caret 表达可打开。
- **选中行必在侧栏里**（2026-10-03）：当前会话属于「更早」时（从搜索 / ⌘K / EarlierDialog 打开，打开不刷新最后活动时间），它借位挂在 Earlier 入口正下方，是一条普通会话行（选中三通道、⋯ 菜单齐全），入口计数不变，切走即消失、无动效。选中从侧栏以外来、或当前会话换了桶（旧会话发一句话跳进今天）时，行不完全可见就瞬时 `scrollIntoView({ block: "nearest" })`（行带 `scroll-my-2`）；侧栏里点行不滚——行在 pointerdown 激活，滚动会让半露的行在指针下滑走。折叠的项目组里，选中的子会话挂在组行下面；项目分区折叠时，挂在分区头下面（见「Project 组行」），因此照样可见、照样滚进视野；折叠的地方不再挂它，`data-session-id` 不重复（`data-collapsed-drawer` 里的行仍然跳过）。
- **永不空侧栏**：置顶 / 今天 / 本周 / 本月全空但有更早会话时，自动把最近 10 条提出来标为「最近」（2026-09-09 从 5 条提到 10 条，条件从「本周为空」扩到「整窗为空」——本月有内容时正常显示本月桶，不叠加回填）。提出来的行离开「更早」，计数与 dialog 保持一致。
- **侧栏网格**（2026-10-08 补齐）：三条竖线——左 18px（新对话加号、状态图标、时间桶标题、「项目」分区头与「更早」入口、项目组行的文件夹图标）、文字列 42px（新对话文字、会话标题与状态行、已归档）、右 18px（顶行「项目」图标、⌘N、时间桶计数、会话行文字边）。时间桶标题此前是 `px-4`（16px，05-18 遗留），比网格左右各外凸 2px，计数与 ⌘N 差约 2.5px；新对话文字此前起于 43px。**Windows 的代价**：列表有 10px 常驻滚动条通道（`scrollbar-stable`），列表里的右缘比 ⌘N 所在的新对话行再往里 10px，对齐只在 mac 成立；没有为此让列表内容吃进滚动条通道。
- **Archived 不叫 Trash**：archive 是保留数据；真正永久删除只在 Archived dialog 里出现。底部「已归档」行对齐会话行网格（2026-10-03）：图标中心 26px、文字起点 42px（`pl-4.5` + 12px 图标居中于 `w-4` + `gap-2`），按钮仍满宽。
- Sidebar 不可折叠；可拖拽调整宽度。`⌘K` 全局 Command Palette。对象级低频操作由右键菜单和 row hover `⋯` 共同承载：session row 提供 pin / rename / move to project / archive（2026-09-16 置顶提到首项：本机 111 个 session 零置顶，按可发现性问题处理；行内专属 hover 图钉按钮被否，理由见 deferred「session 行 hover 置顶按钮」），project row 提供 pin / edit / delete。右键是熟练用户快捷入口，`⋯` 是可发现入口；两者必须共享同一组动作、排序和 destructive 样式，菜单视觉与 MainHeader 会话菜单同语域（`galley-pop-in` / 200px / 13px）。row contextual actions 使用 overlay，不在非 hover 状态制造额外右侧 gutter；hover / menu open 时文字临时让位给操作按钮。重命名进行中右键菜单禁用（右击边距会 blur-commit 编辑，再叠一个菜单是双重歧义）。
- **归档运行中的会话需确认**（2026-07-05 决策）：会话自身 running 或作为 goal master 时，归档前弹 alertdialog——归档不停止运行，但会把还在跑的工作从状态板上藏起来；对话框文案如实陈述这两点。已结算会话保持一键归档（可逆，无需确认）。
- **交互输入模型：鼠标优先**（2026-07-05 决策）：Galley 以鼠标 / 触控板为交互方式，键盘可达性（Tab 遍历行与菜单、focus reveal 等）明确不在当前范围。全局快捷键（`⌘K` / `⌘N` / `⌘,`）保留；不要为满足审计逐个补 tabIndex / role——若未来翻案，应整体设计键盘故事而非零星修补。
- WebView 默认右键菜单在非编辑区禁用，避免空白处出现 `Reload / Inspect Element`。输入框、textarea、contenteditable、`role="textbox"` 等可编辑区域保留系统编辑菜单。

#### Session Row（参考 PRD §7.5）

Sidebar 的设计目标是一块**可一眼扫描的多 session 状态板**：很多 session 同时跑时，扫一眼左列就能 triage 每个 session 的处境——还在跑 / 等你回复 / 出错 / 完成未读 / 闲置。外围 liveness 在这里是被**加强**的，不是被削弱的（对照 §2.7：A/B 原则在外围监控面是例外，环境 liveness 有价值）。

状态由三条独立信号承载，不互相覆盖：**左侧 status spine（rail + icon）→ 状态行文案 → 标题字重**。

##### 1. 左侧 status spine（rail）

左缘一条 3px 连续状态通道，是整列最先被扫到的信号：

- **running**：brand `bg-brand-strong` **呼吸**（`sidebar-liveness-rail` 底 + `sidebar-liveness-tick` 每步跳动）。**只有 running 会动**——动 = 仍在推进。
- **ask_user**：`bg-warning` 静态。
- **error**：`bg-error` 静态。
- **completed / idle**：无 rail。

motion 语义专属于 running：静态彩条表示「卡在这、需要你」，呼吸表示「正在前进」，无条表示「无事发生」。rail 不表达百分比，不得从左到右推进成 progress bar。ask_user 使用极轻 warning tint，error 使用极轻 error tint，强化可扫性但不改变时间线排序。**running row 不叠底 tint**（2026-07-20 修订）：行背景是「选中」的专属通道——`bg-brand-soft` 与 `bg-selected` 同色值，running 行叠 tint 会与选中行在扫视时无法区分；running 已有呼吸 rail + spinner + brand 状态行 + 加粗标题四条信号，可扫性不依赖底色。blocking 状态保留 tint：色相不同，且属最高 triage 优先级。

**选中态占三条通道**（2026-08-21 修订，真机裁决）：只靠底色不够——底色这条通道被 selected / hover / warning / error / actionsOpen / editing **六个状态共用**，在里面比响度只会让选中读成「更用力的 hover」。三条通道是 ① 底色（chrome 层专属覆写，见 foundations「Chrome 的方向随主题翻转」）② **抬升**（`--shadow-selected`，全行唯一一个投影）③ **减法聚焦**（选中行标题保持 `ink`，其余行降到 `ink-soft`）。有意不用的两条：左 rail 属 running/waiting/error（且选中行常常同时在 running），标题字重属 running/unread。

##### 2. 左侧 status icon（兼承未读）

行最左 14px Phosphor 图标，颜色随状态（见 `status-icon.tsx` `STATUS_MAP`）：

- 静止且跑完（`idle` 与 `completed` 同画）`CheckCircle` muted / 静止但没跑完（步数上限暂停、Goal 暂停或受阻、没有摘要；`StatusIcon` 的 `incomplete`）`Circle` muted / connecting `CircleNotch` 旋转 / running `CircleNotch` **bold** 杏沙旋转 / ask_user `PauseCircle` 深琥珀（「停下等你」）/ error `XCircle` 深红 / cancelled `Prohibit` muted（区别于 error：用户主动）/ archived `Archive` muted。
- **「已完成」由图标承担**（2026-10-03，JC 真机裁决，[devlog](../devlog/2026-10-03-sidebar-polish-selection-visibility.md)）：`completed` 枚举只由 CLI / Supervisor 面写入（`galley session` 收尾），GUI 本地跑完的会话结算为 `idle`（07-05 澄清）；两者都画成 muted 细线对勾圈，看过的完成行不分来源。此前本地完成行是空心环，靠副行 `已完成 · ` 前缀补说完成——空心环在待办类通用语法里恰是「没完成」，前缀又在几乎每一行重复成噪音。空心环从此只留给「停着但不算完成」的静止行。对勾是 muted 不是杏沙：它是几乎每一行的静止态，必须是最安静的那个；杏色只给它的未读形态。同一个 `StatusIcon` 也画 ⌘K 命令面板与「更早」对话框的会话列表，三处一致（那两处不传 `incomplete`，静止会话一律对勾）。
- **三信号优先级必须一致**（rail / icon / 状态行同序）：error > ask_user > running / goal-running > unread > idle。任何一路擅自换序都会让同一行「自相矛盾」。
- **未读并入左图标，不再用右侧独立点**。旧方案的右侧静点在 hover 时会被 `⋯` 菜单顶替而消失，体验割裂；现在「完成未读」= 把左侧那个本就存在的图标渲染成 `weight="fill"` + `text-brand`（细线对勾圈→杏色实心对勾圈；没跑完的行仍是空心环→实心点），无需新增元素。实心对勾圈与 ask_user 的实心暂停圈同为 14px，靠字形与色相区分（深色模式下两色亮度接近，2026-10-03 真机看过可分辨）；整行还有琥珀竖条、琥珀副行与底色兜底。
- **光学权重而非几何直径对齐**：plain `Circle`（只剩「没跑完」的静止行）是整列唯一的实心盘 / 空心环，按视觉重量调尺寸——实心未读点 `size*0.7`（≈10px，填充墨量重），空心环 `size*0.78`（≈11px），让环略大于点但两者视觉重量相当。其它有内部结构的图标（spinner / check / pause / x）保持 14px。
- 未读优先级低于进行中状态：`showUnread` 仅在 settled（非 active、非 running、非 ask_user、非 error）时为真。

##### 3. 状态行文案（subline = 状态行）

第二行直接当状态行用，始终状态着色、**直立不斜体**，blocking 状态给显式文案，扫一眼即读懂、不靠解码图标：

- running：`第 N 步 · {summary}`（brand-strong，N=最近完成步 `lastStepIndex`，故意比实时滞后一步）或首步未完成时 `思考中…`。N 是 run 内按位置的连续序号（2026-09-18）：GA 每次 `put_task` 步号从 1 重数，ask_user 回复也是一次 `put_task`，侧栏把 GA 步号加上回复前已完成的步数（messages `runStepBase`），与主视图序号栏同源，不再在回答后跳回「第 1 步」。
- goal 态（2026-09-16 起 goal v2）：会话自身在跑 goal 时就是普通 running；goal `paused` / `blocked` 而会话空闲时，行上挂静态（不呼吸）的 goal 副线 `Goal · 已暂停` / `Goal · 受阻`（复用 TopBar goal pill 语言）。让位于本会话自己的 running / 一切 blocking 状态。
- ask_user：`等你回复`（warning，copy key `waitingForYou`）。
- error：`出错 · N`（error，`errored`；N=1 时不显示计数）。
- settled：只留 `{summary}`（muted）——「已完成」由左侧对勾圈说（2026-10-03；05-12 选的 `已完成 · ` 前缀当时只与「第 N 步 · 」和完成徽章比过，没测过不加前缀）。只有没跑完的才带词：cancelled `已中止 · {summary}`——用户主动中止的会话不得声称完成；步数上限暂停 `已暂停 · {summary}`（空心环）。标记例外、不标记常态，同「· 1 是噪音」。

计数（error）折进 subline，不再单设角标行，且**仅 N>1 时显示**（`· 1` 是噪音）。`{summary}` 在 running→settled 间保持稳定，只换前缀，给用户视觉连续性。legacy `第 N 步 · ` 前缀在渲染时 strip，无需 DB migration。时间桶（今天 / 本周）跨午夜自动重算（`useDayStamp`），常开监控不再停留在昨天的分组。

##### 4. 标题字重 + 入场 pop

- 标题 13px Inter，进行中 / 未读 / 各 blocking 状态 `font-semibold`，其余 `font-medium`。
- **截断用渐隐，不用省略号**（2026-10-08）：标题与状态行排到 18px 文字边为止，真被截断时最后 22px 淡出（`.truncate-fade` + `lib/truncation-fade.ts` 维护的 `data-truncated`；放得下的行不渐隐，免得末字落进渐隐区像被截了）。浏览器的 `…` 只能在整字处截断，汉字 13px 一个，截断的行右缘散在约 10px 的带里，截在全角逗号后还会出现浮着的「，…」。遮罩只加在文字上，选中 / 悬停底色不受影响。
- 标题与状态行截断时用原生 `title` 补全文（§4.1 icon-only 不用原生 `title` 的例外），且**只在确实截断时**挂：悬停时量 `scrollWidth > clientWidth`（`lib/truncated-title.ts`），放得下的文字不再弹一个重复自己的系统提示框（2026-10-03）。悬停时量是有意的：悬停时行右侧给 ⋯ 让出 28px，静止时放得下的标题悬停时可能被截。
- **一次性入场 pop**（`sidebar-state-pop`）：进入 error / ask / unread 时图标弹一下（keyed on `attentionKey`，replay on entry，不在 in-state 时循环）。强 overshoot（scale 0.42→1.38→0.94→1，0.44s `cubic-bezier(0.22,1,0.36,1)`）确保在繁忙状态板上是明确的「看这里」一拍。**running 不 pop**（它已有呼吸 rail + 旋转图标）。**挂载不 pop**（2026-07-05）：entry 指状态迁移；启动时全列齐射「看这里」不是信息，是噪音。
- 所有 sidebar 状态动效都遵守 §2.7 与 reduced-motion：呼吸 rail 属外围 liveness 例外保留；pop / step-tick 是一次性入场，禁止无限闪烁 / shimmer / 大面积背景呼吸；`prefers-reduced-motion` 下 `sidebar-liveness-rail` / `sidebar-liveness-tick` / `sidebar-step-tick` / `sidebar-state-pop` 全部关停。
- **Desktop Pet**：Cat icon 是 session status badge，仅在绑定 session 出现。
- **Supervisor 来源徽标**：`origin.via === "supervisor"` 的 session 在标题右侧显示 `PlugsConnected` 小徽标，tooltip / aria 为「Supervisor 创建」。这是 provenance，不是运行状态；不得参与排序，也不得覆盖 running / waiting / error 的 rail、icon、subline。

#### Project 组行

2026-10-08 起项目是侧栏里的「项目」分区，每个项目一行可折叠的组（[devlog](../devlog/2026-10-08-sidebar-project-groups.md)），取代 Project Review 的项目行与抽屉。

##### 项目分区

- **位置固定**：置顶之下、今天之上（JC 真机定；「置顶之上」与「组行混排进时间桶」落选）。项目有固定的位置，不随最近活动在时间桶之间跳动。
- **分区头**：时间桶标题同款（10px 标签 + 右侧计数，同一网格），计数后跟 caret，展开时朝下。计数 = 列出的项目数。不放「+ 新建项目」（右侧是计数；新建项目在书眉菜单与 ⌘K）。
- **可折叠，跨重启记住**（JC 真机定，「只是标签」落选）：默认展开；折叠状态存 pref `sidebar_projects_collapsed`。启动时读回偏好之前就点了折叠的，以用户这一下为准。新建项目 / 「查看项目」/ 书眉菜单点项目，遇到分区折叠会先展开它，这次展开照样记住。展开 / 折叠是瞬时的，没有高度动画：折叠时组整个卸载，保证每个会话只挂一份。
- **分区折叠时，需要你的会话挂在分区头下面**：出错、等你回复的项目会话与选中的项目会话，作为普通会话行直接列在分区头下（不缩进、不带引导线，它们可能来自不同项目），同时间桶列行的方式。正在工作与未读不露。
- **列哪些项目**：置顶项目、30 天窗口内有未置顶会话的项目、窗口内新建的空项目；其余项目只在书眉菜单里（它们的旧会话照旧进「更早」）。窗口内会话全部置顶、又没置顶的项目不列。没有可列的项目时不出现分区。
- **顺序**：置顶项目在前，再按内容活跃度（`sortProjectsForNavigation`，与书眉菜单同序）。不按时间桶拆分：一个项目只出现一次。
- **置顶会话不进组**：项目里置顶的会话作为普通会话行留在置顶区（置顶优先于日期）。置顶区因此只放会话，置顶的项目在分区顶部。

##### 组行

- **一律折叠**：只有一个会话的项目也是组（JC 真机定，「≥2 才折」落选）——项目会话永远在项目行下面，行的形态不随数量变。启动时全部折叠，展开状态只在本次运行内记住（「默认展开」落选）。
- **组内平铺，不再套时间分组**：30 天窗口内、未归档、未置顶的会话按最近活动排序；窗口外的放在末行「更早 N」（`更早` 入口同款 10px 标签 + 计数 + caret），点击就地展开。空项目展开显示 `+ 新建项目对话`。子会话缩进在 `ml-6` + `border-l border-brand/35` 引导线里（Project Review 抽屉原样）。
- **双行**（JC 真机定，「单行 + 右侧计数」落选）：与会话行同网格（16px 图标列、42px 文字列）、同 `min-h-[48px]`。第一行 `Folder`（展开时 `FolderOpen` + `text-brand-strong`）+ 项目名 + 置顶图钉；第二行 11px 只说最高优先级的那一种状态 + 总数，用会话行的词与色调：「1 个出错 · 共 19 个」（error）/「1 个等你回复 · 共 19 个」（warning）/「2 个正在工作 · 共 5 个」（running）/「1 个未读 · 共 4 个」/ 空闲「共 19 个对话」（muted）。汇总算组内全部会话，含尾行里的旧会话。
- **状态汇总沿用会话行三通道**：优先级 出错 > 等你回复 > 正在工作（含 Goal 运行中）> 未读 > 空闲。左侧 3px 状态条同会话行（running 呼吸 / waiting 琥珀 / error 红），有任何非空闲状态时项目名 semibold；进入 error / ask / unread 时文件夹图标 pop 一次，挂载不 pop。
- **组行永远不用 `bg-selected`**：侧栏里恰好一行在说「你在这里」，那是选中的会话或新对话行；展开只靠 `FolderOpen` 表达。悬停 `bg-hover`。
- **折叠时，需要你的会话露出来**：出错或等你回复的子会话、以及选中的子会话，作为普通会话行挂在组行正下方（同样的缩进与引导线），每个只挂这一份——折叠的抽屉里不再挂它。正在工作与未读不露，交给组行汇总。规则：需要你处理的会话永远不会被折叠藏起来。展开时尾行收着、而选中的是尾行里的旧会话，它借位挂在尾行上方（同「更早」入口的借位）。
- 行内动作：悬停显现 `+`（在项目里新建对话，32px 透明 hit area、裸 `+`、hover 只给 `bg-hover` + 文字色）与 `⋯`；右键菜单与 `⋯` 同一组：置顶 / 取消置顶、编辑项目、归档全部对话、分隔线、删除项目（destructive）。删除走 confirm dialog，删除项目不删除会话。
- **归档全部对话**：确认框写明数量（「归档「项目名」里的 N 个对话？」），有运行中的会话时沿用单条归档的口径说明归档不会停止它们；走 `archiveSessionsBulk`，项目本身保留。置顶的会话不在组里，不被归档。
- `CreateProjectDialog` / `EditProjectDialog` 是 420px modal，收 `name` 和可选项目文件夹。选择文件夹即绑定到 GA Project Mode，清除文件夹即关闭；它不是 cwd-binding，不能悄悄改变 GA 相对路径语义。
