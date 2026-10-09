"""Export distinct assistant reply texts from the local Galley DB (read-only) as JSONL.

Usage: python3 -I export-reply-corpus.py <out.jsonl>
The output holds the user's real conversations: keep it out of git.
"""
import json
import os
import sqlite3
import sys

db = os.path.expanduser("~/Library/Application Support/app.galley/workbench.db")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
seen = set()
with open(sys.argv[1], "w", encoding="utf-8") as out:
    for content, final in conn.execute("select content, final_answer from messages where role='assistant'"):
        for text in (content, final):
            if text and text.strip() and text not in seen:
                seen.add(text)
                out.write(json.dumps(text, ensure_ascii=False) + "\n")
print("texts:", len(seen))
