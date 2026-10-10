# 微信对话体验对齐桌面端：只留「对方正在输入」+ 一条回答

日期：2026-10-10
关联：`runner/im_wechat.py`、`runner/im_reporter.py`、`core/src/managed_prompt.rs`、
[Telegram 对齐](./2026-09-30-telegram-conversation-ux.md)、[Discord 对齐](./2026-09-30-discord-conversation-ux.md)（形态母本）、
[重启续接](./2026-09-30-im-restart-continuity.md)、[IM 入口层](./2026-10-06-im-entry-layer-phone-first.md)、
[§9 Channels](../design/overlays-and-settings.md)、`.scratch/wechat-ux/`（发版后删）

## 起因与现状诊断

Telegram / Discord 打磨完，JC 转向微信。Galley 这一侧只有接入层（`runner/managed_im_supervisor.py`：钉住 agent 模式、补
`/help` `/status` `/new`，`runner/im_resume.py` 续接），对话体验是上游 `frontends/wechatapp.py` 的 `on_message` / `_handle` 原样。
微信渠道此前没人用（JC 的 `wechat.log` 只有 6 月几次扫码过期），所以诊断靠读码 + 把上游 `_clean` 抽出来跑样本；JC 扫码后的现状样本
（「看看磁盘还剩多少」，2 步 → 推了 2 条，末尾 `[任务已完成]`）与读码一致。

找出的十个问题（三个是缺陷）：

1. **过程外露、每步一推**：每落定一步单独发一条，一轮最多 9 条过程 + 1 条回答，每条都推送，首行是该步 `<summary>`。
2. **每个回答挂 `[任务已完成]`**。
3. **ask_user 题干被吞**：回显是多行的 `🛠️ ask_user(题干\ncandidates:\n- A…)`，上游清洗只删第一行——用户看到旁白、英文 `candidates:`、
   选项、多余的 `)`，结尾还挂 `[任务已完成]`，实际在等回复。
4. **缺陷：单步 5 分钟无输出即「完成」**：`dq.get(timeout=300)` 超时后照发 `[任务已完成]` 收工，真回答在后台跑完无人接收。
5. **缺陷：`/stop` 无回执，空闲时发会误伤下一条**：「已停止」标记无条件置位，而 `agent.abort()` 空闲时直接返回，标记留到下一个
   正常完成的回答，把它标成 `[已停止]`。
6. **缺陷：长回答截头**：收尾那条是 `rest[-3000:]`，开头静默丢失。
7. `[FILE:/绝对路径]` 原样留在正文。
8. `1.` 编号被删、链接只剩文字——10-06 入口层为此给微信单开一条提示词。
9. 语音被当文件下成 `.silk`，模型拿到一个路径。
10. 没有完成汇报（10-08 暂缓）。

## 平台机制：先读官方插件，再上真机探针

TG / DC 的 live 窗口靠「编辑不推送、删除不留痕」。微信能不能做，读腾讯官方 iLink 插件
`@tencent-weixin/openclaw-weixin` 2.4.9 的源码：它只发定稿态（`FINISH`），从不编辑、删除；协议里有 `GENERATING` 态、
`delete_time_ms` 字段，还有 2.4.4 起的原生工具进度条目（`TOOL_CALL_START / RESULT`，按 `run_id` 归组），但文档不写它们长什么样，
网上也搜不到。语音消息自带转写（`voice_item.text`，官方直接当正文）；官方按用户持久化 `context_token` 供定时任务主动投递。

决定形态的两个未知数论证不出来，于是**先跑一次探针**（裁决 1，JC 扫码后，渠道停着，一次性脚本给 JC 自己的微信发八组样本）。结果：

- 同一 `client_id` 先 `GENERATING` 后 `FINISH`：**只显示第一版**，后续同 id 的消息被静默丢弃；带 `delete_time_ms` 的删除无效。
  推论：没有原地更新，也没有删除；**每条消息必须用新 `client_id`**。
