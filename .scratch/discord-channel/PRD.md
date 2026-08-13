# Discord Channel PRD：私人 Server 多频道的并行监督上下文

Status: active（2026-08-13 开工，JC 拍板；实施拆解见 `issues/01-07`）
日期：2026-08-13
来源：JC 提议 + 两轮设计讨论（调研：GA 官方 `dcapp.py` 全量精读 +
Galley IM Channel 架构全量摸底）
外审：2026-08-13 Codex（gpt-5.6-sol）14 条发现已折入本文——路由与
生命周期设计做了实质修正；重开的四票已于当日由 JC 投毕（见「外审
四票裁决」节）。

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
   不给「Server 成员都能用」开口子。配对流程经外审票 3 修订：**owner
   配对只认 DM**（bot 与用户同 Server 即 DM 可达），Server 频道里只做
   激活；配对错误尝试**按用户计数限流**（如单用户 5 次后拉黑其配对
   尝试），**不继承** Telegram「10 次全局作废」先例——在成员可见 bot
   的 Discord 语境里那是恶意作废 DoS 按钮。
4. **频道激活**：沿用上游「@提及激活 + 活跃集持久化（30 天 TTL）」，
   不做「所有频道常开」（外审票 2 裁定维持上游隐式语义，见外审四票
   裁决节）。
5. **上下文边界**：激活期间该频道 owner 的**全部**发言都进 agent
   （上游语义，票 2 裁定沿用）；仍不摄取频道内其他成员的消息。「频道
   讨论摘要」是另一个立项。
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

### 硬骨头一：完成推送的按频道路由（2026-08-13 外审修正）

现 `im_reporter` 假设单 owner 会话。初稿设想「supervisor id 带
channel_id + reporter 按频道实例化」，外审证伪了两处，修正后设计：

- **路由真相是消息 origin，不是 session origin**。reporter 现按
  `SessionBrief.origin.supervisor`（session 创建来源）过滤，但
  `session send --supervisor` 写的是消息 origin——频道 A 建的 session
  被频道 B 续聊，结果会推回 A；GUI 建的 session 被 Discord 续聊则
  完全不推。正确做法：按最终轮同 turn 的 user message 的
  `origin.supervisor` 路由，状态键改 `(final_message_id,
  supervisor_id)`。message origin schema 已存在，仍然零改 Agent API。
- **进程级单 dispatcher，不做 per-channel reporter**。多实例共享
  `reporter_state.json` 会写竞争；独立文件则重启后无人恢复路由（agent
  要等下条消息才建）；N 个 reporter 还各自 20s 全量轮询。改为：一次
  轮询、一个状态写者、按消息 origin 分发到 channel registry，启动时
  即恢复路由。`ChannelAdapter` 抽象保留，`DiscordChannel` 携带频道
  归属。
- **send 必须跨进 Discord 的 asyncio loop**：`ChannelAdapter.send()`
  是同步接口，直接调 dcapp 的协程只会拿到未 await 的 coroutine。用
  `run_coroutine_threadsafe` + 带超时的明确 ACK；发送函数不得吞异常
  （上游 `send_text` 吞异常会让 reporter 把未送达标成 delivered）。
  对已归档 thread / 频道被删 / 权限撤销定义可持久化的失败策略。

### 硬骨头二：per-channel supervisor id 的注入机制（外审新增）

现有提示词是 core 在进程启动前渲染好、经进程级环境变量
（`GALLEY_IM_SUPERVISOR_PROMPT_TEXT`）注入的——dcapp 所有频道 agent
会拿到同一段提示词、同一个 supervisor id。需要：core 提供 entry-layer
模板/静态基底，runner 在 `_get_agent()` 创建每个频道 agent 时显式
注入 `galley-im/discord/ch:<id>`（`managed_runtime.
install_managed_prompt_profile` 是必改触点）；不得靠并发改 `os.environ`。

