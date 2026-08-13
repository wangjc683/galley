# Discord Channel 落地：并行监督上下文 + reporter 改单 dispatcher

日期：2026-08-13
关联：`.scratch/discord-channel/`（PRD + issues 01-07，dogfood 前不清理）、
[开工](./2026-08-13-discord-channel-kickoff.md)、
[外审四票裁决](./2026-08-13-discord-review-verdicts.md)、
[overlays-and-settings §9 Channels](../design/overlays-and-settings.md)

## 结果

Channels 第四张卡 Discord 全链路落地，同日从提案走到实现完成（提案 →
两轮设计 → Codex 外审 14 条 → JC 四票 → 拆 7 票 → 实施 → 全仓验证绿），
只差真机 dogfood。它是第一个**并行监督上下文**渠道：私人 Server 里
一个频道（子区同理）= 一个独立 supervisor 上下文，各自的 GA agent 实例、
各自的历史，supervisor id 形如 `galley-im/discord/ch:<channel_id>`。
微信 / 飞书 / Telegram 的单线对话语义不变。

CLI / Agent API / `schemaVersion` 零改动——supervisor id 是不透明字符串，
按频道路由用的是既有 message origin schema 字段。

## 已裁决（防重提案）

自 PRD 迁入，`.scratch/discord-channel/` 随 `v0.4.7` 销毁前的留痕。全部
由 JC 于 2026-08-13 确认；其中 3 / 4 两条经 Codex 外审修订，细节见
[外审四票裁决](./2026-08-13-discord-review-verdicts.md)。

1. **V1 形态**：私人 Server 多频道对话。**已推翻** agent 最初的 DM-only
   提案——后者更贴 Telegram 先例，但放弃了 dcapp 原生的多频道能力和
   并行上下文的产品价值。
2. **频道语义**：一个频道 = 一个独立 supervisor 上下文（沿用 dcapp 原生
   `ch:<channel_id>` 模型）。**已否决**：频道↔session 绑定（session
   生灭频率远高于频道，太僵）；多频道共享单一 supervisor 历史（消息
   串台，最糟）。
3. **访问控制**：Server 内仍是**单 owner 绑定**，非 owner 消息静默忽略
   ——私人 Server ≠ 单人 Server，bot 背后是能驱动本机 CLI 的 supervisor，
   不给「Server 成员都能用」开口子。配对只认 DM，Server 频道里只做激活；
   错误尝试**按用户限流**（5 次），**不继承** Telegram「10 次全局作废」
   先例——在成员可见 bot 的 Discord 语境里那是一个恶意作废 DoS 按钮。
4. **频道激活**：沿用上游「@提及激活 + 活跃集持久化（30 天 TTL）」，
   **不做**「所有频道常开」。
5. **上下文边界**：激活期间该频道 owner 的**全部**发言都进 agent（上游
   语义）；不摄取频道内其他成员的消息。「频道讨论摘要」是另一个立项。
6. **Settings 卡不管频道**：卡片维持 Telegram 形态（token + setup +
   绑定态 + 状态徽章），频道激活/退出全在 Discord 内完成——在哪对话就
   在哪管理。最多在 running 态命令参考表里列频道命令。
7. **不加 Application ID 字段**：setup guide 教用户在 Developer Portal
   生成邀请链接（少而精；token 解不出 client id）。
8. **Proxy UI 不做**：沿用 Telegram 裁决（2026-07-05），情境一致。
9. **完成推送 reporter 做**：对齐飞书 / Telegram 档位（微信缺席是历史
   遗留，不是范本）。

## 组合拳分工

本次是两个 agent 会话（Fable / Opus）并行的组合拳，按票的阻塞关系切成
两条线：一条线扛 reporter 单 dispatcher 改造（03，动现有飞书/Telegram
路径，风险最高）与最后的集成验收；另一条线扛 dcapp 补丁、打包门禁、
Rust core 接线、GUI 卡片。两次接力值得记：

