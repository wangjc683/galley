# 01 种子补主对话、子任务、待办；playbook 改 hero 与 tools 场景

Status: needs-dogfood

来源：2026-10-21 JC 发版前改 README（「按你推荐推进」）。裁决：截图走 A，发版前只重拍 `hero.png`、`hero-dark.png`（主对话）
和 `tools.png`（工作台），zh / en 各一套；`reading`、`projects`、`scheduled`、`search`、`new` 五张暂留。

## 问题

`scripts/seed-screenshots.py` 停在 043 之前：没有主对话（044 `sessions.main_chat`）、子任务（048 `parent_session_id`、
`subtask_dispatches`）、待办（050 `todos`、`scheduled_tasks.todo_id`）。README 新叙事是「你只跟一个人说话」，
hero 却只能拍工作台。

## hero 场景（zh；en 同构、原生英文重写）

主对话里种两段历史，拍摄时 JC 现场发第三段：

1. **昨晚 21:10**，你：「下周三要交季度报告的材料，周二晚上我在家。」
   它：「记下了：「交季度报告材料」截止下周三，周二晚上 8 点提醒你过一遍。不用提醒的话说一声。」
   对应待办一条（截止下周三，挂周二 20:00 的一次性提醒），由助理建（`created_via` 等字段照 Core 的写法）。
2. **今早 09:12**，你：「帮我比较一下三家搬家公司的报价和评价。」
   它回一句并派出子任务（回复里的派活标签 → 卡片），子任务就是现有种子「三家搬家公司报价与评价对比」，改挂到主对话下、已完成。
   之后是一轮汇报（叫醒轮，库里怎么存照 `core/src/subtask_report.rs`、`core/src/db/subtask.rs`），可见的那句大意：
   「查好了：三家都能周六上门，报价 1,680 到 2,300。评价最稳的是 X，价格居中；最便宜那家近期有两条丢件差评。要我把 X 的预约电话发你吗？」
   具体公司名与数字跟子任务结果表对上。
3. **拍摄时现场发**（不种）：「这周末想带爸妈去看个展，帮我找几个地铁方便的，附开放时间和票价。」助理派活，卡片在跑，侧栏的脸在动。

再种 2 条待办凑出顶栏「待办」的今天计数：今天到期一条（如「给房东转 10 月房租」）、随时一条（如「取干洗的西装」）。

## tools 场景

从主对话的卡片点进「三家搬家公司报价与评价对比」：工作台里面包屑「Galley ›」、右侧是派活说明（助理写的，不是你的原话；`origin.via` 照 Core 写 `subtask`）、
步骤折叠、结果表。现有种子这条会话的首条用户消息是用户口吻，要改成派活说明口吻。

## 要做的

1. 种子：主对话行（若 Core 首启已建，就往那一行里写；没有就建，守 044 的唯一索引与 `ga_runtime_kind = 'managed'` 约束）、
   上面三类数据、zh / en 两套。写法以 Core 实际落库为准（读 `core/src/db/main_chat.rs`、`db/subtask.rs`、`db/rows.rs`、
   `assistant_todo.rs`、`db/schedule.rs` 与对应迁移），不靠猜列名。时间戳相对拍摄时刻生成，「昨晚」「今早」「下周三」按本地时区算。
2. 子任务会话不出现在侧栏（未 promoted）是正常行为；确认它挂到主对话后，`projects.png` 暂留不拍不受影响，但不要让种子因此失败。
3. `docs/screenshot-playbook.md`：hero / hero-dark / tools 三行场景清单、种子导读、「Hero prompt」一节改成主对话现场发的那句（保留准入标准：
   答案必须依赖模型不可能预知的此刻数据）、拍摄纪律补主对话相关的坑（如不要点重置主对话、头像动效在 Reduce Motion 下静止）。
   其余五张的场景行加注「2026-10 暂留，外壳过时」。
4. `.scratch/readme-screenshots-v3/PRD.md` 的「前置修复」里 Goal 那条已过时（2026-10-13 Goal 已移除、种子的 goals 插入已删），核实后改掉。

## 约束

