"""Managed GenericAgent parser compatibility tests."""
from __future__ import annotations

import base64
import importlib
import json
import os
import platform
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


def test_managed_mykey_loader_serves_env_config_and_never_reloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Upstream a5979ea moved mykey loading into `llmcore.mykeys_store`,
    which agentmain reads directly; replacing the old module-level
    `_load_mykeys` no longer reached it. The managed loader must feed the
    store, and the store must keep that first load: since upstream
    2ba5529 every task start asks it again, and a reload would rebuild
    the clients and drop Galley's `extra_sys_prompt`."""
    import runner.managed_runtime as managed_runtime

    store = llmcore.mykeys_store
    for attr in ("_load", "data", "path", "mtime", "updated_at"):
        monkeypatch.setattr(store, attr, getattr(store, attr))
    monkeypatch.setenv(
        managed_runtime.GALLEY_MANAGED_MODEL_CONFIG_ENV,
        json.dumps(
            {
                "models": [
                    {
                        "protocol": "anthropic",
                        "displayName": "Claude",
                        "apiKey": "sk-test",
                        "apiBase": "https://example.test",
                        "model": "claude-test",
                    }
                ]
            }
        ),
    )

    managed_runtime.install_managed_mykey_loader()

    data, changed = llmcore.reload_mykeys()
    assert changed is True
    assert list(data) == ["native_claude_config_0"]
    assert data["native_claude_config_0"]["model"] == "claude-test"
    # The plugin path (langfuse_tracing imports `_load_mykeys`) goes
    # through the same loader.
    assert list(llmcore._load_mykeys()) == ["native_claude_config_0"]

    _, first = store.snapshot()
    _, again = store.snapshot()
    assert again == first
    assert llmcore.reload_mykeys()[1] is False


# --- Patch 0007, Sign in with ChatGPT route (`codex_backend`) ----------------
#
# Driven through `_openai_stream`, so the session flag, the headers, the
# request body, `_stream_with_retry` and the plan parser run as the engine runs
# them; only `requests` and the clock are fakes.


class _FakeHTTPResponse:
    def __init__(
        self, status_code: int, body: Any = None, lines: tuple[str, ...] = ()
    ) -> None:
        self.status_code = status_code
        self.headers: dict[str, str] = {}
        self.text = body if isinstance(body, str) else json.dumps(body)
        self._lines = list(lines)

    def __enter__(self) -> _FakeHTTPResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def iter_lines(self, *_args: object, **_kwargs: object) -> Any:
        return iter(self._lines)


class _FakeNetwork:
    """Serves the queued responses in order (the last one repeats), each
    POST a fresh object as with real `requests` (`_stream_with_retry` rebinds
    `iter_lines` on the response it gets), and records every POST and any
    GET (the backend sends none)."""

    def __init__(self, *responses: _FakeHTTPResponse) -> None:
        self.responses = list(responses)
        self.posts: list[dict[str, Any]] = []
        self.gets: list[str] = []

    def post(self, url: str, headers: Any = None, json: Any = None, **_kw: Any) -> Any:
        self.posts.append({"url": url, "headers": dict(headers or {}), "payload": json})
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        return _FakeHTTPResponse(r.status_code, r.text, tuple(r._lines))

    def get(self, url: str, *_args: Any, **_kwargs: Any) -> Any:
        self.gets.append(url)
        return _FakeHTTPResponse(500, "")


def _install_network(
    monkeypatch: pytest.MonkeyPatch, *responses: _FakeHTTPResponse
) -> _FakeNetwork:
    net = _FakeNetwork(*responses)
    req = llmcore.requests
    monkeypatch.setattr(req, "post", net.post, raising=False)
    monkeypatch.setattr(req, "get", net.get, raising=False)
    # The runner venv has no `requests`; this module imports llmcore against a
    # bare stub, so give it the exception types `_stream_with_retry` catches.
    if not hasattr(req, "ConnectionError"):
        monkeypatch.setattr(
            req, "ConnectionError", type("ConnectionError", (OSError,), {}), raising=False
        )
    if not hasattr(req, "Timeout"):
        monkeypatch.setattr(req, "Timeout", type("Timeout", (OSError,), {}), raising=False)
    if not hasattr(req, "exceptions"):
        chunked = type("ChunkedEncodingError", (Exception,), {})
        monkeypatch.setattr(
            req, "exceptions", types.SimpleNamespace(ChunkedEncodingError=chunked), raising=False
        )
    # Backoff sleeps run on a fake clock.
    clock = [1_700_000_000.0]
    monkeypatch.setattr(llmcore.time, "time", lambda: clock[0])
    monkeypatch.setattr(
        llmcore.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + s)
    )
    return net


def _jwt_with_account(account_id: str) -> str:
    claims = {"https://api.openai.com/auth": {"chatgpt_account_id": account_id}}
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"e30.{body}.sig"


