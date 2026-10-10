"""Galley's WeChat conversation: what the managed WeChat channel says, and when.

Upstream ``frontends/wechatapp.py`` both talks to iLink (``WxBotClient``,
``_dl_media``) and decides what the chat sees (``on_message`` / ``_handle``).
Galley keeps the transport and replaces the conversation: ``_run_wechat``
(``runner/managed_im_supervisor.py``) polls with
``WechatConversation.on_message`` instead of upstream's, so no managed patch
is needed. Of the four IM frontends, ``wechatapp.py`` is the one upstream
still changes, which is why this lives in the runner (the 2026-10-10 WeChat
conversation UX devlog, ruling 5). Display rules shared with Telegram and
Discord come from ``frontends/galley_im_display.py`` (managed patch
``0024``).

What the chat sees (``.scratch/wechat-ux/PRD.md``): iLink can neither edit
nor delete a message, a second message reusing a ``client_id`` is dropped,
and its native tool-progress items do not show (2026-10-10 device probe).
So a run shows only 「对方正在输入」 and then posts exactly one message: its
answer (the closing step, plus a ``N 步 · 用时 X`` last line from two steps
on), its ask_user question, or, on ``/stop``, the stop receipt. Markdown
goes out as written: WeChat renders all of it.

Threads: ``run_loop`` calls ``on_message`` on its polling thread, which
parses, answers commands and registers runs; the one wait it has is a media
download, as upstream. A single worker thread, alive while runs are
registered, reads the head run's display queue, posts its message and keeps
the typing indicator up.

Coupling points (``docs/ga-baseline.md``): ``wechatapp.agent``,
``WxBotClient`` (``send_text`` / ``get_typing_ticket`` / ``send_typing`` /
``send_image`` / ``send_file`` / ``send_video`` / ``run_loop``),
``_dl_media``, ``_TEMP_DIR``, ``ITEM_TEXT`` and the ``voice_item.text``
transcription; the agent's ``put_task`` / ``abort`` / ``is_running`` /
``_current_queue`` / ``_turn_end_hooks`` / ``list_llms`` / ``next_llm``;
``galley_im_display``'s ``answer_body`` / ``visible_text`` /
``final_step_text`` / ``extract_ask_user_event`` / ``fold_label`` /
``stopped_text`` / ``one_line``; ``continue_cmd``'s ``reset_conversation``
and ``handle_frontend_command``.
"""

from __future__ import annotations

import importlib
import json
import os
import queue
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from runner.im_resume import ChannelResume

OWNER_FILE_NAME = "wechat_owner.json"
# The official iLink plugin's textChunkLimit: longer text goes out as
# several messages.
TEXT_LIMIT = 4000
# Upstream wechatapp's prompt prefix for a message that is not a command.
FILE_HINT = "If you need to show files to user, use [FILE:filepath] in your response."
ASK_USER_HOOK_KEY = "galley_wechat_ask_user"
NO_RUNNING_TASK_TEXT = "当前没有在跑的任务"  # tgapp's _NO_RUNNING_TASK_TEXT
EMPTY_ANSWER_WITH_FILES = "已生成附件"  # tgapp's answer when only files remain
# Upstream wechatapp defaults to forwarding everything to a detached
# conductor child that has neither the managed mykey loader nor the Galley
# prompt; the launcher pins the in-process agent and /switch is refused.
SWITCH_BLOCKED_REPLY = "Galley 托管的微信渠道固定由 supervisor 处理消息，不支持 /switch。"
# The same core command table as the other channels (Settings shows it).
HELP_COMMANDS = (
    ("/new", "开始新对话"),
    ("/stop", "停止当前任务"),
    ("/status", "查看运行状态和当前模型"),
    ("/llm", "查看可用模型"),
    ("/llm n", "切换到第 n 个模型"),
    ("/help", "查看全部命令"),
)
HELP_REPLY = "📖 命令列表：\n" + "\n".join(
    f"{command} - {description}" for command, description in HELP_COMMANDS
)

_ASK_EVENT_LIMIT = 8
# Upstream wechatapp's placeholders that are not files to send.
_PLACEHOLDER_FILES = {
    "filepath",
    "<filepath>",
    "path",
    "<path>",
    "file_path",
    "<file_path>",
    "...",
}
_VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
_FILE_MARKER_RE = re.compile(r"\[FILE:([^\]]+)\]")
# Image syntax: upstream _strip_md drops it, and so does the official plugin.
_IMAGE_RE = re.compile(r"!\[.*?\]\(.*?\)")
_TURN_MARKER_LINE_RE = re.compile(r"^\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}[ \t]*$", re.M)
_FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
_INDEX_RE = re.compile(r"\s*(\d+)\s*")  # \d: any Unicode digit, fullwidth included


