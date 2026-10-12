#!/usr/bin/env python3
"""Affairs-ledger eval (tickets 01 and 04, 「合成语料与验收」). See README.md.

Everything runs in a throwaway work directory (a fresh temp dir unless
--workdir is given): its own workbench.db and its own managed state root.
The real Galley data directory is never read or written.

Commands:

  prepare-only  No model. Builds the DB and state root from corpus.json and
                runs Core's batch preparation (core/examples/
                ledger_eval_prepare.rs, i.e. ledger::run::begin) at every
                step, committing each step as if the run had succeeded.
                Saves each batch under <workdir>/steps/ and checks the
                prep-stage expectations (CLI / supervisor / excluded /
                assistant / before-since content absent from every batch).
  run           Needs a real model (manual, like `pytest -m e2e`). Same
                steps, but between prepare and commit the bundled engine
                (managed-ga/code/agentmain.py --func) executes the mining
                task against the work directory's state root; a failed run
                is recorded with `fail` (the position stays). After every
                successful step the outputs go through the Memory page's
                parser (core/examples/ledger_parse.rs). Before the step
                expected.json's "forget" names, one ongoing entry is deleted
                with the page's own delete; later steps must not rebuild
                it. Then `check`.
  check         Compare <state root>/memory/history_insight/ with
                expected.json through the parser's structure: which entries
                are ongoing / ended / emotional, whether every file was
                read whole, and whether a deleted entry came back. Keyword
                checks only, no LLM grading.
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
    for name in ("activities.md", "emotional_events.md", "ongoing_affairs.md"):
        if (insight / name).exists():
            shutil.copy(insight / name, out / name)
    parsed = parse_outputs(insight)
    (step_dir / "parsed.json").write_text(
        json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("  parsed: " + parse_summary(parsed))
    return parsed


def parse_summary(parsed: dict[str, Any]) -> str:
    a, e = parsed["activities"], parsed["emotions"]
    parts = []
    if a["kind"] == "parsed":
        parts.append(
            f"activities {len(a['ongoing'])} ongoing / {len(a['ended'])} ended, "
            f"other {len(a.get('other') or '')} chars"
        )
    else:
        parts.append(f"activities {a['kind']}")
    if e["kind"] == "parsed":
        parts.append(f"emotions {len(e['entries'])}, other {len(e.get('other') or '')} chars")
    else:
        parts.append(f"emotions {e['kind']}")
    return "; ".join(parts)


def entry_text(entry: dict[str, Any]) -> str:
    parts = [entry.get("title", ""), entry.get("status") or "", entry.get("at") or ""]
    parts += entry.get("sessions", []) + entry.get("tags", []) + entry.get("extra", [])
    parts += [q.get("text", "") for q in entry.get("quotes", [])]
    return "\n".join(parts)


def forget_before(workdir: Path, expected: dict[str, Any]) -> None:
    """Delete the ongoing entry expected.json's "forget" names, with the
    page's own delete (production code), and remember what was deleted."""
    item_id = expected["forget"]["item"]
    item = next(i for i in expected["ongoing"] if i["id"] == item_id)
    parsed = parse_outputs(insight_dir(workdir))
    acts = parsed["activities"]
    candidates = (
        [e for e in acts["ongoing"] if any(k in e["title"] for k in item["keywords"])]
        if acts["kind"] == "parsed"
        else []
    )
    if not candidates:
        print(f"  [WARN] forget: no ongoing entry titled with {item['keywords']}; skipped")
        return
    target = candidates[0]
    result = core(workdir, "delete", "--id", target["id"])
    print(f"  forget: deleted {target['id']}｜{target['title']} ({result['status']})")
    (workdir / "deleted.json").write_text(
        json.dumps(
            {"id": target["id"], "title": target["title"], "item": item_id},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


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
    forget_step = expected.get("forget", {}).get("beforeStep")
    print(f"work directory: {workdir}")
    for i, now in enumerate(steps(corpus, args.step_days), start=1):
        step_dir = workdir / "steps" / f"{i:02d}"
        step_dir.mkdir(parents=True, exist_ok=True)
        if with_model and i == forget_step and not args.no_forget:
            forget_before(workdir, expected)
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


def check(
    insight: Path,
    expected: dict[str, Any],
    deleted: dict[str, Any] | None = None,
    parsed: dict[str, Any] | None = None,
) -> bool:
    lines = raw_lines(insight)
    if not lines:
        print(f"[FAIL] no outputs under {insight}")
        return False
    parsed = parsed if parsed is not None else parse_outputs(insight)
    ok = True
    print(f"\noutput checks over {len({w for w, _ in lines})} file(s) in {insight}:")

    # Read whole: both files parsed, little or nothing left over.
    for name in ("activities", "emotions"):
        doc = parsed[name]
        if doc["kind"] != "parsed":
            ok = False
            print(f"  [FAIL] {name}: {doc['kind']} (the parser recognised no entry)")
            continue
        other = doc.get("other") or ""
        status = "PASS" if not other else ("WARN" if len(other) < 400 else "FAIL")
        ok &= status != "FAIL"
        print(f"  [{status}] {name}: read whole" + (f", other {len(other)} chars" if other else ""))
        for line in [ln for ln in other.splitlines() if ln.strip()][:5]:
            print(f"      other: {line[:120]}")
    acts = parsed["activities"] if parsed["activities"]["kind"] == "parsed" else None
    emos = parsed["emotions"] if parsed["emotions"]["kind"] == "parsed" else None
    regions: dict[str, list[dict[str, Any]]] = {
        "ongoing": acts["ongoing"] if acts else [],
        "ended": acts["ended"] if acts else [],
        "emotional": emos["entries"] if emos else [],
    }

    def regions_hit(keywords: list[str]) -> set[str]:
        return {
            region
            for region, entries in regions.items()
            if region != "emotional"
            for e in entries
            if any(k in entry_text(e) for k in keywords)
        }

    forgotten_item = deleted["item"] if deleted else None
    for kind in ("ongoing", "ended"):
        for item in expected[kind]:
            if item["id"] == forgotten_item:
                continue
            hit = regions_hit(item["keywords"])
            if kind not in hit:
                status = "FAIL"
                ok = False
            elif OPPOSITE[kind] in hit:
                status = "WARN"
            else:
                status = "PASS"
            print(f"  [{status}] {kind}: {item['label']}  (sections hit: {sorted(hit) or '-'})")
    for item in expected["emotional"]:
        felt = any(
            any(k in entry_text(e) for k in item["keywords"]) for e in regions["emotional"]
        )
        ok &= felt
        print(f"  [{'PASS' if felt else 'FAIL'}] emotional: {item['label']}")

    # A deleted entry stays deleted: not under its id, not as another entry
    # titled with the same thing.
    if deleted:
        item = next(i for i in expected["ongoing"] if i["id"] == deleted["item"])
        all_entries = regions["ongoing"] + regions["ended"] + regions["emotional"]
        same_id = [e for e in all_entries if e["id"] == deleted["id"]]
        retitled = [e for e in all_entries if any(k in e["title"] for k in item["keywords"])]
        rebuilt = same_id + [e for e in retitled if e not in same_id]
        ok &= not rebuilt
        print(
            f"  [{'PASS' if not rebuilt else 'FAIL'}] deleted stays deleted: "
            f"{deleted['id']}｜{deleted['title']}"
        )
        for e in rebuilt:
            print(f"      rebuilt as {e['id']}｜{e['title']}")
        listed = any(f["id"] == deleted["id"] for f in parsed.get("forgotten", []))
        ok &= listed
        print(f"  [{'PASS' if listed else 'FAIL'}] deleted is on the do-not-record list")
        mentions = [
            e["id"]
            for e in all_entries
            if e not in rebuilt and any(k in entry_text(e) for k in item["keywords"])
        ]
        if mentions:
            print(f"  [info] other entries still mention it (review by hand): {mentions}")
        short = parsed.get("affairsRaw") or ""
        in_short = deleted["id"] in short or any(k in short for k in item["keywords"])
        ok &= not in_short
        print(f"  [{'PASS' if not in_short else 'FAIL'}] deleted is not in the short list")

    # The short list: numbered lines of ongoing entries.
    short = parsed.get("affairsRaw")
    if short is not None:
        ongoing_ids = {e["id"] for e in regions["ongoing"]}
        lines_ = [ln.strip() for ln in short.splitlines() if ln.strip()]
        numbered = [re.match(r"^- (A\d+)｜", ln) for ln in lines_]
        bad = [ln for ln, m in zip(lines_, numbered) if not m]
        stray = [m.group(1) for m in numbered if m and m.group(1) not in ongoing_ids]
        status = "PASS" if not bad and not stray else "WARN"
        print(
            f"  [{status}] short list: {len(lines_)} line(s), numbered"
            + (f"; unnumbered {bad[:3]}" if bad else "")
            + (f"; not ongoing {stray}" if stray else "")
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


def load_deleted(workdir: Path) -> dict[str, Any] | None:
    path = workdir / "deleted.json"
    if not path.exists():
        return None
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


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
- 会话：`im-feishu-2026-09-17`

### A004｜养猫豆包
- 现状：医生说胖了，换低卡猫粮。
- 会话：`s-0920-cat`

## 已消失事项

### A005｜找房租房与搬家
- 现状：9 月 26 日搬完。
- 会话：`s-0908-house`、`s-0926-house`

### A006｜中秋活动页
- 现状：9 月 16 日上线。
- 会话：`s-0916-page`

### A007｜科目三与驾照
- 现状：第三次通过，拿到驾照。
- 会话：`s-0914-driving`
"""
GOOD_EMOTIONS = """# 情绪事件

## E001｜等手术时的焦急
- 时间：2026-09-10 15:40
- 会话：`s-0910-surgery`
- 原文：“手术还没出来，手一直在抖”

## E002｜科目三通过的惊喜
- 会话：`s-0914-driving`
- 原文：“科目三过了！！！”

## E003｜反复纠正尺寸后的不满
- 会话：`s-0917-banner`
- 原文：“我说了三遍了，是 750 宽 1000 高”

## E004｜房东加价的气愤
- 会话：`s-0918-house`
- 原文：“房东突然说每月要加 500”
"""
GOOD_SHORT = "- A001｜半马备赛：离比赛八周\n- A002｜日语 N3：下周补两课\n"
BAD = GOOD.replace("## 已消失事项", "## 其他").replace(
    "### A004｜养猫豆包", "### A008｜暗号蓝鲸 4721\n\n### A004｜养猫豆包"
)
DELETED = {"id": "A002", "title": "日语 N3 备考", "item": "japanese-n3"}
FORGOTTEN = [
    {"id": "A002", "kind": "activity", "title": "日语 N3 备考", "deletedAt": "2026-09-14T00:00:00Z"}
]


def write_case(
    root: Path, activities: str, emotions: str | None, short: str, forgotten: list[Any]
) -> Path:
    root.mkdir(parents=True)
    (root / "galley").mkdir()
    (root / "activities.md").write_text(activities, encoding="utf-8")
    if emotions is not None:
        (root / "emotional_events.md").write_text(emotions, encoding="utf-8")
    (root / "ongoing_affairs.md").write_text(short, encoding="utf-8")
    if forgotten:
        (root / "galley" / "forgotten.json").write_text(
            json.dumps(forgotten, ensure_ascii=False), encoding="utf-8"
        )
    # Galley's own files are never checked.
    (root / "galley" / "batch.md").write_text("蓝鲸 4721 三亚", encoding="utf-8")
    return root


def selftest(expected: dict[str, Any]) -> bool:
    ok = True
    without_japanese = GOOD.replace(
        GOOD[GOOD.index("### A002") : GOOD.index("### A003")], ""
    )
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        print("selftest: an output that should pass")
        ok &= check(write_case(t / "good", GOOD, GOOD_EMOTIONS, GOOD_SHORT, []), expected)

        print("\nselftest: a deleted entry that stayed deleted (should pass)")
        case = write_case(
            t / "forgot",
            without_japanese,
            GOOD_EMOTIONS,
            "- A001｜半马备赛：离比赛八周\n",
            FORGOTTEN,
        )
        ok &= check(case, expected, DELETED)

        print(
            "\nselftest: an output that should fail (no ended section, the codeword, "
            "no emotions file)"
        )
        ok &= not check(write_case(t / "bad", BAD, None, GOOD_SHORT, []), expected)

        print("\nselftest: a deleted entry rebuilt under a new number (should fail)")
        rebuilt = without_japanese.replace(
            "### A003｜", "### A009｜日语 N3 考试准备\n- 现状：补两课\n\n### A003｜"
        )
        case = write_case(t / "rebuilt", rebuilt, GOOD_EMOTIONS, GOOD_SHORT, FORGOTTEN)
        ok &= not check(case, expected, DELETED)

        print("\nselftest: free-form outputs the parser cannot read (should fail)")
        case = write_case(
            t / "raw", "跑步、日语、搬家都提到过。\n", "很焦虑。\n", GOOD_SHORT, []
        )
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
    parser.add_argument(
        "--no-forget", action="store_true", help="skip the delete step (run only)"
    )
    args = parser.parse_args()
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))

    if args.command == "selftest":
        sys.exit(0 if selftest(expected) else 1)
    if args.command == "check":
        if not args.workdir:
            fail("check needs --workdir")
        workdir = Path(args.workdir).resolve()
        guard(workdir)
        ok = check(insight_dir(workdir), expected, load_deleted(workdir))
        sys.exit(0 if ok else 1)
    if args.command == "run" and not args.mykey:
        fail("run needs --mykey (a GenericAgent mykey.py)")
    workdir = run_steps(args, with_model=args.command == "run", expected=expected)
    ok = check_batches(workdir, expected)
    if args.command == "run":
        ok &= check(insight_dir(workdir), expected, load_deleted(workdir))
    print(f"\n{'all checks passed' if ok else 'some checks FAILED'}; work directory: {workdir}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
