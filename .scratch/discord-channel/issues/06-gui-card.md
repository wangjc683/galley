# GUI：DiscordCard + 聚合接线 + 文案

Status: ready-for-agent
Blocked by: 05
日期：2026-08-13

- `lib/im-supervisor.ts`：union 扩 discord + 类型 + 4 个 invoke 包装。
- `im/DiscordCard.tsx`：Telegram 卡形态（token 密码框 + 4 步
  `ConnectionSteps` + `OwnerBinding` + `StatusBadge`）；一卡一 primary
  规则；running 态换命令参考表（含频道激活/退出命令）。
- Setup 4 步文案按「症状倒推」写（PRD UX 节）：Portal 建应用拿
  token → 开 MESSAGE CONTENT INTENT（「在线但不回复→查这里」）→
  邀请进私人 Server → DM 配对码 + 频道 @ 激活。**guide 必须承载
  票 1/2 的两条声明**（频道内容对成员可见；激活后全部发言进 agent）。
- glyph：Discord logo `mask-image` PNG 吃 `currentColor`，进
  `im/Glyphs.tsx` + `gui/src/assets/`。
- `status.ts` 加 `discordStatusHintForState`（7 条 hint）。
- 聚合接线：`SettingsIM.tsx`（卡排第四）、`useChannelsStatus.ts`、
  **`use-model-config-toast.ts`**（外审教训，勿再漏）。
- i18n：中英各 ~35 个 `discord*` key。
- 验证：typecheck / lint / `im-supervisor.test.ts` 聚合测试扩展。
