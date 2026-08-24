# 挂起的想法（Deferred）

想清楚了、留了方案、但决定暂不实施的想法都记在这里 —— 一想法一节，等启动信号再开工。

与时间线的分工：[时间线](./README.md) 记「已发生的历史」（不可变）；本台账记「想做但还没做的事」（会增删）。真正开工时，把对应小节从这里拎出来、落成一篇正式 devlog entry，并从本台账删掉。

每节固定字段：**状态 / 提出 / 启动信号 / 方案 / 实施要点 / 待定 / 关联**。

---

## 用户消息的「落笔」入场动效（质感方向一）

- **状态**：暂存（2026-08-21 探讨成型，JC 当日裁决「先不改」）
- **提出**：2026-08-21，静态形态的质感实验零采纳后反推「质感还能从哪来」（见 [质感实验](./2026-08-21-user-message-texture-experiment.md)）。
- **启动信号**：再次出现「用户消息死板 / 平 / 没质感」的实感；或做主对话区动效批次时顺带。
- **背景**：08-06 定的隐喻是「被高亮笔划过的句子」，但目前**只有划的结果、没有划的动作**——用户按下发送，杏色带以完成态瞬间出现，不像被划出来的，像被贴上去的。而 agent 那侧恰恰有块级软淡入（v0.4.7 打磨批），于是形成一个**时间维度上的寄存器倒挂**：机器的话慢慢显出来，人的话啪一下贴上去。质感的很大一部分来自「一个东西如何出现」，而这条通道在用户消息上是完全空白的——这也是为什么静态微调（沉积 / 圆角）双双落空后，它成为首选方向。
- **方案**：新发出的消息，笔触从左向右展开，120–160ms（`--motion-fast` / `--motion-base` 区间）。**只对新消息播，历史消息与滚动回看一律不播**（否则滚动时满屏动效会非常吵）；`prefers-reduced-motion` 走项目现成惯例（`.animate-fade-in` 那套）。
- **实施要点**：展开需要把纯色 `bg-brand-tint` 改成 `background-image` + `background-size` 动画，**要与现行的偏移 `box-shadow` 出头方案对齐**（出头画不了渐变，见质感实验的实现约束）；多行是同时展开还是逐行展开需实测——同时可能读作「一整块滑出」，逐行更像真的划但耗时更长。不碰任何已裁决项：08-06 管形状、06-20 管排印，都没涉及时间维度。
- **待定**：多行展开策略；是否连 GoalCommissionMarker 一起（**大概率不**，它的「加冠正装」定位要求它更静态）。
- **后续方向（等本条结果再定）**：**排印微调**——用户消息与 agent 正文目前字号 / 字重 / 行高 / 墨色**完全相同**，只有底色不同，字这条通道是零。可试字距放松一档或字重 `medium → regular`。注意 08-06 Round 1 输掉的「访谈体」是**去掉底色**的极端方案，不能用来否定「保留底色 + 微调排印」；但这条明确会碰 2026-06-20 的排印统一裁决，**必须作为重审来做**。若落笔动效之后仍觉得平，才说明缺的是字而不是动作。
- **不推荐**：调 `my-5` 的竖向节奏——那是全局问题，不值得为单个组件动，且 v0.4.7 刚调过 markdown 竖向节奏。
- **关联**：[高亮笔重设计](./2026-08-06-user-message-highlighter.md) · [质感实验](./2026-08-21-user-message-texture-experiment.md)。

---

## Goal 停止立即 abort 当前轮（stop 响应性）

- **状态**：暂存（2026-08-23 Goal 派发修复时浮出，有意不并入该次修复）
- **提出**：2026-08-23，[Goal 派发装门](./2026-08-23-goal-dispatch-gate-and-run-state.md) 的余量项。
- **启动信号**：dogfood 或用户反馈里出现「点了停止还要等好几分钟才开始收尾」的实感——solo 循环只在 loop top 检查 `stop_requested`，正在跑的多步 turn 会先跑完；`confirmStopGoal` 文案承诺的「简短收尾（约 1–2 分钟）」在长 turn 下兑现不了。
- **方案**：停止路径先对 master 会话发 `IpcCommand::Abort`（bridge 会合成 run_complete、Core 队列门随之关闭），再走现有 busy 重试的 synthesis 派发——机制上与队列 `QueueJump::AbortThenDrain` 同族，基建都在。
- **实施要点**：abort 丢弃当前轮已产出的中间工作（工具副作用已落世界、不回滚，同消息级 Retry 那条的口径）；aborted turn 在主对话区的形态要过一遍（残缺步序列 + 立刻接收尾轮）；hive 模式 master 通常空闲，基本只影响 solo。
- **待定**：是否给「温和停止（跑完本轮）/立即停止」两档，还是一刀切 abort；GUI stop 确认弹窗文案是否随之改。
- **关联**：[Goal 派发装门](./2026-08-23-goal-dispatch-gate-and-run-state.md)；`cli/src/goal/solo.rs` loop-top 检查；`core/src/runner_manager/manager.rs` `queue_jump` 的 AbortThenDrain 先例。

---

## 单步 run 的「第 1 步」前缀收敛（TurnMarker 步号）

