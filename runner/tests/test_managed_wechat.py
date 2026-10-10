"""Galley's WeChat conversation: ``runner/im_wechat.py``.

Drives ``WechatConversation`` over the shipped ``frontends/wechatapp.py``
transport (a real ``WxBotClient`` whose ``_post`` records the iLink requests
instead of sending them) and the real ``galley_im_display`` /
``chatapp_common``, with GA, the network and crypto stubbed. A fake agent
hands out display queues the tests fill in GA's item shapes (``turn`` and
the step texts in ``outputs``; ``done`` with every step's text), firing the
turn-end hooks of an ask_user exit right before ``done``, as GA does. Time
is an injected clock the queues advance as items are read; the worker
polls every 10 ms. Restart continuity's notice is covered against the real
``ChannelResume`` in ``test_im_resume.py``.
"""

from __future__ import annotations

import importlib.util
import io
import itertools
import json
import queue
import sys
import time
import types
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from runner import im_wechat

_FRONTENDS = Path(__file__).resolve().parents[2] / "managed-ga" / "code" / "frontends"
NEW_CHAT_TEXT = "🆕 已开启新对话，当前上下文已清空"
HINT = im_wechat.FILE_HINT + "\n\n"


# ── loading ────────────────────────────────────────────────────────────


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


def fake_continue_cmd() -> types.ModuleType:
    module = types.ModuleType("continue_cmd")

    def reset_conversation(agent: Any, message: str | None = NEW_CHAT_TEXT) -> Any:
        agent.abort()
        agent.history = []
        return message

    def handle_frontend_command(agent: Any, query: str, exclude_pid: Any = None) -> str:
        if query.strip() == "/continue":
            return "可恢复会话列表"
        if query.strip() == "/continue 1":
            reset_conversation(agent, message=None)
            return "✅ 已恢复 3 轮完整对话"
        return "❌ 索引越界（有效范围 1-1）"

    module.reset_conversation = reset_conversation  # type: ignore[attr-defined]
    module.handle_frontend_command = handle_frontend_command  # type: ignore[attr-defined]
    module.install = lambda _cls: None  # type: ignore[attr-defined]
    return module


def load_display(monkeypatch: Any, agent_cls: Any = object, continue_cmd: Any = None) -> Any:
    """The payload's ``chatapp_common`` and ``galley_im_display`` as the
    top-level modules the WeChat process imports, over a stubbed GA
    (``agent_cls``) and stubbed command modules; ``continue_cmd`` is a real
    one a test already loaded, else a fake."""
    monkeypatch.setattr(sys, "path", list(sys.path))  # chatapp_common prepends the code root
    agentmain = types.ModuleType("agentmain")
    agentmain.GeneraticAgent = agent_cls  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agentmain", agentmain)
    if continue_cmd is None:
        continue_cmd = fake_continue_cmd()
    monkeypatch.setitem(sys.modules, "continue_cmd", continue_cmd)
    btw_cmd = types.ModuleType("btw_cmd")
    btw_cmd.handle_frontend_command = lambda _agent, cmd: f"btw: {cmd}"  # type: ignore[attr-defined]
    btw_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "btw_cmd", btw_cmd)
    review_cmd = types.ModuleType("review_cmd")
    review_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "review_cmd", review_cmd)
    _exec_module(monkeypatch, "chatapp_common", _FRONTENDS / "chatapp_common.py")
    return _exec_module(monkeypatch, "galley_im_display", _FRONTENDS / "galley_im_display.py")


def load_wechatapp(monkeypatch: Any, tmp_path: Path) -> Any:
    """The shipped wechatapp with requests, qrcode and Crypto stubbed (its
    module agent is whatever ``agentmain.GeneraticAgent`` is by then)."""
    cipher = types.ModuleType("Crypto.Cipher")
    cipher.AES = types.SimpleNamespace(MODE_ECB=1, new=None)  # type: ignore[attr-defined]
    crypto = types.ModuleType("Crypto")
    crypto.Cipher = cipher  # type: ignore[attr-defined]
    for name, module in (
        ("requests", types.ModuleType("requests")),
        ("qrcode", types.ModuleType("qrcode")),
        ("Crypto", crypto),
        ("Crypto.Cipher", cipher),
    ):
        monkeypatch.setitem(sys.modules, name, module)
    # wechatapp pops these at import; monkeypatch puts them back afterwards.
    monkeypatch.delenv("HTTPS_PROXY", raising=False)
    monkeypatch.delenv("https_proxy", raising=False)
    monkeypatch.setenv("GALLEY_WECHAT_TEMP_DIR", str(tmp_path / "wx-temp"))
    monkeypatch.setenv("GALLEY_WECHAT_TOKEN_FILE", str(tmp_path / "wx" / "token.json"))
    monkeypatch.setattr(sys, "path", list(sys.path))  # wechatapp prepends the code root
    monkeypatch.setitem(sys.__dict__, "__stdout__", io.StringIO())  # wechatapp logs there
    return _exec_module(monkeypatch, "_galley_test_wechatapp", _FRONTENDS / "wechatapp.py")


