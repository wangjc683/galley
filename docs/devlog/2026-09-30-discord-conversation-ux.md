# Discord 对话体验对齐桌面端：一条状态消息 + 回答首行小字

日期：2026-09-30
关联：`managed-ga/patches/0023-managed-discord-conversation-ux.patch`、`runner/im_reporter.py`、
[Discord 渠道落地](./2026-08-13-discord-channel-shipped.md)、
[conversation.md](../design/conversation.md)（Turn 结构、live 两行窗口、ask_user 气泡）、
[§9 Channels](../design/overlays-and-settings.md)、`.scratch/discord-ux/`（发版后删）

## 起因与现状诊断

JC 想优化在 Discord 里和 Galley 对话的体验。读码结论：Discord 是四个渠道里前端最简陋的——Galley 的 `0018`
只做接入层（配置注入、配对、连接状态、关闭协议），对话体验是上游 `frontends/dcapp.py` 原样，而上游这个文件
自 2026-05-08（`6738e17a`）后未动。Telegram 的流式编辑、ask_user 按钮是上游 tgapp 自带（`0014` 未碰），Discord 没有对应物。

找出的五个问题（两个是缺陷）：

1. **ask_user 的问题与候选被吞**：GA 把 ask_user 回显成 `🛠️ ask_user(问题\ncandidates:\n- A…)`，dcapp 的 🛠️ 清洗正则
   把它连同候选整块删掉，用户只看到该步 `<summary>` 一句。脚本复现确认。IM 提示词要求删 project 前确认、GA 轮次过多时
   强制 ask_user，这条路径是活的。
2. **`/btw` `/review` 列在 `/help` 里，发了只回 help**：dcapp 覆盖了 mixin 的 `handle_command`，漏两支。
3. 忙时再发消息立刻回「思考中...」（实为排队）；第一轮 `finally` 会 pop 掉第二轮的运行登记。
4. 过程噪音：「思考中...」+ 每步「步骤N：」+ 每 20 秒「⏳ 还在处理中」，每条独立消息、手机各推送一次。
5. 完成报告是纯文本，与刚才的回答长得一样。

## 裁决（JC，2026-09-30）

- **范围**：A 降噪 + B 交互补齐（含三个缺陷）先行，C 报告卡片化紧随，**D 原生斜杠命令暂缓**（进 deferred；
  当时 `discord.log` 里 7 条消息全部 `command=False`，JC 的用法是说话不是敲命令）。
- **形态以桌面端为准**（JC：「为了统一体验，参考桌面端」）。agent 补上决定映射方式的平台差异：**发新消息 = 手机推送一次；
  编辑旧消息 = 不推送，但挂「（已编辑）」**。于是：
  - 桌面 live 窗口 → 一条**状态消息**原地编辑（`已完成 N 步` / `NN summary` / `·· 思考中`，N ≥ 2 才出头行）。
  - 桌面「完成即折」→ 状态消息**删掉**，折叠头变成回答**首行 `-# N 步 · 用时 X`**（Discord subtext ≈ ink-muted 安静眉头）。
    一轮只剩一条消息、只推一次、不留「（已编辑）」。
- 逐项对表后的取舍：
  - **照搬**：`··` 占位与落定盖章、ask_user 不切断 run 计数（09-18）、`candidateLayout` 同阈值、回显勾所选、1 步 run 也带头（真机可翻）。
  - **改写**：3 秒起读秒 → 不读秒，单步 ≥ 60 秒才显示「已 N 分钟 · 仍在运行」按分钟更新（每秒编辑撞频率限制）；
    shimmer → Discord 原生 typing（同属「live 归外围」）；Composer Stop → 状态消息上的「停止」按钮，停止后状态消息**不删**，
    定格 `⏹ 已停止 · N 步 · 用时 X`（没有回答可挂眉头，得留痕）。
  - **去掉**：折叠头的气味段——supervisor 的工具几乎全是 `code_run` 调 Galley CLI，「运行代码 ×3」无信息量。
  - **做不到**：实时思考预览——Discord 前端 `verbose=False`，拿不到 LLM 增量。
  - **暂缓**：点折叠头展开步骤（候选形态：回答下挂按钮、回 ephemeral 步骤清单；嫌每条回答多一排 chrome），进 deferred。
- 上一轮提的「点选后回显一行还是标在按钮消息上」由桌面对表直接回答：在提问消息上勾所选（= `AnsweredAskUser`），不另发一行。

## 实施

