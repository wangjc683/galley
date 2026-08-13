# Discord Channel PRD：私人 Server 多频道的并行监督上下文

Status: deferred（方案已裁决，等启动信号，见文末）
日期：2026-08-13
来源：JC 提议 + 两轮设计讨论（调研：GA 官方 `dcapp.py` 全量精读 +
Galley IM Channel 架构全量摸底）

## 产品定位

第四个 managed IM Channel（微信 → 飞书 → Telegram → Discord），也是
**第一个「并行监督上下文」channel**：用户在自己的私人 Discord Server 里，
不同频道各自对应一个独立的 supervisor 上下文（各自的 GA agent 实例、
各自的历史），thread 自动算独立频道。频道 ≈ 工作流，和「Galley 是 agent
team orchestrator」的产品心智同构。Telegram/飞书维持单线对话不变。

宪法对齐：IM 是 PRD 钦定的 Supervisor 远程传输层（localhost-only 规则
留的口子）；CLI / Agent API 零改动（supervisor id 是不透明字符串）；
managed-runtime only（Channels tab 本来就 gated managed）。

## 已裁决（2026-08-13，JC 确认，防重提案）

1. **V1 形态**：私人 Server 多频道对话（JC 裁决，推翻 agent 最初的
   DM-only 提案——后者更贴 Telegram 先例，但放弃了 dcapp 原生的多频道
   能力和并行上下文的产品价值）。
2. **频道语义**：一个频道 = 一个独立 supervisor 上下文（dcapp 原生
   `ch:<channel_id>` 模型）。已否决：频道↔session 绑定（session 生灭
   频率远高于频道，太僵）；多频道共享单一 supervisor 历史（消息串台，
   最糟）。
3. **访问控制**：Server 内仍然**单 owner 绑定**，非 owner 消息静默忽略。
   私人 Server ≠ 单人 Server，bot 背后是能驱动本机 CLI 的 supervisor，
   不给「Server 成员都能用」开口子。绑定流程：邀请 bot 进 Server →
   任意频道 `@Galley <6位配对码>` → 绑定 + 该频道激活。
4. **频道激活**：沿用上游「@提及激活 + 活跃集持久化（30 天 TTL）」，
   不做「所有频道常开」。激活语义 = 「把 bot 请进这个对话」；上游中文
   退出短语 Galley 化成显式命令。
5. **上下文边界**：V1 只读 owner 发给 bot 的消息，不摄取频道内其他人
   的消息。「频道讨论摘要」是另一个立项。
6. **Settings 卡不管频道**：卡片维持 Telegram 形态（token + setup +
   绑定态 + 状态徽章），频道激活/退出全在 Discord 内完成（在哪对话就
   在哪管理）。最多在 running 态命令参考表里列频道命令。
7. **邀请链接生成**：不加 Application ID 字段，setup guide 教用户在
   Developer Portal 生成邀请链接（少而精；token 解不出 client id）。
8. **Proxy UI**：沿用 Telegram 裁决（2026-07-05）不做；情境一致
   （国内均被墙）。
9. **完成推送 reporter**：做，对齐飞书/Telegram 档位（微信缺席是历史
   遗留不是范本）。

## 架构方案

### 总体：Telegram 补丁模板 + 保留 dcapp 的 guild 机制

不是包装 `dcapp.py` 原样跑，而是照 `0014-managed-telegram` 先例打
Galley 集成补丁：`GALLEY_DISCORD_CONFIG_JSON` env 注入配置（绕开
mykeys）、`_GALLEY_MANAGED` 旗标、`GALLEY_STATUS_HOOK` 状态回调、
可调用 `main()` / `check_config()`、owner 绑定码。与 Telegram 补丁的
不同：**保留** dcapp 的 per-channel agent 路由、@提及激活、活跃集、
thread 处理；**替换**其访问控制为 owner 绑定。

Discord 与 Telegram 同构的先例直接继承：单 Bot Token 凭证
（`im-supervisor:discord:bot-token` 进加密存储）；用户 ID 全局唯一 →
换 token 不解绑 owner（飞书因 open_id 应用作用域而解绑，是刻意的
不对称）。

### 唯一硬骨头：完成推送的按频道路由

现 `im_reporter` 假设单 owner 会话（轮询 `--supervisor=galley-im/<p>`
标记的 session，推给唯一 DM）。多频道后报告必须回到发起频道：

- 每个频道 agent 用自己的 supervisor id 打标：
  `galley-im/discord/ch:<channel_id>`（不透明字符串，CLI 零改动）。
- reporter 从单例改为随频道 agent 按频道实例化；`ChannelAdapter`
  抽象已备好（`runner/im_reporter.py:262-288`），`DiscordChannel`
  实现天然携带频道归属。

