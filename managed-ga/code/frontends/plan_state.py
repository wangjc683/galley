"""Plan / todo state — pure stdlib, no UI framework dependency.

API:
  extract(text)                   → [(content, "open"|"done"), …]
  is_active(agent, messages=None) → plan mode on (stash OR per-session msg ref)
  resolve_path(agent, messages=None) → live plan.md path (or None)
  find_path_in_messages(messages) → most recent plan.md path mentioned
  current_step(messages)          → latest `当前步骤：…` snippet (or "")
  summary(items)                  → (n_done, n_total)
  is_complete(items)              → all done (or empty)

Supported task-line shapes (all matched by `extract`):
  - [ ] foo              ← bullet + open
  - [x] foo              ← bullet + done
  1. [✓] foo             ← numbered + done
  2. [✓ 2026-05-16] foo  ← numbered + timestamped done, content after bracket
  3. [✓ 已生成: foo]      ← numbered + done with description *inside* bracket
  4. [D][P] foo          ← two marker groups (delegate + parallel), still open
  5. [D] foo             ← non-standard marker "D" → open (not done)
"""
from __future__ import annotations
import os, re
from typing import Any, Optional

_DONE_CHARS = set("xX✓✔√☑")
# Newline-insert before a bullet stuck to JSON debris (`{"content": "- [ ] …`).
_GLUE_RE = re.compile(r"(?<!\n)((?:[-*+]|\d+\s*[.)、:）]) \[)")
_BULLET_RE = re.compile(r"^\s*(?:[-*+]|\d+\s*[.)、:）])\s+")
_BRACKET_RE = re.compile(r"\[([^\]]*)\]")
# Strip `✓ ` / `x ` / timestamp prefix when bracket content is used as title.
_INLINE_STRIP_RE = re.compile(
    r"^[" + re.escape("".join(_DONE_CHARS)) + r"]\s*(?:\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*)?"
)
_DEBRIS_RE = re.compile(r'["\\<].*$')
# Strip markdown emphasis since planbar renders rich.Text, not Markdown.
_MD_EMPHASIS_RE = re.compile(
    r"\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|__([^_\n]+)__|_([^_\n]+)_|`([^`\n]+)`"
)
def _strip_md(s: str) -> str:
    return _MD_EMPHASIS_RE.sub(lambda m: next(g for g in m.groups() if g is not None), s)


def _has_done_glyph(marker: str) -> bool:
    return any(c in _DONE_CHARS for c in marker)


def extract(text: str) -> list[tuple[str, str]]:
    if not text: return []
    norm = text.replace("\\n", "\n") if "\\n" in text else text
    norm = _GLUE_RE.sub(r"\n\1", norm)
    found: dict[str, str] = {}
    for line in norm.splitlines():
        head = _BULLET_RE.match(line)
        if not head: continue
        rest = line[head.end():]
        groups: list[str] = []
        # Consume any number of consecutive `[...]` groups — covers `[D][P]`
        # task-type chains as well as the plain `[ ]` / `[x]` single form.
        while True:
            b = _BRACKET_RE.match(rest)
            if not b: break
            groups.append(b.group(1))
            rest = rest[b.end():]
        if not groups: continue
        is_done = any(_has_done_glyph(g) for g in groups)
        inline = rest.strip()
        if inline:
            content = inline
        elif is_done:
            # `[✓ description]` shape — description lives inside the bracket
            # next to the glyph. Strip the glyph + optional timestamp.
            done_g = next(g for g in groups if _has_done_glyph(g))
            content = _INLINE_STRIP_RE.sub("", done_g).strip()
        else:
            continue
        k = _strip_md(_DEBRIS_RE.sub("", content).strip())
        if not k: continue
        status = "done" if is_done else "open"
        # Same content seen twice — done wins over open.
        if k not in found or status == "done":
            found[k] = status
    return list(found.items())


