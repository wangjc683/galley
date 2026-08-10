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

- ``agent._turn_end_hooks``       → register/unregister_turn_hook
- ``agent.llmclient.backend.history`` → history / set_history /
                                        extend_history / context_usage
- ``agent.llmclient.backend.raw_ask`` → side_ask (read-only one-shot,
                                        no history write)
- ``agent.llmclient.last_tools``  → clear_last_tools
- ``agent._ga_project_mode_*``    → set_project_mode (Galley-namespaced,
                                    in-memory only per Rule 1)
- ``agentmain.GenericAgentHandler`` module binding → install_handler

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


class GaSession:
    """Adapter over one live GA agent's upgrade-fragile internals.

    Constructed once per bridge in ``Bridge._setup_ga``; tests construct
    it around a ``SimpleNamespace`` fake. Methods keep the exact
    behavior of the inline reach-ins they replaced — this module changes
    where the knowledge lives, not what happens at runtime.
    """

    def __init__(self, agent: Any) -> None:
        self.agent = agent

    # ---------------- turn-end hooks ----------------
    # GA's agent_runner_loop calls each registered hook after every
    # loop step. The dict lives on the agent object; both Galley
    # consumers (workbench turn streaming, desktop pet) register here.

    def register_turn_hook(self, key: str, fn: Callable[..., Any]) -> None:
        if not hasattr(self.agent, "_turn_end_hooks"):
            self.agent._turn_end_hooks = {}
        self.agent._turn_end_hooks[key] = fn

    def unregister_turn_hook(self, key: str) -> None:
        """Best-effort removal — safe on agents that never had hooks."""
        try:
            hooks = getattr(self.agent, "_turn_end_hooks", None)
            if isinstance(hooks, dict):
                hooks.pop(key, None)
        except Exception:
            pass

    # ---------------- backend history ----------------

    def history(self) -> list[Any]:
        """The live backend history list. Raises AttributeError-family
        errors when the backend isn't shaped as expected — callers own
        the error narration (their messages are user-facing)."""
        result: list[Any] = self.agent.llmclient.backend.history
        return result

    def extend_history(self, blocks: list[Any]) -> None:
        self.history().extend(blocks)

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
        text = ""
        for chunk in backend.raw_ask(wire):
            text += chunk
            if time.time() > deadline:
                break
        return text

    def clear_last_tools(self) -> None:
        """Reset GA's per-LLM "last seen tools" cache so the next prompt
        rebuilds the tool block from scratch (mirrors stapp.py). Older
        GA versions lack the attribute — non-fatal by design."""
        try:
            self.agent.llmclient.last_tools = ""
        except Exception:
            pass

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
