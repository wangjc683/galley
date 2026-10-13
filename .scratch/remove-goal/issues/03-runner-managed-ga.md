# 03 runner + 内置运行时 + 截图种子：删 goal-status 提取与剥离、退补丁 0022

Status: done（2026-10-13，执行记录见 Comments）
Blocked by: 无

先读 [PRD](../PRD.md) 的「契约」一节（写死，本票必须照做）。本票只碰 `runner/`、`managed-ga/`、`scripts/seed-screenshots.py`。

## 工作位置（硬约束）

- **只在 worktree 里工作**：`/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/ab7a31ac-a0f8-4206-b6ee-0c4affeea868/scratchpad/wt-remove-goal`（下称 `$WT`）。
- **绝不碰主工作树** `/Users/inkstone/Documents/genericagent-webui`（JC 的 `tauri dev` 在用），只借用它的 venv
  解释器（见验证命令）。
- **绝不改** `~/Documents/GenericAgent`：那是用户自己的外置 GA（宪法 Rule 1），连 checkout 都不许切。
- 不 commit，不 push，不改别的票的域（`core/`、`cli/`、`gui/`、`remote-protocol/`、`ios/`、`docs/`、`README*`、
  `.scratch/` 除本票 Comments）。另外三张票与你同时在 `$WT` 里改各自目录，别碰它们的文件。

## 改什么、怎么改

### runner

1. `runner/ipc.py`：删 `TurnEndEvent.goalStatus`（:138–142）及注释（Core / GUI 两边由别的票删，三边要一致）。
2. `runner/workbench_bridge.py`：删 `_GOAL_STATUS_RE`、`_GOAL_STATUS_TAG_RE`、`_extract_goal_status`（:136–165 一带）
   与 turn_end 里填 `goalStatus` 的代码（:1543–1575 一带）；`_TAG_PATS` 列表（:100–110）去掉 `"goal-status"`；
   :722、:1430–1438 等把 Goal 当参照的注释改写成不提 Goal（行为不变）。
3. `runner/im_reporter.py`：删 `GOAL_STATUS_RE`（:69–71）及其使用（:1007，`NEXT_SUGGESTION_RE` 那层保留）；
   :587 注释「like the desktop's "stopped" Goal marker」改写。
4. 测试：`runner/tests/test_workbench_bridge.py`（26）、`runner/tests/test_ipc.py`（4） 里纯 goal-status 的用例删掉；
   若某条用例同时钉住别的行为（例如 `next-suggestion` 提取、final turn 的 turn_end 字段），保留并去掉 goal 部分。

### 内置运行时（补丁 0022）

按 `docs/managed-ga-runtime/code-state-and-patches.md`（「How To Add A Patch」「How To Modify An Existing Patch」两节，
删除照同一纪律：**不直接改 `managed-ga/code/`**）：

1. `git rm managed-ga/patches/0022-managed-strip-goal-status.patch`（在 `$WT` 里）。
2. 两本账同改：`managed-ga/manifest.json` 的 `patchStack.patches` 删掉这一项；`managed-ga/patches/manifest.md`
   删掉 0022 那一行，并在顶部「Last replay verified」处按现有格式记一笔 2026-10-13 的重放（26-patch stack，
   0022 退役，原因：Goal 移除，见 `.scratch/remove-goal/PRD.md`）。
3. 重建 payload：`scripts/build-managed-ga.sh <source>` 要一个**干净的**、停在 `managed-ga/manifest.json` 里
   `upstream.commit`（`f308ee7eb079cc402edf5a934fa65f6d71a4c7ad`）的 GenericAgent 检出。克隆到你自己的临时目录，
   例如 `git clone https://github.com/lsdefine/GenericAgent.git <tmp>/ga-src && git -C <tmp>/ga-src checkout f308ee7eb079cc402edf5a934fa65f6d71a4c7ad`，
   然后在 `$WT` 里跑 `scripts/build-managed-ga.sh <tmp>/ga-src`（用 `$WT` 里的脚本，它按自身位置写 `$WT/managed-ga/`）。
