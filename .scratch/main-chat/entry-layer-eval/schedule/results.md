# 定时与提醒评测结果（票 36，票 44、票 59、票 60、票 63 重跑）

模型：gpt-6.1-sol（Galley 托管模型 mm_1790734996114，从 Galley 数据库只读取得，即 JC 主对话现在用的模型），推理强度 high；首次运行于 2026-10-17 05:50。

- **提示词**：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（`galley-prompt/`）：票 41 改过的入口层、主对话自己的「What Only The User Changes」一段；用例里分段开始前就有的定时任务照 `in_hand_section` 的格式（票 39 的三组）写进「In Hand」一节（`run.py` 的 `in_hand_block`，干跑测试逐字对过 Rust 的输出）。手册是仓库里的 `docs/managed-ga-runtime/galley-assistant-manual/`（票 59 起按部分拆成八个文件，入口层列出每个文件什么时候读；之前是单个文件，票 44 改过的「To-dos and reminders」），整套放在这次运行状态根下 Core 写它的位置（`assistant/reference/manual/`）。
- **票 41 的改动**：用户自己的事带时间的，提醒可以挂在待办上（`todo add --remind-at`）；物流这种它自己回头查的只认 `schedule create`。假 CLI 多了 `todo` 命令族。
- **票 44 的改动**（主对话 PRD 裁决 92）：要办完的事（交报告、航班，`via: todo`）只认挂在待办上的提醒，建成它自己的提醒算错；只要提醒一下、没有要办完的事（喝水、关火）只认 `schedule create`，记成待办算错。「已有同一件」照票 41（`via: either`）。加了「半小时后提醒我关火」。
- **新消息**：用户这句；叫醒用例是照 Core 措辞（`subtask_report::report_text`，同样逐字对过）拼出的叫醒消息。
- **工具**：`code_run` 与文件工具在每次运行自己的 macOS 沙盒里真的执行（同票 30 的沙盒，另允许 `date`）；Galley CLI 是假的：`schedule` 命令族按 Agent API §5.20–§5.27 的形状回答、照真实 CLI 校验参数（过去的时刻报 `time_in_past:`，`--target` 默认 `session`），票 35 的手（改名、置顶、删除、项目、默认模型）也接着；`--help` 是真实 CLI 的原文。每次调用都记下，写命令只改假 CLI 自己的状态。每次运行最多 10 次工具调用。
- **判定**：按 `cases.json` 每条的 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复里有没有说出时间。每条都查：`schedule create` 带没带 `--target=assistant`，`schedule` 写命令带没带 `--supervisor=galley-assistant`。

注 1：票 59：手册按部分拆开。被替换的 28 次运行原样留在 results.json 的 `meta.superseded_runs[0]` 里。

注 2：票 59 第一轮：入口层第一版措辞下的结果（之后补了每次写都带的身份参数、改它自己的提醒读 reminders.md、要读的部分一起读）。被替换的 28 次运行原样留在 results.json 的 `meta.superseded_runs[1]` 里。

注 3：票 59 补跑：「不用了」第 2 遍删对了那一个、带着身份参数，但话只写进了 <summary>，回复正文是空的（票 36 见过的同一种随机失误），同一条补跑一遍。被替换的 1 次运行原样留在 results.json 的 `meta.superseded_runs[2]` 里。

注 4：票 60：手册（todos.md、reminders.md、todos-change.md）与入口层的待办那一段改了，整组重跑；这一组是票 59 重跑后的结果。被替换的 28 次运行原样留在 results.json 的 `meta.superseded_runs[3]` 里。

注 5：票 63：Core 的叫醒说明（它自己的提醒、待办的提醒）改成说此刻有用的话，手册的「When one comes due」挪进 wake.md，入口层加了「没写下就不说记下了」，提示词与 Rust 样本重新生成。被替换的 28 次运行原样留在 results.json 的 `meta.superseded_runs[4]` 里。

注 6：票 63 补跑：「不用了」第 2 遍删对了那一个、带着身份参数，但话只写进了 <summary>，回复正文是空的（票 36、票 59 见过的随机失误）。被替换的 1 次运行原样留在 results.json 的 `meta.superseded_runs[5]` 里。

## 票 63 重跑（2026-10-19，gpt-6.1-sol，推理强度 high）

上一次是这一套最近一次的结果（叫醒是票 59，待办、定时、闲聊是票 60），这一次是票 63 改了 Core 的叫醒说明、手册（「When one comes due」挪进 `wake.md`，`todos.md` 的第③条与提醒时间）与入口层（没写下就不说「记下了」）之后。只比两次都有的用例；两次都用现在的判定重判（票 63 起每条都判「说了记下了，这一轮就得有写」）。请求次数是每次运行的模型调用数（GA 的轮数），用时是整次运行的墙钟时间；读手册的字节是返回给模型的工具结果的字节数，「轮」是读手册的那几次落在几个模型轮次里（一轮里并发读几份算一轮）。

| | 运行 | 过 | 请求次数（均） | 用时 s（均） | 读手册次数（均） | 读手册轮数（均） | 读手册字节（均） | 读过的部分（次数） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 上一次 | 28 | 28 | 3.11 | 24.6 | 1.04 | 1.00 | 9120 | reminders.md 21、times.md 19、todos-change.md 16、todos.md 16、wake.md 6、subtasks.md 5 |
| 这一次 | 28 | 28 | 3.07 | 25.1 | 1.04 | 1.04 | 8733 | reminders.md 20、times.md 19、todos.md 16、todos-change.md 14、wake.md 6、subtasks.md 5、cli.md 1 |

| # | 用例 | 写 | 过 | 请求次数 | 用时 s | 读手册：上一次 | 读手册：这一次 | 标记 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | report-wed | 是 | 2/2 → 2/2 | 4.5 → 4.0 | 34 → 34 | 2.0 次 2.0 轮，13215 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 | 2.0 次 2.0 轮，14462 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2、cli.md 1 |  |
| 2 | flight-fri | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 36 → 37 | 1.5 次 1.5 轮，13150 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 | 2.0 次 2.0 轮，12742 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 3 | logistics-mon | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 32 → 33 | 1.0 次 1.0 轮，12270 字节：reminders.md 2、times.md 2、todos.md 2、todos-change.md 1 | 1.0 次 1.0 轮，10822 字节：reminders.md 2、times.md 2、todos.md 2 |  |
| 4 | water-10min | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 29 → 28 | 1.0 次 1.0 轮，8373 字节：reminders.md 2、times.md 2、todos.md 1 | 1.0 次 1.0 轮，4446 字节：reminders.md 2、times.md 2 |  |
| 5 | stove-30min | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 28 → 31 | 1.5 次 1.5 轮，12308 字节：reminders.md 2、times.md 2、todos.md 2、todos-change.md 1 | 1.0 次 1.0 轮，10820 字节：reminders.md 2、times.md 2、todos.md 2 |  |
| 6 | guitar | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 9 → 12 | 没读 | 没读 |  |
| 7 | tired-meeting | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 11 → 10 | 没读 | 没读 |  |
| 8 | daily-news | 否 | 2/2 → 2/2 | 2.0 → 2.5 | 18 → 23 | 1.0 次 1.0 轮，8538 字节：reminders.md 2、times.md 2、todos.md 1 | 1.0 次 1.0 轮，7658 字节：reminders.md 2、times.md 2、todos.md 1 |  |
| 9 | already-set | 否 | 2/2 → 2/2 | 3.0 → 3.0 | 25 → 23 | 1.5 次 1.0 轮，6836 字节：reminders.md 2、todos-change.md 2、times.md 1 | 1.5 次 1.5 轮，12949 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 10 | no-need | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 33 → 33 | 1.0 次 1.0 轮，13105 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 | 1.0 次 1.0 轮，12556 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 11 | move-time | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 29 → 31 | 1.0 次 1.0 轮，13086 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 | 1.0 次 1.0 轮，12544 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 12 | wake-on-time | 否 | 2/2 → 2/2 | 2.0 → 2.0 | 16 → 15 | 1.0 次 1.0 轮，3588 字节：subtasks.md 2、wake.md 2 | 1.0 次 1.0 轮，3548 字节：wake.md 2、subtasks.md 1 |  |
| 13 | wake-late | 否 | 2/2 → 2/2 | 3.0 → 3.0 | 26 → 25 | 1.0 次 1.0 轮，6985 字节：todos-change.md 2、wake.md 2、reminders.md 1、subtasks.md 1、times.md 1 | 1.0 次 1.0 轮，6306 字节：subtasks.md 2、todos-change.md 2、wake.md 2 |  |
| 14 | wake-obsolete | 否 | 2/2 → 2/2 | 3.0 → 2.5 | 20 → 16 | 1.0 次 1.0 轮，16230 字节：reminders.md 2、subtasks.md 2、todos-change.md 2、todos.md 2、wake.md 2、times.md 1 | 1.0 次 1.0 轮，13412 字节：reminders.md 2、subtasks.md 2、todos-change.md 2、wake.md 2、times.md 1、todos.md 1 |  |

