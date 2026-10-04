"""WorkbenchHandler: extends GenericAgentHandler with turn-lifecycle signals.

GA's tool execution path stays the authority: every tool call goes straight
to `super().dispatch()`, and its results are never altered. The subclass only
synthesizes Galley's live turn signal around dispatch and forwards `tool_num`
when the loaded GA accepts it. GA upgrades can move internals around; this
module uses runtime feature detection for the pieces Galley depends on.

This module imports GA modules (`agent_loop`, `ga`). The caller must put
the GA installation path on sys.path before importing this module.
"""
from __future__ import annotations

import inspect
from collections.abc import Callable, Generator
from typing import Any

# These imports require GA on sys.path. The bridge entrypoint and the
# pytest conftest both arrange for that before this module loads.
from agent_loop import BaseHandler
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
# Galley's live turn_start signal used tool_before_callback as its
# hook. Detect whether the loaded GA still calls it; if not, emit the
# signal ourselves immediately before delegating to GA's dispatch.
_BASE_DISPATCH_CALLS_TOOL_BEFORE_CALLBACK: bool = (
    _base_dispatch_calls_tool_before_callback()
)


class WorkbenchHandler(GenericAgentHandler):  # type: ignore[misc]  # GA has no stubs
    """GA handler that emits Galley's turn signal and forwards `tool_num`.

    It must not change tool dispatch or results (CLAUDE.md Rule 1): every
    call is delegated to GA's own dispatch unchanged.
    """

    def __init__(
        self,
        parent: Any,
        last_history: list[str] | None = None,
        cwd: str = "./temp",
        *,
        turn_started_callback: Callable[[int], None] | None = None,
    ) -> None:
        super().__init__(parent, last_history, cwd)
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
