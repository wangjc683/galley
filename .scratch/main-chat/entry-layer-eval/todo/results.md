# 待办评测结果（票 41）

模型：gpt-6.1-sol（Galley 托管模型 mm_1790734996114，从 Galley 数据库只读取得，即 JC 主对话现在用的模型），推理强度 high；首次运行于 2026-10-17 01:38。

- **提示词**：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（与定时评测共用 `../schedule/galley-prompt/`）：票 41 改过的入口层；用例里分段开始前就有的待办与定时任务照 `in_hand_section` 的格式（票 39 的三组）写进「In Hand」一节，时间写成消息前一小时（`run.py` 的 `in_hand_block`，干跑测试逐字对过 Rust 的输出）。手册是仓库里的 `docs/managed-ga-runtime/galley-assistant-manual.md`，放在这次运行状态根下 Core 写它的位置。
- **新消息**：用户这句（「说说这件」是引用块加一句话，照 `composer-quote.ts` 的写法）；叫醒用例是照 Core 措辞（`subtask_report::report_text` 的待办一段，同样逐字对过）拼出的叫醒消息。
- **工具**：`code_run` 与文件工具在每次运行自己的 macOS 沙盒里真的执行（同票 36 的沙盒）；Galley CLI 是假的：`todo` 命令族按 Agent API §5.28–§5.34 的形状回答、照真实 CLI 与 Core 校验参数（`--due=` 空值、`update` 什么都没给、`--due` 与 `--no-due` 同给是参数错误，`--remind-at` 过去报 `time_in_past:`，未知或已取消的 id 退出码 3，勾掉与取消会取消没提醒到的提醒），`schedule` 命令族照票 36；`--help` 是真实 CLI 的原文。每次调用都记下，写命令只改假 CLI 自己的状态。每次运行最多 10 次工具调用。
- **判定**：按 `cases.json` 每条的 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复。每条都查：`todo` 与 `schedule` 写命令带没带 `--supervisor=galley-assistant`，`schedule create` 带没带 `--target=assistant`，有没有多余的写命令、会卡住主对话的命令或 `<subtask>`。

## 通过率

| # | 用例 | 分组 | 期望 | 遍数 | 过 | 通过率 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | note-report | 该记待办 | 有截止的事（没说「提醒我」）→ todo add：标题有季度报告，截止周三 15:00（带时刻），挂一个周三 15:00 之前的提醒；不用 schedule create；一句话说出几点提醒 | 2 | 2 | 100% |
| 2 | note-soil | 该记待办 | 没时间的事 → todo add「买营养土」，不写截止、不挂提醒；回复一句说记下了 | 2 | 2 | 100% |
| 3 | note-landlord | 该记待办 | 「明天要给房东回电话」→ todo add，截止明天（凌晨说的「明天」两天都算），挂一个截止之前的提醒；回复说出几点提醒 | 2 | 2 | 100% |
| 4 | logistics-mon | 它自己的提醒 | 让它回头查的事 → schedule create --target=assistant 在下周一，记下的话里带单号；不记待办；回复说出时间 | 2 | 2 | 100% |
| 5 | guitar | 不该记 | 没有可办的事 → 不记待办、不建提醒，不动任何东西 | 2 | 2 | 100% |
| 6 | flight-number | 不该记 | 信息（航班号）→ 不记成待办、不建提醒（可以记进记忆） | 2 | 2 | 100% |
| 7 | tick-soil | 勾掉 | 「在办的事」里有「买营养土」，说「营养土买好了」→ todo done 那一件；一句话说已勾掉，不复述清单 | 2 | 2 | 100% |
| 8 | quote-move | 引用改 | 输入框带引用块「交季度报告」，说「改到周四」→ todo update 那一件：截止挪到周四、提醒跟着挪（在周四截止之前）；不新建；回复说出新时间 | 2 | 2 | 100% |
| 9 | whats-left | 问还有什么没办 | 「In Hand」是段首快照（买营养土那时还没做；续签合同是这段里刚记的、不在快照里），之后用户在面板上勾掉了营养土 → 先 todo list 读最新的，答季度报告、房东、续签合同，不把营养土当成没办 | 2 | 2 | 100% |
| 10 | already-noted | 已有同一件 | 清单上已有「交季度报告」（带提醒）→ 不再记第二件、不再挂第二个提醒；回复说已经记着、几点提醒 | 2 | 2 | 100% |
| 11 | wake-todo | 待办的提醒到点 | 待办「交季度报告」的提醒按时到点（Core 的待办叫醒措辞）→ 一两句提醒（季度报告、几点截止），不勾掉、不动任何东西，不出 <no-reply/> | 2 | 2 | 100% |
| | 合计 | | | 22 | 22 | 100% |

