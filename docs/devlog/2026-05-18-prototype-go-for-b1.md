# Bridge-owner prototype · 17/17 PASS · GO for B1

**Date**: 2026-05-18
**Status**: Prototype 阶段完成 · 进 B1
**Related**:
- [experiments/bridge-owner/README.md](../../desktop/src-tauri/experiments/bridge-owner/README.md) 完整 checklist + cursor + running notes
- [experiments/bridge-owner/results.md](../../desktop/src-tauri/experiments/bridge-owner/results.md) 完整数据 + 最终 go/no-go
- [docs/archive/refactor/README.md](../archive/refactor/README.md) phase dashboard 更新
- [docs/archive/refactor/B1-rust-core.md](../archive/refactor/B1-rust-core.md) next phase playbook
- [2026-05-15 vision pivot devlog](./2026-05-15-vision-pivot-to-orchestrator.md) §D13 — prototype spec 由来
- Commits: [8d4769c](../../) scaffold · [c22e6c1](../../) L5+C+S+X · [79e1f0a](../../) P1-P3+verdict · [8fb66ba](../../) 300s plateau

## Context

Vision pivot devlog 2026-05-15 拍板走路径 B（Galley Core 权威迁 Rust）。spec 当天落地，作为 B1 启动前的 go/no-go gate 提出了一个 2-3 天的 throwaway prototype，验证 Rust 持有 Python bridge subprocess 等价于现在 TS 持有的 latency / throughput / reliability。

我跟 JC 2026-05-18 在同一个 session 把 prototype 从「未启动」一气推完。本来 spec 估 2-3 天工作量，实际是单一连续 session 跑完所有 17 个 checklist 验证项。

## Decisions

### D1. 设计 call: 独立 tokio binary，不嵌 Tauri

Spec 在 Tauri app vs 独立 binary 之间自相矛盾：pseudo-code 用 `app.handle().emit()`（Tauri）；non-goals 说 "console.log in the existing app is fine"（隐含 in-process）；build config 是 separate `[[bin]]`（独立 binary）。

**我的判断**：独立 tokio binary。理由：

- 假说真正要验的是 **Rust 持有子进程 + tokio broadcast 给多订阅 + 干净生命周期**。Tauri emit 是成熟组件，验过几年了，加进来 1-2 天 yak shaving 不能验证假说本身。
- P1 latency 比较损失 ~5ms Tauri emit overhead，远低于 invariant I7 的 50ms 容差。
- 减少 prototype scope，把精力放在真正风险点：生命周期（L1-L5）、广播（S2-S4）、压力（X1-X2）。

JC 没 push back。记录在 results.md「Design choice」段。

### D2. Prototype 完整结果

**17/17 全 PASS**。分子节：

| 子节 | 数据点 |
|---|---|
| Lifecycle (L1-L5) | 单 spawn ready 430ms · 3并发 ready 341ms（比单 spawn 快，Python startup 共享 cache）· external `kill -9` 检测 3.48ms · drop+`kill_on_drop` <2s · panic+unwind 干净 |
| Stdin command (C1-C3) | set_llm round-trip 1.7ms · 3 ordered 1.1ms · 5 fire-drain 1.76ms |
| Stdout subscriber (S1-S4) | 100 events 4548/s · 双订阅内容一致 · subscriber disconnect 互不影响 |
| Stress (X1-X2) | 100 cmds 24.7ms · **10k events 4498/s sustained**（跟 S3 100-event 速率 identical，linear scaling） |
| Performance (P1-P3) | RTT p99 614µs · 4684 events/s · **300s 内存 +0.4 MB，t+111s 后 RSS plateau 3+ 分钟** |

最强的单一信号是 **P3 300s 平台**：3 个 bridge 跑 5 分钟、过 9003 events，前 111 秒慢慢 warm-up 加 ~400 KB（caches、thread pools、broadcast buffer），之后整整 3 分多钟 RSS 稳定在 3144-3156 KB 不动。**完全 steady-state，零 per-event leak**。spec 阈值 50 MB，实测 0.4 MB —— 125 倍 cushion。