# ── fakes ──────────────────────────────────────────────────────────────


class FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class TaskQueue:
    """A task's display queue. Reading an item advances the clock, makes GA
    run this task (idle once `done` is read) and fires the item's `_ask`
    (a turn-end ctx of this task) or `_foreign_ask` (of another task, e.g.
    a reporter turn)."""

    def __init__(self, agent: FakeAgent) -> None:
        self.agent = agent
        self.items: queue.Queue[tuple[float, dict[str, Any]]] = queue.Queue()

    def put(self, item: dict[str, Any], advance: float = 0.0) -> None:
        self.items.put((advance, item))

    def get(self, block: bool = True, timeout: float | None = None) -> dict[str, Any]:
        advance, item = self.items.get(block, timeout)
        self.agent.clock.now += advance
        item = dict(item)
        ask, foreign = item.pop("_ask", None), item.pop("_foreign_ask", None)
        if foreign is not None:
            self.agent._current_queue = object()
            self.agent.fire_hooks(foreign)
        self.agent._current_queue = self
        self.agent.is_running = "done" not in item
        if ask is not None:
            self.agent.fire_hooks(ask)
        return item


class FakeAgent:
    def __init__(self) -> None:
        self.clock = FakeClock()
        self.verbose = True
        self.is_running = False
        self._current_queue: Any = None
        self.llm_no = 0
        self.llmclient: Any = object()
        self.history: list[str] = ["[USER]: earlier"]
        self.llms = ["NativeClaude/a", "NativeOAI/b"]
        self.tasks: list[tuple[str, str, TaskQueue]] = []
        self.scripts: list[list[tuple[dict[str, Any], float]]] = []
        self.aborts = 0
        self.fail_put: Exception | None = None

    def put_task(self, query: str, source: str = "user", images: Any = None) -> TaskQueue:
        if self.fail_put is not None:
            raise self.fail_put
        dq = TaskQueue(self)
        for item, advance in self.scripts.pop(0) if self.scripts else []:
            dq.put(item, advance)
        self.tasks.append((query, source, dq))
        return dq

    def abort(self) -> None:
        self.aborts += 1

    def fire_hooks(self, ctx: dict[str, Any]) -> None:
        for hook in list(getattr(self, "_turn_end_hooks", {}).values()):
            hook(ctx)

    def list_llms(self) -> list[tuple[int, str, bool]]:
        return [(i, name, i == self.llm_no) for i, name in enumerate(self.llms)]

    def next_llm(self, n: int = -1) -> None:
        self.llm_no = n % len(self.llms)

    def get_llm_name(self) -> str:
        return self.llms[self.llm_no]


class ILink:
    """iLink's side of a real WxBotClient: every request it would POST, in
    order, and canned replies."""

    def __init__(self) -> None:
        self.posts: list[tuple[str, dict[str, Any]]] = []
        self.log: list[tuple[str, Any]] = []
        self.ticket = "T1"
        self.fail: Exception | None = None
        self.refuse: dict[str, Any] | None = None
        self.ids = itertools.count(1)

    def post(self, ep: str, body: dict[str, Any], timeout: int = 15) -> dict[str, Any]:
        self.posts.append((ep, body))
        if ep == "ilink/bot/sendmessage":
            if self.fail is not None:
                raise self.fail
            if self.refuse is not None:
                return self.refuse
            self.log.append(("text", body["msg"]["item_list"][0]["text_item"]["text"]))
            return {"message_id": next(self.ids)}
        if ep == "ilink/bot/getconfig":
            self.log.append(("ticket", body))
            return {"typing_ticket": self.ticket}
        if ep == "ilink/bot/sendtyping":
            self.log.append(("typing", body["status"]))
        return {}

    def media(self, kind: str) -> Callable[..., dict[str, Any]]:
        def send(to_user_id: str, file_path: str, context_token: str = "") -> dict[str, Any]:
            self.log.append((kind, file_path))
            return {"message_id": next(self.ids)}

        return send

    def texts(self) -> list[str]:
        return [str(value) for kind, value in self.log if kind == "text"]

    def messages(self) -> list[dict[str, Any]]:
        return [body["msg"] for ep, body in self.posts if ep == "ilink/bot/sendmessage"]


def wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        time.sleep(0.005)


def text_item(text: str) -> dict[str, Any]:
    return {"type": 1, "text_item": {"text": text}}


