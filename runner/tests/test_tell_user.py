"""A line to the user mid-run: the main chat's `tell_user` (main chat ticket
137): the tool's entry, the handler that answers it, the tool list it joins,
and the bridge's event."""

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
from runner import tell_user
from runner.ga_session import GaSession
from runner.handlers import MAIN_CHAT_ENV, WorkbenchHandler
from runner.ipc import (
    AbortCommand,
    AskUserResponseCommand,
    TellUserEvent,
    UserMessageCommand,
    decode_event,
    encode,
)
from runner.workbench_bridge import Bridge


def _drain(gen: Any) -> tuple[list[Any], Any]:
    yielded = []
    try:
        while True:
            yielded.append(next(gen))
    except StopIteration as e:
        return yielded, e.value


@pytest.fixture
def managed_main_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    """The env Core gives the main chat's runner in the managed runtime."""
    monkeypatch.setenv("GALLEY_RUNTIME_KIND", "managed")
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")


# ---------------- the tool's entry ----------------


def test_the_entry_says_what_it_is_and_when_it_helps() -> None:
    """Ruling 186 point 2: what it is and when it helps, no rules; one
    parameter."""
    entry = tell_user.tool_entry([])
    fn = entry["function"]
    assert entry["type"] == "function"
    assert fn["name"] == "tell_user"
    assert fn["description"] == (
        "Send the user a message right away, without ending your turn; until your "
        "final reply, nothing else you write reaches them. Useful when the user says "
        "something while you are working, or when what you are doing will take a "
        "while and they would want to know how it is going."
    )
    assert fn["parameters"]["required"] == ["message"]
    assert list(fn["parameters"]["properties"]) == ["message"]
    assert fn["parameters"]["properties"]["message"]["description"] == (
        "What to tell them: a sentence or a short paragraph."
    )
    for word in ("must", "always", "never", "should"):
        assert word not in fn["description"].lower()


def test_the_entry_is_chinese_beside_gas_chinese_tool_list() -> None:
    """GA's Chinese tool list (tools_schema_cn.json) gets the Chinese pair."""
    def ask_entry(description: str) -> list[dict[str, Any]]:
        return [{"type": "function", "function": {"name": "ask_user", "description": description}}]

    cn_list = ask_entry("当需要用户决策时提问")
    en_list = ask_entry("Interrupt task to ask user")
    assert tell_user.tool_entry(cn_list)["function"]["description"] == tell_user.DESCRIPTION_CN
    assert (
        tell_user.tool_entry(cn_list)["function"]["parameters"]["properties"]["message"]["description"]
        == tell_user.MESSAGE_CN
    )
    assert tell_user.tool_entry(en_list)["function"]["description"] == tell_user.DESCRIPTION_EN


def test_the_entry_matches_gas_real_tool_lists() -> None:
    """Read against the payload's own two files."""
    from pathlib import Path

    assets = Path(__file__).resolve().parents[2] / "managed-ga" / "code" / "assets"
    en = json.loads((assets / "tools_schema.json").read_text(encoding="utf-8"))
    cn = json.loads((assets / "tools_schema_cn.json").read_text(encoding="utf-8"))
    assert tell_user.tool_entry(en)["function"]["description"] == tell_user.DESCRIPTION_EN
    assert tell_user.tool_entry(cn)["function"]["description"] == tell_user.DESCRIPTION_CN
    # GA has no tool of that name: nothing of GA's is shadowed.
    assert all(t["function"]["name"] != "tell_user" for t in en + cn)


def test_the_results_say_sent_and_go_on() -> None:
    assert tell_user.SENT == {
        "status": "success",
        "msg": "Sent to the user. Carry on; your turn has not ended.",
    }
    assert tell_user.EMPTY["status"] == tell_user.CLOSED["status"] == "error"


def test_the_main_chat_variable_is_the_browser_guards() -> None:
    assert tell_user.MAIN_CHAT_ENV == MAIN_CHAT_ENV


