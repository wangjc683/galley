# Next-suggestion 默认强制 + ghost 可达性：dogfood 首轮的定案反转

日期：2026-08-05。工作材料：`.scratch/composer-next-suggestion/PRD.md`
「定案变更（2026-08-05）」一节（本 entry 是其叙事版）。前情：
`2026-08-04-auto-title-and-next-suggestion.md`。

## 触发：dogfood 首轮就复现了立项场景失灵

JC 真机验证（glm-5.2）：模型最终回复以「想了解更细节的……我可以继续深入
讲 👇」收尾——这正是 PRD 立项时的原始痛点（助手口吻的散文提议）——但
`<next-suggestion>` 标签没出，ghost 静默缺席。谓词链排查过是干净的，
问题在 prompt 遵从率。

归因三点：① prompt 从未把「模型自己的结尾提议」和「该输出标签」连起来，
指令只说抽象的 "when there is one clear, concrete next step"；② 「有才写」
让跳过永远不算错，弱模型必然滑向省略；③ 指令位于 runtime prompt 中段，
recency 不利。

## 定案反转：「有才写」→「默认强制 + 枚举豁免」

JC 提出强制方向；agent 起初以「宁缺毋滥定案」反对，算账后改判认可——
这是一次正式推翻 2026-08-03 定案 2 中「没有合适建议时不输出标签」的裁决。
论证核心：

- **失败模式不对称**。条件触发的失败 = 该出的 ghost 缺席，功能价值归零且
  不可见（不截图都发现不了）；强制的失败 = 平庸建议被无视，而 ghost 是
  placeholder 级弱存在、不挡输入不抢焦点——原定案 5 的生命周期性质在此
  成为强制的安全网。一边输掉整个功能，一边多看一眼灰字。
- **「每次都输出」是格式习惯（填空题），「逐次判断」是裁量（判断题）**。
  模型维持格式习惯的可靠性远高于逐次裁量，glm 级模型尤甚。
- **可观测性**：强制后标签缺席 = 违规，不再与「本就无建议」混淆，prompt
  迭代的信号变干净。出现率稳定后用户才养得成按 → 的肌肉记忆。
- **Token 账**：≤80 字符 ≈ 几十 output token、仅最终回复、零额外调用，
  整轮占比 <1%——与当初被否的 A1（全上下文侧调用，成本翻倍）不同量级，
  A1 的否决理由对强制不适用。

「枚举豁免」：省略资格是封闭清单匹配，不是开放判断。唯一豁免 = 对话明确
终结（道别/纯致谢/纯确认，无待续事项）。「想不出好建议」明确不构成豁免
——指令要求此时选最可能的下一条用户消息写出来。质量风险改由 grounding
规则兜底（必须点名本次对话的具体事物、禁「帮我继续优化」式空话）。

落地全部在 `core/src/managed_prompt.rs` 一处：新措辞（默认义务 + 唯一豁免
+ 「结尾提议即下一步」转换规则 + grounding 地板）+ 整节挪至
`RUNTIME_PROMPT_STATIC` 末尾。`prompt_hash()` 翻新，新 prompt generation，
预期行为。GUI 对缺标签的静默容错不变（强制是 prompt 层合同，不是 GUI
层假设）。

## 同日：ghost UI 可达性三连（1/2/3 号打磨点）

- **鼠标接受通道**：「按 → 填入」hint 从纯展示 span 改为可点击 button，
  走与 ArrowRight 相同的 `applyComposerText` 路径。overlay 整体仍
  pointer-events-none，仅按钮 opt-in；`tabIndex=-1` 因父层 aria-hidden
  （可聚焦元素藏进 aria-hidden 是 a11y 违例），键盘/AT 用户走 ArrowRight。
- **AT 通道**：textarea 挂 `aria-describedby` → sr-only 描述（`useId` 防
  多实例撞 id；选 describedby 不选 aria-description，WebKit/WebView2 的
  AT 支持前者更稳）。新增 copy 键 `ghostSrDescription`（zh/en）。
- **截断建议看全文**：`title` 挂在 textarea 上——overlay 是
  pointer-events-none，hover 根本不落在它身上，挂它身上永远不弹。
- 2 号点（填入后焦点/光标置末尾）核查后确认既有 `applyComposerText` 已
  正确处理，零改动；鼠标点击后的 rAF 重聚焦顺带保证焦点落回 textarea。

## 明确不做（防回锅）

- **对回复正文做风格管制**（让模型别写散文版提议以消除与 ghost 的冗余）：
  JC 裁决不管——管制脆弱且可能伤答案质量，先看强制后的遵从率。
- **散文提议解析兜底**：维持 2026-08-03 原否决，口吻改写正是机器做不好
  的部分。
- **绝对无条件强制**（连道别都出建议）：备选记录在案，若默认强制 +
  枚举豁免的遵从率仍不达标，这是下一档。

待验收：JC 真机 dogfood——强制后的标签出现率、豁免误触发率（该出时
装终结）、grounding 质量。措辞迭代仍只动 `managed_prompt.rs` 一处。
