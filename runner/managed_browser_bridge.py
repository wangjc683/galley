"""Galley-managed resident browser bridge.

Core starts this process while the managed runtime is active. It hosts
GenericAgent's own ``TMWebDriver`` master (WebSocket on 127.0.0.1:18765 for
the Chromium extension, HTTP on 18766 for remote clients), so the extension
can connect as soon as the browser runs and every managed GA session becomes
a remote client of it through upstream's existing remote mode. Galley Core
reads the connection state from the JSON lines this process writes on stdout.

Ground rules (docs/managed-ga-runtime/browser-control.md):

- Read-only use of upstream: construct ``TMWebDriver()``, call
  ``get_status()``, and on our own master read the extension connection's
  peer address and set the ``_galley_on_browser_wanted`` hook (managed
  patch ``0035``). Never execute JS in pages; the master only relays the
  GA sessions' own calls. Never write GA files or state.
- Browser auto-open: when the extension connects to our master, look up
  the program on the other end of that connection (``browserApp``). When a
  GA session's web tool finds no tab and no extension, it asks the master
  (``galley_browser_wanted``); the hook answers yes while we know the
  browser and moves ``browserWantedAt``, and Core opens that browser.
- Do not fight over the ports. If another process already serves 18766
  (a GA session that started a master first, a second Galley, an external
  upstream GA), report role ``remote``, read the status through it, and try
  to become master again once it goes away.
- Leave with Core: exit on parent loss (``GALLEY_CORE_PID`` watchdog), on a
  closed status pipe, and on stdin EOF when Core asks for it.

Stdout carries status lines only (camelCase, one JSON object per line):

    {"state":"running","role":"master","extensionConnected":true,"tabCount":2,
     "browserApp":"/Applications/Example.app"|null,"browserWantedAt":"..."|null,...}
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
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from typing import IO, Any

from runner import _watchdog, managed_runtime
from runner.process_command import no_window_kwargs

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
# A web tool asks again on every call while the browser is still coming up:
# inside this window the hook keeps answering yes without moving
# browserWantedAt, so Core opens the browser once.
BROWSER_WANTED_REPEAT_SEC = 30.0
BROWSER_LOOKUP_TIMEOUT_SEC = 5.0


class BridgeFatalError(Exception):
    """The process holds a half-started master and must exit to free it."""


Emit = Callable[..., None]
DriverFactory = Callable[[], Any]
# The extension's local port -> the program Core opens, or None.
BrowserLookup = Callable[[int], "str | None"]


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


# ---- which browser the extension lives in ----


def outermost_app_bundle(executable: str) -> str | None:
    """The outermost ``*.app`` of a macOS executable path.

    The extension's connection is held by a helper nested inside the
    browser (``/Applications/X.app/Contents/Frameworks/…/X Helper.app/
    Contents/MacOS/X Helper``); the program to open is ``/Applications/X.app``.
    """
    if not executable.startswith("/"):
        return None
    parts = executable.split("/")
    for index, part in enumerate(parts):
        if part.endswith(".app") and len(part) > len(".app"):
            return "/".join(parts[: index + 1])
    return None


def _run_capture(args: list[str]) -> str | None:
    try:
        result = subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=BROWSER_LOOKUP_TIMEOUT_SEC,
            **no_window_kwargs(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    # lsof exits 1 when it lists nothing; the output decides either way.
    stdout = result.stdout
    return stdout if isinstance(stdout, str) else None


def _lsof_owner_of_local_port(listing: str, port: int, own_pid: int) -> int | None:
    """The process whose socket has local port ``port`` in ``lsof -Fpn`` output.

    Both ends of the connection match ``-iTCP:<port>``: ours reads
    ``127.0.0.1:18765->127.0.0.1:<port>``, the browser's
    ``127.0.0.1:<port>->127.0.0.1:18765``.
    """
    pid: int | None = None
    for line in listing.splitlines():
        if line.startswith("p"):
            try:
                pid = int(line[1:])
            except ValueError:
                pid = None
        elif line.startswith("n") and pid is not None and pid != own_pid:
            local = line[1:].split("->", 1)[0]
            if local.rsplit(":", 1)[-1] == str(port):
                return pid
    return None


def _macos_peer_executable(
    port: int, *, own_pid: int, run: Callable[[list[str]], str | None]
) -> str | None:
    listing = run(["/usr/sbin/lsof", "-nP", "-w", f"-iTCP:{port}", "-sTCP:ESTABLISHED", "-Fpn"])
    pid = _lsof_owner_of_local_port(listing or "", port, own_pid)
    if pid is None:
        return None
    executable = (run(["/bin/ps", "-p", str(pid), "-o", "comm="]) or "").strip()
    return executable or None


def _windows_peer_executable(port: int, *, own_pid: int) -> str | None:
    """Program path of the process holding the IPv4 connection whose local
    port is ``port`` and remote port is the driver's.

    Edge / Chrome hold it in their network-service process, which runs the
    browser's own ``.exe``, so that path is the program to open. Read from
    the code only; not run on Windows yet.
    """
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    class _TcpRowOwnerPid(ctypes.Structure):
        _fields_ = [
            ("dwState", wintypes.DWORD),
            ("dwLocalAddr", wintypes.DWORD),
            ("dwLocalPort", wintypes.DWORD),
            ("dwRemoteAddr", wintypes.DWORD),
            ("dwRemotePort", wintypes.DWORD),
            ("dwOwningPid", wintypes.DWORD),
        ]

    af_inet = 2
    tcp_table_owner_pid_connections = 4
    error_insufficient_buffer = 122
    process_query_limited_information = 0x1000

    iphlpapi = ctypes.WinDLL("iphlpapi")
    kernel32 = ctypes.WinDLL("kernel32")
    get_table = iphlpapi.GetExtendedTcpTable
    get_table.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.DWORD),
        wintypes.BOOL,
        wintypes.ULONG,
        ctypes.c_int,
        wintypes.ULONG,
    ]
    get_table.restype = wintypes.DWORD

    size = wintypes.DWORD(0)
    table = ctypes.create_string_buffer(4)
    for _ in range(4):
        table = ctypes.create_string_buffer(max(size.value, 4))
        status = get_table(
            table, ctypes.byref(size), False, af_inet, tcp_table_owner_pid_connections, 0
        )
        if status == 0:
            break
        if status != error_insufficient_buffer:
            return None
    else:
        return None
    count = wintypes.DWORD.from_buffer(table).value
    rows = (_TcpRowOwnerPid * count).from_buffer(table, ctypes.sizeof(wintypes.DWORD))
    owner: int | None = None
    for row in rows:
        # Ports sit in the low 16 bits, in network byte order.
        local_port = socket.ntohs(row.dwLocalPort & 0xFFFF)
        remote_port = socket.ntohs(row.dwRemotePort & 0xFFFF)
        if local_port == port and remote_port == DRIVER_PORT and row.dwOwningPid != own_pid:
            owner = int(row.dwOwningPid)
            break
    if owner is None:
        return None

    open_process = kernel32.OpenProcess
    open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    open_process.restype = wintypes.HANDLE
    query_name = kernel32.QueryFullProcessImageNameW
    query_name.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    query_name.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL

    handle = open_process(process_query_limited_information, False, owner)
    if not handle:
        return None
    try:
        name = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(name))
        if not query_name(handle, 0, name, ctypes.byref(length)):
            return None
        return name.value or None
    finally:
        close_handle(handle)


def find_browser_app(port: int) -> str | None:
    """The program to open for the extension connected from local ``port``:
    the outermost ``.app`` on macOS, the ``.exe`` on Windows, ``None``
    elsewhere or when the lookup finds nothing."""
    try:
        if sys.platform == "darwin":
            executable = _macos_peer_executable(port, own_pid=os.getpid(), run=_run_capture)
            return outermost_app_bundle(executable) if executable else None
        if sys.platform == "win32":
            return _windows_peer_executable(port, own_pid=os.getpid())
    except Exception:
        return None
    return None


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
        known_browser_app: str | None = None,
        browser_lookup: BrowserLookup = find_browser_app,
        now_iso: Callable[[], str] = _now_iso,
    ) -> None:
        self._factory = driver_factory
        self._emit = emit
        self._port_listening = port_listening
        self._sleep = sleep
        self._clock = clock
        self._log = log or (lambda _message: None)
        self._browser_lookup = browser_lookup
        self._now_iso = now_iso
        self.driver: Any = None
        self.role: str | None = None
        self._failures = 0
        self._quick_retry_used = False
        self._last: tuple[Any, ...] | None = None
        # The hook runs on the master's HTTP thread; reporting and the
        # browser fields are shared with the status loop.
        self._lock = threading.RLock()
        # Core's stored browser (--known-browser-app) until this run
        # recognises one; browserApp reports only what this run recognised.
        self._known_browser_app = known_browser_app or None
        self.browser_app: str | None = None
        self.browser_wanted_at: str | None = None
        self._wanted_clock: float | None = None
        self._seen_extension: tuple[int, Any] | None = None
        self._running: dict[str, Any] | None = None

    # ---- reporting ----

    def _report(self, payload: dict[str, Any]) -> None:
        with self._lock:
            key = tuple(sorted(payload.items()))
            if key == self._last:
                return
            self._last = key
            self._emit(**payload)

    def _browser_fields(self) -> dict[str, Any]:
        return {"browserApp": self.browser_app, "browserWantedAt": self.browser_wanted_at}

    def _report_status(self, role: str, status: Mapping[str, Any]) -> None:
        try:
            tab_count = max(0, int(status.get("tab_count") or 0))
        except (TypeError, ValueError):
            tab_count = 0
        running = {
            "state": "running",
            "role": role,
            "extensionConnected": bool(status.get("extension_connected")),
            "tabCount": tab_count,
        }
        with self._lock:
            self._running = running
            self._report({**running, **self._browser_fields()})

    def _report_error(self, kind: str, message: str) -> None:
        with self._lock:
            self._running = None
            self._report({"state": "error", "role": self.role, "errorKind": kind, "error": message})

    # ---- browser auto-open ----

    def _notice_extension(self, driver: Any) -> None:
        """On a new extension connection to our master, recognise the
        browser on its other end. ``extension_connected_at`` moves on every
        tab update too, so the connection itself is the key."""
        client = getattr(driver, "extension_client", None)
        if client is None:
            return
        address = getattr(client, "address", None)
        key = (id(client), address)
        if key == self._seen_extension:
            return
        self._seen_extension = key
        with self._lock:
            # The browser came back: a later request is a new one.
            self._wanted_clock = None
        if not isinstance(address, tuple) or len(address) < 2:
            return
        port = address[1]
        if not isinstance(port, int):
            return
        try:
            app = self._browser_lookup(port)
        except Exception as e:
            self._log(f"browser lookup failed: {e!r}")
            return
        if app:
            with self._lock:
                self.browser_app = app

    def on_browser_wanted(self) -> bool:
        """TMWebDriver's ``galley_browser_wanted`` hook, on the master's
        HTTP thread: a GA web tool found no tab and no extension. Yes while
        we are the master, the extension is gone and we know the browser."""
        with self._lock:
            driver = self.driver
            if self.role != ROLE_MASTER or driver is None:
                return False
            if getattr(driver, "extension_client", None) is not None:
                return False
            if not (self.browser_app or self._known_browser_app):
                return False
            now = self._clock()
            if (
                self._wanted_clock is not None
                and now - self._wanted_clock < BROWSER_WANTED_REPEAT_SEC
            ):
                return True
            self._wanted_clock = now
            self.browser_wanted_at = self._now_iso()
            self._log("browser wanted")
            if self._running is not None:
                # The extension is gone even if the loop has not polled yet:
                # Core opens only on a line that says so.
                self._report(
                    {**self._running, "extensionConnected": False, **self._browser_fields()}
                )
            return True

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
        if role == ROLE_MASTER:
            try:
                driver._galley_on_browser_wanted = self.on_browser_wanted
            except Exception as e:
                self._log(f"browser hook not set: {e!r}")
        with self._lock:
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
        if self.role == ROLE_MASTER:
            self._notice_extension(self.driver)
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
        "--known-browser-app",
        default=None,
        help="the browser program Core stored from an earlier run (browserApp)",
    )
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
    loop = BridgeLoop(
        _tmwebdriver_factory,
        emit,
        log=_log_stderr,
        known_browser_app=args.known_browser_app,
    )
    try:
        return loop.run()
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
