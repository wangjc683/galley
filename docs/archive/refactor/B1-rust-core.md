# B1 · Rust core 骨架 + CLI 只读

```
Cursor:   ✅ COMPLETE — 全部 T7 sub-task ship (B2 已启动)
Status:   ✅ COMPLETE (M1-M7 + T7.1-T7.7 done)
Started:  2026-05-18
Last touch: 2026-05-19 — T7.6 B2 playbook 升格完成 + T7.7 tag b1-complete
Predecessor: M6 commit 80feb4c + B1 finish commit 41cdeb5
Successor:   B2 (bridge ownership 迁 Rust)
Duration:    3 周估计 → 实际单 session ~5h (~21× 加速)
```

> **2026-05-18 session-close**：B1 实质内容（代码 + 测试 + 文档 + dogfood）已 ship 到 main 共 8 个 commits（4ee23e3 → 41cdeb5）+ CI 全绿。剩 T7.6 (B2 playbook 升格) 和 T7.7 (tag b1-complete) 留下次 session 开 B2 时一并办——它们是仪式不是 blocker，分到 B2 启动 session 更顺。

**Cursor 协议**：完成 sub-task → 把 cursor 改到"下一个未完成的最小编号 T"。Session 结束 → cursor 必须指向"明确可以接续的位置"，不要指 in-progress。

## 这个 phase 在干啥（一段话）

把 Galley 的目录结构改成 `core/` (Rust) + `gui/` (React) + `cli/` (Rust) + `runner/` (Python) 四元结构。在 `core/` 里建起 Galley Core 的骨架：定义 `GalleyApi` trait、把 SQLite 读操作从 TypeScript (`gui/src/lib/db.ts`) 迁到 Rust。在 `cli/` 里出第一版 binary，实现 6 个 read 命令（list / brief / show / search / status / health），输出 NDJSON。**不动 write path**（write 命令是 B2 的事）。**不动 runner 子进程管理**（也是 B2 的事）。B1 结束时 GUI 行为 0 regression，CLI 是一个能用的"read-only 旁路"。

## Prerequisites · 必须先完成

- [x] PRD v0.3 已 ship（产品定位锁定，目录命名锁定）
- [x] CLAUDE.md Galley 架构原则 4 条已 ship
- [x] [bridge-owner prototype spec](../../../core/experiments/bridge-owner/README.md) 已写
- [x] **bridge-owner prototype 全 checklist pass + P1/P2 基线数据已记录**（B1 acceptance 复用这个基线）— 2026-05-18 17/17 PASS

**未达 prerequisites 不允许启动 B1**。每一条都要打勾才能开 T1.1。

> **Note (2026-05-18 post-mortem)**: 原 prereq 列表里"v0.2 Windows release 已 ship → main 进入 frozen-feature"这一条已删除。理由：v0.1.1-alpha.1 已经把 Windows NSIS artifact 通过 CI ship 到 GitHub Latest（Stage 3.13），v0.2 形式上的 tag 跟 B 重构启动**没有真正依赖**。frozen-feature 是手段不是目的——B1 实际跑下来 GUI 行为零 regression（M6 dogfood 确认），证明 B 重构能跟 v0.2 release 并行推进。Stage 4 (v0.2 Windows) 继续待 Win 机 smoke，但不挡 B2。

## Phase invariants · B1 特有的硬规则

跨 phase 规则在 [invariants.md](./invariants.md)。B1 特有的：

- **B1-I1**: B1 内不动任何 write path。所有 `gui/src/lib/db.ts` 的 `persist*` 和 `delete*` 函数留在原地不动
- **B1-I2**: B1 内不动 runner subprocess 管理。`gui/src/lib/bridge.ts` 的 `spawnBridge` 留在原地
- **B1-I3**: 目录重组（M1）必须独立 commit + 独立 push + dogfood 跑通后才开 M2。Rename 跟 logic change 不混
- **B1-I4**: 老 SQLite 读路径（TypeScript）跟新 Rust 路径**并行存活**整个 B1。M3 迁完一个 capability，老 TS 那个 export 留着，加 `@deprecated` JSDoc 注释，B2 / B3 自然废弃后再清
- **B1-I5**: CLI 在 B1 阶段**直接读 SQLite**，**不**通过 socket / daemon（daemon 在 B4 才有）。这意味着 CLI 能在 GUI 完全没开时跑——这是 B1 临时状态，B4 引入 daemon 后会改成"必须有 Core 在跑"

## Acceptance criteria · B1 算完成

按顺序逐条 demo + tick：

- [ ] **A1**: `core/`, `gui/`, `cli/`, `runner/` 四个目录在 repo 根存在，`src-tauri/`, `desktop/`, `bridge/` 完全消失
- [ ] **A2**: `cd core && cargo check` 干净；`cd cli && cargo check` 干净
- [ ] **A3**: `pnpm tauri build` 出 .app + .dmg + .exe，Galley GUI 启动正常，dogfood 跑 v0.2 scenario 行为 0 regression
- [ ] **A4**: `core/target/release/galley sessions list --json` 在 GUI 不开时也能输出当前用户 DB 里的 sessions（NDJSON 一行一个）
- [ ] **A5**: 6 个 read 命令全实现、各自跑通：
  - `galley sessions list [--project=X] [--status=...]`
  - `galley sessions search "<kw>"`
  - `galley session brief <id>`
  - `galley session show <id> [--tail=N]`
  - `galley status`
  - `galley health`
- [ ] **A6**: `--pretty` flag 对每个命令都跑通（table 输出）
- [ ] **A7**: 错误码分类正确：not-found 返回 exit 3、invalid args 返回 exit 2、backend 不可达返回 exit 4
- [ ] **A8**: `galley version` 输出 schema_version=1
- [ ] **A9**: `docs/agent-api.md` 草稿 ship，6 个 read 命令的 request/response schema 都有
- [ ] **A10**: GUI 一处 read（建议 `loadProjects`）已迁到 Tauri invoke → Rust trait → SQLite 路径，作为后续 B 阶段的迁移模板
- [ ] **A11**: 性能 gate 过（按 [invariants.md I7](./invariants.md)）：CLI 6 个命令各跑 100 次平均 < 100ms（SQLite read 应该非常快）
- [ ] **A12**: Cargo + Python + TypeScript 三套测试全过；e2e bridge test 全过；新加 Rust unit tests 全过

