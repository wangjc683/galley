"""PlanWatcher behavior against the REAL GA plan_state module.

Follows the `test_managed_ga_code_run.py` precedent: pull the vendored
managed-ga frontends module straight from the repo so the test
exercises the actual coupling (plan_state's stash lookup + checklist
grammar), not a hand-rolled imitation. plan_state is pure stdlib, so
this stays hermetic.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from runner.plan_watch import PlanWatcher

_FRONTENDS = Path(__file__).resolve().parents[2] / "managed-ga" / "code" / "frontends"


@pytest.fixture()
def watcher(monkeypatch: pytest.MonkeyPatch) -> PlanWatcher:
    """PlanWatcher whose lazy `import plan_state` resolves to the
    vendored managed-ga module (the bridge gets the same effect from
    _setup_ga's sys.path insert of <ga_path>/frontends)."""
    monkeypatch.syspath_prepend(str(_FRONTENDS))
    # A previous test run may have cached the module under a different
    # resolution — drop it so syspath_prepend wins deterministically.
    monkeypatch.delitem(sys.modules, "plan_state", raising=False)
    return PlanWatcher()


def _agent(plan_path: str = "") -> Any:
    """Fake agent shaped like GA's: `working` dict on the handler,
    which is where `enter_plan_mode` stashes the plan path."""
    working = {"in_plan_mode": plan_path} if plan_path else {}
    return SimpleNamespace(handler=SimpleNamespace(working=working), working={})


def _write_plan(tmp_path: Path, body: str) -> Path:
    plan_dir = tmp_path / "plan_test"
    plan_dir.mkdir()
    plan_file = plan_dir / "plan.md"
    plan_file.write_text(body, encoding="utf-8")
    return plan_file


PLAN_BODY = """# Plan
1. [✓] 梳理现有恢复路径
2. [ ] 引入版本化快照结构
3. [ ] 迁移旧数据
"""


def test_inactive_agent_emits_nothing(watcher: PlanWatcher) -> None:
    assert watcher.snapshot(_agent()) is None
    # Still nothing on repeat — no phantom `active: false`.
    assert watcher.snapshot(_agent()) is None


def test_active_plan_reports_progress(
    watcher: PlanWatcher, tmp_path: Path
) -> None:
    plan_file = _write_plan(tmp_path, PLAN_BODY)
    payload = watcher.snapshot(_agent(str(plan_file)))
    assert payload is not None
    assert payload["active"] is True
    assert payload["placeholder"] is False
    assert (payload["done"], payload["total"]) == (1, 3)
    assert payload["complete"] is False
    assert payload["pathHint"] == "plan_test/plan.md"
    assert {i["status"] for i in payload["items"]} == {"open", "done"}


def test_step_extracted_from_response_and_carried(
    watcher: PlanWatcher, tmp_path: Path
) -> None:
    plan_file = _write_plan(tmp_path, PLAN_BODY)
    agent = _agent(str(plan_file))
    payload = watcher.snapshot(agent, "📌 当前步骤：引入版本化快照结构，先读旧代码")
    assert payload is not None
    assert payload["step"].startswith("引入版本化快照结构")
    # Next turn's response doesn't restate the step — last value carries.
    watcher.snapshot(agent, "继续执行中")  # may be None (deduped) — step unchanged
    plan_file.write_text(PLAN_BODY.replace("[ ] 引入", "[✓] 引入"), encoding="utf-8")
    progressed = watcher.snapshot(agent, "继续执行中")
    assert progressed is not None
    assert progressed["step"].startswith("引入版本化快照结构")
    assert (progressed["done"], progressed["total"]) == (2, 3)


def test_placeholder_before_plan_file_exists(watcher: PlanWatcher) -> None:
    payload = watcher.snapshot(_agent("./plan_new/plan.md"))
    assert payload is not None
    assert payload["active"] is True
    assert payload["placeholder"] is True
    assert payload["total"] == 0
    assert payload["pathHint"] == "plan_new/plan.md"


def test_consecutive_identical_snapshots_dedupe(
    watcher: PlanWatcher, tmp_path: Path
) -> None:
    plan_file = _write_plan(tmp_path, PLAN_BODY)
    agent = _agent(str(plan_file))
    assert watcher.snapshot(agent) is not None
    assert watcher.snapshot(agent) is None


def test_exit_emits_single_closing_event(
    watcher: PlanWatcher, tmp_path: Path
) -> None:
    plan_file = _write_plan(tmp_path, PLAN_BODY)
    agent = _agent(str(plan_file))
    assert watcher.snapshot(agent) is not None
    # GA auto-exits plan mode (checklist drained) → stash cleared.
    agent.handler.working.clear()
    closing = watcher.snapshot(agent)
    assert closing is not None
    assert closing["active"] is False
    assert closing["items"] == []
    # Only once.
    assert watcher.snapshot(agent) is None


def test_missing_plan_state_module_disables_silently(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Attach-mode degradation: an external GA without plan_state.py
    (pre-plan-mode checkout) must turn the feature off, not error."""
    monkeypatch.delitem(sys.modules, "plan_state", raising=False)
    monkeypatch.setattr(sys, "path", [str(tmp_path)])  # nowhere to import from
    w = PlanWatcher()
    plan_file = _write_plan(tmp_path, PLAN_BODY)
    assert w.snapshot(_agent(str(plan_file))) is None
    assert w.snapshot(_agent(str(plan_file))) is None
