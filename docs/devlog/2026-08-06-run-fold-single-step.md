# 单步 run 也可折：折叠头是耗时的唯一栖身处

日期：2026-08-06。起因：JC dogfood 发现单步 run（直接回答）没有折叠
头——设计统一性破了，且折叠头独家承载的 run 耗时对这类 run 全产品
无处可看。

## 考古

「单步不折」是 run-fold PRD 的原始定案（「折叠头替换一行 TurnMarker，
没有空间收益，徒增噪音」，`stepCount >= 2` 才可折）；耗时丢失则是
dogfood 第 3 轮领土划分的**明知代价**（「Footer 的 ⏱ 全体删除，明知
代价：单步/不可折 run 失去 settled 耗时」）。都不是遗漏，是当时的
权衡——但其前提此后死了两次：

1. **领土划分本身**把折叠头从「折叠控件」升格为「run 的 settled 元数据
   行」（耗时独家判给它）。控件可按需出现，元数据行缺席即丢数据。
2. **折叠态移除 StrongHr**（同日 header-spacing 修订）翻转了空间账：
   折叠单步 run = 用「折叠头 + 回答」替「marker + 全宽横线 + 回答」，
   行数持平、墨量更轻、少一条最强分隔线。

## 定案

删除 `run-groups.ts` foldable 的 `agentTurns.length >= 2` 条件。折叠
机制其余**零改动即正确**：hidden 集合恰为空（opener 与收口 turn 都
保留）、收口 turn 走 answerOnly（跳 marker 跳横线）、keep-expanded /
下一条消息触发折叠 / rail 全部与多步 run 同构。折叠态渲染
「提问 → `1 步 · 用时 X 秒` → 回答」，展开露出「第 1 步 · summary」
与其 thinking DetailPanel。

- **「1 步」披露词照用**（JC 裁决）：统一性优先，且它诚实。
- 明知代价部分销账：耗时缺口只剩 goal run（已有归 terminal marker /
  task board 的后续项）与含 /btw 的 run。

## 被否

- **单步 run 专属「不可交互元数据头」**（有耗时无三角）：行首三角是
  折叠头全行的 affordance 语法，摘掉即新视觉物种；且与「第 1 步」
  marker 同屏双份元数据，恰是原定案「徒增噪音」批评的实体化。
- **单步 run 的 Footer 恢复 ⏱**：同一事实按 run 形态落两个位置，
  推翻「耗时从生到死不搬家」定案（同款「一产品两形状」已在 settings
  默认 tab 案否决过）。

## 联动

`run-groups.ts`（foldable 条件 + docstring）、`run-groups.test.ts`
（"does not fold single-step runs" 翻转为可折断言）、run-fold PRD
定案与代价段两处修订注记。
