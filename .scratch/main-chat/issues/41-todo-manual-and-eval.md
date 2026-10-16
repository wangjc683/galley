# 41 手册与评测：什么时候记待办、「办好了」去勾、改时间

Status: merged（2026-10-17 快进合入 main，提交 `c3ed1604`、`05a72bf6`；真模型 gpt-6.1-sol：待办 22/22、定时重跑 26/26；「只要提醒、没有可勾的事」记成待办还是独立提醒，待 JC 定）

来源：主聊天 PRD 裁决 91（第 1、3、4 条）。依赖 40（命令名定了）。改 Core 里的手册与提示词、评测；不改界面。照票 36 的做法（手册 `core/src/assistant_manual.rs`，评测 `.scratch/main-chat/entry-layer-eval/` 的 `run.py`）。

## 目标

Galley 分得清「你的事」（记成待办，必要时挂提醒）和「它自己要回头查的事」（定时任务）；你说「办好了」它去勾；你从清单引用一件事说「改到周四」，它改对那一件；回答「我还有什么没办」之前先读清单。

## 一、手册

在票 36 的「提醒与定时」一节里改写（措辞你写，照手册语气与长度）：

- **你的事记成待办**：你提到你要做、带时间或没带时间的事（交报告、回房东电话、买营养土），记成一件待办；有时间的按分量定提前量挂提醒，当场一句话说清记了什么、几点提醒；没时间的只记下、不提醒。
- **它自己的事用定时任务**：它答应回头查的（物流、审核、回信）照票 36，`schedule create --target=assistant`。
- **不建的**：照票 36（没有可办的事、你说不用、已经有的：先 `todo list`）。信息（地址、航班号）不记成待办，那是记忆。
- **勾掉**：你说办好了、或它亲眼看到办完了（比如它替你办成的事），`todo done`；说一句「已勾掉」即可，不复述清单。
- **「说说这件」引用**：你从清单引用一件事接着说（引用块里是这件事的标题），按标题找到那件（`todo list`），照你的话改；找不到或有歧义就问。
- **回答「还有什么没办」**：先 `todo list` 读最新的，不靠段首的「在办的事」快照。
- **清单上你只能勾掉、取消勾、取消提醒**；其余都由它改，所以你要改什么、它就去改，不让你自己去点。
- 不主动建议、不后台整理（裁决 4、91 第 1 条）；你开口要它「整理最近聊过的事」，它翻历史当面整理成待办，先给清单再建。

入口层只加最少的字（指到手册的这一节），预算与条款台账照 `docs/managed-ga-runtime/prompt-composition.md`。工作台、子任务、IM 的提示词逐字节不变（断言）。

## 二、评测

在 `.scratch/main-chat/entry-layer-eval/` 加一组 `todo` 用例（照票 36 的 `schedule` 套件）：

- 该记待办：「周三下午 3 点前要交季度报告」（有截止、挂提醒）、「记一下要买营养土」（没时间、不提醒）、「明天要给房东回电话」。
- 该用定时任务、不是待办：「下周一帮我看下物流」。
- 不该记：「我最近想学吉他」、「我的航班号是 MU5101」（信息）。
- 勾掉：在「在办的事」里已有「买营养土」时说「营养土买好了」。
- 引用改：输入框带引用块「交季度报告」，说「改到周四」。
- 问「我还有什么没办」：先读清单。
- 判定看发出的命令（拦截）与回复。模型用 JC 主对话现在的那个（只读查库），每条跑多次，标准照票 30。**结果与日志里不许出现服务商域名、接口地址、key、本机路径。**

## 验收

- Rust 测试：手册含新内容；工作台、子任务、IM 提示词逐字节不变；预算测试。
- 评测通过率表在 Comments。
- `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区、`TZ=UTC`）、六个门禁、`git diff --check`、中文标点扫新增行。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-todo-manual`）

**改了哪些文件**

