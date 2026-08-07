# Conversation 主区与 Composer

> Galley 设计系统 · 原 DESIGN.md §4.3–§4.4 与 §7（2026-07-04 拆分）：turn 结构、Goal 章节框、Markdown / 代码块渲染、滚动与流式行为、Composer、Empty State。

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
| 锚点 | 逐行杏沙高亮笔触（`bg-brand-tint` + `box-decoration-clone`，融合成右缘参差的色块） | 无 |
| 对齐 | 左对齐 · 宽度随内容（`w-fit max-w-full`，bbox 即最长行） | 左对齐 · 满栏 |

不要 right-align 不要气泡 —— 这是文档区，不是聊天 IM。**用户消息是被高亮笔划过的语句，不是 bubble 也不是 callout 块**（2026-08-06 起）：参照纸面文档里读者用荧光笔标出的段落，而非 IM 单侧浮起或 Notion callout 的盒子语法。

长对话里这是用户**回找自己提问**的主视觉锚——逐行杏沙笔触让每个 user turn 成为滚动停靠点，回找提问从此是字面意义的「找到被划过的句子」。AI 回复保持纯散文无底色，"提问（高亮锚）→ AI 回复（要读的内容）" 的层次随之建立。

#### 高亮笔（2026-08-06 起，原为 callout 色板）

起因仍是「这个方块生硬、差点意思」——2026-08-05 的 shrink-to-fit（`w-fit max-w-full`，治底色面积与内容量脱钩）没治好体感。复诊结论：病根不是棱角（彼时已量化否决：17:1 slab 上 4px 圆角只动 0.04% 像素），是 **slab 本身**——大面积平涂矩形读作 UI 机件；且 ToolCallout 的机件盒子是 `rounded-md` 圆角的，全视图唯一硬直角的元素恰是人的声音，寄存器倒挂。

「一眼认出用户消息」拆成三个任务分析：滚动回找靠前注意信号（颜色/朝向/尺寸）、静读辨声排印足够（访谈体范式）、略读边界感知是中间态。据此做了两轮真机 A/B（MessageUser 内临时 ⌥V 切换器，长 session 实滚）：

- **Round 1**：访谈体三变体（删底色纯排印——竖条原位 / 竖条悬挂栏外 / +Inter 600）vs 高亮笔。**高亮笔在滚动回找的抓眼度上遥遥领先**——色彩面积才是扫视真正依赖的信号，竖条的「颜色+朝向」前注意信号敌不过色域。当年「杏沙底保证滚动可扫视」的断言经受住测试；访谈体（概念上最忠于文档隐喻的方向）被实测干净否决。
- **Round 2**：笔触行间留细缝 vs 融合成片。**融合版（b-fused）胜出**。

定案形态：

- 逐行杏沙笔触：`bg-brand-tint` + `box-decoration-clone`，纵向 padding 5px 使相邻行在三档字号（leading 1.65–1.75）下都融合成片，右缘随文字参差；
- **无竖条**——高亮自身就是色彩锚，再加竖条是冗余双锚。4px 竖条退出 user register（滚动锚职能由笔触整体承接，`data-role` / submit 置顶 / Rail 机制不变）；
- 笔触 **2px 圆角**——2026-08-05 的反圆角论证（0.04% 像素 + border-l 削楔）是 slab 几何的产物，对逐行笔触不迁移：笔触上的圆角可见且读作笔感；
- **纯空白行不上色**——粘贴内容里的空行不渲染成无字杏沙色块；
- 笔触的 4px 横向出头用一对偏移 box-shadow 绘制（`±4px 0 0 var(--color-brand-tint)`，不占布局，文字左缘与 agent 散文栏天然对齐）。**不要改回 `px` + 负 margin**：WKWebView 计算 `w-fit` 内在宽度时不计行内横向 padding、布局时又占用它，块会短 8px，`break-words` 随即把短消息拦腰折行（「hey」→「he / y」，2026-08-06 dogfood 发现并修正）；
- **不给普通消息加 eyebrow / 图标**——会稀释 GoalCommissionMarker 加冠行的对比度。

随之继承 / 消解的旧决定：

- **2026-06-20 排印统一不动**：色彩仍承担 user/agent 区分职能，只是形状从块变笔触，Inter medium 同字号保留。
- **2026-08-05 shrink-to-fit 的问题域整体消解**：笔触逐行贴文字，底色权重与内容量精确同步（比 `w-fit` 块更彻底），「短消息空色带」「极短消息读作标签」不再存在。
- `line-clamp-6` 折叠、copy chip 悬浮位、附件缩略图行为全部不变。

**`GoalRunMarkers` 的 objective 框故意不同步**（2026-08-06 裁决，翻转此前的「必须同步」）：委派标记保留旧的竖条 + 色板 + 硬边块形态作为**加冠正装**——平民=笔触、加冠=色板，这个对比本身成为「Goal 委派 vs 普通消息」辨识度的一部分。

#### Right Question Rail

