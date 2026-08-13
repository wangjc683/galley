# GUI：DiscordCard + 聚合接线 + 文案

Status: done
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

## Comments

**2026-08-13 接力完成**（前一个 agent 会话额度耗尽于「四处聚合接线」，
本次按票面逐项对表收尾，未重做已完成部分）。

**已落地**（`gui/src/` 内，未碰 core / runner / managed-ga / scripts）：

- `lib/im-supervisor.ts`：`ImSupervisorPlatform` 扩 `discord`，
  `DiscordImConfig` / `SaveDiscordImConfigInput` 类型，4 个 invoke 包装
  （`get/save/delete_discord_im_config`、`unbind_discord_im_owner`），
  与 Rust 侧命令名、`input` 参数名、camelCase 字段逐一核对一致。
- `im/DiscordCard.tsx`：Telegram 卡的等形态移植——密码框 token、
  4 步 `ConnectionSteps`、`OwnerBoundRow` / `BindCodeCallout`、
  `ChannelActionsMenu` + 两个 `ConfirmActionDialog`、running 态换
  `DiscordCommandReference`；「一卡至多一个 primary、存了 token 后
  primary 让位启动」规则继承。票 1/2 的两条声明（频道输出对成员可见、
  激活后全部发言进 agent）与 owner-only 提示一起常驻卡底，setup 与
  running 两态都在。
- 命令参考表按 `dcapp.py` 实况写：`@` 激活、`退出该频道`/`退出该子区`、
  `/llm` `/stop` `/new` `/status`（已对 `EXIT_CHANNEL_TEXTS` /
  `EXIT_THREAD_TEXTS` 与命令分支核对）。
- 四处聚合接线全部到位：`SettingsIM.tsx`（卡排第四 +
  `hasEnabledChannel` / `hasStaleEnabledChannel` / 重启后 `find` 三处
  数组）、`useChannelsStatus.ts`（`aggregateChannelsState` 数组 +
  `loadError` 链 + 重启 `find`）、`use-model-config-toast.ts`（外审点名
  的第四方消费者）、`im/CommandReference.tsx`。
- i18n：中英各 33 个 `discord*` key，`AppCopy` 由 zh 推导 + en 显式
  标注类型，typecheck 已双向锁死对称。

**与票面的偏差（三处，均有意）**：

1. **glyph 用 inline SVG 而非 mask PNG**：Discord clyde 是单色剪影，
   `fill="currentColor"` 已经能吃主题色，走 `WeChatGlyph` 的内联路径
   先例即可，不必新增二进制素材（飞书/Telegram 走 mask 是因为原 logo
   多色需要压平）。视觉结果与 mask 方案一致：单色、随 active 在
   `text-ink` / `text-ink-soft` 间切换、规避品牌色。
2. **hint 6 条而非 7 条**：`waiting_scan` 是微信扫码专属态，
   `runner/managed_im_supervisor.py` 只在 wechat 分支发它，Discord 桥
   永远不会进；半成品给它单写了 `discordWaitingBindHint` 并附了一句
   「这个态表示等待 DM 配对码」的错误注释。已照 Telegram map 的先例
   折叠到 `discordStartingHint` 并删掉那条永不渲染的中英文案——配对
   等待本来就由 `BindCodeCallout` 承载，不需要状态 hint 重复一遍。
3. **en 的退出命令保留中文原文**：`dcapp.py` 的退出词表只认中文，
   英文界面若写成 "leave channel" 会给出发不出去的命令，故英文文案
   写 `退出该频道` 并在描述里注明子区变体。

**验证**：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、
`pnpm --dir gui test`（41 文件 / 341 用例全绿，含半成品新增的
「四渠道 severity 序」聚合用例）、`git diff --check` 均通过。
prettier 未跑：仓库基线本身就有 prettier 漂移（HEAD 版
`im-supervisor.ts` / `zh.ts` / `en.ts` 同样报 warn），format 不是门禁，
跑 `--write` 会动到无关行。

**未做（属别的票）**：`docs/` §9 Channels 规范与正式 devlog（票 07）。
