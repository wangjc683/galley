#!/usr/bin/env python3
"""IM entry layer comparison (im-polish ticket 02). Results in results.md.

Each case is one Telegram message in a fresh chat, run with the real model
under the prompt an IM channel gets (`compose_im_runtime_prompt` + the IM
entry layer, as the real Rust code wrote them into galley-prompt/):

  without    the entry layer as it is before ticket 02
  with       the entry layer with ticket 02's first paragraph as JC took
             it (2026-10-21)
  with_long  (the cases that list it) the same, with the first paragraph
             replaced by cases.json `alt_paragraphs.with_long`: the first
             draft, which also said to look desktop conversations up and
             where reminders are set
  with_ask   (the cases that list it) `alt_paragraphs.with_ask`: that
             draft saying it cannot see the desktop's conversations

The machinery is the main chat eval's (.scratch/main-chat/entry-layer-eval/
run.py), imported as a module and not changed: its worker sets up the
bundled engine as the runner does and runs the model's tool calls inside a
per-run macOS sandbox (fake HOME, fake Galley CLI, no network but the model
API). What this script adds: the IM prompt, the Supervisor SOP where Core
writes it for IM (`<state root>/im/reference/`), the message as tgapp sends
it (FILE_HINT + text), a fake CLI that also answers `sessions search` from
the fixture and keeps sessions it starts, the model read from Galley's
database (ChatGPT sign-in included), and IM facts per run.

Usage:

  python3 run.py --dry-test                no model: verify the setup and the guards
  python3 run.py                           every case, without / with (+ with_ask), 2 runs each
  python3 run.py --cases disk --variant with --repeats 1   partial rerun (merged)
  python3 run.py --render-only             rebuild results.md from results.json

The ChatGPT sign-in's access token is read from a private copy of Galley's
database (the WAL included, so the copy sees what Core last wrote) and used
as it is: this script never refreshes it (a refresh would rotate the token
Core holds). It refuses to start when the token has less than
--min-token-minutes left; Galley refreshes it when one of its sessions next
uses the model.

The disk case reads this machine's real disk figures. Cases with
`mask_numbers` (cases.json) get them replaced with placeholders (sizes X,
percentages Y, raw counts N) in every result before anything is written
(mask_numbers below). A new case that reads real machine figures needs the
flag too; grep the results for them before committing.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BASE_PATH = REPO / ".scratch" / "main-chat" / "entry-layer-eval" / "run.py"
CASES = HERE / "cases.json"
PROMPT_DIR = HERE / "galley-prompt"
RESULTS_JSON = HERE / "results.json"
RESULTS_MD = HERE / "results.md"
COMPOSED_DIR = HERE / "composed"
SOP_SRC = REPO / "docs" / "integrations" / "galley-supervisor-sop.md"
REF_SRC = REPO / "docs" / "integrations" / "galley-supervisor-reference.md"
SIWC_SRC = REPO / "core" / "src" / "chatgpt_siwc" / "mod.rs"

PLATFORM = "telegram"
PLATFORM_LABEL = "Telegram"
SUPERVISOR_ID = "galley-im/telegram"
# frontends/chatapp_common.py FILE_HINT; tgapp._build_text_prompt puts it
# before every text message.
FILE_HINT = "If you need to show files to user, use [FILE:filepath] in your response."
VARIANTS = ("without", "with", "with_long", "with_ask")
REPEATS = 2
TOOL_CAP = 10
DUMP_RUNS = (("desktop-earbuds", "without-1"), ("desktop-earbuds", "with_long-1"), ("disk", "with-1"))
DEFAULT_MODEL_ID = "mm_chatgpt_codex_gpt_55"  # gpt-6.1-sol, first in Settings -> Models: what IM runs on
DEFAULT_GALLEY_DB = Path.home() / "Library" / "Application Support" / "app.galley" / "workbench.db"

ENTRY_HEAD = "## Galley IM Entry Layer\n\n"
ENTRY_NEXT = "\n\nYour replies are read on a phone screen:"


def load_base() -> Any:
    spec = importlib.util.spec_from_file_location("entry_layer_base", BASE_PATH)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {BASE_PATH}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["entry_layer_base"] = mod
    spec.loader.exec_module(mod)
    return mod


base = load_base()
fail = base.fail


# ----------------------------------------------------------------------
# Prompt
# ----------------------------------------------------------------------

def first_paragraph(entry: str) -> str:
    if not entry.startswith(ENTRY_HEAD) or entry.count(ENTRY_NEXT) != 1:
        fail("entry layer: unexpected shape")
    return entry[len(ENTRY_HEAD):entry.index(ENTRY_NEXT)]


def entry_layer(variant: str, alt: dict[str, str]) -> str:
    """The IM entry layer of one variant, SOP path left as __SOP_PATH__."""
    if variant == "without":
        return (PROMPT_DIR / "im_entry.telegram.without.txt").read_text(encoding="utf-8")
    entry = (PROMPT_DIR / "im_entry.telegram.with.txt").read_text(encoding="utf-8")
    if variant == "with":
        return entry
    para = alt[variant].replace("{platform_label}", PLATFORM_LABEL)
    return entry.replace(first_paragraph(entry), para, 1)


def galley_prompt(variant: str, alt: dict[str, str]) -> str:
    """What runner.managed_runtime.managed_prompt_profile composes for an
    IM channel: GALLEY_RUNTIME_PROMPT_TEXT (compose_im_runtime_prompt)
    and GALLEY_IM_SUPERVISOR_PROMPT_TEXT, each stripped, joined by a blank
    line. The SOP path becomes the run's state root (run_job fills
    __MANUAL_DIR__, see install_base_patches)."""
    runtime = (PROMPT_DIR / "im_runtime.txt").read_text(encoding="utf-8").strip()
    entry = entry_layer(variant, alt).strip()
    if entry.count("__SOP_PATH__") != 1:
        fail("entry layer: no __SOP_PATH__ placeholder")
    entry = entry.replace("__SOP_PATH__", "__MANUAL_DIR__/galley-supervisor-sop.md")
    return runtime + "\n\n" + entry


# ----------------------------------------------------------------------
# Fake Galley CLI: the wake suite's, plus `sessions search` over the
# fixture and sessions that `session new` starts (listed, briefed, still
# running when waited on).
# ----------------------------------------------------------------------

SEARCH_BLOCK = r'''if cmd == ("sessions", "search"):
    need(1, "<QUERY>")
    # IM eval: every word must appear (FTS's implicit AND, case-insensitive);
    # the snippet marks the first one, as the real CLI's <mark>.
    terms = [t.lower() for t in rest[0].split() if t]
    hits = []
    for sid in fx["order"] + list(state["created"]):
        if sid in state["deleted"] or (flags.get("session") and sid != flags["session"]):
            continue
        b = brief(sid)
        if b["status"] == "archived" and not flags.get("all"):
            continue
        for m in rows(sid):
            body = str(m.get("content") or "")
            low = body.lower()
            if not terms or not all(t in low for t in terms):
                continue
            i, n = low.find(terms[0]), len(terms[0])
            a = max(0, i - 30)
            snip = ("…" if a else "") + body[a:i] + "<mark>" + body[i:i + n] + "</mark>" + body[i + n:i + n + 60]
            if i + n + 60 < len(body):
                snip += "…"
            hits.append({"messageId": m["id"], "sessionId": sid, "sessionTitle": b.get("title"),
                         "role": "assistant" if m["role"] == "agent" else m["role"],
                         "turnIndex": m.get("turnIndex", 0), "snippet": snip,
                         "sessionActivityAt": b.get("lastActivityAt"), "createdAt": m.get("createdAt")})
    out(*hits)
'''

NEW_BLOCK = r'''if cmd == ("session", "new"):
    need(1, "<TASK>")
    # IM eval: the session it starts is kept, so a later list / brief /
    # wait sees it; it is still working when waited on.
    sid = "s-new" + str(len(state["created"]) + 1).zfill(4)
    row = {"pinned": False, "hasUnread": False, "runtimeKind": "managed", "runtimeLabel": "Galley",
           "gaRuntimeKind": "managed", "promptProfile": "galley-runtime-v1", "id": sid, "title": "新对话",
           "status": "idle", "turnCount": 1, "lastActivityAt": fx["now"], "createdAt": fx["now"],
           "updatedAt": fx["now"], "live": {"runnerAlive": True, "agentRunning": True, "openRun": True,
                                            "queuedCount": 0, "busy": True, "askPending": False, "lastExit": None}}
    origin = {"via": "cli"}
    if flags.get("supervisor"):
        origin = {"via": "supervisor", "supervisor": flags["supervisor"]}
        if flags.get("reason"):
            origin["reason"] = flags["reason"]
        row["origin"] = origin
    if flags.get("project"):
        row["projectId"] = flags["project"]
    state["created"][sid] = row
    sessions[sid] = row
    msg = {"id": "msg_" + sid + "_0_user", "sessionId": sid, "role": "user", "content": rest[0],
           "createdAt": fx["now"], "turnIndex": 0, "origin": origin, "visibility": "visible"}
    state["sent"].append(msg)
    out({"session": brief(sid), "message": msg, "dispatch": "dispatched"})
'''

WAIT_BLOCK = r'''if cmd == ("session", "wait") and rest[:1] and rest[0] in state["created"]:
    # IM eval: a session it started is still working (a long job).
    tail = rows(rest[0])[-int(flags.get("tail") or 20):]
    out({"schemaVersion": 3, "stream": "wait", "phase": "initial", "session": brief(rest[0]), "messages": tail},
        {"schemaVersion": 3, "stream": "wait", "phase": "final", "status": "timed_out", "session": brief(rest[0]),
         "messages": tail},
        {"schemaVersion": 3, "stream": "end", "reason": "timed_out"})
'''


def patched_fake_galley(text: str) -> str:
    def put(anchor: str, new: str, before: bool = True, replace: bool = False) -> None:
        nonlocal text
        if text.count(anchor) != 1:
            fail(f"fake galley anchor not unique: {anchor[:50]!r} ({text.count(anchor)})")
        if replace:
            text = text.replace(anchor, new)
        else:
            text = text.replace(anchor, new + anchor if before else anchor + new)

    put('sessions = fx["sessions"]\n', 'sessions = dict(fx["sessions"], **state.setdefault("created", {}))\n',
        replace=True)
    put('    show = [sid for sid in fx["order"]\n', '    show = [sid for sid in fx["order"] + list(state["created"])\n',
        replace=True)
    put('if cmd == ("sessions", "search"):\n    need(1, "<QUERY>")\n    out()\n', SEARCH_BLOCK)
    put('if cmd == ("session", "new"):\n', NEW_BLOCK)
    put('if cmd == ("session", "wait"):\n    need(1, "<ID>")\n    known(rest[0])\n', WAIT_BLOCK)
    return text


def install_base_patches() -> None:
    """In this (parent) process: run_job starts this file as the worker,
    copies the SOP and its reference where Core writes them for IM (in
    place of the main chat's manual) and fills __MANUAL_DIR__ with that
    directory; build_sandbox writes the patched fake CLI."""
    base.__file__ = str(Path(__file__).resolve())
    base.MANUAL_STATE_DIR = ("im", "reference")
    base.manual_parts = lambda: [REF_SRC, SOP_SRC]
    base.FAKE_GALLEY_WAKE = patched_fake_galley(base.FAKE_GALLEY_WAKE)


# ----------------------------------------------------------------------
# Fixture and jobs
# ----------------------------------------------------------------------

def fixture(case: dict[str, Any], now: datetime) -> dict[str, Any]:
    """The schedule suite's fixture (the main chat, a conversation of the
    user's, one an outside agent started; models, a project; no tasks, no
    to-dos), with the case's desktop conversation in the main chat about
    40 minutes ago, and the main chat idle."""
    fx = base.sched_fixture({"history": case.get("main_chat_history") or [], "tasks": []}, now)
    main = fx["sessions"][base.SESSION_ID]
    main["live"] = {"runnerAlive": True, "agentRunning": False, "openRun": False, "queuedCount": 0,
                    "busy": False, "askPending": False, "lastExit": "CURRENT_TASK_DONE"}
    rows = fx["messages"][base.SESSION_ID]
    if rows:
        main["lastActivityAt"] = main["updatedAt"] = rows[-1]["createdAt"]
    return fx


def variants_for(case: dict[str, Any], wanted: list[str]) -> list[str]:
    own = ["without", "with"] + list(case.get("variants") or [])
    return [v for v in own if v in wanted]


def make_jobs(cases: list[dict[str, Any]], variants: list[str], repeats: int, now: datetime,
              mykeys: dict[str, Any], ga_lang: str, allowed: set[str], alt: dict[str, str],
              dry: dict[tuple[str, str], str] | None = None, first: int = 1) -> list[dict[str, Any]]:
    jobs = []
    for case in cases:
        for variant in variants_for(case, variants):
            for n in range(first, first + repeats):
                label = f"{variant}-{n}"
                jobs.append({
                    "case_id": case["id"],
                    "variant": label,
                    "wording": variant,
                    "repeat": n,
                    "suite": "schedule",  # base.run_job then keeps the fake CLI's end state
                    "now": now.isoformat(timespec="seconds"),
                    "message": FILE_HINT + "\n\n" + case["message"],
                    "history": [],
                    "galley_prompt": galley_prompt(variant, alt),
                    "mykeys": mykeys,
                    "ga_lang": ga_lang,
                    "allowed_hosts": sorted(allowed),
                    "keep_request": (case["id"], label) in DUMP_RUNS or bool(dry),
                    "dry": (dry or {}).get((case["id"], variant)),
                    "sandbox": True,
                    "tool_cap": TOOL_CAP,
                    "wake": {"fixture": fixture(case, now), "files": case.get("files") or {},
                             "help": str(base.SCHED_CLI_HELP),
                             "extra_exec": list(base.SCHED_EXTRA_EXEC) + ["/bin/df"]},
                })
    return [j for j in jobs if j["dry"] or not dry]


# ----------------------------------------------------------------------
# Model
# ----------------------------------------------------------------------

def siwc_api_base() -> str:
    m = re.search(r'pub const SIWC_API_BASE: &str = "([^"]+)";', SIWC_SRC.read_text(encoding="utf-8"))
    if not m:
        fail("SIWC_API_BASE not found in core/src/chatgpt_siwc/mod.rs")
    return m.group(1)


def model_from_galley_db(db_path: Path, model_id: str, min_minutes: int) -> tuple[dict[str, Any], str]:
    """One managed model as Core hands it to the runner, from a private
    copy of Galley's database (database, WAL and shared-memory files
    copied into a 0700 temp directory and removed after; the originals
    are only read). Options merged as base.model_from_galley_db does. An
    API key is decrypted like credential_store::get_secret; a ChatGPT
    sign-in (chatgpt_codex_oauth) gives its stored access token, used as
    is and never refreshed, after checking it has min_minutes left."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        fail("reading the key from Galley's database needs the `cryptography` package")
    if not db_path.is_file():
        fail(f"Galley database not found: {db_path}")
    tmp = Path(tempfile.mkdtemp(prefix="im-eval-db-"))
    os.chmod(tmp, 0o700)
    try:
        for suffix in ("", "-wal", "-shm"):
            src = Path(str(db_path) + suffix)
            if src.is_file():
                shutil.copyfile(src, tmp / ("workbench.db" + suffix))
        con = sqlite3.connect(str(tmp / "workbench.db"))
        try:
            row = con.execute(
                "SELECT m.display_name, p.protocol, p.auth_kind, p.api_base, m.model, "
                "p.api_key_ref, m.preset_options, m.advanced_options "
                "FROM managed_models m JOIN managed_model_providers p ON p.id = m.provider_id "
                "WHERE m.id = ?", (model_id,)).fetchone()
            if row is None:
                fail(f"managed model {model_id} not found")
            display, protocol, auth_kind, api_base, model, key_ref, preset, overrides = row
            pref = con.execute("SELECT value FROM prefs WHERE key = 'managed_model_defaults'").fetchone()
            defaults = json.loads(pref[0]) if pref else {}
            options: dict[str, Any] = {}
            for layer in (json.loads(preset or "{}"), defaults if isinstance(defaults, dict) else {}):
                if isinstance(layer, dict):
                    options.update(layer)
            for k, v in (json.loads(overrides or "{}") or {}).items():
                if v is None:
                    options.pop(k, None)
                else:
                    options[k] = v
            secret = con.execute(
                "SELECT s.nonce, s.ciphertext, s.algorithm, s.encryption_version, k.key_material "
                "FROM managed_model_secrets s JOIN managed_model_secret_keys k ON k.key_id = s.key_id "
                "WHERE s.api_key_ref = ?", (key_ref,)).fetchone()
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if secret is None:
        fail(f"no stored credential for {model_id}")
    nonce, ciphertext, algorithm, version, key_material = secret
    if algorithm != "aes-256-gcm" or version != 1:
        fail("unsupported credential encryption")
    plain = AESGCM(bytes(key_material)).decrypt(bytes(nonce), bytes(ciphertext), key_ref.encode()).decode("utf-8")
    if auth_kind == "api_key":
        api_key, source = plain, f"Galley 托管模型 {model_id}（API key），从 Galley 数据库的副本只读取得"
    elif auth_kind == "chatgpt_codex_oauth":
        value = json.loads(plain)
        if value.get("flow") != "siwc" or not value.get("accessToken"):
            fail("the ChatGPT sign-in has no access token; sign in again in Galley")
        left = int(value.get("expiresAt") or 0) - int(time.time())
        if left < min_minutes * 60:
            fail(f"the stored ChatGPT access token has {max(left, 0) // 60} min left (need {min_minutes}); "
                 "it is not refreshed here — let a Galley session use the model, then run again")
        api_key, api_base = value["accessToken"], siwc_api_base()
        source = (f"Galley 托管模型 {model_id}（ChatGPT 套餐登录），访问令牌从 Galley 数据库的副本只读取得，"
                  "原样使用、不刷新")
    else:
        fail(f"auth kind {auth_kind} is not supported here")
    return {"displayName": display, "protocol": protocol, "authKind": auth_kind, "apiBase": api_base,
            "model": model, "apiKey": api_key, "advancedOptions": options}, source


