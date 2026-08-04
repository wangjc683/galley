"""Galley IPC Protocol v0.1 implementation.

Source of truth for the wire format is `docs/ipc-protocol.md`. Keep them in sync;
change the doc first, then the dataclasses here.

Field names are camelCase to match the JSON wire format directly. This makes
serialization a trivial `dataclasses.asdict` call without any name remapping.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
from typing import Any, cast

PROTOCOL_VERSION = "0.1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------- Events (bridge -> workbench) ----------------


@dataclass
class ReadyEvent:
    sessionId: str
    protocolVersion: str
    gaCommit: str
    # ISO 8601 commit date from `git log -1 --format=%cI`. `"unknown"`
    # when ga_path isn't a git checkout (tarball/zip install). Pairs
    # with gaCommit for Settings → Runtime "GA 版本" row.
    gaCommitDate: str
    gaPath: str
    llmName: str
    cwd: str
    pid: int
    availableLLMs: list[dict[str, Any]] = field(default_factory=list)
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "ready"


@dataclass
class TurnStartEvent:
    """Structural step marker for the active agent loop.

    The bridge emits turn 1 proactively when a user task starts, then
    dedupes any later GA-observed signal for the same turn. Later turns
    are predicted from turn_end until GA's dispatch hook confirms them.
    """

    sessionId: str
    turnIndex: int
    visibility: str = "visible"
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "turn_start"


@dataclass
class ToolCallPendingEvent:
    sessionId: str
    approvalId: str
    turnIndex: int
    toolName: str
    args: dict[str, Any]
    argsPreview: str
    riskLevel: str  # "low" | "medium" | "high"
    reason: str
    absoluteTurnIndex: int | None = None
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "tool_call_pending"


@dataclass
class ToolCallStartEvent:
    sessionId: str
    toolCallId: str
    turnIndex: int
    toolName: str
    args: dict[str, Any]
    argsPreview: str
    absoluteTurnIndex: int | None = None
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "tool_call_start"


@dataclass
class ToolCallEndEvent:
    sessionId: str
    toolCallId: str
    status: str  # "success" | "failed" | "denied" | "cancelled"
    resultPreview: str
    elapsedMs: int
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "tool_call_end"


@dataclass
class ToolCallProgressEvent:
    sessionId: str
    toolCallId: str
    text: str
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "tool_call_progress"


@dataclass
class TurnEndEvent:
    sessionId: str
    turnIndex: int
    summary: str
    toolCalls: list[dict[str, Any]]
    toolResults: list[dict[str, Any]]
    responseContent: str
    exitReason: dict[str, Any] | None = None
    telemetry: dict[str, int | None] | None = None
    visibility: str = "visible"
    absoluteTurnIndex: int | None = None
    # User-voice next-step suggestion extracted from the final answer's
    # <next-suggestion> tag (managed runtime prompt profile). Only ever
    # non-None on the final turn_end (exitReason != None); None when the
    # model emitted no tag — the desktop then simply shows no ghost text.
    nextSuggestion: str | None = None
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "turn_end"


@dataclass
class TurnProgressEvent:
    """Streaming partial response from the LLM mid-turn (PRD §13.2,
    DESIGN.md §4.3 streaming generation).

    Bridge subscribes to GA's `display_queue` (the same queue
    `agentmain.put_task` returns and fsapp.py drains) and forwards
    each partial chunk over IPC. `delta` is the new substring since
    the last progress event — desktop accumulates these into
    `inFlightContent` and renders mid-turn so users see the LLM's
    output appearing live rather than after the full turn settles.

    `delta` is GA-raw — still contains <thinking>/<summary>/
    <tool_use>/<file_content> tags. Desktop strips them at render
    time (with robust handling of unclosed tags at the partial's
    tail).
    """

    sessionId: str
    delta: str
    source: str  # GA's source field: "workbench" / "system" / etc
    visibility: str = "visible"
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "turn_progress"


@dataclass
class AskUserEvent:
    sessionId: str
    question: str
    candidates: list[str]
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "ask_user"


@dataclass
class RunCompleteEvent:
    sessionId: str
    exitReason: dict[str, Any]
    finalContent: str
    totalTurns: int
    visibility: str = "visible"
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "run_complete"


@dataclass
class ErrorEvent:
    sessionId: str
    message: str
    # Structured triage fields — see docs/ipc-protocol.md §4.10.
    # All have defaults so existing call sites stay valid; bridge classifies
    # known errors before emitting and desktop renders accordingly.
    category: str = "bridge"  # "bridge" | "runtime" | "business"
    severity: str = "error"  # "error" | "warning" | "info"
    retryable: bool = False
    hint: str | None = None  # "check_llm_config" | "network" | "quota_exceeded" | None
    context: str | None = None
    traceback: str | None = None
    visibility: str = "visible"
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "error"


@dataclass
class HistoryLoadedEvent:
    sessionId: str
    messageCount: int
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "history_loaded"


@dataclass
class LLMChangedEvent:
    sessionId: str
    index: int
    name: str
    displayName: str
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "llm_changed"


@dataclass
class ToolsReinjectedEvent:
    """Bridge confirmation that a `reinject_tools` command succeeded.

    Mirrors GA's stapp.py 'Reinject Tools' button behavior — re-reads
    GA's `assets/tool_usable_history.json` and appends those tool
    definition blocks back into `agent.llmclient.backend.history`, so
    an LLM whose tool understanding drifted in a long session gets a
    fresh reminder of what's available. Bridge emits this event on
    success; failures use the standard `error` event.
    """

    sessionId: str
    blocksAdded: int
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "tools_reinjected"


@dataclass
class PetAttachedEvent:
    """Bridge confirmation that the Desktop Pet subprocess has been
    spawned and the per-turn hook is registered on this session's
    agent. Desktop uses this to flip the menu item's "running" state.
    """

    sessionId: str
    port: int
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "pet_attached"


@dataclass
class PetDetachedEvent:
    """Bridge confirmation that the Desktop Pet subprocess has been
    terminated and the per-turn hook removed.
    """

    sessionId: str
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "pet_detached"


@dataclass
class TitleGeneratedEvent:
    """Result of a `generate_title` command: a short LLM-generated
    session title. Emitted at most once per command; failures are
    silent (stderr log only) — Galley Core retries by sending a fresh
    command at the next run_complete while the session stays eligible.
    """

    sessionId: str
    title: str
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "title_generated"


@dataclass
class SystemMessageEvent:
    """A standalone, non-agent-loop message emitted into the
    conversation. Used by GA's slash-command paths (`/btw`,
    `/session.x=v`, etc.) where the response bypasses
    agent_runner_loop and goes straight to `display_queue` with
    `source='system'`. The bridge translates that signal into this
    event so desktop can render the content inline.

    `content` is markdown source; desktop renders through the same
    pipeline as agent final answers.

    `kind` discriminates rendering (yellow side-question callout vs
    a more neutral confirmation pill, etc.) — initial values:
      - "side_question" : `/btw` reply
      - "system"        : generic catch-all (default)
    """

    sessionId: str
    content: str
    variant: str = "system"
    timestamp: str = field(default_factory=_now_iso)
    kind: str = "system_message"


Event = (
    ReadyEvent
    | TurnStartEvent
    | ToolCallPendingEvent
    | ToolCallStartEvent
    | ToolCallEndEvent
    | ToolCallProgressEvent
    | TurnEndEvent
    | TurnProgressEvent
    | AskUserEvent
    | RunCompleteEvent
    | ErrorEvent
    | HistoryLoadedEvent
    | LLMChangedEvent
    | ToolsReinjectedEvent
    | PetAttachedEvent
    | PetDetachedEvent
    | TitleGeneratedEvent
    | SystemMessageEvent
)


# ---------------- Commands (workbench -> bridge) ----------------


@dataclass
class UserMessageCommand:
    text: str
    images: list[str] = field(default_factory=list)
    visibility: str = "visible"
    absoluteTurnIndex: int | None = None
    kind: str = "user_message"


@dataclass
class ApprovalResponseCommand:
    approvalId: str
    decision: str  # "allow_once" | "deny" | "always_allow_project" | "always_allow_global"
    kind: str = "approval_response"


@dataclass
class AskUserResponseCommand:
    text: str
    absoluteTurnIndex: int | None = None
    kind: str = "ask_user_response"


@dataclass
class AbortCommand:
    kind: str = "abort"


@dataclass
class LoadHistoryCommand:
    messages: list[dict[str, Any]]
    kind: str = "load_history"


@dataclass
class SetApprovalRulesCommand:
    alwaysAllowGlobal: list[str] = field(default_factory=list)
    alwaysAllowProject: list[str] = field(default_factory=list)
    kind: str = "set_approval_rules"


@dataclass
class SetYoloModeCommand:
    """Toggle 自动执行 (auto-execute) mode. `yolo` survives only as
    the stable wire identifier — user-facing naming has been
    自动执行 / 逐步审批 since 2026-07-20, scoped per session with an
    app-level default (desktop control: the composer LLM pill's
    popover; no TopBar indicator).

    When enabled, every dispatched tool call bypasses the approval
    gate — no `tool_call_pending` is emitted; the tool runs as if
    every approval were `allow_once`.
    """

    enabled: bool
    kind: str = "set_yolo_mode"


@dataclass
class SetLLMCommand:
    llmIndex: int
    kind: str = "set_llm"


@dataclass
class ShutdownCommand:
    kind: str = "shutdown"


@dataclass
class ReinjectToolsCommand:
    """Re-inject GA's tool definitions into the LLM history of this
    session. Useful when an agent's long-running context has caused
    its tool understanding to drift. Reads from GA's
    `assets/tool_usable_history.json` (read-only — see AGENTS.md
    constitution §"关于读取" — direct read of GA internal asset is
    allowed because read-only, but path is a coupling point that must
    be re-audited at GA baseline upgrades).
    """

    kind: str = "reinject_tools"


@dataclass
class AttachPetCommand:
    """Spawn GA's `desktop_pet_v2.pyw` subprocess and register a per-
    turn hook on this session's agent to push progress updates to
    the pet's local HTTP listener. The pet is global (only one
    instance can run at a time since the pyw binds a fixed port).
    """

    port: int = 41983
    kind: str = "attach_pet"


@dataclass
class DetachPetCommand:
    """Terminate the desktop pet subprocess (if running) and remove
    the per-turn hook from this session's agent.
    """

    kind: str = "detach_pet"


@dataclass
class GenerateTitleCommand:
    """Ask the bridge for a short LLM-generated session title.

    Sent by Galley Core's auto-title watcher after a run completes while
    the session still wears a seed/derived title. The context arrives in
    the command (Core owns the message store) so the bridge never reads
    backend.history for this — it fires one small out-of-band
    `backend.raw_ask` with a self-built prompt. Works identically in
    attach and managed mode.
    """

    firstUserMessage: str
    finalAnswer: str = ""
    kind: str = "generate_title"


Command = (
    UserMessageCommand
    | ApprovalResponseCommand
    | AskUserResponseCommand
    | AbortCommand
    | LoadHistoryCommand
    | SetApprovalRulesCommand
    | SetYoloModeCommand
    | SetLLMCommand
    | ShutdownCommand
    | ReinjectToolsCommand
    | AttachPetCommand
    | DetachPetCommand
    | GenerateTitleCommand
)


# ---------------- Serialization ----------------


EVENT_KINDS: dict[str, type] = {
    "ready": ReadyEvent,
    "turn_start": TurnStartEvent,
    "tool_call_pending": ToolCallPendingEvent,
    "tool_call_start": ToolCallStartEvent,
    "tool_call_end": ToolCallEndEvent,
    "tool_call_progress": ToolCallProgressEvent,
    "turn_end": TurnEndEvent,
    "turn_progress": TurnProgressEvent,
    "ask_user": AskUserEvent,
    "run_complete": RunCompleteEvent,
    "error": ErrorEvent,
    "history_loaded": HistoryLoadedEvent,
    "llm_changed": LLMChangedEvent,
    "tools_reinjected": ToolsReinjectedEvent,
    "pet_attached": PetAttachedEvent,
    "pet_detached": PetDetachedEvent,
    "title_generated": TitleGeneratedEvent,
    "system_message": SystemMessageEvent,
}

COMMAND_KINDS: dict[str, type] = {
    "user_message": UserMessageCommand,
    "approval_response": ApprovalResponseCommand,
    "ask_user_response": AskUserResponseCommand,
    "abort": AbortCommand,
    "load_history": LoadHistoryCommand,
    "set_approval_rules": SetApprovalRulesCommand,
    "set_yolo_mode": SetYoloModeCommand,
    "set_llm": SetLLMCommand,
    "shutdown": ShutdownCommand,
    "reinject_tools": ReinjectToolsCommand,
    "attach_pet": AttachPetCommand,
    "detach_pet": DetachPetCommand,
    "generate_title": GenerateTitleCommand,
}


class IPCProtocolError(Exception):
    """Raised when an IPC message fails to parse or validate."""


def encode(msg: Any) -> str:
    """Serialize a dataclass event/command to a single JSON line (no trailing newline)."""
    if not is_dataclass(msg) or isinstance(msg, type):
        raise IPCProtocolError(f"Not a dataclass instance: {type(msg).__name__}")
    return json.dumps(asdict(msg), ensure_ascii=False, separators=(",", ":"))


def decode_event(line: str) -> Event:
    """Parse a single JSON Lines string as an Event."""
    return cast(Event, _decode(line, EVENT_KINDS, "event"))


def decode_command(line: str) -> Command:
    """Parse a single JSON Lines string as a Command."""
    return cast(Command, _decode(line, COMMAND_KINDS, "command"))


_USER_MESSAGE_PREFIX_RE = re.compile(
    r'^\{\s*"kind"\s*:\s*"user_message"\s*,\s*"text"\s*:\s*"'
)
_USER_MESSAGE_IMAGES_SUFFIX_RE = re.compile(
    r'"\s*,\s*"images"\s*:\s*(?P<images>\[[\s\S]*?\])'
    r'(?P<tail>\s*,\s*"absoluteTurnIndex"\s*:\s*(?P<absolute_turn_index>-?\d+|null))?'
    r"\s*\}\s*$"
)


def _repair_malformed_user_message_command(line: str) -> dict[str, Any] | None:
    """Recover legacy malformed `user_message` command lines.

    v0.1.x builds wrote bridge commands from the webview through
    tauri-plugin-shell. A reported Windows case reached the bridge as a JSON-ish
    line where the user text was not escaped, e.g. a quoted `D:\\...` path broke
    `json.loads`. This recovery is intentionally narrow: only the fixed
    `user_message` envelope is accepted, and non-message commands still fail
    closed.
    """
    prefix = _USER_MESSAGE_PREFIX_RE.match(line)
    if not prefix:
        return None
    matches = list(_USER_MESSAGE_IMAGES_SUFFIX_RE.finditer(line))
    if not matches:
        return None
    suffix = matches[-1]
    try:
        images = json.loads(suffix.group("images"))
    except json.JSONDecodeError:
        return None
    if not isinstance(images, list) or not all(isinstance(item, str) for item in images):
        return None
    payload: dict[str, Any] = {
        "kind": "user_message",
        "text": line[prefix.end() : suffix.start()],
        "images": images,
    }
    raw_absolute_turn_index = suffix.group("absolute_turn_index")
    if raw_absolute_turn_index is not None:
        payload["absoluteTurnIndex"] = (
            None
            if raw_absolute_turn_index == "null"
            else int(raw_absolute_turn_index)
        )
    return payload


def _decode(line: str, registry: dict[str, type], label: str) -> Any:
    line = line.strip()
    if not line:
        raise IPCProtocolError(f"Empty {label} line")
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as e:
        payload = _repair_malformed_user_message_command(line) if label == "command" else None
        if payload is None:
            raise IPCProtocolError(f"Invalid JSON in {label}: {e.msg}") from e
    if not isinstance(payload, dict):
        raise IPCProtocolError(
            f"{label.capitalize()} must be a JSON object, got {type(payload).__name__}"
        )
    kind = payload.get("kind")
    if not isinstance(kind, str):
        raise IPCProtocolError(f"{label.capitalize()} missing 'kind' field")
    cls = registry.get(kind)
    if cls is None:
        raise IPCProtocolError(f"Unknown {label} kind: {kind!r}")
    try:
        return cls(**payload)
    except TypeError as e:
        # missing required field or unexpected field -> dataclass __init__ raises TypeError
        raise IPCProtocolError(f"Invalid {label} {kind!r}: {e}") from e
