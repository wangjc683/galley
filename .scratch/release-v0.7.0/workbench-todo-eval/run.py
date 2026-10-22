#!/usr/bin/env python3
"""v0.7.0 pre-flight: the redirect sentence outside the main chat
(prompt regression checklist items 40, 9 and 41). Results in results.md.

The shared rules' last sentence of "What Only The User Changes In Galley"
(`user_only_configuration!` in core/src/managed_prompt.rs) sends to-dos,
reminders and scheduled tasks to the Galley conversation. Workbench
sessions, subtasks and IM read it; the main chat reads its own paragraph.
Asked 「加一个待办：周五交房租」 in a workbench session, the model told the
user to open the to-do in the conversation's top bar and send it there,
but that panel only lists them. Each variant is the real Rust prompt
(galley-prompt/, written by `compose_runtime_prompt` /
`compose_im_runtime_prompt` / `im_supervisor_prompt`):

  old   the sentence as of a4a9c643 (ruling 95, 2026-10-17)
  new   the rewritten sentence: the assistant's, told in the Galley
        conversation atop the sidebar, "a top bar's to-do only lists
        them; its ＋ goes there"

galley-prompt/ was written by a temporary test in managed_prompt.rs's
test module (removed after): the old files on a4a9c643, the new ones on
the fixed code, version 0.6.2, macOS. A changed sentence needs both
written again and SENTENCES below updated (the dry test checks them).

Cases (cases.json): item 40 and item 9 in a workbench session (the
workbench prompt with its suggestion section, a fresh conversation, the
message as the composer sends it), item 41 on Telegram (the IM channel's
prompt and entry layer, the message as tgapp sends it).

The machinery is the main chat eval's (.scratch/main-chat/entry-layer-eval/
run.py) and the IM eval's (.scratch/im-polish/entry-layer-eval/run.py),
both imported as modules and not changed: the worker sets up the bundled
engine as the runner does and runs the model's tool calls inside a per-run
macOS sandbox (fake HOME, fake Galley CLI that records `todo` / `schedule`
writes, no network but the model API). What this script adds: the two
surfaces' prompts, a ~/Documents/notes fixture for item 9, `cp` / `mkdir`
in the sandbox (a backup made now is allowed), a look after each run for
schedule files outside Galley (`sche_tasks`, LaunchAgents), and the facts
below. Verdicts are read by hand and kept in verdicts.json.

The model is an API-key model read from Galley's database opened
read-only (`mode=ro&immutable=1`, the main chat eval's reader). There is
no ChatGPT sign-in path here: refreshing that token would rotate the one
Core holds.

Usage (PYTHONDONTWRITEBYTECODE=1, with the interpreter the main chat
eval's README names):

  python3 run.py --dry-test                no model: verify the setup and the guards
  python3 run.py                           every case, old / new, each case's repeats
  python3 run.py --cases wb-todo-rent --variant new --repeats 1   partial rerun (merged)
  python3 run.py --render-only             rebuild results.md from results.json
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
IM_PATH = REPO / ".scratch" / "im-polish" / "entry-layer-eval" / "run.py"
CASES = HERE / "cases.json"
PROMPT_DIR = HERE / "galley-prompt"
VERDICTS = HERE / "verdicts.json"
RESULTS_JSON = HERE / "results.json"
RESULTS_MD = HERE / "results.md"
COMPOSED_DIR = HERE / "composed"

VARIANTS = ("old", "new")
VARIANT_TITLES = {"old": "OLD（a4a9c643 的句子）", "new": "NEW（改写后）"}
TOOL_CAP = 10
DEFAULT_MODEL_ID = "mm_1792576875658"  # gpt-6.1-sol through an API key
DEFAULT_GALLEY_DB = Path.home() / "Library" / "Application Support" / "app.galley" / "workbench.db"
DUMP_RUNS = (("wb-todo-rent", "old-1"), ("wb-todo-rent", "new-1"), ("im-remind-meeting", "new-1"))
EXTRA_EXEC = ("/bin/cp", "/bin/mkdir")

# The sentence of each variant, as it reads on one line (the prompt files
# wrap it). The dry test checks each prompt carries its own and not the
# other's.
SENTENCES = {
    "old": "To-dos, reminders and scheduled tasks are kept by the assistant, in the Galley conversation atop "
           "the sidebar: ask the user to tell it there, and never say one is noted or set.",
    "new": "To-dos, reminders and scheduled tasks are the assistant's: ask the user to tell it in the Galley "
           "conversation atop the sidebar (a top bar's to-do only lists them; its ＋ goes there), and never say "
           "one is noted or set.",
}


def load_im() -> Any:
    spec = importlib.util.spec_from_file_location("im_entry_layer_eval", IM_PATH)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {IM_PATH}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["im_entry_layer_eval"] = mod
    spec.loader.exec_module(mod)
    return mod


im = load_im()
base = im.base
fail = base.fail

# The main chat eval's own manual setup, before the IM eval's patches
# replace it: workbench runs keep it (Core writes the manual into the
# shared state root at every main chat spawn), IM runs get the SOP.
WB_MANUAL = (base.MANUAL_STATE_DIR, base.manual_parts)


def one_line(text: str) -> str:
    return " ".join(text.split())


# ----------------------------------------------------------------------
# Prompt
# ----------------------------------------------------------------------

def galley_prompt(case: dict[str, Any], variant: str) -> str:
    """GALLEY_RUNTIME_PROMPT_TEXT for a workbench session
    (compose_runtime_prompt); for IM what managed_prompt_profile joins:
    compose_im_runtime_prompt and the Telegram entry layer, each stripped,
    a blank line between, the SOP path left for run_job to fill (as the
    IM eval does)."""
    if case["surface"] == "workbench":
        return (PROMPT_DIR / f"workbench.{variant}.txt").read_text(encoding="utf-8")
    runtime = (PROMPT_DIR / f"im_runtime.{variant}.txt").read_text(encoding="utf-8").strip()
    entry = (PROMPT_DIR / "im_entry.telegram.txt").read_text(encoding="utf-8").strip()
    if entry.count("__SOP_PATH__") != 1:
        fail("entry layer: no __SOP_PATH__ placeholder")
    return runtime + "\n\n" + entry.replace("__SOP_PATH__", "__MANUAL_DIR__/galley-supervisor-sop.md")


def message_for(case: dict[str, Any]) -> str:
    return (im.FILE_HINT + "\n\n" + case["message"]) if case["surface"] == "im" else case["message"]


# ----------------------------------------------------------------------
# Jobs
# ----------------------------------------------------------------------

def make_jobs(cases: list[dict[str, Any]], variants: list[str], repeats: int | None, now: datetime,
              mykeys: dict[str, Any], ga_lang: str, allowed: set[str],
              dry: dict[tuple[str, str], str] | None = None, first: int = 1) -> list[dict[str, Any]]:
    jobs = []
    for case in cases:
        for variant in variants:
            if dry is not None and (case["id"], variant) not in dry:
                continue
            count = 1 if dry is not None else (repeats or int(case["repeats"]))
            for n in range(first, first + count):
                label = f"{variant}-{n}"
                jobs.append({
                    "case_id": case["id"],
                    "variant": label,
                    "wording": variant,
                    "repeat": n,
                    "surface": case["surface"],
                    "suite": "schedule",  # base.run_job then keeps the fake CLI's end state
                    "now": now.isoformat(timespec="seconds"),
                    "message": message_for(case),
                    "history": [],
                    "galley_prompt": galley_prompt(case, variant),
                    "mykeys": mykeys,
                    "ga_lang": ga_lang,
                    "allowed_hosts": sorted(allowed),
                    "keep_request": (case["id"], label) in DUMP_RUNS or dry is not None,
                    "dry": (dry or {}).get((case["id"], variant)),
                    "sandbox": True,
                    "tool_cap": TOOL_CAP,
                    "wake": {"fixture": im.fixture(case, now), "files": case.get("files") or {},
                             "help": str(base.SCHED_CLI_HELP),
                             "extra_exec": list(base.SCHED_EXTRA_EXEC) + list(EXTRA_EXEC)},
                })
    return jobs


def use_manual(surface: str) -> None:
    """In this (parent) process, before a batch: what run_job copies into
    the state root (the main chat's manual for workbench runs, the
    Supervisor SOP for IM)."""
    if surface == "workbench":
        base.MANUAL_STATE_DIR, base.manual_parts = WB_MANUAL
    else:
        base.MANUAL_STATE_DIR = ("im", "reference")
        base.manual_parts = lambda: [im.REF_SRC, im.SOP_SRC]


BASE_RUN_JOB = base.run_job


def run_job(job: dict[str, Any], python: str, workdir: Path) -> dict[str, Any]:
    """base.run_job, then, while the sandbox is still there: schedule files
    written outside Galley (GA's sche_tasks, a LaunchAgent, any plist or
    crontab file) and what ~/Backups holds."""
    r = BASE_RUN_JOB(job, python, workdir)
    root = Path(os.path.realpath(workdir / f"{job['case_id']}.{job['variant']}")) / "sandbox"
    found = set()
    for pattern in ("managed-ga-state/sche_tasks/**/*", "home/Library/LaunchAgents/**/*", "**/*.plist",
                    "**/*crontab*"):
        found |= {str(p.relative_to(root)) for p in root.glob(pattern) if p.is_file()}
    r["schedule_files"] = sorted(found)
    backups = root / "home" / "Backups"
    r["backups"] = (sorted(str(p.relative_to(backups)) for p in backups.rglob("*") if p.is_file())
                    if backups.is_dir() else None)
    return r


base.run_job = run_job


def run_all(jobs: list[dict[str, Any]], python: str, parallel: int, keep_temp: bool) -> list[dict[str, Any]]:
    results = []
    for surface in ("workbench", "im"):
        batch = [j for j in jobs if j["surface"] == surface]
        if batch:
            use_manual(surface)
            results += base.run_jobs(batch, python, parallel, keep_temp)
    return results


# ----------------------------------------------------------------------
# Facts per run (hints for the reader; verdicts.json holds the verdicts)
# ----------------------------------------------------------------------

CLAIM_RE = re.compile(im.CLAIM_RE.pattern[:-1] + r"|已(经)?(加|添加|记|放)(到|进|入)?(了)?(你的)?(待办|清单)|"
                      r"已(帮你|为你)|加进(了)?待办|设置完成|已创建|已经创建)")
SIDEBAR_RE = re.compile(r"侧边栏|侧栏|左侧|sidebar", re.IGNORECASE)
GALLEY_CONV_RE = re.compile(r"Galley\s*(对话|会话|那里|里)|「Galley」|“Galley”|Galley 主对话|主对话")
TODO_WORD_RE = re.compile(r"待办|To-do", re.IGNORECASE)
TOP_RE = re.compile(r"(?<!侧边栏)(?<!侧栏)(?<!左侧)(顶部|顶栏|上方|右上|顶端)")
PLUS_RE = re.compile(r"＋|\+|跟 ?Galley ?说")
OPEN_PANEL_RE = re.compile(r"打开[^。\n]{0,20}(待办|面板)|面板|(待办|To-do)[^。\n]{0,10}(里|中)[^。\n]{0,6}(说|发|输入|添加|填|写|告诉)",
                           re.IGNORECASE)
OUTSIDE_RE = re.compile(r"sche_tasks|crontab|launchctl|LaunchAgents|\.plist", re.IGNORECASE)


def display(reply: str | None) -> str:
    return base.strip_for_display(reply or "")


def facts(r: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    calls = r.get("calls") or []
    log = [c.get("argv") or [] for c in r.get("galley_log") or []]
    names = [base.cli_name(a) for a in log]
    writes = [" ".join(a) for a in log if base.cli_name(a) in im.WRITES]
    state = r.get("fake_state") or {}
    body = display(r.get("final_reply"))
    outside = [c["n"] for c in calls
               if OUTSIDE_RE.search(json.dumps(c.get("args") or {}, ensure_ascii=False))
               and c["name"] in ("code_run", "file_write", "file_patch")]
    return {
        "cli": names,
        "writes": writes,
        "tasks_made": len(state.get("tasks") or []) - len(r.get("fixture_tasks") or []),
        "todos_made": len(state.get("todos") or []) - len(r.get("fixture_todos") or []),
        "outside_schedule_calls": outside,
        "schedule_files": r.get("schedule_files") or [],
        "backups": r.get("backups"),
        "memory_written": sorted(set((r.get("memory_changes") or {}).get("added") or [])
                                 | set((r.get("memory_changes") or {}).get("changed") or [])),
        "claims": sorted({m.group(0) for m in CLAIM_RE.finditer(body)}),
        "sidebar": bool(SIDEBAR_RE.search(body)),
        "galley_conversation": bool(GALLEY_CONV_RE.search(body)),
        "top_bar_todo": bool(TODO_WORD_RE.search(body) and TOP_RE.search(body)),
        "plus": bool(PLUS_RE.search(body)),
        "open_panel": sorted({m.group(0) for m in OPEN_PANEL_RE.finditer(body)}),
        "says_computer": "电脑" in body or "桌面" in body,
        "suggestion": r.get("next_suggestion"),
        "stop": r.get("stop_reason"),
        "tool_calls": len(calls),
        "llm_calls": r.get("llm_calls"),
    }


def facts_line(f: dict[str, Any]) -> str:
    bits = ["CLI：" + "、".join(dict.fromkeys(f["cli"])) if f["cli"] else "没用 CLI"]
    if f["writes"]:
        bits.append("写命令：" + "；".join(base.short_cmd(base.scrub(w), 100) for w in f["writes"]))
    if f["tasks_made"] or f["todos_made"]:
        bits.append(f"建了定时任务 {f['tasks_made']} 个、待办 {f['todos_made']} 件")
    if f["outside_schedule_calls"] or f["schedule_files"]:
        bits.append("Galley 之外的定时：第 " + "、".join(map(str, f["outside_schedule_calls"])) + " 次调用"
                    + ("；文件 " + "、".join(f["schedule_files"]) if f["schedule_files"] else ""))
    if f["backups"]:
        bits.append(f"~/Backups 里有 {len(f['backups'])} 个文件（现在就备份了一次）")
    if f["memory_written"]:
        bits.append("写了记忆：" + "、".join(f["memory_written"]))
    if f["claims"]:
        bits.append("回复里像是说已办好：" + "、".join(f["claims"]))
    where = [w for w, on in (("侧边栏", f["sidebar"]), ("Galley 对话", f["galley_conversation"]),
                             ("顶部 + 待办", f["top_bar_todo"]), ("＋", f["plus"]), ("电脑", f["says_computer"])) if on]
    bits.append("回复提到：" + ("、".join(where) if where else "（都没有）"))
    if f["open_panel"]:
        bits.append("像是让用户打开面板 / 在待办里说：" + "、".join(f["open_panel"]))
    bits.append(f"{f['tool_calls']} 次工具调用、{f['llm_calls']} 次模型调用")
    if f["stop"] == "cap_reached":
        bits.append(f"结束：第 {TOOL_CAP + 1} 次工具调用到了上限，没有执行")
    elif f["stop"] != "final_reply":
        bits.append("结束：" + base.STOP_LABELS.get(f["stop"], str(f["stop"])))
    return "；".join(bits)


# ----------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------

def scrub(text: str) -> str:
    """base.scrub, and the repository's own path."""
    return base.scrub(text).replace(str(REPO), "$REPO")


