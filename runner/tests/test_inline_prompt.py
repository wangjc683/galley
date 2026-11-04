"""A wake note over 2,000 characters reaches the model in full (main chat
ticket 147, PRD ruling 198): `GaSession.arm_inline_prompt` and its GA hook,
the bridge's runs, and the shipped engine's loop end to end."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

import runner.ga_session as ga_session
import runner.managed_runtime as managed_runtime
from runner import tell_user
from runner.ga_session import GaSession
from runner.ipc import AbortCommand, AskUserResponseCommand, UserMessageCommand
from runner.workbench_bridge import Bridge

REPO = Path(__file__).resolve().parents[2]
MAIN_CHAT_ENV = tell_user.MAIN_CHAT_ENV

NOTE = (
    "[Galley — not a message from the user] A subtask you started has an update.\n\n"
    + "结果" * 1500
)
POINTER = "Long user prompt saved to /state/temp/user_prompt_1_2.md. Read and execute."


def _smart_format(data: Any, max_str_len: int = 100, omit_str: str = " ... ") -> str:
    """Upstream `ga.smart_format`, as GA's `run()` writes the task's line."""
    text: str = data if isinstance(data, str) else str(data)
    if len(text) < max_str_len + len(omit_str) * 2:
        return text
    return f"{text[: max_str_len // 2]}{omit_str}{text[-max_str_len // 2 :]}"


@pytest.fixture
def hooks(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[Any]]:
    """A stand-in for GA's `plugins.hooks` registry and `ga` module."""
    registry: dict[str, list[Any]] = {}

    def register(event: str) -> Any:
        def decorator(fn: Any) -> Any:
            registry.setdefault(event, []).append(fn)
            return fn

        return decorator

    monkeypatch.setitem(sys.modules, "plugins.hooks", SimpleNamespace(register=register))
    monkeypatch.setitem(sys.modules, "ga", SimpleNamespace(smart_format=_smart_format))
    monkeypatch.setattr(ga_session, "_inline_hook_registered", False)
    return registry


def _round(agent: Any, user_input: str, content: Any = None) -> dict[str, Any]:
    """`agent_runner_loop`'s locals when it triggers `agent_before`."""
    handler = SimpleNamespace(
        parent=agent, history_info=["[USER]: earlier", "[USER]: " + user_input]
    )
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": user_input if content is None else content},
    ]
    return {"handler": handler, "messages": messages, "user_input": user_input}


def _fire(registry: dict[str, list[Any]], ctx: dict[str, Any]) -> None:
    for fn in registry.get("agent_before", []):
        fn(ctx)


def test_the_note_stands_where_the_pointer_stood(hooks: dict[str, list[Any]]) -> None:
    agent = SimpleNamespace()
    assert GaSession(agent).arm_inline_prompt(NOTE) is True
    ctx = _round(agent, POINTER)
    _fire(hooks, ctx)
    assert ctx["messages"][1]["content"] == NOTE
    # The working-memory line is the one GA writes for a task it keeps.
    assert ctx["handler"].history_info == [
        "[USER]: earlier",
        "[USER]: " + _smart_format(NOTE.replace("\n", " "), max_str_len=200),
    ]
    # One run: the next round is upstream's.
    assert agent._galley_inline_prompt is None
    later = _round(agent, POINTER)
    _fire(hooks, later)
    assert later["messages"][1]["content"] == POINTER


def test_what_a_plugin_added_after_the_pointer_stays(hooks: dict[str, list[Any]]) -> None:
    """Upstream's project mode appends its context to the round's message."""
    agent = SimpleNamespace()
    GaSession(agent).arm_inline_prompt(NOTE)
    ctx = _round(agent, POINTER, POINTER + "\n\n---\n[PROJECT MODE: x]")
    _fire(hooks, ctx)
    assert ctx["messages"][1]["content"] == NOTE + "\n\n---\n[PROJECT MODE: x]"


@pytest.mark.parametrize(
    ("user_input", "content"),
    [
        ("a short note GA kept as it was", None),
        (POINTER, [{"type": "text", "text": POINTER}]),
        (POINTER, "something else"),
    ],
    ids=["no-pointer", "content-blocks", "message-not-the-pointer"],
)
def test_anything_else_is_left_as_ga_made_it(
    hooks: dict[str, list[Any]], user_input: str, content: Any
) -> None:
    agent = SimpleNamespace()
    GaSession(agent).arm_inline_prompt(NOTE)
    ctx = _round(agent, user_input, content)
    before = json.dumps(ctx["messages"], ensure_ascii=False)
    _fire(hooks, ctx)
    assert json.dumps(ctx["messages"], ensure_ascii=False) == before
    assert ctx["handler"].history_info[-1] == "[USER]: " + user_input
    assert agent._galley_inline_prompt is None


def test_unarmed_rounds_and_other_agents_are_untouched(hooks: dict[str, list[Any]]) -> None:
    armed, other = SimpleNamespace(), SimpleNamespace()
    session = GaSession(armed)
    session.arm_inline_prompt(NOTE)
    session.arm_inline_prompt(None)  # the bridge clears it for a run that is not a wake
    ctx = _round(armed, POINTER)
    _fire(hooks, ctx)
    assert ctx["messages"][1]["content"] == POINTER
    GaSession(armed).arm_inline_prompt(NOTE)
    ctx = _round(other, POINTER)
    _fire(hooks, ctx)
    assert ctx["messages"][1]["content"] == POINTER
    assert armed._galley_inline_prompt == NOTE


def test_registered_once(hooks: dict[str, list[Any]]) -> None:
    agent = SimpleNamespace()
    for _ in range(3):
        GaSession(agent).arm_inline_prompt(NOTE)
    assert len(hooks["agent_before"]) == 1


