# 失败输出可读性：把「一整段砸下来」拆成 headline + 可折叠详情

**日期**：2026-08-11 / 2026-08-12（验收）
**关联**：[galley#22](https://github.com/wangjc683/galley/issues/22)（Kinda2419，
0.4.4 托管运行时 / Windows，附脱敏样本与截图）
**发布**：`v0.4.6`

## 问题

会话内任何失败都以一整段无差别文本砸进 transcript。报告人原话是
「我看不懂，我也不知道问题出在哪里，不知道如何继续」——注意这句里
**三个诉求是分开的**：读不懂（呈现）、定位不了（信息组织）、不知道
下一步（可操作性）。#22 报的是前两个。

三个叠加症状：

1. 错误带着传输信封（`{"status":"error","stdout":...}`）平铺，异常行
   在末尾，没有一行式 headline；
2. `\r\n`、`\\` 不解码，多行塌成一段；
3. turn 的工具调用以文本形式到达时，`<invoke>` 原始 markup 渲染成
   assistant 消息正文，并泄漏进 session list 的 summary。

**纯呈现层问题——数据里该有的都有。** 这个判断是整个方案的地基：
不需要改 IPC、不需要改 GA、不需要迁移历史行，全部在渲染时修。

## 关键决策

### 1. 识别 GA 错误信封走精确匹配，不做内容嗅探

`settledToolStatus` 新增 `failed-historical`，判据是 JSON 对象的
`status` 字段**恰好**等于 `"error"`。这与既有的 `denied` 判据
（`{"status":"denied"}`）同级，是一个**写明的 coupling point**，不是
「看起来像报错」的启发式。散文、文件内容、日志不可能解析成这个形状。

上游写方在 `managed-ga/code/ga.py`，解析方在
`gui/src/lib/tool-outcome.ts`，双侧注释互指。GA 换形状时这里会静默
退化成 `success-historical`（callout 变绿但内容还是错误文本），不会
炸——**可接受的退化方向**，但每次 baseline 升级应 grep 一次。

### 2. headline 提取刻意收窄

只认两种来源：Python traceback 的最后一行，或信封自己的 `msg` 首行。
**不对自由文本做任何猜测**。

理由：headline 是要放在折叠态唯一可见位置的东西，猜错比不猜更坏——
用户会照着一个错误的 headline 去排查。宁可退回「只有状态条说失败」，
也不要给一个似是而非的原因。所以 `ToolErrorDisplay.headline` 是
可选字段。

traceback 取**末行**而非首行，是因为 Python 的异常行在最后；同理
错误体超长时做**尾部截断**（保留末 4000 字符），头部的 banner 和栈
帧才是可丢的部分。

### 3. markup 主导判定用 starts-with，双端同形状

`^\s*</?(?:invoke|parameter)[\s>/]` —— 只认**开头**是工具调用 markup
的情况。GA 的兜底 recap 从回复第一个字符开始截，所以真正泄漏的那种
回复会把 markup 顶在最前面；而正常散文里偶尔提到 `<invoke>` 不会被
误伤。

runner（`_TOOL_MARKUP_START_RE`）与 GUI（`TOOL_MARKUP_START`）两侧
同一形状，注释互指。

### 4. runner 写固定常量，而不是清洗后的文本

markup 主导的 recap 被整段替换成
`TURN_PROTOCOL_FAILURE_SUMMARY = "回合协议错误：工具调用未能送达"`。

为什么不是「把标签剥掉留下正文」：剥完剩下的是
`code_run script import json print json.loads` 这种脚本残渣，**信息
量为零而且看起来像是内容**。用户会试图从中读出意思。

为什么是**固定常量**而不是随手一句话：GUI 侧靠**精确匹配**这个串来
做本地化——中文常量落库，en 语言下换成
`Turn protocol error: tool call not delivered`。清洗后文本没法精确
匹配，就只能把中文硬留在英文界面里。CLI 的 `sessions list` 消费者
看到的是verbatim 中文常量，这是有意的：Agent API 不做 i18n。

GUI 侧 `isProtocolFailureSummary` 同时认两种形状——原始 markup
（历史行 / attach 模式外部 GA 产出的行，永不迁移）和该常量（新行）。

### 5. `failed-historical` 折叠而非强制展开

live `failed` 是 `forcedOpen`，`failed-historical` 是 `defaultOpen:
false`。沿用 `-historical` 惯例：结算态融入文档，不抢注意力。
headline 已经把原因摆在折叠行上，完整 trace 一击可达。

DESIGN §4.5 的状态清单补了第七行（
[tools-and-approvals](../design/tools-and-approvals.md)）。

### 6. 泄漏 markup 的正文不走 MarkdownView

`ProtocolFailureNotice` 借 `failed-historical` callout 的形制（淡红
细条 + XCircle + 折叠），一行产品口径说明作为领行，原始 markup 收在
等宽块里备查。**没有 Copy / Save**——这一轮没有可交付物，给保存按钮
是骗人。

配套两处：流式 `cleanPartialContent` 对 markup 开头的缓冲返回空（防
闪现）；runner 的 `RunComplete.finalContent` 命中时置空，防止自动
标题拿脚本正文去拟标题。**注意 `finalContent` 只在 markup 泄漏时置
空**——正常的错误内容（比如模型选择复述 traceback）原样放行。

## 真机验收（2026-08-12，JC）

四条路径全过：老会话 summary 占位（侧栏 / 命令面板 / 更早 / 归档四个
消费点）、`code_run` 抛异常的 `failed-historical` callout、泄漏 markup
正文的 `ProtocolFailureNotice`、en 语言下三处文案。

前两类场景没法靠真实模型稳定复现（要的是历史脏行和第三方代理的
透传行为），用 SQLite 夹具会话造；`code_run` 报错那条坚持真跑，因为
它验的是**决策 1 那个 coupling point 本身**，用夹具造等于自证。

验收里 JC 提出的疑问，结论都是「实现没问题」：

- **callout 展开着，不是折叠态** —— 是验收标准写错了。`useState(cfg.
  defaultOpen)` 只在挂载时取值，live 路径下 callout 以 `running`
  （`defaultOpen: true`）挂载，结算成 `failed-historical` 时 state 不
  重算；`Conversation.tsx` 的 keep-expanded 指针还**有意**让刚看着跑
  完的那轮保持展开。折叠只在恢复路径可见。`success-historical` 一直
  是这个行为。
- **最终回答是一大段 traceback** —— 那是模型自己的答复内容。验收
  prompt 说了「我要看它原样抛异常」，模型照做了。反向印证了决策 6
  末尾那条：`finalContent` 只对 markup 泄漏置空。

## 顺带扫出、未在本版处理

两条 callout 打磨，另开 `.scratch/tool-callout-polish/`：

1. `ResultBlock` 是 200px 顶部锚定的滚动窗，macOS overlay 滚动条不
   显形，末行被切在半个字高上，没有「下面还有」的暗示。信息没丢
   （headline 已在上方），纯观感。
2. args 块的 `stringifyValue` 对字符串一律 `JSON.stringify`，多行
   `script` 塌成一行带 `\n` / `\"`。这正是 #22 第 2 条抱怨的那类东
   西，只是我们这次只解码了错误体没动 args——同一个 callout 里两种
   处理方式并排，自相矛盾。修它等于改所有工具的 args 呈现，超出
   #22 范围。
