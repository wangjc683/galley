"""Managed-GA patch 0023: Discord conversation UX in ``frontends/dcapp.py``.

Loads the shipped payload with ``discord`` and the heavy GA modules stubbed
(the real ``chatapp_common`` is used, over stubbed command modules), then
drives ``DiscordApp`` with a fake agent whose display queue replays the item
shapes the managed runtime produces for a ``verbose=False`` channel agent,
and a fake channel that records send / edit / delete. Time is an injected
clock that the scripted queue advances; nothing sleeps for real beyond
event-loop yields and short queue polls.
"""

from __future__ import annotations

import asyncio
import importlib.util
import itertools
import json
import queue
import sys
import time
import types
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest

CHAT = "ch:1"
OWNER = "42"
_CODE_ROOT = Path(__file__).resolve().parents[2] / "managed-ga" / "code"


# ── fakes ──────────────────────────────────────────────────────────────


class FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class ScriptQueue:
    """Display queue whose items advance the injected clock when consumed
    (and may run a side effect), so a run sees realistic timings."""

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.items: queue.Queue[tuple[float, dict[str, Any]]] = queue.Queue()

    def put(self, item: dict[str, Any], advance: float = 0.0) -> None:
        self.items.put((advance, item))

    def get(self, block: bool = True, timeout: float | None = None) -> dict[str, Any]:
        advance, item = self.items.get(block, timeout)
        self.clock.now += advance
        item = dict(item)
        effect = item.pop("_effect", None)
        if callable(effect):
            effect()
        return item


class FakeAgent:
    clock = FakeClock()

    def __init__(self) -> None:
        self.verbose = True
        self.is_running = False
        self.aborted = 0
        self.tasks: list[tuple[str, str, ScriptQueue]] = []
        self.scripts: list[list[tuple[Any, ...]]] = []
        self.fail_put: Exception | None = None
        self._current_queue: Any = None
        self.task_queue: queue.Queue[Any] = queue.Queue()

    def run(self) -> None:
        return None

    def _fire_hooks(self, ctx: dict[str, Any]) -> None:
        for hook in list(getattr(self, "_turn_end_hooks", {}).values()):
            hook(ctx)

    def put_task(self, query: str, source: str = "user", images: Any = None) -> ScriptQueue:
        if self.fail_put is not None:
            raise self.fail_put
        dq = ScriptQueue(FakeAgent.clock)
        self.tasks.append((query, source, dq))
        self._current_queue = dq
        for entry in self.scripts.pop(0) if self.scripts else []:
            if entry[0] == "ask":
                self._fire_hooks(entry[1])
            elif entry[0] == "foreign_ask":  # a completion-reporter turn asking
                self._current_queue = ScriptQueue(FakeAgent.clock)
                self._fire_hooks(entry[1])
                self._current_queue = dq
            else:
                dq.put(entry[1], entry[2])
        return dq

    def abort(self) -> None:
        self.aborted += 1


class FakeMessage:
    _ids = itertools.count(1000)

    def __init__(self, channel: FakeChannel, content: str | None = None, **kwargs: Any) -> None:
        self.id = next(FakeMessage._ids)
        self.channel = channel
        self.content: Any = content
        self.kwargs = kwargs
        self.view: Any = kwargs.get("view")
        self.edits: list[dict[str, Any]] = []
        self.deleted = False

    def to_reference(self, *, fail_if_not_exists: bool = True) -> tuple[str, int, bool]:
        return ("ref", self.id, fail_if_not_exists)

    async def edit(self, **kwargs: Any) -> FakeMessage:
        if self.channel.fail_edit:
            raise RuntimeError("edit refused")
        self.edits.append(kwargs)
        if "content" in kwargs:
            self.content = kwargs["content"]
        if "view" in kwargs:
            self.view = kwargs["view"]
        return self

    async def delete(self) -> None:
        if self.channel.fail_delete:
            raise RuntimeError("delete refused")
        self.deleted = True


class FakeTyping:
    def __init__(self, channel: FakeChannel) -> None:
        self.channel = channel

    async def __aenter__(self) -> None:
        self.channel.typing_entered += 1

    async def __aexit__(self, *exc: Any) -> None:
        self.channel.typing_exited += 1


class FakeChannel:
    def __init__(self) -> None:
        self.id = 1
        self.sent: list[FakeMessage] = []
        self.last_message_id: int | None = None
        self.fail_delete = False
        self.fail_edit = False
        self.fail_next_send: Exception | None = None
        self.typing_entered = 0
        self.typing_exited = 0

    async def send(self, content: str | None = None, **kwargs: Any) -> FakeMessage:
        if self.fail_next_send is not None:
            error, self.fail_next_send = self.fail_next_send, None
            raise error
        message = FakeMessage(self, content, **kwargs)
        self.sent.append(message)
        self.last_message_id = message.id  # what the gateway echo does
        return message

    def typing(self) -> FakeTyping:
        return FakeTyping(self)


class FakeResponse:
    def __init__(self, message: FakeMessage | None) -> None:
        self.message = message
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def defer(self, **kwargs: Any) -> None:
        self.calls.append(("defer", kwargs))

    async def edit_message(self, **kwargs: Any) -> None:
        self.calls.append(("edit_message", kwargs))
        if self.message is not None:
            self.message.content = kwargs.get("content", self.message.content)
            self.message.view = kwargs.get("view", self.message.view)


