# Markdown 与代码块渲染

> [Conversation 主区与 Composer](./README.md) 的一篇：2026-11-10 从 `docs/design/conversation.md` 拆出，正文原样搬过来。

#### Markdown 渲染

Final answer 跟 Thinking summary 都通过 `react-markdown` + `remark-gfm` + `remark-cjk-friendly`（`**标签：**正文` 这类紧贴全角标点的加粗，CommonMark 会原样漏星号）+ Shiki 渲染。LLM 输出的 markdown（标题 / 列表 / 表格 / 代码块 / 引用 / 链接 / 删除线）全部解析成对应 DOM，没解析的纯文本走默认段落。

**typography 映射**（每个元素 pull 现有 token，不引入新字号）。下表
px 值是三档字号系统的 **standard 档**——所有阅读面尺寸都由
`--conversation-*` 变量驱动（见 foundations.md「字号 scale」），**不要
在组件里硬编码 px**（2026-07-05 教训：块代码曾硬编码 13px，用户调大
字号时代码不跟随。2026-08-12 同一个坑的第二层：**纵向间距**也全是硬编码，
见下方「纵向节奏」）：

| markdown | 渲染 |
|---|---|
| `p` | 15px normal / line-height 1.7（Latin Newsreader, CJK 苹方·雅黑）`agent` / 14px italic muted `thinking` |
| `h1` | Newsreader medium 22px |
| `h2` | Newsreader medium 19px |
| `h3` | Newsreader medium 17px（故意接近正文，避免视觉跳跃） |
| `h4` | Newsreader medium 15.5px |
| `ul` / `ol` | 标准缩进，`::marker` text-ink-muted |
| `li` | 紧 paragraph 形态（list 内 `<p>` margin 0） |
| `- [x]` 任务项 (GFM) | 0.92em 方框，选中填 `brand` + Check 图标，未选中 `border-line-strong` 空框；沿用 `ui/checkbox.tsx` 的视觉语言，`em` 尺寸随档位缩放。`li.task-list-item` 去掉圆点（否则圆点和方框两个标记并排），但只作用在任务项上——混合列表里的普通项保留圆点 |
| 行内 `code` | mono 0.92em + bg-hover 浅底（pill，`box-decoration-clone` 保证换行不断裂）+ `text-code-ink` 暖褐（2026-08-12 定案，见下方「行内代码的暖色预算」） |
| 块代码 ` ```python ` | 详见下方 Shiki 段 |
| `blockquote` | 左 3px brand 竖线 + italic + ink-soft |
| `a` | text-ink + ink-muted 1px 下划线，hover 才转 brand-strong + 安全 _blank（暖色预算让给行内代码，2026-08-12） |
| `table` (GFM) | `overflow-x-auto` 容器 + border-collapse + th `bg-surface` + 单元格 padding 12px×8px；单元格 `overflow-wrap: break-word`，单元格里的行内代码与链接 `anywhere`（2026-10-16：整格 `anywhere` 会把列的最小宽度算成一个字，序号列被长地址列挤到「10」拆成上下两行）；短列不折行（2026-10-23，[主聊天 PRD](../../../.scratch/main-chat/PRD.md) 裁决 136）：一列的每一格（含表头）按渲染后的文字算（不算 markdown 记号，全角算 2、其余算 1）都不超过 16，这一列的 `th`、`td` 加 `white-space: nowrap`；所有短列的最宽一格加起来超过 40（约 20 个汉字）就都不启用、整张表照旧，免得新增横向滚动；长列照旧折行（`lib/table-short-columns.ts` 的 remark 插件给短列的格子标 `data-short-col`）。为什么：表格自动布局大致按各列不折行时的长度分宽度，中文任意两字之间都能断行，短列最小只有一个字宽，队名列被长段落的列挤成一两个字一行；10-16 的 `break-word` 护的是数字与英文词，这是中文那一半 |
| `hr` | 1px line + my-5 |
| `strong` | font-medium（正文 normal 400，strong 500，一档可见加粗） |
| `em` | italic |
| `~~del~~` (GFM) | line-through ink-muted |
| `![alt](url)` | `https://` 与绝对本地 raster 图片（png / jpg / jpeg / webp / gif）内联预览；本地路径支持 macOS/Linux 绝对路径、Windows drive path、`file://`；相对路径、`http://`、`data:`、`svg`、加载失败降级为图片链接 pill。首次解码时记录 natural 尺寸（模块级缓存，按 src 键），此后每次渲染带 `width`/`height` 属性——浏览器解码前即预留最终盒子，回访转录时图片不再 pop-in 推挤下方内容（2026-07-15） |

