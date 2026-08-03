# TurnMarker 副标题与回答重复:GA summary 兜底的渲染层去重

**日期**:2026-08-03
**触发**:JC 在 `v0.4.2` draft 装机 dogfood 时发现,Anthropic 协议模型
在不调用工具的回答轮会把同一段话显示两遍——一遍在「第 N 步」副标题,
一遍在正文。

## 根因:GA 的 `<summary>` 兜底

`ga.py:594-601`:

```python
_c = re.sub(r'```.*?```|<thinking>.*?</thinking>', '', response.content, flags=re.DOTALL)
rsumm = re.search(r"<summary>(.*?)</summary>", _c, re.DOTALL)
if rsumm: summary = rsumm.group(1).strip()
else:
    summary = _c.strip() or smart_format("直接回答了用户问题" ...)
summary = smart_format(summary.replace('\n', ''), max_str_len=80)
```

GA 的系统提示要求每次回复都写 `<summary>`(极简单行物理快照)。模型漏写时,
兜底**拿整段清理后的正文当 summary**,去掉换行,超 90 字才做首尾省略
(`smart_format`:`head40 + ' ... ' + tail40`)。Galley 在
`Conversation.tsx` 把 `turn.summary` 原样渲染为 TurnMarker 副标题,
正下方就是同一段 `finalAnswer`。

## 不是协议问题,是模型合规度

初判怀疑是协议路径差异(JC 的观察是"OpenAI 协议没这个问题")。查代码后
排除:这条兜底在 `turn_end_callback` 里,与 protocol 无关;
`response.content` 由 text block 拼成(`llmcore.py:990-991`),
补丁 `0016` 只改流式显示通道,不进 `content`,与本链条无交集。

第二轮排查拿到了直接证据。GA 自己的 LLM 日志
(`managed-ga-state/temp/model_responses/`)记录了两个模型在**同一句
问候**下的原始返回:

```
=== Response === model=gpt-5.6-sol
[{'type': 'text', 'text': '<summary>收到问候;当前无需执行工具,准备协助你的任务。</summary>\n\n你好你好!有什么想让我帮你完成的吗?'}]

=== Response === model=glm-5.2
[{'type': 'text', 'text': '你好你好!👋 有什么我可以帮你的吗?\n\n无论是文件操作、浏览器任务、代码执行,还是其他需要动手处理的事情,尽管告诉我。'}]
```

glm-5.2 的返回里只有一个 text block,既没有 `<summary>`,也没有 thinking
block。系统提示两边都发了:`NativeToolClient.__init__` 把
`THINKING_PROMPT_ZH`(内含"每次回复都先在回复文字中包含一个 `<summary>`")
写进 `backend.system`,`ClaudeSession.raw_ask:870` 与 `LLMSession` 都会
把它发出去。**不是 Galley 丢了它,是模型没产出它。**

本机 DB 实证(2026-07-25 起,只取形状统计):

| 模型 | 样本 | 重复 |
|---|---|---|
| glm-5.2 | 12 | 4 |
| gpt-5.6-sol | 5 | 0 |

未重复的 glm 行 summary 是 13–85 字对上几百字正文,说明那些轮次模型
**写了** `<summary>`——它只在极轻量的问候轮上跳过仪式,不是系统性缺失。
所以真正的变量是模型逐轮的遵从度,协议相关性是表象,不能按"Anthropic
协议都这样"下结论。

## 不是 v0.4.2 回归

- 重复行最早出现在 **2026-07-30**(`v0.4.1` 时代,baseline `4086d5c`),
  早于今天的 `d8d90ee` 升级;
- `turn_end_callback` 在 `4086d5c..d8d90ee` 之间逐字未变;
- Galley 侧 TurnMarker / Conversation 渲染路径本轮未动。

JC 裁决仍然卡住 draft、修完重打 tag,而不是把它推到下一个 patch。

## 修复:渲染层去重,而非打 GA 补丁

**Rejected**:改 `ga.py` 兜底(例如 `no_tool` 轮退回通用文案)。
理由:`summary` 会进 `history_info`——agent 的长期工作记忆。在那个消费端,
"完整回答"比通用占位符**更有价值**,砍掉是净损失。问题只出在
Galley 把它摆到了正文正上方,即**相邻性**错了,数据本身没错。

