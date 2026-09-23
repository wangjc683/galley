# 思考显示：从「冒充正文再凭空消失」到三行实时预览 + 落定进 caret

Date: 2026-09-23
Status: implemented; variant switcher live-tested on JC's desktop the same day,
recommended form accepted; static gates green in all three layers; unreleased
Related: [conversation design §Live Thinking Preview](../design/conversation.md#live-thinking-preview实时思考预览),
[IPC protocol §4.7 / §4.7a](../ipc-protocol.md),
[GA baseline contract surface item 14](../ga-baseline.md#contract-surface),
[managed patch manifest `0016`](../../managed-ga/patches/manifest.md),
[2026-08-03 upstream upgrade（0016 的由来）](./2026-08-03-ga-upstream-upgrade-4086d5c-to-d8d90ee.md)

## 起因

JC 常看到：某一步里模型大段思考，思考文字按最终回答的样式流出、占满视野；
思考完一收，大段文字消失，只剩一行 summary。问题是这是否需要优化、思考该
怎么显示、结束后去哪——「不能让用户觉得看着看着，一段话突然没了」。

## 现状核查：一半是 bug，一半是缺设计

读代码 + 查 workbench.db 后，三段现象各有具体根因：

1. **流式期冒充正文**。OpenAI 兼容通道（`llmcore._parse_openai_sse`
   chat_completions 分支）把 `reasoning_content` 不带标签地直接 yield 进
   显示流；08-03 的补丁 `0016` 只修了 Anthropic 通道。前端只靠 `<thinking>`
   标签区分推理与回答，于是推理进了 `MainView` 的回答 partial：满宽、回答
   字号、打字光标、无高度上限；状态行因为「有可见文本」还写着「正在回答…」。
   JC 常用的 GLM / Grok 正走这条通道。
2. **落定时凭空消失**。bridge 的 `turn_end` 只发 `response.content`；原生
   会话（`NativeClaudeSession` / `NativeOAISession`，内置运行时只建这两种）
   的推理在 `response.thinking` 里，没人读。`turn_end` 一到 inFlight 清空，
   推理一帧内没了，哪里都找不回。**1351 条 assistant 行 thinking 列 0 条**
   ——DetailPanel 的「思考」半边在内置运行时上从没有过内容。
3. **按协议三种行为**：OpenAI 兼容冒充正文、Anthropic 被 `0016` 隐藏到块末
   一次性吐出（只见「思考中」shimmer）、Responses 模式累积不吐；落定后三者
   都找不回。

JC 说的「缩回 Summary」还混着另一件事：run 完成后整个过程折进 RunFoldHeader，
那是 09-16 的既定设计、点开可回看，不在本次范围。

**更正 08-03 devlog**：那篇写「`extractThinking` now populates the thinking
pane with native reasoning」。在原生会话路径上不成立——`response.content`
由 text 块拼成，本就不含推理；只有非原生的 `ToolClient` 路径（内容取自整条
流）才会让带标签推理进 `content`。数据库 0 条是直接证据。

## 裁决（四条全按推荐）

原则：结构（12px 状态行 / 序号）、过程（斜体衬线 ink-soft，即 DetailPanel
既有的 thinking 寄存器）、交付（直立衬线正文）三个寄存器分清，推理永远是
过程；实时看过的东西落定后要在同一位置、同一样式找回；流式期不能越撑越长。

1. **先修 bug 层**（不依赖设计裁决）：推理不再冒充正文、不再凭空消失。
2. **流式期给看原文，三行滚动预览**。备选「一行（最新一句进状态行）」与
   「全文」。
3. **推理一结束即收合**，不等 `turn_end`：最后一步的回答可能流几十秒，等
   落定才收会让读到一半的正文整体上移；在回答刚开头时收，动的是还没读的
   部分。
4. **流式期预览不可展开**（V1），全文在落定步的 caret 后。

行数（1 行 / 3 行 / 全文）× 收合时机（思考结束 / 落定）做成临时切换器进
`tauri dev`，JC 真机实测后定 **3 行 + 思考结束**，与推荐一致；切换器随即拆除。

## 实现路线：带内流式标签，不开旁路

活预览需要推理边到边送到前端。两条路：

- **旁路**：补丁里加模块级 hook，bridge 在内置模式注册，推理 delta 走新 IPC
  事件 `thinking_progress`。显示流语义不变，所以对其他消费者零风险；代价是
  三端 IPC + Core enum + store 新字段，且模型按提示词写的 `<thinking>`
  仍在带内——前端要合并两个来源。
- **带内（采用）**：`0016` 从「块末一次性吐出」改为「边到边带标签吐出」。
  前端只看一个来源，原生与提示词推理天然统一——这正是 08-03 选标签约定的
  理由。担心的风险是其他显示流消费者（IM 入口）会看到未闭合的 `<thinking>`；
  但提示词推理早就这样流，这不是新输入形态，且逐个核查后无回归（见下）。

## 落地

- **补丁 `0016` 重写**（同名、范围扩大）：`_GalleyThinkTag` 管开合与 carry
  buffer，用在 `_parse_claude_sse` 与 `_parse_openai_sse` chat_completions
  分支。首个非空白推理字符处开标签（纯空白块什么都不吐）；Anthropic 在每个
  `content_block_stop` / SSE error 前 / 循环结束后闭合，chat_completions 在
  首个回答 delta 前 / 首个 `tool_calls` delta / 循环结束后闭合；字面
  `</thinking>` 跨 delta 也转成 `</ thinking>`。返回的 content blocks 一字
  不变（历史不动）。Responses 分支与两个非流式 JSON 解析器不动。`0017` /
  `0021` 只漂行号（旧 `0017` 的零上下文插入会静默落进新 helper 的注释里，
  所以重导出）。
- **核查一：原生路径上流文本只供显示**——`response.content` / `.thinking` /
  工具调用都取自返回的 blocks；唯一读流的是 `MixinSession` 的故障转移判断，
  闭合标签总在任何错误 / 警告 chunk 之前，判断不变。
- **核查二：IM 入口**——Telegram / Discord / 微信跑 `verbose=False`，只收每轮
  `response.content`；飞书 `verbose=True` 但只渲染最终 `done`、`_clean` 剥
  完整块。无一新漏推理；飞书反而修好了 chat_completions 原始推理漏进最终卡片。
  残留边角：飞书在推理中途网络重试耗尽时，`done` 会是未闭合标签 + 错误文本。
- **bridge**：`TurnEndEvent.responseThinking`（可选、增量；Python / Rust /
  TS 三端 + IPC 文档），读 `response.thinking` 是对已注册 turn-end hook 所给
  对象的只读访问，外置模式同样合规，两种模式都发。GUI `turnFromTurnEnd` 优先
  取它、为空回退 `extractThinking`；落库与 restore 路径原本就通，不用改。
- **`/btw`**：旁问回复由上游 `btw_cmd` 拼整条 `raw_ask` 流，带内推理会进气泡
  （旧 `0016` 下 Anthropic 通道其实早就如此）。bridge 在两个旁问发出点剥掉
  完整块；截止时间截断的未闭合块剥到超时提示 / 用时脚注为止。
- **GUI**：`extractLiveThinking` → `{ text, open }`（扫到工具派发标记即停，
  防止读到源码里的 `<thinking>` 重开预览）；`ThinkingPreview` 三行窗口；
  状态行「思考中」优先级最高。细节见设计文档。

## 取舍与已知限制

- **外置 GA**：上游仍不带标签地流原生推理，流式期照旧冒充正文；落定后进
  caret。实时预览外置做不了，按「内置优先」不进 deferred。
- **Responses 模式**：推理累积不流出，只有落定后进 caret。本机常用模型不走
  这条，未扩补丁范围。
- **未闭合标签**：Stop / 网络异常时 parser 中途被丢，标签可能不闭合——GUI
  把未闭合尾部当推理，落定内容来自 `turn_end` 不受影响。
- **行高**：预览行盒按「思考字号 × 正文行高」算，因为 `MarkdownView` 的
  thinking 变体里段落继承 `PROSE_BASE` 的 body leading，
  `--conversation-thinking-leading` 只落在根元素（列表项又用它）。这是既有
  不一致，DetailPanel 同样如此，本次未改。
- **裸步合并**：`mergedStepTool` 排除带推理的步，推理模型的无 summary 步会
  保留 marker 行（带 caret）而不再并进 pill。规则未动。
- 旧会话没有推理可看（此前从未落库）。
