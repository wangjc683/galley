# PRD: Discord 对话体验对齐桌面端

Status: done
Date: 2026-09-30
来源：JC 提议优化 Discord 里与 Galley 对话的体验；范围与形态两轮讨论后 JC「按建议推进」
关联：[Discord 渠道落地 devlog](../../docs/devlog/2026-08-13-discord-channel-shipped.md) ·
[conversation.md](../../docs/design/conversation.md)（Turn 结构、live 两行窗口、ask_user 气泡）·
[im-supervisor-context-bloat](../im-supervisor-context-bloat/issues/01-supervisor-reads-whole-session-list.md)（同批发现、另立题）

## 问题

Discord 是四个渠道里前端最简陋的：Galley 的 `0018` 补丁只做接入层，对话体验是上游
`frontends/dcapp.py` 原样，而上游这个文件自 2026-05-08（`6738e17a`）后未动。Telegram 的流式编辑、
ask_user 按钮是上游 tgapp 自带，Discord 没有对应物。

实测 / 读码确认的问题：

1. **ask_user 的问题与候选被吞**。GA 把 ask_user 回显成 `🛠️ ask_user(问题\ncandidates:\n- A…)`
   （`agent_loop.py:127-131`），`_strip_discord_transcript` 的 🛠️ 正则（`dcapp.py:369`）把它连同候选整块删掉，
   用户只看到该步 `<summary>` 一句。脚本复现过。
2. **`/btw` `/review` 列在 `/help` 里，发了只回 help**：`DiscordApp.handle_command`（`dcapp.py:684-726`）整体覆盖了
   mixin 版本（`chatapp_common.py:179-185`），漏两支。
3. **忙时再发消息**：立刻回「思考中...」但实为排队；第一轮 `finally` 会 pop 掉第二轮的运行登记
   （`dcapp.py:733`、`767`），之后 `/stop` 回执与 reporter 的忙闲判断错位。
4. **过程噪音**：「思考中...」+ 每步一条「步骤N：…」+ 每 20 秒一条「⏳ 还在处理中」，每条都是独立消息、
   手机上各推送一次（`dcapp.py:735 / 745 / 752`）。
5. **完成报告与普通回复长得一样**（`im_reporter.py:517-530` 走 `deliver_text` 纯文本）。

## 原则：以桌面端为准

Discord 的机制差异决定映射方式：**发新消息 = 手机推送一次；编辑旧消息 = 不推送，但消息尾挂「（已编辑）」。**

- 桌面的 live 窗口 → 一条**状态消息**，原地编辑。
- 桌面的「完成即折」→ 状态消息**删除**，折叠头变成回答消息**首行小字**（Discord `-# ` subtext）。
  一个 run 最后只剩一条回答、只推送一次、不留「（已编辑）」。

```
进行中（状态消息，以 reply 挂在用户原消息下，mention_author=False）：
  已完成 2 步                 ← 落定步数 ≥ 2 才出现（桌面：第一步折进去时才出现）
  02 读取会话列表             ← 最后一个落定的步：两位补零序号 + summary
  ·· 思考中                   ← 进行中行；单步 ≥ 60 秒时追加「 · 已 N 分钟 · 仍在运行」，按分钟更新
  [停止]
+ Discord 原生「Galley 正在输入…」（typing）

结束后（状态消息已删，频道里只剩这一条）：
  -# 3 步 · 用时 42 秒
  <回答正文>
```

## 对表（已裁决）

| 桌面 | Discord | 备注 |
|---|---|---|
| live 两行窗口 | 状态消息三行，步落定时编辑 | 照搬 |
| 思考行 `··` 占位、落定才盖序号 | 照搬 | |
| 3 秒起读秒、60 秒「仍在运行」 | 不读秒；单步 ≥ 60 秒显示「已 N 分钟 · 仍在运行」，按分钟更新 | 每秒编辑撞频率限制；存活感交给 typing |
| 状态文字 shimmer | Discord typing | 同属「live 归外围」 |
| 完成即折，头 = N 步 · 用时 · 气味段 | 回答首行 `-# N 步 · 用时 X` | **去掉气味段**：supervisor 工具几乎全是 `code_run` 调 Galley CLI，无信息量 |
| 1 步 run 也有头（`run-groups.ts:248`） | 照搬：闲聊回答也带小字 | JC 真机看后可翻 |
| 点折叠头展开步骤 | **不做**（进 deferred） | |
| 实时思考预览 | 做不到 | Discord 前端 `verbose=False`，拿不到 LLM 增量（patch manifest `0016` 条目） |
| ask_user 气泡 + chip；答后回显勾所选 | 提问发新消息 + 按钮；点选后编辑该消息：去按钮、列候选、勾所选；打字回复同样算回答 | 不另发「选了 X」一行 |
| 候选排布（`candidateLayout`） | 同阈值：≥5 条、单条 >20 字、合计 >60 字 → 正文编号列表 + 按钮写序号；否则按钮直接写候选 | 按钮标签上限 80 字；>25 条纯文本 |
| ask_user 不切断 run 计数（09-18） | 照搬：续跑的步号与用时累加，等待时间不计 | |
| Composer Stop | ~~状态消息上的「停止」按钮~~ → 只靠文本 `/stop`（2026-09-30 真机后去掉按钮，见 05） | 停止后状态消息**不删**，定格 `⏹ 已停止 · N 步 · 用时 X`（无回答可挂眉头） |
| 完成报告 | embed 卡片：标题 = session 标题，色条分完成 / 失败 / 取消，脚注 session id | 类比 Goal 收口标记 |

**不做**：原生斜杠命令（D，进 deferred）、步骤展开按钮（进 deferred）、多选 ask_user 的按钮化（多选问题退回文本回复）。

## 实施切分

全部 dcapp 改动进一个新补丁 `0023-managed-discord-conversation-ux.patch`（产品范围单一；上游 dcapp 五个月未动，
rebase 风险低）。reporter 改动在 `runner/`，经 dcapp 新增的严格发送 seam `deliver_embed` 衔接。

- [01 状态消息](./issues/01-run-status-message.md) — dcapp，补丁 0023
- [02 ask_user 按钮、停止按钮、命令补齐](./issues/02-ask-user-stop-commands.md) — dcapp，补丁 0023（同一 agent 接 01 顺做）
- [03 完成报告 embed](./issues/03-report-embed.md) — runner，可与 01/02 并行
- [04 集成验收 + 真机](./issues/04-integration-and-dogfood.md) — 主会话 + JC
- [05 去掉状态消息上的停止按钮](./issues/05-drop-stop-button.md) — dcapp，补丁 0023 重导出（真机验收后追加）
- [06 重启后无缝续接 + 激活文案收短](./issues/06-restart-continuity.md) — dcapp 新补丁 0026 + reporter（真机验收后追加）
- 试用后追加：状态消息去掉「已完成 N 步」头、分钟后缀收成 `· 已 N 分钟`，与 Telegram 同改（票在 [telegram-ux 06](../telegram-ux/issues/06-quieter-status-message.md)，上图示意因此过时）

## 运行时影响

- **外置 GA 零变化**：Channels 只跑内置 runtime（`core/src/im_supervisor/mod.rs:1-3`）。
- 飞书 / Telegram / 微信零变化；file-based（非 managed）dcapp 使用：状态消息形态同样生效（是纯展示改进），
  访问控制与配置语义不动。
- CLI / Agent API / schemaVersion 零改动。
