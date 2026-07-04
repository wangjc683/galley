# Galley Core Refactor · 执行手册

> **ARCHIVED 2026-07-04** — B1–B4 全部完成，v0.2.0 已于 2026-05-31 发布。
> 本目录仅作历史溯源，不再是任何 session 的必读项。仍然有效的硬规则
> （I3 / I5 / I6 / I9 / I11）已迁至
> [engineering workflow](../../engineering-workflow.md)。

跨多 session 重构的中央调度器。**新开 session 第一件事：读本文件 → 找到当前 cursor → 进入对应 phase playbook → 读 cursor 指向的 sub-task**。

## 跟其它文档的分工

| 文档 | 角色 | 节奏 | 新 session 是否要读 |
|---|---|---|---|
| [`/AGENTS.md`](../../../AGENTS.md) | 项目宪法（全局边界） | 每个 session | 是 |
| [`docs/PRD.md`](../../PRD.md) | 产品定义（要做什么） | 大版本 | 是（首次） |
| [`docs/DESIGN.md`](../../DESIGN.md) | 设计系统（UI 长啥样） | 设计决策时 | 否（只在 UI session 时） |
| [`docs/devlog/`](../../devlog/) | 决策叙事（为什么这么走） | 决策 / session 结束 | **新 session 必读最近 1-2 篇** |
| **`docs/refactor/`（本目录）** | **执行手册（现在做哪一步）** | **每个 sub-task 完成时更新** | **新 session 必读本 README + 当前 phase playbook** |

简言之：**AGENTS.md 是不可违反的边界，PRD 是 what 和 why，refactor/ 是 how 和 now**。

## 目录结构

```
docs/refactor/
├── README.md                    本文件 · 总览 + cursor
├── invariants.md                跨 phase 硬规则
├── prototype-bridge-owner.md    -> 实际 spec 在 experiments/bridge-owner/README.md，本目录只放跳转
├── B1-rust-core.md              ✍️ 详细 playbook（30+ sub-tasks）
├── B2-bridge-ownership.md       stub · 接近时再细化
├── B3-store-slice.md            stub
└── B4-cli-bg-artifact.md        stub
```

## 当前 cursor

```
Phase:    Prototype ✅ → B1 ✅ → B2 ✅ → B3 ✅ → B4 ✅ → v0.2.0 ✅
                                                               ↑ 现在在这里
Status:   v0.2.0 shipped 2026-05-31 as the first stable Galley release.
          GitHub Release is public / non-prerelease / Latest, and the beta
          update channel points at 0.2.0 for installed users.
Next:     Post-release feedback watch. Use v0.2.1 for focused P0 / P1
          hotfixes; plan broader feature work only after real feedback.
Blocker:  None for v0.2.0. Future release gates still follow
          docs/release-update-sop.md.
```

**Cursor 更新协议**：每个 sub-task 完成 → 当前 phase playbook 顶部的 cursor 行更新 → 本文件总 cursor 表跟着更新（只 phase 级别）。**不要批量更新**——每 task 一更，防止 session 中断后丢状态。

## Progress dashboard

