"""What GA prints, sorted: two kinds of line reach stderr, the rest is dropped.

The bridge keeps its stdout for IPC events (``workbench_bridge``'s
``_silence_python_stdout``): fd 1 goes to /dev/null, so subprocesses and C
extensions never reach the IPC pipe, and ``sys.stdout`` becomes a
:class:`GaPrintForwarder`. Most of what GA prints there is noise, and some
of it carries config, so it stays dropped. Two kinds of line say why a
request failed and are kept nowhere else (main chat ticket 122):

- ``Backend Error: …``: ``agentmain.run()`` when the task loop raises (the
  2026-11-02 review died on one, a token fetch that timed out);
- ``[LLM Retry] …``: ``llmcore._stream_with_retry`` before each backoff.

Those go to stderr, which Core logs as ``[runner stderr <session>]``. Only
the start of a line counts, a line is forwarded whole once its newline
arrives (GA's ``print`` writes the text and the newline separately), and
it is scrubbed first (:func:`scrub_log_text`). This only changes where
GA's own prints go: it writes no GA file and patches no GA code, so it
holds for an external GA too (constitution rule 1).
"""
from __future__ import annotations

import re
import threading
from typing import IO, Any

FORWARDED_PREFIXES = ("Backend Error", "[LLM Retry]")

# A forwarded line is cut to this many characters after scrubbing; a line
# is buffered up to _MAX_BUFFERED_CHARS while its newline is on the way.
MAX_FORWARDED_CHARS = 1000
_MAX_BUFFERED_CHARS = 4000

_REDACTED = "[redacted]"
_STOP = r"\s'\"<>()\[\]{}"
# `?a=b&c=d`, in a URL or after a bare path (`with url: /v1/x?key=…`).
_QUERY_RE = re.compile(rf"\?[^{_STOP}]*=[^{_STOP}]*")
# `scheme://user:password@host`.
_USERINFO_RE = re.compile(r"(?i)\b([a-z][a-z0-9+.\-]*://)[^\s/@:]+:[^\s/@]+@")
# `Bearer …` / `Basic …`, as in an Authorization header.
_AUTH_SCHEME_RE = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{8,}")
# `api_key=…`, `"access_token": "…"`, `password: …`.
_KEY_VALUE_RE = re.compile(
    r"(?i)\b(api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|id[_-]?token"
    r"|client[_-]?secret|secret|password|passwd|token)"
    r"([\"']?\s*[:=]\s*[\"']?)[^\s\"',;&}]+"
)
# Shapes of a credential on its own: an OpenAI / Anthropic style key, a
# JWT, a Google API key.
_KEY_SHAPE_RE = re.compile(
    r"\bsk-[A-Za-z0-9_\-]{16,}"
    r"|\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]*"
    r"|\bAIza[0-9A-Za-z_\-]{20,}"
)
# Any other run of 40+ token characters that mixes letters and digits.
_LONG_RUN_RE = re.compile(r"[A-Za-z0-9_\-]{40,}")


def _mask_long_run(match: re.Match[str]) -> str:
    run = match.group(0)
    if any(c.isdigit() for c in run) and any(c.isalpha() for c in run):
        return _REDACTED
    return run


def scrub_log_text(text: str) -> str:
    """``text`` without the parts of an error that can carry a credential:
    URL query strings and user info, ``Bearer`` / ``Basic`` values,
    ``key=value`` pairs whose key names a credential, and strings shaped
    like one. Hosts and paths stay: they say which endpoint failed, and
    these lines stay on this machine. Core's ``log_excerpt::scrub`` follows
    the same rules."""
    text = _USERINFO_RE.sub(rf"\1{_REDACTED}@", text)
    text = _QUERY_RE.sub(f"?{_REDACTED}", text)
    text = _AUTH_SCHEME_RE.sub(rf"\1 {_REDACTED}", text)
    text = _KEY_VALUE_RE.sub(rf"\1\2{_REDACTED}", text)
    text = _KEY_SHAPE_RE.sub(_REDACTED, text)
    return _LONG_RUN_RE.sub(_mask_long_run, text)


def _may_be_forwarded(start: str) -> bool:
    """Whether a line that starts with ``start`` is, or may still become,
    one of the forwarded kinds."""
    return any(start.startswith(p) or p.startswith(start) for p in FORWARDED_PREFIXES)


class GaPrintForwarder:
    """``sys.stdout`` of the bridge. Lines that start with one of
    :data:`FORWARDED_PREFIXES` go to ``target`` (stderr), scrubbed and cut
    to :data:`MAX_FORWARDED_CHARS`; everything else is dropped. Anything
    other than writing (``fileno``, ``encoding``, ``buffer``…) is
    ``sink``'s, the /dev/null file ``sys.stdout`` used to be, so a caller
    that hands ``sys.stdout`` to a subprocess still gets /dev/null."""

    def __init__(self, target: IO[str], sink: IO[str]) -> None:
        self._target = target
        self._sink = sink
        self._lock = threading.Lock()
        # The current line so far, while it may still be forwarded.
        self._line = ""
        # The current line is not forwarded: skip to its newline.
        self._dropping = False

    def write(self, text: str) -> int:
        with self._lock:
            pieces = text.split("\n")
            for i, piece in enumerate(pieces):
                if i:
                    self._end_line()
                self._take(piece)
        return len(text)

    def writelines(self, lines: Any) -> None:
        for line in lines:
            self.write(line)

    def flush(self) -> None:
        # Line buffered: a line without its newline yet waits for it.
        return None

    def isatty(self) -> bool:
        return False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._sink, name)

    def _take(self, piece: str) -> None:
        if self._dropping or not piece:
            return
        if len(self._line) < _MAX_BUFFERED_CHARS:
            self._line += piece[: _MAX_BUFFERED_CHARS - len(self._line)]
        if not _may_be_forwarded(self._line):
            self._line, self._dropping = "", True

    def _end_line(self) -> None:
        line, self._line, self._dropping = self._line, "", False
        if not line.startswith(FORWARDED_PREFIXES):
            return
        line = scrub_log_text(line.rstrip("\r"))
        if len(line) > MAX_FORWARDED_CHARS:
            line = line[: MAX_FORWARDED_CHARS - 1] + "…"
        try:
            self._target.write(line + "\n")
            self._target.flush()
        except (OSError, ValueError):
            # Core went away (closed pipe): nothing left to tell.
            pass
