import os, sys, re, json, threading, asyncio, queue as Q, time, random, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'temp')
from agentmain import GeneraticAgent
try:
    from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.constants import ChatType, MessageLimit, ParseMode
    from telegram.error import InvalidToken, RetryAfter
    from telegram.ext import ApplicationBuilder, CallbackQueryHandler, MessageHandler, filters, ContextTypes
    from telegram.helpers import escape_markdown
    from telegram.request import HTTPXRequest
except:
    print("Please ask the agent install python-telegram-bot to use telegram module.")
    sys.exit(1)
from chatapp_common import (
    FILE_HINT,
    HELP_TEXT,
    TELEGRAM_MENU_COMMANDS,
    clean_reply,
    ensure_single_instance,
    extract_files,
    format_restore,
    redirect_log,
    require_runtime,
    split_text,
)
from galley_im_display import (
    answer_body,
    candidate_layout,
    clip,
    extract_ask_user_event,
    final_step_text,
    fold_label,
    one_line,
    step_summary,
    still_running_suffix,
    stopped_text,
    tables_to_lists,
    visible_text,
)
from continue_cmd import handle_frontend_command, reset_conversation
from btw_cmd import handle_frontend_command as handle_btw_frontend_command
from review_cmd import handle as handle_review_command
from llmcore import mykeys

agent = GeneraticAgent()
agent.verbose = False
agent.inc_out = True


def _load_galley_config():
    raw = os.environ.get("GALLEY_TELEGRAM_CONFIG_JSON")
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except Exception as e:
        raise RuntimeError(f"load Galley Telegram config failed: {e}") from e
    if not isinstance(data, dict):
        raise RuntimeError("Galley Telegram config must be a JSON object")
    return data


_GALLEY_CFG = _load_galley_config()
_GALLEY_MANAGED = _GALLEY_CFG is not None


def _telegram_config():
    if not _GALLEY_MANAGED:
        # File-based (non-managed) config keeps upstream semantics untouched.
        token = mykeys.get("tg_bot_token")
        return token, set(mykeys.get("tg_allowed_users", []) or []), False, None
    cfg = _GALLEY_CFG or {}
    token = str(cfg.get("tg_bot_token", "") or "").strip()
    bind_code = str(cfg.get("tg_owner_bind_code", "") or "").strip() or None
    allowed, public = set(), False
    for item in cfg.get("tg_allowed_users") or []:
        text = str(item).strip()
        if text == "*":
            public = True
        elif text.lstrip("-").isdigit():
            # Telegram user ids are numeric; effective_user.id is an int.
            allowed.add(int(text))
    return token, allowed, public, bind_code


BOT_TOKEN, ALLOWED, PUBLIC_ACCESS, OWNER_BIND_CODE = _telegram_config()

GALLEY_STARTUP_FAILURE_LIMIT = 3
GALLEY_OWNER_BIND_ATTEMPT_LIMIT = 10
_galley_connected_once = False
_owner_bind_attempts = 0


def _emit_galley_status(state, last_error=None, **extra):
    hook = globals().get("GALLEY_STATUS_HOOK")
    if not callable(hook):
        return
    if extra:
        try:
            hook(state, last_error, **extra)
            return
        except TypeError:
            # Older launcher hooks take (state, last_error) only; drop the
            # extra fields rather than losing the status line entirely.
            pass
    hook(state, last_error)


def _galley_locked():
    # Galley-managed mode: an empty allow-list means "locked, waiting for
    # owner pairing", never public access. The agent drives the owner's
    # machine, so anyone-can-chat access must be an explicit choice ("*").
    return _GALLEY_MANAGED and not PUBLIC_ACCESS and not ALLOWED


async def _handle_owner_bind_message(update):
    """Locked mode (managed config, no owner bound yet): the only input
    that does anything is the pairing code, sent in a private chat.
    Everything else is ignored silently — wrong guesses get no reply, so
    a guesser learns nothing; too many wrong guesses invalidate the code
    entirely (reconnect from Galley issues a new one)."""
    global ALLOWED, OWNER_BIND_CODE, _owner_bind_attempts
    message = update.message
    uid = update.effective_user.id if update.effective_user else None
    if message is None or uid is None:
        return
    if not OWNER_BIND_CODE:
        print(f"等待绑定但配对码不可用，忽略消息: {uid}", flush=True)
        return
    if getattr(getattr(message, "chat", None), "type", "") != ChatType.PRIVATE:
        print(f"等待绑定，忽略非私聊消息: {uid}", flush=True)
        return
    text = (message.text or "").strip()
    if not text:
        return
    if text != OWNER_BIND_CODE:
        _owner_bind_attempts += 1
        print(f"配对码不匹配 ({_owner_bind_attempts}/{GALLEY_OWNER_BIND_ATTEMPT_LIMIT}): {uid}", flush=True)
        if _owner_bind_attempts >= GALLEY_OWNER_BIND_ATTEMPT_LIMIT:
            OWNER_BIND_CODE = None
            _emit_galley_status(
                "running",
                "Telegram owner pairing code invalidated after too many wrong attempts; "
                "reconnect from Galley to issue a new code",
            )
        return
    ALLOWED = {uid}
    OWNER_BIND_CODE = None
    _emit_galley_status("running", None, ownerOpenId=str(uid))
    await message.reply_text("✓ 已绑定为 Galley 的使用者，现在只响应你的消息。")
    print(f"已绑定 Galley owner: {uid}", flush=True)

