# PRD — Goal 分叉:solo(默认) + hive(显式升级)

Status: ready-for-agent
Owner: JC
Created: 2026-07-08

## 背景 / 问题

现在 Galley 的 Goal 只有一种编排形态:headless **hive**(master + workers +
task board + wave)。`worker_limit` 只调宽度,没有形态开关;`worker_limit=1`
仍是"master + 1 worker + synthesis"的退化 hive,不是单 agent 长跑。

把"持续单线程死磕"和"多视角独立验证"两类任务压进同一个引擎,导致 hive 被
**过度套用**。典型反例:一道 5 分钟预算的研究判断题("勒布朗下赛季去哪队")
被拉起 2-worker hive,预算大半耗在拉起 session / claim 协议 / 兜底降级上,真正
该用来查资料的时间被"设计部"开销吃掉。相关事故见 `issues/01`。

## 第一性判断:两个引擎解决的是不同问题

区分 solo / hive 的**不是**任务的"长/复杂"(hive 任务同样又长又复杂),而是:

- **答案可验证、单线程死磕** → **solo**。重构一个模块、写完一份文档、查一个有
  明确答案的问题。瓶颈是"扛不扛得住长链条",多视角无用。
- **答案可争议、需多个独立视角互相挑错** → **hive**。模糊判断题、"把所有问题
  都找出来"、设计空间探索。价值在独立交叉验证,单 agent 会困在自己的盲区。

## 决策(已与 JC 逐条确认)

### D1. 两个引擎,solo 为默认

- **solo(默认)**:单 agent、Core-owned、预算驱动续跑。开一个 session,idle
  就用"预算耗尽前不能宣告完成"的续跑 prompt 再踢,预算到 → 收口 → 落交付锚点。
  天生没有 hive 的 master/worker/claim/wave 那一整类协调 bug。
- **hive(显式升级)**:即现有 master/worker 编排,作为**次级视觉权重按钮**。

理由:(a) solo 更贴合"给个复杂目标让它一直跑"的用户心智;(b) 更便宜、更鲁棒;
(c) **爆炸半径**——hive 独有的协调失败模式在 solo 里根本不存在,不该让随手一个
Goal 默认落到那条昂贵且脆弱的路径上。hive 是深思后主动去够的重型工具。

### D2. 引擎选择:显式 + 预算硬门槛,不做复杂度自动判别

- **显式**:用户点 hive 按钮 = 精度最高的"我要多视角"信号。
- **预算硬门槛**:低于最小预算时 hive 按钮禁用/警告("这点预算大半花在协调上,
  调大预算或用 solo")。预算是用户给的、廉价、可靠,且是物理而非猜测。
- **不做**目标复杂度自动分类(不可靠信号,误判代价高,且毁掉可预测性)。

### D3. 文案 / 心智:结果导向

- hive 按钮走**结果语言**:「多个独立视角交叉验证」(更慢更贵,换相互挑错)。
- **不**向用户暴露 master / worker / hive / wave 等实现术语。
- 用户判断依据是"我这答案是否可争议、要不要被独立核查",不是"任务大不大"。

### D4. GUI 形态(`gui/src/components/conversation/GoalConfirmDialog.tsx`)

- **solo 主路径**:只露预算(fast / recommended / deep / custom),连 agent 数
  都不问(solo 恒为 1)。旋钮最少。
- **hive 次级按钮**:点开才展开 agent 数量(2–5)+ "多个独立视角交叉验证 ·
  更慢更贵"说明;预算低于门槛时该按钮禁用 + 提示。天然的渐进式展示。

## 引擎实现约束

- solo **不复用** GA 的 `reflect/goal_mode.py` / `goal_state.json` 文件协议
  (违反 CLAUDE.md Rule 1 GA 边界 + Rule 5 Core 权威;且 Goal V1 devlog
  `2026-06-04` 已明确将该套机制列为"被 Core 替换、不喂给 master")。只借"预算
  驱动续跑"的**理念**。
- solo 是新的轻量 Core-owned 控制器,复用现有 session 生命周期 / budget /
  deliverable anchor / TopBar 指示。相对 hive 的 1971 行控制器,solo 极小。
- 接受 Goal 内部有两条实现路径(solo 单 session 续跑 vs hive 控制器)——JC 已
  确认"本来就是两种 Goal 模式"。
- Agent API(schemaVersion 1)是冻结契约:新增 solo 走 **additive-only**
  (如给 `goal propose` 加一个可选 `--mode` 或复用现有字段),不得破坏现有
  `goal` 命令面。具体接线在实现 issue 里定。

## 落地顺序

1. **`issues/01`**:修 master 自领 task 的 bug 硬护栏(小、独立、止血)。
2. **solo 引擎**(中等)。
3. **GUI 分叉**(solo 默认 + hive 次级按钮)。

## 明确不做(本轮)

- solo 中途自动升级 hive(检测到"反复收敛无独立核查"时建议 fan-out)——是 v2
  终局,依赖 solo 先落地。
- 目标复杂度自动分类选引擎(见 D2)。

## Comments

### 2026-07-08 — 三片全部落地并验证(未提交)

- **issues/01 bug 硬护栏**:master 自领 task 三层修复。✅
- **issues/02 solo 引擎**:数据模型 + CLI + `run_solo_goal_loop` + 收口 prompt 分支。✅
- **GUI(task #4)**:`GoalConfirmDialog.tsx` — solo 默认(只露预算)+ hive 次级
  toggle(展开面板:「多个独立视角交叉验证」说明 + agent 数 + 改回单人链接)+
  预算硬门槛(`HIVE_MIN_BUDGET_MINUTES = 10`,低于则禁用 hive + 提示,effectiveMode
  回落 solo)。`mode` 经 `GoalLaunchConfig → startDesktopGoal → StartDesktopGoalInput`
  串到后端。双语 copy 已加。✅

**验证**:cargo check/test --workspace 全绿;fmt/clippy 干净(仅 pre-existing);
gui typecheck/lint/test(115)全绿;git diff --check 干净。

**待 JC**:桌面 dogfood 验收 solo 全链路(单测覆盖不到 live bridge 循环)+ 决定提交。
预算门槛值取 10 分钟(JC 未反对提议值)。假设 A(API 默认 hive / GUI 发 solo)待确认。
