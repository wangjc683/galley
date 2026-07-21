"""Galley bridge: connects one GA subprocess to the desktop frontend.

Run as a subprocess. Reads JSON Lines commands on stdin, writes JSON Lines
events on stdout. See docs/ipc-protocol.md for the wire format.

Usage:
    python -m runner.workbench_bridge \\
        --ga-path /Users/me/Documents/GenericAgent \\
        --session-id sess_abc \\
        [--cwd /path/to/project] \\
        [--llm-no 0]

Stdout discipline: GA's tool implementations call print() in places we don't
control (e.g. ga.code_run streaming subprocess output). To keep our JSON
Lines stream clean, we capture the original stdout fd at startup and route
sys.stdout to /dev/null. All bridge events go through self._emit() which
writes to the captured fd.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import IO, Any

from runner import _watchdog, managed_runtime, plan_watch
from runner.ga_session import GaSession
from runner.ipc import (
    PROTOCOL_VERSION,
    AbortCommand,
    ApprovalResponseCommand,
    AskUserEvent,
    AskUserResponseCommand,
    AttachPetCommand,
    Command,
    DetachPetCommand,
    ErrorEvent,
    HistoryLoadedEvent,
    IPCProtocolError,
    LLMChangedEvent,
    LoadHistoryCommand,
    PetAttachedEvent,
    PetDetachedEvent,
    PlanUpdateEvent,
    ReadyEvent,
    ReinjectToolsCommand,
    RunCompleteEvent,
    SetApprovalRulesCommand,
    SetLLMCommand,
    SetYoloModeCommand,
    ShutdownCommand,
    SystemMessageEvent,
    ToolCallPendingEvent,
    ToolsReinjectedEvent,
    TurnEndEvent,
    TurnProgressEvent,
    TurnStartEvent,
    UserMessageCommand,
    decode_command,
    encode,
)

# ---------------- Stdout capture ----------------


def _capture_real_stdout() -> IO[str]:
    """Duplicate fd 1 so we can keep a clean output channel even after we
    redirect sys.stdout into /dev/null to silence GA's print() calls."""
    fd = os.dup(1)
    return os.fdopen(fd, "w", encoding="utf-8", buffering=1)  # line-buffered


def _silence_python_stdout() -> None:
    """Silence stdout at BOTH layers; must run after _capture_real_stdout().

    Rebinding sys.stdout catches GA's print() calls, but OS-level fd 1
    would still point at the IPC pipe: subprocesses spawned by GA tools
    inherit it, and C extensions write to it directly — either injects
    garbage lines that corrupt the whole session's event framing. dup2
    /dev/null over fd 1 so only the captured handle can reach the pipe.
    """
    devnull_fd = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull_fd, 1)
    finally:
        os.close(devnull_fd)
    sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115


# ---------------- Cleanup helpers (mirror frontends/chatapp_common.py spirit) ----------------


_TAG_PATS = [
    r"<" + t + r">.*?</" + t + r">"
    for t in ("thinking", "summary", "tool_use", "file_content")
]
_FILE_REF_RE = re.compile(r"\[FILE:[^\]]+\]")


def _clean_response_for_display(text: str) -> str:
    if not text:
        return ""
    cleaned = text
    for pat in _TAG_PATS:
        cleaned = re.sub(pat, "", cleaned, flags=re.DOTALL)
    cleaned = _FILE_REF_RE.sub("", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _to_json_safe(obj: Any) -> Any:
    """Recursively coerce a value into JSON-serializable form.

    GA hands us its internal response/StepOutcome objects (e.g. exit_reason.data
    holds the LLM response object after a no_tool turn). Those aren't JSON
    serializable; we stringify the leaves so the wire format stays clean.
    """
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [_to_json_safe(x) for x in obj]
    return str(obj)


def _compact_args(args: dict[str, Any], max_len: int = 200) -> str:
    cleaned = {k: v for k, v in args.items() if not k.startswith("_")}
    s = json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))
    if len(s) > max_len:
        s = s[: max_len - 3] + "..."
    return s


_managed_model_config_from_env = managed_runtime.managed_model_config_from_env

_USAGE_FIELDS = ("requests", "input", "output", "cache_create", "cache_read")


# Best-effort cleanup hooks run before the parent-loss hard exit (see
# runner/_watchdog.py). os._exit skips finally blocks and atexit handlers,
# so child processes (the desktop pet) must be torn down explicitly or they
# leak. Passed to the watchdog as its `cleanup` iterable; read at exit time
# so pet-attach appends after the watchdog starts are still honored.
_PARENT_LOSS_CLEANUP: list[Any] = []


def _llm_display_name(raw: str) -> str:
    """Return the display name to send over Galley's IPC protocol.

    External GA is for users who own and debug their GenericAgent setup, so
    Galley exposes the raw GA name verbatim. Managed GA is Galley-owned: the
    injected backend name already is the configured display name, or the exact
    model id when no display name was set.
    """
    if managed_runtime.is_managed_runtime():
        return raw.split("/", 1)[1] if "/" in raw else raw
    return raw


# Keyword patterns for hint inference. Match in order; first hit wins.
# Patterns are case-insensitive substring matches against the error message.
# See docs/ipc-protocol.md §4.10 for the hint contract; DESIGN.md §6.2 for
# the Error Card variants the desktop renders for each hint.
_ERROR_HINT_PATTERNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "check_llm_config",
        (
            "api_key",
            "api key",
            "unauthorized",
            "authentication",
            "invalid key",
            "401",
            "403",
        ),
    ),
    (
        "quota_exceeded",
        ("quota", "rate limit", "rate_limit", "429", "too many requests"),
    ),
    (
        "network",
        (
            "connection refused",
            "timeout",
            "timed out",
            "dns",
            "network is unreachable",
            "connection reset",
        ),
    ),
)


def _classify_error(message: str, category: str) -> tuple[str | None, bool]:
    """Classify an error message into (hint, retryable) for ErrorEvent.

    Only runtime errors get hints — those are the user-facing failure modes
    worth translating ("401 Unauthorized" -> "check your mykey.py"). Bridge
    and business errors fall through to the standard Error Card without a
    hint.

    Returns (hint, retryable). retryable defaults to True for runtime
    errors (the user can plausibly try again, possibly with a fix);
    False for bridge / business errors (those are bugs or invalid input
    that retrying wouldn't change).
    """
    if category != "runtime":
        return None, False
    msg_lower = message.lower()
    for hint, keywords in _ERROR_HINT_PATTERNS:
        if any(kw in msg_lower for kw in keywords):
            return hint, True
    return None, True


def _resolve_ga_commit(ga_path: str) -> tuple[str, str]:
    """Return (commit_hash, commit_iso_date) for the GA install at ga_path.

    Both default to ``"unknown"`` when ga_path is not a git checkout (e.g.
    a tarball/zip download). Desktop renders that gracefully — Settings →
    Runtime shows ``GA 版本: unknown`` and skips the baseline-comparison
    row. Surfaces this in a single subprocess call when possible so the
    `ready` event isn't slowed by two separate git invocations.
    """
    import subprocess

    if managed_runtime.is_managed_runtime():
        try:
            manifest_path = Path(ga_path).resolve().parent / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            upstream = manifest.get("upstream") or {}
            return (
                str(upstream.get("commit") or "unknown"),
                str(upstream.get("auditedAt") or "unknown"),
            )
        except Exception:
            return "unknown", "unknown"

    try:
        root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=ga_path,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        if Path(root).resolve() != Path(ga_path).resolve():
            return "unknown", "unknown"
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%H%n%cI"],
            cwd=ga_path,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        lines = out.strip().splitlines()
        if len(lines) >= 2:
            return lines[0].strip(), lines[1].strip()
        if len(lines) == 1:
            return lines[0].strip(), "unknown"
        return "unknown", "unknown"
    except Exception:
        return "unknown", "unknown"