**视觉哲学**：每个 markdown 元素 reuse 现有 Newsreader / Inter / JetBrains-Mono token，不为 markdown 单独引入字号 ramp。整段对话读起来是一个 document，不是 stylesheet 拼贴。

#### 流式回溯抖动（2026-08-12）

流式输出时未闭合的 ``` `代码` ``` 和 `[文字](链接` 按字面渲染，闭合的瞬间标记
字符消失、字体切换，**已经排好的文字被改写 → 段落在光标后面重排**。
`mendStreamingMarkdown` 只对**流式 partial**（`MainView` 那一条路径）补合成
闭合符；落定的 turn 渲染原文，所以真的永不闭合的标记在结束时诚实地翻一次，
而不是全程抖。这个「显示态 / 落定态」的分离在 Galley 是白得的——两者本来就是
两条渲染路径。

只补**代码 span 和链接目标**，实测这两类占位移的 94%。强调（`**`）只占 6%
却是复杂度的大头（CommonMark 定界符消解需要开定界符栈 + 欠闭合计数，补错了
文字会先斜后粗地闪），性价比不成立，明确不做。表格（`| a | b |` 在分隔行到达
前是段落）是 GFM 语法要求，补不出来，只能接受。

链接补完**必须配 pending 哨兵**：`markdownUrlTransform` 把
`galley:pending-link` 映射成 `null`，`href` 整个不出现——锚点仍匹配 `[&_a]`
样式所以 URL 落定时零位移，但点不了。注意这修的是一个**已经存在**的问题：
GFM 的 autolink literal 本来就会把半截 `https://exa` 变成活链接。

回归测试 `mend-streaming-markdown.stream.test.tsx` 逐前缀渲染并统计
「新一帧不是旧一帧纯追加」的次数：落地时 16 次 / 位移 230 字符 → 6 次 /
位移 20 字符（**次数降 63%，位移降 91%**）。

#### 纵向节奏（2026-08-12）

