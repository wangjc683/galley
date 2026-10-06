# Settings 横切一轮：页头与节标题跟随界面语言、两种徽标、两种折叠、侧栏按频率分组

Date: 2026-10-07
Status: 实现完成，门禁全绿（typecheck / lint / vitest 629 / diff check）；JC 看过改前改后预览，A/B 定 B、飞书外链箭头保留；已提交，第二段逐 tab 待做
Related: [overlays-and-settings §9](../design/overlays-and-settings.md)（Settings 全部 tab、视觉 → 共享组件）、
[copy-language-guidelines](../copy-language-guidelines.md)（中文版 Settings Tab、节标题、服务商）、
[07-05 Settings 打磨系列](./2026-07-05-settings-polish-series-and-twmerge-trap.md)（Channels 徽标重一档的旧裁决）、
[08-04 Settings 六轮 audit](../design/polish-checklist.md)（token 级收口）、
[09-16 侧栏中文主标签（随 v0.4.16）](./2026-09-16-v0.4.16-release.md)

## 起因

JC 发起 Settings 的 UI/UX 打磨，问逐 tab 过还是别的走法。08-04 那轮 audit 是 token 级的（过渡动画、
圆角、数字等宽），已经清零；之后没人从 IA / 交互层把 9 个 tab 放在一起看过。共享原语只有页头、
节标题、字段标签三个，行和卡片各 tab 自己写（General 的 `PreferenceRow`、Runtime 的
`RuntimeDiagnosticRow`、Integration 的 `PathInstallRow`、Browser 的 `ConnectionStatusCard`），分歧
逐 tab 过要到第三、四个 tab 才暴露，回头还得改已收口的 tab。

## 走法

三个选项：逐 tab 顺序过 / 先横切再逐 tab / 按用户场景（首次配置、日常、排障）过。推荐并采用
**先横切再逐 tab**：第一段 tauri dev 真机截 9 个 tab（浅色、中文、内置内核、JC 真实配置）+ 子代理
逐文件读代码做跨 tab 对表，出本地对表页给 JC 逐条裁；第二段再逐 tab 深挖（顺序：模型 → 运行环境、
智能体接入 → 浏览器控制 → 聊天软件 → 通用、快捷键、报告问题、关于）。用户场景作为第一段的一个检查
角度，不做主线（讨论单元跨文件、难收口）。

真机截图的做法见记忆「tauri dev 白屏」一条的 harness 段：System Events 当时没授权（JC 经 UU远程
远程操作，授权框挂在屏上），改用 dev-only harness 用 DOM 驱动设置弹窗；步骤信号文件放 `gui/` 下
会让 Vite 每写一次就整页重载，改放 scratchpad 的本机小服务。

## 裁决（D1–D6，JC 全部按推荐）

- **D1 页头标题跟随界面语言**。09-16 侧栏翻成中文主时写了「页头本轮不动」，结果同一屏左边大字
  「运行环境」、右边大字「Runtime」，主次倒挂；报告问题页又是唯一的中文大标题；中文文案里「设置 →
  通用」与「Settings → Models / Runtime」并存。改为中文 UI 页头用中文 tab 名（locale 里每个 tab 加
  `title` 字段，不在各 tab 里分支），引用统一「设置 → X」。英文 UI 不变（Feedback 英文页头仍是
  「Report an Issue」，未动）。被否：保持英文只修 Feedback；页头也做中英双层（侧栏已有英文锚点，
  页头重复无益）。
- **D2 中文 UI 不出现英文大写节标题**。RUNTIME MODE、GALLEY SUPERVISOR SOP、NAVIGATION /
  CONVERSATION / OVERLAYS（与同页「输入框」混排）、LINKS（与同页「版本」「版式」混排），`uppercase`
  还把「将随 Bug 报告附上」写成 BUG。全部译成中文（运行模式、Supervisor SOP、导航、对话、浮层、链接），
  `SettingsSectionLabel` 的 uppercase + 字距只在英文 UI 生效。模型页「生效范围」tooltip 标题同理。
  被否：只修同页混排（会留下规范没豁免的英文）。
- **D3 徽标收成两种**：`SettingsStatusBadge`（会变化的连接 / 运行状态，24px、带边框、语义色、带图标）
  与 `SettingsTag`（静态标记，无边框无图标，neutral / brand）。同屏原有四种写法，且「正在使用」「推荐」
  「默认」「N 个模型」都把汉字放在 10.5px `text-ui-micro` 上（规范只给拉丁大写 chip）。主会话补齐了
  协议名、更新诊断 chip、「复制详情」三处 10.5px 汉字。
  **漏查与修正**：推荐 D3 时没翻出 07-05 的旧裁决——「Channels StatusBadge 与 Runtime badge 统一被否，
  连接状态是 Channels 卡的核心信息，值得更重一档」（那是论证结论，没做过真机对比）。按 D3 原文把运行
  环境「正在使用」做成状态徽标会翻掉它。发现后告知 JC，给出修正版：按语义划线，「正在使用」在内置模式
  下几乎常驻、表示「选中了哪个」，归静态标记（B），07-05 的轻重之分由分类保住。运行环境页放了临时 A/B
  切换，JC 真机看后**定 B**；外部 GA 行的「正在使用」同理用标签。教训：推荐翻转某处现状前，先 grep 设计
  文档该组件一节有没有「不要 / 有意」类条款（记忆里已有同类条目，这次仍漏）。
