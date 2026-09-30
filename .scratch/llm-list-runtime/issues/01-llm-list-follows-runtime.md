# 01 `galley llm list` 按运行时取数（内置模式不再返回外置 GA 的旧缓存）

Status: done
Date: 2026-09-30
裁决：JC 选方案 A（2026-09-30），当缺陷修复处理：输出字段不变，内置模式下列表内容变为 Galley 模型库

## 问题

JC 在 Discord 问 bot「你现在用的是哪个模型？」，bot 答 glm-5.3-flash；模型调用日志每轮都是 `model=gpt-6.1-sol`（= Galley 默认模型）。

链路：内置运行时提示词按 state-block 准入规则**不写模型名**（会话内可切换，`core/src/managed_prompt.rs:144-147`），
让模型「通过 Galley CLI 查」（`:177-179`）→ supervisor 跑 `galley llm list` → CLI 读 `llm_list` pref（`cli/src/llm.rs:14-33`）→
这个 pref **只由外置 GA 的 bridge 写入**（`gui/src/stores/runtime/llm-slice.ts:281-287` 与 warmup 路径），内置模型从不进去。
JC 机器上它停在 09-23 07:55 的外置会话（`gpt-6-astra`、`glm-5.3-flash` 标 current），一分钟后 `active_runtime_kind` 切到 managed。

同一缺口还让 Supervisor SOP 的「Switch Model」（`llm list` → `llm set`）在内置模式下失效：`llm set` 对内置会话匹配的是
Galley 模型库（`core/src/socket_listener/llm_cmds.rs` `resolve_managed_llm_name`），而 `llm list` 列不出它们。

## 规格

`galley llm list [--runtime current|managed|external]`，默认 `current`（照 `sessions list --runtime` 的先例，
`cli/src/common.rs` `runtime_filter` 用 `galley.active_runtime_kind()` 解析 current）。`--runtime all` 以 `invalid_args`（exit 2）拒绝，
报错文案照 `runtime_arg_for_session_new` 的写法（「--runtime all is only valid for list commands」这句不适用，写清 llm list 只接受单一运行时）。

- **external**：行为与现在逐字节一致（读 `llm_list` pref；缓存空 → 空输出 exit 0；形状不对 → exit 2）。
- **managed**：直接读 Galley 模型库（`SqliteGalley::list_managed_models()`，CLI 本来就直开 SQLite，不走 socket），
  **与 `resolve_managed_llm_name` 完全同口径**，保证 list 出来的名字 `llm set` 一定认：
  - 跳过 `credential_status == Missing` 的模型；`index` 只在可用模型里递增（从 0 起）。
  - `name` = `displayName` = `managed_model_display_name(display_name, model)`（空显示名回退模型 id）；`key` = 模型记录 id。
  - `isCurrent` = `index == 0`：即不指定模型启动的内置运行时实际用的那个（IM 渠道 `prepare_managed_runtime_context(app, None)`、
    新会话默认），也就是 Galley 默认模型（「设为默认」会把它排到第一，`core/src/db/managed_model.rs:293-295`、`:448-463`；
    默认模型缺凭证时退到下一个可用的，与运行时一致）。
  - 输出形状与外置缓存条目一致：`{"index","name","key","displayName","isCurrent"}`，NDJSON 一行一条；模型库为空 → 空输出 exit 0。
  - 为了不复制判定逻辑，优先把 `resolve_managed_llm_name` 里的「可用模型 + 显示名 + index」枚举抽成 core 里一个可复用的函数，
    CLI 和 `llm set` 共用；如果跨 crate 可见性不允许，至少在两处互相引用注释。

## 文档（Agent API 是公共契约，Rule 3）

- `cli/src/args.rs` `LlmCmd::List` 的 help 文本：说明按运行时取数、managed 读模型库、external 读 GUI 缓存、`isCurrent` 两种含义。
- `docs/agent-api/project-and-llm-commands.md` §5.17：同上，加 managed 示例；写明这是 v2 内的**行为修复**（字段不变，
  内置模式下内容从「外置 GA 旧缓存」变为「Galley 模型库」），以及 managed `isCurrent` 的含义与边界：它是「不指定模型时启动用的模型」，
  会话级选择看 `sessions list` 的 `selectedLlmDisplayName`，IM 渠道里 `/llm` 的临时切换 CLI 看不到（渠道内发 `/status` 为准）。
  若 agent-api 有记录契约变更的惯例位置（changelog / 版本说明），照惯例补一条。
