"""Proactive completion reporter for the Galley IM Supervisor.

Watches Galley for sessions this channel delegated (``origin.supervisor``
equals this process's ``GALLEY_SUPERVISOR_ID``) and, when one settles,
injects a synthetic report turn into the running GA frontend so the model
composes a short IM report to the bound owner. The reporter core is
channel-agnostic; per-platform seams (connection state, owner lookup,
busy check, text rendering, outbound send) live in a ``ChannelAdapter``.
Feishu and Telegram are wired today. Design:
docs/devlog/2026-07-03-supervisor-proactive-reporting-design.md

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

import json
import os
import queue
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


def delegated_sessions(
    sessions: list[dict[str, Any]], supervisor_id: str
) -> list[dict[str, Any]]:
    out = []
    for session in sessions:
        origin = session.get("origin") or {}
        if origin.get("supervisor") != supervisor_id:
            continue
        if session.get("status") == "archived":
            continue
        out.append(session)
    return out


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


# ── reporter core ────────────────────────────────────────────────────


class ImReporter:
    def __init__(
        self,
        channel: ChannelAdapter,
        supervisor_id: str,
        state_path: Path,
        poll_interval: float = POLL_INTERVAL_SEC,
    ) -> None:
        self.channel = channel
        self.supervisor_id = supervisor_id
        self.state = ReporterState.load(state_path)
        self.poll_interval = poll_interval
        self.cli: str | None = None

    # -- channel readiness --

    def owner_open_id(self) -> str | None:
        return self.channel.owner_id()

    def _ready(self) -> tuple[str, str] | None:
        """(cli_path, owner_id) once the channel can report, else None."""
        if not self.channel.connected():
            return None
        if self.cli is None:
            self.cli = resolve_cli_path()
        if self.cli is None:
            return None
        owner = self.owner_open_id()
        if owner is None:
            return None
        return self.cli, owner

    # -- one poll iteration --

    def tick(self) -> list[Report]:
        ready = self._ready()
        if ready is None:
            return []
        cli, owner = ready
        sessions = run_cli_json_lines(cli, ["sessions", "list", "--runtime", "all"])
        mine = delegated_sessions(sessions, self.supervisor_id)
        if self.state.is_new:
            self._baseline(cli, mine)
            return []
        delivered: list[Report] = []
        dirty = False
        for session in mine:
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
            outcome = self._deliver(report, owner)
            if outcome == "busy":
                # A user task is mid-flight; leave the entry untouched so the
                # next tick retries. Stop the whole pass — the channel stays
                # busy for all pending reports alike.
                break
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
        if dirty:
            self.state.save()
        return delivered

    def _baseline(self, cli: str, mine: list[dict[str, Any]]) -> None:
        for session in mine:
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

    def _deliver(self, report: Report, owner: str) -> str:
        """Returns "delivered" | "busy" | "retry" | "gave_up"."""
        if self.channel.busy():
            return "busy"
        entry = self.state.entry(str(report.session.get("id")))
        if int(entry.get("reportAttempts") or 0) >= REPORT_ATTEMPT_LIMIT:
            print(
                f"[galley-im-reporter] giving up on session "
                f"{report.session.get('id')} after {REPORT_ATTEMPT_LIMIT} attempts"
            )
            return "gave_up"
        agent = self.channel.agent()
        prompt = build_report_prompt(report)
        raw: str | None = None
        self.channel.begin_report_turn()
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
            self.channel.end_report_turn()
        if raw is None:
            print(
                f"[galley-im-reporter] report turn timed out for session "
                f"{report.session.get('id')}"
            )
            return "retry"
        text = self.channel.render(raw).strip()
        if not text or is_skip_reply(text):
            return "delivered"
        self.channel.send(owner, text, raw)
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
        super().__init__(FeishuChannel(fsapp), supervisor_id, state_path, poll_interval)
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
            TelegramChannel(tgapp), supervisor_id, state_path, poll_interval
        )
        self.tgapp = tgapp


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