## 票 60 重跑（2026-10-19，gpt-6.1-sol，推理强度 high）

上一次是票 59 重跑之后的结果（手册拆开之后），这一次是票 60 改了手册（`todos.md`、`reminders.md`、`todos-change.md`）与入口层的待办那一段之后。只比两次都有的用例，票 60 新加的用例只有这一次。请求次数是每次运行的模型调用数（GA 的轮数），用时是整次运行的墙钟时间；读手册的字节是返回给模型的工具结果的字节数，「轮」是读手册的那几次落在几个模型轮次里（一轮里并发读几份算一轮）。

| | 运行 | 过 | 请求次数（均） | 用时 s（均） | 读手册次数（均） | 读手册轮数（均） | 读手册字节（均） | 读过的部分（次数） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 上一次 | 28 | 28 | 3.04 | 23.9 | 0.93 | 0.93 | 5946 | times.md 19、reminders.md 18、todos.md 16、todos-change.md 14、wake.md 4、subtasks.md 3 |
| 这一次 | 28 | 28 | 3.11 | 24.6 | 1.04 | 1.00 | 9120 | reminders.md 21、times.md 19、todos-change.md 16、todos.md 16、wake.md 6、subtasks.md 5 |

| # | 用例 | 写 | 过 | 请求次数 | 用时 s | 读手册：上一次 | 读手册：这一次 | 标记 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | report-wed | 是 | 2/2 → 2/2 | 4.0 → 4.5 | 32 → 34 | 1.5 次 1.5 轮，7962 字节：times.md 2、todos-change.md 2、todos.md 2、reminders.md 1 | 2.0 次 2.0 轮，13215 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 2 | flight-fri | 是 | 2/2 → 2/2 | 4.5 → 4.0 | 33 → 36 | 2.0 次 2.0 轮，8030 字节：times.md 2、todos-change.md 2、todos.md 2、reminders.md 1 | 1.5 次 1.5 轮，13150 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 3 | logistics-mon | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 28 → 32 | 1.0 次 1.0 轮，8310 字节：reminders.md 2、times.md 2、todos.md 2 | 1.0 次 1.0 轮，12270 字节：reminders.md 2、times.md 2、todos.md 2、todos-change.md 1 |  |
| 4 | water-10min | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 27 → 29 | 1.0 次 1.0 轮，6330 字节：reminders.md 2、times.md 2、todos.md 1 | 1.0 次 1.0 轮，8373 字节：reminders.md 2、times.md 2、todos.md 1 |  |
| 5 | stove-30min | 是 | 2/2 → 2/2 | 4.5 → 4.0 | 34 → 28 | 1.5 次 1.5 轮，8488 字节：reminders.md 3、times.md 3、todos.md 3 | 1.5 次 1.5 轮，12308 字节：reminders.md 2、times.md 2、todos.md 2、todos-change.md 1 |  |
| 6 | guitar | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 11 → 9 | 没读 | 没读 |  |
| 7 | tired-meeting | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 10 → 11 | 没读 | 没读 |  |
| 8 | daily-news | 否 | 2/2 → 2/2 | 2.0 → 2.0 | 16 → 18 | 1.0 次 1.0 轮，4346 字节：reminders.md 2、times.md 2 | 1.0 次 1.0 轮，8538 字节：reminders.md 2、times.md 2、todos.md 1 |  |
| 9 | already-set | 否 | 2/2 → 2/2 | 3.0 → 3.0 | 26 → 25 | 1.0 次 1.0 轮，7672 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 1 | 1.5 次 1.0 轮，6836 字节：reminders.md 2、todos-change.md 2、times.md 1 |  |
| 10 | no-need | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 31 → 33 | 1.0 次 1.0 轮，9649 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 | 1.0 次 1.0 轮，13105 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 11 | move-time | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 34 → 29 | 1.0 次 1.0 轮，7670 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 1 | 1.0 次 1.0 轮，13086 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 12 | wake-on-time | 否 | 2/2 → 2/2 | 1.0 → 2.0 | 11 → 16 | 没读 | 1.0 次 1.0 轮，3588 字节：subtasks.md 2、wake.md 2 |  |
| 13 | wake-late | 否 | 2/2 → 2/2 | 3.0 → 3.0 | 27 → 26 | 1.0 次 1.0 轮，6016 字节：todos-change.md 2、wake.md 2、subtasks.md 1、todos.md 1 | 1.0 次 1.0 轮，6985 字节：todos-change.md 2、wake.md 2、reminders.md 1、subtasks.md 1、times.md 1 |  |
| 14 | wake-obsolete | 否 | 2/2 → 2/2 | 2.5 → 3.0 | 15 → 20 | 1.0 次 1.0 轮，8768 字节：subtasks.md 2、todos-change.md 2、wake.md 2、reminders.md 1、todos.md 1 | 1.0 次 1.0 轮，16230 字节：reminders.md 2、subtasks.md 2、todos-change.md 2、todos.md 2、wake.md 2、times.md 1 |  |

## 票 59 重跑（2026-10-19，gpt-6.1-sol，推理强度 high）

提示词按票 59 重新生成：除了入口层，还带上了票 41 之后功能地图的改动（「待办」在每个对话的顶栏）。

入口层第一版措辞下 28 次过 24 次：「不用了」两遍的 `schedule delete`、「改到 9 点」一遍的 `schedule update` 没带 `--supervisor=galley-assistant`；「改到 9 点」另一遍只读了改待办的部分，只查了 `todo list`、没看 `schedule list`，另记了一件新待办（入口层把「改」都指到了 `todos-change.md`）。