_RETRY_AFTER_MARGIN_SECONDS = 1.0
_ASK_USER_HOOK_KEY = "telegram_ask_user_menu"
_ASK_CALLBACK_PREFIX = "ask:"
_LLM_CALLBACK_PREFIX = "llm:"
_ASK_MULTI_DONE_ACTION = "done"
_ASK_TOGGLE_ACTION = "toggle"
_ASK_MULTI_EMPTY_HINT = "请至少选择一项，或直接打字回复"
_LLM_MENU_PROMPT = "请选择要切换的 LLM："
_ask_menu_store = {}
_llm_menu_store = {}
_QUOTE_OPEN_TAG = "<_quote_>"
_QUOTE_CLOSE_TAG = "</_quote_>"
_QUOTE_TOKEN_PATTERN = re.escape(_QUOTE_OPEN_TAG) + r"([\s\S]*?)" + re.escape(_QUOTE_CLOSE_TAG)
_MD_TOKEN_RE = re.compile(
    (
        r"(`{3,})([A-Za-z0-9_+-]*)\n([\s\S]*?)\1"
        r"|" + _QUOTE_TOKEN_PATTERN +
        r"|\[([^\]]+)\]\(([^)\n]+)\)"
        r"|`([^`\n]+)`"
        r"|\*\*([^\n]+?)\*\*"
        r"|__([^\n]+?)__"
        r"|~~([^\n]+?)~~"
        r"|(?<!\*)\*(?!\*)([^\n]+?)(?<!\*)\*(?!\*)"
    ),
    re.DOTALL,
)
_CODE_FENCE_RE = re.compile(r"^\s*(`{3,})(.*)$")
_TURN_MARKER_LINE_RE = re.compile(r"^\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}[ \t]*$", re.M)
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$")
_RULE_RE = re.compile(r"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$")
_BULLET_RE = re.compile(r"^(\s*)[-*+]\s+")
_BLOCKQUOTE_RE = re.compile(r"^\s{0,3}>\s?(.*)$")
# Galley conversation UX (managed patch 0024): while a run works, its chat
# shows one live surface, a silent status message edited in place (private
# chats and groups alike, as on Discord). The run then posts exactly one
# new message, its answer, question or error, and the status message is
# deleted; a stopped run freezes it into the stop receipt instead. Private
# chats first used a sendMessageDraft preview, dropped after dogfood: the
# client reserves a streaming area for a draft and pushes the chat up,
# leaving a blank gap.
_LIVE_POLL_SECONDS = 1.0
_STATUS_EDIT_INTERVAL_SECONDS = 1.5
_SEND_ATTEMPTS = 3
_FOLD_STEP_LINES = 30
_FOLD_HEADER_BUDGET = MessageLimit.MAX_TEXT_LENGTH // 2
_ASK_BUTTON_MAX_CANDIDATES = 50
_ASK_LIST_BUTTONS_PER_ROW = 8
_ASK_QUESTION_LIMIT = 3000
_ASK_EVENT_LIMIT = 8
_NO_RUNNING_TASK_TEXT = "当前没有在跑的任务"
_clock = time.monotonic  # run timing and live pacing; injectable for tests
_RUNS = []  # every registered run in GA's task order (one agent, FIFO)
_ask_lock = threading.Lock()  # ask_user events arrive on the GA worker thread
_ask_events = {}  # display queue of the asking task -> ask_user event
_pending_asks = {}  # chat id -> _PendingAsk waiting for the owner's answer
_last_message_ids = {}  # chat id -> newest message id seen, user's or bot's
_background_tasks = set()

def _markdown_safe_segments(text, limit=None):
    limit = limit or MessageLimit.MAX_TEXT_LENGTH
    text = (text or "").strip()
    if not text:
        return []
    if len(_to_markdown_v2(text)) <= limit:
        return [text]
    parts = []
    remaining = text
    while remaining:
        if len(_to_markdown_v2(remaining)) <= limit:
            parts.append(remaining)
            break
        low, high, best = 1, len(remaining), 1
        while low <= high:
            mid = (low + high) // 2
            if len(_to_markdown_v2(remaining[:mid].rstrip() or remaining[:mid])) <= limit:
                best = mid
                low = mid + 1
            else:
                high = mid - 1
        cut = remaining.rfind("\n", 0, best)
        if cut < max(1, best * 0.6):
            cut = best
        chunk = remaining[:cut].rstrip() or remaining[:best]
        parts.append(chunk)
        remaining = remaining[len(chunk):].lstrip()
    return parts

def _quote_tag(text):
    safe_text = (text or "").strip().replace(_QUOTE_OPEN_TAG, "").replace(_QUOTE_CLOSE_TAG, "")
    return f"{_QUOTE_OPEN_TAG}{safe_text}{_QUOTE_CLOSE_TAG}"

def _resolve_files(paths):
    files, seen = [], set()
    for fpath in paths:
        if not os.path.isabs(fpath):
            fpath = os.path.join(_TEMP_DIR, fpath)
        if fpath in seen or not os.path.exists(fpath):
            continue
        files.append(fpath)
        seen.add(fpath)
    return files


def _render_file_markers(text):
    def repl(match):
        return os.path.basename(match.group(1))
    return re.sub(r"\[FILE:([^\]]+)\]", repl, text or "").strip()

def _files_from_text(text):
    cleaned = clean_reply(text) if (text or "").strip() else ""
    return _resolve_files(extract_files(cleaned))

async def _send_files(root_msg, files):
    for fpath in files:
        if fpath.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
            try:
                with open(fpath, "rb") as fp:
                    _note_message(await root_msg.reply_photo(fp, disable_notification=True))
            except Exception:
                pass
        else:
            try:
                with open(fpath, "rb") as fp:
                    _note_message(await root_msg.reply_document(fp, disable_notification=True))
            except Exception:
                pass

def _escape_pre(text):
    return escape_markdown(text or "", version=2, entity_type="pre")

def _escape_code(text):
    return escape_markdown(text or "", version=2, entity_type="code")

def _escape_link_target(text):
    return escape_markdown(text or "", version=2, entity_type="text_link")

def _quote_to_markdown_v2(text):
    lines = (text or "").strip().splitlines() or [""]
    return "\n".join(f"> {escape_markdown(line, version=2)}" for line in lines)

def _to_markdown_v2(text):
    if not text:
        return ""
    parts, pos = [], 0
    for match in _MD_TOKEN_RE.finditer(text):
        parts.append(escape_markdown(text[pos:match.start()], version=2))
        if match.group(1):
            lang = re.sub(r"[^A-Za-z0-9_+-]", "", match.group(2) or "")
            code = _escape_pre(match.group(3) or "")
            header = f"```{lang}\n" if lang else "```\n"
            parts.append(f"{header}{code}\n```")
        elif match.group(4) is not None:
            parts.append(_quote_to_markdown_v2(match.group(4)))
        elif match.group(5) is not None:
            label = escape_markdown(match.group(5), version=2)
            target = _escape_link_target(match.group(6))
            parts.append(f"[{label}]({target})")
        elif match.group(7) is not None:
            parts.append(f"`{_escape_code(match.group(7))}`")
        elif match.group(8) is not None:
            parts.append(f"*{escape_markdown(match.group(8), version=2)}*")
        elif match.group(9) is not None:
            parts.append(f"*{escape_markdown(match.group(9), version=2)}*")
        elif match.group(10) is not None:
            parts.append(f"~{escape_markdown(match.group(10), version=2)}~")
        elif match.group(11) is not None:
            parts.append(f"_{escape_markdown(match.group(11), version=2)}_")
        pos = match.end()
    parts.append(escape_markdown(text[pos:], version=2))
    return "".join(parts)

def _is_not_modified_error(exc):
    return "not modified" in str(exc).lower()

def _register_ask_user_hook():
    if not hasattr(agent, "_turn_end_hooks"):
        agent._turn_end_hooks = {}
    def _hook(ctx):
        # GA worker thread, before the task's `done`: the event is tagged with
        # the asking task's display queue, so only the run owning that task
        # claims it (a completion-reporter turn that asks is never claimed).
        event = extract_ask_user_event(ctx)
        if event is None:
            return
        with _ask_lock:
            _ask_events[getattr(agent, "_current_queue", None)] = event
            while len(_ask_events) > _ASK_EVENT_LIMIT:
                _ask_events.pop(next(iter(_ask_events)))
    agent._turn_end_hooks[_ASK_USER_HOOK_KEY] = _hook

def _build_llm_markup(menu_id, llms):
    rows = []
    for idx, name, current in llms:
        label = f"→ [{idx}] {name}" if current else f"[{idx}] {name}"
        rows.append([
            InlineKeyboardButton(label, callback_data=f"{_LLM_CALLBACK_PREFIX}{menu_id}:{idx}")
        ])
    return InlineKeyboardMarkup(rows)

