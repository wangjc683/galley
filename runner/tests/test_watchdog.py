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


def test_exit_parentless_hard_exits_with_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Parent-loss exit goes through the os._exit patch point with code 0;
    the trailing SystemExit only fires when that patch point returns."""
    codes: list[int] = []
    monkeypatch.setattr(_watchdog, "_EXIT_FOR_PARENT_LOSS", lambda code: codes.append(code))

    with pytest.raises(SystemExit):
        _watchdog.exit_parentless("test parent loss", label="unit")

    assert codes == [0]
