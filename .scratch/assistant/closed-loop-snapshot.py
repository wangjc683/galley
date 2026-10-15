#!/usr/bin/env python3
"""Closed-loop trial snapshot (assistant PRD, step 1; main chat tickets 29-31).

Read-only. Counts what the trial week is meant to show, straight from
Galley's database: how much work the assistant handed off, how its wakes
went (reports, send-backs, answers for the user, silent replies), and how
much the user talked to it. What the user did in the GUI (opening cards)
is not in the database; ask JC.

    python3 .scratch/assistant/closed-loop-snapshot.py [--since 2026-10-16] [--db PATH]
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

DEFAULT_DB = Path.home() / "Library/Application Support/app.galley/workbench.db"
REPORT_SUPERVISOR = "galley-report"
ASSISTANT_SUPERVISOR = "galley-assistant"
NO_REPLY = re.compile(r"<\s*/?\s*no-reply\s*/?\s*>", re.I)
OUTCOME = re.compile(r'^\[Galley: subtask \S+ ".*" (.+?) — details')


def asked(tool_calls: str | None) -> bool:
    if not tool_calls or "ask_user" not in tool_calls:
        return False
    try:
        calls = json.loads(tool_calls)
    except ValueError:
        return False
    return any(isinstance(c, dict) and c.get("toolName") == "ask_user" for c in calls)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-16", help="UTC date, inclusive")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()
    db = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    since = args.since

    mains = [r["id"] for r in db.execute("SELECT id FROM sessions WHERE main_chat = 1")]
    if not mains:
        print("no main chat")
        return
    marks = ",".join("?" * len(mains))

    user_msgs = db.execute(
        f"SELECT COUNT(*) FROM messages WHERE session_id IN ({marks}) AND role = 'user' "
        "AND created_via = 'gui' AND created_at >= ?",
        (*mains, since),
    ).fetchone()[0]

    dispatches = db.execute(
        f"SELECT session_id, failure FROM subtask_dispatches "
        f"WHERE parent_session_id IN ({marks}) AND created_at >= ?",
        (*mains, since),
    ).fetchall()
    subtasks = [d["session_id"] for d in dispatches if d["session_id"]]
    failed = Counter(d["failure"] for d in dispatches if d["failure"])

    reports = db.execute(
        f"SELECT summary FROM messages WHERE session_id IN ({marks}) AND role = 'user' "
        "AND created_via = 'system' AND supervisor = ? AND created_at >= ?",
        (*mains, REPORT_SUPERVISOR, since),
    ).fetchall()
    outcomes: Counter[str] = Counter()
    for r in reports:
        for line in (r["summary"] or "").splitlines():
            m = OUTCOME.match(line.strip())
            outcomes[m.group(1) if m else "?"] += 1

    silent = 0
    for r in db.execute(
        f"SELECT content, final_answer FROM messages WHERE session_id IN ({marks}) "
        "AND role = 'assistant' AND created_at >= ?",
        (*mains, since),
    ):
        if NO_REPLY.search(r["content"] or "") and not (r["final_answer"] or "").strip():
            silent += 1

    send_backs = answers = 0
    promoted = 0
    for sid in subtasks:
        prev_asked = False
        for r in db.execute(
            "SELECT role, supervisor, tool_calls FROM messages WHERE session_id = ? "
            "AND visibility = 'visible' ORDER BY turn_index, sequence",
            (sid,),
        ):
            if r["role"] == "assistant":
                prev_asked = asked(r["tool_calls"])
            elif r["role"] == "user" and r["supervisor"] == ASSISTANT_SUPERVISOR:
                if prev_asked:
                    answers += 1
                else:
                    send_backs += 1
        row = db.execute("SELECT promoted_at FROM sessions WHERE id = ?", (sid,)).fetchone()
        if row and row["promoted_at"]:
            promoted += 1

    print(f"since {since} (UTC)")
    print(f"- you → main chat: {user_msgs} messages")
    print(f"- subtasks dispatched: {len(subtasks)}; not started: {dict(failed) or 0}")
    print(f"- wakes: {len(reports)}; reported outcomes: {dict(outcomes) or 0}")
    print(f"- assistant → subtasks: {send_backs} send-backs, {answers} answers for you")
    print(f"- silent replies (<no-reply/>): {silent}")
    print(f"- subtasks you took over (promoted): {promoted}")


if __name__ == "__main__":
    main()