# ---------------- Fence filter ----------------


class _FenceFilter:
    """Stateful stream filter that hides content between GA's
    5-backtick fence markers (`\\`\\`\\`\\`\\`\\n` ... `\\`\\`\\`\\`\\`\\n`) before it
    crosses the IPC wire.

    With `agent.verbose = True` GA's `agent_loop.py:79-81` wraps every
    tool dispatch's stdout in those fences:

        `````
        [Action] Running python in temp: ...
        <subprocess stdout, potentially thousands of chars>
        `````

    Desktop already strips this content from `inFlightContent` before
    rendering (see lib/ipc-handlers.ts `FIVE_BACKTICK_BLOCK`), so
    forwarding it just burns IPC bandwidth, React re-renders, and
    quadratic-time regex passes over a growing buffer. Filtering at
    the bridge eliminates the waste end-to-end.

    State per task: one instance per `_start_progress_drain` call
    (each `put_task` gets a fresh drain thread). Carries up to
    `len(FENCE) - 1` chars across deltas so a fence marker split
    by a chunk boundary still resolves correctly.

    The marker itself is also dropped — it's GA's terminal-frontend
    chrome, not user-facing content.
    """

    FENCE = "`````\n"

    def __init__(self) -> None:
        self.inside = False
        # Trailing bytes from the previous delta that could be the
        # start of a fence marker. Capped at len(FENCE) - 1 chars.
        self.carry = ""

    def feed(self, delta: str) -> str:
        """Process one delta; return the part to emit over IPC.

        Outside-fence content passes through unchanged. Fence markers
        themselves and inside-fence content are dropped. Trailing
        bytes that could be the prefix of a fence marker are held
        back as `carry` for the next call.
        """
        text = self.carry + delta
        self.carry = ""
        parts: list[str] = []
        i = 0
        while True:
            j = text.find(self.FENCE, i)
            if j != -1:
                # Complete fence marker at position j; flip state.
                if not self.inside:
                    parts.append(text[i:j])
                self.inside = not self.inside
                i = j + len(self.FENCE)
                continue
            # No more complete markers. Stash a potential partial
            # marker at the end for next call so we don't accidentally
            # emit the start of a fence as content.
            remaining = text[i:]
            suffix_len = 0
            max_suffix = min(len(self.FENCE) - 1, len(remaining))
            for n in range(max_suffix, 0, -1):
                if self.FENCE.startswith(remaining[-n:]):
                    suffix_len = n
                    break
            if suffix_len > 0:
                self.carry = remaining[-suffix_len:]
                emit_end = len(text) - suffix_len
            else:
                emit_end = len(text)
            if not self.inside and emit_end > i:
                parts.append(text[i:emit_end])
            break
        return "".join(parts)

    def flush(self) -> str:
        """Stream ended: a held-back partial fence marker was real
        content after all (nothing can extend it into a marker now).
        Inside-fence carry stays dropped — it was being hidden anyway."""
        out = "" if self.inside else self.carry
        self.carry = ""
        return out


# ---------------- Pending approval ----------------


class _PendingApproval:
    """Single pending approval slot. Worker thread waits on event, command
    thread sets decision and signals."""

    __slots__ = ("event", "decision")

    def __init__(self) -> None:
        self.event = threading.Event()
        self.decision: str | None = None


class SessionState:
    """Owns rule sets and pending approvals at session scope."""

    def __init__(self) -> None:
        self.always_allow_global: set[str] = set()
        self.always_allow_project: set[str] = set()
        # YOLO mode (PRD §11.5). Default off; desktop syncs the user's
        # persisted preference via SetYoloModeCommand right after `ready`.
        # Read by WorkbenchHandler.needs_approval through the yolo_check
        # closure on every dispatch — toggling here takes effect on the
        # very next tool call.
        self.yolo_mode: bool = False
        self._pending: dict[str, _PendingApproval] = {}
        self._lock = threading.Lock()

    def register_pending(self, approval_id: str) -> _PendingApproval:
        p = _PendingApproval()
        with self._lock:
            self._pending[approval_id] = p
        return p

    def resolve_pending(self, approval_id: str, decision: str) -> bool:
        with self._lock:
            p = self._pending.pop(approval_id, None)
        if p is None:
            return False
        p.decision = decision
        p.event.set()
        return True

    def resolve_all_pending(self, decision: str) -> int:
        """Resolve every pending approval at once. Abort/shutdown must
        call this: the agent thread blocks inside _request_approval's
        event.wait() *within* the dispatch generator, so agent.abort()
        alone cannot reach it — without a decision the thread stays
        wedged for up to APPROVAL_WAIT_SECS."""
        with self._lock:
            drained = list(self._pending.values())
            self._pending.clear()
        for p in drained:
            p.decision = decision
            p.event.set()
        return len(drained)


# ---------------- Bridge runtime ----------------