所以修在呈现处。附带两个好处:对**已入库的历史行同样生效**(渲染期决策,
不需要数据迁移);Sidebar 的 subline 离正文很远,继续显示完整 summary
是有用的,不受影响。

新增 `summaryEchoesAnswer`(`lib/ipc/ga-output-cleaning.ts`),镜像 GA 的
归一化来比对:折叠全部空白(GA 是直接删换行,两侧 trim 规则也不同),
并同时用「原文」与「去掉 ``` 围栏的原文」两个候选比对——因为 GA 摘要前
剥了代码围栏而 `cleanFinalAnswer` 保留。命中 exact 或 `smart_format`
省略形(head 前缀 + tail 后缀同时对上,且原文更长)则抑制副标题。

这与既有的 `narrationDuplicatesPreamble`(`Conversation.tsx:170`)是同一
族的判断,只是换了一个字段。preamble 那一半**已被既有代码盖住**:数据里
带工具的重复行 `preamble` 与 `final_answer` 在空白归一后相等,原判断已
抑制。所以本轮只补 summary 一个出口。

### 谨慎点:不做前缀匹配

考虑过"summary 是 answer 的前缀即判定重复",否决了:合规的短 summary
完全可能与回答开头用词相同(「开始执行任务」vs「开始执行任务前需要先确认
三件事……」),会误伤真实摘要。而前缀规则也**盖不住**真正的缺口(正文中段
带代码围栏时,GA 的 summary 是"前段+后段"拼接,本就不是前缀),
所以是纯风险无收益。改用"去围栏候选"精确处理该形状。

## 第二轮:抑制之后是空白,补通用兜底文案(JC 裁决 B)

第一版只做抑制。JC 再次 dogfood 后指出**定位错了**:OpenAI 侧「第 1 步」
后面有真实信息,Anthropic 侧被抑制后只剩一个孤零零的步号加一条水平线,
读起来像加载失败——同一个产品,因为用户看不见的模型遵从度差异,呈现出
两种形态。空的结构元素比重复更像故障。

无法凭空造出模型没给的信息,所以只有两条自洽出路:

- **(A)** 内容为空时整个 marker 不渲染;
- **(B)** 填通用兜底文案。

agent 推荐 (A)(理由:GA 自己的提示词就写着"严禁输出无实际信息增量的
描述",填充违背该口径),**JC 裁决 (B)**:结构一致性优先——步号这一行在
两个模型下应当是同一个形状。

实现上借用 GA 自己的兜底措辞(`ga.py:599` 在正文为空时用的
「直接回答了用户问题」),新增 i18n key `conversation.stepDirectAnswer`,
只在**最终回答轮**(无真实工具调用)替换。真的调用了工具的轮次继续保持
纯步号:下方的 ToolCallout 已经说明发生了什么,而「直接回答了用户问题」
在那里是错的。

- **Rejected**:改 GA 系统提示强制模型必须写 `<summary>`。GA 已有补救
  (下一轮追加「必须在回复文本中包含<summary>!」),但单轮对话永远等不到
  下一轮;为琐碎问候轮与模型判断较劲,收益低、分叉成本真实。

## 验证

8 个单测(`ga-output-cleaning.test.ts`),用一个复刻 `ga.py` 兜底 +
`smart_format` 的辅助函数生成输入,而不是手写猜测的字符串。另用本机真实
DB 的 17 行 dogfood 数据跑了一次一次性校验(不入库):命中 5 行——4 行
exact,1 行 elided(sm 81 / fa 310,head 40 与 tail 40 同时对上,巧合概率
可忽略);其余 12 行真实摘要全部保留,零误伤。那条 elided 行是先前用
SQL 粗筛时漏掉的真阳性。

gui `typecheck` / `lint` / `vitest`(36 files,260 tests)全绿。第二轮的
文案替换是渲染分支,由 JC 在真机 dogfood 验收,验收通过后才重打 draft。

## 未做

未向上游报这条兜底(JC 裁决:先不报)。兜底本身仍值得商榷——拿整段正文
当"<30 字物理快照",既不符合自身提示词意图,也会稀释 working memory 的
信息密度。留待后续。
