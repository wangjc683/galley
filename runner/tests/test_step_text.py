"""A step's words reach the user before its tools run (main chat ticket 142):
what a step sends (`runner.step_text`), the handler's moment, the bridge's
runs, and the shipped engine's loop end to end."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

import runner.managed_runtime as managed_runtime
from runner import step_text, tell_user
from runner.ipc import (
    AbortCommand,
    AskUserResponseCommand,
    UserMessageCommand,
    decode_command,
    encode,
)
from runner.workbench_bridge import Bridge

MAIN_CHAT_ENV = tell_user.MAIN_CHAT_ENV
REPO = Path(__file__).resolve().parents[2]


def _reply(content: str, *tools: str) -> SimpleNamespace:
    """GA's response object as its loop hands it to dispatch: `content`,
    and `tool_calls` with `function.name` (llmcore `MockResponse`)."""
    calls = [SimpleNamespace(function=SimpleNamespace(name=name, arguments="{}")) for name in tools]
    return SimpleNamespace(content=content, tool_calls=calls)


# ---------------- what a step sends ----------------


def test_clean_matches_the_guis_and_cores_golden_rows() -> None:
    """The reply cleaning rules, as the GUI generated them for Core's port
    (`cleanFinalAnswer`): every golden row's answer, JavaScript's whitespace
    and line terminators included."""
    rows = json.loads(
        (REPO / "core" / "tests" / "fixtures" / "turn-persistence-rows.json").read_text(
            encoding="utf-8"
        )
    )["rows"]
    assert len(rows) >= 30
    for name, row in rows.items():
        assert (step_text.clean(row["content"]) or None) == row["finalAnswer"], name


@pytest.mark.parametrize(
    ("content", "words"),
    [
        ("<summary>查文件夹</summary>\n我先看一下大文件。", "我先看一下大文件。"),
        ("我会按内容分类。<summary>分类</summary>", "我会按内容分类。"),
        ("<summary>只有摘要</summary>", ""),
        ("<summary>a</summary>\n<next-suggestion>还有呢？</next-suggestion>", ""),
        ('好的。<subtask title="整理">把文件分好</subtask>', "好的。"),
        ("好的。<subtask>没写完的说明", "好的。"),
        ("<no-reply/>", ""),
        ("<thinking>想一下</thinking><summary>s</summary>  \n\n", ""),
        ("当前阶段：读文件\n\n<summary>s</summary>", ""),
        ("[Action] 写文件\n给你看 [FILE:/a/b.md]", "给你看"),
    ],
)
def test_clean(content: str, words: str) -> None:
    assert step_text.clean(content) == words


def test_a_step_that_calls_tools_sends_its_words() -> None:
    reply = _reply("<summary>查</summary>\n还要大约一分钟，我每 20 秒看一次。", "code_run")
    assert step_text.to_tell(reply) == "还要大约一分钟，我每 20 秒看一次。"
    # Several calls: still one message, the step's words.
    reply = _reply("<summary>查</summary>\n我先读两份。", "file_read", "file_read")
    assert step_text.to_tell(reply) == "我先读两份。"


def test_a_step_with_only_tags_sends_nothing() -> None:
    assert step_text.to_tell(_reply("<summary>读手册</summary>", "file_read")) == ""
    assert step_text.to_tell(_reply("", "file_read")) == ""


def test_the_runs_answer_is_not_a_step_that_sends() -> None:
    """No tool call: the run's reply, drawn as it always was."""
    assert step_text.to_tell(_reply("<summary>答</summary>\n明天晴。")) == ""
    assert step_text.to_tell(SimpleNamespace(content="明天晴。", tool_calls=None)) == ""


def test_a_step_that_calls_tell_user_sends_only_that_line() -> None:
    """Ruling 191: the step already says what it chose to say."""
    reply = _reply("<summary>先回一句</summary>\n我顺便说一下。", "tell_user", "code_run")
    assert step_text.to_tell(reply) == ""
    reply = _reply("<summary>先回一句</summary>\n我顺便说一下。", "code_run", "tell_user")
    assert step_text.to_tell(reply) == ""


def test_the_asking_step_sends_nothing() -> None:
    """GA's `ask_user` ends the run: that step is the run's last, drawn as
    its question."""
    reply = _reply("<summary>问</summary>\n需要你确认一下：", "ask_user")
    assert step_text.to_tell(reply) == ""


# ---------------- the handler's moment ----------------


