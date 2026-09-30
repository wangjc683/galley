"""Restart continuity of the single-agent IM channels (Feishu, Telegram,
WeChat): ``runner/im_resume.py`` and its wiring in
``runner/managed_im_supervisor.py``.

The real ``continue_cmd`` from the managed payload picks conversations
back up (rooted at ``GALLEY_GA_STATE_ROOT`` in tmp), from hand-written
logs in GA's native format (the same samples as the Discord ``0026``
tests). Three layers:

- ``ChannelResume`` on its own, with a fake GA agent.
- The launcher's ``_run_*`` functions over fake frontend modules (the
  ``test_managed_im_supervisor.py`` style): the resume happens before the
  reporter and ``main()``, the mapping follows every turn end, ``/new``.
- The notice and command seams against the real tgapp / fsapp / wechatapp
  payload, with their network and GA dependencies stubbed.
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import itertools
import json
import os
import queue
import subprocess
import sys
import time
import types
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from runner import im_reporter, im_resume, managed_im_supervisor, managed_runtime
from runner.tests import test_managed_feishu_fsapp as fst
from runner.tests import test_managed_telegram_tgapp as tgt
from runner.tests.test_managed_discord_dcapp import (
    HINTED,
    OTHER_TURNS,
    SAMPLE_HISTORY,
    SAMPLE_TURNS,
    native_log,
)
from runner.tests.test_managed_im_supervisor import _args, _restore_stdio

_FRONTENDS = Path(__file__).resolve().parents[2] / "managed-ga" / "code" / "frontends"
LOG_NAME = "model_responses_424242.txt"
NOTICE = im_resume.CONTEXT_LOST_TEXT
NEW_CHAT_TEXT = "🆕 已开启新对话，当前上下文已清空"
OTHER_HISTORY = [
    {"role": "user", "content": OTHER_TURNS[0][0]},
    {"role": "assistant", "content": OTHER_TURNS[0][1]},
]
WORKING_MEMORY = ["[USER]: " + HINTED + "暗号是蓝鲸，记住", "[Agent] 记下暗号", "[Agent] 确认"]
CORRUPT_LOG = (
    "=== Prompt === 2026-09-30 10:00:00\nnot json\n\n"
    "=== Response === 2026-09-30 10:00:04\n[{'type': 'text'\n\n"
)


# ── fakes ──────────────────────────────────────────────────────────────


class FakeBackend:
    def __init__(self) -> None:
        self.history: list[dict[str, Any]] = []


class FakeClient:
    def __init__(self) -> None:
        self.backend = FakeBackend()
        self.log_path: str | None = None
        self.last_tools = ""


class Logs:
    """The managed state root's temp/model_responses, per test."""

    dir = Path(".")
    ids = itertools.count(300001)


def give_ga_state(agent: Any) -> None:
    """What continue_cmd reads and writes on a GA agent: a fresh log minted
    the way GenericAgent.__init__ does, one client, empty histories."""
    agent.log_path = str(Logs.dir / f"model_responses_{next(Logs.ids)}.txt")
    agent.llmclient = FakeClient()
    agent.llmclients = [agent.llmclient]
    agent.history = []
    agent.handler = None


class Agent:
    """GA stand-in for the launcher and the Feishu / WeChat payloads:
    ``put_task`` hands out a plain queue, pre-filled from ``scripts`` when
    one is queued (else the test feeds it)."""

    log_path: str
    llmclient: FakeClient
    llmclients: list[FakeClient]
    history: list[Any]
    handler: Any

    def __init__(self) -> None:
        give_ga_state(self)
        self.verbose = True
        self.is_running = False
        self.aborted = 0
        self.run_saw: list[Any] | None = None
        self.tasks: list[tuple[str, str, queue.Queue[dict[str, Any]]]] = []
        self.scripts: list[list[dict[str, Any]]] = []
        self.fail_put: Exception | None = None
        self.llm_no = 0

    def run(self) -> None:
        self.run_saw = list(self.llmclient.backend.history)

    def abort(self) -> None:
        self.aborted += 1

    def put_task(
        self, query: str, source: str = "user", images: Any = None
    ) -> queue.Queue[dict[str, Any]]:
        if self.fail_put is not None:
            raise self.fail_put
        dq: queue.Queue[dict[str, Any]] = queue.Queue()
        for item in self.scripts.pop(0) if self.scripts else []:
            dq.put(item)
        self.tasks.append((query, source, dq))
        return dq

    def fire_turn_end(self) -> None:
        for hook in list(getattr(self, "_turn_end_hooks", {}).values()):
            hook({})

    def list_llms(self) -> list[tuple[int, str, bool]]:
        return [(0, "NativeClaude/test", True)]

    def get_llm_name(self) -> str:
        return "NativeClaude/test"


class TgAgent(tgt.FakeAgent):
    """tgapp's scripted fake agent plus the GA state continue_cmd needs."""

    log_path: str

    def __init__(self) -> None:
        super().__init__()
        give_ga_state(self)


# ── helpers ────────────────────────────────────────────────────────────


