# PRD: Telegram 对话体验对齐桌面端

Status: ready-for-human
Date: 2026-09-30
来源：Discord 对齐做完后，JC 提议打磨 Telegram；读码诊断后 JC「按建议推进」（五个裁决点全按推荐）
关联：[Discord 对齐 devlog](../../docs/devlog/2026-09-30-discord-conversation-ux.md)（本次的母本，形态裁决多数照搬）·
[Telegram 渠道落地 devlog](../../docs/devlog/2026-07-05-managed-im-supervisor-telegram.md) ·
[conversation.md](../../docs/design/conversation.md)（TurnMarker 读秒、live 两行窗口、ask_user 气泡）·
[.scratch/discord-ux/](../discord-ux/PRD.md)

## 问题

Telegram 的对话体验全是上游 `frontends/tgapp.py` 原样：Galley 的 `0014` 只做接入层（env 配置、配对、状态、`main()`）。
上游 tgapp 自 2026-05-26（`f758d1a`）后未动，展示层改动的 rebase 风险低。

JC 当天首问（`telegram.log` 17:06 绑定；`model_responses_016441.txt` 2 步）按代码重建是两条推送消息：

```
LLM Running (Turn 1) ...
▎先检查本机磁盘容量、可用空间及数据卷占用。
🛠️ code_run({"type": "bash", "script": "df -h / /System/Volumes/Data; echo '\\n--- APFS…

LLM Running (Turn 2) ...
▎本机硬盘总容量约 1 TB，已使用 49.2%，剩余空间充足。
刚检查了这台 Mac 的硬盘：
| 项目 | 容量 |
|---|---:|
…
```

1. **过程外露、每步一推**：新 Turn 标记一到就把上一步定稿成正式消息（`tgapp.py:873-878`）；`LLM Running (Turn k) ...`
   原样当标题，`<summary>` 抽成引用块（`tgapp.py:256-267`），🛠️ 工具回显不在 `clean_reply` 剥离名单（`chatapp_common.py:46`，
   来源 `agent_loop.py:79`）；回答那条也带标题 + 摘要引用，重复一遍。
2. **Markdown 失真**：MarkdownV2 无表格、无标题，`_to_markdown_v2`（`tgapp.py:321-350`）把 `|` `#` 转义后原样显示。
3. **ask_user**：纯问题（无候选）不出菜单（`tgapp.py:377-378`），去掉回显后会被吞；有候选时问题出现两遍；英文
   「none of these above」「Done」，取消后另发一条；答后改成全量选项 +「已选择：X」（`tgapp.py:468-483`）；一行一个按钮、
   长候选截断；打字回答后旧按钮仍可点；ask 事件走全局队列（`tgapp.py:158`、`392`），报告轮的 ask 会被下一个用户 run 认领。
4. **排队与停止（含缺陷）**：忙时再发立刻出「thinking...」实为排队（`tgapp.py:1003-1006`）；`ctx.user_data['stream_task']`
   只记最新一条（`tgapp.py:1006`），`/stop` 取消的是排队那条的显示（`tgapp.py:960-962`、`1132-1135`）——它显示「已停止」
   但仍在 GA 队列里，前一条 abort 后**在后台照跑、输出无人接收**（`agent.abort` 只停正在跑的，`agentmain.py:141`）；
   正在跑的那条反而把部分输出当回答定稿；`/new` `/restore` `/continue n` 同样只取消最新一条的显示。`/stop` 回两条。
5. **完成报告**：`render(raw)` 吃全量 `done`，`LLM Running` 标记与 🛠️ 回显同样漏进报告；HTTP 直发不带 `parse_mode`
   （`im_reporter.py:409-417`），`**`、表格竖线原样；与普通回答不可区分。
6. **图片**（次要、跨渠道）：每张图一个任务、相册 N 张 N 轮；图片以路径进提示词不是视觉输入（`tgapp.py:1149-1171`）。

## 平台机制（决定映射方式）

| | Discord | Telegram |
|---|---|---|
| 新消息 | 推送 | 推送；`disable_notification` 只是静音（Bot API：notification with no sound） |
| 编辑 | 不推送，挂「（已编辑）」 | 不推送 |
| 删除 | — | 私聊里整条消失 |
| 草稿 `sendMessageDraft` | 无 | 私聊专用临时预览：不推送、不留痕、30 秒不刷新即消失、不能带按钮（PTB 22.8 / Bot API 10.0 docstring；22.7 起所有 bot 可用） |
| 原生命令菜单 | 需注册（Discord D 项暂缓） | 已注册（`set_my_commands`，`tgapp.py:964-965`） |
| 折叠 | 无 | MarkdownV2 可折叠引用块（PTB `EXPANDABLE_BLOCKQUOTE`） |
| 小字 | `-#` subtext | 无 → **本 PRD 约定：Discord 的 `-#` 在 Telegram 一律映射为斜体行** |