- `docs/managed-ga-runtime/galley-assistant-manual.md`：票 36 的「Reminders and scheduled tasks」改写成「To-dos and reminders」，分五小节：Times（本地时间、相对时间先看钟、一天能指两个日期时取还没过的那个，待办与提醒共用）、Noting a to-do、Changing a to-do, ticking it off, what is left、Your own reminders（票 36 的规则，只管它自己的）、When one comes due（加一句：待办的提醒只提醒，不替用户勾）。开头两段说清两张单子各是什么、清单上用户只能勾掉 / 取消勾 / 取消提醒、其余跟它说、信息归记忆、不主动建议不后台整理、开口要整理时先给清单再记。另外：「自己做」一级加「记下、改、勾掉、取消待办和它们的提醒」，撤销加 `todo reopen`，命令清单加 `todo` 的读与写，开头与「Who you are」各改一句。
- `core/src/managed_prompt.rs`：入口层那段改写（见下），写命令清单加 `to-do`；预算 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 1920 → 2026，理由写在常量注释与条款台账；`main_chat_entry_layer_asks_for_reminders_unasked` 改成新文本（含工作台与 IM 不带这些字），读手册那条测试跟着改。
- `core/src/assistant_manual.rs`：只改测试。命令拼写加 `todo` 一族与 `todo add` 整行；票 36 那条改成新节的标题与片段；新增 `manual_covers_the_users_to_dos`（票面每一条各一个单行片段）。
- 文档：`prompt-composition.md`（入口层一节、手册一节、预算、待办评测证据、条款台账一行、回归清单 28、29、31 改写并新增 35–39；顺手把第 30 票时的写命令清单引文改成现在的）、`runtime-modes-and-sessions.md`（待办一节加「Galley 怎么记」）、`managed-ga-runtime/README.md` 与 `docs/README.md` 各一处路由文字。
- 评测 `.scratch/main-chat/entry-layer-eval/`：`run.py`（假 CLI 加 `todo` 命令族；「In Hand」与叫醒措辞的 Python 移植改成票 39 的三组与待办那一段；`--suite todo`；判定与渲染；干跑；结果里的解释器路径脱敏）、`README.md`（定时一节的重跑、新的待办一节、安全措施一条）、`schedule/`（三份输入重新写出、`cases.json` 的判定按待办改、结果整组重跑）、`todo/`（新）。

**入口层**

原来那段（215 字节）：

```text
When the user mentions something with a date or time (a deadline, a
meeting, a flight, a payment), or you promise to follow up, set a reminder
without being asked: see "Reminders and scheduled tasks" in your manual.
```

换成（314 字节，+99）：

```text
Note what the user has to do (a deadline, a call, a flight, a purchase) as
a to-do, with a reminder when it has a date, and tick it off when it is
done; set yourself a reminder when you promise to follow up. Do it unasked,
and read `todo list` before saying what is left: see "To-dos and
reminders" in your manual.
```

读手册那句的清单「(a session, project, model or schedule command)」改成「(a session, project, model, schedule or to-do command)」（+7）。入口层合计 1920 → 2026 字节（空手册路径、不计 `\r`，无余量）。比「只指到手册」多写了三个动作：记下、勾掉、先读清单，因为这三件都从一句没有写命令影子的话开始（「记一下要买营养土」「营养土买好了」「我还有什么没办」），入口层不提，模型不会去翻手册；票 36 那句对「周三下午要交报告」也是同一个理由。

**工作台、子任务、IM 的提示词逐字节不变**：改动前（`c6db8edd`）后各用临时测试导出 `compose_runtime_prompt`（工作台与子任务）、`compose_im_runtime_prompt`、四个渠道的 `im_supervisor_prompt` 与模板、`prompt_hash()`，`cmp` 全部相同（hash 前后都是 `7db21acb`），临时测试已删。常设测试里，`main_chat_section_names_the_conversation_and_its_segment` 断言主对话 = 工作台（换一段配置）+ Main Chat 一节 + 入口层；新改的测试断言工作台与 IM 不带「set yourself a reminder」「`todo list`」。外置运行时没有主对话，零变化。

**评测**（模型 gpt-6.1-sol，即 JC 主对话现在用的：只读查 `sessions.llm_key`，`main_chat = 1` 那行是 `mm_1790734996114`；推理强度 high；2026-10-17 凌晨跑，两套共 48 次运行、146 次模型调用）

待办（`todo/results.md`）：