class Bridge:
    """One bridge process's runtime state and main loop."""

    APPROVAL_WAIT_SECS = 600  # 10 min default; agent's deny on timeout

    @property
    def ga(self) -> GaSession:
        """The GA-internals seam (see ga_session.py). A property over
        `self.agent` so tests that swap in a fake agent get a matching
        adapter for free — no stale binding to keep in sync."""
        return GaSession(self.agent)

    def __init__(
        self,
        ga_path: str,
        session_id: str,
        cwd: str | None,
        llm_no: int,
        llm_name: str | None,
        stdout: IO[str],
        stdin: IO[str],
        workspace_root: str | None = None,
    ) -> None:
        self.ga_path = ga_path
        self.session_id = session_id
        self.cwd = cwd
        self.workspace_root = workspace_root
        self.llm_no = llm_no
        self.llm_name = llm_name
        self._stdout = stdout
        self._stdin = stdin
        self.state = SessionState()
        # None is the writer-exit sentinel: everything enqueued before it
        # is guaranteed written + flushed before the writer thread ends.
        self.event_queue: queue.Queue[str | None] = queue.Queue()
        self.command_queue: queue.Queue[Command] = queue.Queue()
        self.shutdown_event = threading.Event()
        self.run_in_progress = threading.Event()
        self.current_turn: int = 0
        self._current_message_visibility: str = "visible"
        self._current_message_turn_base: int | None = None
        self._agent_thread_name = f"galley-agent-{self.session_id}"
        self._current_run_started_at: float | None = None
        self._current_run_started_wall_at: float | None = None
        self._current_usage_baseline: dict[str, int] | None = None
        self._cost_tracker: Any = None
        # turn_start dedupe state. Two emitters share this:
        #   1. WorkbenchHandler dispatch wrapper (real-time, fires when
        #      GA enters tool dispatch for the current turn).
        #   2. _on_turn_end's predict-emit (fires turn_start(turn+1)
        #      right after the just-finished turn's TurnEndEvent, so
        #      the sidebar updates immediately instead of waiting
        #      several seconds for the next turn's LLM call to
        #      complete and tool dispatch to begin).
        # Reset to 0 on every put_task (new agent_runner_loop = turn
        # counter restarts at 1) so dedupe doesn't accidentally
        # suppress the first turn_start of a new run.
        self._last_emitted_turn: int = 0
        # Resolved during start():
        self.agent: Any = None
        self.agentmain: Any = None
        self._btw_handler: Any = None
        # Plan-mode observer (read-only; see runner/plan_watch.py).
        # Lazy-imports GA's plan_state at first snapshot, after
        # _setup_ga has put <ga_path>/frontends on sys.path.
        self._plan_watcher = plan_watch.PlanWatcher()
        # Desktop Pet subprocess handle (when attached). None when not
        # running. Only one pet can be attached at a time per bridge —
        # and effectively globally across all bridges, because the pet
        # binds a fixed local port (default 41983). Re-attaching while
        # one is already running first detaches the old.
        self._pet_process: Any = None
        self._pet_port: int = 0
        # Serializes the run-completion check-emit-clear across threads:
        # natural turn_end (agent thread), Abort (command thread), and
        # slash-command done (drain thread) can otherwise interleave and
        # double-emit run_complete with an already-cleared telemetry base.
        self._run_complete_lock = threading.Lock()
        # The parent watchdog exits with os._exit, which skips finally
        # blocks and atexit — an attached pet would survive as an orphan
        # holding its fixed port (and Galley Core is already gone, so
        # nothing else cleans it up). Register best-effort cleanup.
        _PARENT_LOSS_CLEANUP.append(lambda: self._handle_detach_pet(silent=True))

    def _current_absolute_turn_index(self, turn_index: int) -> int | None:
        if self._current_message_turn_base is None:
            return None
        return self._current_message_turn_base + max(0, turn_index - 1)

    # ---------------- Lifecycle ----------------

    def start(self) -> None:
        self._setup_ga()
        self._install_handler_subclass()
        self._register_turn_end_hook()
        threading.Thread(
            target=self.agent.run,
            name=self._agent_thread_name,
            daemon=True,
        ).start()
        self._emit_ready()

    def _setup_ga(self) -> None:
        if self.ga_path not in sys.path:
            sys.path.insert(0, self.ga_path)
        # GA's `frontends/` directory holds modules that GA's own
        # frontends import flat (e.g. `import btw_cmd`) rather than
        # `frontends.btw_cmd`. There's no __init__.py there. We add
        # the directory to sys.path so the bridge can pull these
        # frontend helpers (currently: btw_cmd; future: possibly
        # continue_cmd).
        #
        # Coupling point (AGENTS.md constitution §"Non-Invasive To GenericAgent"):
        # `<ga_path>/frontends/` layout is GA-owned; re-audit at
        # each baseline upgrade. An absent btw_cmd is handled
        # below in the try/except — the bridge stays functional.
        frontends_dir = os.path.join(self.ga_path, "frontends")
        if frontends_dir not in sys.path:
            sys.path.insert(0, frontends_dir)
        managed_state_root = managed_runtime.managed_state_root()
        if managed_runtime.is_managed_runtime():
            if not managed_state_root:
                raise RuntimeError("managed runtime missing GALLEY_GA_STATE_ROOT")
            self._install_managed_mykey_loader()
            self._install_managed_usage_tracker()
            for rel in ("memory", "sop", "skills", "temp", "temp/model_responses"):
                os.makedirs(os.path.join(managed_state_root, rel), exist_ok=True)
        if self.cwd:
            os.chdir(self.cwd)
        elif managed_runtime.is_managed_runtime() and managed_state_root:
            os.chdir(managed_state_root)
        else:
            # Default to GA's own dir so agentmain finds its assets/.
            os.chdir(self.ga_path)

        import agentmain

        self.agentmain = agentmain
        self.agent = agentmain.GeneraticAgent()
        self.agent.next_llm(self._initial_llm_index())
        if managed_runtime.is_managed_runtime():
            self._install_managed_prompt_profile()
        self._activate_project_workspace()
        # verbose=True enables GA's incremental LLM display streaming
        # (`yield from response_gen` in agent_loop.py). With it off,
        # agent_loop drains the LLM generator silently and yields the
        # full response only at turn end — the conversation reads as
        # "long wait → big drop of text", losing the live-typing UX.
        # The cost is a handful of decorative yields (verbose tool
        # marker block + 5-backtick fences around tool output) that
        # leak into display_queue; desktop's cleanPartialContent
        # strips them before rendering.
        self.agent.verbose = True
        # Push only the new substring on each display_queue tick rather
        # than the full accumulated response. Smaller IPC payloads, and
        # desktop accumulates deltas into its own inFlightContent
        # (mirrors what fsapp.py does — agentmain default is False
        # which would re-send the whole response every chunk).
        self.agent.inc_out = True

        # `/btw` side-question support. GA's btw_cmd module ships two
        # entry points: `install()` patches the agent's task-queue
        # dispatch (which queues /btw behind the currently-running
        # task — defeats the "non-blocking side question" UX), and
        # `handle_frontend_command()` is a synchronous entry that
        # calls `backend.raw_ask` directly. We use the latter and
        # bypass the agent.run() queue entirely (see
        # _handle_user_message_command) so /btw is genuinely
        # interruption-free.
        #
        # Stash the handle so the user_message path can call it
        # without re-importing on every command. None when the
        # module isn't bundled with the user's GA install (older
        # baselines / partial checkouts) — /btw degrades gracefully
        # to a plain prompt rather than 500-ing.
        self._btw_handler = None
        try:
            import btw_cmd  # type: ignore[import-not-found]

            self._btw_handler = btw_cmd.handle_frontend_command
        except ImportError:
            self._emit_error(
                "GA's btw_cmd module not found — /btw side-question "
                "will be treated as a regular prompt.",
                None,
                category="bridge",
                severity="warning",
                context="setup_ga",
            )

    def _initial_llm_index(self) -> int:
        if not self.llm_name:
            return self.llm_no
        try:
            for index, name, _ in self.agent.list_llms():
                if name == self.llm_name:
                    return int(index)
        except Exception as e:
            print(f"Could not resolve LLM name {self.llm_name!r}: {e}", file=sys.stderr)
        print(
            f"LLM name {self.llm_name!r} is no longer available; falling back to default",
            file=sys.stderr,
        )
        return 0

    def _install_managed_mykey_loader(self) -> None:
        managed_runtime.install_managed_mykey_loader()

    def _install_managed_usage_tracker(self) -> None:
        """Install GA's official token tracker for Galley-owned runtime only."""
        try:
            import cost_tracker  # type: ignore[import-not-found]

            cost_tracker.install()
            self._cost_tracker = cost_tracker
        except Exception as e:
            self._cost_tracker = None
            print(
                f"Managed token tracker unavailable: {e}",
                file=sys.stderr,
            )

    def _install_managed_prompt_profile(self) -> None:
        managed_runtime.install_managed_prompt_profile(self.agent)

    def _begin_run_tracking(self) -> None:
        self._current_run_started_at = time.perf_counter()
        self._current_run_started_wall_at = time.time()
        self._current_usage_baseline = self._usage_snapshot()

    def _end_run_tracking(self) -> None:
        self._current_run_started_at = None
        self._current_run_started_wall_at = None
        self._current_usage_baseline = None

    def _usage_snapshot(self) -> dict[str, int] | None:
        tracker = self._cost_tracker
        if tracker is None:
            return None
        try:
            stats = tracker.get(self._agent_thread_name)
            return {
                field: max(0, int(getattr(stats, field, 0) or 0))
                for field in _USAGE_FIELDS
            }
        except Exception:
            return None

    def _usage_delta(self) -> dict[str, int] | None:
        current = self._usage_snapshot()
        if current is None:
            return None
        baseline = self._current_usage_baseline or {}
        return {
            field: max(0, current[field] - int(baseline.get(field, 0) or 0))
            for field in _USAGE_FIELDS
        }

    def _subagent_usage_delta(self) -> dict[str, int] | None:
        tracker = self._cost_tracker
        since = self._current_run_started_wall_at
        if tracker is None or since is None:
            return None
        scan = getattr(tracker, "scan_subagent_logs", None)
        if not callable(scan):
            return None
        try:
            stats = scan(since=since, root=managed_runtime.managed_state_root())
            return {
                field: max(0, int(getattr(stats, field, 0) or 0))
                for field in _USAGE_FIELDS
            }
        except Exception:
            return None

    def _context_snapshot(self) -> dict[str, int]:
        """Read GA backend context usage without mutating runtime state."""
        return self.ga.context_usage()

    def _final_turn_telemetry(self) -> dict[str, int | None] | None:
        telemetry: dict[str, int | None] = {}
        if self._current_run_started_at is not None:
            telemetry["elapsedMs"] = max(
                0,
                int((time.perf_counter() - self._current_run_started_at) * 1000),
            )
        usage = self._usage_delta()
        subagent_usage = self._subagent_usage_delta()
        if usage is not None and subagent_usage is not None:
            usage = {
                field: usage.get(field, 0) + subagent_usage.get(field, 0)
                for field in _USAGE_FIELDS
            }
        elif usage is None:
            usage = subagent_usage
        if usage is not None and any(usage.get(field, 0) > 0 for field in _USAGE_FIELDS):
            telemetry["inputTokens"] = usage["input"]
            telemetry["outputTokens"] = usage["output"]
            telemetry["cacheCreateTokens"] = usage["cache_create"]
            telemetry["cacheReadTokens"] = usage["cache_read"]
            telemetry["requestCount"] = usage["requests"]
        telemetry.update(self._context_snapshot())
        return telemetry or None

    def _external_workspace_allowed(self) -> bool:
        state_root = managed_runtime.managed_state_root()
        if not state_root:
            return False
        try:
            state_root_path = os.path.realpath(os.path.abspath(state_root))
            ga_path = os.path.realpath(os.path.abspath(self.ga_path))
            return os.path.commonpath([state_root_path, ga_path]) != ga_path
        except (OSError, ValueError):
            return False

    def _workspace_activation_allowed(self) -> bool:
        return managed_runtime.is_managed_runtime() or self._external_workspace_allowed()

    def _activate_project_workspace(self) -> None:
        if not self.workspace_root:
            return
        root = os.path.abspath(os.path.expanduser(self.workspace_root))
        if not os.path.isdir(root):
            self._emit_error(
                f"Project workspace folder is unavailable: {root}",
                None,
                category="bridge",
                severity="warning",
                context="project_workspace",
            )
            return
        if not self._workspace_activation_allowed():
            self._emit_error(
                "Project workspace skipped for external GenericAgent: "
                "this GA does not expose a safe state-root workspace path.",
                None,
                category="bridge",
                severity="warning",
                context="project_workspace",
            )
            return
        try:
            import workspace_cmd  # type: ignore[import-not-found]
        except Exception as e:
            self._emit_error(
                f"Project workspace unavailable in this GenericAgent: {e}",
                traceback.format_exc(),
                category="bridge",
                severity="warning",
                context="project_workspace",
            )
            return
        prepare = getattr(workspace_cmd, "prepare", None)
        if not callable(prepare):
            self._emit_error(
                "Project workspace unavailable in this GenericAgent: "
                "workspace_cmd.prepare is missing.",
                None,
                category="bridge",
                severity="warning",
                context="project_workspace",
            )
            return
        try:
            result = prepare(root)
        except Exception as e:
            self._emit_error(
                f"Project workspace activation failed: {e}",
                traceback.format_exc(),
                category="bridge",
                severity="warning",
                context="project_workspace",
            )
            return
        if not isinstance(result, dict) or not result.get("ok"):
            detail = result.get("error") if isinstance(result, dict) else result
            self._emit_error(
                f"Project workspace activation failed: {detail}",
                None,
                category="bridge",
                severity="warning",
                context="project_workspace",
            )
            return
        try:
            self.ga.set_project_mode(
                result.get("name") or None,
                result.get("target") or root,
            )
        except Exception as e:
            self._emit_error(
                f"Project workspace activation failed while updating the GA session: {e}",
                traceback.format_exc(),
                category="bridge",
                severity="warning",
                context="project_workspace",
            )

    def _install_handler_subclass(self) -> None:
        from runner.handlers import WorkbenchHandler

        bridge_self = self

        class _ConfiguredWorkbenchHandler(WorkbenchHandler):
            def __init__(
                self,
                parent: Any,
                last_history: list[str] | None = None,
                cwd: str = "./temp",
            ) -> None:
                super().__init__(
                    parent,
                    last_history,
                    cwd,
                    request_approval=bridge_self._request_approval,
                    always_allow_global=bridge_self.state.always_allow_global,
                    always_allow_project=bridge_self.state.always_allow_project,
                    # Closure over bridge_self.state so SetYoloModeCommand
                    # can flip the flag at runtime without rebuilding the
                    # handler. needs_approval() calls this on every dispatch.
                    yolo_check=lambda: bridge_self.state.yolo_mode,
                    # turn_start emission: GA's agent_runner_loop has no
                    # turn_start_callback, but it sets handler.current_turn
                    # before each tool dispatch. WorkbenchHandler invokes
                    # this callback around dispatch so the desktop sidebar
                    # can show "正在工作 · 第 N 步" live.
                    turn_started_callback=bridge_self._emit_turn_start,
                )

        self.ga.install_handler(self.agentmain, _ConfiguredWorkbenchHandler)

    def _register_turn_end_hook(self) -> None:
        self.ga.register_turn_hook(f"workbench_{self.session_id}", self._on_turn_end)

    # ---------------- Event emission ----------------

    def _emit_turn_start(self, turn_index: int) -> None:
        """Fire when GA enters a new agent_runner_loop iteration.

        Three emitters call this (all deduped via _last_emitted_turn):

          1. dispatch_command proactive start: immediately after a new
             visible user task is accepted, before display_queue draining
             can forward the first LLM tokens. This keeps the main view
             anchored on "Step 1" instead of briefly rendering early
             pre-tool prose as answer body.
          2. WorkbenchHandler dispatch wrapper: real-time emission when
             GA actually reaches tool dispatch for the current turn. This
             is GA's observed "we are on step N" signal, but it lands
             after the LLM call has completed.
          3. _on_turn_end predict-emit: right after the just-finished
             turn's TurnEndEvent, if GA is going to keep looping
             (exit_reason empty), we pre-announce turn N+1. The sidebar
             updates immediately, matching what the user sees in the
             main view (turn_progress is already streaming N+1's
             content by then).

        Dedupe keeps these emitters from double-firing turn_start
        for the same N. Reset to 0 on each put_task in dispatch_command
        so a new agent_runner_loop's turn 1 isn't accidentally
        suppressed when the previous run also ended at turn 1.

        turn_index is GA's per-message turn number (1-based, resets at
        every new user_message — matches what the conversation view's
        TurnMarker shows).
        """
        if turn_index == self._last_emitted_turn:
            return
        self._last_emitted_turn = turn_index
        self._emit(
            TurnStartEvent(
                sessionId=self.session_id,
                turnIndex=turn_index,
                visibility=self._current_message_visibility,
            )
        )

    def _emit_ready(self) -> None:
        ga_commit, ga_commit_date = _resolve_ga_commit(self.ga_path)
        self._emit(
            ReadyEvent(
                sessionId=self.session_id,
                protocolVersion=PROTOCOL_VERSION,
                gaCommit=ga_commit,
                gaCommitDate=ga_commit_date,
                gaPath=self.ga_path,
                llmName=self.agent.get_llm_name(),
                cwd=os.getcwd(),
                pid=os.getpid(),
                availableLLMs=self._collect_available_llms(),
            )
        )

    def _collect_available_llms(self) -> list[dict[str, Any]]:
        """Snapshot the agent's LLM list for the Composer LLM switcher."""
        out: list[dict[str, Any]] = []
        try:
            for index, name, is_current in self.agent.list_llms():
                out.append(
                    {
                        "index": index,
                        "name": name,
                        "displayName": _llm_display_name(name),
                        "isCurrent": bool(is_current),
                    }
                )
        except Exception as e:
            self._emit_error(f"list_llms failed: {e}", traceback.format_exc())
        return out

    def _emit(self, ev: Any) -> None:
        self.event_queue.put(encode(ev))

    def _start_progress_drain(self, display_queue: Any) -> None:
        """Forward GA's display_queue partial chunks as turn_progress
        IPC events so desktop can render the LLM output mid-turn.

        GA's `agentmain.put_task` returns a `queue.Queue` whose items
        are `{'next': delta, 'source': src}` for streaming chunks and
        `{'done': full, 'source': src}` once the task completes. With
        `agent.inc_out = True` (set in `_setup_ga`), `next` is the
        delta since the last push rather than the full snapshot.

        We don't republish `done` — the turn_end_callback hook fires
        per GA turn and produces the canonical TurnEndEvent with full
        tool calls / results / responseContent. `done` arrives at
        whole-task completion (across multiple turns); duplicating it
        as IPC would just give desktop a redundant signal.

        Each user task gets its own daemon thread; the thread exits
        on `done` or on shutdown.
        """

        # One filter instance per drain (= per `put_task`). Carries
        # fence state across deltas within a single task; new task
        # starts clean.
        fence_filter = _FenceFilter()

        def drain() -> None:
            try:
                while True:
                    try:
                        item = display_queue.get(timeout=0.5)
                    except queue.Empty:
                        if self.shutdown_event.is_set():
                            return
                        continue
                    if not isinstance(item, dict):
                        continue
                    if "done" in item:
                        # The filter may be holding back a partial fence
                        # prefix (≤5 backticks) that turned out to be real
                        # trailing content — emit it before finishing so
                        # the streamed view doesn't truncate the reply.
                        tail = fence_filter.flush()
                        if tail:
                            self._emit(
                                TurnProgressEvent(
                                    sessionId=self.session_id,
                                    delta=tail,
                                    source=str(item.get("source", "")),
                                    visibility=self._current_message_visibility,
                                )
                            )
                        # `source='system'` is GA's signal that this
                        # `done` came from a slash-command handler
                        # (currently /btw, /session.x=v) that
                        # bypasses agent_runner_loop. No turn_end
                        # callback fires for these — emit a
                        # SystemMessageEvent so desktop can render
                        # the content. The default `'workbench'`
                        # source's `done` is intentionally ignored
                        # (turn_end carries the canonical payload).
                        if str(item.get("source", "")) == "system":
                            content = item.get("done", "")
                            if isinstance(content, str) and content:
                                variant = (
                                    "side_question"
                                    if content.lstrip().startswith("> 🟡 /btw")
                                    else "system"
                                )
                                self._emit(
                                    SystemMessageEvent(
                                        sessionId=self.session_id,
                                        content=content,
                                        variant=variant,
                                    )
                                )
                            # Slash-command tasks bypass agent_runner_loop,
                            # so no turn_end / run_complete ever fires for
                            # them. Without clearing here, run_in_progress
                            # stays set forever: the GUI spinner never
                            # stops and set_llm keeps being rejected until
                            # a manual Stop. Synthesize the completion
                            # (same shape as the Abort path).
                            with self._run_complete_lock:
                                if self.run_in_progress.is_set():
                                    self._emit(
                                        RunCompleteEvent(
                                            sessionId=self.session_id,
                                            exitReason={
                                                "result": "SLASH_COMMAND_COMPLETED",
                                                "data": None,
                                            },
                                            finalContent="",
                                            totalTurns=self.current_turn,
                                            visibility=self._current_message_visibility,
                                        )
                                    )
                                    self.run_in_progress.clear()
                                    self._current_message_visibility = "visible"
                                    self._current_message_turn_base = None
                                    self._end_run_tracking()
                        return
                    if "next" in item:
                        delta = item["next"]
                        if not isinstance(delta, str) or not delta:
                            continue
                        # Filter out content inside 5-backtick fences
                        # (verbose-mode tool stdout). Empty filtered
                        # delta = whole chunk was inside fence; skip
                        # the IPC emit entirely.
                        filtered = fence_filter.feed(delta)
                        if not filtered:
                            continue
                        self._emit(
                            TurnProgressEvent(
                                sessionId=self.session_id,
                                delta=filtered,
                                source=str(item.get("source", "")),
                                visibility=self._current_message_visibility,
                            )
                        )
            except Exception as e:
                # Don't take down the bridge for a drain hiccup.
                self._emit_error(
                    f"progress drain failed: {e}",
                    traceback.format_exc(),
                    category="bridge",
                    severity="warning",
                    context="progress_drain",
                )

        threading.Thread(target=drain, daemon=True).start()

    def _emit_error(
        self,
        message: str,
        tb: str | None,
        *,
        category: str = "bridge",
        severity: str = "error",
        context: str | None = None,
    ) -> None:
        """Emit a structured ErrorEvent.

        category: "bridge" (default) for bridge-internal faults that desktop
        renders as a toast; "runtime" for GA/LLM/tool failures rendered as
        an inline conversation message; "business" for user-action errors
        (invalid input, history corruption) also rendered as a toast.

        hint and retryable are inferred from the message via
        _classify_error — runtime errors with known keyword matches get a
        hint that desktop maps to a tailored Error Card.
        """
        hint, retryable = _classify_error(message, category)
        self._emit(
                ErrorEvent(
                    sessionId=self.session_id,
                    message=message,
                    category=category,
                    severity=severity,
                    retryable=retryable,
                    hint=hint,
                    context=context,
                    traceback=tb,
                    visibility=self._current_message_visibility,
                )
            )

    # ---------------- Turn end hook ----------------

    def _on_turn_end(self, ctx: dict[str, Any]) -> None:
        try:
            response = ctx.get("response")
            tool_calls = ctx.get("tool_calls") or []
            tool_results = ctx.get("tool_results") or []
            summary = str(ctx.get("summary") or "")
            turn = int(ctx.get("turn") or 0)
            exit_reason = ctx.get("exit_reason") or None
            response_content = (
                getattr(response, "content", "") if response is not None else ""
            )
            self.current_turn = turn
            # GA may stash its internal response/outcome objects inside
            # exit_reason.data. Coerce to JSON-safe shape before emit.
            safe_exit = _to_json_safe(exit_reason) if exit_reason else None
            telemetry = self._final_turn_telemetry() if exit_reason else None

            self._emit(
                TurnEndEvent(
                    sessionId=self.session_id,
                    turnIndex=turn,
                    summary=summary,
                    toolCalls=[
                        _to_json_safe(self._serialize_tool_call(tc))
                        for tc in tool_calls
                    ],
                    toolResults=[
                        _to_json_safe(self._serialize_tool_result(tr))
                        for tr in tool_results
                    ],
                    responseContent=response_content,
                    exitReason=safe_exit,
                    telemetry=telemetry,
                    visibility=self._current_message_visibility,
                    absoluteTurnIndex=self._current_absolute_turn_index(turn),
                )
            )

            # Plan-mode observation (read-only): emit a plan_update
            # snapshot when GA's plan state changed this turn. The
            # watcher owns dedupe + the one-shot `active: false` on
            # exit; None means nothing to say.
            plan_payload = self._plan_watcher.snapshot(
                self.agent, str(response_content or "")
            )
            if plan_payload is not None:
                self._emit(
                    PlanUpdateEvent(sessionId=self.session_id, **plan_payload)
                )

            # ask_user is an explicit interaction request: emit AskUserEvent
            # so desktop can prompt the user.
            ask = self._extract_ask_user(tool_calls)
            if ask is not None:
                question, candidates = ask
                self._emit(
                    AskUserEvent(
                        sessionId=self.session_id,
                        question=question,
                        candidates=candidates,
                    )
                )

            if exit_reason:
                with self._run_complete_lock:
                    # Abort (command thread) may have already emitted the
                    # completion and cleared the run — don't double-emit.
                    if self.run_in_progress.is_set():
                        self._emit(
                            RunCompleteEvent(
                                sessionId=self.session_id,
                                exitReason=safe_exit or {},
                                finalContent=_clean_response_for_display(response_content),
                                totalTurns=turn,
                                visibility=self._current_message_visibility,
                            )
                        )
                        self.run_in_progress.clear()
                        self._current_message_visibility = "visible"
                        self._current_message_turn_base = None
                        self._end_run_tracking()
            else:
                # Predict-emit turn_start(turn+1): GA is going to keep
                # looping, but the real dispatch-wrapper signal for the
                # next turn won't fire until that turn's LLM call has
                # fully completed (several seconds later). Without this,
                # the sidebar subline drops to "正在工作…" during the
                # next turn's LLM streaming even though the main view
                # is clearly already showing N+1's content. The dedupe
                # inside `_emit_turn_start` makes the eventual real
                # dispatch-wrapper signal a no-op.
                self._emit_turn_start(turn + 1)
        except Exception as e:
            self._emit_error(f"turn_end_hook failed: {e}", traceback.format_exc())

    @staticmethod
    def _serialize_tool_call(tc: dict[str, Any]) -> dict[str, Any]:
        args = {k: v for k, v in (tc.get("args") or {}).items() if not k.startswith("_")}
        return {"toolName": tc.get("tool_name", ""), "args": args}

    @staticmethod
    def _serialize_tool_result(tr: dict[str, Any]) -> dict[str, Any]:
        return {"toolUseId": tr.get("tool_use_id", ""), "content": tr.get("content", "")}

    @staticmethod
    def _extract_ask_user(
        tool_calls: list[dict[str, Any]],
    ) -> tuple[str, list[str]] | None:
        for tc in tool_calls:
            if tc.get("tool_name") == "ask_user":
                args = tc.get("args") or {}
                return (
                    str(args.get("question", "")),
                    [str(c) for c in (args.get("candidates") or [])],
                )
        return None

    # ---------------- Approval request (called from worker thread) ----------------

    def _request_approval(self, tool_name: str, args: dict[str, Any]) -> str:
        from runner.handlers import APPROVAL_REASONS, RISK_LEVELS

        approval_id = f"appr_{uuid.uuid4().hex[:12]}"
        pending = self.state.register_pending(approval_id)
        self._emit(
            ToolCallPendingEvent(
                sessionId=self.session_id,
                approvalId=approval_id,
                turnIndex=self.current_turn,
                absoluteTurnIndex=self._current_absolute_turn_index(self.current_turn),
                toolName=tool_name,
                args=args,
                argsPreview=_compact_args(args),
                riskLevel=RISK_LEVELS.get(tool_name, "medium"),
                reason=APPROVAL_REASONS.get(tool_name, "Tool requires user approval."),
            )
        )

        if not pending.event.wait(timeout=self.APPROVAL_WAIT_SECS):
            self._emit_error(
                f"Approval timed out for {tool_name} ({self.APPROVAL_WAIT_SECS}s); denying.",
                None,
                category="business",
                severity="warning",
                context="approval_timeout",
            )
            return "deny"
        return pending.decision or "deny"

    # ---------------- Command dispatch ----------------

    def dispatch_command(self, cmd: Command) -> None:
        if isinstance(cmd, UserMessageCommand):
            # `/btw <question>` is a side question — non-blocking,
            # interruption-free. Route through btw_cmd's sync entry
            # in a worker thread so the main agent's task queue is
            # left untouched. `/btw` with the agent mid-run still
            # returns an answer in seconds rather than waiting for
            # the main task to finish. See _setup_ga for the
            # handler import.
            text = cmd.text.lstrip()
            if self._btw_handler is not None and (
                text == "/btw"
                or text.startswith("/btw ")
                or text.startswith("/btw\t")
            ):
                self._handle_btw_command(cmd.text)
                return
            # New put_task = new agent_runner_loop, turn counter restarts
            # at 1. Reset dedupe so the first turn_start(1) of the new
            # run isn't suppressed when the previous run also ended at
            # turn 1.
            self._last_emitted_turn = 0
            self._current_message_visibility = cmd.visibility or "visible"
            self._current_message_turn_base = cmd.absoluteTurnIndex
            self._begin_run_tracking()
            self.run_in_progress.set()
            self._emit_turn_start(1)
            display_queue = self.agent.put_task(
                cmd.text, source="workbench", images=cmd.images
            )
            self._start_progress_drain(display_queue)
        elif isinstance(cmd, ApprovalResponseCommand):
            ok = self.state.resolve_pending(cmd.approvalId, cmd.decision)
            if not ok:
                self._emit_error(
                    f"Unknown approval id: {cmd.approvalId}",
                    None,
                    context="approval_response",
                )
        elif isinstance(cmd, AskUserResponseCommand):
            # Same as UserMessage above — ask_user response triggers a
            # fresh agent_runner_loop with turn counter restarting at 1.
            self._last_emitted_turn = 0
            self._current_message_visibility = "visible"
            self._current_message_turn_base = cmd.absoluteTurnIndex
            self._begin_run_tracking()
            self.run_in_progress.set()
            self._emit_turn_start(1)
            display_queue = self.agent.put_task(cmd.text, source="workbench")
            self._start_progress_drain(display_queue)
        elif isinstance(cmd, AbortCommand):
            # GA's abort() sets stop_sig and breaks out of the run loop
            # without firing turn_end_callback, so we synthesize the
            # run_complete event ourselves with the ABORTED marker.
            # abort() first so stop_sig is already set when a denied
            # approval wakes the agent thread — it then exits at the
            # next stop check instead of continuing the turn.
            self.agent.abort()
            self.state.resolve_all_pending("deny")
            with self._run_complete_lock:
                if self.run_in_progress.is_set():
                    self._emit(
                        RunCompleteEvent(
                            sessionId=self.session_id,
                            exitReason={"result": "ABORTED", "data": None},
                            finalContent="",
                            totalTurns=self.current_turn,
                            visibility=self._current_message_visibility,
                        )
                    )
                    self.run_in_progress.clear()
                    self._current_message_visibility = "visible"
                    self._current_message_turn_base = None
                    self._end_run_tracking()
        elif isinstance(cmd, LoadHistoryCommand):
            # Mirror set_llm's guard: replacing history mid-run would let
            # the agent loop read/write a list swapped out under it.
            if self.run_in_progress.is_set():
                self._emit_error(
                    "Cannot load history while a run is in progress",
                    None,
                    category="business",
                    context="load_history",
                )
                return
            try:
                self._load_history(cmd.messages)
                self._emit(
                    HistoryLoadedEvent(
                        sessionId=self.session_id,
                        messageCount=len(cmd.messages),
                    )
                )
            except Exception as e:
                self._emit_error(
                    f"load_history failed: {e}",
                    traceback.format_exc(),
                    category="business",
                    context="load_history",
                )
        elif isinstance(cmd, SetApprovalRulesCommand):
            # In-place mutation so the existing handler instance picks up
            # changes without rebuild.
            self.state.always_allow_global.clear()
            self.state.always_allow_global.update(cmd.alwaysAllowGlobal)
            self.state.always_allow_project.clear()
            self.state.always_allow_project.update(cmd.alwaysAllowProject)
        elif isinstance(cmd, SetYoloModeCommand):
            # YOLO mode (PRD §11.5). Read by WorkbenchHandler through a
            # closure that reaches into self.state, so this single
            # assignment takes effect on the next tool dispatch — no
            # need to rebuild the handler or notify it explicitly.
            self.state.yolo_mode = cmd.enabled
        elif isinstance(cmd, SetLLMCommand):
            self._handle_set_llm(cmd)
        elif isinstance(cmd, ReinjectToolsCommand):
            self._handle_reinject_tools()
        elif isinstance(cmd, AttachPetCommand):
            self._handle_attach_pet(cmd)
        elif isinstance(cmd, DetachPetCommand):
            self._handle_detach_pet()
        elif isinstance(cmd, ShutdownCommand):
            # A pending approval would keep the agent thread blocked
            # through process teardown; deny it so the thread can exit.
            self.state.resolve_all_pending("deny")
            # Make sure pet subprocess + hook don't leak on shutdown.
            self._handle_detach_pet(silent=True)
            self.shutdown_event.set()

    def _handle_set_llm(self, cmd: SetLLMCommand) -> None:
        """Switch the agent's active LLM. Should only be called when the
        agent is idle; the desktop UI is responsible for enforcing that
        constraint, but we double-check here.

        GA's next_llm() copies backend.history from the old client to the
        new one, so conversation context is preserved across the switch.
        """
        if self.run_in_progress.is_set():
            self._emit_error(
                "Cannot switch LLM while a run is in progress",
                None,
                category="business",
                context="set_llm",
            )
            return
        try:
            count = len(self.agent.llmclients)
        except Exception as e:
            self._emit_error(
                f"Cannot read LLM list: {e}",
                traceback.format_exc(),
                context="set_llm",
            )
            return
        if not 0 <= cmd.llmIndex < count:
            self._emit_error(
                f"llmIndex {cmd.llmIndex} out of range [0, {count})",
                None,
                category="business",
                context="set_llm",
            )
            return
        try:
            self.agent.next_llm(cmd.llmIndex)
        except Exception as e:
            self._emit_error(
                f"next_llm({cmd.llmIndex}) failed: {e}",
                traceback.format_exc(),
                context="set_llm",
            )
            return
        raw_name = self.agent.get_llm_name()
        self._emit(
            LLMChangedEvent(
                sessionId=self.session_id,
                index=cmd.llmIndex,
                name=raw_name,
                displayName=_llm_display_name(raw_name),
            )
        )

    # ---------------- Reinject Tools ----------------

    def _handle_reinject_tools(self) -> None:
        """Re-inject GA's tool definitions into this session's LLM history.

        Mirrors `stapp.py` (GA's official Streamlit frontend) Reinject
        Tools button:

          1. Clear `agent.llmclient.last_tools` so the next prompt
             rebuilds the tool block from scratch
          2. Read `<ga_path>/assets/tool_usable_history.json` — a list
             of history blocks describing each available tool
          3. Append those blocks to `agent.llmclient.backend.history`

        After this the LLM's next reasoning step has fresh, complete
        tool definitions in context — useful when a long session has
        drifted (compression / forgetting) and the agent is confused
        about what tools exist or how to call them.

        Coupling point (AGENTS.md constitution §"Non-Invasive To GenericAgent"):
          - Direct read of `<ga_path>/assets/tool_usable_history.json`
          - Path + JSON schema are GA internal — re-audit at each GA
            baseline upgrade. As of baseline 1a8abc4f this matches
            stapp.py:67-74 and the file exists in the expected layout.
        """
        import json as _json

        try:
            self.ga.history()
        except Exception as e:
            self._emit_error(
                f"Cannot access backend.history: {e}",
                traceback.format_exc(),
                category="business",
                context="reinject_tools",
            )
            return
        assets_path = Path(self.ga_path) / "assets" / "tool_usable_history.json"
        if not assets_path.is_file():
            self._emit_error(
                f"GA asset not found: {assets_path}",
                None,
                category="business",
                context="reinject_tools",
            )
            return
        try:
            with assets_path.open(encoding="utf-8") as f:
                tool_hist = _json.load(f)
        except Exception as e:
            self._emit_error(
                f"Failed to parse tool_usable_history.json: {e}",
                traceback.format_exc(),
                category="business",
                context="reinject_tools",
            )
            return
        if not isinstance(tool_hist, list):
            self._emit_error(
                "tool_usable_history.json: expected a list of history blocks",
                None,
                category="business",
                context="reinject_tools",
            )
            return
        # Reset GA's per-LLM "last seen tools" so the next prompt rebuilds
        # the tool block from scratch — mirrors stapp.py exactly.
        self.ga.clear_last_tools()
        try:
            self.ga.extend_history(tool_hist)
        except Exception as e:
            self._emit_error(
                f"Failed to extend backend.history: {e}",
                traceback.format_exc(),
                context="reinject_tools",
            )
            return
        self._emit(
            ToolsReinjectedEvent(
                sessionId=self.session_id,
                blocksAdded=len(tool_hist),
            )
        )

    # ---------------- Side question (/btw) ----------------

    def _handle_btw_command(self, raw_text: str) -> None:
        """Run GA's btw_cmd.handle_frontend_command in a worker
        thread and emit the result as a SystemMessageEvent.
        Non-blocking: the bridge's command loop returns immediately
        so other commands (and the main agent.run thread) keep
        flowing.
        """
        handler = self._btw_handler
        if handler is None:
            return  # guarded at caller, but defensive

        def worker() -> None:
            try:
                # btw_cmd internally strips the /btw prefix + does
                # the deepcopy-history + raw_ask dance. Returns the
                # formatted markdown reply (header line + body +
                # elapsed seconds).
                body = handler(self.agent, raw_text)
            except Exception as e:  # noqa: BLE001
                self._emit_error(
                    f"/btw failed: {e}",
                    traceback.format_exc(),
                    category="runtime",
                    context="btw",
                )
                return
            if not isinstance(body, str) or not body.strip():
                return
            self._emit(
                SystemMessageEvent(
                    sessionId=self.session_id,
                    content=body,
                    variant="side_question",
                )
            )

        threading.Thread(
            target=worker, daemon=True, name=f"btw-{self.session_id}"
        ).start()

    # ---------------- Desktop Pet ----------------

    def _handle_attach_pet(self, cmd: AttachPetCommand) -> None:
        """Spawn GA's `desktop_pet_v2.pyw` subprocess and register a
        per-turn hook that POSTs progress to its local HTTP listener.

        Pet binds a fixed port (default 41983) so only one pet can run
        at a time. If a pet is already attached to this session, the
        old one is detached first.

        Coupling point (AGENTS.md constitution §"Non-Invasive To GenericAgent"):
          - File path: `<ga_path>/frontends/desktop_pet_v2.pyw`
            (falls back to `desktop_pet.pyw` mirroring stapp.py:77-78)
          - The pet subprocess is GA-owned code that we simply spawn;
            we don't modify it. Re-audit at each GA baseline upgrade.
        """
        import subprocess as _subprocess

        # Detach existing pet (if any) before re-attaching.
        if self._pet_process is not None:
            self._handle_detach_pet(silent=True)

        # Locate the pet script.
        pet_script = Path(self.ga_path) / "frontends" / "desktop_pet_v2.pyw"
        if not pet_script.is_file():
            pet_script = Path(self.ga_path) / "frontends" / "desktop_pet.pyw"
        if not pet_script.is_file():
            self._emit_error(
                f"Desktop pet script not found in {self.ga_path}/frontends/",
                None,
                category="business",
                context="attach_pet",
            )
            return

        # Spawn pet subprocess.
        python_exe = sys.executable
        try:
            self._pet_process = _subprocess.Popen(
                [python_exe, str(pet_script)],
                stdout=_subprocess.DEVNULL,
                stderr=_subprocess.DEVNULL,
            )
            self._pet_port = cmd.port
        except Exception as e:
            self._pet_process = None
            self._emit_error(
                f"Failed to spawn desktop pet: {e}",
                traceback.format_exc(),
                context="attach_pet",
            )
            return

        # Register the per-turn hook. Distinct key from our IPC hook
        # so detach doesn't accidentally remove the wrong entry, and
        # so coexistence with GA's own 'pet' key (if user runs stapp.py
        # against the same agent — unusual but possible) doesn't clash.
        port = cmd.port

        def _pet_hook(ctx: dict[str, Any]) -> None:
            from urllib.parse import quote
            from urllib.request import urlopen

            parts = [f"Turn {ctx.get('turn', '?')}"]
            if ctx.get("summary"):
                parts.append(str(ctx["summary"]))
            if ctx.get("exit_reason"):
                parts.append("DONE")
            msg = quote("\n".join(parts))

            def _do(url: str) -> None:
                try:
                    urlopen(url, timeout=2)
                except Exception:
                    pass

            threading.Thread(
                target=_do,
                args=(f"http://127.0.0.1:{port}/?msg={msg}",),
                daemon=True,
            ).start()
            if ctx.get("exit_reason"):
                threading.Thread(
                    target=_do,
                    args=(f"http://127.0.0.1:{port}/?state=idle",),
                    daemon=True,
                ).start()

        try:
            self.ga.register_turn_hook(f"galley_pet_{self.session_id}", _pet_hook)
        except Exception as e:
            # Hook registration failed — kill the orphan pet subprocess.
            self._handle_detach_pet(silent=True)
            self._emit_error(
                f"Failed to register pet hook: {e}",
                traceback.format_exc(),
                context="attach_pet",
            )
            return

        self._emit(
            PetAttachedEvent(
                sessionId=self.session_id,
                port=cmd.port,
            )
        )

    def _handle_detach_pet(self, silent: bool = False) -> None:
        """Terminate the pet subprocess (if running) and remove the
        per-turn hook. `silent=True` skips the IPC event — used during
        shutdown to avoid emitting on a half-torn-down bridge.
        """
        # Remove hook first so any in-flight turn_end doesn't try to
        # POST to a pet we're about to kill.
        self.ga.unregister_turn_hook(f"galley_pet_{self.session_id}")
        # Terminate subprocess.
        proc = self._pet_process
        self._pet_process = None
        self._pet_port = 0
        if proc is not None:
            try:
                proc.terminate()
                # Don't block bridge mainloop on the pet cleaning up —
                # daemon process, OS will reap if needed.
                try:
                    proc.wait(timeout=1.0)
                except Exception:
                    proc.kill()
            except Exception:
                pass
        if not silent:
            self._emit(PetDetachedEvent(sessionId=self.session_id))

    def _load_history(self, messages: list[dict[str, Any]]) -> None:
        """Inject conversation history into the backend.

        Desktop-facing schema (docs/ipc-protocol.md §8.4) uses simple
        string content per message.

        The desktop-shape → GA-native-blocks adaptation lives in
        `GaSession.set_history` so the desktop never has to know GA's
        internal shape. Unvalidated backend session classes get the
        write plus a loud warning (PRD §10); the validated set lives in
        ga_session.py.
        """
        warning = self.ga.set_history(messages)
        if warning:
            self._emit_error(
                f"History restore: {warning}",
                None,
                category="bridge",
                severity="warning",
                context="load_history",
            )

    # ---------------- Main loop ----------------

    def run(self) -> int:
        writer = threading.Thread(target=self._stdout_writer, daemon=True)
        writer.start()
        threading.Thread(target=self._stdin_reader, daemon=True).start()

        while not self.shutdown_event.is_set():
            try:
                cmd = self.command_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                self.dispatch_command(cmd)
            except Exception as e:
                self._emit_error(
                    f"command dispatch failed: {e}", traceback.format_exc()
                )

        # Whatever ended the loop (Shutdown command, stdin EOF, stdout
        # write failure), the pet subprocess must not outlive the bridge —
        # an orphan keeps holding its fixed port and blocks the next
        # attach. Idempotent: the Shutdown command path already detached.
        self._handle_detach_pet(silent=True)

        # Flush tail events deterministically: enqueue the writer-exit
        # sentinel and join with a bound. Everything queued before the
        # sentinel is written + flushed when join returns. (The previous
        # logic waited on run_in_progress — inverted: idle sessions
        # burned the full grace while running ones skipped it — then
        # busy-spun on queue.empty(), which says nothing about the last
        # line having actually been written to the pipe.)
        self.event_queue.put(None)
        writer.join(timeout=2.0)
        return 0

    # ---------------- IO threads ----------------

    def _stdout_writer(self) -> None:
        while True:
            try:
                line = self.event_queue.get(timeout=0.1)
            except queue.Empty:
                if self.shutdown_event.is_set():
                    # Fallback exit; the primary path is the sentinel
                    # run() enqueues so pre-shutdown events all flush.
                    return
                continue
            if line is None:  # writer-exit sentinel from run()
                return
            try:
                self._stdout.write(line + "\n")
                self._stdout.flush()
            except Exception:
                self.shutdown_event.set()
                return

    def _stdin_reader(self) -> None:
        while not self.shutdown_event.is_set():
            try:
                line = self._stdin.readline()
            except Exception:
                self.shutdown_event.set()
                return
            if not line:  # EOF
                self.shutdown_event.set()
                return
            try:
                cmd = decode_command(line)
            except IPCProtocolError as e:
                self._emit_error(str(e), None)
                continue
            self.command_queue.put(cmd)