def allowed_hosts(mykeys: dict[str, Any]) -> set[str]:
    host = urlparse(str(next(iter(mykeys.values())).get("apibase", ""))).hostname
    if not host:
        fail("model config has no api host")
    allowed = {host}
    for var in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        if os.environ.get(var):
            proxy = urlparse(os.environ[var]).hostname
            if proxy:
                allowed.add(proxy)
    return allowed


# ----------------------------------------------------------------------
# Facts per run (hints for the reader; the replies are what to judge)
# ----------------------------------------------------------------------

WRITES = {"session new", "session send", "session stop", "session archive", "session restore", "session move",
          "session btw", "project create", "project delete", "llm set", "llm set-default",
          "schedule create", "schedule update", "schedule delete", "schedule enable", "schedule disable",
          "schedule run", "todo add", "todo update", "todo done", "todo reopen", "todo cancel",
          "session rename", "session pin", "session unpin", "session delete"}
HOLDS = {"todo add", "todo update", "schedule create", "schedule update"}
INNER_RE = re.compile(r"(?i)\b(agents?|supervisors?|runners?|CLI|GenericAgent|subagents?)\b|智能体|实例|进程|子代理|代理人")
SESSION_WORD_RE = re.compile(r"(?i)\bsessions?\b|会话")
CLAIM_RE = re.compile(r"(设好了|设置好了|已设置|已经设置|已设好|已帮你设|帮你设好|已添加|加好了|定好了|记下了|已记下|记好了|"
                      r"已安排|到时(候)?(我)?会?提醒你|明早(八|8)点(我)?(会)?提醒你)")
