"""GA's prints on the bridge's stdout: two kinds of line reach stderr
(main chat ticket 122)."""
from __future__ import annotations

import os
import subprocess
import sys
from io import StringIO
from pathlib import Path

import pytest

from runner.ga_print_forward import (
    MAX_FORWARDED_CHARS,
    GaPrintForwarder,
    scrub_log_text,
)


def _forwarder() -> tuple[GaPrintForwarder, StringIO, StringIO]:
    target, sink = StringIO(), StringIO()
    return GaPrintForwarder(target, sink), target, sink


def test_only_backend_error_and_llm_retry_lines_reach_stderr() -> None:
    out, target, sink = _forwarder()

    print("[LLM Retry] HTTP 503, retry in 3.0s (1/4)", file=out)
    print("User aborted the task.", file=out)
    print("[ERROR] Failed to reload models: config {'apikey': 'x'}", file=out)
    print(
        "Backend Error: RuntimeError: Galley Codex credential refresh failed: timed out "
        "@ llmcore.py:657, _galley_codex_access_token",
        file=out,
    )
    print("  Backend Error: not at the start of the line", file=out)
    print("[LLM Retry]", "ConnectionError, retry in 6.0s (2/4)", file=out)

    assert target.getvalue().splitlines() == [
        "[LLM Retry] HTTP 503, retry in 3.0s (1/4)",
        "Backend Error: RuntimeError: Galley Codex credential refresh failed: timed out "
        "@ llmcore.py:657, _galley_codex_access_token",
        "[LLM Retry] ConnectionError, retry in 6.0s (2/4)",
    ]
    assert sink.getvalue() == ""


def test_a_line_is_forwarded_once_its_newline_arrives() -> None:
    """GA's `print` writes the text and the newline separately, and a line
    may arrive in smaller pieces still."""
    out, target, _ = _forwarder()

    out.write("Back")
    out.write("end Err")
    out.write("or: TimeoutError: timed out")
    out.flush()
    assert target.getvalue() == ""

    out.write("\n[LLM ")
    assert target.getvalue() == "Backend Error: TimeoutError: timed out\n"
    out.write("Retry] Timeout, retry in 12.0s (3/4)\nnoise without a newline")
    out.write(" yet\nB")
    out.write("ack to noise\n")

    assert target.getvalue().splitlines() == [
        "Backend Error: TimeoutError: timed out",
        "[LLM Retry] Timeout, retry in 12.0s (3/4)",
    ]


def test_a_long_dropped_line_is_not_buffered() -> None:
    out, target, _ = _forwarder()

    for _ in range(1000):
        out.write("x" * 1000)
    assert out._line == ""  # dropped as soon as its start says so
    out.write("\n")
    assert target.getvalue() == ""


def test_a_forwarded_line_is_cut_to_length() -> None:
    out, target, _ = _forwarder()

    out.write("Backend Error: " + "a " * 5000 + "\n")

    (line,) = target.getvalue().splitlines()
    assert len(line) == MAX_FORWARDED_CHARS
    assert line.endswith("…")


def test_a_forwarded_line_is_scrubbed() -> None:
    out, target, _ = _forwarder()

    print(
        "Backend Error: ConnectionError: HTTPSConnectionPool(host='relay.example', "
        "port=443): Max retries exceeded with url: /v1/chat?key=AIzaFAKEFAKEFAKEFAKEFAKE1234 "
        "(Authorization: Bearer abcdefgh12345678)",
        file=out,
    )

    line = target.getvalue()
    assert "AIza" not in line
    assert "abcdefgh12345678" not in line
    assert "/v1/chat?[redacted]" in line
    assert "Bearer [redacted]" in line
    assert "host='relay.example'" in line


def test_everything_but_writing_is_the_sinks() -> None:
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        out = GaPrintForwarder(StringIO(), devnull)
        assert out.fileno() == devnull.fileno()
        assert out.encoding == "utf-8"
        assert out.isatty() is False


def test_a_closed_stderr_is_not_an_error() -> None:
    target = StringIO()
    out = GaPrintForwarder(target, StringIO())
    target.close()

    print("Backend Error: RuntimeError: x", file=out)


@pytest.mark.parametrize(
    ("raw", "scrubbed"),
    [
        (
            "https://user:hunter2@relay.example/v1?api_key=sk-x&model=y",
            "https://[redacted]@relay.example/v1?[redacted]",
        ),
        ("Authorization: Bearer eyJhbGciOi.payloadpart.sig", "Authorization: Bearer [redacted]"),
        ('{"access_token": "abc123xyz"}', '{"access_token": "[redacted]"}'),
        ("api-key=k3y-value; next", "api-key=[redacted]; next"),
        ("key sk-ant-api03-FAKEFAKEFAKEFAKE in text", "key [redacted] in text"),
        (
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl end",
            "jwt [redacted] end",
        ),
        ("run 0123456789abcdef0123456789abcdef01234567 end", "run [redacted] end"),
        # Ordinary words and numbers stay.
        (
            "max_tokens=4096, HTTP 503, retry in 3.0s (1/4) @ llmcore.py:657",
            "max_tokens=4096, HTTP 503, retry in 3.0s (1/4) @ llmcore.py:657",
        ),
        (
            "Galley Codex credential refresh failed: credential IPC rejected request "
            "(invalid_args: chatgpt_plan_reauth_required: sign in again)",
            "Galley Codex credential refresh failed: credential IPC rejected request "
            "(invalid_args: chatgpt_plan_reauth_required: sign in again)",
        ),
        (
            "_galley_codex_access_token_and_a_long_identifier",
            "_galley_codex_access_token_and_a_long_identifier",
        ),
    ],
)
def test_scrub_log_text(raw: str, scrubbed: str) -> None:
    assert scrub_log_text(raw) == scrubbed


def test_bridge_stdout_forwards_the_two_kinds_and_fd_one_stays_devnull() -> None:
    """In a real process: after `_silence_python_stdout`, fd 1 is
    /dev/null, the IPC handle alone reaches the real stdout, and of GA's
    prints only the two kinds reach stderr."""
    script = (
        "import os, subprocess, sys\n"
        "import runner.workbench_bridge as wb\n"
        "real = wb._capture_real_stdout()\n"
        "wb._silence_python_stdout()\n"
        "assert os.path.samestat(os.fstat(1), os.stat(os.devnull))\n"
        "assert os.path.samestat(os.fstat(sys.stdout.fileno()), os.stat(os.devnull))\n"
        "os.write(1, b'Backend Error: RAW-FD\\n')\n"
        "subprocess.run([sys.executable, '-c', 'print(\"Backend Error: CHILD\")'],\n"
        "               stdout=sys.stdout, check=True)\n"
        "print('PYTHON-GARBAGE')\n"
        "print('Backend Error: RuntimeError: boom')\n"
        "sys.stdout.write('[LLM Retry] HTTP 429')\n"
        "sys.stdout.write(', retry in 3.0s (1/4)\\n')\n"
        "real.write('CLEAN\\n')\n"
        "real.flush()\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        cwd=str(Path(__file__).resolve().parents[2]),
        timeout=60,
    )
    assert result.returncode == 0, result.stderr.decode()
    assert result.stdout == b"CLEAN\n"
    assert result.stderr.decode().splitlines() == [
        "Backend Error: RuntimeError: boom",
        "[LLM Retry] HTTP 429, retry in 3.0s (1/4)",
    ]
