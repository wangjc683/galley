from __future__ import annotations

import importlib.util
import os
import sys
import types
from pathlib import Path
from typing import Any


def _install_fsapp_stubs(monkeypatch: Any) -> None:
    class WsClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            self._conn: object | None = None
            self._auto_reconnect = False

        async def _connect(self) -> None:
            self._conn = object()

        async def _reconnect(self) -> None:
            self._conn = object()

        async def _try_connect(self, _cnt: int) -> bool:
            return True

    lark = types.ModuleType("lark_oapi")
    lark.ws = types.SimpleNamespace(Client=WsClient)  # type: ignore[attr-defined]
    lark.LogLevel = types.SimpleNamespace(INFO="INFO")  # type: ignore[attr-defined]
    lark.EventDispatcherHandler = types.SimpleNamespace()  # type: ignore[attr-defined]
    lark.Client = types.SimpleNamespace()  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "lark_oapi", lark)
    monkeypatch.setitem(sys.modules, "lark_oapi.api", types.ModuleType("lark_oapi.api"))
    monkeypatch.setitem(sys.modules, "lark_oapi.api.im", types.ModuleType("lark_oapi.api.im"))
    monkeypatch.setitem(
        sys.modules,
        "lark_oapi.api.im.v1",
        types.ModuleType("lark_oapi.api.im.v1"),
    )

    agentmain = types.ModuleType("agentmain")

    class GeneraticAgent:
        def run(self) -> None:
            pass

    agentmain.GeneraticAgent = GeneraticAgent  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agentmain", agentmain)

    frontends = types.ModuleType("frontends")
    frontends.__path__ = []
    chatapp_common = types.ModuleType("frontends.chatapp_common")

    class AgentChatMixin:
        pass

    chatapp_common.AgentChatMixin = AgentChatMixin  # type: ignore[attr-defined]
    chatapp_common.FILE_HINT = "file hint"  # type: ignore[attr-defined]
    chatapp_common.split_text = lambda text, _limit: [text]  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "frontends", frontends)
    monkeypatch.setitem(sys.modules, "frontends.chatapp_common", chatapp_common)