### D3. P1-P3 用 Approach B（Rust 单边量化，TS 对比延后）

Spec 要求 P1/P2 跟 TS baseline 严格对比，容差 ≤50ms / ≤10%。但 TS baseline 测量需要 instrument `desktop/src/lib/bridge.ts` 或写 TS 端 harness，半天工作。

**我选 Approach B**：只量 Rust 单边绝对数，TS 严格对比推迟到 B1 dogfood（届时 TS 路径还活着可以 instrument，且 GUI 在 B1/B2 期间会保留 TS 路径作回退）。

理由：
- 架构上 Rust 路径**结构性比 TS 轻**：少了 tauri-plugin-shell 内部 channel；CLI subscriber 直通，GUI subscriber 也是 broadcast::Sender + Tauri emit 替换 tauri-plugin-shell wrapping，两者 in-process 操作开销近似。
- 主导成本是 Python event-loop tick + pipe syscall（C1-C3 数据显示约 340µs/RTT），**两种 ownership 模型下 identical**（同一个 bridge 子进程）。
- B1 dogfood 自然会暴露任何感知层 regression（输入延迟、UI 卡顿）；定量比较真要做，半天工程，可以塞在 B2 前。

完整说明在 results.md「P1-P3 strategy」段。

### D4. BridgeProcess 是 B1 runner_manager 模块的 source pattern

`experiments/bridge-owner/registry.rs` 145 行的 `BridgeProcess` 是 B1 第一份生产代码的 shape：

- `spawn(session_id, python, ga_path, bridge_cwd) -> BridgeProcess` — 启动子进程
- `subscribe() -> broadcast::Receiver<String>` — 拿订阅，每个 subscriber 独立
- `send_command(cmd: &str)` — 写 stdin
- `wait_exit() -> ExitStatus` — 等子进程退出（被外部 kill / 自然死）
- `shutdown(self)` — 发 `{kind:shutdown}` + wait + Drop fallback
- `pid() -> Option<u32>` — 给 ps / 监控用

**关键 load-bearing 实现细节**：spawn 内预订一个 `preload_rx: Option<broadcast::Receiver<String>>` 放进结构里。第一次 `subscribe()` 把它 take 出来。原因：broadcast::Receiver 只能收订阅之后发出的消息；reader task 启动后会立刻 push ready event，如果调用方先 spawn 再 subscribe，第一个 ready event 就丢了。preload_rx 是这个 race 的兜底，**B1 productionization 不能拿掉这个**。

B1 T1.1 第一步目录重组完成后，T2.x 早期就是把 BridgeProcess 搬到 `src-tauri/src/core/runner_manager/process.rs`（或最终结构定的位置），加 registry 容器（HashMap<sessionId, BridgeProcess>）+ 错误处理 polish。Skeleton 已经验过。

### D5. 新 invariant: Cargo `panic = "unwind"` 必须保留

L5 通过的前提是 Rust panic 走 unwind 路径，触发 Drop，Drop 触发 `kill_on_drop` SIGKILL bridge child。我们当前 Cargo.toml 没改默认（Cargo dev/release 默认 unwind），所以 L5 PASS。

但如果哪天有人为减小 binary size 加 `[profile.release] panic = "abort"`，主线程任何 panic 都不走 Drop，所有 alive bridges 全 orphan。L5 会 fail。

**已加进 [docs/archive/refactor/invariants.md](../archive/refactor/invariants.md) 作 I11**。B1 启动后第一个 commit 顺手补的话最稳。

### D6. B2 设计 TODO: 重做 graceful shutdown

L2 顺手发现的 surprise：`{kind:"shutdown"}` + `child.wait()` 每个 bridge 约 2.5s 才退。LRU 5 alive bridges 全关要 12-13s — 「关窗 app 立刻消失」UX 不可接受。

