# 步号淡一档 + DetailPanel 展开过渡：对表外部 ReasoningTrace 参考组件

日期：2026-09-16
关联：`Conversation.tsx`（TurnMarker / DetailPanel）、`ToolCallout.tsx`（裸步
合并前缀）、新增 `ExpandSection.tsx`（`RunFoldSection` 改为其薄包装）、
[conversation.md](../design/conversation.md) TurnMarker 与 Thinking Summary 节、
[deferred](./deferred.md)「单步 run 的『第 1 步』前缀收敛」

## 起因

JC 再次提出「第 N 步」是否可只显数字（含单步隐藏），并贴来一个外部
ReasoningTrace 组件（`01` 补零等宽序号、默认折叠「Thought for Xs」header、
Sparkles 脉冲、shimmer 文字、grid-rows 展开、逐项淡入）作参照。

## 考古

同题 2026-08-23 已裁：多步裸数字**永久否决**（重复标签是节奏；thinking 态
「3 │ 思考中 · 12.3s」两个无单位数字互打），单步暂存并挂启动信号。本次
JC 对单步说「都行」，启动信号未触发。

## 参考组件对表

| 元素 | 判断 |
|---|---|
| 默认折叠 + 「Thought for Xs」 | 已有：RunFoldHeader「N 步 · 用时 X 秒」，且带提问 / 拒绝计数 |
| shimmer 文字 + 秒数 | 已有（2026-08-12 裁决同款） |
| Sparkles 脉冲图标 | 否：§2.7 B 类，且 08-12 正是按「信号源 3 → 2」删的三点 |
| Chevron 旋转 | 已有 |
| grid-rows 展开过渡 | **采**：RunFoldSection 已用，DetailPanel 尚是硬挂载 |
| 逐项淡入上移 | 否：容器过渡已承担「展开」的物理感；参考组件无 stagger，实际等于容器淡入 |
| 左侧 rail | 已有 |
| 编号比正文淡一档 | **采**，但作为角色改写而非调色（见下） |
| 内联 keyframes、duration / easing 字面量 | 否：motion token 制 |

补零序号作为新命题也否：参考组件 thinking 态无号、只给 settled 列表编号，
套进 Galley 会破「before/after 视觉一致」与「thinking 占位显示当前步号」两条
契约，收益只是每行省两字宽。

## 定案

1. **编号淡一档，锚点改由对齐承担。** 编号 ink-soft → ink-muted，summary
   不动。这是对 08-23「保留第 N 步」的另一半补全：标签保留因为它是节奏，
   节奏不需要重墨；也是 08-23 密度 pass「提密度即降层级」的墨量版。字重
   保留 medium、字号保留 12px：颜色淡了靠字重保数字可扫性，且同日 Windows
   反馈线表明雅黑 12px 的 400 叠 muted 会看不清。hairline 不淡。
   InlineToolPill 的裸步前缀跟随；RunFoldHeader「N 步」（计数）与 sidebar
   「第 N 步 · summary」（独立语境）不跟随。
2. **DetailPanel 展开过渡**：抽出 `ExpandSection`（grid-rows 0fr ↔ 1fr、
   先挂载再过渡、300ms 后卸载、reduced-motion 退化），RunFoldSection 改为
   薄包装只留 margin 编排，DetailPanel 去掉 fade-in keyframe 改走同一容器。
   时长统一 `--motion-slow`，过程区只有一种「展开」手感。

## 明知代价

- run 边界处第 1 步的 chapter-break 分隔力略弱（SoftHr 当年被删的依据是
  marker 自带分隔重量）。靠 `mt-6` 与 settled run 折叠兜住；JC 真机验收，
  不行回退一行。
- ink-muted 浅色底约 3.4:1，低于 AA。产品里 ink-muted 早用于 12px 提示
  文字，非新破例，但编号曝光量更大，Windows 低 DPR 用户最先感觉到。

## 做法说明

单变量气质票，不搭变体切换器：直接改上去进 tauri dev 看。

## 后记（同日）：真机翻案——补零序号 + 序号栏 + 过程体缩进

JC 真机看过「淡一档」版本后仍嫌繁琐，再提补零序号。第二轮复核改口，
翻 08-23「裸数字永久否决」：

- 08-23 的核心论据「读者第二行起只扫数字」其实在替裸数字辩护：既然只扫
  数字，「第」「步」就是每行都在付的死重。当时没有真机实感，现在有了。
- 淡一档只减墨量不减元素数：每个 marker 行仍是第 / 数字 / 步 / hairline /
  summary 五个元素，参考组件是两个。JC 的「还是繁琐」是对的。
- 「3 │ 思考中 · 12.3s 两个数字打架」由补零（`03` 是序号栏写法，不会被读成
  数量）+ 计数器带「秒」单位化解，真正无单位的数字只剩一个。
