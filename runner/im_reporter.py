"""Proactive completion reporter for the Galley IM Supervisor.

Watches Galley for settled runs whose reported turn was initiated by one
of this process's supervisor identities and, when one settles, injects a
synthetic report turn into the owning GA frontend so the model composes
a short IM report to the bound owner. One ``ImReporter`` per process — a
single poll loop and a single state-file writer — dispatching to a
registry of ``ChannelAdapter`` seams keyed by supervisor id (connection
state, owner lookup, busy check, text rendering, outbound send).
Feishu and Telegram register exactly one channel; multi-context
platforms (Discord: one supervisor id per channel) register many.
Design: docs/devlog/2026-07-03-supervisor-proactive-reporting-design.md

Routing truth is the **message** origin, not the session origin: a
session created from one channel can be continued from another (or from
the GUI), and a report belongs to whoever initiated the reported turn —
the user message sharing the final answer's ``turnIndex``. The session's
creation origin is only the fallback when that message is missing from
the tail or predates the message-origin migration.

Mechanism notes (why polling, not `session watch`): the reporter's truth is
the Galley DB, read through the public CLI (`sessions list` /
`session show`), exactly like `session wait`. Polling is restart-safe by
construction — a run that finishes while this process is down is found on
the next tick — whereas live watches are per-session, runner-lifetime-bound,
and would still need this DB reconciliation as a fallback. At a ~20s
interval the latency is imperceptible for IM push.

Dedup with `session wait`: results the supervisor already delivered inside
a wait window must not be pushed twice. The report turn runs in the same GA
conversation context, so the model itself remembers what it already told
the user; the report prompt asks it to answer ``SKIP_REPORT`` in that case.
The state file only guarantees the reporter never *triggers* twice for the
same message.
"""
from __future__ import annotations

import asyncio
import json
import os
import queue
import re
import subprocess
import threading
import time
import traceback
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

POLL_INTERVAL_SEC = 20.0
REPORT_TURN_TIMEOUT_SEC = 300.0
REPORT_ATTEMPT_LIMIT = 3
CLI_TIMEOUT_SEC = 30.0
SKIP_SENTINEL = "SKIP_REPORT"
STATE_FILE_NAME = "reporter_state.json"
FINAL_TEXT_LIMIT = 2000
SETTLED_DEAD = ("error", "cancelled")
# Galley's workbench-composer ghost-text tag. IM prompts no longer mandate
# it, but a model can imitate it from pre-fix history, and not every
# channel's render path goes through the frontends' tag strippers
# (DiscordChannel renders via _strip_discord_transcript only) — so the
# reporter strips it before any outbound push.
NEXT_SUGGESTION_RE = re.compile(r"<next-suggestion>.*?</next-suggestion>", re.DOTALL)


class ReporterCliError(RuntimeError):
    pass


def resolve_cli_path() -> str | None:
    """Resolve the Galley CLI via the discovery file (public contract)."""
    if os.name == "nt":  # pragma: no cover - Feishu reporter ships macOS-first
        base = os.environ.get("APPDATA")
        if not base:
            return None
        discovery = Path(base) / "galley" / "cli-path"
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
        discovery = Path(base) / "galley" / "cli-path"
    try:
        first_line = discovery.read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        return None
    if first_line and os.access(first_line, os.X_OK):
        return first_line
    return None


def run_cli_json_lines(cli: str, args: list[str]) -> list[dict[str, Any]]:
    """Run a read-only CLI command and parse its NDJSON stdout."""
    proc = subprocess.run(
        [cli, *args],
        capture_output=True,
        text=True,
        timeout=CLI_TIMEOUT_SEC,
    )
    if proc.returncode != 0:
        raise ReporterCliError(
            f"galley {' '.join(args)} failed (exit {proc.returncode}): "
            f"{proc.stdout.strip() or proc.stderr.strip()}"
        )
    items: list[dict[str, Any]] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parsed = json.loads(line)
        if isinstance(parsed, dict):
            items.append(parsed)
    return items


# ── pure decision logic ──────────────────────────────────────────────


