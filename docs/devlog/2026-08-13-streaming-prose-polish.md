# 流式正文打磨：光标归位 + 块级软淡入，词级 blur 否决

日期：2026-08-13
关联：`globals.css`（`streaming-prose`）、`MainView.tsx`（流式 partial 挂类）、
`LiveIndicators.tsx`（StreamingCursor 退役）、
[流式 markdown 补全](./2026-08-12-streaming-markdown-mend.md)（显示态/落定态分离纪律）

## 背景

对照一段外部 StreamingText 参考组件（词级 blur 入场 + 行内引用 chip +
完成后动作/追问阶梯入场）评估对话区回答正文的流式体验。Galley 现有
管线四层已调优：GA ~50 字符/推 → `useTypewriter`（180 字符/秒假打字机）
→ `useMarkdownStream`（解析节流 20Hz）→ `mendStreamingMarkdown`
（回溯 16→6）→ `StreamingCursor`。

## 参考四元素对表

引用 chip：无引用体系，N/A。Follow-ups：属 composer-next-suggestion
领域，不在正文。动作行完成后才出现：结构性已成立（partial 无
MessageActions，turn_end 换 canonical turn 才带）。核心只剩词级 blur。

## 词级 blur 入场：否决（含不原型的裁决）

规则上合法——每词一次性入场是 A 类相邻的内容进场，非 §2.7 禁的无限
循环逐字波浪，P9 允许一次性 keyframe。否决靠三条实质理由：

1. **撞 markdown 重解析稳定性**：词级动画要求身份稳定的词 span，
   react-markdown 按位置调和；mend 之后残余的 6 次回溯（强调类）每次
   都会重建 span，把小位移抖动放大成**已读文字重新模糊的重影闪烁**。
   根治需自定义 text renderer + 按偏移 key，工程量与风险远超收益。
2. **性能**：千词长答案 = 千个 `filter` 动画层，落在每 token 重渲染的
   热路径上；blur 是合成器上最贵的一类。
3. **语域**：blur-resolve 是 Gemini/ChatGPT 系的「AI 光泽感」，Galley
   衬线文档语域（structure reads as structure, prose reads as prose）
   有意避开这类质感。

**原型也否决**（JC 裁决）。曾议做一小时级粗糙原型进变体切换器、专为
气质票买真机信息。不做的论证：原型会撒谎且方向是美化——没有 markdown
结构干扰、没有长文压力、演示文本精挑，看到的是理想上限（演示效应）；
且即使气质票被翻，两条硬理由仍站着，大概率仍停在 deferred——这一小时
买到的信息改变不了行动。决策点归结为「对气质判断有无把握」，JC 有。

## 采纳的两件（全 CSS，`streaming-prose` 类，仅流式 partial）

1. **光标归位**：原 `StreamingCursor` 在正文块下方独占一行，眼睛跟着
   最后一个字、活性信号却在别处。改为 `::after` 伪元素钉在最后一个块
   的文字末尾（列表单独一条选择器钉尾 li），样式与呼吸动画完全复刻原
   组件；伪元素与 react-markdown 调和零交互。已知妥协：表格/代码块
   结尾光标停块边缘而非文字中。独立组件退役。
2. **块级入场软淡入**：新顶层块 / li 首次出现 opacity 0.4→1 一次性
   过渡（`--motion-base`）；0.4 起点承 waku 教训（150ms 尺度从 0 淡入
   读作闪烁）。追加式流保证已落定块位置稳定不重放；尾块流中重构
   （段落变列表）重淡一次，被自身内容变化掩盖。

两者只挂显示态；settled turn 无类，turn_end 落定瞬间零视觉变化——与
mend 同一分离纪律。reduced-motion 全静止、光标恒亮（同原组件退化）。

## 验收

真机验收通过（2026-08-13）。
