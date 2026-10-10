# PRD：微信对话体验对齐桌面端

Status: in-progress
Date: 2026-10-10
来源：Telegram / Discord 打磨完，JC 提议打磨微信；读码诊断 + 官方 iLink 插件源码核实平台机制后，JC「按建议推进」（五个裁决点全按推荐，裁决 2 按探针结果走第三支）
关联：[Telegram 对齐 devlog](../../docs/devlog/2026-09-30-telegram-conversation-ux.md)、[Discord 对齐 devlog](../../docs/devlog/2026-09-30-discord-conversation-ux.md)（形态母本）·
[重启续接 devlog](../../docs/devlog/2026-09-30-im-restart-continuity.md)（`runner/im_resume.py`）·
[conversation.md](../../docs/design/conversation.md)（折叠头、ask_user 气泡）· [deferred「微信渠道的任务完成汇报」](../../docs/devlog/deferred.md)

## 问题

Galley 侧只有接入层（`runner/managed_im_supervisor.py`：固定 agent 模式、补 `/help` `/status` `/new`、`im_resume` 续接），
对话体验是上游 `frontends/wechatapp.py` 原样（上游 `on_message` / `_handle`）。读码 + 脚本重建（`_clean` 抽出来跑样本），
JC 真机现状样本（2026-10-10「看看磁盘还剩多少」，2 步 → 推了 2 条，末尾 `[任务已完成]`）印证：

1. **过程外露、每步一推**：每落定一步单独发一条（`wechatapp.py:470`），一轮最多 9 条过程 + 1 条回答，每条都推送；每条首行是该步 `<summary>`。
2. **每个回答挂 `[任务已完成]`**（`:479`）。
3. **ask_user 题干被吞**：回显是多行 `🛠️ ask_user(题干\ncandidates:\n- A…)`（`agent_loop.py:79`、`:127-131`），清洗只删第一行（`:386`）——
   用户看到旁白 + 英文 `candidates:` + 选项 + 多余的 `)` + `[任务已完成]`，实际在等回复。
4. **缺陷：单步 5 分钟无输出即「完成」**：`dq.get(timeout=300)`（`:464`）超时后照发 `[任务已完成]` 退出，真回答在后台跑完无人接收。
5. **缺陷：`/stop` 无回执；空闲时发会误伤下一条**：`_task_aborted[uid] = True`（`:411`）无条件置位，`agent.abort()` 空闲时直接返回
   （`agentmain.py:142`），下一个正常完成的回答被标 `[已停止]`。
6. **缺陷：长回答截头**：收尾那条是 `rest[-3000:]`（`:481`），开头静默丢失；过程消息 `[:3000]` 截尾。
7. **`[FILE:/绝对路径]` 原样留在正文**（文件另发）。
8. **编号与链接被删**：`1.` 被删（`:379`）、链接只剩文字（`:376`）；10-06 IM 入口层为此给微信单开一条提示词（`core/src/managed_prompt.rs:279-283`）。
9. **语音进不来**：语音被当文件下成 `.silk`，模型拿到一个路径（`:279`）。
10. **没有完成汇报**（10-08 暂缓）。

## 平台机制（官方 `@tencent-weixin/openclaw-weixin` 2.4.9 源码 + 2026-10-10 真机探针）

| | Telegram / Discord | 微信（iLink） |
|---|---|---|
| 编辑 / 删除 | 能（状态消息的基础） | **不能**。官方插件只发 `FINISH`；探针：同一 `client_id` 先 `GENERATING` 后 `FINISH`，**只显示第一版**，后续同 id 的消息被丢弃；带 `delete_time_ms` 的删除无效。**每条消息必须用新 `client_id`** |
| 原生进度 | 无 | 协议有 `TOOL_CALL_START / RESULT`（2.4.4 起），探针两种版本号都**不显示**（服务端回 `{}`） |
| 按钮 | 有 | 无 |
| 输入中 | 有 | 有；探针：取消（`status: 2`）**立即消失**。上游从不取消 |
| Markdown | TG 无表格、标题 | 探针样本（粗体、行内代码、`1.` 编号、`1、`、链接、裸链接、表格、H1 / H3、引用、分隔线、代码块）**都正常渲染** |
| 语音 | — | 探针：语音消息自带 `voice_item.text`（「继续」→ `"继续"`），官方插件直接当正文 |
| 主动发消息 | 直接发 | 探针：**不带 `context_token`、或带几分钟前旧 token 都送达** |
| 单条长度 | | 官方插件按 4000 字分段（`textChunkLimit`） |

