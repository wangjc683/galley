"""Parent-process watchdog shared by Galley's runner entrypoints.

Both the workbench bridge and the managed IM supervisor run as child
processes of Galley Core and must exit promptly if Core dies — via
``os._exit``, since ``finally`` / ``atexit`` are unreliable once orphaned.
This module owns the cross-platform parent-liveness detection so the two
entrypoints stop keeping byte-drifting copies of the subtle Windows
``OpenProcess`` path.

Entrypoint-specific bits are parameters, not forks:

- ``label``       — process tag in the exit log line.
- ``thread_name`` — the watchdog thread's name.
- ``cleanup``     — best-effort hooks run before the hard exit (e.g. the
                    workbench bridge tears down its desktop-pet child). The
                    iterable is read at exit time, so a live list that other
                    code appends to after the watchdog starts is honored.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from collections.abc import Callable, Iterable

GALLEY_CORE_PID_ENV = "GALLEY_CORE_PID"
PARENT_WATCH_INTERVAL_SEC = 2.0

# Patch point for tests. The real exit deliberately skips finally/atexit.
_EXIT_FOR_PARENT_LOSS = os._exit


def parse_core_pid() -> int | None:
    raw = os.environ.get(GALLEY_CORE_PID_ENV)
    if not raw:
        return None
    try:
        pid = int(raw)
    except ValueError:
        return None
    if pid <= 0 or pid == os.getpid():
        return None
    return pid


def parent_process_alive(pid: int) -> bool:
    if os.name == "nt":  # pragma: no cover - exercised on Windows smoke only
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
            process_query_limited_information = 0x1000
            synchronize = 0x00100000
            wait_timeout = 0x00000102
            handle = kernel32.OpenProcess(
                process_query_limited_information | synchronize,
                False,
                wintypes.DWORD(pid),
            )
            if not handle:
                return False
            try:
                result = int(kernel32.WaitForSingleObject(handle, 0))
                return result == wait_timeout
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def parent_loss_reason(parent_pid: int | None, original_ppid: int | None) -> str | None:
    if parent_pid is None:
        return None
    if not parent_process_alive(parent_pid):
        return f"Galley Core process {parent_pid} disappeared"
    if original_ppid is not None and hasattr(os, "getppid"):
        current_ppid = os.getppid()
        if current_ppid not in {original_ppid, parent_pid}:
            return f"parent process changed from {original_ppid} to {current_ppid}"
    return None


def exit_parentless(
    reason: str,
    *,
    label: str,
    cleanup: Iterable[Callable[[], None]] = (),
) -> None:
    try:
        print(f"[{label}] exiting: {reason}", file=sys.__stderr__, flush=True)
    except Exception:
        pass
    for hook in list(cleanup):
        try:
            hook()
        except Exception:
            pass
    _EXIT_FOR_PARENT_LOSS(0)
    raise SystemExit(0)


def start_parent_watchdog(
    parent_pid: int | None,
    *,
    label: str,
    thread_name: str,
    cleanup: Iterable[Callable[[], None]] = (),
) -> None:
    if parent_pid is None:
        return
    original_ppid = os.getppid() if hasattr(os, "getppid") else None

    def _watch() -> None:
        while True:
            time.sleep(PARENT_WATCH_INTERVAL_SEC)
            reason = parent_loss_reason(parent_pid, original_ppid)
            if reason:
                exit_parentless(reason, label=label, cleanup=cleanup)

    threading.Thread(target=_watch, name=thread_name, daemon=True).start()
