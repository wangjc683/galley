# Galley 并发阻塞审计 · 2026-07-04

> 预防性审计（无观测症状）。范围：Rust core（`core/` + `cli/`），明确排除
> GUI 渲染层与 Python runner 内部。方法：四路并行静态精读（session/子进程
> 管理、socket/CLI 传输、DB 层与启动同步热点、后台 daemon 与网络模块），
> 每条 finding 追调用链坐实后才收录；P0 由主审复核源码确认。
> 承接 [codebase review 2026-07-02](../codebase-review-2026-07-02/README.md)
> ——该轮已修的并发问题（CORE-3/4/5/6、CLI-4/5/6）本轮验证均完好。

## 审计基准

产品承诺定义了严重度：

- **P0** = 一条 session 或一个客户端可以拖垮其他 session / 前端
- **P1** = 功能自身可无限卡死或明显劣化（他人不受累）
- **P2** = 理论性 / 需异常条件 / 仅自伤且有界

上限事实：活跃 runner LRU 池上限 20；GUI（Tauri command）与 CLI（socket）
共享同一 `GalleyApi` 实现与同一 `RunnerManager`。

## 总体判定

架构健康，隔离承诺在常规路径成立。最关键不变量**成立**：每子进程有独立
stdout/stderr 读取任务，broadcast `send` 非阻塞（容量 1024，溢出丢旧帧），
慢消费者永远不会反压到子进程管道。找到 1 条 P0 冻结链、4 个 P1、若干 P2，
修复成本均低。

## Findings

### P0

- `[x]` **CONC-1** · 一条 wedged session 可冻结整个 orchestrator（双缺陷链）
  - **缺陷 A** `core/src/runner_manager/manager.rs:147-152`（`pid`）、
    `:157-165`（`agent_running`）、`:198-203`（`subscribe`）：持外层
    `RwLock<HashMap>` 读保护跨 per-session `Mutex` 等待。同文件
    `send_command`（:206-223）与 `stderr_tail`（:227-234）已按正确纪律
    clone Arc + `drop(map)`，注释明言原因——纪律不一致而非设计缺陷。
  - **缺陷 B** `core/src/runner_manager/process.rs:375-397`：`send_command`
    的 stdin `write_all`/`flush` 无超时，且在 per-session Mutex 内。
  - **链条**：runner 假死不读 stdin（SIGSTOP / swap / native 卡死；Python
    侧有专职 stdin reader 线程，故仅进程级 wedge 触发）+ 单条命令 >64KB
    管道缓冲（`LoadHistory` 或 goal synthesis prompt，后者常规 28k-300k
    字符）→ 写永久挂起持 Mutex → 对该 session 的 `watch`/`stop` 走缺陷 A
    卡住且持读保护 → 任一 spawn/shutdown 排队写锁 → tokio RwLock 写优先，
    此后**所有**读者排队：20 session、GUI、CLI、退出清理全冻结。
    `enforce_cap`（manager.rs:310）逐 session 调 `agent_running`，即新开
    第 21 条 session 的路径会主动撞进假死 session 的锁。
  - **动态验证**：`kill -STOP` bridge A → 发两条 >64KB 命令 → `session
    watch A` → `session new` → 断言后续任意 `session send B` 超时不返回。
  - **修复**：缺陷 A 三方法照抄 clone+drop 模式；缺陷 B stdin 写加
    `tokio::time::timeout` 映射 `SendCommandError::WriteIo`。两头都断。
  - **已修 2026-07-04**：A——`pid`/`agent_running`/`subscribe` 改为 clone
    Arc + drop(map) 后再取 per-session 锁；B——stdin write+flush 整体包
    15s `STDIN_WRITE_TIMEOUT`，超时映射 `WriteIo` 并附「wedged runner」
    detail。新增集成测试 `send_command_times_out_when_child_stops_reading`
    （mock 子进程停读 stdin + 灌满管道，断言有界返回）与
    `wedged_session_does_not_block_other_sessions`（A 假死持锁、queue 上
    reader + spawn 写者后，断言 B 的 `send_command` 仍在 5s 内完成）。

### P1

- `[x]` **CONC-2** · `core/src/codex_oauth.rs:1230-1241` — Unix credential-IPC
  accept 循环 `let Ok(..) else break`，一次瞬时 accept 错误（fd 耗尽
  EMFILE/ENFILE，20 子进程 + socket + 管道下真实可发生）永久杀死凭据
  服务；`CREDENTIAL_IPC_SINGLETON` 缓存死地址，所有 managed 模型凭据获取
  失败直到重启。Windows 孪生分支（:1261-1284）已为同一问题修过（500ms
  退避 + 注释记录教训），Unix 分支漏网——同 pattern 双实现只修一处的
  典型漂移。**修复**：镜像 Windows 分支的退避重试。
  **已修 2026-07-04**：Unix accept `Err` 分支改 500ms 退避 + `continue`，
  日志对齐 Windows 分支措辞。
