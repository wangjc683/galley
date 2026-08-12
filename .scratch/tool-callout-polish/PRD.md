# PRD: Tool Callout 展开体的两处打磨

Status: needs-triage
Date: 2026-08-12
来源: galley#22 真机验收（2026-08-12）顺带扫出，非报告人诉求
关联: [失败输出可读性 devlog](../../docs/devlog/2026-08-12-error-display-readability.md)

## 背景

`v0.4.6` 的错误呈现验收通过后，JC 与 agent 在同一屏上各自注意到两处
与本次修复方向不一致的既有行为。都不属于 #22 的三点范围，都不影响
信息完整性，故未随 `v0.4.6` 发运。

## 01 ResultBlock 是顶部锚定的 200px 滚动窗

`ToolCallout.ResultBlock` 是 `max-h-[200px] overflow-y-auto`。macOS 的
overlay 滚动条不悬停不显形，内容超过 200px 时末行被切在半个字高上，
**没有任何「下面还有」的暗示**，视觉上读作「内容被截断了」。

信息没丢：错误体完整（尾部保留 4000 字符），且异常行已经作为 headline
出现在上方。所以这是纯观感问题。

候选修法（未定）：

- 底部渐隐遮罩（fade-out），成本最低，不改布局；
- 错误体单独放宽高度上限（错误的阅读需求 ≠ 普通 stdout 预览）；
- 保持 200px 但初始滚到底（错误体是尾部有效的载荷）——注意这会与
  「headline 已在上方给了结论、正文该从头读」的现有信息层级冲突，
  需要先想清楚展开体到底服务于「快速确认」还是「完整审计」。

## 02 args 块的多行字符串塌成一行转义形态

`stringifyValue` 对字符串一律 `JSON.stringify`，所以 `code_run` 的
`script` 参数显示成 `"import json\njson.loads(\"\")"`——`\n` 和 `\"`
原样露出。

这**正是 #22 第 2 条抱怨的那类东西**（转义不解码、多行塌成一段），
只是我们这次只解码了错误体没动 args。同一个 callout 里两种处理方式
并排，自相矛盾。

范围代价：`stringifyValue` 服务所有工具的 args 呈现，改它等于改
`file_patch` / `file_write` / `shell_run` 等所有工具的参数显示。要先
确认多行字符串换成真实换行后，args 块（同样 200px 窗）不会被一个长
脚本挤爆——很可能需要和 01 一起设计。

## 出口标准

- 展开体不再有「内容被切断」的观感；
- args 里的多行脚本可读，且不把 args 块撑成滚动噩梦；
- 所有既有工具的 args 呈现回归确认（不只 `code_run`）。

## Issues

- 01 ResultBlock 溢出提示 / 高度策略
- 02 args 多行字符串呈现（波及所有工具）
