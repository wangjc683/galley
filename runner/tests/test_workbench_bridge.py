"""Unit tests for module-level helpers in runner.workbench_bridge.

Heavy integration is in test_e2e.py. This file covers pure-function helpers
that don't need a GA subprocess: error classification and LLM display names.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

import runner.managed_runtime as managed_runtime
from runner.ga_session import message_to_content_blocks as _message_to_content_blocks
from runner.ipc import (
    AbortCommand,
    AskUserResponseCommand,
    ShutdownCommand,
    TurnProgressEvent,
    UserMessageCommand,
)
from runner.workbench_bridge import (
    Bridge,
    SessionState,
    _classify_error,
    _FenceFilter,
    _llm_display_name,
    _managed_model_config_from_env,
)

# ---------------- _classify_error ----------------


def _new_test_bridge() -> Bridge:
    return Bridge(
        ga_path="/tmp/ga",
        session_id="s1",
        cwd=None,
        llm_no=0,
        llm_name=None,
        stdout=StringIO(),
        stdin=StringIO(),
    )


def _next_bridge_event(bridge: Bridge) -> dict[str, Any]:
    line = bridge.event_queue.get_nowait()
    assert line is not None, "unexpected writer-exit sentinel"
    return cast("dict[str, Any]", json.loads(line))


@pytest.mark.parametrize(
    "message,expected_hint",
    [
        # check_llm_config: auth-class keywords
        ("Authentication failed: invalid api_key", "check_llm_config"),
        ("HTTP 401 Unauthorized", "check_llm_config"),
        ("403 Forbidden: invalid key", "check_llm_config"),
        ("Authentication error", "check_llm_config"),
        # quota_exceeded: rate / quota keywords
        ("Quota exceeded for this month", "quota_exceeded"),
        ("HTTP 429 Too Many Requests", "quota_exceeded"),
        ("rate_limit triggered", "quota_exceeded"),
        # network: transport-class keywords
        ("Connection refused by api.anthropic.com", "network"),
        ("Request timed out after 30s", "network"),
        ("DNS resolution failed", "network"),
    ],
)
def test_classify_runtime_error_with_hint(message: str, expected_hint: str) -> None:
    """Runtime errors with known patterns get the matching hint."""
    hint, retryable = _classify_error(message, "runtime")
    assert hint == expected_hint
    assert retryable is True


def test_classify_runtime_error_unclassified() -> None:
    """Runtime errors without a keyword match stay retryable but get no hint."""
    hint, retryable = _classify_error("Something weird happened", "runtime")
    assert hint is None
    assert retryable is True


def test_classify_bridge_error_no_hint() -> None:
    """Bridge errors don't get hints — they're internal faults the user can't act on.

    Even if the bridge error message happens to contain LLM-related
    keywords, we don't surface a hint because the rendering location
    differs (toast, not inline) and the actionable advice differs.
    """
    hint, retryable = _classify_error("api_key parse failure in bridge config", "bridge")
    assert hint is None
    assert retryable is False


def test_classify_business_error_no_hint() -> None:
    """Business errors (user input issues) also skip hints."""
    hint, retryable = _classify_error("llmIndex 99 out of range", "business")
    assert hint is None
    assert retryable is False


def test_classify_first_match_wins() -> None:
    """When a message matches multiple categories, first-listed pattern wins.

    Pattern order in workbench_bridge is: check_llm_config -> quota -> network.
    A message containing both 'unauthorized' and 'rate limit' should classify
    as check_llm_config because auth is checked first.
    """
    hint, _ = _classify_error("Unauthorized: rate limit enforced", "runtime")
    assert hint == "check_llm_config"


def test_classify_case_insensitive() -> None:
    """Keyword matching is case-insensitive against the error message."""
    hint, _ = _classify_error("AUTHENTICATION DENIED", "runtime")
    assert hint == "check_llm_config"


# Parent-watchdog liveness logic moved to runner/_watchdog.py — covered by
# test_watchdog.py. Only the workbench-specific pet-cleanup wiring is tested
# here (see test_bridge_registers_parent_loss_pet_cleanup below).


# ---------------- _llm_display_name ----------------


def test_llm_display_name_external_runtime_uses_raw_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GALLEY_RUNTIME_KIND", raising=False)

    assert _llm_display_name("NativeClaudeSession/glm-5.1") == (
        "NativeClaudeSession/glm-5.1"
    )
    assert _llm_display_name("NativeClaudeSession/claude-main") == (
        "NativeClaudeSession/claude-main"
    )


def test_llm_display_name_managed_runtime_uses_galley_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GALLEY_RUNTIME_KIND", "managed")

    assert (
        _llm_display_name("NativeClaudeSession/glm-5.1") == "glm-5.1"
    )
    assert _llm_display_name("NativeClaudeSession/My GLM") == "My GLM"


def test_managed_model_config_maps_connect_timeout_to_ga_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Newer GA reads `timeout`; Galley keeps `connect_timeout` in Settings."""
    monkeypatch.setenv(
        "GALLEY_MANAGED_MODEL_CONFIG_JSON",
        json.dumps(
            {
                "models": [
                    {
                        "protocol": "openai",
                        "displayName": "Test Model",
                        "apiKey": "sk-test",
                        "apiBase": "https://example.test/v1/",
                        "model": "test-model",
                        "advancedOptions": {
                            "connect_timeout": 12,
                            "read_timeout": 180,
                        },
                    }
                ]
            }
        ),
    )

    cfg = _managed_model_config_from_env()["native_oai_config_0"]

    assert cfg["connect_timeout"] == 12
    assert cfg["timeout"] == 12
    assert cfg["read_timeout"] == 180