def _parse_menu_callback_data(data, prefix):
    if not (data or "").startswith(prefix):
        return None, None
    payload = data[len(prefix):]
    menu_id, sep, action = payload.partition(":")
    if not sep or not menu_id or not action:
        return None, None
    return menu_id, action

def _parse_ask_callback_data(data):
    return _parse_menu_callback_data(data, _ASK_CALLBACK_PREFIX)

def _build_text_prompt(text):
    return f"{FILE_HINT}\n\n{text}"

async def _clear_ask_reply_markup(query):
    try:
        await query.edit_message_reply_markup(reply_markup=None)
    except Exception as exc:
        print(f"[TG ask_user menu cleanup] {type(exc).__name__}: {exc}", flush=True)

def _retry_after_seconds(exc):
    retry_after = getattr(exc, "_retry_after", None)
    if retry_after is None:
        retry_after = getattr(exc, "retry_after", 0) or 0
    if hasattr(retry_after, "total_seconds"):
        retry_after = retry_after.total_seconds()
    try:
        return max(0.0, float(retry_after))
    except (TypeError, ValueError):
        return 0.0

def _message_chat_id(message):
    chat_id = getattr(message, "chat_id", None)
    return chat_id if chat_id is not None else getattr(getattr(message, "chat", None), "id", None)

def _note_message(message):
    """Remember each chat's newest message id, the user's or the bot's: the
    Bot API cannot tell what landed last in a chat, and the answer's quote
    rule needs to know."""
    chat_id, message_id = _message_chat_id(message), getattr(message, "message_id", None)
    if chat_id is not None and isinstance(message_id, int) and message_id > _last_message_ids.get(chat_id, 0):
        _last_message_ids[chat_id] = message_id

def _spawn(coro):
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

def _rewrite_markdown(text):
    """Source rewrite ahead of _to_markdown_v2 for what MarkdownV2 cannot
    show: tables become lists, headings bold lines, `>` runs quote blocks,
    rules disappear, -/*/+ bullets become •. Code fences are left alone."""
    out, quote, fence = [], [], 0

    def flush_quote():
        if quote:
            out.append(_quote_tag("\n".join(quote)))
            quote.clear()

    for line in tables_to_lists(text or "").split("\n"):
        fence_match = _CODE_FENCE_RE.match(line)
        if fence:
            if fence_match and len(fence_match.group(1)) >= fence and not fence_match.group(2).strip():
                fence = 0
            out.append(line)
            continue
        quote_match = _BLOCKQUOTE_RE.match(line)
        if quote_match:
            quote.append(quote_match.group(1))
            continue
        flush_quote()
        if fence_match and "```" not in fence_match.group(2):
            fence = len(fence_match.group(1))
            out.append(line)
            continue
        heading = _HEADING_RE.match(line)
        if heading:
            title = heading.group(1).replace("**", "").strip()
            out.append(f"**{title}**" if title else "")
        elif _RULE_RE.match(line):
            out.append("")
        else:
            out.append(_BULLET_RE.sub(r"\1• ", line, count=1))
    flush_quote()
    return "\n".join(out)

def _plain_text(text):
    """What is sent when Telegram rejects the MarkdownV2: the source, with
    quote tokens shown as `>` lines."""
    def quoted(match):
        return "\n".join(f"> {line}" if line else ">" for line in match.group(1).splitlines() or [""])
    return re.sub(_QUOTE_TOKEN_PATTERN, quoted, text or "")

def _md_segments(source, first_limit=None):
    """(markdown_v2, plain) message parts of already rewritten Markdown; the
    first part also fits first_limit, leaving room for a header on top."""
    source = (source or "").strip()
    if not source:
        return []
    parts = _markdown_safe_segments(source, first_limit)
    if first_limit and len(parts) > 1:
        parts = parts[:1] + _markdown_safe_segments(source[len(parts[0]):])
    return [(_to_markdown_v2(part), _plain_text(part)) for part in parts]

def markdown_v2_segments(text):
    """Split Markdown `text` for sending as Telegram messages: a list of
    (markdown_v2, plain) pairs, each within MessageLimit.MAX_TEXT_LENGTH once
    converted. Applies the same Markdown rewrite as answers (tables to lists,
    headings to bold lines, …) before conversion. `plain` is the fallback the
    caller sends without parse_mode when Telegram rejects the MarkdownV2."""
    return _md_segments(_rewrite_markdown(text))

def _file_names(text):
    """[FILE:path] markers shown as file names, and nothing else touched:
    the transcript cleaning drops markers, so names go in before it (and
    its tool-echo strip needs the step's trailing newline intact)."""
    return re.sub(r"\[FILE:([^\]]+)\]", lambda match: os.path.basename(match.group(1)), text or "")

def _answer_from(step_text, raw):
    """A finished task's answer: its closing step cleaned (dcapp's
    cleaning), else the whole transcript, with file names shown."""
    return answer_body(_file_names(step_text), _file_names(raw))

def answer_text(raw):
    """User-visible answer of a finished task's full `done` text: the closing
    step only (split on the `LLM Running (Turn N) ...` marker lines; tool
    echoes, tool output and tags stripped, same cleaning as a live answer),
    [FILE:] markers rendered as file names. Returns "" when nothing visible
    remains."""
    raw = raw or ""
    markers = list(_TURN_MARKER_LINE_RE.finditer(raw))
    return _answer_from(raw[markers[-1].start():] if markers else raw, raw)

def _fold_header(run, steps, seconds):
    """(markdown_v2, plain) header over the run's answer: an expandable
    quote opening with the desktop fold header `N 步 · 用时 X`, then one
    `NN summary` line per step (the last 30). Empty for 0 steps."""
    if steps < 1:
        return "", ""
    label = fold_label(steps, seconds)
    for width in (0, 60, 24):  # long step lines give way before the answer does
        lines = [f"{n:02d} {run.summaries.get(n, '')}".rstrip() for n in range(1, steps + 1)]
        if width:
            lines = [clip(line, width) for line in lines]
        if len(lines) > _FOLD_STEP_LINES:
            lines = [f"… 前 {len(lines) - _FOLD_STEP_LINES} 步略"] + lines[-_FOLD_STEP_LINES:]
        quoted = [f"**>{escape_markdown(label, version=2)}"]
        quoted += [f">{escape_markdown(line, version=2)}" for line in lines]
        markdown = "\n".join(quoted) + "||"
        if len(markdown) <= _FOLD_HEADER_BUDGET:
            break
    return markdown, "\n".join([label, *lines])

class _LiveSurface:
    """A run's live window in its chat: a silent status message edited in
    place. Closed once the run's message is out, or for good when the
    status message cannot be sent."""

    def __init__(self, message):
        self.message = message  # the run's trigger: live output goes to its chat
        self.anchor = message  # an answer right below it needs no quote
        self.status_msg = None
        self.closed = False
        self.text = self.sent_at = None
        self.retry_until = 0.0