- 原生工具进度：两种版本号（上游的 2.1.10、官方的 2.4.9）都**不显示**，服务端回 `{}`。
- Markdown 样本（粗体、行内代码、`1.` 与 `1、` 编号、链接、裸链接、表格、H1 / H3、引用、分隔线、代码块）**全部正常渲染**——
  上游 `_strip_md` 的删除是早期微信不支持 Markdown 时留下的。
- 「对方正在输入」取消（`status: 2`）**立即消失**；上游从不取消。
- 不带 `context_token`、带几分钟前的旧 token，主动消息都送达。
- 语音「继续」到达时带 `voice_item.text: "继续"`。

## 裁决（JC，2026-10-10「按建议推进」，五点全按推荐）

1. **先跑平台探针**（上节）。
2. **运行中看什么**：按事先定好的规则走——`GENERATING` 能原地更新就与 TG / DC 同形；否则原生进度可读就用它；都不行就只留
   「对方正在输入」。探针落在第三支：**运行中不发任何过程消息，一轮只推一条回答**。
3. **回答形态**：回答只取收尾那一步，去掉 `[任务已完成]`；完成标识换成**末行** `N 步 · 用时 X`，**≥ 2 步才挂**。理由：微信没有小字也不能
   折叠，首行会占推送与聊天列表预览；TG 选顶部的理由是「点开看步骤」，微信点不开；1 步闲聊的「1 步 · 用时 4 秒」在没有小字的微信里是全字号噪音。
   与 TG / DC「1 步也带头」是有意分叉，真机可翻。完成信号没有删，换到末行与「正在输入」消失上。
4. **范围 A + B + C + D**：回答与降噪、交互与缺陷、语音转文字、完成汇报。D 翻了 10-08 的暂缓：当时三条理由里「真机验证要扫码」这次本来就要做，
   探针证实主动发送可用，也合 JC 渠道改动默认全覆盖的偏好。**暂缓**：引用消息（新版微信引用只带 `svr_id`，官方插件靠本地 SQLite 存消息原文
   才还原得出，Galley 存 IM 原文撞 Rule 4，进 [deferred](./deferred.md)）；图片视觉输入照旧跨渠道暂缓。
5. **落点：runner 侧接管 `on_message`，不加托管补丁**。上游 `wechatapp.py` 是四个 IM 前端里唯一还在改的（6 月以来 4 次提交，tgapp /
   dcapp / fsapp 都是 0），补丁重放风险最高；supervisor 本来就包着 `on_message`，`run_loop` 的回调是现成 seam；09-30 续接已有先例。
   代价：微信展示逻辑与 TG / DC 不在一处；共享规则从 `galley_im_display.py`（`0024` 新增的文件）导入，记为耦合点。

## 实施

组合拳两路并行（两个 Opus 子代理，文件不重叠，接口契约写在票 01 里），主会话写票、做 03（提示词）、审码、集成：

- **01 对话处理器**：新模块 `runner/im_wechat.py`（`WechatConversation`），`_run_wechat` 用它的 `on_message` 轮询，上游的
  `on_message` / `_handle` 不再运行，模块其余（`WxBotClient`、`_dl_media`、`_TEMP_DIR`）照用。轮询线程只解析、答命令、登记 run，
  停止回执当场发；一个按需启动的 worker 线程只读列表头的 display queue（每 0.5 秒醒一次看停止，没有超时），发回答 / 提问，并负责
  「正在输入」的刷新与取消。run 列表、`_running_run`、ask_user 按 display queue 认领、续跑计数、`/continue n` 的 abort 探测都照 tgapp
  `0024` 的口径；共享规则从 `galley_im_display.py` 导入。`im_resume.py` 里为上游 `_handle` 写的 `WechatNoticeBot`（靠识别
  `[已停止]` 字样判断）与 `wechat_new_conversation` 删除，续接提示、`/new`、`/continue` 由新模块直接调 `ChannelResume`。