class FakeInteraction:
    def __init__(self, user_id: str, custom_id: str, message: FakeMessage | None) -> None:
        self.user = types.SimpleNamespace(id=int(user_id))
        self.data = {"custom_id": custom_id, "component_type": 2}
        self.message = message
        self.response = FakeResponse(message)


# ── loading ────────────────────────────────────────────────────────────


def _discord_stub() -> types.ModuleType:
    discord = types.ModuleType("discord")

    class DMChannel:
        pass

    class Intents:
        @staticmethod
        def default() -> Any:
            return types.SimpleNamespace()

    class Client:
        def __init__(self, **kwargs: Any) -> None:
            self.kwargs = kwargs
            self.events: dict[str, Any] = {}
            self.user = types.SimpleNamespace(id=999, mentioned_in=lambda _message: True)

        def event(self, fn: Any) -> Any:
            self.events[fn.__name__] = fn
            return fn

        def is_closed(self) -> bool:
            return False

        async def fetch_channel(self, _channel_id: int) -> Any:
            raise RuntimeError("unknown channel")

        async def fetch_user(self, _user_id: int) -> Any:
            raise RuntimeError("unknown user")

    class File:
        def __init__(self, path: str) -> None:
            self.path = path

    class Embed:
        def __init__(
            self, *, title: Any = None, description: Any = None, color: Any = None
        ) -> None:
            self.title, self.description, self.color = title, description, color
            self.footer: str | None = None

        def set_footer(self, *, text: Any = None) -> Embed:
            self.footer = text
            return self

    class Button:
        def __init__(
            self, *, label: str | None = None, style: Any = None, custom_id: str | None = None
        ) -> None:
            self.label, self.style, self.custom_id = label, style, custom_id

    class View:
        def __init__(self, *, timeout: float | None = 180.0) -> None:
            self.timeout = timeout
            self.children: list[Button] = []
            self.stopped = False

        def add_item(self, item: Button) -> View:
            if len(self.children) >= 25:
                raise ValueError("maximum number of children exceeded")
            self.children.append(item)
            return self

        def stop(self) -> None:
            self.stopped = True

    discord.DMChannel = DMChannel  # type: ignore[attr-defined]
    discord.Intents = Intents  # type: ignore[attr-defined]
    discord.Client = Client  # type: ignore[attr-defined]
    discord.File = File  # type: ignore[attr-defined]
    discord.Embed = Embed  # type: ignore[attr-defined]
    discord.ButtonStyle = types.SimpleNamespace(secondary="secondary")  # type: ignore[attr-defined]
    discord.ui = types.SimpleNamespace(View=View, Button=Button)  # type: ignore[attr-defined]
    return discord


def _install_stubs(monkeypatch: Any) -> None:
    monkeypatch.setattr(sys, "path", list(sys.path))  # dcapp prepends the code root
    monkeypatch.setitem(sys.modules, "discord", _discord_stub())

    agentmain = types.ModuleType("agentmain")
    agentmain.GeneraticAgent = FakeAgent  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agentmain", agentmain)

    llmcore = types.ModuleType("llmcore")
    llmcore.mykeys = {}  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "llmcore", llmcore)

    continue_cmd = types.ModuleType("continue_cmd")
    continue_cmd.handle_frontend_command = lambda _agent, cmd: f"continue: {cmd}"  # type: ignore[attr-defined]
    continue_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    continue_cmd.reset_conversation = lambda _agent: "✅ 已开启新对话"  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "continue_cmd", continue_cmd)

    btw_cmd = types.ModuleType("btw_cmd")
    btw_cmd.handle_frontend_command = lambda _agent, cmd: f"btw: {cmd}"  # type: ignore[attr-defined]
    btw_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "btw_cmd", btw_cmd)

    review_cmd = types.ModuleType("review_cmd")
    review_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "review_cmd", review_cmd)

    # The real chatapp_common (clean_reply, split, help text), over the stubs.
    _exec_module(monkeypatch, "chatapp_common", _CODE_ROOT / "frontends" / "chatapp_common.py")


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


class Env:
    def __init__(self, dcapp: Any, clock: FakeClock, channel: FakeChannel) -> None:
        self.dcapp = dcapp
        self.clock = clock
        self.channel = channel
        self.app = dcapp.DiscordApp()
        self.app._clock = clock
        self.app._remember_channel(CHAT, channel)

    @property
    def agent(self) -> FakeAgent:
        agent = self.app._get_agent(CHAT).agent
        assert isinstance(agent, FakeAgent)
        return agent

    def trigger(self, content: str = "hi") -> FakeMessage:
        """A user's message in the channel (not a bot send)."""
        message = FakeMessage(self.channel, content)
        self.channel.last_message_id = message.id
        return message

    def run(self, body: Callable[[], Awaitable[None]]) -> None:
        async def main() -> None:
            self.app.loop = asyncio.get_running_loop()
            try:
                await asyncio.wait_for(body(), 20)
            finally:
                for task in list(self.app.background_tasks):
                    task.cancel()

        asyncio.run(main())


