# Rust core：discord 平台接线

Status: ready-for-agent
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
