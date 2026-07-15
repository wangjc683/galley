"""Unit tests for the GaSession adapter — the single GA-internals seam.

Everything here runs against SimpleNamespace fakes: the point of the
seam is precisely that this surface is testable without a live GA.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from runner.ga_session import GaSession, message_to_content_blocks

# ---------------- fakes ----------------


class NativeClaudeSession(SimpleNamespace):
    """Named to match GA's validated backend class."""


class NativeOAISession(SimpleNamespace):
    """Named to match GA's OAI backend — validated by code audit (it
    inherits NativeClaudeSession's ask()/history, so the in-memory
    shape is identical; see _VALIDATED_HISTORY_BACKENDS)."""


class LLMSession(SimpleNamespace):
    """Named to match one of GA's NOT-yet-validated backend classes."""


def _agent_with_backend(backend: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(llmclient=SimpleNamespace(backend=backend))


# ---------------- turn-end hooks ----------------


def test_register_turn_hook_creates_dict_and_registers() -> None:
    agent = SimpleNamespace()
    ga = GaSession(agent)

    def hook() -> None:
        pass

    ga.register_turn_hook("workbench_s1", hook)
    assert agent._turn_end_hooks == {"workbench_s1": hook}


def test_register_turn_hook_preserves_other_writers() -> None:
    # The hooks dict has two Galley consumers (workbench + pet); a
    # second registration must not clobber the first.
    agent = SimpleNamespace()
    ga = GaSession(agent)
    ga.register_turn_hook("workbench_s1", lambda: None)
    ga.register_turn_hook("galley_pet_s1", lambda: None)
    assert set(agent._turn_end_hooks) == {"workbench_s1", "galley_pet_s1"}


def test_unregister_turn_hook_is_idempotent_and_safe() -> None:
    agent = SimpleNamespace()
    ga = GaSession(agent)
    # No hooks dict at all: must not raise.
    ga.unregister_turn_hook("nope")
    ga.register_turn_hook("galley_pet_s1", lambda: None)
    ga.unregister_turn_hook("galley_pet_s1")
    ga.unregister_turn_hook("galley_pet_s1")
    assert agent._turn_end_hooks == {}


# ---------------- backend history ----------------


def test_history_returns_live_list_and_extend_appends() -> None:
    backend = NativeClaudeSession(history=[{"role": "user", "content": "x"}])
    ga = GaSession(_agent_with_backend(backend))

    assert ga.history() is backend.history
    ga.extend_history([{"role": "assistant", "content": "y"}])
    assert len(backend.history) == 2


def test_set_history_adapts_to_blocks_on_validated_backend() -> None:
    backend = NativeClaudeSession(history=[])
    ga = GaSession(_agent_with_backend(backend))

    warning = ga.set_history(
        [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
    )

    assert warning is None
    assert backend.history == [
        {"role": "user", "content": [{"type": "text", "text": "hello"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "hi there"}]},
    ]


def test_set_history_accepts_oai_backend_without_warning() -> None:
    # NativeOAISession shares NativeClaudeSession's in-memory history
    # shape (it inherits ask(); only the request-time conversion
    # differs), so restore is validated for it too.
    backend = NativeOAISession(history=[])
    ga = GaSession(_agent_with_backend(backend))

    warning = ga.set_history([{"role": "user", "content": "hello"}])

    assert warning is None
    assert len(backend.history) == 1


def test_set_history_warns_loudly_on_unvalidated_backend() -> None:
    # Pre-seam this was a silent blind write (PRD §10); the write still
    # happens, but the caller now gets a warning to surface.
    backend = LLMSession(history=[])
    ga = GaSession(_agent_with_backend(backend))

    warning = ga.set_history([{"role": "user", "content": "hello"}])

    assert warning is not None
    assert "LLMSession" in warning
    assert len(backend.history) == 1


def test_clear_last_tools_tolerates_missing_attribute() -> None:
    class Rigid:
        __slots__ = ()  # setattr raises

    ga = GaSession(SimpleNamespace(llmclient=Rigid()))
    ga.clear_last_tools()  # must not raise (older GA versions)

    client = SimpleNamespace(last_tools="stale")
    GaSession(SimpleNamespace(llmclient=client)).clear_last_tools()
    assert client.last_tools == ""


# ---------------- context usage ----------------


def test_context_usage_estimates_chars_and_limit() -> None:
    history = [{"role": "user", "content": "hello"}]
    backend = NativeClaudeSession(history=history, context_win=100)
    ga = GaSession(_agent_with_backend(backend))

    out = ga.context_usage()

    expected_used = len(json.dumps(history[0], ensure_ascii=False))
    assert out == {"contextUsedChars": expected_used, "contextLimitChars": 300}


def test_context_usage_degrades_to_empty_on_odd_agents() -> None:
    assert GaSession(SimpleNamespace()).context_usage() == {}
    assert GaSession(SimpleNamespace(llmclient=SimpleNamespace())).context_usage() == {}


# ---------------- namespaced state + handler binding ----------------


def test_set_project_mode_writes_namespaced_attrs() -> None:
    agent = SimpleNamespace()
    GaSession(agent).set_project_mode("demo", "/tmp/ws")
    assert agent._ga_project_mode_name == "demo"
    assert agent._ga_project_mode_workspace_path == "/tmp/ws"


def test_install_handler_rebinds_agentmain_module_name() -> None:
    class Handler:
        pass

    fake_agentmain = SimpleNamespace(GenericAgentHandler=object)
    GaSession(SimpleNamespace()).install_handler(fake_agentmain, Handler)
    assert fake_agentmain.GenericAgentHandler is Handler


# ---------------- message adaptation (moved with the seam) ----------------


def test_message_to_content_blocks_adds_image_blocks(tmp_path: Path) -> None:
    image = tmp_path / "shot.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n")

    blocks = message_to_content_blocks("look", [str(image)])

    assert blocks[0] == {"type": "text", "text": "look"}
    assert blocks[1]["type"] == "image"
    assert blocks[1]["source"]["media_type"] == "image/png"


def test_message_to_content_blocks_skips_missing_images(tmp_path: Path) -> None:
    blocks = message_to_content_blocks("look", [str(tmp_path / "gone.png")])
    assert blocks == [{"type": "text", "text": "look"}]


def test_message_to_content_blocks_passes_native_lists_through() -> None:
    native: list[Any] = [{"type": "text", "text": "already blocks"}]
    assert message_to_content_blocks(native) == native
