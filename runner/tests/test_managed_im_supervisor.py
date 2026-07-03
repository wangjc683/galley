from __future__ import annotations

import io
import json
import os
import sys
from argparse import Namespace
from pathlib import Path
from typing import Any

import pytest

from runner import managed_im_supervisor, managed_runtime


def _write_fake_fsapp(ga_path: Path, body: str) -> None:
    frontends = ga_path / "frontends"
    frontends.mkdir(parents=True)
    (frontends / "__init__.py").write_text("", encoding="utf-8")
    (frontends / "fsapp.py").write_text(body, encoding="utf-8")


def _args(ga_path: Path, state_dir: Path) -> Namespace:
    return Namespace(
        platform="feishu",
        ga_path=str(ga_path),
        state_dir=str(state_dir),
        sop_path=str(state_dir / "sop.md"),
        relogin=False,
    )


def _restore_stdio(stdout: Any, stderr: Any, real_stdout: Any, real_stderr: Any) -> None:
    sys.stdout = stdout
    sys.stderr = stderr
    sys.__dict__["__stdout__"] = real_stdout
    sys.__dict__["__stderr__"] = real_stderr


def _clear_frontends_modules() -> None:
    sys.modules.pop("frontends.fsapp", None)
    sys.modules.pop("frontends", None)


class _BrokenPipeOut(io.StringIO):
    def write(self, _s: str) -> int:
        raise BrokenPipeError()


def test_emit_broken_pipe_exits_parentless(monkeypatch: Any) -> None:
    class ExitCalledError(Exception):
        pass

    codes: list[int] = []

    def fake_exit(code: int) -> None:
        codes.append(code)
        raise ExitCalledError()

    monkeypatch.setattr(managed_im_supervisor, "_EXIT_FOR_PARENT_LOSS", fake_exit)

    with pytest.raises(ExitCalledError):
        managed_im_supervisor._emit(_BrokenPipeOut(), platform="feishu", state="running")

    assert codes == [0]


def test_parent_watchdog_detects_missing_parent(monkeypatch: Any) -> None:
    monkeypatch.setattr(managed_im_supervisor, "_parent_process_alive", lambda _pid: False)

    reason = managed_im_supervisor._parent_loss_reason(parent_pid=12345, original_ppid=100)

    assert reason == "Galley Core process 12345 disappeared"


def test_parent_watchdog_detects_ppid_change(monkeypatch: Any) -> None:
    monkeypatch.setattr(managed_im_supervisor, "_parent_process_alive", lambda _pid: True)
    monkeypatch.setattr(os, "getppid", lambda: 321)

    reason = managed_im_supervisor._parent_loss_reason(parent_pid=123, original_ppid=100)

    assert reason == "parent process changed from 100 to 321"


