# GA 上游升级 30b24ad -> efb3bc6

**日期**：2026-08-31
**上下文**：v0.4.11 发版预备。v0.4.10 发版时留下的标准动作：当时上游已领先
10 提交（至 `9e68c20`）被裁定引擎无关、有意不 bump；本轮把整段（19 提交，
含那 10 个）审完并 bump。

## 范围形状

`30b24ad..efb3bc6` = 19 提交，168 文件，~17.1k/+1.6k−——数字吓人，但按
SOP 先分类后读 diff：大头全是上游自家 Desktop 2.0 产品线
（`src-tauri/lib.rs` +3.8k、`desktop_bridge.py` +1411、编译产物、
发布资格工具、~5k 行上游测试），Galley 路径零耦合。**引擎核心 delta 只有
`llmcore.py`（+28/−8）和 `agentmain.py`（+11）**；`ga.py`、
`agent_loop.py`、`pyproject.toml` 零 diff（`[project.dependencies]`
未动 → `GA_DEPS` 不用改）。

## 引擎 delta：全部是 Galley 正收益（abort 响应性 + 裁剪性能）

- **可中断重试退避**（`3d62523`）：`_stream_with_retry` 的重试 sleep 改为
  0.2s 粒度轮询 `should_stop()`，每次 attempt 开头和每个 chunk 前都查停。
  此前用户在重试退避窗口（最长 30s 或服务端 Retry-After）里点停止要干等。
  与 deferred「Goal 停止立即 abort」的响应性诉求同向。
- **abort 强制唤醒阻塞的 recv**（`3d62523`）：`agentmain.abort()` 摸到底层
  socket 调 `shutdown()` + CPython 内部 `_real_close()`（上游在 Windows
  实测过 `shutdown`/`close` 唤不醒阻塞的 recv）。挂死流的 abort 真能拆流了。
- **裁剪线性化**（`0c235a8`）：`trim_messages_history` 预计算每条消息成本，
  语义与 history 形状不变——restore 注入不受影响，只是长会话裁剪不再平方。
- 流指标 `STATS`（ttft/tps，`13eef20`）：上游自用，Galley 不读，惰性。

## 补丁栈 rebase：一处真冲突（0017 × 上游 token ledger）

commit-chain 脚本 16/19 干净；预判的 `0007`（codex 在
`_stream_with_retry` 插 152 行，正撞上游重写同函数）反而三方合并干净。
真冲突是 **`0017` / `frontends/cost_tracker.py`**：上游为 Desktop 2.0 的
`/token-history` 加了逐调用 ledger（`temp/token_ledger.jsonl`，10MB 压实），
重写的恰是 `record_patched` 里 0017 加守卫的那几行。

**合成两边**：保留上游全部 `_append_ledger` 调用 + `inp = cc = cr = 0`
初始化；Galley 的 messages-mode 守卫（只有带 usage 的调用计 `requests` /
写 `last_input`）叠在其后。关键事实是 **ledger 在 Galley 路径上构造性惰性**：
`_append_ledger` 在 `init_ledger` 未调用时零开销短路，而 `init_ledger`
只有上游 desktop bridge 调——Galley 的 `workbench_bridge` 只装内存
tracker。Rule 4 口径：即便激活，它写的也是 state root 下 `temp/`
的引擎内部运行态（2026-08-13 解释先例）。

另六个 patch（`0001`/`0002`/`0004`/`0007`/`0008`/`0016`）纯位置漂移。
`frontends/wechatapp.py` 的 Linux creationflags 修复与 `0020` 是近邻但
不同 spawn 点（`_start_conductor`，Galley 不达），0020 移除条件未满足。

## 打包门禁修了一处自家断言，不是上游问题

`check-bundled-python-managed-ga.sh` 从 2026-06-04 立门起就
`from frontends import desktop_bridge`——当时那是旧社区版 desktop app 的
bridge，顺手当 aiohttp 消费者代理来 import。上游 Desktop 2.0 重写后顶层
`from data_backup import ...` 是**脚本式兄弟导入**（只在 `frontends/`
自身进 sys.path 时可解析），包式 import 必炸。而 desktop_bridge 从来不在
Galley 执行路径上。修法：降级为 `find_spec` 存在性检查（与
wechatapp/fsapp 同款，不执行模块体），aiohttp 覆盖不丢（烟测本就单独
import 它）。教训：**烟测断言别执行不属于自己执行路径的上游模块**——那是把
门禁耦合到上游的导入风格上。

顺带一条验证纪律：这次门禁失败第一眼被 `cmd | tail` 吃掉了退出码
（管道退出码是 tail 的 0），靠输出里的 Traceback 才揪回来。跑门禁命令
不要尾接管道，或先 `set -o pipefail`。

## 验证

- 老栈 replay 与 checked-in payload 逐字节一致（改栈前提），rebase 后
  `build-managed-ga.sh` 19/19 clean + `py_compile` 全绿 +
  `check-managed-ga-payload.mjs` OK
- `check-ga-baseline-drift.mjs` OK（manifest / ga-baseline.md /
  patches/manifest.md / project-status 四面同步）
- 兼容矩阵：`GA_PATH=<新 checkout>` runner 235 passed
- 打包门禁：`bundle-python.sh mac-x64` 从零重建 + bundled smoke OK
- `hub.connect` 哨卫：仍只有 `--reflect` 与 `stapp.py`，Galley 不达
- 待 JC：dev 模式真跑一轮 dogfood（发版 draft smoke 时一并）

## 关联

- [ga-baseline.md](../ga-baseline.md) 当前基线块（含全量逐文件裁定）
- [patches/manifest.md](../../managed-ga/patches/manifest.md) 本轮 replay 头
- 上一段：[f06d550 -> 30b24ad](./2026-08-21-ga-upstream-upgrade-f06d550-to-30b24ad.md)
