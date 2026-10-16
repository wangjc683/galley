"""Read-only stats over workbench.db assistant replies (rich-reply research, 2026-10-16).

Counts closing-turn final answers by runtime kind / main chat: tables (outside
fences), fenced code, mermaid, LaTeX, local .html paths, images; plus
file_write / file_patch targets with .html / .png / .svg extensions.
"""
import sqlite3, json, re, os, statistics, sys
from collections import Counter, defaultdict
DB = os.path.expanduser("~/Library/Application Support/app.galley/workbench.db")
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = con.execute("""
select m.id, m.session_id, m.turn_index, m.final_answer, m.tool_calls, m.created_at,
       s.ga_runtime_kind, s.main_chat, m.visibility
from messages m join sessions s on s.id = m.session_id
where m.role='assistant'
""").fetchall()

def tools_of(tc):
    try:
        arr = json.loads(tc) if tc else []
    except Exception:
        arr = []
    return arr if isinstance(arr, list) else []

FENCE = re.compile(r'^\s{0,3}(`{3,}|~{3,})', re.M)
MERMAID = re.compile(r'^\s{0,3}(`{3,}|~{3,})\s*mermaid', re.M | re.I)
TABLE_DELIM = re.compile(r'^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$', re.M)
LATEX = re.compile(r'\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]')
HTML_ANY = re.compile(r'\.html?\b', re.I)
# local path: starts with / or ~/ or X:\ and ends with .html/.htm, not part of URL
HTML_LOCAL = re.compile(r'(?<![\w:/.])(?:~?/|[A-Za-z]:[\\/])[^\s`)\]|"\'<>]*\.html?\b', re.I)
IMG_MD = re.compile(r'!\[[^\]]*\]\([^)]+\)')
IMG_PATH = re.compile(r'(?<![\w:/.])(?:~?/|[A-Za-z]:[\\/])[^\s`)\]|"\'<>]*\.(?:png|jpe?g|gif|webp|svg)\b', re.I)
FILE_MARK = re.compile(r'\[FILE:[^\]]+\]')

def strip_fences(t):
    # remove fenced blocks so tables inside code don't count
    out, infence, marker = [], False, None
    for line in t.split("\n"):
        m = re.match(r'^\s{0,3}(`{3,}|~{3,})', line)
        if m:
            if not infence:
                infence, marker = True, m.group(1)[0]*3
                continue
            elif line.strip().startswith(marker):
                infence = False
                continue
        if not infence:
            out.append(line)
    return "\n".join(out)

def is_closing(tc):
    arr = tools_of(tc)
    return all((c or {}).get("toolName") == "no_tool" for c in arr)

groups = defaultdict(list)
for r in rows:
    _id, sid, ti, fa, tc, ca, kind, main, vis = r
    if vis != 'visible' or not fa or not fa.strip():
        continue
    if not is_closing(tc):
        continue
    key = 'main_chat' if main == 1 else kind
    groups[key].append(fa)
    groups['ALL'].append(fa)

def pct(n, d): return f"{n}/{d} = {100*n/d:.1f}%" if d else "0"
for key in ['ALL', 'managed', 'external', 'main_chat', 'galley_native']:
    xs = groups.get(key, [])
    if not xs: continue
    d = len(xs)
    distinct = len(set(xs))
    lens = sorted(len(x) for x in xs)
    p90 = lens[int(0.9*(d-1))]
    p50 = statistics.median(lens)
    table = sum(1 for x in xs if TABLE_DELIM.search(strip_fences(x)))
    fence = sum(1 for x in xs if FENCE.search(x))
    mermaid = sum(1 for x in xs if MERMAID.search(x))
    latex = sum(1 for x in xs if LATEX.search(strip_fences(x)))
    html_any = sum(1 for x in xs if HTML_ANY.search(x))
    html_local = sum(1 for x in xs if HTML_LOCAL.search(x))
    img_md = sum(1 for x in xs if IMG_MD.search(x))
    img_path = sum(1 for x in xs if IMG_PATH.search(x))
    filemark = sum(1 for x in xs if FILE_MARK.search(x))
    over1500 = sum(1 for l in lens if l > 1500)
    print(f"== {key}: n={d} distinct={distinct}")
    print(f"  len avg={sum(lens)/d:.0f} median={p50:.0f} p90={p90} max={lens[-1]} >1500: {pct(over1500,d)}")
    print(f"  table {pct(table,d)} | fence {pct(fence,d)} | mermaid {pct(mermaid,d)} | latex {pct(latex,d)}")
    print(f"  .html any {pct(html_any,d)} | .html local path {pct(html_local,d)} | md image {pct(img_md,d)} | image path {pct(img_path,d)} | [FILE:] {pct(filemark,d)}")

# tool_calls stats
fw = Counter(); fw_by_kind = Counter()
opens = Counter()
coderun_html = 0; coderun_write_html=0; coderun_png=0
for r in rows:
    _id, sid, ti, fa, tc, ca, kind, main, vis = r
    key = 'main_chat' if main == 1 else kind
    for c in tools_of(tc):
        c = c or {}
        name = c.get("toolName"); args = c.get("args") or {}
        if not isinstance(args, dict): args = {}
        if name in ("file_write", "file_patch"):
            p = str(args.get("path") or c.get("resolvedPath") or "")
            ext = os.path.splitext(p)[1].lower()
            if ext in (".html", ".htm", ".png", ".svg", ".jpg", ".jpeg"):
                fw[(name, ext)] += 1; fw_by_kind[(key, name, ext)] += 1
            fw[(name, "ALL")] += 1
        if name == "code_run":
            code = json.dumps(args, ensure_ascii=False)
            if re.search(r'\.html?\b', code, re.I): coderun_html += 1
            if re.search(r'\.html?\b', code, re.I) and re.search(r'write|open\(|savefig|to_html|write_html', code): coderun_write_html += 1
            if re.search(r'savefig|\.png\b', code, re.I): coderun_png += 1
            if re.search(r'(\bopen\s+[^\n]*\.html?|webbrowser\.open|start\s+[^\n]*\.html?)', code, re.I): opens['code_run_open_html'] += 1
        if name == "web_execute_js":
            s = json.dumps(args, ensure_ascii=False)
            if re.search(r'file://[^"\s]*\.html?', s, re.I): opens['web_js_file_html'] += 1
print("== tool calls")
for k, v in sorted(fw.items()): print("  ", k, v)
for k, v in sorted(fw_by_kind.items()): print("  by kind", k, v)
print("  code_run mentioning .html:", coderun_html, " ...with write/open/savefig/to_html:", coderun_write_html, " code_run savefig/.png:", coderun_png)
print("  opens:", dict(opens))
