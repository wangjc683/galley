"""Runtime model-routing tests for the isolated Conductor process."""
from __future__ import annotations

import importlib.util
import argparse
import os
import queue
import sys
import threading
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent.parent
CONDUCTOR_PATH = ROOT / "frontends" / "conductor.py"


class StubGenericAgent:
    pass


agentmain_stub = types.ModuleType("agentmain")
agentmain_stub.GenericAgent = StubGenericAgent
previous_agentmain = sys.modules.get("agentmain")
sys.modules["agentmain"] = agentmain_stub

spec = importlib.util.spec_from_file_location("conductor_model_under_test", CONDUCTOR_PATH)
conductor = importlib.util.module_from_spec(spec)
assert spec.loader is not None
_argv = sys.argv
try:
    sys.argv = [str(CONDUCTOR_PATH), "--no-browser"]
    spec.loader.exec_module(conductor)
finally:
    sys.argv = _argv
if previous_agentmain is None:
    del sys.modules["agentmain"]
else:
    sys.modules["agentmain"] = previous_agentmain


class Backend:
    def __init__(self, name: str):
        self.name = name
        self.model = name


class Client:
    def __init__(self, name: str | None):
        if name is not None:
            self.backend = Backend(name)


class FakeAgent:
    def __init__(self, names: list[str | None], failing: set[int] | None = None):
        self.llmclients = [Client(name) for name in names]
        self.llm_no = 0
        self.llmclient = self.llmclients[0]
        self.next_llm_calls: list[int] = []
        self.reloads = 0
        self.failing = failing or set()
        self.task_queue = queue.Queue()

    def load_llm_sessions(self):
        self.reloads += 1

    def next_llm(self, no: int):
        # Deliberately mirrors GenericAgent's modulo behavior. The Conductor
        # resolver must validate before calling this method.
        self.next_llm_calls.append(no)
        if no in self.failing:
            raise RuntimeError("broken client")
        self.llm_no = no % len(self.llmclients)
        self.llmclient = self.llmclients[self.llm_no]

    def get_llm_name(self, client=None, model=False):
        client = client or self.llmclient
        return client.backend.model if model else client.backend.name



def test_conductor_default_port_override_is_e2e_scoped(monkeypatch):
    monkeypatch.delenv(conductor.E2E_REPORT_DIR_ENV, raising=False)
    monkeypatch.setenv(conductor.E2E_CONDUCTOR_PORT_ENV, "29890")
    assert conductor._default_conductor_port() == 8900

    monkeypatch.setenv(conductor.E2E_REPORT_DIR_ENV, "/tmp/package-evidence")
    assert conductor._default_conductor_port() == 29890


@pytest.mark.parametrize("value", ["1", "8900", "65535"])
def test_conductor_port_parser_accepts_full_valid_range(value):
    assert conductor._parse_conductor_port(value) == int(value)


@pytest.mark.parametrize("value", ["", "0", "65536", "2.5", "-1", "１２３４"])
def test_conductor_port_parser_rejects_invalid_values(value):
    with pytest.raises(argparse.ArgumentTypeError, match="between 1 and 65535"):
        conductor._parse_conductor_port(value)





def test_explicit_numeric_worker_model_rejects_out_of_range():
    agent = FakeAgent(["zero", "one"])

    with pytest.raises(ValueError, match="out of range"):
        conductor._select_llm(agent, 99)

    assert agent.next_llm_calls == []





def test_runtime_model_snapshot_is_broadcast_with_running_state(monkeypatch):
    instance = conductor.Conductor()
    instance.agent = FakeAgent(["model-one"])
    payloads: list[dict] = []
    monkeypatch.setattr(conductor, "schedule_broadcast", payloads.append)
    state = {
        "configured": 2,
        "effective": 1,
        "fallbackReason": "configured_unavailable",
        "current": "model-one",
    }

    instance._publish_model_state(state, running=True)

    assert instance.model_snapshot() == {**conductor._runtime_model_state(instance.agent), "running": True}
    assert payloads == [{"type": "model", "model": {**state, "running": True}}]


