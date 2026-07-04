# B4 M8 sub-plan · v0.x → v0.2 data migration 备份机制

> **Status**: draft, ship 前 review。Sub-plan 完成后开 implementation。
> **Parent**: [B4 playbook M8](./B4-cli-bg-artifact.md)
> **Invariant**: [B4-I6 Migration 备份强制](./B4-cli-bg-artifact.md#phase-invariants--b4-特有的硬规则)
> **Date**: 2026-05-20

---

## 0. TL;DR

playbook M8 写 "schema 010-014 + backup + dogfood"，今天 re-scope 后**真活儿只剩 backup**。理由：B2 M5 (mig 006/007) 已经把 supervisor / origin / created_via 字段全部 ship 进 schema，**v0.2 没新增 schema migration**。M8 实际工作 =

1. **写入一次性 backup mechanism**（B4-I6 兑现）：startup-time 检测 on-disk migration version < code-side max → 备份 `~/Library/Application Support/app.galley/` 整目录到 `app.galley.backup.<timestamp>/` → 再让 tauri-plugin-sql 跑迁移
2. **失败 = 拒启动**：backup 失败弹 dialog 指向数据目录 + 拒绝继续，**不**降级运行（dogfood 数据 6+ 月不允许丢）
3. **dogfood T8.7 + rollback strategy T8.8**：JC 实测 + 写 release notes 备份指引

playbook 列的 "migration 010-014" 4 个 sub-task **全删**（schema 没要改的）。新 sub-task 集中在 backup mechanism。

---

## 1. Scope re-assessment vs playbook

### 1.1 现状对照

| 字段 | playbook 假设 | 实际 |
|---|---|---|
| `messages.created_via` | M8 T8.1 新增 | ✅ 已在 mig 006 (B2 M5 ship) |
| `messages.supervisor` | M8 T8.2 新增 | ✅ 已在 mig 006 (B2 M5 ship) |
| `messages.origin_note` | M8 T8.3 新增 | ✅ 已在 mig 006 (B2 M5 ship) |
| `sessions.created_via` | M8 T8.4 新增 | ✅ 已在 mig 007 (B2 M5 ship) |
| `sessions.created_by_supervisor` | M8 T8.4 新增 | ✅ 已在 mig 007 (B2 M5 ship) |
| `sessions.created_origin_note` | M8 T8.4 新增 | ✅ 已在 mig 007 (B2 M5 ship) |
| backup mechanism | M8 T8.5 | ⏳ M8 本子任务 |
| backup 失败 reject startup | M8 T8.6 | ⏳ M8 本子任务 |
| dogfood real run | M8 T8.7 | ⏳ JC-gated |
| rollback strategy | M8 T8.8 | ⏳ 文档化 only |

**结论**：T8.1-T8.4 砍掉。M8 重定义 = backup mechanism + dogfood。

### 1.2 backup 触发条件再思考

B4-I6 字面说 "Schema migration 010-014 在 Galley 内 hard-coded 备份步骤"。**字面读 = 仅当 migration 真要跑的时候备份**。

3 个候选 trigger policy（trade-off）：

| 策略 | trigger | pro | con |
|---|---|---|---|
| **A. Migration-pending only** | on-disk version < code-side max | 精准；不浪费盘 | 不保护 "v0.2 无 mig 也想 snapshot 一次" |
| B. Every startup | 每次启动 | 最安全 | 浪费盘（GB 级数据×每次启动）、I/O 卡 startup |
| C. Once-per-major-version | flag 文件标记 | 折衷 | 多一层状态；JC 数据已经在 v0.1.1，v0.2 触发不了 |

**选 A**：直接 honor B4-I6 字面读，最简单。

**v0.2 ship 后果**：用户从 v0.1.1-alpha.X → v0.2 升级时，**on-disk = code-side**（都是 mig 007），所以**不会触发 backup**。这正确反映了 "v0.2 没改 schema" 的事实。

如果将来 v0.2.x / v0.6 加 mig 008+，自动触发 backup。Forward-looking 机制比 once-and-done 更对得起 B4-I6 的 "hard-coded" 措辞。

> **O1 备选**：要不要加一个 "v0.2 首次启动 force one snapshot"？倾向**不加**。理由：(1) 没有 schema 风险 (2) 用户最近的 v0.1.1 都没让大家 backup，现在 force backup 反而显得 v0.2 出问题概率高 (3) macOS 用户量小，Time Machine 兜底已经够 (4) 真要安心，release notes 里写一句 "升级前 finder 复制一份" 让用户自决。**确认 O1=不加**则该决策进 invariant，固定不再讨论。

### 1.3 Backup 路径策略

数据源：`{ProjectDirs::from("", "", "app.galley")}.data_dir()`
- macOS: `~/Library/Application Support/app.galley/`
- Linux: `~/.local/share/app.galley/`
- Windows: `%APPDATA%\app.galley\data\`

备份目标：**同 parent dir** 下加 sibling `app.galley.backup.<ISO-8601-UTC-timestamp>/`
- 例：`~/Library/Application Support/app.galley.backup.20260520T140530Z/`

为什么不放 `Documents/Galley Backups/` 或别处？
- ✅ 跟数据同 volume → `fs::rename` 可能可用（虽然实际用 `fs::copy_dir` 因为不能假定 inode 兼容）
- ✅ 用户找数据时 sibling 立即可见
- ✅ 不进 Documents 不污染用户文档区
- ✅ 跨 OS 一致

**保留几代？** 不主动清。每次都新 timestamp。占盘大用户自己删（dogfood 期 JC 自己机器；公开发布后 release notes 提醒）。

> **O2 备选**：要不要 cap 在 N=3 代轮转？倾向**不限**。理由：(1) backup 触发是 rare event（migration 才触发）不太可能积累 (2) 用户更怕"我之前的 backup 突然没了"。固定 = 永不自动删 backup。

### 1.4 Backup 失败语义

B4-I6 说 "失败 → 拒启动 + 弹 Finder 到备份目录"。

精确语义：
- **失败模式 1**：盘满或权限不足 → `fs::copy_dir_all` 报 `io::Error` → backup 路径不完整
- **失败模式 2**：源目录在 backup 进行中被外部进程改 → race（极小概率，dogfood 单用户无并发）
- **失败模式 3**：用户 SIGINT during backup → 不完整路径

统一处理：**任何 backup 错误 = abort startup**。tauri-plugin-sql migration 不允许跑（数据库不被打开）。Tauri dialog 弹给用户：

```
Galley 无法启动：备份失败。

错误：{error message}

你的原始数据安全在：
~/Library/Application Support/app.galley/

请检查磁盘空间后重试，或联系 wangjc683@gmail.com。
```

dialog 关闭后 process 退出（exit code 非 0，但 GUI 没有 exit channel；用 `std::process::exit(2)`）。

部分备份目录留还是删？**保留**。理由：用户重启重试时不删除避免无限循环；下次成功时新 timestamp 不冲突。release notes 说明用户可手动清理 `app.galley.backup.*` 目录。

### 1.5 Tauri setup hook 顺序

当前 [`core/src/lib.rs:382-465`](../../../core/src/lib.rs) 的顺序：

```
Builder::default()
  .plugin(opener) .plugin(shell) .plugin(dialog) .plugin(fs)
  .plugin(tauri_plugin_sql::Builder::default()
    .add_migrations(DB_URL, migrations)  // ← migrations 注册在 plugin 内
    .build())
  .manage(RunnerManager)
  .invoke_handler(...)
  .setup(|app| {
    // socket listener start
    // discovery file write
  })
  .run(...)
```

tauri-plugin-sql 的 migration 在**JS 端调 `Database.load()` 时触发**，不是 plugin 注册时。所以 backup hook 可以放在：

| 位置 | 时机 | 选 |
|---|---|---|
| A. `.setup()` hook 开头 | webview 加载前 | ✅ **选这个** |
| B. plugin builder before `.add_migrations` | plugin 注册时 | ✗ 太早，没法 abort startup |
| C. Pre-`tauri::Builder::default()` 的 `run()` 函数顶部 | 最早 | △ 比 setup 复杂（access app handle 不便） |

`.setup()` hook 的 `_app` 参数是 `&mut tauri::App`，可以拿到 `app.handle()` 用于 Tauri dialog API。

**设计**：在 `.setup()` 现有的 socket listener / discovery file 两段**之前**插一段：

```rust
.setup(|app| {
    // BACKUP — must run before tauri-plugin-sql opens DB.
    // JS side calls Database.load() after webview ready, which is after
    // setup() finishes. So as long as backup happens in setup() before
    // .run() returns control, plugin's migration won't have started.
    if let Err(e) = migration_backup::ensure_backup_before_migrate(LATEST_CODE_MIGRATION_VERSION) {
        // dialog + exit
        let _ = tauri_plugin_dialog::Dialog::message(...).blocking_show();
        std::process::exit(2);
    }
    // ... existing socket + discovery
})
```

**为什么 backup 不能放 plugin init 之后**：plugin 注册时只把 migration vec 存进 plugin state。但用户 GUI 启动到 webview 完成大概 0.5-2 秒；这段时间足够 plugin 内部对 sqlite_open 准备好。**保守起见 backup 必须先于 .run() 启动 event loop**。`.setup()` 在 main event loop 启动前同步跑，是合适窗口。

### 1.6 Migration version detection

tauri-plugin-sql 用 `sqlx` migration runner，写表 `_sqlx_migrations`：

```sql
SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1
```

**Edge cases**：
- DB file 不存在 → fresh install，无 backup（也无 migration delta）
- DB file 存在但表 `_sqlx_migrations` 不存在 → v0.1 之前的状态？v0.1 init 时就建过表所以理论上不存在。处理：当作 0 → 触发 backup → 让 plugin 重跑全部 migration
- 表存在但空 → 同上，当 0
- `MAX(version) > LATEST_CODE_MIGRATION_VERSION` → 用户运行了未来版本，**warn + 不 backup + 不 migrate**（让 plugin 自己 NOOP）。极端情况，log only。

`LATEST_CODE_MIGRATION_VERSION` 常量：在 `migration_backup.rs` 顶层定义 = `7`（当前最高）。**每次新 migration 必须同步 bump 该常量**（写测试守护 + invariant 文档）。

### 1.7 SQLite 打开方式

用 `sqlx::SqliteConnectOptions` + read-only 模式打开。不引入新依赖 — sqlx 已经在 `core/Cargo.toml:62-63`。

```rust
let opts = SqliteConnectOptions::new()
    .filename(&db_path)
    .read_only(true)
    .create_if_missing(false);
let conn = sqlx::SqliteConnection::connect_with(&opts).await?;
```

block_on 在 setup hook 里跑（同步 path）。

### 1.8 Backup mechanism 实现

```
fs::copy_dir_all(&src, &dst)
```

Rust std 没 `copy_dir_all`。可选：
- A. 写个 14 行递归 `copy_dir_all` （std::fs::read_dir + 递归）—— 不引入 dep
- B. `fs_extra` crate（额外依赖 + progress callback）

**选 A**。理由：
- 简单 transparent
- 无依赖（B4 阶段不再引入轻量库，参考 N18 invariant 沿用 simplicity）
- 不需要 progress callback —— backup 大小 dogfood 100MB 量级，几秒完成

测试：tempdir 造小型目录树（nested 2 层），调 `copy_dir_all` 后用 walkdir 或递归 diff 验证 byte-identical。

### 1.9 timestamp 格式

`chrono::Utc::now().format("%Y%m%dT%H%M%SZ")` → `20260520T140530Z`。chrono 已在 `core/Cargo.toml`？

```
grep chrono core/Cargo.toml
```

如果没有，引入一行（很常见 dep）。**否则用 std::time::SystemTime + 手算**（不优雅但 0 dep）。

> **O3 备选**：用 chrono 还是 std::time 手算？倾向 chrono 简单。验证后定。

### 1.10 失败 dialog · tauri-plugin-dialog

dialog plugin 已在 `core/Cargo.toml:54`。用 `MessageDialogBuilder`：

```rust
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
app.dialog()
    .message(format!("Galley 无法启动：备份失败。\n\n{}\n\n你的数据：{}", err, dir))
    .kind(MessageDialogKind::Error)
    .title("Galley")
    .blocking_show();
```

`blocking_show` 在 setup hook 里同步 OK（setup 跑在主线程之外的 worker，但 dialog show 同步等用户点击）。

---

## 2. Commit shape

**Single-commit M8**。理由：

- backup module + wire-in + tests 之间互相依赖（先有 module 才有 wire，但没 wire 测不到 e2e）
- ~250-400 LOC 量级
- 单次 review 友好
- B4 节奏（M5/M6/M7 单或双 commit）

如果实现过程发现 LOC 超 600 或测试上要分层，splut 成 2 commit（module → wire-in）。pre-implementation 默认单 commit。

---

## 3. M8 详细 sub-task

### T8.0 · M8 sub-plan ship（本文件 ship paperwork-only commit）

- [x] 本 sub-plan ship 后启动 implementation
- 标记日期：2026-05-20

### T8.1 · 创建 `core/src/migration_backup.rs`

模块结构：

```rust
pub const LATEST_CODE_MIGRATION_VERSION: i64 = 7;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("data dir unavailable")]
    DataDirUnavailable,
    #[error("opening db for version probe: {0}")]
    DbProbe(sqlx::Error),
    #[error("copying {src} → {dst}: {err}")]
    CopyFailed { src: PathBuf, dst: PathBuf, err: io::Error },
}