@pytest.mark.parametrize(
    ("kind", "flag", "offered"),
    [
        ("managed", "1", True),
        ("managed", None, False),
        ("managed", "0", False),
        ("managed", "1 ", False),
        ("external", "1", False),
        (None, "1", False),
    ],
)
def test_offered_only_in_the_managed_main_chat(
    monkeypatch: pytest.MonkeyPatch, kind: str | None, flag: str | None, offered: bool
) -> None:
    for name, value in (("GALLEY_RUNTIME_KIND", kind), (MAIN_CHAT_ENV, flag)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    assert tell_user.offered_here() is offered


def test_message_of() -> None:
    assert tell_user.message_of({"message": "  记上了，天气还在查 "}) == "记上了，天气还在查"
    assert tell_user.message_of({"message": ""}) == ""
    assert tell_user.message_of({"message": 3}) == ""
    assert tell_user.message_of({}) == ""
    assert tell_user.message_of(None) == ""


# ---------------- the handler ----------------


def _record(calls: list[Any], message: str) -> bool:
    calls.append(message)
    return True


def _handler(callback: Any = None, seen: list[int] | None = None) -> WorkbenchHandler:
    h = WorkbenchHandler(
        parent=MagicMock(verbose=False, task_dir=None),
        last_history=[],
        cwd="/tmp/ga_test",
        turn_started_callback=(seen.append if seen is not None else None),
        tell_user_callback=callback,
    )
    h.current_turn = 3
    return h


def test_handler_sends_and_the_run_goes_on(managed_main_chat: None) -> None:
    calls: list[tuple[str, int]] = []
    seen: list[int] = []

    def send(message: str, turn: int) -> bool:
        calls.append((message, turn))
        return True

    h = _handler(send, seen)
    yielded, ret = _drain(h.dispatch("tell_user", {"message": " 记上了，天气还在查 "}, MagicMock()))
    assert calls == [("记上了，天气还在查", 3)]
    assert yielded == []
    assert ret.data == tell_user.SENT
    assert ret.should_exit is False
    # GA's usual next prompt (its working memory anchor): the loop goes on.
    assert ret.next_prompt and "Current turn: 3" in ret.next_prompt
    # The step shows: its turn signal went out.
    assert seen == [3]


def test_handler_second_parallel_call_gets_a_short_prompt(managed_main_chat: None) -> None:
    h = _handler(lambda m, t: True)
    _, ret = _drain(h.dispatch("tell_user", {"message": "a"}, MagicMock(), index=1, tool_num=2))
    assert ret.next_prompt == "\n"


def test_handler_empty_message_sends_nothing(managed_main_chat: None) -> None:
    calls: list[Any] = []
    h = _handler(lambda m, t: _record(calls, m))
    _, ret = _drain(h.dispatch("tell_user", {"message": "  "}, MagicMock()))
    assert calls == []
    assert ret.data == tell_user.EMPTY
    assert ret.next_prompt == "\n"


def test_handler_run_already_ended(managed_main_chat: None) -> None:
    h = _handler(lambda m, t: False)
    _, ret = _drain(h.dispatch("tell_user", {"message": "a"}, MagicMock()))
    assert ret.data == tell_user.CLOSED
    assert ret.next_prompt == "\n"
    # Without a bridge (no callback) nothing is sent either.
    _, ret = _drain(_handler(None).dispatch("tell_user", {"message": "a"}, MagicMock()))
    assert ret.data == tell_user.CLOSED


@pytest.mark.parametrize(
    ("kind", "flag"), [("managed", None), ("managed", "0"), ("external", "1"), (None, "1")]
)
def test_elsewhere_ga_answers_as_for_any_unknown_tool(
    monkeypatch: pytest.MonkeyPatch, kind: str | None, flag: str | None
) -> None:
    """A workbench session, a subtask, IM, attach mode: the call reaches
    GA's dispatch, which has no such tool (CLAUDE.md Rule 1: the subclass
    changes nothing there)."""
    for name, value in (("GALLEY_RUNTIME_KIND", kind), (MAIN_CHAT_ENV, flag)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    calls: list[Any] = []
    h = _handler(lambda m, t: _record(calls, m))
    yielded, ret = _drain(h.dispatch("tell_user", {"message": "a"}, MagicMock()))
    assert calls == []
    assert any("未知工具" in str(y) for y in yielded)
    assert ret.next_prompt.startswith("未知工具")


# ---------------- the tool list ----------------


def test_offer_tool_adds_once_and_again_after_a_reload() -> None:
    module = SimpleNamespace(TOOLS_SCHEMA=[{"type": "function", "function": {"name": "ask_user"}}])
    assert GaSession.offer_tool(module, tell_user.tool_entry)
    assert GaSession.offer_tool(module, tell_user.tool_entry)
    names = [t["function"]["name"] for t in module.TOOLS_SCHEMA]
    assert names == ["ask_user", "tell_user"]
    # GA's load_tool_schema() rebinds the global (next_llm): offered again.
    module.TOOLS_SCHEMA = [{"type": "function", "function": {"name": "ask_user"}}]
    GaSession.offer_tool(module, tell_user.tool_entry)
    assert [t["function"]["name"] for t in module.TOOLS_SCHEMA] == ["ask_user", "tell_user"]


def test_offer_tool_without_a_list() -> None:
    assert GaSession.offer_tool(SimpleNamespace(), tell_user.tool_entry) is False
    assert GaSession.offer_tool(SimpleNamespace(TOOLS_SCHEMA=None), tell_user.tool_entry) is False


# ---------------- wire ----------------


def test_tell_user_event_round_trips() -> None:
    raw = (
        '{"kind":"tell_user","sessionId":"s","message":"记上了","turnIndex":2,"index":1,'
        '"absoluteTurnIndex":11,"visibility":"visible","timestamp":"t"}'
    )
    event = decode_event(raw)
    assert isinstance(event, TellUserEvent)
    assert json.loads(encode(event)) == json.loads(raw)


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


def _bridge() -> tuple[Bridge, _Agent, SimpleNamespace]:
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
    agentmain = SimpleNamespace(
        TOOLS_SCHEMA=[{"type": "function", "function": {"name": "ask_user", "description": "Ask"}}]
    )
    bridge.agentmain = agentmain
    return bridge, agent, agentmain


def _events(bridge: Bridge) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while not bridge.event_queue.empty():
        line = bridge.event_queue.get_nowait()
        assert line is not None
        out.append(cast("dict[str, Any]", json.loads(line)))
    return out


@pytest.fixture
def main_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)


def _names(agentmain: SimpleNamespace) -> list[str]:
    return [t["function"]["name"] for t in agentmain.TOOLS_SCHEMA]


def test_bridge_offers_the_tool_before_each_run(main_chat: None) -> None:
    bridge, _agent, agentmain = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="查明天天气", absoluteTurnIndex=10))
    assert _names(agentmain) == ["ask_user", "tell_user"]
    # A model switch reloaded GA's list: the next run (an answer) offers it again.
    agentmain.TOOLS_SCHEMA = [{"type": "function", "function": {"name": "ask_user"}}]
    bridge.run_in_progress.clear()
    bridge.dispatch_command(AskUserResponseCommand(text="上海", absoluteTurnIndex=12))
    assert _names(agentmain) == ["ask_user", "tell_user"]


