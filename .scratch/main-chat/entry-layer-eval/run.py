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
DEFAULT_MODEL_ID = "mm_1790734996114"  # gpt-6.1-sol, the main chat's model
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
                   ("project_edits", {}), ("default_llm", None)):
    state.setdefault(key, empty)
if state["tasks"] is None:
    state["tasks"] = [dict(t) for t in fx.get("tasks") or []]
if state["todos"] is None:
    state["todos"] = [dict(t) for t in fx.get("todos") or []]

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
         "due", "remind-at", "notes", "title"}
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
    ("session", "send"): {"supervisor", "reason", "jump"},
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


def galley_runtime_prompt(case: dict[str, Any], variant: str, now: datetime, draft: str) -> str:
    """Galley's main chat runtime prompt for this case, from the text the
    real Rust code produced (galley-prompt/, dumped from
    managed_prompt::compose_main_chat_runtime_prompt with placeholders),
    plus the draft entry layer for WITH."""
    history = case.get("history") or []
    carried_turns = sum(1 for m in history if m.get("role") == "user")
    if case.get("carried") and carried_turns:
        template = GALLEY_PROMPT_DIR / f"main_chat.carried-{carried_turns}.txt"
    else:
        template = GALLEY_PROMPT_DIR / "main_chat.plain.txt"
    if not template.is_file():
        fail(f"missing {template}")
    text = template.read_text(encoding="utf-8")
    last_said = now - timedelta(hours=float(case.get("hours_ago") or 0))
    text = (
        text.replace("__SESSION_ID__", SESSION_ID)
        .replace("__SEGMENT_START_TURN__", str(SEGMENT_START_TURN))
        .replace("__SEGMENT_START_DATE__", now.strftime("%Y-%m-%d"))
        .replace("__LAST_SAID_AT__", last_said.strftime("%Y-%m-%d %H:%M"))
    )
    for placeholder in ("__SESSION_ID__", "__SEGMENT_START_TURN__", "__SEGMENT_START_DATE__",
                        "__LAST_SAID_AT__"):
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
            "selectedLlmKey": "mm_1790734996114", "selectedLlmDisplayName": "gpt-6.1-sol"}
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
        start = 35 - 3 * k
        rows = [{"id": f"msg_{sid}_0_user", "sessionId": sid, "role": "user", "content": s["instructions"],
                 "createdAt": at(start), "turnIndex": 0, "origin": {"via": "subtask"},
                 "visibility": "visible"}]
        for n, m in enumerate(s["messages"], 1):
            turn = int(m.get("turn") or 0)
            row: dict[str, Any] = {"id": f"msg_{sid}_{turn}_{n}", "sessionId": sid,
                                   "role": m["role"], "content": m["content"],
                                   "createdAt": at(start - n * (start - 1) / (len(s["messages"]) + 1)),
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
            {"index": 0, "name": "gpt-6.1-sol", "key": "mm_1790734996114", "displayName": "gpt-6.1-sol",
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


def due_paragraph(d: dict[str, Any]) -> str:
    """subtask_report::due_paragraph, word for word (todo_due_paragraph for a
    reminder on one of the user's to-dos, ticket 39)."""
    tid = d["task_id"]
    when, act = due_when_and_act(d)
    todo = d.get("todo")
    if todo:
        notes = (todo.get("notes") or "").strip()
        body = todo["title"].strip() + ("\n" + notes if notes else "")
        due_line = f"It is due {todo['due']}, local time." if todo.get("due") else "It has no due date."
        return (f"Reminder `{tid}` on the user's to-do `{todo['id']}` came due. {when} The to-do is the user's own, "
                f"something they have to do:\n<<<\n{body}\n>>>\n{due_line} "
                f"{act} remind the user of it in a sentence or two, look something up first, or start a subtask. "
                "If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.")
    what = (f"Reminder `{tid}` (one-off) came due." if d["once"]
            else f"Scheduled reminder `{tid}` ({d['rule']}) came due.")
    return (f"{what} {when} What you noted when you set it:\n<<<\n{d['prompt'].strip()}\n>>>\n"
            f"{act} tell the user in a sentence or two, look something up first, or start a subtask. "
            "If it no longer applies (the user already did it), end your reply with exactly <no-reply/>.")


def reminder_note(dues: list[dict[str, Any]]) -> str:
    """subtask_report::report_text for reminders that came due."""
    parts = [OPENING_REMINDER] + [due_paragraph(d) for d in dues]
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
        item = {"kind": "task", "id": task["id"], "text": task["prompt"],
                "state": "scheduled" if enabled else "paused",
                "createdBy": ("user" if origin.get("via") == "gui" else "assistant"
                              if origin.get("supervisor") == "galley-assistant" else "agent"),
                "target": task.get("target", "session"), "repeat": task["repeat"]}
        if origin.get("via") == "supervisor" and origin.get("supervisor") != "galley-assistant":
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


def sched_task(t: dict[str, Any], now: datetime) -> dict[str, Any]:
    """One of a case's tasks as `schedule show` prints it (Agent API §5.20)."""
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
    todo["createdAt"] = todo["updatedAt"] = iso_utc(made)
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


def sched_in_hand(case: dict[str, Any], now: datetime) -> str | None:
    """The case's In Hand lines: its to-dos and tasks from before the
    segment, grouped and ordered as the to-do read does it, read an hour
    before the message."""
    as_of = now - timedelta(hours=SCHED_IN_HAND_HOURS_BEFORE)
    tasks = [sched_task(t, now) for t in case.get("tasks") or [] if t.get("in_hand") and not t.get("fired")]
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
        # segment, as the real Rust code writes it (main_chat.carried-N).
        path = SCHED_PROMPT.with_name(f"main_chat.carried-{turns}.txt")
        if not path.is_file():
            fail(f"missing {path.name}")
        last = now - timedelta(hours=float(case.get("hours_ago") or 0))
        text = path.read_text(encoding="utf-8").replace("__LAST_SAID_AT__", last.strftime("%Y-%m-%d %H:%M"))
    else:
        text = SCHED_PROMPT.read_text(encoding="utf-8")
    text = (text.replace("__SESSION_ID__", SESSION_ID)
            .replace("__SEGMENT_START_TURN__", str(SEGMENT_START_TURN))
            .replace("__SEGMENT_START_DATE__", now.strftime("%Y-%m-%d")))
    if text.count("\n\n__IN_HAND__") != 1 or "__MANUAL_DIR__" not in text:
        fail("schedule prompt: placeholders missing")
    lines = sched_in_hand(case, now)
    return text.replace("\n\n__IN_HAND__", "\n\n" + lines if lines else "")


def sched_note(case: dict[str, Any], now: datetime) -> str:
    """The wake note for the case's reminders that came due."""
    dues = []
    for tid in case["wake"]:
        t = next((x for x in case.get("tasks") or [] if x["id"] == tid), None)
        todo = None
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
    one an outside agent started, the case's history) plus the case's
    tasks and this machine's offset for local times."""
    fx = wake_fixture(dict(case, subtasks=[]), now)
    fx["tasks"] = [sched_task(t, now) for t in case.get("tasks") or []]
    fx["tasks"] += [r for r in (todo_reminder_task(t, now) for t in todo_specs(case)) if r]
    fx["todos"] = [todo_stored(t, now, k) for k, t in enumerate(todo_specs(case))]
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

    con = sqlite3.connect(f"file:{quote(str(db_path))}?mode=ro&immutable=1", uri=True)
    try:
        row = con.execute(
            "SELECT m.display_name, p.protocol, p.auth_kind, p.api_base, m.model, "
            "p.api_key_ref, m.preset_options, m.advanced_options "
            "FROM managed_models m JOIN managed_model_providers p ON p.id = m.provider_id "
            "WHERE m.id = ?",
            (model_id,),
        ).fetchone()
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
"$GALLEY" session send s-mgq3c1d8-2k7v4p0a "截图路径再给一下" --supervisor=galley-assistant --reason="send back"
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
                 '"$G" schedule list >/dev/null; "$G" schedule create "提醒用户关火" --at="$AT" --target=assistant '
                 '--supervisor=galley-assistant --reason="user asked"'})),
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
        "todo-put-to-use": [call("<summary>Remind</summary>\n702 装修预计今天完工，完了吗？要不要约个时间验收？")],
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
    if sandbox:
        result["sandbox"] = {"launched": SANDBOX_EXEC["launched"], "refused": list(REFUSED)}
    if job.get("dry"):
        result["guard_selftest"] = guard_selftest(real_home)
    # The result lives outside the sandbox (and outside the write guard).
    with REAL_OPEN(job["result_path"], "w", encoding="utf-8") as f:
        f.write(json.dumps(result, ensure_ascii=False, indent=2))
    sys.stdout.flush()
    os._exit(0)


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
        if job.get("suite") in ("schedule", "todo", "chat"):
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
        (data / "fixture.json").write_text(json.dumps(wake["fixture"], ensure_ascii=False), encoding="utf-8")
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
    if job.get("suite") in ("schedule", "todo", "chat"):
        # What the fake galley ended with (tasks and to-dos made, changed,
        # cancelled), and what it started with.
        state_path = Path(sandbox["fake_state"]) if sandbox and sandbox.get("fake_state") else None
        if state_path and state_path.is_file():
            result["fake_state"] = json.loads(state_path.read_text(encoding="utf-8"))
        result["fixture_tasks"] = job["wake"]["fixture"]["tasks"]
        result["fixture_todos"] = job["wake"]["fixture"].get("todos") or []
    if sandbox:
        after = downloads_snapshot(Path(sandbox["home"]))
        result["downloads_changes"] = {
            "removed": sorted(set(before) - set(after)),
            "added": sorted(set(after) - set(before)),
            "resized": sorted(k for k in set(before) & set(after) if before[k] != after[k]),
        }
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
                "keep_request": (case["id"] in (TODO_DUMP_CASES if suite == "todo" else SCHED_DUMP_CASES)
                                 and n == 1) or bool(dry),
                "dry": dry,
                "sandbox": True,
                "tool_cap": SCHED_TOOL_CAP,
                "wake": {"fixture": sched_fixture(case, now), "files": {}, "help": str(SCHED_CLI_HELP),
                         "extra_exec": list(SCHED_EXTRA_EXEC)},
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
        if exp.get("max_chars") and len(body) > exp["max_chars"]:
            reasons.append(f"太长：{len(body)} 字，上限 {exp['max_chars']}")
    return {
        "commands": [" ".join(a) for a in log],
        "names": names,
        "sends": sends,
        "writes": writes,
        "held": held,
        "body": body,
        "no_reply": is_no_reply,
        "has_no_reply_tag": has_no_reply,
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
}


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
        "那里放着仓库里 `docs/managed-ga-runtime/galley-assistant-manual/` 的八个部分（Core 写的位置）；票 59 之前是单个文件 "
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
    out += rerun_section(data, cases, wake_facts, "59")
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
    """1–99 in Chinese numerals (十二, 二十五)."""
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