#[derive(Debug)]
pub enum BackupOutcome {
    FreshInstall,                              // No data dir / no DB file → nothing to back up.
    UpToDate { current: i64 },                 // on-disk == latest, no migration pending.
    NotApplicable { reason: String },           // e.g. on-disk > latest (user ran newer Galley).
    Backed { from: i64, to: i64, backup_path: PathBuf },
}

pub fn ensure_backup_before_migrate() -> Result<BackupOutcome, BackupError> {
    // 1. resolve data dir
    // 2. data dir not exist → BackupOutcome::FreshInstall
    // 3. DB file not exist → BackupOutcome::FreshInstall
    // 4. open DB read-only, SELECT MAX(version)
    // 5. compare → UpToDate / NotApplicable / Backed
    // 6. for Backed: copy_dir_all + return path
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    // recursive copy
}

fn timestamp_now() -> String {
    // chrono or std::time
}
```

公开 API 只有 `ensure_backup_before_migrate()` + `BackupOutcome` + `BackupError`。

### T8.2 · `copy_dir_all` 实现 + 单元测试

```rust
fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if ty.is_file() {
            fs::copy(&from, &to)?;
        }
        // symlinks: skip silently (dogfood 数据不应有 symlinks)
    }
    Ok(())
}
```

测试：
- `test_copy_dir_all_flat` · 单层 3 文件
- `test_copy_dir_all_nested` · 2 层嵌套
- `test_copy_dir_all_empty_dir` · 空目录返回 Ok
- `test_copy_dir_all_src_missing` · src 不存在返回 Err

### T8.3 · `ensure_backup_before_migrate` 主逻辑 + 集成测试

测试用 `tempdir` + `GALLEY_DB_PATH` env var override:

- `test_backup_fresh_install_data_dir_missing` · 整 dir 不存在 → FreshInstall
- `test_backup_fresh_install_db_missing` · dir 在 db 不在 → FreshInstall
- `test_backup_up_to_date` · DB 内 `_sqlx_migrations` MAX(version)=7 → UpToDate
- `test_backup_pending_triggers_copy` · DB 内 MAX(version)=5（模拟 v0.1.1 之前）→ Backed，且 backup_path 存在 + 文件 byte-identical
- `test_backup_not_applicable_future_version` · DB 内 MAX(version)=99 → NotApplicable
- `test_backup_no_migrations_table` · DB 文件存在但无 `_sqlx_migrations` → 当 0 → Backed
- `test_backup_disk_full_fails`（hard，用文件系统层 mock 难，**defer**，N1 标注）

env override：测试用 `std::env::set_var("GALLEY_DB_PATH", ...)` + 自定义 data dir 函数（不能直接调 `db_path()` 因为它把整个 `~/Library/...` 写死；新增 helper `resolve_data_dir() -> Option<PathBuf>` 可被测试 mock）。

> **G1**: 测试不能依赖真 `~/Library/Application Support/`。`migration_backup` 模块必须接受**注入的** data_dir 路径以做隔离测试。pub fn signature 调整为：
>
> ```rust
> pub fn ensure_backup_before_migrate_in(data_dir: &Path) -> Result<BackupOutcome, BackupError>;
> pub fn ensure_backup_before_migrate() -> Result<BackupOutcome, BackupError> {
>     let dir = resolve_data_dir()?;
>     ensure_backup_before_migrate_in(&dir)
> }
> ```

### T8.4 · Wire 进 `core/src/lib.rs` setup hook

```rust
.setup(|app| {
    // Backup must run BEFORE tauri-plugin-sql migrations (which fire
    // on JS side Database.load()). See B4-M8 sub-plan §1.5.
    match migration_backup::ensure_backup_before_migrate() {
        Ok(outcome) => {
            eprintln!("[backup] {outcome:?}");
        }
        Err(e) => {
            use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
            let msg = format!(
                "Galley 无法启动：备份失败。\n\n{e}\n\n你的数据安全在：\n{}\n\n请检查磁盘空间后重试。",
                migration_backup::resolve_data_dir()
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| "<unable to resolve>".into()),
            );
            let _ = app.dialog()
                .message(&msg)
                .kind(MessageDialogKind::Error)
                .title("Galley")
                .blocking_show();
            std::process::exit(2);
        }
    }
    // ... existing socket listener + discovery file wire-in
    Ok(())
})
```

### T8.5 · `mod migration_backup;` 注册到 `lib.rs`

```rust
mod migration_backup;
```

公开 API 不需 re-export 到 `pub` —— setup hook 内 `use crate::migration_backup;`。

### T8.6 · CLAUDE.md 加 invariant 守 `LATEST_CODE_MIGRATION_VERSION`

`docs/refactor/invariants.md` 加一条：

> **I12 (B4-M8)**: 每新增 SQLite migration 必须同步 bump `core/src/migration_backup.rs:LATEST_CODE_MIGRATION_VERSION`。invariant 由两个层面守：(1) 测试 `test_latest_version_matches_lib_rs` 编译期校验 `LATEST_CODE_MIGRATION_VERSION == migrations.len() as i64`（lib.rs 有 const + migration_backup 引用同一 const）；(2) 文档要求。

实现：lib.rs 把 `LATEST_CODE_MIGRATION_VERSION` 也用到 `migrations` vec 上：

```rust
const MIGRATION_COUNT: i64 = 7; // bump in lockstep with migrations vec
// migration_backup uses same const via pub re-export
let migrations = vec![/* ... */];
assert_eq!(migrations.len() as i64, MIGRATION_COUNT);
```

→ 或更优雅：`migration_backup` 不硬编码 7，**从 migrations vec 推导**：lib.rs 把 `migrations` vec 在调用 `add_migrations` 前先取 max version 喂给 `migration_backup`。

```rust
let migrations: Vec<Migration> = vec![ /* ... */ ];
let latest_version = migrations.iter().map(|m| m.version).max().unwrap_or(0);
// pass latest_version to backup hook
```

setup hook 闭包 capture `latest_version`。优雅，no const sync 问题。

**选这个方案**。`migration_backup::ensure_backup_before_migrate(latest_version: i64)` 接参数，不内嵌常量。

### T8.7 · Dogfood real run（JC-gated）

> **不在本 sub-plan ship 范围**。本 commit 完成 T8.1-T8.6。dogfood 由 JC 在 dev mode + JC 数据目录上真跑：
>
> 1. JC 自己机器跑 `pnpm tauri dev`
> 2. 临时手动 patch `LATEST_CODE_MIGRATION_VERSION` → 暂时 stub `_sqlx_migrations` 表把 max version 改到 5（模拟从更早版本升级）
> 3. 启动 Galley → 看到 backup log → 验证 `app.galley.backup.<ts>/` 存在 + 内含 workbench.db + Python bundle 等 sibling 文件
> 4. revert stub，正常启动 → 看 UpToDate log
>
> 后续 v0.2.x 或 v0.6 加新 migration 时自然 dogfood。**T8.7 推到 v0.2 ship 后**作为 v0.6 prereq；M8 本身验收按 unit / integration test 走。

### T8.8 · Rollback strategy 文档化

`docs/release-workflow.md` 新增 "Backup & Rollback" 段：

```
v0.2 之后每次升级如果触发 migration（罕见），Galley 自动备份你的数据目录：