def _stashed_plan_path(agent) -> str:
    # First non-empty `working['in_plan_mode']` from (handler, agent).
    for src in (getattr(agent, "handler", None), agent):
        p = ((getattr(src, "working", None) or {}).get("in_plan_mode") or "").strip()
        if p: return p
    return ""


def _resolve_stashed(p: str) -> Optional[str]:
    if not p: return None
    rel = p.lstrip("./\\")
    cwd = os.getcwd()
    for c in (p, os.path.join(cwd, "temp", rel), os.path.join(cwd, rel)):
        if os.path.isfile(c) and os.path.getsize(c) > 0: return c
    return None


# Strict per-session discovery — scan this session's own messages only.
_PATH_RE = re.compile(r"""((?:\.\/)?(?:temp\/)?plan_[A-Za-z0-9_\-]+\/plan\.md)""")


def _slice(messages, start_idx: int):
    if not messages: return []
    if start_idx <= 0: return list(messages)
    return list(messages)[start_idx:]


def find_path_in_messages(messages, start_idx: int = 0) -> Optional[str]:
    """Latest existing `plan_XXX/plan.md` referenced after `start_idx`.
    Items can be `ChatMessage`-like (`.content`) or plain strings;
    only paths that exist on disk are returned."""
    sliced = _slice(messages, start_idx)
    if not sliced: return None
    for m in reversed(sliced):
        text = getattr(m, "content", None)
        if text is None: text = m if isinstance(m, str) else ""
        if not text or "plan.md" not in text: continue
        for hit in reversed(_PATH_RE.findall(text)):
            p = _resolve_stashed(hit.strip().strip("\"'"))
            if p: return p
    return None


# Prefer concise `<summary>` narrative over the long plan-item echo;
# treat `❌ 当前步骤:` as "step done", not "current step".
_SUMMARY_STEP_RE = re.compile(
    r"<summary>[^<]*?当前步骤[:：]\s*([^<\n]{1,160})</summary>", re.DOTALL)
_STEP_RE = re.compile(r"📌\s*当前步骤[:：]\s*([^\n。！!？?]{1,160})")
_DONE_STEP_RE = re.compile(r"❌\s*当前步骤[:：]")


def current_step(messages, start_idx: int = 0, max_len: int = 60) -> str:
    """Latest `当前步骤：…` snippet; `<summary>` form preferred, `❌`-prefixed
    skipped. Trimmed to `max_len` chars so it fits the 5-row plan card."""
    sliced = _slice(messages, start_idx)
    if not sliced: return ""

    def _clean(s: str) -> str:
        return _strip_md(re.sub(r"\s+", " ", s).strip().rstrip(" ：:—-"))

    def _cap(s: str) -> str:
        s = _clean(s)
        if len(s) <= max_len: return s
        return s[:max_len - 1].rstrip() + "…"

    for m in reversed(sliced):
        text = getattr(m, "content", None)
        if text is None: text = m if isinstance(m, str) else ""
        if not text or "当前步骤" not in text: continue
        hits = _SUMMARY_STEP_RE.findall(text)
        if hits: return _cap(hits[-1])
        for raw in reversed(_STEP_RE.findall(text)):
            if _DONE_STEP_RE.search(raw): continue
            return _cap(raw)
    return ""


def is_active(agent, messages=None, start_idx: int = 0,
              restored_path: str = "") -> bool:
    """Plan mode is on. Primary: `working['in_plan_mode']`. Then
    `restored_path` — a path recovered from the transcript's structured
    `enter_plan_mode` tool_use by /continue (see continue_cmd.find_plan_entry);
    unlike the message scan it cannot be spoofed by a path typed in chat.
    Legacy fallback: a `plan_*/plan.md` referenced in this session's messages
    (no global scan) — only consulted when `messages` is passed."""
    if _stashed_plan_path(agent): return True
    if restored_path and _resolve_stashed(restored_path): return True
    return find_path_in_messages(messages, start_idx) is not None