def message(*items: dict[str, Any], uid: str = "u1", ctx: str = "c1") -> dict[str, Any]:
    return {"from_user_id": uid, "context_token": ctx, "message_type": 1, "item_list": list(items)}


@dataclass
class World:
    wx: Any
    conv: im_wechat.WechatConversation
    agent: FakeAgent
    ilink: ILink
    clock: FakeClock
    state_dir: Path

    def send(self, *items: dict[str, Any], uid: str = "u1", ctx: str = "c1") -> None:
        self.conv.on_message(self.conv.bot, message(*items, uid=uid, ctx=ctx))

    def say(self, text: str, uid: str = "u1", ctx: str = "c1") -> None:
        self.send(text_item(text), uid=uid, ctx=ctx)

    def texts(self) -> list[str]:
        return self.ilink.texts()

    def task(self, index: int = -1) -> TaskQueue:
        return self.agent.tasks[index][2]

    def prompts(self) -> list[str]:
        return [query for query, _source, _dq in self.agent.tasks]

    def running(self) -> None:
        """The head run has read its first item."""
        wait_for(lambda: bool(self.conv._runs) and self.conv._runs[0].state == "running")

    def settle(self) -> None:
        """Every run posted, the indicator down, the worker gone."""
        wait_for(lambda: self.conv._worker is None)


def make_world(monkeypatch: Any, tmp_path: Path, resume: Any = None) -> World:
    load_display(monkeypatch, FakeAgent)
    wx = load_wechatapp(monkeypatch, tmp_path)
    agent = wx.agent
    assert isinstance(agent, FakeAgent)
    ilink = ILink()
    bot = wx.WxBotClient(token="tok", token_file=str(tmp_path / "wx" / "token.json"))
    bot._post = ilink.post
    bot.send_image, bot.send_file, bot.send_video = (
        ilink.media("image"),
        ilink.media("file"),
        ilink.media("video"),
    )
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    conv = im_wechat.WechatConversation(wx, bot, state_dir, resume, clock=agent.clock)
    conv.poll_seconds = 0.01
    conv.typing_seconds = 3600.0  # one refresh per busy spell: deterministic
    return World(wx, conv, agent, ilink, agent.clock, state_dir)


@pytest.fixture
def world(monkeypatch: Any, tmp_path: Path) -> World:
    return make_world(monkeypatch, tmp_path)


class FakeResume:
    def __init__(self, cc: Any) -> None:
        self.cc = cc
        self.fresh_calls: list[Any] = []
        self.continued: list[str] = []

    def fresh(self, agent: Any) -> None:
        self.fresh_calls.append(agent)

    def continue_session(self, agent: Any, query: str, upstream: Callable[[], Any]) -> Any:
        self.continued.append(query)
        return upstream()

    def take_notice(self) -> str:
        return ""

    def restore_notice(self) -> None:
        pass


# ── script helpers ─────────────────────────────────────────────────────


def turn_text(k: int, body: str, tool: str | None = None) -> str:
    text = f"\nLLM Running (Turn {k}) ...\n\n{body}\n"
    return text + (f"🛠️ {tool}\n" if tool else "")


def nxt(texts: list[str], advance: float = 0.0) -> tuple[dict[str, Any], float]:
    """A `next` item: the step's text so far, the last two step texts."""
    item = {"next": texts[-1], "source": "wechat", "turn": len(texts), "outputs": texts[-2:]}
    return (item, advance)


def done(texts: list[str], advance: float = 0.0, **extra: Any) -> tuple[dict[str, Any], float]:
    item = {"done": "".join(texts), "source": "wechat", "turn": len(texts), "outputs": list(texts)}
    return ({**item, **extra}, advance)


def ask_ctx(question: str, candidates: list[str]) -> dict[str, Any]:
    return {
        "exit_reason": {
            "result": "EXITED",
            "data": {
                "status": "INTERRUPT",
                "intent": "HUMAN_INTERVENTION",
                "data": {"question": question, "candidates": candidates},
            },
        },
        "tool_calls": [],
    }


def one_step(world: World, body: str, seconds: float = 1.0) -> None:
    t1 = turn_text(1, body)
    world.agent.scripts.append([nxt([t1]), done([t1], seconds)])


# ── answers ────────────────────────────────────────────────────────────


def test_a_run_posts_one_message_its_closing_step_with_a_last_line(world: World) -> None:
    t1 = turn_text(
        1,
        "<summary>读取会话列表</summary>我先查一下会话列表",
        'code_run({"script": "galley session list"})',
    )
    t2 = turn_text(2, "<summary>整理结果</summary>", 'file_read({"path": "a.md"})')
    t3 = turn_text(3, "<summary>回答</summary>一共有 3 个会话在跑。")
    world.agent.scripts.append(
        [
            nxt([t1]),
            nxt([t1, t2], 2.0),
            nxt([t1, t2, t3], 2.0),
            done([t1, t2, t3], 6.0),
        ]
    )
    world.clock.now += 30  # queued time does not count
    world.say("看看")
    world.settle()

    assert world.texts() == ["一共有 3 个会话在跑。\n\n3 步 · 用时 10 秒"]
    assert world.agent.tasks[0][:2] == (HINT + "看看", "wechat")


