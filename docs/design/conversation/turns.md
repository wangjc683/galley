# Turn 结构、你的消息与提问

> [Conversation 主区与 Composer](./README.md) 的一篇：2026-11-10 从 `docs/design/conversation.md` 拆出，正文原样搬过来。

### 4.3 Conversation 主区

#### Turn 结构

落定的运行（点开折叠头之后）：

```
                              [你的消息]         ← 靠右；下面 30px 是悬停复制那一行
┃ 曾向你提问 · 问题 · ✓ 候选                      ← 中途提问的回显（靠左）与你的回答（靠右），按时间顺序留在外面（见「ask_user 提问气泡」）
                              [你的回答]
▾ 9 步 · 用时 1 分 21 秒 │ 气味段                 ← RunFoldHeader（settled run 完成即折；live 时是「已完成 N 步」）；收着时贴着回复 10px
╭────────────────────────────────────────╮
│ 那一句话   ctrip.com                      │     ← 过程卡片：一行一步（24px），句子 + 浅色对象；满栏宽，没有数字行，不设行数上限
│ 那一句话   清单.md                         │        点一行原地展开那一步原来的样子（见「过程卡片」）
╰────────────────────────────────────────╯     ← 头到卡片 10px，卡片到回复 16px，不画 StrongHr
[Final answer，浮在文档里]                       ← 满宽，不放 callout
```

不在折叠头后面的照原样，仍是步骤区：在跑时的 live 窗口（最近完成的一步 + 在跑那一行）、停下的运行留在头下面的最后一步（见下「停下的运行」）、`/btw` 的整段平铺：

```
│ 01 summary ›                                   ← 序号栏（mono 补零）+ 12px ink-soft summary；› = DetailPanel（推理 / preamble）
│    旁白                                         ← 模型另写了 summary 时才单独成行；回声步的旁白就是 summary 行
│    [Tool pill / callout]                       ← 行动序列
│ 02 …                                           ← run 内步间 mt-2.5
─────────────────                                ← 稍深 1px 全宽 hr（行动 → 结论；平铺的运行有回答时才有，如 /btw）
[Final answer]
```