@pytest.fixture
def env(monkeypatch: Any, tmp_path: Path) -> Env:
    _install_stubs(monkeypatch)
    monkeypatch.setenv(
        "GALLEY_DISCORD_CONFIG_JSON",
        json.dumps({"discord_bot_token": "t", "discord_allowed_users": [OWNER]}),
    )
    monkeypatch.setenv("GALLEY_DISCORD_STATE_DIR", str(tmp_path / "discord"))
    dcapp = _exec_module(monkeypatch, "_galley_test_dcapp", _CODE_ROOT / "frontends" / "dcapp.py")
    monkeypatch.setattr(dcapp, "STATUS_POLL_SECONDS", 0.05)
    clock = FakeClock()
    FakeAgent.clock = clock
    return Env(dcapp, clock, FakeChannel())


# ── script helpers ─────────────────────────────────────────────────────


def turn_text(k: int, body: str, tool: str | None = None) -> str:
    text = f"\nLLM Running (Turn {k}) ...\n\n{body}\n"
    return text + (f"🛠️ {tool}\n" if tool else "")


def nxt(texts: list[str], advance: float = 0.0, **extra: Any) -> tuple[Any, ...]:
    item = {"next": "".join(texts), "source": "discord", "turn": len(texts), "outputs": texts[-2:]}
    return ("item", {**item, **extra}, advance)


def done(texts: list[str], advance: float = 0.0, tail: str = "", **extra: Any) -> tuple[Any, ...]:
    item = {
        "done": "".join(texts) + tail, "source": "discord", "turn": len(texts),
        "outputs": list(texts),
    }
    return ("item", {**item, **extra}, advance)


def ask_ctx(question: str, candidates: list[str], tool_calls: Any = None) -> dict[str, Any]:
    return {
        "exit_reason": {
            "result": "EXITED",
            "data": {
                "status": "INTERRUPT",
                "intent": "HUMAN_INTERVENTION",
                "data": {"question": question, "candidates": candidates},
            },
        },
        "tool_calls": tool_calls or [],
    }


async def wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.005)


async def drain(app: Any) -> None:
    for _ in range(50):
        pending = [task for task in app.background_tasks if not task.done()]
        if not pending:
            break
        await asyncio.gather(*pending)
    await asyncio.sleep(0)


def reply_to(message: FakeMessage) -> dict[str, Any]:
    return {"reference": ("ref", message.id, False), "mention_author": False}


ASK_T1 = turn_text(1, "<summary>查看现状</summary>", 'code_run({"script": "ls"})')
ASK_T2 = turn_text(
    2,
    "<summary>确认方向</summary>我需要你确认一下。",
    "ask_user(用哪个方案？\ncandidates:\n- 方案 A\n- 方案 B)",
)


async def ask_two_steps(env: Env) -> FakeMessage:
    """A 2-step run (10 s) that ends asking 用哪个方案？ [方案 A, 方案 B]."""
    env.agent.scripts.append([
        nxt([ASK_T1]),
        nxt([ASK_T1, ASK_T2], 4.0),
        ("ask", ask_ctx("用哪个方案？", ["方案 A", "方案 B"])),
        done([ASK_T1, ASK_T2], 6.0),
    ])
    await env.app.run_agent(CHAT, "改一下", reply_to=env.trigger())
    return env.channel.sent[-1]


async def ask_once(env: Env, question: str, candidates: list[str]) -> FakeMessage:
    t1 = turn_text(1, "", f"ask_user({question})")
    env.agent.scripts.append([nxt([t1]), ("ask", ask_ctx(question, candidates)), done([t1], 1.0)])
    await env.app.run_agent(CHAT, "问我", reply_to=env.trigger())
    return env.channel.sent[-1]


# ── 01: status message ─────────────────────────────────────────────────


