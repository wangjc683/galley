# 04 飞书补充：标题转粗体、插队时引用原话

Status: ready-for-agent

来源：票 [03](./03-feishu-conversation-ux.md) Comments「交 JC 定」五条，JC 2026-10-21「飞书那几项，按你推荐推进」：

1. 表格：照现在转成列表，不用卡片原生表格（IM 入口层本来就不让出表格；原生表格 5 行分页、每个组件最多 4 张，手机上看不全）。**不用改。**
2. 标题：转成粗体行，同 Telegram（`tgapp.py` 的 `_rewrite_markdown`）。卡片的一级标题 26px，手机上太大，IM 入口层也不让出标题。**要改。**
3. 提问用按钮代替编号：不做。要每个用户在飞书开放平台订阅 `card.action.trigger`、再发版本，门槛太高；照微信回数字。**不用改**，票 03 的配置说明留在 Comments 作备查。
4. 触发消息之后插进了别的消息时，回答引用触发消息：做，同 Telegram / Discord（Telegram 的规则见 `tgapp.py` `_LiveSurface.anchor`：回答紧贴触发消息就不引用，中间插进了别的消息才引用）。用飞书的「回复消息」接口。**要改。**
5. 「过程」面板与汇报卡片的样子：等 JC 真机看过再定，真机反馈追加到本票。

## 要做的

- 补丁 `0029` 原地改、重导出（它是栈顶，没有后续补丁要跟着重导出），只动 `frontends/fsapp.py`；能复用 `frontends/galley_im_display.py` 已有函数的就 import，不改那个文件。
- 标题：卡片 Markdown 的 `#` 到 `######` 改成粗体行，口径同 Telegram 的改写（去掉标题里原有的 `**`）。表格、图片的现有改写不变。完成汇报走同一个改写。
- 引用：照 Telegram 的锚点规则判断「中间有没有插进别的消息」（机器人自己发的状态、提问、别的回答都算），需要时用回复消息接口发回答卡片；提问卡片、停止回执是否也引用，照 Telegram 现行做法对齐。读飞书开放平台「回复消息」现行文档，记下出处；群聊里同样适用。
- 测试补：有标题的回答变粗体行、中间插进消息时走回复接口、紧贴时不走。

## 约束

- 只在主会话给的 worktree 里改与提交；不碰主工作树，不跑 tauri dev，不重启渠道，不往飞书发消息。
- 补丁流程照 `docs/managed-ga-runtime/code-state-and-patches.md`；从干净上游（`managed-ga/manifest.json` 的 `upstream.source` 与 `commit`，不是本机那份 GenericAgent）重放全部补丁，重建后工作树无差异；台账重放记录同步。
- import `managed-ga/code` 一律 `python -B`。

## 验证

`.venv/bin/python -m pytest`、`mypy runner`、`ruff check runner`、`git diff --check`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs`。

## 交付

提交只点名文件；Comments 写偏差、没验证到的；Status 改 `needs-dogfood`。JC 真机：发一个带标题的回答；在跑时连发两句，看第二个回答引用了第二句。

## Comments
