"""GaSession — the ONE module that touches GenericAgent internals.

The AGENTS.md constitution (Rule 1) allows a fixed set of integration
points into a user-owned GA and obliges us to re-audit every internal
touch on each GA baseline upgrade. Before this module those touches were
scattered across ~10 inline reach-ins in ``workbench_bridge.py``; now the
re-audit surface IS this file: read it top to bottom, confirm each
coupling against the new baseline, done.

Scope rule (2026-07-11 decision): GaSession wraps exactly the
*internal / underscore / backend* surface — the things a baseline
upgrade can silently move:

- ``agent._turn_end_hooks``       → register_turn_hook
- ``agent.llmclient.backend.history`` → set_history / context_usage
- ``agent.llmclient.backend.raw_ask`` → side_ask (read-only one-shot,
                                        no history write)
- ``agent.llmclient.backend.reasoning_effort`` → active_backend_id /
                                        reasoning_effort /
                                        set_reasoning_effort (session
                                        override, same in-process write
                                        as upstream's
                                        ``/session.reasoning_effort=``)
- ``agent._ga_project_mode_*``    → set_project_mode (Galley-namespaced,
                                    in-memory only per Rule 1)
- ``agentmain.GenericAgentHandler`` module binding → install_handler
- ``agent.llmclient.backend.ask`` one-shot wrapper → arm_image_delivery /
                                    disarm_image_delivery (attach-mode
                                    image input; Rule 1 lists this seam)
- ``agent.intervene``             → set_intervene (managed main chat
                                    only, main chat ticket 136: what the
                                    user said mid-run, for the next step)
- turn-end hook locals ``injprompt`` / ``exit_reason`` → injected_intervene
                                    (read-only: what GA's
                                    ``turn_end_callback`` took from
                                    ``intervene``, ``ga.py:594``)
- ``agentmain.TOOLS_SCHEMA``      → offer_tool (managed main chat only,
                                    main chat ticket 137: the tool list
                                    ``run()`` hands each task's loop gains
                                    ``tell_user``, which the handler
                                    subclass answers)
- ``plugins.hooks`` ``agent_before`` → arm_inline_prompt (managed main
                                    chat only, main chat ticket 147: a
                                    wake note over 2,000 characters
                                    reaches the model in full, not as
                                    upstream's "Long user prompt saved
                                    to …"; the round's user message and
                                    its working-memory line)

GA's *public* API (``next_llm``, ``verbose``, ``inc_out``, ``put_task``,
``list_llms``) stays direct on ``bridge.agent`` — the constitution
explicitly allows it, and wrapping it would add indirection without
hiding anything upgrade-fragile.

Sibling seam, deliberately NOT folded in here: the only other
``backend`` write in the tree is
``managed_runtime.install_managed_prompt_profile`` (``extra_sys_prompt``)
— already a named single-function seam, shared with the Bridge-less
``managed_im_supervisor`` path. Audit both places.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import re
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

# Backend session classes whose history shape the restore adaptation has
# been validated against:
#
# - NativeClaudeSession: E2E, GLM 5.1 via native_claude config.
# - NativeOAISession: by code audit (2026-07-15, managed-ga llmcore.py).
#   It subclasses NativeClaudeSession and inherits `ask()`, so its
#   in-memory history is the SAME Claude-block shape the validated path
#   uses; only `raw_ask` differs, converting at request time via
#   `_msgs_claude2oai`, which handles both block types this module
#   injects (`text`, base64 `image`). Read-only coupling point: if
#   upstream GA stops inheriting ask()/history there, drop it from this
#   set.
#
# Other GA session classes (ClaudeSession, LLMSession, MixinSession)
# receive the same write but with a loud warning — tracked as PRD §10
# open item.
_VALIDATED_HISTORY_BACKENDS = {"NativeClaudeSession", "NativeOAISession"}

_SUPPORTED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}


def _mime_for_image_path(path: Path) -> str | None:
    mime, _ = mimetypes.guess_type(path.name)
    if mime in _SUPPORTED_IMAGE_MIMES:
        return mime
    suffix = path.suffix.lower()
    if suffix == ".jpg":
        return "image/jpeg"
    if suffix == ".jpeg":
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return None


def _image_path_to_content_block(path_value: Any) -> dict[str, Any] | None:
    if not isinstance(path_value, str) or not path_value:
        return None
    path = Path(path_value)
    if not path.is_file():
        return None
    mime = _mime_for_image_path(path)
    if mime is None:
        return None
    try:
        data = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": mime, "data": data},
    }


def message_to_content_blocks(content: Any, images: Any = None) -> list[Any]:
    """Adapt one desktop-shape message (string content + image paths,
    docs/ipc-protocol.md §8.4) into GA's native content-block list."""
    if isinstance(content, str):
        blocks: list[Any] = [{"type": "text", "text": content}]
    elif isinstance(content, list):
        blocks = list(content)  # assume already native shape
    else:
        blocks = [{"type": "text", "text": str(content)}]

    if isinstance(images, list):
        for image_path in images:
            block = _image_path_to_content_block(image_path)
            if block is not None:
                blocks.append(block)
    return blocks


