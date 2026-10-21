"""Managed-GA patches on ``frontends/fsapp.py``: config and connection
(``0009``), owner binding (``0011``), the FILE-marker echo guard (``0012``),
the reporter-turn card guard (``0013``) and the conversation UX (``0029``).

Loads the shipped payload with ``lark_oapi`` and the heavy GA modules
stubbed; the real ``chatapp_common`` and ``galley_im_display`` are used.
The ``0029`` section drives fsapp's message handler with a fake agent whose
display queues the test feeds (the item shapes of ``agentmain.run``), and a
fake Feishu that records cards, texts, replies, card patches and reactions in
order.
"""

from __future__ import annotations

import importlib.util
import itertools
import json
import os
import queue
import sys
import time
import types
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

_FRONTENDS = Path(__file__).resolve().parents[2] / "managed-ga" / "code" / "frontends"
NEW_CHAT_TEXT = "🆕 已开启新对话，当前上下文已清空"


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


def _install_fsapp_stubs(monkeypatch: Any, *, common: bool = True) -> None:
    """lark_oapi and agentmain stubs; with ``common``, also stub GA's
    slash-command modules and load the real ``chatapp_common`` and
    ``galley_im_display`` under the top-level names fsapp imports them by
    (callers bringing their own ``continue_cmd`` pass ``common=False``)."""

    class WsClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            self._conn: object | None = None
            self._auto_reconnect = False

        async def _connect(self) -> None:
            self._conn = object()

        async def _reconnect(self) -> None:
            self._conn = object()

        async def _try_connect(self, _cnt: int) -> bool:
            return True

    lark = types.ModuleType("lark_oapi")
    lark.ws = types.SimpleNamespace(Client=WsClient)  # type: ignore[attr-defined]
    lark.LogLevel = types.SimpleNamespace(INFO="INFO")  # type: ignore[attr-defined]
    lark.EventDispatcherHandler = types.SimpleNamespace()  # type: ignore[attr-defined]
    lark.Client = types.SimpleNamespace()  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "lark_oapi", lark)
    monkeypatch.setitem(sys.modules, "lark_oapi.api", types.ModuleType("lark_oapi.api"))
    monkeypatch.setitem(sys.modules, "lark_oapi.api.im", types.ModuleType("lark_oapi.api.im"))
    monkeypatch.setitem(
        sys.modules,
        "lark_oapi.api.im.v1",
        types.ModuleType("lark_oapi.api.im.v1"),
    )

    agentmain = types.ModuleType("agentmain")
    agentmain.GeneraticAgent = FakeAgent  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agentmain", agentmain)
    monkeypatch.setattr(sys, "path", list(sys.path))  # fsapp prepends the code root
    if not common:
        return

    def reset_conversation(agent: Any, message: str | None = NEW_CHAT_TEXT) -> Any:
        agent.abort()
        agent.history = []
        return message

    def continue_command(agent: Any, query: str, exclude_pid: Any = None) -> str:
        if query.strip() == "/continue 1":
            reset_conversation(agent, message=None)
            return "✅ 已恢复 3 轮完整对话"
        return "❌ 索引越界（有效范围 1-1）"

    for name, attrs in (
        (
            "continue_cmd",
            {
                "handle_frontend_command": continue_command,
                "reset_conversation": reset_conversation,
                "install": lambda _cls: None,
            },
        ),
        (
            "btw_cmd",
            {"handle_frontend_command": lambda _a, cmd: f"btw: {cmd}", "install": lambda _c: None},
        ),
        ("review_cmd", {"install": lambda _c: None}),
    ):
        stub = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(stub, key, value)
        monkeypatch.setitem(sys.modules, name, stub)
    _exec_module(monkeypatch, "chatapp_common", _FRONTENDS / "chatapp_common.py")
    _exec_module(monkeypatch, "galley_im_display", _FRONTENDS / "galley_im_display.py")


