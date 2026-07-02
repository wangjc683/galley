# Codebase Review · 2026-07-02

> 全 codebase code review 汇总。4 个并行 review agent 分别深读 `gui/`、`core/`、
> `cli/`、`runner/` 源码产出 findings，全部经过源码验证（core 的 high 项做了二次
> 复核）。本文档是修复追踪清单：每条带 ID、file:line、严重度、状态。
>
> 按 [audits README](../README.md) 约定，本报告是 decision input，不是 spec。
> 修复产生的规则沉淀进 `AGENTS.md` / `architecture.md` 等正式文档。

**基线**：`v0.2.16`（commit `d02fd599`）。行号以该基线为准，修复后会漂移。

**状态标记**：`[ ]` 待修 · `[x]` 已修 · `[~]` 部分修复/需决策

## 总体判断

架构底子好：SQL 全参数化、IPC 类型化、错误分类清晰、GUI listener 生命周期与
流式渲染热路径干净、runner 基本守住 GA 边界规则。未发现注入类漏洞或 secrets
泄漏到日志。

问题集中在四个系统性模式：

1. **失败路径缺乏原子性/兜底** — 正常路径都对，崩溃/超时/单点失败留下永久坏状态
2. **fire-and-forget 异步调用** — 发出去不管，失败时 UI 与实际状态脱节
3. **并发生命周期缺互斥** — 进程启停无锁保护，竞态泄漏或脱管子进程
4. **把截断/共享数据当全量/独占用** — goal 子系统尤甚

四个模块的共性测试缺口：happy path 覆盖都不错，但**所有 high 都落在无测试的
失败路径上**（迁移崩溃中断、abort-while-approval-pending、事件窗口驱逐、
stdout 关闭但进程不退）。修 high 时应同步补对应失败路径测试。

## 修复顺序（建议）

1. **一行级 quick wins**：GUI-1、GUI-2、CLI-11 — ✅ 2026-07-02 已修
2. **数据安全**：CORE-1（迁移事务）、CORE-2（恢复过滤）
3. **Stop/审批整条链**：RUNNER-1 + GUI-3 + GUI-4（一起修才有意义）
4. **Goal 子系统**：CLI-1（事件窗口是根因）→ CLI-2/3/4
5. **进程生命周期三件套**：CORE-4、CORE-5、CORE-3
6. **Windows 三条**：CORE-6、CORE-7、CORE-11（下个 Win 发布的 gate）
7. **CORE-13 飞书访问控制**：需产品决策（收紧默认值 vs 明示记录 beta 取舍）

---

## core/（Rust 后端）

### High

- `[ ]` **CORE-1** · `core/src/migration_backup.rs:560-591` — 预检迁移非原子，
  崩溃后每次启动都失败（brick）。`apply_preflight_migration` 用非事务连接逐批
  执行 SQL，版本行最后才插入；在建表后、版本行前崩溃/断电 → 重启重跑 →
  "table already exists" → `exit(2)`，每次启动都如此，且无自动备份还原。
  修复：连接已是 `foreign_keys(false)`（:374），把「SQL 文件 + 版本行」包进显式
  `BEGIN/COMMIT`（文件内 `PRAGMA foreign_keys` 在事务里是 no-op）。
- `[ ]` **CORE-2** · `core/src/migration_backup.rs:804-836` — 恢复逻辑无条件
  复活已删除的 goals/goal_proposals。文档注释（:401-404）承诺只恢复父行仍存在的
  子行，但这两条 INSERT 无 JOIN 过滤。用户删掉的 Goal 会连同 tasks/events/
  deliverables 全部复活。修复：施加与子行相同的过滤，或不导入这两张表。
- `[ ]` **CORE-3** · `core/src/im_supervisor.rs:167-270` — start/stop/restart/
  autostart 无互斥。`start_inner` 从状态检查到 `set_slot` 跨多个 await；autostart
  （lib.rs:566）与手动 Connect 并发双 spawn，谁后写 slot 谁占坑——slot 可能挂着
  死进程而活 bot 无 Child 句柄：Stop 杀不掉、退出 `stop_all` 漏掉。
  修复：每平台一把 `tokio::Mutex` 覆盖整个生命周期操作，或 `set_slot` 加代际校验。

### Medium