def test_bridge_offers_nothing_elsewhere(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(MAIN_CHAT_ENV, raising=False)
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)
    bridge, _agent, agentmain = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="go", absoluteTurnIndex=0))
    assert _names(agentmain) == ["ask_user"]
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: False)
    bridge, _agent, agentmain = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="go", absoluteTurnIndex=0))
    assert _names(agentmain) == ["ask_user"]


def test_bridge_sends_each_message_with_its_step_and_index(main_chat: None) -> None:
    bridge, _agent, _ = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="查明天天气", absoluteTurnIndex=10))
    _events(bridge)
    assert bridge._tell_user("记上了，天气还在查", 2)
    assert bridge._tell_user("另外一句", 2)
    assert bridge._tell_user("第三步的", 3)
    events = _events(bridge)
    assert [e["kind"] for e in events] == ["tell_user"] * 3
    assert [(e["message"], e["turnIndex"], e["index"], e["absoluteTurnIndex"]) for e in events] == [
        ("记上了，天气还在查", 2, 1, 11),
        ("另外一句", 2, 2, 11),
        ("第三步的", 3, 1, 12),
    ]
    assert all(e["visibility"] == "visible" and e["sessionId"] == "s1" for e in events)


def test_bridge_counts_from_one_again_in_the_next_run(main_chat: None) -> None:
    bridge, _agent, _ = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="a", absoluteTurnIndex=0))
    bridge._tell_user("x", 1)
    bridge.dispatch_command(AbortCommand())
    bridge.dispatch_command(UserMessageCommand(text="b", absoluteTurnIndex=5))
    _events(bridge)
    bridge._tell_user("y", 1)
    (event,) = _events(bridge)
    assert (event["index"], event["absoluteTurnIndex"]) == (1, 5)