def _exec_module(monkeypatch: Any, name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    old = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = old
    return module


def load_continue_cmd(monkeypatch: Any, tmp_path: Path) -> Any:
    """The payload's continue_cmd as the top-level module the frontends
    import, rooted in tmp (it resolves its log dir at import), minus the GA
    class patch chatapp_common would install."""
    monkeypatch.setenv("GALLEY_GA_STATE_ROOT", str(tmp_path / "ga"))
    Logs.dir = tmp_path / "ga" / "temp" / "model_responses"
    Logs.dir.mkdir(parents=True, exist_ok=True)
    module = _exec_module(monkeypatch, "continue_cmd", _FRONTENDS / "continue_cmd.py")
    monkeypatch.setattr(module, "install", lambda _cls: None)
    return module


def seed_log(name: str = LOG_NAME, text: str | None = None) -> Path:
    path = Logs.dir / name
    path.write_text(native_log(SAMPLE_TURNS) if text is None else text, encoding="utf-8")
    return path


def seed_mapping(state_dir: Path, name: str = LOG_NAME) -> None:
    """The mapping a previous process of the channel left behind."""
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / im_resume.MAPPING_FILE_NAME).write_text(
        json.dumps({"log": name}), encoding="utf-8"
    )


def mapping(state_dir: Path) -> Any:
    path = state_dir / im_resume.MAPPING_FILE_NAME
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def write_turn(agent: Any, turns: Any = OTHER_TURNS) -> None:
    """What GA appends to the agent's log during a turn."""
    with open(agent.log_path, "a", encoding="utf-8") as f:
        f.write(native_log(turns))


_DEAD_PID: list[int] = []


def dead_pid() -> int:
    if not _DEAD_PID:
        out = subprocess.run(
            [sys.executable, "-c", "import os; print(os.getpid())"],
            capture_output=True, text=True, check=True,
        )
        _DEAD_PID.append(int(out.stdout))
    return _DEAD_PID[0]


def leave_fresh_lock(cc: Any, log: Path, agent_id: str, pid: int) -> dict[str, Any]:
    """A lock whose heartbeat is 2 s old: upstream alone refuses it for
    another 28 s."""
    lock = Path(cc._lock_path(str(log)))
    lock.parent.mkdir(parents=True, exist_ok=True)
    meta = {"pid": pid, "agent_id": agent_id, "log": log.name, "started": time.time() - 5}
    lock.write_text(json.dumps(meta), encoding="utf-8")
    os.utime(lock, (time.time() - 2, time.time() - 2))
    assert cc.session_occupant(str(log)) is not None
    return meta


def wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        time.sleep(0.005)


@pytest.fixture
def cc(monkeypatch: Any, tmp_path: Path) -> Any:
    return load_continue_cmd(monkeypatch, tmp_path)


@pytest.fixture
def state_dir(tmp_path: Path) -> Path:
    path = tmp_path / "state"
    path.mkdir()
    return path


# ── ChannelResume ──────────────────────────────────────────────────────


def test_mapped_log_is_picked_back_up_in_place(cc: Any, state_dir: Path) -> None:
    seed_log()
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-telegram")
    agent = Agent()
    resume.attach(agent)
    assert Path(agent.log_path).name == LOG_NAME  # the same conversation goes on
    assert agent.llmclient.backend.history == SAMPLE_HISTORY
    assert agent.history == WORKING_MEMORY  # restore_wm
    holder = cc.session_occupant(agent.log_path)
    assert holder["pid"] == os.getpid() and holder["agent_id"] == "galley-telegram"
    assert resume.take_notice() == ""
    assert mapping(state_dir) == {"log": LOG_NAME}


@pytest.mark.parametrize(
    "stored",
    [None, json.dumps({"log": "../../secrets.txt"}), "not json", json.dumps(["x"])],
    ids=["none", "not-a-log-name", "unreadable", "not-an-object"],
)
def test_no_usable_mapping_is_a_fresh_context_said_nothing_about(
    cc: Any, state_dir: Path, stored: str | None
) -> None:
    seed_log()
    if stored is not None:
        (state_dir / im_resume.MAPPING_FILE_NAME).write_text(stored, encoding="utf-8")
    resume = im_resume.ChannelResume(cc, state_dir, "galley-feishu")
    agent = Agent()
    before = agent.log_path
    resume.attach(agent)
    assert agent.log_path == before
    assert agent.llmclient.backend.history == [] and agent.history == []
    assert resume.take_notice() == ""


@pytest.mark.parametrize(
    "log_text", [None, "", CORRUPT_LOG], ids=["missing", "empty", "corrupt"]
)
def test_unrecoverable_log_is_a_fresh_log_said_once(
    cc: Any, state_dir: Path, log_text: str | None
) -> None:
    if log_text is not None:
        seed_log(text=log_text)
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-wechat")
    agent = Agent()
    resume.attach(agent)
    assert Path(agent.log_path).name != LOG_NAME
    assert agent.llmclient.backend.history == [] and agent.history == []
    assert cc.session_occupant(agent.log_path)["agent_id"] == "galley-wechat"
    assert resume.take_notice() == NOTICE
    assert resume.take_notice() == ""  # once
    resume.restore_notice()  # the message that took it never went out
    assert resume.take_notice() == NOTICE
    # The mapping follows the new log once a turn is written to it.
    write_turn(agent)
    agent.fire_turn_end()
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}


def test_fresh_lock_left_by_the_channels_dead_process_is_taken_over(
    cc: Any, state_dir: Path
) -> None:
    log = seed_log()
    leave_fresh_lock(cc, log, "galley-telegram", dead_pid())
    seed_mapping(state_dir)
    agent = Agent()
    im_resume.ChannelResume(cc, state_dir, "galley-telegram").attach(agent)
    assert agent.log_path == str(log)
    assert agent.llmclient.backend.history == SAMPLE_HISTORY
    assert cc.session_occupant(str(log))["pid"] == os.getpid()


