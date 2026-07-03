# Galley DESIGN.md

> Status: **v0.2.0 — current implementation baseline**
> Last updated: 2026-06-24
> 2026-06-24（二）：§4.1 全宽 TopBar 拆解为双栏各自 header（`SidebarHeader` + `MainHeader`，原 `TopBar.tsx` 更名）。承接当日「标题左对齐」——左对齐后短标题落在 Sidebar 上方、长标题横跨分割线，暴露「一条全宽 bar」与「下方两栏」的结构错配。改为每栏 panel 内长出自己的 44px header，宽度天然继承、`ResizeSeparator` 全高分隔、两栏两色（chrome/app），OS 窗口控制各归本栏（Mac 红绿灯→SidebarHeader 让 ~78px；Win window controls→MainHeader 右上）。
> 2026-06-24（一）：§4.1 session title 由「居中」改为「左对齐」（已被当日「二」进一步演进为双栏 header）。
> 2026-06-23：§2.2 字体重构为表格化 typography scale——浮出已有的对话阅读面 3-tier token（`conversation-font-size.ts`），新增 UI chrome `--text-ui-*` / `--leading-*` token（`globals.css`），收拢 eyebrow 配方 / serif kerning / 字重 tier；旧散文注记移入「设计注记」小节保留。
> 2026-06-09：Conversation metadata 瑞士化打磨（TurnMarker / thinking 态 / ToolCallout），并新增 §2.7 动效分类原则。
> v0.1（dark-first / Linear 风）已被 v0.2 整体方向替换，Notion 历史稿仅作对照。
> 本文件以当前两栏 Galley GUI 为准：旧三栏 Inspector、独立 Settings window、Project emoji tree 等历史 spec 已退役。
> 决策叙事与 rejected alternatives 见 [docs/devlog/](./devlog/) 中 2026-05-07 / 2026-05-08 的设计相关 entry。

---

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

#### 基底层

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-app` | `bg-app` | `#FBFAF7` | App background，暖白（不是纯白，比旧奶油更轻） |
| `--color-surface` | `bg-surface` | `#FDFCF9` | 普通卡片底 |
| `--color-elevated` | `bg-elevated` | `#FFFFFF` | 浮起卡片（Health Check / Error / Command Palette） |
| `--color-overlay` | `bg-overlay` | `rgba(31,27,23,0.4)` | Command Palette / modal 遮罩 |

#### Elevation 不倒置（系统规范）

明度即抬升:`app (#FBFAF7) < surface (#FDFCF9) < elevated (#FFF)`,越浮起越浅。

> **规范**:任何"浮起"容器(dialog / menu / card)的**主体区 elevation 必须 ≥ 它自己的 chrome**,绝不更低。**不要把 dialog 主体刷成 `bg-app`**——那是画布(最低档),会让白色 header/footer 浮在一块更深的米板上,读成"头浅身深"的失衡。想表达"内容区下沉",只用**小块 inset**(勾选框、code/args `<pre>`、输入框),不要整片主体下沉。

落地:浮起 dialog 通体 `bg-elevated`,band 之间靠 `border-line` hairline + 行 `divide-y` 区分(结构靠线,不靠色块)。

例外:Settings 这类**满幅工作台式 modal** 通体 `bg-app`(画布)是有意为之——它不制造"白 chrome 浮在更深 body"的失衡(没有更浅的 header band 浮在上面),读作"设置即一块工作画布",卡片用 `bg-surface` 微微抬起。此例外也覆盖 `EarlierDialog` / `ArchivedDialog`(2026-06 调整)和 `PromptManagerDialog`(2026-06-29 调整):这些列表 / 资料库浏览 dialog 与 Settings 同属"用户进入工作的工作台"语义,为与 Settings 形成统一配色,主体/header/footer/列表/搜索栏底/操作栏通体 `bg-app`,搜索输入框 / prompt 卡片 / 编辑字段作为抬起的 `bg-surface` 对象配 `border-line`(与 Settings 的 model-filter 输入框一致);唯独其内的 per-row 确认小弹窗(delete-one / delete-many / empty-all)保留 `bg-elevated`,因为它们是 alert-grade 确认、不是工作台面,要与其余 app 的确认弹窗对齐。普通确认 / 设置项 dialog 仍按上面规范走 `bg-elevated`。

#### 边框 / 分隔（line 命名空间）

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-line` | `border-line` | `#EAE6DE` | 卡片边、divider 默认 |
| `--color-line-strong` | `border-line-strong` | `#D6CFC0` | hover 边、focus 边（非杏沙时） |
| `--color-line-subtle` | `border-line-subtle` | `rgba(31,27,23,0.06)` | 更弱的内分隔（如 modal / settings row 之间） |

#### 文字三档（ink 命名空间）

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-ink` | `text-ink` / `bg-ink` | `#1F1B17` | charcoal-warm，标题、主文本、主 CTA 填充 |
| `--color-ink-soft` | `text-ink-soft` | `#5C544A` | 次要文本、metadata |
| `--color-ink-muted` | `text-ink-muted` | `#8E867A` | hint、placeholder、timestamp |

#### 互动状态

| CSS variable | Utility | 值 | 用途 |
|---|---|---|---|
| `--color-hover` | `bg-hover` | `#F0EEE9` | 中性灰 hover（不抢戏） |
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
| `--color-warning` | `text-warning` / `bg-warning` | `#BF7A1F` | 深琥珀 warning（与杏沙拉开 13° 色相）。**只表示警示 / 注意**（YOLO、Stop、审批待处理、Browser Control 待连接），不作功能身份色——Goal 等功能用品牌杏沙，避免稀释琥珀的警示力 |
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
| `--color-app` | `#171411` | 暖黑 app 底 |
| `--color-surface` | `#1D1915` | 普通卡片底 |
| `--color-elevated` | `#24201B` | 浮层 / dialog / command palette |
| `--color-line` | `#332C25` | 默认边框 |
| `--color-line-strong` | `#4C4035` | hover / focus 边 |
| `--color-ink` | `#EFE7DC` | 主文本，不用纯白 |
| `--color-ink-soft` | `#C9BCAD` | 次级文本 |
| `--color-ink-muted` | `#958878` | hint / timestamp |
| `--color-hover` | `#28231E` | 中性 hover |
| `--color-selected` / `--color-brand-soft` | `#3A2D23` | 杏沙 tint |
| `--color-brand-tint` | `#4A3829` | 用户消息底（provisional，dark pass 再校） |
| `--color-brand` | `#D6A083` | 品牌主色 |
| `--color-brand-strong` | `#E2AE8D` | 品牌 hover / link |

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
- **CJK prose 例外**：`MarkdownView` 在内容为 CJK-dominant 时，把 prose 容器
  覆盖为 `-webkit-font-smoothing: auto`（macOS 上即原生次像素抗锯齿）。
  - 起源（2026-06-09）：当时 CJK fallback 是 Songti SC（衬线），`antialiased`
    + 中文衬线在 macOS WebKit 下会把字形顶部削掉，换 `auto` 修复。
  - 现因（2026-06-20 CJK 改走苹方 / 雅黑后仍然保留）：苹方在 `antialiased`
    下笔画偏薄、边缘半透明化，长段落阅读发虚；`auto` 的次像素渲染让笔画更实。
    agent 正文 / narration / thinking 是用户读字最多的区域，值得这一档。
  - 这是有意的**不对称**：agent 正文走 `auto`（笔画实），用户消息走全局
    `antialiased`（笔画薄）。同字体同字号同字重下，阅读面更 crisp、输入面更
    soft。dogfood（2026-06-20）验证过——两端都 `antialiased` 时 agent 正文太薄，
    两端都 `auto` 时对比被拉平，唯独这个不对称成立。**不要**为了"统一"去掉。
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
- **press(active)**:沉 `2px` + `scale(0.97)` 压缩 + 投影塌成 `--shadow-control-press` 深接触 inset(缝隙压没)。
- **时机不对称**:按下 ~70ms 快速到底、回升 ~140ms 落定;`cubic-bezier(0.2,0,0,1)` ease-out,**不用 bounce / elastic**。
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
- conversation markdown、用户消息、code block、input / textarea、路径 / key /
  error detail 等内容区域必须保留可选择文本。Galley 是工作台，复制内容是核心任务。

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