第一轮改措辞后整组重跑 27 次过，唯一不过的是「不用了」第 2 遍：删对了那一个、带着身份参数，话却只写进了 `<summary>`，回复正文是空的（票 36 见过的同一种随机失误）。同一条补跑一遍过了，最终 28 次全过。第一版措辞的 28 次与被补跑替换的那一次都留在 `meta.superseded_runs` 里。

读手册：一次运行平均 0.93 次、5.9 KB（上一次 0.86 次、10.6 KB）；请求次数 3.04 → 3.04，用时 21.1 → 23.9 秒。喝水、关火这种只要提醒一下的，多数在一轮里读齐 `todos.md`、`reminders.md`、`times.md`。

上一次是被这次替换的运行（整本手册），这一次是按部分拆开之后。请求次数是每次运行的模型调用数（GA 的轮数），用时是整次运行的墙钟时间；读手册的字节是返回给模型的工具结果的字节数，「轮」是读手册的那几次落在几个模型轮次里（一轮里并发读几份算一轮）。

| | 运行 | 过 | 请求次数（均） | 用时 s（均） | 读手册次数（均） | 读手册轮数（均） | 读手册字节（均） | 读过的部分（次数） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 上一次 | 28 | 28 | 3.04 | 21.1 | 0.86 | 0.86 | 10622 | 整本 24 |
| 这一次 | 28 | 28 | 3.04 | 23.9 | 0.93 | 0.93 | 5946 | times.md 19、reminders.md 18、todos.md 16、todos-change.md 14、wake.md 4、subtasks.md 3 |

| # | 用例 | 写 | 过 | 请求次数 | 用时 s | 读手册：上一次 | 读手册：这一次 | 标记 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | report-wed | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 25 → 32 | 1.0 次 1.0 轮，15558 字节：整本 2 | 1.5 次 1.5 轮，7962 字节：times.md 2、todos-change.md 2、todos.md 2、reminders.md 1 |  |
| 2 | flight-fri | 是 | 2/2 → 2/2 | 4.0 → 4.5 | 36 → 33 | 2.0 次 2.0 轮，17158 字节：整本 4 | 2.0 次 2.0 轮，8030 字节：times.md 2、todos-change.md 2、todos.md 2、reminders.md 1 |  |
| 3 | logistics-mon | 是 | 2/2 → 2/2 | 4.5 → 4.0 | 27 → 28 | 1.5 次 1.5 轮，18825 字节：整本 3 | 1.0 次 1.0 轮，8310 字节：reminders.md 2、times.md 2、todos.md 2 |  |
| 4 | water-10min | 是 | 2/2 → 2/2 | 4.5 → 4.0 | 26 → 27 | 1.5 次 1.5 轮，18208 字节：整本 3 | 1.0 次 1.0 轮，6330 字节：reminders.md 2、times.md 2、todos.md 1 |  |
| 5 | stove-30min | 是 | 2/2 → 2/2 | 4.0 → 4.5 | 24 → 34 | 1.0 次 1.0 轮，18364 字节：整本 2 | 1.5 次 1.5 轮，8488 字节：reminders.md 3、times.md 3、todos.md 3 |  |
| 6 | guitar | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 12 → 11 | 没读 | 没读 |  |
| 7 | tired-meeting | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 8 → 10 | 没读 | 没读 |  |
| 8 | daily-news | 否 | 2/2 → 2/2 | 3.5 → 2.0 | 21 → 16 | 2.0 次 2.0 轮，18348 字节：整本 4 | 1.0 次 1.0 轮，4346 字节：reminders.md 2、times.md 2 |  |
| 9 | already-set | 否 | 2/2 → 2/2 | 3.0 → 3.0 | 23 → 26 | 没读 | 1.0 次 1.0 轮，7672 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 1 |  |
| 10 | no-need | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 29 → 31 | 1.5 次 1.5 轮，17556 字节：整本 3 | 1.0 次 1.0 轮，9649 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 2 |  |
| 11 | move-time | 是 | 2/2 → 2/2 | 4.0 → 4.0 | 24 → 34 | 1.0 次 1.0 轮，18336 字节：整本 2 | 1.0 次 1.0 轮，7670 字节：reminders.md 2、times.md 2、todos-change.md 2、todos.md 1 |  |
| 12 | wake-on-time | 否 | 2/2 → 2/2 | 1.0 → 1.0 | 8 → 11 | 没读 | 没读 |  |
| 13 | wake-late | 否 | 2/2 → 2/2 | 2.0 → 3.0 | 17 → 27 | 没读 | 1.0 次 1.0 轮，6016 字节：todos-change.md 2、wake.md 2、subtasks.md 1、todos.md 1 |  |
| 14 | wake-obsolete | 否 | 2/2 → 2/2 | 2.0 → 2.5 | 16 → 15 | 0.5 次 0.5 轮，6360 字节：整本 1 | 1.0 次 1.0 轮，8768 字节：subtasks.md 2、todos-change.md 2、wake.md 2、reminders.md 1、todos.md 1 |  |

## 通过率

| # | 用例 | 分组 | 期望 | 遍数 | 过 | 通过率 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | report-wed | 该记待办 | 提到带时间的事（没说「提醒我」）→ 记成待办并挂提醒，提醒在周三下午之前；票 44 起只认 todo add --remind-at，建成它自己的提醒（schedule create）算错；回复一句话说出时间 | 2 | 2 | 100% |
| 2 | flight-fri | 该记待办 | 订了航班（没说「提醒我」）→ 记成待办并挂提醒，提醒在航班之前；票 44 起只认挂在待办上的提醒；回复说出时间 | 2 | 2 | 100% |
| 3 | logistics-mon | 它自己的提醒 | 要等外部结果的后续 → 建周一它自己的提醒（schedule create，不是待办），记下的话里带上单号（写给到点的自己）；回复说出时间 | 2 | 2 | 100% |
| 4 | water-10min | 只要提醒 | 「十分钟后提醒我喝水」→ 先看现在几点，建十分钟后它自己的一次性提醒（schedule create --target=assistant）；票 44 起记成待办算错；回复说出时间 | 2 | 2 | 100% |
| 5 | stove-30min | 只要提醒 | 「半小时后提醒我关火」（票 44）→ 先看现在几点，建半小时后它自己的一次性提醒（schedule create --target=assistant），不记待办；回复说出时间 | 2 | 2 | 100% |
| 6 | guitar | 不该建 | 没有时间点的事 → 不建，不动任何东西，正常聊 | 2 | 2 | 100% |
| 7 | tired-meeting | 不该建 | 说过去的事 → 不建，不动任何东西，短回复 | 2 | 2 | 100% |
| 8 | daily-news | 该先问 | 重复且每次都要干活（花钱）→ 先在对话里问一句（时间、看什么），不建 | 2 | 2 | 100% |
| 9 | already-set | 已有同一件 | 「在办的事」里已有同一件（票 41 之前建的独立提醒）→ 不再建第二个提醒；留着它，或换成挂在待办上的一个（删旧建新、时间仍在周三下午 3 点前）；可以只记一件不带提醒的待办；回复说已经记着、几点提醒 | 2 | 2 | 100% |
| 10 | no-need | 不用了 | 你说不用了 → schedule delete 那一个（先 schedule list 找 id），不建新的；回复一句确认 | 2 | 2 | 100% |
| 11 | move-time | 改时间 | 「改到 9 点」→ schedule update 那一个到明天 9:00（或删了重建），不留两个；回复说出新时间 | 2 | 2 | 100% |
| 12 | wake-on-time | 叫醒 | 按时叫醒 → 照记下的话一两句提醒（带身份证、几点出门），不说晚了，不出 <no-reply/> | 2 | 2 | 100% |
| 13 | wake-late | 叫醒 | 晚了 9 小时（电脑睡着）→ 照实说晚了多久，再说事情（给王经理回电话） | 2 | 2 | 100% |
| 14 | wake-obsolete | 叫醒 | 事情已经办了（前面用户说过快递拿了）→ 回复只有 <no-reply/>，不动任何东西 | 2 | 2 | 100% |
| | 合计 | | | 28 | 28 | 100% |

