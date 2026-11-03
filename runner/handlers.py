"""WorkbenchHandler: extends GenericAgentHandler with turn-lifecycle signals.

GA's tool execution path stays the authority: every tool call goes straight
to `super().dispatch()`, and its results are never altered. The subclass only
synthesizes Galley's live turn signal around dispatch and forwards `tool_num`
when the loaded GA accepts it. GA upgrades can move internals around; this
module uses runtime feature detection for the pieces Galley depends on.

Two exceptions, managed runtime only, both the main chat's: its browser
guard (main chat PRD ruling 184, ticket 135): the runner refuses browser
tools and tells the model to hand the work to a subtask (see
`_main_chat_refuses`); and its own tool `tell_user` (ticket 137,
`runner/tell_user.py`), which GA does not have: the call never reaches GA's
dispatch. Attach mode never reaches either (CLAUDE.md Rule 1: there the
subclass only emits signals).

This module imports GA modules (`agent_loop`, `ga`). The caller must put
the GA installation path on sys.path before importing this module.
"""
from __future__ import annotations

import inspect
import os
from collections.abc import Callable, Generator
from typing import Any

# These imports require GA on sys.path. The bridge entrypoint and the
# pytest conftest both arrange for that before this module loads.
from agent_loop import BaseHandler
from ga import GenericAgentHandler

from runner import managed_runtime, tell_user

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


# The main chat's browser guard (main chat PRD ruling 184, ticket 135).
# The main chat does not go on the web: work that needs the browser is a
# subtask's. Its prompt says so; this makes it hold. Core sets
# GALLEY_MAIN_CHAT=1 on the main chat's runner only
# (core/src/runner_commands.rs `MAIN_CHAT_ENV`); subtasks, workbench
# sessions and the IM channels never have it.
MAIN_CHAT_ENV = "GALLEY_MAIN_CHAT"
# GA's browser tools are `web_scan` and `web_execute_js` today
# (managed-ga/code/ga.py `do_web_*`); matching the prefix also refuses one
# upstream adds later.
BROWSER_TOOL_PREFIX = "web_"
# What the model reads as the tool's result, in GA's error envelope (the
# shape GA's own refusal of a whole-file L1 write uses, ga.py
# `do_file_write`), which the desktop draws as a failed tool.
# It says the main chat does not go online at all, not only that the
# browser is off: refused here, the model could otherwise reach for curl
# in `code_run`, which this guard does not see. Main chat PRD ruling 185
# point 4: the user hears that it is on its way, not why it is not done
# here or that a rule says so. It opens with the entry layer's own words
# for this ("You do not go online in this chat"), not "This is the main
# chat": the model passed that name on to the user as 「主聊」 (an inner
# name, ruling 173).
MAIN_CHAT_BROWSER_REFUSAL = (
    "You do not go online in this chat, neither with the browser nor with "
    "commands such as curl in code_run. Hand this to a subtask: end your "
    'reply with <subtask title="a few words">what to do</subtask>, with '
    "everything it needs (the goal, the facts the user gave, what this "
    "conversation already settled). Tell the user in a sentence that it is "
    "on its way; do not explain why it is not done here or cite this rule."
)


def _main_chat_refuses(tool_name: str) -> bool:
    """Whether this call is a browser tool in the managed main chat.

    All three must hold: the tool is a browser tool, the runner is the
    main chat's (GALLEY_MAIN_CHAT is exactly "1"), and the runtime is
    Galley's managed one (`managed_runtime.is_managed_runtime`, the
    bridge's own test). The last one keeps attach mode inert even if the
    variable leaked into an external GA's environment: there the handler
    subclass may only emit signals, never change dispatch or results
    (CLAUDE.md Rule 1). `code_run` and every other tool always run; a
    `curl` inside `code_run` is a known gap this guard does not close.
    """
    return (
        tool_name.startswith(BROWSER_TOOL_PREFIX)
        and os.environ.get(MAIN_CHAT_ENV) == "1"
        and managed_runtime.is_managed_runtime()
    )


