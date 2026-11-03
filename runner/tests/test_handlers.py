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
    MAIN_CHAT_BROWSER_REFUSAL,
    MAIN_CHAT_ENV,
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

    # Browser tools and a file tool that record whether they ran, for the
    # main chat's browser guard. `web_future_tool` stands for one upstream
    # GA might add later.
    ran: list[str]

    def _ran(self, name: str) -> Any:
        from agent_loop import StepOutcome
        self.ran.append(name)
        yield f"{name} ran\n"
        return StepOutcome({"status": "success", "tool": name}, next_prompt="\n")

    def do_web_scan(self, args: dict[str, Any], response: Any) -> Any:
        return (yield from self._ran("web_scan"))

    def do_web_execute_js(self, args: dict[str, Any], response: Any) -> Any:
        return (yield from self._ran("web_execute_js"))

    def do_web_future_tool(self, args: dict[str, Any], response: Any) -> Any:
        return (yield from self._ran("web_future_tool"))

    def do_file_read(self, args: dict[str, Any], response: Any) -> Any:
        return (yield from self._ran("file_read"))


@pytest.fixture
def fake_parent() -> MagicMock:
    return MagicMock(verbose=False, task_dir=None)


def _make_handler(fake_parent: MagicMock, **kwargs: Any) -> _FakeHandler:
    h = _FakeHandler(
        parent=fake_parent,
        last_history=[],
        cwd="/tmp/ga_test",
        **kwargs,
    )
    h.ran = []
    return h


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


# ---------------- Main chat browser guard (ticket 135) ----------------

_BROWSER_TOOLS = ["web_scan", "web_execute_js", "web_future_tool"]


@pytest.fixture
def managed_main_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    """The env Core gives the main chat's runner in the managed runtime."""
    monkeypatch.setenv("GALLEY_RUNTIME_KIND", "managed")
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")


@pytest.mark.parametrize("tool", _BROWSER_TOOLS)
def test_main_chat_refuses_browser_tools(
    fake_parent: MagicMock, managed_main_chat: None, tool: str
) -> None:
    """Main chat PRD ruling 184: in the managed main chat a browser tool
    does not run; the model reads, in GA's error envelope, that it should
    hand the work to a subtask. Any `web_` tool, including one GA does
    not have yet."""
    h = _make_handler(fake_parent)
    yielded, ret = _drain(h.dispatch(tool, {"script": "location.href"}, response=MagicMock()))
    assert h.ran == []
    assert yielded == []
    assert ret.data == {"status": "error", "msg": MAIN_CHAT_BROWSER_REFUSAL}
    assert ret.next_prompt == "\n"
    assert ret.should_exit is False


def test_main_chat_refusal_text() -> None:
    """The words the model reads (ticket 135, widened by the main session:
    no going online at all, curl in code_run included)."""
    assert MAIN_CHAT_BROWSER_REFUSAL == (
        "This is the main chat: you do not go online here, neither with the browser "
        "nor with commands such as curl in code_run. Hand this to a subtask: end your "
        'reply with <subtask title="a few words">what to do</subtask>, with everything '
        "it needs (the goal, the facts the user gave, what this conversation already "
        "settled). Tell the user in a sentence that it is on its way."
    )


def test_main_chat_refusal_still_sends_the_turn_signal(
    fake_parent: MagicMock, managed_main_chat: None
) -> None:
    """The refused step is still a step: the desktop's live turn signal
    goes out as it does for a tool that runs."""
    seen: list[int] = []
    h = _make_handler(fake_parent, turn_started_callback=seen.append)
    h.current_turn = 2
    _drain(h.dispatch("web_scan", {}, response=MagicMock()))
    assert seen == [2]
    assert h.ran == []


@pytest.mark.parametrize("tool", ["code_run", "file_read"])
def test_main_chat_runs_other_tools(
    fake_parent: MagicMock, managed_main_chat: None, tool: str
) -> None:
    """Only browser tools are refused: code_run (a curl inside it is a
    known gap) and the file tools run as everywhere."""
    h = _make_handler(fake_parent)
    yielded, ret = _drain(h.dispatch(tool, {"type": "python"}, response=MagicMock()))
    assert any(f"{tool} ran" in y for y in yielded)
    assert ret.data["status"] == "success"


@pytest.mark.parametrize("flag", [None, "", "0", "true", "yes", " 1", "1 "])
def test_no_main_chat_flag_refuses_nothing(
    fake_parent: MagicMock, monkeypatch: pytest.MonkeyPatch, flag: str | None
) -> None:
    """Every other managed runner (a workbench session, a subtask, IM)
    has no flag; only exactly "1" counts."""
    monkeypatch.setenv("GALLEY_RUNTIME_KIND", "managed")
    if flag is None:
        monkeypatch.delenv(MAIN_CHAT_ENV, raising=False)
    else:
        monkeypatch.setenv(MAIN_CHAT_ENV, flag)
    h = _make_handler(fake_parent)
    for tool in _BROWSER_TOOLS:
        _, ret = _drain(h.dispatch(tool, {}, response=MagicMock()))
        assert ret.data == {"status": "success", "tool": tool}
    assert h.ran == _BROWSER_TOOLS


@pytest.mark.parametrize("runtime_kind", [None, "external", "Managed"])
def test_attach_mode_refuses_nothing_even_with_the_flag(
    fake_parent: MagicMock, monkeypatch: pytest.MonkeyPatch, runtime_kind: str | None
) -> None:
    """CLAUDE.md Rule 1: outside the managed runtime the handler subclass
    never changes dispatch or results, so a stray GALLEY_MAIN_CHAT=1 in an
    external GA's environment changes nothing."""
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")
    if runtime_kind is None:
        monkeypatch.delenv("GALLEY_RUNTIME_KIND", raising=False)
    else:
        monkeypatch.setenv("GALLEY_RUNTIME_KIND", runtime_kind)
    h = _make_handler(fake_parent)
    for tool in _BROWSER_TOOLS:
        yielded, ret = _drain(h.dispatch(tool, {}, response=MagicMock()))
        assert any(f"{tool} ran" in y for y in yielded)
        assert ret.data == {"status": "success", "tool": tool}
    assert h.ran == _BROWSER_TOOLS
