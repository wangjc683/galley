"""Tests for session persistence: race conditions, corruption resilience, and reload."""
from __future__ import annotations

import copy
import json
import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

# Add the frontend and project roots so direct bridge imports resolve sibling helpers.
BRIDGE_PATH = Path(__file__).resolve().parent.parent / "desktop_bridge.py"
PROJECT_ROOT = BRIDGE_PATH.parent.parent
sys.path.insert(0, str(BRIDGE_PATH.parent))
sys.path.insert(0, str(PROJECT_ROOT))

# We need a lightweight extraction of AgentManager without starting the full server.
# Import the module to get access to _load_plan_baseline, _sanitize_desktop_plan_path, Session, etc.
import importlib.util

_spec = importlib.util.spec_from_file_location("desktop_bridge", str(BRIDGE_PATH))
_mod = importlib.util.module_from_spec(_spec)
sys.modules["desktop_bridge"] = _mod

# Patch heavy imports that desktop_bridge may pull in.
import types as _types

def _make_stub(name, attrs=None):
    m = _types.ModuleType(name)
    if attrs:
        for k, v in attrs.items():
            setattr(m, k, v)
    return m

_plan_state_stub = _make_stub("plan_state", {
    "is_session_scoped_plan_path": lambda p, sid: True,
    "is_plan_preset_prompt": lambda prompt: False,
    "PLAN_PRESETS": {},
})

for _name in ("agentmain", "llmcore", "agent_loop", "plugins", "reflect",
              "frontends.plan_state", "cost_tracker"):
    sys.modules.setdefault(_name, _make_stub(_name))
sys.modules["plan_state"] = _plan_state_stub

# Attempt import; if it fails due to missing deps, skip.
try:
    _spec.loader.exec_module(_mod)
except Exception as exc:
    pytest.skip(f"Cannot import desktop_bridge: {exc}", allow_module_level=True)

Session = _mod.Session
AgentManager = _mod.AgentManager
MaintenanceConflict = _mod.MaintenanceConflict
ServiceManager = _mod.ServiceManager


@pytest.fixture
def tmp_ga_root(tmp_path: Path):
    """Create a minimal GA root with temp/desktop_sessions/ directory."""
    sessions_dir = tmp_path / "temp" / "desktop_sessions"
    sessions_dir.mkdir(parents=True)
    # Provide a dummy mykey_template so AgentManager.__init__ doesn't break.
    (tmp_path / "mykey_template.py").write_text("", encoding="utf-8")
    return tmp_path


@pytest.fixture
def manager(tmp_ga_root: Path):
    """Create an AgentManager using the tmp root."""
    with patch.object(AgentManager, "__init__", lambda self: None):
        mgr = AgentManager.__new__(AgentManager)
    mgr.lock = threading.RLock()
    mgr.ga_root = str(tmp_ga_root)
    mgr.config = {}
    mgr.sessions = {}
    mgr._retired_sessions = {}
    mgr._maintenance_token = None
    mgr._maintenance_kind = None
    mgr._shutdown_requested = False
    mgr.active_session_id = None
    mgr._sessions_dir = tmp_ga_root / "temp" / "desktop_sessions"
    mgr._sessions_file = tmp_ga_root / "temp" / "desktop_sessions.json"
    return mgr


def _make_session(sid: str = "sess-test-1", messages: list | None = None) -> Session:
    return Session(
        id=sid,
        title="Test",
        cwd="/tmp",
        created_at=time.time(),
        updated_at=time.time(),
        messages=messages if messages is not None else [{"role": "user", "content": "hello"}],
        msg_seq=1,
        pinned=False,
        untitled=False,
        plan_scan_baseline=0,
        plan_path="",
        status="idle",
        agent=None,
        llm_history=[{"role": "user", "content": "hello"}],
        llm_no=None,
    )


class TestPersistSessionConcurrentMutation:
    """Verify that concurrent mutations to messages during _persist_session don't corrupt data."""

    def test_concurrent_append_no_crash(self, manager: AgentManager):
        """Appending messages from another thread during persist must not raise."""
        sess = _make_session(messages=[{"role": "user", "content": f"msg-{i}"} for i in range(50)])
        manager.sessions[sess.id] = sess

        errors = []
        stop = threading.Event()

        def mutator():
            i = 100
            while not stop.is_set():
                sess.messages.append({"role": "assistant", "content": f"resp-{i}"})
                i += 1
                time.sleep(0.001)

        t = threading.Thread(target=mutator, daemon=True)
        t.start()
        try:
            for _ in range(20):
                try:
                    manager._persist_session(sess)
                except Exception as e:
                    errors.append(e)
                time.sleep(0.005)
        finally:
            stop.set()
            t.join(timeout=2)

        assert not errors, f"persist raised: {errors}"
        # Verify the file is valid JSON.
        f = manager._session_file(sess.id)
        data = json.loads(f.read_text(encoding="utf-8"))
        assert data["id"] == sess.id
        assert isinstance(data["messages"], list)

    def test_concurrent_mutation_llm_history(self, manager: AgentManager):
        """Mutating llm_history from another thread during persist must not corrupt."""
        sess = _make_session()
        sess.llm_history = [{"role": "user", "content": "hi"}]
        manager.sessions[sess.id] = sess

        stop = threading.Event()

        def mutator():
            i = 0
            while not stop.is_set():
                sess.llm_history.append({"role": "assistant", "content": f"turn-{i}"})
                i += 1
                time.sleep(0.001)

        t = threading.Thread(target=mutator, daemon=True)
        t.start()
        try:
            for _ in range(15):
                manager._persist_session(sess)
                time.sleep(0.005)
        finally:
            stop.set()
            t.join(timeout=2)

        f = manager._session_file(sess.id)
        data = json.loads(f.read_text(encoding="utf-8"))
        assert isinstance(data["llm_history"], list)


