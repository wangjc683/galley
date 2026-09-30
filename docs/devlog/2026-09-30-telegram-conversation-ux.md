# Telegram 对话体验对齐桌面端：草稿当 live 窗口 + 一条回答

日期：2026-09-30
关联：`managed-ga/patches/0024-managed-telegram-conversation-ux.patch`、`runner/im_reporter.py`、
[Discord 对齐](./2026-09-30-discord-conversation-ux.md)（母本，形态裁决多数照搬）、
[Telegram 渠道落地](./2026-07-05-managed-im-supervisor-telegram.md)、
[conversation.md](../design/conversation.md)（TurnMarker 读秒、live 两行窗口、ask_user 气泡）、
[§9 Channels](../design/overlays-and-settings.md)、`.scratch/telegram-ux/`（发版后删）

## 起因与现状诊断

Discord 对齐做完当天，JC 转向 Telegram。读码结论：对话层全是上游 `frontends/tgapp.py` 原样（Galley 的 `0014` 只做接入层），
上游这个文件自 2026-05-26（`f758d1a`）后未动。JC 当天 17:06 刚绑定、问过一次磁盘（2 步），按代码重建是两条推送消息：
第一条是 `LLM Running (Turn 1) ...` 标题 + `<summary>` 引用块 + `🛠️ code_run({...})` 回显，第二条同样带标题和摘要引用，
回答里的 Markdown 表格竖线原样显示。

找出的六个问题（一个是缺陷）：

1. **过程外露、每步一推**：新 Turn 标记一到就把上一步定稿成正式消息；标题、摘要引用、工具回显都是开发者文本。
2. **Markdown 失真**：MarkdownV2 没有表格和标题，`|` `#` 被转义后原样显示。
3. **ask_user**：纯问题不出菜单（去掉回显后会被吞）；问题出现两遍；英文「none of these above」「Done」；答后改成全量选项列表；
   一行一个按钮、长候选截断；打字回答后旧按钮仍可点；全局事件队列让报告轮的 ask 被下一个用户 run 认领。
4. **排队与停止（缺陷）**：`ctx.user_data['stream_task']` 只记最新一条，`/stop` 取消的是排队那条的**显示**——它显示「已停止」，
   但任务还在 GA 队列里，前一条 abort 后在后台照跑、输出无人接收；正在跑的那条反而把部分输出当回答发出。`/new` `/restore`
   `/continue n` 同病。
5. **完成报告**：`render(raw)` 吃全量 `done`，Turn 标记与回显同样漏进报告；HTTP 直发不带 `parse_mode`，`**` 原样。
6. **图片**：每张图一个任务、相册 N 张 N 轮；只给路径不是视觉输入（Discord 同）。

## 平台机制决定映射方式

与 Discord 的「新消息推送 / 编辑不推送但挂已编辑」不同，Telegram 有两件 Discord 没有的原生物件，也缺一件：

- **草稿** `sendMessageDraft`（PTB 22.8 / Bot API 10.0，22.7 起所有 bot 可用）：私聊专用临时预览，不推送、不留痕，
  30 秒不刷新即消失，不能带按钮；bot 一发正式消息草稿即消失（Bot API `keep_on_stop` 参数说明）。
- **原生命令菜单**已注册（`set_my_commands`）：Discord 暂缓的 D 项在这里本来就有。
- **可折叠引用块**（MarkdownV2 `**>…||`）：Discord 暂缓的「步骤展开」在这里是原生、零 chrome 的。
- 缺**小字**：本次约定 Discord 的 `-#` 在 Telegram 一律映射为斜体行。
- `disable_notification` 只是静音（Bot API：「notification with no sound」），不等于不推送——所以静音状态消息不如草稿安静。

## 裁决（JC，2026-09-30「按建议推进」，五点全按推荐）

1. **live 窗口 = 草稿**，不用状态消息：草稿的语义「临时预览、定稿后被正式消息取代」最贴桌面「完成即折」。
   群聊或草稿失败 → 回退 Discord 形态（静音状态消息原地编辑、完成删除）。
2. **停止 = `/stop` 菜单命令**，不做按钮：草稿带不了按钮；桌面 Stop 在 Composer，Telegram 菜单按钮就在输入框旁，
   比 Discord 把停止挂在状态消息上更贴桌面。
3. **折叠头 a / b / c 真机变体实测**：a 斜体首行；b 可折叠引用块（首行 `N 步 · 用时 X`，其下逐步 `NN summary`，点开看过程）；
   c 不要头。默认 b（推荐理由：原生折叠正好补上桌面「点头展开」，Discord 做不到才暂缓的那一项），临时隐藏命令 `/fold a|b|c` 切换。
