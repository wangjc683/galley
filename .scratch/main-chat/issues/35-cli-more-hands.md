# 35 CLI：补齐授权前两级的手

Status: merged（2026-10-16 合入 main，分支提交 `5d802f98`、`24ca243a`，合并提交 `20cf949c`；真机随票 36、37 一起验）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 9 第一问选 B（JC：「一，B」）：界面能做、CLI 做不了、授权（裁决 3）前两级里点到的，都给助理接上。依赖：无；与 34 同改 socket 分发与 CLI，派同一个代理在 34 之后做，或你自己排好避免冲突。不改界面。

## 目标

做完后，界面上能对会话、项目、模型做的事，除了「只能你来」那一级（Key、渠道、浏览器插件、运行环境、更新、重置），助理都能经 CLI 做。

## 要做（Agent API `schemaVersion: 3` 只加不改）

| 命令（名字你定） | 界面现有的做法 | 授权级别（写进票 36 的手册） |
|---|---|---|
| 会话改名 | `rename_session`（`core/src/commands/session.rs:174`） | 自己做（它派的）；你开的会话先问 |
| 会话置顶 / 取消 | `set_session_pinned`（`:197`） | 自己做 |
| 会话永久删除 | `delete_session`（`:235`） | 先问 |
| 项目改名、改图标与颜色 | `update_project`（`core/src/commands/project.rs:28`） | 自己做 |
| 项目置顶 / 取消 | 查界面怎么做的（项目行菜单「置顶」） | 自己做 |
| 项目整体归档 | 项目菜单「归档全部对话」，查界面怎么做的 | 自己做 |
| 改默认模型 | 设置 → 模型「设为默认（移到顶部）」 | 先问 |

- 每条复用界面那条路背后的 Core 函数，不另写一套业务逻辑（宪法 Rule 5）；界面那条若只在前端拼几步（比如逐个归档），挪进 Core 一个函数，界面改调它（行为不变）。
- 写命令都带 `--supervisor` / `--reason`，记来源，照现有写命令。
- 主对话本身：改名、置顶、删除、归档都不允许（它不是普通会话，主对话 PRD 裁决 14、59），报错、错误标识进稳定集合。
- 删除前不检查「先问过没有」：授权靠手册约束模型（票 36），Core 不硬拦。
- 外置运行时：会话与项目的命令照常可用（它们本来就跨运行时，照 `session archive` 的现有规矩）；改默认模型只认当前运行时的模型列表，外置下的行为照 `llm set` 的现有规矩，写清楚。
- 改默认模型：先查清「默认」在托管与外置下分别是什么（托管是模型列表的第一个？），CLI 用同一个语义。

## 文档

- `docs/agent-api/session-commands.md`、`project-and-llm-commands.md` 各加条目（参数、输出、错误、例子），稳定标识集合跟着加。

## 验收

- CLI 集成测试：每条成功与失败；主对话被拒；改默认模型后 `llm list` 的默认跟着变、界面那边读到同样的结果（Core 层测试）。
- `cargo test --manifest-path core/Cargo.toml --workspace`、六个门禁脚本、`git diff --check`、中文标点扫新增行。

## Comments

### 2026-10-16 实现回报（子代理，分支 `mc-cli-hands`）

**命令**（`schemaVersion: 3` 内只加不改；socket 在 `1`、`2`、`3` 下都答；写命令都收 `--supervisor` / `--reason`）

| CLI | socket | 输出 | 背后的 Core 函数（与界面同一个） |
|---|---|---|---|
| `session rename <id> "<title>"` | `session.rename` | `{"session": …}` | `Writes::rename_session`（`User` 来源，自动标题不再改它；空标题交还给 Galley） |
| `session pin <id>` / `session unpin <id>` | `session.pin` / `session.unpin` | `{"session": …}` | `Writes::set_session_pinned`（已归档的照旧拒） |
| `session delete <id>` | `session.delete` | `{"deleted": true, "sessionId": …}` | 先关 runner（尽力），再 `Writes::delete_session` |
| `project update <id> [--name] [--icon] [--color]` | `project.update` | `{"project": …}` | `Writes::update_project` |
| `project pin <id>` / `project unpin <id>` | `project.pin` / `project.unpin` | `{"project": …}` | `Writes::update_project`（`pinned`） |
| `project archive-sessions <id>` | `project.archive_sessions` | `{"projectId", "archivedSessions", "archivedSessionIds"}` | 新的 `Writes::archive_project_sessions`（挑选规则加同一个批量归档） |
| `llm set-default <name>` | `llm.set_default` | `{"llm": <llm list 的第 0 行>, "changed": bool}` | 新的 `SqliteGalley::set_default_managed_model`（界面「设为默认」那次保存的同一个 upsert），再 `managed_model_config::sync_for_app` |

