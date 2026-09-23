"""Managed GenericAgent parser compatibility tests."""
from __future__ import annotations

import importlib
import json
import os
import sys
import types
from pathlib import Path
from typing import Any, cast

import pytest

_MANAGED_GA_CODE = Path(__file__).resolve().parents[2] / "managed-ga" / "code"
if str(_MANAGED_GA_CODE) not in sys.path:
    sys.path.insert(0, str(_MANAGED_GA_CODE))

_PREVIOUS_DONT_WRITE_BYTECODE = sys.dont_write_bytecode
sys.dont_write_bytecode = True
sys.modules.setdefault("requests", types.ModuleType("requests"))
urllib3_stub = types.ModuleType("urllib3")
urllib3_typed = cast(Any, urllib3_stub)
urllib3_typed.exceptions = types.SimpleNamespace(InsecureRequestWarning=Warning)
urllib3_typed.disable_warnings = lambda *_args, **_kwargs: None
# Upstream 1b6442f hooks urllib3.connection.HTTPConnection.request at import
# time (abort() socket registry); the stub needs that attribute chain.
urllib3_typed.connection = types.SimpleNamespace(
    HTTPConnection=type("HTTPConnection", (), {"request": lambda self, *a, **k: None})
)
sys.modules.setdefault("urllib3", urllib3_stub)

try:
    import llmcore  # type: ignore[import-not-found]  # noqa: E402
finally:
    sys.dont_write_bytecode = _PREVIOUS_DONT_WRITE_BYTECODE


def test_tryparse_repairs_raw_windows_path_backslashes() -> None:
    raw = r'{"name":"file_read","arguments":{"path":"D:\GenericAgent\memory\sophub.md"}}'

    parsed = llmcore.tryparse(raw)

    assert parsed["arguments"]["path"] == "D:/GenericAgent/memory/sophub.md"


def test_tryparse_repairs_doubled_quotes_around_windows_path() -> None:
    raw = r'{"name":"file_read","arguments":{"path":""D:\GenericAgent\memory\sophub.md""}}'

    parsed = llmcore.tryparse(raw)

    assert parsed["arguments"]["path"] == "D:/GenericAgent/memory/sophub.md"


def test_tryparse_restores_json_escape_letters_in_raw_windows_path() -> None:
    raw = r'{"name":"file_read","arguments":{"path":"D:\new\test.md"}}'

    parsed = llmcore.tryparse(raw)

    assert parsed["arguments"]["path"] == "D:/new/test.md"


def test_tryparse_strips_user_quotes_from_valid_windows_path_value() -> None:
    raw = json.dumps(
        {
            "name": "file_read",
            "arguments": {"path": r'"D:\GenericAgent\memory\sophub.md"'},
        },
        ensure_ascii=False,
    )

    parsed = llmcore.tryparse(raw)

    assert parsed["arguments"]["path"] == "D:/GenericAgent/memory/sophub.md"


def test_tryparse_does_not_normalize_non_path_string_fields() -> None:
    raw = json.dumps(
        {
            "name": "code_run",
            "arguments": {"script": r'print("D:\new\test.md")'},
        },
        ensure_ascii=False,
    )

    parsed = llmcore.tryparse(raw)

    assert parsed["arguments"]["script"] == r'print("D:\new\test.md")'


def test_codex_wham_usage_message_uses_later_exhausted_window() -> None:
    message = llmcore._codex_usage_limit_message_from_wham(
        {
            "rate_limit": {
                "limit_reached": True,
                "primary_window": {
                    "used_percent": 100,
                    "reset_after_seconds": 600,
                },
                "secondary_window": {
                    "used_percent": 100,
                    "reset_after_seconds": 7200,
                },
            }
        },
        now=1_700_000_000,
    )

    assert message is not None
    assert "next reset in 2 hours" in message


def test_codex_wham_usage_message_handles_temporary_limit() -> None:
    message = llmcore._codex_usage_limit_message_from_wham(
        {"rate_limit": {"limit_reached": False}},
        now=1_700_000_000,
    )

    assert message == "Codex request was rate limited temporarily; retry shortly"