def test_bridge_sends_nothing_after_the_run_ended(main_chat: None) -> None:
    """A stop racing the call: the message never follows run_complete."""
    bridge, _agent, _ = _bridge()
    bridge.dispatch_command(UserMessageCommand(text="a", absoluteTurnIndex=0))
    bridge.dispatch_command(AbortCommand())
    _events(bridge)
    assert bridge._tell_user("太晚了", 2) is False
    assert _events(bridge) == []


def test_the_configured_handler_reaches_the_bridge(
    main_chat: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The handler GA builds per run (`_install_handler_subclass`) sends
    through the bridge."""
    bridge, _agent, agentmain = _bridge()
    installed: dict[str, Any] = {}
    monkeypatch.setattr(
        GaSession, "install_handler", lambda self, module, cls: installed.update(cls=cls)
    )
    bridge._install_handler_subclass()
    bridge.dispatch_command(UserMessageCommand(text="a", absoluteTurnIndex=7))
    _events(bridge)
    h = installed["cls"](MagicMock(verbose=False, task_dir=None), [], "/tmp/ga_test")
    h.current_turn = 1
    _, ret = _drain(h.dispatch("tell_user", {"message": "收到"}, MagicMock()))
    assert ret.data == tell_user.SENT
    events = _events(bridge)
    assert [e["kind"] for e in events] == ["tell_user"]
    assert (events[0]["message"], events[0]["absoluteTurnIndex"]) == ("收到", 7)


# ---------------- the real engine (JC 2026-11-03: the tripwire) ----------------
#
# The tool lives in the runner, not in GA's files (ticket 137's design), so
# nothing in GA keeps it on the list. These run the shipped payload's own
# `agentmain` (its `run()`, `agent_runner_loop`, `NativeToolClient`,
# `next_llm` → `load_tool_schema()`) in a child process, with a fake backend
# that records the tool list of every request it is asked to send. If GA
# changes how it reloads its tool list or how `run()` hands it to the loop,
# the first test goes red before `tell_user` can quietly drop off the list
# (docs/ga-baseline.md, contract item 22: run these first on a baseline
# upgrade).

def _engine_probe(
    env: dict[str, str], script: list[dict[str, Any]], reload_between: bool
) -> dict[str, Any]:
    repo = Path(__file__).resolve().parents[2]
    ga = repo / "managed-ga" / "code"
    probe = r'''
import json, os, sys, threading, time
REPO, GA, SCRIPT, RELOAD = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4] == "1"
sys.dont_write_bytecode = True
sys.path[:0] = [REPO, GA, os.path.join(GA, "frontends")]
# The runner venv has no `requests` / `urllib3`; nothing here goes on the
# network, so stubs do (as test_managed_ga_llmcore.py stubs them).
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
from io import StringIO
from runner.workbench_bridge import Bridge
from runner.ipc import UserMessageCommand

seen = []

class Backend:
    model = "fake-model"
    context_win = 100000
    def __init__(self, name):
        self.name, self.history, self.system = name, [], ""
    def ask(self, msg):
        tools = [t.get("function", {}).get("name") for t in (getattr(self, "tools", None) or [])]
        seen.append({"backend": self.name, "tools": tools})
        n = len(seen) - 1
        reply = SCRIPT[n] if n < len(SCRIPT) else {"text": "<summary>done</summary>\\nok"}
        yield reply["text"]
        self.history.append(msg)
        calls = ([llmcore.MockToolCall(reply["tool"][0], reply["tool"][1], id="call_%d" % n)]
                 if reply.get("tool") else [])
        return llmcore.MockResponse("", reply["text"], calls, reply["text"])

agent = agentmain.GeneraticAgent()
clients = [llmcore.NativeToolClient(Backend("a")), llmcore.NativeToolClient(Backend("b"))]
agent.llmclients, agent._llm_config_keys = clients, ["native_a", "native_b"]
agent.llm_no, agent.llmclient = 0, clients[0]
agent._mykeys_updated_at = store.snapshot()[1]
agent.verbose = True
agent.inc_out = True
bridge = Bridge(ga_path=GA, session_id="s1", cwd=None, llm_no=0, llm_name=None,
                stdout=StringIO(), stdin=StringIO())
bridge.agent, bridge.agentmain, bridge._btw_handler = agent, agentmain, None
bridge._install_handler_subclass()
bridge._register_turn_end_hook()
threading.Thread(target=agent.run, daemon=True).start()
events = []

def run(text, base):
    bridge.dispatch_command(UserMessageCommand(text=text, absoluteTurnIndex=base))
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            line = bridge.event_queue.get(timeout=0.5)
        except Exception:
            continue
        event = json.loads(line)
        events.append(event)
        if event["kind"] == "run_complete":
            break
    while agent.is_running and time.time() < deadline:
        time.sleep(0.05)

names = lambda: [t.get("function", {}).get("name") for t in agentmain.TOOLS_SCHEMA]
run("first", 0)
before = agentmain.TOOLS_SCHEMA
reloaded_without = None
if RELOAD:
    agent.next_llm(1)  # GA's model switch: load_tool_schema() rebinds the list
    reloaded_without = (agentmain.TOOLS_SCHEMA is not before) and "tell_user" not in names()
run("second", 5)
print(json.dumps({"seen": seen, "reloaded_without": reloaded_without,
                  "told": [e for e in events if e["kind"] == "tell_user"],
                  "kinds": [e["kind"] for e in events]}, ensure_ascii=False))
'''
    with tempfile.TemporaryDirectory() as state:
        full_env = {
            k: v for k, v in os.environ.items() if not k.startswith(("GALLEY", "GA_"))
        }
        full_env.update(env, GALLEY_GA_STATE_ROOT=state, GA_LANG="en", PYTHONDONTWRITEBYTECODE="1")
        proc = subprocess.run(
            [
                sys.executable, "-B", "-c", probe, str(repo), str(ga), json.dumps(script),
                "1" if reload_between else "0",
            ],
            capture_output=True, text=True, env=full_env, cwd=state, timeout=120,
        )
    assert proc.returncode == 0, proc.stderr[-3000:]
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    return cast("dict[str, Any]", out)


def test_tell_user_survives_gas_tool_list_reload() -> None:
    """The managed main chat: every request GA's loop sends carries
    `tell_user` — the first run's two (a line told, then the reply), and,
    after GA's own model switch reloaded its tool list without it, the
    next run's — and the line reaches Core."""
    out = _engine_probe(
        {"GALLEY_RUNTIME_KIND": "managed", MAIN_CHAT_ENV: "1"},
        [
            {
                "text": "<summary>tell them</summary>",
                "tool": ["tell_user", {"message": "记上了，天气还在查"}],
            },
            {"text": "<summary>answer</summary>\n好了。"},
            {"text": "<summary>answer</summary>\n第二轮。"},
        ],
        reload_between=True,
    )
    assert out["reloaded_without"] is True, (
        "GA's next_llm no longer reloads its tool list: re-audit item 22"
    )
    seen = out["seen"]
    assert [s["backend"] for s in seen] == ["a", "a", "b"], seen
    for request in seen:
        assert request["tools"].count("tell_user") == 1, request
        assert "ask_user" in request["tools"], request
    told = [(t["message"], t["turnIndex"], t["index"]) for t in out["told"]]
    assert told == [("记上了，天气还在查", 1, 1)]
    assert out["kinds"].count("run_complete") == 2


@pytest.mark.parametrize(
    "env",
    [
        {"GALLEY_RUNTIME_KIND": "managed"},  # a workbench session, a subtask, IM
        {MAIN_CHAT_ENV: "1"},  # attach mode: the flag alone changes nothing
    ],
    ids=["workbench", "attach"],
)
def test_tell_user_never_reaches_a_request_elsewhere(env: dict[str, str]) -> None:
    out = _engine_probe(
        env,
        [
            {"text": "<summary>answer</summary>\n好。"},
            {"text": "<summary>answer</summary>\n再好。"},
        ],
        reload_between=True,
    )
    assert len(out["seen"]) == 2
    for request in out["seen"]:
        assert "tell_user" not in request["tools"], request
        assert "ask_user" in request["tools"], request
    assert out["told"] == []
