"""What the user says while the main chat's run is going (main chat ticket 136):
the runner's account (runner/interject.py) and the bridge around it."""

from __future__ import annotations

import json
import queue
import threading
from io import StringIO
from types import SimpleNamespace
from typing import Any, cast

import pytest

import runner.managed_runtime as managed_runtime
from runner.interject import Interjections, compose
from runner.ipc import (
    AbortCommand,
    InterjectCommand,
    UserMessageCommand,
    decode_command,
    decode_event,
    encode,
)
from runner.workbench_bridge import Bridge

PREAMBLE = "The user sent this while you were working."


class Recorder:
    """The writer: what `intervene` holds, and every write."""

    def __init__(self) -> None:
        self.value: str | None = None
        self.writes: list[str | None] = []

    def __call__(self, text: str | None) -> None:
        self.value = text
        self.writes.append(text)


# ---------------- the account ----------------


def test_add_writes_the_preamble_and_the_messages_in_order() -> None:
    rec = Recorder()
    account = Interjections(rec)
    assert account.add([("q1", "上海的")], PREAMBLE) == ["q1"]
    assert rec.value == f"{PREAMBLE}\n\n上海的"
    assert account.add([("q2", "算了，查后天")], PREAMBLE) == ["q2"]
    assert rec.value == f"{PREAMBLE}\n\n上海的\n\n算了，查后天"


def test_a_step_that_read_them_delivers_them_together() -> None:
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a")], PREAMBLE)
    account.add([("q2", "b")], PREAMBLE)
    taken = rec.value
    rec.value = None  # GA clears `intervene` after reading it
    assert account.step_ended(taken, run_goes_on=True) == ["q1", "q2"]
    assert rec.value is None
    assert account.take_unread() == []


def test_a_message_wiped_between_ga_read_and_clear_is_written_back() -> None:
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a")], PREAMBLE)
    taken = rec.value  # GA reads "a"
    account.add([("q2", "b")], PREAMBLE)  # arrives before GA clears
    rec.value = None  # GA clears: "b" is wiped
    assert account.step_ended(taken, run_goes_on=True) == ["q1"]
    assert rec.value == compose(PREAMBLE, ["b"])
    # The next step reads it.
    assert account.step_ended(rec.value, run_goes_on=True) == ["q2"]


def test_a_message_that_arrived_after_the_clear_is_kept() -> None:
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a")], PREAMBLE)
    taken = rec.value
    rec.value = None
    account.add([("q2", "b")], PREAMBLE)  # after GA's clear, before the hook
    assert account.step_ended(taken, run_goes_on=True) == ["q1"]
    assert rec.value == compose(PREAMBLE, ["b"])


def test_the_loops_last_call_delivers_nothing() -> None:
    """GA's call that ends its loop reads `intervene` too; that prompt goes
    nowhere, so the messages are unread."""
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a")], PREAMBLE)
    taken = rec.value
    rec.value = None
    assert account.step_ended(taken, run_goes_on=False) == []
    assert account.take_unread() == ["q1"]
    assert rec.value is None


def test_a_step_that_read_nothing_writes_the_messages_back() -> None:
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a")], PREAMBLE)
    rec.value = None  # wiped before GA's read: it took nothing
    assert account.step_ended(None, run_goes_on=True) == []
    assert rec.value == compose(PREAMBLE, ["a"])


def test_text_not_written_here_delivers_nothing() -> None:
    """GA's file-based `_intervene` (not Galley's) is not ours."""
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a")], PREAMBLE)
    assert account.step_ended("something else", run_goes_on=True) == []
    assert account.take_unread() == ["q1"]


def test_a_message_taken_twice_in_a_run_goes_in_once() -> None:
    rec = Recorder()
    account = Interjections(rec)
    assert account.add([("q1", "a")], PREAMBLE) == ["q1"]
    assert account.add([("q1", "a"), ("q2", "b")], PREAMBLE) == ["q2"]
    assert rec.value == compose(PREAMBLE, ["a", "b"])
    # A new run takes it again.
    account.take_unread()
    assert account.add([("q1", "a")], PREAMBLE) == ["q1"]


def test_nothing_taken_writes_nothing() -> None:
    """Attach mode never reaches `add`: the account never writes GA's
    attribute (CLAUDE.md Rule 1)."""
    rec = Recorder()
    account = Interjections(rec)
    assert account.step_ended(None, run_goes_on=True) == []
    assert account.step_ended("x", run_goes_on=False) == []
    assert account.take_unread() == []
    assert rec.writes == []


