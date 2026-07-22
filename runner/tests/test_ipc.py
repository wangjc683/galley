"""Schema round-trip and validation tests for runner.ipc."""
from __future__ import annotations

import json

import pytest

from runner.ipc import (
    PROTOCOL_VERSION,
    AbortCommand,
    ApprovalResponseCommand,
    AskUserResponseCommand,
    AttachPetCommand,
    DetachPetCommand,
    ErrorEvent,
    IPCProtocolError,
    LLMChangedEvent,
    LoadHistoryCommand,
    PetAttachedEvent,
    PetDetachedEvent,
    ReadyEvent,
    ReinjectToolsCommand,
    RunCompleteEvent,
    SetApprovalRulesCommand,
    SetLLMCommand,
    SetYoloModeCommand,
    ShutdownCommand,
    ToolCallEndEvent,
    ToolCallPendingEvent,
    ToolCallStartEvent,
    ToolsReinjectedEvent,
    TurnEndEvent,
    TurnProgressEvent,
    TurnStartEvent,
    UserMessageCommand,
    decode_command,
    decode_event,
    encode,
)

# ---------------- Event round-trips ----------------


def test_ready_round_trip() -> None:
    ev = ReadyEvent(
        sessionId="s1",
        protocolVersion=PROTOCOL_VERSION,
        gaCommit="6a3eecc",
        gaCommitDate="2026-04-29T10:00:00+08:00",
        gaPath="/tmp/ga",
        llmName="ClaudeSession/test",
        cwd="/tmp/ga/temp",
        pid=42,
    )
    line = encode(ev)
    payload = json.loads(line)
    assert payload["kind"] == "ready"
    assert payload["sessionId"] == "s1"
    assert payload["protocolVersion"] == "0.1"
    assert payload["availableLLMs"] == []  # default empty
    decoded = decode_event(line)
    assert decoded == ev