主区右侧 rail 的职责有两个：**question index**（一颗 dot / 一段 cluster marker 对应一次或一组 user message，多问题间回跳）和**回到提问开头的跳转锚**（单问题即成立）。它不是第二个 Sidebar，也不是 session 状态队列。

- 自第 1 条 user message 起显示（2026-07-21 起；原门槛"少于 3 条隐藏"按 index 职能设定，误伤了锚职能——深度研究型对话恰是一问 + 数千字长回答，最需要回跳时 rail 缺席。单点 rail 不再是索引，但作为锚成立，且与长对话中已学会的交互完全一致）。键盘路径 ⌥↑/⌥↓ 与对话长度无关，始终可用。
- 历史 dots 永远只表达导航位置：active = brand filled，inactive = hollow ring，cluster = vertical capsule。
- 只有最新 tail marker 可以临时承载 live 状态：running 时 single dot 替换为 Sidebar 同源的 brand `CircleNotch` spinner；waiting（approval / ask_user 合并）时替换为 warning `PauseCircle`。状态结束后恢复普通 dot / cluster。
- 最新提问落在 dense cluster 里时，保留 cluster capsule 和 hover list，再叠加同源状态图标；不能让状态图标吞掉“这里是一组提问”的导航语义。
- 右 rail 不展示 subline / badge / row tint。状态文案只进入 tooltip / aria：`进行中` / `等你回应`。跨区记忆来自同一套状态图标语法，而不是把 Sidebar row chrome 搬进文档区。

##### Hover tooltip 的内容契约

单 dot 的 hover tooltip 是**两行**（2026-08-03 起）：`序号 │ 提问` + 下方缩进对齐的**回答预览**。dot 数量不变——加第二行补的是**辨识**（"这一问我当时得到了什么"），不是导航；用增加标记来解决 tooltip 的信息量问题会把密度翻倍去换一个它解决不了的东西。

- 回答预览 = final answer 的**首个正文行**（跳过空行与 ATX 标题），再走与提问同一套 `buildPreview`（折叠空白、剥首个 markdown 标记、50 字预截）。跳标题是因为长回答高频以 `## 结论` 开头，预览成"结论"两字等于零信息。规则只跳标题、不跳代码围栏或列表标记——一句话能说完的规则才可预测。
- **不用 `AgentTurn.summary`**：它是 agent 的工作记忆而非给读者的概括。managed runtime 的 prompt 要的是"上次工具调用结果产生的新信息 + 本次工具调用意图"，GA 直接把它 append 进自己的 `history_info`；它指向下一步工具调用，而最终答案轮是 `no_tool`，没有"本次意图"可指，框架失配。预览应当是用户点进去会看到的东西的缩略图，那就是 final answer 本身。Sidebar 显示 summary 不构成同源理由——Sidebar 那一格的语义是 session 的**进行状态**（`第 N 步 · …`），不是某次问答的内容。
- 配对规则：取该提问与下一条提问之间**最后一个** `finalAnswer !== null` 的 agent turn。`finalAnswer` 每个 `turn_end` 都会算（不只最终轮），中间工具轮偶尔会漏出散话；取最后一个在正常情况即真正的收口轮，在 run 被中断的情况下也还留得下预览。
- 回答缺席（仍在进行 / run 中断 / 首行无可预览正文）→ **不渲染第二行**，盒子缩回单行，不留幽灵空行。
- 两行的层级差**拉满 ink 三档中的两档**：盒子设 `text-ink`（提问继承），回答行覆盖为 `text-ink-muted`（色阶底）。字号、字数预算两行相同。先试过 `text-ink-soft` + `text-ink-muted` 的一档差，实机上"除了稍微淡一点点并没有拉开差距"——两行在结构上完全并列（同字号、同起始列、同 50 字预算、均匀行距），一档色差压不住这种对等。修法在**加大反差**与**缩小回答**（降字号 / 砍字数）之间选了前者：后者要把 CJK 推向 10.5px 的可读边界，而 tooltip 的正文字号只有一档余量。
- 回答预览只进视觉，不进 aria——button 的 aria-label 是导航目的地（`跳到第 N 条提问`），本来就不含提问正文，塞回答会让 label 变长且与既有惯例不符。
- **dense cluster 的展开列表保持单行只显示提问**。这个不一致是刻意的：cluster 是密集区的快速定位面，不是阅读面，5 条 × 2 行会变成一堵墙。

#### Thinking Summary

- 不再是独立 callout（2026-06 改版，2026-07-05 回写）：thinking 内容
  折叠进 TurnMarker 行的 DetailPanel——点 marker 行尾的 caret 展开,
  无独立容器 chrome。理由：独立 callout 让每步多一块常驻框,而
  thinking 是"想看才看"的过程材料,渐进式展示。
- 内容 = GA 真实 emit 的 `<thinking>`（无则 caret 不出现）+ 中间轮
  preamble（当其未作为旁白单独渲染时）
- 展开后 Newsreader italic、`--conversation-thinking-size` 走三档字号

#### Goal 叙述 callout（SystemMessageBubble `variant="goal"`）