## 一览

| # | 用例 | 遍 | 调了什么命令 | 回复原文 | 字数 | 读手册 | 写前读过清单 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | note-report | 1 | todo list；todo add 交季度报告 --due=2026-10-21T15:00 --remind-at=2026-10-20T15:00 --notes=季度报告须在周三（2026 年 10 月 21 日）下午 3 点前提交。 --supervisor=galley-assistant --reason=用户提及季度报告截止时间，记录待办并提前一天提醒 | 记下了：**周三（10 月 21 日）下午 3 点前交季度报告**，周二下午 3 点提醒你。提醒时间随时可以改。 | 56 | 读了（第 1 次调用） | 查了 | 过 |
| 1 | note-report | 2 | todo list；todo add 交季度报告 --due=2026-10-21T15:00 --remind-at=2026-10-20T15:00 --notes=周三下午3点前提交季度报告。 --supervisor=galley-assistant --reason=记录用户提及的季度报告截止时间并提前一天提醒 | 记下了：**10 月 21 日（周三）下午 3 点前交季度报告**，会在 **10 月 20 日（周二）下午 3 点**提醒你。要改提醒时间，直接告诉我。 | 77 | 读了（第 1 次调用） | 查了 | 过 |
| 2 | note-soil | 1 | todo list；todo add 买营养土 --supervisor=galley-assistant --reason=用户要求记下要买营养土 | 记好了：买营养土，暂不设提醒。 | 15 | 读了（第 1 次调用） | 查了 | 过 |
| 2 | note-soil | 2 | todo list；todo add 买营养土 --supervisor=galley-assistant --reason=用户要求记下要买营养土 | 记下了：买营养土。 | 9 | 读了（第 1 次调用） | 查了 | 过 |
| 3 | note-landlord | 1 | todo list；todo add 给房东回电话 --due=2026-10-18 --remind-at=2026-10-18T10:00 --supervisor=galley-assistant --reason=用户提到明天要给房东回电话，记为待办并设置当天提醒 | 记下了：明天（10月18日）给房东回电话，上午10点提醒你；时间不合适可以改。 | 39 | 读了（第 1 次调用） | 查了 | 过 |
| 3 | note-landlord | 2 | todo list；todo add 给房东回电话 --due=2026-10-18 --remind-at=2026-10-18T09:00 --supervisor=galley-assistant --reason=用户说明明天要给房东回电话 | 明天（10 月 18 日）给房东回电话，明早 9 点提醒你；时间不合适可以改。 | 39 | 读了（第 1 次调用） | 查了 | 过 |
| 4 | logistics-mon | 1 | schedule list；schedule create 查看京东显示器物流并向用户回报：用户购买的显示器，单号 JD8812345678，商家称下周一（2026年10月19日）前能到。到时通过 Browser Control 的真实浏览器查询京东物流最新状态，核实是否已签收、当前位置及预计送达时间；向主聊天 s-…9w0e 的用户简短报告。若需登录或缺少查询信息，如实告知并请用户协助，不要虚构结果。 --at=2026-10-19T10:00 --target… | 已安排，下周一（10 月 19 日）上午 10 点，我会帮你查京东显示器的物流（JD8812345678），查完告诉你。要改时间或取消，直接跟我说。 | 74 | 读了（第 1 次调用） | — | 过 |
| 4 | logistics-mon | 2 | schedule list；schedule create 用户在京东买了一台显示器，物流单号 JD8812345678，商家说 2026 年 10 月 19 日（周一）前能到。用户要求下周一帮忙查看物流。请在此时通过 Browser Control 的真实浏览器查询该单号的最新物流、预计到达时间及是否已签收，并在主聊天 s-…9w0e 告知用户结果；如需要登录或手机号验证，说明阻碍并请用户协助，不要虚构物流状态。 --at=2026-10-19T10:00 --… | 下周一（10 月 19 日）上午 10 点，我会帮你查京东单号 **JD8812345678** 的物流，再告诉你进展。要改时间或取消，跟我说一声就行。 | 76 | 读了（第 1 次调用） | — | 过 |
| 5 | guitar | 1 | — | 挺好呀，有没有一首特别想自己弹的歌？是想边弹边唱，还是更喜欢纯吉他演奏？先从你喜欢的音乐聊起，不用急着买琴。 | 54 | 没读（没写） | — | 过 |
| 5 | guitar | 2 | — | 有没有哪首歌，让你突然想“要是我也会弹就好了”？从想弹的歌入手，通常比一上来啃乐理更有动力。 ⏎ 你之前碰过吉他吗，还是准备从零开始？ | 66 | 没读（没写） | — | 过 |
| 6 | flight-number | 1 | sessions search 航班 --runtime all --all；session show s-…9w0e --tail=20 | 你是**哪一天**乘坐 MU5101？ | 19 | 没读（没写） | — | 过 |
| 6 | flight-number | 2 | sessions search 航班 --runtime all --all；session show s-…9w0e --tail=20 | 收到，**MU5101**。你是几月几日出发？ | 23 | 没读（没写） | — | 过 |
| 7 | tick-soil | 1 | todo list；todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant --reason=用户确认营养土已买好 | 已把“买营养土”勾掉了。 | 12 | 读了（第 1 次调用） | 查了 | 过 |
| 7 | tick-soil | 2 | todo list；todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant --reason=用户说营养土买好了 | 已勾掉。 | 4 | 读了（第 1 次调用） | 查了 | 过 |
| 8 | quote-move | 1 | todo list；todo update todo_2b3c4d5e6f7a8b9c --due=2026-10-22T15:00 --remind-at=2026-10-22T12:00 --supervisor=galley-assistant --reason=用户要求将交季度报告改到周四，保留原时间并同步移动提醒；todo show todo_2b3c4d5e6f7a8b9c | 已改到 **10月22日（周四）下午3点**交季度报告，提醒也同步改为当天中午12点。 | 43 | 读了（第 1 次调用） | 查了 | 过 |
| 8 | quote-move | 2 | todo list；todo update todo_2b3c4d5e6f7a8b9c --due=2026-10-22T15:00 --remind-at=2026-10-22T12:00 --supervisor=galley-assistant --reason=用户要求交季度报告改到周四，同步顺延提醒 | 已改到 **10月22日（周四）下午3点**交季度报告，提醒也顺延到当天中午12点。 | 42 | 读了（第 1 次调用） | 查了 | 过 |
| 9 | whats-left | 1 | todo list | - **给房东回电话**：明天（10 月 18 日，周日），上午 10 点提醒。 ⏎ - **交季度报告**：10 月 21 日（周三）下午 3 点前，中午 12 点提醒。 ⏎ - **续签房屋合同**：10 月 23 日（周五）前，周四晚上 8 点提醒。 | 124 | 读了（第 3 次调用） | 读了清单 | 过 |
| 9 | whats-left | 2 | todo list | 还有 **3 件没办**： ⏎ - **明天（10 月 18 日）给房东回电话**，上午 10 点提醒。 ⏎ - **周三（10 月 21 日）下午 3 点前交季度报告**，当天中午 12 点提醒。 ⏎ - **周五（10 月 23 日）前续签房屋合同**，周四晚上 8 点提醒。 | 135 | 读了（第 1 次调用） | 读了清单 | 过 |
| 10 | already-noted | 1 | todo list | 这件事已经记着了：**10 月 21 日（周三）下午 3 点前交季度报告**，当天中午 12 点会提醒你，没有重复添加。 | 60 | 没读（没写） | 读了清单 | 过 |
| 10 | already-noted | 2 | todo list | 已经记着了：**10 月 21 日（周三）下午 3 点前交季度报告**，当天中午 12 点提醒你。 | 49 | 没读（没写） | 读了清单 | 过 |
| 11 | wake-todo | 1 | — | 记得把 `~/Documents/Q3 季度报告.docx` 交给王经理，今天凌晨 **04:38 截止**，还有 3 小时。 | 63 | 没读（没写） | — | 过 |
| 11 | wake-todo | 2 | — | 记得在今天（周六）04:40 前把季度报告交给王经理。文件是 `~/Documents/Q3 季度报告.docx`，距截止还有约 3 小时。 | 70 | 没读（没写） | — | 过 |

