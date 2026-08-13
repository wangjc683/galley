# 规范、devlog 与验收门禁

Status: done
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

## Comments

- 2026-08-13（agent）：已实施，只碰 `docs/` 与 `.scratch/discord-channel/`，
  未动代码、未 commit。
  - **§9 Channels 补 Discord 节**（`docs/design/overlays-and-settings.md`）：
    照飞书/Telegram 条目写法，一条主条目（Telegram 等形态 + 凭据/primary/
    换 token 不解绑随 Telegram + 4 步 setup，第 2 步症状倒推、第 3 步是
    Discord 独有的「拉进 Server」）+ 一条「与 Telegram 卡的刻意差异」子表
    （DM 配对与频道 @ 激活两段式 + 按用户限流不继承全局作废、两条常驻声明
    是无技术限制裁决下的唯一防线不得降级折叠、hint 6 条无 `waiting_scan`、
    glyph 内联 SVG 及其与 mask 路线的分界理由、en 保留中文退出命令）。
    全部按实施实况写（对过 `zh.ts` / `en.ts` / `status.ts` 实际文案）。
  - **正式 devlog**：
    `docs/devlog/2026-08-13-discord-channel-shipped.md`，形制照 Telegram
    那篇（结果 / 关键决策 / 触点清单 / 剩余验收），另加两节：**组合拳
    分工**（两条线 + 04 验收接力 + 06 额度截断接力）与**集成缝隙案例**
    （01 × 03 组合出重启漏报，03 以 `owned_prefixes` 挂起机制修复）。
    触点清单按 `git status` / diffstat 实测写，不照 PRD 计划态。
  - **devlog README** 2026-08-13 段顶部补索引行（密度对齐同段其他行）。
  - **PRD** Status 改 `implemented（待 dogfood 验收）`，文首加一句
    「本文是计划态，实施实况以 issues Comments 为准」并点名三处已知偏差。
  - `.scratch/discord-channel/` 按 issue-tracker 惯例**保留**，dogfood
    关闭后再清理。
  - 验证：`git diff --check` 干净。
  - **未做（不属本票）**：真机 dogfood 与其验收门禁（需 JC 建 Discord
    应用）、正式包从零重跑 bundle、0018 全栈补丁重放（待 baseline 构建）；
    上游 key 名 bug 报不报 upstream 仍待 JC 裁决，已在 devlog 末节留痕。