def test_managed_model_config_fetches_api_key_from_credential_ipc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[dict[str, object], str, str]] = []

    def fake_credential_from_ipc(
        ipc: dict[str, object],
        api_key_ref: str,
        credential_kind: str,
    ) -> dict[str, object]:
        calls.append((ipc, api_key_ref, credential_kind))
        return {"apiKey": "sk-from-ipc"}

    monkeypatch.setattr(
        managed_runtime,
        "_credential_from_ipc",
        fake_credential_from_ipc,
    )
    monkeypatch.setenv(
        "GALLEY_MANAGED_MODEL_CONFIG_JSON",
        json.dumps(
            {
                "models": [
                    {
                        "protocol": "openai",
                        "authKind": "api_key",
                        "displayName": "Test Model",
                        "apiKey": "galley-managed-api-key",
                        "apiKeyRef": "managed-provider:mp_test",
                        "apiBase": "https://example.test/v1/",
                        "model": "test-model",
                        "credentialIpc": {
                            "kind": "unix",
                            "address": "/tmp/galley.sock",
                            "token": "secret",
                        },
                    }
                ]
            }
        ),
    )

    cfg = _managed_model_config_from_env()["native_oai_config_0"]

    assert cfg["apikey"] == "sk-from-ipc"
    assert calls == [
        (
            {"kind": "unix", "address": "/tmp/galley.sock", "token": "secret"},
            "managed-provider:mp_test",
            "api_key",
        )
    ]


def test_credential_from_ipc_surfaces_structured_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_read_windows_named_pipe(
        address: str,
        req: bytes,
        timeout_secs: float,
    ) -> bytes:
        return (
            b'{"error":"invalid_args",'
            b'"message":"credential IPC token mismatch"}\n'
        )

    monkeypatch.setattr(
        managed_runtime,
        "_read_windows_named_pipe",
        fake_read_windows_named_pipe,
    )

    with pytest.raises(RuntimeError, match="token mismatch"):
        managed_runtime._credential_from_ipc(
            {"kind": "windows_named_pipe", "address": r"\\.\pipe\galley", "token": "bad"},
            "managed-provider:mp_test",
            "api_key",
        )