## 1. note-report（该记待办）

**期望**：有截止的事（没说「提醒我」）→ todo add：标题有季度报告，截止周三 15:00（带时刻），挂一个周三 15:00 之前的提醒；不用 schedule create；一句话说出几点提醒

用户：

```text
周三下午 3 点前要交季度报告
```

### 第 1 遍：过

工具调用：

1. file_read（galley-assistant-manual.md）
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 交季度报告 --due=2026-10-21T15:00 --remind-at=2026-10-20T15:00 --notes=季度报告须在周三（2026 年 10 月 21 日）下午 3 点前提交。 --supervisor=galley-assistant --reason=用户提及季度报告截止时间，记录待办并提前一天提醒

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：`todo_7d0d5eed00000000` 交季度报告（备注：季度报告须在周三（2026 年 10 月 21 日）下午 3 点前提交。），截止 2026-10-21T07:00:00+00:00，没做；新建的提醒：`sched_7e4a5c0000000000` 2026-10-20T07:00:00+00:00 挂在 `todo_7d0d5eed00000000` 上：交季度报告；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记下了：**周三（10 月 21 日）下午 3 点前交季度报告**，周二下午 3 点提醒你。提醒时间随时可以改。
```

建议标签：帮我改到周三中午 12 点提醒

### 第 2 遍：过

工具调用：

1. file_read（galley-assistant-manual.md）
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 交季度报告 --due=2026-10-21T15:00 --remind-at=2026-10-20T15:00 --notes=周三下午3点前提交季度报告。 --supervisor=galley-assistant --reason=记录用户提及的季度报告截止时间并提前一天提醒

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：`todo_7d0d5eed00000000` 交季度报告（备注：周三下午3点前提交季度报告。），截止 2026-10-21T07:00:00+00:00，没做；新建的提醒：`sched_7e4a5c0000000000` 2026-10-20T07:00:00+00:00 挂在 `todo_7d0d5eed00000000` 上：交季度报告；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记下了：**10 月 21 日（周三）下午 3 点前交季度报告**，会在 **10 月 20 日（周二）下午 3 点**提醒你。要改提醒时间，直接告诉我。
```