- `[x]` **CONC-3** · `cli/src/goal/controller.rs:383-401` +
  `cli/src/project.rs:436-510` — `project_follow(until_idle)` 无外层超时：
  一个 worker 停在 `Running` 且 bridge 静默（LLM 挂起 / 工具 wedge / 状态
  行陈旧）时 quiet-window 永远重置，控制回不到主循环，预算/deadline
  永不执行，goal 永不收口。控制器其余等待全部有界（规划 180s、synthesis
  ≤900s、wave ≤50），这是唯一无界边。**修复**：加预算感知外层超时。
  **已修 2026-07-04**：follow 阶段包 `tokio::time::timeout`（剩余预算 +
  5min 宽限，下限 60s），超时视同 idle 返回主循环，由既有预算逻辑接管
  收口；写一条 System goal event 说明 follow 超时。
- `[x]` **CONC-4** · `core/src/db/search.rs:30-80` — `backfill_fts_if_empty`
  单事务 `DELETE + INSERT..SELECT` 全量重建 trigram FTS：10 万消息级持写锁
  数秒到数十秒，期间 IM supervisor / socket session 的写全部撞 5s
  busy_timeout 报错。触发条件：FTS 计数漂移 + 大历史 + hydrate 时并发写。
  **修复**：分批小事务重建。
  **已修 2026-07-04**：改为每批 500 行独立事务（keyset 分页，
  `BEGIN IMMEDIATE`），批间让出写锁；每批按 id 区间 delete-then-insert
  （FTS5 的 `message_id` 是 UNINDEXED、无 UNIQUE 约束，`INSERT OR
  REPLACE` 会退化成纯 INSERT），兼防重建期间 live 索引写入造成的重复行；
  触发条件不变，中途崩溃后重跑收敛。新增测试
  `backfill_fts_rebuilds_full_index_in_batches`（2000 行跨 4+ 批全量
  重建 + 幂等 + 跳过规则）。
- `[x]` **CONC-5** · `core/src/socket_listener/mod.rs:356-400` +
  `cli/src/transport.rs:90-94, 210-215` — Windows 命名管道 accept 空窗
  （上一连接 `connect()` 返回后才创建下一实例）+ CLI 单次 `open()` 不重试
  `PIPE_BUSY` → 并发连接（goal controller 一次开 4+ watch）拿到假的
  「Core not running」exit 4。core 自身启动探测已重试 5×（mod.rs:220-245），
  transport 层未同步。**修复**：CLI 连接加 PIPE_BUSY 重试。
  **已修 2026-07-04**：`cli/src/transport.rs` Windows 连接路径加
  `ERROR_PIPE_BUSY`/NotFound 短退避重试（100ms × 10），对齐 core 启动
  探测语义；Unix 路径不变。

### P2（本轮仅修 CONC-8；其余记录在案，按顺手程度处理）

- `[ ]` **CONC-6** · `core/src/runner_manager/manager.rs:94-117` — 同
  session 并发 `spawn` 在 remove/insert 两段写锁之间有 await 空隙：双方都
  过 remove、各自 spawn，后 insert 静默 drop 前者的 `RunnerProcess`；因
  reader task 持 Child Arc，`kill_on_drop` 不触发 → 泄漏一个脱管活进程且
  不占 LRU 名额。触发需 GUI `spawn_runner` 与 socket
  `ensure_goal_synthesis_runner` 竞速。
- `[ ]` **CONC-7** · `core/src/socket_listener/mod.rs:469` +
  `core/src/runner_commands.rs:528-537` — `session.watch` 对
  `RecvError::Lagged` 静默 `continue`，supervisor 消费流丢事件零信号；
  GUI 侧注释说要发结构化警告，实现只 `eprintln!`。建议发一行
  `StreamEnvelope` "lagged N" 通知。
- `[x]` **CONC-8** · `gui/src/lib/ipc-handlers.ts`（`persistTurnEndToMessages`
  / `persistToolEventPendingFromIPC`）— persist 失败仅 `console.debug`，
  任何 DB busy 错误 = 静默丢一条 turn 行。是 CONC-4 / CONC-9 / CONC-10 的
  共同放大器。
  **已修 2026-07-04**：persist 路径加短退避重试（3 次，200/500/1000ms，
  仅对 busy/locked 类错误；错误经 `stringify_error` 以字符串到达 JS，
  分类器按小写子串防御性匹配），最终失败升级 `console.error` 并带
  session/turn/approval 标识，不再静默。新增 4 个 vitest 用例覆盖重试/
  不重试/放弃路径。
- `[ ]` **CONC-9** · `core/src/db/session.rs:411-458, 883-944` — 附件文件
  写（≤25MB `tokio::fs::write`）在 `BEGIN IMMEDIATE` 写事务内，慢盘上
  持写锁超 5s 会让并发 persist 报 busy。修法：先写文件后开短事务。
