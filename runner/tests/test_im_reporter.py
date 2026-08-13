"""Tests for the proactive completion reporter (runner/im_reporter.py).

Pure decision logic is tested directly; the tick/deliver flow runs against
stub fsapp / tgapp modules and a stubbed CLI, mirroring the stub-lark
approach used in test_managed_feishu_fsapp.py.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import queue
import threading
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from runner import im_reporter
from runner.im_reporter import (
    FeishuReporter,
    ImReporter,
    Report,
    ReporterState,
    TelegramReporter,
    build_report_prompt,
    is_skip_reply,
    latest_final_output,
    needs_check,
    plan_report,
    routing_supervisor,
)

SUP = "galley-im/feishu"


def _session(
    sid: str = "s1",
    *,
    status: str = "idle",
    supervisor: str | None = SUP,
    last_activity: str = "2026-07-03T10:00:00Z",
) -> dict[str, Any]:
    origin = {"via": "supervisor", "supervisor": supervisor} if supervisor else None
    return {
        "id": sid,
        "title": f"Task {sid}",
        "status": status,
        "lastActivityAt": last_activity,
        "origin": origin,
    }


def _agent_msg(
    mid: str, final: str | None, *, turn: int | None = None
) -> dict[str, Any]:
    msg: dict[str, Any] = {"id": mid, "role": "agent", "content": "step content"}
    if final is not None:
        msg["finalAnswer"] = final
    if turn is not None:
        msg["turnIndex"] = turn
    return msg


def _user_msg(
    mid: str, *, supervisor: str | None = None, turn: int | None = None
) -> dict[str, Any]:
    msg: dict[str, Any] = {"id": mid, "role": "user", "content": "do it"}
    if turn is not None:
        msg["turnIndex"] = turn
    if supervisor is not None:
        msg["origin"] = {"via": "supervisor", "supervisor": supervisor}
    return msg


# ── pure logic ───────────────────────────────────────────────────────


def test_routing_supervisor_prefers_turn_matched_user_origin() -> None:
    final = _agent_msg("a2", "done", turn=2)
    messages = [
        _user_msg("u1", supervisor="galley-im/discord/ch:111", turn=1),
        _agent_msg("a1", "first", turn=1),
        _user_msg("u2", supervisor="galley-im/discord/ch:222", turn=2),
        final,
    ]
    # The session was created from channel 111, but the reported turn
    # came from channel 222 — the message origin wins.
    session = _session(supervisor="galley-im/discord/ch:111")
    assert routing_supervisor(session, messages, final) == "galley-im/discord/ch:222"


def test_routing_supervisor_positional_without_turn_index() -> None:
    final = _agent_msg("a1", "done")
    messages = [
        _user_msg("u1", supervisor=SUP),
        final,
        _user_msg("u2", supervisor="galley-im/telegram"),
    ]
    # No turn indexes: the last user message BEFORE the final counts.
    assert routing_supervisor(_session(supervisor=None), messages, final) == SUP


def test_routing_supervisor_falls_back_to_session_origin() -> None:
    final = _agent_msg("a1", "done", turn=5)
    # Initiating user message truncated out of the fetched tail.
    assert routing_supervisor(_session(), [final], final) == SUP
    # GUI-initiated turn (no message origin) keeps session-origin routing.
    messages = [_user_msg("u1", turn=5), final]
    assert routing_supervisor(_session(), messages, final) == SUP
    assert routing_supervisor(_session(supervisor=None), messages, final) is None


def test_routing_supervisor_dead_status_uses_last_user() -> None:
    messages = [
        _user_msg("u1", supervisor="galley-im/feishu"),
        _user_msg("u2", supervisor="galley-im/telegram"),
    ]
    assert (
        routing_supervisor(_session(supervisor=None), messages, None)
        == "galley-im/telegram"
    )


def test_latest_final_output_requires_final_answer() -> None:
    messages = [
        {"id": "u1", "role": "user", "content": "do it"},
        _agent_msg("a1", None),
        _agent_msg("a2", "first result"),
        _agent_msg("a3", "   "),
        {"id": "sys", "role": "system", "content": "note", "finalAnswer": "x"},
    ]
    latest = latest_final_output(messages)
    assert latest is not None and latest["id"] == "a2"
    assert latest_final_output([_agent_msg("a1", None)]) is None


def test_plan_report_completed_then_dedup() -> None:
    session = _session()
    messages = [_agent_msg("a1", "done!")]
    entry: dict[str, Any] = {}
    report = plan_report(session, messages, entry)
    assert report is not None and report.kind == "completed"
    entry["lastReportedMessageId"] = "a1"
    assert plan_report(session, messages, entry) is None
    # A later run in the same session reports again.
    messages.append(_agent_msg("a2", "follow-up done"))
    again = plan_report(session, messages, entry)
    assert again is not None and again.message is not None
    assert again.message["id"] == "a2"


def test_plan_report_dead_status_reports_once() -> None:
    session = _session(status="error")
    entry: dict[str, Any] = {}
    report = plan_report(session, [], entry)
    assert report is not None and report.kind == "error"
    entry["reportedDeadStatus"] = "error"
    assert plan_report(session, [], entry) is None


def test_needs_check_tracks_activity_and_status() -> None:
    session = _session()
    entry: dict[str, Any] = {}
    assert needs_check(session, entry)
    entry["lastSeenActivityAt"] = session["lastActivityAt"]
    entry["lastSeenStatus"] = session["status"]
    assert not needs_check(session, entry)
    assert needs_check(_session(status="error"), entry)


def test_is_skip_reply_variants() -> None:
    assert is_skip_reply("SKIP_REPORT")
    assert is_skip_reply("  skip_report  ")
    assert is_skip_reply('"SKIP_REPORT"')
    assert not is_skip_reply("SKIP_REPORT: because ...")
    assert not is_skip_reply("done")


def test_build_report_prompt_truncates_and_labels() -> None:
    long_final = "x" * (im_reporter.FINAL_TEXT_LIMIT + 100)
    report = Report(
        kind="completed", session=_session(), message=_agent_msg("a1", long_final)
    )
    prompt = build_report_prompt(report)
    assert "SKIP_REPORT" in prompt
    assert "…(truncated)" in prompt
    assert 'Galley session "Task s1"' in prompt

    dead = Report(kind="error", session=_session(status="error"), message=None)
    dead_prompt = build_report_prompt(dead)
    assert "stopped with status: error" in dead_prompt
    assert "(no final output was recorded)" in dead_prompt


def test_state_roundtrip_and_new_flag(tmp_path: Path) -> None:
    path = tmp_path / "reporter_state.json"
    state = ReporterState.load(path)
    assert state.is_new
    state.entry("s1")["lastReportedMessageId"] = "a1"
    state.save()
    reloaded = ReporterState.load(path)
    assert not reloaded.is_new
    assert reloaded.entry("s1")["lastReportedMessageId"] == "a1"
    # Corrupt file → safe fallback, not new (file existed).
    path.write_text("{broken", encoding="utf-8")
    corrupt = ReporterState.load(path)
    assert corrupt.data == {"sessions": {}}
    assert not corrupt.is_new


# ── tick/deliver integration against stub fsapp + stub CLI ──────────


class _StubAgent:
    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []
        self.is_running = False

    def put_task(self, prompt: str, source: str = "") -> queue.Queue[dict[str, Any]]:
        assert source == "galley_reporter"
        self.prompts.append(prompt)
        dq: queue.Queue[dict[str, Any]] = queue.Queue()
        dq.put({"done": self.replies.pop(0) if self.replies else ""})
        return dq


def _stub_fsapp(replies: list[str]) -> Any:
    agent = _StubAgent(replies)
    app = types.SimpleNamespace(user_tasks={}, agent=agent)
    sent: list[tuple[str, str]] = []
    fsapp = types.SimpleNamespace(
        PUBLIC_ACCESS=False,
        ALLOWED_USERS={"ou_owner"},
        client=object(),
        get_app=lambda: app,
        send_message=lambda rid, text, **kw: sent.append((rid, text)),
        _display_text=lambda t: t,
        _GALLEY_REPORT_TURN_ACTIVE=False,
    )
    fsapp._sent = sent
    fsapp._app = app
    fsapp._agent = agent
    return fsapp


def _make_reporter(
    monkeypatch: Any,
    tmp_path: Path,
    fsapp: Any,
    cli_payloads: dict[str, list[dict[str, Any]]],
) -> FeishuReporter:
    reporter = FeishuReporter(fsapp, SUP, tmp_path / "reporter_state.json")
    reporter.cli = "/stub/galley"

    def fake_run(cli: str, args: list[str]) -> list[dict[str, Any]]:
        key = " ".join(args[:2])
        if key == "sessions list":
            return cli_payloads["sessions"]
        if key == "session show":
            return cli_payloads.get(f"show {args[2]}", [])
        raise AssertionError(f"unexpected CLI call: {args}")

    monkeypatch.setattr(im_reporter, "run_cli_json_lines", fake_run)
    return reporter


def test_first_run_baselines_without_reporting(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _stub_fsapp(["should not be used"])
    payloads = {
        "sessions": [_session("old")],
        "show old": [_agent_msg("a1", "historic result")],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    assert reporter.state.is_new
    assert reporter.tick() == []
    assert fsapp._sent == []
    assert fsapp._agent.prompts == []
    # Baseline persisted: the historic result never reports, but a new run does.
    assert not reporter.state.is_new
    payloads["sessions"] = [_session("old", last_activity="2026-07-03T11:00:00Z")]
    payloads["show old"] = [
        _agent_msg("a1", "historic result"),
        _agent_msg("a2", "fresh result"),
    ]
    fsapp._agent.replies = ["任务完成:结果是 X。要继续吗?"]
    delivered = reporter.tick()
    assert [r.message["id"] for r in delivered if r.message] == ["a2"]
    assert fsapp._sent == [("ou_owner", "任务完成:结果是 X。要继续吗?")]


def test_tick_reports_dedups_and_persists(monkeypatch: Any, tmp_path: Path) -> None:
    fsapp = _stub_fsapp(["report text"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1")],
        "show s1": [_agent_msg("a1", "done!")],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    assert len(reporter.tick()) == 1
    assert fsapp._sent == [("ou_owner", "report text")]
    assert not fsapp._GALLEY_REPORT_TURN_ACTIVE
    # Same state on the next tick: no new activity, nothing re-reported.
    assert reporter.tick() == []
    assert len(fsapp._sent) == 1
    # Restart from disk: still deduped.
    restarted = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    assert restarted.tick() == []
    assert len(fsapp._sent) == 1


def test_skip_reply_marks_reported_without_sending(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _stub_fsapp(["SKIP_REPORT"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1")],
        "show s1": [_agent_msg("a1", "already delivered via wait")],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    delivered = reporter.tick()
    assert len(delivered) == 1  # handled, counted as delivered
    assert fsapp._sent == []
    assert reporter.tick() == []


def test_busy_channel_defers_without_consuming_report(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _stub_fsapp(["report text"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1")],
        "show s1": [_agent_msg("a1", "done!")],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    fsapp._app.user_tasks["chat"] = {"running": True}
    assert reporter.tick() == []
    assert fsapp._sent == []
    fsapp._app.user_tasks.clear()
    assert len(reporter.tick()) == 1
    assert fsapp._sent == [("ou_owner", "report text")]


def test_reporter_requires_single_bound_owner(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _stub_fsapp([])
    fsapp.PUBLIC_ACCESS = True
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, {"sessions": []})
    assert reporter.owner_open_id() is None
    assert reporter.tick() == []
    fsapp.PUBLIC_ACCESS = False
    fsapp.ALLOWED_USERS = set()
    assert reporter.owner_open_id() is None
    fsapp.ALLOWED_USERS = {"ou_a", "ou_b"}
    assert reporter.owner_open_id() is None
    fsapp.ALLOWED_USERS = {"ou_owner"}
    assert reporter.owner_open_id() == "ou_owner"


def test_start_feishu_reporter_disabled_without_supervisor_id(
    monkeypatch: Any, tmp_path: Path
) -> None:
    monkeypatch.delenv("GALLEY_SUPERVISOR_ID", raising=False)
    assert im_reporter.start_feishu_reporter(_stub_fsapp([]), tmp_path) is None


# ── Telegram channel adapter ─────────────────────────────────────────


def _stub_tgapp(replies: list[str]) -> Any:
    agent = _StubAgent(replies)
    tgapp = types.SimpleNamespace(
        PUBLIC_ACCESS=False,
        ALLOWED={123456789},
        BOT_TOKEN="42:stub-token",
        _galley_connected_once=True,
        agent=agent,
        clean_reply=lambda t: t,
        _render_file_markers=lambda t: (t or "").strip(),
        split_text=lambda t, limit: [t],
    )
    tgapp._agent = agent
    return tgapp


def _make_telegram_reporter(
    monkeypatch: Any,
    tmp_path: Path,
    tgapp: Any,
    cli_payloads: dict[str, list[dict[str, Any]]],
    sent: list[tuple[str, str, str]],
) -> TelegramReporter:
    reporter = TelegramReporter(
        tgapp, "galley-im/telegram", tmp_path / "reporter_state.json"
    )
    reporter.cli = "/stub/galley"

    def fake_run(cli: str, args: list[str]) -> list[dict[str, Any]]:
        key = " ".join(args[:2])
        if key == "sessions list":
            return cli_payloads["sessions"]
        if key == "session show":
            return cli_payloads.get(f"show {args[2]}", [])
        raise AssertionError(f"unexpected CLI call: {args}")

    monkeypatch.setattr(im_reporter, "run_cli_json_lines", fake_run)
    monkeypatch.setattr(
        im_reporter,
        "_telegram_send_text",
        lambda token, chat_id, text: sent.append((token, chat_id, text)),
    )
    return reporter


def test_telegram_reporter_delivers_over_http_send(
    monkeypatch: Any, tmp_path: Path
) -> None:
    tgapp = _stub_tgapp(["任务完成：结果是 X。"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1", supervisor="galley-im/telegram")],
        "show s1": [_agent_msg("a1", "done!")],
    }
    sent: list[tuple[str, str, str]] = []
    reporter = _make_telegram_reporter(monkeypatch, tmp_path, tgapp, payloads, sent)
    assert len(reporter.tick()) == 1
    assert sent == [("42:stub-token", "123456789", "任务完成：结果是 X。")]
    # No new activity → nothing re-reported.
    assert reporter.tick() == []
    assert len(sent) == 1


def test_telegram_reporter_owner_and_busy_gates(
    monkeypatch: Any, tmp_path: Path
) -> None:
    tgapp = _stub_tgapp(["report"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1", supervisor="galley-im/telegram")],
        "show s1": [_agent_msg("a1", "done!")],
    }
    sent: list[tuple[str, str, str]] = []
    reporter = _make_telegram_reporter(monkeypatch, tmp_path, tgapp, payloads, sent)
    # Public access → no unambiguous recipient → no push.
    tgapp.PUBLIC_ACCESS = True
    assert reporter.owner_open_id() is None
    assert reporter.tick() == []
    tgapp.PUBLIC_ACCESS = False
    tgapp.ALLOWED = set()
    assert reporter.owner_open_id() is None
    tgapp.ALLOWED = {123456789}
    assert reporter.owner_open_id() == "123456789"
    # Busy agent defers without consuming the report.
    tgapp.agent.is_running = True
    assert reporter.tick() == []
    assert sent == []
    tgapp.agent.is_running = False
    assert len(reporter.tick()) == 1
    assert sent[0][1] == "123456789"


# ── Discord channel adapter ──────────────────────────────────────────


class _StubDiscordApp:
    """Stub DiscordApp: the reporter only needs the loop, the per-channel
    task map, the strict deliver coroutine and the agent accessor."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.user_tasks: dict[str, Any] = {}
        self.sent: list[tuple[str, str]] = []
        self.active_ids: list[str] = []
        self.agents: dict[str, _StubAgent] = {}
        self.deliver_error: Exception | None = None

    def active_channel_ids(self) -> list[str]:
        return list(self.active_ids)

    async def deliver_text(self, chat_id: str, content: str) -> None:
        if self.deliver_error is not None:
            raise self.deliver_error
        self.sent.append((chat_id, content))

    def _get_agent(self, chat_id: str) -> Any:
        return types.SimpleNamespace(agent=self.agents.setdefault(chat_id, _StubAgent([])))