## 一览

| # | 用例 | 遍 | 调了什么命令 | 回复原文 | 字数 | 读手册 | 建前查过 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | report-wed | 1 | todo list；todo add 交报告 --due=2026-10-21 --remind-at=2026-10-20T17:00 --notes=周三下午要交报告，具体截止时刻未说明。 --supervisor=galley-assistant --reason=用户提到周三下午要交报告，记录待办并提前一天提醒准备。 | 记下了：周三（10 月 21 日）下午交报告，周二下午 5 点提醒你提前准备。 | 39 | 读了（第 1 次调用）：todos.md、reminders.md、times.md、todos-change.md；2 次 2 轮，12677 字节 | 查了 | 过 |
| 1 | report-wed | 2 | todo list；todo add 交报告 --due=2026-10-21 --remind-at=2026-10-20T18:00 --notes=周三（10月21日）下午要交报告，具体截止时刻未指定。提前一天傍晚提醒准备。 --supervisor=galley-assistant --reason=用户提到周三下午交报告，记为待办并提前提醒 | 记下了：周三（10月21日）下午交报告，周二傍晚6点提醒你提前准备。 | 34 | 读了（第 1 次调用）：todos.md、reminders.md、times.md、cli.md、todos-change.md；2 次 2 轮，16247 字节 | 查了 | 过 |
| 2 | flight-fri | 1 | todo list；todo add 赶周五早上 7 点的航班 --due=2026-10-23T07:00 --remind-at=2026-10-22T20:00 --notes=周五（2026年10月23日）早上7点起飞。前一晚提醒检查证件、行李和值机，安排去机场的交通。机场、航班号及出发地点尚未提供。 --supervisor=galley-assistant --reason=用户已订周五早班机，记录赶飞机待办并提前一晚提醒准备 | 记下了：这周五（10 月 23 日）早上 7 点的航班。我会在周四晚 8 点提醒你检查证件、行李和值机，提前安排去机场的交通。 | 63 | 读了（第 1 次调用）：todos.md、times.md、reminders.md、todos-change.md；2 次 2 轮，12663 字节 | 查了 | 过 |
| 2 | flight-fri | 2 | todo list；todo list；todo add 赶周五早上 7 点的航班 --due=2026-10-23T07:00 --remind-at=2026-10-22T20:00 --notes=已订周五早上7点航班；周四晚提醒准备证件、行李并确认去机场的交通。航班号和机场未提供。 --supervisor=galley-assistant --reason=用户已订周五早班机，记录赶航班待办并提前一晚提醒准备 | 记下了：10 月 23 日（周五）早上 7 点的航班。早班机要提前准备，我会在周四晚 8 点提醒你检查证件、行李和去机场的交通。 | 64 | 读了（第 1 次调用）：todos.md、times.md、reminders.md、todos-change.md；2 次 2 轮，12821 字节 | 查了 | 过 |
| 3 | logistics-mon | 1 | schedule list；schedule list；schedule create 用户在京东买了一台显示器，单号 JD8812345678，商家称2026年10月26日（周一）前能到。用户要求下周一帮忙查看物流。请使用浏览器查看该单物流和预计送达情况，并在主会话 s-…9w0e 告知用户；若需登录或验证，请请用户协助，不要编造物流状态。 --at=2026-10-26T10:00 --target=assistant --supervisor=galley-assistant --re… | 设好了，下周一（10月26日）上午10点，我帮你查显示器的物流，单号 JD8812345678。 | 48 | 读了（第 1 次调用）：todos.md、reminders.md、times.md；1 次 1 轮，10823 字节 | 查了 | 过 |
| 3 | logistics-mon | 2 | schedule list；schedule create 用户在京东购买显示器，物流单号 JD8812345678，商家说下周一前能到。用户要求下周一帮忙查看物流。现在请通过 Browser Control 查询该单最新物流与是否送达，并在主聊天 s-…9w0e 告知用户真实结果；若查询需要登录或验证，请明确说明并请用户配合，不要编造物流状态。 --at=2026-10-26T10:00 --target=assistant --supervisor=galle…；schedule list | 记下了：下周一（10月26日）上午10点，我会帮你查京东显示器这单 **JD8812345678** 的物流，再告诉你进展。 | 62 | 读了（第 1 次调用）：todos.md、reminders.md、times.md；1 次 1 轮，10821 字节 | 查了 | 过 |
| 4 | water-10min | 1 | schedule list；schedule create 提醒用户喝水。用户在主聊天要求十分钟后提醒喝水；到时直接用中文提醒：该喝水啦。 --at=2026-10-19T20:35 --target=assistant --supervisor=galley-assistant --reason=用户要求十分钟后提醒喝水 | 好的，十分钟后（20:35）提醒你喝水。 | 20 | 读了（第 1 次调用）：reminders.md、times.md；1 次 1 轮，4444 字节 | 查了 | 过 |
| 4 | water-10min | 2 | schedule list；schedule create 提醒用户：该喝水了。用户要求十分钟后提醒喝水，请在主聊天中简短提醒。 --at=2026-10-19T20:35:01 --target=assistant --supervisor=galley-assistant --reason=用户要求十分钟后提醒喝水 | 好的，十分钟后（20:35）提醒你喝水。 | 20 | 读了（第 1 次调用）：reminders.md、times.md；1 次 1 轮，4449 字节 | 查了 | 过 |
| 5 | stove-30min | 1 | schedule list；schedule create 提醒用户：时间到了，请现在关火，确认炉灶已关闭。用户在主聊天要求半小时后提醒关火。 --at=2026-10-19T20:55 --target=assistant --supervisor=galley-assistant --reason=用户要求半小时后提醒关火 | 好的，半小时后（20:55）提醒你关火。 | 20 | 读了（第 1 次调用）：reminders.md、times.md、todos.md；1 次 1 轮，10821 字节 | 查了 | 过 |
| 5 | stove-30min | 2 | schedule list；schedule create 提醒用户：时间到了，请关火。用户在主聊天 s-…9w0e 请求半小时后提醒关火。 --at=2026-10-19T20:55 --target=assistant --supervisor=galley-assistant --reason=用户要求半小时后提醒关火 | 好的，半小时后（20:55）提醒你关火。 | 20 | 读了（第 1 次调用）：reminders.md、times.md、todos.md；1 次 1 轮，10819 字节 | 查了 | 过 |
| 6 | guitar | 1 | — | 挺好啊！有没有哪首歌，让你特别想自己拿吉他弹出来？有首喜欢的歌当目标，练起来会更有劲，不必一上来就啃乐理。 ⏎ 你现在手边有吉他，还是刚开始动这个念头？ | 75 | 没读（没写） | — | 过 |
| 6 | guitar | 2 | — | 可以呀，学会几组常用和弦，就能慢慢弹唱喜欢的歌，不用一开始就啃很多乐理。 ⏎ 你更想**边弹边唱**，还是喜欢**电吉他的乐队、摇滚音色**？手里已经有琴了吗？没买也不用急，先看你想玩哪种。 | 94 | 没读（没写） | — | 过 |
| 7 | tired-meeting | 1 | — | 辛苦了。是会开得太久，还是有些事聊得特别费心？ | 23 | 没读（没写） | — | 过 |
| 7 | tired-meeting | 2 | — | 辛苦了，开会有时候真比埋头干活还耗神。是开得太久，还是会上有些事让你心累？ | 37 | 没读（没写） | — | 过 |
| 8 | daily-news | 1 | schedule list | 每天早上 **8 点**（按电脑本地时间），帮你查阅当天的国内外要闻，整理成 **5 条简报，附来源链接**；每天运行会产生相应的模型费用，这样安排可以吗？ | 78 | 读了（第 1 次调用）：reminders.md、times.md、todos.md；1 次 1 轮，10884 字节 | — | 过 |
| 8 | daily-news | 2 | — | 每天早上 **8 点**（按你电脑的本地时间），我查阅当天新闻，整理 **5 条国内外要闻，附简短摘要和来源链接**发给你；这会每天产生模型调用费用，可以吗？ | 79 | 读了（第 1 次调用）：reminders.md、times.md；1 次 1 轮，4432 字节 | — | 过 |
| 9 | already-set | 1 | schedule list | 已经有提醒了：周三（10 月 21 日）上午 10 点提醒你，下午 3 点前把季度报告交给王经理。 | 49 | 读了（第 1 次调用）：reminders.md、times.md、todos.md、todos-change.md；2 次 2 轮，13361 字节 | — | 过 |
| 9 | already-set | 2 | todo list；schedule list | 这件事已经设好提醒了：**10 月 21 日（周三）上午 10 点**提醒你，下午 3 点前把季度报告交给王经理。 | 57 | 读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12537 字节 | — | 过 |
| 10 | no-need | 1 | todo list；schedule list；schedule delete sched_2d8e5a1c9f0b7364 --supervisor=galley-assistant --reason=用户已给妈妈打过电话，要求取消周日提醒；schedule list | 周日晚上 9 点不会再提醒你给妈妈打电话了。 | 22 | 读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12533 字节 | — | 过 |
| 10 | no-need | 2 | todo list；schedule list；schedule delete sched_2d8e5a1c9f0b7364 --supervisor=galley-assistant --reason=用户已给妈妈打过电话，要求取消周日晚上9点的提醒；schedule list | 好，周日晚上 9 点给妈妈打电话的提醒已取消。 | 23 | 读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12580 字节 | — | 过 |
| 11 | move-time | 1 | todo list；schedule list；schedule update sched_9a4b2c7e1d0f5836 --at=2026-10-20T09:00 --supervisor=galley-assistant --reason=用户要求将给房东转房租的提醒从明天上午10点改到9点；schedule list | 已改到明天（10 月 20 日）上午 9 点，提醒你给房东转房租。 | 33 | 读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12552 字节 | — | 过 |
| 11 | move-time | 2 | todo list；schedule list；schedule update sched_9a4b2c7e1d0f5836 --at=2026-10-20T09:00 --supervisor=galley-assistant --reason=用户要求将给房东转房租的提醒从明早10点改到9点；schedule list | 已改到明天（10 月 20 日）上午 9 点，提醒你给房东转房租。 | 33 | 读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12535 字节 | — | 过 |
| 12 | wake-on-time | 1 | — | 明早 8:05 要在虹桥站坐 G7 去北京，今晚先收好行李，把身份证放进随身包，睡前设好闹钟。明早记得 **7 点前出门**，给进站安检留些余量。 | 73 | 读了（第 1 次调用）：wake.md、subtasks.md；1 次 1 轮，4513 字节 | — | 过 |
| 12 | wake-on-time | 2 | — | 明早要赶 8:05 从虹桥站出发去北京的 G7，今晚先收好行李，把身份证放进随身包，免得早上忙乱。明早记得 7 点前出门，给进站安检留足时间，今晚早点休息。 | 78 | 读了（第 1 次调用）：wake.md；1 次 1 轮，2582 字节 | — | 过 |
| 13 | wake-late | 1 | sessions search 王经理 --runtime all --all；todo list | 给王经理回电话这件事，提醒晚了 9 小时，现在已经晚上八点多了。如果还没联系，可以先发条消息问他是否方便通话，确认下周合同签约的具体时间，免得直接打电话打扰。 | 79 | 读了（第 1 次调用）：wake.md、subtasks.md、todos-change.md；1 次 1 轮，6314 字节 | — | 过 |
| 13 | wake-late | 2 | todo list；sessions search 王经理 --runtime all --all | 给王经理回电话的提醒晚了 **9 小时**，抱歉。现在已是晚上 20:23，如果还没联系他，可以先发条微信确认下周合同签约的具体日期和时间，免得直接打电话打扰。 | 80 | 读了（第 1 次调用）：wake.md、subtasks.md、todos-change.md；1 次 1 轮，6299 字节 | — | 过 |
| 14 | wake-obsolete | 1 | — | <no-reply/> | 11 | 读了（第 1 次调用）：wake.md、subtasks.md、todos-change.md、reminders.md；1 次 1 轮，9916 字节 | — | 过 |
| 14 | wake-obsolete | 2 | todo list；schedule list | <no-reply/> | 11 | 读了（第 1 次调用）：wake.md、subtasks.md、todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，16909 字节 | — | 过 |