SELF_RE = re.compile(r"助理|助手|assistant", re.IGNORECASE)


def display(reply: str | None) -> str:
    return base.strip_for_display(reply or "")


def im_facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    calls = r.get("calls") or []
    log = [c.get("argv") or [] for c in r.get("galley_log") or []]
    names = [base.cli_name(a) for a in log]
    writes = [a for a in log if base.cli_name(a) in WRITES]
    first_write = next((c["n"] for c in calls if any(base.cli_name(a) in WRITES for a in c.get("galley_calls") or [])),
                       None)

    def reads_sop(c: dict[str, Any]) -> bool:
        blob = json.dumps(c.get("args") or {}, ensure_ascii=False)
        return "galley-supervisor-sop.md" in blob

    sop_at = next((c["n"] for c in calls if reads_sop(c)), None)
    body = display(r.get("final_reply"))
    fx_state = r.get("fake_state") or {}
    made_tasks = [t for t in fx_state.get("tasks") or []]
    made_todos = [t for t in fx_state.get("todos") or []]
    mem = r.get("memory_changes") or {}
    facts: dict[str, Any] = {
        "cli": names,
        "writes": [" ".join(a) for a in writes],
        "write_flags_ok": all(f"--supervisor={SUPERVISOR_ID}" in a and any(x.startswith("--reason") for x in a)
                              for a in writes if base.cli_name(a) in WRITES - HOLDS),
        "sop_read_at": sop_at,
        "first_write_at": first_write,
        "sop_before_write": first_write is None or (sop_at is not None and sop_at < first_write),
        "tasks_made": len(made_tasks),
        "todos_made": len(made_todos),
        "memory_written": sorted(set(mem.get("added") or []) | set(mem.get("changed") or [])),
        "inner_words": sorted({m.group(0) for m in INNER_RE.finditer(body)}),
        "session_word": sorted({m.group(0) for m in SESSION_WORD_RE.finditer(body)}),
        "claims": sorted({m.group(0) for m in CLAIM_RE.finditer(body)}),
        "says_computer": "电脑" in body or "桌面" in body,
        "calls_self": sorted({m.group(0) for m in SELF_RE.finditer(body)}),
        "searched": "sessions search" in names,
        "read_desktop": any(base.cli_name(a) in ("session show", "session brief") and base.SESSION_ID in a
                            for a in log),
        "stop": r.get("stop_reason"),
        "tool_calls": len(calls),
        "llm_calls": r.get("llm_calls"),
    }
    if case.get("kind") == "desktop":
        terms = case.get("facts_from_desktop") or []
        said = [t for t in terms if t in body]
        seen = [t for t in terms if any(t in json.dumps(c.get("result") or "", ensure_ascii=False) for c in calls)]
        facts["desktop_terms_in_reply"] = said
        facts["unseen_terms_in_reply"] = [t for t in said if t not in seen]
    return facts