def test_a_one_step_answer_has_no_last_line(world: World) -> None:
    one_step(world, "<summary>打招呼</summary>你好！", 3.0)
    world.say("hi")
    world.settle()
    assert world.texts() == ["你好！"]


def test_a_step_longer_than_five_minutes_still_answers(world: World) -> None:
    """Upstream gave up after 300 s without an item and answered with half
    a run; nothing times out now."""
    t1 = turn_text(1, "<summary>跑测试</summary>", "code_run({})")
    t2 = turn_text(2, "测试全部通过。")
    world.say("跑一下测试")
    world.task().put(*nxt([t1]))
    world.task().put(*nxt([t1, t2], 2.0))
    world.running()
    time.sleep(0.1)  # many empty polls
    assert world.texts() == []
    world.task().put(*done([t1, t2], 360.0))
    world.settle()
    assert world.texts() == ["测试全部通过。\n\n2 步 · 用时 6 分 2 秒"]


def test_long_answer_splits_under_the_limit_keeping_its_start_and_last_line(
    world: World,
) -> None:
    paragraphs = [f"第{i:02d}段" + "内容" * 147 for i in range(30)]
    body = "\n\n".join(paragraphs)
    assert len(body) == 8998
    t1 = turn_text(1, "<summary>查</summary>", "code_run({})")
    t2 = turn_text(2, body)
    world.agent.scripts.append([nxt([t1]), nxt([t1, t2], 1.0), done([t1, t2], 1.0)])
    world.say("写长文")
    world.settle()

    parts = world.texts()
    assert len(parts) == 3
    assert all(len(part) <= im_wechat.TEXT_LIMIT for part in parts)
    assert parts[0].startswith("第00段")
    assert parts[-1].endswith("第29段" + "内容" * 147 + "\n\n2 步 · 用时 2 秒")
    assert "\n\n".join(parts) == body + "\n\n2 步 · 用时 2 秒"
    # Each part is a new message: iLink drops a reused client_id.
    ids = [msg["client_id"] for msg in world.ilink.messages()]
    assert len(set(ids)) == len(ids) == 3


def test_split_message_mends_code_blocks_and_prefers_paragraphs() -> None:
    code = [f"x = {i}" for i in range(30)]
    text = "开头\n\n```python\n" + "\n".join(code) + "\n```\n\n结尾"
    parts = im_wechat.split_message(text, 100)
    assert len(parts) > 1 and all(len(part) <= 100 for part in parts)
    assert all(part.count("```") % 2 == 0 for part in parts)  # every part's fences close
    assert parts[0].startswith("开头") and parts[-1].endswith("结尾")
    assert all(part.startswith("```python\n") for part in parts[1:-1])
    lines = [line for part in parts for line in part.split("\n") if line.startswith("x = ")]
    assert lines == code

    # A blank line beats a later line end.
    text = "a" * 40 + "\n\n" + "b" * 30 + "\n" + "c" * 40
    assert im_wechat.split_message(text, 100) == ["a" * 40, "b" * 30 + "\n" + "c" * 40]
    # A line longer than a message is cut inside it, nothing lost.
    assert im_wechat.split_message("x" * 250, 100) == ["x" * 100, "x" * 100, "x" * 50]
    assert im_wechat.split_message("  \n ", 100) == []


def test_file_markers_show_as_names_and_the_files_follow(world: World, tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / "x.png").write_bytes(b"png")
    temp = Path(world.wx._TEMP_DIR)
    (temp / "report.pdf").write_bytes(b"pdf")
    one_step(
        world, f"图做好了：[FILE:{out / 'x.png'}]\n报告在 [FILE:report.pdf]\n示例 [FILE:filepath]"
    )
    world.say("画图")
    world.settle()

    assert world.texts() == ["图做好了：x.png\n报告在 report.pdf\n示例 filepath"]
    sent = [entry for entry in world.ilink.log if entry[0] in ("text", "image", "file", "video")]
    assert sent == [
        ("text", "图做好了：x.png\n报告在 report.pdf\n示例 filepath"),
        ("image", str(out / "x.png")),
        ("file", str(temp / "report.pdf")),
    ]


def test_a_video_goes_out_as_a_video(world: World, tmp_path: Path) -> None:
    (tmp_path / "a.mp4").write_bytes(b"mp4")
    one_step(world, f"[FILE:{tmp_path / 'a.mp4'}]")
    world.say("剪个视频")
    world.settle()
    assert world.texts() == ["a.mp4"]  # the marker alone still reads as its name
    assert ("video", str(tmp_path / "a.mp4")) in world.ilink.log


