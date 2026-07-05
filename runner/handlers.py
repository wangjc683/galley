"""WorkbenchHandler: extends GenericAgentHandler with approval interception.

The approval gate sits in front of `super().dispatch()`. We keep GA's tool
execution path as the authority, and only add Galley's approval + progress
signals around it. GA upgrades can move internals around; this module uses
runtime feature detection for the pieces Galley depends on.

This module imports GA modules (`agent_loop`, `ga`). The caller must put
the GA installation path on sys.path before importing this module.
"""
from __future__ import annotations

import inspect
from collections.abc import Callable, Generator
from typing import Any

# These imports require GA on sys.path. The bridge entrypoint and the
# pytest conftest both arrange for that before this module loads.
from agent_loop import BaseHandler, StepOutcome
from ga import GenericAgentHandler

# Upstream GA commit 3205f4a (post-cf65515 baseline) added a `tool_num`
# kwarg to `BaseHandler.dispatch` so do_* tools can scale output length
# by the number of parallel calls. Workbench's baseline is past that
# commit, but the user's local GA repo may not be — and we are
# explicitly non-invasive (AGENTS.md "GA upgrade cadence is the user's
# call"). So we detect support at import time and forward `tool_num`
# only when the actually-loaded BaseHandler supports it. Without this
# guard, an older GA crashes the agent loop with `TypeError: dispatch()
# takes from 4 to 5 positional arguments but 6 were given` on the
# first tool dispatch, leaving the desktop stuck on "思考中".
_BASE_DISPATCH_SUPPORTS_TOOL_NUM: bool = (
    "tool_num" in inspect.signature(BaseHandler.dispatch).parameters
)


def _base_dispatch_calls_tool_before_callback() -> bool:
    try:
        source = inspect.getsource(BaseHandler.dispatch)
    except (OSError, TypeError):
        return hasattr(BaseHandler, "tool_before_callback")
    return "tool_before_callback" in source


# Upstream GA commit 1a8abc4 (post-b063518 baseline) replaced the
# BaseHandler.dispatch callback calls with plugins.hooks triggers.
# Approval still happens in WorkbenchHandler.dispatch before super(),
# but Galley's live turn_start signal used tool_before_callback as its
# hook. Detect whether the loaded GA still calls it; if not, emit the
# signal ourselves immediately before delegating to GA's dispatch.
_BASE_DISPATCH_CALLS_TOOL_BEFORE_CALLBACK: bool = (
    _base_dispatch_calls_tool_before_callback()
)

# Tools that require user approval by default. See PRD §11.2.
DEFAULT_APPROVAL_TOOLS: frozenset[str] = frozenset(
    {
        "code_run",
        "file_write",
        "file_patch",
        "start_long_term_update",
    }
)


# Risk classification surfaced via tool_call_pending events for the Approval Card.
RISK_LEVELS: dict[str, str] = {
    "code_run": "high",
    "file_write": "medium",
    "file_patch": "medium",
    "start_long_term_update": "high",
}


# Why each tool is gated. Shown in the Approval Card to give the user context.
APPROVAL_REASONS: dict[str, str] = {
    "code_run": "Executes arbitrary code; can modify files, processes, and network.",
    "file_write": "Writes to disk; can overwrite existing files.",
    "file_patch": "Modifies file content in place.",
    "start_long_term_update": "Updates GA's long-term memory files.",
}


# Approval callable signature. Bridge entrypoint constructs this and injects it.
# It must block until the desktop responds. Decision strings:
#   "allow_once" | "deny" | "always_allow_project" | "always_allow_global"
ApprovalRequester = Callable[[str, dict[str, Any]], str]


