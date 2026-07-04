# B3 prerequisites · 1 周日历仪式改成事件驱动 + 双层 gate

- **Date**: 2026-05-19
- **Status**: ✅ Playbook + cursor + devlog amended (this commit)
- **Related**:
  - [B3 playbook Prerequisites](../archive/refactor/B3-store-slice.md#prerequisites--必须先完成)（被改）
  - [B2 完成 devlog](./2026-05-19-b2-bridge-ownership-complete.md) — 自己说过 "the dogfood period is an empirical confidence-building step, not a gating contract"
  - [CLAUDE.md "事件驱动，非日历驱动"](../../CLAUDE.md) — GA Baseline Upgrade Workflow §触发时机 已 codified 的同一原则
  - [refactor/invariants.md §I7 性能 gate](../archive/refactor/invariants.md#i7-性能-gate)

## Context

B3 playbook 升格时（2026-05-19 早段）写了 4 条 prerequisites，关键一条是「B2 完成后 dogfood 1 周稳定期」，再加最后一句「未达 prerequisites 不允许启动 B3。每一条都要打勾才能开 T1.1」。

同一天 B2 ship 后 JC 想推进 B3，三个矛盾点浮出来：

1. **跟 B2 完成 devlog 自己的话冲突** — B2 devlog 明文写「the dogfood period is an empirical confidence-building step, not a gating contract」，playbook 把它升级成 gating contract 了
2. **跟 CLAUDE.md 项目宪法冲突** — GA Baseline Upgrade Workflow 早就走「事件驱动，非日历驱动」，B3 prereq 没理由不一致；single-dev project 的「1 周」不可 enforce（用得多 1 天够，用得少 1 个月不够）
3. **风险粒度跟 gate 粒度错配** — T1.1（静态分析 + 写 mapping doc，0 代码改动）跟 M2（开始改 frontend 代码）的 regression 风险差 100×，用同一个 gate 拦它们是设计错

JC 选了「改 playbook 再续 T1.1」（option 2），落 devlog 记录决策 provenance。

## Decisions

| # | Decision | Why this not that |
|---|---|---|
| 1 | **拆双层 gate**：M1 启动门（轻，paperwork 阶段进入）+ M2 启动门（重，开始改 frontend 代码前） | T1.1-T1.10 全是 design doc / ADR / emit event catalogue 输出，跟 B2 runtime 隔离，强 gate 拦它只拖延 design context 在 fresh 时落地。M2 起改 frontend 才是 B2 regression 风险窗口，strict gate 在那里才有意义 |
| 2 | **删「dogfood 1 周稳定期」时长 gate**，换成「scenarios 走过 + JC 签字未发现 B2 regression」事件驱动 gate | 「1 周」单 user 项目不可 enforce。换成 scenarios checklist + 签字 = 把验证活动具体化，符合 [CLAUDE.md GA baseline workflow §触发时机](../../CLAUDE.md) 已 codified 的同一原则 |
| 3 | **scenarios 列表前置到 M1 启动门**（之前是 prereq 第三条混在一起） | scenarios 列表是 B3 全程伴随的 reference doc：(a) 给 JC 当 B2 dogfood checklist 用 (b) 给 M2-M6 每次 milestone-end dogfood 用作 regression suite (c) 力 force JC explicit 想清楚 v0.1 七件事 + B2 新增 capability（CLI session send/watch / 内置 Python / origin tracking）哪些必须 cover。**T1.1 前先写**是顺位最合理 |
| 4 | **B2 perf baseline 推到 M2 gate**（不是 T1.1 gate） | M1 paperwork 不动 perf，基线测了也用不上。M2 起每个 slice 完都要对比基线 — 基线必须在 M2 前测好 |
| 5 | **playbook + cursor + devlog 同一 commit ship** | 规范本身可疑就改文档（[CLAUDE.md](../../CLAUDE.md)「规范本身可疑时直接指出」）。改 playbook 不写 devlog = 下次 session 看到 prereq 又会回头质疑；写了 devlog 才形成 decision provenance + 后续可索引 |

## Rejected alternatives

- **删全部 dogfood prereq 立即开 T1.1 → M7**：承认 single-user dogfood 没法 enforce 时长，但 scenarios checklist + perf baseline 是 B3 acceptance A6 / A9 真用得到的工具，不写就放弃可执行性
- **保留单层 gate 但「1 周」改「3 天」**：仍然是日历驱动，single-user enforce 不了，阈值降低没解决根本问题
- **T1.1 当作「prep work 不算正式 B3」绕过 gate**：自欺欺人。T1.1 输出的 slice mapping 一旦写下来就成为 M2-M6 设计锚点，「非正式」装腔
- **整体放弃 dogfood gate，只靠 typecheck/lint/cargo test 通过就允许 ship**：B2 dogfood 已经抓出 3 个 tests 抓不到的 bug（[`b087f22`](../devlog/2026-05-19-b2-bridge-ownership-complete.md): availableLLMs 序列化 / python alias 不翻译 / spawn error 不带 path），证明 tests + dogfood 不可替代

## Open questions

- **dogfood scenarios 列表覆盖度定义**：v0.1 七件事 + B2 新加（CLI session send/watch / 内置 Python / origin tracking）必 cover；其它 polished UX（dot rail / msg collapse / /btw / pet / Desktop Pet）算可选还是必选？预计列表 25-40 条
- **perf baseline 测法**：first-token RTT 用 `galley session send` + watch 第一个 turn_progress 时间戳？streaming throughput 用 100+ token 任务 events/sec？详 prototype baseline 文档对齐（[B2 devlog Open Questions §Performance gate](./2026-05-19-b2-bridge-ownership-complete.md#open-questions)）
- **M2 启动门触发后 M1 设计是否要 revise**：B3 N2+ running note 追踪

## Next

- **立即**：T1.1 进入 — 先 force 写 dogfood scenarios 列表（M1 启动门唯一未完成条款），然后开 T1.1 静态分析
- **M2 前**：JC 走一遍 scenarios + perf baseline 测好
- **B4 playbook stub** 等 B3 进 M5 时升格（跟 B2 → B3 同节奏）