- **不碰真实数据目录** `~/Library/Application Support/app.galley`（JC 的 tauri dev 正在用）。只用 `--init-schema --db <scratchpad 里的临时文件>` 验证。
- 中文内容一律全角标点；自写检查脚本放 scratchpad、用专属文件名。
- 开源仓库：种子与文档里不写接口域名、`api_host`、本机绝对路径。
- 只点名文件提交，禁用 `git add -A` / `git commit -a`。

## 验证

- `scripts/seed-screenshots.py --lang zh --init-schema --db <tmp>` 与 `--lang en` 各跑一遍成功；用 sqlite 查询逐类核对行数与关键字段
  （主对话唯一、子任务 `parent_session_id`、`subtask_dispatches` 对上卡片、待办与提醒的 `todo_id`、今天计数）。
- 读 GUI 侧渲染主对话卡片、汇报行、待办计数的代码，说明种子数据会走到哪条渲染分支；做不到真机渲染验证的，写进「没验证到的」。
- `git diff --check`；新增中文行全角标点扫描。

## 交付

worktree 分支上提交（只点名文件）。Comments 写：种子落库与 Core 写法的逐项对照、没验证到的、JC 拍摄当天第一步该先看什么。Status 改 `needs-dogfood`。

## Comments

### 2026-10-21 实现

改动：`scripts/seed-screenshots.py`（主对话、子任务、待办与提醒，zh / en 两套）、
`docs/screenshot-playbook.md`（hero / hero-dark / tools 三行、种子导读、Hero prompt、拍摄纪律、
其余五张注「2026-10 暂留，外壳过时」）、`.scratch/readme-screenshots-v3/PRD.md`（Goal 那条前置修复）。

**种子落库与 Core 写法逐项对照**

| 种子写的 | 照的 Core 写法 |
|---|---|
| 主对话行：有就沿用 Core 首启建的那一行（id、模型字段不动），把建立时间与问候行挪到三天前 20:31，问候按 `--lang` 改成 Core 原文；没有就新建：标题「主聊天」、`title_source` user、status idle、`created_via` gui ＋ client desktop、managed、`prompt_profile` galley-runtime-v1，再 `main_chat = 1`。先查 `main_chat = 1`，有就绝不再插 | `db/main_chat.rs` `get_or_create_main_chat`、`MAIN_CHAT_TITLE`、`MAIN_CHAT_GREETING_ZH / _EN`；`db/helpers.rs` `insert_session_row_inner`；`commands/session.rs`（`Origin::gui().with_client(Desktop)`）；044 唯一索引 |
| 问候行：`msg_{id}_greeting`、turn_index -1、sequence 1、`created_via` system ＋ supervisor galley-greeting | `main_chat.rs` `write_main_chat_seed`、`MAIN_CHAT_GREETING_TURN_INDEX` |
| 你的消息：`msg_{s}_{t}_user`、sequence 0、gui ＋ client desktop；turn 取已用最大值 ＋1（问候的 -1 算在内，所以第一条是 0） | `db/helpers.rs` `insert_message_inner`、`NEXT_TURN_INDEX_SQL`；`session_send.rs` |
| 助理行：`msg_{s}_{t}_assistant`、sequence 1、不带来源（列默认）；一轮各步占 base、base＋1…；content 是 GA 原样（正文 ＋ `<summary>`，派活那条再带 `<subtask>…</subtask>`），final_answer 是去标签后的正文；tool JSON 按 `JSON.stringify` 键序 | `db/session.rs` `persist_assistant_message`；`turn_persistence/mod.rs`（absoluteTurnIndex）、`derive.rs` `clean_final_answer`、`js_json_stringify` |
| `turn_count` ＝ 可见助理行数：主对话 6、子任务 4，都等于下一个 turn_index；`summary` ＝ 最后一步的 GA 摘要；结束后 status idle | `db/session.rs` `bump_session_after_turn_db` |
| 分段：上次活动后隔了 4 小时以上的下一条消息记一条 `main_chat_segments`（昨晚 21:10、今早 09:12 各一条），时间比那条消息早 25 秒 | `session_runner/segment.rs`（`DEFAULT_IDLE_HOURS`）、`main_chat.rs` `record_main_chat_segment`；046 |
| 待办：`created_via` supervisor ＋ galley-assistant ＋ reason；`created_in` ＝（主对话，这一轮你那条的 turn）；`created_in_turn_index` ＝ 这一轮回复，`updated_at` 挪到轮末；无时间的截止写 `due_date`；id `todo_<16 hex>`。记待办那一步是 `code_run`，脚本与结果由待办数据生成 | `socket_listener/todo_cmds.rs`（`origin_from_args`）、`schedule_cmds.rs` `created_in`；`db/todo.rs` `create_todo`、`settle_todo_created_in`；`api/todo.rs` `StoredDue`；050 / 051 |
| 提醒：once、`time_of_day` NULL、`fire_at` UTC 整秒 `+00:00`、target assistant、prompt ＝ 待办标题、来源同待办、`created_in_*` 全空、`todo_id` 指向待办；id `sched_<16 hex>` | `db/todo.rs` `set_todo_reminder`；`db/schedule.rs` `create_scheduled_task_in`、`future_fire_at`；049 / 050 |
| 子任务会话：project 空、模型字段抄主对话、`created_via` system ＋ `created_by_supervisor` galley-subtask、client 空、managed ＋ galley-runtime-v1、`parent_session_id` ＝ 主对话、`promoted_at` 空、标题 ＝ 派活说明首行；首条用户行 ＝ 派活说明原文，来源同上（读回是 via subtask） | `subtask.rs` `create_subtask`、`subtask_title`；`db/subtask.rs` `create_subtask_session`；`api/origin.rs` `Origin::subtask`；`db/rows.rs` `into_persisted`；048 |
| 派活记录：（主对话，回复 turn 4，ordinal 0，子任务 id，标题，failure 空），`created_at` 毫秒 `Z`；回复行 tool_calls `[]`、content 带标签 | `subtask.rs` `dispatch_tag`、`pending_reply`；`db/subtask.rs` `record_subtask_dispatch` |
| 汇报行：主对话的可见用户行，`created_via` system ＋ supervisor galley-report、`origin_note` ＝ 子任务 id、client 空、content ＝ `report_text` 原文（第 1 轮 Done 段落）、`summary` ＝ 那一条 replay 行；同 turn 的助理回复是这一轮的普通回复 | `subtask_report.rs` `deliver`、`report_text`、`replay_lines`；`db/subtask.rs` `persist_subtask_report`；`Origin::subtask_report` |
| FTS 不写 | `db/search.rs` `backfill_fts_if_empty`：索引行数少于可索引消息就整表重建（Core 的问候行算 1 行） |