class WorkbenchHandler(GenericAgentHandler):  # type: ignore[misc]  # GA has no stubs
    """GA handler that gates high-risk tool calls behind user approval."""

    def __init__(
        self,
        parent: Any,
        last_history: list[str] | None = None,
        cwd: str = "./temp",
        *,
        request_approval: ApprovalRequester,
        approval_tools: frozenset[str] = DEFAULT_APPROVAL_TOOLS,
        always_allow_global: set[str] | None = None,
        always_allow_project: set[str] | None = None,
        yolo_check: Callable[[], bool] | None = None,
        turn_started_callback: Callable[[int], None] | None = None,
    ) -> None:
        super().__init__(parent, last_history, cwd)
        self._request_approval = request_approval
        self._approval_tools = approval_tools
        # Shared references on purpose: agentmain.run() rebuilds the handler
        # on every put_task, so always-allow rules must outlive any single
        # handler. The bridge entrypoint owns these sets at session scope and
        # passes the same references in each time. dispatch's `.add()` and
        # update_approval_rules's mutations all operate in place.
        self._always_allow_global: set[str] = (
            always_allow_global if always_allow_global is not None else set()
        )
        self._always_allow_project: set[str] = (
            always_allow_project if always_allow_project is not None else set()
        )
        # YOLO mode (PRD §11.5): when this callable returns True, every
        # tool dispatch bypasses the approval gate. Stored as a callable
        # rather than a bool so the bridge can flip it at runtime via
        # SetYoloModeCommand without rebuilding the handler — matches the
        # mutable-set pattern used for always_allow_* above. Default to
        # "always False" when not provided (test paths, legacy callers).
        self._yolo_check: Callable[[], bool] = yolo_check or (lambda: False)
        # GA has no turn_start_callback extension point, so we synthesize
        # one around dispatch. Older GA called tool_before_callback
        # inside BaseHandler.dispatch. Newer GA switched to plugins.hooks,
        # so WorkbenchHandler emits the same signal itself when feature
        # detection says the base dispatch no longer does. Dedupe
        # (multi-tool turn → single emit, plus coordination with the
        # bridge's predict-emit path) lives on the bridge side now —
        # see workbench_bridge._emit_turn_start. The handler just passes
        # the current turn number through.
        self._turn_started_callback: Callable[[int], None] | None = (
            turn_started_callback
        )

    def tool_before_callback(
        self,
        tool_name: str,
        args: dict[str, Any],
        response: Any,
    ) -> None:
        """Notify the bridge of the GA-side turn number.

        Older GA baselines call this from `BaseHandler.dispatch` via
        `try_call_generator` before each tool dispatch. Newer baselines
        no longer do; WorkbenchHandler.dispatch calls this method itself
        when needed. In both cases, `agent_runner_loop` has already set
        `self.current_turn` to the current 1-based turn number.

        Even the "no-tool" final-answer turn fires dispatch (with
        tool_name='no_tool', backed by GenericAgentHandler.do_no_tool),
        so every turn — intermediate and final — surfaces here.

        Dedupe is centralized on the bridge: a multi-tool turn fires
        this multiple times for the same `current_turn`, and the
        bridge's predict-emit in `_on_turn_end` races us on turn N+1,
        but both paths funnel through `_emit_turn_start` which suppresses
        repeat-Ns.

        We don't call super().tool_before_callback(): older GA's
        BaseHandler default is `pass`, newer GA no longer defines it,
        and GenericAgentHandler does not override it.
        """
        current = int(getattr(self, "current_turn", 0) or 0)
        if current and self._turn_started_callback is not None:
            try:
                self._turn_started_callback(current)
            except Exception:
                # Never let an emit error crash the GA loop —
                # turn_start is purely a UX signal; the run keeps
                # going either way.
                pass

    def update_approval_rules(
        self,
        always_allow_global: set[str] | None = None,
        always_allow_project: set[str] | None = None,
    ) -> None:
        """Sync always-allow lists from the desktop (SetApprovalRulesCommand).

        Mutates the underlying sets in place so external holders of the
        same references see the updated state.
        """
        if always_allow_global is not None:
            self._always_allow_global.clear()
            self._always_allow_global.update(always_allow_global)
        if always_allow_project is not None:
            self._always_allow_project.clear()
            self._always_allow_project.update(always_allow_project)

    def needs_approval(self, tool_name: str) -> bool:
        """Return True iff this tool requires user approval right now.

        Order matters:

        1. YOLO mode short-circuits everything — the user has explicitly
           opted out of approvals globally (PRD §11.5).
        2. Tool not in the approval list → never gated.
        3. Always-allow rules (global / project) → not gated.
        4. Otherwise gate.
        """
        if self._yolo_check():
            return False
        if tool_name not in self._approval_tools:
            return False
        if tool_name in self._always_allow_global:
            return False
        if tool_name in self._always_allow_project:
            return False
        return True

    def dispatch(
        self,
        tool_name: str,
        args: dict[str, Any],
        response: Any,
        index: int = 0,
        tool_num: int = 1,
    ) -> Generator[Any, None, Any]:
        # `tool_num` reaches us only on GA versions ≥ 3205f4a (post-
        # cf65515 baseline). Older GA's `agent_runner_loop` doesn't
        # pass it; default `1` keeps us valid in that case. Forwarding
        # to super is the asymmetric path: older BaseHandler.dispatch
        # only takes 4 positional args, so we feature-detect and drop
        # the kwarg when unsupported. See module-level
        # _BASE_DISPATCH_SUPPORTS_TOOL_NUM for rationale.
        if self.needs_approval(tool_name):
            # Defensive copy: super().dispatch mutates args (adds _index,
            # and _tool_num on newer GA). Approval Cards in the desktop
            # UI must show the user-facing args, not GA's bookkeeping.
            decision = self._request_approval(tool_name, dict(args))
            if decision == "deny":
                yield f"[Approval] User denied: {tool_name}\n"
                # Coupling point: this payload round-trips verbatim into
                # turn_end.toolResults[].content, and the desktop parses
                # `status == "denied"` to render the tool as denied in the
                # transcript (gui/src/lib/tool-outcome.ts). Change the
                # shape there and here together.
                return StepOutcome(
                    {"status": "denied", "msg": "User denied this tool call"},
                    next_prompt="\n",
                )
            if decision == "always_allow_global":
                self._always_allow_global.add(tool_name)
            elif decision == "always_allow_project":
                self._always_allow_project.add(tool_name)
            elif decision != "allow_once":
                # Fail-safe: unknown decision strings are treated as deny so a
                # buggy desktop or stale protocol can't accidentally authorize.
                yield f"[Approval] Unknown decision {decision!r}, treating as deny.\n"
                return StepOutcome(
                    {"status": "denied", "msg": f"Unknown approval decision: {decision}"},
                    next_prompt="\n",
                )
        if (
            not _BASE_DISPATCH_CALLS_TOOL_BEFORE_CALLBACK
            and hasattr(self, f"do_{tool_name}")
        ):
            self.tool_before_callback(tool_name, args, response)
        if _BASE_DISPATCH_SUPPORTS_TOOL_NUM:
            return (
                yield from super().dispatch(
                    tool_name, args, response, index, tool_num
                )
            )
        return (yield from super().dispatch(tool_name, args, response, index))
