# Galley refactor · 性能基线

> **用途**：[invariants.md §I7](./invariants.md#i7-性能-gate) 性能 gate 的承载文档。每个 B 阶段完成 (B1 / B2 / B3) 重测，跟前一阶段对比。
>
> **gate 规则**：
>
> - P1 (first-token RTT)：≤ 前一阶段 + 50ms
> - P2 (streaming throughput)：≥ 前一阶段 × 0.9（即下降 ≤ 10%）
> - P3-P5 (proxy metrics)：sanity continuity check，无硬阈值但需 explain regression
>
> **违反 = 撤回该 phase 最后一个 commit 重设计**（per I7）。
>
> **append-only**：不删旧测量；新测量追加在对应阶段 section，互相可 diff。

---

## 测量环境基线

测量数据的 machine 一致性。**跨机器对比不严格有效**（M-series 跟 Intel 差量级），但同 JC daily-driver 机器跨阶段对比是 invariant gate 的契约形式。

| 字段 | 值 |
|---|---|
| Machine | JC's daily driver (Apple Silicon, macOS 24.6.0) |
| Galley binary | debug build (`core/target/debug/galley`) |
| GA baseline | `b063518` (CLAUDE.md 当前锁定) |
| Python | bundled CPython 3.11.15 (v0.1.1+) |
| Tauri | v2 |
| SQLite DB | `~/Library/Application Support/app.galley/workbench.db` |

**Release vs debug**：所有数据均 debug binary 测量。Release binary（启动开销 ~5× 快、运行时差异微）跨阶段对比受相同影响，不影响 gate 判定。如要 release-level 数据，单独跑一次 + 在新 column 标注 `release`。

---

## P1 · First-token RTT (LLM-driven · JC 手动测)

**定义**：CLI invoke `galley session send <id> "<short prompt>"` 到第一个 `turn_progress` 事件 reaches `galley session watch` subscriber 的 wall-clock 时间。

**测量 SOP**：

```bash
# 1. 起 Galley GUI（让 RunnerManager + socket 在 listen）
open /Applications/Galley.app  # 或 pnpm tauri dev

# 2. 准备一个 active session（一个已 attached 的 session id）
SID=$(./core/target/debug/galley sessions list | head -1 | jq -r .id)

# 3. 终端 A：起 watch 并打第一个 turn_progress 时间戳
./core/target/debug/galley session watch "$SID" 2>&1 | \
  python3 -c "
import sys, json, time
t_first = None
for line in sys.stdin:
    try:
        evt = json.loads(line)
        if t_first is None and evt.get('kind') == 'turn_progress':
            t_first = time.perf_counter()
            print(f'first turn_progress at {t_first}', flush=True)
            break
    except Exception:
        pass
"

# 4. 终端 B：记 send 时间戳并发送
python3 -c "
import subprocess, time
t0 = time.perf_counter()
subprocess.run(['./core/target/debug/galley', 'session', 'send', '$SID',
                'hi, count to 3', '--supervisor=jc', '--reason=perf-p1'],
               capture_output=True)
print(f'send at {t0}', flush=True)
"

# 5. 用两个时间戳算差 = P1。重复 5 次（不同 prompt 避免 cache 干扰），取 p50 / p95
```

**简化版**：可写一个单 python 脚本 fork 两个 subprocess 同时跑 send + watch 互相协调，省去手动 stopwatch 对齐。如果做了，把脚本 commit 到 `scripts/perf-p1.py`。

**为什么不自动化测**：(a) 需要真 GA + 真 LLM API key（消耗 token 配额）；(b) 第一次 LLM 调用受 anthropic 服务端冷启动影响 wall-clock 抖动大，需要 JC 在稳定网络环境下手测才 reproducible。

### Measurements

| Date | Phase | prompt | P1 RTT | Notes |
|---|---|---|---|---|
| 2026-05-19 | **B2 baseline** | short (`回答一个字：今天星期几？`, 12 chars) | **3150 ms** | single sample · session `s-mpc6h020-iy71` · GA streams short answer as 1 chunk ≈ at `turn_start` time |
| 2026-05-19 | **B2 baseline** | long (`500 字咖啡随笔`, 34 chars) | **5363 ms** | single sample · GA emits real content deltas **before** `turn_start` (turn_start arrives at +15.2s = end of streaming, treats as metadata commit) |
| TBD | B3 完成 | short | — | gate: ≤ 3200 ms (= B2 + 50ms) |
| TBD | B3 完成 | long | — | gate: ≤ 5413 ms (= B2 + 50ms) |

**P1 marker 注脚 (2026-05-19 measurement learning)**：

- **Definition refined**: P1 = first `turn_progress` with delta **not containing** `LLM Running` placeholder. **NOT** `turn_start` time.
- **Reason**: GA bridge emits `turn_start` as metadata-commit event. For short prompts (1 LLM call, < 1s response) turn_start ≈ first_real_delta. For long prompts turn_start fires **at end of streaming** (after `run_complete`-like flow). Using turn_start would under-report (long: 15s vs real 5s) or over-report depending on case.
- **Script fix** (commit-time): `scripts/perf-galley.py` `p1_marker = t_first_real_delta or t_turn_start` (fallback chain ordered correctly).

**Wire-format observation**: Each `send` triggers 1 `turn_progress` with `delta="LLM Running (Turn N)..."` placeholder within ~16ms (bridge ACK), then real content deltas arrive after LLM latency (~3-5s typical). The placeholder is GA-internal and stripped by GUI's `ipc-handlers.ts` strip rule.

---

## P2 · Streaming throughput (LLM-driven · JC 手动测)

**定义**：长答案（300+ token）streaming 期间，`galley session watch` 收到的 `turn_progress` events / 秒。

**测量 SOP**：

```bash
# 同 P1 setup，但用长 prompt:
PROMPT="请写一段 500 字关于咖啡历史的随笔，至少 5 段，每段独立成节。"

./core/target/debug/galley session watch "$SID" 2>&1 | \
  python3 -c "
import sys, json, time
t_first = None
t_last = None
n_progress = 0
for line in sys.stdin:
    try:
        evt = json.loads(line)
        if evt.get('kind') == 'turn_progress':
            now = time.perf_counter()
            if t_first is None: t_first = now
            t_last = now
            n_progress += 1
        if evt.get('kind') == 'turn_end':
            duration = t_last - t_first
            print(f'{n_progress} progress events / {duration:.2f}s = {n_progress/duration:.1f} ev/s')
            break
    except Exception:
        pass
"

# 另一终端 send 长 prompt
./core/target/debug/galley session send "$SID" "$PROMPT" --supervisor=jc --reason=perf-p2
```

**Prototype baseline (reference, not B2)**：4498-4684 events/sec（S3 / X2 / P2，无 GA 真任务，artificial event 100-event burst）。**实测真 GA streaming 通常远低** —— LLM 50-100 token/s × 1-2 event/token = ~50-200 events/s，跟 Rust subprocess 路径上限差 30-100×。**这意味着**：P2 测量主要捕捉 React 端订阅 / 渲染对感知 throughput 的影响（B3 风险面），不测试 Rust 上限。

### Measurements

| Date | Phase | events/sec | n_content_deltas | duration | notes |
|---|---|---|---|---|---|
| 2026-05-19 | **B2 baseline** | **1.42 ev/s** | 14 | 9.86 s | session `s-mpc6h020-iy71` · long prompt 500-字 essay · GA chunks LLM stream into ~700ms chunks (each ~35 words) — **not** token-by-token streaming. **Implication**: B3 React-side re-render cost is dominated by chunk size, not throughput; 1.42 ev/s is easy to handle |
| TBD | B3 完成 | — | — | — | gate: ≥ 1.28 ev/s (= B2 × 0.9) |

---

## P3 · CLI read-command RTT (proxy · 已自动测)

**定义**：CLI 通过 SQLite read path 跑常见命令的端到端 wall-clock。捕捉 process startup + sqlx connection + serde JSON output 开销。

**为什么是 proxy**：B3 不改 Rust read path，本指标跨 B2/B3 应当**保持不变**（±5% 噪音容忍）。如果 B3 完成时 CLI RTT 变了 = Rust 端被无意 dirty，回查。

**测量脚本** (`/tmp/galley_bench.sh`)：

```bash
GALLEY=./core/target/debug/galley
SAMPLES=20
for cmd in "version" "status" "sessions list" "health"; do
  python3 -c "
import subprocess, time, statistics
cmd = '$GALLEY $cmd'.split()
samples = []
for _ in range($SAMPLES):
    t0 = time.perf_counter()
    subprocess.run(cmd, capture_output=True)
    samples.append((time.perf_counter() - t0) * 1000)
samples.sort()
n = len(samples)
print(f'$cmd  N=$SAMPLES  min={samples[0]:.1f}  p50={samples[n//2]:.1f}  p95={samples[int(n*0.95)]:.1f}  mean={statistics.mean(samples):.1f}ms')
"
done
```

### Measurements

| Date | Phase | version | status | sessions list | health |
|---|---|---|---|---|---|
| 2026-05-19 | **B2 baseline** | min 11.6 / p50 12.4 / p95 19.8 / mean 13.0 ms | min 13.5 / p50 14.2 / p95 14.7 / mean 14.2 ms | min 14.2 / p50 14.8 / p95 15.7 / mean 14.9 ms | min 14.3 / p50 14.8 / p95 15.9 / mean 14.9 ms |
| TBD | B3 完成 | — | — | — | — |

**Notes (2026-05-19)**：debug binary。`version` 不打 DB（最低延迟 ~12ms = pure process startup + JSON output）。其它三个打 DB，~14ms = 12ms 启动 + ~2ms sqlx + serde。p50 极稳（std < 1ms），p95 偶有 ~6ms tail（可能 mDNSResponder / 其它系统抖动）。

---

## P4 · Bridge spawn → ready latency (proxy · prototype-cited)

**定义**：从 RunnerManager spawn `workbench_bridge.py` 子进程到收到第一个 `kind=ready` event 的 wall-clock。冷启动（首次 Python import GA）/ 热启动（已 import 过的 venv）差异显著。

**Prototype baseline (2026-05-18, JC machine, GA `fc6b5ad`)**：

| 场景 | latency |
|---|---|
| 单 bridge 冷启动 | **430.86 ms** |
| 3 bridges 并发冷启动 | **340.98 ms** (per ready, 共享 Python page cache) |

Rust subprocess 路径在 B2 跟 prototype 是 **same machinery**（`BridgeProcess` 升级成 `RunnerManager` 的核心 spawn / broadcast 不变 —— [B2 完成 devlog](../../devlog/2026-05-19-b2-bridge-ownership-complete.md) §M1 明示）。**因此 B2 baseline = prototype baseline**，不需要新跑除非有理由怀疑 regression。

**B3 sanity check**：B3 完全不动 Rust subprocess 代码（[B3-I4](./B3-store-slice.md#phase-invariants--b3-特有的硬规则)）。spawn latency 不该变。如 dogfood 撞到「新对话首次响应明显变慢」 = 回查（很可能是 React 渲染 blocking spawn 等待，跟 Rust 无关）。

**测量 SOP**（B3 完成时 / 怀疑 regression 时）：

```bash
# 用 prototype experiment binary (从 prototype session 留存)
cd core && cargo run --features experiments --bin bridge-owner-experiment -- l1
# 输出 ready latency in ms

# 或在 B3 完成时写一个 minimal RunnerManager 集成测试
# (在 core/tests/spawn_perf.rs 加 spawn → wait_for_ready 计时)
```

### Measurements

| Date | Phase | single cold | 3-concurrent | notes |
|---|---|---|---|---|
| 2026-05-18 | Prototype | 430.86 ms | 340.98 ms (per) | GA `fc6b5ad` |
| (cited) | B2 baseline | 430.86 ms | 340.98 ms (per) | same machinery, not re-measured |
| TBD | B3 完成 | — | — | gate: ≤ B2 + 50ms (i.e. ≤ 480ms cold) |

---

## P5 · Memory RSS plateau (proxy · long-run dogfood-driven)

**定义**：3 bridges alive、9000+ events 跑过后 RSS 是否 plateau（无内存泄漏）。

**Prototype baseline (2026-05-18)**：3 bridges × 300s × 9003 events → RSS **+0.4 MB total** plateau at t+111s。

**测量 SOP**（dogfood 期间被动收集）：

```bash
# Galley GUI 跑着，3 active session，dogfood 1 小时后:
ps -o pid,rss,command -p $(pgrep -f "Galley.app/Contents/MacOS/desktop")
# 关注 RSS（KB）是否在合理范围（基线 ~150-250 MB GUI + ~50 MB per bridge）

# 长跑期间监控:
while true; do
  date +%H:%M:%S
  ps -o rss,command -p $(pgrep -f "Galley.app|workbench_bridge") | awk '{print $1/1024"MB", $2}'
  sleep 60
done | tee /tmp/galley-rss.log
```

### Measurements

| Date | Phase | bridges | duration | RSS delta | notes |
|---|---|---|---|---|---|
| 2026-05-18 | Prototype | 3 | 300s | +0.4 MB | standalone tokio, no React, no GA real task |
| TBD | B2 baseline | — | — | — | JC dogfood 抓 |
| TBD | B3 完成 | — | — | — | gate: ≤ +50 MB (per [I7](./invariants.md#i7-性能-gate) 「<50 MB beyond baseline」) |

---

## B2 → B3 gate 总结

M3 启动前需达成：

- [x] P3 (CLI read RTT) — 2026-05-19 measured
- [x] P4 (bridge spawn) — prototype cited, B3-I4 ensures Rust path unchanged
- [x] **P1 (first-token RTT)** — **2026-05-19 measured** via `scripts/perf-galley.py`: short=3150ms / long=5363ms
- [x] **P2 (streaming throughput)** — **2026-05-19 measured**: 1.42 ev/s (long prompt, 14 deltas / 9.86s)
- [ ] P5 (RSS plateau) — dogfood 期间 passive 收集即可，不阻塞 M3

**M3 启动判据**：P1 + P2 各跑一次有数 ✅。理由：M3 启动门是「baseline 测好」不是「baseline 完善」；多次取统计是 B3 完成时的 gate 工作。

剩 dogfood scenarios 35 项 JC 跑过签字 = M3 启动门最后一条。

---

## Update log

- **2026-05-19** — created。P3 measured。P1/P2/P5 SOP only，留 JC dogfood 时填。P4 cited prototype baseline（rust subprocess 路径 B2 未改动）
- **2026-05-19 (later)** — P1 + P2 measured live via `scripts/perf-galley.py` against `s-mpc6h020-iy71`. P1 marker definition refined (first_real_delta, not turn_start) after observing GA bridge emits turn_start as metadata commit at END of streaming for long prompts. Script bug found-and-fixed: readline() was blocking inner-loop, deadlock'd P1 measurement; replaced with `select.select()` timeout-based read