## 1. report-wed（该记待办）

**期望**：提到带时间的事（没说「提醒我」）→ 记成待办并挂提醒，提醒在周三下午之前；票 44 起只认 todo add --remind-at，建成它自己的提醒（schedule create）算错；回复一句话说出时间

用户：

```text
周三下午要交报告
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 交报告 --due=2026-10-21 --remind-at=2026-10-20T17:00 --notes=周三下午要交报告，具体截止时刻未说明。 --supervisor=galley-assistant --reason=用户提到周三下午要交报告，记录待办并提前一天提醒准备。

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、reminders.md、times.md、todos-change.md；2 次 2 轮，12677 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_7e4a5c0000000000` 2026-10-20T09:00:00+00:00 target=assistant 挂在待办 `todo_7d0d5eed00000000` 上：交报告；记下的待办：`todo_7d0d5eed00000000` 交报告（备注：周三下午要交报告，具体截止时刻未说明。），截止 2026-10-21，没做；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
记下了：周三（10 月 21 日）下午交报告，周二下午 5 点提醒你提前准备。
```

建议标签：帮我列个报告提纲

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 交报告 --due=2026-10-21 --remind-at=2026-10-20T18:00 --notes=周三（10月21日）下午要交报告，具体截止时刻未指定。提前一天傍晚提醒准备。 --supervisor=galley-assistant --reason=用户提到周三下午交报告，记为待办并提前提醒

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、reminders.md、times.md、cli.md、todos-change.md；2 次 2 轮，16247 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_7e4a5c0000000000` 2026-10-20T10:00:00+00:00 target=assistant 挂在待办 `todo_7d0d5eed00000000` 上：交报告；记下的待办：`todo_7d0d5eed00000000` 交报告（备注：周三（10月21日）下午要交报告，具体截止时刻未指定。提前一天傍晚提醒准备。），截止 2026-10-21，没做；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
记下了：周三（10月21日）下午交报告，周二傍晚6点提醒你提前准备。
```

建议标签：帮我列个报告提纲

## 2. flight-fri（该记待办）

**期望**：订了航班（没说「提醒我」）→ 记成待办并挂提醒，提醒在航班之前；票 44 起只认挂在待办上的提醒；回复说出时间

用户：

```text
我订了周五早上 7 点的航班
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 赶周五早上 7 点的航班 --due=2026-10-23T07:00 --remind-at=2026-10-22T20:00 --notes=周五（2026年10月23日）早上7点起飞。前一晚提醒检查证件、行李和值机，安排去机场的交通。机场、航班号及出发地点尚未提供。 --supervisor=galley-assistant --reason=用户已订周五早班机，记录赶飞机待办并提前一晚提醒准备

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、times.md、reminders.md、todos-change.md；2 次 2 轮，12663 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_7e4a5c0000000000` 2026-10-22T12:00:00+00:00 target=assistant 挂在待办 `todo_7d0d5eed00000000` 上：赶周五早上 7 点的航班；记下的待办：`todo_7d0d5eed00000000` 赶周五早上 7 点的航班（备注：周五（2026年10月23日）早上7点起飞。前一晚提醒检查证件、行李和值机，安排去机场的交通。机场、航班号及出发地点尚未提供。），截止 2026-10-22T23:00:00+00:00，没做；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
记下了：这周五（10 月 23 日）早上 7 点的航班。我会在周四晚 8 点提醒你检查证件、行李和值机，提前安排去机场的交通。
```