def test_markdown_goes_out_as_written_minus_images(world: World) -> None:
    body = (
        "### 结论\n\n1. 第一步\n2. 第二步\n\n- 要点\n\n> 引用\n\n"
        "[文档](https://example.com/doc) 与 https://example.com\n\n"
        "| a | b |\n|---|---|\n| 1 | 2 |\n\n![图](https://example.com/x.png)\n\n"
        "```\nprint(1)\n```\n\n**粗体** `code`"
    )
    one_step(world, body)
    world.say("给个总结")
    world.settle()
    assert world.texts() == [body.replace("![图](https://example.com/x.png)\n\n", "")]


def test_answer_text_is_the_closing_step_without_a_last_line(world: World) -> None:
    raw = turn_text(1, "<summary>查</summary>我先看看", "code_run({})") + turn_text(
        2, "<summary>好</summary>做好了：[FILE:/tmp/out/r.pdf]\n\n![图](x.png)"
    )
    assert im_wechat.answer_text(raw) == "做好了：r.pdf"
    assert im_wechat.answer_text("") == ""


def test_a_frontend_failure_posts_an_error(world: World) -> None:
    world.agent.fail_put = RuntimeError("boom")
    world.say("hi")
    world.settle()
    assert world.texts() == ["❌ 出错：boom"]


# ── stop ───────────────────────────────────────────────────────────────


def test_idle_stop_says_so_and_leaves_the_next_answer_alone(world: World) -> None:
    world.say("/stop")
    assert world.texts() == [im_wechat.NO_RUNNING_TASK_TEXT]
    assert world.agent.aborts == 0
    one_step(world, "好的。")
    world.say("换个话题")
    world.settle()
    assert world.texts()[-1] == "好的。"


def test_stop_posts_its_receipt_at_once_and_the_queued_run_goes_on(world: World) -> None:
    t1 = turn_text(1, "<summary>跑</summary>", "code_run({})")
    world.say("长任务")
    first = world.task()
    first.put(*nxt([t1]))
    world.running()
    world.say("第二个")
    world.clock.now += 5

    world.say("/stop")
    assert world.texts() == ["⏹ 已停止 · 1 步 · 用时 5 秒"]
    assert world.agent.aborts == 1
    first.put(*done([t1 + "做了一半"]))  # the aborted task's `done`: dropped
    t2 = turn_text(1, "第二个做完了。")
    world.task().put(*nxt([t2]))
    world.task().put(*done([t2], 1.0))
    world.settle()
    assert world.texts() == ["⏹ 已停止 · 1 步 · 用时 5 秒", "第二个做完了。"]
    # A second /stop finds nothing running.
    world.say("/abort")
    assert world.texts()[-1] == im_wechat.NO_RUNNING_TASK_TEXT


def test_stop_during_a_reporter_turn_stops_nothing(world: World) -> None:
    world.say("hi")  # queued behind the reporter's turn
    world.agent.is_running = True
    world.agent._current_queue = object()
    world.say("/stop")
    assert world.texts() == [im_wechat.NO_RUNNING_TASK_TEXT]
    assert world.agent.aborts == 0
    t1 = turn_text(1, "你好。")
    world.task().put(*nxt([t1]))
    world.task().put(*done([t1]))
    world.settle()
    assert world.texts()[-1] == "你好。"


def test_new_while_running_stops_first_then_resets(monkeypatch: Any, tmp_path: Path) -> None:
    resume = FakeResume(None)
    world = make_world(monkeypatch, tmp_path, resume)
    resume.cc = sys.modules["continue_cmd"]
    t1 = turn_text(1, "<summary>跑</summary>", "code_run({})")
    world.say("长任务")
    first = world.task()
    first.put(*nxt([t1]))
    world.running()
    world.say("下一个")
    world.clock.now += 3

    world.say("/new")
    assert world.texts() == ["⏹ 已停止 · 1 步 · 用时 3 秒", NEW_CHAT_TEXT]
    assert world.agent.aborts >= 1 and world.agent.history == []
    assert resume.fresh_calls == [world.agent]
    first.put(*done([t1]))
    t2 = turn_text(1, "新上下文里的回答。")
    world.task().put(*nxt([t2]))
    world.task().put(*done([t2]))
    world.settle()
    assert world.texts()[-1] == "新上下文里的回答。"


