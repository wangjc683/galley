from __future__ import annotations

import io
import json
import os
import sys
from argparse import Namespace
from pathlib import Path
from typing import Any

import pytest

from runner import _watchdog, im_reporter, managed_im_supervisor, managed_runtime


def _write_fake_fsapp(ga_path: Path, body: str) -> None:
    frontends = ga_path / "frontends"
    frontends.mkdir(parents=True)
    (frontends / "__init__.py").write_text("", encoding="utf-8")
    (frontends / "fsapp.py").write_text(body, encoding="utf-8")


def _write_fake_dcapp(ga_path: Path, body: str) -> None:
    frontends = ga_path / "frontends"
    frontends.mkdir(parents=True, exist_ok=True)
    (frontends / "__init__.py").write_text("", encoding="utf-8")
    (frontends / "dcapp.py").write_text(body, encoding="utf-8")


def _args(ga_path: Path, state_dir: Path, platform: str = "feishu") -> Namespace:
    return Namespace(
        platform=platform,
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
    sys.modules.pop("frontends.dcapp", None)
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

    # _emit routes its broken-pipe exit through the shared watchdog now.
    monkeypatch.setattr(_watchdog, "_EXIT_FOR_PARENT_LOSS", fake_exit)

    with pytest.raises(ExitCalledError):
        managed_im_supervisor._emit(_BrokenPipeOut(), platform="feishu", state="running")

    assert codes == [0]


# Parent-watchdog liveness logic moved to runner/_watchdog.py — covered by
# test_watchdog.py.


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


class _StubReporter:
    """Stands in for the Discord dispatcher: only the attach/detach seam
    the launcher drives from dcapp's hooks matters here."""

    def __init__(self) -> None:
        self.attached: list[str] = []
        self.detached: list[str] = []

    def attach_channel(self, chat_id: str, agent: Any = None) -> str:
        self.attached.append(chat_id)
        return f"galley-im/discord/{chat_id}"

    def detach_channel(self, chat_id: str) -> None:
        self.detached.append(chat_id)


def _run_discord_with_fake_app(
    monkeypatch: Any,
    tmp_path: Path,
    body: str,
) -> tuple[int, list[dict[str, Any]]]:
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_dcapp(ga_path, body)
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
        code = managed_im_supervisor._run_discord(
            _args(ga_path, state_dir, platform="discord"), out
        )
    finally:
        os.chdir(cwd)
        _restore_stdio(stdout, stderr, real_stdout, real_stderr)
        _clear_frontends_modules()
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    return code, events


def test_main_accepts_discord_platform(monkeypatch: Any, tmp_path: Path) -> None:
    seen: list[str] = []

    def fake_run(args: Any, out: Any) -> int:
        seen.append(args.platform)
        return 0

    monkeypatch.setattr(managed_im_supervisor, "_run_discord", fake_run)
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)
    monkeypatch.setattr(_watchdog, "start_parent_watchdog", lambda *a, **kw: None)
    monkeypatch.setattr(managed_im_supervisor, "_capture_real_stdout", io.StringIO)
    argv = [
        "--platform",
        "discord",
        "--ga-path",
        str(tmp_path / "ga"),
        "--state-dir",
        str(tmp_path / "state"),
        "--sop-path",
        str(tmp_path / "sop.md"),
    ]
    assert managed_im_supervisor.main(argv) == 0
    assert seen == ["discord"]
    # Unknown platforms are still rejected by argparse itself.
    with pytest.raises(SystemExit):
        managed_im_supervisor.main([*argv[:1], "slack", *argv[2:]])


def test_run_discord_reports_import_failure(monkeypatch: Any, tmp_path: Path) -> None:
    # dcapp exits with SystemExit when discord.py is missing.
    code, events = _run_discord_with_fake_app(
        monkeypatch,
        tmp_path,
        """
raise SystemExit("Please install discord.py to use Discord")
""",
    )
    assert code == 1
    assert events[-1]["platform"] == "discord"
    assert events[-1]["state"] == "error"
    assert "import failed" in events[-1]["lastError"]
    assert "discord.py" in events[-1]["lastError"]


def test_run_discord_reports_missing_token(monkeypatch: Any, tmp_path: Path) -> None:
    code, events = _run_discord_with_fake_app(
        monkeypatch,
        tmp_path,
        """
def get_app():
    return None

def check_config(init_agent=False):
    return {"ready": False}

def main():
    raise AssertionError("main should not run")
""",
    )
    assert code == 1
    assert events[-1]["state"] == "error"
    assert "Bot Token is required" in events[-1]["lastError"]
    assert events[-1]["logPath"].endswith("discord.log")