4. **范围 A + B + C**，**D 图片暂缓**（跨渠道，进 [deferred](./deferred.md)「IM 渠道的图片输入」）。
5. **平台无关逻辑抽共享文件** `frontends/galley_im_display.py`（补丁新增、零 rebase 风险）。**Discord 本轮不迁**：`0023` 在栈里
   排在新文件之前，迁过去会让前面的补丁依赖后面的补丁。迁移条件：`0023` 下次重导出时，先把共享文件拆成独立补丁排到 `0023` 前面，
   再把 dcapp 的 `_` 前缀副本换成导入（台账 `0024` 行 removal condition 也写了这条）。

对表里与 Discord 不同的两处：**读秒照搬桌面**（3 秒起 `· N 秒`、60 秒起 `· 已 M 分 S 秒 · 仍在运行`，落定归零）——Discord 因编辑限流
改成按分钟，草稿编辑便宜，读秒还顺带给草稿续命；**多选保留上游 toggle + 「提交」**——Telegram 已可用，Discord 是退回打字。
其余照搬 `0023`：回答只取收尾一步、去气味段、1 步也带头、ask_user 按 `candidateLayout` 出按钮并在原题上勾所选、续跑计数累加、
按 display queue 认领 ask 事件、`/stop` 不 abort 报告轮。

## 实施

组合拳两路并行（两个 Opus 子代理，文件不重叠），主会话写票、审码、集成验收：

- **`0024`（tgapp + 共享文件，01 + 02 同一补丁）**：上游 `_TelegramStreamSession` / `_TelegramTurnStreamCoordinator` / `_stream`
  整组删除，换成全局按序的 run 列表（只有一个 agent，GA 按入队顺序执行，只有表头读 display queue）+ 每聊天一个 live 面；
  Markdown 在转 MarkdownV2 前做一遍源文本改写（表格转列表、标题转粗体、`>` 转引用块、分隔线删除、列表符号转 `•`）；
  新增 reporter 用的两个 seam `answer_text(raw)`、`markdown_v2_segments(text)`。
- **reporter（03）**：`TelegramChannel.render` 走 `answer_text`（只取收尾一步）；新覆盖 `send_report`：粗体 `{✅|⏹|❌} {session 标题}`
  标题行 + 正文 + 斜体 `{状态词} · {session id}` 脚注，逐段 MarkdownV2 发送，某段 400 改发该段纯文本；状态词抽成
  `report_status_word` 与 Discord 共用。没有 seam 的老 payload 走原路径，HTTP 请求体逐字节不变。

实施偏差（子代理自行裁量、主会话审过接受，细节在票面 Comments）：

- `_CLEAR_DRAFT_AFTER_SEND` 默认关：Bot API 写明空文本草稿显示「Thinking…」占位、bot 发消息时草稿自动消失，票面要求的
  「发完清一次草稿」反而会把占位挂回去。开关保留，真机看到残留再开。
- 停止回执在 `/stop` 当下发、不等 `done`（`/new` 要先 ⏹ 后 🆕），被停的 run 在任何 await 之前同步标记，aborted 任务的 `done`
  不会被当成回答。与 `0023` 同。
- 「正在跑的 run」除了表头已出过 item，还要求 `agent.is_running` 且 `_current_queue` 是它的 queue：表头其实已跑完时 `/stop`
  不误报、不误伤下一个任务或报告轮。
- `/continue n` 只在上游真的重置时才把 run 记为停止：调用期间在 agent 实例上临时包一层 `abort` 记录是否 abort（越界索引不重置，
  否则会重演「显示已停止、后台照跑」）；只在 managed 进程内、单次同步调用内生效，记入 ga-baseline item 15（e）。
- `[FILE:]` 在清洗前渲染成文件名（dcapp 的清洗会整个删掉标记；上游 `_render_file_markers` 的 `.strip()` 又会吃掉 🛠️ 剥离所需的换行，
  测试当场抓到 ask 提问里漏出 `🛠️ ask_user(...)`）。
- 报告脚注写 `*…*` 不是 `_…_`：tgapp 的转换器只认单星号斜体，裸下划线会被转义成字面。
- 折叠头 b 的块超过半条消息时依次把步行截到 60、24 字；轮询崩溃重启后新 run 登记时剔除旧事件循环的死 run。

## 集成验收

