"""A line to the user mid-run: the main chat's `tell_user` tool (main chat
ticket 137, PRD ruling 186 point 2).

GA's loop gives the model one reply per run: to answer the user before it is
done it had to stop, or hand the work off. `tell_user` sends the user a
message now and the run goes on ("记上了，天气还在查"). The model reads only
what the tool is and when it helps; nothing here says when it must.

Where it lives: not in GA's tool files. Those are shared by every managed
runner (workbench sessions, subtasks, the IM channels), and only the main
chat gets this tool. The main chat's runner offers it by adding its entry to
`agentmain.TOOLS_SCHEMA` before each run (`GaSession.offer_tool`), and
`runner.handlers.WorkbenchHandler.dispatch` takes the call before GA's own
dispatch. Both only in Galley's managed runtime, for the main chat's runner
(`offered_here`): CLAUDE.md Rule 1 keeps attach mode untouched, and there a
call to `tell_user` reaches GA, which answers that it knows no such tool.

What the call does is the bridge's (`Bridge._tell_user`): a `tell_user` IPC
event, which Core writes as a Galley message in the main chat right after the
step that said it (`core/src/tell_user.rs`).
"""

from __future__ import annotations

import re
from typing import Any

from runner import managed_runtime

TOOL_NAME = "tell_user"

# The main chat's runner (core/src/runner_commands.rs `MAIN_CHAT_ENV`).
MAIN_CHAT_ENV = managed_runtime.GALLEY_MAIN_CHAT_ENV

# The tool's entry, in GA's own format (assets/tools_schema.json: OpenAI
# function entries). What it is and when it helps, no rules (ruling 186
# point 2); GA's terse register. Ticket 137's eval added a clause after a
# semicolon, "until your final reply, nothing else you write reaches them",
# then a fact of the main chat; ticket 142 made a step's words reach the
# user in a run they started, so ticket 139 went back to the first wording
# (the eval's r1, .scratch/main-chat/entry-layer-eval/tell-user/).
DESCRIPTION_EN = (
    "Send the user a message right away, without ending your turn. Useful when "
    "the user says something while you are working, or when what you are doing "
    "will take a while and they would want to know how it is going."
)
MESSAGE_EN = "What to tell them: a sentence or a short paragraph."
# The Chinese pair, for a GA that loaded its Chinese tool list
# (assets/tools_schema_cn.json), as GA pairs its own.
DESCRIPTION_CN = (
    "立即给用户发一条消息，不结束这一轮。"
    "用户在你干活时说了话，或手上的事要做很久、用户该知道进展时有用。"
)
MESSAGE_CN = "要告诉用户的话：一句或一小段。"

# What the model reads back (GA's result shape): sent, and the run goes on.
SENT = {"status": "success", "msg": "Sent to the user. Carry on; your turn has not ended."}
EMPTY = {"status": "error", "msg": "message is empty; nothing was sent."}
CLOSED = {"status": "error", "msg": "Not sent: this turn has already ended."}

_CJK = re.compile(r"[一-鿿]")


def offered_here() -> bool:
    """Whether this runner offers `tell_user`: the main chat's (the variable
    exactly "1") in Galley's managed runtime
    (`managed_runtime.is_managed_main_chat`), so a stray variable in an
    external GA's environment changes nothing."""
    return managed_runtime.is_managed_main_chat()


def tool_entry(tools: list[Any] | None = None) -> dict[str, Any]:
    """The tool's entry for a run whose tool list is `tools`: in Chinese
    when GA loaded its Chinese list (its `ask_user` says so), else in
    English."""
    chinese = any(
        isinstance(t, dict)
        and t.get("function", {}).get("name") == "ask_user"
        and _CJK.search(str(t.get("function", {}).get("description", "")))
        for t in tools or []
    )
    return {
        "type": "function",
        "function": {
            "name": TOOL_NAME,
            "description": DESCRIPTION_CN if chinese else DESCRIPTION_EN,
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": MESSAGE_CN if chinese else MESSAGE_EN,
                    }
                },
                "required": ["message"],
            },
        },
    }


def message_of(args: Any) -> str:
    """The message a call carries, trimmed; "" when there is none."""
    if not isinstance(args, dict):
        return ""
    value = args.get("message")
    return value.strip() if isinstance(value, str) else ""