def routing_supervisor(
    session: dict[str, Any],
    messages: list[dict[str, Any]],
    final_msg: dict[str, Any] | None,
) -> str | None:
    """Supervisor id the report should route to.

    Prefers the origin of the user message that initiated the reported
    turn (same ``turnIndex`` as the final answer; positional last-user-
    before-final when turn indexes are absent). Falls back to the
    session's creation origin when the initiating message is outside the
    fetched tail, predates message-origin columns, or carries no
    supervisor (GUI-initiated turns keep the session-origin behavior the
    single-channel reporter always had).
    """
    initiator: dict[str, Any] | None = None
    if final_msg is not None:
        final_turn = final_msg.get("turnIndex")
        if final_turn is not None:
            for message in messages:
                if (
                    message.get("role") == "user"
                    and message.get("turnIndex") == final_turn
                ):
                    initiator = message
        if initiator is None:
            for message in messages:
                if message is final_msg:
                    break
                if message.get("role") == "user":
                    initiator = message
    else:
        # Dead-status report with no final output: whoever drove the
        # session last is the natural recipient.
        for message in messages:
            if message.get("role") == "user":
                initiator = message
    origin = (initiator or {}).get("origin") or {}
    supervisor = origin.get("supervisor")
    if supervisor:
        return str(supervisor)
    origin = session.get("origin") or {}
    supervisor = origin.get("supervisor")
    return str(supervisor) if supervisor else None


