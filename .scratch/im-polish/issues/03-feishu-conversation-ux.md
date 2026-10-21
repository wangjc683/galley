# 03 飞书对话体验对齐

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 3。

飞书从没做过对话体验这一轮，对话层还是上游 `frontends/fsapp.py` 原样（Galley 的 `0009`、`0011`、`0012`、`0013` 只做接入与小修）。今天：在跑时是一张卡片，状态行 +「Turn N · summary」逐步折叠面板（`fsapp.py:850` 一带），回复写进同一张卡片的分隔线下；在跑时再发会被直接拒绝（`fsapp.py:968` 一带）。

## 目标形态（母本：Telegram / Discord 09-30 定稿与本轮 PRD 裁决 1）

先读码、读飞书开放平台文档，把「现状 → 目标」逐行对表写进本票 Comments，再动手。下面是主会话按先例推出来的目标，对表时核实；平台做不到或与先例冲突的，写进 Comments 交 JC，别自己另起形态。

1. **在跑时**：在你那条消息上挂 `Typing` 表情，回复（或停止、出错）发出后撤掉。接口与表情 key 照 [IM 并入票 01](../../im-one-assistant/issues/01-platform-probes.md) B 的真机结果（加、删都 `code 0`，不推送、不动会话列表、撤掉不留痕）。不再在开跑时先发状态卡片。
   理由（对表时核实）：机器人每发一条新消息都推送；今天开跑那张卡推送一次，回答写进同一张卡时没有新推送，推送和会话列表预览看到的是状态、不是回答。Telegram 的规矩是一轮只推一次、预览从回答开始（09-30 devlog）。
2. **回复**：一条消息，正文只放回答（收尾那一步，清洗口径同 Telegram / Discord：去工具回显、去 `<summary>` 等标签、`[FILE:]` 显示文件名）。
3. **过程入口**：≥ 2 步时在回复里给一个默认收起的入口，标题「过程」，展开区第一行 `N 步 · 用时 X`，下面逐步 `NN 摘要`；1 步什么都不挂（PRD 裁决 1 的母本：入口是动作、数字不在表面）。飞书卡片若有原生的折叠面板（默认收起），优先用它：不靠回调、不靠进程内缓存、重启后照样能展开；没有就用按钮，规则同票 01 的 Telegram。
4. **在跑时再发**：排队，不拒绝；轮到时给那条消息挂 `Typing`。语义同 Telegram 0024 的 run 列表（只有一个 agent，按入队顺序执行）。
5. **停止**：`/stop` 停正在跑的那条，回一句 `⏹ 已停止 · N 步 · 用时 X`（`stopped_text`）；不误伤排队的与报告轮（Telegram 0024 的实施偏差一节有坑）。
6. **提问（ask_user）**：照 Telegram / Discord 的规则（`candidate_layout` 出候选、答后在原题上标出所选、打字回答后旧候选失效）。卡片按钮需要应用订阅卡片回调；先查 Galley 的飞书接入今天有没有收卡片回调，没有就照微信的做法回数字，并在 Comments 写明要用户在开放平台另开什么才能用按钮。
7. **回复写法**：飞书卡片 Markdown 支持的语法有限，表格、标题等照 Telegram 的源文本改写（`galley_im_display.tables_to_lists` 等）处理到能正常显示。
8. **完成报告**（`runner/im_reporter.py` 的飞书那一支）：口径对齐（只取收尾一步），格式照 Telegram / Discord 报告的标题、正文、脚注三段落到飞书能显示的样子。

## 约束

- 新补丁取下一个编号（今天最大是 `0028`），排在 `0024` 之后，才能 import `frontends/galley_im_display.py` 的共享逻辑；平台无关的逻辑往那里放。补丁流程照 `docs/managed-ga-runtime/code-state-and-patches.md`；干净克隆重放全部补丁、重建后 `managed-ga/code` 哈希一致；台账与 `docs/ga-baseline.md` 的耦合点同步。
- 不动 `0009`、`0011`、`0012`、`0013` 的语义；需要改它们时照「后续补丁要随之重导出」的规则。
- import `managed-ga/code` 的脚本与测试用 `python -B`。
- 读飞书开放平台的现行文档（消息表情回复、卡片 JSON 2.0 的折叠面板、卡片回调），别凭记忆；记下文档出处。
- 群聊（@ 机器人）同样适用，Typing 挂在触发的那条消息上。
- 测试要补：排队不拒绝、Typing 加删配对（出错、停止也要撤）、≥ 2 步有过程入口而 1 步没有、提问路径、报告口径。

## 验证

- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check`。
- `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs`。

## 交付

在 worktree 分支上提交（只点名文件）。票 Comments 写对表、实施偏差、交 JC 定的点、没验证到的；Status 改 `needs-dogfood`。真机验收由 JC 在 dev 里「重启 Channels」后在飞书私聊里做：一个 1 步、一个多步的问题，在跑时再发一句，`/stop` 一次，触发一次提问。

## Comments