def test_single_step_answer_replaces_status_message(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>打招呼</summary>你好！")
        env.agent.scripts.append([nxt([t1]), done([t1], 3.0)])
        trigger = env.trigger()
        await env.app.run_agent(CHAT, "hi", reply_to=trigger)
        await asyncio.sleep(0)

        status, answer = env.channel.sent
        assert status.content == "·· 思考中"
        assert status.kwargs == reply_to(trigger)
        assert status.deleted
        assert answer.content == "-# 1 步 · 用时 3 秒\n你好！"
        assert answer.kwargs == {}  # right under its status message: no quote
        assert env.channel.typing_entered == 1 and env.channel.typing_exited == 1
        assert CHAT not in env.app.user_tasks
        assert env.agent.tasks[0][0] == f"{env.dcapp.FILE_HINT}\n\nhi"

    env.run(body)


def test_multi_step_status_edits_and_answer_is_last_step_only(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(
            1, "<summary>读取会话列表</summary>我先查一下会话列表",
            'code_run({"script": "galley session list"})',
        )
        t2 = turn_text(2, "<summary>整理结果</summary>", 'file_read({"path": "a.md"})')
        t3 = turn_text(3, "<summary>回答</summary>一共有 3 个会话在跑。")
        env.agent.scripts.append([
            nxt([t1]),
            nxt([t1, t2], 2.0),
            nxt([t1, t2, t3], 2.0),
            done([t1, t2, t3], 6.0),
        ])
        await env.app.run_agent(CHAT, "看看", reply_to=env.trigger())

        status, answer = env.channel.sent
        contents = [edit["content"] for edit in status.edits]
        assert contents == [
            "01 读取会话列表\n·· 思考中",
            "已完成 2 步\n02 整理结果\n·· 思考中",
        ]
        # No button, ever: stopping is the text /stop.
        assert status.kwargs.get("view") is None
        assert all(edit.get("view") is None for edit in status.edits)
        assert status.view is None
        assert status.deleted
        assert answer.content == "-# 3 步 · 用时 10 秒\n一共有 3 个会话在跑。"
        assert "我先查一下" not in answer.content

    env.run(body)


def test_status_edits_are_throttled(env: Env) -> None:
    async def body() -> None:
        texts = [turn_text(k, f"<summary>第 {k} 步</summary>", "code_run({})") for k in range(1, 5)]
        final = turn_text(5, "好了")
        env.agent.scripts.append([
            nxt(texts[:1]),
            nxt(texts[:2], 0.5),  # 0.5 s after the status send: merged, not edited
            nxt(texts[:3], 0.5),
            nxt(texts[:4], 1.0),  # 2.0 s: one edit carrying the newest state
            done([*texts, final], 1.0),
        ])
        await env.app.run_agent(CHAT, "跑", reply_to=env.trigger())
        status = env.channel.sent[0]
        assert [edit["content"] for edit in status.edits] == ["已完成 3 步\n03 第 3 步\n·· 思考中"]

    env.run(body)


def test_long_step_shows_minutes_still_running(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>跑测试</summary>", "code_run({})")
        run_task = asyncio.create_task(env.app.run_agent(CHAT, "跑测试", reply_to=env.trigger()))
        await wait_until(lambda: bool(env.agent.tasks))
        dq = env.agent.tasks[0][2]
        dq.put(nxt([t1])[1])
        await wait_until(lambda: env.app._running_run(CHAT) is not None)
        env.clock.now += 125
        status = env.channel.sent[0]
        await wait_until(lambda: "已 2 分钟" in (status.content or ""))
        assert status.content == "·· 思考中 · 已 2 分钟 · 仍在运行"
        dq.put(done([t1, turn_text(2, "完成")])[1])
        await run_task

    env.run(body)


def test_status_content_rendering(env: Env) -> None:
    # Pure rendering (asyncio.Event binds its loop lazily on 3.10+).
    run = env.dcapp._DiscordRun(CHAT, None)
    render = env.dcapp._status_content
    assert render(run, 0.0) == "·· 思考中"
    run.queued = True
    assert render(run, 0.0) == "·· 排队中"
    run.started_at = run.step_started_at = 0.0
    run.task_turn = 1
    assert render(run, 59.0) == "·· 思考中"
    assert render(run, 60.0) == "·· 思考中 · 已 1 分钟 · 仍在运行"
    run.task_turn, run.last_summary, run.step_started_at = 3, "读取会话列表", 50.0
    assert render(run, 60.0) == "已完成 2 步\n02 读取会话列表\n·· 思考中"
    run.adopt({"steps": 9, "elapsed": 1.0, "summary": ""})
    assert render(run, 60.0) == "已完成 11 步\n11\n·· 思考中"


def test_summary_fallbacks(env: Env) -> None:
    summary = env.dcapp._step_summary
    assert summary(turn_text(1, "<summary>a</summary>x<summary>最后  一个\n摘要</summary>")) == (
        "最后 一个 摘要"
    )
    assert summary("<summary>外部</summary><thinking><summary>内部</summary></thinking>") == "外部"
    assert summary(turn_text(1, "\n\n先看看目录结构\n再说", 'code_run({"script": "ls"})')) == (
        "先看看目录结构"
    )
    assert summary(turn_text(1, "", 'code_run({"script": "ls"})')) == "调用了运行代码"
    assert summary(turn_text(1, "", "web_execute_js({})")) == "调用了执行网页脚本"
    assert summary(turn_text(1, "", "update_working_checkpoint(x)")) == (
        "调用了update_working_checkpoint"
    )
    assert summary("") == ""
    assert summary(f"<summary>{'长' * 200}</summary>") == "长" * 120


def test_fold_label_and_elapsed_format(env: Env) -> None:
    fold = env.dcapp._fold_label
    assert fold(1, 0.4) == "1 步"
    assert fold(2, 0.5) == "2 步 · 用时 1 秒"
    assert fold(3, 59.4) == "3 步 · 用时 59 秒"
    assert fold(3, 59.5) == "3 步 · 用时 1 分 0 秒"
    assert fold(12, 125) == "12 步 · 用时 2 分 5 秒"
    assert fold(0, 0) == ""
    assert env.dcapp._stopped_text(0, 0) == "⏹ 已停止"


def test_backend_error_tail_stays_in_answer(env: Env) -> None:
    t1 = turn_text(1, "<summary>调用模型</summary>", "code_run({})")
    t2 = turn_text(2, "")
    tail = "\n```\nError: HTTP 524\n```"
    step = env.dcapp._final_step_text("".join([t1, t2]) + tail, [t1, t2])
    assert step == t2 + tail
    assert "HTTP 524" in env.dcapp._answer_body(step, t1 + t2 + tail)


def test_queued_run_and_registration_survive_first_run(env: Env) -> None:
    async def body() -> None:
        a1 = turn_text(1, "第一个回答")
        b1 = turn_text(1, "第二个回答")
        agent = env.agent
        task_a = asyncio.create_task(env.app.run_agent(CHAT, "one", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 1)
        task_b = asyncio.create_task(env.app.run_agent(CHAT, "two", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 2)

        status_b = env.channel.sent[1]
        assert status_b.content == "·· 排队中"
        assert len(env.app.user_tasks[CHAT]) == 2

        agent.tasks[0][2].put(nxt([a1])[1])
        agent.tasks[0][2].put(done([a1])[1], 2.0)
        await task_a
        # The first run's finally removed only itself: the reporter still
        # sees the channel busy, and /stop still finds the queue.
        runs = env.app.user_tasks.get(CHAT)
        assert runs and len(runs) == 1 and runs[0].trigger is not None
        assert env.channel.typing_entered == 1  # the queued run never typed

        agent.tasks[1][2].put(nxt([b1])[1])
        agent.tasks[1][2].put(done([b1])[1], 1.0)
        await task_b
        assert CHAT not in env.app.user_tasks
        assert status_b.deleted
        assert env.channel.sent[-1].content == "-# 1 步 · 用时 1 秒\n第二个回答"

    env.run(body)


def test_answer_quotes_trigger_when_other_messages_intervened(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "答")

        def someone_spoke() -> None:
            env.channel.last_message_id = 4242

        env.agent.scripts.append([nxt([t1]), done([t1], 1.0, _effect=someone_spoke)])
        trigger = env.trigger()
        await env.app.run_agent(CHAT, "hi", reply_to=trigger)
        answer = env.channel.sent[-1]
        assert answer.content == "-# 1 步 · 用时 1 秒\n答"
        assert answer.kwargs == reply_to(trigger)

    env.run(body)


def test_delete_failure_falls_back_to_done_marker(env: Env) -> None:
    async def body() -> None:
        env.channel.fail_delete = True
        t1 = turn_text(1, "答")
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        await env.app.run_agent(CHAT, "hi", reply_to=env.trigger())
        status = env.channel.sent[0]
        assert not status.deleted
        assert status.edits[-1] == {"content": "-# ✓ 已完成"}

    env.run(body)


def test_exception_before_task_posts_error(env: Env) -> None:
    async def body() -> None:
        env.agent.fail_put = RuntimeError("boom")
        await env.app.run_agent(CHAT, "hi", reply_to=env.trigger())
        status, error = env.channel.sent
        assert status.deleted
        assert error.content == "❌ 出错：boom"
        assert CHAT not in env.app.user_tasks

    env.run(body)


def test_exception_mid_run_posts_counts_and_error(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>一</summary>", "code_run({})")
        t2 = turn_text(2, "答")

        def break_next_send() -> None:
            env.channel.fail_next_send = RuntimeError("send failed")

        env.agent.scripts.append([
            nxt([t1]), nxt([t1, t2], 1.0), done([t1, t2], 3.0, _effect=break_next_send),
        ])
        await env.app.run_agent(CHAT, "hi", reply_to=env.trigger())
        status, error = env.channel.sent
        assert status.deleted
        assert error.content == "-# 2 步 · 用时 4 秒\n❌ 出错：send failed"

    env.run(body)


def test_stop_command_freezes_status_and_keeps_queue(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>长任务</summary>", "code_run({})")
        agent = env.agent
        task_a = asyncio.create_task(env.app.run_agent(CHAT, "one", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 1)
        agent.tasks[0][2].put(nxt([t1])[1])
        await wait_until(lambda: env.app._running_run(CHAT) is not None)
        task_b = asyncio.create_task(env.app.run_agent(CHAT, "two", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 2)
        env.clock.now += 7

        sent_before = len(env.channel.sent)
        await env.app.handle_command(CHAT, "/stop")
        assert len(env.channel.sent) == sent_before  # no "正在停止" message
        status_a = env.channel.sent[0]
        assert status_a.content == "⏹ 已停止 · 1 步 · 用时 7 秒"
        assert status_a.view is None
        assert agent.aborted == 1
        await task_a
        assert not status_a.deleted
        assert len(env.app.user_tasks[CHAT]) == 1  # the queued run is untouched

        agent.tasks[1][2].put(nxt([turn_text(1, "二")])[1])
        agent.tasks[1][2].put(done([turn_text(1, "二")])[1])
        await task_b
        assert env.channel.sent[-1].content == "-# 1 步\n二"

    env.run(body)


def test_stop_command_without_running_run(env: Env) -> None:
    async def body() -> None:
        await env.app.handle_command(CHAT, "/stop")
        assert env.channel.sent[-1].content == "当前没有在跑的任务"
        assert env.agent.aborted == 0

    env.run(body)


def test_old_stop_button_is_stale_while_a_run_goes(env: Env) -> None:
    """Status messages no longer carry a 停止 button; one left by an earlier
    process is acknowledged and stripped, and never stops the channel's run."""

    async def body() -> None:
        t1 = turn_text(1, "<summary>长任务</summary>", "code_run({})")
        agent = env.agent
        task = asyncio.create_task(env.app.run_agent(CHAT, "one", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 1)
        agent.tasks[0][2].put(nxt([t1])[1])
        await wait_until(lambda: env.app._running_run(CHAT) is not None)
        old = FakeMessage(env.channel, "·· 思考中", view=object())

        stranger = FakeInteraction("7", "galley-dc:stop:deadbeef", old)
        await env.app._handle_interaction(stranger)
        assert stranger.response.calls == [("defer", {})]
        assert old.edits == []

        click = FakeInteraction(OWNER, "galley-dc:stop:deadbeef", old)
        await env.app._handle_interaction(click)
        assert click.response.calls == [("defer", {})]
        assert old.edits == [{"view": None}]
        assert agent.aborted == 0
        assert env.app._running_run(CHAT) is not None

        agent.tasks[0][2].put(done([t1, turn_text(2, "完成")])[1], 2.0)
        await task
        assert env.channel.sent[0].deleted
        assert env.channel.sent[-1].content == "-# 2 步 · 用时 2 秒\n完成"
        assert CHAT not in env.app.user_tasks

    env.run(body)


def test_deactivation_stops_runs(env: Env) -> None:
    async def body() -> None:
        agent = env.agent
        task = asyncio.create_task(env.app.run_agent(CHAT, "one", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 1)
        agent.tasks[0][2].put(nxt([turn_text(1, "", "code_run({})")])[1])
        await wait_until(lambda: env.app._running_run(CHAT) is not None)
        env.app._deactivate_channel(CHAT)
        await task
        assert env.channel.sent[0].content == "⏹ 已停止 · 1 步"
        assert CHAT not in env.app.user_tasks

    env.run(body)


def test_deliver_embed_truncates_and_raises(env: Env) -> None:
    async def body() -> None:
        app = env.app
        await app.deliver_embed(
            CHAT, title="t" * 300, description="报告正文", color=0x5A8C5A, footer="f" * 3000,
        )
        embed = env.channel.sent[-1].kwargs["embed"]
        assert len(embed.title) == 256
        assert embed.description == "报告正文"
        assert embed.color == 0x5A8C5A
        assert embed.footer == "f" * 2048

        await app.deliver_embed(CHAT, title="t", description="d")
        embed = env.channel.sent[-1].kwargs["embed"]
        assert embed.color is None and embed.footer is None

        count = len(env.channel.sent)
        with pytest.raises(ValueError):
            await app.deliver_embed(CHAT, title="t", description="x" * 4097)
        assert len(env.channel.sent) == count

        env.channel.fail_next_send = RuntimeError("403")
        with pytest.raises(RuntimeError):
            await app.deliver_embed(CHAT, title="t", description="d")
        with pytest.raises(RuntimeError):
            await app.deliver_embed("ch:404", title="t", description="d")  # unresolvable

    env.run(body)


# ── 02: ask_user, buttons, commands ────────────────────────────────────


def test_ask_user_event_extraction(env: Env) -> None:
    extract = env.dcapp._extract_ask_user_event
    ctx = ask_ctx(
        "选哪个？",
        ["A"],
        tool_calls=[
            {"tool_name": "ask_user", "args": {"question": "选哪个？", "candidates": ["A"]}},
            {"tool_name": "ask_user", "args": {"question": "选哪个？", "candidates": ["B"]}},
            {"tool_name": "ask_user", "args": {"question": "别的问题", "candidates": ["C"]}},
        ],
    )
    assert extract(ctx) == {"question": "选哪个？", "candidates": ["A", "B"], "multi": False}
    assert extract({"exit_reason": {"result": "CURRENT_TASK_DONE", "data": None}}) is None
    assert extract({"exit_reason": {}}) is None
    multi = extract(ask_ctx("[多选] 保留哪些？\n第二行", ["x"]))
    assert multi["multi"] and multi["question"] == "[多选] 保留哪些？\n第二行"


def test_ask_layouts(env: Env) -> None:
    layout = env.dcapp._ask_layout

    def event(candidates: list[str], multi: bool = False) -> dict[str, Any]:
        return {"question": "q", "candidates": candidates, "multi": multi}

    assert layout(event(["是", "否"])) == "row"
    assert layout(event(["一", "二", "三", "四", "五"])) == "list"
    assert layout(event(["短", "这是一个超过二十个字的候选项，用来测试列表布局的判定"])) == "list"
    assert layout(event(["一二三四五六七八九十一二三四五六"] * 4)) == "list"  # 64 > 60
    assert layout(event(["一二三四五六七八九十一二三四五"] * 4)) == "row"  # 60
    assert layout(event([f"c{i}" for i in range(26)])) == "text"
    assert layout(event(["a", "b"], multi=True)) == "text"
    assert layout(event([])) == "none"


def test_ask_row_click_continues_run_with_carried_counts(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        status = env.channel.sent[0]
        assert status.deleted
        assert question.content == "-# ⏸ 等你回复 · 已完成 2 步\n我需要你确认一下。\n用哪个方案？"
        assert question.kwargs.get("reference") is None
        assert [b.label for b in question.view.children] == ["方案 A", "方案 B"]
        assert question.view.timeout is None and question.view.stopped  # render-only, never stored
        assert CHAT not in env.app.user_tasks  # waiting for an answer is not busy

        c1 = turn_text(1, "<summary>执行</summary>好的，就用方案 B。")
        env.agent.scripts.append([nxt([c1]), done([c1], 5.0)])
        env.clock.now = 200.0
        custom_id = question.view.children[1].custom_id
        click = FakeInteraction(OWNER, custom_id, question)
        await env.app._handle_interaction(click)
        assert click.response.calls == [(
            "edit_message",
            {
                "content": (
                    "-# 已回复 · 已完成 2 步\n我需要你确认一下。\n用哪个方案？\n"
                    "-# 方案 A\n✓ 方案 B"
                ),
                "view": None,
            },
        )]
        await drain(env.app)

        assert env.agent.tasks[-1][0] == f"{env.dcapp.FILE_HINT}\n\n方案 B"
        status2, answer = env.channel.sent[-2:]
        assert status2.content == "已完成 2 步\n02 确认方向\n·· 思考中"
        assert status2.kwargs == reply_to(question)
        assert status2.deleted
        # Steps and time add up across the pause; the wait (110 -> 200) is not counted.
        assert answer.content == "-# 3 步 · 用时 15 秒\n好的，就用方案 B。"

        again = FakeInteraction(OWNER, custom_id, question)  # an answered question
        await env.app._handle_interaction(again)
        assert again.response.calls == [("defer", {})]
        assert question.edits[-1] == {"view": None}
        assert len(env.agent.tasks) == 2

    env.run(body)


def test_ask_non_owner_click_is_silent(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        click = FakeInteraction("7", question.view.children[0].custom_id, question)
        await env.app._handle_interaction(click)
        assert click.response.calls == [("defer", {})]
        await drain(env.app)
        assert len(env.agent.tasks) == 1
        assert CHAT in env.app._pending_asks

    env.run(body)


def test_ask_typed_answer_echoes_without_tick(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        c1 = turn_text(1, "好的，用 A。")
        env.agent.scripts.append([nxt([c1]), done([c1], 2.0)])
        env.clock.now = 300.0
        trigger = env.trigger("用 A 吧")
        await env.app.run_agent(CHAT, "用 A 吧", reply_to=trigger)

        assert question.edits[0] == {
            "content": (
                "-# 已回复 · 已完成 2 步\n我需要你确认一下。\n用哪个方案？\n-# 方案 A\n-# 方案 B"
            ),
            "view": None,
        }
        status2, answer = env.channel.sent[-2:]
        assert status2.kwargs == reply_to(trigger)
        assert status2.content == "已完成 2 步\n02 确认方向\n·· 思考中"
        assert answer.content == "-# 3 步 · 用时 12 秒\n好的，用 A。"
        assert CHAT not in env.app._pending_asks

    env.run(body)


def test_ask_list_layout_numbers_buttons(env: Env) -> None:
    async def body() -> None:
        candidates = ["甲", "乙", "丙", "丁", "戊"]
        question = await ask_once(env, "选一个", candidates)
        assert question.content == (
            "-# ⏸ 等你回复 · 已完成 1 步\n选一个\n1. 甲\n2. 乙\n3. 丙\n4. 丁\n5. 戊"
        )
        assert [b.label for b in question.view.children] == ["1", "2", "3", "4", "5"]
        env.agent.scripts.append([nxt([turn_text(1, "好")]), done([turn_text(1, "好")])])
        click = FakeInteraction(OWNER, question.view.children[2].custom_id, question)
        await env.app._handle_interaction(click)
        echo = click.response.calls[0][1]["content"]
        assert echo.splitlines()[2:] == ["-# 1. 甲", "-# 2. 乙", "✓ 3. 丙", "-# 4. 丁", "-# 5. 戊"]
        await drain(env.app)
        assert env.agent.tasks[-1][0].endswith("\n\n丙")

    env.run(body)


def test_ask_over_25_candidates_is_plain_text(env: Env) -> None:
    async def body() -> None:
        question = await ask_once(env, "选", [f"c{i}" for i in range(1, 27)])
        assert question.kwargs.get("view") is None
        assert question.content.endswith("25. c25\n26. c26")

    env.run(body)


def test_ask_multi_select_is_plain_text_with_hint(env: Env) -> None:
    async def body() -> None:
        question = await ask_once(env, "[多选] 保留哪些？", ["a", "b"])
        assert question.kwargs.get("view") is None
        assert question.content == (
            "-# ⏸ 等你回复 · 已完成 1 步\n[多选] 保留哪些？\n1. a\n2. b\n"
            "-# 多选：直接回复序号或文字"
        )

    env.run(body)


def test_ask_from_other_task_is_not_claimed(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "答")
        env.agent.scripts.append([
            nxt([t1]), ("foreign_ask", ask_ctx("报告要继续吗？", ["是"])), done([t1], 1.0),
        ])
        await env.app.run_agent(CHAT, "hi", reply_to=env.trigger())
        assert env.channel.sent[-1].content == "-# 1 步 · 用时 1 秒\n答"
        assert CHAT not in env.app._pending_asks

    env.run(body)


def test_new_command_drops_pending_question(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        await env.app.handle_command(CHAT, "/new")
        await drain(env.app)
        assert question.edits[-1] == {"view": None}
        assert CHAT not in env.app._pending_asks
        assert env.channel.sent[-1].content == "✅ 已开启新对话"

        c1 = turn_text(1, "新话题")
        env.agent.scripts.append([nxt([c1]), done([c1])])
        await env.app.run_agent(CHAT, "新话题", reply_to=env.trigger())
        assert env.channel.sent[-1].content == "-# 1 步\n新话题"  # no carry

    env.run(body)


def test_stale_ask_button_after_restart(env: Env) -> None:
    async def body() -> None:
        old = FakeMessage(env.channel, "old question", view=object())
        click = FakeInteraction(OWNER, "galley-dc:ask:deadbeef0000:0", old)
        await env.app._handle_interaction(click)
        assert click.response.calls == [("defer", {})]
        assert old.edits == [{"view": None}]
        assert env.app.user_tasks == {}

        foreign = FakeInteraction(OWNER, "someone-else:1", old)
        await env.app._handle_interaction(foreign)
        assert foreign.response.calls == []

    env.run(body)


def test_help_btw_review_commands(env: Env) -> None:
    async def body() -> None:
        await env.app.handle_command(CHAT, "/help")
        help_text = env.channel.sent[-1].content
        assert help_text == env.dcapp.DISCORD_HELP_TEXT
        assert "/btw <q>" in help_text and "/review [scope]" in help_text
        assert help_text.endswith("退出该频道 / 退出该子区 - 停止在本频道响应")

        trigger = env.trigger("/btw 进展？")
        await env.app.handle_command(CHAT, "/btw 进展？", message=trigger)
        assert env.channel.sent[-1].content == "btw: /btw 进展？"
        assert env.channel.sent[-1].kwargs == reply_to(trigger)

        r1 = turn_text(1, "<summary>审阅</summary>审阅完成")
        env.agent.scripts.append([nxt([r1]), done([r1], 2.0)])
        trigger = env.trigger("/review 看看 diff")
        await env.app.handle_command(CHAT, "/review 看看 diff", message=trigger)
        assert env.agent.tasks[-1][0] == "/review 看看 diff"  # no FILE_HINT in front
        status, answer = env.channel.sent[-2:]
        assert status.kwargs == reply_to(trigger)
        assert answer.content == "-# 1 步 · 用时 2 秒\n审阅完成"

    env.run(body)


def test_message_handler_replies_under_the_trigger(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "你好")
        env.agent.scripts.append([nxt([t1]), done([t1])])
        message = env.trigger("<@999> 你好")
        message.author = types.SimpleNamespace(id=int(OWNER), bot=False)  # type: ignore[attr-defined]
        message.guild = object()  # type: ignore[attr-defined]
        message.attachments = []  # type: ignore[attr-defined]
        await env.app._handle_message(message)
        await drain(env.app)
        activated, status, answer = env.channel.sent
        assert activated.content == env.dcapp.ACTIVATED_TEXT
        assert status.kwargs == reply_to(message)
        assert env.agent.tasks[-1][0].endswith("\n\n你好")
        assert answer.content == "-# 1 步\n你好"

    env.run(body)


def test_channel_agent_gets_ask_hook(env: Env) -> None:
    hooks = env.agent._turn_end_hooks  # type: ignore[attr-defined]
    assert callable(hooks["discord_ask_user"])


# ── reporter seam: runner/im_reporter.py against the real dcapp ─────────


def test_reporter_card_through_real_deliver_embed(env: Env, monkeypatch: Any) -> None:
    """The reporter (runner) and deliver_embed (patch 0023) were built from
    one written contract by two hands: keyword-only signature, the 4096
    split on the reporter side, the threadsafe bridge to the loop."""
    from runner import im_reporter

    monkeypatch.setattr(env.dcapp, "_APP", env.app)
    channel = im_reporter.DiscordChannel(env.dcapp, CHAT)
    report = im_reporter.Report(
        kind="cancelled", session={"id": "s-1", "title": "整理周报"}, message=None
    )
    text = "a" * 4000 + "\n" + "b" * 200

    async def body() -> None:
        await asyncio.to_thread(channel.send_report, OWNER, text, text, report)
        card, overflow = env.channel.sent
        embed = card.kwargs["embed"]
        assert (embed.title, embed.color) == ("整理周报", 0x7A7A8E)
        assert embed.description == "a" * 4000
        assert embed.footer == "已停止 · s-1"
        assert overflow.content == "b" * 200

    env.run(body)


def test_reporter_busy_tracks_queued_and_running_runs(env: Env, monkeypatch: Any) -> None:
    """DiscordChannel.busy() reads app.user_tasks[chat_id]'s truth value
    (coupling point): busy while any run is queued or running, idle after."""
    from runner import im_reporter

    monkeypatch.setattr(env.dcapp, "_APP", env.app)
    channel = im_reporter.DiscordChannel(env.dcapp, CHAT)

    async def body() -> None:
        a1, b1 = turn_text(1, "一"), turn_text(1, "二")
        agent = env.agent
        assert not channel.busy()
        task_a = asyncio.create_task(env.app.run_agent(CHAT, "one", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 1)
        task_b = asyncio.create_task(env.app.run_agent(CHAT, "two", reply_to=env.trigger()))
        await wait_until(lambda: len(agent.tasks) == 2)
        assert channel.busy()
        agent.tasks[0][2].put(nxt([a1])[1])
        agent.tasks[0][2].put(done([a1])[1], 1.0)
        await task_a
        assert channel.busy()  # the queued run still holds the channel
        agent.tasks[1][2].put(nxt([b1])[1])
        agent.tasks[1][2].put(done([b1])[1], 1.0)
        await task_b
        assert not channel.busy()

    env.run(body)
