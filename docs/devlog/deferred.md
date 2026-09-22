# 挂起的想法（Deferred）

想清楚了、留了方案、但决定暂不实施的想法都记在这里 —— 一想法一节，等启动信号再开工。

与时间线的分工：[时间线](./README.md) 记「已发生的历史」（不可变）；本台账记「想做但还没做的事」（会增删）。真正开工时，把对应小节从这里拎出来、落成一篇正式 devlog entry，并从本台账删掉。

每节固定字段：**状态 / 提出 / 启动信号 / 方案 / 实施要点 / 待定 / 关联**。

---

## 上游 PR：让 GA `run()` 消费 `put_task(images=)`（删 0008 + attach wrapper）

- **状态**：暂存（2026-09-18 外置 GA 图片输入落地时拆出）
- **提出**：2026-09-18，[外置 GA 图片输入 devlog](./2026-09-18-external-ga-image-input.md)。
- **启动信号**：上游维护者对引擎层多模态表态；或上游 desktop_bridge 放弃 `_patch_chat_for_images` 改由 `run()` 处理；或 0008 / wrapper 在某次基线升级里 rebase 出真冲突。
- **方案**：把补丁 0008 的消费端（`run()` 读 `task["images"]` → `image_content_blocks` → `agent_runner_loop(initial_user_content=)`，外加 `NativeToolClient.chat` 的空白过滤放过非文本块）作为上游 PR 提交。合入后按 Rule 1「上游有了就删补丁」同时删 0008 和 `GaSession.arm_image_delivery`。
- **实施要点**：wrapper 已对「消息里已有图片块」跳过，所以上游先合、Galley 后删的过渡期不会双份；删除时同步收 `imagesSupported` 的判据（改为按上游能力探测或恒 `true`）。
- **待定**：上游是否愿意在引擎层接多模态——它自家桌面前端选的是前端包 `ask`，暗示未必。
- **关联**：[managed 补丁清单 0008](../../managed-ga/patches/manifest.md) · [GA baseline 契约面第 11 项](../ga-baseline.md#contract-surface)。

---

## 用户消息排印微调（气泡之后的独立重审）

- **状态**：暂存（2026-09-17 气泡定案时拆出，明确不与形态捆绑）
- **提出**：2026-08-21 质感实验后记「后续方向」的第二条；2026-09-17 用户消息改为杏沙气泡（[devlog](./2026-09-17-user-message-bubble.md)）后单独立项。
- **启动信号**：气泡形态跑一段时间后仍觉得用户消息「平」；或真机里觉得 Inter medium + 容器是双重信号、字重显得多余。
- **背景**：用户消息与 agent 正文字号 / 行高 / 墨色相同，只差 Inter 500 vs Newsreader 400 与底色。08-06 前底色承担了全部区分职能，所以排印统一（2026-06-20）成立；容器加上后字这条通道可能已经不需要再出力。
- **方案**：字重 `medium → regular`，或字距放松一档；二选一，真机切换器对比。注意 08-06 Round 1 输掉的「访谈体」是**去掉底色**的极端方案，不能用来否定「保留容器 + 微调排印」；但这条明确会碰 2026-06-20 的排印统一裁决，**必须作为重审来做**。
- **不推荐**：调 `my-5` 的竖向节奏——那是全局问题，不值得为单个组件动。
- **已关闭的前置项**：「落笔」入场动效（2026-08-21 提出，笔触从左向右展开）——它的隐喻是「被划过的句子」，2026-09-17 用户消息改气泡后隐喻不再成立，方案随之作废；若日后想给用户消息补入场动效，应从「块级软淡入与 agent 侧对称」重新起草，不要复活笔触展开。
- **关联**：[气泡定案](./2026-09-17-user-message-bubble.md) · [质感实验](./2026-08-21-user-message-texture-experiment.md) · [高亮笔重设计](./2026-08-06-user-message-highlighter.md)。

---

## Goal「用满时间」模式（use_budget）

- **状态**：暂存（2026-09-16 goal v2 真机后讨论，JC 裁决先按 Codex「干完为止」用法）
- **提出**：2026-09-16，[goal v2 devlog](./2026-09-16-goal-v2-codex-shape.md) 后记四。
- **启动信号**：JC 实际用 goal 的主场景是「离开桌面扔一个长任务」或「quota
  快重置、把余量用掉」——即想让 agent 把时间用满；若真机里反复出现「10 分钟
  上限、2 分钟就自判完成」的落差，或出现明确想烧 quota 的场景，启动。
- **方案**：同一引擎加 `goals.mode`（`until_done` / `use_budget`）。`use_budget`
  必须有上限；续跑提示换一版——预算是计划不是上限，每轮必须是有据的改进
  （审计当前最佳的缺口 → 沿目标扩展 → 验证，维护「当前最佳」，不复述不翻工不
  越界）；完成收紧为「连续两轮审计无改进才可打 complete」；到点走现有收尾轮，
  `budget_limited` 文案改「时间用满」。
- **实施要点**：039 未发版可直接加列；`CreateGoalInput.mode`；`goal_prompts.rs`
  一份续跑变体；确认框两档开关；CLI flag；文档。引擎与状态机不动。
- **待定**：默认模式（讨论时倾向 `use_budget`）；`use_budget` 下是否完全禁止
  提前完成；预算按「截止时刻」输入（quota 重置时间）作为自定义框的第二种写法。
- **与 v1 的区别**（防止被当成回退）：v1 solo 的 nudge 只说「不能宣告完成、继续
  提高质量」，没有定义有效改进；这里靠 Codex 式的上一轮分类与审计协议约束，
  且允许在真正做到头时停。
- **关联**：[goal v2 devlog](./2026-09-16-goal-v2-codex-shape.md)、
  `.scratch/goal-simplify/PRD.md` §6 裁决 2。

---

## 过程区密度：更大的刀（单行合并 / rail 重塑 / 横向利用率）

- **状态**：暂存（2026-08-23 密度 pass 探讨中裁决：A 刀落地，B/C/横向案暂缓——见 [密度 pass](./2026-08-23-step-density-pass.md)）
- **提出**：2026-08-23，JC 指多步 run 过程区空间利用率低、层级应低于 final answer。当日已落的 A 刀：run 内 `mt-3` 两档间距 + 裸步合并（详见 devlog）。以下是当时评估过、刻意没动的三把更大的刀。
- **B. 全面单行合并**（每步 marker+pill 合一行）：**2026-09-16 真机试过并否决**——`flex-wrap` 变体（summary 装得下时 pill 跟在句尾、装不下折行，一行步 31）落地一轮（`0270ff56`，已 revert），JC：「太密集后，单个步骤的阅读体验其实变得更差了」。否决理由记入 [步号淡一档 devlog](./2026-09-16-step-marker-recede-and-reference-audit.md) 后记九：密度与阅读体验在同一套静态排版里无解，空间问题改按状态分流（完成即折、live 封顶另议）。**不再作为密度手段重提**；若将来重开，只能以「阅读形态本身更好」为由，且要同时解决同行两个披露 caret 的问题。
- **C. timeline / rail 重塑**（左侧竖轨连接步骤的日志形态）：
  - 启动信号：过程区的角色从「瞬态过程日志」变成「需要长期回看的执行轨迹」（例如 Goal 场景要求跨 run 审计）。在 settled run 会折进 RunFoldHeader 的现状下，为瞬态区域做重皮肤不值。
- **横向利用率 / 列宽**：inline pill 右对齐 mono 工具名在宽窗口下拉出大片死区；conversation 列没有 max-width，是否该有 measure 是独立且更大的排印题（会牵动正文行长）。
  - 启动信号：JC 在宽屏 dogfood 中对行长或死区有实感；或做阅读排印批次时一并。
- **关联**：[密度 pass](./2026-08-23-step-density-pass.md)；下一节「第 1 步前缀收敛」（B 的规范近亲）；`conversation.md` §4.3 间距演化史第 6 条。

---

## 单步 run 的「第 1 步」前缀收敛（TurnMarker 步号）

- **状态**：暂存（2026-08-23 探讨定案，JC 当日裁决保持现状；agent 复核后同意——见「不启动的理由」）
- **提出**：2026-08-23，JC 两问：多步 run 里「第 / 步」重复是否无效信息；单步 run 显示「第 1 步」是否别扭。多步部分当场终裁：**保持「第 N 步」，裸数字方案永久否决**——重复标签是排版节奏不是噪音（读者第二行起只扫 tabular 数字），且 thinking 态会变成「3 │ 思考中 · 12.3s」一行两个无单位数字互相打架。此条否决不随本节启动而复活。
- **启动信号**：JC dogfood 中反复被「第 1 步 · 直接回答了用户问题」的报幕感硌到。判据要计入曝光量事实：它默认只在最近一次交换可见（完成 run 默认折叠、仅 `keepOpener` 展开，`Conversation.tsx:151`），下次交换完成即折进「1 步 · N 秒」的 RunFoldHeader——若这样的瞬态单例曝光仍产生实感，才值得动。
- **不启动的理由**（2026-08-23）：①曝光是瞬态单例不是累积墙（见上）；②只能收前缀不能删行，而前缀在单步场景兼任「这行是过程元数据」的登记标签，收掉后孤行「直接回答了用户问题」可能更没来头；③换来一条带例外的条件规则（「before/after 视觉一致」要开洞 + run 中段孤步不收的不对称）。「·1 是噪音」（layout-and-chrome.md sidebar 角标条款）类比偏弱——那是纯计数徽章删整个信号，这里行还在、还承载入口。
- **方案**：settled 且 run 已完成的收尾回答轮、显示步号为 1 → 收掉「第 1 步 │」前缀，保留 summary + chevron（DetailPanel 入口挂在此行）。**按编号段判而非按 run 判**：ask_user 回复也是一次 `put_task`、步号重新从 1 数（`workbench_bridge.py:1474`），收尾孤步段同样收；run 中段孤步（第 1 步即发 ask_user 暂停）不收——那里序列被暂停而非结束。
- **实施要点**：TurnMarker 已支持 `index` undefined 的无前缀形态（`Conversation.tsx:569`），复用即可；aborted run 不收（无 settle 语义，序列被打断是事实）；en（`Step 1`）结构性同款，零文案改动；sidebar `第 N 步 · {summary}` 不跟随（独立语境需要单位）；`conversation.md` 需注明这是「before/after 视觉一致」的有意例外；判定条件补单测。
- **待定**：若启动时仍嫌残留孤行冗余，「删整行」要作为对两条既有约束的重审来做（DetailPanel 入口；StrongHr 的 action→conclusion 修辞需上方 action 列，`Conversation.tsx:433`）。
- **2026-09-16 第二次提出并翻案**：JC 再问「只显数字是否可行」并贴外部 ReasoningTrace 参考组件（`01` 补零等宽序号）。第一轮复核维持否决、只改编号淡一档；JC 真机看过后仍嫌繁琐，第二轮翻案：**多步改为补零序号 + 去 hairline + 24px 序号栏、过程体整体缩进**（08-23「永久否决」的依据被真机实感推翻，详见 [devlog](./2026-09-16-step-marker-recede-and-reference-audit.md)）。**本节的单步问题不受影响**：单步 run 现在显示「01 summary」，JC 说「都行」= 启动信号未触发，维持暂存；若将来启动，方案改为「收尾孤步收掉序号 gutter、summary 顶到列左」，其余判据不变。
- **关联**：`conversation.md` TurnMarker 节（锚点靠对齐不靠墨量）；`Conversation.tsx:474`（「步 vs 轮」选词理由）；`layout-and-chrome.md` sidebar 角标「·1 是噪音」条款（规范近亲，非同物）。

---


## Ollama / 本地端点预设（Settings → Models 预设表）

- **状态**：暂存（2026-08-31 无鉴权 Provider 落地时 JC 裁决本轮不加）
- **提出**：2026-08-31，[无鉴权 Provider](./2026-08-31-no-auth-provider-empty-apikey.md) 的连带候选——预设表至今没有任何本地条目，本地用户要走「自定义」手填。
- **启动信号**：本地端点用户反馈「配置 Ollama 要摸索」；或社区再出现 ollama / 本地模型相关 issue。
- **背景**：无鉴权能力（`authKind: "none"`、key 可留空）已落地，是本项的前置。差的只是一张预设卡：apibase 预填 `http://localhost:11434/v1`、协议 openai、key 留空即可。
- **方案**：`managed-model-presets.ts` 加 ollama 条目。要一并定的：预设显示名 / 图标；`recommendedModel` 给什么（本地模型名因人而异，可能留空走「读取模型列表」）；是否顺带覆盖 LM Studio（`localhost:1234/v1`）等近亲。
- **待定**：一张卡还是「本地端点」一类；`apiKeyPlaceholder` 文案（应显式写「无需填写」）。
- **关联**：[无鉴权 Provider devlog](./2026-08-31-no-auth-provider-empty-apikey.md)；下一节「`api_key_header` 的 GUI 入口」（同为该面的暂缓项，启动时可同批评估）。

---

## `api_key_header` 的 GUI 入口（Anthropic 协议中转的鉴权头覆盖）

- **状态**：暂存（2026-08-21 GA baseline 升级时发现，本次有意不做）
- **提出**：2026-08-21，`f06d550` -> `30b24ad` 外审读到上游 `c9cb4b5`（社区 PR #751）。
- **启动信号**：有用户（或 JC 自己）配置「说 Anthropic `/v1/messages` 协议、但 key 不带 `sk-ant-` 前缀」的中转端点时撞 401；或下一次动 Settings -> Models 高级面板时顺手。
- **背景**：上游给 `NativeClaudeSession` 加了可选 cfg 键 `api_key_header`，取值 `auto`（默认，旧的 `sk-ant-` 前缀启发式）/ `x-api-key` / `bearer`。那类中转（上游举例 opencode.ai）只认 `x-api-key`，而 `auto` 对非 `sk-ant-` key 发 `Bearer`，结果 401 Missing API key。**Galley 的 runner 侧已经通了**：`managed_runtime.managed_model_config_from_env` 是 `cfg.update(advanced)`，模型的 `advancedOptions` 原样透传进 GA session cfg，不需要任何代码改动。差的只是入口——`AdvancedModelOptions` 编辑的是一组策展字段（`max_retries` / `read_timeout` 等），这个键不在其中，用户没法敲进去。
- **方案**：两条路。① 在高级面板加一个三选一（`auto` / `x-api-key` / `bearer`），只对 `protocol === "anthropic"` 显示；② 不加字段，只在某个中转预设的 `recommendedAdvancedOptions` 里带上——成本更低但只覆盖预设过的端点。
- **待定**：这是不是一个真需求。目前**没有任何用户报告**撞过这个 401，纯属读上游 diff 读出来的能力。①的成本是给一个策展面板加一个多数人用不到的字段，与「一屏配好模型」的产品方向有张力。等真实信号比现在动手更划算。
- **第二信号（2026-09-08）**：issue #26 提出「高级参数键值编辑区」作为退路。但它要的是策展字段（推理强度 / fast），不是自由 KV；推理强度当日已提为一级字段解决，本条状态不变。
- **关联**：[GA 上游升级 f06d550 -> 30b24ad](./2026-08-21-ga-upstream-upgrade-f06d550-to-30b24ad.md) · `runner/managed_runtime.py` `managed_model_config_from_env` · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

---

## OpenAI `service_tier`（fast / priority 档）进高级面板

- **状态**：暂存（2026-09-08 JC 裁决「fast 先不做」）
- **提出**：2026-09-08，issue #26 第二步「fast 开关，更快但更贵」。
- **启动信号**：有用户明确说在用 priority tier；或上游给 Claude 加 fast（`speed`）时一并做。
- **背景**：内核 `_enum('service_tier', {auto, default, priority, flex})` 已支持，只在 OpenAI payload 发送；GUI 没暴露，属于「有能力没入口」。Claude 的 fast 内核根本没有，按管理运行时纪律等上游，不自己 patch llmcore。
- **方案**：高级面板加三选一 `auto` / `priority` / `flex`，只对 `protocol === "openai"` 显示，文案标注「更快、计费更高」。不进 Composer。
- **待定**：Codex OAuth 后端是否透传该字段，做之前查 `_stream_openai` 的 codex 分支。
- **关联**：[issue #26 model config UX](./2026-09-08-issue-26-model-config-ux.md) · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

## 会话内查找（Ctrl+F）

- **状态**：暂存（2026-09-08 JC 裁决先不做）
- **提出**：2026-09-08，issue #27「如果能顺带支持当前会话内查找，长会话里定位更方便」。
- **启动信号**：有用户在跨会话定位落地后仍抱怨长会话内找不到；或 JC 自己在几千字回答里回找时觉得 ⌥↑↓ 不够。
- **背景**：Tauri 的 webview 不带浏览器那条原生查找栏（WKWebView / WebView2 都没有），Ctrl+F 现在是空操作。跨会话的 FTS 命中已经能定位到消息（见 issue #27 devlog），会话内查找是同一根锚线上的另一种入口。
- **方案**：Composer 上方或对话区右上角一条紧凑查找条，输入即在当前 `turns` 的文本里做子串匹配（不走 SQLite，数据都在内存），命中计数 + 上一个/下一个，定位复用 `USER_MSG_ANCHOR_TOP_PX` 锚线与 `message-locate-flash` 洗染；Esc 关闭。Markdown 渲染后的 DOM 高亮（`<mark>`）是第二步，第一步先做块级定位。
- **待定**：快捷键归属——Ctrl/⌘F 在 Composer 聚焦时是否让给文本框；rail 的 question index 与查找条是否会在右缘打架。
- **关联**：[issue #27 devlog](./2026-09-08-issue-27-message-search-locate.md) · `gui/src/hooks/useStickyScroll.ts` 的 locate 效果 · `docs/design/conversation.md` rail 一节

## `shadow-*` utility 在 dark 下静默使用 light 阴影值

- **状态**：暂存（2026-08-21 落选中行抬升时撞见，JC 尚未裁决是否开工）
- **提出**：2026-08-21，给 `--shadow-selected` 建 token 后核对产物时发现。
- **启动信号**：dogfood 中觉得 dark 下卡片 / dialog / 浮层「贴在背景上、浮不起来」或层次感弱；或下一次要动 dark 阴影时。
- **背景**：Tailwind v4 为 `@theme` 里的 `--shadow-*` 生成 utility 时**把值内联**进 `--tw-shadow`，不生成 `var()` 引用。产物实测：`.shadow-card{--tw-shadow:0 1px 2px var(--tw-shadow-color,#1f1b170a)}` —— 写死的是 light 的 `rgba(31,27,23,0.04)`。于是 `html[data-theme="dark"]` 块里那一整批 `--shadow-*` 重定义**对直写 utility 的调用点完全不生效**，dark 下拿到的是 light 的淡暖黑（4%）而不是设计意图的纯黑（18%–42%）。
- **同族先例（2026-09-08）**：`--opacity-*` token 写成无单位小数、被 `color-mix` 整条丢弃，77 处填充静默透明，已修（改成百分比）。这条 shadow 的病因不同（内联值）但症状同类：token 建了、产物里不生效、没人看得出来。修本条时照 09-08 的办法先在产物里 grep 验证。
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

## 轮间距层级（answer → 下一问 的留白小于对内间距）

- **状态**：观察中
- **提出**：2026-08-06（折叠 run 垂直节奏讨论的连带观察，见
  [run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)）
- **启动信号**：dogfood 中觉得相邻问答对之间「挤」、边界不清。
- **现状**：轮与轮之间（上一回答 → 下一条用户消息）实际 20px（用户块
  `my-5`），小于对内的「问题 → 折叠头」24px——严格按邻近性层级是倒挂。
  但用户消息的杏沙气泡（09-17 前是高亮笔触）是强视觉锚，边界感不完全靠
  留白扛，未必构成实感问题。
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

## 架构审查第二轮剩余候选(useComposerGoal / GaSession gate / quick wins)

- **状态**:暂存
- **提出**:2026-07-28(架构审查第二轮收尾,见 [审查 devlog](./2026-07-28-architecture-review-deepening-round.md);四个 Strong 候选已落地,以下为 Worth exploring 档)
- **启动信号**:下次动到对应模块时顺手做,或再跑一轮架构审查时按新鲜度重估。
- **候选 5**（hive Goal controller helpers 收窄）随 2026-09-16 goal v2 退役 `cli/src/goal/` 一并消失。
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

## ask_user 候选项携带说明（option-desc，`{label, desc}` / tooltip）

- **状态**：取消（2026-09-14 JC 裁决，数据依据见
  [devlog](./2026-09-14-ask-user-option-desc-cancelled.md)；PRD 与三张票置
  `wontfix` 留在 [.scratch/ask-user-option-desc](../../.scratch/ask-user-option-desc/PRD.md)）
- **提出**：2026-08-11，社区 [galley#21](https://github.com/wangjc683/galley/issues/21)。
- **为何不做**：本机四个月 55 条真实候选项里零次出现「标签短到看不出后果」；
  模型自己把后果写进标签，短标签均为无需解释的词。同日 D2 的 row / list
  排布已解决候选侧真实出现过的问题。
- **启动信号**：dogfood 或社区再出现「裸短标签且用户因此追问一轮」的具体
  实例（要有截图或会话记录，不是描述）；或上游 GA 自己给 candidates 加了
  说明字段（那时只需 GUI 消费，无需补丁）。
- **若重启**：先读 devlog 里的「PRD 过期点」——形状倾向并行参数
  `candidate_descs` 而非对象；补丁点在 `assets/tools_schema*.json`；schema
  先于视觉实测；有 desc 直接归 list + 小字副行。
- **待定**：#21 的回帖（JC 2026-09-14 决定暂不回）。

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
- **2026-09-17 部分落地**：「工具调用的绝对路径在 bridge 现场解析、存进
  `messages.tool_calls`」这一条已单独实现（`toolCalls[].resolvedPath`，只覆盖
  `file_write` / `file_patch`），并接了 GUI 的写入步骤入口与正文按名解析，见
  [written-file references](./2026-09-17-written-file-references.md)。本项其余
  部分（每 session 目录、软链 + `handler.cwd`、`code_run` 产物）仍暂缓。
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
  注入位置（倾向 Persona）；API 命名与字段。面板形态**不再是待定项**：
  2026-09-08 起右侧阅读面板已存在（Markdown / 文件预览 + Git 审阅），
  PRD 里「Galley 无右栏」的前提失效，重启时直接沿用该面板。
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
  （运行中工具）；goal 运行尾标随 2026-09-16 goal v2 退役（v2 的暂停 /
  受阻尾标是静态的，无活性信号）。暂不统一的论证：工具级忙碌不是「LLM
  正在思考」，三点作为通用 working 指示语义成立；且 §2.7 豁免边界写明
  「一视图至多一处 shimmer」，全量迁移会直接违反刚立的边界。
- **实施要点**：若启动，方向不是「都改 shimmer」而是逐站点问「这里的
  liveness 是否已有别的承担者」——RunElapsedHud 的先例是删除而非替换
  （ToolCallout 行内已有 spinner + 计数器，三点同样可能直接删）。
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

## 定时任务当天补跑触发失败（scheduler catch-up fire 无会话产生）

- **状态**：待查
- **提出**：2026-09-09，README 截图 v2 实拍中两次观察到
- **启动信号**：任何用户报告「上次触发失败」；或下次碰 `core/src/scheduler.rs`
- **方案**：复现路径已知——种一条 `last_fired_at` 早于今天时段的每日任务，
  启动 dev，Core 在一个 tick 内发起补跑，`last_fired_at` 被盖成触发时刻、
  `last_run_session_id` 为 NULL。要看 `dispatch_line_with` 返回的错误：怀疑
  方向是 dev 环境下 `session.new` 因 `llm_name` 为空 / 无默认模型被拒，或
  runner 启动失败。
- **实施要点**：先在 `scheduler.rs` 的失败分支把响应体打进日志，再决定是
  修派发参数还是修错误提示（面板只说「失败」，用户无从下手）。
- **待定**：是否只在 dev 复现（截图库是 onboarding 后立即种入，模型配置齐全，
  倾向不是环境问题）。
- **关联**：`docs/devlog/2026-09-09-screenshot-set-v2-plan.md`；
  `scripts/seed-screenshots.py` 的 `minutes_since_local`。

## 长工具输出在右侧阅读面板全文阅读

- **状态**：暂缓（2026-09-09 JC 裁决：右侧面板三个候选中，可读文件预览与
  Git 基线选择本轮做，本项先挂）
- **提出**：2026-09-09，右侧面板「还能装什么」讨论的第三候选
- **启动信号**：JC 真机复核 Agent 工作时遇到「过程区里一段 `code_run` 输出
  或整页 fetch 结果只看得到头尾、想看全却看不到」；或用户报告同类抱怨。
- **方案**：`ToolCallout` 加「在阅读面板打开」，把该次工具调用的完整输出
  （已在内存的 turn 数据，零后端改动）送进右栏，用 `PlainFileLines` 同一
  寄存器全文、可滚动、软换行显示；header 标题为工具名 + 步号，副标题为
  会话标题。与文件预览同一宿主（`LocalFileWorkspace`），会话级生命周期。
- **实施要点**：过程区现有折叠 + 尾部截断（#22 那轮定的）保持不动，本项
  只加出口不改过程区密度；输出超大时沿用 2 MiB 上限的截断说明。
- **待定**：入口放在 callout 的 hover 动作还是折叠头右侧；是否顺带支持
  `file_read` 结果（与文件预览重叠，倾向不做）。
- **关联**：[2026-09-09 阅读面板扩展 devlog](./2026-09-09-reading-panel-files-and-git-baseline.md)
  （候选比较与裁决）；`gui/src/components/conversation/ToolCallout.tsx`。

---

## 重试等待期间的 GUI 反馈

- **状态**：暂存（2026-09-14 开放 `max_retry_after` 时浮出，有意不并入）
- **提出**：2026-09-14，[高级配置开放 max_retry_after](./2026-09-14-max-retry-after-advanced-option.md) 的余量项。
- **启动信号**：有人把重试等待上限调大后抱怨「像卡死」；或无人值守（Goal / Supervisor）任务因可重试错误直接死掉的投诉——后者同时是「Retry-After 超上限时睡到上限再重试」这条语义改动的启动信号，两条一起做。
- **背景**：内核 `_stream_with_retry` 退避期间只 `print` 一行 `[LLM Retry] HTTP 524, retry in 90.0s (1/4)`，core / runner / gui 无人消费，用户看到的是转圈。停止按钮能打断这段睡眠（`agentmain.py` 把 `should_stop` 接进了可中断 sleep），所以不是死锁，是静默等待。上限默认 60 秒时静默最长 60 秒；开放旋钮后用户可以把它调到几分钟，静默随之变长。
- **方案**：runner 把 `[LLM Retry]` 行识别成结构化事件（或给内核加一个 emit-only 的 retry hook，走 0007 一类的补丁），经 IPC 以纯增量事件上报，GUI 在会话状态条 / 步序列里显示「服务商要求稍后重试，Ns 后重发（可停止）」。协议纯增量。
- **实施要点**：只做 emit，不改重试决策；IM 端不必显示。
- **待定**：靠解析 stdout 行还是加补丁 hook——前者零补丁但脆，后者多一个补丁。
- **关联**：`managed-ga/code/llmcore.py` `_stream_with_retry` · `runner/workbench_bridge.py` · [高级配置开放 max_retry_after](./2026-09-14-max-retry-after-advanced-option.md)。

---

## Windows 低 DPR 下 chrome 文字字重 / 字号变体

- **状态**：暂存（2026-09-16，JC 裁「先只做图标加粗与字体栈」）
- **提出**：2026-09-16，Windows 社区截图反馈「图标和文字发虚」。图标归因 Phosphor thin 0.5px 在 1x 屏半像素（已修：`@media (max-resolution: 1.5dppx)` 加 stroke，见 foundations §2.3）；字体栈显式加 Microsoft YaHei。文字部分：chrome 13px / 400 的雅黑在 Windows 灰度抗锯齿下笔画细边缘发灰，`-webkit-font-smoothing` 在 Windows 无效，现有「苹方 auto 补偿」机制在 Windows 不存在。
- **启动信号**：图标修复发版后社区仍反馈文字发虚；或 JC 在 Windows 真机 100% / 125% 下自己觉得侧栏标签比对照软件轻一档。
- **方案**：`html[data-platform="windows"]` 作用域内做变体实测：A 字重 400 → 500；B 13 → 14px；C 两者。连同 chrome 最小档（10–11.5px）在雅黑 1x 下的可读性一起看。临时变体切换器进 tauri dev（Windows 机）。
- **待定**：是否按 dppx 而非平台挂钩（与图标修法同构，但字重的成因是雅黑不是 DPR，平台更准）。
- **关联**：foundations §2.3（图标低 DPR 兜底）、§2.2 字重表；`globals.css` Windows 作用域块。

---

## session 行 hover 置顶按钮

- **状态**：暂存（2026-09-16 探讨，JC 裁「先把置顶提到 ⋯ 菜单第一项」）
- **提出**：2026-09-16，JC 贴外部 ConversationList 参考组件（行右侧 hover 出现图钉、已置顶常驻实心图钉、`[@media(hover:hover)]` 下才隐藏、`aria-pressed`）问是否引入。
- **不做的理由**：①ground truth：JC 本机 111 个 session 置顶 0 个，功能尚未挣到提升位；②置顶是每 session 一生一两次的动作，正是 ⋯ / 右键菜单为之设计的「对象级低频操作」；③行右侧 hover 位已被 ⋯ 占用，两个精密目标并排、标题 hover 让位 56px，行的 hover 态变吵；④已置顶行常驻图钉与 PINNED 桶头重复（「·1 是噪音」同款）。参考组件的模式成立是因为它的行只有 pin 一个动作。
- **已做的廉价提升**：置顶提到 ⋯ / 右键菜单首项（两入口共享同一组件，排序一致）。
- **启动信号**：JC 开始实际使用置顶（DB `pinned=1` 出现且持续）且仍觉得两次点击是摩擦；或社区反馈找不到置顶。
- **方案**：若启动，先加 ⌘K 命令「置顶 / 取消置顶当前会话」（零视觉成本）；再议行内按钮。行内按钮若做，借参考组件三处写法：`[@media(hover:hover)]` 下才隐藏、`aria-pressed`、已置顶态不随 hover 消失；位置需与 ⋯ 协调（并排或折进 ⋯ 左侧），标题让位量随之调整。
- **关联**：`layout-and-chrome.md` Sidebar 行动作条款（line ~146）与 Session Row 三通道清单；`SidebarSessionMenuItems.tsx`。

## 工具输出 / 审批面板的 `<pre>` 与正文代码块统一质感

- **状态**：暂缓
- **提出**：2026-09-18，[代码块参考件对表改版](./2026-09-18-code-block-reference-audit.md) 自查第 7 条
- **启动信号**：JC 真机觉得工具结果面板与正文代码块「两种质感」刺眼；或字号档调大后工具面板不跟随被投诉
- **方案**：`ToolCallout` / `approval-renderers` / `MessageAgent` 里的 `<pre>` 目前是 bg-app + `border-line` + 写死 12.5px / 1.6；正文代码块是 code-surface + hairline + `--conversation-code-size` / `leading-code`。要么把工具面板改挂同一组 token（保留其 200px 上限与 ink-soft 的「日志」寄存器），要么明确记录「日志 vs 代码」是有意的两种寄存器
- **待定**：当初是否有意区分——07-05 审计没记

---

## 模型高级配置的页签变体（「默认 | 仅此模型」在模型编辑器内切换）

- **状态**：暂存（2026-09-22 JC 裁先做「链接 + 设为所有模型的默认」）
- **提出**：2026-09-22，JC 提「每个模型的高级配置里一个开关：开=调全局、关=只调这一个模型」，讨论中判为表单模式开关而改形。
- **启动信号**：JC 或用户真机用下来觉得从模型编辑器跳到页尾「默认高级配置」太重；或「设为所有模型的默认」被投诉「改完才能设、不能先选范围」。
- **背景**：无状态版本已落地：模型面板折叠头「跟随默认 / N 项覆盖」+ 底部「全部跟随默认」「设为所有模型的默认」。页签版在同一折叠头放「默认 | 仅此模型」两个页签，各显示各自记录的值，字段所属一目了然、不会跳变；比开关安全（页签是可见的框不是隐藏状态）。
- **方案**：折叠头分段控件；「默认」页签渲染 `ModelDefaultsPanel` 的字段集（点击即存），「仅此模型」页签渲染现有 `ModelAdvancedOptionsPanel` 内容（随编辑器保存）。代价是一个折叠里两种保存语义，要在页签上写清。
- **待定**：一个折叠两种保存节奏是否可接受；否则要把默认页签也改成随编辑器保存并追踪两条记录的脏状态。
- **关联**：[模型高级配置分层](./2026-09-22-layered-model-advanced-config.md) · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

---

## 预设升级刷新模型的 preset 层

- **状态**：暂存（2026-09-22 分层落地时有意不做）
- **提出**：2026-09-22，[模型高级配置分层](./2026-09-22-layered-model-advanced-config.md) 给 `managed_models.preset_options` 留了缝。
- **启动信号**：下一次改动任何预设的 `advancedOptions`（比如再调 `DEFAULT_CONTEXT_WIN` 或给某中转加 `api_key_header`），或有用户把服务商 URL 改到不再匹配预设后投诉行为不对。
- **背景**：preset 层在创建时由 GUI 从预设写入，之后不动；预设更新只惠及新建的模型，老模型仍是冻结副本（027 / 029 两次 SQL 回填就是这个问题的历史形态）。分层后用户覆盖已单独存放，刷新 preset 层不会再碰用户的值，安全性比以前高得多。
- **方案**：GUI 加载模型列表时按 `managedModelProviderPresetForRecord` 匹配预设，与记录的 `presetOptions` 不同则通过 `save_managed_model` 只带 `presetOptions` 重写（Core「省略即保留」已支持只改这一层）；或 Core 起动时做，但预设知识在 GUI，需要先搬一份 JSON 给两边共读。
- **待定**：服务商 URL 改到自定义端点后 preset 层该保留旧预设还是退回协议默认；同时运行中会话不热更（默认配置同样如此，要新会话或重启才生效，推理强度例外，pill 实时可改）。
- **关联**：`gui/src/lib/managed-model-presets.ts` · `core/src/managed_model_layers.rs`