**验证**

- `--lang zh` / `--lang en` 各在 scratchpad 的 `--init-schema` 临时库上跑通；另造一个「Core 首启建好主对话（英文问候、已进 FTS）」的临时库跑 `--lang zh`，种子沿用那一行、改写问候、模型字段传给子任务；主对话已有别的消息、或已有工作台会话时都按预期拒绝。
- sqlite 逐类核对：主对话 1 行；主对话 11 行消息（问候 ＋ 三段 ＋ 汇报轮），turn_count 6 ＝ 下一个 turn_index；分段边界 2 条（turn 2、4）；子任务 `parent_session_id` 对上、未 promoted、不在项目里；`subtask_dispatches` 1 行，指向的回复行存在且带标签；待办 3 条，`created_in_turn_index` 指向的回复都存在；提醒 1 条，`todo_id` 对上「交季度报告材料」；今天计数 1；侧栏可见会话 16；`foreign_key_check` 无输出、`integrity_check` ok。
- 渲染分支：用一个临时 vitest（跑完已删，未提交）把 zh / en 两库的行喂给 GUI 的真实函数：
  - `rowsToTurns` → `buildRunGroups(splitAfterAnswer)` → `assistantLinePlan`：问候画成消息；你的三条都画成气泡，昨晚、今早两条带时间线（`userTimeMarks`，跨天）；两轮记待办各两步、可折叠，回复带过程卡片；汇报行 `isSubtaskReportTurn`、不画，`plan.reports` 把它的时间挂到回复上（距 09:12 不到 1 小时，不出时间线）。
  - `todosByMessage`：房租、西装两张卡挂三天前那条回复（顺序与回复一致），交季度报告材料挂昨晚那条，三个锚点都是存在的回复 id。
  - 子任务卡片：`messageId` 是今早那条回复；`deriveSubtaskCard` 先 loading（卡片自己会 `restoreSessionTurns`），读到行后 done，状态行是 session 的 summary「3 家报价已入表，推荐公兴」；打开后首条是 via subtask 的用户行（`MessageUser` 的「主对话派来的」标记），一组 4 步可折叠。
  - 顶栏计数读 Core 的 `todayCount`（今天到期或逾期、未完成），种子 SQL 按同一条件核对为 1。
