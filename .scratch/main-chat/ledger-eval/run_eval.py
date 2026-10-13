#!/usr/bin/env python3
"""Affairs-ledger eval (tickets 01, 04 and 04d, 「合成语料与验收」). See README.md.

Everything runs in a throwaway work directory (a fresh temp dir unless
--workdir is given): its own workbench.db and its own managed state root.
The real Galley data directory is never read or written.

Commands:

  prepare-only  No model. Builds the DB and state root from corpus.json and
                runs Core's batch preparation (core/examples/
                ledger_eval_prepare.rs, i.e. ledger::run::begin) at every
                step, committing each step as if the run had succeeded.
                Saves each batch under <workdir>/steps/ and checks the
                prep-stage expectations (CLI / supervisor / assistant /
                before-since content absent from every batch).
  run           Needs a real model (manual, like `pytest -m e2e`). Same
                steps, but between prepare and commit the bundled engine
                (managed-ga/code/agentmain.py --func) executes the mining
                task against the work directory's state root; a failed run
                is recorded with `fail` (the position stays). After every
                successful step the outputs go through the Memory page's
                parser (core/examples/ledger_parse.rs). Then `check`.
  check         Compare <state root>/memory/history_insight/ with
                expected.json through the parser's structure: which entries
                are ongoing / ended, which emotions sit under which entry
                (ticket 04d: emotions live in their affair's block, there is
                no emotions file), and whether the file was read whole.
                Keyword checks only, no LLM grading.
  selftest      No model. Runs the checker on hand-written outputs (ones
                that should pass, ones that should fail).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CORPUS = HERE / "corpus.json"
EXPECTED = HERE / "expected.json"
OPPOSITE = {"ongoing": "ended", "ended": "ongoing"}


def fail(msg: str) -> None:
    print(f"run_eval: {msg}", file=sys.stderr)
    sys.exit(2)


def guard(workdir: Path) -> None:
    shown = str(workdir.resolve())
    if "app.galley" in shown or "Application Support" in shown:
        fail(f"refusing work directory {shown}: it looks like real Galley data")


# ---------------- Core ----------------


def cargo_example(name: str, *args: str) -> dict[str, Any]:
    cmd = [
        "cargo",
        "run",
        "--quiet",
        "--manifest-path",
        str(REPO / "core" / "Cargo.toml"),
        "-p",
        "galley-core",
        "--example",
        name,
        "--",
        *args,
    ]
    done = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if done.returncode != 0:
        fail(f"{name} {' '.join(args)} failed:\n{done.stderr}")
    result: dict[str, Any] = json.loads(done.stdout.strip().splitlines()[-1])
    return result


def core(workdir: Path, *args: str) -> dict[str, Any]:
    return cargo_example(
        "ledger_eval_prepare", "--corpus", str(CORPUS), "--workdir", str(workdir), *args
    )


def parse_outputs(insight: Path) -> dict[str, Any]:
    """The Memory page's parser over a history_insight directory."""
    return cargo_example("ledger_parse", str(insight))


# ---------------- steps ----------------


def steps(corpus: dict[str, Any], step_days: int) -> list[str]:
    """Local times of the daily-run stand-ins: 04:00 every `step_days`
    days from `since`, up to the day after the last turn."""
    times = [m["at"] for s in corpus["sessions"] for m in s["messages"]]
    times += [t["at"] for log in corpus.get("im", []) for t in log["turns"]]
    last = max(datetime.strptime(t[:16], "%Y-%m-%d %H:%M") for t in times)
    day = datetime.strptime(corpus["since"], "%Y-%m-%d") + timedelta(days=step_days, hours=4)
    end = datetime(last.year, last.month, last.day) + timedelta(days=1, hours=4)
    out = []
    while True:
        out.append(min(day, end).strftime("%Y-%m-%d %H:%M"))
        if day >= end:
            return out
        day += timedelta(days=step_days)


def seed_memory(state_root: Path) -> None:
    """The managed memory seed, as Galley's first launch copies it (missing
    files only): the SOP the task points at must exist."""
    seed = REPO / "managed-ga" / "state-seed" / "memory"
    shutil.copytree(seed, state_root / "memory", dirs_exist_ok=True)


