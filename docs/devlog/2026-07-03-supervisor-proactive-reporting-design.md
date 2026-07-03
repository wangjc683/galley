# 2026-07-03 · Supervisor 主动汇报 · 定位收敛 + 可行性 spike + 设计

> Status: implemented（同日，见文末「实施更新」）· Related: [docs/PRD.md](../PRD.md) §1/§14 ·
> [2026-05-15 vision pivot devlog](./2026-05-15-vision-pivot-to-orchestrator.md) ·
> `docs/integrations/galley-supervisor-sop.md` · `core/src/managed_prompt.rs`

## Context

围绕 Supervisor Agent 定位的一轮讨论,收敛出两个前提,再由前提推出下一步:

1. **Galley CLI 是 agent-first 的**,主要消费者是 Agent 而不是人(重申 PRD D8)。
2. **主要 Supervisor = Galley 自带的 IM Channels**(微信 / 飞书 / 未来 Telegram)。
   SOP / Claude skill 让任何 agent 都能接管 Galley 仍然成立,但那是生态接口,
   不是主战场。

第二条的关键推论:**只有 Galley 拥有 supervisor 的两端,supervisor 才能从
「被动应答的代理」变成「主动汇报的管家」**——贴出去的 SOP 永远做不到主动给
用户发消息。管理场景的完整 loop 是 委托 → 执行 → **汇报** → 决策,现在
汇报这一环靠用户自己想起来去 IM 里问。这个缺口和模型智能无关,是
request-response 结构问题;以前沿模型为默认模型的假设下,它是唯一的
结构性缺口,即下一步。

本篇记录定位结论、两侧可行性 spike 的发现、设计决策与被拒绝的替代方案。

## Decisions

### D1. 投资分层(定位落地)

| 层 | 内容 | 态度 |
|---|---|---|
| 契约层 | agent-api.md、schema 稳定性、discovery | 宪法级,不动摇——内置 supervisor 自己跑在上面 |
| 内置 IM Supervisor | Channels 体验、主动汇报 | 主战场,主动投入 |
| BYO SOP / Claude skill | 生态接口 | 维护态:保持正确、随 schema 更新,不做体验打磨 |

配套原则:**Supervisor 是 stateless-by-design**——所有持久状态住在 Galley,
supervisor 每个 turn 靠 CLI 读回真相,不信任自己的对话记忆。IM 单线程
context 积累的退化问题由此从架构问题降级为无关紧要。

### D2. 汇报范围 = supervisor 发起的任务

原则:**汇报回到委托发生的地方**。IM 里派的活,结果回 IM;GUI 里自己开的
session,反馈就在 GUI(人在桌前,推手机是噪音)。`--supervisor` origin 字段
即范围判据,不需要新机制。

- GUI 发起的 session **只有 pull 没有 push**:出门后可以通过 IM 问进展
  (read 命令现成);预感会离开就从 IM 派任务。这是行为习惯而非系统保证,
  dogfood 中若反复出现「GUI 派了才想起要通知」,再回来建 opt-in follow。
- 实现时触发条件写成「session 在汇报范围内」,范围定义现在等于
  「supervisor 创建的」——将来加 follow/opt-in 只是给范围加成员,不动机制。

### D3. 只做飞书,微信不上此功能

Spike 结论(GA 侧,均不需要改 GA 源码,符合扩展式 attach 宪法):

- **飞书全绿**:出站发送是独立的模块级函数(`fsapp.py:448` `send_message`,
  标准 bot API `im/v1/messages`,与入站解耦);synthetic turn 注入是
  「直接调方法」级别(`FeishuApp.run_agent`,`fsapp.py:738`);agent 统一
  入口 `put_task(query, source=...)`(`agentmain.py:117`)本就支持非用户
  来源(已有 `"reflect"` / `"conductor"` 先例);`agent._turn_end_hooks`
  是现成的 dict 扩展点。Galley 的 owner 绑定已回答「发给谁」。
- **微信黄灯,推迟**:`WxBotClient.send_text` 原语存在但无类缝隙
  (`on_message` 全是闭包)、无 owner 概念(谁发消息回谁)、个人号 iLink API
  能否无入站上下文主动发送是未验证的平台政策风险。等飞书跑顺 + iLink 政策
  验证后再评估。

### D4. 直接做「模型组稿」形态,监听骨架 + synthetic turn

曾对比过路 A(core 确定性模板推送)vs 路 B(模型组织汇报)。Spike 后发现
**两者的监听骨架完全相同,只差最后一步**;飞书上 synthetic turn 零成本,
路 A 失去独立存在的理由。

Galley 侧 spike 关键事实:

