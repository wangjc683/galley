# 设计哲学与设计 Tokens

> Galley 设计系统 · 原 DESIGN.md §1–§2（2026-07-04 拆分）：设计哲学与源头分级、色板 / 深色主题、typography、icon、圆角阴影、UI primitives、WebView discipline、动效分类。

## 1. 设计哲学

Galley 的视觉与交互气质 = **Notion + Claude**。

- **Notion 给**：文档心智、舒展留白、callout 块、Sidebar 树
- **Claude 给**：暖色调、文学性可读性、对话感、克制
- **二者结合 = 在文档工作区里跟一个温和但严肃的助手协作**

不是「驾驶舱盯着野兽工作」，不是 IDE，不是 chat 气泡 IM，不是 dashboard。

### 1.1 三个统摄性约束（PRD §15.4 重申，DESIGN 落地）

1. **单容器更新** —— 一个 session 的所有进展在同一视图内持续刷新，不开新窗口 / 不 toast / 不弹层抢焦点
2. **渐进式披露** —— 默认只展示摘要，细节按需展开。Tool event / raw JSON / 历史 turn 都默认折叠
3. **结果优先** —— 最终答案与过程必须视觉分离，用户第一眼看到结论再展开过程

### 1.2 设计源头分级

| 源头 | 借用 | 不借用 |
|---|---|---|
| **Notion** | sidebar 树、文档留白、callout 块 | 数据库视图复杂度、cover image、emoji-heavy 页面装饰 |
| **Claude.ai** | 暖底色、衬线正文、hero composer、对话节奏 | message 气泡、artifact 侧边栏（V0.1） |
| **Linear** | 键盘优先、Command Palette、密度 | dark-first、cyan/emerald 信号、紧凑驾驶舱感 |
| **Raycast** | overlay Command Palette 形态 | 顶部贴边、酷炫渐变 |

---

## 2. 设计 Tokens

### 2.1 色板（Light-first）

> 命名约定：CSS variable 写 `--color-*`（Tailwind v4 `@theme` 友好），utility class 写 `bg-*` / `text-*` / `border-*`。文字色用 `ink` 命名空间（避开 `text-text-*` 双重命名），边框色用 `line` 命名空间（避开 `border-border-*`）。设计稿与文档讨论时可用语义名（"主文本色 / 卡片边"），代码层用工程名。
>
> 2026-08-07 对码同步：下列 light 表值与 `globals.css` 校齐——06-24 中性化收敛（true-neutral + whisper-warm，[devlog](../devlog/2026-06-24-topbar-split-and-light-palette.md)）改了基底 / line / ink 全系但表值未跟。**值以 `globals.css` 为准**，改 token 时同步本表。

#### 基底层

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-app` | `bg-app` | `#FAF9F8` | App background，true-neutral + whisper-warm（2026-06-24 收敛：R 比 B 高 ~2 counts，不足以读成色相；暖度由暖墨 + 杏沙承担，底不再带黄） |
| `--color-surface` | `bg-surface` | `#FCFBFA` | 普通卡片底 |
| `--color-elevated` | `bg-elevated` | `#FFFFFF` | 浮起卡片（Health Check / Error / Command Palette） |
| `--color-chrome` | `bg-chrome` | `#EFEEEC` | Sidebar / 双栏 chrome，比 app 沉一档（「明度即抬升」在 chrome 倒置）。2026-08-05 由 `#F4F3F1` 加深，见下方「Chrome 下沉量」。**勿复用给 cards / insets**——舞台后退语义，随该关系重调而移动 |
| `--color-code-surface` | `bg-code-surface` | `#F2F1F0` | 块代码底：比 app 深、与 inline code（`--color-hover`）同族，代码读作嵌入媒介而非浮起卡片 |
| `--color-code-ink` | `text-code-ink` | `#9A5528` | 行内代码文字（深色 `#E0A882`）。相对正文墨是**色相**一步、不是明度一步——行内代码标记「另一类对象」（路径 / 版本 / 命令），不是「不太重要」。比 `brand-strong` 更深更饱和以便与链接区分；对比度约 5.6:1（低于正文墨，故意——色相在做功） |
| `--color-overlay` | `bg-overlay` | `rgba(31,27,23,0.4)` | Command Palette / modal 遮罩 |

#### Elevation 不倒置（系统规范）

明度即抬升:`app (#FAF9F8) < surface (#FCFBFA) < elevated (#FFF)`,越浮起越浅。

> **规范**:任何"浮起"容器(dialog / menu / card)的**主体区 elevation 必须 ≥ 它自己的 chrome**,绝不更低。**不要把 dialog 主体刷成 `bg-app`**——那是画布(最低档),会让白色 header/footer 浮在一块更深的米板上,读成"头浅身深"的失衡。想表达"内容区下沉",只用**小块 inset**(勾选框、code/args `<pre>`、输入框),不要整片主体下沉。

落地:浮起 dialog 通体 `bg-elevated`,band 之间靠 `border-line` hairline + 行 `divide-y` 区分(结构靠线,不靠色块)。

例外:Settings 这类**满幅工作台式 modal** 通体 `bg-app`(画布)是有意为之——它不制造"白 chrome 浮在更深 body"的失衡(没有更浅的 header band 浮在上面),读作"设置即一块工作画布",卡片用 `bg-surface` 微微抬起。此例外也覆盖 `EarlierDialog` / `ArchivedDialog`(2026-06 调整)和 `PromptManagerDialog`(2026-06-29 调整):这些列表 / 资料库浏览 dialog 与 Settings 同属"用户进入工作的工作台"语义,为与 Settings 形成统一配色,主体/header/footer/列表/搜索栏底/操作栏通体 `bg-app`,搜索输入框 / prompt 卡片 / 编辑字段作为抬起的 `bg-surface` 对象配 `border-line`(与 Settings 的 model-filter 输入框一致);唯独其内的 per-row 确认小弹窗(delete-one / delete-many / empty-all)保留 `bg-elevated`,因为它们是 alert-grade 确认、不是工作台面,要与其余 app 的确认弹窗对齐。普通确认 / 设置项 dialog 仍按上面规范走 `bg-elevated`。

