# 36 助理手册、入口层、「在办的事」与真模型评测

Status: merged（2026-10-16 合入 main，合并提交 `3e22b3e8`；真模型评测 28 次过 27 次；真机随票 33–37 一起验）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 9（何时建、何时不建、到点怎么做、三级授权）与裁决 5（「在办的事」），主对话 PRD 裁决 84。依赖 34、35（命令名与参数定了才写得准）、37（「在办的事」的取数）。改 Core 里的提示词与手册、评测；不改界面。

## 目标

助理听到带时间的事会自己建提醒、当场说出来；答应过的后续一定落成任务；该先问的先问；到点被叫醒时知道怎么做。每段开头它知道自己答应过你什么。

## 一、助理手册（`core/src/assistant_manual.rs`）

加一节「定时与提醒」，再把票 35 的新手写进已有的命令清单。要点（措辞你写，照手册现有的语气与长度）：

- **什么时候建**：你提到带时间的事（交材料、开会、航班、还款、生日……），按事情的分量自己定提前量；它答应过的后续（「我周五再查一下」）必须落成任务，说了不建等于没做到还说做到了；派出去的活要等外部结果（物流、审核、对方回信），定个时间回头查。
- **什么时候不建**：没有时间点的；你说过不用的；同一件事已经有的（建之前 `schedule list` 查一遍）。
- **建了要说**：每建一个，回复里用一句话说清时间与要做的事（界面会在回复下挂卡片，它不用描述卡片）。不许悄悄给自己排叫醒。
- **记下的话写给到点的自己**：那时候这一段对话可能已经不在上下文里了；写清是什么事、为什么、要做什么、需要的上下文（人名、地点、链接），可以查历史补全。
- **改与取消**：你说一句「改到 9 点」「不用了」，它就去改或删。
- **授权**（裁决 3 的三级，套到定时与票 35 的手）：
  - 自己做，做完说一声：一次性提醒与叫醒自己；改、删它自己建的；会话改名（它派的）、置顶，项目改名、改图标、置顶、整体归档。
  - 先在对话里问一句：重复而且每次都花钱的任务（每次新开会话，或每次叫醒都要它干活）；动你自己建的定时任务；改你开的会话的名字；永久删除会话；改默认模型。
  - 只能你来，照旧：Key、渠道、浏览器插件、运行环境、更新、重置。
- **到点被叫醒时**：读叫醒行里记下的话与时刻；晚了就照实说晚了多久；事情只需提醒就一两句；需要先查就查完再说；活重就派子任务（跑完闭环会叫醒它）；事情已经过时或你已经办了，可以回 `<no-reply/>`。一次叫醒里有几件，一起说。
- 你自己建的定时任务（每次新开会话的）跑完也会叫醒它：看结果，一两句告诉你要点，不复述全文。
- GA 自己的 `sche_tasks` 照旧不许用（galley#31）。
- 票 35 的命令与级别：`session rename / pin / unpin / delete`、`project update / pin / unpin / archive-sessions`、`llm set-default`（授权按上面的三级）。现有的 `session archive` 仍接受主对话（Agent API 3 内不改既有命令，票 35 Comments），手册写明不许归档、改名、删除主对话。
- 建提醒与叫醒自己一律写 `--target=assistant`：CLI 默认是 `session`（票 34 定的，两种运行时都能用），忘了写会建成每次新开会话的定时任务。评测里加一条检查它带没带。

## 二、入口层（`core/src/managed_prompt.rs`）

- 「What Only The User Changes In Galley」（`:89`）**只对主对话改**：定时任务从「只归你」里拿掉，改成指向手册；第三级照旧。工作台会话、子任务、IM 渠道的提示词不变（裁决 3：授权只给助理；裁决 6 前 IM 里的它不给这些手）。确认 `compose_im_runtime_prompt` 那份没被带着改。
- 入口层其余照票 30 的结构，加最少的字：指到手册里的新节即可。预算与条款台账照 `docs/managed-ga-runtime/prompt-composition.md`。

## 三、「在办的事」（裁决 5）