def facts_line(f: dict[str, Any], case: dict[str, Any]) -> str:
    bits = []
    if f["cli"]:
        bits.append("CLI：" + "、".join(dict.fromkeys(f["cli"])))
    else:
        bits.append("没用 CLI")
    if f["writes"]:
        ok = "带" if f["write_flags_ok"] else "没带全"
        bits.append(f"写命令 {len(f['writes'])} 个（--supervisor / --reason {ok}；"
                    + ("先读了 SOP" if f["sop_before_write"] else "写之前没读 SOP") + "）")
    if f["tasks_made"] or f["todos_made"]:
        bits.append(f"建了定时任务 {f['tasks_made']} 个、待办 {f['todos_made']} 件")
    if f["memory_written"]:
        bits.append("写了记忆：" + "、".join(f["memory_written"]))
    if case.get("kind") == "desktop":
        if f["searched"] or f["read_desktop"]:
            bits.append("查了桌面对话" + ("（读到原文）" if f["read_desktop"] else "（只搜索）"))
        else:
            bits.append("没查桌面对话")
        if f.get("unseen_terms_in_reply"):
            bits.append("回复里有没查到的桌面内容：" + "、".join(f["unseen_terms_in_reply"]))
    if f["claims"]:
        bits.append("回复里像是说已办好：" + "、".join(f["claims"]))
    if f["inner_words"]:
        bits.append("回复里有内部词：" + "、".join(f["inner_words"]))
    if f["session_word"]:
        bits.append("回复里有「会话 / session」")
    bits.append(f"{f['tool_calls']} 次工具调用、{f['llm_calls']} 次模型调用")
    if f["stop"] == "cap_reached":
        bits.append(f"结束：第 {TOOL_CAP + 1} 次工具调用到了上限，没有执行")
    elif f["stop"] != "final_reply":
        bits.append("结束：" + base.STOP_LABELS.get(f["stop"], str(f["stop"])))
    return "；".join(bits)


# ----------------------------------------------------------------------
# Masking this machine's real figures (cases with `mask_numbers`)
# ----------------------------------------------------------------------

SIZE_RE = re.compile(r"\d+(?:[.,]\d+)*(\s*)(TiB|GiB|MiB|TB|GB|MB|Ti|Gi|Mi|T|G|M)(?![A-Za-z])")
PCT_RE = re.compile(r"\d+(?:\.\d+)?(\s*)[%％]")
NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")


def mask_prose(text: str) -> str:
    """Sizes become X, percentages Y (「约 123 GB（45%）」 → 「约 X GB（Y%）」)."""
    return PCT_RE.sub(lambda m: "Y" + m.group(1) + "%", SIZE_RE.sub(lambda m: "X" + m.group(1) + m.group(2), text))


def mask_output(text: str) -> str:
    """Tool output: every number in a token becomes N, except in tokens
    that are paths (device names, $TMPDIR/…), which carry no figures."""
    return re.sub(r"\S+", lambda m: m.group(0) if "/" in m.group(0) or "$" in m.group(0)
                  else NUM_RE.sub("N", m.group(0)), text)


def mask_numbers(results: list[dict[str, Any]], cases: dict[str, dict[str, Any]]) -> None:
    """In place, for the runs of cases with `mask_numbers`: the replies,
    the model's text and reasoning in every turn, and every tool result."""
    for r in results:
        if not (cases.get(r.get("id")) or {}).get("mask_numbers"):
            continue
        for k in ("reply", "final_reply", "thinking"):
            if isinstance(r.get(k), str):
                r[k] = mask_prose(r[k])
        for t in r.get("turns") or []:
            for k in ("content", "thinking"):
                if isinstance(t.get(k), str):
                    t[k] = mask_prose(t[k])
        for c in r.get("calls") or []:
            if c.get("result") is not None:
                c["result"] = mask_strings(c["result"])


def mask_strings(value: Any) -> Any:
    """mask_output on every string inside a tool result (a code_run result
    is {status, stdout, exit_code}); other values as they are."""
    if isinstance(value, str):
        return mask_output(value)
    if isinstance(value, list):
        return [mask_strings(v) for v in value]
    if isinstance(value, dict):
        return {k: mask_strings(v) for k, v in value.items()}
    return value


# ----------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------

VARIANT_TITLES = {"without": "WITHOUT（票 02 之前）", "with": "WITH（定稿）", "with_long": "WITH-long（初稿，较长）",
                  "with_ask": "WITH-ask（初稿改成说看不到、请他说要点）"}


def quote(text: str) -> list[str]:
    if not text.strip():
        return ["> （空）", ""]
    return ["> " + line if line.strip() else ">" for line in text.strip().splitlines()] + [""]


def call_lines(r: dict[str, Any]) -> list[str]:
    out = []
    for c in r.get("calls") or []:
        gist = base.call_gist(c)
        argvs = c.get("galley_calls") or []
        detail = ""
        if argvs:
            # Scrubbed before it is cut, so a cut cannot split a path prefix.
            detail = "：" + "；".join("`galley " + base.short_cmd(base.scrub(" ".join(a)), 140).replace("`", "'")
                                      + "`" for a in argvs)
        elif c["name"] == "code_run":
            script = str((c.get("args") or {}).get("script") or (c.get("args") or {}).get("code") or "")
            detail = "：`" + base.one_line(base.scrub(script))[:120].replace("`", "'") + "`"
        out.append(f"{c['n']}. {gist}{detail}")
    return out