- **D4 折叠收成两种**：`SettingsDisclosureCard`（独立卡，caret 在左、旋转；服务商卡、聊天软件卡、默认
  高级配置共用）与 `SettingsDisclosureList` + `SettingsDisclosureRow` / `SettingsNavRow`（带边框列表里
  的行，caret 在右；运行环境「更多」、智能体接入「高级选项」共用）。此前四种：左侧换图标 / 左侧旋转 /
  右侧换图标 / 无容器分隔线；展开区底色两种（`bg-app` vs `bg-hover/25`），行标题 13px 与 12.5px 混用。
  统一取服务商卡的 `bg-app` 展开区、去掉聊天软件卡展开时的头部底色、行标题 13px。运行环境「caret =
  原地展开、arrow = 跳走」的约定保留。模型编辑器里的高级配置用 `inset` 变体（不填底色——在抬起的编辑面
  里填 `bg-app` 会让整块下陷，违反 foundations 的「抬升不倒置」）。卡片头去掉 `tabIndex={-1}`，可用 Tab
  键聚焦，保住原 OptionsFold 的键盘可达性。被否：只统一服务商卡与聊天软件卡。
- **D5 「服务商」**。模型页副标题「模型提供商」、节标题「服务商」同页两词；zh.ts 提供商 13 处、服务商
  6 处；规范表写 Provider → 提供商，但 JC 09-22 裁决里用的是「服务商」。统一为服务商（页面上最显眼的
  节标题已经是它，也更口语），规范表与设计文档同步改。
- **D6 侧栏按使用频率分三组**：通用、模型、浏览器控制、聊天软件 ｜ 智能体接入、运行环境、快捷键 ｜
  报告问题、关于，组间只留约 12px 间距。浏览器控制是头号能力（45% 会话在用）却排第 6，运行环境在
  内置模式下只剩一张卡加三个低频行却排第 2。外置模式下第一组只剩通用、模型；隐藏 tab 被选中时仍退回
  运行环境。被否：只把支持两项分到底部；不动。

## 不需裁决、直接收口的

通知权限提示从红色 `ErrorLine` 改为中性 `InfoLine`；聊天软件页 Phosphor 图标补 `weight="thin"`（此前
渲染成 regular，比别页粗一档）；报告问题、浏览器控制两处直调 `navigator.clipboard` 改走
`copyTextToClipboard`，「已复制」反馈统一 `COPY_FEEDBACK_MS = 1500`（此前 1200 / 1400 / 1500）；
聊天软件三个输入框复用 `SettingsInput`（顺带用 `useId` + `htmlFor` 关联标签）；
`DeleteProviderConfirmDialog` 改为 `ConfirmActionDialog` 的薄包装；外链三种实现收成
`ExternalTextLink` / `ExternalLinkIcon`（12px）+ `openExternalUrl`，`tauri-plugin-opener` 本就拦截
`<a target="_blank">`，自处理点击避免双开；飞书「打开飞书开放平台」按钮按同规则补了尾部外链箭头
（JC 看后保留）；通用、模型两页节间距 `space-y-6` → `space-y-7`；等值的任意 leading 换 token；
侧栏按钮上不生效的 `text-ui-compact` 删除；浏览器控制副标题去句号。
设计文档 §9「视觉」此前写的侧栏 32px / 13px、页头 Newsreader、缺四个图标、内边距 32px 都已过时，
本轮按实际重写，并新增「共享组件」一节。

## 分工

三张 Opus 子代理票并行、按文件分工：票 1 文案与语言（D1 / D2 / D5、副标题、文案规范文档），
票 2 共享组件（D3 / D4），票 3 收口项与侧栏（D6 + 上节）。主会话做对表、裁决、遗留补齐、设计文档、
devlog 与真机截图验收。38 个文件，净减约 150 行；新增 `settings-badges.tsx`、`settings-disclosure.tsx`、
`external-link.tsx`、`lib/open-external.ts`，删除 `runtime/RuntimeAccordionRow.tsx`。

## 留到第二段

中文 UI 里还有几处英文字段名（运行环境 Config file、Memory / SOP；智能体接入 Discovery file；
模型高级配置 Thinking / Adaptive / Disabled）；模型页两套排序手柄（拖拽柄 + 上下箭头）与两个默认信号
（单选圈 + 「默认」）；浏览器控制已连接卡标题比次行还淡；深色模式未看；对话区（非 Settings）的复制
反馈时长仍各自为政（HealthCheckCard / ErrorCard 1400、CodeBlock 1600）。
