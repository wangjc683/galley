# 02: runner — `<goal-status>` 标签提取 / 剥离，TurnEndEvent.goalStatus

Status: done
PRD: ../PRD.md（§3.4、§3.8）
Blocked by: 无（与 01 并行；03 依赖本票）

## 范围

模板化票，照 `<next-suggestion>` 的现成路径复刻一遍。

- `runner/workbench_bridge.py`：
  - `_GOAL_STATUS_RE = re.compile(r"<goal-status>\s*(complete|blocked)\s*</goal-status>", re.I | re.DOTALL)`。
  - `_extract_goal_status(text) -> str | None`：只认 `complete` / `blocked`
    （小写归一），其他值返回 None 并 `logger.warning`。
  - `_TAG_PATS` 加 `goal-status`，展示文本剥离（含流式 `_clean_response_for_display`
    路径，确认流式部分标签也被剥）。
  - `TurnEndEvent` 发射处：`goal_status = _extract_goal_status(response_content)
    if exit_reason else None`（只在最终 turn 提取，同 next_suggestion）。
- `runner/ipc.py`：`TurnEndEvent.goalStatus: str | None = None`。
- `core/src/ipc.rs`：`TurnEndEvent.goal_status: Option<String>`，
  `#[serde(default, skip_serializing_if = "Option::is_none")]`，camelCase
  `goalStatus`。
- `gui/src/types/ipc.ts`：`TurnEndEvent.goalStatus?: "complete" | "blocked"`
  （GUI 不消费，仅类型对齐）。
- `managed-ga/code/frontends/chatapp_common.py` 的 `TAG_PATS` 加
  `goal-status`。这是 managed 代码：走 managed runtime 规则，新建补丁
  `0022-managed-strip-goal-status.patch`，`manifest.md` 登记，对照 0019 的
  做法。

## 验收

- `.venv/bin/python -m pytest` 过，新增测试：提取 complete / blocked /
  未知值 / 无标签 / 标签在中间；展示文本剥离；非最终 turn 不提取。
- `.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner` 过。
- `cargo test` 过：ipc.rs 反序列化含 / 不含 `goalStatus` 的 TurnEnd。
- 补丁 replay 脚本过（managed-ga README 的 replay 命令）。

## 注意

- 标签只在派发文本里被要求（03 的模板），runner 不需要知道 goal 是否存在，
  任何 session 的最终 turn 都提取，Core 决定是否理会。

## Comments

### 2026-09-16 — 实现完成

改动文件：

- `runner/workbench_bridge.py`：`_TAG_PATS` 加 `goal-status`（展示剥离走
  `_clean_response_for_display`，流式 delta 由 GUI 侧清洗，见下）；新增
  `_GOAL_STATUS_RE`（严格匹配 `complete|blocked`，`re.I | re.DOTALL`）与
  `_GOAL_STATUS_TAG_RE`（宽松孪生，只用于发现被忽略的标签）；
  `_extract_goal_status()`；`_on_turn_end` 里
  `goal_status = _extract_goal_status(response_content) if exit_reason else None`，
  随 `TurnEndEvent(goalStatus=...)` 发出。
- `runner/ipc.py`：`TurnEndEvent.goalStatus: str | None = None`（紧跟
  `nextSuggestion`）。
- `gui/src/types/ipc.ts`：`goalStatus?: "complete" | "blocked"`。
- `core/src/ipc.rs`：字段本身由 01 侧先落好；本票只在既有 tests 模块补了
  `parse_turn_end_goal_status_optional`（对照 `parse_turn_end_next_suggestion_optional`）。
- `managed-ga/code/frontends/chatapp_common.py` + 新补丁
  `managed-ga/patches/0022-managed-strip-goal-status.patch`，两个账本都登记
  （`manifest.json` patchStack、`patches/manifest.md` 表格行 + 抬头的
  「Last replay verified」段补了 0022 的验证说明，格式照 0021）。
- 测试：`runner/tests/test_workbench_bridge.py` 四个（识别值 / 未知值告警 /
  展示剥离 / 非最终 turn 不提取，最后一个直接跑 `bridge._on_turn_end`）、
  `runner/tests/test_ipc.py` 一个 round-trip。

补丁验证：本机 `~/Documents/GenericAgent` 停在 `1b6442fe`，与 manifest 钉的
基线 `efb3bc6` 不符，`scripts/build-managed-ga.sh` 会直接以 baseline mismatch
退出，所以按 0021 的先例验证：先把 payload 还原，再
`git apply --check --unidiff-zero --whitespace=nowarn --recount --directory=managed-ga/code`
（末位入栈，OK），随后真正 apply 并 `python3 -m py_compile` 该文件（OK），
清掉 `__pycache__`。

验证结果：`pytest` 245 passed / 6 deselected；`mypy runner` 无问题；
`ruff check runner` 通过；`cargo check -p galley-core` 通过（只有并行改动
留下的两条 dead_code warning）；`pnpm --dir gui typecheck` 通过；
`git diff --check` 干净；`rustfmt --check core/src/ipc.rs` 只报一处与本票
无关的既有差异（`parse_title_generated_event`），未动。

偏差与遗留：

1. `workbench_bridge.py` 没有 module logger，模块惯例是
   `print(..., file=sys.stderr)`，未知值告警照此办理（stdout 已被重定向到
   devnull，stderr 安全）。
2. 票面只给了严格正则，但「未知值要告警」需要先看见标签，因此加了宽松
   孪生正则 `_GOAL_STATUS_TAG_RE`，只服务告警分支。
3. **GUI 流式路径没剥 `goal-status`**：runner 把 delta 原样转发，清洗在
   `gui/src/lib/ipc/ga-output-cleaning.ts`（`next-suggestion` 出现在四处：
   块剥离数组、`GA_TAG_NAMES`、`cleanPreamble` 的 replace、尾部半截标签
   截断正则）。本票被限定「GUI 只改 ipc.ts」，故未动——但真机流式渲染会
   闪出 `<goal-status>complete</goal-status>`，建议另开一票或并入 03。
4. 同理未动的两处防御层：`runner/im_reporter.py` 的 `NEXT_SUGGESTION_RE`
   （IM 主动汇报文本）、`managed-ga/code/frontends/fsapp.py` 的 `_TAG_PATS`
   （0019 当年是 chatapp_common + fsapp 一起改的，本票只点名了
   chatapp_common）。
