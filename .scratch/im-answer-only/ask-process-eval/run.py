#!/usr/bin/env python3
"""Ask-it eval (im-answer-only ticket 02). Results in results.md.

With the IM process entry gone (ticket 01), a user who wants to know how a
Telegram answer was reached asks for it in the chat. This measures, with
the real model and today's IM prompt, whether the agent then says what it
did, briefly and truthfully. Measure only: no prompt is changed.

Every run is one Telegram chat: the task message (cases.json `task`: find
the largest files in a fake ~/Downloads and say what each is; its tool
calls run for real in the run's sandbox and are what the answer is checked
against), then one ask (cases.json `asks`), under one of two conditions:

  live      the ask goes to the same agent process right after the answer
  resumed   the process that answered ends; a new one picks the chat back
            up the way a Telegram channel does after a restart
            (runner/im_resume.py: ChannelResume.attach -> resume ->
            continue_cmd.continue_inplace(..., restore_wm=True), from the
            engine log the first process wrote), then gets the ask

Both processes of a run share one sandbox, one managed state root (where
the engine log is) and one channel state directory (where the turn-end
hook of ChannelResume keeps `context_log.json`). In both conditions the
channel's resume is attached at startup as runner/managed_im_supervisor.py
_run_telegram does, right after the managed prompt profile.

A task that ends with fewer than three tool calls doing the work, or not
with a final answer, is run again (at most MAX_ATTEMPTS times); the runs it
replaced are listed in results.md. A resumed run whose second process does
not pick the chat back up is a harness problem, reported as such.

The machinery is the main chat eval's (.scratch/main-chat/entry-layer-eval/
run.py) and the IM entry layer eval's (.scratch/im-polish/entry-layer-eval/
run.py), imported as modules and not changed: the worker (base.worker), the
sandbox, the fake Galley CLI, the model read from Galley's database
(read-only), scrub. What this script adds: today's IM prompt
(galley-prompt/, written by the real Rust code), a fixture with real file
headers (and sparse holes), a worker that sends more than one message to
the same agent and attaches the channel's resume, the parent that runs the
two processes of a resumed run on one state root, and the facts and
verdicts per run.

Usage:

  python3 run.py --dry-test                no model: verify the setup, both conditions, the reruns
  python3 run.py                           every ask x condition, 2 runs each (16 runs)
  python3 run.py --asks how --conditions resumed --repeats 1 --first-repeat 2   partial rerun (merged)
  python3 run.py --judge FILE              merge the reader's verdicts (JSON by run id), rebuild results.md
  python3 run.py --render-only             rebuild results.md from results.json
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import importlib.util
import io
import json
import os
import platform
import re
import shutil
import sqlite3
import statistics
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
IM_PATH = REPO / ".scratch" / "im-polish" / "entry-layer-eval" / "run.py"
CASES = HERE / "cases.json"
PROMPT_DIR = HERE / "galley-prompt"
RESULTS_JSON = HERE / "results.json"
RESULTS_MD = HERE / "results.md"


def load_im() -> Any:
    """The IM eval's script as a module; it loads the main chat eval's as
    `entry_layer_base` (its `base`)."""
    spec = importlib.util.spec_from_file_location("im_polish_eval", IM_PATH)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {IM_PATH}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["im_polish_eval"] = mod
    spec.loader.exec_module(mod)
    return mod


im = load_im()
base = im.base
fail = base.fail

PLATFORM = "telegram"
FILE_HINT = im.FILE_HINT  # tgapp._build_text_prompt: FILE_HINT, a blank line, the text
# gpt-6.1-sol through an API key: the main chat eval's default entry.
DEFAULT_MODEL_ID = base.DEFAULT_MODEL_ID
TOOL_CAP = im.TOOL_CAP
MIN_TASK_CALLS = 3
MAX_ATTEMPTS = 3
CONDITIONS = ("live", "resumed")
# GA's own bookkeeping tools: run, recorded, but not a step of the task.
BOOKKEEPING = ("update_working_checkpoint", "start_long_term_update")
# The IM eval's programs (the wake suite's, `date`, `df`) plus a few
# read-only ones a lookup in ~/Downloads reaches for. `du` is left out:
# the large fixture files are sparse, and du would report their holes.
EXTRA_EXEC = tuple(base.SCHED_EXTRA_EXEC) + ("/bin/df", "/usr/bin/file", "/usr/bin/sort", "/usr/bin/find",
                                             "/usr/bin/stat", "/usr/bin/awk", "/usr/bin/xargs", "/usr/bin/sqlite3")
CHANNEL_DIR_NAME = "channel-telegram"  # the channel's state directory, inside the run's sandbox


# ----------------------------------------------------------------------
# Prompt
# ----------------------------------------------------------------------

VARIANT_ORDER = ("without", "with_line")


def entry_layer(spec: dict[str, Any] | None) -> str:
    """The Telegram entry layer of one variant (cases.json `variants`):
    as Rust wrote it (None), or with the variant's paragraph inserted as a
    paragraph of its own right after the line `after` names."""
    entry = (PROMPT_DIR / "im_entry.telegram.txt").read_text(encoding="utf-8").strip()
    if entry.count("__SOP_PATH__") != 1 or not entry.startswith("## Galley IM Entry Layer"):
        fail("galley-prompt/im_entry.telegram.txt: unexpected shape")
    if spec is None:
        return entry
    anchor = spec["after"] + "\n\n"
    if entry.count(anchor) != 1:
        fail(f"entry layer: the line a variant follows must occur once, then a blank line ({spec['after'][:50]!r})")
    return entry.replace(anchor, anchor + spec["text"].strip() + "\n\n", 1)


def galley_prompt(spec: dict[str, Any] | None = None) -> str:
    """What runner.managed_runtime.managed_prompt_profile composes for the
    Telegram channel: GALLEY_RUNTIME_PROMPT_TEXT (compose_im_runtime_prompt)
    and GALLEY_IM_SUPERVISOR_PROMPT_TEXT (im_supervisor_prompt), each
    stripped, joined by a blank line. Both files were written by the real
    Rust code (README.md); a variant changes only the entry layer
    (entry_layer). The SOP path becomes the run's state root."""
    runtime = (PROMPT_DIR / "im_runtime.txt").read_text(encoding="utf-8").strip()
    entry = entry_layer(spec)
    return runtime + "\n\n" + entry.replace("__SOP_PATH__", "__MANUAL_DIR__/galley-supervisor-sop.md")


# ----------------------------------------------------------------------
# Fixture: the fake ~/Downloads
# ----------------------------------------------------------------------

def iso_head(f: dict[str, Any]) -> bytes:
    """An ISO 9660 primary volume descriptor at sector 16, then the set
    terminator: what `file` reads (CD001 and the volume name)."""
    pvd = bytearray(2048)
    pvd[0:7] = b"\x01CD001\x01"
    pvd[8:40] = b"LINUX".ljust(32)
    pvd[40:72] = str(f["volume"]).encode().ljust(32)
    term = bytearray(2048)
    term[0:7] = b"\xffCD001\x01"
    return bytes(32768) + bytes(pvd) + bytes(term)


def isom_head(brand: bytes, compat: tuple[bytes, ...], size: int) -> bytes:
    ftyp = brand + struct.pack(">I", 0) + b"".join(compat)
    head = struct.pack(">I", 8 + len(ftyp)) + b"ftyp" + ftyp + struct.pack(">I", 8) + b"wide"
    return head + struct.pack(">I", 1) + b"mdat" + struct.pack(">Q", size - len(head))


HEADS = {
    "iso": iso_head,
    "quicktime": lambda f: isom_head(b"qt  ", (b"qt  ",), f["size"]),
    "m4a": lambda f: isom_head(b"M4A ", (b"M4A ", b"mp42", b"isom"), f["size"]),
    "pdf": lambda f: b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n",
    "jpeg": lambda f: b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00",
}


def write_downloads(downloads: Path, spec: list[dict[str, Any]], now: datetime) -> None:
    """Every file of cases.json `downloads`: its first bytes real (a header
    `file` recognizes, a real SQLite database, a real zip, text), then, for
    a `size`, a sparse hole up to it (apparent size only, no disk used)."""
    downloads.mkdir(parents=True, exist_ok=True)
    for f in spec:
        p = downloads / f["name"]
        kind = f["kind"]
        if kind == "text":
            p.write_text(f["text"], encoding="utf-8")
        elif kind == "zip":
            with zipfile.ZipFile(p, "w") as z:
                for name, text in f["entries"].items():
                    z.writestr(name, text)
        elif kind == "sqlite":
            con = sqlite3.connect(str(p))
            try:
                for table, t in f["tables"].items():
                    con.execute(f"CREATE TABLE {table} ({', '.join(t['columns'])})")
                    marks = ", ".join("?" * len(t["columns"]))
                    con.executemany(f"INSERT INTO {table} VALUES ({marks})", t["rows"])
                con.commit()
            finally:
                con.close()
        else:
            p.write_bytes(HEADS[kind](f))
        if f.get("size"):
            if p.stat().st_size > f["size"]:
                fail(f"fixture {f['name']}: header larger than its size")
            os.truncate(p, f["size"])
        if f.get("days_ago") is not None:
            ts = (now - timedelta(days=f["days_ago"], hours=3)).timestamp()
            os.utime(p, (ts, ts))


# ----------------------------------------------------------------------
# Runs
# ----------------------------------------------------------------------

def run_id(variant: str, cond: str, ask: str, n: int) -> str:
    """`live-how-1` for the first variant (the 16 runs of the first round
    keep their ids), `with_line-live-how-1` for the others."""
    return f"{cond}-{ask}-{n}" if variant == "without" else f"{variant}-{cond}-{ask}-{n}"


def make_runs(data: dict[str, Any], asks: list[str], conditions: list[str], repeats: int, first: int,
              now: datetime, mykeys: dict[str, Any], ga_lang: str, allowed: set[str],
              variants: list[str] = ("without",)) -> list[dict[str, Any]]:
    by_ask = {a["id"]: a for a in data["asks"]}
    runs = []
    for variant in variants:
        for cond in conditions:
            for ask in asks:
                for n in range(first, first + repeats):
                    runs.append(make_run(data, by_ask, variant, cond, ask, n, now, mykeys, ga_lang, allowed))
    return runs