- 上一轮说补零序号会破「before/after 视觉一致」与「thinking 显步号」——那是
  参考组件 thinking 态无号的做法造成的，不是补零本身。Galley 两态都显序号，
  两条契约都保住。

定案：

1. 两位补零序号（`lib/step-numeral.ts`），Inter tabular、12px 档、ink-muted、
   font-medium 不变；占固定 `--step-gutter`（24px）列。**去 hairline**：固定
   列宽本身就是分隔，留着是第三个元素（硬理由，不投票）。字体不用 mono：
   行右端已有 JetBrains Mono 工具名，左端再来一个会一行三种字体（气质票，
   JC 按建议取 Inter）。
2. **序号栏 + 内容列**：JC 提出让「运行代码」pill 行与上一行 summary 起笔
   对齐；扩展为整个过程体（narration、pill、block 卡片、ask_user 回显、
   DetailPanel）缩进 `--step-gutter`，最终回答满宽。只缩 pill 会在一步同时有
   pill 和卡片时参差，故不取「只缩 pill + DetailPanel」的廉价出口。缩进与
   marker 同生（`showMarker`），裸步合并的 pill 行自画 gutter。
3. 「第 N 步」文案保留为 sr-only 与 sidebar；en 零文案改动。
4. 单步「第 1 步」问题不受影响（deferred 该节维持暂存，方案改写为「收尾
   孤步收掉 gutter」）。

明知代价追加：gutter 24px 是先验值（`01` 约 14px + 10px 呼吸），松紧真机
再调，一个 token。行数不变（四步仍七行），JC 同意本次不动行数；若仍繁琐，
下一根杠杆是 deferred 已挂的「marker 与 pill 合一行」。

## 后记二（同日）：对表参考渲染图——过程区缩进 + rail、节奏、层级

JC 拿参考组件的渲染图对比 Galley 真机截图，指出三处：行间距、序号应比
折叠头更靠右、序号与内容的层级不舒服。按 2x 折算量出的差异（CSS px）：

| 项目 | 参考 | Galley（第一轮后） |
|---|---|---|
| 折叠头 | 13px medium，最深 | 12px regular，ink-muted，最浅 |
| rail | 1px，图标中心 x≈7 | 无 |
| 序号 / 内容 x | 24 / 47 | 0 / 24（序号在折叠头文字左边） |
| 序号 | 11px mono regular，比内容浅 | 12px sans medium，比内容重 |
| 内容 | 13px，行高 1.6，换行 | 12px，单行截断 |
| 折叠头→01 行心距 | 32 | 46 |
| 步内 / 步间行心距 | 0 / 31 | 25.5 / 34 |

诊断：层级三层顺序基本是反的（头最浅、序号比内容重）；行间距总量不差，
差在**步内 : 步间 = 1.3** 的分组比例，四步七行所以像七行。

定案（JC：按包做；序号字体与折叠头深浅两轴进临时切换器真机看；live run
一起缩进带 rail）：

1. `StepRegion`：过程体整体再缩一格 gutter + x=5 的 1px rail。序号 24–48、
   内容 48，与参考 24 / 47 同比例，复用 `--step-gutter` 不另造数字。live
   与 settled 同构（flat 区 vs RunFoldSection 内区），run 完成重包时 x 不动；
   `answerOnly` 拆分扩展到所有有收口 turn 的 group，StrongHr 以负 margin
   破出缩进铺满列宽。
2. 序号降级：regular、比内容小 1px、ink-muted；第一轮为 Windows 可扫性保
   留的 medium 撤回——层级比可扫性重要。行高钉到 summary 行框对基线。
3. summary 换行不截断、行高 1.6，caret 顶对齐。字号先不动（12 对 15 正文
   的从属关系是刻意的），前几条落地后再看要不要加 0.5。
4. 节奏：步内 marker→pill 收到 0（marker `mb-1`→0，pill `my-0.5`→0），步间
   保持 `mt-3`，折叠头→第一步 24→12（RunFoldSection `-mt-2.5`→`-mt-5.5`）。
   每步净减 6px，分组比例 1.3→1.5+。
5. 两处对齐细节：summary 与折叠头文字起笔差 5px 的「不齐不对齐」由缩进
   一格消除；pill 图标比 summary 首字靠右 3px（Phosphor 字形内留白），
   `-ml-2`→`-ml-2.5` 拉回。
6. 临时 `StepVariantSwitcher`（dev-only，右上 pill，localStorage）：`numeral`
   sans | mono、`header` muted | soft。默认等于产品现状。agent 意见：折叠头
   翻深倾向做（把手不该比内容浅；08-06「安静眉头」讲的是间距归属不是墨量），
   序号 mono 的「一行三种字体」顾虑收回一半（左右两端都是机器元数据说得通）。
   JC 真机裁决后拆切换器、内联赢家、回写本文与 conversation.md。

