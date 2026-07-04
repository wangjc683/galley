# B4 · CLI feature-complete + background mode + adapter artifact

```
Cursor:   v0.2.0 shipped; B4 main path closed
Status:   ✅ M1/M2/M3/M4/M5/M6/M7/M8/M9 shipped into v0.2.0
Started:  2026-05-20 (paperwork)
Last touch: 2026-05-31 release docs pass. `schemaVersion: 1` is frozen for
`v0.2.0`, and current state lives in `docs/project-status.md`.
Predecessor: B3 ✅ tag b3-complete
Successor:   post-v0.2 feedback / focused v0.2.1 hotfix if needed
Duration:    PRD estimate 2-3 周（D51-D65），按 B1/B2/B3 节奏可能压缩到 1-2 周
```

**Cursor 协议**：完成 sub-task → cursor 移到"下一个未完成的最小编号 T"。Session 结束 → cursor 必须指向"明确可以接续的位置"，不要指 in-progress。

> **2026-05-20 升格 note**：本 playbook 从 stub（144 行）升格到详细版本，采用 B3 sub-plan-then-impl 模式。M1-M9 每个 milestone 在实施前**单独写 sub-plan**（mirror M3-M6 pattern），sub-plan 内做 scope re-assessment / commit shape decision / 详细 sub-task 序列 / risk register / verification gates。这是 B1/B2/B3 累积下来 21× 加速估算的核心 pattern——B4 估的 2-3 周大概率是 1-2 周。

## 这个 phase 在干啥（一段话）

3 件并进，把 Galley 从「dual-native 内部架构 ready」推到「dual-native 对外发布」：

1. **CLI feature-complete**：B1+B2 已实现 6 read 命令 + send/watch；B4 补齐 PRD §11.1 所有 write 命令（session new / btw / stop / archive / restore + project + llm）。每个新命令在 Rust `GalleyApi` trait 加 method + Tauri command + CLI subcommand，**单条命令 sub-plan 即可**——M1 比 B3 milestones 更细颗粒。
2. **Background mode (menubar daemon)**：关窗 → 隐藏不退出（**Cmd+Q 才退**）。menubar 图标 + active session badge，下拉菜单 Show/Quit。CLI 才能用——Galley Core 必须 alive 才接 socket 写命令。
3. **Adapter artifacts**：Galley Supervisor SOP for GenericAgent + galley-supervisor skill for Claude + `docs/agent-api.md` v1 publish + discovery file。这些一起 ship 让外部 supervisor（GA bot / Claude / 用户自写 agent）从 day 1 就能用。

B4 shipped as v0.2.0, Galley's first stable dual-native orchestrator release.

## Prerequisites · 必须先完成

