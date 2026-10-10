from __future__ import annotations

import io
import json
import logging
import os
import sys
from argparse import Namespace
from pathlib import Path
from typing import Any

import pytest

from runner import _watchdog, im_reporter, im_wechat, managed_im_supervisor, managed_runtime
from runner.tests.test_managed_wechat import load_display


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


def _write_fake_wechatapp(ga_path: Path, body: str) -> None:
    frontends = ga_path / "frontends"
    frontends.mkdir(parents=True, exist_ok=True)
    (frontends / "__init__.py").write_text("", encoding="utf-8")
    (frontends / "wechatapp.py").write_text(body, encoding="utf-8")


def _write_fake_tgapp(ga_path: Path, body: str) -> None:
    frontends = ga_path / "frontends"
    frontends.mkdir(parents=True, exist_ok=True)
    (frontends / "__init__.py").write_text("", encoding="utf-8")
    (frontends / "tgapp.py").write_text(body, encoding="utf-8")


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
    sys.modules.pop("frontends.wechatapp", None)
    sys.modules.pop("frontends.tgapp", None)
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


def test_run_wechat_pins_agent_mode_and_runs_galleys_conversation(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """Upstream wechatapp defaults to forwarding into a detached conductor
    child that has no managed mykey loader and no Galley prompt, so it never
    replies. The supervisor pins the in-process agent mode before the poll
    loop starts, and polls with Galley's conversation (runner/im_wechat.py)
    instead of upstream's on_message: ``/switch`` is refused, a message is a
    GA task answered once, and the completion reporter gets the
    conversation."""
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_wechatapp(
        ga_path,
        """
import queue
import time

_TEMP_DIR = "unset"
_MODE, _cond_seq = "conductor", 0
ITEM_TEXT = 1
SEEN = []


class AuthExpired(Exception):
    pass


class Agent:
    verbose = True
    is_running = False

    def __init__(self):
        self.tasks = []

    def run(self):
        pass

    def put_task(self, query, source="user", images=None):
        dq = queue.Queue()
        dq.put({"done": "你好。", "turn": 1, "outputs": ["你好。"]})
        self.tasks.append((query, source))
        return dq


agent = Agent()


def _dl_media(items):
    return []


def _message(text, context_token):
    item = {"type": ITEM_TEXT, "text_item": {"text": text}}
    return {"from_user_id": "u1", "context_token": context_token, "item_list": [item]}


class WxBotClient:
    bot_id = "bot-test"
    token = "tok"
    sent = []

    def __init__(self, token_file):
        self.token_file = token_file

    def send_text(self, uid, text, context_token=""):
        self.sent.append((uid, text, context_token))

    def get_typing_ticket(self, uid, context_token=""):
        return ""

    def run_loop(self, on_message, poll_timeout=30):
        on_message(self, _message("/switch", "c1"))
        on_message(self, _message("hello", "c2"))
        deadline = time.monotonic() + 5
        while len(self.sent) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        raise KeyboardInterrupt()


def on_message(bot, msg):
    SEEN.append(msg)
""",
    )
    monkeypatch.setattr(managed_runtime, "install_managed_mykey_loader", lambda: None)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)
    monkeypatch.setattr(
        managed_runtime,
        "install_managed_prompt_profile",
        lambda agent, extra_env_names: None,
    )
    monkeypatch.setattr(managed_im_supervisor, "_start_resume", lambda platform, state: None)
    reporters: list[Any] = []
    monkeypatch.setattr(
        im_reporter,
        "start_wechat_reporter",
        lambda conversation, state: reporters.append((conversation, state)),
    )
    load_display(monkeypatch)
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
        code = managed_im_supervisor._run_wechat(
            _args(ga_path, state_dir, platform="wechat"), out
        )
        wechatapp = sys.modules["frontends.wechatapp"]
    finally:
        os.chdir(cwd)
        _restore_stdio(stdout, stderr, real_stdout, real_stderr)
        _clear_frontends_modules()

    assert code == 0
    assert wechatapp._MODE == "agent"
    assert wechatapp.SEEN == []  # upstream's on_message never runs
    assert wechatapp.WxBotClient.sent == [
        ("u1", im_wechat.SWITCH_BLOCKED_REPLY, "c1"),
        ("u1", "你好。", "c2"),
    ]
    assert wechatapp.agent.tasks == [(im_wechat.FILE_HINT + "\n\nhello", "wechat")]
    ((conversation, reporter_state),) = reporters
    assert isinstance(conversation, im_wechat.WechatConversation)
    assert conversation.agent is wechatapp.agent and reporter_state == state_dir.resolve()
    assert conversation.owner_id() == "u1" and not conversation.connected()
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert [event["state"] for event in events] == ["starting", "running", "stopped"]


# ── Credential masking ─────────────────────────────────────────────────