建议标签：帮我把季度报告的提醒改到周三中午12点

## 2. note-soil（该记待办）

**期望**：没时间的事 → todo add「买营养土」，不写截止、不挂提醒；回复一句说记下了

用户：

```text
记一下要买营养土
```

### 第 1 遍：过

工具调用：

1. file_read（galley-assistant-manual.md）
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 买营养土 --supervisor=galley-assistant --reason=用户要求记下要买营养土

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：`todo_7d0d5eed00000000` 买营养土，截止 无截止，没做；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记好了：买营养土，暂不设提醒。
```

建议标签：明天上午9点提醒我买营养土

### 第 2 遍：过

工具调用：

1. file_read（galley-assistant-manual.md）
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 买营养土 --supervisor=galley-assistant --reason=用户要求记下要买营养土

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：`todo_7d0d5eed00000000` 买营养土，截止 无截止，没做；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记下了：买营养土。
```

建议标签：帮我挑一下适合家里盆栽的营养土

## 3. note-landlord（该记待办）

**期望**：「明天要给房东回电话」→ todo add，截止明天（凌晨说的「明天」两天都算），挂一个截止之前的提醒；回复说出几点提醒

用户：

```text
明天要给房东回电话
```

### 第 1 遍：过

工具调用：

1. file_read（galley-assistant-manual.md）
2. file_read（galley-assistant-manual.md）
3. code_run（galley todo list）；galley todo list
4. code_run（galley todo add）；galley todo add 给房东回电话 --due=2026-10-18 --remind-at=2026-10-18T10:00 --supervisor=galley-assistant --reason=用户提到明天要给房东回电话，记为待办并设置当天提醒

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：`todo_7d0d5eed00000000` 给房东回电话，截止 2026-10-18，没做；新建的提醒：`sched_7e4a5c0000000000` 2026-10-18T02:00:00+00:00 挂在 `todo_7d0d5eed00000000` 上：给房东回电话；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记下了：明天（10月18日）给房东回电话，上午10点提醒你；时间不合适可以改。
```

建议标签：把给房东回电话的提醒改到明天下午2点

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo add）；galley todo add 给房东回电话 --due=2026-10-18 --remind-at=2026-10-18T09:00 --supervisor=galley-assistant --reason=用户说明明天要给房东回电话

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：`todo_7d0d5eed00000000` 给房东回电话，截止 2026-10-18，没做；新建的提醒：`sched_7e4a5c0000000000` 2026-10-18T01:00:00+00:00 挂在 `todo_7d0d5eed00000000` 上：给房东回电话；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
明天（10 月 18 日）给房东回电话，明早 9 点提醒你；时间不合适可以改。
```