#### 边框 / 分隔（line 命名空间）

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-line` | `border-line` | `#E8E7E5` | 卡片边、divider 默认 |
| `--color-line-strong` | `border-line-strong` | `#D4D2CF` | hover 边、focus 边（非杏沙时） |
| `--color-line-subtle` | `border-line-subtle` | `rgba(33,31,28,0.06)` | 更弱的内分隔（如 modal / settings row 之间） |

#### 文字三档（ink 命名空间）

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-ink` | `text-ink` / `bg-ink` | `#211F1C` | charcoal-warm，标题、主文本、主 CTA 填充——暖墨压近中性纸，是暖度的主要来源 |
| `--color-ink-soft` | `text-ink-soft` | `#57534C` | 次要文本、metadata |
| `--color-ink-muted` | `text-ink-muted` | `#87827A` | hint、placeholder、timestamp |

#### 互动状态

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-hover` | `bg-hover` | `#F0F0F0` | 中性灰 hover（不抢戏）。仅对亮表面（app/surface/elevated）校准；**chrome 层（Sidebar 列）经 `.chrome-hover-scope` 覆写为 `#E5E3E0`**——08-05 chrome 加深后全局值比 chrome 底还亮，2026-08-07 [devlog](../devlog/2026-08-07-sidebar-chrome-hover-retune.md) |
| `--color-selected` | `bg-selected` | `#F8EDDA` | 杏沙 tint（品牌时刻） |

> Button-like controls 不使用浏览器默认蓝色 outline；鼠标点击不应留下
> focus 态。Focus ring 保留给文本输入、inline edit 和明确的键盘导航面，
> 用 `--color-brand`（`ring-brand`），不单独 token。

#### 品牌 / 状态

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-brand` | `bg-brand` / `text-brand` / `ring-brand` | `#D9A78A` | 杏沙，体温色 + Composer Submit CTA 例外 |
| `--color-brand-soft` | `bg-brand-soft` | `#F8EDDA` | 杏沙最浅 tint |
| `--color-brand-tint` | `bg-brand-tint` | `#F1DECE` | 比 brand-soft 更实的杏沙 band，用作用户消息底（长对话滚动可扫） |
| `--color-brand-strong` | `bg-brand-strong` / `text-brand-strong` | `#C68762` | 杏沙 hover/active；当前 step 状态 icon、Submit hover |
| `--color-success` | `text-success` / `bg-success` | `#5A8C5A` | 成功状态 line icon |
| `--color-warning` | `text-warning` / `bg-warning` | `#BF7A1F` | 深琥珀 warning（与杏沙拉开 13° 色相）。**只表示警示 / 注意**（自动执行确认、Stop、审批待处理、Browser Control 待连接），不作功能身份色——Goal 等功能用品牌杏沙，避免稀释琥珀的警示力 |
| `--color-error` | `text-error` / `bg-error` | `#B14545` | 深红 |
| `--color-info` | `text-info` / `bg-info` | `#7A7A8E` | muted 灰蓝（info severity） |

#### Dark theme（暖炭黑）

Dark theme 是 Galley light theme 的夜间版本，不是另一个产品方向。视觉目标是
**夜间书桌**：长文可读、状态仍清楚、杏沙品牌只作为体温点出现；不走纯黑
OLED，也不走冷灰蓝 IDE / dashboard 感。

默认主题偏好为 `system`，跟随系统深浅；用户可手动选择 `light` / `dark`。
实现上写 `html[data-theme="light|dark"]` 与 `color-scheme`，所有颜色从
同一套 `--color-*` 语义 token 翻转。

| CSS variable | Dark 值 | 用途 |
|---|---|---|
| `--color-chrome` | `#1E1B17` | Sidebar chrome。**dark 下比 app 更亮**（与 light 相反），见下方「Chrome 的方向随主题翻转」 |
| `--color-app` | `#191614` | 暖黑 app 底 |
| `--color-surface` | `#201B19` | 普通卡片底 |
| `--color-code-surface` | `#24201C` | 块代码底 |
| `--color-elevated` | `#27231F` | 浮层 / dialog / command palette |
| `--color-line` | `#353029` | 默认边框 |
| `--color-line-strong` | `#4D443C` | hover / focus 边 |
| `--color-ink` | `#EDE7E0` | 主文本，不用纯白 |
| `--color-ink-soft` | `#C6BDB2` | 次级文本 |
| `--color-ink-muted` | `#92897D` | hint / timestamp |
| `--color-hover` | `#2A2622` | 中性 hover |
| `--color-selected` / `--color-brand-soft` | `#3E3026` | 杏沙 tint |
| `--color-brand-tint` | `#4D3B2B` | 用户消息底（provisional，dark pass 再校） |
| *(sidebar 内覆写)* | `--color-hover` `#2F2B27` / `--color-selected` `#44352A` | `.chrome-hover-scope`，见下方 |
| `--color-brand` | `#D6A083` | 品牌主色 |
| `--color-brand-strong` | `#E2AE8D` | 品牌 hover / link |
| `--color-success` | `#8FBF8F` | 成功（较 light 提亮） |
| `--color-warning` | `#D6A250` | 警示琥珀（较 light 提亮） |
| `--color-error` | `#D97A76` | 错误红（较 light 提亮） |
| `--color-info` | `#A8A7C3` | info 灰蓝（较 light 提亮） |

