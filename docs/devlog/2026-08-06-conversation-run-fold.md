# 完成 run 的过程折叠：MainView 变成「问答文档 + 可展开脚注」

日期：2026-08-06 设计讨论定案、实现、四轮 dogfood 修订，同日验收通过。
工作材料：`.scratch/conversation-run-fold/PRD.md`（含全部定案与四轮修订，
本 entry 是其退场后的 decision provenance）。

## 背景与定案

JC 提出：长任务的中间步骤（第 N 步 / 叙述 / 工具 pill）运行中逐条展示是
对的，但 finalAnswer 落定后仍全量占据 MainView。定案：**settled run 的
过程段折叠成一行折叠头**——这不是新哲学，是 `pickToolTier` 在工具层已
执行的「settled 即压缩、审计一击可达」升维到 run 层，与 StrongHr 的
result-first rhythm 同源。

核心决策（详见 PRD）：

- **时机是派生条件非一次性事件**（ghost 定案 5 同款基因）：live 永不折；
  最新完成 run 保持展开（keep-expanded 指针：挂载期内最后进入 live 的
  run）；**下一条用户消息发出的瞬间**折叠上一个 run——折叠发生在注意力
  交接点；重开会话全折（Conversation 按 sessionId 挂 key 重挂载）。
- **范围**：无最终答案的 run 永不折（折了就是藏尸）；Goal run 排除
  （自有 commission/terminal 叙事）；含 system turn（/btw）的 run 不折；
  单步 run 不折（无空间收益）。
- **`lib/run-groups.ts` 单一真相源**：折叠与 rail 共用分组，消除「数据数
  user turn、DOM 数可见节点」的脆弱对齐。ask_user 回复用「前一 agent
  turn 含 ask_user 工具」启发式（DB 无标记，live/restore 同规则保证渲染
  一致；中止误判的局限钉进测试用例——该组永不折，代价仅一个 rail 圆点）。
- **Rail 语义变更**：圆点 = run 发起消息，ask_user 回复不再有圆点（其
  MessageUser 改挂 `data-role="user-msg-reply"`）；顺带修复 goal 会话
  commission marker 造成的既有索引错位。submit-snap 选择器扩为两种角色，
  否则回复 ask_user 后错跳 run 开头。

## 四轮 dogfood 修订（同日，每轮均 JC 裁决）

1. **可点击 affordance**：尾部 chevron 继承了 TurnMarker「这是标签」的
   误读 → 行首 disclosure triangle（▸/▾）+ 整行 hover 底色（`-mx-2 px-2`
   保持文字列对齐）。TurnMarker 的尾部 chevron 有意不跟——功能权重不同。
2. **工具名走 `copy.tools`**：气味段首版用 wire name + mono，对中文主力
   用户是待翻译代号；「信息量不足感」的真因是语言注册用错而非字段少。
   hover 步骤单预览方案备档未做。
3. **墨阶降档 + 领土划分**：整行静息 ink-muted（marker 是可见结构的标题
   = ink-soft 档；折叠头是被藏结构的元数据 = ink-muted 档；affordance 由
   形状和悬停承担，不靠静息墨重）。**折叠头 vs Footer 领土表**：折叠头
   = 过程的形状与长度（人类体验尺度：步数、耗时、工具构成、疤），
   Footer = 机器成本与出处（token、上下文、Copy/Save）。耗时判给折叠头
   ——它是用户亲历的量，live 计数器就在结构行跳，从生到死不搬家；
   Footer 的 ⏱ 全体删除，明知代价：单步/不可折 run 失去 settled 耗时
   （goal 的耗时后续应归其 terminal marker / task board）。行内顺序步数
   在前：披露词命名被藏内容，耗时是尾缀属性（CI 惯例同韵）。
3.5 数据面裁剪（实现时发现）：「失败」徽标无数据源（settled 工具只有
   success-historical/denied 两态，tool-outcome.ts 不猜失败），徽标只做
   denied；「N 次批准」撤销（approvalId 不落库，live/restore 会不一致）。
4. **「用时」前缀防误读**（zh 专属）：「2 步 · 16 秒」套进中文时长短语
   「数字+单字量词+数字+秒」的韵律模板，扫视误读为「2 分 16 秒」。语言
   层歧义用语言层手段解决：插标签词打断模板。被否：时钟图标（纯文字行
   引入新视觉物种）、竖线（解决分组不解决误读）、耗时前置（推翻定案）。

## 被否候选（防回锅）

- 折叠头行内塞更多字段 / run 级 LLM 摘要（不过辅助 LLM 准入判据 1）。
- 「记住上次展开状态」跨会话持久化——手动 toggle 是会话内临时状态。
- 分段折叠（绕开 system turn 折其余部分）——v1 复杂度不值。

## 交付

`lib/run-groups.ts`（+11 单测）、`RunFoldHeader.tsx`、Conversation 折叠
渲染 + keep-expanded、MessageUser 锚点角色、rail-preview 按组构建（+新
单测）、useStickyScroll 双角色 snap、i18n fold 文案。gui typecheck /
lint / 276 tests 全绿。同 session 顺手：Settings 泛用入口默认 tab 收口
（独立 entry）、managed-ga 0017 补丁（独立 entry）。