- `[ ]` **CORE-4** · `core/src/runner_manager/process.rs:268-278, 407-429` —
  stdout reader 持 child 锁跨无限 `wait()`；shutdown 超时不覆盖锁获取。子进程关
  stdout 但不退出 → 锁永久持有 → `cleanup_and_exit`（tray.rs:164-177）挂死 →
  `app.exit(0)` 永不执行，用户只能强杀。修复：锁获取纳入 timeout，或 reader 不
  共享 Child。
- `[ ]` **CORE-5** · `core/src/runner_manager/manager.rs:94-103` — spawn 替换旧
  runner 依赖 `kill_on_drop`，但 Child 被 reader task 的 Arc 持有，drop 不触发
  kill → 忽略 Shutdown 的 runner 永久存活且脱离追踪。修复：替换路径复用
  `manager.shutdown` 的 `!graceful → kill()` 兜底。
- `[ ]` **CORE-6** · `core/src/socket_listener/mod.rs:313-346`（Windows）—
  accept loop 在创建下一个 pipe 实例失败时直接 `return`，CLI/Supervisor 通道永久
  死亡直到重启。修复：log + backoff 重试（对齐 Unix 分支 :303-308）。
- `[ ]` **CORE-7** · `core/src/socket_listener/mod.rs:201-215`（Windows）—
  双实例检测把任何 `ClientOptions::open` 失败当「无实例」；`ERROR_PIPE_BUSY` 时
  第二个完整 Galley 实例继续运行，双进程写同一 DB。修复：对 PIPE_BUSY 重试或
  判定为已有实例。
- `[ ]` **CORE-8** · `core/src/codex_oauth.rs:1106-1151` — 每次 managed spawn
  泄漏一个 credential IPC listener（task + fd + socket 文件）；Windows 分支创建
  失败静默 `break`。修复：返回关闭句柄绑定 runner 生命周期，或全进程单 listener。
- `[ ]` **CORE-9** · `core/src/codex_oauth.rs:262-268, 567-580` — 导入 Codex CLI
  登录时用 CLI 的 refresh token 刷新但不回写 `~/.codex/auth.json`；OpenAI 有
  reuse 检测，CLI 下次刷新被登出，严重时 token family 撤销连累 Galley。
  修复：导入时不刷新，或回写 auth.json。
- `[ ]` **CORE-10** · `core/src/migration_backup.rs:479-486` + `lib.rs:424` —
  备份永不清理（每次 schema bump 全量复制含附件的数据目录），磁盘无界增长；
  recovery 每次启动 ATTACH 所有备份（读写 ATTACH 还 checkpoint 备份的 WAL）。
  修复：保留最近 N 份；recovery 用一次性 sentinel 门控。