def resolve_path(agent, messages=None, start_idx: int = 0,
                 restored_path: str = "") -> Optional[str]:
    p = _resolve_stashed(_stashed_plan_path(agent))
    if p: return p
    if restored_path:
        p = _resolve_stashed(restored_path)
        if p: return p
    return find_path_in_messages(messages, start_idx)


def summary(items: list[tuple[str, str]]) -> tuple[int, int]:
    return sum(1 for _, st in items if st == "done"), len(items)


def is_complete(items: list[tuple[str, str]]) -> bool:
    return not items or all(st == "done" for _, st in items)


# --- Desktop bridge only (APIs above unchanged) ---
_ENTER_PLAN_RE = re.compile(r"""enter_plan_mode\s*\(\s*["']([^"']+)["']""", re.I)


def _msg_content(m) -> str:
    if isinstance(m, str): return m
    c = m.get("content") if isinstance(m, dict) else getattr(m, "content", None)
    return c if isinstance(c, str) else ""


def _msg_role(m) -> str:
    if isinstance(m, dict): return str(m.get("role") or "")
    return str(getattr(m, "role", "") or "")


def plan_path_mention_in_messages(messages, start_idx: int = 0) -> Optional[str]:
    """Latest assistant/tool `enter_plan_mode(...)` path; plain chat text is not a signal."""
    for m in reversed(_slice(messages, start_idx)):
        if _msg_role(m) == "user":
            continue
        text = _msg_content(m)
        if not text: continue
        if "enter_plan_mode" in text and (hit := _ENTER_PLAN_RE.search(text)):
            return hit.group(1).strip().strip("\"'")
    return None


def _resolve_stashed_at(p: str, root: str) -> Optional[str]:
    if not p or not root: return None
    rel = p.lstrip("./\\")
    cwd = root.rstrip("/\\")
    for c in (p, os.path.join(cwd, "temp", rel), os.path.join(cwd, rel)):
        if os.path.isfile(c) and os.path.getsize(c) > 0: return c
    return None


def _find_path_at(messages, start_idx: int, root: str) -> Optional[str]:
    for m in reversed(_slice(messages, start_idx)):
        if _msg_role(m) == "user":
            continue
        text = _msg_content(m)
        if not text or "plan.md" not in text: continue
        for hit in reversed(_PATH_RE.findall(text)):
            if p := _resolve_stashed_at(hit.strip().strip("\"'"), root): return p
    return None


def _store_plan_path(path: str, root: str) -> str:
    p = (path or "").strip()
    if not p:
        return ""
    if os.path.isabs(p) and root:
        for base in (os.path.join(root, "temp"), root):
            try:
                rel = os.path.relpath(p, base)
            except ValueError:
                continue
            if rel and not rel.startswith(".."):
                return rel.replace("\\", "/")
    return p.replace("\\", "/").lstrip("./")


def is_plan_mode_path(path: str) -> bool:
    norm = (path or "").replace("\\", "/").lstrip("./")
    return re.fullmatch(r"(?:temp/)?plan_[A-Za-z0-9_\-]+/plan\.md", norm) is not None


def ensure_agent_plan_mode(sess: Any, root: str) -> None:
    agent = getattr(sess, "agent", None)
    bound = (getattr(sess, "plan_path", "") or "").strip()
    if not agent or not bound or _stashed_plan_path(agent):
        return
    if not _resolve_stashed_at(bound, root):
        return
    for src in (getattr(agent, "handler", None), agent):
        if not src:
            continue
        enter = getattr(src, "enter_plan_mode", None)
        if callable(enter):
            enter(bound)
            return
    for src in (getattr(agent, "handler", None), agent):
        working = getattr(src, "working", None)
        if isinstance(working, dict):
            working["in_plan_mode"] = bound
            return