- 每段开头（runner 起来、组 state block 时，与切段同一处）由 Core 从库里拼几行，放进主对话一节：
  - 待触发的定时任务：下次时刻（本地）、一句话（截断）、一次性还是重复、谁建的（它 / 你）、id；
  - 没结束的子任务：标题、状态（在跑 / 在问 / 出错）、id。
- 确定式、不调模型；有上限（条数与字数，你定，写进 prompt-composition 的预算），超了写「还有 N 件」；一件都没有就不写这一节。
- 只在主对话；外置零变化。
- 与票 37 的「待办」列表的「接下来」「在办」是同一组数据、同一个排序（主对话裁决 86：你看到的就是它看到的）；取数用票 37 在 Core 里加的那个查询（37 先合入），不另写一份。

## 四、真模型评测

- 在 `.scratch/main-chat/entry-layer-eval/` 照 `run.py` 的机制加一组用例（README 讲了怎么跑、怎么解 key、怎么拦截命令）：
  - 该建（你没说「提醒我」也该建）：如「周三下午要交报告」「我订了周五早上 7 点的航班」「下周一记得帮我看下物流」；
  - 不该建：「我最近想学吉他」「昨天开会挺累的」；
  - 该先问：「以后每天早上给我看看新闻」；
  - 已有同一件、你说不用了、改时间；
  - 叫醒：按时、晚了 9 小时、事情已过时。
  - 判定看它发出的命令（拦截）与回复里有没有说出时间。
- 模型用 JC 主对话现在用的那个（只读查 `workbench.db` 的 `sessions.llm_key`，条件 `main_chat = 1`），结果写明显示名；每条跑多次，表格写通过率。标准照票 30（20 次 19 过一档），不过就改手册再跑，改动写进 Comments。
- **结果与日志里不许出现模型服务商的域名、接口地址、本机路径**（开源仓库）。

## 文档

- `docs/managed-ga-runtime/prompt-composition.md`：手册新节、「What Only The User Changes」对主对话的改写、「在办的事」的预算与格式、评测证据、回归清单加条目。

## 验收

- Rust 测试：主对话的提示词不再把定时任务列为「只归你」，工作台与 IM 的照旧（字面断言）；「在办的事」的格式、上限、空时不出现、外置不出现；手册含新节。
- 评测通过率表在 Comments。
- `cargo test --manifest-path core/Cargo.toml --workspace`、六个门禁脚本、`git diff --check`、中文标点扫新增行。

## Comments

### 2026-10-16 实现回报（子代理，分支 `mc-manual`）

**改了哪些文件**

- `core/src/managed_prompt.rs`：
  - 「What Only The User Changes」的配置段抽成宏 `user_only_configuration!`，仍在 `RUNTIME_PROMPT_STATIC` 的 `concat!` 里，文本一字不变；主对话由 `main_chat_static_prompt()` 换成 `MAIN_CHAT_USER_ONLY_CONFIGURATION`：定时任务从清单里拿掉，末句「Reminders and scheduled tasks are not on this list: you set them yourself with the Galley CLI, as your manual (named below) says.」，其余（服务商与 Key、渠道、浏览器控制、运行环境、更新、显示）照旧，`sche_tasks` 与能力两段照旧。主对话的静态文本比共用的短 70 字节，静态预算不动。
  - 入口层：手册那段之前加一句「When the user mentions something with a date or time (a deadline, a meeting, a flight, a payment), or you promise to follow up, set a reminder without being asked: see "Reminders and scheduled tasks" in your manual.」；写命令清单改成「(a session, project, model or schedule command)」。预算 1699 → 1920（+221：这句连空行 217，清单 +4）。不加这句，像「周三下午要交报告」这样的话里看不到要写命令，模型不会去翻手册。
  - 新函数 `in_hand_section`（「在办的事」），`compose_main_chat_runtime_prompt` 多一个参数 `in_hand: Option<&str>`；新预算 `IN_HAND_BUDGET_BYTES` = 2467。
  - 测试新增 8 条、改 2 条（见验收）。