**票面留给我定的**

1. **「默认模型」是什么**：托管下是模型库排序第一、`is_default` 的那条，`llm list --runtime=managed` 的第 0 行、`isCurrent: true`（没凭证的不进列表，第 0 行是第一个能用的）；不在会话上另存。改它等于界面「设为默认（移到顶部）」：界面是把这条模型原样存一次、带 `makeDefault`，这里走同一个 upsert（字段与各层原样保留），已在最上面就不写（界面也提前返回），返回 `changed: false`。名字用 `llm set` 的同一个解析器（显示名或模型 id，不分大小写）。外置下 Galley 没有能改的默认：外置 GA 的默认是它自己配置里的第一个，Rule 1 不许写；所以命令只认当前运行时，外置一律拒（`managed_runtime_only:`），单个会话照旧用 `llm set`，与它现有的外置规矩一样。
2. **项目整体归档**：叫 `project archive-sessions`，不叫 `project archive`，因为 Agent API §8 把 `project archive` 留给「项目本身的可逆归档」，两者语义不同。范围就是项目菜单「归档全部对话」归档的那些、即该项目侧栏组列出的：当前运行时、没归档、没置顶（置顶的在「置顶」区，不在组里）、不是主对话、不是用户还没写过的子任务。项目本身留着；每个会话可 `session restore` 回来。外置下照样能用，归档的是外置那边的会话。
3. **永久删除**：任何会话都能删（不要求先归档；界面只在「已归档」里给这个入口，那是界面的两步式，不是 Core 的规则），两种运行时都行。顺序是先判主对话、再查会话在不在，才去关 runner，被拒或查无此会话时不碰任何 runner。
4. **错误标识**：两个 `invalid_args` 上的稳定前缀，照票 34 的做法（先例 `schema_mismatch:`），已写进 §1.1：`main_chat_protected:`（主对话 rename / pin / unpin / delete）、`managed_runtime_only:`（外置下 `llm set-default`）。其余用现成的：`not_found`（3）、已归档会话不能置顶、项目名为空、`project update` 一个字段都没给（都是 `invalid_args`，2）。
5. `project update` 的空值：空 `--icon=` / `--color=` 清空，空 `--name=` 拒。

**与票面不同**

1. **主对话「归档不允许」只做到新命令这一层**：`project archive-sessions` 跳过主对话；现有的 `session archive` 没改，仍接受主对话。理由：票本身要求「只加不改」，`session archive` 是 v1 就有的命令，改成拒绝等于在 `3` 里改既有命令的行为（Rule 3）；`session_writes.rs` 模块说明和 §5.2 `mainChat` 早写明它照旧接受，界面下次启动会把被归档的主对话恢复。要硬拦得等下一个 `schemaVersion`，在那之前靠手册（票 36）约束。
2. **「只在前端拼几步的挪进 Core、界面改调它」三处都没改界面的调用**：
   - 归档全部对话：界面不是逐个归档，而是自己挑出组里的会话、调一次 `bulk_archive_sessions`。挑选规则现在在 Core 有一份（`Writes::archive_project_sessions`，CLI 用），界面没改调它：确认框标题里的数字来自界面自己看到的那组，换成 Core 现挑，确认的数字和真正归档的可能对不上。两边注释互相指着。一处边角差异：删项目对话框「同时归档」用的 `archivableProjectSessions` 不排除未提升的子任务，组菜单与 Core 排除；子任务建出来不带项目，只有 CLI `session move` 能把它放进项目，平常碰不到。
   - 永久删除：界面先 `shutdownBridge` 再 `delete_session`，前一步还要清界面自己的桥连接状态，整段挪不进 Core；CLI 这边由 socket 命令在 Core 里按同样两步做（RunnerManager 关 runner、同一个 `Writes::delete_session`）。
   - 设为默认：界面本来就是一次 Core 调用，不用动。为了 CLI 改完也重写托管运行时的生成配置，把 Tauri 里的 `sync_managed_model_config` 挪成 Core 的 `managed_model_config::sync_for_app`，界面的模型设置命令都改调它，报错文字照旧。
