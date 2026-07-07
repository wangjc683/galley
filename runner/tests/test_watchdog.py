import os

import pytest

from runner import _watchdog


def test_parse_core_pid_rejects_self_missing_and_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(_watchdog.GALLEY_CORE_PID_ENV, raising=False)
    assert _watchdog.parse_core_pid() is None

    monkeypatch.setenv(_watchdog.GALLEY_CORE_PID_ENV, "not-an-int")
    assert _watchdog.parse_core_pid() is None

    monkeypatch.setenv(_watchdog.GALLEY_CORE_PID_ENV, str(os.getpid()))
    assert _watchdog.parse_core_pid() is None

    monkeypatch.setenv(_watchdog.GALLEY_CORE_PID_ENV, "999999")
    assert _watchdog.parse_core_pid() == 999999


def test_parent_loss_reason_detects_missing_parent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_watchdog, "parent_process_alive", lambda _pid: False)
    reason = _watchdog.parent_loss_reason(parent_pid=12345, original_ppid=100)
    assert reason == "Galley Core process 12345 disappeared"


def test_parent_loss_reason_detects_ppid_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_watchdog, "parent_process_alive", lambda _pid: True)
    monkeypatch.setattr(os, "getppid", lambda: 321)
    reason = _watchdog.parent_loss_reason(parent_pid=123, original_ppid=100)
    assert reason == "parent process changed from 100 to 321"


def test_parent_loss_reason_none_when_alive_and_stable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_watchdog, "parent_process_alive", lambda _pid: True)
    monkeypatch.setattr(os, "getppid", lambda: 100)
    assert _watchdog.parent_loss_reason(parent_pid=123, original_ppid=100) is None


def test_exit_parentless_runs_cleanup_then_exits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """os._exit skips finally/atexit, so parent-loss exit must run the
    registered cleanup (e.g. pet detach) explicitly before dying. The
    cleanup iterable is read at call time so late appends are honored."""
    calls: list[str] = []
    codes: list[int] = []
    monkeypatch.setattr(_watchdog, "_EXIT_FOR_PARENT_LOSS", lambda code: codes.append(code))

    with pytest.raises(SystemExit):
        _watchdog.exit_parentless(
            "test parent loss",
            label="unit",
            cleanup=[lambda: calls.append("pet")],
        )

    assert calls == ["pet"]
    assert codes == [0]
