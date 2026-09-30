"""Managed-GA patch 0024: Telegram conversation UX in ``frontends/tgapp.py``
and the shared ``frontends/galley_im_display.py``.

Loads the shipped payload with ``telegram`` and the heavy GA modules stubbed
(the real ``chatapp_common`` and ``galley_im_display`` are used), then drives
tgapp's handlers with a fake agent whose display queues replay the item
shapes the managed runtime produces for the Telegram agent (``verbose=False``,
``inc_out=True``: incremental ``next`` text, whole step texts in
``outputs``), and a fake bot that records sends, edits and deletes.
Time is an injected clock the scripted queues advance; nothing sleeps for
real beyond event-loop yields and short queue polls.
"""

from __future__ import annotations

import asyncio
import importlib.util
import itertools
import json
import queue
import re
import sys
import time
import types
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest

OWNER = 42
STRANGER = 7
CHAT_ID = 4200
_CODE_ROOT = Path(__file__).resolve().parents[2] / "managed-ga" / "code"
_FRONTENDS = _CODE_ROOT / "frontends"
MAX = 4096
NEW_CHAT_TEXT = "🆕 已开启新对话，当前上下文已清空"
STATUS_KWARGS = {"disable_notification": True}  # a status message is sent with nothing else


# ── fakes ──────────────────────────────────────────────────────────────


class FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class RetryAfterError(Exception):
    def __init__(self, retry_after: float) -> None:
        super().__init__(f"Flood control exceeded. Retry in {retry_after} seconds")
        self.retry_after = retry_after


class BadRequestError(Exception):
    pass


class FakeAgent:
    """GA stand-in: put_task hands out a scripted display queue. Consuming an
    item marks GA as running that task (idle once `done` is taken) and fires
    the turn-end hooks for scripted ask_user exits, as GA does right before
    it puts `done`."""

    clock = FakeClock()

    def __init__(self) -> None:
        self.verbose = True
        self.inc_out = False
        self.is_running = False
        self.aborted = 0
        self.abort_calls = 0
        self.tasks: list[tuple[str, str, ScriptQueue]] = []
        self.scripts: list[list[tuple[dict[str, Any], float]]] = []
        self.fail_put: Exception | None = None
        self._current_queue: Any = None
        self.history: list[str] = []
        self.llmclient: Any = None
        self.llm_no = 0

    def run(self) -> None:
        return None

    def fire_hooks(self, ctx: dict[str, Any]) -> None:
        for hook in list(getattr(self, "_turn_end_hooks", {}).values()):
            hook(ctx)

    def put_task(self, query: str, source: str = "user", images: Any = None) -> ScriptQueue:
        if self.fail_put is not None:
            raise self.fail_put
        dq = ScriptQueue(self)
        self.tasks.append((query, source, dq))
        for item, advance in self.scripts.pop(0) if self.scripts else []:
            dq.put(item, advance)
        return dq

    def abort(self) -> None:
        self.abort_calls += 1
        if self.is_running:
            self.aborted += 1


class ScriptQueue:
    """A task's display queue. Items advance the injected clock when
    consumed and may carry `_ask` (a turn-end ctx fired as this task's),
    `_foreign_ask` (fired as another task's, e.g. a reporter turn) or
    `_effect` (a callable)."""

    def __init__(self, agent: FakeAgent) -> None:
        self.agent = agent
        self.items: queue.Queue[tuple[float, dict[str, Any]]] = queue.Queue()

    def put(self, item: dict[str, Any], advance: float = 0.0) -> None:
        self.items.put((advance, item))

    def get(self, block: bool = True, timeout: float | None = None) -> dict[str, Any]:
        advance, item = self.items.get(block, timeout)
        FakeAgent.clock.now += advance
        item = dict(item)
        ask, foreign = item.pop("_ask", None), item.pop("_foreign_ask", None)
        effect = item.pop("_effect", None)
        if foreign is not None:
            self.agent._current_queue = object()
            self.agent.fire_hooks(foreign)
        self.agent._current_queue = self
        self.agent.is_running = "done" not in item
        if ask is not None:
            self.agent.fire_hooks(ask)
        if callable(effect):
            effect()
        return item


class FakeChat:
    def __init__(self, chat_id: int, chat_type: str) -> None:
        self.id = chat_id
        self.type = chat_type


class FakeButton:
    def __init__(self, text: str, callback_data: str | None = None) -> None:
        self.text = text
        self.callback_data = callback_data


class FakeMarkup:
    def __init__(self, inline_keyboard: Any) -> None:
        self.inline_keyboard = [list(row) for row in inline_keyboard]


_message_ids = itertools.count(100)


class FakeMessage:
    def __init__(self, bot: FakeBot, chat: FakeChat, text: str | None, **kwargs: Any) -> None:
        self.bot = bot
        self.chat = chat
        self.chat_id = chat.id
        self.message_id = next(_message_ids)
        self.text = text
        self.first_text = text
        self.kwargs = kwargs
        self.reply_markup: Any = kwargs.get("reply_markup")
        self.edits: list[tuple[str | None, dict[str, Any]]] = []
        self.deleted = False
        self.photo: Any = None
        self.document: Any = None
        self.caption: str | None = None

    async def reply_text(self, text: str, **kwargs: Any) -> FakeMessage:
        return self.bot.send(self.chat, text, **kwargs)

    async def reply_photo(self, photo: Any, **kwargs: Any) -> FakeMessage:
        return self.bot.send(self.chat, None, file=("photo", getattr(photo, "name", "")), **kwargs)

    async def reply_document(self, document: Any, **kwargs: Any) -> FakeMessage:
        name = getattr(document, "name", "")
        return self.bot.send(self.chat, None, file=("document", name), **kwargs)

    async def edit_text(self, text: str, **kwargs: Any) -> FakeMessage:
        self.bot.check_edit(kwargs)
        self.edits.append((text, kwargs))
        self.text = text
        self.reply_markup = kwargs.get("reply_markup")
        return self

    async def edit_reply_markup(self, reply_markup: Any = None, **kwargs: Any) -> FakeMessage:
        self.edits.append((None, {"reply_markup": reply_markup}))
        self.reply_markup = reply_markup
        return self

    async def delete(self) -> bool:
        if self.bot.fail_delete:
            raise BadRequestError("message can't be deleted")
        self.deleted = True
        return True

    def shown(self) -> list[str | None]:
        """Every text this message showed: as sent, then each text edit."""
        return [self.first_text, *(text for text, _ in self.edits if text is not None)]


class FakeBot:
    """Records what reaches the chat. `sent` holds bot messages in order,
    deleted ones included."""

    def __init__(self) -> None:
        self.sent: list[FakeMessage] = []
        self.reject_markdown = False
        self.fail_delete = False
        self.fail_send: Exception | None = None
        self.fail_sends = 1

    def send(self, chat: FakeChat, text: str | None, **kwargs: Any) -> FakeMessage:
        if self.fail_send is not None:
            error = self.fail_send
            self.fail_sends -= 1
            if self.fail_sends <= 0:
                self.fail_send = None
            raise error
        if self.reject_markdown and kwargs.get("parse_mode") == "MarkdownV2":
            raise BadRequestError("Can't parse entities")
        message = FakeMessage(self, chat, text, **kwargs)
        self.sent.append(message)
        return message

    def check_edit(self, kwargs: dict[str, Any]) -> None:
        if self.reject_markdown and kwargs.get("parse_mode") == "MarkdownV2":
            raise BadRequestError("Can't parse entities")

    def texts(self) -> list[str | None]:
        return [message.text for message in self.sent]

    def statuses(self) -> list[FakeMessage]:
        """The runs' silent status messages, in order."""
        return [message for message in self.sent if message.kwargs == STATUS_KWARGS]

    def others(self) -> list[FakeMessage]:
        """Everything but the status messages: answers, questions, receipts,
        command replies and files."""
        return [message for message in self.sent if message.kwargs != STATUS_KWARGS]

    def other_texts(self) -> list[str | None]:
        return [message.text for message in self.others()]