# What upstream `GenericAgent.run()` hands the loop in place of a task over
# 2,000 characters, which it saved to a file (agentmain.py).
_LONG_PROMPT_POINTER = re.compile(
    r"Long user prompt saved to .+\. Read and execute\.", re.DOTALL
)
_inline_hook_registered = False


def _inline_prompt(ctx: dict[str, Any]) -> None:
    """GA's `agent_before` hook (see GaSession.arm_inline_prompt): the
    armed task in place of upstream's pointer to the file it saved it to,
    and the working-memory line upstream writes for a task it keeps.
    Inert unless this run's agent was armed; disarms it."""
    handler = ctx.get("handler")
    agent = getattr(handler, "parent", None)
    text = getattr(agent, "_galley_inline_prompt", None)
    if agent is None or not isinstance(text, str):
        return
    agent._galley_inline_prompt = None
    pointer = ctx.get("user_input")
    if not isinstance(pointer, str) or not _LONG_PROMPT_POINTER.fullmatch(pointer):
        return
    user = next(
        (
            m
            for m in reversed(ctx.get("messages") or [])
            if isinstance(m, dict) and m.get("role") == "user"
        ),
        None,
    )
    content = user.get("content") if user else None
    if user is None or not isinstance(content, str) or not content.startswith(pointer):
        return
    # A plugin may have added to the message after the pointer
    # (upstream's project mode does); that stays.
    user["content"] = text + content[len(pointer) :]
    smart_format = getattr(sys.modules.get("ga"), "smart_format", None)
    history = getattr(handler, "history_info", None)
    if not callable(smart_format) or not isinstance(history, list) or not history:
        return
    if history[-1] == "[USER]: " + smart_format(pointer.replace("\n", " "), max_str_len=200):
        history[-1] = "[USER]: " + smart_format(text.replace("\n", " "), max_str_len=200)


def _register_inline_hook() -> bool:
    """Register `_inline_prompt` once per process with the hooks module
    GA's loop triggers (`agent_loop.py` imports its `trigger`). False when
    GA has no hooks module."""
    global _inline_hook_registered
    if _inline_hook_registered:
        return True
    hooks = sys.modules.get("plugins.hooks")
    register = getattr(hooks, "register", None)
    if not callable(register):
        return False
    register("agent_before")(_inline_prompt)
    _inline_hook_registered = True
    return True