- **状态**：暂存（2026-08-23 探讨定案，JC 当日裁决保持现状；agent 复核后同意——见「不启动的理由」）
- **提出**：2026-08-23，JC 两问：多步 run 里「第 / 步」重复是否无效信息；单步 run 显示「第 1 步」是否别扭。多步部分当场终裁：**保持「第 N 步」，裸数字方案永久否决**——重复标签是排版节奏不是噪音（读者第二行起只扫 tabular 数字），且 thinking 态会变成「3 │ 思考中 · 12.3s」一行两个无单位数字互相打架。此条否决不随本节启动而复活。
- **启动信号**：JC dogfood 中反复被「第 1 步 · 直接回答了用户问题」的报幕感硌到。判据要计入曝光量事实：它默认只在最近一次交换可见（完成 run 默认折叠、仅 `keepOpener` 展开，`Conversation.tsx:151`），下次交换完成即折进「1 步 · N 秒」的 RunFoldHeader——若这样的瞬态单例曝光仍产生实感，才值得动。
- **不启动的理由**（2026-08-23）：①曝光是瞬态单例不是累积墙（见上）；②只能收前缀不能删行，而前缀在单步场景兼任「这行是过程元数据」的登记标签，收掉后孤行「直接回答了用户问题」可能更没来头；③换来一条带例外的条件规则（「before/after 视觉一致」要开洞 + run 中段孤步不收的不对称）。「·1 是噪音」（layout-and-chrome.md sidebar 角标条款）类比偏弱——那是纯计数徽章删整个信号，这里行还在、还承载入口。
- **方案**：settled 且 run 已完成的收尾回答轮、显示步号为 1 → 收掉「第 1 步 │」前缀，保留 summary + chevron（DetailPanel 入口挂在此行）。**按编号段判而非按 run 判**：ask_user 回复也是一次 `put_task`、步号重新从 1 数（`workbench_bridge.py:1474`），收尾孤步段同样收；run 中段孤步（第 1 步即发 ask_user 暂停）不收——那里序列被暂停而非结束。
- **实施要点**：TurnMarker 已支持 `index` undefined 的无前缀形态（`Conversation.tsx:569`），复用即可；aborted run 不收（无 settle 语义，序列被打断是事实）；en（`Step 1`）结构性同款，零文案改动；sidebar `第 N 步 · {summary}` 不跟随（独立语境需要单位）；`conversation.md` 需注明这是「before/after 视觉一致」的有意例外；判定条件补单测。
- **待定**：若启动时仍嫌残留孤行冗余，「删整行」要作为对两条既有约束的重审来做（DetailPanel 入口；StrongHr 的 action→conclusion 修辞需上方 action 列，`Conversation.tsx:433`）。
- **关联**：`conversation.md` TurnMarker 节（步号即结构锚点）；`Conversation.tsx:474`（「步 vs 轮」选词理由）；`layout-and-chrome.md` sidebar 角标「·1 是噪音」条款（规范近亲，非同物）。

---

## dark 的 `--color-brand-tint` 仍是 provisional（响度未复核）

- **状态**：暂存（2026-08-21 发现，当日 JC 关注点在 light 故未处理）
- **提出**：2026-08-21，用户消息质感实验时读到 token 注释发现。
- **启动信号**：dogfood 中觉得 dark 下用户消息带「太重 / 太抢 / 太硬」；或下一次动 dark 色彩体系时顺手了结。
- **背景**：`--color-brand-tint` 的 dark 值旁边一直写着 `/* Dark-mode user-message band — provisional; revisit in the dark pass. */`，而 08-21 的抬画布 + chrome 翻转**就是那个 dark pass**——当时只让它跟着阶梯等比移动，没有复核它自身的响度是否合适。数据支持这个怀疑：dark 的带相对主区地面 Δ **18.88**，light 只有 **8.39**，**响 2.25 倍**；且三个历史阶段（08-06 / 抬画布后 / 翻转后）Δ 稳定在 18.6–18.9，说明这个响度是 08-06 定值时就带着的，从未被单独审过。
- **不是启动信号**：JC 2026-08-21 报告的「用户消息死板 / 太硬」**不算**——他明确说看的是 light，而 light 响度正常，那次的病因在形状不在响度（见 [质感实验](./2026-08-21-user-message-texture-experiment.md)）。
- **方案**：把 dark 的 Δ 往 light 的量级收（8.39 是 light 的标定结果，dark 未必要完全对齐，但 2.25 倍的差距需要一个理由或一次修正）。纯 L 调整，色相彩度不动；改完要复核用户消息内正文墨的对比度，以及与 `selected@sidebar`（现同值 `#4d3b2b`，**同值但不绑定**）的关系是否需要跟随——大概率不需要，那是两个独立标定。
- **待定**：dark 的带是否本来就该比 light 响（暗背景上的填充感知衰减，可能需要更大的 Δ 才等效）。这一条要先想清楚，否则可能把一个正确的补偿当成 bug 修掉。
- **关联**：[高亮笔重设计](./2026-08-06-user-message-highlighter.md) 定的值 · [质感实验](./2026-08-21-user-message-texture-experiment.md) 发现。

---

## `api_key_header` 的 GUI 入口（Anthropic 协议中转的鉴权头覆盖）