def _drain(gen: Any) -> tuple[list[Any], Any]:
    yielded = []
    try:
        while True:
            yielded.append(next(gen))
    except StopIteration as e:
        return yielded, e.value


def _handler(order: list[str], callback: Any = None) -> Any:
    from runner.handlers import WorkbenchHandler

    class Handler(WorkbenchHandler):
        def do_probe(self, args: dict[str, Any], response: Any) -> Any:
            from agent_loop import StepOutcome

            order.append("tool ran")
            yield "probe ran\n"
            return StepOutcome({"status": "success"}, next_prompt="\n")

    def said(response: Any, turn: int) -> None:
        order.append(f"step {turn} handed over")

    h = Handler(
        parent=MagicMock(verbose=False, task_dir=None),
        last_history=[],
        cwd="/tmp/ga_test",
        step_text_callback=callback or said,
    )
    h.current_turn = 2
    return h


def test_the_first_dispatch_hands_the_reply_over_before_the_tool_runs() -> None:
    order: list[str] = []
    h = _handler(order)
    reply = _reply("<summary>s</summary>\n我先看看。", "probe", "probe")
    _drain(h.dispatch("probe", {}, reply, index=0, tool_num=2))
    _drain(h.dispatch("probe", {}, reply, index=1, tool_num=2))
    # Once per step, before its first tool; the second call hands nothing.
    assert order == ["step 2 handed over", "tool ran", "tool ran"]


def test_a_failing_hand_over_does_not_reach_gas_loop() -> None:
    order: list[str] = []

    def boom(response: Any, turn: int) -> None:
        raise RuntimeError("emit failed")

    h = _handler(order, boom)
    _, ret = _drain(h.dispatch("probe", {}, _reply("我先看看。", "probe")))
    assert order == ["tool ran"]
    assert ret.data == {"status": "success"}


# ---------------- the bridge ----------------


class _Agent:
    def __init__(self) -> None:
        self.queues: list[queue.Queue[dict[str, Any]]] = []

    def put_task(self, text: str, source: str, **_kwargs: Any) -> queue.Queue[dict[str, Any]]:
        q: queue.Queue[dict[str, Any]] = queue.Queue()
        self.queues.append(q)
        return q

    def abort(self) -> None:
        pass


def _bridge() -> Bridge:
    bridge = Bridge(
        ga_path="/tmp/ga",
        session_id="s1",
        cwd=None,
        llm_no=0,
        llm_name=None,
        stdout=StringIO(),
        stdin=StringIO(),
    )
    bridge.agent = _Agent()
    bridge._btw_handler = None
    bridge.agentmain = SimpleNamespace(
        TOOLS_SCHEMA=[{"type": "function", "function": {"name": "ask_user", "description": "Ask"}}]
    )
    return bridge


def _told(bridge: Bridge) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while not bridge.event_queue.empty():
        line = bridge.event_queue.get_nowait()
        assert line is not None
        event = cast("dict[str, Any]", json.loads(line))
        if event["kind"] == "tell_user":
            out.append(event)
    return out


@pytest.fixture
def main_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)


SAID = _reply("<summary>看文件夹</summary>\n我先看一下下载文件夹里的大文件。", "code_run")


def test_a_run_the_user_started_sends_the_steps_words(main_chat: None) -> None:
    bridge = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="看看下载文件夹", absoluteTurnIndex=10))
    _told(bridge)
    bridge._tell_step_text(SAID, 2)
    (event,) = _told(bridge)
    assert event["message"] == "我先看一下下载文件夹里的大文件。"
    assert event["stepText"] is True
    assert (event["turnIndex"], event["index"], event["absoluteTurnIndex"]) == (2, 1, 11)
    assert event["visibility"] == "visible"


def test_a_tell_user_line_is_not_step_text(main_chat: None) -> None:
    bridge = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="a", absoluteTurnIndex=0))
    _told(bridge)
    assert bridge._tell_user("记上了", 1)
    (event,) = _told(bridge)
    assert event["stepText"] is False


def test_a_run_core_woke_the_main_chat_for_sends_nothing(main_chat: None) -> None:
    """A subtask report, a reminder, the morning review: such a run may end
    in `<no-reply/>` and says nothing on the way."""
    bridge = _bridge()
    bridge.dispatch_command(
        UserMessageCommand(text="[Galley — not a message from the user] …", absoluteTurnIndex=3,
                           wake=True)
    )
    _told(bridge)
    bridge._tell_step_text(SAID, 1)
    assert _told(bridge) == []
    # The user's next run sends again.
    bridge.dispatch_command(AbortCommand())
    bridge.dispatch_command(UserMessageCommand(text="b", absoluteTurnIndex=6))
    _told(bridge)
    bridge._tell_step_text(SAID, 1)
    assert len(_told(bridge)) == 1