def _codex_session(*, codex_backend: bool = True) -> Any:
    cfg: dict[str, Any] = {
        "name": "chatgpt-test",
        "apikey": _jwt_with_account("acct-123"),
        "apibase": "https://api.openai.com/v1",
        "model": "gpt-5.6-sol",
        "api_mode": "responses",
        "max_tokens": 4096,
        "max_retries": 2,
    }
    if codex_backend:
        cfg["codex_backend"] = True
    return llmcore.LLMSession(cfg)


def _run(sess: Any) -> tuple[list[str], Any]:
    return _collect(llmcore._openai_stream(sess, [{"role": "user", "content": "hi"}]))


_OK_STREAM = _FakeHTTPResponse(
    200,
    lines=tuple(
        _sse(
            {"type": "response.output_text.delta", "delta": "ok"},
            {"type": "response.completed", "response": {"usage": {}}},
        )
    ),
)


def test_chatgpt_plan_sends_galley_headers_and_codex_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    net = _install_network(monkeypatch, _OK_STREAM)
    sess = _codex_session()

    chunks, blocks = _run(sess)

    assert chunks == ["ok"]
    assert blocks == [{"type": "text", "text": "ok"}]
    [call] = net.posts
    assert call["url"] == "https://api.openai.com/v1/responses"
    headers = call["headers"]
    assert headers["User-Agent"] == f"Galley ({platform.system()}; {platform.machine()})"
    assert "originator" not in headers
    # Not even when the token carries an account claim.
    assert "ChatGPT-Account-ID" not in headers
    assert headers["Authorization"] == f"Bearer {sess.api_key}"
    payload = call["payload"]
    assert payload["store"] is False
    assert payload["stream"] is True
    assert "max_output_tokens" not in payload
    assert payload["prompt_cache_key"]
    assert payload["include"] == ["reasoning.encrypted_content"]


class _FakeIpcSocket:
    """Stands in for the AF_UNIX socket to Core's credential IPC: records what
    the engine sends and answers one line."""

    def __init__(self, reply: dict[str, Any]) -> None:
        self.reply: bytes | None = json.dumps(reply).encode() + b"\n"
        self.address: str | None = None
        self.sent: list[bytes] = []

    def __enter__(self) -> _FakeIpcSocket:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def settimeout(self, _timeout: float) -> None:
        return None

    def connect(self, address: str) -> None:
        self.address = address

    def sendall(self, data: bytes) -> None:
        self.sent.append(data)

    def recv(self, _size: int) -> bytes:
        reply, self.reply = self.reply or b"", None
        return reply


def _ipc_session(
    monkeypatch: pytest.MonkeyPatch, reply: dict[str, Any]
) -> tuple[Any, _FakeIpcSocket]:
    ipc = _FakeIpcSocket(reply)
    monkeypatch.setattr(
        llmcore,
        "socket",
        types.SimpleNamespace(AF_UNIX=1, SOCK_STREAM=1, socket=lambda *_a: ipc),
    )
    sess = llmcore.LLMSession(
        {
            "name": "chatgpt-test",
            "apikey": "galley-codex-oauth",
            "apibase": "https://api.openai.com/v1",
            "model": "gpt-5.6-sol",
            "api_mode": "responses",
            "codex_backend": True,
            "galley_api_key_ref": "managed-provider:mp_chatgpt_codex",
            "galley_credential_ipc": {"kind": "unix", "address": "/galley.sock", "token": "t"},
        }
    )
    return sess, ipc


def test_codex_backend_takes_its_token_from_core_credential_ipc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    net = _install_network(monkeypatch, _OK_STREAM)
    # An `accountId` in the reply (Core no longer sends one) is not a header.
    sess, ipc = _ipc_session(
        monkeypatch, {"accessToken": "access-from-core", "accountId": "acct-1"}
    )

    chunks, _ = _run(sess)

    assert chunks == ["ok"]
    assert ipc.address == "/galley.sock"
    [request] = ipc.sent
    assert json.loads(request) == {
        "token": "t",
        "apiKeyRef": "managed-provider:mp_chatgpt_codex",
    }
    headers = net.posts[0]["headers"]
    assert headers["Authorization"] == "Bearer access-from-core"
    assert "ChatGPT-Account-ID" not in headers