- `core/src/runner_commands.rs`：只动 `prepare_managed_spawn_args` 的主对话分支：用票 37 的 `assistant_todo::assistant_todo(galley, runners, now)` 读，`in_hand_section(…, &chrono::Local)` 拼；读失败记日志、不写这一节，runner 照常起。
- `core/src/subtask_report.rs`：晚到的提醒的叫醒措辞（见「与票面不同」第 1 条）。
- `core/src/assistant_manual.rs`：测试（新节、新命令的拼写、授权改写、主对话不许动）。
- `docs/managed-ga-runtime/galley-assistant-manual.md`：新节「Reminders and scheduled tasks」（When to set one / Setting one / Changing and cancelling / When one comes due，加 galley#31）；三级授权改写；命令清单加票 35 的手与 `schedule`；主对话不许归档、改名、置顶、删除（`session archive` 仍会放行，写明）；`<no-reply/>` 加「提醒已不适用」。
- `docs/managed-ga-runtime/prompt-composition.md`：主对话那段、In Hand 一节（格式、来源、何时写、上限、预算）、入口层与手册的新内容、预算、评测证据、条款台账三行、回归清单第 9 条改写并新增 28–34 条。
- `docs/managed-ga-runtime/runtime-modes-and-sessions.md`：待办一节指向 In Hand；叫醒一节记晚到措辞。
- `.scratch/main-chat/entry-layer-eval/`：`run.py`（`--suite schedule`、假 CLI 的 `schedule` 命令族与票 35 的手、判定、渲染、干跑）、`README.md`（新节与结果）、`schedule/`（新）。

**「在办的事」的格式与上限**

主对话状态块 `## Main Chat` 一段之后、入口层之前，一节 `### In Hand`（提示词是英文，节名也用英文）。例（Rust 原样输出，`schedule/rust-samples.json`）：

```text
### In Hand

As of 2026-10-16 14:05, local time (it may have changed since: `schedule list` and `session brief <id>` read it now).

Coming up (reminders and scheduled tasks):
- `sched_3f9a0c1d2e4b5a69` 2026-10-16 20:00 (Fri), one-off, set by you: 提醒用户带身份证：明早 8:05 虹桥的高铁 去上海出差
- `sched_41d0aa5e9b3c2f17` 2026-10-17 17:00 (Sat), weekly, set by the user, starts a new conversation: 整理下载文件夹
- `sched_9b2c7e1f0a3d4c58` daily, paused, set by the outside agent claude-code: 看一眼 MyApp 的依赖更新
- and 2 more: `schedule list`

Subtasks not finished:
- `s-mgq3c1d8-2k7v4p0a` 查三家本周螺纹钢报价: working
- `s-mgr8x2k1-5b9d3f7h` 订周三去上海的高铁: asking a question
```

- 数据：票 37 的同一个查询，取「接下来」「在办」两组、同一个排序；「最近做完」不放。确定式，不调模型。
- 每行：任务是 id、下次时刻（本地，格式同叫醒消息）、一次性 / daily / weekly / monthly、暂停、谁建的（you / the user / the outside agent 加名字）、开新会话的标「starts a new conversation」、记下的话；子任务是 id、标题、状态（working / asking a question / failed / paused at the step limit / stopped before it finished）。
- 上限：每组 5 行（`IN_HAND_MAX_PER_GROUP`），多的写「and N more」加列全的命令；话与标题压成一行、截 40 个字（`IN_HAND_TEXT_CHARS`），外部 agent 名截 24 个字。最坏情况 2467 字节（两组各 5 行、截满的三字节字、三位数的「more」），无余量，`\r` 不计。一件都没有就不写这一节。
- 何时：每次主对话 runner 起来（切段处，以及段中途重启），所以是快照；第一行写明何时读的、现在去哪读。只在主对话；外置没有主对话，其他提示词有测试保证不带它。

**工作台、子任务、IM 的提示词不变**：改动前后用临时测试导出 `compose_runtime_prompt`、`compose_im_runtime_prompt`、`im_supervisor_prompt` 与 `prompt_hash()`，`cmp` 全部相同（hash 仍是 `c7d34e43`）。常设测试 `only_the_main_chat_sets_scheduled_tasks_itself` 字面断言：工作台与 IM 仍有「Channels, scheduled tasks, Browser」与「the prompt and time for a scheduled task」、没有主对话那句；主对话反之；主对话静态文本把那段换回去就等于工作台的。

