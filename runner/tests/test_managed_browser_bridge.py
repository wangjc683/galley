from __future__ import annotations

import errno
import io
import json
from collections.abc import Callable
from typing import Any

import pytest

from runner import managed_browser_bridge as bridge


class FakeDriver:
    """Stands in for TMWebDriver: ``is_remote`` plus ``get_status()``."""

    def __init__(self, *, is_remote: bool, status: dict[str, Any] | None = None) -> None:
        self.is_remote = is_remote
        self.status: dict[str, Any] = status or {"extension_connected": False, "tab_count": 0}
        self.error: BaseException | None = None
        self.status_calls = 0

    def get_status(self) -> dict[str, Any]:
        self.status_calls += 1
        if self.error is not None:
            raise self.error
        return dict(self.status)


class Harness:
    def __init__(self, *drivers: FakeDriver | BaseException, http_up: bool = True) -> None:
        self.queue: list[FakeDriver | BaseException] = list(drivers)
        self.created: list[FakeDriver] = []
        self.lines: list[dict[str, Any]] = []
        self.http_up = http_up
        self.now = 0.0
        self.loop = bridge.BridgeLoop(
            self.factory,
            self.emit,
            port_listening=self.port_listening,
            sleep=self.sleep,
            clock=self.clock,
        )

    def factory(self) -> FakeDriver:
        item = self.queue.pop(0)
        if isinstance(item, BaseException):
            raise item
        self.created.append(item)
        return item

    def emit(self, **payload: Any) -> None:
        self.lines.append(payload)

    def port_listening(self, _host: str, port: int) -> bool:
        assert port == bridge.DRIVER_PORT + 1
        return self.http_up

    def sleep(self, seconds: float) -> None:
        self.now += seconds

    def clock(self) -> float:
        return self.now


def _running(role: str, connected: bool, tabs: int) -> dict[str, Any]:
    return {"state": "running", "role": role, "extensionConnected": connected, "tabCount": tabs}


def test_master_reports_status_on_start_and_on_change_only() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master)

    assert h.loop.step() == bridge.POLL_INTERVAL_SEC
    assert h.loop.role == bridge.ROLE_MASTER
    assert h.lines == [_running("master", False, 0)]

    # Unchanged status: no new line.
    h.loop.step()
    assert len(h.lines) == 1

    master.status = {"extension_connected": True, "tab_count": 0, "extension_connected_at": 1.0}
    h.loop.step()
    master.status = {"extension_connected": True, "tab_count": 3, "extension_connected_at": 2.0}
    h.loop.step()
    h.loop.step()
    assert h.lines[1:] == [_running("master", True, 0), _running("master", True, 3)]
    # One driver for the whole run: the master is never rebuilt.
    assert h.created == [master]


def test_remote_role_reports_through_the_other_master() -> None:
    remote = FakeDriver(is_remote=True, status={"extension_connected": True, "tab_count": 2})
    h = Harness(remote)
    h.loop.step()
    assert h.loop.role == bridge.ROLE_REMOTE
    assert h.lines == [_running("remote", True, 2)]


def test_remote_becomes_master_when_the_port_frees() -> None:
    remote = FakeDriver(is_remote=True, status={"extension_connected": True, "tab_count": 1})
    master = FakeDriver(is_remote=False)
    h = Harness(remote, master)
    h.loop.step()

    # The other master exits: upstream's remote client raises ConnectionError.
    remote.error = ConnectionError("TMWebDriver master未运行")
    assert h.loop.step() == bridge.MASTER_GONE_RETRY_SEC
    assert h.loop.driver is None

    assert h.loop.step() == bridge.POLL_INTERVAL_SEC
    assert h.loop.role == bridge.ROLE_MASTER
    assert h.created == [remote, master]
    assert h.lines == [_running("remote", True, 1), _running("master", False, 0)]


def test_repeated_connection_resets_back_off_instead_of_spinning() -> None:
    first = FakeDriver(is_remote=True)
    first.error = ConnectionError("reset")
    second = FakeDriver(is_remote=True)
    second.error = ConnectionError("reset")
    h = Harness(first, second)

    assert h.loop.step() == bridge.MASTER_GONE_RETRY_SEC
    delay = h.loop.step()
    assert delay == bridge.RETRY_MIN_SEC
    assert h.lines[-1]["state"] == "error"
    assert h.lines[-1]["errorKind"] == "master_unreachable"