已知未收口：MainView 的 in-flight marker 区与 Conversation 的 live 区是两个
StepRegion，两段 rail 之间有约 12px 断口。

## 裁决（同日真机）

JC 真机切四种组合，定 **numeral: mono、header: muted**。切换器与
`html[data-*]` 钩子已拆，赢家内联：序号走 JetBrains Mono +
`--conversation-tool-mono-size`；折叠头不动，08-06「安静眉头」维持——agent
倾向翻深的意见未被采纳，记为否决项防重提。

## 后记三（同日）：thinking 行不显序号

JC 真机见 in-flight 的「01 正在处理 · 10.0 秒」问是否 bug。排查：不是——
步号来自 turn_start，「正在处理」是发送阶段状态，均按 conversation.md
「thinking 占位显示当前步号」渲染。但序号栏形态下这条契约站不住：序号是
落定的盖章，in-flight 行挂号等于宣告一个项目还不存在的单项列表，和
08-23 JC 不喜欢的「第 1 步 · 直接回答了用户问题」是同一种报幕感。参考组件
正是 thinking 无号、settled 才编号——本文上一轮把这点当它的缺陷来论证
（「破 before/after 一致」），现在看它是对的。

定案：序号只属于 settled 的步；thinking 行保留空 gutter，sr-only 标签同去。
不对第 1 步特判（「03 思考中」同样是提前盖章）。rail 保留（标的是过程区，
参考组件 Thinking 下也有）。契约改写：「占位显示 Turn N」废止；「before/after
同组件两态」改为位置与寄存器一致、序号是落定时才出现的差异。

## 后记四（同日）：pill 行退一级

JC 看八步 live run 截图觉得不协调，问 pill 行是否该比 summary 行更低一级。
独立判断：病因不是 pill「太重」，而是它与 summary **同级**（同 12px 档、同
ink-soft、同 x 起笔）却多带图标、右端 mono 名、caret 三个元素且横跨整列，
按元素数赢了叙述；八步叠起来右缘「web_execute_js ⌄」成了重复八次的第二列。

定案（JC：一起降；右端 mono 名 hover 显示——agent 原倾向先保持常驻，JC 裁
hover）：

1. `--conversation-tool-label-size` 三档降到与 `-tool-mono-size` 同值
   （10.5 / 11 / 11.5）；pill 整行 ink-soft → ink-muted，hover 升 ink；图标
   14 → 13 随行同色。每步只剩 summary 一行「正常字」，序号栏与 pill 两侧
   都是 muted 附注。
2. 右端 mono 工具名 `opacity-0`，hover / focus-visible / 展开态显示，
   `transition-opacity` 走 `--motion-fast`；caret 常驻作可点提示。
3. 预览文字本就 muted，不动。

注意 tool-label token 只有 InlineToolPill 一个消费者（block callout head 用
自己的 13px 字面量），降档无连带。

## 后记五（同日）：caret 贴文字，mono 名进展开体

hover 显示 mono 名上线后，JC 截图：右缘只剩一个孤零零的向下箭头，割裂且
不知其用。诊断：caret 从来不是独立元素，是右区「mono 名 + caret」审计簇的
尾巴；簇散了，位置也就不成立。原则：**披露 caret 贴着它披露的东西或它所属
的文字**——参考组件「Thought for 4.4s ⌄」、Galley 折叠头都是如此，只有 pill
与 TurnMarker 把 caret 停在列右缘（后者这张截图没暴露，因为这些步无
thinking 内容）。

定案（JC：按 A）：

1. pill 行合成一个左簇：图标 · 标签 · 预览 · caret，按钮仍横跨整行作热区。
2. mono GA 名不再 hover 显示，改为展开体首行——审计元数据放在审计发生的
   地方，静止行没有任何时隐时现的元素（hover 才出现对触控板 / 键盘不可靠）。
   未知工具的 fallback 标签本身就是 mono 名，展开体不重复。
3. TurnMarker 的 DetailPanel caret 同样移到 summary 文字末尾（inline-block
   随末行换行；裸数字步单独立在 gutter 右侧），三处披露 caret 一条规则。

被否：B 右簇整体 hover 显示（静止态可点性只剩 hover 底色）；C 去 caret。

## 后记六（同日）：thinking 行序号位放 `··`

后记三定「thinking 行空 gutter」后，JC 真机截图指出：因为没有序号，
思考行前面空了一段，刚提交、尚无落定步时尤其像个洞。

