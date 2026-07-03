# Galley 排印准则

> 这份文档定义 Galley 阅读面的**排印质量**规则——中西文混排、标点、行长，
> 即文本如何被排出来。它是气质三规范的第三条腿：
>
> - [copy-austerity-principles](./copy-austerity-principles.md) 管**怎么说**（声音）。
> - [copy-language-guidelines](./copy-language-guidelines.md) 管**说什么词**（术语）。
> - 本文档管**怎么排**（渲染）。
>
> 与 [DESIGN.md](./DESIGN.md) §2.2 的分工：DESIGN.md 是字体 / 字号 / 字重 /
> 行高的 **token 契约**（用哪些值）；本文档是这些值之外的**排版行为**规则。
> 冲突时 token 契约优先。
>
> 定位背景见[气质总纲](./temperament.md)：对话内容是模型的，排印是 Galley
> 的。阅读面的排印按书籍标准要求自己，不按 web 默认值将就。

## 一条红线：排印只作用于渲染，绝不改写内容

Galley 是文库，不是编辑。所有排印干预（间距、悬挂、标点挤压）都发生在
渲染层，源文本一个字符都不动：

- 复制出来的文字必须与模型原文逐字一致。
- code block 逐字呈现，不参与任何混排美化（见下）。
- markdown 修复插件（如 `remarkCjkAdjacentQuotedStrong`）的准入标准是
  **还原模型的明确意图**（LLM 高频写法被 CommonMark 判为字面量），不是
  「改得更好看」。任何会改变语义或字符内容的"修复"都不收。

## 中西文混排间距（text-autospace）

中文与拉丁字母 / 数字相邻时插入约 1/8 em 的视觉间距（「盘古之白」），
这是中文书籍排印的基本功，由渲染引擎完成，不靠在源文本里手敲空格。

**规则**：全局显式声明 `text-autospace: normal`（`globals.css` body），
code 表面显式豁免。

**为什么必须显式**（2026-07 引擎现状）：

- Chromium 140+（Windows WebView2）初始值即 `normal`——Windows 用户
  已经默认拿到这个质量。
- WebKit / Safari 18.4+（macOS 15.4+ 的 WKWebView）**支持但初始值是
  `no-autospace`**，不声明就没有。
- 显式声明让两个平台行为一致；不支持的旧引擎忽略该属性，优雅降级，
  不伤 Mac 老系统。

**code 豁免**：`pre` / `code` / `kbd` / `samp` 设 `no-autospace`。代码
必须逐字呈现——注释和字符串里的中英相邻不做视觉美化，所见即字符。

**对文案层的含义**：UI 文案与模型输出都**不要求**手动在中英文之间敲
空格；间距是渲染职责。已有的手敲空格（如「N 个 Agent」）保留不清洗——
`text-autospace` 对已有空格不叠加。

## 行尾标点悬挂（hanging-punctuation）

段落行尾的全角句读（。、，）允许悬入右边距，避免行尾留下一个字宽的
视觉缺口——传统中文排版的收边手法。

**规则**：对话 prose（`MarkdownView`）设 `hanging-punctuation: allow-end`。

- WebKit 独有（macOS 受益），Chromium / Firefox 忽略，纯渐进增强。
- 只用 `allow-end`。`first` / `force-end` 影响拉丁引号和强制悬挂，
  与左对齐段落的诉求不符，不用。
- 只进阅读 prose，不进 UI chrome（紧凑行里悬挂会造成对齐错觉）。

## 全角标点挤压（text-spacing-trim）

连续全角标点（如「）。」）之间的空隙压缩。**不显式设置**，记录现状：

- Chromium 123+ 初始值 `normal`，已自动生效；WebKit 尚未支持。
- 依赖字体的 OpenType `halt` / `chws` 特性，苹方 / 雅黑覆盖有限。
- 属性仍标记 experimental。等 WebKit 落地、初始值争议尘埃落定后再评估
  是否显式声明；在那之前引擎默认值就是我们的立场。

## 行长（measure）

对话列 compact 档 `max-w-[760px]`，15px 正文下约合每行 48 个汉字。

- 中文书籍排印的理想行长约 35–45 字。Galley 停在上缘偏外一点，是有意
  取舍：对话正文混有代码块、表格、英文长词，过窄的 measure 会把它们
  挤得更碎。48 字仍在舒适阅读区间内。
- wide 档（1200px）是用户为表格 / 代码 / 并排比对显式做出的选择，不按
  书籍标准评判。
- 行高已按 CJK 标准配置（正文 1.7，见 DESIGN.md §2.2 行高 tier），
  比拉丁排版惯用的 1.5 更松——汉字方块字面大，需要更多行间呼吸。

## 对齐与断行

- 段落**左对齐（ragged right）**，不用 `text-align: justify`。中西混排 +
  代码 + 链接的内容里，两端对齐会制造不可控的词间距拉伸，破坏安静。
- 断行走引擎默认（`line-break: auto`）。不设 `strict`——LLM 输出的标点
  质量参差，strict 会放大坏标点的破坏力。

## 不做什么

- 不在渲染层替换模型输出的标点（弯引号 → 直角引号之类）。那是改写
  内容，越过红线；引号风格属于模型行为，不属于排印。
- 不给中文设 `letter-spacing`。汉字方块自带节奏，追加字距是装饰。
  （拉丁 serif 的 `tracking-[0.005em]` 签名不受此限，见 DESIGN.md。）
- 不引入排印 JS 库（pangu.js 之类）在 DOM 里插空格——那是在内容里
  写入排版，复制出来的文本被污染，违反红线。CSS 能做的不用 JS 做。