推论：TG / DC 的 live 窗口（状态消息原地编辑、回答落地即删）在微信做不出来，原生进度也不显示。

## 裁决（JC，2026-10-10「按建议推进」）

1. **先跑平台探针**：已跑（结果见上表）。
2. **运行中看什么**（按探针走规则第三支）：只留「对方正在输入」，**一轮只推一条回答**；运行中不发任何过程消息。
3. **回答形态**：回答 = 收尾那一步（同 TG / DC），去掉 `[任务已完成]`；完成标识换成**末行** `N 步 · 用时 X`，**≥ 2 步才挂**
   （微信没有小字也不能折叠，首行会占推送和列表预览；TG 选顶部的理由「点开看步骤」在微信不成立；1 步闲聊的「1 步 · 用时 4 秒」是全字号噪音）。
   与 TG / DC「1 步也带头」的有意分叉，真机可翻。
4. **范围 A + B + C + D**：
   - A 回答与降噪（问题 1、2、6、7、8）
   - B 交互与缺陷（问题 3、4、5；排队；`/new` 运行中先停）
   - C 语音转文字入站（问题 9）
   - D 完成汇报（问题 10，翻 10-08 的暂缓：当时三条理由里「真机要扫码」这次本来就要做；按 JC 跨渠道一致偏好；探针证实主动发送可用）
   - **暂缓**：引用消息（新版微信引用只带 `svr_id`，官方插件靠本地 SQLite 存消息原文还原，Galley 存 IM 原文撞 Rule 4）；
     图片视觉输入（跨渠道 deferred 照旧）。
5. **落点 R**：Galley 侧新模块 `runner/im_wechat.py` 接管 `on_message`，传输层（`WxBotClient`、`_dl_media`）继续用上游的，**不加托管补丁**。
   理由：四个 IM 前端里上游只有 `wechatapp.py` 还在改（6 月以来 4 次提交，tgapp / dcapp / fsapp 都是 0）；supervisor 本来就包着
   `on_message`、`run_loop` 的回调是现成 seam；09-30 续接已有先例（`im_resume.py`）；runner 有 mypy strict。代价：微信展示逻辑与 TG / DC
   不在一处；共享规则从 `galley_im_display.py`（`0024` 新增的文件）导入，记进 ga-baseline。

## 形态（以桌面为准，对表）

| 桌面 | 微信 | 备注 |
|---|---|---|
| live 两行窗口 | 「对方正在输入」，有 run（排队或在跑）就保持，全部落定即取消 | 平台做不到别的（探针） |
| 完成即折，头 = N 步 · 用时 | 回答末行 `N 步 · 用时 X`（≥ 2 步） | 裁决 3 |
| 回答 = 收尾那一步 | 照搬 `final_step_text` / `answer_body` | 同 TG / DC |
| Composer Stop | `/stop` → 一条 `⏹ 已停止 · N 步 · 用时 X`；空闲回「当前没有在跑的任务」 | 同 TG |
| ask_user 气泡 + chip | 一条消息：旁白 + 问题 + `1.` 编号候选 + 末行 `⏸ 等你回复 · 已完成 N 步`；回复序号或文字 | 无按钮；单选回一个序号 = 点那个 chip |
| ask_user 不切断 run 计数 | 照搬 | 同 TG / DC |
| 完成报告 | 首行 `✅ / ⏹ / ❌ {session 标题}` + 正文 + 末行 `{状态词} · {session id}` | 对应 TG 标题 + 脚注 |

## 实施切分

- [01 对话处理器](./issues/01-conversation-handler.md) — A + B + C，`runner/im_wechat.py`（Opus 子代理）
- [02 完成汇报](./issues/02-completion-report.md) — D，`runner/im_reporter.py` + Core logout（Opus 子代理，与 01 并行，接口契约见 01）
- [03 入口层提示词去掉微信注记](./issues/03-prompt-note.md) — 主会话
- [04 集成验收 + 真机](./issues/04-integration-and-dogfood.md) — 主会话 + JC

## 运行时影响

- **外置 GA 零变化**：Channels 只跑内置 runtime（`core/src/im_supervisor/mod.rs:1-3`）。
- 内置：只动微信；Telegram / Discord / 飞书逐字节不变；托管补丁栈不动（`wechatapp.py` 的 `on_message` 不再被调用，模块其余照用）。
- CLI / Agent API / schemaVersion 零改动。
- 入口层提示词删一条微信注记（03）。
