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
dispatch, the seam the main chat's browser guard uses (ticket 135). Both
only in Galley's managed runtime, for the main chat's runner
(`offered_here`): CLAUDE.md Rule 1 keeps attach mode untouched, and there a
call to `tell_user` reaches GA, which answers that it knows no such tool.

What the call does is the bridge's (`Bridge._tell_user`): a `tell_user` IPC
event, which Core writes as a Galley message in the main chat right after the
step that said it (`core/src/tell_user.rs`).
"""

from __future__ import annotations

import os
import re
from typing import Any

from runner import managed_runtime

TOOL_NAME = "tell_user"

# The main chat's runner (core/src/runner_commands.rs `MAIN_CHAT_ENV`); the
# same variable the browser guard reads (runner.handlers.MAIN_CHAT_ENV).
MAIN_CHAT_ENV = "GALLEY_MAIN_CHAT"

# The tool's entry, in GA's own format (assets/tools_schema.json: OpenAI
# function entries). What it is and when it helps, no rules (ruling 186
# point 2); GA's terse register. The clause after the semicolon is a fact
# of the main chat, not a rule: the words of a step that calls tools are
# never drawn there (only its reply is), and the eval's first wording,
# without it, had the model answer "还要多久？" in such a step's text, which
# nobody sees (.scratch/main-chat/entry-layer-eval/tell-user/).
DESCRIPTION_EN = (
    "Send the user a message right away, without ending your turn; until your "
    "final reply, nothing else you write reaches them. Useful when the user says "
    "something while you are working, or when what you are doing will take a "
    "while and they would want to know how it is going."
)
MESSAGE_EN = "What to tell them: a sentence or a short paragraph."
# The Chinese pair, for a GA that loaded its Chinese tool list
# (assets/tools_schema_cn.json), as GA pairs its own.
DESCRIPTION_CN = (
    "立即给用户发一条消息，不结束这一轮；在你最后回复之前，你写的别的话用户都看不到。"
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
    exactly "1") in Galley's managed runtime. The browser guard's test
    (`runner.handlers._main_chat_refuses`), so a stray variable in an
    external GA's environment changes nothing."""
    return os.environ.get(MAIN_CHAT_ENV) == "1" and managed_runtime.is_managed_runtime()


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