这是相对 Telegram 的最大工程增量；整体成本估 1.3 × Telegram。

### 必修的上游债（进补丁，非可选）

- **agent LRU 驱逐泄漏线程**：上游 LRU 上限 200、驱逐即丢（`run()`
  无干净退出）。压到 8~16 并驱逐时显式 abort。
- **状态文件归属**：上游把 `discord_active_channels.json`、附件下载、
  日志写 GA `temp/`；managed 模式必须改进 `--state-dir`
  （`im/discord/`）——宪法「数据留在 Galley」。
- Polish（非裁决点）：1900 字符切分避开 code fence 边界（上游会拦腰
  截断代码块；Discord 原生吃 markdown）。

### 上游备注

- **上游 bug（报不报待 JC 裁决）**：官方 `configure_mykey.py` 写
  `dc_bot_token` / `dc_allowed_users`，而 `dcapp.py` 读
  `discord_bot_token` / `discord_allowed_users`——官方配置器配出来的
  Discord 跑不起来。对 Galley managed 模式无影响（env 注入绕开
  mykeys）。
- **打包**：`discord.py` 不在 GA pyproject 依赖里，必须进
  `bundle-python.sh` 的 `GA_DEPS` + 冒烟门禁。关联既有缺口：
  [telegram-bundle-dep](../telegram-bundle-dep/issues/01-missing-python-telegram-bot.md)
  （Telegram 自己就漏了，先修它，Discord 别复制）。

## UX 设计

### Setup（复杂度介于 Telegram 3 步与飞书 6 段之间，做 4 步）

1. Developer Portal 建应用、Bot 页拿 token
2. 开 **MESSAGE CONTENT INTENT**（经典坑：不开的症状是 bot 在线但
   装死，文案按症状倒推写——「bot 在线但不回复 → 检查 Intent」）
3. 生成邀请链接，把 bot 拉进你的私人 Server（Discord bot 不能凭空收
   消息，必须同 Server；「建私人 Server」在多频道形态下是产品本意
   而非 workaround）
4. 保存 token、启动服务，任意频道 `@Galley <配对码>` 完成绑定

### UI：零新设计，全复用

`ChannelCard` 折叠壳 + `StatusBadge`（8 态）+ `ConnectionSteps`（4 步）
+ `OwnerBinding`（BindCodeCallout / 已绑定行）+ `ChannelActionsMenu` +
`TextCommandReference`。「每卡至多一个 primary、保存后让位启动」规则
继承。图标照飞书/Telegram：Discord clyde logo 做 `mask-image` PNG 吃
`currentColor`（单色融入版式，顺带规避品牌色）。卡片排第四位。

真正要产出的设计物：4 步 setup 文案、7 条状态 hint、logo mask 素材、
频道命令参考表文案。

## 触点清单（照 Telegram devlog 触点清单 + 代码现状核对）

**managed-ga**：`dcapp.py` 集成补丁 + `manifest.json` 登记 +
`patches/manifest.md` 文档；`discord.py` 进 `GA_DEPS` + 冒烟门禁。

**runner**：`managed_im_supervisor.py` 加 `_run_discord` + argparse
choices + 分支；`im_reporter.py` 加 `DiscordChannel` adapter +
按频道实例化改造（本清单唯一的结构性改动）。

**core（Rust）**：`im_supervisor/mod.rs` 平台常量 + `PLATFORMS` 数组
（注意长度）+ `normalize_platform`（改掉那条断言 discord 被拒的测试）；
`manager.rs` 加 `discord_lifecycle` 锁 + `logout` / `derived_status`
分支；`platform_config.rs` 加 `DiscordConfigPref` 全家桶 +
`append_platform_env` 分支；`managed_prompt.rs` 平台标签；
`commands/system.rs` 4 个新命令 + `lib.rs` 注册。

**gui**：`lib/im-supervisor.ts` union + 类型 + 4 个 invoke 包装；
`im/DiscordCard.tsx` + glyph + `status.ts` hint 表；`SettingsIM.tsx` /
`useChannelsStatus.ts` 三处聚合接线；中英文各 ~35 个 `discord*` key。

**docs**：§9 Channels 规范 + 正式 devlog（把本 PRD 的裁决迁入）。

**零改动**：CLI / Agent API / schemaVersion。

## 启动信号

- 出现真实的海外用户 issue 请求 Discord 接入；或
- JC 决定把 Galley 推向 Discord 系（海外/开发者）社区。

开工时：本 PRD 拆成 issues（补丁 → runner/reporter → Rust → GUI →
文案/规范），deferred.md 对应小节拎出落正式 devlog entry。