def test_log_held_by_another_live_process_goes_on_in_a_copy(cc: Any, state_dir: Path) -> None:
    log = seed_log()
    lock = Path(cc._lock_path(str(log)))
    foreign = leave_fresh_lock(cc, log, "tui-1", os.getppid())
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-feishu")
    agent = Agent()
    resume.attach(agent)
    assert agent.log_path != str(log)
    assert Path(agent.log_path).read_text(encoding="utf-8") == log.read_text(encoding="utf-8")
    assert agent.llmclient.backend.history == SAMPLE_HISTORY
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}
    assert json.loads(lock.read_text(encoding="utf-8")) == foreign  # untouched
    assert resume.take_notice() == ""


def test_every_turn_end_maps_the_log_once_it_exists(cc: Any, state_dir: Path) -> None:
    resume = im_resume.ChannelResume(cc, state_dir, "galley-telegram")
    agent = Agent()
    resume.attach(agent)
    agent.fire_turn_end()  # nothing written to the log yet
    assert mapping(state_dir) is None
    write_turn(agent)
    agent.fire_turn_end()
    name = Path(agent.log_path).name
    # The file name only, never conversation content (constitution rule 4).
    path = state_dir / im_resume.MAPPING_FILE_NAME
    assert path.read_text(encoding="utf-8") == json.dumps({"log": name}) + "\n"


def test_new_moves_the_channel_to_a_new_log(cc: Any, state_dir: Path) -> None:
    seed_log()
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-telegram")
    agent = Agent()
    resume.attach(agent)

    resume.fresh(agent)  # after the frontend's own reset
    assert Path(agent.log_path).name != LOG_NAME
    assert agent.llmclient.backend.history == [] and agent.history == []
    assert mapping(state_dir) is None
    # A restart before anything is said: nothing to pick up, nothing to say.
    idle = Agent()
    restarted = im_resume.ChannelResume(cc, state_dir, "galley-telegram")
    restarted.attach(idle)
    assert idle.llmclient.backend.history == [] and restarted.take_notice() == ""

    write_turn(agent)
    agent.fire_turn_end()
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}
    again = Agent()
    im_resume.ChannelResume(cc, state_dir, "galley-telegram").attach(again)
    assert again.log_path == agent.log_path
    assert again.llmclient.backend.history == OTHER_HISTORY


def test_new_clears_a_pending_notice(cc: Any, state_dir: Path) -> None:
    seed_mapping(state_dir)  # to a log that is gone
    resume = im_resume.ChannelResume(cc, state_dir, "galley-wechat")
    agent = Agent()
    resume.attach(agent)
    resume.fresh(agent)
    assert resume.take_notice() == ""


def test_continue_n_moves_the_channel_onto_a_copy(cc: Any, state_dir: Path) -> None:
    seed_log()
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-telegram")
    agent = Agent()
    resume.attach(agent)
    other = seed_log("model_responses_515151.txt", native_log(OTHER_TURNS))
    os.utime(other, (time.time() + 10, time.time() + 10))  # newest: /continue 1
    upstream: list[str] = []

    reply = resume.continue_session(agent, "/continue 1", lambda: upstream.append("x"))
    assert str(reply).startswith("✅ 已恢复 1 轮完整对话（model_responses_515151.txt）")
    assert upstream == []
    assert agent.log_path not in (str(other), str(Logs.dir / LOG_NAME))
    assert Path(agent.log_path).read_text(encoding="utf-8") == other.read_text(encoding="utf-8")
    assert agent.llmclient.backend.history == OTHER_HISTORY
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}

    for query in ("/continue", "/continue 9", "/continue x"):
        assert resume.continue_session(agent, query, lambda: "upstream") == "upstream"


# ── launcher wiring (fake frontends) ───────────────────────────────────

SCENARIOS = ["mapped", "stale_lock", "unmapped", "missing"]


@dataclass
class Launch:
    code: int
    module: Any
    events: list[dict[str, Any]]
    resume: im_resume.ChannelResume
    saw: dict[str, Any]


@pytest.fixture
def fakes(monkeypatch: Any) -> types.ModuleType:
    """What the fake frontend modules import: the fake agent and a place
    to note what they saw."""
    module = types.ModuleType("galley_resume_fakes")
    module.Agent = Agent  # type: ignore[attr-defined]
    module.SAW = {}  # type: ignore[attr-defined]
    module.wait_for = wait_for  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "galley_resume_fakes", module)
    return module


def seed_scenario(scenario: str, cc: Any, state_dir: Path, owner: str) -> None:
    log = seed_log()
    if scenario == "unmapped":
        return
    if scenario == "missing":
        log.unlink()
    seed_mapping(state_dir)
    if scenario == "stale_lock":
        leave_fresh_lock(cc, log, owner, dead_pid())


def expected_history(scenario: str) -> list[Any]:
    return SAMPLE_HISTORY if scenario in ("mapped", "stale_lock") else []