class WorkbenchHandler(GenericAgentHandler):  # type: ignore[misc]  # GA has no stubs
    """GA handler that emits Galley's turn signal and forwards `tool_num`.

    It must not change tool dispatch or results (CLAUDE.md Rule 1): every
    call is delegated to GA's own dispatch unchanged, except, in the
    managed runtime's main chat, a browser tool (`_main_chat_refuses`) and
    the main chat's own `tell_user` (`runner/tell_user.py`).
    """

    def __init__(
        self,
        parent: Any,
        last_history: list[str] | None = None,
        cwd: str = "./temp",
        *,
        turn_started_callback: Callable[[int], None] | None = None,
        tell_user_callback: Callable[[str, int], bool] | None = None,
        step_text_callback: Callable[[Any, int], None] | None = None,
    ) -> None:
        super().__init__(parent, last_history, cwd)
        # The main chat's `tell_user` (ticket 137): hands the message and
        # the GA step that said it to the bridge, which sends it to Core;
        # False when it was not sent (the run had already ended).
        self._tell_user_callback: Callable[[str, int], bool] | None = (
            tell_user_callback
        )
        # A step's words before its tools run (ticket 142,
        # runner/step_text.py): hands the step's reply and its GA step
        # number to the bridge, which decides whether they go out.
        self._step_text_callback: Callable[[Any, int], None] | None = (
            step_text_callback
        )
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
        if _main_chat_refuses(tool_name):
            # Managed main chat only (ruling 184): the tool does not run
            # and GA's dispatch is not called. The step still shows: its
            # turn signal goes out here, as GA's dispatch path would have
            # sent it, and GA's loop records the call and this result for
            # turn_end like any tool's (returning before the first yield
            # is how GA's own tools end early; its loop reads the
            # StopIteration value). next_prompt="\n" as in GA's L1
            # refusal. Imported here so attach mode never touches it.
            from agent_loop import StepOutcome

            self.tool_before_callback(tool_name, args, response)
            return StepOutcome(
                {"status": "error", "msg": MAIN_CHAT_BROWSER_REFUSAL},
                next_prompt="\n",
            )
        if tool_name == tell_user.TOOL_NAME and tell_user.offered_here():
            # The managed main chat's own tool (ticket 137): GA has no
            # `do_tell_user`, so GA's dispatch is not called. The step
            # shows as any tool's (its turn signal here, its call and this
            # result in turn_end). Sent, the result says so and the run
            # goes on with GA's usual next prompt; otherwise GA's error
            # envelope and next_prompt="\n", as its own tools refuse.
            from agent_loop import StepOutcome

            self.tool_before_callback(tool_name, args, response)
            message = tell_user.message_of(args)
            if not message:
                return StepOutcome(dict(tell_user.EMPTY), next_prompt="\n")
            current = int(getattr(self, "current_turn", 0) or 0)
            sent = self._tell_user_callback is not None and self._tell_user_callback(
                message, current
            )
            if not sent:
                return StepOutcome(dict(tell_user.CLOSED), next_prompt="\n")
            return StepOutcome(
                dict(tell_user.SENT),
                next_prompt=self._get_anchor_prompt(skip=index > 0),
            )
        if index == 0 and self._step_text_callback is not None:
            # A step's words before its tools run (main chat ticket 142):
            # GA dispatches a reply's calls in order once the whole reply
            # is in, so the first dispatch is the earliest moment it is
            # complete and no tool of it has run. Read-only on `response`;
            # the bridge decides (runner/step_text.py: the managed main
            # chat, a run the user started). Never lets an emit error
            # reach GA's loop, like the turn signal.
            try:
                self._step_text_callback(
                    response, int(getattr(self, "current_turn", 0) or 0)
                )
            except Exception:
                pass
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