def render_md(data: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    meta = data["meta"]
    by = {}
    for r in data["results"]:
        by.setdefault(r["id"], []).append(r)
    lines = [
        "# IM 入口层对照（票 02）",
        "",
        f"跑于 {meta['ran_at']}" + (f"（补跑：{'；'.join(x['at'] + ' ' + str(len(x['runs'])) + ' 次' for x in meta['partial_reruns'])}）"
                                     if meta.get("partial_reruns") else "")
        + f"。模型 {meta['model']['name']}（{meta['model_source']}；推理强度 "
        + f"{meta['model']['options'].get('reasoning_effort')}），平台 Telegram，每个用例每组 {meta['repeats']} 遍，"
        + f"共 {len(data['results'])} 次运行、{meta['llm_calls_total']} 次模型调用。",
        "",
        "## 怎么跑的",
        "",
        "- 提示词：Galley 那段是真实 Rust 代码写出的 IM 组合（`galley-prompt/`：`compose_im_runtime_prompt` 与 "
        "`im_supervisor_prompt`，平台 Telegram），按 runner 的 `managed_prompt_profile` 拼接；GA 核心提示词与记忆由引擎自己拼。"
        "WITHOUT 是票 02 之前的入口层，WITH 只换第一段（JC 定稿的写法）；WITH-long 是初稿，WITH-ask 是初稿改成说看不到"
        "（`cases.json` 的 `alt_paragraphs`），只跑在列了它们的用例上。",
        "- 消息照 tgapp 的写法发：`FILE_HINT` 一行加空行加用户的话；每次都是新对话，没有历史。",
        "- Supervisor SOP 与它链接的参考写在状态根的 `im/reference/`（Core 给 IM 写的位置），提示词里的路径指向它。",
        "- 工具真的执行，但只在每次运行自己的沙盒里（假 HOME、没有网络，可启动的程序只有解释器、bash / sh、假 `galley` 与 "
        "`sed`、`cat`、`head`、`tail`、`ls`、`grep`、`wc`、`sleep`、`date`、`df`）；浏览器工具、`ask_user` 停在那里不执行；"
        f"每次最多 {meta['tool_cap']} 次工具调用。状态根是全新安装的样子（记忆只有种子），记忆写进去会记下。",
        "- 假 `galley`：主对话、用户自己的一个对话、外部 agent 开的一个会话、一个项目、三个模型；`desktop-earbuds` 的主对话里有"
        "约 40 分钟前问耳机的那一轮。`sessions search` 按词在这些对话里找（每个词都要出现），`session show` / `brief` 照原文答；"
        "`session new` 开出的会话之后列得出、读得到，`session wait` 它时回 `timed_out`（长活还在跑）；`schedule` / `todo` "
        "的写命令照真 CLI 的形状记下。",
        "- 没复现：真实工具结果之外的东西（Telegram 的显示、过程按钮、完成汇报回到聊天），`session wait` 的真实等待时长，"
        "JC 真实的 GA 记忆；每组只跑两遍，看不出更细的波动。",
        "- 每条运行下面的「事实」是脚本数出来的提示，不是判定；判定看回复本身。",
        "- 磁盘用例的数字已换成占位（容量、用量、剩余量写成 X，百分比写成 Y，工具输出里的原始数字写成 N）："
        "那是跑评测这台 Mac 的真实数字。",
    ] + [f"- {n}" for n in meta.get("notes") or []] + [
        "",
        "## 措辞",
        "",
    ]
    prompts = meta.get("first_paragraphs") or {}
    for v in VARIANTS:
        if v in prompts:
            grow = len(prompts[v].encode()) - len(prompts["without"].encode())
            size = f"（这一段 {len(prompts[v].encode())} 字节" + (f"，比 WITHOUT 多 {grow}）" if v != "without" else "）")
            lines += [f"### {VARIANT_TITLES[v]}{size}", "", "```text", prompts[v], "```", ""]
    lines += ["## 一览", "", "| 用例 | 组 | 第几遍 | 事实 |", "|---|---|---|---|"]
    order = {c["id"]: i for i, c in enumerate(cases)}
    case_of = {c["id"]: c for c in cases}
    for cid in sorted(by, key=lambda x: order.get(x, 99)):
        for r in by[cid]:
            f = im_facts(r, case_of[cid]) if r.get("status") == "ok" else None
            lines.append(f"| {cid} | {VARIANT_TITLES.get(r.get('wording'), r.get('wording')).split('（')[0]} | "
                         f"{r.get('repeat')} | {facts_line(f, case_of[cid]) if f else '运行失败：' + str(r.get('error', r.get('status')))[:80]} |")
    lines.append("")
    lines += ["## 逐用例", ""]
    for i, case in enumerate(cases, 1):
        runs = by.get(case["id"]) or []
        if not runs:
            continue
        lines += [f"### {i}. `{case['id']}`：「{case['message']}」", ""]
        if case.get("main_chat_history"):
            lines += ["电脑上的 Galley 对话里，约 40 分钟前：", ""]
            for m in case["main_chat_history"]:
                who = "用户" if m["role"] == "user" else "Galley"
                lines += quote(f"**{who}**：" + m["content"])
        for v in VARIANTS:
            vr = sorted((r for r in runs if r.get("wording") == v), key=lambda r: r.get("repeat", 0))
            for r in vr:
                lines += [f"#### {VARIANT_TITLES[v]} 第 {r.get('repeat')} 遍", ""]
                if r.get("status") != "ok":
                    lines += [f"运行失败：{str(r.get('error', r.get('status')))[:300]}", ""]
                    continue
                f = im_facts(r, case)
                steps = call_lines(r)
                if steps:
                    lines += ["过程：", ""] + steps + [""]
                lines += ["回复："] + [""] + quote(display(r.get("final_reply")))
                lines += [f"事实：{facts_line(f, case)}", ""]
    usage = meta.get("usage_total") or {}
    lines += ["## 用量", "", f"输入 {usage.get('input_tokens', 0)} token（缓存命中 {usage.get('cached_tokens', 0)}），"
              f"输出 {usage.get('output_tokens', 0)} token（推理 {usage.get('reasoning_tokens', 0)}）。", ""]
    return "\n".join(lines).rstrip() + "\n"


def summarize_usage(results: list[dict[str, Any]]) -> dict[str, int]:
    """Responses API usage (input / output tokens) and Chat Completions
    usage (prompt / completion tokens), summed."""
    total = {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "reasoning_tokens": 0}
    for r in results:
        for u in r.get("usage") or []:
            total["input_tokens"] += int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
            total["output_tokens"] += int(u.get("output_tokens") or u.get("completion_tokens") or 0)
            details = u.get("input_tokens_details") or u.get("prompt_tokens_details") or {}
            total["cached_tokens"] += int(details.get("cached_tokens") or 0)
            out = u.get("output_tokens_details") or u.get("completion_tokens_details") or {}
            total["reasoning_tokens"] += int(out.get("reasoning_tokens") or 0)
    return total


def slim(r: dict[str, Any]) -> None:
    """Drop the Responses API's per-item token attribution from the usage
    records (most of results.json otherwise); the totals stay."""
    for u in r.get("usage") or []:
        if isinstance(u, dict):
            u.pop("attribution", None)


def write_composed(r: dict[str, Any]) -> None:
    """The full first request of one run: instructions (the system prompt),
    the input items, the tools offered."""
    req = r.get("request") or {}
    if not req:
        return
    COMPOSED_DIR.mkdir(exist_ok=True)
    names = [t.get("function", t).get("name") for t in req.get("tools", [])]
    lines = [f"# Request sent to the model: {r['id']} / {r['variant']}",
             f"# model={req.get('model')} reasoning={req.get('reasoning')} stream={req.get('stream')} "
             f"store={req.get('store')}",
             "# tools offered: " + ", ".join(names), "",
             "======== instructions ========", str(req.get("instructions") or ""), ""]
    for item in req.get("input") or []:
        content = item.get("content")
        if isinstance(content, list):
            content = "\n".join(str(b.get("text", f"[{b.get('type')}]")) for b in content if isinstance(b, dict))
        lines += [f"======== {item.get('role') or item.get('type')} ========", str(content), ""]
    (COMPOSED_DIR / f"{r['id']}.{r['variant']}.txt").write_text(base.scrub("\n".join(lines)), encoding="utf-8")


# ----------------------------------------------------------------------
# Dry test
# ----------------------------------------------------------------------

DRY_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
echo "cli=${GALLEY##*/}"
"$GALLEY" sessions search "耳机" --runtime all --all | head -3
"$GALLEY" sessions search "WH-1000XM6 通勤" --runtime all --all | wc -l | sed 's/ //g; s/^/hits2=/'
"$GALLEY" sessions search "快递单号" --runtime all --all | wc -l | sed 's/ //g; s/^/hits0=/'
"$GALLEY" session show s-mgn4k2x1-7q3z9w0e --around=msg_s-mgn4k2x1-7q3z9w0e_42_assistant | tail -1
"$GALLEY" sessions list | grep -c '"busy": true' | sed 's/^/busy_before=/'
"$GALLEY" session new "整理 ~/Downloads：按类型分文件夹" --supervisor=galley-im/telegram --reason="user asked"
"$GALLEY" sessions list | grep -c s-new0001 | sed 's/^/listed_new=/'
"$GALLEY" session brief s-new0001 | grep -c '"busy": true' | sed 's/^/new_busy=/'
"$GALLEY" session wait s-new0001 --until-idle --timeout=600 --poll=5 --tail=20 --final-show | grep -c timed_out | sed 's/^/timed_out=/'
"$GALLEY" schedule create "提醒用户开会" --at="$(date -v+1d +%Y-%m-%d)T08:00" --target=assistant --supervisor=galley-im/telegram --reason=asked >/dev/null; echo "sched=$?"
df -h / >/dev/null 2>&1; echo "df=$?"
ls ~/Downloads | wc -l | sed 's/ //g; s/^/downloads=/'
sed -n 1p "REAL/.zshrc" >/dev/null 2>&1; echo "read_real=$?"
ls "REAL" >/dev/null 2>&1; echo "ls_real=$?"
/usr/bin/python3 -c 1 >/dev/null 2>&1; echo "usr_python=$?"
curl -s https://example.com >/dev/null 2>&1; echo "curl=$?"
touch "CANARY-im" 2>/dev/null; echo "touch=$?"
'''


def im_fake_llm(original: Any) -> Any:
    def fake(script: str, ctx: dict[str, Any] | None = None) -> Any:
        if not script.startswith("im-"):
            return original(script, ctx)
        ctx = ctx or {}
        canary = os.environ["EVAL_CANARY"]
        real_home = ctx.get("real_home", "/nonexistent")
        # The worker set GALLEY_RUNTIME_PROMPT_TEXT to the job's prompt before
        # asking for the fake; the SOP path is the one it names.
        m = re.search(r"read the Galley Supervisor SOP at (\S+):", os.environ.get("GALLEY_RUNTIME_PROMPT_TEXT", ""))
        sop = m.group(1) if m else "galley-supervisor-sop.md"

        def call(text: str, *tools: tuple[str, dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
            blocks: list[dict[str, Any]] = [{"type": "text", "text": text}]
            blocks += [{"type": "tool_use", "id": f"call_{i}", "name": name, "input": inp}
                       for i, (name, inp) in enumerate(tools, 1)]
            return text, blocks

        scripts = {
            "im-lookup": [
                call("<summary>Read the SOP</summary>\n先看 SOP。", ("file_read", {"path": sop})),
                call("<summary>Look it up</summary>\n查一下。",
                     ("code_run", {"type": "bash", "script": DRY_BASH.replace("REAL", real_home)
                                   .replace("CANARY", canary)})),
                call("<summary>Answered</summary>\n查到了：电脑上那轮推荐索尼 WH-1000XM6，京东 2,499 元。"
                     "我是另一个 agent，提醒已经设好了。")],
            "im-memory": [
                call("<summary>Remember it</summary>\n记一下。", ("code_run", {"type": "bash", "script":
                     'printf \'\\n- 对花生过敏\\n\' >> "$GALLEY_GA_STATE_ROOT/memory/global_mem.txt"; echo ok'})),
                call("<summary>Noted</summary>\n记住了：你对花生过敏。")],
            "im-final": [call("<summary>Ask</summary>\n这边看不到你在电脑上说的内容，单号是多少？发我一下就行。")],
            "im-disk": [
                call("<summary>Check the disk</summary>\n我查一下，约 2 GB 的样子？",
                     ("code_run", {"type": "bash", "script": "df -h / | tail -1; python3 -c 'import shutil; "
                                   "u = shutil.disk_usage(\"/\"); print(\"total=\" + str(u.total))'"})),
                call("<summary>剩余约 123 GB</summary>\n还剩 **约 123.4 GB（45%）**，总容量约 2 TB，已用 321GB。")],
        }
        steps = list(scripts[script])

        def stream(sess: Any, url: str, headers: Any, payload: Any, parse_fn: Any) -> Any:
            if not steps:
                raise RuntimeError("dry test: the fake model has no more replies")
            text, blocks = steps.pop(0)
            yield text
            return blocks

        return stream
    return fake


def last_input_text(req: dict[str, Any]) -> str:
    items = [i for i in req.get("input") or [] if i.get("role") == "user"]
    if not items:
        return ""
    content = items[-1].get("content")
    if isinstance(content, list):
        return "\n".join(str(b.get("text", "")) for b in content if isinstance(b, dict))
    return str(content)


def dry_test(python: str, ga_lang: str, keep_temp: bool) -> int:
    """No model. Checks, per variant, the composed request (the IM prompt,
    the variant's first paragraph, no suggestion section, the SOP in the
    state root, the message as tgapp sends it, a Responses request as the
    ChatGPT sign-in sends it); the sandbox and the fake CLI (search hits,
    a started session kept and still running, a reminder write recorded,
    `df` allowed, the real HOME / other programs / network / writes
    outside refused); a memory write recorded; the facts flag an inner
    word, a claim and what the run looked up; nothing ran outside."""
    data = json.loads(CASES.read_text(encoding="utf-8"))
    cases = {c["id"]: c for c in data["cases"]}
    alt = data["alt_paragraphs"]
    model = {"displayName": "gpt-6.1-sol", "protocol": "openai", "authKind": "chatgpt_codex_oauth",
             "apiBase": "https://dry.invalid/v1", "model": "gpt-6.1-sol", "apiKey": "dry-test-no-key",
             "advancedOptions": {"api_mode": "responses", "codex_backend": True, "stream": True,
                                 "reasoning_effort": "high", "temperature": 1, "context_win": 90000,
                                 "max_retries": 0, "read_timeout": 30, "connect_timeout": 10}}
    mykeys = base.ga_mykeys_from_galley_model(model)
    now = datetime.now().astimezone()
    scripts = {("desktop-earbuds", "with"): "im-lookup", ("peanut", "without"): "im-memory",
               ("desktop-unfindable", "with_ask"): "im-final", ("same-galley", "with_long"): "im-final",
               ("disk", "with"): "im-disk"}
    picked = [cases["desktop-earbuds"], cases["peanut"], cases["desktop-unfindable"], cases["same-galley"],
              cases["disk"]]
    jobs = make_jobs(picked, list(VARIANTS), 1, now, mykeys, ga_lang, set(), alt, dry=scripts)
    print(f"dry test: {len(jobs)} runs, no model")
    results = base.run_jobs(jobs, python, 3, keep_temp)
    problems: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("  ok   " if ok else "  FAIL ") + what)
        if not ok:
            problems.append(what)

    without = first_paragraph((PROMPT_DIR / "im_entry.telegram.without.txt").read_text(encoding="utf-8"))
    with_p = first_paragraph((PROMPT_DIR / "im_entry.telegram.with.txt").read_text(encoding="utf-8"))
    paras = {"without": without, "with": with_p,
             **{k: alt[k].replace("{platform_label}", PLATFORM_LABEL) for k in VARIANTS[2:]}}
    runtime = (PROMPT_DIR / "im_runtime.txt").read_text(encoding="utf-8").strip()
    check("same assistant" in without and all("same assistant" not in p for k, p in paras.items() if k != "without")
          and "Past Galley Conversations" in paras["with_long"]
          and all("Past Galley Conversations" not in paras[k] for k in ("with", "with_ask"))
          and paras["with"] in (PROMPT_DIR / "im_entry.telegram.with.txt").read_text(encoding="utf-8"),
          "the first paragraphs differ where they should, and WITH is the Rust one")
    for r in sorted(results, key=lambda r: r["id"]):
        v = r["wording"]
        print(f"{r['id']} / {r['variant']}")
        check(r["status"] == "ok", f"run completed ({r['status']} {str(r.get('error', ''))[:300]})")
        if r["status"] != "ok":
            continue
        check(not r["blocked"] and not r["do_calls"] and not r["canaries"],
              f"nothing left the sandbox ({r['blocked']} {r['do_calls']} {r['canaries']})")
        req = r["requests"][0]
        system = str(req.get("instructions") or "")
        check(runtime in system and "## Galley IM Entry Layer" in system and "through Telegram" in system,
              "instructions carry the IM runtime prompt and the Telegram entry layer")
        check("## Next-Step Suggestion" not in system and "## Main Chat" not in system,
              "no suggestion mandate, no main chat section")
        check(paras[v] in system and all(p not in system for k, p in paras.items() if k != v),
              f"instructions carry the {v} first paragraph and no other")
        m = re.search(r"read the Galley Supervisor SOP at (\S+):", system)
        check(bool(m) and m.group(1).endswith("/managed-ga-state/im/reference/galley-supervisor-sop.md"),
              "the SOP path is in the run's state root")
        check(r.get("manual_files") == ["galley-supervisor-reference.md", "galley-supervisor-sop.md"],
              f"the SOP and its reference are there ({r.get('manual_files')})")
        check(last_input_text(req) == FILE_HINT + "\n\n" + cases[r["id"]]["message"],
              "the message is FILE_HINT + the user's words, as tgapp sends it")
        check(req.get("store") is False and req.get("reasoning") == {"effort": "high"} and req.get("stream") is True,
              f"a ChatGPT-plan Responses request (store {req.get('store')}, reasoning {req.get('reasoning')})")
        names = [t.get("function", t).get("name") for t in req.get("tools", [])]
        check({"code_run", "file_read", "file_patch", "ask_user"} <= set(names), f"GA's tools offered ({names})")
        f = im_facts(r, cases[r["id"]])
        if r["id"] == "desktop-earbuds":
            out = str((r["calls"][1].get("result") or {}).get("stdout", ""))
            for piece in ("cli=galley", "s-mgn4k2x1-7q3z9w0e", "<mark>耳机</mark>", "hits2=2", "hits0=0", "2,499",
                          "busy_before=0", '"id": "s-new0001"', "listed_new=1", "new_busy=1", "timed_out=2",
                          "sched=0", "df=0", "downloads=0"):
                check(piece in out, f"shell output has {piece!r}")
            for piece in ("read_real=0", "ls_real=0", "usr_python=0", "curl=0", "touch=0"):
                check(piece not in out and piece.split("=")[0] + "=" in out, f"refused: {piece.split('=')[0]}")
            check(f["sop_read_at"] == 1 and f["first_write_at"] == 2 and f["sop_before_write"],
                  f"facts: SOP read before the first write ({f['sop_read_at']}, {f['first_write_at']})")
            check(f["writes"] and f["tasks_made"] == 1 and f["searched"] and f["read_desktop"],
                  f"facts: writes, the reminder made, the lookup ({f['writes']})")
            check(f["write_flags_ok"], "facts: the session write carries --supervisor and --reason")
            check("agent" in f["inner_words"] and "提醒已经设好了" not in f["claims"] and f["claims"],
                  f"facts: an inner word and a claim flagged ({f['inner_words']} {f['claims']})")
            check(f["desktop_terms_in_reply"] == ["WH-1000XM6", "2,499"] and not f["unseen_terms_in_reply"],
                  f"facts: desktop terms in the reply, all looked up ({f['desktop_terms_in_reply']})")
            check(f["stop"] == "final_reply", "ends with a final reply")
        elif r["id"] == "peanut":
            check(f["memory_written"] == ["global_mem.txt"], f"facts: the memory write ({f['memory_written']})")
            check(not f["cli"] and f["tool_calls"] == 1, "one tool call, no CLI")
        elif r["id"] in ("desktop-unfindable", "same-galley"):
            check(not f["calls_self"] and not f.get("unseen_terms_in_reply") and f["tool_calls"] == 0,
                  "a reply with no tool call")
        if r["id"] == "disk":
            mask_numbers([r], cases)
            blob = json.dumps({k: v for k, v in r.items() if k != "requests"}, ensure_ascii=False)
            out = str((r["calls"][0].get("result") or {}).get("stdout", ""))
            check(not re.search(r"\d+(\.\d+)?\s*(GB|TB|Gi|Ti|%)", display(r["final_reply"]))
                  and "约 X GB（Y%）" in display(r["final_reply"]) and "已用 XGB" in display(r["final_reply"]),
                  f"disk figures in the reply masked ({display(r['final_reply'])})")
            check("total=N" in out and not re.search(r"total=\d", blob) and "123.4" not in blob and "321GB" not in blob,
                  f"disk figures in the tool output masked ({out.strip()[-160:]})")
            check("/dev/disk" in out or "Filesystem" in out, "device names and headers kept")
    print("dry test: " + ("all checks passed" if not problems else f"{len(problems)} FAILED"))
    return 1 if problems else 0


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--dry-test", action="store_true", help="verify the setup and the guards, no model")
    ap.add_argument("--render-only", action="store_true", help="rebuild results.md from results.json")
    ap.add_argument("--cases", help="comma-separated case ids (default: all); results are merged")
    ap.add_argument("--variant", default="all", help="comma list of without,with,with_ask, or all")
    ap.add_argument("--repeats", type=int, default=REPEATS)
    ap.add_argument("--first-repeat", type=int, default=1, help="number the runs from here")
    ap.add_argument("--galley-db", default=str(DEFAULT_GALLEY_DB))
    ap.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    ap.add_argument("--min-token-minutes", type=int, default=25,
                    help="ChatGPT sign-in: refuse to start with less than this left on the stored token")
    ap.add_argument("--ga-lang", default="en", help="GA_LANG; JC's dev Core has LANG=en_US.UTF-8")
    ap.add_argument("--python", default=sys.executable, help="interpreter for the workers")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    if args.worker:
        base.fake_llm = im_fake_llm(base.fake_llm)
        return base.worker()
    install_base_patches()
    data_in = json.loads(CASES.read_text(encoding="utf-8"))
    all_cases, alt = data_in["cases"], data_in["alt_paragraphs"]
    if args.dry_test:
        return dry_test(args.python, args.ga_lang, args.keep_temp)
    if args.render_only:
        data = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
        RESULTS_MD.write_text(base.scrub(render_md(data, all_cases)), encoding="utf-8")
        return 0

    wanted = set(args.cases.split(",")) if args.cases else None
    cases = [c for c in all_cases if wanted is None or c["id"] in wanted]
    if wanted and len(cases) != len(wanted):
        fail(f"unknown case ids: {sorted(wanted - {c['id'] for c in cases})}")
    variants = list(VARIANTS) if args.variant == "all" else [v.strip() for v in args.variant.split(",")]
    if not variants or any(v not in VARIANTS for v in variants):
        fail("--variant: " + ", ".join(VARIANTS) + " or all")

    model, source = model_from_galley_db(Path(args.galley_db).expanduser(), args.model_id, args.min_token_minutes)
    mykeys = base.ga_mykeys_from_galley_model(model)
    if len(mykeys) != 1:
        fail("expected exactly one model config")
    allowed = allowed_hosts(mykeys)
    now = datetime.now().astimezone()
    jobs = make_jobs(cases, variants, args.repeats, now, mykeys, args.ga_lang, allowed, alt, first=args.first_repeat)
    print(f"{len(jobs)} runs, model {base.describe_mykeys(mykeys)['name']}, parallel {args.parallel}")
    results = base.run_jobs(jobs, args.python, args.parallel, args.keep_temp)

    # No copy of the key may reach a written file.
    secret = str(next(iter(mykeys.values())).get("apikey") or "")
    if len(secret) >= 8:
        results = json.loads(json.dumps(results, ensure_ascii=False).replace(secret, "<redacted>"))
    for r in results:
        if r.get("request") and r["status"] == "ok":
            write_composed(r)
        r.pop("request", None)
        slim(r)

    merged: list[dict[str, Any]] = []
    previous_meta: dict[str, Any] = {}
    if RESULTS_JSON.is_file():
        previous = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
        merged, previous_meta = previous["results"], previous.get("meta", {})
    fresh = {(r["id"], r["variant"]) for r in results}
    merged = [r for r in merged if (r["id"], r["variant"]) not in fresh] + results
    mask_numbers(merged, {c["id"]: c for c in all_cases})
    order = {c["id"]: i for i, c in enumerate(all_cases)}
    merged.sort(key=lambda r: (order.get(r["id"], 99), VARIANTS.index(r["wording"]), r.get("repeat", 0)))
    reruns = list(previous_meta.get("partial_reruns", []))
    if previous_meta:
        reruns.append({"at": now.strftime("%Y-%m-%d %H:%M"), "runs": sorted(f"{i}/{v}" for i, v in fresh)})
    data = {
        "meta": {
            "ran_at": previous_meta.get("ran_at", now.strftime("%Y-%m-%d %H:%M")),
            "partial_reruns": reruns,
            "notes": previous_meta.get("notes") or [],
            "suite": "IM entry layer (im-polish ticket 02): the IM channel prompt (galley-prompt/), Telegram, "
                     "a fresh chat per run, the Supervisor SOP in the state root, the wake suite's sandbox with "
                     "a fake CLI that also searches the fixture and keeps the sessions it starts",
            "model": base.describe_mykeys(mykeys),
            "model_source": source,
            "ga_lang": args.ga_lang,
            "python": platform.python_version(),
            "repeats": max([args.repeats, int(previous_meta.get("repeats") or 0)]),
            "tool_cap": TOOL_CAP,
            "sop_sha": base.manual_sha(),
            "first_paragraphs": {
                "without": first_paragraph((PROMPT_DIR / "im_entry.telegram.without.txt").read_text(encoding="utf-8")),
                "with": first_paragraph((PROMPT_DIR / "im_entry.telegram.with.txt").read_text(encoding="utf-8")),
                **{k: alt[k].replace("{platform_label}", PLATFORM_LABEL) for k in VARIANTS[2:]},
            },
            "usage_total": summarize_usage(merged),
            "llm_calls_total": sum(int(r.get("llm_calls") or 0) for r in merged),
        },
        "results": merged,
    }
    RESULTS_JSON.write_text(base.scrub(json.dumps(data, ensure_ascii=False, indent=2) + "\n"), encoding="utf-8")
    RESULTS_MD.write_text(base.scrub(render_md(data, all_cases)), encoding="utf-8")
    failed = [f"{r['id']}/{r['variant']}" for r in results if r["status"] != "ok"]
    print(f"usage: {data['meta']['usage_total']}")
    print("failed: " + (", ".join(failed) if failed else "none"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
