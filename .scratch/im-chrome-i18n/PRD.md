# PRD: IM 渠道外壳多语言（跟随 Galley 界面语言）

Status: 暂缓（2026-09-30 JC 裁决：Discord / Telegram 对话体验打磨收尾后最后做）
Date: 2026-09-30
来源：讨论 Discord 停止按钮时 JC 指出「按钮还是中文的，英语用户会很奇怪」；读码确认整层外壳都是中文，按钮只是其一
关联：[discord-ux 05](../discord-ux/issues/05-drop-stop-button.md)（去掉停止按钮，同一讨论）·
[deferred「IM 渠道外壳多语言」](../../docs/devlog/deferred.md) ·
[Discord 对齐 devlog](../../docs/devlog/2026-09-30-discord-conversation-ux.md) ·
[Telegram 对齐 devlog](../../docs/devlog/2026-09-30-telegram-conversation-ux.md)

## 问题

模型回复跟随用户语言，但 IM 渠道的外壳全是中文，英语用户看到的是「英文回答 + 中文外壳」。Discord 一侧的清单：

- 状态消息 `·· 思考中`、`·· 排队中`、` · 已 N 分钟`（`dcapp.py` `_status_content`；2026-09-30 起不再有「已完成 N 步」头与「仍在运行」）
- 回答首行小字 `N 步 · 用时 X`、停止定格 `⏹ 已停止 · …`（`_format_elapsed` / `_fold_label` / `_stopped_text`）
- 提问 `等你回复` / `已回复` / `多选：直接回复序号或文字`；摘要回退 `调用了运行代码`（`_TOOL_LABELS`）
- `当前没有在跑的任务`、`/help` 末尾的退出词行
- 报告卡片 footer 状态词 `已完成 / 已停止 / 出错`（`runner/im_reporter.py` `report_status_word`，Discord 与 Telegram 共用）

Telegram 同构（`tgapp.py` 与 `galley_im_display.py`，含 `still_running_suffix`、折叠头 b）。上游自带的中文：`/help` 全文与
Telegram 菜单描述（`chatapp_common.py` `HELP_COMMANDS` / `TELEGRAM_MENU_COMMANDS`），飞书、微信前端整体。

## 裁决（JC，2026-09-30）

- **跟随 Galley 界面语言**（讨论中的 L1）。否决「按每条消息检测语言」（L2）：中英混用时外壳会来回跳，纯路径 / emoji /
  代码消息判不准。
- **时机**：打磨收尾后最后做——打磨期间外壳文字还在变，现在做表每改一处要同步两份，最后做只翻定稿一遍。

## 依据

- Discord / Telegram 只认配对绑定的 owner（`dcapp.py` `_is_allowed_user`，`tgapp.py:75` 起的 owner 配对）：频道对面就是
  Galley 桌面的主人，语言不用猜。
- `language_preference` 已由 Core 持久化（`gui/src/lib/db.ts:309` → `set_pref_json`）；渠道子进程由 Core 启动、Core 注入环境变量
  （`core/src/im_supervisor/manager.rs:231`）。
- 缺口：「跟随系统」是 GUI 用 `navigator.languages` 解析的（`gui/src/lib/language.ts:10`），Core 要补一次解析，或 GUI 把解析结果另存。

## 方案草图

1. Core 启动渠道时注入解析后的语言（`zh-CN` / `en-US`，变量名待定）。
2. Galley 自己写的外壳（`0023`、`0024`、reporter）做中英两张表，放进 `galley_im_display.py`。
3. **前置**：把 `galley_im_display.py` 拆成独立补丁排到 `0023` 前面，dcapp 改用它（原是 `0024` 台账行「`0023` 下次重导出时」
   的迁移条件，2026-09-30 改为随本题做）。插入补丁会让后续补丁改编号，`ga-baseline.md`、台账、devlog 里的引用随改。
4. 改语言后「重启 Channels」生效（或自动重启，见待定）。

## 待定

- 上游原有中文（`/help`、Telegram 菜单描述、飞书 / 微信前端）第一步不动；要不要覆盖、覆盖多少——覆盖会扩大补丁面。
- 界面语言改变时是否自动重启 Channels。
- 若 [Discord 原生斜杠命令](../../docs/devlog/deferred.md) 先做，命令描述可走 Discord 自带的按客户端语言本地化（discord.py
  `app_commands` 的翻译接口，待核实）。

## 运行时影响

- 外置 GA 零变化：Channels 只跑内置 runtime（`core/src/im_supervisor/mod.rs:1-3`）。
- CLI / Agent API 零改动；模型提示词本来就是英文、要求用对话语言回复，不在范围。
