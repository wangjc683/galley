# 飞书 / Telegram / 微信重启后接回上下文

日期：2026-09-30
关联：`runner/im_resume.py`、`runner/managed_im_supervisor.py`、`core/src/im_supervisor/`、
[Discord 对齐 devlog](./2026-09-30-discord-conversation-ux.md)「重启后无缝续接」节（补丁 `0026`，本题的母本）、
[GA baseline](../ga-baseline.md) Contract Surface item 16、`.scratch/im-restart-continuity/`（发版后删）

## 起因

Discord 重启续接（`0026`）真机通过后，JC 问飞书和 Telegram 是否也该「重启 channel 保留激活」。读码：这三个渠道没有激活门槛，
重启后照常回复；它们丢的是上下文，而且是**静默**丢——整个进程一个 agent（`fsapp.py:562` 懒建、`tgapp.py:46`、`wechatapp.py:305`
模块级），启动即空白，连 Discord 原来那句「请重新 @」都没有。

- 重启远比想象频繁：`feishu.log` 里「飞书 Agent 已启动」353 次，当天 8 次。来源不只手动重启：改模型配置后 toast 的「重启 Channels」CTA、
  app 更新、tauri dev。
- 「重启 Channels」确认弹窗只写「可能中断当前回复；不会退出登录」，没告知上下文会丢。
- 用量：飞书日志 6319 行、Telegram 746 行、微信 368 行。

## 裁决（JC，2026-09-30）

- 四案：F1 飞书 + Telegram、F2 再加微信、F3 只飞书、F4 暂缓。我推荐 F1（微信真机要扫码、用得少），**JC 裁 F2**。
- 行为照 `0026`：记当前 GA 日志文件名、启动时接管上一进程留下的锁并续接、接不上时下一条回答提示一次、`/new` 换新日志。
- **不加过期规则**（闲置 N 小时后不续接）：上下文长度由 GA 裁剪兜住（`llmcore.py` `trim_messages_history`：超过上下文窗口约 3 倍字符数
  时裁到 60%，早期内容只剩工作记忆摘要），「有时记得有时不记得」比「一直记得、要清就 `/new`」更难理解。代价：每轮 token 贴着裁剪线；
  过去频繁重启相当于隐性 `/new`，一天重启 8 次的开发者感受最明显。
- 主会话补裁两项（JC 事先授权「自主执行到底」，这里记下判断）：
  - **微信补 `/new`**：F2 的直接后果。上游微信前端没有 `/new`（`on_message` 只认 `/switch` `/stop` `/llm`），重启是它清空上下文的唯一途径；
    续接之后若不补，微信的上下文将永远清不掉。Settings 微信卡片的命令参考随之补 `/new`，删掉已不成立的「微信入口目前保持官方 GA 命令集」。
  - **断开连接清掉续接状态**：子代理实施中提出——Core 断开时只删凭据，映射留着，断开后换账号或 bot 重连会接回上一个账号的对话；
    Discord 的激活频道同理（`0026` 之前内置模式启动即释放激活频道，断开重连本来就从头开始）。定为：断开 = 这个渠道的对话结束，
    Core 的 `logout` 删 `context_log.json`，Discord 另删 `discord_active_channels.json`；GA 日志本身不动（引擎运行状态）。**解绑使用者
    不清**（新使用者会接上旧对话）：Galley 是个人助手，换人解绑罕见，而换人后对方拿到的是能驱动本机 CLI 的 supervisor，上下文不是主要风险；
    真出现再议。

## 实施

组合拳（Opus 子代理实施，主会话写票、审码、补 Core 与 GUI）。按票面的架构偏好**全部在 supervisor 侧**完成，没有新增托管补丁——
延续微信 conductor 修复的先例（[09-08](./2026-09-08-wechat-conductor-mode-dead-path.md)：supervisor 侧已有同类 poke，多一个补丁只增加
rebase 面）。

