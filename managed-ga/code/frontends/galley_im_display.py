"""Platform-neutral display helpers for Galley's managed IM frontends.

Galley-owned: added by managed patch 0024 as a new file, so upstream never
conflicts with it. frontends/tgapp.py uses it. frontends/dcapp.py still keeps
its own copies from patch 0023 (the `_`-prefixed originals of the functions
below, same semantics): 0023 sits in front of 0024 in the patch stack, so
moving dcapp over would make an earlier patch depend on a later one. The
migration waits for the next re-export of 0023, when this file becomes its
own patch ordered ahead of 0023 (recorded in the 2026-09-30 Telegram
conversation UX devlog).

Everything here is pure text in, text out: GA's display-queue step texts,
the desktop's fold header and TurnMarker readout wording, the ask_user
payload of a turn-end hook, and a Markdown table rewrite for chat apps that
cannot render tables.
"""
import re

from chatapp_common import clean_reply, strip_files

STEP_SUMMARY_LIMIT = 120
TOOL_LABELS = {
    "code_run": "运行代码", "file_read": "读取文件", "file_write": "写入文件",
    "file_patch": "修改文件", "web_scan": "读取网页", "web_execute_js": "执行网页脚本",
}
MULTI_SELECT_RE = re.compile(r"\[?(?:多选|multi(?:[-_ ]?select)?|select all)\]?", re.IGNORECASE)
# Same thresholds as the desktop's candidateLayout (gui/src/lib/ask-user-candidates.ts).
CANDIDATE_LIST_MIN_COUNT = 5
CANDIDATE_LIST_MAX_ROW_CHARS = 20
CANDIDATE_LIST_MAX_ROW_TOTAL_CHARS = 60
_TOOL_CALL_RE = re.compile(r"^\s*🛠️\s+([A-Za-z_]\w*)\(", re.M)
_SUMMARY_RE = re.compile(r"<summary>\s*(.*?)\s*</summary>", re.DOTALL)
_SUMMARY_SEARCH_STRIP_RE = re.compile(r"```.*?```|<thinking>.*?</thinking>", re.DOTALL)
_FENCE_RE = re.compile(r"^\s*(`{3,})")
_FENCE_CLOSE_RE = re.compile(r"^\s*(`{3,})\s*$")
_UNESCAPED_PIPE_RE = re.compile(r"(?<!\\)\|")
_DELIMITER_CELL_RE = re.compile(r"^:?-+:?$")


def one_line(text):
    return re.sub(r"\s+", " ", text or "").strip()


def clip(text, limit):
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def format_elapsed(seconds):
    """Desktop RunFoldHeader.formatDuration: rounded to whole seconds (half
    up, like Math.round), nothing at all under one second."""
    sec = int(max(0.0, float(seconds or 0)) + 0.5)
    if sec < 1:
        return ""
    if sec < 60:
        return f"用时 {sec} 秒"
    return f"用时 {sec // 60} 分 {sec % 60} 秒"


def fold_label(steps, seconds):
    parts = [f"{steps} 步"] if steps > 0 else []
    elapsed = format_elapsed(seconds)
    if elapsed:
        parts.append(elapsed)
    return " · ".join(parts)


def stopped_text(steps, seconds):
    label = fold_label(steps, seconds)
    return f"⏹ 已停止 · {label}" if label else "⏹ 已停止"


def live_elapsed(seconds, still_running=True):
    """Desktop TurnMarker readout (docs/design/conversation.md, Thinking
    Placeholder): nothing under 3 s, then `S 秒`, from 60 s `已 M 分 S 秒 ·
    仍在运行`. Whole seconds, floored: a readout only ever counts up.
    still_running=False drops the trailing clause (a queue wait is not a
    run)."""
    sec = int(max(0.0, float(seconds or 0)))
    if sec < 3:
        return ""
    if sec < 60:
        return f"{sec} 秒"
    text = f"已 {sec // 60} 分 {sec % 60} 秒"
    return f"{text} · 仍在运行" if still_running else text


def strip_transcript(text):
    """Hide LLM/tool transcript noise while preserving the final natural reply."""
    text = text or ""
    text = re.sub(r"^\s*\*?\*?LLM Running \(Turn \d+\) \.\.\.\*?\*?\s*$", "", text, flags=re.M)
    text = re.sub(r"^\s*🛠️\s+.*?(?=^\s*(?:\*?\*?LLM Running|<summary>|$))", "", text, flags=re.M | re.DOTALL)
    text = re.sub(r"^\s*(?:✅|❌|ERR|STDOUT|PAT\b|RC\b).*?$", "", text, flags=re.M)
    text = re.sub(r"<tool_use>.*?</tool_use>", "", text, flags=re.DOTALL)
    text = clean_reply(text)
    return strip_files(text).strip()


def display_done_text(text):
    body = strip_transcript(text)
    if body and body != "...":
        return body
    summaries = _SUMMARY_RE.findall(text or "")
    if summaries:
        return re.sub(r"\s+", " ", summaries[-1]).strip() or "..."
    return "..."


def visible_text(text):
    body = strip_transcript(text)
    return "" if body == "..." else body


def step_summary(text):
    """One status line for a settled step: its last <summary>, else the first
    line of its visible prose, else which tool it called, else nothing."""
    text = text or ""
    matches = _SUMMARY_RE.findall(_SUMMARY_SEARCH_STRIP_RE.sub("", text))
    summary = re.sub(r"\s+", " ", matches[-1]).strip()[:STEP_SUMMARY_LIMIT] if matches else ""
    if not summary:
        body = visible_text(text)
        summary = next((line for line in body.splitlines() if line.strip()), "")
    if not summary:
        match = _TOOL_CALL_RE.search(text)
        if match:
            summary = f"调用了{TOOL_LABELS.get(match.group(1), match.group(1))}"
    return one_line(summary)[:STEP_SUMMARY_LIMIT]


