"""Pick a single-agent IM channel's conversation back up across restarts.

Feishu, Telegram and WeChat run one GA agent per process, and that agent
writes its whole conversation to its engine log
(``temp/model_responses/model_responses_<logid>.txt``, ``agent.log_path``).
A restart used to hand the owner a blank agent without a word. Now the
channel's state directory keeps the basename of the log its agent writes
(``context_log.json``: the file name only, never conversation content;
constitution rule 4), and the next process picks the conversation back up
from that log with upstream's ``/continue`` loader before it serves
anything. A mapped log that cannot be picked back up is a fresh context,
and the next answer or question says so, once. ``/new`` moves the channel
onto a new log.

Discord does the same per channel inside managed patch ``0026``
(``frontends/dcapp.py``); managed GA code cannot import ``runner``, so that
patch keeps its own copy. The two map one to one:

- ``ChannelResume.resume``: dcapp ``DiscordApp._resume_channel``
- ``ChannelResume.record`` (turn-end hook): dcapp ``_record_channel_log``
  (run end, eviction)
- ``ChannelResume.fresh`` (``/new``): dcapp's ``/new`` branch
- ``ChannelResume.continue_session`` (``/continue N``): dcapp
  ``_continue_session``
- ``ChannelResume.take_notice``: dcapp ``_take_context_lost_notice``

Coupling points (``docs/ga-baseline.md``, Contract Surface item 16):
``continue_cmd``'s loader and lock functions, ``agent.log_path``,
``agent._turn_end_hooks``, and the frontend module globals the
``install_*`` functions below replace.
"""
from __future__ import annotations

import contextvars
import importlib
import json
import os
import re
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

MAPPING_FILE_NAME = "context_log.json"
CONTEXT_LOST_TEXT = "之前的对话没接上，这是新的上下文"
TURN_END_HOOK_KEY = "galley_im_resume"
LOG_NAME_RE = re.compile(r"model_responses_[0-9A-Za-z_]+\.txt")
# Lock owner (continue_cmd agent_id) of each channel: "galley-telegram", ...
LOCK_OWNER_PREFIX = "galley-"
LOG_PREFIX = "[galley-im-resume]"
_CONTINUE_N_RE = re.compile(r"/continue\s+(\d+)\s*$")