| # | 用例 | 分组 | 遍数 | 过 |
| --- | --- | --- | --- | --- |
| 1 | note-report「周三下午 3 点前要交季度报告」 | 该记待办 | 2 | 2 |
| 2 | note-soil「记一下要买营养土」 | 该记待办 | 2 | 2 |
| 3 | note-landlord「明天要给房东回电话」 | 该记待办 | 2 | 2 |
| 4 | logistics-mon「下周一帮我看下物流」 | 它自己的提醒 | 2 | 2 |
| 5 | guitar「我最近想学吉他」 | 不该记 | 2 | 2 |
| 6 | flight-number「我的航班号是 MU5101」 | 不该记（信息） | 2 | 2 |
| 7 | tick-soil「营养土买好了」 | 勾掉 | 2 | 2 |
| 8 | quote-move 引用「交季度报告」+「改到周四」 | 引用改 | 2 | 2 |
| 9 | whats-left「我还有什么没办」 | 先读清单 | 2 | 2 |
| 10 | already-noted 清单上已有同一件（加的） | 已有 | 2 | 2 |
| 11 | wake-todo 待办的提醒到点（加的） | 叫醒 | 2 | 2 |
| | 合计 | | 22 | 22（100%） |

定时（票 36 的套件重跑，`schedule/results.md`）：

| # | 用例 | 分组 | 遍数 | 过 |
| --- | --- | --- | --- | --- |
| 1 | report-wed「周三下午要交报告」 | 该建 | 2 | 2 |
| 2 | flight-fri「我订了周五早上 7 点的航班」 | 该建 | 2 | 2 |
| 3 | logistics-mon「下周一记得帮我看下物流」 | 该建 | 2 | 2 |
| 4 | water-10min「十分钟后提醒我喝水」 | 该建 | 2 | 2 |
| 5 | guitar | 不该建 | 2 | 2 |
| 6 | tired-meeting | 不该建 | 2 | 2 |
| 7 | daily-news | 该先问 | 2 | 2 |
| 8 | already-set | 已有同一件 | 2 | 2 |
| 9 | no-need | 不用了 | 2 | 2 |
| 10 | move-time | 改时间 | 2 | 2 |
| 11 | wake-on-time | 叫醒按时 | 2 | 2 |
| 12 | wake-late | 叫醒晚到 | 2 | 2 |
| 13 | wake-obsolete | 叫醒已过时 | 2 | 2 |
| | 合计 | | 26 | 26（100%） |

- 没有不过的，措辞一轮都没为评测调过；先每条一遍（11 过 11），再补第 2 遍，同时整组重跑定时套件。
- 待办：记下时都先读手册、先 `todo list`、每条写命令带 `--supervisor=galley-assistant`，用户的事一次也没用 `schedule create`；季度报告截止周三 15:00、提醒前一天，营养土不写截止不挂提醒，房东按日历上的明天（10-18）记并在回复里点明日期；物流两遍都是它自己的 `schedule create … --target=assistant`、带单号、没记成待办；航班号没记（两遍都先查了历史再问哪天出发）；勾掉回复「已勾掉。」，不复述清单；引用改到周四 15:00，提醒顺延到周四 12:00，没新建；问还有什么没办先读清单，没提面板上勾掉的营养土，提到了这一段刚记、不在快照里的续签合同；已有的只读了清单、说出中午 12 点提醒；待办的提醒到点一两句提醒，没勾掉。
- 定时：周三交报告、周五航班、十分钟后喝水三条都记成待办并挂提醒（判定按「挂在待办上也算」）；物流照旧是它自己的提醒；已有的独立提醒两遍都只读、没再挂；不用了、改到 9 点照旧走 `schedule delete / update`；叫醒三条照旧。

**与票面不同、或我加的**

1. **节名改成「To-dos and reminders」**：票面说在票 36 那一节里改写；待办成了这一节的主角，入口层指的就是这个名字，所以连名字一起改，入口层、手册内部两处引用、测试与文档跟着改。
2. **「提醒我……」也记成待办**：票面把「你的事」与「它自己要回头查的事」二分，「十分钟后提醒我喝水」这种只要求提醒的没提。手册照裁决 91 第 7 条（提醒挂在待办上；Galley 自己回头查的仍是定时任务）写成二分：用户要被提醒的事也是一件待办、挂提醒。见「拿不准」第 1 条。
3. **入口层不止「指到手册」**：多写了三个动作与 `todo list`，理由见上。
4. **加了两条用例**：清单上已有同一件（票面「已经有的：先 `todo list`」）、待办的提醒到点（票 39 新写的叫醒措辞，此前没上过真模型）。
5. **定时套件的判定跟着改**：周三交报告、周五航班、十分钟后喝水，提醒挂在待办上也算；物流只认 `schedule create`；「已有同一件」允许留着或换成挂在待办上的一个、可以另记不带提醒的待办，再挂第二个算不过。其余不变。
6. **票 36 的旧结果没并进 `superseded_runs`**：整组换了文本重跑，66 万字节的旧结果留在 git 历史（`3e22b3e8`），README 写明。
7. **两套共用一份输入**：`schedule/` 下的提示词、CLI 帮助、Rust 样本由临时测试与开发版二进制重新写出（`--help` 与参数错误的原文用开发版二进制在假 HOME 下抓，参数错误那几条另设临时 `TMPDIR`，都不连 Core），待办套件直接用，不另存一份。
8. **结果脱敏多一条**：之前的结果里留着跑 worker 的解释器的绝对路径，`scrub` 现在把它写成 `$PYTHON`、安装目录写成 `$PYTHON_ROOT`；之前提交的其他套件结果没动。

