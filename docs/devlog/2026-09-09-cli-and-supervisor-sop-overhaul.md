# 2026-09-09 · Galley CLI 与 Supervisor SOP 全面梳理

> Status: implemented · Related:
> [2026-07-03 SOP 前沿模型重校准](./2026-07-03-supervisor-sop-frontier-recalibration.md) ·
> [2026-08-12 会话消息队列](./2026-08-12-session-message-queue.md) ·
> [2026-08-23 Goal 派发装门与真实忙闲信号](./2026-08-23-goal-dispatch-gate-and-run-state.md) ·
> `docs/agent-api/` · `docs/integrations/galley-supervisor-{sop,reference}.md` ·
> `.claude/skills/galley-supervisor/` · `core/src/managed_prompt.rs`

## Context

JC 要求对 CLI 与 Supervisor SOP 做一次全面对表。读三层文本（agent-api 文档、
SOP / reference、两份 SKILL.md）、CLI 源码、内置 IM entry-layer prompt，并
在真机上跑只读命令核对。骨架健康（agent-api 拆分清晰、错误契约与实测一致、
副本 drift 门禁和链接门禁绿），问题集中在两处：**SOP 三份文本没有跟上
v0.4.6 之后的 CLI 能力**，以及 **supervisor 缺一个可信的「谁在跑」读命令**。

## 发现（对表结果）

1. **send→wait 在多轮会话上立即返回上一轮答案。** `session wait --after-turn`
   早已存在且 agent-api 自己标注这是 footgun，但 SOP、reference、SKILL.md、
   IM entry-layer prompt 四处都没教。「继续一个 session」是最高频路径。
2. `dispatch:"queued"` 与 `--jump`（v0.4.6）四处均未提；SOP Errors 段的
   dispatch 枚举漏 queued。`wait` 的 `session_error` / `session_cancelled`
   终态同样未进 SOP。
3. **Goal 引擎默认不一致**：CLI `goal propose --mode` 默认 hive、GUI 默认
   solo、SOP 从未提 `--mode`，supervisor 起的 Goal 永远是 hive；agent-api 的
   propose 签名行也漏了 `--mode`。
4. **风险分档（07-03 D2）只改了 SOP 本体**：Skill README 仍写
   「archive / stop / project delete 先确认」，内置 IM entry-layer prompt 仍写
   「Confirm before stopping, archiving…」。IM 是主战场（07-03 D1），反而最落后。
5. 陈旧标记：三份文本都写「v0.2.x line / Last reviewed 2026-07-03」；SKILL.md
   Boundaries 仍用「YOLO mode」（07-20 已更名）；reference 与 SKILL 的 wait
   仍是 300（SOP 已是 600）。
6. 契约层小错：`--schema` help 说 `error: "schema_mismatch"`，实测是
   `invalid_args` + 消息前缀；session-commands 5.4 的 not_found 示例是
   `detail.message` 嵌套形，实测顶层 `message`；PRD §11 命令表严重过期
   （`--pretty` / `--scope` / `--filter` 从未落地，wait / follow / goal 不在表里）；
   `galley --help` 满是内部代号（B2 M4、B4 M1、sub-plan O2/O3、「v0.6+」）。
7. **`status.running` 恒为 0**：实测 78 sessions / 0 running，
   `sessions list --status=running` 同样为空——08-23 devlog 已确认 Core 从不写
   running 列。SOP「Inspect before action」第一条就是 `status`，而 supervisor
   事实上没有任何读命令能回答「哪些在跑」。`session.run_state` 已在 socket
   层存在，只是没公开到 CLI。
8. `galley sessions list | head` 触发 broken pipe panic（实测）。
9. 结构性重复：SOP 内容 1 canonical + 4 verbatim 副本 + 二进制内嵌 + IM 物化
   有门禁；但两份 SKILL.md 是 SOP 的**手写改编**（约六成内容重复），无门禁，
   已漂三处（4、5）。

## Decisions

### D1. 公开 run_state：批量 socket 命令 + CLI 附加 `live` 字段

新增 socket 命令 `sessions.run_state`（`{sessionIds?}` → `{sessions:[…]}`，
无 ids 时返回 RunnerManager 持有状态的全部会话），每条附派生字段
`busy = openRun || agentRunning || queuedCount > 0`（与 goal 控制器的
`goal_run_state_busy` 同定义，避免每个 supervisor 各自再推一遍）。单会话的
`session.run_state` 同步加 `busy`。

CLI 侧 `sessions list` / `session brief` / `status` 在直连 SQLite 之后做**一次**
best-effort socket 探测（3s 上限），把结果作为 additive 的 `live` 字段拼进
行对象；`status` 得到 `live.busy` / `live.queued` 汇总。Core 不可达时字段
整体缺席，命令照常成功——这是读命令唯一碰 socket 的地方，且永不因它失败。
语义上「缺席 = Core 不可达」，「显式全 false = 真空闲」，两者不混。