def test_new_without_restart_continuity_resets_and_drops_the_pending_question(
    world: World,
) -> None:
    t1 = turn_text(1, "", "ask_user(选哪个？)")
    world.agent.scripts.append([nxt([t1]), done([t1], 1.0, _ask=ask_ctx("选哪个？", ["甲", "乙"]))])
    world.say("问我")
    world.settle()
    world.say("/new")
    assert world.texts()[-1] == NEW_CHAT_TEXT and world.agent.history == []
    one_step(world, "好。")
    world.say("2")
    world.settle()
    assert world.prompts()[-1] == HINT + "2"  # no question left to answer


# ── ask_user ───────────────────────────────────────────────────────────

ASK_T1 = turn_text(1, "<summary>查看现状</summary>", 'code_run({"script": "ls"})')
ASK_T2 = turn_text(
    2,
    "<summary>确认方向</summary>我需要你确认一下。",
    "ask_user(用哪个方案？\ncandidates:\n- 方案 A\n- 方案 B)",
)


def test_a_question_is_one_message_and_a_number_picks_a_candidate(world: World) -> None:
    world.agent.scripts.append(
        [
            nxt([ASK_T1]),
            nxt([ASK_T1, ASK_T2], 4.0),
            done([ASK_T1, ASK_T2], 6.0, _ask=ask_ctx("用哪个方案？", ["方案 A", "方案 B"])),
        ]
    )
    world.say("改一下")
    world.settle()
    assert world.texts() == [
        "我需要你确认一下。\n\n用哪个方案？\n1. 方案 A\n2. 方案 B\n\n⏸ 回复序号或文字 · 已完成 2 步"
    ]

    world.clock.now += 60  # waiting for the reply does not count
    t3 = turn_text(1, "<summary>改好了</summary>", "file_patch({})")
    t4 = turn_text(2, "按方案 B 改完了。")
    world.agent.scripts.append([nxt([t3]), nxt([t3, t4], 2.0), done([t3, t4], 1.0)])
    world.say("２")  # fullwidth
    world.settle()
    assert world.prompts()[-1] == HINT + "方案 B"
    assert world.texts()[-1] == "按方案 B 改完了。\n\n4 步 · 用时 13 秒"


def test_questions_without_candidates_or_multi_select_take_the_reply_as_typed(
    world: World,
) -> None:
    t1 = turn_text(1, "", "ask_user(你想怎么改？\n说具体点)")
    world.agent.scripts.append(
        [nxt([t1]), done([t1], 1.0, _ask=ask_ctx("你想怎么改？\n说具体点", []))]
    )
    world.say("问我")
    world.settle()
    assert world.texts()[-1] == "你想怎么改？\n说具体点\n\n⏸ 等你回复 · 已完成 1 步"
    one_step(world, "好。")
    world.say("1")
    world.settle()
    assert world.prompts()[-1] == HINT + "1"

    t2 = turn_text(1, "", "ask_user([多选] 清哪些？)")
    world.agent.scripts.append(
        [nxt([t2]), done([t2], 1.0, _ask=ask_ctx("[多选] 清哪些？", ["缓存", "日志", "下载"]))]
    )
    world.say("清理")
    world.settle()
    assert world.texts()[-1] == (
        "[多选] 清哪些？\n1. 缓存\n2. 日志\n3. 下载\n\n⏸ 可多选，回复序号或文字 · 已完成 1 步"
    )
    one_step(world, "清好了。")
    world.say("1 3")
    world.settle()
    assert world.prompts()[-1] == HINT + "1 3"
    assert world.texts()[-1] == "清好了。\n\n2 步 · 用时 2 秒"  # 1 + 1 steps


def test_an_out_of_range_number_or_a_picture_does_not_pick(world: World) -> None:
    t1 = turn_text(1, "", "ask_user(选哪个？)")
    world.agent.scripts.append([nxt([t1]), done([t1], 1.0, _ask=ask_ctx("选哪个？", ["甲", "乙"]))])
    world.say("问我")
    world.settle()
    world.wx._dl_media = lambda items: ["/tmp/p.jpg"]
    one_step(world, "收到图。")
    world.send({"type": 2, "image_item": {"media": {"encrypt_query_param": "q"}}})
    world.settle()
    assert world.prompts()[-1] == HINT + "[用户发送文件: /tmp/p.jpg]"
    assert world.texts()[-1] == "收到图。"  # no carried steps: the question still waits
    one_step(world, "好。")
    world.say("3")
    world.settle()
    assert world.prompts()[-1] == HINT + "3"
    assert world.texts()[-1] == "好。\n\n2 步 · 用时 2 秒"


def test_a_message_queued_before_the_question_answers_it(world: World) -> None:
    """GA takes the next task as the reply, wherever it was typed."""
    world.say("改一下")
    world.say("用 B 吧")  # sent while the first run still works
    first, second = world.task(0), world.task(1)
    first.put(*nxt([ASK_T1]))
    first.put(*nxt([ASK_T1, ASK_T2], 4.0))
    first.put(*done([ASK_T1, ASK_T2], 6.0, _ask=ask_ctx("用哪个方案？", ["方案 A", "方案 B"])))
    t3 = turn_text(1, "改完了。")
    second.put(*nxt([t3]))
    second.put(*done([t3], 2.0))
    world.settle()
    assert world.texts()[-1] == "改完了。\n\n3 步 · 用时 12 秒"
    assert world.prompts()[-1] == HINT + "用 B 吧"