def _display() -> Any:
    """``frontends/galley_im_display.py``, importable once the launcher has
    put the managed frontends directory on ``sys.path``. Importing it pulls
    in ``chatapp_common``, which installs ``/continue`` / ``/btw`` /
    ``/review`` on the GA class, as on the other channels."""
    return importlib.import_module("galley_im_display")


# -- text ----------------------------------------------------------------


def _file_names(text: str) -> str:
    """[FILE:path] markers shown as file names, nothing else touched: the
    transcript cleaning drops markers, so the names go in before it (tgapp's
    ``_file_names``)."""
    return _FILE_MARKER_RE.sub(lambda match: os.path.basename(match.group(1)), text or "")


def _strip_images(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", _IMAGE_RE.sub("", text or "")).strip()


def _answer_body(step_text: str, raw: str) -> str:
    """A finished task's answer text: the closing step cleaned (tgapp's
    ``_answer_from``), image syntax dropped, Markdown otherwise as written."""
    body = _display().answer_body(_file_names(step_text), _file_names(raw))
    return _strip_images(str(body or ""))


def answer_text(raw: str) -> str:
    """The answer of a finished task from its whole ``done`` text alone, for
    a caller without the per-step ``outputs`` (the completion reporter's
    turn): the closing step, split on GA's ``LLM Running (Turn N) ...``
    marker lines, cleaned as an answer, [FILE:] markers shown as file
    names, no ``N 步`` last line. "" when nothing visible remains."""
    raw = raw or ""
    markers = list(_TURN_MARKER_LINE_RE.finditer(raw))
    return _answer_body(raw[markers[-1].start() :] if markers else raw, raw)


@dataclass
class _Piece:
    """A line of the text, or a slice of an over-long one (``sep`` "")."""

    text: str
    sep: str  # what joins it to the piece before it
    fence: tuple[str, str] | None  # (opener line, closing marker) of the code block it starts in


def _pieces(text: str, width: int) -> list[_Piece]:
    pieces: list[_Piece] = []
    fence: tuple[str, str] | None = None
    for line in text.split("\n"):
        inside = fence
        for start in range(0, max(len(line), 1), width):
            pieces.append(_Piece(line[start : start + width], "\n" if start == 0 else "", inside))
        match = _FENCE_RE.match(line)
        if fence is None:
            if match and not (match.group(1)[0] == "`" and "`" in match.group(2)):
                fence = (line, match.group(1))
        elif match and match.group(1)[0] == fence[1][0] and len(match.group(1)) >= len(fence[1]):
            if not match.group(2).strip():
                fence = None
    return pieces


def split_message(text: str, limit: int = TEXT_LIMIT) -> list[str]:
    """Cut ``text`` into messages of at most ``limit`` characters, losing
    nothing. Each cut goes as late as it can, preferring, among cuts that
    fill at least a third of a message: a blank line outside code blocks,
    then a line end outside them, then a line end inside one; else the
    latest cut that fits, mid-line for a line longer than a message. A cut
    inside a code block closes its fence at the end of one message and
    reopens it (same opener line) at the start of the next."""
    text = (text or "").strip()
    if not text:
        return []
    pieces = _pieces(text, max(1, limit // 2))
    min_fill = limit // 3
    parts: list[str] = []
    a = 0
    while a < len(pieces):
        opener = pieces[a].fence
        size = len(opener[0]) + 1 if opener else 0
        best: list[int | None] = [None, None, None, None]
        end: int | None = None
        j = a
        while j < len(pieces):
            size += len(pieces[j].text) + (len(pieces[j].sep) if j > a else 0)
            j += 1
            if size > limit:
                break
            if j == len(pieces):
                end = j
                break
            after = pieces[j]
            inside = after.fence is not None
            total = size + (len(after.fence[1]) + 1 if after.fence else 0)
            if total > limit:
                continue
            if after.sep == "" or total < min_fill:
                tier = 3
            elif inside:
                tier = 2
            elif not after.text.strip() or not pieces[j - 1].text.strip():
                tier = 0
            else:
                tier = 1
            best[tier] = j
        if end is None:
            end = next((cut for cut in best if cut is not None), a + 1)
        body = pieces[a].text + "".join(piece.sep + piece.text for piece in pieces[a + 1 : end])
        if opener:
            body = f"{opener[0]}\n{body}"
        closing = pieces[end].fence if end < len(pieces) else None
        body = f"{body}\n{closing[1]}" if closing else body.rstrip()
        if body.strip():
            parts.append(body)
        a = end
        while a < len(pieces) and pieces[a].fence is None and not pieces[a].text.strip():
            a += 1  # blank lines at a cut are the cut
    return parts


def _compose(body: str, head: str = "", tail: str = "") -> list[str]:
    """``body`` split into messages, ``head`` (the context-lost notice) as
    the first paragraph of the first, ``tail`` as the last paragraph of the
    last; room for both is kept in every part, so none goes over."""
    room = TEXT_LIMIT - (len(head) + 2 if head else 0) - (len(tail) + 2 if tail else 0)
    parts = split_message(body, room) or [""]
    parts[0] = "\n\n".join(text for text in (head, parts[0]) if text)
    parts[-1] = "\n\n".join(text for text in (parts[-1], tail) if text)
    return [part for part in parts if part]


class WechatSendError(RuntimeError):
    """iLink refused a message: HTTP 200 with a non-zero ``ret`` or an
    ``errcode`` in the body. Upstream's ``_post`` raises for HTTP errors only;
    the official plugin (2.4.6) checks the body for this."""


def _check_sent(response: Any) -> None:
    if not isinstance(response, dict):
        return
    ret, errcode = response.get("ret"), response.get("errcode")
    if ret not in (None, 0) or errcode:
        raise WechatSendError(
            f"iLink refused the message: ret={ret} errcode={errcode} "
            f"errmsg={response.get('errmsg', '')}"
        )


def _inbound(items: Any, text_type: Any) -> tuple[str, list[Any]]:
    """A message's text and the items left to download. Text items and
    transcribed voice (``voice_item.text``, iLink's own transcription, which
    the official plugin reads as the message text) join in item order; a
    voice without a transcription downloads as upstream does."""
    texts: list[str] = []
    media: list[Any] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        text_item = item.get("text_item")
        if item.get("type") == text_type and isinstance(text_item, dict):
            texts.append(str(text_item.get("text", "") or ""))
            continue
        voice = item.get("voice_item")
        spoken = str(voice.get("text") or "").strip() if isinstance(voice, dict) else ""
        if spoken:
            texts.append(spoken)
        else:
            media.append(item)
    return "\n".join(texts).strip(), media


def status_reply(agent: Any) -> str:
    """The other channels' ``/status`` (chatapp_common's) for WeChat's single
    agent: running or idle, and the current model."""
    llm = agent.get_llm_name() if getattr(agent, "llmclient", None) else "未配置"
    state = "🔴 运行中" if getattr(agent, "is_running", False) else "🟢 空闲"
    return f"状态：{state}\nLLM：[{agent.llm_no}] {llm}"


# -- runs ----------------------------------------------------------------


@dataclass
class _PendingAsk:
    """A posted ask_user question waiting for its reply: the next plain text
    message answers it and carries the run's step count and clock on."""

    candidates: list[str]
    multi: bool
    steps: int
    elapsed: float

    def answer(self, text: str) -> str:
        """What GA gets for a reply: a single-choice question's candidate for
        an in-range number (fullwidth digits too), like a chip click on the
        desktop; anything else as typed."""
        match = _INDEX_RE.fullmatch(text)
        if self.multi or match is None:
            return text
        index = int(match.group(1))
        return self.candidates[index - 1] if 1 <= index <= len(self.candidates) else text


class _Run:
    """One user message's run: a GA task, plus the ask_user segments it
    continues (their steps and time add up; the wait for the reply does not
    count). States: queued / running / asking / done / stopped / error."""

    def __init__(self, uid: str, media_paths: list[str]) -> None:
        self.uid = uid
        self.media_paths = media_paths  # the user's own files, never sent back
        self.dq: Any = None
        self.error: Exception | None = None
        self.state = "queued"
        self.adopts_ask = False  # takes the uid's pending question once it is the head
        self.base_steps = 0
        self.base_elapsed = 0.0
        self.task_turn = 0  # highest GA turn seen in this run's task
        self.started_at: float | None = None
        self.ended_at: float | None = None

    def adopt(self, pending: _PendingAsk) -> None:
        self.base_steps, self.base_elapsed = pending.steps, pending.elapsed

    def total_steps(self) -> int:
        return self.base_steps + self.task_turn

    def elapsed(self, now: float) -> float:
        """From the run's first display item: time spent queued does not count."""
        if self.started_at is None:
            return self.base_elapsed
        return self.base_elapsed + max(0.0, now - self.started_at)

    def observe(self, item: dict[str, Any], now: float) -> list[str]:
        """Fold one display-queue item in (tgapp's ``_TgRun.observe`` count,
        without the step summaries nothing shows here). Returns ``done``'s
        per-step texts."""
        if self.started_at is None:
            self.started_at, self.state = now, "running"
        outputs = item.get("outputs")
        texts = [str(text or "") for text in outputs] if isinstance(outputs, list) else []
        turn = item.get("turn")
        turn = turn if isinstance(turn, int) else 0
        if "done" in item:
            turn = max(turn, len(texts))
        self.task_turn = max(self.task_turn, turn)
        return texts


@dataclass
class _Typing:
    ticket: str  # "" when iLink gave none: no indicator until the uid's runs are over
    sent_at: float | None = None


class WechatConversation:
    """The managed WeChat channel's conversation over upstream's transport.

    The interface the completion reporter uses (``WechatChannel`` in
    ``runner/im_reporter.py``): ``agent``, ``connected()``, ``owner_id()``,
    ``busy()`` and ``send_text(user_id, text)``."""

    poll_seconds = 0.5  # display-queue wait between checks for a stop
    typing_seconds = 2.0  # upstream's typing refresh

    def __init__(
        self,
        wechatapp: Any,
        bot: Any,
        state_dir: Path,
        resume: ChannelResume | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.wechatapp = wechatapp
        self.agent: Any = wechatapp.agent
        self.bot = bot
        self.resume = resume
        self._clock = clock  # run timing and typing pacing; injectable for tests
        self._owner_path = Path(state_dir) / OWNER_FILE_NAME
        self._owner = self._load_owner()
        self._connected = False
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._runs: list[_Run] = []  # every registered run, in GA's task order
        self._pending: dict[str, _PendingAsk] = {}  # uid -> question waiting for its reply
        self._contexts: dict[str, str] = {}  # uid -> newest context_token
        self._worker: threading.Thread | None = None
        self._typing: dict[str, _Typing] = {}  # worker thread only
        self._ask_lock = threading.Lock()  # ask_user events arrive on GA's thread
        self._ask_events: dict[Any, dict[str, Any]] = {}  # asking task's display queue -> event
        self._install_ask_hook()

    # -- the reporter's interface -----------------------------------------

    def connected(self) -> bool:
        """``run_loop`` is polling (the login is done)."""
        return self._connected

    def owner_id(self) -> str | None:
        """Whoever messaged the bot last (WeChat has no pairing), kept across
        restarts so a report can go out before anyone speaks."""
        return self._owner

    def busy(self) -> bool:
        with self._lock:
            if self._runs:
                return True
        return bool(getattr(self.agent, "is_running", False))

    def send_text(self, user_id: str, text: str) -> None:
        """Send ``text`` as is, split at TEXT_LIMIT, each part a new message
        (``WxBotClient.send_text`` mints a new ``client_id`` every call).
        Raises on the first part iLink did not take."""
        parts = split_message(text)
        if not parts:
            raise ValueError("nothing to send")
        for part in parts:
            self._send(user_id, part)

    # -- polling ----------------------------------------------------------

    def run(self) -> None:
        """Poll iLink until upstream's ``run_loop`` gives up (AuthExpired) or
        is interrupted."""
        self._connected = True
        try:
            self.bot.run_loop(self.on_message)
        finally:
            self._connected = False

    def on_message(self, _bot: Any, msg: Any) -> None:
        """``run_loop``'s callback, on its polling thread: never waits on a
        run."""
        if not isinstance(msg, dict):
            return
        uid = str(msg.get("from_user_id") or "")
        context = str(msg.get("context_token") or "")
        text, media_items = _inbound(msg.get("item_list"), self.wechatapp.ITEM_TEXT)
        media_paths = [str(p) for p in self.wechatapp._dl_media(media_items)] if media_items else []
        if not text and not media_paths:
            return
        if media_paths:
            text = (text + "\n" if text else "") + "\n".join(
                f"[用户发送文件: {path}]" for path in media_paths
            )
        print(f"[WX] 收到: {text[:80]}", flush=True)
        if uid:
            if context:
                self._contexts[uid] = context
            self._note_owner(uid)
        if not self._command(uid, text):
            self._enqueue(uid, text, media_paths)

    def _load_owner(self) -> str | None:
        try:
            data = json.loads(self._owner_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        uid = data.get("userId") if isinstance(data, dict) else None
        return uid if isinstance(uid, str) and uid else None

    def _note_owner(self, uid: str) -> None:
        """Persist the id only (never what was said; constitution rule 4),
        and only when it changes. Written on the polling thread alone."""
        if uid == self._owner:
            return
        try:
            tmp = self._owner_path.with_name(self._owner_path.name + ".tmp")
            tmp.write_text(json.dumps({"userId": uid}) + "\n", encoding="utf-8")
            os.replace(tmp, self._owner_path)
        except OSError as e:
            print(f"[WX] could not save the owner: {e}")
            return  # retried on the next message
        self._owner = uid

    # -- commands ---------------------------------------------------------

    def _command(self, uid: str, text: str) -> bool:
        """Answer a Galley command (the whole message, exactly); False for
        anything else, which runs as a task (other ``/`` messages too, as
        upstream: GA handles ``/btw``, ``/review``, ``/session.*``)."""
        parts = text.split()
        head = parts[0] if parts else ""
        if text == "/switch":
            self._post(uid, SWITCH_BLOCKED_REPLY)
        elif text == "/help":
            self._post(uid, HELP_REPLY)
        elif text == "/status":
            self._post(uid, status_reply(self.agent))
        elif head == "/llm":
            self._llm(uid, parts)
        elif text in ("/stop", "/abort"):
            self._stop(uid)
        elif text == "/new":
            self._new(uid)
        elif head == "/continue":
            self._continue(uid, text)
        else:
            return False
        return True

    def _llm(self, uid: str, parts: list[str]) -> None:
        """Upstream wechatapp's ``/llm``, word for word."""
        agent = self.agent
        if len(parts) > 1:
            try:
                agent.next_llm(int(parts[1]))
                reply = f"切换到 [{agent.llm_no}] {agent.get_llm_name()}"
            except (ValueError, IndexError):
                reply = f"用法: /llm <0-{len(agent.list_llms()) - 1}>"
        else:
            lines = [f"{'→' if cur else '  '} [{i}] {name}" for i, name, cur in agent.list_llms()]
            reply = "LLMs:\n" + "\n".join(lines)
        self._post(uid, reply)

    def _stop(self, uid: str) -> None:
        """Stops the running run only: queued runs stay, and the run's stop
        receipt is the only reply. Nothing is left behind when nothing runs
        (upstream's flag stopped the next answer instead)."""
        with self._lock:
            run = self._running_run()
            if run is not None:
                self._mark_stopped(run)
        if run is None:
            self._post(uid, NO_RUNNING_TASK_TEXT)
            return
        self.agent.abort()
        print("[WX run] stopped by command", flush=True)
        self._post_stopped(run)

    def _new(self, uid: str) -> None:
        """A running run stops (its receipt first), then the conversation
        resets, and with restart continuity on moves to a new log; queued
        runs go on in the new context. Pending questions are dropped."""
        with self._lock:
            run = self._running_run()
            if run is not None:
                self._mark_stopped(run)
            self._pending.clear()
        try:
            reply = str(self._continue_cmd().reset_conversation(self.agent))
            if self.resume is not None:
                self.resume.fresh(self.agent)
        finally:
            if run is not None:
                self._post_stopped(run)
        self._post(uid, reply)

    def _continue(self, uid: str, text: str) -> None:
        """``/continue`` lists past sessions; ``/continue N`` picks one up,
        aborting GA's task, and with restart continuity on moves the log
        mapping onto it (``ChannelResume.continue_session``, as Telegram and
        Feishu do). Run here rather than as GA's own slash command, which
        would leave the mapping on the old log."""
        cc = self._continue_cmd()
        resume = self.resume

        def upstream() -> Any:
            return cc.handle_frontend_command(self.agent, text)

        def call() -> Any:
            if resume is None:
                return upstream()
            return resume.continue_session(self.agent, text, upstream)

        stopped: list[_Run] = []
        try:
            reply, aborted = self._stopping_on_abort(stopped, call)
        finally:
            for run in stopped:
                self._post_stopped(run)
        if aborted:
            with self._lock:
                self._pending.clear()
        self._post(uid, str(reply))

    def _stopping_on_abort(self, stopped: list[_Run], call: Callable[[], Any]) -> tuple[Any, bool]:
        """Run a command helper that aborts GA's task on some paths only
        (``/continue N`` with a valid index); return its result and whether
        it aborted. The run it aborts is marked stopped inside that abort,
        before GA can hand the task's ``done`` to the worker (tgapp's
        ``_call_noting_abort``)."""
        agent = self.agent
        original = agent.abort
        own = "abort" in vars(agent)
        calls: list[bool] = []

        def abort(*args: Any, **kwargs: Any) -> Any:
            calls.append(True)
            with self._lock:
                run = self._running_run()
                if run is not None:
                    self._mark_stopped(run)
                    stopped.append(run)
            return original(*args, **kwargs)

        agent.abort = abort
        try:
            return call(), bool(calls)
        finally:
            if own:
                agent.abort = original
            else:
                del agent.abort

    def _continue_cmd(self) -> Any:
        """The ``continue_cmd`` restart continuity holds, else the one
        ``chatapp_common`` imported (both the managed frontends' top-level
        module)."""
        if self.resume is not None:
            return self.resume.cc
        return importlib.import_module("continue_cmd")

    # -- runs -------------------------------------------------------------

    def _enqueue(self, uid: str, text: str, media_paths: list[str]) -> None:
        """Register a run and hand its task to GA in one step, so the run
        list and GA's task queue keep the same order. A plain text message
        is the reply to the uid's pending question: right away when it is
        next in line for it, else once the run is the head (a message sent
        before the question was posted is still GA's next input)."""
        run = _Run(uid, media_paths)
        prompt = text
        with self._lock:
            if not text.startswith("/"):
                if not media_paths:  # a picture or a file does not answer
                    pending = self._pending.get(uid)
                    if pending is not None and not any(
                        other.uid == uid and other.adopts_ask for other in self._runs
                    ):
                        del self._pending[uid]
                        run.adopt(pending)
                        text = pending.answer(text)
                    else:
                        run.adopts_ask = True
                prompt = f"{FILE_HINT}\n\n{text}"
            self._runs.append(run)
            try:
                run.dq = self.agent.put_task(prompt, source="wechat")
            except Exception as e:
                run.error = e
            position = len(self._runs)
            self._cond.notify_all()
            if self._worker is None:
                self._worker = threading.Thread(
                    target=self._work, name="galley-wechat-runs", daemon=True
                )
                self._worker.start()
        print(
            f"[WX run] queued: position={position} continued={run.base_steps > 0}",
            flush=True,
        )

    def _head(self) -> _Run | None:
        """The run GA is on or gets next: the first one not stopped (a
        stopped run stays listed only until its receipt is out)."""
        return next((run for run in self._runs if run.state != "stopped"), None)

    def _running_run(self) -> _Run | None:
        """Under the lock: the user run GA is working on, or None -- also
        while GA runs a completion-reporter turn or sits between tasks, when
        /stop must abort nothing (tgapp's ``_running_run``)."""
        run = self._head()
        if run is None or run.state != "running" or not getattr(self.agent, "is_running", False):
            return None
        return run if getattr(self.agent, "_current_queue", None) is run.dq else None

    def _mark_stopped(self, run: _Run) -> None:
        # Under the lock, before anything blocks: the worker can then never
        # turn the aborted task's `done` into an answer.
        run.state, run.ended_at = "stopped", self._clock()

    def _work(self) -> None:
        """The worker: one at a time, alive while runs are registered or an
        indicator is still up. Only the head reads its display queue, so a
        run's message lands before the next run's."""
        try:
            while True:
                self._keep_typing()
                with self._lock:
                    run = self._head()
                    if run is None:
                        if not self._runs:
                            if not self._typing:
                                self._worker = None
                                return
                            continue  # take the indicator down first
                        self._cond.wait(self.poll_seconds)  # stop receipts on their way
                        continue
                try:
                    self._advance(run)
                except Exception as e:
                    print(f"[WX run error] {type(e).__name__}: {e}", flush=True)
                    self._fail(run, e)
        finally:
            with self._lock:
                if self._worker is threading.current_thread():
                    self._worker = None  # died unexpectedly: the next run starts a new one

    def _advance(self, run: _Run) -> None:
        """One step of the head run: take the question it answers, then wait
        up to poll_seconds for its next display item. No timeout ends a run
        (upstream's 300 s one answered with half a run): only its ``done``
        or ``/stop`` does."""
        with self._lock:
            if run.adopts_ask:
                run.adopts_ask = False
                pending = self._pending.pop(run.uid, None)
                if pending is not None:
                    run.adopt(pending)
        if run.error is not None:
            self._fail(run, run.error)
            return
        try:
            item = run.dq.get(True, self.poll_seconds)
        except queue.Empty:
            return
        if not isinstance(item, dict):
            return
        with self._lock:
            if run.state not in ("queued", "running"):
                return  # stopped while the item was on its way
            now = self._clock()
            outputs = run.observe(item, now)
            if "done" not in item:
                return
            run.ended_at = now
            steps, seconds = run.total_steps(), run.elapsed(now)
            event = self._take_ask_event(run.dq)
            if event is None:
                run.state = "done"
            else:
                run.state = "asking"
                self._pending[run.uid] = _PendingAsk(
                    list(event.get("candidates") or []), bool(event.get("multi")), steps, seconds
                )
        raw = str(item.get("done") or "")
        if event is None:
            self._post_answer(run, raw, outputs, steps, seconds)
        else:
            self._post_question(run, event, raw, outputs, steps)
        self._send_files(run, raw)
        self._retire(run)

    def _retire(self, run: _Run) -> None:
        with self._lock:
            if run in self._runs:
                self._runs.remove(run)
            self._cond.notify_all()

    def _fail(self, run: _Run, error: Exception) -> None:
        """A frontend failure (a GA backend error is part of ``done`` and
        shows in the answer): one ``❌ 出错：…`` message, as tgapp."""
        with self._lock:
            if run.state == "stopped":
                return  # its stop receipt is the run's message
            run.state = "error"
        self._post(run.uid, f"❌ 出错：{error}")
        self._retire(run)

    # -- ask_user ---------------------------------------------------------

    def _install_ask_hook(self) -> None:
        hooks = getattr(self.agent, "_turn_end_hooks", None)
        if not isinstance(hooks, dict):
            hooks = {}
            self.agent._turn_end_hooks = hooks
        hooks[ASK_USER_HOOK_KEY] = self._on_turn_end

    def _on_turn_end(self, ctx: Any) -> None:
        # GA's thread, before the task's `done`: the event is keyed by the
        # asking task's display queue, so only the run owning that task
        # claims it (a completion-reporter turn that asks is never claimed).
        event = _display().extract_ask_user_event(ctx)
        if event is None:
            return
        with self._ask_lock:
            self._ask_events[getattr(self.agent, "_current_queue", None)] = event
            while len(self._ask_events) > _ASK_EVENT_LIMIT:
                self._ask_events.pop(next(iter(self._ask_events)))

    def _take_ask_event(self, dq: Any) -> dict[str, Any] | None:
        with self._ask_lock:
            return self._ask_events.pop(dq, None) if dq is not None else None

    # -- messages ---------------------------------------------------------

    def _send(self, uid: str, text: str) -> None:
        response = self.bot.send_text(uid, text, context_token=self._contexts.get(uid, ""))
        _check_sent(response)

    def _post(self, uid: str, text: str, tail: str = "", lead: bool = False) -> bool:
        """One chat message, split at TEXT_LIMIT, ``tail`` as the last
        paragraph of the last part. ``lead``: a run's answer or question,
        whose first part carries the context-lost notice. Failures are
        logged; the rest of the message is not sent."""
        resume = self.resume if lead else None
        notice = resume.take_notice() if resume is not None else ""
        parts = _compose(text, notice, tail)
        for i, part in enumerate(parts):
            try:
                self._send(uid, part)
            except Exception as e:
                print(
                    f"[WX] send err part {i + 1}/{len(parts)} len={len(part)} "
                    f"{type(e).__name__}: {e}",
                    flush=True,
                )
                if i == 0 and notice and resume is not None:
                    resume.restore_notice()
                return False
        return True

    def _post_answer(
        self, run: _Run, raw: str, outputs: list[str], steps: int, seconds: float
    ) -> None:
        """The run's answer: its closing step, a blank line, then
        ``N 步 · 用时 X`` from two steps on (one step is chat, and WeChat has
        no small print for it)."""
        display = _display()
        body = _answer_body(display.final_step_text(raw, outputs), raw)
        if not body and self._files(run, raw):
            body = EMPTY_ANSWER_WITH_FILES
        tail = str(display.fold_label(steps, seconds)) if steps >= 2 else ""
        self._post(run.uid, body or ("" if tail else "..."), tail=tail, lead=True)
        print(f"[WX run] answered: steps={steps}", flush=True)

    def _post_question(
        self, run: _Run, event: dict[str, Any], raw: str, outputs: list[str], steps: int
    ) -> None:
        """The run's ask_user question, one message: the asking step's
        narration, the question, the candidates numbered (no buttons on
        WeChat), and what to reply with as the last line."""
        display = _display()
        step_text = display.final_step_text(raw, outputs)
        narration = _strip_images(str(display.visible_text(_file_names(step_text)) or ""))
        candidates = [str(candidate) for candidate in event.get("candidates") or []]
        lines = [str(event.get("question") or "").strip()]
        lines += [f"{i}. {display.one_line(text)}" for i, text in enumerate(candidates, 1)]
        body = "\n\n".join(text for text in (narration, "\n".join(lines)) if text)
        if not candidates:
            how = "等你回复"
        elif event.get("multi"):
            how = "可多选，回复序号或文字"
        else:
            how = "回复序号或文字"
        self._post(run.uid, body, tail=f"⏸ {how} · 已完成 {steps} 步", lead=True)
        print(f"[WX ask_user] posted: candidates={len(candidates)}", flush=True)

    def _post_stopped(self, run: _Run) -> None:
        """``⏹ 已停止 · N 步 · 用时 X``; the run leaves the list only once it
        is out, so the typing indicator comes down after it."""
        now = run.ended_at if run.ended_at is not None else self._clock()
        try:
            self._post(run.uid, str(_display().stopped_text(run.total_steps(), run.elapsed(now))))
        finally:
            self._retire(run)

    def _files(self, run: _Run, raw: str) -> list[str]:
        """The files a task's ``done`` names, as upstream picks them:
        placeholders and the user's own files skipped, relative paths under
        ``_TEMP_DIR``."""
        temp_dir = str(getattr(self.wechatapp, "_TEMP_DIR", "") or "")
        files: list[str] = []
        for name in _FILE_MARKER_RE.findall(raw or ""):
            if name.strip().lower() in _PLACEHOLDER_FILES:
                continue
            path = name if os.path.isabs(name) else os.path.join(temp_dir, name)
            if path not in run.media_paths and path not in files:
                files.append(path)
        return files

    def _send_files(self, run: _Run, raw: str) -> None:
        """After the run's message, as upstream: a failed file is logged."""
        for path in self._files(run, raw):
            try:
                if not os.path.exists(path):
                    raise FileNotFoundError(f"文件不存在: {path}")
                ext = os.path.splitext(path)[1].lower()
                if ext in _VIDEO_EXTS:
                    sender = self.bot.send_video
                elif ext in _IMAGE_EXTS:
                    sender = self.bot.send_image
                else:
                    sender = self.bot.send_file
                _check_sent(sender(run.uid, path, context_token=self._contexts.get(run.uid, "")))
                print(f"[WX] sent media: {path}", flush=True)
            except Exception as e:
                print(f"[WX] send media err: {e}", flush=True)

    # -- typing -----------------------------------------------------------

    def _keep_typing(self) -> None:
        """Worker thread only: 「对方正在输入」 is up for every uid with a
        registered run (queued or running), refreshed every typing_seconds,
        and taken down (status 2, which clears it at once) as soon as the
        uid's last run has posted its message."""
        with self._lock:
            active = {run.uid: self._contexts.get(run.uid, "") for run in self._runs}
        for uid in [uid for uid in self._typing if uid not in active]:
            state = self._typing.pop(uid)
            if state.ticket:
                try:
                    self.bot.send_typing(uid, state.ticket, cancel=True)
                except Exception as e:
                    print(f"[WX] typing cancel err: {type(e).__name__}: {e}", flush=True)
        now = self._clock()
        for uid, context in active.items():
            if uid not in self._typing:
                try:
                    ticket = str(self.bot.get_typing_ticket(uid, context) or "")
                except Exception as e:
                    print(f"[WX] typing ticket err: {type(e).__name__}: {e}", flush=True)
                    ticket = ""
                self._typing[uid] = _Typing(ticket)
            state = self._typing[uid]
            due = state.sent_at is None or now - state.sent_at >= self.typing_seconds
            if state.ticket and due:
                state.sent_at = now
                try:
                    self.bot.send_typing(uid, state.ticket)
                except Exception:
                    pass  # a missed refresh only shortens the indicator, as upstream
