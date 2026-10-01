# GA 自带调度器在内置模式下不运行：提示词纠偏 + 迁移说明（galley#31）

日期：2026-10-01
关联：[galley#31](https://github.com/wangjc683/galley/issues/31)、`core/src/managed_prompt.rs`（Scheduled Tasks 一节）、
[提示词组成](../managed-ga-runtime/prompt-composition.md)（静态条款、条款台账、回归清单第 9 条）、
[运行时模式](../managed-ga-runtime/runtime-modes-and-sessions.md)「GenericAgent's Own Scheduler」、
[定时任务 PRD](../../.scratch/scheduled-tasks/PRD.md)（`:140` 不桥接 GA 调度器）、`.scratch/scheduled-tasks/issues/06`（信号记录）、
[deferred](./deferred.md) 两条（`sche_tasks` 导入、不经 LLM 的脚本任务）

## 现象

社区报告（v0.5.3，macOS）：从外置 GA 迁到内置，原来用 GA 的会话内调度器（`agentmain.py --reflect reflect/scheduler.py` +
`sche_tasks/*.json`）跑每日备份、备忘检查；把 `sche_tasks/` 拷进 `managed-ga-state/` 后不执行。另提：两套调度互不相通、没有迁移
路径，`handler` 字段（不经 LLM 直接跑本地函数）被当成空提示词，CLI 没有 `schedule` 命令；切换运行时后看不到另一模式的会话。

## 核对（main = v0.5.5）

1. **属实，根因更深**：Galley 在两种模式下都不启动 `--reflect`（`runner/`、`core/`、`cli/`、`gui/`、`scripts/` 无一处）。即便启动，
   `scheduler.py:14-15` 的 `TASKS` 也是相对代码目录的 `../sche_tasks`，内置代码在只读的 App Resources 里，不会读 `managed-ga-state/`。
2. **更要紧，issue 没提**：种子 `scheduled_task_sop.md:3` 教 agent 往 `../sche_tasks/` 写，内置 agent 的工作目录是 `state_path('temp')`
   （`ga.py:29`），于是落到 `managed-ga-state/sche_tasks`，同样没人读；记忆索引模板（`global_mem_insight_template.txt:12`）还写着
   `定时:scheduled_task_sop`。用户在对话里说「每天 8 点帮我备份」，agent 很可能写个 JSON 回一句「已设置」，静默失效。种子是缺了才补
   （`code-state-and-patches.md:81-92`），改种子到不了老用户。这条链是读码推出来的，尚未在对话记录里见到；本机状态目录里也没有
   `sche_tasks`。
3. **半对**：45762 端口锁属于 GA 的 `scheduler.py`（`:4-9`），只防第二份 `scheduler.py`；Galley 的调度器（Core 里 60 秒一跳的 tokio
   循环）不用它。所以外置 GA 的调度器可以在 Galley 之外照常跑，与内置模式的 Galley 并存。
4. **属实但不是基线落后**：`handler` 在上游截至 `2538ad9`（09-29）的历史里从未出现，应是报告者本地改的。
5. **运行时切换后看不到另一模式的会话**：有意设计（`runtime-modes-and-sessions.md`）；切换没有确认框，切换后的 toast 已写「原对话已
   保留，可切回查看」；CLI 用 `sessions list --runtime=all` 可见全部。不改。

`sche_tasks` 与 Galley 定时任务的字段对照（导入为何有损）：

| `sche_tasks` | Galley | 说明 |
|---|---|---|
| `schedule` | `time_of_day` | 直接对应 |
| `enabled` | `enabled` | 直接对应 |
| `prompt` | `prompt` | GA 套在外面的报告路径包装与 `done/` 报告会丢 |
| `repeat: daily` | Daily | 直接对应 |
| `repeat: weekday` | Weekly 周一到周五 | 直接对应 |
| `repeat: weekly` / `monthly` | 无 | GA 是 6 / 27 天冷却，不是固定星期几 / 几号，导入得替用户挑一天 |
| `once`、`every_Nh`、`every_Nd` | 无 | 没有对应 |
| `max_delay_hours` | 无 | Galley 当天内补跑到本地午夜 |
| `handler` | 无 | 上游也没有 |
| 无 | `project_id`、`llm_name` | Galley 独有 |

## 裁决（JC，2026-10-01，「按建议推进」）

1. **修静默失效**：Galley 自己的内置提示词（`RUNTIME_PROMPT_STATIC`，桌面会话与 IM 渠道共用）加「Scheduled Tasks」一节：这个运行时
   不执行 `sche_tasks`，不要写这类文件、不要说已设置；用户要定时就引导到侧栏「定时」/ "Scheduled"，agent 自己建不了，只帮用户拟好
   prompt 与时间。不碰用户状态，老用户也生效；外置模式不注入提示词（宪法第 1 条），外置用户自己跑着 GA 调度器本来就能用。按
   `prompt-composition.md` 的准入测试三条都过（用户会问、没有工具能告诉它、答错是定时任务静默失效），条款台账与回归清单第 9 条同步补上。
   `PROMPT_PROFILE_ID` 不变（照 09-09 加完整路径规则的先例），指纹随静态规则变化，只作诊断。
2. **文档**：`runtime-modes-and-sessions.md` 写明内置模式不运行 `sche_tasks` 及两条迁移路：在「定时」里重建（附哪些重复方式没有对应）；
   或在 Galley 外继续跑外置 GA 的调度器。
3. **暂缓**：`sche_tasks` 导入、不经 LLM 的脚本任务进 deferred；`galley schedule` CLI 在 `.scratch/scheduled-tasks/issues/06` 记下
   第一个外部信号，状态不变（仍不是 supervisor 用例）。与第 1 条配合，有了这条命令面 agent 就能在对话里直接替用户建任务，这是将来升级的
   主要收益。
4. **不做**：在内置模式里托管 GA 调度器。PRD `:140` 否过；它还会经 `hub.connect` 拉起 GA hub 的 TCP 端口，违背宪法第 2 条的精神，
   且外置模式用不了、执行不产生 Galley 会话。

## 验证

- `cargo test -p galley-core --lib managed_prompt` 11 passed（新增 `runtime_rules_steer_schedules_away_from_ga_sche_tasks`：桌面与 IM 两种
  组成都带该节）；`rustfmt --check` 干净。
- 提示词回归清单（`prompt-composition.md`，dev 版 + 真模型，CLI 驱动、`wait --until-idle` 收结果）9 条全过。第 9 条单开新会话：
  「每天早上 8 点帮我把 ~/Documents/notes 备份到 ~/Backups」→ 没有写 `sche_tasks`（状态目录里仍无该目录），引到侧栏「定时 /
  Scheduled」并说明自己建不了，拟好名称、频率、时间与完整 prompt，还指出源目录不存在。第 1–8 条同一会话：作者只给名字与主页（第 2
  条保留「神秘」说法）；版本 0.5.5 来自状态块；模型经 CLI 查得、不凭空断言；拒查微信记录；历史对话经 CLI 找到；产品名写 Galley；
  第 8 条把目标目录换成 scratchpad（不往 `~/Downloads` 留文件），四个文件都给完整路径。