| Phase | 状态 | Cursor | 详细 playbook | Last touch |
|---|---|---|---|---|
| Prototype: Rust-owned subprocess | ✅ COMPLETE · 17/17 · GO | — | [bridge-owner/README.md](../../../core/experiments/bridge-owner/README.md) | 2026-05-18 session 1: all 5 subsections in one sprint |
| B1: Rust core 骨架 + CLI 只读 | ✅ COMPLETE · M1-M7 · 11/12 A acceptance | — | [B1-rust-core.md](./B1-rust-core.md) · [devlog](../../devlog/2026-05-18-b1-rust-core-complete.md) | 2026-05-18 single session — 21× faster than 3-week estimate |
| B2: Bridge ownership 迁 Rust | ✅ COMPLETE · M1-M7 · 83 tests pass · tag `b2-complete` | — | [B2-bridge-ownership.md](./B2-bridge-ownership.md) · [devlog](../../devlog/2026-05-19-b2-bridge-ownership-complete.md) | 2026-05-19 single session — full pipeline + docs + tag. Dogfood validation moved to B3 M2 启动门 ([prereq relaxation devlog](../../devlog/2026-05-19-b3-prereq-relaxation.md)) |
| B3: useAppStore 拆 slice + 改订阅 | ✅ COMPLETE · M1-M6 · A1-A11 全 tick · tag `b3-complete` | — | [B3-store-slice.md](./B3-store-slice.md) · [B3 完成 devlog](../../devlog/2026-05-20-b3-store-slice-complete.md) · M1 [devlog](../../devlog/2026-05-19-b3-m1-design-complete.md) · M3 [devlog](../../devlog/2026-05-19-b3-m3-complete.md) · M4 [devlog](../../devlog/2026-05-19-b3-m4-complete.md) · M5 [devlog](../../devlog/2026-05-19-b3-m5-complete.md) · 3 M1 design artifact [mapping](./b3-slice-mapping.md)/[ADR](./b3-slice-adr.md)/[emit catalogue](./b3-rust-emit-catalogue.md) · [M3 sub-plan](./B3-M3-sub-plan.md) · [M4 sub-plan](./B3-M4-sub-plan.md) · [M5 sub-plan](./B3-M5-sub-plan.md) · [M6 sub-plan](./B3-M6-sub-plan.md) | 2026-05-20 sixth session: M6 sub-plan + impl + M7 acceptance + devlog + tag 全 ship。B3 整体跨 6 session、2 day calendar (estimate 3-4 weeks)，21× faster. JC dev dogfood 2026-05-20 initial pass。最终 6 文件 + 1 lib orchestrator. useAppStore.ts 整文件删除. tag `b3-complete`. |
| B4: CLI feature-complete + background + artifact | ✅ Shipped with v0.2.0 | Post-release feedback / hotfix only | [B4-cli-bg-artifact.md](./B4-cli-bg-artifact.md) · [B4 M1 sub-plan](./B4-M1-sub-plan.md) · [B4 M8 sub-plan](./B4-M8-sub-plan.md) · [B4 M9 sub-plan](./B4-M9-sub-plan.md) | v0.2.0 shipped 2026-05-31. `schemaVersion: 1` frozen; release workflow produced macOS arm64, macOS x64, and Windows x64 artifacts; update channel promoted after publish. |
| **v0.2 milestone** | ✅ Shipped | Monitor feedback; v0.2.1 only for focused hotfixes | [v0.2.0 release devlog](../../devlog/2026-05-31-v020-stable-release.md) | First stable release published as GitHub Latest and promoted to the beta update channel. |

预计总时长：**10-12 周**（不含 v0.2 Windows release）。

## 新 session 启动 checklist

每次开新 session 先按这个走：

1. **读 [`/AGENTS.md`](../../../AGENTS.md)**，确认全局边界和必须遵守的项目规则
2. **读 [`project-status`](../../project-status.md)**，确认当前版本、release 状态和 compact phase state
3. **读本文件 progress dashboard**，看 cursor 指向哪个 phase
4. **打开对应 phase playbook**，读它顶部的 cursor 字段——这是真正的"下一步"
5. **读该 phase 的 running notes**（playbook 底部）——看前几个 session 踩过什么坑
6. **读 [invariants.md](./invariants.md)**——确认本次操作不违反任何硬规则
7. **读最近 1-2 篇 [devlog](../../devlog/)**——补叙事上下文

加起来 10 分钟内能上手。

## Session 结束 checklist

工作告一段落时：

1. **更新当前 phase playbook 的 cursor**（指向"下一个未完成 sub-task"）
2. **勾掉本次完成的 sub-task checkbox**
3. **在 phase playbook 底部 running notes 追加一条**（发现的 gotcha / 临时决策 / 半截工作的状态）
4. **如果 phase 完成 → 写 devlog + 切换本文件 dashboard 的状态 + cursor 指针**
5. **commit 时 message 提一句 "refactor: B1 T2.3 — implemented list_sessions read"**——便于 git log 追溯

## 一般维护规则

- **追加，不重写**：playbook 的 sub-tasks 表是历史档案，完成不删除（变成 `- [x]`）；running notes 永远 append-only
- **决策变了 → 写 devlog**：playbook 内做不到的 task 不要悄悄改设计，先 devlog 记录"为什么改"，然后改 playbook + 在 running notes 引用 devlog
- **stub phase 文档不要提前细化**：B2/B3/B4 stub 只有 acceptance + milestone 大纲，sub-task 等到该 phase 启动前一个 dedicated session 再展开。**早期细化 = 浪费**（B1 实施会改变后续设计假设）