def test_codex_backend_names_the_code_core_refused_with(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cleared sign-in: Core answers with its error envelope, and the code
    reaches the turn text, where the GUI offers to sign in again."""
    _install_network(monkeypatch, _OK_STREAM)
    sess, _ = _ipc_session(
        monkeypatch,
        {
            "error": "invalid_args",
            "message": "chatgpt_plan_reauth_required: ChatGPT sign-in has expired",
        },
    )

    with pytest.raises(RuntimeError) as raised:
        _run(sess)

    message = str(raised.value)
    assert message.startswith("Galley Codex credential refresh failed: ")
    assert "chatgpt_plan_reauth_required" in message


def test_without_the_codex_backend_ga_headers_are_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    net = _install_network(monkeypatch, _OK_STREAM)
    sess = _codex_session(codex_backend=False)

    _run(sess)

    headers = net.posts[0]["headers"]
    assert headers["User-Agent"] == sess.user_agent
    assert headers["originator"] == "codex_exec"
    assert headers["Authorization"] == f"Bearer {sess.api_key}"
    assert "store" not in net.posts[0]["payload"]


# (error.code, HTTP status, retried, text the message must carry)
_PLAN_ERROR_ROWS = [
    (
        "subscription_sharing_usage_limit_exceeded",
        429,
        False,
        ["usage limit", "limit you set for Galley", "https://chatgpt.com/settings/usage"],
    ),
    ("subscription_sharing_user_not_eligible", 403, False, ["API key provider"]),
    (
        "subscription_sharing_unsupported_capability",
        400,
        False,
        ["does not support this request", "param: tools"],
    ),
    ("subscription_sharing_route_not_supported", 400, False, ["request rejected"]),
    ("subscription_sharing_invalid_user", 401, False, ["request rejected"]),
    ("chatpass_v2_scope_not_authorized", 403, False, ["request rejected"]),
    ("chatpass_v2_invalid_authorization_context", 401, False, ["request rejected"]),
    ("token_revoked", 401, False, ["revoked or disconnected", "sign in again"]),
    ("subscription_sharing_usage_unavailable", 503, True, ["temporarily unavailable"]),
    ("subscription_sharing_user_unavailable", 503, True, ["temporarily unavailable"]),
]


# These explain themselves; every other row carries the server's message.
_FIXED_COPY_CODES = {
    "subscription_sharing_usage_limit_exceeded",
    "subscription_sharing_user_not_eligible",
    "token_revoked",
}


def _plan_error(code: str) -> dict[str, Any]:
    return {"code": code, "param": "tools", "message": "server says"}


def _assert_plan_message(message: str, code: str, texts: list[str]) -> None:
    assert code in message
    for text in texts:
        assert text in message
    assert ("server says" in message) is (code not in _FIXED_COPY_CODES)


@pytest.mark.parametrize(("code", "status", "retried", "texts"), _PLAN_ERROR_ROWS)
def test_chatgpt_plan_http_error_is_classified_by_code(
    monkeypatch: pytest.MonkeyPatch,
    code: str,
    status: int,
    retried: bool,
    texts: list[str],
) -> None:
    net = _install_network(monkeypatch, _FakeHTTPResponse(status, {"error": _plan_error(code)}))

    chunks, blocks = _run(_codex_session())

    # max_retries=2: a retried code is sent three times, a terminal one once.
    assert len(net.posts) == (3 if retried else 1)
    [message] = chunks
    assert message.startswith(f"!!!Error: HTTP {status}: ")
    _assert_plan_message(message, code, texts)
    assert blocks == [{"type": "text", "text": message}]
    assert net.gets == []


@pytest.mark.parametrize(("code", "status", "retried", "texts"), _PLAN_ERROR_ROWS)
def test_chatgpt_plan_response_failed_is_classified_by_code(
    monkeypatch: pytest.MonkeyPatch,
    code: str,
    status: int,
    retried: bool,
    texts: list[str],
) -> None:
    del status  # the stream itself is HTTP 200
    failed = _FakeHTTPResponse(
        200,
        lines=tuple(
            _sse(
                {
                    "type": "response.failed",
                    "response": {"error": _plan_error(code), "usage": {"input_tokens": 9}},
                }
            )
        ),
    )
    net = _install_network(monkeypatch, failed)

    chunks, blocks = _run(_codex_session())

    assert len(net.posts) == (3 if retried else 1)
    [message] = chunks
    if retried:
        # GA's own network backoff gave up; the message is the plan's.
        assert message.startswith("!!!Error: ConnectionError: ")
    else:
        assert message.startswith("!!!Error: ")
        assert "ConnectionError" not in message
    _assert_plan_message(message, code, texts)
    assert blocks == [{"type": "text", "text": message}]


def test_chatgpt_plan_usage_limit_is_not_retried_even_if_it_reads_like_a_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GA's overload heuristic retries any in-stream error that mentions a rate
    limit; a terminal plan code must end the call first."""
    err = {
        "code": "subscription_sharing_usage_limit_exceeded",
        "message": "Rate limit reached, retry later",
    }
    failed = _FakeHTTPResponse(
        200,
        lines=tuple(
            _sse(
                {"type": "response.output_text.delta", "delta": "partial "},
                {"type": "response.failed", "response": {"error": err}},
            )
        ),
    )
    net = _install_network(monkeypatch, failed)

    chunks, blocks = _run(_codex_session())

    assert len(net.posts) == 1
    assert chunks[0] == "partial "
    assert chunks[1].startswith("!!!Error: ChatGPT plan usage limit reached")
    # Same block shape as GA's own response.failed handling.
    assert blocks == [{"type": "text", "text": "partial " + chunks[1]}]


def test_chatgpt_plan_error_event_is_classified_by_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream = _FakeHTTPResponse(
        200,
        lines=tuple(
            _sse(
                {
                    "type": "error",
                    "code": "subscription_sharing_user_not_eligible",
                    "message": "not eligible",
                }
            )
        ),
    )
    net = _install_network(monkeypatch, stream)

    chunks, _ = _run(_codex_session())

    assert len(net.posts) == 1
    assert chunks == [
        "!!!Error: This ChatGPT account cannot use its plan in Galley "
        "(subscription_sharing_user_not_eligible); use an API key provider instead"
    ]


def test_chatgpt_plan_unavailable_then_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    unavailable = _FakeHTTPResponse(
        503, {"error": _plan_error("subscription_sharing_usage_unavailable")}
    )
    net = _install_network(monkeypatch, unavailable, _OK_STREAM)

    chunks, _ = _run(_codex_session())

    assert len(net.posts) == 2
    assert chunks == ["ok"]


def test_chatgpt_plan_revoked_token_is_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    """The body measured live (2026-10-20) after revoking the refresh token: the
    still-unexpired access token gets this 401. Disconnecting Galley in ChatGPT
    settings is expected to answer the same."""
    body = (
        '{"error":{"message":"Encountered invalidated oauth token for user, failing request",'
        '"type":null,"code":"token_revoked","param":null},"status":401}'
    )
    net = _install_network(monkeypatch, _FakeHTTPResponse(401, body))

    chunks, blocks = _run(_codex_session())

    assert len(net.posts) == 1
    assert chunks == [
        "!!!Error: HTTP 401: ChatGPT sign-in was revoked or disconnected (token_revoked); "
        "sign in again in Settings → Models"
    ]
    assert blocks == [{"type": "text", "text": chunks[0]}]
    assert net.gets == []


def test_without_the_codex_backend_token_revoked_is_ga_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = {"error": {"code": "token_revoked", "message": "invalidated"}}
    _install_network(monkeypatch, _FakeHTTPResponse(401, body))

    chunks, _ = _run(_codex_session(codex_backend=False))

    assert chunks == [f"!!!Error: HTTP 401: {json.dumps(body)}"]


def test_chatgpt_plan_detail_shaped_error_body(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"detail": {"code": "subscription_sharing_user_not_eligible", "message": "nope"}}
    net = _install_network(monkeypatch, _FakeHTTPResponse(403, body))

    chunks, _ = _run(_codex_session())

    assert len(net.posts) == 1
    assert chunks[0].startswith("!!!Error: HTTP 403: This ChatGPT account cannot use its plan")


def test_chatgpt_plan_codeless_errors_keep_ga_handling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bare {"detail": "..."} has no code: GA's message, GA's retry rules."""
    net = _install_network(monkeypatch, _FakeHTTPResponse(401, {"detail": "Unauthorized"}))

    chunks, _ = _run(_codex_session())

    assert len(net.posts) == 1
    assert chunks == ['!!!Error: HTTP 401: {"detail": "Unauthorized"}']


def test_chatgpt_plan_unknown_429_keeps_ga_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = {"error": {"code": "rate_limit_exceeded", "message": "slow down"}}
    net = _install_network(monkeypatch, _FakeHTTPResponse(429, body))

    chunks, _ = _run(_codex_session())

    assert len(net.posts) == 3
    assert chunks == [f"!!!Error: HTTP 429: {json.dumps(body)}"]
    assert net.gets == []


def test_chatgpt_plan_unknown_failed_code_keeps_ga_parser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed = _FakeHTTPResponse(
        200,
        lines=tuple(
            _sse(
                {
                    "type": "response.failed",
                    "response": {"error": {"code": "server_error", "message": "boom"}},
                }
            )
        ),
    )
    net = _install_network(monkeypatch, failed)

    chunks, _ = _run(_codex_session())

    assert len(net.posts) == 1
    assert chunks == ["!!!Error: boom"]


def test_without_the_codex_backend_plan_codes_keep_ga_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Outside the ChatGPT backend the plan codes mean nothing: 429 retries."""
    body = {"error": _plan_error("subscription_sharing_usage_limit_exceeded")}
    net = _install_network(monkeypatch, _FakeHTTPResponse(429, body))

    chunks, _ = _run(_codex_session(codex_backend=False))

    assert len(net.posts) == 3
    assert net.gets == []
    assert chunks == [f"!!!Error: HTTP 429: {json.dumps(body)}"]