- **02 完成汇报**：`runner/im_reporter.py` 加 `WechatChannel` / `WechatReporter` / `start_wechat_reporter`；汇报是纯文本三段
  （`✅ / ⏹ / ❌ {标题}`、正文、末行 `状态词 · session id`）。微信没有配对绑定，owner 是最近说话的人，01 把 id 存进
  `wechat_owner.json`（只存 id；Rule 4），重启后没人说话也能汇报。Core 的断开连接（`remove_conversation_state`）删掉它。
- **03 提示词**：入口层删掉微信的链接 / `1.` 注记（`core/src/managed_prompt.rs`），预算 `IM_PROMPT_BUDGET_BYTES` 1503 → 1383
  （零余量口径不变，最长变体换成 Telegram）；`prompt-composition.md` 的说明与回归第 17 条改写。

子代理自行裁量、主会话审过接受（细节在票面 Comments）：

- 提问的旁白用 `visible_text` 而不是票面的 `answer_body`：后者在本步没有旁白时回退到整段 transcript，会把前几步的文字塞进提问（同 tgapp）。
- 续接提示自成一段、提问里旁白与问题之间空一行：微信按 Markdown 渲染，单换行接在列表后会被并进上一块（TG 是单换行，有意分叉）。
- 所有发送都带该用户最近一条消息的 `context_token`（上游带触发那条）；`/llm` 改为首词恰好是 `/llm`；`send_text` 空文本抛错。
- 导入 `galley_im_display` 会带入 `chatapp_common`，GA 类因此在微信进程里装上 `/continue` `/btw` `/review`（与其他渠道一致）。
  `/continue` 因此改在新模块里当命令处理、走 `continue_session`，否则重启会把 `/continue N` 之前的日志接回来。剩余小缝：`/btw` 作为 GA 斜杠命令
  走任务队列，会排在在跑的任务后面，起不到「插问」的作用（与本次无关，未处理）。

集成时主会话补的三处：

- **发送失败要抛**（02 子代理在审查中指出）：上游 `_post` 只 `raise_for_status()`，iLink 用 HTTP 200 + 非零 `ret` / `errcode` 报业务错误。
  不查返回体，发送失败的汇报会被记成已送达。01 加 `_check_sent`，reporter 契约的 `send_text` 向外抛 `WechatSendError`，普通回答只记日志。
- **重新扫码也清 owner**（`core/src/im_supervisor/manager.rs` relogin 分支）：重扫可能换了微信号。没有 owner 时 reporter 跳过该渠道、汇报挂着等有人说话；
  不清的话会往旧号重试三次后放弃。
- **去重**：reporter 原有一份自己的「收尾一步」清洗，改为调用 `im_wechat.answer_text`，汇报与回答同一口径。

## 验证

- 拆分器另跑了 400 组随机文本（含超长行、代码块、空段，上限 300 / 1000 / 4000）：没有一段超限，去掉围栏行与空白后内容逐字一致。
- runner：pytest 554 passed（新增 `test_managed_wechat.py` 31 条，`test_im_reporter.py` 微信一节，`test_im_resume.py` / `test_managed_im_supervisor.py`
  的微信部分按新模块重写），mypy strict、ruff、`git diff --check` 绿。
- Core：`cargo test --workspace` 全绿（含 `remove_conversation_state` 微信断言、提示词 18 条）；动过的 Rust 文件 `rustfmt --check` 只剩 `manager.rs` 一处既有差异。
- 补丁栈未动（`managed-ga/` 零改动）。
- **真机**：JC 真机验收（2026-10-10）：未发现问题。按 `wechat.log` 与 `reporter_state.json` 核对实际走过的项——闲聊 1 步（无末行）、两步任务（末行步数与用时）、ask_user 两轮都回序号「2」（续跑累加到 6 步）、委派查天气并收到完成汇报（`reporter_state.json` 记已汇报）、新代码启动时重启续接正常。日志里**没有出现**、留待日常使用观察的：运行中与空闲时的 `/stop`、两条排队、发文件、运行中 `/new`；语音从日志分不出来。