def make_run(data: dict[str, Any], by_ask: dict[str, Any], variant: str, cond: str, ask: str, n: int,
             now: datetime, mykeys: dict[str, Any], ga_lang: str, allowed: set[str]) -> dict[str, Any]:
    if variant not in data["variants"]:
        fail(f"unknown variant {variant!r} (cases.json `variants`: {', '.join(data['variants'])})")
    return {
        "id": run_id(variant, cond, ask, n),
        "variant": variant,
        "condition": cond,
        "ask": ask,
        "scored": bool(by_ask[ask]["scored"]),
        "repeat": n,
        "now": now.isoformat(timespec="seconds"),
        "task_message": data["task"]["message"],
        "ask_message": by_ask[ask]["message"],
        "downloads": data["downloads"],
        "galley_prompt": galley_prompt(data["variants"][variant]),
        "mykeys": mykeys,
        "ga_lang": ga_lang,
        "allowed_hosts": sorted(allowed),
    }


def work_calls(turn: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The calls of a turn that did work: run (or refused, with a result),
    not GA's own bookkeeping, not tell_user."""
    return [c for c in (turn or {}).get("calls") or []
            if c.get("n") is not None and c["name"] not in BOOKKEEPING
            and not str(c.get("outcome", "")).startswith("not run")]


def tool_calls(turn: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Every tool call of a turn (tell_user aside: none is offered here)."""
    return [c for c in (turn or {}).get("calls") or [] if c.get("n") is not None]


def task_ok(turn: dict[str, Any] | None) -> bool:
    return bool(turn) and turn.get("status") == "ok" and turn.get("stop_reason") == "final_reply" \
        and len(work_calls(turn)) >= MIN_TASK_CALLS


def read_mapping(state_dir: Path) -> str | None:
    try:
        return json.loads((state_dir / "context_log.json").read_text(encoding="utf-8")).get("log")
    except (OSError, ValueError, AttributeError):
        return None


def spawn(job: dict[str, Any], python: str, run_dir: Path, tag: str) -> dict[str, Any]:
    """One worker process (this file, --worker), as base.run_job starts its
    worker: Galley / GA variables out of the environment, no bytecode."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GALLEY", "GA_"))}
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8", EVAL_CANARY=str(run_dir / "canary"))
    messages = 1 + len(job.get("followups") or [])
    log = open(run_dir / f"worker-{tag}.log", "w", encoding="utf-8")
    try:
        proc = subprocess.run([python, str(Path(__file__).resolve()), "--worker"],
                              input=json.dumps(job, ensure_ascii=False), text=True, encoding="utf-8",
                              stdout=log, stderr=log, env=env, cwd=str(run_dir),
                              timeout=base.SANDBOX_RUN_TIMEOUT_S * messages + 60)
        code = proc.returncode
    except subprocess.TimeoutExpired:
        code = -1
    finally:
        log.close()
    path = Path(job["result_path"])
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    tail = (run_dir / f"worker-{tag}.log").read_text(encoding="utf-8", errors="replace")[-1500:]
    return {"status": "error", "error": f"worker exit {code}: {tail}", "messages": []}


def run_one(run: dict[str, Any], python: str, workdir: Path, attempt: int,
            dry: dict[str, Any] | None = None) -> dict[str, Any]:
    """One run, attempt `attempt`: its sandbox (fake HOME and ~/Downloads,
    fake Galley CLI), the managed state root (memory seed, the SOP where
    Core writes it for IM), the channel state directory; then the worker
    processes. dry (dry test): the fake model's script per phase, and
    whether to break the log mapping before the second process."""
    run_dir = workdir / f"{run['id']}.a{attempt}"
    run_dir.mkdir(parents=True)
    now = datetime.fromisoformat(run["now"])
    wake = {"fixture": im.fixture({}, now), "files": {}, "help": str(base.SCHED_CLI_HELP),
            "extra_exec": list(EXTRA_EXEC)}
    sandbox = base.build_sandbox(run_dir, python, wake)
    home = Path(sandbox["home"])
    write_downloads(home / "Downloads", run["downloads"], now)
    state_root = base.seeded_state_root(Path(sandbox["root"]))
    manual = state_root / "im" / "reference"
    manual.mkdir(parents=True)
    for part in (im.REF_SRC, im.SOP_SRC):
        shutil.copyfile(part, manual / part.name)
    channel_dir = Path(sandbox["root"]) / CHANNEL_DIR_NAME
    channel_dir.mkdir()
    job = {
        "case_id": run["id"], "variant": f"a{attempt}", "wording": run["ask"], "repeat": run["repeat"],
        "suite": "schedule", "now": run["now"], "history": [],
        "galley_prompt": run["galley_prompt"].replace("__MANUAL_DIR__", str(manual)),
        "mykeys": run["mykeys"], "ga_lang": run["ga_lang"], "allowed_hosts": run["allowed_hosts"],
        "keep_request": False, "sandbox": True, "tool_cap": TOOL_CAP, "wake": wake,
        "sandbox_info": sandbox, "state_root": str(state_root), "manual_dir": str(manual),
        "channel": {"state_dir": str(channel_dir)},
    }
    before = base.downloads_snapshot(home)
    if run["condition"] == "live":
        phases = [[run["task_message"], run["ask_message"]]]
    else:
        phases = [[run["task_message"]], [run["ask_message"]]]
    outs: list[dict[str, Any]] = []
    for i, texts in enumerate(phases):
        if i == 1 and (dry or {}).get("break_mapping"):
            (channel_dir / "context_log.json").write_text(json.dumps({"log": "model_responses_000000.txt"}) + "\n",
                                                          encoding="utf-8")
        pjob = dict(job, message=FILE_HINT + "\n\n" + texts[0],
                    followups=[FILE_HINT + "\n\n" + t for t in texts[1:]],
                    result_path=str(run_dir / f"result-{i}.json"),
                    dry=((dry or {}).get("scripts") or {}).get(i))
        out = spawn(pjob, python, run_dir, str(i))
        out["mapping_after"] = read_mapping(channel_dir)
        outs.append(out)
        msgs = out.get("messages") or []
        if i == 0 and len(phases) > 1 and not (msgs and task_ok(msgs[0])):
            break
    turns = [m for o in outs for m in o.get("messages") or []]
    r: dict[str, Any] = {
        "id": run["id"], "variant": run["variant"], "condition": run["condition"], "ask": run["ask"],
        "scored": run["scored"],
        "repeat": run["repeat"], "attempt": attempt, "now": run["now"],
        "task": turns[0] if turns else None,
        "ask_turn": turns[1] if len(turns) > 1 else None,
        "phases": [{k: o.get(k) for k in ("status", "error", "channel", "mapping_after", "log", "memory_changes",
                                          "sandbox", "blocked", "do_calls", "guard_selftest")} for o in outs],
        "canaries": sorted(p.name for p in run_dir.glob("canary*")),
        "galley_log": base.read_galley_log(sandbox["galley_log"]),
    }
    after = base.downloads_snapshot(home)
    r["downloads_changes"] = {"removed": sorted(set(before) - set(after)), "added": sorted(set(after) - set(before)),
                              "resized": sorted(k for k in set(before) & set(after) if before[k] != after[k])}
    r["status"], r["status_note"] = run_status(r)
    return r


def run_status(r: dict[str, Any]) -> tuple[str, str]:
    task, ask = r["task"], r["ask_turn"]
    errors = "; ".join(str(p.get("error"))[:300] for p in r["phases"] if p.get("error"))
    if not task or task.get("status") != "ok":
        return "error", f"task: {(task or {}).get('status')} {errors}".strip()
    if not task_ok(task):
        return "short_task", (f"task: {len(work_calls(task))} working tool calls, "
                              f"ended {task.get('stop_reason')}")
    if r["condition"] == "resumed":
        ch = (r["phases"][1].get("channel") if len(r["phases"]) > 1 else None) or {}
        if not ch.get("resumed"):
            return "resume_failed", f"second process did not pick the chat back up ({ch.get('printed') or errors})"
    if not ask:
        return "error", f"no ask turn {errors}".strip()
    if ask.get("status") != "ok":
        return "error", f"ask: {ask.get('status')}"
    return "ok", ""


