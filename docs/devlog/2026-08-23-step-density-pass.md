# 多步 run 过程区密度 pass（两档间距 + 裸步合并）

日期：2026-08-23
背景：JC 贴多步 run 截图（13 步 live run），两问：过程区空间利用率是否偏低、
信息密度能否更高；该区域视觉层级是否应低于 final answer。探讨式请求，先
算账再裁决。

## 像素账（改前）

一步 = 两行内容 + 三段间距：TurnMarker `mt-6`（24px）+ marker 行（~18px）+
`mb-2.5`（10px）+ pill `my-1.5`×2 + `py-1` 行（~34px）≈ **86px，留白约占
55%**。13 步 ≈ 1100px+，超过一屏。无 summary 的步（GA 偶发不产出
summary，`summaryEchoesAnswer(undefined, …) === false` 使 f38074b1 的
echo 回退不接手）更是纯数字独占一行。

## 诊断：三因叠加，且「提密度」与「降层级」是同一刀

1. **章节级间距用在日志级内容上**。`mt-6` 的 24px 裁决（间距演化史第 5
   条，72→48→40→28→24 一路打下来）隐含「章节有正文」的前提；多步工具
   run 里一步只有两根细线，24px 一插留白反客为主。
2. **一个事件拆成两行**。marker 的 summary 与 pill 描述同一次动作；裸步
   的 marker 行只剩一个步号。
3. **宽栏里的两端对齐 pill**（左中文标签、右 mono 名顶到最右）拉出横向
   死区——独立问题，本轮不动，记 deferred。

层级判断的关键一步：颜色 register 已经压低（ink-soft/muted vs Newsreader
墨色正文），但**纵向体量本身是层级信号**——过程区体量压过 final answer
把滚动维度的主次滚反了。压缩即降级，两个目标不冲突。

反方论证也摆了：settled run 会折进 RunFoldHeader，蔓延只在 live 运行 +
最近一次 run 展开时可见——但 live 观看恰是每个多步 run 的必经曝光，值得
动；只是只值得动小刀。

## 裁决（JC，2026-08-23）

- **定性：动**，方向是提密度 = 降层级。
- **刀：A（最小刀）+ 裸步合并子案**；B（全面单行合并）、C（rail 重塑）、
  横向利用率案全部暂缓进 [deferred](./deferred.md)。
- 数值不开变体实测，直接落 12px，真机验收再调——收益大头在结构不在
  4px 手感票。

## 落地

- **两档上方间距**（`Conversation.tsx` TurnMarker）：run 边界（第 1 步）
  保持 `mt-6`；run 内第 2 步起 `mt-3`。判据 `index === 1`——GA 每次
  `put_task` 步号从 1 重数（`workbench_bridge.py` 重编号），步号即 run
  边界，**不必穿 run-group 数据**。同时保住 `RunFoldSection` 的
  `-mt-2.5` 边距折叠数学（其注释假设 section 以 mt-6 marker 开头，第 1
  步恰好总是 section 首节点）。marker `mb-2.5`→`mb-1`，inline pill
  `my-1.5`→`my-0.5`。thinking 占位与 markerOnly 收尾 marker 自动跟随。
- **裸步合并**（`mergedStepTool` → `ToolCallout` 新增 `stepIndex`
  prop）：无 summary、无 DetailPanel 内容、无 narration、恰好一个
  settled-success inline 工具的步，取消 marker 行，由 InlineToolPill 自
  渲染「第 N 步 │」前缀并接管两档上方间距。前缀放在 button **之外**：
  步号保持各 marker 的左列对齐（pill 有 `px-2` 而 marker 无水平
  padding，button 用 `-ml-2` 把 hover 面贴回 hairline），hover/点击目标
  仍是工具区，也就不存在双入口冲突。任一条件不满足维持两行。
- 收益：两行步 86px→~62px（−28%），裸步 86px→~38px（−56%）。en
  （`Step 1`）结构同款零文案改动；sidebar 的 `第 N 步 · {summary}` 不跟
  随（独立语境需要单位）。

## 有意不做 / 已否

- **B/C/横向案**：见 deferred「过程区密度：更大的刀」，各带启动信号。
- **裸步走 `stepCalledTools` 回退**（把 f38074b1 的 echo 回退扩到
  missing 分支）：合并行里真实的工具名 + arg preview 比通用回退文案信息
  量更高，回退反而降密度。
- 间距演化史第 6 条已落 `conversation.md`，含第二层教训：**间距裁决要连
  同内容前提一起记**——「turn 间 24px」在 turn 有正文时成立，turn 退化
  成日志行时同一个值就是另一个设计。

验证：`pnpm --dir gui typecheck` / `lint` / `git diff --check` 全绿；视觉
终验归 JC（真机 dogfood，多步 run + 折叠展开 + 裸步 + thinking 占位）。