def sched_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """What a schedule run did, and whether it met the case's
    expectations (schedule/cases.json `expect`). Commands from the fake
    galley's log; tasks made, changed and cancelled from its final state.
    Since ticket 41 a reminder for the user's own thing may hang on a
    to-do (`todo add --remind-at`): with `via: either` such a reminder
    counts as the one to set, with `via: schedule` (the default) only
    `schedule create` does. Ticket 44 (main chat PRD ruling 92) split the
    two: `via: todo` (something to get done) takes only a reminder on a
    to-do, and a nudge with nothing to finish keeps the default."""
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
        if exp.get("max_chars") and len(body) > exp["max_chars"]:
            reasons.append(f"太长：{len(body)} 字，上限 {exp['max_chars']}")
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
        "pass": not reasons,
        "reasons": reasons,
    }


def render_sched_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_case: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by_case.setdefault(r["id"], []).append(r)
    facts = {(r["id"], r["variant"]): sched_facts(r, next(c for c in cases if c["id"] == r["id"]))
             for r in data["results"] if any(c["id"] == r["id"] for c in cases)}
    out = [
        "# 定时与提醒评测结果（票 36，票 44、票 59、票 60 重跑）",
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
        "",
    ]
    if meta.get("history_note"):
        out += [meta["history_note"], ""]
    sup = meta.get("superseded_runs") or []
    for n, group in enumerate([sup] if isinstance(sup, dict) else sup, 1):
        out += [f"注 {n}：{group['reason']}被替换的 {len(group['runs'])} 次运行原样留在 results.json 的 "
                f"`meta.superseded_runs[{n - 1}]` 里。", ""]
    out += rerun_section(data, cases, sched_facts, "60") + rerun_section(data, cases, sched_facts, "59")
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
            "| # | 用例 | 遍 | 调了什么命令 | 回复原文 | 字数 | 读手册 | 建前查过 | 判定 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for case in cases:
        for r in sorted(by_case.get(case["id"], []), key=lambda r: r.get("repeat", 0)):
            f = facts[(r["id"], r["variant"])]
            cmds = "；".join(short_cmd(c, 220) for c in f["commands"] if cli_name(c.split()) != "help") or "—"
            if f["asked_via_tool"]:
                reply = one_line(f["body"] + "（ask_user：" + str(f["asked_via_tool"].get("question", "")) + "）")
            else:
                reply = one_line(f["body"]) or "（空）"
            verdict = "过" if f["pass"] else "不过：" + "；".join(f["reasons"])
            out.append(f"| {case['no']} | {case['id']} | {r['repeat']} | {cmds.replace('|', '/')} | {reply} | "
                       f"{f['chars']} | {f['manual']} | {f['listed']} | {verdict.replace('|', '/')} |")
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
                out.append(f"- `{t['id']}` {t['fireAt']}{where}{fired}：{t['prompt']}")
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
                            + (f" 挂在待办 `{t['todoId']}` 上" if t.get("todoId") else "") + f"：{t['prompt']}"
                            for t in f["made"]) or "无"
            if f["made_todos"]:
                made += "；记下的待办：" + "；".join(todo_gist(t) for t in f["made_todos"])
            out += [f"结束：{STOP_LABELS.get(f['stop'], f['stop'])}；读手册：{f['manual']}；建前查过：{f['listed']}；"
                    f"手册版本：`{r.get('manual_sha', '?')}`。", "",
                    f"新建：{made}；删除：{'、'.join(f['cancelled']) or '无'}；改动：{'、'.join(f['changed']) or '无'}。", ""]
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


