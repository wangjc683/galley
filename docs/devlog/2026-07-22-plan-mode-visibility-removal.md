# 2026-07-22 - Plan Mode 可视化整链拆除：上线 24 小时即移除

## Date / Status / Related

- Date: 2026-07-22
- Status: implemented in current worktree, pending release-owner acceptance
- Related:
  - [Plan Mode 可视化（被拆除的特性）](./2026-07-21-plan-mode-visibility.md)
  - [GA upstream upgrade 5257dec -> 1d3c1a09](./2026-07-22-ga-upstream-upgrade-5257dec-to-1d3c1a09.md)
  - commits `449f10f` / `ae85b9d`（被移除的两个特性 commit）

## 背景与决策

昨天（07-21）上线的 plan mode 可视化链（`plan_watch.py` → `plan_update`
IPC → PlanContextBar + 📌 降级渲染），今天整链拆除。不是返工，是上游把前提
抽走了：`1d3c1a09` 正式弃用 plan mode（禁止进入、宣布删除、给出 ultraplan /
project_mode / 直接执行的替代路由）。昨天 devlog 留的观察项是"可视化上线后
第一个观察项是真实触发频率"——上游用弃用直接回答了：趋近于零。

昨天的决策（GUI 只观察、不做入口）意外成了最佳止损位：没有 Composer 控件、
没有 CLI 面、没有落库，拆除是纯减法。若当时选了被否方案 1/2（入口/开关），
今天拆的就是用户可见功能。

拆除同时卸掉三个上游耦合点的长期 re-audit 负担（`plan_state.py` API、
`working['in_plan_mode']` stash、`ga.py` 📌 注入格式）——昨天 devlog 要求
每次 baseline 升级 re-audit 这三处，现在清单归零：上游将来删除 plan 运行时
机器时，Galley 无需任何动作。

## 拆除范围

- 整文件：`runner/plan_watch.py`、`runner/tests/test_plan_watch.py`、
  `gui/.../PlanContextBar.tsx`、`gui/.../ga-output-cleaning.test.ts`
- 手术式：`runner/ipc.py` / `workbench_bridge.py` / `test_ipc.py`、
  `core/src/ipc.rs`（事件 variant + struct + 测试；`process.rs` 有
  `_ => {}` catch-all 无需动）、`gui` 侧 MainView / ipc-handlers /
  messages store / types / i18n 五键 / Conversation.tsx（planSteps 子行）/
  ga-output-cleaning.ts（`PLAN_STEP_SEGMENT` 四处）、
  `docs/ipc-protocol.md` §4.17
- 契约面：`plan_update` 从未进 CLI/socket 公开契约，`schemaVersion: 1` 不受
  影响，事件删除是内部 IPC 的自由

## 📌 剥离守卫全删的取舍（JC 拍板）

`ga.py` 的 📌 注入机器上游尚未删，且存量用户 managed 状态里的旧版
`plan_sop.md` 不会被种子更新覆盖（missing-only 拷贝，用户状态不可覆盖是
铁律）。因此存在一个已知接受的残余风险：**存量状态若残余触发一次 plan
mode，📌 当前步骤会以加粗正文渲染**（07-21 issue 04 的原始形态，纯外观、
概率极低且随上游横幅的 L1 索引自愈机制递减）。

选择全删而非保留 ~20 行剥离守卫：守卫剥的字符串在新种子用户处永不出现，
上游删机器后它是无人记得的永久死代码——为近零概率的外观尾巴供养一段需要
解释的代码，不值。存量状态的自救路径：用户自行删除 managed 状态里的
`memory/plan_sop.md`（用户状态，仅用户本人操作）。

## 留下的东西

- 两篇历史 devlog（07-21 可视化、本篇）不动——决策过程本身有档案价值：
  完整走过"讨论 → 建成 → dogfood 发现问题 → 上游变化 → 拆除"的一周期。
- `ga-baseline.md` 的 plan mode 弃用条目是当前基线事实的一部分，随下次
  升级正常滚动。