**评测**（模型 gpt-6.1-sol，即 JC 主对话现在用的：只读查 `sessions.llm_key`、`main_chat = 1`，推理强度 high；结果 `.scratch/main-chat/entry-layer-eval/schedule/results.md`）

最终文本下的通过率：

| # | 用例 | 分组 | 遍数 | 过 |
| --- | --- | --- | --- | --- |
| 1 | report-wed「周三下午要交报告」 | 该建 | 2 | 2 |
| 2 | flight-fri「我订了周五早上 7 点的航班」 | 该建 | 2 | 2 |
| 3 | logistics-mon「下周一记得帮我看下物流」 | 该建 | 2 | 2 |
| 4 | water-10min「十分钟后提醒我喝水」 | 该建 | 2 | 2 |
| 5 | guitar「我最近想学吉他」 | 不该建 | 2 | 2 |
| 6 | tired-meeting「昨天开会挺累的」 | 不该建 | 2 | 2 |
| 7 | daily-news「以后每天早上给我看看新闻」 | 该先问 | 2 | 2 |
| 8 | already-set（「In Hand」里已有） | 已有同一件 | 2 | 2 |
| 9 | no-need「刚给我妈打过了，周日那个不用提醒了」 | 不用了 | 2 | 1 |
| 10 | move-time「改到 9 点吧」 | 改时间 | 2 | 2 |
| 11 | wake-on-time | 叫醒按时 | 2 | 2 |
| 12 | wake-late（晚了 9 小时） | 叫醒晚到 | 4 | 4 |
| 13 | wake-obsolete（用户已经拿了快递） | 叫醒已过时 | 2 | 2 |
| | 合计 | | 28 | 27（96%） |

- 每次 `schedule create` 都带了 `--target=assistant` 与 `--supervisor=galley-assistant`，建之前都先 `schedule list`；写命令之前都读了手册；没有多余的写命令、没有 `session wait` 一类、没有 `<subtask>`。
- 唯一不过：no-need 第 2 遍删对了那一个，但「已取消……不会再提醒你了」只写在 GA 的 `<summary>` 里，回复正文是空的。见「拿不准」第 1 条。
- 用量：45 次运行（保留 28，作废 17），107 次模型调用。作废的与原因都在 `results.json` 的 `meta.superseded_runs`。

**评测不过后改的**

1. 手册（第一轮，每条一遍，12/13）：周五晚上说「周五早上 7 点的航班」，它问「你说的是下周五吗」而没建。「Setting one」加一条：一天能指两个日期时取还没过的那个，建好，在那句话里说出日期让用户纠正，不先问。之后两遍都建在周四晚 8 点并点明「按下周五 10 月 23 日理解」。
2. 叫醒措辞（第二轮 wake-late 1/2；连第一轮是 2/3）：不过的那遍把「晚了 9 小时」写进了 `<summary>`，正文只转述记下的话。先把「Tell the user it comes late, and how late.」改成并进行动句的「Act on it now, and say first that it comes 9 hours late:」，两遍都还是写进摘要（「先说」被理解成先写摘要）；再改成「Act on it now, and say in the reply itself (the user does not see your summary) that it comes 9 hours late:」，四遍全过。

**与票面不同、或我加的**

1. **改了 Core 的叫醒措辞**（票 33 的 `subtask_report::due_paragraph`，只改晚到那一支；按时的逐字不变）：手册只在第一次写命令前读，叫醒这一轮多半不写命令、不读手册，能管住它的只有叫醒消息。单测跟着改，`runtime-modes-and-sessions.md` 记了一句。
2. **加了第 13 条用例「十分钟后提醒我喝水」**：票 33 的真机验收句，也是唯一要先看钟的；沙盒为此多放行 `/bin/date`。
3. **航班用例照票面写「周五」**，评测那天正好是周五晚上，成了「一天能指两个日期」的用例；判定窗口按「还没过的下一个周五」算。
4. **`run.py` 读库改成原地只读**（`mode=ro&immutable=1`），不再先拷一份带密钥的库到临时目录。
5. **授权里「重复的」怎么分**：票面第二级是「重复而且每次都花钱的」。手册写成：用户没开口的重复任务先问；用户开口的，只要每次都要它干活（查东西、写东西）也先问一句时间与内容；只是说一句的重复提醒（「每天晚上提醒我吃药」）用户开口就直接建。后一种没进评测。