建议标签：把给房东回电话的提醒改到明天下午 2 点

## 4. logistics-mon（它自己的提醒）

**期望**：让它回头查的事 → schedule create --target=assistant 在下周一，记下的话里带单号；不记待办；回复说出时间

上下文：

> 用户：我在京东买了台显示器，单号 JD8812345678，说下周一前能到。
>
> 助手：好的，到了记得验一下屏幕有没有坏点。

用户：

```text
下周一帮我看下物流
```

### 第 1 遍：过

工具调用：

1. file_read（galley-assistant-manual.md）
2. file_read（galley-assistant-manual.md）
3. code_run（galley schedule list）；galley schedule list
4. code_run（galley schedule create）；galley schedule create 查看京东显示器物流并向用户回报：用户购买的显示器，单号 JD8812345678，商家称下周一（2026年10月19日）前能到。到时通过 Browser Control 的真实浏览器查询京东物流最新状态，核实是否已签收、当前位置及预计送达时间；向主聊天 s-mgn4k2x1-7q3z9w0e 的用户简短报告。若需登录或缺少查询信息，如实告知并请用户协助，不要虚构结果。 --at=2026-10-19T10:00 --target=assistant --supervisor=galley-assistant --reason=用户要求下周一帮忙查看京东显示器物流

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：`sched_5eed000000000000` 2026-10-19T02:00:00+00:00 target=assistant：查看京东显示器物流并向用户回报：用户购买的显示器，单号 JD8812345678，商家称下周一（2026年10月19日）前能到。到时通过 Browser Control 的真实浏览器查询京东物流最新状态，核实是否已签收、当前位置及预计送达时间；向主聊天 s-mgn4k2x1-7q3z9w0e 的用户简短报告。若需登录或缺少查询信息，如实告知并请用户协助，不要虚构结果。；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
已安排，下周一（10 月 19 日）上午 10 点，我会帮你查京东显示器的物流（JD8812345678），查完告诉你。要改时间或取消，直接跟我说。
```

建议标签：帮我改到下周一下午 2 点查物流

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley schedule list）；galley schedule list
3. code_run（galley schedule create）；galley schedule create 用户在京东买了一台显示器，物流单号 JD8812345678，商家说 2026 年 10 月 19 日（周一）前能到。用户要求下周一帮忙查看物流。请在此时通过 Browser Control 的真实浏览器查询该单号的最新物流、预计到达时间及是否已签收，并在主聊天 s-mgn4k2x1-7q3z9w0e 告知用户结果；如需要登录或手机号验证，说明阻碍并请用户协助，不要虚构物流状态。 --at=2026-10-19T10:00 --target=assistant --supervisor=galley-assistant --reason=用户要求下周一查询京东显示器物流

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：`sched_5eed000000000000` 2026-10-19T02:00:00+00:00 target=assistant：用户在京东买了一台显示器，物流单号 JD8812345678，商家说 2026 年 10 月 19 日（周一）前能到。用户要求下周一帮忙查看物流。请在此时通过 Browser Control 的真实浏览器查询该单号的最新物流、预计到达时间及是否已签收，并在主聊天 s-mgn4k2x1-7q3z9w0e 告知用户结果；如需要登录或手机号验证，说明阻碍并请用户协助，不要虚构物流状态。；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
下周一（10 月 19 日）上午 10 点，我会帮你查京东单号 **JD8812345678** 的物流，再告诉你进展。要改时间或取消，跟我说一声就行。
```