def launch(
    monkeypatch: Any, tmp_path: Path, fakes: Any, platform: str, body: str
) -> Launch:
    module_name = {"feishu": "fsapp", "telegram": "tgapp", "wechat": "wechatapp"}[platform]
    run = {
        "feishu": managed_im_supervisor._run_feishu,
        "telegram": managed_im_supervisor._run_telegram,
        "wechat": managed_im_supervisor._run_wechat,
    }[platform]
    ga_path = tmp_path / "ga-code"
    frontends = ga_path / "frontends"
    frontends.mkdir(parents=True)
    (frontends / "__init__.py").write_text("", encoding="utf-8")
    (frontends / f"{module_name}.py").write_text(body, encoding="utf-8")
    monkeypatch.setattr(managed_runtime, "install_managed_mykey_loader", lambda: None)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)

    def install_prompt(agent: Any, extra_env_names: tuple[str, ...] = ()) -> None:
        fakes.SAW["prompt_installs"] = fakes.SAW.get("prompt_installs", 0) + 1

    monkeypatch.setattr(managed_runtime, "install_managed_prompt_profile", install_prompt)
    resumes: list[im_resume.ChannelResume] = []
    real_load = im_resume.load

    def load(name: str, state: Path) -> im_resume.ChannelResume:
        resumes.append(real_load(name, state))
        return resumes[-1]

    monkeypatch.setattr(im_resume, "load", load)
    for name in ("frontends", f"frontends.{module_name}"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    out = io.StringIO()
    stdio = (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__)
    cwd = os.getcwd()
    try:
        code = run(_args(ga_path, tmp_path / "state", platform=platform), out)
        module = sys.modules[f"frontends.{module_name}"]
    finally:
        os.chdir(cwd)
        _restore_stdio(*stdio)
        for name in ("frontends", f"frontends.{module_name}"):
            sys.modules.pop(name, None)
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    (resume,) = resumes
    return Launch(code, module, events, resume, fakes.SAW)


TELEGRAM_BODY = '''
import galley_resume_fakes as fakes

_TEMP_DIR = "unset"
agent = fakes.Agent()


def reset_conversation(agent, message="🆕 已开启新对话，当前上下文已清空"):
    agent.abort()
    agent.history = []
    agent.llmclient.backend.history = []
    return message


def handle_frontend_command(agent, query, exclude_pid=None):
    return "upstream " + query


def check_config(init_agent=False):
    return {"ready": True}


def main():
    fakes.SAW["main"] = list(agent.llmclient.backend.history)
    raise KeyboardInterrupt()
'''


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_telegram_launcher_resumes_before_reporter_and_main(
    monkeypatch: Any, tmp_path: Path, cc: Any, fakes: Any, scenario: str
) -> None:
    state_dir = tmp_path / "state"
    seed_scenario(scenario, cc, state_dir, "galley-telegram")

    def start_reporter(tgapp: Any, _state_dir: Path) -> None:
        fakes.SAW["reporter"] = list(tgapp.agent.llmclient.backend.history)

    monkeypatch.setattr(im_reporter, "start_telegram_reporter", start_reporter)
    run = launch(monkeypatch, tmp_path, fakes, "telegram", TELEGRAM_BODY)
    assert run.code == 0
    assert [event["state"] for event in run.events] == ["starting", "stopped"]
    assert run.saw["reporter"] == run.saw["main"] == expected_history(scenario)
    agent = run.module.agent
    assert run.resume.owner == "galley-telegram"
    assert run.resume.take_notice() == (NOTICE if scenario == "missing" else "")
    if scenario in ("mapped", "stale_lock"):
        assert Path(agent.log_path).name == LOG_NAME
        assert cc.session_occupant(agent.log_path)["pid"] == os.getpid()

    write_turn(agent)
    agent.fire_turn_end()
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}
    before = agent.log_path
    assert run.module.reset_conversation(agent) == NEW_CHAT_TEXT  # /new
    assert agent.log_path != before and mapping(state_dir) is None
    assert run.module.handle_frontend_command(agent, "/continue") == "upstream /continue"


FEISHU_BODY = '''
import threading

import galley_resume_fakes as fakes

agent = None
_agent_lock = threading.Lock()


def get_agent():
    global agent
    with _agent_lock:
        if agent is None:
            agent = fakes.Agent()
        return agent


class AgentChatMixin:
    pass


class _TaskCard:
    def __init__(self):
        self.final = None

    def done(self, text):
        self.final = text


def _reset_conversation(agent, message="🆕 已开启新对话，当前上下文已清空"):
    agent.abort()
    agent.history = []
    agent.llmclient.backend.history = []
    return message


def _handle_continue_frontend(agent, query, exclude_pid=None):
    return "upstream " + query


def check_config(init_agent=False):
    return {"ready": True}


def main():
    fakes.SAW["main"] = agent  # built lazily: nothing yet
    got = []
    threads = [threading.Thread(target=lambda: got.append(get_agent())) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    fakes.SAW["got"] = got
    raise KeyboardInterrupt()
'''


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_feishu_launcher_resumes_the_lazy_agent_before_anyone_gets_it(
    monkeypatch: Any, tmp_path: Path, cc: Any, fakes: Any, scenario: str
) -> None:
    state_dir = tmp_path / "state"
    seed_scenario(scenario, cc, state_dir, "galley-feishu")

    def start_reporter(fsapp: Any, _state_dir: Path) -> None:
        fakes.SAW["reporter"] = fsapp.agent

    monkeypatch.setattr(im_reporter, "start_feishu_reporter", start_reporter)
    run = launch(monkeypatch, tmp_path, fakes, "feishu", FEISHU_BODY)
    assert run.code == 0
    assert run.saw["reporter"] is None and run.saw["main"] is None
    agent = run.module.agent
    assert run.saw["got"] == [agent] * 4
    assert run.saw["prompt_installs"] == 1  # set up once, whoever came first
    # The first caller already got the conversation picked back up.
    assert agent.llmclient.backend.history == expected_history(scenario)
    if scenario in ("mapped", "stale_lock"):
        assert Path(agent.log_path).name == LOG_NAME

    card = run.module._TaskCard()
    card.done("好的。")
    assert card.final == (f"{NOTICE}\n好的。" if scenario == "missing" else "好的。")
    card = run.module._TaskCard()
    card.done("嗯。")
    assert card.final == "嗯。"

    write_turn(agent)
    agent.fire_turn_end()
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}
    before = agent.log_path
    assert run.module._reset_conversation(agent) == NEW_CHAT_TEXT  # /new
    assert agent.log_path != before and mapping(state_dir) is None
    assert run.module._handle_continue_frontend(agent, "/continue") == "upstream /continue"


