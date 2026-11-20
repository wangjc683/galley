from __future__ import annotations

import errno
import io
import json
import sys
from collections.abc import Callable
from typing import Any

import pytest

from runner import managed_browser_bridge as bridge


class FakeClient:
    """Stands in for the extension's ``simple_websocket_server`` connection."""

    def __init__(self, port: int) -> None:
        self.address = ("127.0.0.1", port)


class FakeDriver:
    """Stands in for TMWebDriver: ``is_remote``, ``get_status()``, and the
    master's ``extension_client`` (patch ``0006``)."""

    def __init__(self, *, is_remote: bool, status: dict[str, Any] | None = None) -> None:
        self.is_remote = is_remote
        self.status: dict[str, Any] = status or {"extension_connected": False, "tab_count": 0}
        self.error: BaseException | None = None
        self.status_calls = 0
        self.extension_client: FakeClient | None = None
        self._galley_on_browser_wanted: Callable[[], bool] | None = None

    def connect_extension(self, port: int, tabs: int = 1) -> None:
        self.extension_client = FakeClient(port)
        self.status = {"extension_connected": True, "tab_count": tabs}

    def disconnect_extension(self) -> None:
        self.extension_client = None
        self.status = {"extension_connected": False, "tab_count": 0}

    def ask_browser_wanted(self) -> bool:
        # What TMWebDriver._galley_browser_wanted does with the hook.
        hook = self._galley_on_browser_wanted
        return bool(hook()) if hook else False

    def get_status(self) -> dict[str, Any]:
        self.status_calls += 1
        if self.error is not None:
            raise self.error
        return dict(self.status)


class Harness:
    def __init__(
        self,
        *drivers: FakeDriver | BaseException,
        http_up: bool = True,
        known_browser_app: str | None = None,
        browsers: dict[int, str | None] | None = None,
    ) -> None:
        self.queue: list[FakeDriver | BaseException] = list(drivers)
        self.created: list[FakeDriver] = []
        self.lines: list[dict[str, Any]] = []
        self.http_up = http_up
        self.now = 0.0
        self.browsers = browsers or {}
        self.lookups: list[int] = []
        self.stamps = 0
        self.loop = bridge.BridgeLoop(
            self.factory,
            self.emit,
            port_listening=self.port_listening,
            sleep=self.sleep,
            clock=self.clock,
            known_browser_app=known_browser_app,
            browser_lookup=self.lookup,
            now_iso=self.now_iso,
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

    def lookup(self, port: int) -> str | None:
        self.lookups.append(port)
        return self.browsers.get(port)

    def now_iso(self) -> str:
        self.stamps += 1
        return f"2026-11-20T00:00:{self.stamps:02d}.000Z"


def _running(
    role: str,
    connected: bool,
    tabs: int,
    app: str | None = None,
    wanted_at: str | None = None,
) -> dict[str, Any]:
    return {
        "state": "running",
        "role": role,
        "extensionConnected": connected,
        "tabCount": tabs,
        "browserApp": app,
        "browserWantedAt": wanted_at,
    }


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


# ---- browser auto-open (ticket browser-auto-open 01) ----

VIVALDI = "/Applications/Vivaldi.app"
VIVALDI_HELPER = (
    "/Applications/Vivaldi.app/Contents/Frameworks/Vivaldi Framework.framework/Versions/"
    "8.3/Helpers/Vivaldi Helper.app/Contents/MacOS/Vivaldi Helper"
)


@pytest.mark.parametrize(
    ("executable", "app"),
    [
        (VIVALDI_HELPER, VIVALDI),
        (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome.app",
        ),
        (
            "/Users/someone/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Users/someone/Applications/Brave Browser.app",
        ),
        ("/usr/local/bin/chromium", None),
        ("Vivaldi.app/Contents/MacOS/Vivaldi", None),
        ("/Applications/.app/Contents/MacOS/x", None),
        ("", None),
    ],
)
def test_outermost_app_bundle(executable: str, app: str | None) -> None:
    assert bridge.outermost_app_bundle(executable) == app


LSOF_LISTING = (
    "p7208\nf7\nn127.0.0.1:18765->127.0.0.1:52427\n"
    "p16191\nf38\nn127.0.0.1:52427->127.0.0.1:18765\n"
)


def test_lsof_listing_picks_the_process_whose_local_port_matches() -> None:
    assert bridge._lsof_owner_of_local_port(LSOF_LISTING, 52427, own_pid=7208) == 16191
    # Our own end never counts, even if its local side were to match.
    assert bridge._lsof_owner_of_local_port(LSOF_LISTING, 18765, own_pid=7208) is None
    assert bridge._lsof_owner_of_local_port("", 52427, own_pid=7208) is None
    assert bridge._lsof_owner_of_local_port("pnot-a-pid\nn1:52427->2:18765\n", 52427, 1) is None


def test_macos_lookup_returns_the_peer_executable() -> None:
    calls: list[list[str]] = []

    def run(args: list[str]) -> str | None:
        calls.append(args)
        if args[0].endswith("lsof"):
            return LSOF_LISTING
        return VIVALDI_HELPER + "\n"

    assert bridge._macos_peer_executable(52427, own_pid=7208, run=run) == VIVALDI_HELPER
    assert calls[0][-3:] == ["-iTCP:52427", "-sTCP:ESTABLISHED", "-Fpn"]
    assert calls[1] == ["/bin/ps", "-p", "16191", "-o", "comm="]

    assert bridge._macos_peer_executable(52427, own_pid=7208, run=lambda _a: None) is None


def test_master_recognises_the_browser_once_per_connection() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, browsers={52427: VIVALDI})
    h.loop.step()
    assert h.lookups == []

    master.connect_extension(52427, tabs=2)
    h.loop.step()
    assert h.lookups == [52427]
    assert h.lines[-1] == _running("master", True, 2, app=VIVALDI)

    # A tab update moves extension_connected_at but not the connection.
    master.status = {"extension_connected": True, "tab_count": 3, "extension_connected_at": 9.0}
    h.loop.step()
    assert h.lookups == [52427]
    assert h.lines[-1] == _running("master", True, 3, app=VIVALDI)


