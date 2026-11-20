"""Managed-GA patch 0035: a web tool asks Galley to open the browser.

When ``web_scan`` / ``web_execute_js`` find no tab and the extension is not
connected, they send ``galley_browser_wanted`` to the TMWebDriver master.
Galley's resident browser bridge answers ``opening: true`` while it knows
which browser the extension lives in (Core then opens it); the tool waits up
to 20 s for a tab and carries on. Any other answer returns the old message
at once. A remote client no longer waits 12 s in ``first_init_driver``; a
master this process just started still does.

ga.py is loaded from the shipped payload with fakes for the driver and the
clock; TMWebDriver's method is loaded from source without importing it (it
needs bottle / simple_websocket_server / requests).
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import types
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest

_MANAGED_GA_CODE = Path(__file__).resolve().parents[2] / "managed-ga" / "code"
if str(_MANAGED_GA_CODE) not in sys.path:
    sys.path.insert(0, str(_MANAGED_GA_CODE))

_PREVIOUS_DONT_WRITE_BYTECODE = sys.dont_write_bytecode
sys.dont_write_bytecode = True
_GA_SPEC = importlib.util.spec_from_file_location(
    "managed_ga_code_ga_browser_wanted", _MANAGED_GA_CODE / "ga.py"
)
assert _GA_SPEC is not None
assert _GA_SPEC.loader is not None
_managed_ga = importlib.util.module_from_spec(_GA_SPEC)
try:
    _GA_SPEC.loader.exec_module(_managed_ga)
finally:
    sys.dont_write_bytecode = _PREVIOUS_DONT_WRITE_BYTECODE
ga = cast(Any, _managed_ga)


def _load_tmwebdriver_method(name: str) -> Callable[..., Any]:
    source = _MANAGED_GA_CODE / "TMWebDriver.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    cls = next(
        node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "TMWebDriver"
    )
    func = next(
        node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == name
    )
    namespace: dict[str, Any] = {}
    exec(compile(ast.Module(body=[func], type_ignores=[]), str(source), "exec"), namespace)
    loaded: Callable[..., Any] = namespace[name]
    return loaded


_galley_browser_wanted = _load_tmwebdriver_method("_galley_browser_wanted")


class FakeTime:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class FakeDriver:
    """A TMWebDriver with no tab. ``tabs_after`` polls of
    ``get_all_sessions`` later a tab shows up (``None``: never)."""

    def __init__(
        self,
        *,
        is_remote: bool = True,
        reply: Any = None,
        reply_error: BaseException | None = None,
        connected: bool = False,
        tabs_after: int | None = None,
    ) -> None:
        self.is_remote = is_remote
        self.reply = {"r": {"opening": False}} if reply is None else reply
        self.reply_error = reply_error
        self.connected = connected
        self.tabs_after = tabs_after
        self.session_calls = 0
        self.commands: list[dict[str, Any]] = []
        self.default_session_id: Any = None

    def get_status(self) -> dict[str, Any]:
        return {"extension_connected": self.connected, "tab_count": 0}

    def get_all_sessions(self) -> list[dict[str, Any]]:
        self.session_calls += 1
        if self.tabs_after is not None and self.session_calls > self.tabs_after:
            self.default_session_id = "7"
            return [{"id": "7", "url": "https://example.com/", "title": "Example"}]
        return []

    def _remote_cmd(self, cmd: dict[str, Any]) -> Any:
        self.commands.append(cmd)
        if self.reply_error is not None:
            raise self.reply_error
        return self.reply


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeTime:
    fake = FakeTime()
    monkeypatch.setattr(ga, "time", fake)
    return fake


def _use(monkeypatch: pytest.MonkeyPatch, driver: Any) -> None:
    monkeypatch.setattr(ga, "driver", driver)


OPENING = {"r": {"opening": True}}


def test_opening_false_returns_at_once(monkeypatch: pytest.MonkeyPatch, clock: FakeTime) -> None:
    driver = FakeDriver(reply={"r": {"opening": False}})
    _use(monkeypatch, driver)
    result = ga.web_execute_js("return 1")
    assert result == {"status": "error", "msg": ga.NO_BROWSER_CONNECTION_MSG}
    assert driver.commands == [{"cmd": "galley_browser_wanted"}]
    assert clock.sleeps == []


@pytest.mark.parametrize(
    ("reply", "error"),
    [
        # An upstream or external master answers 'ok', which is not JSON:
        # requests' .json() raises a ValueError subclass.
        (None, ValueError("Expecting value: line 1 column 1 (char 0)")),
        (None, ConnectionError("master gone")),
        ("ok", None),
        ({"r": "ok"}, None),
        ({"r": {"opening": "yes"}}, None),
        ({}, None),
    ],
)
def test_anything_but_opening_true_is_no(
    monkeypatch: pytest.MonkeyPatch,
    clock: FakeTime,
    reply: Any,
    error: BaseException | None,
) -> None:
    driver = FakeDriver(reply=reply if reply is not None else OPENING, reply_error=error)
    _use(monkeypatch, driver)
    result = ga.web_scan(tabs_only=True)
    assert result == {"status": "error", "msg": ga.NO_BROWSER_CONNECTION_MSG}
    assert clock.sleeps == []


def test_connected_without_tabs_answers_at_once_and_asks_nothing(
    monkeypatch: pytest.MonkeyPatch, clock: FakeTime
) -> None:
    driver = FakeDriver(reply=OPENING, connected=True)
    _use(monkeypatch, driver)
    result = ga.web_scan(tabs_only=True)
    assert result == {"status": "error", "msg": ga.NO_BROWSER_TABS_MSG}
    assert driver.commands == []
    assert clock.sleeps == []


def test_waits_for_the_tab_then_runs_the_call(
    monkeypatch: pytest.MonkeyPatch, clock: FakeTime
) -> None:
    # First call (the check) and two polls find nothing; the third poll does.
    driver = FakeDriver(reply=OPENING, tabs_after=3)
    _use(monkeypatch, driver)
    ran: list[Any] = []

    def execute_js_rich(script: str, drv: Any, no_monitor: bool = False) -> dict[str, Any]:
        ran.append((script, drv.default_session_id))
        return {"status": "success", "js_return": 1}

    monkeypatch.setattr(ga.simphtml, "execute_js_rich", execute_js_rich)
    result = ga.web_execute_js("return 1")
    assert result == {"status": "success", "js_return": 1}
    assert ran == [("return 1", "7")]
    assert clock.sleeps == [0.5, 0.5, 0.5]


def test_web_scan_carries_on_after_the_wait(
    monkeypatch: pytest.MonkeyPatch, clock: FakeTime
) -> None:
    driver = FakeDriver(reply=OPENING, tabs_after=2)
    _use(monkeypatch, driver)
    result = ga.web_scan(tabs_only=True)
    assert result["status"] == "success"
    assert result["metadata"]["tabs_count"] == 1
    assert result["metadata"]["active_tab"] == "7"


def test_times_out_with_the_old_message(monkeypatch: pytest.MonkeyPatch, clock: FakeTime) -> None:
    driver = FakeDriver(reply=OPENING)
    _use(monkeypatch, driver)
    result = ga.web_execute_js("return 1")
    assert result == {"status": "error", "msg": ga.NO_BROWSER_CONNECTION_MSG}
    assert sum(clock.sleeps) == pytest.approx(20.0)
    assert len(driver.commands) == 1


def test_master_process_reads_its_own_hook(
    monkeypatch: pytest.MonkeyPatch, clock: FakeTime
) -> None:
    class Master(FakeDriver):
        _galley_browser_wanted = _galley_browser_wanted

    # A GA session that is the master itself has no hook: no, at once.
    master = Master(is_remote=False)
    _use(monkeypatch, master)
    assert ga.web_scan(tabs_only=True) == {
        "status": "error",
        "msg": ga.NO_BROWSER_CONNECTION_MSG,
    }
    assert master.commands == []

    hooked = Master(is_remote=False, tabs_after=2)
    hooked._galley_on_browser_wanted = lambda: True  # type: ignore[attr-defined]
    _use(monkeypatch, hooked)
    assert ga.web_scan(tabs_only=True)["status"] == "success"


def test_tmwebdriver_command_answers_through_the_hook() -> None:
    class Master:
        pass

    master = Master()
    assert _galley_browser_wanted(master) == {"opening": False}
    master._galley_on_browser_wanted = lambda: True  # type: ignore[attr-defined]
    assert _galley_browser_wanted(master) == {"opening": True}
    master._galley_on_browser_wanted = lambda: False  # type: ignore[attr-defined]
    assert _galley_browser_wanted(master) == {"opening": False}

    def boom() -> bool:
        raise RuntimeError("hook failed")

    master._galley_on_browser_wanted = boom  # type: ignore[attr-defined]
    assert _galley_browser_wanted(master) == {"opening": False}


def test_tmwebdriver_link_route_knows_the_command() -> None:
    source = (_MANAGED_GA_CODE / "TMWebDriver.py").read_text(encoding="utf-8")
    assert (
        "if data.get('cmd') == 'galley_browser_wanted': "
        "return json.dumps({'r': self._galley_browser_wanted()}, ensure_ascii=False)"
    ) in source


class _FakeTMWebDriverModule(types.ModuleType):
    def __init__(self, driver: FakeDriver) -> None:
        super().__init__("TMWebDriver")
        self.driver = driver

    def TMWebDriver(self) -> FakeDriver:  # noqa: N802 - upstream's class name
        return self.driver


def test_first_init_driver_does_not_wait_as_a_remote_client(
    monkeypatch: pytest.MonkeyPatch, clock: FakeTime
) -> None:
    remote = FakeDriver(is_remote=True)
    monkeypatch.setitem(sys.modules, "TMWebDriver", _FakeTMWebDriverModule(remote))
    monkeypatch.setattr(ga, "driver", None)
    ga.first_init_driver()
    assert ga.driver is remote
    assert clock.sleeps == []
    assert remote.session_calls == 0


def test_first_init_driver_still_waits_as_a_fresh_master(
    monkeypatch: pytest.MonkeyPatch, clock: FakeTime
) -> None:
    master = FakeDriver(is_remote=False)
    monkeypatch.setitem(sys.modules, "TMWebDriver", _FakeTMWebDriverModule(master))
    monkeypatch.setattr(ga, "driver", None)
    ga.first_init_driver()
    assert ga.driver is master
    assert sum(clock.sleeps) == pytest.approx(12.0)

    found = FakeDriver(is_remote=False, tabs_after=2)
    monkeypatch.setitem(sys.modules, "TMWebDriver", _FakeTMWebDriverModule(found))
    clock.sleeps.clear()
    ga.first_init_driver()
    assert clock.sleeps == [1, 1, 1]