macOS: ~/Library/Application Support/app.galley.backup.<timestamp>/
Linux: ~/.local/share/app.galley.backup.<timestamp>/
Windows: %APPDATA%\app.galley.backup.<timestamp>\

如果新版本出问题，手动 rollback：
1. 退出 Galley
2. 重命名当前 app.galley → app.galley.bad
3. 把 backup 目录改回 app.galley
4. 装回旧版 .dmg / .exe（GitHub Releases 历史 tag）

⚠️ Galley 不提供官方 downgrade path。请只用 backup 做应急回退；正确做法是在 GitHub 报 bug。
```

文档 only，无代码。

### T8.9 · 测试矩阵 + cargo fmt + clippy

- `cargo test --workspace`（必须 169 + 新增 ≈10 个 = ~180 pass）
- `cargo clippy --workspace -- -D warnings`
- `pnpm typecheck && pnpm lint`（无前端改动应该不变）

### T8.10 · agent-api.md 不变更

backup 是 Rust 内部机制，不暴露 CLI / socket API surface。schema_version=1 frozen invariant 维持。

### T8.11 · M8 closeout

- [ ] docs/devlog/2026-05-20-b4-m8-migration-backup.md
- [ ] B4 playbook M8 sub-tasks tick
- [ ] CLAUDE.md stage 9 row 加 M8 ✅
- [ ] B4 dashboard 更新

---

## 4. Risk register

| ID | Risk | Probability | Severity | Mitigation |
|---|---|---|---|---|
| R1 | tauri-plugin-sql 用的 migration 表名不是 `_sqlx_migrations` | low | medium | T8.3 测试用真 plugin 跑一次确认；如果不是改 query |
| R2 | setup hook 闭包 `&mut tauri::App` 不能 await async | high (known) | low | 用 `block_on` —— socket listener 已经这样做（[lib.rs:455](../../../core/src/lib.rs)） |
| R3 | `process::exit(2)` 在 Tauri runtime 没起就 exit 是否绕过 Drop | medium | low | 大体可以；Tauri runtime 起前 exit 等于 std exit；dogfood 验证 dialog 真弹出 |
| R4 | backup 跨 macOS APFS clone 表现 | low | low | `fs::copy` 不用 clonefile，速度 OK；GB 数据几秒 |
| R5 | Windows backup 文件名 timestamp 含 `:` 非法 | low | low | 用 `T140530Z` 格式无冒号 |
| R6 | JS Database.load() 在 setup 还没结束就开始？ | low | high | setup 是同步 closure 跑在 main thread 内的 deterministic 阶段；webview / Tauri runtime 都在 setup 后 start。**默认安全**，N1 watch |
| R7 | 真正 mig delta 触发 backup 大文件 copy 卡 startup 用户以为死了 | medium | medium | log + future polish "showing progress" 推到 v0.6 |
| R8 | backup 目录被用户误清，下次升级又触发 backup 重新生 | low | low | 行为正确 |

> **R1 / R6 是最值得验证的两个**。impl 阶段先在 test 跑 + dogfood watch。

---

## 5. Verification gates

### V1 · cargo / lint / typecheck
```bash
cd core && cargo test --lib
cd core && cargo clippy --all-targets -- -D warnings
cd gui && pnpm typecheck && pnpm lint
cd cli && cargo check
```

### V2 · grep gates
```bash
# migration_backup 不能 leak 出 module 之外（除 setup hook 接入点）
grep -rn "migration_backup" core/src/ | grep -v 'migration_backup\.rs'
# 期望：唯一一处在 lib.rs setup hook 内
```

### V3 · backup smoke（手动）
1. `cp -r ~/Library/Application\ Support/app.galley ~/tmp/galley-pre-m8/`（备份原数据）
2. 手动改 SQLite `UPDATE _sqlx_migrations SET version=5 WHERE version=7`（模拟旧版本）
3. 启动 dev mode
4. 验证：
   - `eprintln` 输出 `[backup] Backed { from: 5, to: 7, backup_path: ... }`
   - sibling `app.galley.backup.<ts>/` 真存在
   - 内含 workbench.db + python-bundle/（如有）
5. 启动后 Galley GUI 正常打开 → 数据没动
6. revert SQLite 改动 + 删 backup dir

### V4 · backup failure smoke（手动）
1. 备份目标 parent dir 改为只读 (`chmod 555 ~/Library/Application\ Support`)
2. 改 SQLite 模拟旧版本
3. 启动 → 看到 Tauri error dialog
4. 关 dialog → process 退出 (exit 2)
5. `chmod 755` 恢复 + revert SQLite

### V5 · 不影响 fresh install
1. 新 macOS user 第一次跑 Galley → 数据目录从无到有
2. 验证：`[backup] FreshInstall` log
3. 验证：Galley 正常启动，无 dialog
4. 验证：mig 1-7 跑完，无 backup 目录创建

---

## 6. Open decisions

| ID | Question | Default | Need confirm? |
|---|---|---|---|
| O1 | v0.2 首次启动 force snapshot 即使无 mig delta？ | **不加** | sub-plan ship 前 confirm |
| O2 | Backup retention cap N=3？ | **不限** | sub-plan ship 前 confirm |
| O3 | chrono vs std::time | 用 chrono 如果已在 deps，否则 std::time | impl 时定 |
| O4 | failure dialog 文案中英 | 中文（用户主要 zh-CN） | sub-plan ship 前 confirm |
| O5 | `LATEST_CODE_MIGRATION_VERSION` 来源：常量 vs 从 migrations vec 推导 | **推导** | T8.6 已说明，固定 |
| O6 | symlink 怎么处理（macOS dogfood 数据应无）| skip silently | T8.2 已说明，固定 |
| O7 | backup 进行中 SIGINT → leave partial dir | 留 + 让用户清 | T8.4 dialog 不处理；下次启动新 timestamp |

---

## 7. References

- B4 playbook M8 段：[B4-cli-bg-artifact.md §M8](./B4-cli-bg-artifact.md)
- B4-I6 invariant：[B4-cli-bg-artifact.md §Phase invariants](./B4-cli-bg-artifact.md#phase-invariants--b4-特有的硬规则)
- migration files：[core/migrations/](../../../core/migrations/) 001-007
- migration runner 注册：[core/src/lib.rs:337-380](../../../core/src/lib.rs)
- DB path resolution：[core/src/db.rs:53-65](../../../core/src/db.rs)
- Tauri identifier 守护：[desktop runtime](../../desktop-runtime.md#tauri-identifier)

---

## 8. End of M8 sub-plan
