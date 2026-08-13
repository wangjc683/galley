# Rust core：discord 平台接线

Status: done
日期：2026-08-13

照 PRD 触点清单（外审核对版）：

- `im_supervisor/mod.rs`：平台/pref/secret-ref 常量，`PLATFORMS` 扩
  4（注意数组长度），`normalize_platform`，**改掉断言 discord 被拒的
  测试**。
- `manager.rs`：`discord_lifecycle` 锁 + `lifecycle_lock` 分支；
  `logout` / `derived_status` 分支。owner 事件路径直接继承已修的
  `admit_event` 代际门（`.scratch/im-owner-bind-race/`，已 done）。
- `platform_config.rs`：`DiscordConfigPref` 全家桶、4 个 config 函数、
  `append_platform_env` 出 `GALLEY_DISCORD_CONFIG_JSON`、owner 三函数
  分支、`discord_config_ready`；换 token 不解绑（同 Telegram）。
- `managed_prompt.rs`：平台标签 + per-channel entry-layer 模板 seam
  （供 runner 每频道注入，见 issue 04）。
- `commands/system.rs` 4 个新命令 + `lib.rs` 注册。
- Rust 测试：normalize / config pref / 代际门在 discord 平台下的覆盖。

## Comments

### 2026-08-13 实施完成

全部照 Telegram 先例逐项对称落地，只动 `core/src/`。

**改动文件**

- `core/src/im_supervisor/mod.rs`：`DISCORD` / `DISCORD_PREF`
  (`im_supervisor_discord`) / `DISCORD_CONFIG_PREF`
  (`im_supervisor_discord_config`) / `DISCORD_TOKEN_REF`
  (`im-supervisor:discord:bot-token`)；`PLATFORMS` 改 `[&str; 4]`；
  `normalize_platform` 与 `pref_key` 收 discord。
- `core/src/im_supervisor/platform_config.rs`：`DiscordConfigPref` /
  `DiscordImConfig` / `SaveDiscordImConfigInput` 三件套，
  get/save/delete 三函数，`discord_config_ready`，
  `pref_owner` / `persist_owner` / `clear_owner_pref` 三处分支，
  `append_platform_env` 输出 `GALLEY_DISCORD_CONFIG_JSON`。
- `core/src/im_supervisor/manager.rs`：`discord_lifecycle` 锁 +
  `lifecycle_lock` 分支；`logout` 调 `delete_discord_im_config`；
  `derived_status` 调 `discord_config_ready`；discord 平台额外注入
  `GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`。
- `core/src/managed_prompt.rs`：平台标签加 `"discord" => "Discord"`；
  新增 `SUPERVISOR_ID_PLACEHOLDER` 与 `im_supervisor_prompt_template`。
- `core/src/commands/system.rs` + `core/src/lib.rs`：
  `get_/save_/delete_discord_im_config` + `unbind_discord_im_owner`
  四命令与 invoke_handler 注册。

**决策记录**

1. **owner 语义随 Telegram 不随飞书**：Discord user id 是全局
   snowflake，换 bot token 不解绑 owner（飞书 open_id 是应用作用域才
   刻意解绑）。理由已写进 `DiscordConfigPref` 与 `save_discord_im_config`
   的注释，防后人「对齐飞书」误改。
2. **env JSON 用 `discord_*` 而非 `dc_*` 键名**：照 PRD 上游备注，
   `dcapp.py` 读的是 `discord_bot_token` / `discord_allowed_users`
   （官方 `configure_mykey.py` 写 `dc_*` 是上游 bug）。managed 模式经
   env 注入绕开 mykeys，所以对齐 dcapp 的读侧。bind code 键
   `discord_owner_bind_code` 按 fs/tg 命名惯例补齐。
3. **prompt 模板 seam 用「同一函数两次绑定」而非复制文案**：
   `im_supervisor_prompt_template` 直接调 `im_supervisor_prompt` 并传
   占位符，杜绝两份提示词漂移；配了断言「占位符替换后 == 直接渲染」的
   测试锁死这层等价。模板只在 `platform == DISCORD` 时注入，单上下文
   平台不发。
4. **owner 事件路径零新代码，已确认**：`admit_event` 的代际门只比
   `status.pid`，与平台无关；`read_stdout` 在 slots 锁内 admit + persist
   的顺序也是平台无关的。补了两个 discord 平台下的代际门测试把这份
   继承钉住（含「解绑后旧进程缓冲事件不得复活 owner」）。
5. **保留 normalize 负例**：原测试断言 `discord` 被拒，改成断言成功后
   补 `slack` 作负例，维持「白名单是封闭的」这层覆盖。

**新增测试**（8 个，均绿）：normalize 收 discord + slack 负例、
`every_platform_has_an_enable_pref_key`（PLATFORMS 扩容时漏配 pref key
会红）、discord config pref 默认值与 owner 往返、两个 discord 代际门、
discord `ImSupervisorLine` 解析、`every_platform_gets_a_distinct_lifecycle_lock`
（防新平台悄悄落到 WeChat 的锁上）、prompt 平台标签与模板等价性。

**验证**：`cargo check --workspace`、`cargo test --workspace` 全绿；
`git diff --check` 干净。rustfmt 只留仓库原有的 `manager.rs`
`let-else` 一处历史 diff，本次改动已手工对齐 rustfmt（未跑全仓
`cargo fmt`，避免动到其他 issue 的在途改动）。

**下游未做（属别的票）**：gui 的 `DiscordCard` / invoke 包装（06）、
runner 的 `_run_discord` 与模板消费（04）、`GALLEY_DISCORD_CONFIG_JSON`
的 dcapp 补丁读侧（01）。