- **状态**：暂存（2026-08-21 GA baseline 升级时发现，本次有意不做）
- **提出**：2026-08-21，`f06d550` -> `30b24ad` 外审读到上游 `c9cb4b5`（社区 PR #751）。
- **启动信号**：有用户（或 JC 自己）配置「说 Anthropic `/v1/messages` 协议、但 key 不带 `sk-ant-` 前缀」的中转端点时撞 401；或下一次动 Settings -> Models 高级面板时顺手。
- **背景**：上游给 `NativeClaudeSession` 加了可选 cfg 键 `api_key_header`，取值 `auto`（默认，旧的 `sk-ant-` 前缀启发式）/ `x-api-key` / `bearer`。那类中转（上游举例 opencode.ai）只认 `x-api-key`，而 `auto` 对非 `sk-ant-` key 发 `Bearer`，结果 401 Missing API key。**Galley 的 runner 侧已经通了**：`managed_runtime.managed_model_config_from_env` 是 `cfg.update(advanced)`，模型的 `advancedOptions` 原样透传进 GA session cfg，不需要任何代码改动。差的只是入口——`AdvancedModelOptions` 编辑的是一组策展字段（`max_retries` / `read_timeout` 等），这个键不在其中，用户没法敲进去。
- **方案**：两条路。① 在高级面板加一个三选一（`auto` / `x-api-key` / `bearer`），只对 `protocol === "anthropic"` 显示；② 不加字段，只在某个中转预设的 `recommendedAdvancedOptions` 里带上——成本更低但只覆盖预设过的端点。
- **待定**：这是不是一个真需求。目前**没有任何用户报告**撞过这个 401，纯属读上游 diff 读出来的能力。①的成本是给一个策展面板加一个多数人用不到的字段，与「一屏配好模型」的产品方向有张力。等真实信号比现在动手更划算。
- **关联**：[GA 上游升级 f06d550 -> 30b24ad](./2026-08-21-ga-upstream-upgrade-f06d550-to-30b24ad.md) · `runner/managed_runtime.py` `managed_model_config_from_env` · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

---

## `shadow-*` utility 在 dark 下静默使用 light 阴影值

- **状态**：暂存（2026-08-21 落选中行抬升时撞见，JC 尚未裁决是否开工）
- **提出**：2026-08-21，给 `--shadow-selected` 建 token 后核对产物时发现。
- **启动信号**：dogfood 中觉得 dark 下卡片 / dialog / 浮层「贴在背景上、浮不起来」或层次感弱；或下一次要动 dark 阴影时。
- **背景**：Tailwind v4 为 `@theme` 里的 `--shadow-*` 生成 utility 时**把值内联**进 `--tw-shadow`，不生成 `var()` 引用。产物实测：`.shadow-card{--tw-shadow:0 1px 2px var(--tw-shadow-color,#1f1b170a)}` —— 写死的是 light 的 `rgba(31,27,23,0.04)`。于是 `html[data-theme="dark"]` 块里那一整批 `--shadow-*` 重定义**对直写 utility 的调用点完全不生效**，dark 下拿到的是 light 的淡暖黑（4%）而不是设计意图的纯黑（18%–42%）。
- **影响面**（2026-08-21 实测）：**52 处直写受影响**（dialog / card / menu / tooltip 为主），**36 处用 `shadow-[var(--shadow-*)]` 写法不受影响**（button、composer、MessageUser 等——07-16 native-feel 那轮显然已经知道这个坑）。
- **方案**：把 52 处直写统一改成 `shadow-[var(--shadow-*)]` 形式。机械替换，可脚本化；风险在于改完 dark 阴影会**第一次真正生效**，观感会明显变化（变重），需要连带复核 dark 下各浮层的阴影值是否还合适——很可能当年调 dark 阴影值时就是照着「看不见」调的。
- **待定**：是否顺带把 `--shadow-*` 改成不进 `@theme`、只做普通 CSS 变量（那样 utility 就不存在，强制所有调用点走 var 写法，杜绝重演）。
- **关联**：[选中行三通道](./2026-08-21-sidebar-selected-row-three-channels.md) 落地时发现；`docs/design/foundations.md` shadow token 段。

---

## IM 里的下一步建议按钮化（next-suggestion 的 IM 消费端）

- **状态**：暂缓（漏出 bug 已由反方向修复：mandate 移出 IM 提示词）
- **提出**：2026-08-13（Discord dogfood 发现 `<next-suggestion>` 裸漏进
  所有 IM 渠道回复，裁决记录见
  [当日 devlog](./2026-08-13-im-suggestion-leak.md)）
- **启动信号**：JC 在 IM 里实际产生「这条建议我想一键发出去」的实感，
  或用户反馈希望 IM 端也有下一步引导。
- **方案**：建议语义在 IM 端其实成立且各平台有现成基建——飞书卡片可
  渲染成可点按钮（0009 卡片补丁）、Telegram 有 `InlineKeyboardButton`
  （tgapp 已 import）、Discord 退化为文末「💡 下一步」行或 View 按钮。
  点击 = 把建议文本当用户消息发送。
- **实施要点**：**与已落地的根修互斥**——根修把 suggestion mandate 从
  IM 提示词组合里拿掉了（`compose_im_runtime_prompt`），做本项需有条件
  地带回 mandate（仅对接了消费端的渠道），并撤销 0019 的对应剥离；
  每平台要接按钮回调，是 feature 量级不是修补量级。
- **待定**：是否只在部分渠道做（飞书卡片体验最顺）；建议长度与按钮
  文案的截断策略。
- **关联**：workbench 幽灵文字功能（`fa6241ac`，2026-08-04）；
  0019 补丁的移除条件已指向本项。

---