def final_step_text(raw, outputs):
    """The closing step's text. The desktop answer is the last step
    (finalAnswer); earlier steps' narration belongs to the process. Whatever
    `done` carries beyond the per-step texts (GA appends the backend-error
    block there) belongs to the closing step too."""
    raw = raw or ""
    if not outputs:
        return raw
    joined = "".join(outputs)
    extra = raw[len(joined):] if raw.startswith(joined) else ""
    return outputs[-1] + extra


def answer_body(step_text, raw):
    body = visible_text(step_text) or display_done_text(raw)
    return "" if body == "..." else body


def candidate_list(raw):
    items = raw if isinstance(raw, (list, tuple)) else ([] if raw is None else [raw])
    return [str(item).strip() for item in items if item is not None and str(item).strip()]


def extract_ask_user_event(ctx):
    """The ask_user payload of a turn-end hook ctx, or None. A question with
    no candidates is still an event (answered by typing). Some models split
    one question into parallel ask_user calls with one candidate each; GA
    serves only the first, so candidates of same-question siblings are
    merged in, as the desktop does."""
    ctx = ctx or {}
    exit_reason = ctx.get("exit_reason") or {}
    if not isinstance(exit_reason, dict) or exit_reason.get("result") != "EXITED":
        return None
    payload = exit_reason.get("data")
    if not isinstance(payload, dict):
        return None
    if payload.get("status") != "INTERRUPT" or payload.get("intent") != "HUMAN_INTERVENTION":
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    question = str(data.get("question") or "").strip() or "请提供输入："
    candidates = candidate_list(data.get("candidates"))
    for call in ctx.get("tool_calls") or []:
        args = call.get("args") if isinstance(call, dict) and call.get("tool_name") == "ask_user" else None
        if not isinstance(args, dict) or str(args.get("question") or "").strip() != question:
            continue
        for candidate in candidate_list(args.get("candidates")):
            if candidate not in candidates:
                candidates.append(candidate)
    return {"question": question, "candidates": candidates, "multi": bool(MULTI_SELECT_RE.search(question))}


def candidate_layout(candidates):
    if len(candidates) >= CANDIDATE_LIST_MIN_COUNT:
        return "list"
    total = 0
    for candidate in candidates:
        size = len(candidate.strip())
        if size > CANDIDATE_LIST_MAX_ROW_CHARS:
            return "list"
        total += size
    return "list" if total > CANDIDATE_LIST_MAX_ROW_TOTAL_CHARS else "row"


def _table_cells(line):
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|") and not text.endswith("\\|"):
        text = text[:-1]
    return [cell.replace("\\|", "|").strip() for cell in _UNESCAPED_PIPE_RE.split(text)]


def _is_table_delimiter(line):
    if not _UNESCAPED_PIPE_RE.search(line or ""):
        return False
    return all(_DELIMITER_CELL_RE.match(cell) for cell in _table_cells(line))


def _table_items(headers, rows):
    width = len(headers)
    rows = [(row + [""] * width)[:width] for row in rows]
    rows = [row for row in rows if any(row)]
    if not rows:
        heads = [head for head in headers if head]
        return ["• " + " · ".join(heads)] if heads else []
    items = []
    for row in rows:
        if width <= 2:
            items.append("• " + "：".join(cell for cell in row if cell))
            continue
        pairs = [f"{head}：{cell}" if head else cell for head, cell in zip(headers[1:], row[1:]) if cell]
        if row[0] and pairs:
            items.append(f"• {row[0]} — {'；'.join(pairs)}")
        else:
            items.append("• " + (row[0] or "；".join(pairs)))
    return items


def tables_to_lists(text):
    """Rewrite GFM tables as bullet lists for chat apps without tables.

    Two columns: `• c1：c2` per row (header dropped). Three or more: `• c1 —
    h2：c2；h3：c3…`, skipping empty cells. One column: `• c1`. A header with
    no rows: `• h1 · h2 …`. `\\|` in a cell is a literal pipe. Code fences
    are left alone; the list gets a blank line on either side."""
    lines = (text or "").split("\n")
    out, fence, i = [], 0, 0
    while i < len(lines):
        line = lines[i]
        if fence:
            match = _FENCE_CLOSE_RE.match(line)
            if match and len(match.group(1)) >= fence:
                fence = 0
            out.append(line)
            i += 1
            continue
        match = _FENCE_RE.match(line)
        if match and "```" not in line[match.end():]:
            fence = len(match.group(1))
            out.append(line)
            i += 1
            continue
        if (
            i + 1 < len(lines)
            and _UNESCAPED_PIPE_RE.search(line)
            and _is_table_delimiter(lines[i + 1])
            and len(_table_cells(line)) == len(_table_cells(lines[i + 1]))
        ):
            headers = _table_cells(line)
            rows, j = [], i + 2
            while j < len(lines) and lines[j].strip() and _UNESCAPED_PIPE_RE.search(lines[j]):
                rows.append(_table_cells(lines[j]))
                j += 1
            items = _table_items(headers, rows)
            if items:
                if out and out[-1].strip():
                    out.append("")
                out.extend(items)
                if j < len(lines) and lines[j].strip():
                    out.append("")
            i = j
            continue
        out.append(line)
        i += 1
    return "\n".join(out)
