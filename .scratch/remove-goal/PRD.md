# 去掉 Goal（Less harness. More model.）

Status: done（2026-10-13 四票完成并合入 main，待 JC 真机验收；见 devlog `2026-10-13-remove-goal.md`）

来源：2026-10-13 讨论。JC 提出按「Less harness. More model.」完全去掉 Goal：模型够强，说清目标就能一直干下去。
agent 的判断：这条论证只覆盖「干完为止」一种用法——模型停下多半不是能力不够，而是收口习惯、`ask_user`、
GA 每次 `put_task` 180 步上限这三个结构性原因，它们不随模型变强消失；但使用数据与定位撑得住「去掉」。
JC 裁 A（全删），五个裁决点全按推荐。

## 依据（2026-10-13 核实）

- **续跑从未触发**：v2 上线（09-16）四周，`goals` 表 5 行——3 行是 09-16 当天的 dogfood，2 行是 10-09 / 10-10
  借 Goal 做的暗号测试；5 行的 `continuation_count` 全是 0。v1 三个月 0 条。
- **离步数上限很远**：`workbench.db` 478 个用户任务，单任务最多 52 步，≥80 步的 0 个；GA 上限 180
  （`managed-ga/code/agentmain.py:218`）。
- **强模型自己做完**：09-16「了解三星折叠屏」10 分钟上限，2 分半模型自判完成，一次续跑没发
  （`docs/devlog/2026-09-16-goal-v2-codex-shape.md` 后记四）。
- **留着的形态不是 JC 要的那种**：JC 的主场景是「离桌扔长任务 / 把 quota 用满」，即「用满时间」，09-16 进了
  deferred（`use_budget`）没做；留着的「干完为止」恰好是强模型不需要的那种。
- **补偿型脚手架**：主对话 PRD 已立「补偿型脚手架不做」（`.scratch/main-chat/PRD.md:28`）；续跑循环补的是
  「模型会提早收口」，模型行为一变就报废。
- **上游有同类**：`managed-ga/code/reflect/goal_mode.py` + `memory/goal_mode_sop.md`（「用满预算」语义），
  TUI 有 `/goal`（`managed-ga/code/frontends/slash_cmds.py:586`）。它起独立进程，Galley 看不到也停不掉，
  所以只算「真需要时有路」，不算替代。
- **体量**：Goal 专属 Rust 约 2.4k 行（`core/src/goal_engine.rs` 1281 行）、GUI 专属约 3.7k 行；外加 CLI 一族、
  补丁 0022、runner / IM / GUI 剥标签、`remote-protocol` 与 iOS 的 goal 类型、内置提示词两处提及。

## 裁决（2026-10-13）

1. **全删**：Core 引擎、GUI 入口、CLI goal 族、`remote-protocol` 的 goal 类型、补丁 0022、剥标签逻辑、提示词
   提及；README 撤掉卖点与截图。落选：只撤 GUI、留引擎与 CLI 给 Supervisor（重量几乎没减，契约照背）；
   不动、等 `use_budget`（数据不支持）。
2. **契约升 `schemaVersion: 3`**，goal 族在每个版本下都答 `unknown_command`。照 v2 退役 v1 goal 命令的先例
   （`docs/agent-api/stability-and-versioning.md` §7.1 / §7.3）。
3. **deferred 的 `use_budget` 不关，改写**为「若要回来，按序：改 180 常量 → 接上游 `goal_mode` → 才是自建循环」。
4. **不单独发版**，随主对话那次 minor 一起出（裁决 54 已压着）。
5. **不在内置提示词里拦**「用 goal 模式干」：内置 GA 可能照 `goal_mode_sop.md` 自起后台进程，这在今天就可能发生，
   与删不删无关；等真出现再说。

**实施时改判（主会话）**：讨论时我写的是「新迁移 drop 掉 `goals` 表」。复核 10-05 去审批的先例后改为
**不加迁移**：`goals` 表与 `messages.goal_id` 列留在库里、不再读写。理由：与先例一致（`approval_rules`、
`tool_events` 等原样保留）；降级安全；用户状态不可替代（目标原文与摘要）；不碰迁移预检与六处手写迁移列表。
代价：库里多一张没人读的表。