def test_ready_round_trip_with_available_llms() -> None:
    ev = ReadyEvent(
        sessionId="s1",
        protocolVersion=PROTOCOL_VERSION,
        gaCommit="6a3eecc",
        gaCommitDate="2026-04-29T10:00:00+08:00",
        gaPath="/tmp/ga",
        llmName="NativeClaudeSession/glm-5.1",
        cwd="/tmp/ga/temp",
        pid=42,
        availableLLMs=[
            {
                "index": 0,
                "name": "NativeClaudeSession/glm-5.1",
                "displayName": "GLM 5.1",
                "isCurrent": True,
            },
            {
                "index": 1,
                "name": "NativeOAISession/gpt-4o",
                "displayName": "GPT 4o",
                "isCurrent": False,
            },
        ],
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert len(decoded.availableLLMs) == 2
    assert decoded.availableLLMs[0]["isCurrent"] is True


def test_llm_changed_round_trip() -> None:
    ev = LLMChangedEvent(
        sessionId="s1",
        index=2,
        name="NativeOAISession/gpt-4o",
        displayName="GPT 4o",
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev


def test_turn_start_round_trip() -> None:
    ev = TurnStartEvent(sessionId="s1", turnIndex=3)
    decoded = decode_event(encode(ev))
    assert decoded == ev


def test_turn_progress_round_trip() -> None:
    ev = TurnProgressEvent(
        sessionId="s1",
        delta="partial output chunk",
        source="workbench",
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.delta == "partial output chunk"


def test_turn_progress_handles_empty_source() -> None:
    """GA can push chunks with `source` defaulting to '' (system /
    interstitial messages); the bridge forwards verbatim."""
    ev = TurnProgressEvent(sessionId="s1", delta="…", source="")
    decoded = decode_event(encode(ev))
    assert decoded == ev


def test_tool_call_pending_round_trip() -> None:
    ev = ToolCallPendingEvent(
        sessionId="s1",
        approvalId="a1",
        turnIndex=1,
        toolName="code_run",
        args={"type": "python", "code": "print(1)"},
        argsPreview="type=python, code=print(1)",
        riskLevel="high",
        reason="Code execution",
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev


def test_tool_call_start_and_end_round_trip() -> None:
    start = ToolCallStartEvent(
        sessionId="s1",
        toolCallId="tc1",
        turnIndex=1,
        toolName="file_read",
        args={"path": "x"},
        argsPreview="path=x",
    )
    end = ToolCallEndEvent(
        sessionId="s1",
        toolCallId="tc1",
        status="success",
        resultPreview="ok",
        elapsedMs=42,
    )
    assert decode_event(encode(start)) == start
    assert decode_event(encode(end)) == end


def test_turn_end_round_trip_no_exit_reason() -> None:
    ev = TurnEndEvent(
        sessionId="s1",
        turnIndex=2,
        summary="完成读取",
        toolCalls=[{"toolName": "file_read", "args": {"path": "x"}}],
        toolResults=[{"toolUseId": "tc1", "content": "..."}],
        responseContent="<summary>完成读取</summary>",
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.exitReason is None


def test_turn_end_round_trip_with_exit_reason() -> None:
    ev = TurnEndEvent(
        sessionId="s1",
        turnIndex=5,
        summary="done",
        toolCalls=[],
        toolResults=[],
        responseContent="...",
        exitReason={"result": "CURRENT_TASK_DONE", "data": None},
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.exitReason == {"result": "CURRENT_TASK_DONE", "data": None}


def test_turn_end_round_trip_with_telemetry() -> None:
    ev = TurnEndEvent(
        sessionId="s1",
        turnIndex=5,
        summary="done",
        toolCalls=[],
        toolResults=[],
        responseContent="...",
        exitReason={"result": "CURRENT_TASK_DONE", "data": None},
        telemetry={
            "elapsedMs": 135000,
            "inputTokens": 18400,
            "outputTokens": 1200,
            "cacheCreateTokens": 0,
            "cacheReadTokens": 0,
            "requestCount": 3,
            "contextUsedChars": 126000,
            "contextLimitChars": 300000,
        },
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.telemetry == {
        "elapsedMs": 135000,
        "inputTokens": 18400,
        "outputTokens": 1200,
        "cacheCreateTokens": 0,
        "cacheReadTokens": 0,
        "requestCount": 3,
        "contextUsedChars": 126000,
        "contextLimitChars": 300000,
    }


def test_run_complete_round_trip() -> None:
    ev = RunCompleteEvent(
        sessionId="s1",
        exitReason={"result": "CURRENT_TASK_DONE", "data": None},
        finalContent="最终回答",
        totalTurns=3,
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev


def test_error_event_default_fields() -> None:
    """Bridge call sites that only pass message + traceback get bridge-class
    error with the expected defaults."""
    ev = ErrorEvent(sessionId="s1", message="something went wrong")
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.category == "bridge"
    assert decoded.severity == "error"
    assert decoded.retryable is False
    assert decoded.hint is None


def test_error_event_runtime_with_hint() -> None:
    """Runtime errors with hints get full triage payload across the wire."""
    ev = ErrorEvent(
        sessionId="s1",
        message="Authentication failed: invalid api_key",
        category="runtime",
        severity="error",
        retryable=True,
        hint="check_llm_config",
        context="user_message",
        traceback="Traceback (most recent call last):\n...",
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.hint == "check_llm_config"
    assert decoded.retryable is True


def test_error_event_business_warning() -> None:
    """Business errors (user input issues) render as warning toasts."""
    ev = ErrorEvent(
        sessionId="s1",
        message="Cannot switch LLM while a run is in progress",
        category="business",
        severity="warning",
        context="set_llm",
    )
    decoded = decode_event(encode(ev))
    assert decoded == ev
    assert decoded.category == "business"
    assert decoded.severity == "warning"


def test_unicode_preserved() -> None:
    """Chinese / emoji should survive round trip without escapes."""
    ev = TurnEndEvent(
        sessionId="s1",
        turnIndex=1,
        summary="🎯 完成",
        toolCalls=[],
        toolResults=[],
        responseContent="测试内容",
    )
    line = encode(ev)
    assert "🎯" in line  # ensure_ascii=False keeps unicode literal
    assert "完成" in line
    assert decode_event(line) == ev


# ---------------- Command round-trips ----------------


def test_user_message_round_trip() -> None:
    cmd = UserMessageCommand(text="hello", images=["/tmp/a.png"])
    decoded = decode_command(encode(cmd))
    assert decoded == cmd


def test_user_message_default_images() -> None:
    cmd = UserMessageCommand(text="hello")
    assert cmd.images == []
    decoded = decode_command(encode(cmd))
    assert decoded == cmd


def test_approval_response_round_trip() -> None:
    for decision in ("allow_once", "deny", "always_allow_project", "always_allow_global"):
        cmd = ApprovalResponseCommand(approvalId="a1", decision=decision)
        decoded = decode_command(encode(cmd))
        assert decoded == cmd


def test_ask_user_response_round_trip() -> None:
    cmd = AskUserResponseCommand(text="yes", absoluteTurnIndex=3)
    assert decode_command(encode(cmd)) == cmd


def test_abort_round_trip() -> None:
    cmd = AbortCommand()
    decoded = decode_command(encode(cmd))
    assert decoded == cmd


def test_shutdown_round_trip() -> None:
    cmd = ShutdownCommand()
    assert decode_command(encode(cmd)) == cmd


def test_load_history_round_trip() -> None:
    cmd = LoadHistoryCommand(
        messages=[
            {"role": "user", "content": "hi", "toolCalls": [], "toolResults": []},
            {"role": "assistant", "content": "hello", "toolCalls": [], "toolResults": []},
        ]
    )
    decoded = decode_command(encode(cmd))
    assert decoded == cmd


def test_set_approval_rules_round_trip() -> None:
    cmd = SetApprovalRulesCommand(
        alwaysAllowGlobal=["file_patch"],
        alwaysAllowProject=["code_run", "file_write"],
    )
    decoded = decode_command(encode(cmd))
    assert decoded == cmd


def test_set_llm_round_trip() -> None:
    cmd = SetLLMCommand(llmIndex=2)
    decoded = decode_command(encode(cmd))
    assert decoded == cmd
    assert decoded.llmIndex == 2


def test_set_yolo_mode_round_trip_enabled() -> None:
    cmd = SetYoloModeCommand(enabled=True)
    decoded = decode_command(encode(cmd))
    assert decoded == cmd
    assert decoded.enabled is True


def test_set_yolo_mode_round_trip_disabled() -> None:
    cmd = SetYoloModeCommand(enabled=False)
    decoded = decode_command(encode(cmd))
    assert decoded == cmd
    assert decoded.enabled is False


# ---------------- Error paths ----------------


def test_decode_unknown_kind() -> None:
    with pytest.raises(IPCProtocolError, match="Unknown event kind"):
        decode_event('{"kind": "not_a_thing", "sessionId": "s"}')


def test_decode_missing_kind() -> None:
    with pytest.raises(IPCProtocolError, match="missing 'kind'"):
        decode_event('{"sessionId": "s"}')


def test_decode_kind_not_string() -> None:
    with pytest.raises(IPCProtocolError, match="missing 'kind'"):
        decode_event('{"kind": 42}')


def test_decode_invalid_json() -> None:
    with pytest.raises(IPCProtocolError, match="Invalid JSON"):
        decode_event("not json")


def test_decode_command_repairs_unescaped_quoted_windows_path() -> None:
    line = (
        r'{"kind":"user_message","text":"学习一下这个sop, '
        r'"D:\GenericAgent\memory\sophub.md"","images":[]}'
    )

    decoded = decode_command(line)

    assert isinstance(decoded, UserMessageCommand)
    assert decoded.text == r'学习一下这个sop, "D:\GenericAgent\memory\sophub.md"'
    assert decoded.images == []


def test_decode_command_repairs_unescaped_quotes_with_images() -> None:
    line = r'{"kind":"user_message","text":"看 "D:\a\b.md"","images":["C:\\shot.png"]}'

    decoded = decode_command(line)

    assert isinstance(decoded, UserMessageCommand)
    assert decoded.text == r'看 "D:\a\b.md"'
    assert decoded.images == [r"C:\shot.png"]


def test_decode_command_repairs_legacy_line_with_absolute_turn_index() -> None:
    line = (
        r'{"kind":"user_message","text":"看 "D:\a\b.md"",'
        r'"images":["C:\\shot.png"],"absoluteTurnIndex":7}'
    )

    decoded = decode_command(line)

    assert isinstance(decoded, UserMessageCommand)
    assert decoded.text == r'看 "D:\a\b.md"'
    assert decoded.images == [r"C:\shot.png"]
    assert decoded.absoluteTurnIndex == 7


def test_decode_empty_line() -> None:
    with pytest.raises(IPCProtocolError, match="Empty"):
        decode_event("")
    with pytest.raises(IPCProtocolError, match="Empty"):
        decode_event("   \n")


def test_decode_non_object_payload() -> None:
    with pytest.raises(IPCProtocolError, match="must be a JSON object"):
        decode_event("[1, 2, 3]")


def test_decode_missing_required_field() -> None:
    # ReadyEvent requires many fields; provide only kind + sessionId
    with pytest.raises(IPCProtocolError, match="Invalid event 'ready'"):
        decode_event('{"kind": "ready", "sessionId": "s"}')


def test_decode_unexpected_field() -> None:
    # Adding a field unknown to the dataclass should fail.
    with pytest.raises(IPCProtocolError, match="Invalid command 'abort'"):
        decode_command('{"kind": "abort", "rogue": 1}')


def test_event_decoder_rejects_command() -> None:
    line = encode(UserMessageCommand(text="x"))
    with pytest.raises(IPCProtocolError, match="Unknown event kind: 'user_message'"):
        decode_event(line)


def test_command_decoder_rejects_event() -> None:
    line = encode(TurnStartEvent(sessionId="s", turnIndex=1))
    with pytest.raises(IPCProtocolError, match="Unknown command kind: 'turn_start'"):
        decode_command(line)


def test_encode_rejects_non_dataclass() -> None:
    with pytest.raises(IPCProtocolError, match="Not a dataclass"):
        encode({"kind": "ready"})


# ---------------- Constants ----------------


def test_protocol_version_constant() -> None:
    assert PROTOCOL_VERSION == "0.1"


# ---------------- V0.2 additions (Reinject Tools / Desktop Pet) ----------------


def test_reinject_tools_command_round_trip() -> None:
    cmd = ReinjectToolsCommand()
    decoded = decode_command(encode(cmd))
    assert decoded == cmd
    assert decoded.kind == "reinject_tools"


def test_tools_reinjected_event_round_trip() -> None:
    ev = ToolsReinjectedEvent(sessionId="s1", blocksAdded=12)
    decoded = decode_event(encode(ev))
    assert isinstance(decoded, ToolsReinjectedEvent)
    assert decoded.sessionId == "s1"
    assert decoded.blocksAdded == 12
    assert decoded.kind == "tools_reinjected"


def test_attach_pet_command_round_trip_default_port() -> None:
    cmd = AttachPetCommand()
    decoded = decode_command(encode(cmd))
    assert isinstance(decoded, AttachPetCommand)
    assert decoded == cmd
    assert decoded.port == 41983


def test_attach_pet_command_round_trip_custom_port() -> None:
    cmd = AttachPetCommand(port=51234)
    decoded = decode_command(encode(cmd))
    assert isinstance(decoded, AttachPetCommand)
    assert decoded.port == 51234


def test_detach_pet_command_round_trip() -> None:
    cmd = DetachPetCommand()
    decoded = decode_command(encode(cmd))
    assert decoded == cmd
    assert decoded.kind == "detach_pet"


def test_pet_attached_event_round_trip() -> None:
    ev = PetAttachedEvent(sessionId="s1", port=41983)
    decoded = decode_event(encode(ev))
    assert isinstance(decoded, PetAttachedEvent)
    assert decoded.sessionId == "s1"
    assert decoded.port == 41983
    assert decoded.kind == "pet_attached"


def test_pet_detached_event_round_trip() -> None:
    ev = PetDetachedEvent(sessionId="s1")
    decoded = decode_event(encode(ev))
    assert decoded.sessionId == "s1"
    assert decoded.kind == "pet_detached"