Galley 在 Goal master 线程里讲述 run 进展的旁白（system row）。它是**次要的进行旁白，不是要读的答案**，层级应低于 agent answer。

- 早期设计是"满底 `bg-brand-soft` + 3px brand-strong 实条 + 大写加粗 brand 标签 + bold 图标"，使它成了整个对话区最重的块，反倒压过用户消息和 agent 正文（层级倒挂），多条堆叠还会连成一堵 brand 墙。
- **2026-06 降权**：去掉满底色与横幅化标签，只留**一条细 brand 左规线**（`border-l-[3px] border-brand-strong/30` + `pl-4`，无底色无右圆角）+ **一个无字的小 `Target` 图标**（thin 11px）作 register 标记，正文经 `MarkdownView variant="agent"` 但 `[&_p]/[&_li]` 降到 `text-ink-soft`。读作页边批注，而非横幅。
- **「Galley」不再逐条显示**：每条都重复这个词是零信息的 chrome；归属改挂到 Target 图标的 `aria-label`（沿用 `goalNarration` 文案），读屏仍可念出，视觉不啰嗦。保留图标而非裸到只剩左规线，是为了和 agent 正文里的 markdown blockquote（同为 brand 左条 + 斜体 ink-soft 衬线）区分开。
- **身份由 run 两端的章节框承担**：Goal 委派标记（开场）+ 收口标记（终态）扛起"这是一个 Goal"的 brand 身份，中间的叙述因此可以退回安静旁白。连续叙述簇只在**首条**显示 Target 图标（`SystemMessageBubble` 的 `showGlyph`，由 `annotateGoalThread` 的 `narrationLeading` 驱动），多 beat 的 run 不再每行重复标记。

#### Goal run = 线程内插曲（章节框）

一条 master session 的线程可先后承载**多个 Goal run**（session 复用自身 id 作每个 goal 的 master），中间还会夹普通对话。所以不做"会话级 Header"，而是把每个 run 括成一段**插曲**：开场 = 委派标记，结尾 = 收口标记，中间是该 run 的叙述。单 goal 就是一段干净的头尾，多 goal 自动分段，同一套规则。

- **委派标记（`GoalCommissionMarker`）= objective user message 的加冠版**：它本就是用户在 Goal 模式下发送的第一条消息，穿着**加冠正装**（4px brand 竖条 + `bg-brand-tint` 色板 + 硬右边 + Inter medium——2026-08-06 前的 user register，普通消息改高亮笔触后被委派标记专属保留），头上加一行 eyebrow：`Target + Goal`（brand 大写字距）+ 右侧直立 tabular 参数（`N 个 Agent · 预算 Xm · 写入模式`）+ 一个粗粒度状态徽标。这同时解决了"objective 被当普通气泡"和"Composer 两种寄存器结果不可辨"——普通发送=高亮笔触，Goal 发送=委派标记的色板正装。
- **收口标记（`GoalTerminalMarker`）= run 终态留痕**：`✓ 已完成 / ✕ 失败 / ⏸ 已停止` + `用时 Xm` + 一条 hairline + 操作（`查看结果`/`查看详情` 走 `onOpenGoal`；`产出文件夹` 在有 `workspacePath` 时直接 `revealItemInDir`）。让结果沉淀在对话里，而非划过即逝的 toast；goal 即使已 `result_seen` 从 active 列表移除，回看仍在。
- **live 归外围**：实时倒计时 / worker 明细 / 停止仍只在 TopBar pill；章节框只在粗粒度状态转变时变（开始 → 进行中 → 终态），不做每秒 ticker（与 §2.7、sidebar/epigraph 的"live 归外围 chrome"一致）。
- **数据与关联**：标记数据来自只读命令 `list_goals_for_session(masterSessionId)`（全状态，含已读终态）。`annotateGoalThread`（`lib/goal-thread.ts`）用 **objective 文本 + `startedAt ≈ createdAt`** 启发式把 goal 关联到对应的 objective user-turn（消息行不持久化 goalId，恢复后靠此重建）；未命中则优雅退化为无标记的（仍降权的）叙述。run 的收口标记落在其叙述簇之后、后续普通对话之前。

#### Markdown 渲染

Final answer 跟 Thinking summary 都通过 `react-markdown` + `remark-gfm` + Shiki 渲染。LLM 输出的 markdown（标题 / 列表 / 表格 / 代码块 / 引用 / 链接 / 删除线）全部解析成对应 DOM，没解析的纯文本走默认段落。

**typography 映射**（每个元素 pull 现有 token，不引入新字号）。下表
px 值是三档字号系统的 **standard 档**——所有阅读面尺寸都由
`--conversation-*` 变量驱动（见 foundations.md「字号 scale」），**不要
在组件里硬编码 px**（2026-07-05 教训：块代码曾硬编码 13px，用户调大
字号时代码不跟随）：

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
| `![alt](url)` | `https://` 与绝对本地 raster 图片（png / jpg / jpeg / webp / gif）内联预览；本地路径支持 macOS/Linux 绝对路径、Windows drive path、`file://`；相对路径、`http://`、`data:`、`svg`、加载失败降级为图片链接 pill。首次解码时记录 natural 尺寸（模块级缓存，按 src 键），此后每次渲染带 `width`/`height` 属性——浏览器解码前即预留最终盒子，回访转录时图片不再 pop-in 推挤下方内容（2026-07-15） |