def test_credential_from_ipc_reports_empty_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        managed_runtime,
        "_read_windows_named_pipe",
        lambda _address, _req, _timeout_secs: b"",
    )

    with pytest.raises(RuntimeError, match="empty response"):
        managed_runtime._credential_from_ipc(
            {"kind": "windows_named_pipe", "address": r"\\.\pipe\galley", "token": "t"},
            "managed-provider:mp_test",
            "api_key",
        )


def test_read_windows_named_pipe_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    class BlockingPipe:
        def __enter__(self) -> BlockingPipe:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def write(self, _req: bytes) -> None:
            return None

        def readline(self) -> bytes:
            time.sleep(1)
            return b""

    monkeypatch.setattr("builtins.open", lambda *_args, **_kwargs: BlockingPipe())

    with pytest.raises(TimeoutError, match="timed out"):
        managed_runtime._read_windows_named_pipe(
            r"\\.\pipe\galley",
            b"{}\n",
            0.01,
        )


def test_managed_model_config_maps_codex_oauth_to_ga_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "GALLEY_MANAGED_MODEL_CONFIG_JSON",
        json.dumps(
            {
                "models": [
                    {
                        "protocol": "openai",
                        "authKind": "chatgpt_codex_oauth",
                        "displayName": "ChatGPT / Codex",
                        "apiKey": "galley-codex-oauth",
                        "apiKeyRef": "managed-provider:mp_chatgpt_codex",
                        "apiBase": "https://chatgpt.com/backend-api/codex",
                        "model": "gpt-5.5",
                        "credentialIpc": {
                            "kind": "unix",
                            "address": "/tmp/galley.sock",
                            "token": "secret",
                        },
                        "advancedOptions": {
                            "api_mode": "chat_completions",
                            "reasoning_effort": "minimal",
                            "stream": False,
                        },
                    }
                ]
            }
        ),
    )

    cfg = _managed_model_config_from_env()["native_oai_config_0"]

    assert cfg["codex_backend"] is True
    assert cfg["api_mode"] == "responses"
    assert cfg["stream"] is True
    assert cfg["reasoning_effort"] == "medium"
    assert cfg["galley_api_key_ref"] == "managed-provider:mp_chatgpt_codex"
    assert cfg["galley_credential_ipc"]["token"] == "secret"


def test_ask_user_response_resets_visibility_to_visible() -> None:
    class FakeAgent:
        def __init__(self) -> None:
            self.tasks: list[tuple[str, str]] = []

        def put_task(self, text: str, source: str, **_kwargs: Any) -> object:
            self.tasks.append((text, source))
            return object()

    bridge = _new_test_bridge()
    bridge.agent = FakeAgent()
    bridge._btw_handler = None
    bridge._start_progress_drain = lambda _queue: None  # type: ignore[assignment]
    bridge._current_message_visibility = "hidden"

    bridge.dispatch_command(AskUserResponseCommand(text="yes", absoluteTurnIndex=4))

    assert bridge._current_message_visibility == "visible"
    assert bridge._current_message_turn_base == 4
    assert bridge._last_emitted_turn == 1
    assert bridge.agent.tasks == [("yes", "workbench")]
    event = _next_bridge_event(bridge)
    assert event["kind"] == "turn_start"
    assert event["turnIndex"] == 1
    assert event["visibility"] == "visible"


def test_user_message_emits_turn_start_before_progress_drain() -> None:
    class FakeAgent:
        def __init__(self) -> None:
            self.tasks: list[dict[str, Any]] = []

        def put_task(
            self,
            text: str,
            source: str,
            images: list[str],
            **_kwargs: Any,
        ) -> object:
            self.tasks.append({"text": text, "source": source, "images": images})
            return object()

    bridge = _new_test_bridge()
    bridge.agent = FakeAgent()
    bridge._btw_handler = None

    def fake_drain(_queue: object) -> None:
        bridge._emit(
            TurnProgressEvent(
                sessionId="s1",
                delta="early prose",
                source="workbench",
                visibility=bridge._current_message_visibility,
            )
        )

    bridge._start_progress_drain = fake_drain  # type: ignore[assignment]

    bridge.dispatch_command(
        UserMessageCommand(
            text="describe",
            images=["/tmp/galley/image.png"],
            absoluteTurnIndex=7,
        )
    )

    first = _next_bridge_event(bridge)
    second = _next_bridge_event(bridge)
    assert first["kind"] == "turn_start"
    assert first["turnIndex"] == 1
    assert first["visibility"] == "visible"
    assert second["kind"] == "turn_progress"
    assert second["delta"] == "early prose"
    assert bridge.agent.tasks == [
        {"text": "describe", "source": "workbench", "images": ["/tmp/galley/image.png"]}
    ]
    assert bridge._current_message_turn_base == 7

    bridge._emit_turn_start(1)
    assert bridge.event_queue.empty()