**DM 路径**：上游保留 `dm:<user_id>` 且激活门控只作用于 guild。V1
**禁用绑定后的 DM 对话**（推荐；保持「频道即上下文」单一心智，也免去
为 DM 单独定义 prompt / reporter / 状态文件），复用 Telegram 作为
DM-supervisor 的定位。

成本估算上调：**1.5~2 × Telegram**（初稿 1.3× 低估了路由返工与
生命周期治理）。

### 必修的上游债（进补丁，非可选；外审后扩充）

- **agent 生命周期要真正的 close 协议**：初稿写「驱逐时显式 abort」
  不够——`abort()` 只停当前生成，`run()` 之后仍永久阻塞在
  `task_queue.get()`（上游 sentinel 分支在 `get()` 之后，传字符串
  先抛异常）。需要：正确 sentinel + stop event + join worker 线程；
  LRU 压到 8~16。验收看驱逐后线程数与 RSS 平台，不是看调了 abort。
- **连接状态机**：上游 `start()` 捕获一切异常永久退避重连——错 token、
  漏开 MESSAGE CONTENT INTENT、权限错配都落不成 GUI error，会永远
  displaying starting/reconnecting。补丁需分类：永久错误（token/intent）
  立即 error 并退出；网络/Gateway 临时错误才 reconnecting；`on_ready`
  才 running；停止时关闭 client 与后台任务。
- **状态文件归属**：上游把 `discord_active_channels.json`、附件下载、
  日志写 GA `temp/`；managed 模式必须改进 `--state-dir`
  （`im/discord/`）。「存了什么」已由外审票 4 裁定：引擎日志属引擎
  状态；补丁内做 dcapp 日志去内容化 + 附件每 turn 清理两件卫生活。
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
  （2026-08-13 已修，Discord 落地时照 22.8 的钉版方式办）。
- **必须先修的现有竞态**：owner 绑定事件先持久化后验进程代际，旧进程
  可把已解绑 owner 写回来（外审发现，Feishu/Telegram 均中招）。Discord
  接入前先修，见
  [im-owner-bind-race](../im-owner-bind-race/issues/01-persist-owner-before-generation-check.md)。
- **历史易失性要显性化**：频道 agent 历史只活在当前进程 + LRU 命中期，
  但 active 集跨重启持久——重启/驱逐后频道会静默拿到全新 agent；上游
  `/restore` 不能兜底（全局最新日志 + glob 指向 code root）。默认设计：
  重启/驱逐时同步取消该频道 active 并提示重新 @ 激活（与 Telegram 的
  stateless 定位一致）；若将来要持久化历史，单独立项（票 4 的引擎
  状态解释不自动授权产品化的历史留存）。

## UX 设计

### Setup（复杂度介于 Telegram 3 步与飞书 6 段之间，做 4 步）

1. Developer Portal 建应用、Bot 页拿 token
2. 开 **MESSAGE CONTENT INTENT**（经典坑：不开的症状是 bot 在线但
   装死，文案按症状倒推写——「bot 在线但不回复 → 检查 Intent」）
3. 生成邀请链接，把 bot 拉进你的私人 Server（Discord bot 不能凭空收
   消息，必须同 Server；「建私人 Server」在多频道形态下是产品本意
   而非 workaround）
4. 保存 token、启动服务，**DM bot 发 6 位配对码**完成绑定（票 3：
   配对只认 DM），然后到目标频道 `@Galley` 激活

Setup guide 必须承载的两条声明（票 1、2 选了纯文档路线，guide 是
唯一防线）：bot 在频道里的回复/文件/报告对该频道所有可见成员公开，
私密内容请用 owner-only 频道；频道激活后你在该频道的全部发言都会
交给 Galley，退出命令随激活确认一并展示。

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
choices + 分支；`im_reporter.py` 改单 dispatcher + 消息 origin 路由 +
`DiscordChannel` adapter（本清单最大的结构性改动）；
`managed_runtime.py` 的 `install_managed_prompt_profile` 支持
per-agent supervisor id 注入；`test_im_reporter.py` /
`test_managed_im_supervisor.py` 随之扩展。

