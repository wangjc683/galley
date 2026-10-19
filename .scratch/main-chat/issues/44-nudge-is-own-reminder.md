# 44 只要提醒的事用 Galley 自己的提醒（手册与评测）

Status: done（2026-10-19 JC 真机：「十分钟后提醒我喝水」记成 Galley 自己的提醒、不进待办，到点后进「已完成」。2026-10-17 快进合入 main，提交 `8d3119cd`、`94fe9137`；定时 28/28、待办 24/24，入口层没加字；回报两问主会话定为都不改：旧的独立提醒不迁移〔待办还没发版，只有 dogfood 库里有〕，「8 点提醒我回电话」截止写那一天〔8 点是提醒，不是截止，过 8 点就标红太吵〕）

来源：主聊天 PRD 裁决 92（2026-10-17，JC：「A」）。依赖 41（手册「To-dos and reminders」一节、入口层那段、`todo` 与 `schedule` 两套评测）。改 Core 里的手册与入口层提示词、评测；不改界面与 CLI。

## 目标

「十分钟后提醒我喝水」这种只要到点提醒一下、没有要办完的事，Galley 用它自己的提醒（一次性、叫醒它），不记成待办；有要办完的事（回房东电话、交报告、赶航班）照旧记成待办并挂提醒。

## 一、手册

在票 41 写的「To-dos and reminders」一节里改（措辞你写，照手册语气与长度）：

- 判法：你不理这次提醒，这件事还要留在清单上吗？不用（喝水、关火、出门、起来活动）就是它自己的提醒；要就是待办。
- 删掉或改写票 41 那句 `A request to be reminded (「十分钟后提醒我喝水」) is one too, with its reminder.`，例子换到它自己的提醒那边。
- 「明天早上 8 点提醒我给房东回电话」这种：要办完的事加一个时刻，是待办，提醒挂在待办上。
- 说一句话交代的方式照旧（记了什么、几点提醒）。

入口层只在必要时加字（票 41 已把预算提到 2026 字节、没有余量），加了就写理由，照 `docs/managed-ga-runtime/prompt-composition.md` 的预算与条款台账。工作台、子任务、IM 的提示词逐字节不变（断言）。`docs/managed-ga-runtime/galley-assistant-manual.md` 跟着同步。

## 二、评测

在 `.scratch/main-chat/entry-layer-eval/` 里：

- 判定改为两边分开：只要提醒的（喝水、关火）只认 `schedule create`（叫醒它的一次性），记成待办算错；要办完的（交报告、回电话、航班）只认 `todo add` 挂提醒。
- 加用例：「半小时后提醒我关火」（自己的提醒）、「明天早上 8 点提醒我给房东回电话」（待办挂提醒）。
- 两套（`todo`、`schedule`）全部重跑，每条两遍，模型照票 41（JC 主对话现在的那个，只读查库确认）。**结果与日志里不许出现服务商域名、接口地址、key、本机路径。**

## 验收

- Rust 测试：手册含新判法；入口层预算测试；工作台、子任务、IM 提示词逐字节不变。
- `run.py --dry-test` 通过；通过率表在 Comments，每个不过的写清模型做了什么、改没改措辞。
- `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区、`TZ=UTC`）、六个门禁、`git diff --check`、中文标点扫新增行。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-nudge`）

**改了哪些文件**

- `docs/managed-ga-runtime/galley-assistant-manual.md`（Core 用 `include_str!` 把它嵌进去，手册只有这一份）：「To-dos and reminders」一节。删掉票 41 那句「A request to be reminded (「十分钟后提醒我喝水」) is one too, with its reminder.」；「Noting a to-do」在「Not for …」之后加判法一段（见下）；`--remind-at` 那条改成「at the time they named, or else ahead by what it is」；「Your own reminders」开头改成「Set one when the user asks for a nudge with nothing to finish (see "Noting a to-do"), and without being asked when:」；节首两张单子里「Your own reminders」那条加上喝水的例子；「Who you are」末句加「and for a nudge they ask for」。说一句话交代的写法没动（待办照旧「记下了……几点提醒你」，它自己的提醒照旧「when and what」）。
- `core/src/assistant_manual.rs`：只改测试。新增 `manual_tells_a_nudge_from_a_to_do`（判法、不是待办的一边、是待办的一边、旧句已删、判法在「Noting a to-do」与「Your own reminders」之间）；`manual_covers_the_users_to_dos` 去掉旧句、`--remind-at` 那条换成新文本；`manual_covers_reminders_and_the_new_hands` 换成「Your own reminders」新的开头。
- 文档：`prompt-composition.md`（手册一节加票 44 一句、待办评测证据加票 44 重跑、回归清单 29 改写）、`runtime-modes-and-sessions.md`（「How Galley keeps them」加一句）。
- 评测 `.scratch/main-chat/entry-layer-eval/`：`run.py`（判定、干跑、结果页抬头）、`schedule/cases.json`、`todo/cases.json`、`README.md`，两套结果整组重跑。