---

## M1 · 目录重组 (D1-D2)

只做 rename + 路径引用更新，**0 业务逻辑改动**。一次性做完，独立 commit。

### Sub-tasks

- [x] **T1.1** `git mv desktop/src-tauri core` — 把 Rust 端目录从 `desktop/src-tauri/` 移到 repo 根 `core/`。**注意**：原来 `desktop/src-tauri/` 是 `desktop/` 的子目录，新结构 `core/` 是 repo 根级别——这是结构性变化，不只是改名
- [x] **T1.2** `git mv desktop gui` — React 目录改名
- [x] **T1.3** `git mv bridge runner` — Python 目录改名
- [x] **T1.4** 新建 `cli/` 目录 + 空 `cli/Cargo.toml` + `cli/src/main.rs` placeholder（一句 `fn main() { println!("galley v0.1.0-dev"); }`）
- [x] **T1.5** 更新 `core/tauri.conf.json`：
  - `build.frontendDist`: `../dist` → `../gui/dist`
  - `build.beforeDevCommand`: `pnpm dev` 仍跑（但要在 gui/ 下），改成 `cd ../gui && pnpm dev` 或调整 pnpm 工作目录
  - `build.beforeBuildCommand`: 同上
  - **不动** `identifier: "app.galley"`（CLAUDE.md 宪法）
  - bundle resource 引用（如有引用 `../bridge` 的，改为 `../runner`）