> 已落地的 B 类收敛：thinking 态逐字波浪 → 三点指示 + 等宽计数器；running tool
> 左竖条呼吸 → 删除，running 态 liveness 改由 旋转图标 + 三点指示（`LiveDots`）+
> 每秒跳动的 elapsed 计数器承担（皆为功能性 / 信息性指示，非装饰循环）。其余 B 类
> （sidebar liveness rail、composer stop breath、approval / browser-control
> attention 等）逐个评估后再处理。

---

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

### 4.3 Conversation 主区

#### Turn 结构

```
第 1 步                                          ← 直立 12px sans · tabular 数字 · hairline 分隔（结构 metadata）
[Thinking summary callout]                       ← 序列最前（仅在 GA 真实 emit <thinking> 时出现）
[Tool callout 1]                                 ← 行动序列
[Tool callout 2]
─────────────────                                ← 稍深 1px 全宽 hr（行动 → 结论）
[Final answer，浮在文档里]                       ← 不放 callout
第 2 步                                          ← 自带 mt-6 (24px) 的 chapter-mark，承担 turn 间分隔
[Thinking summary callout]
...
```

**没有 turn 之间的 SoftHr** —— TurnMarker 自带视觉重量 + 上方间距，承担 turn-to-turn 的章节分隔。不再有水平横线。

#### User vs Agent 三重区分（不用气泡）

| 维度 | User | Agent |
|---|---|---|
| 字体 | Inter 500 | Newsreader 400 |
| 字重 | medium | regular |
| 锚点 | 左侧 4px 杏沙竖条 + 杏沙底 `bg-brand-tint` + 右侧硬边（无圆角） | 无 |
| 对齐 | 左对齐 | 左对齐 |

不要 right-align 不要气泡 —— 这是文档区，不是聊天 IM。**用户消息是 callout 块，不是 bubble**：全宽对齐、左强边线、轻底色——参照 Markdown blockquote / Notion callout 的文档语法，而非 IM 单侧浮起。

长对话里这是用户**回找自己提问**的主视觉锚——杏沙底 + 品牌竖线让每个 user turn 成为滚动停靠点。AI 回复保持纯散文无底色，"提问（高亮锚）→ AI 回复（要读的内容）" 的层次随之建立。

#### Right Question Rail

主区右侧 rail 的首要职责是 **question index**：一颗 dot / 一段 cluster marker 对应一次或一组 user message，用来回跳提问。它不是第二个 Sidebar，也不是 session 状态队列。

- 少于 3 条 user message 时隐藏；3 条以上显示为右侧细 spine + dots / dense cluster。
- 历史 dots 永远只表达导航位置：active = brand filled，inactive = hollow ring，cluster = vertical capsule。
- 只有最新 tail marker 可以临时承载 live 状态：running 时 single dot 替换为 Sidebar 同源的 brand `CircleNotch` spinner；waiting（approval / ask_user 合并）时替换为 warning `PauseCircle`。状态结束后恢复普通 dot / cluster。
- 最新提问落在 dense cluster 里时，保留 cluster capsule 和 hover list，再叠加同源状态图标；不能让状态图标吞掉“这里是一组提问”的导航语义。
- 右 rail 不展示 subline / badge / row tint。状态文案只进入 tooltip / aria：`进行中` / `等你回应`。跨区记忆来自同一套状态图标语法，而不是把 Sidebar row chrome 搬进文档区。

#### Thinking Summary

- 每 turn 第一个 callout（仅当 GA 真实 emit `<thinking>` 内容时出现）
- 内容 = LLM 这一轮"打算做什么"的总结
- Newsreader italic 14px ink-soft，3px 中性 `ink-soft` 左竖条 + `bg-surface` 底 + 右 8px 圆角
- 无图标——typography + 容器 chrome 已足够标识 callout 块，2026-05-14 收回了原 💭 例外

#### Goal 叙述 callout（SystemMessageBubble `variant="goal"`）

Galley 在 Goal master 线程里讲述 run 进展的旁白（system row）。它是**次要的进行旁白，不是要读的答案**，层级应低于 agent answer。

- 早期设计是"满底 `bg-brand-soft` + 3px brand-strong 实条 + 大写加粗 brand 标签 + bold 图标"，使它成了整个对话区最重的块，反倒压过用户消息和 agent 正文（层级倒挂），多条堆叠还会连成一堵 brand 墙。
- **2026-06 降权**：去掉满底色与横幅化标签，只留**一条细 brand 左规线**（`border-l-[3px] border-brand-strong/30` + `pl-4`，无底色无右圆角）+ **一个无字的小 `Target` 图标**（thin 11px）作 register 标记，正文经 `MarkdownView variant="agent"` 但 `[&_p]/[&_li]` 降到 `text-ink-soft`。读作页边批注，而非横幅。
- **「Galley」不再逐条显示**：每条都重复这个词是零信息的 chrome；归属改挂到 Target 图标的 `aria-label`（沿用 `goalNarration` 文案），读屏仍可念出，视觉不啰嗦。保留图标而非裸到只剩左规线，是为了和 agent 正文里的 markdown blockquote（同为 brand 左条 + 斜体 ink-soft 衬线）区分开。
- **身份由 run 两端的章节框承担**：Goal 委派标记（开场）+ 收口标记（终态）扛起"这是一个 Goal"的 brand 身份，中间的叙述因此可以退回安静旁白。连续叙述簇只在**首条**显示 Target 图标（`SystemMessageBubble` 的 `showGlyph`，由 `annotateGoalThread` 的 `narrationLeading` 驱动），多 beat 的 run 不再每行重复标记。

#### Goal run = 线程内插曲（章节框）

一条 master session 的线程可先后承载**多个 Goal run**（session 复用自身 id 作每个 goal 的 master），中间还会夹普通对话。所以不做"会话级 Header"，而是把每个 run 括成一段**插曲**：开场 = 委派标记，结尾 = 收口标记，中间是该 run 的叙述。单 goal 就是一段干净的头尾，多 goal 自动分段，同一套规则。

- **委派标记（`GoalCommissionMarker`）= objective user message 的加冠版**：它本就是用户在 Goal 模式下发送的第一条消息，保留 user DNA（4px brand 竖条 + `bg-brand-tint` + 硬右边 + Inter medium，就是用户的话），头上加一行 eyebrow：`Target + Goal`（brand 大写字距）+ 右侧直立 tabular 参数（`N 个 Agent · 预算 Xm · 写入模式`）+ 一个粗粒度状态徽标。这同时解决了"objective 被当普通气泡"和"Composer 两种寄存器结果不可辨"——普通发送=普通气泡，Goal 发送=委派标记。
- **收口标记（`GoalTerminalMarker`）= run 终态留痕**：`✓ 已完成 / ✕ 失败 / ⏸ 已停止` + `用时 Xm` + 一条 hairline + 操作（`查看结果`/`查看详情` 走 `onOpenGoal`；`产出文件夹` 在有 `workspacePath` 时直接 `revealItemInDir`）。让结果沉淀在对话里，而非划过即逝的 toast；goal 即使已 `result_seen` 从 active 列表移除，回看仍在。
- **live 归外围**：实时倒计时 / worker 明细 / 停止仍只在 TopBar pill；章节框只在粗粒度状态转变时变（开始 → 进行中 → 终态），不做每秒 ticker（与 §2.7、sidebar/epigraph 的"live 归外围 chrome"一致）。
- **数据与关联**：标记数据来自只读命令 `list_goals_for_session(masterSessionId)`（全状态，含已读终态）。`annotateGoalThread`（`lib/goal-thread.ts`）用 **objective 文本 + `startedAt ≈ createdAt`** 启发式把 goal 关联到对应的 objective user-turn（消息行不持久化 goalId，恢复后靠此重建）；未命中则优雅退化为无标记的（仍降权的）叙述。run 的收口标记落在其叙述簇之后、后续普通对话之前。