**手册新加的判法**（原文）

```text
When the user asks to be reminded, ask yourself: if they ignored the
reminder, would the thing still need to be on their list?

- No (drink water, turn off the stove, leave the house, get up and
  stretch): it is a nudge, not a to-do. Set your own one-off reminder
  (「半小时后提醒我关火」, see "Your own reminders"); once it has gone off
  there is nothing left to tick.
- Yes (call the landlord back, hand in the report, catch the flight): it
  is a to-do with its reminder at the time they named
  (「明天早上 8 点提醒我给房东回电话」: the call, due that day, reminded at
  8).
```

**入口层没加字**：仍是 2026 字节（空手册路径、不计 `\r`），`core/src/managed_prompt.rs` 一字未改，预算常量与条款台账不动。入口层那句「Note what the user has to do … set yourself a reminder when you promise to follow up」照旧把模型带到手册，喝水、关火两条每遍都先读手册再写（`schedule/results.md` 的「读手册」一列），判法在手册里就够。

**工作台、子任务、IM 的提示词逐字节不变**：`managed_prompt.rs` 没有改动，手册不进任何提示词（只由 `assistant_manual::materialize` 写成文件）。另用临时测试（跑完删掉）导出 `compose_runtime_prompt`（工作台与子任务）、`compose_im_runtime_prompt`、四个渠道的 `im_supervisor_prompt` 与模板、`prompt_hash()`、主对话提示词与入口层字节数，手册改完时导一次、全部改完（评测与文档之后）再导一次，`cmp` 全部相同；hash 是 `7db21acb`，与票 41 改动前后记下的相同，入口层 2026。常设测试照旧（工作台与 IM 不带入口层与手册）。外置运行时没有主对话，零变化。

**评测**（模型 gpt-6.1-sol，即 JC 主对话现在用的：只读查 `sessions.llm_key`，`main_chat = 1` 那行是 `mm_1790734996114`；推理强度 high；2026-10-17 05:50 起跑，两套共 52 次运行、165 次模型调用；每条两遍，一次跑完）

定时（`schedule/results.md`）：

| # | 用例 | 分组 | 遍数 | 过 |
| --- | --- | --- | --- | --- |
| 1 | report-wed「周三下午要交报告」 | 该记待办（只认挂在待办上的提醒） | 2 | 2 |
| 2 | flight-fri「我订了周五早上 7 点的航班」 | 该记待办（同上） | 2 | 2 |
| 3 | logistics-mon「下周一记得帮我看下物流」 | 它自己的提醒 | 2 | 2 |
| 4 | water-10min「十分钟后提醒我喝水」 | 只要提醒（只认 `schedule create`） | 2 | 2 |
| 5 | stove-30min「半小时后提醒我关火」（新） | 只要提醒（同上） | 2 | 2 |
| 6 | guitar | 不该建 | 2 | 2 |
| 7 | tired-meeting | 不该建 | 2 | 2 |
| 8 | daily-news | 该先问 | 2 | 2 |
| 9 | already-set | 已有同一件 | 2 | 2 |
| 10 | no-need | 不用了 | 2 | 2 |
| 11 | move-time | 改时间 | 2 | 2 |
| 12 | wake-on-time | 叫醒按时 | 2 | 2 |
| 13 | wake-late | 叫醒晚到 | 2 | 2 |
| 14 | wake-obsolete | 叫醒已过时 | 2 | 2 |
| | 合计 | | 28 | 28（100%） |

待办（`todo/results.md`）：

| # | 用例 | 分组 | 遍数 | 过 |
| --- | --- | --- | --- | --- |
| 1 | note-report「周三下午 3 点前要交季度报告」 | 该记待办 | 2 | 2 |
| 2 | note-soil「记一下要买营养土」 | 该记待办 | 2 | 2 |
| 3 | note-landlord「明天要给房东回电话」 | 该记待办 | 2 | 2 |
| 4 | remind-landlord-8am「明天早上 8 点提醒我给房东回电话」（新） | 该记待办（提醒在说的 8 点） | 2 | 2 |
| 5 | logistics-mon「下周一帮我看下物流」 | 它自己的提醒 | 2 | 2 |
| 6 | guitar | 不该记 | 2 | 2 |
| 7 | flight-number | 不该记（信息） | 2 | 2 |
| 8 | tick-soil | 勾掉 | 2 | 2 |
| 9 | quote-move | 引用改 | 2 | 2 |
| 10 | whats-left | 先读清单 | 2 | 2 |
| 11 | already-noted | 已有 | 2 | 2 |
| 12 | wake-todo | 待办的提醒到点 | 2 | 2 |
| | 合计 | | 24 | 24（100%） |