def test_btw_user_message_does_not_emit_main_turn_start() -> None:
    bridge = _new_test_bridge()
    bridge.agent = object()
    bridge._btw_handler = lambda _agent, _text: "ok"
    calls: list[str] = []

    def record_btw(text: str) -> None:
        calls.append(text)

    bridge._handle_btw_command = record_btw  # type: ignore[assignment]

    bridge.dispatch_command(UserMessageCommand(text="/btw side question"))

    assert calls == ["/btw side question"]
    assert bridge.event_queue.empty()
    assert bridge._last_emitted_turn == 0


def test_user_message_command_passes_images_to_agent() -> None:
    class FakeAgent:
        def __init__(self) -> None:
            self.tasks: list[dict[str, Any]] = []

        def put_task(
            self,
            text: str,
            source: str,
            images: list[str],
            **_kwargs: Any,
        ) -> object:
            self.tasks.append({"text": text, "source": source, "images": images})
            return object()

    bridge = _new_test_bridge()
    bridge.agent = FakeAgent()
    bridge._start_progress_drain = lambda _queue: None  # type: ignore[assignment]

    bridge.dispatch_command(
        UserMessageCommand(
            text="describe",
            images=["/tmp/galley/image.png"],
            absoluteTurnIndex=7,
        )
    )

    assert bridge.agent.tasks == [
        {"text": "describe", "source": "workbench", "images": ["/tmp/galley/image.png"]}
    ]
    assert bridge._current_message_turn_base == 7
    event = _next_bridge_event(bridge)
    assert event["kind"] == "turn_start"
    assert event["turnIndex"] == 1


def test_resolve_all_pending_resolves_every_waiter() -> None:
    state = SessionState()
    p1 = state.register_pending("a1")
    p2 = state.register_pending("a2")

    assert state.resolve_all_pending("deny") == 2
    assert p1.event.is_set() and p1.decision == "deny"
    assert p2.event.is_set() and p2.decision == "deny"
    # Idempotent once drained.
    assert state.resolve_all_pending("deny") == 0


def test_abort_denies_pending_approval_and_unblocks_agent_thread() -> None:
    class FakeAgent:
        def __init__(self) -> None:
            self.aborted = False

        def abort(self) -> None:
            self.aborted = True

    bridge = _new_test_bridge()
    bridge.agent = FakeAgent()

    # Agent thread blocked inside _request_approval, exactly the state
    # a user sees when they hit Stop while an Approval Card is pending.
    decisions: list[str] = []

    def agent_thread() -> None:
        decisions.append(bridge._request_approval("write_file", {"path": "/x"}))

    t = threading.Thread(target=agent_thread, daemon=True)
    t.start()
    deadline = time.monotonic() + 2.0
    while not bridge.state._pending and time.monotonic() < deadline:
        time.sleep(0.01)
    assert bridge.state._pending, "approval must be registered before abort"

    bridge.dispatch_command(AbortCommand())

    t.join(timeout=2.0)
    assert not t.is_alive(), "abort must unblock the waiting agent thread"
    assert decisions == ["deny"]
    assert bridge.agent.aborted
    assert not bridge.state._pending