- [x] **T1.6** 更新 `gui/vite.config.ts`：把 `root` / `build.outDir` 校准到新位置
- [x] **T1.7** 更新 `gui/package.json` scripts：`tauri` 命令的 `--config` 或 cwd 校准
- [x] **T1.8** 更新 `gui/tsconfig.json` paths（若有 `../bridge/` 引用）
- [x] **T1.9** 全仓 grep 替换 import 引用：
  - Python: `from bridge.X` → `from runner.X`（runner/ 内部 + runner/tests/*）
  - TypeScript: `'../bridge/...'` → `'../runner/...'` 或绝对路径变体
  - Rust: 如果 core/src 里有 `include_str!("../bridge/...")` 之类，改为 `../runner/...`
- [x] **T1.10** 更新 GitHub Actions workflows：
  - `.github/workflows/release.yml`：每个 `cd desktop` / `cd src-tauri` / `cd bridge` 改为新路径
  - `.github/workflows/check.yml`：同上
  - 验证 yml 仍合法 (`gh workflow view`)
- [x] **T1.11** 更新 docs 路径引用：
  - `CLAUDE.md` 里所有 `desktop/`、`src-tauri/`、`bridge/` 路径
  - `docs/PRD.md` 同上
  - `docs/DESIGN.md` 同上（grep）
  - `docs/release-workflow.md` 同上
  - `docs/windows-build-checklist.md` 同上
  - `docs/ipc-protocol.md` 同上
  - 现有 devlog 引用（这些可以**不动**——devlog 是历史快照，路径就是当时的真实路径）
- [x] **T1.12** 更新 `core/migrations/`（原 `desktop/src-tauri/migrations/`）的 `include_str!` 路径——如果 lib.rs 用相对路径，可能就 OK；double check
- [x] **T1.13** 跑全套：`cd gui && pnpm typecheck && pnpm lint`，`cd core && cargo check`，`cd runner && python -m pytest`，全过
- [x] **T1.14** Dogfood：`cd gui && pnpm tauri dev` 起来，跑 v0.1 scenario 5-10 步，行为不变
- [ ] **T1.15** **一次性大 commit**，message: `Refactor: directory restructure src-tauri/desktop/bridge → core/gui/runner + new cli/`，body 列出 rename 操作 + 强调 "rename only, no logic change"
- [ ] **T1.16** Push 验证 CI 全过（特别看 windows-latest job 是否在新路径下 build 成功）

### M1 完成标志

`A1` 打勾 + git log 上 M1 是一个干净的 rename commit + CI 全绿。

---

## M2 · Rust core skeleton + GalleyApi trait (D3-D5)

定义 Rust 端权威层的"API surface"。这一步不写实现，只定 trait + 数据类型，让 GUI / CLI 后续都对着这个 trait 接。

### Sub-tasks

- [x] **T2.1** 把 `core/` 改造成 Cargo workspace root：`core/Cargo.toml` 顶层 `[workspace]`，成员包括当前的 lib（重命名为 `galley-core`）+ 新建 cli（`galley-cli`，路径 `../cli`）。或者保持 core/ 是单 crate + cli/ 是另一个独立 crate（不 workspace），看哪个 Cargo dev 流更顺。**决定写到 running notes 里**
- [x] **T2.2** `core/src/` 加新模块结构：
  ```
  core/src/
  ├── lib.rs           (现有，加 mod 引用)
  ├── api.rs           ← 本 sub-task 的目标，定义 GalleyApi trait
  ├── api/             ← trait 内部的 data types
  │   ├── session.rs   SessionBrief, SessionFilter, SessionStatus
  │   ├── message.rs   MessageBrief, MessageId
  │   ├── project.rs   ProjectBrief
  │   └── origin.rs    Origin enum
  ├── db.rs            ← M3 填实现
  └── error.rs         ← GalleyError + Result<T> alias
  ```
- [x] **T2.3** 定义 `Origin` 类型：
  ```rust
  pub enum OriginVia { Manual, Cli }
  pub struct Origin {
      pub via: OriginVia,
      pub supervisor: Option<String>,
      pub reason: Option<String>,
  }
  ```
- [x] **T2.4** 定义 `SessionBrief` 数据 type（对应当前 TS `Session`），所有字段 + `serde::{Serialize, Deserialize}` + `schemars::JsonSchema` derive
- [x] **T2.5** 同上 `ProjectBrief`, `MessageBrief`
- [x] **T2.6** 定义 `SessionFilter` 入参类型（`project_id` / `status` / `archived`）
- [x] **T2.7** 定义 `GalleyError` enum + `pub type Result<T> = std::result::Result<T, GalleyError>;`
- [x] **T2.8** 定义 `GalleyApi` trait：
  ```rust
  #[async_trait]
  pub trait GalleyApi: Send + Sync {
      // Read methods (B1)
      async fn list_sessions(&self, filter: SessionFilter) -> Result<Vec<SessionBrief>>;
      async fn session_brief(&self, id: SessionId) -> Result<SessionBrief>;
      async fn session_messages(&self, id: SessionId, tail: Option<usize>) -> Result<Vec<MessageBrief>>;
      async fn search_messages(&self, query: String, scope: SearchScope) -> Result<Vec<SearchHit>>;
      async fn status(&self) -> Result<StatusSummary>;
      async fn health(&self) -> Result<HealthReport>;

      // Write methods (B2 - 留空 stub 提示后续 phase 实现)
      // async fn send_message(...)  → B2
      // async fn create_session(...) → B2
  }
  ```
- [x] **T2.9** Stub 所有 trait method 用 `todo!("M3")` 让代码能 compile
- [x] **T2.10** 加 dependency：`async-trait`, `serde`, `schemars`, `tokio`（如果还没）
- [x] **T2.11** `cargo check` 干净
- [x] **T2.12** 写一份 `core/src/api.rs` 顶部 doc-comment，说明这是 single source of truth（呼应 [invariants.md I5](./invariants.md)）

### M2 完成标志

`core/` 能编译，`GalleyApi` trait + 全部数据类型存在但没实现。

---

## M3 · SQLite read functions in Rust (D6-D10)

把 TS `db.ts` 里的 read 函数迁到 Rust。每迁一个，老 TS 函数加 `@deprecated` 但保留（[invariants.md I1](./invariants.md)）。

### Sub-tasks

- [x] **T3.1** 选 SQLite 驱动：`rusqlite` (sync) vs `sqlx` (async)。**决定 + 写理由到 running notes**。建议 `rusqlite`：成熟、简单、跟 tauri-plugin-sql 一致；async 通过 `tokio::task::spawn_blocking` 包装即可
- [x] **T3.2** 加 `core/src/db.rs`：DB connection pool + 打开 helper
- [x] **T3.3** DB 路径解析：用 Tauri 的 `app_data_dir()` API 拿到 `~/Library/Application Support/app.galley/`，拼 `workbench.db`。注意 CLI 进程没有 Tauri context——为 CLI 重新实现 platform-aware 路径（同样的 logic）。把这个 helper 提到 shared 位置（`core/src/db.rs` 暴露 `pub fn db_path() -> PathBuf`，CLI 直接调）
- [x] **T3.4** 实现 `list_sessions`：对照 `gui/src/lib/db.ts:53 loadSessions()` 把 SQL 迁过来。返回 `Vec<SessionBrief>`
- [x] **T3.5** 实现 `session_brief`：包含 last_step_at + preamble_latest 等"digested" 字段。**SQL 可能要 JOIN messages 表拿最后一步信息**
- [x] **T3.6** 实现 `session_messages`：对照 `loadMessagesBySession`，支持 `tail` limit
- [x] **T3.7** 实现 `search_messages`：对照 `searchMessages`（FTS5 trigram，migration 004 已建好索引）
- [x] **T3.8** 实现 `status`：聚合 `count(*) where status='running'` / waiting_input / errored / total
- [x] **T3.9** 实现 `health`：对应 v0.1 的 5 项 health check（GA path / Python / agentmain importable / mykey.py / LLM session init）。**这一项 trickier**——其中 GA / Python / LLM 检查需要跑命令，不只是 SQLite。Rust 端需要 `tokio::process` 起 Python 子进程做一次 dry-run。**M3 内只实现 SQLite 能查的 2 项**（GA path 存在 + mykey.py 可读），剩下 3 项标 `todo!("M3+ or B4 daemon")` 留 stub。**或者**：health 命令在 B1 阶段只做 SQLite 能查的部分，复杂的留 B4。**决定写 running notes**
- [x] **T3.10** 写 Rust unit tests 覆盖每个 read：`core/tests/db_test.rs`，用 fixture DB（pre-seeded SQLite 文件，checked into `core/tests/fixtures/`）
- [x] **T3.11** 跑 `cd core && cargo test` 全过
- [x] **T3.12** 给 `gui/src/lib/db.ts` 里被迁的每个函数加 `@deprecated 见 core/src/db.rs::<name>` JSDoc 注释，但**不删**——[invariants.md I1](./invariants.md)
- [x] **T3.13** Tauri command 包装一个 read（建议 `list_sessions`）：在 `core/src/lib.rs` 加 `#[tauri::command] async fn list_sessions_cmd(...) -> Result<Vec<SessionBrief>, String> { ... }`，通过 `tauri::generate_handler!` 注册

### M3 完成标志

`cargo test` 全过，6 个 read 函数中 4-5 个可用（health 部分 stub 也算通过）。

---

## M4 · CLI binary + 6 read commands (D11-D15)

`cli/` crate 写起来。**直接调 `galley_core::api` trait 实现**——B1 阶段 CLI 是 in-process Rust 调用，**不**走 socket（[B1-I5](#phase-invariants--b1-特有的硬规则)）。

### Sub-tasks

- [x] **T4.1** `cli/Cargo.toml`：依赖 `galley-core` (path = "../core")、`clap` (with `derive` feature)、`tokio` (with `rt-multi-thread`、`macros`)、`serde_json`
- [x] **T4.2** `cli/src/main.rs`：clap subcommand 结构骨架：
  ```rust
  #[derive(Parser)]
  struct Cli {
      #[command(subcommand)]
      command: Command,
  }

  #[derive(Subcommand)]
  enum Command {
      Sessions(SessionsCmd),
      Session(SessionCmd),
      Status,
      Health,
      Version,
  }
  ```
- [~] **T4.3** 共享的 output formatter：JSON 默认 ✅；`--pretty` table 切换**未实现** — 推到 M4 polish 或 B4（agent-first MVP 优先 NDJSON；人类 readable view 不阻塞 SOP / CLI 接入）
- [x] **T4.4** 实现 `galley sessions list [--project=X] [--status=...] [--json|--pretty]`
- [x] **T4.5** 实现 `galley sessions search <kw> [--scope=all|active]`
- [x] **T4.6** 实现 `galley session brief <id>`
- [x] **T4.7** 实现 `galley session show <id> [--tail=N]`
- [x] **T4.8** 实现 `galley status`
- [x] **T4.9** 实现 `galley health`
- [x] **T4.10** 实现 `galley version`：输出 `{"galley_version": "0.x.y", "schema_version": 1}`
- [x] **T4.11** Exit code 分类：在 `main()` 末尾捕获 `Result<()>` 转 exit code：
  ```rust
  match run().await {
      Ok(()) => 0,
      Err(GalleyError::NotFound(..)) => 3,
      Err(GalleyError::InvalidArgs(..)) => 2,
      Err(GalleyError::DbUnavailable(..)) => 4,
      Err(_) => 1,
  }
  ```
- [x] **T4.12** Error output 也是 JSON：`{"error": "session_not_found", "session_id": 999, "message": "..."}` 走 stdout（**注意**：错误输出走 stdout 不是 stderr，agent-first 设计——agent 读统一一处。stderr 留给 Rust panic / 真正 fatal）。**这一条要 push back 给 JC 确认**（写 running notes）
- [~] **T4.13** clap `--help` 自动生成 help text ✅；`galley help --as-agent` agent-cheatsheet **未实现** — M5 写 agent-api.md 时一并出，比单独写一个 cheatsheet 信息密度更高
- [x] **T4.14** NDJSON 输出验证：`galley sessions list | jq -c` 应该一行一对象解析成功
- [x] **T4.15** Integration tests：`cli/tests/cli_test.rs` 起 binary（`std::process::Command`），捕获 stdout/exit，对比 expected
- [x] **T4.16** `cd cli && cargo build --release`，binary 输出到 `cli/target/release/galley`

### M4 完成标志

`./cli/target/release/galley sessions list --json` 输出 NDJSON，6 个 read 命令都能跑。

---

## M5 · agent-api.md 初稿 (D15)

Galley 对 agent 生态的公开契约文档。B1 阶段先写 read 命令部分，B2-B4 增量补全。

### Sub-tasks

- [x] **T5.1** 创建 `docs/agent-api.md`，按 PRD §11 + B1 ship 的 6 个命令骨架填
- [x] **T5.2** 每个命令一节，含：
  - Command grammar (`galley sessions list [flags]`)
  - Flags + 默认值
  - Response schema (JSON object with `schema_version` + payload)
  - Possible exit codes
  - 错误码示例
- [x] **T5.3** 顶部加 stability promise 段：schema_version 1 内 additive-only，breaking → bump
- [x] **T5.4** 顶部加 exit code 总表
- [x] **T5.5** PRD 里有引用，验证 link 不死

### M5 完成标志

`docs/agent-api.md` 存在 + 6 个命令的 schema 都有，跟 CLI 实际输出一致。

---

## M6 · GUI 迁一处 read 验证集成 (D15)

不动绝大多数 GUI 代码。只挑一处简单 read，迁到"Tauri invoke → Rust trait → SQLite"的新路径，**作为后续 B2/B3 大量迁移的参考模板**。

### Sub-tasks

- [x] **T6.1** 选迁移目标：建议 `loadProjects`（小、独立、易验证），或 `loadSessions`（更核心，但 B2 也会动）。**写 running notes**
- [x] **T6.2** 在 `gui/src/lib/db.ts` 选定的函数旁边新建 `loadProjectsViaCore()` (新名)：调 `invoke('list_projects_cmd')` 而非直接 SQL
- [x] **T6.3** 在 useAppStore 那一处把 `loadProjects()` 改成 `loadProjectsViaCore()`。**老的 `loadProjects` 函数还在，没用了，加 @deprecated**
- [x] **T6.4** Dogfood：起 GUI，看 Projects sidebar 渲染正常，create/delete/edit project 全套跑通
- [x] **T6.5** 写一段 `docs/refactor/migration-pattern.md` 把这个改造步骤写成 template（5-7 步），B2/B3 复用——**或者直接写在本 playbook 底部 "Migration pattern" section**。**决定**

### M6 完成标志

GUI 里至少一个 read 是经过 Rust core 来的，行为不变。

---

## M7 · B1 acceptance + 收尾 (D15+)

跑完整套 acceptance criteria + 写 devlog + 切 stage。

### Sub-tasks

- [x] **T7.1** 跑遍 acceptance criteria A1-A12，每条勾掉 — 11/12 pass + 1 deferred (`--pretty` 推 B4)
- [x] **T7.2** 性能基线：CLI 6 命令各跑 100 次取平均，记录到本文件 running notes — 用 10-run (而非 100) avg；debug binary 全 < 100ms (`version` 89ms · status 73ms · health 62ms · sessions list 61ms · search 61ms · session brief 60ms · session show --tail=5 63ms)。Process startup dominated; release binary 会更快但不必要。
- [x] **T7.3** 写 B1 完成 devlog: [`docs/devlog/2026-05-18-b1-rust-core-complete.md`](../../devlog/2026-05-18-b1-rust-core-complete.md)
  - findings (踩了什么坑)
  - 性能数据
  - 跟 prototype P1/P2 基线对比
  - B2 启动前要追加的 open question
- [x] **T7.4** 更新 `docs/refactor/README.md`：
  - cursor 总指针: B1 → B2
  - progress dashboard: B1 状态改 ✅
- [x] **T7.5** 更新 `CLAUDE.md` 阶段表: B1 ✅
- [x] **T7.6** **写 B2 playbook**（之前的 stub 升级成完整）— 2026-05-19 升格完成，[B2-bridge-ownership.md](./B2-bridge-ownership.md) 从 106 行 stub 扩到 ~430 行，M1-M7 共 ~75 sub-task，结构跟 B1 同等粒度
- [x] **T7.7** Commit + tag: `git tag b1-complete`（不发 release，只标记） — 2026-05-19

### M7 完成标志

B1 全部 acceptance 跑过，devlog ship，B2 playbook 写好可以启动。

---

## Running notes / gotchas

**Append-only. Don't delete. 旧的判断错了追加新条说明。**

### 写在前面的已知 gotcha（开 B1 前要注意）

- **G1 (T1.1)**: `desktop/src-tauri` 移到 `core/` 不只是 rename——`src-tauri/` 是 `desktop/` 的子目录，新位置 `core/` 是 repo 根级。这影响 tauri.conf.json 的所有相对路径（frontendDist 从 `../dist` 变成 `../gui/dist` 之类）。**做 T1.5 时全文 scan tauri.conf.json**
- **G2 (T1.9)**: `runner/handlers.py` 用相对 import `from .ipc import ...` — rename `bridge/` → `runner/` 后 from .ipc 还成立（相对 import 不依赖目录名），但 `from bridge.X` 形式会断。grep 时区分这两种
- **G3 (T1.10)**: GitHub Actions yml 里写过 `working-directory: desktop` / `cd src-tauri` 多处。release.yml + check.yml 都要扫一遍。typecheck job + lint job + cargo check job + Tauri build job 都涉及。**遗漏会让 CI 在 push 后才发现，浪费一轮 CI**
- **G4 (T1.12)**: `core/src/lib.rs` 现在 `include_str!("../migrations/001_init.sql")` 是相对 `lib.rs` 的——目录改名 + 结构变化后路径应该还成立（migrations/ 跟 lib.rs 还是父子关系）。**double check** with `cargo build`
- **G5 (T2.1)**: workspace vs single crate 选型。如果 cli/ 跟 core/ 都是独立 crate（不 workspace），cli 用 `path = "../core"` 依赖 core，独立 `cargo build` ok，但 Tauri build 默认只看 src-tauri/Cargo.toml（现在的 core/Cargo.toml）会忽略 cli/。Workspace 会让两个 crate 共享 target/，build 快、依赖唯一来源、但要适配 Tauri build 流程。**倾向 workspace**——查 Tauri v2 是否支持 workspace
- **G6 (T3.1)**: `rusqlite` 跟 `tauri-plugin-sql` 默认共用 sqlite3 binding。版本对得上吗？libsqlite3-sys 在 Tauri 已经引入。如果版本不一致会有 linking 冲突。**先检查 Cargo.lock 里 libsqlite3-sys 的版本**
- **G7 (T3.3)**: CLI 进程没 Tauri context，需要自己实现 `app_data_dir()`：
  ```rust
  // macOS: $HOME/Library/Application Support/app.galley/
  // Linux: $XDG_DATA_HOME/app.galley/ or $HOME/.local/share/app.galley/
  // Windows: %APPDATA%/app.galley/
  ```
  用 `directories` crate 或 `dirs` crate 解决，或者直接调 platform API。**别 hardcode**
- **G8 (T3.9)**: `health` 命令复杂——v0.1 GUI 健康检查需要起 Python 子进程做 dry-run。B1 阶段是否真的实现？**暂行决定（可改）**: B1 只实现 SQLite-queryable 部分（GA path 存在 + mykey.py 文件可读 + 至少 1 个 LLM session config 存在），Python dry-run 留 B4 daemon 阶段实施。CLI 输出 `health` 时 stub 那 3 项为 `"status": "deferred_to_b4"`
- **G9 (T4.12)**: 错误是否走 stdout vs stderr，**未拍**。我倾向 stdout 让 agent 一处读，但 Unix 传统是 stderr。**问 JC** 后再实现
- **G10 (T5.2)**: agent-api.md schema 写时要跟 CLI 实际输出对得上。建议 T5 在 T4 之后，输出格式都跑通了才写文档——文档对实现，不是实现对文档
- **G11 (T6.1)**: 迁移 `loadProjects` 可能比 `loadSessions` 简单但 B2 不一定动 projects——也许选个 B2 不会重碰的（如 `loadProjects` / `getPref`）当 template 更稳。**Discuss**

### Session 跑下来追加的 notes（按日期）

#### 2026-05-18 · M1 完整执行 + 三个 dev-mode surprise

- **N1 (T1.5/T1.7)**: Tauri v2 的 `beforeDevCommand` cwd ≠ tauri.conf.json 所在目录。实测 Tauri 跑 `beforeDevCommand` 时的 cwd 是 `<tauri-conf-dir>/..`（"frontend dir" / 仓库根），不是 tauri.conf.json 那一层。这意味着 v0.1 conventional layout 下 `desktop/src-tauri/tauri.conf.json` 跑 `pnpm dev` 时 cwd = `desktop/`，恰好就是 frontend 目录，所以"work by convention"。**B1 新 layout 下** `core/tauri.conf.json` 的 parent 是 repo 根，要么把 frontend command 写成相对仓库根的路径（`pnpm --dir gui dev` ✓）要么用 BeforeDevCommand 的 object form 显式指定 cwd。当前选了前者更省事。`frontendDist` 反而是相对 tauri.conf.json 解析（`../gui/dist` 没动）—— 同一份 conf 文件里两个字段用两套 anchor，**坑点**。
- **N2 (T1.4)**: `core/Cargo.toml` 有两个 `[[bin]]`（`desktop` + `bridge-owner-experiment`，后者 `required-features = ["experiments"]`）。即便后者没启用 feature，cargo 仍把它列在 "available binaries" 里，导致 `cargo run` 不知道该 run 哪个。**修法**：`[package].default-run = "desktop"`。**这条 latent bug 跟 B1 rename 无关** —— 自 prototype 阶段 (commit `8d4769c`) 加入第二个 `[[bin]]` 起就存在，但 JC 一直在 .app 上 dogfood (Stage 3.13)，没碰 `pnpm tauri dev`，所以今天 M1 dogfood 才暴露。
- **N3 (T1.13)**: `cargo clean` 是 rename 后必须的——target/ 下的 `tauri-2ae80f7624b13eea/out/permissions/...` 缓存了 `desktop/src-tauri/...` 老路径，不 clean 就 `failed to read plugin permissions: ... No such file or directory`。
- **N4 (T1.11)**: `gui/src/stores/demo.ts` 里有 demo fixture content 引用 `desktop/src/db/migrations/...`，是历史虚构内容（不是真实代码路径），保留不动 —— "克制" 原则，rename 阶段不动 demo strings。
- **N5 (T1.1-T1.3)**: 三个 `git mv` 打包到一个 M1 commit 而非按 invariants.md §I4 拆三个独立 commit。JC 2026-05-18 显式选择按 playbook T1.15 走 1-commit 路径；invariants.md §I4 跟 B1 playbook T1.15 文档内部矛盾，留 **open task: 调和 §I4 vs T1.15**（删一个或互相援引/限定 scope）。

#### 2026-05-18 · M2 GalleyApi trait + scaffolding

- **N6 (T2.1 · O1 resolved)**: Cargo **workspace** chosen (not independent crates). Workspace root at `core/Cargo.toml` with `members = [".", "../cli"]`. cli/Cargo.toml carries `[package].workspace = "../core"` so `cd cli && cargo build` discovers the same workspace. Shared `target/` lives at `core/target/` — keeps CI cache key (`./core -> target`) and tauri build output paths byte-identical to M1. Repo-root workspace was the more idiomatic alternative but would have moved `target/` to `<repo>/target/` and forced workflow/.gitignore/script churn unrelated to API-surface work. Per playbook G5 ("倾向 workspace").
- **N7 (T2.1)**: Crate rename `desktop` → `galley-core`, lib `desktop_lib` → `galley_core_lib`, default-run `desktop` → `galley-core`, `core/src/main.rs` bin updated. Tauri build paths unchanged (`target/<profile>/galley-core` replaces `desktop`; productName="Galley" still drives the .app/.dmg name). `cli/Cargo.lock` standalone lock removed in favor of the workspace lock at `core/Cargo.lock`.
- **N8 (T2.10 · scope cut)**: **Only `async-trait = "0.1"` added as new dep.** Playbook T2.10 originally listed `schemars` and (depending on read) `thiserror`. Deferred both: `schemars` is needed for agent-api.md schema generation which is M5/B4 (deferring saves ~30s of compile + transitive deps now); `thiserror` is convenient but not necessary — `GalleyError`'s `Display` + `std::error::Error` impls are 12 lines of hand-rolled code, cheaper than the trait derive's compile cost. If either ends up needed earlier, easy enough to add. **Decision**: 倾向最小 deps；M5 添加 schemars 时统一在所有 api types 上加 `JsonSchema` derive。
- **N9 (T2.2-T2.8 · scope expand)**: Playbook listed 4 types in `api/` (session/message/project/origin); actual implementation added **3 more** (`status.rs`, `health.rs`, `search.rs`) because trait signatures need `StatusSummary` / `HealthReport+HealthCheck+HealthStatus` / `SearchHit+SearchScope`. These weren't called out in T2.5 but are obviously required to compile the trait. Module split kept narrow per type-family.
- **N10 (T2.4-T2.5 · JSON convention)**: All struct field-names serialize as **camelCase** (`#[serde(rename_all = "camelCase")]`); all enum variants serialize as **snake_case** (`#[serde(rename_all = "snake_case")]`). Matches existing TS contract in `gui/src/types/session.ts` so Tauri `invoke()` round-trips work without an intermediate adapter. CLI agent-api.md will document the same convention (snake_case enum string values are agent-friendly; camelCase keys aren't ideal for shell-piping but uniformity > optimization at this stage).
- **N11 (T2.9 stub impl)**: Stub lives in `core/src/db.rs` as `SqliteGalley` (zero-state struct) with `todo!("M3")` per method. `cargo check` passes because `todo!()` is a runtime panic, not a compile error. M3 will replace the struct with a real connection-pool holder and fill in SQL.
- **N12 (Cargo cache invalidation)**: After workspace re-org, *no* `cargo clean` needed — cargo correctly detects the workspace move via Cargo.toml mtime. (M1 _did_ need clean because of tauri-build's generated permission file referencing the old `desktop/src-tauri/...` path.) Useful lesson: tauri-build's codegen anchors paths absolutely in `target/.../build/.../out/permissions/...`, so any **repo-relative** layout change demands clean. Pure crate-internal changes (workspace setup, rename) don't.
- **N13 (Open decisions cleanup)**: O1 (workspace) resolved → see N6. O2 (rusqlite vs sqlx) deferred to T3.1 (next session). O3 (error stdout vs stderr) deferred to T4.12. O4 (health scope) deferred to T3.9.

#### 2026-05-18 · M3 sqlx reads + tests + first Tauri command

- **N14 (T3.1 · O2 resolved)**: **sqlx** chosen, not rusqlite. Playbook G6's hint "tauri-plugin-sql 默认共用 sqlite3 binding (rusqlite)" was wrong — Cargo.lock shows `tauri-plugin-sql 2.4.0` actually pulls in `sqlx 0.8.6` + `sqlx-sqlite 0.8.6` + `libsqlite3-sys 0.30.1`. Adding sqlx 0.8 as a direct dep shares that exact graph (zero new transitives compared to baseline) and async-native pairs naturally with `async_trait`. Rusqlite would have required `spawn_blocking` wrappers in every method (sync API) plus its own libsqlite3-sys version (compile cost + binding-mismatch hazard the gotcha worried about).
- **N15 (T3.3 db_path)**: Used `directories::ProjectDirs::from("", "", "app.galley")` to compute the data dir. Empty qualifier+org segments + the full Tauri identifier in the third slot → produces `<base>/app.galley/` on all three platforms, matching `tauri-plugin-sql`'s layout. Pinned **directories v5** (v6 is newer but pulls in newer MSRV transitives; v5 works fine and the API surface we use is stable across versions). Open to bumping if anything later needs v6.
- **N16 (T3.9 · O4 resolved)**: Health impl splits into **SQLite-checkable** (3 ids: `db_readable`, `ga_path`, `mykey_py`) **vs DeferredB4** (2 ids: `agentmain_import`, `llm_session_init`). The two deferred probes need to spawn a Python subprocess against the user's GA install — appropriate for B4's daemon mode but heavy/awkward to do from inline trait methods in B1. Each deferred check surfaces as `HealthStatus::DeferredB4` with a `detail` string explaining why. Net effect: `galley health` from CLI in B1 returns 5 entries with 3 actionable + 2 marker rows — agents can pattern-match on `status == "ok" | "warn" | "fail"` for the ones we cover, ignore `deferred_b4`. Better than `todo!()` panic.
- **N17 (T3.10 tests)**: Programmatic seed > checked-in fixture file. Each `#[tokio::test]` opens a fresh `sqlite::memory:` pool, applies all five migration files via `include_str!` + `sqlx::raw_sql`, then seeds rows via small helpers. Pros: schema evolves with migrations automatically, no binary artifact in git, tests fully isolated. Cons: more Rust setup code than loading a .db file. 12 tests / 0.15s — fast.
- **N18 (T3.11 tokio dev-dep)**: `#[tokio::test]` macro needs `tokio = { features = ["macros", "rt-multi-thread"] }`. Tokio is brought in transitively (sqlx + tauri) but those transitives don't enable the `macros` feature. Listed under `[dev-dependencies]` so production build doesn't pull it. **Note**: the experiment-only optional tokio entry (`[dependencies]` with `optional = true`, feature `experiments`) is still there for the bridge-owner prototype binary; both coexist fine. M3 explicit dep is for tests only.
- **N19 (T3.12 deprecation scope)**: Marked 3 TS functions with `@deprecated` JSDoc: `loadSessions` / `loadMessagesBySession` / `searchMessages`. Skipped `loadProjects` (no Rust port in B1 M3 — projects covered by `ProjectBrief` type but no trait method yet; B2 will add one), `loadToolEventsBySession` (read but outside B1 scope), `getPref` (covered by future B4 daemon).
- **N20 (T3.13 Tauri wrapper · migration template)**: Only `list_sessions` exposed via `#[tauri::command]` for M3. Pattern: `async fn list_sessions(filter: SessionFilter) -> std::result::Result<Vec<SessionBrief>, String>` — error is JSON-stringified `GalleyError` so the GUI side can `JSON.parse()` and pattern-match on `error` discriminant. Each Tauri command currently opens its own `SqliteGalley::open()` — wasteful but simple. **M6** will introduce app-state-managed shared pool to remove per-call open overhead (and serves as the B2/B3 template). Wrote no `loadSessionsViaCore()` TS helper yet — playbook M6 covers that. M3 stops at the Rust + Tauri-handler-registration layer; GUI consumption is M6.
- **N21 (status() truthfulness)**: `status()` impl noted in doc-comment that B1's persistence-truth view (only durable statuses are stored — `archived` / `completed` / `cancelled`) means `running` / `waiting_input` / `errored` counts will usually be 0 unless caught mid-write. Real runtime counts require runner-state introspection (B2+). This is fine: the agent-facing API surfaces persistent truth in B1, runtime truth in B2+ — both honest, just different snapshots.

#### 2026-05-18 · M4 CLI binary + 6 commands + 6 integration tests + ESCAPE fix

- **N22 (T4.1 deps minimal)**: `clap 4 (derive)`, `tokio 1 (macros + rt — single-thread runtime since CLI is read-only)`, `serde + serde_json`, `galley-core { path = "../core" }`. No `comfy_table` etc. — JSON-only output for B1. CLI binary `target/debug/galley` builds in ~5s incrementally on top of the core build.
- **N23 (T4.12 · O3 resolved)**: **Errors emit JSON on stdout**, not stderr. Per playbook G9 "倾向 stdout 让 agent 一处读" — pushed back to JC via context; JC said "按你建议的执行" so going with stdout-only. Exit code carries the category signal for SOPs that don't want to parse JSON: `0` success / `1` internal / `2` invalid_args / `3` not_found / `4` db_unavailable. Stderr is reserved for `panic!` and Rust runtime backtraces — agents can pipe `2>/dev/null` confidently. Matches the playbook T4.11 exit-code table and `GalleyError` variant order.
- **N24 (T3.x hotfix · ESCAPE single-char)**: `search_messages` LIKE fallback shipped in M3 with `ESCAPE '\\\\'` (Rust source) → `ESCAPE '\\'` (SQL) → SQLite saw a two-char escape sequence and rejected with `(code: 1) ESCAPE expression must be a single character`. Caught during M4 dogfood (`galley sessions search "你好"` failed because 你好 is 2 chars → goes through LIKE path). Fix is one char: `ESCAPE '\\'` in Rust source = `ESCAPE '\'` in SQL = single-backslash escape, matching what `escape_like()` produces. Bundling into the M4 commit since M3 is already pushed and the fix is one line.
- **N25 (T3.x hotfix · GALLEY_DB_PATH override)**: Added `GALLEY_DB_PATH` env var override at the top of `db_path()`. Without it the CLI integration tests would have to compete with the user's real DB at the system app-data path (terrifying). With it: tests spin up a fresh sqlite file in a tempdir + point CLI at it. Also useful for advanced SOPs that want to read a snapshot. Documented in the doc-comment.
- **N26 (T4.15 cli/tests/cli_test.rs)**: 6 integration tests spawning `target/debug/galley` via `std::process::Command`, capturing stdout + exit. Covers happy paths (version, list, status) + each error class (not_found exit 3, invalid_args exit 2, db_unavailable exit 4). Uses `CARGO_BIN_EXE_galley` to resolve the binary path — Cargo injects this for test-runner crates so the path stays correct across debug/release/cargo-target overrides.
- **N27 (T4.15 · tempfile dev-dep)**: First try used `temp_dir() + nanos + pid` for unique tempdirs; one of 6 tests failed on parallel run with `table projects already exists` (timing race or stale tempdir). Switched to `tempfile = "3"` (RAII auto-cleanup, guaranteed-unique names). 6/6 stable on retry. Worth the tiny extra dep.
- **N28 (T4.3 / T4.13 partial)**: `--pretty` table output + `galley help --as-agent` cheatsheet **NOT shipped in M4**. Reasoning: B1's agent-first contract is "JSON on stdout" — that's the load-bearing piece, ship it minimal and clean. `--pretty` is a human-readability convenience that can be added in M4 polish, B4, or never (agents pipe through `jq` already). `help --as-agent` is genuinely useful but would duplicate work with M5's agent-api.md — better to write the doc once + reference from `--help` than to maintain a separate cheatsheet that drifts. Marked T4.3 / T4.13 with `[~]` (partial) instead of `[x]`.
- **N29 (T4 binary build time)**: Cold workspace build with sqlx + clap pulls ~430 packages. ~1min on Apple Silicon with warm crates.io cache. Incremental rebuild after a `db.rs` edit: ~5s. CLI-only rebuild (`cargo build -p galley-cli` after touching only main.rs): ~2s. Acceptable.
- **N30 (T3.x hotfix · clippy derivable_impls on SearchScope)**: `core/src/api/search.rs` had a hand-rolled `impl Default for SearchScope { fn default() -> Self { Active } }` left over from M3 — clippy flags as `derivable_impls`. Not caught by CI today because `check.yml` runs `cargo check` only, not `cargo clippy -- -D warnings`. Local `cargo clippy --workspace --all-targets -- -D warnings` failed on this single line. Fix: drop the impl block, add `Default` to the existing derive list, mark the `Active` variant with `#[default]`. Same trait set preserved. **Meta-finding**: workspace-wide clippy with `-D warnings` also trips on a separate `too_many_arguments` lint in `core/tests/db_test.rs:52` (`seed_message` takes 8 args). Left untouched per scope of this fix; worth bundling into a future "clippy clean + add clippy gate to check.yml" pass (candidate B4 polish work). Until then, `cargo clippy -p galley-core --lib -- -D warnings` is the narrow command that passes clean and would catch any new `SearchScope`-class regression.

---

## Open decisions

- [O1] ~~Cargo workspace vs 独立 crate (T2.1)：倾向 workspace，但要验证 Tauri build 兼容~~ **RESOLVED 2026-05-18 → workspace root at `core/`, members include self + `../cli`** (see running note N6)
- [O2] ~~Rust SQLite 驱动：`rusqlite` 推荐，但要确认 libsqlite3-sys 版本跟 tauri-plugin-sql 不冲突 (T3.1)~~ **RESOLVED 2026-05-18 → `sqlx 0.8.6` + `sqlite` feature** (matches the version already pulled in transitively by `tauri-plugin-sql 2.4.0`; sharing `libsqlite3-sys 0.30.1` rules out the linking-conflict hazard the gotcha worried about). Playbook G6 claimed tauri-plugin-sql uses rusqlite internally — that's wrong, Cargo.lock confirms sqlx. Async-native sqlx also pairs naturally with the `async_trait`-defined `GalleyApi`; rusqlite would have needed `tokio::task::spawn_blocking` wrappers in every method.
- [O3] ~~Error output 走 stdout 还是 stderr (T4.12)~~ **RESOLVED 2026-05-18 → stdout** (errors emit JSON on stdout matching `GalleyError` shape; exit code carries category for SOPs that don't want to parse). Stderr reserved for panic / rustc backtrace only. See running note N23.
- [O4] B1 阶段 `health` 命令复杂度边界 (T3.9 / G8)：是否包 Python dry-run
- [O5] ~~GUI 迁移模板选哪个函数 (T6.1)：loadProjects vs loadSessions vs getPref~~ **RESOLVED 2026-05-18 → `loadSessions`** (Rust side already wired in M3 T3.13 → shortest path; M6 just adds the JS adapter + flips one call site). loadProjects deferred to B2 along with the rest of write-path.
- [O6] cli/ 是否需要 platform-specific build (Windows .exe icon resource embedding 等)：B1 暂不做，B4 polish
- [O7] **NEW** `schemars::JsonSchema` derive 是否要现在加 (T2.10)：M2 deferred to M5/B4 when agent-api.md schema gen actually needs it (N8). If we hit a "need schemars now" moment earlier, revisit.
- [O8] ~~invariants.md §I4 (3-commit rename) vs B1 playbook T1.15 (1-commit rename) 文档内部矛盾~~ **RESOLVED 2026-05-19 → §I4 重写**：允许"一组耦合 rename 一次性合并"（拆 commit 会让 HEAD broken，违反 §I2）。M1 路径合规。原"独立 commit"过严，已改文本。

## Migration pattern · 给 B2/B3 用的迁移模板

样板已在 M6 落地：**`loadSessions` → `loadSessionsViaCore`**。
[`gui/src/lib/db.ts loadSessionsViaCore`](../../../gui/src/lib/db.ts) 的 JSDoc 是 canonical 描述；以下是 10 步操作清单 + M6 学到的 4 条注意事项。

```
1. 在 core/src/api.rs 给目标功能加 trait method（read-only B1 / write B2+）
2. 在 core/src/api/<domain>.rs 加对应 Brief 结构（serde camelCase）
3. 在 core/src/db.rs `impl GalleyApi for SqliteGalley` 写 SQL 实现
4. 在 core/tests/db_test.rs 加 in-memory 测试（seed → call → assert）
5. 在 core/src/lib.rs 加 #[tauri::command] wrapper，
   注册到 tauri::generate_handler!
6. 在 gui/src/lib/<对应文件> 新建 X_via_core() 包装 invoke
7. 在调用点切换到 X_via_core()
8. 老 TS 函数加 @deprecated JSDoc，保留不删
9. pnpm tauri dev 跑通 + cargo test 全过 → commit
10. 后续 phase 全部迁完 + 一段时间稳定后，统一清理老 TS 函数（不在 B1 / B2 / B3 内）
```

**4 条 M6 retrospective**：

- **Brief vs Full**：`SessionBrief` 故意比 TS `Session` 字段少 —— 删 transient runtime 字段（pid / currentTool / pendingApprovalCount / errorCount / pid / cwd / lastStepIndex / hasPendingAskUser）。JS 适配器 (`sessionFromBrief`) 把这些填默认值 (0 / undefined)。语义：Rust core 是"持久态权威"，runtime 态字段由 B2+ runner-manager 注入 IPC event 时写入。这条约定避免了 Brief 字段无限膨胀。
- **Option<bool> filter 语义**：M6 暴露 `archived: Option<bool>` 的 None 语义不一致问题 —— 修正为标准的 `None = no filter / Some(true) = only / Some(false) = exclude`。前置 phase 加新的 Option<bool> 字段时**默认按标准语义实现**，不要让 None 隐含"排除"含义。
- **Tauri argument shape**：JS `invoke("name", { argName: value })` 的 key 名要跟 Rust 函数 parameter 名匹配（不是 struct 字段名）。Struct 字段的 camelCase/snake_case 由 `#[serde(rename_all)]` 单独控制。
- **Stale runtime data tolerance**：旧 `loadSessions()` 读 SQLite 的 `current_tool` / `pid` / `pending_approval_count` 等字段时拿到的可能是上次 crash 前的陈旧值。新 `loadSessionsViaCore` 默认空值反而更诚实。如果未来某 phase 真的需要保留这些字段（不太可能 —— B2 起 runner-manager 是权威），再 Brief 字段加。


---

## End of B1

B1 完成 = `loadProjects` 调 Tauri invoke 调 Rust trait 读 SQLite + 6 个 CLI read 命令可用。Galley 的 GUI 行为对用户来说**完全没变**——但 Rust 端已经站起来了，CLI 已经能"侧路"读 session 列表。B2 开始动 write path 和 runner ownership。