def test_run_feishu_reports_existing_supervisor_lock(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    held_lock = managed_im_supervisor._SupervisorLock(
        state_dir / managed_im_supervisor.IM_SUPERVISOR_LOCK_NAME
    )
    assert held_lock.acquire()
    out = io.StringIO()
    try:
        code = managed_im_supervisor._run_feishu(_args(tmp_path / "ga", state_dir), out)
    finally:
        held_lock.close()

    assert code == 1
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert events[-1]["state"] == "error"
    assert "already running" in events[-1]["lastError"]
    assert events[-1]["logPath"].endswith("feishu.log")


def test_run_feishu_injects_config_temp_dir_and_prompt(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_fsapp(
        ga_path,
        """
import json
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(PROJECT_ROOT)
IMPORTED_CWD = os.getcwd()

class Agent:
    verbose = True

agent = Agent()

def get_agent():
    return agent

def check_config(init_agent=False):
    cfg = json.loads(os.environ["GALLEY_FEISHU_CONFIG_JSON"])
    assert cfg["fs_app_id"] == "cli_test"
    assert cfg["fs_app_secret"] == "secret"
    assert cfg["fs_allowed_users"] == []
    assert os.environ["GALLEY_FEISHU_TEMP_DIR"].endswith("temp")
    assert os.environ["GA_WORKSPACE_ROOT"].endswith("state")
    assert os.environ["GA_USER_DATA_DIR"].endswith(os.path.join("state", "ga_config"))
    return {"ready": True, "app_id": cfg["fs_app_id"]}

def main():
    assert IMPORTED_CWD.endswith("ga")
    assert os.getcwd() == os.environ["GA_WORKSPACE_ROOT"]
    managed = get_agent()
    assert managed.prompt_installed
    assert managed.verbose is False
    GALLEY_STATUS_HOOK("running")
    GALLEY_STATUS_HOOK("reconnecting", "offline")
    GALLEY_STATUS_HOOK("running")
    raise KeyboardInterrupt()
""",
    )
    monkeypatch.setenv(
        "GALLEY_FEISHU_CONFIG_JSON",
        json.dumps(
            {
                "fs_app_id": "cli_test",
                "fs_app_secret": "secret",
                "fs_allowed_users": [],
            }
        ),
    )
    monkeypatch.setattr(
        managed_runtime,
        "install_managed_mykey_loader",
        lambda: None,
    )
    monkeypatch.setattr(
        managed_runtime,
        "managed_state_root",
        lambda: None,
    )

    def install_prompt(agent: Any, extra_env_names: tuple[str, ...]) -> None:
        assert managed_im_supervisor.IM_SUPERVISOR_PROMPT_ENV in extra_env_names
        agent.prompt_installed = True

    monkeypatch.setattr(
        managed_runtime,
        "install_managed_prompt_profile",
        install_prompt,
    )
    _clear_frontends_modules()
    out = io.StringIO()
    stdout, stderr, real_stdout, real_stderr = (
        sys.stdout,
        sys.stderr,
        sys.__stdout__,
        sys.__stderr__,
    )
    cwd = os.getcwd()
    try:
        code = managed_im_supervisor._run_feishu(_args(ga_path, state_dir), out)
    finally:
        os.chdir(cwd)
        _restore_stdio(stdout, stderr, real_stdout, real_stderr)
        _clear_frontends_modules()

    assert code == 0
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert [event["state"] for event in events] == [
        "starting",
        "running",
        "reconnecting",
        "running",
        "stopped",
    ]
    assert events[1]["platform"] == "feishu"
    assert events[2]["lastError"] == "offline"


def test_run_feishu_forwards_owner_binding_event(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """Extra keyword fields on the status hook (the Feishu owner-binding
    event) must pass through to the JSON status line — Galley Core reads
    ownerOpenId from it to persist the paired owner."""
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_fsapp(
        ga_path,
        """
class Agent:
    verbose = True

agent = Agent()

def get_agent():
    return agent

def check_config(init_agent=False):
    return {"ready": True}

def main():
    GALLEY_STATUS_HOOK("running")
    GALLEY_STATUS_HOOK("running", None, ownerOpenId="ou_test_owner")
    raise KeyboardInterrupt()
""",
    )
    monkeypatch.setattr(managed_runtime, "install_managed_mykey_loader", lambda: None)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)
    monkeypatch.setattr(
        managed_runtime,
        "install_managed_prompt_profile",
        lambda agent, extra_env_names: None,
    )
    _clear_frontends_modules()
    out = io.StringIO()
    stdout, stderr, real_stdout, real_stderr = (
        sys.stdout,
        sys.stderr,
        sys.__stdout__,
        sys.__stderr__,
    )
    cwd = os.getcwd()
    try:
        code = managed_im_supervisor._run_feishu(_args(ga_path, state_dir), out)
    finally:
        os.chdir(cwd)
        _restore_stdio(stdout, stderr, real_stdout, real_stderr)
        _clear_frontends_modules()

    assert code == 0
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    bound = [event for event in events if "ownerOpenId" in event]
    assert len(bound) == 1
    assert bound[0]["ownerOpenId"] == "ou_test_owner"
    assert bound[0]["state"] == "running"
    assert bound[0]["platform"] == "feishu"


def test_run_feishu_reports_missing_config(monkeypatch: Any, tmp_path: Path) -> None:
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_fsapp(
        ga_path,
        """
def get_agent():
    raise AssertionError("agent should not initialize")

def check_config(init_agent=False):
    return {"ready": False, "app_id": ""}

def main():
    raise AssertionError("main should not run")
""",
    )
    monkeypatch.setattr(
        managed_runtime,
        "install_managed_mykey_loader",
        lambda: None,
    )
    monkeypatch.setattr(
        managed_runtime,
        "managed_state_root",
        lambda: None,
    )
    _clear_frontends_modules()
    out = io.StringIO()
    stdout, stderr, real_stdout, real_stderr = (
        sys.stdout,
        sys.stderr,
        sys.__stdout__,
        sys.__stderr__,
    )
    cwd = os.getcwd()
    try:
        code = managed_im_supervisor._run_feishu(_args(ga_path, state_dir), out)
    finally:
        os.chdir(cwd)
        _restore_stdio(stdout, stderr, real_stdout, real_stderr)
        _clear_frontends_modules()

    assert code == 1
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert events[-1]["state"] == "error"
    assert "App ID and App Secret" in events[-1]["lastError"]


def test_run_feishu_reports_malformed_managed_config_without_mykey_fallback(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    marker = tmp_path / "mykey-executed"
    (ga_path / "mykey.py").parent.mkdir(parents=True, exist_ok=True)
    (ga_path / "mykey.py").write_text(
        f"from pathlib import Path\nPath({str(marker)!r}).write_text('ran')\n",
        encoding="utf-8",
    )
    _write_fake_fsapp(
        ga_path,
        """
import json
import os

raw = os.environ.get("GALLEY_FEISHU_CONFIG_JSON")
if raw is not None:
    try:
        data = json.loads(raw)
    except Exception as exc:
        raise RuntimeError(f"load Galley Feishu config failed: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("Galley Feishu config must be a JSON object")

def get_agent():
    raise AssertionError("agent should not initialize")

def check_config(init_agent=False):
    raise AssertionError("config check should not run")

def main():
    raise AssertionError("main should not run")
""",
    )
    monkeypatch.setenv("GALLEY_FEISHU_CONFIG_JSON", "{")
    monkeypatch.setattr(managed_runtime, "install_managed_mykey_loader", lambda: None)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)
    _clear_frontends_modules()
    out = io.StringIO()
    stdout, stderr, real_stdout, real_stderr = (
        sys.stdout,
        sys.stderr,
        sys.__stdout__,
        sys.__stderr__,
    )
    cwd = os.getcwd()
    try:
        code = managed_im_supervisor._run_feishu(_args(ga_path, state_dir), out)
    finally:
        os.chdir(cwd)
        _restore_stdio(stdout, stderr, real_stdout, real_stderr)
        _clear_frontends_modules()

    assert code == 1
    assert not marker.exists()
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert events[-1]["state"] == "error"
    assert "load Galley Feishu config failed" in events[-1]["lastError"]