2026-09-23 按现状重画（此前的示意仍是「第 N 步 │」+ 独立 Thinking callout 的旧形态）。2026-10-16 折叠头后面换成一行一步（[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 6，票 02）：此前点开折叠头是上面这段步骤区，提问与回答也折在里面。规则一句话：折叠头后面的一律一行一步，不在折叠头后面的照原样。过程区的缩进、rail、live 两行窗口、裸步合并、旁白回声步见下文 TurnMarker 与 Thinking Summary 各节。

**停下的运行：live 窗口原样定住**（2026-10-30，[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 9，票 04；此前整段平铺）：中止、出错、停在步数上限的一轮没有回答，按停止那一下只拿走在跑那一行，其余原样留着，重载、日后翻记录都一样：

```
                              [你的消息]
┃ 曾向你提问 · 问题 · ✓ 候选                      ← live 头后面收着的提问与回答拿到头前面，同落定的运行
                              [你的回答]
▸ 中途停下 · 4 步 │ 气味段                        ← 就是 live 头：字换了，数字不变，没有用时；点开是除最后一步以外的一行一步
│ 04 summary ›                                   ← 最后一步：live 窗口里那一步的阅读形态（序号、竖线、旁白、工具行）
│    [Tool pill / callout]
```

- **为什么**（裁决 9 第 2 条）：折叠头后面是过程，外面是结局；有回答的结局是回复，停下的结局是停在的那一步。停下以后接着给指示，要看的就是那一步（库里这样的 4 轮里 2 轮你下一句是「继续」）。与主对话同一条规则：停下不新铺东西，只拿走「在跑」的标记。没选照旧平铺（JC 不喜欢整段铺开），也没选全部收进头里（停下那一下你正在看的那一步消失，头下面空着）。
- **头**：`RunFoldHeader` 的 `stopped` 变体，就是 live 头那个元素：「已完成 N 步」换成「中途停下 · N 步」，N 是整轮的 `stats.stepCount`，同 live 头，停下那一下数字不变；词与文案键同主对话（`conversation.stoppedPartway`，裁决 159 第 4 条：三种退出原因分不出，只用一个词）。气味段照旧，没有用时（没有回答的运行不存用时）。默认收着；停下时开着就保持开着（`foldOverrides` 同一个 key）。
- **卡片**：一行一步，同落定的运行，卡片里是除最后一步以外的步，只做了提问的那一步照旧不进。
- **最后一步**：留在头下面，就是 live 窗口里那一步（同一个元素、同样的间距与竖线），点开照旧是那一步的细节。
- **提问与回答**：live 头后面收着的（在跑时不画），停下后拿到头前面，顺序同落定的运行（裁决 6）；还是窗口末尾的（你答完、它还没跑出下一步就停了），留在窗口里原来的位置。
- **判据**（`lib/run-groups.ts` 的 `stoppedPartway`，主对话同一个）：不在跑、没有回答、轮形可折（有开场、没有系统行，`/btw` 因此照旧平铺）、至少落定了一步，而且最后一步调过工具。最后一步只有 `no_tool`、又不是提问的，是 GA 自己收了尾，只是除了标签没话说，不是中途停下，照旧整段平铺（工作台库里 474 个收口步全有回答，这样的一轮还没出现过）。只落定了一步就停下的只留那一步、不画头，同「一步就答完的运行只有回复」；一步都没落定的照旧什么都不画。
- **按停止的那一下**：计划里停下的运行走 live 窗口同一条路（`lib/run-fold-plan.ts` 的 `stopped`），锚点、窗口成员、卡片的行都与停下前一帧相同，头、卡片、最后一步都不重挂载；变的只有头上的字。在跑那一行是 MainView 画的，随停下一起撤掉，它的位置在窗口下面收合一次 sweep（`SettleGap`，同一步就答完的落定，`--motion-slow`），下面的步数上限尾巴滑上来，贴着底部的长对话往下滑而不是跳。只放在眼前发生的那次，重载、切回来直接是定住的样子。
- 步数上限的尾巴「已达步数上限 · 回复「继续」接着跑」与输入框灰字「继续」照旧；出错照旧弹提示；侧栏「已中止 · 摘要」「已暂停 · 摘要」照旧。内置与外置运行时一起变；主对话的画法是「助手的对话」里的那一行，不受影响。

**一步就答完的运行只有回复**（2026-10-16，[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 7，票 01）：落定的运行只有收口那一步时，不画折叠头、步骤标记和 StrongHr；token 与上下文照旧在回复的悬停行里。判据只看步数（`lib/run-groups.ts` 的 `answeredInOneStep`），有没有推理都一样：库里 46 个一步回复里 0 个带推理或开场白。这样的运行也不会带工具：收口那一步按定义全是 `no_tool`（`isClosingTurn`），调过工具就多一步。代价是那一步的推理与开场白（DetailPanel）看不到，这一轮的用时也看不到：用时 2026-08-06 起只在折叠头上。在跑到落定的那一下，回复从 live 行下面滑上来，不跳：live 行占的那一行加一个段落间距在落定的那次收合里扫掉（`SettleGap`，同 `ExpandSection` 的动画）。两步以上照旧折叠；`/btw` 照旧整段平铺，没有回答的运行见上「停下的运行」；助手的对话本来就不画。

**没有 turn 之间的 SoftHr** —— TurnMarker 自带视觉重量 + 上方间距，承担 turn-to-turn 的章节分隔。不再有水平横线。

助手的对话不画折叠头和步骤区：在跑时只有三点气泡（你发起的一轮下面还有一行「在做什么 · 用时」），落定后两步以上的回复，悬停行里有一个「过程」按钮，点开是一张过程卡片，头一行是这一轮的步数、用时与 token，下面每步一行，点一行才展开那一步在本节步骤区里的样子，见「[助手的对话](./assistant.md#助手的对话2026-10-15)」。工作台折叠头点开的是同一张卡片，没有数字行、不设上限，见「过程卡片」的「工作台也用这张卡片」。

#### User vs Agent 三重区分（单侧容器，不是 IM 双侧气泡）

| 维度 | User | Agent |
|---|---|---|
| 字体 | Inter 500 | Newsreader 400 |
| 字重 | medium | regular |
| 锚点 | 杏沙气泡：`rounded-md`（12px）+ `bg-brand-tint` 平涂，无边框无投影 | 无 |
| 对齐 | 右对齐 · 容器靠栏的右缘、宽度随内容，上限 `min(80%, 560px)`，文字随内边距缩进 | 左对齐 · 满栏 |

**用户在容器里、助手是散文**（2026-09-17 起）。这是用户在 Claude.ai / ChatGPT / Codex 里早已习得的心智，也是我们两个设计源头之一（Claude.ai）自己的形态。它不是 IM：IM 是**双侧**气泡，工作台只借单侧容器（2026-10-16 起靠右，是 ChatGPT「你的在右、回复是散文」的样子），助手回复保持纯散文无底色，"提问（色块锚）→ AI 回复（要读的内容）" 的层次不变。

**靠右**（2026-10-16，[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 2，推翻 2026-09-17 起的「不要 right-align」）。原来的两条理由：「一份文档一个阅读左缘」，760px 栏里用户的话靠右、Composer 满宽左起、agent 散文左起，眼睛要两边跳；气泡右缘会与 Question Rail 的点挤在一起。前一条的代价小：你的话中位 19 字，ChatGPT 就是你的在右、回复是散文，是用户最熟的样子；后一条只在栏宽撑满主区时发生，气泡自己内缩就解开（见「[Right Question Rail](#right-question-rail)」）。助手的对话先改到右边（2026-10-15），从助手点子任务卡片进工作台，你的话从右跳到左，读作割裂，这是改的起因。**不要边框、不要投影**——content 是纸、chrome 是材质（2026-08-21），投影在 Galley 是控件语汇，平涂是气泡不滑向卡片的那道线。**不要小尾巴**——纯 IM 装饰。

**两边的分界：语法统一，密度按关系与工作分**（2026-10-16，[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 1，取代[主聊天 PRD](../../../.scratch/main-chat/PRD.md) 裁决 73 第 4 条里的「助手像 IM、工作台是文档」）。语法两边一样：你的话在右，发送时间是两条消息之间居中的一行，一步就答完的回复上面什么都不画。密度各按各的：助手管关系，回复也装进气泡，过程收进悬停行里的按钮（裁决 66–69）；工作台是办公室，回复是纸上的散文（47% 带表格、23% 超过 1500 字），过程常显一个折叠头，在跑时有 live 窗口，你的消息照旧有悬停复制。「不要边框、不要投影、不要小尾巴」两边都守。见「[助手的对话](./assistant.md#助手的对话2026-10-15)」。

长对话里气泡是用户**回找自己提问**的主视觉锚（08-06 A/B 证明色彩面积是滚动扫视真正依赖的信号，容器的色域比逐行笔触只多不少），也是 submit 置顶、Question Rail、`data-role` 的锚对象。

#### 杏沙气泡（2026-09-17 起；此前 08-06 高亮笔、05-14 callout 色板）

起因：「死板 / 硬 / 平」的实感在 08-05、08-06、08-21 出现三次，两轮实验（高亮笔重设计、沉积 × 圆角质感实验）后仍未落地，说明治的不是病根；而**真正的容器形态从未进过切换器**——08-06 测的是 slab vs 纯排印 vs 笔触，08-21 测的是 5px 纵向 padding 的笔触加 4/6px 圆角。「经典气泡」拆成零件看，只有投影与我们的纸墨寄存器硬冲突，容器、平涂、圆角在内容层本来就存在（Notion callout、ToolCallout）。真机三变体（A 高亮笔 / B 左气泡 / C 右气泡）× 两档圆角（12 / 16）实测，我的推荐与 JC 裁决一致：**B 左气泡、12px**。全过程见 [devlog](../../devlog/2026-09-17-user-message-bubble.md)。

定案形态：

- 容器 `w-fit rounded-md bg-brand-tint px-3.5 py-2.5`，无边框无投影，靠对话栏右缘（`ml-auto`），宽度随内容、上限 `min(80%, 560px)`（2026-10-16 起；此前贴左缘、`max-w-full`，见本节末条）；
- **圆角 12 不取 16**：单行短消息高约 45px，16 已近半高，「好」「继续」会变成一颗药丸进 chip 语汇；12 与 ToolCallout 同档，机器与人同样圆润，08-06「机器圆润、人方正」的倒挂反向解除；
- **文字左缘随内边距缩进 14px**，不再与 agent 散文栏对齐（那是高亮笔时代靠偏移 box-shadow 出头换来的性质，随笔触一起退出）；
- 粘贴内容里的空行留在容器内（高亮笔不给空行上色，一条消息在视觉上碎成几截，是气泡补上的具体缺口之一）；
- `line-clamp-6` 折叠、附件缩略图、`data-role` / submit 置顶 / Rail 机制全部不变；工作台的悬停复制 2026-10-16 起在气泡下方、右缘对齐气泡右缘（此前在气泡右下角外侧 `left-full ml-1.5`，09-18 前在右上），见下方「复制入口统一」；
- **不给普通消息加 eyebrow / 图标**。断点发送时间行不算，见下方「发送时间」。（2026-08-06 定这条时的理由是不稀释 Goal 委派标记的加冠行；Goal 已于 2026-10-13 移除，再有给消息加装饰行的提议时，先重审这条。）
- **助手的对话里**悬停时是复制 · 引用 · ⋯ 三颗（2026-10-19，裁决 105，推翻裁决 73 第 1、2 条的「没有悬停复制」），2026-11-06 起挂在气泡左边、底边对齐（裁决 199；此前在气泡下面一行），选中文字照旧弹选中工具条，工具条在时它们让位（裁决 108），见「[助手的对话](./assistant.md#助手的对话2026-10-15)」与下方「复制入口统一」。
- **2026-10-16 改到右边**（[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 2）：09-17 真机比过 C 右气泡，输给 B 左气泡，理由是一个阅读左缘与问题轨；10-15 助手的对话先改到右边（主聊天 PRD 裁决 66、67），两边一左一右读作割裂。两条旧理由为什么不再成立，见上「User vs Agent 三重区分」。

随之继承 / 消解的旧决定：

- **2026-06-20 排印统一不动**：Inter medium 同字号保留。容器加上后字重对比是否成了双重信号，是独立重审（见 deferred「用户消息排印微调」），本次不捆绑。
- **2026-08-06 高亮笔的方法资产保留**：「滚动回找靠色彩面积、静读辨声靠排印」的任务拆分与 A/B 结论仍成立，气泡是在这个结论上换了形状；「人的声音不穿机器外衣」的寄存器论证仍成立，所以气泡无投影。
- **2026-08-21「不给抬升」仍有效**：以后再有「让用户消息更立体 / 更有卡片感」的提案，先回到那一条。

#### 发送时间（2026-09-28 起：只在断点常显）

用户消息只在**断点**显示发送时间，其余消息不显示，也没有悬停时间。讨论、数据与两轮真机见 [devlog](../../devlog/2026-09-28-user-message-send-time.md)。

- **断点**：会话第一条用户消息；距上一条用户消息**超过 60 分钟**；与上一条用户消息跨了本地日期（兜底，保证「今天 / 昨天」不缺席）；经 Galley CLI 进来的消息（`via` 为 `supervisor` 或 `cli`，图标行本来就在；`cli` 自 2026-10-27 起，[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 8）。ask_user 回复也算用户消息、参与比较。规则与格式在 `lib/message-time.ts`，Conversation 算一次、往下传字符串。历史分页加载时（见[长对话按轮分页](./streaming-and-scroll.md#长对话按轮分页2026-10-13)），第一条已加载的用户消息与 Core 给出的「页前最后一条用户消息」的时间比较，断点与整段加载时相同，往上翻加载更多不会让时间行出现或消失。
- **格式**：精确到分钟的绝对时间，不用「3 小时前」（会漂移、截图失真）。当天 `16:05`；当天但上一条在之前某天 `今天 09:10`；`昨天 21:14`；今年更早 `9月21日 14:32`；往年 `2025年9月21日 14:32`。中文 24 小时制补零，英文按 en-US 12 小时制。「今天 / 昨天」过零点经 `useDayStamp` 刷新。
- **位置**：两条消息之间居中的一行（`MessageTimeDivider`），属于整段对话，不贴在你的气泡上；上面 16px、下面 20px；工作台里紧接在回复下面时上面不再加（回复的行动条隐藏时照旧占着 30px：回复正文到时间条 30px）。主对话 2026-11-06 起气泡下面没有占位，紧接在气泡下面也是上面 16px（裁决 199，见「助手的对话」的「时间：居中」）。2026-10-16 前工作台画在气泡上方独占一行、左对齐（`mb-1`），与来源图标同一行；现在来源图标（「Galley 创建」「Galley CLI」「定时任务创建」）留在气泡上方、靠右，与时间分开（[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 3）。断点规则不变：工作台没有问候，照旧只跟你的消息比。助手的对话问候上面也有一条，第一条用户消息跟问候比，见「[助手的对话](./assistant.md#助手的对话2026-10-15)」。
- **样式**：`text-ui-micro`（10.5px）+ `text-ink-muted/70`，sans、tabular、`select-none`、`<time dateTime>`；悬停给带星期的完整时间。对比度约 2.3:1（浅）/ 3.2:1（深），低于 AA——只因它是可有可无的辅助信息、tooltip 兜底才成立，**不是正文元数据降透明度的先例**（09-23 折叠头气味段降到 70% 就因不可读被否）。
- **与「不给普通消息加 eyebrow / 图标」的关系**：那条防的是每条消息都戴的装饰行；时间行稀疏（首条 + 断点）、最浅墨色、无品牌色与大写字距，不算。
- **不做**：悬停时间（真机「有点吵，也没有必要」）；助手回答的时刻（长运行完成时刻见 [deferred](../../devlog/deferred.md)「长时间运行的完成时刻」）；问题轨卡片里的时间。

#### Right Question Rail

主区右侧 rail 的职责有两个：**question index**（一颗 dot / 一段 cluster marker 对应一次或一组 user message，多问题间回跳）和**回到提问开头的跳转锚**（单问题即成立）。它不是第二个 Sidebar，也不是 session 状态队列。

**为什么在右侧**（2026-08-10 裁决，维持右侧）：三条独立理由——① 滚动条家族语义：dot 按 `scrollHeight` 百分比定位，是位置比例型导航（滚动条 / minimap / scrollbar marker 家族，惯例在右），不是语义目录（Google Docs 大纲家族，惯例在左）；② 单侧单层级：左 = Sidebar 的会话间导航，右 = 会话内导航，改左会形成双 rail 贴排；③ 注意力分区：左缘是视线回扫路径，标记会被读作内容（git gutter 效应），右缘是「可及可忽略」的仪器位。唯一真实代价是 Windows 常驻滚动条的拥挤风险——解法是调 inset，不是换边。

- 自第 1 条 user message 起显示（2026-07-21 起；原门槛"少于 3 条隐藏"按 index 职能设定，误伤了锚职能——深度研究型对话恰是一问 + 数千字长回答，最需要回跳时 rail 缺席。单点 rail 不再是索引，但作为锚成立，且与长对话中已学会的交互完全一致）。键盘路径 ⌥↑/⌥↓ 与对话长度无关，始终可用。
- **主对话不显示**（2026-10-14，[主聊天 PRD](../../../.scratch/main-chat/PRD.md) 裁决 60，JC 同意）：rail 按已加载内容的比例摆点，主对话是一条没有尽头、从底部按页往上加载的对话——50 条提问时 85%–90% 的点并进胶囊，往上加载一页，每个点的坐标和序号都会变，索引和锚两个职能都立不住。`MainView` 在主对话里不渲染 `UserQuestionRail`；⌥↑/⌥↓ 在主对话里照常可用。其他对话照旧（含主对话派出的子任务）。
- 只含已加载部分的提问（[长对话按轮分页](./streaming-and-scroll.md#长对话按轮分页2026-10-13)），往上翻加载了更早的页就跟着变多；序号按已加载的数。点按已加载内容的高度摆，扣掉还有更早的页时上面的垫层（2026-11-02，票 123），垫层缩放时点不动。
- **气泡不贴轨**（2026-10-16，工作台对话票 01）：你的气泡靠右后，栏宽撑满主区时（小窗口；宽松档在不够宽的窗口）气泡右缘正好落在轨的点击区左缘：栏是 `px-8`，轨是 `right-3 w-5`，都在离主区右缘 32px。做法是气泡自己让出来，轨不动：往右挪会压到 Windows 常驻滚动条（离右缘 0–10px）与 macOS 悬停展开的滚动条，上面「为什么在右侧」的 inset 余量就是为它们留的。工作台的滚动容器是 `@container/conversation`，带上栏宽上限 `--conversation-column`（760 / 1200）；你这一行的右外边距取 `clamp(0, 8px − (100cqw − 上限) / 2, 8px)`，补足栏自己的外边距差的那部分，窗口比栏宽多出 16px 以上就是 0。回复散文照旧满栏，没有轨的助手对话不变。量得（Chrome，主区 640–1700 宽每 2px 一档，两档阅读宽度）：气泡右缘到点击区最近 8.0px，到点 14.0px，气泡最多内缩 8px。Windows 上滚动条已在内容与轨之间占了 10px，同一条规则下气泡离点击区 18px。
- 历史 dots 永远只表达导航位置：active = brand filled，inactive = hollow ring，cluster = vertical capsule。
- 只有最新 tail marker 可以临时承载 live 状态：running 时 single dot 替换为 Sidebar 同源的 brand `CircleNotch` spinner；waiting（ask_user）时替换为 warning `PauseCircle`。状态结束后恢复普通 dot / cluster。
- 最新提问落在 dense cluster 里时，保留 cluster capsule 和 hover list，再叠加同源状态图标；不能让状态图标吞掉“这里是一组提问”的导航语义。
- 右 rail 不展示 subline / badge / row tint。状态文案只进入 tooltip / aria：`进行中` / `等你回应`。跨区记忆来自同一套状态图标语法，而不是把 Sidebar row chrome 搬进文档区。

##### Hover tooltip 的内容契约

单 dot 的 hover tooltip 是**两行**（2026-08-03 起）：`序号 │ 提问` + 下方缩进对齐的**回答预览**。dot 数量不变——加第二行补的是**辨识**（"这一问我当时得到了什么"），不是导航；用增加标记来解决 tooltip 的信息量问题会把密度翻倍去换一个它解决不了的东西。

- 回答预览 = final answer 的**首个正文行**（跳过空行与 ATX 标题），再走与提问同一套 `buildPreview`（折叠空白、剥首个 markdown 标记、50 字预截）。跳标题是因为长回答高频以 `## 结论` 开头，预览成"结论"两字等于零信息。规则只跳标题、不跳代码围栏或列表标记——一句话能说完的规则才可预测。
- **不用 `AgentTurn.summary`**：它是 agent 的工作记忆而非给读者的概括。managed runtime 的 prompt 要的是"上次工具调用结果产生的新信息 + 本次工具调用意图"，GA 直接把它 append 进自己的 `history_info`；它指向下一步工具调用，而最终答案轮是 `no_tool`，没有"本次意图"可指，框架失配。预览应当是用户点进去会看到的东西的缩略图，那就是 final answer 本身。Sidebar 显示 summary 不构成同源理由——Sidebar 那一格的语义是 session 的**进行状态**（`第 N 步 · …`），不是某次问答的内容。**唯一的例外是兜底**（2026-10-16，[主聊天 PRD](../../../.scratch/main-chat/PRD.md) 裁决 89）：收尾那一轮除了标签什么都没写（没有 `<no-reply/>`、没有 `<subtask>`），话全写进了 `<summary>` 时，summary 当作这一轮的回答显示，否则什么都看不到；票 36 的真模型评测 95 次里出现过 4 次。规则在 `isSummaryOnlyReply` 与 `buildAgentTurn`，工作台与助理的对话同一条。**助手对话在跑时三点下面那一行**另说（2026-10-23，裁决 134、135；此前 10-19 裁决 100 起是顶栏那一句、一步没写旁白时写它的 summary，更早在对话末尾那一行）：那一行说的是进行中的状态，不是哪次问答的内容；写的是这一步 summary 的后半句（本次意图），见「助手的对话」的「在跑时：三点气泡」。裁决 68 第 4 条曾援引本条只读旁白，裁决 100 部分推翻了这条理由；这里的 tooltip 预览不变。
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
- 展开 / 收起走 `ExpandSection`（2026-09-16）：与 RunFoldSection 同一套
  grid-rows 0fr ↔ 1fr 过渡、同一 `--motion-slow`，过程区只有一种「展开」
  手感；此前是硬挂载 + fade-in keyframe。RunFoldSection 自 2026-09-16
  起也是 ExpandSection 的薄包装（2026-10-16 起它开合的是过程卡片，
  卡片里点开一步也走 ExpandSection）。
- 内容 = 该步的推理（无则 caret 不出现）+ 中间轮 preamble（当其未作为旁白
  单独渲染时）。推理来源（2026-09-23）：`turn_end.responseThinking`，即
  GA 的 `response.thinking`——原生推理（thinking block / `reasoning_content`），
  或模型按提示词写、被 GA 从 `content` 挪出去的 `<thinking>`；为空才回退
  `extractThinking(responseContent)`。此前 bridge 只发 `content`，原生会话
  路径上推理从未进过这里（1351 条 assistant 行 thinking 列 0 条），见
  [devlog](../../devlog/2026-09-23-live-thinking-preview.md)
- 展开后 Newsreader italic、`--conversation-thinking-size` 走三档字号
- 与流式期的 [Live Thinking Preview](./streaming-and-scroll.md#live-thinking-preview实时思考预览)
  同寄存器、同一列：实时看过的文字，落定后在 caret 后面以同一样式找回

#### Goal 章节框（已退役）与叙述 callout

（2026-10-13 Goal 移除，见 [devlog](../../devlog/2026-10-13-remove-goal.md)）委派标记、收口标记与暂停 / 受阻尾标随 Goal 一起删除，历史 Goal 会话按普通的用户 / 智能体轮次显示。

叙述 callout 保留：系统行（老库里的：socket `session.checkpoint` 写的叙述，以及 Goal v1 留在历史线程里的旁白；`session.checkpoint` 2026-11-10 删除，此后没有写入方）走 `SystemMessageBubble` `variant="narration"`（原名 `goal`），形态不变——细 brand 左规线（`border-l-[3px] border-brand-strong/30` + `pl-4`，无底色）+ 无字的小 `Target` 图标（thin 11px），正文 `[&_p]/[&_li]` 降到 `text-ink-soft`、字号走 `--conversation-narration-size`；「Galley」不逐条显示，归属挂在图标的 `aria-label`；连续叙述簇只在首条显示图标。

#### 停在步数上限 = 可恢复态（2026-10-01，[galley#29](https://github.com/wangjc683/galley/issues/29)）

一次运行跑满 GA 的单次步数上限（内置内核 180；外置 GA 以它自己的版本为准）时，引擎停在半途。线程尾挂 `StepLimitTail`（「已达步数上限 · 回复「继续」接着跑」），12px `ink-muted` + 粗体 12px `Pause`；不带停止按钮，因为没有在跑的东西。只在会话空闲时出现。配套三处：输入框灰字预填「继续」；侧栏写「已暂停 · {摘要}」，不说「已完成」，与中止会话写「已中止」同理；系统通知标题用同一句「已达步数上限」。状态只存在内存里，重启后消失。撞上限的运行最后一步不是收口答案，没有回答，与中止一样算「中途停下」（2026-10-30）：工作台里 live 窗口原样定住（工作台对话 PRD 裁决 9，见「Turn 结构」的「停下的运行」），助手的对话里收成一行「中途停下 · N 步」（主聊天 PRD 裁决 159，见「助手的对话」的「没有回答的运行」），尾巴都照旧。

#### ask_user 提问气泡（`AskUserBubble` / `AnsweredAskUser`）

Agent 经 `ask_user` 停下来问人的那条：实时态是 warning 左条 + `PauseCircle` +「等你回复」+ 候选 chip；回答后（或重启恢复后）退成 `AnsweredAskUser` 回显——2px 30% warning 细规线、无底色、echo 字号 ink-soft、无 chip（交互已结束，再摆 chip 会暗示可重答）。助手的对话里两种状态都是普通的左侧气泡，提问与回答不折进步骤，见「[助手的对话](./assistant.md#助手的对话2026-10-15)」。

- **落定后留在外面**（2026-10-16，[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 6，票 02；助手的对话同一条）：提问与你的回答是你和它的对话，不是步骤。落定的运行里，每一组回显与你的回答按时间顺序留在对话里、在折叠头之前（折叠头是回复的眉头，要贴着回复）：你的消息（右）→ 回显（左）→ 你的回答（右）→（再一组）→ 折叠头 → 回复。回显贴栏左缘，与回复同一个左缘。间距是两边各自的外边距合并出来的：你的消息下面的 30px（悬停复制那一行）到回显，回显到你的回答 20px，你的回答下面 30px 到折叠头，与没有提问时你的消息到折叠头一样。点开折叠头的卡片里没有只做了提问的那一步；同一步还跑了别的工具时那一行留着，点开是那些工具，问题仍在外面。
  - **只改画在哪里**：运行的分组、步数（照旧算提问那一步）、用时、token、问题轨的 replySet（回答仍是 `user-msg-reply`，问题轨与 ⌥↑ / ⌥↓ 不索引它）、`askUserReplyContent`、`chosenCandidateIndex`、侧栏「第 N 步」都不变。
  - **在跑时照今天**：没答时是对话末尾的实时气泡；答完接着跑，回显与回答在 live 窗口里，后续步骤落定后随它折进 live 头后面（收着时看不到，点开的卡片里也没有它们：它们不是步骤）；运行落定时出现在折叠头之前（收合的那一下就到位）。代价：live 头点开着落定时，折叠头与卡片会被往下推一组提问的高度。同期库里 `ask_user` 只有 7 次。
  - **没有回答的运行**（中止、出错、停在步数上限）：工作台里（2026-10-30 工作台对话 PRD 裁决 9）live 头后面收着的回显与回答拿到头前面，同落定的运行，还是窗口末尾的留在窗口里原来的位置，见「Turn 结构」的「停下的运行」；助手的对话里（2026-10-30 裁决 159）提问与回答照旧是两边的气泡，排在那一行「中途停下 · N 步」之前，见「助手的对话」的「没有回答的运行」。

- **问题正文走 `MarkdownView variant="agent"`，不再是裸 `<div>`**（2026-09-14）。直接原因是社区反馈「AskUser 界面不能复制文字」：`body` 全局 `user-select: none`（foundations.md §2.6），内容面靠 `select-text` 逐个开回来，用户消息 / agent 正文 / 工具输出都开了，唯独 ask_user 问题漏了。顺带收益：GA 提问里常见的编号选项、路径、行内代码得到与正文相同的 markdown 排版（暖褐行内代码、列表缩进），字体寄存也与同一黄框里的 side_question 一致（CJK 衬线）。
- **单换行保留为换行（`softBreaks`，remark-breaks）**。GA 的 `ask_user(question)` 只是透传字符串，TUI / Telegram 前端按纯文本打印，从没承诺过 markdown；LLM 写「第一行\n第二行」时若按 markdown 软换行合并，两个问句会并成一句、改变问题意思。remark-breaks 只碰段落内的软换行，列表 / 代码块 / 空行分段不受影响，所以 markdown 形状的问题仍得到完整处理。这是 `MarkdownView` 上的 opt-in prop，**只给 ask_user 用**——agent 回答是按 markdown 写的，软换行就该是折行。
- **回显与实时态同一条渲染路径**：`AnsweredAskUser` 同样走 `MarkdownView` + `softBreaks`，用 `[&_p]/[&_li]` 覆盖到 echo 字号 + ink-soft，同一段文字实时与回显只差大小和墨色。
- **Composer 占位随候选数变**：有 chip 时「回复，或选择上方候选」，无 chip 时「回复上方提问」（`composer-register.ts` 的 `reply` / `replyOpen`）。`candidates` 是可选参数，模型对开放式问题常不给；无条件的「选择上方候选」会让人去找不存在的选项（2026-09-14 真机验收即如此）。
- **候选两种排布，由 `candidateLayout` 按内容定**（2026-09-14）：短标签（是 / 否 / 方案 A）走行内 chip，句子级选项（单条超 20 字、合计超 60 字）或 5 条以上走**竖排列表**，每行全文不截断、左对齐；列宽取最长一条（容器 `inline-flex` 收缩、各行拉齐），不撑满对话列——撑满时短选项后面留一整片空白（2026-09-14 真机）。横排一行句子会折成标签云，丢掉模型写的 A / B / C 顺序。阈值是导出常量，dogfood 后可调。同一函数同时喂实时气泡和回显，两处永远做同一个判断。
- **chip 两条路径**：点击 = 直接发送（快路径，保留）；右键「填入输入框」或 ⌘ / Ctrl + 点击 = 填进 Composer 不发送（慢路径），给「选 B 但改两个字」留出口。走 `ComposerHandle.prefillText`，不加新的 store 状态。chip 仍是按钮、不可选中（foundations §2.6 chrome 不可选）；复制 chip 文字的需求由填入路径覆盖。
- **回显列出当时的候选并勾出所选**：`AnsweredAskUser` 用同一排布把候选以 ink-muted 列在问题下方，用户点选的那条 ink-soft + `Check`。判定是「回复用户消息全文 === 候选全文」（`chosenCandidateIndex`），自由回复或填入后改过的都不勾——用户消息就在下面。一个月后回看只见「B」不知 A、C 是什么，这是档案价值。回复消息由 `askUserReplyContent` 按 run-groups 的成员规则定位（ask_user 之后的下一条 user turn，跳过 system），与折叠 / 问题轨共用同一份 replySet。
- **同一轮多次同问题 ask_user 视为一个**（2026-09-14）：有模型把候选拆成 N 个单候选调用（grok-4.6），runner 与 GUI 读取侧都按「问题相同则合并候选、不同则取首个」处理（`mergedAskUserArgs`），折叠头「提问 N 次」按问题数计。持久化的 tool_calls 不动。
- **不接的东西**：不开 `selectionCopyScope`（浮动复制工具栏语义是「复制回答」），不挂 `MessageActions` 的 Copy；不给候选加数字键（暂不考虑键盘用户，2026-09-14 JC 裁决）。
- **提问不切断 run 的计数**（2026-09-18，[devlog](../../devlog/2026-09-18-ask-user-run-continuity.md)）：ask_user 让 GA 循环退出、回答再起一个循环，引擎侧步号与计时都按「段」重来；GUI 把段合回一个 run——序号栏与侧栏「第 N 步」按 run 内位置连续编号，折叠头用时、答案脚注的 token 数、右下角运行中 HUD 都是各段之和（等待回答的时间不计，只算 agent 在跑的时间）。settled 数字缺任一段的 telemetry 就整体留空，不显示部分和；HUD 是活体信号例外，缺段按 0 继续走。

#### Turn 编号 + 间距

**不是**用户↔agent 对话轮次，**是 GA 内部 agent loop 的 turn 计数**——每次 LLM call + dispatch = 1 turn。一个 user message 可以触发 GA 跑 N 个 turn（agent 不断 reflect + 调 tool 直到出 final answer）。这跟 PRD §7.5 sidebar session row 显示的 "Turn N · summary" 同一个 N。

- 数据来源：每个 IPC `turn_start` / `turn_end` event 都带 `turnIndex` 字段
- AgentTurn type 持有 `turnIndex`（一个 user message 在 conversation 里可能产生多个 AgentTurn）
- 渲染（2026-09-16 序号栏形态）：每个 AgentTurn 的 thinking summary 之上一行，左侧是**两位补零序号**（`01`…，`lib/step-numeral.ts`）占一格固定宽度的 **`--step-gutter`（24px）**，**JetBrains Mono、`--conversation-tool-mono-size`（标准档 11px，与行右端的工具名同一寄存器）**、regular、`text-ink-muted`，行高钉到 summary 的行框（`calc(step-size * 1.6)`）让两者基线同高；summary（ink-soft，12px 档，**行高 1.6、自动换行不截断**）从 gutter 右缘起笔。序号与 summary 之间**没有分隔符**——固定列宽本身就是分隔。DetailPanel 的 caret **紧跟 summary 文字末尾**（inline-block，随末行换行；裸数字步则单独立在 gutter 右侧），不停在列右缘——披露 caret 贴着它所属的文字，与 pill 行、折叠头同一条规则（2026-09-16）。**不用 italic、不用 serif、不用 uppercase tracking**——结构 metadata 冷静直立，与下方 Newsreader 衬线正文形成对比张力
  - **可展开行的应答**（2026-09-23，[devlog](../../devlog/2026-09-23-step-marker-hover-affordance.md)）：有 DetailPanel 内容的 marker 行是 `role=button` 披露控件（Tab 可达、Enter / Space、`aria-expanded`，可访问名取行内容，不设 `aria-label`），与 pill 行、折叠头同族：hover / focus-visible 在**内容列**（summary + caret）画 `bg-hover` 并提墨到 ink，即时无过渡；序号在框外，但悬停整行任一处都点亮内容框（`group-hover`）。框左缘 = 内容列 −10px，与 inline pill 的 hover 框同一条边，负 margin 抵消、文字 x 不变；上下不外溢，框即行框（live 窗口的裁剪框顶边贴着 marker 行，上溢会被切平）。summary 保留可选中，行内拖选不触发展开。提墨必须落在自带墨色的子元素上——行级 `hover:text-ink` 继承不到它们，此前正是这样悄悄失效的
  - **过程区 = StepRegion（缩进 + rail）**（2026-09-16 第二轮）：一个 run 的整个过程体（marker、narration、inline pill、block 卡片、ask_user 回显与用户回复、DetailPanel 原文）包在 `StepRegion` 里，整体缩进一格 `--step-gutter`，左侧 x=5（折叠头 caret 中心）有一条 1px `bg-line` 竖向 rail 贯穿全高。于是序号落在 24–48、内容从 48 起笔，和折叠头文字（起于 19）形成「把手在左、列表在右」——与参考 trace 组件的 24 / 47 同比例。**live 与 settled 同构**：未完成的 run（以及 /btw 等不可折 run）走 flat 的 StepRegion，rail 从第一步顶起；settled 可折 run 的 StepRegion 在 RunFoldSection 内，rail 从折叠头下缘（`-top-2.5`）挂下来。run 完成被重新包进折叠段时 x 不动。（2026-10-16 起折叠头后面不再是 StepRegion，而是一行一步的过程卡片，见「过程卡片」的「工作台也用这张卡片」；StepRegion 只剩不在折叠头后面的：live 窗口、in-flight 行、平铺的运行。）MainView 的 in-flight marker 也包一层 StepRegion（与上方 rail 之间有一小段断口，已知）。
  - **最终回答满宽**：StrongHr 之后的回答不在 StepRegion 里。为此 `answerOnly` 拆分扩展到**所有**有收口 turn 的 group（原只对可折 group）：收口 turn 的 marker 以 `markerOnly` 进区域，回答 flat 渲染。StrongHr 自己 `-ml-(--step-gutter)` 从缩进里破出来铺满列宽——「行动 → 结论」的横线属于回答的宽度。2026-10-16 起折叠的运行不再画 StrongHr（点开是卡片，卡片的边框已经分开行动与结论），它只剩平铺的运行有回答时（如 /btw）。
  - **内容列 x 的两处细节**：pill 按钮保留 `px-2` hover 外溢，外层 `-ml-2.5` 拉回 8px 外溢 + 2px Phosphor 字形内留白，图标可见笔画正好落在 summary 首字的 x；裸步合并的 pill 行自画 gutter。
  - **锚点靠对齐，不靠墨量，层级为 头 → summary → 序号**：summary 是这一行的句子，序号是页边序号栏，是这一步里最轻的元素（第一轮曾保留 medium 以保 Windows 可扫性，真机看后层级比可扫性重要，改 regular 并降 1px）。RunFoldHeader 的「N 步」是计数、sidebar 的「第 N 步 · summary」是独立语境需要单位，均不跟随；「第 N 步」文案（`copy.conversation.step`）保留为序号旁的 sr-only 文本，屏幕阅读器仍念完整语义。序号栏在 `index` 未知的 pre-turn_start 窗口也占位（`··`），步落地时状态文字不右跳。
  - **真机 A/B 裁决（2026-09-16，临时切换器已拆）**：序号字体 **mono 胜** Inter tabular——行的左右两端都是机器元数据说得通，mono 序号读作页边序号而非数量；折叠头计数段**保持 ink-muted regular**，ink-soft medium 的「把手比列表深」方案被否，08-06「安静眉头」定案维持。
  - **折叠头行内分层（2026-09-23，[devlog](../../devlog/2026-09-23-run-fold-header-hierarchy.md)）**：整行不加深，只让**数字**（步数、用时的 9 / 2 / 27）走 ink-soft，「步」「用时」「分」「秒」仍 muted regular——与 09-16 被否的整段加深加粗是两回事，行仍是安静眉头，视线在数字上有落点；数字 span 自带墨色，靠具名 `group/fold` 跟随整行悬停提墨。气味段、提问数、拒绝徽标降到 `--conversation-tool-label-size`（与它们概括的 pill 标签同档），`×N` 等宽；竖线两侧各 12px，行按基线对齐，读作「结构 | 气味」两组。气味段里 `file_write` / `file_patch` 排最前，其余仍按次数降序，省略号只吃泛泛的尾巴。live 变体同样适用。
  - **before/after 一致的新口径**（2026-09-16 二改）：thinking 态是「`··` 思考中 · 12.3 秒」，落定后是「03 summary」——同一组件、同一位置、同一寄存器，序号是落定时才出现的唯一差异（盖章）。这与外部 ReasoningTrace 参考组件（thinking 态无号、只给 settled 列表编号）同构；第一版曾让 thinking 态也带号，真机看 in-flight 的「01 正在处理」像提前盖章而改。**序号位的 `··`**（2026-09-16 三改，`PENDING_STEP_NUMERAL`）：同列同 mono 同 muted、两个中点正好两位序号宽，读作「下一项待落定」的空章。参考组件那一格放的是 Sparkles 脉冲，Galley 按 §2.7 不加动效源；空 gutter 曾是第一版答案，真机看是一段洞（刚提交、尚无落定步时最明显），三态真机 A/B（空档 / `··` / 无 gutter 齐序号列起笔）JC 明确选 `··`——守住网格，而无 gutter 的「状态行不是步」叙事要靠寄存器差异撑一整行。
  - **裁决史**：2026-06-09 瑞士化定「第 N 步 │ summary」（hairline 取代中点）；2026-08-23 裁「裸数字永久否决」；2026-09-16 JC 真机看过淡一档版本仍嫌繁琐，翻案为补零序号 + 去 hairline + gutter 对齐（见 [devlog](../../devlog/2026-09-16-step-marker-recede-and-reference-audit.md)：08-23 的「读者只扫数字」论据其实在替裸数字辩护；「3 │ 思考中 · 12.3s 两个数字打架」由补零 + 计数器带单位化解）。明知代价：run 边界处第 1 步的 chapter-break 分隔力略弱，靠 `mt-6` 与 settled run 折叠兜住；ink-muted 约 3.4:1 低于 AA，是既有的元数据档位。
- 上方间距**两档**（2026-08-23 密度 pass）：run 边界（第 1 步）`mt-6`（24px）承担章节分隔；run 内第 2 步起 `mt-2.5`（10px；2026-09-16 前是 `mt-3` 12px）。判据直接用 `index === 1`——序号按 run 内位置连续编号（2026-09-18 起 ask_user 回复后的第一步不再是 1），步号即 run 边界，无需穿 run-group 数据。**marker 下方 0、pill 无外边距**（2026-09-16 节奏 pass）：真机量得步内 marker→pill 行心距 25.5、步间 34，比例 1.3 分组不成立，四步七行看着像七行；步内收到 0 后步内约 22、步间约 34，比例 1.5+，每步净减 6px。**同日第二刀（数值微调）**：JC 看十步 run 截图仍嫌占地，量得一步行心距 55（summary 19 + pill 24 + 步间 12），留白约 58%，与 08-23 改前几乎持平——结构没动所以天花板还在。试了两刀都撤回：数值刀（pill `py-0.5` + 步间 `mt-2`，55→47）「太密集不舒服」；结构刀（pill 上 summary 行、放不下才折，一行步 31）「单个步骤的阅读体验变差」。结论：密度与阅读体验在同一套静态排版里无解，**按状态分**——两行 55px 附近是「阅读形态」，给 live 与主动展开排查的人；空间问题靠折叠解决（完成即折，见 [run fold PRD](../../../.scratch/conversation-run-fold/PRD.md) §2 修订），不靠挤压。最终数值：pill `py-1`、步间 `mt-2.5`，一步 53px。**折叠头→第一步 12px**（原 24）：头是列表的把手要贴住列表，24px 属于头上方的 run 边界（RunFoldSection `-mt-5.5` 编排）。2026-10-16 起折叠头后面是过程卡片，头到卡片 10px（头自己的 `mb-2.5`），`-mt-5.5` 编排撤掉。
- **裸步合并**（同一 pass）：GA 未产出 summary 的步，marker 行只剩纯数字——此时若该步恰好只有一个 settled-success 的 inline 工具、且无 DetailPanel 内容 / 无 narration，则 marker 整行取消，由 InlineToolPill 自渲染序号 gutter 前缀（`Conversation.tsx` `mergedStepTool` → `ToolCallout` `stepIndex`）。前缀在 button 之外，保住序号栏对齐、hover 目标仍是工具区。任一条件不满足（有 summary / 有 detail / 多工具 / block 态）都维持两行——两行形态仍是常态
- **旁白回声步：旁白当 marker 小字**（2026-09-23，[devlog](../../devlog/2026-09-23-step-heading-narration-echo.md)）：模型没写 `<summary>` 时 GA 拿整段回复当 summary，于是带旁白的工具步里 summary 就是旁白本身（`summaryEchoesAnswer`；2026-09 起带旁白的步 80% 是这种）。此前 marker 退回「调用了 X」（`stepCalledTools`），只是在复述正下方的工具 pill，真正概括这一步的那句话反而不在标题位。现在这类步的 marker summary = 旁白（`cleanSessionSummary` 去 markdown 标记、压空白、不截断，12px ink-soft 照常换行），旁白正文行不再单独渲染；caret 与 DetailPanel 不变。判定在 `lib/step-heading.ts` `isEchoNarrationStep`；模型自己写了 summary 的步、没旁白的步、裸步合并、最终回答都不受影响。代价：流式期旁白按正文寄存器流出，落定时缩成 marker 小字（PROSE_NARRATION 当初为避免的那一下），真机 A/B/C 对比后接受。`stepCalledTools` 只剩清理后为空时的兜底
- **流式正文与思考行之间留一个段落间距**（2026-09-18，`--conversation-block-gap`，随字号档走）：思考行按步内节奏没有下边距（工具行要贴着它），但流式正文是 15px 衬线正文而非工具行，零间距贴着 12px 状态行、又满宽压过缩进的标记左缘，JC 真机嫌挤。三案：A 流式态直接套最终回答的 StrongHr（同构零跳动，但中间步叙述也会顶一条假结论线）、B 只加段落级上边距、C 加边距并缩进到内容列（翻 09-16「流式正文满宽」案）。裁 B：不押注流式正文最终落成叙述（6px 缩进）还是回答（StrongHr），两种结局都语义中性；取 12px 段落档而非 16px 的 StrongHr 档，避免暗示一条不存在的线。落定时的跳动与此前相同，只是起点不再贴着。
- in-flight 状态：`currentTurnIndex` 从 `turn_start` 读取，用于给 thinking 占位 `key`（每步时钟归零）与 `mt-*` 档位；**thinking 行不显序号，序号位放 `··`**（2026-09-16）——序号是落定的盖章，in-flight 行挂「01」等于宣告一个项目还不存在的单项列表；用户感知跑到第几迭代由上方已落定的 01、02 承担，turn_end 替换时序号在原位出现。此前「占位顶部显示 Turn N」的要求废止
- **live 两行窗口**（2026-09-16，[PRD](../../../.scratch/live-run-window/PRD.md)）：正在进行的 run 不是越长越长的清单，而是固定大小的状态面板——最后一个落定的步以阅读形态留在 MainView 思考行之上，之前的步折进 `RunFoldHeader` 的 live 变体「已完成 N 步 · 气味段」（不带用时，步时钟与 HUD 已够两只表；第一步折进去时才出现，单步 run 不受影响）。点头展开是 opt-in（2026-10-16 起展开的是一行一步的过程卡片，之后落定的步作为行追加，下面照旧是窗口；窗口的 rail 这时从它自己那一步起，见「过程卡片」），完成时保持展开；中止（既不 running 也不 askUserPending）则窗口原样定住，只撤掉思考行、头上的字换成「中途停下 · N 步」（2026-10-30 起，此前窗口撤掉、整个 run 平铺；见「Turn 结构」的「停下的运行」）。rail 从头 caret 中心贯到思考行（MainView in-flight 区从第 2 步起 `railFrom="header"`）。窗口包在自己的 ExpandSection 里并承担头到窗口的间距（marker `mt-*` 经 `data-role="step-marker"` 归零；折叠头下 `-mt-2.5` + `pt-2.5`，padding 在 overflow 盒内让 rail 穿过间隙），因为挂着的 0fr 折叠段会阻断 margin 穿透。**完成瞬间**：run 完成的那次渲染保持 live 结构一次 sweep（窗口收合、头换 settled 文案、答案平铺），300ms 后切到 settled 结构。**停下瞬间**：结构不变（停下的运行就是定住的 live 窗口），思考行的位置在窗口下面收合一次 sweep（`SettleGap`）。**步完成的窗口滑动**：被顶掉的步留一次 sweep 关闭（出场）、新步 0fr 展开（入场）、头首次出现淡入、思考行不重挂载只原地归零时钟（run 开始首次出现淡入一次）；展开态不做出场。每步 `pb-2.5` 自带步间距，region `-mb-2.5` 抵消末步。只对可折 run（`foldEligible`）生效。
- `run_complete` / `error` 时清空 currentTurnIndex
- **没有 turn 之间的 SoftHr**——TurnMarker 自带 chapter-break 视觉重量，水平横线已删除

#### 间距演化历史

`turn 间分隔`经过四次调整：

1. v0.1 初版：SoftHr `my-9`（72px）—— dogfood 反馈"每个 turn 浪费 1/3 屏"
2. SoftHr `my-6`（48px）—— 仍反馈"还是大"
3. SoftHr `my-5`（40px）—— 仍反馈"还是大"
4. 删除 SoftHr，TurnMarker `mt-7`（28px）+ tracking 加大承担分隔
5. 2026-06-09 瑞士化：直立 sans + tabular 数字 + 竖向 hairline 分隔，去掉 italic 与 uppercase tracking。间距曾短暂提到 `mt-9`（36px），但实测 turn 间隙 ≈ 42px 又触到当年被拒的 SoftHr `my-5`（40px）量级；dogfood 后一路收到 `mt-6`（24px）。结论：瑞士 marker 自带分隔力，结构清晰度承担分隔，不需要靠大留白
6. **现行（2026-08-23 密度 pass）**：`mt-6` 的适用域重新限定为 **run 边界**；run 内步间收到 `mt-3`（12px），marker `mb-2.5`→`mb-1`，inline pill `my-1.5`→`my-0.5`。动因：第 5 条的 24px 裁决隐含「章节有正文」的前提，多步工具 run 里一步只有两根细线（marker + pill），叠上 24px 后留白占一步高度 ~55%，13 步的 live run 超过一屏——纵向体量本身是层级信号，过程日志的体量压过 final answer 把主次滚反了。提密度即降层级。第 5 条「结构承担分隔」的论证方向不变，恰好支持 run 内更紧

7. 2026-10-16 折叠头后面换成过程卡片（[工作台对话 PRD](../../../.scratch/workbench-conversation/PRD.md) 裁决 6）：头到卡片 10px（头的 `mb-2.5`），卡片到回复 16px（原 StrongHr 的 `my-4`），不再画 StrongHr。同一批轮次点开后（折叠头下缘到回复上缘）2 / 9 / 20 / 50 步从 118 / 488 / 1072 / 2658px 到 60 / 228 / 492 / 1212px。

教训：当用户反复反馈"间距大"时，缩 hr 到极小已经不是答案；该思考"分隔信号"是不是必须靠 hr 承担。结果：TurnMarker 的章节标识 + 间距 + 字号已经足够。第二层教训（2026-08-23）：一条间距裁决要连同它的内容前提一起记——「turn 间 24px」在 turn 有正文时成立，turn 退化成日志行时同一个值就是另一个设计。
