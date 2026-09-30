"""Managed-GA patch 0025: ``GenericAgent.abort()`` must wake an LLM request
that is still waiting for its response headers.

abort() shuts the in-flight socket down so a recv() blocked in the GA worker
thread returns. Upstream then force-closes it (``_real_close``) because on
Windows only the close wakes the recv; on macOS that immediate close races
the shutdown's wake-up and the recv stays blocked until ``read_timeout``
(reproduced 2026-09-30: a stalled-before-headers HTTPS request woke 2/6
times with the close, 6/6 with the shutdown alone). The patch keeps the close
on Windows only.

The method is loaded from the shipped payload's source without importing
agentmain (which pulls in the whole engine), and run against a recording
fake socket.
"""

from __future__ import annotations

import ast
import sys
import types
from collections.abc import Callable
from pathlib import Path
from typing import Any

_AGENTMAIN = Path(__file__).resolve().parents[2] / "managed-ga" / "code" / "agentmain.py"


class RecordingSocket:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def shutdown(self, how: int) -> None:
        self.calls.append("shutdown")

    def _real_close(self) -> None:
        self.calls.append("_real_close")

    def close(self) -> None:
        self.calls.append("close")


def _load_abort(os_name: str) -> Callable[[Any], None]:
    tree = ast.parse(_AGENTMAIN.read_text(encoding="utf-8"))
    abort = next(
        node
        for cls in tree.body
        if isinstance(cls, ast.ClassDef)
        for node in cls.body
        if isinstance(node, ast.FunctionDef) and node.name == "abort"
    )
    namespace: dict[str, Any] = {
        "os": types.SimpleNamespace(name=os_name),
        "sys": sys,
        "print": lambda *args, **kwargs: None,
    }
    exec(compile(ast.Module(body=[abort], type_ignores=[]), str(_AGENTMAIN), "exec"), namespace)
    loaded: Callable[[Any], None] = namespace["abort"]
    return loaded


def _running_agent(monkeypatch: Any) -> tuple[Any, RecordingSocket]:
    sock = RecordingSocket()
    monkeypatch.setitem(sys.modules, "llmcore", types.SimpleNamespace(_INFLIGHT={7: sock}))
    backend = types.SimpleNamespace(_tid=7, active_response=None)
    agent = types.SimpleNamespace(
        is_running=True,
        stop_sig=False,
        handler=None,
        llmclient=types.SimpleNamespace(backend=backend),
    )
    return agent, sock


def test_abort_only_shuts_the_socket_down_off_windows(monkeypatch: Any) -> None:
    """os.name is "posix" on macOS and Linux alike."""
    agent, sock = _running_agent(monkeypatch)
    _load_abort("posix")(agent)
    assert sock.calls == ["shutdown"]
    assert agent.stop_sig is True
    assert agent.llmclient.backend.should_stop() is True


def test_abort_still_force_closes_on_windows(monkeypatch: Any) -> None:
    agent, sock = _running_agent(monkeypatch)
    _load_abort("nt")(agent)
    assert sock.calls == ["shutdown", "_real_close"]


def test_abort_is_a_no_op_when_idle(monkeypatch: Any) -> None:
    agent, sock = _running_agent(monkeypatch)
    agent.is_running = False
    _load_abort("posix")(agent)
    assert sock.calls == [] and agent.stop_sig is False
