# PRD: 完成 run 的过程折叠（Conversation Run Fold）

Status: done（2026-08-06 实现完成，JC 真机 dogfood 四轮验收通过；devlog
`2026-08-06-conversation-run-fold.md` 为退场后的 decision provenance）
Date: 2026-08-06
关联: `.scratch/composer-next-suggestion/`（同一条「长任务体验」线；ghost 的
定案 5「派生条件非一次性事件」是本 feature 折叠时机的直接先例）

## 背景与动机

JC 提出（2026-08-06）：长任务的中间步骤（第 N 步、叙述、工具 pill）在运行
中逐条展示是对的，但回合结束、finalAnswer 落定后，这些过程仍全量占据
MainView。多步 run 滚过去是一整屏「过程」，找结论要翻。

这不是新哲学，是既有哲学的升维：`pickToolTier`（ToolCallout.tsx）已经在
工具层执行「settled 即压缩、审计一击可达」；DESIGN.md 的 StrongHr 语义是
「result-first rhythm」。本 feature 把同一原则从「单个工具」提到「整个
run」：**当前章节摊开，翻过的章节合上，结论永远可见，过程一击展开**。

## 定案决策

### 1. 折叠范围

- 只折「有最终答案的完整 run」。中止 / 出错 / 仍在等 ask_user 的 run
  永不折叠——折叠头没有东西能代表它，折了就是藏尸。
- Goal run 排除（JC 裁决）：goal 线程有自己的 commission/terminal 括号
  叙事。判定：opener user turn 带 `goalId` 的 run 不折。
- 含 system turn 的 run 不折（v1）：/btw 侧问、Goal 叙述都是 SystemTurn，
  夹在 run 中间时折叠会吞掉一段真实对话。v1 直接放弃折叠这类 run，
  不做分段折叠。
- 单步 run（直接回答，无中间步骤）不折：折叠头替换一行 TurnMarker，
  没有空间收益，徒增噪音。`stepCount >= 2` 才可折。

  > 2026-08-06 修订（验收后同日）：**翻转——单步 run 也可折**。原论证
  > 的前提「折叠头只是折叠控件」被两个后续决策掏空：领土划分把 settled
  > 耗时独家判给折叠头（缺席即丢数据，单步 run 的耗时全产品无处可看），
  > 折叠态移除 StrongHr 后「折叠头+回答」比「marker+横线+回答」更安静
  > （空间账翻正）。删除 `stepCount >= 2` 条件即可，折叠机制其余零改动
  > （hidden 集合恰为空、收口 turn 走 answerOnly）。「1 步」披露词 JC
  > 裁决照用，统一性优先。见 devlog
  > `2026-08-06-run-fold-single-step.md`。

### 2. 折叠时机（派生条件，不是一次性事件）

- live 运行中永不折（分组判定 incomplete 天然覆盖）。
- 最新完成的 run 保持展开：完成瞬间不折——用户常在此刻回看过程，
  且立刻折叠会抽走视口内容。
- **下一条用户消息发出的瞬间**折叠上一个 run：折叠发生在注意力交接点，
  新消息 + 思考占位出现在底部，收缩发生在余光区。
- 重开 / 切回会话：全部完成 run 折叠（含最后一个）。冷读场景没有
  「刚才」，没有需要保持摊开的当前章节。
- 手动展开 / 收起：折叠头整行可点，会话内记忆（组件状态），切换会话
  重置（Conversation 按 activeSessionId 挂 key 重挂载）。

实现形态：keep-expanded 追踪「本次挂载期间最后进入 live 的 run」
（guarded setState-in-render，React 官方 adjust-state-on-render 模式）。
挂载时为 null → 全折；run 进入 live 时指向它 → 完成后仍展开；新 run
进入 live → 指针转移 → 旧 run 折叠。

### 3. 折叠头（TurnMarker 同族 Swiss 行，不新增视觉物种）

结构段 + 气味段一行两段式：

    10 步 · 2 分 14 秒   file_patch ×2 · web_scan ×3 · 1 次提问 · 1 次拒绝  [chevron]

- 结构段：步数（agent turn 数）+ 耗时（closing turn 的
  `telemetry.elapsedMs`，runner 的 final-turn telemetry 是整 run 累计值；
  缺失则省略）。tabular-nums。
- 气味段：工具构成（按名计数，排除 no_tool / ask_user）、ask_user
  提问次数、拒绝徽标。muted、truncate，截断优先牺牲这段。
- 拒绝徽标是整行唯一允许带色的元素（warning 色）——「折叠但留疤」。
- 时间戳如需，进 hover title（v1 未做，opener MessageUser 已有 createdAt）。

