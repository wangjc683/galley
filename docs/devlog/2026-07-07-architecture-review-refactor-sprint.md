# 架构 review 驱动的重构冲刺 + 三次诚实收回

2026-07-07。一次以架构 review 为起点的重构 session：先用 Explore agent 扫出三层 12 个「deepening 候选」，然后**逐个对着真实代码验证**再决定做还是不做。最大的收获不是某个重构,而是一条方法论:**Explore agent 给的是线索,不是结论——今天它的事实性断言被证伪了三次。**

## 会话前置:工程 skill 脚手架

开工前先把 Matt Pocock engineering-skills 的 per-repo 配置建起来(`docs/agents/{issue-tracker,triage-labels,domain}.md` + AGENTS.md 的 `## Agent skills` 段):issue tracker 用本地 markdown(`.scratch/<feature>/`)、五个默认 triage 标签、单 context 领域文档。副产物是**首次建立 `CONTEXT.md`**(领域词汇表),按 domain.md 的「惰性创建」规则,在 G1 resolve turn-numbering 术语时落地。

## 做了什么(全部行为不变 + 上测试网)

**G1 · turn-index single-home**(`gui/src/lib/turn-index.ts`)。GA `agent_runner_loop` 每条 user message 从 turn=1 重置,造成「GA step / 绝对 turn_index / 第 N 步 display step」三个编号的正反向映射摊在 5 个文件。收进一个纯模块:`resolveAbsoluteTurnIndex`(正向兜底)+ `makeMessageStepper`(反向 restore,闭包工厂持 base-reset 规则)。round-trip 属性测试钉死 forward∘inverse = identity + 主键撞车 bug。

**G3 三连**(GUI 派生状态各归其位):
- **3b** 会话状态读时派生,删 `fireSessionMirror`(19 处调用 + `applyDerivedFromRuntime`)。`Session.status` **收窄成 `DurableSessionStatus`**——往行里写运行态成了编译错误,`tsc` 逐个指出迁移点。`sessionFromBrief` 在线边界把 Core 的陈旧运行态塌成 idle,白送修一个「幽灵运行中」bug。
- **3c** 当前 LLM 显示优先级从 App 渲染体的五来源三元瀑布收进纯函数 `resolveDisplayedLLM`(`lib/current-llm.ts`);i18n 留在 App。
- **3a** 组件裸访问 `byId[...]?.x ?? default`(13 处)收进 `useActiveMessages`/`useActiveRuntime` hook;窄投影 + `useShallow` 保证流式 token 不触发重渲染。

**P3 · 共享 parent-watchdog**(`runner/_watchdog.py`)。workbench bridge 和 managed IM supervisor 各带一份进程存活 watchdog。两个入口净删 185 行、加 25 行,~160 行手动同步的跨平台代码(含 Windows `OpenProcess`)收进一个家。

## 被否 / 收回的方案(这才是 review 的价值)

**ADR-0001 · 不删 turnIndexOffset 兜底**。G1 之后发现 Core 已端到端供给 `absoluteTurnIndex`,offset 看似死代码。侦查后**决定不删**:类型契约两层都可空,且真触发时 offset 给的是正解,删了会重现主键撞车。这门手艺的反直觉一课——「查清楚『它死没死』,答案是『没死,这是它活着的证据』,于是不删」。

**ADR-0002 · 不把 session 写路径 handler 统一进 `deliver_turn`(R1)**。R1 是 review 的「首推最深杠杆」。逐行读后premise 崩塌:5 个 handler 看着像同一算法,失败契约却**互相冲突**——`session.send` 容忍(成功信封)、`goal.synthesize` 致命(exit 5)、`goal.master_plan` 不 emit(internal 可见性)、`session.new` emit `spawn_failed`。而 dispatch 状态串是**文档化的 Agent API 契约**。统一函数需 4-5 个策略参数,是配置对象反模式,通不过删除测试。**我第一轮凭报告把 R1 捧成首推,是没验证——收回。**

**R2 未核实搁置**;**P1(Bridge 神对象)**痛真但最险、最难验证(runner 无肉眼验收,e2e 需真实 GA+LLM),只该动「引入一个统一 GA 测试 seam」那一刀,且需先读透共享 flag 耦合;**P2(`can_patch` 门)**报告说「12+ 处」实为 6 处且是 setup 分支 + 一个安全 helper 的混合,注水,搁置。

## 元教训(写进方法论)

同一份 Explore-agent review,在 **R1 / P2 / P3** 三处的事实断言全被证伪:R1「同一算法三旋钮」实为契约冲突;P2「12+ 处」实为 6 处;P3「byte-identical」实为 2/6 函数分叉。**把这类 review 当线索去核实,不当结论。** 今天这条纪律避免了一次错误重构(R1)和一次「复制一份把行为改错」(P3)。

## 状态

- 已做:G1 / G3(3b·3c·3a)/ P3,均 typecheck+lint+test 或 pytest+mypy+ruff 全绿并推送。
- 未做:G2(最大、跨层,需 Rust 先吐 clean turn)、R2、P1。
- 验证债:3b/3c/3a 动了侧边栏 + 模型 pill,真机视觉验收待 JC 在真实 app 完成。
