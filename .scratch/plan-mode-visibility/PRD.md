# PRD: Plan Mode 可视化（Plan Mode Visibility）

Status: ready-for-agent
Date: 2026-07-21

## 背景

GA 内核自带 plan mode：`plan_sop.md`（四态流程：探索 → 写 plan.md 并
`ask_user` 确认 → 逐条执行 checklist → 强制对抗性验证）+ `ga.py` 的
`enter_plan_mode(plan_path)` 运行时状态（`working['in_plan_mode']`）。
唯一入口是模型自己按 SOP 判断复杂度后通过 `code_run` inline_eval 调
`handler.enter_plan_mode(...)`；没有外部 flag、CLI 参数或 IPC 命令。

关键事实：

- Plan mode **不是只读安全模式**。"探索阶段只读"靠提示词约束，引擎层没有
  写入锁。它的本质是执行纪律（先出计划、用户确认、强制验证），不是权限
  姿态。UI 上不得包装成"安全模式"。
- 引擎行为：拦截未经 `[VERIFY]`/`VERDICT` 的完成声明；≥10 轮起每 5 轮强制
  重读 plan.md；checklist 清零后自动退出。
- GA 上游在 1e89c3e → 5257dec 升级中**主动弱化了 plan_sop 的自动触发**
  （memory 模板改动，见 `docs/ga-baseline.md`），Galley 原样 vendor。
- GA 自带 `managed-ga/code/frontends/plan_state.py`：纯 stdlib 的 plan
  状态解析器，含 `desktop_plan_payload_from_session`，即"从会话状态解析
  前端进度卡 payload"，可复用。
- Galley 三层（gui/core/runner）目前零 plan 概念。

## 决策（2026-07-21，JC 拍板）

**GUI 只做可视化，不做任何开启入口。** Composer 完全不动，触发完全交给
模型按 SOP 自主判断，GUI 只负责把 plan mode 发生时的状态呈现出来。

理由：

- "自动开启"这条路已存在于内核——模型本身就是意图判断器。GUI 侧再做
  意图检测等于维护第二套启发式，和内核打架。
- 上游自己弱化了自动触发，说明硬编码触发被上游认定为过激。
- 符合 Galley 的 UI 原则：需要解释的控件 = 设计失败；plan mode 的存在感
  只在真正发生时出现，不占常驻 UI 预算。

## 方案要点

### 1. 进度呈现：活跃期常驻薄条 + 展开 checklist

Plan mode 可能跑上百轮，内联卡片会被滚出视野。设计：

- 会话头部一条很薄的进度摘要（当前步骤 + `n/N`），仅在 plan mode 活跃时
  存在，点开展开完整 checklist（`[✓]/[ ]` 逐条），plan 退出后自动消失。
- 会话流内的 plan.md 呈现可选，薄条是主体。

### 2. 数据链路：runner 复用 GA 解析器，事件过 core

- Runner 侧复用 `plan_state.py` 的解析能力（读 `working['in_plan_mode']`
  与 plan.md），属于允许的**只读耦合点**，需记入耦合文档。
- 解析结果作为 bridge 事件发给 core，GUI 纯订阅渲染（Rule 5 presenter
  定位；不在 TypeScript 重写 checklist 解析）。
- 事件过 core 的顺带好处：将来 CLI/Supervisor 要看 plan 进度是 v1
  加法式扩展，不用另开链路。本期不做 CLI 暴露。

### 3. 计划确认气泡：第一版不特殊化

SOP 的"`ask_user` 确认 plan.md"以普通 ask_user 形式呈现。识别"这个
ask_user 是计划确认"只能靠启发式，脆；进度卡在场时上下文已足够。真实
使用中发现确认体验不好再议。

## 已否决的替代方案（供 devlog 沉淀）

1. **Composer 按消息修饰（"先规划" arm/disarm，类似 Goal 按钮）**——
   曾是 agent 推荐项：生命周期与 plan mode 对齐、实现仅需提示注入。
   否决：composer 增加常驻控件，与"只在发生时可见"原则冲突；先要
   可见性和真实频率数据，再回头谈入口。
2. **会话级"规划模式"常驻开关**——否决：sticky 开关与 plan mode
   "checklist 清零自动退出"的生命周期不一致，任务结束开关仍亮，成为
   需要解释的控件。
3. **恢复/加强 SOP 自动触发**——否决：需对上游行为引导内容打补丁，
   违背 managed-runtime 补丁最小化原则，且方向上与上游判断相悖。

## 风险与后续

- 上游调弱触发后，plan mode 实际出现频率可能很低；可视化上线后的第一个
  观察项就是真实触发频率。这是有意的顺序：先可见性，用真实数据再讨论
  是否需要入口。
- 外部 GA（attach 模式）行为差异：外部 GA 不一定有 plan_sop / 相同的
  `working` 结构，实现时需明确 attach 模式下该功能的降级行为（预期：
  检测不到即不显示，且不得写外部 GA 任何状态）。

## 实现拆分

Issues 待建（实现启动时按 `issues/NN-<slug>.md` 拆分），预期切分：

1. Runner：plan 状态检测与 bridge 事件（复用 plan_state.py，含耦合点
   文档更新）
2. Core：事件转发与（如需要）会话态缓存
3. GUI：活跃期薄条 + 展开 checklist