**Dogfood 第二轮修订（2026-08-06，JC 裁决）**：

- **可点击 affordance**：首版沿用 TurnMarker 的尾部 chevron，继承了
  「这是标签」的误读。改为**行首 disclosure triangle**（▸ 折叠 / ▾
  展开，通用披露语法）+ 整行 hover 底色（`-mx-2 px-2` 让 hover pill
  外扩、文字列与上下 marker 对齐）。TurnMarker 的尾部 chevron **有意
  不跟**：它的展开是辅助细节，弱 affordance 反而正确。
- **工具名本地化**：气味段改走 `copy.tools`（pill 左栏同款本地化名，
  `修改文件 ×2`；未知工具回落原始名），弃 mono。首版直接用 wire name
  对中文主力用户是待翻译的代号——密度感不足的真因是语言注册用错，
  不是字段少。mono 原始名在展开后 pill 右栏一击可达，审计通道无损。
- **hover 步骤单预览**（悬停列出每步 summary）：讨论过，JC 裁决暂不加，
  先看本地化后的密度手感。方案备档：三段式「折叠行 → hover 步骤单 →
  点击展开」与 rail 的「圆点 → tooltip → 跳转」同构。

**Dogfood 第三轮修订（2026-08-06，JC 裁决）**：

- **墨阶降档**：整行静息 ink-muted（比 TurnMarker 低一档），三角 thin、
  去 font-medium、分隔线 bg-line。理由：marker 是「可见结构的标题」
  （ink-soft 档），折叠头是「被藏结构的元数据」（ink-muted 档）。
  affordance 由形状（行首三角）和悬停（底色 + 提亮）承担，不依赖静息
  墨重。拒绝徽标保持 warning——全灰行上唯一的疤。
- **折叠头 vs Footer 领土划分**（耗时重复的根治）：

  | | 折叠头 | Footer |
  |---|---|---|
  | 归属 | run（过程） | 消息（交付物） |
  | 语义 | 过程的形状与长度（人类体验尺度） | 机器成本与出处 + actions |
  | 字段 | 步数、**耗时**、工具构成、提问数、疤 | token、上下文占用、Copy/Save |

  耗时判给折叠头：它是用户亲历的量（live 计数器就在结构行跳），token
  是机器发票；live「思考中 · 32 秒」→ settled「10 步 · 2 分 14 秒」，
  耗时从生到死不搬家。代价（明知接受）：Footer 的 ⏱ 全体删除后，
  单步 run（几秒钟，复看价值极低）与不可折 run（goal / 含 /btw）失去
  settled 耗时；goal 的耗时后续应归 goal 自己的叙事表面（terminal
  marker / task board），记后续项。新字段挂靠先问「过程的形状还是
  回复的成本」。（2026-08-06 修订：单步 run 随「单步可折」翻转拿回
  耗时，此代价的剩余缺口只剩 goal run 与含 /btw 的 run。）
- **行内顺序**：步数在前、耗时在后。披露词命名被藏内容（「10 步」），
  耗时是尾缀属性；与 live 行「思考中 · 32 秒」及 CI 界面时长尾缀惯例
  同韵；步数宽度恒定适合做左缘锚点。

**Dogfood 第四轮修订（2026-08-06，JC 裁决）**：

- **耗时加「用时」前缀**（zh 专属）：「2 步 · 16 秒」套进中文时长短语的
  「数字+单字量词+数字+秒」韵律模板（步/分 同为单字、轮廓相近），
  扫视按模板匹配会误读为「2 分 16 秒」。语言层歧义用语言层手段解决：
  插入标签词打断模板（「2 步 · 用时 16 秒」只有一种读法），不加图标
  不加分隔装置，保住降档后的安静。en 的 "steps" 一词天然打断模板，
  不改。被否候选（防回锅）：时钟图标（纯文字 Swiss 行引入新视觉物种，
  11px thin 图标在 muted 行里像污点）；间隔点升级竖线（解决分组不解决
  误读，数字骨架仍在）；耗时前置（不解决且推翻既有定案）。

**数据面裁剪（实现时发现，收窄了 2026-08-06 讨论稿）**：

- 「失败」徽标 v1 无数据源：settled 工具只有 success-historical / denied
  两态（`tool-outcome.ts` 的「不猜失败」政策，failed 是 live-only 且
  turn_end 后即 settled）。徽标只做 denied。run 级失败由「不折叠」覆盖。
- 「N 次批准」撤销：`approvalId` 不入 SQLite（`tool_calls` JSON 无此
  字段），restore 后数不出来，live/restore 渲染会不一致——违反
  agent-turn.ts 的 round-trip 不变量。等审批痕迹入库后再加。

### 4. 折叠渲染