- 没有不过的，措辞一轮都没为评测改过（手册是跑之前写定的，跑完没动）。
- 喝水两遍都 `schedule list` 后 `schedule create "提醒用户……喝水……" --at=<十分钟后> --target=assistant --supervisor=galley-assistant`，回复「好，十分钟后提醒你喝水。」；关火两遍都在半小时后，回复带钟点（「设好了，半小时后（06:21）提醒你关火。」）；两条都没碰 `todo`，记下的话写的是到点该说什么。
- 周三交报告两遍都 `todo add "交报告" --due=<周三> --remind-at=<周二>T15:00`；航班两遍都是待办、截止周五 07:00、提醒周四晚 8 点；没有一次给要办完的事用 `schedule create`。
- 「明天早上 8 点提醒我给房东回电话」两遍都 `todo add "给房东回电话" --due=2026-10-18 --remind-at=2026-10-18T08:00`（截止只写日子，提醒就在 8 点），回复「记下了，明天（10 月 18 日）早上 8 点提醒你给房东回电话。」。
- 其余用例与票 41 那轮做法相同（物流是它自己的提醒、带单号；不该记的不记；勾掉、引用改、先读清单、已有的不再记、叫醒照旧）。

**与票面不同、或我加的**

1. **新用例放哪套**：「半小时后提醒我关火」放在定时套件（挨着喝水），「明天早上 8 点提醒我给房东回电话」放在待办套件（挨着「明天要给房东回电话」，那套判定能查标题、截止与提醒各自的窗口）。
2. **判定的写法**：定时套件加 `expect.via: todo`（只认挂在待办上的提醒，`schedule create` 算多余的写命令，待办要正好一件），喝水、关火去掉 `via`（默认只认 `schedule create`，记成待办三条理由都会报：多余的写命令、记成了待办、记了待办）。待办套件加 `expect.reminder.clock`：用户说了几点提醒，提醒就要落在那个钟点（窗口是今天 8 点到明天 8 点，凌晨说的「明天」两天都算，同 note-landlord）。
3. **「已有同一件」没改**：仍是 `via: either`。那条是票 41 之前建的独立提醒（交季度报告），留着它或换成挂在待办上的都算；两遍都只读了 `schedule list` 与 `todo list`，留着原来的提醒，没另记待办。旧数据里这种「要办完的事挂成了独立提醒」，手册没让它主动迁移，见「拿不准」。
4. **说出时间的判法放宽一处**：之前只认钟点或「N 分钟后」，现在也认「半小时」「N 小时」这种相对说法（关火那条需要）；`--dry-test` 里有一条用「半小时后提醒你关火」验它。
5. **手册多改的两处**：`--remind-at` 那条写明「at the time they named」（否则「8 点提醒我」可能按「打电话前半小时」挂在 7:30）；「Your own reminders」的开头加上用户要的提醒（原来只写「without being asked」）。
6. **旧结果没并进 `meta.superseded_runs`**：照票 41 的做法，整组重跑，旧结果在 git 历史（`c3ed1604`），README 写明。

**拿不准、要主会话定的**

1. **旧的独立提醒不迁移**：票 41 之前给「交报告」这类事建的独立提醒，用户再提起时它留着不动（不改成待办）。判错的后果轻，要不要在手册里加「看到这种就换成待办」，等你定。
2. **截止写日子还是写时刻**：「明天早上 8 点提醒我给房东回电话」手册写「due that day」，模型两遍都只写日子，所以 8 点提醒过后这件待办当天不标红；若要写成 8 点截止，改手册一处。

**验收**（分支基于 `43f232f4`；交回报前 main 已到 `bd3f5dbc`（裁决 93、票 45，只改 PRD 与新票，不碰 `core/`、`docs/` 与评测），已变基，下面的 cargo、门禁与干跑是变基后重跑的）

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区与 `TZ=UTC` 各一遍，都是 45 组 `test result: ok`，合计 1128 passed、0 failed（本票新增 1 条）。
- 六个门禁退出码都是 0：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check` 无输出。
- `rustfmt --edition 2021 --check core/src/assistant_manual.rs`：exit 0。
- `run.py --dry-test`：`DRY TEST PASSED`（326 项检查，票 41 是 293），新加的六条：喝水记成待办、交报告建成它自己的提醒、8 点提醒挂到 7:30，判定都抓得出；关火建成它自己的提醒、交报告记成待办挂提醒、8 点提醒挂在 8 点，都算过。
- 公开仓库检查：分支相对 `43f232f4` 的新增行 grep 服务商主机名（从数据库读出、只在内存里比对）、`http`、`api_host`、`apibase`、`api_base`、`apiKey`、`/Users/`、`/private/tmp`、`/var/folders`、本机用户名：0 处；`sk-` 的命中全是 `task-id`，`key` 的命中是模型推理里的英文句子；临时路径都是 `$TMPDIR`，解释器是 `$PYTHON`。
- 中文标点扫新增行（不含评测生成的结果与请求转储）：中文句子 0 处半角标点。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：喝水的提醒卡片落在「Galley 在办」、到点进「已完成」、不占「今天 N」，见回归清单 29。
- 评测里的 CLI 是假的；Windows 没测；消息都是新段第一轮。