def _load_managed_fsapp(monkeypatch: Any, tmp_path: Path) -> Any:
    _install_fsapp_stubs(monkeypatch)
    monkeypatch.setenv("GA_WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("GALLEY_FEISHU_TEMP_DIR", str(tmp_path / "feishu-temp"))
    cwd = os.getcwd()
    try:
        return _exec_module(monkeypatch, "_galley_test_fsapp", _FRONTENDS / "fsapp.py")
    finally:
        os.chdir(cwd)  # fsapp changes into the code root


def test_make_task_hook_adds_final_turn_panel_without_fabricated_thinking(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    cwd = os.getcwd()
    try:
        fsapp = _load_managed_fsapp(monkeypatch, tmp_path)
    finally:
        os.chdir(cwd)

    class Card:
        def __init__(self) -> None:
            self.steps: list[tuple[str, str]] = []

        def step(self, summary: str, detail: str) -> None:
            self.steps.append((summary, detail))

    class Parent:
        _fs_active_task_id = "task-1"

    class HookSelf:
        parent = Parent()

    class Response:
        content = "<summary>answered briefly</summary>Final answer body"

    finals: list[str] = []
    card = Card()
    hook = fsapp._make_task_hook(card, "task-1", finals.append)

    hook(
        {
            "self": HookSelf(),
            "exit_reason": "done",
            "summary": "answered briefly",
            "response": Response(),
            "tool_calls": [{"tool_name": "lookup", "args": {"q": "x", "_private": "hidden"}}],
        }
    )

    assert finals == ["<summary>answered briefly</summary>Final answer body"]
    assert len(card.steps) == 1
    summary, detail = card.steps[0]
    assert summary == "answered briefly"
    assert "Thinking" not in detail
    assert "Tool Calls" in detail
    assert "`lookup`" in detail
    assert "_private" not in detail
    assert "Output" in detail
    assert "Final answer body" in detail


def test_make_task_hook_ignores_turns_during_galley_report_window(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """While the reporter drains its synthetic turn, a user task registered
    in the same window must not stream the report's steps into its card."""
    cwd = os.getcwd()
    try:
        fsapp = _load_managed_fsapp(monkeypatch, tmp_path)
    finally:
        os.chdir(cwd)

    class Card:
        def __init__(self) -> None:
            self.steps: list[tuple[str, str]] = []

        def step(self, summary: str, detail: str) -> None:
            self.steps.append((summary, detail))

    class Parent:
        _fs_active_task_id = "task-1"

    class HookSelf:
        parent = Parent()

    class Response:
        content = "report body"

    finals: list[str] = []
    card = Card()
    hook = fsapp._make_task_hook(card, "task-1", finals.append)

    ctx = {
        "self": HookSelf(),
        "exit_reason": "done",
        "summary": "report turn",
        "response": Response(),
        "tool_calls": [],
    }
    fsapp._GALLEY_REPORT_TURN_ACTIVE = True
    try:
        hook(ctx)
    finally:
        fsapp._GALLEY_REPORT_TURN_ACTIVE = False
    assert card.steps == []
    assert finals == []

    hook(ctx)
    assert len(card.steps) == 1
    assert finals == ["report body"]


# ---------------- Owner binding (patch 0011) ----------------


def _load_locked_fsapp(
    monkeypatch: Any,
    tmp_path: Path,
    *,
    bind_code: str | None = "123456",
    allowed: list[str] | None = None,
) -> Any:
    import json

    config: dict[str, Any] = {
        "fs_app_id": "cli_test",
        "fs_app_secret": "secret",
        "fs_allowed_users": allowed or [],
    }
    if bind_code is not None:
        config["fs_owner_bind_code"] = bind_code
    monkeypatch.setenv("GALLEY_FEISHU_CONFIG_JSON", json.dumps(config))
    cwd = os.getcwd()
    try:
        return _load_managed_fsapp(monkeypatch, tmp_path)
    finally:
        os.chdir(cwd)


def _text_message(text: str, chat_type: str = "p2p", message_type: str = "text") -> Any:
    import json

    return types.SimpleNamespace(
        chat_type=chat_type,
        message_type=message_type,
        content=json.dumps({"text": text}),
    )


def test_managed_empty_allowlist_is_locked_not_public(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """With Galley-injected config, an empty allow-list must mean
    "locked awaiting pairing" — the old PUBLIC_ACCESS reading let anyone
    in the Feishu org drive the local agent."""
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    assert fsapp.PUBLIC_ACCESS is False
    assert fsapp.ALLOWED_USERS == set()
    assert fsapp.OWNER_BIND_CODE == "123456"


def test_owner_binding_accepts_code_only_from_p2p_text(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    sent: list[Any] = []
    statuses: list[tuple[str, Any, dict[str, Any]]] = []
    monkeypatch.setattr(fsapp, "send_message", lambda *a, **k: sent.append((a, k)))
    fsapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: statuses.append(
        (state, last_error, extra)
    )

    # Correct code from a GROUP chat must not bind (a bot pulled into a
    # group could otherwise be claimed by anyone who saw the code).
    fsapp._handle_owner_bind_message(
        _text_message("123456", chat_type="group"), "ou_group_member"
    )
    assert fsapp.ALLOWED_USERS == set()

    # Wrong code: silent — no reply that would help a guesser.
    fsapp._handle_owner_bind_message(_text_message("000000"), "ou_guesser")
    assert fsapp.ALLOWED_USERS == set()
    assert sent == []

    # Correct code via p2p text binds the sender and invalidates the code.
    fsapp._handle_owner_bind_message(_text_message("123456"), "ou_owner")
    assert fsapp.ALLOWED_USERS == {"ou_owner"}
    assert fsapp.OWNER_BIND_CODE is None
    assert any(extra.get("ownerOpenId") == "ou_owner" for _, _, extra in statuses)
    assert len(sent) == 1  # confirmation reply to the owner


def test_owner_bind_code_invalidated_after_too_many_wrong_attempts(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    monkeypatch.setattr(fsapp, "send_message", lambda *a, **k: None)
    statuses: list[tuple[str, Any]] = []
    fsapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: statuses.append(
        (state, last_error)
    )

    for _ in range(fsapp.GALLEY_OWNER_BIND_ATTEMPT_LIMIT):
        fsapp._handle_owner_bind_message(_text_message("999999"), "ou_bruteforce")
    assert fsapp.OWNER_BIND_CODE is None
    assert any("invalidated" in str(err) for _, err in statuses)

    # Even the correct code no longer binds once invalidated.
    fsapp._handle_owner_bind_message(_text_message("123456"), "ou_bruteforce")
    assert fsapp.ALLOWED_USERS == set()


def test_bound_owner_config_keeps_allowlist_semantics(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _load_locked_fsapp(
        monkeypatch, tmp_path, bind_code=None, allowed=["ou_owner"]
    )
    assert fsapp.PUBLIC_ACCESS is False
    assert fsapp.ALLOWED_USERS == {"ou_owner"}
    assert fsapp.OWNER_BIND_CODE is None


# ---------------- FILE-marker echo guard (patch 0012) ----------------


def test_send_generated_files_skips_prompt_echo_placeholders(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """FILE_HINT's literal `[FILE:filepath]` example gets echoed by
    models; the sender must not message the user "文件不存在: filepath"
    for placeholders or bare words, while real paths still go through
    (existing → sent, missing → warned by _send_local_file)."""
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    forwarded: list[str] = []
    monkeypatch.setattr(
        fsapp,
        "_send_local_file",
        lambda _rid, path, _rt="open_id": forwarded.append(path),
    )

    fsapp._send_generated_files(
        "rid",
        "reply [FILE:filepath] [FILE:<path>] [FILE:...] [FILE:bareword]",
    )
    assert forwarded == []

    real = tmp_path / "deliverable.txt"
    real.write_text("x", encoding="utf-8")
    fsapp._send_generated_files(
        "rid",
        f"done [FILE:{real}] and [FILE:/definitely/missing/report.pdf] and [FILE:{real}]",
    )
    # Existing file forwarded once (deduped); missing-but-path-like
    # forwarded too so _send_local_file can warn the user about it.
    assert forwarded == [str(real), "/definitely/missing/report.pdf"]


# ---------------- Conversation UX (patch 0029) ----------------

OWNER = "ou_owner"
CHAT = "oc_p2p"
FILE_HINT = "If you need to show files to user, use [FILE:filepath] in your response."


class FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class FakeAgent:
    """GA stand-in: ``put_task`` hands out a display queue the test feeds.
    Consuming an item makes GA run that task (idle once ``done`` is taken)
    and fires the turn-end hooks for a scripted ask_user exit, as GA does
    right before it puts ``done``."""

    clock = FakeClock()

    def __init__(self) -> None:
        self.is_running = False
        self._current_queue: Any = None
        self.tasks: list[tuple[str, str, Any, TaskQueue]] = []
        self.fail_put: Exception | None = None
        self.aborted = 0
        self.abort_calls = 0
        self.history: list[Any] = []
        self.llmclient: Any = None
        self.llm_no = 0

    def run(self) -> None:
        return None

    def put_task(self, query: str, source: str = "user", images: Any = None) -> TaskQueue:
        if self.fail_put is not None:
            raise self.fail_put
        dq = TaskQueue(self)
        self.tasks.append((query, source, images, dq))
        return dq

    def abort(self) -> None:
        self.abort_calls += 1
        if self.is_running:
            self.aborted += 1

    def queries(self) -> list[str]:
        return [query for query, _, _, _ in self.tasks]


class TaskQueue:
    def __init__(self, agent: FakeAgent) -> None:
        self.agent = agent
        self.items: queue.Queue[tuple[dict[str, Any], float, Any]] = queue.Queue()

    def begin(self) -> None:
        """GA has taken this task, no item out yet."""
        self.agent._current_queue = self
        self.agent.is_running = True

    def put(self, item: dict[str, Any], advance: float = 0.0, ask: Any = None) -> None:
        self.items.put((item, advance, ask))

    def get(self, block: bool = True, timeout: float | None = None) -> dict[str, Any]:
        item, advance, ask = self.items.get(block, timeout)
        FakeAgent.clock.now += advance
        self.agent._current_queue = self
        self.agent.is_running = "done" not in item
        if ask is not None:
            for hook in list(getattr(self.agent, "_turn_end_hooks", {}).values()):
                hook(ask)
        return dict(item)


class FakeFeishu:
    """Records what reaches Feishu, in order: ``("card", rid, card)``,
    ``("text", rid, text)``, a reply to a message as ``("reply-card",
    message_id, card)`` / ``("reply-text", message_id, text)``, a refused
    reply as ``("reply-refused", message_id, None)``, ``("patch",
    message_id, card)``, ``("react+", message_id)``, ``("react-",
    message_id)``."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, Any]] = []
        self.ids = itertools.count(1)
        self.refuse_cards = 0
        self.refuse_replies = 0
        self.raise_on_card: Exception | None = None

    def reply_raw(self, message_id: str, payload: str, msg_type: str) -> str | None:
        if self.refuse_replies:
            self.refuse_replies -= 1
            self.events.append(("reply-refused", message_id, None))
            return None
        if msg_type == "interactive":
            self.events.append(("reply-card", message_id, json.loads(payload)))
        else:
            self.events.append((f"reply-{msg_type}", message_id, json.loads(payload)["text"]))
        return f"om_bot_{next(self.ids)}"

    def send_raw(self, rid: str, payload: str, msg_type: str, _rtype: str) -> str | None:
        if msg_type == "interactive":
            if self.raise_on_card is not None:
                raise self.raise_on_card
            if self.refuse_cards:
                self.refuse_cards -= 1
                self.events.append(("refused", rid, json.loads(payload)))
                return None
            self.events.append(("card", rid, json.loads(payload)))
        else:
            self.events.append((msg_type, rid, json.loads(payload)["text"]))
        return f"om_bot_{next(self.ids)}"

    def patch_card(self, message_id: str, card: str) -> bool:
        self.events.append(("patch", message_id, json.loads(card)))
        return True

    def add_reaction(self, message_id: str, emoji_type: str = "Typing") -> str:
        assert emoji_type == "Typing"
        self.events.append(("react+", message_id, None))
        return f"r_{message_id}"

    def delete_reaction(self, message_id: str, reaction_id: str) -> bool:
        assert reaction_id == f"r_{message_id}"
        self.events.append(("react-", message_id, None))
        return True

    def kinds(self) -> list[tuple[str, str]]:
        return [(kind, str(target)) for kind, target, _ in self.events]

    def cards(self) -> list[Any]:
        return [body for kind, _, body in self.events if kind in ("card", "reply-card")]

    def texts(self) -> list[str]:
        return [body for kind, _, body in self.events if kind in ("text", "reply-text")]


def wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        time.sleep(0.005)


def turn_text(k: int, body: str, tool: str | None = None) -> str:
    text = f"\nLLM Running (Turn {k}) ...\n\n{body}\n"
    return text + (f"🛠️ {tool}\n" if tool else "")


def nxt(texts: list[str]) -> dict[str, Any]:
    return {"next": texts[-1], "source": "feishu", "turn": len(texts), "outputs": texts[-2:]}


def done(texts: list[str], tail: str = "") -> dict[str, Any]:
    return {
        "done": "".join(texts) + tail, "source": "feishu", "turn": len(texts),
        "outputs": list(texts),
    }


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


def elements(card: Any) -> list[Any]:
    return list(card["body"]["elements"])


def markdowns(card: Any) -> list[str]:
    return [e["content"] for e in elements(card) if e["tag"] == "markdown"]


def lines(card: Any) -> list[str]:
    """The card's grey plain-text lines outside the process panel."""
    return [e["text"]["content"] for e in elements(card) if e["tag"] == "div"]


def panel(card: Any) -> Any:
    return next((e for e in elements(card) if e["tag"] == "collapsible_panel"), None)


def panel_lines(card: Any) -> list[str]:
    return [e["text"]["content"] for e in panel(card)["elements"]]


def preview(card: Any) -> str:
    return str(card["config"].get("summary", {}).get("content", ""))


class Env:
    def __init__(self, fsapp: Any, net: FakeFeishu, clock: FakeClock) -> None:
        self.fsapp = fsapp
        self.net = net
        self.clock = clock
        self.ids = itertools.count(1)

    @property
    def agent(self) -> FakeAgent:
        agent = self.fsapp.get_app().agent
        assert isinstance(agent, FakeAgent)
        return agent

    def task(self, index: int) -> TaskQueue:
        wait_until(lambda: len(self.agent.tasks) > index)
        return self.agent.tasks[index][3]

    def say(
        self,
        text: str,
        *,
        chat_id: str = CHAT,
        chat_type: str = "p2p",
        message_type: str = "text",
        content: Any = None,
    ) -> str:
        message_id = f"om_user_{next(self.ids)}"
        message = types.SimpleNamespace(
            message_id=message_id,
            chat_id=chat_id,
            chat_type=chat_type,
            message_type=message_type,
            content=json.dumps(content if content is not None else {"text": text}),
        )
        sender = types.SimpleNamespace(sender_id=types.SimpleNamespace(open_id=OWNER))
        data = types.SimpleNamespace(event=types.SimpleNamespace(message=message, sender=sender))
        self.fsapp._handle_message_impl(data)
        return message_id

    def idle(self) -> None:
        """Every run has posted its message."""
        wait_until(lambda: not self.fsapp._RUNS)


@pytest.fixture
def fs(monkeypatch: Any, tmp_path: Path) -> Any:
    monkeypatch.setenv(
        "GALLEY_FEISHU_CONFIG_JSON",
        json.dumps(
            {"fs_app_id": "cli_test", "fs_app_secret": "secret", "fs_allowed_users": [OWNER]}
        ),
    )
    fsapp = _load_managed_fsapp(monkeypatch, tmp_path)
    clock = FakeClock()
    FakeAgent.clock = clock
    fsapp._clock = clock
    monkeypatch.setattr(fsapp, "_POLL_SECONDS", 0.01)
    net = FakeFeishu()
    monkeypatch.setattr(fsapp, "_send_raw", net.send_raw)
    monkeypatch.setattr(fsapp, "_reply_raw", net.reply_raw)
    monkeypatch.setattr(fsapp, "_patch_card", net.patch_card)
    monkeypatch.setattr(fsapp, "_add_reaction", net.add_reaction)
    monkeypatch.setattr(fsapp, "_delete_reaction", net.delete_reaction)
    monkeypatch.setattr(fsapp, "_send_generated_files", lambda *_a, **_k: None)
    env = Env(fsapp, net, clock)
    yield env
    with fsapp._runs_cond:  # let the worker thread go
        fsapp._RUNS.clear()
        fsapp._runs_cond.notify_all()


def test_one_step_answer_is_one_card_with_typing_around_it(fs: Env) -> None:
    trigger = fs.say("你好")
    dq = fs.task(0)
    wait_until(lambda: ("react+", trigger) in fs.net.kinds())
    assert fs.net.cards() == []  # no status card while it runs
    dq.put(done([turn_text(1, "<summary>打招呼</summary>你好！有什么要我做的？")]), advance=2)
    fs.idle()
    # Right below its message: a new message, not a reply.
    assert fs.net.kinds() == [("react+", trigger), ("card", CHAT), ("react-", trigger)]
    (card,) = fs.net.cards()
    assert markdowns(card) == ["你好！有什么要我做的？"]
    assert panel(card) is None and lines(card) == []  # one step: nothing hangs off it
    assert preview(card) == "你好！有什么要我做的？"
    assert card["schema"] == "2.0"
    assert fs.agent.queries() == [f"{FILE_HINT}\n\n你好"]
    assert fs.agent.tasks[0][1] == "feishu"


def test_multi_step_answer_is_the_closing_step_with_a_folded_process_panel(fs: Env) -> None:
    trigger = fs.say("磁盘还剩多少")
    dq = fs.task(0)
    texts = [
        turn_text(1, "<summary>查看磁盘用量</summary>我先看看。", "code_run(df -h)"),
        turn_text(2, "<summary>读取挂载点</summary>再确认一下。", "file_read(/etc/fstab)"),
        turn_text(3, "<summary>整理结果</summary>**还剩 120 GB**，够用。"),
    ]
    dq.put(nxt(texts[:1]), advance=1)
    dq.put(nxt(texts[:2]), advance=2)
    dq.put(nxt(texts), advance=3)
    dq.put(done(texts), advance=4)
    fs.idle()
    assert fs.net.kinds() == [("react+", trigger), ("card", CHAT), ("react-", trigger)]
    (card,) = fs.net.cards()
    assert markdowns(card) == ["**还剩 120 GB**，够用。"]  # no tool echo, no earlier narration
    assert preview(card) == "还剩 120 GB，够用。"
    folded = panel(card)
    assert folded["expanded"] is False
    assert folded["header"]["title"] == {"tag": "plain_text", "content": "过程"}
    assert elements(card)[-1] is folded or elements(card)[-1] == folded  # last, under the answer
    assert panel_lines(card) == [
        "3 步 · 用时 9 秒", "01 查看磁盘用量", "02 读取挂载点", "03 整理结果",
    ]


def test_message_while_running_queues_and_gets_typing_on_its_turn(fs: Env) -> None:
    first = fs.say("第一件事")
    dq1 = fs.task(0)
    dq1.begin()
    wait_until(lambda: ("react+", first) in fs.net.kinds())
    second = fs.say("第二件事")
    dq2 = fs.task(1)
    assert fs.agent.queries() == [f"{FILE_HINT}\n\n第一件事", f"{FILE_HINT}\n\n第二件事"]
    time.sleep(0.05)
    assert ("react+", second) not in fs.net.kinds()  # waits for its turn
    assert fs.net.texts() == []  # and is not refused
    dq2.put(done([turn_text(1, "第二个回答")]))  # GA finishes in order: this waits
    dq1.put(done([turn_text(1, "第一个回答")]))
    fs.idle()
    # Each answer replies to its message: the second message landed between
    # the first one and its answer, the first answer between the second.
    assert fs.net.kinds() == [
        ("react+", first), ("reply-card", first), ("react-", first),
        ("react+", second), ("reply-card", second), ("react-", second),
    ]
    assert [markdowns(card) for card in fs.net.cards()] == [["第一个回答"], ["第二个回答"]]


def test_stop_stops_the_running_run_only(fs: Env) -> None:
    first = fs.say("长任务")
    dq1 = fs.task(0)
    dq1.begin()
    texts = [turn_text(1, "<summary>开始扫描</summary>扫描中。", "code_run(scan)")]
    dq1.put(nxt(texts), advance=1)
    second = fs.say("排队的")
    dq2 = fs.task(1)
    wait_until(lambda: fs.fsapp._RUNS[0].task_turn == 1)
    fs.clock.now += 7
    fs.say("/stop")
    wait_until(lambda: fs.net.texts() == ["⏹ 已停止 · 1 步 · 用时 7 秒"])
    assert fs.agent.aborted == 1
    wait_until(lambda: ("react+", second) in fs.net.kinds())
    dq1.put(done(texts, tail="\n```\naborted\n```"))  # the aborted task's done: nobody's answer
    dq2.put(done([turn_text(1, "排队的回答")]))
    fs.idle()
    # The receipt replies to the stopped message (the /stop came after it).
    assert fs.net.kinds() == [
        ("react+", first), ("reply-text", first), ("react-", first),
        ("react+", second), ("reply-card", second), ("react-", second),
    ]
    assert [markdowns(card) for card in fs.net.cards()] == [["排队的回答"]]


def test_stop_with_nothing_running_or_a_reporter_turn_aborts_nothing(fs: Env) -> None:
    fs.say("/stop")
    wait_until(lambda: fs.net.texts() == ["当前没有在跑的任务"])
    fs.agent.is_running, fs.agent._current_queue = True, object()  # the reporter's turn
    queued = fs.say("等报告轮跑完")
    fs.task(0)
    fs.say("/stop")
    wait_until(lambda: fs.net.texts() == ["当前没有在跑的任务"] * 2)
    assert fs.agent.abort_calls == 0
    assert fs.fsapp._RUNS and fs.fsapp._RUNS[0].state == "queued"  # still waits for its turn
    assert ("react+", queued) in fs.net.kinds()


def test_new_stops_the_running_run_then_resets(fs: Env) -> None:
    trigger = fs.say("长任务")
    fs.task(0).begin()
    wait_until(lambda: ("react+", trigger) in fs.net.kinds())
    fs.say("/new")
    wait_until(lambda: len(fs.net.texts()) == 2)
    assert fs.net.texts() == ["⏹ 已停止", NEW_CHAT_TEXT]
    assert fs.agent.aborted == 1
    assert ("react-", trigger) in fs.net.kinds()
    fs.idle()


def test_failure_posts_the_error_and_takes_typing_down(fs: Env) -> None:
    fs.agent.fail_put = RuntimeError("boom")
    trigger = fs.say("hi")
    fs.idle()
    assert fs.net.kinds() == [("react+", trigger), ("text", CHAT), ("react-", trigger)]
    assert fs.net.texts() == ["❌ 出错：boom"]
    fs.agent.fail_put = None
    fs.net.raise_on_card = RuntimeError("network down")
    trigger = fs.say("again")
    fs.task(0).put(done([turn_text(1, "答案")]))
    fs.idle()
    assert ("react-", trigger) in fs.net.kinds()
    assert fs.net.texts()[-1] == "1 步\n❌ 出错：network down"


def test_question_is_numbered_answered_by_number_and_marked_answered(fs: Env) -> None:
    trigger = fs.say("导出报告")
    asking = [turn_text(1, "<summary>问格式</summary>导出前确认一下。", "ask_user(...)")]
    fs.task(0).put(done(asking), ask=ask_ctx("要哪种格式？", ["PDF", "Word", "Markdown"]))
    fs.idle()
    assert fs.net.kinds() == [("react+", trigger), ("card", CHAT), ("react-", trigger)]
    (question,) = fs.net.cards()
    assert markdowns(question) == [
        "导出前确认一下。", "要哪种格式？\n\n1. PDF\n2. Word\n3. Markdown",
    ]
    assert lines(question) == ["⏸ 回复序号或文字 · 已完成 1 步"]
    assert preview(question) == "要哪种格式？"

    reply = fs.say("２")  # fullwidth digits count
    dq = fs.task(1)
    assert fs.agent.queries()[1] == f"{FILE_HINT}\n\nWord"
    wait_until(lambda: any(kind == "patch" for kind, _, _ in fs.net.events))
    echo = next(body for kind, _, body in fs.net.events if kind == "patch")
    assert markdowns(echo)[-1] == (
        "要哪种格式？\n\n1. <font color='grey'>PDF</font>\n2. ✓ Word\n"
        "3. <font color='grey'>Markdown</font>"
    )
    assert lines(echo) == ["已回复 · 已完成 1 步"]
    finishing = [
        turn_text(1, "<summary>生成文件</summary>生成中。", "code_run(export)"),
        turn_text(2, "<summary>完成</summary>已导出 Word。"),
    ]
    dq.put(nxt(finishing[:1]), advance=1)
    dq.put(done(finishing), advance=2)
    fs.idle()
    answer = fs.net.cards()[-1]
    assert markdowns(answer) == ["已导出 Word。"]
    # ask_user does not cut the run: steps add up across the reply.
    assert panel_lines(answer)[1:] == ["01 问格式", "02 生成文件", "03 完成"]
    assert panel_lines(answer)[0].startswith("3 步")
    assert ("react+", reply) in fs.net.kinds()


def test_typed_answer_ticks_nothing_and_the_question_then_expires(fs: Env) -> None:
    fs.say("导出报告")
    fs.task(0).put(done([turn_text(1, "确认。")]), ask=ask_ctx("要哪种格式？", ["PDF", "Word"]))
    fs.idle()
    fs.say("都不要，发我纯文本")
    fs.task(1).put(done([turn_text(1, "好的。")]))
    fs.idle()
    assert fs.agent.queries()[1] == f"{FILE_HINT}\n\n都不要，发我纯文本"
    echo = next(body for kind, _, body in fs.net.events if kind == "patch")
    assert "✓" not in markdowns(echo)[-1]
    fs.say("1")  # no question pending any more: just text
    fs.task(2)
    assert fs.agent.queries()[2] == f"{FILE_HINT}\n\n1"


def test_multi_select_numbers_pick_several(fs: Env) -> None:
    fs.say("选城市")
    ask = ask_ctx("[多选] 去哪些城市？", ["北京", "上海", "广州"])
    fs.task(0).put(done([turn_text(1, "")]), ask=ask)
    fs.idle()
    (question,) = fs.net.cards()
    assert lines(question) == ["⏸ 可多选，回复序号或文字 · 已完成 1 步"]
    fs.say("1、3")
    fs.task(1)
    assert fs.agent.queries()[1] == f"{FILE_HINT}\n\n北京；广州"
    wait_until(lambda: any(kind == "patch" for kind, _, _ in fs.net.events))
    echo = next(body for kind, _, body in fs.net.events if kind == "patch")
    assert "1. ✓ 北京" in markdowns(echo)[-1] and "3. ✓ 广州" in markdowns(echo)[-1]


def test_picture_does_not_answer_a_question(fs: Env, monkeypatch: Any) -> None:
    fs.say("导出报告")
    fs.task(0).put(done([turn_text(1, "确认。")]), ask=ask_ctx("要哪种格式？", ["PDF", "Word"]))
    fs.idle()
    monkeypatch.setattr(
        fs.fsapp, "_download_and_save_media", lambda *_a: ("/tmp/pic.png", "pic.png")
    )
    fs.say("", message_type="image", content={"image_key": "img_1"})
    fs.task(1)
    assert fs.fsapp._pending_asks  # still waiting for its reply


def test_group_message_gets_typing_and_answer_in_the_group(fs: Env) -> None:
    trigger = fs.say("@_user_1 帮我查一下", chat_id="oc_group", chat_type="group")
    fs.task(0).put(done([turn_text(1, "查好了。")]))
    fs.idle()
    assert fs.net.kinds() == [("react+", trigger), ("card", "oc_group"), ("react-", trigger)]


def test_long_answer_splits_and_the_panel_goes_on_the_last_part(fs: Env) -> None:
    fs.say("写长文")
    body = "\n".join(f"第 {i} 段：" + "字" * 90 for i in range(100))
    texts = [turn_text(1, "<summary>查资料</summary>先查。", "web_scan(x)"), turn_text(2, body)]
    fs.task(0).put(done(texts))
    fs.idle()
    cards = fs.net.cards()
    assert len(cards) == 3
    assert [panel(card) is not None for card in cards] == [False, False, True]
    assert all(len(json.dumps(card, ensure_ascii=False).encode()) <= 30 * 1024 for card in cards)
    assert "".join(markdowns(card)[0] for card in cards).replace("\n", "") == body.replace("\n", "")


def test_card_refused_goes_out_as_text_with_the_process(fs: Env) -> None:
    fs.net.refuse_cards = 1
    fs.say("hi")
    texts = [turn_text(1, "<summary>查</summary>", "code_run(x)"), turn_text(2, "结果。")]
    fs.task(0).put(done(texts))
    fs.idle()
    (text,) = fs.net.texts()
    assert text.splitlines()[0] == "结果。"
    assert text.splitlines()[-3:] == ["2 步", "01 查", "02 结果。"]


def test_markdown_rewrite_tables_and_images(fs: Env) -> None:
    fs.say("对比")
    answer = (
        "## 结论\n\n| 项 | 值 |\n|---|---|\n| A | 1 |\n| B | 2 |\n\n"
        "![图](https://example.com/a.png) 和 ![本地](/tmp/b.png)\n\n```\n| x | y |\n|---|---|\n```"
    )
    fs.task(0).put(done([turn_text(1, answer)]))
    fs.idle()
    (card,) = fs.net.cards()
    assert markdowns(card) == [
        "**结论**\n\n• A：1\n• B：2\n\n"
        "[图](https://example.com/a.png) 和 本地\n\n```\n| x | y |\n|---|---|\n```"
    ]
    assert preview(card) == "结论"


def test_headings_become_bold_lines_each_its_own_paragraph(fs: Env) -> None:
    fs.say("总结一下")
    answer = (
        "# 总结\n正文第一行\n## **要点** ##\n- 甲\n"
        "```\n# 代码里的井号\n```\n#话题 不是标题"
    )
    fs.task(0).put(done([turn_text(1, answer)]))
    fs.idle()
    (card,) = fs.net.cards()
    assert markdowns(card) == [
        "**总结**\n\n正文第一行\n\n**要点**\n\n- 甲\n"
        "```\n# 代码里的井号\n```\n#话题 不是标题"
    ]
    assert preview(card) == "总结"
    ((report, _plain),) = fs.fsapp.report_cards("✅ 周报", "## 本周\n完成 3 项", "已完成 · s1")
    assert markdowns(json.loads(report)) == ["**✅ 周报**", "**本周**\n\n完成 3 项"]


def test_only_the_first_part_of_a_long_answer_replies(fs: Env) -> None:
    first = fs.say("写长文")
    dq = fs.task(0)
    dq.begin()
    fs.say("顺便再说一句")
    body = "\n".join(f"第 {i} 段：" + "字" * 90 for i in range(100))
    dq.put(done([turn_text(1, body)]))
    wait_until(lambda: ("react-", first) in fs.net.kinds())
    sent = [(kind, target) for kind, target in fs.net.kinds() if "card" in kind]
    assert sent[:3] == [("reply-card", first), ("card", CHAT), ("card", CHAT)]
    fs.task(1).put(done([turn_text(1, "好。")]))
    fs.idle()


def test_refused_reply_goes_out_as_a_new_message(fs: Env) -> None:
    first = fs.say("查一下")
    dq = fs.task(0)
    dq.begin()
    fs.say("另一件事")
    fs.net.refuse_replies = 1  # the first message was recalled, say
    dq.put(done([turn_text(1, "查好了。")]))
    wait_until(lambda: ("react-", first) in fs.net.kinds())
    assert fs.net.kinds()[:4] == [
        ("react+", first), ("reply-refused", first), ("card", CHAT), ("react-", first),
    ]
    fs.task(1).put(done([turn_text(1, "好。")]))
    fs.idle()


def test_question_card_replies_when_a_message_came_in(fs: Env) -> None:
    first = fs.say("导出报告")
    dq = fs.task(0)
    dq.begin()
    second = fs.say("PDF 吧")  # sent before the question: it answers it
    dq.put(done([turn_text(1, "确认。")]), ask=ask_ctx("要哪种格式？", ["PDF", "Word"]))
    wait_until(lambda: ("react-", first) in fs.net.kinds())
    assert ("reply-card", first) in fs.net.kinds()
    fs.task(1).put(done([turn_text(1, "已导出。")]))
    fs.idle()
    # The question card landed after the second message: its answer replies.
    assert fs.net.kinds()[-2:] == [("reply-card", second), ("react-", second)]


def test_messages_in_another_chat_do_not_count(fs: Env) -> None:
    first = fs.say("私聊里问")
    dq1 = fs.task(0)
    dq1.begin()
    second = fs.say("@_user_1 群里问", chat_id="oc_group", chat_type="group")
    dq1.put(done([turn_text(1, "私聊的回答")]))
    fs.task(1).put(done([turn_text(1, "群里的回答")]))
    fs.idle()
    assert ("card", CHAT) in fs.net.kinds() and ("card", "oc_group") in fs.net.kinds()
    assert all(not kind.startswith("reply") for kind, _ in fs.net.kinds())
    assert ("react+", first) in fs.net.kinds() and ("react+", second) in fs.net.kinds()


def test_group_answer_replies_when_another_message_came_in(fs: Env) -> None:
    group = "oc_group"
    first = fs.say("@_user_1 先查这个", chat_id=group, chat_type="group")
    dq1 = fs.task(0)
    dq1.begin()
    second = fs.say("@_user_1 再查那个", chat_id=group, chat_type="group")
    dq1.put(done([turn_text(1, "这个查好了。")]))
    fs.task(1).put(done([turn_text(1, "那个也查好了。")]))
    fs.idle()
    assert fs.net.kinds() == [
        ("react+", first), ("reply-card", first), ("react-", first),
        ("react+", second), ("reply-card", second), ("react-", second),
    ]


def test_a_report_between_a_message_and_its_answer_makes_it_a_reply(
    fs: Env, monkeypatch: Any
) -> None:
    reports: list[tuple[str, str]] = []

    def create_message(rid: str, _content: str, _msg_type: str, rtype: str) -> str:
        reports.append((rid, rtype))
        return "om_report"

    monkeypatch.setattr(fs.fsapp, "_create_message", create_message)
    trigger = fs.say("hi")
    dq = fs.task(0)
    dq.begin()
    ((card, _plain),) = fs.fsapp.report_cards("✅ 周报", "完成", "已完成 · s1")
    fs.fsapp.deliver_card(OWNER, card)  # the reporter sends to the owner's open_id
    dq.put(done([turn_text(1, "嗯。")]))
    fs.idle()
    assert reports == [(OWNER, "open_id")]
    assert ("reply-card", trigger) in fs.net.kinds()


def test_files_landing_after_a_message_make_its_answer_a_reply(
    fs: Env, monkeypatch: Any, tmp_path: Path
) -> None:
    out = tmp_path / "report.pdf"
    out.write_text("x", encoding="utf-8")
    later: list[str] = []

    def send_files(*_args: Any) -> None:
        if not later:  # a message arrives while the first run's files upload
            later.append(fs.say("收到了吗"))

    monkeypatch.setattr(fs.fsapp, "_send_generated_files", send_files)
    fs.say("导出")
    fs.task(0).put(done([turn_text(1, f"做好了：[FILE:{out}]")]))
    fs.task(1).put(done([turn_text(1, "收到了。")]))
    fs.idle()
    assert fs.net.kinds()[-2:] == [("reply-card", later[0]), ("react-", later[0])]


def test_file_markers_show_as_names_and_files_only_answer(fs: Env, tmp_path: Path) -> None:
    out = tmp_path / "report.pdf"
    out.write_text("x", encoding="utf-8")
    fs.say("导出")
    fs.task(0).put(done([turn_text(1, f"做好了：[FILE:{out}]")]))
    fs.idle()
    fs.say("再导出")
    fs.task(1).put(done([turn_text(1, f"[FILE:{out}]")]))
    fs.idle()
    assert [markdowns(card) for card in fs.net.cards()] == [["做好了：report.pdf"], ["report.pdf"]]


def test_reporter_seams(fs: Env) -> None:
    raw = "".join(
        [
            turn_text(1, "<summary>查看</summary>我先看看。", "code_run(galley sessions list)"),
            turn_text(2, "<summary>汇报</summary>| 会话 | 状态 |\n|---|---|\n| A | 完成 |"),
        ]
    )
    assert fs.fsapp.answer_text(raw) == "| 会话 | 状态 |\n|---|---|\n| A | 完成 |"
    assert fs.fsapp.answer_text("") == ""
    table = "| 会话 | 状态 |\n|---|---|\n| A | 完成 |"
    ((card, plain),) = fs.fsapp.report_cards("✅ 周报", table, "已完成 · s1")
    parsed = json.loads(card)
    assert markdowns(parsed) == ["**✅ 周报**", "• A：完成"]
    assert lines(parsed) == ["已完成 · s1"]
    assert preview(parsed) == "✅ 周报"
    assert plain == "✅ 周报\n\n• A：完成\n\n已完成 · s1"
    assert fs.fsapp.busy() is False
    fs.say("hi")
    assert fs.fsapp.busy() is True
    fs.task(0).put(done([turn_text(1, "嗯。")]))
    fs.idle()
    assert fs.fsapp.busy() is False


def test_one_chatapp_common_module(fs: Env) -> None:
    """fsapp and galley_im_display share the top-level chatapp_common, so
    the GA class gets /continue, /btw and /review once."""
    assert fs.fsapp.AgentChatMixin is sys.modules["chatapp_common"].AgentChatMixin
    assert "frontends.chatapp_common" not in sys.modules
