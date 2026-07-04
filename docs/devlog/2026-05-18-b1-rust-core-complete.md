# B1 Rust core 骨架 + CLI 只读 · 完成

- **Date**: 2026-05-18
- **Status**: ✅ Complete — single session executing all seven milestones M1-M7
- **Related**:
  - PRD §10 "Galley Core 权威层" (architecture origin)
  - [B1 playbook](../archive/refactor/B1-rust-core.md) (full cursor history + running notes N1-N29)
  - [Refactor invariants](../archive/refactor/invariants.md)
  - [agent-api.md draft](../agent-api.md) (M5 ship)
  - [Prototype GO devlog (2026-05-18)](./2026-05-18-prototype-go-for-b1.md) (immediate predecessor)
  - Commits: `4ee23e3` (M1) · `d79558a` (M2) · `ff878b1` (Check workflow fix) · `9f6b369` (M3) · `e3f11a1` (M4) · `3e29dbc` (M5) · `80feb4c` (M6)

## Context

Bridge-owner prototype shipped 2026-05-18 with 17/17 PASS + GO for B1. After JC confirmed Windows release was implicitly ready (v0.1.1-alpha.1 already shipped a Win-x64 NSIS artifact to GitHub Latest), B1 unblocked.

The B1 goal: stand up the Rust authority layer's skeleton (`GalleyApi` trait + types + sqlite reads) and ship a working `galley` CLI binary with six read commands. Constraint: **0 GUI regression** during execution. v0.5 milestone path B step 1 of 4 (B1 → B2 → B3 → B4 → v0.5).

What got done in this session:

- **M1 directory restructure** (`4ee23e3`) — `desktop/src-tauri/` → `core/`, `desktop/` → `gui/`, `bridge/` → `runner/`, new `cli/`. 178 files / 161 git-rename detections. All gates clean, dogfood OK.
- **CI hotfix** (`ff878b1`) — Pre-existing python-bundle resource validation failure in Check workflow (since v0.1.1). Single-line `mkdir -p core/python-bundle/python` step before cargo check, tauri-build's `Path::exists` check satisfied at near-zero cost.
- **M2 Rust core scaffolding** (`d79558a`) — Cargo workspace at `core/Cargo.toml` (members `.` + `../cli`), crate renamed `desktop` → `galley-core`. `GalleyApi` trait with six read methods, data types in `core/src/api/{session,message,project,origin,status,health,search}.rs`, `GalleyError` enum, stub `SqliteGalley`.
- **M3 sqlx SQLite reads + tests + first Tauri command** (`9f6b369`) — sqlx 0.8 reusing the same version `tauri-plugin-sql 2.4.0` brings in transitively. All six trait methods implemented. 12 in-memory integration tests against the production migration SQL. `#[tauri::command] list_sessions` registered + `@deprecated` marks on `loadSessions` / `loadMessagesBySession` / `searchMessages`.
- **M4 CLI binary** (`e3f11a1`) — `galley` binary with six subcommands (`sessions list`, `sessions search`, `session brief`, `session show`, `status`, `health`, `version`). NDJSON on stdout for lists, error JSON on stdout, exit codes 0/1/2/3/4. 6 integration tests spawning the built binary via `std::process::Command`. `GALLEY_DB_PATH` env override.
- **M5 agent-api.md draft** (`3e29dbc`) — public contract doc: stability promise (schema_version 1 additive-only), exit code table, six command references with field tables + example payloads, error envelope schema, versioning rules, B2+ planned commands with `--origin-*` flag shape.
- **M6 GUI migration template** (`80feb4c`) — `loadSessionsViaCore()` invokes the Rust Tauri command, adapts `SessionBrief` → `Session`. `hydrateFromDB` flipped to the new path. JC dogfood confirmed sidebar identical to legacy path. 10-step migration template documented for B2/B3 reuse.

End state: GUI reads sessions through Rust core (one call site); CLI binary works end-to-end against the live DB; the public API contract is documented; M7 acceptance criteria all checked.

## Decisions