def test_take_unread_clears_intervene_and_starts_over() -> None:
    rec = Recorder()
    account = Interjections(rec)
    account.add([("q1", "a"), ("q2", "b")], PREAMBLE)
    assert account.take_unread() == ["q1", "q2"]
    assert rec.value is None
    assert account.take_unread() == []


# ---------------- wire ----------------


def test_interject_command_and_events_round_trip() -> None:
    line = (
        '{"kind":"interject","items":[{"id":"qm_1","text":"上海的"}],'
        '"preamble":"p"}'
    )
    cmd = decode_command(line)
    assert isinstance(cmd, InterjectCommand)
    assert cmd.items == [{"id": "qm_1", "text": "上海的"}]
    assert cmd.preamble == "p"
    for raw in (
        '{"kind":"interject_delivered","sessionId":"s","ids":["qm_1"],'
        '"turnIndex":2,"absoluteTurnIndex":11,"timestamp":"t"}',
        '{"kind":"interject_returned","sessionId":"s","ids":["qm_1"],"timestamp":"t"}',
    ):
        event = decode_event(raw)
        assert json.loads(encode(event)) == json.loads(raw)


# ---------------- the bridge ----------------


class _Agent:
    """Fake GA agent: `put_task` hands back a display queue nobody fills."""

    def __init__(self) -> None:
        self.queues: list[queue.Queue[dict[str, Any]]] = []

    def put_task(self, text: str, source: str, **_kwargs: Any) -> queue.Queue[dict[str, Any]]:
        q: queue.Queue[dict[str, Any]] = queue.Queue()
        self.queues.append(q)
        return q

    def abort(self) -> None:
        pass


def _bridge() -> tuple[Bridge, _Agent]:
    bridge = Bridge(
        ga_path="/tmp/ga",
        session_id="s1",
        cwd=None,
        llm_no=0,
        llm_name=None,
        stdout=StringIO(),
        stdin=StringIO(),
    )
    agent = _Agent()
    bridge.agent = agent
    bridge._btw_handler = None
    return bridge, agent


def _events(bridge: Bridge) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while not bridge.event_queue.empty():
        line = bridge.event_queue.get_nowait()
        assert line is not None
        out.append(cast("dict[str, Any]", json.loads(line)))
    return out


@pytest.fixture
def main_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GALLEY_MAIN_CHAT", "1")
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)


def _step(turn: int, injprompt: str | None, exit_reason: Any = None) -> dict[str, Any]:
    return {
        "self": SimpleNamespace(max_turns=180, cwd=None),
        "response": SimpleNamespace(content="还在推进。" if not exit_reason else "答案。"),
        "turn": turn,
        "exit_reason": exit_reason,
        "injprompt": injprompt,
    }


def _interject(bridge: Bridge, *items: tuple[str, str]) -> None:
    bridge.dispatch_command(
        InterjectCommand(items=[{"id": i, "text": t} for i, t in items], preamble=PREAMBLE)
    )


def test_bridge_delivers_after_the_steps_turn_end(main_chat: None) -> None:
    bridge, agent = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="查明天天气", absoluteTurnIndex=10))
    _events(bridge)
    _interject(bridge, ("qm_1", "上海的"), ("qm_2", "算了，查后天"))
    expected = compose(PREAMBLE, ["上海的", "算了，查后天"])
    assert agent.intervene == expected  # type: ignore[attr-defined]

    agent.intervene = None  # type: ignore[attr-defined]  # GA read it
    bridge._on_turn_end(_step(2, expected))

    events = _events(bridge)
    assert [e["kind"] for e in events] == ["turn_end", "interject_delivered", "turn_start"]
    assert events[1]["ids"] == ["qm_1", "qm_2"]
    assert events[1]["turnIndex"] == 2
    # The step's own index: Core writes them after it.
    assert events[1]["absoluteTurnIndex"] == events[0]["absoluteTurnIndex"] == 11


