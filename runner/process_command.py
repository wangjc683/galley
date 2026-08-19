"""Shared subprocess spawn flags for Galley-owned runner code.

Mirrors ``core/src/process_command.rs``: Galley Core launches the bridge
with ``CREATE_NO_WINDOW``, so on Windows the bridge has no console. Any
console-subsystem child it spawns (git, cmd, the galley CLI) would then
get a freshly allocated console — a blank flashing CMD window (GitHub
issue #23). Every subprocess call in ``runner/`` must splat
``**no_window_kwargs()``.
"""

from __future__ import annotations

import subprocess
import sys
from typing import Any


def no_window_kwargs() -> dict[str, Any]:
    """Popen/run kwargs that suppress the child console window on Windows.

    Returns an empty dict on other platforms, so call sites can splat it
    unconditionally.
    """
    if sys.platform != "win32":
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = 0  # SW_HIDE
    return {
        "creationflags": subprocess.CREATE_NO_WINDOW,
        "startupinfo": startupinfo,
    }