建议标签：帮我算算周五几点出门去机场合适

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo list，galley todo add）；galley todo list；galley todo add 赶周五早上 7 点的航班 --due=2026-10-23T07:00 --remind-at=2026-10-22T20:00 --notes=已订周五早上7点航班；周四晚提醒准备证件、行李并确认去机场的交通。航班号和机场未提供。 --supervisor=galley-assistant --reason=用户已订周五早班机，记录赶航班待办并提前一晚提醒准备

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、times.md、reminders.md、todos-change.md；2 次 2 轮，12821 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_7e4a5c0000000000` 2026-10-22T12:00:00+00:00 target=assistant 挂在待办 `todo_7d0d5eed00000000` 上：赶周五早上 7 点的航班；记下的待办：`todo_7d0d5eed00000000` 赶周五早上 7 点的航班（备注：已订周五早上7点航班；周四晚提醒准备证件、行李并确认去机场的交通。航班号和机场未提供。），截止 2026-10-22T23:00:00+00:00，没做；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
记下了：10 月 23 日（周五）早上 7 点的航班。早班机要提前准备，我会在周四晚 8 点提醒你检查证件、行李和去机场的交通。
```

建议标签：帮我算算这班飞机几点出门合适

## 3. logistics-mon（它自己的提醒）

**期望**：要等外部结果的后续 → 建周一它自己的提醒（schedule create，不是待办），记下的话里带上单号（写给到点的自己）；回复说出时间

上下文：

> 用户：我在京东买了台显示器，单号 JD8812345678，说下周一前能到。
>
> 助手：好的，到了记得验一下屏幕有没有坏点。

用户：

```text
下周一记得帮我看下物流
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule list，galley schedule create）；galley schedule list；galley schedule create 用户在京东买了一台显示器，单号 JD8812345678，商家称2026年10月26日（周一）前能到。用户要求下周一帮忙查看物流。请使用浏览器查看该单物流和预计送达情况，并在主会话 s-mgn4k2x1-7q3z9w0e 告知用户；若需登录或验证，请请用户协助，不要编造物流状态。 --at=2026-10-26T10:00 --target=assistant --supervisor=galley-assistant --reason=用户要求下周一查看京东显示器物流 JD8812345678

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、reminders.md、times.md；1 次 1 轮，10823 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_5eed000000000000` 2026-10-26T02:00:00+00:00 target=assistant：用户在京东买了一台显示器，单号 JD8812345678，商家称2026年10月26日（周一）前能到。用户要求下周一帮忙查看物流。请使用浏览器查看该单物流和预计送达情况，并在主会话 s-mgn4k2x1-7q3z9w0e 告知用户；若需登录或验证，请请用户协助，不要编造物流状态。；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
设好了，下周一（10月26日）上午10点，我帮你查显示器的物流，单号 JD8812345678。
```

建议标签：把查物流的时间改到下周一下午3点

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule create，galley schedule list）；galley schedule create 用户在京东购买显示器，物流单号 JD8812345678，商家说下周一前能到。用户要求下周一帮忙查看物流。现在请通过 Browser Control 查询该单最新物流与是否送达，并在主聊天 s-mgn4k2x1-7q3z9w0e 告知用户真实结果；若查询需要登录或验证，请明确说明并请用户配合，不要编造物流状态。 --at=2026-10-26T10:00 --target=assistant --supervisor=galley-assistant --reason=用户要求下周一查看京东显示器物流 JD8812345678；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、reminders.md、times.md；1 次 1 轮，10821 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_5eed000000000000` 2026-10-26T02:00:00+00:00 target=assistant：用户在京东购买显示器，物流单号 JD8812345678，商家说下周一前能到。用户要求下周一帮忙查看物流。现在请通过 Browser Control 查询该单最新物流与是否送达，并在主聊天 s-mgn4k2x1-7q3z9w0e 告知用户真实结果；若查询需要登录或验证，请明确说明并请用户配合，不要编造物流状态。；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
记下了：下周一（10月26日）上午10点，我会帮你查京东显示器这单 **JD8812345678** 的物流，再告诉你进展。
```

建议标签：帮我改到下周一下午3点查物流

## 4. water-10min（只要提醒）

**期望**：「十分钟后提醒我喝水」→ 先看现在几点，建十分钟后它自己的一次性提醒（schedule create --target=assistant）；票 44 起记成待办算错；回复说出时间

用户：

```text
十分钟后提醒我喝水
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule create）；galley schedule create 提醒用户喝水。用户在主聊天要求十分钟后提醒喝水；到时直接用中文提醒：该喝水啦。 --at=2026-10-19T20:35 --target=assistant --supervisor=galley-assistant --reason=用户要求十分钟后提醒喝水

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md；1 次 1 轮，4444 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_5eed000000000000` 2026-10-19T12:35:00+00:00 target=assistant：提醒用户喝水。用户在主聊天要求十分钟后提醒喝水；到时直接用中文提醒：该喝水啦。；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
好的，十分钟后（20:35）提醒你喝水。
```

建议标签：把喝水提醒改到二十分钟后

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule create）；galley schedule create 提醒用户：该喝水了。用户要求十分钟后提醒喝水，请在主聊天中简短提醒。 --at=2026-10-19T20:35:01 --target=assistant --supervisor=galley-assistant --reason=用户要求十分钟后提醒喝水

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md；1 次 1 轮，4449 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_5eed000000000000` 2026-10-19T12:35:01+00:00 target=assistant：提醒用户：该喝水了。用户要求十分钟后提醒喝水，请在主聊天中简短提醒。；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
好的，十分钟后（20:35）提醒你喝水。
```