**拿不准、要主会话定的**

1. **一次性提醒记成待办的代价**：「十分钟后提醒我喝水」两遍都记成待办「喝水」、截止与提醒都在十分钟后。提醒响过之后这件待办还开着，过点标红、算进「今天 N」，直到用户勾掉或说喝了（手册写明提醒只提醒、不替用户勾）。另一案：只要求提醒、响过就没事的，用它自己的独立提醒（落在「Galley 在办」，响过进「已完成」），代价是手册多一条要它判断的规则。评测两条路都算过，没替你选。
2. **凌晨说的「明天」**：评测 01:30 跑，模型两遍都按日历上的明天记，并在回复里点明日期，用户可以纠正；手册「一天能指两个日期」那条没覆盖这种（两天都没过）。没加规则。
3. **「整理最近聊过的事」**写进了手册，没评测（要造跨段历史与搜索的固定数据）。

**验收**（分支基于 `c6db8edd`；交回报前 main 已到 `0ab8e009`（票 42 合入、票 43 立票，都不碰 `core/` 与 `cli/`），已变基，下面是变基后重跑的）

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区与 `TZ=UTC` 各一遍，都是 45 组 `test result: ok`，合计 1125 passed、0 failed（票 40 是 1124，本票新增 1 条）。
- 六个门禁退出码都是 0：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check`（main 到分支与工作区）无输出。
- `rustfmt --edition 2021 --check core/src/managed_prompt.rs core/src/assistant_manual.rs`：exit 0（两个文件在 base 都是干净的）。
- 公开仓库检查：新增行与评测结果 grep `http`、`api_host`、`apibase`、`key`、`/Users/`、`/private/tmp`、`/var/folders`、用户名与域名：只有项目主页、`example.com`（产品提示词里本来就有）、`dry.invalid`（干跑的假地址）与代码里的变量名；临时路径都是 `$TMPDIR`，解释器是 `$PYTHON`。
- 中文标点扫新增行（不含评测生成的结果与提示词副本）：中文句子 0 处；32 处是英文句子里夹中文引语（手册、提示词、文档、测试注释，及本回报照抄的一段英文提示词），用英文标点，不改。
- 票面要的 Rust 测试：手册含新内容（`manual_covers_the_users_to_dos`、改过的 `manual_covers_reminders_and_the_new_hands`、命令拼写）；工作台、子任务、IM 提示词逐字节不变（临时导出 `cmp`，常设的结构断言与新加的不含断言）；入口层预算（`main_chat_entry_layer_stays_within_budget`，2026 无余量）。
- `run.py --dry-test`（变基后、最终的 `run.py`）：`DRY TEST PASSED`（293 项检查），含新的待办路径：Python 移植逐字对上 Rust 的四组「In Hand」与六组叫醒（含两条待办的提醒）；「In Hand」是快照（面板上勾掉的仍在、这一段刚记的不在）；假 CLI 的 `todo` 命令族照真实 CLI 与 Core 拒绝与改状态（空 `--due=`、坏日期、过去的 `--remind-at`、空标题、`update` 什么都没给、`--due` 与 `--no-due` 同给、未知 id、做完的挂提醒、取消两次），勾掉与取消会取消提醒，`--all` 与 `schedule list` 里的待办提醒；判定抓得出没勾、多记、动了不该动的、多余的写命令。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：卡片、面板、「说说这件」真把标题引进输入框后的那一轮；JC 要试的见回归清单 28、29、35–39。
- 评测里的 CLI 是假的（照 Agent API 与真实 CLI 的校验写的）；Windows 没测；消息都是新段第一轮或很短的历史，长对话里会不会漏记没测。