TG_TOKEN = "123456789:AAFakeTelegramTokenForGalleyTestswXyZ"
DC_TOKEN = "MTAfake.discord-token.ForGalleyTestsd1sc"
FS_SECRET = "fakeFeishuAppSecretForTestsf5ec"
WX_TOKEN = "fake-wechat-bot-token-for-tests@im.bot:w3ch"


def _credential_env(monkeypatch: Any) -> None:
    monkeypatch.setenv(
        "GALLEY_TELEGRAM_CONFIG_JSON",
        json.dumps({"tg_bot_token": TG_TOKEN, "tg_allowed_users": []}),
    )
    monkeypatch.setenv(
        "GALLEY_DISCORD_CONFIG_JSON",
        json.dumps({"discord_bot_token": DC_TOKEN, "discord_allowed_users": []}),
    )
    monkeypatch.setenv(
        "GALLEY_FEISHU_CONFIG_JSON",
        json.dumps({"fs_app_id": "cli_test", "fs_app_secret": FS_SECRET}),
    )


@pytest.fixture
def redactor(monkeypatch: Any) -> managed_im_supervisor._SecretRedactor:
    """A fresh process-wide redactor, so no test sees another's secrets."""
    fresh = managed_im_supervisor._SecretRedactor()
    monkeypatch.setattr(managed_im_supervisor, "_REDACTOR", fresh)
    return fresh


def test_redactor_masks_config_env_credentials_keeping_the_last_four(
    monkeypatch: Any, redactor: managed_im_supervisor._SecretRedactor
) -> None:
    _credential_env(monkeypatch)
    # Too short to be a credential: left alone rather than garbling text.
    monkeypatch.setenv("GALLEY_FEISHU_CONFIG_JSON", json.dumps({"fs_app_secret": "short"}))
    redactor.load_env()
    text = f"tg={TG_TOKEN} dc={DC_TOKEN} again {TG_TOKEN} short"
    assert redactor.redact(text) == "tg=…wXyZ dc=…d1sc again …wXyZ short"
    # Malformed or missing config never breaks the channel.
    monkeypatch.setenv("GALLEY_TELEGRAM_CONFIG_JSON", "{")
    monkeypatch.delenv("GALLEY_DISCORD_CONFIG_JSON")
    redactor.load_env()
    assert redactor.redact(text) == text


def test_emit_masks_credentials_in_the_status_line(
    monkeypatch: Any, redactor: managed_im_supervisor._SecretRedactor
) -> None:
    _credential_env(monkeypatch)
    redactor.load_env()
    out = io.StringIO()
    managed_im_supervisor._emit(
        out,
        platform="telegram",
        state="error",
        lastError=(
            f"Telegram bot token rejected: The token `{TG_TOKEN}` was rejected by the server."
        ),
        logPath="/tmp/telegram.log",
    )
    line = out.getvalue()
    assert TG_TOKEN not in line
    event = json.loads(line)
    assert event["lastError"] == (
        "Telegram bot token rejected: The token `…wXyZ` was rejected by the server."
    )
    assert event["logPath"] == "/tmp/telegram.log"


def test_redirect_logs_masks_credentials_before_they_reach_the_log(
    monkeypatch: Any, tmp_path: Path, redactor: managed_im_supervisor._SecretRedactor
) -> None:
    _credential_env(monkeypatch)
    log_path = tmp_path / "state" / "discord.log"
    saved = (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__)
    try:
        writer = managed_im_supervisor._redirect_logs(log_path)
        print(f"polling crashed: {DC_TOKEN}")
        sys.stderr.write(f"Traceback ... {FS_SECRET}\n")
        print(f"[WX] {TG_TOKEN}", file=sys.__stdout__)
        sys.stdout.writelines([f"a {DC_TOKEN}\n", "b\n"])
        assert sys.stdout is sys.stderr is sys.__stdout__ is sys.__stderr__ is writer
        assert writer.isatty() is False
        assert writer.encoding.lower().replace("-", "") == "utf8"
        writer.flush()
    finally:
        _restore_stdio(*saved)
    logged = log_path.read_text(encoding="utf-8")
    for secret in (DC_TOKEN, FS_SECRET, TG_TOKEN):
        assert secret not in logged
    assert logged.splitlines() == [
        "polling crashed: …d1sc",
        "Traceback ... …f5ec",
        "[WX] …wXyZ",
        "a …d1sc",
        "b",
    ]


def test_rebind_logging_streams_moves_handlers_made_before_the_redirect(
    monkeypatch: Any, redactor: managed_im_supervisor._SecretRedactor
) -> None:
    _credential_env(monkeypatch)
    redactor.load_env()
    started_with = io.StringIO()  # the stderr a handler bound before redirect
    log = io.StringIO()
    writer: Any = managed_im_supervisor._RedactingWriter(log, redactor)
    logger = logging.getLogger("galley-test.pre-redirect")
    early = logging.StreamHandler(started_with)
    elsewhere = logging.StreamHandler(io.StringIO())  # not stdio: untouched
    logger.addHandler(early)
    logger.addHandler(elsewhere)
    logger.propagate = False
    try:
        assert managed_im_supervisor._rebind_logging_streams(writer, [started_with, None]) == 1
        logger.warning("InvalidToken: %s", TG_TOKEN)
    finally:
        logger.removeHandler(early)
        logger.removeHandler(elsewhere)
        logger.propagate = True
    assert early.stream is writer and elsewhere.stream is not writer
    assert started_with.getvalue() == ""
    assert log.getvalue() == "InvalidToken: …wXyZ\n"