- **seam 契约**：真实 tgapp 模块（stub telegram）+ reporter `TelegramChannel` 端到端：多步报告轮 `done`（带 🛠️ 回显、表格）→
  只剩收尾一步、表格列表化、标题粗体、脚注斜体、`parse_mode` 正确——补为回归测试 `test_reporter_through_real_tgapp_seams`，
  第一次跑即通过。
- **busy 口径**不变（`agent.is_running`）：报告轮期间用户发消息显示 `·· 排队中`；报告轮的 ask 不被用户 run 认领——两条均有测试。
- **沿用 Discord 的保留裁决**：提问待答期间 busy 为假，报告轮可以插在「提问」与「回答」之间（理由同 Discord devlog「集成验收」节）。
- **已知小缝**：reporter 的 HTTP 直发不经 tgapp 的消息登记，报告恰好落在触发消息与回答之间时，回答不会引用触发消息。
- 补丁栈：干净克隆（`1b6442f`）+ `build-managed-ga.sh` 重放 23 个补丁全 clean，重建后 `managed-ga/code` 全部文件哈希与工作区一致；
  `check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 绿。
- runner：pytest 407 passed（新增 `test_managed_telegram_tgapp.py` 43 条、`test_im_reporter.py` 21 条），mypy strict、ruff、`git diff --check` 绿。

## 真机第一轮（JC，2026-09-30）与定稿

JC 在 dev 里测了三轮（先要重启 Telegram 子进程：它 17:06 起就在跑、Python 不热更；dev 窗口 Settings → Channels →
「重启 Channels」，飞书 / Discord 当时空闲一并重启），给出三条：

1. **草稿弃用**：发完消息后整块消息被迅速上推、留下一大片空白——客户端给草稿预留流式区域（三轮日志都走草稿、无回退）。
   裁决 1「草稿最贴完成即折」的论证只算了推送与留痕，没算到客户端的布局行为，被真机推翻。**私聊也改走静音状态消息**，
   与 Discord 同形：原地编辑、回答落地后删除、停止时定格 `⏹ 已停止 · …`。代价：app 在后台时状态消息带一个无声横幅。
   `_CLEAR_DRAFT_AFTER_SEND` 等草稿相关代码随之删除。第二轮真机 JC 确认上推留白消失，草稿即成因得到证实。
2. **读秒去掉**：视觉一般。对表里「读秒照搬桌面」作废，改 Discord 规则——不读秒，单步满 60 秒起 `· 已 N 分钟 · 仍在运行`、
   按分钟更新；排队行不带时间。
3. **折叠头定 b**（顶部可折叠引用块）。三变体真机后 JC 拿不定，讨论中我给了两条反对「头放顶部」的理由：Telegram 推送与聊天列表
   预览取消息开头，a / b 会让每条推送以「N 步 · 用时 X」开头；Telegram 没有小字，任何头都是正文分量。据此推了 d（末尾可折叠块、
   ≥ 2 步才挂）和更轻的 e（末尾一行、不带步骤），并引 JC 的桌面用法「主要看时长，步数扫一眼，工具调用正常不细看」
   （[折叠头分层](./2026-09-23-run-fold-header-hierarchy.md)）。听完四案对比后 **JC 裁 b**（未另述理由）。b 保住的是：
   最贴桌面「先过程、后结论、点开看步骤」；IM supervisor 的过程按宪法第 4 条不进 Galley，这里是唯一能看的地方。已知代价：
   推送 / 列表预览被元数据占开头，1 步闲聊也顶一个框。d / e 未实现，不进 deferred（被否，不是暂缓）；临时切换器 `/fold` 与 a / c 两支拆除。

实施：补丁 `0024` 重导出（`.scratch/telegram-ux/issues/05`，Opus 子代理）。两处自行裁量、主会话接受：状态消息只在紧贴触发消息
发出时才接替成为引用锚点（排队 run 的状态消息落在别人的回答之后，否则它的回答不再引用触发消息，与草稿时期不一致）；分钟行从 GA
的第一个 item 起算（同 dcapp，排队时间不算进「思考中」）。验证：干净克隆重放 23 个补丁全 clean、`managed-ga/code` 哈希一致，
pytest 406 passed（tgapp 42 条），mypy / ruff / payload / baseline-drift 绿。

**真机第二轮：JC 验收通过（2026-09-30）**——上推留白消失、分钟行、`/stop` 原地定格、ask_user 按钮 / 打字 / 多选、排队、
完成报告、一轮只推一次，全部通过。
