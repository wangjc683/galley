# 步骤标题：旁白回声步用旁白当 marker 小字

Date: 2026-09-23
Status: implemented; A/B/C variant switcher live-tested on JC's desktop the
same day, C accepted (my recommendation was B); static gates green; unreleased
Related: [conversation design §旁白回声步](../design/conversation.md),
[思考实时预览（同日上一轮）](./2026-09-23-live-thinking-preview.md),
[步号淡一档与参考件对表](./2026-09-16-step-marker-recede-and-reference-audit.md),
[密度 pass](./2026-08-23-step-density-pass.md)

## 起因

思考实时预览落地后 JC 问：主对话区的思考、turn 等整个渲染与显示，还有
哪些能优化。先查 deferred 与使用数据再提，结果三条候选 + 一份不重提清单：

1. **旁白回声步的 marker 在复述工具 pill**（数据确凿，本篇）。
2. **中文思考伪斜体**（苹方无斜体字面，WebKit 几何倾斜；思考面板此前从无
   内容所以没人见过）。JC：思考不是正文，用斜体没问题——这是排版规范式
   论证对真机实感，属气质票，按他的判断不改；段落 / 列表行高不一致的真
   bug 一并挂起，进 [deferred](./deferred.md)。
3. **短推理预览一闪而过**（首轮落库 8 条推理均 175 字）：观察，进 deferred。

不重提：流式回答满宽→落定跳（09-18 裁 B；答案均 892 字，缩进流式让大块
答案落定左跳更糟）；deferred 里的自动滚到答案开头、轮间距倒挂、会话内
查找、过程区密度大刀（单行合并已真机否决）。

## 现状与数据

模型没写 `<summary>` 时，GA `turn_end_callback` 拿整段回复（去代码块与
`<thinking>`）当 summary。带旁白的工具步里它就是旁白本身；
`summaryEchoesAnswer` 识别出来后，marker 退回 `stepCalledTools`：

```
06 调用了 web_execute_js ›
   营业时间只出现在搜索摘要里，我去厦门网原文核对，地铁站也一起确认。
   web_execute_js  document.querySelector…
```

2026-09-01 起 143 个带旁白的中间步里 114 个（80%）是这种；全部是单行、
无 markdown，中位 38 字、最长 71 字。marker 只是复述正下方的 pill，真正
概括这一步的那句话反而不在标题位；展开折叠头回看时，序号列读成一串
「调用了 web_scan / 调用了 web_execute_js」，看不出 run 是怎么推进的。

查数据时另见：模型只回推理 + 工具调用时，上游 `_ensure_text_block` 拿推理
首行 60 字合成 `<summary>`，marker 显示截断的英文推理，与 caret 里推理第一句
重复（09-01 起 18 步）——观察，进 deferred。

## 三个变体与裁决

只作用于「旁白回声步」（`isEchoNarrationStep`），其余步在任何变体下不变：

- **A 现状**。
- **B 旁白兼任标题行**：序号挂在旁白首行，旁白保持正文寄存器，caret 贴旁白
  末字（为此做了 rehype 尾槽）。展开回看时序号列就是模型自己的叙述；代价是
  过程区的标题从浅灰小字变成深色正文，整体分量向最终回答靠拢（与 08-23
  「过程区层级低于最终回答」反向），且一个 run 里会出现两种标题字号。
- **C 旁白降为 marker 小字**：marker summary = 旁白（`cleanSessionSummary`，
  不截断、照常换行），旁白行不渲染。标题统一在 12px ink-soft；代价是流式期
  正文寄存器的旁白落定时缩成小字——`PROSE_NARRATION` 当初专门避免的那一下。

我推荐 B（保住旁白的正文寄存器、不引入落定缩字）。dev-only 切换器（发布
构建固定 A）进 `tauri dev`，JC 用 K11 那个旧会话 + 新跑的多步 run 对比后裁
**C**（「旁白小字的效果最佳」），推荐被推翻。他没展开理由；按已知代价读，
C 用一次落定缩字换来了标题寄存器统一、过程区保持轻，B 的正文标题则让过程
区更重。

## 落地

- `lib/step-heading.ts` `isEchoNarrationStep`：有 marker 行、非收尾形态、旁白
  非空、`summaryEchoesAnswer` 为真。
- `AgentTurnView`：此类步 marker summary = `cleanSessionSummary(旁白)`，兜底
  仍是 `stepCalledTools`（清理后为空时）；旁白行不渲染。caret / DetailPanel、
  流式路径、侧栏 subline 都不变。
- B 的 rehype 尾槽、MarkdownView `trailing`、切换器随裁决删除。
- Goal run 的工具步同样适用（`intermediateAnswer` 只改变收尾形态轮的渲染，
  按 `isFinalTurn` 判收尾，避免 goal run 与普通 run 两套规则）。