def test_run_telegram_masks_a_rejected_token_in_status_and_log(
    monkeypatch: Any, tmp_path: Path, redactor: managed_im_supervisor._SecretRedactor
) -> None:
    """The reported bug: python-telegram-bot's InvalidToken quotes the whole
    token, and tgapp both prints it and reports it as the last error."""
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_tgapp(
        ga_path,
        """
import json
import os

TOKEN = json.loads(os.environ["GALLEY_TELEGRAM_CONFIG_JSON"])["tg_bot_token"]


class Agent:
    verbose = True


agent = Agent()


def check_config():
    return {"ready": True}


def main():
    e = f"The token `{TOKEN}` was rejected by the server."
    print(f"[10-08 12:00] polling crashed: {e}", flush=True)
    GALLEY_STATUS_HOOK("error", f"Telegram bot token rejected: {e}")
    return 1
""",
    )
    _credential_env(monkeypatch)
    monkeypatch.setattr(managed_runtime, "install_managed_mykey_loader", lambda: None)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)
    monkeypatch.setattr(
        managed_runtime, "install_managed_prompt_profile", lambda agent, extra_env_names: None
    )
    monkeypatch.setattr(managed_im_supervisor, "_start_resume", lambda platform, state: None)
    monkeypatch.setattr(im_reporter, "start_telegram_reporter", lambda tgapp, state: None)
    _clear_frontends_modules()
    out = io.StringIO()
    saved = (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__)
    cwd = os.getcwd()
    try:
        code = managed_im_supervisor._run_telegram(
            _args(ga_path, state_dir, platform="telegram"), out
        )
    finally:
        os.chdir(cwd)
        _restore_stdio(*saved)
        _clear_frontends_modules()

    assert code == 1
    assert TG_TOKEN not in out.getvalue()
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert [event["state"] for event in events] == ["starting", "error"]
    assert events[-1]["lastError"] == (
        "Telegram bot token rejected: The token `…wXyZ` was rejected by the server."
    )
    logged = (state_dir / "telegram.log").read_text(encoding="utf-8")
    assert TG_TOKEN not in logged
    assert "polling crashed: The token `…wXyZ` was rejected by the server." in logged


def test_run_wechat_masks_the_saved_login_token(
    monkeypatch: Any, tmp_path: Path, redactor: managed_im_supervisor._SecretRedactor
) -> None:
    """WeChat's credential is not in the env: the launcher masks the token
    WxBotClient loaded from token.json."""
    ga_path = tmp_path / "ga"
    state_dir = tmp_path / "state"
    _write_fake_wechatapp(
        ga_path,
        f"""
import sys

_TEMP_DIR = "unset"
_MODE = "conductor"


class AuthExpired(Exception):
    pass


class Agent:
    verbose = True

    def run(self):
        pass


agent = Agent()


class WxBotClient:
    bot_id = "bot-test"
    token = {WX_TOKEN!r}

    def __init__(self, token_file):
        self.token_file = token_file

    def run_loop(self, on_message, poll_timeout=30):
        print(f"[WX] Authorization: Bearer {{self.token}}", file=sys.__stdout__)
        raise RuntimeError(f"getupdates failed for {{self.token}}")
""",
    )
    monkeypatch.setattr(managed_runtime, "install_managed_mykey_loader", lambda: None)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)
    monkeypatch.setattr(
        managed_runtime, "install_managed_prompt_profile", lambda agent, extra_env_names: None
    )
    monkeypatch.setattr(managed_im_supervisor, "_start_resume", lambda platform, state: None)
    monkeypatch.setattr(im_reporter, "start_wechat_reporter", lambda conversation, state: None)
    _clear_frontends_modules()
    out = io.StringIO()
    saved = (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__)
    cwd = os.getcwd()
    try:
        code = managed_im_supervisor._run_wechat(
            _args(ga_path, state_dir, platform="wechat"), out
        )
    finally:
        os.chdir(cwd)
        _restore_stdio(*saved)
        _clear_frontends_modules()

    assert code == 1
    assert WX_TOKEN not in out.getvalue()
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert events[-1]["state"] == "error"
    assert events[-1]["lastError"] == "getupdates failed for …w3ch"
    logged = (state_dir / "wechat.log").read_text(encoding="utf-8")
    assert WX_TOKEN not in logged
    assert "[WX] Authorization: Bearer …w3ch" in logged
