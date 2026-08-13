# runner：_run_discord + DiscordChannel + per-channel 身份注入

Status: ready-for-agent
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
