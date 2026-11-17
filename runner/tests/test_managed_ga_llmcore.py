"""Managed GenericAgent parser compatibility tests."""
from __future__ import annotations

import base64
import copy
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


def _codex_session(
    *, codex_backend: bool = True, apibase: str = "https://api.openai.com/v1"
) -> Any:
    cfg: dict[str, Any] = {
        "name": "chatgpt-test",
        "apikey": _jwt_with_account("acct-123"),
        "apibase": apibase,
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
    # The plan backend routes a session's requests to its cache by this
    # header; `prompt_cache_key` in the body alone does not (ticket siwc 08).
    assert headers["session_id"] == payload["prompt_cache_key"]
    assert payload["include"] == ["reasoning.encrypted_content"]


class _FakeIpcSocket:
    """Stands in for the AF_UNIX socket to Core's credential IPC: records what
    the engine sends and answers one line, `answers_after` seconds after the
    request. No clock runs: like a real socket's `recv`, it times out when the
    engine's timeout is shorter than that, and answers otherwise."""

    def __init__(self, reply: dict[str, Any], answers_after: float = 0.0) -> None:
        self.reply: bytes | None = json.dumps(reply).encode() + b"\n"
        self.answers_after = answers_after
        self.timeout: float | None = None
        self.address: str | None = None
        self.sent: list[bytes] = []

    def __enter__(self) -> _FakeIpcSocket:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def settimeout(self, timeout: float) -> None:
        self.timeout = timeout

    def connect(self, address: str) -> None:
        self.address = address

    def sendall(self, data: bytes) -> None:
        self.sent.append(data)

    def recv(self, _size: int) -> bytes:
        if self.timeout is not None and self.timeout < self.answers_after:
            raise TimeoutError("timed out")
        reply, self.reply = self.reply or b"", None
        return reply


def _ipc_session(
    monkeypatch: pytest.MonkeyPatch,
    reply: dict[str, Any],
    *,
    answers_after: float = 0.0,
    extra: dict[str, Any] | None = None,
) -> tuple[Any, _FakeIpcSocket]:
    ipc = _FakeIpcSocket(reply, answers_after)
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
            **(extra or {}),
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


def test_codex_backend_waits_for_a_token_core_refreshes_slowly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Main chat ticket 122: the first request after an hour idle waits for
    Core to refresh the token, which took 11 s on 2026-11-02 and may take
    Core's whole 20 s HTTP timeout. The plan preset's `connect_timeout` is
    10 s; the token fetch waits at least 30."""
    net = _install_network(monkeypatch, _OK_STREAM)
    sess, ipc = _ipc_session(
        monkeypatch,
        {"accessToken": "access-after-refresh"},
        answers_after=12,
        extra={"timeout": 10},
    )
    assert sess.connect_timeout == 10

    chunks, _ = _run(sess)

    assert chunks == ["ok"]
    assert ipc.timeout == 30
    assert net.posts[0]["headers"]["Authorization"] == "Bearer access-after-refresh"


def test_codex_backend_token_wait_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Past the wait, the fetch fails as before, outside GA's retry loop:
    the error names the timeout."""
    _install_network(monkeypatch, _OK_STREAM)
    sess, _ = _ipc_session(
        monkeypatch,
        {"accessToken": "too-late"},
        answers_after=31,
        extra={"timeout": 10},
    )

    with pytest.raises(RuntimeError) as raised:
        _run(sess)

    assert str(raised.value) == "Galley Codex credential refresh failed: timed out"


@pytest.mark.parametrize(("codex_backend", "expected"), [(True, "medium"), (False, "minimal")])
def test_codex_backend_raises_a_minimal_effort_to_medium(
    codex_backend: bool, expected: str
) -> None:
    """The plan backend has no `minimal`; the engine raises it (the runner
    passes the configured effort through)."""
    cfg: dict[str, Any] = {
        "name": "chatgpt-test",
        "apikey": "galley-codex-oauth",
        "apibase": "https://api.openai.com/v1",
        "model": "gpt-5.6-sol",
        "reasoning_effort": "minimal",
    }
    if codex_backend:
        cfg["codex_backend"] = True

    assert llmcore.LLMSession(cfg).reasoning_effort == expected


def test_without_the_codex_backend_ga_headers_are_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    net = _install_network(monkeypatch, _OK_STREAM)
    # Off the official host: there 0033 drops the Codex identity.
    sess = _codex_session(codex_backend=False, apibase="https://relay.example.test/v1")

    _run(sess)

    headers = net.posts[0]["headers"]
    assert headers["User-Agent"] == sess.user_agent
    assert headers["originator"] == "codex_exec"
    assert headers["Authorization"] == f"Bearer {sess.api_key}"
    assert "session_id" not in headers
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


# Patch 0030 (ticket 118): a whitespace runaway in a tool call's arguments.
# On 2026-10-21 a model opened `web_execute_js` normally, then streamed 400k
# tabs and newlines for 15 minutes over the plan backend. The fakes stream
# that opening, then 18 times the threshold in the same shape (a newline and
# 17 tabs per delta), then the events that would close the call; the guard
# stops reading near the threshold, closes the response unread, posts once,
# and keeps the bulk out of the returned blocks and the session history.

_SUMMARY = "<summary>open the search page</summary>\n"
_OPENING = (
    '{"script":"{\\"cmd\\":\\"tabs\\",\\"method\\":\\"create\\",\\"active\\":true}'
    'x switching?}("'
)
_WS_PIECE = "\n" + "\t" * 17
_WS_RUNAWAY = (_WS_PIECE,) * 2000
# Deltas read until the run reaches the threshold.
_WS_PIECES_TO_TRIP = -(-llmcore._GALLEY_ARGS_WS_RUN // len(_WS_PIECE))
_ARGS_MARKER: str = llmcore._GALLEY_ARGS_MARKER
# Valid arguments: escaped newlines and tabs inside a string, indentation and
# newlines between tokens, longer than the threshold.
_NORMAL_ARGS: dict[str, Any] = {
    "path": "a.py",
    "content": "def f():\n\treturn 1\n" * 200,
    "flags": {"overwrite": True, "mode": "w"},
}


def _deltas(text: str, size: int = 7) -> tuple[str, ...]:
    return tuple(text[i : i + size] for i in range(0, len(text), size))


def _responses_lines(arg_deltas: tuple[str, ...]) -> list[str]:
    return _sse(
        {"type": "response.output_text.delta", "delta": _SUMMARY},
        {
            "type": "response.output_item.added",
            "output_index": 1,
            "item": {"type": "function_call", "call_id": "call_1", "name": "web_execute_js"},
        },
        *(
            {"type": "response.function_call_arguments.delta", "output_index": 1, "delta": d}
            for d in arg_deltas
        ),
        {
            "type": "response.function_call_arguments.done",
            "output_index": 1,
            "arguments": "".join(arg_deltas),
        },
        {
            "type": "response.completed",
            "response": {"usage": {"input_tokens": 10, "output_tokens": 5}},
        },
    )


def _chat_lines(arg_deltas: tuple[str, ...]) -> list[str]:
    call = {"index": 0, "id": "call_1", "function": {"name": "web_execute_js", "arguments": ""}}
    return _oai_stream(
        {"content": _SUMMARY},
        {"tool_calls": [call]},
        *({"tool_calls": [{"index": 0, "function": {"arguments": d}}]} for d in arg_deltas),
    )


def _claude_lines(arg_deltas: tuple[str, ...]) -> list[str]:
    return _sse(
        {"type": "message_start", "message": {"usage": {"input_tokens": 10}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": _SUMMARY},
        },
        {"type": "content_block_stop", "index": 0},
        {
            "type": "content_block_start",
            "index": 1,
            "content_block": {"type": "tool_use", "id": "call_1", "name": "web_execute_js"},
        },
        *(
            {
                "type": "content_block_delta",
                "index": 1,
                "delta": {"type": "input_json_delta", "partial_json": d},
            }
            for d in arg_deltas
        ),
        {"type": "content_block_stop", "index": 1},
        {
            "type": "message_delta",
            "delta": {"stop_reason": "tool_use"},
            "usage": {"output_tokens": 5},
        },
        {"type": "message_stop"},
    )


class _Counted:
    """Yields the lines one by one and counts how many were read."""

    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.read = 0

    def __iter__(self) -> Any:
        for line in self.lines:
            self.read += 1
            yield line


_PROTOCOLS: dict[str, tuple[Any, Any]] = {
    "responses": (_responses_lines, lambda ls: llmcore._parse_openai_sse(ls, "responses")),
    "chat_completions": (
        _chat_lines,
        lambda ls: llmcore._parse_openai_sse(ls, "chat_completions"),
    ),
    "claude": (_claude_lines, llmcore._parse_claude_sse),
}


def test_whitespace_runaway_threshold_is_a_run_at_the_tail() -> None:
    cut = llmcore._galley_args_cut
    n = llmcore._GALLEY_ARGS_WS_RUN

    assert n == 2000 and llmcore._GALLEY_ARGS_KEEP == 800
    assert cut('{"a": 1' + " \t\r\n" * 499 + "\t" * 3) is None  # 1,999
    assert cut('{"a": 1' + " \t\r\n" * 500) == '{"a": 1'  # 2,000
    # A run broken by one token does not count.
    assert cut('{"a": 1' + "\t" * 1000 + "," + "\t" * 1999) is None
    # Other Unicode whitespace is not JSON whitespace.
    assert cut('{"a": 1' + "　" * 3000) is None
    long_opening = '{"script":"' + "x" * 1500
    assert cut(long_opening + "\n" * n) == long_opening[:800]
    # The cut drops whitespace the first 800 characters end in.
    assert cut('{"a":' + " " * 3000) == '{"a":'


@pytest.mark.parametrize("protocol", sorted(_PROTOCOLS))
def test_normal_tool_arguments_are_untouched(protocol: str) -> None:
    build, parse = _PROTOCOLS[protocol]
    args = json.dumps(_NORMAL_ARGS, indent=2)
    assert "\\n\\t" in args and "\n  " in args and len(args) > 2000
    lines = _Counted(build(_deltas(args)))

    chunks, blocks = _collect(parse(iter(lines)))

    assert lines.read == len(lines.lines)
    assert chunks == [_SUMMARY]
    [tool_use] = [b for b in blocks if b["type"] == "tool_use"]
    assert tool_use["input"] == _NORMAL_ARGS


class _StreamedResponse(_FakeHTTPResponse):
    """A 200 SSE response that counts the lines the engine read and when it
    left the `with` block (real `requests` closes the connection of a
    response left unread there)."""

    def __init__(self, lines: list[str]) -> None:
        super().__init__(200, lines=tuple(lines))
        self.read = 0
        self.closed_after: int | None = None

    def __exit__(self, *_args: object) -> None:
        self.closed_after = self.read

    def iter_lines(self, *_args: object, **_kwargs: object) -> Any:
        for line in self._lines:
            self.read += 1
            yield line


def _serve_once(monkeypatch: pytest.MonkeyPatch, resp: _StreamedResponse) -> list[str]:
    _install_network(monkeypatch, _OK_STREAM)
    posts: list[str] = []

    def post(url: str, **_kwargs: Any) -> _StreamedResponse:
        posts.append(url)
        return resp

    monkeypatch.setattr(llmcore.requests, "post", post, raising=False)
    return posts


def _ask_native_oai(cfg: dict[str, Any]) -> tuple[Any, list[str], Any]:
    sess = llmcore.NativeOAISession(
        {"name": "t118", "apikey": "k", "model": "gpt-5.6-sol", "max_retries": 2, **cfg}
    )
    msg = {"role": "user", "content": [{"type": "text", "text": "open the search page"}]}
    chunks, response = _collect(sess.ask(msg))
    return sess, chunks, response


def _assert_cut(
    sess: Any, chunks: list[str], response: Any, kept: str, resp: _StreamedResponse, before: int
) -> None:
    # Reading stopped on the delta that made the run 2,000 long, and the
    # response was closed right there, unread.
    assert resp.read == before + _WS_PIECES_TO_TRIP
    assert resp.closed_after == resp.read < len(resp._lines)
    # The model's reply text says why its call was cut.
    assert chunks == [_SUMMARY, "\n\n" + _ARGS_MARKER]
    assert response.content == (_SUMMARY + "\n\n" + _ARGS_MARKER).strip()
    [call] = response.tool_calls
    assert call.function.name == "web_execute_js"
    # Not valid JSON, so it lands as `_raw` as before: `do_web_execute_js`
    # finds no script and says so, and the model sends the call again.
    assert json.loads(call.function.arguments) == {"_raw": kept}
    assert sess.history[-1]["content"] == [
        {"type": "text", "text": _SUMMARY + "\n\n" + _ARGS_MARKER},
        {"type": "tool_use", "id": "call_1", "name": "web_execute_js", "input": {"_raw": kept}},
    ]
    assert len(json.dumps(sess.history, ensure_ascii=False)) < 2000


def test_whitespace_runaway_cut_on_the_plan_backend_responses_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The 10-21 route: Sign in with ChatGPT, Responses API, no output cap."""
    resp = _StreamedResponse(_responses_lines((_OPENING, *_WS_RUNAWAY)))
    posts = _serve_once(monkeypatch, resp)
    usage: list[Any] = []
    monkeypatch.setattr(llmcore, "_record_usage", lambda u, _mode: usage.append(u))

    sess, chunks, response = _ask_native_oai(
        {"apibase": "https://api.example.test/v1", "api_mode": "responses", "codex_backend": True}
    )

    assert len(posts) == 1
    _assert_cut(sess, chunks, response, _OPENING, resp, before=3)
    # `response.completed` was never read: no usage is recorded, none made up.
    assert usage == []


def test_whitespace_runaway_cut_on_a_chat_completions_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An opening past 800 characters keeps its first 800."""
    opening = '{"script":"' + "document.title;" * 100
    resp = _StreamedResponse(_chat_lines((opening, *_WS_RUNAWAY)))
    posts = _serve_once(monkeypatch, resp)

    sess, chunks, response = _ask_native_oai(
        {"apibase": "https://api.example.test/v1", "api_mode": "chat_completions"}
    )

    assert len(posts) == 1
    _assert_cut(sess, chunks, response, opening[:800], resp, before=3)


def test_whitespace_runaway_cut_on_a_claude_stream() -> None:
    lines = _Counted(_claude_lines((_OPENING, *_WS_RUNAWAY)))

    chunks, blocks = _collect(llmcore._parse_claude_sse(iter(lines)))

    assert lines.read == 6 + _WS_PIECES_TO_TRIP
    assert chunks == [_SUMMARY, "\n\n" + _ARGS_MARKER]
    # Upstream's warning slot: a text block right before the tool call.
    assert blocks == [
        {"type": "text", "text": _SUMMARY},
        {"type": "text", "text": "\n\n" + _ARGS_MARKER},
        {"type": "tool_use", "id": "call_1", "name": "web_execute_js", "input": {"_raw": _OPENING}},
    ]


# Patch 0031 (ticket 140): a model request gets 300 s from sending to the last
# line read. On 2026-11-03 a sub-task's `web_execute_js` call on the plan
# backend opened normally, then streamed ~82 KB of looping junk (not
# whitespace, so 0030 did not match) for 901 s. The fakes advance a fake
# monotonic clock one second per line read (after an optional wait before the
# first line), so the deadline passes on line 301 and nothing waits 300 s.

_JUNK = "}u}g}6}#}t}e}"
_JUNK_RUNAWAY = (_JUNK,) * 2000
_DEADLINE_MARKER: str = llmcore._GALLEY_DEADLINE_MARKER
_MAX_SEC: int = llmcore._GALLEY_REQUEST_MAX_SEC
_KEEP: int = llmcore._GALLEY_ARGS_KEEP


class _TimedResponse(_StreamedResponse):
    """A `_StreamedResponse` on a fake clock: the first line comes `wait`
    seconds after the request, every line one second after the one before."""

    def __init__(self, lines: list[str], clock: list[float], wait: float = 0.0) -> None:
        super().__init__(lines)
        self.clock = clock
        self.wait = wait

    def iter_lines(self, *_args: object, **_kwargs: object) -> Any:
        self.clock[0] += self.wait
        for line in self._lines:
            self.clock[0] += 1.0
            self.read += 1
            yield line


def _serve_timed(
    monkeypatch: pytest.MonkeyPatch, lines: list[str], wait: float = 0.0
) -> tuple[_TimedResponse, list[str], list[Any]]:
    clock = [5_000.0]
    monkeypatch.setattr(llmcore.time, "monotonic", lambda: clock[0])
    resp = _TimedResponse(lines, clock, wait)
    posts = _serve_once(monkeypatch, resp)
    usage: list[Any] = []
    monkeypatch.setattr(llmcore, "_record_usage", lambda u, _mode: usage.append(u))
    return resp, posts, usage


def _ask_native_claude() -> tuple[Any, list[str], Any]:
    sess = llmcore.NativeClaudeSession(
        {
            "name": "t140",
            "apikey": "k",
            "apibase": "https://api.example.test",
            "model": "claude-test",
            "max_retries": 2,
        }
    )
    msg = {"role": "user", "content": [{"type": "text", "text": "open the search page"}]}
    chunks, response = _collect(sess.ask(msg))
    return sess, chunks, response


_SESSIONS: dict[str, Any] = {
    "plan_responses": lambda: _ask_native_oai(
        {"apibase": "https://api.example.test/v1", "api_mode": "responses", "codex_backend": True}
    ),
    "chat_completions": lambda: _ask_native_oai(
        {"apibase": "https://api.example.test/v1", "api_mode": "chat_completions"}
    ),
    "claude": _ask_native_claude,
}
# Stream builder per session, and how many lines it puts around the
# argument deltas (before them, in all).
_SESSION_LINES: dict[str, tuple[Any, int, int]] = {
    "plan_responses": (_responses_lines, 3, 4),
    "chat_completions": (_chat_lines, 3, 3),
    "claude": (_claude_lines, 6, 8),
}


def _split(text: str, n: int) -> tuple[str, ...]:
    return tuple(text[i * len(text) // n : (i + 1) * len(text) // n] for i in range(n))


def test_deadline_cut_keeps_heads_and_places_the_marker() -> None:
    cut = llmcore._galley_deadline_cut
    marker = _DEADLINE_MARKER

    assert _MAX_SEC == 300 and _KEEP == 800
    # Upstream's interrupted-stream form, short enough for do_no_tool's
    # `'[!!! 流异常中断' in content[-100:]`.
    assert marker.startswith("[!!! 流异常中断") and marker.endswith("!!!]") and len(marker) < 100
    long = "x" * 3000
    signed = {"type": "thinking", "thinking": long, "signature": "sig"}
    parsed = {"type": "tool_use", "id": "a", "name": "file_write", "input": {"content": long}}
    raw = {"type": "tool_use", "id": "b", "name": "code_run", "input": {"_raw": "y" * 900}}
    blocks: list[dict[str, Any]] = [
        signed,
        {"type": "thinking", "thinking": long},
        {"type": "text", "text": long},
        parsed,
        raw,
        {"type": "text", "text": "after"},
    ]

    chunk, out = cut(blocks)

    assert chunk == "\n\n" + marker
    assert out == [
        signed,  # signed thinking is complete; its signature covers every character
        {"type": "thinking", "thinking": "x" * 800},
        {"type": "text", "text": "x" * 800 + "\n\n" + marker},  # the text before the first call
        parsed,  # arguments that parsed arrived whole
        {"type": "tool_use", "id": "b", "name": "code_run", "input": {"_raw": "y" * 800}},
        {"type": "text", "text": "after"},
    ]
    assert blocks[2]["text"] == long  # the parser's blocks are left alone
    # `_raw` drops the whitespace its head ends in, as 0030's cut does.
    _, out = cut([{"type": "tool_use", "id": "c", "name": "n", "input": {"_raw": "{" + " " * 900}}])
    assert out[1]["input"] == {"_raw": "{"}
    # No text before the first call: the marker is a text block of its own
    # there (upstream's warning slot); nothing at all: the marker alone.
    _, out = cut([{"type": "thinking", "thinking": "t", "signature": "s"}, raw])
    assert [b["type"] for b in out] == ["thinking", "text", "tool_use"]
    assert out[1] == {"type": "text", "text": marker}
    assert cut([]) == (marker, [{"type": "text", "text": marker}])


def test_do_no_tool_regenerates_on_the_deadline_marker() -> None:
    """A cut reply without a tool call relies on upstream's own check."""
    ga_source = (_MANAGED_GA_CODE / "ga.py").read_text(encoding="utf-8")
    check = "if '[!!! 流异常中断' in content[-100:]"
    assert check in ga_source
    assert 'return self._retry_or_exit("[ERROR] Incomplete response.' in ga_source.split(check)[1]


@pytest.mark.parametrize("session", sorted(_SESSIONS))
def test_a_normal_stream_read_by_the_deadline_is_untouched(
    monkeypatch: pytest.MonkeyPatch, session: str
) -> None:
    """Its last line comes at 300 s exactly: read to the end, nothing cut."""
    build, _before, around = _SESSION_LINES[session]
    args = json.dumps(_NORMAL_ARGS, indent=2)
    resp, posts, _usage = _serve_timed(monkeypatch, build(_split(args, _MAX_SEC - around)))
    assert len(resp._lines) == _MAX_SEC

    sess, chunks, response = _SESSIONS[session]()

    assert len(posts) == 1
    assert resp.read == len(resp._lines)
    assert chunks == [_SUMMARY]
    [call] = response.tool_calls
    assert json.loads(call.function.arguments) == _NORMAL_ARGS
    assert _DEADLINE_MARKER not in json.dumps(sess.history, ensure_ascii=False)


@pytest.mark.parametrize("session", sorted(_SESSIONS))
def test_a_junk_runaway_in_tool_arguments_is_cut_at_the_deadline(
    monkeypatch: pytest.MonkeyPatch, session: str
) -> None:
    """The 11-03 shape: an opening, then looping junk that never stops."""
    build, before, _around = _SESSION_LINES[session]
    resp, posts, usage = _serve_timed(monkeypatch, build((_OPENING, *_JUNK_RUNAWAY)))

    sess, chunks, response = _SESSIONS[session]()

    # One request: reading stopped on the first line past 300 s and the
    # response was closed right there, unread; nothing retried.
    assert len(posts) == 1
    assert resp.read == _MAX_SEC + 1
    assert resp.closed_after == resp.read < len(resp._lines)
    # The model's reply says why, after what it streamed.
    assert chunks == [_SUMMARY, "\n\n" + _DEADLINE_MARKER]
    assert response.content == (_SUMMARY + "\n\n" + _DEADLINE_MARKER).strip()
    # The arguments read by then keep their first 800 characters: not valid
    # JSON, so `_raw` as before, the tool says what is missing, and the model
    # sends the call again.
    junk = _JUNK * (_MAX_SEC - before)
    kept = (_OPENING + junk)[:_KEEP]
    [call] = response.tool_calls
    assert call.function.name == "web_execute_js"
    assert json.loads(call.function.arguments) == {"_raw": kept}
    assert sess.history[-1]["content"] == [
        {"type": "text", "text": _SUMMARY + "\n\n" + _DEADLINE_MARKER},
        {"type": "tool_use", "id": "call_1", "name": "web_execute_js", "input": {"_raw": kept}},
    ]
    assert len(json.dumps(sess.history, ensure_ascii=False)) < 2000
    # No usage event was read and none is made up; the Anthropic stream had
    # recorded its input side at message_start.
    assert usage == ([{"input_tokens": 10}] if session == "claude" else [])


def test_a_runaway_reply_without_a_tool_call_is_cut_and_regenerated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Junk in the reply text: shown as it streams, cut in history, and the
    reply ends in the marker do_no_tool regenerates on."""
    lines = _oai_stream({"content": _SUMMARY}, *({"content": _JUNK} for _ in range(2000)))
    resp, posts, _usage = _serve_timed(monkeypatch, lines)

    sess, chunks, response = _SESSIONS["chat_completions"]()

    assert len(posts) == 1 and resp.read == _MAX_SEC + 1
    assert chunks == [_SUMMARY, *[_JUNK] * (_MAX_SEC - 1), "\n\n" + _DEADLINE_MARKER]
    assert response.tool_calls == []
    text = (_SUMMARY + _JUNK * (_MAX_SEC - 1))[:_KEEP] + "\n\n" + _DEADLINE_MARKER
    assert sess.history[-1]["content"] == [{"type": "text", "text": text}]
    assert "[!!! 流异常中断" in response.content[-100:]


def test_a_reasoning_runaway_is_cut_to_the_marker_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reasoning that never reaches an answer: its head stays, the reply is
    the marker, which do_no_tool regenerates on."""
    lines = _oai_stream(*({"reasoning_content": _JUNK} for _ in range(2000)))
    resp, posts, _usage = _serve_timed(monkeypatch, lines)

    sess, chunks, response = _SESSIONS["chat_completions"]()

    assert len(posts) == 1 and resp.read == _MAX_SEC + 1
    assert chunks[0] == "<thinking>" + _JUNK
    assert chunks[-2:] == ["</thinking>", _DEADLINE_MARKER]
    assert sess.history[-1]["content"] == [
        {"type": "thinking", "thinking": (_JUNK * _MAX_SEC)[:_KEEP]},
        {"type": "text", "text": _DEADLINE_MARKER},
    ]
    assert response.content == _DEADLINE_MARKER
    assert "[!!! 流异常中断" in response.content[-100:]


@pytest.mark.parametrize("wait", [185.0, 186.0])
def test_the_whitespace_guard_and_the_deadline_never_both_cut(
    monkeypatch: pytest.MonkeyPatch, wait: float
) -> None:
    """Line 115 of this stream makes the whitespace run 2,000 long (0030).
    It comes at 300 s after a 185 s wait, at 301 s after a 186 s one: the
    line decides, and only one of the two cuts the reply, once."""
    trip = 3 + _WS_PIECES_TO_TRIP
    assert trip == 115
    resp, posts, _usage = _serve_timed(
        monkeypatch, _responses_lines((_OPENING, *_WS_RUNAWAY)), wait=wait
    )

    sess, chunks, response = _SESSIONS["plan_responses"]()

    assert len(posts) == 1
    marker = _ARGS_MARKER if wait == 185.0 else _DEADLINE_MARKER
    other = _DEADLINE_MARKER if wait == 185.0 else _ARGS_MARKER
    # 0030 stops reading on line 115; the deadline drops line 115 unread, so
    # the run stays at 1,998 and 0030 never sees it.
    assert resp.read == resp.closed_after == trip
    assert chunks == [_SUMMARY, "\n\n" + marker]
    history = json.dumps(sess.history, ensure_ascii=False)
    assert history.count(marker) == 1 and other not in history
    # Either way the arguments are the opening, the whitespace dropped.
    [call] = response.tool_calls
    assert json.loads(call.function.arguments) == {"_raw": _OPENING}


# Patch 0032: toward the official Anthropic API (host exactly
# api.anthropic.com), Claude Code passthrough on or off, an Anthropic-protocol
# request says nothing of Claude Code; every other request is unchanged. With
# those markers the official API refuses a subscription's API credit
# ("credit balance is too low", 400).

_CC_BETA = "claude-code-20250219"
_CC_HEADERS = ("x-app", "X-Claude-Code-Session-Id")

_CLAUDE_OK = _FakeHTTPResponse(
    200,
    lines=tuple(
        _sse(
            {"type": "message_start", "message": {"usage": {"input_tokens": 10}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "ok"},
            },
            {"type": "content_block_stop", "index": 0},
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 1},
            },
            {"type": "message_stop"},
        )
    ),
)


def _claude_request(
    monkeypatch: pytest.MonkeyPatch, apibase: str, **cfg: Any
) -> tuple[Any, dict[str, Any]]:
    """One turn through `NativeClaudeSession`; returns the session and the
    request it sent."""
    net = _install_network(monkeypatch, _CLAUDE_OK)
    sess = llmcore.NativeClaudeSession(
        {
            "name": "t0032",
            "apikey": "sk-ant-api03-test",
            "apibase": apibase,
            "model": "claude-test",
            "max_retries": 2,
            **cfg,
        }
    )
    msg = {"role": "user", "content": [{"type": "text", "text": "hi"}]}
    chunks, _ = _collect(sess.ask(msg))
    assert chunks == ["ok"]
    [call] = net.posts
    return sess, call


def _betas(call: dict[str, Any]) -> list[str]:
    return str(call["headers"]["anthropic-beta"]).split(",")


def _identity_free(headers: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v
        for k, v in headers.items()
        if k not in (*_CC_HEADERS, "user-agent", "anthropic-beta")
        and not k.startswith("X-Stainless-")
    }


def _assert_claude_code_identity(sess: Any, call: dict[str, Any]) -> None:
    headers = call["headers"]
    assert headers["user-agent"] == sess.user_agent == llmcore.NativeClaudeSession.native_ua
    assert headers["x-app"] == "cli"
    assert _betas(call)[0] == _CC_BETA
    assert headers["X-Claude-Code-Session-Id"] == sess._session_id
    assert headers["X-Stainless-Lang"] == "js"
    assert headers["Accept"] == "application/json"
    user_id = json.loads(call["payload"]["metadata"]["user_id"])
    assert user_id["session_id"] == sess._session_id


# Passthrough keeps what else it does (the Claude Code system prompt, the
# default thinking and effort); only the identity no longer depends on it.
@pytest.mark.parametrize("cfg", [{}, {"fake_cc_system_prompt": True}, {"claude_compat": "simple"}])
@pytest.mark.parametrize("model", ["claude-test", "claude-test[1m]"])
@pytest.mark.parametrize("apibase", ["https://api.anthropic.com", "https://API.Anthropic.com/v1"])
def test_official_anthropic_api_sends_no_claude_code_identity(
    monkeypatch: pytest.MonkeyPatch, apibase: str, model: str, cfg: dict[str, Any]
) -> None:
    sess, call = _claude_request(monkeypatch, apibase, model=model, **cfg)
    # The same session on a relay: the request as it was before 0032.
    _, relay = _claude_request(monkeypatch, "https://relay.example.test", model=model, **cfg)

    headers = call["headers"]
    # Galley's own user agent, the one Sign in with ChatGPT sends (0007).
    assert headers["user-agent"] == f"Galley ({platform.system()}; {platform.machine()})"
    assert not any(k in headers for k in _CC_HEADERS)
    assert not any(k.startswith("X-Stainless-") for k in headers)
    assert headers["Accept"] == "application/json"
    # Its beta goes; every other beta stays, in order.
    assert _CC_BETA not in _betas(call)
    assert _betas(call) == [b for b in _betas(relay) if b != _CC_BETA]
    if model.endswith("[1m]"):
        assert _betas(call)[0] == "context-1m-2025-08-07"
    assert "metadata" not in call["payload"]
    # Nothing else changes: version, the browser-access header, the
    # x-api-key choice, `?beta=true`, thinking, tools, system prompt,
    # cache_control.
    assert _identity_free(headers) == _identity_free(relay["headers"])
    assert headers["x-api-key"] == sess.api_key
    assert call["url"].endswith("/v1/messages?beta=true")
    assert call["payload"] == {k: v for k, v in relay["payload"].items() if k != "metadata"}


@pytest.mark.parametrize(
    ("apibase", "cfg"),
    [
        # Every other Anthropic-compatible endpoint, passthrough on or off.
        ("https://api.kimi.com/coding", {}),
        ("https://api.kimi.com/coding", {"fake_cc_system_prompt": True}),
        ("https://api.kimi.com/coding", {"claude_compat": "simple"}),
        # Hosts that only look like it, and a base with no scheme (no host).
        ("https://api.anthropic.com.example.net", {}),
        ("https://relay.example/api.anthropic.com", {}),
        ("relay.example/api.anthropic.com", {}),
        ("api.anthropic.com", {}),
    ],
)
def test_claude_code_identity_stays_everywhere_else(
    monkeypatch: pytest.MonkeyPatch, apibase: str, cfg: dict[str, Any]
) -> None:
    sess, call = _claude_request(monkeypatch, apibase, **cfg)

    _assert_claude_code_identity(sess, call)


def test_official_anthropic_api_keeps_a_configured_user_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, call = _claude_request(monkeypatch, "https://api.anthropic.com", user_agent="my-client/1.0")

    headers = call["headers"]
    assert headers["user-agent"] == "my-client/1.0"
    # The rest of the rule still applies.
    assert "x-app" not in headers
    assert _CC_BETA not in _betas(call)
    assert "metadata" not in call["payload"]


# Patch 0033: toward the official OpenAI API (host exactly api.openai.com),
# a request that is not the ChatGPT sign-in's (`codex_backend`) says nothing of
# Codex: no `originator`, no Codex `client_metadata`, Galley's own user agent
# unless one is configured. With those markers the official API refuses an
# organization enrolled in a ChatGPT subscription's monthly API credit
# (400 `codex_byok_restricted_by_api_credit_promo`).

_OAI_OK = _FakeHTTPResponse(200, lines=tuple(_oai_stream({"content": "ok"})))
_GALLEY_UA = f"Galley ({platform.system()}; {platform.machine()})"
_CODEX_METADATA_KEYS = {"x-codex-window-id", "x-codex-installation-id"}


def _oai_request(
    monkeypatch: pytest.MonkeyPatch, apibase: str, api_mode: str, **cfg: Any
) -> tuple[Any, dict[str, Any]]:
    """One request through `NativeOAISession` (what Galley's OpenAI-protocol
    models run on); returns the session and the request it sent."""
    net = _install_network(monkeypatch, _OK_STREAM if api_mode == "responses" else _OAI_OK)
    sess = llmcore.NativeOAISession(
        {
            "name": "t0033",
            "apikey": "sk-test",
            "apibase": apibase,
            "model": "gpt-6.1-sol",
            "api_mode": api_mode,
            "max_retries": 2,
            **cfg,
        }
    )
    _run(sess)
    [call] = net.posts
    return sess, call


def _codex_free(call: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    headers = {k: v for k, v in call["headers"].items() if k not in ("originator", "User-Agent")}
    payload = {k: v for k, v in call["payload"].items() if k != "client_metadata"}
    return headers, payload


@pytest.mark.parametrize("api_mode", ["chat_completions", "responses"])
@pytest.mark.parametrize("apibase", ["https://api.openai.com/v1", "https://API.OpenAI.com/v1"])
def test_official_openai_api_sends_no_codex_identity(
    monkeypatch: pytest.MonkeyPatch, apibase: str, api_mode: str
) -> None:
    _, call = _oai_request(monkeypatch, apibase, api_mode)
    # The same session on a relay: the request as it was before 0033.
    _, relay = _oai_request(monkeypatch, "https://relay.example.test/v1", api_mode)

    headers = call["headers"]
    assert "originator" not in headers
    assert headers["User-Agent"] == _GALLEY_UA
    assert "client_metadata" not in call["payload"]
    if api_mode == "responses":
        assert set(relay["payload"]["client_metadata"]) == _CODEX_METADATA_KEYS
    # Nothing else changes: the auth header, Accept, prompt_cache_key,
    # include, instructions, the Chat body.
    assert _codex_free(call) == _codex_free(relay)
    path = "responses" if api_mode == "responses" else "chat/completions"
    assert call["url"] == f"{apibase}/{path}"


@pytest.mark.parametrize("api_mode", ["chat_completions", "responses"])
@pytest.mark.parametrize(
    "apibase",
    [
        "https://relay.example.test/v1",
        # Hosts that only look like it, and a base with no scheme (no host).
        "https://api.openai.com.example.net/v1",
        "https://relay.example/api.openai.com/v1",
        "api.openai.com/v1",
    ],
)
def test_codex_identity_stays_everywhere_else(
    monkeypatch: pytest.MonkeyPatch, apibase: str, api_mode: str
) -> None:
    sess, call = _oai_request(monkeypatch, apibase, api_mode)

    assert call["headers"]["originator"] == "codex_exec"
    assert call["headers"]["User-Agent"] == sess.user_agent == llmcore.NativeOAISession.native_ua
    if api_mode == "responses":
        assert set(call["payload"]["client_metadata"]) == _CODEX_METADATA_KEYS


def test_official_openai_api_keeps_a_configured_user_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, call = _oai_request(
        monkeypatch, "https://api.openai.com/v1", "responses", user_agent="my-client/1.0"
    )

    assert call["headers"]["User-Agent"] == "my-client/1.0"
    # The rest of the rule still applies.
    assert "originator" not in call["headers"]
    assert "client_metadata" not in call["payload"]


@pytest.mark.parametrize("session_class", ["NativeOAISession", "LLMSession"])
def test_the_chatgpt_sign_in_request_is_left_alone(
    monkeypatch: pytest.MonkeyPatch, session_class: str
) -> None:
    """The ChatGPT sign-in provider talks to api.openai.com too, and 0033
    leaves it out by name: its request there is, URL aside, the one it sends
    to any other host, where 0033 cannot apply, Codex `client_metadata`
    included. Taking it out of the exclusion would drop that metadata here."""

    def request(apibase: str) -> dict[str, Any]:
        net = _install_network(monkeypatch, _OK_STREAM)
        sess = getattr(llmcore, session_class)(
            {
                "name": "chatgpt-test",
                "apikey": _jwt_with_account("acct-123"),
                "apibase": apibase,
                "model": "gpt-5.6-sol",
                "api_mode": "responses",
                "codex_backend": True,
                "max_retries": 2,
            }
        )
        chunks, _ = _run(sess)
        assert chunks == ["ok"]
        [call] = net.posts
        return call

    official = request("https://api.openai.com/v1")
    elsewhere = request("https://relay.example.test/v1")

    assert official["url"] == "https://api.openai.com/v1/responses"
    assert official["headers"] == elsewhere["headers"]
    assert official["payload"] == elsewhere["payload"]
    # What 0007 sends, as before: Galley's UA, no originator, Codex metadata.
    assert official["headers"]["User-Agent"] == _GALLEY_UA
    assert "originator" not in official["headers"]
    assert set(official["payload"]["client_metadata"]) == _CODEX_METADATA_KEYS


# Patch 0034: toward the official Anthropic API (0032's host rule), a thinking
# block goes back only while the request before it (system prompt, tools, every
# earlier block but thinking) is what it was when the block was produced. The
# API ties each block's signature to that prefix and answers 400 ("bound to a
# different conversation") once it changed, which the engine's history
# compression does. A block this session object never produced does not go
# back, and after that 400 none does. Every other host's request is unchanged,
# and the session's history keeps every block.

_OFFICIAL = "https://api.anthropic.com"
_ELSEWHERE = [
    # Every other Anthropic-compatible endpoint.
    "https://relay.example.test",
    "https://api.kimi.com/coding",
    # Hosts that only look like it, and a base with no scheme (no host).
    "https://api.anthropic.com.example.net",
    "https://relay.example/api.anthropic.com",
    "api.anthropic.com",
]
_TEST_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "file_read",
            "description": "Read a file.",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
        },
    }
]
_SIGNED_THINKING: dict[str, Any] = {
    "type": "thinking",
    "thinking": "Read the file before answering.",
    "signature": "sig-test-0034",
}
_TOOL_USE: dict[str, Any] = {
    "type": "tool_use",
    "id": "toolu_test_0034",
    "name": "file_read",
    "input": {"path": "notes.txt"},
}
_REPLY_WITH_TOOL: list[dict[str, Any]] = [
    _SIGNED_THINKING,
    {"type": "text", "text": "Reading it."},
    _TOOL_USE,
]
_THINKING_ONLY_REPLY: list[dict[str, Any]] = [_SIGNED_THINKING]
_BOUND_400 = _FakeHTTPResponse(
    400,
    {
        "type": "error",
        "error": {
            "type": "invalid_request_error",
            "message": "messages.3.content.0: Invalid `signature` in `thinking` block. "
            "The block is bound to a different conversation.",
        },
    },
)


def _signed_reply(sig: str, *, tool: bool = False) -> _FakeHTTPResponse:
    """A streamed reply: a thinking block signed `sig`, a text block and, with
    `tool`, a `file_read` call with id `toolu_<sig>`."""
    events: list[dict[str, Any]] = [
        {"type": "message_start", "message": {"usage": {"input_tokens": 10}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "thinking_delta", "thinking": f"Plan {sig}."},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "signature_delta", "signature": sig},
        },
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "text"}},
        {
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "text_delta", "text": f"Step {sig}."},
        },
        {"type": "content_block_stop", "index": 1},
    ]
    if tool:
        events += [
            {
                "type": "content_block_start",
                "index": 2,
                "content_block": {"type": "tool_use", "id": f"toolu_{sig}", "name": "file_read"},
            },
            {
                "type": "content_block_delta",
                "index": 2,
                "delta": {"type": "input_json_delta", "partial_json": '{"path": "notes.txt"}'},
            },
            {"type": "content_block_stop", "index": 2},
        ]
    events += [
        {
            "type": "message_delta",
            "delta": {"stop_reason": "tool_use" if tool else "end_turn"},
            "usage": {"output_tokens": 5},
        },
        {"type": "message_stop"},
    ]
    return _FakeHTTPResponse(200, lines=tuple(_sse(*events)))