def test_the_users_answer_to_a_question_is_the_users_run(main_chat: None) -> None:
    bridge = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="woken", absoluteTurnIndex=0, wake=True))
    bridge.dispatch_command(AbortCommand())
    bridge.dispatch_command(AskUserResponseCommand(text="上海", absoluteTurnIndex=4))
    _told(bridge)
    bridge._tell_step_text(SAID, 1)
    (event,) = _told(bridge)
    assert event["absoluteTurnIndex"] == 4


def test_nothing_after_the_run_ended(main_chat: None) -> None:
    bridge = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="a", absoluteTurnIndex=0))
    bridge.dispatch_command(AbortCommand())
    _told(bridge)
    bridge._tell_step_text(SAID, 2)
    assert _told(bridge) == []


@pytest.mark.parametrize(
    ("flag", "managed"),
    [(None, True), ("0", True), ("1", False)],
    ids=["workbench", "not-the-main-chat", "attach"],
)
def test_nothing_outside_the_managed_main_chat(
    monkeypatch: pytest.MonkeyPatch, flag: str | None, managed: bool
) -> None:
    """Workbench sessions, subtasks, IM, attach mode (CLAUDE.md Rule 1)."""
    if flag is None:
        monkeypatch.delenv(MAIN_CHAT_ENV, raising=False)
    else:
        monkeypatch.setenv(MAIN_CHAT_ENV, flag)
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: managed)
    bridge = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="a", absoluteTurnIndex=0))
    _told(bridge)
    bridge._tell_step_text(SAID, 1)
    assert _told(bridge) == []


def test_wake_on_the_wire() -> None:
    """Core writes `wake` only when true."""
    woken = decode_command('{"kind":"user_message","text":"x","images":[],"wake":true}')
    assert isinstance(woken, UserMessageCommand) and woken.wake is True
    plain = decode_command('{"kind":"user_message","text":"x","images":[]}')
    assert isinstance(plain, UserMessageCommand) and plain.wake is False
    assert json.loads(encode(woken))["wake"] is True


# ---------------- the shipped engine ----------------
#
# The shipped payload's own `agentmain` (its `run()`, `agent_runner_loop`,
# `NativeToolClient`) in a child process, as ticket 137's tripwire runs it,
# with a fake backend: what GA's loop hands the handler, and when, is GA's;
# these hold it to "the words are out before the first tool runs".

_PROBE = r'''
import json, os, sys, threading, time
REPO, GA, SCRIPT = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.dont_write_bytecode = True
sys.path[:0] = [REPO, GA, os.path.join(GA, "frontends")]
import types
try:
    import requests, urllib3
except ImportError:
    sys.modules.setdefault("requests", types.ModuleType("requests"))
    u = types.ModuleType("urllib3")
    u.exceptions = types.SimpleNamespace(InsecureRequestWarning=Warning)
    u.disable_warnings = lambda *a, **k: None
    u.connection = types.SimpleNamespace(
        HTTPConnection=type("HTTPConnection", (), {"request": lambda self, *a, **k: None}))
    sys.modules["urllib3"] = u
import llmcore
store = llmcore.mykeys_store
with store.lock:
    store._load = lambda: ({}, None, None)
    store.data, store.path, store.mtime, store.updated_at = {}, None, None, None
import agentmain
import ga
from io import StringIO
from runner.workbench_bridge import Bridge
from runner.ipc import UserMessageCommand

asked = []

class Backend:
    model = "fake-model"
    context_win = 100000
    def __init__(self):
        self.name, self.history, self.system = "a", [], ""
    def ask(self, msg):
        n = len(asked)
        asked.append(n)
        reply = SCRIPT[n] if n < len(SCRIPT) else {"text": "<summary>done</summary>\\nok"}
        yield reply["text"]
        self.history.append(msg)
        calls = ([llmcore.MockToolCall(reply["tool"][0], reply["tool"][1], id="call_%d" % n)]
                 if reply.get("tool") else [])
        return llmcore.MockResponse("", reply["text"], calls, reply["text"])

agent = agentmain.GeneraticAgent()
client = llmcore.NativeToolClient(Backend())
agent.llmclients, agent._llm_config_keys = [client], ["native_a"]
agent.llm_no, agent.llmclient = 0, client
agent._mykeys_updated_at = store.snapshot()[1]
agent.verbose = True
agent.inc_out = True
bridge = Bridge(ga_path=GA, session_id="s1", cwd=None, llm_no=0, llm_name=None,
                stdout=StringIO(), stdin=StringIO())
bridge.agent, bridge.agentmain, bridge._btw_handler = agent, agentmain, None
bridge._install_handler_subclass()
bridge._register_turn_end_hook()

# Every event as it is emitted, on the thread that emits it.
emitted = []
_emit = bridge._emit
def emit(ev):
    record = {"kind": ev.kind}
    if ev.kind == "tell_user":
        record.update(message=ev.message, stepText=ev.stepText, turnIndex=ev.turnIndex,
                      index=ev.index, absoluteTurnIndex=ev.absoluteTurnIndex)
    emitted.append(record)
    _emit(ev)
bridge._emit = emit

# What had gone out when GA's own tool started.
at_tool = []
_read = ga.GenericAgentHandler.do_file_read
def do_file_read(self, args, response):
    at_tool.append([e["kind"] for e in emitted])
    return _read(self, args, response)
ga.GenericAgentHandler.do_file_read = do_file_read

threading.Thread(target=agent.run, daemon=True).start()

def run(text, base, wake):
    bridge.dispatch_command(UserMessageCommand(text=text, absoluteTurnIndex=base, wake=wake))
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            line = bridge.event_queue.get(timeout=0.5)
        except Exception:
            continue
        if json.loads(line)["kind"] == "run_complete":
            break
    while agent.is_running and time.time() < deadline:
        time.sleep(0.05)

run("look", 0, False)
run("[Galley — not a message from the user] woken", 5, True)
print(json.dumps({"emitted": emitted, "at_tool": at_tool, "asked": len(asked)},
                 ensure_ascii=False))
'''