- launcher 继承 core 环境(`TMPDIR` + uid → `socket_path()`,
  `core/src/socket_listener/mod.rs:120`),**今天就能连上同一个 socket /
  调 CLI,不需要改 core**。
- core → launcher 没有推送通道(stdin 是 `Stdio::null()`,
  `core/src/im_supervisor.rs:279`),事件只能拉。
- 可靠的完成信号是 live watch 流里的 `run_complete` IpcEvent
  (`core/src/ipc.rs:63`,带 `exit_reason` / `final_content`);同一条流里
  还有 `ask_user`——「卡住等输入」场景免费拿到。持久化兜底 = DB 里落了
  final answer(`session wait` 的 completed 语义即基于此合成)。
- 没有全局「任一 session 完成」订阅;跨 session 感知用「枚举 + 逐 session
  watch」合成,`project follow --until-idle` 已示范该模式
  (`cli/src/project.rs:530`)。

落地形态:launcher(`runner/managed_im_supervisor.py`)加一个 reporter
daemon 线程(与现有 parent watchdog 同模式):

```
循环:
  1. sessions list → 过滤 origin.supervisor == 自己 → 在飞的委托任务
  2. 对每个 live session 开 watch,等 run_complete / ask_user
  3. 事件到达 → FeishuApp.run_agent(owner, 汇报指令) → 前沿模型组稿发出
  4. 已汇报的 run 记入 launcher state 文件
```

汇报组稿要求(进 entry-layer prompt):手机可读、结论先行、以决策点结尾
(「要继续吗 / A 还是 B」),不是只报状态——反馈引导行动。

### D5. 前置条件:钉住 supervisor id

汇报范围的判据是 `--supervisor` 字段,但目前注入的 IM prompt 未指定 id,
SOP 只有 `my-agent/v1` 占位符——模型每次自己编,过滤是空中楼阁。
修法:spawn 时注入 `GALLEY_SUPERVISOR_ID`(如 `galley-im/feishu`),
entry-layer prompt 强制使用。整个机制的地基,必须先做。

### D6. wait 与 reporter 按时长分工 + 去重规则

`session wait` 是纯 DB 轮询,Galley 侧拉长无压力;问题在 supervisor 侧阻塞
(GA agent loop 串行,阻塞 = 失聪,见 Rejected)。分工:

- **分钟级(≤10 min)**:wait 覆盖,结果当轮回来,上下文自然,无去重问题。
  SOP 的 `--timeout=300` 可放宽到 ~600,别再长。
- **超过窗口**:wait 超时 → reporter 接管。supervisor 的超时回复从
  「已启动,稍后来问」改为**「跑着呢,完成后我主动告诉你」**——这句话的
  改变就是本功能的产品价值。

去重规则:**wait 在超时前送达的 run,reporter 不再推**。具体仲裁机制
(state 文件标记 / 时间窗)实施时定。

### D7. 可靠性:live watch + 启动对账

live watch 只对活着的 runner 有效,launcher 重启或轮询间隙完成的 run 会丢
事件。兜底:启动时对账「有 final answer 但未标记已汇报」的委托 session,
补报。已知前提:agent turn 的 DB 持久化目前由 GUI webview 消费
`runner-event` 驱动(`core/src/runner_commands.rs:499`),桌面 app 常驻时
成立,实现时把这条依赖链写进注释。

### D8. core 侧唯一顺手改动:`SessionFilter` 补 `supervisor` 字段

`sessions.list` 现无 supervisor 过滤(`core/src/api/session.rs:118`),但
`created_by_supervisor` 列已存在并映射到 `SessionBrief.origin.supervisor`
(`core/src/db/rows.rs:17`)。客户端侧过滤今天可用;server 侧 filter 为
additive schema 扩展,不 bump。

## Rejected alternatives

### 超长 `session wait` 替代主动汇报

「把 wait 拉到小时级」不成立,三个理由:

1. **Supervisor 失聪**:GA agent loop 串行消费任务队列,一个 turn 阻塞在
   2h wait 上,期间所有 IM 消息只能排队。任务越长,越惩罚「委托长任务」
   这个它要服务的场景。
2. **可靠性押在最脆一层**:阻塞 wait 的记忆存活在打开中的 tool call 里,
   进程波动 / LLM API 中断即无声丢失,没有对账可补。reporter 的状态在
   DB + state 文件,重启可恢复。
3. 工程细节不配合:tool 超时上限、流式卡片挂起数小时、并发委托无法多路
   阻塞。

wait 保留中短程分工(D6)。

### GUI session 的 opt-in follow(「跑完通知手机」)

