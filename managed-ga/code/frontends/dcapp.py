# Discord Bot Frontend for GenericAgent
# ⚠️ 需要在 Discord Developer Portal 开启 "Message Content Intent"
#   Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT → 打开
# pip install discord.py

import asyncio, json, os, queue as Q, re, shutil, sys, threading, time, uuid
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agentmain import GeneraticAgent
from chatapp_common import (
    AgentChatMixin, build_done_text, ensure_single_instance, extract_files,
    public_access, redirect_log, require_runtime, split_text, strip_files, clean_reply,
    HELP_TEXT, FILE_HINT, format_restore,
    _handle_continue_frontend, _reset_conversation, _handle_btw_frontend,
)
import continue_cmd
from llmcore import mykeys

try:
    import discord
except Exception:
    print("Please install discord.py to use Discord: pip install discord.py")
    sys.exit(1)

agent = GeneraticAgent(); agent.verbose = False


def _load_galley_config():
    raw = os.environ.get("GALLEY_DISCORD_CONFIG_JSON")
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except Exception as e:
        raise RuntimeError(f"load Galley Discord config failed: {e}") from e
    if not isinstance(data, dict):
        raise RuntimeError("Galley Discord config must be a JSON object")
    return data


_GALLEY_CFG = _load_galley_config()
_GALLEY_MANAGED = _GALLEY_CFG is not None


def _discord_config():
    if not _GALLEY_MANAGED:
        # File-based (non-managed) config keeps upstream semantics untouched.
        token = str(mykeys.get("discord_bot_token", "") or "").strip()
        allowed = {str(x).strip() for x in mykeys.get("discord_allowed_users", []) if str(x).strip()}
        return token, allowed, str(mykeys.get("proxy", "") or "").strip() or None, None
    cfg = _GALLEY_CFG or {}
    token = str(cfg.get("discord_bot_token", "") or "").strip()
    bind_code = str(cfg.get("discord_owner_bind_code", "") or "").strip() or None
    proxy = str(cfg.get("proxy", "") or "").strip() or None
    # Discord user ids are numeric snowflakes; keep them as strings so they
    # compare against str(message.author.id) without int surprises. "*"
    # (upstream's public marker) is dropped on purpose: the managed bot drives
    # the owner's machine, so anyone-can-chat is never derivable from config.
    allowed = {
        str(item).strip()
        for item in (cfg.get("discord_allowed_users") or [])
        if str(item).strip() and str(item).strip() != "*"
    }
    return token, allowed, proxy, bind_code


BOT_TOKEN, ALLOWED, PROXY, OWNER_BIND_CODE = _discord_config()
USER_TASKS = {}
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMP_DIR = os.path.join(PROJECT_ROOT, "temp")
# Galley injects a per-channel state dir (im/discord/) so active-channel state
# and attachment scratch never land in the shipped code payload's temp/.
STATE_DIR = (os.environ.get("GALLEY_DISCORD_STATE_DIR") or "").strip() or TEMP_DIR
MEDIA_DIR = os.path.join(STATE_DIR, "discord_media")
ACTIVE_FILE = os.path.join(STATE_DIR, "discord_active_channels.json")
ACTIVE_TTL_SECONDS = 30 * 24 * 3600
EXIT_CHANNEL_TEXTS = {"退出该频道", "退出此频道", "退出频道"}
EXIT_THREAD_TEXTS = {"退出该子区", "退出此子区", "退出子区"}
# One GA agent per channel, each with its own worker thread and history: the
# cache is a memory ceiling, not a session store. 12 keeps a busy server's
# thread count and RSS on a plateau; eviction runs the full close protocol.
AGENT_CACHE_LIMIT = 12
AGENT_CLOSE_TIMEOUT_SECONDS = 20
GALLEY_STARTUP_FAILURE_LIMIT = 3
# Per-user pairing rate limit. Deliberately NOT Telegram's global
# invalidation: in a server where every member can DM the bot, a global
# "10 wrong guesses kills the code" rule is a denial-of-service button.
GALLEY_OWNER_BIND_ATTEMPT_LIMIT = 5
GALLEY_OWNER_BIND_TRACK_LIMIT = 512
GALLEY_DM_NOTICE_INTERVAL_SECONDS = 300
_galley_connected_once = False
_owner_bind_attempts = OrderedDict()  # user_id -> wrong attempts (LRU capped)

ACTIVATED_TEXT = (
    "✅ 已激活，本频道的发言都会交给 Galley\n"
    "-# 频道成员都能看到回复 · 发「退出频道」可退出"
)
EXITED_TEXT = "✅ 已退出，重新 @ 我即可激活"
# An active channel stays active across restarts and agent evictions: it
# maps to the engine log its agent writes (model_responses_*.txt, the
# basename only, never conversation content), and a new agent picks the
# conversation back up from that log. When a mapped log cannot be picked
# back up, the next answer or question says so, once.
CONTEXT_LOST_TEXT = "-# 之前的对话没接上，这是新的上下文"
_LOG_NAME_RE = re.compile(r"model_responses_[0-9A-Za-z_]+\.txt")
_LOG_LOCK_OWNER = "galley-discord:"  # continue_cmd lock agent_id prefix
DM_DISABLED_TEXT = (
    "ℹ️ 私信不处理对话。请到你的 Server 频道里 @ 我激活该频道——"
    "每个频道是一条独立的上下文。"
)
OWNER_BOUND_TEXT = (
    "✓ 已绑定为 Galley 的使用者，现在只响应你的消息。\n"
    "接下来到你的 Server 频道里 @ 我即可激活该频道；私信不再处理对话。"
)
DISCORD_HELP_TEXT = HELP_TEXT + "\n退出频道 - 停止在本频道或子区响应"
NO_RUNNING_TASK_TEXT = "当前没有在跑的任务"
# One status message per run, edited in place (an edit does not push) and
# deleted once the answer lands. Edits are throttled so a fast run never
# leans on discord.py's 429 backoff; terminal writes skip the throttle.
STATUS_EDIT_INTERVAL_SECONDS = 1.5
STATUS_POLL_SECONDS = 3.0
STEP_SUMMARY_LIMIT = 120
_COMPONENT_PREFIX = "galley-dc:"
_ASK_HOOK_KEY = "discord_ask_user"
_ASK_BUTTON_LIMIT = 25  # Discord: 5 rows x 5 buttons
_BUTTON_LABEL_LIMIT = 80
_EMBED_TITLE_LIMIT, _EMBED_DESCRIPTION_LIMIT = 256, 4096
_EMBED_FOOTER_LIMIT, _EMBED_TOTAL_LIMIT = 2048, 6000
# Same thresholds as the desktop's candidateLayout (gui/src/lib/ask-user-candidates.ts).
_CANDIDATE_LIST_MIN_COUNT = 5
_CANDIDATE_LIST_MAX_ROW_CHARS = 20
_CANDIDATE_LIST_MAX_ROW_TOTAL_CHARS = 60
_MULTI_SELECT_RE = re.compile(r"\[?(?:多选|multi(?:[-_ ]?select)?|select all)\]?", re.IGNORECASE)
_TOOL_CALL_RE = re.compile(r"^\s*🛠️\s+([A-Za-z_]\w*)\(", re.M)
_SUMMARY_SEARCH_STRIP_RE = re.compile(r"```.*?```|<thinking>.*?</thinking>", re.DOTALL)
_TOOL_LABELS = {
    "code_run": "运行代码", "file_read": "读取文件", "file_write": "写入文件",
    "file_patch": "修改文件", "web_scan": "读取网页", "web_execute_js": "执行网页脚本",
}

os.makedirs(MEDIA_DIR, exist_ok=True)


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
    # owner pairing", never public access.
    return _GALLEY_MANAGED and not ALLOWED


def _is_allowed_user(user_id):
    if _GALLEY_MANAGED:
        return user_id in ALLOWED
    return public_access(ALLOWED) or user_id in ALLOWED


def _bind_attempt_count(user_id):
    return _owner_bind_attempts.get(user_id, 0)


def _bump_bind_attempt(user_id):
    count = _owner_bind_attempts.get(user_id, 0) + 1
    _owner_bind_attempts[user_id] = count
    _owner_bind_attempts.move_to_end(user_id)
    while len(_owner_bind_attempts) > GALLEY_OWNER_BIND_TRACK_LIMIT:
        _owner_bind_attempts.popitem(last=False)
    return count