class GaSession:
    """Adapter over one live GA agent's upgrade-fragile internals.

    Constructed once per bridge in ``Bridge._setup_ga``; tests construct
    it around a ``SimpleNamespace`` fake. Methods keep the exact
    behavior of the inline reach-ins they replaced — this module changes
    where the knowledge lives, not what happens at runtime.
    """

    def __init__(self, agent: Any) -> None:
        self.agent = agent
        # Backend objects whose id() has been handed out (see
        # active_backend_id); retained so the id stays unique.
        self._pinned_backends: dict[int, Any] = {}

    # ---------------- turn-end hooks ----------------
    # GA's agent_runner_loop calls each registered hook after every
    # loop step. The dict lives on the agent object; Galley's consumer
    # (workbench turn streaming) registers here.

    def register_turn_hook(self, key: str, fn: Callable[..., Any]) -> None:
        if not hasattr(self.agent, "_turn_end_hooks"):
            self.agent._turn_end_hooks = {}
        self.agent._turn_end_hooks[key] = fn

    # ---------------- mid-run messages (main chat ticket 136) ----------------
    # GA's own seam for a message that reaches a running task: every
    # step's `turn_end_callback` reads `agent.intervene`, appends it to
    # the next step's prompt as `[MASTER] …` and sets it to None, then
    # calls the turn-end hooks with its locals (`injprompt` is what it
    # took). Managed runtime's main chat only (runner/interject.py): the
    # constitution lets attach mode read hook locals but never write GA
    # state.

    def set_intervene(self, text: str | None) -> None:
        """Write `agent.intervene` (None clears it)."""
        self.agent.intervene = text

    @staticmethod
    def injected_intervene(ctx: dict[str, Any]) -> str | None:
        """What GA's `turn_end_callback` took from `intervene` this step
        (its `injprompt` local), or None."""
        value = ctx.get("injprompt")
        return value if isinstance(value, str) and value else None

    # ---------------- a tool of Galley's own (main chat ticket 137) ----------------
    # `GenericAgent.run()` hands each task's loop the module global
    # `agentmain.TOOLS_SCHEMA` (read when the task starts), and
    # `load_tool_schema()` rebinds that global to a fresh list (GA calls it
    # in `next_llm`), so a tool added once is gone after a model switch:
    # the bridge offers it again before every `put_task`. GA has no
    # `do_<name>` for it; `runner.handlers.WorkbenchHandler.dispatch`
    # answers the call. Managed main chat only (runner/tell_user.py): an
    # in-memory write to GA's module state, which attach mode never gets
    # (CLAUDE.md Rule 1). Coupling point, re-audit at GA baseline upgrades.

    @staticmethod
    def offer_tool(
        agentmain_module: Any, entry: Callable[[list[Any]], dict[str, Any]]
    ) -> bool:
        """Add the tool `entry(tools)` describes to the tool list the next
        task's loop gets, unless one of that name is there. False when
        agentmain holds no tool list."""
        tools = getattr(agentmain_module, "TOOLS_SCHEMA", None)
        if not isinstance(tools, list):
            return False
        wanted = entry(tools)
        name = wanted.get("function", {}).get("name")
        if not any(
            isinstance(t, dict) and t.get("function", {}).get("name") == name
            for t in tools
        ):
            tools.append(wanted)
        return True

    # ---------------- a wake note in full (main chat ticket 147) ----------------
    # Upstream `GenericAgent.run()` saves a task over 2,000 characters to
    # `temp/user_prompt_<pid>_<ns>.md` and starts the loop on one line, "Long
    # user prompt saved to <path>. Read and execute." A note Core wakes the
    # main chat with (subtask reports, a reminder, the morning review) often
    # runs longer: a batch of reports, each answer up to 3,000 characters
    # (core/src/subtask_report.rs), and the model's first step was reading
    # that file back (v0.7.6 smoke S3, PRD ruling 198). For such a run the
    # bridge arms the note; GA's own `agent_before` hook (`plugins.hooks`, the
    # seam upstream's `plugins/project_mode.py` uses to add to a round's user
    # message) puts it back where the pointer stands before the first model
    # call, and turns the working-memory line upstream wrote for the pointer
    # into the one it writes for a task it keeps. One run: the hook disarms
    # the agent on its first call, and the bridge arms or clears it before
    # every task. Managed main chat only (CLAUDE.md Rule 1); the user's own
    # long messages keep upstream's path. Coupling points, re-audit at GA
    # baseline upgrades: the pointer's wording; `agent_runner_loop`
    # triggering `agent_before` with its locals (`messages`, `user_input`,
    # `handler`) before its first model call; the `[USER]:` line `run()`
    # appends to the history the handler holds (`smart_format(task, 200)`).

    def arm_inline_prompt(self, text: str | None) -> bool:
        """The next task's text, to reach the model in full even when
        upstream saves it to a file; None leaves the next task to upstream.
        False when GA has no hooks module to do it with (the task then
        goes upstream's way)."""
        self.agent._galley_inline_prompt = text
        return text is None or _register_inline_hook()

    # ---------------- backend history ----------------

    def set_history(self, messages: list[dict[str, Any]]) -> str | None:
        """Replace backend history with desktop-shape ``messages``
        adapted to GA's native block format.

        Returns a warning string (caller surfaces it) when the backend's
        session class is not in the validated set — the write still
        happens (some shapes may be compatible), but silently-corrupted
        restores become visible instead of invisible. PRD §10 tracks
        per-class adapters.
        """
        adapted = []
        for m in messages:
            role = m.get("role")
            blocks = message_to_content_blocks(
                m.get("content", ""),
                m.get("images", []),
            )
            adapted.append({"role": role, "content": blocks})
        backend = self.agent.llmclient.backend
        backend_class = type(backend).__name__
        backend.history = adapted
        if backend_class not in _VALIDATED_HISTORY_BACKENDS:
            return (
                f"history restore is only validated for "
                f"{sorted(_VALIDATED_HISTORY_BACKENDS)}; this session runs "
                f"{backend_class} — restored context may be incomplete or "
                f"malformed (PRD §10)"
            )
        return None

    # ---------------- attach-mode image input ----------------
    # Upstream `GenericAgent.put_task(images=)` accepts image paths but
    # upstream `run()` never consumes them, and `NativeToolClient.chat`
    # drops every non-text block before calling `backend.ask`. The
    # bundled runtime fixes both with patch 0008; attach mode may not
    # patch the user's checkout, so the runner does what upstream's own
    # `frontends/desktop_bridge.py::_patch_chat_for_images` does: wrap
    # `backend.ask` for exactly one call and append the image blocks to
    # the first user message of the task. AGENTS.md Rule 1 lists this
    # seam explicitly. The wrapper is process-local, adds blocks only,
    # removes itself on its first call, and the bridge disarms it at run
    # end so an aborted-before-first-call task cannot leak images into
    # the next one. Coupling points, re-audit on GA baseline upgrades:
    # `llmcore.NativeToolClient.chat` calls `self.backend.ask(merged)`
    # with `merged["content"]` a block list, and
    # `NativeClaudeSession.ask(msg)` appends that same dict to
    # `backend.history`, so an in-place append also lands in history.

    def supports_image_input(self) -> bool:
        """True when the current client is upstream's `NativeToolClient`
        (the only client whose `backend.ask` receives a block-list
        message). Class-name check, same style as
        `_VALIDATED_HISTORY_BACKENDS`."""
        client = getattr(self.agent, "llmclient", None)
        backend = getattr(client, "backend", None)
        return type(client).__name__ == "NativeToolClient" and callable(
            getattr(backend, "ask", None)
        )

    def arm_image_delivery(self, image_paths: list[str]) -> int:
        """Install the one-shot `backend.ask` wrapper carrying the
        encodable images in `image_paths`. Returns how many images will
        be delivered; 0 means nothing was installed (unsupported client
        or no readable image), and the caller should tell the user."""
        self.disarm_image_delivery()
        if not self.supports_image_input():
            return 0
        blocks = [
            block
            for block in (_image_path_to_content_block(p) for p in image_paths)
            if block is not None
        ]
        if not blocks:
            return 0
        backend = self.agent.llmclient.backend
        # `ask` is normally a class method; an instance attribute means
        # someone else already wrapped it. Either way `original_ask` is
        # what we call through and what `restore` puts back.
        prior_instance_ask = backend.__dict__.get("ask")
        original_ask = backend.ask

        def restore() -> None:
            if backend.__dict__.get("ask") is not patched_ask:
                return
            if prior_instance_ask is None:
                del backend.ask
            else:
                backend.ask = prior_instance_ask
            if getattr(self.agent, "_galley_image_ask_restore", None) is restore:
                self.agent._galley_image_ask_restore = None

        def patched_ask(msg: Any) -> Any:
            restore()
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, list) and not any(
                isinstance(b, dict) and b.get("type") == "image" for b in content
            ):
                content.extend(blocks)
            return (yield from original_ask(msg))

        backend.ask = patched_ask
        self.agent._galley_image_ask_restore = restore
        return len(blocks)

    def disarm_image_delivery(self) -> None:
        """Remove an armed wrapper that was never called (task aborted or
        finished before its first LLM call). Idempotent."""
        restore = getattr(self.agent, "_galley_image_ask_restore", None)
        if callable(restore):
            restore()

    def side_ask(self, prompt: str, deadline: float) -> str:
        """One-shot out-of-band question to the session's current backend.

        Unlike `/btw` (frontends/btw_cmd.py) this sends a single
        self-contained user message with NO history snapshot, so no
        deepcopy/lock dance is needed. Dispatch mirrors btw_cmd's
        `_build_wire`: BaseSession subclasses get `make_messages`,
        Native* backends take raw pairs (raw_ask runs its own
        transforms).

        Read-only coupling point: `backend.raw_ask` never mutates
        `backend.history` — the same contract btw_cmd.py and core's
        connectivity probe (`runner_commands/probe.rs`) already rely
        on. First consumer: the auto-title `generate_title` command.
        Re-audit at GA baseline upgrades.

        Carries the session system prompt. `raw_ask` sets
        `payload["system"] = self.system` (llmcore.py), so "no history"
        does NOT mean "no context": every standing output mandate still
        applies — `<summary>` from `assets/sys_prompt.txt` and, in managed
        mode, `<next-suggestion>` from `core/src/managed_prompt.rs`. A
        caller asking for a bare value must exempt itself from those
        explicitly, or the model resolves the contradiction on its own
        (see `_build_title_prompt`, and devlog 2026-08-10). Callers must
        not work around this by mutating `backend.system`: that breaks the
        read-only contract above and races any concurrently running turn.
        """
        backend = self.agent.llmclient.backend
        user_msg = {
            "role": "user",
            "content": [{"type": "text", "text": prompt}],
        }
        if hasattr(backend, "make_messages"):
            wire = backend.make_messages([user_msg])
        else:
            wire = [user_msg]
        # Prefer the generator's *return value* over the streamed chunks.
        # Every Native* `raw_ask` returns `list[content_block]` with typed
        # `thinking` / `text` blocks, while the stream mixes native
        # reasoning into the text (`_parse_claude_sse` yields
        # `thinking_delta` raw; managed patch 0016 wraps it in
        # `<thinking>` tags, attach mode has no such patch). Reading the
        # blocks is what keeps a thinking model's reasoning ("The user
        # wants a short conversation title...") out of the sidebar. The
        # streamed text remains the fallback when the backend returns no
        # block list. A deadline cut returns "" instead of the partial
        # stream: on a thinking model the partial is the reasoning
        # ("The" / "The user wants a short conversation title. The
        # conversation"), and a half title is no better — the caller's
        # silent-failure contract lets Core retry at the next run.
        # Read-only coupling point, re-audit at GA baseline upgrades.
        text = ""
        gen = backend.raw_ask(wire)
        blocks: Any = None
        while True:
            try:
                chunk = next(gen)
            except StopIteration as stop:
                blocks = stop.value
                break
            text += chunk
            if time.time() > deadline:
                return ""
        if isinstance(blocks, list):
            texts = [
                b.get("text", "")
                for b in blocks
                if isinstance(b, dict) and b.get("type") == "text"
            ]
            if any(t.strip() for t in texts):
                return "".join(texts)
        return text

    def context_usage(self) -> dict[str, int]:
        """Estimate backend context usage without mutating runtime state.

        ``context_win`` is in tokens; the ×3 chars-per-token heuristic
        matches what the desktop's context meter expects.
        """
        try:
            backend = getattr(getattr(self.agent, "llmclient", None), "backend", None)
            if backend is None:
                return {}
            history = getattr(backend, "history", None) or []
            used = sum(
                len(json.dumps(message, ensure_ascii=False)) for message in history
            )
            limit = int(getattr(backend, "context_win", 0) or 0) * 3
        except Exception:
            return {}
        out: dict[str, int] = {}
        if used >= 0:
            out["contextUsedChars"] = used
        if limit > 0:
            out["contextLimitChars"] = limit
        return out

    # ---------------- session request options ----------------

    def active_backend_id(self) -> int | None:
        """Identity of the live backend object, or None when the agent
        has no client yet.

        GA rebuilds its client objects wherever it calls
        ``load_llm_sessions`` (``GenericAgent.__init__``, ``next_llm``,
        ``list_llms``, and since upstream ``2ba5529`` the start and end of
        every task in ``run()``), and only when the model config changed
        on disk, so a caller that memorizes per-backend state keys it on
        this id and re-reads after a rebuild. The bridge settles the
        task-start rebuild before ``put_task`` (``_settle_llm_clients``).

        The object is pinned for the life of this session: CPython reuses
        ``id()`` values once an object is collected, and a rebuilt backend
        that landed on a freed id would otherwise inherit the memo of the
        backend Galley had already written to. A handful of retained
        client objects per session is negligible.
        """
        backend = getattr(getattr(self.agent, "llmclient", None), "backend", None)
        if backend is None:
            return None
        self._pinned_backends.setdefault(id(backend), backend)
        return id(backend)

    def reasoning_effort(self) -> str | None:
        """The reasoning-effort value the active backend currently
        carries. None when unset (no parameter is sent) or when there is
        no live backend — a backend that never had the attribute simply
        lacks it, so read defensively."""
        backend = getattr(getattr(self.agent, "llmclient", None), "backend", None)
        if backend is None:
            return None
        value = getattr(backend, "reasoning_effort", None)
        return None if value is None else str(value)

    def set_reasoning_effort(self, value: str | None) -> bool:
        """Write the session's reasoning effort onto the active backend.

        This is exactly what upstream's public slash command
        ``/session.reasoning_effort=high`` does
        (``agentmain._handle_slash_cmd`` → ``setattr(self.llmclient
        .backend, k, v)``): process-local, read by the backend at
        request time, never persisted — so it stays inside Rule 1 for a
        user-owned GA. ``MixinSession.__setattr__`` forwards it to the
        routed sessions.

        Returns False when there is no live backend to write to.
        Exceptions from the backend's own ``__setattr__`` propagate; the
        caller reports them.
        """
        backend = getattr(getattr(self.agent, "llmclient", None), "backend", None)
        if backend is None:
            return False
        # Plain assignment, not setattr(): upstream's slash command uses
        # setattr only because its key is dynamic. Same write either way,
        # and MixinSession.__setattr__ still fans it out.
        backend.reasoning_effort = value
        return True

    # ---------------- Galley-namespaced session state ----------------

    def set_project_mode(self, name: str | None, workspace_path: str | None) -> None:
        """Galley-namespaced in-memory attributes (Rule 1: live and die
        with the child process, never persisted into GA files)."""
        self.agent._ga_project_mode_name = name
        self.agent._ga_project_mode_workspace_path = workspace_path

    # ---------------- module-level handler binding ----------------

    def install_handler(self, agentmain_module: Any, handler_cls: type) -> None:
        """Point agentmain's ``GenericAgentHandler`` binding at Galley's
        subclass. agentmain bound the name at import time (``from ga
        import GenericAgentHandler``), so we patch the *agentmain*
        module's binding, not ga's — agentmain.run() looks the name up
        in its own globals."""
        agentmain_module.GenericAgentHandler = handler_cls
