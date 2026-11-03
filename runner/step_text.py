"""What the model writes in a step that calls tools reaches the user before
the tools run (main chat ticket 142, PRD ruling 191).

Models talk to the user while they call tools ("我查一下下载文件夹里的大
文件。"), thinking the user sees it. Until this ticket the main chat drew only a run's
reply, and a step's words landed only with its `turn_end`, after its tools
(a 60-second wait in the dev run that started this). Now, when a step's
reply calls tools and has words outside its `<summary>`, the runner sends
those words the moment GA hands the reply to its first tool dispatch, as the
main chat's "line told mid-run" (ticket 137's `tell_user` event, with
`stepText: true`). No guess at whether the words are meant for the user:
ticket 142's measure found they almost always are.

This module says what a step would send (`to_tell`); where and when is the
handler's (`runner.handlers.WorkbenchHandler.dispatch`, the call with
`index == 0`), and which runs is the bridge's (`Bridge._tell_step_text`:
the managed main chat, a run the user started). Read-only on GA's response
object (CLAUDE.md Rule 1).
"""

from __future__ import annotations

import re
from typing import Any

from runner import tell_user

# Steps that send nothing even with words outside `<summary>`:
# - `tell_user`: the step already sends the line it chose (ruling 191);
# - `ask_user`: GA's `do_ask_user` ends the run, so the asking step is the
#   run's last, drawn as its question (and a line told in it would sort
#   after the question, ticket 137 Open risk 1).
SKIP_TOOLS = frozenset({tell_user.TOOL_NAME, "ask_user"})

# The reply cleaning rules, `cleanFinalAnswer` in
# gui/src/lib/ipc/ga-output-cleaning.ts and `clean_final_answer` in
# core/src/turn_persistence/derive.rs, in the same order and with
# JavaScript's semantics where Python's differ, as the Rust port spells
# them out: `\s` and `trim` are ECMAScript's whitespace set (`_JS_SPACE`),
# and `^` / `$` under the `m` flag see four line terminators, not only
# `\n` (`_LINE_START`, `_LINE_END`). The golden rows the GUI generates
# (core/tests/fixtures/turn-persistence-rows.json) pin this to the other two.
_JS_SPACE_CHARS = (
    "\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_JS_SPACE = "[" + re.escape(_JS_SPACE_CHARS) + "]"
_LINE_TERMINATORS = "[\n\r\u2028\u2029]"
_LINE_START = "(?:^|(?<=" + _LINE_TERMINATORS + "))"
_LINE_END = "(?=" + _LINE_TERMINATORS + "|\\Z)"


def _js(pattern: str, flags: int = 0) -> re.Pattern[str]:
    """`pattern` with `{S}` as JavaScript's `\\s`, `{BOL}` / `{EOL}` as its
    `^` / `$` under the `m` flag."""
    return re.compile(
        pattern.replace("{S}", _JS_SPACE)
        .replace("{BOL}", _LINE_START)
        .replace("{EOL}", _LINE_END),
        flags,
    )


_TAG_BLOCKS = [
    _js(r"<thinking>[\s\S]*?</thinking>"),
    _js(r"<summary>[\s\S]*?</summary>"),
    _js(r"<tool_use>[\s\S]*?</tool_use>"),
    _js(r"<file_content[^>]*>[\s\S]*?</file_content>"),
    _js(r"<next-suggestion>[\s\S]*?</next-suggestion>"),
    _js(r"<goal-status>[\s\S]*?</goal-status>"),
    _js(r"<subtask(?:{S}[^>]*)?>[\s\S]*?</subtask>"),
    _js(r"<{S}*/?{S}*no-reply{S}*/?{S}*>", re.IGNORECASE),
]
_SUBTASK_OPEN = _js(r"<subtask(?:{S}[^>]*)?>")
_LLM_RUNNING_MARKER = _js(r"{BOL}{S}*\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}{S}*{EOL}")
_TOOL_ACTION_LINE = _js(r"{BOL}\[Action\] [^\n]*{EOL}")
_PHASE_PREAMBLE = _js(
    r"{BOL}\*{0,2}当前阶段\*{0,2}{S}*[：:][\s\S]*?(?=\n\n|" + _LINE_TERMINATORS + r"|\Z)"
)
_FILE_REF = re.compile(r"\[FILE:[^\]]+\]")
_BLANK_LINE_RUNS = re.compile(r"\n{3,}")


def clean(text: str) -> str:
    """`text` as the conversation shows a reply: GA's and Galley's tags
    out, an unclosed `<subtask>` and everything after it out, GA's markers
    and file references out, trimmed."""
    if not text:
        return ""
    out = text
    for pattern in _TAG_BLOCKS:
        out = pattern.sub("", out)
    opener = _SUBTASK_OPEN.search(out)
    if opener is not None:
        out = out[: opener.start()]
    out = _LLM_RUNNING_MARKER.sub("", out)
    out = _TOOL_ACTION_LINE.sub("", out)
    out = _PHASE_PREAMBLE.sub("", out)
    out = _FILE_REF.sub("", out)
    out = _BLANK_LINE_RUNS.sub("\n\n", out)
    return out.strip(_JS_SPACE_CHARS)


def tool_names(response: Any) -> list[str]:
    """The tools a reply calls, by name (GA's `response.tool_calls`, each
    with `function.name`); empty for a reply that calls none."""
    names: list[str] = []
    for call in getattr(response, "tool_calls", None) or []:
        function = getattr(call, "function", None)
        name = getattr(function, "name", None)
        if isinstance(name, str):
            names.append(name)
    return names


def to_tell(response: Any) -> str:
    """The words a step's reply would send the user before its tools run:
    its text cleaned (`clean`), when the reply calls tools and none of
    them is one of `SKIP_TOOLS`; "" otherwise. A reply that calls no tool
    is the run's answer, drawn as it always was."""
    names = tool_names(response)
    if not names or SKIP_TOOLS.intersection(names):
        return ""
    content = getattr(response, "content", "")
    return clean(content) if isinstance(content, str) else ""