真实场景但先不建。两条零成本路径覆盖大部分价值:IM 里随时 pull 进展;
预感离开就从 IM 派任务。dogfood 出现反复懊恼信号再回来建(D2 已留好
范围扩展的口子)。

### Session 自己发飞书通知

在 GUI 任务 prompt 里写「完成后飞书通知我」——前沿模型可能真的自己去调
飞书 API,半灵不灵且破坏分层:**session 干活,通知是 supervisor/core 的事,
传输能力不漏进 worker**。应写进 SOP boundaries 防止 dogfood 长出野路子。

### 路 A(core 确定性模板推送)作为独立阶段

监听骨架与路 B 相同,飞书 synthetic turn 零成本,模板推送失去独立价值
(D4)。

## Open questions

- **O1 去重机制**:wait 送达与 reporter 的仲裁具体怎么落(state 文件标记
  run id?时间窗?)。实施时定。
- **O2 防打扰策略**:多任务同时完成是否合并成 digest?静默时段?v1 先
  逐条报(委托量小),有信号再做。
- **O3 `ask_user` 立即报的措辞**:等输入的推送必须带上问题本身和可选项,
  让用户在 IM 里直接回答就能续跑——链路(IM 回复 → supervisor →
  `session send`)需要 entry-layer prompt 配合。
- **O4 微信**:iLink 主动发送政策验证 + owner 绑定设计,单独立项。
- **O5 SOP 自治度**:前沿模型默认下,SOP 的确认摩擦(如 `确认启动 Goal`
  硬编码中文咒语)可重新校准,与本功能解耦,另行讨论。

## Next

实施切片(飞书单通道):

1. D5 钉 `GALLEY_SUPERVISOR_ID`(env + entry-layer prompt)
2. reporter daemon 线程:枚举 + watch + state 文件 + 启动对账
3. synthetic turn 注入 + 汇报组稿指引(entry-layer prompt)
4. 去重规则(O1)+ wait 窗口调整(SOP `--timeout` 300 → 600)
5. `SessionFilter.supervisor` additive 扩展(可选,客户端过滤可先行)

## 实施更新(同日)

切片已全部落地。三处与上文设计的偏差,均为实施时的简化,记录如下:

1. **轮询替代 live watch(修订 D4/D7)。** reporter 不用
   `session watch`,而是每 ~20s 轮询 `sessions list --runtime all` +
   `session show --tail=30`,以 agent message 的 `finalAnswer` 落库为
   「run 完成」判据(与 `session wait` 同源但更严格:中间步 content 不算)。
   理由:reporter 的真相本来就是 DB(D7 的对账兜底必须存在),watch 是
   per-session、runner-lifetime-bound 的,只省 ~20s 延迟却引入整套订阅
   管理;对 IM 推送这个延迟无感。代价:`ask_user`(等输入)事件在 DB 里
   不可见,O3 推迟——将来若做,再引入 watch。启动对账因此免费:轮询
   本身就是对账。
2. **去重(O1)落为「模型记忆 + state 文件」双层。** state 文件
   (`im/feishu/reporter_state.json`)保证同一 message 不会触发两次
   report turn;「wait 已送达则沉默」由 report turn 跑在同一 GA 对话
   context 里、模型自查后回 `SKIP_REPORT` 实现。首次启用时 baseline:
   已完成的历史结果静默入账,不向 owner 补发。
3. **新增一个 fsapp 层守卫(实施中发现的坑)。** GA agent loop 串行但
   任务可排队:report turn 进行中若用户来消息,用户任务的卡片 hook 会把
   report turn 的步骤误收进自己的卡片(GA 不给 turn 打任务标签)。修法:
   `_GALLEY_REPORT_TURN_ACTIVE` 窗口标志 + hook 早退;reporter 注入前
   还会避让进行中的用户任务(busy 则整轮推迟)。
4. 失败也汇报:session 落入 `error` / `cancelled` 时推一次失败报告
   (静默失败是最差结局);report turn 超时重试上限 3 次后放弃并记录。
5. `SessionFilter.supervisor`(切片 5)未做——客户端过滤够用,等出现
   性能信号再加。

落点:`core/src/managed_prompt.rs`(id + entry-layer 汇报指引)·
`core/src/im_supervisor.rs`(env 注入)· `runner/im_reporter.py`(新)·
`runner/managed_im_supervisor.py`(接线)·
`managed-ga/code/frontends/fsapp.py`(hook 守卫,已录为
patch `0013-managed-feishu-report-turn-guard.patch` + manifest 台账,
可随 baseline 升级重放)· SOP `--timeout` 600。
测试:`runner/tests/test_im_reporter.py`(15)+ fsapp 守卫用例;
Rust prompt 测试 2 例。
