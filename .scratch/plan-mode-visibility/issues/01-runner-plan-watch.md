# 01: Runner — plan 状态检测与 `plan_update` bridge 事件

Status: ready-for-human

## 目标

Bridge 在每个 turn_end 时只读地探测 GA 的 plan mode 状态，变化时向 core 发
`plan_update` 事件。

## 方案

- 新模块 `runner/plan_watch.py`（`PlanWatcher`）：
  - 懒加载 GA `frontends/plan_state.py`（bridge `_setup_ga` 已把
    `<ga_path>/frontends` 放进 sys.path）。ImportError（老版本外部 GA）→
    永久禁用，探测始终返回 None，功能静默关闭 —— 满足 PRD 的 attach
    降级要求（检测不到即不显示，不写任何 GA 状态）。
  - 只用 plan_state 公开 API：`is_active(agent)`（stash-only，即
    `working['in_plan_mode']`）、`resolve_path(agent)`、`extract`、
    `summary`、`is_complete`、`current_step`。全部只读。
  - `snapshot(agent, response_text)` 返回待发 payload 或 None：
    - active → 读 plan.md 出 items/done/total/complete；step 从本 turn
      responseContent 提取（`📌 当前步骤`），保留上次非空值；plan.md
      尚未落盘时 placeholder=true。
    - active→inactive 转换 → 发一次 `active: false` 收尾。
    - 连续相同 payload 去重。
- `runner/ipc.py` 加 `PlanUpdateEvent`（kind=`plan_update`），字段：
  `sessionId, active, placeholder, done, total, complete, step, pathHint,
  items[{content,status}], timestamp`。
- `workbench_bridge._on_turn_end` 末尾调用 watcher 并 emit（已在
  try/except 内，异常不拖垮 turn 流）。

## 耦合点（记录于 plan_watch.py docstring，GA baseline 升级时 re-audit）

- import GA `frontends/plan_state.py`（GA 自有的前端解析器，纯 stdlib）
- plan_state 内部读 agent/handler `working['in_plan_mode']` 与 plan.md
  文件 —— 只读

## 验证

- `runner/tests/test_plan_watch.py`：按 `test_managed_ga_code_run.py` 先例
  从 `managed-ga/code/frontends` 导入真实 plan_state，用 SimpleNamespace
  假 agent + tmp plan.md 覆盖：未激活不发、激活发 payload、checklist
  勾选进度、去重、退出发 active:false、import 失败静默禁用。
- `test_ipc.py` 补 PlanUpdateEvent round-trip。
- `.venv/bin/python -m pytest` / `mypy runner` / `ruff check runner`。
- 更新 `docs/ipc-protocol.md` §4.17。

## Comments