def _engine(env: dict[str, str], script: list[dict[str, Any]]) -> dict[str, Any]:
    ga = REPO / "managed-ga" / "code"
    with tempfile.TemporaryDirectory() as state:
        full_env = {k: v for k, v in os.environ.items() if not k.startswith(("GALLEY", "GA_"))}
        full_env.update(env, GALLEY_GA_STATE_ROOT=state, GA_LANG="en", PYTHONDONTWRITEBYTECODE="1")
        proc = subprocess.run(
            [sys.executable, "-B", "-c", _PROBE, str(REPO), str(ga), json.dumps(script)],
            capture_output=True,
            text=True,
            env=full_env,
            cwd=state,
            timeout=120,
        )
    assert proc.returncode == 0, proc.stderr[-3000:]
    return cast("dict[str, Any]", json.loads(proc.stdout.strip().splitlines()[-1]))


_LOOK = {
    "text": "<summary>读笔记</summary>\n我先看一下这份笔记。",
    "tool": ["file_read", {"path": "notes.md"}],
}


def test_the_engine_sends_the_words_before_the_first_tool_runs() -> None:
    """The managed main chat: a run the user started sends its first step's
    words before GA's `file_read` runs, and not its answer; a run Core woke
    it for sends nothing."""
    out = _engine(
        {"GALLEY_RUNTIME_KIND": "managed", MAIN_CHAT_ENV: "1"},
        [
            _LOOK,
            {"text": "<summary>answer</summary>\n笔记里只有一行。"},
            _LOOK,
            {"text": "<summary>answer</summary>\n<no-reply/>"},
        ],
    )
    assert out["asked"] == 4
    told = [e for e in out["emitted"] if e["kind"] == "tell_user"]
    assert told == [
        {
            "kind": "tell_user",
            "message": "我先看一下这份笔记。",
            "stepText": True,
            "turnIndex": 1,
            "index": 1,
            "absoluteTurnIndex": 0,
        }
    ]
    # Out before the tool ran, in the user's run; nothing new in the woken one.
    assert len(out["at_tool"]) == 2
    assert "tell_user" in out["at_tool"][0]
    assert out["at_tool"][1].count("tell_user") == 1
    # Before the step's own turn_end, as `tell_user` (ticket 137).
    kinds = [e["kind"] for e in out["emitted"]]
    assert kinds.index("tell_user") < kinds.index("turn_end")


def test_the_engine_sends_nothing_in_a_workbench_session() -> None:
    out = _engine(
        {"GALLEY_RUNTIME_KIND": "managed"},
        [_LOOK, {"text": "<summary>answer</summary>\n好。"}],
    )
    assert [e for e in out["emitted"] if e["kind"] == "tell_user"] == []