def run_all(runs: list[dict[str, Any]], python: str, parallel: int, keep_temp: bool,
            dry: dict[tuple[str, int], dict[str, Any]] | None = None
            ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Every run, retried while its task falls short or a turn errs (at most
    MAX_ATTEMPTS); a failed resume is not retried (a harness problem).
    Returns the final runs and the attempts they replaced."""
    workdir = Path(tempfile.mkdtemp(prefix="im-answer-02-"))
    os.chmod(workdir, 0o700)
    base.refuse_real_data(workdir)

    def go(run: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        replaced: list[dict[str, Any]] = []
        for attempt in range(1, MAX_ATTEMPTS + 1):
            r = run_one(run, python, workdir, attempt, (dry or {}).get((run["id"], attempt)))
            if r["status"] in ("ok", "resume_failed") or attempt == MAX_ATTEMPTS:
                return r, replaced
            replaced.append(r)
        raise AssertionError("unreachable")

    results: list[dict[str, Any]] = []
    superseded: list[dict[str, Any]] = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as pool:
            futures = [pool.submit(go, run) for run in runs]
            for n, fut in enumerate(concurrent.futures.as_completed(futures), 1):
                r, replaced = fut.result()
                for x in replaced:
                    print(f"      {x['id']} attempt {x['attempt']}: {x['status']} ({x['status_note'][:160]}), run again",
                          flush=True)
                print(f"[{n}/{len(runs)}] {r['id']} attempt {r['attempt']}: {r['status']}"
                      f" task_calls={len(work_calls(r['task']))} ask_calls={len(tool_calls(r['ask_turn']))}"
                      + (f" ({r['status_note'][:200]})" if r["status"] != "ok" else ""), flush=True)
                results.append(r)
                superseded += replaced
    finally:
        if keep_temp:
            print(f"temp kept: {workdir}")
        else:
            shutil.rmtree(workdir, ignore_errors=True)
    return results, superseded


# ----------------------------------------------------------------------
# Worker: base.worker, with the channel's resume attached and more than
# one message sent to the same agent
# ----------------------------------------------------------------------

STATE: dict[str, Any] = {}


def history_facts(history: list[Any]) -> dict[str, Any]:
    uses, results = [], 0
    for m in history:
        content = m.get("content") if isinstance(m, dict) else None
        for b in content if isinstance(content, list) else []:
            if isinstance(b, dict) and b.get("type") == "tool_use":
                uses.append(b.get("name"))
            elif isinstance(b, dict) and b.get("type") == "tool_result":
                results += 1
    return {"messages": len(history), "tool_uses": uses, "tool_results": results}


def channel_attach(agent: Any, state_dir: Path) -> dict[str, Any]:
    """What runner/managed_im_supervisor.py _run_telegram does right after
    install_managed_prompt_profile: im_resume.load("telegram", state_dir)
    and ChannelResume.attach(agent) (resume from the mapped log, then the
    turn-end hook that keeps the mapping). The continue_cmd functions it
    calls are watched, not changed, to record how it picked the chat up."""
    from runner import im_resume

    import continue_cmd  # type: ignore[import-not-found]  # the module im_resume.load imports

    info: dict[str, Any] = {"mapping_before": read_mapping(state_dir),
                            "log_at_start": os.path.basename(str(agent.log_path)), "calls": []}
    real = {n: getattr(continue_cmd, n) for n in ("continue_inplace", "continue_copy", "begin_fresh_session")}

    def watch(name: str) -> Any:
        def call(*a: Any, **k: Any) -> Any:
            out = real[name](*a, **k)
            info["calls"].append({
                "fn": name,
                "log": os.path.basename(str(a[1])) if name != "begin_fresh_session" and len(a) > 1 else None,
                "agent_id": a[2] if len(a) > 2 else (a[1] if name == "begin_fresh_session" and len(a) > 1
                                                      else k.get("agent_id")),
                "kwargs": {key: v for key, v in k.items()},
                "returned": list(out) if isinstance(out, tuple) else out,
            })
            return out
        return call

    for name in real:
        setattr(continue_cmd, name, watch(name))
    printed = io.StringIO()
    try:
        resume = im_resume.load(PLATFORM, state_dir)
        info["owner"] = resume.owner
        real_resume = resume.resume

        def resume_watched(a: Any) -> bool:
            ok = real_resume(a)
            info["resumed"] = ok
            return ok

        resume.resume = resume_watched  # type: ignore[method-assign]
        with contextlib.redirect_stdout(printed):
            resume.attach(agent)
    finally:
        for name, fn in real.items():
            setattr(continue_cmd, name, fn)
    info["printed"] = printed.getvalue().strip()
    print(info["printed"])
    info["log_after"] = os.path.basename(str(agent.log_path))
    info["history"] = history_facts(list(getattr(agent.llmclient.backend, "history", None) or []))
    info["working_memory"] = [str(x) for x in (getattr(agent, "history", None) or [])]
    info["hook"] = im_resume.TURN_END_HOOK_KEY in (getattr(agent, "_turn_end_hooks", None) or {})
    return info


def turn_record(r: dict[str, Any]) -> dict[str, Any]:
    keep = ("message", "status", "stop_reason", "final_reply", "calls", "turns", "llm_calls", "usage", "latency_s",
            "started_at", "request_shape", "requests")
    return {k: r.get(k) for k in keep if k in r}


def multi_message(orig: Any) -> Any:
    """base.build_result, called by base.worker once its first message is
    done, becomes: that message's record, then each follow-up sent to the
    same agent (put_task, as tgapp sends a Telegram message) and recorded
    the same way, its tool calls run by base.worker's own dispatch. A
    follow-up is sent only after a task that did its work (task_ok)."""
    def build(job: dict[str, Any], rec: dict[str, Any], done: Any, latency: float) -> dict[str, Any]:
        turns = [turn_record(orig(job, rec, done, latency))]
        agent = STATE.get("agent")
        for text in job.get("followups") or []:
            if agent is None or not task_ok(turns[0]):
                turns[0]["followup_skipped"] = True
                break
            for k in ("responses", "requests", "usage", "calls", "dispatches", "told"):
                rec[k] = []
            rec.update(tools_seen=0, stop_reason=None, intercepted=None, tag=None, dispatch_call=None,
                       interjected_at=None)
            started = time.time()
            rec["started_at"] = started
            dq = agent.put_task(text, source=PLATFORM)
            done2 = None
            while time.time() - started < base.SANDBOX_RUN_TIMEOUT_S:
                try:
                    item = dq.get(timeout=5)
                except Exception:
                    continue
                if "done" in item:
                    done2 = item
                    break
            turns.append(turn_record(orig(dict(job, message=text), rec, done2, time.time() - started)))
        return {
            "id": job["case_id"], "variant": job["variant"],
            "status": "ok" if all(t.get("status") == "ok" for t in turns) else "error",
            "messages": turns, "channel": STATE.get("channel"),
            "log": os.path.basename(str(agent.log_path)) if agent is not None else None,
            "do_calls": list(rec["do_calls"]), "blocked": list(rec["blocked"]),
        }
    return build


def worker() -> int:
    raw = sys.stdin.read()
    job = json.loads(raw)
    if job.get("dry"):
        base.fake_llm = dry_fake_llm(base.fake_llm)
    # base.worker's own path order (frontends, GA code, repo at the front);
    # it finds them already there.
    for p in (str(base.GA_CODE / "frontends"), str(base.GA_CODE), str(REPO)):
        if p not in sys.path:
            sys.path.insert(0, p)
    from runner import managed_runtime

    real_install = managed_runtime.install_managed_prompt_profile

    def install(agent: Any, *a: Any, **k: Any) -> Any:
        out = real_install(agent, *a, **k)
        STATE["agent"] = agent
        if job.get("channel"):
            STATE["channel"] = channel_attach(agent, Path(job["channel"]["state_dir"]))
        return out

    managed_runtime.install_managed_prompt_profile = install
    base.build_result = multi_message(base.build_result)
    sys.stdin = io.StringIO(raw)
    return int(base.worker() or 0)


# ----------------------------------------------------------------------
# Dry test: a scripted model
# ----------------------------------------------------------------------

DRY_PROBE = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
echo "cli=${GALLEY##*/}"
ls -lS ~/Downloads | sed -n 2p | awk '{print "top=" $5}'
ls ~/Downloads | wc -l | sed 's/ //g; s/^/downloads=/'
file ~/Downloads/* | sort
find ~/Downloads -type f -size +1000M | wc -l | sed 's/ //g; s/^/big=/'
stat -f 'stat=%z' ~/Downloads/export_0917
du -sh ~/Downloads >/dev/null 2>&1; echo "du=$?"
sed -n 1p "REAL/.zshrc" >/dev/null 2>&1; echo "read_real=$?"
ls "REAL" >/dev/null 2>&1; echo "ls_real=$?"
/usr/bin/python3 -c 1 >/dev/null 2>&1; echo "usr_python=$?"
curl -s https://example.com >/dev/null 2>&1; echo "curl=$?"
touch "CANARY-iad" 2>/dev/null; echo "touch=$?"
'''
DRY_SQL_PY = ('import os, sqlite3\n'
              'con = sqlite3.connect(os.path.expanduser("~/Downloads/export_0917"))\n'
              'print("tables=" + ",".join(r[0] for r in con.execute('
              '"select name from sqlite_master where type=\'table\' order by name")))\n'
              'print("tx=%d" % con.execute("select count(*) from transactions").fetchone()[0])\n')
DRY_SQL_CLI = "sqlite3 ~/Downloads/export_0917 'select count(*) from categories;' | sed 's/^/cats=/'"
DRY_TASK_REPLY = ("<summary>Answered</summary>\n最占地方的三个：\n- nimbus-os-3.2-desktop-amd64.iso，约 5.8 GB，系统安装镜像\n"
                  "- 屏幕录像（10 月 28 日），约 2.5 GB\n- export_0917，约 1.3 GB，记账 App 的数据库导出")
DRY_ASK_REPLY = "<summary>Explained</summary>\n我先按大小列了下载文件夹，再用 file 看了类型，最后打开 export_0917 看了表。"
DRY_FORM_REPLY = ("<summary>Explained</summary>\n## 过程\n\n| 步 | 做了什么 |\n|---|---|\n| 1 | 列文件 |\n\n"
                  "```\nls -lS ~/Downloads\n```\n又看了一眼 `~/Downloads/export_0917`。")


def dry_fake_llm(original: Any) -> Any:
    def fake(script: str, ctx: dict[str, Any] | None = None) -> Any:
        if not script.startswith("iad-"):
            return original(script, ctx)
        canary = os.environ["EVAL_CANARY"]
        real_home = (ctx or {}).get("real_home", "/nonexistent")

        def call(text: str, *tools: tuple[str, dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
            blocks: list[dict[str, Any]] = [{"type": "text", "text": text}]
            blocks += [{"type": "tool_use", "id": f"call_{script}_{len(text)}_{i}", "name": name, "input": inp}
                       for i, (name, inp) in enumerate(tools, 1)]
            return text, blocks

        task = [
            call("<summary>List by size</summary>\n先按大小列一下。",
                 ("code_run", {"type": "bash", "script": DRY_PROBE.replace("REAL", real_home)
                               .replace("CANARY", canary)})),
            call("<summary>Open the database</summary>\n看看 export_0917 里有什么。",
                 ("code_run", {"type": "python", "script": DRY_SQL_PY})),
            call("<summary>Count categories</summary>", ("code_run", {"type": "bash", "script": DRY_SQL_CLI})),
            call(DRY_TASK_REPLY),
        ]
        short = [call("<summary>List</summary>", ("code_run", {"type": "bash", "script": "ls -lS ~/Downloads"})),
                 call(DRY_TASK_REPLY)]
        scripts = {
            "iad-live": task + [call(DRY_ASK_REPLY)],
            "iad-task": task,
            "iad-answer": [call(DRY_ASK_REPLY)],
            "iad-short": short,
            "iad-live-redo": task + [
                call("<summary>Look again</summary>",
                     ("code_run", {"type": "bash", "script": "ls -lS ~/Downloads | head -3"})),
                call(DRY_FORM_REPLY)],
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


def request_text(req: dict[str, Any]) -> str:
    return json.dumps(req, ensure_ascii=False)


def system_text(req: dict[str, Any]) -> str:
    """The system prompt of a chat_completions request (or a Responses
    request's instructions)."""
    for m in req.get("messages") or []:
        if m.get("role") == "system":
            c = m.get("content")
            if isinstance(c, list):
                return "\n".join(str(b.get("text", "")) for b in c if isinstance(b, dict))
            return str(c or "")
    return str(req.get("instructions") or "")


def last_user_text(req: dict[str, Any]) -> str:
    """The text of the newest user message of a chat_completions request."""
    msgs = [m for m in req.get("messages") or [] if m.get("role") == "user"]
    if not msgs:
        return ""
    content = msgs[-1].get("content")
    if isinstance(content, list):
        return "\n".join(str(b.get("text", "")) for b in content if isinstance(b, dict) and b.get("type") == "text")
    return str(content or "")


def dry_test(python: str, ga_lang: str, keep_temp: bool) -> int:
    """No model. Four runs with a scripted model: live (two messages, one
    process), resumed (two processes; the second picks the chat up from the
    first one's engine log through the channel's real resume path), a task
    that falls short (run again, the second attempt asks and redoes the
    lookup in a table-and-heading reply), and a resumed run whose log
    mapping is broken before the second process (reported, not retried).
    Checks the IM prompt, the message as tgapp sends it, the sandbox (the
    fixture as `file` / sqlite read it, programs and paths refused), what
    each turn did, what the second process restored and what the model saw,
    the facts, the rendering, scrub."""
    data = json.loads(CASES.read_text(encoding="utf-8"))
    mykeys = {"native_oai_config_0": {
        "name": "gpt-6.1-sol", "apikey": "dry-test-no-key", "apibase": "https://dry.invalid/v1",
        "model": "gpt-6.1-sol", "api_mode": "chat_completions", "stream": True, "temperature": 1,
        "reasoning_effort": "high", "context_win": 90000, "max_retries": 0, "read_timeout": 30,
        "connect_timeout": 10, "timeout": 10}}
    now = datetime.now().astimezone()
    runs = {r["id"]: r for r in make_runs(data, ["how", "steps", "show", "elapsed"], list(CONDITIONS), 1, 1, now,
                                          mykeys, ga_lang, set(), list(VARIANT_ORDER))}
    picked = [runs["live-how-1"], runs["with_line-resumed-steps-1"], runs["live-show-1"], runs["resumed-how-1"]]
    dry = {("live-how-1", 1): {"scripts": {0: "iad-live"}},
           ("with_line-resumed-steps-1", 1): {"scripts": {0: "iad-task", 1: "iad-answer"}},
           ("live-show-1", 1): {"scripts": {0: "iad-short"}},
           ("live-show-1", 2): {"scripts": {0: "iad-live-redo"}},
           ("resumed-how-1", 1): {"scripts": {0: "iad-task", 1: "iad-answer"}, "break_mapping": True}}
    print(f"dry test: {len(picked)} runs, no model")
    results, superseded = run_all(picked, python, 3, keep_temp, dry)
    by = {r["id"]: r for r in results}
    problems: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("  ok   " if ok else "  FAIL ") + what)
        if not ok:
            problems.append(what)

    runtime = (PROMPT_DIR / "im_runtime.txt").read_text(encoding="utf-8").strip()
    spec = data["variants"]["with_line"]
    para = spec["text"].strip()
    systems: dict[str, str] = {}
    for rid in ("live-how-1", "with_line-resumed-steps-1", "live-show-1"):
        r = by[rid]
        print(rid)
        check(r["status"] == "ok", f"run ok ({r['status']} {r['status_note'][:300]})")
        if not r["task"] or not r["ask_turn"]:
            continue
        for p in r["phases"]:
            check(not p.get("blocked") and not p.get("do_calls") and all((p.get("guard_selftest") or {}).values())
                  and not (p.get("sandbox") or {}).get("refused"),
                  f"nothing left the sandbox, guards refuse ({p.get('blocked')} {p.get('do_calls')} "
                  f"{p.get('guard_selftest')})")
        check(not r["canaries"], f"no canary outside the sandbox ({r['canaries']})")
        req0 = r["task"]["requests"][0]
        system = system_text(req0)
        systems[rid] = system
        if r["variant"] == "with_line":
            check(system.count(para) == 1 and spec["after"] + "\n\n" + para + "\n\nHand a task" in system
                  and system_text(r["ask_turn"]["requests"][0]).count(para) == 1,
                  "with_line: the paragraph once, right after the phone-screen list, blank line before and after; "
                  "the ask's request too")
        else:
            check("never your steps" not in system and "do not run it again" not in system,
                  "without: no trace of the with_line paragraph")
        check(runtime in system and "## Galley IM Entry Layer" in system and "through Telegram" in system
              and "## Main Chat" not in system and "## Next-Step Suggestion" not in system,
              "the system prompt carries the IM runtime prompt and the Telegram entry layer, nothing of the main chat")
        m = re.search(r"read the Galley Supervisor SOP at (\S+):", system)
        check(bool(m) and m.group(1).endswith("/managed-ga-state/im/reference/galley-supervisor-sop.md"),
              "the SOP path is in the run's state root")
        check(last_user_text(req0) == FILE_HINT + "\n\n" + data["task"]["message"],
              "the task goes as tgapp sends it (FILE_HINT, a blank line, the text)")
        ask_req = r["ask_turn"]["requests"][0]
        check(last_user_text(ask_req) == FILE_HINT + "\n\n" + runs[rid]["ask_message"],
              f"the ask goes as tgapp sends it ({last_user_text(ask_req)[-60:]!r})")
        out = str((r["task"]["calls"][0].get("result") or {}).get("stdout", ""))
        for piece in ("cli=galley", "top=6174015488", "downloads=10", "ISO 9660", "NIMBUS_OS_3_2_AMD64",
                      "Apple QuickTime", "SQLite 3.x database", "M4A", "PDF document", "JPEG image data", "big=3",
                      "stat=1288491008"):
            check(piece in out, f"probe output has {piece!r}")
        for piece in ("du=0", "read_real=0", "ls_real=0", "usr_python=0", "curl=0", "touch=0"):
            check(piece not in out and piece.split("=")[0] + "=" in out, f"refused: {piece.split('=')[0]}")
        sql = str((r["task"]["calls"][1].get("result") or {}).get("stdout", ""))
        cli = str((r["task"]["calls"][2].get("result") or {}).get("stdout", ""))
        check("tables=accounts,categories,transactions" in sql and "tx=10" in sql and "cats=6" in cli,
              f"the sparse SQLite file reads (python and the CLI) ({sql.strip()} {cli.strip()})")
        check(len(work_calls(r["task"])) == 3 and task_ok(r["task"]), "the task: three working calls, a final answer")
        check("transactions" in request_text(ask_req) and "cats=6" in request_text(ask_req),
              "the ask's request carries the task's tool calls and results (the model can see them)")
        f = facts(r)
        if rid == "live-show-1":
            check(f["ask_calls"] == 1 and f["ask_call_names"] == ["code_run"], f"facts: the redo counted ({f})")
            check(f["form"]["table"] and f["form"]["heading"] and f["form"]["code_blocks"] == 1
                  and f["form"]["paths"] >= 2, f"facts: table, heading, code block, paths ({f['form']})")
        else:
            check(f["ask_calls"] == 0 and not f["form"]["table"] and not f["form"]["heading"],
                  f"facts: no call after the ask, no table or heading ({f['ask_calls']} {f['form']})")
        ch0 = r["phases"][0]["channel"] or {}
        check(ch0.get("resumed") is False and not ch0.get("calls") and ch0.get("hook") and ch0.get("owner")
              == "galley-telegram", f"first process: nothing to resume, the turn-end hook on ({ch0})")
        if r["condition"] == "live":
            check(len(r["phases"]) == 1 and r["phases"][0]["mapping_after"] == r["phases"][0]["log"],
                  "live: one process; the mapping names its log")
        else:
            p0, p1 = r["phases"]
            ch1 = p1["channel"] or {}
            ci = [c for c in ch1.get("calls") or [] if c["fn"] == "continue_inplace"]
            check(p0["mapping_after"] == p0["log"] and ch1.get("mapping_before") == p0["log"],
                  "the first process's turn-end hook mapped the chat to its log; the second found it")
            check(ch1.get("resumed") is True and len(ci) == 1 and ci[0]["log"] == p0["log"]
                  and ci[0]["agent_id"] == "galley-telegram" and ci[0]["kwargs"] == {"restore_wm": True}
                  and ci[0]["returned"][1] is True,
                  f"the second process resumed through continue_inplace(..., restore_wm=True) ({ci})")
            check(ch1.get("log_after") == p0["log"] and p1["log"] == p0["log"] and ch1["log_at_start"] != p0["log"],
                  "the second process writes on the first one's log")
            h = ch1.get("history") or {}
            check(h.get("tool_uses") == ["code_run"] * 3 and h.get("tool_results") == 3
                  and h.get("messages") == 2 * r["task"]["llm_calls"],
                  f"backend history restored: every step, its calls and results ({h})")
            check(any(x.startswith("[USER]:") for x in ch1.get("working_memory") or []),
                  f"working memory restored ({(ch1.get('working_memory') or [])[:2]})")
    def same_shape(s: str) -> str:  # the run's own directories out
        return re.sub(r"im-answer-02-[^/\s]+/[^/\s]+\.a\d+", "RUN", s)

    if "live-how-1" in systems and "with_line-resumed-steps-1" in systems:
        check(same_shape(systems["with_line-resumed-steps-1"]).replace(para + "\n\n", "", 1)
              == same_shape(systems["live-how-1"]),
              "with_line's system prompt is without's plus the paragraph, nothing else")
    r = by["resumed-how-1"]
    print("resumed-how-1 (log mapping broken before the second process)")
    ch1 = (r["phases"][1]["channel"] if len(r["phases"]) > 1 else None) or {}
    check(r["status"] == "resume_failed" and r["attempt"] == 1 and ch1.get("resumed") is False
          and any(c["fn"] == "begin_fresh_session" for c in ch1.get("calls") or []),
          f"a failed resume is reported, not retried ({r['status']} {r['status_note'][:200]})")
    print("reruns")
    check([(x["id"], x["attempt"], x["status"]) for x in superseded] == [("live-show-1", 1, "short_task")]
          and by["live-show-1"]["attempt"] == 2,
          f"a short task is run again ({[(x['id'], x['attempt'], x['status']) for x in superseded]})")
    check(superseded and superseded[0]["ask_turn"] is None and superseded[0]["task"].get("followup_skipped"),
          "after a short task the ask is not sent")
    print("render")
    data_out = assemble(results, superseded, {"ran_at": "dry", "model": {"name": "gpt-6.1-sol", "options": {}},
                                              "model_source": "dry", "ga_lang": ga_lang}, [])
    text = scrub(render_md(data_out, data))
    check("# 「问一句」评测" in text and "live-how-1" in text and "（未判）" in text, "results.md renders")
    check("## `without` / `with_line` 对照" in text and "| how | live | without |" in text
          and "| steps | resumed | with_line |" in text and "do not run it again." in text,
          "the comparison and the variant's paragraph render")
    leaks = [s for s in (tempfile.gettempdir(), os.path.realpath(tempfile.gettempdir()), str(REPO), str(Path.home()))
             if s in scrub(json.dumps(data_out, ensure_ascii=False))]
    check(not leaks, f"scrub leaves no temp dir, repo or home path ({leaks})")
    print("dry test: " + ("all checks passed" if not problems else f"{len(problems)} FAILED"))
    return 1 if problems else 0


# ----------------------------------------------------------------------
# Facts (counted) and verdicts (read)
# ----------------------------------------------------------------------

DEFLECT_RE = re.compile(r"看不到|看不了|没有记录|没记录|无法查看|无法显示|没法给你看|不能给你看|按钮|点一下|点开|电脑上看|去电脑|"
                        r"在电脑上|桌面上看|界面上看")
DURATION_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:秒|分钟|分|小时|s\b|sec|min)|几秒|几分钟|半分钟|一分钟|两分钟|十几秒|几十秒")
PATH_RE = re.compile(r"(?:~|\$HOME|/Users|/private|/tmp|\$TMPDIR)/[^\s`'\"，。；）)]*|(?<![\w.])/(?:[\w.\-]+/)+[\w.\-]*")