**拿不准、要主会话定的**

1. **只写在 `<summary>` 里的回复**：两组评测 95 次运行里出现 2 类、共 4 次（晚到的那 3 次已由措辞修好；no-need 那 1 次是整条回复只有摘要）。按 `turn_persistence::derive::clean_final_answer` 去掉摘要后正文为空，主对话里大概率只剩过程卡片，用户等于没收到回复（没在真机上看）。建议确定式兜底：主对话一轮的正文为空而摘要不空时，把摘要当回复画出来（界面或 Core 推导），而不是再往提示词里加一句。本票没做。
2. **About 功能地图过期**：共用静态规则写着侧栏有「scheduled tasks ("定时" / "Scheduled")」，票 37 之后托管运行时那里是「待办」。所有托管会话都受影响，本票按「工作台与 IM 逐字不变」没改，手册里写了用户在侧栏「待办」看提醒。建议另开一小票，改了要按预算规矩记账。
3. **In Hand 是快照**：段中途建的提醒不在里面（它就在对话里）；长段里会过时，第一行已写明去 `schedule list` 读。
4. **`session archive` 仍接受主对话**：Agent API 3 内不改（票 35），只靠手册约束。

**验收**（在 base `99c8b1fe` 上跑；之后变基到 main `76f60a62`，那个提交只动界面与文档，变基后 `cargo check`、六个门禁、`git diff --check` 重跑都过）

- Rust 测试（票面验收）：主对话不再把定时任务列为「只归你」、工作台与 IM 照旧（`only_the_main_chat_sets_scheduled_tasks_itself`，字面断言）；主对话静态文本不超预算（`main_chat_static_rules_stay_within_the_static_budget`）；入口层那句（`main_chat_entry_layer_asks_for_reminders_unasked`）；「在办的事」的格式（`in_hand_lines_say_what_when_and_who`）、上限与空时不出现（`in_hand_lines_are_bounded_and_absent_when_empty`）、只在主对话（`in_hand_lines_are_main_chat_only`）、库上与待办同一组同一序、没有主对话时没有子任务（`in_hand_lines_read_what_the_todo_list_reads`）、预算（`in_hand_lines_stay_within_budget`）；手册含新节与新命令（`manual_covers_reminders_and_the_new_hands`，`manual_spells_commands_as_the_cli_does` 加了票 34、35 的拼写）；叫醒措辞单测跟着改。
- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished dev profile`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各一遍，都是 42 组 `test result: ok`，合计 1079 passed、0 failed。
- 六个门禁脚本退出码都是 0：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 446 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。
- `git diff --check` 无输出；新文件无行尾空白。`rustfmt --edition 2021 --check` 本票动过的四个 `.rs` 文件：exit 0。
- `run.py --dry-test`：`DRY TEST PASSED`（含新的 schedule 路径：Python 移植逐字对上 Rust 样本，假 CLI 的过去时刻、没带 target、主对话改名被拒，判定读得出来）；旧三组 `--render-only` 重出的结果与已提交的一致（dispatch 的 md 有一处截断位置不同，是原有的先渲染后脱敏顺序造成的，已还原、没提交）。
- 公开仓库检查：新增行与评测结果里 grep 域名、`http`、`api_host`、`apibase`、`/Users/`、用户名、`/var/folders`、`/private/tmp`：只有项目主页与 `example.com`，以及读配置的代码里的键名 `apibase`；临时路径都已写成 `$TMPDIR`。
- 中文标点扫新增行：中文句子 0 处；英文提示词格式与英文注释里夹中文词的 15 处是英文句子的标点，不改。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：卡片、待办、通知、真实 Core 下的 `createdIn` 挂载；JC 要试的见回报。
- 评测里的 CLI 是假的（按 Agent API 与真实 CLI 的校验写的），不是真 Core；Windows 没测。
- 评测的消息都是新段第一轮或很短的历史；长对话里它会不会漏建提醒没测。
