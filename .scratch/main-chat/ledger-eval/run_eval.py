#!/usr/bin/env python3
"""Affairs-ledger eval (ticket 01, 「合成语料与验收」). See README.md.

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
                is recorded with `fail` (the position stays). Then `check`.
  check         Compare <state root>/memory/history_insight/ (minus galley/)
                with expected.json: keyword and section checks, no LLM
                grading.
  selftest      No model. Runs the checker on two hand-written outputs (one
                that should pass, one that should fail).
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
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CORPUS = HERE / "corpus.json"
EXPECTED = HERE / "expected.json"

# Region words in headings, file names and JSON keys / values.
REGION_WORDS = {
    "ongoing": ("持续", "进行中", "仍在", "ongoing", "active", "current", "continuing"),
    "ended": (
        "已消失",
        "消失",
        "已结束",
        "结束",
        "ended",
        "gone",
        "past",
        "inactive",
        "disappeared",
        "dissolved",
        "finished",
        "completed",
    ),
    "emotional": ("情绪", "emotion", "mood"),
}
OPPOSITE = {"ongoing": "ended", "ended": "ongoing"}


def fail(msg: str) -> None:
    print(f"run_eval: {msg}", file=sys.stderr)
    sys.exit(2)


def guard(workdir: Path) -> None:
    shown = str(workdir.resolve())
    if "app.galley" in shown or "Application Support" in shown:
        fail(f"refusing work directory {shown}: it looks like real Galley data")


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


def core(workdir: Path, *args: str) -> dict[str, Any]:
    cmd = [
        "cargo",
        "run",
        "--quiet",
        "--manifest-path",
        str(REPO / "core" / "Cargo.toml"),
        "-p",
        "galley-core",
        "--example",
        "ledger_eval_prepare",
        "--",
        "--corpus",
        str(CORPUS),
        "--workdir",
        str(workdir),
        *args,
    ]
    done = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if done.returncode != 0:
        fail(f"{' '.join(args)} failed:\n{done.stderr}")
    result: dict[str, Any] = json.loads(done.stdout.strip().splitlines()[-1])
    return result


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


def run_steps(args: argparse.Namespace, with_model: bool) -> Path:
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


@dataclass
class Line:
    text: str
    regions: set[str] = field(default_factory=set)
    where: str = ""


def regions_of(name: str) -> set[str]:
    low = name.lower()
    return {r for r, words in REGION_WORDS.items() if any(w in low for w in words)}


def markdown_lines(text: str, base: set[str], where: str) -> list[Line]:
    out = []
    current = set(base)
    for raw in text.splitlines():
        stripped = raw.strip()
        heading = (
            re.match(r"^#{1,6}\s+(.*)$", stripped)
            or re.match(r"^\*\*(.+)\*\*$", stripped)
            or re.match(r"^【(.+)】$", stripped)
        )
        if heading:
            found = regions_of(heading.group(1))
            if found:
                current = found
        if stripped:
            out.append(Line(stripped, set(current), where))
    return out


def json_lines(value: Any, regions: set[str], path: str, where: str) -> list[Line]:
    out: list[Line] = []
    if isinstance(value, dict):
        here = set(regions)
        for key in ("status", "category", "type", "kind", "分类", "状态", "类型", "state"):
            v = value.get(key)
            if isinstance(v, str) and regions_of(v):
                here = regions_of(v)
        for k, v in value.items():
            child = regions_of(str(k)) or here
            out += json_lines(v, child, f"{path}.{k}", where)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            out += json_lines(v, regions, f"{path}[{i}]", where)
    elif value is not None:
        out.append(Line(f"{path}: {value}", set(regions), where))
    return out


def output_lines(insight: Path) -> list[Line]:
    lines: list[Line] = []
    for path in sorted(insight.rglob("*")):
        if not path.is_file() or "galley" in path.relative_to(insight).parts:
            continue
        rel = str(path.relative_to(insight))
        base = regions_of(rel)
        text = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix == ".json":
            try:
                lines += json_lines(json.loads(text), base, "", rel)
                continue
            except json.JSONDecodeError:
                pass
        if path.suffix == ".jsonl":
            for n, row in enumerate(text.splitlines()):
                try:
                    lines += json_lines(json.loads(row), base, f"[{n}]", rel)
                except json.JSONDecodeError:
                    lines += markdown_lines(row, base, rel)
            continue
        lines += markdown_lines(text, base, rel)
    return lines


def check(insight: Path, expected: dict[str, Any]) -> bool:
    lines = output_lines(insight)
    if not lines:
        print(f"[FAIL] no outputs under {insight}")
        return False
    ok = True
    print(f"\noutput checks over {len({ln.where for ln in lines})} file(s) in {insight}:")

    def regions_hit(keywords: list[str]) -> set[str]:
        return {r for ln in lines if any(k in ln.text for k in keywords) for r in ln.regions}

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
    for item in expected["emotional"]:
        felt = "emotional" in regions_hit(item["keywords"])
        ok &= felt
        print(f"  [{'PASS' if felt else 'FAIL'}] emotional: {item['label']}")
    for item in expected["mustNotAppear"]:
        found = [(ln.where, ln.text) for ln in lines if any(k in ln.text for k in item["keywords"])]
        ok &= not found
        print(f"  [{'PASS' if not found else 'FAIL'}] absent: {item['id']}（{item['why']}）")
        for where, text in found[:3]:
            print(f"      {where}: {text[:120]}")
    ids = re.findall(
        r"\b(s-\d{4}-[a-z]+|im-[a-z]+-\d{4}-\d{2}-\d{2})\b", "\n".join(ln.text for ln in lines)
    )
    print(
        f"  [info] session identifiers cited: {len(set(ids))} distinct "
        "(SOP: every finding names one)"
    )
    return ok


# ---------------- selftest ----------------

GOOD = """# 活动知识层