## User 消息 copy chip 的锚点（右上 vs 跟随阅读终点）

- **状态**：暂缓（皮肤与间距已在 2026-08-10 修好，只剩锚点未动）
- **提出**：2026-08-10（copy chip 换皮复盘，见
  [高亮笔改版](./2026-08-06-user-message-highlighter.md) 的「后续修正」节）
- **启动信号**：用户反馈或 dogfood 中出现「长粘贴消息想复制却要把鼠标甩回
  右上角」的实感。单行短句场景下现状无可挑剔，不要为长尾提前动手。
- **方案**：现状 `absolute left-full top-1.5`，两个假设都是 callout 时代
  留下的——`left-full` 锚的「块右边缘」在参差右缘的笔触形态里已不是视觉
  对象，只是布局矩形的边；`top-1.5` 锚第一行，而多行消息读完时视线在左下，
  且若最长行在上方、末行很短，chip 会悬在一片空白里。候选：改锚最后一行
  右侧（跟随阅读终点，代价是位置随内容跳）。
- **实施要点**：真机变体切换器摆「右上 / 右下 / 跟随末行」三态对比；间隙
  与皮肤已不再干扰判断（`ml-3` 补掉了 box-shadow 那 4px，chip 已改 bare）。
- **待定**：多行时 chip 位置随内容跳动是否比「固定但偏远」更差。
- **关联**：已否「移到块下方成行」——会与 assistant 那条持久 action bar 的
  形制靠近，冲掉「持久在回复栏 / 瞬态贴内容浮出」这个模型。

---

## 消息级 Retry（丢弃失败轮重跑，galley#14）

- **状态**：暂存（Continue 按钮已彻底否决，不在此列）
- **提出**：2026-08-10（社区 issue #14 triage，见
  [issue 分批落地](./2026-08-10-community-issues-triage-and-settings-polish.md)）
- **启动信号**：用户反馈里反复出现「bridge 硬死后要手动重贴原请求」——
  打字近似替代只在轮次完成场景成立；硬失败时 history replay 会丢弃末尾
  无回复的 user 行，重开会话的 agent 上下文里没有那个失败的请求。
- **方案**：路线 A（重启 + replay 复用）：新 Core 命令删
  `turn_index >= N` 的消息行（Rule 5，含 FTS 同步与 turnCount 重算）→
  GUI 失效 replay 缓存 → bridge 重启 → 现有 `load_history` 注回截断
  历史 → 原文+附件走正常 submit 重发（user 行删除重发，非保留特殊重发）。
  已否路线 B（runner 原地 truncate `backend.history`）：GA history 是
  thinking/tool_use/工具定义混排 blocks，轮边界簿记脆弱，且最需要重试
  的场景恰是 bridge 状态不可信的场景。
- **实施要点**：入口 = MessageActions 第三个 chip（仅最后一条 agent 回复
  显示、运行中禁用）+ 错误气泡上的重试入口（硬失败场景无 agent 回复可
  挂）；v1 不进 CLI/Agent API。
- **待定**：错误气泡入口形态；CLI/Supervisor 发起的轮次是否允许 GUI 重试。
- **关联**：不撤销已执行工具的世界副作用，文案交代即可。

---

## 推理强度 effort 变体条目引导（per-session 档位切换的承接方案）

- **状态**：暂存
- **提出**：2026-08-07（Composer 快捷切换入口被否后的替代路线，见
  [reasoning effort](./2026-08-07-reasoning-effort-default-and-badge.md)）
- **启动信号**：dogfood 中确实高频出现「这个会话想换档」，且手动配变体
  条目被抱怨绕。
- **方案**：同一模型配多个 provider/model 条目、仅 `reasoning_effort`
  不同（如 `gpt-5.6-sol` high / medium 各一条），复用现有 per-session
  LLM 切换（⌘K → Switch LLM）。产品化方向是在 Models 里提供「添加
  effort 变体」一键入口，自动复制条目并置档位；行内档位徽章（已落地）
  负责区分。
- **待定**：变体条目是否共享凭据引用；显示名自动后缀格式。
- **关联**：被否的重方案是 per-session transport override（Core →
  runner IPC → GA session facade `_TRANSPORT_OVERRIDES`），作用域正确
  但需整条新管道 + Agent API 波及——只有变体条目路线被实测否掉后才
  值得重启。

---

## 轮间距层级（answer → 下一问 的留白小于对内间距）

- **状态**：观察中
- **提出**：2026-08-06（折叠 run 垂直节奏讨论的连带观察，见
  [run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)）
- **启动信号**：dogfood 中觉得相邻问答对之间「挤」、边界不清。
- **现状**：轮与轮之间（上一回答 → 下一条用户消息）实际 20px（用户块
  `my-5`），小于对内的「问题 → 折叠头」24px——严格按邻近性层级是倒挂。
  但用户消息的高亮笔触是强视觉锚，边界感不完全靠留白扛，未必构成实感
  问题。
- **方案**：把 `MessageUser` 外层 wrapper 的上边距升到 `mt-7` / `mt-8`
  （保持 `mb-5`），使轮间 ≥ 28px > 24px，恢复「对间 > 对内」排序。
- **待定**：具体档位（28 vs 32px）；`GoalCommissionMarker` 前的间距是否
  同步。
- **关联**：[run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)、
  [user message highlighter](./2026-08-06-user-message-highlighter.md)。

---

## 自动滚动到最终答案开头（scroll-on-completion）

