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
from datetime import datetime, timedelta
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
    GALLEY_MANAGED_MODEL_CONFIG_JSON), read from a temp copy of Galley's
    database. Advanced options are merged like
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
    with tempfile.TemporaryDirectory(prefix="entry-layer-eval-db-") as td:
        os.chmod(td, 0o700)
        copy = Path(td) / "workbench.db"
        shutil.copyfile(db_path, copy)
        wal = Path(str(db_path) + "-wal")
        if wal.is_file():
            shutil.copyfile(wal, Path(str(copy) + "-wal"))
        con = sqlite3.connect(str(copy))
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
    directory (sandbox and state roots live under it) becomes $TMPDIR."""
    tmp = tempfile.gettempdir().rstrip("/")
    prefixes = {tmp, os.path.realpath(tmp)}
    prefixes |= {p[len("/private"):] for p in prefixes if p.startswith("/private/")}
    prefixes |= {"/private" + p for p in prefixes if p.startswith("/var/")}
    for prefix in sorted(prefixes, key=len, reverse=True):
        text = text.replace(prefix, "$TMPDIR")
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
DRY_TOOL_BRIEF = "去华立、东辰、明光三家官网抓本周钢材报价，整理成对比表交回"


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
            "TMPDIR": os.path.join(sandbox["root"], "tmp"), "PATH": "/usr/bin:/bin",
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

    marker = state_root.parent / "managed-models.json"
    marker.write_text('{"schemaVersion":1,"models":[]}\n', encoding="utf-8")
    mykeys = job["mykeys"]

    def load_mykeys() -> dict[str, Any]:  # managed_runtime.install_managed_mykey_loader
        llmcore._mykey_path = str(marker)
        return {k: dict(v) for k, v in mykeys.items()}

    llmcore._load_mykeys = load_mykeys
    llmcore._mykey_path = str(marker)
    llmcore._mykey_mtime = None

    # Record exactly what is sent (the request payload; headers carry the
    # key and are not kept) and the usage the stream reports.
    real_stream = llmcore._stream_with_retry
    fake = (fake_llm(job["dry"], {"real_home": real_home, "sock": job.get("dry_sock")})
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

        if n > SANDBOX_TOOL_CAP:
            return stop("cap_reached", f"not run: cap of {SANDBOX_TOOL_CAP} tool calls reached")
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


def sandbox_profile(sandbox: str, py_root: str, galley: str) -> str:
    """A deny-by-default macOS sandbox (sandbox-exec) for the model's code:
    it may run the Python interpreter and bash / sh (what code_run itself
    starts) and the fake galley, and no other program; read and write
    only inside the sandbox (plus the system libraries and the
    interpreter it needs to start); no network at all (TCP, DNS and Unix
    sockets, so not Galley Core either)."""
    def lit(p: str) -> str:
        return '(literal "' + p + '")'

    def sub(p: str) -> str:
        return '(subpath "' + p + '")'

    meta = sorted(set(path_parents(sandbox) + path_parents(py_root)
                      + ["/private/var", "/var", "/private/etc", "/etc", "/tmp", "/private/tmp",
                         "/bin", "/usr", "/dev", "/private/var/select"]))
    return "\n".join([
        "(version 1)",
        "(deny default)",
        "(allow process-fork)",
        "(allow signal (target same-sandbox))",
        "(allow sysctl-read)",
        f"(allow process-exec {sub(py_root)} {lit('/bin/bash')} {lit('/bin/sh')} {lit(galley)})",
        f"(allow file-read* {lit('/')} {sub(sandbox)} {sub(py_root)} {sub('/System')} {sub('/usr/lib')}"
        f" {sub('/usr/share')} {sub('/private/var/db/timezone')} {lit('/private/etc/localtime')}"
        f" {lit('/private/var/select/sh')} {lit('/bin/bash')} {lit('/bin/sh')} {lit('/dev/null')}"
        f" {lit('/dev/urandom')} {lit('/dev/random')} {lit('/dev/zero')})",
        "(allow file-read-metadata " + " ".join(lit(p) for p in meta) + ")",
        f"(allow file-map-executable {sub('/System')} {sub('/usr/lib')} {sub(py_root)}"
        f" {lit('/bin/bash')} {lit('/bin/sh')})",
        f"(allow file-write* {sub(sandbox)} {lit('/dev/null')})",
        f"(allow file-ioctl {lit('/dev/null')})",
        "",
    ])


def build_sandbox(run_dir: Path, python: str) -> dict[str, Any]:
    """One run's sandbox: a fake HOME with fixture files in ~/Downloads and
    ~/.config/galley/cli-path pointing at the fake galley, a tmp dir, a
    log for the fake CLI, and (outside the sandbox) the profile."""
    root = Path(os.path.realpath(run_dir)) / "sandbox"
    home = root / "home"
    downloads = home / "Downloads"
    downloads.mkdir(parents=True)
    for name, text in FIXTURE_PDFS.items():
        (downloads / name).write_bytes(
            f"%PDF-1.4\n% placeholder fixture\n% {text}\n%%EOF\n".encode())
    for name, data in FIXTURE_OTHER.items():
        (downloads / name).write_bytes(data)
    for name, size in FIXTURE_SPARSE.items():
        with open(downloads / name, "wb") as f:
            f.truncate(size)
    (root / "tmp").mkdir()
    (root / "log").mkdir()
    (root / "bin").mkdir()
    galley = root / "bin" / "galley"
    log = root / "log" / "galley-calls.jsonl"
    py_real = os.path.realpath(python)
    galley.write_text(FAKE_GALLEY.format(python=py_real, log=str(log),
                                         fake_start=repr(FAKE_SUBTASK_STDOUT)), encoding="utf-8")
    galley.chmod(0o755)
    (home / ".config" / "galley").mkdir(parents=True)
    (home / ".config" / "galley" / "cli-path").write_text(str(galley) + "\n", encoding="utf-8")
    py_root = str(Path(py_real).parents[1])
    profile = Path(os.path.realpath(run_dir)) / "sandbox.sb"
    profile.write_text(sandbox_profile(str(root), py_root, str(galley)), encoding="utf-8")
    return {"root": str(root), "home": str(home), "profile": str(profile), "galley": str(galley),
            "galley_log": str(log), "py_root": py_root}


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
        sandbox = build_sandbox(run_dir, python)
        job["sandbox_info"] = sandbox
        job["state_root"] = str(seeded_state_root(Path(sandbox["root"])))
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


def write_composed(result: dict[str, Any], prefix: str = "") -> None:
    """The full (first) request of one run, as sent: system prompt,
    history, the new message, and the tools offered (names only, plus the
    full schema of the harness's own start_subtask when offered)."""
    req = result.get("request") or {}
    if not req:
        return
    COMPOSED_DIR.mkdir(exist_ok=True)
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
    path = COMPOSED_DIR / f"{prefix}{result['id']}.{result['variant']}.txt"
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
    ap.add_argument("--suite", choices=("entry", "dispatch"), default="entry",
                    help="entry: cases.json WITHOUT / WITH; dispatch: dispatch-cases.json T / C / P")
    ap.add_argument("--variant", default="all",
                    help="entry: without | with | both; dispatch: comma list of T,C,P; or all")
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
    sandbox_mode = dispatch and args.mode == "sandbox"
    if sandbox_mode:
        suite_files = (DISPATCH_CASES, DISPATCH_JSON, DISPATCH_MD, DISPATCH_VARIANTS,
                       render_sandbox_md)
    elif dispatch:
        suite_files = (DISPATCH_CASES, DISPATCH_FIRSTSTOP_JSON, DISPATCH_FIRSTSTOP_MD,
                       DISPATCH_VARIANTS, render_dispatch_md)
    else:
        suite_files = (CASES, RESULTS_JSON, RESULTS_MD, VARIANTS, render_md)
    cases_path, results_json, results_md, all_variants, render = suite_files
    all_cases = json.loads(cases_path.read_text(encoding="utf-8"))["cases"]
    if args.render_only:
        data = json.loads(results_json.read_text(encoding="utf-8"))
        results_md.write_text(scrub(render(data, all_cases)), encoding="utf-8")
        return 0

    wanted = set(args.cases.split(",")) if args.cases else None
    cases = [c for c in all_cases if wanted is None or c["id"] in wanted]
    if wanted and len(cases) != len(wanted):
        fail(f"unknown case ids: {sorted(wanted - {c['id'] for c in cases})}")
    if args.variant in ("all", "both"):
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
        source = f"Galley 托管模型 {args.model_id}，从 Galley 数据库副本只读取得"
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
    if dispatch:
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
            write_composed(r, "dispatch." if dispatch else "")
        r.pop("request", None)

    merged: list[dict[str, Any]] = []
    previous_meta: dict[str, Any] = {}
    if wanted and results_json.is_file():
        previous = json.loads(results_json.read_text(encoding="utf-8"))
        merged, previous_meta = previous["results"], previous.get("meta", {})
    fresh = {(r["id"], r["variant"]) for r in results}
    merged = [r for r in merged if (r["id"], r["variant"]) not in fresh] + results
    order = {c["id"]: i for i, c in enumerate(all_cases)}
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