class ChannelResume:
    """The conversation lifetime of one single-agent channel: its log
    mapping, the startup resume, and the one-time context-lost notice."""

    def __init__(self, continue_cmd: Any, state_dir: Path, owner: str) -> None:
        self.cc = continue_cmd
        self.path = Path(state_dir) / MAPPING_FILE_NAME
        self.owner = owner
        self._lock = threading.Lock()
        self._mapped = self._load()
        self._notice = False

    # -- mapping ---------------------------------------------------------

    def _load(self) -> str | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        name = data.get("log") if isinstance(data, dict) else None
        return name if isinstance(name, str) and LOG_NAME_RE.fullmatch(name) else None

    def mapped_log(self) -> str | None:
        with self._lock:
            return self._mapped

    def _set(self, name: str | None) -> None:
        """Map the channel to a log basename, or drop the mapping (None)."""
        with self._lock:
            if name == self._mapped:
                return
            try:
                if name:
                    tmp = self.path.with_name(self.path.name + ".tmp")
                    tmp.write_text(json.dumps({"log": name}) + "\n", encoding="utf-8")
                    os.replace(tmp, self.path)
                else:
                    self.path.unlink(missing_ok=True)
            except OSError as e:
                print(f"{LOG_PREFIX} could not save the log mapping: {e}")
                return  # retried on the next turn end
            self._mapped = name

    def record(self, agent: Any) -> None:
        """Map the channel to the log its agent writes, once that log exists
        (a context nothing was said in has nothing to pick back up). The
        turn-end hook: GA has just written the turn to the log."""
        path = getattr(agent, "log_path", None)
        if not isinstance(path, str) or not os.path.isfile(path):
            return
        name = os.path.basename(path)
        if LOG_NAME_RE.fullmatch(name):
            self._set(name)

    # -- startup ---------------------------------------------------------

    def attach(self, agent: Any) -> None:
        """At startup, before the agent serves anything (no task queued, no
        reporter turn): pick the mapped conversation back up, then keep the
        mapping on the agent's log after every turn. Never raises: without
        it the channel still runs, as a fresh context."""
        try:
            self.resume(agent)
        except Exception as e:
            print(f"{LOG_PREFIX} resume failed: {type(e).__name__}: {e}")
        try:
            hooks = getattr(agent, "_turn_end_hooks", None)
            if not isinstance(hooks, dict):
                hooks = {}
                agent._turn_end_hooks = hooks
            hooks[TURN_END_HOOK_KEY] = lambda _ctx: self.record(agent)
        except Exception as e:
            print(f"{LOG_PREFIX} turn-end hook not installed: {type(e).__name__}: {e}")

    def resume(self, agent: Any) -> bool:
        """Pick the conversation back up from the mapped log, with upstream's
        /continue loader: in place (restore_wm), or in a copy when another
        live process holds the log. No mapping (never talked, or a state
        directory older than the mapping) is a fresh context, said nothing
        about; a mapping that cannot be picked back up is a fresh context on
        a new log plus CONTEXT_LOST_TEXT on the next answer or question."""
        name = self.mapped_log()
        current = getattr(agent, "log_path", None)
        if not name or not isinstance(current, str) or not current:
            return False
        path = os.path.join(os.path.dirname(current), name)
        cc = self.cc
        try:
            holder = cc.session_occupant(path)
            if (
                isinstance(holder, dict)
                and holder.get("agent_id") == self.owner
                and holder.get("pid") != os.getpid()
            ):
                # Still fresh (< 30 s) but left by this channel's previous
                # process, which is gone: supervisor.lock runs one process
                # per channel state directory. Upstream alone would refuse
                # it until the heartbeat goes stale.
                try:
                    os.remove(cc._lock_path(path))
                except FileNotFoundError:
                    pass
            msg, ok = cc.continue_inplace(agent, path, self.owner, restore_wm=True)
            if not ok and os.path.basename(agent.log_path) != name:
                # Held by another live process: go on in a copy of the log.
                msg, ok = cc.continue_copy(agent, path, self.owner, restore_wm=True)
        except Exception as e:
            msg, ok = f"{type(e).__name__}: {e}", False
        if ok:
            self._set(os.path.basename(agent.log_path))
            print(f"{LOG_PREFIX} resumed from {os.path.basename(agent.log_path)}")
            return True
        # Missing, empty or unparseable: start clean on a fresh log.
        try:
            cc.begin_fresh_session(agent, self.owner)
        except Exception as e:
            print(f"{LOG_PREFIX} fresh session failed: {type(e).__name__}: {e}")
        with self._lock:
            self._notice = True
        print(f"{LOG_PREFIX} could not resume from {name}: {msg}")
        return False

    # -- commands --------------------------------------------------------

    def fresh(self, agent: Any) -> None:
        """/new, after the frontend's own reset: a new log, mapped once
        something is said in it, so a restart never brings back what /new
        cleared (upstream's IM reset keeps writing the old log)."""
        try:
            self.cc.begin_fresh_session(agent, self.owner)
        except Exception as e:
            print(f"{LOG_PREFIX} fresh session failed: {type(e).__name__}: {e}")
        with self._lock:
            self._notice = False
        self._set(None)

    def continue_session(self, agent: Any, query: str, upstream: Callable[[], Any]) -> Any:
        """/continue N the way continue_cmd.handle_frontend_command runs it
        (same list, same reply), then the channel moves onto a copy of that
        log, so the log it maps to holds exactly the conversation it now
        has. Anything else (the bare list, a bad index) is upstream's."""
        m = _CONTINUE_N_RE.match((query or "").strip())
        sessions = self.cc.list_sessions(exclude_pid=os.getpid()) if m else []
        idx = int(m.group(1)) - 1 if m else -1
        if not 0 <= idx < len(sessions):
            return upstream()
        path = sessions[idx][0]
        self.cc.reset_conversation(agent, message=None)
        msg, full = self.cc.restore(agent, path)
        if full:
            self.cc.continue_copy(agent, path, self.owner)
            with self._lock:
                self._notice = False
            self.record(agent)
        return msg

    # -- the context-lost notice -----------------------------------------

    def take_notice(self) -> str:
        """CONTEXT_LOST_TEXT the first time an answer or question goes out
        after a failed resume, "" otherwise."""
        with self._lock:
            if not self._notice:
                return ""
            self._notice = False
        return CONTEXT_LOST_TEXT

    def restore_notice(self) -> None:
        """The message that took the notice never went out: the next one
        carries it."""
        with self._lock:
            self._notice = True