class _TgRun:
    """One run: a GA task, plus the ask_user segments it continues. _RUNS
    lists every run in GA's task order; its head is the task GA is on (or
    gets next). States: queued / running / asking / done / stopped / error."""

    def __init__(self, trigger, carry=None, answers_ask=False):
        self.trigger = trigger
        self.chat_id = _message_chat_id(trigger)
        self.loop = asyncio.get_running_loop()
        self.state = "queued"
        self.dq = self.error = None
        self.answers_ask, self.adopted = answers_ask, carry is not None
        self.base_steps, self.base_elapsed, self.summaries = 0, 0.0, {}
        self.adopt(carry)
        self.task_turn = 0  # highest GA turn seen in this run's task
        self.turn_texts = {}
        self.started_at = self.step_started_at = self.ended_at = None
        self.live = _LiveSurface(trigger)
        self.lock = asyncio.Lock()  # live-surface writes vs. terminal messages
        self.wake = asyncio.Event()

    def adopt(self, carry):
        """Continue an ask_user-paused run: step numbers, summaries and
        elapsed time add up across segments; the wait for the answer does
        not count."""
        if carry:
            self.base_steps = int(carry.get("steps") or 0)
            self.base_elapsed = float(carry.get("elapsed") or 0.0)
            self.summaries = dict(carry.get("summaries") or {})

    def settled_steps(self):
        return self.base_steps + max(0, self.task_turn - 1)

    def total_steps(self):
        return self.base_steps + self.task_turn

    def elapsed(self, now):
        if self.started_at is None:
            return self.base_elapsed
        return self.base_elapsed + max(0.0, now - self.started_at)

    def carry(self, now):
        return {"steps": self.total_steps(), "elapsed": self.elapsed(now), "summaries": dict(self.summaries)}

    def start(self, now):
        self.state = "running"
        self.started_at = self.step_started_at = now

    def observe(self, item, now):
        """Fold one display-queue item in. `next` text is incremental
        (inc_out) but `outputs` carries whole step texts: [previous, current]
        on `next`, every step on `done`. Step k settles when an item for a
        later turn arrives (the desktop's turn_end: its tools have run), and
        `done` settles the last one. Returns `done`'s per-step texts."""
        outputs = item.get("outputs")
        outputs = [str(text or "") for text in outputs] if isinstance(outputs, list) else []
        turn = item.get("turn") if isinstance(item.get("turn"), int) else 0
        if "done" in item:
            self.turn_texts.update(enumerate(outputs, 1))
            turn = max(turn, len(outputs), self.task_turn)
        elif turn > 0 and outputs:
            self.turn_texts[turn] = outputs[-1]
            if len(outputs) > 1 and turn > 1:
                self.turn_texts[turn - 1] = outputs[-2]
        if turn > self.task_turn:
            for k in range(max(1, self.task_turn), turn):
                self.summaries[self.base_steps + k] = step_summary(self.turn_texts.get(k, ""))
            self.task_turn, self.step_started_at = turn, now
        if "done" in item:
            for k in range(1, self.task_turn + 1):
                self.summaries[self.base_steps + k] = step_summary(self.turn_texts.get(k, ""))
        return outputs

def _chat_runs(chat_id):
    return [run for run in _RUNS if run.chat_id == chat_id]

def _is_waiting(run):
    """Registered, but GA is not on its task yet: a run ahead of it, or a
    task Galley's completion reporter put straight into the agent."""
    if run.started_at is not None:
        return False
    if not _RUNS or _RUNS[0] is not run:
        return True
    return bool(getattr(agent, "is_running", False)) and getattr(agent, "_current_queue", None) is not run.dq

def _live_text(run, now):
    lines = []
    settled = run.settled_steps()
    if settled >= 1:
        lines.append(f"{settled:02d} {run.summaries.get(settled, '')}".rstrip())
    if _is_waiting(run):
        lines.append("·· 排队中")
    elif run.step_started_at is None:  # GA has not begun the task: no step to time yet
        lines.append("·· 思考中")
    else:
        lines.append("·· 思考中" + still_running_suffix(now - run.step_started_at))
    runs = _chat_runs(run.chat_id)
    behind = len(runs) - runs.index(run) - 1 if run in runs else 0
    if behind > 0:
        lines.append(f"另有 {behind} 条消息排队中")
    return "\n".join(lines)

def _live_due(live, text, now):
    """Sent once, then edited only when its text changed, at least 1.5 s
    apart (changes in between merge into the next edit)."""
    if live.sent_at is None:
        return True
    return text != live.text and now - live.sent_at >= _STATUS_EDIT_INTERVAL_SECONDS

async def _flush_live(run):
    """Bring the run's status message up to date, when an edit is due."""
    async with run.lock:
        live = run.live
        if run.state not in ("queued", "running") or live.closed:
            return
        now = _clock()
        if now < live.retry_until:
            return
        text = _live_text(run, now)
        if not _live_due(live, text, now):
            return
        try:
            if live.status_msg is None:
                below = not _should_quote(run)  # nothing landed after the trigger yet
                live.status_msg = await live.message.reply_text(text, disable_notification=True)
                _note_message(live.status_msg)
                if below:
                    live.anchor = live.status_msg
            else:
                await live.status_msg.edit_text(text)
        except RetryAfter as exc:
            live.retry_until = now + _retry_after_seconds(exc) + _RETRY_AFTER_MARGIN_SECONDS
            return
        except Exception as exc:
            if not _is_not_modified_error(exc):
                print(f"[TG live surface error] {type(exc).__name__}: {exc}", flush=True)
                if live.status_msg is None:
                    live.closed = True  # no live surface for this run; its message still lands
                    return
        live.text, live.sent_at = text, now

async def _retire_live(run, fallback):
    """The run's message is out: delete its status message, or, when
    Telegram refuses, edit it so it stops claiming the run is working."""
    live = run.live
    live.closed = True
    msg, live.status_msg = live.status_msg, None
    if msg is None:
        return
    try:
        await msg.delete()
    except Exception as exc:
        print(f"[TG status delete error] {type(exc).__name__}: {exc}", flush=True)
        try:
            await msg.edit_text(fallback)
        except Exception as edit_exc:
            print(f"[TG status fallback error] {type(edit_exc).__name__}: {edit_exc}", flush=True)

def _should_quote(run):
    """Quote the trigger only when something landed in the chat after it;
    right below it, a reply needs no quote. The run's status message stands
    in for the trigger when it went out right below it (a queued run's can
    land after other messages, and then does not)."""
    anchor_id = getattr(run.live.anchor, "message_id", None)
    last = _last_message_ids.get(run.chat_id)
    return isinstance(anchor_id, int) and isinstance(last, int) and last > anchor_id

async def _reply(target, text, **kwargs):
    """reply_text that waits out RetryAfter (a run's message must land) and
    notes the sent message for the quote rule."""
    for attempt in range(_SEND_ATTEMPTS):
        try:
            message = await target.reply_text(text, **kwargs)
        except RetryAfter as exc:
            if attempt + 1 >= _SEND_ATTEMPTS:
                raise
            await asyncio.sleep(_retry_after_seconds(exc) + _RETRY_AFTER_MARGIN_SECONDS)
            continue
        _note_message(message)
        return message

