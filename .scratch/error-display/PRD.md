# PRD: 失败输出可读性（Error Display）

Status: ready-for-human
Date: 2026-08-11
关联: [galley#22](https://github.com/wangjc683/galley/issues/22)（Kinda2419，
0.4.4 managed runtime / Windows，附脱敏样本与截图）

## 背景与动机

会话内任何失败都以一整段无差别文本砸进 transcript。#22 报告了三个叠加
问题（报告人原话：「我看不懂，我也不知道问题出在哪里，不知道如何继续」）：

1. 错误带着传输信封（`{"status":"error","stdout":...}`）平铺，异常行在
   末尾，没有一行式 headline；
2. `\r\n`、`\\` 不解码，多行塌成一段；
3. turn 的工具调用以文本形式到达时，`<invoke>` 原始 markup 渲染成
   assistant 消息正文，并泄漏进 session list 的 summary。

纯呈现层问题——数据里该有的都有。2026-08-11 代码验证结论（全部确认）：

- **腿 A（markup 泄漏）**：双端清洗器（`runner/workbench_bridge.py:153`
  `_clean_turn_summary`、`gui/src/lib/session-summary.ts:24`
  `cleanSessionSummary`）的标签正则 `<\/?[a-zA-Z][\w-]*>` 标签名后直接要求
  `>`，带属性的 `<invoke name="code_run">` 整体不匹配、原样穿透（拿 #22
  真实样本跑正则验证过）。正文侧 `cleanFinalAnswer` / `cleanPartialContent`
  / `_clean_response_for_display` 全部基于五标签白名单
  （thinking/summary/tool_use/file_content/next-suggestion），invoke 不在
  名单。**源头**：GA 工具调用走 API 原生 structured tool_use
  （`managed-ga/code/llmcore.py` 按 provider 协议解析 function_call 事件），
  无文本解析环节；`<invoke>` 文本是模型经第三方代理把工具调用当纯文本吐出
  （#22 环境为 codex 协议 proxy）。源头修不了，只能呈现层防御；attach 模式
  同样中招。
- **腿 B（转义）**：`ToolCallout.tsx:417` 的 ResultBlock 已是 monospace
  `<pre>` + pre-wrap；问题是 code_run 返回内容本身是 JSON 序列化字符串，
  `\r\n` / `\\` 是带内转义。修法是对已知信封 `JSON.parse`（parse 即解码），
  不是改字体。
- **腿 C（headline）**：`gui/src/lib/agent-turn.ts:80` `previewFromContent`
  头部 500 字符截断——Python traceback 异常行在末尾，现在的预览恰好保住
  信封+banner+栈帧开头，把唯一有用的异常行截掉。另
  `gui/src/lib/tool-outcome.ts` 有既有决策「不从内容猜测失败」，只对
  Galley 自有 `{"status":"denied"}` 信封做结构化识别。

## 定案决策（2026-08-11，JC）

1. **分层遵循既有惯例「wire 保持忠实，render 负责修复」**：腿 B/C（信封
   解析 + headline + 折叠详情）纯 GUI render 层——历史行自动受益、wire 上
   原始 JSON 对 CLI agent 消费者反而是好格式、不动 IPC 契约。腿 A 按
   summary 双端惯例（runner 管新行落库，GUI 管历史行 + attach 模式，
   keep-in-sync 注释互相标注）。不做 runner 侧错误结构化。
2. **markup 占主导的回合，summary 用产品语态占位文案**（类似「回合协议
   错误：工具调用未能送达」）。清洗残文无信息量；保留上一轮 summary 会
   撒谎（该轮实际失败了）。
3. **`{"status":"error"}` 信封识别接受为新 coupling point**，与 denied 同级
   写进 `tool-outcome.ts` 的注释契约。精确匹配（JSON parse + 字段精确检查）
   不是模糊猜测，不违背原「不猜测失败」决策的精神。
4. **headline 提取范围先只做两个高频形状**：Python traceback 末行、
   `{"status":"error"}` 信封。HTTP 状态码等 best-effort 形状等真实样本
   积累了再加。
5. **裸标签过度清洗的老行为保持不变**（`<div>` 等合法 HTML 也被剥）——
   summary 是单行 UI 字符串，过度清洗可接受，与现状一致。
6. **markup 正文呈现**：GUI 检测「正文以 `<invoke` 为主体」→ 不走
   MarkdownView 散文渲染，改为折叠代码块 + 一行解释性说明（parse-failure
   callout）。仅 GUI 可做。

## 出口标准

- #22 附件两条真实样本在 GUI 中：折叠态先见一行异常 headline，展开见
  等宽、真实换行的完整 trace；
- `<invoke>` markup 不再以散文形式出现在消息正文，也不再出现在
  sidebar / session list 的 summary（新行与历史行都覆盖）；
- 全部工具结果为 prose / 文件内容 / 日志的正常会话渲染无回归
  （不误标失败）。

## Issues

- 01 summary 双端清洗：属性容忍正则 + markup 占位（runner + GUI）
- 02 工具错误信封解析 + headline + 折叠详情（GUI）
- 03 markup 正文的 parse-failure 呈现（GUI）

## Comments

2026-08-11 实现完成（agent），待 JC 真机验收后 commit。验证：runner
pytest 68 passed + mypy + ruff；gui typecheck + lint + vitest 315 passed；
git diff --check。实现要点与验收清单：

- 01：双端正则容忍属性标签；「以 `<invoke`/`<parameter` 开头」判定为
  markup 占主导 → runner 落库写固定占位 `回合协议错误：工具调用未能送达`
  （`TURN_PROTOCOL_FAILURE_SUMMARY`），GUI 端 `isProtocolFailureSummary`
  同时识别原始 markup（历史行/attach）与该常量（新行，精确匹配以便
  en 本地化），四个消费点（SidebarSessionRow / CommandPalette /
  EarlierDialog / ArchivedDialog）改走 `displaySessionSummary`。
  新增 i18n 键 `sidebar.turnProtocolFailure`。
- 02：`settledToolStatus` 扩展返回 `failed-historical`（GA
  `{"status":"error"}` 信封，coupling point 注释已写入）；新增
  `toolErrorDisplay`（headline = traceback 末行或 msg 首行，detail =
  解码后 stdout/msg，尾部 4000 字符截断）。新 ToolEventStatus
  `failed-historical`：淡红条 + X + 自动折叠（`-historical` 惯例，
  不像 live failed 强制展开），headline 走 callout summary 槽位，
  展开体渲染 errorDetail 取代原始 JSON 预览。**注意 DESIGN.md §4.5
  的六状态清单未同步**，验收通过后要补一行第七状态。
- 03：`isLeakedToolCallMarkup`（starts-with 规则，与 01 同形状）；
  MessageAgent 命中时渲染 ProtocolFailureNotice（一行说明 + 折叠
  原始 markup，无 Copy/Save），流式 `cleanPartialContent` 对 markup
  开头的缓冲返回空防闪现；runner RunComplete 的 `finalContent` 命中
  时置空，防止 auto-title 拿脚本正文拟标题。新增 i18n 键
  `conversation.turnProtocolFailureLead` / `turnProtocolFailureRaw`。

真机验收路径：老会话（历史行）sidebar/搜索/归档列表的 summary 占位；
一个 code_run 抛异常的会话看 failed-historical callout 折叠态 headline
与展开态等宽 trace；en 语言下三处文案。
