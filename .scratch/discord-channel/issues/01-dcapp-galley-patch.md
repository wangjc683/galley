# dcapp Galley 集成补丁

Status: done
日期：2026-08-13

照 `0014-managed-telegram` 模板给 `managed-ga/code/frontends/dcapp.py`
打集成补丁，**保留** per-channel agent 路由 / @提及激活 / thread 处理，
**替换**访问控制。清单（细节全在 [PRD](../PRD.md)）：

- `GALLEY_DISCORD_CONFIG_JSON` env 注入（`_GALLEY_MANAGED` 旗标绕开
  mykeys）、`GALLEY_STATUS_HOOK` 状态回调、可调用 `main()` /
  `check_config()`。
- owner 绑定：**配对只认 DM**（外审票 3），6 位配对码，错误尝试按
  用户限流（单用户 5 次拉黑），无全局作废；Server 频道只做 @ 激活；
  非 owner 消息静默忽略。
- 激活语义沿用上游隐式（外审票 2），激活确认文案含退出命令；**禁用
  绑定后的 DM 对话**（V1 裁决）。
- 连接状态机：token/intent 类永久错误立即 error 退出；网络类才
  reconnecting；`on_ready` 才 running；停止关 client 与后台任务。
- agent 生命周期：LRU 压 8~16 + 真 close 协议（sentinel + stop event
  + join；`abort()` 不够）；重启/驱逐同步取消频道 active。
- 状态文件迁 `--state-dir`（active 集 / 附件 / 日志）；消息日志去
  内容化；附件每 turn 临时目录用后即清（外审票 4 卫生活）。
- Polish：1900 字符切分避开 code fence。

补丁登记进 `managed-ga/manifest.json` + `patches/manifest.md`
（touched files / rebase 风险 / 移除条件）。

## Comments

- 2026-08-13（agent/Fable）：已实施。改动：`managed-ga/code/frontends/
  dcapp.py`（payload）、新增 `managed-ga/patches/
  0018-managed-discord-galley-integration.patch`、`managed-ga/
  manifest.json` 与 `patches/manifest.md` 登记。要点：
  - **配置注入**：`GALLEY_DISCORD_CONFIG_JSON`（`discord_bot_token` /
    `discord_allowed_users` / `discord_owner_bind_code`，可选 `proxy`）+
    `_GALLEY_MANAGED` 旗标 + `GALLEY_STATUS_HOOK` + 可调用 `main()` /
    `check_config()`。key 名与已落地的 `core/src/im_supervisor/
    platform_config.rs` 完全对齐（已核对）。managed 分支显式丢弃 `"*"`，
    公共访问在 managed 模式下不可由配置推导出来。
  - **owner 绑定**：只认 DM（guild 消息在 locked 态整体忽略）；错误尝试
    **按用户计数**（5 次后该用户静默拉黑，OrderedDict 上限 512 防内存
    膨胀），**无全局作废**；猜错零回复；绑定成功回 DM 并经 hook 报
    `ownerOpenId`。
  - **激活语义**：沿用上游 @提及隐式激活 + 30 天 TTL 活跃集；新增
    「首次激活」确认消息（含可见性声明 + 「退出该频道 / 退出该子区」）。
    managed 模式绑定后 DM 只回一句「去频道」提示（5 分钟节流）。
  - **连接状态机**：`LoginFailure` / `PrivilegedIntentsRequired` /
    gateway 4004·4013·4014 / HTTP 401 判永久错误 → 报 `error` 并退出
    进程；其余临时错误 → `reconnecting` + 退避，未连通前 3 次即判死；
    `on_ready` → `running`（带 `botId`）；每个重连周期重建 client
    （discord.Client 关闭后不可复用，上游那处会二次抛错）；停止时关
    client + cancel 后台 task + close 全部 agent。
  - **agent 生命周期**：LRU 200 → **12**；`_ChannelAgent` 封装
    agent+线程+stop event，`close()` = stop event + sentinel + join。
    sentinel 用 `str` 子类并实现 `.get()`，正面绕过上游 `run()` 把
    `task.get("images")` 写在 `isinstance(task, str)` 之前的缺陷——走
    上游自己的 break 分支干净返回，不靠异常杀线程，也不动 agentmain。
    驱逐/退出/TTL 过期同步取消频道 active；驱逐时发一条「上下文已释放，
    重新 @ 我」；managed 模式重启时释放全部持久化 active（下一条消息
    回一次重启提示），file-based 模式保持上游持久化语义。
  - **状态文件**：`GALLEY_DISCORD_STATE_DIR`（launcher 注入）承载活跃集
    JSON 与附件目录，未注入时退回上游 `temp/`；日志由 launcher 重定向
    （`__main__` 路径仍走上游 `redirect_log`）。
  - **卫生活**：消息日志只剩 metadata（chat/user/scope/chars/attachments/
    command），不再写正文前 200 字；附件下到每 turn 临时子目录
    `discord_media/turn_*`，turn 结束即 `rmtree`，启动时清扫崩溃残留。
  - **切分**：`_split_discord_text` 跟踪 ``` fence 状态，切点处补收尾
    fence、下一段用同 marker+语言重开；超长单行硬切也守同一规则。
  - 验证：`.venv/bin/python -m py_compile` 通过；补丁隔离重放验证
    （HEAD 版 payload + 0018 → 与提交的 payload 逐字节相同，重放产物
    再 py_compile 通过）；`_split_discord_text` 用脚本跑了长文本 / 长
    代码块 / 超长单行 / 未闭合 fence 四组，每段长度达标且 ``` 计数成偶；
    sentinel 按上游 `run()` 序言形状实测 `task.get("images") → []` 且
    `isinstance(task, str) → True`。`.venv` 没装 `discord.py`，运行级
    验证做不了（依赖归 issue 02 打包票）；`scripts/build-managed-ga.sh`
    的全栈重放也没跑（本机 GA checkout 不在 pin 的 baseline 且是脏的），
    已在 `patches/manifest.md` 顶部注明「0018 未过全栈重放，下次
    baseline 构建时补」。
  - **留给 04 的接口**（都在 dcapp 侧，04 只需接）：
    `GALLEY_AGENT_HOOK(agent, chat_id)` —— 每个频道 agent 创建时触发，
    `chat_id` 即 `ch:<channel_id>`，用来注入
    `galley-im/discord/ch:<id>` 的 per-channel supervisor id；
    `GALLEY_CHANNEL_RELEASED_HOOK(chat_id)` —— 频道退出 / TTL 过期 /
    agent 驱逐时触发，供 reporter registry 注销；
    `dcapp.get_app()` 拿到运行中的 `DiscordApp`，`app.loop` 是 client
    的事件循环，`app.deliver_text(chat_id, text)` 是**会抛错**的严格
    发送（配 `run_coroutine_threadsafe(...).result(timeout)` 拿真 ACK，
    对齐 03 定的 `ChannelAdapter.send` 失败契约）；
    `app.active_channel_ids()` 列当前活跃频道。
    另注意：04 的 `_run_discord` 需要设 `GALLEY_DISCORD_STATE_DIR`
    （建议 `im/discord/`）并在 import 后、`main()` 前挂上述 hook。