- `git diff --check` 干净；新增中文行全角标点扫描只命中 Markdown 链接括号与英文注释。

**偏离票面的地方**

1. 多种了一段三天前的对话（记房租、西装两条待办）。Core 只在主对话打开的一轮里给助理记的待办写 `created_in`，票面要的「今天到期一条、随时一条」得挂在某一轮上，不然就是 Core 不会写的状态（空，或指向不存在的回复）。它在 hero 画面上方，按场景清单的构图拍不到；不要的话删 `assistant_zh` / `assistant_en` 的第一段即可，代价是这两条待办没有卡片、`created_in` 不像 Core 写的。
2. 汇报那句 X ＝ 公兴，「最便宜那家」写成「最便宜的蚂蚁」。为让每个数字有出处，子任务结果表改了：¥2,300 / ¥1,960 / ¥1,680，三家月底周六可约，蚂蚁「丢件」×2，推荐从日式搬家改成公兴，并加了第三步「确认月底周六的档期」。
3. 顺手对齐了 Core 的两处写法，所有工作台种子会话都受影响：`turn_count` 改成可见助理行数（原来把用户行也算进去）；content 改成 GA 原样（`<thinking>` ＋ 正文 ＋ `<summary>`，去掉了 GA 没有的 `<preamble>` 包装），tool JSON 改成 `JSON.stringify` 键序。其余列不变，v2 那几张的画面应不受影响（未真机验）。
4. 「九月搬家」项目少了一条会话：Core 建子任务时 project 为空。`projects.png` 暂留，不受影响。
5. `new.png` 在场景清单里没有行，「暂留」注在「偏差」第 4 条。

**没验证到的**

- 没有真机渲染：种子没进过 tauri dev（按约束不碰真实数据目录）。上面的分支是 GUI 纯函数推出来的；气泡、卡片、时间线、计数的实际样子和头像动效要拍摄当天看。
- Core 侧的读法（`list_assistant_todo` 的 todayCount、`noted_todos`、`list_subtask_dispatches`）没跑 Rust，只按源码与 SQL 对照。
- 首启建主对话按源码推断（`lib/main-chat.ts` `openMainChat` 在启动和引导结束时调用）；没建的话种子自己建（`--init-schema` 路径已验）。
- 现场那轮：模型会不会派活而不是当场答、子任务翻展览要多久，都没实测。
- 拍摄时主对话的 runner 会把种好的行回放给模型（汇报行回放成 replay 行，派活回复带 `[subtask …]` 标记），形状照 Core 写，没真跑过。
- 有主对话时「昨日支出汇总」每天 08:30 跑完会叫醒主对话汇报，种子没种这一轮（playbook「不种」里写了）；要的话可以补一轮 08:31 的汇报。
- 三家搬家公司是真实的上海公司，数字和差评是编的，会进公开 README 截图。v2 起就这样，这次多了「丢件」差评；要不要换成虚构名字，等 JC 定。

**拍摄当天第一步先看什么**

1. 引导走完后主区是否打开主对话、只有一句问候；退出后跑种子，输出里应写着 `the one Core made, backdated` 和 `due today: 1`，而且没有 notice（有 notice 说明不到 09:32）。
2. 重启后先只看主对话：问候在最上；昨晚、今早两条时间线；两组待办卡片挂对回复；今早回复下的子任务卡片显示已完成和「3 家报价已入表，推荐公兴」；汇报那句单独一个气泡、前面没有你的气泡；顶栏「待办」旁是 1；侧栏里没有「三家搬家公司…」。
3. 都对再关「减弱动态效果」、发 Hero prompt。