- **共享模块 `runner/im_resume.py`**：三个渠道共用，与 dcapp `0026` 一一对应（`resume` ↔ `_resume_channel` 等，模块 docstring 点名）；
  dcapp 保留自己那份，因为 managed GA 代码不能反向 import `runner`。映射文件是各渠道 state 目录里的 `context_log.json`，只有
  `{"log": "model_responses_<logid>.txt"}`。
- **每个渠道用的缝**：

  | | 启动续接 | 映射回写 | 接不上的提示 | `/new` | `/continue N` |
  |---|---|---|---|---|---|
  | 飞书 | supervisor 的 `_managed_get_agent` 包装里，懒建 agent 那一刻（加锁防并发首调） | `agent._turn_end_hooks` | `fsapp._TaskCard` 换成子类，`done` 时回答区首行 | 替换 `frontends.chatapp_common._reset_conversation` | 替换 `_handle_continue_frontend` |
  | Telegram | reporter 与 `main()` 之前对 `tgapp.agent` | 同上 | 包 `_send_answer` / `_post_ask` 武装、`_reply_markdown` / `_reply` 注入斜体首行 | 替换 `tgapp.reset_conversation` | 替换 `tgapp.handle_frontend_command` |
  | 微信 | `agent.run` 线程与 `run_loop` 之前 | 同上 | 递给上游 `on_message` 一个包住 `send_text` 的 bot 代理 | supervisor 的 `on_message` 包装拦截 | 不适用（微信从来没有 `/continue`） |

  代价：supervisor 侧替换了一批前端模块全局名（其中 tgapp 的几个是 Galley 自己 `0024` 的私有函数），全部记入 ga-baseline item 16；
  测试跑在真实的 tgapp / fsapp / wechatapp 代码上，改名会在测试里直接失败，运行时缺名只打日志、该渠道退回旧行为（重启后空白）。
- 子代理的自行裁量（主会话审过接受，细节在票面 Comments）：Telegram 斜体直接写 MarkdownV2 `_…_`（注入点拿到的已是转换后文本）；
  首段放不下提示时单发一条在前（只在 4096 / 3000 字边界出现）；飞书提示放卡片回答区首行；微信 `/new` 遇在跑任务时按 `/stop` 语义标记
  `_task_aborted`，但只在任务真在跑时才标（上游 `/stop` 无条件标，空闲时发会把下一条任务错标成已停止）；飞书首条消息会阻塞一次日志读取
  加解析（本机真实日志 4–315 KiB）。
- 已知小缝：续接失败后若先来的是报告轮，待提示标记只在内存里，此时再重启一次提示会丢；`/new` 与在跑任务之间有窄竞态，那一轮回复可能
  落进新日志——与 dcapp 一致，未处理。

## 验证

- runner：pytest 461 passed（新增 `test_im_resume.py` 39 条：共享逻辑一组，三个渠道按「有映射 / 上一进程的新鲜锁 / 无映射 / 日志缺失」
  参数化，再在真实前端代码上测提示、`/new`、`/continue`；子代理在副本里做 33 个变异抓到 32 个，漏掉的是 Telegram 一处多余的防御性 `pop`，
  行为上区分不出）；`test_reporter_through_real_tgapp_seams` 保持通过；mypy strict、ruff 绿。只读核对本机最近 12 个真实日志均为 native
  格式、可被续接解析（只打计数，未看内容）。
- Core：`cargo check` / `cargo test --workspace` 全绿，新增 `remove_conversation_state_drops_resume_state_only`；`manager.rs` 只格式化了
  自己改的 `use` 块（该文件另有一处既有 rustfmt 差异，未动）。
- GUI：typecheck、lint 绿；改动的 hunk 与 prettier 输出一致。
- `git diff --check`、`check-managed-ga-payload`、`check-ga-baseline-drift` 绿；`managed-ga/` 零改动。
- **真机待验**（三个渠道各一遍）：说一句要记住的话 → 重启 Channels → 再问，接得上（渠道日志出现 `[galley-im-resume] resumed from …`）；
  30 秒内连续重启两次仍接得上；`/new` 后重启不接回旧对话；微信 `/new` 回执；断开再连接后从头开始；Telegram / 飞书重启前派出的
  session 在重启后跑完，报告照常投递。
