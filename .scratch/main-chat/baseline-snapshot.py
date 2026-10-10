#!/usr/bin/env python3
"""Main-chat baseline snapshot (main-chat PRD, "一周基线测量").

Read-only over workbench.db. With no --session it lists candidates
(pinned sessions, then sessions by human turns since --since); with
--session it prints one row per turn: when, how long the human's
message was, tokens, cache share, context fill, and other sessions the
human opened in the same window (the side-chat signal).

    python3 -I .scratch/main-chat/baseline-snapshot.py
    python3 -I .scratch/main-chat/baseline-snapshot.py --session s-...
"""

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB = Path.home() / "Library/Application Support/app.galley/workbench.db"


def connect(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def candidates(conn: sqlite3.Connection, since: str) -> None:
    rows = conn.execute(
        """
        SELECT s.id, s.title, s.pinned, s.created_via, s.ga_runtime_kind,
               count(m.id) AS human_turns, max(m.created_at) AS last
        FROM sessions s
        LEFT JOIN messages m
          ON m.session_id = s.id AND m.role = 'user' AND m.created_at >= ?
        GROUP BY s.id
        HAVING s.pinned = 1 OR human_turns > 0
        ORDER BY s.pinned DESC, human_turns DESC
        LIMIT 15
        """,
        (since,),
    ).fetchall()
    print(f"candidates since {since} (pinned first, then by human turns):")
    if not rows:
        print("  none: no pinned session and no human turn in this window")
    for r in rows:
        pin = "pinned" if r["pinned"] else "      "
        print(
            f"  {r['id']}  {pin}  {r['created_via']:<10} {r['ga_runtime_kind'] or '-':<8}"
            f" turns={r['human_turns']:<4} last={r['last'] or '-'}  {(r['title'] or '')[:30]}"
        )


def snapshot(conn: sqlite3.Connection, session: str, since: str) -> None:
    s = conn.execute("SELECT * FROM sessions WHERE id = ?", (session,)).fetchone()
    if s is None:
        raise SystemExit(f"no session {session}")
    print(f"{s['id']}  {s['title']}  via={s['created_via']} runtime={s['ga_runtime_kind']}")

    # turn_index counts engine steps, not human turns: a user row takes the
    # next index and the assistant rows after it belong to it until the
    # next user row. Number human turns by counting user rows.
    turns: dict[int, dict] = {}
    human = 0
    for row in conn.execute(
        "SELECT role, created_at, content, telemetry_json FROM messages"
        " WHERE session_id = ? ORDER BY turn_index, sequence",
        (session,),
    ):
        if row["role"] == "user":
            human += 1
            turns[human] = {"at": row["created_at"], "chars": len(row["content"] or "")}
            continue
        if row["telemetry_json"] is None:
            continue
        t = json.loads(row["telemetry_json"])
        acc = turns.setdefault(human, {"at": "?", "chars": 0})
        for key in ("inputTokens", "outputTokens", "cacheReadTokens", "cacheCreateTokens",
                    "requestCount", "elapsedMs"):
            acc[key] = acc.get(key, 0) + (t.get(key) or 0)
        acc["used"] = max(acc.get("used", 0), t.get("contextUsedChars") or 0)
        acc["limit"] = t.get("contextLimitChars") or acc.get("limit")

    print(f"{'turn':>4}  {'at (UTC)':<19}  {'msg':>5}  {'in':>7}  {'cacheR':>7}  {'cache%':>6}"
          f"  {'out':>6}  {'req':>3}  {'sec':>5}  {'ctx used':>8}  {'fill':>5}")
    first_full = None
    for idx in sorted(turns):
        a = turns[idx]
        fresh = a.get("inputTokens", 0) + a.get("cacheCreateTokens", 0)
        read = a.get("cacheReadTokens", 0)
        share = f"{read / (fresh + read):.0%}" if fresh + read else "-"
        used, limit = a.get("used", 0), a.get("limit")
        fill = f"{used / limit:.0%}" if limit else "-"
        if limit and used >= limit and first_full is None:
            first_full = idx
        print(f"{idx:>4}  {a['at'][:19]:<19}  {a['chars']:>5}  {a.get('inputTokens', 0):>7}"
              f"  {read:>7}  {share:>6}  {a.get('outputTokens', 0):>6}"
              f"  {a.get('requestCount', 0):>3}  {a.get('elapsedMs', 0) / 1000:>5.0f}"
              f"  {used:>8}  {fill:>5}")
    print(f"human turns: {human}; first turn at the context limit: "
          f"{first_full if first_full is not None else 'not reached'}")

    others = conn.execute(
        "SELECT id, title, created_at FROM sessions"
        " WHERE id != ? AND created_via = 'gui' AND created_at >= ? ORDER BY created_at",
        (session, since),
    ).fetchall()
    print(f"other desktop sessions opened since {since}: {len(others)}")
    for o in others:
        print(f"  {o['created_at'][:19]}  {o['id']}  {(o['title'] or '')[:40]}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--session")
    p.add_argument("--since", default="2026-10-09")
    args = p.parse_args()
    conn = connect(args.db)
    if args.session:
        snapshot(conn, args.session, args.since)
    else:
        candidates(conn, args.since)


if __name__ == "__main__":
    main()