def test_run_discord_installs_state_dir_hooks_and_per_channel_identity(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("GALLEY_SUPERVISOR_ID", "galley-im/discord")
    monkeypatch.setenv("GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE", "id: __GALLEY_SUPERVISOR_ID__")
    installed: list[tuple[tuple[str, ...], str | None]] = []

    def install_prompt(
        agent: Any,
        extra_env_names: tuple[str, ...] = (),
        supervisor_id: str | None = None,
    ) -> None:
        installed.append((extra_env_names, supervisor_id))
        agent.prompt_installed = True

    monkeypatch.setattr(managed_runtime, "install_managed_prompt_profile", install_prompt)
    reporter = _StubReporter()
    monkeypatch.setattr(
        im_reporter, "start_discord_reporter", lambda dcapp, state_dir: reporter
    )
    code, events = _run_discord_with_fake_app(
        monkeypatch,
        tmp_path,
        """
import os

class Agent:
    verbose = True

def get_app():
    return None

def check_config(init_agent=False):
    return {"ready": True}

def main():
    assert os.environ["GALLEY_DISCORD_STATE_DIR"].endswith("state")
    assert os.environ["GA_WORKSPACE_ROOT"].endswith("state")
    assert os.getcwd() == os.environ["GA_WORKSPACE_ROOT"]
    agent = Agent()
    GALLEY_AGENT_HOOK(agent, "ch:42")
    assert agent.verbose is False
    assert agent.prompt_installed
    GALLEY_CHANNEL_RELEASED_HOOK("ch:42")
    GALLEY_STATUS_HOOK("running", None, botId="galley#4242")
    GALLEY_STATUS_HOOK("reconnecting", "gateway hiccup")
    raise KeyboardInterrupt()
""",
    )

    assert code == 0
    assert [event["state"] for event in events] == [
        "starting",
        "running",
        "reconnecting",
        "stopped",
    ]
    assert events[1]["botId"] == "galley#4242"
    assert events[1]["logPath"].endswith("discord.log")
    assert events[2]["lastError"] == "gateway hiccup"
    # Per-channel identity is bound onto the agent instance, from the
    # template env — never by rewriting os.environ.
    assert installed == [
        (
            (managed_im_supervisor.IM_SUPERVISOR_PROMPT_TEMPLATE_ENV,),
            "galley-im/discord/ch:42",
        )
    ]
    assert os.environ["GALLEY_SUPERVISOR_ID"] == "galley-im/discord"
    # Reporter routing follows the channel's lifetime.
    assert reporter.attached == ["ch:42"]
    assert reporter.detached == ["ch:42"]


def test_run_discord_falls_back_to_rendered_prompt_without_template(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("GALLEY_SUPERVISOR_ID", "galley-im/discord")
    monkeypatch.delenv("GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE", raising=False)
    installed: list[tuple[str, ...]] = []

    def install_prompt(
        agent: Any,
        extra_env_names: tuple[str, ...] = (),
        supervisor_id: str | None = None,
    ) -> None:
        installed.append(extra_env_names)

    monkeypatch.setattr(managed_runtime, "install_managed_prompt_profile", install_prompt)
    monkeypatch.setattr(
        im_reporter, "start_discord_reporter", lambda dcapp, state_dir: None
    )
    code, _events = _run_discord_with_fake_app(
        monkeypatch,
        tmp_path,
        """
class Agent:
    verbose = True

def get_app():
    return None

def check_config(init_agent=False):
    return {"ready": True}

def main():
    GALLEY_AGENT_HOOK(Agent(), "ch:7")
    # No reporter: the released hook must still be safe to call.
    GALLEY_CHANNEL_RELEASED_HOOK("ch:7")
    raise KeyboardInterrupt()
""",
    )
    assert code == 0
    assert installed == [(managed_im_supervisor.IM_SUPERVISOR_PROMPT_ENV,)]


def test_install_managed_prompt_profile_binds_supervisor_id_per_agent(
    monkeypatch: Any,
) -> None:
    """Discord's per-channel identity binds on the agent instance; the
    process-wide template env stays untouched (no concurrent os.environ
    rewriting), so two channels get two different ids from one template."""

    class _Backend:
        extra_sys_prompt = ""

    class _Client:
        def __init__(self) -> None:
            self.backend = _Backend()

    class _Agent:
        def __init__(self) -> None:
            self.llmclients = [_Client()]

    template = "Your Galley supervisor identity is `__GALLEY_SUPERVISOR_ID__`."
    monkeypatch.setenv(managed_runtime.GALLEY_RUNTIME_PROMPT_TEXT_ENV, "base prompt")
    monkeypatch.setenv(managed_im_supervisor.IM_SUPERVISOR_PROMPT_TEMPLATE_ENV, template)

    installed = []
    for chat_id in ("ch:1", "ch:2"):
        agent = _Agent()
        managed_runtime.install_managed_prompt_profile(
            agent,
            extra_env_names=(managed_im_supervisor.IM_SUPERVISOR_PROMPT_TEMPLATE_ENV,),
            supervisor_id=f"galley-im/discord/{chat_id}",
        )
        installed.append(agent.llmclients[0].backend.extra_sys_prompt)

    assert "base prompt" in installed[0]
    assert "`galley-im/discord/ch:1`" in installed[0]
    assert "`galley-im/discord/ch:2`" in installed[1]
    assert managed_runtime.SUPERVISOR_ID_PLACEHOLDER not in "".join(installed)
    assert os.environ[managed_im_supervisor.IM_SUPERVISOR_PROMPT_TEMPLATE_ENV] == template
    # Callers without a per-agent identity keep the old behavior.
    plain = _Agent()
    managed_runtime.install_managed_prompt_profile(plain)
    assert plain.llmclients[0].backend.extra_sys_prompt.strip() == "base prompt"


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
