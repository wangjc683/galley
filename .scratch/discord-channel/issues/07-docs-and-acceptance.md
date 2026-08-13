# 规范、devlog 与验收门禁

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06
日期：2026-08-13

- `docs/design/overlays-and-settings.md` §9 Channels 补 Discord 节
  （卡片形态、四步 setup、两条声明、与 Telegram 卡的刻意差异）。
- 正式 devlog entry：触点清单实测版 + 本 PRD 裁决迁入（含被否决
  候选），随后按 issue-tracker 惯例清理 `.scratch/discord-channel/`。
- 验收门禁（PRD 外审补）：多频道线程数与 RSS 平台、重启后漏报、
  跨频道续聊路由、共享频道可见性声明落 guide、archived thread 发送
  失败路径；真机 dogfood 需 JC 建 Discord 应用（token + Intent +
  测试 Server）。
- 上游 key 名 bug（`dc_bot_token` vs `discord_bot_token`）报不报
  upstream——仍待 JC 裁决，不阻塞。