def test_long_lived_conductor_refreshes_model_between_tasks(monkeypatch):
    """Display completion does not permit switching before task cleanup."""

    class EndOfInbox(Exception):
        pass

    second_boundary_entered = threading.Event()

    class BoundaryInbox:
        def __init__(self):
            self.events = [
                {"type": "user_message", "id": "first"},
                {"type": "user_message", "id": "second"},
            ]

        def get(self):
            if not self.events:
                raise EndOfInbox
            if len(self.events) == 1:
                second_boundary_entered.set()
            return self.events.pop(0)

        def task_done(self):
            pass

        def empty(self):
            # Keep each event as a separate task boundary for this regression.
            return True

    timeline: list[tuple[str, int]] = []
    allow_first_cleanup = threading.Event()
    first_cleanup_done = threading.Event()

    class TaskAgent(FakeAgent):
        def __init__(self):
            super().__init__(["zero", "one", "two"])
            self.inc_out = False
            self.task_models: list[int] = []
            self.task_queue: queue.Queue = queue.Queue()
            self.cleanup_threads: list[threading.Thread] = []

        def next_llm(self, no: int):
            super().next_llm(no)
            timeline.append(("select", self.llm_no))

        def put_task(self, _prompt: str, source: str):
            assert source == "conductor"
            self.task_models.append(self.llm_no)
            timeline.append(("submit", self.llm_no))
            if len(self.task_models) == 1:
                # Display completion precedes task cleanup.
                assert self.llm_no == 1
                self.task_queue.put("first")

                def finish_first_task():
                    assert allow_first_cleanup.wait(timeout=2)
                    assert self.task_queue.get_nowait() == "first"
                    self.task_queue.task_done()
                    first_cleanup_done.set()

                cleanup = threading.Thread(target=finish_first_task)
                cleanup.start()
                self.cleanup_threads.append(cleanup)
            else:
                self.task_queue.put("second")
                assert self.task_queue.get_nowait() == "second"
                self.task_queue.task_done()
            output: queue.Queue = queue.Queue()
            output.put({"done": True, "turn": len(self.task_models)})
            return output

    instance = conductor.Conductor()
    instance.agent = TaskAgent()
    instance.agent.next_llm(1)
    instance.inbox = BoundaryInbox()
    payloads: list[dict] = []
    monkeypatch.setattr(conductor, "schedule_broadcast", payloads.append)
    monkeypatch.setattr(conductor, "start_agent_runner", lambda *_args: None)
    monkeypatch.setattr(conductor.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(instance, "_build_prompt", lambda events: events[0]["id"])

    run_errors: list[BaseException] = []

    def run_loop():
        try:
            instance._run()
        except EndOfInbox:
            pass
        except BaseException as error:  # surfaced below in the test thread
            run_errors.append(error)

    runner = threading.Thread(target=run_loop)
    runner.start()
    assert second_boundary_entered.wait(timeout=2)

    # The display `done` marker has already arrived, but queue cleanup is still
    # blocked.  Model two must not be applied or submitted yet.
    assert instance.agent.task_models == [1]
    assert timeline == [("select", 1), ("submit", 1)]

    with pytest.raises(ValueError, match="busy"):
        instance.select_model(2)
    allow_first_cleanup.set()
    assert first_cleanup_done.wait(timeout=2)
    runner.join(timeout=2)
    for cleanup in instance.agent.cleanup_threads:
        cleanup.join(timeout=2)

    assert not runner.is_alive()
    assert run_errors == []

    assert instance.agent.task_models == [1, 1]
    assert timeline == [
        ("select", 1),
        ("submit", 1),
        ("submit", 1),
    ]
    assert instance.model_snapshot() == {
        "configured": None,
        "effective": 1,
        "fallbackReason": None,
        "current": "one",
        "running": False,
    }
    assert [item["model"]["effective"] for item in payloads] == [1, 1, 1, 1]
    assert [item["model"]["running"] for item in payloads] == [True, False, True, False]


def test_conductor_defers_events_without_models_and_recovers(monkeypatch):
    class EndOfInbox(Exception):
        pass

    ready = {"value": False}

    class BoundaryInbox:
        def __init__(self):
            self.events = [
                {"type": "user_message", "id": "deferred"},
                {"type": "user_message", "id": "recovery"},
            ]

        def get(self):
            if not self.events:
                raise EndOfInbox
            if len(self.events) == 1:
                ready["value"] = True
            return self.events.pop(0)

        def task_done(self):
            pass

        def empty(self):
            return True

    class RecoveringAgent:
        def __init__(self):
            self.inc_out = False
            self.llmclients: list[Client] = []
            self.llm_no = 0
            self.task_queue: queue.Queue = queue.Queue()
            self.submissions: list[str] = []

        def load_llm_sessions(self):
            if ready["value"] and not self.llmclients:
                self.llmclients = [Client("recovered")]
                self.llmclient = self.llmclients[0]

        def next_llm(self, no: int):
            self.llm_no = no
            self.llmclient = self.llmclients[no]

        def get_llm_name(self, client=None, model=False):
            client = client or self.llmclient
            return client.backend.model if model else client.backend.name

        def put_task(self, prompt: str, source: str):
            assert source == "conductor"
            self.submissions.append(prompt)
            output: queue.Queue = queue.Queue()
            output.put({"done": True, "turn": 1})
            return output

    instance = conductor.Conductor()
    instance.agent = RecoveringAgent()
    instance.inbox = BoundaryInbox()
    payloads: list[dict] = []
    monkeypatch.setattr(conductor, "schedule_broadcast", payloads.append)
    monkeypatch.setattr(conductor, "start_agent_runner", lambda *_args: None)
    monkeypatch.setattr(conductor.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(instance, "_build_prompt", lambda events: ",".join(e["id"] for e in events))

    with pytest.raises(EndOfInbox):
        instance._run()

    assert instance.agent.submissions == ["deferred,recovery"]
    model_payloads = [item["model"] for item in payloads if item["type"] == "model"]
    assert model_payloads[0]["effective"] is None
    assert model_payloads[0]["fallbackReason"] == "no_models"
    assert model_payloads[0]["running"] is False
    assert [model["running"] for model in model_payloads[1:]] == [True, False]
    assert any(
        item["item"]["text"].startswith("Conductor paused: no usable model")
        for item in payloads
        if item["type"] == "log"
    )


def test_parallel_worker_model_selection_keeps_agents_isolated():
    from concurrent.futures import ThreadPoolExecutor

    agents = [FakeAgent(["zero", "one", "two", "three"]) for _ in range(10)]
    requested = [i % 4 for i in range(10)]
    with ThreadPoolExecutor(max_workers=10) as executor:
        selected = list(executor.map(
            lambda pair: conductor._select_llm(pair[0], pair[1]),
            zip(agents, requested),
        ))

    assert selected == [True] * 10
    assert [agent.llm_no for agent in agents] == requested
    assert [agent.next_llm_calls for agent in agents] == [[no] for no in requested]


def test_model_selection_is_memory_only_and_survives_refresh(monkeypatch):
    instance = conductor.Conductor()
    instance.agent = FakeAgent(["zero", "one", "two"])
    monkeypatch.setattr(conductor, "schedule_broadcast", lambda _: None)
    def forbidden(*args, **kwargs):
        raise AssertionError("model selection must not access settings files")
    monkeypatch.setattr("builtins.open", forbidden)
    monkeypatch.setattr(Path, "open", forbidden)
    assert instance.select_model(2) == 2
    instance.agent.load_llm_sessions()
    assert instance.model_snapshot()["effective"] == 2
    assert instance.agent.next_llm_calls == [2]
    # A fresh agent uses its own default, not a previously saved selection.
    other = conductor.Conductor()
    other.agent = FakeAgent(["zero", "one", "two"])
    assert other.model_snapshot()["effective"] == 0


@pytest.mark.parametrize("value", [99, -1, True, None, "invalid", 1])
def test_invalid_model_selection_keeps_current_agent(value, monkeypatch):
    instance = conductor.Conductor()
    instance.agent = FakeAgent(["zero", None])
    monkeypatch.setattr(conductor, "schedule_broadcast", lambda _: None)
    with pytest.raises(ValueError):
        instance.select_model(value)
    assert instance.agent.llm_no == 0
    assert instance.agent.next_llm_calls == []


def test_running_model_selection_is_rejected(monkeypatch):
    instance = conductor.Conductor()
    instance.agent = FakeAgent(["zero", "one"])
    instance._model_running = True
    with pytest.raises(ValueError, match="busy"):
        instance.select_model(1)
    assert instance.agent.next_llm_calls == []


def test_actual_generic_agent_next_llm_preserves_history(monkeypatch):
    # Execute the real method with inert clients; no credentials or LLM calls.
    import ast
    tree = ast.parse((ROOT / "agentmain.py").read_text(encoding="utf-8"))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "GenericAgent")
    method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "next_llm")
    namespace = {"load_tool_schema": lambda: None}
    exec(compile(ast.Module(body=[method], type_ignores=[]), "agentmain.py", "exec"), namespace)
    instance = conductor.Conductor()
    instance.agent = FakeAgent(["zero", "one"])
    instance.agent.llmclient.backend.history = [{"role": "user", "content": "history"}]
    history = instance.agent.llmclient.backend.history
    instance.agent.next_llm = types.MethodType(namespace["next_llm"], instance.agent)
    monkeypatch.setattr(conductor, "schedule_broadcast", lambda _: None)
    assert instance.select_model(1) == 1
    assert instance.agent.llmclient is instance.agent.llmclients[1]
    assert instance.agent.llmclient.backend.history is history
    assert instance.agent.llmclient.last_tools == ""