def display(reply: str | None) -> str:
    return base.strip_for_display(reply or "")


def im_form(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    fences = [i for i, line in enumerate(lines) if line.strip().startswith("```")]
    code_lines = sum(b - a - 1 for a, b in zip(fences[::2], fences[1::2]))
    return {
        "chars": len(re.sub(r"\s", "", text)),
        "table": any("|" in line and re.search(r"\|\s*:?-{3,}", line) for line in lines),
        "heading": any(re.match(r"^\s{0,3}#{1,6}\s", line) for line in lines),
        "code_blocks": len(fences) // 2,
        "code_lines": code_lines,
        "inline_code": len(re.findall(r"`[^`\n]+`", text)),
        "paths": len(PATH_RE.findall(text)),
    }


def facts(r: dict[str, Any]) -> dict[str, Any]:
    ask = r.get("ask_turn") or {}
    body = display(ask.get("final_reply"))
    calls = tool_calls(ask)
    return {
        "task_calls": len(work_calls(r.get("task"))),
        "task_all_calls": len(tool_calls(r.get("task"))),
        "ask_calls": len(calls),
        "ask_call_names": [c["name"] for c in calls],
        "form": im_form(body),
        "deflect_hints": sorted({m.group(0) for m in DEFLECT_RE.finditer(body)}),
        "duration_hints": sorted({m.group(0) for m in DURATION_RE.finditer(body)}),
    }


def verdict(r: dict[str, Any]) -> dict[str, Any]:
    """Items 1–3 and the pass: 1 counted, 2 and 3 the reader's
    (`judgment`, merged with --judge)."""
    j = r.get("judgment") or {}
    f = facts(r)
    v = {"no_redo": f["ask_calls"] == 0, "accurate": j.get("accurate"), "no_deflect": j.get("no_deflect")}
    if v["accurate"] is None or v["no_deflect"] is None:
        v["passed"] = None
    else:
        v["passed"] = bool(v["no_redo"] and v["accurate"] and v["no_deflect"])
    return v


def assemble(results: list[dict[str, Any]], superseded: list[dict[str, Any]], meta: dict[str, Any],
             notes: list[str]) -> dict[str, Any]:
    order = {(c, a): i for i, (c, a) in enumerate((c, a) for c in CONDITIONS
                                                   for a in ("how", "steps", "show", "elapsed"))}
    for r in results:
        r.setdefault("variant", "without")  # the first round's runs were recorded before variants existed
    vorder = {v: i for i, v in enumerate(VARIANT_ORDER)}
    results = sorted(results, key=lambda r: (vorder.get(r["variant"], 99), order.get((r["condition"], r["ask"]), 99),
                                             r["repeat"]))
    return {"meta": dict(meta, notes=notes, superseded=[slim_superseded(x) for x in superseded]), "results": results}


def slim_superseded(r: dict[str, Any]) -> dict[str, Any]:
    if "phases" not in r:
        return r  # already slim (merged from an earlier results.json)
    task = r.get("task") or {}
    return {"id": r["id"], "attempt": r["attempt"], "status": r["status"], "status_note": r["status_note"],
            "task_calls": [c["name"] for c in tool_calls(task)], "stop_reason": task.get("stop_reason"),
            "task_reply": display(task.get("final_reply"))[:400]}


# ----------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------

COND_TITLES = {"live": "live（同一进程接着问）", "resumed": "resumed（重启后接回再问）"}
ELAPSED_LABELS = {"unknown": "照实说不知道", "grounded": "有依据的说法", "made_up": "编造"}


def quote(text: str) -> list[str]:
    if not text.strip():
        return ["> （空）", ""]
    return ["> " + line if line.strip() else ">" for line in text.strip().splitlines()] + [""]


# Display only (results.json keeps the text as it came back): the line
# GA's code_run prints before every Python run, and the run's sandbox paths
# in their short form.
GA_HEADER_RE = re.compile(r"^# SecretStr\.use\(\) to get raw, do not print raw value! \| keys\.ls\(\) to list all keys\n?",
                          re.MULTILINE)
SANDBOX_HOME_RE = re.compile(r"\$TMPDIR/im-answer-02-[^/\s'\"]+/[^/\s'\"]+/sandbox/home")
STATE_ROOT_RE = re.compile(r"\$TMPDIR/im-answer-02-[^/\s'\"]+/[^/\s'\"]+/sandbox/managed-ga-state")


def shorten(text: str) -> str:
    return STATE_ROOT_RE.sub("<状态根>", SANDBOX_HOME_RE.sub("~", GA_HEADER_RE.sub("", text)))


def flat(text: str) -> str:
    """One line for a code span (no `|` escaping: a code span shows it as is)."""
    return re.sub(r"\s*\n\s*", " ⏎ ", text.strip()).replace("`", "'")


def result_gist(c: dict[str, Any]) -> str:
    res = c.get("result")
    if isinstance(res, dict):
        out = res.get("stdout") if "stdout" in res else res.get("msg", res)
        text = str(out if out is not None else "")
        if res.get("exit_code") not in (None, 0):
            text += f"（退出码 {res.get('exit_code')}）"
    else:
        text = str(res if res is not None else "")
    text = flat(shorten(text))
    return text if len(text) <= 300 else text[:300] + "…"


def call_line(c: dict[str, Any]) -> str:
    args = c.get("args") or {}
    if c["name"] == "code_run":
        script = flat(shorten(str(args.get("script") or args.get("code") or "")))
        what = f"`code_run`（{args.get('type', 'python')}）：`" + (script if len(script) <= 300 else script[:300] + "…") + "`"
    elif c["name"] in ("file_read", "file_write", "file_patch"):
        what = f"`{c['name']}`：`{shorten(str(args.get('path', '')))}`"
    else:
        what = f"`{c['name']}`：`" + flat(shorten(json.dumps(args, ensure_ascii=False)))[:200] + "`"
    outcome = str(c.get("outcome", ""))
    if outcome.startswith("not run"):
        return f"{c['n']}. {what}（没有执行：{outcome}）"
    return f"{c['n']}. {what}\n   → `" + result_gist(c) + "`"


def yes(b: Any, good: str = "过", bad: str = "不过") -> str:
    return "（未判）" if b is None else (good if b else bad)


def form_line(form: dict[str, Any]) -> str:
    return (f"字数 {form['chars']}；表格{'有' if form['table'] else '无'}；标题{'有' if form['heading'] else '无'}；"
            f"代码块 {form['code_blocks']} 个（{form['code_lines']} 行）；行内代码 {form['inline_code']} 处；"
            f"路径 {form['paths']} 处")


def seen_line(r: dict[str, Any]) -> str:
    """What the ask's first request carried of the task (request_shape)."""
    roles = ((r.get("ask_turn") or {}).get("request_shape") or {}).get("message_roles") or []
    if not roles:
        return ""
    return (f"第二条消息的第一次请求里带着任务的 {roles.count('assistant')} 步回复与 {roles.count('tool')} 个工具结果"
            f"（任务共 {(r.get('task') or {}).get('llm_calls')} 次模型调用、{len(tool_calls(r.get('task')))} 次工具调用）。")


def resume_line(r: dict[str, Any]) -> str:
    return resume_how(r) + seen_line(r)


def resume_how(r: dict[str, Any]) -> str:
    if r["condition"] != "resumed":
        p = r["phases"][0]
        return (f"同一个进程：任务答完，`context_log.json` 已指向它的日志（`{p.get('mapping_after')}`），"
                "第二条消息直接发给同一个 agent。")
    if len(r["phases"]) < 2:
        return "第二个进程没有起来（任务没做完）。"
    p0, p1 = r["phases"]
    ch = p1.get("channel") or {}
    ci = [c for c in ch.get("calls") or [] if c["fn"] == "continue_inplace"]
    h = ch.get("history") or {}
    if not ch.get("resumed") or not ci:
        return f"**没接回**：{ch.get('printed') or p1.get('error')}"
    c = ci[0]
    kw = ", ".join(f"{k}={v}" for k, v in c["kwargs"].items())
    return (f"第一个进程结束后，它的 turn-end 钩子留下的 `context_log.json` 指向 `{p0.get('mapping_after')}`；"
            f"新进程起来时 `ChannelResume.attach` → `resume` → `continue_inplace(…, agent_id=\"{c['agent_id']}\", {kw})`"
            f"，返回「{c['returned'][0]}」；装回 backend.history {h.get('messages')} 条消息，其中工具调用 "
            f"{len(h.get('tool_uses') or [])} 次、工具结果 {h.get('tool_results')} 个；工作记忆 "
            f"{len(ch.get('working_memory') or [])} 行；之后的轮次续写在同一份日志（`{p1.get('log')}`）。")


def variant_of(r: dict[str, Any]) -> str:
    return r.get("variant") or "without"


def conclusion_for(scored: list[dict[str, Any]]) -> str:
    passed = [r for r in scored if verdict(r)["passed"]]
    judged = [r for r in scored if verdict(r)["passed"] is not None]
    failed = [r for r in judged if not verdict(r)["passed"]]
    if len(judged) < len(scored) or len(scored) != 12:
        return f"计分运行 {len(scored)} 次，已判 {len(judged)} 次，其中过 {len(passed)} 次；没判完，不下结论。"
    if not failed:
        return "**过合格线**：12 次计分运行 1–3 项全过。"

    def how_failed(r: dict[str, Any]) -> str:
        v = verdict(r)
        bits = ([f"问后调了 {facts(r)['ask_calls']} 次工具"] if not v["no_redo"] else []) \
            + (["说的步骤对不上"] if not v["accurate"] else []) + (["推脱"] if not v["no_deflect"] else [])
        return f"`{r['id']}`（{'，'.join(bits)}）"

    items = {k: sum(1 for r in scored if not verdict(r)[k]) for k in ("no_redo", "accurate", "no_deflect")}
    return (f"**没过合格线**：12 次计分运行过 {len(passed)} 次；不过的是 " + "、".join(how_failed(r) for r in failed)
            + f"。按项数：1 没重做不过 {items['no_redo']} 次，2 说得对不过 {items['accurate']} 次，"
            f"3 没推脱不过 {items['no_deflect']} 次（逐条见下）。")


def chars_of(rs: list[dict[str, Any]]) -> list[int]:
    return [facts(r)["form"]["chars"] for r in rs]


def compare_section(results: list[dict[str, Any]], cases: dict[str, Any], variants: list[str]) -> list[str]:
    """The per-ask, per-condition comparison of the variants, their scored
    totals, and what got better or worse (counted; the verdicts are in the
    runs below)."""
    lines = ["| 问法 | 条件 | 变体 | 1–3 全过 | 问后工具调用（每次） | 回复字数（每次） | 有表格 / 有标题 / 代码块 |",
             "|---|---|---|---|---|---|---|"]
    for a in cases["asks"]:
        for cond in CONDITIONS:
            for v in variants:
                rs = [r for r in results if variant_of(r) == v and r["ask"] == a["id"] and r["condition"] == cond]
                if not rs:
                    continue
                vs = [verdict(r)["passed"] for r in rs]
                ok = (f"{sum(1 for x in vs if x)}/{len(rs)}" + ("（未判完）" if None in vs else "")) if a["scored"] \
                    else "只记录"
                forms = [facts(r)["form"] for r in rs]
                lines.append(f"| {a['id']} | {cond} | {v} | {ok} | {'、'.join(str(facts(r)['ask_calls']) for r in rs)} | "
                             f"{'、'.join(str(x) for x in chars_of(rs))} | {sum(1 for x in forms if x['table'])} / "
                             f"{sum(1 for x in forms if x['heading'])} / {sum(x['code_blocks'] for x in forms)} |")
    lines += ["", "计分的 12 次（`how`、`steps`、`show`）合起来：", "",
              "| 变体 | 1–3 全过 | 1 没重做 | 2 说得对 | 3 没推脱 | 问后工具调用合计 | 字数中位数 | 字数范围 | 有表格 | 有标题 | 代码块 |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    stats: dict[str, dict[str, Any]] = {}
    for v in variants:
        rs = [r for r in results if variant_of(r) == v and r["scored"]]
        if not rs:
            continue
        vs = [verdict(r) for r in rs]
        ch = chars_of(rs)
        forms = [facts(r)["form"] for r in rs]
        st = stats[v] = {"n": len(rs), "passed": sum(1 for x in vs if x["passed"]),
                         "judged": all(x["passed"] is not None for x in vs),
                         "redo": sum(1 for x in vs if x["no_redo"]), "acc": sum(1 for x in vs if x["accurate"]),
                         "defl": sum(1 for x in vs if x["no_deflect"]),
                         "calls": sum(facts(r)["ask_calls"] for r in rs), "median": statistics.median(ch),
                         "min": min(ch), "max": max(ch), "tables": sum(1 for x in forms if x["table"]),
                         "headings": sum(1 for x in forms if x["heading"]),
                         "blocks": sum(x["code_blocks"] for x in forms)}
        med = st["median"]
        lines.append(f"| {v} | {st['passed']}/{st['n']} | {st['redo']}/{st['n']} | {st['acc']}/{st['n']} | "
                     f"{st['defl']}/{st['n']} | {st['calls']} | {med:g} | {st['min']}–{st['max']} | {st['tables']} | "
                     f"{st['headings']} | {st['blocks']} |")
    lines.append("")
    if "without" in stats and "with_line" in stats and stats["with_line"]["judged"] and stats["without"]["judged"]:
        a, b = stats["without"], stats["with_line"]
        lines.append(f"- `with_line` {'**过**' if b['passed'] == b['n'] == 12 else '**没过**'}合格线（12 次里 1–3 项全过 "
                     f"{b['passed']} 次；`without` 是 {a['passed']} 次）。")
        worse = []
        if b["median"] > a["median"] or b["max"] > a["max"]:
            worse.append(f"计分回复的字数中位数 {a['median']:g} → {b['median']:g}，最长 {a['max']} → {b['max']}")
        hs = [r["id"] for r in results if variant_of(r) == "with_line" and r["ask"] in ("how", "steps")
              and facts(r)["ask_calls"]]
        if hs:
            worse.append("`how` / `steps` 问后调了工具：" + "、".join(f"`{x}`" for x in hs))
        for key, label in (("acc", "2 说得对"), ("defl", "3 没推脱")):
            if b[key] < a[key]:
                worse.append(f"{label}过的次数 {a[key]} → {b[key]}")
        for key, label in (("tables", "有表格的回复"), ("headings", "有标题的回复"), ("blocks", "代码块")):
            if b[key] > a[key]:
                worse.append(f"{label} {a[key]} → {b[key]}")
        lines.append("- 比 `without` 差的地方（脚本数的）：" + ("；".join(worse) + "。" if worse else "没有。")
                     + f"字数中位数 {a['median']:g} → {b['median']:g}，范围 {a['min']}–{a['max']} → {b['min']}–{b['max']}；"
                     f"问后工具调用 {a['calls']} → {b['calls']} 次。")
        el = []
        for v in variants:
            rs = [r for r in results if variant_of(r) == v and r["ask"] == "elapsed"]
            el.append(f"`{v}`：" + "；".join(
                f"`{r['id']}` {ELAPSED_LABELS.get((r.get('judgment') or {}).get('elapsed'), '（未判）')}"
                f"（问后 {facts(r)['ask_calls']} 次调用）" for r in rs))
        lines.append("- `elapsed`（只记录，看它还查不查该查的）：" + "。".join(el) + "。")
        looked = {v: sum(1 for r in results if variant_of(r) == v and r["ask"] == "elapsed" and facts(r)["ask_calls"])
                  for v in variants}
        made_up = sum(1 for r in results if r["ask"] == "elapsed"
                      and (r.get("judgment") or {}).get("elapsed") == "made_up")
        n_el = {v: sum(1 for r in results if variant_of(r) == v and r["ask"] == "elapsed") for v in variants}
        lines.append("- 问用时时自己去查（翻内核日志的时间戳）的次数：" + "，".join(
            f"`{v}` {looked[v]}/{n_el[v]}" for v in variants) + "；编数 " + str(made_up) + " 次。"
            + ("各只有 4 次，分不出少查是这句话的作用，还是本来就只是偶尔查。" if looked.get("with_line", 0) < looked.get("without", 0)
               else ""))
        lines.append("")
    return lines


def render_md(data: dict[str, Any], cases: dict[str, Any]) -> str:
    meta = data["meta"]
    results = data["results"]
    asks = {a["id"]: a for a in cases["asks"]}
    variants = [v for v in VARIANT_ORDER if any(variant_of(r) == v for r in results)]
    tasks = [r.get("task") or {} for r in results]
    sparse_told = sum(1 for t in tasks if re.search(r"稀疏|实际分配|实际占", display(t.get("final_reply"))))
    du_tried = sum(1 for t in tasks if any(re.search(r"\bdu\b", json.dumps(c.get("args") or {}, ensure_ascii=False))
                                           for c in tool_calls(t)))
    mem_reads = sum(1 for t in tasks if any("global_mem" in json.dumps(c.get("args") or {}, ensure_ascii=False)
                                            for c in tool_calls(t)))
    ran = meta.get("variant_runs") or {"without": {"ran_at": meta["ran_at"]}}
    lines = [
        "# 「问一句」评测（IM 撤掉过程入口，票 02）",
        "",
        "跑于：" + "；".join(f"`{v}` {ran.get(v, {}).get('ran_at', '?')}" for v in variants)
        + (f"（补跑：{'；'.join(x['at'] + ' ' + str(len(x['runs'])) + ' 次' for x in meta['partial_reruns'])}）"
           if meta.get("partial_reruns") else "")
        + f"。模型 {meta['model']['name']}（{meta['model_source']}；推理强度 "
        + f"{meta['model']['options'].get('reasoning_effort')}），平台 Telegram，GA_LANG={meta.get('ga_lang')}；"
        + f"{len(results)} 次运行，每次先做一个任务、再问一句。",
        "",
    ]
    if len(variants) > 1:
        lines += ["## " + " / ".join(f"`{v}`" for v in variants) + " 对照", ""]
        lines += compare_section(results, cases, variants)
    lines += ["## 结论", ""]
    for v in variants:
        lines.append(f"- `{v}`：" + conclusion_for([r for r in results if variant_of(r) == v and r["scored"]]))
    lines += [
        "",
        "合格线：三种计分问法（`how`、`steps`、`show`）× 两个条件 × 2 次 = 12 次，1 没有重做、2 说得对、3 没有推脱全过。"
        "`elapsed` 与第 4 项只记录。",
        "",
    ]
    specs = cases.get("variants") or {}
    if any(specs.get(v) for v in variants):
        lines += ["## 变体", "", "- `without`：入口层照今天 Rust 写出的样子（`galley-prompt/im_entry.telegram.txt`）。"]
        for v in variants:
            if specs.get(v):
                lines += [f"- `{v}`：同一份提示词，入口层「{specs[v]['after']}」这一行之后另起一段（前后各空一行）插入：", "",
                          "```text", specs[v]["text"].strip(), "```", ""]
        lines += ["变体的话只在 `cases.json`，产品提示词没动。", ""]
    lines += [
        "## 一览",
        "",
        "| 运行 | 变体 | 条件 | 问法 | 任务步数 | 问后调用 | 1 没重做 | 2 说得对 | 3 没推脱 | 合格 | 4 像 IM（只记录） |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        f, v = facts(r), verdict(r)
        lines.append(
            f"| `{r['id']}` | {variant_of(r)} | {r['condition']} | {r['ask']} | {f['task_calls']} | {f['ask_calls']} | "
            f"{yes(v['no_redo'])} | {yes(v['accurate'])} | {yes(v['no_deflect'])} | "
            + (yes(v["passed"]) if r["scored"] else "只记录")
            + f" | {f['form']['chars']} 字" + ("，表格" if f["form"]["table"] else "") + ("，标题" if f["form"]["heading"] else "")
            + (f"，代码块 {f['form']['code_blocks']}" if f["form"]["code_blocks"] else "") + " |")
    lines += ["", "## `elapsed`（只记录）", ""]
    for r in results:
        if r["ask"] != "elapsed":
            continue
        j = r.get("judgment") or {}
        label = ELAPSED_LABELS.get(j.get("elapsed"), "（未判）")
        lines.append(f"- `{r['id']}`（{variant_of(r)}）：{label}。{j.get('elapsed_note', '')}".rstrip())
    lines += [
        "",
        "## 怎么跑的",
        "",
        "- 提示词：Galley 那段是今天的 Rust 代码写出的 IM 组合（`galley-prompt/`：`compose_im_runtime_prompt` 与 "
        "`im_supervisor_prompt`，平台 Telegram），按 runner 的 `managed_prompt_profile` 拼接；GA 核心提示词与记忆由引擎自己拼。"
        "产品提示词没有改任何一句；变体只在评测进程里给入口层加一段（见「变体」）。两个变体的模型、任务、夹具、判法都一样。",
        "- 每次运行是一个 Telegram 聊天：第一条消息是任务（不计分），第二条是问法之一；两条都照 tgapp 的写法发"
        "（`FILE_HINT` 一行加空行加用户的话），经 `put_task` 交给 agent。",
        "- 任务的工具调用真的执行，只在这次运行自己的沙盒里：假 HOME，`~/Downloads` 里的文件名与内容都是虚构的"
        "（几个大文件开头是真的文件头或真的 SQLite 库，后面是稀疏空洞，不占磁盘），没有网络；可启动的程序是解释器、bash / sh、"
        "假 `galley` 与 `sed`、`cat`、`head`、`tail`、`ls`、`grep`、`wc`、`sleep`、`date`、`df`、`file`、`sort`、`find`、`stat`、"
        f"`awk`、`xargs`、`sqlite3`（`du` 不在内）；浏览器工具、`ask_user` 停在那里不执行；每条消息最多 {meta.get('tool_cap', TOOL_CAP)} 次工具调用。",
        f"- 任务做了不到 {MIN_TASK_CALLS} 次干活的工具调用（GA 自己的工作记忆工具不算），或没有以回答结束，就整次重跑，"
        f"最多 {MAX_ATTEMPTS} 次；被换掉的列在「重跑」一节。",
        "- `live`：同一个 agent 进程，任务答完后接着 `put_task` 第二条消息。",
        "- `resumed`：任务答完后这个进程退出（`os._exit`，不留锁）；第二个进程用同一个状态根与同一个渠道状态目录，"
        "照 `runner/managed_im_supervisor.py` 的 `_run_telegram`：装好托管提示词后 `im_resume.load(\"telegram\", 状态目录)`、"
        "`ChannelResume.attach(agent)`，即渠道真实的接回路径：`resume` 读第一个进程的 turn-end 钩子写下的 `context_log.json`，"
        "调 `continue_cmd.continue_inplace(agent, 日志, \"galley-telegram\", restore_wm=True)` 从内核日志装回原生历史"
        "（含每步的工具调用与结果）与工作记忆，再发第二条消息。接回的调用与它的返回值逐次记在下面每次运行里。"
        "两个条件里第一个进程启动时也同样 attach（没有映射，什么都不接）。",
        "- 第 1 项数第二条消息之后的工具调用；第 2、3 项是读了回复与第一条消息实际的工具调用之后逐条判的，判词一句；"
        "第 4 项是脚本数的（字数不含空白）；`elapsed` 判照实说不知道、有依据、还是编造。"
        f"GA 每次任务开头都先看工作目录、读记忆（{mem_reads}/{len(results)} 次），复述里没提这一步不算漏了关键一步。",
        "- 回复正文照现成脚本的去标签规则（`<summary>` 等）显示。工具调用清单里脚本与输出压成一行（⏎ 是换行）并截断，"
        "`~` 是这次运行的假 HOME，`<状态根>` 是它的托管状态根，GA 每次 Python 运行开头打印的那行提示省去；全文在本机 `results.json`。",
        "",
        "## 它没有复现什么",
        "",
        "- Telegram 本身：消息的发送、渲染与分条，在跑时的状态消息，tgapp 的排队与停止；第二条消息在任务答完后立刻发出，"
        "真人通常隔一会儿才问。",
        "- 渠道进程的其余部分：完成汇报（reporter）、`/new`、`/continue`；第二个进程不是被 Core 杀掉重启的，"
        "而是脚本让第一个进程自己退出后再起一个。",
        "- 真实的工具环境：沙盒里的文件是虚构的，可用的程序有限（见上），状态根是全新安装的样子（记忆只有种子），"
        "不是 JC 的真实记忆。",
        "- 引擎的进度显示与 `verbose`：只影响显示，不进模型上下文。",
        "- 每格只跑两次，看不出更细的波动；只量了一个任务（找大文件、说是什么）。",
        f"- 夹具的副作用：大文件后面是稀疏空洞，{len(results)} 次任务里 {sparse_told} 次读了已分配块数，告诉用户"
        f"「标称约 10 GB、实际只占约 84 KB」；`du` 不在可启动的程序里，{du_tried} 次任务调了它被拒。"
        "这两件事成了任务过程的一部分，复述里也照实出现，判「说得对」时照调用核对；真实的下载文件夹里不会有这一段。",
    ] + [f"- {n}" for n in meta.get("notes") or []]
    sup = meta.get("superseded") or []
    lines += ["", "## 重跑", ""]
    if not sup:
        lines.append("没有。")
    for x in sup:
        lines.append(f"- `{x['id']}` 第 {x['attempt']} 次：{x['status']}（{x['status_note']}）；工具调用 "
                     + ("、".join(x.get("task_calls") or []) or "无") + "。")
    lines += ["", "## 逐次运行", ""]
    for r in results:
        f, v = facts(r), verdict(r)
        j = r.get("judgment") or {}
        a = asks[r["ask"]]
        lines += [f"### `{r['id']}`：{variant_of(r)}，{COND_TITLES[r['condition']]}，问「{a['message']}」，第 {r['repeat']} 遍"
                  + (f"（第 {r['attempt']} 次跑）" if r["attempt"] > 1 else ""), ""]
        if r["status"] not in ("ok",):
            lines += [f"**运行没成**：{r['status']}（{r['status_note']}）", ""]
        task = r.get("task") or {}
        tcalls = tool_calls(task)
        lines += [f"第一条消息的工具调用（{len(tcalls)} 次，干活的 {f['task_calls']} 次）：", ""]
        lines += [call_line(c) for c in tcalls] + [""]
        lines += ["第一条消息的回答（不计分）：", ""] + quote(display(task.get("final_reply")))
        lines += [f"接回：{resume_line(r)}", ""]
        ask = r.get("ask_turn")
        if not ask:
            continue
        acalls = tool_calls(ask)
        if acalls:
            lines += [f"第二条消息之后的工具调用（{len(acalls)} 次）：", ""] + [call_line(c) for c in acalls] + [""]
            said = [display(t.get("content")) for t in (ask.get("turns") or [])[:-1]]
            said = [s for s in said if s]
            lines += (["调工具那几步里写的话：", ""] + [x for s in said for x in quote(s)]) if said \
                else ["调工具那几步里没写话。", ""]
        else:
            lines += ["第二条消息之后的工具调用：0 次。", ""]
        lines += ["回复：", ""] + quote(display(ask.get("final_reply")))
        lines += [
            "判定：",
            "",
            f"1. 没有重做：{yes(v['no_redo'])}（{f['ask_calls']} 次工具调用"
            + (("：" + "、".join(f["ask_call_names"])) if f["ask_calls"] else "") + "）。"
            + (j.get("redo_note") or ""),
            f"2. 说得对：{yes(v['accurate'])}。{j.get('accurate_note', '')}".rstrip(),
            f"3. 没有推脱：{yes(v['no_deflect'])}。{j.get('deflect_note', '')}".rstrip(),
            f"4. 像 IM（只记录）：{form_line(f['form'])}。",
        ]
        if r["ask"] == "elapsed":
            lines.append(f"5. 用时（只记录）：{ELAPSED_LABELS.get(j.get('elapsed'), '（未判）')}。"
                         f"{j.get('elapsed_note', '')}".rstrip())
        lines.append("")
    usage = meta.get("usage_total") or {}
    lines += ["## 用量", "", f"输入 {usage.get('input_tokens', 0)} token（缓存命中 {usage.get('cached_tokens', 0)}），"
              f"输出 {usage.get('output_tokens', 0)} token（推理 {usage.get('reasoning_tokens', 0)}），"
              f"模型调用 {meta.get('llm_calls_total', 0)} 次（被换掉的运行不计）。", ""]
    return "\n".join(lines).rstrip() + "\n"


def all_turns(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [t for r in results for t in (r.get("task"), r.get("ask_turn")) if t]


# ----------------------------------------------------------------------
# Hygiene
# ----------------------------------------------------------------------

def scrub(text: str) -> str:
    """base.scrub (temp dir, interpreter, API host, login name) after the
    repo and the real home: no local path reaches a written file."""
    for p in sorted({str(REPO), os.path.realpath(REPO)}, key=len, reverse=True):
        text = text.replace(p, "$REPO")
    home = str(Path.home())
    text = text.replace(home + "/", "$REAL_HOME/")
    return base.scrub(text)


def write_results(data: dict[str, Any], cases: dict[str, Any]) -> None:
    RESULTS_JSON.write_text(scrub(json.dumps(data, ensure_ascii=False, indent=2) + "\n"), encoding="utf-8")
    RESULTS_MD.write_text(scrub(render_md(data, cases)), encoding="utf-8")


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

JUDGE_KEYS = {"accurate", "accurate_note", "no_deflect", "deflect_note", "redo_note", "elapsed", "elapsed_note"}


def merge_judgments(data: dict[str, Any], path: Path) -> None:
    """The reader's verdicts, by run id: accurate / no_deflect (bool) with a
    one-sentence note each, redo_note, and for `elapsed` runs elapsed
    (unknown / grounded / made_up) with a note."""
    verdicts = json.loads(path.read_text(encoding="utf-8"))
    by = {r["id"]: r for r in data["results"]}
    unknown = sorted(set(verdicts) - set(by))
    if unknown:
        fail(f"--judge: unknown run ids {unknown}")
    for rid, j in verdicts.items():
        bad = set(j) - JUDGE_KEYS
        if bad:
            fail(f"--judge: {rid}: unknown keys {sorted(bad)}")
        if j.get("elapsed") is not None and j["elapsed"] not in ELAPSED_LABELS:
            fail(f"--judge: {rid}: elapsed must be one of {sorted(ELAPSED_LABELS)}")
        by[rid]["judgment"] = j


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--dry-test", action="store_true", help="verify the setup, no model")
    ap.add_argument("--render-only", action="store_true", help="rebuild results.md from results.json")
    ap.add_argument("--judge", help="merge the reader's verdicts (JSON by run id) into results.json")
    ap.add_argument("--asks", default="all", help="comma list of ask ids, or all")
    ap.add_argument("--conditions", default="all", help="comma list of live,resumed, or all")
    ap.add_argument("--variant", default="all", help="comma list of without,with_line, or all")
    ap.add_argument("--repeats", type=int, default=None)
    ap.add_argument("--first-repeat", type=int, default=1, help="number the runs from here")
    ap.add_argument("--galley-db", default=str(base.DEFAULT_GALLEY_DB))
    ap.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    ap.add_argument("--ga-lang", default="en", help="GA_LANG; JC's dev Core has LANG=en_US.UTF-8")
    ap.add_argument("--python", default=sys.executable, help="interpreter for the workers")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    if args.worker:
        return worker()
    # The IM eval's fake CLI (also answers `sessions search`, keeps the
    # sessions it starts) and its SOP files for base.manual_sha. base.run_job
    # is not used here, so its worker path does not matter.
    im.install_base_patches()
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    if args.dry_test:
        return dry_test(args.python, args.ga_lang, args.keep_temp)
    if args.render_only or args.judge:
        data = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
        if args.judge:
            merge_judgments(data, Path(args.judge))
        write_results(data, cases)
        return 0

    ask_ids = [a["id"] for a in cases["asks"]]
    asks = ask_ids if args.asks == "all" else [x.strip() for x in args.asks.split(",")]
    conditions = list(CONDITIONS) if args.conditions == "all" else [x.strip() for x in args.conditions.split(",")]
    variants = list(VARIANT_ORDER) if args.variant == "all" else [x.strip() for x in args.variant.split(",")]
    if not asks or any(a not in ask_ids for a in asks) or not conditions or any(c not in CONDITIONS for c in conditions):
        fail(f"--asks: {', '.join(ask_ids)} or all; --conditions: {', '.join(CONDITIONS)} or all")
    if not variants or any(v not in VARIANT_ORDER or v not in cases["variants"] for v in variants):
        fail(f"--variant: {', '.join(VARIANT_ORDER)} or all")
    repeats = args.repeats if args.repeats is not None else int(cases["repeats"])

    model = base.model_from_galley_db(Path(args.galley_db).expanduser(), args.model_id)
    mykeys = base.ga_mykeys_from_galley_model(model)
    if len(mykeys) != 1:
        fail("expected exactly one model config")
    host = urlparse(str(next(iter(mykeys.values())).get("apibase", ""))).hostname
    if not host:
        fail("model config has no api host")
    base.API_HOSTS.add(host)
    allowed = {host}
    for var in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        if os.environ.get(var):
            proxy = urlparse(os.environ[var]).hostname
            if proxy:
                allowed.add(proxy)
    now = datetime.now().astimezone()
    runs = make_runs(cases, asks, conditions, repeats, args.first_repeat, now, mykeys, args.ga_lang, allowed, variants)
    print(f"{len(runs)} runs, model {base.describe_mykeys(mykeys)['name']}, parallel {args.parallel}")
    results, superseded = run_all(runs, args.python, args.parallel, args.keep_temp)

    # No copy of the key may reach a written file.
    secret = str(next(iter(mykeys.values())).get("apikey") or "")
    if len(secret) >= 8:
        results = json.loads(json.dumps(results, ensure_ascii=False).replace(secret, "<redacted>"))
        superseded = json.loads(json.dumps(superseded, ensure_ascii=False).replace(secret, "<redacted>"))

    previous: dict[str, Any] = {"results": [], "meta": {}}
    if RESULTS_JSON.is_file():
        previous = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
    pm = previous.get("meta") or {}
    fresh = {r["id"] for r in results}
    before = {r["id"] for r in previous["results"]}
    merged = [r for r in previous["results"] if r["id"] not in fresh] + results
    reruns = list(pm.get("partial_reruns") or [])
    if fresh & before:  # runs made again; a new variant's first runs are not reruns
        reruns.append({"at": now.strftime("%Y-%m-%d %H:%M"), "runs": sorted(fresh & before)})
    variant_runs = dict(pm.get("variant_runs") or ({"without": {"ran_at": pm["ran_at"]}} if pm.get("ran_at") else {}))
    for v in variants:
        variant_runs.setdefault(v, {"ran_at": now.strftime("%Y-%m-%d %H:%M")})
    meta = {
        "ran_at": pm.get("ran_at", now.strftime("%Y-%m-%d %H:%M")),
        "partial_reruns": reruns,
        "variant_runs": variant_runs,
        "suite": "ask-it eval (im-answer-only ticket 02): today's IM prompt, Telegram, a task then an ask, "
                 "live or resumed through the channel's resume",
        "model": base.describe_mykeys(mykeys),
        "model_source": ("Galley 托管模型，主评测脚本 `--model-id` 的默认那一条（API key 接入），从 Galley 数据库只读取得"
                         if args.model_id == DEFAULT_MODEL_ID else "Galley 托管模型，`--model-id` 另指的一条，从 Galley 数据库只读取得"),
        "ga_lang": args.ga_lang,
        "python": platform.python_version(),
        "tool_cap": TOOL_CAP,
        "sop_sha": base.manual_sha(),
        "usage_total": im.summarize_usage(all_turns(merged)),
        "llm_calls_total": sum(int(t.get("llm_calls") or 0) for t in all_turns(merged)),
    }
    # A run made again here takes the attempts its earlier version replaced
    # out of the list; its own replaced attempts go in.
    kept = [x for x in pm.get("superseded") or [] if x["id"] not in fresh]
    data = assemble(merged, kept + superseded, meta, list(pm.get("notes") or []))
    write_results(data, cases)
    bad = [f"{r['id']}: {r['status']}" for r in results if r["status"] != "ok"]
    print(f"usage: {meta['usage_total']}")
    print("not ok: " + ("; ".join(bad) if bad else "none"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