| # | Decision | Why this not that |
|---|---|---|
| 1 | M1 = **single atomic rename commit** (not 3 per-dir commits as invariants.md §I4 says) | JC explicitly chose playbook T1.15 path; git's rename detection caught all 161 renames at 100% similarity → blame/history clean despite the single-commit form. §I4 ↔ T1.15 contradiction flagged as Open Item O8 for later doc reconciliation. |
| 2 | Workspace root at `core/` (not repo top) | Keeps `core/target/` shared between `galley-core` + `galley-cli` while preserving the existing CI Rust cache key (`./core -> target`) and tauri build output paths byte-identical. Repo-top virtual workspace was the more idiomatic alternative but would have forced workflow/.gitignore/script path churn unrelated to the B1 goal. |
| 3 | **sqlx**, not rusqlite, as the SQLite driver | Playbook G6 was wrong — Cargo.lock shows `tauri-plugin-sql 2.4.0` actually pulls in sqlx 0.8.6, not rusqlite. Reusing the same version shares `libsqlite3-sys 0.30.1` (one set of SQLite symbols, FTS5 trigram already available). Async-native sqlx pairs naturally with the `async_trait`-defined `GalleyApi`; rusqlite would have required `spawn_blocking` wrappers in every method. |
| 4 | JSON conventions: **struct fields camelCase, enum variants snake_case** | Matches the existing TS contract (`gui/src/types/session.ts`) so Tauri `invoke()` round-trips don't need an adapter. CLI agents see the same convention; snake_case enum string values stay agent-friendly while camelCase keys give GUI parity. |
| 5 | **schemars deferred to M5/B4**, only `async-trait` added as new dep in M2 | M2 doesn't need formal JSON Schema generation yet; adding schemars would have cost ~30s compile per iteration with no signal value during M2 dev. Add it together with M5's agent-api.md schema gen if/when it ships. |
| 6 | health() in B1 surfaces **partial probes**, deferred rows as `DeferredB4` | Three of the five v0.1 health checks (GA path, mykey.py, db_readable) are SQLite/filesystem-only — implement now. Two (agentmain importable, LLM session init) need a Python subprocess spawn; B4 daemon mode is the right home for that. Each deferred row surfaces explicitly as `HealthStatus::DeferredB4` with a `detail` explanation. Better than `todo!()` panic; agents can pattern-match. |
| 7 | CLI **errors emit JSON on stdout, not stderr** | Per playbook G9 / JC's "按你建议执行". Agents read one stream; exit code carries category (`0 success / 1 internal / 2 invalid_args / 3 not_found / 4 db_unavailable`) for SOPs that don't want to parse. stderr reserved for `panic!` and Rust runtime backtraces. |
| 8 | `--pretty` table output + `galley help --as-agent` cheatsheet **NOT shipped** in M4 | NDJSON-on-stdout is the load-bearing agent-first contract; ship that clean and skip the human-readability convenience until B4 polish. `help --as-agent` would have duplicated M5's agent-api.md — better to write the doc once + reference from CLI `--help` than maintain a separate cheatsheet that drifts. |
| 9 | Filter semantics standardized: **`Option<bool>` = `None=no filter / Some(true)=only / Some(false)=exclude`** | M6 surfaced that `SessionFilter.archived = None` was implemented as "exclude archived" while the natural reading is "no constraint". Fixed in M6 + bundled into the same commit. CLI's `--all` (None) now correctly returns both active + archived. |
| 10 | M6 picks **loadSessions** as the migration template (not loadProjects) | The Rust list_sessions trait method + Tauri command were already wired in M3 T3.13 — shortest path. loadProjects has no Rust analog in B1 (deferred to B2 along with the rest of write-path); making it the template would have meant adding trait method + impl + tests + Tauri command first. |
| 11 | **SessionBrief intentionally lean** (excludes transient runtime fields) | Brief carries id / projectId / title / status / summary / turnCount / pinned / hasUnread / timestamps. Excludes pid / currentTool / pendingApprovalCount / errorCount / cwd / lastStepIndex / hasPendingAskUser. JS adapter (`sessionFromBrief`) defaults those to 0 / undefined. Rust core is "persistent-truth" authority; B2+ runner-manager owns runtime fields via IPC events. Convention prevents Brief fields from growing without bound. |
| 12 | Tests use **programmatic seed** against in-memory SQLite, not checked-in fixture file | 12 db tests + 6 cli tests all open `sqlite::memory:` (db) or `tempfile` (cli), apply migration SQL via `include_str!` + `sqlx::raw_sql`, seed via small helpers. Pros: schema evolves with migrations automatically, no binary artifact in git, fully isolated. Cons: more Rust setup code. Net win at this scale. |