def load(platform: str, state_dir: Path) -> ChannelResume:
    """The channel's resume state, over the continue_cmd module its frontend
    already imported (the same lock registry and heartbeat thread)."""
    continue_cmd = importlib.import_module("continue_cmd")
    return ChannelResume(continue_cmd, state_dir, LOCK_OWNER_PREFIX + platform)


def _replace(module: Any, name: str, make: Callable[[Any], Any]) -> bool:
    """Replace a frontend module global the frontend looks up at call time."""
    original = getattr(module, name, None)
    if not callable(original):
        print(f"{LOG_PREFIX} {getattr(module, '__name__', module)}.{name} missing; not wrapped")
        return False
    setattr(module, name, make(original))
    return True


def _wrap_reset(resume: ChannelResume) -> Callable[[Any], Any]:
    def make(reset: Any) -> Any:
        def reset_conversation(agent: Any, *args: Any, **kwargs: Any) -> Any:
            reply = reset(agent, *args, **kwargs)
            resume.fresh(agent)
            return reply

        return reset_conversation

    return make


def _wrap_continue(resume: ChannelResume) -> Callable[[Any], Any]:
    def make(continue_command: Any) -> Any:
        def handle_continue(agent: Any, query: str, *args: Any, **kwargs: Any) -> Any:
            return resume.continue_session(
                agent, query, lambda: continue_command(agent, query, *args, **kwargs)
            )

        return handle_continue

    return make


# -- Feishu --------------------------------------------------------------


def install_feishu(fsapp: Any, resume: ChannelResume) -> None:
    """Feishu seams, all module globals looked up at call time:

    - ``fsapp._TaskCard``: a user task's card. ``done(text)`` sets the
      answer (or question) under the card's steps; the notice goes on its
      first line. Report turns never build a card (the reporter sends its
      own text), and a stopped / failed / timed-out card ends in ``fail``,
      so neither takes the notice.
    - ``_reset_conversation`` / ``_handle_continue_frontend`` of the module
      that defines ``AgentChatMixin`` (``frontends.chatapp_common``), which
      ``AgentChatMixin.handle_command`` runs for ``/new`` and ``/continue``.
      dcapp imports the same two names with ``from chatapp_common import``
      (bound at import, and a different module object), and a Discord
      process never runs this function."""
    base = getattr(fsapp, "_TaskCard", None)
    base_done: Any = getattr(base, "done", None)
    if isinstance(base, type) and callable(base_done):

        def done(card: Any, text: Any) -> Any:
            notice = resume.take_notice()
            if notice:
                text = f"{notice}\n{text}" if text else notice
            return base_done(card, text)

        fsapp._TaskCard = type(base.__name__, (base,), {"done": done, "__doc__": base.__doc__})
    else:
        print(f"{LOG_PREFIX} fsapp._TaskCard missing; no context-lost notice")
    mixin = getattr(fsapp, "AgentChatMixin", None)
    common = sys.modules.get(getattr(mixin, "__module__", ""))
    if common is None:
        print(f"{LOG_PREFIX} AgentChatMixin module missing; /new and /continue not wrapped")
        return
    _replace(common, "_reset_conversation", _wrap_reset(resume))
    _replace(common, "_handle_continue_frontend", _wrap_continue(resume))


