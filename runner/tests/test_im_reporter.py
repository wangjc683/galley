"""Tests for the Feishu proactive completion reporter (runner/im_reporter.py).

Pure decision logic is tested directly; the tick/deliver flow runs against a
stub fsapp module and a stubbed CLI, mirroring the stub-lark approach used in
test_managed_feishu_fsapp.py.
"""
from __future__ import annotations

import json
import queue
import types
from pathlib import Path
from typing import Any

from runner import im_reporter
from runner.im_reporter import (
    FeishuReporter,
    Report,
    ReporterState,
    build_report_prompt,
    delegated_sessions,
    is_skip_reply,
    latest_final_output,
    needs_check,
    plan_report,
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


def _agent_msg(mid: str, final: str | None) -> dict[str, Any]:
    msg: dict[str, Any] = {"id": mid, "role": "agent", "content": "step content"}
    if final is not None:
        msg["finalAnswer"] = final
    return msg


# ── pure logic ───────────────────────────────────────────────────────


def test_delegated_sessions_filters_by_supervisor_and_archive() -> None:
    sessions = [
        _session("mine"),
        _session("other", supervisor="claude-skill/v1"),
        _session("no-origin", supervisor=None),
        _session("archived", status="archived"),
    ]
    assert [s["id"] for s in delegated_sessions(sessions, SUP)] == ["mine"]


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

    def put_task(self, prompt: str, source: str = "") -> "queue.Queue[dict[str, Any]]":
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


def test_run_cli_json_lines_parses_ndjson(monkeypatch: Any) -> None:
    proc = types.SimpleNamespace(
        returncode=0,
        stdout=json.dumps({"id": "s1"}) + "\n\n" + json.dumps({"id": "s2"}) + "\n",
        stderr="",
    )
    monkeypatch.setattr("runner.im_reporter.subprocess.run", lambda *a, **kw: proc)
    items = im_reporter.run_cli_json_lines("/stub/galley", ["sessions", "list"])
    assert [i["id"] for i in items] == ["s1", "s2"]
