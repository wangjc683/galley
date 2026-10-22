#!/usr/bin/env python3
"""Closed-loop trial snapshot (assistant PRD, step 1; main chat tickets 29-31).

Read-only. Counts what the trial week is meant to show, straight from
Galley's database: how much work the assistant handed off, how its wakes
went (reports, send-backs, answers for the user, silent replies), and how
much the user talked to it. What the user did in the GUI (opening cards)
is not in the database; ask JC.

Ticket 73 (assistant PRD ruling 10, the proactive first stage) adds: the
to-dos it noted with no date, what was cancelled of what it set and by
whom (ticket 61's cancel columns), and the morning review: how often it
came due, was skipped (nothing to look at: since ticket 81 it wakes only
for a to-do with no date or due within three days, or a subtask not
finished), woke the main chat, spoke (a reply that is not only
<no-reply/>), and how many subtasks those turns started.
The review's comings due and skips are read from its log, the
`assistant_review_log` pref Core keeps (scheduler.rs `REVIEW_LOG_PREF`):
a skip leaves no other trace.

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
REVIEW_SUPERVISOR = "galley-review"
REVIEW_LOG_PREF = "assistant_review_log"
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

    # ---- ticket 73 ----
    undated = db.execute(
        "SELECT COUNT(*) FROM todos WHERE created_by_supervisor = ? "
        "AND due_date IS NULL AND due_at IS NULL AND created_at >= ?",
        (ASSISTANT_SUPERVISOR, since),
    ).fetchone()[0]
    noted = db.execute(
        "SELECT COUNT(*) FROM todos WHERE created_by_supervisor = ? AND created_at >= ?",
        (ASSISTANT_SUPERVISOR, since),
    ).fetchone()[0]

    # What it set (to-dos and tasks, a to-do's reminder being a task of its
    # own) that was cancelled since, by who cancelled it.
    cancels: dict[str, Counter[str]] = {}
    for table in ("todos", "scheduled_tasks"):
        tally: Counter[str] = Counter()
        for r in db.execute(
            f"SELECT cancelled_via, cancelled_by_supervisor FROM {table} "
            "WHERE created_by_supervisor = ? AND cancelled_at IS NOT NULL AND cancelled_at >= ?",
            (ASSISTANT_SUPERVISOR, since),
        ):
            via, who = r["cancelled_via"], r["cancelled_by_supervisor"]
            if via == "gui":
                tally["you, on the desktop"] += 1
            elif via == "supervisor" and who == ASSISTANT_SUPERVISOR:
                tally["Galley, at your word"] += 1
            elif via == "system":
                tally["Core, with its to-do"] += 1
            elif via is None:
                tally["unknown (cancelled before ticket 61 recorded who)"] += 1
            else:
                tally[f"{via} {who or ''}".strip()] += 1
        cancels[table] = tally

    reviews = [
        r["id"]
        for r in db.execute(
            "SELECT id FROM scheduled_tasks WHERE created_via = 'system' "
            "AND created_by_supervisor = ?",
            (REVIEW_SUPERVISOR,),
        )
    ]
    log_row = db.execute("SELECT value FROM prefs WHERE key = ?", (REVIEW_LOG_PREF,)).fetchone()
    log: list[dict] = []
    if log_row:
        try:
            parsed = json.loads(log_row["value"])
            log = [e for e in parsed if isinstance(e, dict)] if isinstance(parsed, list) else []
        except ValueError:
            log = []
    events = Counter(e.get("event") for e in log if str(e.get("at", "")) >= since)

    # The turns the review woke: a wake row naming a review task in its
    # note, its run the assistant rows up to the next user row; the run
    # spoke when its last reply is more than <no-reply/>.
    review_wakes = spoke = review_subtasks = 0
    if reviews:
        wake_rows = db.execute(
            f"SELECT session_id, turn_index, origin_note FROM messages "
            f"WHERE session_id IN ({marks}) AND role = 'user' AND created_via = 'system' "
            "AND supervisor = ? AND created_at >= ? ORDER BY turn_index",
            (*mains, REPORT_SUPERVISOR, since),
        ).fetchall()
        for w in wake_rows:
            ids = {i.strip() for i in (w["origin_note"] or "").split(",")}
            if not ids & set(reviews):
                continue
            review_wakes += 1
            nxt = db.execute(
                "SELECT MIN(turn_index) FROM messages WHERE session_id = ? AND role = 'user' "
                "AND turn_index > ?",
                (w["session_id"], w["turn_index"]),
            ).fetchone()[0]
            end = nxt if nxt is not None else 1 << 62
            last = db.execute(
                "SELECT content, final_answer FROM messages WHERE session_id = ? "
                "AND role = 'assistant' AND turn_index >= ? AND turn_index < ? "
                "ORDER BY turn_index DESC, sequence DESC LIMIT 1",
                (w["session_id"], w["turn_index"], end),
            ).fetchone()
            # Core strips <no-reply/> (and <subtask> tags) from the final
            # answer: a silent run leaves it empty.
            if last and NO_REPLY.sub("", last["final_answer"] or "").strip():
                spoke += 1
            review_subtasks += db.execute(
                "SELECT COUNT(*) FROM subtask_dispatches WHERE parent_session_id = ? "
                "AND turn_index >= ? AND turn_index < ? AND session_id IS NOT NULL",
                (w["session_id"], w["turn_index"], end),
            ).fetchone()[0]

    print(f"since {since} (UTC)")
    print(f"- you → main chat: {user_msgs} messages")
    print(f"- subtasks dispatched: {len(subtasks)}; not started: {dict(failed) or 0}")
    print(f"- wakes: {len(reports)}; reported outcomes: {dict(outcomes) or 0}")
    print(f"- assistant → subtasks: {send_backs} send-backs, {answers} answers for you")
    print(f"- silent replies (<no-reply/>): {silent}")
    print(f"- subtasks you took over (promoted): {promoted}")
    print("ticket 73, proactive first stage")
    print(f"- to-dos it noted: {noted}; of them with no date: {undated}")
    print(
        "  (asked or unasked: not in the database, Core cannot tell them apart; "
        "read the turns they were noted in)"
    )
    print(f"- to-dos it noted, cancelled since, by: {dict(cancels['todos']) or 0}")
    print(f"- tasks it set (reminders included), cancelled since, by: "
          f"{dict(cancels['scheduled_tasks']) or 0}")
    if not reviews:
        print("- morning review: no review task in this database yet")
    else:
        state = db.execute(
            f"SELECT id, enabled, cancelled_at FROM scheduled_tasks WHERE id IN "
            f"({','.join('?' * len(reviews))})",
            reviews,
        ).fetchall()
        shown = ", ".join(
            f"{r['id']} {'cancelled' if r['cancelled_at'] else 'on' if r['enabled'] else 'paused'}"
            for r in state
        )
        came_due = events["skipped"] + events["woke"]
        print(f"- morning review ({shown}):")
        print(
            f"  came due {came_due}, skipped (nothing to look at) {events['skipped']}, "
            f"woke {events['woke']}, run by hand {events['run']}, "
            f"dropped undelivered {events['dropped']} (from its log)"
        )
        print(
            f"  wakes delivered to the main chat {review_wakes}, of which it spoke "
            f"{spoke}; subtasks those turns started: {review_subtasks}"
        )


if __name__ == "__main__":
    main()