- **状态**：暂存
- **提出**：2026-05-13
- **启动信号**：beta / 公测用户反馈「每次长答案出来都要手动往上滚才能开始读」是高频痛点。
- **方案（E）**：默认 read mode；流式期间不做 stream-follow（用户可手动滚到底 opt-in watch mode）；`run_complete` 时 smooth scroll 把最终答案开头（`[data-role="final-answer"]` wrapper）定位到 viewport top + 32px。这个 scroll 动作本身同时充当「GA 完成了」的视觉信号。
- **实施要点（约 5 处小改）**：
  1. `Conversation.tsx` AgentTurnView：给 final turn 的 MessageAgent 套 `<div data-role="final-answer">`
  2. `useAppStore.ts`：加 `runCompleteTick: number`（初值 0）
  3. `ipc-handlers.ts` 的 `run_complete` case：`runCompleteTick + 1`
  4. `MainView.tsx`：加 useEffect 监听 tick，RAF 后 smooth `scrollBy` 到 final-answer（复用 `userSubmitTick` effect 的位置计算逻辑）
  5. `MainView.tsx` stream-follow effect：删掉提交后 `atBottom` 自动翻 true 的隐含行为
- **待定**：用户主动 scroll 中遇 `run_complete` 是否强制 snap（倾向 snap）；smooth 时长 200-300ms 未实测；anchor 用 MessageAgent wrapper 还是 StrongHr（倾向前者）。
- **关联**：原讨论已并入本节（原 `2026-05-13-scroll-on-completion-deferred` entry 已收编删除）。

---

## 已有对话 cwd live-sync（IPC `set_cwd`）

- **状态**：暂存
- **提出**：2026-05-13
- **背景**：Project 的 rootPath / cwd 绑定已于 2026-05-14 回收（见 [rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)）。DB column 与类型字段保留作 forward-compat —— 将来若重启 cwd 绑定，正解是这条 live-sync，而不是让用户重启 app。
- **启动信号**：beta / 公测有人反馈「改完项目路径要重启 app 才生效」是高频痛点。
- **方案**：bridge 加 IPC 命令 `set_cwd { path }` → 收到后调 `os.chdir(path)`（OS 级 API，真改进程 cwd）→ 之后 GA 的 `file_read` / `code_run` 相对路径解析与 subprocess 继承自动用新路径，无需重 spawn。desktop 端在保存 project rootPath 时，自动给该 project 下所有 alive bridge 派发 `set_cwd`。约 200-300 行。
- **实施要点**：bridge `set_cwd` handler + `ipc.py` dataclass + `ipc-protocol.md` 文档 + bridge 测试 + desktop `updateProject` 里自动派发。
- **待定**：GA 内部工具是否 cache 启动时 cwd（需 audit `ga.py`）；`os.chdir` 失败（路径不存在 / 无权限）的错误回滚链路；派发时机应在 save 按下时而非每次输入。
- **关联**：[Project rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)。原讨论已并入本节（原 `2026-05-13-project-cwd-copy-and-live-sync-deferred` entry 已收编删除）。

---

## workbench_bridge.py 类分解（Bridge god-class 拆分）

- **状态**：暂存
- **提出**：2026-07-23（Rust/GUI 大文件拆分两轮收尾时的排查结论，见 [拆分两轮 devlog](./2026-07-23-rust-and-gui-large-file-split-rounds.md)）
- **启动信号**：下次需要在 bridge 里做实质性新功能（新命令域 / 新遥测 / 新审批流），或它再次成为理解/review 瓶颈。
- **背景**：`runner/workbench_bridge.py` 1828 行，`Bridge` 一个类 50 个方法，混了 GA setup、managed 注入、usage/遥测、workspace 激活、审批 handler、事件发射、turn-end 序列化、命令分发、stdio 循环。是全仓最该拆的文件，但性质与 Rust 那五个不同：类方法共享 `self` 状态，是**类分解**不是自由函数搬家。
- **方案**：按域委托出协作对象（telemetry / approval / command-dispatch / emit），`Bridge` 保留编排。不要一次全拆，按"下次要动哪个域就先拆哪个域"推进。
- **实施要点**：动手前对照 CLAUDE.md Rule 1 —— 该文件正是 attach 模式集成点（`GenericAgentHandler` 子类、`_turn_end_hooks`、history 注入）的实现处，拆分不得改变 GA 边界行为；`tests/test_workbench_bridge.py`（1017 行）是护航基础，先跑通再动。
- **待定**：协作对象之间共享 `SessionState` 的方式（传引用 vs 事件）；`_FenceFilter` 等已独立的类是否先行搬到单独模块作为低风险第一步。
- **关联**：[Rust/GUI 大文件拆分两轮](./2026-07-23-rust-and-gui-large-file-split-rounds.md)。

---

## 架构审查第二轮剩余候选(hive Origin carrier / useComposerGoal / GaSession gate / quick wins)