def todo_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """What a to-do run did, and whether it met the case's expectations
    (todo/cases.json `expect`). Commands from the fake galley's log; to-dos
    and tasks made, changed, ticked off and cancelled from its final
    state. Ticket 60: `follow_up` (one follow-up, a to-do with its
    reminder or its own, in a window), `todo: optional` (a to-do may be
    noted, its reminder as `reminder` says), `cancel` (one of these
    cancelled in this run, at the user's request, the kind in the
    reason), `asks_or_any`, and `record_only` (judged by no one: `pass`
    is None); `flags` note what passes but is worth a look."""
    exp = case["expect"]
    now = datetime.fromisoformat(r["now"])
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
    if stop not in ("final_reply", "ask_user"):
        reasons.append("没走到最终回复：" + STOP_LABELS.get(stop, str(stop)))
    if held:
        reasons.append("用了会卡住主对话的命令：" + "、".join(sorted(set(held))))
    if "session new" in names or "<subtask>" in reply:
        reasons.append("开了子任务或新会话")
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
            elif not in_window(at, fu["window"]):
                reasons.append("跟进时间不对：" + local_words(at))
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
    changed_status = [tid for tid, t in todo_by_id.items() if tid in fx_todos
                      and (bool(t.get("doneAt")) != bool(fx_todos[tid].get("doneAt"))
                           or bool(t.get("cancelledAt")) != bool(fx_todos[tid].get("cancelledAt")))
                      and tid not in (exp.get("done") or []) and tid not in ((cx or {}).get("any_of") or [])]
    if changed_status:
        reasons.append("动了不该动的待办：" + "、".join(todo_by_id[x]["title"] for x in changed_status))
    if exp.get("reads_list"):
        if first_list is None:
            reasons.append("回答之前没读 `todo list`")
    extra = sorted({n for n in writes if n not in allowed})
    if extra:
        reasons.append("多余的写命令：" + "、".join(extra))
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
        if exp.get("max_chars") and len(body) > exp["max_chars"]:
            reasons.append(f"太长：{len(body)} 字，上限 {exp['max_chars']}")
    if memory_writes:
        flags.append("写了记忆：" + "、".join(os.path.basename(x) for x in memory_writes))
    record = bool(exp.get("record_only"))
    return {
        "commands": [" ".join(a) for a in log],
        "names": names,
        "writes": writes,
        "made_todos": made_todos,
        "cancelled_todos": [t["id"] for t in cancelled_todos],
        "memory_writes": memory_writes,
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
        "chars": len(body),
        "suggestion": r.get("next_suggestion"),
        "asked_via_tool": asked,
        "manual": manual,
        "manual_reads": reads,
        "listed": listed,
        "stop": stop,
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


def render_todo_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_case: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by_case.setdefault(r["id"], []).append(r)
    facts = {(r["id"], r["variant"]): todo_facts(r, next(c for c in cases if c["id"] == r["id"]))
             for r in data["results"] if any(c["id"] == r["id"] for c in cases)}
    out = [
        "# 待办评测结果（票 41，票 44、票 59、票 60 重跑）",
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
    out += rerun_section(data, cases, todo_facts, "60") + rerun_section(data, cases, todo_facts, "59")
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
            if f["memory_writes"]:
                out += ["写进记忆：" + "、".join(f"`{os.path.basename(x)}`" for x in f["memory_writes"]), ""]
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
    aside = [x for x in f["reasons"] if x.startswith(CHAT_ASIDE)]
    kept = [x for x in f["reasons"] if x not in aside]
    out = dict(f, reasons=kept, aside=aside)
    out["pass"] = None if f["pass"] is None else not kept
    return out


def render_chat_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by_id = {c["id"]: c for c in cases}
    runs = [r for r in data["results"] if r["id"] in by_id]
    facts = {(r["id"], r["variant"]): chat_facts(r, by_id[r["id"]]) for r in runs}
    judged = [f for f in facts.values() if f["pass"] is not None]
    set_any = [k for k, f in facts.items() if f["made_todos"] or any(not t.get("cancelledAt") for t in f["made_tasks"])]
    out = [
        "# 闲聊用例重跑（票 60）",
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
        "",
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
                    "todo-maybe-hotpot": ("maybe-hotpot", "todo-maybe"),
                    "todo-wake-recite": ("wake-reno", "todo-recite"),
                    "todo-wake-use": ("wake-reno", "todo-put-to-use")}
    for run_id, (case_id, script) in todo_scripts.items():
        for job in make_sched_jobs([tcases[case_id]], snow, mykeys, ga_lang, set(), 1, script, suite="todo"):
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

    dry_test_wake([r for r in results if r["id"].startswith("wake-")], wake_scripts, wcases, check)
    dry_test_sched([r for r in results if r["id"].startswith("sched-")], sched_scripts, scases, snow, check)
    dry_test_todo([r for r in results if r["id"].startswith("todo-")], todo_scripts, tcases, snow, check)
    dry_test_chat([r for r in results if r["id"].startswith("chat-")], chat_scripts, ccases, check)
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
                  cases: dict[str, dict[str, Any]], check: Any) -> None:
    """Wake suite: the prompt names the manual where the run's state root
    has it; the wake note is the new user message after the history; the
    model's shell reaches the fake galley (discovery line with sed, reads,
    a send, state kept, a refused flag, a holding command) and nothing
    outside the sandbox; ask_user ends the run; the judge reads it."""
    words = load_wording()["draft"]
    for r in sorted(results, key=lambda r: r["id"]):
        script = scripts[r["id"]]
        case = cases[r["id"][len("wake-"):]]
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
            check(f["held"] == ["session wait"] and not f["pass"]
                  and any("卡住" in x for x in f["reasons"]), "the judge flags the holding command")
            check(f["no_reply"] and f["manual"].startswith("读了"), "no-reply and manual read are recognized")
            check(r["stop_reason"] == "final_reply" and r["llm_calls"] == 3, "three model calls, final reply")
        else:
            check(r["stop_reason"] == "ask_user" and r["llm_calls"] == 1 and not r.get("galley_log"),
                  "ask_user ends the run, nothing reached the CLI")
            check(f["asked_via_tool"] and "验证码" in f["asked_via_tool"]["question"] and f["pass"],
                  f"the judge reads the ask_user question ({f['reasons']})")


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
    plain = sched_prompt(cases["report-wed"], now)
    held = sched_prompt(cases["already-set"], now)
    check("### In Hand" not in plain and "### In Hand" in held, "In Hand only when a case has tasks from before")
    check(held.index("## Main Chat\n") < held.index("### In Hand") < held.index("## Galley Main Chat Entry Layer")
          and "`sched_6c1f0e9a2b7d4385` " in held, "In Hand sits between Main Chat and the entry layer")
    check("Reminders and scheduled tasks are not on this list" in plain
          and "Channels, scheduled tasks, Browser" not in plain
          and "Note what the user has to do" in plain
          and "or what comes up on a date and will be worth raising then" in plain
          and "left: see `todos.md` in your manual." in plain
          and "Your manual is in `__MANUAL_DIR__`, one file per part." in plain, "the ticket 60 prompt")
    check(held.index("### In Hand") < held.index("What you are on (") and "The user's to-dos" not in held,
          "a case's own reminder is in the What-you-are-on group")
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
    note = sched_note(cases["wake-todo"], now)
    check("on the user's to-do `todo_2b3c4d5e6f7a8b9c` came due." in note and "交给王经理\n>>>\nIt is due " in note,
          "the wake note for a to-do's reminder, in Core's words")
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
        elif r["id"] == "todo-maybe-hotpot":
            check(f["pass"] is None and len(f["made_tasks"]) == 1, f"two-sided: recorded, not judged ({f['reasons']})")
        elif r["id"] == "todo-wake-recite":
            check(f["pass"] is False and any("只复述了提醒" in x for x in f["reasons"]),
                  f"a reminder recited: fails ({f['reasons']})")
        elif r["id"] == "todo-wake-use":
            check(f["pass"] is True and not f["names"], f"what is of use now, nothing touched: passes ({f['reasons']})")
        else:
            check(f["pass"] and not f["names"] and "on the user's to-do" in r["message"],
                  f"a to-do's reminder: a sentence, nothing touched ({f['reasons']})")


def dry_test_chat(results: list[dict[str, Any]], scripts: dict[str, tuple[str, str]],
                  cases: dict[str, dict[str, Any]], check: Any) -> None:
    """Chat suite (ticket 60): the entry layer's cases under today's main
    chat prompt (a carried case with Rust's carried wording), the manual
    in the state root, no In Hand; judged on what it set."""
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
    ap.add_argument("--suite", choices=("entry", "dispatch", "wake", "schedule", "todo", "chat"), default="entry",
                    help="entry: cases.json WITHOUT / WITH; dispatch: dispatch-cases.json T / C / P; "
                         "wake: wake/cases.json under the wordings of wake/wording.md; "
                         "schedule: schedule/cases.json (ticket 36); todo: todo/cases.json (ticket 41); "
                         "chat: cases.json under today's main chat prompt, judged by chat/cases.json (ticket 60)")
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
    sched = args.suite == "schedule" or todo or chat
    sandbox_mode = dispatch and args.mode == "sandbox"
    if todo:
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
    for r in results:
        if r.get("request") and r["status"] == "ok":
            if sched:
                write_composed(r, "", TODO_COMPOSED_DIR if todo else SCHED_COMPOSED_DIR)
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
            "suite": "wake (ticket 30, rerun for ticket 59): the main chat prompt (regenerated for ticket 59: its "
                     "entry layer and today's static rules), the assistant manual's parts in the state root, a wake "
                     "note filled from wording.md",
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
    for key in ("ticket59_note", "ticket59_control", "ticket60_note"):
        if previous_meta.get(key):
            data["meta"][key] = previous_meta[key]
    if sched:
        data["meta"].update({
            "suite": ("chat (ticket 60): the entry layer's cases.json under the main chat prompt of ticket 60 "
                      "(schedule/galley-prompt/, carried-1 for the carried cases), the assistant manual's parts in "
                      "the state root, the to-do suite's sandbox and fake galley with nothing in it; judged only on "
                      "the to-dos and reminders set (chat/cases.json)" if chat else
                      "todo (ticket 41, rerun for ticket 44): the main chat prompt with the ticket 41 entry layer, "
                      "In Hand lines (ticket 39's three groups) for to-dos and tasks from before the segment, the "
                      "assistant manual (ticket 44's text, in parts since ticket 59) in the state root, the case's "
                      "to-dos and tasks in the fake galley; rerun for tickets 59 and 60 (ticket 60's cases added; "
                      "In Hand's fourth group, ticket 61, for the cases that start with a follow-up turned down)"
                      if todo else
                      "schedule (ticket 36, rerun for tickets 41 and 44): the main chat prompt with the ticket 41 "
                      "entry layer and its own configuration paragraph, In Hand lines (ticket 39's three groups) for "
                      "tasks from before the segment, the assistant manual (ticket 44's text, in parts since ticket "
                      "59) in the state root, the case's tasks in the fake galley; rerun for tickets 59 and 60"),
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