建议标签：帮我改到下周一下午 2 点查物流

## 5. guitar（不该记）

**期望**：没有可办的事 → 不记待办、不建提醒，不动任何东西

用户：

```text
我最近想学吉他
```

### 第 1 遍：过

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
挺好呀，有没有一首特别想自己弹的歌？是想边弹边唱，还是更喜欢纯吉他演奏？先从你喜欢的音乐聊起，不用急着买琴。
```

建议标签：帮我看看零基础适合学哪种吉他

### 第 2 遍：过

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
有没有哪首歌，让你突然想“要是我也会弹就好了”？从想弹的歌入手，通常比一上来啃乐理更有动力。

你之前碰过吉他吗，还是准备从零开始？
```

建议标签：帮我理理零基础学吉他该从哪开始

## 6. flight-number（不该记）

**期望**：信息（航班号）→ 不记成待办、不建提醒（可以记进记忆）

用户：

```text
我的航班号是 MU5101
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley sessions search）；galley sessions search 航班 --runtime all --all
3. code_run（galley session show）；galley session show s-mgn4k2x1-7q3z9w0e --tail=20

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
你是**哪一天**乘坐 MU5101？
```

建议标签：帮我查 MU5101 的起降时间

### 第 2 遍：过

工具调用：

1. code_run（galley sessions search）；galley sessions search 航班 --runtime all --all
2. code_run（galley session show）；galley session show s-mgn4k2x1-7q3z9w0e --tail=20

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
收到，**MU5101**。你是几月几日出发？
```

建议标签：帮我查一下 MU5101 的航班动态

## 7. tick-soil（勾掉）

**期望**：「在办的事」里有「买营养土」，说「营养土买好了」→ todo done 那一件；一句话说已勾掉，不复述清单

已有的待办（运行那一刻）：

- `todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-21T07:00:00+00:00，没做，提醒 2026-10-21T04:00:00+00:00，在「In Hand」里
- `todo_4d5e6f7a8b9c0d1e` 买营养土，截止 无截止，没做，在「In Hand」里
- `todo_1a2b3c4d5e6f7a8b` 给房东回电话，截止 2026-10-18，没做，提醒 2026-10-18T02:00:00+00:00，在「In Hand」里