def test_a_reporter_turn_question_is_never_claimed(world: World) -> None:
    t1 = turn_text(1, "好的。")
    world.agent.scripts.append(
        [nxt([t1]), done([t1], 1.0, _foreign_ask=ask_ctx("要汇报吗？", ["是", "否"]))]
    )
    world.say("hi")
    world.settle()
    assert world.texts() == ["好的。"]
    assert world.conv._pending == {}


# ── inbound ────────────────────────────────────────────────────────────


def test_voice_with_a_transcription_is_text_and_is_not_downloaded(world: World) -> None:
    downloads: list[Any] = []

    def dl_media(items: Any) -> list[str]:
        downloads.append(items)
        return ["/tmp/v.silk"] if any("voice_item" in item for item in items) else []

    world.wx._dl_media = dl_media
    voice = {"type": 3, "voice_item": {"text": "继续", "media": {"encrypt_query_param": "q"}}}
    one_step(world, "好。")
    world.send(voice)
    world.settle()
    assert world.prompts() == [HINT + "继续"] and downloads == []

    one_step(world, "好。")
    world.send(text_item("帮我"), {"type": 3, "voice_item": {"text": "看看磁盘"}})
    world.settle()
    assert world.prompts()[-1] == HINT + "帮我\n看看磁盘"

    silent = {"type": 3, "voice_item": {"text": "", "media": {"encrypt_query_param": "q"}}}
    one_step(world, "好。")
    world.send(silent)
    world.settle()
    assert downloads == [[silent]]
    assert world.prompts()[-1] == HINT + "[用户发送文件: /tmp/v.silk]"

    world.send({"type": 9})  # nothing to read: ignored
    assert len(world.agent.tasks) == 3 and world.conv._worker is None


def test_typing_stays_up_while_runs_are_registered(world: World) -> None:
    world.say("一", ctx="c7")
    world.say("二", ctx="c7")
    first, second = world.task(0), world.task(1)
    t1 = turn_text(1, "一好了。")
    first.put(*nxt([t1]))
    first.put(*done([t1]))
    wait_for(lambda: world.texts() == ["一好了。"])
    time.sleep(0.05)
    assert [value for kind, value in world.ilink.log if kind == "typing"] == [1]
    t2 = turn_text(1, "二好了。")
    second.put(*nxt([t2]))
    second.put(*done([t2]))
    world.settle()
    assert [kind if kind != "typing" else f"typing {value}" for kind, value in world.ilink.log] == [
        "ticket",
        "typing 1",
        "text",
        "text",
        "typing 2",
    ]
    (ticket,) = [body for kind, body in world.ilink.log if kind == "ticket"]
    assert ticket == {"ilink_user_id": "u1", "context_token": "c7"}
    typing = [body for ep, body in world.ilink.posts if ep == "ilink/bot/sendtyping"]
    assert [body["typing_ticket"] for body in typing] == ["T1", "T1"]


def test_no_typing_ticket_means_no_indicator(world: World) -> None:
    world.ilink.ticket = ""
    one_step(world, "好。")
    world.say("hi")
    world.settle()
    assert [kind for kind, _value in world.ilink.log] == ["ticket", "text"]


# ── commands ───────────────────────────────────────────────────────────


def test_commands_answer_without_a_task(world: World) -> None:
    world.say(" /help ")
    world.say("/status")
    world.say("/switch")
    world.say("/llm")
    world.say("/llm 1")
    world.say("/llm x")
    assert world.texts() == [
        "📖 命令列表：\n"
        "/new - 开始新对话\n"
        "/stop - 停止当前任务\n"
        "/status - 查看运行状态和当前模型\n"
        "/llm - 查看可用模型\n"
        "/llm n - 切换到第 n 个模型\n"
        "/help - 查看全部命令",
        "状态：🟢 空闲\nLLM：[0] NativeClaude/a",
        im_wechat.SWITCH_BLOCKED_REPLY,
        "LLMs:\n→ [0] NativeClaude/a\n   [1] NativeOAI/b",
        "切换到 [1] NativeOAI/b",
        "用法: /llm <0-1>",
    ]
    assert world.agent.tasks == []
    world.agent.llmclient = None
    world.agent.is_running = True
    world.say("/status")
    assert world.texts()[-1] == "状态：🔴 运行中\nLLM：[1] 未配置"
    # Anything else starting with / is a task, as upstream: no file hint.
    one_step(world, "review 好了。")
    world.say("/review")
    world.settle()
    assert world.prompts() == ["/review"]