- `[ ]` **CONC-10** · `core/src/db/goal.rs:170`、
  `core/src/db/managed_model.rs:196, 287` — DEFERRED 事务先读后写，撞上
  并发写提交时 `SQLITE_BUSY_SNAPSHOT` **不经 busy_timeout 直接报错**。
  一行改 `begin_with("BEGIN IMMEDIATE")`。低频操作，报错不卡死。
- `[ ]` **CONC-11** · `core/src/runner_manager/process.rs:320` 等 —
  子进程 stderr 逐行 `eprintln!`（+ spawn 性能日志等）：若 core 自身
  stderr 是无人读的管道（wrapper 脚本 / CI 启动），std stderr 全局锁 +
  阻塞写可级联卡死整个 app。正常启动（Finder/terminal/launchd）无害。
  长期修法：接结构化日志层替代裸 eprintln。
- `[ ]` **CONC-12** · 写路径无超时三处 — core `write_resp`
  （`socket_listener/mod.rs:493-504`）/ `write_stream_line`
  （`wire.rs:105-114`）：客户端停读则该连接任务永久泊住（fd+task 泄漏，
  不伤他人）；CLI `write_all`（`transport.rs:51-68`）：大 payload 对
  wedged core 无限挂起（读超时尚未武装）；credential-IPC 连接读无 90s
  类 deadline（`codex_oauth.rs:1352-1360`）。
- `[ ]` **CONC-13** · `core/src/runner_manager/manager.rs:122` — LRU 驱逐
  内联在 `spawn`：第 21 条 session 的打开要先付受害者最多 ~8s（3s 优雅 +
  5s kill）关停等待。无锁跨等待、不伤他人，纯 UX 延迟。可改后台驱逐。
- `[ ]` **CONC-14** · 杂项有界项 — 请求行缓冲无长度上限
  （`mod.rs:412-414`，90s idle 超时兜底，本地可信面）；FTS 2 字符/
  fallback 路径全表 `LIKE` 扫描（`search.rs:132-175`，占 1/4 连接数百
  ms）；IM 生命周期锁跨有界子进程操作（quit/更新最多等 ~5-8s/平台，
  `im_supervisor.rs:200`）；`set_slot` 持 slots 锁 emit
  （`im_supervisor.rs:589-597`，与同文件其他 emit 点纪律不一致）；
  `ensure_layout` / browser 扩展布局 / auth.json 同步 fs 在 runtime 线程
  （小文件，慢网络卷才成问题）；im/oauth 模块 34 处每操作
  `SqliteGalley::open()` 新建 4 连接池（浪费但零竞争，宜迁共享池）。

## 查证为干净的面（同等重要）

- **管道排空不变量**：stdout/stderr 每子进程专职任务终身排空
  （process.rs:235, 317）；EOF 后 `try_wait` 200ms 轮询避免锁内 `wait()`
  （:275-291，07-02 修复完好）；broadcast 非阻塞 → 慢消费者不反压子进程。
- **锁纪律（除 CONC-1 三方法外）**：spawn/shutdown/shutdown_all 均在慢
  等待前释放 map 写锁（manager.rs:94-97, 245-248, 271-274）；锁序
  processes → lru_order 有文档且被遵守；`any_agent_running` 正确
  clone-then-drop。
- **传输隔离**:Unix accept 每连接独立 spawn,accept 错误 100ms 退避;
  slowloris 被 90s `CONNECTION_IDLE_TIMEOUT` 包住整个 `next_line` future,
  滴流字节无法续命;单连接慢命令只阻塞自己。
- **DB 配置**：WAL + `synchronous=NORMAL` + `busy_timeout=5s` +
  4 连接池 OnceCell 单例（db/mod.rs:78-124）；读不排队写后。
- **热写路径**：streaming 零 DB 写（emit-only），持久化按 turn/工具事件
  粒度，20 忙 session ≈ 每秒几个小 commit，远低于 SQLite 上限。
- **启动同步热点全部无害**：`migration_backup.rs`（3 入口仅 lib.rs
  `.setup()` 调用，grep 全库验证）、lib.rs 3 处 `block_on`、tray/discovery
  的 std Mutex——均在 event loop 服务前或不跨 await。
- **codex_oauth 刷新设计正确**：per-credential 门 + 双检 + 20s HTTP 超时，
  并发去重有测试覆盖；无跨 await 的 std Mutex。
- **07-02 修复完好**：IM 生命周期互斥（含 stop_locked 复用）、shutdown
  超时覆盖锁获取、respawn kill 兜底、Windows accept 重建退避、CLI
  connect/首响应超时。
- **goal controller**：除 CONC-3 外所有轮询 0.5-2s sleep、所有等待有界；
  重入由非阻塞 fs2 文件锁守卫。

## 动态验证（建议后续补,本轮未做）

静态审计的固有盲区是时序与量级。值得补的三个动态实验：CONC-1 修复回归
（SIGSTOP + 满管道场景，已随修复落为集成测试）；20 session 全忙 streaming
时 CLI 命令延迟分布（复用 `scripts/perf-galley.py` 基线思路）；10 万消息
库上 FTS 重建耗时与 busy 错误计数（CONC-4 修复验证）。
