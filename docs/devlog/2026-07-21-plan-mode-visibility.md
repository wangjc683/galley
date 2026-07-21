# Plan Mode 可视化：GUI 只观察，不做入口

日期：2026-07-21
相关：`runner/plan_watch.py` · `docs/ipc-protocol.md` §4.17 ·
`gui/src/components/conversation/PlanContextBar.tsx` ·
commits `449f10f` / `ae85b9d`

## 背景

GA 内核自带 plan mode：`plan_sop.md`（探索 → 写 plan.md 并 `ask_user`
确认 → 逐条执行 checklist → 强制对抗性验证）+ `ga.py` 的
`enter_plan_mode(plan_path)` 运行时状态。唯一入口是模型自己按 SOP 判断
复杂度后通过 `code_run` inline_eval 调用；没有外部 flag、CLI 参数或 IPC
命令。上游在 1e89c3e → 5257dec 升级中主动弱化了自动触发。

起点问题是"要不要给 Galley 加一个 Plan Mode 的 GUI 入口，自动开还是手动
开"。讨论结论：**这是个假二选一**——"自动"已存在于内核（模型就是意图判断
器），GUI 缺的是可见性，不是入口。

## 决策

**GUI 只做可视化，不做任何开启入口。** Composer 不动，触发完全交给模型，
GUI 把 plan mode 发生时的状态呈现出来：

- 会话滚动区上方的薄进度条（PlanContextBar，与 GoalWorkerContextBar 同
  槽位）：「计划 n/N · 当前步骤」，点开展开完整 checklist，plan 退出自动
  消失。plan.md 未落盘时显示 placeholder（"制定计划中 · pathHint"）。
- 数据链路：bridge 在每个 turn_end 用 `runner/plan_watch.py` 只读探测
  （复用 GA 自己的 `frontends/plan_state.py` 公开 API + 读
  `working['in_plan_mode']`，均为已记录只读耦合点），变化时发
  `plan_update` 事件；core 无脑转发；GUI 纯订阅。连续相同快照去重，退出
  发一次 `active: false` 收尾。
- Attach 降级：外部 GA 检出没有 `plan_state.py` → ImportError → 功能
  静默关闭，不写任何外部 GA 状态。
- 不落库、不做 CLI 暴露（将来要做是 v1 加法式扩展）。

## 被否的方案

1. **Composer 按消息修饰（「先规划」arm/disarm，类似 Goal 按钮）**——
   曾是 agent 推荐项（生命周期对齐、提示注入实现干净）。否决：composer
   增加常驻控件，与"状态只在发生时可见"原则冲突；应先有可见性和真实触发
   频率数据，再回头谈入口。
2. **会话级「规划模式」常驻开关**——sticky 开关与 plan mode "checklist
   清零自动退出"的生命周期不一致，任务结束开关仍亮，成为需要解释的控件。
3. **恢复/加强 SOP 自动触发**——需对上游行为引导内容打补丁，违背
   managed-runtime 补丁最小化原则，且上游自己刚调弱过（说明硬编码触发被
   上游认定过激），方向上与上游判断相悖。
4. **计划确认 ask_user 气泡特殊化**——识别"这个 ask_user 是计划确认"
   只能靠启发式，脆；进度条在场时上下文已足够。留待真实使用反馈。

## Dogfood 发现：📌 当前步骤 大字问题（issue 04）

首轮 dogfood 立即暴露：plan mode 下引擎每 5 轮强制模型"回复开头引用：
📌 当前步骤：..."（`ga.py:614`），模型加粗输出，GUI 按正文字号渲染
narration → 每步一个红图钉大标题，比 12px TurnMarker 还响；模型补作业时
多个图钉合并成一段。本质：**引擎的纪律脚手架喊得比真实内容响**，且同一
信息（当前步骤）已由薄条（实时）和 TurnMarker summary（历史）承载。

处理（三选一后定"降级到结构层"，否决了"整行删除"与"只改样式"）：
`extractPlanSteps` 渲染时从中间轮 narration 抽出图钉行，去 emoji/加粗，
以 12px ink-soft 子行挂在 TurnMarker 下；流式与 preamble 路径直接剥除。
**最终回答豁免**——deliverable 里字面出现该字符串属于内容（教程/引用/
代码块），不得改写。存储不动，live 与 restore 走同一渲染路径。

## 后续观察项

- 上游调弱触发后 plan mode 实际出现频率可能很低；可视化上线后第一个观察
  项就是真实频率，有数据后再回头讨论是否需要入口。
- GA baseline 升级时 re-audit 耦合点：`plan_state.py` 公开 API 形态、
  `working['in_plan_mode']` stash 约定、`ga.py:614` 的 📌 注入格式
  （格式变了 `extractPlanSteps` 和 plan_state 的 `current_step` 会一起
  失明——两处都在解析同一约定）。
