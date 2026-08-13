# runner：_run_discord + DiscordChannel + per-channel 身份注入

Status: done
Blocked by: 01, 03
日期：2026-08-13

- `managed_im_supervisor.py`：`_run_discord()` + argparse choices +
  dispatch 分支 + lock/log 命名；import 兜底照 telegram 报
  `import failed`。
- per-channel supervisor id 注入（PRD「硬骨头二」）：
  `managed_runtime.install_managed_prompt_profile` 支持在
  `_get_agent()` 创建每个频道 agent 时注入
  `galley-im/discord/ch:<id>`；不得并发改 `os.environ`。core 侧模板
  seam 在 issue 05。
- `im_reporter.py`：`DiscordChannel` adapter（携带频道归属，挂 03 的
  dispatcher）。
- `runner/test_managed_im_supervisor.py` / `test_im_reporter.py` 扩展。

## Comments

- 2026-08-13（agent/Fable）：已实施，runner 全量验证绿（pytest 232 通过
  / mypy strict 零错 / ruff / `git diff --check`）。只动 `runner/`，
  managed-ga、core、gui、scripts 未碰。要点：
  - **`_run_discord`**（`runner/managed_im_supervisor.py`）：照
    `_run_telegram` 结构——`supervisor.lock` 独占、`discord.log` 重定向、
    `GA_WORKSPACE_ROOT` / `GA_USER_DATA_DIR`、import 前设
    `GALLEY_DISCORD_STATE_DIR = <state_dir>`（即 `im/discord/`，dcapp 在
    import 期就要拿它算活跃集文件与附件目录）、import 兜底同时吃
    `Exception` 与 `SystemExit`（缺 discord.py 时 dcapp 是
    `sys.exit(1)`）报 `import failed:`、挂 `GALLEY_STATUS_HOOK`（透传
    `botId` / `ownerOpenId` 等 extra 字段）、`check_config()` 不 ready 报
    「Discord Bot Token is required」、最后调 `dcapp.main()`。argparse
    `choices` 加 `discord` + dispatch 分支。
  - **per-channel 身份注入**：`managed_runtime.managed_prompt_profile` /
    `install_managed_prompt_profile` 加可选第三参 `supervisor_id`
    （默认 None，现有单 agent 调用方式零改动），命中时把
    `managed_runtime.SUPERVISOR_ID_PLACEHOLDER`
    (`__GALLEY_SUPERVISOR_ID__`) 换成该值再装到**这一个 agent 实例**上。
    `_run_discord` 的 `GALLEY_AGENT_HOOK` 里按
    `f"{GALLEY_SUPERVISOR_ID}/{chat_id}"` 组出
    `galley-im/discord/ch:<id>`；全程不写 `os.environ`。
    prompt env 名优先取 05 注入的
    `GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`，缺席时退回
    `GALLEY_IM_SUPERVISOR_PROMPT_TEXT`（老 core 也不至于起不来，替换对
    无占位符文本是 no-op）。
  - **`DiscordChannel`**（`runner/im_reporter.py`）：`connected()` 看
    `_galley_connected_once` 且 `get_app()` 非 None；`owner_id()` 复用
    `_single_owner`，但 dcapp 没有 `PUBLIC_ACCESS` 常量（managed 模式直接
    丢弃 `"*"`），改问 dcapp 自己 import 的 `public_access(ALLOWED)`
    谓词——空集/含 `*`/多人都判无唯一 owner；`busy()` 看
    `app.user_tasks[chat_id]` 加该频道 agent 的 `is_running`；
    `render()` 走 `_strip_discord_transcript`（不用
    `_display_done_text`：它对空正文返回 `"..."`，reporter 需要空串才能
    走「无需发送」分支）；`send()` 用
    `run_coroutine_threadsafe(app.deliver_text(chat_id, text), app.loop)
    .result(30)` 拿真 ACK，失败抛错。报告发回**频道本身**，`owner` 只当
    绑定闸门不当收件人。
  - **`DiscordReporter` + `start_discord_reporter`**：dispatcher 子类，
    `attach_channel(chat_id, agent)` / `detach_channel(chat_id)` 负责
    supervisor id 拼装，launcher 的两个 hook 直接调它、不必认识
    `im_reporter` 的符号（reporter 起不来时 hook 自然降级为只装 prompt）。
    `restore_active_channels()` 从 `app.active_channel_ids()` 恢复注册；
    恢复的频道没有 agent，首次用时经 `app._get_agent(chat_id).agent`
    懒解析（与一条入站消息同一条路径，已在 docstring 标注为耦合点）。
  - **留意（不是 bug，是 01 的既定语义）**：managed 模式下 dcapp 构造
    `DiscordApp` 时会释放全部持久化 active 频道（重启后上下文已死），
    且 `_APP` 要到 `main()` 里才建，而 launcher 是先起 reporter 再调
    `main()`——所以「进程启动即恢复路由」这条在 managed 实跑里等价于
    no-op，真实注册全部来自 `GALLEY_AGENT_HOOK`。`restore_active_channels`
    对 `get_app() is None` 安全返回空，逻辑本身有测试覆盖（含懒解析
    agent 的送达路径），留着供 file-based / 未来放宽重启语义时用。
  - **锁序**：agent hook 在 dcapp `_agent_lock` 内执行，只做 prompt 安装
    与 registry 写入，不回调 DiscordApp；reporter 侧从不持
    `_channels_lock` 调 dcapp（`channels()` 取快照即释放），无反向锁序。
  - 测试：`test_managed_im_supervisor.py` +6（argparse choices 接受
    discord/拒绝未知平台、import SystemExit 兜底、token 缺失、
    state-dir + hooks + per-channel id + 状态行全链路、无 template 时的
    回退、`install_managed_prompt_profile` 双 agent 双身份且 env 不被改
    写）；`test_im_reporter.py` +6（真 loop 线程跨线程送达、busy 推迟、
    detach 后不再路由、owner 闸门四态、send 失败抛错并计入 attempts 且
    第 4 次不再烧 synthetic turn、`start_discord_reporter` 恢复注册 +
    懒解析 agent 送达、无 `GALLEY_SUPERVISOR_ID` 时禁用、app 未起时
    inert）。全部用 stub，`.venv` 无 discord.py 不受影响；runner 代码
    也没有任何顶层 `import discord`。
- 2026-08-13 验收备注（Fable）：报告里「进程启动即恢复路由在 managed
  实跑等价 no-op」的观察正确，且暴露了 03/01 语义组合的重启漏报缝隙，
  已在 03 侧以 `owned_prefixes` 挂起机制修复（见 03 票 Comments）。
  04 交付本身验收通过，全仓集成验证绿。