> **2026-07-25 降暖一档（勿回退到旧值）**：上表的表面 / 墨色是原值 chroma
> 的 **0.6 倍**，L 与色相原样不动——纯 chroma 旋钮，对比度与层级毫无变化
> （正文 ink/app 14.97:1 → 14.95:1）。起因：light 的表面实质是中性的
> （C ≈ 0.002，暖度全交给暖墨 + 杏沙），而 dark 曾悄悄换成"染色纸"策略
> ——按各自明度归一后（C/L），dark 表面比 light 对应项饱和 **15–27 倍**
> （app 0.0395 vs 0.0017）。这个量级落在尴尬区：不够中性、也不够暖到能读
> 成刻意的暖炭黑，于是读作发闷的褐。0.6× 保留可辨认的暖炭，噪音减半。
> 墨色**必须同向同幅**跟着降：只降底不降墨，近中性的底会变成参照物，把
> 奶油字衬得更黄。同批次跟随 ink 的还有 `--color-line-subtle` 与各
> `--shadow-*` 里的 `rgba(236,231,225,…)` 高光内嵌。
> 品牌家族（`brand` / `brand-strong` / `brand-tint` / `selected`）与语义色
> **有意未动**——先看安静下来的底色之下品牌色的相对响度对不对，再决定下一轮。

> **2026-08-21 抬画布 + chroma 松到 0.73× + chrome 翻向**：上表已是本次落地值。
> 整条表面阶梯上移 **3.3 个 OKLCH L 点**，随后 chrome 与 app 对调、主区阶梯
> 随 app 回落 2.1（见下方「Chrome 的方向随主题翻转」）。触发信号是 JC 在 dark
> 下读出「sidebar 太重、头重脚轻」。以 Tokyo Night 为
> 校准尺（JC 日常主题）：TN **最暗**的 UI 面（sidebar `#16161E`，L 20.4）原本
> 比 Galley 的**整个对话画布**（L 19.3）还亮，且 TN 的 chrome→canvas 差值只有
> 2.2 而我们是 3.7。**方向从来不是问题**——TN 的 sidebar 同样比编辑区暗——问题
> 是绝对深度、差值过大、以及地板处 chroma 近零（近黑 + 近零饱和的大色块读作
> 「重物」而非「后退」）。
>
> chroma 部分是对 0.6× 的**有意部分重开**：只抬 L 会让 C/L 从 .0264 悄悄掉到
> .0224（等于又降一档），故先按 L 比例补偿回 0.6×，再松 1.21× 至 **~0.73×**
> （C/L .0321）。仍远低于 TN 的 .078–.095，因为我们是暖相——暖色在冷蓝紫还
> 撑得住的 chroma 上就已经发闷。07-25「墨色必须同向同幅」的规则继续生效：
> 墨色同取 1.21×，**明度不动**，故对比度漂移 ≤0.03。`--shadow-*` 的高光内嵌
> 随 ink 更新为 `rgba(237,231,224,…)`（17 处）。
>
> **墨色明度有意未动**，故正文对比是画布位置的因变量：抬画布后 13.96:1，
> 翻转让画布回落后 **14.67:1**（原 14.95，TN 10.59）。要往 TN 那个区间走必须
> 下调墨色明度，那会重开 07-25 的暖轴裁决，属于独立一轮。
>
> 品牌填充（`selected` / `brand-soft` / `brand-tint`）随阶梯抬明度，但 chroma
> 只做纯 L 补偿、**不吃 1.21×**——它们当初就没参与 0.6× 降暖，再乘一次等于给
> 从未降过的东西净加暖。

#### Chrome 的方向随主题翻转（2026-08-21 定案）

**规则不是「chrome 永远下沉」，而是「content 走极端、chrome 走中间调」。**
Light 的纸是近白的，所以 chrome 比它暗；dark 的画布是近黑的，所以 chrome 比它
**亮**。与 macOS 原生侧栏材质同理——那层材质在两个外观下都往中灰靠，因此相对
内容区自动反向。Dark 下 sidebar 因此读作**一层浮起来的材质**而不是一个凹陷，
这是 JC 真机裁决接受的 trade。

`--color-chrome` 与 `--color-app` 的**差值大小**（不论方向）决定这条规则实际
被看见的程度。当前值：

| | app | chrome | ΔL\* | 方向 |
|---|---|---|---|---|
| Light | `#faf9f8` | `#efeeec` | **3.85** | chrome 更暗 |
| Dark | `#191614` | `#1E1B17` | **2.46** | **chrome 更亮** |

Dark 的 2.2（OKLCH L）直接抄 Tokyo Night 的 sidebar↔editor 差值；light 的 3.85
是在近白端标定的，两端不共用一个数字。

Dark 侧的两条承重后果，**都是有意的、不要"修"**：

- chrome（L 22.4）与 `--color-surface`（22.7）基本持平，即 sidebar 与主区卡片
  共处同一明度带。这正是「浮起来的材质」的读法。
- 全局 `--color-hover` / `--color-selected` 是按主区阶梯标定的，在 chrome 上
  贴得太近而不可见——与 light 同病。Sidebar 通过 `.chrome-hover-scope` 覆写
  两者，取值就是**翻转前的全局值**（sidebar 的地面现在恰好等于翻转前的 app
  底，故按那个地面标定过的交互色原样成立）：`chrome→hover` ΔL\* 7.85、
  `hover→selected` ΔL\* 5.66，与主区的 7.95 / 5.67 几乎重合。

以下为这条规则的形成史（数值已被上表取代，保留论证）。

##### 2026-08-05：先把差值做出来

两个模式同批加深：

| | app | chrome 旧 → 新 | ΔL\* 旧 → 新 |
|---|---|---|---|
| Light | `#faf9f8` | `#f4f3f1` → `#efeeec` | 2.11 → **3.85** |
| Dark | `#161412` | `#12100e` → `#0e0c0a` | 1.66 → **3.04** |