# ---------------- Entrypoint ----------------


def main() -> int:
    parser = argparse.ArgumentParser(prog="runner.workbench_bridge")
    parser.add_argument("--ga-path", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--cwd", default=None)
    parser.add_argument("--workspace-root", default=None)
    parser.add_argument("--llm-no", type=int, default=0)
    parser.add_argument("--llm-name", default=None)
    args = parser.parse_args()
    _watchdog.start_parent_watchdog(
        _watchdog.parse_core_pid(),
        label="workbench-bridge",
        thread_name="galley-bridge-parent-watchdog",
        cleanup=_PARENT_LOSS_CLEANUP,
    )

    ga_path = str(Path(args.ga_path).expanduser().resolve())
    if not Path(ga_path).is_dir():
        print(f"GA path not found: {ga_path}", file=sys.stderr)
        return 2

    real_stdout = _capture_real_stdout()
    real_stdin = sys.stdin
    _silence_python_stdout()

    bridge = Bridge(
        ga_path=ga_path,
        session_id=args.session_id,
        cwd=args.cwd,
        llm_no=args.llm_no,
        llm_name=args.llm_name,
        stdout=real_stdout,
        stdin=real_stdin,
        workspace_root=args.workspace_root,
    )
    try:
        bridge.start()
    except Exception as e:
        print(
            f"Bridge startup failed: {e}\n{traceback.format_exc()}",
            file=sys.stderr,
        )
        return 1
    return bridge.run()


if __name__ == "__main__":
    sys.exit(main())