- Supervisor SOP「Switch Model」：`docs/integrations/galley-supervisor-sop.md`（canonical）里「If `llm list` is empty, ask the user to open a
  Galley session once so the LLM cache can warm up」只对外置成立，改写成按运行时的说法。**SOP 有多份副本**
  （`.claude/skills/galley-supervisor/`、`.agents/skills/galley-supervisor/`、`docs/integrations/galley-supervisor-reference.md` 等），
  以 `node scripts/check-supervisor-sop-drift.mjs` 为准同步，脚本必须绿。
- `core/src/api.rs` 约 514 行那段描述 `llm list` 读缓存的注释同步。

## 约束

- CLI JSON 字段与 exit code 类不变；不动 `schemaVersion`；GUI 零改动（`llm_list` pref 的写入语义不变）。
- 外置运行时零行为变化。
- `core/` 不是 rustfmt-clean：只格式化你动过的文件（`rustfmt --edition 2021 --check <file>` 逐个核），**不要** `cargo fmt --all`。
- 干净 target 上 `cargo check` 会因 tauri build.rs 查 `target/tauri-sidecars` 而失败时，手放占位文件即可（见 build.rs 报错提示）；
  不要并发跑 `prepare-cli-sidecar`。
- 不要 commit / push / `git add`。

## 验证

- `cli/tests/m1_writes.rs` 现有三条 `llm_list_*` 测试默认走 current：测试 DB 的 current 可能解析成 managed，改为显式
  `--runtime external`（或种 `active_runtime_kind` pref），保持它们原本的外置语义；新增：managed 列表（跳过缺凭证、index 连续、
  `isCurrent` 只在 index 0、空显示名回退）、current 跟随 `active_runtime_kind`、`--runtime all` exit 2、managed 列出的名字能被
  `llm set` 解析（如果现有测试设施方便起 socket；否则在 core 单测里断言共用枚举与 `resolve_managed_llm_name` 一致）。
- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace` 全绿。
- `node scripts/check-supervisor-sop-drift.mjs`、`node scripts/check-docs-links.mjs` 绿；`git diff --check` 干净。

## Comments

### 2026-09-30 实现（Opus 5.5 子代理，未提交，改动留在工作树）

**改动**

- core 共用枚举：`core/src/api/model.rs` 新增 `ManagedLlmChoice { index, key, display_name, model }` 与纯函数
  `managed_llm_choices()`（跳过 `Missing` 凭证、`index` 只在可用模型里从 0 递增、空显示名回退模型 id）；
  `managed_model_display_name` 从 `llm_cmds.rs` 移到这里并公开，`core/src/api.rs` 重新导出。
  `core/src/db/managed_model.rs` 加 `SqliteGalley::list_managed_llm_choices()`（= `list_managed_models()` + 枚举）。
- `resolve_managed_llm_name` 改为在这份枚举上按显示名 / 模型 id 大小写不敏感找第一个匹配，语义不变；
  `core/src/socket_listener/mod.rs` 删掉随之无用的 `ManagedModelCredentialStatus` 导入。
- CLI：`LlmCmd::List { runtime }`，`--runtime current|managed|external`，默认 `current`（经 `runtime_filter`，
  即 `active_runtime_kind()`）。`all` 在开库前以 `invalid_args` 拒绝（exit 2），文案
  `llm list: --runtime all is not accepted; each runtime has its own model list, pick current, managed, or external`。
  managed 分支输出 `{"index","name","key","displayName","isCurrent"}`，`isCurrent = index == 0`；
  external 分支是原函数体原样搬进 `llm_list_external`（空缓存 exit 0、非数组 exit 2、原样打印）。
  `Llm` 与 `LlmCmd::List` 的 help 同步。
- 文档：§5.17 重写（managed / external 两节、示例、`isCurrent` 含义与边界、行为修复说明）；§5.18 交叉引用两种列表；
  agent-api 没有独立 changelog，§7.1（`stability-and-versioning.md`）是记录 v2 内变化的位置，新增「Changes inside `2`」一条；
  SOP「Switch Model」按运行时改写（空列表分 managed / external 两种处理，跨运行时会话用 `--runtime=<runtimeKind>`，
  `isCurrent` 不是会话级选择），reference 表 `llm list` 行同步；4 份技能副本按 canonical 重拷并把 Last synced 改为 2026-09-30；
  `core/src/api.rs` 注释同步。另顺手改了两句被本改动变成错话的文档：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`
  （原「llm list should become runtime-aware」）与 `docs/agent-api/roadmap-and-references.md`（`llm warmup` 只对 external 有意义）。