## 重启信号

一个月内 ≥3 次「长任务中途手动发『继续』」（`workbench.db` 的 user 行可查），或社区有人要回 Goal。
届时的顺序：先改 180 常量（一行补丁）→ 再接上游 `goal_mode` → 最后才考虑自建续跑循环。

## 契约（写死，四张票共同遵守）

### Agent API

- `SCHEMA_VERSION = 3`，`ACCEPTED_SCHEMA_VERSIONS = [1, 2, 3]`；`galley version` 与 socket `version` 返回 `3`。
- socket 命令 `goal.start / goal.status / goal.active / goal.stop / goal.extend` 删除，**每个版本下**都答
  `unknown_command`；`goal_family_requires_v2` 删除。
- CLI 的 `galley goal …` 子命令删除：走现有 clap 解析失败路径，stdout 一行 `invalid_args` 信封，exit 2。
  `--schema=1 goal` 的本地 `schema_mismatch` 分支随之删除；`--schema=N` 不在 `{1, 2, 3}` 时照旧 exit 2 +
  `schema_mismatch:`。
- `MessageBrief.goalId` 从类型里删除，任何版本都不再输出（原是可选字段，Goal 之外的消息上本就缺省）。
- `GoalBrief`、`GoalBrief.status` 枚举、`goal start` 的 `dispatch` 值随族退役。
- 未文档化的 socket 命令 `session.checkpoint`：保留命令，删 `goalId` 参数（协议不用 `deny_unknown_fields`，
  旧调用方带上也被忽略），系统行不再盖 goal 戳。
- 其余命令、字段、退出码、错误标识不变；`1` / `2` 照旧回答每条没变的命令。

### Core ↔ runner IPC

- `turn_end.goalStatus` 三边同删：`runner/ipc.py`、`core/src/ipc.rs`、`gui/src/types/ipc.ts`。
  漂移门禁 `node scripts/check-ipc-protocol-drift.mjs` 在三票都落地后必须过。

### Core ↔ GUI（Tauri）

- 删 8 个 Tauri 命令：`list_active_goals`、`list_visible_goals`、`list_goals_for_session`、`goal_status`、
  `mark_goal_result_seen`、`request_goal_stop`、`start_session_goal`、`extend_goal`。
- 删事件 `goal-updated`。
- 返回给 GUI 的消息行不再带 `goal_id`。
- 会话分页不再回溯到 goal 委派行（`core/src/db/session.rs` 的 `goal_commission_before`）。

### Remote protocol（未发版，直接删）

- `goal.updated` 应用事件（`GoalUpdatedEvent`）、推送 `kind::GOAL`、应用消息类型的 `goal_id` 字段、golden 里
  的对应条目；iOS 的 `Events.swift` / `Types.swift` / `Push.swift` 镜像同删。Core remote 模块不再转发 goal 事件、
  不再发 goal 推送。

### 数据

- **不加迁移**。`goals` 表、`messages.goal_id` 列、pref `notify_on_goal_end` 原样留在库里，不再读写。
  历史迁移 015–039、`core/src/db_migrations.rs` 的条目、`core/src/migration_backup.rs` 的预检、六处手写迁移
  列表（`core/tests/{db_test,db_writes_test,scheduler_fire_test,socket_write_handlers_test}.rs`、
  `cli/tests/{cli_test,m1_writes}.rs` 里的 `include_str!` 列表）都不动。
- 启动时的 `pause_open_goals` 删除。升级瞬间库里若有 open goal：行留着、没人读，无副作用。
- 历史 goal 会话照常打开：目标行是普通 visible user 行；续跑行是 `internal`，按通用规则隐藏——
  **通用的 internal 过滤不能随 Goal 一起删**。

### 显示的遗留清洗（唯一保留的 goal 痕迹）