3. **加了一处界面接线**（不是视觉改动）：CLI 改了默认后 Core 发 `managed-models:changed`，界面重新拉模型列表（`useExternalCoreEvents` 加一个监听，store 加 `applyExternalChange`，照它自己保存后的做法）。不加的话界面手里的列表是旧的，新对话会按旧默认把模型写进会话行。
4. **`project update` 只给名字、图标、颜色**（票表那三项，与 `project create` 同名参数一致）。实际界面的编辑框改的是名字和文件夹，图标颜色是遗留元数据、界面不显示；文件夹（`--root-path`）票里没列，没给，要时再加。

**改了哪些文件**

- Core：`core/src/socket_listener/hands_cmds.rs`（新，九个处理函数）、`socket_listener/mod.rs`（分发表）、`protocol/commands.rs` 与 `protocol/mod.rs`（九个参数类型，线上形状测试）、`session_writes.rs`（`refuse_main_chat` 公开并带前缀、`archive_project_sessions`）、`db/managed_model.rs`（`set_default_managed_model`）、`managed_model_config.rs`（`sync_for_app`）、`commands/managed_model.rs`（改调它）、`db/project.rs`（`fetch_project` 公开）、`api/session.rs` / `api/model.rs` / `api.rs`（两个前缀常量、事件名）。
- CLI：`cli/src/hands.rs`（新）、`args.rs`、`main.rs`。
- 界面：`gui/src/hooks/useExternalCoreEvents.ts`、`gui/src/stores/managed-models.ts`、`gui/src/lib/managed-models.ts`、`gui/src/stores/managed-models.test.ts`；`gui/src/lib/sidebar-timeline.ts` 只加一句注释，指向 Core 那份规则。
- 测试：`core/tests/hands_socket_test.rs`（新，10 条，经生产路由，含与界面那次保存在孪生库上逐条对比模型顺序、默认标记与各层）、`cli/tests/hands_test.rs`（新，5 条，CLI 二进制真连测试里起的 Unix socket，用 CLI 的读命令核对写的结果）。
- 文档：`docs/agent-api/session-commands.md`（§5.13a–c，§5.2 `mainChat` 一句）、`project-and-llm-commands.md`（§5.16a–c、§5.18a）、`stability-and-versioning.md`（两个前缀、§7.1 一条）、`roadmap-and-references.md`（§8、§8A）、`README.md` 路由表、`docs/agent-api.md` 节表。没有迁移。

**没验证的**

- 真机：CLI 改默认后界面的模型选择器跟着变，只有 store 的单测；有 AppHandle 时 `llm set-default` 重写生成配置（`sync_for_app`）没有自动化测试（测试里没有 AppHandle），靠的是与界面模型设置同一个函数。
- Windows 命名管道下的 CLI 端到端（新测试只在 unix 跑）。
- 手册（票 36）还没写进这些命令和各自的授权级别。

**验证**（分支变基到 main `2d92a881` 之后又全跑一遍，结果相同）：

- `cargo check --manifest-path core/Cargo.toml --workspace` 通过（只有 `galley-relay` 原有的一条 `fetch_update` 弃用警告）。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC` 都是 41 个测试二进制、1054 passed、0 failed；变基前另跑过 `TZ=America/Los_Angeles`，同样 1054 / 0。本票新增：`hands_socket_test` 10 条、`cli/tests/hands_test.rs` 5 条、`protocol/commands.rs` 线上形状 1 条（命令名表另补 9 行）。
- 界面：`pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过；vitest 本机时区与 `TZ=UTC` 都是 153 个文件、1603 passed（含 store 新增 2 条）。
- 六个门禁脚本都是退出码 0：`ipc-drift` 对齐（18 events、11 commands）、`supervisor-sop-drift` 4 份副本一致、`docs link gate OK: 446 files checked`、`version-consistency` 5 个文件都是 0.6.2、`managed-ga-payload OK`、`ga-baseline-drift OK (f308ee7e)`。
- `git diff --check` 无输出；新增行里查私有域名、接口地址、本机路径，无；中文标点扫新增行，0 处。
- 格式：只对自己动过的文件跑 `rustfmt --check`（新文件整篇格式化，旧文件只改了自己的段落；`socket_listener/mod.rs` 里 `git.review` 一段原本就不合 rustfmt，没动）；界面旧文件只格式化自己的段落。