def test_bridge_returns_unread_before_run_complete(main_chat: None) -> None:
    """Writing the last reply when it arrives: the loop's last call reads
    it and the prompt goes nowhere. Returned ahead of run_complete,
    `intervene` cleared so it never reaches the next run's first step."""
    bridge, agent = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="几点了", absoluteTurnIndex=4))
    _events(bridge)
    _interject(bridge, ("qm_1", "顺便说下星期几"))
    taken = agent.intervene  # type: ignore[attr-defined]
    agent.intervene = None  # type: ignore[attr-defined]

    bridge._on_turn_end(_step(1, taken, {"result": "CURRENT_TASK_DONE", "data": None}))

    events = _events(bridge)
    assert [e["kind"] for e in events] == ["turn_end", "interject_returned", "run_complete"]
    assert events[1]["ids"] == ["qm_1"]
    assert agent.intervene is None  # type: ignore[attr-defined]

    # The next run takes the same message again (Core sends it then).
    bridge.dispatch_command(UserMessageCommand(text="顺便说下星期几", absoluteTurnIndex=5))
    assert [e["kind"] for e in _events(bridge)] == ["turn_start"]
    assert agent.intervene is None  # type: ignore[attr-defined]


def test_bridge_returns_at_the_step_cap(main_chat: None) -> None:
    """The last in-loop step at max_turns: GA's loop ends without the
    post-loop call, the prompt is discarded."""
    bridge, agent = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="go", absoluteTurnIndex=0))
    _events(bridge)
    _interject(bridge, ("qm_1", "a"))
    taken = agent.intervene  # type: ignore[attr-defined]
    ctx = _step(3, taken)
    ctx["self"] = SimpleNamespace(max_turns=3, cwd=None)
    bridge._on_turn_end(ctx)
    kinds = [e["kind"] for e in _events(bridge)]
    assert "interject_delivered" not in kinds
    assert kinds[-2:] == ["interject_returned", "run_complete"]


def test_bridge_returns_on_abort(main_chat: None) -> None:
    bridge, agent = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="go", absoluteTurnIndex=0))
    _events(bridge)
    _interject(bridge, ("qm_1", "a"))
    bridge.dispatch_command(AbortCommand())
    events = _events(bridge)
    assert [e["kind"] for e in events] == ["interject_returned", "run_complete"]
    assert events[1]["exitReason"]["result"] == "ABORTED"
    assert agent.intervene is None  # type: ignore[attr-defined]


def test_bridge_returns_with_no_run_going(main_chat: None) -> None:
    bridge, agent = _bridge()
    _interject(bridge, ("qm_1", "a"))
    events = _events(bridge)
    assert [e["kind"] for e in events] == ["interject_returned"]
    assert events[0]["ids"] == ["qm_1"]
    assert not hasattr(agent, "intervene")


@pytest.mark.parametrize(
    "env_main_chat,managed",
    [("1", False), (None, True), ("0", True)],
)
def test_bridge_never_writes_intervene_outside_the_managed_main_chat(
    monkeypatch: pytest.MonkeyPatch, env_main_chat: str | None, managed: bool
) -> None:
    """Attach mode, a workbench session, a subtask: GA's attribute stays
    untouched (CLAUDE.md Rule 1)."""
    if env_main_chat is None:
        monkeypatch.delenv("GALLEY_MAIN_CHAT", raising=False)
    else:
        monkeypatch.setenv("GALLEY_MAIN_CHAT", env_main_chat)
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: managed)
    bridge, agent = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="go", absoluteTurnIndex=0))
    _events(bridge)
    _interject(bridge, ("qm_1", "a"))
    assert [e["kind"] for e in _events(bridge)] == ["interject_returned"]
    assert not hasattr(agent, "intervene")
    bridge._on_turn_end(_step(1, None, {"result": "CURRENT_TASK_DONE", "data": None}))
    assert not hasattr(agent, "intervene")


def test_bridge_interject_racing_the_runs_end_is_returned_once(main_chat: None) -> None:
    """A message arriving while the run's end is being reported lands
    either in the run's unread (returned with it) or after it (returned
    on its own) — never both, never in the next run."""
    bridge, agent = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="go", absoluteTurnIndex=0))
    _events(bridge)
    done = threading.Event()

    def interject() -> None:
        _interject(bridge, ("qm_1", "a"))
        done.set()

    t = threading.Thread(target=interject)
    t.start()
    bridge._on_turn_end(_step(1, None, {"result": "CURRENT_TASK_DONE", "data": None}))
    t.join(timeout=2.0)
    assert done.is_set()
    returned = [e for e in _events(bridge) if e["kind"] == "interject_returned"]
    assert [e["ids"] for e in returned] == [["qm_1"]]
    assert getattr(agent, "intervene", None) is None