起因：规则写在 token 注释里、但没落到视网膜上——旧的 ΔL\* 2.11 / 1.66 正好
压在恰可察觉阈值上下，两栏几乎同色。

**用 CIE Lab 的 ΔL\* 判断这个差，不要用 WCAG 对比度。** WCAG 公式的 `+0.05`
offset 是为文字可读性调的，在近白 / 近黑的大色块上会失真：旧值 light 记 1.055、
dark 记 1.033，两个近乎相同的数字对应的其实是可感知程度不同的差距。

标定：**ΔL\* ≈ 3–4 = 「一侧坐得靠后」**；**ΔL\* ≥ 8 开始读作两块独立面板**
（Slack / IDE 那种分区感），与 Galley 纸感安静的调性冲突。当前值取在这条带的
克制端，是有意的。

Dark 比 light 收得更紧（3.04 vs 3.85），当时的理由是：app 底已经是 `#161412`，
若追平 light 的差值会把侧栏推到接近纯黑，大面积近黑不再读作「一个面」而读作
「一个洞」。

##### 2026-08-21：加深反噬，先抬画布，再翻方向

`#0e0c0a`（OKLCH L 15.6）贴在地板上，真机读出来不是「洞」而是**重物**（JC：
头重脚轻）——上面那条自我收敛方向对、但收得不够。**先做的是不翻转的修法**：
整条阶梯抬 3.3 L 点、差值收到 TN 的 2.2，理由是 Tokyo Night（JC 日常主题）的
sidebar 同样比编辑区暗，方向从来不是问题（详见
[当日 devlog](../devlog/2026-08-21-dark-canvas-lift-and-chroma-reloosen.md)）。

**JC 真机 dogfood 该版本后仍要求对调**，于是 chrome 与 app 互换：chrome 取抬
画布后的 app 值（L 22.4）、app 取 20.3，阶梯保持内部步进随 app 下移 2.1，差值
2.2 不变、只换符号。画布净值 19.3 → 22.4 → **20.3**，仍比本轮起点高 1.0 点，
抬画布没有被撤销。

**已知代价（接受，非疏漏）**：正文对比 13.96 → **14.67:1**（抬画布前 14.95，
TN 10.59）。翻转必然让长文阅读面变暗；若日后读着发刺，解法是墨色那一轮，
**不是**把画布再抬回去。

复用禁令随之加强：chrome 属于 sidebar 材质层，会随这层关系被重调而移动
（08-05 加深、08-21 抬升并翻向——十七天内两次）。
不要因为灰度碰巧合适就借用——未点亮 / 惰性控件的填充属于 `--color-hover`
（Composer send 按钮的 disabled 态已于同日从 `chrome` 迁走）。

交互入口：

- TopBar 放 icon-only 外观按钮，固定在 Settings 左侧；状态类入口（Browser Control /
  Channels）在它左边，避免外观偏好的肌肉记忆随状态按钮出现而漂移。
  图标表达**当前实际主题**：浅色显示 `Sun`，深色显示 `Moon`。
- 点击弹三选菜单：`Monitor` 跟随系统 / `Sun` 浅色 / `Moon` 深色；菜单勾选
  当前偏好，tooltip/aria 显示“偏好 · 当前实际主题”。
- Settings 左侧底部放同一个 Appearance 菜单，和语言偏好并列；当前不新增
  General tab。
- 切换主题只做 120ms root opacity acknowledgement，首次启动不播放，
  `prefers-reduced-motion` 下禁用；不做全局 color transition，避免整屏拖影。

### 2.2 字体（方案 C：三 register）

#### 三 register（字体族）

`@theme` token：`--font-serif` / `--font-sans` / `--font-mono`。

| Register | Token | 字体（英 / 中） | 用途 |
|---|---|---|---|
| **Serif（被读）** | `--font-serif` | Newsreader / 苹方 · 雅黑（CJK 走 sans，见 2026-06-20 注记） | agent 回复、Markdown prose、少量品牌 / origin prose |
| **Sans（默认 UI）** | `--font-sans` | Inter / 苹方 / 思源黑体 | app chrome、按钮、菜单、metadata、session row、Settings / Dialog / Onboarding 功能标题 |
| **Mono（技术 ID）** | `--font-mono` | JetBrains Mono | shell 命令、路径、JSON、tool 名 |

#### 字号 scale

Galley 有两套**并行**的字号系统，分属不同表面，二者不互相引用：

**A. 对话阅读面 — 3-tier 运行时可调**

驱动：`gui/src/lib/conversation-font-size.ts`，MainView / EmptyState 根节点注入。
按 `small / standard / large` 三档整组缩放，让用户调阅读面而不动 chrome。

| CSS var | small | **standard** | large | 用途 |
|---|---|---|---|---|
| `--conversation-body-size` / `-leading` | 13.5 / 1.65 | **15 / 1.7** | 16.5 / 1.75 | agent + 用户消息 + goal 委派正文 |
| `--conversation-thinking-size` / `-leading` | 13 / 1.5 | **14 / 1.55** | 15.5 / 1.6 | italic thinking summary |
| `--conversation-step-size` | 11.5 | **12** | 12.5 | TurnMarker「第 N 步」 |
| `--conversation-tool-label-size` | 11.5 | **12** | 12.5 | tool callout head 标签 |
| `--conversation-tool-mono-size` | 10.5 | **11** | 11.5 | tool callout 次级 mono |
| `--conversation-code-size` | 12 | **13** | 14.5 | markdown 块代码（leading 固定 1.45，2026-07-05 新增） |
| `--conversation-echo-size` | 12.5 | **13** | 14.5 | 已答复 ask_user 的问题回显（降权阅读态，2026-07-05 新增） |
| `--conversation-heading-1-size` | 20 | **22** | 24 | markdown h1（Newsreader medium） |
| `--conversation-heading-2-size` | 17.5 | **19** | 21 | markdown h2 |
| `--conversation-heading-3-size` | 15.5 | **17** | 18.5 | markdown h3（故意接近正文） |
| `--conversation-heading-4-size` | 14 | **15.5** | 17 | markdown h4 |
| `--conversation-table-size` | 13 | **14** | 15.5 | markdown 表格 |
| `--conversation-goal-narration-size` / `-leading` | 12.5 / 1.55 | **13 / 1.6** | 14.5 / 1.65 | 线程内 Goal 旁白（降权） |
| `--conversation-composer-size` | 13.5 | **14.5** | 16 | Composer textarea |

