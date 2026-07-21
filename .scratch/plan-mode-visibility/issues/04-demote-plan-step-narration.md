# 04: GUI — 正文「📌 当前步骤」行降级到结构层

Status: ready-for-human

## 背景（dogfood 2026-07-21 发现）

GA plan mode 下引擎每 5 轮强制模型"回复开头引用：📌 当前步骤：..."
（`ga.py:614`）。模型通常加粗输出，GUI 把它当 narration 按正文字号渲染
markdown → 每步出现一个红图钉大标题，比 12px TurnMarker 还响；模型补作业
时多个图钉合并成一段（截图第 17 步）。这是写给引擎的协议输出，不是给用户
的叙述；信息已由 plan 薄条（实时）与 TurnMarker summary（历史）承载。

## 决策（JC 拍板）

降级到结构层：从 narration 抽出图钉行，去 emoji、去加粗，以 12px
ink-soft 子行挂在 TurnMarker 下方。保留每步的 plan 状态记录（探索态/
规划态/执行态…），不丢历史信息。

## 方案

- `lib/ipc/ga-output-cleaning.ts`：新增 `extractPlanSteps(text)` →
  `{ steps: string[], rest: string }`。匹配 `📌 当前步骤：…` 段（容忍
  `**` 包裹、全/半角冒号、同段多个图钉），steps 去掉标签/emoji/加粗/
  尾部句号；rest 为剥除后的正文。
- `cleanPartialContent` / `extractPreamble` 直接剥除图钉段（流式不闪大字，
  DetailPanel 不重复）。
- `Conversation.tsx` `AgentTurnView`：对 answerText 抽取，`rest` 作
  narration（空则不渲染），steps 传给 `TurnMarker` 新 prop `planSteps`，
  在 marker 行下渲染细竖线 + 12px ink-soft 子行。
- 存储不动（finalAnswer 列仍含原文；渲染时抽取，live 与 restore 同路径）。

## 验证

cleaning 单测（单图钉/加粗/多图钉同段/无图钉）；typecheck / lint / vitest。
视觉验收 JC。

## Comments

- 2026-07-21 收紧：抽取仅限中间轮（`!isFinalTurn`）。最终回答是交付物，
  字面出现 `📌 当前步骤` 时属于内容（教程/引用/代码块），不得改写。
  流式剥除保留（瞬态，turn_end 落定后按最终回答完整显示）。
