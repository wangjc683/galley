#!/usr/bin/env python3
"""Main chat entry layer comparison (ticket 03d). See README.md.

Each case runs twice with the real model: WITHOUT (the prompt a main chat
runner gets today) and WITH (the same, plus draft.md appended after the
`## Main Chat` section). Every run is its own worker process that sets up
the bundled engine the way runner/workbench_bridge.py does (managed mode,
fresh state root seeded from managed-ga/state-seed, Galley's runtime prompt
via runner.managed_runtime, history via runner.ga_session.GaSession) and
sends the case's message with put_task. Tools are offered to the model as
usual, but GA's tool dispatch is replaced: the first tool call is recorded
and the run stops. Nothing the model asks for is executed.

Usage:

  python3 run.py --dry-test                 no model: verify the interception
  python3 run.py --variant both             15 cases x 2 variants, real model
  python3 run.py --cases carry-quote --variant with   partial rerun (merged)
  python3 run.py --render-only              rebuild results.md from results.json
  python3 run.py --suite dispatch           ticket 06: dispatch-cases.json x T / C / P

Dispatch suite: WITH plus one clause of dispatch-clauses.md (P also gets a
start_subtask tool). If a run's first tool call starts a subtask (C: a
code_run containing `subtask start`; P: start_subtask), it is not run
either: the model gets a fake success result and continues until its next
tool call (recorded, run stops) or its final reply.

The model is read from Galley's database (a temp copy; the API key is
decrypted in memory only), or from a GA mykey.py with --mykey/--mykey-entry.
"""

from __future__ import annotations

import argparse
import builtins
import calendar
import concurrent.futures
import json
import os
import platform
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# No __pycache__ under managed-ga/code/ or runner/ (the managed payload
# gate refuses generated files there), even without PYTHONDONTWRITEBYTECODE.
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
GA_CODE = REPO / "managed-ga" / "code"
STATE_SEED = REPO / "managed-ga" / "state-seed"
CASES = HERE / "cases.json"
DRAFT = HERE / "draft.md"
GALLEY_PROMPT_DIR = HERE / "galley-prompt"
COMPOSED_DIR = HERE / "composed"
RESULTS_JSON = HERE / "results.json"
RESULTS_MD = HERE / "results.md"

# The main chat state block's facts. A plausible main chat: the id is the
# example id from core/src/managed_prompt.rs tests, the segment began today.
SESSION_ID = "s-mgn4k2x1-7q3z9w0e"
SEGMENT_START_TURN = 42
# One non-carried and one carried case get their full request dumped.
DUMP_CASES = ("chat-tired", "carry-quote")

DEFAULT_GALLEY_DB = Path.home() / "Library" / "Application Support" / "app.galley" / "workbench.db"
# gpt-6.1-sol, the main chat's model, through an API-key provider.
# Since ticket 73: the relay entry used until ticket 64 (mm_1790734996114)
# was deleted from Galley's database, and the main chat's own gpt-6.1-sol
# signs in with ChatGPT, which this script cannot reach.
DEFAULT_MODEL_ID = "mm_1792576875658"
VARIANTS = ("without", "with")
RUN_TIMEOUT_S = 600

# Ticket 06: three ways the main chat could dispatch a long task.
DISPATCH_CLAUSES = HERE / "dispatch-clauses.md"
DISPATCH_CASES = HERE / "dispatch-cases.json"
DISPATCH_JSON = HERE / "dispatch-results.json"
DISPATCH_MD = HERE / "dispatch-results.md"
DISPATCH_VARIANTS = ("T", "C", "P")
DISPATCH_DUMP_CASES = ("big-pdfs",)
# P's extra tool, in GA's own schema format (assets/tools_schema.json:
# OpenAI function entries), appended to agentmain.TOOLS_SCHEMA in the
# worker only. The function description is the harness's; the clause
# carries the guidance.
START_SUBTASK_TOOL = {
    "type": "function",
    "function": {
        "name": "start_subtask",
        "description": "Start a subtask that runs as a separate conversation.",
        "parameters": {
            "type": "object",
            "properties": {"task": {"type": "string", "description": "what to do"}},
            "required": ["task"],
        },
    },
}
# What a dispatch returns to the model instead of running (C: what
# code_run would return for that CLI output; P: the tool's result).
FAKE_SUBTASK_STDOUT = '{"schemaVersion":2,"ok":true,"result":{"sessionId":"s-sub0001","status":"running"}}'
FAKE_DISPATCH_RESULTS: dict[str, Any] = {
    "C": {"status": "success", "stdout": FAKE_SUBTASK_STDOUT + "\n", "exit_code": 0},
    "P": {"subtask_id": "s-sub0001", "status": "running"},
}
CLI_DISPATCH_RE = re.compile(r"subtask[\s'\",]+start\b")
SUBTASK_TAG_RE = re.compile(r"<subtask>([\s\S]*?)</subtask>")
DISPATCH_FIRSTSTOP_JSON = HERE / "dispatch-results-firststop.json"
DISPATCH_FIRSTSTOP_MD = HERE / "dispatch-results-firststop.md"

# Ticket 30: Galley wakes the main chat when a subtask settles (wake/).
# Sandbox mode with a fixture-driven fake galley; the prompt is the real
# Rust composition with the ticket 30 entry layer, the manual is the
# repo's, written where Core writes it (since ticket 59 a directory of
# parts, assistant_manual::materialize).
WAKE_DIR = HERE / "wake"
WAKE_CASES = WAKE_DIR / "cases.json"
WAKE_WORDING = WAKE_DIR / "wording.md"
WAKE_PROMPT = WAKE_DIR / "galley-prompt" / "main_chat.plain.txt"
WAKE_CLI_HELP = WAKE_DIR / "cli-help.json"
WAKE_JSON = WAKE_DIR / "results.json"
WAKE_MD = WAKE_DIR / "results.md"
WAKE_COMPOSED_DIR = WAKE_DIR / "composed"
WAKE_DUMP_CASES = ("done-evidence", "two-at-once")
MANUAL_DIR = REPO / "docs" / "managed-ga-runtime" / "galley-assistant-manual"
MANUAL_STATE_DIR = ("assistant", "reference", "manual")  # under the state root
# A tool call reads the manual when it names the directory (a file_read
# path, or a shell or Python script, which may loop over part names) or,
# for the runs ticket 59 replaced, the single file of before it.
MANUAL_STATE_PATH = "assistant/reference/manual"
MD_NAME_RE = re.compile(r"[A-Za-z0-9_-]+\.md")
OLD_MANUAL_FILE = "galley-assistant-manual.md"
WAKE_TOOL_CAP = 10
WAKE_REPEATS = 2
# Besides the interpreters and the fake galley, the model's shell code may
# start these (still inside the sandbox's file and network rules): Galley's
# own CLI discovery line uses sed, and a model checks evidence with ls / cat.
WAKE_EXTRA_EXEC = ("/usr/bin/sed", "/bin/cat", "/usr/bin/head", "/usr/bin/tail", "/bin/ls",
                   "/usr/bin/grep", "/usr/bin/wc", "/bin/sleep")
HOLDING_COMMANDS = ("session wait", "session follow", "session watch", "project follow")
WRITE_COMMANDS = ("session send", "session stop", "session archive", "session restore", "session move",
                  "session new", "session btw", "project create", "project delete", "llm set")

# Ticket 36: reminders and scheduled tasks (schedule/). The wake suite's
# sandbox and fake galley, which also answers the `schedule` family and
# ticket 35's other hands from the case's tasks. The prompt is the real
# Rust composition with the ticket 36 entry layer and the main chat's own
# configuration paragraph; a case's tasks from before the segment go into
# its "In Hand" lines (in_hand_block); a reminder that came due is a wake
# note in Core's words (reminder_note). Both ports are checked against
# Rust's own output (schedule/rust-samples.json) by the dry test.
SCHED_DIR = HERE / "schedule"
SCHED_CASES = SCHED_DIR / "cases.json"
SCHED_PROMPT = SCHED_DIR / "galley-prompt" / "main_chat.plain.txt"
SCHED_CLI_HELP = SCHED_DIR / "cli-help.json"
SCHED_SAMPLES = SCHED_DIR / "rust-samples.json"
SCHED_JSON = SCHED_DIR / "results.json"
SCHED_MD = SCHED_DIR / "results.md"
SCHED_COMPOSED_DIR = SCHED_DIR / "composed"
SCHED_DUMP_CASES = ("already-set", "wake-late")
SCHED_TOOL_CAP = 10
SCHED_REPEATS = 2
# The wake suite's programs, plus `date`: the manual tells the model to read
# the clock for a time relative to now.
SCHED_EXTRA_EXEC = WAKE_EXTRA_EXEC + ("/bin/date",)
SCHEDULE_WRITES = ("schedule create", "schedule update", "schedule delete", "schedule enable",
                   "schedule disable", "schedule run")
HAND_WRITES = ("session rename", "session pin", "session unpin", "session delete", "project update",
               "project pin", "project unpin", "project archive-sessions", "llm set-default")
# Ticket 41: the user's to-dos (`galley todo`, ticket 40).
TODO_WRITES = ("todo add", "todo update", "todo done", "todo reopen", "todo cancel")
ALL_WRITES = WRITE_COMMANDS + SCHEDULE_WRITES + HAND_WRITES + TODO_WRITES
# The In Hand lines' "as of": the runner started an hour before the
# message (the segment's start).
SCHED_IN_HAND_HOURS_BEFORE = 1

# Ticket 41: the user's to-dos (todo/). The schedule suite's sandbox, fake
# galley (which answers the `todo` family too), prompt, CLI help and Rust
# samples (schedule/, recaptured for the ticket 41 entry layer and ticket
# 39's three-part In Hand), with the case's to-dos in the fake galley and,
# for those noted before the segment, in the In Hand lines.
TODO_DIR = HERE / "todo"
TODO_CASES = TODO_DIR / "cases.json"
TODO_JSON = TODO_DIR / "results.json"
TODO_MD = TODO_DIR / "results.md"
TODO_COMPOSED_DIR = TODO_DIR / "composed"
TODO_DUMP_CASES = ("quote-move", "whats-left", "declined-before")

# Ticket 60: the entry layer's 15 cases (cases.json, ticket 03d) under
# today's main chat prompt, in the to-do suite's sandbox and fake galley,
# to see whether a passing remark gets a to-do or a reminder it should
# not (chat/: each case's expectation; the messages stay in cases.json).
CHAT_DIR = HERE / "chat"
CHAT_CASES = CHAT_DIR / "cases.json"
CHAT_JSON = CHAT_DIR / "results.json"
CHAT_MD = CHAT_DIR / "results.md"

# Ticket 96: the user's memos (memo/). The to-do suite's sandbox, fake
# galley (which answers ticket 95's `memo` family too, from the case's
# memos), prompt (schedule/galley-prompt/, regenerated with a placeholder
# for the "Memo" lines), CLI help and Rust samples; a case's memos from
# before the segment go into the "Memo" lines (memo_block), and a morning
# review that names new memos is Core's wake (review_memos_paragraph).
# Both ports are checked against Rust's own output (rust-samples.json).
MEMO_DIR = HERE / "memo"
MEMO_CASES = MEMO_DIR / "cases.json"
MEMO_JSON = MEMO_DIR / "results.json"
MEMO_MD = MEMO_DIR / "results.md"
MEMO_COMPOSED_DIR = MEMO_DIR / "composed"
MEMO_DUMP_CASES = ("landlord-new-number", "review-interest")
MEMO_WRITES = ("memo add", "memo update", "memo delete")
# api::memo::MEMO_TEXT_MAX_CHARS, MEMO_TOTAL_MAX_CHARS.
MEMO_TEXT_MAX_CHARS, MEMO_TOTAL_MAX_CHARS = 100, 2000
# ga.py NO_BROWSER_CONNECTION_MSG: what GA's browser tools return with no
# browser connected. A memo case with `web: "unavailable"` gets it instead
# of the run stopping at the browser tool (the dry test checks the words
# against ga.py), so a lookup does not end the run before the memo.
NO_BROWSER_CONNECTION_MSG = ("浏览器当前没有连接。若已安装插件，请打开同一个 Chrome / Edge 的网页后重试；"
                             "首次使用请先在 Galley 顶部的浏览器控制入口完成设置。")

# Sandbox mode (dispatch suite, second run): read-only lookups and file
# work are answered for real inside a per-run sandbox instead of ending
# the run. See build_sandbox and the worker's sandbox dispatch.
SANDBOX_TOOL_CAP = 8
SANDBOX_RUN_TIMEOUT_S = 900
# Tools that run for real (in the sandbox); browser tools and ask_user
# end the run; anything else unknown ends it too.
SANDBOX_RUNNABLE = ("code_run", "file_read", "file_write", "file_patch",
                    "update_working_checkpoint", "start_long_term_update")
SANDBOX_STOPS = {"web_scan": "web_tool", "web_execute_js": "web_tool", "ask_user": "ask_user"}
# Fixture files in the fake ~/Downloads: placeholder PDFs (a few bytes each)
# with realistic names, a couple of other files, and two sparse large ones
# (no real disk use) so "files over 1 GB" has an answer.
FIXTURE_PDFS = {
    "发票_阿里云_2026-08.pdf": "Invoice: Alibaba Cloud ECS, August 2026, CNY 1,284.00",
    "发票_阿里云_2026-09.pdf": "Invoice: Alibaba Cloud ECS, September 2026, CNY 1,301.50",
    "Invoice_Figma_2026-09.pdf": "Invoice: Figma Professional, September 2026, USD 15.00",
    "Invoice_GitHub_2026-10.pdf": "Invoice: GitHub Team, October 2026, USD 44.00",
    "增值税电子普通发票_京东_显示器.pdf": "VAT e-invoice: JD.com, monitor, CNY 2,199.00",
    "滴滴出行电子发票_10月.pdf": "Receipt: DiDi rides, October 2026, CNY 186.40",
    "酒店水单_成都_2026-09-21.pdf": "Hotel folio: Chengdu, 2026-09-21 to 2026-09-23",
    "Receipt_Apple_Store_2026-07.pdf": "Receipt: Apple Store, AirPods Pro, CNY 1,899.00",
    "餐饮发票_2026-09-12.pdf": "Receipt: restaurant, team dinner, CNY 860.00",
    "收据_物业费_2026Q3.pdf": "Receipt: property management fee, 2026 Q3",
    "租房合同_2026-2027.pdf": "Lease agreement: apartment, 2026-03 to 2027-02",
    "劳动合同_砚石科技.pdf": "Employment contract: Inkstone Technology",
    "供应商框架合同_华立钢材.pdf": "Framework supply agreement: Huali Steel",
    "保密协议_NDA_东辰.pdf": "Non-disclosure agreement with Dongchen",
    "Service_Agreement_Mingguang_2026.pdf": "Service agreement: Mingguang Materials, 2026",
    "装修合同_补充协议.pdf": "Renovation contract, supplementary agreement",
    "Attention_Is_All_You_Need.pdf": "Paper: Attention Is All You Need (Vaswani et al., 2017)",
    "2410.05229v2.pdf": "Paper: arXiv 2410.05229v2, retrieval-augmented generation survey",
    "Wittgenstein_Tractatus.pdf": "Book: Tractatus Logico-Philosophicus",
    "论文_本地优先软件_Kleppmann.pdf": "Paper: Local-first software (Kleppmann et al., 2019)",
    "CRDT_survey_2018.pdf": "Paper: A survey of CRDTs (2018)",
    "钢材价格指数月报_2026-09.pdf": "Report: steel price index, September 2026",
    "MacBook_Pro_用户手册.pdf": "Manual: MacBook Pro user guide",
    "Sony_WH-1000XM6_Help_Guide.pdf": "Manual: Sony WH-1000XM6 headphones",
    "小米空气净化器_说明书.pdf": "Manual: Xiaomi air purifier",
    "Brother_HL-L2350DW_manual.pdf": "Manual: Brother laser printer",
    "戴森吹风机_使用指南.pdf": "Manual: Dyson hair dryer",
    "护照扫描件.pdf": "Scan: passport",
    "体检报告_2026.pdf": "Report: annual health check, 2026",
    "Q3_周报汇总.pdf": "Report: weekly reports, Q3 2026",
}
FIXTURE_OTHER = {
    "截图 2026-10-10 下午3.12.04.png": b"\x89PNG\r\n\x1a\n placeholder",
    "notes.txt": "买菜；给房东转房租；问供应商报价\n".encode(),
    "钢材报价_上次.xlsx": b"PK\x03\x04 placeholder",
}
FIXTURE_SPARSE = {"Xcode_16.4.xip": 3_400_000_000, "录屏_2026-10-09.mov": 1_300_000_000}
FAKE_GALLEY = '''#!{python}
"""Fake Galley CLI for the entry-layer eval sandbox: canned answers, every
call logged. Not the real CLI; it never touches Galley."""
import json, sys, time
argv = sys.argv[1:]
with open({log!r}, "a", encoding="utf-8") as f:
    f.write(json.dumps({{"at": time.time(), "argv": argv}}, ensure_ascii=False) + "\\n")
words = [a for a in argv if not a.startswith("-")]
def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)
USAGE = {{
    ("sessions", "search"): 'usage: galley sessions search "<query>" [--runtime current|managed|external|all] [--all]',
    ("sessions", "list"): "usage: galley sessions list [--runtime current|managed|external|all] [--all]",
    ("subtask", "start"): 'usage: galley subtask start --parent=<session id> "<what to do>"',
    ("session", "show"): "usage: galley session show <id> [--tail=N] [--around=<messageId>]",
}}
if "--help" in argv or "-h" in argv:
    if tuple(words[:2]) in USAGE:
        print(USAGE[tuple(words[:2])])
        sys.exit(0)
    out({{"schemaVersion": 2, "ok": False, "error": {{"code": "unknown_command",
        "message": "unknown command: " + " ".join(argv)}}}}, 1)
if words[:2] == ["sessions", "search"]:
    out({{"schemaVersion": 2, "ok": True, "result": {{"hits": []}}}})
if words[:2] == ["sessions", "list"]:
    out({{"schemaVersion": 2, "ok": True, "result": {{"sessions": []}}}})
if words[:2] == ["subtask", "start"]:
    print({fake_start})
    sys.exit(0)
if words[:2] == ["session", "show"] and words[2:3] == ["s-sub0001"]:
    out({{"schemaVersion": 2, "ok": True, "result": {{"session": {{"id": "s-sub0001", "status": "running",
        "live": {{"busy": True, "openRun": True}}}}, "messages": []}}}})
out({{"schemaVersion": 2, "ok": False, "error": {{"code": "unknown_command",
    "message": "unknown command: " + " ".join(argv)}}}}, 1)
'''

# The wake suite's fake galley: answers from the run's fixture (sessions,
# transcripts, projects, models; the real CLI's --help texts), keeps a
# little state (sends, archives, moves) so a later read sees them, and
# logs every call. Flags it does not know for a command are refused the
# way the real CLI refuses them (invalid_args, exit 2): `llm set` takes
# no --supervisor. Placeholders are filled by build_sandbox.
FAKE_GALLEY_WAKE = r'''#!__PYTHON__
"""Fake Galley CLI for the wake eval (ticket 30) and the schedule eval
(ticket 36): fixture answers, every call logged. Not the real CLI; it never
touches Galley."""
import datetime as _dt
import json, sys, time
FIXTURE, STATE, LOG, HELP = "__FIXTURE__", "__STATE__", "__LOG__", "__HELP__"
argv = sys.argv[1:]
with open(LOG, "a", encoding="utf-8") as f:
    f.write(json.dumps({"at": time.time(), "argv": argv}, ensure_ascii=False) + "\n")
fx = json.load(open(FIXTURE, encoding="utf-8"))
try:
    state = json.load(open(STATE, encoding="utf-8"))
except (OSError, ValueError):
    state = {"sent": [], "status": {}, "project": {}, "projects": [], "llm": {}}
for key, empty in (("tasks", None), ("todos", None), ("titles", {}), ("pins", {}), ("deleted", []),
                   ("project_edits", {}), ("default_llm", None), ("memos", None), ("memo_events", [])):
    state.setdefault(key, empty)
if state["tasks"] is None:
    state["tasks"] = [dict(t) for t in fx.get("tasks") or []]
if state["todos"] is None:
    state["todos"] = [dict(t) for t in fx.get("todos") or []]
if state["memos"] is None:
    state["memos"] = [dict(m) for m in fx.get("memos") or []]

def save():
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)

def out(*objs):
    for o in objs:
        print(json.dumps(o, ensure_ascii=False))
    save()
    sys.exit(0)

def fail(code, message, exit_code):
    print(json.dumps({"error": code, "message": message}, ensure_ascii=False))
    save()
    sys.exit(exit_code)

VALUE = {"tail", "around", "context", "since", "until", "supervisor", "reason", "to", "project",
         "runtime", "status", "timeout", "poll", "after-turn", "llm", "session", "root-path",
         "icon", "color", "schema", "at", "weekly", "monthly", "time", "target", "prompt", "name",
         "due", "remind-at", "notes", "title", "text"}
words, flags, i = [], {}, 0
while i < len(argv):
    a = argv[i]
    if a.startswith("--") and len(a) > 2:
        k, eq, v = a[2:].partition("=")
        if eq:
            flags[k] = v
        elif k in VALUE and i + 1 < len(argv):
            flags[k] = argv[i + 1]
            i += 1
        else:
            flags[k] = True
    elif a in ("-h", "-V"):
        flags["help" if a == "-h" else "version"] = True
    else:
        words.append(a)
    i += 1

helps = json.load(open(HELP, encoding="utf-8"))
if flags.get("help") or words[:1] == ["help"]:
    key = " ".join(words[1:] if words[:1] == ["help"] else words)
    while key and key not in helps:
        key = " ".join(key.split()[:-1])
    print(helps.get(key, helps[""]), end="")
    sys.exit(0)

ALLOWED = {
    ("sessions", "list"): {"runtime", "project", "status", "archived", "all"},
    ("sessions", "search"): {"runtime", "all", "session"},
    ("session", "brief"): set(), ("session", "watch"): set(),
    ("session", "show"): {"tail", "around", "context", "since", "until"},
    # `--ensure-runner` since ticket 63: the real CLI has it (wake/cli-help.json, recaptured), and the
    # manual's `cli.md` asks for it; without it a send was refused and sent again (ticket 59's eval).
    ("session", "send"): {"supervisor", "reason", "jump", "ensure-runner"},
    ("session", "follow"): {"tail"},
    ("session", "wait"): {"timeout", "poll", "tail", "final-show", "after-turn", "until-idle"},
    ("session", "new"): {"project", "llm", "runtime", "supervisor", "reason"},
    ("session", "btw"): {"supervisor", "reason"},
    ("session", "stop"): {"supervisor", "reason"}, ("session", "archive"): {"supervisor", "reason"},
    ("session", "restore"): {"supervisor", "reason"},
    ("session", "move"): {"to", "supervisor", "reason"},
    ("project", "create"): {"root-path", "enable-workspace", "icon", "color", "supervisor", "reason"},
    ("project", "list"): set(), ("project", "brief"): {"all"}, ("project", "show"): {"tail", "all"},
    ("project", "follow"): {"tail", "all", "until-idle", "final-show"},
    ("project", "delete"): {"supervisor", "reason"},
    ("llm", "list"): {"runtime"}, ("llm", "set"): set(),
    ("status",): set(), ("version",): set(), ("health",): set(),
    # Ticket 34: the schedule family.
    ("schedule", "list"): {"all"}, ("schedule", "show"): set(),
    ("schedule", "create"): {"at", "daily", "weekly", "monthly", "time", "target", "project", "llm",
                             "supervisor", "reason"},
    ("schedule", "update"): {"prompt", "at", "daily", "weekly", "monthly", "time", "target", "project",
                             "llm", "supervisor", "reason"},
    ("schedule", "delete"): {"supervisor", "reason"}, ("schedule", "enable"): {"supervisor", "reason"},
    ("schedule", "disable"): {"supervisor", "reason"}, ("schedule", "run"): {"supervisor", "reason"},
    # Ticket 35: the other hands.
    ("session", "rename"): {"supervisor", "reason"}, ("session", "pin"): {"supervisor", "reason"},
    ("session", "unpin"): {"supervisor", "reason"}, ("session", "delete"): {"supervisor", "reason"},
    ("project", "update"): {"name", "icon", "color", "supervisor", "reason"},
    ("project", "pin"): {"supervisor", "reason"}, ("project", "unpin"): {"supervisor", "reason"},
    ("project", "archive-sessions"): {"supervisor", "reason"},
    ("llm", "set-default"): {"supervisor", "reason"},
    # Ticket 40: the to-dos.
    ("todo", "list"): {"all"}, ("todo", "show"): set(),
    ("todo", "add"): {"notes", "due", "remind-at", "supervisor", "reason"},
    ("todo", "update"): {"title", "notes", "due", "no-due", "remind-at", "no-remind", "supervisor", "reason"},
    ("todo", "done"): {"supervisor", "reason"}, ("todo", "reopen"): {"supervisor", "reason"},
    ("todo", "cancel"): {"supervisor", "reason"},
    # Ticket 95: the memos.
    ("memo", "list"): set(), ("memo", "add"): {"until", "supervisor", "reason"},
    ("memo", "update"): {"text", "until", "no-until", "supervisor", "reason"},
    ("memo", "delete"): {"supervisor", "reason"},
}
cmd = tuple(words[:1]) if words[:1] in (["status"], ["version"], ["health"]) else tuple(words[:2])
rest = words[len(cmd):]
if flags.get("version") and not cmd:
    print("galley 0.6.2")
    sys.exit(0)
if cmd not in ALLOWED:
    fail("invalid_args", "error: unrecognized subcommand '" + " ".join(words) + "'\n\nUsage: galley [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n", 2)
for k in flags:
    if k not in ALLOWED[cmd] and k != "schema":
        fail("invalid_args", "error: unexpected argument '--" + k + "' found\n\nUsage: galley " + " ".join(cmd) + "\n\nFor more information, try '--help'.\n", 2)

sessions = fx["sessions"]

def brief(sid):
    s = dict(sessions[sid])
    if sid in state["status"]:
        s["status"] = state["status"][sid]
    if sid in state["titles"]:
        s["title"] = state["titles"][sid]
    if sid in state["pins"]:
        s["pinned"] = state["pins"][sid]
    if sid in state["project"]:
        if state["project"][sid]:
            s["projectId"] = state["project"][sid]
        else:
            s.pop("projectId", None)
    if sid in state["llm"]:
        s["selectedLlmKey"], s["selectedLlmDisplayName"] = state["llm"][sid]
    live = dict(s.get("live") or {})
    if any(m["sessionId"] == sid for m in state["sent"]):
        live.update(busy=True, openRun=True, agentRunning=True, askPending=False)
    s["live"] = live
    return s

def rows(sid):
    return list(fx["messages"].get(sid, [])) + [m for m in state["sent"] if m["sessionId"] == sid]

def need(n, what):
    if len(rest) < n:
        fail("invalid_args", "error: the following required arguments were not provided:\n  " + what + "\n", 2)

def known(sid):
    if sid not in sessions or sid in state["deleted"]:
        fail("not_found", "session " + sid + " not found", 3)

# ---- schedule (ticket 34), answered from the case's tasks ----
TZ = _dt.timezone(_dt.timedelta(minutes=int(fx.get("tz_minutes") or 0)))
UTC = _dt.timezone.utc

def now_utc():
    return _dt.datetime.now(UTC).replace(microsecond=0)

def iso(t):
    return t.astimezone(UTC).isoformat(timespec="seconds")

def parse_at(v):
    v = str(v).strip()
    if "T" not in v and " " not in v:
        return None
    try:
        t = _dt.datetime.fromisoformat(v[:-1] + "+00:00" if v.endswith("Z") else v)
    except ValueError:
        return None
    return t.replace(tzinfo=TZ) if t.tzinfo is None else t

def hhmm(v):
    try:
        h, m = str(v).split(":")
        if len(m) != 2 or not (0 <= int(h) < 24 and 0 <= int(m) < 60):
            raise ValueError
        return "%02d:%02d" % (int(h), int(m))
    except ValueError:
        fail("invalid_args", "scheduled task: time_of_day must be HH:MM, got " + json.dumps(str(v)), 2)

def day_list(v, top, what):
    try:
        ds = sorted({int(x) for x in str(v).split(",") if x.strip()})
    except ValueError:
        fail("invalid_args", "scheduled task: " + what + " days must be 1..=" + str(top), 2)
    if not ds:
        fail("invalid_args", "scheduled task: " + what + " repeat needs at least one day", 2)
    if any(d < 1 or d > top for d in ds):
        fail("invalid_args", "scheduled task: " + what + " days must be 1..=" + str(top), 2)
    return ds

def next_fire(t):
    if t.get("cancelledAt") or not t.get("enabled", True):
        return None
    kind = t["repeat"]["kind"]
    if kind == "once":
        return None if t.get("lastDueAt") == t["fireAt"] else t["fireAt"]
    h, m = (int(x) for x in t["timeOfDay"].split(":"))
    local = now_utc().astimezone(TZ)
    for add in range(0, 63):
        day = (local + _dt.timedelta(days=add)).replace(hour=h, minute=m, second=0)
        if day <= local:
            continue
        if kind == "weekly" and day.isoweekday() not in t["repeat"]["weekdays"]:
            continue
        if kind == "monthly" and day.day not in t["repeat"]["monthdays"]:
            continue
        return iso(day)
    return None

def task_out(t):
    t = dict(t)
    t.pop("_in_hand", None)
    nf = next_fire(t)
    if nf:
        t["nextFireAt"] = nf
    else:
        t.pop("nextFireAt", None)
    return t

def find_task(tid, live=True):
    for t in state["tasks"]:
        if t["id"] == tid and not (live and t.get("cancelledAt")):
            return t
    fail("not_found", "scheduled task " + tid + " not found", 3)

def origin_of():
    o = {"via": "supervisor", "supervisor": flags["supervisor"]} if flags.get("supervisor") else {"via": "cli"}
    if flags.get("reason"):
        o["reason"] = flags["reason"]
    return o

def apply_rule(t, creating):
    timing = [k for k in ("at", "daily", "weekly", "monthly") if flags.get(k)]
    if creating and not timing:
        fail("invalid_args", "error: the following required arguments were not provided:\n  "
             "<--at <TIME>|--daily|--weekly <DAYS>|--monthly <DAYS>>\n", 2)
    if len(timing) > 1:
        fail("invalid_args", "error: the argument '--" + timing[0] + "' cannot be used with '--" + timing[1] + "'\n", 2)
    if flags.get("at") and flags.get("time"):
        fail("invalid_args", "error: the argument '--at <TIME>' cannot be used with '--time <HH:MM>'\n", 2)
    if flags.get("at"):
        at = parse_at(flags["at"])
        if at is None:
            fail("invalid_args", "scheduled task: fire time must be an RFC 3339 instant or a local "
                 "YYYY-MM-DDTHH:MM, got " + json.dumps(str(flags["at"])), 2)
        if at < now_utc():
            fail("invalid_args", "time_in_past: " + ("create_scheduled_task" if creating else "update_scheduled_task")
                 + ": " + iso(at) + " is in the past (now " + iso(now_utc()) + ")", 2)
        t["repeat"] = {"kind": "once"}
        t["fireAt"] = iso(at)
        t["timeOfDay"] = at.astimezone(TZ).strftime("%H:%M")
    elif timing:
        if not flags.get("time") and (creating or t["repeat"]["kind"] == "once"):
            fail("invalid_args", "scheduled task: a repeating rule needs --time", 2)
        kind = timing[0]
        if kind == "daily":
            t["repeat"] = {"kind": "daily"}
        elif kind == "weekly":
            t["repeat"] = {"kind": "weekly", "weekdays": day_list(flags["weekly"], 7, "weekly")}
        else:
            t["repeat"] = {"kind": "monthly", "monthdays": day_list(flags["monthly"], 31, "monthly")}
        if flags.get("time"):
            t["timeOfDay"] = hhmm(flags["time"])
        t.pop("fireAt", None)
    elif flags.get("time"):
        if t["repeat"]["kind"] == "once":
            fail("invalid_args", "scheduled task: --time needs a repeating rule", 2)
        t["timeOfDay"] = hhmm(flags["time"])
    if "target" in flags:
        if flags["target"] not in ("assistant", "session"):
            fail("invalid_args", "error: invalid value '" + str(flags["target"]) + "' for '--target <TARGET>'\n"
                 "  [possible values: assistant, session]\n", 2)
        t["target"] = flags["target"]
    for k, field in (("project", "projectId"), ("llm", "llmName")):
        if k in flags:
            if flags[k] and flags[k] is not True:
                t[field] = flags[k]
            else:
                t.pop(field, None)
    if t.get("target") == "assistant" and (t.get("projectId") or t.get("llmName")):
        fail("invalid_args", "scheduled task: a task that wakes the assistant takes no project or model", 2)

# ---- to-dos (ticket 40), Core's rules (core/src/db/todo.rs, api/todo.rs) ----
TODO_USAGE = ("Usage: galley todo update <--title <TITLE>|--notes <NOTES>|--due <DATE|TIME>|--no-due|"
              "--remind-at <TIME>|--no-remind> <TODO_ID>")

def value_flag(k, shown):
    """clap's NonEmptyStringValueParser: `--due=` / a bare `--due` is refused."""
    if k in flags and (flags[k] is True or flags[k] == ""):
        fail("invalid_args", "error: a value is required for '--" + k + " <" + shown + ">' but none was "
             "supplied\n\nFor more information, try '--help'.\n", 2)

def text_flag(k):
    return "" if flags.get(k) is True else str(flags.get(k, ""))

def parse_due(v):
    v = str(v).strip()
    if len(v) == 10:
        try:
            return {"dueDate": _dt.date.fromisoformat(v).isoformat()}
        except ValueError:
            pass
    at = parse_at(v)
    if at is None:
        fail("invalid_args", "todo: a due date is a local date YYYY-MM-DD, a local YYYY-MM-DDTHH:MM, or an "
             "RFC 3339 instant, got " + json.dumps(v), 2)
    return {"dueAt": iso(at)}

def future_at(v, context):
    at = parse_at(v)
    if at is None:
        fail("invalid_args", "scheduled task: fire time must be an RFC 3339 instant or a local "
             "YYYY-MM-DDTHH:MM, got " + json.dumps(str(v).strip()), 2)
    if at.replace(microsecond=0) < now_utc():
        fail("invalid_args", "time_in_past: " + context + ": " + iso(at) + " is in the past (now "
             + iso(now_utc()) + ")", 2)
    return at

def once_fired(t):
    return (t["repeat"]["kind"] == "once" and bool(t.get("lastFiredAt")) and bool(t.get("fireAt"))
            and t["lastFiredAt"] >= t["fireAt"])

def reminder_task(todo_id):
    live = [t for t in state["tasks"] if t.get("todoId") == todo_id and not t.get("cancelledAt")]
    return sorted(live, key=lambda t: (t.get("createdAt", ""), t["id"]))[-1] if live else None

def todo_wire(t):
    w = {"id": t["id"], "title": t["title"]}
    if t.get("notes"):
        w["notes"] = t["notes"]
    if t.get("dueAt"):
        local = _dt.datetime.fromisoformat(t["dueAt"]).astimezone(TZ)
        w["due"] = {"date": local.strftime("%Y-%m-%d"), "hasTime": True, "at": t["dueAt"],
                    "time": local.strftime("%H:%M")}
    elif t.get("dueDate"):
        w["due"] = {"date": t["dueDate"], "hasTime": False}
    task = reminder_task(t["id"])
    if task and task.get("fireAt"):
        st = "fired" if once_fired(task) else ("scheduled" if task.get("enabled", True) else "paused")
        w["reminder"] = {"taskId": task["id"], "at": task["fireAt"], "state": st}
    w["status"] = "cancelled" if t.get("cancelledAt") else ("done" if t.get("doneAt") else "open")
    for k in ("doneAt", "doneBy", "origin", "createdIn", "cancelledAt", "cancelledBy", "createdAt", "updatedAt"):
        if t.get(k):
            w[k] = t[k]
    return w

def find_todo(tid, live=True):
    for t in state["todos"]:
        if t["id"] == tid:
            if live and t.get("cancelledAt"):
                fail("not_found", "todo " + tid + " is cancelled", 3)
            return t
    fail("not_found", "todo " + tid + " not found", 3)

def set_reminder(t, at):
    task = reminder_task(t["id"])
    if task:
        task.update(fireAt=iso(at), timeOfDay=at.astimezone(TZ).strftime("%H:%M"), prompt=t["title"],
                    enabled=True, updatedAt=iso(now_utc()))
        task["repeat"] = {"kind": "once"}
        return
    n = sum(1 for x in state["tasks"] if x["id"].startswith("sched_7e4a"))
    state["tasks"].append({
        "id": "sched_7e4a%012x" % (0x5c0000000000 + n), "prompt": t["title"], "repeat": {"kind": "once"},
        "timeOfDay": at.astimezone(TZ).strftime("%H:%M"), "fireAt": iso(at), "target": "assistant",
        "enabled": True, "origin": origin_of(), "todoId": t["id"],
        "createdAt": iso(now_utc()), "updatedAt": iso(now_utc())})

def release_reminder(t):
    """Ticking off or cancelling cancels a reminder that has not reminded the user;
    Core does it on its own (ticket 61: `system`)."""
    task = reminder_task(t["id"])
    if task and (not once_fired(task) or task.get("lastWake") == "pending"):
        task["cancelledAt"] = task["updatedAt"] = iso(now_utc())
        task["cancelledBy"] = {"via": "system"}

def todo_order(rows):
    """assistant_todo::todo_list_order: today (overdue first), later, any time; then done and
    cancelled, newest first."""
    now = now_utc()
    today = now.astimezone(TZ).date()
    head, mid, tail, done, gone = [], [], [], [], []
    for t in rows:
        if t.get("cancelledAt"):
            gone.append(t)
        elif t.get("doneAt"):
            done.append(t)
        elif t.get("dueAt"):
            at = _dt.datetime.fromisoformat(t["dueAt"])
            day, late = at.astimezone(TZ).date(), at < now
            (head if day <= today else mid).append(((not late, at.timestamp(), t["createdAt"], t["id"]), t))
        elif t.get("dueDate"):
            day = _dt.date.fromisoformat(t["dueDate"])
            by = _dt.datetime.combine(day + _dt.timedelta(days=1), _dt.time(), tzinfo=TZ).timestamp()
            (head if day <= today else mid).append(((not day < today, by, t["createdAt"], t["id"]), t))
        else:
            tail.append(((t["createdAt"], t["id"]), t))
    ordered = [t for _, t in sorted(head, key=lambda x: x[0])]
    ordered += [t for _, t in sorted(mid, key=lambda x: x[0][1:])]
    ordered += [t for _, t in sorted(tail, key=lambda x: x[0])]
    ordered += sorted(done, key=lambda t: t["doneAt"], reverse=True)
    ordered += sorted(gone, key=lambda t: t["cancelledAt"], reverse=True)
    return ordered

# ---- memos (ticket 95), Core's rules (core/src/api/memo.rs, db/memo.rs) ----
MEMO_UPDATE_USAGE = "Usage: galley memo update <--text <TEXT>|--until <DATE>|--no-until> <MEMO_ID>"

def memo_today():
    return now_utc().astimezone(TZ).date()

def memo_holds(m):
    return not m.get("until") or m["until"] >= memo_today().isoformat()

def memo_text(raw, context):
    text = str(raw).strip()
    if not 1 <= len(text) <= 100:
        fail("invalid_args", context + ": a memo is 1 to 100 characters once trimmed; this one is " + str(len(text)), 2)
    return text

def memo_until(raw, context):
    import re as _re
    value = str(raw).strip()
    m = _re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", value)
    try:
        day = _dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
    except ValueError:
        day = None
    if day is None:
        fail("invalid_args", context + ": until is a local date YYYY-MM-DD, got " + json.dumps(value, ensure_ascii=False), 2)
    if day < memo_today():
        fail("invalid_args", "time_in_past: " + context + ": until " + day.isoformat() + " is before today ("
             + memo_today().isoformat() + ")", 2)
    return day.isoformat()

def memo_wire(m):
    return {k: v for k, v in m.items() if not k.startswith("_")}

def find_memo(mid):
    for m in state["memos"]:
        if m["id"] == mid:
            return m
    fail("not_found", "memo " + mid + " not found", 3)

def memo_write(m):
    w = {"memo": memo_wire(m)}
    chars = sum(len(x["text"]) for x in state["memos"] if memo_holds(x))
    if chars > 2000:
        w["overLimit"] = {"chars": chars, "limit": 2000, "over": chars - 2000, "message": (
            "Memos now total %d characters, %d over the 2000 the start of each segment holds, so the last ones "
            "noted will be left out of it: merge memos or delete the ones out of date first." % (chars, chars - 2000))}
    return w

def memo_event(action, m):
    """memo_events: each add, update and delete, the text after it (before it, for a delete)."""
    state["memo_events"].append({"action": action, "memoId": m["id"], "text": m["text"], "until": m.get("until"),
                                 "origin": origin_of(), "at": iso(now_utc())})

if cmd == ("sessions", "list"):
    show = [sid for sid in fx["order"]
            if flags.get("all") or (brief(sid)["status"] == "archived") == bool(flags.get("archived"))]
    if flags.get("project"):
        show = [sid for sid in show if brief(sid).get("projectId") == flags["project"]]
    out(*[brief(sid) for sid in show])
if cmd == ("sessions", "search"):
    need(1, "<QUERY>")
    out()
if cmd == ("session", "brief"):
    need(1, "<ID>")
    known(rest[0])
    out(brief(rest[0]))
if cmd == ("session", "show"):
    need(1, "<ID>")
    r = rows(rest[0])
    if flags.get("around"):
        ids = [m["id"] for m in r]
        if flags["around"] not in ids:
            fail("not_found", "message " + str(flags["around"]) + " not found in session " + rest[0], 3)
        n, c = ids.index(flags["around"]), int(flags.get("context") or 10)
        r = r[max(0, n - c): n + c + 1]
    elif flags.get("tail"):
        r = r[-int(flags["tail"]):]
    out(*r)
if cmd == ("session", "send"):
    need(2, "<ID> <CONTENT>")
    known(rest[0])
    sid = rest[0]
    origin = {"via": "supervisor", "supervisor": flags["supervisor"]} if flags.get("supervisor") else {"via": "cli"}
    if flags.get("reason"):
        origin["reason"] = flags["reason"]
    turn = 1 + max([m.get("turnIndex", 0) for m in rows(sid)] or [0])
    msg = {"id": "msg_" + sid + "_" + str(turn) + "_user", "sessionId": sid, "role": "user",
           "content": rest[1], "createdAt": fx["now"], "turnIndex": turn, "origin": origin,
           "visibility": "visible"}
    state["sent"].append(msg)
    out({"message": msg, "dispatch": "dispatched"})
if cmd == ("session", "stop"):
    need(1, "<ID>")
    known(rest[0])
    out({"dispatch": "abort_sent" if brief(rest[0])["live"].get("busy") else "already_stopped"})
if cmd in (("session", "archive"), ("session", "restore")):
    need(1, "<ID>")
    known(rest[0])
    state["status"][rest[0]] = "archived" if cmd[1] == "archive" else "idle"
    out({"session": brief(rest[0])})
if cmd == ("session", "move"):
    need(1, "<ID>")
    known(rest[0])
    to = flags.get("to")
    if to and to not in [p["id"] for p in fx["projects"] + state["projects"]]:
        fail("invalid_args", "project " + str(to) + " does not exist", 2)
    state["project"][rest[0]] = to or None
    out({"session": brief(rest[0])})
if cmd == ("session", "new"):
    need(1, "<TASK>")
    sid = "s-new" + str(len(state["sent"]) + 1).zfill(4)
    out({"session": {"id": sid, "title": "新对话", "status": "idle", "runtimeKind": "managed"},
         "message": {"id": "msg_" + sid + "_0_user", "sessionId": sid, "role": "user", "content": rest[0]},
         "dispatch": "dispatched"})
if cmd == ("session", "btw"):
    need(2, "<ID> <QUESTION>")
    out({"dispatch": "dispatched"})
if cmd == ("session", "wait"):
    need(1, "<ID>")
    known(rest[0])
    tail = rows(rest[0])[-int(flags.get("tail") or 20):]
    out({"schemaVersion": 3, "stream": "wait", "phase": "initial", "session": brief(rest[0]), "messages": tail},
        {"schemaVersion": 3, "stream": "wait", "phase": "final", "status": "completed", "session": brief(rest[0]), "messages": tail},
        {"schemaVersion": 3, "stream": "end", "reason": "completed"})
if cmd == ("session", "follow"):
    need(1, "<ID>")
    known(rest[0])
    tail = rows(rest[0])[-int(flags.get("tail") or 20):]
    out({"schemaVersion": 3, "stream": "snapshot", "phase": "initial", "session": brief(rest[0]), "messages": tail},
        {"schemaVersion": 3, "stream": "end", "reason": "not_live"})
if cmd == ("session", "watch"):
    need(1, "<ID>")
    fail("not_found", "no live runner for session " + rest[0], 3)
if cmd == ("project", "create"):
    need(1, "<NAME>")
    p = {"id": "proj_" + ("5f0c2a9d81e34b6" + str(len(state["projects"])))[:16], "name": rest[0].strip(),
         "workspaceEnabled": False, "pinned": False, "createdAt": fx["now"], "updatedAt": fx["now"]}
    state["projects"].append(p)
    out({"project": p})
if cmd == ("project", "list"):
    out(*(fx["projects"] + state["projects"]))
if cmd in (("project", "brief"), ("project", "show"), ("project", "follow"), ("project", "delete")):
    need(1, "<PROJECT_ID>")
    match = [p for p in fx["projects"] + state["projects"] if p["id"] == rest[0]]
    if not match:
        fail("not_found", "project " + rest[0] + " not found", 3)
    members = [brief(s) for s in fx["order"] if brief(s).get("projectId") == rest[0]]
    if cmd[1] == "delete":
        out({"deleted": rest[0], "detachedSessions": len(members), "sessionIds": [m["id"] for m in members]})
    if cmd[1] == "follow":
        out({"schemaVersion": 3, "stream": "snapshot", "phase": "initial", "project": match[0], "sessions": members},
            {"schemaVersion": 3, "stream": "end", "reason": "idle"})
    out({"project": match[0], "sessions": members})
if cmd == ("llm", "list"):
    out(*fx["models"])
if cmd == ("llm", "set"):
    need(2, "<SESSION_ID> <LLM_NAME>")
    known(rest[0])
    hit = [m for m in fx["models"] if m["name"].lower() == rest[1].lower()]
    if not hit:
        fail("invalid_args", "unknown LLM name: " + rest[1], 2)
    state["llm"][rest[0]] = [hit[0]["key"], hit[0]["name"]]
    out({"session": brief(rest[0]), "dispatch": "persisted_only"})
if cmd == ("schedule", "list"):
    rows = [t for t in state["tasks"]
            if flags.get("all") or (not t.get("cancelledAt") and t.get("enabled", True)
                                    and not (t["repeat"]["kind"] == "once" and not next_fire(t)))]
    rows.sort(key=lambda t: t.get("updatedAt", ""), reverse=True)
    rows.sort(key=lambda t: not t.get("enabled", True))
    out(*[task_out(t) for t in rows])
if cmd == ("schedule", "show"):
    need(1, "<ID>")
    out(task_out(find_task(rest[0], live=False)))
if cmd == ("schedule", "create"):
    need(1, "<PROMPT>")
    if not rest[0].strip():
        fail("invalid_args", "scheduled task: prompt is empty", 2)
    t = {"id": "sched_%016x" % (0x5eed000000000000 + len(state["tasks"])), "prompt": rest[0].strip(),
         "enabled": True, "target": "session", "repeat": {"kind": "once"}}
    apply_rule(t, True)
    t["origin"] = origin_of()
    if flags.get("supervisor") == "galley-assistant":
        t["createdIn"] = {"sessionId": fx["main_chat_id"]}
    t["createdAt"] = t["updatedAt"] = iso(now_utc())
    state["tasks"].append(t)
    out({"task": task_out(t)})
if cmd == ("schedule", "update"):
    need(1, "<ID>")
    t = find_task(rest[0])
    new = json.loads(json.dumps(t))
    if "prompt" in flags:
        if flags["prompt"] is True or not str(flags["prompt"]).strip():
            fail("invalid_args", "scheduled task: prompt is empty", 2)
        new["prompt"] = str(flags["prompt"]).strip()
    apply_rule(new, False)
    new["updatedAt"] = iso(now_utc())
    t.clear()
    t.update(new)
    out({"task": task_out(t)})
if cmd == ("schedule", "delete"):
    need(1, "<ID>")
    t = find_task(rest[0])
    t["cancelledAt"] = t["updatedAt"] = iso(now_utc())
    t["cancelledBy"] = origin_of()
    out({"task": task_out(t)})
if cmd in (("schedule", "enable"), ("schedule", "disable")):
    need(1, "<ID>")
    t = find_task(rest[0])
    t["enabled"] = cmd[1] == "enable"
    t["updatedAt"] = iso(now_utc())
    out({"task": task_out(t)})
if cmd == ("schedule", "run"):
    need(1, "<ID>")
    t = find_task(rest[0])
    t["lastFiredAt"] = iso(now_utc())
    out({"task": task_out(t)})
if cmd == ("todo", "list"):
    rows = [t for t in state["todos"] if flags.get("all") or not (t.get("doneAt") or t.get("cancelledAt"))]
    out(*[todo_wire(t) for t in todo_order(rows)])
if cmd == ("todo", "show"):
    need(1, "<TODO_ID>")
    out(todo_wire(find_todo(rest[0], live=False)))
if cmd == ("todo", "add"):
    need(1, "<TITLE>")
    value_flag("due", "DATE|TIME")
    value_flag("remind-at", "TIME")
    if not rest[0].strip():
        fail("invalid_args", "create_todo: a to-do needs a title", 2)
    due = parse_due(flags["due"]) if "due" in flags else {}
    at = future_at(flags["remind-at"], "create_todo") if "remind-at" in flags else None
    t = {"id": "todo_%016x" % (0x7d0d5eed00000000 + len(state["todos"])), "title": rest[0].strip()}
    if text_flag("notes").strip():
        t["notes"] = text_flag("notes").strip()
    t.update(due)
    t["origin"] = origin_of()
    if flags.get("supervisor") == "galley-assistant":
        t["createdIn"] = {"sessionId": fx["main_chat_id"]}
    t["createdAt"] = t["updatedAt"] = iso(now_utc())
    state["todos"].append(t)
    if at is not None:
        set_reminder(t, at)
    out({"todo": todo_wire(t)})
if cmd == ("todo", "update"):
    changes = [k for k in ("title", "notes", "due", "no-due", "remind-at", "no-remind") if k in flags]
    if not changes:
        fail("invalid_args", "error: the following required arguments were not provided:\n  <--title <TITLE>|"
             "--notes <NOTES>|--due <DATE|TIME>|--no-due|--remind-at <TIME>|--no-remind>\n\n" + TODO_USAGE
             + "\n\nFor more information, try '--help'.\n", 2)
    for a, b, shown in (("due", "no-due", "DATE|TIME"), ("remind-at", "no-remind", "TIME")):
        if a in flags and b in flags:
            fail("invalid_args", "error: the argument '--" + a + " <" + shown + ">' cannot be used with '--" + b
                 + "'\n\n" + TODO_USAGE + "\n\nFor more information, try '--help'.\n", 2)
    value_flag("due", "DATE|TIME")
    value_flag("remind-at", "TIME")
    need(1, "<TODO_ID>")
    t = find_todo(rest[0])
    title = t["title"]
    if "title" in flags:
        title = text_flag("title").strip()
        if not title:
            fail("invalid_args", "update_todo: a to-do needs a title", 2)
    due = parse_due(flags["due"]) if "due" in flags else None
    at = None
    if "remind-at" in flags:
        if t.get("doneAt"):
            fail("invalid_args", "update_todo: todo " + t["id"] + " is done; untick it before giving it a reminder", 2)
        at = future_at(flags["remind-at"], "update_todo")
    renamed = title != t["title"]
    t["title"] = title
    if "notes" in flags:
        t.pop("notes", None)
        if text_flag("notes").strip():
            t["notes"] = text_flag("notes").strip()
    if due is not None or "no-due" in flags:
        t.pop("dueDate", None)
        t.pop("dueAt", None)
        t.update(due or {})
    t["updatedAt"] = iso(now_utc())
    if at is not None:
        set_reminder(t, at)
    elif "no-remind" in flags:
        task = reminder_task(t["id"])
        if task:
            task["cancelledAt"] = task["updatedAt"] = iso(now_utc())
            task["cancelledBy"] = origin_of()
    elif renamed and reminder_task(t["id"]):
        reminder_task(t["id"]).update(prompt=title, updatedAt=iso(now_utc()))
    out({"todo": todo_wire(t)})
if cmd in (("todo", "done"), ("todo", "reopen"), ("todo", "cancel")):
    need(1, "<TODO_ID>")
    t = find_todo(rest[0])
    if cmd[1] == "done" and not t.get("doneAt"):
        t["doneAt"] = t["updatedAt"] = iso(now_utc())
        t["doneBy"] = origin_of()
        release_reminder(t)
    elif cmd[1] == "reopen" and t.get("doneAt"):
        t.pop("doneAt", None)
        t.pop("doneBy", None)
        t["updatedAt"] = iso(now_utc())
    elif cmd[1] == "cancel":
        t["cancelledAt"] = t["updatedAt"] = iso(now_utc())
        t["cancelledBy"] = origin_of()
        release_reminder(t)
    out({"todo": todo_wire(t)})
if cmd == ("memo", "list"):
    out(*[memo_wire(m) for m in state["memos"] if memo_holds(m)])
if cmd == ("memo", "add"):
    need(1, "<TEXT>")
    value_flag("until", "DATE")
    text = memo_text(rest[0], "create_memo")
    until = memo_until(flags["until"], "create_memo") if "until" in flags else None
    m = {"id": "memo_%016x" % (0x3e30a5eed0000000 + len(state["memo_events"])), "text": text}
    if until:
        m["until"] = until
    m["origin"] = origin_of()
    if flags.get("supervisor") == "galley-assistant":
        m["createdIn"] = {"sessionId": fx["main_chat_id"]}
    m["createdAt"] = m["updatedAt"] = iso(now_utc())
    state["memos"].append(m)
    memo_event("add", m)
    out(memo_write(m))
if cmd == ("memo", "update"):
    if not any(k in flags for k in ("text", "until", "no-until")):
        fail("invalid_args", "error: the following required arguments were not provided:\n  <--text <TEXT>|--until <DATE>|"
             "--no-until>\n\n" + MEMO_UPDATE_USAGE + "\n\nFor more information, try '--help'.\n", 2)
    if "until" in flags and "no-until" in flags:
        fail("invalid_args", "error: the argument '--until <DATE>' cannot be used with '--no-until'\n\n" + MEMO_UPDATE_USAGE
             + "\n\nFor more information, try '--help'.\n", 2)
    value_flag("until", "DATE")
    need(1, "<MEMO_ID>")
    m = find_memo(rest[0])
    text = memo_text(text_flag("text"), "update_memo") if "text" in flags else m["text"]
    until = (memo_until(flags["until"], "update_memo") if "until" in flags
             else None if "no-until" in flags else m.get("until"))
    if text == m["text"] and until == m.get("until"):
        # Ticket 98: an update that changes nothing is no write (Core's
        # update_memo): nothing moves, nothing is recorded.
        out(memo_write(m))
    m["text"] = text
    if until:
        m["until"] = until
    else:
        m.pop("until", None)
    m["updatedAt"] = iso(now_utc())
    memo_event("update", m)
    out(memo_write(m))
if cmd == ("memo", "delete"):
    need(1, "<MEMO_ID>")
    m = find_memo(rest[0])
    state["memos"].remove(m)
    memo_event("delete", m)
    out({"memo": memo_wire(m)})
if cmd in (("session", "rename"), ("session", "pin"), ("session", "unpin"), ("session", "delete")):
    need(2 if cmd[1] == "rename" else 1, "<ID> <TITLE>" if cmd[1] == "rename" else "<ID>")
    known(rest[0])
    if sessions[rest[0]].get("mainChat"):
        fail("invalid_args", "main_chat_protected: the main chat cannot be "
             + {"rename": "renamed", "pin": "pinned", "unpin": "unpinned", "delete": "deleted"}[cmd[1]], 2)
    if cmd[1] == "delete":
        state["deleted"].append(rest[0])
        out({"deleted": True, "sessionId": rest[0]})
    if cmd[1] == "rename":
        state["titles"][rest[0]] = rest[1].strip() or "新对话"
    else:
        state["pins"][rest[0]] = cmd[1] == "pin"
    out({"session": brief(rest[0])})
if cmd in (("project", "update"), ("project", "pin"), ("project", "unpin"), ("project", "archive-sessions")):
    need(1, "<PROJECT_ID>")
    match = [p for p in fx["projects"] + state["projects"] if p["id"] == rest[0]]
    if not match:
        fail("not_found", "project " + rest[0] + " not found", 3)
    p = dict(match[0], **state["project_edits"].get(rest[0], {}))
    if cmd[1] == "archive-sessions":
        ids = [s for s in fx["order"] if brief(s).get("projectId") == rest[0] and brief(s)["status"] != "archived"
               and not brief(s).get("pinned") and not brief(s).get("mainChat")]
        for s in ids:
            state["status"][s] = "archived"
        out({"projectId": rest[0], "archivedSessions": len(ids), "archivedSessionIds": ids})
    edit = state["project_edits"].setdefault(rest[0], {})
    if cmd[1] == "update":
        if not any(k in flags for k in ("name", "icon", "color")):
            fail("invalid_args", "project update: give at least one of --name, --icon, --color", 2)
        if "name" in flags:
            if flags["name"] is True or not str(flags["name"]).strip():
                fail("invalid_args", "project name is empty", 2)
            edit["name"] = str(flags["name"]).strip()
        for k in ("icon", "color"):
            if k in flags:
                edit[k] = flags[k] if flags[k] is not True else None
    else:
        edit["pinned"] = cmd[1] == "pin"
    out({"project": dict(match[0], **edit)})
if cmd == ("llm", "set-default"):
    need(1, "<LLM_NAME>")
    hit = [m for m in fx["models"] if m["name"].lower() == rest[0].lower()]
    if not hit:
        fail("invalid_args", "unknown LLM name: " + rest[0], 2)
    changed = hit[0]["index"] != 0 and state["default_llm"] != hit[0]["name"]
    state["default_llm"] = hit[0]["name"]
    out({"llm": dict(hit[0], index=0, isCurrent=True), "changed": changed})
if cmd == ("status",):
    busy = sum(1 for s in fx["order"] if brief(s)["live"].get("busy"))
    out({"total": len(fx["order"]), "running": 0, "waitingInput": 0, "errored": 0, "live": {"busy": busy, "queued": 0}})
if cmd == ("version",):
    out({"galleyVersion": "0.6.2", "schemaVersion": 3})
out({"checks": [{"id": "db_readable", "status": "ok", "detail": "workbench.db"}]})
'''

SUGGESTION_RE = re.compile(r"<next-suggestion>([\s\S]*?)</next-suggestion>")
SUMMARY_RE = re.compile(r"<summary>[\s\S]*?</summary>")
THINKING_RE = re.compile(r"<thinking>[\s\S]*?</thinking>")


def fail(msg: str) -> None:
    print(f"run.py: {msg}", file=sys.stderr)
    sys.exit(2)


def refuse_real_data(path: Path) -> None:
    shown = str(path.resolve())
    if "app.galley" in shown or "Application Support" in shown or "GenericAgent" in shown:
        fail(f"refusing state root {shown}: it looks like real user data")


# ======================================================================
# Prompt composition
# ======================================================================


# Ticket 79 (main chat PRD ruling 127): the Main Chat section a segment
# opens with when it carries turns over, ported from Core's
# `managed_prompt::main_chat_section` (`CARRY_TURNS` from
# `session_runner::carry`). One turn says when it was said, more say when
# the first and the last were. A carried case is the Rust carried-1 template
# with its section rewritten for its number of turns; the dry test checks
# the port byte for byte against Rust's own output
# (schedule/rust-samples.json, `main_chat_section`).
CARRY_TURNS = 10


def main_chat_carried_section(session_id: str, start_turn: str, start_date: str, turns: int,
                              first_said_at: str, last_said_at: str) -> str:
    """`main_chat_section` with `turns` turns carried over."""
    if turns == 1:
        exchanges, said = "1 exchange", f"the last said {last_said_at}"
    else:
        exchanges, said = f"{turns} exchanges", f"said between {first_said_at} and {last_said_at}"
    return ("## Main Chat\n\n"
            f"This conversation is the user's main chat, session `{session_id}`. Your context\n"
            f"holds it from turnIndex {start_turn} on, a segment that began {start_date}, and opens\n"
            f"with {exchanges} from before it, {said}: time has passed\n"
            "since. Anything older is not in your context: when the user refers to it,\n"
            "look it up with the Galley CLI (search, then\n"
            "`session show <id> --around=<messageId>`).")


def carried_template(path: Path, turns: int) -> str:
    """A carried-1 template (placeholders kept) saying `turns` turns, with
    `__FIRST_SAID_AT__` for the first one's time when there are more."""
    if not path.is_file():
        fail(f"missing {path}")
    if not 1 <= turns <= CARRY_TURNS:
        fail(f"a segment carries 1 to {CARRY_TURNS} turns, not {turns}")
    text = path.read_text(encoding="utf-8")
    holes = ("__SESSION_ID__", "__SEGMENT_START_TURN__", "__SEGMENT_START_DATE__")
    one = main_chat_carried_section(*holes, 1, "__LAST_SAID_AT__", "__LAST_SAID_AT__")
    if text.count(one) != 1:
        fail(f"{path.name}: its Main Chat section is not the port's one-turn text")
    return text.replace(one, main_chat_carried_section(*holes, turns, "__FIRST_SAID_AT__", "__LAST_SAID_AT__"))


def said_at_filled(text: str, case: dict[str, Any], now: datetime) -> str:
    """The carried turns' times: the last `hours_ago` before now, the first
    `first_hours_ago` (default: the same)."""
    hours = float(case.get("hours_ago") or 0)
    first = now - timedelta(hours=float(case.get("first_hours_ago", hours) or 0))
    return (text.replace("__FIRST_SAID_AT__", first.strftime("%Y-%m-%d %H:%M"))
            .replace("__LAST_SAID_AT__", (now - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M")))


def galley_runtime_prompt(case: dict[str, Any], variant: str, now: datetime, draft: str) -> str:
    """Galley's main chat runtime prompt for this case, from the text the
    real Rust code produced (galley-prompt/, dumped from
    managed_prompt::compose_main_chat_runtime_prompt with placeholders;
    a carried case's section from the port, carried_template), plus the
    draft entry layer for WITH."""
    history = case.get("history") or []
    carried_turns = sum(1 for m in history if m.get("role") == "user")
    if case.get("carried") and carried_turns:
        template = GALLEY_PROMPT_DIR / "main_chat.carried-1.txt"
        text = carried_template(template, carried_turns)
    else:
        template = GALLEY_PROMPT_DIR / "main_chat.plain.txt"
        if not template.is_file():
            fail(f"missing {template}")
        text = template.read_text(encoding="utf-8")
    text = said_at_filled(
        text.replace("__SESSION_ID__", SESSION_ID)
        .replace("__SEGMENT_START_TURN__", str(SEGMENT_START_TURN))
        .replace("__SEGMENT_START_DATE__", now.strftime("%Y-%m-%d")),
        case, now)
    for placeholder in ("__SESSION_ID__", "__SEGMENT_START_TURN__", "__SEGMENT_START_DATE__",
                        "__FIRST_SAID_AT__", "__LAST_SAID_AT__"):
        if placeholder in text:
            fail(f"unfilled {placeholder} in {template.name}")
    if variant == "with":
        # The section is the end of Galley's runtime prompt; Core joins
        # sections with a blank line.
        text = text.rstrip("\n") + "\n\n" + draft.strip()
    return text


def load_dispatch_clauses() -> dict[str, str]:
    """The English clause text of T / C / P: the ```text block under each
    `## T` / `## C` / `## P` heading of dispatch-clauses.md."""
    text = DISPATCH_CLAUSES.read_text(encoding="utf-8")
    clauses = {m.group(1): m.group(2).strip()
               for m in re.finditer(r"^## ([TCP])\b[^\n]*\n[\s\S]*?```text\n([\s\S]*?)\n```",
                                    text, re.MULTILINE)}
    if sorted(clauses) != sorted(DISPATCH_VARIANTS):
        fail(f"dispatch-clauses.md: found clauses {sorted(clauses)}")
    return clauses


def dispatch_prompt(case: dict[str, Any], variant: str, now: datetime, draft: str,
                    clauses: dict[str, str]) -> str:
    """WITH (draft after `## Main Chat`) plus the variant's clause right
    after the draft."""
    return galley_runtime_prompt(case, "with", now, draft) + "\n\n" + clauses[variant]


WAKE_KEYS = ("header", "done", "done_send_back", "done_capped", "asking", "step_limit", "error",
             "not_started", "footer")


def load_wording() -> dict[str, dict[str, str]]:
    """The wake-note wordings of wake/wording.md: per `## <name>`, the
    ```text block under each `### <key>`."""
    text = WAKE_WORDING.read_text(encoding="utf-8")
    out: dict[str, dict[str, str]] = {}
    for m in re.finditer(r"^## (\S+)\n([\s\S]*?)(?=^## |\Z)", text, re.MULTILINE):
        parts = {k.group(1): k.group(2) for k in re.finditer(
            r"^### (\S+)\n\n```text\n([\s\S]*?)\n```", m.group(2), re.MULTILINE)}
        missing = [k for k in WAKE_KEYS if k not in parts]
        if missing:
            fail(f"wording.md: {m.group(1)} lacks {missing}")
        out[m.group(1)] = parts
    if not out:
        fail("wording.md: no wording found")
    return out


WAKE_DATE_RE = re.compile(r"\{\{(Q[0-2]|W):(ymd|md|mmdd|cn|cnc|en)\}\}")
# Ticket 73: an absolute path in the run's fake HOME (a file a subtask
# hands back), so a case need not name a real path; filled per run.
HOME_MARK = "{{HOME}}"
EN_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def wake_days(now: datetime) -> dict[str, Any]:
    """Ticket 63: the days a wake case's dates are filled with, from the run
    day: Q0 today, Q1 and Q2 the day before and two days before, none before
    this week's Monday (W), so a quote of 「这周」 is this week's whatever day
    the suite runs (it was written for 2026-10-15; run on 10-19, the model
    took the quotes for last week's and sent the subtask back)."""
    today = now.date()
    monday = today - timedelta(days=today.weekday())
    days: dict[str, Any] = {"W": monday}
    for k in range(3):
        days[f"Q{k}"] = max(today - timedelta(days=k), monday)
    return days


def wake_dated(case: dict[str, Any], now: datetime) -> dict[str, Any]:
    """The case with its `{{Q0:ymd}}`-style dates filled (cases.json `_note`),
    keys too (the evidence files are named by date)."""
    days = wake_days(now)

    def words(m: re.Match[str]) -> str:
        d, how = days[m[1]], m[2]
        return {"ymd": d.strftime("%Y-%m-%d"), "md": d.strftime("%m-%d"), "mmdd": d.strftime("%m%d"),
                "cn": f"{d.month} 月 {d.day} 日", "cnc": f"{d.month}月{d.day}日",
                "en": f"{d.day} {EN_MONTHS[d.month - 1]} {d.year}"}[how]

    def fill(v: Any) -> Any:
        if isinstance(v, str):
            return WAKE_DATE_RE.sub(words, v)
        if isinstance(v, list):
            return [fill(x) for x in v]
        if isinstance(v, dict):
            return {fill(k): fill(x) for k, x in v.items()}
        return v

    filled = fill(case)
    # `{{HOME}}` (ticket 73) is the run's fake HOME, filled per run (run_job).
    if "{{" in json.dumps(filled, ensure_ascii=False).replace(HOME_MARK, ""):
        fail(f"{case['id']}: a date left unfilled")
    return filled


def wake_note(case: dict[str, Any], words: dict[str, str]) -> str:
    """The wake message for a case, filled from one wording as ticket 29's
    draft says: the header once, the items in order with a blank line
    between, the footer when there is more than one."""
    subs = {s["id"]: s for s in case["subtasks"]}
    items = []
    for w in case["wake"]:
        s = subs[w["subtask"]]
        send_backs = int(w.get("send_backs") or 0)
        values = {"id": s["id"], "title": s["title"], "round": str(1 + send_backs),
                  "send_backs": str(send_backs), "detail": w.get("detail", ""), "why": w.get("why", ""),
                  "last_text": w.get("last_text", "")}
        kind = w["kind"]
        if kind == "done":
            final = [m for m in s["messages"] if m.get("final")][-1]["content"]
            values["answer"] = final
            tail = words["done_capped"] if send_backs >= 2 else words["done_send_back"]
            template = words["done"] + " " + tail
        elif kind == "asking":
            ask = [m for m in s["messages"] if m.get("ask")][-1]["ask"]
            values["question"] = ask["question"]
            values["options"] = (" Options: " + ", ".join(f'"{c}"' for c in ask["candidates"])
                                 if ask["candidates"] else "")
            template = words["asking"]
        else:
            template = words[kind]
        text = template
        for k, v in values.items():
            text = text.replace("{" + k + "}", v)
        leftover = re.findall(r"\{[a-z_]+\}", text)
        if leftover:
            fail(f"{case['id']}: unfilled {leftover} in {kind}")
        items.append(text)
    parts = [words["header"]] + items + ([words["footer"]] if len(items) > 1 else [])
    return "\n\n".join(parts)


def wake_prompt(now: datetime) -> str:
    """The main chat's runtime prompt with the ticket 30 entry layer, as the
    real Rust code produced it (wake/galley-prompt/), segment facts filled;
    the manual's directory is filled per run (run_job), where the run's
    state root is."""
    text = WAKE_PROMPT.read_text(encoding="utf-8")
    text = (text.replace("__SESSION_ID__", SESSION_ID)
            .replace("__SEGMENT_START_TURN__", str(SEGMENT_START_TURN))
            .replace("__SEGMENT_START_DATE__", now.strftime("%Y-%m-%d")))
    if "__MANUAL_DIR__" not in text:
        fail("wake prompt: no __MANUAL_DIR__ placeholder")
    return text


def wake_fixture(case: dict[str, Any], now: datetime) -> dict[str, Any]:
    """What the fake galley answers for one case: session rows (the main
    chat, the case's subtasks, a conversation of the user's own and one an
    outside agent started), transcripts, projects, models."""
    tz = now.astimezone().strftime("%z")
    tz = tz[:3] + ":" + tz[3:]

    def at(minutes_ago: float) -> str:
        return (now - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S") + tz

    base = {"pinned": False, "hasUnread": False, "runtimeKind": "managed", "runtimeLabel": "Galley",
            "gaRuntimeKind": "managed", "promptProfile": "galley-runtime-v1",
            "selectedLlmKey": DEFAULT_MODEL_ID, "selectedLlmDisplayName": "gpt-6.1-sol"}
    idle = {"runnerAlive": True, "agentRunning": False, "openRun": False, "queuedCount": 0,
            "busy": False, "askPending": False, "lastExit": None}
    sessions: dict[str, Any] = {}
    messages: dict[str, list[dict[str, Any]]] = {}
    sessions[SESSION_ID] = dict(base, id=SESSION_ID, title="Galley", status="idle", mainChat=True,
                                turnCount=SEGMENT_START_TURN + len(case["history"]) // 2 + 1,
                                lastActivityAt=at(0), createdAt=at(60 * 24 * 9), updatedAt=at(0),
                                live=dict(idle, runnerAlive=True, agentRunning=True, openRun=True,
                                          busy=True, lastExit="CURRENT_TASK_DONE"))
    main_rows = []
    for n, m in enumerate(case["history"]):
        turn = SEGMENT_START_TURN + n // 2
        main_rows.append({"id": f"msg_{SESSION_ID}_{turn}_{m['role']}", "sessionId": SESSION_ID,
                          "role": "user" if m["role"] == "user" else "agent", "content": m["content"],
                          "createdAt": at(40 - n), "turnIndex": turn, "visibility": "visible"})
    messages[SESSION_ID] = main_rows
    order = []
    for k, s in enumerate(case["subtasks"]):
        sid = s["id"]
        # Ticket 110: a subtask may say when it ran (the night before the
        # review); by default 35 − 3k minutes ago, its rows up to 1 ago.
        start = float(s.get("started_minutes_ago", 35 - 3 * k))
        end = float(s.get("ended_minutes_ago", 1))
        rows = [{"id": f"msg_{sid}_0_user", "sessionId": sid, "role": "user", "content": s["instructions"],
                 "createdAt": at(start), "turnIndex": 0, "origin": {"via": "subtask"},
                 "visibility": "visible"}]
        for n, m in enumerate(s["messages"], 1):
            turn = int(m.get("turn") or 0)
            row: dict[str, Any] = {"id": f"msg_{sid}_{turn}_{n}", "sessionId": sid,
                                   "role": m["role"], "content": m["content"],
                                   "createdAt": at(start - n * (start - end) / (len(s["messages"]) + 1)),
                                   "turnIndex": turn, "visibility": "visible"}
            if m["role"] == "user":
                row["origin"] = m.get("origin") or {"via": "gui"}
            if m.get("summary"):
                row["summary"] = m["summary"]
            if m.get("final"):
                row["finalAnswer"] = m["content"]
            if m.get("ask"):
                row["askUser"] = m["ask"]
            rows.append(row)
        messages[sid] = rows
        turns = 1 + max(int(m.get("turn") or 0) for m in s["messages"])
        sessions[sid] = dict(base, id=sid, title=s["title"], status="idle", turnCount=turns,
                             lastActivityAt=rows[-1]["createdAt"], createdAt=rows[0]["createdAt"],
                             updatedAt=rows[-1]["createdAt"], hasUnread=True, origin={"via": "subtask"},
                             parentSessionId=SESSION_ID, live=dict(idle, **s.get("live", {})))
        order.append(sid)
    others = [
        ("s-mgc2v8h3-6t1q4n7z", "这周周报：登录 bug 修复进展", {"via": "gui"}, 60 * 5),
        ("s-mgd7k1p9-3x8w2b5m", "MyApp 依赖升级检查",
         {"via": "supervisor", "supervisor": "claude-code", "reason": "user asked for a dependency audit"}, 60 * 26),
    ]
    for sid, title, origin, ago in others:
        sessions[sid] = dict(base, id=sid, title=title, status="idle", turnCount=3, lastActivityAt=at(ago),
                             createdAt=at(ago + 30), updatedAt=at(ago), origin=origin, live=dict(idle))
        if origin["via"] == "gui":
            del sessions[sid]["origin"]
        messages[sid] = []
        order.append(sid)
    order.insert(0, SESSION_ID)
    return {
        "now": at(0),
        "sessions": sessions,
        "messages": messages,
        "order": order,
        "projects": [{"id": "proj_2b7e91c04d5a6f38", "name": "上海出差", "workspaceEnabled": False,
                      "pinned": False, "createdAt": at(60 * 30), "updatedAt": at(60 * 30)}],
        "models": [
            {"index": 0, "name": "gpt-6.1-sol", "key": DEFAULT_MODEL_ID, "displayName": "gpt-6.1-sol",
             "isCurrent": True},
            {"index": 1, "name": "glm-5.3", "key": "mm_1786688624397", "displayName": "glm-5.3",
             "isCurrent": False},
            {"index": 2, "name": "deepseek-flash", "key": "mm_1789025687188", "displayName": "deepseek-flash",
             "isCurrent": False},
        ],
    }


# ----------------------------------------------------------------------
# Schedule suite (ticket 36)
# ----------------------------------------------------------------------

WEEKDAYS_EN = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
OPENING_REMINDER = ("[Galley — not a message from the user] A reminder you set came due. Act on it, then "
                    "reply to the user. Do not mention this note.")
CLOSING_MANY = "Reply once, covering all of them."
# Ticket 73: the morning review (scheduler.rs REVIEW_SUPERVISOR,
# REVIEW_PROMPT; subtask_report.rs OPENING_REVIEW, OPENING_MIXED).
OPENING_REVIEW = ("[Galley — not a message from the user] It is time for the morning review. Act on it as "
                  "below. Do not mention this note.")
OPENING_MIXED = ("[Galley — not a message from the user] Things you are looking after have updates. Act on "
                 "them, then reply to the user. Do not mention this note.")
REVIEW_SUPERVISOR = "galley-review"
REVIEW_PROMPT = ("Morning review: go over what is in hand and move forward what you can without being asked "
                 "(\"The morning review\" in `wake.md`). Galley made this task; when the user asks, pause it with "
                 "`schedule disable`, never `schedule delete`.")
LATE_AFTER_SECS = 120
IN_HAND_MAX_PER_GROUP, IN_HAND_TEXT_CHARS, IN_HAND_AGENT_CHARS = 5, 40, 24
DECLINED_WINDOW_DAYS = 90  # assistant_todo::DECLINED_WINDOW_DAYS (ticket 61)
IN_HAND_STATES = {"running": "working", "asking": "asking a question", "failed": "failed",
                  "step_limit": "paused at the step limit", "stopped": "stopped before it finished",
                  "done": "done"}


def iso_utc(t: datetime) -> str:
    """Core's UTC ISO shape (`instant_to_utc_iso`): `2026-10-20T12:00:00+00:00`."""
    from datetime import timezone

    return t.astimezone(timezone.utc).isoformat(timespec="seconds")


def local_words(t: datetime) -> str:
    """`2026-10-20 20:00 (Tue)`, as subtask_report::local_words writes it."""
    return t.strftime("%Y-%m-%d %H:%M") + f" ({WEEKDAYS_EN[t.weekday()]})"


def lateness_words(secs: int) -> str:
    """subtask_report::lateness_words."""
    def unit(n: int, one: str) -> str:
        return f"1 {one}" if n == 1 else f"{n} {one}s"

    minutes = max(secs, 0) // 60
    days, hours, mins = minutes // 1440, (minutes % 1440) // 60, minutes % 60
    if days == 0 and hours == 0:
        return unit(mins, "minute")
    if days == 0 and mins == 0:
        return unit(hours, "hour")
    if days == 0:
        return f"{unit(hours, 'hour')} {unit(mins, 'minute')}"
    if hours == 0:
        return unit(days, "day")
    return f"{unit(days, 'day')} {unit(hours, 'hour')}"


def due_when_and_act(d: dict[str, Any]) -> tuple[str, str]:
    """subtask_report::due_when_and_act."""
    if d.get("late") is None:
        return f"Planned for {d['due_local']}, local time.", "Act on it now:"
    return (f"Planned for {d['due_local']}, local time; it went off at {d['fired_local']}, {d['late']} late "
            "(the computer was asleep or Galley was closed).",
            f"Act on it now, and say in the reply itself (the user does not see your summary) that it comes "
            f"{d['late']} late:")


def review_paragraph(d: dict[str, Any]) -> str:
    """subtask_report::review_paragraph (ticket 73; ticket 75's wording): the
    morning review."""
    tid = d["task_id"]
    if d.get("late") is None:
        when = f"Planned for {d['due_local']}, local time."
    else:
        when = (f"Planned for {d['due_local']}, local time; it went off at {d['fired_local']}, {d['late']} late "
                "(the computer was asleep or Galley was closed), which you need not mention.")
    return (f"The morning review `{tid}` ({d['rule']}) came due. {when} Galley made this task, not you: once a "
            "day, go over what is in hand. Read \"The morning review\" in `wake.md` in your manual and do as it "
            "says: read `todo list`, `schedule list` and your running subtasks, move forward what you can without "
            "being asked, and start at most two subtasks in all. Speak only when you got something done the user "
            "will want to know, in one message, in your own words, with no fixed heading. If you only started "
            "subtasks, write nothing else for the user and end your reply with exactly <no-reply/>; if you did "
            "nothing, your whole reply is exactly <no-reply/>." + review_memos_paragraph(d.get("memos") or []))


def review_memos_paragraph(memos: list[dict[str, Any]]) -> str:
    """subtask_report::review_memos_paragraph (ticket 95): the memos a morning
    review names (`id`, `text`), after a blank line; nothing without them."""
    if not memos:
        return ""
    out = "\n\nMemos noted or changed since the last review, in turns the user started:"
    for m in memos:
        out += f"\n- `{m['id']}`: {' '.join(str(m['text']).split())}"
    return out + ("\nFor each, ask whether there is something you could get done for the user that they would want "
                  "to know, as \"The morning review\" in `wake.md` says; most need nothing.")


def due_paragraph(d: dict[str, Any]) -> str:
    """subtask_report::due_paragraph, word for word (todo_due_paragraph for a
    reminder on one of the user's to-dos, ticket 39; review_paragraph for
    the morning review, ticket 73)."""
    if d.get("review"):
        return review_paragraph(d)
    tid = d["task_id"]
    when, act = due_when_and_act(d)
    todo = d.get("todo")
    if todo:
        notes = (todo.get("notes") or "").strip()
        body = todo["title"].strip() + ("\n" + notes if notes else "")
        due_line = f"It is due {todo['due']}, local time." if todo.get("due") else "It has no due date."
        # Ticket 63: on the user's list whoever does it; what is of use now.
        return (f"Reminder `{tid}` on the user's to-do `{todo['id']}` came due. {when} The to-do is on the user's "
                f"list, something to do or something coming up they want to hear about:\n<<<\n{body}\n>>>\n"
                f"{due_line} {act} tell the user what is of use to them now, in a sentence or two (not the to-do "
                "read back: ask whether it is done or has happened, or give the next step), look something up "
                "first, or start a subtask. Do not tick it off until they say it is done or has happened. "
                "If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.")
    what = (f"Reminder `{tid}` (one-off) came due." if d["once"]
            else f"Scheduled reminder `{tid}` ({d['rule']}) came due.")
    return (f"{what} {when} What you noted when you set it:\n<<<\n{d['prompt'].strip()}\n>>>\n"
            f"{act} tell the user what is of use to them now, in a sentence or two (not your words read back), "
            "look something up first, or start a subtask. "
            "If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.")


# Ticket 78: a subtask's report in Core's own words (subtask_report.rs
# OPENING, report_paragraph for a run that finished, cut), for a wake that
# carries one beside the morning review. The wake suite fills its notes
# from wake/wording.md's drafts instead.
OPENING_SUBTASK = ("[Galley — not a message from the user] A subtask you started has an update. Act on it, then "
                   "reply to the user. Do not mention this note.")
SEND_BACK_LIMIT = 2
REPORT_TEXT_MAX_CHARS = 3000


def report_cut(text: str, sid: str) -> str:
    """subtask_report::cut: the answer within REPORT_TEXT_MAX_CHARS, and where
    to read all of it."""
    text = text.strip()
    if not text:
        return "(nothing)"
    if len(text) <= REPORT_TEXT_MAX_CHARS:
        return text
    return text[:REPORT_TEXT_MAX_CHARS] + f"\n[… cut for length; all of it: `session show {sid} --tail=1`]"


def done_paragraph(d: dict[str, Any]) -> str:
    """subtask_report::report_paragraph for a subtask that finished
    (ReportOutcome::Done), word for word: `kind` done, `subtask_id`,
    `title`, `send_backs`, `answer`."""
    sid, title, send_backs = d["subtask_id"], d["title"], int(d.get("send_backs") or 0)
    if send_backs >= SEND_BACK_LIMIT:
        nxt = (f"It has been sent back {send_backs} times already: do not send it back again. Tell the user what "
               "it found and what is still missing.")
    else:
        nxt = (f"If something is missing or wrong, send it back with `session send {sid} \"<what is missing>\" "
               "--supervisor=galley-assistant --reason=\"send back\" --ensure-runner` and end your reply with "
               "exactly <no-reply/> and nothing else.")
    return (f"Subtask `{sid}` \"{title}\" (round {send_backs + 1}) finished. Its final answer:\n"
            f"<<<\n{report_cut(d['answer'], sid)}\n>>>\n"
            "Check it against what you asked for in its instructions (its first message: "
            f"`session show {sid} --around=msg_{sid}_0_user`; its last steps: `session show {sid} --tail=40`). "
            "If it holds, tell the user the result in a sentence or two and name the evidence (a confirmation "
            f"number, a file path, a link). {nxt}")


def note_opening(d: dict[str, Any]) -> str:
    """subtask_report::opening's kind of one report."""
    if d.get("kind") == "done":
        return OPENING_SUBTASK
    return OPENING_REVIEW if d.get("review") else OPENING_REMINDER


def reminder_note(dues: list[dict[str, Any]]) -> str:
    """subtask_report::report_text for reminders that came due (and since
    ticket 73 the morning review: its own opening, a mix of kinds opens in
    general; since ticket 78 a subtask that finished, `kind` done, beside
    them)."""
    openings = {note_opening(d) for d in dues}
    parts = [openings.pop() if len(openings) == 1 else OPENING_MIXED]
    parts += [done_paragraph(d) if d.get("kind") == "done" else due_paragraph(d) for d in dues]
    if len(dues) > 1:
        parts.append(CLOSING_MANY)
    return "\n\n".join(parts)


def in_hand_cut(text: str, limit: int) -> str:
    line = " ".join(str(text).split())
    return line if len(line) <= limit else line[:limit] + "…"


def in_hand_time(iso: str, tz: Any) -> str | None:
    """managed_prompt::in_hand_time: an RFC 3339 instant as the wake note writes it."""
    try:
        return local_words(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(tz))
    except ValueError:
        return None


def due_words(due: dict[str, Any], tz: Any) -> str | None:
    """api::todo::StoredDue::words from the wire `due` (TodoDue::stored: `at` when it has one)."""
    if due.get("at"):
        return in_hand_time(due["at"], tz)
    try:
        day = datetime.strptime(due.get("date") or "", "%Y-%m-%d")
    except ValueError:
        return None
    return day.strftime("%Y-%m-%d") + f" ({WEEKDAYS_EN[day.weekday()]})"


def in_hand_block(todo: dict[str, Any], now: datetime, tz: Any,
                  declined: list[dict[str, Any]] | None = None) -> str | None:
    """managed_prompt::in_hand_section (ticket 36, regrouped by ticket 39),
    from the to-do read's JSON shape (AssistantTodo: `yours` {today, later,
    anytime}, `assistant`, `routine`; camelCase items), and since ticket 61
    the follow-ups the user turned down (`declined`, DeclinedFollowUp's
    JSON shape: kind, id, text, cancelledAt, by, reason?) as a fourth group."""
    yours = todo.get("yours") or {}
    mine = (yours.get("today") or []) + (yours.get("later") or []) + (yours.get("anytime") or [])
    on, routine = todo.get("assistant") or [], todo.get("routine") or []
    declined = declined or []
    if not mine and not on and not routine and not declined:
        return None
    readers = ("`todo list`, `schedule list` and `session brief <id>`" if mine
               else "`schedule list` and `session brief <id>`")
    out = [f"### In Hand\n\nAs of {now.astimezone(tz):%Y-%m-%d %H:%M}, local time (it may have changed since: "
           f"{readers} read it now)."]

    def todo_line(it: dict[str, Any]) -> str:
        words = due_words(it["due"], tz) if it.get("due") else None
        facts = [f"due {words}" if words else "no due date"]
        if it.get("overdue"):
            facts.append("overdue")
        rem = it.get("reminder")
        at = in_hand_time(rem["at"], tz) if rem else None
        if rem and at:
            facts.append({"scheduled": f"reminder {at}", "paused": f"reminder {at} (paused)",
                          "fired": f"reminded {at}"}[rem["state"]])
        return f"`{it['id']}` {', '.join(facts)}: {in_hand_cut(it.get('text', ''), IN_HAND_TEXT_CHARS)}"

    def task_line(it: dict[str, Any]) -> str:
        facts = []
        if it.get("at"):
            facts.append(local_words(datetime.fromisoformat(it["at"]).astimezone(tz)))
        kind = (it.get("repeat") or {}).get("kind", "once")
        facts.append({"daily": "daily", "weekly": "weekly", "monthly": "monthly"}.get(kind, "one-off"))
        if it.get("state") == "paused":
            facts.append("paused")
        by = it.get("createdBy")
        if by == "assistant":
            facts.append("set by you")
        elif by == "user":
            facts.append("set by the user")
        elif it.get("agent") == REVIEW_SUPERVISOR:
            # Ticket 73: Galley's own, not an outside agent's.
            facts.append("Galley's morning review, not set by you")
        elif it.get("agent"):
            facts.append("set by the outside agent " + in_hand_cut(it["agent"], IN_HAND_AGENT_CHARS))
        else:
            facts.append("set by an outside agent")
        if it.get("target") == "session":
            facts.append("starts a new conversation")
        return f"`{it['id']}` {', '.join(facts)}: {in_hand_cut(it.get('text', ''), IN_HAND_TEXT_CHARS)}"

    def subtask_line(it: dict[str, Any]) -> str:
        title = in_hand_cut(it.get("text", ""), IN_HAND_TEXT_CHARS) or "(untitled)"
        return f"`{it['id']}` {title}: {IN_HAND_STATES.get(it.get('state', ''), 'waiting')}"

    groups = (("The user's to-dos (not done):", mine, "`todo list`", todo_line),
              ("What you are on (subtasks not finished, then one-off reminders and tasks to come):", on,
               "`sessions list`, `schedule list`",
               lambda it: subtask_line(it) if it.get("kind") == "subtask" else task_line(it)),
              ("Routine (repeating tasks):", routine, "`schedule list`", task_line))
    def declined_line(it: dict[str, Any]) -> str:
        at = in_hand_time(it["cancelledAt"], tz)
        who = "by the user on the desktop" if it["by"] == "user" else "by you at the user's request"
        line = f"`{it['id']}` cancelled {at + ' ' if at else ''}{who}: {in_hand_cut(it.get('text', ''), IN_HAND_TEXT_CHARS)}"
        if it.get("reason") is not None:
            line += f" (reason: {in_hand_cut(it['reason'], IN_HAND_TEXT_CHARS)})"
        return line

    groups += ((f"Follow-ups the user turned down (to-dos and reminders you set that were cancelled on the "
                f"desktop or at their request, last {DECLINED_WINDOW_DAYS} days):", declined,
                "`todo list --all`, `schedule list --all`", declined_line),)
    for title, items, more, line in groups:
        if not items:
            continue
        out.append(f"\n\n{title}")
        out += ["\n- " + line(it) for it in items[:IN_HAND_MAX_PER_GROUP]]
        if len(items) > IN_HAND_MAX_PER_GROUP:
            out.append(f"\n- and {len(items) - IN_HAND_MAX_PER_GROUP} more: {more}")
    return "".join(out)


def declined_items(todos: list[dict[str, Any]], tasks: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """assistant_todo::declined_items (ticket 61): the to-dos (`todo show`
    shape) and tasks (`schedule show` shape) Galley made, cancelled within
    DECLINED_WINDOW_DAYS of `now` by the user at the desktop (`gui`) or by
    Galley at the user's request (`supervisor` + `galley-assistant`), most
    recently cancelled first (the same second: by id), in
    DeclinedFollowUp's JSON shape."""
    since = int(now.timestamp()) - DECLINED_WINDOW_DAYS * 86_400
    picked = []
    for kind, rows, text_key in (("todo", todos, "title"), ("task", tasks, "prompt")):
        for row in rows:
            made, by, at = row.get("origin") or {}, row.get("cancelledBy"), row.get("cancelledAt")
            if made.get("supervisor") != "galley-assistant" or not at or not by:
                continue
            try:
                secs = int(datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp())
            except ValueError:
                continue
            if secs < since:
                continue
            if by.get("via") == "gui":
                who = "user"
            elif by.get("via") == "supervisor" and by.get("supervisor") == "galley-assistant":
                who = "assistant"
            else:
                continue
            item = {"by": who, "cancelledAt": at, "id": row["id"], "kind": kind, "text": row.get(text_key, "")}
            reason = (by.get("reason") or "").strip()
            if reason:
                item["reason"] = reason
            picked.append((secs, item))
    picked.sort(key=lambda x: (-x[0], x[1]["id"]))
    return [item for _, item in picked]


def in_hand_todo(todos: list[dict[str, Any]], tasks: list[dict[str, Any]], at: datetime) -> dict[str, Any]:
    """assistant_todo::build_todo, the groups In Hand reads, from to-dos in
    the `todo show` shape and tasks in the `schedule show` shape as they
    stood at `at` (local, aware). These suites have no subtasks."""
    tz = at.tzinfo
    today_d = at.date()
    today: list[Any] = []
    later: list[Any] = []
    anytime: list[Any] = []
    on: list[dict[str, Any]] = []
    routine: list[dict[str, Any]] = []
    for t in todos:
        if t.get("status", "open") != "open":
            continue
        item: dict[str, Any] = {"kind": "todo", "id": t["id"], "text": t["title"], "state": "open",
                                "createdBy": "assistant"}
        for k in ("notes", "due", "reminder"):
            if t.get(k):
                item[k] = t[k]
        due = t.get("due")
        if not due:
            anytime.append(((t["createdAt"], t["id"]), item))
            continue
        if due.get("at"):
            deadline = datetime.fromisoformat(due["at"]).astimezone(tz)
            day, overdue = deadline.date(), deadline < at
        else:
            day = datetime.strptime(due["date"], "%Y-%m-%d").date()
            deadline = datetime(day.year, day.month, day.day, tzinfo=tz) + timedelta(days=1)
            overdue = day < today_d
        if overdue:
            item["overdue"] = True
        if day <= today_d:
            today.append(((not overdue, deadline.timestamp(), t["createdAt"], t["id"]), item))
        else:
            later.append(((deadline.timestamp(), t["createdAt"], t["id"]), item))
    for task in tasks:
        if task.get("cancelledAt") or task.get("todoId"):
            continue
        once = task["repeat"]["kind"] == "once"
        enabled = task.get("enabled", True)
        origin = task.get("origin") or {}
        # assistant_todo::creator: the desktop's form (or no origin) is the
        # user's, galley-assistant is Galley's, any other label an agent's,
        # the label kept (ticket 73: the review, `system` + galley-review).
        item = {"kind": "task", "id": task["id"], "text": task["prompt"],
                "state": "scheduled" if enabled else "paused",
                "createdBy": ("user" if not origin or origin.get("via") == "gui" else "assistant"
                              if origin.get("supervisor") == "galley-assistant" else "agent"),
                "target": task.get("target", "session"), "repeat": task["repeat"]}
        if item["createdBy"] == "agent" and origin.get("supervisor"):
            item["agent"] = origin["supervisor"]
        when = task.get("nextFireAt") or (task.get("fireAt") if once else None)
        if when and (enabled or once):
            item["at"] = when
        (on if once else routine).append(item)
    key = (lambda it: (it["state"] == "paused", datetime.fromisoformat(it["at"]).timestamp()
                       if it.get("at") else float("inf"), it["id"]))
    return {"yours": {"today": [i for _, i in sorted(today, key=lambda x: x[0])],
                      "later": [i for _, i in sorted(later, key=lambda x: x[0])],
                      "anytime": [i for _, i in sorted(anytime, key=lambda x: x[0])]},
            "assistant": sorted(on, key=key), "routine": sorted(routine, key=key)}


def memo_line(m: dict[str, Any], tz: Any) -> str:
    """managed_prompt::memo_line (ticket 95): `` `memo_…` 2026-10-20: <text> ``,
    with `, until 2026-10-31 (Sat)` for one with a last day; the text on
    one line."""
    facts = []
    try:
        facts.append(datetime.fromisoformat(str(m["updatedAt"]).replace("Z", "+00:00")).astimezone(tz)
                     .strftime("%Y-%m-%d"))
    except (KeyError, ValueError):
        pass
    if m.get("until"):
        try:
            day = datetime.strptime(m["until"], "%Y-%m-%d")
            facts.append(f"until {day:%Y-%m-%d} ({WEEKDAYS_EN[day.weekday()]})")
        except ValueError:
            facts.append(f"until {m['until']}")
    text = " ".join(str(m["text"]).split())
    return f"`{m['id']}` {', '.join(facts)}: {text}" if facts else f"`{m['id']}`: {text}"


def memo_block(memos: list[dict[str, Any]], now: datetime, tz: Any) -> str | None:
    """managed_prompt::memo_section (ticket 95): the memos that hold (`memo
    list`'s shape, in the order they were noted), until the next would take
    their text past MEMO_TOTAL_MAX_CHARS; the rest counted on a last line.
    None without memos (no section)."""
    if not memos:
        return None
    out = (f"### Memo\n\nAs of {now.astimezone(tz):%Y-%m-%d %H:%M}, local time (it may have changed since: `memo list` "
           "reads it now; `memo add`, `memo update` and `memo delete` change it).\n\nWhat you noted about the user, "
           "oldest first, each with the day you last noted or changed it:")
    chars = shown = 0
    for m in memos:
        chars += len(str(m["text"]))
        if chars > MEMO_TOTAL_MAX_CHARS:
            break
        shown += 1
        out += "\n- " + memo_line(m, tz)
    if shown < len(memos):
        out += (f"\n- and {len(memos) - shown} more, past the {MEMO_TOTAL_MAX_CHARS} characters this section holds: "
                "`memo list`")
    return out


def clock_words(case: dict[str, Any], now: datetime) -> tuple[str, datetime]:
    """Ticket 63: the time a case's message names (todo/cases.json `_note`,
    `clock`), the one still far enough ahead when the suite runs, with its
    words. `tonight` takes the first of `hours` at least `lead_minutes`
    ahead (「今晚 9 点」); `afternoon` takes `hour` today when it is that far
    ahead, else tomorrow (「明天下午 3 点」). Ticket 60 ran 「今晚 7 点」 at
    18:48; run in the evening, the plan would be in the past."""
    spec = case["clock"]
    lead = timedelta(minutes=int(spec.get("lead_minutes", 60)))

    def at(day: Any, hour: int) -> datetime:
        return datetime(day.year, day.month, day.day, hour, 0, tzinfo=now.tzinfo)

    today = now.date()
    if spec["kind"] == "tonight":
        for hour in spec["hours"]:
            if at(today, hour) >= now + lead:
                return f"今晚 {hour - 12} 点", at(today, hour)
        fail(f"{case['id']}: run it earlier: no evening hour of {spec['hours']} is {lead} ahead")
    if spec["kind"] == "afternoon":
        hour = int(spec["hour"])
        if at(today, hour) >= now + lead:
            return f"下午 {hour - 12} 点", at(today, hour)
        return f"明天下午 {hour - 12} 点", at(today + timedelta(days=1), hour)
    fail(f"{case['id']}: unknown clock kind {spec['kind']!r}")
    raise AssertionError


def clock_case(case: dict[str, Any], now: datetime) -> dict[str, Any]:
    """The case with `{{clock}}` in its message filled (clock_words) and
    every time spec `{"stated": true, "minutes": k}` in its expectations
    turned into the day and time k minutes from the time named; the same
    for the jobs and for the judge, which both have the run's `now`. A case
    without `clock` is returned as it is."""
    if not case.get("clock"):
        return case
    words, stated = clock_words(case, now)

    def fill(v: Any) -> Any:
        if isinstance(v, dict):
            if v.get("stated"):
                t = stated + timedelta(minutes=int(v.get("minutes", 0)))
                return {"days": (t.date() - now.date()).days, "time": t.strftime("%H:%M")}
            return {k: fill(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fill(x) for x in v]
        return v

    out = dict(case, expect=fill(case["expect"]), stated_at=stated.isoformat(timespec="minutes"))
    out["message"] = case["message"].replace("{{clock}}", words)
    return out


def sched_time(spec: dict[str, Any], now: datetime, started: datetime | None = None) -> datetime:
    """A case's time spec (schedule/cases.json `_note`), local and aware."""
    if spec.get("now"):
        return now
    if "minutes_ago" in spec:
        return now - timedelta(minutes=spec["minutes_ago"])
    if "in_minutes" in spec:
        return now + timedelta(minutes=spec["in_minutes"])
    if "started_plus_minutes" in spec:
        return (started or now) + timedelta(minutes=spec["started_plus_minutes"])
    if "next_weekday" in spec:
        day = now.date() + timedelta(days=1)
        while day.isoweekday() != spec["next_weekday"]:
            day += timedelta(days=1)
    elif "week_after" in spec:
        # Ticket 60: a weekday of next week, the week starting Monday
        # (「下周三」 said on a Monday is nine days off, not two).
        day = now.date() - timedelta(days=now.weekday()) + timedelta(days=6 + int(spec["week_after"]))
    elif "month" in spec:
        # Ticket 60: a day of the year (`day` may be "last"), in the year
        # `year_offset` from now, or else the next one not before today.
        def on(year: int) -> Any:
            last = calendar.monthrange(year, int(spec["month"]))[1]
            return date(year, int(spec["month"]), last if spec["day"] == "last" else int(spec["day"]))

        day = on(now.year + int(spec.get("year_offset", 0)))
        if "year_offset" not in spec and day < now.date():
            day = on(now.year + 1)
    else:
        day = now.date() + timedelta(days=int(spec["days"]))
    h, m = (int(x) for x in spec["time"].split(":"))
    return datetime(day.year, day.month, day.day, h, m, tzinfo=now.tzinfo)


def review_times(t: dict[str, Any], now: datetime) -> tuple[str, datetime, datetime]:
    """Ticket 73: the morning review's time of day (`time`; by default the
    run's own minute, so its wake goes off on time whenever the suite
    runs), the fire it owes now (today's, or yesterday's before that time)
    and its next one."""
    tod = t.get("time") or now.strftime("%H:%M")
    h, m = (int(x) for x in tod.split(":"))
    today = now.replace(hour=h, minute=m, second=0, microsecond=0)
    due = today if today <= now else today - timedelta(days=1)
    return tod, due, due + timedelta(days=1)


def review_task(t: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Ticket 73: the morning review as `schedule show` prints it: daily,
    target assistant, made by Galley (`system` + galley-review) three days
    ago, no turn it was made in; `paused` switches it off, `fired` stamps
    the fire it owes now as pending (its wake is this run's message)."""
    tod, due, nxt = review_times(t, now)
    made = now - timedelta(days=3)
    task: dict[str, Any] = {
        "id": t["id"], "prompt": REVIEW_PROMPT, "repeat": {"kind": "daily"}, "timeOfDay": tod,
        "target": "assistant", "enabled": not t.get("paused"),
        "origin": {"via": "system", "supervisor": REVIEW_SUPERVISOR},
        "createdAt": iso_utc(made), "updatedAt": iso_utc(made),
    }
    if task["enabled"]:
        task["nextFireAt"] = iso_utc(nxt if t.get("fired") or due < now - timedelta(minutes=1) else due)
    if t.get("fired"):
        fired = due + timedelta(minutes=t["fired"].get("late_minutes", 0))
        task.update(lastFiredAt=iso_utc(fired), lastDueAt=iso_utc(due), lastWake="pending")
    return task


def sched_task(t: dict[str, Any], now: datetime) -> dict[str, Any]:
    """One of a case's tasks as `schedule show` prints it (Agent API §5.20)."""
    if t.get("review"):
        return review_task(t, now)
    at = sched_time(t["at"], now)
    mine = t.get("origin", "assistant") == "assistant"
    made = now - timedelta(hours=SCHED_IN_HAND_HOURS_BEFORE + 1) if t.get("in_hand") else now - timedelta(minutes=20)
    task: dict[str, Any] = {
        "id": t["id"], "prompt": t["prompt"], "repeat": {"kind": "once"}, "timeOfDay": at.strftime("%H:%M"),
        "fireAt": iso_utc(at), "target": "assistant", "enabled": True,
        "origin": ({"via": "supervisor", "supervisor": "galley-assistant", "reason": "user mentioned it"}
                   if mine else {"via": "gui"}),
        "createdAt": iso_utc(made), "updatedAt": iso_utc(made),
    }
    if mine:
        task["createdIn"] = {"sessionId": SESSION_ID, "turnIndex": SEGMENT_START_TURN - 3 if t.get("in_hand")
                             else SEGMENT_START_TURN}
    if t.get("fired"):
        fired = at + timedelta(minutes=t["fired"]["late_minutes"])
        task.update(lastFiredAt=iso_utc(fired), lastDueAt=task["fireAt"], lastWake="pending")
    if t.get("cancelled"):
        cancel_before(task, t["cancelled"], now)
    return task


def cancel_before(row: dict[str, Any], spec: dict[str, Any], now: datetime) -> None:
    """Ticket 60: a to-do or task the fake galley starts with already
    cancelled (`cancelled`: days_ago / minutes_ago, `via` gui for the
    user at the desktop, supervisor for Galley at the user's request,
    system for Core taking a reminder along; `reason`), as Core records
    it (ticket 61's cancelledBy). Made a day before it was cancelled."""
    at = now - timedelta(days=spec.get("days_ago", 0), minutes=spec.get("minutes_ago", 0))
    via = spec.get("via", "supervisor")
    by: dict[str, Any] = ({"via": "supervisor", "supervisor": "galley-assistant"} if via == "supervisor"
                          else {"via": via})
    if spec.get("reason"):
        by["reason"] = spec["reason"]
    row["cancelledAt"] = row["updatedAt"] = iso_utc(at)
    row["cancelledBy"] = by
    if datetime.fromisoformat(row["createdAt"]) >= at:
        row["createdAt"] = iso_utc(at - timedelta(days=1))


def sched_day(spec: dict[str, Any], now: datetime) -> str:
    """A case's day spec (`next_weekday` or `days`, no time): `YYYY-MM-DD`."""
    return sched_time(dict(spec, time="00:00"), now).strftime("%Y-%m-%d")


def todo_specs(case: dict[str, Any]) -> list[dict[str, Any]]:
    return case.get("todos") or []


def todo_stored(t: dict[str, Any], now: datetime, k: int) -> dict[str, Any]:
    """One of a case's to-dos (todo/cases.json `_note`) as the fake galley
    keeps it; done since the segment began if `done_since` says so."""
    made = (now - timedelta(hours=SCHED_IN_HAND_HOURS_BEFORE + 1, minutes=k) if t.get("in_hand", True)
            else now - timedelta(minutes=20 - k))
    todo: dict[str, Any] = {"id": t["id"], "title": t["title"]}
    if t.get("notes"):
        todo["notes"] = t["notes"]
    if t.get("due"):
        if t["due"].get("date_only"):
            todo["dueDate"] = sched_day(t["due"], now)
        else:
            todo["dueAt"] = iso_utc(sched_time(t["due"], now))
    todo["origin"] = {"via": "supervisor", "supervisor": "galley-assistant", "reason": "user mentioned it"}
    todo["createdIn"] = {"sessionId": SESSION_ID,
                         "turnIndex": SEGMENT_START_TURN - 3 if t.get("in_hand", True) else SEGMENT_START_TURN}
    # Ticket 110: when it was noted and last changed, hours ago.
    if t.get("created"):
        made = now - timedelta(hours=float(t["created"]["hours_ago"]))
    todo["createdAt"] = todo["updatedAt"] = iso_utc(made)
    if t.get("changed"):
        todo["updatedAt"] = iso_utc(now - timedelta(hours=float(t["changed"]["hours_ago"])))
    if t.get("done_since"):
        done = now - timedelta(minutes=t["done_since"].get("minutes_ago", 30))
        todo["doneAt"] = todo["updatedAt"] = iso_utc(done)
        todo["doneBy"] = {"via": t["done_since"].get("via", "gui")}
    if t.get("cancelled"):
        cancel_before(todo, t["cancelled"], now)
    return todo


def todo_reminder_task(t: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    """A case's to-do's reminder, as `schedule show` prints it."""
    rem = t.get("reminder")
    if not rem:
        return None
    task = sched_task({"id": rem["id"], "prompt": t["title"], "at": rem["at"], "fired": rem.get("fired"),
                       "in_hand": t.get("in_hand", True)}, now)
    task.pop("createdIn", None)
    task["todoId"] = t["id"]
    if t.get("cancelled"):
        # Core takes a cancelled to-do's reminder along (`system`).
        cancel_before(task, dict(t["cancelled"], via="system", reason=None), now)
    return task


def todo_wire_at(todo: dict[str, Any], tasks: list[dict[str, Any]], tz: Any,
                 as_of: datetime | None = None) -> dict[str, Any]:
    """The fake galley's todo_wire, in this process (`todo show`'s shape),
    as it stood at `as_of` (status open, reminder not yet gone off, when
    those came later)."""
    w: dict[str, Any] = {"id": todo["id"], "title": todo["title"]}
    if todo.get("notes"):
        w["notes"] = todo["notes"]
    if todo.get("dueAt"):
        local = datetime.fromisoformat(todo["dueAt"]).astimezone(tz)
        w["due"] = {"date": local.strftime("%Y-%m-%d"), "hasTime": True, "at": todo["dueAt"],
                    "time": local.strftime("%H:%M")}
    elif todo.get("dueDate"):
        w["due"] = {"date": todo["dueDate"], "hasTime": False}
    task = next((x for x in tasks if x.get("todoId") == todo["id"] and not x.get("cancelledAt")), None)
    if task:
        fired = bool(task.get("lastFiredAt")) and task["lastFiredAt"] >= task["fireAt"]
        if fired and as_of is not None and datetime.fromisoformat(task["lastFiredAt"]) > as_of:
            fired = False
        w["reminder"] = {"taskId": task["id"], "at": task["fireAt"],
                         "state": "fired" if fired else "scheduled" if task.get("enabled", True) else "paused"}
    done = todo.get("doneAt") and (as_of is None or datetime.fromisoformat(todo["doneAt"]) <= as_of)
    gone = todo.get("cancelledAt") and (as_of is None or datetime.fromisoformat(todo["cancelledAt"]) <= as_of)
    w["status"] = "cancelled" if gone else "done" if done else "open"
    w["createdAt"] = todo["createdAt"]
    return w


def memo_specs(case: dict[str, Any]) -> list[dict[str, Any]]:
    return case.get("memos") or []


def memo_stored(m: dict[str, Any], now: datetime, k: int) -> dict[str, Any]:
    """One of a case's memos (memo/cases.json `_note`) as `memo list` prints
    it: noted by Galley in the main chat `days_ago` days before now (default
    3, a few minutes apart in the case's order), `until` a day spec."""
    made = now - timedelta(days=float(m.get("days_ago", 3)), minutes=30 - k)
    w: dict[str, Any] = {"id": m["id"], "text": m["text"]}
    if m.get("until"):
        w["until"] = sched_day(m["until"], now)
    w["origin"] = {"via": "supervisor", "supervisor": "galley-assistant", "reason": "user mentioned it"}
    w["createdIn"] = {"sessionId": SESSION_ID, "turnIndex": SEGMENT_START_TURN - 3}
    w["createdAt"] = w["updatedAt"] = iso_utc(made)
    return w


def sched_memo_lines(case: dict[str, Any], now: datetime) -> str | None:
    """The case's "Memo" lines: its memos from before the segment (all of
    them unless `in_lines` is false) that hold then, in the order they were
    noted, read an hour before the message, as In Hand is
    (SqliteGalley::memos_today, then memo_section)."""
    as_of = now - timedelta(hours=SCHED_IN_HAND_HOURS_BEFORE)
    today = as_of.date().isoformat()
    memos = [memo_stored(m, now, k) for k, m in enumerate(memo_specs(case)) if m.get("in_lines", True)]
    memos = sorted((m for m in memos if not m.get("until") or m["until"] >= today), key=lambda m: m["createdAt"])
    return memo_block(memos, as_of, now.tzinfo)


def sched_in_hand(case: dict[str, Any], now: datetime) -> str | None:
    """The case's In Hand lines: its to-dos and tasks from before the
    segment, grouped and ordered as the to-do read does it, read an hour
    before the message."""
    as_of = now - timedelta(hours=SCHED_IN_HAND_HOURS_BEFORE)
    tasks = [sched_task(t, now) for t in case.get("tasks") or [] if t.get("in_hand") and not t.get("fired")]
    # Ticket 73: the morning review is a routine, in In Hand whether or
    # not it fired since; as of the snapshot, its next fire is the one it
    # owes now.
    for t in case.get("tasks") or []:
        if t.get("review") and t.get("in_hand", True) and t.get("fired"):
            row = review_task(t, now)
            row["nextFireAt"] = row["lastDueAt"]
            tasks.append(row)
    reminders = [r for r in (todo_reminder_task(t, now) for t in todo_specs(case)) if r]
    todos = [todo_wire_at(todo_stored(t, now, k), reminders, now.tzinfo, as_of)
             for k, t in enumerate(todo_specs(case)) if t.get("in_hand", True)]
    # Ticket 61: the follow-ups turned down, from every to-do and task the
    # fake galley starts with, cancelled by the time of the snapshot
    # (ticket 60's declined-before cases start with one).
    declined = [d for d in declined_items([todo_stored(t, now, k) for k, t in enumerate(todo_specs(case))],
                                          [sched_task(t, now) for t in case.get("tasks") or []] + reminders, as_of)
                if datetime.fromisoformat(d["cancelledAt"].replace("Z", "+00:00")) <= as_of]
    return in_hand_block(in_hand_todo(todos, tasks, as_of), as_of, now.tzinfo, declined)


def sched_prompt(case: dict[str, Any], now: datetime) -> str:
    """The main chat prompt as the real Rust code composed it
    (schedule/galley-prompt/, with placeholders), segment facts and the
    case's In Hand lines filled; the manual's directory is filled per run."""
    turns = sum(1 for m in case.get("history") or [] if m.get("role") == "user")
    if case.get("carried") and turns:
        # Ticket 60's chat cases: turns carried over from before the
        # segment, as the real Rust code writes it (main_chat.carried-1,
        # its section for N turns from the port since ticket 79).
        text = said_at_filled(carried_template(SCHED_PROMPT.with_name("main_chat.carried-1.txt"), turns),
                              case, now)
    else:
        text = SCHED_PROMPT.read_text(encoding="utf-8")
    text = (text.replace("__SESSION_ID__", SESSION_ID)
            .replace("__SEGMENT_START_TURN__", str(SEGMENT_START_TURN))
            .replace("__SEGMENT_START_DATE__", now.strftime("%Y-%m-%d")))
    if (text.count("\n\n__IN_HAND__") != 1 or text.count("\n\n__MEMO__") != 1
            or "__MANUAL_DIR__" not in text):
        fail("schedule prompt: placeholders missing")
    lines = sched_in_hand(case, now)
    text = text.replace("\n\n__IN_HAND__", "\n\n" + lines if lines else "")
    # Ticket 96: the "Memo" lines after In Hand (or after Main Chat without
    # it), none without memos, as Core composes them.
    memo = sched_memo_lines(case, now)
    return text.replace("\n\n__MEMO__", "\n\n" + memo if memo else "")


def sched_note(case: dict[str, Any], now: datetime) -> str:
    """The wake note for the case's reminders that came due (ticket 78: and
    for a subtask of the case's that finished, `{"kind": "done", "subtask":
    <id>, "send_backs": n}` in `wake`, its answer the last `final` of its
    messages), in the order `wake` lists them."""
    dues = []
    for tid in case["wake"]:
        if isinstance(tid, dict):
            s = next(x for x in case.get("subtasks") or [] if x["id"] == tid["subtask"])
            final = [m for m in s["messages"] if m.get("final")][-1]["content"]
            dues.append({"kind": "done", "subtask_id": s["id"], "title": s["title"],
                         "send_backs": int(tid.get("send_backs") or 0), "answer": final})
            continue
        t = next((x for x in case.get("tasks") or [] if x["id"] == tid), None)
        todo = None
        if t is not None and t.get("review"):
            # Ticket 73: the morning review, Core's own words for it.
            tod, due, _ = review_times(t, now)
            fired = due + timedelta(minutes=t["fired"].get("late_minutes", 0))
            late = int((fired - due).total_seconds())
            # Ticket 96: the memos new since the last review it names
            # (`memos`: ids of the case's memos), in Core's words.
            named = [{"id": m["id"], "text": m["text"]} for mid in t.get("memos") or []
                     for m in memo_specs(case) if m["id"] == mid]
            dues.append({"task_id": tid, "prompt": REVIEW_PROMPT, "once": False, "review": True,
                         "rule": f"every day at {tod}", "due_local": local_words(due),
                         "fired_local": local_words(fired),
                         "late": lateness_words(late) if late >= LATE_AFTER_SECS else None, "todo": None,
                         "memos": named})
            continue
        if t is None:
            k, spec = next((k, x) for k, x in enumerate(todo_specs(case)) if (x.get("reminder") or {}).get("id") == tid)
            t = dict(spec["reminder"], prompt=spec["title"])
            stored = todo_stored(spec, now, k)
            wire = todo_wire_at(stored, [], now.tzinfo)
            todo = {"id": spec["id"], "title": spec["title"], "notes": spec.get("notes"),
                    "due": due_words(wire["due"], now.tzinfo) if wire.get("due") else None}
        due = sched_time(t["at"], now)
        fired = due + timedelta(minutes=t["fired"]["late_minutes"])
        late = int((fired - due).total_seconds())
        dues.append({"task_id": tid, "prompt": t["prompt"], "once": True, "rule": "one-off",
                     "due_local": local_words(due), "fired_local": local_words(fired),
                     "late": lateness_words(late) if late >= LATE_AFTER_SECS else None, "todo": todo})
    return reminder_note(dues)


def sched_fixture(case: dict[str, Any], now: datetime) -> dict[str, Any]:
    """The wake suite's fixture (main chat, a conversation of the user's,
    one an outside agent started, the case's history; since ticket 78 the
    case's subtasks, in the wake suite's shape) plus the case's tasks and
    this machine's offset for local times."""
    fx = wake_fixture(dict(case, subtasks=case.get("subtasks") or []), now)
    fx["tasks"] = [sched_task(t, now) for t in case.get("tasks") or []]
    fx["tasks"] += [r for r in (todo_reminder_task(t, now) for t in todo_specs(case)) if r]
    fx["todos"] = [todo_stored(t, now, k) for k, t in enumerate(todo_specs(case))]
    fx["memos"] = [memo_stored(m, now, k) for k, m in enumerate(memo_specs(case))]
    fx["tz_minutes"] = int(now.utcoffset().total_seconds() // 60) if now.utcoffset() else 0
    fx["main_chat_id"] = SESSION_ID
    return fx


def read_galley_log(path: str) -> list[dict[str, Any]]:
    """The fake galley's invocation log (JSON lines); unreadable lines are
    kept as text."""
    out: list[dict[str, Any]] = []
    try:
        with REAL_OPEN(path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        out.append({"raw": line.rstrip("\n")})
    except FileNotFoundError:
        pass
    return out


def subtask_start_args(argv: list[str]) -> dict[str, Any] | None:
    """`subtask start [--parent=<id> | --parent <id>] [--flags] "<task>"`
    as the fake galley received it: the parent and the task argument.
    A help request (`--help` / `-h`) is a lookup, not a start."""
    if "--help" in argv or "-h" in argv:
        return None
    for i in range(len(argv) - 1):
        if argv[i] == "subtask" and argv[i + 1] == "start":
            parent, task, j = None, None, i + 2
            while j < len(argv):
                a = argv[j]
                if a.startswith("--parent="):
                    parent = a.split("=", 1)[1]
                elif a == "--parent" and j + 1 < len(argv):
                    parent = argv[j + 1]
                    j += 1
                elif not a.startswith("--") and task is None:
                    task = a
                j += 1
            return {"parent": parent, "task": task}
    return None


def cli_brief(command: str | None) -> str | None:
    """The task argument of `… subtask start [--flags] "<task>"` in a shell
    script, or None when it cannot be read that way (e.g. Python code)."""
    if not command:
        return None
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        return None
    for i in range(len(tokens) - 1):
        if tokens[i].endswith("subtask") and tokens[i + 1] == "start":
            j = i + 2
            while j < len(tokens):
                tok = tokens[j]
                if tok in ("--parent", "--title", "--cwd"):
                    j += 2
                elif tok.startswith("--"):
                    j += 1
                elif tok in (";", "&&", "||", "|", "&", ">", ">>", "<", "(", ")"):
                    return None
                else:
                    return tok
    return None


# ======================================================================
# Model configuration (read-only)
# ======================================================================


def model_from_galley_db(db_path: Path, model_id: str) -> dict[str, Any]:
    """One managed model as Core hands it to the runner
    (runner_commands::prepare_managed_runtime_context ->
    GALLEY_MANAGED_MODEL_CONFIG_JSON), read from Galley's database opened
    read-only and immutable (`mode=ro&immutable=1`: nothing is written,
    not even a lock or a WAL index; since ticket 36, instead of a temp
    copy). Advanced options are merged like
    managed_model_layers::effective_advanced_options (preset, then the
    defaults pref, then the model's overrides with null as a tombstone).
    The API key is decrypted like credential_store::get_secret
    (AES-256-GCM, AAD = api_key_ref) and kept in memory only."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        fail("reading the key from Galley's database needs the `cryptography` package; "
             "run with an interpreter that has it, or use --mykey")
    if not db_path.is_file():
        fail(f"Galley database not found: {db_path}")
    from urllib.parse import quote

    query = ("SELECT m.display_name, p.protocol, p.auth_kind, p.api_base, m.model, "
             "p.api_key_ref, m.preset_options, m.advanced_options "
             "FROM managed_models m JOIN managed_model_providers p ON p.id = m.provider_id "
             "WHERE m.id = ?")
    con = sqlite3.connect(f"file:{quote(str(db_path))}?mode=ro&immutable=1", uri=True)
    row = con.execute(query, (model_id,)).fetchone()
    if row is None:
        # Ticket 73: `immutable` reads the main file only, not the WAL, so a
        # model added since Core's last checkpoint is not there yet (JC's
        # new gpt-6.1-sol entry was not). Then read it again plain
        # read-only (`mode=ro`): no write to the database, only the shared
        # read marks every reader keeps in the -shm file.
        con.close()
        con = sqlite3.connect(f"file:{quote(str(db_path))}?mode=ro", uri=True)
        row = con.execute(query, (model_id,)).fetchone()
    try:
        if row is None:
            fail(f"managed model {model_id} not found")
        display, protocol, auth_kind, api_base, model, key_ref, preset, overrides = row
        pref = con.execute(
            "SELECT value FROM prefs WHERE key = 'managed_model_defaults'"
        ).fetchone()
        defaults = json.loads(pref[0]) if pref else {}
        if not isinstance(defaults, dict):
            defaults = {}
        options: dict[str, Any] = {}
        for layer in (json.loads(preset or "{}"), defaults):
            if isinstance(layer, dict):
                options.update(layer)
        for k, v in (json.loads(overrides or "{}") or {}).items():
            if v is None:
                options.pop(k, None)
            else:
                options[k] = v
        api_key = ""
        if auth_kind == "api_key":
            secret = con.execute(
                "SELECT s.nonce, s.ciphertext, s.algorithm, s.encryption_version, k.key_material "
                "FROM managed_model_secrets s JOIN managed_model_secret_keys k ON k.key_id = s.key_id "
                "WHERE s.api_key_ref = ?",
                (key_ref,),
            ).fetchone()
            if secret is None:
                fail(f"no stored credential for {model_id}")
            nonce, ciphertext, algorithm, version, key_material = secret
            if algorithm != "aes-256-gcm" or version != 1:
                fail("unsupported credential encryption")
            api_key = AESGCM(bytes(key_material)).decrypt(
                bytes(nonce), bytes(ciphertext), key_ref.encode()
            ).decode("utf-8")
        elif auth_kind != "none":
            fail(f"auth kind {auth_kind} is not supported here (needs Core's credential IPC)")
    finally:
        con.close()
    return {
        "displayName": display,
        "protocol": protocol,
        "authKind": auth_kind,
        "apiBase": api_base,
        "model": model,
        "apiKey": api_key,
        "advancedOptions": options,
    }


def ga_mykeys_from_galley_model(model: dict[str, Any]) -> dict[str, Any]:
    """The GA mykey entries the runner builds from that config
    (runner.managed_runtime.managed_model_config_from_env, called as is)."""
    sys.path.insert(0, str(REPO))
    from runner import managed_runtime  # noqa: E402

    name = managed_runtime.GALLEY_MANAGED_MODEL_CONFIG_ENV
    os.environ[name] = json.dumps({"schemaVersion": 1, "models": [model]}, ensure_ascii=False)
    try:
        return managed_runtime.managed_model_config_from_env()
    finally:
        os.environ.pop(name, None)


def ga_mykeys_from_mykey_file(path: Path, entry: str) -> dict[str, Any]:
    """Fallback: one entry of a GA mykey.py, loaded read-only."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("eval_mykey", path)
    if spec is None or spec.loader is None:
        fail(f"cannot load {path}")
    sys.dont_write_bytecode = True
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfg = getattr(mod, entry, None)
    if not isinstance(cfg, dict):
        fail(f"{entry} is not a config dict in {path}")
    return {entry: dict(cfg)}


def scrub(text: str) -> str:
    """Committed files name no machine-specific path: the system temp
    directory (sandbox and state roots live under it) becomes $TMPDIR, and
    the interpreter the workers run on (ticket 41) $PYTHON, its install
    root $PYTHON_ROOT."""
    tmp = tempfile.gettempdir().rstrip("/")
    prefixes = {tmp, os.path.realpath(tmp)}
    prefixes |= {p[len("/private"):] for p in prefixes if p.startswith("/private/")}
    prefixes |= {"/private" + p for p in prefixes if p.startswith("/var/")}
    for prefix in sorted(prefixes, key=len, reverse=True):
        text = text.replace(prefix, "$TMPDIR")
    exes = {sys.executable, os.path.realpath(sys.executable)}
    for exe in sorted(exes, key=len, reverse=True):
        text = text.replace(exe, "$PYTHON")
    roots = {str(Path(e).parents[1]) for e in exes if len(Path(e).parents) > 2}
    for root in sorted(roots, key=len, reverse=True):
        if root.count("/") >= 3:
            text = text.replace(root + "/", "$PYTHON_ROOT/")
    return text


def describe_mykeys(mykeys: dict[str, Any]) -> dict[str, Any]:
    """What results.json may say about the model: no key, and no API host
    (the results are committed to an open-source repo)."""
    (key, cfg), = mykeys.items()
    return {
        "ga_config_key": key,
        "name": cfg.get("name"),
        "model": cfg.get("model"),
        "options": {k: v for k, v in cfg.items() if k not in ("apikey", "apibase", "name", "model")
                    and not k.startswith("galley_")},
    }


# ======================================================================
# Worker: one run in its own process
# ======================================================================

BLOCKED: list[str] = []
REFUSED: list[str] = []
REAL_OPEN = builtins.open
# Sandbox mode only. While GA runs a tool for real: reads are confined
# too (IO_GUARD), and code_run may start its interpreter, wrapped in
# sandbox-exec with the sandbox's environment (SANDBOX_EXEC).
IO_GUARD: dict[str, Any] = {"tool_active": False, "read_roots": ()}
SANDBOX_EXEC: dict[str, Any] = {"active": False, "profile": None, "env": None, "root": None,
                                "launched": [], "spawning": False}


def under(path: str, roots: tuple[str, ...]) -> bool:
    return any(path == r.rstrip(os.sep) or path.startswith(r) for r in roots)


def install_guards(write_roots: list[str], allowed_hosts: set[str]) -> None:
    """Defense in depth around the dispatch interception: this process may
    not start programs, open a browser, reach any host but the model API,
    connect to a local socket (Galley Core), or write outside its temp
    directories. Any attempt is recorded and raises. In sandbox mode the
    one exception is code_run's interpreter, started only through
    sandbox-exec with the run's profile (see GuardedPopen below)."""
    import socket
    import webbrowser

    def blocked(name: str, real: Any = None) -> Any:
        def deny(*a: Any, **k: Any) -> Any:
            if real is not None and SANDBOX_EXEC["spawning"]:
                return real(*a, **k)  # subprocess's own spawn, inside GuardedPopen
            BLOCKED.append(name)
            raise PermissionError(f"entry-layer eval: {name} is blocked")
        return deny

    real_popen = subprocess.Popen

    class GuardedPopen(real_popen):  # type: ignore[misc,valid-type]
        def __init__(self, args: Any, *a: Any, **k: Any) -> None:
            if not SANDBOX_EXEC["active"]:
                BLOCKED.append("subprocess.Popen")
                raise PermissionError("entry-layer eval: subprocess is blocked")
            root = SANDBOX_EXEC["root"]
            cwd = os.path.realpath(k.get("cwd") or os.getcwd())
            if not under(cwd, (root + os.sep,)):
                raise PermissionError(f"[Errno 1] Operation not permitted: '{k.get('cwd')}'")
            if k.get("shell") or isinstance(args, (str, bytes)):
                raise PermissionError("entry-layer eval: shell strings are not started")
            argv = [os.fspath(x) for x in args]
            SANDBOX_EXEC["launched"].append(argv)
            k["env"] = dict(SANDBOX_EXEC["env"])
            k.pop("executable", None)
            SANDBOX_EXEC["spawning"] = True
            try:
                super().__init__(["/usr/bin/sandbox-exec", "-f", SANDBOX_EXEC["profile"], *argv], *a, **k)
            finally:
                SANDBOX_EXEC["spawning"] = False

    subprocess.Popen = GuardedPopen  # type: ignore[misc,assignment]
    for name in ("system", "popen", "fork", "forkpty", "execv", "execve", "execl", "execle",
                 "execlp", "execlpe", "execvp", "execvpe", "spawnv", "spawnve", "spawnl",
                 "spawnle", "spawnlp", "spawnlpe", "spawnvp", "spawnvpe", "posix_spawn",
                 "posix_spawnp", "startfile"):
        if hasattr(os, name):
            real = getattr(os, name) if name in ("posix_spawn", "posix_spawnp") else None
            setattr(os, name, blocked(f"os.{name}", real))
    webbrowser.open = blocked("webbrowser.open")  # type: ignore[assignment]
    webbrowser.open_new_tab = blocked("webbrowser.open_new_tab")  # type: ignore[assignment]

    real_getaddrinfo = socket.getaddrinfo

    def getaddrinfo(host: Any, *a: Any, **k: Any) -> Any:
        h = host.decode() if isinstance(host, bytes) else str(host)
        if h not in allowed_hosts:
            BLOCKED.append(f"dns:{h}")
            raise OSError(f"entry-layer eval: host {h} is blocked")
        return real_getaddrinfo(host, *a, **k)

    socket.getaddrinfo = getaddrinfo  # type: ignore[assignment]
    real_connect = socket.socket.connect

    def connect(self: socket.socket, address: Any) -> Any:
        if self.family == getattr(socket, "AF_UNIX", None):
            BLOCKED.append(f"unix:{address}")
            raise PermissionError("entry-layer eval: local sockets are blocked")
        return real_connect(self, address)

    socket.socket.connect = connect  # type: ignore[method-assign]

    roots = tuple(os.path.realpath(r) + os.sep for r in write_roots)
    real_open = builtins.open

    def guarded_open(file: Any, mode: str = "r", *a: Any, **k: Any) -> Any:
        if isinstance(file, (str, bytes, os.PathLike)):
            path = os.path.realpath(os.fsdecode(file))
            writing = any(c in mode for c in "wax+")
            if (writing and not under(path, roots)) or (
                    IO_GUARD["tool_active"] and not under(path, IO_GUARD["read_roots"])):
                # A tool the model called was refused (sandbox mode): data,
                # not a harness leak. Anything else is a leak attempt.
                (REFUSED if IO_GUARD["tool_active"] else BLOCKED).append(
                    f"{'write' if writing else 'read'}:{path}")
                raise PermissionError(1, "Operation not permitted", path)
        return real_open(file, mode, *a, **k)

    builtins.open = guarded_open  # type: ignore[assignment]


DRY_CLI_BRIEF = "把下载文件夹里的 PDF 按内容分类，完成后汇报"
# Wake dry test: the discovery line from Galley's prompt, reads and writes
# through the fake galley, a flag the real CLI refuses, a holding command,
# and things the sandbox must refuse (the real HOME, /etc, a program not on
# the list, the network, a file outside).
WAKE_DRY_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
echo "cli=${GALLEY##*/}"
"$GALLEY" session show s-mgq3c1d8-2k7v4p0a --tail=40 | head -2
"$GALLEY" session send s-mgq3c1d8-2k7v4p0a "截图路径再给一下" --supervisor=galley-assistant --reason="send back" --ensure-runner
"$GALLEY" session brief s-mgq3c1d8-2k7v4p0a
"$GALLEY" llm set s-mgq3c1d8-2k7v4p0a glm-5.3 --supervisor=galley-assistant; echo "llm_set=$?"
"$GALLEY" session wait s-mgq3c1d8-2k7v4p0a --until-idle --timeout=5 | tail -1
ls ~/Downloads
cat ~/Downloads/螺纹钢报价_本周.csv | wc -l
python3 -c 'print("py", 6*7)'
sed -n 1p "REAL/.zshrc" >/dev/null 2>&1; echo "read_real=$?"
cat /etc/hosts >/dev/null 2>&1; echo "cat_etc=$?"
ls "REAL" >/dev/null 2>&1; echo "ls_real=$?"
/usr/bin/python3 -c 1 >/dev/null 2>&1; echo "usr_python=$?"
curl -s https://example.com >/dev/null 2>&1; echo "curl=$?"
touch "CANARY-wake" 2>/dev/null; echo "touch=$?"
echo "x" > "CANARY-wake-redirect" 2>/dev/null; echo "redirect=$?"
'''
DRY_TOOL_BRIEF = "去华立、东辰、明光三家官网抓本周钢材报价，整理成对比表交回"
# Schedule dry test (ticket 36): the clock, the list, a time in the past,
# a reminder, one without --target (the CLI's default, session), the main
# chat refused, a help page.
SCHED_DRY_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
date +%H:%M >/dev/null; echo "date=$?"
AT="$(date -v+10M +%Y-%m-%dT%H:%M)"
"$GALLEY" schedule list | wc -l | sed 's/ //g; s/^/listed=/'
"$GALLEY" schedule create "提醒用户喝水" --at=2020-01-01T08:00 --target=assistant --supervisor=galley-assistant --reason=asked; echo "past=$?"
"$GALLEY" schedule create "提醒用户喝水" --at="$AT" --target=assistant --supervisor=galley-assistant --reason="user asked"
"$GALLEY" schedule create "提醒用户喝水" --at="$AT" --supervisor=galley-assistant; echo "notarget=$?"
"$GALLEY" schedule list | wc -l | sed 's/ //g; s/^/listed=/'
"$GALLEY" session rename s-mgn4k2x1-7q3z9w0e "主对话" --supervisor=galley-assistant; echo "rename=$?"
"$GALLEY" schedule create --help | head -1
'''

# To-do dry test (ticket 41): the list, the CLI's own refusals (empty and
# bad --due, a past --remind-at, no title, no change, --due with --no-due,
# an unknown id, a reminder on a done to-do, cancelling twice), a to-do
# noted with a due time and a reminder, ticking off twice, unticking,
# cancelling, reading a cancelled one, --all, the reminders in
# `schedule list`, a help page.
TODO_DRY_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
AT="$(date -v+2H +%Y-%m-%dT%H:%M)"
DUE="$(date -v+1d +%Y-%m-%d)"
"$GALLEY" todo list | wc -l | sed 's/ //g; s/^/listed=/'
"$GALLEY" todo add "交季度报告" --due=; echo "emptydue=$?"
"$GALLEY" todo add "交季度报告" --due=2026-13-40; echo "baddue=$?"
"$GALLEY" todo add "交季度报告" --due="$DUE" --remind-at=2020-01-01T08:00 --supervisor=galley-assistant; echo "past=$?"
"$GALLEY" todo list | wc -l | sed 's/ //g; s/^/listed=/'
"$GALLEY" todo add "交季度报告" --due="${DUE}T15:00" --remind-at="$AT" --notes="交给王经理" --supervisor=galley-assistant --reason="user mentioned it"
"$GALLEY" todo add "  " --supervisor=galley-assistant; echo "notitle=$?"
"$GALLEY" todo update todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant; echo "nochange=$?"
"$GALLEY" todo update todo_4d5e6f7a8b9c0d1e --due="$DUE" --no-due --supervisor=galley-assistant; echo "conflict=$?"
"$GALLEY" todo update todo_nope --title=x --supervisor=galley-assistant; echo "unknown=$?"
"$GALLEY" todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant --reason="user said so" | grep -c '"status": "done"' | sed 's/^/done=/'
"$GALLEY" todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant | grep -c doneAt | sed 's/^/done2=/'
"$GALLEY" todo update todo_4d5e6f7a8b9c0d1e --remind-at="$AT" --supervisor=galley-assistant; echo "donerem=$?"
"$GALLEY" todo reopen todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant | grep -c '"status": "open"' | sed 's/^/reopen=/'
"$GALLEY" todo cancel todo_1a2b3c4d5e6f7a8b --supervisor=galley-assistant >/dev/null
"$GALLEY" todo cancel todo_1a2b3c4d5e6f7a8b --supervisor=galley-assistant; echo "cancel2=$?"
"$GALLEY" todo show todo_1a2b3c4d5e6f7a8b | grep -c cancelledAt | sed 's/^/showcancelled=/'
"$GALLEY" todo list | wc -l | sed 's/ //g; s/^/open=/'
"$GALLEY" todo list --all | wc -l | sed 's/ //g; s/^/all=/'
"$GALLEY" schedule list | grep -c todoId | sed 's/^/todoid_tasks=/'
"$GALLEY" todo add --help | head -1
'''

# Ticket 61: who cancelled, as the real Core records it — `todo cancel`
# with its label and reason, the reminder Core takes along (`system`),
# `todo update --no-remind` (the caller's own), `schedule delete` with no
# label (`cli`) — and `--all` carrying it.
TODO_CANCEL_BY_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
AT="$(date -v+2H +%Y-%m-%dT%H:%M)"
"$GALLEY" todo cancel todo_1a2b3c4d5e6f7a8b --supervisor=galley-assistant --reason="用户说房东的事不用提醒" >/dev/null
"$GALLEY" todo show todo_1a2b3c4d5e6f7a8b | sed 's/^/cancelled: /'
"$GALLEY" schedule show sched_3e9d1c7a5b0f2486 | sed 's/^/released: /'
"$GALLEY" todo update todo_2b3c4d5e6f7a8b9c --no-remind --supervisor=galley-assistant --reason="不用提醒" >/dev/null
"$GALLEY" schedule show sched_8c1e0a7b3d2f4965 | sed 's/^/unreminded: /'
"$GALLEY" schedule create "提醒用户喝水" --at="$AT" --target=assistant --supervisor=galley-assistant >/dev/null
"$GALLEY" schedule delete sched_5eed000000000002 | sed 's/^/deleted: /'
"$GALLEY" todo list --all | grep -c cancelledBy | sed 's/^/all_cancelledby=/'
"$GALLEY" schedule list --all | grep -c cancelledBy | sed 's/^/tasks_cancelledby=/'
'''

# Ticket 96: the memo family as the real CLI and Core answer it — the
# list, the refusals (101 characters, empty, a past --until, a bad one, an
# empty one, no text, an update with nothing to change, --until with
# --no-until, an unknown id, an unknown flag), an update, an add with a
# last day, the total past 2,000 characters (overLimit), deleting, deleting
# again, a help page.
# Ticket 108: the review's comparison, made in the fake HOME, and a line on
# top of the notes the fake galley shows (read with todo show, kept below).
TODO_PROGRESS_BASH = r'''G="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
"$G" todo list >/dev/null
cat "$HOME/Downloads/搬家报价/"*.txt >/dev/null
python3 -c 'import os; d = os.path.expanduser("~/Documents"); os.makedirs(d, exist_ok=True); open(os.path.join(d, "搬家报价对比.md"), "w").write("蚂蚁最便宜\\n")'
OLD="$("$G" todo show todo_9d2e4f6a8b0c1e35 | python3 -c 'import json, sys; print(json.load(sys.stdin)["notes"])')"
DAY="$(date +%-m月%-d日)"
"$G" todo update todo_9d2e4f6a8b0c1e35 --notes="${DAY}：三家报价比好了，蚂蚁最便宜，对比表在 $HOME/Documents/搬家报价对比.md
${OLD}" --supervisor=galley-assistant --reason="morning review: compared the quotes"
'''
MEMO_DRY_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
UNTIL="$(date -v+3d +%Y-%m-%d)"
"$GALLEY" memo list | wc -l | sed 's/ //g; s/^/listed=/'
"$GALLEY" memo add "$(python3 -c 'print("菜" * 101)')" --supervisor=galley-assistant; echo "long=$?"
"$GALLEY" memo add "   " --supervisor=galley-assistant; echo "empty=$?"
"$GALLEY" memo add "x" --until=2020-01-01 --supervisor=galley-assistant; echo "past=$?"
"$GALLEY" memo add "x" --until=明天 --supervisor=galley-assistant; echo "baddate=$?"
"$GALLEY" memo add "x" --until= --supervisor=galley-assistant; echo "emptyuntil=$?"
"$GALLEY" memo add --supervisor=galley-assistant; echo "notext=$?"
"$GALLEY" memo update memo_a1b2c3d4e5f60718 --supervisor=galley-assistant; echo "nochange=$?"
"$GALLEY" memo update memo_a1b2c3d4e5f60718 --until="$UNTIL" --no-until --supervisor=galley-assistant; echo "conflict=$?"
"$GALLEY" memo update memo_nope --text=x --supervisor=galley-assistant; echo "unknown=$?"
"$GALLEY" memo list --all; echo "listall=$?"
"$GALLEY" memo update memo_a1b2c3d4e5f60718 --text="房东王先生，电话 139 0000 2222" --supervisor=galley-assistant --reason="new number" | grep -c "139 0000 2222" | sed 's/^/updated=/'
"$GALLEY" memo update memo_a1b2c3d4e5f60718 --text="  房东王先生，电话 139 0000 2222 " --supervisor=galley-assistant >/dev/null; echo "same=$?"
"$GALLEY" memo add "下周三起在上海出差" --until="$UNTIL" --supervisor=galley-assistant --reason="user mentioned it" | grep -c '"until"' | sed 's/^/until=/'
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do "$GALLEY" memo add "$(python3 -c "print('长' * 100)")" --supervisor=galley-assistant > "$TMPDIR/last-memo.json"; done
grep -c overLimit "$TMPDIR/last-memo.json" | sed 's/^/over=/'
"$GALLEY" memo list | wc -l | sed 's/ //g; s/^/listed=/'
"$GALLEY" memo delete memo_a1b2c3d4e5f60718 --supervisor=galley-assistant --reason="moved" | grep -c "139 0000 2222" | sed 's/^/deleted=/'
"$GALLEY" memo delete memo_a1b2c3d4e5f60718 --supervisor=galley-assistant; echo "delete2=$?"
"$GALLEY" memo add --help | head -1
'''


SANDBOX_PROBE = r'''import json, os, socket, subprocess
res = {}
def t(k, f):
    try: res[k] = ["ok", str(f())[:300]]
    except Exception as e: res[k] = ["fail", (type(e).__name__ + ": " + str(e))[:300]]
REAL = REAL_HOME
t("list_real_home", lambda: os.listdir(REAL))
t("read_real_file", lambda: open(os.path.join(REAL, ".zshrc")).read(10))
t("list_app_galley", lambda: os.listdir(os.path.join(REAL, "Library/Application Support/app.galley")))
t("list_generic_agent", lambda: os.listdir(os.path.join(REAL, "Documents/GenericAgent")))
t("unix_socket", lambda: socket.socket(socket.AF_UNIX).connect(SOCK))
t("tcp", lambda: socket.create_connection(("1.1.1.1", 443), timeout=3))
t("dns", lambda: socket.getaddrinfo("example.com", 443))
t("write_outside", lambda: open(CANARY + "-sbx-write", "w").write("x"))
t("write_real_home", lambda: open(os.path.join(REAL, "entry-layer-eval-sbx-canary"), "w").write("x"))
t("run_other_program", lambda: subprocess.run(["/bin/ls", "/"], capture_output=True).returncode)
t("fake_home", lambda: os.path.expanduser("~"))
t("list_fake_downloads", lambda: len(os.listdir(os.path.expanduser("~/Downloads"))))
cli = open(os.path.expanduser("~/.config/galley/cli-path")).read().strip()
t("galley_search", lambda: subprocess.run([cli, "sessions", "search", "x", "--runtime", "all", "--all"],
                                          capture_output=True, text=True).stdout.strip())
t("galley_help", lambda: subprocess.run([cli, "subtask", "start", "--help"],
                                        capture_output=True, text=True).stdout.strip())
t("galley_start", lambda: subprocess.run([cli, "subtask", "start", "--parent=s-mgn4k2x1-7q3z9w0e", BRIEF],
                                         capture_output=True, text=True).stdout.strip())
print(json.dumps(res, ensure_ascii=False))
'''


def fake_llm(script: str, ctx: dict[str, Any] | None = None) -> Any:
    """Dry test: stands in for llmcore._stream_with_retry, returning per
    model call the content blocks a real chat_completions stream would
    parse into. Every command in them would leave a canary file if run
    outside what the run allows."""
    canary = os.environ["EVAL_CANARY"]
    ctx = ctx or {}
    real_home = ctx.get("real_home", "/nonexistent")

    def call(text: str, *tools: tuple[str, dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
        blocks: list[dict[str, Any]] = [{"type": "text", "text": text}]
        blocks += [{"type": "tool_use", "id": f"call_{i}", "name": name, "input": inp}
                   for i, (name, inp) in enumerate(tools, 1)]
        return text, blocks

    cli = ('GALLEY="$(sed -n \'1p\' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"\n'
           f'"$GALLEY" subtask start --parent=s-mgn4k2x1-7q3z9w0e "{DRY_CLI_BRIEF}"; '
           f'touch {canary}-cli')
    scripts = {
        "tool": [call("<summary>Look at the Downloads folder</summary>\n我来看一下。",
                      ("code_run", {"type": "bash", "script": f"touch {canary}-code_run"}),
                      ("file_write", {"path": f"{canary}-file_write", "content": "x"}))],
        "final": [call("<summary>Answered</summary>\n先放蛋。\n"
                       "<next-suggestion>帮我写个番茄炒蛋的完整步骤</next-suggestion>")],
        "tag": [call("<summary>Dispatched</summary>\n交给子任务去整理了。\n"
                     "<subtask>把 ~/Downloads 里的 PDF 按内容分类</subtask>")],
        "cli-final": [call("<summary>Start a subtask</summary>\n开个子任务去做。",
                           ("code_run", {"type": "bash", "script": cli})),
                      call("<summary>Subtask running</summary>\n已经开始整理了，进度看它的卡片。")],
        "tool-wait": [call("<summary>Start a subtask</summary>\n交给子任务。",
                           ("start_subtask", {"task": DRY_TOOL_BRIEF})),
                      call("<summary>Wait for it</summary>\n等它跑完。",
                           ("code_run", {"type": "bash", "script": f"sleep 30; touch {canary}-wait"}))],
        "other-first": [call("<summary>List files</summary>\n我看一下。",
                             ("code_run", {"type": "bash", "script": f"ls ~/Downloads; touch {canary}-ls"}))],
        # Sandbox mode.
        "sbx-cli-wait": [
            call("<summary>Probe, then start a subtask</summary>\n开个子任务。",
                 ("code_run", {"script": SANDBOX_PROBE.replace("REAL_HOME", repr(real_home))
                               .replace("SOCK", repr(ctx.get("sock", "")))
                               .replace("CANARY", repr(canary)).replace("BRIEF", repr(DRY_CLI_BRIEF))})),
            call("<summary>Check on it</summary>\n看看它。",
                 ("code_run", {"type": "bash", "script":
                               'read -r G < ~/.config/galley/cli-path; "$G" session show s-sub0001; sleep 1'})),
            call("<summary>Running</summary>\n已经开始整理了。")],
        "sbx-tool-cap": (
            [call("<summary>Look first</summary>\n先看看。",
                  ("code_run", {"script": "import os\nprint(sorted(os.listdir(os.path.expanduser('~/Downloads')))[:5])"})),
             call("<summary>Dispatch</summary>\n交给子任务。", ("start_subtask", {"task": DRY_TOOL_BRIEF}))]
            + [call(f"<summary>Wait {i}</summary>\n等等。",
                    ("code_run", {"script": "import time\ntime.sleep(0.1)\nprint('waiting')"}))
               for i in range(7)]),
        "sbx-tag-refusals": [
            call("<summary>Read</summary>\n读一下。", ("file_read", {"path": os.path.join(real_home, ".zshrc")})),
            call("<summary>Write</summary>\n写一下。", ("file_write", {"path": canary + "-file_write", "content": "x"})),
            call("<summary>Write ref</summary>\n写一下。",
                 ("file_write", {"path": "notes_from_eval.txt",
                                 "content": "{{file:" + os.path.join(real_home, ".zshrc") + ":1:1}}"})),
            call("<summary>Read memory</summary>\n读记忆。", ("file_read", {"path": "../memory/global_mem.txt"})),
            call("<summary>Browse</summary>\n打开网页。",
                 ("web_execute_js", {"script": '{"cmd":"tabs","method":"create","url":"https://example.com"}'}))],
        "sbx-tag-move": [
            call("<summary>Sort two invoices</summary>\n先整理两张发票。",
                 ("code_run", {"script": "import os, shutil\nd = os.path.expanduser('~/Downloads')\n"
                               "os.makedirs(os.path.join(d, '发票'), exist_ok=True)\n"
                               "for n in ['发票_阿里云_2026-08.pdf', 'Invoice_Figma_2026-09.pdf']:\n"
                               "    shutil.move(os.path.join(d, n), os.path.join(d, '发票', n))\nprint('moved')"})),
            call("<summary>Dispatch the rest</summary>\n剩下的交给子任务。\n"
                 "<subtask>把 ~/Downloads 里其余 PDF 按内容分类</subtask>")],
        # Wake suite.
        "wake-bash": [
            call("<summary>Read the manual</summary>\n先看手册。",
                 ("file_read", {"path": os.path.join(ctx.get("manual_dir", ""), "wake.md")}),
                 ("file_read", {"path": os.path.join(ctx.get("manual_dir", ""), "subtasks.md")})),
            call("<summary>Check the subtask</summary>\n核对一下。",
                 ("code_run", {"type": "bash", "script": WAKE_DRY_BASH.replace("REAL", real_home)
                               .replace("CANARY", canary)})),
            call("<summary>Sent back</summary>\n<no-reply/>")],
        "wake-ask": [
            call("<summary>Ask the user</summary>\n要验证码。",
                 ("ask_user", {"question": "12306 发到你手机尾号 3821 的验证码是多少？", "candidates": []}))],
        # Schedule suite.
        "sched-create": [
            call("<summary>Read the manual</summary>\n先看手册。",
                 ("file_read", {"path": os.path.join(ctx.get("manual_dir", ""), "times.md")})),
            call("<summary>Set it</summary>\n建一个。", ("code_run", {"type": "bash", "script": SCHED_DRY_BASH})),
            call("<summary>Set</summary>\n好，十分钟后提醒你喝水。")],
        "sched-no-reply": [call("<summary>Already done</summary>\n<no-reply/>")],
        # Ticket 44: a nudge noted as a to-do (wrong), a nudge as its own
        # reminder (right), a thing to get done as its own reminder
        # (wrong) and as a to-do with its reminder (right).
        "sched-nudge-todo": [
            call("<summary>Note it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; AT="$(date -v+10M +%Y-%m-%dT%H:%M)"; '
                 '"$G" todo list >/dev/null; "$G" todo add "喝水" --due="$AT" --remind-at="$AT" '
                 '--supervisor=galley-assistant --reason="user asked"'})),
            call("<summary>Noted</summary>\n好，十分钟后提醒你喝水。")],
        "sched-nudge": [
            call("<summary>Set it</summary>\n设一个。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; AT="$(date -v+30M +%Y-%m-%dT%H:%M)"; '
                 '"$G" schedule list >/dev/null; "$G" schedule create $\'关火\\n\\n用户要半小时后提醒；到时简短提醒。\' '
                 '--at="$AT" --target=assistant --supervisor=galley-assistant --reason="user asked"'})),
            call("<summary>Set</summary>\n好，半小时后提醒你关火。")],
        "sched-own-for-todo": [
            call("<summary>Set it</summary>\n设一个。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; AT="$(date -v+1d +%Y-%m-%d)T10:00"; '
                 '"$G" schedule list >/dev/null; "$G" schedule create "提醒用户周三下午交报告" --at="$AT" '
                 '--target=assistant --supervisor=galley-assistant --reason="user mentioned it"'})),
            call("<summary>Set</summary>\n好，明天上午 10 点提醒你交报告。")],
        "sched-todo": [
            call("<summary>Note it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; D="$(date -v+1d +%Y-%m-%d)"; '
                 '"$G" todo list >/dev/null; "$G" todo add "交报告" --due="$(date -v+3d +%Y-%m-%d)" '
                 '--remind-at="${D}T10:00" --supervisor=galley-assistant --reason="user mentioned it"'})),
            call("<summary>Noted</summary>\n记下了：周三下午交报告，明天上午 10 点提醒你。")],
        # To-do suite.
        "todo-cli": [
            call("<summary>Read the manual</summary>\n先看手册。",
                 ("file_read", {"path": os.path.join(ctx.get("manual_dir", ""), "todos.md")})),
            call("<summary>Use the list</summary>\n动一下清单。", ("code_run", {"type": "bash", "script": TODO_DRY_BASH})),
            call("<summary>Done</summary>\n已勾掉。")],
        "todo-cancel-by": [
            call("<summary>Cancel</summary>\n取消。", ("code_run", {"type": "bash", "script": TODO_CANCEL_BY_BASH})),
            call("<summary>Cancelled</summary>\n好，不提醒了。")],
        "todo-tick": [
            call("<summary>Tick it</summary>\n勾掉。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" todo list >/dev/null; '
                 '"$G" todo done todo_4d5e6f7a8b9c0d1e --supervisor=galley-assistant --reason="user bought it"'})),
            call("<summary>Ticked</summary>\n好，已勾掉。")],
        "todo-remind": [call("<summary>Remind</summary>\n提醒一下：季度报告三小时后截止，记得交给王经理。")],
        # Ticket 44: reminded at the time the user named, and half an hour
        # early (wrong).
        "todo-at-named": [
            call("<summary>Note it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; D="$(date -v+1d +%Y-%m-%d)"; '
                 '"$G" todo list >/dev/null; "$G" todo add "给房东回电话" --due="$D" --remind-at="${D}T08:00" '
                 '--supervisor=galley-assistant --reason="user asked"'})),
            call("<summary>Noted</summary>\n记下了：明天给房东回电话，明早 8 点提醒你。")],
        "todo-early": [
            call("<summary>Note it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; D="$(date -v+1d +%Y-%m-%d)"; '
                 '"$G" todo list >/dev/null; "$G" todo add "给房东回电话" --due="$D" --remind-at="${D}T07:30" '
                 '--supervisor=galley-assistant --reason="user asked"'})),
            call("<summary>Noted</summary>\n记下了：明天给房东回电话，明早 7 点半提醒你。")],
        # Ticket 60: a follow-up of its own, unasked; cancelling the kind
        # the user turned down, with the kind in the reason and without;
        # nothing set, and one set, where a follow-up of that kind was
        # turned down; a two-sided case; a reminder recited, and one put
        # to use.
        "todo-follow-own": [
            call("<summary>Follow it up</summary>\n跟一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" schedule list >/dev/null; '
                 '"$G" schedule create "问一下用户 702 办公室装修完没" --at="$(date +%Y)-11-20T10:00" '
                 '--target=assistant --supervisor=galley-assistant --reason="renovation due to finish"'})),
            call("<summary>Set</summary>\n11 月 20 号上午 10 点我问你一下装修完没。")],
        "todo-stop-kind": [
            call("<summary>Cancel</summary>\n取消。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" todo list >/dev/null; '
                 '"$G" todo cancel todo_6f7a8b9c0d1e2f3a --supervisor=galley-assistant '
                 '--reason="user: no renovation progress reminders"'})),
            call("<summary>Cancelled</summary>\n好，装修进度这类的不再提醒你了。")],
        "todo-stop-vague": [
            call("<summary>Cancel</summary>\n取消。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; '
                 '"$G" todo cancel todo_6f7a8b9c0d1e2f3a --supervisor=galley-assistant --reason="user asked"'})),
            call("<summary>Cancelled</summary>\n好，不提醒了。")],
        "todo-quiet": [call("<summary>Noted</summary>\n好的，知道了。")],
        "todo-declined-set": [
            call("<summary>Note it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" todo add "801 装修完工" '
                 '--due="$(date +%Y)-12-01" --remind-at="$(date +%Y)-12-01T10:00" '
                 '--supervisor=galley-assistant --reason="renovation due to finish"'})),
            call("<summary>Noted</summary>\n记下了，12 月 1 号上午 10 点提醒你。")],
        "todo-maybe": [
            call("<summary>Nudge</summary>\n提醒一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" schedule create "提醒用户出门吃火锅" '
                 '--at="$(date -v+1H +%Y-%m-%dT%H:%M)" --target=assistant --supervisor=galley-assistant '
                 '--reason="dinner tonight"'})),
            call("<summary>Set</summary>\n一小时后提醒你出门。")],
        "todo-recite": [call("<summary>Remind</summary>\n提醒：702 办公室装修完工。")],
        # Ticket 63: 「记下了」 with nothing written (wrong), and after a
        # line its own code appends to GA's memory (right); its own
        # reminder's wake answered with a question.
        "todo-claim": [call("<summary>Noted</summary>\n记下了，你们公司成立于 2019 年 11 月 20 日。")],
        "todo-memory": [
            call("<summary>Remember it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'printf \'\\n- 公司成立日：2019-11-20\\n\' >> "$GALLEY_GA_STATE_ROOT/memory/global_mem.txt"; echo ok'})),
            call("<summary>Noted</summary>\n记下了：你们公司 2019 年 11 月 20 日成立。")],
        "todo-offer-ask": [call("<summary>Ask</summary>\nHR 今天该给 offer 答复了，结果怎么样？")],
        "todo-put-to-use": [call("<summary>Remind</summary>\n702 装修预计今天完工，完了吗？要不要约个时间验收？")],
        # Ticket 78: the review and a subtask's result in one wake, the
        # result checked through the fake galley and passed on.
        "todo-mix-checked": [
            call("<summary>Check it</summary>\n核对一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; S=s-mgu2r7k4-8c3v5n1x; "$G" sessions list; '
                 '"$G" session show "$S" --around="msg_${S}_0_user"; "$G" session show "$S" --tail=40'})),
            call("<summary>Relay</summary>\n下周三上午的三班查到了：G7502 09:12 开、G7348 09:41 开、G1374 10:05 开，"
                 "二等座都是 73 元，前两班有票，G1374 余 9 张（12306 余票查询页）。")],
        # Ticket 108: the review that compares the quotes in ~/Downloads,
        # writes the comparison to ~/Documents and puts a line on top of
        # the notes it read; the review that reads yesterday's line, the
        # file it names, and stays quiet.
        "todo-progress-done": [
            call("<summary>Compare</summary>\n比一下。", ("code_run", {"type": "bash", "script": TODO_PROGRESS_BASH})),
            call("<summary>Tell</summary>\n搬家报价我早上比了一下：全包算下来蚂蚁最便宜，2,380 元。")],
        "todo-progress-quiet": [
            call("<summary>Look</summary>\n看一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" todo list; '
                 '"$G" todo show todo_9d2e4f6a8b0c1e35; cat ~/Downloads/搬家报价/三家报价对比.md'})),
            call("<summary>Quiet</summary>\n<no-reply/>")],
        # Ticket 96: the memo family through the fake galley; a lookup with
        # no browser connected, then a memo; the review left quiet.
        "memo-cli": [
            call("<summary>Read the manual</summary>\n先看手册。",
                 ("file_read", {"path": os.path.join(ctx.get("manual_dir", ""), "memo.md")})),
            call("<summary>Memos</summary>\n改一下。", ("code_run", {"type": "bash", "script": MEMO_DRY_BASH})),
            call("<summary>Done</summary>\n记下了。")],
        "memo-web": [
            call("<summary>Look it up</summary>\n查一下。", ("web_scan", {"tabs_only": True})),
            call("<summary>Note it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                 'G="$(sed -n \'1p\' ~/.config/galley/cli-path)"; "$G" memo list >/dev/null; '
                 '"$G" memo add "看你这周常问 76 人的比赛" --supervisor=galley-assistant --reason="interest seen"'})),
            call("<summary>Answer</summary>\n周四是主场，打凯尔特人。")],
        "sbx-inline": [
            call("<summary>Inline</summary>\n直接算。",
                 ("code_run", {"script": f"open({canary + '-inline'!r}, 'w').write('x')", "inline_eval": True}))],
    }
    steps = list(scripts[script])

    def stream(sess: Any, url: str, headers: Any, payload: Any, parse_fn: Any) -> Any:
        if not steps:
            raise RuntimeError("dry test: the fake model has no more replies")
        text, blocks = steps.pop(0)
        yield text
        return blocks

    return stream


def worker() -> int:
    job = json.loads(sys.stdin.read())
    state_root = Path(job["state_root"])
    refuse_real_data(state_root)
    rec: dict[str, Any] = {"responses": [], "requests": [], "usage": [], "intercepted": None,
                           "do_calls": [], "blocked": BLOCKED, "tools_seen": 0,
                           "dispatch_call": None, "calls": [], "dispatches": [], "tag": None,
                           "stop_reason": None}
    dispatch_variant = job.get("dispatch_variant")
    sandbox = job.get("sandbox_info")

    os.environ["GALLEY_RUNTIME_KIND"] = "managed"
    os.environ["GALLEY_GA_STATE_ROOT"] = str(state_root)
    os.environ["GALLEY_RUNTIME_PROMPT_TEXT"] = job["galley_prompt"]
    os.environ["GA_LANG"] = job["ga_lang"]
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    sys.dont_write_bytecode = True
    real_home = os.path.expanduser("~")
    if sandbox:
        # The fake HOME, for this process and for the model's code.
        os.environ["HOME"] = sandbox["home"]
        os.environ["XDG_CONFIG_HOME"] = os.path.join(sandbox["home"], ".config")
        os.environ["TMPDIR"] = os.path.join(sandbox["root"], "tmp")
        SANDBOX_EXEC.update(profile=sandbox["profile"], root=sandbox["root"], env={
            "HOME": sandbox["home"], "XDG_CONFIG_HOME": os.path.join(sandbox["home"], ".config"),
            "TMPDIR": os.path.join(sandbox["root"], "tmp"), "PATH": sandbox.get("path_env", "/usr/bin:/bin"),
            "LANG": "en_US.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8",
            "GALLEY_GA_STATE_ROOT": str(state_root), "SHELL": "/bin/bash", "TERM": "dumb",
            "USER": os.environ.get("USER", ""), "LOGNAME": os.environ.get("LOGNAME", ""),
        })
        IO_GUARD["read_roots"] = (sandbox["root"] + os.sep, os.path.realpath(GA_CODE) + os.sep)
    install_guards([str(state_root.parent)], set(job["allowed_hosts"]))

    # As Bridge._setup_ga: GA code + frontends on sys.path, state dirs,
    # managed mykey loader, chdir to the state root (cwd is None for
    # managed sessions), then agentmain.
    for p in (str(GA_CODE / "frontends"), str(GA_CODE), str(REPO)):
        if p not in sys.path:
            sys.path.insert(0, p)
    for rel in ("memory", "sop", "skills", "temp", "temp/model_responses"):
        os.makedirs(state_root / rel, exist_ok=True)
    import llmcore  # type: ignore[import-not-found]

    mykeys = job["mykeys"]

    def load_mykeys() -> tuple[dict[str, Any], None, None]:  # managed_runtime.install_managed_mykey_loader
        return {k: dict(v) for k, v in mykeys.items()}, None, None

    store = llmcore.mykeys_store
    with store.lock:
        store._load = load_mykeys
        store.data, store.path, store.mtime, store.updated_at = {}, None, None, None

    # Record exactly what is sent (the request payload; headers carry the
    # key and are not kept) and the usage the stream reports.
    real_stream = llmcore._stream_with_retry
    manual_m = re.search(r"Your manual is in `([^`]+)`", job["galley_prompt"])
    fake = (fake_llm(job["dry"], {"real_home": real_home, "sock": job.get("dry_sock"),
                                  "manual_dir": manual_m.group(1) if manual_m else ""})
            if job.get("dry") else None)

    def stream(sess: Any, url: str, headers: Any, payload: Any, parse_fn: Any) -> Any:
        rec["requests"].append(json.loads(json.dumps(payload, ensure_ascii=False, default=str)))
        if fake is not None:
            return (yield from fake(sess, url, headers, payload, parse_fn))
        return (yield from real_stream(sess, url, headers, payload, parse_fn))

    llmcore._stream_with_retry = stream
    real_usage = llmcore._record_usage

    def record_usage(usage: Any, api_mode: Any) -> Any:
        if usage:
            rec["usage"].append(json.loads(json.dumps(usage, default=str)))
        return real_usage(usage, api_mode)

    llmcore._record_usage = record_usage
    os.chdir(state_root)

    import agentmain  # type: ignore[import-not-found]
    from agent_loop import StepOutcome  # type: ignore[import-not-found]
    from runner import managed_runtime
    from runner.ga_session import GaSession

    agent = agentmain.GeneraticAgent()
    agent.next_llm(0)
    # next_llm reloads the tool list (load_tool_schema); the run reads the
    # module global afterwards, so an extra tool goes in after it. In this
    # process only, never into managed-ga/code.
    for tool in job.get("extra_tools") or []:
        agentmain.TOOLS_SCHEMA.append(json.loads(json.dumps(tool)))
    managed_runtime.install_managed_prompt_profile(agent)
    agent.verbose = True
    agent.inc_out = True
    ga = GaSession(agent)

    base = agentmain.GenericAgentHandler

    def dispatch_command(handler: Any, tool_name: str, args: Any, response: Any) -> Any:
        """For the dispatch suite: whether this call starts a subtask, and
        the command text (C) it would have run."""
        if dispatch_variant == "P":
            return tool_name == "start_subtask", None
        if dispatch_variant == "C" and tool_name == "code_run":
            code = (args or {}).get("code") or (args or {}).get("script")
            if not code:  # GA's code_run falls back to the reply's code block
                code = handler._extract_code_block(response, (args or {}).get("type", "python"))
            if not code:
                blocks = re.findall(r"```[^\n]*\n([\s\S]*?)```", getattr(response, "content", "") or "")
                code = blocks[-1] if blocks else ""
            return bool(CLI_DISPATCH_RE.search(code or "")), code
        return False, None

    def note_dispatch(n: int, via: str, brief: Any, parent: Any = None) -> None:
        rec["dispatches"].append({"call": n, "via": via, "brief": brief, "parent": parent})

    def galley_log() -> list[dict[str, Any]]:
        return read_galley_log(sandbox["galley_log"]) if sandbox else []

    def file_tool_refusal(handler: Any, tool_name: str, args: Any, index: int) -> Any:
        """file_read / file_write / file_patch outside the sandbox (the path,
        or a {{file:…}} reference GA would expand): refused, in the shape
        GA's own tool returns for an unreadable / unwritable path."""
        root = (sandbox["root"] + os.sep,)
        targets = []
        if (args or {}).get("path"):
            targets.append(os.path.realpath(handler._get_abs_path(args["path"])))
        text = str((args or {}).get("content") or "") + str((args or {}).get("new_content") or "")
        for ref in re.findall(r"\{\{file:(.+?):(\d+):(\d+)\}\}", text):
            targets.append(os.path.realpath(os.path.abspath(os.path.join(handler.cwd, ref[0]))))
        bad = [t for t in targets if not under(t, root)]
        if not bad:
            return None
        REFUSED.append(f"{tool_name}:{bad[0]}")
        msg = f"[Errno 1] Operation not permitted: '{bad[0]}'"
        if tool_name == "file_read":
            return StepOutcome(f"Error: {msg}", next_prompt=handler._get_anchor_prompt(skip=index > 0))
        return StepOutcome({"status": "error", "msg": msg}, next_prompt="\n")

    def sandbox_dispatch(handler: Any, tool_name: str, args: Any, response: Any, index: int,
                         tool_num: int) -> Any:
        """Sandbox mode: lookups and file work run for real inside the run's
        sandbox; P's start_subtask gets the fake result; browser tools,
        ask_user, inline_eval and unknown tools end the run; the 9th call
        ends it unrun. Every call is recorded with what came back."""
        clean = {k: v for k, v in (args or {}).items() if not str(k).startswith("_")}
        n = rec["tools_seen"] = rec["tools_seen"] + 1
        entry: dict[str, Any] = {"n": n, "turn": handler.current_turn, "name": tool_name, "args": clean}
        rec["calls"].append(entry)

        def stop(reason: str, note: str) -> Any:
            entry["outcome"] = note
            rec["stop_reason"] = reason
            rec["intercepted"] = {"name": tool_name, "args": clean, "turn": handler.current_turn}
            return StepOutcome(None, should_exit=True)

        cap = int(job.get("tool_cap") or SANDBOX_TOOL_CAP)
        if n > cap:
            return stop("cap_reached", f"not run: cap of {cap} tool calls reached")
        if tool_name == "start_subtask" and dispatch_variant == "P":
            result = json.loads(json.dumps(FAKE_DISPATCH_RESULTS["P"]))
            entry.update(outcome="fake result", result=result)
            note_dispatch(n, "tool", clean.get("task"))
            return StepOutcome(result, next_prompt=handler._get_anchor_prompt(skip=index > 0))
        if tool_name in ("web_scan", "web_execute_js") and job.get("web_unavailable"):
            # Ticket 96: no browser connected, in GA's own words and shape
            # (ga.py web_scan / web_execute_js), so a lookup does not end
            # the run before the memo; nothing is opened.
            result: Any = {"status": "error", "msg": NO_BROWSER_CONNECTION_MSG}
            entry.update(outcome="fake result: no browser connected", result=result)
            if tool_name == "web_scan":
                return StepOutcome(result, next_prompt="\n")
            return StepOutcome(json.dumps(result, ensure_ascii=False),
                               next_prompt=handler._get_anchor_prompt(skip=index > 0))
        if tool_name in SANDBOX_STOPS:
            return stop(SANDBOX_STOPS[tool_name], "not run: run stopped here")
        if tool_name not in SANDBOX_RUNNABLE:
            return stop("unknown_tool", "not run: no such tool here, run stopped")
        if tool_name == "code_run" and str(clean.get("inline_eval", "")).lower() in ("true", "1"):
            return stop("inline_eval", "not run: inline_eval runs inside the engine process")
        if tool_name in ("file_read", "file_write", "file_patch"):
            refusal = file_tool_refusal(handler, tool_name, args, index)
            if refusal is not None:
                entry.update(outcome="refused: outside the sandbox", result=refusal.data)
                return refusal
        seen = len(galley_log())
        IO_GUARD["tool_active"] = True
        SANDBOX_EXEC["active"] = tool_name == "code_run"
        try:
            outcome = yield from base.dispatch(handler, tool_name, args, response, index, tool_num)
        except Exception as e:  # GA's tools return errors; keep that shape
            outcome = StepOutcome({"status": "error", "msg": str(e)}, next_prompt="\n")
        finally:
            IO_GUARD["tool_active"] = False
            SANDBOX_EXEC["active"] = False
        entry["outcome"] = "run in the sandbox"
        entry["result"] = json.loads(json.dumps(outcome.data, ensure_ascii=False, default=str))
        new = galley_log()[seen:]
        if new:
            entry["galley_calls"] = [c.get("argv") for c in new]
            for c in new:
                started = subtask_start_args(c.get("argv") or [])
                if started is not None:
                    note_dispatch(n, "cli", started["task"], started["parent"])
        return outcome

    class EvalHandler(base):  # type: ignore[misc,valid-type]
        """GA's handler with tool dispatch cut off: a real tool call is
        recorded and ends the run (should_exit), so no tool runs. `no_tool`
        (GA's final-answer check, which only reads the reply) and
        `bad_json` (a re-prompt) go through GA's own path.

        Dispatch suite (C / P) only: when the run's FIRST tool call starts
        a subtask, it is not run either; the model gets a fake success
        result, shaped as the real tool returns it, with GA's usual next
        prompt, and the loop goes on to the next model call. At most once
        per run; the next tool call ends the run as above."""

        def dispatch(self, tool_name: str, args: Any, response: Any, index: int = 0,
                     tool_num: int = 1) -> Any:
            if tool_name in ("no_tool", "bad_json"):
                return (yield from super().dispatch(tool_name, args, response, index, tool_num))
            if sandbox:
                return (yield from sandbox_dispatch(self, tool_name, args, response, index, tool_num))
            call = {
                "name": tool_name,
                "args": {k: v for k, v in (args or {}).items() if not str(k).startswith("_")},
            }
            first = rec["tools_seen"] == 0
            rec["tools_seen"] += 1
            if first and rec["dispatch_call"] is None and dispatch_variant in FAKE_DISPATCH_RESULTS:
                matched, command = dispatch_command(self, tool_name, args, response)
                if matched:
                    rec["dispatch_call"] = dict(call, command=command, turn=self.current_turn)
                    fake_result = json.loads(json.dumps(FAKE_DISPATCH_RESULTS[dispatch_variant]))
                    # As do_code_run (and GA's tools generally) continue.
                    return StepOutcome(fake_result, next_prompt=self._get_anchor_prompt(skip=index > 0))
            rec["intercepted"] = dict(call, turn=self.current_turn)
            return StepOutcome(None, should_exit=True)

        def turn_end_callback(self, response: Any, tool_calls: Any, tool_results: Any,
                              turn: int, next_prompt: str, exit_reason: Any) -> Any:
            tag = SUBTASK_TAG_RE.search(getattr(response, "content", "") or "")
            if tag and rec["tag"] is None:
                rec["tag"] = {"turn": turn, "brief": tag.group(1).strip(),
                              "calls_before": sum(1 for c in rec["calls"] if c["turn"] < turn)}
            rec["responses"].append({
                "turn": turn,
                "content": getattr(response, "content", "") or "",
                "thinking": getattr(response, "thinking", "") or "",
                "tool_calls": [{"name": tc["tool_name"],
                                "args": {k: v for k, v in tc["args"].items()
                                         if not str(k).startswith("_")}}
                               for tc in tool_calls if tc["tool_name"] != "no_tool"],
                "exit_reason": (exit_reason or {}).get("result"),
            })
            return super().turn_end_callback(response, tool_calls, tool_results, turn,
                                             next_prompt, exit_reason)

    def never_run(name: str) -> Any:
        def deny(self: Any, *_a: Any, **_k: Any) -> Any:
            rec["do_calls"].append(name)
            raise PermissionError(f"entry-layer eval: tool {name} must not run")
        return deny

    runnable = {"do_no_tool"} | ({f"do_{t}" for t in SANDBOX_RUNNABLE} if sandbox else set())
    for name in dir(base):
        if name.startswith("do_") and name not in runnable:
            setattr(EvalHandler, name, never_run(name))
    ga.install_handler(agentmain, EvalHandler)

    if job["history"]:
        warning = ga.set_history(job["history"])  # what load_history does
        if warning:
            rec["history_warning"] = warning

    # Ticket 63: what the run wrote into GA's memory, however it wrote it
    # (file_write, file_patch or code of its own), from the memory
    # directory before and after; GA's own count of memory reads
    # (`file_access_stats.json`, ga.log_memory_access) is not a write.
    memory_before = memory_snapshot(state_root / "memory")
    threading.Thread(target=agent.run, daemon=True).start()
    started = time.time()
    rec["started_at"] = started
    dq = agent.put_task(job["message"], source="workbench")
    done = None
    limit = SANDBOX_RUN_TIMEOUT_S if sandbox else RUN_TIMEOUT_S
    while time.time() - started < limit:
        try:
            item = dq.get(timeout=5)
        except Exception:
            continue
        if "done" in item:
            done = item
            break
    latency = time.time() - started

    result = build_result(job, rec, done, latency)
    memory_after = memory_snapshot(state_root / "memory")
    result["memory_changes"] = {
        "added": sorted(set(memory_after) - set(memory_before)),
        "changed": sorted(k for k in set(memory_before) & set(memory_after) if memory_before[k] != memory_after[k]),
        "removed": sorted(set(memory_before) - set(memory_after)),
    }
    if sandbox:
        result["sandbox"] = {"launched": SANDBOX_EXEC["launched"], "refused": list(REFUSED)}
    if job.get("dry"):
        result["guard_selftest"] = guard_selftest(real_home)
    # The result lives outside the sandbox (and outside the write guard).
    with REAL_OPEN(job["result_path"], "w", encoding="utf-8") as f:
        f.write(json.dumps(result, ensure_ascii=False, indent=2))
    sys.stdout.flush()
    os._exit(0)


def memory_snapshot(root: Path) -> dict[str, str]:
    """Each file under GA's memory directory, by path, with a hash of what
    it holds (ticket 63); GA's count of memory reads left out."""
    import hashlib

    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.name != "file_access_stats.json" and "__pycache__" not in p.parts:
            with REAL_OPEN(p, "rb") as f:
                out[str(p.relative_to(root))] = hashlib.sha256(f.read()).hexdigest()
    return out


def guard_selftest(real_home: str) -> dict[str, bool]:
    """Dry test only: the guards really refuse (in the engine's process)."""
    out = {}
    probes = {
        "subprocess": lambda: subprocess.run(["/usr/bin/true"]),
        "os_system": lambda: os.system("true"),
        "dns": lambda: __import__("socket").getaddrinfo("example.com", 443),
        "write_outside": lambda: open(os.path.join(real_home, "entry-layer-eval-canary"), "w"),
    }
    for name, probe in probes.items():
        try:
            probe()
            out[name] = False
        except (PermissionError, OSError):
            out[name] = True
    return out


def build_result(job: dict[str, Any], rec: dict[str, Any], done: Any, latency: float) -> dict[str, Any]:
    responses = rec["responses"]
    last = responses[-1] if responses else {"content": "", "thinking": ""}
    reply = last["content"]
    status = "ok"
    if done is None:
        status = "timeout"
    elif not responses:
        status = "error"
    elif any(r["content"].startswith("!!!Error") or "[!!! 流异常中断" in r["content"]
             for r in responses):
        status = "error"
    m = SUGGESTION_RE.search(reply)
    first = rec["requests"][0] if rec["requests"] else {}
    result = {
        "id": job["case_id"],
        "variant": job["variant"],
        "status": status,
        "reply": reply,
        "next_suggestion": m.group(1).strip() if m else None,
        "tool_call": rec["intercepted"],
        "tool_calls_in_reply": last.get("tool_calls", []),
        "thinking": last.get("thinking") or None,
        "llm_calls": len(rec["requests"]),
        "turns": responses,
        "usage": rec["usage"],
        "latency_s": round(latency, 2),
        "do_calls": list(rec["do_calls"]),
        "blocked": list(rec["blocked"]),
        "history_warning": rec.get("history_warning"),
        "request": first if job.get("keep_request") else None,
        "request_shape": {
            "model": first.get("model"),
            "reasoning_effort": first.get("reasoning_effort"),
            "temperature": first.get("temperature", "(default)"),
            "stream": first.get("stream"),
            "message_roles": [msg.get("role") for msg in first.get("messages", [])],
            "tools": [t.get("function", t).get("name") for t in first.get("tools", [])],
        },
    }
    if job.get("dry"):
        result["requests"] = rec["requests"]
    variant = job.get("dispatch_variant")
    if variant and job.get("sandbox_info"):
        calls = rec["calls"]
        if variant == "T":
            tag = rec["tag"]
            dispatch = {"dispatched": bool(tag), "via": "tag" if tag else None,
                        "brief": tag["brief"] if tag else None, "at_call": None,
                        "lookups_before": tag["calls_before"] if tag else None,
                        "count": 1 if tag else 0}
            after = [c for c in calls if tag and c["turn"] >= tag["turn"]]
        else:
            ds = [d for d in rec["dispatches"] if d["via"] == ("cli" if variant == "C" else "tool")]
            first = ds[0] if ds else None
            dispatch = {"dispatched": bool(first), "via": first["via"] if first else None,
                        "brief": first["brief"] if first else None,
                        "parent": first.get("parent") if first else None,
                        "at_call": first["call"] if first else None,
                        "lookups_before": first["call"] - 1 if first else None,
                        "count": len(ds), "all": ds}
            after = [c for c in calls if first and c["n"] > first["call"]]
        if rec["stop_reason"]:
            stop = rec["stop_reason"]
        elif done is None:
            stop = "timeout"
        elif responses and not responses[-1]["tool_calls"]:
            stop = "final_reply"
        else:
            stop = "other"
        result.update({
            "should_dispatch": job.get("should_dispatch"),
            "dispatch": dispatch,
            "calls": calls,
            "after_dispatch": ({"calls": [c["n"] for c in after],
                                "final_reply": reply if stop == "final_reply" else None}
                               if dispatch["dispatched"] else None),
            "stop_reason": stop,
            "final_reply": reply,
            "first_reply": responses[0]["content"] if responses else "",
        })
    elif job.get("wake"):
        if rec["stop_reason"]:
            stop = rec["stop_reason"]
        elif done is None:
            stop = "timeout"
        elif responses and not responses[-1]["tool_calls"]:
            stop = "final_reply"
        else:
            stop = "other"
        result.update({
            "wording": job["wording"],
            "repeat": job["repeat"],
            "message": job["message"],
            "calls": rec["calls"],
            "stop_reason": stop,
            "final_reply": reply,
        })
        if job.get("suite") in ("schedule", "todo", "chat", "memo"):
            result.update({"suite": job["suite"], "now": job["now"], "started_at": rec.get("started_at")})
    elif variant:
        call = rec["dispatch_call"]
        tag = SUBTASK_TAG_RE.search(responses[0]["content"]) if responses else None
        if variant == "T":
            dispatch = {"dispatched": bool(tag), "via": "tag" if tag else None,
                        "brief": tag.group(1).strip() if tag else None, "call": None}
        else:
            brief = None
            if call and variant == "P":
                brief = call["args"].get("task")
            elif call:
                brief = cli_brief(call.get("command"))
            dispatch = {"dispatched": call is not None,
                        "via": ("cli" if variant == "C" else "tool") if call else None,
                        "brief": brief, "call": call}
        result["should_dispatch"] = job.get("should_dispatch")
        result["dispatch"] = dispatch
        result["first_reply"] = responses[0]["content"] if responses else ""
        if call:
            stopping = rec["intercepted"]
            continued = [r for r in responses if r["turn"] > call["turn"]]
            result["after_dispatch"] = {
                # The next tool call (same reply or the next one), if any;
                # otherwise the model's final reply after the fake result.
                "tool_call": stopping,
                "same_reply": bool(stopping and stopping.get("turn") == call["turn"]),
                "reply": continued[-1]["content"] if continued else None,
                "final_reply": (continued[-1]["content"]
                                if continued and stopping is None else None),
            }
    return result


# ======================================================================
# Parent: jobs, results
# ======================================================================


def path_parents(path: str) -> list[str]:
    out = []
    while True:
        out.append(path)
        nxt = os.path.dirname(path)
        if nxt == path:
            return out
        path = nxt


def sandbox_profile(sandbox: str, py_root: str, galley: str, extra_exec: tuple[str, ...] = ()) -> str:
    """A deny-by-default macOS sandbox (sandbox-exec) for the model's code:
    it may run the Python interpreter and bash / sh (what code_run itself
    starts) and the fake galley, and no other program; read and write
    only inside the sandbox (plus the system libraries and the
    interpreter it needs to start); no network at all (TCP, DNS and Unix
    sockets, so not Galley Core either). extra_exec (wake suite): a few
    more system programs, under the same file and network rules."""
    def lit(p: str) -> str:
        return '(literal "' + p + '")'

    def sub(p: str) -> str:
        return '(subpath "' + p + '")'

    meta = sorted(set(path_parents(sandbox) + path_parents(py_root)
                      + ["/private/var", "/var", "/private/etc", "/etc", "/tmp", "/private/tmp",
                         "/bin", "/usr", "/dev", "/private/var/select"]))
    extra = "".join(" " + lit(p) for p in extra_exec)
    return "\n".join([
        "(version 1)",
        "(deny default)",
        "(allow process-fork)",
        "(allow signal (target same-sandbox))",
        "(allow sysctl-read)",
        f"(allow process-exec {sub(py_root)} {lit('/bin/bash')} {lit('/bin/sh')} {lit(galley)}{extra})",
        f"(allow file-read* {lit('/')} {sub(sandbox)} {sub(py_root)} {sub('/System')} {sub('/usr/lib')}"
        f" {sub('/usr/share')} {sub('/private/var/db/timezone')} {lit('/private/etc/localtime')}"
        f" {lit('/private/var/select/sh')} {lit('/bin/bash')} {lit('/bin/sh')} {lit('/dev/null')}"
        f" {lit('/dev/urandom')} {lit('/dev/random')} {lit('/dev/zero')}{extra})",
        "(allow file-read-metadata " + " ".join(lit(p) for p in meta) + ")",
        f"(allow file-map-executable {sub('/System')} {sub('/usr/lib')} {sub(py_root)}"
        f" {lit('/bin/bash')} {lit('/bin/sh')}{extra})",
        f"(allow file-write* {sub(sandbox)} {lit('/dev/null')})",
        f"(allow file-ioctl {lit('/dev/null')})",
        "",
    ])


def manual_parts() -> list[Path]:
    """The manual's parts in the repo (ticket 59), by name."""
    return sorted(MANUAL_DIR.glob("*.md"))


def manual_sha() -> str:
    """Which version of the assistant manual a run read (first 8 hex of a
    SHA-256 over every part, name and bytes, in name order; ticket 59 —
    before it, of the single file); results.json keeps it per run."""
    import hashlib

    h = hashlib.sha256()
    for part in manual_parts():
        h.update(part.name.encode("utf-8") + b"\0" + part.read_bytes() + b"\0")
    return h.hexdigest()[:8]


def write_screenshot(path: Path, lines: list[str]) -> None:
    """A real PNG that looks like a 1440 x 900 page capture with the given
    lines of text (Pillow), so a model checking the evidence finds a valid
    image of plausible size; without Pillow, a valid blank one."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        import struct
        import zlib

        w, h = 1440, 900
        raw = b"".join(b"\x00" + b"\xf4\xf4\xf4" * w for _ in range(h))

        def chunk(kind: bytes, data: bytes) -> bytes:
            return (struct.pack(">I", len(data)) + kind + data
                    + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

        path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                         + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
        return
    img = Image.new("RGB", (1440, 900), (244, 244, 244))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1440, 72), fill=(32, 48, 80))
    try:
        font = ImageFont.load_default(size=30)
    except TypeError:
        font = ImageFont.load_default()
    for i, line in enumerate(lines):
        draw.text((60, 18 if i == 0 else 160 + 70 * i), line, fill=(255, 255, 255) if i == 0 else (20, 20, 20),
                  font=font)
    img.save(path, "PNG")


def build_sandbox(run_dir: Path, python: str, wake: dict[str, Any] | None = None) -> dict[str, Any]:
    """One run's sandbox: a fake HOME with fixture files in ~/Downloads and
    ~/.config/galley/cli-path pointing at the fake galley, a tmp dir, a
    log for the fake CLI, and (outside the sandbox) the profile.

    wake (wake suite): the case's evidence files instead of the dispatch
    fixtures, the fixture-driven fake galley, `python3` on PATH (a link
    to this interpreter) and the extra system programs."""
    root = Path(os.path.realpath(run_dir)) / "sandbox"
    home = root / "home"
    downloads = home / "Downloads"
    downloads.mkdir(parents=True)
    if wake is None:
        for name, text in FIXTURE_PDFS.items():
            (downloads / name).write_bytes(
                f"%PDF-1.4\n% placeholder fixture\n% {text}\n%%EOF\n".encode())
        for name, data in FIXTURE_OTHER.items():
            (downloads / name).write_bytes(data)
        for name, size in FIXTURE_SPARSE.items():
            with open(downloads / name, "wb") as f:
                f.truncate(size)
    else:
        for name, content in wake["files"].items():
            (downloads / name).parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, dict) and "png" in content:
                write_screenshot(downloads / name, content["png"])
            else:
                (downloads / name).write_text(content, encoding="utf-8")
    (root / "tmp").mkdir()
    (root / "log").mkdir()
    (root / "bin").mkdir()
    galley = root / "bin" / "galley"
    log = root / "log" / "galley-calls.jsonl"
    py_real = os.path.realpath(python)
    info: dict[str, Any] = {}
    if wake is None:
        galley.write_text(FAKE_GALLEY.format(python=py_real, log=str(log),
                                             fake_start=repr(FAKE_SUBTASK_STDOUT)), encoding="utf-8")
    else:
        data = root / "galley-data"
        data.mkdir()
        (data / "fixture.json").write_text(json.dumps(wake["fixture"], ensure_ascii=False).replace(HOME_MARK, str(home)),
                                           encoding="utf-8")
        shutil.copyfile(wake.get("help") or WAKE_CLI_HELP, data / "help.json")
        galley.write_text(FAKE_GALLEY_WAKE.replace("__PYTHON__", py_real)
                          .replace("__FIXTURE__", str(data / "fixture.json"))
                          .replace("__STATE__", str(data / "state.json"))
                          .replace("__LOG__", str(log)).replace("__HELP__", str(data / "help.json")),
                          encoding="utf-8")
        pybin = root / "pybin"
        pybin.mkdir()
        (pybin / "python3").symlink_to(py_real)
        info["path_env"] = f"{pybin}:/usr/bin:/bin"
        info["fake_state"] = str(data / "state.json")
    galley.chmod(0o755)
    (home / ".config" / "galley").mkdir(parents=True)
    (home / ".config" / "galley" / "cli-path").write_text(str(galley) + "\n", encoding="utf-8")
    py_root = str(Path(py_real).parents[1])
    profile = Path(os.path.realpath(run_dir)) / "sandbox.sb"
    extra_exec = tuple(wake.get("extra_exec") or WAKE_EXTRA_EXEC) if wake is not None else ()
    profile.write_text(sandbox_profile(str(root), py_root, str(galley), extra_exec), encoding="utf-8")
    return dict(info, root=str(root), home=str(home), profile=str(profile), galley=str(galley),
                galley_log=str(log), py_root=py_root)


def downloads_snapshot(home: Path) -> dict[str, int]:
    base = home / "Downloads"
    if not base.is_dir():
        return {}
    return {str(p.relative_to(base)): p.stat().st_size for p in sorted(base.rglob("*")) if p.is_file()}


def home_snapshot(home: Path) -> dict[str, int]:
    """Ticket 108: every file in the fake HOME but the fake galley's
    discovery file (~/.config), by path relative to it, with its size."""
    if not home.is_dir():
        return {}
    return {str(p.relative_to(home)): p.stat().st_size for p in sorted(home.rglob("*"))
            if p.is_file() and p.relative_to(home).parts[:1] != (".config",)}


def seeded_state_root(parent: Path) -> Path:
    """A fresh managed state root as a first launch leaves it: the memory
    seed copied in (managed_runtime::ensure_memory_seed copies missing
    files; the root is empty, so everything)."""
    root = parent / "managed-ga-state"
    shutil.copytree(STATE_SEED / "memory", root / "memory")
    return root


def run_job(job: dict[str, Any], python: str, workdir: Path) -> dict[str, Any]:
    run_dir = workdir / f"{job['case_id']}.{job['variant']}"
    run_dir.mkdir(parents=True)
    job = dict(job)
    sandbox = None
    if job.get("sandbox"):
        sandbox = build_sandbox(run_dir, python, job.get("wake"))
        job["sandbox_info"] = sandbox
        # Ticket 73: the case's `{{HOME}}` paths are this run's fake HOME.
        job["message"] = job["message"].replace(HOME_MARK, sandbox["home"])
        job["history"] = [dict(m, content=m["content"].replace(HOME_MARK, sandbox["home"]))
                          for m in job.get("history") or []]
        state_root = seeded_state_root(Path(sandbox["root"]))
        job["state_root"] = str(state_root)
        if job.get("wake"):
            # Where Core writes it (assistant_manual::materialize: every
            # part, nothing else), and the directory the entry layer names.
            manual = state_root.joinpath(*MANUAL_STATE_DIR)
            manual.mkdir(parents=True)
            for part in manual_parts():
                shutil.copyfile(part, manual / part.name)
            job["manual_dir"] = str(manual)
            job["manual_sha"] = manual_sha()
            job["galley_prompt"] = job["galley_prompt"].replace("__MANUAL_DIR__", str(manual))
        before = downloads_snapshot(Path(sandbox["home"]))
        home_before = home_snapshot(Path(sandbox["home"]))
    else:
        job["state_root"] = str(seeded_state_root(run_dir))
    job["result_path"] = str(run_dir / "result.json")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GALLEY", "GA_"))}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["EVAL_CANARY"] = str(run_dir / "canary")
    log = open(run_dir / "worker.log", "w", encoding="utf-8")
    timeout = SANDBOX_RUN_TIMEOUT_S if sandbox else RUN_TIMEOUT_S
    try:
        proc = subprocess.run(
            [python, str(Path(__file__).resolve()), "--worker"],
            input=json.dumps(job, ensure_ascii=False),
            text=True, encoding="utf-8", stdout=log, stderr=log, env=env, cwd=str(run_dir),
            timeout=timeout + 60,
        )
        code = proc.returncode
    except subprocess.TimeoutExpired:
        code = -1
    finally:
        log.close()
    path = Path(job["result_path"])
    if path.is_file():
        result: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    else:
        tail = (run_dir / "worker.log").read_text(encoding="utf-8", errors="replace")[-1500:]
        result = {"id": job["case_id"], "variant": job["variant"], "status": "error",
                  "reply": "", "error": f"worker exit {code}: {tail}"}
    result["canaries"] = sorted(p.name for p in run_dir.glob("canary*"))
    if job.get("manual_sha"):
        result["manual_sha"] = job["manual_sha"]
    if job.get("manual_dir"):
        # What the manual's directory held when the run ended (a part the
        # model wrote or removed would show here).
        result["manual_files"] = sorted(os.listdir(job["manual_dir"]))
    if job.get("suite") in ("schedule", "todo", "chat", "memo"):
        # What the fake galley ended with (tasks and to-dos made, changed,
        # cancelled; since ticket 96 memos and their writes), and what it
        # started with.
        state_path = Path(sandbox["fake_state"]) if sandbox and sandbox.get("fake_state") else None
        if state_path and state_path.is_file():
            result["fake_state"] = json.loads(state_path.read_text(encoding="utf-8"))
        result["fixture_tasks"] = job["wake"]["fixture"]["tasks"]
        # Ticket 108: as the fake galley started with them, the case's
        # `{{HOME}}` paths this run's fake HOME (build_sandbox fills the
        # fixture so), so the judge compares notes with what it read.
        result["fixture_todos"] = json.loads(json.dumps(job["wake"]["fixture"].get("todos") or [],
                                                        ensure_ascii=False).replace(HOME_MARK, sandbox["home"]))
        result["fixture_memos"] = job["wake"]["fixture"].get("memos") or []
    if sandbox:
        after = downloads_snapshot(Path(sandbox["home"]))
        result["downloads_changes"] = {
            "removed": sorted(set(before) - set(after)),
            "added": sorted(set(after) - set(before)),
            "resized": sorted(k for k in set(before) & set(after) if before[k] != after[k]),
        }
        # Ticket 108: the files the run made anywhere in its fake HOME (a
        # comparison it wrote to ~/Documents as well as to ~/Downloads),
        # by absolute path, as a progress line would name them.
        home_after = home_snapshot(Path(sandbox["home"]))
        result["home_added"] = sorted(str(Path(sandbox["home"]) / k) for k in set(home_after) - set(home_before))
        log_path = Path(sandbox["galley_log"])
        result["galley_log"] = ([json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
                                 if line.strip()] if log_path.is_file() else [])
        if not job.get("wake"):
            result["fixtures"] = {"pdfs": len(FIXTURE_PDFS), "other": sorted(FIXTURE_OTHER),
                                  "sparse": FIXTURE_SPARSE}
    return result


def make_jobs(cases: list[dict[str, Any]], variants: list[str], now: datetime, draft: str,
              mykeys: dict[str, Any], ga_lang: str, allowed_hosts: set[str],
              dry: str | None = None) -> list[dict[str, Any]]:
    jobs = []
    for case in cases:
        for variant in variants:
            jobs.append({
                "case_id": case["id"],
                "variant": variant,
                "message": case["message"],
                "history": [{"role": m["role"], "content": m["content"]}
                            for m in case.get("history") or []],
                "galley_prompt": galley_runtime_prompt(case, variant, now, draft),
                "mykeys": mykeys,
                "ga_lang": ga_lang,
                "allowed_hosts": sorted(allowed_hosts),
                "keep_request": case["id"] in DUMP_CASES or bool(dry),
                "dry": dry,
            })
    return jobs


def make_dispatch_jobs(cases: list[dict[str, Any]], variants: list[str], now: datetime,
                       draft: str, mykeys: dict[str, Any], ga_lang: str,
                       allowed_hosts: set[str], dry: str | None = None,
                       sandbox: bool = False) -> list[dict[str, Any]]:
    """Ticket 06: each case under T / C / P. No history, not carried.
    sandbox: the second run's mode (lookups answered from a sandbox)."""
    clauses = load_dispatch_clauses()
    jobs = []
    for case in cases:
        if case.get("history"):
            fail(f"dispatch case {case['id']} has history; this suite runs without it")
        for variant in variants:
            jobs.append({
                "case_id": case["id"],
                "variant": variant,
                "dispatch_variant": variant,
                "should_dispatch": case.get("should_dispatch"),
                "message": case["message"],
                "history": [],
                "galley_prompt": dispatch_prompt(case, variant, now, draft, clauses),
                "extra_tools": [START_SUBTASK_TOOL] if variant == "P" else [],
                "mykeys": mykeys,
                "ga_lang": ga_lang,
                "allowed_hosts": sorted(allowed_hosts),
                "keep_request": case["id"] in DISPATCH_DUMP_CASES or bool(dry),
                "dry": dry,
                "sandbox": sandbox,
            })
    return jobs


def make_wake_jobs(cases: list[dict[str, Any]], wordings: list[str], now: datetime,
                   mykeys: dict[str, Any], ga_lang: str, allowed_hosts: set[str], repeats: int,
                   dry: str | None = None) -> list[dict[str, Any]]:
    """Ticket 30: each case under each wording, `repeats` times. Sandbox
    mode: the model's tool calls run in the run's sandbox, its CLI calls
    reach only the fixture-driven fake galley."""
    words = load_wording()
    prompt = wake_prompt(now)
    jobs = []
    for case in cases:
        case = wake_dated(case, now)
        for wording in wordings:
            if wording not in words:
                fail(f"no wording {wording!r} in wording.md ({', '.join(words)})")
            message = wake_note(case, words[wording])
            for n in range(1, repeats + 1):
                jobs.append({
                    "case_id": case["id"],
                    "variant": f"{wording}-{n}",
                    "wording": wording,
                    "repeat": n,
                    "message": message,
                    "history": [{"role": m["role"], "content": m["content"]} for m in case["history"]],
                    "galley_prompt": prompt,
                    "mykeys": mykeys,
                    "ga_lang": ga_lang,
                    "allowed_hosts": sorted(allowed_hosts),
                    "keep_request": (case["id"] in WAKE_DUMP_CASES and n == 1) or bool(dry),
                    "dry": dry,
                    "sandbox": True,
                    "tool_cap": WAKE_TOOL_CAP,
                    "wake": {"fixture": wake_fixture(case, now), "files": case.get("files") or {}},
                })
    return jobs


def make_sched_jobs(cases: list[dict[str, Any]], now: datetime, mykeys: dict[str, Any], ga_lang: str,
                    allowed_hosts: set[str], repeats: int, dry: str | None = None,
                    first: int = 1, suite: str = "schedule") -> list[dict[str, Any]]:
    """Ticket 36: each case `repeats` times, numbered from `first`. The
    wake suite's sandbox, with the case's tasks in the fake galley; the
    user's message, or the wake note for the reminders that came due.
    `now` is local and aware."""
    jobs = []
    for case in cases:
        case = clock_case(case, now)
        message = case.get("message") or sched_note(case, now)
        for n in range(first, first + repeats):
            jobs.append({
                "case_id": case["id"],
                "variant": f"r{n}",
                "wording": "manual",
                "repeat": n,
                "suite": suite,
                "now": now.isoformat(timespec="seconds"),
                "message": message,
                "history": [{"role": m["role"], "content": m["content"]} for m in case["history"]],
                "galley_prompt": sched_prompt(case, now),
                "mykeys": mykeys,
                "ga_lang": ga_lang,
                "allowed_hosts": sorted(allowed_hosts),
                "keep_request": (case["id"] in {"todo": TODO_DUMP_CASES, "memo": MEMO_DUMP_CASES}.get(
                    suite, SCHED_DUMP_CASES) and n == 1) or bool(dry),
                # Ticket 96: a case's browser lookup answers "no browser
                # connected" instead of ending the run.
                "web_unavailable": case.get("web") == "unavailable",
                "dry": dry,
                "sandbox": True,
                "tool_cap": SCHED_TOOL_CAP,
                # Ticket 108: a case's files go in ~/Downloads, as the
                # wake suite's do (the to-do whose quotes are there).
                "wake": {"fixture": sched_fixture(case, now), "files": case.get("files") or {},
                         "help": str(SCHED_CLI_HELP), "extra_exec": list(SCHED_EXTRA_EXEC)},
            })
    return jobs


def run_jobs(jobs: list[dict[str, Any]], python: str, parallel: int,
             keep_temp: bool) -> list[dict[str, Any]]:
    workdir = Path(tempfile.mkdtemp(prefix="entry-layer-eval-"))
    os.chmod(workdir, 0o700)
    refuse_real_data(workdir)
    results: list[dict[str, Any]] = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as pool:
            futures = {pool.submit(run_job, job, python, workdir): job for job in jobs}
            for n, fut in enumerate(concurrent.futures.as_completed(futures), 1):
                r = fut.result()
                tool = r.get("tool_call")
                dispatched = (r.get("dispatch") or {}).get("dispatched")
                print(f"[{n}/{len(jobs)}] {r['id']} {r['variant']}: {r['status']} "
                      f"{r.get('latency_s', '-')}s"
                      + (" dispatched" if dispatched else "")
                      + (f" calls={r.get('llm_calls')}" if r.get("llm_calls", 1) > 1 else "")
                      + (f" tool={tool['name']}" if tool else "")
                      + (f" ({r.get('error', '')[:200]})" if r["status"] != "ok" else ""),
                      flush=True)
                results.append(r)
    finally:
        if keep_temp:
            print(f"temp kept: {workdir}")
        else:
            shutil.rmtree(workdir, ignore_errors=True)
    return results


def write_composed(result: dict[str, Any], prefix: str = "", directory: Path = COMPOSED_DIR) -> None:
    """The full (first) request of one run, as sent: system prompt,
    history, the new message, and the tools offered (names only, plus the
    full schema of the harness's own start_subtask when offered)."""
    req = result.get("request") or {}
    if not req:
        return
    directory.mkdir(exist_ok=True)
    names = [t.get("function", t).get("name") for t in req.get("tools", [])]
    lines = [
        f"# Request sent to the model: {result['id']} / {result['variant']}",
        f"# model={req.get('model')} reasoning_effort={req.get('reasoning_effort')} "
        f"stream={req.get('stream')} temperature={req.get('temperature', '(default)')}",
        "# tools offered: " + ", ".join(names),
    ]
    for tool in req.get("tools", []):
        if tool.get("function", {}).get("name") == "start_subtask":
            lines.append("# start_subtask schema: " + json.dumps(tool, ensure_ascii=False))
    lines.append("")
    for msg in req.get("messages", []):
        content = msg.get("content")
        if isinstance(content, list):
            content = "\n".join(b.get("text", f"[{b.get('type')}]") for b in content
                                if isinstance(b, dict))
        lines += [f"======== {msg.get('role')} ========", str(content), ""]
    path = directory / f"{prefix}{result['id']}.{result['variant']}.txt"
    path.write_text(scrub("\n".join(lines)), encoding="utf-8")


def strip_for_display(reply: str) -> str:
    """What the conversation shows (gui/src/lib/ipc/ga-output-cleaning.ts
    drops these tags); the raw reply stays in results.json."""
    body = SUGGESTION_RE.sub("", reply)
    body = SUMMARY_RE.sub("", body)
    body = THINKING_RE.sub("", body)
    # A Markdown hard break written as trailing spaces becomes the
    # backslash form: same rendering, no trailing whitespace in the file.
    body = re.sub(r"[ \t]{2,}$", "\\\\", body, flags=re.MULTILINE)
    body = re.sub(r"[ \t]+$", "", body, flags=re.MULTILINE)
    return body.strip()


def tool_line(tool: dict[str, Any]) -> str:
    args = json.dumps(tool.get("args") or {}, ensure_ascii=False)
    args = re.sub(r"\s+", " ", args)
    if len(args) > 160:
        args = args[:160] + "…"
    return f"「（要调用工具：{tool['name']}，{args}）」"


def fenced(content: str, lang: str = "text") -> list[str]:
    fence = "~~~~" if "```" in content else "```"
    body = re.sub(r"[ \t]+$", "", content.strip("\n"), flags=re.MULTILINE)
    return [f"{fence}{lang}", body, fence, ""]


def tool_block(tool: dict[str, Any]) -> list[str]:
    """A tool call with its full arguments (the script as code)."""
    args = dict(tool.get("args") or {})
    script = args.pop("script", None) or args.pop("code", None)
    lines = [f"「（要调用工具：{tool['name']}，完整参数如下）」", ""]
    if args:
        lines += fenced(json.dumps(args, ensure_ascii=False, indent=1), "json")
    if script:
        lines += fenced(str(script), "python" if tool["name"] == "code_run"
                        and args.get("type", "python") == "python" else "")
    return lines


def reply_lines(raw: str | None) -> list[str]:
    """A reply as the conversation shows it, plus the hidden summary."""
    if not raw:
        return []
    out = []
    body = strip_for_display(SUBTASK_TAG_RE.sub("", raw))
    if body:
        out += [body, ""]
    summary = re.search(r"<summary>([\s\S]*?)</summary>", raw)
    if summary and summary.group(1).strip():
        out += [f"（界面不显示的 summary：{summary.group(1).strip()}）", ""]
    return out


DISPATCH_TITLES = {"T": "T（回复里写标签）", "C": "C（CLI 命令）", "P": "P（原生工具 start_subtask）"}


def render_dispatch_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_key = {(r["id"], r["variant"]): r for r in data["results"]}
    out = [
        "# 派活方式对照结果（票 06）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；运行于 {meta['ran_at']}。",
        "三组都是入口层草稿（draft.md）加各自的派活条款，P 另多一个工具 start_subtask。"
        "工具一律不执行：C / P 的第一次工具调用若是派活，就回一个假的成功结果让模型继续，"
        "停在它的下一次工具调用或最终回复；其他工具调用当场停下。",
        "回复正文按对话界面的样子去掉了 `<summary>` 与 `<next-suggestion>` 标签（T 组另去掉 `<subtask>`，"
        "派活内容单列），summary 另起一行注明，原文见 dispatch-results.json。",
        "",
    ]
    for case in cases:
        if not any((case["id"], v) in by_key for v in DISPATCH_VARIANTS):
            continue
        should = {True: "是", False: "否"}.get(case.get("should_dispatch"), "未定")
        out += [f"## {case['id']}（应派活：{should}）", "", f"**消息**：{case['message']}", ""]
        for variant in DISPATCH_VARIANTS:
            r = by_key.get((case["id"], variant))
            out += [f"### {DISPATCH_TITLES[variant]}", ""]
            if r is None:
                out += ["（未运行）", ""]
                continue
            if r["status"] != "ok":
                out += [f"（运行失败：{r['status']}）", ""]
                continue
            d = r["dispatch"]
            after = r.get("after_dispatch")
            out += reply_lines(r.get("first_reply"))
            if variant == "T":
                if d["dispatched"]:
                    out += ["派活：是（`<subtask>` 标签）", "", "派活内容：", ""]
                    out += fenced(d["brief"] or "")
                elif r.get("tool_call"):
                    out += ["派活：否（回复里没有 `<subtask>`，先调用了工具，运行停在这里）", ""]
                    out += tool_block(r["tool_call"])
                else:
                    out += ["派活：否", ""]
            elif d["dispatched"]:
                how = ("第一次工具调用是 `galley subtask start`" if variant == "C"
                       else "第一次工具调用是 `start_subtask`")
                out += [f"派活：是（{how}，已回假结果）", "", "派活内容：", ""]
                out += fenced(d["brief"] if d["brief"] is not None
                              else "（没能从命令里单独取出任务参数，见下方完整命令）")
                if variant == "C":
                    out += ["完整命令：", ""]
                    out += fenced(d["call"].get("command") or "", "bash")
                if after and after.get("same_reply"):
                    out += ["假结果之后：同一条回复里紧接着又调用了工具，运行停在这里：", ""]
                    out += tool_block(after["tool_call"])
                else:
                    out += ["假结果之后：", ""]
                    out += reply_lines(after.get("reply") if after else None)
                    if after and after.get("tool_call"):
                        out += ["接着又调用了工具，运行停在这里：", ""]
                        out += tool_block(after["tool_call"])
                    elif not (after and after.get("reply")):
                        out += ["（没有后续回复）", ""]
            elif r.get("tool_call"):
                out += ["派活：否（第一次工具调用不是派活，运行停在这里）", ""]
                out += tool_block(r["tool_call"])
            else:
                out += ["派活：否", ""]
            if r.get("next_suggestion"):
                out += [f"建议：{r['next_suggestion']}", ""]
    return "\n".join(out).rstrip() + "\n"


def render_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_key = {(r["id"], r["variant"]): r for r in data["results"]}
    out = [
        "# 主对话入口层对照结果（票 03d）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；运行于 {meta['ran_at']}。",
        "每个用例 WITHOUT（现状提示词）与 WITH（现状加 draft.md 入口层）各跑一次，工具调用一律拦下不执行。",
        "回复正文按对话界面的样子去掉了 `<summary>` 与 `<next-suggestion>` 标签，"
        "summary 另起一行注明，建议单列一行，原文见 results.json。",
        "",
    ]
    for case in cases:
        if not any((case["id"], v) in by_key for v in VARIANTS):
            continue
        out += [f"## {case['id']}（{case.get('group', '')}）", ""]
        if case.get("history"):
            where = (f"从分段前带过来，最后一条在 {case.get('hours_ago')} 小时前"
                     if case.get("carried") else "上下文里已有")
            out.append(f"上下文（{where}）：")
            out.append("")
            for m in case["history"]:
                who = "用户" if m["role"] == "user" else "助手"
                out.append(f"> {who}：{m['content']}")
            out.append("")
        out += [f"**消息**：{case['message']}", ""]
        for variant, title in (("without", "WITHOUT（现状）"), ("with", "WITH（加入口层）")):
            r = by_key.get((case["id"], variant))
            out += [f"### {title}", ""]
            if r is None:
                out += ["（未运行）", ""]
                continue
            if r["status"] != "ok":
                out += [f"（运行失败：{r['status']}）", ""]
                continue
            body = strip_for_display(r.get("reply", ""))
            if body:
                out += [body, ""]
            summary = re.search(r"<summary>([\s\S]*?)</summary>", r.get("reply", ""))
            if summary and summary.group(1).strip():
                out += [f"（界面不显示的 summary：{summary.group(1).strip()}）", ""]
            if r.get("tool_call"):
                out += [tool_line(r["tool_call"]), ""]
            if r.get("next_suggestion"):
                out += [f"建议：{r['next_suggestion']}", ""]
    return "\n".join(out).rstrip() + "\n"


STOP_LABELS = {
    "final_reply": "以最终回复结束",
    "web_tool": "要用浏览器工具，运行停在这里（没有执行）",
    "ask_user": "要问用户（ask_user），运行停在这里",
    "cap_reached": f"第 {SANDBOX_TOOL_CAP + 1} 次工具调用，达到 {SANDBOX_TOOL_CAP} 次上限，运行停在这里（没有执行）",
    "inline_eval": "要用 inline_eval（会在引擎进程里执行），运行停在这里（没有执行）",
    "unknown_tool": "调用了沙盒里没有的工具，运行停在这里",
    "timeout": "超时",
    "other": "其他",
}


def outcome_label(outcome: str) -> str:
    if outcome == "run in the sandbox":
        return "在沙盒里执行"
    if outcome == "fake result":
        return "没有执行，回了假的成功结果"
    if outcome == "fake result: no browser connected":
        return "没有执行，回了 GA 没连浏览器时的报错"
    if outcome.startswith("refused"):
        return "越界，按 GA 原本的报错格式拒绝"
    if outcome.startswith("not run: cap"):
        return f"没有执行（已到 {SANDBOX_TOOL_CAP} 次上限）"
    if outcome.startswith("not run: inline_eval"):
        return "没有执行（inline_eval 会在引擎进程里执行）"
    if outcome.startswith("not run: no such tool"):
        return "没有执行（沙盒里没有这个工具）"
    if outcome.startswith("not run"):
        return "没有执行，运行停在这里"
    return outcome


def trunc(text: str, limit: int) -> str:
    text = str(text)
    return text if len(text) <= limit else text[:limit] + "\n…（截断，全文见 json）"


def call_gist(call: dict[str, Any]) -> str:
    """One call in a few words: the tool, what fake galley got, sleeps."""
    bits = [call["name"]]
    for argv in call.get("galley_calls") or []:
        words = [a for a in argv if not a.startswith("--")]
        bits.append("galley " + " ".join(words[:2]))
    script = str(call["args"].get("script") or call["args"].get("code") or "")
    if re.search(r"\bsleep\b|time\.sleep", script):
        bits.append("含 sleep")
    if call["name"] in ("file_read", "file_write", "file_patch"):
        bits.append(os.path.basename(str(call["args"].get("path", ""))))
    if call.get("outcome", "").startswith("not run"):
        bits.append("未执行")
    elif call.get("outcome", "").startswith("refused"):
        bits.append("被拒")
    return "（".join([bits[0], "，".join(bits[1:]) + "）"]) if len(bits) > 1 else bits[0]


def sandbox_facts(r: dict[str, Any]) -> tuple[str, str, str]:
    """Per run: dispatched (when, after how many calls), what followed,
    and signs of doing the work itself. Facts only."""
    d = r["dispatch"]
    calls = r.get("calls") or []
    if d["dispatched"]:
        if d["via"] == "tag":
            when = f"是，`<subtask>` 写在回复里（之前 {d['lookups_before']} 次工具调用）"
        else:
            when = f"是，第 {d['at_call']} 次工具调用（之前 {d['lookups_before']} 次）"
        if d.get("count", 1) > 1:
            when += f"，共派 {d['count']} 次"
        after_calls = [c for c in calls if c["n"] in (r.get("after_dispatch") or {}).get("calls", [])]
        after = "；".join(f"{c['n']}. {call_gist(c)}" for c in after_calls) or "没有工具调用"
        after += "；" + STOP_LABELS.get(r["stop_reason"], r["stop_reason"])
    else:
        when = "否"
        after = "—"
    work = []
    if r["stop_reason"] == "web_tool":
        work.append("要用浏览器工具")
    ch = r.get("downloads_changes") or {}
    if ch.get("removed") or ch.get("added"):
        work.append(f"下载文件夹：移走 / 删除 {len(ch.get('removed', []))} 个，新增 {len(ch.get('added', []))} 个")
    return when, after, "；".join(work) or "—"


def render_sandbox_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_key = {(r["id"], r["variant"]): r for r in data["results"]}
    out = [
        "# 派活方式对照结果（票 06，沙盒）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；运行于 {meta['ran_at']}。",
        "三组都是入口层草稿（draft.md）加各自的派活条款，P 另多一个工具 start_subtask。"
        "这一轮查询与文件操作真的在每次运行自己的沙盒里执行：",
        "",
        "- **假数据（fixture）**：假的 HOME，`~/Downloads` 里是 30 个只有几字节的占位 PDF（名字仿真：发票、合同、论文、说明书、收据等）、"
        "3 个其他文件，以及 2 个不占磁盘的稀疏大文件（3.4 GB 与 1.3 GB）。",
        "- **假 CLI**：`~/.config/galley/cli-path` 指向一个假的 `galley`，固定回答：`sessions search` / `sessions list` 无结果，"
        "`subtask start` 返回 `s-sub0001` 正在运行，`session show s-sub0001` 返回运行中、还没有回复，其余是 `unknown_command`。",
        "- P 的 `start_subtask` 回一个假的成功结果 `{\"subtask_id\":\"s-sub0001\",\"status\":\"running\"}`。",
        "- `code_run` 在 macOS 沙盒里执行：只能读写沙盒目录，没有网络，除了解释器本身只能启动假 `galley`；"
        "`file_read` / `file_write` / `file_patch` 只能碰沙盒，越界按 GA 原本的报错格式拒绝；"
        f"浏览器工具与 `ask_user` 不执行，运行就停在那里；每次运行最多 {SANDBOX_TOOL_CAP} 次工具调用。",
        "",
        "回复正文去掉了 `<summary>` 与 `<next-suggestion>` 标签（T 组另去掉 `<subtask>`，派活内容单列），"
        "工具参数与返回在这里截断，全文与标签原文见 dispatch-results.json。",
        "",
    ]
    for s in meta.get("superseded_runs") or []:
        out += [f"注：{s['id']} / {s['variant']} 重跑过一次。第一次运行里假 `galley` 把 `subtask start --help` "
                "也当成启动、回了「已启动」，脚本还把它算成了派活；修正为 `--help` 只回一行用法、不算派活后，"
                "只重跑了这一条。下面是重跑的结果，被替换的那次原样留在 dispatch-results.json 的 "
                "`meta.superseded_runs` 里。", ""]
    out += [
        "## 一览",
        "",
        "| 用例 | 组 | 应派 | 派了吗（何时） | 派完之后 | 自己动手的迹象 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for case in cases:
        for variant in DISPATCH_VARIANTS:
            r = by_key.get((case["id"], variant))
            if r is None or r["status"] != "ok":
                status = "未运行" if r is None else f"运行失败：{r['status']}"
                out.append(f"| {case['id']} | {variant} | — | {status} | — | — |")
                continue
            when, after, work = sandbox_facts(r)
            should = {True: "是", False: "否"}.get(case.get("should_dispatch"), "—")
            if not r["dispatch"]["dispatched"]:
                calls = r.get("calls") or []
                when = "否（" + "；".join(f"{c['n']}. {call_gist(c)}" for c in calls) + "；" \
                    + STOP_LABELS.get(r["stop_reason"], r["stop_reason"]) + "）" if calls else \
                    "否（" + STOP_LABELS.get(r["stop_reason"], r["stop_reason"]) + "）"
            cell = [x.replace("|", "\\|") for x in (when, after, work)]
            out.append(f"| {case['id']} | {variant} | {should} | {cell[0]} | {cell[1]} | {cell[2]} |")
    out.append("")
    for case in cases:
        if not any((case["id"], v) in by_key for v in DISPATCH_VARIANTS):
            continue
        should = {True: "是", False: "否"}.get(case.get("should_dispatch"), "未定")
        out += [f"## {case['id']}（应派活：{should}）", "", f"**消息**：{case['message']}", ""]
        for variant in DISPATCH_VARIANTS:
            r = by_key.get((case["id"], variant))
            out += [f"### {DISPATCH_TITLES[variant]}", ""]
            if r is None:
                out += ["（未运行）", ""]
                continue
            if r["status"] != "ok":
                out += [f"（运行失败：{r['status']}）", ""]
                continue
            d = r["dispatch"]
            when, after, work = sandbox_facts(r)
            out += [f"结束：{STOP_LABELS.get(r['stop_reason'], r['stop_reason'])}。", ""]
            out += [f"派活：{when}", ""]
            if d["dispatched"]:
                out += ["派活内容：", ""]
                out += fenced(str(d["brief"]) if d["brief"] is not None else "（没有任务参数）")
                if d.get("parent"):
                    out += [f"`--parent`：`{d['parent']}`", ""]
                out += [f"派完之后：{after}", ""]
            if work != "—":
                out += [f"自己动手的迹象：{work}", ""]
            calls = r.get("calls") or []
            if calls:
                out += ["工具调用（按顺序）：", ""]
                for c in calls:
                    out += [f"{c['n']}. `{c['name']}`：{outcome_label(c.get('outcome', ''))}", ""]
                    args = dict(c["args"])
                    script = args.pop("script", None) or args.pop("code", None)
                    if args:
                        out += fenced(trunc(json.dumps(args, ensure_ascii=False, indent=1), 800), "json")
                    if script:
                        out += fenced(trunc(script, 1500), "")
                    for argv in c.get("galley_calls") or []:
                        out += ["   假 galley 收到：`" + " ".join(argv).replace("`", "'") + "`", ""]
                    if "result" in c:
                        res = c["result"]
                        res_text = res if isinstance(res, str) else json.dumps(res, ensure_ascii=False, indent=1)
                        out += ["   返回："] + [""] + fenced(trunc(res_text, 700), "")
            out += ["最终回复：" if r["stop_reason"] == "final_reply" else "最后一条回复：", ""]
            out += reply_lines(r.get("final_reply")) or ["（空）", ""]
            if r.get("next_suggestion"):
                out += [f"建议：{r['next_suggestion']}", ""]
    return "\n".join(out).rstrip() + "\n"


CLI_VALUE_FLAGS = {"tail", "around", "context", "since", "until", "supervisor", "reason", "to", "project",
                   "runtime", "status", "timeout", "poll", "after-turn", "llm", "session", "root-path",
                   "icon", "color", "schema", "at", "weekly", "monthly", "time", "target", "prompt", "name",
                   "due", "remind-at", "notes", "title"}
NO_REPLY_RE = re.compile(r"<\s*no-reply\s*/\s*>", re.IGNORECASE)
# Ticket 73: the file marker (gui/src/lib/ipc/ga-output-cleaning.ts
# FILE_REF_PATTERN), its path.
FILE_REF_RE = re.compile(r"\[FILE:([^\]]+)\]")


def shown_len(body: str) -> int:
    """Ticket 73: a reply's length as the conversation shows it: the
    `[FILE:…]` markers are not text there (Core's turn derivation and the
    GUI's cleanFinalAnswer strip them; the desktop draws a card instead),
    and an absolute path would count a hundred characters."""
    return len(re.sub(r"\n{3,}", "\n\n", FILE_REF_RE.sub("", body)).strip())


def parse_cli(argv: list[str]) -> tuple[list[str], dict[str, Any]]:
    """Positional words and flags of a galley call, as the fake galley
    reads them."""
    words: list[str] = []
    flags: dict[str, Any] = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--") and len(a) > 2:
            k, eq, v = a[2:].partition("=")
            if eq:
                flags[k] = v
            elif k in CLI_VALUE_FLAGS and i + 1 < len(argv):
                flags[k] = argv[i + 1]
                i += 1
            else:
                flags[k] = True
        elif a in ("-h", "-V"):
            flags["help"] = True
        else:
            words.append(a)
        i += 1
    return words, flags


def cli_name(argv: list[str]) -> str:
    words, flags = parse_cli(argv)
    if flags.get("help") or words[:1] == ["help"]:
        return "help"
    return " ".join(words[:1] if words[:1] in (["status"], ["version"], ["health"]) else words[:2])


def wake_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """What a wake run did, and whether it met the case's expectations
    (wake/cases.json `expect`). Facts and a verdict with its reasons."""
    exp = case["expect"]
    subtask_ids = {s["id"] for s in case["subtasks"]}
    log = [c.get("argv") or [] for c in r.get("galley_log") or []]
    names = [cli_name(a) for a in log]
    sends = []
    for argv in log:
        words, flags = parse_cli(argv)
        if words[:2] == ["session", "send"] and len(words) > 2 and words[2] in subtask_ids:
            sends.append({"id": words[2], "content": words[3] if len(words) > 3 else "",
                          "supervisor": flags.get("supervisor"), "reason": flags.get("reason"),
                          "jump": bool(flags.get("jump"))})
    held = [n for n in names if n in HOLDING_COMMANDS]
    writes = [n for n in names if n in WRITE_COMMANDS]
    reply = r.get("final_reply") or ""
    body = strip_for_display(reply)
    is_no_reply = bool(NO_REPLY_RE.fullmatch(body.strip()))
    has_no_reply = bool(NO_REPLY_RE.search(reply))
    stop = r.get("stop_reason")
    asked = (r.get("tool_call") or {}).get("args") if stop == "ask_user" else None
    said = body + ("\n" + json.dumps(asked, ensure_ascii=False) if asked else "")
    calls = r.get("calls") or []
    write_at = next((c["n"] for c in calls
                     if any(cli_name(a) in WRITE_COMMANDS for a in c.get("galley_calls") or [])), None)
    manual, reads = manual_column(calls, write_at)
    reasons = []
    if r.get("status") != "ok":
        reasons.append(f"运行失败：{r.get('status')}")
    if stop not in ("final_reply", "ask_user"):
        reasons.append("没走到最终回复：" + STOP_LABELS.get(stop, str(stop)))
    if held:
        reasons.append("用了会卡住主对话的命令：" + "、".join(sorted(set(held))))
    if "session new" in names or "<subtask>" in reply:
        if exp.get("no_subtask_tag", True):
            reasons.append("自己重开了活（session new 或 <subtask>）")
    if exp["send"]:
        if not sends:
            reasons.append("该 session send 却没有")
        else:
            if not any(any(w.lower() in s["content"].lower() for w in exp.get("send_mentions_any", [""]))
                       for s in sends):
                reasons.append("发给子任务的话没写明要什么（" + "、".join(exp.get("send_mentions_any", [])) + "）")
            if any(s["supervisor"] != "galley-assistant" for s in sends):
                reasons.append("session send 没带 --supervisor=galley-assistant")
    elif sends:
        reasons.append("不该 session send 却发了")
    file_refs = FILE_REF_RE.findall(reply)
    if exp.get("file_ref"):
        # Ticket 73: a file handed over is `[FILE:<absolute path>]` on a line
        # of its own; the path is the run's fake HOME (`$TMPDIR/…` once the
        # results are scrubbed).
        want = "/" + exp["file_ref"].lstrip("/")
        hits = [x.strip() for x in file_refs if x.strip().endswith(want)]
        if not hits:
            reasons.append("交代里没有 [FILE:…" + want + "]"
                           + ("（有：" + "、".join(file_refs) + "）" if file_refs else ""))
        elif not all(x.startswith(("/", "$TMPDIR")) for x in hits):
            reasons.append("[FILE:] 里不是绝对路径：" + "、".join(hits))
        elif not any(re.search(r"(^|\n)\s*\[FILE:" + re.escape(x) + r"\]\s*(\n|$)", reply) for x in hits):
            reasons.append("[FILE:] 没单独占一行")
    if exp["no_reply"]:
        if not is_no_reply:
            reasons.append("回复不是只有 <no-reply/>")
    else:
        if has_no_reply:
            reasons.append("不该写 <no-reply/>")
        if exp.get("mentions_any") and not any(w in said for w in exp["mentions_any"]):
            reasons.append("没点到：" + " / ".join(exp["mentions_any"]))
        for group in exp.get("mentions_groups") or []:
            if not any(w in said for w in group):
                reasons.append("漏了一件：" + " / ".join(group))
        if exp.get("max_chars") and shown_len(body) > exp["max_chars"]:
            reasons.append(f"太长：{shown_len(body)} 字，上限 {exp['max_chars']}")
    return {
        "commands": [" ".join(a) for a in log],
        "names": names,
        "sends": sends,
        "writes": writes,
        "held": held,
        "body": body,
        "no_reply": is_no_reply,
        "has_no_reply_tag": has_no_reply,
        "file_refs": file_refs,
        "chars": len(body),
        "suggestion": r.get("next_suggestion"),
        "asked_via_tool": asked,
        "manual": manual,
        "manual_reads": reads,
        "stop": stop,
        "pass": not reasons,
        "reasons": reasons,
    }


def manual_reads(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ticket 59: each tool call that read the assistant manual — its
    number and turn, which parts (「整本」 for the single file of before
    ticket 59, 「目录」 for the directory and no part), and how many bytes
    the tool result handed the model (UTF-8; a dict result as JSON, so a
    script that also did something else counts that output too)."""
    names = {x.name for x in manual_parts()}
    reads = []
    for c in calls:
        args = json.dumps(c.get("args"), ensure_ascii=False)
        parts: list[str] = []
        if OLD_MANUAL_FILE in args:
            parts.append("整本")
        elif MANUAL_STATE_PATH in args:
            parts = list(dict.fromkeys(m for m in MD_NAME_RE.findall(args) if m in names)) or ["目录"]
        if not parts:
            continue
        res = c.get("result")
        text = res if isinstance(res, str) else "" if res is None else json.dumps(res, ensure_ascii=False)
        reads.append({"n": c["n"], "turn": c.get("turn"), "parts": parts, "bytes": len(text.encode("utf-8"))})
    return reads


def manual_column(calls: list[dict[str, Any]], write_at: int | None) -> tuple[str, list[dict[str, Any]]]:
    """The 读手册 column: whether the first read came before the first
    write, then (ticket 59) the parts read, how many reads in how many
    model turns, and the bytes they handed the model."""
    reads = manual_reads(calls)
    if not reads:
        return ("没读" if write_at else "没读（没写）"), reads
    first = reads[0]["n"]
    when = (f"读了（第 {first} 次调用）" if write_at is None or first < write_at
            else f"写之后才读（第 {first} 次）")
    parts = "、".join(dict.fromkeys(p for x in reads for p in x["parts"]))
    turns = len({x["turn"] for x in reads})
    return f"{when}：{parts}；{len(reads)} 次 {turns} 轮，{sum(x['bytes'] for x in reads)} 字节", reads


RERUN_INTROS = {
    "59": "上一次是被这次替换的运行（整本手册），这一次是按部分拆开之后。",
    "60": "上一次是票 59 重跑之后的结果（手册拆开之后），这一次是票 60 改了手册（`todos.md`、`reminders.md`、"
          "`todos-change.md`）与入口层的待办那一段之后。只比两次都有的用例，票 60 新加的用例只有这一次。",
    "63": "上一次是这一套最近一次的结果（叫醒是票 59，待办、定时、闲聊是票 60），这一次是票 63 改了 Core 的叫醒说明、"
          "手册（「When one comes due」挪进 `wake.md`，`todos.md` 的第③条与提醒时间）与入口层（没写下就不说「记下了」）之后。"
          "只比两次都有的用例；两次都用现在的判定重判（票 63 起每条都判「说了记下了，这一轮就得有写」）。",
    "73": "上一次是 main 上这一套最近一次的结果（待办、闲聊是票 64，定时、叫醒是票 63，都是 gpt-6.1-sol），这一次是票 73 "
          "改了手册（`todos.md` 加没日子的在办之事、新的一部分 `unasked.md`、`wake.md` 的早上巡看、`reminders.md` 的例外）、"
          "入口层（在推进的事也记、记下时想一步、交文件用 `[FILE:…]`、手册列表多了 `unasked.md`）与 Core 的巡看叫醒之后，"
          "同一个模型（票 73 起是API key 接入的 gpt-6.1-sol，`mm_1792576875658`；之前的API key 条目已从库里删掉）。两次都用现在的"
          "判定重判（票 73 起回复里有「要不要我」一类建议的都注出来，`no_offer` 的用例判它）。只比两次都有的用例；票 73 新加的"
          "用例只有这一次，它们在票 73 之前的提示词与手册下各跑了一遍，是「同日对照」（`meta.ticket73_control`）。",
    "105": "上一次是票 73 的结果，这一次是票 105 改了手册 `reminders.md` 之后（主对话 PRD 裁决 151：原文第一行写给用户看，"
           "像待办的标题，不写时间、不写「用户要求」「提醒用户」、不用第三人称；需要时空一行，再写到点时自己要的；`schedule update "
           "--prompt` 同样写），同一个模型（API key 接入的 gpt-6.1-sol，`mm_1792576875658`）。入口层、Core 的叫醒说明、"
           "`galley-prompt/`、`rust-samples.json`、`cli-help.json` 都没动。三条叫醒用例（`wake-on-time`、`wake-late`、"
           "`wake-obsolete`）预先放着的任务原文换成了新写法（第一行给人、空行、写给自己的，内容不变），叫醒消息照 Core 的措辞把全文"
           "交给它，让叫醒那一侧在新写法下也测到。这张表比的是原有判定（第一行另见下一节「票 105：第一行」），两次都用现在的原有判定重判。",
    "110": "上一次是这几条最近一次的第 1 遍（票 108 的回归与它的六条新用例），这一次是票 110 改了手册之后（`wake.md`「The "
           "morning review」：第一段换成只为上次巡看以来动过的事醒；「Take each thing in turn」之后加一条：先读那件事，"
           "备注最前面是它做成的东西、用户之后没提过，下一步在用户手里；对话里做过、备注没写的先补；隔几天再看一眼的给自己挂提醒），"
           "同一个模型（API key 接入的 gpt-6.1-sol，`mm_1792576875658`）。Core 的判据改了，但评测不经 Core 判醒不醒，"
           "入口层、叫醒说明、`galley-prompt/`、`rust-samples.json` 都没动。只重跑巡看与写备注的旧用例各一遍（`review-*`、"
           "票 108 的六条、`wake-todo`），看有没有回退；两次都用现在的判定重判。",
    "108": "上一次是这几条最近一次的第 1 遍（`reno-asked` 是票 81，巡看几条是票 75、78，其余是票 73），这一次是票 108 "
           "改了手册之后（`todos-change.md` 加「How it is going」一条：做成了东西或听到新消息，在备注最前面补一行；"
           "`todos.md` 的 `--notes` 一条与 `unasked.md` 的「Tell the user」各补一句指向它），同一个模型（API key 接入的 gpt-6.1-sol，`mm_1792576875658`）。"
           "只重跑写备注的旧用例各一遍（`note-*`、`reno-*`、`wake-todo`、`review-*`），看有没有回退；两次都用现在的判定重判"
           "（票 108 起改了备注的都注出来）。",
    "64": "上一次是票 63 的结果，这一次是票 64 改了入口层的待办那一段之后（「Do it unasked」改成先读 `todos.md` 再说要记，"
          "底线加了「没写下就不提记」）。两次都用现在的判定重判（票 64 起什么都不该设的用例判「最终回复不提改口」）。"
          "待办评测另有「同日对照」：同一时段用票 63 的提示词跑的基线（`meta.ticket64_control`，只跑了不该设的那 7 条）。",
}


def retract_section(data: dict[str, Any], cases: list[dict[str, Any]], facts_fn: Any) -> list[str]:
    """Ticket 64: for the cases where nothing is to be set
    (expect.no_retract), how many replies took back a noting and how many
    first turns said they would note: ticket 63's runs (the group 票 64
    replaced), the same-hour baseline under ticket 63's prompt
    (meta.ticket64_control) and this time; then each hit word for word."""
    meta = data["meta"]
    want = [c for c in cases if c["expect"].get("no_retract")]
    if not want:
        return []
    by_id = {c["id"]: c for c in want}
    groups = meta.get("superseded_runs") or []
    groups = [groups] if isinstance(groups, dict) else groups
    old = next((g for g in groups if str(g.get("reason", "")).startswith("票 64")), None)
    sources: list[tuple[str, list[dict[str, Any]]]] = []
    if old:
        sources.append(("票 63 的运行（" + str(old["runs"][0].get("now", ""))[:16].replace("T", " ") + " 开跑）"
                        if old["runs"] else "票 63 的运行", [r for r in old["runs"] if r["id"] in by_id]))
    ctl = [r for r in meta.get("ticket64_control") or [] if r["id"] in by_id]
    if ctl:
        sources.append((f"基线：票 63 的提示词（{meta.get('ticket64_control_at', '')}）", ctl))
    sources.append(("这一次" + ("：票 64 的提示词" if old or ctl else ""),
                    [r for r in data["results"] if r["id"] in by_id]))
    facts = {(label, r["id"], r["variant"]): facts_fn(r, by_id[r["id"]]) for label, runs in sources for r in runs}
    out = ["## 票 64：改口与第一轮表态", "",
           "什么都不该设的用例（`expect.no_retract`）：「改口」是最终回复（去掉 `<summary>`、`<next-suggestion>`）里提了"
           "本来要记（`RETRACT_RE`：「刚才说」「多此一举」「多余」「本来要」「就不加了」「不特意设」一类），判定；"
           "「表态」是第一轮（不是最后一轮时）的正文或 `<summary>` 里说了要记（`STANCE_RE`：「记到待办」「设个提醒」「我先记下」一类），"
           "只记录。每格是「改口 / 表态 / 运行」。", "",
           "| # | 用例 | " + " | ".join(label for label, _ in sources) + " |",
           "| --- | --- |" + " --- |" * len(sources)]
    totals = [[0, 0, 0] for _ in sources]
    for case in want:
        cells = []
        for k, (label, runs) in enumerate(sources):
            mine = [r for r in runs if r["id"] == case["id"]]
            fs = [facts[(label, r["id"], r["variant"])] for r in mine]
            a = sum(1 for f in fs if f["retract"])
            b = sum(1 for f in fs if (f.get("stance") or {}).get("says"))
            totals[k] = [totals[k][0] + a, totals[k][1] + b, totals[k][2] + len(fs)]
            cells.append(f"{a} / {b} / {len(fs)}" if fs else "—")
        out.append(f"| {case['no']} | {case['id']} | " + " | ".join(cells) + " |")
    out += ["| | 合计 | " + " | ".join(f"{a} / {b} / {n}" for a, b, n in totals) + " |", ""]
    hits = []
    for label, runs in sources:
        for r in sorted(runs, key=lambda r: (by_id[r["id"]]["no"], r.get("repeat", 0))):
            f = facts[(label, r["id"], r["variant"])]
            st = f.get("stance") or {}
            if not (f["retract"] or st.get("says")):
                continue
            line = f"- {label}，{r['id']} 第 {r.get('repeat', 1)} 遍："
            if st.get("says"):
                where = "、".join(x for x, y in (("正文", st["hits"]["text"]), ("summary", st["hits"]["summary"])) if y)
                line += (f"第一轮在{where}里表态（" + "".join(f"「{w}」" for w in st["hits"]["text"] + st["hits"]["summary"])
                         + f"），正文「{one_line(st['text']) or '（空）'}」，summary「{one_line(st['summary']) or '（空）'}」；")
            if f["retract"]:
                line += "最终回复改口（" + "".join(f"「{w}」" for w in f["retract"]) + f"）：「{one_line(f['body'])}」"
            else:
                line += f"最终回复没改口：「{one_line(f['body'])}」"
            hits.append(line.replace("|", "/"))
    out += (hits or ["没有一次改口或表态。"]) + [""]
    return out


def rerun_section(data: dict[str, Any], cases: list[dict[str, Any]], facts_fn: Any, ticket: str) -> list[str]:
    """A ticket's rerun (59, 60) against the runs it replaced (the first
    group in meta.superseded_runs whose reason starts with 票 <ticket>):
    pass rate, model requests and time per run, and how the manual was
    read; then per case, with a flag where a case that writes takes over
    one more request on average. "This time" is the group a later ticket
    replaced them with, if any (ticket 59's results are what ticket 60
    compares with), else the current results. A same-day control (meta.ticket59_control: the
    prompt and the whole manual of before ticket 59, run the day of the
    rerun) gets a row and a column of its own. Empty until that group
    exists. A record-only case counts as no pass."""
    meta = data["meta"]
    groups = meta.get("superseded_runs") or []
    groups = [groups] if isinstance(groups, dict) else groups
    mark = f"票 {ticket}"
    at = next((i for i, g in enumerate(groups) if str(g.get("reason", "")).startswith(mark)), None)
    if at is None:
        return []
    base = groups[at]
    later = next((g for g in groups[at + 1:] if not str(g.get("reason", "")).startswith(mark)), None)
    by_id = {c["id"]: c for c in cases}
    keys = {(r["id"], r["variant"]) for r in base["runs"]}
    before = [r for r in base["runs"] if r["id"] in by_id]
    after = [r for r in (later["runs"] if later else data["results"])
             if (r["id"], r["variant"]) in keys and r["id"] in by_id]

    def facts(r: dict[str, Any]) -> dict[str, Any]:
        return facts_fn(r, by_id[r["id"]])

    def stats(runs: list[dict[str, Any]]) -> dict[str, Any]:
        n = max(len(runs), 1)
        fs = [facts(r) for r in runs]
        reads = [f["manual_reads"] for f in fs]
        parts: dict[str, int] = {}
        for x in reads:
            for y in x:
                for p in y["parts"]:
                    parts[p] = parts.get(p, 0) + 1
        return {
            "runs": len(runs),
            "pass": sum(1 for f in fs if f["pass"] is True),
            "calls": sum(int(r.get("llm_calls") or 0) for r in runs) / n,
            "secs": sum(float(r.get("latency_s") or 0) for r in runs) / n,
            "reads": sum(len(x) for x in reads) / n,
            "turns": sum(len({y["turn"] for y in x}) for x in reads) / n,
            "bytes": sum(sum(y["bytes"] for y in x) for x in reads) / n,
            "parts": parts,
            "writes": any(f["writes"] for f in fs),
        }

    def dist(parts: dict[str, int]) -> str:
        return "、".join(f"{p} {k}" for p, k in sorted(parts.items(), key=lambda kv: (-kv[1], kv[0]))) or "—"

    control = [r for r in meta.get(f"ticket{ticket}_control") or [] if r["id"] in by_id]
    b, a = stats(before), stats(after)
    model = meta["model"]
    title = (f"## 票 {ticket} 重跑（{str(base.get('at', ''))[:10]}，{model['name']}，推理强度 "
             f"{model['options'].get('reasoning_effort', '默认')}）")
    note = meta.get(f"ticket{ticket}_note")
    out = [title, ""] + list(note or [])
    if note:
        out.append("")
    out += [
        RERUN_INTROS.get(ticket, "") + "请求次数是每次运行的模型调用数（GA 的轮数），"
        "用时是整次运行的墙钟时间；读手册的字节是返回给模型的工具结果的字节数，「轮」是读手册的那几次落在几个模型轮次里"
        "（一轮里并发读几份算一轮）。",
        "",
        "| | 运行 | 过 | 请求次数（均） | 用时 s（均） | 读手册次数（均） | 读手册轮数（均） | 读手册字节（均） | 读过的部分（次数） |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    rows = [("上一次", b), ("这一次", a)] + ([("同日对照", stats(control))] if control else [])
    for label, x in rows:
        out.append(f"| {label} | {x['runs']} | {x['pass']} | {x['calls']:.2f} | {x['secs']:.1f} | {x['reads']:.2f} | "
                   f"{x['turns']:.2f} | {x['bytes']:.0f} | {dist(x['parts'])} |")
    head = "| # | 用例 | 写 | 过 | 请求次数 | 用时 s | 读手册：上一次 | 读手册：这一次 | 标记 |"
    if control:
        head += " 同日对照：过、请求次数、用时 s |"
    out += ["", head, "|" + " --- |" * (head.count("|") - 1)]
    for case in cases:
        cb = [r for r in before if r["id"] == case["id"]]
        ca = [r for r in after if r["id"] == case["id"]]
        if not cb and not ca:
            continue
        sb, sa = stats(cb), stats(ca)
        writes = sb["writes"] or sa["writes"]
        flag = "请求多了 1 次以上" if writes and cb and ca and sa["calls"] - sb["calls"] > 1 else ""

        def read_gist(x: dict[str, Any]) -> str:
            if not x["reads"]:
                return "没读"
            return (f"{x['reads']:.1f} 次 {x['turns']:.1f} 轮，{x['bytes']:.0f} 字节：{dist(x['parts'])}")

        row = (f"| {case['no']} | {case['id']} | {'是' if writes else '否'} | {sb['pass']}/{sb['runs']} → "
               f"{sa['pass']}/{sa['runs']} | {sb['calls']:.1f} → {sa['calls']:.1f} | {sb['secs']:.0f} → "
               f"{sa['secs']:.0f} | {read_gist(sb)} | {read_gist(sa)} | {flag} |")
        if control:
            sc = stats([r for r in control if r["id"] == case["id"]])
            row += f" {sc['pass']}/{sc['runs']}，{sc['calls']:.1f}，{sc['secs']:.0f} |"
        out.append(row)
    out.append("")
    return out


def short_cmd(cmd: str, limit: int = 160) -> str:
    """A galley call for the table: subtask ids shortened, long text cut."""
    cmd = re.sub(r"\bs-mg[a-z0-9]{6}-([a-z0-9]{8})\b", lambda m: "s-…" + m.group(1)[-4:], cmd)
    return cmd if len(cmd) <= limit else cmd[:limit] + "…"


def one_line(text: str) -> str:
    return re.sub(r"\s*\n\s*", " ⏎ ", text.strip()).replace("|", "\\|")


def render_wake_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_case: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by_case.setdefault(r["id"], []).append(r)
    order = {w: i for i, w in enumerate(meta.get("wordings_order") or [])}
    out = [
        "# 叫醒措辞评测结果（票 30）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}，即 JC 主对话现在用的模型），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；首次运行于 {meta['ran_at']}。",
        "",
        "- **提示词**：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词，含票 30 改过的入口层（`galley-prompt/`；"
        "票 59 起重新生成，是票 59 的入口层与现在的静态规则）。手册目录填成这次运行状态根下的 `assistant/reference/manual/`，"
        "那里放着仓库里 `docs/managed-ga-runtime/galley-assistant-manual/` 的各部分（Core 写的位置；票 73 起九个）；票 59 之前是单个文件 "
        "`assistant/reference/galley-assistant-manual.md`。",
        "- **历史**：一段很短的当前段对话：用户的要求，助手派了子任务（回复末尾是回放标记 `[subtask <id>: <title>]`）；"
        "打回过的一轮按票 29 的回放写法压成一行，助手那轮是 `<no-reply/>`。",
        "- **新消息**：按 `wording.md` 的措辞逐字拼出的叫醒消息（`draft` 是票 29「措辞草稿」原文）。",
        "- **工具**：`code_run` 与文件工具在每次运行自己的 macOS 沙盒里真的执行（同派活对照第二轮的沙盒，另允许 `sed`、`cat`、`ls` 等几个系统程序，"
        "`python3` 指向同一个解释器）；Galley CLI 是假的，按 `cases.json` 的固定数据回答（会话行、子任务的对话、项目、模型、真实 CLI 的 `--help` 原文），"
        "记下每次调用的参数，`session send` 等写命令只改假 CLI 自己的状态。浏览器工具、`ask_user` 不执行，运行停在那里。"
        f"每次运行最多 {WAKE_TOOL_CAP} 次工具调用。",
        f"- **判定**：按 `cases.json` 每条的 `expect` 自动判（下面「判定」一栏写不过的原因）；字数是去掉 `<summary>`、`<next-suggestion>` 后的正文字符数。",
        "",
    ]
    if meta.get("history_note"):
        out += [meta["history_note"], ""]
    sup = meta.get("superseded_runs") or []
    for n, group in enumerate([sup] if isinstance(sup, dict) else sup, 1):
        out += [f"注 {n}：{group['reason']}被替换的 {len(group['runs'])} 次运行原样留在 results.json 的 "
                f"`meta.superseded_runs[{n - 1}]` 里。", ""]
    out += (rerun_section(data, cases, wake_facts, "73") + rerun_section(data, cases, wake_facts, "63")
            + rerun_section(data, cases, wake_facts, "59"))
    out += [
        "## 一览",
        "",
        "| # | 用例 | 期望 | 措辞 | 遍 | 调了什么命令 | 回复原文 | `<no-reply/>` | 字数 | 读手册 | 判定 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for case in cases:
        runs = sorted(by_case.get(case["id"], []), key=lambda r: (order.get(r.get("wording"), 99), r.get("repeat", 0)))
        for r in runs:
            f = wake_facts(r, case)
            cmds = "；".join(short_cmd(c) for c in f["commands"] if cli_name(c.split()) != "help") or "—"
            if f["asked_via_tool"]:
                reply = one_line(f["body"] + "（ask_user：" + str(f["asked_via_tool"].get("question", "")) + "）")
            else:
                reply = one_line(f["body"]) or "（空）"
            verdict = "过" if f["pass"] else "不过：" + "；".join(f["reasons"])
            out.append(f"| {case['no']} | {case['id']} | {case['expect_text'].replace('|', '/')} | {r['wording']} | "
                       f"{r['repeat']} | {cmds.replace('|', '/')} | {reply} | {'是' if f['no_reply'] else '否'} | "
                       f"{f['chars']} | {f['manual']} | {verdict.replace('|', '/')} |")
    out.append("")
    for case in cases:
        runs = sorted(by_case.get(case["id"], []), key=lambda r: (order.get(r.get("wording"), 99), r.get("repeat", 0)))
        if not runs:
            continue
        out += [f"## {case['no']}. {case['id']}", "", f"**期望**：{case['expect_text']}", "", "上下文："]
        out.append("")
        for m in case["history"]:
            who = "用户" if m["role"] == "user" else "助手"
            out.append(f"> {who}：" + m["content"].replace("\n", "\n> "))
            out.append(">")
        if out[-1] == ">":
            out.pop()
        out.append("")
        seen_messages: set[str] = set()
        for r in runs:
            if r.get("message") and r["message"] not in seen_messages:
                seen_messages.add(r["message"])
                out += [f"叫醒消息（{r['wording']}）：", ""] + fenced(r["message"])
        for r in runs:
            f = wake_facts(r, case)
            out += [f"### {r['wording']} 第 {r['repeat']} 遍：{'过' if f['pass'] else '不过'}", ""]
            if not f["pass"]:
                out += ["不过的原因：" + "；".join(f["reasons"]), ""]
            calls = r.get("calls") or []
            if calls:
                out += ["工具调用："]
                out.append("")
                for c in calls:
                    line = f"{c['n']}. {call_gist(c)}"
                    for argv in c.get("galley_calls") or []:
                        line += "；galley " + " ".join(argv).replace("`", "'")
                    out.append(line.replace("\n", " "))
                out.append("")
            out += [f"结束：{STOP_LABELS.get(f['stop'], f['stop'])}；读手册：{f['manual']}；"
                    f"手册版本：`{r.get('manual_sha', '?')}`。", ""]
            if f["asked_via_tool"]:
                out += ["ask_user 的问题：", ""] + fenced(json.dumps(f["asked_via_tool"], ensure_ascii=False, indent=1), "json")
            out += ["回复（去掉 summary 与建议标签）：", ""] + fenced(f["body"] or "（空）")
            if f["suggestion"]:
                out += [f"建议标签：{f['suggestion']}", ""]
    return "\n".join(line.rstrip() for line in "\n".join(out).split("\n")).rstrip() + "\n"


CN_DIGITS = "零一二三四五六七八九"


def cn_number(n: int) -> str:
    """1–999 in Chinese numerals (十二, 二十五; since ticket 73 also 一百零五,
    一百二十: says_time tries minutes up to 183, and ticket 73's
    supplier-quote is the first case with a reminder that far)."""
    if n >= 100:
        hundreds, rest = divmod(n, 100)
        if rest == 0:
            return CN_DIGITS[hundreds] + "百"
        tail = ("零" + CN_DIGITS[rest]) if rest < 10 else (("一" if rest < 20 else "") + cn_number(rest))
        return CN_DIGITS[hundreds] + "百" + tail
    if n < 10:
        return CN_DIGITS[n]
    tens, ones = divmod(n, 10)
    return ("" if tens == 1 else CN_DIGITS[tens]) + "十" + (CN_DIGITS[ones] if ones else "")


def says_time(text: str, at: datetime, now: datetime, started: datetime) -> bool:
    """Whether a reply names a time: the hour (24- or 12-hour, digits or
    Chinese, `:mm`, 点, 半) and, unless it is today, the day (明天, 周三,
    21 号 …); or, within three hours, how many minutes from now (or, since
    ticket 44, 半小时 / N 小时 when it is that far). Since ticket 60, two
    days off or more, the day alone (「11 月 20 号我问你一下」, the
    manual's own example)."""
    text = text.replace("：", ":")
    h, m = at.hour, at.minute
    hours = {h, h % 12 or 12}
    pats: list[str] = []
    for x in hours:
        names = [str(x), f"{x:02d}", cn_number(x)] + (["两"] if x == 2 else [])
        pats += [f"{x}:{m:02d}", f"{x:02d}:{m:02d}"]
        for name in names:
            if m == 0:
                pats += [f"{name}点", f"{name} 点", f"{name}时"]
            elif m == 30:
                pats += [f"{name}点半", f"{name} 点半", f"{name}点 30", f"{name} 点 30", f"{name}点30"]
            else:
                pats += [f"{name}点{m}", f"{name} 点 {m}", f"{name}点{cn_number(m)}"]
    hour_ok = any(p in text for p in pats)
    minutes = round((at - started).total_seconds() / 60)
    if 0 < minutes <= 180:
        for k in range(max(1, minutes - 3), minutes + 4):
            if any(f"{w}分钟" in text or f"{w} 分钟" in text for w in (str(k), cn_number(k))):
                return True
        relative: list[str] = []
        if abs(minutes - 30) <= 3:
            relative += ["半小时", "半个小时", "半个钟"]
        hours_away = round(minutes / 60)
        if hours_away and abs(minutes - 60 * hours_away) <= 3:
            for w in [str(hours_away), cn_number(hours_away)] + (["两"] if hours_away == 2 else []):
                relative += [f"{w}小时", f"{w} 小时", f"{w}个小时", f"{w} 个小时", f"{w}个钟"]
        if any(w in text for w in relative):
            return True
    day, today = at.date(), now.date()
    if day == today:
        day_ok = True
    else:
        # Ticket 59: tomorrow named by its weekday or date counts too (run
        # on a Monday, 「周二下午 3 点」 for the 20th was judged as no day).
        wd = "一二三四五六日"[day.weekday()]
        words = [f"周{wd}", f"星期{wd}", f"礼拜{wd}"] + (["周天", "星期天", "礼拜天"] if wd == "日" else [])
        words += [f"{day.month}月{day.day}", f"{day.month} 月 {day.day}", f"{day.day}号", f"{day.day} 号",
                  f"{day.day}日", f"{day.month}-{day.day}", f"{day.month}/{day.day}", f"{day.month:02d}-{day.day:02d}"]
        if day == today + timedelta(days=1):
            words += ["明天", "明早", "明晚", "明日", "明儿", "明上午", "明下午"]
        if day == today + timedelta(days=2):
            words.append("后天")
        if day.year != today.year:
            words += [f"{day.year}-{day.month:02d}-{day.day:02d}"]
        day_ok = any(w in text for w in words)
        if day_ok and (day - today).days >= 2:
            return True
    return hour_ok and day_ok


# Ticket 105 (main chat PRD ruling 151): the first line of the words of
# each `schedule create` and `schedule update --prompt` is for the user,
# like a to-do's title; the reminder card, the to-do panel's rows,
# 「说说这件」 and an undelivered reminder's notification show it alone
# (gui/src/lib/reminder-first-line.ts `reminderFirstLine`), and what
# follows a blank line is the model's notes to itself. Judged on every
# such command in the schedule suite, beside the earlier rules (which
# stay as they were): the first line names no 「用户」 or 「JC」 (a record
# about the user, not a title for them), does not open with 「提醒」 (the
# card already says it is a reminder), carries no time or day (the card
# shows when; FIRST_LINE_TIME_RE), and is at most FIRST_LINE_MAX
# characters (a title, one line on the card). A literal backslash-n in
# the words fails too: the GUI would show it and all that follows.
FIRST_LINE_MAX = 20
FIRST_LINE_TIME_RE = re.compile(
    # Digits then a clock or calendar unit: 3点, 15:00, 20号, 10月, 28日.
    r"[0-9\uff10-\uff19]+\s*(?:点|时|:|：|号|日|月)"
    # Chinese numerals then 点 or 号 (三点, 十一点, 二十号); not a lone
    # 一点, which mostly means 「a bit」 (少喝一点).
    r"|[二三四五六七八九十两][一二三四五六七八九十]*\s*(?:点|号)"
    r"|今天|明天|后天|昨天|今晚|明晚|今早|明早|今日|明日"
    r"|早上|上午|中午|下午|傍晚|晚上|凌晨"
    r"|(?:周|星期|礼拜)[一二三四五六日天末]|下周|这周|本周|下个?月|月底|月初"
    r"|(?:分钟|小时)后")


def first_line(words: str) -> str:
    """The rule of gui/src/lib/reminder-first-line.ts `reminderFirstLine`:
    the first line that is not blank, trimmed; words with no line break
    are the whole of them."""
    for line in re.split(r"\r\n|\r|\n", words):
        if line.strip():
            return line.strip()
    return ""


def first_line_problems(words: str) -> tuple[str, list[str]]:
    """Ticket 105: the first line of a reminder's words and what is wrong
    with it as the user's title (empty when nothing is)."""
    line = first_line(words)
    problems = []
    if "\\n" in words:
        problems.append("原文里是字面的「\\n」，不是换行")
    if not line:
        return line, problems + ["第一行是空的"]
    if "用户" in line:
        problems.append("写了「用户」")
    if "jc" in line.lower():
        problems.append("写了「JC」")
    if line.startswith("提醒"):
        problems.append("以「提醒」开头")
    hits = list(dict.fromkeys(m.group(0) for m in FIRST_LINE_TIME_RE.finditer(line)))
    if hits:
        problems.append("有时间或日子：" + "、".join(f"「{h}」" for h in hits))
    if len(line) > FIRST_LINE_MAX:
        problems.append(f"{len(line)} 字，上限 {FIRST_LINE_MAX}")
    return line, problems


def first_line_checks(log: list[list[str]]) -> list[dict[str, Any]]:
    """Ticket 105: each `schedule create` and `schedule update --prompt`
    in the fake galley's log (refused ones too: the words are what the
    model wrote), its words, their first line and what is wrong with it."""
    out = []
    for argv in log:
        name = cli_name(argv)
        words, flags = parse_cli(argv)
        if name == "schedule create":
            text = " ".join(words[2:])
        elif name == "schedule update" and isinstance(flags.get("prompt"), str):
            text = flags["prompt"]
        else:
            continue
        line, problems = first_line_problems(text)
        out.append({"command": name, "words": text, "first_line": line, "notes": text.strip() != line,
                    "problems": problems, "pass": not problems})
    return out


def sched_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """What a schedule run did, and whether it met the case's
    expectations (schedule/cases.json `expect`). Commands from the fake
    galley's log; tasks made, changed and cancelled from its final state.
    Since ticket 41 a reminder for the user's own thing may hang on a
    to-do (`todo add --remind-at`): with `via: either` such a reminder
    counts as the one to set, with `via: schedule` (the default) only
    `schedule create` does. Ticket 44 (main chat PRD ruling 92) split the
    two: `via: todo` (something to get done) takes only a reminder on a
    to-do, and a nudge with nothing to finish keeps the default. Ticket
    105 added the first line of each `schedule create` and `schedule
    update --prompt` (`first_line_checks`): `pass` takes it in,
    `pass_before_105` is the verdict on the earlier rules alone."""
    exp = case["expect"]
    now = datetime.fromisoformat(r["now"])
    tz = now.tzinfo
    started = datetime.fromtimestamp(r["started_at"], tz) if r.get("started_at") else now
    log = [c.get("argv") or [] for c in r.get("galley_log") or []]
    names = [cli_name(a) for a in log]
    fixture = {t["id"]: t for t in r.get("fixture_tasks") or []}
    final = (r.get("fake_state") or {}).get("tasks")
    if final is None:
        final = list(fixture.values())
    by_id = {t["id"]: t for t in final}
    made = [t for t in final if t["id"] not in fixture]
    made_live = [t for t in made if not t.get("cancelledAt")]

    def cancelled_here(tid: str) -> bool:
        # Ticket 60: cancelled in this run, not one the fake galley
        # started with already cancelled.
        return bool(by_id.get(tid, {}).get("cancelledAt")) and not fixture.get(tid, {}).get("cancelledAt")

    cancelled = sorted(t["id"] for t in final if t["id"] in fixture and cancelled_here(t["id"]))
    changed = sorted(t["id"] for t in final if t["id"] in fixture and not t.get("cancelledAt")
                     and {k: v for k, v in t.items() if k != "updatedAt"}
                     != {k: v for k, v in fixture[t["id"]].items() if k != "updatedAt"})
    creates = [parse_cli(a) for a in log if cli_name(a) == "schedule create"]
    sched_writes = [(cli_name(a), parse_cli(a)) for a in log if cli_name(a) in SCHEDULE_WRITES + TODO_WRITES]
    via = exp.get("via", "schedule")
    made_todos = [t for t in (r.get("fake_state") or {}).get("todos") or []
                  if t["id"] not in {x["id"] for x in r.get("fixture_todos") or []}]
    writes = [n for n in names if n in ALL_WRITES]
    held = [n for n in names if n in HOLDING_COMMANDS]
    reply = r.get("final_reply") or ""
    body = strip_for_display(reply)
    is_no_reply = bool(NO_REPLY_RE.fullmatch(body.strip()))
    has_no_reply = bool(NO_REPLY_RE.search(reply))
    stop = r.get("stop_reason")
    asked = (r.get("tool_call") or {}).get("args") if stop == "ask_user" else None
    said = body + ("\n" + json.dumps(asked, ensure_ascii=False) if asked else "")
    calls = r.get("calls") or []
    write_at = next((c["n"] for c in calls
                     if any(cli_name(a) in ALL_WRITES for a in c.get("galley_calls") or [])), None)
    manual, reads = manual_column(calls, write_at)
    first_list = next((i for i, n in enumerate(names) if n in ("schedule list", "todo list")), None)
    first_create = next((i for i, n in enumerate(names) if n in ("schedule create", "todo add")), None)
    if first_create is None:
        listed = "—"
    else:
        listed = "查了" if first_list is not None and first_list < first_create else "没查"

    def local(iso: str) -> datetime:
        return datetime.fromisoformat(iso).astimezone(tz)

    def in_window(t: dict[str, Any], window: dict[str, Any]) -> bool:
        if not t.get("fireAt"):
            return False
        at = local(t["fireAt"])
        lo = now if window["from"].get("now") else sched_time(window["from"], now, started)
        hi = sched_time(window["to"], now, started)
        return lo - timedelta(seconds=59) <= at <= hi + timedelta(seconds=59)

    reasons = []
    if r.get("status") != "ok":
        reasons.append(f"运行失败：{r.get('status')}")
    if stop not in ("final_reply", "ask_user"):
        reasons.append("没走到最终回复：" + STOP_LABELS.get(stop, str(stop)))
    if held:
        reasons.append("用了会卡住主对话的命令：" + "、".join(sorted(set(held))))
    if "session new" in names or "<subtask>" in reply:
        reasons.append("开了子任务或新会话")
    for words, flags in creates:
        if flags.get("target") != "assistant":
            reasons.append("schedule create 没带 --target=assistant")
            break
    for name, (words, flags) in sched_writes:
        if flags.get("supervisor") != "galley-assistant":
            reasons.append(f"{name} 没带 --supervisor=galley-assistant")
            break
    allowed = set(exp.get("allow") or [])
    mode = exp.get("create", "none")
    if mode in ("one", "any"):
        if via != "todo":
            allowed.add("schedule create")
        if via in ("either", "todo"):
            allowed.add("todo add")
    if exp.get("delete"):
        allowed.add("schedule delete")
    if exp.get("move"):
        allowed |= {"schedule update", "schedule delete", "schedule create"}
    extra = sorted({n for n in writes if n not in allowed})
    if extra:
        reasons.append("多余的写命令：" + "、".join(extra))
    timed: dict[str, Any] | None = None
    if mode == "one":
        if len(made_live) != 1:
            reasons.append(f"该建 1 个提醒，建了 {len(made_live)} 个")
        else:
            timed = made_live[0]
            if timed.get("target") != "assistant":
                reasons.append("建成了每次新开会话的任务（target 不是 assistant）")
            if via == "schedule" and timed.get("todoId"):
                reasons.append("该是它自己的提醒（schedule create），却记成了待办")
            if via == "todo" and not timed.get("todoId"):
                reasons.append("该记成待办挂提醒（todo add --remind-at），却建成了它自己的提醒")
            if exp.get("window") and not in_window(timed, exp["window"]):
                reasons.append("时间不对：" + local_words(local(timed["fireAt"])) if timed.get("fireAt")
                               else "不是一次性提醒")
            if exp.get("words_any") and not any(w in timed["prompt"] for w in exp["words_any"]):
                reasons.append("记下的话里没有：" + " / ".join(exp["words_any"]))
    elif mode == "any":
        if len(made_live) > 1:
            reasons.append(f"建了 {len(made_live)} 个提醒")
        timed = made_live[0] if made_live else None
    elif made or creates:
        reasons.append("不该建却建了（或试着建）")
    if via == "schedule" and mode != "none" and made_todos:
        reasons.append("记了待办：" + "、".join(t["title"] for t in made_todos))
    live_todos = [t for t in made_todos if not t.get("cancelledAt")]
    if via == "todo" and mode == "one" and len(live_todos) != 1:
        reasons.append(f"该记 1 件待办，记了 {len(live_todos)} 件")
    want_cancel = sorted(exp.get("delete") or [])
    move = exp.get("move")
    if move:
        target = by_id.get(move["id"], {})
        if not cancelled_here(move["id"]):
            timed = target
            if not in_window(target, move["window"]):
                reasons.append("没改到新时间：" + (local_words(local(target["fireAt"])) if target.get("fireAt") else "?"))
            if made_live:
                reasons.append("改时间时多建了一个")
        else:
            if len(made_live) != 1 or not in_window(made_live[0], move["window"]):
                reasons.append("删了原来的，但没有在新时间重建一个")
            else:
                timed = made_live[0]
                if timed.get("target") != "assistant":
                    reasons.append("重建的不是叫醒自己的提醒")
        if [c for c in cancelled if c != move["id"]]:
            reasons.append("删了不该删的：" + "、".join(c for c in cancelled if c != move["id"]))
    elif cancelled != want_cancel:
        if want_cancel and not set(want_cancel) <= set(cancelled):
            reasons.append("该删没删：" + "、".join(sorted(set(want_cancel) - set(cancelled))))
        if set(cancelled) - set(want_cancel):
            reasons.append("删了不该删的：" + "、".join(sorted(set(cancelled) - set(want_cancel))))
    for keep in exp.get("keep") or []:
        if cancelled_here(keep):
            reasons.append(f"不该删 {keep}")
    kor = exp.get("keep_or_replace")
    if kor:
        # Kept, with no second reminder; or moved onto a to-do: cancelled,
        # and exactly one reminder made in its place, in the window.
        if not cancelled_here(kor["id"]):
            if made_live:
                reasons.append(f"已有 {kor['id']}，又建了 {len(made_live)} 个提醒")
        elif len(made_live) != 1 or not in_window(made_live[0], kor["window"]):
            reasons.append(f"删了 {kor['id']}，但没有在原来的时间附近换成一个")
    if exp.get("no_writes") and writes:
        reasons.append("不该动任何东西：" + "、".join(writes))
    if exp.get("no_reply"):
        if not is_no_reply:
            reasons.append("回复不是只有 <no-reply/>")
    else:
        if has_no_reply:
            reasons.append("不该写 <no-reply/>")
        if stop == "final_reply" and not body.strip():
            reasons.append("回复正文是空的（话只写在 <summary> 里，主对话不显示）")
        if exp.get("mentions_time") and timed and timed.get("fireAt"):
            if not says_time(said, local(timed["fireAt"]), now, started):
                reasons.append("回复没说出时间（" + local_words(local(timed["fireAt"])) + "）")
        if exp.get("mentions_time_of"):
            t = by_id.get(exp["mentions_time_of"], {})
            if t.get("fireAt") and not says_time(said, local(t["fireAt"]), now, started):
                reasons.append("没说已有的那个是什么时候（" + local_words(local(t["fireAt"])) + "）")
        if exp.get("mentions_any") and not any(w in said for w in exp["mentions_any"]):
            reasons.append("没点到：" + " / ".join(exp["mentions_any"]))
        for group in exp.get("mentions_groups") or []:
            if not any(w in said for w in group):
                reasons.append("漏了：" + " / ".join(group))
        if exp.get("forbid_any") and any(w in said for w in exp["forbid_any"]):
            reasons.append("不该说：" + " / ".join(w for w in exp["forbid_any"] if w in said))
        if exp.get("asks") and not (asked or "？" in body or "?" in body):
            reasons.append("该先问一句，没问")
        if exp.get("max_chars") and shown_len(body) > exp["max_chars"]:
            reasons.append(f"太长：{shown_len(body)} 字，上限 {exp['max_chars']}")
    # Ticket 63: 「记下了」 only after a write in the run.
    fx_todos = {t["id"]: t for t in r.get("fixture_todos") or []}
    todos_now = (r.get("fake_state") or {}).get("todos") or []
    claim = unwritten_claim(body, bool(made or cancelled or changed or memory_changed(r)
                                       or [t for t in todos_now if fx_todos.get(t["id"]) != t]))
    if claim:
        reasons.append(claim)
    before_105 = not reasons
    first_lines = first_line_checks(log)
    for fl in first_lines:
        if fl["problems"]:
            reasons.append(f"{fl['command']} 的第一行「{fl['first_line']}」：" + "，".join(fl["problems"]))
    return {
        "commands": [" ".join(a) for a in log],
        "names": names,
        "writes": writes,
        "made": made,
        "cancelled": cancelled,
        "changed": changed,
        "timed": timed,
        "held": held,
        "body": body,
        "no_reply": is_no_reply,
        "chars": len(body),
        "suggestion": r.get("next_suggestion"),
        "asked_via_tool": asked,
        "manual": manual,
        "manual_reads": reads,
        "listed": listed,
        "stop": stop,
        "made_todos": made_todos,
        "first_lines": first_lines,
        "pass": not reasons,
        "pass_before_105": before_105,
        "reasons": reasons,
    }


def sched_facts_before_105(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """`sched_facts` with the verdict on the rules before ticket 105: the
    reruns of tickets 59 to 73 compare as they did, and ticket 105's says
    whether the earlier rules went back."""
    f = sched_facts(r, case)
    return {**f, "pass": f["pass_before_105"]}


def first_line_gist(fl: dict[str, Any]) -> str:
    """One first line for the tables: the line, then what is wrong."""
    verdict = "过" if fl["pass"] else "不过：" + "，".join(fl["problems"])
    tail = "，后面有给自己的话" if fl["notes"] else "，没有后面的话"
    return f"「{fl['first_line']}」（{fl['command'].split()[1]}{tail}；{verdict}）"


def first_line_section(data: dict[str, Any], cases: list[dict[str, Any]]) -> list[str]:
    """Ticket 105: the first lines, against the runs it replaced (ticket
    73's, the first group in meta.superseded_runs whose reason starts
    with 票 105): per case, how many `schedule create` / `schedule update
    --prompt` commands and how many first lines pass, then every first
    line of this time word for word. Empty until that group exists."""
    meta = data["meta"]
    groups = meta.get("superseded_runs") or []
    groups = [groups] if isinstance(groups, dict) else groups
    base = next((g for g in groups if str(g.get("reason", "")).startswith("票 105")), None)
    if base is None:
        return []
    by_id = {c["id"]: c for c in cases}
    before = [r for r in base["runs"] if r["id"] in by_id]
    after = [r for r in data["results"] if r["id"] in by_id]

    def lines(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [fl for r in runs for fl in sched_facts(r, by_id[r["id"]])["first_lines"]]

    out = ["## 票 105：第一行", "",
           "每一次 `schedule create` 与 `schedule update --prompt` 的原文取第一行（同 GUI 的 `reminderFirstLine`：第一个非空行、去首尾空白），"
           f"判它能不能当给用户看的标题：不含「用户」「JC」，不以「提醒」开头，不含时间或日子（`FIRST_LINE_TIME_RE`），不超过 {FIRST_LINE_MAX} 个字；"
           "原文里是字面的 `\\n` 也不过。每格是「第一行过 / 命令数」，「上一次」是票 73 的运行（那时手册要它写给自己看），用同一条判定重判。", "",
           "| # | 用例 | 上一次 | 这一次 |", "| --- | --- | --- | --- |"]
    tb = ta = pb = pa = 0
    for case in cases:
        lb = lines([r for r in before if r["id"] == case["id"]])
        la = lines([r for r in after if r["id"] == case["id"]])
        if not lb and not la:
            continue
        kb, ka = sum(fl["pass"] for fl in lb), sum(fl["pass"] for fl in la)
        tb, ta, pb, pa = tb + len(lb), ta + len(la), pb + kb, pa + ka
        out.append(f"| {case['no']} | {case['id']} | {kb} / {len(lb)} | {ka} / {len(la)} |")
    out += [f"| | 合计 | {pb} / {tb} | {pa} / {ta} |", "", "这一次的每一个第一行：", ""]
    for case in cases:
        for r in sorted((r for r in after if r["id"] == case["id"]), key=lambda r: r.get("repeat", 0)):
            for fl in sched_facts(r, case)["first_lines"]:
                out.append(f"- {case['id']} 第 {r.get('repeat', 1)} 遍：" + first_line_gist(fl).replace("|", "/"))
    out.append("")
    return out


def render_sched_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_case: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by_case.setdefault(r["id"], []).append(r)
    facts = {(r["id"], r["variant"]): sched_facts(r, next(c for c in cases if c["id"] == r["id"]))
             for r in data["results"] if any(c["id"] == r["id"] for c in cases)}
    out = [
        "# 定时与提醒评测结果（票 36，票 44、票 59、票 60、票 63、票 73、票 105 重跑）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}，即 JC 主对话现在用的模型），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；首次运行于 {meta['ran_at']}。",
        "",
        "- **提示词**：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（`galley-prompt/`）：票 41 改过的入口层、"
        "主对话自己的「What Only The User Changes」一段；用例里分段开始前就有的定时任务照 `in_hand_section` 的格式（票 39 的三组）写进「In Hand」一节"
        "（`run.py` 的 `in_hand_block`，干跑测试逐字对过 Rust 的输出）。手册是仓库里的 `docs/managed-ga-runtime/galley-assistant-manual/`"
        "（票 59 起按部分拆成八个文件，入口层列出每个文件什么时候读；之前是单个文件，票 44 改过的「To-dos and reminders」），"
        "整套放在这次运行状态根下 Core 写它的位置（`assistant/reference/manual/`）。",
        "- **票 41 的改动**：用户自己的事带时间的，提醒可以挂在待办上（`todo add --remind-at`）；"
        "物流这种它自己回头查的只认 `schedule create`。假 CLI 多了 `todo` 命令族。",
        "- **票 44 的改动**（主对话 PRD 裁决 92）：要办完的事（交报告、航班，`via: todo`）只认挂在待办上的提醒，建成它自己的提醒算错；"
        "只要提醒一下、没有要办完的事（喝水、关火）只认 `schedule create`，记成待办算错。「已有同一件」照票 41（`via: either`）。"
        "加了「半小时后提醒我关火」。",
        "- **新消息**：用户这句；叫醒用例是照 Core 措辞（`subtask_report::report_text`，同样逐字对过）拼出的叫醒消息。",
        "- **工具**：`code_run` 与文件工具在每次运行自己的 macOS 沙盒里真的执行（同票 30 的沙盒，另允许 `date`）；Galley CLI 是假的："
        "`schedule` 命令族按 Agent API §5.20–§5.27 的形状回答、照真实 CLI 校验参数（过去的时刻报 `time_in_past:`，`--target` 默认 `session`），"
        "票 35 的手（改名、置顶、删除、项目、默认模型）也接着；`--help` 是真实 CLI 的原文。每次调用都记下，写命令只改假 CLI 自己的状态。"
        f"每次运行最多 {SCHED_TOOL_CAP} 次工具调用。",
        "- **判定**：按 `cases.json` 每条的 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复里有没有说出时间。"
        "每条都查：`schedule create` 带没带 `--target=assistant`，`schedule` 写命令带没带 `--supervisor=galley-assistant`。",
        "- **票 105 的改动**（主对话 PRD 裁决 151）：手册 `reminders.md` 改成原文第一行写给用户看（像待办的标题），需要时空一行再写给到点时的自己；"
        "卡片与面板只显示第一行。判定加了第一行（每一次 `schedule create` 与 `schedule update --prompt`，规则见下「票 105：第一行」），"
        "旧判定照旧；三条叫醒用例预先放着的任务原文换成新写法（第一行给人、空行、写给自己的）。",
        "",
    ]
    if meta.get("history_note"):
        out += [meta["history_note"], ""]
    sup = meta.get("superseded_runs") or []
    for n, group in enumerate([sup] if isinstance(sup, dict) else sup, 1):
        out += [f"注 {n}：{group['reason']}被替换的 {len(group['runs'])} 次运行原样留在 results.json 的 "
                f"`meta.superseded_runs[{n - 1}]` 里。", ""]
    # Ticket 105: the reruns compare on the rules of their day (the first
    # line was not asked for before it); ticket 105's own says whether the
    # earlier rules went back, and its first lines have a section of their
    # own.
    out += (rerun_section(data, cases, sched_facts_before_105, "105") + first_line_section(data, cases)
            + rerun_section(data, cases, sched_facts_before_105, "73")
            + rerun_section(data, cases, sched_facts_before_105, "63")
            + rerun_section(data, cases, sched_facts_before_105, "60")
            + rerun_section(data, cases, sched_facts_before_105, "59"))
    total = passed = 0
    out += ["## 通过率", "", "| # | 用例 | 分组 | 期望 | 遍数 | 过 | 通过率 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for case in cases:
        runs = by_case.get(case["id"], [])
        if not runs:
            continue
        ok = sum(1 for r in runs if facts[(r["id"], r["variant"])]["pass"])
        total, passed = total + len(runs), passed + ok
        out.append(f"| {case['no']} | {case['id']} | {case['group']} | {case['expect_text'].replace('|', '/')} | "
                   f"{len(runs)} | {ok} | {round(100 * ok / len(runs))}% |")
    if total:
        out.append(f"| | 合计 | | | {total} | {passed} | {round(100 * passed / total)}% |")
    out += ["", "## 一览", "",
            "| # | 用例 | 遍 | 调了什么命令 | 回复原文 | 字数 | 读手册 | 建前查过 | 第一行（票 105） | 判定 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for case in cases:
        for r in sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0)):
            f = facts[(r["id"], r["variant"])]
            cmds = "；".join(short_cmd(c, 220) for c in f["commands"] if cli_name(c.split()) != "help") or "—"
            if f["asked_via_tool"]:
                reply = one_line(f["body"] + "（ask_user：" + str(f["asked_via_tool"].get("question", "")) + "）")
            else:
                reply = one_line(f["body"]) or "（空）"
            verdict = "过" if f["pass"] else "不过：" + "；".join(f["reasons"])
            lines = "；".join(first_line_gist(fl) for fl in f["first_lines"]) or "—"
            out.append(f"| {case['no']} | {case['id']} | {r['repeat']} | {cmds.replace('|', '/')} | {reply} | "
                       f"{f['chars']} | {f['manual']} | {f['listed']} | {lines.replace('|', '/')} | "
                       f"{verdict.replace('|', '/')} |")
    out.append("")
    for case in cases:
        runs = sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0))
        if not runs:
            continue
        out += [f"## {case['no']}. {case['id']}（{case['group']}）", "", f"**期望**：{case['expect_text']}", ""]
        if case["history"]:
            out += ["上下文：", ""]
            for m in case["history"]:
                who = "用户" if m["role"] == "user" else "助手"
                out += [f"> {who}：" + m["content"].replace("\n", "\n> "), ">"]
            out.pop()
            out.append("")
        if case["tasks"]:
            out += ["已有的定时任务（运行那一刻的时间）："]
            out.append("")
            for t in runs[0].get("fixture_tasks") or []:
                spec = next((x for x in case["tasks"] if x["id"] == t["id"]), {})
                where = "，在「In Hand」里" if spec.get("in_hand") else ""
                fired = "，已到点" if t.get("lastFiredAt") else ""
                out.append(f"- `{t['id']}` {t['fireAt']}{where}{fired}：{one_line(t['prompt'])}")
            out.append("")
        first = runs[0]
        out += [("叫醒消息：" if case.get("wake") else "用户：")] + [""] + fenced(first.get("message") or "")
        for r in runs:
            f = facts[(r["id"], r["variant"])]
            out += [f"### 第 {r['repeat']} 遍：{'过' if f['pass'] else '不过'}", ""]
            if not f["pass"]:
                out += ["不过的原因：" + "；".join(f["reasons"]), ""]
            calls = r.get("calls") or []
            if calls:
                out += ["工具调用：", ""]
                for c in calls:
                    line = f"{c['n']}. {call_gist(c)}"
                    for argv in c.get("galley_calls") or []:
                        line += "；galley " + " ".join(argv).replace("`", "'")
                    out.append(line.replace("\n", " "))
                out.append("")
            made = "；".join(f"`{t['id']}` {t.get('fireAt', '')} target={t.get('target')}"
                            + (f" 挂在待办 `{t['todoId']}` 上" if t.get("todoId") else "")
                            + f"：{one_line(t['prompt'])}"
                            for t in f["made"]) or "无"
            if f["made_todos"]:
                made += "；记下的待办：" + "；".join(todo_gist(t) for t in f["made_todos"])
            out += [f"结束：{STOP_LABELS.get(f['stop'], f['stop'])}；读手册：{f['manual']}；建前查过：{f['listed']}；"
                    f"手册版本：`{r.get('manual_sha', '?')}`。", "",
                    f"新建：{made}；删除：{'、'.join(f['cancelled']) or '无'}；改动：{'、'.join(f['changed']) or '无'}。", ""]
            if f["first_lines"]:
                out += ["第一行（票 105）：" + "；".join(first_line_gist(fl) for fl in f["first_lines"]), ""]
            if f["asked_via_tool"]:
                out += ["ask_user 的问题：", ""] + fenced(json.dumps(f["asked_via_tool"], ensure_ascii=False, indent=1), "json")
            out += ["回复（去掉 summary 与建议标签）：", ""] + fenced(f["body"] or "（空）")
            if f["suggestion"]:
                out += [f"建议标签：{f['suggestion']}", ""]
    return "\n".join(line.rstrip() for line in "\n".join(out).split("\n")).rstrip() + "\n"


def todo_gist(t: dict[str, Any]) -> str:
    """A to-do in the fake galley's stored form, in one line."""
    due = t.get("dueAt") or t.get("dueDate") or "无截止"
    state = "已取消" if t.get("cancelledAt") else "已勾掉" if t.get("doneAt") else "没做"
    by = t.get("cancelledBy") or {}
    if t.get("cancelledAt") and by:
        who = {"gui": "用户在桌面上", "system": "Core 顺带"}.get(by.get("via"), by.get("supervisor") or by.get("via"))
        state += f"（{t['cancelledAt']}，{who}" + (f"，原因：{by['reason']}" if by.get("reason") else "") + "）"
    notes = f"（备注：{t['notes']}）" if t.get("notes") else ""
    return f"`{t['id']}` {t['title']}{notes}，截止 {due}，{state}"


# Ticket 63 (main chat PRD ruling 115): a reply that says it noted
# something must follow a write in the same run (a CLI write that changed
# the fake galley, or GA's memory).
NOTED_WORDS = ("记下了", "记住了", "记好了", "已记")
RECITE_RE = re.compile(r"[\s，。！？、：:,.!?「」“”*]")


def unwritten_claim(body: str, wrote: bool) -> str | None:
    said = [w for w in NOTED_WORDS if w in body]
    if said and not wrote:
        return "说了「" + "」「".join(said) + "」，这一轮却什么都没写下（没有改动清单或提醒的写命令，也没写记忆）"
    return None


# Ticket 64 (main chat PRD ruling 116): a reply that notes nothing does not
# take back a noting it never did (「刚才说要加待办有点多此一举，就不加了」);
# judged where `expect.no_retract` is set. The first turn's text and
# <summary> saying it will note (「我把今晚的安排记到待办里。」) are only
# recorded. Checked against every earlier run of the to-do, chat and
# schedule suites: the two hotpot replies of ticket 63 are the only hits.
RETRACT_RE = re.compile(r"刚才(说|提到|讲|想)|多此一举|多余|本来(要|想|打算)|原本(要|想|打算)|"
                        r"就不(加|记|设)了|不(特意|特地|专门)(设|记|加)")
STANCE_RE = re.compile(r"(记|加|放|写)(到|进|入|在)?(待办|清单)|(?<![不别没])(设|挂|定|建|加)(一?个|置|上|好)?"
                       r"(提醒|闹钟|待办)|(我|先|帮你|给你)(先|来)?(记|加)(一下|下来|下|到|进|上|个|一笔)|记下(?!了)")
SUMMARY_TEXT_RE = re.compile(r"<summary>([\s\S]*?)</summary>")
# Ticket 73 (assistant PRD ruling 10): what it does unasked is work, not an
# offer. 「要不要我帮你……」「需要的话我可以……」 and their kin, in the reply
# or in its next-step suggestion: judged where `expect.no_offer` is set,
# noted everywhere else.
OFFER_RE = re.compile(r"要不要我|需要的话[，,]?\s*我|需要我(帮|给|去|来|再|把)|要我(帮|给|去|来|再|把)|"
                      r"我可以(帮|再|顺便|给|去|来)|如果(你|您)需要|如需(要)?我|你看要不要")
# Ticket 75 (assistant PRD ruling 10, the review goes unnoticed): no fixed
# heading. When the morning review speaks it says which thing (one of
# `expect.review_advance.names_any`) and what it did (REVIEW_DID_RE), and
# it is not empty words: that it looked and nothing changed
# (REVIEW_EMPTY_RE fails it). That it did it this morning is only noted
# (REVIEW_MORNING_RE).
REVIEW_DID_RE = re.compile(r"查了|查到|查出|查清|看了|看过|找到|发现|定位|对了|核对|比对|派(了|人)|整理|列了|"
                           r"写了|做了|做好|起草|准备好|算了|确认|原来|是因为")
REVIEW_EMPTY_RE = re.compile(r"没(有)?什么(要|可|好|需要|能)?(推进|做|说|新|变化)|没(有)?(新|啥)(的)?(进展|消息|变化|动静)|"
                             r"(暂时|还|仍然?|依然)没(有)?(进展|变化|动静|新)|一切(正常|照旧|如常)|还是老样子")
REVIEW_MORNING_RE = re.compile(r"早上|今早|今天早|一早|刚才|刚刚")
# Ticket 78 (main chat PRD ruling 126): the morning review and another
# update in one wake (`expect.review_mixed`). The other one gets its reply;
# the review, with nothing done worth telling, is not brought up: no fixed
# heading, no word of having gone over things (REVIEW_TALK_RE), no empty
# words (REVIEW_EMPTY_RE).
REVIEW_TALK_RE = re.compile(r"巡看|过了一遍|在办的(事|几件)|例行|(清单|待办)(上|里)(的)?(其他|其余|别的)|"
                            r"(其他|其余|别的)(的)?(事|几件|待办)(都|也|暂时|还|没)")


def retractions(body: str) -> list[str]:
    """The words of the reply (tags stripped) that take back a noting."""
    return list(dict.fromkeys(m.group(0) for m in RETRACT_RE.finditer(body)))


def first_turn_stance(r: dict[str, Any]) -> dict[str, Any] | None:
    """Ticket 64: what the first model turn said, in its text and in its
    <summary>, when it was not the last (the user sees both while the run
    goes on), and the words in them that say it will note something."""
    turns = r.get("turns") or []
    if len(turns) < 2:
        return None
    raw = turns[0].get("content") or ""
    summary = " ".join(m.strip() for m in SUMMARY_TEXT_RE.findall(raw))
    body = strip_for_display(raw).strip()
    hits = {"text": list(dict.fromkeys(m.group(0) for m in STANCE_RE.finditer(body))),
            "summary": list(dict.fromkeys(m.group(0) for m in STANCE_RE.finditer(summary)))}
    return {"text": body, "summary": summary, "hits": hits, "says": bool(hits["text"] or hits["summary"])}


def memory_changed(r: dict[str, Any]) -> list[str]:
    """The files of GA's memory the run added, changed or removed
    (worker's memory_snapshot, ticket 63)."""
    mc = r.get("memory_changes") or {}
    return sorted(set(mc.get("added") or []) | set(mc.get("changed") or []) | set(mc.get("removed") or []))


# Ticket 110 (main chat PRD ruling 155): the words that send a subtask to
# make again what was handed over (「重做模板」「重新生成一份模板」), before
# the thing's word in `expect.no_redo`; not when told not to (「不要重做模板」
# 「不要再做一份空模板」 in the second round's briefs, 「避免重做通用资料收集
# 模板」 in a reverse check's).
REDO_WORDS_RE = (r"(?<!不要)(?<!不用)(?<!不必)(?<!无需)(?<!无须)(?<!避免)(?<!以免)(?<!免得)(?<!别)(?<!勿)(?<!不)"
                 r"(?:重做|再做|重新做|重新写|重新生成|重新整理|另做|再出一份|再写一份|再生成)")

# Ticket 108 (main chat PRD ruling 154): how a to-do is going goes into its
# notes, one line on top of what is there (newest first: the collapsed row
# shows the start), the day first. The day: 「10月28日」「2026-10-28」
# 「10/28」, in brackets or not, then a colon, a comma or a space (none
# needed after 日 or a bracket).
PROGRESS_DAY_RE = re.compile(r"^[\s【\[（(「]*(?:(\d{4})\s*[年/.\-]\s*)?(\d{1,2})\s*[月/.\-]\s*(\d{1,2})"
                             r"(?:\s*[日号]\s*[】\]）)」]?|\s*[】\]）)」]|(?=\s*(?:[：:，,、]|\s|$)))")


def notes_of(t: dict[str, Any] | None) -> str:
    return (t or {}).get("notes") or ""


def progress_facts(r: dict[str, Any], exp: dict[str, Any], now: datetime, started: datetime,
                   log: list[list[str]], fx_todos: dict[str, dict[str, Any]],
                   todo_by_id: dict[str, dict[str, Any]], quiet: bool, subtask_tags: list[str],
                   stop: Any) -> dict[str, Any]:
    """Ticket 108: the notes the run left against those it started with.

    `expect.progress` ({id, groups, forbid, when_done}): that to-do's notes
    are one new line, then a line break, then the notes it started with
    word for word (none: the line alone). The line starts with the run's
    day, holds a word of each of `groups`, and names by absolute path a
    file the run made in its HOME (when it made one); none of `forbid` is
    anywhere in the notes (what the user took out); the to-do was read
    (`todo show` or `todo list`) before the notes were written; no other
    to-do's notes changed. With `when_done` (a morning review): only when
    it got something done this run (made a file, or spoke without only
    starting subtasks); otherwise the notes stay as they were.
    `expect.notes_same`: no to-do's notes change. Elsewhere a change of
    notes is only noted."""
    reasons: list[str] = []
    flags: list[str] = []
    changed = {tid: (notes_of(fx), notes_of(todo_by_id.get(tid))) for tid, fx in fx_todos.items()
               if notes_of(fx) != notes_of(todo_by_id.get(tid))}

    def gist(tid: str) -> str:
        return f"{fx_todos[tid]['title']}（「{one_line(changed[tid][1]) or '（清空）'}」）"

    want = exp.get("progress")
    out: dict[str, Any] = {"changed": {k: v[1] for k, v in changed.items()}, "line": None, "base": None,
                           "final": None, "applies": bool(want)}
    if not want:
        if changed:
            words = "改了备注：" + "、".join(gist(t) for t in changed)
            (reasons if exp.get("notes_same") else flags).append(("不该动备注却" if exp.get("notes_same") else "")
                                                                  + words)
        return dict(out, reasons=reasons, flags=flags)
    tid = want["id"]
    base, final = notes_of(fx_todos.get(tid)), notes_of(todo_by_id.get(tid))
    out.update(base=base, final=final)
    others = [t for t in changed if t != tid]
    if others:
        reasons.append("动了别的待办的备注：" + "、".join(gist(t) for t in others))
    added = r.get("home_added") or []
    if want.get("when_done"):
        done = bool(added) or (stop == "final_reply" and not quiet and not subtask_tags)
        out["done"] = done
        if not done:
            if final != base:
                reasons.append("这一轮没做成什么（只派了子任务、停在浏览器或没出声），却补了进展：「"
                               + one_line(final) + "」")
            else:
                flags.append("这一轮没做成什么，备注没动（进展这一条没用上）")
            out["applies"] = False
            return dict(out, reasons=reasons, flags=flags)
    if final == base:
        reasons.append("备注没补进展那一行")
        return dict(out, reasons=reasons, flags=flags)
    if base and not final.endswith(base):
        if final.startswith(base):
            reasons.append("补在了原来的备注后面（该在最前面）")
            top = final[len(base):]
        else:
            reasons.append("原来的备注没有一字不差留在新的那一行下面")
            top = final.split("\n", 1)[0]
    else:
        top = final[:len(final) - len(base)] if base else final
        if base and not top.endswith("\n"):
            reasons.append("新的一行没有单独成行（和原来的备注接在同一行）")
        elif base and top.endswith("\n\n"):
            flags.append("新的一行和原来的备注之间空了一行")
    line = top.strip()
    out["line"] = line
    if "\n" in line:
        reasons.append("补了不止一行")
    if "\\n" in line:
        reasons.append("原文里有字面的「\\n」（两个字符），不是换行")
    m = PROGRESS_DAY_RE.match(line)
    if not m:
        reasons.append("这一行不是日子打头")
    else:
        # Ticket 110: `days_back`, the day the thing was done may lead
        # instead (the template made the night before the review).
        back = [now - timedelta(days=k) for k in range(int(want.get("days_back") or 0) + 1)]
        days = {(d.month, d.day) for d in back} | {(started.month, started.day)}
        if (int(m.group(2)), int(m.group(3))) not in days or (m.group(1) and int(m.group(1)) != now.year):
            reasons.append(f"打头的日子不是今天：「{m.group(0).strip()}」")
    for group in want.get("groups") or []:
        if not any(w in line for w in group):
            reasons.append("这一行里没有：" + " / ".join(group))
    for w in want.get("forbid") or []:
        if w in final:
            reasons.append(f"备注里出现了「{w}」（用户删掉的）")
    if added:
        out["files"] = added
        if not any(scrub(p) in scrub(line) for p in added):
            reasons.append("做了文件，这一行没写它的绝对路径" + ("（写成了 ~/ 开头）" if "~/" in line else ""))
    if want.get("path"):
        # Ticket 110: a file in ~/Downloads made before this run, by its
        # absolute path in the run's fake HOME (`<sandbox>/home/`).
        rel = "Downloads/" + want["path"]
        if "/home/" + rel not in scrub(line):
            reasons.append(f"这一行没写 {want['path']} 的绝对路径" + ("（写成了 ~/ 开头）" if "~/" + rel in line else ""))
    writes = [i for i, a in enumerate(log) if cli_name(a) == "todo update" and "notes" in parse_cli(a)[1]
              and parse_cli(a)[0][2:3] == [tid]]
    if writes:
        reads = [i for i, a in enumerate(log[:writes[0]])
                 if cli_name(a) == "todo list" or (cli_name(a) == "todo show" and parse_cli(a)[0][2:3] == [tid])]
        if not reads:
            reasons.append("改备注之前没读这件事（todo show 或 todo list）")
        elif not any(cli_name(log[i]) == "todo show" for i in reads):
            flags.append("改备注之前只读了 todo list（没 todo show）")
        if len(writes) > 1:
            flags.append(f"改了 {len(writes)} 次备注")
    t, old = todo_by_id.get(tid) or {}, fx_todos.get(tid) or {}
    if t.get("title") != old.get("title"):
        reasons.append(f"标题被改了：{t.get('title')}")
    if not exp.get("update") and (t.get("dueAt"), t.get("dueDate")) != (old.get("dueAt"), old.get("dueDate")):
        flags.append("顺手改了截止：" + str(t.get("dueAt") or t.get("dueDate") or "去掉了"))
    return dict(out, reasons=reasons, flags=flags)


def todo_facts(r: dict[str, Any], case: dict[str, Any], judge_memos: bool = True) -> dict[str, Any]:
    """What a to-do run did, and whether it met the case's expectations
    (todo/cases.json `expect`). Commands from the fake galley's log; to-dos
    and tasks made, changed, ticked off and cancelled from its final
    state. Ticket 60: `follow_up` (one follow-up, a to-do with its
    reminder or its own, in a window), `todo: optional` (a to-do may be
    noted, its reminder as `reminder` says), `cancel` (one of these
    cancelled in this run, at the user's request, the kind in the
    reason), `asks_or_any`, and `record_only` (judged by no one: `pass`
    is None); `flags` note what passes but is worth a look. Ticket 63:
    `clock` (the time the message names, from the run's `now`),
    `follow_up.windows` (any of them) and `follow_up.clock`,
    `reminder.optional`, `no_recite`, and for every case a reply that says
    it noted something without a write in the run fails."""
    now = datetime.fromisoformat(r["now"])
    case = clock_case(case, now)
    exp = case["expect"]
    tz = now.tzinfo
    started = datetime.fromtimestamp(r["started_at"], tz) if r.get("started_at") else now
    log = [c.get("argv") or [] for c in r.get("galley_log") or []]
    names = [cli_name(a) for a in log]
    fx_todos = {t["id"]: t for t in r.get("fixture_todos") or []}
    fx_tasks = {t["id"]: t for t in r.get("fixture_tasks") or []}
    st = r.get("fake_state") or {}
    todos = st["todos"] if st.get("todos") is not None else list(fx_todos.values())
    tasks = st["tasks"] if st.get("tasks") is not None else list(fx_tasks.values())
    todo_by_id = {t["id"]: t for t in todos}
    made_todos = [t for t in todos if t["id"] not in fx_todos and not t.get("cancelledAt")]
    adds = [parse_cli(a) for a in log if cli_name(a) == "todo add"]
    standalone = [t for t in tasks if t["id"] not in fx_tasks and not t.get("todoId") and not t.get("cancelledAt")]
    # Ticket 60: cancelled in this run, not already cancelled when it began.
    cancelled_todos = [t for t in todos if t["id"] in fx_todos and t.get("cancelledAt")
                       and not fx_todos[t["id"]].get("cancelledAt")]
    cancelled_fx_tasks = [t for t in tasks if t["id"] in fx_tasks and t.get("cancelledAt")
                          and not fx_tasks[t["id"]].get("cancelledAt")]
    memory_writes = [str((c.get("args") or {}).get("path", "")) for c in r.get("calls") or []
                     if c.get("name") in ("file_write", "file_patch")
                     and "memory" in str((c.get("args") or {}).get("path", ""))]
    sched_creates = [parse_cli(a) for a in log if cli_name(a) == "schedule create"]
    writes = [n for n in names if n in ALL_WRITES]
    held = [n for n in names if n in HOLDING_COMMANDS]
    reply = r.get("final_reply") or ""
    body = strip_for_display(reply)
    is_no_reply = bool(NO_REPLY_RE.fullmatch(body.strip()))
    has_no_reply = bool(NO_REPLY_RE.search(reply))
    # Ticket 73: the subtasks the reply starts, and whether it says anything
    # to the user besides them (Core strips the tags and <no-reply/>).
    subtask_tags = [m.strip() for m in SUBTASK_TAG_RE.findall(reply)]
    quiet = not NO_REPLY_RE.sub("", SUBTASK_TAG_RE.sub("", body)).strip()
    offers = list(dict.fromkeys(m.group(0) for m in OFFER_RE.finditer(body)))
    offers += [f"（建议里）{m.group(0)}" for m in OFFER_RE.finditer(r.get("next_suggestion") or "")]
    stop = r.get("stop_reason")
    asked = (r.get("tool_call") or {}).get("args") if stop == "ask_user" else None
    said = body + ("\n" + json.dumps(asked, ensure_ascii=False) if asked else "")
    calls = r.get("calls") or []
    write_at = next((c["n"] for c in calls
                     if any(cli_name(a) in ALL_WRITES for a in c.get("galley_calls") or [])), None)
    manual, reads = manual_column(calls, write_at)
    first_list = next((i for i, n in enumerate(names) if n == "todo list"), None)
    first_write = next((i for i, n in enumerate(names) if n in TODO_WRITES), None)
    if first_write is None:
        listed = "读了清单" if first_list is not None else "—"
    else:
        listed = "查了" if first_list is not None and first_list < first_write else "没查"

    def local(iso: str) -> datetime:
        return datetime.fromisoformat(iso).astimezone(tz)

    def bound(spec: dict[str, Any]) -> datetime:
        return now if spec.get("now") else sched_time(spec, now, started)

    def in_window(at: datetime, window: dict[str, Any]) -> bool:
        return bound(window["from"]) - timedelta(seconds=59) <= at <= bound(window["to"]) + timedelta(seconds=59)

    def due_end(t: dict[str, Any]) -> datetime | None:
        if t.get("dueAt"):
            return local(t["dueAt"])
        if t.get("dueDate"):
            d = datetime.strptime(t["dueDate"], "%Y-%m-%d")
            return datetime(d.year, d.month, d.day, 23, 59, tzinfo=tz)
        return None

    def due_ok(t: dict[str, Any], want: dict[str, Any]) -> str | None:
        if t.get("dueAt"):
            if not in_window(local(t["dueAt"]), want["window"]):
                return "截止不对：" + local_words(local(t["dueAt"]))
            return None
        if t.get("dueDate"):
            if want.get("need_time"):
                return f"截止没带时刻（{t['dueDate']}）"
            d = datetime.strptime(t["dueDate"], "%Y-%m-%d")
            lo = datetime(d.year, d.month, d.day, tzinfo=tz)
            if lo + timedelta(days=1) <= bound(want["window"]["from"]) or lo > bound(want["window"]["to"]):
                return f"截止那天不对：{t['dueDate']}"
            return None
        return "没写截止"

    def reminder_of(todo_id: str) -> dict[str, Any] | None:
        live = [t for t in tasks if t.get("todoId") == todo_id and not t.get("cancelledAt")]
        return live[-1] if live else None

    reasons: list[str] = []
    flags: list[str] = []
    if r.get("status") != "ok":
        reasons.append(f"运行失败：{r.get('status')}")
    if stop == "web_tool" and exp.get("allow_web_stop"):
        # Ticket 73: a step it may take unasked (look something up) ends
        # the sandbox run; what it would have said is not seen.
        flags.append("停在浏览器工具：在做一步（只读），结果与回复看不到")
    elif stop not in ("final_reply", "ask_user"):
        reasons.append("没走到最终回复：" + STOP_LABELS.get(stop, str(stop)))
    if held:
        reasons.append("用了会卡住主对话的命令：" + "、".join(sorted(set(held))))
    cap = exp.get("subtasks_max")
    if "session new" in names:
        reasons.append("开了子任务或新会话")
    elif cap is None and "<subtask>" in reply:
        reasons.append("开了子任务或新会话")
    elif cap is not None and len(subtask_tags) > cap:
        reasons.append(f"最多派 {cap} 件子任务，派了 {len(subtask_tags)} 件")
    if exp.get("no_offer") and offers:
        reasons.append("提了建议而不是做：" + "、".join(f"「{w}」" for w in offers))
    elif offers:
        flags.append("提了建议：" + "、".join(f"「{w}」" for w in offers))
    # Ticket 110: what was handed over is not made again. `no_files`: no
    # new file in the fake HOME; `no_redo`: a new file named with one of
    # these words, or a subtask sent to make it again (REDO_WORDS_RE before
    # the word), fails; a subtask that only names it (reads it, leaves it
    # as it is) is noted.
    made_files = r.get("home_added") or []
    if exp.get("no_files") and made_files:
        reasons.append("做了新文件：" + "、".join(os.path.basename(p) for p in made_files))
    for w in exp.get("no_redo") or []:
        redo = [os.path.basename(p) for p in made_files if w in os.path.basename(p)]
        again = re.compile(REDO_WORDS_RE + r"[^。；;\n]{0,12}" + re.escape(w))
        redo += [one_line(t)[:40] for t in subtask_tags if again.search(t)]
        if redo:
            reasons.append(f"重做了「{w}」：" + "、".join(redo))
        named = [t for t in subtask_tags if w in t and not again.search(t)]
        if named:
            flags.append(f"派的子任务提到了「{w}」（读它、不改它，不是重做）")
    for words, opts in sched_creates:
        if opts.get("target") != "assistant":
            reasons.append("schedule create 没带 --target=assistant")
            break
    for a in log:
        if cli_name(a) in SCHEDULE_WRITES + TODO_WRITES and parse_cli(a)[1].get("supervisor") != "galley-assistant":
            reasons.append(f"{cli_name(a)} 没带 --supervisor=galley-assistant")
            break
    allowed = set(exp.get("allow") or [])
    timed: dict[str, Any] | None = None
    want = exp.get("todo", "none")
    fu = exp.get("follow_up")
    if fu:
        # One follow-up: a to-do noted here with its reminder, or a
        # reminder of its own; its time in the window, a to-do's not after
        # its due.
        via = fu.get("via", "either")
        if via in ("either", "todo"):
            allowed.add("todo add")
        if via in ("either", "assistant"):
            allowed.add("schedule create")
        ups = [("todo", rem, t) for t in made_todos for rem in [reminder_of(t["id"])] if rem]
        ups += [("assistant", x, None) for x in standalone]
        bare = [t for t in made_todos if not reminder_of(t["id"])]
        if len(ups) != 1:
            reasons.append(f"该设 1 个跟进（待办挂提醒，或它自己的提醒），设了 {len(ups)} 个")
        else:
            kind, timed, t = ups[0]
            at = local(timed["fireAt"]) if timed.get("fireAt") else None
            if via != "either" and kind != via:
                reasons.append("该是" + ("待办挂提醒" if via == "todo" else "它自己的提醒（schedule create）")
                               + "，却" + ("记成了待办" if kind == "todo" else "建成了它自己的提醒"))
            if fu.get("prefer") and kind != fu["prefer"]:
                flags.append("记成了" + ("待办挂提醒" if kind == "todo" else "它自己的提醒")
                             + "（期望" + ("待办" if fu["prefer"] == "todo" else "它自己的提醒") + "，也算过）")
            if timed.get("target") != "assistant":
                reasons.append("建成了每次新开会话的任务（target 不是 assistant）")
            if at is None:
                reasons.append("不是一次性提醒")
            elif not any(in_window(at, w) for w in fu.get("windows") or [fu["window"]]):
                reasons.append("跟进时间不对：" + local_words(at))
            elif fu.get("clock") and at.strftime("%H:%M") != fu["clock"]:
                reasons.append(f"提醒不在说的 {fu['clock']}：" + local_words(at))
            elif t is not None and due_end(t) and at > due_end(t):
                reasons.append("提醒在截止之后：" + local_words(at))
            if t is not None and exp.get("title_any") and not any(w in t["title"] for w in exp["title_any"]):
                reasons.append("待办标题里没有：" + " / ".join(exp["title_any"]))
        if bare:
            flags.append("另记了不带提醒的待办：" + "、".join(t["title"] for t in bare))
    elif want == "optional":
        allowed.add("todo add")
        if len(made_todos) > 1:
            reasons.append(f"最多记 1 件待办，记了 {len(made_todos)} 件")
        for t in made_todos:
            rem = reminder_of(t["id"])
            if "reminder" in exp and exp["reminder"] is None and rem:
                reasons.append("说了不用提醒，却挂了提醒：" + local_words(local(rem["fireAt"])))
            elif not rem:
                flags.append(f"记了不带提醒的待办：{t['title']}")
    elif want == "one":
        allowed.add("todo add")
        if len(made_todos) != 1:
            reasons.append(f"该记 1 件待办，记了 {len(made_todos)} 件")
        else:
            t = made_todos[0]
            if exp.get("title_any") and not any(w in t["title"] for w in exp["title_any"]):
                reasons.append("待办标题里没有：" + " / ".join(exp["title_any"]))
            if "due" in exp:
                if exp["due"] is None:
                    if t.get("dueAt") or t.get("dueDate"):
                        reasons.append("不该写截止：" + str(t.get("dueAt") or t.get("dueDate")))
                else:
                    bad = due_ok(t, exp["due"])
                    if bad:
                        reasons.append(bad)
            rem = reminder_of(t["id"])
            if exp.get("reminder") is None:
                if rem:
                    reasons.append("没时间的不该挂提醒：" + local_words(local(rem["fireAt"])))
            elif not rem:
                if exp["reminder"].get("optional"):
                    flags.append("没挂提醒")
                else:
                    reasons.append("有截止却没挂提醒")
            else:
                timed = rem
                at = local(rem["fireAt"])
                end = due_end(t)
                clock = exp["reminder"].get("clock")
                if not in_window(at, exp["reminder"]["window"]):
                    reasons.append("提醒时间不对：" + local_words(at))
                elif clock and at.strftime("%H:%M") != clock:
                    reasons.append(f"提醒不在说的 {clock}：" + local_words(at))
                elif end and at > end:
                    reasons.append("提醒在截止之后：" + local_words(at))
    elif adds or made_todos:
        reasons.append("不该记待办却记了（或试着记）：" + "、".join(t["title"] for t in made_todos))
    if fu:
        pass
    elif exp.get("schedule") == "one":
        allowed.add("schedule create")
        if len(standalone) != 1:
            reasons.append(f"该建 1 个它自己的提醒（schedule create），建了 {len(standalone)} 个")
        else:
            timed = standalone[0]
            if timed.get("target") != "assistant":
                reasons.append("建成了每次新开会话的任务（target 不是 assistant）")
            if exp.get("window") and not in_window(local(timed["fireAt"]), exp["window"]):
                reasons.append("时间不对：" + local_words(local(timed["fireAt"])))
            if exp.get("words_any") and not any(w in timed["prompt"] for w in exp["words_any"]):
                reasons.append("记下的话里没有：" + " / ".join(exp["words_any"]))
    elif exp.get("schedule") == "optional":
        # Ticket 108: a reminder of its own may go with the news (to ask
        # after the budget next week); counted, not judged.
        allowed.add("schedule create")
        if standalone:
            flags.append(f"给自己挂了 {len(standalone)} 个提醒：" + "、".join(
                f"{local_words(local(x['fireAt'])) if x.get('fireAt') else '（不是一次性）'}「{first_line(x['prompt'])}」"
                for x in standalone))
    elif standalone or sched_creates:
        reasons.append("不该建它自己的提醒（schedule create）却建了")
    for tid in exp.get("done") or []:
        allowed.add("todo done")
        t = todo_by_id.get(tid, {})
        if not t.get("doneAt"):
            reasons.append(f"该勾掉 {tid}（{fx_todos.get(tid, {}).get('title')}），没勾")
        elif (t.get("doneBy") or {}).get("supervisor") != "galley-assistant":
            reasons.append("勾掉时没记成 Galley 勾的")
    upd = exp.get("update")
    if upd:
        allowed.add("todo update")
        t = todo_by_id.get(upd["id"], {})
        old = fx_todos.get(upd["id"], {})
        bad = due_ok(t, {"window": upd["due_window"]})
        if bad:
            reasons.append("改到的" + bad)
        rem = reminder_of(upd["id"])
        old_rem = next((x for x in fx_tasks.values() if x.get("todoId") == upd["id"]), None)
        if not rem:
            reasons.append("改时间把提醒弄丢了")
        else:
            timed = rem
            end = due_end(t)
            at = local(rem["fireAt"])
            if old_rem and rem.get("fireAt") == old_rem.get("fireAt"):
                reasons.append("提醒没跟着挪（还在 " + local_words(at) + "）")
            elif end and at > end:
                reasons.append("提醒在新截止之后：" + local_words(at))
            elif at < now:
                reasons.append("提醒在过去")
        if t.get("title") != old.get("title"):
            reasons.append(f"标题被改了：{t.get('title')}")
    cx = exp.get("cancel")
    if cx:
        # Ticket 60: the follow-up the user turned down, cancelled in this
        # run by Galley at their request, the kind in the reason.
        allowed |= {"todo cancel", "todo update", "schedule delete"}
        gone = [t for t in cancelled_todos + cancelled_fx_tasks if t["id"] in cx["any_of"]]
        mine = [t for t in gone if (t.get("cancelledBy") or {}).get("supervisor") == "galley-assistant"]
        if not gone:
            reasons.append("该取消 " + " / ".join(cx["any_of"]) + "，没取消")
        elif not mine:
            reasons.append("取消时没记成 Galley 照用户的话取消的：" + json.dumps(gone[0].get("cancelledBy"), ensure_ascii=False))
        else:
            why = " ".join(str((t.get("cancelledBy") or {}).get("reason") or "") for t in mine)
            if not any(w.lower() in why.lower() for w in cx["reason_any"]):
                reasons.append("--reason 里没写明是哪一类：" + (why.strip() or "（没写）"))
            elif min(len(str((t.get("cancelledBy") or {}).get("reason") or "")) for t in mine) > IN_HAND_TEXT_CHARS:
                flags.append(f"原因超过 {IN_HAND_TEXT_CHARS} 个字，「在办的事」里会被截断：{why.strip()}")
            if not any(t["id"] in fx_todos for t in mine) and any(x in fx_todos for x in cx["any_of"]):
                flags.append("只取消了提醒，待办还在清单上")
    dis = exp.get("disable")
    if dis:
        # Ticket 73: the morning review stopped at the user's word: paused
        # (`schedule disable`), never cancelled.
        allowed.add("schedule disable")
        t = next((x for x in tasks if x["id"] == dis["id"]), {})
        if "schedule delete" in names or t.get("cancelledAt"):
            reasons.append("用了 schedule delete（该 disable，停掉而不是删掉）")
        elif t.get("enabled", True):
            reasons.append(f"没停掉 {dis['id']}（schedule disable）")
        touched = ("schedule disable", "schedule delete", "schedule update", "schedule enable")
        if any(parse_cli(a)[0][2:3] != [dis["id"]] for a in log if cli_name(a) in touched):
            reasons.append("动了别的定时任务")
    changed_status = [tid for tid, t in todo_by_id.items() if tid in fx_todos
                      and (bool(t.get("doneAt")) != bool(fx_todos[tid].get("doneAt"))
                           or bool(t.get("cancelledAt")) != bool(fx_todos[tid].get("cancelledAt")))
                      and tid not in (exp.get("done") or []) and tid not in ((cx or {}).get("any_of") or [])]
    if changed_status:
        reasons.append("动了不该动的待办：" + "、".join(todo_by_id[x]["title"] for x in changed_status))
    if exp.get("reads_list"):
        if first_list is None:
            reasons.append("回答之前没读 `todo list`")
    # Ticket 108: the notes, against what the run started with.
    progress = progress_facts(r, exp, now, started, log, fx_todos, todo_by_id, quiet, subtask_tags, stop)
    if exp.get("progress"):
        allowed.add("todo update")
    reasons += progress["reasons"]
    flags += progress["flags"]
    extra = sorted({n for n in writes if n not in allowed})
    if extra:
        reasons.append("多余的写命令：" + "、".join(extra))
    if "review_advance" in exp:
        # Ticket 73: the morning review with something to move forward: a
        # step done, or at most two subtasks started; silent while they
        # run, speaking only with something done. Ticket 75: then saying
        # which thing and what it did, in its own words (no fixed heading),
        # and not that nothing changed.
        if stop == "web_tool":
            pass
        elif quiet:
            if not subtask_tags and (exp["review_advance"] or {}).get("may_rest"):
                # Ticket 110: it may do something for it, need not.
                flags.append("什么都没做（不出声、没派子任务；这条可以）")
            elif not subtask_tags:
                reasons.append("什么都没推进就不出声（没派子任务，也没做成什么）")
            elif not has_no_reply:
                flags.append("只派了子任务、没写 <no-reply/>（Core 照样不显示）")
        else:
            # Ticket 108: a file it made in the fake HOME is work done too,
            # in the same script as its galley calls or not.
            acted = bool(subtask_tags) or bool(r.get("home_added")) or any(
                c.get("name") in ("file_write", "file_patch")
                or (c.get("name") == "code_run" and not c.get("galley_calls")
                    and MANUAL_STATE_PATH not in json.dumps(c.get("args"), ensure_ascii=False))
                for c in calls)
            if not acted:
                reasons.append("没做成什么却开口了")
            topic = (exp["review_advance"] or {}).get("names_any") or []
            if topic and not any(n in body for n in topic):
                reasons.append("开口了却没说是哪件事")
            # Ticket 108: a case's own words for what it did (「比了一下」).
            did_any = (exp["review_advance"] or {}).get("did_any") or []
            if not REVIEW_DID_RE.search(body) and not any(w in body for w in did_any):
                reasons.append("开口了却没说做了什么")
            empty = REVIEW_EMPTY_RE.search(body)
            if empty:
                reasons.append(f"开口说的是空话（「{empty.group(0)}」）")
            if not REVIEW_MORNING_RE.search(body):
                flags.append("没说是早上做的")
            if has_no_reply:
                flags.append("开口了又写了 <no-reply/>")
            if exp.get("max_chars") and shown_len(body) > exp["max_chars"]:
                reasons.append(f"太长：{shown_len(body)} 字，上限 {exp['max_chars']}")
    elif "review_mixed" in exp:
        # Ticket 78: the morning review came due in the same wake as
        # another update (a reminder, a subtask's result). Swallowed when
        # the reply says nothing to the user (only <no-reply/>, or only
        # tags) or nothing of that update (none of `names_any`); the
        # review, with nothing done worth telling, is not brought up.
        topic = (exp["review_mixed"] or {}).get("names_any") or []
        if stop != "final_reply":
            pass
        elif quiet and not (has_no_reply or subtask_tags):
            reasons.append("回复正文是空的（话只写在 <summary> 里，主对话不显示）")
        elif quiet:
            reasons.append("吞掉了同一次叫醒里的另一件事：整条不出声" + ("（只有 <no-reply/>）" if is_no_reply else ""))
        else:
            if topic and not any(n in body for n in topic):
                reasons.append("吞掉了同一次叫醒里的另一件事：开口了却没提它（" + " / ".join(topic) + "）")
            talk = REVIEW_TALK_RE.search(body) or REVIEW_EMPTY_RE.search(body)
            if talk:
                reasons.append(f"提了巡看（「{talk.group(0)}」）")
            if has_no_reply:
                flags.append("开口了又写了 <no-reply/>（Core 照样显示正文）")
            if exp.get("no_recite"):
                flat = RECITE_RE.sub("", body)
                if body.lstrip().startswith(("提醒：", "提醒:", "提醒你：")) or any(
                        flat in (RECITE_RE.sub("", w), "提醒" + RECITE_RE.sub("", w)) for w in exp["no_recite"]):
                    reasons.append("复述了提醒的原话：" + body.strip()[:40])
            if exp.get("max_chars") and shown_len(body) > exp["max_chars"]:
                reasons.append(f"太长：{shown_len(body)} 字，上限 {exp['max_chars']}")
    elif "review_memo" in exp:
        # Ticket 96: the morning review woken for a memo; memo_facts judges
        # the reply (quiet, or something done; never an offer).
        pass
    elif exp.get("quiet_or_file"):
        # Ticket 110: nothing new to tell, so <no-reply/>; or it speaks
        # only to hand over the file it made before (the reply that
        # brought it back gave no card), as [FILE:<absolute path>].
        if not is_no_reply:
            refs = [x.strip() for x in FILE_REF_RE.findall(reply)]
            if stop == "final_reply" and not body.strip():
                reasons.append("回复正文是空的（话只写在 <summary> 里，主对话不显示）")
            elif not refs:
                reasons.append("开口了却没交出文件（该只回 <no-reply/>，或只为交出那份文件开口）")
            elif not all(x.startswith("/") or x.startswith("$TMPDIR") for x in refs):
                reasons.append("[FILE:] 里不是绝对路径：" + "、".join(refs))
            else:
                flags.append("开口交出了文件（也算过）：" + one_line(FILE_REF_RE.sub("", body))[:60])
            if has_no_reply:
                flags.append("开口了又写了 <no-reply/>（Core 照样显示正文）")
            if exp.get("max_chars") and shown_len(body) > exp["max_chars"]:
                reasons.append(f"太长：{shown_len(body)} 字，上限 {exp['max_chars']}")
    elif exp.get("no_reply"):
        if not is_no_reply:
            reasons.append("回复不是只有 <no-reply/>")
    else:
        if has_no_reply:
            reasons.append("不该写 <no-reply/>")
        if stop == "final_reply" and not body.strip():
            reasons.append("回复正文是空的（话只写在 <summary> 里，主对话不显示）")
        if exp.get("mentions_time") and timed and timed.get("fireAt"):
            if not says_time(said, local(timed["fireAt"]), now, started):
                reasons.append("回复没说出提醒时间（" + local_words(local(timed["fireAt"])) + "）")
        if exp.get("mentions_time_of"):
            t = next((x for x in tasks if x["id"] == exp["mentions_time_of"]), {})
            if t.get("fireAt") and not says_time(said, local(t["fireAt"]), now, started):
                reasons.append("没说已有的提醒是什么时候（" + local_words(local(t["fireAt"])) + "）")
        if exp.get("mentions_any") and not any(w in said for w in exp["mentions_any"]):
            reasons.append("没点到：" + " / ".join(exp["mentions_any"]))
        for group in exp.get("mentions_groups") or []:
            if not any(w in said for w in group):
                reasons.append("漏了：" + " / ".join(group))
        if exp.get("forbid_any") and any(w in said for w in exp["forbid_any"]):
            reasons.append("不该说：" + " / ".join(w for w in exp["forbid_any"] if w in said))
        fu = exp.get("forbid_unless")
        if fu:
            for piece in re.split(r"[\n。；;]", said):
                if fu["word"] in piece and not any(w in piece for w in fu["unless_any"]):
                    reasons.append(f"把已勾掉的「{fu['word']}」当成还没办：{piece.strip()[:40]}")
                    break
        if exp.get("asks") and not (asked or "？" in body or "?" in body):
            reasons.append("该先问一句，没问")
        if exp.get("asks_or_any") and not ("？" in body or "?" in body or any(w in body for w in exp["asks_or_any"])):
            reasons.append("只复述了提醒：没问一句，也没给下一步（" + " / ".join(exp["asks_or_any"]) + "）")
        if exp.get("no_recite"):
            flat = RECITE_RE.sub("", body)
            if body.lstrip().startswith(("提醒：", "提醒:", "提醒你：")) or any(
                    flat in (RECITE_RE.sub("", w), "提醒" + RECITE_RE.sub("", w)) for w in exp["no_recite"]):
                reasons.append("复述了提醒的原话：" + body.strip()[:40])
        if exp.get("max_chars") and shown_len(body) > exp["max_chars"]:
            reasons.append(f"太长：{shown_len(body)} 字，上限 {exp['max_chars']}")
    retract = retractions(body)
    if exp.get("no_retract") and retract:
        reasons.append("回复提了改口（没设的不提本来要设）：" + "".join(f"「{w}」" for w in retract))
    mem = memory_changed(r)
    # Ticket 96: a memo written is a write too (the fake galley's record of
    # them); outside the memo suite it is only noted.
    memo_events = st.get("memo_events") or []
    # Ticket 98: the to-do and chat suites' `expect.memo` (as the memo
    # suite's, "optional" may note one), judged only for a run whose manual
    # had the memos' part (ticket 96 on): the runs before it never had the
    # command. Elsewhere a memo written is only noted.
    judged_memos = (judge_memos and exp.get("memo") is not None
                    and "memo.md" in (r.get("manual_files") or []))
    if judged_memos:
        mj = memo_judgement(r, exp["memo"], now)
        reasons += mj["reasons"]
        if exp["memo"] == "optional" and (mj["new"] or mj["changed"]):
            flags.append("记了备忘（也对）：" + "、".join(f"「{m['text']}」" for m in mj["new"] + mj["changed"]))
    elif memo_events and judge_memos:
        flags.append("写了备忘：" + "、".join(f"{e['action']}「{e['text']}」" for e in memo_events))
    wrote = bool([t for t in todos if t["id"] not in fx_todos] or [t for t in tasks if t["id"] not in fx_tasks]
                 or [t for t in todos if t["id"] in fx_todos and t != fx_todos[t["id"]]]
                 or [t for t in tasks if t["id"] in fx_tasks and t != fx_tasks[t["id"]]] or mem or memo_events)
    # Ticket 110: the words inside a <subtask> tag are the subtask's brief,
    # not said to the user (「备注已记录该消息」 in one is no claim).
    claim = unwritten_claim(SUBTASK_TAG_RE.sub("", body), wrote)
    if claim:
        reasons.append(claim)
    if memory_writes or mem:
        flags.append("写了记忆：" + "、".join(dict.fromkeys([os.path.basename(x) for x in memory_writes]
                                                          + [os.path.basename(x) for x in mem])))
    record = bool(exp.get("record_only"))
    return {
        "commands": [" ".join(a) for a in log],
        "names": names,
        "writes": writes,
        "made_todos": made_todos,
        "cancelled_todos": [t["id"] for t in cancelled_todos],
        "memory_writes": memory_writes,
        "memory_changed": mem,
        "wrote": wrote,
        "flags": flags,
        "record_only": record,
        "made_tasks": [t for t in tasks if t["id"] not in fx_tasks],
        "todos_after": [t for t in todos if t["id"] in fx_todos and t != fx_todos[t["id"]]],
        "cancelled_tasks": sorted(t["id"] for t in tasks if t["id"] in fx_tasks and t.get("cancelledAt")
                                  and not fx_tasks[t["id"]].get("cancelledAt")),
        "timed": timed,
        "held": held,
        "body": body,
        "no_reply": is_no_reply,
        "quiet": quiet,
        "subtasks": subtask_tags,
        "offers": offers,
        "chars": len(body),
        "suggestion": r.get("next_suggestion"),
        "asked_via_tool": asked,
        "manual": manual,
        "manual_reads": reads,
        "listed": listed,
        "stop": stop,
        "retract": retract,
        "stance": first_turn_stance(r),
        "progress": progress,
        "pass": None if record else not reasons,
        "reasons": reasons,
    }


def verdict_words(f: dict[str, Any]) -> str:
    """The 判定 column: 过 / 不过 with the reasons / 只记录 (ticket 60's
    two-sided cases), then the flags."""
    verdict = "只记录" if f["pass"] is None else "过" if f["pass"] else "不过：" + "；".join(f["reasons"])
    if f.get("flags"):
        verdict += "（注：" + "；".join(f["flags"]) + "）"
    return verdict


PROGRESS_GROUP = "进展写进备注（票 108）"
PROGRESS_SOURCES = (("新手册", None), ("旧手册（同日对照）", "ticket108w_control"),
                    ("反向检查（只拿掉 todos-change.md 那一条）", "ticket108r_control"))


def progress_section(data: dict[str, Any], cases: list[dict[str, Any]]) -> list[str]:
    """Ticket 108: the cases of how a to-do is going, under the new manual
    (the results), the manual of before it (meta.ticket108w_control) and
    the new one without the todos-change.md line (meta.ticket108r_control):
    passes per case, then each run's notes as it left them."""
    meta = data["meta"]
    want = [c for c in cases if c.get("group") == PROGRESS_GROUP]
    if not want:
        return []
    by_id = {c["id"]: c for c in want}
    sources = [(label, [r for r in (data["results"] if key is None else meta.get(key) or []) if r["id"] in by_id])
               for label, key in PROGRESS_SOURCES]
    sources = [(label, runs) for label, runs in sources if runs]
    if not sources:
        return []
    facts = {(label, r["id"], r["variant"]): todo_facts(r, by_id[r["id"]]) for label, runs in sources for r in runs}
    out = ["## 票 108：进展写进备注", "",
           "主聊天 PRD 裁决 154：替一件待办做成了东西、或用户说了它的新消息，在备注最前面补一行，日子打头，文件写绝对路径；"
           "先读再补，原来的备注一字不差留在下面；看过没变化不写。每格是「过 / 运行」。旧手册是这一票之前的 "
           "`todos-change.md`、`todos.md` 与 `unasked.md`，反向检查只拿掉 `todos-change.md` 那一条（`todos.md`、"
           "`unasked.md` 的两句指向留着）；"
           "两组都用同一套判定，在旧手册下「不过」是预期的（不该补的两条除外）。", "",
           "| # | 用例 | " + " | ".join(label for label, _ in sources) + " |",
           "| --- | --- |" + " --- |" * len(sources)]
    for case in want:
        cells = []
        for label, runs in sources:
            mine = [r for r in runs if r["id"] == case["id"]]
            ok = sum(1 for r in mine if facts[(label, r["id"], r["variant"])]["pass"])
            cells.append(f"{ok} / {len(mine)}" if mine else "—")
        out.append(f"| {case['no']} | {case['id']} | " + " | ".join(cells) + " |")
    out += ["", "每一遍留下的备注（新的一行；没补的写「没动」）：", ""]
    for case in want:
        out.append(f"- **{case['id']}**：")
        for label, runs in sources:
            for r in sorted((x for x in runs if x["id"] == case["id"]), key=lambda x: x.get("repeat", 0)):
                f = facts[(label, r["id"], r["variant"])]
                p = f["progress"]
                if p["applies"] and p["final"] is not None and p["final"] != p["base"]:
                    got = f"「{one_line(p['line'] or '')}」"
                elif p.get("changed"):
                    got = "改了别的：" + "、".join(f"「{one_line(v)}」" for v in p["changed"].values())
                else:
                    got = "没动"
                verdict = "过" if f["pass"] else "不过：" + "；".join(f["reasons"])
                out.append(f"  - {label}第 {r.get('repeat', 1)} 遍：{got}；{verdict}".replace("|", "/"))
    out.append("")
    return out


MOVED_GROUP = "巡看只为动过的事醒（票 110）"
MOVED_SOURCES = (("新手册", None), ("旧手册（同日对照）", "ticket110w_control"),
                 ("反向检查（只拿掉 wake.md 新加那一条）", "ticket110r_control"))


def moved_gist(f: dict[str, Any], r: dict[str, Any]) -> str:
    """Ticket 110: what one review run did, in a line: the notes, the
    subtasks, the files, its own reminders, the reply."""
    parts = []
    p = f["progress"]
    if p.get("applies") and p.get("final") is not None and p["final"] != p.get("base"):
        parts.append(f"备注补了「{one_line(p.get('line') or '')}」")
    elif p.get("changed"):
        parts.append("改了备注：" + "、".join(f"「{one_line(v)}」" for v in p["changed"].values()))
    else:
        parts.append("备注没动")
    if f["subtasks"]:
        parts.append("派了 " + "、".join(f"「{one_line(t)}」" for t in f["subtasks"]))
    if r.get("home_added"):
        parts.append("做了文件 " + "、".join(os.path.basename(x) for x in r["home_added"]))
    mine = [t for t in f["made_tasks"] if not t.get("todoId") and not t.get("cancelledAt")]
    if mine:
        parts.append("给自己挂了提醒 " + "、".join(f"{t.get('fireAt', '')[:16]}「{first_line(t['prompt'])}」"
                                                 for t in mine))
    if f["stop"] == "web_tool":
        parts.append("停在浏览器")
    reply = "<no-reply/>" if f["no_reply"] else f"「{one_line(f['body'])[:80]}」" if f["body"].strip() else "（正文空）"
    parts.append("回复 " + reply)
    return "，".join(parts)


def moved_section(data: dict[str, Any], cases: list[dict[str, Any]]) -> list[str]:
    """Ticket 110: the four review cases under the new manual (the
    results), the manual of before it (meta.ticket110w_control) and the
    new one without wake.md's new bullet (meta.ticket110r_control):
    passes per case, then what each run did."""
    meta = data["meta"]
    want = [c for c in cases if c.get("group") == MOVED_GROUP]
    if not want:
        return []
    by_id = {c["id"]: c for c in want}
    sources = [(label, [r for r in (data["results"] if key is None else meta.get(key) or []) if r["id"] in by_id])
               for label, key in MOVED_SOURCES]
    sources = [(label, runs) for label, runs in sources if runs]
    if not sources:
        return []
    facts = {(label, r["id"], r["variant"]): todo_facts(r, by_id[r["id"]]) for label, runs in sources for r in runs}
    out = ["## 票 110：巡看只为动过的事醒", "",
           "主聊天 PRD 裁决 155：巡看先读那件事；备注最前面是它做成的东西、用户之后没提过，下一步在用户手里，不再为它做事；"
           "对话里看得出做过、备注还没写的，先补那一行；隔几天要再看一眼的，给自己挂提醒。每格是「过 / 运行」。旧手册是这一票之前的 "
           "`wake.md`，反向检查只拿掉「Take each thing in turn」之后新加的那一条（第一段的新说法留着）；两组都用同一套判定。"
           "评测不经 Core 判醒不醒：用例直接拼到点的叫醒消息。", "",
           "| # | 用例 | " + " | ".join(label for label, _ in sources) + " |",
           "| --- | --- |" + " --- |" * len(sources)]
    for case in want:
        cells = []
        for label, runs in sources:
            mine = [r for r in runs if r["id"] == case["id"]]
            ok = sum(1 for r in mine if facts[(label, r["id"], r["variant"])]["pass"])
            cells.append(f"{ok} / {len(mine)}" if mine else "—")
        out.append(f"| {case['no']} | {case['id']} | " + " | ".join(cells) + " |")
    out += ["", "每一遍做了什么：", ""]
    for case in want:
        out.append(f"- **{case['id']}**：")
        for label, runs in sources:
            for r in sorted((x for x in runs if x["id"] == case["id"]), key=lambda x: x.get("repeat", 0)):
                f = facts[(label, r["id"], r["variant"])]
                verdict = "过" if f["pass"] else "不过：" + "；".join(f["reasons"])
                if f.get("flags"):
                    verdict += "（注：" + "；".join(f["flags"]) + "）"
                out.append(f"  - {label}第 {r.get('repeat', 1)} 遍：{moved_gist(f, r)}；{verdict}".replace("|", "/"))
    out.append("")
    return out


def render_todo_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_case: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by_case.setdefault(r["id"], []).append(r)
    facts = {(r["id"], r["variant"]): todo_facts(r, next(c for c in cases if c["id"] == r["id"]))
             for r in data["results"] if any(c["id"] == r["id"] for c in cases)}
    out = [
        "# 待办评测结果（票 41，票 44、票 59、票 60、票 63 重跑）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}，即 JC 主对话现在用的模型），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；首次运行于 {meta['ran_at']}。",
        "",
        "- **提示词**：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（与定时评测共用 "
        "`../schedule/galley-prompt/`）：票 41 改过的入口层；用例里分段开始前就有的待办与定时任务照 `in_hand_section` 的格式"
        "（票 39 的三组）写进「In Hand」一节，时间写成消息前一小时（`run.py` 的 `in_hand_block`，干跑测试逐字对过 Rust 的输出）。"
        "手册是仓库里的 `docs/managed-ga-runtime/galley-assistant-manual/`（票 59 起按部分拆成八个文件，入口层列出每个文件什么时候读；"
        "之前是单个文件，票 44 改过的「To-dos and reminders」），整套放在这次运行状态根下 Core 写它的位置"
        "（`assistant/reference/manual/`）。票 44 加了「明天早上 8 点提醒我给房东回电话」：待办，提醒就在说的 8 点。",
        "- **票 60 的用例**（主对话 PRD 裁决 112、113）：用户提到将来某天会发生、到时有用的事，它自己判断要不要跟进"
        "（该跟进、不该跟进、两可、到点与取消）。两可的只记录、不判（通过率不算它们），回复原文给 JC 读。"
        "「最近不要的跟进」用例的假 CLI 里起始就有一件取消过的待办，照 `in_hand_section` 写成「In Hand」的第四组；"
        "判定只认这次运行里发生的取消。",
        "- **票 63 的用例**（主对话 PRD 裁决 115）：两可的三条改成判定（复查、开学该跟进，今晚的火锅不跟），"
        "另加「今晚吃火锅，记一下」「下午 3 点开会，记一下」（钟点按运行时间取还在前面的那个，见 `cases.json` 的 `_note`）、"
        "用户点了提醒时间的、它自己的两个提醒到点（offer、妈妈手术）；叫醒消息是改过的 Core 措辞。"
        "每条都判：回复说「记下了」一类的话，这一轮就得有写（改动清单或提醒，或写了 GA 记忆，按运行前后记忆目录的差别认）。",
        "- **票 64**（主对话 PRD 裁决 116）：入口层的待办那一段改成先读 `todos.md` 再说要记、没写下就不提记。"
        "什么都不该设的 7 条（`expect.no_retract`）判最终回复不提改口，另记第一轮的正文与 `<summary>` 有没有表态"
        "（见「票 64：改口与第一轮表态」）；同一时段先用票 63 的提示词跑这 7 条做基线（`meta.ticket64_control`）。",
        "- **新消息**：用户这句（「说说这件」是引用块加一句话，照 `composer-quote.ts` 的写法）；叫醒用例是照 Core 措辞"
        "（`subtask_report::report_text` 的待办一段，同样逐字对过）拼出的叫醒消息。",
        "- **工具**：`code_run` 与文件工具在每次运行自己的 macOS 沙盒里真的执行（同票 36 的沙盒）；Galley CLI 是假的："
        "`todo` 命令族按 Agent API §5.28–§5.34 的形状回答、照真实 CLI 与 Core 校验参数（`--due=` 空值、`update` 什么都没给、"
        "`--due` 与 `--no-due` 同给是参数错误，`--remind-at` 过去报 `time_in_past:`，未知或已取消的 id 退出码 3，"
        "勾掉与取消会取消没提醒到的提醒），`schedule` 命令族照票 36；`--help` 是真实 CLI 的原文。每次调用都记下，写命令只改假 CLI 自己的状态。"
        f"每次运行最多 {SCHED_TOOL_CAP} 次工具调用。",
        "- **判定**：按 `cases.json` 每条的 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复。"
        "每条都查：`todo` 与 `schedule` 写命令带没带 `--supervisor=galley-assistant`，`schedule create` 带没带 `--target=assistant`，"
        "有没有多余的写命令、会卡住主对话的命令或 `<subtask>`。",
        "",
    ]
    if meta.get("history_note"):
        out += [meta["history_note"], ""]
    sup = meta.get("superseded_runs") or []
    for n, group in enumerate([sup] if isinstance(sup, dict) else sup, 1):
        out += [f"注 {n}：{group['reason']}被替换的 {len(group['runs'])} 次运行原样留在 results.json 的 "
                f"`meta.superseded_runs[{n - 1}]` 里。", ""]
    out += (moved_section(data, cases) + rerun_section(data, cases, todo_facts, "110")
            + progress_section(data, cases) + rerun_section(data, cases, todo_facts, "108")
            + rerun_section(data, cases, todo_facts, "73")
            + rerun_section(data, cases, todo_facts, "64") + retract_section(data, cases, todo_facts)
            + rerun_section(data, cases, todo_facts, "63") + rerun_section(data, cases, todo_facts, "60")
            + rerun_section(data, cases, todo_facts, "59"))
    total = passed = 0
    out += ["## 通过率", "", "| # | 用例 | 分组 | 期望 | 遍数 | 过 | 通过率 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for case in cases:
        runs = by_case.get(case["id"], [])
        if not runs:
            continue
        if case["expect"].get("record_only"):
            out.append(f"| {case['no']} | {case['id']} | {case['group']} | {case['expect_text'].replace('|', '/')} | "
                       f"{len(runs)} | 只记录 | — |")
            continue
        ok = sum(1 for r in runs if facts[(r["id"], r["variant"])]["pass"])
        total, passed = total + len(runs), passed + ok
        out.append(f"| {case['no']} | {case['id']} | {case['group']} | {case['expect_text'].replace('|', '/')} | "
                   f"{len(runs)} | {ok} | {round(100 * ok / len(runs))}% |")
    if total:
        out.append(f"| | 合计 | | | {total} | {passed} | {round(100 * passed / total)}% |")
    out += ["", "## 一览", "",
            "| # | 用例 | 遍 | 调了什么命令 | 回复原文 | 字数 | 读手册 | 写前读过清单 | 判定 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for case in cases:
        for r in sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0)):
            f = facts[(r["id"], r["variant"])]
            cmds = "；".join(short_cmd(c, 220) for c in f["commands"] if cli_name(c.split()) != "help") or "—"
            if f["asked_via_tool"]:
                reply = one_line(f["body"] + "（ask_user：" + str(f["asked_via_tool"].get("question", "")) + "）")
            else:
                reply = one_line(f["body"]) or "（空）"
            verdict = verdict_words(f)
            out.append(f"| {case['no']} | {case['id']} | {r['repeat']} | {cmds.replace('|', '/')} | "
                       f"{reply.replace('|', '/')} | {f['chars']} | {f['manual']} | {f['listed']} | "
                       f"{verdict.replace('|', '/')} |")
    out.append("")
    for case in cases:
        runs = sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0))
        if not runs:
            continue
        out += [f"## {case['no']}. {case['id']}（{case['group']}）", "", f"**期望**：{case['expect_text']}", ""]
        if case["history"]:
            out += ["上下文：", ""]
            for m in case["history"]:
                who = "用户" if m["role"] == "user" else "助手"
                out += [f"> {who}：" + m["content"].replace("\n", "\n> "), ">"]
            out.pop()
            out.append("")
        first = runs[0]
        if first.get("fixture_todos"):
            specs = {t["id"]: t for t in case.get("todos") or []}
            out += ["已有的待办（运行那一刻）：", ""]
            for t in first["fixture_todos"]:
                spec = specs.get(t["id"], {})
                where = ("，在「In Hand」的「最近不要的跟进」里" if spec.get("cancelled")
                         else "，在「In Hand」里" if spec.get("in_hand", True) else "，这一段里刚记下（不在「In Hand」里）")
                since = "，分段开始后用户在面板上勾掉了" if spec.get("done_since") else ""
                rem = next((x for x in first.get("fixture_tasks") or [] if x.get("todoId") == t["id"]), None)
                rem_s = (f"，提醒 {rem['fireAt']}" + ("（已到点）" if rem.get("lastFiredAt") else "")
                         + ("（随待办取消）" if rem.get("cancelledAt") else "") if rem else "")
                out.append(f"- {todo_gist(dict(t, doneAt=None) if spec.get('done_since') else t)}{rem_s}{where}{since}")
            out.append("")
        own = [t for t in first.get("fixture_tasks") or [] if not t.get("todoId")]
        if own:
            out += ["已有的定时任务（运行那一刻）：", ""]
            out += [f"- `{t['id']}` {t.get('fireAt', '')}：{t['prompt']}" for t in own]
            out.append("")
        out += [("叫醒消息：" if case.get("wake") else "用户：")] + [""] + fenced(first.get("message") or "")
        for r in runs:
            f = facts[(r["id"], r["variant"])]
            head = "只记录" if f["pass"] is None else "过" if f["pass"] else "不过"
            out += [f"### 第 {r['repeat']} 遍：{head}", ""]
            if f["pass"] is False:
                out += ["不过的原因：" + "；".join(f["reasons"]), ""]
            if f["flags"]:
                out += ["注：" + "；".join(f["flags"]), ""]
            calls = r.get("calls") or []
            if calls:
                out += ["工具调用：", ""]
                for c in calls:
                    line = f"{c['n']}. {call_gist(c)}"
                    for argv in c.get("galley_calls") or []:
                        line += "；galley " + " ".join(argv).replace("`", "'")
                    out.append(line.replace("\n", " "))
                out.append("")
            made = "；".join(todo_gist(t) for t in f["made_todos"]) or "无"
            tasks = "；".join(f"`{t['id']}` {t.get('fireAt', '')}" + (f" 挂在 `{t['todoId']}` 上" if t.get("todoId")
                                                                     else f" target={t.get('target')}")
                             + ("（已取消）" if t.get("cancelledAt") else "") + f"：{t['prompt']}"
                             for t in f["made_tasks"]) or "无"
            after = "；".join(todo_gist(t) for t in f["todos_after"]) or "无"
            out += [f"结束：{STOP_LABELS.get(f['stop'], f['stop'])}；读手册：{f['manual']}；写前读过清单：{f['listed']}；"
                    f"手册版本：`{r.get('manual_sha', '?')}`。", "",
                    f"新记的待办：{made}；新建的提醒：{tasks}；改过的已有待办：{after}；"
                    f"取消的已有提醒：{'、'.join(f['cancelled_tasks']) or '无'}。", ""]
            if f["memory_writes"] or f["memory_changed"]:
                out += ["写进记忆：" + "、".join(dict.fromkeys(f"`{os.path.basename(x)}`" for x in
                                                          f["memory_writes"] + f["memory_changed"])), ""]
            if f["asked_via_tool"]:
                out += ["ask_user 的问题：", ""] + fenced(json.dumps(f["asked_via_tool"], ensure_ascii=False, indent=1), "json")
            out += ["回复（去掉 summary 与建议标签）：", ""] + fenced(f["body"] or "（空）")
            if f["suggestion"]:
                out += [f"建议标签：{f['suggestion']}", ""]
    return "\n".join(line.rstrip() for line in "\n".join(out).split("\n")).rstrip() + "\n"


def chat_cases() -> list[dict[str, Any]]:
    """Ticket 60: the entry layer's cases (cases.json, the one place the
    messages are written) with chat/cases.json's group and expectation for
    each, numbered as there."""
    entry = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    spec = json.loads(CHAT_CASES.read_text(encoding="utf-8"))["cases"]
    if set(spec) != {c["id"] for c in entry}:
        fail("chat/cases.json must cover exactly the cases of cases.json")
    return [dict(c, no=n, group=spec[c["id"]]["group"], expect_text=spec[c["id"]]["expect_text"],
                 expect=spec[c["id"]]["expect"], history=c.get("history") or [])
            for n, c in enumerate(entry, 1)]


# What a chat case is not judged on: how it answered (a web lookup that
# stops the run, a subtask, the length), only what it set.
CHAT_ASIDE = ("运行失败", "没走到最终回复", "用了会卡住主对话的命令", "开了子任务或新会话", "不该写 <no-reply/>",
              "回复正文是空的", "回复没说出", "没点到", "漏了", "不该说", "太长", "该先问一句", "只复述了提醒")


def chat_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """Ticket 60: todo_facts, judged only on the to-dos and reminders it
    set (or failed to set where the user asked); the rest is noted."""
    f = todo_facts(r, case)
    # Ticket 63: where a follow-up is expected (personal-surgery), saying
    # it in the reply is part of it (ruling 115 3).
    aside = [x for x in f["reasons"] if x.startswith(CHAT_ASIDE)
             and not (case["expect"].get("follow_up") and x.startswith("回复没说出"))]
    kept = [x for x in f["reasons"] if x not in aside]
    out = dict(f, reasons=kept, aside=aside)
    out["pass"] = None if f["pass"] is None else not kept
    return out


# Ticket 96 (main chat PRD ruling 140 point 6): a memo is written for the
# user, not as a record about them (「用户说……」「他提到……」); an interest
# it noticed says where it comes from (「看你这周常问 76 人」), and does not
# put it in the user's mouth (「你说你关注 NBA」).
MEMO_RECORD_RE = re.compile(r"用户|^(他|她)|(他|她)(说|提到|表示|告知|称)|告知")
MEMO_SOURCE_RE = re.compile(r"看你|常问|经常问|老问|总问|总在问|多次问|几次问|反复问|一直问|问了好几|问过好几|你最近常|最近常")
MEMO_SAID_RE = re.compile(r"你说你|你说过你|你提到你")


def digits_of(text: Any) -> str:
    return re.sub(r"\D", "", str(text or ""))


def memo_gist(m: dict[str, Any]) -> str:
    """A memo in one line, as `memo list` prints it."""
    return f"`{m['id']}` {m['text']}" + (f"（到 {m['until']}）" if m.get("until") else "")


def memo_judgement(r: dict[str, Any], want: Any, now: datetime) -> dict[str, Any]:
    """Ticket 96 (shared since ticket 98): what a run did to the memos, from
    the fake galley's final memos against its fixture and its record of memo
    writes, judged against `want` (an `expect.memo`, memo/cases.json
    `_note`; "optional" as "any"): the memos noted, changed and deleted, the
    record of writes, and the reasons it fails. Every memo written is
    checked for a record about the user and every memo write for
    --supervisor=galley-assistant."""
    st = r.get("fake_state") or {}
    fx_memos = {m["id"]: m for m in r.get("fixture_memos") or []}
    after = st["memos"] if st.get("memos") is not None else list(fx_memos.values())
    after_by_id = {m["id"]: m for m in after}
    events = st.get("memo_events") or []
    new = [m for m in after if m["id"] not in fx_memos]
    changed = [m for m in after if m["id"] in fx_memos and m != fx_memos[m["id"]]]
    deleted = [m for mid, m in fx_memos.items() if mid not in after_by_id]
    log = [c.get("argv") or [] for c in r.get("galley_log") or []]
    names = [cli_name(a) for a in log]
    reasons: list[str] = []
    for a in log:
        if cli_name(a) in MEMO_WRITES and parse_cli(a)[1].get("supervisor") != "galley-assistant":
            reasons.append(f"{cli_name(a)} 没带 --supervisor=galley-assistant")
            break
    targets: list[dict[str, Any]] = []
    if want == "none":
        if new or changed or deleted:
            reasons.append("不该记备忘却" + "、".join(
                [f"记了「{m['text']}」" for m in new] + [f"改了「{m['text']}」" for m in changed]
                + [f"删了「{m['text']}」" for m in deleted]))
    elif want in ("any", "optional"):
        pass
    elif "add" in want:
        if len(new) != want["add"]:
            reasons.append(f"该记 {want['add']} 条备忘，记了 {len(new)} 条"
                           + ("（" + "；".join(m["text"] for m in new) + "）" if new else ""))
        if changed or deleted:
            reasons.append("动了已有的备忘：" + "、".join(m["text"] for m in changed + deleted))
        targets = new
    elif "update" in want:
        mid = want["update"]
        if mid not in after_by_id:
            reasons.append("该 memo update 那条，却把它删了" + ("、另记了一条（删了重加）" if new else ""))
        elif mid not in [m["id"] for m in changed]:
            reasons.append("该改的那条没改：" + fx_memos.get(mid, {}).get("text", mid))
        else:
            targets = [after_by_id[mid]]
        if new and mid in after_by_id:
            reasons.append("另记了一条，没有只改那条：" + "、".join(m["text"] for m in new))
        others = [m for m in changed + deleted if m["id"] != mid]
        if others:
            reasons.append("动了别的备忘：" + "、".join(m["text"] for m in others))
    spec = want if isinstance(want, dict) else {}
    for m in targets:
        text = m["text"]
        if spec.get("text_any") and not any(w in text for w in spec["text_any"]):
            reasons.append("备忘里没有：" + " / ".join(spec["text_any"]) + f"（「{text}」）")
        if spec.get("text_re") and not re.search(spec["text_re"], text):
            reasons.append(f"备忘不对：「{text}」")
        if spec.get("digits") and spec["digits"] not in digits_of(text):
            reasons.append(f"备忘里没有那个号码：「{text}」")
        if spec.get("forbid_any") and any(w in text for w in spec["forbid_any"]):
            reasons.append("备忘里不该有：" + " / ".join(w for w in spec["forbid_any"] if w in text) + f"（「{text}」）")
        if spec.get("source"):
            if MEMO_SAID_RE.search(text):
                reasons.append(f"看出来的兴趣写成了用户说的：「{text}」")
            elif not MEMO_SOURCE_RE.search(text):
                reasons.append(f"看出来的兴趣没写明来源（「看你……常问」）：「{text}」")
        if "until" in spec:
            if spec["until"] is None:
                if m.get("until"):
                    reasons.append(f"不该带期限：到 {m['until']}")
            elif not m.get("until"):
                reasons.append(f"会过期的没带期限（--until）：「{text}」")
            else:
                lo = sched_time(dict(spec["until"]["from"], time="00:00"), now).date()
                hi = sched_time(dict(spec["until"]["to"], time="00:00"), now).date()
                if not lo <= date.fromisoformat(m["until"]) <= hi:
                    reasons.append(f"期限不对：到 {m['until']}")
    for m in new + changed:
        if MEMO_RECORD_RE.search(m["text"]):
            reasons.append(f"写成了关于用户的记录：「{m['text']}」")
    return {"reasons": reasons, "new": new, "changed": changed, "deleted": deleted, "events": events,
            "names": names}


def memo_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """Ticket 96: what a memo run did and whether it met the case's
    expectations (memo/cases.json `expect`). The to-dos and reminders are
    judged by todo_facts on the to-do suite's keys; the memos from the fake
    galley's final memos against its fixture, and its record of memo writes:
    `memo` is "none" (no memo noted, changed or deleted), "any" (only
    recorded), {"add": 1, …} (exactly one memo noted, no other memo
    changed or deleted) or {"update": <id>, …} (that memo changed, none
    added or deleted); with `text_any` (its text has one of these words),
    `text_re`, `digits` (its digits hold these), `forbid_any`, `source`
    (an interest says where it comes from), `until` (its last day in this
    window, or null for none). Every memo written is checked for a record
    about the user (MEMO_RECORD_RE) and for --supervisor=galley-assistant.
    `todo_forbid_digits`: the to-do noted does not copy this number;
    `todo_flag_any`: words in the to-do only noted; `reminder_weekday`: the
    to-do's reminder falls on that ISO weekday; `review_memo`: the morning
    review woken for a memo, quiet (nothing, or at most `subtasks_max`
    subtasks) or with something done it names, never an offer;
    `no_memory`: GA's memory not written."""
    f = todo_facts(r, case, judge_memos=False)
    now = datetime.fromisoformat(r["now"])
    case = clock_case(case, now)
    exp = case["expect"]
    tz = now.tzinfo
    j = memo_judgement(r, exp.get("memo", "none"), now)
    new, changed, deleted, events, names = j["new"], j["changed"], j["deleted"], j["events"], j["names"]
    reasons = list(f["reasons"]) + j["reasons"]
    flags = list(f["flags"])
    made = f["made_todos"]
    for t in made:
        blob = (t.get("title") or "") + " " + (t.get("notes") or "")
        if exp.get("todo_forbid_digits") and exp["todo_forbid_digits"] in digits_of(blob):
            reasons.append("待办里抄了备忘里已有的号码：" + blob.strip())
        hits = [w for w in exp.get("todo_flag_any") or [] if w in blob]
        if hits:
            flags.append("待办里复述了：" + "、".join(hits) + f"（{blob.strip()}）")
    timed = f.get("timed") or {}
    if exp.get("reminder_weekday") and timed.get("fireAt"):
        at = datetime.fromisoformat(timed["fireAt"]).astimezone(tz)
        if at.isoweekday() != exp["reminder_weekday"]:
            reasons.append("提醒不在说的那天：" + local_words(at))
    rm = exp.get("review_memo")
    if rm is not None and f["stop"] == "final_reply":
        body = f["body"]
        if f["quiet"]:
            if f["subtasks"] and not NO_REPLY_RE.search(r.get("final_reply") or ""):
                flags.append("只派了子任务、没写 <no-reply/>（Core 照样不显示）")
        else:
            calls = r.get("calls") or []
            worked = any(c.get("name") in ("file_write", "file_patch")
                         or (c.get("name") == "code_run" and not c.get("galley_calls")
                             and MANUAL_STATE_PATH not in json.dumps(c.get("args"), ensure_ascii=False))
                         for c in calls)
            if not worked:
                reasons.append("只派了子任务却开口了（该只有标签和 <no-reply/>）" if f["subtasks"]
                               else "没做成什么却开口了")
            topic = rm.get("names_any") or []
            if topic and not any(n in body for n in topic):
                reasons.append("开口了却没说是哪件事")
            empty = REVIEW_EMPTY_RE.search(body)
            if empty:
                reasons.append(f"开口说的是空话（「{empty.group(0)}」）")
    if exp.get("no_memory") and (f["memory_changed"] or f["memory_writes"]):
        reasons.append("写进了 GA 的记忆：" + "、".join(dict.fromkeys(os.path.basename(x) for x in
                                                             f["memory_writes"] + f["memory_changed"])))
    calls = r.get("calls") or []
    write_at = next((c["n"] for c in calls
                     if any(cli_name(a) in ALL_WRITES + MEMO_WRITES for a in c.get("galley_calls") or [])), None)
    manual, reads = manual_column(calls, write_at)
    first_list = next((i for i, n in enumerate(names) if n == "memo list"), None)
    first_write = next((i for i, n in enumerate(names) if n in MEMO_WRITES), None)
    if first_write is None:
        memo_listed = "读了备忘" if first_list is not None else "—"
    else:
        memo_listed = "查了" if first_list is not None and first_list < first_write else "没查"
    record = f["pass"] is None
    out = dict(f, reasons=reasons, flags=flags, manual=manual, manual_reads=reads, memos_new=new,
               memos_changed=changed, memos_deleted=deleted, memo_events=events, memo_listed=memo_listed)
    out["pass"] = None if record else not reasons
    return out


def render_chat_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_id = {c["id"]: c for c in cases}
    runs = [r for r in data["results"] if r["id"] in by_id]
    facts = {(r["id"], r["variant"]): chat_facts(r, by_id[r["id"]]) for r in runs}
    judged = [f for f in facts.values() if f["pass"] is not None]
    set_any = [k for k, f in facts.items() if f["made_todos"] or any(not t.get("cancelledAt") for t in f["made_tasks"])]
    out = [
        "# 闲聊用例重跑（票 60、票 63）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；运行于 {meta['ran_at']}。",
        "",
        "- **为什么**：票 60 让主对话自己判断一件事到时要不要跟进，入口层的待办那一段也放宽了；这里看闲聊里会不会乱设待办或提醒。",
        "- **用例**：入口层评测的 15 条（`../cases.json`，票 03d），消息与上下文照旧；每条的期望在 `cases.json`（本目录）。"
        "带过来的两条（carry-quote、carry-laptop）用 Rust 生成的 `main_chat.carried-1.txt`，写明 1 轮、最后一条在几小时前。",
        "- **提示词与工具**：同待办评测：真实 Rust 生成的主对话提示词（`../schedule/galley-prompt/`，票 60 的入口层），"
        "手册放在状态根里，沙盒与假 CLI 照旧（没有待办与定时任务，所以没有「In Hand」）。票 03d 那套只停在第一次工具调用，"
        "看不到它会不会真的写，所以不用它。",
        "- **判定**：只看它设了什么：闲聊、问答、干活的不该记待办、不该建提醒；「提醒我一下，周五之前要给房东转房租」该记待办挂提醒；"
        "两条两可的（妈妈明天做手术、成都机票订好了）只记录。回答本身（查网页停下、派子任务、长短）不判，写在「另记」里。",
        "- **票 63**：入口层多了「没写下就不说记下了」，提示词重新生成；妈妈手术那条照票 60 的做法改成判定"
        "（设次日的问候，并在回复里说出来，裁决 115 第 3 条），成都机票仍只记录；每条另判「说了记下了，这一轮就得有写」。",
        "- **票 64**：入口层的待办那一段改成先读 `todos.md` 再说要记、没写下就不提记，提示词重新生成；"
        "不该设的 12 条另判最终回复不提改口（`expect.no_retract`），并记第一轮有没有表态。",
        "",
    ]
    out += rerun_section(data, cases, chat_facts, "73")
    out += rerun_section(data, cases, chat_facts, "64") + retract_section(data, cases, chat_facts)
    out += rerun_section(data, cases, chat_facts, "63")
    out += [
        f"判了 {len(judged)} 次，过 {sum(1 for f in judged if f['pass'])} 次；设了待办或提醒的：{len(set_any)} 次"
        + (f"（{'、'.join(sorted(i for i, _ in set_any))}）" if set_any else "") + "。",
        "",
        "| # | 用例 | 分组 | 消息 | 期望 | 调了什么命令 | 回复原文 | 读手册 | 判定 | 另记 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for case in cases:
        for r in sorted((x for x in runs if x["id"] == case["id"]), key=lambda x: x.get("repeat", 0)):
            f = facts[(r["id"], r["variant"])]
            cmds = "；".join(short_cmd(c, 160) for c in f["commands"] if cli_name(c.split()) != "help") or "—"
            reply = one_line(f["body"]) or "（空）"
            aside = "；".join(f["aside"])
            out.append(f"| {case['no']} | {case['id']} | {case['group']} | {one_line(case['message'])} | "
                       f"{case['expect_text'].replace('|', '/')} | {cmds.replace('|', '/')} | {reply.replace('|', '/')} | "
                       f"{f['manual']} | {verdict_words(f).replace('|', '/')} | {aside.replace('|', '/') or '—'} |")
    return "\n".join(line.rstrip() for line in "\n".join(out).split("\n")).rstrip() + "\n"


def memo_writes_words(f: dict[str, Any]) -> str:
    """What a run did to the memos, in one line (the final text of each)."""
    bits = ([f"记「{m['text']}」" + (f"（到 {m['until']}）" if m.get("until") else "") for m in f["memos_new"]]
            + [f"改为「{m['text']}」" + (f"（到 {m['until']}）" if m.get("until") else "") for m in f["memos_changed"]]
            + [f"删「{m['text']}」" for m in f["memos_deleted"]])
    return "；".join(bits) or "没动备忘"


def render_memo_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    """Ticket 96: the memo suite's results, in the to-do suite's layout."""
    meta = data["meta"]
    by_case: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by_case.setdefault(r["id"], []).append(r)
    by_id = {c["id"]: c for c in cases}
    facts = {(r["id"], r["variant"]): memo_facts(r, by_id[r["id"]]) for r in data["results"] if r["id"] in by_id}
    out = [
        "# 备忘评测结果（票 96）",
        "",
        f"模型：{meta['model']['name']}（{meta['model_source']}，与主对话同一个模型），推理强度 "
        f"{meta['model']['options'].get('reasoning_effort', '默认')}；首次运行于 {meta['ran_at']}。",
        "",
        "- **提示词**：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（`../schedule/galley-prompt/`，"
        "票 96 重新生成：入口层多了记备忘那一句、「记下了」那句的「a memo」、写命令与手册列表里的 `memo`）。用例里分段开始前就有的"
        "备忘照 `memo_section` 的格式写进「Memo」一节，接在「In Hand」后面（没有「In Hand」时接在 Main Chat 那段后面），时间写成"
        "消息前一小时（`run.py` 的 `memo_block`，干跑测试逐字对过 Rust 的输出）。手册是仓库里的 "
        "`docs/managed-ga-runtime/galley-assistant-manual/`（票 96 起十个部分，新的一部分是 `memo.md`），整套放在这次运行状态根下"
        "（`assistant/reference/manual/`）。",
        "- **新消息**：用户这句；巡看用例是照 Core 措辞拼的叫醒消息（`subtask_report::review_paragraph` 加票 95 的 "
        "`review_memos_paragraph`，点名前一天的新备忘，同样逐字对过）。",
        "- **工具**：同待办评测的沙盒与假 CLI，另外回答 `memo list / add / update / delete`（形状照 Agent API §5.35–§5.39，"
        "校验照真实 CLI 与 Core：单条 1 到 100 字、`--until` 不早于今天（`time_in_past:`）、`update` 什么都没给与 `--until` "
        "`--no-until` 同给是参数错误、未知的 id 退出码 3、总量过 2,000 字照记并回 `overLimit`），每次写都记一行（同 Core 的 "
        "`memo_events`）。带 `web: unavailable` 的用例，浏览器工具回 GA 没连浏览器时的报错（`ga.py` 的原话），不让运行停在那里。"
        f"每次运行最多 {SCHED_TOOL_CAP} 次工具调用。",
        "- **判定**：按 `cases.json` 每条的 `expect` 自动判（写法见 `_note`）：记了几条、记在哪（备忘、待办、提醒）、备忘的正文"
        "（该有的词与号码、期限、看出来的兴趣写明来源），每条新记或改过的备忘都查是不是写成了关于用户的记录"
        "（「用户……」「他提到……」），`memo` 写命令带没带 `--supervisor=galley-assistant`；待办与提醒用待办评测的判法。"
        "每条都判：回复说「记下了」一类的话，这一轮就得有写（备忘也算）。",
        "",
    ]
    if meta.get("history_note"):
        out += [meta["history_note"], ""]
    sup = meta.get("superseded_runs") or []
    for n, group in enumerate([sup] if isinstance(sup, dict) else sup, 1):
        out += [f"注 {n}：{group['reason']}被替换的 {len(group['runs'])} 次运行原样留在 results.json 的 "
                f"`meta.superseded_runs[{n - 1}]` 里。", ""]
    # Each repeat in its own column: they may have run on different
    # wordings (meta.history_note).
    repeats = sorted({r.get("repeat", 0) for r in data["results"] if r["id"] in by_id})
    tally = {n: [0, 0] for n in repeats}
    out += ["## 通过率", "", "| # | 用例 | 分组 | 期望 | " + " | ".join(f"第 {n} 遍" for n in repeats) + " |",
            "| --- | --- | --- | --- | " + " | ".join("---" for _ in repeats) + " |"]
    for case in cases:
        runs = {r.get("repeat", 0): r for r in by_case.get(case["id"], [])}
        if not runs:
            continue
        cells = []
        for n in repeats:
            if n not in runs:
                cells.append("—")
                continue
            ok = bool(facts[(runs[n]["id"], runs[n]["variant"])]["pass"])
            tally[n][0] += 1
            tally[n][1] += ok
            cells.append("过" if ok else "不过")
        out.append(f"| {case['no']} | {case['id']} | {case['group']} | {case['expect_text'].replace('|', '/')} | "
                   + " | ".join(cells) + " |")
    if repeats:
        out.append("| | 合计 | | | " + " | ".join(f"{p}/{t}" for t, p in (tally[n] for n in repeats)) + " |")
    out += ["", "## 一览", "",
            "| # | 用例 | 遍 | 备忘（记了什么） | 待办与提醒 | 回复原文 | 读手册 | 判定 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for case in cases:
        for r in sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0)):
            f = facts[(r["id"], r["variant"])]
            todos = "；".join(todo_gist(t) for t in f["made_todos"])
            tasks = "；".join(f"`{t['id']}` {t.get('fireAt', '')}" + (f" 挂在 `{t['todoId']}` 上" if t.get("todoId") else "")
                             for t in f["made_tasks"] if not t.get("cancelledAt"))
            reply = one_line(f["body"]) or "（空）"
            out.append(f"| {case['no']} | {case['id']} | {r['repeat']} | {memo_writes_words(f).replace('|', '/')} | "
                       f"{('；'.join(x for x in (todos, tasks) if x) or '—').replace('|', '/')} | "
                       f"{reply.replace('|', '/')} | {f['manual']} | {verdict_words(f).replace('|', '/')} |")
    out.append("")
    for case in cases:
        runs = sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0))
        if not runs:
            continue
        out += [f"## {case['no']}. {case['id']}（{case['group']}）", "", f"**期望**：{case['expect_text']}", ""]
        if case["history"]:
            out += ["上下文" + ("（分段前带过来的）" if case.get("carried") else "") + "：", ""]
            for m in case["history"]:
                who = "用户" if m["role"] == "user" else "助手"
                out += [f"> {who}：" + m["content"].replace("\n", "\n> "), ">"]
            out.pop()
            out.append("")
        first = runs[0]
        if first.get("fixture_memos"):
            out += ["已有的备忘（运行那一刻，都在「Memo」一节里）：", ""]
            out += [f"- {memo_gist(m)}，{m['updatedAt']}" for m in first["fixture_memos"]]
            out.append("")
        if first.get("fixture_todos"):
            out += ["已有的待办：", ""] + [f"- {todo_gist(t)}" for t in first["fixture_todos"]] + [""]
        out += [("叫醒消息：" if case.get("wake") else "用户：")] + [""] + fenced(first.get("message") or "")
        for r in runs:
            f = facts[(r["id"], r["variant"])]
            head = "只记录" if f["pass"] is None else "过" if f["pass"] else "不过"
            out += [f"### 第 {r['repeat']} 遍：{head}", ""]
            if f["pass"] is False:
                out += ["不过的原因：" + "；".join(f["reasons"]), ""]
            if f["flags"]:
                out += ["注：" + "；".join(f["flags"]), ""]
            calls = r.get("calls") or []
            if calls:
                out += ["工具调用：", ""]
                for c in calls:
                    line = f"{c['n']}. {call_gist(c)}"
                    for argv in c.get("galley_calls") or []:
                        line += "；galley " + " ".join(argv).replace("`", "'")
                    out.append(line.replace("\n", " "))
                out.append("")
            made = "；".join(todo_gist(t) for t in f["made_todos"]) or "无"
            tasks = "；".join(f"`{t['id']}` {t.get('fireAt', '')}" + (f" 挂在 `{t['todoId']}` 上" if t.get("todoId")
                                                                     else f" target={t.get('target')}")
                             + ("（已取消）" if t.get("cancelledAt") else "") + f"：{t['prompt']}"
                             for t in f["made_tasks"]) or "无"
            out += [f"结束：{STOP_LABELS.get(f['stop'], f['stop'])}；读手册：{f['manual']}；写备忘前查过：{f['memo_listed']}；"
                    f"手册版本：`{r.get('manual_sha', '?')}`。", "",
                    f"备忘：{memo_writes_words(f)}；新记的待办：{made}；新建的提醒：{tasks}。", ""]
            if f["memory_writes"] or f["memory_changed"]:
                out += ["写进 GA 记忆：" + "、".join(dict.fromkeys(f"`{os.path.basename(x)}`" for x in
                                                             f["memory_writes"] + f["memory_changed"])), ""]
            if f["asked_via_tool"]:
                out += ["ask_user 的问题：", ""] + fenced(json.dumps(f["asked_via_tool"], ensure_ascii=False, indent=1), "json")
            out += ["回复（去掉 summary 与建议标签）：", ""] + fenced(f["body"] or "（空）")
            if f["suggestion"]:
                out += [f"建议标签：{f['suggestion']}", ""]
    return "\n".join(line.rstrip() for line in "\n".join(out).split("\n")).rstrip() + "\n"


def summarize_usage(results: list[dict[str, Any]]) -> dict[str, int]:
    total = {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "reasoning_tokens": 0}
    for r in results:
        for u in r.get("usage") or []:
            total["prompt_tokens"] += int(u.get("prompt_tokens") or 0)
            total["completion_tokens"] += int(u.get("completion_tokens") or 0)
            total["cached_tokens"] += int((u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
            total["reasoning_tokens"] += int(
                (u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0)
    return total


# ======================================================================
# Dry test
# ======================================================================


def dry_test(python: str, ga_lang: str, keep_temp: bool) -> int:
    """No model. Fakes the HTTP stream with a reply that calls code_run and
    file_write (touching canary files), and one with a plain answer; checks
    the composed request and that nothing ran."""
    cases = {c["id"]: c for c in json.loads(CASES.read_text(encoding="utf-8"))["cases"]}
    draft = DRAFT.read_text(encoding="utf-8")
    mykeys = {"native_oai_config_0": {
        "name": "gpt-6.1-sol", "apikey": "dry-test-no-key", "apibase": "https://dry.invalid/v1",
        "model": "gpt-6.1-sol", "api_mode": "chat_completions", "stream": True, "temperature": 1,
        "reasoning_effort": "high", "context_win": 90000, "max_retries": 0, "read_timeout": 30,
        "connect_timeout": 10, "timeout": 10}}
    now = datetime.now()
    dcases = {c["id"]: c for c in json.loads(DISPATCH_CASES.read_text(encoding="utf-8"))["cases"]}
    dispatch_scripts = [("big-pdfs", "T", "tag"), ("big-pdfs", "C", "cli-final"),
                        ("big-quotes", "P", "tool-wait"), ("quick-downloads", "C", "other-first"),
                        ("quick-usd", "T", "tool")]
    jobs = (make_jobs([cases["work-downloads"]], ["with"], now, draft, mykeys, ga_lang, set(), "tool")
            + make_jobs([cases["carry-quote"]], ["with", "without"], now, draft, mykeys, ga_lang,
                        set(), "final"))
    for case_id, variant, script in dispatch_scripts:
        jobs += make_dispatch_jobs([dcases[case_id]], [variant], now, draft, mykeys, ga_lang,
                                   set(), script)
    # Sandbox mode. A listening Unix socket outside the sandbox stands in
    # for Galley Core's: the sandboxed code must not reach it.
    import socket as _socket
    sock_dir = tempfile.mkdtemp(prefix="eleval-sock-")
    sock_path = os.path.join(sock_dir, "core.sock")
    listener = _socket.socket(_socket.AF_UNIX)
    listener.bind(sock_path)
    listener.listen(4)
    listener.settimeout(0.2)
    accepted: list[str] = []
    stop_listening = threading.Event()

    def listen() -> None:
        while not stop_listening.is_set():
            try:
                conn, _ = listener.accept()
                accepted.append("connection")
                conn.close()
            except OSError:
                continue

    threading.Thread(target=listen, daemon=True).start()
    sandbox_scripts = [("big-pdfs", "C", "sbx-cli-wait"), ("big-quotes", "P", "sbx-tool-cap"),
                       ("quick-usd", "T", "sbx-tag-refusals"), ("big-pdfs", "T", "sbx-tag-move"),
                       ("quick-downloads", "C", "sbx-inline")]
    for case_id, variant, script in sandbox_scripts:
        for job in make_dispatch_jobs([dcases[case_id]], [variant], now, draft, mykeys, ga_lang,
                                      set(), script, sandbox=True):
            job["case_id"] = f"sbx-{case_id}"  # its own run dir
            job["dry_sock"] = sock_path
            jobs.append(job)
    wcases = {c["id"]: c for c in json.loads(WAKE_CASES.read_text(encoding="utf-8"))["cases"]}
    wake_scripts = {"wake-done-evidence": "wake-bash", "wake-ask-sms": "wake-ask"}
    for wake_id, script in wake_scripts.items():
        for job in make_wake_jobs([wcases[wake_id[len("wake-"):]]], ["draft"], now, mykeys, ga_lang,
                                  set(), 1, script):
            job["case_id"] = wake_id
            jobs.append(job)
    scases = {c["id"]: c for c in json.loads(SCHED_CASES.read_text(encoding="utf-8"))["cases"]}
    sched_scripts = {"sched-water-10min": ("water-10min", "sched-create"),
                     "sched-wake-obsolete": ("wake-obsolete", "sched-no-reply"),
                     "sched-water-todo": ("water-10min", "sched-nudge-todo"),
                     "sched-stove-30min": ("stove-30min", "sched-nudge"),
                     "sched-report-own": ("report-wed", "sched-own-for-todo"),
                     "sched-report-todo": ("report-wed", "sched-todo")}
    snow = now.astimezone()
    for run_id, (case_id, script) in sched_scripts.items():
        for job in make_sched_jobs([scases[case_id]], snow, mykeys, ga_lang, set(), 1, script):
            job["case_id"] = run_id
            jobs.append(job)
    tcases = {c["id"]: c for c in json.loads(TODO_CASES.read_text(encoding="utf-8"))["cases"]}
    todo_scripts = {"todo-tick-soil": ("tick-soil", "todo-cli"), "todo-tick-ok": ("tick-soil", "todo-tick"),
                    "todo-cancel-by": ("tick-soil", "todo-cancel-by"),
                    "todo-wake-todo": ("wake-todo", "todo-remind"),
                    "todo-landlord-8am": ("remind-landlord-8am", "todo-at-named"),
                    "todo-landlord-early": ("remind-landlord-8am", "todo-early"),
                    # Ticket 60.
                    "todo-reno-own": ("reno-mention", "todo-follow-own"),
                    "todo-reno-quiet": ("reno-mention", "todo-quiet"),
                    "todo-stop-kind": ("stop-this-kind", "todo-stop-kind"),
                    "todo-stop-vague": ("stop-this-kind", "todo-stop-vague"),
                    "todo-declined-quiet": ("declined-before", "todo-quiet"),
                    "todo-declined-set": ("declined-before", "todo-declined-set"),
                    "todo-wake-recite": ("wake-reno", "todo-recite"),
                    "todo-wake-use": ("wake-reno", "todo-put-to-use"),
                    # Ticket 63.
                    "todo-founding-claim": ("founding-date", "todo-claim"),
                    "todo-founding-memory": ("founding-date", "todo-memory"),
                    "todo-wake-offer": ("wake-offer", "todo-offer-ask"),
                    # Ticket 78.
                    "todo-mix-checked": ("review-with-subtask-done", "todo-mix-checked"),
                    "todo-mix-swallowed": ("review-with-reminder", "sched-no-reply"),
                    # Ticket 108.
                    "todo-progress-done": ("progress-review-done", "todo-progress-done"),
                    "todo-progress-quiet": ("progress-review-unchanged", "todo-progress-quiet")}
    for run_id, (case_id, script) in todo_scripts.items():
        for job in make_sched_jobs([tcases[case_id]], snow, mykeys, ga_lang, set(), 1, script, suite="todo"):
            job["case_id"] = run_id
            jobs.append(job)
    mcases = {c["id"]: c for c in json.loads(MEMO_CASES.read_text(encoding="utf-8"))["cases"]}
    memo_scripts = {"memo-cli": ("landlord-new-number", "memo-cli"), "memo-web": ("interest-team", "memo-web"),
                    "memo-review-quiet": ("review-interest", "sched-no-reply")}
    for run_id, (case_id, script) in memo_scripts.items():
        for job in make_sched_jobs([mcases[case_id]], snow, mykeys, ga_lang, set(), 1, script, suite="memo"):
            job["case_id"] = run_id
            jobs.append(job)
    ccases = {c["id"]: c for c in chat_cases()}
    chat_scripts = {"chat-carry-quote": ("carry-quote", "final"), "chat-errand-rent": ("errand-rent", "final")}
    for run_id, (case_id, script) in chat_scripts.items():
        for job in make_sched_jobs([ccases[case_id]], snow, mykeys, ga_lang, set(), 1, script, suite="chat"):
            job["case_id"] = run_id
            jobs.append(job)
    real_home = os.path.expanduser("~")
    home_canary = os.path.join(real_home, "entry-layer-eval-sbx-canary")
    results = run_jobs(jobs, python, 3, keep_temp)
    stop_listening.set()
    listener.close()
    shutil.rmtree(sock_dir, ignore_errors=True)
    ok = True

    def check(cond: bool, what: str) -> None:
        nonlocal ok
        print(("  PASS " if cond else "  FAIL ") + what)
        ok = ok and cond

    dry_test_wake([r for r in results if r["id"].startswith("wake-")], wake_scripts, wcases, now, check)
    dry_test_sched([r for r in results if r["id"].startswith("sched-")], sched_scripts, scases, snow, check)
    dry_test_todo([r for r in results if r["id"].startswith("todo-")], todo_scripts, tcases, snow, check)
    dry_test_chat([r for r in results if r["id"].startswith("chat-")], chat_scripts, ccases, check)
    dry_test_memo([r for r in results if r["id"].startswith("memo-")], memo_scripts, mcases, snow, check)
    sbx_results = [r for r in results if r["id"].startswith("sbx-")]
    entry_results = [r for r in results if r["variant"] in VARIANTS]
    dispatch_results = [r for r in results if r["variant"] in DISPATCH_VARIANTS
                        and not r["id"].startswith("sbx-")]
    dry_test_dispatch(dispatch_results, dict(((c, v), s) for c, v, s in dispatch_scripts), check)
    dry_test_sandbox(sbx_results, {(f"sbx-{c}", v): s for c, v, s in sandbox_scripts}, check)
    print("sandbox (all runs)")
    check(not accepted, f"nothing reached the Unix socket outside the sandbox ({len(accepted)})")
    check(not os.path.exists(home_canary), "no file was written into the real HOME")
    for r in entry_results:
        print(f"{r['id']} / {r['variant']} ({'tool' if r['id'] == 'work-downloads' else 'final'})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        req = r["request"]
        system = req["messages"][0]["content"] if req["messages"][0]["role"] == "system" else ""
        check(r["llm_calls"] == 1, "exactly one model call")
        check(not r["do_calls"], f"no GA tool method was entered ({r['do_calls']})")
        check(not r["blocked"], f"nothing tried to run, connect or write ({r['blocked']})")
        check(not r["canaries"], f"no canary file exists ({r['canaries']})")
        check(all(r["guard_selftest"].values()), f"guards refuse ({r['guard_selftest']})")
        check("Today:" in system and "## Galley Runtime Layer" in system
              and "## Next-Step Suggestion" in system and "## Main Chat" in system,
              "system prompt = GA core + memory + Galley runtime prompt with Main Chat")
        has_draft = "## Galley Main Chat Entry Layer" in system
        if r["variant"] == "with":
            check(has_draft and system.index("## Main Chat\n") < system.index(
                "## Galley Main Chat Entry Layer") < system.index("[Peer]"),
                "WITH: draft right after the Main Chat section, before GA's peer hint")
        else:
            check(not has_draft, "WITHOUT: no draft")
        check(len(r["request_shape"]["tools"]) > 5, f"tools offered {r['request_shape']['tools']}")
        if r["id"] == "work-downloads":
            tool = r["tool_call"] or {}
            check(tool.get("name") == "code_run" and "touch" in tool.get("args", {}).get("script", ""),
                  f"first tool call recorded ({tool})")
            check([t["name"] for t in r["tool_calls_in_reply"]] == ["code_run", "file_write"],
                  "both calls in the reply listed, neither run")
            check(r["reply"].endswith("我来看一下。"), "text before the call kept")
            check("opens\nwith 1 exchange" not in system, "non-carried Main Chat text")
        else:
            check(r["tool_call"] is None, "no tool call")
            check(r["next_suggestion"] == "帮我写个番茄炒蛋的完整步骤", "suggestion extracted")
            roles = r["request_shape"]["message_roles"]
            hist = cases["carry-quote"]["history"]
            check(roles == ["system", "user", "assistant", "user"], f"history loaded ({roles})")
            check(req["messages"][1]["content"] == hist[0]["content"]
                  or hist[0]["content"] in json.dumps(req["messages"][1], ensure_ascii=False),
                  "carried user turn in history")
            check("with 1 exchange from before it, the last said" in system,
                  "carried Main Chat text")
    print("DRY TEST " + ("PASSED" if ok else "FAILED"))
    return 0 if ok else 1


def dry_test_sandbox(results: list[dict[str, Any]], scripts: dict[tuple[str, str], str],
                     check: Any) -> None:
    """Sandbox mode: lookups run for real but only inside the sandbox; the
    real HOME, Unix / TCP sockets, DNS, writes outside and other programs
    fail from inside a code_run; the fake galley answers; file tools are
    refused outside; browser tools, inline_eval and the 9th call stop."""
    for r in sorted(results, key=lambda r: (r["id"], r["variant"])):
        script = scripts[(r["id"], r["variant"])]
        print(f"sandbox {r['id']} / {r['variant']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        calls, d = r["calls"], r["dispatch"]
        check(not r["blocked"], f"nothing in the engine process tried to leave ({r['blocked']})")
        check(not r["do_calls"], f"no blocked GA tool method was entered ({r['do_calls']})")
        check(not r["canaries"], f"no canary file outside the sandbox ({r['canaries']})")
        check(all(r["guard_selftest"].values()), f"engine-process guards refuse ({r['guard_selftest']})")
        if script == "sbx-cli-wait":
            probe: dict[str, Any] = {}
            try:
                probe = json.loads(str(calls[0]["result"]["stdout"]).strip().splitlines()[-1])
            except (ValueError, KeyError, IndexError, TypeError):
                pass
            for key in ("list_real_home", "read_real_file", "list_app_galley", "list_generic_agent",
                        "unix_socket", "tcp", "dns", "write_outside", "write_real_home",
                        "run_other_program"):
                check(probe.get(key, ["?"])[0] == "fail", f"code_run: {key} fails ({probe.get(key)})")
            check(probe.get("fake_home", ["?", ""])[1].endswith("/sandbox/home"),
                  f"code_run: HOME is the fake one ({probe.get('fake_home')})")
            check(probe.get("list_fake_downloads") == ["ok", str(len(FIXTURE_PDFS) + len(FIXTURE_OTHER)
                                                                   + len(FIXTURE_SPARSE))],
                  f"code_run: the fixture Downloads is there ({probe.get('list_fake_downloads')})")
            check(probe.get("galley_search", ["?", ""])[0] == "ok"
                  and '"hits": []' in probe["galley_search"][1], "fake galley: search, no hits")
            check(probe.get("galley_help", ["?", ""])[1].startswith("usage: galley subtask start"),
                  f"fake galley: --help prints usage, not a start ({probe.get('galley_help')})")
            check(probe.get("galley_start", ["?", ""])[0] == "ok"
                  and "s-sub0001" in probe["galley_start"][1], "fake galley: subtask start answers")
            check(d["dispatched"] and d["via"] == "cli" and d["at_call"] == 1 and d["lookups_before"] == 0
                  and d["brief"] == DRY_CLI_BRIEF and d["parent"] == "s-mgn4k2x1-7q3z9w0e",
                  f"CLI dispatch read from the fake galley's log ({d})")
            check(len(calls) == 2 and "running" in str(calls[1].get("result"))
                  and calls[1].get("galley_calls") == [["session", "show", "s-sub0001"]],
                  "bash code_run reached the fake galley: session show")
            check(r["after_dispatch"]["calls"] == [2] and r["stop_reason"] == "final_reply"
                  and "已经开始整理了" in (r["after_dispatch"]["final_reply"] or ""),
                  "after the dispatch: the status check, then the final reply")
            check(len(r["galley_log"]) == 4 and d["count"] == 1,
                  f"fake galley logged every call, the help call is not a dispatch ({len(r['galley_log'])})")
            check(len(r["sandbox"]["launched"]) == 2, "two interpreters started, both via sandbox-exec")
        elif script == "sbx-tool-cap":
            check(r["llm_calls"] == 9 and len(calls) == 9, f"nine calls asked ({len(calls)})")
            check(d["dispatched"] and d["via"] == "tool" and d["at_call"] == 2
                  and d["lookups_before"] == 1 and d["brief"] == DRY_TOOL_BRIEF,
                  "start_subtask dispatch after one lookup")
            check(".pdf" in str(calls[0].get("result")), "the lookup listed the fixture PDFs")
            check(calls[1].get("outcome") == "fake result" and '"subtask_id": "s-sub0001"'
                  in json.dumps(r["requests"][2], ensure_ascii=False).replace('\\"', '"'),
                  "the fake result went back to the model")
            check(all(c.get("outcome") == "run in the sandbox" and "waiting" in str(c.get("result"))
                      for c in calls[2:8]), "calls 3-8 ran in the sandbox")
            check(calls[8]["outcome"].startswith("not run: cap") and r["stop_reason"] == "cap_reached",
                  "the 9th call is not run: cap reached")
        elif script == "sbx-tag-refusals":
            check([c.get("outcome", "")[:7] for c in calls] == ["refused", "refused", "refused", "run in ",
                                                               "not run"], f"outcomes {[c.get('outcome') for c in calls]}")
            check(str(calls[0].get("result", "")).startswith("Error: [Errno 1] Operation not permitted"),
                  "file_read outside: GA's error string")
            check(isinstance(calls[1].get("result"), dict) and calls[1]["result"].get("status") == "error",
                  "file_write outside: GA's error object")
            check("Global Memory" in str(calls[3].get("result")), "file_read inside the sandbox works")
            check(r["stop_reason"] == "web_tool" and not d["dispatched"], "web_execute_js ends the run")
            check(len(r["sandbox"]["refused"]) == 3, f"three refusals recorded ({r['sandbox']['refused']})")
        elif script == "sbx-tag-move":
            ch = r["downloads_changes"]
            check(len(ch["removed"]) == 2 and sorted(ch["added"]) == ["发票/Invoice_Figma_2026-09.pdf",
                                                                     "发票/发票_阿里云_2026-08.pdf"],
                  f"moves inside the fake Downloads happen and are recorded ({ch})")
            check(d["dispatched"] and d["via"] == "tag" and d["lookups_before"] == 1
                  and d["brief"] == "把 ~/Downloads 里其余 PDF 按内容分类"
                  and r["stop_reason"] == "final_reply", f"tag after one call ({d})")
        elif script == "sbx-inline":
            check(r["stop_reason"] == "inline_eval" and calls[0]["outcome"].startswith("not run"),
                  "inline_eval is not run")


def dry_test_wake(results: list[dict[str, Any]], scripts: dict[str, str],
                  cases: dict[str, dict[str, Any]], now: datetime, check: Any) -> None:
    """Wake suite: the prompt names the manual where the run's state root
    has it; the wake note is the new user message after the history; the
    model's shell reaches the fake galley (discovery line with sed, reads,
    a send, state kept, a refused flag, a holding command) and nothing
    outside the sandbox; ask_user ends the run; the judge reads it. Ticket
    63: the quote dates are the run day's, none before this week's Monday."""
    words = load_wording()["draft"]
    thu, mon = datetime(2026, 10, 15, 11, 0), datetime(2026, 10, 19, 11, 0)
    check({k: str(v) for k, v in wake_days(thu).items()} == {"W": "2026-10-12", "Q0": "2026-10-15", "Q1": "2026-10-14",
                                                             "Q2": "2026-10-13"}
          and set(str(v) for v in wake_days(mon).values()) == {"2026-10-19"},
          "wake dates: on the Thursday the case was written for, its own dates; on a Monday, all that Monday")
    old = wake_dated(cases["done-evidence"], thu)
    check("东辰_1013.png" in json.dumps(old, ensure_ascii=False) and "Rebar quotation, 13 Oct 2026" in json.dumps(
        old, ensure_ascii=False) and "本周（10 月 12 日这一周）" in old["subtasks"][0]["instructions"]
          and "{{" not in json.dumps(wake_dated(cases["two-at-once"], mon), ensure_ascii=False),
          "wake dates: filled everywhere, file names too")
    for r in sorted(results, key=lambda r: r["id"]):
        script = scripts[r["id"]]
        case = wake_dated(cases[r["id"][len("wake-"):]], now)
        print(f"wake {r['id']} / {r['variant']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        check(not r["blocked"], f"nothing in the engine process tried to leave ({r['blocked']})")
        check(not r["do_calls"], f"no blocked GA tool method was entered ({r['do_calls']})")
        check(not r["canaries"], f"no canary file outside the sandbox ({r['canaries']})")
        check(all(r["guard_selftest"].values()), f"engine-process guards refuse ({r['guard_selftest']})")
        req = r["requests"][0]
        msgs = req["messages"]
        system = msgs[0]["content"] if msgs[0]["role"] == "system" else ""
        m = re.search(r"Your manual is in `([^`]+)`", system)
        check(bool(m) and m.group(1).endswith("/managed-ga-state/assistant/reference/manual"),
              "the prompt names the manual's directory in the run's state root")
        check(r.get("manual_files") == [x.name for x in manual_parts()],
              f"the directory holds every part, nothing else ({r.get('manual_files')})")
        check(system.index("## Main Chat\n") < system.index("## Galley Main Chat Entry Layer") < system.index("[Peer]")
              and "Galley wakes you" in system and "you can look it up when they ask" not in system,
              "the ticket 30 entry layer follows the Main Chat section")
        roles = [x["role"] for x in msgs]
        check(roles == ["system"] + [h["role"] for h in case["history"]] + ["user"], f"history, then the note ({roles})")
        last = msgs[-1]["content"]
        if not isinstance(last, str):
            last = "\n".join(b.get("text", "") for b in last if isinstance(b, dict))
        note = wake_note(case, words)
        check(note in last and r["message"] == note, "the new message is the wake note, verbatim")
        f = wake_facts(r, case)
        if script == "wake-bash":
            calls = r["calls"]
            check(calls[0]["name"] == "file_read" and "# Galley Assistant Manual: When Galley wakes you"
                  in str(calls[0].get("result")) and "# Galley Assistant Manual: Subtasks" in str(calls[1].get("result")),
                  "file_read reads the parts in the directory the prompt names")
            reads = f["manual_reads"]
            check([x["parts"] for x in reads] == [["wake.md"], ["subtasks.md"]] and len({x["turn"] for x in reads}) == 1
                  and all(x["bytes"] == len(str(c.get("result")).encode("utf-8")) for x, c in zip(reads, calls)),
                  f"the reads are recorded: which parts, one turn, the bytes handed back ({reads})")
            check("wake.md、subtasks.md；2 次 1 轮，" in f["manual"], f"the 读手册 column ({f['manual']})")
            out = str((next(c for c in calls if c["name"] == "code_run").get("result") or {}).get("stdout", ""))
            for want in ("cli=galley", "查华立、东辰、明光三家本周螺纹钢报价", '"dispatch": "dispatched"',
                         '"busy": true', "invalid_args", "unexpected argument '--supervisor'", "llm_set=2",
                         '"reason": "completed"', "螺纹钢报价_本周.csv", "报价截图", "py 42"):
                check(want in out, f"shell output has {want!r}")
            for denied in ("read_real", "cat_etc", "ls_real", "usr_python", "curl", "touch", "redirect"):
                check(re.search(rf"^{denied}=[1-9]", out, re.MULTILINE) is not None,
                      f"sandbox refuses {denied} ({re.search(rf'^{denied}=.*$', out, re.MULTILINE)})")
            check(f["names"] == ["session show", "session send", "session brief", "llm set", "session wait"],
                  f"fake galley logged every call ({f['names']})")
            check(len(f["sends"]) == 1 and f["sends"][0]["supervisor"] == "galley-assistant"
                  and f["sends"][0]["content"] == "截图路径再给一下", f"the send is read back ({f['sends']})")
            check(any("--ensure-runner" in (c.get("argv") or []) for c in r.get("galley_log") or [])
                  and "unexpected argument '--ensure-runner'" not in out,
                  "a send with --ensure-runner goes through, as the real CLI's (ticket 63)")
            check(time.strftime("%m%d") in out or "报价截图" in out, "the evidence is in the fake Downloads")
            check(f["held"] == ["session wait"] and not f["pass"]
                  and any("卡住" in x for x in f["reasons"]), "the judge flags the holding command")
            check(f["no_reply"] and f["manual"].startswith("读了"), "no-reply and manual read are recognized")
            check(r["stop_reason"] == "final_reply" and r["llm_calls"] == 3, "three model calls, final reply")
        else:
            check(r["stop_reason"] == "ask_user" and r["llm_calls"] == 1 and not r.get("galley_log"),
                  "ask_user ends the run, nothing reached the CLI")
            check(f["asked_via_tool"] and "验证码" in f["asked_via_tool"]["question"] and f["pass"],
                  f"the judge reads the ask_user question ({f['reasons']})")
    # Ticket 73: a file handed over. The case's `{{HOME}}` is left for the
    # run (run_job fills it with the sandbox's HOME); the judge wants
    # `[FILE:<absolute path>]` on a line of its own.
    fh = wake_dated(cases["file-handover"], now)
    jobs = make_wake_jobs([cases["file-handover"]], ["draft"], now, {}, "en", set(), 1)
    check(HOME_MARK in jobs[0]["message"] and HOME_MARK in json.dumps(jobs[0]["wake"]["fixture"], ensure_ascii=False),
          "file-handover: the subtask's path waits for the run's HOME")
    base = {"status": "ok", "stop_reason": "final_reply", "galley_log": [], "calls": []}
    path = "$TMPDIR/entry-layer-eval-x/file-handover.draft-1/sandbox/home/Downloads/团建方案.html"
    for reply, ok, why in (
            (f"团建方案网页做好了，日程和预算都在里面。\n[FILE:{path}]", True, "on its own line"),
            (f"团建方案网页做好了：[FILE:{path}]", False, "not on its own line"),
            ("团建方案网页做好了，在下载文件夹里。", False, "no marker"),
            ("团建方案网页做好了。\n[FILE:~/Downloads/团建方案.html]", False, "not absolute")):
        f = wake_facts(dict(base, final_reply=reply), fh)
        check(f["pass"] is ok, f"file-handover: {why} {'passes' if ok else 'fails'} ({f['reasons']})")


def dry_test_sched(results: list[dict[str, Any]], scripts: dict[str, tuple[str, str]],
                   cases: dict[str, dict[str, Any]], now: datetime, check: Any) -> None:
    """Schedule suite: the Python ports reproduce Rust's In Hand lines and
    reminder notes byte for byte; the prompt carries the main chat's own
    configuration paragraph, the ticket 36 entry layer and, only when a
    case has tasks from before the segment, the In Hand lines; the fake
    galley's schedule family answers, refuses and keeps state as the real
    CLI does; the judge reads it, and since ticket 44 tells a nudge noted
    as a to-do and a thing to get done set as a plain reminder from the
    right way round."""
    from datetime import timezone

    print("schedule: ports against Rust (rust-samples.json)")
    samples = json.loads(SCHED_SAMPLES.read_text(encoding="utf-8"))
    for ih in samples["in_hand"]:
        tz = timezone(timedelta(minutes=ih["tz_offset_minutes"]))
        check(in_hand_block(ih["todo"], datetime.fromisoformat(ih["now"].replace("Z", "+00:00")), tz,
                            ih.get("declined")) == ih["text"],
              f"in_hand_block == managed_prompt::in_hand_section ({ih['name']})")
    # Ticket 61: which follow-ups were turned down, from the briefs.
    for di in samples["declined_items"]:
        got = declined_items(di["todos"], di["tasks"], datetime.fromisoformat(di["now"].replace("Z", "+00:00")))
        check(got == di["declined"], f"declined_items == assistant_todo::declined_items ({di['name']})")
    full = next(ih for ih in samples["in_hand"] if ih["name"] == "full")
    check(in_hand_block(full["todo"], datetime.fromisoformat(full["now"].replace("Z", "+00:00")),
                        timezone(timedelta(minutes=full["tz_offset_minutes"])), []) == full["text"],
          "no follow-ups turned down: the lines read as before ticket 61")
    for n, w in enumerate(samples["wake"], 1):
        check(reminder_note(w["reports"]) == w["text"], f"reminder_note == subtask_report::report_text ({n})")
    check(all(lateness_words(a) == b for a, b in samples["lateness_words"]), "lateness_words matches")
    # Ticket 79: the Main Chat section with turns carried over.
    for ms in samples["main_chat_section"]:
        got = main_chat_carried_section(ms["session_id"], str(ms["segment_start_turn"]), ms["segment_start_date"],
                                        ms["turns"], ms["first_said_at"], ms["last_said_at"])
        check(got == ms["text"], f"main_chat_carried_section == managed_prompt::main_chat_section ({ms['name']})")
    check(sorted(ms["turns"] for ms in samples["main_chat_section"]) == [1, 2, CARRY_TURNS],
          f"the samples cover one turn, two and the most carried ({CARRY_TURNS})")
    plain = sched_prompt(cases["report-wed"], now)
    held = sched_prompt(cases["already-set"], now)
    check("### In Hand" not in plain and "### In Hand" in held, "In Hand only when a case has tasks from before")
    check(held.index("## Main Chat\n") < held.index("### In Hand") < held.index("## Galley Main Chat Entry Layer")
          and "`sched_6c1f0e9a2b7d4385` " in held, "In Hand sits between Main Chat and the entry layer")
    check("Reminders and scheduled tasks are not on this list" in plain
          and "Channels, scheduled tasks, Browser" not in plain
          and "Note what the user has to do" in plain
          and "or what comes up on a date and will be worth raising then" in plain
          and "Do it unasked, but read `todos.md` in your manual before\nsaying you will" in plain
          and "if you write nothing down, do not bring up\nnoting it." in plain
          and "Your manual is in `__MANUAL_DIR__`, one file per part." in plain, "the ticket 64 prompt")
    check("what they are in the middle of and set aside to come back to," in plain
          and "When you note something, think a step ahead: do what you can for it" in plain
          and "`[FILE:<absolute path>]` on a line of its own and say what it is: the" in plain
          and "`todos.md` and `unasked.md` to note a to-do;" in plain
          and "`unasked.md`" in WAKE_PROMPT.read_text(encoding="utf-8"), "the ticket 73 prompt (schedule and wake)")
    # Ticket 73: the review's words are Core's (the samples carry them;
    # ticket 96 added two that name new memos).
    review_samples = [w for w in samples["wake"] if all(d.get("review") for d in w["reports"])]
    check(len(review_samples) == 4 and all(w["text"].startswith(OPENING_REVIEW) for w in review_samples)
          and all(d["prompt"] == REVIEW_PROMPT for w in review_samples for d in w["reports"]),
          "the morning review: REVIEW_PROMPT and OPENING_REVIEW are Rust's")
    # Ticket 78: the review beside a to-do's reminder, beside a subtask that
    # finished, and beside one sent back twice with a long answer (cut),
    # late: Core's mixed opening and closing, and its subtask words.
    mixed = [w for w in samples["wake"] if len(w["reports"]) > 1 and any(d.get("review") for d in w["reports"])]
    check(len(mixed) == 3 and all(w["text"].startswith(OPENING_MIXED) and w["text"].endswith(CLOSING_MANY)
                                  for w in mixed)
          and any(d.get("todo") for w in mixed for d in w["reports"])
          and sum(d.get("kind") == "done" for w in mixed for d in w["reports"]) == 2
          and any("[… cut for length; all of it: `session show " in w["text"] for w in mixed),
          "the review with another update: OPENING_MIXED, CLOSING_MANY and the subtask paragraph are Rust's")
    review_ih = next((ih for ih in samples["in_hand"] if ih["name"] == "review"), None)
    check(review_ih is not None and "Galley's morning review, not set by you" in review_ih["text"],
          "the morning review's In Hand line is Rust's")
    check(held.index("### In Hand") < held.index("What you are on (") and "The user's to-dos" not in held,
          "a case's own reminder is in the What-you-are-on group")
    dry_test_first_line(cases, now, check)
    for r in sorted(results, key=lambda r: r["id"]):
        case_id, script = scripts[r["id"]]
        case = cases[case_id]
        print(f"schedule {r['id']} / {r['variant']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        check(not r["blocked"] and not r["do_calls"] and not r["canaries"],
              f"nothing left the sandbox ({r['blocked']} {r['do_calls']} {r['canaries']})")
        system = r["requests"][0]["messages"][0]["content"]
        m = re.search(r"Your manual is in `([^`]+)`", system)
        check(bool(m) and m.group(1).endswith("/managed-ga-state/assistant/reference/manual"),
              "the prompt names the manual's directory in the run's state root")
        check(r.get("manual_files") == [x.name for x in manual_parts()],
              f"the directory holds every part, nothing else ({r.get('manual_files')})")
        last = r["requests"][0]["messages"][-1]["content"]
        if not isinstance(last, str):
            last = "\n".join(b.get("text", "") for b in last if isinstance(b, dict))
        want = case.get("message") or sched_note(case, datetime.fromisoformat(r["now"]))
        check(want in last and r["message"] == want, "the new message is the case's (a wake note in Core's words)")
        f = sched_facts(r, case)
        if script == "sched-create":
            out = str((r["calls"][1].get("result") or {}).get("stdout", ""))
            for piece in ("date=0", "listed=0", "time_in_past:", "past=2", '"target": "assistant"',
                          "notarget=0", "listed=2", "main_chat_protected:", "rename=2", "Create a task."):
                check(piece in out, f"shell output has {piece!r}")
            check(f["names"][:5] == ["schedule list", "schedule create", "schedule create", "schedule create",
                                     "schedule list"], f"fake galley logged the calls ({f['names']})")
            check(len(f["made"]) == 2 and {t["target"] for t in f["made"]} == {"assistant", "session"},
                  f"two tasks made, one wakes the assistant ({[t.get('target') for t in f['made']]})")
            check(any("没带 --target=assistant" in x for x in f["reasons"])
                  and any("建了 2 个" in x for x in f["reasons"])
                  and any("多余的写命令" in x for x in f["reasons"]) and not f["pass"],
                  f"the judge flags the missing target, the second task and the rename ({f['reasons']})")
            # Ticket 105: the three creates' words, refused ones too.
            check([fl["first_line"] for fl in f["first_lines"]] == ["提醒用户喝水"] * 3
                  and all(fl["problems"] == ["写了「用户」", "以「提醒」开头"] for fl in f["first_lines"])
                  and any(x.startswith("schedule create 的第一行「提醒用户喝水」") for x in f["reasons"]),
                  f"the first-line judge reads each create from the log ({f['first_lines']})")
            check(f["listed"] == "查了" and f["manual"].startswith("读了（第 1 次调用）：times.md；1 次 1 轮，"),
                  f"list-before-create and the part read ({f['manual']})")
            check(says_time("好，十分钟后提醒你喝水。", datetime.fromisoformat(f["made"][0]["fireAt"]).astimezone(),
                            datetime.fromisoformat(r["now"]), datetime.fromtimestamp(r["started_at"]).astimezone()),
                  "a relative time counts as saying the time")
        elif script == "sched-nudge-todo":
            check(f["names"] == ["todo list", "todo add"] and len(f["made_todos"]) == 1,
                  f"the nudge went onto the list ({f['names']})")
            check(not f["pass"] and any("却记成了待办" in x for x in f["reasons"])
                  and any("记了待办" in x for x in f["reasons"])
                  and any("多余的写命令" in x and "todo add" in x for x in f["reasons"]),
                  f"the judge flags a nudge noted as a to-do ({f['reasons']})")
        elif script == "sched-nudge":
            check(f["names"] == ["schedule list", "schedule create"] and not f["made_todos"],
                  f"its own one-off reminder ({f['names']})")
            check(f["pass"], f"a nudge as its own reminder, 「半小时后」 said, passes ({f['reasons']})")
            # Ticket 105: the line breaks reach the fake galley and its
            # state as line breaks; the first line is the user's.
            check(len(f["made"]) == 1 and f["made"][0]["prompt"] == "关火\n\n用户要半小时后提醒；到时简短提醒。"
                  and [(fl["first_line"], fl["notes"], fl["pass"]) for fl in f["first_lines"]] == [("关火", True, True)],
                  f"words in the new form: stored with their breaks, the first line passes ({f['first_lines']})")
        elif script == "sched-own-for-todo":
            check(not f["pass"] and any("却建成了它自己的提醒" in x for x in f["reasons"])
                  and any("该记 1 件待办，记了 0 件" in x for x in f["reasons"])
                  and any("多余的写命令" in x and "schedule create" in x for x in f["reasons"]),
                  f"the judge flags a thing to get done set as a plain reminder ({f['reasons']})")
        elif script == "sched-todo":
            check(f["names"] == ["todo list", "todo add"] and len(f["made_todos"]) == 1
                  and (f["timed"] or {}).get("todoId") == f["made_todos"][0]["id"],
                  f"a to-do with its reminder ({f['names']})")
            check(f["pass"], f"a thing to get done as a to-do with its reminder passes ({f['reasons']})")
        else:
            check("### In Hand" not in system, "no In Hand lines without tasks from before")
            check(f["pass"] and f["no_reply"] and not f["names"], f"<no-reply/>, nothing touched ({f['reasons']})")


def synth_run(case: dict[str, Any], at: datetime, reply: str, todos: tuple[dict[str, Any], ...] = (),
              tasks: tuple[dict[str, Any], ...] = (), log: tuple[list[str], ...] = (),
              memory: dict[str, list[str]] | None = None,
              turns: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Dry test (ticket 63): a run's result as the judge reads it, built by
    hand at a fixed `at`: the case's fixture, the to-dos and tasks the run
    left besides, the fake galley's log, GA's memory changes."""
    fx = sched_fixture(clock_case(case, at), at)
    return {"now": at.isoformat(), "status": "ok", "stop_reason": "final_reply", "final_reply": reply,
            "galley_log": [{"argv": list(a)} for a in log], "calls": [],
            "fixture_tasks": fx["tasks"], "fixture_todos": fx["todos"],
            "fake_state": {"todos": fx["todos"] + list(todos), "tasks": fx["tasks"] + list(tasks)},
            "memory_changes": memory or {"added": [], "changed": [], "removed": []}, "turns": turns or []}


def synth_todo(title: str, due: str | None = None, due_at: datetime | None = None) -> dict[str, Any]:
    return {"id": "todo_dry0000000000001", "title": title, "notes": None, "dueDate": due,
            "dueAt": due_at.isoformat() if due_at else None, "doneAt": None, "cancelledAt": None}


def synth_reminder(at: datetime, todo_id: str | None = None, prompt: str = "dry") -> dict[str, Any]:
    return {"id": "sched_dry000000000001", "todoId": todo_id, "fireAt": at.isoformat(), "target": "assistant",
            "prompt": prompt, "cancelledAt": None}


SYNTH_ADD = ("todo", "add", "dry", "--supervisor=galley-assistant", "--reason=dry")
SYNTH_CREATE = ("schedule", "create", "dry", "--at=dry", "--target=assistant", "--supervisor=galley-assistant",
                "--reason=dry")


def dry_test_first_line(cases: dict[str, dict[str, Any]], now: datetime, check: Any) -> None:
    """Ticket 105: the first-line judge on words that pass and words that
    fail each rule, the GUI's way of taking the first line, a create and
    an update read from the log, the verdict before ticket 105 kept apart,
    and the wake cases' words in the new form handed over whole."""
    print("schedule: the first line (ticket 105)")
    passes = ["该喝水了", "订上海的酒店", "问 HR 有没有回 offer", "给妈妈打电话\n\n用户周五说的，周日晚上 9 点打。",
              "\n  关火  \n\n半小时后", "少喝一点咖啡", "周报发给王经理", "取快递（取件码 8-3-2041）",
              "收好行李，带上身份证\r\n\r\n明早 8:05 的高铁"]
    for words in passes:
        line, problems = first_line_problems(words)
        check(not problems, f"first line passes: {words!r} -> {line!r} {problems}")
    fails = {
        "提醒用户喝水": ["写了「用户」", "以「提醒」开头"],
        "该喝水了（用户要求）": ["写了「用户」"],
        "JC 的快递": ["写了「JC」"],
        "明天下午 4 点给妈妈打电话": ["有时间或日子：「明天」、「下午」、「4 点」"],
        "周三交报告": ["有时间或日子：「周三」"],
        "15:30 开会": ["有时间或日子：「15:」"],
        "20号交房租": ["有时间或日子：「20号」"],
        "三点开会": ["有时间或日子：「三点」"],
        "十分钟后关火": ["有时间或日子：「分钟后」"],
        "把季度报告的第四页数据再核对一遍然后交给王经理": ["23 字，上限 20"],
        "该喝水了\\n\\n到时简短提醒": ["原文里是字面的「\\n」，不是换行"],
        " \n \n": ["第一行是空的"],
    }
    for words, want in fails.items():
        line, problems = first_line_problems(words)
        check(problems == want, f"first line fails: {words!r} -> {problems}")
    check(first_line("  订酒店  \n\n备注") == "订酒店" and first_line("没有换行的整段") == "没有换行的整段"
          and first_line("\r\n\r\n关火\r半小时") == "关火", "first_line: the GUI's reminderFirstLine")
    log = [["schedule", "list"],
           ["schedule", "create", "该喝水了\n\n用户要的", "--at=2026-10-28T15:00", "--target=assistant"],
           ["schedule", "create", "--help"],
           ["schedule", "update", "sched_x", "--at=2026-10-28T16:00", "--supervisor=galley-assistant"],
           ["schedule", "update", "sched_x", "--prompt=明天 9 点转房租", "--supervisor=galley-assistant"],
           ["schedule", "update", "sched_y", "--prompt", "转房租", "--supervisor=galley-assistant"]]
    got = [(fl["command"], fl["first_line"], fl["notes"], fl["pass"]) for fl in first_line_checks(log)]
    check(got == [("schedule create", "该喝水了", True, True), ("schedule update", "明天 9 点转房租", False, False),
                  ("schedule update", "转房租", False, True)],
          f"first_line_checks: creates and updates with --prompt, not a help page or a new time alone ({got})")
    water = cases["water-10min"]
    at = datetime(2026, 10, 28, 15, 0, tzinfo=now.tzinfo)
    for words, ok in (("该喝水了\n\n用户在主聊天要的；到时简短提醒。", True), ("提醒用户十分钟后喝水", False)):
        argv = ("schedule", "create", words, "--at=dry", "--target=assistant", "--supervisor=galley-assistant",
                "--reason=dry")
        f = sched_facts(synth_run(water, at, "好，十分钟后提醒你喝水。",
                                  tasks=(synth_reminder(at + timedelta(minutes=10), prompt=words),),
                                  log=(("schedule", "list"), argv)), water)
        check(f["pass_before_105"] and f["pass"] is ok
              and (ok or any("以「提醒」开头" in x and "「分钟后」" in x for x in f["reasons"])),
              f"sched_facts: the earlier rules pass, the first line {'passes' if ok else 'fails'} ({f['reasons']})")
    note = sched_note(cases["wake-on-time"], now)
    check("<<<\n收好行李，带上身份证\n\n明早 8:05 虹桥站的 G7 次高铁去北京出差。" in note
          and all(first_line(c["tasks"][0]["prompt"]) != c["tasks"][0]["prompt"].strip()
                  for c in cases.values() if c.get("wake")),
          "the wake cases' words are in the new form, handed over whole as Core does")


def dry_test_moved(cases: dict[str, dict[str, Any]], mon: datetime, check: Any) -> None:
    """Ticket 110: the four review cases' fixtures (the carried turns, the
    subtask's report in Core's words, the night it ran, when the to-dos
    were noted and changed, the files) and the judge on runs left by hand
    (left alone; a line the notes missed, its day and path; the user's
    news on top, done or not, nothing made again; another look as a
    reminder of its own)."""
    print("todo: only what moved (ticket 110)")
    tz = mon.tzinfo
    day = f"{mon.month}月{mon.day}日"
    yesterday = mon - timedelta(days=1)
    before = mon - timedelta(days=2)
    hid = "todo_4c8e1a7d2b9f3605"
    over, missed, news, later = (cases[k] for k in ("review-handed-over", "review-done-not-noted",
                                                    "review-user-news-on-top", "review-look-again-later"))
    show = ("todo", "show", hid)

    def upd(tid: str, notes: str) -> tuple[str, ...]:
        return ("todo", "update", tid, f"--notes={notes}", "--supervisor=galley-assistant", "--reason=dry")

    def run(case: dict[str, Any], reply: str, notes: dict[str, str] | None = None, log: tuple[Any, ...] = (),
            tasks: tuple[dict[str, Any], ...] = (), home_added: list[str] | None = None,
            stop: str = "final_reply") -> dict[str, Any]:
        r = synth_run(case, mon, reply, tasks=tasks, log=log)
        r["stop_reason"] = stop
        if home_added:
            r["calls"] = [{"n": k + 1, "name": "file_write", "args": {"path": p}} for k, p in enumerate(home_added)]
            r["home_added"] = home_added
        r["fake_state"]["todos"] = [dict(t, notes=(notes or {}).get(t["id"], t.get("notes")))
                                    for t in r["fake_state"]["todos"]]
        return todo_facts(r, case)

    # Fixtures: two turns carried over, the subtask's report in Core's
    # words, the subtask run the night before, the to-dos' times.
    sub = over["subtasks"][0]
    final = [m for m in sub["messages"] if m.get("final")][-1]["content"]
    core = reminder_note([{"kind": "done", "subtask_id": sub["id"], "title": sub["title"], "send_backs": 0,
                           "answer": final}])
    check(over["history"][2]["content"] == core and missed["history"] == over["history"],
          "handed over / not noted: the carried report is Core's words for the subtask")
    prompt = sched_prompt(over, mon)
    check("opens\nwith 2 exchanges from before it, said between " in prompt
          and (mon - timedelta(hours=16)).strftime("%Y-%m-%d %H:%M") in prompt
          and (mon - timedelta(hours=10)).strftime("%Y-%m-%d %H:%M") in prompt,
          "handed over: two turns carried, said 16 and 10 hours before")
    fx = sched_fixture(clock_case(over, mon), mon)
    srow = fx["sessions"][sub["id"]]
    hilton = next(t for t in fx["todos"] if t["id"] == hid)
    ran = [datetime.fromisoformat(srow[k]) for k in ("createdAt", "lastActivityAt")]
    check(ran[0] == mon - timedelta(minutes=604) and mon - timedelta(minutes=604) < ran[1] <= mon - timedelta(minutes=600)
          and hilton["createdAt"] == iso_utc(mon - timedelta(hours=16))
          and hilton["updatedAt"] == iso_utc(mon - timedelta(hours=10)),
          "handed over: the subtask ran ten hours ago; the to-do noted 16 hours ago, changed 10")
    jobs = make_sched_jobs([over], mon, {}, "en", set(), 1, "dry", suite="todo")
    check(jobs[0]["wake"]["files"] == over["files"] and "{{HOME}}/Downloads/希尔顿酒店资料收集模板.md" in hilton["notes"]
          and "{{HOME}}" in jobs[0]["history"][2]["content"],
          "handed over: the template goes into the run's ~/Downloads; its path by HOME, filled per run")
    plain = sched_fixture(clock_case(cases["review-advance"], mon), mon)
    check(all(t["createdAt"] == t["updatedAt"] for t in plain["todos"]),
          "a case that says no times: noted and changed at once, as before")
    # Handed over, no word since: left alone.
    f = run(over, "<no-reply/>", log=(("todo", "list"), show))
    check(f["pass"] is True and not f["flags"], f"handed over: read, <no-reply/>: passes ({f['reasons']} {f['flags']})")
    for reply, kw, why in (
            ("<subtask>查希尔顿项目的公开资料</subtask>\n<no-reply/>", {}, "最多派 0 件"),
            ("<no-reply/>", {"home_added": ["/sandbox/home/Downloads/希尔顿开业时间表.md"]}, "做了新文件"),
            ("<no-reply/>", {"notes": {hid: f"{day}：看了一下，等业主资料\n" + hilton["notes"]}}, "不该动备注"),
            ("<no-reply/>", {"tasks": (synth_reminder(mon + timedelta(days=2)),), "log": (SYNTH_CREATE,)},
             "不该建它自己的提醒"),
            ("希尔顿那件在等你拿业主的资料。", {}, "不是只有")):
        f = run(over, reply, **kw)
        check(f["pass"] is False and any(why in x for x in f["reasons"]), f"handed over: {why} fails ({f['reasons']})")
    # Done the night before, not in the notes: the line first.
    base = missed["todos"][0]["notes"]
    path = "/sandbox/home/Downloads/希尔顿酒店资料收集模板.md"
    for lead, ok in ((day, True), (f"{yesterday.month}月{yesterday.day}日", True),
                     (f"{before.month}月{before.day}日", False)):
        line = f"{lead}：资料收集模板做好了：{path}"
        f = run(missed, "<no-reply/>", {hid: line + "\n" + base}, (show, upd(hid, line + "\n" + base)))
        check(f["pass"] is ok, f"not noted: the line led by {lead} {'passes' if ok else 'fails'} ({f['reasons']})")
    line = f"{day}：资料收集模板做好了：{path}"
    told = f"希尔顿那份资料收集模板在这里：\n[FILE:{path}]"
    f = run(missed, told, {hid: line + "\n" + base}, (show, upd(hid, line + "\n" + base)))
    check(f["pass"] is True and any("交出了文件" in x for x in f["flags"]),
          f"not noted: speaking to hand the file over passes, noted ({f['reasons']} {f['flags']})")
    for reply, notes, kw, why in (
            ("<no-reply/>", f"{day}：资料收集模板做好了", {}, "绝对路径"),
            ("<no-reply/>", f"{day}：资料收集模板做好了：~/Downloads/希尔顿酒店资料收集模板.md", {}, "~/"),
            ("<no-reply/>", None, {}, "没补"),
            ("希尔顿那件我补到备注里了。", line, {}, "没交出文件"),
            ("<no-reply/>", line, {"home_added": ["/sandbox/home/Downloads/希尔顿资料收集模板v2.md"]}, "做了新文件")):
        upd_notes = {hid: notes + "\n" + base} if notes else None
        f = run(missed, reply, upd_notes, (show, upd(hid, notes + "\n" + base)) if notes else (show,), **kw)
        check(f["pass"] is False and any(why in x for x in f["reasons"]), f"not noted: {why} fails ({f['reasons']})")
    # The user's news on top: may do something, need not; nothing made again.
    nbase = news["todos"][0]["notes"]
    f = run(news, "<no-reply/>", log=(("todo", "list"), show))
    check(f["pass"] is True and any("什么都没做" in x for x in f["flags"]),
          f"news on top: nothing done passes, noted ({f['reasons']} {f['flags']})")
    f = run(news, "<subtask>查环岛东路 1999 号地块的公开规划信息</subtask>\n<no-reply/>", log=(show,))
    check(f["pass"] is True, f"news on top: a subtask for it passes ({f['reasons']} {f['flags']})")
    for brief in ("按新地址查公开资料，已有资料收集模板可先读，不要修改它，另写一份核对简报",
                  "已有资料收集模板，不要重做模板；这次按新地址查公开资料", "按新地址查公开资料，不要再做一份空模板",
                  "先读既有模板，避免重做通用资料收集模板，再按新地址查公开资料"):
        f = run(news, f"<subtask>{brief}</subtask>\n<no-reply/>", log=(show,))
        check(f["pass"] is True and any("提到了「模板」" in x for x in f["flags"]),
              f"news on top: a subtask that names the template, not to make it again, passes, noted: {brief} "
              f"({f['reasons']} {f['flags']})")
    f = run(news, "<subtask>按新地址查公开资料；待办的最新备注已记录该消息，查完再补一行</subtask>\n<no-reply/>", log=(show,))
    check(f["pass"] is True, f"news on top: 「已记录」 inside a subtask's brief is no claim ({f['reasons']})")
    f = run(news, "", log=(show,), stop="web_tool")
    check(f["pass"] is True, f"news on top: a look in the browser passes ({f['reasons']} {f['flags']})")
    found = f"{day}：查了环岛东路 1999 号地块：已取得规划许可，周边两家竞品酒店（文件：/sandbox/home/Downloads/希尔顿项目周边.md）"
    f = run(news, "希尔顿那件我早上查了一下项目地块：规划许可已下，周边有两家同档竞品。\n[FILE:/sandbox/home/Downloads/希尔顿项目周边.md]",
            {hid: found + "\n" + nbase}, (show, upd(hid, found + "\n" + nbase)),
            home_added=["/sandbox/home/Downloads/希尔顿项目周边.md"])
    check(f["pass"] is True, f"news on top: done, said, the line on top: passes ({f['reasons']} {f['flags']})")
    for reply, kw, why in (
            ("<subtask>按新地址重做希尔顿资料收集模板</subtask>\n<no-reply/>", {}, "重做了「模板」"),
            ("<no-reply/>", {"home_added": ["/sandbox/home/Downloads/希尔顿资料收集模板（新）.md"]}, "重做了「模板」"),
            ("希尔顿那件还在等业主的其余资料。", {}, "没做成什么却开口了"),
            ("项目地址收到了，要不要我查一下周边竞品？", {}, "建议")):
        f = run(news, reply, log=(show,), **kw)
        check(f["pass"] is False and any(why in x for x in f["reasons"]), f"news on top: {why} fails ({f['reasons']})")
    # Another look later: a reminder of its own, nothing in the notes.
    vid = later["todos"][0]["id"]
    vfx = sched_fixture(clock_case(later, mon), mon)
    check(next(t for t in vfx["todos"] if t["id"] == vid)["createdAt"] == iso_utc(mon - timedelta(hours=14))
          and list(later["files"]) == ["签证进度查询.html"] and "审理中" in later["files"]["签证进度查询.html"],
          "look again later: noted 14 hours ago; the status page says 审理中")
    look = (("todo", "show", vid), SYNTH_CREATE)
    f = run(later, "<no-reply/>", log=look, tasks=(synth_reminder(mon + timedelta(days=3), prompt="看签证审批结果"),))
    check(f["pass"] is True, f"look again later: a reminder in three days, <no-reply/>: passes ({f['reasons']})")
    for reply, kw, why in (
            ("<no-reply/>", {"log": (("todo", "show", vid),)}, "该建 1 个"),
            ("<no-reply/>", {"tasks": (synth_reminder(mon + timedelta(hours=2)),)}, "时间不对"),
            ("签证还在审理，过两天我再看。", {"tasks": (synth_reminder(mon + timedelta(days=3)),)}, "不是只有"),
            ("<no-reply/>", {"tasks": (synth_reminder(mon + timedelta(days=3)),),
                             "notes": {vid: f"{day}：查了，还在审理中\n" + later["todos"][0]["notes"]}}, "不该动备注")):
        kw.setdefault("log", look)
        f = run(later, reply, **kw)
        check(f["pass"] is False and any(why in x for x in f["reasons"]), f"look again later: {why} fails ({f['reasons']})")


def dry_test_progress(cases: dict[str, dict[str, Any]], mon: datetime, check: Any) -> None:
    """Ticket 108: the judge of how a to-do is going on notes left by hand
    (a line on top, at the end, none, the old notes changed, no day, the
    wrong day, a literal \\n, not read first, read by the list only, a
    reminder of its own beside it, another to-do's notes), the time moved
    with the line, the review that made a file or only started a subtask,
    the review that found nothing new, the notes the user changed, the
    news of something not on the list; the fixture's files and {{HOME}}."""
    print("todo: how a to-do is going (ticket 108)")
    tz = mon.tzinfo
    day = f"{mon.month}月{mon.day}日"
    hid, rid, mid = "todo_4c8e1a7d2b9f3605", "todo_6f7a8b9c0d1e2f3a", "todo_9d2e4f6a8b0c1e35"
    show = ("todo", "show", hid)

    def upd(tid: str, notes: str) -> tuple[str, ...]:
        return ("todo", "update", tid, f"--notes={notes}", "--supervisor=galley-assistant", "--reason=dry")

    def run(case_id: str, reply: str, notes: dict[str, str] | None = None, log: tuple[Any, ...] = (),
            tasks: tuple[dict[str, Any], ...] = (), patch: dict[str, dict[str, Any]] | None = None,
            home_added: list[str] | None = None) -> dict[str, Any]:
        case = cases[case_id]
        r = synth_run(case, mon, reply, tasks=tasks, log=log)
        if home_added:
            # The run wrote them (the review judge looks for the work).
            r["calls"] = [{"n": k + 1, "name": "file_write", "args": {"path": p}} for k, p in enumerate(home_added)]
        todos = []
        for t in r["fake_state"]["todos"]:
            t = dict(t)
            if notes and t["id"] in notes:
                t["notes"] = notes[t["id"]]
            t.update((patch or {}).get(t["id"]) or {})
            todos.append(t)
        r["fake_state"]["todos"] = todos
        if home_added:
            r["home_added"] = home_added
        return todo_facts(r, case)

    for words, ok in ((f"{day}：业主说下周给", True), ("2026-10-19 业主说下周给", True), ("10/19：下周给", True),
                      (f"【{day}】下周给", True), (f"{day}业主说下周给", True), ("10/19下周给", False),
                      ("今天：业主说下周给", False), ("业主说下周给", False)):
        check(bool(PROGRESS_DAY_RE.match(words)) is ok, f"the day first: {words!r} {'is' if ok else 'is not'}")
    base = cases["news-budget"]["todos"][0]["notes"]
    line = f"{day}：业主说筹开预算下周给"
    said = "记在希尔顿那件的备注里了：业主下周给筹开预算。"
    f = run("news-budget", said, {hid: line + "\n" + base}, (show, upd(hid, line + "\n" + base)))
    check(f["pass"] is True and f["progress"]["line"] == line and not f["flags"],
          f"news: a line on top, the old notes below word for word: passes ({f['reasons']} {f['flags']})")
    f = run("news-budget", said, {hid: base + "\n" + line}, (show, upd(hid, base + "\n" + line)))
    check(f["pass"] is False and any("后面" in x for x in f["reasons"]), f"news: at the end fails ({f['reasons']})")
    f = run("news-budget", said, log=(show,))
    check(f["pass"] is False and any("没补" in x for x in f["reasons"]), f"news: notes left alone fail ({f['reasons']})")
    cut = line + "\n" + base.replace("；证照办理进度", "")
    f = run("news-budget", said, {hid: cut}, (show, upd(hid, cut)))
    check(f["pass"] is False and any("一字不差" in x for x in f["reasons"]), f"news: old notes changed fail ({f['reasons']})")
    for top, why in (("业主说筹开预算下周给", "日子打头"), ("10月18日：业主说筹开预算下周给", "不是今天"),
                     (line + "\\n", "字面"), (f"{day}：业主下周给钱", "没有：预算")):
        f = run("news-budget", said, {hid: top + "\n" + base}, (show, upd(hid, top + "\n" + base)))
        check(f["pass"] is False and any(why in x for x in f["reasons"]), f"news: {top!r} fails on {why} ({f['reasons']})")
    f = run("news-budget", said, {hid: line + base}, (show, upd(hid, line + base)))
    check(f["pass"] is False and any("单独成行" in x for x in f["reasons"]), f"news: on the same line fails ({f['reasons']})")
    f = run("news-budget", said, {hid: line + "\n\n" + base}, (show, upd(hid, line + "\n\n" + base)))
    check(f["pass"] is True and any("空了一行" in x for x in f["flags"]), f"news: a blank line between is noted ({f['flags']})")
    f = run("news-budget", said, {hid: line + "\n" + base}, (upd(hid, line + "\n" + base), show))
    check(f["pass"] is False and any("没读" in x for x in f["reasons"]), f"news: written before read fails ({f['reasons']})")
    f = run("news-budget", said, {hid: line + "\n" + base}, (("todo", "list"), upd(hid, line + "\n" + base)))
    check(f["pass"] is True and any("只读了 todo list" in x for x in f["flags"]),
          f"news: read by the list only passes, noted ({f['reasons']} {f['flags']})")
    ask = synth_reminder(datetime(2026, 10, 26, 10, 0, tzinfo=tz), prompt="问业主的筹开预算到了没")
    f = run("news-budget", said + "下周一上午我问你一下。", {hid: line + "\n" + base},
            (show, upd(hid, line + "\n" + base), SYNTH_CREATE), tasks=(ask,))
    check(f["pass"] is True and any("给自己挂了 1 个提醒" in x for x in f["flags"]),
          f"news: a reminder of its own beside it passes, counted ({f['reasons']} {f['flags']})")
    f = run("news-budget", said, {hid: line + "\n" + base, rid: "预算下周给"},
            (show, upd(hid, line + "\n" + base), upd(rid, "预算下周给")))
    check(f["pass"] is False and any("别的待办的备注" in x for x in f["reasons"]),
          f"news: another to-do's notes changed fail ({f['reasons']})")
    # The news that moves the time: due, reminder and the line.
    reno = cases["news-moves-time"]["todos"][0]
    moved = f"{day}：装修队说要拖到 12 月 5 日"
    fx = sched_fixture(clock_case(cases["news-moves-time"], mon), mon)
    rem = next(t for t in fx["tasks"] if t.get("todoId") == rid)
    new_rem = dict(rem, fireAt=iso_utc(datetime(2026, 12, 5, 9, 0, tzinfo=tz)))
    r = synth_run(cases["news-moves-time"], mon, "改好了：702 装修顺延到 12 月 5 日，当天早上 9 点提醒你。",
                  log=(("todo", "show", rid), ("todo", "update", rid, "--due=2026-12-05", "--remind-at=2026-12-05T09:00",
                                               "--notes=" + moved + "\n" + reno["notes"],
                                               "--supervisor=galley-assistant", "--reason=dry")))
    r["fake_state"]["todos"] = [dict(t, dueDate="2026-12-05", notes=moved + "\n" + reno["notes"]) if t["id"] == rid
                                else t for t in r["fake_state"]["todos"]]
    r["fake_state"]["tasks"] = [new_rem if t["id"] == rem["id"] else t for t in r["fake_state"]["tasks"]]
    f = todo_facts(r, cases["news-moves-time"])
    check(f["pass"] is True, f"moved: due, reminder and the line: passes ({f['reasons']})")
    r["fake_state"]["tasks"] = [rem if t["id"] == rem["id"] else t for t in r["fake_state"]["tasks"]]
    f = todo_facts(r, cases["news-moves-time"])
    check(f["pass"] is False and any("提醒没跟着挪" in x for x in f["reasons"]), f"moved: the reminder left fails ({f['reasons']})")
    # The review that got something done, and the one that only started.
    rv = cases["progress-review-done"]
    mbase = rv["todos"][0]["notes"]
    fx = sched_fixture(clock_case(rv, mon), mon)
    check(sorted(rv["files"]) == ["搬家报价/好邻居搬家.txt", "搬家报价/蚂蚁搬家.txt", "搬家报价/速达搬家.txt"]
          and make_sched_jobs([rv], mon, {}, "en", set(), 1, "dry", suite="todo")[0]["wake"]["files"] == rv["files"]
          and "### In Hand" in sched_prompt(rv, mon) and "no due date: 定搬家公司" in sched_prompt(rv, mon),
          "review-done: the quotes go into the run's ~/Downloads; In Hand has the to-do")
    path = "/sandbox/home/Downloads/搬家报价/三家报价对比.md"
    good = f"{day}：三家报价比好了，全包算下来蚂蚁最便宜（2,380 元），对比表在 {path}"
    told = f"搬家报价我早上比了一下：全包算下来蚂蚁最便宜，2,380 元。\n[FILE:{path}]"
    f = run("progress-review-done", told, {mid: good + "\n" + mbase}, (("todo", "list"), upd(mid, good + "\n" + mbase)),
            home_added=[path])
    check(f["pass"] is True, f"review-done: compared, a file, the line with its path: passes ({f['reasons']} {f['flags']})")
    bare = f"{day}：三家报价比好了，蚂蚁最便宜"
    f = run("progress-review-done", told, {mid: bare + "\n" + mbase}, (("todo", "list"), upd(mid, bare + "\n" + mbase)),
            home_added=[path])
    check(f["pass"] is False and any("绝对路径" in x for x in f["reasons"]), f"review-done: no path fails ({f['reasons']})")
    tilde = bare + "，对比表在 ~/Downloads/搬家报价/三家报价对比.md"
    f = run("progress-review-done", told, {mid: tilde + "\n" + mbase}, (("todo", "list"), upd(mid, tilde + "\n" + mbase)),
            home_added=[path])
    check(f["pass"] is False and any("~/" in x for x in f["reasons"]), f"review-done: a ~/ path fails ({f['reasons']})")
    f = run("progress-review-done", told, log=(("todo", "list"),), home_added=[path])
    check(f["pass"] is False and any("没补" in x for x in f["reasons"]), f"review-done: done, notes alone fail ({f['reasons']})")
    sub = "<subtask>比一比三家搬家报价</subtask>\n<no-reply/>"
    f = run("progress-review-done", sub, log=(("todo", "list"),))
    check(f["pass"] is True and any("没用上" in x for x in f["flags"]),
          f"review-done: only a subtask, notes alone: passes, noted ({f['reasons']} {f['flags']})")
    f = run("progress-review-done", sub, {mid: f"{day}：派人去比了\n" + mbase},
            (("todo", "list"), upd(mid, f"{day}：派人去比了\n" + mbase)))
    check(f["pass"] is False and any("没做成什么" in x for x in f["reasons"]),
          f"review-done: a line for a subtask only started fails ({f['reasons']})")
    # The review that found nothing new.
    un = cases["progress-review-unchanged"]
    check("{{HOME}}/Downloads/搬家报价/三家报价对比.md" in un["todos"][0]["notes"] and "搬家报价/三家报价对比.md" in un["files"],
          "review-unchanged: yesterday's line names the comparison by HOME, and the file is there")
    f = run("progress-review-unchanged", "<no-reply/>", log=(("todo", "list"),))
    check(f["pass"] is True, f"review-unchanged: <no-reply/>, nothing touched: passes ({f['reasons']})")
    ubase = un["todos"][0]["notes"]
    f = run("progress-review-unchanged", "<no-reply/>", {mid: f"{day}：看了一下，还没定\n" + ubase},
            (("todo", "list"), upd(mid, f"{day}：看了一下，还没定\n" + ubase)))
    check(f["pass"] is False and any("不该动备注" in x for x in f["reasons"]),
          f"review-unchanged: a line for a look fails ({f['reasons']})")
    # The notes the user changed in the list.
    ed = cases["news-user-edited"]
    ebase = ed["todos"][0]["notes"]
    fire = f"{day}：业主说消防验收下周能过"
    f = run("news-user-edited", "记在希尔顿那件上了。", {hid: fire + "\n" + ebase}, (show, upd(hid, fire + "\n" + ebase)))
    check(f["pass"] is True and "品牌定位与客房数量" not in ebase, f"edited: on the user's notes: passes ({f['reasons']})")
    f = run("news-user-edited", "记在希尔顿那件上了。", {hid: fire + "\n" + base}, (show, upd(hid, fire + "\n" + base)))
    check(f["pass"] is False and any("用户删掉的" in x for x in f["reasons"]) and any("一字不差" in x for x in f["reasons"]),
          f"edited: the point the user took out written back fails ({f['reasons']})")
    # News of something not on the list.
    f = run("news-unrelated", "万豪那边下个月开始招标，我先记着。")
    check(f["pass"] is True, f"unrelated: nothing touched passes ({f['reasons']})")
    f = run("news-unrelated", "记在希尔顿那件上了。", {hid: f"{day}：万豪业主说下个月招标\n" + base},
            (show, upd(hid, f"{day}：万豪业主说下个月招标\n" + base)))
    check(f["pass"] is False and any("不该动备注" in x for x in f["reasons"]), f"unrelated: into the Hilton notes fails ({f['reasons']})")
    # Elsewhere a change of notes is only noted.
    qm = cases["quote-move"]
    r = synth_run(qm, mon, "改到周四了。")
    r["fake_state"]["todos"] = [dict(t, notes="改过") if t["id"] == "todo_2b3c4d5e6f7a8b9c" else t
                                for t in r["fake_state"]["todos"]]
    f = todo_facts(r, qm)
    check(any("改了备注" in x for x in f["flags"]) and not any("备注" in x for x in f["reasons"]),
          f"an old case: a change of notes is noted, not judged ({f['flags']})")


def dry_test_todo(results: list[dict[str, Any]], scripts: dict[str, tuple[str, str]],
                  cases: dict[str, dict[str, Any]], now: datetime, check: Any) -> None:
    """To-do suite: the In Hand lines carry the case's to-dos as they stood
    at the segment's start (a to-do ticked off since still open, one noted
    since absent); the fake galley's `todo` family answers, refuses and
    keeps state as the real CLI and Core do; the judge reads it."""
    print("todo: prompts and fixtures")
    # Ticket 60's time specs, on a fixed Monday.
    mon = datetime(2026, 10, 19, 18, 25, tzinfo=now.tzinfo)
    check(sched_time({"week_after": 3, "time": "08:00"}, mon) == datetime(2026, 10, 28, 8, 0, tzinfo=now.tzinfo)
          and sched_time({"next_weekday": 3, "time": "08:00"}, mon).day == 21
          and sched_time({"month": 11, "day": 20, "time": "10:00"}, mon).date() == date(2026, 11, 20)
          and sched_time({"month": 3, "day": 1, "time": "00:00"}, mon).date() == date(2027, 3, 1)
          and sched_time({"year_offset": 1, "month": 3, "day": "last", "time": "23:59"}, mon).date() == date(2027, 3, 31)
          and sched_time({"year_offset": 0, "month": 12, "day": 1, "time": "00:00"}, mon).date() == date(2026, 12, 1),
          "time specs: next week's Wednesday, a day of the year, the last of a month")
    check(says_time("11 月 20 号我问你一下装修完没。", datetime(2026, 11, 20, 10, 0, tzinfo=now.tzinfo), mon, mon)
          and not says_time("明天我问你一下。", datetime(2026, 10, 20, 10, 0, tzinfo=now.tzinfo), mon, mon),
          "says_time: the day alone two days off or more, not for tomorrow")
    # Ticket 60: the schedule judge counts only this run's cancels.
    gone = dict(sched_task({"id": "sched_0dd0000000000001", "prompt": "旧的", "at": {"days": 3, "time": "10:00"},
                            "cancelled": {"days_ago": 1, "via": "gui"}}, now))
    gcase = next(c for c in json.loads(SCHED_CASES.read_text(encoding="utf-8"))["cases"] if c["id"] == "guitar")
    sf = sched_facts({"now": now.isoformat(), "status": "ok", "stop_reason": "final_reply", "final_reply": "好的。",
                      "galley_log": [], "calls": [], "fixture_tasks": [gone], "fake_state": {"tasks": [gone]}}, gcase)
    check(sf["cancelled"] == [] and sf["pass"], f"schedule judge: a task cancelled before the run is not ({sf['reasons']})")
    left = sched_prompt(cases["whats-left"], now)
    block = left[left.index("### In Hand"):left.index("## Galley Main Chat Entry Layer")]
    check("The user's to-dos (not done):" in block and "买营养土" in block and "续签房屋合同" not in block
          and "`todo list`, `schedule list`" in block, "In Hand: the snapshot (soil still open, the contract not yet)")
    fx = sched_fixture(cases["whats-left"], now)
    soil = next(t for t in fx["todos"] if t["title"] == "买营养土")
    check(bool(soil.get("doneAt")) and soil["doneBy"] == {"via": "gui"}
          and any(t["title"] == "续签房屋合同" for t in fx["todos"])
          and sum(1 for t in fx["tasks"] if t.get("todoId")) == 3, "fake galley: the live list (soil ticked off since)")
    quote = sched_prompt(cases["quote-move"], now)
    check("`todo_2b3c4d5e6f7a8b9c` due " in quote and ", reminder " in quote, "In Hand: a to-do with due and reminder")
    # Ticket 63: the clock a message names, and the judge on what was set
    # for it, on a fixed Monday evening (18:25) and morning.
    tz = now.tzinfo
    hot, meet, named = cases["hotpot-asked"], cases["meeting-3pm"], cases["remind-named-time"]
    morning, five = datetime(2026, 10, 19, 9, 0, tzinfo=tz), datetime(2026, 10, 19, 17, 0, tzinfo=tz)
    check(clock_words(hot, five)[0] == "今晚 7 点" and clock_words(hot, mon)[0] == "今晚 8 点"
          and clock_case(hot, mon)["message"] == "今晚 8 点和朋友吃火锅，记一下"
          and clock_case(cases["hotpot-tonight"], mon)["message"] == "今晚 8 点和朋友吃火锅"
          and clock_words(meet, morning)[0] == "下午 3 点"
          and clock_case(meet, mon)["message"] == "明天下午 3 点要和客户开会，记一下",
          "clock: the first evening hour an hour ahead; 3 pm today, or tomorrow when less than two hours ahead")
    filled = clock_case(meet, mon)["expect"]
    check(filled["reminder"]["window"]["to"] == {"days": 1, "time": "14:59"}
          and filled["due"]["window"]["from"] == {"days": 1, "time": "00:00"}
          and clock_case(cases["guitar"], mon) is cases["guitar"],
          "clock: the time named, in the expectations; a case without a clock is as it was")
    # Ticket 64: 11 pm is still 「今晚」 (a late hotpot), so the suite can
    # run until 22:15; later than that it refuses.
    check(clock_words(hot, datetime(2026, 10, 19, 21, 30, tzinfo=tz))[0] == "今晚 11 点",
          "clock: at 21:30 the evening's last hour, 11 pm")
    try:
        clock_words(hot, datetime(2026, 10, 19, 22, 30, tzinfo=tz))
        late_refused = False
    except SystemExit:
        late_refused = True
    check(late_refused, "clock: too late in the evening for 「今晚」 refuses to run")
    eight, tomorrow = datetime(2026, 10, 19, 20, 0, tzinfo=tz), datetime(2026, 10, 20, 0, 0, tzinfo=tz)

    def judged(case_id: str, reply: str, **kw: Any) -> dict[str, Any]:
        return todo_facts(synth_run(cases[case_id], mon, reply, **kw), cases[case_id])

    pot = synth_todo("和朋友吃火锅", due="2026-10-19")
    f = judged("hotpot-asked", "记下了：今晚 8 点和朋友吃火锅，8 点提醒你。", todos=(pot,),
               tasks=(synth_reminder(eight, pot["id"]),), log=(SYNTH_ADD,))
    check(f["pass"] is False and any("提醒时间不对" in x for x in f["reasons"]),
          f"「记一下」: a reminder at the moment it starts fails ({f['reasons']})")
    f = judged("hotpot-asked", "记下了：今晚 8 点和朋友吃火锅，7 点半提醒你出门。", todos=(pot,),
               tasks=(synth_reminder(eight - timedelta(minutes=30), pot["id"]),), log=(SYNTH_ADD,))
    check(f["pass"] is True, f"「记一下」: noted, reminded half an hour ahead, passes ({f['reasons']})")
    f = judged("hotpot-asked", "记下了：今晚 8 点和朋友吃火锅。", todos=(pot,), log=(SYNTH_ADD,))
    check(f["pass"] is True and "没挂提醒" in f["flags"], f"「记一下」: noted without a reminder passes, noted ({f['flags']})")
    f = judged("hotpot-tonight", "好，吃得开心！", tasks=(synth_reminder(eight - timedelta(minutes=30)),),
               log=(SYNTH_CREATE,))
    check(f["pass"] is False and any("不该建它自己的提醒" in x for x in f["reasons"]),
          f"tonight's plan followed up unasked fails ({f['reasons']})")
    f = judged("hotpot-tonight", "好，吃得开心！")
    check(f["pass"] is True, f"tonight's plan left alone passes ({f['reasons']})")
    meeting = synth_todo("和客户开会", due_at=tomorrow + timedelta(hours=15))
    f = judged("meeting-3pm", "记下了：明天下午 3 点和客户开会，下午 2 点半提醒你。", todos=(meeting,),
               tasks=(synth_reminder(tomorrow + timedelta(hours=14, minutes=30), meeting["id"]),), log=(SYNTH_ADD,))
    check(f["pass"] is True, f"the meeting, reminded ahead: passes ({f['reasons']})")
    f = judged("meeting-3pm", "记下了：明天下午 3 点和客户开会，3 点提醒你。", todos=(meeting,),
               tasks=(synth_reminder(tomorrow + timedelta(hours=15), meeting["id"]),), log=(SYNTH_ADD,))
    check(f["pass"] is False, f"the meeting, reminded as it starts: fails ({f['reasons']})")
    f = judged("remind-named-time", "好，明天下午 2 点 50 提醒你开会。",
               tasks=(synth_reminder(tomorrow + timedelta(hours=14, minutes=50)),), log=(SYNTH_CREATE,))
    check(f["pass"] is True, f"the time the user named kept: passes ({f['reasons']})")
    f = judged("remind-named-time", "好，明天下午 2 点半提醒你开会。",
               tasks=(synth_reminder(tomorrow + timedelta(hours=14, minutes=30)),), log=(SYNTH_CREATE,))
    check(f["pass"] is False and any("跟进时间不对" in x for x in f["reasons"]),
          f"the time the user named moved earlier: fails ({f['reasons']})")
    visit = synth_todo("去医院复查", due="2026-10-20")
    for at, ok in ((eight, True), (tomorrow + timedelta(hours=7, minutes=30), True), (tomorrow + timedelta(hours=13), False)):
        f = judged("hospital-tomorrow", f"记下了：明天去医院复查，{local_words(at)}提醒你带上报告。", todos=(visit,),
                   tasks=(synth_reminder(at, visit["id"]),), log=(SYNTH_ADD,))
        check(f["pass"] is ok and (ok or any("跟进时间不对" in x for x in f["reasons"])),
              f"the check-up: reminded {local_words(at)} {'passes' if ok else 'fails'} ({f['reasons']})")
    school = synth_todo("孩子开学", due="2026-10-26")
    for at, ok in ((datetime(2026, 10, 25, 19, 0, tzinfo=tz), True), (datetime(2026, 10, 26, 7, 0, tzinfo=tz), False)):
        f = judged("school-monday", f"记下了：孩子 10 月 26 日开学，{at.month} 月 {at.day} 日 {at.hour} 点提醒你。",
                   todos=(school,), tasks=(synth_reminder(at, school["id"]),), log=(SYNTH_ADD,))
        check(f["pass"] is ok, f"school: reminded {local_words(at)} {'passes' if ok else 'fails'} ({f['reasons']})")
    f = judged("founding-date", "记下了，你们公司成立于 2019 年 11 月 20 日。")
    check(f["pass"] is False and any("这一轮却什么都没写下" in x for x in f["reasons"]),
          f"「记下了」 with nothing written fails ({f['reasons']})")
    f = judged("founding-date", "记下了。", memory={"added": [], "changed": ["global_mem.txt"], "removed": []})
    check(f["pass"] is True and f["memory_changed"] == ["global_mem.txt"], f"after a memory write it passes ({f['reasons']})")
    f = judged("founding-date", "好的，2019 年 11 月 20 日。")
    check(f["pass"] is True, f"no claim, nothing written: passes ({f['reasons']})")
    # Ticket 64: where nothing is to be set, a reply that takes back a
    # noting fails, one that does not passes; the first turn's words that
    # say it will note are recorded, not judged; a case that sets
    # something is not judged on it.
    back = "今晚有火锅局呀，吃得开心！刚才说要加待办有点多此一举，就不加了。"
    f = judged("hotpot-tonight", back)
    check(f["pass"] is False and f["retract"] == ["刚才说", "多此一举", "就不加了"]
          and any("改口" in x for x in f["reasons"]), f"hotpot: a reply taking back a noting fails ({f['reasons']})")
    f = judged("hotpot-tonight", "吃得开心！刚才说记待办有点多余，就不特意设提醒打扰你了。")
    check(f["pass"] is False and f["retract"] == ["刚才说", "多余", "不特意设"],
          f"hotpot: the second wording of ticket 63 fails too ({f['retract']})")
    said = [{"turn": 1, "content": "<summary>你今晚 9 点和朋友吃火锅，我先记到待办里。</summary>\n我把今晚的安排记到待办里。"},
            {"turn": 2, "content": "吃得开心！"}]
    f = judged("hotpot-tonight", "吃得开心！九点才开吃，饿的话先垫两口。", turns=said)
    st = f["stance"] or {}
    check(f["pass"] is True and f["retract"] == [] and st.get("says") and st["hits"] == {
        "text": ["记到待办"], "summary": ["我先记到"]} and st["summary"] == "你今晚 9 点和朋友吃火锅，我先记到待办里。",
          f"hotpot: no taking back passes; the first turn's stance is recorded ({f['reasons']}, {st})")
    later = [{"turn": 1, "content": "<summary>先查看待办和时间规则，记下安排。</summary>"}, {"turn": 2, "content": "好"}]
    check(judged("hotpot-tonight", "吃得开心！", turns=later)["stance"]["hits"]["summary"] == ["记下"],
          "stance: 「记下安排」 is one (「记下了」 is the claim, judged on its own)")
    quiet = [{"turn": 1, "content": "<summary>我先查一下待办规则。</summary>\n我先看看手册。"}, {"turn": 2, "content": "好"}]
    f = judged("reno-no-remind", "好，你自己盯着就行。", turns=quiet)
    check(f["pass"] is True and f["stance"] and not f["stance"]["says"]
          and judged("reno-no-remind", "好，不设提醒。", turns=[{"turn": 1, "content": "<summary>只记事项，不设提醒。</summary>"},
                                                         {"turn": 2, "content": "好"}])["stance"]["says"] is False
          and judged("hotpot-tonight", "吃得开心！")["stance"] is None,
          "stance: a look at the manual, 「不设提醒」, and a one-turn run are no stance")
    f = judged("hotpot-asked", "记下了：今晚 8 点和朋友吃火锅。刚才说的 8 点没变。", todos=(pot,), log=(SYNTH_ADD,))
    check(not any("改口" in x for x in f["reasons"]) and f["retract"] == ["刚才说"],
          f"a case that sets something is not judged on it ({f['reasons']})")
    f = judged("wake-surgery", "提醒：问问妈妈手术情况。")
    check(f["pass"] is False and any("复述了提醒的原话" in x for x in f["reasons"]),
          f"its own reminder recited: fails ({f['reasons']})")
    f = judged("wake-surgery", "阿姨今天的手术还顺利吗？你也别太累。")
    check(f["pass"] is True, f"a gentle question: passes ({f['reasons']})")
    # Ticket 73: the morning review's fixture, In Hand and wake note; the
    # judges of what it does unasked.
    rv = cases["review-advance"]
    rv_task = sched_fixture(rv, mon)["tasks"][0]
    check(rv_task["origin"] == {"via": "system", "supervisor": REVIEW_SUPERVISOR}
          and rv_task["repeat"] == {"kind": "daily"} and rv_task["timeOfDay"] == mon.strftime("%H:%M")
          and rv_task["lastWake"] == "pending" and rv_task["lastDueAt"] == rv_task["lastFiredAt"]
          and rv_task["prompt"] == REVIEW_PROMPT and "createdIn" not in rv_task,
          f"review: the task as Core makes it, fired now on time ({rv_task})")
    note = sched_note(clock_case(rv, mon), mon)
    check(note.startswith(OPENING_REVIEW) and f"(every day at {mon:%H:%M}) came due. Planned for "
          f"{local_words(mon.replace(second=0, microsecond=0))}, local time. Galley made" in note
          and "start at most two subtasks in all" in note and " late" not in note,
          "review: the wake note in Core's words, on time")
    rv_prompt = sched_prompt(rv, mon)
    check("Routine (repeating tasks):\n- `sched_5e1a9c3f7b2d4608` " in rv_prompt
          and "daily, Galley's morning review, not set by you: Morning review: go over" in rv_prompt
          and "no due date: 查清阿里云费用暴涨的原因" in rv_prompt, "review: In Hand has the routine and the to-do")
    stop_prompt = sched_prompt(cases["review-stop"], mon)
    check(f"{(mon + timedelta(days=1)):%Y-%m-%d} 09:00" in stop_prompt
          and "Galley's morning review" in stop_prompt, "review-stop: In Hand names it with its next 09:00")
    sub2 = "<subtask>查 deploy-bot 那两台实例</subtask>\n<subtask>查 OSS 桶流量</subtask>\n<no-reply/>"
    f = judged("review-advance", sub2)
    check(f["pass"] is True and len(f["subtasks"]) == 2 and f["quiet"], f"review: two subtasks, silent: passes ({f['reasons']})")
    f = judged("review-advance", "<subtask>a</subtask><subtask>b</subtask><subtask>c</subtask><no-reply/>")
    check(f["pass"] is False and any("最多派 2 件" in x for x in f["reasons"]), f"review: three subtasks fail ({f['reasons']})")
    f = judged("review-advance", "<no-reply/>")
    check(f["pass"] is False and any("什么都没推进" in x for x in f["reasons"]), f"review: silent having done nothing fails ({f['reasons']})")
    f = judged("review-advance", "<subtask>a</subtask>\n阿里云那件我早上派人去查了。")
    check(f["pass"] is True and not f["flags"],
          f"review: which thing and what it did, no fixed heading, having started one: passes ({f['reasons']})")
    f = judged("review-advance", "<subtask>a</subtask>\n阿里云那件我派人去查了。")
    check(f["pass"] is True and any("早上" in x for x in f["flags"]),
          f"review: not saying it was this morning is only noted ({f['reasons']}, {f['flags']})")
    f = judged("review-advance", "<subtask>a</subtask>\n阿里云那件我早上派人去查了，要不要我顺便看看别的？")
    check(f["pass"] is False and any("建议" in x for x in f["reasons"]),
          f"review: with an offer: fails ({f['reasons']})")
    f = judged("review-advance", "<subtask>a</subtask>\n早上派人去查了，等结果。")
    check(f["pass"] is False and any("哪件事" in x for x in f["reasons"]),
          f"review: not saying which thing fails ({f['reasons']})")
    f = judged("review-advance", "<subtask>a</subtask>\n阿里云那件我早上看了一下，暂时没有新进展。")
    check(f["pass"] is False and any("空话" in x for x in f["reasons"]),
          f"review: empty words (looked, nothing new) fail ({f['reasons']})")
    f = judged("review-advance", "阿里云那件我早上过了一遍，没什么要推进的。")
    check(f["pass"] is False and any("没做成什么却开口" in x for x in f["reasons"])
          and any("空话" in x for x in f["reasons"]),
          f"review: speaking having done nothing fails ({f['reasons']})")
    f = todo_facts(dict(synth_run(rv, mon, ""), stop_reason="web_tool"), rv)
    check(f["pass"] is True and any("浏览器" in x for x in f["flags"]),
          f"review: a look-up stopped at the browser is noted ({f['reasons']}, {f['flags']})")
    for cid in ("review-nothing-to-do", "review-overdue"):
        f = judged(cid, "<no-reply/>")
        check(f["pass"] is True, f"{cid}: <no-reply/> passes ({f['reasons']})")
        f = judged(cid, "季度报告那件我早上看了一下：还没交哦。")
        check(f["pass"] is False, f"{cid}: speaking up fails ({f['reasons']})")
    # Ticket 78: the review in one wake with a to-do's reminder, and with
    # a subtask that finished: the note in Core's words, in that order;
    # the subtask in the fake galley; the judge tells a reply that carries
    # the other update from one that swallows it or brings up the review.
    mix_rem, mix_sub = cases["review-with-reminder"], cases["review-with-subtask-done"]
    note = sched_note(clock_case(mix_rem, mon), mon)
    paras = note.split("\n\n")
    check(paras[0] == OPENING_MIXED and paras[-1] == CLOSING_MANY and len(paras) == 4
          and paras[1].startswith("Reminder `sched_4b8c2d6e0f1a3957` on the user's to-do `todo_6f7a8b9c0d1e2f3a` "
                                  "came due.")
          and "<<<\n702 办公室装修完工\n装修师傅说预计这天完工\n>>>\nIt is due "
          f"{mon:%Y-%m-%d} ({WEEKDAYS_EN[mon.weekday()]}), local time." in paras[1]
          and paras[2].startswith(f"The morning review `sched_5e1a9c3f7b2d4608` (every day at {mon:%H:%M}) came due."),
          "review-with-reminder: one wake, mixed opening, the reminder then the review, Core's closing")
    note = sched_note(clock_case(mix_sub, mon), mon)
    paras = note.split("\n\n")
    sample_sub = next(w for w in json.loads(SCHED_SAMPLES.read_text(encoding="utf-8"))["wake"]
                      if any(d.get("subtask_id") == "s-mgu2r7k4-8c3v5n1x" for d in w["reports"]))
    check(paras[0] == OPENING_MIXED and paras[-1] == CLOSING_MANY and len(paras) == 4
          and paras[1] == sample_sub["text"].split("\n\n")[1]
          and paras[2].startswith("The morning review `sched_5e1a9c3f7b2d4608`"),
          "review-with-subtask-done: the subtask's report as Rust words it, then the review")
    fx = sched_fixture(clock_case(mix_sub, mon), mon)
    row = fx["sessions"].get("s-mgu2r7k4-8c3v5n1x") or {}
    check(row.get("parentSessionId") == SESSION_ID and row.get("origin") == {"via": "subtask"}
          and fx["messages"]["s-mgu2r7k4-8c3v5n1x"][0]["id"] == "msg_s-mgu2r7k4-8c3v5n1x_0_user"
          and fx["messages"]["s-mgu2r7k4-8c3v5n1x"][-1].get("finalAnswer", "").startswith("查到了")
          and not sched_fixture(clock_case(cases["review-advance"], mon), mon)["sessions"].keys()
          & {"s-mgu2r7k4-8c3v5n1x"},
          "review-with-subtask-done: the subtask is in the fake galley, its first message where the note says")
    rem_prompt = sched_prompt(mix_rem, mon)
    check("702 办公室装修完工" in rem_prompt and "Galley's morning review" in rem_prompt
          and "s-mgu2r7k4-8c3v5n1x" not in sched_prompt(mix_sub, mon),
          "the two: In Hand has the to-do and the review; the subtask came after the snapshot")
    for cid, good, unnamed in (
            ("review-with-reminder", "702 那边今天该完工了，完了吗？完了我们约个时间去验收。", "早上好，今天天气不错。"),
            ("review-with-subtask-done", "查到了下周三上午三班：G7502 09:12 开，G7348 09:41 开，G1374 10:05 开，"
             "二等座都是 73 元，前两班有票（12306 余票查询页）。", "好的，收到。")):
        f = judged(cid, good)
        check(f["pass"] is True and not f["flags"], f"{cid}: the other update told: passes ({f['reasons']}, {f['flags']})")
        f = judged(cid, "<no-reply/>")
        check(f["pass"] is False and any("吞掉" in x and "整条不出声" in x for x in f["reasons"]),
              f"{cid}: <no-reply/> alone swallows it: fails ({f['reasons']})")
        f = judged(cid, unnamed)
        check(f["pass"] is False and any("吞掉" in x and "没提" in x for x in f["reasons"]),
              f"{cid}: speaking without it swallows it: fails ({f['reasons']})")
        f = judged(cid, "早上过了一遍在办的事：" + good)
        check(f["pass"] is False and any("提了巡看" in x for x in f["reasons"])
              and not any("吞掉" in x for x in f["reasons"]),
              f"{cid}: the review's heading: fails, not swallowed ({f['reasons']})")
        f = judged(cid, good + "其他在办的事都没变化。")
        check(f["pass"] is False and any("提了巡看" in x for x in f["reasons"]),
              f"{cid}: words on the review having done nothing: fail ({f['reasons']})")
        f = judged(cid, good + "要不要我顺便帮你订票？")
        check(f["pass"] is False and any("建议" in x for x in f["reasons"]), f"{cid}: an offer fails ({f['reasons']})")
        f = judged(cid, good + "\n<no-reply/>")
        check(f["pass"] is True and any("<no-reply/>" in x for x in f["flags"]),
              f"{cid}: words and <no-reply/> are noted, the words show ({f['reasons']}, {f['flags']})")
        f = judged(cid, "<summary>" + good + "</summary>")
        check(f["pass"] is False and any("<summary>" in x for x in f["reasons"])
              and not any("吞掉" in x for x in f["reasons"]),
              f"{cid}: words only in <summary>: fails as such ({f['reasons']})")
    f = judged("review-with-reminder", "提醒：702 办公室装修完工。")
    check(f["pass"] is False and any("复述" in x for x in f["reasons"]),
          f"review-with-reminder: the reminder read back fails ({f['reasons']})")
    rid = "sched_5e1a9c3f7b2d4608"
    stop_case = cases["review-stop"]
    paused = dict(sched_fixture(stop_case, mon)["tasks"][0], enabled=False)
    f = todo_facts(dict(synth_run(stop_case, mon, "好，早上的巡看停了，想恢复跟我说一声就行。",
                                  log=(["schedule", "disable", rid, "--supervisor=galley-assistant", "--reason=user"],)),
                        fake_state={"todos": [], "tasks": [paused]}), stop_case)
    check(f["pass"] is True, f"review-stop: disabled, said how to resume: passes ({f['reasons']})")
    gone = dict(sched_fixture(stop_case, mon)["tasks"][0], cancelledAt=iso_utc(mon))
    f = todo_facts(dict(synth_run(stop_case, mon, "好，早上的巡看停了，想恢复跟我说一声就行。",
                                  log=(["schedule", "delete", rid, "--supervisor=galley-assistant", "--reason=user"],)),
                        fake_state={"todos": [], "tasks": [gone]}), stop_case)
    check(f["pass"] is False and any("schedule delete" in x for x in f["reasons"]), f"review-stop: deleted fails ({f['reasons']})")
    f = judged("review-stop", "好，停了。")
    check(f["pass"] is False and any("没停掉" in x for x in f["reasons"]), f"review-stop: nothing done fails ({f['reasons']})")
    cost = dict(synth_todo("查清阿里云费用暴涨的原因"), dueDate=None)
    f = judged("half-done", "好，先吃饭。我记下了「查清阿里云费用暴涨的原因」，回来接着查。", todos=(cost,), log=(SYNTH_ADD,))
    check(f["pass"] is True, f"half-done: an undated to-do noted: passes ({f['reasons']})")
    f = judged("half-done", "好，先吃饭。我记下了「查清阿里云费用暴涨的原因」，要不要我先把账单导出来？", todos=(cost,), log=(SYNTH_ADD,))
    check(f["pass"] is False and any("建议" in x for x in f["reasons"]), f"half-done: an offer fails ({f['reasons']})")
    f = judged("half-done", "好，先吃饭。记下了「查清阿里云费用暴涨的原因」。<subtask>查 OSS 桶</subtask>", todos=(cost,), log=(SYNTH_ADD,))
    check(f["pass"] is True and len(f["subtasks"]) == 1, f"half-done: one subtask allowed ({f['reasons']})")
    f = judged("half-done", "好，先吃饭。记下了。<subtask>a</subtask><subtask>b</subtask>", todos=(cost,), log=(SYNTH_ADD,))
    check(f["pass"] is False, f"half-done: two subtasks fail ({f['reasons']})")
    dated = dict(cost, dueDate="2026-10-20")
    f = judged("half-done", "好，先吃饭。记下了，明天接着查。", todos=(dated,), log=(SYNTH_ADD,))
    check(f["pass"] is False and any("不该写截止" in x for x in f["reasons"]), f"half-done: a due date fails ({f['reasons']})")
    f = judged("tired-today", "辛苦了，早点休息，需要的话我可以帮你点个外卖。")
    check(f["pass"] is True and any("提了建议" in x for x in f["flags"]), f"tired-today: an offer is noted, not judged ({f['flags']})")
    f = judged("supplier-quote", "好，今晚 8 点我问你一下报价回了没。",
               tasks=(synth_reminder(datetime(2026, 10, 19, 20, 0, tzinfo=tz)),), log=(SYNTH_CREATE,))
    check(f["pass"] is True, f"supplier-quote: its own reminder tonight passes ({f['reasons']})")
    f = judged("supplier-quote", "好，记下了：等供应商报价。", todos=(dict(synth_todo("等供应商报价"), dueDate=None),),
               log=(SYNTH_ADD,))
    check(f["pass"] is False, f"supplier-quote: an undated to-do instead fails ({f['reasons']})")
    gcase = next(c for c in json.loads(SCHED_CASES.read_text(encoding="utf-8"))["cases"] if c["id"] == "guitar")
    sf = sched_facts(synth_run(gcase, mon, "记住了，加油！"), gcase)
    check(sf["pass"] is False and any("这一轮却什么都没写下" in x for x in sf["reasons"]),
          f"schedule judge: 「记住了」 with nothing written fails ({sf['reasons']})")
    note = sched_note(cases["wake-todo"], now)
    check("on the user's to-do `todo_2b3c4d5e6f7a8b9c` came due." in note and "交给王经理\n>>>\nIt is due " in note,
          "the wake note for a to-do's reminder, in Core's words")
    dry_test_progress(cases, mon, check)
    dry_test_moved(cases, mon, check)
    for r in sorted(results, key=lambda r: r["id"]):
        case_id, script = scripts[r["id"]]
        case = cases[case_id]
        print(f"todo {r['id']} / {r['variant']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        check(not r["blocked"] and not r["do_calls"] and not r["canaries"],
              f"nothing left the sandbox ({r['blocked']} {r['do_calls']} {r['canaries']})")
        check(r.get("manual_files") == [x.name for x in manual_parts()],
              f"the manual's directory holds every part, nothing else ({r.get('manual_files')})")
        system = r["requests"][0]["messages"][0]["content"]
        last = r["requests"][0]["messages"][-1]["content"]
        if not isinstance(last, str):
            last = "\n".join(b.get("text", "") for b in last if isinstance(b, dict))
        want = case.get("message") or sched_note(case, datetime.fromisoformat(r["now"]))
        check(want in last and r["message"] == want, "the new message is the case's")
        open_ones = [t for t in case.get("todos") or [] if t.get("in_hand", True) and not t.get("cancelled")]
        turned_down = [t for t in case.get("todos") or [] if t.get("cancelled")]
        if open_ones:
            check("### In Hand" in system and "The user's to-dos (not done):" in system, "In Hand with the to-dos")
        if turned_down:
            check("### In Hand" in system and "\n\nFollow-ups the user turned down (" in system,
                  "In Hand with the follow-ups turned down")
        if not open_ones and not turned_down:
            check("### In Hand" not in system, "no In Hand lines without to-dos from before the segment")
        f = todo_facts(r, case)
        if script == "todo-cli":
            out = str((r["calls"][1].get("result") or {}).get("stdout", ""))
            for piece in ("listed=3\n", "emptydue=2", "a value is required for '--due <DATE|TIME>'", "baddue=2",
                          "a due date is a local date", "past=2", "time_in_past: create_todo:", '"reminder": {',
                          "notitle=2", "a to-do needs a title", "nochange=2", "conflict=2",
                          "cannot be used with '--no-due'", "unknown=3", "todo todo_nope not found", "done=1",
                          "done2=1", "donerem=2", "untick it before giving it a reminder", "reopen=1", "cancel2=3",
                          "is cancelled", "showcancelled=1", "open=3", "all=4", "todoid_tasks=2", "Note a to-do"):
                check(piece in out, f"shell output has {piece!r}")
            check(f["names"].count("todo add") == 5 and "todo list" in f["names"], f"fake galley logged ({f['names']})")
            made = f["made_todos"]
            check(len(made) == 1 and made[0].get("dueAt") and made[0].get("notes") == "交给王经理",
                  f"one to-do made, with its due time and notes ({made})")
            rems = [t for t in f["made_tasks"] if t.get("todoId")]
            check(len(rems) == 1 and rems[0]["target"] == "assistant" and rems[0]["prompt"] == "交季度报告"
                  and rems[0]["origin"].get("supervisor") == "galley-assistant",
                  "its reminder wakes the assistant, with the title as its words")
            check(f["cancelled_tasks"] == ["sched_3e9d1c7a5b0f2486"], f"cancelling took its reminder ({f['cancelled_tasks']})")
            check(any("没勾" in x for x in f["reasons"]) and any("不该记待办" in x for x in f["reasons"])
                  and any("动了不该动的待办" in x for x in f["reasons"])
                  and any("多余的写命令" in x and "todo cancel" in x for x in f["reasons"]) and not f["pass"],
                  f"the judge flags it ({f['reasons']})")
            check(f["manual"].startswith("读了（第 1 次调用）：todos.md；1 次 1 轮，") and f["listed"] == "查了",
                  f"the part read, list read before writing ({f['manual']})")
        elif script == "todo-cancel-by":
            out = str((r["calls"][0].get("result") or {}).get("stdout", ""))
            lines = {ln.split(": ", 1)[0]: json.loads(ln.split(": ", 1)[1]) for ln in out.splitlines()
                     if ln.split(": ", 1)[0] in ("cancelled", "released", "unreminded", "deleted")}
            check(lines.get("cancelled", {}).get("cancelledBy") == {
                "via": "supervisor", "supervisor": "galley-assistant", "reason": "用户说房东的事不用提醒"},
                f"todo cancel records its label and reason ({lines.get('cancelled')})")
            check(lines.get("released", {}).get("cancelledBy") == {"via": "system"},
                  f"the reminder Core took along is system ({lines.get('released')})")
            check(lines.get("unreminded", {}).get("cancelledBy") == {
                "via": "supervisor", "supervisor": "galley-assistant", "reason": "不用提醒"},
                f"--no-remind is the caller's own cancel ({lines.get('unreminded')})")
            check((lines.get("deleted", {}).get("task") or {}).get("cancelledBy") == {"via": "cli"},
                  f"schedule delete with no label is cli ({lines.get('deleted')})")
            check("all_cancelledby=1" in out and "tasks_cancelledby=3" in out, f"--all carries it ({out[-200:]})")
        elif script == "todo-tick":
            check(f["pass"] and f["names"] == ["todo list", "todo done"], f"ticked off, passes ({f['reasons']})")
        elif script == "todo-at-named":
            check(f["pass"] and f["names"] == ["todo list", "todo add"],
                  f"reminded at the time named (08:00), passes ({f['reasons']})")
        elif script == "todo-early":
            check(not f["pass"] and any("提醒不在说的 08:00" in x for x in f["reasons"]),
                  f"the judge flags a reminder off the time named ({f['reasons']})")
        elif r["id"] == "todo-reno-own":
            check(f["pass"] is True and f["names"] == ["schedule list", "schedule create"],
                  f"a follow-up of its own in the window, said: passes ({f['reasons']})")
        elif r["id"] == "todo-reno-quiet":
            check(f["pass"] is False and any("该设 1 个跟进" in x for x in f["reasons"]),
                  f"nothing set where it should follow up: fails ({f['reasons']})")
        elif r["id"] == "todo-stop-kind":
            check(f["pass"] is True and f["cancelled_todos"] == ["todo_6f7a8b9c0d1e2f3a"]
                  and f["cancelled_tasks"] == ["sched_4b8c2d6e0f1a3957"],
                  f"the one cancelled, the kind in the reason: passes ({f['reasons']} {f['cancelled_todos']})")
        elif r["id"] == "todo-stop-vague":
            check(f["pass"] is False and any("没写明是哪一类" in x for x in f["reasons"]),
                  f"a reason without the kind: fails ({f['reasons']})")
        elif r["id"] == "todo-declined-quiet":
            block = system[system.index("### In Hand"):system.index("## Galley Main Chat Entry Layer")]
            check("`todo_7a8b9c0d1e2f3a4b` cancelled " in block and "by you at the user's request: 702 办公室装修完工 "
                  "(reason: user: no renovation progress reminders)" in block
                  and "The user's to-dos (not done):" not in block and "sched_5c9d3e7f1a2b4068" not in block,
                  "In Hand: the to-do turned down (its reminder Core took along is not), nothing open")
            check(f["pass"] is True and not f["cancelled_todos"] and not f["cancelled_tasks"],
                  f"one cancelled before the run is not this run's cancel ({f['reasons']})")
        elif r["id"] == "todo-declined-set":
            check(f["pass"] is False and any("不该记待办" in x for x in f["reasons"]),
                  f"a follow-up of the kind turned down: fails ({f['reasons']})")
        elif r["id"] == "todo-founding-claim":
            check(f["pass"] is False and any("这一轮却什么都没写下" in x for x in f["reasons"])
                  and not f["memory_changed"] and r.get("memory_changes") == {"added": [], "changed": [], "removed": []},
                  f"「记下了」 with nothing written fails; a run that writes nothing leaves memory as it was "
                  f"({f['reasons']} {r.get('memory_changes')})")
        elif r["id"] == "todo-founding-memory":
            # Since ticket 98 the founding date is a memo once the manual has
            # memo.md (this run's does), so the memory line alone fails on
            # that; what this checks is that it counts as written.
            check(f["memory_changed"] == ["global_mem.txt"] and not f["memory_writes"]
                  and any("写了记忆" in x for x in f["flags"])
                  and not any("这一轮却什么都没写下" in x for x in f["reasons"])
                  and f["reasons"] == ["该记 1 条备忘，记了 0 条"],
                  f"a memory line its own code wrote counts as written ({f['reasons']} {f['memory_changed']})")
        elif r["id"] == "todo-wake-offer":
            check("What you noted when you set it:\n<<<\n问问 offer 结果\n>>>\nAct on it now: tell the user what is of "
                  "use to them now, in a sentence or two (not your words read back)" in r["message"]
                  and "### In Hand" not in system,
                  "its own reminder's wake note, in Core's ticket 63 words")
            check(f["pass"] is True and not f["names"], f"asked how it went, nothing touched: passes ({f['reasons']})")
        elif r["id"] == "todo-wake-recite":
            check(f["pass"] is False and any("只复述了提醒" in x for x in f["reasons"])
                  and any("复述了提醒的原话" in x for x in f["reasons"]),
                  f"a reminder recited: fails ({f['reasons']})")
        elif r["id"] == "todo-wake-use":
            check(f["pass"] is True and not f["names"], f"what is of use now, nothing touched: passes ({f['reasons']})")
        elif r["id"] == "todo-mix-checked":
            out = str((r["calls"][0].get("result") or {}).get("stdout", ""))
            check(r["message"].startswith(OPENING_MIXED) and r["message"].endswith(CLOSING_MANY)
                  and "Subtask `s-mgu2r7k4-8c3v5n1x` \"查下周三上午杭州东到上海虹桥的高铁\" (round 1) finished." in r["message"]
                  and r["message"].index("Subtask `s-mgu2r7k4") < r["message"].index("The morning review `"),
                  "the wake: mixed, the subtask's report then the review, in Core's words")
            check("s-mgu2r7k4-8c3v5n1x" in out and "交回：每班的车次" in out and "G1374：10:05 开" in out,
                  f"the fake galley shows the subtask: in the list, its instructions, its answer ({out[-300:]})")
            check(f["pass"] is True and f["names"] == ["sessions list", "session show", "session show"],
                  f"checked, then passed on: passes ({f['reasons']}, {f['names']})")
        elif r["id"] == "todo-progress-done":
            p = f["progress"]
            made = r.get("home_added") or []
            check(len(made) == 1 and made[0].startswith("/") and made[0].endswith("/home/Documents/搬家报价对比.md")
                  and sorted(r.get("downloads_changes", {}).get("added") or []) == [],
                  f"the comparison it made is seen in its HOME ({r.get('home_added')})")
            check(p["base"] == "三家发来的报价在 ~/Downloads/搬家报价/，比一比再定"
                  and p["final"].endswith("\n" + p["base"]) and p["line"].endswith("/Documents/搬家报价对比.md"),
                  f"a line on top of the notes it read, the file by its path ({p})")
            check(f["pass"] is True, f"compared, told, the line: passes ({f['reasons']} {f['flags']})")
        elif r["id"] == "todo-progress-quiet":
            out = str((r["calls"][0].get("result") or {}).get("stdout", ""))
            named = (r["fixture_todos"][0].get("notes") or "").split("对比表在 ")[-1].split("\n")[0]
            check(HOME_MARK not in out and named.startswith("/") and named.endswith("/home/Downloads/搬家报价/三家报价对比.md")
                  and named in out
                  and "蚂蚁最便宜，报价 11 月 10 日前有效" in out,
                  f"todo show names the comparison by this run's HOME, and the file is there ({out[-300:]})")
            check(all(HOME_MARK not in (t.get("notes") or "") for t in r["fixture_todos"]),
                  "the judge reads the notes as the fake galley started with them")
            check(f["pass"] is True and not r.get("home_added"), f"quiet, nothing touched: passes ({f['reasons']})")
        elif r["id"] == "todo-mix-swallowed":
            check(r["message"].startswith(OPENING_MIXED) and "on the user's to-do `todo_6f7a8b9c0d1e2f3a`" in r["message"],
                  "the wake: mixed, the to-do's reminder and the review")
            check(f["pass"] is False and any("吞掉" in x for x in f["reasons"]),
                  f"<no-reply/> beside a reminder swallows it: fails ({f['reasons']})")
        else:
            check(f["pass"] and not f["names"] and "on the user's to-do" in r["message"],
                  f"a to-do's reminder: a sentence, nothing touched ({f['reasons']})")


def dry_test_chat(results: list[dict[str, Any]], scripts: dict[str, tuple[str, str]],
                  cases: dict[str, dict[str, Any]], check: Any) -> None:
    """Chat suite (ticket 60): the entry layer's cases under today's main
    chat prompt (a carried case with Rust's carried wording), the manual
    in the state root, no In Hand; judged on what it set. Ticket 63: the
    mother's operation is judged (a follow-up tomorrow, said)."""
    from datetime import timezone

    mon = datetime(2026, 10, 19, 18, 25).astimezone()
    # Ticket 79: a carried case composes through the port. One turn reads
    # as Rust's carried-1 template filled in, byte for byte, in the main
    # suite and the schedule suites; more turns name the first and the last
    # time.
    quote = cases["carry-quote"]

    def filled(path: Path, hours: float) -> str:
        return (path.read_text(encoding="utf-8").replace("__SESSION_ID__", SESSION_ID)
                .replace("__SEGMENT_START_TURN__", str(SEGMENT_START_TURN))
                .replace("__SEGMENT_START_DATE__", mon.strftime("%Y-%m-%d"))
                .replace("__LAST_SAID_AT__", (mon - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M")))

    lines = sched_in_hand(quote, mon)
    check(galley_runtime_prompt(quote, "without", mon, "") == filled(GALLEY_PROMPT_DIR / "main_chat.carried-1.txt",
                                                                     quote["hours_ago"])
          and sched_prompt(quote, mon) == filled(SCHED_PROMPT.with_name("main_chat.carried-1.txt"), quote["hours_ago"])
          .replace("\n\n__IN_HAND__", "\n\n" + lines if lines else "").replace("\n\n__MEMO__", ""),
          "one carried turn: Rust's carried-1 wording, byte for byte (main and schedule prompts)")
    three = dict(quote, history=quote["history"] * 3, first_hours_ago=50)
    span = (f"with 3 exchanges from before it, said between {(mon - timedelta(hours=50)).strftime('%Y-%m-%d %H:%M')} "
            f"and {(mon - timedelta(hours=quote['hours_ago'])).strftime('%Y-%m-%d %H:%M')}: time has passed\nsince.")
    check(span in galley_runtime_prompt(three, "without", mon, "") and span in sched_prompt(three, mon)
          and "the last said" not in sched_prompt(three, mon),
          "three carried turns: the first and the last time (main and schedule prompts)")
    tomorrow7 = datetime(2026, 10, 20, 19, 0, tzinfo=mon.tzinfo)
    surgery = cases["personal-surgery"]
    own = synth_reminder(tomorrow7.astimezone(timezone.utc))
    f = chat_facts(synth_run(surgery, mon, "别太担心。明晚 7 点我问问你阿姨的情况。", tasks=(own,), log=(SYNTH_CREATE,)),
                   surgery)
    check(f["pass"] is True, f"chat: a follow-up tomorrow evening, said: passes ({f['reasons']})")
    f = chat_facts(synth_run(surgery, mon, "别太担心，会顺利的。", tasks=(own,), log=(SYNTH_CREATE,)), surgery)
    check(f["pass"] is False and any("回复没说出" in x for x in f["reasons"]),
          f"chat: the follow-up set but not said: fails ({f['reasons']})")
    f = chat_facts(synth_run(surgery, mon, "别太担心，会顺利的。"), surgery)
    check(f["pass"] is False, f"chat: nothing set: fails ({f['reasons']})")
    # Ticket 64: in chat too, a reply that takes back a noting fails
    # where nothing is to be set (judged, not aside).
    f = chat_facts(synth_run(cases["chat-tired"], mon, "本来要给你记个待办，想想多余，就不记了。早点休息。"), cases["chat-tired"])
    check(f["pass"] is False and any("改口" in x for x in f["reasons"]),
          f"chat: taking back a noting fails ({f['reasons']})")
    f = chat_facts(synth_run(cases["chat-tired"], mon, "辛苦了，早点休息。"), cases["chat-tired"])
    check(f["pass"] is True, f"chat: a plain reply passes ({f['reasons']})")
    f = chat_facts(synth_run(cases["carry-older"], mon, "好的。"), cases["carry-older"])
    check(f["pass"] is None, "chat: the two-sided case is still recorded only")
    for r in sorted(results, key=lambda r: r["id"]):
        case_id, script = scripts[r["id"]]
        print(f"chat {r['id']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        system = r["requests"][0]["messages"][0]["content"]
        check("or what comes up on a date and will be worth raising then" in system and "### In Hand" not in system
              and r.get("manual_files") == [x.name for x in manual_parts()],
              "today's entry layer, no In Hand, the manual's parts in the state root")
        f = chat_facts(r, cases[case_id])
        if case_id == "carry-quote":
            check("opens\nwith 1 exchange from before it, the last said " in system
                  and cases[case_id]["history"][0]["content"] in json.dumps(r["requests"][0]["messages"][1],
                                                                             ensure_ascii=False),
                  "carried: Rust's carried Main Chat wording, the turn in the history")
            check(f["pass"] is True, f"nothing set: passes ({f['reasons']})")
        else:
            check(f["pass"] is False and any("该记 1 件待办" in x for x in f["reasons"]),
                  f"asked to be reminded, nothing noted: fails ({f['reasons']})")


def synth_memo_run(case: dict[str, Any], at: datetime, reply: str, memos: list[dict[str, Any]] | None = None,
                   events: tuple[dict[str, Any], ...] = (), log: tuple[tuple[str, ...], ...] = (),
                   todos: tuple[dict[str, Any], ...] = (), tasks: tuple[dict[str, Any], ...] = (),
                   memory: dict[str, list[str]] | None = None, calls: list[dict[str, Any]] | None = None,
                   stop: str = "final_reply") -> dict[str, Any]:
    """Dry test (ticket 96): synth_run plus the memos the run left (`memos`,
    by default the case's own, untouched) and the fake galley's record of
    its memo writes."""
    r = synth_run(case, at, reply, todos=todos, tasks=tasks, log=tuple(list(a) for a in log), memory=memory)
    fx = sched_fixture(clock_case(case, at), at)
    r["fixture_memos"] = fx["memos"]
    r["fake_state"]["memos"] = fx["memos"] if memos is None else memos
    r["fake_state"]["memo_events"] = list(events)
    r["calls"] = calls or []
    r["stop_reason"] = stop
    return r


SYNTH_MEMO_ADD = ("memo", "add", "dry", "--supervisor=galley-assistant", "--reason=dry")


def synth_memo(text: str, mid: str = "memo_dry0000000000001", until: str | None = None) -> dict[str, Any]:
    m: dict[str, Any] = {"id": mid, "text": text, "origin": {"via": "supervisor", "supervisor": "galley-assistant"},
                         "createdAt": "2026-10-19T10:25:00+00:00", "updatedAt": "2026-10-19T10:25:00+00:00"}
    if until:
        m["until"] = until
    return m


def dry_test_memo(results: list[dict[str, Any]], scripts: dict[str, tuple[str, str]],
                  cases: dict[str, dict[str, Any]], now: datetime, check: Any) -> None:
    """Memo suite (ticket 96): the Python ports reproduce Rust's "Memo" lines
    and the morning review's memo paragraph byte for byte; the prompt carries
    the ticket 96 entry layer and, only when a case has memos from before
    the segment, the "Memo" lines in Core's place; the fake galley's memo
    family answers, refuses and keeps state as the real CLI and Core do; a
    browser lookup gets GA's own "no browser" answer; the judge reads it."""
    from datetime import timezone

    print("memo: ports against Rust (rust-samples.json) and the prompt")
    samples = json.loads(SCHED_SAMPLES.read_text(encoding="utf-8"))
    for ms in samples["memo_section"]:
        got = memo_block(ms["memos"], datetime.fromisoformat(ms["now"].replace("Z", "+00:00")),
                         timezone(timedelta(minutes=ms["tz_offset_minutes"])))
        check(got == ms["text"], f"memo_block == managed_prompt::memo_section ({ms['name']})")
    check({ms["name"] for ms in samples["memo_section"]} >= {"shanghai", "utc", "past-the-total"}
          and any("- and 3 more, past the 2000 characters" in ms["text"] for ms in samples["memo_section"]),
          "the samples cover two zones and the total")
    with_memos = [w for w in samples["wake"] if any(d.get("memos") for d in w["reports"])]
    check(len(with_memos) == 2 and all(reminder_note(w["reports"]) == w["text"] for w in with_memos)
          and all("\n\nMemos noted or changed since the last review, in turns the user started:\n- `memo_" in w["text"]
                  and w["text"].endswith("most need nothing.") for w in with_memos),
          "review_memos_paragraph == subtask_report::review_memos_paragraph (on time and late)")
    rust = (REPO / "core" / "src" / "api" / "memo.rs").read_text(encoding="utf-8")
    check(f"pub const MEMO_TEXT_MAX_CHARS: usize = {MEMO_TEXT_MAX_CHARS};" in rust
          and "pub const MEMO_TOTAL_MAX_CHARS: usize = 2_000;" in rust and MEMO_TOTAL_MAX_CHARS == 2000,
          "the limits are Core's")
    ga = (GA_CODE / "ga.py").read_text(encoding="utf-8")
    m = re.search(r'^NO_BROWSER_CONNECTION_MSG = "(.*)"$', ga, re.MULTILINE)
    check(bool(m) and m.group(1) == NO_BROWSER_CONNECTION_MSG, "the no-browser answer is ga.py's")
    plain = sched_prompt(cases["chat-tired"], now)
    held = sched_prompt(cases["landlord-new-number"], now)
    review = sched_prompt(cases["review-pref"], now)
    check("### Memo" not in plain and "__MEMO__" not in plain and "__IN_HAND__" not in plain,
          "no memo from before the segment: no Memo lines")
    check(held.index("## Main Chat\n") < held.index("### Memo") < held.index("## Galley Main Chat Entry Layer")
          and "### In Hand" not in held and "- `memo_a1b2c3d4e5f60718` " in held
          and ": 房东王先生，电话 138 0000 1111\n\n## Galley Main Chat Entry Layer" in held,
          "the Memo lines after Main Chat when nothing is in hand, right before the entry layer")
    check(review.index("### In Hand") < review.index("### Memo") < review.index("## Galley Main Chat Entry Layer")
          and review.index("`memo_b2c3d4e5f6071829`") < review.index("`memo_c3d4e5f607182930`"),
          "the Memo lines after In Hand, oldest first")
    check("Note what you learn about the user that you will need later as a memo;\nonce they have asked about the "
          "same thing three times (a team, a stock),\nnote it as an interest (see `memo.md`)." in plain
          and "reminder, a memo); if you write nothing down, do not bring up\nnoting it." in plain
          and "write (a session, project, model, schedule, to-do or memo command), read the" in plain
          and "`memo.md` to note or\nchange what you know about the user;" in plain, "the ticket 96 entry layer")
    gone = {"id": "dry-gone", "expect": {}, "memos": [{"id": "memo_dry0000000000002", "text": "过期的", "until": {"days": -1}},
                                                       {"id": "memo_dry0000000000003", "text": "今天到期", "until": {"days": 0}}]}
    lines = sched_memo_lines(gone, now) or ""
    check("过期的" not in lines and "今天到期" in lines, "a memo past its last day is not in the lines; one ending today is")
    carried = sched_prompt(cases["interest-team"], now)
    check("opens\nwith 3 exchanges from before it, said between" in carried and "### Memo" not in carried,
          "the carried case: three exchanges, no memo yet")
    note = sched_note(cases["review-interest"], now)
    check(note.startswith(OPENING_REVIEW) and note.endswith(
              "Memos noted or changed since the last review, in turns the user started:\n"
              "- `memo_d4e5f60718293a4b`: 看你这周常问 76 人的比赛\nFor each, ask whether there is something you could "
              "get done for the user that they would want to know, as \"The morning review\" in `wake.md` says; most "
              "need nothing."), "the review's wake names its new memo in Core's words")
    fx = sched_fixture(cases["landlord-new-number"], now)
    check([x["id"] for x in fx["memos"]] == ["memo_a1b2c3d4e5f60718"]
          and fx["memos"][0]["origin"]["supervisor"] == "galley-assistant", "fake galley: the case's memos")

    print("memo: the judge")
    mon = datetime(2026, 10, 19, 18, 25, tzinfo=now.tzinfo)

    def judged(case_id: str, reply: str, **kw: Any) -> dict[str, Any]:
        return memo_facts(synth_memo_run(cases[case_id], mon, reply, **kw), cases[case_id])

    added = ({"action": "add", "memoId": "memo_dry0000000000001", "text": "dry"},)
    f = judged("pref-cilantro", "记下了。", memos=[synth_memo("不吃香菜")], events=added, log=(SYNTH_MEMO_ADD,))
    check(f["pass"] is True, f"a preference noted for the user, 「记下了」 after it, passes ({f['reasons']})")
    f = judged("pref-cilantro", "好。", memos=[synth_memo("用户不吃香菜")], events=added, log=(SYNTH_MEMO_ADD,))
    check(f["pass"] is False and any("关于用户的记录" in x for x in f["reasons"]), f"「用户……」 fails ({f['reasons']})")
    f = judged("pref-cilantro", "记下了。")
    check(f["pass"] is False and any("记了 0 条" in x for x in f["reasons"])
          and any("这一轮却什么都没写下" in x for x in f["reasons"]), f"nothing noted, 「记下了」 said, fails ({f['reasons']})")
    f = judged("pref-cilantro", "好。", memos=[synth_memo("不吃香菜"), synth_memo("不吃葱", "memo_dry0000000000009")],
               events=added * 2, log=(SYNTH_MEMO_ADD, SYNTH_MEMO_ADD))
    check(f["pass"] is False and any("记了 2 条" in x for x in f["reasons"]), f"two memos for one thing fail ({f['reasons']})")
    f = judged("pref-cilantro", "好。", memos=[synth_memo("不吃香菜")], events=added, log=(("memo", "add", "不吃香菜"),))
    check(f["pass"] is False and any("memo add 没带 --supervisor" in x for x in f["reasons"]),
          f"a memo write without the identity fails ({f['reasons']})")
    for text, ok, why in (("看你这周常问 76 人的比赛", True, ""), ("关注 76 人", False, "没写明来源"),
                          ("你说你关注 NBA，常问 76 人", False, "写成了用户说的")):
        f = judged("interest-team", "主场。", memos=[synth_memo(text)], events=added, log=(SYNTH_MEMO_ADD,))
        check(f["pass"] is ok and (ok or any(why in x for x in f["reasons"])),
              f"interest 「{text}」 {'passes' if ok else 'fails'} ({f['reasons']})")
    old = cases["landlord-new-number"]["memos"][0]["id"]
    fixture = sched_fixture(cases["landlord-new-number"], mon)["memos"]
    moved = [dict(fixture[0], text="房东王先生，电话 139 0000 2222", updatedAt="2026-10-19T10:30:00+00:00")]
    upd = ({"action": "update", "memoId": old, "text": "房东王先生，电话 139 0000 2222"},)
    f = judged("landlord-new-number", "已改成新号码。", memos=moved, events=upd,
               log=(("memo", "update", old, "--text=x", "--supervisor=galley-assistant"),))
    check(f["pass"] is True, f"the memo changed in place passes ({f['reasons']})")
    f = judged("landlord-new-number", "已改成新号码。", memos=[synth_memo("房东王先生，电话 139 0000 2222")],
               events=upd, log=(("memo", "delete", old, "--supervisor=galley-assistant"), SYNTH_MEMO_ADD))
    check(f["pass"] is False and any("删了重加" in x for x in f["reasons"]), f"deleted and noted again fails ({f['reasons']})")
    f = judged("landlord-new-number", "记下了。", memos=fixture + [synth_memo("房东新号码 139 0000 2222")], events=added,
               log=(SYNTH_MEMO_ADD,))
    check(f["pass"] is False and any("该改的那条没改" in x for x in f["reasons"])
          and any("另记了一条" in x for x in f["reasons"]), f"a second memo beside the old fails ({f['reasons']})")
    tue, mon_next = datetime(2026, 10, 20, 20, 0, tzinfo=now.tzinfo), datetime(2026, 10, 26, 20, 0, tzinfo=now.tzinfo)
    hotel = synth_todo("订上海的酒店", due="2026-10-27")
    trip = synth_memo("下周三起在上海出差", until="2026-10-30")
    for rem_at, memo, ok, why in ((tue, trip, True, ""), (mon_next, trip, False, "提醒不在说的那天"),
                                  (tue, synth_memo("下周三起在上海出差，记得订酒店", until="2026-10-30"), False, "不该有"),
                                  (tue, synth_memo("下周三起在上海出差"), False, "没带期限")):
        f = judged("trip-hotel", f"记下了：{local_words(rem_at)}提醒你订酒店。", memos=[memo], events=added,
                   todos=(hotel,), tasks=(synth_reminder(rem_at, hotel["id"]),), log=(SYNTH_ADD, SYNTH_MEMO_ADD))
        check(f["pass"] is ok and (ok or any(why in x for x in f["reasons"])),
              f"the trip: {memo['text']} to {memo.get('until')}, reminded {local_words(rem_at)}: "
              f"{'passes' if ok else 'fails'} ({f['reasons']})")
    call = dict(synth_todo("给房东回电话", due="2026-10-20"), notes="王先生，138 0000 1111")
    f = judged("landlord-callback", "记下了，明天给房东回电话。", todos=(call,), log=(SYNTH_ADD,))
    check(f["pass"] is False and any("抄了备忘里已有的号码" in x for x in f["reasons"]),
          f"the to-do copying the memo's number fails ({f['reasons']})")
    f = judged("landlord-callback", "记下了，明天给房东回电话。", todos=(dict(call, notes="问押金的事"),), log=(SYNTH_ADD,))
    check(f["pass"] is True and any("没挂提醒" in x for x in f["flags"]),
          f"the to-do alone passes, no reminder noted ({f['reasons']} {f['flags']})")
    f = judged("review-pref", "<no-reply/>")
    check(f["pass"] is True, f"the review, a preference: <no-reply/> passes ({f['reasons']})")
    f = judged("review-pref", "记得你不吃香菜，今天点外卖注意一下。")
    check(f["pass"] is False and any("<no-reply/>" in x for x in f["reasons"]), f"speaking up for it fails ({f['reasons']})")
    for reply, ok, why in (("<no-reply/>", True, ""), ("<subtask>查 76 人昨晚的比赛结果，交回比分与来源</subtask>\n<no-reply/>", True, ""),
                           ("要不要我帮你看看 76 人最近的比赛？", False, "提了建议"),
                           ("76 人昨晚的比赛我还没查。", False, "没做成什么却开口了"),
                           ("<subtask>查 76 人昨晚的比赛结果</subtask>\n我让子任务去查 76 人了。", False, "只派了子任务却开口了")):
        f = judged("review-interest", reply)
        check(f["pass"] is ok and (ok or any(why in x for x in f["reasons"])),
              f"the review, an interest: {reply[:24]!r} {'passes' if ok else 'fails'} ({f['reasons']})")
    f = judged("review-interest", "", stop="web_tool")
    check(f["pass"] is True and any("浏览器" in x for x in f["flags"]), f"looking it up passes, noted ({f['flags']})")
    f = judged("secret-wifi", "好的。", memory={"added": [], "changed": ["global_mem.txt"], "removed": []})
    check(f["pass"] is False and any("GA 的记忆" in x for x in f["reasons"]), f"the password into memory fails ({f['reasons']})")
    f = judged("secret-wifi", "好的，记住了。")
    check(f["pass"] is False and any("这一轮却什么都没写下" in x for x in f["reasons"]), f"「记住了」 unwritten fails ({f['reasons']})")
    f = judged("chat-tired", "辛苦了。", memos=[synth_memo("最近很累")], events=added, log=(SYNTH_MEMO_ADD,))
    check(f["pass"] is False and any("不该记备忘" in x for x in f["reasons"]), f"a mood noted fails ({f['reasons']})")
    f = judged("founding-date", "记下了。", memos=[synth_memo("公司 3 月 15 日成立")], events=added, log=(SYNTH_MEMO_ADD,))
    check(f["pass"] is True, f"the founding date as a memo passes ({f['reasons']})")
    # Ticket 98: the two new interest cases, judged as interest-team.
    for case_id, text, ok in (("interest-stock", "看你这周常问英伟达的股价和财报", True),
                              ("interest-stock", "关注英伟达股价", False),
                              ("interest-show", "看你这几天常问《长街夜行》", True)):
        f = judged(case_id, "对，19 号盘后，每周一到周四更新。", memos=[synth_memo(text)], events=added,
                   log=(SYNTH_MEMO_ADD,))
        check(f["pass"] is ok, f"{case_id}: 「{text}」 {'passes' if ok else 'fails'} ({f['reasons']})")
    # Ticket 98: the to-do and chat suites judge `expect.memo` only for a
    # run whose manual had memo.md.
    tcases_all = {c["id"]: c for c in json.loads(TODO_CASES.read_text(encoding="utf-8"))["cases"]}
    knew = [x.name for x in manual_parts()]

    def todo_judged(case_id: str, reply: str, memos: list[dict[str, Any]] | None = None,
                    manual: list[str] | None = None) -> dict[str, Any]:
        r = synth_memo_run(tcases_all[case_id], mon, reply, memos=memos,
                           events=added if memos else (), log=(SYNTH_MEMO_ADD,) if memos else ())
        r["manual_files"] = manual if manual is not None else knew
        return todo_facts(r, tcases_all[case_id])

    f = todo_judged("founding-date", "好的，2019 年 11 月 20 日。")
    check(f["pass"] is False and any("该记 1 条备忘，记了 0 条" in x for x in f["reasons"]),
          f"to-do suite, founding date: no memo fails once the manual has memo.md ({f['reasons']})")
    f = todo_judged("founding-date", "记下了。", memos=[synth_memo("公司 2019 年 11 月 20 日成立")])
    check(f["pass"] is True, f"to-do suite, founding date as a memo passes ({f['reasons']})")
    f = todo_judged("founding-date", "好的，2019 年 11 月 20 日。", manual=["todos.md", "wake.md"])
    check(f["pass"] is True, f"to-do suite, a run from before memos is judged as before ({f['reasons']})")
    f = todo_judged("guitar", "好呀。", memos=[synth_memo("想学吉他")])
    check(f["pass"] is True and any("记了备忘（也对）" in x for x in f["flags"]),
          f"to-do suite, guitar: a memo is fine, noted ({f['reasons']} {f['flags']})")
    f = todo_judged("guitar", "好呀。", memos=[synth_memo("用户想学吉他")])
    check(f["pass"] is False and any("关于用户的记录" in x for x in f["reasons"]),
          f"to-do suite: a memo written as a record about the user fails there too ({f['reasons']})")
    ccases_all = {c["id"]: c for c in chat_cases()}
    cr = synth_memo_run(ccases_all["carry-older"], mon, "好，玩得开心。", memos=[synth_memo("下周去成都")],
                        events=added, log=(SYNTH_MEMO_ADD,))
    cr["manual_files"] = knew
    cf = chat_facts(cr, ccases_all["carry-older"])
    check(cf["pass"] is None and any("也对" in x for x in cf["flags"]),
          f"chat suite, a two-sided case: recorded, the memo noted ({cf['flags']})")
    tcase = next(c for c in json.loads(TODO_CASES.read_text(encoding="utf-8"))["cases"] if c["id"] == "founding-date")
    tr = synth_run(tcase, mon, "记下了。")
    tr["fake_state"]["memo_events"] = [{"action": "add", "memoId": "memo_dry0000000000001", "text": "公司成立日"}]
    tf = todo_facts(tr, tcase)
    check(tf["pass"] is True and any("写了备忘" in x for x in tf["flags"]),
          f"the to-do suite: a memo counts as a write, noted ({tf['reasons']} {tf['flags']})")

    for r in sorted(results, key=lambda r: r["id"]):
        case_id, script = scripts[r["id"]]
        case = cases[case_id]
        print(f"memo {r['id']} / {r['variant']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        check(not r["blocked"] and not r["do_calls"] and not r["canaries"],
              f"nothing left the sandbox ({r['blocked']} {r['do_calls']} {r['canaries']})")
        check(r.get("manual_files") == [x.name for x in manual_parts()] and "memo.md" in r["manual_files"],
              f"the directory holds every part, memo.md among them ({r.get('manual_files')})")
        system = r["requests"][0]["messages"][0]["content"]
        f = memo_facts(r, case)
        if script == "memo-cli":
            out = str((r["calls"][1].get("result") or {}).get("stdout", ""))
            for piece in ("listed=1", "long=2", "a memo is 1 to 100 characters once trimmed; this one is 101", "empty=2",
                          "this one is 0", "past=2", "time_in_past: create_memo: until 2020-01-01 is before today",
                          "baddate=2", 'until is a local date YYYY-MM-DD, got \\"明天\\"', "emptyuntil=2",
                          "a value is required for '--until <DATE>'", "notext=2", "nochange=2",
                          "<--text <TEXT>|--until <DATE>|--no-until>", "conflict=2",
                          "cannot be used with '--no-until'", "unknown=3", "memo memo_nope not found", "listall=2",
                          "unexpected argument '--all'", "updated=1", "same=0", "until=1", "over=1", "listed=22", "deleted=1",
                          "delete2=3", "Note a memo."):
                check(piece in out, f"shell output has {piece!r}")
            st = r.get("fake_state") or {}
            check([e["action"] for e in st.get("memo_events") or []] == ["update", "add"] + ["add"] * 20 + ["delete"],
                  "the record of memo writes: update, add, twenty adds, delete (none for a refused write, "
                  "none for an update that changes nothing)")
            check(len(f["memos_new"]) == 21 and [m["id"] for m in f["memos_deleted"]] == ["memo_a1b2c3d4e5f60718"]
                  and f["memos_new"][0].get("until") and not f["pass"]
                  and any("删了重加" in x or "却把它删了" in x for x in f["reasons"]),
                  f"the judge reads the memos the run left ({f['reasons']})")
            check(f["manual"].startswith("读了（第 1 次调用）：memo.md；1 次 1 轮，"), f"the part read ({f['manual']})")
            check("- `memo_a1b2c3d4e5f60718` " in system, "the Memo lines carry the case's memo")
        elif script == "memo-web":
            web = r["calls"][0]
            check(web["name"] == "web_scan" and web["outcome"] == "fake result: no browser connected"
                  and web["result"] == {"status": "error", "msg": NO_BROWSER_CONNECTION_MSG}
                  and r["stop_reason"] == "final_reply", "a lookup gets GA's no-browser answer and the run goes on")
            check(f["pass"] is True and [m["text"] for m in f["memos_new"]] == ["看你这周常问 76 人的比赛"]
                  and f["memo_listed"] == "查了", f"the interest noted, after `memo list`, passes ({f['reasons']})")
        else:
            want = sched_note(case, datetime.fromisoformat(r["now"]))
            last = r["requests"][0]["messages"][-1]["content"]
            if not isinstance(last, str):
                last = "\n".join(b.get("text", "") for b in last if isinstance(b, dict))
            check(want in last and "- `memo_d4e5f60718293a4b`: 看你这周常问 76 人的比赛" in want,
                  "the wake note is Core's, naming the new memo")
            check(system.index("### In Hand") < system.index("### Memo") < system.index("## Galley Main Chat Entry Layer"),
                  "the Memo lines after In Hand")
            check(f["pass"] is True and f["no_reply"], f"<no-reply/> passes ({f['reasons']})")


def dry_test_dispatch(results: list[dict[str, Any]], scripts: dict[tuple[str, str], str],
                      check: Any) -> None:
    """Ticket 06 paths: T's tag, C's CLI dispatch answered with a fake
    result and then a final reply, P's tool dispatch answered with a fake
    result and then a second tool call (waiting), and a first tool call
    that is not a dispatch."""
    clauses = load_dispatch_clauses()
    markers = {"T": "<subtask>what to do</subtask>", "C": "galley subtask start --parent=",
               "P": "start it with the start_subtask tool"}
    for r in sorted(results, key=lambda r: (r["id"], r["variant"])):
        script = scripts[(r["id"], r["variant"])]
        print(f"dispatch {r['id']} / {r['variant']} ({script})")
        check(r["status"] == "ok", f"run completed (status {r['status']} {r.get('error', '')[:300]})")
        if r["status"] != "ok":
            continue
        req = r["request"]
        system = req["messages"][0]["content"] if req["messages"][0]["role"] == "system" else ""
        check(not r["do_calls"], f"no GA tool method was entered ({r['do_calls']})")
        check(not r["blocked"], f"nothing tried to run, connect or write ({r['blocked']})")
        check(not r["canaries"], f"no canary file exists ({r['canaries']})")
        check(all(r["guard_selftest"].values()), f"guards refuse ({r['guard_selftest']})")
        clause_at = system.find(clauses[r["variant"]])
        check(-1 < system.find("## Main Chat\n") < system.find("## Galley Main Chat Entry Layer")
              < clause_at < system.find("[Peer]"),
              "clause right after the draft, which follows Main Chat")
        check(all((markers[v] in system) == (v == r["variant"]) for v in DISPATCH_VARIANTS),
              "only this variant's clause")
        tools = {t["function"]["name"]: t for t in req.get("tools", [])}
        check(("start_subtask" in tools) == (r["variant"] == "P"), "start_subtask offered only in P")
        if r["variant"] == "P":
            check(tools["start_subtask"]["function"]["parameters"]["required"] == ["task"]
                  and set(tools) > {"code_run", "file_read", "web_execute_js"},
                  "P: GA's tools plus start_subtask(task)")
        d = r["dispatch"]
        second = json.dumps(r["requests"][1], ensure_ascii=False) if len(r["requests"]) > 1 else ""
        if script == "tag":
            check(r["llm_calls"] == 1 and r["tool_call"] is None, "one call, no tool")
            check(d["dispatched"] and d["via"] == "tag"
                  and d["brief"] == "把 ~/Downloads 里的 PDF 按内容分类", f"tag recorded ({d})")
        elif script == "cli-final":
            check(r["llm_calls"] == 2, f"continued once after the fake result ({r['llm_calls']} calls)")
            check(d["dispatched"] and d["via"] == "cli" and d["brief"] == DRY_CLI_BRIEF,
                  f"CLI dispatch recorded, brief read from the command ({d['brief']})")
            tool_msgs = [m for m in r["requests"][1]["messages"] if m.get("role") == "tool"]
            check(len(tool_msgs) == 1 and "s-sub0001" in str(tool_msgs[0].get("content"))
                  and '"exit_code": 0' in str(tool_msgs[0].get("content")),
                  "second request carries code_run's fake result")
            after = r["after_dispatch"]
            check(after["tool_call"] is None and "已经开始整理了" in (after["final_reply"] or ""),
                  "final reply after the fake result recorded")
        elif script == "tool-wait":
            check(r["llm_calls"] == 2, f"continued once after the fake result ({r['llm_calls']} calls)")
            check(d["dispatched"] and d["via"] == "tool" and d["brief"] == DRY_TOOL_BRIEF,
                  "tool dispatch recorded with its task")
            check('"subtask_id": "s-sub0001"' in second or '\\"subtask_id\\": \\"s-sub0001\\"' in second,
                  "second request carries start_subtask's fake result")
            after = r["after_dispatch"]
            check((after["tool_call"] or {}).get("name") == "code_run" and not after["same_reply"]
                  and after["final_reply"] is None and r["tool_call"] == after["tool_call"],
                  "the waiting call after it is recorded and ends the run")
        else:  # a first tool call that is not a dispatch
            check(r["llm_calls"] == 1, "stopped at the first call")
            check(not d["dispatched"] and r.get("after_dispatch") is None
                  and (r["tool_call"] or {}).get("name") == "code_run",
                  f"recorded as an ordinary tool call, no fake result ({r['tool_call']})")


# ======================================================================
# Main
# ======================================================================


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--dry-test", action="store_true", help="verify interception, no model")
    ap.add_argument("--render-only", action="store_true", help="rebuild the .md from the .json")
    ap.add_argument("--suite", choices=("entry", "dispatch", "wake", "schedule", "todo", "chat", "memo"), default="entry",
                    help="entry: cases.json WITHOUT / WITH; dispatch: dispatch-cases.json T / C / P; "
                         "wake: wake/cases.json under the wordings of wake/wording.md; "
                         "schedule: schedule/cases.json (ticket 36); todo: todo/cases.json (ticket 41); "
                         "chat: cases.json under today's main chat prompt, judged by chat/cases.json (ticket 60); "
                         "memo: memo/cases.json (ticket 96)")
    ap.add_argument("--variant", default="all",
                    help="entry: without | with | both; dispatch: comma list of T,C,P; "
                         "wake: comma list of wording names; or all")
    ap.add_argument("--repeats", type=int, default=WAKE_REPEATS,
                    help="wake / schedule / todo: runs per case (and wording)")
    ap.add_argument("--first-repeat", type=int, default=1,
                    help="schedule / todo: number the runs from here (add runs without redoing the earlier ones)")
    ap.add_argument("--supersede", metavar="REASON",
                    help="wake / schedule / todo: keep the results these runs replace in meta.superseded_runs, "
                         "with this reason")
    ap.add_argument("--mode", choices=("sandbox", "firststop"), default="sandbox",
                    help="dispatch suite: sandbox (lookups answered from a per-run sandbox, "
                         "dispatch-results.*) or firststop (the first run: any non-dispatch tool "
                         "call ends the run, dispatch-results-firststop.*)")
    ap.add_argument("--cases", help="comma-separated case ids (default: all); results are merged")
    ap.add_argument("--control", metavar="TICKET",
                    help="schedule / todo / chat / wake: keep these runs in meta.ticket<TICKET>_control (a same-day "
                         "control under the prompt before that ticket), not in the results (ticket 64; wake since "
                         "ticket 73)")
    ap.add_argument("--galley-db", default=str(DEFAULT_GALLEY_DB))
    ap.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    ap.add_argument("--mykey", help="fallback: a GA mykey.py (read-only)")
    ap.add_argument("--mykey-entry", help="the config name in --mykey")
    ap.add_argument("--ga-lang", default="en",
                    help="GA_LANG; JC's dev runner has LANG=en_US.UTF-8, so GA picks en")
    ap.add_argument("--python", default=sys.executable, help="interpreter for the workers")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    if args.worker:
        return worker()
    if args.dry_test:
        return dry_test(args.python, args.ga_lang, args.keep_temp)

    dispatch = args.suite == "dispatch"
    wake = args.suite == "wake"
    todo = args.suite == "todo"
    chat = args.suite == "chat"
    memo = args.suite == "memo"
    sched = args.suite == "schedule" or todo or chat or memo
    sandbox_mode = dispatch and args.mode == "sandbox"
    if memo:
        suite_files = (MEMO_CASES, MEMO_JSON, MEMO_MD, ("manual",), render_memo_md)
    elif todo:
        suite_files = (TODO_CASES, TODO_JSON, TODO_MD, ("manual",), render_todo_md)
    elif chat:
        suite_files = (CHAT_CASES, CHAT_JSON, CHAT_MD, ("manual",), render_chat_md)
    elif sched:
        suite_files = (SCHED_CASES, SCHED_JSON, SCHED_MD, ("manual",), render_sched_md)
    elif wake:
        suite_files = (WAKE_CASES, WAKE_JSON, WAKE_MD, tuple(load_wording()), render_wake_md)
    elif sandbox_mode:
        suite_files = (DISPATCH_CASES, DISPATCH_JSON, DISPATCH_MD, DISPATCH_VARIANTS,
                       render_sandbox_md)
    elif dispatch:
        suite_files = (DISPATCH_CASES, DISPATCH_FIRSTSTOP_JSON, DISPATCH_FIRSTSTOP_MD,
                       DISPATCH_VARIANTS, render_dispatch_md)
    else:
        suite_files = (CASES, RESULTS_JSON, RESULTS_MD, VARIANTS, render_md)
    cases_path, results_json, results_md, all_variants, render = suite_files
    all_cases = chat_cases() if chat else json.loads(cases_path.read_text(encoding="utf-8"))["cases"]
    if args.render_only:
        data = json.loads(results_json.read_text(encoding="utf-8"))
        results_md.write_text(scrub(render(data, all_cases)), encoding="utf-8")
        return 0

    wanted = set(args.cases.split(",")) if args.cases else None
    cases = [c for c in all_cases if wanted is None or c["id"] in wanted]
    if wanted and len(cases) != len(wanted):
        fail(f"unknown case ids: {sorted(wanted - {c['id'] for c in cases})}")
    if sched:
        variants = ["manual"]
    elif wake and args.variant == "all":
        variants = ["draft"]
    elif args.variant in ("all", "both"):
        variants = list(all_variants)
    else:
        variants = [v.strip() for v in args.variant.split(",")]
        if not variants or any(v not in all_variants for v in variants):
            fail(f"--variant for the {args.suite} suite: {', '.join(all_variants)} or all")

    if args.mykey:
        if not args.mykey_entry:
            fail("--mykey needs --mykey-entry")
        mykeys = ga_mykeys_from_mykey_file(Path(args.mykey).expanduser(), args.mykey_entry)
        source = f"GA mykey.py 条目 {args.mykey_entry}（只读）"
    else:
        model = model_from_galley_db(Path(args.galley_db).expanduser(), args.model_id)
        mykeys = ga_mykeys_from_galley_model(model)
        source = f"Galley 托管模型 {args.model_id}，从 Galley 数据库只读取得"
    if len(mykeys) != 1:
        fail("expected exactly one model config")
    host = urlparse(str(next(iter(mykeys.values())).get("apibase", ""))).hostname
    if not host:
        fail("model config has no api host")
    allowed = {host}
    for var in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        if os.environ.get(var):
            proxy_host = urlparse(os.environ[var]).hostname
            if proxy_host:
                allowed.add(proxy_host)

    now = datetime.now()
    draft = DRAFT.read_text(encoding="utf-8")
    if sched:
        jobs = make_sched_jobs(cases, now.astimezone(), mykeys, args.ga_lang, allowed, args.repeats,
                               first=args.first_repeat, suite=args.suite)
    elif wake:
        jobs = make_wake_jobs(cases, variants, now, mykeys, args.ga_lang, allowed, args.repeats)
    elif dispatch:
        jobs = make_dispatch_jobs(cases, variants, now, draft, mykeys, args.ga_lang, allowed,
                                  sandbox=sandbox_mode)
    else:
        jobs = make_jobs(cases, variants, now, draft, mykeys, args.ga_lang, allowed)
    print(f"{len(jobs)} runs, model {describe_mykeys(mykeys)['name']}, parallel {args.parallel}")
    results = run_jobs(jobs, args.python, args.parallel, args.keep_temp)

    # Belt and braces: no copy of the key may reach a written file.
    secret = str(next(iter(mykeys.values())).get("apikey") or "")
    if len(secret) >= 8:
        results = json.loads(json.dumps(results, ensure_ascii=False).replace(secret, "<redacted>"))
    if args.control:
        # Ticket 64: a same-day control (the prompt before the ticket, run
        # in the same hour as the rerun), kept beside the results; merged
        # by run, the composed requests left as they are.
        if not (sched or wake) or not results_json.is_file():
            fail("--control is for the schedule, todo, chat and (ticket 73) wake suites, after a first run")
        for r in results:
            r.pop("request", None)
        previous = json.loads(results_json.read_text(encoding="utf-8"))
        key = f"ticket{args.control}_control"
        fresh = {(r["id"], r["variant"]) for r in results}
        kept = [r for r in previous["meta"].get(key) or [] if (r["id"], r["variant"]) not in fresh]
        order = {c["id"]: i for i, c in enumerate(all_cases)}
        previous["meta"][key] = sorted(kept + results, key=lambda r: (order.get(r["id"], 99), r.get("repeat", 0)))
        previous["meta"][key + "_at"] = now.strftime("%Y-%m-%d %H:%M")
        results_json.write_text(scrub(json.dumps(previous, ensure_ascii=False, indent=2) + "\n"), encoding="utf-8")
        results_md.write_text(scrub(render(previous, all_cases)), encoding="utf-8")
        failed = [f"{r['id']}/{r['variant']}" for r in results if r["status"] != "ok"]
        print("failed: " + (", ".join(failed) if failed else "none"))
        return 1 if failed else 0
    for r in results:
        if r.get("request") and r["status"] == "ok":
            if sched:
                write_composed(r, "", MEMO_COMPOSED_DIR if memo else TODO_COMPOSED_DIR if todo else SCHED_COMPOSED_DIR)
            elif wake:
                write_composed(r, "", WAKE_COMPOSED_DIR)
            else:
                write_composed(r, "dispatch." if dispatch else "")
        r.pop("request", None)

    merged: list[dict[str, Any]] = []
    previous_meta: dict[str, Any] = {}
    if (wanted or wake or sched) and results_json.is_file():
        previous = json.loads(results_json.read_text(encoding="utf-8"))
        merged, previous_meta = previous["results"], previous.get("meta", {})
    fresh = {(r["id"], r["variant"]) for r in results}
    replaced = [r for r in merged if (r["id"], r["variant"]) in fresh]
    merged = [r for r in merged if (r["id"], r["variant"]) not in fresh] + results
    if args.supersede:
        # Ticket 63: the runs of a case no longer in cases.json (a case
        # replaced by another) go with the runs this one replaces.
        known = {c["id"] for c in all_cases}
        replaced += [r for r in merged if r["id"] not in known]
        merged = [r for r in merged if r["id"] in known]
    order = {c["id"]: i for i, c in enumerate(all_cases)}
    if sched:
        merged.sort(key=lambda r: (order.get(r["id"], 99), r.get("repeat", 0)))
    elif wake:
        merged.sort(key=lambda r: (order.get(r["id"], 99), list(all_variants).index(r["wording"])
                                   if r.get("wording") in all_variants else 99, r.get("repeat", 0)))
    else:
        merged.sort(key=lambda r: (order.get(r["id"], 99), all_variants.index(r["variant"])))
    reruns = list(previous_meta.get("partial_reruns", []))
    if previous_meta:
        reruns.append({"at": now.strftime("%Y-%m-%d %H:%M"),
                       "runs": sorted(f"{i}/{v}" for i, v in fresh)})
    data = {
        "meta": {
            "ran_at": previous_meta.get("ran_at", now.strftime("%Y-%m-%d %H:%M")),
            "partial_reruns": reruns,
            "model": describe_mykeys(mykeys),
            "model_source": source,
            "ga_lang": args.ga_lang,
            "python": platform.python_version(),
            "session_id": SESSION_ID,
            "segment_start_turn": SEGMENT_START_TURN,
            "segment_start_date": now.strftime("%Y-%m-%d"),
            "usage_total": summarize_usage(merged),
            "llm_calls_total": sum(int(r.get("llm_calls") or 0) for r in merged),
        },
        "results": merged,
    }
    if dispatch:
        data["meta"].update({
            "suite": "dispatch (ticket 06): draft.md + one clause of dispatch-clauses.md",
            "fake_dispatch_results": FAKE_DISPATCH_RESULTS,
            "start_subtask_tool": START_SUBTASK_TOOL,
            "mode": args.mode,
        })
    if wake:
        data["meta"].update({
            "suite": "wake (ticket 30, rerun for tickets 59 and 63): the main chat prompt (regenerated for tickets 59 "
                     "and 63: its entry layer and today's static rules), the assistant manual's parts in the state "
                     "root, a wake note filled from wording.md; since ticket 63 the quote dates are the run day's",
            "wordings_order": list(all_variants),
            "repeats": args.repeats,
            "tool_cap": WAKE_TOOL_CAP,
            "extra_exec": list(WAKE_EXTRA_EXEC),
            "manual": "docs/managed-ga-runtime/galley-assistant-manual/",
            "manual_sha": manual_sha(),
        })
        if previous_meta.get("superseded_runs"):
            data["meta"]["superseded_runs"] = previous_meta["superseded_runs"]
    if previous_meta.get("history_note"):
        data["meta"]["history_note"] = previous_meta["history_note"]
    for key in ("ticket59_note", "ticket59_control", "ticket60_note", "ticket63_note", "ticket64_note",
                "ticket64_control", "ticket64_control_at", "ticket73_note", "ticket73_control",
                "ticket73_control_at", "ticket108_note", "ticket108w_control", "ticket108w_control_at",
                "ticket108r_control", "ticket108r_control_at", "ticket110_note", "ticket110w_control",
                "ticket110w_control_at", "ticket110r_control", "ticket110r_control_at"):
        if previous_meta.get(key):
            data["meta"][key] = previous_meta[key]
    if sched:
        data["meta"].update({
            "suite": ("memo (ticket 96): the main chat prompt of ticket 96 (schedule/galley-prompt/, regenerated: the "
                      "entry layer's memo sentence, \"a memo\" in the floor, memo in the write and manual lists; "
                      "carried-1 for a carried case), the case's memos from before the segment in the \"Memo\" lines "
                      "(memo_section's port), In Hand for its to-dos and tasks, the assistant manual's ten parts "
                      "(memo.md new) in the state root, the to-do suite's sandbox and fake galley with ticket 95's "
                      "memo family; a morning review's wake names its new memos in Core's words; judged on the memos, "
                      "to-dos and reminders it wrote (memo/cases.json)" if memo else
                      "chat (ticket 60, rerun for tickets 63 and 64): the entry layer's cases.json under the main chat prompt of ticket 64 "
                      "(schedule/galley-prompt/, carried-1 for the carried cases), the assistant manual's parts in "
                      "the state root, the to-do suite's sandbox and fake galley with nothing in it; judged only on "
                      "the to-dos and reminders set (chat/cases.json), since ticket 64 also on a reply taking back a "
                      "noting" if chat else
                      "todo (ticket 41, rerun for ticket 44): the main chat prompt with the ticket 41 entry layer, "
                      "In Hand lines (ticket 39's three groups) for to-dos and tasks from before the segment, the "
                      "assistant manual (ticket 44's text, in parts since ticket 59) in the state root, the case's "
                      "to-dos and tasks in the fake galley; rerun for tickets 59 and 60 (ticket 60's cases added; "
                      "In Hand's fourth group, ticket 61, for the cases that start with a follow-up turned down); rerun "
                      "for ticket 63 (Core's new wake words, the manual's coming-due rules in wake.md, the entry "
                      "layer's floor on 「记下了」; the two-sided cases judged, ticket 63's cases added); rerun for "
                      "ticket 64 (the entry layer reads todos.md before saying it will note, and does not bring noting "
                      "up when it wrote nothing; the cases where nothing is to be set judged on a reply taking back a "
                      "noting; a same-hour baseline of those under ticket 63's prompt in meta.ticket64_control); "
                      "rerun for ticket 108 (todos-change.md: how a to-do is going, one dated line on top of its "
                      "notes; unasked.md points to it; the new cases' files in the fake HOME; a same-hour baseline "
                      "under the manual of before it in meta.ticket108w_control, and the new manual without that "
                      "line in meta.ticket108r_control); rerun for ticket 110 (wake.md's morning review: woken only "
                      "for what moved since the last review; what it handed over waits for the user, a line the notes "
                      "miss goes in first, another look later is a reminder; four cases, carried turns with a subtask's "
                      "report; the manual of before it in meta.ticket110w_control, the new one without that bullet in "
                      "meta.ticket110r_control)"
                      if todo else
                      "schedule (ticket 36, rerun for tickets 41 and 44): the main chat prompt with the ticket 41 "
                      "entry layer and its own configuration paragraph, In Hand lines (ticket 39's three groups) for "
                      "tasks from before the segment, the assistant manual (ticket 44's text, in parts since ticket "
                      "59) in the state root, the case's tasks in the fake galley; rerun for tickets 59, 60, 63 and 73; "
                      "rerun for ticket 105 (reminders.md: the first line of a reminder's words is for the user, the "
                      "notes for itself after a blank line; the wake cases' task words in that form; each schedule "
                      "create / update --prompt judged on its first line)"),
            "repeats": args.repeats,
            "tool_cap": SCHED_TOOL_CAP,
            "extra_exec": list(SCHED_EXTRA_EXEC),
            "manual": "docs/managed-ga-runtime/galley-assistant-manual/",
            "manual_sha": manual_sha(),
        })
    if (wake or sched) and (previous_meta.get("superseded_runs") or (args.supersede and replaced)):
        groups = previous_meta.get("superseded_runs") or []
        groups = [groups] if isinstance(groups, dict) else list(groups)
        if args.supersede and replaced:
            groups.append({"reason": args.supersede, "at": now.strftime("%Y-%m-%d %H:%M"), "runs": replaced})
        data["meta"]["superseded_runs"] = groups
    if sandbox_mode:
        data["meta"]["sandbox"] = {
            "tool_cap": SANDBOX_TOOL_CAP,
            "runs_for_real_in_sandbox": list(SANDBOX_RUNNABLE),
            "ends_the_run": SANDBOX_STOPS,
            "fixtures": {"downloads_pdfs": sorted(FIXTURE_PDFS), "downloads_other": sorted(FIXTURE_OTHER),
                         "downloads_sparse_bytes": FIXTURE_SPARSE},
            "fake_galley": "sessions search / sessions list: no hits; subtask start: "
                           + FAKE_SUBTASK_STDOUT + "; session show s-sub0001: running, no messages; "
                           "--help / -h on those four: a one-line usage; "
                           "anything else: unknown_command (exit 1)",
            "start_subtask_fake_result": FAKE_DISPATCH_RESULTS["P"],
        }
    results_json.write_text(scrub(json.dumps(data, ensure_ascii=False, indent=2) + "\n"),
                            encoding="utf-8")
    results_md.write_text(scrub(render(data, all_cases)), encoding="utf-8")
    failed = [f"{r['id']}/{r['variant']}" for r in results if r["status"] != "ok"]
    print(f"usage: {data['meta']['usage_total']}")
    print("failed: " + (", ".join(failed) if failed else "none"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