def test_codex_stream_final_429_appends_quota_reset_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakePostResponse:
        status_code = 429
        headers: dict[str, str] = {}
        text = "quota exhausted"

        def __enter__(self) -> FakePostResponse:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    class FakeGetResponse:
        status_code = 200

        def json(self) -> dict[str, Any]:
            return {
                "rate_limit": {
                    "limit_reached": True,
                    "primary_window": {
                        "used_percent": 100,
                        "reset_after_seconds": 3600,
                    },
                }
            }

    monkeypatch.setattr(
        llmcore.requests,
        "post",
        lambda *_args, **_kwargs: FakePostResponse(),
        raising=False,
    )
    monkeypatch.setattr(
        llmcore.requests,
        "get",
        lambda *_args, **_kwargs: FakeGetResponse(),
        raising=False,
    )
    monkeypatch.setattr(llmcore.time, "time", lambda: 1_700_000_000)
    sess = types.SimpleNamespace(
        name="codex-test",
        max_retries=0,
        stream=True,
        connect_timeout=1,
        read_timeout=10,
        proxies=None,
        verify=True,
        codex_backend=True,
    )

    chunks = list(
        llmcore._stream_with_retry(
            sess,
            "https://example.test",
            {},
            {},
            lambda _r: iter(()),
        )
    )

    assert chunks
    assert "quota exhausted" in chunks[0]
    assert "next reset in 1 hour" in chunks[0]


def test_non_codex_stream_final_429_is_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakePostResponse:
        status_code = 429
        headers: dict[str, str] = {}
        text = "plain rate limit"

        def __enter__(self) -> FakePostResponse:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        llmcore.requests,
        "post",
        lambda *_args, **_kwargs: FakePostResponse(),
        raising=False,
    )
    monkeypatch.setattr(
        llmcore.requests,
        "get",
        lambda *_args, **_kwargs: pytest.fail("WHAM should not be called for non-Codex"),
        raising=False,
    )
    sess = types.SimpleNamespace(
        name="plain-test",
        max_retries=0,
        stream=True,
        connect_timeout=1,
        read_timeout=10,
        proxies=None,
        verify=True,
        codex_backend=False,
    )

    chunks = list(
        llmcore._stream_with_retry(
            sess,
            "https://example.test",
            {},
            {},
            lambda _r: iter(()),
        )
    )

    assert chunks == ["!!!Error: HTTP 429: plain rate limit"]


def test_retry_after_over_cap_error_carries_server_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Patch 0021: when the relay's Retry-After exceeds max_retry_after, the
    give-up message names the value so the user can size the cap."""

    class FakePostResponse:
        status_code = 524
        headers: dict[str, str] = {"retry-after": "120"}
        text = "<!DOCTYPE html>"

        def __enter__(self) -> FakePostResponse:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        llmcore.requests,
        "post",
        lambda *_args, **_kwargs: FakePostResponse(),
        raising=False,
    )
    sess = types.SimpleNamespace(
        name="relay-test",
        max_retries=3,
        max_retry_after=60.0,
        stream=True,
        connect_timeout=1,
        read_timeout=10,
        proxies=None,
        verify=True,
        codex_backend=False,
    )

    chunks = list(
        llmcore._stream_with_retry(
            sess,
            "https://example.test",
            {},
            {},
            lambda _r: iter(()),
        )
    )

    assert chunks == [
        "!!!Error: HTTP 524 (retry-after 120s > 60s cap): <!DOCTYPE html>"
    ]


def _exhaust(gen: Any) -> Any:
    try:
        while True:
            next(gen)
    except StopIteration as e:
        return e.value


def _sse(*events: dict[str, Any]) -> list[str]:
    return [f"data: {json.dumps(e)}" for e in events]


def _thinking_stream(*thinking_deltas: str) -> list[str]:
    return _sse(
        {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
        *(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": d},
            }
            for d in thinking_deltas
        ),
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "text"}},
        {
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "text_delta", "text": "The answer."},
        },
        {"type": "content_block_stop", "index": 1},
        {"type": "message_stop"},
    )


def _collect(gen: Any) -> tuple[list[str], Any]:
    chunks: list[str] = []
    try:
        while True:
            chunks.append(next(gen))
    except StopIteration as e:
        return chunks, e.value


def test_native_thinking_streams_in_band_tagged() -> None:
    """Patch 0016: upstream yields each thinking_delta raw, which puts untagged
    reasoning into the same stream as the answer. Galley streams it live inside
    <thinking>: the tag opens with the first reasoning text and closes at the
    thinking block's content_block_stop, before the answer."""
    chunks, _ = _collect(llmcore._parse_claude_sse(_thinking_stream("Let me ", "consider X.")))

    assert chunks == ["<thinking>Let me ", "consider X.", "</thinking>", "The answer."]