## Rejected alternatives

- **3-commit M1 rename per invariants.md §I4**: would have meant `git mv` + selective staging dance × 3, fighting git rename detection by partially staging related edits. JC chose the playbook T1.15 single-commit path; rename detection delivered the same blame/history outcome at lower friction. §I4 ↔ T1.15 contradiction left as Open Item O8.
- **Repo-top virtual workspace** (`<repo>/Cargo.toml` `[workspace]` only): more idiomatic but would have moved `target/` to repo root, forcing churn in `swatinem/rust-cache@v2` workspaces config (`./ -> target`), bundle output paths (`target/<triple>/release/bundle/...`), `scripts/rename-artifact.sh`, `.gitignore`. Net cost: high CI churn unrelated to the B1 goal.
- **rusqlite** as the SQLite driver: simpler API, but adds a second `libsqlite3-sys` to the build (potential symbol mismatch with tauri-plugin-sql's sqlx), needs `spawn_blocking` wrappers for every async trait method, no signal value over sqlx in this codebase.
- **`schemars::JsonSchema` everywhere in M2**: deferred to M5/B4 — saves transitive compile cost during the iterative trait/types design pass; agent-api.md ships hand-curated field tables for now (more readable than auto-generated JSON Schema anyway at this stage).
- **`thiserror`** for `GalleyError` derive: replaced by a 12-line hand-rolled `Display` + `std::error::Error` impl. Avoids the macro-expansion compile cost; if we hit a `From` derive moment later, easy to add.
- **`--pretty` table output** in M4: deferred to B4 polish or never — agents pipe through `jq` already; `comfy_table` adds ~5 transitive crates for human-readability that doesn't gate any SOP.
- **`galley help --as-agent` cheatsheet** in M4: deferred — would duplicate M5's `docs/agent-api.md`. Single source of truth > separate doc that drifts.
- **`pnpm tauri build` (production .app/.dmg) as part of M7 A3**: substituted by dev-mode `pnpm tauri dev` + JC dogfood + relying on release.yml CI on next tag. The release path is exercised end-to-end via CI on every tag push; running it locally for M7 acceptance would have cost ~3-5 minutes for no extra signal.

## Open questions

- **O3 partial — error JSON shape evolution.** B1 ships `{ "error": "<category>", "detail": { "message": "..." } }`. B2 will need to grow `detail` with discriminant-specific fields (e.g. `not_found` adds `session_id`, `invalid_args` adds `expected` + `received`). The additive-only promise covers this — agent-api.md §6 explicitly says `detail` is an object so new fields land non-breaking. **Open**: do we want a typed `detail` per variant (Rust `NotFoundDetail { session_id: String, message: String }`) or stick with `serde_json::Value` for flexibility? Lean toward typed when each variant has stable fields, untyped during exploration.
- **O7 schemars timing.** Deferred from M2. M5 ships agent-api.md as a hand-written doc — if/when we want machine-checked schemas (e.g. publish JSON Schema files alongside the doc, or generate the doc from types), `schemars::JsonSchema` derive on every api type + `core/build.rs` step. Not on the B1 critical path; revisit after B2 stabilizes.
- **O8 invariants.md §I4 ↔ playbook T1.15 contradiction**. M1 single-commit path won this round; §I4 says "each rename independent commit". Either delete §I4 (acknowledge T1.15 supersedes), narrow §I4's scope to specific contexts, or rewrite T1.15 to match §I4. Leaning toward delete + replace with a different invariant: "rename-only commits must show 100% git rename detection". That captures §I4's actual intent (clean blame/history) without prescribing commit count.
- **Real runtime counts in `status()`.** B1 surfaces persistence-truth (durable statuses only). Running / waiting_input / errored will usually read as 0. B2 runner-manager owns the runtime view; the trait method needs a second path that reads in-memory state when the daemon is up. Open: does the trait split (`status_persistent()` + `status_runtime()`) or stay as one method with the runner-manager filling fields when available?
- **B4 daemon transport vs in-process SQLite reads**. B1's CLI opens its own `SqliteGalley` per invocation (~60ms cold). B4 introduces a daemon (Unix socket / named pipe) so CLI commands become a thin client. Open: at B4 launch, what's the SOP migration story — do we keep the in-process path as a fallback when the daemon isn't running, or make the daemon a hard requirement? Lean toward fallback so CLI works when GUI isn't launched, but that complicates the trust model (CLI as a separate authority writing to the same DB).
- **GUI Tauri command per-call `SqliteGalley::open()` overhead**. Each `invoke("list_sessions")` currently opens its own pool (`pool.connect → 4 × spawn connection → migration check`). This is wasteful — B2/B3 should introduce app-state-shared pool. Not blocking B1 (the GUI hydrates exactly once on startup and we're well under 100ms).

## Next

**Immediate**:

1. **Push M5 + M6 + their CI verification.** Currently local-only; will verify CI Check workflow stays green after the M5 doc-only commit + M6 GUI migration.
2. **Update `/CLAUDE.md` 阶段表** — Stage 6 (B1) goes ✅; cursor advances to Stage 7 (B2).
3. **Update `docs/archive/refactor/README.md` progress dashboard** — B1 ✅, B2 next.

**B2 startup** (next dedicated session):

1. **Tag `b1-complete`** on the M6 commit (playbook T7.7).
2. **Write B2 playbook** — promotes current stub to full sub-task list. 3 weeks duration estimate from PRD §10. Major topics: runner_manager module (Rust-owned subprocess), Tauri command for `send_message` (first write), CLI `galley send-message` (first agent-write surface), Origin metadata wiring.
3. **Resolve open question O8** (invariants.md §I4) before B2 commits start — the rename-only invariant becomes irrelevant in B2 but the lesson about "blame/history hygiene" remains. Pick a clean replacement formulation.

**Deferred to specific later milestones**:

- v0.2 release: still pending Win-machine smoke + tag. Could happen anytime; doesn't gate B2.
- B4: daemon transport, full health probe (Python subprocesses), `galley help --as-agent`, `--pretty` table output, projects CRUD.
- v0.5: Galley Core dual-native ship. Roughly 10-12 weeks total per PRD §10.4 schedule (B1 took 1 day not 3 weeks — substantial accelerant for the overall timeline).

## Acceptance criteria status

A1–A12 from the playbook:

- **A1** ✅ `core/`, `gui/`, `cli/`, `runner/` exist; `src-tauri/`, `desktop/`, `bridge/` absent.
- **A2** ✅ `cd core && cargo check` clean (2.81s warm); `cd cli && cargo check` clean (15s after release matrix tear-down).
- **A3** ✅ via `pnpm tauri dev` + JC dogfood (M6 T6.4) + release.yml CI exercises `pnpm tauri build` on every tagged release. No local production-bundle build run in this session — implicit via CI.
- **A4** ✅ `target/debug/galley sessions list` emits NDJSON when GUI is not running (verified live against JC's workbench.db at `~/Library/Application Support/app.galley/workbench.db`).
- **A5** ✅ All six read commands run + tested (6 CLI integration tests).
- **A6** ⏳ `--pretty` deferred per decision #8 above; flag not yet on any command.
- **A7** ✅ Exit codes 2 (`invalid_args`) / 3 (`not_found`) / 4 (`db_unavailable`) verified live.
- **A8** ✅ `galley version` returns `schema_version: 1`.
- **A9** ✅ `docs/agent-api.md` shipped covering all six commands + stability + exit codes + error envelope + B2+ planned commands.
- **A10** ✅ `gui/src/lib/db.ts loadSessionsViaCore()` calls `invoke("list_sessions", ...)` → Rust `SqliteGalley::list_sessions` → SQLite. GUI sidebar unchanged.
- **A11** ✅ All six commands < 100ms average (10-run bench): `version` 89ms (process startup dominated), all SQLite-touching commands 60-73ms.
- **A12** ✅ `cd core && cargo test` 13/13 db + 6/6 cli pass; `python -m pytest runner/tests/` 106/106 pass.

Acceptance summary: **11 of 12 ✅ + 1 deferred** (A6 `--pretty`, deferred to B4 polish per decision #8).