async def _reply_markdown(target, markdown, plain, **kwargs):
    """Send as MarkdownV2; when Telegram rejects it, send the plain text."""
    try:
        return await _reply(target, markdown, parse_mode=ParseMode.MARKDOWN_V2, **kwargs)
    except RetryAfter:
        raise
    except Exception as exc:
        print(f"[TG markdown fallback] {type(exc).__name__}: {exc}", flush=True)
        return await _reply(target, plain, **kwargs)

async def _send_answer(run, raw, step_text, steps, seconds):
    """The run's one pushed message: the fold header, a blank line, then the
    closing step's text. Further parts and the files arrive silently."""
    files = _files_from_text(raw)
    body = _answer_from(step_text, raw) or ("已生成附件" if files else "")
    header, header_plain = _fold_header(run, steps, seconds)
    first_limit = MessageLimit.MAX_TEXT_LENGTH - len(header) - 2 if header else None
    parts = _md_segments(_rewrite_markdown(body), first_limit)
    if header:
        markdown, plain = parts[0] if parts else ("", "")
        parts[:1] = [(
            f"{header}\n\n{markdown}" if markdown else header,
            f"{header_plain}\n\n{plain}" if plain else header_plain,
        )]
    quote = _should_quote(run)
    for i, (markdown, plain) in enumerate(parts or [(escape_markdown("...", version=2), "...")]):
        await _reply_markdown(run.trigger, markdown, plain, do_quote=quote and i == 0, disable_notification=i > 0)
    await _send_files(run.trigger, files)

class _PendingAsk:
    """A posted ask_user question waiting for the owner: a button click, or
    the next plain text message in the chat, answers it."""

    def __init__(self, chat_id, event, carry, narration):
        self.menu_id = uuid.uuid4().hex[:16]
        self.chat_id, self.event, self.carry, self.narration = chat_id, event, carry, narration
        self.layout = _ask_layout(event)
        self.steps = carry["steps"]
        self.selected = set()
        self.message = None

def _ask_layout(event):
    """none: no candidates, answered by typing; row: one full-text button per
    row; list: numbered in the text, number buttons; text: numbered, no
    buttons (more than 50 candidates). Multi-select keeps row / list, with
    toggles and a 提交 button."""
    candidates = event["candidates"]
    if not candidates:
        return "none"
    if len(candidates) > _ASK_BUTTON_MAX_CANDIDATES:
        return "text"
    return candidate_layout(candidates)

def _ask_markup(pending):
    if pending.layout not in ("row", "list"):
        return None
    multi = bool(pending.event.get("multi"))
    buttons = []
    for i, candidate in enumerate(pending.event["candidates"]):
        label = one_line(candidate) if pending.layout == "row" else str(i + 1)
        if multi and i in pending.selected:
            label = f"✓ {label}"
        action = f"{_ASK_TOGGLE_ACTION}:{i}" if multi else str(i)
        buttons.append(InlineKeyboardButton(label, callback_data=f"{_ASK_CALLBACK_PREFIX}{pending.menu_id}:{action}"))
    width = 1 if pending.layout == "row" else _ASK_LIST_BUTTONS_PER_ROW
    rows = [buttons[i:i + width] for i in range(0, len(buttons), width)]
    if multi:
        rows.append([InlineKeyboardButton(
            "提交", callback_data=f"{_ASK_CALLBACK_PREFIX}{pending.menu_id}:{_ASK_MULTI_DONE_ACTION}",
        )])
    return InlineKeyboardMarkup(rows)

def _ask_text(pending, echo=False, chosen=()):
    """(markdown_v2, plain) of the question message, or of its echo once
    answered: chosen candidates ticked, the rest italic; a typed answer
    ticks nothing."""
    markdown, plain = [], []

    def add(text, italic=False):
        escaped = escape_markdown(text, version=2)
        markdown.append(f"_{escaped}_" if italic else escaped)
        plain.append(text)

    add(f"{'已回复' if echo else '⏸ 等你回复'} · 已完成 {pending.steps} 步", italic=True)
    if pending.narration:
        source = _rewrite_markdown(pending.narration)
        markdown.append(_to_markdown_v2(source))
        plain.append(_plain_text(source))
    add(clip(pending.event["question"], _ASK_QUESTION_LIMIT))  # keeps single newlines: GA's question is plain text
    numbered = pending.layout in ("list", "text")
    for i, candidate in enumerate(pending.event["candidates"]):
        label = f"{i + 1}. {one_line(candidate)}" if numbered else one_line(candidate)
        if echo:
            add(f"✓ {label}" if i in chosen else label, italic=i not in chosen)
        elif numbered:
            add(label)
    if not echo and pending.event.get("multi") and pending.layout in ("row", "list"):
        add("多选：点选后按「提交」，也可以直接打字回复", italic=True)
    return "\n".join(markdown), "\n".join(plain)

async def _post_ask(run, event, narration, carry):
    """Pause for the owner's answer: a new, pushed question message. The step
    count and the clock wait in the pending question for the run that
    answers it."""
    pending = _PendingAsk(run.chat_id, event, carry, narration)
    quote = _should_quote(run)
    markdown, plain = _ask_text(pending)
    if len(markdown) > MessageLimit.MAX_TEXT_LENGTH and narration:
        # A long narration goes first, silently, so the question and its
        # buttons stay one message.
        for i, (part, part_plain) in enumerate(_md_segments(_rewrite_markdown(narration))):
            await _reply_markdown(run.trigger, part, part_plain, do_quote=quote and i == 0, disable_notification=True)
        quote, pending.narration = False, ""
        markdown, plain = _ask_text(pending)
    markup = _ask_markup(pending)
    if len(markdown) > MessageLimit.MAX_TEXT_LENGTH:
        pending.message = await _reply(
            run.trigger, clip(plain, MessageLimit.MAX_TEXT_LENGTH), reply_markup=markup, do_quote=quote,
        )
    else:
        pending.message = await _reply_markdown(run.trigger, markdown, plain, reply_markup=markup, do_quote=quote)
    await _drop_pending_ask(run.chat_id)
    _pending_asks[run.chat_id] = pending
    _ask_menu_store[pending.menu_id] = pending
    print(
        f"[TG ask_user] posted: chat={run.chat_id} candidates={len(event['candidates'])} layout={pending.layout}",
        flush=True,
    )

def _forget_pending(pending):
    _ask_menu_store.pop(pending.menu_id, None)
    if _pending_asks.get(pending.chat_id) is pending:
        _pending_asks.pop(pending.chat_id, None)

async def _drop_pending_ask(chat_id):
    """The chat's pending question loses its buttons and carried step count."""
    pending = _pending_asks.get(chat_id)
    if pending is None:
        return
    _forget_pending(pending)
    edit = getattr(pending.message, "edit_reply_markup", None)
    if edit is not None:
        try:
            await edit(reply_markup=None)
        except Exception as exc:
            print(f"[TG ask_user cleanup] {type(exc).__name__}: {exc}", flush=True)