**B. UI chrome 面 — 固定值 token**

`@theme` token（`--text-ui-*` → `text-ui-*` utility）。覆盖阅读面以外的所有 UI。
**新 chrome 代码用这些名字**；现存 ~436 处 raw `text-[Npx]` 在组件下次被触碰时迁移。
字号主题不变（dark mode 只翻颜色，不翻字号）。

| Token（utility） | 值 | 角色 | 代表位置 |
|---|---|---|---|
| `text-ui-compact` | 13px | 紧凑正文 / CTA / session row title / tool name | `SidebarSessionRow` title、`ToolCallout` name、`ApprovalDock` body |
| `text-ui-secondary` | 12.5px | 次要正文 / dialog 描述 / menu item | `Composer` dialog 描述、`SettingsIM` 次级正文 |
| `text-ui-meta` | 12px | metadata / hint / list item | `TopBar` hint、`PatchView` diff、list item |
| `text-ui-tertiary` | 11.5px | 三级 hint / tooltip / subline | `SidebarSessionRow` subline、tooltip、approval hint |
| `text-ui-label` | 11px | **eyebrow / section header**（uppercase，见下方配方） | sidebar 桶 header、`ConfiguredModelsPanel` eyebrow |
| `text-ui-micro` | 10.5px | uppercase chip / status badge / mono timestamp | code block 控件、`UserQuestionRail` 时间戳 |
| `text-ui-kbd` | 10px | 键盘提示 / 极小 eyebrow | `CommandPalette` kbd、`SidebarTimeline` header |

> **未来收敛候选**（不在本次范围）：`text-ui-kbd`/`-micro`/`-label`（10/10.5/11px）与
> `text-ui-meta`/`-tertiary`（12/11.5px）两簇间距 < 0.5px，dogfood 后可考虑各并成
> 一档；合并 = 改渲染值 = 产品判断，需单独评估，勿随手做。

#### 行高 tier

| Token（utility） | 值 | 用途 |
|---|---|---|
| `[line-height:var(--conversation-body-leading)]` | 1.7 | 对话正文（阅读面，随 tier 浮动） |
| `leading-code` | 1.6 | 代码块 |
| `leading-secondary` | 1.55 | 次要正文 / 二级信息 / Composer textarea |
| `leading-notice` | 1.5 | 提示 / error 块 / Epigraph |
| `leading-dense` | 1.45 | 密集 settings 行 / 三级信息 |

#### 字重

全 app 只用三档字重，没有 light/bold：

| 字重 | class | 角色 |
|---|---|---|
| **normal 400** | （隐式，omit weight class） | serif prose 正文（agent answer）。`font-normal` 几乎不用 |
| **medium 500** | `font-medium` | **dominant**。用户消息正文、CTA 标签、`**strong**`、session row title（默认态）、所有 prose heading |
| **semibold 600** | `font-semibold` | 结构性强调。**eyebrow / uppercase 标签**、session row title（active/unread/running 态）、dialog 标题、onboarding hero |

**agent 400 vs 用户消息 500 非对称**（2026-06-20 决策，勿为「统一」改）：同一 body-size 下，agent 正文 normal 400、用户消息 medium 500；配合 font-smoothing 不对称（agent `auto` / 用户消息 `antialiased`）双向补偿。详见下方 2026-06-20 注记。

#### Eyebrow 配方（唯一允许的 uppercase）

Galley 全 app 唯一高频复用的 uppercase 复合样式，~20 处，是 section-header 标准：

```text
text-ui-label(11px) + font-semibold(600) + uppercase + tracking-[0.08em]
```

变体：warning/system eyebrow 用 `tracking-[0.06em]`（`AskUserBubble` / `SystemMessageBubble`）；
桶 header 旁的计数用 `tracking-normal` 抵消（标签 tracked，数字不 tracked）。

**DESIGN.md §4.3 明令禁止**：headline / TurnMarker 不用 uppercase、不用 italic、不用 serif——
结构 metadata 冷静直立。

#### Serif kerning 签名

所有 Newsreader 表面带 `tracking-[0.005em]`（agent answer、markdown、wordmark、epigraph、
onboarding hero）。这是 serif register 的签名，sans / mono 不加。

#### 字号 / 行高（旧速查，已被上方表格取代，保留作对照）

- Body: 15px / line-height 1.7（= `--conversation-body-size` standard tier）
- Subtle: 13px / line-height 1.5（≈ `text-ui-compact` / `leading-notice`）
- Hint: 11px uppercase tracked（= `text-ui-label` + eyebrow 配方）
- Prose heading（Newsreader medium）: 20–24px（= `--conversation-heading-1-size` 三个 tier）

---

#### 设计注记（decision archaeology — 勿回退）

> 以下按时间保留字重 / 字号 / font-smoothing 的演化决策叙事。上方表格是当前
> 契约，这些注记解释**为什么**这么定、哪些「优化」已被否掉。

**2026-06-02 typography alignment:**

