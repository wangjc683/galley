"""Managed-GA patch 0028: a remote ``TMWebDriver`` keeps a live default tab.

With Galley's resident browser bridge hosting the TMWebDriver master, every
GA session's driver is a remote client. Upstream's remote client never set
``default_session_id``, so each ``execute_js`` paid the master's 3 s
dead-session wait and the web tools reported no active tab. The patched
remote branch of ``get_all_sessions`` adopts the first live tab, like a
master does.

The method is loaded from the shipped payload's source without importing
TMWebDriver (which needs bottle / simple_websocket_server / requests).
"""

from __future__ import annotations

import ast
from collections.abc import Callable
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_TMWEBDRIVER = _REPO / "managed-ga" / "code" / "TMWebDriver.py"


def _load_get_all_sessions() -> Callable[[Any], list[dict[str, Any]]]:
    tree = ast.parse(_TMWEBDRIVER.read_text(encoding="utf-8"))
    cls = next(
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "TMWebDriver"
    )
    func = next(
        node
        for node in cls.body
        if isinstance(node, ast.FunctionDef) and node.name == "get_all_sessions"
    )
    namespace: dict[str, Any] = {}
    exec(
        compile(ast.Module(body=[func], type_ignores=[]), str(_TMWEBDRIVER), "exec"),
        namespace,
    )
    loaded: Callable[[Any], list[dict[str, Any]]] = namespace["get_all_sessions"]
    return loaded


class _RemoteDriver:
    is_remote = True

    def __init__(self, sessions: list[dict[str, Any]], default: Any = None) -> None:
        self.sessions_reply = sessions
        self.default_session_id = default
        self.commands: list[dict[str, Any]] = []

    def _remote_cmd(self, cmd: dict[str, Any]) -> dict[str, Any]:
        self.commands.append(cmd)
        return {"r": self.sessions_reply}


get_all_sessions = _load_get_all_sessions()


def test_remote_client_adopts_first_live_tab() -> None:
    driver = _RemoteDriver([{"id": "101", "url": "a"}, {"id": "102", "url": "b"}])
    sessions = get_all_sessions(driver)
    assert [s["id"] for s in sessions] == ["101", "102"]
    assert driver.default_session_id == "101"
    assert driver.commands == [{"cmd": "get_all_sessions"}]


def test_remote_client_keeps_a_live_switched_tab() -> None:
    # web_scan / web_execute_js set the default from switch_tab_id, sometimes
    # as an int; a live switched tab must survive the next listing.
    driver = _RemoteDriver([{"id": "101"}, {"id": "102"}], default=102)
    get_all_sessions(driver)
    assert driver.default_session_id == 102


def test_remote_client_replaces_a_closed_default_tab() -> None:
    driver = _RemoteDriver([{"id": "102"}, {"id": "103"}], default="101")
    get_all_sessions(driver)
    assert driver.default_session_id == "102"


def test_remote_client_without_tabs_keeps_its_default() -> None:
    # An extension reconnect briefly lists no tabs; do not forget the tab.
    driver = _RemoteDriver([], default="101")
    assert get_all_sessions(driver) == []
    assert driver.default_session_id == "101"