def test_native_thinking_still_reaches_returned_content_blocks() -> None:
    """Display-side change only: the returned blocks are exactly what upstream
    returns, so session history and signature handling are untouched."""
    _, blocks = _collect(llmcore._parse_claude_sse(_thinking_stream("use </thin", "king> tags")))

    assert blocks == [
        {"type": "thinking", "thinking": "use </thinking> tags", "signature": ""},
        {"type": "text", "text": "The answer."},
    ]


def test_native_thinking_neutralizes_literal_closing_tag() -> None:
    """GA's system prompt tells the model to use <thinking> tags, so its native
    reasoning can quote one. A literal '</thinking>' must not close the wrapper
    early and leak the remainder as body text."""
    chunks, _ = _collect(
        llmcore._parse_claude_sse(
            _thinking_stream("I should use </thinking> tags. Now the real reasoning.")
        )
    )
    stream = "".join(chunks)

    assert stream == (
        "<thinking>I should use </ thinking> tags. Now the real reasoning.</thinking>The answer."
    )


def test_native_thinking_neutralizes_closing_tag_split_across_deltas() -> None:
    """The carry buffer holds back a tail that could still grow into
    '</thinking>' until the next delta decides it."""
    chunks, _ = _collect(llmcore._parse_claude_sse(_thinking_stream("a </thin", "king> b")))

    assert chunks == ["<thinking>a ", "</ thinking> b", "</thinking>", "The answer."]


def test_native_thinking_flushes_held_fragment_at_close() -> None:
    chunks, _ = _collect(llmcore._parse_claude_sse(_thinking_stream("ends in </think")))

    assert chunks == ["<thinking>ends in ", "</think</thinking>", "The answer."]


def test_whitespace_only_thinking_emits_nothing() -> None:
    chunks, _ = _collect(llmcore._parse_claude_sse(_thinking_stream("   \n  ")))

    assert chunks == ["The answer."]


def test_native_thinking_leading_whitespace_waits_for_text() -> None:
    chunks, _ = _collect(llmcore._parse_claude_sse(_thinking_stream("  \n", "Hmm")))

    assert chunks == ["<thinking>  \nHmm", "</thinking>", "The answer."]


def test_native_thinking_closes_before_truncation_warning() -> None:
    """A stream cut mid-thinking (no content_block_stop) still closes the tag,
    and the warning lands after it as answer text."""
    lines = _sse(
        {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "thinking_delta", "thinking": "partial"},
        },
    )
    chunks, _ = _collect(llmcore._parse_claude_sse(lines))

    assert chunks[:2] == ["<thinking>partial", "</thinking>"]
    assert len(chunks) == 3 and "</thinking>" not in chunks[2]


def test_native_thinking_closes_before_sse_error_warning() -> None:
    lines = _sse(
        {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "thinking_delta", "thinking": "partial"},
        },
        {"type": "error", "error": {"message": "invalid request"}},
    )
    chunks, _ = _collect(llmcore._parse_claude_sse(lines))

    assert chunks == [
        "<thinking>partial",
        "</thinking>",
        "\n\n!!!Error: SSE invalid request",
    ]


def _oai_stream(*deltas: dict[str, Any], done: bool = True) -> list[str]:
    lines = [f"data: {json.dumps({'choices': [{'delta': d}]})}" for d in deltas]
    return lines + (["data: [DONE]"] if done else [])


def _parse_oai(lines: Any) -> tuple[list[str], Any]:
    return _collect(llmcore._parse_openai_sse(lines, "chat_completions"))


def test_chat_completions_reasoning_closes_before_first_content() -> None:
    chunks, blocks = _parse_oai(
        _oai_stream(
            {"reasoning_content": "Think "},
            {"reasoning": "more."},
            {"content": "Answer"},
            {"content": " done"},
        )
    )

    assert chunks == ["<thinking>Think ", "more.", "</thinking>", "Answer", " done"]
    assert blocks == [
        {"type": "thinking", "thinking": "Think more."},
        {"type": "text", "text": "Answer done"},
    ]