def test_non_tmwebdriver_program_on_http_port_is_an_error() -> None:
    squatter = FakeDriver(is_remote=True)
    squatter.error = ValueError("Expecting value: line 1 column 1")
    h = Harness(squatter)
    assert h.loop.step() == bridge.RETRY_MIN_SEC
    assert h.lines == [
        {
            "state": "error",
            "role": "remote",
            "errorKind": "port_in_use",
            "error": bridge._port_in_use_message(bridge.DRIVER_PORT + 1),
        }
    ]


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (ModuleNotFoundError("No module named 'bottle'", name="bottle"), "missing_dependency"),
        (OSError(errno.EADDRINUSE, "Address already in use"), "port_in_use"),
        (RuntimeError("boom"), "start_failed"),
    ],
)
def test_start_failures_report_an_error_and_back_off(error: BaseException, kind: str) -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(error, error, master)

    assert h.loop.step() == bridge.RETRY_MIN_SEC
    assert h.loop.step() == bridge.RETRY_MIN_SEC * 2
    assert h.lines == [
        {"state": "error", "role": None, "errorKind": kind, "error": h.lines[0]["error"]}
    ]
    if kind == "missing_dependency":
        assert "bottle" in h.lines[0]["error"]

    # Recovery resets the backoff and reports the live status.
    assert h.loop.step() == bridge.POLL_INTERVAL_SEC
    assert h.lines[-1] == _running("master", False, 0)


def test_master_without_http_port_exits_to_release_the_websocket() -> None:
    h = Harness(FakeDriver(is_remote=False), http_up=False)
    with pytest.raises(bridge.BridgeFatalError):
        h.loop.step()
    assert h.lines[-1]["errorKind"] == "http_failed"
    assert h.now >= bridge.HTTP_READY_TIMEOUT_SEC


def test_run_returns_nonzero_on_fatal() -> None:
    h = Harness(FakeDriver(is_remote=False), http_up=False)
    assert h.loop.run() == 1


def test_malformed_status_is_reported_as_disconnected() -> None:
    master = FakeDriver(is_remote=False, status={"extension_connected": 1, "tab_count": "x"})
    h = Harness(master)
    h.loop.step()
    assert h.lines == [_running("master", True, 0)]


def test_main_refuses_outside_the_managed_runtime(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    out = io.StringIO()
    monkeypatch.delenv("GALLEY_RUNTIME_KIND", raising=False)
    monkeypatch.delenv("GALLEY_CORE_PID", raising=False)
    monkeypatch.setattr(bridge, "_capture_real_stdout", lambda: out)
    monkeypatch.setattr(bridge, "_silence_stdout", lambda: None)
    factory_calls: list[Callable[[], Any]] = []
    monkeypatch.setattr(bridge, "BridgeLoop", lambda *a, **k: factory_calls.append(a[0]))

    assert bridge.main(["--ga-path", str(tmp_path)]) == 1
    line = json.loads(out.getvalue().strip())
    assert line["state"] == "error"
    assert line["errorKind"] == "not_managed"
    assert "updatedAt" in line
    assert factory_calls == []


def test_master_keeps_its_driver_when_a_status_read_fails() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master)
    h.loop.step()
    master.error = RuntimeError("dict changed size during iteration")
    assert h.loop.step() == bridge.RETRY_MIN_SEC
    assert h.lines[-1]["errorKind"] == "status_failed"
    # Rebuilding would make a remote client of our own servers.
    assert h.loop.driver is master

    master.error = None
    assert h.loop.step() == bridge.POLL_INTERVAL_SEC
    assert h.created == [master]
    assert h.lines[-1] == _running("master", False, 0)


def test_remote_timeout_is_not_blamed_on_another_program() -> None:
    remote = FakeDriver(is_remote=True)
    remote.error = TimeoutError("read timed out")
    h = Harness(remote)
    h.loop.step()
    assert h.lines[-1]["errorKind"] == "status_failed"
    assert h.loop.driver is None