- `serif` 不再作为通用 UI 装饰字体。中文 / macOS 环境下，Newsreader / Inter
  只覆盖 Latin，CJK 会 fallback 到系统宋体 / 黑体；如果 UI chrome 到处切换
  register，用户会感到字体混用。
- Settings / Dialog / Onboarding 功能标题、Tool pill、Sidebar 状态、TopBar
  placeholder、空状态 action 等界面文本默认使用 Sans。
- 保留 `serif` 的场景必须是被阅读的 prose 或少量品牌语气：agent answer、
  Markdown headings / blockquote、`Galley` wordmark、About origin story。

**2026-06-09 字形渲染（font-smoothing）:**

- 全局 `body` 用 `-webkit-font-smoothing: antialiased`（灰度抗锯齿，偏细的"薄字"
  观感，统一 UI chrome）。
- **CJK prose 例外，且仅限浅色**：`MarkdownView` 在内容含 CJK 时给 prose 容器挂
  `data-cjk-prose`，globals.css 的
  `html:not([data-theme="dark"]) [data-cjk-prose]` 把它覆盖为
  `-webkit-font-smoothing: auto`。**深色不吃这条**，走全局 `antialiased`。
  - 起源（2026-06-09）：当时 CJK fallback 是 Songti SC（衬线），`antialiased`
    + 中文衬线在 macOS WebKit 下会把字形顶部削掉，换 `auto` 修复。
  - 现因（2026-06-20 CJK 改走苹方 / 雅黑后仍然保留）：苹方在 `antialiased`
    下笔画偏薄、边缘半透明化，长段落阅读发虚；`auto` 让笔画更实。
    agent 正文 / narration / thinking 是用户读字最多的区域，值得这一档。
  - 这是有意的**不对称**：agent 正文走 `auto`（笔画实），用户消息走全局
    `antialiased`（笔画薄）。同字体同字号同字重下，阅读面更 crisp、输入面更
    soft。dogfood（2026-06-20）验证过——两端都 `antialiased` 时 agent 正文太薄，
    两端都 `auto` 时对比被拉平，唯独这个不对称成立。**不要**为了"统一"去掉。
  - **限定浅色（2026-07-25，JC 真机验收）**：`auto` 在 macOS 上不是"次像素抗
    锯齿"——Mojave 已移除次像素渲染，`auto` 走的是系统 font smoothing 的**笔画
    膨胀**。膨胀对深字压浅底影响轻微，对**亮字压暗底**会和光学晕染叠加，于是
    深色下 agent 正文渲染得又粗又胀，读作"字体太亮"。症状的两个特征恰好就是
    这条规则的足迹：只在**主对话区**（用户消息不走 `MarkdownView`）、且只在
    **中文回答**时出现。上面 ①②的 dogfood 全部是在浅色下做的，这次是给它补
    上当年没做的主题条件。
  - **不要退化成"删掉这条覆盖"**：那个方案 2026-06-20 试过并被否（浅色下
    agent 正文太薄太虚）。浅色行为一字未改。
- 相邻问题：CommonMark 把 `名叫**"下一个字"**` 这类"`**` 紧贴 CJK + 引号"判为
  字面量；`MarkdownView` 的 `remarkCjkAdjacentQuotedStrong` 插件把这种 LLM 高频
  写法还原成 strong。

**2026-06-20 CJK 去 serif，全 app 中文统一到 sans:**

- 此前 `--font-serif` 的 CJK 落到系统宋体（macOS Songti SC / Windows
  SimSun）。Songti SC 字面偏紧、SimSun 在 Windows 上更差，且中文衬线
  与 Newsreader 的现代衬线气质不搭。曾尝试 self-host 思源宋体（Source
  Han Serif）做子集化替换，dogfood 后不满意——根因不是混排，而是
  serif 本身在 Galley 这种工具型 app 里不对味：agent 长段中文读起来
  像论文 / 古籍，和「干净、现代、专业」的目标调性错位。
- 决定 CJK 全部走 sans，`--font-serif` 的中文 fallback 改为
  `"PingFang SC", "Microsoft YaHei", "Source Han Sans SC"`——和
  `--font-sans` 同一套系统黑体。英文 prose 仍保留 Newsreader（拉丁
  衬线），形成「Latin serif + CJK sans」的混排，这是 Apple 自家页面
  和多数中文科技媒体的常用范式，读起来精致而非错配。
- 效果：主对话区的 agent 正文、用户消息、TurnMarker、工具标签全部
  统一到苹方（mac）/ 雅黑（win），不再有 serif/sans 中文 register
  切换造成的视觉碎裂。跨平台也更干净——mac 拿苹方、win 拿雅黑，都
  是各自平台最优的黑体。
- 连带决策（字号统一 + 字重非对称）：CJK 字体统一后，原 agent 正文
  16.5px 与用户消息 15px 的落差失去字体差异的遮蔽，显突兀。遂把字号
  拉齐到 **15px / line-height 1.7**。字重经 dogfood 多轮对比，最终定为
  **非对称**：agent 正文 **normal（400）**，用户消息 **medium（500）**。
  配合 font-smoothing 的不对称（agent `auto` / 用户消息全局 `antialiased`），
  两个区域用不同方式各自达到「恰到好处」：
    - agent 正文 = 细骨架（400）+ 实边缘（auto）= 清晰但不臃肿，宜长读
    - 用户消息 = 粗骨架（500）+ 柔边缘（antialiased）= 醒目但不抢戏
  两套机制反向补偿，不互相打架。对话双方靠用户消息的 apricot 色块
  （`bg-brand-tint` + 4px brand-strong 左条）区分说话方，不靠字号层级。
  `**strong**` 保持 medium（500）——正文 400 + strong 500 一档可见加粗。
  h1–h4 markdown 标题字号不动（结构层级该保留）。