def test_failed_lookup_leaves_browser_app_unchanged() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, browsers={52427: VIVALDI})
    master.connect_extension(52427)
    h.loop.step()
    assert h.loop.browser_app == VIVALDI

    # Reconnects from a port nothing can be found for.
    master.connect_extension(60001)
    h.loop.step()
    assert h.lookups == [52427, 60001]
    assert h.loop.browser_app == VIVALDI
    assert h.lines[-1]["browserApp"] == VIVALDI


def test_lookup_raising_is_not_an_error() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master)

    def boom(_port: int) -> str | None:
        raise OSError("lsof missing")

    h.loop._browser_lookup = boom
    master.connect_extension(52427)
    assert h.loop.step() == bridge.POLL_INTERVAL_SEC
    assert h.lines[-1] == _running("master", True, 1)


def test_remote_role_does_not_look_up_or_answer() -> None:
    remote = FakeDriver(is_remote=True, status={"extension_connected": False, "tab_count": 0})
    remote.extension_client = FakeClient(52427)  # never read in the remote role
    h = Harness(remote, known_browser_app=VIVALDI)
    h.loop.step()
    assert h.lookups == []
    assert remote._galley_on_browser_wanted is None
    assert h.loop.on_browser_wanted() is False
    assert h.lines == [_running("remote", False, 0)]


def test_hook_says_no_while_the_extension_is_connected() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, known_browser_app=VIVALDI)
    master.connect_extension(52427)
    h.loop.step()
    assert master.ask_browser_wanted() is False
    assert h.loop.browser_wanted_at is None


def test_hook_says_no_when_the_browser_is_unknown() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master)
    h.loop.step()
    assert master.ask_browser_wanted() is False
    assert h.loop.browser_wanted_at is None
    assert h.lines == [_running("master", False, 0)]


def test_hook_opens_with_the_known_browser_and_reports_it() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, known_browser_app=VIVALDI)
    h.loop.step()
    assert master.ask_browser_wanted() is True
    stamp = "2026-11-20T00:00:01.000Z"
    assert h.loop.browser_wanted_at == stamp
    # Written at once, from the hook; browserApp stays what this run saw.
    assert h.lines[-1] == _running("master", False, 0, wanted_at=stamp)
    h.loop.step()
    assert len(h.lines) == 2


def test_hook_line_says_disconnected_before_the_loop_polls() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, browsers={52427: VIVALDI})
    master.connect_extension(52427, tabs=2)
    h.loop.step()
    # The browser quits; a session asks before the next poll.
    master.disconnect_extension()
    assert master.ask_browser_wanted() is True
    assert h.lines[-1]["extensionConnected"] is False
    assert h.lines[-1]["browserApp"] == VIVALDI
    assert h.lines[-1]["browserWantedAt"] is not None


def test_repeated_requests_within_the_window_do_not_move_browser_wanted_at() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, known_browser_app=VIVALDI)
    h.loop.step()
    assert master.ask_browser_wanted() is True
    first = h.loop.browser_wanted_at
    lines = len(h.lines)

    h.now += bridge.BROWSER_WANTED_REPEAT_SEC - 1
    assert master.ask_browser_wanted() is True
    assert h.loop.browser_wanted_at == first
    assert len(h.lines) == lines

    h.now += 1
    assert master.ask_browser_wanted() is True
    assert h.loop.browser_wanted_at != first
    assert len(h.lines) == lines + 1


def test_a_new_connection_ends_the_window() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, known_browser_app=VIVALDI, browsers={52427: VIVALDI})
    h.loop.step()
    assert master.ask_browser_wanted() is True
    first = h.loop.browser_wanted_at

    master.connect_extension(52427)
    h.loop.step()
    master.disconnect_extension()
    h.loop.step()
    h.now += 5
    assert master.ask_browser_wanted() is True
    assert h.loop.browser_wanted_at != first


def test_recognised_browser_is_enough_without_a_known_one() -> None:
    master = FakeDriver(is_remote=False)
    h = Harness(master, browsers={52427: VIVALDI})
    master.connect_extension(52427)
    h.loop.step()
    master.disconnect_extension()
    h.loop.step()
    assert master.ask_browser_wanted() is True


def test_main_passes_the_known_browser_app(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    out = io.StringIO()
    monkeypatch.setenv("GALLEY_RUNTIME_KIND", "managed")
    monkeypatch.delenv("GALLEY_CORE_PID", raising=False)
    monkeypatch.setattr(bridge, "_capture_real_stdout", lambda: out)
    monkeypatch.setattr(bridge, "_silence_stdout", lambda: None)
    # main() puts --ga-path on sys.path and stops bytecode writes.
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setattr(sys, "dont_write_bytecode", sys.dont_write_bytecode)
    seen: dict[str, Any] = {}

    class _Loop:
        def __init__(self, *_a: Any, **kwargs: Any) -> None:
            seen.update(kwargs)

        def run(self) -> int:
            return 0

    monkeypatch.setattr(bridge, "BridgeLoop", _Loop)
    assert bridge.main(["--ga-path", str(tmp_path), "--known-browser-app", VIVALDI]) == 0
    assert seen["known_browser_app"] == VIVALDI

    seen.clear()
    assert bridge.main(["--ga-path", str(tmp_path)]) == 0
    assert seen["known_browser_app"] is None
