"""End-to-end test: spawn a real bridge subprocess and run a real LLM round-trip.

Marked @pytest.mark.e2e so the default `pytest` invocation skips it. Run
explicitly:

    pytest -m e2e

Costs a small amount of LLM API quota per run (one minimal completion).

Environment:
    GA_PATH         path to GenericAgent install (default ~/Documents/GenericAgent)
    BRIDGE_PYTHON   Python interpreter used to spawn the bridge subprocess.
                    Must be one that can `import` GA's runtime deps
                    (anthropic / openai / lark_oapi etc). Defaults to
                    sys.executable; override if pytest runs in a venv that
                    doesn't have GA deps installed.
    E2E_LLM_NAME    optional substring match for the LLM to use during e2e
                    runs, e.g. "glm-5.1". Lets maintainers spend quota on a
                    known test model without editing mykey.py.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GA_PATH = os.environ.get("GA_PATH") or str(Path.home() / "Documents" / "GenericAgent")
BRIDGE_PYTHON = os.environ.get("BRIDGE_PYTHON") or sys.executable
E2E_LLM_NAME = os.environ.get("E2E_LLM_NAME", "").strip().lower()

# A minimal user message designed to keep the round-trip short and cheap.
PING_PROMPT = "Reply with exactly the single word: pong"

E2E_READY_TIMEOUT = 30.0       # GA + LLM session init can be slow on first run
E2E_RUN_TIMEOUT = 180.0        # full LLM round-trip, generous for slow networks
E2E_LINE_TIMEOUT = 30.0        # max wait between consecutive events

pytestmark = pytest.mark.e2e


def _llm_matches(llm: dict[str, Any], needle: str) -> bool:
    haystack = f"{llm.get('name', '')} {llm.get('displayName', '')}".lower()
    return needle in haystack


def _ready(bridge_proc: _BridgeProc) -> dict[str, Any]:
    """Read ready and optionally switch to E2E_LLM_NAME before a test run.

    Real e2e runs depend on whichever model is current in the user's GA config.
    `E2E_LLM_NAME=glm-5.1` lets maintainers spend quota on a known generous
    plan without editing `mykey.py` or relying on the default model.
    """
    ready = bridge_proc.next_event(timeout=E2E_READY_TIMEOUT)
    assert ready["kind"] == "ready", f"unexpected first event: {ready}"

    if not E2E_LLM_NAME:
        return ready

    llms = ready.get("availableLLMs") or []
    target = next((llm for llm in llms if _llm_matches(llm, E2E_LLM_NAME)), None)
    if not target:
        pytest.fail(f"E2E_LLM_NAME={E2E_LLM_NAME!r} not found in availableLLMs")

    if not target.get("isCurrent"):
        bridge_proc.send({"kind": "set_llm", "llmIndex": target["index"]})
        changed = bridge_proc.next_event(timeout=10)
        assert changed["kind"] == "llm_changed", changed
        assert changed["index"] == target["index"], changed

        for llm in llms:
            llm["isCurrent"] = llm.get("index") == target["index"]

    return ready


# ---------------- Subprocess + reader thread ----------------


class _BridgeProc:
    """Wraps a bridge subprocess with a stdout reader thread feeding a queue."""

    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self.proc = proc
        self.events: queue.Queue[dict[str, Any]] = queue.Queue()
        self._stderr_chunks: list[str] = []
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._err_reader = threading.Thread(target=self._read_stderr, daemon=True)
        self._reader.start()
        self._err_reader.start()

    def _read_stdout(self) -> None:
        assert self.proc.stdout is not None
        for line in iter(self.proc.stdout.readline, ""):
            line = line.strip()
            if not line:
                continue
            try:
                self.events.put(json.loads(line))
            except json.JSONDecodeError:
                self.events.put({"kind": "_unparseable", "raw": line})

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in iter(self.proc.stderr.readline, ""):
            self._stderr_chunks.append(line)

    def stderr_so_far(self) -> str:
        return "".join(self._stderr_chunks)

    def send(self, cmd: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()

    def next_event(self, timeout: float) -> dict[str, Any]:
        try:
            return self.events.get(timeout=timeout)
        except queue.Empty as e:
            rc = self.proc.poll()
            err = self.stderr_so_far()
            raise AssertionError(
                f"timed out after {timeout}s waiting for event "
                f"(proc rc={rc}, stderr tail: {err[-500:]!r})"
            ) from e

    def shutdown(self) -> None:
        if self.proc.poll() is None:
            try:
                self.send({"kind": "shutdown"})
            except Exception:
                pass
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


@pytest.fixture
def bridge_proc() -> Iterator[_BridgeProc]:
    if not Path(GA_PATH).is_dir():
        pytest.skip(f"GA_PATH not found: {GA_PATH}")

    env = os.environ.copy()
    # The subprocess will `import runner.workbench_bridge`, which needs the
    # repo root on its module search path.
    env["PYTHONPATH"] = (
        str(REPO_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    ).rstrip(os.pathsep)

    proc = subprocess.Popen(
        [
            BRIDGE_PYTHON,
            "-m", "runner.workbench_bridge",
            "--ga-path", GA_PATH,
            "--session-id", "test_e2e_sess",
        ],
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    bp = _BridgeProc(proc)
    try:
        yield bp
    finally:
        bp.shutdown()


# ---------------- Tests ----------------


def test_bridge_starts_and_emits_ready(bridge_proc: _BridgeProc) -> None:
    ev = _ready(bridge_proc)
    assert ev["sessionId"] == "test_e2e_sess"
    assert ev["protocolVersion"] == "0.1"
    assert ev["pid"] > 0
    assert ev["gaCommit"], "gaCommit missing"
    assert isinstance(ev.get("availableLLMs"), list)
    assert ev["availableLLMs"], "availableLLMs should not be empty"
    current = [llm for llm in ev["availableLLMs"] if llm.get("isCurrent")]
    assert len(current) == 1, "exactly one LLM must be marked isCurrent"
    for llm in ev["availableLLMs"]:
        assert "index" in llm and "name" in llm and "displayName" in llm


def test_set_llm_switches_active_model(bridge_proc: _BridgeProc) -> None:
    """If the user's mykey.py exposes 2+ LLMs, switching should work and
    emit llm_changed. With only 1 LLM configured, this test skips."""
    ready = _ready(bridge_proc)
    llms = ready["availableLLMs"]
    if len(llms) < 2:
        pytest.skip(f"need >=2 LLMs to test switching; user has {len(llms)}")

    current_idx = next(llm["index"] for llm in llms if llm["isCurrent"])
    target_idx = next(llm["index"] for llm in llms if llm["index"] != current_idx)

    bridge_proc.send({"kind": "set_llm", "llmIndex": target_idx})

    ev = bridge_proc.next_event(timeout=10)
    assert ev["kind"] == "llm_changed", ev
    assert ev["index"] == target_idx
    assert ev["name"]
    assert ev["displayName"]


def test_bridge_full_message_round_trip(bridge_proc: _BridgeProc) -> None:
    """Send one tiny user message and verify the bridge produces turn_end +
    run_complete with non-empty final content."""
    _ready(bridge_proc)

    bridge_proc.send(
        {
            "kind": "user_message",
            "text": PING_PROMPT,
            "images": [],
        }
    )

    events: list[dict[str, Any]] = []
    deadline = time.monotonic() + E2E_RUN_TIMEOUT
    while time.monotonic() < deadline:
        ev = bridge_proc.next_event(timeout=E2E_LINE_TIMEOUT)
        events.append(ev)
        if ev["kind"] == "run_complete":
            break
    else:
        pytest.fail(f"no run_complete within {E2E_RUN_TIMEOUT}s; events: "
                    f"{[e['kind'] for e in events]}")

    kinds = [e["kind"] for e in events]
    assert "turn_end" in kinds, f"missing turn_end; got {kinds}"
    assert kinds[-1] == "run_complete", f"last event was {kinds[-1]}"

    final = events[-1]["finalContent"]
    assert final, "finalContent should be non-empty"
    # The exact LLM output isn't pinned, but for this prompt we expect
    # something containing 'pong' (case-insensitive).
    assert "pong" in final.lower(), f"unexpected final content: {final!r}"


def test_code_run_executes_directly(bridge_proc: _BridgeProc) -> None:
    """Send a prompt designed to trigger code_run and verify the tool runs
    straight through: the turn carries the tool's real output and the run
    completes on its own, with nothing sent back from the desktop."""
    _ready(bridge_proc)

    marker = "direct-run-ok"
    bridge_proc.send(
        {
            "kind": "user_message",
            "text": (
                "Invoke the code_run tool now with type=python and "
                f"code='print(\"{marker}\")'. Do not just show me the "
                "code; actually call the tool."
            ),
            "images": [],
        }
    )

    events: list[dict[str, Any]] = []
    deadline = time.monotonic() + E2E_RUN_TIMEOUT
    while time.monotonic() < deadline:
        ev = bridge_proc.next_event(timeout=E2E_LINE_TIMEOUT)
        events.append(ev)
        if ev["kind"] == "run_complete":
            break
    else:
        pytest.fail(f"no run_complete within {E2E_RUN_TIMEOUT}s; events: "
                    f"{[e['kind'] for e in events]}")

    code_run_turns = [
        e
        for e in events
        if e["kind"] == "turn_end"
        and any(tc.get("toolName") == "code_run" for tc in e["toolCalls"])
    ]
    if not code_run_turns:
        pytest.skip(
            "LLM did not call code_run on this run; direct execution "
            "couldn't be exercised. Try again or refine the prompt."
        )
    assert any(
        marker in json.dumps(e["toolResults"], ensure_ascii=False)
        for e in code_run_turns
    ), "code_run result did not carry the printed marker"


def test_load_history_restores_context(bridge_proc: _BridgeProc) -> None:
    """Inject a fake prior conversation, then ask a follow-up that depends
    on it. If the LLM answers correctly, history injection works."""
    _ready(bridge_proc)

    bridge_proc.send(
        {
            "kind": "load_history",
            "messages": [
                {"role": "user", "content": "请记住一个数字：1729"},
                {"role": "assistant", "content": "好的，我已经记住数字 1729。"},
            ],
        }
    )
    loaded = bridge_proc.next_event(timeout=10)
    assert loaded["kind"] == "history_loaded", loaded
    assert loaded["messageCount"] == 2

    bridge_proc.send(
        {
            "kind": "user_message",
            "text": "我刚才让你记住的数字是多少？只回答这个数字，不要其他内容。",
            "images": [],
        }
    )

    deadline = time.monotonic() + E2E_RUN_TIMEOUT
    final: str | None = None
    while time.monotonic() < deadline:
        ev = bridge_proc.next_event(timeout=E2E_LINE_TIMEOUT)
        if ev["kind"] == "run_complete":
            final = ev["finalContent"]
            break
    else:
        pytest.fail("no run_complete")

    assert final is not None
    # If history injection works, "1729" should be in the response. If it
    # isn't, our load_history mapping needs refinement (PRD §10 open item).
    assert "1729" in final, (
        f"history did not restore: agent did not recall the number. "
        f"finalContent: {final!r}"
    )


def test_abort_synthesizes_run_complete(bridge_proc: _BridgeProc) -> None:
    """Start a long-form generation, abort mid-stream, expect ABORTED."""
    _ready(bridge_proc)

    bridge_proc.send(
        {
            "kind": "user_message",
            "text": (
                "Please write a detailed 2000-word essay on the history of "
                "computing, in English. Be very thorough."
            ),
            "images": [],
        }
    )

    # Give the worker a moment to start streaming LLM tokens.
    # GA checks stop_sig at every chunk yield, so abort takes effect on
    # the next chunk after it's set.
    time.sleep(2.0)

    bridge_proc.send({"kind": "abort"})

    # Expect run_complete with exitReason.result == "ABORTED" (synthesized
    # by bridge since GA's break path doesn't fire turn_end_callback).
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        ev = bridge_proc.next_event(timeout=E2E_LINE_TIMEOUT)
        if ev["kind"] == "run_complete":
            assert ev["exitReason"]["result"] == "ABORTED", ev
            return
    pytest.fail("no run_complete with ABORTED")