用户：

```text
营养土买好了
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo done）；galley todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant --reason=用户确认营养土已买好

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：`todo_4d5e6f7a8b9c0d1e` 买营养土，截止 无截止，已勾掉；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
已把“买营养土”勾掉了。
```

建议标签：帮我看看还有哪些待办

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo done）；galley todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant --reason=用户说营养土买好了

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：`todo_4d5e6f7a8b9c0d1e` 买营养土，截止 无截止，已勾掉；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
已勾掉。
```

建议标签：看看我还有什么待办

## 8. quote-move（引用改）

**期望**：输入框带引用块「交季度报告」，说「改到周四」→ todo update 那一件：截止挪到周四、提醒跟着挪（在周四截止之前）；不新建；回复说出新时间

已有的待办（运行那一刻）：

- `todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-21T07:00:00+00:00，没做，提醒 2026-10-21T04:00:00+00:00，在「In Hand」里
- `todo_4d5e6f7a8b9c0d1e` 买营养土，截止 无截止，没做，在「In Hand」里

用户：

```text
> 交季度报告

改到周四
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo update，galley todo show）；galley todo update todo_2b3c4d5e6f7a8b9c --due=2026-10-22T15:00 --remind-at=2026-10-22T12:00 --supervisor=galley-assistant --reason=用户要求将交季度报告改到周四，保留原时间并同步移动提醒；galley todo show todo_2b3c4d5e6f7a8b9c

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：`todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-22T07:00:00+00:00，没做；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
已改到 **10月22日（周四）下午3点**交季度报告，提醒也同步改为当天中午12点。
```

建议标签：把季度报告的提醒改到周四上午9点

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. code_run（galley todo update）；galley todo update todo_2b3c4d5e6f7a8b9c --due=2026-10-22T15:00 --remind-at=2026-10-22T12:00 --supervisor=galley-assistant --reason=用户要求交季度报告改到周四，同步顺延提醒

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：查了；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：`todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-22T07:00:00+00:00，没做；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
已改到 **10月22日（周四）下午3点**交季度报告，提醒也顺延到当天中午12点。
```

建议标签：把季度报告的提醒改到周四上午9点

## 9. whats-left（问还有什么没办）

**期望**：「In Hand」是段首快照（买营养土那时还没做；续签合同是这段里刚记的、不在快照里），之后用户在面板上勾掉了营养土 → 先 todo list 读最新的，答季度报告、房东、续签合同，不把营养土当成没办

上下文：

> 用户：记一下，周五前要把房屋合同续签了
>
> 助手：记下了：周五前续签房屋合同，周四晚上 8 点提醒你。

已有的待办（运行那一刻）：

- `todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-21T07:00:00+00:00，没做，提醒 2026-10-21T04:00:00+00:00，在「In Hand」里
- `todo_1a2b3c4d5e6f7a8b` 给房东回电话，截止 2026-10-18，没做，提醒 2026-10-18T02:00:00+00:00，在「In Hand」里
- `todo_4d5e6f7a8b9c0d1e` 买营养土，截止 无截止，没做，在「In Hand」里，分段开始后用户在面板上勾掉了
- `todo_5e6f7a8b9c0d1e2f` 续签房屋合同，截止 2026-10-23，没做，提醒 2026-10-22T12:00:00+00:00，这一段里刚记下（不在「In Hand」里）

用户：

```text
我还有什么没办
```

### 第 1 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list
3. file_read（galley-assistant-manual.md）
4. file_read（global_mem.txt）