- **状态**:暂存
- **提出**:2026-07-28(架构审查第二轮收尾,见 [审查 devlog](./2026-07-28-architecture-review-deepening-round.md);四个 Strong 候选已落地,以下为 Worth exploring 档)
- **启动信号**:下次动到对应模块时顺手做,或再跑一轮架构审查时按新鲜度重估。
- **候选 5 · hive Goal controller helpers 收窄**:`cli/src/goal/hive.rs` 的 phase helpers 接口宽(`resume_ready_worker_slots` 11 参,双 `&mut` 集合 + 返回值双向携带状态);`supervisor`/`reason` 裸对出现在 12 个签名、~53 次 clone,而 `core/src/api/origin.rs:49` 已有 `Origin` 概念可复用。先捆 carrier 再收 controller-state struct,最后重看双向 mutate。**已核对与 ADR-0002 不冲突**(这些 helper 全 `Result + ?` 传播,无分歧 failure contract)。
- **候选 6 · useComposerGoal 13 出参收成 goalView**:26 成员 interface 罩 ~90 行逻辑,3 个入参是回调回 caller,10 个返回值原样穿过 Composer 进 ComposerGoalControls。改返回 `goalView` 对象 + 4 action。
- **候选 7 · GaSession seam grep gate**:seam 本身干净(bridge 11 处调用零 reach-in),但"re-audit 面 = 一个文件"的承诺无 CI 强制,且 `managed_im_supervisor.py:346` 的 `_galley_im_prompt_installed` 写入是结构性旁路(该路径无 Bridge)。做法:grep gate(同 `check-supervisor-sop-drift.mjs` 文风)+ docstring 补旁路,或让 supervisor 路径也构造 `GaSession(agent)`。
- **Quick wins**:`hasRunningSessions` 收成 messages store selector(三处重推导:App.tsx / MainHeaderHost / app-update.ts);`lib/ipc/ga-output-cleaning.ts` 补测试(纯函数、流式热路径、零覆盖);`socket_listener/` 的 `use super::*` 互 glob 改具名 re-export(照 `codex_oauth/mod.rs`);`spawn_args_for_session_new` 7 参改 `&SessionBrief`+2;runtime store 补 slice-merge shape 守卫(照 `sessions.shape.test.ts`)。
- **关联**:[架构审查第二轮](./2026-07-28-architecture-review-deepening-round.md) · ADR-0002。

---

## 手动重新生成标题（regenerate title）

- **状态**：暂存（2026-08-04 JC 裁决先不加）
- **提出**：2026-08-04，自动标题（migration 038 / `generate_title`）发运后的讨论。
- **启动信号**：dogfood 中「想重新生成标题」的冲动实际出现——JC 自己留意频次，出现即证据。
- **背景**：自动标题是一次性（CAS 后 `title_source='auto'` 不再有资格）。隐藏出口已存在：**清空标题** 会重置回 seed，下次 `run_complete` 自动重生成（rename 空串路径的副产品，无 UI 提示）。
- **方案**：不是一个按钮，是三个决策——① 上下文取什么（重生成动机多为话题漂移，应取**最近**交换而非首轮，是另一套上下文策略）；② 锁定语义旁路（`user` 态被显式点按时该被绕过，一次性 CAS 要开洞）；③ 入口放哪（会话行右键菜单 / 标题栏悬停）。runner 的 `generate_title` 通路原样复用。
- **待定**：见方案三点。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)、`.scratch/session-auto-title/PRD.md`。

---

## 多建议 chips（next-suggestion 升级）

- **状态**：暂存
- **提出**：2026-08-04（ghost text 设计时即预留，准入判据讨论中确认排队）。
- **启动信号**：ghost text dogfood 证明建议**采纳率**可观——它是同一假设的加注，不是新假设，证据先行。
- **方案**：A2 标签频道白送——managed prompt 允许模型输出 2-3 条备选（标签格式扩展或多标签），`turn_end.nextSuggestion` 扩为数组（增量字段），渲染复用 `ask_user` candidates 的 chips 组件；主建议仍走 ghost text + →，备选点击填入。
- **待定**：多条时 ghost 与 chips 的并存形态；标签合同是多标签还是分隔符。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)、`.scratch/composer-next-suggestion/PRD.md`。

---

## ask_user candidates 补全（prompt 调优）

- **状态**：暂存
- **提出**：2026-08-04 准入判据讨论，唯二过筛的候选之一。
- **启动信号**：dogfood 观察到 GA 提问常不带候选、用户要打字回答本可点选的问题。
- **方案**：`RUNTIME_PROMPT_STATIC` 加一条「调用 ask_user 提问时尽量附带 candidates」——零成本纯 prompt 调优，现有 chips 渲染（`AskUserBubble`）立刻变勤快。managed 独占（attach 不碰 GA prompt）。
- **待定**：措辞对不同模型的遵从率；candidates 数量上限建议。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)。

---

## Session Workspace（会话产出的落点与可达性）

- **状态**：暂缓实现（2026-08-13 JC 裁决：设计定案，先不动手）
- **提出**：2026-08-13（读 deepseek-harness 的产物行实现 → 三轮实测 →
  设计定案，全文在
  [.scratch/session-workspace/PRD.md](../../.scratch/session-workspace/PRD.md)）
- **启动信号**：JC 再次遇到「找不到刚才生成的那份东西」并认为该动手；或
  Artifacts PRD 重启（本项是它点名的前置）；或
  `managed-ga-state/temp` 文件数从当前 **62** 继续增长到「打开工作区」也无法
  自救的程度。