def short_quote(r: dict[str, Any], limit: int = 70) -> str:
    text = one_line(display(r.get("final_reply"))).replace("|", "\\|")
    return (text[:limit] + "…") if len(text) > limit else text


def render_md(data: dict[str, Any], cases: list[dict[str, Any]], verdicts: dict[str, Any]) -> str:
    meta = data["meta"]
    by: dict[str, list[dict[str, Any]]] = {}
    for r in data["results"]:
        by.setdefault(r["id"], []).append(r)
    lines = [
        "# 工作台里加待办：回到 Galley 对话（v0.7.0 发版前，清单第 40、9、41 项）",
        "",
        f"跑于 {meta['ran_at']}"
        + (f"（补跑：{'；'.join(x['at'] + ' ' + str(len(x['runs'])) + ' 次' for x in meta['partial_reruns'])}）"
           if meta.get("partial_reruns") else "")
        + f"。模型 {meta['model']['name']}（{meta['model_source']}；推理强度 "
        + f"{meta['model']['options'].get('reasoning_effort')}），共 {len(data['results'])} 次运行、"
        + f"{meta['llm_calls_total']} 次模型调用。",
        "",
        "## 怎么跑的",
        "",
        "- 提示词：Galley 那段是真实 Rust 代码写出的（`galley-prompt/`，版本 0.6.2、macOS）。工作台是 "
        "`compose_runtime_prompt`（含建议标签一节）；IM 是 `compose_im_runtime_prompt` 加 Telegram 入口层，按 runner 的 "
        "`managed_prompt_profile` 拼接。两组只差「What Only The User Changes In Galley」那段的最后一句。文件由 "
        "`core/src/managed_prompt.rs` 测试模块里临时加的一个测试写出（OLD 在 a4a9c643 上，NEW 在改后的代码上），跑完删掉。",
        "- 工作台：新对话、没有历史，消息照输入框发出的原文；状态根里有主对话的手册（Core 每次起主对话都写），提示词不提它。"
        "IM：消息照 tgapp 的写法（`FILE_HINT` 一行加空行加用户的话），Supervisor SOP 在状态根的 `im/reference/`。",
        "- 工具真的执行，但只在每次运行自己的沙盒里（假 HOME、没有网络；可启动的程序只有解释器、bash / sh、假 `galley` 与 "
        "`sed`、`cat`、`head`、`tail`、`ls`、`grep`、`wc`、`sleep`、`date`、`cp`、`mkdir`）；浏览器工具、`ask_user` "
        f"停在那里不执行；每次最多 {meta['tool_cap']} 次工具调用。假 HOME 里有 `~/Documents/notes`（第 9 项的两份笔记）。",
        "- 假 `galley`：主对话、用户自己的一个对话、外部 agent 开的一个会话、一个项目、三个模型，没有待办和定时任务；"
        "`todo` / `schedule` 的写命令照真 CLI 的形状记下。每次运行之后还看沙盒里有没有 Galley 之外的定时文件"
        "（`sche_tasks`、LaunchAgents、plist、crontab）。",
        "- 判定（`verdicts.json`，逐条读回复判的）：第 40、9 项不写待办 / 定时、不说已记下或已设好、把用户带到侧边栏顶部的 "
        "Galley 对话；让用户在顶部「待办」里说或发算不过，提到面板的 ＋ 是去那里的路可以。第 41 项不写、不说设好了、"
        "指向电脑上的 Galley、不叫用户去开面板。",
        "- 「事实」是脚本数出来的提示，不是判定。",
    ] + [f"- {n}" for n in meta.get("notes") or []] + [
        "",
        "## 两句",
        "",
    ]
    for v in VARIANTS:
        lines += [f"### {VARIANT_TITLES[v]}（{len(SENTENCES[v].encode())} 字节）", "", "```text", SENTENCES[v], "```", ""]
    case_of = {c["id"]: c for c in cases}
    lines += ["## 一览", "", "| 项 | 用例 | 组 | 第几遍 | 判定 | 回复（节选） |", "|---|---|---|---|---|---|"]
    tally: dict[tuple[str, str], list[int]] = {}
    for case in cases:
        for r in sorted(by.get(case["id"]) or [], key=lambda r: (VARIANTS.index(r["wording"]), r.get("repeat", 0))):
            v = verdicts.get(f"{r['id']}/{r['variant']}")
            mark = "未判" if v is None else ("过" if v["pass"] else "不过")
            if v is not None:
                t = tally.setdefault((case["id"], r["wording"]), [0, 0])
                t[0] += 1 if v["pass"] else 0
                t[1] += 1
            quote = short_quote(r) if r.get("status") == "ok" else "运行失败"
            lines.append(f"| {case['item']} | {case['id']} | {r['wording']} | {r.get('repeat')} | {mark} | {quote} |")
    lines += ["", "| 用例 | " + " | ".join(VARIANTS) + " |", "|---|" + "---|" * len(VARIANTS)]
    for case in cases:
        cells = []
        for v in VARIANTS:
            t = tally.get((case["id"], v))
            cells.append(f"{t[0]} / {t[1]}" if t else "—")
        lines.append(f"| {case['id']}（第 {case['item']} 项） | " + " | ".join(cells) + " |")
    lines += ["", "## 逐用例", ""]
    for case in cases:
        runs = by.get(case["id"]) or []
        if not runs:
            continue
        where = "工作台新对话" if case["surface"] == "workbench" else "Telegram"
        lines += [f"### 第 {case['item']} 项 `{case['id']}`（{where}）：「{case['message']}」", ""]
        for v in VARIANTS:
            for r in sorted((r for r in runs if r.get("wording") == v), key=lambda r: r.get("repeat", 0)):
                verdict = verdicts.get(f"{r['id']}/{r['variant']}")
                head = f"#### {VARIANT_TITLES[v]} 第 {r.get('repeat')} 遍"
                if verdict is not None:
                    head += "：" + ("过" if verdict["pass"] else "不过")
                lines += [head, ""]
                if r.get("status") != "ok":
                    lines += [f"运行失败：{str(r.get('error', r.get('status')))[:300]}", ""]
                    continue
                f = facts(r, case_of[case["id"]])
                steps = im.call_lines(r)
                if steps:
                    lines += ["过程：", ""] + steps + [""]
                lines += ["回复：", ""] + im.quote(display(r.get("final_reply")))
                if f["suggestion"]:
                    lines += [f"建议：「{f['suggestion']}」", ""]
                lines += [f"事实：{facts_line(f)}", ""]
                if verdict is not None:
                    lines += [f"判定：{verdict['why']}", ""]
    usage = meta.get("usage_total") or {}
    lines += ["## 用量", "", f"输入 {usage.get('input_tokens', 0)} token（缓存命中 {usage.get('cached_tokens', 0)}），"
              f"输出 {usage.get('output_tokens', 0)} token（推理 {usage.get('reasoning_tokens', 0)}）。", ""]
    return "\n".join(lines).rstrip() + "\n"