建议标签：帮我把喝水提醒改到二十分钟后

## 5. stove-30min（只要提醒）

**期望**：「半小时后提醒我关火」（票 44）→ 先看现在几点，建半小时后它自己的一次性提醒（schedule create --target=assistant），不记待办；回复说出时间

用户：

```text
半小时后提醒我关火
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule create）；galley schedule create 提醒用户：时间到了，请现在关火，确认炉灶已关闭。用户在主聊天要求半小时后提醒关火。 --at=2026-10-19T20:55 --target=assistant --supervisor=galley-assistant --reason=用户要求半小时后提醒关火

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md、todos.md；1 次 1 轮，10821 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_5eed000000000000` 2026-10-19T12:55:00+00:00 target=assistant：提醒用户：时间到了，请现在关火，确认炉灶已关闭。用户在主聊天要求半小时后提醒关火。；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
好的，半小时后（20:55）提醒你关火。
```

建议标签：把关火提醒提前到20:50

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule create）；galley schedule create 提醒用户：时间到了，请关火。用户在主聊天 s-mgn4k2x1-7q3z9w0e 请求半小时后提醒关火。 --at=2026-10-19T20:55 --target=assistant --supervisor=galley-assistant --reason=用户要求半小时后提醒关火

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md、todos.md；1 次 1 轮，10819 字节；建前查过：查了；手册版本：`c00483a6`。

新建：`sched_5eed000000000000` 2026-10-19T12:55:00+00:00 target=assistant：提醒用户：时间到了，请关火。用户在主聊天 s-mgn4k2x1-7q3z9w0e 请求半小时后提醒关火。；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
好的，半小时后（20:55）提醒你关火。
```

建议标签：取消关火提醒

## 6. guitar（不该建）

**期望**：没有时间点的事 → 不建，不动任何东西，正常聊

用户：

```text
我最近想学吉他
```

### 第 1 遍：过

结束：以最终回复结束；读手册：没读（没写）；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
挺好啊！有没有哪首歌，让你特别想自己拿吉他弹出来？有首喜欢的歌当目标，练起来会更有劲，不必一上来就啃乐理。

你现在手边有吉他，还是刚开始动这个念头？
```

建议标签：帮我理理零基础学吉他该从哪开始

### 第 2 遍：过

结束：以最终回复结束；读手册：没读（没写）；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
可以呀，学会几组常用和弦，就能慢慢弹唱喜欢的歌，不用一开始就啃很多乐理。

你更想**边弹边唱**，还是喜欢**电吉他的乐队、摇滚音色**？手里已经有琴了吗？没买也不用急，先看你想玩哪种。
```

建议标签：帮我看看新手怎么选木吉他还是电吉他

## 7. tired-meeting（不该建）

**期望**：说过去的事 → 不建，不动任何东西，短回复

用户：

```text
昨天开会挺累的
```

### 第 1 遍：过

结束：以最终回复结束；读手册：没读（没写）；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
辛苦了。是会开得太久，还是有些事聊得特别费心？
```

建议标签：陪我聊聊昨天的会

### 第 2 遍：过

结束：以最终回复结束；读手册：没读（没写）；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
辛苦了，开会有时候真比埋头干活还耗神。是开得太久，还是会上有些事让你心累？
```

建议标签：陪我聊聊昨天开会的事

## 8. daily-news（该先问）

**期望**：重复且每次都要干活（花钱）→ 先在对话里问一句（时间、看什么），不建

用户：

```text
以后每天早上给我看看新闻
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md、todos.md；1 次 1 轮，10884 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
每天早上 **8 点**（按电脑本地时间），帮你查阅当天的国内外要闻，整理成 **5 条简报，附来源链接**；每天运行会产生相应的模型费用，这样安排可以吗？
```

建议标签：可以，就按每天早上8点，整理5条国内外要闻

### 第 2 遍：过

工具调用：

1. code_run

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md；1 次 1 轮，4432 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
每天早上 **8 点**（按你电脑的本地时间），我查阅当天新闻，整理 **5 条国内外要闻，附简短摘要和来源链接**发给你；这会每天产生模型调用费用，可以吗？
```

建议标签：就按每天早上8点，帮我安排新闻简报

## 9. already-set（已有同一件）

**期望**：「在办的事」里已有同一件（票 41 之前建的独立提醒）→ 不再建第二个提醒；留着它，或换成挂在待办上的一个（删旧建新、时间仍在周三下午 3 点前）；可以只记一件不带提醒的待办；回复说已经记着、几点提醒

已有的定时任务（运行那一刻的时间）：

- `sched_6c1f0e9a2b7d4385` 2026-10-21T02:00:00+00:00，在「In Hand」里：提醒用户周三下午 3 点前把季度报告交给王经理。报告在 ~/Documents/Q3 季度报告.docx，交之前再核对一遍第 4 页的数据。

用户：

```text
对了，周三下午我得交季度报告
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：reminders.md、times.md、todos.md、todos-change.md；2 次 2 轮，13361 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
已经有提醒了：周三（10 月 21 日）上午 10 点提醒你，下午 3 点前把季度报告交给王经理。
```

建议标签：帮我检查一下季度报告第 4 页的数据

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley schedule list）；galley todo list；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12537 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
这件事已经设好提醒了：**10 月 21 日（周三）上午 10 点**提醒你，下午 3 点前把季度报告交给王经理。
```

建议标签：把季度报告的提醒改到周三中午12点

## 10. no-need（不用了）

**期望**：你说不用了 → schedule delete 那一个（先 schedule list 找 id），不建新的；回复一句确认

上下文：

> 用户：周日晚上 9 点提醒我给我妈打电话
>
> 助手：好，周日晚上 9 点提醒你给妈妈打电话。

已有的定时任务（运行那一刻的时间）：

- `sched_2d8e5a1c9f0b7364` 2026-10-25T13:00:00+00:00：提醒用户给妈妈打电话（用户周五说的，周日晚上 9 点）。

用户：

```text
刚给我妈打过了，周日那个不用提醒了
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley schedule list）；galley todo list；galley schedule list
3. code_run（galley schedule delete，galley schedule list）；galley schedule delete sched_2d8e5a1c9f0b7364 --supervisor=galley-assistant --reason=用户已给妈妈打过电话，要求取消周日提醒；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12533 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：sched_2d8e5a1c9f0b7364；改动：无。

回复（去掉 summary 与建议标签）：

```text
周日晚上 9 点不会再提醒你给妈妈打电话了。
```

建议标签：帮我看看还有哪些提醒

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley schedule list）；galley todo list；galley schedule list
3. code_run（galley schedule delete，galley schedule list）；galley schedule delete sched_2d8e5a1c9f0b7364 --supervisor=galley-assistant --reason=用户已给妈妈打过电话，要求取消周日晚上9点的提醒；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12580 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：sched_2d8e5a1c9f0b7364；改动：无。

回复（去掉 summary 与建议标签）：

```text
好，周日晚上 9 点给妈妈打电话的提醒已取消。
```

建议标签：帮我看看还有哪些提醒

## 11. move-time（改时间）

**期望**：「改到 9 点」→ schedule update 那一个到明天 9:00（或删了重建），不留两个；回复说出新时间

上下文：

> 用户：明天上午 10 点提醒我给房东转房租
>
> 助手：好，明天上午 10 点提醒你给房东转房租。

已有的定时任务（运行那一刻的时间）：

- `sched_9a4b2c7e1d0f5836` 2026-10-20T02:00:00+00:00：提醒用户给房东转这个月的房租。

用户：

```text
改到 9 点吧
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley schedule list）；galley todo list；galley schedule list
3. code_run（galley schedule update，galley schedule list）；galley schedule update sched_9a4b2c7e1d0f5836 --at=2026-10-20T09:00 --supervisor=galley-assistant --reason=用户要求将给房东转房租的提醒从明天上午10点改到9点；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12552 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：sched_9a4b2c7e1d0f5836。