- [x] B3 全部 acceptance criteria 跑过 + devlog ship + tag `b3-complete`（2026-05-20）
- [ ] B3 dogfood 1 周稳定期 — 严格 vs event-driven 由 JC 体感决定（B4 是 phase 切换不是 milestone 切换，应该比 milestone 切换更慎；但具体长度 event-driven per [N17](./B3-store-slice.md#running-notes--gotchas)）
- [ ] **Tauri tray plugin v2 spike**（1 day）— B4-R1 大风险，启动前先验证：(a) menubar 图标在 macOS + Windows 都能渲染 (b) hide window + WebView 在 background 仍能跑 JS (c) macOS App Nap 不卡死 IPC 响应。Spike spec [core/experiments/tray-mode/README.md](../../../core/experiments/tray-mode/README.md) ship 2026-05-20（20 个 T 项 checklist · 6 验证段 · macOS T17-T19 单独 App Nap 测量段 · GO/NO-GO 决策 + 3 fallback strategy）；scaffold + 实跑留下次 dedicated session 跑（mirror bridge-owner prototype pattern）
- [x] v0.1 / v0.2 dogfood 数据 migration 备份机制已设计 + 实现（参考 [PRD §16](../../PRD.md#16-数据迁移v01--v10) 和 [B4 M8](./B4-M8-sub-plan.md)）
- [x] 当前 B4 状态已移到 [project status](../../project-status.md)

**未达 prerequisites 不允许启动 B4 M1**。最后两条 B4 内自行解决；tray spike 严格 gate。

## Phase invariants · B4 特有的硬规则

跨 phase 规则在 [invariants.md](./invariants.md)。B4 特有的：

- **B4-I1**: CLI 命令 surface **frozen at v0.2 ship**。M6 publish 时 schema_version=1 锁定，任何后续 break = bump v2。[agent-api](../../agent-api.md) + PRD §11 「schema 漂移 0」是硬约束——B4 内 sub-plan 阶段 review CLI 命令字段名、enum 值、exit code 分配，发现需要 break 必须**在 v0.2 ship 之前**改完。
- **B4-I2**: **localhost only**（[CLAUDE.md](../../../CLAUDE.md#2-localhost-only)）。B4 引入的 socket / discovery file / supervisor SOP 任何一条建议「开 TCP / 加 token / 走远程」都被本条款拒绝。Supervisor 远程接入走 GA IM frontend 或 SSH tunnel，不是 Galley 的事。
- **B4-I3**: **数据不离开 Galley**（[CLAUDE.md](../../../CLAUDE.md#4-data-stays-in-galley)）。Galley 不存 supervisor ↔ human 的对话内容。Supervisor 通过 CLI 发的 commands + `--reason` 标注存进 Galley（per-session 行动日志），但 supervisor 跟 user 在 IM 里聊的对话**不**存。M7 supervisor 行动日志 GUI 只渲染 Galley-known origin 字段，不接 supervisor 对话回灌。
- **B4-I4**: **B3 不可逆**（[CLAUDE.md](../../../CLAUDE.md#5-rust-core-is-authoritative)）— 前端 stateless presenter，所有写权威在 Rust。B4 引入的所有新 CLI 命令必须**对称走 trait method → socket → 同一 Rust 实现**。GUI 也走同样路径，**不**为 GUI 单独 invoke 一条快捷路径。
- **B4-I5**: **SOP copy-first**（[Supervisor SOP](../../integrations/galley-supervisor-sop.md)）。Settings → Agent 的 "复制 SOP" 按钮只把 `docs/integrations/galley-supervisor-sop.md` 复制到剪贴板；Galley 不写 GenericAgent `memory/`，也不提供 "Install to GA memory" 入口。
- **B4-I6**: **Migration 备份强制**。Schema migration 010-014 在 Galley 内 hard-coded 备份步骤：先 copy `~/Library/Application Support/app.galley/` → `~/Library/Application Support/app.galley.backup.<timestamp>/`，再跑 migration。失败 → 拒启动 + 弹 Finder 到备份目录。dogfood 数据 6+ 月不能丢。
- **B4-I7**: **未签名发布策略不变**（[desktop runtime](../../desktop-runtime.md#signing-strategy)）。v0.2 仍是未签名 .dmg / .exe。release notes 必须明文说明 macOS 右键→打开 / Windows SmartScreen 绕过步骤——release notes 写法继承 [feedback_release_notes_style](../../../) 风格简洁优先。

## Acceptance criteria · B4 算完成（v0.2.0）

按顺序逐条 demo + tick（沿用 stub acceptance，已 codified）：

- [x] **A1**: CLI 命令表（PRD §11.1）全部实现：
  - Inventory: list / search / brief / show / status / health / version ← 已 B1
  - Operate: new / send / btw / stop / archive / restore / watch ← send/watch 已 B2，其余 B4 M1
  - Project: create / list / delete (原 archive，M1 sub-plan O2 改名)
  - Session: move (原 project move，M1 sub-plan O3 改语义)
  - Config: llm list / llm set
- [x] **A2**: 每个 CLI 命令在 `docs/agent-api.md` 都有完整 schema 文档（M6 schema_version=1 frozen 19 commands）
- [x] **A3**: Background mode 工作：关窗 → 隐藏，Cmd+Q → 真退。Galley Core 持续跑 (menubar / tray 图标存在) — shipped before v0.2.0
- [x] **A4**: Menubar / tray 图标：点击下拉菜单可 Show Galley / Quit — shipped before v0.2.0
- [x] **A5**: Galley Core 完全退出后 CLI 报 exit 4 "Open Galley first"（沿用 B2 exit 分类）
- [x] **A6**: `~/.config/galley/cli-path`（mac/linux）/ `%APPDATA%\galley\cli-path` (windows) discovery file 在 GUI 首次启动后存在，内容是 CLI binary 绝对路径 — M3 T3.1
- [x] **A7**: Settings → Agent 有 "安装 galley 命令" 按钮，点击触发 sudo + symlink（macOS）；Windows 显示 unsupported copy — M3 T3.3 macOS ship; Win path_install.rs cfg-gated Unsupported
- [x] **A8**: Settings → Agent 有 "复制 SOP" 按钮（[B4-I5](#phase-invariants--b4-特有的硬规则)），把 `galley-supervisor-sop.md` 复制到剪贴板，用户自行发给可信 Agent — M3 T3.4 后本轮改为 copy-first
- [x] **A9**: `docs/integrations/galley-supervisor-sop.md`（GA SOP）写完 — M4 T4.1 ship; JC dogfood 2026-05-20 pass（手动 supervisor flow；IM bot 集成 T4.2-T4.5 留 v0.6+ calendar gate）
- [x] **A10**: `.claude/skills/galley-supervisor/` Claude Skill 包写完 + 在 Claude Code 里加载试用通过 — M5 ship; JC dogfood 2026-05-20 pass
- [x] **A11**: v0.x → v0.2 数据 migration 备份机制 + [B4-I6](#phase-invariants--b4-特有的硬规则) 备份步骤生效 — M8 ship; 11 unit test pass; v0.2 无 schema delta 不触发实际备份 (forward-looking 为 v0.6+ mig 008+ 准备)。原 schema 010-014 sub-task re-scoped removed（B2 mig 006/007 已 ship）
- [x] **A12**: TopBar / GUI per-session 显示 supervisor 行动日志（PRD §6.1 #4）：穿插 human / supervisor 动作 + reason — M7 ship; JC dogfood 2026-05-20 pass
- [x] **A13**: 所有 Galley 架构原则（[CLAUDE.md](../../../CLAUDE.md)）在 code review 中能逐条 demo：localhost only / CLI 公开契约 / 数据不离开 Galley / 路径 B 不可逆 — [docs/architecture-demo.md](../../architecture-demo.md) ship 2026-05-20，4 principle 各自 code refs + grep gates (4 gate 全 exit 0) + tests + devlog provenance
- [x] **A14**: dogfood + external feedback gate — alpha releases plus 2026-05-31 community dogfood fixes cleared v0.2.0 ship decision

---

## M1 · CLI 写命令补齐 (D51-D54)

补齐 PRD §11.1 全部 write 命令。每条命令 = 1 trait method + 1 Tauri command（如 GUI 已有 invoke 路径则复用）+ 1 CLI subcommand + 1 socket route。**M1 内 sub-task 颗粒度比 B3 milestone 细**——单条命令是最小 ship 单位，允许多 commit。

> **实施前必读**：[B4 M1 sub-plan](./B4-M1-sub-plan.md) (ship 2026-05-20, 661 行)。Sub-plan 内决定：(a) 11 个 subcommand 拆 (playbook "7 commands" 实际按 subcommand 算 11 个) (b) **4-commit shape** by noun-group + prereq commit (c) **session stop = Abort 不 Shutdown** (d) **btw 不持久化** v0.1 保持 (e) **exit code 5=runner_error** 引入 (f) **llm list 走 SQLite cache** 不走 socket (g) **project move = assign_session_to_project** 语义 (h) **project archive = delete_project** v0.2 简化。12 risk + 8 reject + 6 open decisions JC review 后进 T1.1。

### Sub-tasks

- [x] **T1.0** M1 sub-plan ship (paperwork-only commit) — [B4-M1-sub-plan.md](./B4-M1-sub-plan.md) ship 2026-05-20
- [x] **T1.1** M1.1 prereq commit — `dd4f6cf` (GalleyError::RunnerError + socket helpers + tx-aware trait variants + get_pref_json + 6 new tests, 140 total pass)
- [x] **T1.2-T1.6** M1.2 session-write commit — `3cfb8de` (6 socket handler + 6 CLI subcommand + 4 GUI listener + 2 sessionsStore action; 1044 LOC; 140/140 cargo test pass; clean typecheck + lint). Detailed sub-plan numbering T1.2-T1.6 in [B4-M1-sub-plan.md §3](./B4-M1-sub-plan.md) is authoritative — the four legacy T1.1-T1.4 stub items below are subsumed.
- [x] **T1.7-T1.9** M1.3 project + llm commit — `8f1f4b0` (3 socket handler + 5 CLI subcommand + 2 GUI listener + 3 sessionsStore action; 620 LOC; 140/140 cargo test pass; clean typecheck + lint). Stub T1.5 / T1.6 below subsumed.
- [ ] ~~**T1.1** `galley session new`~~ — shipped under M1.2 above (atomic via SQLite tx wrap, sub-plan O1)
- [ ] ~~**T1.2** `galley session btw`~~ — shipped under M1.2 above (transient, runner-only per sub-plan §1.5)
- [ ] ~~**T1.3** `galley session stop`~~ — shipped under M1.2 above (Abort 不 Shutdown per sub-plan §1.4)
- [ ] ~~**T1.4** `galley session archive` / `restore`~~ — shipped under M1.2 above (thin wrapper)
- [ ] ~~**T1.5** `galley project create / list / move / archive`~~ — shipped under M1.3 above (rename → `delete` per sub-plan O2; `move` moved to `session move` per O3)
- [ ] ~~**T1.6** `galley llm list / set`~~ — shipped under M1.3 above (list 直读 SQLite prefs cache per sub-plan §1.6)
- [x] **T1.7** `agent-api.md` 增量写入 — M1.4 commit `f461ba0` ships §5.8-§5.18 covering 11 new commands + stability bullet + exit code 5 row + socket error envelope + planned section update
- [x] **T1.8** CLI integration tests — `cli/tests/m1_writes.rs` 17 tests covering all 11 M1 commands (exit-4 no-Core for socket writes, full happy/empty/shape-error coverage for direct-SQLite reads, clap surface validation)

### M1 完成标志

- ✅ A1 / A2 / A5 全 tick
- ✅ Cargo test 全过：157/157 (was 140 pre-M1; +17 from m1_writes.rs)
- ✅ `docs/agent-api.md` 含全部 18 commands schema (B1 read 7 + B2 write 2 + B4 M1 11 = 20 entries; §5.5a/5.5b counts as 2)
- ✅ pnpm typecheck + lint clean throughout
- ✅ 4 commits independent revertable: `dd4f6cf` prereq · `3cfb8de` session writes · `8f1f4b0` project + llm · `f461ba0` docs+tests

---

## M2 · Tray spike → Background mode (menubar daemon) (D55-D57)

**最高风险 milestone**（[B4-R1 Tauri tray 兼容性](#已知风险) + B4-R2 App Nap）。Spike 在 prereq 阶段单独跑，spike 验证通过后 M2 实施。

> **实施前必读**：B4 M2 sub-plan + tray spike 报告（spike 阶段单独 commit）。Sub-plan 内决定：(a) tray icon resource 路径 + Tauri v2 tray plugin 版本 (b) `app.preventDefault()` 关窗事件处理 (c) Cmd+Q vs 红色按钮 vs Window 菜单 → Quit 差异化 (d) App Nap 解除策略（`NSProcessInfo.beginActivity` 还是 `caffeinate` 子进程）。

### Sub-tasks

- [ ] **T2.0** Tray spike (prereq, 1 day) — [spike spec](../../../core/experiments/tray-mode/README.md) (2026-05-20 ship)；scaffold + 实跑 → ship 通过 → spike report devlog
- [ ] **T2.1** M2 sub-plan ship
- [ ] **T2.2** Tauri tray plugin v2 setup — `cargo add tauri-plugin-window-state` / `tauri-plugin-positioner` (per spike findings)；`tauri.conf.json` tray icon resource
- [ ] **T2.3** 关窗事件改 hide：在 Rust `setup` hook 注册 window event listener，`WindowEvent::CloseRequested` → `window.hide()` + `api.prevent_close()`；**Cmd+Q 例外**：menubar Quit menu item 走 `app.exit(0)` 真退
- [ ] **T2.4** macOS App Nap 解除 — `NSProcessInfo.beginActivity` 或 Rust crate；spike 验证 hidden window WebView 可以继续 emit Tauri event（CLI 写命令在 background 仍能 emit `runner-event` 让用户重开窗口时看到完整历史）
- [ ] **T2.5** Menubar 图标 — 静态 icon（per [O1 stub decision](#open-decisions) 倾向）+ 数字 badge active session count（runtimeStore 订阅 `byId` 中 status='running' 的计数）
- [ ] **T2.6** Menubar 下拉菜单 —
  - "Open Galley"（重 show window + focus）
  - 状态行 "N active · M idle"（disabled MenuItem, 仅显示）
  - Separator
  - "Quit Galley"（→ `app.exit(0)`）
- [ ] **T2.7** 首次关窗弹一次 toast/dialog「Galley 还在 menubar 跑」+ "Don't show again" pref
- [ ] **T2.8** Windows tray equivalent — Tauri v2 tray API cross-platform，理论 same code；spike 阶段必须验证 Windows tray icon 渲染 + Cmd+Q 等价物（Alt+F4 不能真退，必须走 tray Quit）
- [ ] **T2.9** Dogfood — JC 用一天，重点验证 (a) menubar 跑 8h+ 不卡 (b) CLI 在 GUI hide 时仍可写入 (c) Cmd+Q 真退 + 桌面 dock icon 消失

### M2 完成标志

- A3 / A4 / A5 全 tick
- Tray 在 macOS + Windows 都过 smoke（dual-platform 测过，Windows 不一定要 JC 自跑 — 可以拿 CI 头一过即可）

---

## M3 · Discovery file + Settings Agent (D58)

Settings → Agent tab 是 supervisor 配置入口的 GUI 半边；discovery file 是给 supervisor 读 CLI 路径的契约面。

### Sub-tasks

- [ ] **T3.0** M3 sub-plan ship — deferred (M3 scope concrete enough to implement directly; sub-plan would have been inline-equivalent rationale)
- [x] **T3.1** Discovery file 写入 — `f0e6306` (2026-05-20). `core/src/discovery.rs` ~280 LOC, writes `~/.config/galley/cli-path` on Mac/Linux + `%APPDATA%\galley\cli-path` on Win; 2 lines (CLI absolute path + `schema_version=1`); idempotent (byte-equal compare before write); non-fatal across 6 outcome branches. 3 lib unit tests.
- [x] **T3.2** Settings → Agent tab 新建 — `2554cb7` (2026-05-20). `SettingsIntegration.tsx` 4 sections (Discovery file path display / Supervisor SOP / 命令行 PATH / Agent API docs), `Robot` icon for the tab list entry after rename.
- [x] **T3.3** "Install `galley` to PATH" 按钮 — `d23dfc6` (2026-05-20). macOS via osascript admin-privileges shell + `ln -sf` atomic+idempotent + 4-state PathInstallRow UI (not_installed / installed / other_target / unsupported) + double-layer shell quoting (sh single-quote inside AppleScript string). Windows path stays as M3 follow-up (cfg-gated Unsupported branch + flagged in commit message).
- [x] **T3.4** "复制 SOP" 按钮 — `a218b00` (2026-05-20) first shipped GA memory install; 2026-05-21 reworked to copy-first. `core/src/sop_install.rs` now only embeds/returns SOP text; GUI copies to clipboard with fallback.
- [x] **T3.5** "查看 Agent API 文档" 按钮 — `2554cb7` (2026-05-20, bundled with T3.2). Uses Tauri opener for the local/remote docs URL.

### M3 完成标志

- ✅ A6 / A7 (macOS) / A8 全 tick
- ✅ Settings → Agent tab dev mode 跑通 Agent SOP / PATH / API docs flows (JC dogfood found clipboard + opener issues; both fixed in this thread)
- A7 Windows path 标 v0.2 follow-up (PRD §12.3 acceptance text doesn't differentiate platforms; M3 fulfills it for the Mac-only v0.2 dogfood window, ship-time Windows install follows the same Tauri command surface so GUI side has zero new code when path_install.rs Windows impl lands)

---

## M4 · Galley Supervisor SOP for GenericAgent (D59-D60)

文档 + dogfood 验证 + iteration。这是 v0.2 dual-native framing 对外的「示例 supervisor」第一案。

### Sub-tasks

- [ ] **T4.0** M4 sub-plan ship (deferred — T4.1 doc-only, no impl needed; sub-plan would mainly cover T4.3 dogfood structure when that starts)
- [x] **T4.1** 写 `docs/integrations/galley-supervisor-sop.md` — shipped `bf9e607` (2026-05-20). 434 lines, 9 sections following spec. System-prompt-addendum tone. References agent-api.md as canonical schema.
- [ ] **T4.2** SOP 安装到自己 GA `memory/` (通过 M3 Settings 按钮)
- [ ] **T4.3** Dogfood 1-2 周 — JC 在自己微信 / 飞书 frontend 上跑真 supervisor scenario：「让 GA 帮我开个 session 跑 X 任务」→ GA 读 SOP → 调 CLI → Galley 接收 → GA 反馈结果
- [ ] **T4.4** iterate SOP — dogfood 发现的 SOP 不清晰处 / agent 误用 path 修复 + 单独 commit
- [ ] **T4.5** Open question 解决：
  - SOP 在哪里 publish？仓库 `docs/integrations/` + 外链到 fudankw.cn/sophub（如果 sophub 接受，[stub Open #5](#open-decisions)）
  - SOP 是否要 multi-language？v0.2 中文一版即可，i18n 推 v0.6+

### M4 完成标志

- A9 tick — full supervisor scenario 跑通
- SOP 在 `docs/integrations/galley-supervisor-sop.md` 落地 + dogfood 1 周稳定

---

## M5 · Claude `galley-supervisor` Skill (D61)

Claude Code skill package — 让 Claude 用户 install 完直接能调 Galley CLI。

### Sub-tasks

- [x] ~~**T5.0** M5 sub-plan ship~~ — skipped per N15 (4 options pinned via AskUserQuestion; M3-style direct impl chosen)
- [x] **T5.1** 写 `.claude/skills/galley-supervisor/SKILL.md` — 316 行；frontmatter bilingual trigger 关键词 (中英文 IM-style + Claude-Code-style 表达)；body 6 段 (你的角色 + Step 1 Discovery + Step 2 Cheatsheet + Step 3 Scenarios + Step 4 Destructive + Step 5 Origin + Step 6 Exit codes + Self-check)；supervisor identity convention `claude-skill-galley-supervisor/v1` codified
- [x] **T5.2** Auxiliary files — `references/galley-supervisor-sop.md` 448 行 verbatim copy of `docs/integrations/galley-supervisor-sop.md` + sync header (canonical source + last-synced date + drift-resolution rule)；scripts/ **omitted** per user pick (SKILL.md inline bash snippets sufficient — re-add if dogfood reveals Claude regenerating discovery-file resolution repeatedly)
- [x] **T5.3** 在 Claude Code 上 install 这个 skill — symlink `~/.claude/skills/galley-supervisor → /repo/.claude/skills/galley-supervisor` (mirrors lark-* skill convention)；smoke test PASS — harness immediately picked up `galley-supervisor` in the available-skills system reminder with full description visible，frontmatter YAML well-formed，trigger keywords reachable
- [ ] **T5.4** 写一个示例 scenario — "用 Claude 创建 Galley session 跑某 task" + 截图录屏（v0.2 release notes 用）— **defer to JC dogfood + v0.2 release prep**（screen recording needs JC's screen, can't be done headless; pair with M9 release-notes draft）

### M5 完成标志

- A10 **partial tick** — skill files shipped + Claude Code harness loads it (smoke); full A10 requires JC to fire a real trigger prompt (e.g. "帮我看看 Galley 现在跑啥") and confirm Claude reads discovery file → runs CLI → returns sensible output. Dogfood task carried into v0.2 release-prep window alongside T5.4 screenshot scenario.

---

## M6 · agent-api.md v1 定稿 (D62)

Schema_version=1 frozen point。M6 ship 后 schema 修改要求 bump v2。

### Sub-tasks

- [x] ~~**T6.0** M6 sub-plan ship~~ — skipped per N16; M3/M5-style direct impl. Schema audit IS the load-bearing M6 work, not a separate paperwork step.
- [x] **T6.1** 检查全部 19 命令的 schema 完整性 — read §5.1-§5.18 + §6 + §6A + §8A in full. Catalogued field naming consistency, enum value stability, nullable semantics, error envelope shape. **Two hairline issues found** (snake_case version output + nested vs flat error envelope) — see Issue A / Issue B in N16.
- [x] **T6.2** Exit code 表确认 — 0/1/2/3/4/5 全 6 类已覆盖。9 wire-level error discriminants (5 CLI-visible + 4 transport-level) all map cleanly to exit codes via `map_error_tag` fallback to `Internal`. SOP retry policy stable.
- [x] **T6.3** Stability promise 段写作 — §1.1 added with 4 stable identifier tables: CLI errors (5) / socket-wire-only errors (4) / status enums (4 — SessionBrief.status / MessageBrief.role / HealthCheck.status / Origin.via) / dispatch values (per-command, because they differ) / stream.reason values. §7 strengthened with "additive `detail` is non-breaking" clause.
- [x] **T6.4** Schema 修改 vote — **JC approved both pre-freeze fixes via AskUserQuestion** before any code changes. Issue A: `galley version` snake_case → camelCase (one `#[serde(rename_all = "camelCase")]` line on VersionPayload). Issue B: read error envelope `{error, detail:{message}}` → flat `{error, message}` (changed serde annotation from `tag = "error", content = "detail"` to bare `tag = "error"` so enum fields flatten). Plus the missed snake_case `detail.message` fallback in `cli/src/main.rs::main()`'s serde-failure path. Both fixes have zero shipped consumers + zero test breakage (cli/tests grep confirmed no `detail` field parsing anywhere). v1 stays as v1.
- [x] **T6.5** Publish — `--schema=N` global CLI flag added (clap `global = true` on the top-level `Cli` struct), validates against `SCHEMA_VERSION` in `main()` before subcommand dispatch. Mismatch → exit 2 `invalid_args` with `schema_mismatch:` message prefix. Socket already had `schemaVersion` JSON field since B2. §1.2 documents both pinning mechanisms. agent-api.md status banner updated to "FROZEN for v0.2.0".

### M6 完成标志

- ✅ A2 tick — 19 commands schema 完整文档 (was "14" in playbook — real count is 19 across §5.1-§5.18 including 5.5a/5.5b split)
- ✅ agent-api.md 顶部 banner 标 "FROZEN for v0.2.0" + §1.1 stable identifier sets + §1.2 schema pinning
- ✅ 169 tests pass (was 167; +2 schema pin tests in cli/tests/cli_test.rs)
- ✅ Pre-freeze fix integrity: zero test breakage, GUI typecheck/lint clean, cargo check clean

---

## M7 · Per-session supervisor 行动日志 GUI (D63)

PRD §6.1 #4 GUI 渲染层 — 让 human user 在 Galley 看到 supervisor 在干啥。

### Sub-tasks

- [x] ~~**T7.0** M7 sub-plan ship~~ — skipped per N17; M3 / M5 / M6 pattern. AskUserQuestion pinned 4 UX decisions (annotation vs bubble, static vs live, v1 scope, no helper scripts) before any code.
- [x] **T7.1** Origin plumbing through messages store — MessageRow type extended with `created_via` / `supervisor` / `origin_note`; `rowsToTurns` lifts the row's origin triple into a typed `Origin` on UserTurn (history restore path); App.tsx `user-message-persisted` listener extracts `message.origin` + `message.createdAt` and threads them into `appendUserTurnExternal` (live path). The action signature now accepts `origin?: Origin, createdAt?: string`. New `Origin` type added to `types/conversation.ts` alongside Turn variants. UserTurn now carries `origin?: Origin` + `createdAt?: string`.
- [x] **T7.2** Inline annotation on user message — chose **annotation strip** over SupervisorActionBubble (per AskUserQuestion: supervisor-driven user messages aren't a third party speaking, they're metadata about who relayed the user's message). MessageUser renders a thin italic 11.5px ink-muted line above the brand-soft callout: `@<supervisor> · <reason ≤80 chars> · <relative time>`. Reason longer than 80 chars truncates with ellipsis; full text + absolute ISO timestamp surfaces in `title=` tooltip. Renders only when `origin.via === "supervisor"` — `gui` / `cli` / `system` rows render no annotation (zero clutter for the default Galley-driven path). `formatSupervisorMeta` + `formatRelativeTime` inlined in MessageUser.tsx (single caller, ~25 LOC each).
- [x] **T7.3** TopBar SupervisorActivityIndicator — small neutral pill in the right cluster (between conversation-width toggle and YOLO indicator slot). Robot Phosphor icon + `@<latest-supervisor> · <count>` text. Click → Radix Popover with per-supervisor breakdown ordered last-seen-first. count=0 → pill hides entirely (TopBar stays uncluttered for non-supervisor sessions). `deriveSupervisorActivity` helper added to App.tsx (module-level), memoized via `useMemo(deps=[storeTurns])` so the pill doesn't churn on unrelated state. Helper returns `undefined` when total=0 so the TopBar prop check is the only gate.
- [x] **T7.4** [B4-I3 enforce](#phase-invariants--b4-特有的硬规则) — Honored. Only origin triple persisted in messages table renders. Supervisor↔user IM chat would have to live in Galley DB to render; it doesn't (and won't — see [CLAUDE.md "数据不离开 Galley"](../../../CLAUDE.md)). v1 scope explicitly excludes `session archive` / `session move` / `llm set` non-message writes — they don't leave a per-event audit trail in v0.2 data model and won't render here without a new `supervisor_actions` table (punted to v0.6+).
- [x] **T7.5** [O4 partial](#open-decisions) — density baseline ships (single annotation line per supervisor message; tooltip carries full detail; per-supervisor aggregation in Popover). "相邻 ≤ 5s 同 supervisor 动作折叠成单 entry" 折叠 deferred — given v1 only renders user-message writes (not archive / move / llm set), the spam vector the playbook flagged doesn't materialize in v0.2 surface (it'd matter when a supervisor batches 10 archive calls in 5s, but v1 doesn't render those at all). Re-evaluate after v0.6 supervisor_actions table lands.

### M7 完成标志

- ✅ A12 partial tick — supervisor activity annotation in conversation timeline + TopBar pill both ship + harness clean. Full A12 awaits JC dogfood: fire `galley session send <id> "test" --supervisor=ga-claude-1 --reason="dogfood M7"` against a live session and confirm annotation strip + TopBar pill both render correctly.
- ✅ Plumbing covers both history-restore + live-event paths (rowsToTurns + appendUserTurnExternal)
- ✅ typecheck / lint / cargo check all clean; zero existing test breakage

---

## M8 · v0.x → v0.2 data migration 真跑 (D64) ✅ COMPLETE (2026-05-20)

最 P0 风险（数据丢失不可恢复）。[B4-I6](#phase-invariants--b4-特有的硬规则) 备份步骤强制。**Re-scope 2026-05-20**：B2 mig 006/007 已 ship 全部 origin 字段，v0.2 无新 schema delta；M8 真活儿 = backup mechanism + 失败处理 + 文档化 rollback。详 [M8 sub-plan §1.1 现状对照](./B4-M8-sub-plan.md#11-现状对照) + [M8 完成 devlog](../../devlog/2026-05-20-b4-m8-migration-backup.md)。

### Sub-tasks

- [x] **T8.0** M8 sub-plan ship — [B4-M8-sub-plan.md](./B4-M8-sub-plan.md) ship 2026-05-20，含 re-scope §1.1 / trigger policy §1.2 / backup 路径 §1.3 / 失败语义 §1.4 / setup hook 顺序 §1.5 / version detection §1.6
- [x] ~~**T8.1** Schema migration 010 — `messages.created_via`~~ — 砍除 (B2 mig 006 已 ship)
- [x] ~~**T8.2** Migration 011 — `messages.supervisor`~~ — 砍除 (B2 mig 006 已 ship)
- [x] ~~**T8.3** Migration 012 — `messages.origin_note`~~ — 砍除 (B2 mig 006 已 ship)
- [x] ~~**T8.4** Migration 013-014 — sessions origin~~ — 砍除 (B2 mig 007 已 ship)
- [x] **T8.5** Rust migration backup mechanism — `core/src/migration_backup.rs` 415 行 (model + 4-state outcome enum + sqlx read-only probe + 14 行 recursive copy + chrono UTC compact timestamp) + setup hook wire-in ([lib.rs:445-475](../../../core/src/lib.rs)) 在 tauri-plugin-sql 打开 DB **之前** 跑
- [x] **T8.6** 备份失败 → 拒启动 + Tauri error dialog + `std::process::exit(2)` — `[backup] FATAL` log + 中文 dialog 指出数据安全位置 + 检查磁盘/权限建议；partial backup 目录不清理（避免无限循环）
- [ ] **T8.7** Dogfood migration — **推迟到 v0.6+** prereq（v0.2 没新 mig delta 触发不到 backup 路径，dogfood 无意义；等 v0.2.x / v0.6 第一次加 mig 008+ 时真跑）
- [x] **T8.8** Rollback strategy 文档化 — 不提供 official downgrade path；备份目录手动 `mv` 是 escape hatch；详 [M8 sub-plan §T8.8](./B4-M8-sub-plan.md#t88-rollback-strategy-文档化)
- [x] **T8.9** Test matrix — 11 个 unit test (copy_dir_all 4 个 + ensure_backup 7 个) 全过；`cargo test --workspace` 180/180 (was 169 + 11 新)；cargo check + pnpm typecheck + pnpm lint clean

### M8 完成标志

- ✅ A11 partial tick — backup mechanism ship + 11 unit test pass + manual smoke V3/V4 设计；full A11 等 v0.6 真 dogfood
- ✅ B4-I6 invariant 兑现（hard-coded backup step 落地）
- ✅ `LATEST_CODE_MIGRATION_VERSION` 从 migrations vec 推导，单一编辑站点
- ✅ `cargo test --workspace` 180/180
- ✅ pnpm typecheck + pnpm lint clean

---

## M9 · B4 acceptance + v0.2 ship 准备 (D65+) · ✅ Shipped (2026-05-31)

v0.2.0 release ceremony。Paperwork prep (T9.0 + T9.3 + T9.4 draft + T9.7)
shipped 2026-05-20；release tag / publish / update channel promotion shipped
2026-05-31.

### Sub-tasks

- [x] **T9.0** M9 sub-plan ship — [B4-M9-sub-plan.md](./B4-M9-sub-plan.md) 2026-05-20，含 scope assessment + framing decisions + README rewrite plan + release notes draft + PRD/refactor README align + open decisions
- [x] **T9.1** 跑遍 A1-A14 acceptance — v0.2.0 release verification used local typecheck / lint / Rust checks + release CI + draft asset review
- [x] **T9.2** Dogfood 一周 — superseded by alpha releases plus targeted community dogfood fixes before stable ship
- [x] **T9.3** README 改写 — v0.1 "本地桌面工作台" framing → v0.2 dual-native orchestrator (tagline D `本地 agent team 编排器 —— GUI 给人，CLI 给 supervisor agent`)。功能 today/即将 split 合并 v0.2-present。"给 Supervisor Agent 用 · 集成 v0.2" 新增 section 链接 SOP + Skill。架构图清 🚧 markers。安装 v0.x.x → v0.2.x。`cd desktop` → `cd gui`。Galley CLI 单独构建段加。**DESIGN.md onboarding subtitle 同步推迟 M9 ship 时改 React 组件**
- [x] **T9.4** Release notes draft — [M9 sub-plan §4.2](./B4-M9-sub-plan.md#42-draft) inline ship。沿用 feedback_release_notes_style 简洁优先（不写 lead-in / 不写 Alpha 解释 / 不写 Upstream 段；Installation 用命令）。Highlights / New / Fixes / Migration / Installation 5 段。**Ship 时还要补**：CI artifact 文件名 + B4 完成 devlog 链接 + 新功能 GIF
- [x] **T9.5** Tag v0.2 — `v0.2.0` tag pushed; CI produced aarch64 DMG / x64 DMG / Windows setup artifacts
- [x] **T9.6** GitHub Release publish — `v0.2.0` published as non-prerelease GitHub Latest
- [x] **T9.7** PRD / CLAUDE.md / refactor README 标 v0.2 status — PRD §17 路线图加状态列 + 各阶段时间窗 / 状态 / 描述同步实际进度（v0.1.1 ✅ / B1-B3 ✅ / B4 7/9 + paperwork prep / v0.2 TBD dogfood 后）。docs/refactor/README.md cursor + dashboard B4 row 加 M8 / M9 prep 进度。CLAUDE.md stage 9 row M8 段已在 M8 closeout 加完
- [x] **T9.8** 写 B4 完成 devlog + v0.2 release devlog — v0.2 release devlog shipped 2026-05-31
- [ ] **T9.9** [Open #5 stub](#open-decisions) — 投 Galley Supervisor SOP 到 fudankw.cn/sophub（如果 sophub 接受）。**Post-ship optional**

### M9 完成标志

- ✅ Paperwork prep done (T9.0 / T9.3 / T9.4 draft / T9.7) — 2026-05-20
- [x] v0.2 ship 到 GitHub Latest（T9.5 + T9.6 dogfood 后）
- [x] README align dual-native framing
- [x] DESIGN.md onboarding subtitle align（M9 ship session）
- [x] PRD §17 路线图 align v0.2 status
- [x] B4 + v0.2 devlog ship（T9.8 post-ship）

---

## Running notes / gotchas

**Append-only. Don't delete. 旧的判断错了追加新条说明。**

### 写在前面的已知 gotcha（开 B4 前要注意）

- **G1 (M1 sub-plan 时)** — PRD §11.1 命令表的 `archive` / `restore` 语义跟 B3 M4 trait method (`archive_session` / `unarchive_session`) 命名差一字。CLI 用 PRD 命名（archive/restore 更直觉），Rust trait 保持 unarchive。Sub-plan 内 review CLI naming alignment。
- **G2 (M2 spike 必须做)** — Tauri v2 tray API 在 macOS 14+ 跟 Windows 11 行为不一致是已知。Spike report 必须 cover 两个 OS。若 macOS 通过 / Windows fail → 考虑 v0.2 Mac-only ship + v0.6 补 Win（mirror v0.1 Mac-only 决策模式）。
- **G3 (M3 PATH install)** — macOS 的 sudo prompt 走 `osascript with administrator privileges`，但用户拒绝 sudo 怎么办？fallback：toast「请运行：sudo ln -s /Applications/Galley.app/Contents/MacOS/galley /usr/local/bin/galley」给用户手动跑。**不**对 sudo 失败 hard error。
- **G4 (M4 SOP dogfood)** — SOP 写得再清楚 agent 也会误用。第一次 dogfood 重点观察 agent 调 destructive 命令（archive/delete）时是否 confirm。如不 confirm → SOP 加强 + Galley 端 archive 命令是否要 `--confirm-i-mean-it` flag？（倾向**不**加，CLI 走 supervisor 已经是一层隔离）
- **G5 (M5 Claude Skill trigger)** — Skill description / trigger 词如果写不对 Claude 不会主动调。参考 anthropic-skills/ 几个 well-tested skill 的 trigger 写法。dogfood 反复调整。
- **G6 (M6 schema freeze)** — 真到 freeze 时反悔成本高。**M6 sub-plan 时强制 review 全 schema** 一遍，包括字段名 / enum 值 / nullable 语义。如有疑问宁可 v0.2 ship 前 bump v2 重写 SOP，**不**ship 后再发现 schema bug。
- **G7 (M7 supervisor activity GUI)** — 行动日志显示密度 vs 信噪比 trade-off。MVP 实现 "每动作一行" 但留 hover 折叠路径，dogfood 后 iterate。
- **G8 (M8 migration 备份磁盘空间)** — dogfood 数据可能 GB 级（messages_fts + tool_events 累积）。备份 step copy 整目录可能耗时 + 占盘。**Spike 一次实测**：M8 sub-plan 写 disk-space check + 用户提示「备份需 X GB 空间，继续？」。
- **G9 (M9 dogfood 1 周)** — B3 走 event-driven dogfood gate（JC 体感 OK 就推进）。**M9 dogfood 严格走 1 周**——v0.2 是 phase 切换 + 公开发布，比 milestone 内部切换更慎。

### Session 跑下来追加的 notes（按日期）

- **N1 (2026-05-20, B4 playbook 升格)** — Stub (144 行) 升格成详细 playbook (~500 行)。沿用 B3 sub-plan-then-impl 模式：M1-M9 每个 milestone 实施前**单独写 sub-plan**。Acceptance 沿用 stub A1-A14 不动。新增 B4-I1..I7 phase invariants（沿用 CLAUDE.md 4 条架构原则 + B4 特定规则如 schema freeze / SOP 路径固定 / migration 备份强制）。Sub-task 颗粒度跟 B1/B2/B3 对齐（T1.1-TN.X 数字编号 + sub-task 完成标志逐 milestone 列）。Open: [O1-O6 沿用 stub](#open-decisions)；新加 [O7 NEW](#open-decisions-new) tray spike 何时跑（prereq 阶段 vs M2 开头）+ [O8 NEW](#open-decisions-new) M3 PATH install 失败 fallback strategy。

- **N22 (2026-05-20 late night, M2 tray-mode spike scaffold ship — build verification handed to JC)** — Followed N21 with M2 Mac spike attempt. Spike scaffolded per `core/experiments/tray-mode/README.md` spec: own workspace `Cargo.toml` + `build.rs` + `tauri.conf.json` (identifier `app.galley.m2spike` isolated) + `index.html` (heartbeat counter + hidden-time tracker) + `src/main.rs` (tray menu Show/status/Quit + `WindowEvent::CloseRequested → hide` + heartbeat thread via `std::thread::spawn`) + `icons/icon.png` (copied from production).

**Build cycle hit Tauri/objc2 toolchain friction** (5 attempts):
1. Build #1 cold WITH objc2 deps: ✅ compiled in 1m57s
2. Run #1: ✗ runtime panic — `tokio::spawn` no reactor (Tauri tao event loop ≠ tokio context). Fix: `tauri::async_runtime::spawn`
3. Build #2: ✗ clang linker error (Foundation framework link?) — `tail -10` log truncation lost the actual error
4. Build #3 cold full-log: ✗ killed at 13min rustc codegen hang in `objc2-foundation` macro expansion
5. Build #4 `CARGO_INCREMENTAL=0`: ✗ same hang at 8min
6. Build #5 (dropped objc2 entirely + `std::thread::spawn`): ⏸ killed at 6min mid Tauri 2.11 cold rebuild — JC opted to take over locally rather than burn more session on cargo cold-cache

**Decision: App Nap defeat (T17-T19) pulled OUT of this spike**. After 30+ min on Foundation framework link issues, made the call to drop `objc2` + `objc2-foundation` deps + `app_nap.rs` entirely. T17-T19 graduate to a smaller standalone probe binary (no Tauri) once T1-T16 main path is verified. If T13/T14 (WebView keep-alive while hidden) PASS in JC's local run, App Nap defeat is less critical.

**T1-T16 verification deferred to JC**. Spike code is complete; what's left is the visual / behavioral check (manual). Results template in [`core/experiments/tray-mode/results.md`](../../../core/experiments/tray-mode/results.md) has T1-T16 rows with ⏳ ready for fill-in. JC's local procedure:
```bash
cd core/experiments/tray-mode
cargo build              # 8-15min cold Tauri 2.11 rebuild on local machine
./target/debug/tray-mode-spike   # launch + manual menubar / close / Quit checks
```

**Acceptance impact**: A3 / A4 still ⏳ — gated on JC's spike T1-T16 results. No status change from N21.

**Open**:
1. Why did objc2-foundation codegen hang at 8-13min? Two Build attempts showed same pathological behavior. Could be `bitflags-2` interplay or NSProcessInfo binding's heavy generic instantiation. Re-investigate when separate App Nap probe ships.
2. Build #2's linker error was lost to `tail -10` truncation. Worth one more cargo-verbose attempt if probe stays simple.
3. If JC's local build succeeds + T1-T16 PASS, M2 production implementation lifts straight from `src/main.rs` (close handler shape + tray menu structure).

**Next session pickup**: JC reports T1-T16 manual results → either (a) GO for M2 production implementation in `core/src/lib.rs` setup hook + standalone App Nap probe / (b) NO-GO findings + rethink.

- **N21 (2026-05-20 night, A9/A10/A12 dogfood pass + A13 architecture demo ship)** — JC dogfood 同日 pass："dogfood 后没有发现什么问题，继续推进"。**Acceptance ticks unlocked**: A9 ✅ (M4 SOP — 手动 supervisor flow tested) / A10 ✅ (M5 Claude Skill trigger validated) / A12 ✅ (M7 supervisor activity GUI annotation + TopBar pill rendered). **A13 ✅ shipped** via [docs/architecture-demo.md](../../architecture-demo.md) NEW (~210 LOC) — walks through 4 CLAUDE.md architecture principles with: per-principle code refs (line-number anchored) + grep gates + tests demonstrating principle + document references. **All 4 grep gates exit 0** verified inline: P1 (no TcpListener in core/src/) / P2 (FROZEN banner in agent-api.md) / P3 (no supervisor_chat / conversation_log in core/src/ + core/migrations/) / P4 (gui/src/stores/useAppStore.ts absent post-B3 M6). **B4 acceptance status now**: A1 ✅ A2 ✅ A3 ⏳(M2) A4 ⏳(M2) A5 ✅ A6 ✅ A7 ✅(macOS) A8 ✅ A9 ✅ A10 ✅ A11 ✅(partial, dogfood deferred v0.6+) A12 ✅ A13 ✅ A14 ⏳(M9 1-week dogfood). **10 ✅ / 1 ✅partial / 3 ⏳** — 剩下 3 个全都 calendar / Win-machine gate: M2 menubar + 1-week dogfood + （implicitly）M9 release ceremony. **v0.2 ship 距离最近的一次**：技术上 A1-A13 全 ✅ 后 v0.2.0-beta.1 可以拍板，唯一硬 gate 就是 A14 一周 dogfood 加 M2 Win 支持（如选 v0.2 Mac-only ship 则 M2 Mac 部分单独跑也能）. **Next pickup**: cleanup commit (3 pre-existing clippy lints) + DESIGN.md onboarding subtitle T9.3 follow-up check + （以下需要 JC 同意）M2 Mac-only spike 或等 1-week dogfood 完成。

- **N20 (2026-05-20 evening, M9 paperwork prep COMPLETE · sub-plan + README rewrite + release notes draft + PRD align)** — Followed M8 ship with M9 prep (per user "继续推进" instruction). **Scope = paperwork only** (T9.0 / T9.3 / T9.4 draft / T9.7); ship-gated items (T9.1 acceptance / T9.2 dogfood / T9.5 tag / T9.6 publish / T9.8 devlogs) all calendar / JC gated, deferred to M9 ship session.

**Single docs commit** covering 5 files:
- `docs/refactor/B4-M9-sub-plan.md` (NEW, 320+ 行) — scope assessment vs playbook + v0.2 framing decisions (tagline D selected, "Supervisor Agent" + "dual-native" inline explanation pattern) + README rewrite delete/change/keep map + release notes 5-section draft + PRD/refactor README align scope + 4 open decisions
- `README.md` (rewrite) — v0.1 "今天" / "v0.2 之后" 时序分裂整体退役为 v0.2 现在时，v0.1 退化为 blockquote 历史注；功能 today/即将 split 合并为单一 list（含 ⚙️ Galley CLI + 📡 Agent API + 🍱 Background mode + 🔄 backup）；新增 "给 Supervisor Agent 用 · 集成 v0.2" section（GA bot 集成 + Claude Code 集成 + Settings → Agent 复制 SOP 入口）；架构图清 🚧 markers；安装 v0.x.x → v0.2.x；从源码构建 `cd desktop` → `cd gui` + Galley CLI 单独构建段加
- `docs/PRD.md` §17 路线图 — 时间窗列改 "时间窗 / 状态" 列；v0.1 ✅ + v0.1.1 ✅ (2026-05-18) + v0.2 B-refactor 不挡 + Prototype-B3 各 ✅ 日期 + B4 7/9 进行中 + v0.2 TBD ship gated on dogfood
- `docs/refactor/README.md` cursor + dashboard — cursor 改 M8 + M9 prep COMPLETE narrative；B4 row 加 M8 + M9 paperwork prep；新增 "v0.2 milestone" row 标 ship gated；Last-touch 列同 session 多 update OK
- `docs/refactor/B4-cli-bg-artifact.md` M9 section + 本 N20 — M9 header 升 "📋 Paperwork prep complete"；T9.0/T9.3/T9.4/T9.7 ✅ ticked，T9.1/T9.2/T9.5/T9.6/T9.8/T9.9 left ⏳ with ship/dogfood gate annotations；M9 完成标志 split paperwork ✅ vs ship ⏳

**Per-decision notes during impl**:
1. **Tagline D selected** (`本地 agent team 编排器 —— GUI 给人，CLI 给 supervisor agent`) over current A (PRD-direct translation), B (English-first), C (redundant "agent team / agent team"). D gives dual-native signal directly without forcing English-language scan order on zh-CN readers.
2. **README v0.1 退化为 blockquote** — keeping a one-line historical footnote rather than deleting all v0.1 references honors the "Galley 来自 GA workbench" origin story (matches existing italic origin quote) without bloating the present-tense narrative.
3. **"Supervisor Agent" first-use inline explanation** — README is the GitHub-front-door, first-time visitors need self-contained term explanations. Pattern: bold first mention + inline em-dash gloss + subsequent free use.
4. **README "给 Supervisor Agent 用 · 集成 v0.2" 加 dedicated section** — supervisor adapter ecosystem is v0.2's #1 differentiator; links to SOP + Skill + Settings → Agent make this discoverable from README without forcing reader into agent-api.md.
5. **README_en.md not updated** — sub-plan O1 resolved with "标 legacy + v0.2 ship 后再做英文重写" to keep session paperwork scope sane. Footer in zh README links `[English README](./README_en.md) (legacy v0.1 — v0.2 rewrite TBD)`.
6. **Screenshots 不动** (sub-plan O3) — 6 张 v0.1.1 hero screenshots 仍代表 GUI 主体，supervisor 功能 GUI 改动小（TopBar pill / annotation strip 不显眼），不值单独截图重做。
7. **Release notes draft kept in sub-plan §4.2** — not in repo. M9 ship session 复制到 GitHub Release body 时补 CI 出的 artifact 文件名 + B4 devlog 链接 + 截图。
8. **PRD §17 加 "状态" 列** rather than rewrite roadmap completely — non-destructive update, history readable, future maintenance lower (each row's status changes with milestone progress; not the whole table).
9. **B4 playbook M9 sub-task ticks distinguish ✅ paperwork-done vs ⏳ ship-gated** — preserves visibility into what's done vs what blocks M9 closeout, matching the sub-plan §1 split.

**Verification**:
- `pnpm typecheck` + `pnpm lint` — no code changes, both clean
- `grep -E "v0\.5 之后|今天（v0\.1）|即将（v0\.5）|🚧|v0\.x\.x|cd desktop" README.md` — 0 hit
- M9 sub-plan §3.5 manual verification checklist runs cleanly

**B4 status after N20**: M1 / M3 / M4 T4.1 / M5 / M6 / M7 / M8 milestones shipped + M9 paperwork prep done. **v0.2.0-beta.1 acceptance**: A1 ✅ A2 ✅ A3 ⏳ A4 ⏳ A5 ✅ A6 ✅ A7 ✅ A8 ✅ A9 partial A10 partial A11 ✅ partial A12 partial A13 ⏳ A14 ⏳. Ship gate: dogfood + acceptance walkthrough.

**Next session pickup**:
1. **JC dogfood interleave** (still highest leverage non-paperwork path) — closes A10 (M5 trigger) + A12 (M7 supervisor annotation) full ticks; also M3 macOS PATH install dev-mode validation
2. **M2 tray spike Mac portion** (if JC consents to spike without Win co-validation; M9 sub-plan §1 didn't include but possible)
3. **Cleanup commit** (3 pre-existing clippy lints) — low value but ready when needed
4. **M9 ship session** — only after T9.1 acceptance + T9.2 dogfood complete

**Velocity note**: M8 (2 commits feat + closeout) + M9 prep (1 single docs commit incoming) in one session continues B4-era 1-2 hour wall-clock-per-milestone pace. M9 ship session itself estimated 2-3 hours for acceptance walkthrough + tag + publish + 2 devlogs once dogfood gate clears.

- **N19 (2026-05-20 evening, M8 ✅ COMPLETE · pre-migration backup mechanism · 1 feature commit + closeout)** — Followed N18 option (b) M8 path. **Re-scope first** ([M8 sub-plan §1.1](./B4-M8-sub-plan.md#11-现状对照)) — B2 mig 006/007 已 ship 全部 origin 字段，v0.2 无新 schema delta，原 T8.1-T8.4 (migration 010-014) 全部砍除。真活儿 = backup mechanism (T8.5) + 失败处理 (T8.6) + rollback 文档 (T8.8) + tests (T8.9)。

**Implementation 单 commit shape**:
- `core/Cargo.toml` — chrono top-level dep (zero net-new crate; transitive via sqlx)
- `core/src/migration_backup.rs` — NEW 415 行：4-state `BackupOutcome` enum (`FreshInstall` / `UpToDate` / `NotApplicable` / `Backed`) + 3-variant `BackupError` + `ensure_backup_before_migrate(latest_version)` 生产入口 + `ensure_backup_before_migrate_in(data_dir, latest_version)` 测试入口 + sqlx read-only probe of `_sqlx_migrations.MAX(version)` (缺表当 0) + 14 行手写递归 `copy_dir_all` (无 fs_extra 依赖；symlinks 静默跳过) + chrono UTC compact timestamp `%Y%m%dT%H%M%SZ`
- `core/src/lib.rs` — `mod migration_backup;` + 顶部从 migrations vec 推导 `latest_migration_version` (单一编辑站点 invariant) + setup hook 开头 backup 段在 socket listener / discovery 之前；失败 → 中文 Tauri error dialog (`tauri_plugin_dialog::MessageDialogKind::Error`) + `std::process::exit(2)` 拒启动

**Per-decision notes during impl**:
1. **Trigger policy = Strategy A** (字面 honor B4-I6 "schema migration ... hard-coded 备份步骤")。v0.2 不触发 backup (on-disk version == code-side max == 7)；forward-looking 为 v0.6+ 准备。
2. **Setup hook 位置 A**（`.setup()` 开头）—— tauri-plugin-sql 注册时只暂存 migration vec，真正连接 DB 是 JS-side `Database.load()` 在 webview ready 之后。setup() 同步跑保证先于 plugin 打开 DB。
3. **`LATEST_CODE_MIGRATION_VERSION` 从 migrations vec 推导** (`.iter().map(|m| m.version).max()` 之后 `move` 进 setup closure)。单一编辑站点 = 加 migration 不会忘 bump backup const。
4. **`chrono` top-level dep** — 已在 lock file (transitive via sqlx)。`default-features = false` + 只开 `clock` feature。手算 Howard Hinnant date 算法 trade-off 不划算。
5. **手写 `copy_dir_all` 14 行** —— `std::fs` 没有，引入 `fs_extra` 只为一处不值。14 行递归足够透明。symlinks 静默跳过 (Galley 数据目录不应有 symlinks)。
6. **失败 dialog 中文 + 同步 blocking_show** —— webview 可能未起，跨进程异步不可靠。用户主要 zh-CN。`std::process::exit(2)` 干净退出。
7. **partial backup 目录留下不清理** —— 避免重启重试无限循环；下次成功新 timestamp 不冲突。release notes 提醒用户可手动清 `app.galley.backup.*`。
8. **Test signature 拆 in / 公共两层** —— `ensure_backup_before_migrate_in(data_dir, ...)` 是测试入口接受任意 path，`ensure_backup_before_migrate(...)` 是生产入口走 `resolve_data_dir()`。11 个 unit test 全用 `tempfile::TempDir` 隔离 `~/Library/...`。

**Files touched** (5):
- `core/Cargo.toml` (chrono dep)
- `core/src/migration_backup.rs` (NEW)
- `core/src/lib.rs` (mod registration + setup wire-in)
- `docs/refactor/B4-M8-sub-plan.md` (NEW)
- `docs/devlog/2026-05-20-b4-m8-migration-backup.md` (NEW)

**Verification**:
- `cargo test --workspace` — **180/180** (was 169 baseline + 11 from `migration_backup::tests`: 4 copy_dir_all + 7 ensure_backup paths)
- `cargo check --workspace` — clean
- `pnpm typecheck` — clean
- `pnpm lint` — clean (0 warnings)
- `cargo clippy` — 3 pre-existing lints unrelated to M8 (origin.rs doc list × 2 + socket_listener.rs unnecessary_cast)；clippy 不在 CI gate（check.yml 只跑 cargo check + cargo test）

**Acceptance unlocked**: A11 partial ✅ (mechanism ship + 11 unit test pass + manual smoke V3/V4 设计；full A11 tick 等 v0.6 真 dogfood with mig 008+).

**B4 status after N19**: 7 of 9 milestones shipped (M1 / M3 / M4 T4.1 / M5 / M6 / M7 / M8). Remaining: **M2 menubar daemon** (Windows-machine gated), **M4 T4.2-T4.5** (IM bot calendar-gated), **M9 v0.2 release ceremony** (needs A12 / A13 / A14 full tick + 1-week dogfood). v0.2.0-beta.1 acceptance: A1 ✅ A2 ✅ A3 ⏳ A4 ⏳ A5 ✅ A6 ✅ A7 ✅ A8 ✅ A9 partial A10 partial A11 ✅ partial A12 partial A13 ⏳ A14 ⏳.

**Open from this session**:
1. T8.7 dogfood real run pushed to v0.6+ prereq (no schema delta in v0.2 to trigger backup path)
2. v0.6+ APFS clone optimization (`fs::copy` 不调 `clonefile` syscall) for GB-scale data
3. Time Machine 双备份风险 (Galley backup 在 `~/Library/...` 默认 TM 范围内) — release notes 提醒高级用户可 exclude `app.galley.backup.*`
4. clippy 3 pre-existing lints (origin.rs doc list × 2 + socket_listener.rs unnecessary_cast) — clippy 1.94 新增的 strictness；不在 CI gate；可在 cleanup commit 一并修

**Next session pickup**: N18 推荐的 (a) JC dogfood interleave 路径仍 open，可关 A10 (M5 Skill trigger) / A12 (M7 supervisor render) / M3 macOS PATH install dev-mode validation。alternatively M9 release ceremony 也可启动 (A11 already ✅ partial 是 unblocker)，但 A13 + A14 dogfood 1-week 仍需 calendar gate。

**Velocity note**: M8 单 session ship 跟 M5/M6/M7 节奏一致 — sub-plan + 实施 + tests + closeout ~1-2 hour wall-clock。playbook 原 estimate "最 P0 风险 + 4 schema sub-task" 因为 re-scope 大幅压缩；实际只剩 backup mechanism + 11 测试。

- **N18 (2026-05-20 PM, session-end handoff)** — This session pushed B4 from "M1 + M3 + M4 T4.1 + M5 shipped, M6 next" to **"M1 + M3 + M4 T4.1 + M5 + M6 + M7 all shipped"**. **7 commits** in dependency order: `5262043` M5 Claude Skill feature → `7ba348f` M5 closeout → `4934dda` M6 pre-freeze code fixes (camelCase version output + flat error envelope + `--schema=N` global flag) → `ae20c96` M6 agent-api.md schema freeze (banner + §1.1 stable identifier sets + §1.2 schema pinning + §6 unified error envelope + §6A Origin per-via semantics + §8A trait surface reframe) → `74969e5` M6 closeout → `137fbcb` M7 supervisor activity GUI (3-layer wiring: Origin plumbing through restore + live paths, MessageUser annotation strip, TopBar pill) → `fb4235f` M7 closeout. **Test delta**: 167 → 169 (+2 schema pin tests in cli_test.rs; M5 + M7 are paperwork / frontend so no Rust test churn). **LOC delta**: M5 +844 (skill files) / M6 +233 (76 code + 157 docs) / M7 +430 (3-layer GUI plumbing) = ~1500 LOC net add this session. **Acceptance unlocked**: A2 ✅ (M6 — schema frozen with 19 commands fully documented) + A10 partial ✅ (M5 — files ship + harness loads, full tick wants JC trigger prompt) + A12 partial ✅ (M7 — files ship + harness clean, full tick wants JC live `galley session send --supervisor=…`). **Supervisor stack now contractually locked** — M1 (CLI surface) + M4 SOP (GA bots) + M3 (discovery + installers) + M5 (Claude Skill) + M6 (schema freeze) + M7 (GUI rendering) form an end-to-end supervisor-driven write path with stable schema_version=1. **JC dogfood pass during session**: JC said "继续推进" 3 times across M5 → M6 → M7 picks; both AskUserQuestion polls (M6 Issue A + Issue B fixes; M7 v1 scope + render shape + TopBar shape + sub-plan skip) went all-Recommended. **B4 status**: 6 of 9 milestones shipped (M1 / M3 / M4 T4.1 / M5 / M6 / M7). Remaining: **M2 menubar daemon** (Windows-machine gated; not unblockable this end), **M4 T4.2-T4.5** (SOP dogfood + iteration; calendar-gated by JC's IM bot integration timeline), **M8 v0.x → v0.2 data migration** (frontend-light, mostly Rust schema migrations + backup strategy + dogfood real run), **M9 v0.2 release ceremony** (last; needs A11 / A12 / A13 / A14 ticked first). v0.2.0-beta.1 acceptance breakdown: A1 ✅ A2 ✅ A3 ⏳ (M2) A4 ⏳ (M2) A5 ✅ A6 ✅ A7 ✅ (macOS) A8 ✅ A9 partial (M4 T4.3 dogfood) A10 partial (M5 trigger) A11 ⏳ (M8) A12 partial (M7 dogfood) A13 ⏳ (M9) A14 ⏳ (M9 1-week dogfood). **Next session pickup options**: (a) **JC dogfood interleave** — 3 milestones want live validation (M5 trigger prompt against fresh Claude Code session "帮我看看 Galley 现在跑啥" / M3 Settings → Agent tab click-through with discovery file path display + SOP copy flow + osascript PATH install on macOS / M7 `galley session send --supervisor=ga-dogfood --reason="M7 smoke"` + verify annotation strip + TopBar pill). ~30-45 min total; closes A10 + A12 full ticks + finishes M3 dev-mode validation. Cheap interleave with no other gates. (b) **M8 v0.x → v0.2 data migration** — schema migrations 010-014 design + backup strategy (B4-I6 备份强制 — `~/Library/Application Support/app.galley/` copy before migration runs) + dogfood real run against JC's accumulated data. Calendar-gated by JC having enough dogfood data to make the backup path load-bearing. Note: messages.created_via / supervisor / origin_note already exist (B2 mig 006/007 ship), and sessions.created_via / created_by_supervisor / created_origin_note also exist (B2 mig 007). The "010-014" range in the playbook may be inflated — actual schema diff in v0.2 might be 0-1 migrations + the backup mechanism is the real M8 work. Worth a re-scope before starting. (c) **M9 release ceremony** — too early, needs M8 + dogfood first. (d) **M2 tray spike** — Windows-machine gated, opportunistic. **Recommended pickup**: option (a) JC dogfood interleave — cheap, validates 3 milestones we shipped today, and the findings inform M8 (e.g., if M7 annotation reveals a UX issue, fix-then-migrate is better than migrate-then-fix). Then M8 with re-scoped surface based on actual data layer state. **Open from this session**: (1) `formatRelativeTime` duplicated MessageUser + TopBar — extract to `lib/relative-time.ts` if a third caller shows up; (2) M7 v1 scope intentionally excludes archive/move/llm set actions — v0.6+ supervisor_actions table extension path documented in N17; (3) M8 migration numbering may need re-scope (the playbook's "010-014" predates B2's mig 006/007 ship); (4) schemaVersion: 1 frozen — agent-api.md is now load-bearing for SOP / Skill correctness; consider contract tests against shipped supervisors as v0.6 tripwire. Velocity note: 7 commits + 3 milestones in one session continues the B4-era pace (M1+M3+M4 T4.1 in one earlier session, M5 in another, M6+M7 in this one — each milestone is ~1-2 hour wall-clock when impl is sub-plan-skipped + AskUserQuestion-pinned).

- **N17 (2026-05-20 PM, M7 ✅ COMPLETE · supervisor 行动日志 GUI · 1 feature commit + closeout)** — Followed N16 recommendation. **4 AskUserQuestion options pinned upfront**: (1) skip M7 sub-plan paperwork — concrete UX decisions resolved via the question itself, no separate doc adds value; (2) **v1 scope: render only message-row origin** (user messages with `via=supervisor`); non-message supervisor actions (archive / move / llm set) intentionally don't render — they don't have per-event timeline rows in v0.2 data model, and adding a `supervisor_actions` table would be 3-4× scope; (3) **inline annotation strip** over SupervisorBubble — supervisor-driven user messages are semantically "user spoke via supervisor", not "supervisor injected speech"; annotation strip carries identity + reason as metadata without dressing it up as a separate party speaking; (4) **static TopBar pill** over live-pulse indicator — v1 derives from persisted state; real-time "writing now" would need a new Rust emit which doesn't pay off without dogfood evidence first.

**Implementation walked 3 layers**:
- **Data layer**: `MessageRow` (`types/db.ts`) extends with `created_via` / `supervisor` / `origin_note` matching B2 migration 006/007 column names (SQLite already returns these via `SELECT *` since the columns exist; only TypeScript needed the type expansion). New `Origin` type added to `types/conversation.ts` next to existing Turn variants (kept the contract type close to where it's consumed by render). `UserTurn` gains optional `origin?: Origin` + `createdAt?: string`. `rowsToTurns` adds an `originFromRow(row)` helper that returns `undefined` for default-`gui` and pre-006 NULL rows (so no annotation strip renders for the common case) and a typed Origin for cli / supervisor / system rows. App.tsx `user-message-persisted` listener type widened to accept `message.origin` + `message.createdAt` from the Rust emit (MessageBrief already carried them since B2). `appendUserTurnExternal(sid, text, origin?, createdAt?)` signature widened — old callers stay source-compatible since the new args are optional.
- **Conversation render**: MessageUser.tsx adds `origin` + `createdAt` props. When `origin?.via === "supervisor"`, the component renders a small italic 11.5px ink-muted strip above the brand-soft callout: `@<supervisor> · <reason ≤80 chars> · <relative time>`. `formatSupervisorMeta` computes display + tooltip (full untruncated reason + absolute ISO); `formatRelativeTime` does Chinese-leaning bucketed time ("刚刚" / "N 分钟前" / "N 小时前" / "N 天前" / `YYYY-MM-DD`). Both helpers inlined since they're 15-25 LOC and have a single caller. Conversation.tsx passes the new props through.
- **TopBar pill**: `SupervisorActivity` + `SupervisorBucket` types added to TopBar.tsx (exported because App.tsx needs them for the prop type). `SupervisorActivityIndicator` component — neutral pill (border-line bg-surface rather than YOLO's warning amber, because supervisor activity is metadata not an alert state) with Robot icon + `@<latest> · <count>`. Click → Popover (same Radix pattern as YoloIndicator) showing per-supervisor bucket list ordered last-seen desc. count=0 hides the pill entirely (zero clutter for sessions without supervisor writes). `deriveSupervisorActivity(turns)` lives in App.tsx as a module-level helper, called via `useMemo` on `storeTurns`. Returns `undefined` when no supervisor user message exists so TopBar's prop check is the only gate.

**Per-decision notes during impl**:
1. **Annotation strip placement**: chose ABOVE the user-msg callout (not inside, not below) so the apricot brand-soft block keeps its role as the primary visual anchor for scroll-back; the annotation reads as a small caption (like a byline above a photo) rather than competing with the message content.
2. **Robot icon choice**: Phosphor `Robot` thin — "agent" is the natural semantic match for "supervisor wrote this"; alternatives like `User` would conflict with the human user; `Lightning` is reserved for YOLO; `ChatCircleDots` reads as "side question" already (per SystemMessageBubble.tsx variant). Robot is unambiguous "AI / programmatic" and matches the Galley brand register.
3. **Time helpers duplicated, not extracted**: MessageUser + TopBar both have a `formatRelativeTime` (15 LOC each, identical). Could extract to `lib/relative-time.ts` but that's a premature abstraction at 2 callers — per CLAUDE.md 克制 rule. If a third site shows up (Sidebar, EarlierDialog, etc.), extract.
4. **`bySupervisor` ordering**: last-seen desc — when a supervisor reviews their activity, the most-recent one is the most likely "who am I looking at right now". Alphabetical felt arbitrary; recency matches the conversation timeline's natural order.
5. **TopBar pill rendering check**: Pill hides on `count === 0` (not just `undefined`) so a session that gets a supervisor message then has them all deleted (future scenario) still cleans up. Defensive but cheap.
6. **`storeTurns` reference identity stability**: `deriveSupervisorActivity` is memoized on `storeTurns` which is from the Zustand store — `useMessagesStore` returns stable references when the underlying value doesn't change. Verified the EMPTY_TURNS frozen-singleton stays stable across renders for empty sessions (B3 work codified this; see useAppStore React 19 strict-mode comment in messages.ts).

**Files touched**:
- `gui/src/types/db.ts` (+3 fields on MessageRow)
- `gui/src/types/conversation.ts` (Origin type + UserTurn extension)
- `gui/src/stores/messages.ts` (Origin import + appendUserTurnExternal signature widening)
- `gui/src/stores/messages/rowsToTurns.ts` (Origin import + originFromRow helper + UserTurn construction)
- `gui/src/lib/db.ts` — no change (uses `SELECT *`, picks up new columns automatically)
- `gui/src/App.tsx` (Turn import + deriveSupervisorActivity helper + useMemo + TopBar prop pass + user-message-persisted listener payload widening)
- `gui/src/components/conversation/MessageUser.tsx` (Origin prop + annotation strip + formatSupervisorMeta + formatRelativeTime)
- `gui/src/components/conversation/Conversation.tsx` (pass origin + createdAt to MessageUser)
- `gui/src/components/layout/TopBar.tsx` (SupervisorActivity + SupervisorBucket types + supervisorActivity prop + SupervisorActivityIndicator component + formatTopBarRelativeTime)

**Tests + checks**: 169 cargo tests still passing (M7 doesn't touch Rust); pnpm typecheck clean; pnpm lint clean; cargo check on both core + cli crates clean. Zero existing test breakage. **No new TS unit tests** — the changes are mostly type plumbing + presentational components, and the dogfood smoke test (JC fires a real `galley session send --supervisor=…`) validates the end-to-end behavior more meaningfully than a unit test of `deriveSupervisorActivity` alone would.

**A12 partial tick**: files ship + harness clean. Full A12 needs JC to:
1. Open Galley GUI to warm up a session
2. From a separate terminal: `$(cat ~/.config/galley/cli-path) session send <session-id> "test from supervisor" --supervisor=ga-dogfood --reason="M7 smoke test"`
3. Verify the new user message renders with `@ga-dogfood · M7 smoke test · 刚刚` strip above the apricot callout
4. Verify TopBar shows `🤖 @ga-dogfood · 1` pill in the right cluster
5. Click pill → Popover shows `@ga-dogfood · 1 条 · 刚刚`
6. Send a second message from the same supervisor + a different one — verify count + last-seen + ordering update correctly

**Scope deferrals to v0.6+**: (a) `supervisor_actions` table for non-message writes (archive / move / llm set timeline entries); (b) live "supervisor writing now" pulsing indicator (would need a new Rust event emitted from socket_listener when a write command lands); (c) "相邻 ≤ 5s 同 supervisor 动作折叠成单 entry" density throttle — doesn't apply to v1 surface since only user messages render and they're rate-limited by composer/CLI human latency. Re-evaluate when supervisor_actions table lands.

**Next session pickup options**: (a) **JC dogfood interleave** — M5 trigger validation + M3 button click-through + M7 supervisor annotation smoke test, ~30 min, closes A10 / A12 full ticks + finishes M3 dev-mode validation; cheap interleave; (b) **M8 v0.x → v0.2 data migration** — schema migration 010-014 design + backup strategy + dogfood real run; calendar-gated by JC's accumulated dogfood data; v0.2 ship blocker eventually; (c) **M2 tray spike** — still Windows-machine gated; (d) **M9 sub-plan + release-notes draft** — v0.2.0-beta.1 checklist work; needs A11 (migration) + A14 (1-week dogfood) to land first. **Recommended**: (a) dogfood interleave — cheap insurance that 3 milestones we shipped today (M5 / M3 / M7) survive live testing before we layer M8 on top. M8 needs JC's actual sessions to be load-bearing for a real migration test, so the order JC dogfood → M8 backup design → M8 implementation feels natural. M2 stays Windows-blocked regardless.

**Open from this session**: (1) `formatRelativeTime` is duplicated across MessageUser + TopBar — extract to `lib/relative-time.ts` if a third caller shows up. (2) `deriveSupervisorActivity` is in App.tsx — if the supervisor activity computation grows (e.g. adding archive / move entries when supervisor_actions table lands), it'll outgrow App.tsx and want extraction into `lib/supervisor-activity.ts`. (3) The Popover content currently shows last 7 days of bucketed timestamps as relative + falls back to `YYYY-MM-DD` — no scrolling / pagination since per-session supervisor count realistically stays small. If a session ever accrues >20 supervisors, the Popover needs a max-height + overflow. Punt unless dogfood reveals it.

- **N16 (2026-05-20 PM, M6 ✅ COMPLETE · `schemaVersion: 1` FROZEN · 3 commits)** — Followed N15 recommendation (b) M6. Single session execution. **G6 gotcha honored** — full schema audit (T6.1) before any freeze decision, with both transports (CLI + socket) cross-checked field-by-field. **2 hairline issues found + fixed pre-freeze** (zero shipped consumers means no SOP / Skill rewrite cost): **Issue A** — `galley version` was emitting `{galley_version, schema_version}` in snake_case while every other field on the wire is camelCase (SessionBrief.projectId, MessageBrief.lastActivityAt, etc.). Likely original B1 oversight; survived 5 milestones because no test or downstream consumer parsed those fields. Fix: one `#[serde(rename_all = "camelCase")]` annotation on the local `VersionPayload` struct. **Issue B** — read error envelope was `{error: "not_found", detail: {message: "..."}}` (nested via `#[serde(tag = "error", content = "detail")]`) while socket envelope is `{ok, requestId, error, message}` (message flat at top). SOPs would have to write two parsing paths to extract the message. Fix: drop the `content = "detail"` so serde flattens GalleyError fields → `{error: "not_found", message: "..."}` matches socket shape exactly. Also caught the `cli/src/main.rs::main()` serde-failure fallback string `{"error":"internal","detail":{"message":"..."}}` and updated it to match (plus proper backslash/quote escaping in the message). **Decision before code: AskUserQuestion to JC** — both fixes approved (both Recommended). **JC inputs**: "改成 camelCase" + "统一到 {error, message, detail?}". **`--schema=N` global flag implementation** — playbook T6.5 says "publish `?schema=1` query parameter pattern". `?schema=N` is a URL convention; CLI is flags. Implemented as a top-level clap arg with `global = true` so any subcommand can carry it. Validation lives in `main()` **before** subcommand dispatch — mismatch returns early with `GalleyError::InvalidArgs { message: "schema_mismatch: client requested N, server speaks 1" }` → exit 2. **Why exit 2 not exit 1**: the CLI-side mismatch is a user-input validation failure (bad `--schema` arg). Server-side socket mismatch is different — surfaces via wire `schema_mismatch` discriminant → CLI's `map_error_tag` `_ → Internal` → exit 1. Both paths documented in §1.2. **agent-api.md changes** (~200 lines added across the doc): status banner "B4 M1 in-progress" → "B4 M6 — `schemaVersion: 1` FROZEN for v0.2.0-beta.1" / §1 add "camelCase everywhere" invariant clause + new §1.1 (5 stable identifier sub-tables: 5 CLI errors / 4 socket-wire errors / 4 status enums / dispatch values per-command / stream.reason values) + new §1.2 (CLI flag + socket field schema pinning, with reciprocal exit-code semantics) / §5.1 example camelCase / §5.2 SessionBrief `pinned` / `hasUnread` null semantics clarification / §6 unify error envelope into CLI / socket subsections (both now show same `{error, message}` core, socket wraps with `{ok, requestId, ...}`) / §6A Origin field per-via semantics (gui never has supervisor, supervisor must have it, cli optional, system reserved internal) + Origin auto-elevation rule (CLI `--supervisor` flips via to supervisor) / §7 "frozen at v0.2" + additive `detail` clause / §8 "additions non-breaking inside v1" + §8A trait-vs-CLI surface reframe (M4 mints supervisor-facing subset, others stay GUI-only). **Tests added**: 2 in cli/tests/cli_test.rs — `schema_pin_matching_v1_passes_through` (smoke: `--schema=1 version` exits 0) + `schema_pin_mismatch_exits_2_invalid_args` (mismatch: `--schema=99 version` exits 2 with `schema_mismatch:` prefix). Total 169 (was 167). Pre-existing `version_subcommand_prints_schema_v1` updated to check `schemaVersion` (camelCase) instead of `schema_version`. **Per-decision notes during impl**: (1) playbook T6.5 says "publish ?schema=1 query parameter pattern" — interpreted as the supervisor-pinning pattern, not literal `?schema=1` (CLI uses flags, socket uses JSON field; both implemented); (2) §1.1 dispatch-values table breaks down per-command because they're semantically different (session stop is abort_sent/already_stopped, others dispatched/persisted_only) — a single union enum would mislead supervisors into writing pattern-matches that don't reflect command semantics; (3) §6A clarification on `via=cli` accepting `supervisor` field is *new* policy — Galley auto-elevates `via=supervisor` when `--supervisor` is passed, so a `via=cli` row with a supervisor field would only occur if a SOP wrote against the socket directly with malformed Origin; documenting it as "doesn't reject but discouraged"; (4) §8A reframe from "B4 will mint matching CLI surface" to "M1 minted supervisor-facing subset, others stay GUI-only by design" reflects the actual M1 ship decision (sub-plan O3 narrowed CLI scope). **Files touched**: `core/src/error.rs` (1-line serde annotation + 8-line doc comment), `cli/src/main.rs` (4 changes: top-level Cli struct adds `schema: Option<u32>`, `main()` adds schema pin validation block before subcommand dispatch, VersionPayload struct gets `rename_all` annotation, error-fallback string fixed to flat shape + proper escaping), `cli/tests/cli_test.rs` (3 changes: rename test assertions + add 2 new tests), `docs/agent-api.md` (8 section edits). **A2 ✅ tick**. **Next pickup options**: (a) **M7 supervisor 行动日志 GUI** — origin fields already persist in SQLite (B2 mig 006/007 + B4 M1 socket origin); UI work to render SupervisorActionBubble in conversation timeline + TopBar indicator. Frontend-heavy. ~2 sessions; (b) **M8 v0.x → v0.2 data migration** — schema migration 010-014 (created_via / supervisor / origin_note already exist via B2 mig 006/007, so 010-014 may be lighter than playbook estimates) + backup strategy + dogfood real run against JC's data. Calendar-gated by JC having enough dogfood data to test the backup path against; (c) **JC dogfood M5 + M3 trigger validation** — 15-30min, finishes A10 full tick. Cheap interleave; (d) **M2 tray spike** — still Windows-gated. **Recommended**: option (a) M7 — it's the last frontend-heavy A* tick (A12), and the data layer is already there from B2 + B4 M1 origin path. M8 has calendar dependencies (need dogfood data accumulation); M2 has Windows dependency. M7 is the highest-velocity path. Alternative: (c) JC dogfood interleave is no-cost insurance against M5 / M3 latent UX issues — could pair with M7 paperwork. **Open from this session**: (1) §6A says `via=cli` with `supervisor` field is "doesn't reject but discouraged" — should the Rust schema enforce this with a stricter validation, OR keep it permissive for direct-socket SOPs that don't want to flip via? Punt to dogfood feedback. (2) The trait surface in §8A documents methods like `rename_session` / `set_session_pinned` / `bulk_*` as "GUI-only by design" — if a future supervisor scenario needs them (e.g. "rename this session to 'Q4 review'"), they get minted as new CLI subcommands. Path is clear and additive. (3) `schemaVersion: 1` is now load-bearing — the test surface only validates exit code + error tag prefix; future regressions in field names / enum values / dispatch values rely on the agent-api.md doc as the source of truth. Could consider adding contract tests against shipped supervisors (M5 SKILL.md / M4 SOP) as a tripwire — punt to v0.6 unless dogfood reveals drift.

- **N15 (2026-05-20 PM, M5 ✅ COMPLETE · 1 feature commit)** — Followed N14 recommendation (a). 4 AskUserQuestion options pinned upfront: (1) skip M5 sub-plan paperwork — M3-style direct impl (M3 N13 precedent: when playbook spec is concrete, sub-plan adds calendar overhead without resolving open-decision magnitude); (2) skill lives in `repo/.claude/skills/galley-supervisor/` version-controlled, manual copy/symlink for distribution (rejected "user-global, no commit" because no version control + no team distribution; rejected "Claude plugin format" because cowork-plugin overhead premature for v0.2); (3) **no helper scripts** — SKILL.md inline bash snippets sufficient (scripts/ adds second-layer indirection + cross-platform maintenance burden; re-add only if dogfood reveals Claude regenerating discovery-file resolution boilerplate); (4) **verbatim SOP copy in references/** with sync header — skill is self-contained for offline use; sync header makes drift visible. **Per-task impl decisions**: (T5.1 SKILL.md 316 行) — frontmatter description **bilingual** (中文 IM-style 触发短语 + English Claude-Code-style 触发短语) since real Claude users of this skill can be either language; body **re-framed from GA-bot-IM SOP to Claude-Code user POV** (supervisor identity changes from "ga-im-bot" to `claude-skill-galley-supervisor/v1`; references to "IM" / "user pings via WeChat" generalized to "user via claude"); body **terser than SOP** (6 steps vs 9 SOP sections) — Claude can re-load full SOP from references/ for edge cases, so SKILL.md focuses hot path; Step 5 Origin explicitly **codifies supervisor id convention** with version suffix bump rule for skill forks; (T5.2 references/ 448 行) — verbatim copy via `cp`，prepended HTML comment **sync header** with canonical-source path + last-synced date + drift-resolution rule (canonical wins); scripts/ **omitted** per option pin — playbook T5.2 mentions scripts/ but Claude can construct `cat ~/.config/galley/cli-path` inline trivially; (T5.2 README.md 80 行) — install instructions (symlink vs copy options, verify step), explains skill files + schema version pin + update path; (T5.3 install) — symlink via `ln -sfn` matches existing lark-* skill convention in `~/.claude/skills/`; **harness immediately picked up** `galley-supervisor` in next system-reminder available-skills list with full description visible → frontmatter YAML well-formed + trigger keywords reachable. **Acceptance**: A10 **partial tick** — files shipped + harness loads; full tick requires JC running a real trigger prompt to validate end-to-end (Claude reads discovery file → runs CLI → parses output → asks user for destructive confirms). **T5.4 deferred** — example scenario screen recording needs JC's screen + pairs naturally with M9 release-notes draft. **Files added**: 3 files +844 行 in `.claude/skills/galley-supervisor/` (SKILL.md 316 + README.md 80 + references/galley-supervisor-sop.md 448)。**Next session pickup options**: (a) **JC dogfood M5 + M3 in parallel** — fire trigger prompt against fresh Claude Code session asking "帮我看看 Galley 跑啥" + click Settings → Agent tab buttons in dev mode; reports any UX regressions / SOP gaps as N16; calendar 15-30min; (b) **M6 agent-api.md v1 freeze** — review §5.1-§5.18 schemas one more pass for stability promise; publish `?schema=1` query parameter pattern; lock down enum values + error codes; ~1 session paperwork; (c) **M7 supervisor 行动日志 GUI** — origin fields already in SQLite (B2 mig 006/007 + B4 M1 socket origin path); UI work to render SupervisorActionBubble in timeline + TopBar indicator; frontend-heavy, ~2 sessions; (d) **M2 tray spike** — still gated on Windows machine access; opportunistic; (e) **M8 v0.x → v0.2 data migration** — calendar-gated by dogfood data accumulation; v0.2 ship blocker eventually. **Recommended**: **option (b) M6 schema freeze** — natural close-out of the supervisor stack (M1 CLI + M4 SOP + M3 installers + M5 Skill all need stable schema_version=1 to claim contractual stability). After M6 the supervisor surface is "frozen at v1" and v0.2.0-beta.1 criteria mostly closed (A1/A2/A5/A6/A7/A8/A9/A10 all locked, leaving A3/A4 menubar + A11 migration + A12 supervisor activity GUI + A13/A14 dogfood). Alternative (a) JC dogfood is cheap interleave whenever JC has time and doesn't gate other milestones. **Supervisor identity convention now codified at 3 layers**: (1) docs/integrations/galley-supervisor-sop.md "ga-{platform}-bot[/instance]" pattern for IM bots; (2) `.claude/skills/galley-supervisor/SKILL.md` "claude-skill-galley-supervisor/v1" pattern for Claude users; (3) future supervisors fork the suffix/prefix pattern per use case. Audit log discriminability sustained.

- **N14 (2026-05-20 PM, session-end handoff)** — This session pushed B4 from "M1 complete + dogfood ready" to "M1 + M3 + M4 T4.1 all shipped". **13 commits today** in dependency order: M1.4 docs+tests `f461ba0` → M1 closeout `a982711` → M4 T4.1 SOP `bf9e607` → M4 T4.1 doc sync `cfc85ac` → M3 T3.1 discovery `f0e6306` → M3 T3.2+T3.5 Agent tab `2554cb7` → M3 T3.4 SOP install `a218b00` → M3 T3.3 PATH install `d23dfc6` → M3 closeout `4801bf1`. **Test count**: 140 → 167 (+27 across M1.4 integration tests + M3 discovery/sop_install/path_install lib units). **LOC delta**: M1.4 `+657` (agent-api +296 + cli/tests/m1_writes.rs new 352) + M4 T4.1 `+434` (SOP doc) + M3 `+1465` (discovery 280 + Agent tab 380ish + sop_install 220 + path_install 270 + GUI wiring + Tauri command surface 60). **Acceptance unlocked**: A1 ✅ A2 ✅ A5 ✅ (M1) + A6 ✅ A7-macOS ✅ A8 ✅ (M3) + A9 partial (M4 T4.1 SOP ship; T4.3 dogfood is calendar gate). **JC dogfood pass during session**: M1.4 "初步测试，没有发现问题"。M3 buttons not yet dev-mode dogfooded by JC — code path clean (cargo tests + typecheck/lint) but live click-through validates the auth dialog UX + SOP copy flow + Settings tab rendering. **Next session pickup options**: (a) **M5 Claude `galley-supervisor` Skill package** — `.claude/skills/galley-supervisor/SKILL.md` frontmatter + body + references/scripts subdirs; builds on shipped SOP (M4 T4.1) + shipped discovery file (M3 T3.1); paperwork ~1 session; (b) **JC dogfoods M3 in dev mode** — click Settings → Agent tab, validate Discovery file path display + 复制 SOP button flow including clipboard fallback + macOS PATH install osascript dialog; takes 15-30min on JC machine; report findings as N15; (c) **M7 supervisor 行动日志 GUI** (PRD §6.1 #4) — Origin 已经在 SQLite (B2 mig 006/007 + B4 M1 socket origin path)，UI 渲染层缺 timeline 穿插的 SupervisorActionBubble + TopBar indicator；frontend-heavy; (d) **M6 agent-api.md v1 定稿** — review existing §5.1-§5.18 schemas for v1 schema_version freeze; stability promise段写作；publish "?schema=1" pattern; (e) **M8 v0.x → v0.2 data migration 真跑** — set up backup migration path against JC's own data; calendar-gated by dogfood data accumulation; (f) **M2 tray spike** — still Windows-gated; opportunistic when JC borrows machine. **Recommended pickup**: option (a) M5 — natural chain (M1 CLI → M4 SOP for GA bots → M3 discovery + installers → M5 SOP for Claude users). Then JC dogfood M3 in dev mode whenever convenient — these are mostly independent of M5. **Open**: discovery file currently logs `CliBinaryNotFound` in production .app because Tauri externalBin bundling isn't configured yet — flagged in T3.1 commit message + N13. Either fix as M3 final-mile (small Tauri config change) before v0.2 ship, or fold into v0.2 release-prep checklist. **Galley CLI binary 文件名当前是 `galley`** (cli/Cargo.toml `name = "galley"`)，跟 PRD §12.1 expected install location `/Applications/Galley.app/Contents/MacOS/galley` 对齐。bundling: 检查 tauri.conf.json `bundle.externalBin` 是否能简单添加 `../target/debug/galley`（dev）/ `../target/release/galley`（release）; 复杂度 unknown 直到尝试。

- **N13 (2026-05-20 PM, M3 COMPLETE · 4 commits)** — Followed N12 recommendation (a) M3 implementation. 4 commits in dependency order: T3.1 discovery file → T3.2+T3.5 Settings tab + docs link → T3.4 SOP action button → T3.3 macOS PATH install button. **T3.0 sub-plan deferred** — M3 sub-tasks each have concrete spec from playbook + the relevant trait/library is straightforward; the M1 sub-plan's value came from open-decision resolution (6 O's), M3 has none of that magnitude. 1 inline question used (AskUserQuestion for T3.3 scope: mac-only vs dual-platform) instead of separate sub-plan paperwork. **Per-task decisions during impl**: (T3.1) **path resolution via sibling-of-current_exe** rather than hard-coding bundle paths — handles dev (`target/debug/galley-core` + `target/debug/galley`) and future bundled .app (`Galley.app/Contents/MacOS/{Galley,galley}`) identically; failure surfaces as `CliBinaryNotFound` outcome with clear setup-hook log telling user to bundle via externalBin (separate followup, not blocking M3); **6-variant outcome enum** (Written/NoOp/CliBinaryNotFound/ConfigDirUnresolvable/MkdirFailed/WriteFailed) so the setup hook log explicitly differentiates each failure mode instead of collapsing to "discovery write failed"; (T3.2) **PlugsConnected Phosphor icon** picked from limited "integration"-evocative options — Folder/Terminal already in section bodies, Plug/Plugs symbols are the canonical integration metaphor; tab placement **between Approval and Shortcuts** matches user task ordering (set approvals → wire integrations → learn shortcuts → about); SubLabel helper **duplicated locally** rather than extracted to a shared module — 5-line stylistic concern matches existing SettingsAbout pattern, abstraction premature at 2 reuses; (T3.4) **`include_str!`** at build time vs Tauri resource — embed means the binary is self-contained, can't have SOP file out-of-sync with code, +220KB binary cost is acceptable; **inline 3-button confirm** over modal — single-shot local decision, modal would overweight; **explicit `memory/` exists guard** rather than auto-create — missing memory/ signals misconfigured GA; CLAUDE.md B4-I5 compliance: fixed write path, no caller-controlled component; (T3.3) **macOS only** via N12 question to JC; **osascript admin-privileges shell** vs Tauri auth APIs — osascript is the documented Apple path, just works without bundling extra plugins, surfaces standard macOS auth dialog; **`ln -sf` atomic + idempotent** so re-install (after Galley app move) + first-install + replace-other-target are all one command; **double-layer shell quoting** (sh single-quote inside AppleScript "do shell script" string literal) tested via apostrophe pin so future refactors can't silently corrupt the encoding; **UserCancelled distinct from Failed** — osascript stderr contains "User canceled" on auth-dialog cancel, recognized so GUI keeps the flow non-alarming on accidental dismiss; **4-state UI** (not_installed/installed/other_target/unsupported) covers normal flow + drift cases (custom user install at `/usr/local/bin/galley`); `cancelled = false` cleanup flag in mount effect avoids the `react-hooks/set-state-in-effect` lint (caught in first lint run). **Tests**: discovery 3 + sop_install 6 + path_install 1 = 10 new unit tests; 167 workspace total (was 157 before M3). **M3 acceptance**: A6 ✅ (discovery file at documented path) / A7 ✅ macOS (Windows path flagged follow-up) / A8 ✅ (SOP install). **Next pickup options**: (a) M5 Claude Skill package — reads SOP + discovery file already shipped, paperwork-style work; (b) M2 tray spike — still Windows-gated; (c) JC dogfood M3 buttons in dev mode + report regressions before moving on. **Recommended**: M5 (a) — natural chain after M3 + M4 T4.1; integrates the supervisor stack we just shipped; Claude Skill is the second example supervisor (GA SOP being the first) that proves the dual-native framing isn't GA-specific.

- **N12 (2026-05-20 PM, M4 T4.1 SOP doc shipped · M1 dogfood pass)** — After M1 closeout JC dogfooded "M1.4 初步测试，没有发现问题" + 给出 "继续推进"。Next pickup decision: M2 implementation blocked on Windows-machine access (tray spike R1 gate)；M3/M4/M5 chain Mac-implementable + structurally independent. **Pick M4 T4.1 (SOP doc)** 作 first because: (a) 内容上游——M3 T3.4 install button + M5 Skill 都 reference 这个 SOP；(b) 纯 markdown 无工程风险；(c) 验证 M1 surface 从 SOP writer 视角——确认 11 个 write commands + 7 个 read commands 都有清晰 user-facing 表达；(d) calendar-cheap ~1 session。**SOP shape**：mirror system-prompt-addendum style（second person，直接指令 to LLM），不是 marketing copy。9 sections：你的角色 (3 rules of thumb) + Discovery + 命令速查 (3 sub-table by noun group) + 常用 scenario (8 个 IM-driven 流程映射到 CLI invocations) + Destructive 守则 (archive/stop/delete 决策表) + Origin 约定 (`--supervisor=` naming convention + `--reason=` when fill) + Error handling (exit code 分类 + retry policy per code + 常见 error recipes) + Not-in-v0.2 (refusal list) + Self-check + See also。**Decisions during write**: (1) 强调「discovery file 第一」——不假设 PATH symlink，多数 user 没装 (T3.3 PATH install 是 escape hatch 不是默认)；(2) `--supervisor=` naming convention 写「IM bot：ga-{platform}-bot / 多实例 ga-{platform}-bot/{name}」，给 future supervisors 一个 starter pattern；(3) Destructive 表 explicit 列「archive 可逆 / stop 可逆 / project delete 不可逆」三档，agent confirm density 跟可逆性挂钩；(4) Error retry policy 显式「exit 4 不自动重试 / exit 5 不自动重试 / exit 2 修参数后一次 / exit 3 不重试」——给 SOP 一个明确边界，否则 agent 容易反复试；(5) Schema drift escape hatch：footer 说「跟 agent-api.md 不一致以 agent-api.md 为准」——schema 是契约，SOP 是 SOP，避免 dual-source-of-truth 漂移；(6) 中文 v0.2 一版 (T4.5 决策)，i18n 推 v0.6+。**Open for M4 后续**: T4.2 SOP 装到 GA memory/ 需 M3 Settings 按钮 (M3 T3.4)；T4.3 dogfood 1-2 周 calendar gate；T4.4/T4.5 iterate + publish 选位 (sophub vs only repo)——dogfood 反馈驱动。**Next pickup options**: (a) M3 sub-plan + 部分 impl (T3.0+T3.1 discovery file + T3.2 Settings tab + T3.5 docs link)，T3.3 PATH install + T3.4 SOP install 可同 session 或后续；(b) M5 Claude Skill 包写作——SOP 已 ready 可 reference；(c) M7 GUI supervisor 行动日志 (PRD §6.1 #4) ——Origin 字段已经在 SQLite 落地 (B2 migration 006/007 + B4 M1 socket origin path)，UI 渲染是 frontend 任务。**Recommended**: M3 (a)——按 playbook M3 → M4 dogfood → M5 顺序，M3 install button 不 ship dogfood 就没法跑；M5 在 M4 dogfood 出 SOP 稳定版后 freeze 内容更稳。

- **N11 (2026-05-20 PM, M1 COMPLETE · M1.4 closeout shipped)** — `f461ba0` ship: 2 files +657 LOC (docs/agent-api.md +296 / cli/tests/m1_writes.rs new 352 LOC)。**核心实现**：(a) agent-api.md §5.8-§5.18 11 段 schema 沿 §5.5a/§5.5b template（bash example + args table + response shape + error codes + Origin behavior）；按 PRD §11.1 noun order 排（session 6 + project 3 + llm 2）；§5.7 health 没动避 conflict；(b) §1 stability bullet 显式列 stable error discriminant set 含 runner_error；§3 exit code 5 row 加；§6 socket envelope 列 runner_error；§8 planned 整段重写 — 删 session create/archive/btw/project/llm (M1 都 ship)，加 v0.6+ items (session kill / project archive reversible / session watch --from / llm warmup)；status banner 从 "B2 in-progress" 升 "B4 M1 in-progress"；(c) **cli/tests/m1_writes.rs 17 tests** 单文件 cross-noun 组织（mirror cli_test.rs style + run_galley_isolated helper namespacing TMPDIR）：8 session.* 全部走 "no Core → exit 4" 廉价路径（含 session new 完整 flag 套接 / session move with-without --to）+ 5 project.* （exit-4 for create/delete + project list 3 个 SQLite 直读：happy ndjson sort / empty db empty stdout / missing db exit 4）+ 4 llm.* (happy NDJSON cache / empty cache exit 0 / corrupt cache exit 2 invalid_args / llm set no Core exit 4)。**Tests**: 157/157 (140 + 17 新)。**Decisions during impl**: (1) **完整 socket happy-path 不在 integration test**——需要 in-process server with Tauri AppHandle，重构成本 vs marginal value 不值；trait method behavior 已被 core/tests/db_writes_test.rs 覆盖（含 O1 tx_drop_rolls_back 三 test）；integration layer 的 job 是 CLI surface 通到 socket + exit code 正确，不是 socket handler 本身的逻辑；(2) 单 m1_writes.rs 而非 sub-plan 提的 3 文件 (m1_session_writes/m1_project_writes/m1_llm_commands.rs)——3 文件需要 tests/common/mod.rs 共享 helper，单文件直 paste 50 行 setup 更直接、test 数量当前没超 single-file overflow 阈值；(3) seed_pref 第一版 forget `updated_at` NOT NULL constraint，run-then-fix 1 次发现 + 1 行加 binding 修；(4) section numbering §5.8-§5.18 而非 sub-plan §5.7-§5.17（5.7 是既有 health）；(5) §8 planned 加 `llm warmup` 是 N7 提的 cache stale 问题的正式 escape hatch (M1 sub-plan §1.6 acknowledge "open Galley GUI once to warmup" 限制)。**M1 整体 metrics**: 4 commits 跨同一 day calendar (2026-05-20)，sub-plan estimate 1-2 weeks could slip to 3-4。所有 PRD §11.1 write commands reachable from CLI；agent-api.md schema v1 完整。**Next pickup options**: (a) M2 sub-plan + tray spike scaffold + 实跑 — gate-blocking M2，需要 macOS + Windows 机访问；(b) B4 dogfood window 启动 (1-2 day per sub-plan §6) — JC daily-drive 11 new write commands 暴露 surface bug 跟 schema 漂移；(c) JC 体感 driven 其它任务。**Recommended**: 走 dogfood (b) — M1 surface 大、需要实跑暴露，dogfood 跟 tray spike 完全独立可并行（spike 需要 Windows 机时间窗，dogfood 在本机即可）。

- **N10 (2026-05-20 PM, M1.3 project + llm commit shipped)** — `8f1f4b0` ship: 4 files +620 LOC (cli/main.rs +196 / core/socket_listener.rs +333 / gui/App.tsx +44 / gui/sessions.ts +50)。**核心实现**：(a) 3 socket dispatch handler 按 sub-plan §3 T1.7-T1.9 spec 落地——`project.create` mint id server-side（`proj_<16-hex>` 跟 GUI 一致，splitmix-stirred ns ts），调 `create_project(input, origin)` + emit `project-created-external`；`project.delete` **snapshots child sessions 通过 list_sessions filter BEFORE 真删** → 拿到 `detached_session_ids: Vec<String>` 顺便给 response + Tauri payload 双用（agent 知道副作用 / GUI 知道哪些行被 detach）+ emit `project-deleted-external`；`llm.set` **复用 M1.2 `resolve_llm_name` helper** 实现 case-insensitive display-name → index 解析（两 surface session.new --llm + llm set 共享一致诊断行为）→ `set_session_llm` 写 DB → best-effort `manager.send_command(IpcCommand::SetLlm{llm_index})` → ProcessGone fall to `persisted_only` / live runner success = `dispatched` / 其它 Err = exit 5 runner_error → emit `session-updated-external` (M1.2 sub-plan 早已 reserve 这条 channel)。(b) 5 个 CLI subcommand：`Project::{Create,List,Delete}` + `Llm::{List,Set}` 顶级 enum；**List 路径 bypass socket**（`project list` 直 SqliteGalley.list_projects + emit_json；`llm list` 直读 `get_pref_json("llm_list")` shape 校验 → Array 才 emit，非 Array 报 InvalidArgs 让 schema drift 显眼）；write 路径走 `unary_command` helper。(c) GUI 侧 3 个 sessionsStore action：`applyExternalSessionUpdated` 扩 patch `selectedLlmIndex` + `selectedLlmDisplayName`（让 llm.set 同 channel 改 Composer pill）；`applyExternalProjectCreated` race-guarded prepend（mirror session counterpart）；`applyExternalProjectDeleted` mirror FK SET NULL：drop project row + null sessions.projectId + clear activeProjectFilter。(d) App.tsx：一个 effect 块扩 existing session listener subscribe `session-updated-external`；新加 effect 订阅 `project-created-external` + `project-deleted-external` 两 event（前者 payload `{project, via}`、后者 `{projectId, detachedSessions, detachedSessionIds}`）。**Tests**: 140/140 cargo + typecheck + lint clean；integration test 留 M1.4。**Decisions during impl**: (1) `project.delete` 用 list-then-delete 拿 detached ids（two-query race vs concurrent GUI write 几 ms 窗口可接受——count meant for human-readable feedback 不是 audit 真相源）；(2) project create CLI surface 用 `--root-path` / `--icon` / `--color` 真字段而非 sub-plan stub 提的 `--description`（trait 没 description 字段，对齐 GUI createProject 真接的字段更诚实）；(3) llm.set 用 `SessionExternalPayload` （复用 M1.2 struct）走 `session-updated-external` channel 而非新加 dedicated event——shape 同（SessionBrief + via），减一份 payload struct；(4) `mint_project_id` 用 hex 而非 base36（跟 GUI uuid-replace pattern 一致；base36 是 session id pattern）；(5) `llm list` 空 cache 返 empty stdout exit 0 而非 invalid_args——sub-plan §1.6「acceptable degradation」决策落实。**Open for M1.4**: agent-api §5.7-§5.17 11 段 schema (sub-plan T1.11) + 15-22 integration tests (sub-plan T1.12) + M1 闭幕 dogfood。

- **N9 (2026-05-20 PM, M1.2 session-write commit shipped)** — `3cfb8de` ship: 4 files +1044 (cli/main.rs +256 / core/socket_listener.rs +662 / gui/App.tsx +57 / gui/sessions.ts +69)。**核心实现**：(a) 6 socket dispatch handler 按 sub-plan §3 T1.2-T1.6 spec 1:1 落地——`session.new` 走 `begin_tx` + `create_session_in_tx` + `send_message_in_tx` + `tx.commit()`（任一 SQL fail 自动 rollback 无 partial state，O1 兑现），`session.btw` 验证 session 存在后 `IpcCommand::UserMessage{text: "/btw ..."}` 直送 runner（runner 端 `/btw` 前缀自动旁路，不进 messages 表，v0.1 transient 保持），`session.stop` 先 `agent_running()` check false → `already_stopped` idempotent / true → `IpcCommand::Abort`（ProcessGone race 也归 already_stopped），`session.archive`/`restore`/`move` 是 GalleyApi trait thin wrapper；(b) 4 个新 Tauri event emit: `session-{created,archived,unarchived,moved}-external`，payload shape `{session: SessionBrief, via: <command-name>}` 跟 `user-message-persisted` 同模板；(c) `resolve_llm_name()` helper 把 `--llm=<display-name>` case-insensitive 解析到 cached `llm_list` pref（GUI warmup 写的同 key）；空 cache → invalid_args「open Galley GUI once to warmup」；(d) `mint_session_id()` 在 socket handler 内完成（trait `create_session_in_tx` 接 caller-supplied id），格式 `s-<base36-ts>-<base36-rand>` 跟 GUI 一致；(e) `SocketResponseLite` 内部 error carrier 让 `resolve_llm_name` 不背 request_id；(f) `unary_command(req)` CLI helper 抽出 socket round-trip 共享逻辑，6 个新 CLI 子命令各 ~20 LOC；(g) sessionsStore 加 `applyExternalSessionCreated` (race-guarded prepend) + `applyExternalSessionUpdated` (durable field patch + archive-clears-active mirror)；App.tsx 一个 effect 块订阅 4 event 用 closure helper `subscribe(event, handler)`。**Tests**: 140/140 既有 cargo test 全过 + typecheck/lint clean；integration test 推 M1.4 (sub-plan T1.12)。**Decisions during impl**: (1) `session.btw` 的 supervisor/reason 字段加 `#[allow(dead_code)]` + 注释，CLI surface 对称 + M7 audit log hook 预留；(2) `session.stop` ProcessGone race（agent_running 返 true 后 process 立死）也归 already_stopped，因为 observable end state 一样；(3) 4 个 external event 用同一个 `SessionExternalPayload` struct 复用，via 字段做 discriminant；(4) GUI 侧两个 store action（创建 / 更新）而非 4 个 per event handler——同结构 patch；(5) `session.new` 没 spawn bridge（沿用 session.send policy），CLI 创建后 user 在 GUI 激活会 warmup。**Open for M1.3**: project + llm 写命令 (T1.7-T1.9 in sub-plan §3) — project create/list/delete (O2 rename from archive) + llm list (SQLite cache 直读)/set。Estimated commit ~500-700 LOC mirror M1.2 pattern。

- **N8 (2026-05-20 PM, session-end handoff)** — This session pushed B4 paperwork through to M1.1 prereq ship. Commits in dependency order: `27af37c` (M1 sub-plan ship 661 行) → `81d27d5` (6 O resolved → sub-plan 793 行 + PRD §11.1 rename) → `dd4f6cf` (M1.1 prereq impl Rust：6 files +506/-143) → `78e5848` (doc sync)。**Next session pickup options**: (a) M1.2 session-write impl — 6 socket handler (new/btw/stop/archive/restore/move) + 6 CLI subcommand + 4 GUI ipc-handlers listener；预估 500-700 LOC，是 M1 最大块，tx wrap 实战验证 O1 决策；(b) tray spike 跑 — gate-blocking M2，需要 macOS + Windows 机访问；(c) B3 dogfood 继续 — JC 体感 driven。**Recommended pickup**: M1.2 fresh session。M1.1 已是完整 atomic deliverable (140/140 cargo test pass)，clean break。M1.2 跟 tray spike 仍完全独立，可并行。M1.2 启动先 read M1 sub-plan §3 T1.2-T1.6 详细 spec + N7 running note。

- **N7 (2026-05-20 PM, M1.1 prereq commit shipped)** — `dd4f6cf` ship: 6 files +506/-143 (cli/main.rs / core/api.rs / core/db.rs / core/error.rs / core/socket_listener.rs / core/tests/db_writes_test.rs)。**核心实现**：(a) GalleyError::RunnerError variant + Display arm + exit code 5 wired in CLI；(b) socket helpers `origin_from_args` + `map_galley_err` 提取到 socket_listener.rs，dispatch_session_send body 简化 (drive-by fix: DbUnavailable 之前被错误折叠到 "internal" exit 1，现在正确报 "db_unavailable" exit 4)；(c) **tx-aware trait variants ship**：`create_session_in_tx` + `send_message_in_tx` + `begin_tx` 加进 GalleyApi trait，SqliteGalley impl 通过 `insert_session_row_inner` + `insert_user_message_inner` 共享 helper (单源 SQL + validation logic)；(d) `get_pref_json` 加进 trait (M1.3 `llm list` 走 SQLite prefs cache 用)；(e) 6 new tests in db_writes_test (3 tx scenarios: commit / drop-rollback / second-call-fail-rollback；3 get_pref scenarios: missing key / round-trip / corrupt value)。**Tests**: 140/140 pass (was 134, +6 new)。**Decisions during impl**：(1) trait method `get_pref<T>` 改 `get_pref_json -> Value` 避开 async_trait generic 麻烦，CLI 端 from_value::<T> typed shape；(2) helpers take `&mut SqliteConnection` (PoolConnection / Transaction 都 deref 到这个)；(3) 既有 owned-pool 方法保留 byte-identical signature (GUI Tauri command path 零 breaking)。**Pre-existing clippy lints noted not fixed** (CI 不跑 clippy)：origin.rs doc list overindent (rust 1.94 new lint) + db_test.rs too_many_arguments (test fixture)。**Open for M1.2**: session.new socket handler 实现 (tx wrap + clap subcommand) 是下一步最大块；session move 是 O3 新加；GUI ipc-handlers 加 5 new listener (session-archived-external / session-unarchived-external / session-moved-external / project-created-external / project-deleted-external)。

- **N6 (2026-05-20 PM, dogfood watch item · session kill v0.6+)** — O6 resolved「v0.2 不加 `session kill`」附带条件：B4 dogfood + v0.2 ship 后 dogfood 1 周期间，**主动观察 bridge wedge 报告**（Python hang / OOM / IPC deadlock 类）。如出现 1+ 用户/agent 报「bridge 不响应只能 Cmd-Q」→ v0.6+ ship `session kill` (Shutdown surface)。M2 menubar daemon mode 让 Cmd-Q 成本变高（关窗 ≠ 退出），wedge case 应更显眼。watch period: v0.2 ship → v0.6 plan kickoff (1-2 weeks)。

- **N5 (2026-05-20 PM, M1 sub-plan 6 O resolved by JC)** — Same session as N4。JC review M1 sub-plan 6 open decisions:
  - **O1** `session new` atomicity: Sub-plan 原 lean (exit 0 partial success) → **resolved 第三方案 SQLite transaction wrap + exit 5 runner_error**。R1 closed。+30 LOC handler + 2 trait method (`*_in_tx` variants) + helper refactor。详 sub-plan §1.9 + T1.2。**Reject #13** added。
  - **O2** `project archive` 命名: Sub-plan 原 lean (保 archive + SOP 教) → **resolved 第三方案 rename CLI 到 `project delete` + PRD §11.1 同步改 + v0.6+ 真 archive 落地 ship 新命令 reversible**。R7 closed。**Reject #12** added。
  - **O3** `project move` vs `session move`: Sub-plan 原 lean (保 PRD literal) → **resolved 改 `session move <id> --to=<pid>` + PRD §11.1 同步改**（PRD §11.2 #5 自家 grammar rule 「noun=verb subject」对齐）。R6 closed。**Reject #11** added。M1 sub-task 重排：原 T1.6 (project 4-cmd) 拆成 T1.6 (session move new) + T1.7 (project 3-cmd)，downstream T 编号 shift。
  - **O4** SOP 演示 confirm: confirm 原 lean **punt to M4 sub-plan**。`delete_project` 返 `detachedSessions: count` payload 让 agent 可决定 pre-confirm。
  - **O5** btw origin push event: confirm 原 lean **M1 socket handler 留 `// TODO(M7)` hook**，零代码成本，M7 sub-plan 决定 payload shape。
  - **O6** `session kill` Shutdown surface: confirm 原 lean **v0.2 不加** + 新加 N6 dogfood watch item。
  - **Net impact**: M1 仍 4-commit shape (M1.1-M1.4)；M1.1 prereq scope ↑ (含 PRD §11.1 rename + tx-aware trait methods)；M1.2 session-write 现 6 cmd (含新加 session move)；M1.3 project 现 3 cmd (lose move per O3, archive→delete per O2)。Sub-plan 661→793 行（净 +132 行 含 §1.9 transaction wrap design + §9 resolution + Reject #11/#12/#13 + R1/R6/R7 close 标注 + T1.1 prereq scope 扩展）。

- **N4 (2026-05-20, M1 sub-plan ship · paperwork-only)** — Followed N3 handoff option (c). JC explicit「写 B4 M1 sub-plan」 → ship [B4-M1-sub-plan.md](./B4-M1-sub-plan.md) 661 行 mirror B3-M6 sub-plan structure. **Scope re-assessment** 钉了 8 个跟 playbook stub claim 不一致或需澄清的项：(1) 「7 commands」实际 11 subcommands (playbook 把 noun group 算 1，按 subcommand 拆 = 5 session-write + 4 project + 2 llm = 11)；(2) `create_session_with_first_message` trait method **不加**，socket handler 组合 create_session + send_message 两步 (Reject #2 trade-off：1ms race window 不换 trait + test 复杂度)；(3) `session btw` **不持久化** v0.1 决策保持 + runner 端 `/btw` 前缀已自动旁路；(4) `session stop` **映射到 Abort 不 Shutdown** (bridge 留活下次能 send，跟 GUI 顶栏停止按钮对齐)；(5) `project move` 语义歧义钉「移动 session」CLI surface `project move <sid> [--to=<pid>]`；(6) `project archive` v0.2 = `delete_project` (FK CASCADE SET NULL 保 sessions)，**不**加 archived 字段 scope creep；(7) `llm list` **走 SQLite prefs cache** 不走 socket (秒级响应 vs 5-10s warmup spawn；空 cache = empty NDJSON exit 0 acceptable degradation)；(8) **exit code 5=runner_error 引入** (PRD §11.2 已说，agent-api.md 表漏 row，M1.1 prereq commit 补) + GalleyError::RunnerError variant。**Commit shape decision**: 4-commit = M1.1 prereq (GalleyError + helpers) → M1.2 session-write (5 subcmd + listener) → M1.3 project + llm (6 subcmd + listener) → M1.4 agent-api + tests (200-400 LOC/commit，可独立 cargo check + revert)。**6 open decisions** 留 JC review: (O1) `session new` send_message fail = exit 0 partial vs exit 5？倾向前者；(O2) `project archive` CLI 阻拦 vs SOP 教？倾向 SOP；(O3) `project move` 命名 PRD literal vs subject-correct？倾向保留 PRD；(O4) M4 SOP 演示 archive confirm？倾向显式；(O5) btw origin 通过 Tauri event push 给 M7？倾向 push，M1 不实现；(O6) `session kill` Shutdown surface v0.2 加？倾向不加。**Next pickup options 不变** (per N3): tray spike + B3 dogfood + M1 实施 三轨并行 OK。M1 实施 fresh session 推；preferred 顺序是 M1.1 prereq → M1.2-M1.4 同 session 跑通 + dogfood。

- **N3 (2026-05-20, session-end handoff)** — This session pushed B3 from M5-shipped to B3 ✅ tag `b3-complete`, then B4 paperwork to "playbook ready + tray spike spec ready". Five commits in dependency order: `24f3f04` (M6 sub-plan) → `74b9539` (M6 impl: prefsStore + useAppStore retire) → `640d6f7` (B3 complete devlog + tag b3-complete) → `3efbb4d` (B4 playbook upgrade) → `7971f0f` (B4 tray-mode spike spec). **Next session pickup options**: (a) Tray spike scaffold + run (4-6h, needs JC mac for macOS T1-T2/T5-T6/T9/T11/T13-T14/T17-T19 + Windows machine access for T3-T4/T7-T8/T10/T12/T15-T16) — gate-blocking for B4 M2 start; (b) B3 dogfood continued — JC daily-drives Galley for some more days surfacing latent regressions before B4 starts moving authoritative-state code again; (c) B4 M1 sub-plan (paperwork) — can start in parallel with (a)/(b) since M1 CLI commands don't depend on tray, sub-plan writing is no-risk paperwork. **Recommended pickup**: tray spike scaffold + run as soon as Windows machine is available, since it's the strict gate. If Windows access blocked >1 day → fall back to (c) M1 sub-plan in same session, run Mac-only spike segments, document the gap.

- **N2 (2026-05-20, Tray spike spec ship — paperwork-only)** — JC explicit「在这个 session 继续推进」推到 tray spike spec 写作（不跑 spike 本身，spike 需要真 Tauri 实验 + 跨平台机器访问）。[core/experiments/tray-mode/README.md](../../../core/experiments/tray-mode/README.md) 391 行 mirror bridge-owner README 结构：Status/Purpose/Gate-for/Related header + Why we need this + Non-goals + Architecture (under test) + 20-item checklist (T1-T20 across 6 capability sections: tray registration / hide-window / show / quit / WebView keep-alive / App Nap defeat / cross-platform parity) + Implementation outline (Cargo build config + pseudo-code for main.rs / app_nap.rs / index.html / tests.sh) + GO/NO-GO decision with 3 fallback strategies (Mac-only v0.2 if Win T3-T16 fail / NO-GO if T14 WebView pause / investigate if T18 App Nap) + Findings (empty) + Cleanup section + Cursor notes。**关键 design call**: T14 + T16 「WebView keep-alive while hidden」是 spike 的 critical PASS gate —— Tauri 默认是否 pause WebView 没有 documented guarantee，FAIL 触发 B4 M2 re-design（背景模式整段重新设计）。**App Nap defeat 路径选定**: `NSProcessInfo.beginActivity` 通过 `objc2-foundation` crate，比 `cocoa` crate 新 + safer + 已有 macOS-only cfg gate 模式（runtime 代码里已有 `window-shadows-v2` 类似 cfg 模式）。**Spike 跑 estimate**: 1 day (4-6h) optimistic per bridge-owner prototype precedent；risk: Windows 机访问 (JC 借) 可能延 1 day；contingency 是 ship spike report with Mac-only findings + 推 Mac-only v0.2 fallback。Cursor: B4 prereq gate / spike 等运行。

---

## Open decisions（B4 启动前要拍）

- [ ] **O1** menubar 图标：静态图标 + 数字 badge 还是 dynamic state icon？倾向静态 + badge（[stub decision](./B4-cli-bg-artifact.md) 沿用）
- [ ] **O2** CLI 在 Windows 上的 "Install to PATH" 具体写法（用户级 PATH vs admin），M3 sub-plan 时拍
- [ ] **O3** Discovery file 路径在 macOS：`~/.config/galley/`（XDG）vs `~/Library/Application Support/app.galley/`（Apple convention）。**倾向前者**（跨 OS 一致 + supervisor SOP 不用分支）
- [ ] **O4** Supervisor 行动日志 GUI 渲染密度：每动作一行 / 合并相邻 / hover 详情？**倾向 MVP 每动作一行 + hover 折叠 path**（M7 sub-plan 时复核）
- [ ] **O5** v0.2 ship 时 README 改写：现仍是 v0.1 「本地桌面工作台」framing，v0.2 改 dual-native 措辞。M9 实施
- [ ] **O6** Homebrew tap：v0.2 包不包？**倾向不包**（留 v0.6+）。CLI 默认走 bundled binary + manual symlink path
- [ ] **O7 NEW** Tray spike 何时跑：prereq 阶段（推荐，spike fail 早撤退）vs M2 开头（spike 跟 implementation 同 session 容易拖）。**倾向 prereq 阶段**
- [ ] **O8 NEW** M3 "Install to PATH" 失败 fallback：silent fallback 提示用户手动跑 / 严格 hard error？**倾向 toast 提示手动命令**（不让 sudo failure 阻塞 Galley 启动）
- [ ] **O9 NEW** Tauri tray API 在 macOS 26 (Tahoe) 行为：JC mac 是 macOS 14，CI runner macos-15 也不是 macOS 26。**等 v0.2 ship 后**有人在 macOS 26 上跑发现问题再处理

---

## Migration pattern · 给 future phase 用的迁移模板（B4 阶段视角）

B1/B2/B3 各自的 migration pattern 见对应 playbook 段（[B1](./B1-rust-core.md#migration-pattern--给-b2b3-用的迁移模板) / [B2](./B2-bridge-ownership.md#migration-pattern--给-b3-用的迁移模板write-path-增量) / [B3](./B3-store-slice.md#migration-pattern--给-b4-用的迁移模板slice-视角)）。B4 落地的「新 CLI 命令」pattern：

```
新 CLI write command 7 步：

1. Rust 端 GalleyApi trait + 实现（如已有 trait method 复用）
2. CLI binary subcommand + arg parsing + exit code 分类
3. socket route（runner_manager 接收 socket 调度到 trait）
4. Tauri command（GUI 复用同一 trait — B4-I4 enforce）
5. agent-api.md schema 段（M6 freeze 前都允许 inline 写）
6. Integration test（happy + error path）
7. 旧路径删除（若 GUI 用过 direct SQL 或 direct invoke 别的路径）
```

「supervisor 行动日志」pattern：

```
1. CLI 写命令时填 origin 三元组 (via, supervisor, reason)
2. 写命令 trait method 内 SQLite persist 该三元组到 messages.created_via / supervisor / origin_note 字段
3. Rust 端 emit supervisor-action event with origin payload
4. GUI listen → messagesStore.appendSupervisorAction action
5. Conversation 组件渲染 SupervisorActionBubble
6. dogfood 验证显示密度合理
```

---

## v0.2 ship 完成后

- README 改写定稿
- DESIGN.md onboarding subtitle 改新 framing
- 投 Galley Supervisor SOP 到 fudankw.cn/sophub（如果 sophub 接受）
- GitHub Release notes 强调 dual-native 转折 + migration 兼容性
- Twitter / 社区公告（如 JC 想做）
- 收集第一批 v0.2 用户反馈 → 排 v0.6+ 优先级

---

## 已知风险

继承 stub 5 个 + B3 经验补充：

- **风险 1: Tauri v2 tray plugin Mac / Win 兼容性** — Spike 1 day 验证 (prereq G2)
- **风险 2: App Nap (macOS)** — `NSProcessInfo.beginActivity` 或 Rust crate 缓解 (M2 T2.4)
- **风险 3: SOP 安装路径冲突** — 检测同名 → 弹「保留 / 覆盖 / 取消」(B4-I5)
- **风险 4: Migration 数据丢失** — B4-I6 备份强制 (M8 T8.5)
- **风险 5: GA SOP 在 IM frontend 里 dogfood 不顺** — M4 在自己微信 / 飞书上跑 1-2 周 iterate
- **风险 6 (B3 经验补充)**: Schema freeze 反悔成本高 — M6 sub-plan 时强制 full schema review (G6)
- **风险 7 (B3 经验补充)**: dogfood gate event-driven 在 milestone 内有效，但 v0.2 phase ship 必须 hold 1-week 严格 dogfood (G9)

---

## End of B4