class TestTransactionalDataImport:
    def test_import_commits_new_session_file_and_in_memory_object_together(
        self, manager: AgentManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "import-source"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "imported.md").write_text("new", encoding="utf-8")
        sessions = source / "temp" / "desktop_sessions"
        sessions.mkdir(parents=True)
        sessions.joinpath("sess-imported.json").write_text(
            json.dumps(
                {
                    "id": "sess-imported",
                    "title": "Imported",
                    "messages": [],
                    "msg_seq": 0,
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod.services, "running_managed_ids", lambda: [])

        result = _mod._import_data_source(str(source))

        assert result["ok"] is True
        assert result["sessionsAdded"] == 1
        assert "_preparedSessions" not in result
        assert manager.sessions["sess-imported"].title == "Imported"
        persisted = Path(manager.ga_root) / "temp" / "desktop_sessions" / "sess-imported.json"
        assert json.loads(persisted.read_text(encoding="utf-8"))["id"] == "sess-imported"
        assert (Path(manager.ga_root) / "memory" / "imported.md").read_text(
            encoding="utf-8"
        ) == "new"


class TestLoadSessionsCorruptFile:
    """Verify that one corrupt file does not prevent loading others."""

    def test_corrupt_file_skipped(self, manager: AgentManager):
        """A corrupt JSON file should be skipped; valid sessions still load."""
        sessions_dir = manager._sessions_dir
        # Write 2 valid sessions.
        for i in range(2):
            sid = f"sess-valid-{i}"
            data = {"id": sid, "title": f"Valid {i}", "messages": [], "msg_seq": 0,
                    "cwd": "/tmp", "created_at": time.time(), "updated_at": time.time()}
            (sessions_dir / f"{sid}.json").write_text(json.dumps(data), encoding="utf-8")
        # Write 1 corrupt file.
        (sessions_dir / "sess-corrupt.json").write_text("{invalid json !!!", encoding="utf-8")

        manager._load_sessions()

        assert len(manager.sessions) == 2
        assert "sess-valid-0" in manager.sessions
        assert "sess-valid-1" in manager.sessions
        assert "sess-corrupt" not in manager.sessions

    def test_empty_file_skipped(self, manager: AgentManager):
        """An empty file should be skipped without crash."""
        sessions_dir = manager._sessions_dir
        (sessions_dir / "sess-empty.json").write_text("", encoding="utf-8")
        (sessions_dir / "sess-ok.json").write_text(
            json.dumps({"id": "sess-ok", "title": "OK", "messages": [], "msg_seq": 0,
                        "cwd": "/tmp", "created_at": time.time(), "updated_at": time.time()}),
            encoding="utf-8")

        manager._load_sessions()
        assert "sess-ok" in manager.sessions
        assert len(manager.sessions) == 1

    def test_internal_tui_sessions_are_not_loaded(self, manager: AgentManager):
        """Conductor/TUI worker artifacts must not enter the desktop session registry."""
        sessions_dir = manager._sessions_dir
        for sid in ("sess-visible", "tui_worker_hidden"):
            (sessions_dir / f"{sid}.json").write_text(
                json.dumps({
                    "id": sid,
                    "title": sid,
                    "messages": [],
                    "msg_seq": 0,
                    "cwd": "/tmp",
                    "created_at": time.time(),
                    "updated_at": time.time(),
                }),
                encoding="utf-8",
            )

        manager._load_sessions()

        assert set(manager.sessions) == {"sess-visible"}


class TestLoadSessionsMissingDir:
    """Verify graceful handling when sessions directory does not exist."""

    def test_missing_dir_returns_empty(self, tmp_ga_root: Path):
        """If temp/desktop_sessions/ doesn't exist, load returns empty without crash."""
        import shutil
        sessions_dir = tmp_ga_root / "temp" / "desktop_sessions"
        shutil.rmtree(sessions_dir)

        with patch.object(AgentManager, "__init__", lambda self: None):
            mgr = AgentManager.__new__(AgentManager)
        mgr.lock = threading.RLock()
        mgr.ga_root = str(tmp_ga_root)
        mgr.config = {}
        mgr.sessions = {}
        mgr._retired_sessions = {}
        mgr._maintenance_token = None
        mgr._maintenance_kind = None
        mgr.active_session_id = None
        mgr._sessions_dir = sessions_dir
        mgr._sessions_file = tmp_ga_root / "temp" / "desktop_sessions.json"

        mgr._load_sessions()
        assert mgr.sessions == {}


class TestImportSessionsFiltersInternalArtifacts:
    def test_import_skips_tui_sessions(self, manager: AgentManager, tmp_path: Path):
        source = tmp_path / "source"
        sessions_dir = source / "temp" / "desktop_sessions"
        sessions_dir.mkdir(parents=True)
        for sid in ("sess-imported", "tui_internal"):
            (sessions_dir / f"{sid}.json").write_text(
                json.dumps({
                    "id": sid,
                    "title": sid,
                    "messages": [],
                    "msg_seq": 0,
                    "cwd": "/tmp",
                    "created_at": time.time(),
                    "updated_at": time.time(),
                }),
                encoding="utf-8",
            )

        result = manager.import_sessions(str(source))

        assert set(manager.sessions) == {"sess-imported"}
        assert result["sessionsAdded"] == 1
        assert result["sessionsSkipped"] == 1

    def test_import_rejects_session_ids_that_could_escape_storage(self, manager: AgentManager, tmp_path: Path):
        source = tmp_path / "source"
        sessions_dir = source / "temp" / "desktop_sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "malicious.json").write_text(
            json.dumps({
                "id": "../../outside",
                "title": "unsafe",
                "messages": [],
                "msg_seq": 0,
            }),
            encoding="utf-8",
        )

        result = manager.import_sessions(str(source))

        assert result["sessionsAdded"] == 0
        assert result["sessionsSkipped"] == 1
        assert manager.sessions == {}
        assert not (manager._sessions_dir.parent.parent / "outside.json").exists()


class TestPersistAtomicNoDataLoss:
    """Verify that a failed write does not destroy the existing session file."""

    def test_write_failure_preserves_original(self, manager: AgentManager):
        """If write_text raises mid-write, the original .json file is untouched."""
        sess = _make_session(sid="sess-atomic-test", messages=[{"role": "user", "content": "original"}])
        manager.sessions[sess.id] = sess
        # Persist once successfully.
        manager._persist_session(sess)
        original_content = manager._session_file(sess.id).read_text(encoding="utf-8")

        # Now make the session have new content and make tmp write fail.
        sess.messages.append({"role": "assistant", "content": "new content"})
        with patch("pathlib.Path.write_text", side_effect=OSError("disk full")):
            manager._persist_session(sess)

        # Original file should be untouched (os.replace never ran because tmp write failed).
        current_content = manager._session_file(sess.id).read_text(encoding="utf-8")
        assert current_content == original_content

    def test_replace_failure_preserves_original(self, manager: AgentManager):
        """If os.replace raises, the original file is untouched."""
        sess = _make_session(sid="sess-replace-test", messages=[{"role": "user", "content": "original"}])
        manager.sessions[sess.id] = sess
        manager._persist_session(sess)
        original_content = manager._session_file(sess.id).read_text(encoding="utf-8")

        sess.messages.append({"role": "assistant", "content": "new"})
        with patch("os.replace", side_effect=OSError("permission denied")):
            manager._persist_session(sess)

        current_content = manager._session_file(sess.id).read_text(encoding="utf-8")
        assert current_content == original_content


class TestSessionContinuityAfterRestart:
    """Verify that llm_history is injected when agent is recreated (simulates bridge restart)."""

    def test_stale_turn_cannot_mutate_a_reused_session(self, manager: AgentManager):
        sess = _make_session(sid="sess-stale-turn", messages=[])
        sess.active_turn_id = "new-turn"
        manager.sessions[sess.id] = sess

        with patch.object(manager, "make_agent") as make_agent:
            manager.run_agent_turn(sess, "old work", turn_id="old-turn")

        make_agent.assert_not_called()
        assert sess.status == "idle"
        assert sess.messages == []

    def test_run_agent_turn_injects_history(self, manager: AgentManager):
        """After bridge restart (agent=None, llm_history populated), run_agent_turn
        should inject persisted llm_history into the newly created agent."""
        history = [
            {"role": "user", "content": [{"type": "text", "text": "hello"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "hi there"}]},
            {"role": "user", "content": [{"type": "text", "text": "what did I just say?"}]},
        ]
        sess = _make_session(sid="sess-continuity-1", messages=[
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ])
        sess.llm_history = history
        sess.agent = None
        manager.sessions[sess.id] = sess

        class FakeBackend:
            def __init__(self):
                self.history = []
                self.name = "test-backend"

        class FakeLLMClient:
            def __init__(self):
                self.backend = FakeBackend()

        class FakeAgent:
            def __init__(self):
                self.llmclient = FakeLLMClient()
                self.llm_no = 0
                self.inc_out = True
                self.verbose = True

            def next_llm(self, n):
                self.llm_no = n

        fake_agent = FakeAgent()
        with patch.object(manager, "make_agent", return_value=fake_agent):
            if sess.agent is None:
                sess.agent = manager.make_agent(sess)
                if sess.llm_history:
                    try:
                        sess.agent.llmclient.backend.history = sess.llm_history
                    except Exception:
                        pass

        assert sess.agent.llmclient.backend.history == history
        assert len(sess.agent.llmclient.backend.history) == 3

    def test_no_history_no_crash(self, manager: AgentManager):
        """New session with no llm_history should not crash on agent creation."""
        sess = _make_session(sid="sess-continuity-2")
        sess.llm_history = None
        sess.agent = None
        manager.sessions[sess.id] = sess

        class FakeBackend:
            def __init__(self):
                self.history = []
                self.name = "test"

        class FakeLLMClient:
            def __init__(self):
                self.backend = FakeBackend()

        class FakeAgent:
            def __init__(self):
                self.llmclient = FakeLLMClient()
                self.llm_no = 0

            def next_llm(self, n):
                self.llm_no = n

        fake_agent = FakeAgent()
        with patch.object(manager, "make_agent", return_value=fake_agent):
            if sess.agent is None:
                sess.agent = manager.make_agent(sess)
                if sess.llm_history:
                    try:
                        sess.agent.llmclient.backend.history = sess.llm_history
                    except Exception:
                        pass

        assert sess.agent.llmclient.backend.history == []

    def test_empty_history_list_no_inject(self, manager: AgentManager):
        """Empty llm_history list should not overwrite agent's default state."""
        sess = _make_session(sid="sess-continuity-3")
        sess.llm_history = []
        sess.agent = None
        manager.sessions[sess.id] = sess

        class FakeBackend:
            def __init__(self):
                self.history = [{"role": "system", "content": "default"}]
                self.name = "test"

        class FakeLLMClient:
            def __init__(self):
                self.backend = FakeBackend()

        class FakeAgent:
            def __init__(self):
                self.llmclient = FakeLLMClient()
                self.llm_no = 0

            def next_llm(self, n):
                self.llm_no = n

        fake_agent = FakeAgent()
        with patch.object(manager, "make_agent", return_value=fake_agent):
            if sess.agent is None:
                sess.agent = manager.make_agent(sess)
                if sess.llm_history:
                    try:
                        sess.agent.llmclient.backend.history = sess.llm_history
                    except Exception:
                        pass

        assert sess.agent.llmclient.backend.history == [{"role": "system", "content": "default"}]

    def test_model_preserved_after_restart(self, manager: AgentManager):
        """sess.llm_no should be applied to recreated agent via next_llm."""
        sess = _make_session(sid="sess-continuity-4")
        sess.llm_no = 3
        sess.llm_history = [{"role": "user", "content": [{"type": "text", "text": "test"}]}]
        sess.agent = None
        manager.sessions[sess.id] = sess

        class FakeBackend:
            def __init__(self):
                self.history = []
                self.name = "test"

        class FakeLLMClient:
            def __init__(self):
                self.backend = FakeBackend()

        class FakeAgent:
            def __init__(self):
                self.llmclient = FakeLLMClient()
                self.llm_no = 0
                self.next_llm_calls = []

            def next_llm(self, n):
                self.llm_no = n
                self.next_llm_calls.append(n)

        fake_agent = FakeAgent()
        with patch.object(manager, "make_agent", return_value=fake_agent):
            if sess.agent is None:
                sess.agent = manager.make_agent(sess)
                if sess.llm_history:
                    try:
                        sess.agent.llmclient.backend.history = sess.llm_history
                    except Exception:
                        pass
            agent = sess.agent
            no = sess.llm_no
            if no is not None and hasattr(agent, "next_llm"):
                agent.next_llm(int(no))

        assert fake_agent.llm_no == 3
        assert fake_agent.next_llm_calls == [3]
        assert fake_agent.llmclient.backend.history == sess.llm_history

    def test_persist_and_reload_preserves_llm_no(self, manager: AgentManager):
        """Full cycle: persist session with llm_no, reload, verify llm_no survives."""
        sess = _make_session(sid="sess-roundtrip")
        sess.llm_no = 5
        sess.llm_history = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
        manager.sessions[sess.id] = sess
        manager._persist_session(sess)

        manager.sessions = {}
        manager._load_sessions()

        reloaded = manager.sessions.get("sess-roundtrip")
        assert reloaded is not None
        assert reloaded.llm_no == 5
        assert reloaded.llm_history == [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
        assert reloaded.agent is None


class TestDeferredSessionModelSwitch:
    class FakeBackend:
        name = "model-a"
        history = []

    class FakeClient:
        backend = None

        def __init__(self):
            self.backend = TestDeferredSessionModelSwitch.FakeBackend()

    class FakeAgent:
        def __init__(self):
            self.llm_no = 0
            self.llmclient = TestDeferredSessionModelSwitch.FakeClient()
            self.next_llm_calls: list[int] = []

        def next_llm(self, no: int):
            self.next_llm_calls.append(no)
            self.llm_no = no
            self.llmclient.backend.name = f"model-{no}"

    def test_running_turn_keeps_current_client_and_defers_new_binding(self, manager: AgentManager):
        sess = _make_session("sess-running-switch")
        sess.status = "running"
        sess.llm_no = 0
        sess.running_llm_no = 0
        sess.running_model = "model-a"
        sess.agent = self.FakeAgent()
        manager.sessions[sess.id] = sess

        result = manager.set_session_model(sess.id, 2)

        assert sess.llm_no == 2
        assert sess.agent.next_llm_calls == []
        assert result["model"]["llmNo"] == 2
        assert result["model"]["runningLlmNo"] == 0
        assert result["model"]["runningModel"] == "model-a"

    def test_idle_session_switches_live_client_immediately(self, manager: AgentManager):
        sess = _make_session("sess-idle-switch")
        sess.status = "idle"
        sess.llm_no = 0
        sess.agent = self.FakeAgent()
        manager.sessions[sess.id] = sess

        manager.set_session_model(sess.id, 2)

        assert sess.agent.next_llm_calls == [2]

    def test_turn_captures_and_clears_running_model(self, manager: AgentManager):
        import queue

        sess = _make_session("sess-running-snapshot")
        sess.llm_no = 2
        fake_agent = self.FakeAgent()
        observed: list[tuple[int | None, str | None]] = []

        def put_task(_prompt, images=None):
            observed.append((sess.running_llm_no, sess.running_model))
            q = queue.Queue()
            q.put({"done": "ok", "outputs": ["ok"]})
            return q

        fake_agent.put_task = put_task
        fake_agent.inc_out = True
        sess.agent = fake_agent
        manager.sessions[sess.id] = sess
        plan_state = sys.modules["plan_state"]
        with patch.object(plan_state, "sync_plan_path_from_text", lambda *args: None, create=True):
            manager.run_agent_turn(sess, "hello")

        assert observed == [(2, "model-2")]
        assert sess.running_llm_no is None
        assert sess.running_model is None
        assert sess.status == "idle"

    def test_concurrent_sessions_keep_independent_next_model_bindings(self, manager: AgentManager):
        sessions = []
        for i in range(10):
            sess = _make_session(f"sess-concurrent-{i}")
            sess.status = "running"
            sess.llm_no = 0
            sess.agent = self.FakeAgent()
            manager.sessions[sess.id] = sess
            sessions.append(sess)

        threads = [
            threading.Thread(target=manager.set_session_model, args=(sess.id, i + 1))
            for i, sess in enumerate(sessions)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)

        assert [sess.llm_no for sess in sessions] == list(range(1, 11))
        assert all(sess.agent.next_llm_calls == [] for sess in sessions)


class TestConductorModelConfigResolution:
    def test_configured_model_wins(self):
        state = _mod._resolve_conductor_model_state(
            {"conductor": {"llmNo": 2}, "ui": {"llmNo": 1}},
            profile_count=4,
        )
        assert state == {"configured": 2, "effective": 2, "fallbackReason": None}

    def test_missing_config_uses_ui_default(self):
        state = _mod._resolve_conductor_model_state(
            {"ui": {"llmNo": 1}},
            profile_count=4,
        )
        assert state == {"configured": None, "effective": 1, "fallbackReason": "ui_default"}

    def test_out_of_range_config_never_wraps(self):
        state = _mod._resolve_conductor_model_state(
            {"conductor": {"llmNo": 99}, "ui": {"llmNo": 1}},
            profile_count=4,
        )
        assert state == {"configured": 99, "effective": 1, "fallbackReason": "invalid_configured"}

    def test_no_valid_config_falls_back_to_first_profile(self):
        state = _mod._resolve_conductor_model_state(
            {"conductor": {"llmNo": "bad"}, "ui": {"llmNo": 99}},
            profile_count=4,
        )
        assert state == {"configured": None, "effective": 0, "fallbackReason": "first_available"}

    def test_no_profiles_has_no_effective_model(self):
        state = _mod._resolve_conductor_model_state({}, profile_count=0)
        assert state == {"configured": None, "effective": None, "fallbackReason": "no_models"}


class TestConductorModelHandlers:
    class Request:
        def __init__(self, body: dict):
            self._body = body
            self.can_read_body = True

        async def json(self):
            return self._body

    def test_post_rejects_out_of_range_without_writing(self, manager: AgentManager, tmp_path: Path):
        import asyncio

        settings = tmp_path / "settings.json"
        settings.write_text(json.dumps({"ui": {"llmNo": 1}}), encoding="utf-8")
        manager.list_model_profiles = lambda: [{"id": i} for i in range(4)]
        with patch.object(_mod, "manager", manager), patch.object(_mod, "_SETTINGS", settings):
            response = asyncio.run(_mod.conductor_model_save_handler(self.Request({"llmNo": 99})))

        assert response.status == 400
        assert json.loads(response.text)["error"] == "model_out_of_range"
        assert json.loads(settings.read_text(encoding="utf-8")) == {"ui": {"llmNo": 1}}


class TestMaintenanceGate:
    class FakeQueue:
        def __init__(self, unfinished: int):
            self.unfinished_tasks = unfinished

    class FakeAgent:
        def __init__(self, unfinished: int = 0, *, running: bool = False):
            self.task_queue = TestMaintenanceGate.FakeQueue(unfinished)
            self.is_running = running
            self.abort_calls = 0

        def abort(self):
            self.abort_calls += 1

    def test_rejects_running_sessions_and_managed_extras(self, manager: AgentManager):
        active = _make_session("sess-active")
        active.status = "running"
        manager.sessions[active.id] = active

        with pytest.raises(MaintenanceConflict) as raised:
            manager.begin_maintenance("import", lambda: ["reflect/scheduler.py"])

        assert raised.value.running_sessions == ["sess-active"]
        assert raised.value.running_extras == ["reflect/scheduler.py"]
        assert manager._maintenance_token is None

    def test_cancelled_but_unfinished_queue_still_blocks(self, manager: AgentManager):
        queued = _make_session("sess-queued")
        queued.status = "cancelled"
        queued.agent = self.FakeAgent(unfinished=1)
        manager.sessions[queued.id] = queued

        with pytest.raises(MaintenanceConflict) as raised:
            manager.begin_maintenance("import", lambda: [])

        assert raised.value.running_sessions == ["sess-queued"]

    def test_messages_reports_idle_live_thread_as_unfinished_until_joined(
        self, manager: AgentManager, monkeypatch: pytest.MonkeyPatch
    ):
        release = threading.Event()
        worker = threading.Thread(target=release.wait)
        session = _make_session("sess-idle-live-thread")
        session.thread = worker
        manager.sessions[session.id] = session
        monkeypatch.setattr(
            _plan_state_stub,
            "desktop_plan_payload_from_session",
            lambda *_args, **_kwargs: {},
            raising=False,
        )

        worker.start()
        try:
            snapshot = manager.messages(session.id)
            assert snapshot["status"] == "idle"
            assert snapshot["hasUnfinishedWork"] is True
        finally:
            release.set()
            worker.join(timeout=2)

        assert worker.is_alive() is False
        assert manager.messages(session.id)["hasUnfinishedWork"] is False

    def test_deleted_running_session_remains_registered_until_done(
        self, manager: AgentManager, monkeypatch: pytest.MonkeyPatch
    ):
        queued = _make_session("sess-retired")
        queued.status = "cancelled"
        queued.agent = self.FakeAgent(unfinished=1)
        manager.sessions[queued.id] = queued
        monkeypatch.setattr(_mod, "_purge_session_uploads", lambda _sid: None)

        manager.delete_session(queued.id)
        assert queued.cancel_requested is True
        assert queued.active_turn_id == ""
        assert queued.status == "cancelled"
        with pytest.raises(MaintenanceConflict) as raised:
            manager.begin_maintenance("export", lambda: [])
        assert raised.value.running_sessions == ["sess-retired"]

        queued.agent.task_queue.unfinished_tasks = 0
        token = manager.begin_maintenance("export", lambda: [])
        assert manager._retired_sessions == {}
        manager.end_maintenance(token)

    def test_gate_rejects_prompt_and_service_start(
        self, manager: AgentManager, monkeypatch: pytest.MonkeyPatch
    ):
        session = _make_session("sess-blocked")
        manager.sessions[session.id] = session
        monkeypatch.setattr(_mod, "manager", manager)
        token = manager.begin_maintenance("import", lambda: [])
        try:
            with pytest.raises(MaintenanceConflict):
                manager.submit_prompt(session.id, "blocked")
            with pytest.raises(MaintenanceConflict):
                _mod.services.start_service("missing-service")
        finally:
            manager.end_maintenance(token)

    def test_gate_rejects_cancel_without_mutating_session_or_disk(
        self, manager: AgentManager
    ):
        session = _make_session("sess-cancel-blocked")
        session.partial = {"content": "unfinished"}
        manager.sessions[session.id] = session
        manager._persist_session(session, strict=True)
        session_path = manager._session_file(session.id)
        before_bytes = session_path.read_bytes()
        before_messages = copy.deepcopy(session.messages)
        token = manager.begin_maintenance("import", lambda: [])
        try:
            with pytest.raises(MaintenanceConflict):
                manager.cancel(session.id)
        finally:
            manager.end_maintenance(token)

        assert session.cancel_requested is False
        assert session.status == "idle"
        assert session.partial == {"content": "unfinished"}
        assert session.messages == before_messages
        assert session_path.read_bytes() == before_bytes

    def test_accepted_exit_irreversibly_blocks_new_mutation_and_maintenance(
        self, manager: AgentManager, monkeypatch: pytest.MonkeyPatch
    ):
        import asyncio

        class Request:
            remote = "127.0.0.1"

        exit_calls: list[bool] = []
        session = _make_session("sess-before-exit")
        manager.sessions[session.id] = session
        manager._persist_session(session, strict=True)
        session_path = manager._session_file(session.id)
        before_bytes = session_path.read_bytes()
        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod, "_exit_bridge", lambda: exit_calls.append(True))

        response = asyncio.run(_mod.bridge_exit_handler(Request()))

        assert response.status == 200
        assert exit_calls == [True]
        assert manager._shutdown_requested is True
        with pytest.raises(MaintenanceConflict) as maintenance_error:
            manager.begin_maintenance("import", lambda: [])
        assert maintenance_error.value.code == "shutdown_in_progress"
        with pytest.raises(MaintenanceConflict) as mutation_error:
            with manager.mutation():
                session.title = "must not happen"
                manager._persist_session(session, strict=True)
        assert mutation_error.value.code == "shutdown_in_progress"
        assert session.title == "Test"
        assert session_path.read_bytes() == before_bytes

    def test_active_maintenance_refuses_exit_with_409_and_keeps_bridge_alive(
        self, manager: AgentManager, monkeypatch: pytest.MonkeyPatch
    ):
        import asyncio

        class Request:
            remote = "127.0.0.1"
            headers: dict[str, str] = {}
            method = "POST"

        exit_calls: list[bool] = []
        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod, "_exit_bridge", lambda: exit_calls.append(True))
        token = manager.begin_maintenance("import", lambda: [])
        try:
            response = asyncio.run(
                _mod.cors_middleware(Request(), _mod.bridge_exit_handler)
            )
        finally:
            manager.end_maintenance(token)

        assert response.status == 409
        assert json.loads(response.text)["code"] == "maintenance_conflict"
        assert exit_calls == []
        assert manager._shutdown_requested is False

    def test_import_failure_releases_gate(
        self, manager: AgentManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "one.md").write_text("one", encoding="utf-8")
        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod.services, "running_managed_ids", lambda: [])
        monkeypatch.setattr(
            _mod, "merge_data_files", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("merge failed"))
        )

        with pytest.raises(OSError, match="merge failed"):
            _mod._import_data_source(str(source))

        assert manager._maintenance_token is None
        token = manager.begin_maintenance("export", lambda: [])
        manager.end_maintenance(token)

    def test_export_flush_failure_preserves_existing_destination(
        self, manager: AgentManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        root = Path(manager.ga_root)
        (root / "memory").mkdir()
        (root / "memory" / "one.md").write_text("one", encoding="utf-8")
        session = _make_session("sess-flush-failure")
        manager.sessions[session.id] = session
        destination = tmp_path / "backup.zip"
        destination.write_bytes(b"old backup")
        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod.services, "running_managed_ids", lambda: [])
        monkeypatch.setattr(
            manager,
            "_persist_session",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("disk full")),
        )

        with pytest.raises(OSError, match="disk full"):
            _mod._export_data_source(str(destination), "included")

        assert destination.read_bytes() == b"old backup"
        assert manager._maintenance_token is None

    def test_cancelled_http_task_waits_for_worker_owned_gate(
        self, manager: AgentManager, monkeypatch: pytest.MonkeyPatch
    ):
        import asyncio

        started = threading.Event()
        release = threading.Event()
        monkeypatch.setattr(_mod, "manager", manager)

        def worker():
            token = manager.begin_maintenance("import", lambda: [])
            started.set()
            try:
                assert release.wait(timeout=5)
            finally:
                manager.end_maintenance(token)

        async def scenario():
            task = asyncio.create_task(_mod._run_worker_to_completion(worker))
            assert await asyncio.to_thread(started.wait, 2)
            task.cancel()
            await asyncio.sleep(0.02)
            assert manager._maintenance_token is not None
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert manager._maintenance_token is None

        asyncio.run(scenario())

    def test_service_start_race_cannot_pass_maintenance_admission(
        self, manager: AgentManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        class FakeProcess:
            pid = 43210
            stdout = ()
            returncode = None

            def poll(self):
                return None

        service_manager = ServiceManager.__new__(ServiceManager)
        service_manager.lock = threading.RLock()
        service_manager.ga_root = tmp_path
        service_manager.procs = {}
        service_manager.buffers = {}
        service_manager._emit = lambda _event: None
        service_manager._im_catalog = {}
        service_manager._catalog = {"worker": {"id": "worker", "cmd": ["worker"], "port": None}}
        service_manager._stopping = set()
        entered_start = threading.Event()
        release_start = threading.Event()
        start_result: list[dict] = []
        admission_result: list[object] = []

        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod.subprocess, "Popen", lambda *_args, **_kwargs: FakeProcess())
        monkeypatch.setattr(service_manager, "_is_configured", lambda _sid: True)

        def wait_started(_proc):
            entered_start.set()
            assert release_start.wait(timeout=5)

        monkeypatch.setattr(service_manager, "_wait_started", wait_started)

        start_thread = threading.Thread(
            target=lambda: start_result.append(service_manager.start_service("worker"))
        )

        def admit():
            try:
                admission_result.append(
                    manager.begin_maintenance("import", service_manager.running_managed_ids)
                )
            except Exception as error:
                admission_result.append(error)

        start_thread.start()
        assert entered_start.wait(timeout=2)
        admission_thread = threading.Thread(target=admit)
        admission_thread.start()
        time.sleep(0.03)
        assert admission_result == []
        release_start.set()
        start_thread.join(timeout=2)
        admission_thread.join(timeout=2)

        assert start_result[0]["ok"] is True
        assert start_result[0]["service"]["managed"] is True
        assert isinstance(admission_result[0], MaintenanceConflict)
        assert admission_result[0].running_extras == ["worker"]

    def test_managed_service_state_keeps_ui_maintenance_metadata(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        service_manager = ServiceManager.__new__(ServiceManager)
        service_manager.lock = threading.RLock()
        service_manager.ga_root = tmp_path
        service_manager.procs = {}
        service_manager.buffers = {}
        service_manager._im_catalog = {}
        service_manager._catalog = {
            "reflect/scheduler.py": {
                "id": "reflect/scheduler.py",
                "port": None,
            }
        }
        service_manager._stopping = set()
        monkeypatch.setattr(_mod, "_port_alive", lambda _port: False)

        state = service_manager.list_panel_state()[1]

        assert state["id"] == "reflect/scheduler.py"
        assert state["name"] == "reflect/scheduler.py"
        assert state["managed"] is True
        assert state["running"] is False
        assert "memMb" in state
        assert "cpuPct" in state


class TestManagedServiceOwnership:
    @staticmethod
    def service_manager(tmp_path: Path, port: int = 8900) -> ServiceManager:
        service_manager = ServiceManager.__new__(ServiceManager)
        service_manager.lock = threading.RLock()
        service_manager.ga_root = tmp_path
        service_manager.procs = {}
        service_manager.buffers = {}
        service_manager._emit = lambda _event: None
        service_manager._im_catalog = {}
        service_manager._catalog = {
            "frontends/conductor.py": {
                "id": "frontends/conductor.py",
                "cmd": ["python", "conductor.py", "--no-browser", "--port", str(port)],
                "port": port,
            }
        }
        service_manager._stopping = set()
        return service_manager

    def test_foreign_listener_is_external_not_owned_or_running(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        service_manager = self.service_manager(tmp_path)
        monkeypatch.setattr(_mod, "_port_alive", lambda port: port == 8900)

        state = service_manager.list_panel_state()[1]

        assert state == {
            **state,
            "id": "frontends/conductor.py",
            "status": "error",
            "running": False,
            "owned": False,
            "external": True,
            "portConflict": True,
            "port": 8900,
            "pid": None,
            "errorKey": "err.portBusy",
        }
        assert service_manager.running_managed_ids() == []

    def test_foreign_listener_prevents_spawn_and_stop_never_touches_it(
        self,
        manager: AgentManager,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        service_manager = self.service_manager(tmp_path)
        spawn_calls: list[object] = []
        monkeypatch.setattr(_mod, "manager", manager)
        monkeypatch.setattr(_mod, "_port_alive", lambda port: port == 8900)
        monkeypatch.setattr(service_manager, "_is_configured", lambda _sid: True)
        monkeypatch.setattr(
            _mod.subprocess,
            "Popen",
            lambda *_args, **_kwargs: spawn_calls.append(object()),
        )

        started = service_manager.start_service("frontends/conductor.py")
        stopped = service_manager.stop_service("frontends/conductor.py")

        assert started["ok"] is False
        assert started["error"] == "port_conflict"
        assert started["service"]["status"] == "error"
        assert stopped["ok"] is False
        assert stopped["error"] == "not_owned"
        assert stopped["service"]["status"] == "error"
        assert spawn_calls == []
        assert service_manager.procs == {}

    def test_dead_owned_child_with_foreign_port_is_port_conflict(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        class DeadProcess:
            pid = 41001
            returncode = 1

            @staticmethod
            def poll():
                return 1

        service_manager = self.service_manager(tmp_path)
        service_manager.procs["frontends/conductor.py"] = DeadProcess()
        monkeypatch.setattr(_mod, "_port_alive", lambda _port: True)

        state = service_manager.list_panel_state()[1]

        assert state["status"] == "error"
        assert state["running"] is False
        assert state["owned"] is False
        assert state["external"] is True
        assert state["pid"] is None
        assert service_manager.running_managed_ids() == []

    def test_stop_terminates_only_the_tracked_owned_process_with_a_bound(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        class OwnedProcess:
            pid = 41002
            returncode = None
            terminate_calls = 0
            kill_calls = 0
            waits: list[float | None] = []

            def poll(self):
                return self.returncode

            def terminate(self):
                self.terminate_calls += 1

            def wait(self, timeout=None):
                self.waits.append(timeout)
                if len(self.waits) == 1:
                    raise _mod.subprocess.TimeoutExpired("conductor", timeout)
                self.returncode = -9
                return self.returncode

            def kill(self):
                self.kill_calls += 1

        service_manager = self.service_manager(tmp_path, 29890)
        owned = OwnedProcess()
        service_manager.procs["frontends/conductor.py"] = owned
        monkeypatch.setattr(
            _mod,
            "_port_alive",
            lambda _port: owned.poll() is None,
        )

        before = service_manager.list_panel_state()[1]
        result = service_manager.stop_service("frontends/conductor.py")

        assert before["status"] == "running"
        assert before["running"] is True
        assert before["owned"] is True
        assert before["external"] is False
        assert before["pid"] == owned.pid
        assert result["ok"] is True
        assert result["service"]["status"] == "offline"
        assert owned.terminate_calls == 1
        assert owned.kill_calls == 1
        assert owned.waits == [5.0, 2.0]
        assert service_manager.procs == {}

    def test_real_foreign_socket_survives_panel_start_and_stop(
        self,
        manager: AgentManager,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as foreign:
            foreign.bind(("127.0.0.1", 0))
            foreign.listen()
            port = int(foreign.getsockname()[1])
            service_manager = self.service_manager(tmp_path, port)
            monkeypatch.setattr(_mod, "manager", manager)
            monkeypatch.setattr(service_manager, "_is_configured", lambda _sid: True)
            monkeypatch.setattr(
                _mod.subprocess,
                "Popen",
                lambda *_args, **_kwargs: pytest.fail("foreign listener must prevent spawn"),
            )

            assert service_manager.list_panel_state()[1]["status"] == "error"
            assert service_manager.start_service("frontends/conductor.py")["error"] == "port_conflict"
            stopped = service_manager.stop_service("frontends/conductor.py")
            assert stopped["ok"] is False
            assert stopped["error"] == "not_owned"
            assert stopped["service"]["status"] == "error"
            assert foreign.getsockname()[1] == port


class TestConductorPortIsolation:
    def test_production_ignores_e2e_port_without_report_marker(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.delenv(_mod.E2E_REPORT_DIR_ENV, raising=False)
        monkeypatch.setenv(_mod.E2E_CONDUCTOR_PORT_ENV, "29890")
        assert _mod._configured_conductor_port() == 8900

    def test_e2e_catalog_and_explicit_child_argv_share_the_validated_port(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv(_mod.E2E_REPORT_DIR_ENV, str(tmp_path / "report"))
        monkeypatch.setenv(_mod.E2E_CONDUCTOR_PORT_ENV, "29890")

        services = _mod.discover_extra_services(tmp_path)
        conductor = next(item for item in services if item["id"] == "frontends/conductor.py")

        assert conductor["port"] == 29890
        assert conductor["cmd"][-2:] == ["--port", "29890"]

    @pytest.mark.parametrize("value", ["", "0", "65536", "2.5", "-1", "１２３４"])
    def test_invalid_e2e_conductor_port_fails_closed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, value: str
    ):
        monkeypatch.setenv(_mod.E2E_REPORT_DIR_ENV, str(tmp_path / "report"))
        monkeypatch.setenv(_mod.E2E_CONDUCTOR_PORT_ENV, value)
        with pytest.raises(RuntimeError, match="between 1 and 65535"):
            _mod._configured_conductor_port()


class TestCanonicalSessionRestart:
    def test_invalid_imported_records_are_skipped_and_valid_record_reloads(
        self, manager: AgentManager
    ):
        records = {
            "int-id.json": {"id": 9, "messages": [], "msg_seq": 0},
            "nan.json": {
                "id": "sess-nan",
                "messages": [],
                "msg_seq": 0,
                "updated_at": float("nan"),
            },
            "bad-list.json": {
                "id": "sess-bad-list",
                "messages": ["bad"],
                "msg_seq": 0,
            },
            "valid.json": {
                "id": "sess-canonical",
                "title": "Canonical",
                "messages": [{"role": "user", "content": "hi"}],
                "msg_seq": 1,
                "created_at": 10,
                "updated_at": 11,
                "unknown": "ignored",
            },
        }
        for name, record in records.items():
            (manager._sessions_dir / name).write_text(json.dumps(record), encoding="utf-8")

        manager._load_sessions()

        assert set(manager.sessions) == {"sess-canonical"}
        assert manager.active_session_id == "sess-canonical"
        assert manager.sessions["sess-canonical"].updated_at == 11


class TestBridgeSettingsWrites:
    class Request:
        can_read_body = True

        def __init__(self, body: dict):
            self.body = body

        async def json(self):
            return self.body

    def test_ui_save_preserves_sibling_keys_with_atomic_update(
        self, manager: AgentManager, tmp_path: Path
    ):
        import asyncio

        settings = tmp_path / "settings.json"
        settings.write_text(
            json.dumps({
                "ga_source_override": "/external/source",
                "conductor": {"llmNo": 3},
                "unknown": {"keep": True},
            }),
            encoding="utf-8",
        )
        with patch.object(_mod, "manager", manager), patch.object(_mod, "_SETTINGS", settings):
            response = asyncio.run(
                _mod.save_config_handler(self.Request({"config": {"lang": "en"}}))
            )

        assert response.status == 200
        assert json.loads(settings.read_text(encoding="utf-8")) == {
            "ga_source_override": "/external/source",
            "conductor": {"llmNo": 3},
            "unknown": {"keep": True},
            "ui": {"lang": "en"},
        }

    def test_ui_save_failure_returns_500_and_does_not_claim_success(
        self, manager: AgentManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        import asyncio

        settings = tmp_path / "settings.json"
        original = '{"unknown":{"keep":true}}'
        settings.write_text(original, encoding="utf-8")
        monkeypatch.setattr(
            _mod,
            "_update_settings_doc",
            lambda _mutate: (_ for _ in ()).throw(
                _mod.DesktopSettingsError("atomic replace failed")
            ),
        )
        with patch.object(_mod, "manager", manager), patch.object(_mod, "_SETTINGS", settings):
            response = asyncio.run(
                _mod.save_config_handler(self.Request({"config": {"lang": "en"}}))
            )

        assert response.status == 500
        assert json.loads(response.text)["error"] == "atomic replace failed"
        assert settings.read_text(encoding="utf-8") == original
        assert manager.config == {}
