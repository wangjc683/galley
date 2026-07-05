# Managed IM Supervisor · Telegram（第三个渠道）

日期：2026-07-05

## 结果

Channels 新增 Telegram 渠道，位列微信、飞书之后第三张卡。复用 GA 上游自带的
`frontends/tgapp.py`（功能完整：流式输出、MarkdownV2、ask_user 菜单、模型切
换），通过 managed-ga patch 0014 给它装上 Galley 集成缝，五层链路
（GUI → Tauri 命令 → Rust `im_supervisor` → `runner/managed_im_supervisor.py`
→ tgapp）全部打通。`im_reporter` 从飞书耦合泛化为 `ChannelAdapter` 架构，
Telegram 同样获得主动完成报告。

## 关键决策

### 1. 使用者授权：配对码 owner-binding，不用上游数字 ID 白名单

上游 tgapp 的访问控制是 `tg_allowed_users`（数字 Telegram user ID 列表），
要求用户先去找 @userinfobot 之类的机器人查自己的 ID——违反「不要让用户思
考」。飞书已经建立了配对码模式（0011），Telegram 完全复用同一套交互：托管
配置下空白名单 = 锁定等待配对（绝不是公开），私聊发对码的人成为唯一使用
者，错码静默忽略、10 次错码作废、解绑即重启换新码。三张卡（以及未来的第
四张）共享同一套 `OwnerBoundRow` / `BindCodeCallout` GUI 组件。

一个与飞书的有意差异：**换 Bot Token 不清除 owner 绑定**。飞书 open_id 是
应用作用域的（换 app 旧 open_id 失效，必须清），Telegram user id 是全局
的——换一个 bot 前端，主人还是同一个人。

### 2. reporter 泛化为 ChannelAdapter；Telegram 发送走 Bot HTTP API

`im_reporter` 的飞书耦合集中在五个缝：连接状态、owner 查找、busy 判定、文
本渲染、出站发送。抽成 `ChannelAdapter` 基类 + `FeishuChannel` /
`TelegramChannel` 两个实现，reporter 核心（轮询、状态文件、去重、
SKIP_REPORT）零改动。`FeishuReporter(fsapp, …)` 保持原签名成为薄子类，现
有测试不动。

Telegram 的出站发送**不经过** python-telegram-bot 的事件循环：PTB 在
`tgapp.main()` 里跑自己的 loop，reporter 线程往里调度需要跨线程协调
（`run_coroutine_threadsafe` + loop 捕获 + patch 面扩大）。改用同 token 直
接 POST `api.telegram.org/bot<token>/sendMessage`（urllib，无新依赖）——同
一个 bot 身份，零 loop 耦合。已知限制：**报告只发文本**，生成的文件留在
Galley session 里（飞书 reporter 会带附件）。

busy 判定也不同：飞书用 `get_app().user_tasks`（卡片流式共享，需要
0013 的 report-turn 隔离 flag）；tgapp 每个任务有独立 dq 和独立
`_stream`，没有共享卡片问题，busy 只看 `agent.is_running`，不需要隔离
patch。

### 3. patch 0014 一个打包（不拆 0009+0011 两段）

飞书拆两个 patch 是因为分两次落地；Telegram 的 env 配置和 owner 绑定同时
落地，且都改同一批函数（配置加载、handler 门卫、main），拆开反而互相叠
diff。一个 patch，manifest 里把 rebase 风险写清楚（`__main__` → `main()`
重构、per-handler 门卫）。上游语义严格保持：非托管（mykey 文件）路径原样
透传，包括「空白名单拒绝启动」的上游行为。

### 4. 状态机：`post_init` 是 polling bot 的「真连上了」时刻

飞书靠 websocket 私缝（`_connect`）报 running；Telegram 是长轮询，没有连
接事件。PTB 的 `post_init` 在 `Application.initialize()`（即 getMe 验证
token）之后运行，是最早的可靠信号——在这里发 `running` + botId。崩溃循环
沿用飞书的三振出局（首连前 3 次失败 → error），外加 `InvalidToken` 立即
error（token 错误没有重试的意义，30 秒的三振等待纯属浪费用户时间）。

### 5. 网络：不做代理 UI

Telegram API 国内直连不通。决策（JC 拍板）：默认选择 Telegram 的用户有网
络解决能力。子进程继承 Galley 的代理环境变量（httpx / urllib 都默认
trust_env），错误 hint 提一句「需要能访问 Telegram 的网络环境」，不做代理
配置界面。

## 被否的方案

- **暴露 `tg_allowed_users` 输入框**：让用户查自己的数字 ID 是糟糕的首次
  体验；配对码已被飞书验证。
- **reporter 调度到 PTB 事件循环发消息**：需要 patch 暴露 Application 实
  例 + 跨线程 loop 协调，收益只是复用 SDK 的重试；HTTP API 更简单且独立于
  前端进程状态。
- **`ensure_single_instance`（端口锁）进 managed `main()`**：托管模式已有
  supervisor.lock 文件锁；端口锁留在 `__main__`（非托管路径）不动。

## 触点清单

- managed-ga：`patches/0014-managed-telegram-galley-integration.patch`
  （`tgapp.py`：env 配置 / 状态 hook / `main()` / owner 绑定），manifest ×2。
- runner：`managed_im_supervisor.py` `_run_telegram`（GA_WORKSPACE_ROOT 隔
  离同飞书）；`im_reporter.py` ChannelAdapter 泛化 + `TelegramChannel`；
  测试 +2。
- core：`im_supervisor.rs` 平台常量 / 生命周期锁 / `append_platform_env`
  telegram 分支（`GALLEY_TELEGRAM_CONFIG_JSON`）/ owner 持久化按平台分发
  （原实现无条件写飞书配置，三渠道下是真 bug）/ `unbind_owner` 泛化；
  token 存 keychain（`im-supervisor:telegram:bot-token`），SQLite 只存
  owner + 时间戳；4 个新 Tauri 命令。
- gui：平台 union + `TelegramCard`（token 一栏即完成配置，比飞书短得多）+
  `TelegramGlyph`（内联 SVG 纸飞机）+ `OwnerBinding.tsx` 共享组件（飞书卡
  同步迁移）+ App/SettingsIM 三处聚合接线 + zh/en 各 ~35 个 key。
- CLI / Agent API：零改动（`--supervisor=galley-im/telegram` 是不透明字符
  串）。

## 待办 / 已知限制

- Telegram reporter 报告只发文本，不带生成文件。
- Telegram glyph 是手绘简化 SVG，视觉验收时可换正式品牌资产。
- 全 patch 栈对上游的 replay 验证照惯例推迟到下次 baseline 升级
  （0014 已验证可从当前树反向应用）。