def test_continue_runs_here_and_stops_only_when_it_resets(world: World) -> None:
    world.say("/continue")
    assert world.texts() == ["可恢复会话列表"]
    t1 = turn_text(1, "<summary>跑</summary>", "code_run({})")
    world.say("长任务")
    world.task().put(*nxt([t1]))
    world.running()
    world.say("/continue 9")  # a bad index aborts nothing
    assert world.texts()[-1] == "❌ 索引越界（有效范围 1-1）"
    world.say("/continue 1")
    assert world.texts()[-2:] == ["⏹ 已停止 · 1 步", "✅ 已恢复 3 轮完整对话"]
    assert world.agent.aborts == 1
    assert "abort" not in vars(world.agent)  # the probe is gone
    world.task().put(*done([t1]))
    world.settle()
    assert len(world.texts()) == 4


def test_continue_moves_the_log_mapping_with_restart_continuity(
    monkeypatch: Any, tmp_path: Path
) -> None:
    resume = FakeResume(None)
    world = make_world(monkeypatch, tmp_path, resume)
    resume.cc = sys.modules["continue_cmd"]
    world.say("/continue 1")
    assert resume.continued == ["/continue 1"]
    assert world.texts() == ["✅ 已恢复 3 轮完整对话"]


# ── the reporter's interface ───────────────────────────────────────────


def test_owner_is_persisted_and_read_back(world: World) -> None:
    assert world.conv.owner_id() is None
    world.say("/help", uid="wxid_owner")
    path = world.state_dir / im_wechat.OWNER_FILE_NAME
    assert json.loads(path.read_text(encoding="utf-8")) == {"userId": "wxid_owner"}
    again = im_wechat.WechatConversation(world.wx, world.conv.bot, world.state_dir)
    assert again.owner_id() == "wxid_owner"
    path.write_text("not json", encoding="utf-8")
    broken = im_wechat.WechatConversation(world.wx, world.conv.bot, world.state_dir)
    assert broken.owner_id() is None


def test_busy_counts_registered_runs_and_any_running_task(world: World) -> None:
    assert world.conv.busy() is False
    world.say("hi")
    assert world.conv.busy() is True  # queued
    t1 = turn_text(1, "好。")
    world.task().put(*nxt([t1]))
    world.task().put(*done([t1]))
    world.settle()
    assert world.conv.busy() is False
    world.agent.is_running = True  # a completion-reporter turn
    assert world.conv.busy() is True


def test_send_text_splits_uses_the_newest_context_and_raises_on_failure(world: World) -> None:
    world.say("/help", ctx="c5")
    world.conv.send_text("u1", "汇报" * 3000)
    sent = world.ilink.messages()[1:]
    assert [len(msg["item_list"][0]["text_item"]["text"]) for msg in sent] == [4000, 2000]
    assert [msg["context_token"] for msg in sent] == ["c5", "c5"]
    assert len({msg["client_id"] for msg in world.ilink.messages()}) == 3
    world.conv.send_text("someone-else", "hi")  # no context token known: none sent
    assert "context_token" not in world.ilink.messages()[-1]

    world.ilink.refuse = {"ret": -2, "errmsg": "frequency limit"}
    with pytest.raises(im_wechat.WechatSendError, match="ret=-2"):
        world.conv.send_text("u1", "hi")
    world.ilink.refuse = {"errcode": -14, "errmsg": "session timeout"}
    with pytest.raises(im_wechat.WechatSendError, match="errcode=-14"):
        world.conv.send_text("u1", "hi")
    world.ilink.refuse = None
    world.ilink.fail = RuntimeError("HTTP 500")
    with pytest.raises(RuntimeError, match="HTTP 500"):
        world.conv.send_text("u1", "hi")
    with pytest.raises(ValueError):
        world.conv.send_text("u1", "  ")


def test_a_refused_answer_is_logged_and_the_channel_goes_on(world: World) -> None:
    world.ilink.refuse = {"ret": 1}
    one_step(world, "好。")
    world.say("hi")
    world.settle()
    world.ilink.refuse = None
    one_step(world, "又好。")
    world.say("hi")
    world.settle()
    assert world.texts() == ["又好。"]


def test_connected_while_run_loop_polls(world: World) -> None:
    seen: list[bool] = []

    def run_loop(on_message: Any, poll_timeout: int = 30) -> None:
        seen.append(world.conv.connected())
        raise KeyboardInterrupt()

    world.conv.bot.run_loop = run_loop
    assert world.conv.connected() is False
    with pytest.raises(KeyboardInterrupt):
        world.conv.run()
    assert seen == [True] and world.conv.connected() is False