WECHAT_BODY = '''
import galley_resume_fakes as fakes

_TEMP_DIR = "unset"
_MODE, _cond_seq = "conductor", 0
_task_aborted = {}
SEEN = []


class AuthExpired(Exception):
    pass


agent = fakes.Agent()


class WxBotClient:
    bot_id = "bot-test"
    token = "tok"

    def __init__(self, token_file):
        self.sent = []
        fakes.SAW["bot"] = self

    @staticmethod
    def extract_text(msg):
        return msg["text"]

    def send_text(self, uid, text, context_token=""):
        self.sent.append((uid, text, context_token))

    def run_loop(self, on_message, poll_timeout=30):
        fakes.wait_for(lambda: agent.run_saw is not None)
        fakes.SAW["loop"] = list(agent.llmclient.backend.history)
        on_message(self, {"text": "/switch", "from_user_id": "u1", "context_token": "c1"})
        on_message(self, {"text": "hello", "from_user_id": "u1", "context_token": "c2"})
        fakes.SAW["before_new"] = agent.log_path
        on_message(self, {"text": "/new", "from_user_id": "u1", "context_token": "c3"})
        raise KeyboardInterrupt()


def on_message(bot, msg):
    SEEN.append((msg["text"], _MODE, type(bot).__name__))
    # A command reply goes out on the caller's thread: never the notice.
    bot.send_text(msg["from_user_id"], "sync reply", context_token=msg["context_token"])
'''


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_wechat_launcher_resumes_before_the_agent_runs_and_adds_new(
    monkeypatch: Any, tmp_path: Path, cc: Any, fakes: Any, scenario: str
) -> None:
    state_dir = tmp_path / "state"
    seed_scenario(scenario, cc, state_dir, "galley-wechat")
    run = launch(monkeypatch, tmp_path, fakes, "wechat", WECHAT_BODY)
    assert run.code == 0
    assert [event["state"] for event in run.events] == ["starting", "running", "stopped"]
    agent = run.module.agent
    assert agent.run_saw == run.saw["loop"] == expected_history(scenario)
    assert run.module._MODE == "agent"
    assert run.module.SEEN == [("hello", "agent", "WechatNoticeBot")]
    assert run.saw["bot"].sent == [
        ("u1", managed_im_supervisor.WECHAT_SWITCH_BLOCKED_REPLY, "c1"),
        ("u1", "sync reply", "c2"),
        ("u1", NEW_CHAT_TEXT, "c3"),
    ]
    # /new: upstream's reset (nothing running, nothing marked stopped), a
    # new log, no mapping until something is said in it, no notice left.
    assert agent.aborted >= 1 and run.module._task_aborted == {}
    assert agent.log_path != run.saw["before_new"]
    assert agent.llmclient.backend.history == [] and agent.history == []
    assert mapping(state_dir) is None
    assert run.resume.take_notice() == ""
    write_turn(agent)
    agent.fire_turn_end()
    assert mapping(state_dir) == {"log": Path(agent.log_path).name}


# ── Telegram payload ───────────────────────────────────────────────────


@dataclass
class TgWorld:
    env: tgt.Env
    resume: im_resume.ChannelResume
    state_dir: Path
    cc: Any


@pytest.fixture
def tg(monkeypatch: Any, tmp_path: Path) -> TgWorld:
    tgt._install_stubs(monkeypatch)
    # The real continue_cmd over the stub, before tgapp binds its names.
    cc = load_continue_cmd(monkeypatch, tmp_path)
    monkeypatch.setattr(sys.modules["agentmain"], "GeneraticAgent", TgAgent)
    monkeypatch.setenv(
        "GALLEY_TELEGRAM_CONFIG_JSON",
        json.dumps({"tg_bot_token": "t", "tg_allowed_users": [str(tgt.OWNER)]}),
    )
    tgapp = tgt._exec_module(monkeypatch, "_galley_test_tgapp", _FRONTENDS / "tgapp.py")
    monkeypatch.setattr(tgapp, "_LIVE_POLL_SECONDS", 0.01)
    tgapp._register_ask_user_hook()
    clock = tgt.FakeClock()
    tgt.FakeAgent.clock = clock
    env = tgt.Env(tgapp, clock)
    state_dir = tmp_path / "state"
    seed_mapping(state_dir)  # to a log that is gone: the next answer says so
    resume = im_resume.ChannelResume(cc, state_dir, "galley-telegram")
    resume.attach(env.agent)
    im_resume.install_telegram(tgapp, resume)
    return TgWorld(env, resume, state_dir, cc)