async def _edit_ask_echo(pending, chosen=(), query=None):
    """Edit the question into its echo and drop its buttons."""
    markdown, plain = _ask_text(pending, echo=True, chosen=chosen)
    edit = query.edit_message_text if query is not None else getattr(pending.message, "edit_text", None)
    if edit is None:
        return
    if len(markdown) <= MessageLimit.MAX_TEXT_LENGTH:
        try:
            await edit(markdown, parse_mode=ParseMode.MARKDOWN_V2, reply_markup=None)
            return
        except Exception as exc:
            if _is_not_modified_error(exc):
                return
            print(f"[TG ask_user echo fallback] {type(exc).__name__}: {exc}", flush=True)
    try:
        await edit(clip(plain, MessageLimit.MAX_TEXT_LENGTH), reply_markup=None)
    except Exception as exc:
        print(f"[TG ask_user echo error] {type(exc).__name__}: {exc}", flush=True)

async def _adopt_pending_ask(run):
    """ask_user does not cut the run (desktop, 2026-09-18): a typed message
    answers the chat's pending question and continues its step count and
    clock. The question becomes an echo with nothing ticked."""
    run.adopted = True
    pending = _pending_asks.get(run.chat_id)
    if pending is None:
        return
    _forget_pending(pending)
    run.adopt(pending.carry)
    await _edit_ask_echo(pending)
    print(f"[TG ask_user] answered by message: chat={run.chat_id}", flush=True)

def _take_ask_event(dq):
    with _ask_lock:
        if dq is not None and dq in _ask_events:
            return _ask_events.pop(dq)
        return _ask_events.pop(None, None)

async def _finish_run(run, raw, outputs):
    async with run.lock:
        if run.state != "running":
            return  # stopped while its `done` was on the way
        now = _clock()
        run.ended_at = now
        step_text = final_step_text(raw, outputs)
        event = _take_ask_event(run.dq)
        if event is not None:
            run.state = "asking"
            await _post_ask(run, event, visible_text(_file_names(step_text)), run.carry(now))
            await _retire_live(run, "⏸ 等你回复")
            await _send_files(run.trigger, _files_from_text(raw))
            return
        run.state = "done"
        await _send_answer(run, raw, step_text, run.total_steps(), run.elapsed(now))
        await _retire_live(run, "✓ 已完成")

async def _fail_run(run, error):
    """A frontend failure (a GA backend error is part of `done`): a new
    message, italic `N 步 · 用时 X` over `❌ 出错：…`."""
    async with run.lock:
        if run.state == "stopped":
            return
        run.state = "error"
        label = fold_label(run.total_steps(), run.elapsed(run.ended_at or _clock()))
        text = f"❌ 出错：{error}"
        markdown = escape_markdown(text, version=2)
        if label:
            markdown, text = f"_{escape_markdown(label, version=2)}_\n{markdown}", f"{label}\n{text}"
        try:
            await _reply_markdown(run.trigger, markdown, text, do_quote=_should_quote(run))
        except Exception as exc:
            print(f"[TG run error notice] {type(exc).__name__}: {exc}", flush=True)
        finally:
            await _retire_live(run, "❌ 出错")

def _mark_stopped(run):
    # Synchronous on purpose: callers mark the run before anything awaits,
    # so its display loop can never turn the aborted task's `done` into an
    # answer.
    run.state, run.ended_at = "stopped", _clock()
    run.wake.set()

async def _post_stopped(run):
    """The stop receipt `⏹ 已停止 · N 步 · 用时 X`: the run's status message
    is frozen into it and stays; a new message only when there is none (or
    the edit fails)."""
    async with run.lock:
        text = stopped_text(run.total_steps(), run.elapsed(run.ended_at or _clock()))
        live = run.live
        if live.status_msg is not None:
            try:
                await live.status_msg.edit_text(text)
                live.status_msg, live.closed = None, True
                return
            except Exception as exc:
                print(f"[TG stop receipt edit error] {type(exc).__name__}: {exc}", flush=True)
        try:
            await _reply(run.trigger, text, do_quote=_should_quote(run))
        except Exception as exc:
            print(f"[TG stop receipt error] {type(exc).__name__}: {exc}", flush=True)
        await _retire_live(run, text)

def _running_run():
    """The user run GA is working on, or None -- also while GA runs a
    completion-reporter turn or sits between tasks, when /stop must abort
    nothing."""
    run = _RUNS[0] if _RUNS else None
    if run is None or run.state != "running" or not getattr(agent, "is_running", False):
        return None
    current = getattr(agent, "_current_queue", None)
    return run if current is None or current is run.dq else None

def _call_noting_abort(fn, *args):
    """Call a command helper that resets the conversation on some paths only
    (upstream /continue n aborts for a valid index alone); return its result
    and whether it aborted a running task."""
    hits, original, own = [], agent.abort, "abort" in vars(agent)

    def abort(*a, **kw):
        hits.append(bool(getattr(agent, "is_running", False)))
        return original(*a, **kw)

    agent.abort = abort
    try:
        return fn(*args), bool(hits), any(hits)
    finally:
        if own:
            agent.abort = original
        else:
            del agent.abort

def _enqueue_run(trigger, prompt, carry=None, answers_ask=False):
    """Register a run and hand its task to GA at once, so _RUNS and GA's
    task queue keep the same order."""
    loop = asyncio.get_running_loop()
    _RUNS[:] = [run for run in _RUNS if run.loop is loop]  # a polling restart leaves dead runs behind
    run = _TgRun(trigger, carry, answers_ask)
    _RUNS.append(run)
    try:
        run.dq = agent.put_task(prompt, source="telegram")
    except Exception as exc:
        run.error = exc
    print(f"[TG run] queued: chat={run.chat_id} position={len(_RUNS)} continued={carry is not None}", flush=True)
    _spawn(_drive_run(run))
    return run

async def _wait_for_turn(run):
    """Only the head of _RUNS reads its display queue, so each run's answer or
    question lands before the next run starts (items wait in the queue).
    Meanwhile a chat's first run keeps the chat's live surface."""
    while run.state == "queued" and run in _RUNS and _RUNS[0] is not run:
        if _chat_runs(run.chat_id)[0] is run:
            await _flush_live(run)
        run.wake.clear()
        try:
            await asyncio.wait_for(run.wake.wait(), _LIVE_POLL_SECONDS)
        except asyncio.TimeoutError:
            pass

async def _drive_run(run):
    try:
        if run.error is not None:
            raise run.error
        if run.answers_ask and _RUNS and _RUNS[0] is run:
            await _adopt_pending_ask(run)
        await _wait_for_turn(run)
        if run.answers_ask and not run.adopted and run.state == "queued":
            await _adopt_pending_ask(run)
        await _flush_live(run)
        while run.state in ("queued", "running"):
            try:
                item = await asyncio.to_thread(run.dq.get, True, _LIVE_POLL_SECONDS)
            except Q.Empty:
                await _flush_live(run)
                continue
            if run.state not in ("queued", "running"):
                break
            now = _clock()
            if run.started_at is None:
                run.start(now)
            outputs = run.observe(item, now)
            if "done" in item:
                await _finish_run(run, str(item.get("done") or ""), outputs)
                break
            await _flush_live(run)
    except Exception as exc:
        print(f"[TG run error] {type(exc).__name__}: {exc}", flush=True)
        await _fail_run(run, exc)
    finally:
        if run in _RUNS:
            _RUNS.remove(run)
        for other in _RUNS:
            other.wake.set()