## 裁决（JC，2026-09-30「按建议推进」）

1. **live 窗口 = 草稿**，不用状态消息：草稿语义「临时预览、定稿后被正式消息取代」最贴桌面「完成即折」；不推送、不留痕、不用删。
   群聊或草稿失败 → 回退静音状态消息原地编辑、完成删除（Discord 形态）。
2. **停止 = `/stop` 菜单命令**，不做按钮：草稿带不了按钮；桌面 Stop 在 Composer，Telegram 菜单按钮就在输入框旁。回执收成一条。
3. **折叠头 a / b / c 真机变体实测**：a 斜体首行；b 可折叠引用块（首行头 + 逐步摘要，点开看过程）；c 不要头。默认 b（推荐），
   临时隐藏命令 `/fold a|b|c` 切换，JC 裁决后拆掉。
4. **范围 A + B + C**（降噪与 Markdown、交互补齐、报告格式化），**D 图片合并 / 视觉输入暂缓**（跨渠道，进 deferred）。
5. **平台无关逻辑抽成补丁新增的共享文件** `frontends/galley_im_display.py`（新文件零 rebase 风险），Telegram 用；
   Discord 本轮**不迁**——`0023` 在补丁栈里排在新文件之前，迁过去会形成前向依赖，留到 `0023` 下次重导出时把共享文件拆成
   独立补丁排到 `0023` 前面再迁（devlog 记一笔）。

## 真机第一轮改判（JC，2026-09-30，见 [05](./issues/05-status-message-and-fold-b.md)）

- 裁决 1 改判：草稿让客户端上推留白 → **不用草稿，私聊也用静音状态消息**（Discord 同形）。
- 下表「读秒照搬」改判：**去读秒**，改 Discord 分钟行；排队行不带时间。
- 裁决 3 定案：**折叠头 b**，拆 `/fold` 与 a / c。

## 形态（以桌面为准，对表；读秒与草稿两行已被上节改判）

| 桌面 | Telegram | 备注 |
|---|---|---|
| live 两行窗口 | 草稿三行：`已完成 N 步`（N ≥ 2）/ `NN summary` / `·· 思考中` | 同 Discord |
| 读秒：3 秒起 `· N 秒`，60 秒起 `· 已 M 分 S 秒 · 仍在运行`，落定归零 | **照搬**（草稿编辑便宜，Discord 因限流才改成按分钟） | 读秒顺带给草稿续命（30 秒过期） |
| 完成即折，头 = N 步 · 用时 | 草稿被回答取代；头按 a / b / c 实测 | 去气味段（同 Discord） |
| 回答 = 收尾那一步 | 照搬 `outputs[-1]` | 同 Discord |
| Composer Stop | `/stop` → 一条 `⏹ 已停止 · N 步 · 用时 X` | |
| ask_user 气泡 + chip，答后勾所选 | 新消息（斜体眉头）+ inline 按钮按 `candidateLayout`；答后编辑成回显 | 多选保留上游 toggle + 「提交」 |
| ask_user 不切断 run 计数 | 照搬 | |
| 完成报告 | 粗体标题行 + 正文（MarkdownV2）+ 斜体 `状态 · session id` 脚注 | 对应 Discord embed |

## 实施切分

- [01 草稿 live 窗口、回答、Markdown、共享文件](./issues/01-live-draft-and-answer.md) — tgapp，补丁 `0024`
- [02 ask_user、排队、停止、命令](./issues/02-ask-user-queue-stop.md) — tgapp，补丁 `0024`（同一 agent 接 01 顺做）
- [03 完成报告格式化](./issues/03-report-format.md) — runner，与 01/02 并行（接口契约定死）
- [04 集成验收 + 真机](./issues/04-integration-and-dogfood.md) — 主会话 + JC

## 运行时影响

- **外置 GA 零变化**：Channels 只跑内置 runtime（`core/src/im_supervisor/mod.rs:1-3`）。
- 飞书 / 微信 / Discord 零变化。file-based（非 managed）tgapp 使用：展示形态同样生效，访问控制与配置语义不动。
- CLI / Agent API / schemaVersion 零改动。