def tg_answer_script(env: tgt.Env, body: str) -> None:
    t1 = tgt.turn_text(1, f"<summary>答</summary>{body}")
    env.agent.scripts.append([tgt.nxt([t1]), tgt.done([t1], 1.0)])


def test_telegram_answer_leads_with_the_notice_once(tg: TgWorld) -> None:
    env = tg.env

    async def body() -> None:
        tg_answer_script(env, "好的。")
        await env.say("换个话题")
        await env.settle()
        header = tgt.header_b("1 步 · 用时 1 秒", "01 答")
        assert env.bot.others()[-1].text == f"_{NOTICE}_\n{header}\n\n好的。"
        tg_answer_script(env, "嗯。")
        await env.say("继续")
        await env.settle()
        assert env.bot.others()[-1].text == f"{header}\n\n嗯。"

    env.run(body)


def test_telegram_plain_fallback_keeps_the_notice_line(tg: TgWorld) -> None:
    env = tg.env

    async def body() -> None:
        env.bot.reject_markdown = True
        tg_answer_script(env, "**好**")
        await env.say("hi")
        await env.settle()
        (answer,) = env.bot.others()
        assert answer.text == f"{NOTICE}\n1 步 · 用时 1 秒\n01 答\n\n**好**"

    env.run(body)


def test_telegram_notice_goes_just_before_a_first_part_with_no_room(tg: TgWorld) -> None:
    env = tg.env

    async def body() -> None:
        tg_answer_script(env, "内容" * 3000)  # one line: the first part fills the limit
        await env.say("长")
        await env.settle()
        notice, first, *rest = env.bot.others()
        assert notice.text == f"_{NOTICE}_"
        assert (first.text or "").startswith("**>1 步 · 用时 1 秒")
        assert len(first.text or "") + len(notice.text or "") + 1 > tgt.MAX
        assert rest and all(len(m.text or "") <= tgt.MAX for m in [first, *rest])

    env.run(body)


def test_telegram_question_leads_with_the_notice(tg: TgWorld) -> None:
    env = tg.env

    async def body() -> None:
        question = await tgt.ask_once(env, "选哪个？", ["甲", "乙"])
        assert (question.text or "").startswith(f"_{NOTICE}_\n_⏸ 等你回复 · 已完成 1 步_\n")
        assert tg.resume.take_notice() == ""

    env.run(body)


def test_telegram_receipts_and_report_render_leave_the_notice(tg: TgWorld) -> None:
    env = tg.env

    async def body() -> None:
        await tgt.start_long_run(env)
        env.clock.now += 3
        await env.command("/stop")
        await env.settle()
        assert env.bot.statuses()[0].text == "⏹ 已停止 · 1 步 · 用时 3 秒"
        env.agent.fail_put = RuntimeError("boom")  # a frontend failure's receipt
        await env.say("hi")
        await env.settle()
        env.agent.fail_put = None
        assert env.bot.texts()[-1] == "❌ 出错：boom"
        assert not any(NOTICE in (text or "") for text in env.bot.texts())
        # A completion-reporter turn renders through its own seams.
        channel = im_reporter.TelegramChannel(env.tg)
        text = channel.render(tgt.turn_text(1, "报告"))
        assert NOTICE not in text and NOTICE not in str(env.tg.markdown_v2_segments(text))

        tg_answer_script(env, "好的。")
        await env.say("换个话题")
        await env.settle()
        assert (env.bot.others()[-1].text or "").startswith(f"_{NOTICE}_\n")

    env.run(body)


def test_telegram_new_and_continue_move_the_channel_to_new_logs(tg: TgWorld) -> None:
    env, cc = tg.env, tg.cc

    async def body() -> None:
        agent = env.agent
        assert isinstance(agent, TgAgent)
        failed_over = agent.log_path
        await env.command("/new")
        assert env.bot.texts()[-1] == NEW_CHAT_TEXT
        assert agent.log_path != failed_over and mapping(tg.state_dir) is None
        assert cc.session_occupant(agent.log_path)["agent_id"] == "galley-telegram"
        tg_answer_script(env, "好的。")
        await env.say("hi")
        await env.settle()
        assert NOTICE not in (env.bot.others()[-1].text or "")  # /new dropped it

        other = seed_log("model_responses_515151.txt", native_log(OTHER_TURNS))
        await env.command("/continue 1")
        assert (env.bot.texts()[-1] or "").startswith(
            "✅ 已恢复 1 轮完整对话（model_responses_515151.txt）"
        )
        assert agent.log_path != str(other)
        assert Path(agent.log_path).read_text(encoding="utf-8") == other.read_text(
            encoding="utf-8"
        )
        assert agent.llmclient.backend.history == OTHER_HISTORY
        assert mapping(tg.state_dir) == {"log": Path(agent.log_path).name}

    env.run(body)


# ── Feishu payload ─────────────────────────────────────────────────────


@dataclass
class FsWorld:
    fsapp: Any
    agent: Agent
    resume: im_resume.ChannelResume
    state_dir: Path
    sent: list[tuple[str, str, str]]