def _normalized_command(text):
    parts = (text or "").strip().split(None, 1)
    if not parts: return ''
    head = parts[0].lower()
    if head.startswith('/'): head = '/' + head[1:].split('@', 1)[0]
    return head + (f" {parts[1].strip()}" if len(parts) > 1 and parts[1].strip() else '')

async def _sync_commands(application):
    await application.bot.set_my_commands([BotCommand(command, description) for command, description in TELEGRAM_MENU_COMMANDS])

async def _reply_command_text(message, text):
    for segment in _markdown_safe_segments(text) or ["..."]:
        try:
            await message.reply_text(_to_markdown_v2(segment), parse_mode=ParseMode.MARKDOWN_V2)
        except Exception as exc:
            print(f"[TG command markdown fallback] {type(exc).__name__}: {exc}", flush=True)
            await message.reply_text(segment)

def _review_command_body(cmd):
    cmd = (cmd or "").strip()
    if cmd == "/review":
        return ""
    if cmd.startswith("/review "):
        return cmd[len("/review"):].strip()
    return ""

async def _handle_review_command(update, ctx, cmd):
    dq = Q.Queue()
    prompt = handle_review_command(agent, _review_command_body(cmd), dq)
    if not prompt:
        try:
            item = dq.get_nowait()
            return await _reply_command_text(update.message, item.get("done", ""))
        except Q.Empty:
            return await _reply_command_text(update.message, "(review 无输出)")
    _enqueue_run(update.message, prompt)

async def handle_msg(update, ctx):
    uid = update.effective_user.id
    if _galley_locked():
        return await _handle_owner_bind_message(update)
    if ALLOWED and uid not in ALLOWED:
        return await update.message.reply_text("no")
    prompt = _build_text_prompt(update.message.text)
    _note_message(update.message)
    # With a question pending in the chat, this message is its answer.
    _enqueue_run(update.message, prompt, answers_ask=True)

async def handle_ask_callback(update, ctx):
    query = update.callback_query
    if query is None:
        return
    uid = update.effective_user.id if update.effective_user else None
    if _galley_locked():
        return await query.answer()
    if ALLOWED and uid not in ALLOWED:
        return await query.answer("no", show_alert=True)
    menu_id, action = _parse_ask_callback_data(query.data)
    pending = _ask_menu_store.get(menu_id) if menu_id else None
    if pending is None:
        # Answered, expired, or left over from an earlier process: acknowledge
        # quietly and drop the buttons; nothing runs.
        await query.answer()
        return await _clear_ask_reply_markup(query)
    candidates = pending.event["candidates"]
    multi = bool(pending.event.get("multi"))
    if multi and action.startswith(f"{_ASK_TOGGLE_ACTION}:"):
        try:
            selected_idx = int(action.split(":", 1)[1])
        except ValueError:
            selected_idx = -1
        if not 0 <= selected_idx < len(candidates):
            return await query.answer()
        pending.selected ^= {selected_idx}
        await query.answer()
        try:
            await query.edit_message_reply_markup(reply_markup=_ask_markup(pending))
        except Exception as exc:
            if not _is_not_modified_error(exc):
                print(f"[TG ask_user toggle] {type(exc).__name__}: {exc}", flush=True)
        return
    if multi and action == _ASK_MULTI_DONE_ACTION:
        if not pending.selected:
            return await query.answer(_ASK_MULTI_EMPTY_HINT, show_alert=True)
        chosen = sorted(pending.selected)
        answer = "；".join(candidates[idx] for idx in chosen)
    else:
        try:
            selected_idx = int(action)
        except ValueError:
            selected_idx = -1
        if multi or not 0 <= selected_idx < len(candidates):
            return await query.answer()
        chosen, answer = [selected_idx], candidates[selected_idx]
    _forget_pending(pending)
    await query.answer()
    await _edit_ask_echo(pending, chosen, query=query)
    print(f"[TG ask_user] answered by button: chat={pending.chat_id} chosen={len(chosen)}", flush=True)
    # The continuation's trigger is the question; an inaccessible-message
    # stub (no reply methods) falls back to the question message as sent.
    trigger = query.message if hasattr(query.message, "reply_text") else pending.message
    if trigger is not None:
        _enqueue_run(trigger, _build_text_prompt(answer), carry=pending.carry)

async def _send_llm_menu(message):
    llms = agent.list_llms()
    if not llms:
        return await message.reply_text("没有可用模型。")
    menu_id = uuid.uuid4().hex[:16]
    _llm_menu_store[menu_id] = [idx for idx, _, _ in llms]
    lines = [f"{'→' if cur else '  '} [{idx}] {name}" for idx, name, cur in llms]
    try:
        await message.reply_text(
            _LLM_MENU_PROMPT,
            reply_markup=_build_llm_markup(menu_id, llms),
        )
    except Exception as exc:
        _llm_menu_store.pop(menu_id, None)
        print(f"[TG llm menu error] {type(exc).__name__}: {exc}", flush=True)
        await message.reply_text("LLMs:\n" + "\n".join(lines))

async def handle_llm_callback(update, ctx):
    query = update.callback_query
    if query is None:
        return
    uid = update.effective_user.id if update.effective_user else None
    if _galley_locked():
        return await query.answer()
    if ALLOWED and uid not in ALLOWED:
        return await query.answer("no", show_alert=True)
    menu_id, action = _parse_menu_callback_data(query.data, _LLM_CALLBACK_PREFIX)
    if not menu_id:
        return await query.answer("菜单无效")
    valid_indexes = _llm_menu_store.get(menu_id)
    if valid_indexes is None:
        await query.answer("菜单已过期")
        return await _clear_ask_reply_markup(query)
    try:
        selected_idx = int(action)
    except (TypeError, ValueError):
        return await query.answer("菜单无效")
    if selected_idx not in valid_indexes:
        return await query.answer("菜单已过期", show_alert=True)
    try:
        agent.next_llm(selected_idx)
        selected_name = agent.get_llm_name()
    except Exception as exc:
        return await query.answer(f"切换失败: {exc}", show_alert=True)
    _llm_menu_store.pop(menu_id, None)
    await query.answer(f"已切换到 [{selected_idx}] {selected_name}")
    await query.edit_message_text(f"✅ 已切换到 [{selected_idx}] {selected_name}")

async def cmd_abort(update, ctx):
    # Stops the running run only: queued runs stay, and the run's stop
    # receipt is the only reply.
    run = _running_run()
    if run is None:
        return await update.message.reply_text(_NO_RUNNING_TASK_TEXT)
    _mark_stopped(run)
    agent.abort()
    print(f"[TG run] stopped by command: chat={run.chat_id}", flush=True)
    await _post_stopped(run)

