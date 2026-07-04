# B4 M1 · CLI 写命令补齐 sub-plan

> 用途：B4 playbook [M1](./B4-cli-bg-artifact.md#m1--cli-写命令补齐-d51-d54) 启动前的详细实施 plan，mirror B3 M3/M4/M5/M6 sub-plan 结构。M1 是 **B4 第一个 milestone** —— 补齐 PRD §11.1 全部 write CLI 命令。
>
> **状态**：drafted 2026-05-20 morning · 6 open decisions resolved 2026-05-20 afternoon (JC review)。本 session ship sub-plan markdown，不动代码。M1 实施推 fresh session（per B3 N5 / N10 / N14 教训：sub-plan + 实施分两 session 是稳定模式）。M1 实施不需要等 tray spike（M2 prereq），跟 [M2 spike scaffold + run](../../../core/experiments/tray-mode/README.md) 完全独立可并行。
>
> **关键决策**（含 2026-05-20 PM resolved）：**4-commit M1**（按 noun-group 拆 + 单独 agent-api commit）+ **session stop 映射到 Abort 不 Shutdown** + **btw 不持久化 v0.1 保持** + **exit code 引入 5=runner_error**（PRD §11.2 已说，agent-api.md 漏 row，本 milestone 补）+ **session new 走 SQLite transaction wrap** (O1 resolved — eliminates partial state) + **`project archive` 改名 `project delete`** (O2 resolved — honest naming，PRD §11.1 同步更新) + **`project move` 改 `session move <id> --to=<pid>`** (O3 resolved — noun=verb subject grammar，PRD §11.1 同步更新)。详 §2 + §1.4 + §1.5 + §9。

---

## 1. Scope re-assessment vs playbook

| Playbook claim | 实际验证 |
|---|---|
| T1.1-T1.6 「7 个新 write 命令」 | **实际 11 个 CLI 子命令**：playbook 把 `project create / list / move / archive` 算 1 个，`llm list / llm set` 算 1 个。逐 subcommand 算：`session new` / `session btw` / `session stop` / `session archive` / `session restore` / `project create` / `project list` / `project move` / `project archive` / `llm list` / `llm set` = **11 个**。Sub-plan 内 T1.1-T1.11 per-subcommand 拆 |
| T1.1 「`create_session_with_first_message` — 复用 M4 create_session + B2 send_message，组合成 atomic 操作」 | 验证 [api.rs:112-116](../../../core/src/api.rs) `create_session(input, origin)` + [api.rs:79-84](../../../core/src/api.rs) `send_message(session_id, content, origin)` 都已存在。组合发生在 socket handler 内（**不**新加 trait method）—— 两步 SQL 写在同一 socket handler 顺序调用，race condition 概率低于「socket dispatch 内串行」(原 playbook 建议 trait-level atomic 是 over-engineering，详 Reject #2) |
| T1.2 「`session btw` 加 `via='cli' + kind='btw'` 区分」 | **错** —— btw 不应持久化 messages 行（v0.1 决策 [messages.ts:445-455](../../../gui/src/stores/messages.ts) "Transient append — no DB persistence for V0.1")。Runner 端 [workbench_bridge.py:943-948](../../../runner/workbench_bridge.py) 检测 `/btw` 前缀走 `handle_frontend_command` 旁路，不进 messages.append。M1 `session btw` 走 socket 把 `/btw <q>` 文本直 emit IpcCommand::UserMessage（runner 自动识别）+ **skip DB persist**。详 §1.5 |
| T1.3 「`stop_session` — runner_manager.shutdown_bridge + emit run_complete event」 | **stop 语义模糊** —— 用户期待 "停止当前 turn" (= IpcCommand::Abort) vs "整个 bridge 杀掉" (= IpcCommand::Shutdown / manager.shutdown)。**M1 决策走 Abort**：bridge 留活下次可继续 send；shutdown 是 LRU/Settings/Cmd-Q 才触发的硬终结，不该挂 CLI surface。详 §1.4 |
| T1.4 「`session archive / restore` 复用 M4 archive_session / unarchive_session」 | 验证 [api.rs:122 + 128](../../../core/src/api.rs) 都已存在 + 都接 Origin 参数。直 thin wrapper |
| T1.5 「`project` 4 subcommand 复用 M4 trait method」 | 验证 [api.rs:245-273](../../../core/src/api.rs) `list_projects` / `create_project` / `update_project` / `delete_project` 全在。**`project move` 语义歧义**：PRD 写「project move」自然语言指「移动 project 自身」（不存在的操作）vs「把 session 移到 project」（= `assign_session_to_project`）。M1 解读为后者，CLI 形态 `galley project move <session-id> [--to=<project-id>]`，no `--to` flag = 拆出 project（[O3 NEW](#open-decisions-new) 复核命名）。**`project archive` 不存在 trait method**：B3 M4 只给 delete，没有 archive；B4 内不该补 schema 加 archived 字段（scope creep）。M1 解读 `project archive` = `delete_project`（CLAUDE.md PRD §11.1 「archive vs delete 语义」playbook 已 flag）+ CLI confirm 守则交给 SOP（[O4 NEW](#open-decisions-new)） |
| T1.6 「`llm list` 在 bridge 未 alive 时报 exit 4」 | **方案不一致**：`llm list` 不一定需要 bridge alive —— prefs 持有 `getPref<LLMOption[]>("llm_list")` cache（[hydrate.ts:73-80](../../../gui/src/lib/hydrate.ts) 启动时 seed runtimeStore）。CLI 读 prefs 表（同一 SQLite）就能拿到 cached LLM 列表，跟 bridge 完全无关。**M1 走 SQLite read** — `llm list` 直走 prefs cache，不依赖 socket / bridge。**`llm set`** 才需要 bridge 应用变更：DB 写 `set_session_llm` + 如 bridge alive 同步 emit `IpcCommand::SetLlm`。详 §1.6 |
| T1.7 「`agent-api.md` 增量写入 — 每个命令 ship 时同 commit 加 schema 段」 | OK，每个 noun-group commit 内 inline 写 agent-api.md 段。但 **exit code 表 [agent-api.md:166-172](../../../docs/agent-api.md) 当前只有 0-4，PRD §11.2 说有 5=runner_error**。M1 决策走 PRD 加 5，**整段独立 commit** ship 在 noun-group commits 之前作为 M1 prerequisite（详 §2.3） |
| T1.8 「CLI integration tests」 | 验证 [cli/tests/](../../../cli/tests/) 当前有 ~13 integration test (B1 6 + B2 7)。M1 加 11 个新 subcommand × 1-2 test/cmd = +15-22 tests |

### 1.1 11 个 subcommand 清单

> **2026-05-20 PM update**: rows 6 (session move 新增) / 8 (project move retired→session move) / 9 (project archive renamed→project delete) reflect O2+O3 resolutions。Row 1 atomic-ish 改 atomic via SQLite transaction (O1 resolved)。**总数仍 11**（lose project.move + add session.move + rename project.archive→delete）。

| # | CLI surface | trait method | Origin? | socket route | Notes |
|---|---|---|---|---|---|
| 1 | `session new "<task>" [--project=X] [--llm=...] [--supervisor=Y] [--reason=Z]` | `create_session` + `send_message`（socket handler 内 SQLite transaction wrap）| ✓ | `session.new` | **Atomic**: BEGIN → create_session → send_message → COMMIT；任一 SQL 失败 → ROLLBACK + exit 5 runner_error；无 partial state (O1 resolved) |
| 2 | `session btw <id> "<q>" [--supervisor=Y]` | (none — runner-only) | ✓ (audit-only) | `session.btw` | **skip DB persist**；socket emit `IpcCommand::UserMessage` with content=`/btw <q>`；no Origin SQL write |
| 3 | `session stop <id> [--reason=Z]` | (manager-only) | (audit-only) | `session.stop` | emit `IpcCommand::Abort`（**not** Shutdown）；bridge 留活下次 send 可继续 |
| 4 | `session archive <id> [--supervisor=Y] [--reason=Z]` | `archive_session` | ✓ | `session.archive` | thin wrapper |
| 5 | `session restore <id> [--supervisor=Y] [--reason=Z]` | `unarchive_session` | ✓ | `session.restore` | thin wrapper；CLI 名 PRD = `restore`，trait 名 = `unarchive`（[G1 playbook 已记](./B4-cli-bg-artifact.md#running-notes--gotchas)）|
| 6 | `session move <id> [--to=<project-id>] [--supervisor=Y]` | `assign_session_to_project` | ✓ | `session.move` | **(O3 resolved)** noun=verb subject (session 是 move 的主语，不是 project)；no `--to` = 拆出 project (project_id=None)；PRD §11.1 同步改 |
| 7 | `project create "<name>" [--description=...] [--supervisor=Y]` | `create_project` | ✓ | `project.create` | thin wrapper |
| 8 | `project list` | `list_projects` | — | (direct SQLite read, no socket) | thin wrapper；返 NDJSON；mirror sessions list 路径 |
| 9 | `project delete <project-id> [--supervisor=Y] [--reason=Z]` | `delete_project` | ✓ | `project.delete` | **(O2 resolved)** v0.2 rename from `project archive` → `project delete`；honest naming (实际 SET NULL detach + DELETE)；FK CASCADE 保 sessions intact (per [api.rs:268-270](../../../core/src/api.rs))；v0.6+ 再 ship 真 `project archive` reversible 语义；PRD §11.1 同步改 |
| 10 | `llm list` | (SQLite read prefs) | — | (direct DB read, no socket) | 读 `prefs.llm_list` pref；空 → empty NDJSON；不报错 |
| 11 | `llm set <session-id> <llm-display-name>` | `set_session_llm` + (optional) bridge emit | — (no audit per existing pattern) | `llm.set` | DB write SessionBrief；如 bridge alive emit `IpcCommand::SetLlm`；by-name lookup against cached list |

### 1.2 Origin 字段填法（[origin.rs:1-113](../../../core/src/api/origin.rs)）

socket handler 内统一规则（mirror dispatch_session_send pattern）：

```
via = if supervisor.is_some() { OriginVia::Supervisor } else { OriginVia::Cli }
supervisor = args.supervisor.clone()
reason = args.reason.clone()
```

**例外**：
- `llm.set` no Origin（trait 不接，per existing pattern [api.rs:184-189](../../../core/src/api.rs)）
- `project.list` / `llm.list` no Origin（read 路径）
- `session.btw` / `session.stop` socket 接收 supervisor/reason 但**不写 DB**（只用于 runner-side audit log，B4 M7 GUI 行动日志渲染时读这些字段）—— 占位 path，runner 端是否能存进 audit 留 [O5 NEW](#open-decisions-new)

### 1.3 Exit code 表更新

PRD §11.2 #3 列 6 类: `0=success / 1=generic / 2=invalid args / 3=not found / 4=backend unavailable / 5=runner error`。agent-api.md §3 当前只列 0-4。

M1 加 row：

| Code | Category | When |
|---|---|---|
| `5` | `runner_error` | bridge process unreachable / IPC dispatch failed after persist succeeded (e.g. `session stop` 时 bridge 已 dead) |

**Mapping decisions**：
- `session new` socket #1 fail (create_session) → 沿原映射 (`not_found` / `invalid_args` / `db_unavailable`)
- `session new` socket #2 fail (send_message) → 同上（已 persist session 行但未 send first message — CLI 仍 exit 0 with warning in response payload，sub-plan §3.1 R3）
- `session btw` runner emit fail → exit 5（runner_error）
- `session stop` runner emit fail (bridge already dead) → exit 0 with `dispatch=already_stopped` 字段（idempotent）
- `llm set` bridge emit fail (alive bridge IPC failed) → exit 5；no bridge alive = exit 0 with `dispatch=persisted_only`（DB 写成功，bridge 下次 spawn 读 DB 拿新 llm）

**GalleyError 加 variant**：`RunnerError { message: String }` → exit 5 + error tag `runner_error`。在 §3.0 prerequisite commit 一并落地。

### 1.4 `session stop` 语义 · Abort vs Shutdown

**Abort** ([ipc.rs:313](../../../core/src/ipc.rs))：GA's `agent.abort()` 设 stop_sig + 跳出 run loop；synthesize `run_complete` event with `ABORTED` marker (per [workbench_bridge.py:975-980](../../../runner/workbench_bridge.py))。Bridge **仍活**。下次 `session send` 直接接上，无需 respawn (5-10s startup cost)。

**Shutdown** ([ipc.rs:318](../../../core/src/ipc.rs))：runner subprocess 真退出。LRU eviction / 用户改 GA path / Cmd+Q 时用。下次 send 必须 respawn。

**M1 决策**：`session stop` 走 **Abort**。理由：
1. 用户语义：「停一下这个 turn 我想看看 / 我想改 prompt」≠「彻底关掉这个对话」
2. 跟 GUI 行为对齐：GUI `MainView.tsx` 顶栏 "停止" 按钮 emit Abort（[grep result indicates current GUI stop = Abort 路径](../../../gui/src/components/screens/main/MainView.tsx)）
3. Shutdown 是 system-driven 操作（LRU + lifecycle），不该挂 user-facing CLI surface
4. CLI 加 `session kill` 是另一档 destructive ops，留 [O6 NEW](#open-decisions-new) v0.6+ 再加（避免 v0.2 surface 过度复杂）

`session stop` 在 bridge 已 dead 时的行为：socket 内 `manager.agent_running()` 检查，false → 返 `{dispatch: "already_stopped"}` exit 0 (idempotent)；true → emit Abort + 返 `{dispatch: "abort_sent"}` exit 0。

### 1.5 `session btw` 持久化决策

V0.1 决策（messages.ts:445-455）：btw 不进 messages 表，重 session 后 /btw 对话整段丢。这是设计意图（"side question 不进主线"）。

M1 沿用：`session.btw` socket handler **不**调 `send_message` trait method。直接 emit `IpcCommand::UserMessage{ text: "/btw <q>" }` 给 runner —— runner [workbench_bridge.py:943-948](../../../runner/workbench_bridge.py) 自动识别 `/btw` 前缀走 `handle_frontend_command` 旁路。

**Origin 字段**仍接 `--supervisor=` + `--reason=` flag (CLI surface 对称) 但 socket handler 内只透传给 `IpcCommand::UserMessage` 的 origin metadata（runner-side audit），**不**写 DB。

**Open**: B4 M7 supervisor 行动日志 GUI 渲染时是否需要看到 supervisor 的 btw 调用？如需要，runner-side emit `BtwDispatchedEvent { supervisor, reason }` 让 Tauri event 流过 GUI。M1 内**不**实现 emit，留 M7 sub-plan 决定。

### 1.6 `llm list` 路径选择 · SQLite cache vs socket

**Option A · 走 socket**：CLI 调 `llm.list` socket command → core 调 `manager.alive_sessions()` 看是否有 ready bridge → 如有，读 ready event 的 `availableLLMs` 缓存；如无 spawn `__warmup__` bridge 拿 → 5-10s 延迟 + 占用 bridge 槽位。

**Option B · 走 SQLite prefs**：CLI 直读 `prefs.llm_list` (pref key 是 [hydrate.ts:75](../../../gui/src/lib/hydrate.ts) `getPref<LLMOption[]>("llm_list")` 用的同一 key)。延迟 < 50ms；不占 bridge 槽位；不依赖 Galley Core 运行。

**M1 选 B**：
1. PRD §11 「CLI surface 是 agent-first」—— agent 希望快速 query 不希望 5s wait
2. `llm list` 是 read 操作，走 SQLite 跟 B1 read commands 一致
3. cache miss (prefs 未写过) 返 empty NDJSON 是 reasonable degradation —— SOP 文档说「如 list 空请先在 GUI 起一次 session 让 warmup 写 cache」
4. 不需要 Galley Core alive（B4 整 phase 唯一不依赖 Core 的 write-adjacent 命令；inventory 命令已有此 property）

**Trade-off**：cache 可能 stale（用户改了 mykey.py 但 GUI 没起 session 触发 warmup）—— 接受，B4 M4 SOP doc 写明 "如疑 stale 请到 GUI Settings → Runtime warmup"。

`prefs.llm_list` 当前 key value JSON shape: `Vec<LLMOption>` = `[{index, name}]`。CLI 直 deserialize 输出 NDJSON。

### 1.7 `--llm=X` flag in `session new`

用户传 `--llm=glm-4.5-x`（按 display name），CLI socket 调 `session.new` with arg `llm_name: Option<String>`。Socket handler:

1. read prefs `llm_list` cache → find index where `name == llm_name`
2. found → CreateSessionInput 内 `llm_index = Some(found_index)`，create_session 写 DB
3. not found → exit 2 invalid_args "unknown llm '<name>'; try `galley llm list` to see available"
4. cache empty → exit 4 db_unavailable "llm cache empty; open Galley GUI once to warmup"

**Decision**：by-name lookup 而非 by-index。理由：(a) PRD 写「`--llm=...`」自然语言用 name (b) index 是 mykey.py 内部细节不该暴露 supervisor SOP (c) name 在 mykey.py 改顺序后稳定（per [bridge.ts _simplify_llm_name](../../../runner/workbench_bridge.py) 尊重用户显式 `name`）。

### 1.8 Cross-task 共用 helper

socket handler 内多处复用 (mirror dispatch_session_send pattern)：

```rust
// socket_listener.rs · 新 helper
fn origin_from_args(supervisor: Option<String>, reason: Option<String>) -> Origin {
    Origin {
        via: if supervisor.is_some() { OriginVia::Supervisor } else { OriginVia::Cli },
        supervisor,
        reason,
    }
}

// 错误映射 (already exists in dispatch_session_send body，提取出来共用)
fn map_galley_err(request_id: Option<String>, err: GalleyError) -> SocketResponse {
    match err {
        GalleyError::NotFound { message } => SocketResponse::err(request_id, "not_found", message),
        GalleyError::InvalidArgs { message } => SocketResponse::err(request_id, "invalid_args", message),
        GalleyError::DbUnavailable { message } => SocketResponse::err(request_id, "db_unavailable", message),
        GalleyError::Internal { message } => SocketResponse::err(request_id, "internal", message),
        GalleyError::RunnerError { message } => SocketResponse::err(request_id, "runner_error", message),
    }
}
```

§3 各 T 内 mention 复用。

### 1.9 `session new` SQLite transaction wrap 实现选择（O1 resolved）

`session.new` socket handler 需 atomic 把 create_session + send_message 两步 SQL 绑成一个 transaction。**两种实现路径**：

**Option A · 加 `*_in_tx` trait method 变体**

```rust
// api.rs · 新 method
async fn create_session_in_tx<'c>(
    &self,
    tx: &mut sqlx::Transaction<'c, sqlx::Sqlite>,
    input: CreateSessionInput,
    origin: Origin,
) -> Result<SessionBrief>;

async fn send_message_in_tx<'c>(
    &self,
    tx: &mut sqlx::Transaction<'c, sqlx::Sqlite>,
    session_id: SessionId,
    content: String,
    origin: Origin,
) -> Result<MessageBrief>;
```

socket handler:
```rust
let mut tx = galley.pool().begin().await.map_err(/* db_unavailable */)?;
let session = galley.create_session_in_tx(&mut tx, input, origin.clone()).await
    .map_err(|e| { /* tx auto-rollback on drop */ map_galley_err(...) })?;
let msg = galley.send_message_in_tx(&mut tx, session.id.clone(), task, origin).await?;
tx.commit().await.map_err(/* internal */)?;
```

**Option B · socket handler 内 inline SQL (no trait change)**

socket handler 内直 sqlx query call，不走 GalleyApi trait。Pro: 0 trait surface change；Con: 复制 200-300 行 SQL/validation 代码，跟既有 `create_session` / `send_message` impl 漂移风险高。

**M1 决策 · Option A**：trait surface 加 2 method 是有代价但合理（既有 owned-pool method 保留给 GUI Tauri command 路径用，不破坏 B3 调用方）；inline SQL 复制是反 DRY，长期 maintenance 成本高。

**实施 step (T1.1 prereq 内)**：
1. `SqliteGalley` 加 `pool()` accessor return `&SqlitePool` (already exists or trivial getter)
2. `api.rs` trait 加 2 `*_in_tx` method default impl `unimplemented!()` 是反 pattern → 设 trait 强制实现
3. `SqliteGalley` impl 把既有 `create_session` body 提取到 helper `do_create_session(executor: impl SqliteExecutor)`，两 method (`create_session` 走 pool / `create_session_in_tx` 走 tx) 都调 helper
4. `send_message` 同 pattern 拆 `do_send_message`
5. 既有 cargo test 不应 break（拆 helper 是纯 refactor）

**Verify before T1.1 实施**: SQLx version supports `Transaction<'c, Sqlite>` borrow pattern? (verify `core/Cargo.toml` sqlx feature flags). 0.8 已 support，B1 已用 0.8。

---

## 2. Commit shape · 4-commit M1

### 2.1 候选 split seams 评估

| Seam | 内容 | 问题 |
|---|---|---|
| **C-A · single commit** | 11 trait/handler + 11 CLI sub + agent-api §5.7-5.17 + ~20 tests | 1500+ LOC 单 commit。M5 messagesStore 1052 LOC 是上限实测，超过会 review 困难 + revert 半状态 |
| **C-B · per-subcommand 11 commit** | 每命令独立 commit | 多数命令是 thin wrapper（archive/restore/project.list/project.create 等），单独 commit 是 ceremony overhead；agent-api.md 11 次小 patch 难复审 |
| **C-C · 4 commit by noun-group** | (1) prereq: GalleyError variant + agent-api exit code 5 + origin helper; (2) session-write (new/btw/stop/archive/restore); (3) project + llm; (4) agent-api §5.7-5.17 + integration tests | **推荐**。每 commit 200-400 LOC；可独立 typecheck/cargo check；revert 1 个 noun-group 不影响其它 |
| **C-D · 2 commit (session+project / llm+api+test)** | 减少 commit 数 | 第一 commit ~700 LOC 仍偏大；agent-api 跟 impl 分开难 review schema 一致性 |

### 2.2 推荐 · C-C 4-commit

**理由**：
1. PRD §11.1 命令表自然按 noun 分 3 group (`session.*` / `project.*` / `llm.*`)，commits 跟分组对齐符合直觉
2. 每个 noun-group commit 自包含 (cargo test 全过 + CLI 主流程 dogfoodable)，可独立 ship 部分功能（commit #2 ship 后 `session.*` 已能用，commit #3 ship 后 project/llm 也能）
3. agent-api.md 跟 tests 单独 ship 让 schema review 跟 functional review 解耦（schema freeze 在 M6，本 commit 增量写 schema 不冻结）
4. prereq commit 单独 ship 让 GalleyError 加 variant 不混进任何 noun-group commit (mirror B2 M3 SocketResponse 单独 commit pattern)

### 2.3 sequencing

```
M1 sub-plan ship (本 session, 单 commit "Docs: B4 M1 sub-plan — CLI write commands + commit shape decision")
  ↓ JC review sub-plan
  ↓ (并行 OK) tray spike scaffold + run (M2 prereq, 独立)

M1.1 prereq commit (fresh session)
  - GalleyError::RunnerError variant
  - cli/src/main.rs map_error_tag 加 "runner_error" → RunnerError
  - cli/src/main.rs exit_code_for 加 RunnerError → 5
  - core/src/socket_listener.rs origin_from_args + map_galley_err helper 提取
  - 单 commit "Refactor: B4 M1 prereq — GalleyError::RunnerError + socket helpers"

M1.2 session write commands (same session 或 fresh)
  - 5 socket handler + 5 CLI subcommand + 0 trait method
  - 单 commit "Feat: B4 M1 — session write commands (new/btw/stop/archive/restore)"

M1.3 project + llm commands (same session)
  - 4 project handler + 2 llm handler + 6 CLI subcommand
  - 单 commit "Feat: B4 M1 — project + llm write commands"

M1.4 agent-api increments + integration tests (same session)
  - agent-api.md §5.7-5.17 全 11 命令 schema
  - cli/tests/* 加 15-22 integration tests
  - 单 commit "Docs+Test: B4 M1 — agent-api schemas + CLI integration tests"

↓ dogfood 1-2 day (V1-V11 verification + 4 cluster scenario)
M2 spike report 同步 ship (independent)
```

**Independence**：M1.1-M1.4 必须 sequential（依赖 GalleyError variant）。M2 tray spike 跟整 M1 chain 完全独立 —— spike 不通过不阻塞 M1 ship（spike fail 只阻 M2 实施）。

---

## 3. M1 详细 sub-task

### T1.0 · 本 sub-plan ship (paperwork-only)

```
git add docs/refactor/B4-M1-sub-plan.md
git commit -m "Docs: B4 M1 sub-plan — CLI write commands + commit shape decision"
```

JC review pass 后进 T1.1。

### T1.1 · M1.1 prereq commit · GalleyError::RunnerError + helpers + tx-aware trait + PRD §11.1 rename

**Files**:
- `core/src/error.rs`: 加 `RunnerError { message: String }` variant + Display impl + From `RunnerManagerError`-ish if needed
- `cli/src/main.rs`:
  - `exit_code_for(e)` 加 arm `GalleyError::RunnerError { .. } => 5`
  - `map_error_tag(tag, msg)` 加 arm `"runner_error" => GalleyError::RunnerError { message: msg }`
- `core/src/socket_listener.rs`: 提取
  - `fn origin_from_args(supervisor: Option<String>, reason: Option<String>) -> Origin`
  - `fn map_galley_err(request_id: Option<String>, err: GalleyError) -> SocketResponse` （含 RunnerError 新 arm）
  - 把 `dispatch_session_send` body 内 inline error mapping 改用 `map_galley_err`（重构对齐 B2 pattern）
- `core/src/api.rs` (O1 resolved · tx-aware trait method 加):
  - `create_session_in_tx<'c>(&self, tx: &mut Transaction<'c, Sqlite>, input: CreateSessionInput, origin: Origin) -> Result<SessionBrief>`
  - `send_message_in_tx<'c>(&self, tx: &mut Transaction<'c, Sqlite>, id: SessionId, content: String, origin: Origin) -> Result<MessageBrief>`
  - 既有 `create_session` / `send_message` (owned pool) body 拆 helper (`do_create_session(executor)` / `do_send_message(executor)`) 内部复用，trait surface owned-pool method 保留 (GUI Tauri command path 不变)
- `core/src/db.rs` (or wherever `SqliteGalley` impl lives): impl 新 2 trait method + 拆 helper
- `core/src/db.rs`: `pool() -> &SqlitePool` accessor (already exists per B1 M5 or add trivial getter)
- `core/src/api/prefs.rs` (NEW or in `api.rs` extension): `get_pref<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>>` method (for T1.8 `llm list` usage)
- `docs/PRD.md §11.1` (O2 + O3 resolved): rename `galley project move` → `galley session move <id> --to=<project-id>` + rename `galley project archive` → `galley project delete` + 加 "v0.6+ 再 ship 真 `project archive` (reversible)" 注脚

**Tests**:
- `cargo test --workspace` 全过（既有 test 不应受影响 — 拆 helper 是纯 refactor）
- 新加 unit test 验证 in-tx variant: open tx → 调 create_session_in_tx → 调 send_message_in_tx → COMMIT → verify rows 都在
- 新加 unit test 验证 rollback: open tx → 调 create_session_in_tx → drop tx (auto rollback) → verify row 不在

**Commit**: `Refactor: B4 M1 prereq — GalleyError::RunnerError + socket helpers + tx-aware trait variants + PRD §11.1 rename (O2+O3)`

### T1.2 · `session new` 

socket arg：
```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionNewArgs {
    task: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    llm_name: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}
```

handler 顺序（O1 resolved 2026-05-20 PM: SQLite transaction wrap）：
1. parse args → trim task；empty after trim → exit 2 invalid_args
2. 如 `llm_name.is_some()`: read prefs llm_list cache，find index by name；not found → exit 2；cache empty → exit 4
3. construct CreateSessionInput { id: mint_id(), title: "新对话" (server-side derive 第一次 turn 后)，project_id, llm_index, llm_display_name }
4. **BEGIN TRANSACTION** (SQLx `pool.begin().await?` 返 `Transaction`)
5. `galley.create_session_in_tx(&mut tx, input, origin)` → SessionBrief（trait 加 `*_in_tx` 变体 OR socket handler 内手 inline SQL；详 §1.9）
6. `galley.send_message_in_tx(&mut tx, brief.id.clone(), task, origin)` → MessageBrief
7. **COMMIT** (`tx.commit().await?`)
8. 任意 step 4-7 失败 → 自动 ROLLBACK + map_galley_err → 适当 exit code (5 runner_error if internal SQL fail; 2/3/4 if validation fail)
9. `manager.send_command(&brief.id.0, &IpcCommand::UserMessage{text:task, images:vec![]})` (best-effort dispatch；fail 不 rollback — DB 已 commit，bridge dispatch 仅 best-effort)
10. 返 `{session: brief, message: msg_brief, dispatch: "dispatched"|"persisted_only"}` exit 0

**id minting**: socket handler 用 `format!("s-{}", ulid::Ulid::new())` (already used in B3 M4 create_session caller path — verify dependency available in core/Cargo.toml)；如 ulid crate 未 add → 用 `uuid::Uuid::new_v4()`（已是 deps）。

**Atomicity guarantee (O1 resolved)**: SQLite transaction wrap eliminates partial state。Reject #2 仍 stands —— **不**加新 trait method `create_session_with_first_message` (trait + test 矩阵 cost)；改在 socket handler 内 inline tx 控制 (`pool.begin()` + 复用既有 trait method **如果它们接受 `&mut Transaction` 而非 owned `&self`**)。**Trait 修改成本**：need to add `*_in_tx` 变体 of `create_session` + `send_message` (2 method)，复用既有 body 但接 `&mut Transaction<Sqlite>`. **Verify before T1.2**: SqliteGalley impl 当前是否所有 SQL 走 owned pool? 如是，加 in-tx 变体；如已用 connection-borrow 模式，更简单 reuse. 详 §1.9.

**Tx open cost**: SQLite WAL `BEGIN IMMEDIATE` ~1ms 本地，可接受。不用 `BEGIN DEFERRED` (read-then-write race 不在 session new 路径，create + insert 是纯 write)。

CLI:
```rust
Command::Session(SessionCmd::New { task, project, llm, supervisor, reason }) => 
    session_new(task, project, llm, supervisor, reason).await,
```

### T1.3 · `session btw`

socket arg：
```rust
struct SessionBtwArgs {
    session_id: String,
    question: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}
```

handler:
1. parse args; empty question after trim → exit 2
2. validate session exists：`galley.session_brief(SessionId(session_id))` → not found → exit 3
3. **skip** `send_message`（v0.1 transient 决策）
4. `manager.send_command(&session_id, &IpcCommand::UserMessage{ text: format!("/btw {}", question.trim()), images: vec![] })` → 
   - Ok → exit 0 `{dispatch: "dispatched"}`
   - Err (no bridge alive) → exit 5 runner_error "no live bridge for session; /btw requires alive runner"
5. **Future hook** (M7)：emit Tauri event with origin payload for GUI supervisor-action log

### T1.4 · `session stop`

socket arg:
```rust
struct SessionStopArgs {
    session_id: String,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
}
```

handler:
1. validate session exists; not found → exit 3
2. check `manager.agent_running(&session_id).await`:
   - false → return `{dispatch: "already_stopped"}` exit 0 (idempotent)
   - true → `manager.send_command(&session_id, &IpcCommand::Abort).await`
3. emit success → `{dispatch: "abort_sent"}` exit 0

**Not Shutdown**：详 §1.4 决策。

### T1.5 · `session archive` + `session restore`

Thin wrappers. Mirror dispatch_session_send pattern. 1 socket handler each.

```rust
async fn dispatch_session_archive(request_id, args, app, manager) -> SocketResponse {
    let parsed: SessionArchiveArgs = ...;
    let galley = SqliteGalley::open().await?;
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley.archive_session(SessionId(parsed.session_id), origin).await {
        Ok(brief) => {
            // Emit Tauri event so GUI sidebar updates immediately
            if let Some(app) = app {
                let _ = app.emit("session-archived-external", &brief);
            }
            SocketResponse::ok(request_id, json!({"session": brief}))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}
```

Tauri emit name `session-archived-external` mirror B2 `user-message-persisted` naming convention（external = 来自 CLI/supervisor 而非 GUI 自己）。GUI 端 listener 已有 `session-archived` mass-broadcast 路径 OR 新加 listener route （详 R5）。

`session restore` 同 pattern 走 `unarchive_session` + emit `session-unarchived-external`.

### T1.6 · `session move` (O3 resolved, 原 T1.6 project move 重定位)

socket arg：
```rust
struct SessionMoveArgs {
    session_id: String,
    #[serde(default)]
    to: Option<String>,  // None = detach from any project
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}
```

handler:
1. parse；validate session exists → not found exit 3
2. 如 `to.is_some()`: validate project exists → not found exit 2 (FK violation 路径 — `assign_session_to_project` impl 已 return InvalidArgs per [api.rs:165-166](../../../core/src/api.rs))
3. `galley.assign_session_to_project(SessionId(session_id), to, origin)` → SessionBrief
4. emit Tauri event `session-moved-external` (payload {sessionId, newProjectId})
5. 返 `{session: brief}` exit 0

**Naming rationale (O3 resolved 2026-05-20 PM)**: PRD §11.2 #5 「`galley <noun> <verb>`，noun 是 verb subject」。`move` 的 subject 是 session 不是 project（projects 不动，sessions 在 projects 间移动）。原 PRD §11.1 写「`galley project move`」违反自家 grammar 规则。**修法**：PRD §11.1 同步更新（M1.1 prereq commit 顺便改）+ CLI surface `session move`，agent-api §5.X 不再需要补「subject is session」说明（直接对齐）。

### T1.7 · `project create / list / delete` (O2 resolved, 原 T1.6 4-cmd 改 3-cmd)

3 subcommand: 1 写 (create) + 1 读 (list, no socket) + 1 删 (delete)。

**`project list`**：CLI subcommand 直走 SQLite (no socket)，mirror `sessions list` / `llm list` pattern。CLI subcommand 内开 SqliteGalley + 调 `list_projects` trait method。NDJSON output 一行一 ProjectBrief。

**`project create`**：socket handler 调 `create_project(input, origin)` → ProjectBrief。Emit Tauri event `project-created-external`. Args `{name, description, supervisor, reason}`，name trim empty → exit 2 invalid_args (per [api.rs:248-249](../../../core/src/api.rs))。

**`project delete`** (O2 resolved · was `project archive`)：socket handler 调 `delete_project(id, origin)`. FK CASCADE SET NULL 自动把 child sessions 拆到 ungrouped (保 sessions 不丢)。Emit Tauri event `project-deleted-external` (payload {projectId, detachedSessions: count})。Response: `{deleted: true, detachedSessions: count}` 让 agent 知道副作用。Exit 3 if not_found。

**Naming rationale (O2 resolved 2026-05-20 PM)**: 原 PRD `project archive` 在 v0.2 实际是 `delete_project` (FK SET NULL + 行删除)。「archive」一词暗示 reversible hide，跟实际 destructive delete 不符——naming 撒谎。**修法**：v0.2 直接叫 `project delete` (honest)；v0.6+ 真 archive 落地时再 ship `project archive` 带 reversible 语义（避免现在的 archive→delete 误导成为 semantic debt）。PRD §11.1 同步改 (M1.1 prereq commit)。

**Note for SOP (M4)**：destructive 操作前 agent confirm + show detachedSessions preview 是 SOP-level 责任，不在 CLI surface 加 flag（O2 决策 explicit）。`project delete` 名字诚实就够了。

### T1.8 · `llm list`

CLI subcommand 直走 SQLite (no socket)：

```rust
Command::Llm(LlmCmd::List) => {
    let galley = SqliteGalley::open().await?;
    let cached: Option<Vec<Value>> = galley.get_pref("llm_list").await?;
    for entry in cached.unwrap_or_default() {
        emit_json(&entry)?;
    }
    Ok(())
}
```

Cache shape (from runtime.ts:686 + hydrate.ts:75): `Vec<{index: u32, name: String}>`. M1 内 trait 加 `get_pref<T: DeserializeOwned>(key) -> Result<Option<T>>` method (复用 SqliteGalley `prefs` 表查询 — 已在 B3 M6 hydratePrefs 路径用过相同 SQL)。

**Verify**：当前 `SqliteGalley` 是否已有 generic prefs read？grep 一下，没有就在 M1.1 prereq commit 加上。

### T1.9 · `llm set`

socket arg:
```rust
struct LlmSetArgs {
    session_id: String,
    llm_name: String,
}
```

handler:
1. parse；validate session exists → not found exit 3
2. read prefs llm_list cache；find by name → not found exit 2
3. `galley.set_session_llm(SessionId(session_id), Some(index), Some(name))` → SessionBrief
4. if `manager.agent_running(&session_id)` OR bridge alive (manager.has_bridge(&session_id))：emit `IpcCommand::SetLlm{ llm_index: index as i64 }`；on Err → exit 5
5. 返 `{session: brief, dispatch: "dispatched"|"persisted_only"}` exit 0

**No Origin**：mirror existing `set_session_llm` trait signature (无 origin per [api.rs:184-189](../../../core/src/api.rs))。

### T1.10 · CLI subcommand 注册 (clap)

`cli/src/main.rs` 加（reflects O2 rename + O3 session move 重定位 + transaction wrap on session new）：

```rust
#[derive(Subcommand, Debug)]
enum SessionCmd {
    // ...existing (Send/Watch/Brief/Show)...
    New { task: String, #[arg(long)] project: Option<String>, #[arg(long)] llm: Option<String>, #[arg(long)] supervisor: Option<String>, #[arg(long)] reason: Option<String> },
    Btw { id: String, question: String, #[arg(long)] supervisor: Option<String>, #[arg(long)] reason: Option<String> },
    Stop { id: String, #[arg(long)] reason: Option<String>, #[arg(long)] supervisor: Option<String> },
    Archive { id: String, #[arg(long)] supervisor: Option<String>, #[arg(long)] reason: Option<String> },
    Restore { id: String, #[arg(long)] supervisor: Option<String>, #[arg(long)] reason: Option<String> },
    /// Move a session into / out of a project. `--to=<project-id>` to attach;
    /// omit `--to` to detach from any project. (O3 resolved: noun=subject.)
    Move { id: String, #[arg(long)] to: Option<String>, #[arg(long)] supervisor: Option<String>, #[arg(long)] reason: Option<String> },
}

#[derive(Subcommand, Debug)]
enum Command {
    // ...existing...
    #[command(subcommand)]
    Project(ProjectCmd),
    #[command(subcommand)]
    Llm(LlmCmd),
}

#[derive(Subcommand, Debug)]
enum ProjectCmd {
    Create { name: String, #[arg(long)] description: Option<String>, #[arg(long)] supervisor: Option<String> },
    List,
    /// Permanently delete a project. Child sessions auto-detach to ungrouped
    /// (FK SET NULL). v0.2: this is destructive. v0.6+ will ship a separate
    /// `archive` command with reversible semantics. (O2 resolved.)
    Delete { project_id: String, #[arg(long)] supervisor: Option<String>, #[arg(long)] reason: Option<String> },
}

#[derive(Subcommand, Debug)]
enum LlmCmd {
    List,
    Set { session_id: String, llm_name: String },
}
```

**Note**: 旧 `ProjectCmd::Move` 不存在（已迁 SessionCmd::Move per O3）；旧 `ProjectCmd::Archive` 改名 `Delete` per O2。clap 这两处变化 + PRD §11.1 同步更新 (M1.1 prereq commit 内) 形成 single source of truth。

### T1.11 · agent-api.md §5.7-§5.17 (M1.4 commit)

每命令一段，mirror §5.4-§5.6 format：
- Bash example with verbatim CLI invocation
- Args 表（type + default + notes）
- Response shape 表
- Error codes table（list which `error` discriminants this command can return + which exit code）
- Origin behavior block (1-2 sentences)

| §  | command | 备注 |
|---|---|---|
| §5.7 | `session new` | atomic transaction; O1 path |
| §5.8 | `session btw` | transient; not persisted; runner-only |
| §5.9 | `session stop` | Abort 不 Shutdown; idempotent |
| §5.10 | `session archive` | thin wrapper |
| §5.11 | `session restore` | thin wrapper (`unarchive_session`) |
| §5.12 | `session move` | O3 resolved; subject=session |
| §5.13 | `project create` | thin wrapper |
| §5.14 | `project list` | direct SQLite read |
| §5.15 | `project delete` | O2 resolved; was `project archive` in earlier drafts |
| §5.16 | `llm list` | direct SQLite read (prefs cache) |
| §5.17 | `llm set` | DB write + best-effort bridge IPC |

§3 Exit codes 表加 row 5 = `runner_error`.

§1 stability section bullet：「`error` discriminants stable」加 `runner_error` 进 enum 列表。

### T1.12 · Integration tests (M1.4 commit)

新 test file `cli/tests/m1_session_writes.rs`、`m1_project_writes.rs`、`m1_llm_commands.rs`. Mirror existing test style (`cli/tests/session_send.rs` etc)：

- Setup: tempdir + GALLEY_DB_PATH override + spawn socket server in test process
- Per command: 1 happy + 1 error path
- Examples:
  - `session new "task"` → session row + first message row exists in DB (verify both committed atomically)
  - `session new "task" --llm=nonexistent` → exit 2 invalid_args + verify **no** session row created (transaction rolled back; T1.2 atomicity invariant)
  - `session btw <id> "q"` (no bridge alive) → exit 5 runner_error
  - `session stop <id>` (no bridge alive) → exit 0 dispatch=already_stopped
  - `session archive <id>` → SessionBrief status=archived returned
  - `session move <sid> --to=<pid>` → session row project_id mutated (O3)
  - `session move <sid>` (no --to) → session row project_id null (detach)
  - `project create "name"` → ProjectBrief returned
  - `project list` → NDJSON list
  - `project delete <pid>` → row deleted; sessions detached (count returned) (O2)
  - `llm list` (empty cache) → empty stdout, exit 0
  - `llm set <sid> "<name>"` (cache empty) → exit 2

Target: 15-22 new tests total。Cargo test should pass 全过。**Atomicity invariant test** (session new rollback verification) is load-bearing for O1 resolution。

### T1.13 · M1 commit + dogfood

```
M1.1 commit: "Refactor: B4 M1 prereq — GalleyError::RunnerError + socket helpers + tx-aware trait variants + PRD §11.1 rename"
  → 含 PRD §11.1 改名（O2 project archive→delete + O3 project move→session move）+ GalleyError::RunnerError variant + map_galley_err helper + origin_from_args helper + create_session_in_tx / send_message_in_tx trait method
M1.2 commit: "Feat: B4 M1 — session write commands (new/btw/stop/archive/restore/move)"
  → 6 subcommand (new 走 tx wrap atomic; move 是 O3 新加) + GUI ipc-handlers 加 4 listener (session-archived-external / session-unarchived-external / session-moved-external + future session-updated-external for llm.set)
M1.3 commit: "Feat: B4 M1 — project + llm write commands"
  → project: create/list/delete (3 cmd per O2，lost move per O3) + llm: list/set (2 cmd) + GUI ipc-handlers 加 2 listener (project-created-external / project-deleted-external)
M1.4 commit: "Docs+Test: B4 M1 — agent-api schemas + CLI integration tests"
  → agent-api §5.7-§5.17 11 段 + §3 exit code 5 row + §1 stable error discriminants 更新 + cli/tests/m1_*.rs 15-22 test
```

Dogfood 1-2 day per §6.

---

## 4. Risk register

> **2026-05-20 PM update**：R1 / R6 / R7 由 O1 / O3 / O2 resolution 消除或大幅 mitigated。修订后保留 active risks。

| ID | Risk | Mitigation | Severity |
|---|---|---|---|
| ~~R1~~ | ~~session new atomicity (orphan empty session)~~ | **CLOSED (O1 resolved)**: SQLite transaction wrap (T1.2) 保证 create_session + send_message atomic 或全 ROLLBACK。无 partial state；CLI test `session new "task" --llm=nonexistent` 验证 invalid_args 时 zero session row created | ~~Medium~~ → closed |
| **R2** | **session btw no-bridge fail mode** — btw 需要 runner alive，但 CLI 无能力 spawn bridge（spawn 在 GUI 用户手 activate 时触发）；agent 调 btw 时 bridge 可能已被 LRU evict | exit 5 runner_error + message "no live bridge; activate session in GUI first" (SOP doc 教 agent 流程)；future B4 M2/M3 后 GUI 在 background 跑可降低 evict 率 | Medium |
| **R3** | **session stop semantics 跟用户预期不符** — 用户期待「停止 + bridge 死」实际是「停止 turn + bridge 活」；SOP 文档没写清 agent 会困惑 | M4 supervisor SOP 文档显式说明：「`stop` = abort current turn，bridge 留活；要真退请 `archive`」；archive 走 status=archived bridge LRU 自然 evict | Medium |
| **R4** | **llm list cache empty** — 用户从未 warmup 过 (例：刚 onboard 没起过 session) → cache 空 → `llm list` 返 empty → agent SOP 困惑 | exit 0 + empty stdout (not error；空集合是合法 read 结果)；SOP 文档说 "如空请到 GUI Settings → Runtime warmup 或起一次 session"；M4 SOP scenarios 内含 "first-time setup" 步骤 | Low |
| **R5** | **Tauri emit `session-archived-external` 等新事件 GUI 端无 listener** —— 沿用 B2 user-message-persisted 后接 listener pattern，M1 写 5 个新 emit (`session-archived-external` / `session-unarchived-external` / `session-moved-external` / `project-created-external` / `project-deleted-external`)，GUI ipc-handlers 漏挂 → GUI sidebar 不实时更新 | M1.2 / M1.3 commit 内必须**同 commit 加 GUI listener**（gui/src/lib/ipc-handlers.ts）。listener body = 调 sessionsStore / runtimeStore 既有 action mirror cli action (mirror B2 appendUserTurnExternal pattern)。V8 dogfood gate 强 check 5 emit 全有 listener | Medium |
| ~~R6~~ | ~~project move CLI 命名歧义~~ | **CLOSED (O3 resolved)**: rename CLI surface 到 `session move <id> --to=<pid>` 直接消除歧义。subject=session 跟 PRD §11.2 #5 grammar rule 对齐。PRD §11.1 同步更新 | ~~Low~~ → closed |
| ~~R7~~ | ~~project archive ≠ delete 语义混淆~~ | **CLOSED (O2 resolved)**: rename CLI surface 到 `project delete`，naming honest matches actual behavior (FK SET NULL + DELETE)。v0.6+ 真 archive 落地时 ship 新 `project archive` 带 reversible 语义。agent-api §5.15 文档段 prominent 说 "v0.6+ will introduce true `project archive` (reversible) — current `project delete` is destructive but child sessions auto-detach (not lost)." | ~~Medium~~ → closed |
| **R8** | **GalleyError 加 RunnerError variant 破坏 exhaustive match** — 全 codebase 内 `match GalleyError` 凡 exhaustive 的都需要加 arm；漏一处 = TS strict / cargo error | M1.1 prereq commit 内 cargo check 强 enforce；`#[non_exhaustive]` attr **不**加 (内部 crate 不需要 future-proofing；exhaustive match 是 feature) | Low |
| **R9** | **CLI exit code 5 引入但 CI 没测** — 既存 CLI tests 假设 0-4，加 5 后 SOP 测试可能没覆盖 runner_error path | M1.4 integration tests 必有至少 2 个 exit 5 case (session btw no-bridge + llm set bridge-fail simulated) | Low |
| **R10** | **llm by-name lookup 大小写敏感** — `--llm=GLM-4.5-X` vs cache 里 `glm-4.5-x` ↓ exit 2 invalid_args；用户体感差 | M1 实施：socket handler 内做 case-insensitive compare (`.eq_ignore_ascii_case(name)`)；agent-api §5.7 / §5.17 doc 写 "case-insensitive match" | Low |
| **R11** | **session new id 生成 race** — 极短时间内多 supervisor 调 `session new` ulid/uuid 仍可能（理论）冲突 → create_session 报 invalid_args (PRIMARY KEY) | (a) socket handler 改 retry 1 次重 mint id (b) 实际 ulid 时间戳 80 bit + 随机 48 bit，碰撞概率小于 race condition；M1 内**不**实现 retry，留 R 记 | Low |
| **R12** | **session btw `--reason=` 不持久化但 surface 接** - sub-plan 决策 btw 不写 DB，但 CLI 仍接 supervisor/reason flag，用户期望存却没存 | (a) M7 GUI 行动日志渲染时通过 Tauri event 接收 + render (不依赖 DB) (b) agent-api §5.8 doc 显式说 "session btw 的 supervisor/reason 仅用于实时日志；不持久化；session 重启后 /btw 历史整段丢" | Low |
| **R13 NEW** | **tx-aware trait method 加 (`create_session_in_tx` / `send_message_in_tx`) 对 B3 GUI 调用 caller 风险** —— 既有 owned-pool method `create_session` / `send_message` 不改 signature，但底层若都 delegate 到 helper (`do_create_session` 接 `SqliteExecutor`)，helper 改 bug 可能同时影响 GUI Tauri command path 跟 CLI socket path | T1.1 implementation: refactor 拆 helper 时跑全 既有 cargo test（不只新加 test）；GUI dogfood path 在 V5 / cluster 1-2 重测；refactor commit 独立（M1.1 内） | Low |

---

## 5. Verification gates

### V1 · TypeScript / Rust / lint
- `cd gui && pnpm typecheck` — 0 error
- `cd gui && pnpm lint` — 0 warning
- `cd core && cargo check --workspace` — 0 error
- `cd core && cargo clippy --workspace --all-targets -- -D warnings` — 0 warning
- `cd core && cargo test --workspace` — 全过 (既有 + 新增 15-22 test)

### V2 · grep gates
- `grep -rn "GalleyError::" core/src/ cli/src/ | grep -v test` 所有 exhaustive match 都含 `RunnerError` arm
- `grep -n "appendUserTurnExternal\|session-archived-external\|project-created-external\|session-moved-external\|project-deleted-external" gui/src/lib/ipc-handlers.ts` — 5 listener 全在

### V3 · CLI smoke (M1 ship 后立即跑)

```bash
# Sanity (no Core needed)
galley version          # → exit 0, JSON
galley llm list         # → exit 0, NDJSON (might be empty)

# Without Core
galley session new "test"  # → exit 4 db_unavailable

# With Core (起 GUI / Tauri dev mode)
galley session new "test from CLI"   # → exit 0, JSON {session, message, dispatch}
galley sessions list                 # → 看到 "test from CLI"
galley session brief <id-from-above> # → SessionBrief
galley session btw <id> "side q"     # → exit 0 or exit 5 (depending bridge alive)
galley session stop <id>             # → exit 0, {dispatch: ...}
galley session archive <id>          # → exit 0; GUI sidebar 该 session 消失
galley session restore <id>          # → exit 0; GUI sidebar 该 session 回来
galley session move <sid> --to=<pid> # → exit 0; GUI 看 session 进 project (O3)
galley session move <sid>            # → exit 0; session 拆出 project (no --to)
galley project create "test proj"    # → exit 0, ProjectBrief
galley project list                  # → NDJSON 含 "test proj"
galley project delete <pid>          # → exit 0; sessions detach to ungrouped (O2)
galley llm set <sid> "glm-4.5-x"     # → exit 0 or exit 2 (cache empty)
```

### V4 · Atomicity / idempotency (O1 resolved)
- `session new "task" --llm=nonexistent-llm` → exit 2 invalid_args **AND** `sessions list` 不见此 session (transaction rolled back; atomicity 验证)
- `session new` 模拟 send_message tier fail (临时 inject `DROP TABLE messages` via SQL fixture or mock send_message body) → exit 5 runner_error **AND** `sessions list` 不见此 session (full rollback)
- `session stop` × 3 连续 → 第 1 次 `abort_sent`，2-3 次 `already_stopped`
- `session archive <id>` × 2 → 第 2 次仍 ok (idempotent)
- `session move <id> --to=<pid>` × 2 → 第 2 次 ok (idempotent)
- `project delete <pid>` 然后 `sessions list --project=<pid>` → empty (sessions detached but not deleted)

### V5 · GUI 实时性
- CLI `session new` → GUI sidebar 1s 内出现新 session
- CLI `session archive` → GUI sidebar 1s 内消失
- CLI `session move <sid> --to=<pid>` → GUI sidebar 旧位置消失、新 project 下出现 (O3)
- CLI `project create` → GUI sidebar PROJECTS section 1s 内出现
- CLI `project delete <pid>` → GUI sidebar PROJECTS 消失 + 原 sessions 跳到 ungrouped (O2)
- CLI `llm set` 在 alive bridge 期间 → GUI MainView LLM popover 1s 内显示新名

### V6 · Exit code 完整性
- 0/1/2/3/4/5 各至少 1 个 integration test 触发

### V7 · agent-api.md schema check
- §5.7-§5.17 11 段全在
- 每段含 Args 表 + Response 表 + Error codes 表
- §3 exit code 表 row 5 = runner_error
- §1 error discriminants list 含 `runner_error`

### V8 · GUI listener coverage（R5）
- 手测：开 2 GUI 窗口（同 SQLite，第二窗口模拟 supervisor view），第一窗口跑 CLI 触发 5 emit，第二窗口应实时看到对应 sidebar 更新

---

## 6. Dogfood scenarios

### Cluster 1 · session new from CLI (O1 atomicity 重点)
- [ ] `galley session new "fix auth bug"` → GUI sidebar 出现 + first message 已 dispatch（看 conversation 区域）
- [ ] `galley session new "review PR" --project=<pid> --supervisor=ga-claude --reason="user asked"` → session 进 project + origin 三元组在 SQL 内
- [ ] `galley session new "test" --llm=nonexistent-llm` → exit 2 invalid_args **+ verify sessions list 不见此 session** (O1 atomicity invariant — transaction rolled back)
- [ ] `galley session new ""` (empty task) → exit 2 invalid_args + zero side-effect

### Cluster 2 · session lifecycle from CLI
- [ ] CLI `session new` → CLI `session send` 追加一句 → CLI `session stop` (mid-run) → CLI `session send` 又一句（验证 stop=abort 后 bridge 仍活）
- [ ] CLI `session archive` → GUI sidebar 消失 → CLI `session restore` → GUI 回来
- [ ] CLI `session btw <id> "side question about X"` → GUI conversation 显示 SystemMessage（or 不显示，per V0.1 transient 决策）
- [ ] CLI `session move <sid> --to=<pid>` → GUI sidebar 旧位置消失、新 project 下出现 (O3)
- [ ] CLI `session move <sid>` (no --to) → 同 session 拆出 project 到 ungrouped

### Cluster 3 · project ops (O2 重点)
- [ ] CLI `project create "myproj"` → GUI sidebar PROJECTS 出现
- [ ] CLI `project list` → 含 "myproj"
- [ ] CLI `session move <sid> --to=<myproj-id>` → session 进 myproj (move 跨 cluster 复用; from cluster 2)
- [ ] CLI `project delete <pid>` → project 消失 + 原 sessions ungrouped + return payload 含 `detachedSessions: count` (O2)
- [ ] CLI `project delete <bogus-id>` → exit 3 not_found

### Cluster 4 · llm ops
- [ ] cold (fresh install) `galley llm list` → empty NDJSON exit 0
- [ ] GUI 起 session warmup → `galley llm list` → 全 LLM 在
- [ ] CLI `llm set <sid> "<name>"` bridge alive → GUI MainView LLM popover 即时切换
- [ ] CLI `llm set <sid> "<name>"` bridge dead → exit 0 dispatch=persisted_only；next GUI 触发 bridge spawn 后 LLM 是新值
- [ ] CLI `llm set <sid> "GLM-4.5-X"` (case-mismatch vs cache "glm-4.5-x") → exit 0 (case-insensitive per R10)

---

## 7. Transitional comments policy

M1 引入新代码 / 新 socket route / 新 trait method usage，**禁止留 TRANSITIONAL 注释**（B4 内若有 transitional 应在 M9 ship 前清完）。

可接受的注释类型：
- `// B4 M1` 标 milestone 来源（informational，不阻 review）
- `// per agent-api.md §5.X` 引用 schema 定义点
- 已知 future enhancement → `// TODO(M7): emit Tauri event for supervisor log` (绑定具体 milestone)

**禁止**：
- `// TRANSITIONAL` （B4 内不应有半完成状态跨 milestone）
- `// HACK` 无 explanation 的标记
- `// TODO` 无 owner/timeline 的悬空

---

## 8. Rejected alternatives

### Reject #1 · Single commit M1（1500+ LOC）
**理由**：超过 M5 1052 LOC 上限 (B3 实测 stable boundary)；revert 半状态破坏 noun-group ship；4 commit 才能让 reviewer 按 group focus。

### Reject #2 · `create_session_with_first_message` 加新 trait method (per playbook T1.1 原写法)
**理由 (修订 2026-05-20 PM with O1 resolution)**：
1. 实现成本 = 在 trait 加 1 method (composite) + SqliteGalley impl 内 wrap transaction + 接受 BEGIN/COMMIT 复杂度
2. **替代路径** (O1 resolved): 加 2 个 `*_in_tx` trait method (`create_session_in_tx` + `send_message_in_tx`) 作既有 method 的 transaction-aware sibling，socket handler 内 inline BEGIN/COMMIT。**这条路径既保 atomicity 又不引入 composite method**（既有 owned-pool method 留给 GUI Tauri command path 用 byte-identical）。详 §1.9 实现细节
3. composite method `create_session_with_first_message` 缺点：单一用例（CLI session.new）的合成 method，trait surface 膨胀；改 send_message body 时还需要同步 maintain composite method 内的 inline send_message logic; reuse 价值 < `*_in_tx` 通用 pattern

### Reject #3 · `session stop` 映射到 Shutdown
**理由**：详 §1.4。Shutdown = bridge 死下次 send 必须 respawn (5-10s 启动成本)；用户 / agent 期待 stop 后能立刻继续。Shutdown 是 system-driven 操作 (LRU / Cmd-Q)，不该挂 user CLI surface。

### Reject #4 · `session btw` 持久化到 messages 表
**理由**：违反 v0.1 决策 (messages.ts:445-455 "Transient append — no DB persistence for V0.1")；GUI 端不渲染 = 持久化也没用；M4 supervisor SOP 文档需要明确「/btw 不进对话主线」减少 agent 困惑 (持久化反而强化错误期待)。

### Reject #5 · `llm list` 走 socket spawn warmup bridge
**理由**：详 §1.6。SOP agent 调 `llm list` 期待秒级返回（典型 "查一下 LLM 列表然后选一个"），5-10s spawn 延迟破坏 agent UX；SQLite cache 是 acceptable degradation；空 cache 的解决方案 "GUI 起一次 session" 已是用户 onboarding 一部分。

### Reject #6 · `project archive` 加 trait `archive_project` + `archived` 字段
**理由**：scope creep。v0.2 project 没 archived state（B3 M4 只接 delete）；加 archived 字段 = migration 008 + GUI UI 改 + SOP 文档改 = 跑出 M1 scope；v0.6+ 加真 archive 时再 migration（O2 rename to `project delete` 后 v0.6+ `project archive` 是新加 NOT 覆盖；semantic debt 避免）。

### Reject #7 · CLI exit code 5 留到 M6 schema freeze 再加
**理由**：M1 内 `session btw` 已有 runner_error 触发场景；M6 freeze 前漏掉则 schema freeze 后再加成本高（agent SOP 已写完 expect 0-4 mapping，加新 code 破坏 SOP）。M1.1 prereq commit 顺手加，干净。

### Reject #8 · CLI `session kill` 加 destructive Shutdown surface
**理由**：[O6 NEW](#open-decisions-new) 推 v0.6+。v0.2 surface 已含 archive (destructive delete-ish) + restore；多一个 kill 增加 SOP 学习成本。Shutdown 用 GUI Cmd-Q 或 LRU 自然触发足够。

### Reject #9 · `--pretty` flag 在 M1 内实现
**理由**：B4 playbook T9 列 `--pretty` 是 M9 polish；M1 scope 聚焦写命令 + agent-api schema；pretty 是 derived view (PRD §11.2 #6)；JSON canonical 已能跑通 supervisor agent flow。

### Reject #10 · `session watch --until=idle` 在 M1 实现
**理由**：B4 playbook A1 / PRD §11.1 列 `--until=idle` 是 watch enhancement；B2 已 ship watch 基础；M1 scope 聚焦 11 个新 subcommand 不动 watch；watch enhancement 推 [M9 catchall](./B4-cli-bg-artifact.md) 或独立 follow-up commit。

### Reject #11 · 保留 `project move` 不改成 `session move` (O3 alt)
**理由 (O3 resolved 2026-05-20 PM)**：原 PRD literal 是「project move」，但 PRD §11.2 #5 自家 grammar rule 是「`galley <noun> <verb>` noun 是 subject」。move 的 subject 是 session 不是 project。保留 `project move` = PRD 内部 §11.1 跟 §11.2 矛盾，agent-api §5.14 doc 强补「subject is session」是绕开 grammar rule 而非守住。**rename 比 doc 补丁优**：PRD 是内部文档，纠正 §11.1 比加 §5.14 文档补丁低成本 + 高一致性。

### Reject #12 · 保留 `project archive` + 加 `--confirm-i-mean-delete` flag (O2 alt)
**理由 (O2 resolved 2026-05-20 PM)**：原方案问题是 naming 撒谎（「archive」暗示 reversible，实际是 delete）。加 confirm flag 是对撒谎打补丁不是纠正撒谎。rename 到 `project delete` 让 naming 跟 behavior 一致是 root-cause fix；SOP 文档教 agent「destructive，先 confirm」是行为层教学，跟 surface naming 不互斥。v0.6+ 真 archive 落地 ship 新 `project archive` 命令带 reversible 语义，naming + behavior 严格对齐，无 semantic debt。

### Reject #13 · O1 `session new` partial success exit 0
**理由 (O1 resolved 2026-05-20 PM)**：partial success 违反 agent-api.md §4 「Exit code carries the category for SOPs that don't want to parse JSON」契约。Exit 0 + `dispatch: "message_persist_failed"` 信息在 JSON 里，但只看 exit code 的 SOP 会以为成功 → orphan empty session 留 DB。Transaction wrap 路径：要么全成 (exit 0) 要么全无 (exit 5 + rollback)，无 partial state，exit code 跟 JSON 严格一致。

---

## 9. Open decisions resolution (2026-05-20 PM by JC)

> 6 decisions 全 resolved。3 个采纳推荐 alternative path (O1/O2/O3 都不走 sub-plan 原 lean，走第三方案)，3 个 confirm 原 lean (O4/O5/O6)。

- [x] **O1** `session new` first message persist fail 处理 → **Transaction wrap + exit 5 runner_error** (第三方案，详 §1.9 + T1.2)。改完后 R1 closed。Sub-plan 原 lean (partial success exit 0) → Reject #13。
- [x] **O2** `project archive` 命名 → **rename CLI 到 `project delete`** (第三方案)，PRD §11.1 同步改 + v0.6+ 再 ship 真 `project archive` reversible。改完后 R7 closed。Sub-plan 原 lean (保 archive + SOP 教) → Reject #12。
- [x] **O3** `project move` vs `session move` → **改 `session move <id> --to=<pid>`** (PRD §11.2 #5 grammar rule 对齐)，PRD §11.1 同步改。改完后 R6 closed。Sub-plan 原 lean (保 PRD literal) → Reject #11。
- [x] **O4** `project delete` SOP 演示 confirm → **punt to M4 sub-plan**。M1 内 `delete_project` 返 `detachedSessions: count` payload，agent 可决定是否 pre-confirm；M4 SOP 内显式演示是好实践但不是 M1 blocker。
- [x] **O5** `session btw` origin push Tauri event → **M1 socket handler 留 `// TODO(M7): emit btw-dispatched event with origin payload` hook 点，本 milestone 不实现**。零代码成本 + 锁住 M7 集成路径；payload shape 由 M7 sub-plan 决定。
- [x] **O6** `session kill` Shutdown surface → **v0.2 不加**。Cmd-Q + LRU 自然触发足够；CLI surface 守简洁；**新加监测项 N5 dogfood watch**：如 dogfood 期间出现 bridge wedge complaints (Python hang / OOM / IPC deadlock)，v0.6+ 再 ship `session kill`。

**Net impact on M1 scope**:
- T1.2 session new 加 SQLite transaction wrap (O1) — +30 LOC handler + 2 trait method (`*_in_tx` variants) + 1 helper refactor
- T1.6 NEW `session move` (O3) — +socket handler + CLI subcommand + listener + tests (~80 LOC total)
- T1.7 project group lose `move` (O3 移走) + rename `archive` → `delete` (O2)
- PRD §11.1 update in M1.1 prereq commit
- Net commit shape unchanged: still 4-commit M1.1-M1.4

---

## End of M1 sub-plan