- 测试：`cli/tests/m1_writes.rs` 三条旧缓存测试改为显式 `--runtime external`；新增 managed 列表（跳过缺凭证、index 连续、
  只有 index 0 为 `isCurrent`、空显示名回退、陈旧外置缓存不串入、键序固定）、默认模型缺凭证时 `isCurrent` 顺延、
  managed 空库 exit 0、`current` 跟随 `active_runtime_kind`（external 时逐字节打印缓存）、`--runtime all` exit 2。
  core 单测 `managed_llm_choices_*` 两条；`core/tests/socket_write_handlers_test.rs` 新增
  `llm_set_resolves_every_managed_llm_list_name`：经真实 socket 分发，把 `list_managed_llm_choices()` 的每个名字（转大写）
  喂给 `llm.set`，断言 `selectedLlmKey` / `selectedLlmIndex` / `selectedLlmDisplayName` 与发给 runner 的 `llm_index` 全部一致，
  且列表跳过的缺凭证模型 `llm.set` 返回 `invalid_args`。

**偏差**

1. 共用枚举放在 `api/model.rs`（纯函数，便于单测）+ `SqliteGalley` 薄方法，没有放在 socket 层：CLI 跨 crate 只能用 pub 项。
2. 外置缓存的真实键序是字母序（`displayName, index, isCurrent, key, name`，本机实测），managed 行按票面顺序输出。
   字段集一致、键序不同；JSON 消费方不受影响，文档里的外置示例按真实字母序改写。
3. `--runtime all` 在开库前就拒绝，DB 不可用时也稳定 exit 2，而不是先开库后因 exit 4 掩盖参数错误。

**验证**（均在仓库根目录）

- `cargo check --manifest-path core/Cargo.toml --workspace`：通过，无 warning（`--all-targets` 也无 warning）。
- `cargo test --manifest-path core/Cargo.toml --workspace`：全绿（galley-cli：8 + 23 + 30；galley-core：lib 308、db_test 18、
  db_writes_test 89、runner_manager_test 14、scheduler_fire_test 2、socket_listener_test 7、socket_write_handlers_test 24；0 failed）。
- `node scripts/check-supervisor-sop-drift.mjs`：4 份副本与 canonical 逐字一致，SKILL.md 两份对齐。
- `node scripts/check-docs-links.mjs`：OK（376 files）。另跑了 `check-ipc-protocol-drift.mjs`、`check-version-consistency.mjs`：通过。
- `git diff --check`：干净。
- rustfmt：改过的 Rust 文件逐个 `rustfmt --edition 2021 --check`，除两处基线就有的旧差异外全部干净——
  `cli/tests/m1_writes.rs:77`（迁移列表那行，基线即如此，未动）与 `core/src/socket_listener/mod.rs` 里 64/138/597/606 行
  （基线即如此；本票只改了第 61 行的 import，且与 rustfmt 输出一致）。
- 本机真实库只读冒烟：`galley llm list` → 7 行 Galley 模型库，`gpt-6.1-sol` 标 `isCurrent`（与问题描述里的调用日志一致）；
  `galley llm list --runtime external` → 仍是 09-23 的外置缓存（`glm-5.3-flash` 标 current），输出与改动前相同。

**请集成方复核**

- 既有缺陷（未修：超出票面，且约束要求外置零变化）：`llm_cmds.rs` 的 `LlmListEntry.name` 带 `#[serde(alias = "displayName")]`，
  而 GUI 写入的外置缓存同时含 `name` 与 `displayName` 两个键，serde 会报 `duplicate field name`——外置会话的
  `llm set` / `session new --llm` 实际会以 `llm_list pref shape mismatch` exit 2。已用独立 serde 探针复现，本机真实缓存正是这种形状；
  现有测试只喂了单 `displayName` 的缓存所以没抓到。建议另开票。
- `session new --llm` 的 help（`cli/src/args.rs`）与 §5.8 仍写「Resolved against the cached llm_list pref」，对 managed 会话已不准
  （core 按目标运行时解析，managed 走模型库）；本票未改。
- 其他调用方：仓库内没有代码调用 `galley llm list`；`llm_list` pref 的读者是 GUI hydrate、CLI external 分支与 core 外置解析器，GUI 写入语义未动。
  依赖「managed 模式下返回外置缓存」的只有 agent 行为本身（即本缺陷）。IM supervisor 的 SOP 参考文件由 `sop_install::sop_body()`
  （`include_str!` canonical）在运行时落盘，重新构建后自动带上新的「Switch Model」。
- canonical SOP 头部的「Target: schemaVersion: 1 / Last reviewed: 2026-09-09」没动（只改了一节，不算整篇复审）。