回复（去掉 summary 与建议标签）：

```text
已改到明天（10 月 20 日）上午 9 点，提醒你给房东转房租。
```

建议标签：帮我看看还有哪些提醒

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley schedule list）；galley todo list；galley schedule list
3. code_run（galley schedule update，galley schedule list）；galley schedule update sched_9a4b2c7e1d0f5836 --at=2026-10-20T09:00 --supervisor=galley-assistant --reason=用户要求将给房东转房租的提醒从明早10点改到9点；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，12535 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：sched_9a4b2c7e1d0f5836。

回复（去掉 summary 与建议标签）：

```text
已改到明天（10 月 20 日）上午 9 点，提醒你给房东转房租。
```

建议标签：帮我看看还有哪些提醒

## 12. wake-on-time（叫醒）

**期望**：按时叫醒 → 照记下的话一两句提醒（带身份证、几点出门），不说晚了，不出 <no-reply/>

已有的定时任务（运行那一刻的时间）：

- `sched_4e7a1b9c2d3f0685` 2026-10-19T12:23:27+00:00，已到点：提醒用户：明早 8:05 虹桥站的 G7 次高铁去北京出差。今晚把行李收好、身份证放进包里，明早 7 点前出门。

叫醒消息：

```text
[Galley — not a message from the user] A reminder you set came due. Act on it, then reply to the user. Do not mention this note.

Reminder `sched_4e7a1b9c2d3f0685` (one-off) came due. Planned for 2026-10-19 20:23 (Mon), local time. What you noted when you set it:
<<<
提醒用户：明早 8:05 虹桥站的 G7 次高铁去北京出差。今晚把行李收好、身份证放进包里，明早 7 点前出门。
>>>
Act on it now: tell the user what is of use to them now, in a sentence or two (not your words read back), look something up first, or start a subtask. If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.
```

### 第 1 遍：过

工具调用：

1. code_run

结束：以最终回复结束；读手册：读了（第 1 次调用）：wake.md、subtasks.md；1 次 1 轮，4513 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
明早 8:05 要在虹桥站坐 G7 去北京，今晚先收好行李，把身份证放进随身包，睡前设好闹钟。明早记得 **7 点前出门**，给进站安检留些余量。
```

建议标签：帮我列一份这次北京出差的行李清单

### 第 2 遍：过

工具调用：

1. file_read（wake.md）

结束：以最终回复结束；读手册：读了（第 1 次调用）：wake.md；1 次 1 轮，2582 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
明早要赶 8:05 从虹桥站出发去北京的 G7，今晚先收好行李，把身份证放进随身包，免得早上忙乱。明早记得 7 点前出门，给进站安检留足时间，今晚早点休息。
```

建议标签：帮我列一份明早去北京出差的随身物品清单

## 13. wake-late（叫醒）

**期望**：晚了 9 小时（电脑睡着）→ 照实说晚了多久，再说事情（给王经理回电话）

已有的定时任务（运行那一刻的时间）：

- `sched_7b3d9e0f1a2c6548` 2026-10-19T03:23:27+00:00，已到点：提醒用户给王经理回电话，确认下周合同签约的时间。

叫醒消息：

```text
[Galley — not a message from the user] A reminder you set came due. Act on it, then reply to the user. Do not mention this note.

Reminder `sched_7b3d9e0f1a2c6548` (one-off) came due. Planned for 2026-10-19 11:23 (Mon), local time; it went off at 2026-10-19 20:23 (Mon), 9 hours late (the computer was asleep or Galley was closed). What you noted when you set it:
<<<
提醒用户给王经理回电话，确认下周合同签约的时间。
>>>
Act on it now, and say in the reply itself (the user does not see your summary) that it comes 9 hours late: tell the user what is of use to them now, in a sentence or two (not your words read back), look something up first, or start a subtask. If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley sessions search，galley todo list）；galley sessions search 王经理 --runtime all --all；galley todo list

结束：以最终回复结束；读手册：读了（第 1 次调用）：wake.md、subtasks.md、todos-change.md；1 次 1 轮，6314 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
给王经理回电话这件事，提醒晚了 9 小时，现在已经晚上八点多了。如果还没联系，可以先发条消息问他是否方便通话，确认下周合同签约的具体时间，免得直接打电话打扰。
```

建议标签：帮我拟一条发给王经理、确认下周签约时间的微信

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley sessions search）；galley todo list；galley sessions search 王经理 --runtime all --all

结束：以最终回复结束；读手册：读了（第 1 次调用）：wake.md、subtasks.md、todos-change.md；1 次 1 轮，6299 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
给王经理回电话的提醒晚了 **9 小时**，抱歉。现在已是晚上 20:23，如果还没联系他，可以先发条微信确认下周合同签约的具体日期和时间，免得直接打电话打扰。
```

建议标签：帮我拟一条给王经理确认签约时间的微信

## 14. wake-obsolete（叫醒）

**期望**：事情已经办了（前面用户说过快递拿了）→ 回复只有 <no-reply/>，不动任何东西

上下文：

> 用户：我刚下楼顺路把快递拿了，晚上不用再跑一趟了
>
> 助手：好嘞，省一趟。

已有的定时任务（运行那一刻的时间）：

- `sched_0f5c8a3e6b1d2947` 2026-10-19T12:23:27+00:00，已到点：提醒用户去菜鸟驿站取快递（取件码 8-3-2041）。

叫醒消息：

```text
[Galley — not a message from the user] A reminder you set came due. Act on it, then reply to the user. Do not mention this note.

Reminder `sched_0f5c8a3e6b1d2947` (one-off) came due. Planned for 2026-10-19 20:23 (Mon), local time. What you noted when you set it:
<<<
提醒用户去菜鸟驿站取快递（取件码 8-3-2041）。
>>>
Act on it now: tell the user what is of use to them now, in a sentence or two (not your words read back), look something up first, or start a subtask. If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.
```

### 第 1 遍：过

工具调用：

1. code_run

结束：以最终回复结束；读手册：读了（第 1 次调用）：wake.md、subtasks.md、todos-change.md、reminders.md；1 次 1 轮，9916 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
<no-reply/>
```

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list，galley schedule list）；galley todo list；galley schedule list

结束：以最终回复结束；读手册：读了（第 1 次调用）：wake.md、subtasks.md、todos.md、todos-change.md、reminders.md、times.md；1 次 1 轮，16909 字节；建前查过：—；手册版本：`c00483a6`。

新建：无；删除：无；改动：无。

回复（去掉 summary 与建议标签）：

```text
<no-reply/>
```