**视觉哲学**：每个 markdown 元素 reuse 现有 Newsreader / Inter / JetBrains-Mono token，不为 markdown 单独引入字号 ramp。整段对话读起来是一个 document，不是 stylesheet 拼贴。

#### 代码块语法高亮（Shiki）

- 引擎：[Shiki](https://shiki.style) v1+，TextMate grammar，跟 VS Code / Claude.ai web 同款
- 主题：跟随 Galley 当前主题，light 用 `github-light`，dark 用 `github-dark`
- 注册语言（hand-picked）：`bash` / `css` / `diff` / `html` / `javascript` / `json` / `markdown` / `python` / `rust` / `shell` / `sql` / `tsx` / `typescript` / `yaml` —— 14 种 coding agent 用户高频
- 别名：`js → javascript` / `ts → typescript` / `py → python` / `rs → rust` / `sh → bash` / `yml → yaml`
- 未注册的语言：fallback 到无色 mono code block（同样的 chrome，仅没 token color），不报错
- async render：第一次 highlighter 加载时显示 plain mono fallback，加载完替换；同 highlighter 实例 cache，跨 code block 共享
- 视觉容器：**无顶部 header 行**。圆角 6px + `border-line-strong` + 底色 `--color-code-surface`（内凹暖灰，见下方决策）。语言名 + copy/wrap 控件浮在**右上角**：语言名常驻（dim 10px mono uppercase，`text`/`plaintext` 等无信息语言名不显示），copy/wrap 在 hover 时 fade-in，三者都带 `bg-code-surface/85` backdrop 以压住底下的代码。
- 默认横向 overflow scrollable；hover 显出 wrap 切换，便于读日志、错误栈、长命令（对话区操作当前为 pointer-first，无键盘焦点路径——键盘故事整体待议）
- 流式期间保留上一帧高亮 HTML 直到新高亮完成（2026-07-05）：否则每个 chunk 都闪一次"无色→上色"；换主题同理。代价是内容滞后一次高亮周期（Shiki 热启动后仅数毫秒）
- **高亮结果缓存 + 度量恒等（2026-07-15，勿回退）**：高亮 HTML 按 `theme:lang:code` 进模块级 LRU（300 条）。转录在会话切换时整体重挂载，命中缓存的代码块**首帧即彩色**，plain→彩色交换不再发生。首次高亮的异步换入则靠度量恒等保证零回流：字体 / 字号 / 行高已由容器钉死，剩余变量是主题对 markdown/diff token 发出的 bold/italic——字形宽度不同会移动折行点、改变块高。用 `!important` 中和（Shiki 是内联样式），高亮从此 **color-only**，这是有意取舍：牺牲主题的字重表达，换"什么时候高亮到达都不影响布局"

**Copy 按钮**：hover-revealed（11px Phosphor `Copy` thin + uppercase "Copy"，复制后变 ✓ + "Copied" 1.5s），复制内容是**纯代码**——不带 ` ``` ` fence、不带 markdown chrome。Claude.ai / ChatGPT / Cursor 的肌肉记忆位置。

**2026-06 密度与分离 pass（决策留痕，勿回退）**：

- **去掉顶部 header 行**：它占一整行；当语言名被抑制（`text` 等）时只剩一条死白带。改为右上角浮动控件后，框身就是代码本身。语言名挪到右上角而非左上角，是因为代码顶格起排，左上角标签会压在第一行字上。
- **紧凑间距**：正文 `py-1.5` + 代码 `leading-[1.45]`，并**显式归零** `pre`/`code` 的 margin/padding（`[&_pre]:m-0 [&_pre]:p-0` 等），堵住 Shiki / UA 行盒漏进来撑高单行块的纵向空白。
- **首尾空行裁剪**：按行剥掉围栏内容的首尾空白行（兼容 `\r\n`），LLM 常带的前导空行不再渲染成框内浪费空间（`trimCodeBlankEdges`）。
- **底色方向（关键，别再"优化"回去）**：代码要读作"嵌进纸里的另一种介质"，所以 `--color-code-surface` 必须**与页面 `--color-app` 拉开、且与行内代码 `--color-hover` 同族**（浅色 `#F2F1F0`，比纸暗；深色 `#201D1A`，比近黑的纸略亮——深色下"下沉"靠微微抬亮表达，与 `--color-hover` 的关系一致）。曾经用过的比纸更白的 `bg-surface` 会让代码框糊进对话流、几乎不可辨——这是被明确否掉的方向。

V0.1 不做：代码块行号 / Edit 在行内（V0.2 候选）。

#### Message Actions（reply 级行动条）

每段 agent final answer 下方常驻一行 muted 行动条（DESIGN.md §4.3 dogfood 反馈：用户经常想保留 reply 内容）：

| 按钮 | 行为 |
|---|---|
| `Copy` | 复制原始 markdown source（带 `**bold**` `## headers`），不是渲染后纯文本——用户粘贴目的地（Notion / Obsidian / Slack / 邮件）多数能 re-render markdown |
| `Save` | Tauri save dialog → `.md` 文件。默认文件名 `galley-{YYYYMMDD-HHmmss}.md`（产品名前缀；`ga` 保留给内核，与图片保存的 `galley-image-` 同族），用户可改 |

**复制入口统一（`ActionChip`）** —— 按"常驻 vs 触发浮现"两类组织，全部共用一个
`ActionChip`（Copy thin 14px → Check success，1.5s 回落，quiet 1px press）：

- **常驻**：assistant 回答末尾的 reply 行动条（`Copy` + `Save`），bare chip、贴答案
  下方左对齐、一直可见。
- **触发浮现**：用户做动作才出现的复制，统一为 `floating` 变体（实底 `bg-elevated`
  + `border-line` + token 投影，非 glassmorphism），贴相关内容浮出：
  - assistant 里**选中**文字 → 浮在选区旁（gutter）
  - user 消息上 **hover** → 浮在高亮块**右上角外侧**（2026-08-05 起；原为覆盖在块
    内，靠 `pr-10` 留出横向余量。块改为宽度随内容后，那段预留会在短消息上暴露成
    40px 空白拖尾，故把 chip 移出块外。仍共享块的 hover 区域，归属不丢；不占布
    局、不碰 turn 间距。2026-08-06 高亮笔改版沿用：chip 贴 `w-fit` bbox 即最长
    笔触行的右上角）

一条规则统摄：**常驻操作在回答末尾的 bar 里；触发式复制是一个浮动 chip，贴触发的
内容浮出。** bar 里用 bare chip，浮动的用 floating chip。

视觉（2026-07-05 回写为 icon-only 现状）：

- 位置：reply markdown 渲染**正下方**，gap 6px (`mt-1.5`)
- icon-only chip（14px Phosphor thin），无文字标签；标签在 Radix
  tooltip / aria-label 里
- **常驻可见**（不 hover-only），text-ink-muted；hover 升 ink-soft + bg-hover
- 点击后 icon 变 Check（`text-success`）1.5s 后回 idle；tooltip 随状态
  切换（悬停绿勾时读到「已复制」而非「复制」）

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

#### 会话切换：原子换入，不做 skeleton（2026-07-15）

首次访问某会话（本次启动内未加载过、SQLite 有历史）时，`activateSession` **先等转录进内存、再翻 `activeSessionId`**：旧会话画面保持到新转录可以一次 commit 整体换入，"新会话 + 零消息"的空白帧不存在于渲染序列。冷启动（无旧画面可保留）与回访 / 新会话（无需恢复）仍即时翻转。延迟翻转的竞态守卫有两重：activation epoch（快速连点时新点击拥有指针）+ 指针快照（`createSession` / 删除等旁路直写 `activeSessionId` 时过期恢复不得翻回）。

**Skeleton 被明确否决**（决策留痕）：本地 SQLite 读是几十毫秒级，为"本不该被感知的等待"做占位是把它制度化；聊天转录结构不可预测，灰条必然与真实内容对不上（双重跳动）；shimmer 属于动效分类学要删除的 B 类环境动效。正确野心是**让加载态不存在**，而非装修加载态。spinner 保持只用于真慢的事（LLM / 工具 / bridge / 网络），SQLite 路径上不出现任何 loading 指示。

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
- **浮动按钮**：`atBottom = false` 时出现 32px 圆形 ghost 按钮（⬇ ArrowDown thin），**水平居中、贴对话列底部 16px**——实现时从"右下角"改为居中（代码注释记录了理由：右下角与 Composer 动作簇视觉打架），2026-07-05 回写
- **双态信号**（2026-08-07，[devlog](../devlog/2026-08-07-scroll-button-two-state-signal.md)）：箭头永不变（永远回答"点了去哪"），按钮上叠加状态信号，两种视觉语法各自自解释——
  - **运行中**：圆周向外扩散的 pulse ring（`scroll-live-ring`，动 = 内容正在下方落地）；run 结束 200ms 淡出
  - **完成且未读**：右上 45° 静态杏色小圆点，pop 弹入后落定（`scroll-unread-pop`，静态徽标 = 有完整答案在下面等你）——**边沿触发的真未读**：仅在 run 结束瞬间用户不在底部时置位，回底即清，全程看着答案生成的用户永远不会见到它
  - reduced-motion：ring 退化为静态低透明度光环、dot 跳过弹入，语义靠存在本身承载
- 点按钮 → smooth scroll + 监视器**追移动靶**：流式增长时对新 `scrollHeight` 重发 `scrollTo`，1600ms 超时则瞬时 snap；除用户中途主动上拉外，点击的结局必然是 `atBottom = true`（重新挂上跟随）——点击语义是"挂上尾部"，不是"滚到某个坐标"（2026-08-07 修复追不上快流式的 bug）
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
- 圆角 12px / `elevated` 背景（浮起的输入卡；曾写 `surface`，2026-07-05 回写）/ 默认 1px `border-default`
- 上方留 1.5em，下方贴 viewport bottom（in-session）或居中（empty state hero）
- 附件已落地：`Paperclip` 按钮 + 拖放 / 粘贴图片三路收口（旧文案「+ icon 占位（V0.2 接 attach）」作废）
- 草稿按 session 驻留内存（切会话不丢半截消息）；进入会话自动聚焦

#### Submit 按钮（杏沙 CTA 例外）

- **Submit 是全局唯一用杏沙作为 CTA 填充的元素** —— 用户最高频元素，杏沙带来"亲和体温"
- Phosphor `ArrowUp` **bold** / 32px circle / 杏沙填充 / charcoal icon（thin 在 16px 实心圆上过细，落地时升 bold——刻意，勿"修"回 thin）
- Enter 触发，Shift+Enter 换行；**输入法组字中的 Enter 交给 IME**（`isImeCompositionKeydown` 守卫，中文优先产品的硬约束）
- agent running 时**位置替换为 Stop 按钮**（深琥珀填充 / Phosphor `Stop` **fill**，同上刻意加重），点击触发 abort；此时 footer hint 教 `/btw`（「Enter 发送」在运行态是谎言）

#### 常用提示词入口（V0.2.16）

位置：**Composer 内部右下角**，放在图片附件按钮左侧。常用提示词属于
「往输入框添加内容」的工具，和添加图片同组；LLM picker 属于模型选择，
不和它绑定。

- 形态：Phosphor `BookmarkSimple` thin icon，icon-only，32px 圆形 hit target；
  无边框 / 无底色，hover 才出现 `hover` tint，与图片附件按钮同视觉族。
- 点击图标直接打开提示词库 dialog；hover 只显示统一 Radix tooltip，不再打开
  quick-fill popover，避免鼠标擦过 Composer 工具区时误弹大浮层。
- 内置预设共 9 个，固定目录、只读、不可置顶排序。**这一板块同时是 Galley
  的能力发现 / 教学面**（2026-07-04 重构）：不再是「教用户把 prompt 写规整」
  的填空模板，而是「让用户一眼看到 Galley 能替他做什么」的能力菜单。因此
  每条预设写法上从「能替你做什么」切入，其中三条是**差异化能力展演**——
  整理本地文件（读本地文件夹 + 系统级、plan-first）、网页信息抓取（真实
  浏览器 + 登录态）、多源调研对比（多步 agentic 调研）。顺序：
  整理长文、事实查证、**整理本地文件**、翻译润色、**网页信息抓取**、
  审阅草稿、**多源调研对比**、整理表格、执行前检查清单——三条差异化项
  交错在 3 / 5 / 7 位，而非按频率堆在末尾（改了此前「严格按频率排序」的
  约定；理由：920 dialog 一屏看全 9 张，交错让惊喜卡片在动线里更显眼）。
  刻意不含 Goal——重武器，避免新用户初期心智负荷。
- 每条预设带一个面向用户的 `description`（一句话，「Galley 用这条能替你做
  什么」），随 UI 语言本地化；数据模型上 `description` 是 `PromptPreset` /
  `ResolvedSavedPrompt` 的可选字段，只有预设携带，自定义不带。
- 常用提示词入口采用 pointer-first，不进入键盘 Tab 顺序，也不显示 focus ring；
  避免桌面 WebView 把焦点态误读成“选中”。
- Dialog 顶部不显示可见副标题；尺寸约
  `920x680`，读作 Settings / Earlier / Archived 同族的工作台，而不是小确认窗。
  主体为工作台式 `bg-app` 画布 + 卡片平铺，分两个 group：上方「预设」（常驻
  可折叠的模板库，固定顺序），下方「自定义」（用户可上移 / 下移调整顺序）。
  整张卡片点击即预填 Composer，不自动发送；hover 卡片时显示查看 / 管理按钮。
- 卡片承载摘要，两种形态：**预设**卡片显示 标题 + `description`（面向用户的
  能力一句话，正文指令原文移到阅读页——卡片更干净、读作能力菜单）；
  **自定义**卡片无 description，保持 标题 + 4 行正文预览（用户自己写的正文
  即摘要）。**卡片高度贴内容、不定高**（2026-07-04）：预设卡片一到两行内容
  自然收紧，自定义卡片按正文预览撑高，两者在各自 group 内一致、跨 group 不
  强求等高。hover 操作按钮放**右上角**（不占底部预留带——底部留带在短卡片上
  读作浪费），24px 命中区（在 20px 太小误触、28px 太笨重之间），标题
  hover 时右侧留出空位让 truncate 省略号避开按钮。操作区整块吞点击——角落
  near-miss 不会穿透触发整卡的「填入」，避免误触。需要看完整 prompt 时，hover 点“查看”进入同一 dialog 内的完整
  阅读页（预设阅读页在标题下也显示 description）；阅读页提供返回、填入输入框，
  以及预设复制为自定义 / 自定义编辑。复制预设为自定义时只带 title + body，
  description 不带（复制后它就是用户的一段文本，回退正文预览）。
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

设计判断：这既是高频便利入口，也承担能力发现（2026-07-04 起，见上文预设
重构）。但它仍留在 Composer 工具组、按点击展开，**不回到 Empty State 下方的
quick prompt 建议**——能力发现靠"用户主动打开库时看到能力菜单"，而不是把内容
铺在空状态里打断安静书桌（空状态保持安静的决策见 Empty State 一节）。

#### LLM 切换器（V0.1）

位置：**Composer 内部左下角**。

- 形态：LLM displayName + `CaretUp` thin（popover 向上开，箭头指向开启方向；旧文档写 CaretDown 已回写）。模型名本身已承担语义，不再显示
  Cube icon。
- Ghost button / hover `hover-tint` / 13px Inter / 28px 高
- 点击展开 popover：
  - `surface-elevated` 背景 + `shadow-elevated`
  - 圆角 12px / 内边距 8px / 每行 32px
  - current 项左侧杏沙 ✓
  - 切换中 spinner（`CircleNotch`）未实现——切换足够快，V0.2 再议
- agent running / waiting approval 时不可切换：`aria-disabled` + 点击
  no-op（不用真 `disabled`——禁用元素吞掉指针事件，解释性 tooltip
  「运行中无法切换」永远弹不出来；这条规则适用于所有带解释 tooltip
  的禁用控件，Radix `TooltipLabel`，禁原生 `title`）
- 长列表在 popover 内滚动（`max-h min(60vh,360px)`）
- displayName 由 bridge 按 runtime 边界生成：external GA 显示完整 raw name；managed GA 显示 Galley Models 里的显示名或原始 model id（详见 IPC 协议）

#### 审批模式（并入 LLM pill，2026-07-20 定稿）

审批模式（自动执行 / 逐步审批）**没有独立控件**——它是会话配置的一部分，
与模型选择共用同一个 pill 和同一个 popover（第四次修订收敛于此：独立
pill 无论文字还是收放形态，都让一个几乎永远等于默认值的设置与每刻都有
信息量的模型名争夺层级；合并后主从关系由结构表达，不需要任何解释）。
TopBar 无任何审批徽章（见 layout-and-chrome.md 历史注记）。

- **Trigger**：模式图标（`Lightning` = 自动执行 / `HandPalm` = 逐步审批，
  12px thin）+ 模型名 + `CaretUp`。图标永远显示当前会话生效模式——
  控件即状态；模式名进 tooltip / aria。
- **Popover 结构**（自上而下，主从分层；五次修订定稿——两行状态陈列
  + 两行设置深链让从属区几乎与模型列表等高，体积破坏主从）：
  1. 模型列表（主，12.5px，现规格不变）；
  2. 分隔线 + **统一动作栏**（11px `text-ink-muted/70`，与「配置模型…」
     完全同款行样式——全 popover 只有"内容 / 动作"两个字号层级，不设
     中间档）：
     - `改为{另一模式名}`（`✋ 改为逐步审批` / `⚡ 改为自动执行`），点击
       即切。**popover 里的行是动作不是状态陈列**——当前值已由 trigger
       图标表达，二元模式只需要"切到另一边"这一个动作；目标模式描述
       进 aria。
     - 末行「配置模型…」（`Gear`，导航项殿后）。**不放审批设置深链**：
       默认值属低频设置，TopBar 齿轮两步可达，为捷径付出双 Gear 行不值。
     - **无任何条件行**——不存在「恢复跟随默认」：见下方覆盖语义。
- **运行中语义**（合并后的关键行为）：`stopMode` 只封锁**模型切换**
  （模型行置灰 + 区顶一行「运行中无法切换 LLM」小字），popover 本身
  照常打开，审批模式区保持可点——`set_yolo_mode` 即时生效，跑着的
  会话切「逐步审批」正是"我要开始盯着"的合法动作。
- **覆盖 = 偏离默认**（2026-07-20 终修，取代最初的「显式选择即覆盖」）：
  在 pill 里选了与当前默认相同的模式，数据层直接清除覆盖（写 NULL），
  而不是写一个恰好相等的覆盖——动词行 UI 下"改回去"的心智是撤销，
  不是钉住；切去再切回必须完全复原、零残留。由此「恢复跟随默认」行
  成为动词行的纯冗余，已删除。偏离中的会话若默认值事后被改到与之相等，
  覆盖静默留存（行为无异；默认再改走时该会话钉住不动——用户当初的
  偏离是有意的，不随默认反复横跳）。
- 会话级切换一键生效、不弹确认；重确认只存在于 Settings 把**新会话
  默认**切为自动执行时（`AutoDefaultConfirmModal`，Settings 专属）。
- EmptyState 的同一 pill 配置**下一个新会话**（pendingApprovalMode，
  与 LLM 预选同生命周期：createSession 消费、必清除）。

#### 不显示

Context Window / 价格 / token estimate（V0.1 拿不到 + 信息噪音）

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

- Composer 居中（含 LLM 切换器，跟 in-session 对称），placeholder 是 "交代什么？"（commissioning 语气；en "What should Galley do?"）。与项目内变体 "在 {Project} 里交代什么？" 同构。2026-07-04 收口：此前实现漂移成 21 字的本地文件功能问句，按 austerity 回归纯 affordance；本地文件能力的教学由 saved prompts 预置模板承担（「本地文件整理」等四条含路径提示），不占空状态。
- **Composer hint 槽统一语法**（2026-07-04）：composer 下方的小字提示全应用只有一种长相——会话内「Enter 发送」hint 的 footer 槽（`mt-1.5 text-[11px] text-ink-muted`，左对齐卡片内容边缘），Composer 以 `staticHint`（ReactNode）对外开放。每条 hint 自带一个**内容级体裁记号**，形式自我说明、不加「tip:」类元标签：键盘 hint 用 mono 键位词，项目态「将创建到 {Project}」用 11px 文件夹小图标（提交后果陈述）。
- **全局空状态卡片下方刻意全空**：能力 tip 不放这里——2026-06-03「新人能力发现留给非空状态机制」的决策仍然生效。2026-07-04 曾试放一行本地文件 tip，三轮打磨（居中独立行 → 统一 hint 槽 → 拟加体裁记号）仍破坏构图协调，当日删除。与 quick prompt 建议、快捷键 chrome 并列为勿回退项。
- **题词（epigraph）浮在 Composer 正上方**：一行状态绑定的维特根斯坦句（译文跟随软件语言）+ 德文原句常驻副行（更轻一档）。`font-serif italic text-[12.5px] text-ink-muted`，视觉明显次于 Composer——读作安静题铭，不是 header / banner；入场即冻结，不随状态实时变、不轮播（live pulse 归 sidebar status spine）。状态绑定：`silent`（无 session）→ Tractatus 7「凡不可说的，应当沉默」；`quiet`（有 session 但无运行）→ PI §19；`working`（≥1 运行）→ PI §43（也是 Composer 运行态声音所依的同一命题 *meaning is use*）。策展集与逐条理由在 `gui/src/lib/epigraphs.ts` 注释 + 2026-06-03 devlog。
- **题词可静默点击**（2026-07-21）：点击题词把一段解读请求预填进 Composer，用户按 Enter 才发出——空状态的本职是引出第一条消息，装饰自身成为零打字入口；用产品解释产品，而非手写静态注释。预填模板（通用增强版，二轮定稿）：完整出处署名 + 译文 + 德文原文 + 通用三问「在说什么 / 针对什么问题或立场提出 / 与今天的 AI · 大语言模型有什么关联或启发」。三味信息各有功能：署名解决弱模型识别（`epigraphs.ts` 每句带 `citeZh/citeEn` 完整引用——"PI §43" 弱模型展不开）、原文解决译本歧义、三问给答案结构；AI/LLM 关联一问是这些句子入选题词的真实理由，且不依赖产品自指。静止态与纯铭文逐像素一致（无下划线、无边框、无提示文案），hover/focus 才有极轻墨色上浮 + pointer——可发现性靠自选择：会被句子困住的用户恰是盯着它看的用户。守卫：composer 已有用户草稿时点击不覆盖（仅聚焦）；重复点击自身预填幂等。未配模型走 requiresModelConfig 正常降级。对 PI §43 这一交互即命题自身的演示（meaning is use——点击即用法）。Rejected：点击即发送（误点烧会话 + 模型调用，不可反悔）；隐藏上下文注入（明面短句暗里附加——违背"用户所见即所发"的诚实原则）；逐句定制阐述维度（策展负担 ×3 句 ×2 语言，且预填越像 prompt 模板越不像用户自己的话）；一行短问句「这句话是什么意思？」（一轮方案，弱模型识别不稳）；hover 显示人工策展释义（在 AI 工作台手写注释自我否定）；保持纯装饰（晦涩对掠过者是氛围，对驻足者是痒处，而驻足者恰好会 hover 到）。
- Conversation width toggle 同样影响 Empty State：compact = 560px，wide = 1200px。用户在空状态点击 toggle 必须看到变化，否则像坏了。
- **不放 quick prompt 建议**（勿回退）：早期在 Composer 下方放过 4 条 serif italic 引导 prompt，2026-06 与题词打架——两坨安静 serif 夹住 Composer 稀释焦点，且在"沉默"题词下放"快说点什么"自拆其台——整段移除；新人能力发现留给独立的非空状态机制（详见 2026-06-03 devlog）。
- Sidebar 正常显示 Header / Quick Actions / timeline；Project Review 通过 Quick Action 进入；没有 session 时只出现一句 muted empty hint。
- **不放快捷键 hint 行**（曾尝试在底部加快捷键提示，但稀释了 placeholder 的聚焦感；完整快捷键列表移到 Settings → Shortcuts tab）。本地文件 hint 行不属此类，见上。