组合拳两路并行（两个 Opus 子代理，文件不重叠），主会话写票、审码、集成验收：

- **`0023`（dcapp，01 + 02 同一补丁）**：状态消息生命周期（排队 → 运行 → 删除 / 定格）、步落定口径与桌面 turn_end 一致
  （出现 turn > k 的 item 才算步 k 落定）、摘要三级回退（`<summary>` → 首行旁白 → 「调用了{工具中文名}」）、
  **回答只取收尾那一步**（`outputs[-1]`；此前 `_display_done_text(raw)` 会把每一步的中间旁白拼进回答，桌面的回答只是
  `finalAnswer`）、中间插了别的消息才以 reply 引用原问题、1.5 秒编辑节流、`user_tasks[chat_id]` 改为按序的 run 列表。
  ask_user 走 `agent._turn_end_hooks`（tgapp 的 seam）而不解析回显，事件按发起任务的 display queue 认领；
  按钮不用 View 回调而是在 `on_interaction` 按 `custom_id` 路由（View 发送前 `stop()`，不进 ViewStore 常驻内存），
  所以进程重启后残留的旧按钮也能被静默应答并去掉，而不是显示「交互失败」。新增严格发送 seam `deliver_embed`。
- **reporter（03）**：`ChannelAdapter.send_report(owner, text, raw, report)` 默认转 `send`，只有 `DiscordChannel` 覆盖成
  embed 卡片——标题 = session 标题，色条取 foundations 的 light token（完成 success / 停止 info 中性 / 出错 error），
  footer `状态词 · session id`；> 4096 的正文卡片放前段、余下 `deliver_text` 紧随。老 payload 没有 seam 时退回纯文本；
  seam 失败算 retry，不降级。飞书 / Telegram 行为逐字节不变。

实施偏差（子代理自行裁量、主会话审过接受，细节在补丁台账行与票的 Comments）：回显保留该步旁白（按模板字面编辑会让
旁白从频道消失）；无候选的 ask_user 也发提问（照抄 tgapp 会继续吞纯问题）；并行拆分的同问题 ask_user 合并候选（同桌面
`mergedAskUserArgs`）；`/review` 不加 FILE_HINT 原样入队（加了会挡住 GA 自己的 `/review` 拦截，上游 mixin 同病）；
agent 正在跑 reporter 报告轮时用户消息也显示「排队中」；排队的 run 等成为队首才读 display queue（保证前一个 run 的
回答 / 提问先落地，代价是计时起点晚不到 1 秒）；回答正文补回 `done` 超出逐步文本的尾巴（GA 后端异常块只追加在那里）。

## 集成验收：组合地带的两处

08-13 的教训（「票与票之间的语义组合是没有主人的地带」）这次在票面上预先点名，主会话逐条踩：

- **seam 契约**：用真实 dcapp 模块（stub discord）+ reporter 的 `DiscordChannel` 端到端发一次 > 4096 的报告，卡片与余段、
  颜色、footer 全对——补为回归测试 `test_reporter_card_through_real_deliver_embed`。
- **busy 口径**：`DiscordChannel.busy()` 读 `app.user_tasks.get(chat_id)` 的真值；改成 run 列表后排队 / 运行 / 空闲三态
  均正确——补为 `test_reporter_busy_tracks_queued_and_running_runs`。
- **有意保留的缝**：提问待答期间频道没有 run，busy 为假，报告轮可以插在「提问」与「回答」之间。**裁决保留**：
  若让 busy 同时看待答提问，用户迟迟不答时报告会被无限期扣住（busy 不计重试次数）；报告 prompt 自述「automated request,
  not a user message」，模型不会把它当回答；Discord 侧的待答提问与续跑计数不受报告轮影响（报告轮不经 `run_agent`）。
  代价：GA 历史里提问与回答之间夹一段报告往返。若真机出现模型把报告当回答的情况再重审。
- 另一处行为变化：文本 `/stop` 不再 abort 报告轮（报告轮对用户不可见，「当前没有在跑的任务」与所见一致）。

## 验证

- 补丁栈：干净克隆（`~/Documents/GenericAgent` 的只读克隆，checkout `1b6442f`）+ `build-managed-ga.sh` 重放 22 个补丁全部
  clean，重建出的 `dcapp.py` 与工作区逐字节一致（主会话独立复核一次）；`check-managed-ga-payload.mjs` 绿。