诊断：只学了参考组件的一半。它 thinking 态确实无号，但序号位放的是
Sparkles 脉冲，格子没空；Galley 按 §2.7 否了图标又去了序号，格子成了
真空。更根本的差异是参考组件的 live 状态在**顶部 header 槽**，Galley 的
是**底部一行无号的步行**——序号栏形态下天然缺一块。另外后记三「序号在原位
出现」的盖章理由比当时想的弱：in-flight 行在 MainView、settled 步在
Conversation，turn_end 是整行替换，不是同一行加上数字。

三条路：①序号位放静态占位 `··`（守网格，不加动效源）；②thinking 行不吃
gutter、文字从序号列起笔（承认「状态行不是步」，破一行网格）；③live 状态
升为顶部 live header（参考组件的真实结构，长 run 时活跃信号会滚出视野，
改动大）。③进 [deferred](./deferred.md)「过程区的 live 状态升为顶部 live
header」。①②做临时三态切换器（空档 / `··` / 无 gutter）进 tauri dev。

裁决：JC「明显喜欢 dots」。`PENDING_STEP_NUMERAL = "··"`（`step-numeral.ts`）
同列同 mono 同 muted，两位序号宽；切换器已拆。agent 押的也是①，理由是
这套寄存器是 Swiss 网格。②的「差 5px 对不齐折叠头」顾虑在讨论中已收回
（live run 无折叠头），它输在整行要靠寄存器差异撑而不是位置。

顺带修的真 bug（单独 commit `69a5ce6e`）：`extractPreamble` 只剥紧凑形态的
`🛠️ tool(...)` 标记，verbose 形态的 `🛠️ Tool: \`x\` 📥 args:` 块漏进 live 状态，
真机见「Tool: web execute js args: · 14.5 秒」。补齐整块剥除与截断，与
`cleanPartialContent` 对齐。

## 后记七（同日）：十步 run 再收 8px

JC 贴十步 run 截图问行距能否再紧。像素账（2x 折算）：一步行心距 55 =
summary 19 + pill 24（`py-1`）+ 步间 12，留白约 58%，与 08-23 改前的 55%
几乎持平——那次砍的是章节级间距，两行一步的结构没动，天花板还在。

摆了两把刀：①数值微调（pill `py-1`→`py-0.5`、步间 `mt-3`→`mt-2`，
55→47，−15%）；②pill 上 summary 行、`flex-wrap` 放不下才折（55→31，
宽模式十步约 −40%，恰为 08-23 deferred 的 B 刀，其启动信号「A 刀后仍嫌
两行啰嗦」已被这次实感触发）。agent 押②。

裁决：JC「先只做刀 1」。落地①，`ToolCallout` 裸步合并前缀的两档间距同步
改 `mt-2`。②的实现路径与 caret 同行的疑点写回 deferred B 项，启动信号
标记「已触发一次」。

## 后记九（同日）：刀 2 撤回，密度按状态分流，完成即折

JC 真机看刀 2：「太密集后，单个步骤的阅读体验其实变得更差了」，要求好好
权衡空间 / 视觉层级 / 排查用户的阅读体验。

先核事实：settled run 默认折叠、重开会话全折，十步全展只出现在 live、
刚完成到下一条消息之间（08-06 keep-expanded）、用户主动展开排查三处。
JC 那张截图带折叠头，是第二处。第三处的用户是来读的，密度与它的诉求
相反。

agent 判断：密度与阅读体验在同一套静态排版里无解，只能按状态分。今天
三刀（08-23 A 刀、刀 1、刀 2）都在同一个渲染上挤像素，结果「密而不省」；
08-23「提密度即降层级」只对一半——层级靠墨量、字号、折叠，前两样已到位，
第三样没覆盖真正出问题的窗口。提议：①回到两行阅读形态；②刚完成的
run 完成即折（重审 08-06）；③live 封顶（最后 N 步全展、其余折一行）另议；
不做密度开关（把裁决推给用户）。

裁决（JC）：撤刀 2（`git revert`）；阅读形态 pill 回 `py-1`、步间
`mt-2.5`（JC 给 2.5 或 2，agent 取 2.5，一步 53）；完成即折；live 封顶
继续讨论。

完成即折的实现：keep-expanded 指针不在 run 落定的同一渲染释放，而是
`useEffect` 里下一帧 `requestAnimationFrame` 释放——RunFoldSection 以
`open=true` 挂载（ExpandSection 以 `open` 作初始 state，不播展开动画），
下一帧翻 false 走 grid-rows 收合。08-06 PRD 的顾虑「立刻折叠会抽走视口
内容」由此化解为一次 240ms 的收合；粘底滚动在收合中的表现待真机验：
若答案已在流式显示、上方 500px 收走，答案会上移，视口停在哪里要看。
PRD §2 已划掉旧条款并记修订。
