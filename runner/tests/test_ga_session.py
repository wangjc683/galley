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


# ---------------- side_ask (auto-title one-shot) ----------------


def test_side_ask_streams_raw_ask_without_touching_history() -> None:
    seen_wire: list[Any] = []

    def raw_ask(wire: Any) -> Any:
        seen_wire.append(wire)
        yield "登录"
        yield "超时排查"

    backend = NativeClaudeSession(history=[{"role": "user", "content": "x"}], raw_ask=raw_ask)
    ga = GaSession(_agent_with_backend(backend))

    out = ga.side_ask("title please", deadline=9e12)
    assert out == "登录超时排查"
    # Self-contained single message — history is NOT part of the wire.
    assert seen_wire == [[{"role": "user", "content": [{"type": "text", "text": "title please"}]}]]
    assert backend.history == [{"role": "user", "content": "x"}]


def test_side_ask_prefers_make_messages_when_available() -> None:
    def make_messages(msgs: Any) -> Any:
        return [{"converted": True, "count": len(msgs)}]

    def raw_ask(wire: Any) -> Any:
        assert wire == [{"converted": True, "count": 1}]
        yield "ok"

    backend = NativeClaudeSession(
        history=[], raw_ask=raw_ask, make_messages=make_messages
    )
    ga = GaSession(_agent_with_backend(backend))
    assert ga.side_ask("q", deadline=9e12) == "ok"


def test_side_ask_stops_at_deadline() -> None:
    def raw_ask(wire: Any) -> Any:
        yield "partial"
        yield "never-appended"

    backend = NativeClaudeSession(history=[], raw_ask=raw_ask)
    ga = GaSession(_agent_with_backend(backend))
    # Deadline already passed: the loop stops after the first chunk and
    # reports nothing — a truncated answer (on a thinking model, the
    # reasoning) must never reach the sidebar.
    assert ga.side_ask("q", deadline=0.0) == ""


def test_side_ask_reads_text_blocks_not_streamed_thinking() -> None:
    """Attach mode has no patch 0016: upstream streams native reasoning
    as plain chunks. The return value keeps the block types, so the
    title comes from `text` blocks only."""

    def raw_ask(wire: Any) -> Any:
        yield "The user wants a short conversation title. "
        yield "登录超时排查"
        return [
            {"type": "thinking", "thinking": "The user wants a short conversation title. "},
            {"type": "text", "text": "登录超时排查"},
        ]

    backend = NativeClaudeSession(history=[], raw_ask=raw_ask)
    assert GaSession(_agent_with_backend(backend)).side_ask("q", deadline=9e12) == "登录超时排查"


def test_side_ask_falls_back_to_stream_without_text_blocks() -> None:
    def only_thinking(wire: Any) -> Any:
        yield "hmm"
        return [{"type": "thinking", "thinking": "hmm"}]

    def not_a_list(wire: Any) -> Any:
        yield "plain"
        return "plain"

    for raw_ask, expected in ((only_thinking, "hmm"), (not_a_list, "plain")):
        backend = NativeClaudeSession(history=[], raw_ask=raw_ask)
        assert GaSession(_agent_with_backend(backend)).side_ask("q", deadline=9e12) == expected


# ---------------- attach-mode image delivery ----------------


class NativeToolClient(SimpleNamespace):
    """Named to match GA's tool-calling client (the only one whose
    backend.ask receives a block-list message)."""


class ToolClient(SimpleNamespace):
    """Named to match GA's legacy text-protocol client."""


class _AskBackend:
    """Backend whose `ask` is a class-level generator method, like
    GA's NativeClaudeSession.ask. Records what it received."""

    def __init__(self) -> None:
        self.seen: list[dict[str, Any]] = []
        self.history: list[Any] = []

    def ask(self, msg: dict[str, Any]) -> Any:
        self.seen.append(msg)
        self.history.append(msg)
        yield "chunk"
        return "resp"


def _png(tmp_path: Path, name: str = "a.png") -> str:
    p = tmp_path / name
    p.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    return str(p)


def _drain(gen: Any) -> Any:
    out: list[Any] = []
    try:
        while True:
            out.append(next(gen))
    except StopIteration as e:
        return out, e.value


def test_supports_image_input_only_for_native_tool_client() -> None:
    native = SimpleNamespace(llmclient=NativeToolClient(backend=_AskBackend()))
    legacy = SimpleNamespace(llmclient=ToolClient(backend=_AskBackend()))
    no_client = SimpleNamespace()
    assert GaSession(native).supports_image_input() is True
    assert GaSession(legacy).supports_image_input() is False
    assert GaSession(no_client).supports_image_input() is False