def mine(
    workdir: Path, state_root: Path, args: argparse.Namespace, step_dir: Path
) -> tuple[bool, str]:
    """The model half: the bundled engine runs the task once, against the
    work directory's state root. Not Galley's runtime prompt or model
    config — the engine with the given mykey.py."""
    mykey = Path(args.mykey).expanduser().resolve()
    if not mykey.is_file():
        fail(f"--mykey {mykey} is not a file")
    task = workdir / "task.txt"
    out = workdir / "task.out.txt"
    out.unlink(missing_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GALLEY_")}
    env["GALLEY_GA_STATE_ROOT"] = str(state_root)
    env["PYTHONPATH"] = str(mykey.parent)
    # No __pycache__ in managed-ga/code/: the managed payload gate
    # (scripts/check-managed-ga-payload.mjs) refuses generated files there.
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env.setdefault("GA_LANG", "zh")
    cmd = [
        args.ga_python,
        "agentmain.py",
        "--func",
        str(task),
        "--nobg",
        "--llm_no",
        str(args.llm_no),
    ]
    print(f"  mining: {' '.join(cmd)}")
    try:
        done = subprocess.run(
            cmd,
            cwd=REPO / "managed-ga" / "code",
            env=env,
            capture_output=True,
            text=True,
            timeout=args.timeout,
        )
    except subprocess.TimeoutExpired:
        return False, f"timed out after {args.timeout}s"
    (step_dir / "engine.stdout.txt").write_text(done.stdout, encoding="utf-8")
    (step_dir / "engine.stderr.txt").write_text(done.stderr, encoding="utf-8")
    if out.exists():
        shutil.copy(out, step_dir / "task.out.txt")
    answer = out.read_text(encoding="utf-8") if out.exists() else ""
    if done.returncode != 0 or "[ROUND END]" not in answer:
        return False, f"engine exit {done.returncode}; see {step_dir}"
    return True, ""


def insight_dir(workdir: Path) -> Path:
    return workdir / "managed-ga-state" / "memory" / "history_insight"


def snapshot(workdir: Path, step_dir: Path) -> dict[str, Any]:
    """Copy the outputs and their parse into the step directory, and print
    how much the parser recognised."""
    insight = insight_dir(workdir)
    out = step_dir / "outputs"
    out.mkdir(exist_ok=True)
    for path in insight.iterdir():
        if path.is_file():
            shutil.copy(path, out / path.name)
    parsed = parse_outputs(insight)
    (step_dir / "parsed.json").write_text(
        json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("  parsed: " + parse_summary(parsed))
    return parsed


def parse_summary(parsed: dict[str, Any]) -> str:
    a = parsed["activities"]
    if a["kind"] != "parsed":
        return f"activities {a['kind']}"
    entries = a["ongoing"] + a["ended"]
    emotions = sum(len(e.get("emotions", [])) for e in entries)
    return (
        f"activities {len(a['ongoing'])} ongoing / {len(a['ended'])} ended, "
        f"{emotions} emotion line(s) under {sum(1 for e in entries if e.get('emotions'))} "
        f"entr(ies), other {len(a.get('other') or '')} chars"
    )


def entry_text(entry: dict[str, Any]) -> str:
    """An entry's own words: title, status, sessions, quotes, extra — not
    its emotions (those are checked on their own)."""
    parts = [entry.get("title", ""), entry.get("status") or ""]
    parts += entry.get("sessions", []) + entry.get("extra", [])
    parts += [q.get("text", "") for q in entry.get("quotes", [])]
    return "\n".join(parts)


def emotion_text(emotion: dict[str, Any]) -> str:
    return "\n".join([emotion.get("text") or "", *emotion.get("tags", [])])


def run_steps(args: argparse.Namespace, with_model: bool, expected: dict[str, Any]) -> Path:
    workdir = (
        Path(args.workdir).resolve()
        if args.workdir
        else Path(tempfile.mkdtemp(prefix="galley-ledger-eval-"))
    )
    guard(workdir)
    if (workdir / "workbench.db").exists():
        fail(f"{workdir} already holds a run; pass a new --workdir")
    workdir.mkdir(parents=True, exist_ok=True)
    state_root = workdir / "managed-ga-state"
    seed_memory(state_root)
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    print(f"work directory: {workdir}")
    for i, now in enumerate(steps(corpus, args.step_days), start=1):
        step_dir = workdir / "steps" / f"{i:02d}"
        step_dir.mkdir(parents=True, exist_ok=True)
        result = core(workdir, "prepare", "--now", now)
        print(
            f"step {i} @ {now}: {result['status']}"
            + (
                f", {result['groups']} groups, {result['turns']} turns"
                if result["status"] == "ready"
                else ""
            )
        )
        if result["status"] != "ready":
            continue
        shutil.copy(result["batch"], step_dir / "batch.md")
        shutil.copy(result["task"], step_dir / "task.txt")
        if not with_model:
            core(workdir, "commit")
            continue
        ok, reason = mine(workdir, state_root, args, step_dir)
        if ok:
            core(workdir, "commit")
            snapshot(workdir, step_dir)
        else:
            print(f"  run failed: {reason}")
            core(workdir, "fail", "--reason", reason)
    return workdir


def check_batches(workdir: Path, expected: dict[str, Any]) -> bool:
    """Prep-stage expectations: Core never hands these to the model."""
    batches = sorted((workdir / "steps").glob("*/batch.md"))
    text = "\n".join(p.read_text(encoding="utf-8") for p in batches)
    ok = True
    print(f"\nprep checks over {len(batches)} batch file(s):")
    for item in expected["mustNotAppear"]:
        if item.get("stage") != "prep":
            continue
        hits = [k for k in item["keywords"] if k in text]
        ok &= not hits
        print(
            f"  [{'PASS' if not hits else 'FAIL'}] {item['id']}（{item['why']}）"
            + (f" found {hits}" if hits else "")
        )
    for item in expected["mustNotAppear"]:
        if item.get("stage") == "model":
            present = any(k in text for k in item["keywords"])
            print(
                f"  [info] {item['id']}（{item['why']}）in the batch, for the model to ignore: "
                f"{present}"
            )
    if "If you need to show files to user" in text:
        print("  [FAIL] the IM hint leaked into a batch")
        ok = False
    return ok


# ---------------- checker ----------------


def raw_lines(insight: Path) -> list[tuple[str, str]]:
    """Every non-empty line of every output (Galley's galley/ excluded):
    noise must not appear anywhere, parsed or not."""
    out = []
    for path in sorted(insight.rglob("*")):
        if not path.is_file() or "galley" in path.relative_to(insight).parts:
            continue
        rel = str(path.relative_to(insight))
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip():
                out.append((rel, line.strip()))
    return out


# The outputs since ticket 04d: one ledger file and the short list.
OUTPUTS = {"activities.md", "ongoing_affairs.md"}
EMOTION_LINE = re.compile(r"^\s*[-*+]\s*情绪")


def check(
    insight: Path,
    expected: dict[str, Any],
    parsed: dict[str, Any] | None = None,
) -> bool:
    lines = raw_lines(insight)
    if not lines:
        print(f"[FAIL] no outputs under {insight}")
        return False
    parsed = parsed if parsed is not None else parse_outputs(insight)
    ok = True
    print(f"\noutput checks over {len({w for w, _ in lines})} file(s) in {insight}:")

    # One ledger file and the short list, nothing else (no emotions file).
    files = {p.name for p in insight.iterdir() if p.is_file()}
    stray = sorted(files - OUTPUTS)
    ok &= not stray
    print(
        f"  [{'PASS' if not stray else 'FAIL'}] outputs are activities.md and the short list only"
        + (f"; also {stray}" if stray else "")
    )

    # Read whole: parsed, little or nothing left over.
    doc = parsed["activities"]
    acts = doc if doc["kind"] == "parsed" else None
    if not acts:
        ok = False
        print(f"  [FAIL] activities: {doc['kind']} (the parser recognised no entry)")
    else:
        other = doc.get("other") or ""
        status = "PASS" if not other else ("WARN" if len(other) < 400 else "FAIL")
        ok &= status != "FAIL"
        print(f"  [{status}] activities: read whole" + (f", other {len(other)} chars" if other else ""))
        for line in [ln for ln in other.splitlines() if ln.strip()][:5]:
            print(f"      other: {line[:120]}")
    regions: dict[str, list[dict[str, Any]]] = {
        "ongoing": acts["ongoing"] if acts else [],
        "ended": acts["ended"] if acts else [],
    }
    entries = regions["ongoing"] + regions["ended"]
    emotions = [(e, emo) for e in entries for emo in e.get("emotions", [])]

    # Every emotion line sits in an entry's block and reads as an emotion.
    activities_file = insight / "activities.md"
    raw = (
        activities_file.read_text(encoding="utf-8", errors="replace").splitlines()
        if activities_file.exists()
        else []
    )
    written = [ln.rstrip() for ln in raw if EMOTION_LINE.match(ln)]
    read = {emo["line"].split("\n")[0].rstrip() for _, emo in emotions}
    unread = [ln for ln in written if ln not in read]
    ok &= not unread
    print(
        f"  [{'PASS' if not unread else 'FAIL'}] emotion lines: {len(written)} written, "
        f"all inside an entry and read as emotions"
        + (f"; {len(unread)} not" if unread else "")
    )
    for line in unread[:5]:
        print(f"      not read as an entry's emotion: {line[:120]}")
    print(
        f"  [info] {len(emotions)} emotion(s) under "
        f"{len({e['id'] for e, _ in emotions})} entr(ies)"
    )
    for e, emo in emotions:
        print(f"      {e['id']}｜{e['title']}: {emo['line'][:140]}")

    def regions_hit(keywords: list[str]) -> set[str]:
        return {
            region
            for region, items in regions.items()
            for e in items
            if any(k in entry_text(e) for k in keywords)
        }

    for kind in ("ongoing", "ended"):
        for item in expected[kind]:
            hit = regions_hit(item["keywords"])
            if kind not in hit:
                status = "FAIL"
                ok = False
            elif OPPOSITE[kind] in hit:
                status = "WARN"
            else:
                status = "PASS"
            print(f"  [{status}] {kind}: {item['label']}  (sections hit: {sorted(hit) or '-'})")

    affairs = {i["id"]: i for i in expected["ongoing"] + expected["ended"]}
    for item in expected["emotional"]:
        hosts = [e for e, emo in emotions if any(k in emotion_text(emo) for k in item["keywords"])]
        affair = affairs.get(item.get("affair") or "")
        if not hosts:
            if affair:
                ok = False
                print(f"  [FAIL] emotional: {item['label']}  (not recorded)")
            else:
                print(
                    f"  [info] emotional: {item['label']}  not recorded "
                    "(it belongs to no affair, so the task drops it)"
                )
            continue
        where = ", ".join(f"{e['id']}｜{e['title']}" for e in hosts)
        if affair and not any(any(k in entry_text(e) for k in affair["keywords"]) for e in hosts):
            print(f"  [WARN] emotional: {item['label']}  under {where}, not {affair['label']}")
        else:
            print(f"  [PASS] emotional: {item['label']}  under {where}")

    # The short list: numbered lines of ongoing entries.
    short = parsed.get("affairsRaw")
    if short is not None:
        ongoing_ids = {e["id"] for e in regions["ongoing"]}
        lines_ = [ln.strip() for ln in short.splitlines() if ln.strip()]
        numbered = [re.match(r"^- (A\d+)｜", ln) for ln in lines_]
        bad = [ln for ln, m in zip(lines_, numbered) if not m]
        stray_ids = [m.group(1) for m in numbered if m and m.group(1) not in ongoing_ids]
        status = "PASS" if not bad and not stray_ids else "WARN"
        print(
            f"  [{status}] short list: {len(lines_)} line(s), numbered"
            + (f"; unnumbered {bad[:3]}" if bad else "")
            + (f"; not ongoing {stray_ids}" if stray_ids else "")
        )

    for item in expected["mustNotAppear"]:
        found = [(w, t) for w, t in lines if any(k in t for k in item["keywords"])]
        ok &= not found
        print(f"  [{'PASS' if not found else 'FAIL'}] absent: {item['id']}（{item['why']}）")
        for where, text in found[:3]:
            print(f"      {where}: {text[:120]}")
    ids = re.findall(
        r"\b(s-\d{4}-[a-z]+|im-[a-z]+-\d{4}-\d{2}-\d{2})\b", "\n".join(t for _, t in lines)
    )
    print(
        f"  [info] session identifiers cited: {len(set(ids))} distinct "
        "(SOP: every finding names one)"
    )
    return ok


# ---------------- selftest ----------------

GOOD = """# 活动知识层

## 持续活动

### A001｜杭州半程马拉松备赛
- 现状：长距离 18 公里，离半马还有八周。
- 最近：2026-09-27
- 会话：`s-0907-run`、`s-0927-run`
- 原文（`s-0927-run`，2026-09-27 07:00）：“今天长距离 18 公里”

### A002｜日语 N3 备考
- 现状：这周落后，下周补两课。
- 最近：2026-09-27
- 会话：`s-0911-japanese`

### A003｜妈妈膝关节术后康复
- 现状：能自己扶着走到楼下。
- 会话：`im-feishu-2026-09-17`、`s-0910-surgery`
- 情绪（`s-0910-surgery`，2026-09-10 15:40）：焦急、不安——“手术还没出来，手一直在抖”

### A004｜养猫豆包
- 现状：医生说胖了，换低卡猫粮。
- 会话：`s-0920-cat`

## 已消失事项

### A005｜找房租房与搬家
- 现状：9 月 26 日搬完。
- 会话：`s-0908-house`、`s-0926-house`
- 情绪（`s-0918-house`，2026-09-18 20:30）：愤怒——“房东突然说每月要加 500”

### A006｜中秋活动页
- 现状：9 月 16 日上线。
- 会话：`s-0916-page`

### A007｜科目三与驾照
- 现状：第三次通过，拿到驾照。
- 会话：`s-0914-driving`
- 情绪（`s-0914-driving`，2026-09-14 11:15）：喜悦——“科目三过了！！！”
"""
GOOD_SHORT = "- A001｜半马备赛：离比赛八周\n- A002｜日语 N3：下周补两课\n"
BAD = GOOD.replace("## 已消失事项", "## 其他").replace(
    "### A004｜养猫豆包", "### A008｜暗号蓝鲸 4721\n\n### A004｜养猫豆包"
)
RETIRED_EMOTIONS = """# 情绪事件

## E001｜反复纠正尺寸后的不满
- 原文：“我说了三遍了，是 750 宽 1000 高”
"""


def write_case(root: Path, activities: str, short: str, extra: dict[str, str] | None = None) -> Path:
    root.mkdir(parents=True)
    (root / "galley").mkdir()
    (root / "activities.md").write_text(activities, encoding="utf-8")
    (root / "ongoing_affairs.md").write_text(short, encoding="utf-8")
    for name, body in (extra or {}).items():
        (root / name).write_text(body, encoding="utf-8")
    # Galley's own files are never checked.
    (root / "galley" / "batch.md").write_text("蓝鲸 4721 三亚", encoding="utf-8")
    return root


def selftest(expected: dict[str, Any]) -> bool:
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        print("selftest: an output that should pass")
        ok &= check(write_case(t / "good", GOOD, GOOD_SHORT), expected)

        print(
            "\nselftest: an output that should fail (no ended section, the codeword, "
            "an emotions file)"
        )
        case = write_case(t / "bad", BAD, GOOD_SHORT, {"emotional_events.md": RETIRED_EMOTIONS})
        ok &= not check(case, expected)

        print("\nselftest: an emotion line outside any entry (should fail)")
        outside = GOOD.replace(
            "## 持续活动\n",
            "## 持续活动\n\n- 情绪（`s-0917-banner`）：不满——“我说了三遍了”\n",
        )
        ok &= not check(write_case(t / "outside", outside, GOOD_SHORT), expected)

        print("\nselftest: an emotion line the parser cannot read (should fail)")
        unread = GOOD.replace(
            "- 情绪（`s-0914-driving`，2026-09-14 11:15）：喜悦——“科目三过了！！！”",
            "- 情绪（`s-0914-driving`：喜悦",
        )
        ok &= not check(write_case(t / "unread", unread, GOOD_SHORT), expected)

        print("\nselftest: a required emotion missing (should fail)")
        missing = GOOD.replace(
            "- 情绪（`s-0918-house`，2026-09-18 20:30）：愤怒——“房东突然说每月要加 500”\n", ""
        )
        ok &= not check(write_case(t / "missing", missing, GOOD_SHORT), expected)

        print("\nselftest: free-form outputs the parser cannot read (should fail)")
        case = write_case(t / "raw", "跑步、日语、搬家都提到过，很焦虑。\n", GOOD_SHORT)
        ok &= not check(case, expected)
    print(f"\nselftest {'passed' if ok else 'FAILED'}")
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("command", choices=["prepare-only", "run", "check", "selftest"])
    parser.add_argument(
        "--workdir", help="work directory (default: a fresh temp dir; check needs it)"
    )
    parser.add_argument(
        "--step-days", type=int, default=7, help="days between runs (default 7: three runs)"
    )
    parser.add_argument(
        "--ga-python", default="python3", help="interpreter with the engine's dependencies"
    )
    parser.add_argument("--mykey", help="GenericAgent mykey.py with the model to use (run only)")
    parser.add_argument("--llm-no", type=int, default=0, help="model index in that mykey.py")
    parser.add_argument("--timeout", type=int, default=3600, help="seconds per model run")
    args = parser.parse_args()
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))

    if args.command == "selftest":
        sys.exit(0 if selftest(expected) else 1)
    if args.command == "check":
        if not args.workdir:
            fail("check needs --workdir")
        workdir = Path(args.workdir).resolve()
        guard(workdir)
        ok = check(insight_dir(workdir), expected)
        sys.exit(0 if ok else 1)
    if args.command == "run" and not args.mykey:
        fail("run needs --mykey (a GenericAgent mykey.py)")
    workdir = run_steps(args, with_model=args.command == "run", expected=expected)
    ok = check_batches(workdir, expected)
    if args.command == "run":
        ok &= check(insight_dir(workdir), expected)
    print(f"\n{'all checks passed' if ok else 'some checks FAILED'}; work directory: {workdir}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
