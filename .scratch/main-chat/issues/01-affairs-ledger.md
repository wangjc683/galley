# 01（A）事项账本后台挖掘

Status: done（`82e1d674` 已推送；2026-10-12 真模型评测通过；Rule 4 补句随票 04 写进 `AGENTS.md`；环境变量开关已由票 04a 改为 prefs，04c 起默认开）

来源：主聊天 PRD 裁决 17、19、22、27（2026-10-12）。

## 目标

每天读一遍用户亲口说过的话，维护一份「这个用户的生活里现在有什么、曾经有什么」的事项账本，供 03 注入、05 生成提醒、04 展示。
本票不碰任何界面，也不把账本注入任何会话。

在 JC 本机，「账本先行，早点积累」不成立：开发机上的会话大多是测试，过滤后几乎没有可读的。本票的作用是「做出来并用合成语料验好」，
真正的积累从 02 上线、JC 开始用主聊天那天起。

## 只读人说的话（产品规则，对所有用户成立）

- 读：`workbench.db` 里 `created_via = 'gui'` 且内置运行时的会话中的用户消息（以后加上手机端）；IM 渠道私聊里的用户消息。
- 不读：CLI、supervisor、定时任务、`system` 建的会话（它们的「用户消息」是别的 agent 或自动化写的）；挖掘任务自己的会话；助理的回复（上游 SOP「只读 user 内容」）。
- 引擎日志没有到会话的映射（`temp/model_responses/` 里没有会话标记），分不清 CLI 测试和人说的话，所以 Galley 会话从库里读，不走上游 L4 路径。
- IM 不进库，只能从引擎日志里认（IM 用户消息带上游前缀「If you need to show files to user, use [FILE:filepath] in your response.」，作为耦合点写进文档）。
  **只归档 IM**：每天把新增的 IM 用户消息抽进账本自己的归档（增量、只存用户的话），日志满 30 天或 500MB 被清（`core/src/model_responses_prune.rs:31-33`）之前完成。

## 起点日期与排除标记

- 起点日期：只读该日期之后的对话。本票先用环境变量开关（先例：`GALLEY_REMOTE_RELAY_URL`，`core/src/remote/config.rs`）：
  设了 `GALLEY_LEDGER_SINCE=YYYY-MM-DD` 才启用，不设则整套功能不运行、不建任何文件。对外的开关与「从现在开始 / 回溯历史」选项随 04 做（其他用户默认回溯，他们的历史是真实使用）。
  JC 本机设成 02 上线那天。
- 排除标记：单个会话或整个项目可以标为「不用于了解我」。本票只做存储与 Core 命令并让挖掘遵守，界面放 04。

## 挖掘

- 以上游「历史重点挖掘 SOP」为起点（内置状态 `memory/L4_raw_sessions/salient_mining_sop.md`）：持续活动、已消失事项、情绪事件；增量；读原文。不改上游文件，不加托管补丁。
- 输入由 Core 准备（当天新增的人说的话，按会话分组，带会话标识与时间），代替 SOP 里的 `all_histories.txt`；增量位置由 Core 记，确定式。
- 任务提示词由 Galley 加一句：测试产品、调试工具的对话不算生活事项的证据。
- 跑法：Core 每天一次（沿用定时任务的补跑思路，调度归 Core，不启用 GA 反射模式），起一个内置会话执行；这个会话不出现在侧栏和已归档列表里。
- 产物放内置状态 `memory/history_insight/`，不放 `temp/`：它是用户状态，运行时升级不得覆盖。
- 用当前默认模型。
- 不用 `native_memory_*` 表：那是 6 月 Galley Native 实验的遗留（`022_native_memory_substrate.sql`），与本票无关。
- 只在内置运行时；外置模式不跑、不碰外部 GA 的任何文件。

## 合成语料与验收

- 编一个虚构用户约三周的对话（剧本给 JC 过目一次），埋好答案：进行中的事、已经结束的事、带情绪的时刻；混进像测试的噪声会话（如「记住暗号蓝鲸 4721」「你用的是哪个模型」）以及 CLI 来源的会话。
- 验收三点：埋好的事挖得到；进行中和已结束分得对；噪声和 CLI 会话不被记成事实。
- 语料与评测脚本可以在隔离的临时状态目录里跑（绝不碰真实内置状态），要真模型，所以和 e2e 一样是手动触发；以后改提示词时当回归集。
- 「懂不懂 JC」等 02 上线、JC 用两周后再看。

## 不做

- 注入（03）、页面与对外开关（04）、提醒（05）。
- 对外发版：本票只在设了环境变量的机器上运行；对外必须与 04 同版。

## 核对

- Rule 4：IM 对话进账本。按 08-13 解释，引擎写进内置状态的东西属于引擎内部状态；落地时逐条核一遍，结论写进 Comments。

## Comments

### 2026-10-12 Rule 4 落地核对（实现时）