## 持续活动
### 半马训练
- 会话：s-0907-run、s-0927-run；原文：「今天长距离 18 公里」
### 日语 N3 备考
- 会话：s-0911-japanese
### 妈妈膝关节术后康复
- 会话：im-feishu-2026-09-17
### 养猫豆包
- 会话：s-0920-cat

## 已消失事项
### 找房租房
- 会话：s-0908-house、s-0926-house（已搬家）
### 中秋活动页
- 会话：s-0916-page（已上线）
### 科目三 / 驾照
- 会话：s-0914-driving
"""
GOOD_EMOTIONS = [
    {"session": "s-0910-surgery", "type": "情绪事件", "quote": "手术还没出来，手一直在抖"},
    {"session": "s-0914-driving", "type": "情绪事件", "quote": "科目三过了！！！"},
    {"session": "s-0917-banner", "type": "情绪事件", "quote": "我说了三遍了，是 750 宽 1000 高"},
    {"session": "s-0918-house", "type": "情绪事件", "quote": "房东突然说每月要加 500"},
]
BAD = GOOD.replace("## 已消失事项", "## 其他").replace(
    "### 养猫豆包", "### 暗号蓝鲸 4721\n### 养猫豆包"
)


def selftest(expected: dict[str, Any]) -> bool:
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        good = Path(tmp) / "good"
        (good / "galley").mkdir(parents=True)
        (good / "activities.md").write_text(GOOD, encoding="utf-8")
        (good / "emotions.json").write_text(
            json.dumps({"情绪事件": GOOD_EMOTIONS}, ensure_ascii=False), encoding="utf-8"
        )
        # Galley's own files are never checked.
        (good / "galley" / "batch.md").write_text("蓝鲸 4721 三亚", encoding="utf-8")
        print("selftest: an output that should pass")
        ok &= check(good, expected)
        bad = Path(tmp) / "bad"
        bad.mkdir()
        (bad / "activities.md").write_text(BAD, encoding="utf-8")
        print(
            "\nselftest: an output that should fail (no ended section, the codeword, no emotions)"
        )
        ok &= not check(bad, expected)
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
        ok = check(workdir / "managed-ga-state" / "memory" / "history_insight", expected)
        sys.exit(0 if ok else 1)
    if args.command == "run" and not args.mykey:
        fail("run needs --mykey (a GenericAgent mykey.py)")
    workdir = run_steps(args, with_model=args.command == "run")
    ok = check_batches(workdir, expected)
    if args.command == "run":
        ok &= check(workdir / "managed-ga-state" / "memory" / "history_insight", expected)
    print(f"\n{'all checks passed' if ok else 'some checks FAILED'}; work directory: {workdir}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