# -- Telegram ------------------------------------------------------------

# Armed (holding the channel's resume) while tgapp posts a run's closing
# message: the answer or the question. Per asyncio task, so another run's
# receipt posted meanwhile never picks the notice up.
_TELEGRAM_ARMED: contextvars.ContextVar[list[ChannelResume] | None] = contextvars.ContextVar(
    "galley_im_resume_telegram_armed", default=None
)


def _take_armed_notice() -> tuple[ChannelResume | None, str]:
    box = _TELEGRAM_ARMED.get()
    if not box:
        return None, ""
    resume = box.pop()  # only the first message posted may carry it
    return resume, resume.take_notice()


def install_telegram(tgapp: Any, resume: ChannelResume) -> None:
    """Telegram seams, all module globals of tgapp (patch ``0024``) looked
    up at call time:

    - ``reset_conversation`` (the ``/new`` branch, after it stopped the
      running run) and ``handle_frontend_command`` (``/continue``, called
      directly and through ``_call_noting_abort``).
    - ``_send_answer`` / ``_post_ask`` (``_finish_run``'s answer and
      question) arm the notice; ``_reply_markdown`` / ``_reply`` put it on
      the first message either posts, as an italic first line above the
      fold header (the plain-text fallback gets the same line unstyled).
      Report turns go out through the reporter's own Bot API sends, stop
      receipts and errors through other paths: none of them takes it."""
    _replace(tgapp, "reset_conversation", _wrap_reset(resume))
    _replace(tgapp, "handle_frontend_command", _wrap_continue(resume))
    limit = int(getattr(getattr(tgapp, "MessageLimit", None), "MAX_TEXT_LENGTH", 4096))

    def arming(post: Any) -> Any:
        async def armed(*args: Any, **kwargs: Any) -> Any:
            token = _TELEGRAM_ARMED.set([resume])
            try:
                return await post(*args, **kwargs)
            finally:
                _TELEGRAM_ARMED.reset(token)

        return armed

    def reply_markdown_with_notice(reply_markdown: Any) -> Any:
        async def _reply_markdown(target: Any, markdown: str, plain: str, **kwargs: Any) -> Any:
            owner, notice = _take_armed_notice()
            if owner is None or not notice:
                return await reply_markdown(target, markdown, plain, **kwargs)
            head = f"_{tgapp.escape_markdown(notice, version=2)}_"
            try:
                if len(head) + 1 + len(markdown) <= limit and len(notice) + 1 + len(plain) <= limit:
                    return await reply_markdown(
                        target, f"{head}\n{markdown}", f"{notice}\n{plain}", **kwargs
                    )
                # No room left in this message: the notice goes just before it.
                await reply_markdown(target, head, notice)
            except BaseException:
                owner.restore_notice()
                raise
            return await reply_markdown(target, markdown, plain, **kwargs)

        return _reply_markdown

    def reply_with_notice(reply: Any) -> Any:
        async def _reply(target: Any, text: str, **kwargs: Any) -> Any:
            owner, notice = _take_armed_notice()
            if owner is None or not notice:
                return await reply(target, text, **kwargs)
            text = f"{notice}\n{text}"
            if len(text) > limit:
                text = text[: limit - 1].rstrip() + "…"
            try:
                return await reply(target, text, **kwargs)
            except BaseException:
                owner.restore_notice()
                raise

        return _reply

    _replace(tgapp, "_send_answer", arming)
    _replace(tgapp, "_post_ask", arming)
    _replace(tgapp, "_reply_markdown", reply_markdown_with_notice)
    _replace(tgapp, "_reply", reply_with_notice)