- **方案**：核心事实是**非项目会话的产出全部落在
  `~/Library/Application Support/.../managed-ga-state/temp` 这一个平面目录**
  （实测 62 个文件，跨度 6–8 月，与 234 个引擎日志同级）。改为每 session 一个
  用户可见目录，命名 `YYYY-MM-DD-<短ID>`（标题在 session 开始时还不存在，
  且 Windows 非法字符 / MAX_PATH / 保留名三条都反对标题命名）。机制走
  **「软链 + `handler.cwd`」而非改进程 cwd**，配一个 managed patch 改
  `get_global_memory()` 写死的两句提示词；attach 模式降级为「只建软链 + 提示词
  引导」。
- **实施要点**：`workspace_path` 存 `sessions` 表首次定死（照抄
  `goals.workspace_path`），改设置只影响新 session；空目录 session 结束时回收，
  **不写标记文件**（会废掉回收）；工具调用的绝对路径**在 bridge 现场解析**
  （事后推导会在项目模式和 agent 自行 chdir 时猜错，而错的绝对路径比相对路径
  更坏），存进 `messages.tool_calls` 而**不复活 `tool_events`**（那是审批审计表，
  线上 0 行是因为跑 YOLO，改用它要付语义扩张 + 写入路径搬家 + 写放大三笔）。
- **待定**：**根的选址与 artifacts PRD 冲突**——本轮定的是 `~/Documents/Galley`，
  但 artifacts PRD 早已因 macOS TCC（文稿/桌面/下载在保护区）选了 `~/Galley`，
  该理由本轮没被提出，需复裁且会影响其余全部路径决策；另有短 ID 取值、空目录
  回收触发点、IM 渠道 session 是否供给工作区等五条，见 PRD。
- **关联**：[artifacts PRD](../../.scratch/artifacts/PRD.md) 定案第 1 条点名的
  前置就是本项，本项落地即满足那一条。已否并留痕：**轮尾「本轮产物」清单行**
  （dsh 形态——我们 `file_write`/`file_patch` 只 16 次而实际产出 62 个，
  绝大多数走 `code_run`，一份漏掉大半的清单比没有清单更坏）、正文路径提及做成
  可点链接（要往 Persona 加提示词，且 dsh 那套成立的前提是提示词与渲染器同包
  同生死）、检测 agent 自行 `chdir` 后的产出（同一条理由：检测不全比不检测更坏）。

---

## Artifacts（会话交付物：scratch 工作区 + API + GUI 面板）

- **状态**：搁置（2026-08-07 裁决，核心设计 1–4 已定案；2026-08-12 补了一个
  可独立发运的最小切片与路径事实校正）
- **提出**：2026-08-07（OpenWorker 两轮精读后成 PRD）
- **启动信号**：主 feature ——「拿到交付清单而不是聊天记录」的需求实际出现
  （supervisor 侧要结构化产出，或用户反复抱怨找不到 agent 写的文件）。
  最小切片 ——**一个可测判据**：展开若干真实会话的 `file_patch` / `file_write`
  tool callout，若 `args.path` 绝对路径占多数，则「打开 / 在 Finder 中显示」
  按钮值得单做；若相对占多数，说明真问题是产物落点，直接回主 PRD。
- **方案**：全文在 [.scratch/artifacts/PRD.md](../../.scratch/artifacts/PRD.md)
  （含 OpenWorker 参考笔记、安全红线、5 个未决问题、UX 走查发现 A/B）。
  核心洞察：**artifact 不是存储系统，是工作区上的一层透镜**——不建库、
  不做版本、文件系统是唯一真相源。
- **实施要点**：scratch 工作区机制必须先行（没有确定落点，面板只能扫用户项目
  目录，信噪比崩坏）；HTML 预览的 iframe **禁止 `allow-same-origin`**
  （OpenWorker 在此有真实漏洞）；目录遍历先剪后走（engineering-workflow I12
  的 macOS TCC 教训）。
- **待定**：scratch base 终值与目录布局；哪些会话显示面板；`artifact:` 契约
  注入位置（倾向 Persona）；面板形态（无右栏是 2026-05-12 存档裁决，留了活口）；
  API 命名与字段。
- **关联**：PRD §6.3 的「Artifacts 一等公民」非目标仍然成立——本 feature 若启动
  需先改那条。已否：按扩展名过滤（`.md` 在 coding 仓库里绝大多数是源码，
  区分不了「仓库文档」和「交付物」）、在 Galley 内重造 app 选择器
  （Finder 右键「打开方式」更好）、GUI 侧自行解析相对路径
  （基准在 GA 内部，等于重新实现 GA 逻辑）。

---

## LiveDots 剩余两站点的工作指示语言统一

- **状态**：暂缓（2026-08-12 shimmer 裁决时的自觉遗留；同日 RunElapsedHud
  已出列——启动信号当日触发，三点删除 + 时长改会话方言，见 entry 后记）
- **提出**：2026-08-12（[thinking 计时器与 shimmer 裁决](./2026-08-12-thinking-timer-and-shimmer-verdict.md)）
- **启动信号**：dogfood 中实际感到「两种 working 语言并存」刺眼——比如
  thinking 行扫光与 ToolCallout 三点在同屏同时可见时读作两个产品；或任一
  站点因别的原因重做时顺带评估。
- **方案**：thinking 行已改状态文字扫光（§2.7 唯一豁免），RunElapsedHud
  已改「计数器即活性」的无动效形态，LiveDots 仍服役于 ToolCallout
  （运行中工具）、GoalRunMarkers（goal 运行尾标）。暂不统一的论证：两处
  语义是工具 / goal 级忙碌，不是「LLM 正在思考」，三点作为通用 working
  指示语义成立；且 §2.7 豁免边界写明「一视图至多一处 shimmer」，全量迁移
  会直接违反刚立的边界。