- 上面的 2026-06-09 font-smoothing `auto` 覆盖**保留**，但依据更新：
  曾一度以为换苹方后该覆盖无用且有害（agent 正文比用户消息重），尝试
  删除；dogfood 反馈删除后 agent 正文太薄太虚——苹方在 `antialiased` 下
  笔画偏薄，长段落阅读需要 `auto` 的次像素渲染让笔画更实。遂加回。新的
  依据见上方 2026-06-09 注记的「现因」段：不再是 Songti 削顶 bug（衬线
  特有，已随去 serif 消失），而是苹方在 antialiased 下的偏薄问题 + 刻意
  的「阅读面 crisp / 输入面 soft」不对称。

### 2.3 Icon set

**Phosphor Thin** 全局唯一 icon set。

- 默认 16px stroke 1.25px
- 状态色随上下文（参考 §2.1 状态色）
- **不用 emoji 做状态指示**（跨平台渲染不一致 + 视觉太重）
- **Phosphor-only，产品无 emoji 锚**（2026-05-14 收回了原本 ThinkingSummary 的 💭 例外——bg-surface callout chrome + italic serif 已经足以标识 callout 块，不需要图标装饰）

### 2.4 圆角 / 阴影 / 间距

| Token | 值 | 用途 |
|---|---|---|
| `radius-sm` | 6px | inline element |
| `radius-callout` | 8px | inline callout / compact content block |
| `radius-md` | 12px | card |
| `radius-lg` | 14px | overlay (Command Palette) |
| `shadow-card` | `0 1px 2px rgba(31,27,23,0.04)` | 普通卡片 |
| `shadow-elevated` | `0 8px 24px rgba(31,27,23,0.12)` | 浮起卡片、Command Palette |
| `space-unit` | 4px | 间距基础单位 |

### 2.5 UI primitives

当前代码层的基础控件在 `gui/src/components/ui/`，新按钮 / 表单控件优先复用这些 primitive：

| Primitive | 用途 |
|---|---|
| `Button` | 文本按钮；variants: `primary` / `secondary` / `ghost` / `brand-soft` / `accent-secondary` / `warning` / `destructive` / `destructive-soft` |
| `IconButton` | 纯图标按钮；必须提供 `ariaLabel`，用于 close / toolbar / row actions |
| `DialogActionRow` | 弹窗底部 action 区，统一 `gap` / 对齐 |
| `Checkbox` | 带 label 的 checkbox 行，支持 `onCheckedChange` |
| `Switch` | 二元开关，支持 `brand` / `warning` tone |
| `SegmentedControl` | 小型互斥选项组，如 compact / wide |

`Button` / `IconButton` 默认带克制但**扎实**的实体反馈,有真实的键程(A 类反馈,见 §2.7):

- **hover**:干脆升 `1px`(整数,非亚像素)+ "firm"硬边阴影——planted,不上浮气球。
- **hover 一律瞬时**(2026-07-16):原生桌面惯例。hover 驱动的颜色 / 抬升 /
  阴影变化不走过渡,瞬间翻转——基础态没有 transition,过渡只存在于 `:active`
  上(见 Button.tsx 的 canonical pattern)。hover 淡入淡出是最典型的网页手感
  泄漏,全应用禁止。
- **press(active)**:沉 `2px` + `scale(0.97)` 压缩 + 投影塌成
  `--shadow-control-press` 深接触 inset(缝隙压没);下沉走 `--motion-press`
  (70ms)+ `--ease-firm`,松开随基础态瞬时回弹(原生 snap)。**不用 bounce /
  elastic**。
- **ghost / 文字按钮保持平**:只给极轻 `1px` press + 颜色反馈,不加阴影塌陷,把"重物理"留给主 CTA。
- 所有位移用整数像素;`*-hover` 阴影 token 一律 firm(紧软模糊,无 8–16px 气球)。

- `primary` / `secondary` / `brand-soft` / `accent-secondary` / `warning` /
  `destructive` / `destructive-soft`：可以有轻阴影和 hover lift。
- `ghost` / 文字链接 / session row / menu item：只给色块和极轻 active press，
  不加厚阴影，避免页面里所有东西都漂起来。
- disabled 控件必须静止，不保留 hover lift。

长任务反馈同样克制：普通等待不立刻读秒，3 秒后才在原状态行补充
elapsed 计数；60 秒后再补充 `仍在运行` / `Still running`。不要 toast，不要
banner，不要额外提示“可停止 / 可切后台继续”。

例外：Composer submit / stop、window controls、复杂 row trigger、Radix menu item 这类强语义控件可以保留局部实现，但颜色、字号、按下节奏仍应对齐 token。

### 2.6 Desktop WebView discipline

Galley 是桌面客户端，不应暴露不必要的网页线索：

- `html` 禁用 overscroll bounce；`body` 不出现整页滚动。
- 默认不允许随手选中 UI chrome，避免拖拽时出现网页蓝色选区。
- 交互 chrome（按钮、菜单项、列表行、卡片、展开头）一律用原生箭头光标，
  **禁止 `cursor-pointer`**——小手是超链接语义，只保留给真实的 `<a href>`
  外链；内容区域维持 `cursor: text`，disabled 维持 `cursor-not-allowed`。
- 图片与链接禁止浏览器拖拽幽灵影像（globals.css 全局
  `-webkit-user-drag: none`）。
- 页面缩放三层防御：`zoomHotkeysEnabled: false`（tauri.conf.json 显式断言）
  + Ctrl+wheel 拦截（Chromium/WebView2 的捏合缩放也走这条路）+ WKWebView
  `gesturestart/gesturechange` 拦截（useGlobalShortcuts.ts）。
- conversation markdown、用户消息、code block、input / textarea、路径 / key /
  error detail 等内容区域必须保留可选择文本。Galley 是工作台，复制内容是核心任务。