def test_shutdown_denies_pending_approval() -> None:
    bridge = _new_test_bridge()
    bridge.agent = SimpleNamespace()
    bridge._handle_detach_pet = lambda silent=False: None  # type: ignore[method-assign]
    pending = bridge.state.register_pending("a1")

    bridge.dispatch_command(ShutdownCommand())

    assert pending.event.is_set()
    assert pending.decision == "deny"
    assert bridge.shutdown_event.is_set()


def test_project_workspace_managed_runtime_sets_project_mode_attrs(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "repo"
    workspace.mkdir()
    ga_path = tmp_path / "ga"
    ga_path.mkdir()
    calls: list[str] = []

    def fake_prepare(root: str) -> dict[str, object]:
        calls.append(root)
        return {
            "ok": True,
            "name": "repo",
            "target": str(workspace),
        }

    monkeypatch.setitem(sys.modules, "workspace_cmd", SimpleNamespace(prepare=fake_prepare))
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: True)

    bridge = Bridge(
        ga_path=str(ga_path),
        session_id="s1",
        cwd=None,
        llm_no=0,
        llm_name=None,
        stdout=StringIO(),
        stdin=StringIO(),
        workspace_root=str(workspace),
    )
    bridge.agent = SimpleNamespace()
    cwd_before = os.getcwd()

    bridge._activate_project_workspace()

    assert calls == [str(workspace)]
    assert bridge.agent._ga_project_mode_name == "repo"
    assert bridge.agent._ga_project_mode_workspace_path == str(workspace)
    assert os.getcwd() == cwd_before
    assert bridge.event_queue.empty()


def test_project_workspace_external_runtime_activates_only_with_safe_state_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "repo"
    workspace.mkdir()
    ga_path = tmp_path / "external-ga"
    ga_path.mkdir()
    state_root = tmp_path / "galley-state"
    calls: list[str] = []

    def fake_prepare(root: str) -> dict[str, object]:
        calls.append(root)
        return {
            "ok": True,
            "name": "repo",
            "target": str(workspace),
        }

    monkeypatch.setitem(sys.modules, "workspace_cmd", SimpleNamespace(prepare=fake_prepare))
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: False)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: str(state_root))

    bridge = Bridge(
        ga_path=str(ga_path),
        session_id="s1",
        cwd=None,
        llm_no=0,
        llm_name=None,
        stdout=StringIO(),
        stdin=StringIO(),
        workspace_root=str(workspace),
    )
    bridge.agent = SimpleNamespace()
    cwd_before = os.getcwd()

    bridge._activate_project_workspace()

    assert calls == [str(workspace)]
    assert bridge.agent._ga_project_mode_name == "repo"
    assert bridge.agent._ga_project_mode_workspace_path == str(workspace)
    assert os.getcwd() == cwd_before
    assert bridge.event_queue.empty()


def test_project_workspace_external_runtime_skips_without_safe_state_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "repo"
    workspace.mkdir()
    ga_path = tmp_path / "external-ga"
    ga_path.mkdir()

    def fake_prepare(_root: str) -> dict[str, object]:
        raise AssertionError("prepare must not run for unsafe external GA")

    monkeypatch.setitem(sys.modules, "workspace_cmd", SimpleNamespace(prepare=fake_prepare))
    monkeypatch.setattr(managed_runtime, "is_managed_runtime", lambda: False)
    monkeypatch.setattr(managed_runtime, "managed_state_root", lambda: None)

    bridge = Bridge(
        ga_path=str(ga_path),
        session_id="s1",
        cwd=None,
        llm_no=0,
        llm_name=None,
        stdout=StringIO(),
        stdin=StringIO(),
        workspace_root=str(workspace),
    )
    bridge.agent = SimpleNamespace()

    bridge._activate_project_workspace()

    assert not hasattr(bridge.agent, "_ga_project_mode_name")
    event = _next_bridge_event(bridge)
    assert event["kind"] == "error"
    assert event["severity"] == "warning"
    assert event["context"] == "project_workspace"
    assert "external GenericAgent" in event["message"]