def _stub_dcapp(app: _StubDiscordApp | None) -> Any:
    return types.SimpleNamespace(
        ALLOWED={"555000111"},
        public_access=lambda allowed: not allowed or "*" in allowed,
        _galley_connected_once=True,
        get_app=lambda: app,
        _strip_discord_transcript=lambda t: (t or "").strip(),
    )


@contextlib.contextmanager
def _loop_thread() -> Iterator[asyncio.AbstractEventLoop]:
    """A real loop in a real thread: DiscordChannel.send crosses into it
    with run_coroutine_threadsafe, and that bridge is the contract."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        yield loop
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)
        loop.close()


def _discord_payloads(chat_id: str = "ch:1") -> dict[str, list[dict[str, Any]]]:
    return {
        "sessions": [_session("s1", supervisor=None)],
        "show s1": [
            _user_msg("u1", supervisor=f"galley-im/discord/{chat_id}", turn=1),
            _agent_msg("a1", "done!", turn=1),
        ],
    }


def test_discord_channel_delivers_into_its_own_channel(
    monkeypatch: Any, tmp_path: Path
) -> None:
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    _fake_cli(monkeypatch, _discord_payloads())
    with _loop_thread() as loop:
        app = _StubDiscordApp(loop)
        dcapp = _stub_dcapp(app)
        reporter = im_reporter.DiscordReporter(
            dcapp, "galley-im/discord", tmp_path / "reporter_state.json"
        )
        reporter.cli = "/stub/galley"
        agent = _StubAgent(["频道任务完成：结果是 X。"])
        assert reporter.attach_channel("ch:1", agent) == "galley-im/discord/ch:1"
        # A turn in flight on that channel defers without burning a report.
        app.user_tasks["ch:1"] = {"running": True}
        assert reporter.tick() == []
        assert agent.prompts == []
        app.user_tasks.clear()
        assert len(reporter.tick()) == 1
        # The report goes back to the channel, not to the owner's DM.
        assert app.sent == [("ch:1", "频道任务完成：结果是 X。")]
        # Detached channels stop being ours to report.
        reporter.detach_channel("ch:1")
        assert reporter.channels() == {}
        assert reporter.tick() == []


def test_discord_channel_requires_a_bound_owner(monkeypatch: Any, tmp_path: Path) -> None:
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    _fake_cli(monkeypatch, _discord_payloads())
    with _loop_thread() as loop:
        app = _StubDiscordApp(loop)
        dcapp = _stub_dcapp(app)
        channel = im_reporter.DiscordChannel(dcapp, "ch:1", _StubAgent(["report"]))
        # Unbound (managed dcapp starts with an empty allow-list) → no push.
        dcapp.ALLOWED = set()
        assert channel.owner_id() is None
        dcapp.ALLOWED = {"*"}
        assert channel.owner_id() is None
        dcapp.ALLOWED = {"555000111", "555000222"}
        assert channel.owner_id() is None
        dcapp.ALLOWED = {"555000111"}
        assert channel.owner_id() == "555000111"
        # Disconnected client → not ready either.
        dcapp._galley_connected_once = False
        assert not channel.connected()
        dcapp._galley_connected_once = True
        assert channel.connected()


def test_discord_send_failure_raises_and_counts_attempts(
    monkeypatch: Any, tmp_path: Path
) -> None:
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    _fake_cli(monkeypatch, _discord_payloads())
    with _loop_thread() as loop:
        app = _StubDiscordApp(loop)
        app.deliver_error = RuntimeError("channel deleted")
        dcapp = _stub_dcapp(app)
        agent = _StubAgent(["r1", "r2", "r3", "never used"])
        channel = im_reporter.DiscordChannel(dcapp, "ch:1", agent)
        # The async bridge surfaces the failure instead of swallowing it.
        with pytest.raises(RuntimeError, match="channel deleted"):
            channel.send("555000111", "report", "report")
        reporter = im_reporter.DiscordReporter(
            dcapp, "galley-im/discord", tmp_path / "reporter_state.json"
        )
        reporter.cli = "/stub/galley"
        reporter.register_channel("galley-im/discord/ch:1", channel)
        for _ in range(3):
            assert reporter.tick() == []
        assert app.sent == []
        assert len(agent.prompts) == 3
        # Bounded: the fourth tick gives up without burning another turn.
        assert reporter.tick() == []
        assert len(agent.prompts) == 3


def test_start_discord_reporter_restores_active_channels(
    monkeypatch: Any, tmp_path: Path
) -> None:
    monkeypatch.setenv("GALLEY_SUPERVISOR_ID", "galley-im/discord")
    monkeypatch.setattr(im_reporter, "_start_reporter", lambda reporter: reporter)
    _fake_cli(monkeypatch, _discord_payloads("ch:7"))
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    with _loop_thread() as loop:
        app = _StubDiscordApp(loop)
        app.active_ids = ["ch:7", "ch:8"]
        app.agents["ch:7"] = _StubAgent(["restored report"])
        reporter = im_reporter.start_discord_reporter(_stub_dcapp(app), tmp_path)
        assert reporter is not None
        assert set(reporter.channels()) == {
            "galley-im/discord/ch:7",
            "galley-im/discord/ch:8",
        }
        reporter.cli = "/stub/galley"
        # Routing works before any message arrives: the restored channel
        # resolves its agent through dcapp on first use.
        assert len(reporter.tick()) == 1
        assert app.sent == [("ch:7", "restored report")]


def test_start_discord_reporter_disabled_without_supervisor_id(
    monkeypatch: Any, tmp_path: Path
) -> None:
    monkeypatch.delenv("GALLEY_SUPERVISOR_ID", raising=False)
    assert im_reporter.start_discord_reporter(_stub_dcapp(None), tmp_path) is None


def test_discord_reporter_without_app_is_inert(monkeypatch: Any, tmp_path: Path) -> None:
    """dcapp builds its app inside main(), after the launcher starts the
    reporter: restore must be a no-op instead of a crash."""
    monkeypatch.setenv("GALLEY_SUPERVISOR_ID", "galley-im/discord")
    monkeypatch.setattr(im_reporter, "_start_reporter", lambda reporter: reporter)
    reporter = im_reporter.start_discord_reporter(_stub_dcapp(None), tmp_path)
    assert reporter is not None
    assert reporter.channels() == {}
    assert not im_reporter.DiscordChannel(_stub_dcapp(None), "ch:1").connected()


# ── dispatcher: message-origin routing + multi-channel registry ─────


class _StubChannel(im_reporter.ChannelAdapter):
    def __init__(self, owner: str | None, replies: list[str]) -> None:
        self.owner = owner
        self.agent_obj = _StubAgent(replies)
        self.sent: list[tuple[str, str]] = []
        self.is_busy = False

    def connected(self) -> bool:
        return True

    def owner_id(self) -> str | None:
        return self.owner

    def busy(self) -> bool:
        return self.is_busy

    def agent(self) -> Any:
        return self.agent_obj

    def send(self, owner: str, text: str, raw: str) -> None:
        self.sent.append((owner, text))


def _fake_cli(
    monkeypatch: Any, cli_payloads: dict[str, list[dict[str, Any]]]
) -> None:
    def fake_run(cli: str, args: list[str]) -> list[dict[str, Any]]:
        key = " ".join(args[:2])
        if key == "sessions list":
            return cli_payloads["sessions"]
        if key == "session show":
            return cli_payloads.get(f"show {args[2]}", [])
        raise AssertionError(f"unexpected CLI call: {args}")

    monkeypatch.setattr(im_reporter, "run_cli_json_lines", fake_run)


def test_gui_created_session_continued_by_channel_reports(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _stub_fsapp(["report text"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1", supervisor=None)],
        "show s1": [
            _user_msg("u1", supervisor=SUP, turn=1),
            _agent_msg("a1", "done!", turn=1),
        ],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    # Session origin is GUI, but the reported turn came from this
    # channel — the old session-origin filter never reported these.
    assert len(reporter.tick()) == 1
    assert fsapp._sent == [("ou_owner", "report text")]


def test_foreign_turn_is_not_reported_here(monkeypatch: Any, tmp_path: Path) -> None:
    fsapp = _stub_fsapp(["should not be used"])
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1")],  # created by this channel...
        "show s1": [
            _user_msg("u1", supervisor="galley-im/telegram", turn=3),
            _agent_msg("a1", "done!", turn=3),
        ],  # ...but the reported turn was driven from Telegram
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    assert reporter.tick() == []
    assert fsapp._sent == []
    assert fsapp._agent.prompts == []
    # Marked seen: steady state does not re-fetch messages forever.
    assert reporter.tick() == []


def test_send_failure_counts_attempts_and_gives_up(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _stub_fsapp(["r1", "r2", "r3", "never used"])

    def broken_send(rid: str, text: str, **kw: Any) -> None:
        raise RuntimeError("network down")

    fsapp.send_message = broken_send
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1")],
        "show s1": [_agent_msg("a1", "done!")],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    # Three failing attempts, each burning one report turn...
    for _ in range(3):
        assert reporter.tick() == []
    assert len(fsapp._agent.prompts) == 3
    # ...then the attempt limit gives up WITHOUT another turn, and the
    # session stops being re-checked.
    assert reporter.tick() == []
    assert reporter.tick() == []
    assert len(fsapp._agent.prompts) == 3


def test_dispatcher_routes_across_registered_channels(
    monkeypatch: Any, tmp_path: Path
) -> None:
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    ch_a = _StubChannel("owner-a", ["report A"])
    ch_b = _StubChannel("owner-b", ["report B"])
    reporter = ImReporter(
        {"galley-im/discord/ch:1": ch_a, "galley-im/discord/ch:2": ch_b},
        tmp_path / "reporter_state.json",
    )
    reporter.cli = "/stub/galley"
    payloads = {
        "sessions": [_session("s1", supervisor=None), _session("s2", supervisor=None)],
        "show s1": [
            _user_msg("u1", supervisor="galley-im/discord/ch:1", turn=1),
            _agent_msg("a1", "done A", turn=1),
        ],
        "show s2": [
            _user_msg("u2", supervisor="galley-im/discord/ch:2", turn=1),
            _agent_msg("a2", "done B", turn=1),
        ],
    }
    _fake_cli(monkeypatch, payloads)
    # One channel busy: the other's report still flows this tick.
    ch_a.is_busy = True
    assert len(reporter.tick()) == 1
    assert ch_a.sent == []
    assert ch_b.sent == [("owner-b", "report B")]
    ch_a.is_busy = False
    assert len(reporter.tick()) == 1
    assert ch_a.sent == [("owner-a", "report A")]
    # Unregister: that channel's future reports are no longer ours.
    reporter.unregister_channel("galley-im/discord/ch:1")
    payloads["sessions"] = [
        _session("s1", supervisor=None, last_activity="2026-07-03T12:00:00Z"),
    ]
    payloads["show s1"].append(_agent_msg("a3", "later result", turn=2))
    payloads["show s1"].insert(
        2, _user_msg("u3", supervisor="galley-im/discord/ch:1", turn=2)
    )
    assert reporter.tick() == []
    assert ch_a.sent == [("owner-a", "report A")]


def test_state_prunes_deleted_sessions(monkeypatch: Any, tmp_path: Path) -> None:
    (tmp_path / "reporter_state.json").write_text(
        '{"sessions":{"s-gone":{"lastSeenStatus":"idle"}}}', encoding="utf-8"
    )
    fsapp = _stub_fsapp([])
    payloads: dict[str, list[dict[str, Any]]] = {"sessions": []}
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    assert reporter.tick() == []
    assert "s-gone" not in reporter.state.data["sessions"]
    # Persisted, not just in-memory.
    reloaded = ReporterState.load(tmp_path / "reporter_state.json")
    assert "s-gone" not in reloaded.data["sessions"]


def test_run_cli_json_lines_parses_ndjson(monkeypatch: Any) -> None:
    proc = types.SimpleNamespace(
        returncode=0,
        stdout=json.dumps({"id": "s1"}) + "\n\n" + json.dumps({"id": "s2"}) + "\n",
        stderr="",
    )
    monkeypatch.setattr("runner.im_reporter.subprocess.run", lambda *a, **kw: proc)
    items = im_reporter.run_cli_json_lines("/stub/galley", ["sessions", "list"])
    assert [i["id"] for i in items] == ["s1", "s2"]


def test_owned_prefix_report_is_held_until_channel_reactivates(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """A managed restart deactivates every Discord channel (patch
    semantics), so a session delegated from ch:9 that settles before the
    owner re-mentions the bot has no registered route. The base-id
    prefix marks it OURS: it must be held — not marked seen as foreign —
    and delivered once the channel re-activates."""
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    _fake_cli(monkeypatch, _discord_payloads("ch:9"))
    with _loop_thread() as loop:
        app = _StubDiscordApp(loop)
        dcapp = _stub_dcapp(app)
        reporter = im_reporter.DiscordReporter(
            dcapp, "galley-im/discord", tmp_path / "reporter_state.json"
        )
        reporter.cli = "/stub/galley"
        # Some other channel is active, so the tick actually runs.
        reporter.attach_channel("ch:1")
        assert reporter.tick() == []
        assert app.sent == []
        # Held, not seen: the next tick still re-checks the session.
        assert reporter.tick() == []
        # Re-activation registers ch:9; the pending report flows.
        app.agents["ch:9"] = _StubAgent(["report text"])
        reporter.attach_channel("ch:9")
        assert len(reporter.tick()) == 1
        assert app.sent == [("ch:9", "report text")]


def test_reporter_strips_workbench_suggestion_tag(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """The composer's ghost-text tag must never reach an IM push, even if
    the model imitates it from pre-fix conversation history."""
    fsapp = _stub_fsapp(
        ["报告正文。\n\n<next-suggestion>帮我继续下一步</next-suggestion>"]
    )
    (tmp_path / "reporter_state.json").write_text('{"sessions":{}}', encoding="utf-8")
    payloads = {
        "sessions": [_session("s1")],
        "show s1": [_agent_msg("a1", "done!")],
    }
    reporter = _make_reporter(monkeypatch, tmp_path, fsapp, payloads)
    assert len(reporter.tick()) == 1
    assert fsapp._sent == [("ou_owner", "报告正文。")]