- runner：pytest 343 passed（新增 `test_managed_discord_dcapp.py` 34 条、`test_im_reporter.py` 新增 14 条），mypy strict、ruff 绿。
- **真机 dogfood：JC 验收通过（2026-09-30）**，`tauri dev` 下走完 04 的清单（debug 构建直接读仓库 `managed-ga/code`；
  先退出 /Applications 里的 Galley，否则同 token 双回复）。三个留给真机的判断点按现状保留：1 步回答也带小字、
  回显保留该步旁白、停止 / 暂停后 typing 最长约 10 秒的残留（Discord 无「停止输入」API）。

## 同批发现、另立题

`discord.log` 里 JC 当天一问（12 字）让 supervisor 跑了 `galley llm --help`、`llm list` 和
`sessions list --runtime all --all`，上下文从 658 涨到 28574 字符、三轮才答——四个 IM 渠道共享的提示词 / CLI 用法问题，
立为 `.scratch/im-supervisor-context-bloat/`（needs-triage）。

## 真机后追加：去掉停止按钮（JC，2026-09-30）

JC 继续打磨时提出：状态消息上的「停止」按钮有点没必要，而且是中文，英语用户会觉得奇怪。拆成两件事讨论：

- **按钮**。读码补上的事实：按钮只 abort supervisor 这一轮，派出去的 Galley session 照跑、报告照回（`managed_prompt.rs`
  IM 入口层：重活交给 session），与桌面 Stop 停的是干活的 session 本身并不对等；真正会拖长的只有 `session wait`，停止在这里
  的作用是「把频道要回来」；桌面 Stop 是纯图标（`ComposerActionSlot.tsx`），Discord 却写成了带字的「停止」；Telegram 本来就只靠
  `/stop`。三案：A 去掉只留 `/stop`；B 换纯图标 ⏹；C 纯图标且本轮满 60 秒才挂。我推荐 C（Discord 没有别的可发现的停止入口，
  A 让卡住时退回手敲），**JC 裁 A**，我同意：第 1 条事实让停止在 Discord 的价值本来就窄，为它每轮挂一排按钮不值；A 还与
  Telegram 一致、外壳少一个要翻译的词。已知代价：运行中想停得手敲 `/stop`（`/help` 与 Settings 命令参考已列），不加
  「发 /stop 可中断」提示，真机遇到再说；[deferred「Discord 原生斜杠命令」](./deferred.md) 记了这条信号。
- **语言**。按钮只是冰山一角：状态消息、回答小字、提问回显、报告 footer 整层外壳都是中文，而模型回复跟随用户语言。
  Discord / Telegram 只认配对绑定的 owner，频道对面就是 Galley 桌面主人，所以方案定为跟随 Galley 界面语言（否决按每条消息
  检测）；**JC 裁决打磨收尾后最后做**，只翻定稿文字一遍。立为 `.scratch/im-chrome-i18n/` 并进 [deferred](./deferred.md)。
- **迁移条件改写**。`0024` 台账行原写「`0023` 下次重导出时把 `galley_im_display.py` 拆成独立补丁排到它前面」，本次重导出
  会触发它。改为随多语言一起做：多语言本来就要把字符串表放进共享文件；而插入补丁会让后续补丁改编号、牵动基线文档与台账，
  打磨期间每次重导出都背这笔成本不合算。代价：打磨期间两渠道共用的规则仍要在 dcapp 与共享文件各改一次。

实施：补丁 `0023` 重导出（`.scratch/discord-ux/issues/05`，Opus 子代理）。`_status_content` 只返回文字，`_on_stop_click`、
`_runs_by_token`、`_DiscordRun.token` 删除；升级前遗留的 `galley-dc:stop:*` 按钮落到原有的 `_ack_stale`——静默应答并去掉按钮，
即使频道此刻有新 run 在跑也不停它；文本 `/stop` 逐字不变。子代理自行裁量、主会话接受：状态消息另两处编辑（停止定格、删除失败的
兜底）的 `view=None` 一并去掉（只为清停止按钮而存在）；「按钮视图只渲染、不常驻」的断言从删掉的测试挪到 ask 按钮测试。
验证：主会话用干净克隆（`1b6442f`）独立重放 24 个补丁，重建后 `managed-ga/code` 与 `state-seed` 全部文件哈希不变；pytest
409 passed，mypy strict、ruff、`git diff --check`、payload、baseline-drift 绿。**真机：JC 验收通过（2026-09-30）**——新 run 的
状态消息没有按钮、长任务中 `/stop` 定格。