#### Markdown 渲染

Final answer 跟 Thinking summary 都通过 `react-markdown` + `remark-gfm` + Shiki 渲染。LLM 输出的 markdown（标题 / 列表 / 表格 / 代码块 / 引用 / 链接 / 删除线）全部解析成对应 DOM，没解析的纯文本走默认段落。

**typography 映射**（每个元素 pull 现有 token，不引入新字号）：

| markdown | 渲染 |
|---|---|
| `p` | 15px normal / line-height 1.7（Latin Newsreader, CJK 苹方·雅黑）`agent` / 14px italic muted `thinking` |
| `h1` | Newsreader medium 22px |
| `h2` | Newsreader medium 19px |
| `h3` | Newsreader medium 17px（故意接近正文，避免视觉跳跃） |
| `h4` | Newsreader medium 15.5px |
| `ul` / `ol` | 标准缩进，`::marker` text-ink-muted |
| `li` | 紧 paragraph 形态（list 内 `<p>` margin 0） |
| 行内 `code` | mono 0.86em + bg-hover 浅底（pill） |
| 块代码 ` ```python ` | 详见下方 Shiki 段 |
| `blockquote` | 左 3px brand 竖线 + italic + ink-soft |
| `a` | text-brand-strong + 1px 下划线 + 安全 _blank |
| `table` (GFM) | `overflow-x-auto` 容器 + border-collapse + th `bg-surface` + 单元格 padding 12px×8px |
| `hr` | 1px line + my-5 |
| `strong` | font-medium（正文 normal 400，strong 500，一档可见加粗） |
| `em` | italic |
| `~~del~~` (GFM) | line-through ink-muted |
| `![alt](url)` | `https://` 与绝对本地 raster 图片（png / jpg / jpeg / webp / gif）内联预览；本地路径支持 macOS/Linux 绝对路径、Windows drive path、`file://`；相对路径、`http://`、`data:`、`svg`、加载失败降级为图片链接 pill |

**视觉哲学**：每个 markdown 元素 reuse 现有 Newsreader / Inter / JetBrains-Mono token，不为 markdown 单独引入字号 ramp。整段对话读起来是一个 document，不是 stylesheet 拼贴。

#### 代码块语法高亮（Shiki）