def _load_managed_fsapp(monkeypatch: Any, tmp_path: Path) -> Any:
    _install_fsapp_stubs(monkeypatch)
    monkeypatch.setenv("GA_WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("GALLEY_FEISHU_TEMP_DIR", str(tmp_path / "feishu-temp"))
    path = (
        Path(__file__).resolve().parents[2]
        / "managed-ga"
        / "code"
        / "frontends"
        / "fsapp.py"
    )
    spec = importlib.util.spec_from_file_location("_galley_test_fsapp", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["_galley_test_fsapp"] = module
    old_dont_write_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = old_dont_write_bytecode
    return module


def test_make_task_hook_adds_final_turn_panel_without_fabricated_thinking(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    cwd = os.getcwd()
    try:
        fsapp = _load_managed_fsapp(monkeypatch, tmp_path)
    finally:
        os.chdir(cwd)

    class Card:
        def __init__(self) -> None:
            self.steps: list[tuple[str, str]] = []

        def step(self, summary: str, detail: str) -> None:
            self.steps.append((summary, detail))

    class Parent:
        _fs_active_task_id = "task-1"

    class HookSelf:
        parent = Parent()

    class Response:
        content = "<summary>answered briefly</summary>Final answer body"

    finals: list[str] = []
    card = Card()
    hook = fsapp._make_task_hook(card, "task-1", finals.append)

    hook(
        {
            "self": HookSelf(),
            "exit_reason": "done",
            "summary": "answered briefly",
            "response": Response(),
            "tool_calls": [{"tool_name": "lookup", "args": {"q": "x", "_private": "hidden"}}],
        }
    )

    assert finals == ["<summary>answered briefly</summary>Final answer body"]
    assert len(card.steps) == 1
    summary, detail = card.steps[0]
    assert summary == "answered briefly"
    assert "Thinking" not in detail
    assert "Tool Calls" in detail
    assert "`lookup`" in detail
    assert "_private" not in detail
    assert "Output" in detail
    assert "Final answer body" in detail


def test_make_task_hook_ignores_turns_during_galley_report_window(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """While the reporter drains its synthetic turn, a user task registered
    in the same window must not stream the report's steps into its card."""
    cwd = os.getcwd()
    try:
        fsapp = _load_managed_fsapp(monkeypatch, tmp_path)
    finally:
        os.chdir(cwd)

    class Card:
        def __init__(self) -> None:
            self.steps: list[tuple[str, str]] = []

        def step(self, summary: str, detail: str) -> None:
            self.steps.append((summary, detail))

    class Parent:
        _fs_active_task_id = "task-1"

    class HookSelf:
        parent = Parent()

    class Response:
        content = "report body"

    finals: list[str] = []
    card = Card()
    hook = fsapp._make_task_hook(card, "task-1", finals.append)

    ctx = {
        "self": HookSelf(),
        "exit_reason": "done",
        "summary": "report turn",
        "response": Response(),
        "tool_calls": [],
    }
    fsapp._GALLEY_REPORT_TURN_ACTIVE = True
    try:
        hook(ctx)
    finally:
        fsapp._GALLEY_REPORT_TURN_ACTIVE = False
    assert card.steps == []
    assert finals == []

    hook(ctx)
    assert len(card.steps) == 1
    assert finals == ["report body"]


# ---------------- Owner binding (patch 0011) ----------------


def _load_locked_fsapp(
    monkeypatch: Any,
    tmp_path: Path,
    *,
    bind_code: str | None = "123456",
    allowed: list[str] | None = None,
) -> Any:
    import json

    config: dict[str, Any] = {
        "fs_app_id": "cli_test",
        "fs_app_secret": "secret",
        "fs_allowed_users": allowed or [],
    }
    if bind_code is not None:
        config["fs_owner_bind_code"] = bind_code
    monkeypatch.setenv("GALLEY_FEISHU_CONFIG_JSON", json.dumps(config))
    cwd = os.getcwd()
    try:
        return _load_managed_fsapp(monkeypatch, tmp_path)
    finally:
        os.chdir(cwd)


def _text_message(text: str, chat_type: str = "p2p", message_type: str = "text") -> Any:
    import json

    return types.SimpleNamespace(
        chat_type=chat_type,
        message_type=message_type,
        content=json.dumps({"text": text}),
    )


def test_managed_empty_allowlist_is_locked_not_public(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """With Galley-injected config, an empty allow-list must mean
    "locked awaiting pairing" — the old PUBLIC_ACCESS reading let anyone
    in the Feishu org drive the local agent."""
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    assert fsapp.PUBLIC_ACCESS is False
    assert fsapp.ALLOWED_USERS == set()
    assert fsapp.OWNER_BIND_CODE == "123456"


def test_owner_binding_accepts_code_only_from_p2p_text(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    sent: list[Any] = []
    statuses: list[tuple[str, Any, dict[str, Any]]] = []
    monkeypatch.setattr(fsapp, "send_message", lambda *a, **k: sent.append((a, k)))
    fsapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: statuses.append(
        (state, last_error, extra)
    )

    # Correct code from a GROUP chat must not bind (a bot pulled into a
    # group could otherwise be claimed by anyone who saw the code).
    fsapp._handle_owner_bind_message(
        _text_message("123456", chat_type="group"), "ou_group_member"
    )
    assert fsapp.ALLOWED_USERS == set()

    # Wrong code: silent — no reply that would help a guesser.
    fsapp._handle_owner_bind_message(_text_message("000000"), "ou_guesser")
    assert fsapp.ALLOWED_USERS == set()
    assert sent == []

    # Correct code via p2p text binds the sender and invalidates the code.
    fsapp._handle_owner_bind_message(_text_message("123456"), "ou_owner")
    assert fsapp.ALLOWED_USERS == {"ou_owner"}
    assert fsapp.OWNER_BIND_CODE is None
    assert any(extra.get("ownerOpenId") == "ou_owner" for _, _, extra in statuses)
    assert len(sent) == 1  # confirmation reply to the owner


def test_owner_bind_code_invalidated_after_too_many_wrong_attempts(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    monkeypatch.setattr(fsapp, "send_message", lambda *a, **k: None)
    statuses: list[tuple[str, Any]] = []
    fsapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: statuses.append(
        (state, last_error)
    )

    for _ in range(fsapp.GALLEY_OWNER_BIND_ATTEMPT_LIMIT):
        fsapp._handle_owner_bind_message(_text_message("999999"), "ou_bruteforce")
    assert fsapp.OWNER_BIND_CODE is None
    assert any("invalidated" in str(err) for _, err in statuses)

    # Even the correct code no longer binds once invalidated.
    fsapp._handle_owner_bind_message(_text_message("123456"), "ou_bruteforce")
    assert fsapp.ALLOWED_USERS == set()


def test_bound_owner_config_keeps_allowlist_semantics(
    monkeypatch: Any, tmp_path: Path
) -> None:
    fsapp = _load_locked_fsapp(
        monkeypatch, tmp_path, bind_code=None, allowed=["ou_owner"]
    )
    assert fsapp.PUBLIC_ACCESS is False
    assert fsapp.ALLOWED_USERS == {"ou_owner"}
    assert fsapp.OWNER_BIND_CODE is None


# ---------------- FILE-marker echo guard (patch 0012) ----------------


def test_send_generated_files_skips_prompt_echo_placeholders(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """FILE_HINT's literal `[FILE:filepath]` example gets echoed by
    models; the sender must not message the user "文件不存在: filepath"
    for placeholders or bare words, while real paths still go through
    (existing → sent, missing → warned by _send_local_file)."""
    fsapp = _load_locked_fsapp(monkeypatch, tmp_path)
    forwarded: list[str] = []
    monkeypatch.setattr(
        fsapp,
        "_send_local_file",
        lambda _rid, path, _rt="open_id": forwarded.append(path),
    )

    fsapp._send_generated_files(
        "rid",
        "reply [FILE:filepath] [FILE:<path>] [FILE:...] [FILE:bareword]",
    )
    assert forwarded == []

    real = tmp_path / "deliverable.txt"
    real.write_text("x", encoding="utf-8")
    fsapp._send_generated_files(
        "rid",
        f"done [FILE:{real}] and [FILE:/definitely/missing/report.pdf] and [FILE:{real}]",
    )
    # Existing file forwarded once (deduped); missing-but-path-like
    # forwarded too so _send_local_file can warn the user about it.
    assert forwarded == [str(real), "/definitely/missing/report.pdf"]