依据：`AGENTS.md:148-149`「Galley stores session data and supervisor action metadata. It does not store the conversation between a supervisor and the user in IM / Claude / another agent.」；`AGENTS.md:154-157`「Interpretation (2026-08-13): logs the GA engine writes for its own operation under the managed state root (e.g. `model_responses`, …) are engine-internal runtime state, not Galley conversation storage. This rule governs Galley's own database and product surfaces.」

1. 读引擎日志：只读 `temp/model_responses/`，与 `/restore` 读的是同一批文件，属于 08-13 解释里的引擎内部状态。一致。
2. 不进库：IM 原话只写进内置状态 `memory/history_insight/galley/im_archive.jsonl`，`workbench.db` 里只多了排除标记（迁移 045）。「governs Galley's own database」这一半守住了。一致。
3. 归档本身：它不是「引擎为自身运行写的日志」，而是 Core 为账本写的、专门比日志活得久的副本（就是为了躲过 30 天 / 500MB 清理）。08-13 的字面盖不住它。把它看成上游 L4 归档的替身说得通（上游 `reflect/scheduler.py:62-74` 也把日志永久压进 `memory/L4_raw_sessions/`；Galley 不开反射模式，由 Core 代做其中「只存用户原话」的一步），但这是延伸解释，不是现成结论。
4. 内置 IM 渠道的 agent 在 Galley 里就是 supervisor（`runner/im_wechat.py:68`「Galley 托管的微信渠道固定由 supervisor 处理消息」），所以第一句的字面也指向这条对话。归档只存用户一侧的话、不存 agent 的回复，削弱了这层张力，没有消除。
5. 账本产物（模型写在 `history_insight/` 的条目，含情绪事件）将由 04 页面展示，属于「product surfaces」。

结论：读日志、不进库两点与 08-13 解释一致；IM 归档与账本产物是 08-13 字面之外的新情形。建议对外发版（与 04 同版）前在 Rule 4 补一句解释，例如「事项账本在内置状态里保存用户本人在 IM 里说过的话（`memory/history_insight/`），作为引擎记忆层的一部分，是用户状态，不进 Galley 数据库」。改宪法由 JC 定，本票没有动 `AGENTS.md`。

### 2026-10-12 实现回报要点（主会话复核：rebase 到 02 之后 Rust 905 通过、GUI 1033 通过、typecheck / lint / diff check、评测 selftest 通过）

- 排除标记是独立表 `ledger_exclusions`（迁移 045），会话或项目二选一，删除随之级联；项目标记覆盖项目内全部会话。
- 来源：消息与会话两级都要 `created_via = 'gui'`，所以 CLI 往人的会话里 `session send` 的话也不读。
- 每天 04:00 之后到期一次，错过当天任意时刻补跑；失败当天不重试；`run_ledger_now` 可手动触发。
- 挖掘会话：来源 `system`、supervisor `galley-ledger`，不广播创建事件；GUI 列表与手机端都过滤掉；跑完关 runner 并归档。运行中退出 Galley 会提示有任务在跑；CLI `--all` 看得到每天一行归档。
- 位置只在干净完成（无致命错误、无 ask_user、无漏事件）后前移；失败则下批重做。
- 任务提示词多了一条：不许调用 `start_long_term_update`、不许改全局记忆（否则挖掘结果会经全局记忆注入所有会话，违背本票「不注入任何会话」）。
- IM 已知缺口：群聊与私聊分不开；文本协议里带图的 IM 消息漏掉。
- 改起点日期不会回读更早的历史，「回溯」随 04 做。
- 评测：`python3 .scratch/main-chat/ledger-eval/run_eval.py run --mykey <mykey.py> --ga-python <python>`，直接跑引擎、不经 Galley 的运行时提示词与模型配置；模型那一步尚未跑过。

### 2026-10-12 首次真模型评测（林晓三周语料，外置 GA `mykey.py` 第 0 个模型，三批、约 13 分钟）

- 预处理六项全过：CLI、supervisor、排除项目、助理的建议、起点日期之前都没进批次（暗号噪声按设计进批次，交给模型忽略）。
- 产物：埋好的进行中 / 已结束 / 四个情绪时刻全部命中；暗号噪声与五类不该出现的内容全部缺席；每条带会话标识与原文。
- 4 条检查器警告是关键词跨区命中，不是分错：「进行中」与「已消失」两区独立，没有同一条目跨区；警告来自合理拆分（妈妈手术本体已结束、术后康复进行中；豆包打针已结束、控制体重进行中）。
- 轻度多记 1 条：A010「banner 改尺寸」一次性小活被记为进行中（理由「没见交付完成」），SOP 说通用动作不单独成条。A009「双十一」有原文依据，且注明不推断。
- 给票 03 的输入：三周后 `activities.md` 已 17KB，整份注入不现实；注入要从账本派生一份短的事项清单，不是整份文件。