def test_message_to_content_blocks_adds_image_blocks(tmp_path: Path) -> None:
    image_path = tmp_path / "paste.png"
    image_path.write_bytes(b"png-bytes")

    blocks = _message_to_content_blocks("look", [str(image_path)])

    assert blocks[0] == {"type": "text", "text": "look"}
    assert blocks[1]["type"] == "image"
    assert blocks[1]["source"]["type"] == "base64"
    assert blocks[1]["source"]["media_type"] == "image/png"
    assert blocks[1]["source"]["data"] == "cG5nLWJ5dGVz"


def test_message_to_content_blocks_skips_missing_images(tmp_path: Path) -> None:
    missing = tmp_path / "missing.png"

    blocks = _message_to_content_blocks("look", [str(missing)])

    assert blocks == [{"type": "text", "text": "look"}]


# ---------------- _extract_ask_user ----------------


def test_extract_ask_user_matches_first_ask_user_call() -> None:
    tool_calls = [
        {
            "tool_name": "ask_user",
            "args": {
                "question": "Continue with React 19?",
                "candidates": ["yes", "no, use 18"],
            },
        },
    ]
    result = Bridge._extract_ask_user(tool_calls)
    assert result == ("Continue with React 19?", ["yes", "no, use 18"])


def test_extract_ask_user_returns_none_when_absent() -> None:
    tool_calls = [
        {"tool_name": "file_read", "args": {"path": "agentmain.py"}},
        {"tool_name": "code_run", "args": {"code": "print('hi')"}},
    ]
    assert Bridge._extract_ask_user(tool_calls) is None


def test_extract_ask_user_handles_missing_candidates() -> None:
    """GA's ask_user accepts an open-ended question (no candidates).
    Bridge must coerce missing candidates to an empty list — desktop
    AskUserBubble renders the question without chips in that case."""
    tool_calls = [
        {"tool_name": "ask_user", "args": {"question": "What now?"}},
    ]
    result = Bridge._extract_ask_user(tool_calls)
    assert result == ("What now?", [])


def test_extract_ask_user_coerces_non_string_candidates() -> None:
    """Defensive: tool args come from LLM JSON and could in principle
    arrive with non-string entries. `_extract_ask_user` should str()
    them so downstream `[str(c) for c in candidates]` doesn't crash."""
    tool_calls = [
        {
            "tool_name": "ask_user",
            "args": {"question": "Pick one", "candidates": [1, "two", 3.0]},
        },
    ]
    result = Bridge._extract_ask_user(tool_calls)
    assert result == ("Pick one", ["1", "two", "3.0"])


# ---------------- _FenceFilter ----------------
#
# Streaming filter that hides content between GA's 5-backtick fence
# markers (verbose-mode tool stdout). Each test feeds the filter
# fragments to simulate IPC chunk boundaries and asserts the
# concatenated output matches what should reach the desktop.


def _feed_all(filter_: _FenceFilter, *chunks: str) -> str:
    return "".join(filter_.feed(c) for c in chunks)


def test_fence_filter_passes_through_outside_content() -> None:
    f = _FenceFilter()
    assert f.feed("hello world\n") == "hello world\n"
    assert not f.inside
    assert f.carry == ""


def test_fence_filter_drops_complete_fenced_block_in_one_delta() -> None:
    f = _FenceFilter()
    out = f.feed("before\n`````\nsubprocess stdout\n`````\nafter")
    assert out == "before\nafter"
    assert not f.inside


def test_fence_filter_drops_inside_chunks_across_deltas() -> None:
    """Fence open + body + close split across three deltas."""
    f = _FenceFilter()
    # Delta 1: outside + opener
    assert f.feed("prose\n`````\n") == "prose\n"
    assert f.inside
    # Delta 2: body only (still inside)
    assert f.feed("[Action] Running python in temp: ...\n") == ""
    assert f.inside
    # Delta 3: closer + more outside
    assert f.feed("`````\ntail") == "tail"
    assert not f.inside