折叠态：opener 用户消息 → 折叠头 → 最终答案（含 telemetry 行、
Copy/Save actions）。中间的 agent turns 和 ask_user 回复 user turns
全部不渲染；最终答案 turn 以 answerOnly 模式渲染（跳过自己的 TurnMarker）。
展开态：折叠头在顶（chevron 旋转）+ 今日的完整渲染。零信息损失。

> 2026-08-06 修订（验收后同日）：折叠态**不再渲染 StrongHr**——它的
> 「行动 → 结论」修辞需要可见的机件列作对象，折叠后对象消失，横线反而
> 把全场最强分隔画在折叠头与其所属回答之间（间距 33px > 问题→折叠头的
> 24px，邻近性把过程摘要错绑给了问题）。折叠头以 `mb-2.5` 直接贴回答，
> 读作回答的 eyebrow；展开态 StrongHr 照旧。见 devlog
> `2026-08-06-run-fold-header-spacing.md`。

### 5. Run 分组：`lib/run-groups.ts` 单一真相源

折叠与 rail 共用 `buildRunGroups(turns)`，消除「数据数 user turn、DOM 数
可见节点」的脆弱对齐。

分组规则：
- user turn 默认开新组；**ask_user 回复判定为启发式**：当前组最后一个
  agent turn 的 tools 含 `ask_user` → 该 user turn 是回复，归入当前组。
  依据：DB 无标记（`created_via` 只区分 bridge 命令，`ask_user_response`
  不落库），工具审计留在 `tool_calls` JSON 里。live 与 restore 用同一
  启发式，保证两条路径渲染一致（agent-turn.ts 的一致性论证同款）。
  已知局限：ask_user 挂起时中止、再发新消息，新消息会被误判为回复——
  该组无最终答案永不折叠，代价仅是 rail 少一个圆点。升级路径：
  `created_via='ask_user_response'` 落库（增量 DB 变更）。
- agent / system turn 归入当前组；首条 user 前的孤儿 agent turns 成
  无 opener 组（永不折，rail 跳过——现状语义）。
- closing turn：组内最后一个 agent turn，(tools 排除 ask_user).every
  (no_tool) 且不含 ask_user 且 finalAnswer 非空 → complete。

### 6. Rail 语义变更（JC 已确认）

- 圆点 = run 发起消息。ask_user 回复不再有圆点 / tooltip（语义清理：
  「选 A 吧」不是提问；内容在展开的 fold 里可达）。
- `buildRailExchanges` 改为按组构建：每个有 opener 且 opener 无 goalId
  的组一条 exchange；answer 取组内最后一个非空 finalAnswer（保留
  中断 run 有预览的原意）。
- 顺带修复既有错位：goal commission user turn 渲染为 marker（无
  `data-role="user-msg"` 节点）但旧逻辑照数——goal 会话的 rail 索引
  今天就是错的；按组构建 + goalId 排除后自愈。
- DOM 侧：ask_user 回复的 MessageUser 改挂 `data-role="user-msg-reply"`
  （新 prop）。rail / ⌥↑↓ 只认 `user-msg`（openers）；submit-snap 选择器
  扩为两者（否则回复 ask_user 后 snap 会错跳到 run 开头——回归）。
  折叠展开与否都不再影响对齐。

### 7. 工程检查点

- submit-snap 时序天然正确：折叠随新 user turn 同一次 commit 渲染，
  snap 在 `userSubmitTick` effect + RAF 里测量，晚于折叠布局。
- 手动展开/收起无需滚动补偿：变化都发生在被点击的折叠头之下，
  点击点以上内容不动。
- rail 位置自愈：ResizeObserver 已覆盖内容高度变化。
- Conversation 按 `key={activeSessionId}` 重挂载：折叠状态按会话隔离
  并实现「重开全折」。

## 范围声明

- 纯 GUI 渲染层。不动 Agent API / IPC / DB / runner。
- 不折叠的东西照旧渲染，展开态 = 今日渲染，零信息损失。

## 验证清单

- [ ] run-groups 单测：基础分组 / ask_user 回复归组 / 中止后误判局限 /
      goalId 排除 / system turn 不可折 / 单步不可折 / 孤儿 agent 组 /
      stats 聚合（步数、耗时、工具计数、denied、ask_user 次数）
- [ ] rail-preview 单测更新：回复无 exchange、goal opener 跳过、
      原有配对语义保持
- [ ] typecheck / lint / 全量 vitest
- [ ] JC 真机 dogfood：折叠时机手感（提交瞬间的视口稳定性）、折叠头
      信息密度、展开/收起、ask_user 会话、goal 会话不受影响、rail
      跳转与 tooltip 对齐