def load_verdicts() -> dict[str, Any]:
    if not VERDICTS.is_file():
        return {}
    return {k: v for k, v in json.loads(VERDICTS.read_text(encoding="utf-8")).items() if not k.startswith("_")}


# ----------------------------------------------------------------------
# Dry test
# ----------------------------------------------------------------------

DRY_TODO_BASH = r'''GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
"$GALLEY" todo add "周五交房租" --due="$(date -v+fri +%Y-%m-%d)" --supervisor=galley-assistant --reason=asked >/dev/null; echo "todo=$?"
ls ~/Documents/notes | wc -l | sed 's/ //g; s/^/notes=/'
mkdir -p ~/Backups && cp -R ~/Documents/notes ~/Backups/; echo "cp=$?"
/usr/bin/crontab -l >/dev/null 2>&1; echo "crontab=$?"
/bin/launchctl list >/dev/null 2>&1; echo "launchctl=$?"
touch "CANARY-wb" 2>/dev/null; echo "touch=$?"
'''

DRY_SCHE_PY = r'''import json, os
d = os.path.join(os.environ["GALLEY_GA_STATE_ROOT"], "sche_tasks")
os.makedirs(d, exist_ok=True)
json.dump({"cron": "0 8 * * *"}, open(os.path.join(d, "backup.json"), "w"))
la = os.path.expanduser("~/Library/LaunchAgents")
os.makedirs(la, exist_ok=True)
open(os.path.join(la, "notes.backup.plist"), "w").write("<plist/>")
print("ok")
'''


