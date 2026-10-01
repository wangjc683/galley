# 跑满单次步数上限后卡死：桥补收尾，外加兜底安全网（galley#29）

日期：2026-10-01
关联：[galley#29](https://github.com/wangjc683/galley/issues/29)、`runner/workbench_bridge.py`（`_on_turn_end`、`_open_run`、
`_close_run_without_exit`）、`gui/src/components/conversation/StepLimitTail.tsx`、[GA baseline](../ga-baseline.md) 契约面第 17 条、
[IPC 协议](../ipc-protocol.md) §4.7 / §4.9、[设计：Goal run 一节](../design/conversation.md)、[deferred](./deferred.md) 两条（计划模式上游
issue 草稿、`max_turns` 可配）

## 现象

社区报告（v0.5.3，Windows，内置内核）：一次运行连续跑满 180 步后，引擎其实已经停了（不再有 LLM 请求，`model_responses` 恰好 180 次），
界面却一直「工作中」，计时器涨到 84 分钟，新消息发不出去，只能手动停止。报告附了逐行根因和修法建议，本次核对全部属实。

## 根因（逐行复核，main = v0.5.5）

1. `managed-ga/code/agent_loop.py:50` 是 `while turn < handler.max_turns`。第 180 轮循环内那次 `turn_end_callback`（`:101`）带的
   `exit_reason` 是 `{}`；循环退出后 `:104 if exit_reason:` 为假，不再回调；`:106` 返回的 `MAX_TURNS_EXCEEDED` 被
   `agentmain.py:221 for chunk in gen` 丢掉。上限写死在 `agentmain.py:218`（180），计划模式在 `ga.py:475` 降到 100。
2. 桥只在 `_on_turn_end` 的 `if exit_reason:` 里发 `run_complete`、清 `run_in_progress`，否则预测性发下一步的 `turn_start`，界面显示
   第 181 步一直转；`agentmain.py:234` 的任务级 `done` 被有意忽略。
3. 三处都只认 `run_complete`：GUI 停止转圈（`ipc-handlers.ts`）、Core 消息队列出队（`message_queue.rs:164`，所以 GUI 发消息不是被拒，
   而是永远排队）、Goal 引擎结算（`goal_engine.rs:290`，无人值守的 Goal 一起冻住，时长上限也不判）。
4. 上游 `agent_loop.py` 与我们一字不差（截至 `2538ad9`），外置模式同样会卡。IM 渠道不卡：它们收到 `done` 就收尾
   （`frontends/chatapp_common.py:340`）。#30 的现象 2（队列只进不出）是同一个根因。

issue 没提的两点：非计划模式下 GA 在第 175 步会插「必须 ask_user 汇总」（`ga.py:605-606`），报告者的模型没理会才撞到 180；计划模式
跳过这条提醒，190 步的计划模式警告在 100 的上限下永远到不了，是上游改数字时漏改（`a5aca59` 上限 100 / 警告 90，`df025ab` 把默认上限
抬到 180、警告挪到 190，计划模式上限没动）。

## 裁决（JC，2026-10-01，「按你的推荐和建议开始一个一个修」）

1. **修法：A，再加带代次的兜底**。否掉的两个：
   - issue 原样的兜底（drain 收到 `done` 就补发收尾）：Stop 或正常收尾后 Core 立刻派下一条，旧运行迟到的 `done` 会把新运行误关；
   - 内核补丁改 `agent_loop.py:104`：只修内置、外置照卡，而且是第一个碰基线契约文件的补丁。
2. **撞上限后的呈现**：线程尾一行 + 输入框灰字预填「继续」+ 系统通知不说「回复完成」。
3. **`max_turns` 按会话可配**（issue 建议 C）：不做，进 deferred，启动信号是修完后仍有人嫌 180 不够。
4. **计划模式缺提醒**：给上游提 issue、不打补丁；草稿进 deferred，随 #29–#32 的回帖一批给 JC 确认后再发。

## 实施

**桥**（两种运行时模式共用，只读 GA 状态，符合宪法第 1 条的 attach 边界）：

- `_on_turn_end`：`exit_reason` 为空且 `turn >= ctx["self"].max_turns` 时，就是 GA 的最后一轮，当场合成
  `{"result": "MAX_TURNS_EXCEEDED", "data": {"maxTurns": N}}`，之后走正常收尾（带 exitReason 的 `turn_end`、telemetry、`run_complete`、
  清状态），时序与正常结束相同，没有竞态。用 `>=` 是因为计划模式会中途降上限。
- 兜底：每次开运行在完成锁内给运行编代次（`_open_run`），drain 记住自己那次运行的代次；收到非 `system` 的 `done` 时，代次一致且运行仍开着，
  才以 `DONE_WITHOUT_EXIT` 关运行。覆盖任务循环抛异常、`_stop` 文件中断，以及以后任何漏发收尾的路径。
- 执行代理偏离票面加的一处（采纳）：**Stop 时也换代次**。否则 `abort()` 让 GA 放出 `done`，drain 可能抢在 Abort 之前以
  `DONE_WITHOUT_EXIT` 关掉运行，Core 收不到 `ABORTED`，Goal 不会转为暂停，用户按了停止它还接着跑。
- 验收时追加两处：
  - 兜底关运行前先发一条 `runtime` 错误：任务循环抛异常时带 GA 附在 `done` 末尾的 backend error（去掉源码位置，免得源码行里的
    `timeout=` 之类把提示误判成网络问题），其他情况发一句通用说明。用户能看到原因；Core 把这次运行记为出错，进行中的 Goal 转为「受阻」，
    而不是在稳定抛异常的任务上无限续跑。
  - 斜杠命令的 `SLASH_COMMAND_COMPLETED` 补上同样的代次比对（被 Stop 退役的命令迟到的 `done` 不再关掉新运行）。

**GUI**（只在内存里，不加迁移、不动 Core）：

- 线程尾 `StepLimitTail`：「已达步数上限 · 回复「继续」接着跑」，视觉照抄 `GoalPausedTail`，只在会话空闲时出现，有 open Goal 时让给 Goal。
  文案不写数字（计划模式上限不同）；执行代理初稿是整句带句号，验收时改成 Goal 线程尾「状态 · 动作」的写法，状态词与通知标题同句。
- 输入框灰字预填「继续」（替换模型这一步的下一步建议）。
- 系统通知沿用「回复完成」的开关与节流，标题换成「已达步数上限」，正文只放会话标题。
- 验收时追加：侧栏写「已暂停 · {摘要}」。中止的会话侧栏本来就写「已中止」，代码注释原话是中止的会话不能声称已完成，撞上限同理。

## 影响面与没跟的

- **外置模式**：随桥一起修好，零额外差异。
- **IM 渠道**：本来就不卡。撞上限时它们同样只是安静结束，没有「已暂停」提示。这次不跟：要跟得给每个渠道的 frontend 打补丁，因为
  `agentmain.run()` 把 `MAX_TURNS_EXCEEDED` 丢了，frontend 拿不到。这是显式代价。
- **CLI / supervisor**：Agent API 不暴露 `exitReason`，`session wait` 在撞上限后照常返回最后一步，supervisor 分不出是撞上限还是做完了。
  留给 #30 一起看。
- **不折叠**：撞上限的运行最后一步不是收口答案，按 run-groups 的形状判定不折叠、整段平铺，与中止一致。这是现有规则，不是本次引入的。
- **重启即忘**：`exitReason` 不落库，重启后线程尾、灰字、侧栏「已暂停」都消失，侧栏回到「已完成」。与内存里的系统消息同样处理，接受。
- **兜底已知边角**（都极少，代价只是提示文字）：`_stop` 中断时文本恰好以「`词: `」开头的代码块结尾，会被当成 backend error 报出；Core
  forwarder 遇到 broadcast `Lagged` 会丢事件，万一丢的正是这条 error，Goal 仍会续跑（原有行为）。

## 本机数据

`workbench.db`（2026-05-15 到 09-28）按两条用户消息之间算一段运行：410 段，最长 52 步，≥ 50 步的只有 1 段，没有一次接近 180。JC
自己的用法碰不到这个 bug，撞上的是报告者那种无人值守的长任务。也印证了「上限可配」先不做。

## 验证

- 桥：pytest 479 passed（新增 20 个用例：到顶合成、计划模式形状、未到顶不变、无 `max_turns` 不变、同代次兜底、正常收尾后 / 过期代次 /
  Stop 后的迟到 `done` 不误关、Stop 与 `done` 抢锁、backend error 提取与源码位置剥离、斜杠命令代次比对）；去掉 Stop 换代次、代次比对、
  到顶合成、兜底中任意一处，对应用例转红。mypy strict、ruff check、`git diff --check` 绿。
- GUI：typecheck、lint（`--max-warnings 0`）绿，vitest 563 passed（新增 21 个：标记的设置与清除、灰字、通知标题、`DONE_WITHOUT_EXIT`
  不出线程尾、侧栏副标题）。
- 端到端：临时把 `managed-ga/code/agentmain.py:218` 的 `max_turns=180` 改成 3（debug 构建直接读仓库里的 `managed-ga/code`，
  `core/src/managed_runtime.rs:318-322`），用 CLI 发五步任务：第 3 步后运行自己收尾（`agentRunning` / `openRun` 回到 false）；第 3 步
  的消息行带 telemetry（只有带 exitReason 的 final `turn_end` 才有），`errored` 为 0，说明走的是主路径而不是兜底。验收期间 dev 起的
  飞书 / Telegram / Discord 渠道读同一份代码，也会在第 3 步停；验完即改回 180、停掉 dev，未提交。
- 真机：JC 在 dev 里按验收清单测试，无问题（线程尾、侧栏「已暂停」、灰字「继续」、再次发送后线程尾消失、后台通知标题、整段平铺）。