- **04 的接力是验收接力**：04（runner）交付后由 03 的作者做集成验收，
  当场发现并补上了下面那道集成缝隙。
- **06 的接力是额度截断**：GUI 票做到「四处聚合接线」时前一个会话额度
  耗尽，后一个 agent 按票面逐项对表收尾，未重做已完成部分——票面写得
  足够细（四个聚合消费者点名列出）是这次接力没丢东西的直接原因。
  这也是 issue 面向 agent 写作的一次实测：**票是接力棒，不是备忘录**。

## 集成缝隙：谁都没错，合起来漏了

最值得留痕的一件事。两票各自正确的语义组合出了一个漏报：

- **01 的语义**：managed 模式下 dcapp 启动时释放全部持久化 active 频道
  ——重启后频道 agent 的历史已死，让用户重新 @ 激活（与「历史易失性
  要显性化」的默认设计一致）。
- **03 的语义**：dispatcher 收到未注册的路由目标一律当外人，只
  `mark_seen` 不 `mark_reported`（防止把别的 supervisor 的会话推给自己）。

合起来：重启前从某频道派出的任务，若在该频道重新激活之前跑完，报告就被
永久吞掉——两边单看都没错，缝隙在组合处。修复落在 03 侧：dispatcher 新增
`owned_prefixes`，**前缀命中但未注册**的路由目标改为挂起（entry 不动、
逐 tick 重查），频道重新激活即补投；`DiscordReporter` 以
`galley-im/discord/` 前缀声明所有权，单频道平台行为不变。回归测试
`test_owned_prefix_report_is_held_until_channel_reactivates`。

教训：多 agent 并行实施里，**票与票之间的语义组合是没有主人的地带**，
需要一次显式的集成验收去踩；这次是靠 04 的验收备注里那句「进程启动即
恢复路由在 managed 实跑等价 no-op」的观察牵出来的。

## 关键实现与实施偏差

各票 Comments 是实况来源，这里只记会影响后人判断的部分。

### 1. reporter：路由真相从 session origin 改为消息 origin

`ImReporter` 改为进程级单 dispatcher（一次轮询、一个状态写者、按 origin
分发到 channel registry），`FeishuReporter` / `TelegramReporter` 与
`start_*_reporter` 工厂签名不变（补丁侧零改动）。路由按最终答案同
turnIndex 的 user message 的 `origin.supervisor`，顺手修掉两个**现存**
缺陷：A 渠道建的 session 被 B 续聊会推回 A、GUI 建的 session 被渠道续聊
完全不推。候选集从「本 supervisor 建的 session」扩为「全部非 archived
且有活动的 session」，配 `ReporterState.prune` 防状态膨胀。

**偏差**：状态键保留 per-session 的 `lastReportedMessageId`，没有按 PRD
字面改成 `(final_message_id, supervisor_id)` 元组——一条 final 只会路由
到一个 supervisor，per-session 键已达成同等幂等性且状态更简单。

另两处行为修正：render/send 异常改计入 `reportAttempts`（有界重试），
不再逃逸到兜底导致每 tick 重烧 synthetic turn；busy 从「中断整轮」改
「跳过该报告」，多频道下其他频道继续流动。

### 2. dcapp 补丁 0018：sentinel 正面绕过上游缺陷

上游 `run()` 把 `task.get("images")` 写在 `isinstance(task, str)` 判断
**之前**，传字符串 sentinel 会先抛异常。补丁的 sentinel 用 `str` 子类
并实现 `.get()`，于是走上游自己的 break 分支干净返回——不靠异常杀线程，
也不动 `agentmain`。`_ChannelAgent.close()` = stop event + sentinel +
join，LRU 从上游 200 压到 12。

连接状态机分类落地：`LoginFailure` / `PrivilegedIntentsRequired` /
gateway 4004·4013·4014 / HTTP 401 判永久错误，立即报 `error` 并退出；
其余临时错误才 `reconnecting`（未连通前 3 次即判死）；`on_ready` 才
`running`。每个重连周期**重建 client**——`discord.Client` 关闭后不可
复用，上游那处会二次抛错。

