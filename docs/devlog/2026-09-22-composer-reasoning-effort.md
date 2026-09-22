# Composer 会话级推理强度：从 deferred 拎出、落进 LLMPill 弹层

Date: 2026-09-22
Status: implemented; ten live rounds on JC's desktop the same day, final form
accepted; static gates green in all three layers; unreleased
Related: [issue #26 model config UX](./2026-09-08-issue-26-model-config-ux.md),
[reasoning effort default and badge](./2026-08-07-reasoning-effort-default-and-badge.md),
[IPC protocol §4.18 / §5.14](../ipc-protocol.md),
[GA baseline contract surface item 13](../ga-baseline.md#contract-surface),
ticket `.scratch/composer-reasoning-effort/`

## 起因

社区反馈第二条：「模型推理强度能不能放到聊天输入框，每次都要去设置改，太
麻烦了。」这不是新需求——08-07 JC 自己提过、被我三条理由否掉；09-08 issue
#26 第三次提到，JC 裁「不进 Composer」但把内核路径查明后进了 deferred，启动
信号写的是「再有用户提这条」。第二个用户来了，信号按定义触发。

## 08-07 三条否决理由的复盘

1. 「作用域错位，会静默影响其他在跑会话」——当时说的是改 provider 级配置。
   本方案挂在 session 上（DB 列 + 当前 llmclient 的 backend 属性），作用域
   天然正确，理由不再成立。
2. 「只对第一方端点有意义，控件时灵时不灵」——仍是事实，但 JC 裁一律显示
   （见下）。
3. 「Galley 会话是长跑 agent run，档位是开工前决策」——用户的实际用法反驳了
   这条：他就是在会话中途想换，被逼去改的是全局值，比 Composer 拨动更糟。

两条被推翻、一条被裁决化解，翻案成立。

## 裁决（JC，2026-09-22）

1. 从 deferred 拎出来做。
2. **不做独立 pill**。审批模式并进 LLMPill 的理由（「几乎永远等于默认值的
   设置不配和每刻都有信息量的模型名争层级」）对推理强度同样成立。弹层里
   模型列表与动作栏之间加一行四格档位；trigger 只在偏离模型配置时显示后缀。
3. 状态归 Core、重放归 Core（Rule 5）：GUI 只调 Tauri 命令，Core 写库后转发
   给存活的 runner，新 spawn 用 `--reasoning-effort` 带上。审批模式那套 GUI
   侧 `ready` 后重放的先例**没有**照抄——那条线 CLI 起的会话拿不到。
4. 第三方兼容端点**一律显示**。我最初提「有证据才显示」（第一方预设或用户
   已在设置里显式配过），JC 问清楚「你是指第三方端点没有这个选项？」——
   准确说法是 Galley 不知道它们认不认。JC 裁一律显示，理由是 low / medium /
   high 各家都支持；设置里已经对所有模型显示该字段并有提示，Composer 保持
   一致。
5. Thinking 开关不上。
6. 运行中允许拨动（内核下一次调用生效）；模型切换仍封锁。
7. 切模型后覆盖保留（Composer 只给四档，两种协议都认）。
8. EmptyState 不配「下一个会话」的强度。
9. Agent API 只加只读 `reasoningEffort`；v1 不加 CLI 写命令。

## 排查中钉死的事实

- 内核只在 `GenericAgent.__init__` / `next_llm` / `list_llms` 三处重建 LLM
  client（都经 `load_llm_sessions`，仅当模型配置文件 mtime 变了才真重建），
  `run()` 循环里不重建。所以 runner 在这三处之后重放覆盖即可，不需要 hook，
  也不碰内核补丁。deferred 里写的「保存模型配置后覆盖全丢」由此解决。
- 「模型配置值」不靠 GUI 去查 managed model store：runner 在套用覆盖**之前**
  从 backend 读一次并按对象记忆，随 `ready` / `llm_changed` /
  `reasoning_effort_changed` 上报 `configuredReasoningEffort`。外置 GA 因此
  零特判。

## 落地

- **Core**（票 02）：迁移 040 `sessions.reasoning_effort`；`SessionBrief.
  reasoningEffort`；Tauri 命令 `set_session_reasoning_effort` 写库 + 转发
  `set_reasoning_effort`；`SpawnArgs.reasoning_effort` 由 `spawn_runner` 查
  会话行、`ensure_session_runner` 直接带；`ipc.rs` 加命令 / 事件 / 两个增量
  字段。
- **runner**（票 01，Opus 实施）：`GaSession` 加 `active_backend_id` /
  `reasoning_effort` / `set_reasoning_effort` 三个访问器（子代理有意偏离票面
  「在 bridge 里 setattr」——该模块的 docstring 把自己定义为唯一触碰 GA 内部
  的地方，Rule 1 复审面在那里登记，对）；bridge 持覆盖值，memo 按 backend
  对象记配置值，四个重放点；Fable 复核补一刀：`id()` 会在对象回收后复用，
  `active_backend_id` 把见过的 backend 钉住。
- **GUI**（票 03，Opus 实施）：`lib/reasoning-effort.ts` 纯规则（四档、
  `MED` 缩写、偏离归一化、行状态）；runtime 槽三字段；lifecycle 动作只调
  Tauri 命令不发 IPC；LLMPill 档位行 + trigger 后缀；`effective` 在 GUI 侧
  由 `override ?? configured` 推导，点击即高亮，不等回执。
- **文档**：ipc-protocol §4.18 / §5.14 / spawn 参数 / ready 与 llm_changed
  字段；agent-api SessionBrief 行；ga-baseline 契约面第 13 项；DESIGN §4.4
  加 1b 档位行与 trigger 后缀。

## 被否 / 取代

- 独立强度 pill：与审批模式同一论证。
- 「有证据才显示」：见裁决 4。
- Thinking 开关：JC 裁不上。
- deferred 的「推理强度 effort 变体条目引导」（同模型配两条不同强度的条目、
  用现成切换器切）：被本方案取代，删。JC 09-08 已说过它把配置层的事推给用户。
- GUI 侧 `ready` 后重放（审批模式先例）：Rule 5 + CLI 会话覆盖不到，Core 转发。

## 待真机裁决

- 档位行字形：A = 大写等宽微字 chip（规格）vs B = 12.5px 普通文字段。
  临时切换器常驻右下角 pill「effort: A/B」，`localStorage`
  `galley.effortChipVariant`，代码全部带 `// TEMP effort-variant` 标记，裁完拆。
- PRD §5 的 GUI 验收：拨档 → 发消息 → 内置 `temp/model_responses` 最新日志
  payload 带该档；切模型后后缀仍在；重启恢复会话后仍在；改设置里该模型档位
  → 弹层「默认」格随之变化。

## 真机后的反转（同日）

JC 第一轮真机没看到档位行——原因是 `tauri dev` 没重启（Rust Core 是旧的，
`runner-event` 监听器闭包捕获的也是热更新前的 `dispatchIPCEvent`）。重启后看
到了，字形选 A（等宽大写微字），但两条否掉了 v1 的形态：

1. **位置**：行挂在整个模型列表下面，模型一多像是最后一个模型的附属。
2. **新对话里没有**：裁决 8 不给 EmptyState 配，加上行要等 `ready` 才出现，
   用户开工前定档的习惯被挡住。

JC 提议参考成熟产品，在模型选择器右侧做独立选择器。我同意，并把 07-20
「几乎永远等于默认值的设置不配和模型名争层级」的论证收回：它对二元、几乎
不动的审批开关成立，对会被拧、值本身有信息量的旋钮不成立。真机也证明了
弹层里的行「不知道为什么在这」。

定案：**EffortPill**，LLMPill 右侧；trigger = 当前生效档的 chip（模型配置留空
时「默认」，pill 永远在）；跟随 / 覆盖靠墨色不靠后缀；弹层竖列勾号行语法；
EmptyState 同一 pill 走 `pendingReasoningEffort`（create 后再 set，与审批模式
同一先例，不动 `CreateSessionInput` 的十五个构造点）；不等 `ready`，内置从模型
配置读「配置值」，外置 ready 前显示「默认」事后校正。裁决 2 与裁决 8 由真机
推翻，DESIGN §4.4 的 1b 段撤回，改记「推理强度 pill」一段。A/B 切换器已拆。

## 第二轮真机（同日）：字形与距离

截图两条：两个选择器离得太远；chip 字形（灰底等宽大写）和模型名并排显得杂乱。
原因：两 pill 各 10px 内边距 + 8px 行间距，可见空隙 28px，是模型名到自己箭头
距离的四倍；chip 字形是设置里徽标的字形，位置变了字形没跟着变。JC 按推荐
改：trigger 与弹层行都改成与模型 pill 同款普通文字，档位文案沿用设置里的
`Low` / `Medium` / `High` / `XHigh`；覆盖态不再画在 trigger 上，只留 tooltip；
强度 pill `-ml-4`，可见空隙收到约 12px。`lib/reasoning-effort.ts` 的
`effortChipLabel` 留给设置徽标语义，Composer 不再用它。

第三轮（同日）：JC 提出强度的视觉层级应比模型低一级。同意（模型 = 身份、
强度 = 参数，与 09-08 徽标原则同源）；做法只降墨色（`text-ink-muted`，hover
`text-ink-soft`）不缩字号，避免同一行两个字号读作没对齐。与上一轮否掉的
「墨色表状态」不矛盾：这次是常量层级，不随状态变。

第四轮（同日）：JC 贴 Codex 截图「GPT-6 Astra Medium ⌄」——舒服的三个量化
点：一个词距、模型深强度淡、**整个短语一个箭头**。我们 12px 间距 + 两个箭头
仍读作两个控件。定案 B1：模型 pill 加 `phraseLead`（去箭头、`pr-1`），强度
pill `pl-1`，两者之间无行间距，短语末尾一个箭头。JC 追问「模型去了箭头，
强度是不是也该去，更统一」——否：统一看整体不看两半是否对称，Codex 也是
短语末尾一个；零箭头时短语读作状态行；成熟产品都在模型选择器留 chevron；
Goal 上限 pill 按规则带箭头，全去反而两套语法。硬理由已足，未开真机变体。
这条改了 07-20 定稿的 LLMPill trigger 规格（有强度 pill 时不画箭头），
DESIGN §4.4 同步。

第五轮（同日）：间距再收——8px 是两个词距，Codex 是一个；改 `pr-0.5` /
`pl-0.5`，可见 4px。JC 问「High 为什么比模型名显得更大更重，是首字母大写吗」
——核过两 pill 类完全相同、强度更淡（#87827a vs #57534c），差异来自字形：
「grok-4.7」全小写加数字只占 x 高度，「High」大写 + 上下伸部占满行高；换带
大写的模型名观感反转。不为单个模型名调字形；若换名后仍觉得重，倾向再淡一档
而非改小写（与设置文案不一致、读作原始值）。

第六轮（同日）：JC 提「再淡一档 + 全小写」。我收回上一轮对小写的反对：设置
里本来就有 `HIGH` 徽标和 `High` 下拉两种拼法，Composer 是第三个表面；而小写
切断了「强度的视觉质量取决于模型名有无大写」这条依赖，比一致性值钱。按一次
只动一个变量：本轮只改小写（trigger 与弹层行），再淡一档等真机看过小写后再说
（有「像不可用」的风险，能不动不动）；字号降一号不建议（同行两字号读作没
对齐，小写的 x 高度已经是视觉上的降一号）。

第七轮（同日）：小写看过后 JC 要再淡一档看看——文字与箭头一起 `text-ink-muted`
→ `text-ink-muted/80`，hover 仍抬到 `ink-soft`。待真机判「像不像不可用」。

第八轮（同日）：pill 定稿后 JC 嫌两个弹层左侧空、体积大。量化：文字距边缘
36px = 弹层内边距 4 + 行内边距 10 + 勾号列 14 + 列间距 8，其中 22px 是只有一
行会用的保留位；两弹层还各有最小宽度硬撑（200 / 120）。裁 A：勾号挪到右侧
（web 模型选择器惯例，macOS 原生菜单才在左侧留列），文字距边缘 14px；模型
弹层 `min-w` 200 → 160，强度弹层去掉最小宽度。服务商名 hover 浮出时排在勾
之前。这条重审了 07-20「模型列表现规格不变」。

第九轮（同日）：模型弹层右侧仍空——截图 2x 量得弹层 160px 正是上一轮留的
`min-w-[160px]`，「deepseek-flash」只有约 90px。与强度弹层同样去掉最小宽度，
动作栏两行成为自然下限。

第十轮（同日）：JC 嫌两 pill 的 tooltip 吵。原文「切换 LLM · 当前 grok-4.7」
复述 pill 上的字，「推理强度 · 跟随模型配置 / 本会话覆盖」带着已裁定不值得
展示的区分。改成只剩动词：「切换 LLM」/「调整推理强度」，封锁态的「运行中
无法切换 LLM」保留（规范明写要保住的解释），跟随 / 覆盖只留 aria。没有全删：
模型 pill 去了箭头后 tooltip 是它最后的 affordance 信号。

## 收口时从票里搬过来的遗留点

- `createSessionPersisted`（Goal 从空态 Composer 启动、定时任务）不消费
  `pendingReasoningEffort`，与 `pendingApprovalMode` 的现状一致；pending 会
  留到下一次 `createSession`。等有人在这两条路径上真需要预选强度再改，届时
  两个 pending 一起收。
- 子代理有意偏离票面且被接受的三处：runner 的 backend 读写放 `GaSession`
  访问器而非 bridge；backend 缺失只在有待套用覆盖时报 business error；GUI
  的 `effective` 由 `override ?? configured` 推导、点击即高亮不等回执。
- Codex OAuth 的 `minimal → medium` 强制（设置徽标 `modelReasoningEffortTier`
  有）Composer 侧不复制：runner 上报是权威，猜了只会让 chip 闪一下。
- 真机验收项（拨档后 payload 带该档、切模型 / 重启后覆盖仍在、改设置档位
  后「默认」行随之变化）由 JC 在十轮真机中顺手覆盖，未单独留证。