@pytest.fixture
def fs(monkeypatch: Any, tmp_path: Path) -> FsWorld:
    fst._install_fsapp_stubs(monkeypatch)  # lark, agentmain, the frontends package
    cc = load_continue_cmd(monkeypatch, tmp_path)
    monkeypatch.setattr(sys.modules["agentmain"], "GeneraticAgent", Agent)
    for name, attrs in (
        ("btw_cmd", {"handle_frontend_command": lambda _a, cmd: cmd, "install": lambda _c: None}),
        ("review_cmd", {"install": lambda _c: None}),
    ):
        stub = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(stub, key, value)
        monkeypatch.setitem(sys.modules, name, stub)
    monkeypatch.setattr(sys, "path", list(sys.path))  # both modules prepend the code root
    # The real chatapp_common under the name fsapp imports it by.
    _exec_module(monkeypatch, "frontends.chatapp_common", _FRONTENDS / "chatapp_common.py")
    monkeypatch.setenv("GA_WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("GALLEY_FEISHU_TEMP_DIR", str(tmp_path / "feishu-temp"))
    cwd = os.getcwd()
    try:
        fsapp = _exec_module(monkeypatch, "_galley_test_fsapp_resume", _FRONTENDS / "fsapp.py")
    finally:
        os.chdir(cwd)
    sent: list[tuple[str, str, str]] = []

    def send_raw(receive_id: str, payload: str, msg_type: str, _rtype: str) -> str:
        sent.append((receive_id, payload, msg_type))
        return f"om_{len(sent)}"

    def patch_card(_message_id: str, card: str) -> bool:
        sent.append(("patch", card, "interactive"))
        return True

    monkeypatch.setattr(fsapp, "_send_raw", send_raw)
    monkeypatch.setattr(fsapp, "_patch_card", patch_card)
    monkeypatch.setattr(fsapp, "_send_generated_files", lambda *_a, **_k: None)
    seed_log(text=CORRUPT_LOG)
    state_dir = tmp_path / "state"
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-feishu")
    im_resume.install_feishu(fsapp, resume)
    agent = fsapp.get_agent()
    assert isinstance(agent, Agent)
    resume.attach(agent)
    return FsWorld(fsapp, agent, resume, state_dir, sent)


def fs_run(fs: FsWorld, text: str, answer: str | None = None) -> str | None:
    """One user message through FeishuApp.run_agent; the card's answer."""
    if answer is not None:
        fs.agent.scripts.append([{"done": answer}])
    app = fs.fsapp.get_app()
    asyncio.run(app.run_agent("oc_1", text, receive_id="oc_1", receive_id_type="chat_id"))
    card = json.loads(fs.sent[-1][1])
    elements = card["body"]["elements"]
    return elements[-1]["content"] if elements[-2:-1] == [{"tag": "hr"}] else None


def fs_command(fs: FsWorld, cmd: str) -> str:
    app = fs.fsapp.get_app()
    asyncio.run(app.handle_command("oc_1", cmd, receive_id="oc_1", receive_id_type="chat_id"))
    receive_id, payload, msg_type = fs.sent[-1]
    assert (receive_id, msg_type) == ("oc_1", "text")
    return str(json.loads(payload)["text"])


def test_feishu_answer_card_leads_with_the_notice_once(fs: FsWorld) -> None:
    assert fs.agent.llmclient.backend.history == []
    assert fs_run(fs, "换个话题", "好的。") == f"{NOTICE}\n好的。"
    assert fs_run(fs, "继续", "嗯。") == "嗯。"


def test_feishu_failed_card_leaves_the_notice_for_the_next_answer(fs: FsWorld) -> None:
    fs.agent.fail_put = RuntimeError("boom")
    assert fs_run(fs, "hi") is None  # the card ends in fail(), no answer
    assert NOTICE not in fs.sent[-1][1]
    fs.agent.fail_put = None
    assert fs_run(fs, "hi", "好的。") == f"{NOTICE}\n好的。"


def test_feishu_new_and_continue_move_the_channel_to_new_logs(fs: FsWorld) -> None:
    failed_over = fs.agent.log_path
    assert fs_command(fs, "/new") == NEW_CHAT_TEXT
    assert fs.agent.log_path != failed_over and mapping(fs.state_dir) is None
    assert fs_run(fs, "hi", "好的。") == "好的。"  # /new dropped the notice

    other = seed_log("model_responses_515151.txt", native_log(OTHER_TURNS))
    os.utime(other, (time.time() + 10, time.time() + 10))  # newer than the corrupt log
    assert fs_command(fs, "/continue 1").startswith(
        "✅ 已恢复 1 轮完整对话（model_responses_515151.txt）"
    )
    assert fs.agent.log_path != str(other)
    assert fs.agent.llmclient.backend.history == OTHER_HISTORY
    assert mapping(fs.state_dir) == {"log": Path(fs.agent.log_path).name}


# ── WeChat payload ─────────────────────────────────────────────────────


class FakeWxBot:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    @staticmethod
    def extract_text(msg: dict[str, Any]) -> str:
        return str(msg["text"])

    def send_text(self, to_user_id: str, text: str, context_token: str = "") -> None:
        self.sent.append((to_user_id, text, context_token))

    def get_typing_ticket(self, _to_user_id: str, context_token: str = "") -> str:
        return ""  # no typing loop


@dataclass
class WxWorld:
    wx: Any
    agent: Agent
    resume: im_resume.ChannelResume
    state_dir: Path
    bot: FakeWxBot
    on_message: Callable[[Any, Any], None]

    def say(self, text: str) -> None:
        self.on_message(self.bot, {"text": text, "from_user_id": "u1", "context_token": "c1"})

    def texts(self) -> list[str]:
        return [text for _uid, text, _ctx in self.bot.sent]


@pytest.fixture
def wx(monkeypatch: Any, tmp_path: Path) -> WxWorld:
    cc = load_continue_cmd(monkeypatch, tmp_path)
    agentmain = types.ModuleType("agentmain")
    agentmain.GeneraticAgent = Agent  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agentmain", agentmain)
    cipher = types.ModuleType("Crypto.Cipher")
    cipher.AES = types.SimpleNamespace(MODE_ECB=1, new=None)  # type: ignore[attr-defined]
    crypto = types.ModuleType("Crypto")
    crypto.Cipher = cipher  # type: ignore[attr-defined]
    for name, module in (
        ("requests", types.ModuleType("requests")), ("qrcode", types.ModuleType("qrcode")),
        ("Crypto", crypto), ("Crypto.Cipher", cipher),
    ):
        monkeypatch.setitem(sys.modules, name, module)
    # wechatapp pops these at import; monkeypatch puts them back afterwards.
    monkeypatch.delenv("HTTPS_PROXY", raising=False)
    monkeypatch.delenv("https_proxy", raising=False)
    monkeypatch.setenv("GALLEY_WECHAT_TEMP_DIR", str(tmp_path / "wx-temp"))
    monkeypatch.setenv("GALLEY_WECHAT_TOKEN_FILE", str(tmp_path / "wx" / "token.json"))
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setitem(sys.__dict__, "__stdout__", io.StringIO())  # wechatapp logs there
    wechatapp = _exec_module(monkeypatch, "_galley_test_wechatapp", _FRONTENDS / "wechatapp.py")
    wechatapp._MODE = managed_im_supervisor.WECHAT_MANAGED_MODE
    seed_log(text="")
    state_dir = tmp_path / "state"
    seed_mapping(state_dir)
    resume = im_resume.ChannelResume(cc, state_dir, "galley-wechat")
    resume.attach(wechatapp.agent)
    on_message = managed_im_supervisor._managed_wechat_on_message(wechatapp, resume)
    return WxWorld(wechatapp, wechatapp.agent, resume, state_dir, FakeWxBot(), on_message)


def test_wechat_first_message_of_a_run_leads_with_the_notice_once(wx: WxWorld) -> None:
    wx.say("/llm")  # a command reply on the caller's thread
    assert wx.texts() == ["LLMs:\n→ [0] NativeClaude/test"]
    wx.agent.scripts.append([{"done": "好的。", "outputs": ["好的。"]}])
    wx.say("换个话题")
    wait_for(lambda: len(wx.bot.sent) == 2)
    assert wx.texts()[-1] == f"{NOTICE}\n好的。\n\n[任务已完成]"
    wx.agent.scripts.append([{"done": "嗯。", "outputs": ["嗯。"]}])
    wx.say("继续")
    wait_for(lambda: len(wx.bot.sent) == 3)
    assert wx.texts()[-1] == "嗯。\n\n[任务已完成]"


def test_wechat_notice_goes_just_before_a_message_at_the_length_cut(wx: WxWorld) -> None:
    long_answer = "内容" * 2000  # wechatapp keeps the last 3000 characters
    wx.agent.scripts.append([{"done": long_answer, "outputs": [long_answer]}])
    wx.say("长")
    wait_for(lambda: len(wx.bot.sent) == 2)
    notice, answer = wx.texts()
    assert notice == NOTICE
    assert len(answer) == im_resume.WECHAT_TEXT_LIMIT and answer.endswith("[任务已完成]")


def test_wechat_stopped_run_leaves_the_notice_for_the_next_answer(wx: WxWorld) -> None:
    wx.say("长任务")
    wait_for(lambda: bool(wx.agent.tasks))
    wx.say("/stop")
    wx.agent.tasks[-1][2].put({"done": "做了一半", "outputs": ["做了一半"]})
    wait_for(lambda: len(wx.bot.sent) == 1)
    assert wx.texts() == ["做了一半\n\n[已停止]"]
    wx.agent.scripts.append([{"done": "好的。", "outputs": ["好的。"]}])
    wx.say("换个话题")
    wait_for(lambda: len(wx.bot.sent) == 2)
    assert wx.texts()[-1] == f"{NOTICE}\n好的。\n\n[任务已完成]"


def test_wechat_new_stops_the_running_task_and_starts_a_new_log(wx: WxWorld) -> None:
    wx.say("长任务")
    wait_for(lambda: bool(wx.agent.tasks))
    running = wx.agent.tasks[-1][2]
    wx.agent.is_running = True
    wx.agent.history = ["[USER]: 长任务"]
    failed_over = wx.agent.log_path
    aborted = wx.agent.aborted

    wx.say("/new")
    assert wx.texts() == [NEW_CHAT_TEXT]
    assert wx.agent.aborted > aborted and wx.wx._task_aborted == {"u1": True}
    assert wx.agent.history == [] and wx.agent.llmclient.backend.history == []
    assert wx.agent.log_path != failed_over and mapping(wx.state_dir) is None
    # The aborted task ends the way /stop leaves it.
    wx.agent.is_running = False
    running.put({"done": "做了一半", "outputs": ["做了一半"]})
    wait_for(lambda: len(wx.bot.sent) == 2)
    assert wx.texts()[-1] == "做了一半\n\n[已停止]"
    # /new dropped the notice.
    wx.agent.scripts.append([{"done": "好的。", "outputs": ["好的。"]}])
    wx.say("hi")
    wait_for(lambda: len(wx.bot.sent) == 3)
    assert wx.texts()[-1] == "好的。\n\n[任务已完成]"