markdown 的每一个块间距都是 `--conversation-block-gap` 的倍数，该基数随
三档字号缩放（10.5 / 12 / 13.5px），倍数阶梯写在 `MarkdownView` 的
`PROSE_BASE` 注释里。主对话的两种气泡里另取 9.5 / 10.5 / 12.5px（行高也收一档），
见「[助手的对话](./assistant.md#助手的对话2026-10-15)」的「气泡里的字比工作台收一档」。

**为什么必须跟随档位**：字号和行高本来就随档位走（13.5/15/16.5px ×
1.65/1.70/1.75），但 2026-08-12 之前所有块间距都是写死的 Tailwind 值
（`my-3` = 12px 三档不变）。段间距除以行盒高，small 档 0.54 行、large 档
只剩 0.42 行——**用户把字号调大（想要更松），文档反而更挤**，相对分离度
掉 23%。现在三档都稳在 0.47 附近。

这是 2026-07-05「块代码硬编码 13px」那个教训的第二层：那次修的是**尺寸**
不跟随，这次是**间距**不跟随。规则统一为：阅读面上任何随档位有意义的量，
都必须挂 `--conversation-*`，不能是固定 Tailwind class。

倍数阶梯保留了原有的全部区分，没有压平：代码块 / 表格（1.1667×）比正文多
喘一口——它们是嵌入的另一种介质；标题的 close 阶梯 12/10/8/6 也原样保留，
标题越大下方留白越多。`:root` 里有一个 12px 兜底值，因为 `MarkdownView`
也会渲染在注入档位变量的根之外（`TutorialModal`），而变量缺失会让 `calc()`
整体失效、margin 归零。

#### 行内代码的暖色预算（2026-08-12 定案）

底色一直是 `--color-hover`，没变；变的是**用什么维度把行内代码和正文区分开**。

- **色相区分，不是明度降级**。2026-08-12 之前行内代码是 `ink-soft` + 0.86em——比正文更淡更小，读作"这个不太重要"。但 coding agent 回答里的行内代码几乎全是**路径 / 文件名 / 版本号 / 命令**，恰恰是读者最需要认清和复制的内容。改为 `--color-code-ink` 暖褐（浅 `#9A5528` / 深 `#E0A882`）+ 0.92em：亮度对比反而低于正文（纸上约 5.6:1 vs 正文 15.7:1），**靠色相而非亮度承载区分**，读作"另一类对象"。
- **收益随密度放大**。单个 token 差别不大；一行七个文件名时，暖色让它变成可扫描清单，`ink-soft` 会糊成一片灰。这才是本次改动的真实场景。
- **暖色预算是零和的，链接让位**。同一段里两种暖色，读者分不清哪个能点。链接改为 `text-ink` + `ink-muted` 下划线，hover 才转 `brand-strong`——下划线本来就是承载可点性的 affordance，颜色是冗余的。频率决定分配：agent 回答里路径多、外链少。
- **`box-decoration-clone` 必须带着**。长路径经常软换行，没有它续行会丢掉横向 padding 和圆角。

参考来源与三变体实测过程见
[devlog 2026-08-12](../../devlog/2026-08-12-inline-code-warm-ink.md)。

#### 代码块（容器 + Shiki 高亮）

**2026-09-18 参考件对表改版**（[devlog](../../devlog/2026-09-18-code-block-reference-audit.md)，JC 真机裁决 header + github）：

- **视觉容器**：圆角 `--radius-callout` 8px + hairline `border-line` + 底色 `--color-code-surface`（内凹暖灰，见下方「底色方向」——参考件的白底浮起卡片 + 阴影明确不抄，foundations 的 inset 规则赢）。块外边距挂 `--conversation-block-gap × 1.1667`（与表格同档，此前是写死的 `my-3`，是 08-12「阅读面间距不写死」的漏网之鱼）。代码行高 `leading-code` 1.6（foundations 的 token；06 月密度 pass 曾写死 1.45 越过它）。字号随三档字号走。
- **header 行**（翻转 06 月「去掉 header 行」裁决）：左侧 `Code` 图标 + 语言名（mono 10.5px uppercase ink-muted；`text` / `plaintext` 等无信息语言名不显示，图标留着让行不空），右侧换行切换 + copy。理由：控件离开代码区，单行长命令的行尾不再被压；copy 常驻后这一行永远有内容，06 月「死白带」的前提不成立。代价：单行框约 33px → 65px，真实用量 46% 是单行，JC 真机看过接受。
- **copy 常驻、纯图标**（此前 hover 才出现、带 "COPY" 字）：24px 命中区、13px `Copy` regular，复制后交叉淡入成 `text-success` 的 `Check`（opacity + 2px blur，`--motion-base` / `ease-firm`，§2.7 A 类）。理由：真实用量里 88% 的框是 text / bash / 无标注——命令、路径、报错行——复制是主要动作。复制内容是**纯代码**，不带围栏。
- **换行切换只在内容真的横向溢出时出现**（ResizeObserver 量 scrollWidth），已换行时保持可见以便切回。真实用量里超过 120 字符的框不到 5%，多数框看不到它。
- **超过 24 行折叠**：正文按 `24 × leading-code × code-size` 截高，脚部「还有 N 行 / 收起」+ `CaretDown`（10.5px mono，hover 提墨）。阈值 24 而非参考件的 8：对话里代码就是答案，8 行会折掉约 24% 的框，24 行约 5%。流式 partial 期间不折（`MarkdownView streaming` → `CodeBlockContext`）。
- `md` 别名到 markdown；标签显示规范语言名。

**Shiki 高亮**：

- 引擎：[Shiki](https://shiki.style) v1+，TextMate grammar，跟 VS Code / Claude.ai web 同款
- 主题：跟随 Galley 当前主题，light 用 `github-light`，dark 用 `github-dark`。09-18 曾做纸墨调「双墨」主题（ink / 暖褐 / ink-muted 注释）进真机 A/B，输给 github：JC 要全调色板给出的结构感。
- 注册语言（hand-picked）：`bash` / `css` / `diff` / `html` / `javascript` / `json` / `markdown` / `python` / `rust` / `shell` / `sql` / `tsx` / `typescript` / `yaml` —— 14 种 coding agent 用户高频
- 别名：`js → javascript` / `ts → typescript` / `py → python` / `rs → rust` / `sh → bash` / `yml → yaml` / `md → markdown`
- 未注册的语言：fallback 到无色 mono code block（同样的 chrome，仅没 token color），不报错
- async render：第一次 highlighter 加载时显示 plain mono fallback，加载完替换；同 highlighter 实例 cache，跨 code block 共享
- 流式期间保留上一帧高亮 HTML 直到新高亮完成（2026-07-05）：否则每个 chunk 都闪一次"无色→上色"；换主题同理。代价是内容滞后一次高亮周期（Shiki 热启动后仅数毫秒）
- **高亮结果缓存 + 度量恒等（2026-07-15，勿回退）**：高亮 HTML 按 `theme:lang:code` 进模块级 LRU（300 条）。转录在会话切换时整体重挂载，命中缓存的代码块**首帧即彩色**，plain→彩色交换不再发生。首次高亮的异步换入则靠度量恒等保证零回流：字体 / 字号 / 行高已由容器钉死，剩余变量是主题对 markdown/diff token 发出的 bold/italic——字形宽度不同会移动折行点、改变块高。用 `!important` 中和（Shiki 是内联样式），高亮从此 **color-only**，这是有意取舍：牺牲主题的字重表达，换"什么时候高亮到达都不影响布局"

**2026-06 密度与分离 pass（决策留痕；header 行一条已于 09-18 翻转，其余勿回退）**：

- ~~去掉顶部 header 行~~：当时的理由是语言名被抑制时只剩一条死白带。09-18 翻转，见上——copy 常驻让行不再死，控件离开代码区是主收益。
- **紧凑间距**：显式归零 `pre`/`code` 的 margin/padding（`[&_pre]:m-0 [&_pre]:p-0` 等），堵住 Shiki / UA 行盒漏进来撑高单行块的纵向空白。正文 padding 09-18 从 `py-1.5` 放到 `py-2`，行高 1.45 → 1.6。
- **首尾空行裁剪**：按行剥掉围栏内容的首尾空白行（兼容 `\r\n`），LLM 常带的前导空行不再渲染成框内浪费空间（`trimCodeBlankEdges`）。
- **底色方向（关键，别再"优化"回去）**：代码要读作"嵌进纸里的另一种介质"，所以 `--color-code-surface` 必须**与页面 `--color-app` 拉开、且与行内代码 `--color-hover` 同族**（浅色 `#F2F1F0`，比纸暗；深色 `#1E2126`，比近黑的纸略亮——深色下"下沉"靠微微抬亮表达，与 `--color-hover` 的关系一致）。曾经用过的比纸更白的 `bg-surface` 会让代码框糊进对话流、几乎不可辨——这是被明确否掉的方向；09-18 参考件的白底 + 阴影浮起卡片同理不抄。

不做：代码块行号（聊天里没有文件上下文，行号没有引用对象；参考件的 Numbered 变体否决）/ Edit 在行内（V0.2 候选）/ 代码区键盘聚焦滚动（对话区 pointer-first，键盘故事整体待议）。