- 引擎：[Shiki](https://shiki.style) v1+，TextMate grammar，跟 VS Code / Claude.ai web 同款
- 主题：跟随 Galley 当前主题，light 用 `github-light`，dark 用 `github-dark`
- 注册语言（hand-picked）：`bash` / `css` / `diff` / `html` / `javascript` / `json` / `markdown` / `python` / `rust` / `shell` / `sql` / `tsx` / `typescript` / `yaml` —— 14 种 coding agent 用户高频
- 别名：`js → javascript` / `ts → typescript` / `py → python` / `rs → rust` / `sh → bash` / `yml → yaml`
- 未注册的语言：fallback 到无色 mono code block（同样的 chrome，仅没 token color），不报错
- async render：第一次 highlighter 加载时显示 plain mono fallback，加载完替换；同 highlighter 实例 cache，跨 code block 共享
- 视觉容器：**无顶部 header 行**。圆角 6px + `border-line-strong` + 底色 `--color-code-surface`（内凹暖灰，见下方决策）。语言名 + copy/wrap 控件浮在**右上角**：语言名常驻（dim 10px mono uppercase，`text`/`plaintext` 等无信息语言名不显示），copy/wrap 在 hover 时 fade-in，三者都带 `bg-code-surface/85` backdrop 以压住底下的代码。
- 默认横向 overflow scrollable；hover/focus 可切到 wrap 模式，便于读日志、错误栈、长命令

**Copy 按钮**：hover-revealed（11px Phosphor `Copy` thin + uppercase "Copy"，复制后变 ✓ + "Copied" 1.5s），复制内容是**纯代码**——不带 ` ``` ` fence、不带 markdown chrome。Claude.ai / ChatGPT / Cursor 的肌肉记忆位置。

**2026-06 密度与分离 pass（决策留痕，勿回退）**：

- **去掉顶部 header 行**：它占一整行；当语言名被抑制（`text` 等）时只剩一条死白带。改为右上角浮动控件后，框身就是代码本身。语言名挪到右上角而非左上角，是因为代码顶格起排，左上角标签会压在第一行字上。
- **紧凑间距**：正文 `py-1.5` + 代码 `leading-[1.45]`，并**显式归零** `pre`/`code` 的 margin/padding（`[&_pre]:m-0 [&_pre]:p-0` 等），堵住 Shiki / UA 行盒漏进来撑高单行块的纵向空白。
- **首尾空行裁剪**：按行剥掉围栏内容的首尾空白行（兼容 `\r\n`），LLM 常带的前导空行不再渲染成框内浪费空间（`trimCodeBlankEdges`）。
- **底色方向（关键，别再"优化"回去）**：代码要读作"嵌进纸里的另一种介质"，所以 `--color-code-surface` 必须**比页面 `--color-app` 暗**、与行内代码 `--color-hover` 同族（亮 `#f3f0e9` / 暗 `#221d18`）。曾经用过的比纸更白的 `bg-surface` 会让代码框糊进对话流、几乎不可辨——这是被明确否掉的方向。

V0.1 不做：代码块行号 / Edit 在行内（V0.2 候选）。

#### Message Actions（reply 级行动条）

每段 agent final answer 下方常驻一行 muted 行动条（DESIGN.md §4.3 dogfood 反馈：用户经常想保留 reply 内容）：

| 按钮 | 行为 |
|---|---|
| `Copy` | 复制原始 markdown source（带 `**bold**` `## headers`），不是渲染后纯文本——用户粘贴目的地（Notion / Obsidian / Slack / 邮件）多数能 re-render markdown |
| `Save` | Tauri save dialog → `.md` 文件。默认文件名 `ga-{YYYYMMDD-HHmmss}.md`，用户可改 |

**复制入口统一（`ActionChip`）** —— 按"常驻 vs 触发浮现"两类组织，全部共用一个
`ActionChip`（Copy thin 14px → Check success，1.5s 回落，quiet 1px press）：

- **常驻**：assistant 回答末尾的 reply 行动条（`Copy` + `Save`），bare chip、贴答案
  下方左对齐、一直可见。
- **触发浮现**：用户做动作才出现的复制，统一为 `floating` 变体（实底 `bg-elevated`
  + `border-line` + token 投影，非 glassmorphism），贴相关内容浮出：
  - assistant 里**选中**文字 → 浮在选区旁（gutter）
  - user 消息上 **hover** → 浮在杏沙块**右上角**（覆盖在块上，归属无歧义；块留
    `pr-10` 横向余量、chip 不压字；不占布局、不碰 turn 间距）

一条规则统摄：**常驻操作在回答末尾的 bar 里；触发式复制是一个浮动 chip，贴触发的
内容浮出。** bar 里用 bare chip，浮动的用 floating chip。

视觉：

- 位置：reply markdown 渲染**正下方**，gap 8px (`mt-2`)
- 字号 12px Inter + 13px Phosphor thin icon
- **常驻可见**（不 hover-only），text-ink-muted；hover 升 ink-soft + bg-hover
- 点击后 0.5s 内 icon 变 Check + 文字变 "Copied" / "Saved"，1.5s 后回 idle
- success 反馈用 `text-success`（绿色 token）

工程：
- Copy 走 `navigator.clipboard.writeText` web API（Tauri webview 支持）
- Save 走 `@tauri-apps/plugin-dialog` `save()` + `@tauri-apps/plugin-fs` `writeTextFile`
- Capabilities 加 `dialog:default` / `fs:allow-write-text-file` + `fs:scope` 限制到 `$HOME` / `$DOCUMENT` / `$DESKTOP` / `$DOWNLOAD`（保留用户常去的目录）

V0.1 **不做**：

- **Regenerate 按钮**：需要 GA history 回滚 + 跨 turn 状态管理，工程量大；推后到 V0.2 跟 multi-session / session 恢复一并设计
- **Continue 按钮**：用户自己输入"继续"即可，不需要专用按钮
- **Pin / 收藏**：需要数据模型扩展，V0.1 单 session 不值
- **Branch（从这里分叉新 session）**：跟 multi-session 深度耦合，V0.1 没法做
- **TTS / 翻译 / Share**：依赖外部服务，跟产品定位不符

ReactNode children（非 markdown string）的 reply 不渲染 actions——demo fixture 没 markdown source 可复制。

#### Scroll behaviour（stick to user message top）

Conversation 主区是 `overflow-y-auto` 的列。用户提交新消息时**不**滚到底部（reply 还没生成，跳到一片空地）；**也不**被动什么都不做（user message 出现在视口外，看不到反馈）。**正确做法**：把刚 submit 的 user message 顶端贴到 viewport 顶部下方 32px 处。

跟 Claude.ai / ChatGPT 收敛的同一模式。理由：

- 用户提交完立刻能看到自己的提问
- 长 reply 不会推走问题——问题永远在视口顶端附近
- 短 reply 用户也不必往下找答案——它就在问题正下方
- 阅读 reply 期间**不被打扰**（不跟随）

实现细节：

- store 加 `userSubmitTick` 计数器，`appendUserTurn` 时 +1
- MainView `useEffect` 监听 `userSubmitTick` 变化（不监听 `turns.length`——避免 `turn_end` 也触发滚）
- RAF 推迟到 `<MessageUser data-role="user-msg">` 真实 mount 后
- 找最后一个 `[data-role="user-msg"]`，算 offset (`top - container.top - 32`)，`container.scrollBy({ top: delta, behavior: "smooth" })`
- 不用 `scrollIntoView({block: "start"})`：它没法控 padding

边界：

| 场景 | 行为 |
|---|---|
| 第一次提交（EmptyState → MainView 切换） | 同样滚一次（保险，user message 已经在顶部时 delta 接近 0，相当于 noop） |
| `turn_progress` chunk 流入 / `turn_end` 来 | 不触发（store 状态变了但 tick 没变） |
| 用户主动向上翻历史 | 不打断（仅 submit 触发） |
| 切换历史 session（multi-session 后） | 默认滚到底（看到最后 turn）；不属于此 spec 范畴 |

#### Streaming generation（流式 partial 渲染）

Bridge 订阅 GA 的 `display_queue`（`agentmain.put_task` 返回），把每个 partial chunk 通过 IPC `turn_progress` event 推给 desktop。这里的流式单位是 GA display_queue chunk，不是 token-level 合约；desktop 累积成 `inFlightContent`，跑 `cleanPartialContent` strip 掉 GA 内部 tag 后用 `MarkdownView` 实时渲染，并可用本地 typewriter 平滑 chunk 间隔。

| 时机 | 显示 |
|---|---|
| User 提交 → bridge spawn → LLM TTFT | `第 N 步 · 思考中` TurnMarker（thinking 态） |
| 第一批 chunk 到 | placeholder 消失，partial markdown 开始流出 |
| 流式过程中 | partial 持续增长，Markdown re-render（行内 / 列表 / 代码块都跟着出现） |
| `turn_end` 到 | partial 被 finalized AgentTurn **替换**（store `appendAgentTurn` clear inFlightContent） |
| Tool call 触发 | partial 暂停，Approval Card 出现 |
| 用户决策后 → bridge 继续 → 下一 turn | 新 turn 的 partial 重新开始流（store `turn_start` clear inFlightContent） |

**关键 robustness**：partial 输入是 GA-raw（`<thinking>` / `<summary>` / `<tool_use>` / `<file_content>` / `[FILE:...]`），且**可能 mid-tag**（比如刚收到 `<thi` 没 close）。`cleanPartialContent` 的 4 步算法：

1. Strip 完整的 `<tag>...</tag>` block
2. 找 leftmost unclosed open tag → 截断
3. 找 trailing partial open-tag start（"<thi" / "</sum"）→ 截断
4. Strip `[FILE:...]` refs + 折叠空行

效果：用户在任何 sampling instant 都看不到 GA 内部 scaffolding 闪过。

#### Sticky-bottom + Scroll-to-bottom 浮动按钮

- 流式过程中**默认跟随**：`atBottom` flag 通过 scroll listener 维护（24px tolerance），在底部时 `useLayoutEffect` 监听 `inFlightContent` 变化把 `scrollTop = scrollHeight`
- **用户向上滚 → 不跟随**：`atBottom = false`，stream 继续但视图不动
- **浮动按钮**：`atBottom = false` 时 conversation 列右下角（Composer 上方 140px）出现一个 36px 圆形 ghost 按钮，⬇ ArrowDown thin icon
- 点按钮 → `scrollTo({ top: scrollHeight, behavior: "smooth" })` + `atBottom = true`（重新启用跟随）
- ESC / 任何手动 wheel 不影响按钮可见性（仅 scroll position 决定）

#### Thinking Placeholder（in-flight 占位）

用户提交消息后到 `turn_end` 到达之间存在显著延迟（LLM TTFT 可达几秒到十几秒）。如果不显示状态指示，用户会觉得 UI 卡住。

- 用户提交瞬间 store 设 `agentRunning = true`（不等 `turn_start` IPC，避免一次往返延迟）
- conversation 末尾立即渲染 `TurnMarker` 的 thinking 态：单行直立 12px ink-soft，内容 "第 N 步 │ 思考中" + 三点 working 指示（`LiveDots`）；不再用逐字 opacity 波浪
- 触发条件：`agentRunning && pendingApprovals.length === 0 && !visiblePartial`
- `turn_end` 到达时占位消失，真正的 AgentTurn（含同一个 step number 的 TurnMarker + tools + final answer）一次性渲染替换。**before/after 视觉一致**——同一个 TurnMarker 组件的两态，用户感受到的是一个步骤的进展，不是两个独立的 UI
- **等待 ≥ 3 秒时显示 elapsed 计数，≥ 60 秒后追加仍在运行**——立即显示读秒会
  太机械，但 5 秒空等又明显让人产生等待感；3 秒是当前 dogfood 后的中点。
  `仍在运行` 是更强的长等待确认，只在 60 秒后出现，避免前一分钟显得啰嗦。
  Caller 用 `key={currentTurnIndex}` 让每步独立计时（step 1 等 40s，step 2 时钟归零）
  - `0-2s` → `思考中` + 三点指示
  - `3-59s` → `思考中` + 三点 · `32 秒`（tabular 等宽）
  - `60s+` → `思考中` + 三点 · `已 1 分 23 秒` · `仍在运行`

历史设计（已废弃）：原本占位走 ThinkingSummary callout（bg-surface + 左竖条 + 💭 emoji），跟正式 ThinkingSummary 块视觉同款。问题是 callout chrome 是给"GA 真实 emit `<thinking>` 多段内容"设计的容器，套在 10 字占位上视觉权重严重失衡。2026-05-14 改成 TurnMarker thinking 态。

Composer 状态同步：`agentRunning = true` 时 Submit 按钮切到 Stop 模式，LLM dropdown disable。

#### Turn 编号 + 间距

**不是**用户↔agent 对话轮次，**是 GA 内部 agent loop 的 turn 计数**——每次 LLM call + dispatch = 1 turn。一个 user message 可以触发 GA 跑 N 个 turn（agent 不断 reflect + 调 tool 直到出 final answer）。这跟 PRD §7.5 sidebar session row 显示的 "Turn N · summary" 同一个 N。

- 数据来源：每个 IPC `turn_start` / `turn_end` event 都带 `turnIndex` 字段
- AgentTurn type 持有 `turnIndex`（一个 user message 在 conversation 里可能产生多个 AgentTurn）
- 渲染：每个 AgentTurn 的 thinking summary 之上一行，`第 N 步`（`copy.conversation.step`）12px 直立 sans `text-ink-soft`，`tabular-nums` 数字作结构锚点；与 summary 之间用一条 `w-px bg-line-strong` 竖向 hairline 分隔（瑞士结构感，取代旧的 ` · ` 中点）；`mt-6`（24px）上方间距承担 turn 间章节分隔。**不用 italic、不用 serif、不用 uppercase tracking**——结构 metadata 冷静直立，与下方 Newsreader 衬线正文形成对比张力
- in-flight 状态：`currentTurnIndex` 从 `turn_start` 读取；thinking placeholder 顶部也显示 `Turn N` 标记让用户感知 agent 当前跑到第几迭代
- `run_complete` / `error` 时清空 currentTurnIndex
- **没有 turn 之间的 SoftHr**——TurnMarker 自带 chapter-break 视觉重量，水平横线已删除

#### 间距演化历史

`turn 间分隔`经过四次调整：

1. v0.1 初版：SoftHr `my-9`（72px）—— dogfood 反馈"每个 turn 浪费 1/3 屏"
2. SoftHr `my-6`（48px）—— 仍反馈"还是大"
3. SoftHr `my-5`（40px）—— 仍反馈"还是大"
4. 删除 SoftHr，TurnMarker `mt-7`（28px）+ tracking 加大承担分隔
5. **现行（2026-06-09 瑞士化）**：直立 sans + tabular 数字 + 竖向 hairline 分隔，去掉 italic 与 uppercase tracking。间距曾短暂提到 `mt-9`（36px），但实测 turn 间隙 ≈ 42px 又触到当年被拒的 SoftHr `my-5`（40px）量级；dogfood 后一路收到 `mt-6`（24px）。结论：瑞士 marker 自带分隔力，结构清晰度承担分隔，不需要靠大留白

教训：当用户反复反馈"间距大"时，缩 hr 到极小已经不是答案；该思考"分隔信号"是不是必须靠 hr 承担。结果：TurnMarker 的章节标识 + 间距 + 字号已经足够。

### 4.4 Composer

#### 视觉

- **杏沙 focus ring**（`brand` token）
- 圆角 12px / `surface` 背景 / 默认 1px `border-default`
- 上方留 1.5em，下方贴 viewport bottom（in-session）或居中（empty state hero）
- + icon 占位（V0.2 接 attach）/ Submit 按钮

#### Submit 按钮（杏沙 CTA 例外）

- **Submit 是全局唯一用杏沙作为 CTA 填充的元素** —— 用户最高频元素，杏沙带来"亲和体温"
- Phosphor `ArrowUp` thin / 32px circle / 杏沙填充 / charcoal icon
- Enter 触发，Shift+Enter 换行
- agent running 时**位置替换为 Stop 按钮**（深琥珀填充 / Phosphor `Stop` thin），点击触发 abort

#### 常用提示词入口（V0.2.16）

位置：**Composer 内部右下角**，放在图片附件按钮左侧。常用提示词属于
「往输入框添加内容」的工具，和添加图片同组；LLM picker 属于模型选择，
不和它绑定。

- 形态：Phosphor `BookmarkSimple` thin icon，icon-only，32px 圆形 hit target；
  无边框 / 无底色，hover 才出现 `hover` tint，与图片附件按钮同视觉族。
- 点击图标直接打开提示词库 dialog；hover 只显示统一 Radix tooltip，不再打开
  quick-fill popover，避免鼠标擦过 Composer 工具区时误弹大浮层。
- 内置预设共 8 个，按大众用户使用频率从高到低展示：信息查证、整理长文、
  翻译润色、审阅草稿、网页内容提取、整理表格、本地文件整理、执行前检查清单。
  预设是固定目录，顺序固定、只读，不可置顶或排序。
- 常用提示词入口采用 pointer-first，不进入键盘 Tab 顺序，也不显示 focus ring；
  避免桌面 WebView 把焦点态误读成“选中”。
- Dialog 顶部不显示可见副标题；尺寸约
  `920x680`，读作 Settings / Earlier / Archived 同族的工作台，而不是小确认窗。
  主体为工作台式 `bg-app` 画布 + 卡片平铺，分两个 group：上方「预设」（常驻
  可折叠的模板库，固定顺序），下方「自定义」（用户可上移 / 下移调整顺序）。
  整张卡片点击即预填 Composer，不自动发送；hover 卡片时显示查看 / 管理按钮。
- 卡片只承载摘要：标题 + 4 行正文预览。需要看完整 prompt 时，hover 点“查看”
  进入同一 dialog 内的完整阅读页；阅读页提供返回、填入输入框，以及预设复制为
  自定义 / 自定义编辑。
- 卡片管理动作按 group 分：预设只读，可复制为自定义；自定义可新增、编辑、删除、
  上移 / 下移调整顺序。复制预设或新增自定义后，新项落在自定义列表最前并短暂
  高亮、自动滚到该卡片。
- 数据存在 GUI prefs `saved_prompts_v1`（schemaVersion 2），只保存用户自定义
  prompt；内置 preset 不写入 prefs，随 UI 语言本地化。没有置顶 / pinnedIds
  概念——早期版本的置顶机制在首次发布前移除，pinnedIds 字段一并删除，旧 prefs
  落到 v2 默认值（空自定义）。
- 若 Composer 已有非空草稿，选择 prompt 先确认再覆盖；图片附件保留，
  paste-fold registry 重置。
- 首版明确不做：分类、搜索、变量、使用次数 / 最近使用排序、import/export、
  cloud sync、Agent API / CLI surface。

设计判断：这是高频便利入口，不是新手能力发现模块；因此它留在 Composer 工具组，
不回到 Empty State 下方的 quick prompt 建议。

#### LLM 切换器（V0.1）

位置：**Composer 内部左下角**。

- 形态：LLM displayName + `CaretDown` thin。模型名本身已承担语义，不再显示
  Cube icon。
- Ghost button / hover `hover-tint` / 13px Inter / 28px 高
- 点击展开 popover：
  - `surface-elevated` 背景 + `shadow-elevated`
  - 圆角 12px / 内边距 8px / 每行 32px
  - current 项右侧杏沙 ✓
  - 切换中 `Check` 替换为 `CircleNotch` 旋转
- agent running / waiting approval 时 disabled，hover 显示 tooltip "Wait for the current run to finish"
- LLM list > 8 时加 scroll
- displayName 由 bridge 按 runtime 边界生成：external GA 显示完整 raw name；managed GA 显示 Galley Models 里的显示名或原始 model id（详见 IPC 协议）

#### 不显示

Context Window / 价格 / token estimate（V0.1 拿不到 + 信息噪音）

### 4.5 Tool Event Callout

#### 视觉（像 Notion callout，不像 stdout log）

每个 tool call 是独立 block：

- **左侧 3px 状态色竖条**（静态，不呼吸）+ **1px `border-default`** + **12px 圆角**
- **不用 background tint**（暖米白底上太花）
- 16px Phosphor thin icon + tool name（mono）+ status pill + elapsed（`tabular-nums`）+ `CaretDown`
- 内边距 16px / 上下 margin 12px
- 容器状态切换只过渡颜色（`transition-colors`），不动布局属性

#### 6 状态映射

| 状态 | 左竖条色 | icon | 默认折叠 |
|---|---|---|---|
| running | 杏沙 `brand`（静态） | `CircleNotch` 旋转 + 三点 `LiveDots` + 每秒跳动 elapsed 计数器（`14s`/`1m 2s`，运行满 1s 显示） | 当前 step 默认展开 |
| success-current | 杏沙 | `CheckCircle` | 当前 step 默认展开 |
| **success-historical** | **几乎不可见**（融入背景） | `CheckCircle` muted | **默认折叠** |
| waiting_approval | 深琥珀 | `Pause` | **强制展开**（不可折叠） |
| failed | 深红 | `X` | **强制展开** |
| denied | muted | `Prohibit` | 折叠（结果已知，不重要） |

#### 展开内容

- **args preview**：mono 等宽，syntax highlight
- **stdout / progress**：mono 等宽，scroll 区域 max 200px
- **result preview**：折叠 raw JSON 链接

### 4.6 Approval Dock + Approval Card

#### Approval Dock（Composer 上方 sticky）

- **仅在有 pending approval 时存在**（不是 hide，是不渲染）
- warning 琥珀浅 tint 背景（`bg-warning/[opacity-subtle]`）+ 3px 深琥珀左竖条 —— 待审批是 caution 态，统一归到琥珀；杏沙留给功能与「已通过」正向态
- 单行：`{count} pending approval · Next: {tool_name}` + Advance button
- **不可 dismiss**（必处理状态必须 surface）
- hover 显示 tooltip 预览
- 决策仍必须在对应的 callout 内做（dock 是 navigator，callout 是 decider）

#### Approval Card（waiting_approval 状态的 inline form）

**不是独立组件**，是 Tool callout 的 waiting_approval 形态。展开后内嵌：

- **风险等级 pill**：high（深红）/ medium（深琥珀）/ low（muted）
- **动作说明**：1 行人话 ("Run shell command" / "Patch file at /path")
- **目标对象 / 工具特定渲染**（见下）
- **为什么需要审批**：1 行 muted 文案
- **四个按钮**（Phosphor icon + label）：
  - Allow once（charcoal primary）
  - Deny（深红 ghost）
  - Always allow in this Project（杏沙 ghost）
  - Always allow globally（杏沙 ghost，high risk 工具如 `start_long_term_update` disabled）

#### 工具特定渲染

##### `file_patch` — split diff 视图（V0.1 必做）

- **V0.1 实现**：自研 PatchView（`diff` npm 包计算 line-level changes + Tailwind 渲染 split layout），无语法高亮
- 数据来源：`args.path` / `args.old_content` / `args.new_content`（GA `file_patch(path, old_content, new_content)` 签名）
- 视觉：
  - Header：path（mono）+ 文件 size delta（`+12 / -3 lines`，13px muted）
  - Split layout（左旧右新）/ 行号显示
  - +/- 行用 success/error 8% tint 背景；空 placeholder 行用 hover-tint 斜纹
  - max-height 480px，超出 scroll
  - 折叠时只显示 header + `View diff`
- 为什么 V0.1 必做：file_patch 是审批高频工具，没 diff 视图等于"审批黑盒"，违反"不要让用户思考"原则
- 为什么不用 `@pierre/diffs`：试过，其 Shiki backend 拉所有语言包进 bundle（+400 KB gzip）。V0.1 审批界面不需要工业级语法高亮，line-level +/- 已足够。`@pierre/diffs` 留 V0.2 候选 —— 真需要 hover/highlight + scoped 语言时再切换

##### `file_write` — 仅 path + mode

- 显示 `path`（mono）+ `mode pill`（overwrite/append/prepend）
- 下方 muted 一行："内容由 LLM 当前回复决定，将写入此文件"
- **不做内容预览**：GA 架构限制（`do_file_write` 跑时才从 `response.content` 提取，dispatch 拦截时还没跑），提前预览需要复刻 GA 逻辑，违反 non-invasive

##### `code_run` — 命令展示

- mono 等宽 + 语言高亮（bash / python / powershell）
- 多行命令完整展示（不截断）
- 顶部 language pill

##### `start_long_term_update` — memory 写入

- 显示 memory key + 内容预览
- high risk 标记，**Always allow globally 选项 disabled**

### 4.7 Inspector（已退役）

右侧 Inspector panel 已在 2026-05-12 退役，不再是当前布局基准。

退役原因不是"暂时没做"，而是信息归宿更清楚了：

| 旧 Inspector 信息 | 当前归宿 |
|---|---|
| Tool raw / args / stdout / result | 对应 Tool callout 内 inline 展开 |
| Pending approvals | Approval Dock + waiting_approval Tool callout |
| Approval 历史与 always-allow 规则 | Settings → Approval |
| Runtime / GA path / Python / LLM displayName | Sidebar runtime dot + Settings → Runtime |
| Message copy / save | Message Actions |

产品判断：右侧常驻面板让 Galley 读起来像 IDE，而不是本地 agent team orchestrator。把信息放回触发它的上下文，用户少一次"去右边找详情"的认知跳转，也释放了 conversation column 的阅读空间。

如果未来需要 Memory Inspector / file inspector，必须重新设计入口与信息架构，不复用旧右栏槽位。

---

## 5. 流程：Onboarding

默认路径是 managed / bundled GA：用户只需要配置模型，不需要理解 GA
checkout、Python、venv、`mykey.py` 或依赖安装。Attach 已有 GA 是次级入口。

顶部左侧显示当前流程进度；顶部右侧常驻低权重语言菜单（Translate icon + 当前
语言短标签），让首次用户不用进入 Settings 就能切换 `跟随系统 / 中文 / English`。
从 Settings 进入时，`返回设置` 或 `取消` 与语言菜单并排显示。

### Step 1 — 配置模型

- 标题：`为 Galley 配置模型`
- 副标题：`选择提供商，填入密钥和模型。`
- 字段：
  - Provider picker 不显示额外 label；placeholder 为 `选择提供商`，选项为 `OpenAI` / `Anthropic` 及 compatible endpoint 说明，无障碍 label 保留 `模型提供商`
  - `模型密钥`
  - `API 地址`
  - `模型`
- `读取模型列表`：API Key + API 地址后可点；成功后显示统一样式的模型选择 dropdown。
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

---

## 7. Empty State（无 session 时主区）

主界面没 session 时**不放大段欢迎文案**，**Composer 浮在视口中部**（不在底部正常位置）。提交第一条后切入 conversation。

参考 Claude.ai / ChatGPT / Cursor 标准模式，跟"对话工作台"心智一致。

### 视觉

```
             语词的意义，在于它在语言中的用法。       ← 题词：状态绑定的维氏句（serif italic ink-muted）
             Die Bedeutung eines Wortes …             ← 德文原句常驻副行（更轻一档）

            ┌─────────────────────────────┐
            │ Composer (居中，560px max)   │
            │ [Cube] LLM dropdown │ [+]   │
            │                       [↑]   │
            └─────────────────────────────┘
```

- Composer 居中（含 LLM 切换器，跟 in-session 对称），placeholder 是 "今天交代什么？"（commissioning 语气）。
- **题词（epigraph）浮在 Composer 正上方**：一行状态绑定的维特根斯坦句（译文跟随软件语言）+ 德文原句常驻副行（更轻一档）。`font-serif italic text-[12.5px] text-ink-muted`，视觉明显次于 Composer——读作安静题铭，不是 header / banner；入场即冻结，不随状态实时变、不轮播（live pulse 归 sidebar status spine）。状态绑定：`silent`（无 session）→ Tractatus 7「凡不可说的，应当沉默」；`quiet`（有 session 但无运行）→ PI §19；`working`（≥1 运行）→ PI §43（也是 Composer 运行态声音所依的同一命题 *meaning is use*）。策展集与逐条理由在 `gui/src/lib/epigraphs.ts` 注释 + 2026-06-03 devlog。
- Conversation width toggle 同样影响 Empty State：compact = 560px，wide = 1200px。用户在空状态点击 toggle 必须看到变化，否则像坏了。
- **不放 quick prompt 建议**（勿回退）：早期在 Composer 下方放过 4 条 serif italic 引导 prompt，2026-06 与题词打架——两坨安静 serif 夹住 Composer 稀释焦点，且在"沉默"题词下放"快说点什么"自拆其台——整段移除；新人能力发现留给独立的非空状态机制（详见 2026-06-03 devlog）。
- Sidebar 正常显示 Header / Quick Actions / timeline；Project Review 通过 Quick Action 进入；没有 session 时只出现一句 muted empty hint。
- **不放快捷键 hint 行**（曾尝试在底部加快捷键提示，但稀释了"今天交代什么？"的聚焦感；完整快捷键列表移到 Settings → Shortcuts tab）。

---

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

- 语言选项不为当前 Settings 单独新增 `General` tab。现阶段放在左侧 tab
  list 底部，作为轻量全局偏好。
- 选项为 `Auto / 跟随系统`、`中文`、`English`；默认 `Auto / 跟随系统`。
- 首次启动没有保存偏好时，根据 OS / WebView language preference 推断：
  `zh-*` 显示中文，其余显示 English。不要根据 IP、地区或时区判断。
- 用户显式选择 `中文` 或 `English` 后持久化；之后不再跟随系统语言变化，
  除非用户切回 `Auto / 跟随系统`。
- 中文 UI 的左侧 tab 使用英文主标签 + 小号中文辅助标签；英文 UI 只显示
  英文标签。

```text
Runtime      / 运行环境
Models       / 模型
Approval     / 审批
Agent        / 智能体接入
Shortcuts    / 快捷键
About        / 关于
```

视觉上不要真的使用斜杠；主标签和辅助标签上下两行显示。辅助标签
只做注释，不与英文主标签同权重：英文约 14px medium，中文约 10.5px
normal muted，两行之间保留明确间距。即使 tab 处于 active 状态，中文也
不要抬到主标签权重。该双层标签只用于 Settings 左侧导航，正文不做大面积
双语。

### 当前 Tabs

#### Runtime

- **GA path**：当前路径显示（mono）+ 重选按钮（触发文件夹选择器）
  - 改动后弹 confirm dialog："路径改动需要重启 Galley 才能生效。立即重启？/ 稍后"（不悄悄 kill 所有 session）
- **Bridge Python**：当前 interpreter 路径显示 + 重选 + muted hint "用于运行 bridge，影响 GA 子进程"
- **Re-run health check**：button → 弹 Health Check Card 重跑
- Bundled Python / external Python mode 在这里切换；默认 bundled，external 是高级路径。
- 底部显示 GenericAgent 版本 / Galley 版本。

#### Models

- Managed / bundled GA 的模型配置入口；attach mode 不读取这里。
- 支持添加多个模型：`OpenAI-compatible` / `Anthropic-compatible`、API Key、Base URL、模型名、可选显示名。
- Provider picker 中，`OpenAI` / `Anthropic` 保留品牌主标题；下拉项用低权重副标题说明“官方 API 或 compatible endpoint”，帮助用户理解第三方中转站 / 兼容接口也应该选择这两个入口。
- 页面分为主视图和维护区：
  - `当前配置模型` 是主视图，显示 Galley 当前会使用的模型队列、默认模型和排序。
  - `当前配置模型` 标题区只承载标题、`Info` tooltip 和模型数量；配置生效范围放到 `Info` tooltip，避免 header 被常驻说明文字撑乱或浪费纵向空间。
  - 模型新增、编辑、排序或设为默认成功后，用短 toast 提醒：新对话立即使用最新配置；如果存在已启用 Channels，toast 带 `重启 Channels` CTA，直接重启已启用 Channel 进程，不要求重新登录。
  - `当前配置模型` 行 hover / focus 只做轻底色和排序箭头显性化，提示可操作但不做抬升、缩放或阴影；Provider 名称使用低权重 metadata chip，默认模型标签保留可见但不做重 Badge。
  - `已接入的模型提供商` 是维护区，标题右侧按钮只写 `添加`，accessible label 保留完整的 `添加模型提供商`；Provider 摘要压成单行，长名称截断，不撑高卡片；协议类型放在模型数量之后，用低权重 metadata chip 显示，不使用明显边框或等宽字体，避免和 Provider 名称、模型数量抢层级。
  - Provider 摘要行的正常状态不显示 Key 图标或 `Key 已保存`；只有缺少密钥 / 状态异常时才显示 warning badge。
  - 新增 Provider 表单贴着 `已接入的模型提供商` 标题区展开，位于 Provider 列表上方；新增表单不重复显示标题，Provider picker 不显示额外 label，placeholder 用 `选择提供商`，关闭按钮与 picker 同行，避免小区域反复出现“模型提供商”或形成空标题区；编辑已接入 Provider 时，编辑表单必须贴着对应 Provider 原地展开，不跳回页面上方；新增和编辑表单都使用同一套展开态底色、边框和阴影，不因入口不同改变视觉层级。
  - Provider / Model 的局部编辑表单关闭入口统一用右上角 `X` icon button；不要混用右上角文字「取消」。
  - Provider 展开后才显示模型测试、自动获取列表、手动添加、编辑和删除等维护操作。
  - 获取模型列表后的模型选择必须使用 Galley 自定义 popover dropdown，不使用浏览器原生 `select`。
  - `可添加模型` 列表里的模型行操作使用低权重 `+ 添加`；已加入配置的模型在同一位置显示 `✓ 已添加`，两者高度和占位保持一致，避免形成一列重按钮。
  - 编辑模型里可以折叠显示 `高级配置`，默认关闭。第一版只开放排障/适配项：`max_retries`、`read_timeout`、`stream`、OpenAI-compatible 的 `api_mode` / `reasoning_effort`，以及 Anthropic-compatible 的 `thinking_type`、`reasoning_effort`、`Claude Code 兼容透传`。`thinking_budget_tokens` 不开放，因此 `thinking_type` 暂不提供 `enabled`，避免用户选了实际会被 GA 忽略的配置。
- 新增 / 编辑 Provider 表单和 Onboarding 首次模型配置中，`提供商显示名称` 是可选身份字段，不放进折叠的 `更多`；它常驻在连接信息和模型字段之后、保存按钮之前，作为最后一步轻量命名。
- Provider 检查成功态使用低权重 inline 文本，不长期占用绿色块；失败态保留说明块并贴近对应 Provider。
- Provider 内的默认模型在右侧操作区显示轻量 `默认模型` 状态；非默认模型才显示 `设为默认` 动作。
- API Key 字段只用于保存到本地加密凭据存储；列表正常态不展示凭据状态，只有缺少密钥 / 状态异常时显示提示，诊断可显示 `apiKeyRef` 对应状态但不显示密钥。
- Session 选中模型持久化必须用稳定身份：managed 用 `managed_models.id`，external 用 GA raw LLM name；`llm_index` 只能作为 bridge 命令和旧数据 fallback，不能作为长期身份。
- 第一版保留为 Settings 高级入口；first-run onboarding 会复用同一套能力，但不暴露高级参数。

#### Channels

- TopBar 中 Channels 位于状态簇最后，常驻但默认安静。`setup` / `not_connected` / `stopped` 显示 neutral icon-only `ChatCircleText`，作为可选扩展入口而不是待办；`running` 同样收敛为 icon-only。只有已经进入连接或需要处理时才升级为文字 badge：`starting` 显示 `Channels · 连接中`；`waiting_scan` 显示 `Channels · 扫码`；`expired` / `error` / load error 显示 `Channels · 需处理`。
- Channels 使用 managed model config revision 判断配置 freshness。模型配置变更后，已启用 Channel 若仍记录旧 revision，Settings -> Channels 顶部显示状态条：`Channels 正在使用旧模型配置`。
- `重启 Channels` 语义是重启所有已启用 Channel；手动 Stop / Disconnect 会把 Channel 置为未启用，不会被这个按钮重新拉起。
- Models toast 里的 `重启 Channels` CTA 直接执行；Channels 页状态条按钮先弹轻确认，说明可能中断当前回复、不会退出登录。
- 重启不删除微信 token，不主动要求重新扫码；token 过期仍走现有 expired / scan 流程。
- 飞书卡片与微信并列，但流程不是扫码：展开区提供开放平台步骤、App ID / App Secret 输入和启动按钮。App Secret 保存后不回显，留空表示沿用已保存凭据。目标用户是个人用户和小团队企业，默认允许组织内所有飞书用户访问，不在首版增加 allowlist / 绑定码。

#### Approval

- **YOLO mode toggle**（PRD §11.5）—— Tab 顶部第一项，跟下方常规设置之间留 32px gap + 一条 `border-line` 分隔线，视觉上独立成块（不被埋没在普通 toggle 列表里）
  - Toggle 行：左 18px Phosphor `Lightning` thin（深琥珀 `--color-warning`）+ "YOLO 模式" Newsreader medium 14px + 右侧 Switch
  - Toggle 下方一行 muted 12px："跳过所有工具调用的审批，直接执行——适合完全信任 Agent + 沙盒环境"
  - 当前已开启状态：Switch 杏沙激活 + 行底部一段 13px 文案"YOLO 已启用 · 顶部栏显示状态" + secondary button "立即关闭"
  - 关闭 → 开启触发 confirm modal（见下）；开启 → 关闭直接生效，无 confirm
- **需要审批的工具**：复选列表（默认 `code_run` / `file_write` / `file_patch` / `start_long_term_update`），用户可勾选；YOLO 开启时整个 section 显示 `opacity-50` + tooltip "YOLO 已开启，单项工具审批不生效"，但**不禁用**——用户关 YOLO 后仍生效
- **白名单规则**：分两组显示
  - **Per-project**（当前 attached GA 目录下的）—— 列出 tool name + 添加日期 + remove 按钮
  - **Global** —— 同上
  - YOLO 开启时同样 dimmed
- 改动后弹 toast "已应用到所有 session"（避免"太隐式"）
- 底部 muted hint："在审批弹窗里加入白名单后，规则会显示在这里。"

##### YOLO 启用 confirm modal

Radix Dialog，~480 × 360。文案（中文）：

```
打开 YOLO 模式？

YOLO = "You Only Live Once"。
所有工具调用将不经审批直接执行——包括：

  · file_patch（修改文件）
  · file_write（写入文件）
  · code_run（执行命令）
  · 其他高风险操作

适合：完全信任 Agent + 在沙盒环境工作（个人 repo / 临时虚拟机）
不适合：生产代码 / 共享系统 / 不熟悉的 Agent / 敏感数据

打开后顶部栏会显示 YOLO 状态标识，随时可一键关闭。

  [取消]  [是的，我知道在做什么]
```

视觉细节：

- 标题左侧用 Phosphor `Lightning` + "打开 YOLO 模式？" Newsreader medium 18px
- 主体 13px Inter，bullet 列表用 mono `·` 锚点
- "是的，我知道在做什么" 按钮：深琥珀 `bg-warning` 背景 + 白色文字（不是品牌杏沙——视觉上要显眼但不像"OK"那种条件反射按钮）
- "取消"：ghost button 默认 focus，回车默认是取消（避免误触确认）
- ESC 关闭 = 取消

#### About（版权页 colophon，2026-07-03）

按文库本版权页的逻辑组织（[temperament.md](./temperament.md)：引文只住题词位与版权页），
隐喻沉在结构里——分区标签用人话（版式），不用行话（印次 / 奥付）：

- `Galley` wordmark + tagline（Newsreader medium 18px）
- Origin story（serif italic surface callout——GA 致意）
- 版本：Galley 版本（含更新控件）/ 内置 GA kernel commit + audit date
- 版式：一行陈述正文与等宽字体（Newsreader / 苹方 / 雅黑 / JetBrains Mono）
- 题词：PI §43（产品论题「意义即用法」）——译文 + 德文原句 + 出处行；
  不加框，与 origin 的 callout 卡片区分（页面上的引文，不是 UI 里的卡片）
- Links（Phosphor `ArrowSquareOut`）：GitHub / Feedback / GenericAgent 上游 / maker links
- Footer：`由 JC Wang 开发 · MIT License`

连带决策：空状态题词只在 `silent`（工作区真正为空）渲染——每次 New Chat
都出现会墙纸化，题词的力量来自稀缺；`quiet` / `working` 绑定作为数据保留
（EmptyState 渲染层一行门控，翻案零成本）。

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

- **General / Preferences**（telemetry / launch behavior 等）—— 只有当全局偏好超过左侧轻量入口承载范围时再新增；外观和语言当前不单独触发这个 tab。
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

---

## 11. 已知未决与扩展方向

### 当前 beta 范围内 open

- **Settings 是否升级为独立窗口**：当前 modal 够用；只有当用户需要边看 session 边改设置的频率被 dogfood 证实时再升级。
- **Composer LLM dropdown 在 long LLM list 下的 UX**：V0.1 不做特殊处理，超过 8 个加 scroll
- **Onboarding 走完后下次启动是否每次跑 Health Check**：建议**后台**重新跑（不阻塞 UI），失败时弹 toast；V0.2 desktop 阶段验证
- **按钮与图标 primitive 收口**：当前仍存在 raw button / raw glyph drift，需要分阶段收。
- **暖色 token 的层级校准**：当前底色一致性足够，但 brand / selected / hover / warning 的使用边界还需要更明确，避免全局一片杏沙。

### 推到未来版本的设计扩展

- **Dark mode**：light-first token 已预留命名空间（`surface-dark` 系列待补）
- **`file_write` 内容预览**：依赖 GA 上游把 `extract_robust_content` 前置到 dispatch，可以是给 GA 的 PR
- **Slash commands** in Composer（`/restore` `/new` 等）
- **Cross-session 全文搜索**（Command Palette `#` prefix）
- **Custom LLM displayName**（Settings → LLM tab）
- **拖拽 session 到 Project**（V0.1 用右键 + hover `⋯`）
- **Trees / file explorer**（如果 V0.2+ 加 file inspector，候选 [trees.software](https://trees.software) + [@pierre/diffs](https://diffs.com) 配套）

---

## 12. 与 Notion 历史稿的关系

- v0.1 完整版（dark-first / Linear 风）保留在 Notion 作为历史对照（page id `3552aab6e913815f91a1c2b8b0a15672`）
- 当前权威版本在本仓库 `docs/DESIGN.md` + devlog
- Notion 不再作为当前实现 spec 的同步源；避免同一设计基准出现两个真源

完整决策叙事见 `docs/devlog/`：

- `2026-05-07-design-direction-pivot.md` — Notion + Claude 转向，9 块基础对齐
- `2026-05-08-onboarding-and-llm-switching.md` — Onboarding / Empty / Health Check / LLM 切换
- `2026-05-08-design-trio-finale.md` — Error Card / Command Palette / Settings + file_patch diff
