# 托管微信渠道默认走 conductor 子进程，从 08-03 基线起不回消息

日期：2026-09-08

## 现象

社区 PR [#25](https://github.com/wangjc683/galley/pull/25)（作者 gangan）报告：
Galley 托管运行时下微信收得到消息但永不回复。作者用 conductor 的 `WS /ws`
握手核到 `llms count: 0`，定位到 conductor 子进程没有装
`install_managed_mykey_loader`，所以 `GenericAgent.__init__` 解析出零个
llmclient，runner loop 在第一条任务上静默死掉。

## 根因（比 PR 写的更大）

上游 `a1f7368`（2026-07-25，"wechat conductor forwarding mode with /switch"）
把 `frontends/wechatapp.py` 的模块级默认改成 `_MODE = 'conductor'`：每条消息都
`_cond_forward` 到固定端口 8900 上的 `conductor.py`，没起就用
`subprocess.Popen(..., start_new_session=True, stdout=DEVNULL)` 拉一个。
进程内那个装好了 loader 和 Galley prompt 的 `wechatapp.agent` 只有用户先发
`/switch` 才会参与。

这个提交在 2026-08-03 那次基线升级进了 managed-ga，所以 v0.4.9 / v0.4.10 /
v0.4.11 的托管微信渠道默认状态下全部不回消息。另外三个渠道（Feishu /
Telegram / Discord）没有 `_MODE` 这套机制，不受影响。

我们自己的两次基线审计都判错了：`docs/ga-baseline.md` 写
"`_start_conductor`, which Galley does not reach"，08-03 devlog 的 Rule-1
审计写 "`conductor.py`, which Galley does not run"。审计只看了 Galley 有没有
直接 spawn conductor，没看 supervisor import 的模块里模块级默认值把控制流
引向哪里。两处已加更正。

## 为什么不合 PR 的修法

PR 在 `managed-ga/code/frontends/conductor.py` 里加了一个启动钩子，往上爬目录
找 `runner/managed_runtime.py` 并调用 loader。诊断有价值，但修法有四个问题：

1. 直接改 `managed-ga/code`，没有 patch / manifest 条目，违反
   [patch 纪律](../managed-ga-runtime/code-state-and-patches.md)；
   `check-managed-ga-payload.mjs` 不做 replay，CI 抓不到这种漂移。
2. managed-ga 代码反向 import Galley 的 `runner` 包，0 处先例，新的耦合方向。
3. 只修了一半：conductor 里的 agent 没有 `install_managed_prompt_profile`，
   用户收到的是裸 GA conductor 的回复，不是 Galley supervisor。
4. conductor 本身不是 Galley 能接受的进程形态：detached、日志进 DEVNULL、固定
   端口、Core 不拥有不回收，`FILE_HOME = ROOT/temp` 打包后写进只读 code payload。
   和 Rule 5 冲突。

## 采纳的方案

supervisor 侧解决，零 patch。`_run_wechat` 本来就在 import 后 poke 模块属性
（`_TEMP_DIR`、`agent.verbose`），同一位置加 `wechatapp._MODE = "agent"`；
`bot.run_loop` 换成一个包装的 `on_message`，`/switch` 直接回复
"不支持" 并返回，其余原样转发给上游 `on_message`。
`test_run_wechat_pins_agent_mode_and_blocks_switch` 锁住这两个行为，
防下次基线升级再翻车。

裁决（JC，2026-09-08）：走 agent 模式；managed 下屏蔽 `/switch`；PR 上评论
说明诊断有价值但修法改向，Galley 自己提交 supervisor 侧修复；两处审计文档
更正；这个修完再修几处，然后发 hotfix。

## 被否的方案

- **把 conductor 做成 Galley 支持路径**：需要 patch、prompt 注入、生命周期归
  Core、状态路径重定向，是产品决定而非 bug 修复。没有用户诉求，先不做。
- **给 wechatapp 打 patch 改默认值**：能做，但 supervisor 侧已有同类 poke 手法，
  多一个 patch 只增加 rebase 面。

## 遗留

- 基线审计方法要补一条：supervisor import 的前端模块，其模块级默认值属于
  Galley 路径，升级时要看控制流而不只看 spawn 点。已写进 `ga-baseline.md`。
- 上游 `7fa5fa4`（"prevent WeChat polling from consuming chat input"，
  2026-08-30）不在当前基线，下次基线升级时一起看。
