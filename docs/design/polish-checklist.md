# Polish 审查清单

> Status: living checklist（首次建立 2026-08-04）
>
> 来源：[make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better)
> （MIT）的界面细节原则，按 Galley 设计系统筛选、翻译成 token 语言。
> 与 [foundations.md](./foundations.md) 冲突的条目在「已否决」表中记录原因，
> 防止未来 agent 重新引入。本清单是**审查镜头**，不是新的规范层：与
> foundations.md 冲突时，一律以 foundations.md 为准。

## 用法

对一个 GUI 面做 polish audit 时逐条过「采纳条目」表；产出 findings
（严重度 / 位置 / before / after / why），逐条裁决后再改，不直接批量套用。
审动效时把 WebView Animations 面板调到 10% 速度，走完 hover / focus /
active / loading / empty 全部状态——10% 速度下觉得不对的，就是全速下
隐约不对的。

## 采纳条目

| # | 规则 | Galley 表达 |
|---|---|---|
| P1 | 同心圆角：外圆角 = 内圆角 + 间距 padding | 两层圆角面贴近嵌套（间距 ≤ 24px）时用公式校验。Galley 刻度小（6 / 8 / 12 / 14），按公式取不到时在刻度内取最近值；刻度装不下的组合（如 16px padding 内嵌 8px 圆角块）接受偏差，见否决表 |
| P2 | 光学对齐 | 带图标的按钮：图标侧 padding = 文字侧 − 2px。三角形 / 非对称图标（play、caret、star）手动偏移到视觉中心，优先改 SVG 本体而非加 margin |
| P3 | 仅为制造纵深的边框换成透明 box-shadow | 用现有 `--shadow-*` token（layered 透明阴影，dark 下已单独调过）。分隔线、表单描边、选中 / focus 态这类**结构性**边框保留 border |
| P4 | tabular-nums | 任何在可见状态下会变化的数字（计数徽标、百分比、elapsed、步数）加 `tabular-nums`，防跳动。已有先例：bucket 计数、elapsed 计时器 |
| P5 | text-wrap | 会折行的标题加 `text-balance`；成段正文加 `text-pretty`。truncate 单行文本无关 |
| P6 | 最小热区 | 密集桌面 UI 交互元素目标 ≥ 40×40px；视觉尺寸更小时用伪元素扩展。**两个交互元素热区禁止重叠**——会重叠时缩到不碰为止（这也是 session row 内 28px ⋯ 按钮不再扩的原因） |
| P7 | 禁 `transition: all` | 一律写明属性（`transition-[opacity]` 等）。现状已合规，audit 时守住 |
| P8 | `will-change` 克制 | 只在实测到首帧卡顿时加，且只用于 transform / opacity / filter |
| P9 | 交互态动效用 CSS transition（可中途打断、可反向），keyframe 只给一次性序列 | 与 §2.7 A 类动效的「有始有终」一致；toggle / 展开类交互禁 keyframe |
| P10 | 图标 stroke 随旁边文字字重 | Phosphor Thin（1.25px）配常规文字为基线；semibold 文字或主 CTA 旁可升 weight（先例：新建项目 Plus 用 regular）。一个面内不混 icon set |
| P11 | 图标状态用 `currentColor` + CSS 变色，不换资源文件 | 现状已合规；outline 为默认态，fill 表激活 / unread（先例：StatusIcon unread 实心圆） |

## 已否决条目

以下为该来源中与 Galley 规范正面冲突或不适用的规则。**不要重新引入。**

| 规则 | 否决原因 |
|---|---|
| row hover 给 ~100ms background transition | 违反 §2.5「hover 一律瞬时」：hover 淡入淡出是网页手感泄漏，全应用禁止 |
| 时长 / 缓动字面量（150 / 200 / 300ms、自带 cubic-bezier） | §2.7 motion token 制：新代码禁止字面量，一律 `--motion-*` / `--ease-*` |
| stagger 入场、blur 入场、标题逐词动画 | 装饰性动效，与「静止的界面 + 有分量的触觉反馈」的安静气质相悖；至多在 onboarding 一次性场景单独论证 |
| press 一律 `scale(0.96)` | Galley 自有按压物理更重更扎实：沉 2px + `scale(0.97)` + `--shadow-control-press` 深接触 inset（§2.5），不换标准 |
| framer-motion / AnimatePresence 模式 | 无 motion 依赖，CSS + token 已覆盖。注：该来源的 CSS fallback 缓动 `cubic-bezier(0.2,0,0,1)` 恰好就是 `--ease-firm`，两边手感基线同源 |
| 图片加 1px 纯黑 / 纯白低透明 outline | Galley 当前无成规模的图片面；引入图片内容时再评估 |
| 魔法数字（icon 动画必须 blur 4px / scale 0.25 / spring bounce 0） | 作者个人品味硬编码，只作手感参考，不作约束 |
| 严格同心圆角凌驾 token 刻度 | ToolCallout 外 12px + 16px padding 按公式要求外圆角 24px，超出 radius 刻度上限（14px）。小圆角 + 大间距的组合视觉上不触发「不同心」问题，保持 token 刻度优先 |

## Audit 记录

- 2026-08-04：Sidebar + Approval Card（ToolCallout approval 态）首轮 audit。
  已落地：Button primitive 图标侧光学 padding（P2）、右键 / 下拉菜单项
  同心圆角（P1）、实时计数 tabular-nums（P4，ApprovalDock / Footer /
  session subline / 定时徽标）、SidebarHeader 状态入口热区扩展（P6）。
  **暂缓（裁决 2026-08-04）**：`Button` / `IconButton` primitive 缺
  `focus-visible` ring（globals.css 全局剥掉了 button outline，散落组件
  各自补了 ring，primitive 没补）——键盘 Tab 焦点不可见。Galley 本阶段
  不面向键盘用户，纯键盘可达性问题不动；将来做键盘可达性时在
  `gui/src/components/ui/button.tsx` 两个 primitive 各补一行
  `focus-visible:ring-2 focus-visible:ring-brand/30` 即可。
  其余否决候选（⋯ 按钮热区扩展、callout 圆角、approval breath 动效——
  后者是 §2.7 既有 backlog）记入上表与 §2.7。
- 2026-08-04：Command Palette + EarlierDialog + ArchivedDialog 二轮 audit。
  已落地：cmdk 结果行删 `cursor: pointer`（§2.6 红线，palette CSS 是
  token 制之前的存量）；palette 入场动画字面量换 `--motion-fast` /
  `--ease-pop` + 补 `prefers-reduced-motion` 退化；palette 圆角 token 化
  并同心化（容器 `--radius-lg`、结果行 `--radius-callout`）；EarlierDialog
  右键菜单项同心圆角；清空归档计数 tabular-nums；Esc 键帽精确居中。
  **裁决（2026-08-04）**：弹层入场 register 统一——全部居中 Dialog
  （17 处 `Dialog.Content`，含共享的 `SESSION_BROWSER_CONTENT_CLASS` /
  `ConfirmActionDialog`）复用 `.galley-pop-in`，与菜单 / palette 同
  register；ImagePreviewDialog 是全屏 lightbox，不适用 scale pop，除外。
  否决候选：浏览器行内 hover 动作按钮 28px（Sidebar ⋯ 同先例 + 热区
  不重叠规则）；行元数据 hover 瞬时让位（hover 瞬时规则,正确）。
