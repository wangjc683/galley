"""Galley-managed resident browser bridge.

Core starts this process while the managed runtime is active. It hosts
GenericAgent's own ``TMWebDriver`` master (WebSocket on 127.0.0.1:18765 for
the Chromium extension, HTTP on 18766 for remote clients), so the extension
can connect as soon as the browser runs and every managed GA session becomes
a remote client of it through upstream's existing remote mode. Galley Core
reads the connection state from the JSON lines this process writes on stdout.

Ground rules (docs/managed-ga-runtime/browser-control.md):

- Read-only use of upstream: construct ``TMWebDriver()`` and call
  ``get_status()``. Never execute JS in pages; the master only relays the
  GA sessions' own calls. Never write GA files or state.
- Do not fight over the ports. If another process already serves 18766
  (a GA session that started a master first, a second Galley, an external
  upstream GA), report role ``remote``, read the status through it, and try
  to become master again once it goes away.
- Leave with Core: exit on parent loss (``GALLEY_CORE_PID`` watchdog), on a
  closed status pipe, and on stdin EOF when Core asks for it.

Stdout carries status lines only (camelCase, one JSON object per line):

    {"state":"running","role":"master","extensionConnected":true,"tabCount":2,...}
    {"state":"error","role":null,"errorKind":"port_in_use","error":"...",...}

A line is written on start and then only when the status changes.
"""
from __future__ import annotations

import argparse
import errno
import importlib
import json
import os
import socket
import sys
import threading
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from typing import IO, Any

from runner import _watchdog, managed_runtime

LABEL = "managed-browser-bridge"
ROLE_MASTER = "master"
ROLE_REMOTE = "remote"
# TMWebDriver's defaults: the extension's WebSocket port; HTTP is port + 1.
DRIVER_HOST = "127.0.0.1"
DRIVER_PORT = 18765
POLL_INTERVAL_SEC = 1.0
RETRY_MIN_SEC = 2.0
RETRY_MAX_SEC = 30.0
# A master that just went away is usually replaced by us right away; give
# the old process a moment to release the ports, without the full backoff.
MASTER_GONE_RETRY_SEC = 0.3
HTTP_READY_TIMEOUT_SEC = 3.0


class BridgeFatalError(Exception):
    """The process holds a half-started master and must exit to free it."""


Emit = Callable[..., None]
DriverFactory = Callable[[], Any]


def _now_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )


def _port_listening(host: str, port: int, timeout: float = 0.2) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _port_in_use_message(port: int) -> str:
    return f"浏览器控制端口 {port} 被其他程序占用，Galley 无法启动浏览器控制服务。"


def _missing_dependency_message(error: ImportError) -> str:
    name = getattr(error, "name", None) or str(error)
    return f"浏览器控制组件无法启动：缺少 Python 依赖 {name}。"


def _start_error(error: BaseException) -> tuple[str, str]:
    if isinstance(error, ImportError):
        return "missing_dependency", _missing_dependency_message(error)
    if isinstance(error, OSError) and error.errno in {
        errno.EADDRINUSE,
        getattr(errno, "WSAEADDRINUSE", errno.EADDRINUSE),
    }:
        return "port_in_use", _port_in_use_message(DRIVER_PORT)
    return "start_failed", f"浏览器控制服务启动失败：{error}"