- 本机库里 4 条历史智能体行的 `content` 带原样 `<goal-status>…</goal-status>`；`final_answer` / `summary` /
  `preamble` 里没有（Core 落库推导时已剥）。GUI 渲染落库行读 `final_answer`，从不渲染智能体行的 `content`，
  所以历史显示本来就干净（票 02 核实，`gui/src/stores/messages/rowsToTurns.ts:85`）。
- 留着的风险在实时路径：重开旧 goal 会话时，Core 把带标签的 `content` 回放进模型历史，新回复可能照抄这个标签。
  所以 GUI `ga-output-cleaning.ts` 的 `GA_TAG_PATTERNS` 与 Core `turn_persistence/derive.rs` 的
  `clean_final_answer` 各保留 `goal-status` 这一个完整标签的剥离，注释写明原因；两边推导一致。先例：去审批后，
  历史转录里的 `denied` 仍显示「已拒绝」。
- 其余全部删除：GUI 的未闭合标签截断与 preamble 两处、runner 的提取与剥离、IM reporter、补丁 0022、
  `core/src/subtask.rs` 里的剥离。（初稿把这一节写成「GUI 渲染时剥落库行」，票 02 查实后改正。）

### 内置运行时

- 删补丁 `managed-ga/patches/0022-managed-strip-goal-status.patch`，两本账（`managed-ga/manifest.json`、
  `managed-ga/patches/manifest.md`）同改，按 `docs/managed-ga-runtime/code-state-and-patches.md` 用
  `scripts/build-managed-ga.sh` 重建 payload，`node scripts/check-managed-ga-payload.mjs` 必须过。
  0023–0028 都不碰 `frontends/chatapp_common.py` / `frontends/fsapp.py`，没有顺序依赖。
- 上游的 `reflect/goal_mode.py`、`memory/goal_mode_sop.md`、`goal_hive_*.md` 是上游代码与种子，**不动**
  （Rule 1，随 baseline 走）。
- `core/src/managed_prompt.rs` 里两处 Goal 提及（:62 输入框说明、:417 命令列表）删掉。

### 外置 / 内置影响

续跑循环在 Core，剥标签在 runner 与 GUI，两种运行时的变化相同；只有补丁 0022 是内置专属。
外置模式对 GA 的介入点不变（Goal 从来不改 GA 文件）。

## 拆票

| 票 | 域 | 依赖 |
|---|---|---|
| [01](./issues/01-core-cli-remote.md) Core + CLI + remote-protocol + iOS | `core/`、`cli/`、`remote-protocol/`、`ios/` | 无 |
| [02](./issues/02-gui.md) GUI | `gui/` | 无（按契约并行） |
| [03](./issues/03-runner-managed-ga.md) runner + 内置运行时 + 截图种子 | `runner/`、`managed-ga/`、`scripts/seed-screenshots.py` | 无 |
| [04](./issues/04-docs.md) 文档 | 见票面 | 无（按契约并行） |

主会话：PRD 与票面、`AGENTS.md` 两处 schema 文字、devlog、`docs/devlog/deferred.md`、`docs/project-status.md`、
`.scratch/ios-client` 里的 Goal 提及、集成验收、门禁、提交、合入。

全部在 worktree 里做；JC 的 `tauri dev` 常驻主工作树，子代理绝不碰主树。

## 验收

- 门禁：`cargo test --workspace`、`pytest` / `mypy` / `ruff`、`pnpm typecheck` / `lint` / `test`、
  `ios/GalleyRemote/swift-test.sh`（只有 Command Line Tools 时裸 `swift test` 找不到 `Testing`）、`check.yml` 的六个门禁脚本、
  `git diff --check`。
- grep：除历史记录（devlog / archive / audits / adr / galley-native / `.scratch`）、历史迁移、上游 payload 与种子、
  GUI 中心清洗那一处、契约文档的退役说明外，代码里不再有 Goal 功能引用。
- 真机（JC）：输入框无 Goal 入口；顶栏无 Goal 标记；设置 → 通知只剩「回复完成时通知」与提示音；打开一段历史
  goal 会话（如 `s-mu3yjxah-wnb0`）显示正常、无原样标签；`galley goal start` exit 2。