class FakeQuery:
    def __init__(self, data: str, message: FakeMessage | None) -> None:
        self.data = data
        self.message = message
        self.answers: list[tuple[str | None, bool | None]] = []
        self.text_edits: list[tuple[str, dict[str, Any]]] = []
        self.markup_edits: list[Any] = []

    async def answer(
        self, text: str | None = None, show_alert: bool | None = None, **_: Any
    ) -> bool:
        self.answers.append((text, show_alert))
        return True

    async def edit_message_text(self, text: str, **kwargs: Any) -> Any:
        assert self.message is not None
        self.message.bot.check_edit(kwargs)
        self.text_edits.append((text, kwargs))
        self.message.text = text
        self.message.reply_markup = kwargs.get("reply_markup")
        return self.message

    async def edit_message_reply_markup(self, reply_markup: Any = None, **_: Any) -> Any:
        self.markup_edits.append(reply_markup)
        if self.message is not None:
            self.message.reply_markup = reply_markup
        return self.message


# ── loading ────────────────────────────────────────────────────────────


def _escape_markdown(text: str, version: int = 1, entity_type: str | None = None) -> str:
    """python-telegram-bot 22.8 telegram.helpers.escape_markdown, version 2."""
    if entity_type in ["pre", "code"]:
        escape_chars = r"\`"
    elif entity_type in ["text_link", "custom_emoji"]:
        escape_chars = r"\)"
    else:
        escape_chars = r"\_*[]()~`>#+-=|{}.!"
    return re.sub(f"([{re.escape(escape_chars)}])", r"\\\1", text)


def _telegram_stubs() -> dict[str, types.ModuleType]:
    telegram = types.ModuleType("telegram")
    telegram.BotCommand = lambda command, description: (command, description)  # type: ignore[attr-defined]
    telegram.InlineKeyboardButton = FakeButton  # type: ignore[attr-defined]
    telegram.InlineKeyboardMarkup = FakeMarkup  # type: ignore[attr-defined]
    constants = types.ModuleType("telegram.constants")
    constants.ChatType = types.SimpleNamespace(PRIVATE="private", GROUP="group")  # type: ignore[attr-defined]
    constants.MessageLimit = types.SimpleNamespace(MAX_TEXT_LENGTH=MAX)  # type: ignore[attr-defined]
    constants.ParseMode = types.SimpleNamespace(MARKDOWN_V2="MarkdownV2")  # type: ignore[attr-defined]
    error = types.ModuleType("telegram.error")
    error.InvalidToken = type("InvalidToken", (Exception,), {})  # type: ignore[attr-defined]
    error.RetryAfter = RetryAfterError  # type: ignore[attr-defined]
    ext = types.ModuleType("telegram.ext")
    for name in ("ApplicationBuilder", "CallbackQueryHandler", "MessageHandler"):
        setattr(ext, name, object)
    ext.filters = types.SimpleNamespace()  # type: ignore[attr-defined]
    ext.ContextTypes = types.SimpleNamespace(DEFAULT_TYPE=object)  # type: ignore[attr-defined]
    helpers = types.ModuleType("telegram.helpers")
    helpers.escape_markdown = _escape_markdown  # type: ignore[attr-defined]
    request = types.ModuleType("telegram.request")
    request.HTTPXRequest = object  # type: ignore[attr-defined]
    return {
        "telegram": telegram, "telegram.constants": constants, "telegram.error": error,
        "telegram.ext": ext, "telegram.helpers": helpers, "telegram.request": request,
    }


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


def _install_stubs(monkeypatch: Any) -> None:
    monkeypatch.setattr(sys, "path", list(sys.path))  # tgapp prepends the code root
    for name, module in _telegram_stubs().items():
        monkeypatch.setitem(sys.modules, name, module)

    agentmain = types.ModuleType("agentmain")
    agentmain.GeneraticAgent = FakeAgent  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agentmain", agentmain)

    llmcore = types.ModuleType("llmcore")
    llmcore.mykeys = {}  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "llmcore", llmcore)

    def reset_conversation(agent: FakeAgent, message: str | None = NEW_CHAT_TEXT) -> Any:
        agent.abort()
        agent.history = []
        return message

    def continue_command(agent: FakeAgent, query: str, exclude_pid: Any = None) -> str:
        if query.strip() == "/continue":
            return "可恢复会话列表"
        if query.strip() == "/continue 1":
            reset_conversation(agent, message=None)
            return "✅ 已恢复 3 轮完整对话"
        return "❌ 索引越界（有效范围 1-1）"

    continue_cmd = types.ModuleType("continue_cmd")
    continue_cmd.handle_frontend_command = continue_command  # type: ignore[attr-defined]
    continue_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    continue_cmd.reset_conversation = reset_conversation  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "continue_cmd", continue_cmd)

    btw_cmd = types.ModuleType("btw_cmd")
    btw_cmd.handle_frontend_command = lambda _agent, cmd: f"btw: {cmd}"  # type: ignore[attr-defined]
    btw_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "btw_cmd", btw_cmd)

    def review(_agent: Any, body: str, display_queue: Any) -> str | None:
        if body == "help":
            display_queue.put({"done": "review 用法", "source": "system"})
            return None
        return f"REVIEW PROMPT {body}".strip()

    review_cmd = types.ModuleType("review_cmd")
    review_cmd.handle = review  # type: ignore[attr-defined]
    review_cmd.install = lambda _cls: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "review_cmd", review_cmd)

    _exec_module(monkeypatch, "chatapp_common", _FRONTENDS / "chatapp_common.py")
    _exec_module(monkeypatch, "galley_im_display", _FRONTENDS / "galley_im_display.py")


class Env:
    def __init__(self, tg: Any, clock: FakeClock) -> None:
        self.tg = tg
        self.clock = clock
        self.bot = FakeBot()
        self.chat = FakeChat(CHAT_ID, "private")
        self.ctx = types.SimpleNamespace(user_data={})
        tg._clock = clock

    @property
    def agent(self) -> FakeAgent:
        agent = self.tg.agent
        assert isinstance(agent, FakeAgent)
        return agent

    def user_message(self, text: str | None = "hi", chat: FakeChat | None = None) -> FakeMessage:
        return FakeMessage(self.bot, chat or self.chat, text)

    def update(
        self, message: FakeMessage | None = None, uid: int = OWNER, query: Any = None
    ) -> Any:
        return types.SimpleNamespace(
            effective_user=types.SimpleNamespace(id=uid), message=message, callback_query=query,
        )

    async def say(self, text: str = "hi", chat: FakeChat | None = None) -> FakeMessage:
        message = self.user_message(text, chat)
        await self.tg.handle_msg(self.update(message), self.ctx)
        return message

    async def command(self, text: str) -> FakeMessage:
        message = self.user_message(text)
        await self.tg.handle_command(self.update(message), self.ctx)
        return message

    async def click(self, message: FakeMessage | None, data: str, uid: int = OWNER) -> FakeQuery:
        query = FakeQuery(data, message)
        await self.tg.handle_ask_callback(self.update(query=query, uid=uid), self.ctx)
        return query

    async def settle(self) -> None:
        for _ in range(200):
            pending = [task for task in self.tg._background_tasks if not task.done()]
            if not pending:
                break
            await asyncio.gather(*pending)
        await asyncio.sleep(0)

    def run(self, body: Callable[[], Awaitable[None]]) -> None:
        async def main() -> None:
            try:
                await asyncio.wait_for(body(), 20)
            finally:
                for task in list(self.tg._background_tasks):
                    task.cancel()

        asyncio.run(main())