class BridgeLoop:
    """One resident TMWebDriver plus the status it reports.

    ``step()`` runs one iteration and returns the delay before the next, so
    tests drive it without threads or real ports.
    """

    def __init__(
        self,
        driver_factory: DriverFactory,
        emit: Emit,
        *,
        port_listening: Callable[[str, int], bool] = _port_listening,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        log: Callable[[str], None] | None = None,
    ) -> None:
        self._factory = driver_factory
        self._emit = emit
        self._port_listening = port_listening
        self._sleep = sleep
        self._clock = clock
        self._log = log or (lambda _message: None)
        self.driver: Any = None
        self.role: str | None = None
        self._failures = 0
        self._quick_retry_used = False
        self._last: tuple[Any, ...] | None = None

    # ---- reporting ----

    def _report(self, payload: dict[str, Any]) -> None:
        key = tuple(sorted(payload.items()))
        if key == self._last:
            return
        self._last = key
        self._emit(**payload)

    def _report_status(self, role: str, status: Mapping[str, Any]) -> None:
        try:
            tab_count = max(0, int(status.get("tab_count") or 0))
        except (TypeError, ValueError):
            tab_count = 0
        self._report(
            {
                "state": "running",
                "role": role,
                "extensionConnected": bool(status.get("extension_connected")),
                "tabCount": tab_count,
            }
        )

    def _report_error(self, kind: str, message: str) -> None:
        self._report({"state": "error", "role": self.role, "errorKind": kind, "error": message})

    def _backoff(self) -> float:
        self._failures += 1
        return float(min(RETRY_MAX_SEC, RETRY_MIN_SEC * (2 ** (self._failures - 1))))

    # ---- lifecycle ----

    def _wait_for_http(self) -> bool:
        deadline = self._clock() + HTTP_READY_TIMEOUT_SEC
        while True:
            if self._port_listening(DRIVER_HOST, DRIVER_PORT + 1):
                return True
            if self._clock() >= deadline:
                return False
            self._sleep(0.1)

    def _start(self) -> float | None:
        try:
            driver = self._factory()
        except Exception as e:  # ImportError, OSError(EADDRINUSE), anything upstream raises
            kind, message = _start_error(e)
            self.role = None
            self._log(f"start failed ({kind}): {e!r}")
            self._report_error(kind, message)
            return self._backoff()
        role = ROLE_REMOTE if getattr(driver, "is_remote", False) else ROLE_MASTER
        if role == ROLE_MASTER and not self._wait_for_http():
            # The WebSocket port is ours but the HTTP side never came up, so
            # GA sessions could neither reach us nor start their own master.
            # Only exiting releases the WebSocket server thread.
            self.role = None
            self._report_error(
                "http_failed",
                f"浏览器控制服务没能在端口 {DRIVER_PORT + 1} 启动。",
            )
            raise BridgeFatalError(f"HTTP port {DRIVER_PORT + 1} did not come up")
        if role != self.role:
            self._log(f"role {role}")
        self.driver = driver
        self.role = role
        return None

    def step(self) -> float:
        if self.driver is None:
            delay = self._start()
            if delay is not None:
                return delay
        try:
            status = self.driver.get_status()
        except ConnectionError:
            # Upstream raises ConnectionError once the remote master is gone.
            # Become master if the port is free now (or follow the new one).
            self.driver = None
            if self.role == ROLE_REMOTE and not self._quick_retry_used:
                # Once per healthy stretch: something that keeps resetting
                # connections on 18766 must not turn this into a busy loop.
                self._quick_retry_used = True
                return MASTER_GONE_RETRY_SEC
            self._report_error("master_unreachable", "浏览器控制服务暂时无法访问，正在重试。")
            return self._backoff()
        except Exception as e:
            self._log(f"status failed ({self.role}): {e!r}")
            if self.role == ROLE_REMOTE:
                # Re-evaluate from scratch next time: the port may have freed
                # or changed hands. A master keeps its driver: dropping it
                # would leave its own servers running and make the rebuilt
                # instance a remote client of itself.
                self.driver = None
            if self.role == ROLE_REMOTE and isinstance(e, ValueError):
                # Not JSON back from /link: something on 18766 that does
                # not speak TMWebDriver.
                self._report_error("port_in_use", _port_in_use_message(DRIVER_PORT + 1))
            else:
                self._report_error("status_failed", f"读取浏览器控制状态失败：{e}")
            return self._backoff()
        if not isinstance(status, Mapping):
            status = {}
        self._failures = 0
        self._quick_retry_used = False
        self._report_status(self.role or ROLE_MASTER, status)
        return POLL_INTERVAL_SEC

    def run(self) -> int:
        while True:
            try:
                delay = self.step()
            except BridgeFatalError as e:
                self._log(f"exiting: {e}")
                return 1
            self._sleep(delay)


# ---- process plumbing (mirrors runner/workbench_bridge.py) ----


def _capture_real_stdout() -> IO[str]:
    fd = os.dup(1)
    return os.fdopen(fd, "w", encoding="utf-8", buffering=1)


def _silence_stdout() -> None:
    """Keep the status pipe private: TMWebDriver prints every tab URL and
    every relayed script result, which must not reach Core (or its logs)."""
    devnull_fd = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull_fd, 1)
    finally:
        os.close(devnull_fd)
    sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115


def _emit_line(out: IO[str], **payload: Any) -> None:
    payload.setdefault("updatedAt", _now_iso())
    try:
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), file=out)
    except BrokenPipeError:
        _watchdog.exit_parentless("Galley Core status pipe closed", label=LABEL)
    except OSError as e:
        if e.errno == errno.EPIPE:
            _watchdog.exit_parentless("Galley Core status pipe closed", label=LABEL)
        raise


def _log_stderr(message: str) -> None:
    try:
        print(f"[{LABEL}] {message}", file=sys.stderr, flush=True)
    except Exception:
        pass


def _watch_stdin_eof() -> None:
    def _run() -> None:
        try:
            while os.read(0, 4096):
                pass
        except OSError:
            pass
        _watchdog.exit_parentless("Galley Core closed stdin", label=LABEL)

    threading.Thread(target=_run, name="galley-browser-bridge-stdin", daemon=True).start()


def _tmwebdriver_factory() -> Any:
    module = importlib.import_module("TMWebDriver")
    return module.TMWebDriver(host=DRIVER_HOST, port=DRIVER_PORT)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Galley's resident browser bridge.")
    parser.add_argument("--ga-path", required=True)
    parser.add_argument(
        "--exit-on-stdin-eof",
        action="store_true",
        help="exit when stdin closes (Core keeps a pipe open for the process lifetime)",
    )
    args = parser.parse_args(argv)

    out = _capture_real_stdout()
    _silence_stdout()
    _watchdog.start_parent_watchdog(
        _watchdog.parse_core_pid(),
        label=LABEL,
        thread_name="galley-browser-bridge-parent-watchdog",
    )
    if args.exit_on_stdin_eof:
        _watch_stdin_eof()

    def emit(**payload: Any) -> None:
        _emit_line(out, **payload)

    if not managed_runtime.is_managed_runtime():
        # Rule 1: an external GA's sessions would attach to this master.
        emit(state="error", role=None, errorKind="not_managed", error="not a managed runtime")
        return 1
    sys.dont_write_bytecode = True
    if args.ga_path not in sys.path:
        sys.path.insert(0, args.ga_path)
    loop = BridgeLoop(_tmwebdriver_factory, emit, log=_log_stderr)
    try:
        return loop.run()
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