def test_fence_filter_handles_marker_split_at_chunk_boundary() -> None:
    """Fence marker bytes split between two deltas — filter must
    rejoin via carry and still detect the marker."""
    f = _FenceFilter()
    # First delta ends mid-marker: 3 backticks
    out1 = f.feed("outside```")
    # Carry holds the 3 backticks; "outside" emitted.
    assert out1 == "outside"
    assert f.carry == "```"
    # Second delta completes the marker (2 more backticks + newline)
    # then inside content.
    out2 = f.feed("``\nINSIDE\n`````\nOUTSIDE")
    assert out2 == "OUTSIDE"
    assert not f.inside


def test_fence_filter_releases_carry_when_not_a_marker() -> None:
    """A trailing backtick that turns out NOT to be the start of a
    fence (next chunk doesn't extend it into a full marker) must
    be emitted, not silently swallowed."""
    f = _FenceFilter()
    assert f.feed("text`") == "text"
    assert f.carry == "`"
    # Next chunk is non-backtick — the held-back `\`` is no longer a
    # possible marker prefix and should flush.
    assert f.feed("xyz") == "`xyz"
    assert f.carry == ""


def test_fence_filter_multiple_fences_in_one_delta() -> None:
    f = _FenceFilter()
    out = f.feed("a\n`````\nb\n`````\nc\n`````\nd\n`````\ne")
    assert out == "a\nc\ne"


def test_fence_filter_marker_at_very_end_leaves_state_inside() -> None:
    """A delta that ends exactly on a fence-open should flip state to
    inside without leaving anything for the next call to bridge."""
    f = _FenceFilter()
    out = f.feed("preamble\n`````\n")
    assert out == "preamble\n"
    assert f.inside
    assert f.carry == ""


# ---------------- RUNNER-2/4/5: shutdown & lifecycle failure paths ----------------


def test_slash_command_system_done_clears_run_state() -> None:
    """Slash-command tasks (e.g. `/session.x=v`) bypass agent_runner_loop:
    their `done` arrives with source='system' and no turn_end ever fires.
    The drain must clear run_in_progress and synthesize run_complete, or
    the GUI spinner never stops and set_llm is rejected until a manual
    Stop."""
    import queue as _queue

    bridge = _new_test_bridge()
    display_queue: _queue.Queue[dict[str, Any]] = _queue.Queue()
    bridge.run_in_progress.set()
    bridge._begin_run_tracking()
    bridge._start_progress_drain(display_queue)

    display_queue.put({"done": "session.x set to v", "source": "system"})

    for _ in range(200):
        if not bridge.run_in_progress.is_set():
            break
        time.sleep(0.01)
    assert not bridge.run_in_progress.is_set()

    kinds = []
    while not bridge.event_queue.empty():
        line = bridge.event_queue.get_nowait()
        assert line is not None
        kinds.append(json.loads(line)["kind"])
    assert kinds == ["system_message", "run_complete"]


def test_workbench_done_does_not_clear_run_state() -> None:
    """The normal task path's `done` (source='workbench') must keep being
    ignored — turn_end owns the canonical completion there."""
    import queue as _queue

    bridge = _new_test_bridge()
    display_queue: _queue.Queue[dict[str, Any]] = _queue.Queue()
    bridge.run_in_progress.set()
    bridge._start_progress_drain(display_queue)

    display_queue.put({"done": "full answer", "source": "workbench"})

    time.sleep(0.2)
    assert bridge.run_in_progress.is_set()
    assert bridge.event_queue.empty()


def test_run_loop_exit_detaches_pet() -> None:
    """The pet subprocess must not outlive the bridge on ANY loop exit
    (stdin EOF, stdout failure) — not just the Shutdown command path.
    An orphan pet keeps holding its fixed port and blocks re-attach."""
    bridge = _new_test_bridge()
    detach_calls: list[bool] = []
    bridge._handle_detach_pet = (  # type: ignore[method-assign]
        lambda silent=False: detach_calls.append(silent)
    )
    bridge.shutdown_event.set()
    bridge.run_in_progress.set()  # skip the shutdown grace wait

    assert bridge.run() == 0
    assert detach_calls == [True]