def test_chat_completions_reasoning_closes_at_first_tool_call_delta() -> None:
    call = {"index": 0, "id": "c1", "function": {"name": "f", "arguments": ""}}
    args = {"index": 0, "function": {"arguments": '{"a": 1}'}}
    raw = _oai_stream(
        {"reasoning_content": "Plan."}, {"tool_calls": [call]}, {"tool_calls": [args]}
    )
    consumed: list[int] = []

    def lines() -> Any:
        for i, line in enumerate(raw):
            consumed.append(i)
            yield line

    gen = llmcore._parse_openai_sse(lines(), "chat_completions")
    assert next(gen) == "<thinking>Plan."
    assert next(gen) == "</thinking>"
    # Closed while handling the first tool_calls line, not at stream end.
    assert consumed == [0, 1]
    chunks, blocks = _collect(gen)

    assert chunks == []
    assert blocks == [
        {"type": "thinking", "thinking": "Plan."},
        {"type": "tool_use", "id": "c1", "name": "f", "input": {"a": 1}},
    ]


@pytest.mark.parametrize("done", [True, False])
def test_chat_completions_reasoning_only_stream_closes_at_end(done: bool) -> None:
    chunks, blocks = _parse_oai(_oai_stream({"reasoning_content": "Only thinking"}, done=done))

    assert chunks == ["<thinking>Only thinking", "</thinking>"]
    assert blocks == [{"type": "thinking", "thinking": "Only thinking"}]


def test_chat_completions_neutralizes_closing_tag_split_across_deltas() -> None:
    chunks, blocks = _parse_oai(
        _oai_stream(
            {"reasoning_content": "a </thi"},
            {"reasoning_content": "nking> b"},
            {"content": "c"},
        )
    )

    assert chunks == ["<thinking>a ", "</ thinking> b", "</thinking>", "c"]
    assert blocks == [
        {"type": "thinking", "thinking": "a </thinking> b"},
        {"type": "text", "text": "c"},
    ]


def test_chat_completions_whitespace_only_reasoning_emits_nothing() -> None:
    chunks, blocks = _parse_oai(_oai_stream({"reasoning_content": "\n\n"}, {"content": "Hi"}))

    assert chunks == ["Hi"]
    # Returned blocks are unchanged from upstream: the raw reasoning stays.
    assert blocks == [
        {"type": "thinking", "thinking": "\n\n"},
        {"type": "text", "text": "Hi"},
    ]


def test_native_tool_client_keeps_non_text_image_blocks(tmp_path: Path) -> None:
    class FakeBackend:
        def __init__(self) -> None:
            self.history: list[dict[str, Any]] = []
            self.name = "fake"
            self.model = "fake-model"
            self.merged: dict[str, Any] | None = None

        def ask(self, merged: dict[str, Any]) -> Any:
            self.merged = merged
            if False:
                yield ""
            return llmcore.MockResponse("", "ok", [], "{}")

    backend = FakeBackend()
    client = llmcore.NativeToolClient(backend)
    client.log_path = str(tmp_path / "llm.log")
    image_block = {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "aA=="},
    }

    _exhaust(
        client.chat(
            [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "   "}, image_block],
                }
            ]
        )
    )

    assert backend.merged == {"role": "user", "content": [image_block]}


def test_agentmain_image_content_blocks_encodes_local_images(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("GALLEY_GA_STATE_ROOT", str(tmp_path / "state"))
    plugins_stub = types.ModuleType("plugins")
    plugins_typed = cast(Any, plugins_stub)
    plugins_typed.__path__ = []
    hooks_stub = types.ModuleType("plugins.hooks")
    hooks_typed = cast(Any, hooks_stub)
    hooks_typed.discover_and_load = lambda: None
    monkeypatch.setitem(sys.modules, "plugins", plugins_stub)
    monkeypatch.setitem(sys.modules, "plugins.hooks", hooks_stub)
    sys.modules.pop("agentmain", None)
    previous_dont_write_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        agentmain = importlib.import_module("agentmain")
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode

    image_path = tmp_path / "paste.webp"
    image_path.write_bytes(b"image-bytes")

    blocks = agentmain.image_content_blocks("look", [os.fspath(image_path)])

    assert blocks[0] == {"type": "text", "text": "look"}
    assert blocks[1] == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/webp",
            "data": "aW1hZ2UtYnl0ZXM=",
        },
    }
