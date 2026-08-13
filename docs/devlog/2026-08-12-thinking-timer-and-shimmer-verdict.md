# thinking 计时器改造与 shimmer 裁决：定 Shimmer（§2.7 开 carve-out）

日期：2026-08-12
关联：`Conversation.tsx`（ThinkingStatus / TurnMarker / useElapsedDeciseconds）、
`MainView.tsx`（thinking 挂载槽位合并）、`globals.css`（`thinking-shimmer`）、
[foundations.md §2.7](../design/foundations.md)（豁免条款）、
[deferred](./deferred.md)（LiveDots 三站点统一）

## 背景

打磨模型回复前的等待态（TurnMarker thinking 模式）。改造前的形态：状态
文字（死）+ LiveDots 三点（闪）+ 计数器（3 秒后出现、1 秒精度、60 秒后
「已 X 分 X 秒 · 仍在运行」）。

## 计时器定案（先于视觉裁决，两变体共用）

1. **0 秒立即起跳、0.1 秒精度**（60 秒内「12.3 秒」，之后整秒「1 分 23 秒」；
   间隔 100ms 但始终以 `Date.now()` 差值为准）。旧 3 秒门槛的存在理由是
   「立即读数太机械」——十分位快速走字把读数变成秒表，机械感消失，门槛
   随之删除。分钟量级去掉十分位：那个尺度上的高频跳动会从「有进展」滑向
   「焦躁」。
2. **删「仍在运行」与「已」前缀**：跳动数字本身就是活性证明，安抚性文案冗余。
3. **步内意外归零修复**：占位与流式抬头原是两个兄弟条件槽位，首字落地时
   React 重建 marker、步时钟跳回 0。合并为单一槽位后时钟连续，语义成为
   完整的本步耗时。
4. **run 总时不进行内**：曾议在 marker 行加整 run 计时，否决。目的论裁决——
   这行字的职责是降低等待感而非展示信息；累积的大数字是盯锅效应，每步归零
   的小数字才是把长等待切短。且 run 级计时早已存在（`RunElapsedHud` 右下
   浮卡），正是 conversation.md「live 归外围」的落地，行内再加是第三处计时。

## 视觉裁决

三点 vs 状态文字扫光（shimmer），临时变体切换器（右上 pill、localStorage
记忆）进 tauri dev 真机实测。**注意此案实质是 §2.7 已裁决规则的重审**：
shimmer 名列被禁 B 类，且 thinking 行正是该规则旗舰案例（逐字波浪 → 三点
+ 计数器）。

JC 真机实测两者皆可、以 Galley 简洁调性倾向 shimmer；agent 独立判断同为
shimmer。定 Shimmer。

## 理由

1. **元素经济学**：新计时器已是行内最强活性信号，三点沦为第三个并列元素；
   shimmer 把动效折进本就存在的文字，信号源 3 → 2。§2.7 的字面（禁 shimmer）
   与精神（安静、少仪器感）在此案打架，精神胜。
2. **约定俗成的天平移了**：§2.7 的功能指示清单写自桌面惯例；「LLM 正在
   思考」语义上，扫光标签已是 LLM 应用的通行语言（Claude / ChatGPT 同款），
   零学习成本，过得了一句话测试（光带扫过 = 正在生成）。
3. **非简单翻案**：连续光带 ≠ 当年删掉的逐字 opacity 波浪（虫爬感）；且
   当年收敛的前提（计数器 3 秒后才上岗、需三点掩护空窗）已不存在。
4. 12px 信息文字的可读性保留意见经真机实测撤回（基色不低于 ink-muted，
   扫过瞬间仍可读）。

## 豁免边界（写入 §2.7）

仅限 in-flight 状态文字、一视图至多一处（现独占 thinking 行）；骨架屏 /
容器 / 装饰性 shimmer 照旧禁止。被禁的是「装修等待」，被豁免的是「指示
进行中」。

## 后续

- LiveDots 仍服役于 ToolCallout（运行中工具）、RunElapsedHud、GoalRunMarkers
  三处——语义是工具 / run / goal 级忙碌而非「LLM 思考」，暂不统一，启动
  信号与方案记 [deferred](./deferred.md)。
- reduced-motion 下 shimmer 退化为实色文字，计数器独立承担活性。

## 后记（同日）：RunElapsedHud 提前出列

deferred 的启动信号当日即触发——shimmer 上线后 JC 真机立刻感到浮卡与
thinking 行两种 working 语言同屏刺眼。事后看本可预见：两者都挂
`isRunning`，**必然**同屏同时出现，是三站点中冲突最直接的一个，当时
记 deferred 而非当场处理是判断保守。

裁决（均执行）：

1. **三点删除、不换 shimmer**：每秒走字的计数器即活性证明（同 thinking
   行删「仍在运行」的论证）；上 shimmer 会违反刚立的「一视图至多一处」
   边界（两处光带异相扫动即噪音）。「外围 liveness 加强」例外条款够不着
   它——那是为 sidebar 这种远离内容的监控板写的，浮卡悬在会话区右下角、
   与 shimmer 行同一视野。
2. **时长改会话方言**：原 `2m15s` 是当初顺手借 telemetry 的
   `formatElapsedCompact`（查证其唯一消费者就是浮卡，无共享约束，随改
   随删含测试）；改「45 秒」「1 分 23 秒」后与折叠头「用时 X 分 X 秒」
   交接同语。1 秒精度保持（run 级是分钟量级监控数，抖十分位读作焦躁）。
   会话方言无小时形态（折叠头亦分钟封顶），超长 run 显示「95 分 12 秒」
   ——与折叠头行为一致，若将来觉得别扭应两处同改。
3. **外形语域不动**：边框 / 底色 / 投影是 chrome 与 document 的正当分层
   （layout-and-chrome 外围监控面），不是不统一。

deferred 台账收窄至 ToolCallout / GoalRunMarkers 两站点。
