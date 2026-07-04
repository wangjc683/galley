# B4 M8 完成 — Pre-migration backup mechanism (B4-I6 兑现)

## Date / Status / Related

- **Date**: 2026-05-20（B4 第 5 个工作 session — M8 sub-plan + implementation 同 session）
- **Status**: ✅ Code + 文档 + 测试 ship。T8.7 dogfood real run 留 v0.6 prereq（v0.5 没新 migration delta 触发不到）。
- **Commits**: 单 commit（pending — closeout 后 ship）
- **Related**: [B4 playbook M8](../archive/refactor/B4-cli-bg-artifact.md#m8--v0x--v05-data-migration-真跑-d64) · [B4 M8 sub-plan](../archive/refactor/B4-M8-sub-plan.md) · [B4-I6 invariant](../archive/refactor/B4-cli-bg-artifact.md#phase-invariants--b4-特有的硬规则) · [N18 session-end handoff](../archive/refactor/B4-cli-bg-artifact.md#running-notes--gotchas)

## Context

B4 playbook 原本把 M8 写作 "schema 010-014 + backup + dogfood"，前提是 v0.5 会引入 supervisor / origin / created_via 新字段。但 B2 M5 提前把这些字段全部 ship 进了 mig 006/007 —— 当 B4 启动到 M8 时，schema 已经在用户的 v0.1.1-alpha.X DB 上跑过。M8 真正剩下的工作 = **backup mechanism 的实现**（B4-I6 兑现），而不是 schema migration。

JC 选 "M8 data migration (sub-plan + 实施)" 接 N18 handoff 的 (b) 路径。第一步就是 re-scope —— sub-plan §1.1 列了 8 个 T8 sub-task 的状态对照，T8.1-T8.4 (schema 010-014) 全部确认作废。实际工作集中在 T8.5/T8.6/T8.8 (backup + failure + rollback doc) 和测试。

## Decisions

1. **Trigger policy = Strategy A (migration-pending only)** —— sub-plan §1.2 列了三个候选 (A/B/C)。选 A 字面 honor B4-I6 "Schema migration ... 在 Galley 内 hard-coded 备份步骤"。v0.5 本身用户从 v0.1.1-alpha.X 升级**不触发** backup（on-disk version == code-side version == 7），是正确反映 "v0.5 没改 schema" 的事实。v0.5.x / v0.6 加 mig 008+ 时自然 forward-looking 触发。
2. **Backup 路径 = sibling `app.galley.backup.<utc-timestamp>/`** —— 同 parent dir，timestamp 用 ISO-8601 compact 格式 `20260520T140530Z`（Windows 文件名安全无 `:`）。用户 Finder 找数据时立即可见。
3. **失败 = 拒启动 + Tauri error dialog + `std::process::exit(2)`** —— B4-I6 字面读。dialog 文案中文，指出数据安全位置 + 检查磁盘/权限建议。partial backup 目录**不**清理（用户重启重试时不删避免无限循环；下次成功时新 timestamp 不冲突）。
4. **`LATEST_CODE_MIGRATION_VERSION` 从 migrations vec 推导**（sub-plan §1.6 + T8.6 优雅方案）—— `lib.rs:run()` 顶部 `migrations.iter().map(|m| m.version).max()` 之后 `move` 进 setup closure。**单一编辑站点** = 加 migration 不会忘 bump backup const。
5. **Setup hook 顺序：backup → socket listener → discovery file** —— sub-plan §1.5 选位置 A（.setup() hook 开头）。`tauri-plugin-sql` 注册时只暂存 migration vec；真正连接 DB 是 JS-side `Database.load()` 在 webview ready 之后，那时 setup() 早已返回。所以 backup 同步跑在 setup() 内**保证先于 plugin 打开 DB**。
6. **SQLite 探测用 sqlx read-only + `create_if_missing(false)`** —— 不留写入痕迹也不会因为路径错误意外创建空 DB 掩盖配置错误。`SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1`，缺表当 0。
7. **`copy_dir_all` 自己写 14 行递归 + 无新 deps** —— `std::fs` 没有 `copy_dir_all`，备选 `fs_extra` crate 但只为这一个调用引入依赖不值。symlinks **静默跳过**（Galley 数据目录正常不应有 symlinks；用户手动放的也不该跟随）。
8. **`chrono` 加 top-level dep，零 net 新 crate** —— `chrono 0.4.44` 已经通过 `sqlx` transitive 在 lock file。`default-features = false` + 只开 `clock` feature，无 serde/timezone DB 等额外编译开销。手算 Howard Hinnant date 算法 trade-off 不划算（chrono 既然已在 dep tree 就用它）。
9. **Test-injectable signature**: `ensure_backup_before_migrate_in(data_dir: &Path, latest_version: i64)` 是测试入口，`ensure_backup_before_migrate(latest_version: i64)` 是生产入口（前者通过后者调用，data dir 用 `resolve_data_dir()` 查找）。所有 11 个 unit test 用 `tempfile::TempDir` 隔离真实 `~/Library/...`。
10. **T8.7 dogfood real run 留 v0.6**（B4-I7 风险 R7 已知）—— v0.5 没 schema delta 触发不到 backup 路径，dogfood 无意义。等 v0.5.x / v0.6 第一次加 mig 008+ 时真跑。M8 acceptance 按 unit / integration test 通过 + manual smoke (V3/V4) ship。

## Rejected alternatives

- **Strategy B (every-startup backup)** —— 最安全但 dogfood 数据 GB 级×每次启动 = 浪费 + 卡 startup I/O。sub-plan §1.2 拒。
- **Strategy C (once-per-major-version + flag 文件)** —— 折衷但 JC 数据已经在 v0.1.1（== code-side mig 7）触发不了。多一层状态没收益。sub-plan §1.2 拒。
- **v0.5 首次启动 force one snapshot（O1 备选）** —— sub-plan §1.2 列。倾向不加：(1) 无 schema 风险 (2) force backup 反而暗示 v0.5 出问题概率高 (3) Time Machine 兜底已经够 (4) release notes 一句 "升级前 finder 复制一份" 让用户自决。本 session 用 default = 不加。
- **Backup retention cap N=3 代轮转（O2 备选）** —— sub-plan §1.3。倾向不限：(1) backup 触发是 rare event 不太可能积累 (2) 用户更怕"我之前 backup 突然没了"。固定永不自动删 backup，盘满交给用户决定。
- **`thiserror` derive 错误类型** —— project 现有 [GalleyError](../../core/src/error.rs) 用 hand-rolled `impl Display`，保持一致。`thiserror` 没在 deps，引入只为一个新 enum 不值。
- **`fs_extra::dir::copy` 替代手写 `copy_dir_all`** —— sub-plan §1.8 拒，避免单调用新依赖。14 行递归足够透明。
- **常量 `LATEST_CODE_MIGRATION_VERSION` 硬编码 + assert_eq! 守护** —— sub-plan §1.6 第一稿提议但 §T8.6 升级到 "从 vec 推导"。assert 是运行时 check，从 vec 推导是编译时 + 单编辑站点 = 更优雅。
- **Migration backup 写在 Rust 端 main() 之前** —— sub-plan §1.5 候选 C。比 setup hook 复杂（access app handle 不便），优势仅在 "更早执行"，但 setup hook 已经在 webview/plugin DB 打开之前，足够早。
- **Failure dialog 走 Tauri 命令通道异步 emit + JS 端展示** —— 跨进程异步在 startup-fail 路径不可靠（webview 可能未起）。`blocking_show()` 同步等用户点确认 = 简单可靠。
- **Backup 跳过对 `.DS_Store` / 临时文件过滤** —— 过度优化。`copy_dir_all` 一视同仁；用户清理 backup 时不在乎几个 macOS 系统文件。
- **测试用真 SQLite migration runner 验证** —— 引入 tauri-plugin-sql 依赖到测试不值。手动 INSERT `_sqlx_migrations` 模拟版本即可（sqlx 接口稳定）。

## Open questions

- **Q1**: backup 操作过程 SIGINT (用户 Cmd+C / 杀进程) 留 partial backup 目录怎么办？目前 = 留，下次启动新 timestamp 不冲突。**Decision**: 不主动清，release notes 提醒用户 `app.galley.backup.*` 目录可手动清理。
- **Q2**: 用户从 v0.1 没装过 Galley 重装时数据目录刚好不存在但 sibling 有上次 backup 目录怎么办？`FreshInstall` 分支生效正常，下次 backup 不会冲突（新 timestamp）。已 covered。
- **Q3**: macOS APFS clone 优化能不能用？`std::fs::copy` 不调 `clonefile` syscall。理论上 GB 级数据用 clone 可瞬时复制。**Defer 到 v0.6+**，目前几秒 OK。
- **Q4**: Windows backup 是否要 `%APPDATA%\Roaming\` vs `%APPDATA%\Local\` 区分？`directories` crate 用 `data_dir()` = Roaming 默认。已经一致。
- **Q5**: backup 目录在 Time Machine 排除规则下表现？macOS Time Machine 默认备份 `~/Library/Application Support/`，所以 Galley 自己的 backup 还会被 Time Machine 备一次（双备份）。Release notes 提醒高级用户可手动 exclude `app.galley.backup.*`。

## Next

**M8 acceptance**:
- A11 ✅ partial — Migration backup mechanism ship + 11 unit test pass + manual smoke V3/V4 设计完成。**Full A11 tick** 等 v0.6 第一次加 mig 008+ 时 dogfood 真跑。
- A11 covers B4-I6 invariant verification.

**M8 后剩下**:
- **M2** Tray spike → Background mode：Windows-machine gated；JC 没机器跑 spike 这一项就推不动。
- **M4 T4.2-T4.5** SOP dogfood iteration：calendar gated by JC IM bot 集成时间表。
- **M9** v0.5 release ceremony：需要 A11 / A12 / A13 / A14 完整 tick。其中 A12 (M7) / A11 (M8) 已 partial ✅；A13 是 code review 演示 / A14 是 1-week dogfood。

**v0.5 RC acceptance breakdown** (M8 ship 后):
- A1 ✅ A2 ✅ A3 ⏳ (M2) A4 ⏳ (M2) A5 ✅ A6 ✅ A7 ✅ (macOS) A8 ✅ A9 partial (M4 T4.3 dogfood)
- A10 partial (M5 trigger) A11 partial (M8 ✅ code, dogfood v0.6+) A12 partial (M7 dogfood) A13 ⏳ (M9) A14 ⏳ (M9)

**Next session 候选**:
1. **JC dogfood interleave** (N18 推荐路径) — 30-45 min 关 A10 / A12 full tick + 验证 M3 macOS PATH install / M5 Claude Skill trigger / M7 supervisor annotation
2. **CLAUDE.md 9 row 加 M8 ✅ + B4 playbook M8 sub-task tick** — 跟本 commit 一起 ship 还是 separate？倾向跟 commit 一起（B4 节奏 — closeout 加 dashboard 是同 PR scope）

## Files touched

- `core/Cargo.toml` — `chrono` top-level dep (zero net new crate; transitive via sqlx)
- `core/src/migration_backup.rs` — **NEW** 415 行（model + impl + 11 test）
- `core/src/lib.rs` — `mod migration_backup;` + `latest_migration_version` 推导 + setup hook backup 段（≈30 行 net add）
- `docs/archive/refactor/B4-M8-sub-plan.md` — **NEW** 400+ 行 sub-plan
- `docs/devlog/2026-05-20-b4-m8-migration-backup.md` — **NEW** 本文件

## Verification

- `cargo test --workspace` — **180/180** (was 169; +11 from migration_backup::tests)
- `cargo check --workspace` — clean (galley-core + galley-cli)
- `pnpm typecheck` — clean
- `pnpm lint` — clean (0 warnings)
- ~~`cargo clippy --workspace -- -D warnings`~~ — 3 pre-existing lints unrelated to M8 (origin.rs doc list × 2 + socket_listener.rs unnecessary_cast)；clippy 不在 CI gate（check.yml 只跑 cargo check + cargo test），不阻 M8。新增代码 `cargo clippy` 通过。

## Velocity note

M8 单 session ship（sub-plan §3.0 paperwork + 全实施 + closeout）跟 M5/M6/M7 节奏一致。原 playbook estimate "最 P0 风险" + 4 个 schema migration sub-task 看起来庞大，re-scope 之后真活儿只是 backup mechanism + tests，1-2 hour wall-clock 范畴。