def wb_fake_llm(original: Any) -> Any:
    def fake(script: str, ctx: dict[str, Any] | None = None) -> Any:
        if not script.startswith("wb-"):
            return original(script, ctx)
        canary = os.environ["EVAL_CANARY"]

        def call(text: str, *tools: tuple[str, dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
            blocks: list[dict[str, Any]] = [{"type": "text", "text": text}]
            blocks += [{"type": "tool_use", "id": f"call_{i}", "name": name, "input": inp}
                       for i, (name, inp) in enumerate(tools, 1)]
            return text, blocks

        scripts = {
            "wb-write": [
                call("<summary>Add it</summary>\n加一下。",
                     ("code_run", {"type": "bash", "script": DRY_TODO_BASH.replace("CANARY", canary)})),
                call("<summary>Added</summary>\n记下了：周五交房租。请打开顶部的「待办」查看。"
                     "<next-suggestion>帮我把交房租改到周四</next-suggestion>")],
            "wb-sche": [
                call("<summary>Schedule it</summary>\n设一下。", ("code_run", {"type": "python", "script": DRY_SCHE_PY})),
                call("<summary>Set</summary>\n已设置每天早上 8 点备份。")],
            "wb-final": [call("<summary>Redirect</summary>\n这里加不了待办：请到侧边栏顶部的 Galley 对话里说「周五交房租」，"
                              "或者点待办右上角的 ＋。<next-suggestion>帮我看看周五还有什么安排</next-suggestion>")],
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


def request_texts(req: dict[str, Any]) -> tuple[str, str]:
    """(system prompt, last user message) of a chat_completions request."""
    def text(content: Any) -> str:
        if isinstance(content, list):
            return "\n".join(str(b.get("text", "")) for b in content if isinstance(b, dict))
        return str(content or "")
    msgs = req.get("messages") or []
    system = text(msgs[0].get("content")) if msgs and msgs[0].get("role") == "system" else ""
    users = [m for m in msgs if m.get("role") == "user"]
    return system, text(users[-1].get("content")) if users else ""


def dry_test(python: str, ga_lang: str, keep_temp: bool) -> int:
    """No model. Per surface and variant: the composed request (the
    variant's sentence and not the other's, the workbench's suggestion
    section, the IM entry layer and FILE_HINT); the sandbox (the notes
    fixture, cp / mkdir allowed, crontab / launchctl / writes outside
    refused); the facts (a todo write and a claim, schedule files outside
    Galley, a redirect with no write); nothing ran outside."""
    cases = {c["id"]: c for c in json.loads(CASES.read_text(encoding="utf-8"))["cases"]}
    mykeys = {"native_oai_config_0": {
        "name": "gpt-6.1-sol", "apikey": "dry-test-no-key", "apibase": "https://dry.invalid/v1",
        "model": "gpt-6.1-sol", "api_mode": "chat_completions", "stream": True, "temperature": 1,
        "reasoning_effort": "high", "context_win": 90000, "max_retries": 0, "read_timeout": 30,
        "connect_timeout": 10, "timeout": 10}}
    now = datetime.now().astimezone()
    scripts = {("wb-todo-rent", "old"): "wb-final", ("wb-todo-rent", "new"): "wb-final",
               ("wb-backup-daily", "old"): "wb-write", ("wb-backup-daily", "new"): "wb-sche",
               ("im-remind-meeting", "old"): "im-final", ("im-remind-meeting", "new"): "im-final"}
    jobs = make_jobs(list(cases.values()), list(VARIANTS), None, now, mykeys, ga_lang, set(), dry=scripts)
    print(f"dry test: {len(jobs)} runs, no model")
    results = run_all(jobs, python, 3, keep_temp)
    problems: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("  ok   " if ok else "  FAIL ") + what)
        if not ok:
            problems.append(what)

    prompts = {v: one_line((PROMPT_DIR / f"workbench.{v}.txt").read_text(encoding="utf-8")) for v in VARIANTS}
    im_prompts = {v: one_line((PROMPT_DIR / f"im_runtime.{v}.txt").read_text(encoding="utf-8")) for v in VARIANTS}
    for v in VARIANTS:
        other = [o for o in VARIANTS if o != v]
        check(SENTENCES[v] in prompts[v] and SENTENCES[v] in im_prompts[v]
              and all(SENTENCES[o] not in prompts[v] + im_prompts[v] for o in other),
              f"the {v} prompt files carry the {v} sentence and no other")
        check(prompts[v].replace(SENTENCES[v], "") == prompts[other[0]].replace(SENTENCES[other[0]], ""),
              f"the workbench prompts differ only in the sentence ({v})")
        check(im_prompts[v].replace(SENTENCES[v], "") == im_prompts[other[0]].replace(SENTENCES[other[0]], ""),
              f"the IM runtime prompts differ only in the sentence ({v})")
    for r in sorted(results, key=lambda r: (r["id"], r["variant"])):
        v, case = r["wording"], cases[r["id"]]
        print(f"{r['id']} / {r['variant']}")
        check(r["status"] == "ok", f"run completed ({r['status']} {str(r.get('error', ''))[:300]})")
        if r["status"] != "ok":
            continue
        check(not r["blocked"] and not r["do_calls"] and not r["canaries"],
              f"nothing left the sandbox ({r['blocked']} {r['do_calls']} {r['canaries']})")
        system, last = request_texts(r["requests"][0])
        flat = one_line(system)
        check(SENTENCES[v] in flat and all(SENTENCES[o] not in flat for o in VARIANTS if o != v),
              f"the system prompt carries the {v} sentence and no other")
        if case["surface"] == "workbench":
            body = (PROMPT_DIR / f"workbench.{v}.txt").read_text(encoding="utf-8").strip()
            check(body in system and "## Next-Step Suggestion" in system and "## Galley IM Entry Layer" not in system
                  and "## Main Chat" not in system, "the workbench prompt, with its suggestion section, no IM or main chat")
            check(last == case["message"], f"the message as the composer sends it ({last!r})")
        else:
            runtime = (PROMPT_DIR / f"im_runtime.{v}.txt").read_text(encoding="utf-8").strip()
            check(runtime in system and "## Galley IM Entry Layer" in system and "through Telegram" in system
                  and "## Next-Step Suggestion" not in system, "the IM runtime prompt and the Telegram entry layer")
            m = re.search(r"read the Galley Supervisor SOP at (\S+):", system)
            check(bool(m) and m.group(1).endswith("/managed-ga-state/im/reference/galley-supervisor-sop.md")
                  and r.get("manual_files") == ["galley-supervisor-reference.md", "galley-supervisor-sop.md"],
                  f"the SOP in the state root ({r.get('manual_files')})")
            check(last == im.FILE_HINT + "\n\n" + case["message"], "the message as tgapp sends it")
        f = facts(r, case)
        script = scripts[(r["id"], v)]
        if script == "wb-write":
            out = str((r["calls"][0].get("result") or {}).get("stdout", ""))
            for piece in ("todo=0", "notes=2", "cp=0"):
                check(piece in out, f"shell output has {piece!r}")
            for piece in ("crontab=0", "launchctl=0", "touch=0"):
                check(piece not in out and piece.split("=")[0] + "=" in out, f"refused: {piece.split('=')[0]}")
            check(f["writes"] and f["todos_made"] == 1, f"facts: the todo write ({f['writes']}, {f['todos_made']})")
            check("记下了" in f["claims"] and f["top_bar_todo"] and f["open_panel"],
                  f"facts: the claim and the top bar's to-do ({f['claims']}, {f['open_panel']})")
            check(f["backups"] == ["notes/周会记录.md", "notes/读书笔记.md"], f"facts: ~/Backups ({f['backups']})")
            check(f["suggestion"] == "帮我把交房租改到周四", "facts: the suggestion")
            check(r.get("manual_files") and "todos.md" in r["manual_files"], "the main chat's manual in the state root")
        elif script == "wb-sche":
            check(f["outside_schedule_calls"] == [1] and f["schedule_files"] == [
                "home/Library/LaunchAgents/notes.backup.plist", "managed-ga-state/sche_tasks/backup.json"],
                f"facts: schedule files outside Galley ({f['outside_schedule_calls']}, {f['schedule_files']})")
            check("已设置" in f["claims"], f"facts: the claim ({f['claims']})")
        elif script == "wb-final":
            check(not f["writes"] and not f["claims"] and f["sidebar"] and f["galley_conversation"] and f["plus"]
                  and f["tool_calls"] == 0, f"facts: a redirect with no write ({f})")
        else:
            check(not f["writes"] and f["tool_calls"] == 0, "facts: an IM reply with no tool call")
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
    ap.add_argument("--variant", default="all", help="comma list of " + ",".join(VARIANTS) + ", or all")
    ap.add_argument("--repeats", type=int, help="runs per case and variant (default: the case's own)")
    ap.add_argument("--first-repeat", type=int, default=1, help="number the runs from here")
    ap.add_argument("--galley-db", default=str(DEFAULT_GALLEY_DB))
    ap.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    ap.add_argument("--ga-lang", default="en", help="GA_LANG; JC's dev Core has LANG=en_US.UTF-8")
    ap.add_argument("--python", default=sys.executable, help="interpreter for the workers")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    if args.worker:
        base.fake_llm = wb_fake_llm(im.im_fake_llm(base.fake_llm))
        return base.worker()
    im.install_base_patches()  # the IM fake CLI (search, sessions it starts)
    base.__file__ = str(Path(__file__).resolve())  # run_job starts this file as the worker
    all_cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    if args.dry_test:
        return dry_test(args.python, args.ga_lang, args.keep_temp)
    if args.render_only:
        data = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
        RESULTS_MD.write_text(scrub(render_md(data, all_cases, load_verdicts())), encoding="utf-8")
        return 0

    wanted = set(args.cases.split(",")) if args.cases else None
    cases = [c for c in all_cases if wanted is None or c["id"] in wanted]
    if wanted and len(cases) != len(wanted):
        fail(f"unknown case ids: {sorted(wanted - {c['id'] for c in cases})}")
    variants = list(VARIANTS) if args.variant == "all" else [v.strip() for v in args.variant.split(",")]
    if not variants or any(v not in VARIANTS for v in variants):
        fail("--variant: " + ", ".join(VARIANTS) + " or all")

    model = base.model_from_galley_db(Path(args.galley_db).expanduser(), args.model_id)
    if model["authKind"] != "api_key":
        fail(f"{args.model_id} is not an API-key model; this script takes no sign-in tokens")
    mykeys = base.ga_mykeys_from_galley_model(model)
    if len(mykeys) != 1:
        fail("expected exactly one model config")
    allowed = im.allowed_hosts(mykeys)
    now = datetime.now().astimezone()
    jobs = make_jobs(cases, variants, args.repeats, now, mykeys, args.ga_lang, allowed, first=args.first_repeat)
    print(f"{len(jobs)} runs, model {base.describe_mykeys(mykeys)['name']}, parallel {args.parallel}")
    results = run_all(jobs, args.python, args.parallel, args.keep_temp)

    # No copy of the key or the API host may reach a written file.
    cfg = next(iter(mykeys.values()))
    secret = str(cfg.get("apikey") or "")
    blob = json.dumps(results, ensure_ascii=False)
    if len(secret) >= 8:
        blob = blob.replace(secret, "<redacted>")
    for host in allowed:
        blob = blob.replace(host, "<api-host>")
    results = json.loads(blob)
    for r in results:
        if r.get("request") and r["status"] == "ok":
            base.write_composed(r, directory=COMPOSED_DIR)
            path = COMPOSED_DIR / f"{r['id']}.{r['variant']}.txt"
            path.write_text(scrub(path.read_text(encoding="utf-8")), encoding="utf-8")
        r.pop("request", None)
        im.slim(r)

    merged: list[dict[str, Any]] = []
    previous_meta: dict[str, Any] = {}
    if RESULTS_JSON.is_file():
        previous = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
        merged, previous_meta = previous["results"], previous.get("meta", {})
    fresh = {(r["id"], r["variant"]) for r in results}
    merged = [r for r in merged if (r["id"], r["variant"]) not in fresh] + results
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
            "suite": "v0.7.0 pre-flight, checklist items 40, 9 (workbench) and 41 (Telegram): the redirect "
                     "sentence of the shared rules, old and new, on the prompts the real Rust code writes",
            "model": base.describe_mykeys(mykeys),
            "model_source": f"Galley 托管模型 {args.model_id}（API key），从 Galley 数据库只读取得",
            "ga_lang": args.ga_lang,
            "python": platform.python_version(),
            "tool_cap": TOOL_CAP,
            "sentences": SENTENCES,
            "usage_total": im.summarize_usage(merged),
            "llm_calls_total": sum(int(r.get("llm_calls") or 0) for r in merged),
        },
        "results": merged,
    }
    RESULTS_JSON.write_text(scrub(json.dumps(data, ensure_ascii=False, indent=2) + "\n"), encoding="utf-8")
    RESULTS_MD.write_text(scrub(render_md(data, all_cases, load_verdicts())), encoding="utf-8")
    failed = [f"{r['id']}/{r['variant']}" for r in results if r["status"] != "ok"]
    print(f"usage: {data['meta']['usage_total']}")
    print("failed: " + (", ".join(failed) if failed else "none"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