def latest_final_output(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Last agent message whose finalAnswer landed — the durable signal
    that a run actually finished (mirrors `session wait` semantics, but
    stricter: intermediate step content alone does not count)."""
    latest = None
    for message in messages:
        if message.get("role") != "agent":
            continue
        if str(message.get("finalAnswer") or "").strip():
            latest = message
    return latest


@dataclass
class Report:
    kind: str  # "completed" | "error" | "cancelled"
    session: dict[str, Any]
    message: dict[str, Any] | None


def needs_check(session: dict[str, Any], entry: dict[str, Any]) -> bool:
    """Skip `session show` for sessions with no new activity since the
    last tick — keeps steady-state work bounded as delegations accumulate."""
    return (
        session.get("lastActivityAt") != entry.get("lastSeenActivityAt")
        or session.get("status") != entry.get("lastSeenStatus")
    )


def plan_report(
    session: dict[str, Any],
    messages: list[dict[str, Any]],
    entry: dict[str, Any],
) -> Report | None:
    latest = latest_final_output(messages)
    if latest is not None and latest.get("id") != entry.get("lastReportedMessageId"):
        return Report(kind="completed", session=session, message=latest)
    status = session.get("status")
    if status in SETTLED_DEAD and entry.get("reportedDeadStatus") != status:
        return Report(kind=str(status), session=session, message=latest)
    return None


def is_skip_reply(text: str) -> bool:
    return text.strip().strip("`\"'.").upper() == SKIP_SENTINEL


def build_report_prompt(report: Report) -> str:
    session = report.session
    title = str(session.get("title") or session.get("id") or "").strip()
    session_id = session.get("id", "")
    if report.kind == "completed":
        happened = "has finished a run"
    elif report.kind == "cancelled":
        happened = "has been cancelled"
    else:
        happened = f"has stopped with status: {report.kind}"
    final_text = ""
    if report.message is not None:
        final_text = str(report.message.get("finalAnswer") or "").strip()
    if len(final_text) > FINAL_TEXT_LIMIT:
        final_text = final_text[:FINAL_TEXT_LIMIT] + "\n…(truncated)"
    final_block = final_text or "(no final output was recorded)"
    return (
        "## Galley Delegated Session Report Request\n\n"
        "This is an automated request from Galley, not a user message. "
        f'Galley session "{title}" (id {session_id}), which you started '
        f"earlier over the Galley CLI, {happened}.\n\n"
        f"Final output (may be truncated):\n{final_block}\n\n"
        "First decide: if you already conveyed this same result to the user "
        "earlier in this conversation (for example it arrived inside a "
        "`session wait` and you summarized it), reply with exactly "
        f"{SKIP_SENTINEL} and nothing else.\n\n"
        "Otherwise reply with a short report to send to the user: lead with "
        "the outcome in 1-3 sentences, name the task, and end with the next "
        "decision point if there is one. They read this on mobile. Write in "
        "the language the user has been using. Reply with the report text "
        "only — it is sent to them verbatim as an IM message."
    )


# ── state file ───────────────────────────────────────────────────────


class ReporterState:
    """Per-session reporting bookkeeping, persisted atomically.

    ``is_new`` distinguishes feature activation from a plain restart: on the
    very first run everything already settled is baselined silently, so
    enabling the reporter never floods the owner with historical results.
    """

    def __init__(self, path: Path, data: dict[str, Any], is_new: bool) -> None:
        self.path = path
        self.data = data
        self.is_new = is_new

    @classmethod
    def load(cls, path: Path) -> ReporterState:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("sessions"), dict):
                return cls(path, raw, is_new=False)
        except (OSError, ValueError):
            pass
        return cls(path, {"sessions": {}}, is_new=not path.exists())

    def entry(self, session_id: str) -> dict[str, Any]:
        entry: dict[str, Any] = self.data["sessions"].setdefault(session_id, {})
        return entry

    def prune(self, keep_ids: set[str]) -> bool:
        """Drop entries for sessions no longer listed at all (deleted).
        The dispatcher now tracks every inspected session, so without
        pruning the file would grow with the DB's whole history."""
        sessions = self.data["sessions"]
        stale = [sid for sid in sessions if sid not in keep_ids]
        for sid in stale:
            del sessions[sid]
        return bool(stale)

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        tmp.replace(self.path)


def mark_reported(entry: dict[str, Any], report: Report) -> None:
    if report.message is not None:
        entry["lastReportedMessageId"] = report.message.get("id")
    if report.kind in SETTLED_DEAD:
        entry["reportedDeadStatus"] = report.kind
    entry.pop("reportAttempts", None)


def mark_seen(entry: dict[str, Any], session: dict[str, Any]) -> None:
    entry["lastSeenActivityAt"] = session.get("lastActivityAt")
    entry["lastSeenStatus"] = session.get("status")


# ── channel adapters ─────────────────────────────────────────────────


def _single_owner(public_access: Any, allowed: Any) -> str | None:
    """The bound owner. Reporting requires an unambiguous recipient:
    public access or an unbound channel means no proactive push."""
    if public_access:
        return None
    users = allowed or set()
    if len(users) != 1:
        return None
    return str(next(iter(users)))


class ChannelAdapter:
    """Channel-specific seams the reporter core needs."""

    def connected(self) -> bool:
        raise NotImplementedError

    def owner_id(self) -> str | None:
        raise NotImplementedError

    def busy(self) -> bool:
        raise NotImplementedError

    def agent(self) -> Any:
        raise NotImplementedError

    def begin_report_turn(self) -> None:
        return None

    def end_report_turn(self) -> None:
        return None

    def render(self, raw: str) -> str:
        return raw

    def send(self, owner: str, text: str, raw: str) -> None:
        """Deliver the report. MUST raise on failure — a swallowed
        exception gets the report marked delivered when it never left
        the machine. Async platforms bridge here with
        ``asyncio.run_coroutine_threadsafe(...).result(timeout)`` so the
        reporter thread gets a real ACK (or a real exception)."""
        raise NotImplementedError


class FeishuChannel(ChannelAdapter):
    def __init__(self, fsapp: Any) -> None:
        self.fsapp = fsapp

    def connected(self) -> bool:
        return getattr(self.fsapp, "client", None) is not None

    def owner_id(self) -> str | None:
        return _single_owner(
            getattr(self.fsapp, "PUBLIC_ACCESS", True),
            getattr(self.fsapp, "ALLOWED_USERS", None),
        )

    def busy(self) -> bool:
        return bool(self.fsapp.get_app().user_tasks)

    def agent(self) -> Any:
        return self.fsapp.get_app().agent

    def begin_report_turn(self) -> None:
        # Card isolation flag consumed by managed-ga patch 0013.
        self.fsapp._GALLEY_REPORT_TURN_ACTIVE = True

    def end_report_turn(self) -> None:
        self.fsapp._GALLEY_REPORT_TURN_ACTIVE = False

    def render(self, raw: str) -> str:
        display = getattr(self.fsapp, "_display_text", lambda t: t)(raw)
        return str(display or "")

    def send(self, owner: str, text: str, raw: str) -> None:
        self.fsapp.send_message(owner, text)
        send_files = getattr(self.fsapp, "_send_generated_files", None)
        if callable(send_files):
            send_files(owner, raw)


TELEGRAM_TEXT_LIMIT = 4000


def _telegram_send_text(token: str, chat_id: str, text: str) -> None:
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()


class TelegramChannel(ChannelAdapter):
    """python-telegram-bot runs its own event loop inside ``tgapp.main()``;
    the reporter thread sends through the plain Bot HTTP API instead of
    scheduling onto that loop — same token, no loop coordination. Reports
    are text-only: generated files stay in the Galley session."""

    def __init__(self, tgapp: Any) -> None:
        self.tgapp = tgapp

    def connected(self) -> bool:
        return bool(getattr(self.tgapp, "_galley_connected_once", False))

    def owner_id(self) -> str | None:
        return _single_owner(
            getattr(self.tgapp, "PUBLIC_ACCESS", True),
            getattr(self.tgapp, "ALLOWED", None),
        )

    def busy(self) -> bool:
        return bool(getattr(self.tgapp.agent, "is_running", False))

    def agent(self) -> Any:
        return self.tgapp.agent

    def render(self, raw: str) -> str:
        if not (raw or "").strip():
            return ""
        cleaned = self.tgapp.clean_reply(raw)
        render_markers = getattr(self.tgapp, "_render_file_markers", None)
        if callable(render_markers):
            return str(render_markers(cleaned) or "")
        return str(cleaned or "")

    def send(self, owner: str, text: str, raw: str) -> None:
        token = str(getattr(self.tgapp, "BOT_TOKEN", "") or "")
        if not token:
            raise ReporterCliError("Telegram bot token unavailable for reporter send")
        split = getattr(self.tgapp, "split_text", None)
        segments = split(text, TELEGRAM_TEXT_LIMIT) if callable(split) else [text]
        for segment in segments:
            _telegram_send_text(token, owner, segment)


DISCORD_SEND_TIMEOUT_SEC = 30.0


class DiscordChannel(ChannelAdapter):
    """One activated Discord channel (``ch:<channel_id>``).

    Discord is the multi-context platform: each channel owns its own GA
    agent, its own history and its own supervisor id, so one adapter is
    registered per channel rather than one per process. The report goes
    back to the channel that initiated the work — ``owner`` is only the
    binding gate (a bound owner must exist for any proactive push), not
    the destination.
    """

    def __init__(self, dcapp: Any, chat_id: str, agent: Any = None) -> None:
        self.dcapp = dcapp
        self.chat_id = chat_id
        self._agent = agent

    def _app(self) -> Any:
        return self.dcapp.get_app()

    def connected(self) -> bool:
        return bool(getattr(self.dcapp, "_galley_connected_once", False)) and (
            self._app() is not None
        )

    def owner_id(self) -> str | None:
        # dcapp keeps no PUBLIC_ACCESS constant (managed mode drops "*"
        # from the allow-list outright), so ask its own predicate.
        allowed = getattr(self.dcapp, "ALLOWED", None)
        checker = getattr(self.dcapp, "public_access", None)
        public = bool(checker(allowed)) if callable(checker) else False
        return _single_owner(public, allowed)

    def busy(self) -> bool:
        app = self._app()
        if app is not None and app.user_tasks.get(self.chat_id):
            return True
        return bool(getattr(self._agent, "is_running", False))

    def agent(self) -> Any:
        """The channel's agent — normally handed over by dcapp's agent
        hook at creation time. Channels restored at startup have no agent
        yet, so fall back to dcapp's per-channel agent accessor (coupling
        point: same call path an inbound message takes)."""
        if self._agent is not None:
            return self._agent
        app = self._app()
        if app is None:
            raise ReporterCliError("Discord app is not running for reporter turn")
        self._agent = app._get_agent(self.chat_id).agent
        return self._agent

    def render(self, raw: str) -> str:
        if not (raw or "").strip():
            return ""
        strip = getattr(self.dcapp, "_strip_discord_transcript", None)
        if callable(strip):
            return str(strip(raw) or "")
        clean = getattr(self.dcapp, "clean_reply", None)
        return str((clean(raw) if callable(clean) else raw) or "")

    def send(self, owner: str, text: str, raw: str) -> None:
        app = self._app()
        loop = getattr(app, "loop", None) if app is not None else None
        if app is None or loop is None:
            raise ReporterCliError("Discord app has no running loop for reporter send")
        # deliver_text raises on resolve/send failure and splits internally;
        # the threadsafe future is what turns that into a real ACK here.
        future = asyncio.run_coroutine_threadsafe(
            app.deliver_text(self.chat_id, text), loop
        )
        future.result(DISCORD_SEND_TIMEOUT_SEC)


# ── reporter core ────────────────────────────────────────────────────


class ImReporter:
    """Process-wide report dispatcher.

    One instance per frontend process: one poll loop, one state file
    writer, a registry of channels keyed by supervisor id. Single-
    channel platforms construct it with a one-entry registry; Discord
    registers/unregisters a channel per activated Discord channel (and
    re-registers the persisted active set at startup, so routing is
    restored before any message arrives).
    """

    def __init__(
        self,
        channels: dict[str, ChannelAdapter],
        state_path: Path,
        poll_interval: float = POLL_INTERVAL_SEC,
        owned_prefixes: tuple[str, ...] = (),
    ) -> None:
        self._channels = dict(channels)
        self._channels_lock = threading.Lock()
        self.state = ReporterState.load(state_path)
        self.poll_interval = poll_interval
        self.cli: str | None = None
        # Supervisor-id prefixes this PROCESS owns beyond the currently
        # registered channels. A report routed to an owned-but-
        # unregistered id (a Discord channel deactivated by a restart)
        # is HELD — entry untouched, retried next tick — instead of
        # being marked seen as foreign, so re-activating the channel
        # still delivers results that settled in between.
        self.owned_prefixes = owned_prefixes

    # -- channel registry --

    def register_channel(self, supervisor_id: str, channel: ChannelAdapter) -> None:
        with self._channels_lock:
            self._channels[supervisor_id] = channel

    def unregister_channel(self, supervisor_id: str) -> None:
        with self._channels_lock:
            self._channels.pop(supervisor_id, None)

    def channels(self) -> dict[str, ChannelAdapter]:
        with self._channels_lock:
            return dict(self._channels)

    def owner_open_id(self) -> str | None:
        """Owner of the sole channel — single-channel platforms only."""
        channels = self.channels()
        if len(channels) != 1:
            return None
        return next(iter(channels.values())).owner_id()

    # -- one poll iteration --

    def tick(self) -> list[Report]:
        channels = self.channels()
        if not channels:
            return []
        if self.cli is None:
            self.cli = resolve_cli_path()
        if self.cli is None:
            return []
        cli = self.cli
        ready: dict[str, tuple[ChannelAdapter, str]] = {}
        for supervisor_id, channel in channels.items():
            if not channel.connected():
                continue
            owner = channel.owner_id()
            if owner is None:
                continue
            ready[supervisor_id] = (channel, owner)
        if not ready:
            return []
        sessions = run_cli_json_lines(cli, ["sessions", "list", "--runtime", "all"])
        listed_ids = {str(s.get("id")) for s in sessions if s.get("id")}
        candidates = [s for s in sessions if s.get("status") != "archived"]
        if self.state.is_new:
            self._baseline(cli, candidates)
            return []
        delivered: list[Report] = []
        dirty = False
        for session in candidates:
            session_id = str(session.get("id") or "")
            if not session_id:
                continue
            entry = self.state.entry(session_id)
            if not needs_check(session, entry):
                continue
            messages = run_cli_json_lines(
                cli, ["session", "show", session_id, "--tail", "30"]
            )
            report = plan_report(session, messages, entry)
            if report is None:
                mark_seen(entry, session)
                dirty = True
                continue
            routed_to = routing_supervisor(session, messages, report.message)
            is_ours = routed_to is not None and (
                routed_to in channels
                or (self.owned_prefixes and routed_to.startswith(self.owned_prefixes))
            )
            if not is_ours:
                # Not this process's report: the owning frontend's own
                # reporter handles it. Mark seen so steady state stays
                # cheap; never mark reported for someone else.
                mark_seen(entry, session)
                dirty = True
                continue
            target = ready.get(routed_to) if routed_to is not None else None
            if target is None:
                # Ours, but not deliverable right now: a registered
                # channel that is disconnected/unbound, or an owned-
                # prefix channel that is not activated (Discord after a
                # restart). Leave the entry untouched so the report is
                # held until the channel comes back or is re-activated.
                continue
            channel, owner = target
            outcome = self._deliver(channel, report, owner)
            if outcome == "busy":
                # A user task is mid-flight on that channel's agent;
                # leave the entry untouched so the next tick retries.
                # Other channels' reports keep flowing.
                continue
            if outcome == "delivered":
                mark_reported(entry, report)
                delivered.append(report)
                mark_seen(entry, session)
            elif outcome == "gave_up":
                mark_reported(entry, report)
                mark_seen(entry, session)
            else:
                # "retry" — count the attempt but do NOT mark_seen: the next
                # tick must re-check this session even with no new activity.
                # Bounded by REPORT_ATTEMPT_LIMIT via the gave_up branch.
                entry["reportAttempts"] = int(entry.get("reportAttempts") or 0) + 1
            dirty = True
        if self.state.prune(listed_ids):
            dirty = True
        if dirty:
            self.state.save()
        return delivered

    def _baseline(self, cli: str, candidates: list[dict[str, Any]]) -> None:
        for session in candidates:
            session_id = str(session.get("id") or "")
            if not session_id:
                continue
            entry = self.state.entry(session_id)
            messages = run_cli_json_lines(
                cli, ["session", "show", session_id, "--tail", "30"]
            )
            report = plan_report(session, messages, entry)
            if report is not None:
                mark_reported(entry, report)
            mark_seen(entry, session)
        self.state.is_new = False
        self.state.save()

    # -- synthetic report turn --

    def _deliver(self, channel: ChannelAdapter, report: Report, owner: str) -> str:
        """Returns "delivered" | "busy" | "retry" | "gave_up"."""
        if channel.busy():
            return "busy"
        entry = self.state.entry(str(report.session.get("id")))
        if int(entry.get("reportAttempts") or 0) >= REPORT_ATTEMPT_LIMIT:
            print(
                f"[galley-im-reporter] giving up on session "
                f"{report.session.get('id')} after {REPORT_ATTEMPT_LIMIT} attempts"
            )
            return "gave_up"
        agent = channel.agent()
        prompt = build_report_prompt(report)
        raw: str | None = None
        channel.begin_report_turn()
        try:
            dq = agent.put_task(prompt, source="galley_reporter")
            deadline = time.time() + REPORT_TURN_TIMEOUT_SEC
            while time.time() < deadline:
                try:
                    item = dq.get(True, 1)
                except queue.Empty:
                    continue
                if item and "done" in item:
                    raw = str(item.get("done") or "")
                    break
        finally:
            channel.end_report_turn()
        if raw is None:
            print(
                f"[galley-im-reporter] report turn timed out for session "
                f"{report.session.get('id')}"
            )
            return "retry"
        # Render + send failures count as attempts (bounded by
        # REPORT_ATTEMPT_LIMIT) instead of escaping to run_forever's
        # catch-all — an uncounted crash here re-burned the synthetic
        # report turn on every tick, forever.
        try:
            text = NEXT_SUGGESTION_RE.sub("", channel.render(raw)).strip()
            if not text or is_skip_reply(text):
                return "delivered"
            channel.send(owner, text, raw)
        except Exception:
            traceback.print_exc()
            return "retry"
        return "delivered"

    def run_forever(self) -> None:
        while True:
            try:
                self.tick()
            except Exception:
                traceback.print_exc()
            time.sleep(self.poll_interval)


class FeishuReporter(ImReporter):
    def __init__(
        self,
        fsapp: Any,
        supervisor_id: str,
        state_path: Path,
        poll_interval: float = POLL_INTERVAL_SEC,
    ) -> None:
        super().__init__(
            {supervisor_id: FeishuChannel(fsapp)}, state_path, poll_interval
        )
        self.fsapp = fsapp


class TelegramReporter(ImReporter):
    def __init__(
        self,
        tgapp: Any,
        supervisor_id: str,
        state_path: Path,
        poll_interval: float = POLL_INTERVAL_SEC,
    ) -> None:
        super().__init__(
            {supervisor_id: TelegramChannel(tgapp)}, state_path, poll_interval
        )
        self.tgapp = tgapp


class DiscordReporter(ImReporter):
    """Discord dispatcher: a channel registry that grows and shrinks with
    the activated channels, keyed by ``<base id>/ch:<channel_id>``.

    The launcher drives it through ``attach_channel`` /
    ``detach_channel`` from dcapp's agent hooks, so it never has to know
    how a supervisor id is spelled.
    """

    def __init__(
        self,
        dcapp: Any,
        supervisor_id: str,
        state_path: Path,
        poll_interval: float = POLL_INTERVAL_SEC,
    ) -> None:
        # The base-id prefix claims every ch:<id> for this process, so
        # reports for channels deactivated by a restart are held until
        # the owner re-activates them instead of dropped as foreign.
        super().__init__(
            {},
            state_path,
            poll_interval,
            owned_prefixes=(f"{supervisor_id}/",),
        )
        self.dcapp = dcapp
        self.supervisor_id = supervisor_id

    def supervisor_id_for(self, chat_id: str) -> str:
        return f"{self.supervisor_id}/{chat_id}"

    def attach_channel(self, chat_id: str, agent: Any = None) -> str:
        supervisor_id = self.supervisor_id_for(chat_id)
        self.register_channel(supervisor_id, DiscordChannel(self.dcapp, chat_id, agent))
        return supervisor_id

    def detach_channel(self, chat_id: str) -> None:
        self.unregister_channel(self.supervisor_id_for(chat_id))

    def restore_active_channels(self) -> list[str]:
        """Re-register the already-active channels so routing is restored
        at process start instead of waiting for each channel's next
        message (a report that landed while the process was down would
        otherwise have nowhere to go). No-op before dcapp's app exists."""
        app = self.dcapp.get_app()
        if app is None:
            return []
        chat_ids = [str(chat_id) for chat_id in (app.active_channel_ids() or [])]
        for chat_id in chat_ids:
            self.attach_channel(chat_id)
        return chat_ids


def _start_reporter(reporter: ImReporter) -> ImReporter:
    threading.Thread(
        target=reporter.run_forever, name="galley-im-reporter", daemon=True
    ).start()
    return reporter


def start_feishu_reporter(fsapp: Any, state_dir: Path) -> FeishuReporter | None:
    supervisor_id = (os.environ.get("GALLEY_SUPERVISOR_ID") or "").strip()
    if not supervisor_id:
        print("[galley-im-reporter] disabled: GALLEY_SUPERVISOR_ID not set")
        return None
    reporter = FeishuReporter(fsapp, supervisor_id, Path(state_dir) / STATE_FILE_NAME)
    _start_reporter(reporter)
    return reporter


def start_telegram_reporter(tgapp: Any, state_dir: Path) -> TelegramReporter | None:
    supervisor_id = (os.environ.get("GALLEY_SUPERVISOR_ID") or "").strip()
    if not supervisor_id:
        print("[galley-im-reporter] disabled: GALLEY_SUPERVISOR_ID not set")
        return None
    reporter = TelegramReporter(tgapp, supervisor_id, Path(state_dir) / STATE_FILE_NAME)
    _start_reporter(reporter)
    return reporter


def start_discord_reporter(dcapp: Any, state_dir: Path) -> DiscordReporter | None:
    """``GALLEY_SUPERVISOR_ID`` is the process-level base id
    (``galley-im/discord``); every channel derives its own id from it."""
    supervisor_id = (os.environ.get("GALLEY_SUPERVISOR_ID") or "").strip()
    if not supervisor_id:
        print("[galley-im-reporter] disabled: GALLEY_SUPERVISOR_ID not set")
        return None
    reporter = DiscordReporter(dcapp, supervisor_id, Path(state_dir) / STATE_FILE_NAME)
    restored = reporter.restore_active_channels()
    if restored:
        print(f"[galley-im-reporter] restored {len(restored)} Discord channel(s)")
    _start_reporter(reporter)
    return reporter