def test_bridge_registers_parent_loss_pet_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import runner.workbench_bridge as wb

    registry: list[Any] = []
    monkeypatch.setattr(wb, "_PARENT_LOSS_CLEANUP", registry)
    bridge = _new_test_bridge()
    detach_calls: list[bool] = []
    bridge._handle_detach_pet = (  # type: ignore[method-assign]
        lambda silent=False: detach_calls.append(silent)
    )
    assert len(registry) == 1
    registry[0]()
    assert detach_calls == [True]


def test_silence_python_stdout_redirects_os_level_fd_one() -> None:
    """sys.stdout rebinding alone leaves OS fd 1 pointing at the IPC
    pipe: subprocesses and C extensions writing fd 1 would corrupt the
    session's event framing. After _silence_python_stdout, only the
    captured handle reaches the real stdout."""
    import subprocess

    script = (
        "import os\n"
        "import runner.workbench_bridge as wb\n"
        "real = wb._capture_real_stdout()\n"
        "wb._silence_python_stdout()\n"
        "os.write(1, b'RAW-FD-GARBAGE\\n')\n"
        "print('PYTHON-GARBAGE')\n"
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


# ---------------- RUNNER-3/6/7/11: shutdown flush, guards, fence tail ----------------


def test_run_flushes_queued_events_before_exit() -> None:
    """Tail events queued before shutdown must reach stdout. The old exit
    path busy-waited on queue.empty(), which says nothing about the last
    line having been written; the writer-exit sentinel makes it
    deterministic."""
    bridge = _new_test_bridge()
    bridge._handle_detach_pet = lambda silent=False: None  # type: ignore[method-assign]
    for i in range(50):
        bridge.event_queue.put(json.dumps({"kind": "turn_progress", "n": i}))
    bridge.shutdown_event.set()

    assert bridge.run() == 0
    lines = cast("StringIO", bridge._stdout).getvalue().strip().splitlines()
    assert len(lines) == 50
    assert json.loads(lines[-1])["n"] == 49


def test_load_history_rejected_while_run_in_progress() -> None:
    """Replacing history mid-run would let the agent loop read/write a
    list swapped out under it — mirror set_llm's guard."""
    from runner.ipc import LoadHistoryCommand

    bridge = _new_test_bridge()
    bridge.run_in_progress.set()
    loaded: list[Any] = []
    bridge._load_history = loaded.append  # type: ignore[method-assign, assignment]

    bridge.dispatch_command(
        LoadHistoryCommand(messages=[{"role": "user", "content": "x"}])
    )

    assert loaded == []
    event = _next_bridge_event(bridge)
    assert event["kind"] == "error"
    assert event["context"] == "load_history"


def test_abort_after_completion_does_not_double_emit_run_complete() -> None:
    """The run-completion check-emit-clear is serialized: once a path has
    emitted run_complete and cleared the run, later paths must no-op."""

    class FakeAgent:
        def abort(self) -> None:
            pass

    bridge = _new_test_bridge()
    bridge.agent = FakeAgent()
    bridge.run_in_progress.set()

    bridge.dispatch_command(AbortCommand())
    first = _next_bridge_event(bridge)
    assert first["kind"] == "run_complete"

    # Second abort (or a racing turn_end that lost the check) sees the
    # cleared flag and emits nothing.
    bridge.dispatch_command(AbortCommand())
    assert bridge.event_queue.empty()


def test_fence_filter_flush_releases_trailing_partial_marker() -> None:
    """A held-back partial fence prefix at stream end was real content —
    flush must release it instead of truncating the reply."""
    f = _FenceFilter()
    assert f.feed("answer ends with ``") == "answer ends with "
    assert f.flush() == "``"
    assert f.carry == ""


def test_fence_filter_flush_drops_carry_inside_fence() -> None:
    f = _FenceFilter()
    f.feed("`````\nhidden tool output ``")
    assert f.flush() == ""