@pytest.fixture
def env(monkeypatch: Any) -> Env:
    _install_stubs(monkeypatch)
    monkeypatch.setenv(
        "GALLEY_TELEGRAM_CONFIG_JSON",
        json.dumps({"tg_bot_token": "t", "tg_allowed_users": [str(OWNER)]}),
    )
    tg = _exec_module(monkeypatch, "_galley_test_tgapp", _FRONTENDS / "tgapp.py")
    monkeypatch.setattr(tg, "_LIVE_POLL_SECONDS", 0.01)
    tg._register_ask_user_hook()
    clock = FakeClock()
    FakeAgent.clock = clock
    return Env(tg, clock)


@pytest.fixture
def display(monkeypatch: Any) -> Any:
    _install_stubs(monkeypatch)
    return sys.modules["galley_im_display"]


# ── script helpers ─────────────────────────────────────────────────────


def turn_text(k: int, body: str, tool: str | None = None) -> str:
    text = f"\nLLM Running (Turn {k}) ...\n\n{body}\n"
    return text + (f"🛠️ {tool}\n" if tool else "")


def nxt(texts: list[str], advance: float = 0.0, **extra: Any) -> tuple[dict[str, Any], float]:
    """A `next` item: incremental text (the new step's text), whole step
    texts in `outputs` (inc_out=True)."""
    item = {"next": texts[-1], "source": "telegram", "turn": len(texts), "outputs": texts[-2:]}
    return ({**item, **extra}, advance)


def done(
    texts: list[str], advance: float = 0.0, tail: str = "", **extra: Any
) -> tuple[dict[str, Any], float]:
    item = {
        "done": "".join(texts) + tail, "source": "telegram", "turn": len(texts),
        "outputs": list(texts),
    }
    return ({**item, **extra}, advance)


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


def header_b(label: str, *lines: str) -> str:
    esc = [_escape_markdown(line, 2) for line in lines]
    return "\n".join([f"**>{_escape_markdown(label, 2)}", *(f">{line}" for line in esc)]) + "||"


def buttons(message: FakeMessage) -> list[list[tuple[str, str | None]]]:
    markup = message.reply_markup
    if markup is None:
        return []
    return [[(b.text, b.callback_data) for b in row] for row in markup.inline_keyboard]


ASK_T1 = turn_text(1, "<summary>查看现状</summary>", 'code_run({"script": "ls"})')
ASK_T2 = turn_text(
    2,
    "<summary>确认方向</summary>我需要你确认一下。",
    "ask_user(用哪个方案？\ncandidates:\n- 方案 A\n- 方案 B)",
)


async def ask_two_steps(env: Env, question: str = "用哪个方案？",
                        candidates: list[str] | None = None) -> FakeMessage:
    """A 2-step run (10 s) that ends asking `question`; returns the question."""
    candidates = ["方案 A", "方案 B"] if candidates is None else candidates
    d, adv = done([ASK_T1, ASK_T2], 6.0)
    env.agent.scripts.append([
        nxt([ASK_T1]), nxt([ASK_T1, ASK_T2], 4.0),
        ({**d, "_ask": ask_ctx(question, candidates)}, adv),
    ])
    await env.say("改一下")
    await env.settle()
    return env.bot.sent[-1]


async def ask_once(env: Env, question: str, candidates: list[str]) -> FakeMessage:
    t1 = turn_text(1, "", f"ask_user({question})")
    d, adv = done([t1], 1.0)
    env.agent.scripts.append([nxt([t1]), ({**d, "_ask": ask_ctx(question, candidates)}, adv)])
    await env.say("问我")
    await env.settle()
    return env.bot.sent[-1]


# ── 01 / 05: live status message and answer ────────────────────────────