外审票 4 的两件卫生活同批做掉：消息日志只留 metadata（chat/user/scope/
chars/attachments/command，不再写正文前 200 字）；附件下到每 turn 临时
子目录，turn 结束即 `rmtree`，启动时清扫崩溃残留。Polish：1900 字符
切分跟踪 ``` fence 状态，切点补收尾 fence、下一段同 marker + 语言重开。

补丁给 04 留的接口全在 dcapp 侧：`GALLEY_AGENT_HOOK(agent, chat_id)`、
`GALLEY_CHANNEL_RELEASED_HOOK(chat_id)`、`get_app()` / `app.loop` /
`app.deliver_text()`（**会抛错**的严格发送）/ `app.active_channel_ids()`。

### 3. per-channel 身份注入：模板 seam 而非并发改 env

core 侧 `managed_prompt.rs` 新增 `im_supervisor_prompt_template`，直接
调 `im_supervisor_prompt` 并传 `SUPERVISOR_ID_PLACEHOLDER`（**同一函数
两次绑定**，杜绝两份提示词漂移；配了「占位符替换后 == 直接渲染」的等价
断言），只在 `platform == DISCORD` 时经
`GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE` 注入。runner 侧
`install_managed_prompt_profile` 加可选 `supervisor_id` 参数，在
`GALLEY_AGENT_HOOK` 里替换后装到**这一个 agent 实例**上，全程不写
`os.environ`；模板 env 缺席时退回 `GALLEY_IM_SUPERVISOR_PROMPT_TEXT`
（对无占位符文本是 no-op，老 core 也起得来）。

### 4. Rust core 的两道防漏测试

平台常量 / `PLATFORMS` 扩 4 / 生命周期锁 / config pref 全家桶按 Telegram
先例对称落地，owner 语义随 Telegram 不随飞书（Discord user id 是全局
snowflake，换 token 不解绑；理由写进代码注释防后人「对齐飞书」误改）。
两个测试是给**下一个渠道**准备的：
`every_platform_has_an_enable_pref_key`（PLATFORMS 扩容时漏配 pref key
会红）、`every_platform_gets_a_distinct_lifecycle_lock`（防新平台悄悄
落到 WeChat 的锁上）。owner 事件路径零新代码——`admit_event` 的代际门
与平台无关，补了两个 discord 平台下的代际门测试把这份继承钉住。

原先断言 `discord` 被拒的 normalize 测试改成断言成功，并补 `slack` 作
负例，维持「白名单是封闭的」这层覆盖。

### 5. GUI：三处有意偏差

见 [§9 Channels](../design/overlays-and-settings.md) 的 Discord 条目，
规范已按实况写：glyph 走**内联 SVG** 而非 mask PNG（clyde 本就是单色
剪影，不必新增二进制素材）；status hint **6 条而非 7 条**（`waiting_scan`
是微信扫码专属态，Discord 桥永不进入，半成品曾为它单写一条永不渲染的
文案，已折叠进 `starting`）；**en 保留中文退出命令**（`dcapp.py` 的退出
词表只认中文，写 "leave channel" 等于给一条发不出去的命令）。

四处聚合消费者全部接线，包括外审点名的 `use-model-config-toast.ts`
——Telegram 接入时漏过它，这次列进票面才没再漏。

### 6. 打包：discord.py 钉 2.7.1

`GA_DEPS` 加 `discord.py==2.7.1`（当日最新稳定版，钉版风格随 telegram
22.8），`check-bundled-python-managed-ga.sh` 加 `import discord` +
`find_spec("frontends.dcapp")`，`check-managed-ga-payload.mjs` 把
`frontends/dcapp.py` 列为必须文件。兼容面逐符号在 2.7.1 上验过
（`Intents.default().message_content`、`Client(**options)` 仍
`options.pop('proxy')`、`DMChannel` / `Thread` / `File` /
`Messageable.send(file=…)`）。

## 触点清单（实测版）

- **managed-ga**：`code/frontends/dcapp.py`（+730 行改动面）、新增
  `patches/0018-managed-discord-galley-integration.patch`、
  `manifest.json` + `patches/manifest.md` 登记。
- **runner**：`im_reporter.py`（dispatcher 化 + `DiscordChannel` +
  `DiscordReporter`）、`managed_im_supervisor.py`（`_run_discord` +
  argparse choices + state dir + hooks）、`managed_runtime.py`
  （per-agent supervisor id）；`tests/test_im_reporter.py` +
  `tests/test_managed_im_supervisor.py` 大幅扩展。
- **core**：`im_supervisor/{mod,platform_config,manager}.rs`、
  `managed_prompt.rs`、`commands/system.rs` + `lib.rs`（4 个新命令）。
- **gui**：新增 `settings/im/DiscordCard.tsx`；`lib/im-supervisor.ts`
  （union + 类型 + 4 个 invoke 包装）、`im/{Glyphs,status,CommandReference}`、
  `SettingsIM.tsx`、`hooks/useChannelsStatus.ts`、
  `models/use-model-config-toast.ts`、`i18n` 中英各 33 个 `discord*` key、
  `lib/im-supervisor.test.ts`。
- **scripts**：`bundle-python.sh`、`check-bundled-python-managed-ga.sh`、
  `check-managed-ga-payload.mjs`。
- **docs**：`design/overlays-and-settings.md` §9 Channels + 本 entry。
- **零改动**：CLI / Agent API / `schemaVersion`。

## 验证与剩余验收

已绿：`cargo check`/`cargo test --workspace`、runner `pytest` /
`mypy strict` / `ruff`、gui `typecheck` / `lint` / `test`、
`check-managed-ga-payload.mjs` 与 bundled-python 冒烟门禁、
`git diff --check`。

剩余项已在 `v0.4.7` 发布准备时全部闭合（2026-08-13）：

- **真机 dogfood：JC 已完成，未发现问题。**
- **`bundle-python.sh` 从零重跑：`mac-x64` 绿**，`import discord` +
  `find_spec("frontends.dcapp")` 在 bundle 自带 python 下验过。
  `mac-arm64` / `win-x64` **本机不可验**——脚本靠运行 bundle 里的 python
  装依赖，而维护者机器是 Intel x86_64；这两个 arch 由 `release.yml` 在
  各自 runner 上跑同一脚本覆盖。「真 bundle 里起真服务」折进安装冒烟时
  点一次 Discord 开关，不单列。
- **全栈补丁重放：已补跑，18/18 干净应用，重建 payload 与仓库中成品
  零差异。** 用的是 `build-managed-ga.sh` 自己写明的出路（干净临时
  clone at audited baseline），全程未碰维护者的 checkout。同批发现
  `0019` 也从未过全栈重放，且它改的 `frontends/fsapp.py` 正是
  `0009` / `0011` / `0012` / `0013` 都改过的文件，而 `manifest.md` 头部
  漏记了它的存在——已一并修正。原委见
  [v0.4.7 发布](./2026-08-13-v0.4.7-release.md)。
- `.scratch/discord-channel/` 已随 `v0.4.7` 销毁，durable 内容（含上面
  「已裁决」九条）先迁入本篇。

## 那一票的裁决：不报 upstream

上游 `configure_mykey.py` 写 `dc_bot_token` / `dc_allowed_users`，而
`dcapp.py` 读 `discord_bot_token` / `discord_allowed_users`——官方配置器
配出来的 Discord 跑不起来。**JC 裁决不报**（2026-08-13）：对 Galley
managed 模式无影响（env 注入绕开 mykeys，且我们对齐的是 dcapp 的读侧）。
此票关闭，不再挂账。
