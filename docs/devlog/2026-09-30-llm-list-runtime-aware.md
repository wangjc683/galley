# `galley llm list` 按运行时取数：内置模式不再答出外置 GA 的旧模型

日期：2026-09-30
关联：`cli/src/llm.rs`、`core/src/api/model.rs`（`managed_llm_choices`）、
[Agent API §5.17 / §7.1](../agent-api/project-and-llm-commands.md)、
[Supervisor SOP「Switch Model」](../integrations/galley-supervisor-sop.md)、
[Discord 对话体验](./2026-09-30-discord-conversation-ux.md)（同日真机时发现）

## 现象

JC 真机验收 Discord 时问 bot「你现在用的是哪个模型？」，bot 答 `glm-5.3-flash`，还补了一句「这是本地配置显示的名称」。
引擎模型调用日志（`managed-ga-state/temp/model_responses/`）四轮全是 `model=gpt-6.1-sol`——正是 Galley 设的默认模型。
模型选对了，答错的是 bot 自己。

## 诊断链

1. **渠道用的就是默认模型**：IM 进程以 `prepare_managed_runtime_context(app, None)` 起（`im_supervisor/manager.rs:154`），
   不指定模型 → GA 取第一个可用模型；而「设为默认」会把模型排到第一（`db/managed_model.rs` 的 upsert 与 reorder 都维持
   default = sort 0）。改默认模型后要重启渠道才生效（保存模型配置的 toast 带「重启渠道」）。
2. **bot 为什么去查 CLI**：内置运行时提示词按 state-block 准入规则**有意不写模型名**（会话内可切换，写死会过时还答得理直气壮），
   让模型「通过 Galley CLI 查」。规则本身对。
3. **CLI 给错了数据**：`galley llm list` 读 `llm_list` pref，而这个 pref **只由外置 GA 的 bridge 写入**（`llm-slice.ts`
   `shouldCacheLLMListForSession`，注释写明不让两种运行时的列表串）。JC 机器上它停在 09-23 07:55 的外置会话
   （`gpt-6-astra`、`glm-5.3-flash` 标 current）；一分钟后 `active_runtime_kind` 切到 managed，从此内置模式下 `llm list` 永远答外置的旧列表。
4. **不只是一问**：Supervisor SOP 的切换模型流程是 `llm list` → `llm set`，而 `llm set` 对内置会话匹配的是 Galley 模型库——
   内置模式下 `gpt-6.1-sol` 这类模型在 CLI 里根本列不出来。`docs/managed-ga-runtime/runtime-modes-and-sessions.md`
   早就写过「`sessions search` and `llm list` should become runtime-aware before release」，前者后来做了，`llm list` 这半被遗忘。

## 裁决（JC，三选一）

- **采纳 A：修 CLI**。`llm list` 加 `--runtime current|managed|external`（默认 `current`，照 `sessions list` 先例），
  managed 读 Galley 模型库。当作 v2 内的**行为修复**：字段、exit code 类不变，内置模式下内容从「外置旧缓存」变为「模型库」。
- 已否 B（只在 IM 提示词里让用户发 `/status`）：只补了「你是什么模型」一个问法，SOP 切换模型流程照样坏。
- 已否 C（把模型名注入提示词）：违反 state-block 准入规则——频道里 `/llm` 一切换就过时。

## 实施

- core 抽出纯函数 `managed_llm_choices()` + `SqliteGalley::list_managed_llm_choices()`：跳过缺凭证模型、`index` 只在可用模型里
  递增、空显示名回退模型 id。`llm set` / `session new --llm` 的内置解析器和 `llm list --runtime=managed` 共用它，
  列出来的名字一定被 `set` 认——配了跨命令回归测试 `llm_set_resolves_every_managed_llm_list_name`（真实 socket 分发、
  逐个名字 set、核对 key / index / 发给 runner 的 `llm_index`）。
- managed 行形状同外置缓存 `{index, name, key, displayName, isCurrent}`；`isCurrent` = index 0，即不指定模型时启动用的那个
  （默认模型；它缺凭证时顺延，与运行时一致）。边界写进文档：会话级选择看 `selectedLlmDisplayName`，IM 渠道里 `/llm` 的
  进程内切换 CLI 看不到，以渠道内 `/status` 为准。
- `--runtime all` 在开库前以 `invalid_args` 拒绝（数据库不可用时也稳定 exit 2）。external 分支原样搬迁，逐字节不变。
- 契约留痕：Agent API 没有独立 changelog，`stability-and-versioning.md` §7.1 新增「Changes inside `2`」一节，本条是第一条。
  SOP「Switch Model」按运行时改写，4 份技能副本经 drift 脚本同步；`session new --llm` 的 help 与 §5.8 表格同步去掉「按缓存解析」的旧说法。
- 外置运行时零行为变化；GUI 零改动。

## 同批发现：外置 `llm set` 一直是坏的（另立票）

子代理实施时发现、主会话复现确认：`LlmListEntry.name` 带 `#[serde(alias = "displayName")]`，而 GUI 写的缓存每条同时有
`name` 和 `displayName`，serde 报 `duplicate field \`name\``（用 core 锁定的 serde 1.0.228 在 scratch 复现）——外置会话的
`llm set` / `session new --llm` 必然以「llm_list pref shape mismatch」exit 2。现有单测只喂了单个 `displayName` 所以没抓到。
与本票无关、且本票约束外置零变化，立为 `.scratch/llm-list-runtime/issues/02-external-llm-set-duplicate-field.md`（needs-triage）。

## 验证

- `cargo test --workspace`：523 passed，0 failed（含新增 CLI 5 条、core 单测 2 条、socket 端到端 1 条）；`cargo check` 无 warning；
  改过的 Rust 文件逐个 `rustfmt --check`（基线旧差异未动）。
- SOP drift / docs links / IPC drift / version consistency 脚本绿；`git diff --check` 干净。
- 本机真实库只读冒烟（新编译的 debug CLI）：默认 `llm list` → 7 个模型库模型、`gpt-6.1-sol` 标 `isCurrent`；
  `--runtime external` → 仍是 09-23 旧缓存；`--runtime all` → exit 2。
- 生效条件：CLI 随下个版本发布；开发机上 `tauri dev` 用的是 `core/target/debug/galley`，已是新行为。
