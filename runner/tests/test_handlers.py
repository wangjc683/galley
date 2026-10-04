"""Unit tests for WorkbenchHandler.

These tests exercise the dispatch wrapper without running real LLM calls.
A FakeHandler subclass provides minimal `do_<tool>` methods so we can
drive `super().dispatch()` through controlled paths.

Requires GA on sys.path (see conftest.py).
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

# Importing handlers requires GA on sys.path (conftest handles that).
# Import inside fixtures/tests would also work; module-level is fine since
# conftest runs before test collection.
from runner.handlers import (
    _BASE_DISPATCH_SUPPORTS_TOOL_NUM,
    WorkbenchHandler,
)


def _drain(gen: Any) -> tuple[list[Any], Any]:
    """Run a generator to completion. Returns (yielded_values, return_value)."""
    yielded = []
    try:
        while True:
            yielded.append(next(gen))
    except StopIteration as e:
        return yielded, e.value


class _FakeHandler(WorkbenchHandler):
    """Provides fake do_<tool> methods so super().dispatch() has something to call."""

    def do_test_tool(self, args: dict[str, Any], response: Any) -> Any:
        from agent_loop import StepOutcome
        yield "test tool ran\n"
        return StepOutcome({"status": "success", "data": dict(args)}, next_prompt="\n")

    def do_code_run(self, args: dict[str, Any], response: Any) -> Any:
        from agent_loop import StepOutcome
        yield "code_run ran\n"
        return StepOutcome({"status": "success", "data": dict(args)}, next_prompt="\n")


@pytest.fixture
def fake_parent() -> MagicMock:
    return MagicMock(verbose=False, task_dir=None)


def _make_handler(fake_parent: MagicMock, **kwargs: Any) -> _FakeHandler:
    return _FakeHandler(
        parent=fake_parent,
        last_history=[],
        cwd="/tmp/ga_test",
        **kwargs,
    )


# ---------------- Pass-through ----------------


def test_tool_passes_through(fake_parent: MagicMock) -> None:
    h = _make_handler(fake_parent)
    yielded, ret = _drain(h.dispatch("test_tool", {"a": 1}, response=MagicMock()))
    assert any("test tool ran" in y for y in yielded)
    assert ret.data["status"] == "success"


def test_code_run_dispatches_directly(fake_parent: MagicMock) -> None:
    """Every tool call goes straight to GA's dispatch, including the ones
    Galley used to hold for a decision (code_run, file_write, ...)."""
    h = _make_handler(fake_parent)
    yielded, ret = _drain(h.dispatch("code_run", {"type": "python"}, response=MagicMock()))
    assert any("code_run ran" in y for y in yielded)
    assert ret.data["status"] == "success"
    assert ret.data["data"]["type"] == "python"
    assert ret.next_prompt == "\n"


def test_tool_num_forwarded_when_supported(fake_parent: MagicMock) -> None:
    """GA ≥ 3205f4a takes `tool_num` and stamps it into the tool args;
    the wrapper must forward it instead of dropping it."""
    if not _BASE_DISPATCH_SUPPORTS_TOOL_NUM:
        pytest.skip("loaded GA BaseHandler.dispatch has no tool_num parameter")
    h = _make_handler(fake_parent)
    _, ret = _drain(
        h.dispatch("test_tool", {"a": 1}, response=MagicMock(), index=1, tool_num=3)
    )
    assert ret.data["data"]["_tool_num"] == 3
    assert ret.data["data"]["_index"] == 1


# ---------------- Turn signal ----------------


def test_turn_started_callback_fires_for_loaded_ga_dispatch(fake_parent: MagicMock) -> None:
    """Galley must keep live step progress across GA dispatch internals.

    Older GA calls WorkbenchHandler.tool_before_callback from
    BaseHandler.dispatch. Newer GA switched BaseHandler.dispatch to
    plugins.hooks, so WorkbenchHandler emits this signal itself when
    feature detection says the base dispatch will not.
    """
    seen: list[int] = []
    h = _make_handler(fake_parent, turn_started_callback=seen.append)
    h.current_turn = 3
    _drain(h.dispatch("test_tool", {"a": 1}, response=MagicMock()))
    assert seen == [3]


def test_turn_started_callback_error_does_not_break_dispatch(
    fake_parent: MagicMock,
) -> None:
    """turn_start is a UX signal only; a failing emitter must not stop
    the tool from running or change its result."""

    def boom(_turn: int) -> None:
        raise RuntimeError("emit failed")

    h = _make_handler(fake_parent, turn_started_callback=boom)
    h.current_turn = 2
    yielded, ret = _drain(h.dispatch("test_tool", {"a": 1}, response=MagicMock()))
    assert any("test tool ran" in y for y in yielded)
    assert ret.data["status"] == "success"