def test_without_a_hooks_module_the_task_goes_upstreams_way(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delitem(sys.modules, "plugins.hooks", raising=False)
    monkeypatch.setattr(ga_session, "_inline_hook_registered", False)
    assert GaSession(SimpleNamespace()).arm_inline_prompt(NOTE) is False


# ---------------- the bridge ----------------


class _Agent:
    def put_task(self, text: str, source: str, **_kwargs: Any) -> Any:
        import queue

        return queue.Queue()

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
    bridge.agentmain = SimpleNamespace(TOOLS_SCHEMA=[])
    return bridge


@pytest.fixture
def armed(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    calls: list[Any] = []

    def arm(self: GaSession, text: str | None) -> bool:
        calls.append(text)
        return True

    monkeypatch.setattr(GaSession, "arm_inline_prompt", arm)
    return calls


def test_the_main_chat_arms_a_wake_and_clears_any_other_run(
    monkeypatch: pytest.MonkeyPatch, armed: list[Any]
) -> None:
    monkeypatch.setenv(MAIN_CHAT_ENV, "1")
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)
    bridge = _bridge()
    bridge.dispatch_command(UserMessageCommand(text=NOTE, absoluteTurnIndex=3, wake=True))
    bridge.dispatch_command(AbortCommand())
    bridge.dispatch_command(UserMessageCommand(text="帮我" * 1100, absoluteTurnIndex=5))
    bridge.dispatch_command(AbortCommand())
    bridge.dispatch_command(AskUserResponseCommand(text="上海", absoluteTurnIndex=7))
    assert armed == [NOTE, None, None]


@pytest.mark.parametrize(
    ("flag", "managed"),
    [(None, True), ("0", True), ("1", False)],
    ids=["workbench", "not-the-main-chat", "attach"],
)
def test_nothing_outside_the_managed_main_chat(
    monkeypatch: pytest.MonkeyPatch, armed: list[Any], flag: str | None, managed: bool
) -> None:
    """Workbench sessions, subtasks, IM, attach mode (CLAUDE.md Rule 1)."""
    if flag is None:
        monkeypatch.delenv(MAIN_CHAT_ENV, raising=False)
    else:
        monkeypatch.setenv(MAIN_CHAT_ENV, flag)
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: managed)
    _bridge().dispatch_command(UserMessageCommand(text=NOTE, absoluteTurnIndex=3, wake=True))
    assert armed == []


# ---------------- the shipped engine ----------------
#
# The shipped payload's own `agentmain` (its `run()` that saves a long task
# to a file, `agent_runner_loop` that triggers `agent_before`, `plugins.hooks`)
# in a child process, with a fake backend: what the model's first call and
# the next step's working memory hold.

_PROBE = r'''
import json, os, sys, threading, time
REPO, GA = sys.argv[1], sys.argv[2]
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
from io import StringIO
from runner.workbench_bridge import Bridge
from runner.ipc import UserMessageCommand

seen = []

class Backend:
    model = "fake-model"
    context_win = 100000
    def __init__(self):
        self.name, self.history, self.system = "a", [], ""
    def ask(self, msg):
        n = len(seen)
        seen.append("\n".join(b.get("text", "") for b in msg["content"] if b.get("type") == "text"))
        first = n % 2 == 0
        text = "<summary>看一下</summary>" if first else "<summary>done</summary>\nok"
        yield text
        self.history.append(msg)
        call = llmcore.MockToolCall("file_read", {"path": "notes.md"}, id="call_%d" % n)
        calls = [call] if first else []
        return llmcore.MockResponse("", text, calls, text)

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

NOTE = ("[Galley — not a message from the user] A subtask you started has an update.\n\n"
        + "结果" * 1500)
run(NOTE, 0, True)
run("帮我" * 1100, 2, False)
print(json.dumps({"seen": seen, "note": NOTE}, ensure_ascii=False))
'''


def _engine(env: dict[str, str]) -> dict[str, Any]:
    ga = REPO / "managed-ga" / "code"
    with tempfile.TemporaryDirectory() as state:
        Path(state, "notes.md").write_text("一行\n", encoding="utf-8")
        full_env = {k: v for k, v in os.environ.items() if not k.startswith(("GALLEY", "GA_"))}
        full_env.update(env, GALLEY_GA_STATE_ROOT=state, GA_LANG="en", PYTHONDONTWRITEBYTECODE="1")
        proc = subprocess.run(
            [sys.executable, "-B", "-c", _PROBE, str(REPO), str(ga)],
            capture_output=True,
            text=True,
            env=full_env,
            cwd=state,
            timeout=120,
        )
    assert proc.returncode == 0, proc.stderr[-3000:]
    return cast("dict[str, Any]", json.loads(proc.stdout.strip().splitlines()[-1]))


def test_the_engine_hands_a_woken_main_chat_its_note_in_full() -> None:
    """The managed main chat: Core's note (over 2,000 characters) is the first
    call's message and the next step's working memory holds no pointer to a
    file; the user's own long message keeps upstream's file."""
    out = _engine({"GALLEY_RUNTIME_KIND": "managed", MAIN_CHAT_ENV: "1"})
    woken_first, woken_next, user_first, _ = out["seen"]
    assert woken_first == out["note"]
    assert "Long user prompt saved to" not in woken_next
    assert "[USER]: [Galley — not a message from the user]" in woken_next
    assert user_first.startswith("Long user prompt saved to ")


def test_the_engine_keeps_upstreams_way_in_a_workbench_session() -> None:
    out = _engine({"GALLEY_RUNTIME_KIND": "managed"})
    assert out["seen"][0].startswith("Long user prompt saved to ")