def test_arm_image_delivery_appends_once_then_restores(tmp_path: Path) -> None:
    backend = _AskBackend()
    agent = SimpleNamespace(llmclient=NativeToolClient(backend=backend))
    ga = GaSession(agent)

    assert ga.arm_image_delivery([_png(tmp_path)]) == 1
    assert "ask" in backend.__dict__

    first: dict[str, Any] = {"role": "user", "content": [{"type": "text", "text": "look"}]}
    chunks, value = _drain(backend.ask(first))
    assert chunks == ["chunk"] and value == "resp"
    types = [b["type"] for b in first["content"]]
    assert types == ["text", "image"]
    assert first["content"][1]["source"]["media_type"] == "image/png"
    # Same dict object reached the backend and its history.
    assert backend.seen[0] is first and backend.history[0] is first
    # Wrapper is gone after the first call: class method is back and a
    # second call gets no image.
    assert "ask" not in backend.__dict__
    second: dict[str, Any] = {"role": "user", "content": [{"type": "text", "text": "again"}]}
    _drain(backend.ask(second))
    assert [b["type"] for b in second["content"]] == ["text"]


def test_disarm_removes_an_uncalled_wrapper(tmp_path: Path) -> None:
    backend = _AskBackend()
    agent = SimpleNamespace(llmclient=NativeToolClient(backend=backend))
    ga = GaSession(agent)
    ga.arm_image_delivery([_png(tmp_path)])
    ga.disarm_image_delivery()
    assert "ask" not in backend.__dict__
    assert agent._galley_image_ask_restore is None
    msg: dict[str, Any] = {"role": "user", "content": [{"type": "text", "text": "next task"}]}
    _drain(backend.ask(msg))
    assert [b["type"] for b in msg["content"]] == ["text"]
    ga.disarm_image_delivery()  # idempotent


def test_arm_does_not_duplicate_when_an_image_block_is_present(
    tmp_path: Path,
) -> None:
    """Future-proofing: if upstream run() ever consumes put_task(images=)
    itself, the first message already carries the blocks."""
    backend = _AskBackend()
    agent = SimpleNamespace(llmclient=NativeToolClient(backend=backend))
    GaSession(agent).arm_image_delivery([_png(tmp_path)])
    already = {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "x"},
    }
    msg: dict[str, Any] = {"role": "user", "content": [{"type": "text", "text": "t"}, already]}
    _drain(backend.ask(msg))
    assert msg["content"] == [{"type": "text", "text": "t"}, already]
    assert "ask" not in backend.__dict__


def test_arm_returns_zero_for_unsupported_client_or_unreadable_images(
    tmp_path: Path,
) -> None:
    backend = _AskBackend()
    legacy = SimpleNamespace(llmclient=ToolClient(backend=backend))
    assert GaSession(legacy).arm_image_delivery([_png(tmp_path)]) == 0
    assert "ask" not in backend.__dict__

    native = SimpleNamespace(llmclient=NativeToolClient(backend=backend))
    missing = str(tmp_path / "nope.png")
    gif = tmp_path / "x.gif"
    gif.write_bytes(b"GIF89a")
    assert GaSession(native).arm_image_delivery([missing, str(gif)]) == 0
    assert "ask" not in backend.__dict__


def test_arm_counts_only_encodable_images(tmp_path: Path) -> None:
    backend = _AskBackend()
    native = SimpleNamespace(llmclient=NativeToolClient(backend=backend))
    ok = _png(tmp_path)
    assert GaSession(native).arm_image_delivery([ok, str(tmp_path / "no.png")]) == 1
    msg: dict[str, Any] = {"role": "user", "content": [{"type": "text", "text": "t"}]}
    _drain(backend.ask(msg))
    assert len(msg["content"]) == 2


def test_rearm_replaces_a_stale_wrapper_and_restore_respects_prior_instance_ask(
    tmp_path: Path,
) -> None:
    backend = _AskBackend()

    def someone_elses_ask(msg: dict[str, Any]) -> Any:
        msg["content"].append({"type": "text", "text": "[other]"})
        yield "o"
        return "other"

    backend.ask = someone_elses_ask  # type: ignore[method-assign]
    native = SimpleNamespace(llmclient=NativeToolClient(backend=backend))
    ga = GaSession(native)
    ga.arm_image_delivery([_png(tmp_path)])
    ga.arm_image_delivery([_png(tmp_path, "b.png")])  # re-arm: old one dropped
    msg: dict[str, Any] = {"role": "user", "content": [{"type": "text", "text": "t"}]}
    _drain(backend.ask(msg))
    kinds = [b["type"] for b in msg["content"]]
    assert kinds == ["text", "image", "text"]  # one image, then the other wrapper ran
    assert msg["content"][1]["source"]["data"]
    # The prior instance-level ask is back in place, not deleted.
    assert backend.__dict__["ask"] is someone_elses_ask