实现细节：拼接走 `serde_json::Value` 往返，cli crate 因此开
`serde_json/preserve_order`——否则所有输出键按字母序（`createdAt` 打头、`id`
埋在中间），测试锁住 `{"id":…` 开头。SessionBrief 结构本身不动（GUI 与
Tauri 输出不受影响）；I5 意义上这是 CLI 侧装饰，agent-api 明确标注
「CLI-attached」。

**被否**：改 Core 把 `running` 写进 SQLite 列——transient 状态本来就设计为
in-memory（08-23 devlog 的地基结论），改列会让 GUI 重启后读到陈旧 running。

### D2. broken pipe 静默退出

CLI 所有 stdout 写入收敛到 `common::emit_line`，BrokenPipe → `exit(0)`。不引
`libc` 重置 SIGPIPE（跨平台一致，且保留其它 stdout 错误的 panic 语义）。

### D3. SOP / reference 补齐 v0.4.6+ 能力，Goal 显式 `--mode=solo`

- Continue 热路径改成 brief（读 `turnCount`）→ send → `wait --after-turn=turnCount+1`，
  加粗写「永远传 `--after-turn`」；dispatch 三值（dispatched / queued /
  persisted_only）逐条给行为；`--jump` 只在用户明确要打断时用。
- wait 终态补 `session_error` / `session_cancelled`；reference 补 queued 不
  跨 Core 重启的提醒、timeout ≤600 的理由。
- Goal：SOP 与 reference 的 propose 都显式 `--mode=solo`，hive 只在用户要
  并行时用。**只改 SOP 不改 CLI 默认**——CLI 默认 hive 是已发布行为，改默认
  虽不算 schema breaking，但会让老 SOP 副本起的 Goal 静默换引擎。
- Inspect 热路径改教 `live.busy`；Hard Rule 2 加一句「是否在跑看 live.busy，
  不看 status」。
- reference 新增 Live State 节、Maintenance Notes 写清 SOP 文本的五个落点与
  各自的防漂机制；Origin Fields 的 IM id 改为真实的 `galley-im/<platform>`；
  Boundaries 补「不让子会话自己发通知」（07-03 rejected alternative 当时说
  该进 SOP boundaries，一直没进）。

### D4. IM entry-layer prompt 对齐 D2（07-03）并补 after-turn / queued / live

`core/src/managed_prompt.rs` 的 Default workflow 改写：stop / archive 可逆直接
做并说撤销法，`project delete` 等才先确认；send→wait 教 `--after-turn`；
queued 不重发；`live.busy` 是忙闲真相。新增单元测试锁住这四条（曾漂过的
规则才值得测）。

### D5. SKILL.md 瘦身为「身份 + 宿主注意事项 + 指向 SOP」

两份 SKILL.md 从 ~420 行手写改编砍到 ~110 行：只保留触发范围、supervisor id、
宿主特有注意事项（tool timeout、审批提示归用户、send→wait、live）、新用户
解释、自检清单，流程本身**只**存在于 `references/galley-supervisor-sop.md`
（verbatim、CI 校验）。开头 HTML 注释记下瘦身理由，防止将来又长回去。
「here, Claude Code」这类宿主字样改成中性表述——drift 门禁要求两份除 id
token 外逐字相同，任何宿主专属措辞都会撞门禁。

### D6. PRD §11 命令表退役

PRD §11 只保留输出契约原则、supervisor id 约定、有意不进 surface 的清单，
命令表改为指向 `docs/agent-api/`。理由：PRD 不是 surface 的真相来源，
留着必然再漂。

### D7. 纠错包

`--schema` help 文案、session-commands 5.4 示例、`--help` 去内部代号、
Cargo 描述、三份文本的版本标记与日期、SKILL 的 YOLO 措辞、Skill README 的
确认口径、`docs/agent-api.md` 旧路径链接改指目录 README、docs/README 的
SOP 更新路由改为「两份副本 + managed_prompt 复核 + 跑 drift 脚本」。

## 未做（有意）

- `sessions list --supervisor=<id>` 过滤（07-03 D8）：IM reporter 客户端过滤
  够用，无性能信号。
- `status.running` 列本身不改语义、不删（v1 冻结）；文档改教 `live`。
- roadmap §8 的四个 deferred 命令（`session kill` / `project archive` /
  `watch --from` / `llm warmup`）维持 deferred，无 dogfood 证据。
- 把 `live` 做进 SessionBrief 结构、让 GUI 也消费：GUI 已有自己的 in-memory
  run state，无需求。

## 验证

- Core：`socket_write_handlers_test` +2（批量按 ids / 无 ids 两形态）、
  `managed_prompt` +1；`runner_manager_test` 全绿。
- CLI：`cli_test` +4（无 Core 时 `live` 缺席且 `id` 仍居首、fake socket 下
  brief 挂 `live` 并核对请求形状、status 汇总 busy/queued、`| head -c 10`
  不 panic）；全部 CLI 测试绿。
- 真机：JC 的 `tauri dev` 在跑，cargo build 触发热重启后，`galley status`
  返回 `live:{busy:0,queued:0}`，`sessions list | head -2` 每行带 `live`
  且无 stderr 输出。
- `check-supervisor-sop-drift.mjs`、`check-docs-links.mjs` 绿。