**B2 设计时要做的选项**（详 results.md surprises 段）：
- 选项 A：SIGTERM + 短 wait + SIGKILL fallback，跳 `{kind:shutdown}` 命令路径
- 选项 B：发 `{kind:shutdown}` 但 wait timeout 砍到 ~500ms 然后 SIGKILL
- 当前的 3s wait 太长

L4 已证 `kill_on_drop` 在 app teardown 路径工作干净，所以 SIGKILL 方向是安全的。

## Rejected alternatives

- **嵌 Tauri 跑 prototype**：spec 模糊处选了相反方向。理由见 D1。Tauri emit 是已知组件，验它不能给 B 路径带来更多信心；放在 B1 上下文里跑也来得及。
- **Approach C（完整 TS baseline 对比）**：半天工程量，跟 B1 dogfood 自然产生的 qualitative 信号比 marginal。如果 B1 期间感觉 perf regression 再补也来得及。
- **Approach A（presumed GO，跳过 P1-P3 量化）**：太弱。即使 TS 严格对比延后，我们也要有 Rust 单边的 latency/throughput/memory 数据落地存档，作为 B1 期间 perf gate 的 reference。
- **shorter P3（30s only）跳过 spec-compliant 300s**：30s 已经过阈值（0.2 MB << 50 MB），但 5min 测出 plateau 才是真正的 leak proof signal。前 2 分钟 warm-up 后 RSS 不动这一条数据，比 30s 的「+0.2 MB」更有说服力。值得花 5 分钟。
- **scenarios 合并成一个 `c` 或 `s`**：考虑过把 C1-C3 / S1-S4 合并成单一 scenario 跑全部 sub-test。最终独立 scenario 更好：cursor 追踪明确，跑失败时只重跑相关 sub-test，runtime 影响可忽略（每个 scenario 额外 spawn 一次 bridge ~400ms）。

## Open questions

- **P1/P2 严格 TS 对比要不要做？** Approach B 推迟到 B1 dogfood，但如果想保险，半天工程在 B2 之前。下次 session 决定。
- **B1 启动前要不要先做 v0.2 Windows release？** CLAUDE.md 阶段表上 Stage 4 (v0.2 Win release) 跟 Stage 5 (prototype) 并列「⏳ 未启动」。今天我跟 JC 商量过 sequencing，JC 选了「直接进 prototype」。但 v0.2 Win release 还在 ⏳ 状态。是 B1 同期并发推，还是先关掉 v0.2 再进 B1？JC 说「下个 session 开始正式 refactor」，倾向是直接进 B1，但 v0.2 Win 的 final smoke 还差 Y6（借 Win 机）+ NSIS .exe 出包 + release CI dry-run。
- **registry.rs `kill_on_drop` 是 sync syscall 还是 tokio runtime 依赖？** 看了 tokio docs，`Child::drop` with `kill_on_drop` 调 `imp::kill(self.id())` 是 sync syscall（`libc::kill`），不依赖 runtime alive。L5 panic 后 runtime drop 之前也能跑。但这个细节可能跟 tokio 版本相关，B1 productionization 时确认一下 tokio 1.x current major 行为。

## Next

- **本 session 收尾**：commit + push（4 commits 的 prototype 工作 + 本 devlog + CLAUDE.md Stage 5 ✅ + invariants.md I11）
- **下次 session 开始 B1 正式 refactor**：cursor 在 T1.1 目录重组。[B1-rust-core.md](../archive/refactor/B1-rust-core.md) playbook 已经写好。
- **B1 第一个 commit 顺手补的事**：把 `BridgeProcess` 从 `experiments/bridge-owner/registry.rs` 搬到生产路径（位置由 T1.1 定）；invariants.md I11 已落，但首个 commit 触及 Cargo profile 时确认没人改 `panic = "abort"`。