async def _handle_owner_bind_message(message, is_dm):
    """Locked mode (managed config, no owner bound yet): the only input that
    does anything is the pairing code, sent in a DM. Server channels never
    pair — the bot is visible to every member there. Wrong guesses get no
    reply (a guesser learns nothing) and only cost that user their own
    attempt budget; reconnecting from Galley issues a new code."""
    global ALLOWED, OWNER_BIND_CODE
    user_id = str(message.author.id)
    if not is_dm:
        return
    if not OWNER_BIND_CODE:
        print(f"[Discord] pairing code unavailable, ignoring dm from {user_id}")
        return
    if _bind_attempt_count(user_id) >= GALLEY_OWNER_BIND_ATTEMPT_LIMIT:
        print(f"[Discord] pairing attempts exhausted for user {user_id}")
        return
    text = (message.content or "").strip()
    if not text:
        return
    if text != OWNER_BIND_CODE:
        count = _bump_bind_attempt(user_id)
        print(f"[Discord] pairing code mismatch ({count}/{GALLEY_OWNER_BIND_ATTEMPT_LIMIT}) from {user_id}")
        return
    ALLOWED = {user_id}
    OWNER_BIND_CODE = None
    _owner_bind_attempts.clear()
    _emit_galley_status("running", None, ownerOpenId=user_id)
    try:
        await message.channel.send(OWNER_BOUND_TEXT)
    except Exception as e:
        print(f"[Discord] owner bind ack failed: {e}")
    print(f"[Discord] bound Galley owner: {user_id}")


class _AgentStopSentinel(str):
    """Stop sentinel for GeneraticAgent.run().

    Upstream's worker reads ``task.get("images")`` *before* its
    ``isinstance(task, str)`` break, so a plain string sentinel raises
    AttributeError and tears the thread down through an exception path. A str
    subclass that also answers ``.get()`` walks upstream's own break branch and
    lets ``run()`` return normally, no upstream edit needed.
    """

    def get(self, key, default=None):
        return default


_AGENT_STOP = _AgentStopSentinel("__galley_agent_stop__")


class _ChannelAgent:
    """One GA agent plus its worker thread, with a real close protocol.
    prepare(handle) runs on the worker thread before it serves any task:
    a conversation picked back up from its log is in place before the first
    task (queued meanwhile) runs, and no caller (the event loop, the
    completion reporter) waits on the file read. ready is set after it."""

    def __init__(self, chat_id, prepare=None):
        self.chat_id = chat_id
        self.agent = GeneraticAgent()
        self.agent.verbose = False
        self.stop_event = threading.Event()
        self.ready = threading.Event()
        self.thread = threading.Thread(
            target=self._work, args=(prepare,), daemon=True, name=f"discord-agent-{chat_id}"
        )
        self.thread.start()

    def _work(self, prepare):
        try:
            if prepare is not None:
                prepare(self)
        except Exception as e:
            print(f"[Discord] agent prepare failed for {self.chat_id}: {e}")
        finally:
            self.ready.set()
        self.agent.run()

    def close(self, timeout=AGENT_CLOSE_TIMEOUT_SECONDS):
        """abort() alone is not a close: it stops the current generation, then
        the worker blocks forever in task_queue.get(). Stop event (so in-flight
        streamers give up) + sentinel + join is what actually releases the
        thread and lets the agent be garbage collected."""
        self.stop_event.set()
        try:
            self.agent.abort()
        except Exception as e:
            print(f"[Discord] abort failed for {self.chat_id}: {e}")
        try:
            self.agent.task_queue.put(_AGENT_STOP)
        except Exception as e:
            print(f"[Discord] stop sentinel failed for {self.chat_id}: {e}")
        self.thread.join(timeout)
        if self.thread.is_alive():
            print(f"[Discord] agent worker still alive after {timeout}s: {self.chat_id}")
        else:
            print(f"[Discord] agent closed: {self.chat_id}")


_FENCE_RE = re.compile(r"^\s*(`{3,})([^\n`]*)$")


def _next_fence_state(fence, line):
    match = _FENCE_RE.match((line or "").rstrip("\r\n"))
    if not match:
        return fence
    marker, info = match.group(1), (match.group(2) or "").strip()
    if fence:
        return None if len(marker) >= len(fence[0]) else fence
    return (marker, info)


def _split_discord_text(text, limit):
    """Split for Discord's message limit without cutting a ``` block in half.

    ``split_text`` only knows line boundaries, so a long reply gets sliced
    mid-fence: Discord renders half a code block and the next message opens
    with orphaned code. Track the fence state, close it at the cut, and reopen
    it (same marker and language) at the top of the next part."""
    text = (text or "").strip() or "..."
    if len(text) <= limit:
        return [text]
    parts, buf, size, fence = [], [], 0, None

    def flush():
        nonlocal buf, size
        body = "".join(buf).rstrip()
        if fence and body:
            body += "\n" + fence[0]
        if body:
            parts.append(body)
        if fence:
            head = f"{fence[0]}{fence[1]}\n"
            buf, size = [head], len(head)
        else:
            buf, size = [], 0

    for line in text.splitlines(keepends=True):
        room = max(1, limit - (len(fence[0]) + 1 if fence else 0))
        if size and size + len(line) > room:
            flush()
        while len(line) > room:  # a single line longer than one message
            buf.append(line[:room])
            size += room
            line = line[room:]
            flush()
            room = max(1, limit - (len(fence[0]) + 1 if fence else 0))
        buf.append(line)
        size += len(line)
        fence = _next_fence_state(fence, line)
    tail = "".join(buf).rstrip()
    if fence and tail == f"{fence[0]}{fence[1]}":
        tail = ""  # nothing followed the reopened fence
    if tail:
        parts.append(tail)
    return [part for part in parts if part] or ["..."]


_PERMANENT_LOGIN_ERRORS = tuple(
    cls
    for cls in (
        getattr(discord, "LoginFailure", None),
        getattr(discord, "PrivilegedIntentsRequired", None),
    )
    if isinstance(cls, type)
)
_PERMANENT_CLOSE_CODES = {
    4004: "authentication failed (invalid bot token)",
    4013: "invalid gateway intents",
    4014: "privileged gateway intents are not enabled — turn on MESSAGE CONTENT INTENT",
}


def _permanent_connection_error(exc):
    """Return a reason string when the connection can never succeed until the
    user changes something (bad token, intents not enabled, bot removed), so
    the status pipe reports `error` and the process exits instead of backing
    off forever behind a `reconnecting` badge. Everything else is transient."""
    intents_exc = getattr(discord, "PrivilegedIntentsRequired", None)
    if isinstance(intents_exc, type) and isinstance(exc, intents_exc):
        return ("Discord privileged intents are not enabled: turn on MESSAGE "
                "CONTENT INTENT in the Developer Portal")
    if _PERMANENT_LOGIN_ERRORS and isinstance(exc, _PERMANENT_LOGIN_ERRORS):
        return f"Discord bot token rejected: {exc}"
    closed_exc = getattr(discord, "ConnectionClosed", None)
    code = getattr(exc, "code", None)
    if isinstance(closed_exc, type) and isinstance(exc, closed_exc) and code in _PERMANENT_CLOSE_CODES:
        return f"Discord gateway closed the connection ({code}): {_PERMANENT_CLOSE_CODES[code]}"
    http_exc = getattr(discord, "HTTPException", None)
    if isinstance(http_exc, type) and isinstance(exc, http_exc) and getattr(exc, "status", None) == 401:
        return f"Discord rejected the bot credentials (HTTP 401): {exc}"
    return None


def _purge_media_dir():
    """Attachments live for exactly one turn. Sweep leftovers from a crash."""
    try:
        for name in os.listdir(MEDIA_DIR):
            if name.startswith("turn_"):
                shutil.rmtree(os.path.join(MEDIA_DIR, name), ignore_errors=True)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[Discord] failed to purge media dir: {e}")


def _cleanup_turn_dir(turn_dir):
    if not turn_dir:
        return
    shutil.rmtree(turn_dir, ignore_errors=True)


def _extract_discord_progress(text):
    """Return the newest concise <summary> from a streaming transcript."""
    matches = re.findall(r"<summary>\s*(.*?)\s*</summary>", text or "", flags=re.DOTALL)
    if not matches:
        return ""
    summary = re.sub(r"\s+", " ", matches[-1]).strip()
    return summary[:120]


def _strip_discord_transcript(text):
    """Hide LLM/tool transcript noise while preserving the final natural reply."""
    text = text or ""
    text = re.sub(r"^\s*\*?\*?LLM Running \(Turn \d+\) \.\.\.\*?\*?\s*$", "", text, flags=re.M)
    text = re.sub(r"^\s*🛠️\s+.*?(?=^\s*(?:\*?\*?LLM Running|<summary>|$))", "", text, flags=re.M | re.DOTALL)
    text = re.sub(r"^\s*(?:✅|❌|ERR|STDOUT|PAT\b|RC\b).*?$", "", text, flags=re.M)
    text = re.sub(r"<tool_use>.*?</tool_use>", "", text, flags=re.DOTALL)
    text = clean_reply(text)
    return strip_files(text).strip()