- 滚动条按平台分治：macOS 保持原生 overlay 滚动条，**禁止**写不带
  `html[data-platform="windows"]` 前缀的 `::-webkit-scrollbar` 规则——任何命中
  WKWebView 的该伪元素规则都会让 overlay 滚动条退化为常驻经典条。Windows 走
  globals.css 的 token 化细滚动条（`line-strong` 静止 / `ink-muted` hover /
  `ink-soft` active，随 `data-theme` 自动翻转），且**禁止**同文件添加标准
  `scrollbar-width` / `scrollbar-color`（Chromium 121+ 会静默禁用同元素的
  webkit 伪元素规则）。主滚动面板（转录 / 侧边栏 / Settings）用
  `.scrollbar-stable` 预留滚动条槽，防止 Windows 上内容跨溢出阈值时横移。

### 2.7 动效分类：触发反馈（A）vs 环境噪动（B）

Galley 的动效按“是不是用户触发”分两类，取向相反：

- **A 类 · 物理反馈**（用户交互触发、瞬时、有始有终）：按钮按下、提交确认环、
  行重排位移、展开/折叠、一次性 step tick / unread pop / 主题切换 fade。这类追求
  **扎实的物理真实质感**——可以有明确的下压深度和有重量的 ease-out 落定。A 类不是
  削减对象，必要时反而加强。
- **B 类 · 环境噪动**（无人交互、无限循环）：呼吸、脉冲、shimmer、逐字 opacity
  波浪、自走的高亮。这类制造“仪器在运转”的工具气质，与 Galley 要的安静人文气质
  相悖，默认删除或换成 A 类 / 功能性指示。

判断基线：**静止的界面 + 有分量的触觉反馈**。环境若确实需要 liveness，优先用
约定俗成的功能指示（旋转 loading、三点 working 指示、跳动的等宽计数器）而非装饰性
循环动效；每一处保留的 B 类动效都要能用一句话说清它传达的状态（“motion conveys
state, not decoration”）。`prefers-reduced-motion` 下 A/B 动效一律退化为静止或瞬时。

**唯一豁免（2026-08-12）：in-flight 状态文字的 shimmer。** thinking 行的工作
指示由三点改为状态文字上的扫光（`thinking-shimmer`），真机 A/B 裁决（见
devlog [thinking 计时器与 shimmer 裁决](../devlog/2026-08-12-thinking-timer-and-shimmer-verdict.md)）。
豁免论证：

- 计时器改为 0 秒起跳、0.1 秒精度后已是行内最强活性证明，三点成为第三个并列
  信号；shimmer 把动效折进本就存在的文字里，全行信号源从三个减到两个——按本节
  精神（安静、少仪器感）反而更收敛。规则字面与精神在此案冲突，精神优先。
- 在「LLM 正在思考」这一语义上，扫光标签已是 LLM 应用的约定俗成（Claude /
  ChatGPT 同款），符合上方「优先用约定俗成的功能指示」判据，且过得了一句话
  测试：光带扫过标签 = 模型正在生成。
- 它不是当年删掉的逐字 opacity 波浪：连续光带平滑扫过 vs 逐字符明暗跳动；且
  当年收敛的前提（计数器 3 秒后才出现、需要三点掩护空窗）已不存在。

豁免边界：仅限 in-flight 状态文字，一个视图至多一处（当前独占 thinking 行）；
骨架屏 / 容器 / 装饰性 shimmer 照旧禁止——被禁的是「装修等待」，被豁免的是
「指示进行中」。

> 已落地的 B 类收敛：thinking 态逐字波浪 → 三点指示 + 等宽计数器（2026-08-12
> 再裁决：三点 → 状态文字扫光 + 0.1s 计数器，走上方豁免）；running tool
> 左竖条呼吸 → 删除，running 态 liveness 改由 旋转图标 + 三点指示（`LiveDots`）+
> 每秒跳动的 elapsed 计数器承担（皆为功能性 / 信息性指示，非装饰循环）。其余 B 类
> （sidebar liveness rail、composer stop breath、approval / browser-control
> attention 等）逐个评估后再处理。

#### Motion tokens（2026-07-16）

时长与缓动收敛为 token（globals.css），**新代码禁止再写 duration / easing
字面量**：

| Token | 值 | 用途 |
|---|---|---|
| `--motion-press` | 70ms | 按压下沉键程 |
| `--motion-fast` | 120ms | 小型淡入淡出 / 图标旋转 / 开关滑块 |
| `--motion-base` | 160ms | 标准显隐（fade-in、弹层入场、展开） |
| `--motion-slow` | 240ms | 较大结构位移（行重排、树展开） |
| `--ease-firm` | `cubic-bezier(0.2,0,0,1)` | A 类反馈主力 ease-out |
| `--ease-pop` | `cubic-bezier(0.16,1,0.3,1)` | 弹层 / 内容入场 |
| `--ease-spring` | `cubic-bezier(0.34,1.2,0.64,1)` | 一次性注意 overshoot |

Tailwind 用法：`duration-(--motion-fast)`（var 简写——duration 没有 theme
namespace）、`ease-firm`（`--ease-*` 有 namespace，直接成为 utility）。

核心原则：**hover 驱动的变化没有时长**——hover 瞬时翻转（§2.5），token 只
服务状态驱动的动效（展开 / 显隐 / 位移 / 按压）。B 类循环的周期（呼吸 2.4s
之类）不属于这个刻度，按语义单独取值。

内容形状的加载面用 `Skeleton`（ui/skeleton.tsx）：轻呼吸占位、非 shimmer
（shimmer 是被禁的 B 类噪动），`prefers-reduced-motion` 下静止。只用于真实
内容将以同样形状落位的场景（会话冷启动恢复走 `ConversationSkeleton`、
Settings 模型列表）；动作型忙碌状态（探测 / 连接按钮）保留 spinner。