async def cmd_llm(update, ctx):
    args = (update.message.text or '').split()
    if len(args) > 1:
        try:
            n = int(args[1])
            agent.next_llm(n)
            await update.message.reply_text(f"✅ 已切换到 [{agent.llm_no}] {agent.get_llm_name()}")
        except (ValueError, IndexError):
            await update.message.reply_text(f"用法: /llm <0-{len(agent.list_llms())-1}>")
    else:
        await _send_llm_menu(update.message)

async def handle_photo(update, ctx):
    uid = update.effective_user.id
    if _galley_locked():
        return await _handle_owner_bind_message(update)
    if ALLOWED and uid not in ALLOWED: return await update.message.reply_text("no")
    if update.message.photo:
        photo = update.message.photo[-1]
        file = await photo.get_file()
        fpath = f"tg_{photo.file_unique_id}.jpg"
        kind = "图片"
    elif update.message.document:
        doc = update.message.document
        file = await doc.get_file()
        ext = os.path.splitext(doc.file_name or '')[1] or ''
        fpath = f"tg_{doc.file_unique_id}{ext}"
        kind = "文件"
    else: return
    await file.download_to_drive(os.path.join(_TEMP_DIR, fpath))
    caption = update.message.caption
    prompt = f"[TIPS] 收到{kind}temp/{fpath}\n{caption}" if caption else f"[TIPS] 收到{kind}temp/{fpath}，请等待下一步指令"
    _note_message(update.message)
    _enqueue_run(update.message, prompt)

async def handle_command(update, ctx):
    uid = update.effective_user.id
    if _galley_locked():
        return await _handle_owner_bind_message(update)
    if ALLOWED and uid not in ALLOWED:
        return await update.message.reply_text("no")
    cmd = _normalized_command(update.message.text)
    op = cmd.split()[0] if cmd else ''
    chat_id = _message_chat_id(update.message)
    _note_message(update.message)
    if op == '/help': return await update.message.reply_text(HELP_TEXT)
    if op == '/status':
        llm = agent.get_llm_name() if agent.llmclient else '未配置'
        return await update.message.reply_text(f"状态: {'🔴 运行中' if agent.is_running else '🟢 空闲'}\nLLM: [{agent.llm_no}] {llm}")
    if op == '/stop': return await cmd_abort(update, ctx)
    if op == '/llm': return await cmd_llm(update, ctx)
    if op == '/btw':
        answer = await asyncio.to_thread(handle_btw_frontend_command, agent, cmd)
        return await _reply_command_text(update.message, answer)
    if op == '/review':
        return await _handle_review_command(update, ctx, cmd)
    # /new, /restore and /continue n abort the running run's task: that run
    # ends as stopped (marked before anything awaits); queued runs go on.
    if op == '/new':
        run = _running_run()
        if run is not None:
            _mark_stopped(run)
        reply = reset_conversation(agent)
        await _drop_pending_ask(chat_id)
        if run is not None:
            await _post_stopped(run)
        return await update.message.reply_text(reply)
    if op == '/restore':
        try:
            restored_info, err = format_restore()
            if err:
                return await update.message.reply_text(err)
            restored, fname, count = restored_info
            run = _running_run()
            if run is not None:
                _mark_stopped(run)
            agent.abort()
            agent.history.extend(restored)
            await _drop_pending_ask(chat_id)
            if run is not None:
                await _post_stopped(run)
            return await update.message.reply_text(f"✅ 已恢复 {count} 轮对话\n来源: {fname}\n(仅恢复上下文，请输入新问题继续)")
        except Exception as e:
            return await update.message.reply_text(f"❌ 恢复失败: {e}")
    if op == '/continue':
        if cmd == '/continue':
            return await update.message.reply_text(handle_frontend_command(agent, cmd))
        run = _running_run()
        reply, reset, aborted = _call_noting_abort(handle_frontend_command, agent, cmd)
        if run is not None and aborted:
            _mark_stopped(run)
        if reset:
            await _drop_pending_ask(chat_id)
        if run is not None and aborted:
            await _post_stopped(run)
        return await update.message.reply_text(reply)
    return await update.message.reply_text(HELP_TEXT)

def check_config(init_agent=False):
    return {"ready": bool(BOT_TOKEN)}


def main():
    if not _GALLEY_MANAGED and not ALLOWED:
        print('[Telegram] ERROR: tg_allowed_users in mykey.py is empty or missing. Set it to avoid unauthorized access.')
        return 1
    require_runtime(agent, "Telegram", tg_bot_token=BOT_TOKEN)
    _register_ask_user_hook()
    threading.Thread(target=agent.run, daemon=True).start()
    proxy = mykeys.get('proxy')
    if proxy:
        print('proxy:', proxy)
    else:
        print('proxy: <disabled>')

    async def _error_handler(update, context: ContextTypes.DEFAULT_TYPE):
        print(f"[{time.strftime('%m-%d %H:%M')}] TG error: {context.error}", flush=True)

    async def _galley_post_init(application):
        # post_init runs after Application.initialize(), i.e. after the bot
        # token has been accepted by getMe — the earliest reliable "we are
        # actually connected" point for a polling bot.
        global _galley_connected_once
        await _sync_commands(application)
        first_connect = not _galley_connected_once
        _galley_connected_once = True
        if first_connect:
            username = getattr(application.bot, "username", "") or ""
            _emit_galley_status("running", None, botId=str(username))
        else:
            _emit_galley_status("running")

    startup_failures = 0
    while True:
        try:
            print(f"TG bot starting... {time.strftime('%m-%d %H:%M')}")
            # Recreate request and app objects on each restart to avoid stale connections
            request_kwargs = dict(read_timeout=30, write_timeout=30, connect_timeout=30, pool_timeout=30)
            if proxy:
                request_kwargs['proxy'] = proxy
            request = HTTPXRequest(**request_kwargs)
            app = (ApplicationBuilder().token(BOT_TOKEN)
                   .request(request).get_updates_request(request).post_init(_galley_post_init).build())
            app.add_handler(CallbackQueryHandler(handle_ask_callback, pattern=r"^ask:"))
            app.add_handler(CallbackQueryHandler(handle_llm_callback, pattern=r"^llm:"))
            app.add_handler(MessageHandler(filters.COMMAND, handle_command))
            app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
            app.add_handler(MessageHandler(filters.Document.ALL, handle_photo))
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_msg))
            app.add_error_handler(_error_handler)
            app.run_polling(drop_pending_updates=True, poll_interval=1.0, timeout=30)
        except Exception as e:
            print(f"[{time.strftime('%m-%d %H:%M')}] polling crashed: {e}", flush=True)
            if isinstance(e, InvalidToken):
                _emit_galley_status("error", f"Telegram bot token rejected: {e}")
                return 1
            if not _galley_connected_once:
                startup_failures += 1
                if startup_failures >= GALLEY_STARTUP_FAILURE_LIMIT:
                    _emit_galley_status("error", str(e))
                    return 1
            _emit_galley_status("reconnecting", str(e))
            time.sleep(10)
            asyncio.set_event_loop(asyncio.new_event_loop())


if __name__ == '__main__':
    _LOCK_SOCK = ensure_single_instance(19527, "Telegram")
    redirect_log(__file__, "tgapp.log", "Telegram", ALLOWED)
    raise SystemExit(main())