4. 核对：`git -C $WT diff --stat -- managed-ga/code managed-ga/state-seed` 应**只有**
   `managed-ga/code/frontends/chatapp_common.py` 与 `managed-ga/code/frontends/fsapp.py` 两个文件，内容正好是 0022
   两个 hunk 的反向（`TAG_PATS` / `_TAG_PATS` 回到上游原样、去掉两段注释）。多出任何别的文件变化都要停下来在回报里说明。
5. 0023–0028 不碰这两个文件，没有顺序依赖（已核实）。
6. **不动**：`managed-ga/code/reflect/goal_mode.py`、`managed-ga/code/frontends/slash_cmds.py` 的 `/goal`、
   `managed-ga/state-seed/memory/goal_mode_sop.md` 与 `goal_hive_*.md`、`managed-ga/code/hub.pyw`——都是上游代码与种子。

### 截图种子

`scripts/seed-screenshots.py`（34）：删掉播种 goals / goal 消息的部分（README 不再有 Goal 截图），其余场景不变。
它写的若是 `goals` 表或 `messages.goal_id`，直接不写即可（表和列仍在库里）。

## 验证命令（都在 `$WT` 下跑；venv 借主树的）

```bash
PY=/Users/inkstone/Documents/genericagent-webui/.venv/bin/python
$PY -c "import runner, os; print(runner.__file__)"      # 必须打印 $WT/runner/__init__.py；若指向主树，停下来回报
$PY -m pytest
$PY -m mypy runner
/Users/inkstone/Documents/genericagent-webui/.venv/bin/ruff check runner
$PY -m py_compile scripts/seed-screenshots.py
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-ipc-protocol-drift.mjs     # Core / GUI 票没落地前可能因它们而红，回报里说明
git diff --check -- runner managed-ga scripts/seed-screenshots.py
grep -rn -i "goal" runner scripts/seed-screenshots.py managed-ga/manifest.json managed-ga/patches
```

最后一条的剩余命中逐条说明理由（`managed-ga/code` 与 `state-seed` 里的上游 goal 内容不算，不用列）。

## 回报格式

1. 删除 / 改动的文件，每个一行摘要；
2. 删掉 / 改写的测试（名字，为什么）；
3. payload 重建：用的上游检出路径与 commit、`diff --stat` 原样输出、两处 hunk 的 diff；
4. 每条验证命令的结尾输出；
5. grep 剩余命中与理由；
6. 域外看到的问题（只报不改）。

## Comments

**2026-10-13 执行记录（票 03 代理）**：完成。runner 删 `TurnEndEvent.goalStatus`、`_extract_goal_status` 与两条正则、
`_TAG_PATS` 与 IM reporter 的 `goal-status` 剥离，把 Goal 当参照的注释改写（行为不变）。补丁 0022 退役、两本账同改：
先用干净克隆（`f308ee7e`）在隔离 build root 重放 27 补丁栈，与已提交 payload 逐文件一致（`diff -r`），再用 26 补丁栈
在 `$WT` 重建，payload 只变 `frontends/chatapp_common.py`、`frontends/fsapp.py`，正好是 0022 两个 hunk 的反向。
截图种子删 goals 行与 goal 消息；`sess_bookclub` 留作普通单轮会话（`projects.png` 的项目组构图不变），演示导览页去掉
`goal.png`，「加导览页」会话里的截图张数改为五张。测试删 4 条纯 goal 用例，
`test_turn_end_extracts_goal_status_only_on_the_final_turn` 改写为 next-suggestion 版（它是唯一钉住「只在最终轮提取」的用例）。

验证：pytest `550 passed, 6 deselected`；mypy `no issues found in 34 source files`；ruff `All checks passed!`；py_compile、
payload 与 baseline 门禁、`git diff --check` 均通过；IPC 漂移门禁仍红（`core/src/ipc.rs:211`、`gui/src/types/ipc.ts:191`
还有 `goalStatus`，待票 01 / 02 落地）。