def _display_done_text(text):
    body = _strip_discord_transcript(text)
    if body and body != "...":
        return body
    summaries = re.findall(r"<summary>\s*(.*?)\s*</summary>", text or "", flags=re.DOTALL)
    if summaries:
        return re.sub(r"\s+", " ", summaries[-1]).strip() or "..."
    return "..."


def _visible_text(text):
    body = _strip_discord_transcript(text)
    return "" if body == "..." else body


def _one_line(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _clip(text, limit):
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _format_elapsed(seconds):
    """Desktop RunFoldHeader.formatDuration: rounded to whole seconds (half
    up, like Math.round), nothing at all under one second."""
    sec = int(max(0.0, float(seconds or 0)) + 0.5)
    if sec < 1:
        return ""
    if sec < 60:
        return f"用时 {sec} 秒"
    return f"用时 {sec // 60} 分 {sec % 60} 秒"


def _fold_label(steps, seconds):
    parts = [f"{steps} 步"] if steps > 0 else []
    elapsed = _format_elapsed(seconds)
    if elapsed:
        parts.append(elapsed)
    return " · ".join(parts)


def _stopped_text(steps, seconds):
    label = _fold_label(steps, seconds)
    return f"⏹ 已停止 · {label}" if label else "⏹ 已停止"


def _step_summary(text):
    """One status line for a settled step: its last <summary>, else the first
    line of its visible prose, else which tool it called, else nothing."""
    text = text or ""
    summary = _extract_discord_progress(_SUMMARY_SEARCH_STRIP_RE.sub("", text))
    if not summary:
        body = _visible_text(text)
        summary = next((line for line in body.splitlines() if line.strip()), "")
    if not summary:
        match = _TOOL_CALL_RE.search(text)
        if match:
            summary = f"调用了{_TOOL_LABELS.get(match.group(1), match.group(1))}"
    return _one_line(summary)[:STEP_SUMMARY_LIMIT]


def _final_step_text(raw, outputs):
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


def _answer_body(step_text, raw):
    body = _visible_text(step_text) or _display_done_text(raw)
    return "" if body == "..." else body


def _existing_files(raw_text):
    return [p for p in extract_files(raw_text) if os.path.exists(p)]


def _reply_kwargs(message):
    """Quote a message without pinging its author; a deleted target degrades
    to a plain send instead of failing it."""
    if message is None:
        return {}
    reference = message
    to_reference = getattr(message, "to_reference", None)
    if callable(to_reference):
        try:
            reference = to_reference(fail_if_not_exists=False)
        except Exception:
            reference = message
    return {"reference": reference, "mention_author": False}


def _component_view(buttons):
    """Render-only button rows. Clicks are routed by custom_id in
    on_interaction, which also answers buttons that outlived this process, so
    the view is finished before it is sent: discord.py then never files a
    timeout=None view in its ViewStore, where one per message would pile up
    for the life of the process."""
    view = discord.ui.View(timeout=None)
    for label, custom_id in buttons:
        view.add_item(discord.ui.Button(
            label=label, style=discord.ButtonStyle.secondary, custom_id=custom_id,
        ))
    view.stop()
    return view


def _candidate_list(raw):
    items = raw if isinstance(raw, (list, tuple)) else ([] if raw is None else [raw])
    return [str(item).strip() for item in items if item is not None and str(item).strip()]


def _extract_ask_user_event(ctx):
    """The ask_user payload of a turn-end hook ctx (tgapp's shape), or None.
    Some models split one question into parallel ask_user calls with one
    candidate each; GA serves only the first, so candidates of same-question
    siblings are merged in, as the desktop does."""
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
    candidates = _candidate_list(data.get("candidates"))
    for call in ctx.get("tool_calls") or []:
        args = call.get("args") if isinstance(call, dict) and call.get("tool_name") == "ask_user" else None
        if not isinstance(args, dict) or str(args.get("question") or "").strip() != question:
            continue
        for candidate in _candidate_list(args.get("candidates")):
            if candidate not in candidates:
                candidates.append(candidate)
    return {"question": question, "candidates": candidates, "multi": bool(_MULTI_SELECT_RE.search(question))}


def _candidate_layout(candidates):
    if len(candidates) >= _CANDIDATE_LIST_MIN_COUNT:
        return "list"
    total = 0
    for candidate in candidates:
        size = len(candidate.strip())
        if size > _CANDIDATE_LIST_MAX_ROW_CHARS:
            return "list"
        total += size
    return "list" if total > _CANDIDATE_LIST_MAX_ROW_TOTAL_CHARS else "row"


def _ask_layout(event):
    """row: buttons carry the candidates; list: numbered in the text, buttons
    carry the numbers; text: numbered, answered by typing (multi-select, or
    more than Discord's 25 buttons); none: no candidates at all."""
    candidates = event["candidates"]
    if not candidates:
        return "none"
    if event.get("multi") or len(candidates) > _ASK_BUTTON_LIMIT:
        return "text"
    return _candidate_layout(candidates)


def _ask_prompt_text(event, layout, steps, narration=""):
    # The question keeps its single newlines: GA's question is plain text.
    lines = [f"-# ⏸ 等你回复 · 已完成 {steps} 步"]
    if narration:
        lines.append(narration)
    lines.append(event["question"])
    if layout in ("list", "text"):
        lines.extend(f"{i}. {_one_line(c)}" for i, c in enumerate(event["candidates"], 1))
    if event.get("multi") and event["candidates"]:
        lines.append("-# 多选：直接回复序号或文字")
    return "\n".join(lines)


def _ask_echo_text(pending, selected=None):
    """The answered question: the chosen candidate ticked at normal size, the
    rest as subtext. A typed answer ticks nothing."""
    lines = [f"-# 已回复 · 已完成 {pending.steps} 步"]
    if pending.narration:
        lines.append(pending.narration)
    lines.append(pending.event["question"])
    numbered = pending.layout in ("list", "text")
    for i, candidate in enumerate(pending.event["candidates"]):
        label = f"{i + 1}. {_one_line(candidate)}" if numbered else _one_line(candidate)
        lines.append(f"✓ {label}" if i == selected else f"-# {label}")
    return "\n".join(lines)


class _DiscordRun:
    """The Discord side of one run: a GA task, plus the ask_user segments it
    continues. app.user_tasks[chat_id] lists a channel's runs in order: the
    head is the one GA is on (or gets next), the rest wait behind it in the
    agent's task queue. The completion reporter reads that entry's truth
    value as "channel busy"."""

    def __init__(self, chat_id, ga, trigger=None, carry=None):
        self.chat_id, self.ga, self.trigger = chat_id, ga, trigger
        self.running = True  # cleared by /stop, channel release
        self.outcome = None  # "done" | "ask" | "stopped" | "error"
        self.queued = False
        self.adopted = carry is not None
        self.base_steps, self.base_elapsed, self.last_summary = 0, 0.0, ""
        self.adopt(carry)
        self.task_turn = 0  # highest GA turn seen in this run's task
        self.turn_texts = {}
        self.started_at = self.step_started_at = self.ended_at = None
        self.channel = self.status_msg = self.typing_task = None
        self.last_render = self.last_edit_at = None
        self.final_written = False
        self.wake = asyncio.Event()

    def adopt(self, carry):
        """Continue an ask_user-paused run: step numbers and elapsed time add
        up across segments; the wait for the answer is not counted."""
        if carry:
            self.base_steps = int(carry.get("steps") or 0)
            self.base_elapsed = float(carry.get("elapsed") or 0.0)
            self.last_summary = str(carry.get("summary") or "")

    def settled_steps(self):
        return self.base_steps + max(0, self.task_turn - 1)

    def total_steps(self):
        return self.base_steps + self.task_turn

    def elapsed(self, now):
        if self.started_at is None:
            return self.base_elapsed
        return self.base_elapsed + max(0.0, now - self.started_at)

    def carry(self, now):
        return {"steps": self.total_steps(), "elapsed": self.elapsed(now), "summary": self.last_summary}

    def observe(self, item, now):
        """Fold one display-queue item in. The channel agent runs verbose=False
        / inc_out=False: `outputs` is [previous step, current step] on `next`
        items and every step on `done`. Step k settles when an item for a
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
            self.task_turn, self.step_started_at = turn, now
            if turn > 1:
                self.last_summary = _step_summary(self.turn_texts.get(turn - 1, ""))
        if "done" in item and self.task_turn:
            self.last_summary = _step_summary(self.turn_texts.get(self.task_turn, ""))
        return outputs


def _status_content(run, now):
    """A run's status message. It never carries a button: stopping is the
    text /stop."""
    if run.started_at is None and run.queued:
        return "·· 排队中"
    lines = []
    settled = run.settled_steps()
    if settled >= 1:
        lines.append(f"{settled:02d} {run.last_summary}".rstrip())
    thinking = "·· 思考中"
    if run.step_started_at is not None:
        minutes = int((now - run.step_started_at) // 60)
        if minutes >= 1:
            thinking += f" · 已 {minutes} 分钟"
    lines.append(thinking)
    return "\n".join(lines)


class _PendingAsk:
    """A posted ask_user question waiting for the owner's answer."""

    def __init__(self, chat_id, event, layout, steps, carry, narration):
        self.token = uuid.uuid4().hex[:12]
        self.chat_id, self.event, self.layout = chat_id, event, layout
        self.steps, self.carry, self.narration = steps, carry, narration
        self.message = None


class DiscordApp(AgentChatMixin):
    label, source, split_limit = "Discord", "discord", 1900

    def __init__(self):
        super().__init__(agent, USER_TASKS)
        self.client = None
        self.background_tasks = set()
        self.loop = None
        self._closing = False
        self._channel_cache = OrderedDict()  # chat_id -> channel/user object (LRU, max 500)
        self._active_channels = self._load_active_channels()  # guild chat_id -> {last_seen: float}
        self._active_lock = threading.Lock()
        self._agents = OrderedDict()  # chat_id -> _ChannelAgent, each chat has isolated history
        self._agent_lock = threading.Lock()
        self._dm_notice_at = {}
        self._clock = time.monotonic  # run timing + edit throttle; injectable for tests
        self._ask_lock = threading.Lock()  # ask_user events arrive on GA worker threads
        self._ask_events = {}  # chat_id -> (display queue of the asking task, event)
        self._pending_asks = {}  # chat_id -> _PendingAsk waiting for an answer
        self._pending_by_token = {}  # button token -> _PendingAsk
        self._build_client()

    def _build_client(self):
        """A discord.Client cannot be restarted after it closes, so each
        reconnect cycle gets a fresh client (and a fresh channel cache, whose
        objects are bound to the old client's state)."""
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.dm_messages = True
        self.client = discord.Client(intents=intents, proxy=PROXY)
        self._channel_cache.clear()

        @self.client.event
        async def on_ready():
            global _galley_connected_once
            user = self.client.user
            print(f"[Discord] bot ready: {user} ({getattr(user, 'id', '')})")
            first_connect = not _galley_connected_once
            _galley_connected_once = True
            if first_connect:
                _emit_galley_status("running", None, botId=str(user or ""))
            else:
                _emit_galley_status("running")

        @self.client.event
        async def on_message(message):
            await self._handle_message(message)

        @self.client.event
        async def on_interaction(interaction):
            await self._handle_interaction(interaction)

    def _chat_id(self, message):
        """Return a string chat_id: 'dm:<user_id>' or 'ch:<channel_id>'."""
        if isinstance(message.channel, discord.DMChannel):
            return f"dm:{message.author.id}"
        return f"ch:{message.channel.id}"

    def _remember_channel(self, chat_id, channel):
        self._channel_cache[chat_id] = channel
        self._channel_cache.move_to_end(chat_id)
        if len(self._channel_cache) > 500:
            self._channel_cache.popitem(last=False)

    def _load_active_channels(self):
        try:
            with open(ACTIVE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return {}
            now = time.time()
            active = {}
            for chat_id, item in data.items():
                if not str(chat_id).startswith("ch:") or not isinstance(item, dict):
                    continue
                last_seen = float(item.get("last_seen") or 0)
                if now - last_seen <= ACTIVE_TTL_SECONDS:
                    active[str(chat_id)] = {"last_seen": last_seen}
                    log = item.get("log")  # absent in upstream / pre-0026 entries
                    if isinstance(log, str) and _LOG_NAME_RE.fullmatch(log):
                        active[str(chat_id)]["log"] = log
            return active
        except FileNotFoundError:
            return {}
        except Exception as e:
            print(f"[Discord] failed to load active channels: {e}")
            return {}

    def _save_active_channels(self):
        try:
            os.makedirs(os.path.dirname(ACTIVE_FILE), exist_ok=True)
            tmp = ACTIVE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._active_channels, f, ensure_ascii=False, indent=2, sort_keys=True)
            os.replace(tmp, ACTIVE_FILE)
        except Exception as e:
            print(f"[Discord] failed to save active channels: {e}")

    def _is_active_channel(self, chat_id, now=None):
        now = now or time.time()
        with self._active_lock:
            item = self._active_channels.get(chat_id)
            if not item:
                return False
            expired = now - float(item.get("last_seen") or 0) > ACTIVE_TTL_SECONDS
        if expired:
            print(f"[Discord] channel expired: {chat_id}")
            self._forget_active_channel(chat_id)
            return False
        return True

    def active_channel_ids(self):
        """Currently activated guild chat_ids ('ch:<channel_id>')."""
        with self._active_lock:
            return list(self._active_channels)

    def _touch_active_channel(self, chat_id, now=None):
        """Refresh the 30-day TTL; return True when this is a fresh activation."""
        if not chat_id.startswith("ch:"):
            return False
        with self._active_lock:
            fresh = chat_id not in self._active_channels
            self._active_channels.setdefault(chat_id, {})["last_seen"] = float(now or time.time())
            self._save_active_channels()
        return fresh

    def _channel_log_name(self, chat_id):
        with self._active_lock:
            return (self._active_channels.get(chat_id) or {}).get("log")

    def _set_channel_log(self, chat_id, name):
        """Map an active channel to its engine log (basename), or drop the
        mapping (None). A channel that is not active is left alone."""
        with self._active_lock:
            item = self._active_channels.get(chat_id)
            if item is None or item.get("log") == name:
                return
            if name:
                item["log"] = name
            else:
                item.pop("log", None)
            self._save_active_channels()

    def _record_channel_log(self, chat_id, ga):
        """After each run and before an eviction: map the channel to the log
        its agent writes, once that log exists (a context nothing was said
        in has nothing to pick back up)."""
        path = getattr(ga, "log_path", None)
        if isinstance(path, str) and os.path.isfile(path):
            self._set_channel_log(chat_id, os.path.basename(path))

    def _resume_channel(self, handle):
        """Pick the channel's conversation back up from the log it maps to
        (after a restart or an eviction), with upstream's /continue loader.
        Runs as the channel agent's prepare step, on its worker thread. No
        mapping (never talked, or an entry older than the mapping) is a
        fresh context; a mapping that cannot be picked back up is a fresh
        context plus CONTEXT_LOST_TEXT on the next answer or question."""
        chat_id, ga = handle.chat_id, handle.agent
        name = self._channel_log_name(chat_id)
        if not name:
            return
        path = os.path.join(os.path.dirname(ga.log_path), name)
        owner = _LOG_LOCK_OWNER + chat_id
        try:
            holder = continue_cmd.session_occupant(path)
            if (holder and str(holder.get("agent_id") or "").startswith(_LOG_LOCK_OWNER)
                    and holder.get("pid") != os.getpid()):
                # Still fresh (< 30 s) but left by the previous dcapp process,
                # which is gone: supervisor.lock runs one dcapp per state dir.
                try:
                    os.remove(continue_cmd._lock_path(path))
                except FileNotFoundError:
                    pass
            msg, ok = continue_cmd.continue_inplace(ga, path, owner, restore_wm=True)
            if not ok and os.path.basename(ga.log_path) != name:
                # Held by another live process: go on in a copy of the log.
                msg, ok = continue_cmd.continue_copy(ga, path, owner, restore_wm=True)
        except Exception as e:
            msg, ok = f"{type(e).__name__}: {e}", False
        if ok:
            self._set_channel_log(chat_id, os.path.basename(ga.log_path))
            print(f"[Discord] resumed {chat_id} from {os.path.basename(ga.log_path)}")
            return
        # Missing, empty or unparseable: start clean on a fresh log.
        try:
            continue_cmd.begin_fresh_session(ga, owner)
        except Exception as e:
            print(f"[Discord] fresh session failed for {chat_id}: {e}")
        ga._galley_context_lost = True
        print(f"[Discord] could not resume {chat_id} from {name}: {msg}")

    def _take_context_lost_notice(self, ga):
        if not getattr(ga, "_galley_context_lost", False):
            return ""
        ga._galley_context_lost = False
        return CONTEXT_LOST_TEXT

    def _forget_active_channel(self, chat_id):
        with self._active_lock:
            changed = self._active_channels.pop(chat_id, None) is not None
            self._save_active_channels()
        if changed:
            self._emit_channel_released(chat_id)
        return changed

    def _deactivate_channel(self, chat_id):
        changed = self._forget_active_channel(chat_id)
        self._on_loop(self._release_channel_ui, chat_id)
        with self._agent_lock:
            handle = self._agents.pop(chat_id, None)
        if handle is not None:
            self._close_agent_async(handle)
        return changed

    def _close_agent_async(self, handle):
        # close() joins a worker thread that may still be finishing a turn;
        # never do that on the event loop.
        # The completion reporter may still hold this agent (handed over at
        # creation); marked closed, it resolves the channel's live agent.
        handle.agent._galley_closed = True
        threading.Thread(
            target=handle.close, daemon=True, name=f"discord-agent-close-{handle.chat_id}"
        ).start()

    def _emit_agent_created(self, ga, chat_id):
        """Seam for the Galley launcher: every freshly created channel agent is
        handed to the hook together with its chat_id ('ch:<channel_id>'), which
        is what the launcher needs to install the managed prompt profile with a
        per-channel supervisor id (galley-im/discord/ch:<channel_id>) and to
        register the channel with the completion reporter. Purely optional —
        upstream / file-based use never sets the hook. The hook runs under the
        agent lock, so it must not call back into DiscordApp."""
        hook = globals().get("GALLEY_AGENT_HOOK")
        if not callable(hook):
            return
        try:
            hook(ga, chat_id)
        except Exception as e:
            print(f"[Discord] agent hook failed for {chat_id}: {e}")

    def _emit_channel_released(self, chat_id):
        """Counterpart of GALLEY_AGENT_HOOK: the channel stopped being active
        (exit command or TTL expiry), so the launcher can
        unregister it from the completion reporter."""
        hook = globals().get("GALLEY_CHANNEL_RELEASED_HOOK")
        if not callable(hook):
            return
        try:
            hook(chat_id)
        except Exception as e:
            print(f"[Discord] channel release hook failed for {chat_id}: {e}")

    def _get_agent(self, chat_id):
        """Return the _ChannelAgent for a chat, creating it on demand."""
        evicted = None
        with self._agent_lock:
            handle = self._agents.get(chat_id)
            if handle is None:
                handle = _ChannelAgent(chat_id, prepare=self._resume_channel)
                self._emit_agent_created(handle.agent, chat_id)
                self._install_ask_hook(handle.agent, chat_id)
                self._agents[chat_id] = handle
                if len(self._agents) > AGENT_CACHE_LIMIT:
                    _old_chat_id, evicted = self._agents.popitem(last=False)
            else:
                self._agents.move_to_end(chat_id)
        if evicted is not None:
            self._retire_agent(evicted)
        return handle

    def _retire_agent(self, handle):
        chat_id = handle.chat_id
        # The channel stays active: its conversation is in the engine log, and
        # the next message (or report turn) builds an agent that picks it up.
        self._record_channel_log(chat_id, handle.agent)
        self._on_loop(self._release_channel_ui, chat_id)
        print(f"[Discord] evicted agent for {chat_id} (cache limit {AGENT_CACHE_LIMIT})")
        self._close_agent_async(handle)

    def _on_loop(self, fn, *args):
        """Run fn on the event loop thread. _retire_agent is also reached from
        the completion reporter's thread (via _get_agent), and run / question
        state belongs to the loop."""
        loop = self.loop
        try:
            current = asyncio.get_running_loop()
        except RuntimeError:
            current = None
        if loop is None or loop.is_closed() or current is loop:
            return fn(*args)
        loop.call_soon_threadsafe(fn, *args)

    def _spawn(self, coro):
        try:
            task = asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            coro.close()
            return None
        self.background_tasks.add(task)
        task.add_done_callback(self.background_tasks.discard)
        return task

    def _release_channel_ui(self, chat_id):
        """The channel was released (exit command, agent eviction): all of its
        runs stop, and a question waiting for an answer loses its buttons and
        its carried step count."""
        for run in list(self.user_tasks.get(chat_id) or []):
            if run.outcome is None:
                self._request_stop(run, abort=False)  # closing the agent aborts it
            run.wake.set()
        with self._ask_lock:
            self._ask_events.pop(chat_id, None)
        self._drop_pending_ask(chat_id)

    def _install_ask_hook(self, ga, chat_id):
        """Capture ask_user from GA's turn-end hook (tgapp's seam) instead of
        parsing the 🛠️ echo. The hook runs on the GA worker thread, before the
        task's `done`; the event is tagged with that task's display queue so
        only the run owning the task claims it (a completion-reporter turn
        that asks never lands on a user run)."""
        hooks = getattr(ga, "_turn_end_hooks", None)
        if not isinstance(hooks, dict):
            hooks = {}
            ga._turn_end_hooks = hooks

        def hook(ctx):
            event = _extract_ask_user_event(ctx)
            if event is not None:
                with self._ask_lock:
                    self._ask_events[chat_id] = (getattr(ga, "_current_queue", None), event)

        hooks[_ASK_HOOK_KEY] = hook

    def _take_ask_event(self, chat_id, dq):
        with self._ask_lock:
            entry = self._ask_events.get(chat_id)
            if entry is None or (entry[0] is not None and entry[0] is not dq):
                return None
            del self._ask_events[chat_id]
        return entry[1]

    def _take_pending_ask(self, chat_id):
        with self._ask_lock:
            pending = self._pending_asks.pop(chat_id, None)
            if pending is not None:
                self._pending_by_token.pop(pending.token, None)
        return pending

    def _drop_pending_ask(self, chat_id):
        pending = self._take_pending_ask(chat_id)
        if pending is not None and pending.message is not None:
            self._spawn(self._strip_buttons(pending.message))
        return pending

    async def _strip_buttons(self, message):
        try:
            await message.edit(view=None)
        except Exception as e:
            print(f"[Discord] failed to remove buttons: {e}")

    def _new_turn_dir(self, chat_id):
        safe = re.sub(r"[^0-9A-Za-z]", "_", chat_id)
        return os.path.join(MEDIA_DIR, f"turn_{safe}_{uuid.uuid4().hex[:8]}")

    async def _download_attachments(self, message, turn_dir):
        """Download attachments/images into this turn's scratch dir, return
        local paths. The dir is removed once the turn ends."""
        paths = []
        if not message.attachments:
            return paths
        os.makedirs(turn_dir, exist_ok=True)
        for att in message.attachments:
            safe_name = re.sub(r'[<>:"/\\|?*]', '_', att.filename or f"file_{att.id}")
            local_path = os.path.join(turn_dir, f"{att.id}_{safe_name}")
            try:
                await att.save(local_path)
                paths.append(local_path)
                print(f"[Discord] saved attachment {att.id} ({getattr(att, 'size', '?')} bytes)")
            except Exception as e:
                print(f"[Discord] failed to save attachment {att.id}: {e}")
        return paths

    async def _resolve_channel(self, chat_id):
        channel = self._channel_cache.get(chat_id)
        if channel is not None:
            return channel
        if chat_id.startswith("dm:"):
            user = await self.client.fetch_user(int(chat_id[3:]))
            channel = await user.create_dm()
        else:
            channel = await self.client.fetch_channel(int(chat_id[3:]))
        self._remember_channel(chat_id, channel)
        return channel

    async def send_text(self, chat_id, content, reply_to=None, **ctx):
        """Send text to a chat_id (best effort, upstream semantics). reply_to
        quotes that message on the first part."""
        try:
            channel = await self._resolve_channel(chat_id)
        except Exception as e:
            print(f"[Discord] cannot resolve channel for {chat_id}: {e}")
            return
        for i, part in enumerate(_split_discord_text(content, self.split_limit)):
            try:
                await channel.send(part, **(_reply_kwargs(reply_to) if i == 0 else {}))
            except Exception as e:
                print(f"[Discord] send error: {e}")

    async def deliver_text(self, chat_id, content):
        """Strict send for programmatic callers (Galley's completion reporter):
        resolution and send failures raise instead of being logged and
        swallowed, so the caller never marks an undelivered report delivered."""
        channel = await self._resolve_channel(chat_id)
        for part in _split_discord_text(content, self.split_limit):
            await channel.send(part)

    async def deliver_embed(self, chat_id, *, title, description, color=None, footer=None):
        """Strict send of one embed for programmatic callers (the completion reporter):
        raises on resolve/send failure like deliver_text. Truncates title to 256 and
        footer to 2048 chars; raises ValueError when description exceeds 4096 —
        splitting long reports is the caller's job."""
        description = str(description or "")
        if len(description) > _EMBED_DESCRIPTION_LIMIT:
            raise ValueError(
                f"embed description is {len(description)} chars (limit {_EMBED_DESCRIPTION_LIMIT})"
            )
        title = str(title or "")[:_EMBED_TITLE_LIMIT]
        # Discord also caps an embed's text at 6000 in total; the footer gives way.
        room = _EMBED_TOTAL_LIMIT - len(title) - len(description)
        footer = str(footer or "")[:min(_EMBED_FOOTER_LIMIT, room)]
        channel = await self._resolve_channel(chat_id)
        embed = discord.Embed(title=title or None, description=description or None, color=color)
        if footer:
            embed.set_footer(text=footer)
        await channel.send(embed=embed)

    async def send_done(self, chat_id, raw_text, **ctx):
        """Send final reply: text parts + file attachments."""
        files = _existing_files(raw_text)
        body = _display_done_text(raw_text)

        # Send text (send_text handles splitting internally)
        if body and body != "...":
            await self.send_text(chat_id, body, **ctx)

        await self._send_files(chat_id, files)

        if not body and not files:
            await self.send_text(chat_id, "...", **ctx)

    async def _send_files(self, chat_id, files):
        """Send files as Discord attachments."""
        if not files:
            return
        try:
            channel = await self._resolve_channel(chat_id)
        except Exception as e:
            print(f"[Discord] cannot resolve channel for files {chat_id}: {e}")
            return
        for fpath in files:
            try:
                await channel.send(file=discord.File(fpath))
            except Exception as e:
                print(f"[Discord] failed to send file {fpath}: {e}")
                await self.send_text(chat_id, f"⚠️ 文件发送失败: {os.path.basename(fpath)}")

    async def handle_command(self, chat_id, cmd, message=None, **ctx):
        """Handle slash commands against the per-chat agent, keeping Discord chats isolated."""
        handle = self._get_agent(chat_id)
        if not handle.ready.is_set():  # /new, /continue must not race a resume
            await asyncio.to_thread(handle.ready.wait, AGENT_CLOSE_TIMEOUT_SECONDS)
        ga = handle.agent
        parts = (cmd or "").split()
        op = (parts[0] if parts else "").lower()
        if op == "/help":
            return await self.send_text(chat_id, DISCORD_HELP_TEXT, **ctx)
        if op == "/stop":
            # Stops the running run only (queued ones stay); its status
            # message, frozen as "⏹ 已停止 · …", is the receipt.
            run = self._running_run(chat_id)
            if run is None:
                return await self.send_text(chat_id, NO_RUNNING_TASK_TEXT, **ctx)
            self._request_stop(run)
            print(f"[Discord] run stopped by command: chat={chat_id}")
            return await self._write_stopped(run)
        if op == "/status":
            llm = ga.get_llm_name() if ga.llmclient else "未配置"
            return await self.send_text(chat_id, f"状态: {'🔴 运行中' if ga.is_running else '🟢 空闲'}\nLLM: [{ga.llm_no}] {llm}", **ctx)
        if op == "/llm":
            if not ga.llmclient:
                return await self.send_text(chat_id, "❌ 当前没有可用的 LLM 配置", **ctx)
            if len(parts) > 1:
                try:
                    ga.next_llm(int(parts[1]))
                    return await self.send_text(chat_id, f"✅ 已切换到 [{ga.llm_no}] {ga.get_llm_name()}", **ctx)
                except Exception:
                    return await self.send_text(chat_id, f"用法: /llm <0-{len(ga.list_llms()) - 1}>", **ctx)
            lines = [f"{'→' if cur else '  '} [{i}] {name}" for i, name, cur in ga.list_llms()]
            return await self.send_text(chat_id, "LLMs:\n" + "\n".join(lines), **ctx)
        if op == "/restore":
            try:
                restored_info, err = format_restore()
                if err:
                    return await self.send_text(chat_id, err, **ctx)
                restored, fname, count = restored_info
                ga.abort()
                ga.history.extend(restored)
                return await self.send_text(chat_id, f"✅ 已恢复 {count} 轮对话\n来源: {fname}\n(仅恢复上下文，请输入新问题继续)", **ctx)
            except Exception as e:
                return await self.send_text(chat_id, f"❌ 恢复失败: {e}", **ctx)
        if op == "/continue":
            return await self.send_text(chat_id, self._continue_session(chat_id, ga, cmd), **ctx)
        if op == "/new":
            self._drop_pending_ask(chat_id)
            notice = _reset_conversation(ga)
            # A new log, mapped once something is said in it: a restart
            # never brings back what /new cleared.
            continue_cmd.begin_fresh_session(ga, _LOG_LOCK_OWNER + chat_id)
            ga._galley_context_lost = False
            self._set_channel_log(chat_id, None)
            return await self.send_text(chat_id, notice, **ctx)
        if op == "/btw":
            answer = await asyncio.to_thread(_handle_btw_frontend, ga, cmd)
            return await self.send_text(chat_id, answer, reply_to=message, **ctx)
        if op == "/review":
            # Sent raw: GA's /review slash handler only fires when the query
            # starts with the command, which FILE_HINT would hide.
            return await self.run_agent(chat_id, cmd, reply_to=message, hint=False, answers_ask=False)
        return await self.send_text(chat_id, DISCORD_HELP_TEXT, **ctx)

    def _continue_session(self, chat_id, ga, cmd):
        """/continue N the way chatapp_common's frontends run it (same list,
        same reply), then the channel moves onto a copy of that log, so the
        log it maps to holds exactly the conversation it now has."""
        m = re.match(r"/continue\s+(\d+)\s*$", (cmd or "").strip())
        sessions = continue_cmd.list_sessions(exclude_pid=os.getpid()) if m else []
        idx = int(m.group(1)) - 1 if m else -1
        if not 0 <= idx < len(sessions):
            return _handle_continue_frontend(ga, cmd)
        _reset_conversation(ga, message=None)
        msg, full = continue_cmd.restore(ga, sessions[idx][0])
        if full:
            continue_cmd.continue_copy(ga, sessions[idx][0], _LOG_LOCK_OWNER + chat_id)
            ga._galley_context_lost = False
            self._record_channel_log(chat_id, ga)
        return msg

    async def run_agent(self, chat_id, text, turn_dir=None, reply_to=None, carry=None,
                        hint=True, answers_ask=True, **ctx):
        """Run one task on the channel's agent behind a single status message:
        replied under the triggering message, edited in place while steps
        settle, deleted once the answer (or an ask_user question) is posted,
        frozen as the receipt when stopped. carry continues an ask_user-paused
        run (button answers); with answers_ask a run answers a question still
        pending in the channel (typed answers)."""
        handle = self._get_agent(chat_id)
        ga = handle.agent
        run = _DiscordRun(chat_id, ga, reply_to, carry)
        runs = self.user_tasks.setdefault(chat_id, [])
        runs.append(run)
        try:
            run.queued = len(runs) > 1 or bool(getattr(ga, "is_running", False))
            if answers_ask and not run.queued:
                await self._adopt_pending_ask(run)
            run.channel = await self._resolve_channel(chat_id)
            await self._send_status(run)
            dq = ga.put_task(f"{FILE_HINT}\n\n{text}" if hint else text, source=self.source)
            await self._wait_for_turn(run, handle)
            if answers_ask and not run.adopted and run.running:
                await self._adopt_pending_ask(run)
            while run.running and not handle.stop_event.is_set():
                try:
                    item = await asyncio.to_thread(dq.get, True, self._status_poll_timeout(run))
                except Q.Empty:
                    await self._flush_status(run)
                    continue
                if not run.running:
                    break
                now = self._clock()
                if run.started_at is None:
                    self._start_run(run, now, typing="done" not in item)
                outputs = run.observe(item, now)
                if "done" in item:
                    await self._finish_run(run, str(item.get("done") or ""), outputs, dq)
                    break
                await self._flush_status(run)
            if run.outcome is None:  # the agent was closed under the run
                self._request_stop(run, abort=False)
            if run.outcome == "stopped":
                await self._write_stopped(run)
        except Exception as e:
            import traceback
            print(f"[{self.label}] run_agent error: {e}")
            traceback.print_exc()
            await self._fail_run(run, e)
        finally:
            self._stop_typing(run)
            self._record_channel_log(chat_id, ga)
            if run in runs:
                runs.remove(run)
            if runs:
                runs[0].wake.set()
            elif self.user_tasks.get(chat_id) is runs:
                self.user_tasks.pop(chat_id, None)
            _cleanup_turn_dir(turn_dir)

    def _running_run(self, chat_id):
        runs = self.user_tasks.get(chat_id) or []
        run = runs[0] if runs else None
        if run is not None and run.running and run.outcome is None and run.started_at is not None:
            return run
        return None

    def _request_stop(self, run, abort=True):
        run.running = False
        run.outcome = "stopped"
        run.ended_at = self._clock()
        self._stop_typing(run)
        run.wake.set()
        if abort:
            try:
                run.ga.abort()
            except Exception as e:
                print(f"[Discord] abort failed for {run.chat_id}: {e}")

    async def _wait_for_turn(self, run, handle):
        """A queued run reads its display queue only once it heads the
        channel. GA runs the tasks in that order anyway; waiting keeps each
        run's answer, question and status edits in the same order, so a
        question posted by the run ahead is pending by the time this run
        starts and can be answered by it."""
        while run.running and not handle.stop_event.is_set():
            runs = self.user_tasks.get(run.chat_id) or []
            if runs and runs[0] is run:
                return
            run.wake.clear()
            try:
                await asyncio.wait_for(run.wake.wait(), STATUS_POLL_SECONDS)
            except asyncio.TimeoutError:
                pass

    def _start_run(self, run, now, typing=True):
        """The run's task began: the clock starts (queueing is not counted),
        and Discord's typing indicator carries liveness from here."""
        run.started_at = run.step_started_at = now
        if typing and run.channel is not None:
            run.typing_task = asyncio.create_task(self._keep_typing(run.channel, run.chat_id))

    async def _keep_typing(self, channel, chat_id):
        # typing() re-sends the indicator every 5 seconds until exited.
        try:
            async with channel.typing():
                await asyncio.Event().wait()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[Discord] typing indicator failed for {chat_id}: {e}")

    def _stop_typing(self, run):
        task, run.typing_task = run.typing_task, None
        if task is not None and not task.done():
            task.cancel()

    async def _send_status(self, run):
        now = self._clock()
        rendering = _status_content(run, now)
        try:
            run.status_msg = await run.channel.send(rendering, **_reply_kwargs(run.trigger))
            run.last_render, run.last_edit_at = rendering, now
        except Exception as e:
            print(f"[Discord] status message failed for {run.chat_id}: {e}")

    def _status_poll_timeout(self, run):
        if run.status_msg is None or run.last_edit_at is None:
            return STATUS_POLL_SECONDS
        now = self._clock()
        if _status_content(run, now) == run.last_render:
            return STATUS_POLL_SECONDS
        wait = STATUS_EDIT_INTERVAL_SECONDS - (now - run.last_edit_at)
        return min(STATUS_POLL_SECONDS, max(0.05, wait))

    async def _flush_status(self, run):
        """Edit the status message when its rendering changed, at most once per
        STATUS_EDIT_INTERVAL_SECONDS; intermediate states merge."""
        if run.status_msg is None or run.outcome is not None:
            return
        now = self._clock()
        rendering = _status_content(run, now)
        if rendering == run.last_render:
            return
        if run.last_edit_at is not None and now - run.last_edit_at < STATUS_EDIT_INTERVAL_SECONDS:
            return
        try:
            await run.status_msg.edit(content=rendering)
            run.last_render = rendering
        except Exception as e:
            print(f"[Discord] status edit failed for {run.chat_id}: {e}")
        run.last_edit_at = now
        if run.outcome == "stopped":
            # A stop landed while this edit was in flight and may have been
            # overwritten by it: write the stopped receipt again.
            run.final_written = False
            await self._write_stopped(run)

    async def _write_stopped(self, run):
        """A stopped run keeps its status message, frozen as the receipt."""
        if run.status_msg is None or run.final_written:
            return
        text = _stopped_text(run.total_steps(), run.elapsed(run.ended_at or self._clock()))
        try:
            await run.status_msg.edit(content=text)
            run.final_written = True
        except Exception as e:
            print(f"[Discord] status stop edit failed for {run.chat_id}: {e}")

    async def _retire_status(self, run, fallback):
        """Delete the status message; if Discord refuses, never leave it
        claiming the run is still thinking."""
        msg, run.status_msg = run.status_msg, None
        if msg is None:
            return
        try:
            await msg.delete()
            return
        except Exception as e:
            print(f"[Discord] status delete failed for {run.chat_id}: {e}")
        try:
            await msg.edit(content=fallback)
        except Exception as e:
            print(f"[Discord] status fallback edit failed for {run.chat_id}: {e}")

    def _answer_reply_kwargs(self, run):
        """Quote the trigger only when something landed after this run's
        status message; right below it, the answer already reads as the reply."""
        anchor = run.status_msg or run.trigger
        last = getattr(run.channel, "last_message_id", None)
        if anchor is not None and last is not None and last == getattr(anchor, "id", None):
            return {}
        return _reply_kwargs(run.trigger)

    async def _finish_run(self, run, raw, outputs, dq):
        now = self._clock()
        run.ended_at = now
        self._stop_typing(run)
        steps, elapsed = run.total_steps(), run.elapsed(now)
        step_text = _final_step_text(raw, outputs)
        event = self._take_ask_event(run.chat_id, dq)
        notice = self._take_context_lost_notice(run.ga)
        if event is not None:
            run.outcome = "ask"
            reply = self._answer_reply_kwargs(run)
            await self._retire_status(run, "-# ⏸ 等你回复")
            await self._post_ask(run, event, _visible_text(step_text), run.carry(now), reply, notice)
            await self._send_files(run.chat_id, _existing_files(raw))
            return
        run.outcome = "done"
        await self._send_answer(run, raw, _answer_body(step_text, raw), steps, elapsed, notice)
        await self._retire_status(run, "-# ✓ 已完成")

    async def _send_answer(self, run, raw, body, steps, elapsed, notice=""):
        """The run's one pushed message: the desktop's fold header as a
        `-# N 步 · 用时 X` subtext line over the closing step's text. Files
        still come from the whole transcript. notice goes above it all."""
        label = _fold_label(steps, elapsed)
        text = "\n".join(part for part in (notice, f"-# {label}" if label else "", body) if part)
        files = _existing_files(raw)
        if not text and not files:
            text = "..."
        if text:
            reply = self._answer_reply_kwargs(run)
            for i, part in enumerate(_split_discord_text(text, self.split_limit)):
                await run.channel.send(part, **(reply if i == 0 else {}))
        await self._send_files(run.chat_id, files)

    async def _fail_run(self, run, error):
        now = self._clock()
        run.running, run.outcome = False, "error"
        self._stop_typing(run)
        label = _fold_label(run.total_steps(), run.elapsed(run.ended_at or now))
        await self._retire_status(run, "-# ❌ 出错")
        text = f"❌ 出错：{error}"
        await self.send_text(run.chat_id, f"-# {label}\n{text}" if label else text)

    async def _post_ask(self, run, event, narration, carry, reply, notice=""):
        """Pause for the owner's answer: a new (pushed) question message,
        answered by a button or by the next message typed in the channel.
        The run's step count and clock wait in the pending question."""
        layout = _ask_layout(event)
        steps = carry["steps"]
        pending = _PendingAsk(run.chat_id, event, layout, steps, carry, narration)
        head = f"{notice}\n" if notice else ""  # on the first message posted
        text = head + _ask_prompt_text(event, layout, steps, narration)
        if len(text) > self.split_limit and narration:
            # A long narration goes out first, so the question and its
            # buttons stay one message.
            for part in _split_discord_text(head + narration, self.split_limit):
                await run.channel.send(part, **reply)
                reply = {}
            pending.narration = ""
            text = _ask_prompt_text(event, layout, steps)
        view = None
        if layout in ("row", "list"):
            view = _component_view([
                (
                    (_one_line(c) if layout == "row" else str(i + 1))[:_BUTTON_LABEL_LIMIT] or str(i + 1),
                    f"{_COMPONENT_PREFIX}ask:{pending.token}:{i}",
                )
                for i, c in enumerate(event["candidates"])
            ])
        pending.message = await run.channel.send(_clip(text, self.split_limit), view=view, **reply)
        with self._ask_lock:
            replaced = self._pending_asks.pop(run.chat_id, None)
            if replaced is not None:
                self._pending_by_token.pop(replaced.token, None)
            self._pending_asks[run.chat_id] = pending
            self._pending_by_token[pending.token] = pending
        if replaced is not None and replaced.message is not None:
            await self._strip_buttons(replaced.message)
        print(
            f"[Discord] ask_user posted: chat={run.chat_id} "
            f"candidates={len(event['candidates'])} layout={layout}"
        )

    async def _adopt_pending_ask(self, run):
        """ask_user does not cut the run (desktop, 2026-09-18): the next run in
        the channel is the answer, and continues the step count and clock.
        Its question becomes an echo with nothing ticked (a typed answer)."""
        run.adopted = True
        pending = self._take_pending_ask(run.chat_id)
        if pending is None:
            return
        run.adopt(pending.carry)
        if pending.message is not None:
            try:
                await pending.message.edit(
                    content=_clip(_ask_echo_text(pending), self.split_limit), view=None,
                )
            except Exception as e:
                print(f"[Discord] ask_user echo failed for {run.chat_id}: {e}")
        print(f"[Discord] ask_user answered by message: chat={run.chat_id}")

    async def _handle_interaction(self, interaction):
        """Button clicks (ask_user answers), routed by custom_id so that
        buttons left over from an earlier process are still answered."""
        data = getattr(interaction, "data", None)
        custom_id = str(data.get("custom_id") or "") if isinstance(data, dict) else ""
        if not custom_id.startswith(_COMPONENT_PREFIX):
            return
        user_id = str(getattr(getattr(interaction, "user", None), "id", ""))
        if not _is_allowed_user(user_id):
            # Like a non-owner message: ignored, but acknowledged so Discord
            # does not show "interaction failed".
            print(f"[Discord] ignored button from unauthorized user {user_id}")
            return await self._ack(interaction)
        kind, _, rest = custom_id[len(_COMPONENT_PREFIX):].partition(":")
        if kind == "ask":
            token, _, index = rest.partition(":")
            return await self._on_ask_click(interaction, token, index)
        # Anything else is stale. That includes the 停止 button
        # (galley-dc:stop:<token>) status messages carried before stopping
        # became text-only (/stop): it stops nothing, even when the channel
        # has a run going now.
        return await self._ack_stale(interaction)

    async def _ack(self, interaction):
        try:
            await interaction.response.defer()
        except Exception as e:
            print(f"[Discord] interaction ack failed: {e}")

    async def _ack_stale(self, interaction):
        """An answered / expired / pre-restart button: acknowledge, drop the
        buttons, start nothing."""
        await self._ack(interaction)
        message = getattr(interaction, "message", None)
        if message is not None:
            await self._strip_buttons(message)

    async def _on_ask_click(self, interaction, token, index):
        with self._ask_lock:
            pending = self._pending_by_token.get(token)
            try:
                idx = int(index)
            except ValueError:
                idx = -1
            valid = pending is not None and 0 <= idx < len(pending.event["candidates"])
            if valid:
                self._pending_by_token.pop(token, None)
                if self._pending_asks.get(pending.chat_id) is pending:
                    self._pending_asks.pop(pending.chat_id, None)
        if not valid:
            return await self._ack_stale(interaction)
        try:
            await interaction.response.edit_message(
                content=_clip(_ask_echo_text(pending, idx), self.split_limit), view=None,
            )
        except Exception as e:
            print(f"[Discord] ask_user echo failed for {pending.chat_id}: {e}")
            await self._ack(interaction)
        print(f"[Discord] ask_user answered by button: chat={pending.chat_id} choice={idx + 1}")
        self._spawn(self.run_agent(
            pending.chat_id, pending.event["candidates"][idx],
            reply_to=getattr(interaction, "message", None) or pending.message, carry=pending.carry,
        ))

    async def _handle_message(self, message):
        # Ignore self
        if message.author == self.client.user or message.author.bot:
            return

        is_dm = isinstance(message.channel, discord.DMChannel)
        is_guild = message.guild is not None
        chat_id = self._chat_id(message)
        now = time.time()
        mentioned = bool(is_guild and self.client.user and self.client.user.mentioned_in(message))

        self._remember_channel(chat_id, message.channel)
        user_id = str(message.author.id)

        if _galley_locked():
            # Managed mode before pairing: a DM pairing code is the only input
            # that does anything; guild traffic is ignored outright.
            return await _handle_owner_bind_message(message, is_dm)

        if not _is_allowed_user(user_id):
            print(f"[Discord] ignored message from unauthorized user {user_id}")
            return

        if _GALLEY_MANAGED and not is_guild:
            # V1: the channel is the context. DM conversation stays off, so
            # there is exactly one place a supervisor context can live.
            return await self._notify_dm_disabled(chat_id, user_id)

        if is_guild:
            active = self._is_active_channel(chat_id, now)
            if not mentioned and not active:
                return
            if self._touch_active_channel(chat_id, now):
                await self.send_text(chat_id, ACTIVATED_TEXT)

        # Strip bot mention from content
        content = message.content or ""
        if is_guild and self.client.user:
            content = re.sub(rf"<@!?{self.client.user.id}>", "", content).strip()
        else:
            content = content.strip()

        normalized = re.sub(r"\s+", "", content)
        if is_guild and normalized in EXIT_CHANNEL_TEXTS | EXIT_THREAD_TEXTS:
            self._deactivate_channel(chat_id)
            await self.send_text(chat_id, EXITED_TEXT)
            print(f"[Discord] manually deactivated {chat_id} by user {user_id}")
            return

        # Download attachments into a per-turn scratch dir
        turn_dir = self._new_turn_dir(chat_id) if message.attachments else None
        attachment_paths = await self._download_attachments(message, turn_dir) if turn_dir else []

        # Build message text with attachment paths
        if attachment_paths:
            paths_text = "\n".join(f"[附件: {p}]" for p in attachment_paths)
            content = f"{content}\n{paths_text}" if content else paths_text

        if not content:
            _cleanup_turn_dir(turn_dir)
            return

        # Event metadata only: message bodies are the supervisor's conversation,
        # not Galley's log material.
        print(
            f"[Discord] message: chat={chat_id} user={user_id} "
            f"scope={'dm' if is_dm else 'guild'} chars={len(content)} "
            f"attachments={len(attachment_paths)} command={content.startswith('/')}"
        )

        if content.startswith("/"):
            try:
                return await self.handle_command(chat_id, content, message=message)
            finally:
                _cleanup_turn_dir(turn_dir)

        task = asyncio.create_task(self.run_agent(chat_id, content, turn_dir=turn_dir, reply_to=message))
        self.background_tasks.add(task)
        task.add_done_callback(self.background_tasks.discard)

    async def _notify_dm_disabled(self, chat_id, user_id):
        now = time.time()
        if now - self._dm_notice_at.get(user_id, 0) < GALLEY_DM_NOTICE_INTERVAL_SECONDS:
            return
        self._dm_notice_at[user_id] = now
        await self.send_text(chat_id, DM_DISABLED_TEXT)

    async def shutdown(self):
        if self._closing:
            return
        self._closing = True
        for task in list(self.background_tasks):
            task.cancel()
        self.background_tasks.clear()
        try:
            if self.client is not None and not self.client.is_closed():
                await self.client.close()
        except Exception as e:
            print(f"[Discord] client close error: {e}")
        with self._agent_lock:
            handles = list(self._agents.values())
            self._agents.clear()
        if handles:
            await asyncio.gather(
                *[asyncio.to_thread(handle.close) for handle in handles],
                return_exceptions=True,
            )
        print("[Discord] stopped")

    async def start(self):
        print("[Discord] bot starting...")
        self.loop = asyncio.get_running_loop()
        _purge_media_dir()
        delay, max_delay = 5, 300
        startup_failures = 0
        try:
            while True:
                started_at = time.monotonic()
                try:
                    await self.client.start(BOT_TOKEN)
                    print("[Discord] client closed")
                    return 0
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    permanent = _permanent_connection_error(e)
                    if permanent:
                        print(f"[Discord] fatal: {permanent}")
                        _emit_galley_status("error", permanent)
                        return 1
                    print(f"[Discord] error: {type(e).__name__}: {e}")
                    if not _galley_connected_once:
                        startup_failures += 1
                        if startup_failures >= GALLEY_STARTUP_FAILURE_LIMIT:
                            _emit_galley_status("error", str(e) or type(e).__name__)
                            return 1
                    _emit_galley_status("reconnecting", str(e) or type(e).__name__)
                if time.monotonic() - started_at >= 60:
                    delay = 5
                print(f"[Discord] reconnect in {delay}s...")
                await asyncio.sleep(delay)
                delay = min(delay * 2, max_delay)
                try:
                    if not self.client.is_closed():
                        await self.client.close()
                except Exception as e:
                    print(f"[Discord] client close error: {e}")
                self._build_client()
        finally:
            await self.shutdown()


def check_config(init_agent=False):
    return {"ready": bool(BOT_TOKEN)}


_APP = None


def get_app():
    """The DiscordApp instance main() is running. Galley's completion reporter
    needs it to push into a channel: `app.deliver_text(chat_id, text)` (or
    `app.deliver_embed(...)`) scheduled on `app.loop` via
    asyncio.run_coroutine_threadsafe(...).result(timeout)."""
    return _APP


def main():
    global _APP
    if not _GALLEY_MANAGED and not BOT_TOKEN:
        print("[Discord] ERROR: discord_bot_token is empty or missing in mykey.py / mykey.json")
        return 1
    require_runtime(agent, "Discord", discord_bot_token=BOT_TOKEN)
    app = DiscordApp()
    _APP = app
    try:
        return int(asyncio.run(app.start()) or 0)
    except KeyboardInterrupt:
        print("[Discord] interrupted")
        return 0


if __name__ == "__main__":
    _LOCK_SOCK = ensure_single_instance(19532, "Discord")
    redirect_log(__file__, "dcapp.log", "Discord", ALLOWED)
    raise SystemExit(main())