- **实施要点**：若启动，方向不是「都改 shimmer」而是逐站点问「这里的
  liveness 是否已有别的承担者」——RunElapsedHud 的先例是删除而非替换
  （ToolCallout 行内已有 spinner + 计数器，三点同样可能直接删）；
  GoalRunMarkers 无计数器，是唯一删掉三点就没有活性信号的站点。
- **待定**：「一视图至多一处」边界与多站点迁移的相容方案。
- **关联**：[foundations.md §2.7](../design/foundations.md) 豁免条款；
  `LiveIndicators.tsx`。

---

## 已暂停渠道的折叠头「启动」按钮

- **状态**：暂缓（自动展开收窄的已知代价，先观察实感）
- **提出**：2026-08-13（[自动展开谓词收窄](./2026-08-13-channels-auto-expand-predicate.md)）
- **启动信号**：dogfood 或用户反馈里出现「重启一个渠道还要先点开卡片」的
  实感。频率低就不动。
- **方案**：`stopped` 不再自动展开后，「启动」按钮只在卡体内，重启已配置
  渠道多一次点击。补救是在折叠头右侧 actions 区（`ChannelActionsMenu` 所在
  位置）给 `stopped` 状态加一个 ghost「启动」，那块地方本就常驻控件。
- **实施要点**：四张卡的启动动作签名不同（WeChat 走 `SettingsIM` 的
  `runAction`，另外三张走卡内 `run("connect")`），补按钮要么各自接、要么先
  把启动动作提到 `ChannelCard` 的 header 插槽上；别为此把状态推导再复杂化。
- **待定**：只给 `stopped` 加，还是 `not_connected` 也给（后者点了没用——
  凭证还没填，会把人送进一个立刻报错的动作）。倾向只给 `stopped`。
- **关联**：改模型后的批量重启已有 `staleConfig` 横幅那条路，本项只覆盖
  单渠道手动暂停后的重启。

---

## Channels 展开态跨进出 Settings 记忆

- **状态**：暂缓
- **提出**：2026-08-13（[自动展开谓词收窄](./2026-08-13-channels-auto-expand-predicate.md)）
- **启动信号**：配置渠道时实际被打断（去 Models 查个模型再回来）并感到
  「又要重点一次」。
- **方案**：`expandedOverride` 是组件态，离开 Settings 即丢。自动展开变稀疏
  后，配到一半切走再回来要重新点开。照 `FeishuCard` 的 `cachedFeishuConfig`
  模块级缓存的路子，记住手动展开过的渠道。
- **实施要点**：只记**手动**展开（`expandedOverride !== null`），别把自动
  展开的结果写进缓存——否则一次报错会让那张卡此后一直展开，等于把刚删掉的
  「永久展开」从后门放回来。
- **待定**：进程内缓存够不够，还是要落 UI 偏好（倾向进程内，跟 config 缓存
  同级，重启归零是可接受的）。
- **关联**：`SettingsIM.tsx` 四张卡各自持有 `expandedOverride`。

---

## 原生 About 面板改为通往 Settings → About（品牌门面收口）

- **状态**：暂缓
- **提出**：2026-08-14（JC 贴出 About 截图问要不要优化；同场排查澄清了两件
  事：dev 模式下那个蓝色文件夹是**裸二进制没有 bundle**、不是缺陷，装好的
  App 图标正常；`website` / `website_label` 两行死配置已当场删除）
- **启动信号**：JC 真的要动品牌门面时——这条和「sidebar wordmark 可交互」
  是同一件事的两面，别单独启动。或者用户反馈找不到版本/更新入口。
- **方案**：把 `app_menu.rs` 里的 `PredefinedMenuItem::about` 换成自定义
  `MenuItemBuilder`，点击直接开 Settings → About（复用现有的 settings
  菜单项路径）。VS Code / Figma 都是自定义 About 窗口，惯例成本可接受。
- **实施要点**：落差不在面板本身而在**它是个死胡同**——`SettingsAbout.tsx`
  有出身故事（「Why Galley?」彩蛋）、版本 + 发布日期 colophon、更新控件、
  内核 baseline 日期，而走 macOS 惯例路径的人落在一张三行卡片上，没有出口
  通向那些东西。改完是「一扇门通向好房间」，不是「两个房间各自为政」。
  注意 `app_menu.rs` 里「Check for Updates…」是 About 下面的独立项，收口后
  它和 Settings → About 里的更新控件会重复，要一并想。
- **待定**：原生面板本身其实是对的（正确、符合惯例、图标正常），换掉它换来
  的是内容深度、付出的是 macOS 惯例——这笔交易划不划算没定论；「Version
  0.4.7 (0.4.7)」的口吃**不在本项范围**（AppKit 从 `CFBundleVersion` 填括号，
  Tauri 把它设成和版本号同值，要消掉得引入真实 build number，不值）。
- **关联**：`core/src/app_menu.rs`（六个字段的注释已写明 macOS 只认哪些）；
  `gui/src/components/screens/settings/SettingsAbout.tsx`；sidebar wordmark
  交互讨论（2026-08-14，未落 devlog——被 About 话题打断，结论止于「拖拽把手
  是硬约束、题词先例判死了开新 session、彩蛋是唯一误触无害的选项」）。