def _thinking_session(
    monkeypatch: pytest.MonkeyPatch, apibase: str, *replies: _FakeHTTPResponse
) -> tuple[Any, _FakeNetwork]:
    """A `NativeClaudeSession` with a system prompt and a tool, whose requests
    get `replies` in order."""
    net = _install_network(monkeypatch, *replies)
    sess = llmcore.NativeClaudeSession(
        {
            "name": "t0034",
            "apikey": "sk-ant-api03-test",
            "apibase": apibase,
            "model": "claude-test",
            "max_retries": 2,
        }
    )
    sess.system = "You are a test assistant."
    sess.tools = copy.deepcopy(_TEST_TOOLS)
    return sess, net


def _send(sess: Any, net: _FakeNetwork, block: dict[str, Any]) -> dict[str, Any]:
    """One user turn through `ask`; returns the request it sent."""
    _collect(sess.ask({"role": "user", "content": [block]}))
    return net.posts[-1]


def _text(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def _sent_thinking(call: dict[str, Any]) -> list[Any]:
    """The signatures of the thinking blocks a request carried, in order."""
    return [
        b.get("signature")
        for m in call["payload"]["messages"]
        for b in m["content"]
        if b.get("type") in ("thinking", "redacted_thinking")
    ]


def _claude_second_turn(
    monkeypatch: pytest.MonkeyPatch, apibase: str, reply: list[dict[str, Any]]
) -> tuple[Any, dict[str, Any]]:
    """The turn after `reply` through `NativeClaudeSession`, `reply` put in its
    history the way `/continue` restores one from the log: the history holds a
    user message and `reply`, the new message answers its tool call (or just
    goes on); returns the session and the request it sent."""
    net = _install_network(monkeypatch, _CLAUDE_OK)
    sess = llmcore.NativeClaudeSession(
        {
            "name": "t0034",
            "apikey": "sk-ant-api03-test",
            "apibase": apibase,
            "model": "claude-test",
            "max_retries": 2,
        }
    )
    sess.history = [
        {"role": "user", "content": [{"type": "text", "text": "What does notes.txt say?"}]},
        {"role": "assistant", "content": copy.deepcopy(reply)},
    ]
    results = [
        {"type": "tool_result", "tool_use_id": b["id"], "content": "Buy milk."}
        for b in reply
        if b["type"] == "tool_use"
    ]
    msg = {"role": "user", "content": results or [{"type": "text", "text": "Go on."}]}
    chunks, _ = _collect(sess.ask(msg))
    assert chunks == ["ok"]
    [call] = net.posts
    return sess, call


def test_official_anthropic_api_sends_still_valid_thinking_back_in_place(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def run(apibase: str) -> tuple[Any, list[dict[str, Any]]]:
        sess, net = _thinking_session(
            monkeypatch,
            apibase,
            _signed_reply("sig-a", tool=True),
            _signed_reply("sig-b", tool=True),
            _signed_reply("sig-c"),
        )
        _send(sess, net, _text("What does notes.txt say?"))
        _send(sess, net, {"type": "tool_result", "tool_use_id": "toolu_sig-a", "content": "x"})
        _send(sess, net, {"type": "tool_result", "tool_use_id": "toolu_sig-b", "content": "y"})
        return sess, net.posts

    sess, posts = run(_OFFICIAL)
    # The same conversation on a relay: the requests as they were before 0034.
    _, relay = run("https://relay.example.test")

    assert [_sent_thinking(p) for p in posts] == [[], ["sig-a"], ["sig-a", "sig-b"]]
    # Each reply goes back as it came: thinking, text, tool call, in order.
    third = posts[2]["payload"]["messages"]
    assert third[1] == sess.history[1] and third[3] == sess.history[3]
    assert [b["type"] for b in third[3]["content"]] == ["thinking", "text", "tool_use"]
    # Nothing in the messages changes while nothing before them did.
    assert [p["payload"]["messages"] for p in posts] == [p["payload"]["messages"] for p in relay]


def test_official_anthropic_api_drops_thinking_produced_after_a_rewritten_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sess, net = _thinking_session(
        monkeypatch, _OFFICIAL, *(_signed_reply(f"sig-{c}") for c in "abcde")
    )
    _send(sess, net, _text("Step one."))
    _send(sess, net, _text("Step two."))
    third = _send(sess, net, _text("Step three."))
    assert _sent_thinking(third) == ["sig-a", "sig-b"]
    # The engine shortens an old message in place (compress_history_tags): here
    # the second user message, which came after A and before B and C.
    sess.history[2]["content"][0]["text"] = "Step [...]."

    fourth = _send(sess, net, _text("Step four."))
    fifth = _send(sess, net, _text("Step five."))

    # A came before the rewrite and still goes back; B and C do not, their
    # replies keep their text.
    assert _sent_thinking(fourth) == ["sig-a"]
    assert fourth["payload"]["messages"][3]["content"] == [_text("Step sig-b.")]
    assert fourth["payload"]["messages"][5]["content"] == [_text("Step sig-c.")]
    # D was produced after the rewrite, on the request as it now is.
    assert _sent_thinking(fifth) == ["sig-a", "sig-d"]


def test_official_anthropic_api_drops_thinking_restored_from_the_log(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, call = _claude_second_turn(monkeypatch, _OFFICIAL, _REPLY_WITH_TOOL)

    assert _sent_thinking(call) == []
    # The reply's other blocks go out as they were, in order.
    assert call["payload"]["messages"][1] == {
        "role": "assistant",
        "content": [_text("Reading it."), _TOOL_USE],
    }


def test_official_anthropic_api_drops_thinking_another_session_produced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    other, other_net = _thinking_session(monkeypatch, _OFFICIAL, _signed_reply("sig-a"))
    _send(other, other_net, _text("Step one."))
    sess, net = _thinking_session(monkeypatch, _OFFICIAL, _signed_reply("sig-b"))
    sess.history = copy.deepcopy(other.history)

    call = _send(sess, net, _text("Step two."))

    assert _sent_thinking(call) == []
    assert call["payload"]["messages"][1]["content"] == [_text("Step sig-a.")]


@pytest.mark.parametrize("change", ["system", "tools"])
def test_official_anthropic_api_drops_all_thinking_once_system_or_tools_change(
    monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    sess, net = _thinking_session(
        monkeypatch, _OFFICIAL, *(_signed_reply(f"sig-{c}") for c in "abc")
    )
    _send(sess, net, _text("Step one."))
    second = _send(sess, net, _text("Step two."))
    assert _sent_thinking(second) == ["sig-a"]
    if change == "system":
        sess.system = "You are a test assistant. Answer briefly."
    else:
        sess.tools = [*_TEST_TOOLS, {**_TEST_TOOLS[0], "function": {"name": "file_write"}}]

    third = _send(sess, net, _text("Step three."))

    assert _sent_thinking(third) == []


def test_official_anthropic_api_sends_an_emptied_reply_as_a_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sess, net = _thinking_session(
        monkeypatch, _OFFICIAL, _signed_reply("sig-b"), _signed_reply("sig-c")
    )
    # A thinking-only reply this session never produced (restored from the log).
    sess.history = [
        {"role": "user", "content": [_text("Step one.")]},
        {"role": "assistant", "content": copy.deepcopy(_THINKING_ONLY_REPLY)},
    ]

    second = _send(sess, net, _text("Step two."))
    third = _send(sess, net, _text("Step three."))

    assert second["payload"]["messages"][1] == {"role": "assistant", "content": [_text("...")]}
    # The placeholder is part of the request B was produced on: B goes back.
    assert _sent_thinking(third) == ["sig-b"]


def test_official_anthropic_api_forgets_every_block_after_the_bound_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sess, net = _thinking_session(
        monkeypatch,
        _OFFICIAL,
        _signed_reply("sig-a"),
        _signed_reply("sig-b"),
        _BOUND_400,
        _signed_reply("sig-d"),
        _signed_reply("sig-e"),
    )
    _send(sess, net, _text("Step one."))
    _send(sess, net, _text("Step two."))
    # By the hash A and B are still valid; the API says otherwise.
    third = _send(sess, net, _text("Step three."))
    assert _sent_thinking(third) == ["sig-a", "sig-b"]

    fourth = _send(sess, net, _text("Step four."))
    fifth = _send(sess, net, _text("Step five."))

    assert _sent_thinking(fourth) == []
    # Blocks produced after it go back as usual.
    assert _sent_thinking(fifth) == ["sig-d"]


@pytest.mark.parametrize(
    "reply", [_REPLY_WITH_TOOL, _THINKING_ONLY_REPLY], ids=["with-tool", "thinking-only"]
)
@pytest.mark.parametrize("apibase", _ELSEWHERE)
def test_thinking_blocks_go_back_everywhere_else(
    monkeypatch: pytest.MonkeyPatch, apibase: str, reply: list[dict[str, Any]]
) -> None:
    _, call = _claude_second_turn(monkeypatch, apibase, reply)

    assert call["payload"]["messages"][1] == {"role": "assistant", "content": reply}
    assert _sent_thinking(call) == ["sig-test-0034"]


@pytest.mark.parametrize("apibase", _ELSEWHERE)
def test_thinking_blocks_go_back_everywhere_else_after_a_rewrite(
    monkeypatch: pytest.MonkeyPatch, apibase: str
) -> None:
    sess, net = _thinking_session(monkeypatch, apibase, *(_signed_reply(f"sig-{c}") for c in "abc"))
    _send(sess, net, _text("Step one."))
    _send(sess, net, _text("Step two."))
    sess.history[2]["content"][0]["text"] = "Step [...]."

    third = _send(sess, net, _text("Step three."))

    assert _sent_thinking(third) == ["sig-a", "sig-b"]


def test_official_anthropic_api_keeps_every_thinking_block_in_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sess, net = _thinking_session(
        monkeypatch, _OFFICIAL, *(_signed_reply(f"sig-{c}") for c in "abc")
    )
    _send(sess, net, _text("Step one."))
    _send(sess, net, _text("Step two."))
    sess.history[2]["content"][0]["text"] = "Step [...]."
    before = copy.deepcopy(sess.history)

    _send(sess, net, _text("Step three."))

    # 0034 filters the copy `ask` and `_fix_messages` make, never
    # `self.history`: what was there is unchanged, B included, and the new
    # reply came in with its block.
    assert sess.history[: len(before)] == before
    assert [
        b["signature"] for m in sess.history for b in m["content"] if b["type"] == "thinking"
    ] == ["sig-a", "sig-b", "sig-c"]