- `[ ]` **CORE-11** · `core/src/migration_backup.rs:481, 887-902`（Windows）—
  备份目录名比数据目录长 24 字符且不加 `\\?\` 前缀，深层附件复制失败 → 备份
  门禁 `exit(2)` 拒绝启动（正好落在 Win MAX_PATH dogfood unknown 上）。
  修复：manifest 开 `longPathAware` 或 `copy_dir_all` 内转 verbatim 路径。
  另：符号链接被静默跳过（:899）但仍报 `Backed`。
- `[ ]` **CORE-12** · `core/src/im_supervisor.rs:180-182` — force-restart 用
  `start_kill()` 后不 wait 就 spawn 新进程，Windows 上新旧进程抢 state-dir 文件锁
  → 模型配置变更后重启间歇性报 "already running"。修复：`start_kill` 后带超时
  `wait().await` 再 spawn。
- `[~]` **CORE-13** · `core/src/im_supervisor.rs:761-767` — 硬编码
  `"fs_allowed_users": []`，下游 fsapp.py:483-487 空列表 = PUBLIC_ACCESS：整个
  飞书组织任何能私聊 bot 的人都能驱动本机 agent。**需产品决策**：收紧默认值，
  或显式记录 beta 取舍 + 代码注释。

### Medium-Low / Low

- `[ ]` **CORE-14** · `core/src/socket_listener/session_cmds.rs:105`（及全部
  socket handlers）、`im_supervisor.rs:703+`、`codex_oauth.rs:274+` — 每请求
  `SqliteGalley::open()` 新建 4 连接池，与 lib.rs:429-446 共享池设计矛盾，放大
  WAL 写者竞争。socket handlers 已有 `Option<&AppHandle>` 可取
  `app.state::<SqliteGalley>()`。codebase 最大一处实质性重复。
- `[ ]` **CORE-15** · `core/src/migration_backup.rs:523` — 版本探测把解码失败
  静默当 version 0 → 已迁移库被当全部待迁移 → 重跑 001 失败 → 同 CORE-1 的
  exit(2) 循环。应作为 `DbProbe` 错误显式失败。
- `[ ]` **CORE-16** · `core/src/im_supervisor.rs:381-388` — autostart 吞掉 start
  错误：pref 仍 enabled、无 slot、`last_error: None`，UI 呈现「开关开着但什么都
  没发生」。失败时应 `set_slot` Error 状态。
- `[ ]` **CORE-17** · `core/src/codex_oauth.rs:361-399` — 先持久化
  secret+provider+model 再 probe，probe 瞬时失败（429/5xx）返回 Err：GUI 报
  「登录失败」但 provider 实际已配置。应返回 `Ok(… { ok: false })`。
- `[ ]` **CORE-18** · `core/src/browser_control.rs:433-459` — 扩展目录同步只增
  不删，上游删除/改名的脚本残留 unpacked extension，升级后混版本。改为写临时
  目录后原子换名。
- `[ ]` **CORE-19** · `core/src/socket_listener/project_cmds.rs:191-204` —
  `mint_project_id` 是时间戳纯函数无 counter（对比 `mint_session_id` 有
  AtomicU64），同 tick 并发 create 产生相同 id → PK 冲突。加 counter。

**已核查非问题**（复查可跳过）：FTS/LIKE 搜索全参数化且转义；
`insert_message_inner` 的 MAX(turn_index)+1 在 `BEGIN IMMEDIATE` 内串行化；
credential_store「密钥与密文同库」是模块头注释明示的 beta 取舍；IPC token
常数时间比较；退出路径（tray/quit/updater）都调 `stop_all` + `shutdown_all`。

**测试缺口**：migration_backup 崩溃中断路径与 recovery「已删父行」场景无测试
（inline tests 只测 happy path）；process.rs「stdout 关闭但进程不退」场景；
全部 Windows named-pipe 分支（仅靠 dogfood）。

---

## gui/（React + TS 前端）

### High

- `[x]` **GUI-1** · `gui/src/lib/onboarding-validation.ts:269-274, 352-366` +
  `Onboarding.tsx:189-196` — bundled 模式（默认）健康检查探测 rejection 无
  try/catch，`runHealthChecks` 又是 `void` 调用无 `.catch`：Python 行永久卡
  `running`，Continue 永久禁用，无重试入口。修复：对齐 `runSingleProbe:228-233`
  的 catch，映射为 `failed` 行状态。
  **已修 2026-07-02**：`runBundledRuntimeProbe` 包 try/catch 映射为
  `errorStage: "spawn"` 失败结果；Onboarding 调用点补 `.catch` 兜底把未完成行
  置 failed。
- `[x]` **GUI-2** · `gui/src/components/error-card/ErrorCard.tsx:93-104` —
  handlers 字面量漏 `onViewGoal`，action 过滤器永远滤掉 `view_goal`：每条
  「Goal 完成/失败」toast 都没有「查看 Goal」按钮。一行修复：handlers 补
  `onViewGoal`。**已修 2026-07-02**。

### Medium

- `[ ]` **GUI-3** · `gui/src/App.tsx:390-410` — 审批响应 fire-and-forget：先改
  UI 状态再不 await 不 catch 地发 `approval_response`；bridge 非 `connected` 时
  直接跳过发送。UI 显示「已允许」但 GA 未收到，run 永久挂起无反馈。
  修复：`.catch` 回滚 pending approval（或至少 toast），重新考虑 connected-only
  gate。与 GUI-4 共用一个 `sendOrToast` helper。
- `[ ]` **GUI-4** · `gui/src/App.tsx:1297-1306` — Stop 按钮同款 fire-and-forget：
  abort 发送失败则 `isStopping` 永久 true，按钮不再响应而 run 继续跑。同款模式
  还有 `lib/ipc-handlers.ts:433-437`（pet 迁移后 attach）和 `:140`（yolo sync）。
  修复：发送 resolve 后再 setStopping；rejection 时清除并 toast。
- `[ ]` **GUI-5** · `gui/src/stores/messages.ts:603` + `hooks/useStickyScroll.ts:268-288`
  — `appendUserTurnExternal` 对后台 session 也 bump 全局 `userSubmitTick`，
  把当前会话的视口拽到它自己的最后一条用户消息并播放多余的 ack 动画。
  修复：仅 `sid === activeSessionId` 时 bump，或 tick 携带 session id。
- `[ ]` **GUI-6** · `gui/src/lib/hydrate.ts:101-102, 135-140` +
  `stores/managed-models.ts:52-65` — managed models 加载失败被当「零模型」，
  已配置用户被送回 onboarding 首屏。修复：区分「load failed」（保留当前屏 +
  toast/重试）与「真的零模型」。
- `[ ]` **GUI-7** · `gui/src/components/conversation/Conversation.tsx:188-190`
  （及 `MainView.tsx:343-347`）— 内联 `onApprove` 闭包击穿 ToolCallout 的
  `React.memo`：流式期间长对话每个历史 ToolCallout 以 ~20Hz 重渲染。App 已特意
  useCallback 稳定 handler（App.tsx:385-390），中间层白包一层箭头函数。
  修复：传 `approvalId` 下去保持 handler 恒等，或 per-turn `useCallback`。
- `[ ]` **GUI-8** · `gui/src/hooks/useGoalEffects.ts:56-74, 104-121` — goal
  轮询每 5s 无条件 `setActiveGoals(新数组)`，连带 session-goals effect 再发一次
  IPC、header/sidebar 树每 5s 白渲染。`markGoalResultSeen`（:76-102）无 in-flight
  guard 可重复触发。修复：结构比较后再 setState；mark-seen 加 in-flight Set。

### Low

- `[ ]` **GUI-9** · `gui/src/components/layout/sidebar/SidebarProjectReview.tsx:600`
  — `groupSessions(sessions)` 在 render body 直接算，折叠的 drawer 也算；
  全局列表同款调用有 useMemo（Sidebar.tsx:176）。修复：`useMemo`。
- `[ ]` **GUI-10** · `gui/src/components/layout/sidebar/types.ts:16` —
  `PROJECT_REVIEW_FALLBACK_NOW_MS = Date.now()` 模块加载时固定，桌面应用挂机
  数天后 7 天活跃窗口漂移。修复：改函数在消费点取值。
- `[ ]` **GUI-11** · `gui/src/components/overlay/CommandPalette.tsx:122-126` —
  内容搜索无 `.catch`：FTS 错误成 unhandled rejection 且残留上一查询结果。
- `[ ]` **GUI-12** · `gui/src/stores/runtime.ts:692-711` — warmup ready handler
  里的 no-op setState + 空 `if (current)` 块（stale 注释描述的功能从未实现）；
  `lib/bridge.ts:281-290` `BridgeClient.kill()` 零调用者。删除或补完。
- `[ ]` **GUI-13** · `gui/src/stores/sessions.ts:871, 961` — 顶部已静态 import
  runtime store，删除函数里多余的动态 `await import("@/stores/runtime")`。
- `[ ]` **GUI-14** · `ArchivedDialog.tsx:98-147, 356-388` ↔
  `EarlierDialog.tsx:95-162, 303-335` — 选择模式状态机 + 搜索过滤 + SearchBar
  逐字节复制，两处手工同步。抽 `useSessionSelectMode` + `SessionSearchBar`。

**已核查非问题**：listener 生命周期全部有 StrictMode `cancelled` 防护；
`activateSession` 双击 spawn 竞态被 `spawning` 同步置位串行化；流式热路径
隔离良好（仅 GUI-7 的 memo 被击穿）；`rowsToTurns` O(n)；rAF/timer 清理正确；
en/zh i18n key 对齐。

---

## cli/（Rust CLI）

### High

- `[ ]` **CLI-1** · `core/src/db/goal.rs:291` + `cli/src/goal/signals.rs:166-208`
  等 — 全部 goal 信号逻辑跑在截断的 50 事件窗口上（`ORDER BY id DESC LIMIT 50`），
  controller 当全量历史用：worker 结果信号丢失（空转到 deadline）、checkpoint
  去重失效（controller.rs:640-650）、轮次计数错乱 → fallback scope 冲突静默
  不建任务（controller.rs:766-777, 841）、check report 从 planning prompt 消失
  （prompts.rs:8-21）。controller 自己每空转周期还写 Synthesis 事件把真实
  worker 事件挤出窗口（见 CLI-9），问题自我放大。
  修复：信号计数/marker 存在性改用专门 DB 查询或 since-id 游标。
- `[ ]` **CLI-2** · `cli/src/goal/controller.rs:304` + `cli/src/project.rs:465-479`
  — `project_follow --until-idle` 会因用户在同 project 其他 session 聊天而无限
  重置 quiet window，goal controller 空等烧 budget；`?` 还使任何 project-follow
  错误直接中止 goal。修复：只 follow master + worker session ids。

### Medium

- `[ ]` **CLI-3** · `cli/src/goal/signals.rs:274-303` — worker 关停 fallback 在
  tracked 列表为空（resume 后必然）且窗口驱逐后，回退为「project 内全部非
  master session」→ `shutdown_goal_worker_runners`（controller.rs:1259-1278）
  杀掉用户无关的活 runner。修复：worker session ids 持久化到 goal（DB）。
- `[ ]` **CLI-4** · `cli/src/goal/controller.rs:1259-1278, 1323` +
  `mod.rs:85-97` — 清理错误用 `?` 中止 master synthesis，一个瞬时 socket 失败把
  成功的 goal 标 Failed。清理应 best-effort（收集错误继续），仅 synthesis 失败
  才 fail。
- `[ ]` **CLI-5** · `cli/src/transport.rs:12-98, 175-209` — socket 传输零超时：
  core 假死时每条 CLI 命令无限挂起零输出，驱动 agent 无法区分「慢」和「死」。
  修复：connect + 首响应包 `tokio::time::timeout`，报「core 无响应」类错误
  （watch 流首帧后豁免）。
- `[ ]` **CLI-6** · `cli/src/goal/controller.rs:1280-1313` + `mod.rs:85-97` —
  synthesis 300s 硬超时把仍在生成最终答案的 goal 判 Failed（synthesis prompt
  可带 300k 字符 anchor，超 300s 现实存在），且用 stale 的 pre-run status 覆盖。
  修复：自适应超时；超时记「synthesis timed out, check master session X」保持
  Wrapping 而非 Failed。
- `[ ]` **CLI-7** · `cli/src/session.rs:295-321` — `session wait` 的
  `has_agent_output` 接受 tail 中任何已有 agent 消息，多轮 session 上 send→wait
  立即返回上一轮答案。docs/agent-api.md §5.5d 有 codify，属 spec 级陷阱。
  加法修复：`--after-turn` 或 baseline 初始 tail 等增长。

### Low

- `[ ]` **CLI-8** · `cli/src/session.rs:327-361` — `session wait` 不检查 session
  状态，error/cancelled 的死 session 烧满 300s 才返回。提前结束并带独立终态
  `status`（加法）。
- `[ ]` **CLI-9** · `cli/src/goal/decision.rs:36-38` + `controller.rs:1102,
  467-524, 264-265` — wave-cap wrap 不可达（`WaitForSignal` 分支先于
  `all_worker_slots_capped` 检查返回）；空转周期重复写近似相同的 Synthesis
  事件（喂大 CLI-1）；`Continue`/`WaitForSignal` 臂不可达（`budget_left=false`
  硬编码）。
- `[ ]` **CLI-10** · `cli/src/main.rs:37` — `Cli::parse()` 使 clap 解析错误以
  人类文本走 stderr，违反模块自文档的「错误 JSON 走 stdout」契约，解析 stdout
  的 SOP 看不到任何东西。改 `try_parse()` → `invalid_args` JSON envelope。
- `[x]` **CLI-11** · `cli/src/goal/prompts.rs:228` — workspace 文件列举中
  `std::fs::read_dir(&dir).ok()?` 使任一子目录不可读即丢弃整个 listing，
  synthesis 把文件交付物当不存在。改 `continue` 跳过。
  **已修 2026-07-02**：仅根目录不可读返回 None，子目录失败 `continue`。

**维护性备注**：CLI 正确复用 `galley_core_lib` 的类型（无手工协议复制）；
残余风险是命令名/参数 key 两侧裸字符串字面量（`cli/src/session.rs` vs
`core/src/socket_listener/mod.rs:510-537`），core 定义共享 const 可消除。
**测试缺口**：50 事件窗口交互（CLI-1）、controller 循环状态转换、传输挂起、
`session wait` stale-completion、malformed watch frame 均无测试；CLI-1/9 是
现有测试风格就能覆盖的纯函数场景。

---

## runner/（Python bridge）

### High

- `[ ]` **RUNNER-1** · `runner/workbench_bridge.py:1345-1363, 1282` — Abort 不
  解决 pending approval：GA 线程阻塞在 `pending.event.wait(timeout=600)` 内，
  `agent.abort()` 无法打断。用户点 Stop → UI 显示空闲 → 新消息静默排队最长
  10 分钟。修复：Abort/Shutdown 时 `resolve_all("deny")` 全部 pending。

### Medium

- `[ ]` **RUNNER-2** · `runner/workbench_bridge.py:1312-1325, 1076-1091` —
  `/session.x=v` slash 命令走 `display_queue` system 路径不触发 turn_end，
  `run_in_progress` 永不清除：`set_llm` 被拒、GUI spinner 永转直到手动 Stop。
  修复：drain 消费 `source='system'` 的 `done` 时清 run 状态 + 合成
  `run_complete`。
- `[ ]` **RUNNER-3** · `runner/workbench_bridge.py:1774-1779` — shutdown grace
  逻辑反了（`run_in_progress.wait(2.0)` 在跑时立即返回、空闲时白等 2s），后接
  100% CPU 忙等 drain loop，且「queue empty ≠ 已写入 flush」尾部事件仍可能丢。
  修复：writer 发 sentinel + 带超时 `join`。
- `[ ]` **RUNNER-4** · `runner/workbench_bridge.py:1401-1404, 1626-1631,
  1804-1806, 141-147` — 桌宠子进程仅在 ShutdownCommand 清理；stdin-EOF 路径和
  parent watchdog `os._exit(0)` 都不杀 pet → core 崩溃后 pet 孤儿存活占着
  41983 端口，下次 attach 失败。修复：EOF 路径与 `_exit_parentless` 前调
  `_handle_detach_pet(silent=True)`。
- `[ ]` **RUNNER-5** · `runner/workbench_bridge.py:74-84` — fd 1 只在 Python 层
  静默，OS 级 fd 1 仍指向 IPC 管道：GA 工具/插件 spawn 继承 stdout 的子进程或
  C 扩展写 fd 1 会注入垃圾破坏整个 session 的事件 framing。
  修复：dup 后 `os.dup2(devnull_fd, 1)`。
- `[ ]` **RUNNER-6** · `runner/workbench_bridge.py:1364-1379` — `load_history`
  无 run-in-progress guard（对比 `_handle_set_llm` :1414-1421 有），mid-run
  替换 history 会让 agent loop 读写被换掉的列表。修复：镜像 set_llm 的拒绝。
- `[ ]` **RUNNER-7** · `runner/workbench_bridge.py:1350-1363 vs 1211-1224` —
  abort（命令线程）与 `_on_turn_end`（agent 线程）的 check-emit-clear 无共享锁，
  自然完成撞上 Stop 会双发 `run_complete`，第二发的 telemetry 基线已被清。
  修复：小锁或 Event-swap 保护。

### Low

- `[~]` **RUNNER-8** · `runner/handlers.py:140-176` + `workbench_bridge.py:944,
  899-900` — attach 模式两处超出 AGENTS.md 列举的集成点（Handler 做了 approval
  以外的 turn-start UX 信号；给外部 GA agent 设私有属性 `_ga_project_mode_*`）。
  均为内存内/只读、未写 GA 文件，但按「规范可疑先改文档」应把它们加进允许列表
  或记录为耦合点。**需文档决策**。
- `[ ]` **RUNNER-9** · `runner/managed_runtime.py:153-158, 164-169` — 重复的
  `chatgpt_codex_oauth` 配置块（advancedOptions merge 前后各一份），已开始漂移。
  合并为单个 post-merge 块。
- `[ ]` **RUNNER-10** · `runner/managed_im_supervisor.py:380, 474` — 两处
  try/except/finally 后不可达的 `return 0`。删除。
- `[ ]` **RUNNER-11** · `runner/workbench_bridge.py:455-469` — `_FenceFilter`
  的 `carry` 在 drain 线程遇 `done` 退出时不 flush，末尾最多 5 字符反引号内容
  从流式视图截断（canonical turn_end 不受影响，纯视觉）。加 `flush()`。

**已核查非问题**：Windows stdin 编码已处理（core 对每个 Python spawn 设
`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`）；external-GA workspace guard 正确
阻止写入用户 GA checkout；managed-only patch 正确 gate 在
`is_managed_runtime()` 后。
**测试缺口**：`Bridge.run()`/`_stdin_reader`/`_stdout_writer` 关停顺序、
abort-while-approval-pending（RUNNER-1）、slash 命令 run 状态清理（RUNNER-2）、
pet 异常退出生命周期（RUNNER-4）均无非 e2e 测试；可用现有 `FakeAgent` 模式 mock。