def test_single_step_answer_replaces_status_message(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>打招呼</summary>你好！")
        env.agent.scripts.append([nxt([t1]), done([t1], 3.0)])
        trigger = await env.say("hi")
        await env.settle()

        status, answer = env.bot.sent
        # A private chat gets the same silent status message as a group.
        assert status.kwargs == STATUS_KWARGS
        assert status.shown() == ["·· 思考中"]
        assert status.deleted
        assert answer.text == header_b("1 步 · 用时 3 秒", "01 打招呼") + "\n\n你好！"
        assert answer.kwargs == {
            "parse_mode": "MarkdownV2", "do_quote": False, "disable_notification": False,
        }
        assert env.tg._RUNS == []
        assert env.agent.tasks[0][0] == f"{env.tg.FILE_HINT}\n\nhi"
        assert env.agent.tasks[0][1] == "telegram"
        assert trigger.message_id < status.message_id < answer.message_id

    env.run(body)


def test_multi_step_status_lines_and_answer_is_last_step_only(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(
            1, "<summary>读取会话列表</summary>我先查一下会话列表",
            'code_run({"script": "galley session list"})',
        )
        t2 = turn_text(2, "<summary>整理结果</summary>", 'file_read({"path": "a.md"})')
        t3 = turn_text(3, "<summary>回答</summary>一共有 3 个会话在跑。")
        env.agent.scripts.append([
            nxt([t1]), nxt([t1, t2], 2.0), nxt([t1, t2, t3], 2.0), done([t1, t2, t3], 6.0),
        ])
        await env.say("看看")
        await env.settle()

        status, answer = env.bot.sent
        assert status.shown() == [
            "·· 思考中",
            "01 读取会话列表\n·· 思考中",
            "已完成 2 步\n02 整理结果\n·· 思考中",
        ]
        assert [kwargs for _text, kwargs in status.edits] == [{}, {}]  # plain text, in place
        assert status.deleted
        assert answer.text == (
            header_b("3 步 · 用时 10 秒", "01 读取会话列表", "02 整理结果", "03 回答")
            + "\n\n一共有 3 个会话在跑。"
        )
        assert "我先查一下" not in (answer.text or "")
        assert "LLM Running" not in (answer.text or "") and "🛠" not in (answer.text or "")

    env.run(body)


def test_minute_line_and_reset_when_a_step_settles(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>跑测试</summary>", "code_run({})")
        t2 = turn_text(2, "<summary>收尾</summary>", "code_run({})")
        await env.say("跑测试")
        await wait_until(lambda: bool(env.agent.tasks))
        dq = env.agent.tasks[0][2]
        dq.put(*nxt([t1]))
        await wait_until(lambda: env.tg._RUNS[0].started_at is not None)
        (status,) = env.bot.sent
        env.clock.now += 59  # under a minute: no suffix, so nothing to edit
        await asyncio.sleep(0.05)
        assert status.shown() == ["·· 思考中"]
        env.clock.now += 1
        await wait_until(lambda: status.text == "·· 思考中 · 已 1 分钟 · 仍在运行")
        env.clock.now += 59  # still 1 minute: the same text is not edited again
        await asyncio.sleep(0.05)
        assert len(status.edits) == 1
        env.clock.now += 1
        await wait_until(lambda: status.text == "·· 思考中 · 已 2 分钟 · 仍在运行")
        dq.put(*nxt([t1, t2], 2.0))  # a settled step starts the count over
        await wait_until(lambda: status.text == "01 跑测试\n·· 思考中")
        dq.put(*done([t1, t2, turn_text(3, "好了")]))
        await env.settle()
        assert status.shown() == [
            "·· 思考中",
            "·· 思考中 · 已 1 分钟 · 仍在运行",
            "·· 思考中 · 已 2 分钟 · 仍在运行",
            "01 跑测试\n·· 思考中",
        ]
        assert status.deleted
        assert env.bot.sent[-1].text is not None and env.bot.sent[-1].text.endswith("好了")

    env.run(body)


def test_queued_line_has_no_time_and_answers_quote_their_triggers(env: Env) -> None:
    async def body() -> None:
        env.agent.is_running, env.agent._current_queue = True, object()  # a reporter turn
        await env.say("one")
        await wait_until(lambda: len(env.bot.sent) == 1)
        (status,) = env.bot.sent
        assert status.text == "·· 排队中"
        env.clock.now += 125  # a queue wait shows no time, minutes included
        await asyncio.sleep(0.05)
        assert status.shown() == ["·· 排队中"]
        await env.say("two")
        await wait_until(lambda: status.text == "·· 排队中\n另有 1 条消息排队中")
        assert len(env.tg._RUNS) == 2 and env.bot.sent == [status]  # one live surface per chat
        # The reporter turn ends; GA takes the first run's task.
        env.agent.is_running = False
        a1, b1 = turn_text(1, "第一个回答"), turn_text(1, "第二个回答")
        env.agent.tasks[0][2].put(*nxt([a1]))
        env.agent.tasks[0][2].put(*done([a1], 2.0))
        await wait_until(lambda: len(env.bot.others()) == 1)
        env.agent.tasks[1][2].put(*nxt([b1]))
        env.agent.tasks[1][2].put(*done([b1], 1.0))
        await env.settle()
        first, second = env.bot.others()
        assert first.text is not None and first.text.endswith("第一个回答")
        assert second.text is not None and second.text.endswith("第二个回答")
        first_status, second_status = env.bot.statuses()
        assert first_status.deleted and second_status.deleted
        # "two" landed below the first status message, so the first answer
        # quotes "one". The second run's status message only went out after
        # the first answer, so it does not stand in for "two": the second
        # answer quotes "two" as well.
        assert first.message_id < second_status.message_id
        assert first.kwargs["do_quote"] is True and second.kwargs["do_quote"] is True

    env.run(body)


def test_group_chat_uses_silent_status_message(env: Env) -> None:
    async def body() -> None:
        group = FakeChat(-100, "group")
        t1 = turn_text(1, "<summary>查</summary>", "code_run({})")
        t2 = turn_text(2, "答")
        env.agent.scripts.append([nxt([t1]), nxt([t1, t2], 2.0), done([t1, t2], 1.0)])
        trigger = await env.say("hi", chat=group)
        await env.settle()
        status, answer = env.bot.sent
        assert status.kwargs == STATUS_KWARGS
        assert status.shown() == ["·· 思考中", "01 查\n·· 思考中"]
        assert status.deleted
        assert answer.text == header_b("2 步 · 用时 3 秒", "01 查", "02 答") + "\n\n答"
        assert answer.kwargs["do_quote"] is False  # right under its status message
        assert trigger.chat.type == "group"

    env.run(body)


def test_status_message_send_failure_leaves_run_without_live_surface(env: Env) -> None:
    async def body() -> None:
        env.bot.fail_send = RuntimeError("network down")
        t1 = turn_text(1, "<summary>一</summary>", "code_run({})")
        t2 = turn_text(2, "答")
        env.agent.scripts.append([nxt([t1]), nxt([t1, t2], 2.0), done([t1, t2], 1.0)])
        await env.say("hi")
        await env.settle()
        (answer,) = env.bot.sent  # no second try at a status message; the answer lands
        assert answer.text is not None and answer.text.endswith("答")

    env.run(body)


def test_status_message_delete_failure_edits_done_marker(env: Env) -> None:
    async def body() -> None:
        env.bot.fail_delete = True
        t1 = turn_text(1, "答")
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        await env.say("hi")
        await env.settle()
        status = env.bot.sent[0]
        assert not status.deleted
        assert status.edits[-1][0] == "✓ 已完成"

    env.run(body)


def test_status_message_retry_after_backs_off(env: Env) -> None:
    async def body() -> None:
        env.bot.fail_send = RetryAfterError(10)
        t1 = turn_text(1, "<summary>一</summary>", "code_run({})")
        t2 = turn_text(2, "答")
        await env.say("hi")
        await wait_until(lambda: bool(env.agent.tasks))
        dq = env.agent.tasks[0][2]
        dq.put(*nxt([t1]))
        dq.put(*nxt([t1, t2], 5.0))  # 5 s < 10 s + margin: still backing off
        await wait_until(lambda: env.tg._RUNS[0].task_turn == 2)
        await asyncio.sleep(0.05)
        assert env.bot.sent == []
        env.clock.now += 7
        await wait_until(lambda: len(env.bot.sent) == 1)
        (status,) = env.bot.sent
        assert status.kwargs == STATUS_KWARGS and status.shown() == ["01 一\n·· 思考中"]
        dq.put(*done([t1, t2]))
        await env.settle()
        assert status.deleted
        assert env.bot.sent[-1].text is not None and env.bot.sent[-1].text.endswith("答")

    env.run(body)


def test_fold_header_b_is_the_only_style(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>查 (1)</summary>", "code_run({})")
        t2 = turn_text(2, "结果是 1.5")
        env.agent.scripts.append([nxt([t1]), nxt([t1, t2], 1.0), done([t1, t2], 1.0)])
        await env.say("q")
        await env.settle()
        assert env.bot.sent[-1].text == (
            "**>2 步 · 用时 2 秒\n>01 查 \\(1\\)\n>02 结果是 1\\.5||\n\n结果是 1\\.5"
        )
        # The dogfood switch is gone: /fold is an unknown command again.
        await env.command("/fold a")
        assert env.bot.sent[-1].text == env.tg.HELP_TEXT
        assert not hasattr(env.tg, "_FOLD_STYLE")
        assert "/fold" not in env.tg.HELP_TEXT
        assert all(cmd != "fold" for cmd, _ in env.tg.TELEGRAM_MENU_COMMANDS)

    env.run(body)


def test_fold_b_keeps_last_30_steps(env: Env) -> None:
    async def body() -> None:
        texts = [
            turn_text(k, f"<summary>第 {k} 步</summary>", "code_run({})") for k in range(1, 35)
        ]
        texts.append(turn_text(35, "完成"))
        env.agent.scripts.append([nxt(texts[:1]), done(texts, 70.0)])
        await env.say("长任务")
        await env.settle()
        text = env.bot.sent[-1].text or ""
        lines = text.split("\n")
        assert lines[0] == "**>35 步 · 用时 1 分 10 秒"
        assert lines[1] == ">… 前 5 步略"
        assert lines[2] == ">06 第 6 步"
        assert lines[31] == ">35 完成||"
        assert lines[32:] == ["", "完成"]

    env.run(body)


def test_plain_fallback_when_markdown_is_rejected(env: Env) -> None:
    async def body() -> None:
        env.bot.reject_markdown = True
        t1 = turn_text(1, "<summary>查</summary>**好**")
        env.agent.scripts.append([nxt([t1]), done([t1], 2.0)])
        await env.say("hi")
        await env.settle()
        (answer,) = env.bot.others()
        assert answer.text == "1 步 · 用时 2 秒\n01 查\n\n**好**"
        assert "parse_mode" not in answer.kwargs

    env.run(body)


def test_long_answer_pushes_first_part_only(env: Env) -> None:
    async def body() -> None:
        long_body = "\n".join(f"第 {i} 行：" + "内容" * 40 for i in range(120))
        t1 = turn_text(1, long_body)
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        await env.say("长")
        await env.settle()
        parts = env.bot.others()
        assert len(parts) >= 3
        assert [m.kwargs["disable_notification"] for m in parts] == (
            [False] + [True] * (len(parts) - 1)
        )
        assert all(len(m.text or "") <= MAX for m in parts)
        assert (parts[0].text or "").startswith("**>1 步 · 用时 1 秒")
        assert not any((m.text or "").startswith("**>") for m in parts[1:])

    env.run(body)


def test_files_go_out_silently_after_the_answer(env: Env, tmp_path: Path) -> None:
    async def body() -> None:
        report = tmp_path / "report.pdf"
        report.write_text("x")
        t1 = turn_text(1, "<summary>写报告</summary>", "file_write({})")
        t2 = turn_text(2, f"报告在这里 [FILE:{report}]")
        env.agent.scripts.append([nxt([t1]), nxt([t1, t2], 1.0), done([t1, t2], 1.0)])
        await env.say("写")
        await env.settle()
        answer, attachment = env.bot.others()
        assert (answer.text or "").endswith("报告在这里 report\\.pdf")
        assert attachment.kwargs["file"][0] == "document"
        assert attachment.kwargs["disable_notification"] is True

    env.run(body)


def test_answer_quotes_trigger_when_other_messages_intervened(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "答")

        def someone_spoke() -> None:
            env.tg._note_message(env.user_message("别的"))

        env.agent.scripts.append([nxt([t1]), done([t1], 1.0, _effect=someone_spoke)])
        await env.say("hi")
        await env.settle()
        assert env.bot.sent[-1].kwargs["do_quote"] is True

    env.run(body)


def test_backend_error_tail_stays_in_answer(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>调用模型</summary>", "code_run({})")
        t2 = turn_text(2, "")
        tail = "\n```\nError: HTTP 524\n```"
        env.agent.scripts.append([nxt([t1]), nxt([t1, t2], 1.0), done([t1, t2], 1.0, tail=tail)])
        await env.say("hi")
        await env.settle()
        assert "HTTP 524" in (env.bot.sent[-1].text or "")

    env.run(body)


def test_frontend_failure_posts_counts_and_error(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "<summary>一</summary>", "code_run({})")
        t2 = turn_text(2, "答")

        def break_next_send() -> None:
            env.bot.fail_send = RuntimeError("network down")
            env.bot.fail_sends = 2  # the MarkdownV2 send and its plain retry

        env.agent.scripts.append([
            nxt([t1]), nxt([t1, t2], 1.0), done([t1, t2], 3.0, _effect=break_next_send),
        ])
        await env.say("hi")
        await env.settle()
        (error,) = env.bot.others()
        assert error.text == "_2 步 · 用时 4 秒_\n❌ 出错：network down"
        (status,) = env.bot.statuses()
        assert status.deleted
        assert env.tg._RUNS == []

    env.run(body)


def test_put_task_failure_posts_error(env: Env) -> None:
    async def body() -> None:
        env.agent.fail_put = RuntimeError("boom")
        await env.say("hi")
        await env.settle()
        assert env.bot.texts() == ["❌ 出错：boom"]
        assert env.tg._RUNS == []

    env.run(body)


# ── Markdown fidelity and the reporter seams ───────────────────────────


def test_markdown_rewrite(env: Env) -> None:
    rewrite = env.tg._rewrite_markdown
    assert rewrite("## 结论 ##\n正文") == "**结论**\n正文"
    assert rewrite("# C#") == "**C#**"
    assert rewrite("#标签 不是标题") == "#标签 不是标题"
    assert rewrite("上\n---\n下\n***\n___") == "上\n\n下\n\n"
    assert rewrite("- 一\n  * 二\n+ 三\n1. 有序") == "• 一\n  • 二\n• 三\n1. 有序"
    assert rewrite("**粗体** 开头") == "**粗体** 开头"
    quoted = rewrite("前\n> 引用一\n> 引用二\n后")
    assert quoted == "前\n" + env.tg._quote_tag("引用一\n引用二") + "\n后"
    fenced = "```md\n# 标题\n| a | b |\n|---|---|\n| 1 | 2 |\n- x\n> y\n```"
    assert rewrite(fenced) == fenced
    assert rewrite("```py x```\n# 标题") == "```py x```\n**标题**"


def test_tables_to_lists(display: Any) -> None:
    rewrite = display.tables_to_lists
    two = "磁盘：\n| 项目 | 容量 |\n|---|---:|\n| **总计** | 1 TB |\n| 已用 | 49\\|2% |\n结论"
    assert rewrite(two) == "磁盘：\n\n• **总计**：1 TB\n• 已用：49|2%\n\n结论"
    three = (
        "| 名称 | 状态 | 备注 |\n| :-- | :-: | --- |\n| a | 运行 | |\n| b | | 慢 |\n|  | 停 | x |"
    )
    assert rewrite(three) == "• a — 状态：运行\n• b — 备注：慢\n• 状态：停；备注：x"
    assert rewrite("| 只有 |\n| --- |\n| 一 |\n| 二 |") == "• 一\n• 二"
    assert rewrite("| 甲 | 乙 |\n|---|---|\n\n下文") == "• 甲 · 乙\n\n下文"
    fenced = "```\n| a | b |\n|---|---|\n| 1 | 2 |\n```"
    assert rewrite(fenced) == fenced
    assert rewrite("a | b\n--- | ---\n1 | 2") == "• 1：2"
    assert rewrite("```x```\n| a | b |\n|---|---|\n| 1 | 2 |") == "```x```\n\n• 1：2"
    assert rewrite("标题\n---\n正文") == "标题\n---\n正文"  # setext heading, not a table
    assert rewrite("| a | b |\n|---|\n| 1 | 2 |") == "| a | b |\n|---|\n| 1 | 2 |"


def test_answer_text_seam(env: Env, tmp_path: Path) -> None:
    answer_text = env.tg.answer_text
    t1 = turn_text(1, "<summary>查</summary>我先看看", 'code_run({"script": "ls"})')
    t2 = turn_text(2, "<summary>答</summary>一共 **3** 个 [FILE:/tmp/x/报告.md]")
    assert answer_text(t1 + t2) == "一共 **3** 个 报告.md"
    assert answer_text("**LLM Running (Turn 1) ...**\n\n只有一步") == "只有一步"
    assert answer_text("没有标记的文本") == "没有标记的文本"
    assert answer_text("") == ""
    assert answer_text(turn_text(1, "", "code_run({})")) == ""
    assert answer_text(t1 + turn_text(2, "SKIP")) == "SKIP"


def test_markdown_v2_segments_seam(env: Env) -> None:
    segments = env.tg.markdown_v2_segments
    assert segments("") == []
    ((markdown, plain),) = segments("## 标题\n| a | b |\n|---|---|\n| 1 | 2.5 |\n> 注")
    assert markdown == "*标题*\n\n• 1：2\\.5\n\n> 注"
    assert plain == "**标题**\n\n• 1：2.5\n\n> 注"
    long_text = "\n".join("行" * 50 + f" {i}." for i in range(300))
    parts = segments(long_text)
    assert len(parts) > 1
    assert all(len(md) <= MAX and len(pl) <= MAX for md, pl in parts)
    assert "".join(pl.replace("\n", "") for _md, pl in parts) == long_text.replace("\n", "")


# ── shared display helpers ─────────────────────────────────────────────


def test_shared_elapsed_and_labels(display: Any) -> None:
    assert display.format_elapsed(0.4) == ""
    assert display.format_elapsed(59.5) == "用时 1 分 0 秒"
    assert display.fold_label(2, 0.5) == "2 步 · 用时 1 秒"
    assert display.fold_label(12, 125) == "12 步 · 用时 2 分 5 秒"
    assert display.fold_label(0, 0) == ""
    assert display.stopped_text(3, 7) == "⏹ 已停止 · 3 步 · 用时 7 秒"
    assert display.stopped_text(0, 0) == "⏹ 已停止"
    # dcapp's `_status_content` wording: whole minutes from 60 s, no seconds.
    assert display.still_running_suffix(59.9) == ""
    assert display.still_running_suffix(60) == " · 已 1 分钟 · 仍在运行"
    assert display.still_running_suffix(119.9) == " · 已 1 分钟 · 仍在运行"
    assert display.still_running_suffix(3725) == " · 已 62 分钟 · 仍在运行"
    assert display.still_running_suffix(-5) == ""
    assert not hasattr(display, "live_elapsed")
    assert display.one_line(" a \n b ") == "a b"
    assert display.clip("abcdef", 4) == "abc…"
    assert display.clip("abc", 4) == "abc"


def test_shared_step_summary_and_answer(display: Any) -> None:
    summary = display.step_summary
    assert summary(turn_text(1, "<summary>a</summary>x<summary>最后  一个\n摘要</summary>")) == (
        "最后 一个 摘要"
    )
    assert summary("<summary>外部</summary><thinking><summary>内部</summary></thinking>") == "外部"
    assert summary(turn_text(1, "\n\n先看看目录结构\n再说", 'code_run({"script": "ls"})')) == (
        "先看看目录结构"
    )
    assert summary(turn_text(1, "", 'code_run({"script": "ls"})')) == "调用了运行代码"
    assert summary(turn_text(1, "", "update_working_checkpoint(x)")) == (
        "调用了update_working_checkpoint"
    )
    assert summary("") == ""
    assert summary(f"<summary>{'长' * 200}</summary>") == "长" * 120
    t1 = turn_text(1, "<summary>调用模型</summary>", "code_run({})")
    t2 = turn_text(2, "")
    tail = "\n```\nError: HTTP 524\n```"
    step = display.final_step_text(t1 + t2 + tail, [t1, t2])
    assert step == t2 + tail
    assert "HTTP 524" in display.answer_body(step, t1 + t2 + tail)
    tool_only = turn_text(1, "", "code_run({})")
    assert display.answer_body(tool_only, tool_only) == ""
    assert display.strip_transcript("正文\n🛠️ code_run({})\n\nSTDOUT x\n[FILE:a.png]\n") == "正文"
    assert display.visible_text(turn_text(1, "", "code_run({})")) == ""


def test_shared_ask_user_helpers(display: Any) -> None:
    extract = display.extract_ask_user_event
    assert extract({}) is None
    assert extract({"exit_reason": {"result": "CURRENT_TASK_DONE"}}) is None
    assert extract(ask_ctx("直接说", [])) == {
        "question": "直接说", "candidates": [], "multi": False,
    }
    split = [
        {"tool_name": "ask_user", "args": {"question": "选哪个？[多选]", "candidates": ["乙"]}},
        {"tool_name": "ask_user", "args": {"question": "别的问题", "candidates": ["丙"]}},
        {"tool_name": "code_run", "args": {}},
    ]
    assert extract(ask_ctx("选哪个？[多选]", ["甲", " "], split)) == {
        "question": "选哪个？[多选]", "candidates": ["甲", "乙"], "multi": True,
    }
    assert display.candidate_list(None) == [] and display.candidate_list(" x ") == ["x"]
    layout = display.candidate_layout
    assert layout(["是", "否"]) == "row"
    assert layout(["一", "二", "三", "四", "五"]) == "list"
    assert layout(["一个超过二十个字的候选项目需要走列表形态展示"]) == "list"
    assert layout(["一" * 16] * 3 + ["二" * 12]) == "row"  # 60 characters in all
    assert layout(["一" * 16] * 3 + ["二" * 13]) == "list"  # 61
    assert display.MULTI_SELECT_RE.search("pick (multi-select)")


# ── 02: ask_user ───────────────────────────────────────────────────────


def test_ask_row_click_continues_run_with_carried_counts(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        assert question.text == (
            "_⏸ 等你回复 · 已完成 2 步_\n我需要你确认一下。\n用哪个方案？"
        )
        assert question.kwargs["parse_mode"] == "MarkdownV2"
        menu = env.tg._pending_asks[CHAT_ID].menu_id
        assert buttons(question) == [
            [("方案 A", f"ask:{menu}:0")], [("方案 B", f"ask:{menu}:1")],
        ]
        (first_status,) = env.bot.statuses()
        assert first_status.shown()[-1] == "01 查看现状\n·· 思考中" and first_status.deleted

        t3 = turn_text(1, "<summary>改好了</summary>", "file_patch({})")
        t4 = turn_text(2, "按方案 B 改完了。")
        env.agent.scripts.append([nxt([t3]), nxt([t3, t4], 2.0), done([t3, t4], 1.0)])
        query = await env.click(question, f"ask:{menu}:1")
        assert query.answers == [(None, None)]
        assert query.text_edits[0][0] == (
            "_已回复 · 已完成 2 步_\n我需要你确认一下。\n用哪个方案？\n_方案 A_\n✓ 方案 B"
        )
        assert query.text_edits[0][1]["reply_markup"] is None
        assert env.agent.tasks[-1][0] == f"{env.tg.FILE_HINT}\n\n方案 B"
        await env.settle()
        answer = env.bot.sent[-1]
        assert answer.text == header_b(
            "4 步 · 用时 13 秒", "01 查看现状", "02 确认方向", "03 改好了", "04 按方案 B 改完了。",
        ) + "\n\n按方案 B 改完了。"
        assert answer.kwargs["do_quote"] is False  # right below the question it continues
        _first, second_status = env.bot.statuses()
        assert second_status.shown() == [
            "已完成 2 步\n02 确认方向\n·· 思考中", "已完成 3 步\n03 改好了\n·· 思考中",
        ]
        assert second_status.deleted
        # The answered button again: silent, buttons dropped, nothing runs.
        tasks = len(env.agent.tasks)
        again = await env.click(question, f"ask:{menu}:0")
        assert again.answers == [(None, None)] and again.markup_edits == [None]
        assert len(env.agent.tasks) == tasks

    env.run(body)


def test_ask_layouts(env: Env) -> None:
    async def body() -> None:
        none = await ask_once(env, "你想怎么改？\n说具体点", [])
        assert none.text == "_⏸ 等你回复 · 已完成 1 步_\n你想怎么改？\n说具体点"
        assert buttons(none) == []
        await env.command("/new")

        many = [f"选项 {i}" for i in range(1, 7)]
        listed = await ask_once(env, "选一个", many)
        menu = env.tg._pending_asks[CHAT_ID].menu_id
        assert listed.text == "_⏸ 等你回复 · 已完成 1 步_\n选一个\n" + "\n".join(
            f"{i}\\. 选项 {i}" for i in range(1, 7)
        )
        assert buttons(listed) == [[(str(i), f"ask:{menu}:{i - 1}") for i in range(1, 7)]]
        env.agent.scripts.append([nxt([turn_text(1, "好")]), done([turn_text(1, "好")])])
        echo = await env.click(listed, f"ask:{menu}:1")
        assert echo.text_edits[0][0].split("\n")[2:5] == [
            "_1\\. 选项 1_", "✓ 2\\. 选项 2", "_3\\. 选项 3_",
        ]
        await env.settle()

        numbers = [f"候选 {i}" for i in range(1, 11)]
        wide = await ask_once(env, "十个", numbers)
        assert [len(row) for row in buttons(wide)] == [8, 2]
        await env.command("/new")

        too_many = [f"候选 {i}" for i in range(1, 52)]
        text_only = await ask_once(env, "五十一个", too_many)
        assert buttons(text_only) == []
        assert (text_only.text or "").endswith("51\\. 候选 51")

    env.run(body)


def test_ask_multi_select_toggles_and_submits(env: Env) -> None:
    async def body() -> None:
        question = await ask_once(env, "选几个？[多选]", ["甲", "乙", "丙"])
        menu = env.tg._pending_asks[CHAT_ID].menu_id
        assert question.text == (
            "_⏸ 等你回复 · 已完成 1 步_\n选几个？\\[多选\\]\n"
            "_多选：点选后按「提交」，也可以直接打字回复_"
        )
        assert buttons(question)[-1] == [("提交", f"ask:{menu}:done")]
        empty = await env.click(question, f"ask:{menu}:done")
        assert empty.answers == [("请至少选择一项，或直接打字回复", True)]
        toggle = await env.click(question, f"ask:{menu}:toggle:2")
        assert toggle.answers == [(None, None)]
        assert [[b.text for b in row] for row in toggle.markup_edits[0].inline_keyboard] == [
            ["甲"], ["乙"], ["✓ 丙"], ["提交"],
        ]
        await env.click(question, f"ask:{menu}:toggle:0")
        await env.click(question, f"ask:{menu}:toggle:2")
        await env.click(question, f"ask:{menu}:toggle:1")
        t1 = turn_text(1, "好")
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        submit = await env.click(question, f"ask:{menu}:done")
        assert submit.text_edits[0][0] == (
            "_已回复 · 已完成 1 步_\n选几个？\\[多选\\]\n✓ 甲\n✓ 乙\n_丙_"
        )
        assert env.agent.tasks[-1][0].endswith("\n\n甲；乙")
        await env.settle()

    env.run(body)


def test_ask_non_owner_and_locked_clicks(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        menu = env.tg._pending_asks[CHAT_ID].menu_id
        tasks = len(env.agent.tasks)
        stranger = await env.click(question, f"ask:{menu}:0", uid=STRANGER)
        assert stranger.answers == [("no", True)] and stranger.text_edits == []
        assert len(env.agent.tasks) == tasks and CHAT_ID in env.tg._pending_asks
        env.tg.ALLOWED = set()  # managed and not paired yet: locked
        locked = await env.click(question, f"ask:{menu}:0")
        assert locked.answers == [(None, None)] and locked.text_edits == []
        assert len(env.agent.tasks) == tasks and CHAT_ID in env.tg._pending_asks

    env.run(body)


def test_stale_button_after_restart_is_silent(env: Env) -> None:
    async def body() -> None:
        old = env.user_message("旧提问")
        query = await env.click(old, "ask:0123456789abcdef:1")
        assert query.answers == [(None, None)] and query.markup_edits == [None]
        assert env.agent.tasks == []

    env.run(body)


def test_ask_typed_answer_echoes_without_tick(env: Env) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        t3 = turn_text(1, "按你说的办。")
        env.agent.scripts.append([nxt([t3]), done([t3], 3.0)])
        await env.say("都不要，用 C")
        await env.settle()
        assert question.edits[0][0] == (
            "_已回复 · 已完成 2 步_\n我需要你确认一下。\n用哪个方案？\n_方案 A_\n_方案 B_"
        )
        assert question.reply_markup is None
        assert (env.bot.sent[-1].text or "").startswith("**>3 步 · 用时 13 秒")
        assert CHAT_ID not in env.tg._pending_asks

    env.run(body)


def test_photo_does_not_answer_a_pending_question(env: Env, tmp_path: Path) -> None:
    async def body() -> None:
        env.tg._TEMP_DIR = str(tmp_path)
        await ask_two_steps(env)

        class FakeFile:
            async def download_to_drive(self, path: str) -> None:
                Path(path).write_text("img")

        async def get_file() -> FakeFile:
            return FakeFile()

        photo = env.user_message(None)
        photo.photo = [types.SimpleNamespace(file_unique_id="u1", get_file=get_file)]
        t1 = turn_text(1, "收到图片")
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        await env.tg.handle_photo(env.update(photo), env.ctx)
        await env.settle()
        assert env.agent.tasks[-1][0] == "[TIPS] 收到图片temp/tg_u1.jpg，请等待下一步指令"
        assert env.bot.sent[-1].text == header_b("1 步 · 用时 1 秒", "01 收到图片") + "\n\n收到图片"
        assert CHAT_ID in env.tg._pending_asks  # still waiting for its answer

    env.run(body)


def test_ask_from_other_task_is_not_claimed(env: Env) -> None:
    async def body() -> None:
        t1 = turn_text(1, "答")
        d, adv = done([t1], 1.0)
        env.agent.scripts.append([
            nxt([t1]), ({**d, "_foreign_ask": ask_ctx("报告轮的提问", ["是"])}, adv),
        ])
        await env.say("hi")
        await env.settle()
        assert (env.bot.sent[-1].text or "").endswith("答")
        assert CHAT_ID not in env.tg._pending_asks

    env.run(body)


def test_new_and_restore_drop_pending_question(env: Env, monkeypatch: Any) -> None:
    async def body() -> None:
        question = await ask_two_steps(env)
        await env.command("/new")
        assert CHAT_ID not in env.tg._pending_asks
        assert question.edits[-1] == (None, {"reply_markup": None})
        assert env.bot.sent[-1].text == NEW_CHAT_TEXT

        monkeypatch.setattr(env.tg, "format_restore", lambda: ((["[USER]: x"], "log.txt", 1), None))
        second = await ask_two_steps(env)
        await env.command("/restore")
        assert CHAT_ID not in env.tg._pending_asks and second.reply_markup is None
        assert env.agent.history == ["[USER]: x"]
        # A typed message afterwards is a fresh run (no carried steps).
        t1 = turn_text(1, "新的")
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        await env.say("新问题")
        await env.settle()
        assert (env.bot.sent[-1].text or "").startswith("**>1 步")

    env.run(body)


# ── 02: stop, queue and commands ───────────────────────────────────────


async def start_long_run(env: Env) -> ScriptQueue:
    t1 = turn_text(1, "<summary>长任务</summary>", "code_run({})")
    await env.say("one")
    await wait_until(lambda: bool(env.agent.tasks))
    dq = env.agent.tasks[-1][2]
    dq.put(*nxt([t1]))
    await wait_until(lambda: env.tg._running_run() is not None)
    return dq


def test_stop_freezes_status_message_and_keeps_queue(env: Env) -> None:
    async def body() -> None:
        await start_long_run(env)
        await env.say("two")
        env.clock.now += 7
        await env.command("/stop")
        assert env.agent.aborted == 1
        # The receipt is the run's own status message, frozen; nothing new.
        status = env.bot.sent[0]
        assert status.kwargs == STATUS_KWARGS
        assert status.text == "⏹ 已停止 · 1 步 · 用时 7 秒" and not status.deleted
        assert env.bot.others() == []
        await wait_until(lambda: len(env.tg._RUNS) == 1)
        # The aborted task's `done` is nobody's answer.
        env.agent.tasks[0][2].put(*done([turn_text(1, "半截")]))
        b1 = turn_text(1, "二")
        env.agent.tasks[1][2].put(*nxt([b1]))
        env.agent.tasks[1][2].put(*done([b1], 1.0))
        await env.settle()
        assert status.text == "⏹ 已停止 · 1 步 · 用时 7 秒" and not status.deleted
        assert env.bot.other_texts() == [header_b("1 步 · 用时 1 秒", "01 二") + "\n\n二"]
        assert env.tg._RUNS == []

    env.run(body)


def test_stop_without_a_status_message_posts_the_receipt(env: Env) -> None:
    async def body() -> None:
        env.bot.fail_send = RuntimeError("network down")  # the status message never lands
        await start_long_run(env)
        env.clock.now += 3
        await env.command("/stop")
        (receipt,) = env.bot.sent
        assert receipt.text == "⏹ 已停止 · 1 步 · 用时 3 秒"
        assert receipt.kwargs == {"do_quote": True}  # the /stop command landed after the trigger
        await env.settle()

    env.run(body)


def test_stop_without_running_run(env: Env) -> None:
    async def body() -> None:
        await env.command("/stop")
        assert env.bot.texts() == ["当前没有在跑的任务"]
        # Only a queued run, GA busy with a completion-reporter turn: no abort.
        env.agent.is_running, env.agent._current_queue = True, object()
        await env.say("排队")
        await env.command("/stop")
        assert env.bot.other_texts() == ["当前没有在跑的任务", "当前没有在跑的任务"]
        assert env.agent.aborted == 0 and env.agent.abort_calls == 0
        assert len(env.tg._RUNS) == 1
        for task in list(env.tg._background_tasks):
            task.cancel()

    env.run(body)


def test_stop_in_group_freezes_status_message(env: Env) -> None:
    async def body() -> None:
        group = FakeChat(-100, "group")
        t1 = turn_text(1, "<summary>长任务</summary>", "code_run({})")
        await env.say("one", chat=group)
        await wait_until(lambda: bool(env.agent.tasks))
        env.agent.tasks[0][2].put(*nxt([t1]))
        await wait_until(lambda: env.tg._running_run() is not None)
        env.clock.now += 3
        await env.tg.handle_command(env.update(env.user_message("/stop", group)), env.ctx)
        (status,) = env.bot.sent
        assert status.text == "⏹ 已停止 · 1 步 · 用时 3 秒" and not status.deleted
        await env.settle()

    env.run(body)


def test_new_stops_running_run_and_queued_run_still_answers(env: Env) -> None:
    async def body() -> None:
        await start_long_run(env)
        await env.say("two")
        env.clock.now += 4
        await env.command("/new")
        # The frozen status message sits above 🆕.
        assert env.bot.texts() == ["⏹ 已停止 · 1 步 · 用时 4 秒", NEW_CHAT_TEXT]
        assert env.bot.sent[0].kwargs == STATUS_KWARGS
        await wait_until(lambda: len(env.tg._RUNS) == 1)
        b1 = turn_text(1, "新上下文里的回答")
        env.agent.tasks[1][2].put(*nxt([b1]))
        env.agent.tasks[1][2].put(*done([b1], 1.0))
        await env.settle()
        assert (env.bot.texts()[-1] or "").endswith("新上下文里的回答")

    env.run(body)


def test_continue_n_stops_only_when_it_resets(env: Env) -> None:
    async def body() -> None:
        await start_long_run(env)
        await env.command("/continue 9")  # out of range: nothing aborted
        assert env.bot.other_texts() == ["❌ 索引越界（有效范围 1-1）"]
        assert env.tg._RUNS[0].state == "running"
        env.clock.now += 2
        await env.command("/continue 1")
        assert env.bot.statuses()[0].text == "⏹ 已停止 · 1 步 · 用时 2 秒"
        assert env.bot.other_texts()[1:] == ["✅ 已恢复 3 轮完整对话"]
        assert "abort" not in vars(env.agent)  # the probe is gone
        await env.command("/continue")
        assert env.bot.texts()[-1] == "可恢复会话列表"
        await env.settle()

    env.run(body)


def test_help_btw_review_commands(env: Env) -> None:
    async def body() -> None:
        await env.command("/help")
        assert env.bot.texts()[-1] == env.tg.HELP_TEXT
        await env.command("/btw 进展如何")
        assert env.bot.texts()[-1] == "btw: /btw 进展如何"
        await env.command("/review help")
        assert env.bot.texts()[-1] == "review 用法"
        assert env.agent.tasks == []
        t1 = turn_text(1, "审完了")
        env.agent.scripts.append([nxt([t1]), done([t1], 1.0)])
        await env.command("/review src")
        await env.settle()
        assert env.agent.tasks[-1][0] == "REVIEW PROMPT src"
        assert (env.bot.texts()[-1] or "").endswith("审完了")

    env.run(body)


def test_unauthorized_message_is_refused_without_a_run(env: Env) -> None:
    async def body() -> None:
        message = env.user_message("hi")
        await env.tg.handle_msg(env.update(message, uid=STRANGER), env.ctx)
        assert env.bot.texts() == ["no"] and env.agent.tasks == []

    env.run(body)


# ── 04: reporter through the real tgapp seams ──────────────────────────


def test_reporter_through_real_tgapp_seams(env: Env, monkeypatch: Any) -> None:
    """The reporter (runner, ticket 03) and tgapp's answer_text /
    markdown_v2_segments (patch 0024, ticket 01) were built from one written
    contract by two hands: a report turn's whole multi-step `done` must reach
    the owner as the closing step only, tables listed, under a bold title
    and over an italic footer."""
    from runner import im_reporter

    sent: list[tuple[str, str, str, str | None]] = []

    def fake_send(token: str, chat_id: str, text: str, parse_mode: str | None = None) -> None:
        sent.append((token, chat_id, text, parse_mode))

    monkeypatch.setattr(im_reporter, "_telegram_send_text", fake_send)
    channel = im_reporter.TelegramChannel(env.tg)
    raw = turn_text(
        1,
        "<summary>查会话</summary>我先看一下会话状态。",
        'code_run({"script": "galley sessions list"})',
    ) + turn_text(
        2,
        "<summary>汇报</summary>会话已完成：\n\n| 项目 | 结果 |\n|---|---:|\n| 周报 | **已整理** |",
    )
    text = channel.render(raw)
    assert "LLM Running" not in text and "🛠️" not in text and "我先看一下" not in text
    report = im_reporter.Report(
        kind="completed", session={"id": "s-1", "title": "整理*周报*"}, message=None
    )
    channel.send_report(str(OWNER), text, raw, report)
    ((token, chat_id, markdown, parse_mode),) = sent
    assert (token, chat_id, parse_mode) == ("t", str(OWNER), "MarkdownV2")
    assert markdown == (
        "*✅ 整理周报*\n\n会话已完成：\n\n• 周报：*已整理*\n\n_已完成 · s\\-1_"
    )