**core（Rust）**：`im_supervisor/mod.rs` 平台常量 + `PLATFORMS` 数组
（注意长度）+ `normalize_platform`（改掉那条断言 discord 被拒的测试）；
`manager.rs` 加 `discord_lifecycle` 锁 + `logout` / `derived_status`
分支；`platform_config.rs` 加 `DiscordConfigPref` 全家桶 +
`append_platform_env` 分支；`managed_prompt.rs` 平台标签；
`commands/system.rs` 4 个新命令 + `lib.rs` 注册。

**gui**：`lib/im-supervisor.ts` union + 类型 + 4 个 invoke 包装；
`im/DiscordCard.tsx` + glyph + `status.ts` hint 表；`SettingsIM.tsx` /
`useChannelsStatus.ts` 聚合接线；**`use-model-config-toast.ts`**（外审
发现的第四方消费者，Telegram 接入时就漏过它，2026-08-13 已补 telegram，
见 [model-toast-telegram](../model-toast-telegram/issues/01-toast-misses-telegram.md)）；
中英文各 ~35 个 `discord*` key。

**scripts**：`bundle-python.sh` GA_DEPS + 冒烟门禁 +
`check-managed-ga-payload.mjs` 把 `dcapp.py` 列为必须文件。

**验收门禁（外审补）**：Rust 侧 owner 代际/路由测试；集成侧覆盖
多频道线程数与 RSS 平台、重启后漏报、跨频道续聊路由、共享频道可见性、
archived thread 发送失败。

**docs**：§9 Channels 规范 + 正式 devlog（把本 PRD 的裁决迁入）。

**零改动**：CLI / Agent API / schemaVersion（消息 origin 路由用的是
既有 schema 字段）。

## 外审四票裁决（2026-08-13 JC 投票，防重提案）

1. **输出可见性 → c（纯文档声明）**：setup guide 明确声明「bot 的
   回复、产出文件、完成报告对频道所有可见成员公开；私密内容请用
   owner-only 频道」，不做技术限制。**已否决**：agent 提议的
   「激活时 API 校验频道 owner-only + 主动推送前复校验」捆绑方案
   （理由充分但工程面偏重，JC 裁定 V1 从轻；将来真实泄露反馈出现
   可重审）。
2. **激活语义 → c（沿用上游隐式激活）**：@提及激活后，该频道 owner
   全部发言进 agent、条条刷新 30 天 TTL。**已否决**：条条要 @（太
   啰嗦）、显式 activate + 二次确认（随捆绑方案一并从轻）。文档侧
   兜底：激活行为及退出命令写进 setup guide 与命令参考表。
3. **配对场所 → a（修订版）**：owner 配对只认 DM，Server 内只做频道
   激活；错误尝试按用户限流，不做全局作废（Telegram「10 次全局作废」
   先例在 Discord 语境不继承——成员可见 bot，全局作废即 DoS 按钮）。
4. **Rule 4 解释 → a + 两件卫生活**：GA 运行时自产日志（如
   `model_responses`）判定为**引擎内部状态**，不算「Galley 存储
   supervisor 对话」；解释已入宪（CLAUDE.md Rule 4 补充句，
   2026-08-13）。随补丁做两件卫生活：dcapp 消息日志去内容化（只留
   事件 metadata）、附件改每 turn 临时目录用后即清。**已否决**：
   b（判定越线、managed 前端全面禁 prompt/response 日志）——
   `model_responses` 同时服务 `/restore` 与排障，为解释分歧付引擎
   减法 + 重构现有两渠道的代价不值。现有渠道日志保留策略（轮转/
   清理）另立小项：
   [ga-log-retention](../ga-log-retention/issues/01-managed-state-log-retention.md)。

## 启动信号（已触发）

2026-08-13 JC 直接拍板开工（原定信号之一）。开工仪式已办：PRD 拆成
`issues/01-07`，deferred.md 小节已拎出落
[开工 devlog](../../docs/devlog/2026-08-13-discord-channel-kickoff.md)；
前置阻塞 `im-owner-bind-race` 已修。