def sync_plan_path_from_text(sess: Any, text: str, root: str) -> None:
    """If agent emits enter_plan_mode(...), keep session bound path in sync."""
    if not text:
        return
    m = _ENTER_PLAN_RE.search(text)
    if not m:
        return
    raw = m.group(1).strip().strip("\"'")
    if not raw:
        return
    sess.plan_path = _store_plan_path(raw, root)


def session_plan_active(sess: Any, agent, messages, start_idx: int, root: str) -> bool:
    """Desktop: active when this session has a bound plan_path (not global plan_*/ scan)."""
    bound = (getattr(sess, "plan_path", None) or "").strip()
    if _stashed_plan_path(agent):
        return True
    if not bound:
        return False
    if _resolve_stashed_at(bound, root):
        return True
    if getattr(sess, "status", "") == "running":
        return True
    return False


def session_plan_resolve(bound: str, root: str) -> Optional[str]:
    if not bound:
        return None
    return _resolve_stashed_at(bound.strip(), root)


def _desktop_resolve_plan_file(sess: Any, bound: str, root: str, agent, messages, base: int) -> Optional[str]:
    """Desktop read path: bound → agent stash → per-session message scan."""
    path = session_plan_resolve(bound, root)
    if path:
        return path
    if agent and (stash := _stashed_plan_path(agent)):
        if p := _resolve_stashed_at(stash, root):
            return p
    return _find_path_at(messages, base, root)


def desktop_plan_payload_from_session(sess: Any, ga_root: str = "") -> dict:
    """Per-session plan card — bound plan_path + tuiapp_v2-style item/placeholder/complete."""
    raw = list(getattr(sess, "messages", []) or [])
    base = max(0, int(getattr(sess, "plan_scan_baseline", 0) or 0))
    if base > len(raw):
        base = len(raw)
    root = (getattr(sess, "cwd", None) or ga_root or "").strip()
    agent = getattr(sess, "agent", None)
    partial = getattr(sess, "partial", None)
    if isinstance(partial, dict) and isinstance(partial.get("content"), str):
        sync_plan_path_from_text(sess, partial["content"], root)
    live_path = _stashed_plan_path(agent)
    if live_path and not (getattr(sess, "plan_path", None) or "").strip():
        sess.plan_path = _store_plan_path(live_path, root)
        if not getattr(sess, "plan_scan_baseline", 0):
            sess.plan_scan_baseline = len(raw)
    if not (getattr(sess, "plan_path", None) or "").strip():
        mentioned = plan_path_mention_in_messages(raw, base)
        if mentioned:
            sess.plan_path = _store_plan_path(mentioned, root)
        else:
            found = _find_path_at(raw, base, root)
            if found:
                sess.plan_path = _store_plan_path(found, root)
            else:
                return {"active": False}
    if not session_plan_active(sess, agent, raw, base, root):
        return {"active": False}
    ensure_agent_plan_mode(sess, root)
    bound = getattr(sess, "plan_path", "") or ""
    path = _desktop_resolve_plan_file(sess, bound, root, agent, raw, base)
    items = []
    if path:
        try:
            items = [{"content": c, "status": st} for c, st in extract(open(path, encoding="utf-8", errors="replace").read())]
        except OSError:
            pass
    step_msgs = list(raw[base:])
    if isinstance(p := getattr(sess, "partial", None), dict) and isinstance(c := p.get("content"), str) and c:
        step_msgs.append({"content": c})
    step = current_step(step_msgs, start_idx=0)
    if not items:
        hp = getattr(sess, "plan_path", "") or _stashed_plan_path(agent) or ""
        hint = "/".join(hp.replace("\\", "/").rstrip("/").split("/")[-2:]) if hp else "plan.md"
        return {"active": True, "placeholder": True, "done": 0, "total": 0, "complete": False, "step": step, "pathHint": hint, "items": []}
    pairs = [(x["content"], x["status"]) for x in items]
    n_done, n_total = summary(pairs)
    return {"active": True, "placeholder": False, "done": n_done, "total": n_total, "complete": is_complete(pairs), "step": step, "items": items}