结束：以最终回复结束；读手册：读了（第 3 次调用）；写前读过清单：读了清单；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
- **给房东回电话**：明天（10 月 18 日，周日），上午 10 点提醒。
- **交季度报告**：10 月 21 日（周三）下午 3 点前，中午 12 点提醒。
- **续签房屋合同**：10 月 23 日（周五）前，周四晚上 8 点提醒。
```

建议标签：帮我列一下续签房屋合同要准备什么

### 第 2 遍：过

工具调用：

1. code_run
2. code_run（galley todo list）；galley todo list

结束：以最终回复结束；读手册：读了（第 1 次调用）；写前读过清单：读了清单；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
还有 **3 件没办**：

- **明天（10 月 18 日）给房东回电话**，上午 10 点提醒。
- **周三（10 月 21 日）下午 3 点前交季度报告**，当天中午 12 点提醒。
- **周五（10 月 23 日）前续签房屋合同**，周四晚上 8 点提醒。
```

建议标签：帮我列一下续签房屋合同前要确认的事项

## 10. already-noted（已有同一件）

**期望**：清单上已有「交季度报告」（带提醒）→ 不再记第二件、不再挂第二个提醒；回复说已经记着、几点提醒

已有的待办（运行那一刻）：

- `todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-21T07:00:00+00:00，没做，提醒 2026-10-21T04:00:00+00:00，在「In Hand」里

用户：

```text
对了，周三下午 3 点前我得交季度报告
```

### 第 1 遍：过

工具调用：

1. code_run（galley todo list）；galley todo list

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：读了清单；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
这件事已经记着了：**10 月 21 日（周三）下午 3 点前交季度报告**，当天中午 12 点会提醒你，没有重复添加。
```

建议标签：帮我看看还有哪些待办

### 第 2 遍：过

工具调用：

1. code_run（galley todo list）；galley todo list

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：读了清单；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
已经记着了：**10 月 21 日（周三）下午 3 点前交季度报告**，当天中午 12 点提醒你。
```

建议标签：帮我看看季度报告还缺什么

## 11. wake-todo（待办的提醒到点）

**期望**：待办「交季度报告」的提醒按时到点（Core 的待办叫醒措辞）→ 一两句提醒（季度报告、几点截止），不勾掉、不动任何东西，不出 <no-reply/>

已有的待办（运行那一刻）：

- `todo_2b3c4d5e6f7a8b9c` 交季度报告（备注：报告在 ~/Documents/Q3 季度报告.docx，交给王经理），截止 2026-10-16T20:38:39+00:00，没做，提醒 2026-10-16T17:38:39+00:00（已到点），在「In Hand」里

叫醒消息：

```text
[Galley — not a message from the user] A reminder you set came due. Act on it, then reply to the user. Do not mention this note.

Reminder `sched_8c1e0a7b3d2f4965` on the user's to-do `todo_2b3c4d5e6f7a8b9c` came due. Planned for 2026-10-17 01:38 (Sat), local time. The to-do is the user's own, something they have to do:
<<<
交季度报告
报告在 ~/Documents/Q3 季度报告.docx，交给王经理
>>>
It is due 2026-10-17 04:38 (Sat), local time. Act on it now: remind the user of it in a sentence or two, look something up first, or start a subtask. If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.
```

### 第 1 遍：过

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记得把 `~/Documents/Q3 季度报告.docx` 交给王经理，今天凌晨 **04:38 截止**，还有 3 小时。
```

建议标签：帮我检查一下这份季度报告

### 第 2 遍：过

结束：以最终回复结束；读手册：没读（没写）；写前读过清单：—；手册版本：`0bd72beb`。

新记的待办：无；新建的提醒：无；改过的已有待办：无；取消的已有提醒：无。

回复（去掉 summary 与建议标签）：

```text
记得在今天（周六）04:40 前把季度报告交给王经理。文件是 `~/Documents/Q3 季度报告.docx`，距截止还有约 3 小时。
```

建议标签：帮我检查一下季度报告，看看提交前有没有遗漏