def test_websocket_switch_reconnect_and_busy_error(monkeypatch):
    from fastapi.testclient import TestClient
    instance = conductor.Conductor()
    instance.agent = FakeAgent(["zero", "one"])
    instance.agent.list_llms = lambda: [(i, c.backend.name, i == instance.agent.llm_no)
                                      for i, c in enumerate(instance.agent.llmclients)]
    monkeypatch.setattr(conductor, "conductor", instance)
    monkeypatch.setattr(conductor, "schedule_broadcast", lambda _: None)
    # Do not enter TestClient lifespan: no real runner or IM poller is started.
    client = TestClient(conductor.app)
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["llm"] == 0
        ws.send_json({"llm": 1})
        assert ws.receive_json() == {"type": "model_selected", "llm": 1}
        instance.agent.task_queue.put("running")
        ws.send_json({"llm": 0})
        error = ws.receive_json()
        assert error["type"] == "model_error"
        assert error["llm"] == 1
        instance.agent.task_queue.get_nowait()
        instance.agent.task_queue.task_done()
        ws.send_json({"llm": 99})
        assert ws.receive_json()["type"] == "model_error"
    with client.websocket_connect("/ws") as ws:
        hello = ws.receive_json()
        assert hello["llm"] == hello["model"]["effective"] == 1


def test_conductor_has_no_desktop_settings_dependency():
    source = CONDUCTOR_PATH.read_text(encoding="utf-8")
    for removed in ["desktop_settings", "SETTINGS_PATH", "_apply_desktop_model", "ui_default"]:
        assert removed not in source


def test_start_uses_generic_agent_default_without_files(monkeypatch):
    agent = FakeAgent(["zero", "one"])
    agent.next_llm(1)
    monkeypatch.setattr(conductor, "GenericAgent", lambda: agent)
    monkeypatch.setattr(conductor, "schedule_broadcast", lambda _: None)
    monkeypatch.setattr(conductor.threading.Thread, "start", lambda _: None)
    def forbidden(*args, **kwargs):
        raise AssertionError("startup must not access desktop settings")
    monkeypatch.setattr("builtins.open", forbidden)
    monkeypatch.setattr(Path, "open", forbidden)
    instance = conductor.Conductor()
    instance.start()
    assert instance.agent is agent
    assert instance.model_snapshot()["effective"] == 1
    assert agent.next_llm_calls == [1]
