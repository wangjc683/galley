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
    _handle_continue_frontend, _reset_conversation,
)
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
    "✅ 已在本频道激活。此后你在本频道的发言都会交给 Agent 处理，"
    "回复、生成的文件与完成报告对本频道所有可见成员公开。\n"
    "退出：发送「退出该频道」（子区发「退出该子区」）。"
)
RETIRED_TEXT = (
    "ℹ️ 本频道的上下文已释放（同时活跃的频道过多）。"
    "重新 @ 我即可开启新的上下文；之前的对话历史不会带回来。"
)
RESTARTED_TEXT = (
    "ℹ️ 服务已重启，本频道的上下文已释放。请重新 @ 我激活本频道。"
)
DM_DISABLED_TEXT = (
    "ℹ️ 私信不处理对话。请到你的 Server 频道里 @ 我激活该频道——"
    "每个频道是一条独立的上下文。"
)
OWNER_BOUND_TEXT = (
    "✓ 已绑定为 Galley 的使用者，现在只响应你的消息。\n"
    "接下来到你的 Server 频道里 @ 我即可激活该频道；私信不再处理对话。"
)

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
    """One GA agent plus its worker thread, with a real close protocol."""

    def __init__(self, chat_id):
        self.chat_id = chat_id
        self.agent = GeneraticAgent()
        self.agent.verbose = False
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self.agent.run, daemon=True, name=f"discord-agent-{chat_id}"
        )
        self.thread.start()

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
        # Channel history only lives inside this process, but the active set is
        # persisted: after a restart an "active" channel would silently hand the
        # user a blank agent. Drop the flag and say so on the next message.
        # Managed mode only — file-based use keeps upstream's persistence.
        self._stale_channels = set(self._active_channels) if _GALLEY_MANAGED else set()
        if self._stale_channels:
            self._active_channels = {}
            self._save_active_channels()
            print(f"[Discord] released {len(self._stale_channels)} channel(s) after restart")
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
            self._active_channels[chat_id] = {"last_seen": float(now or time.time())}
            self._save_active_channels()
        return fresh

    def _forget_active_channel(self, chat_id):
        with self._active_lock:
            changed = self._active_channels.pop(chat_id, None) is not None
            self._save_active_channels()
        if changed:
            self._emit_channel_released(chat_id)
        return changed

    def _deactivate_channel(self, chat_id):
        changed = self._forget_active_channel(chat_id)
        state = self.user_tasks.get(chat_id)
        if state:
            state["running"] = False
        with self._agent_lock:
            handle = self._agents.pop(chat_id, None)
        if handle is not None:
            self._close_agent_async(handle)
        return changed

    def _close_agent_async(self, handle):
        # close() joins a worker thread that may still be finishing a turn;
        # never do that on the event loop.
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
        (exit command, TTL expiry, or agent eviction), so the launcher can
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
                handle = _ChannelAgent(chat_id)
                self._emit_agent_created(handle.agent, chat_id)
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
        # The channel's history dies with its agent, so drop the active flag
        # too: the user must re-@ instead of silently getting a blank context.
        self._forget_active_channel(chat_id)
        state = self.user_tasks.get(chat_id)
        if state:
            state["running"] = False
        print(f"[Discord] evicted agent for {chat_id} (cache limit {AGENT_CACHE_LIMIT})")
        self._close_agent_async(handle)
        self._notify_threadsafe(chat_id, RETIRED_TEXT)

    def _notify_threadsafe(self, chat_id, text):
        loop = self.loop  # set once start() owns a running loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.send_text(chat_id, text), loop)
        except Exception as e:
            print(f"[Discord] failed to schedule notice for {chat_id}: {e}")

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

    async def send_text(self, chat_id, content, **ctx):
        """Send text to a chat_id (best effort, upstream semantics)."""
        try:
            channel = await self._resolve_channel(chat_id)
        except Exception as e:
            print(f"[Discord] cannot resolve channel for {chat_id}: {e}")
            return
        for part in _split_discord_text(content, self.split_limit):
            try:
                await channel.send(part)
            except Exception as e:
                print(f"[Discord] send error: {e}")

    async def deliver_text(self, chat_id, content):
        """Strict send for programmatic callers (Galley's completion reporter):
        resolution and send failures raise instead of being logged and
        swallowed, so the caller never marks an undelivered report delivered."""
        channel = await self._resolve_channel(chat_id)
        for part in _split_discord_text(content, self.split_limit):
            await channel.send(part)

    async def send_done(self, chat_id, raw_text, **ctx):
        """Send final reply: text parts + file attachments."""
        files = [p for p in extract_files(raw_text) if os.path.exists(p)]
        body = _display_done_text(raw_text)

        # Send text (send_text handles splitting internally)
        if body and body != "...":
            await self.send_text(chat_id, body, **ctx)

        # Send files as Discord attachments
        if files:
            try:
                channel = await self._resolve_channel(chat_id)
            except Exception as e:
                print(f"[Discord] cannot resolve channel for files {chat_id}: {e}")
                channel = None
            if channel:
                for fpath in files:
                    try:
                        await channel.send(file=discord.File(fpath))
                    except Exception as e:
                        print(f"[Discord] failed to send file {fpath}: {e}")
                        await self.send_text(chat_id, f"⚠️ 文件发送失败: {os.path.basename(fpath)}", **ctx)

        if not body and not files:
            await self.send_text(chat_id, "...", **ctx)

    async def handle_command(self, chat_id, cmd, **ctx):
        """Handle slash commands against the per-chat agent, keeping Discord chats isolated."""
        ga = self._get_agent(chat_id).agent
        parts = (cmd or "").split()
        op = (parts[0] if parts else "").lower()
        if op == "/help":
            return await self.send_text(chat_id, HELP_TEXT, **ctx)
        if op == "/stop":
            state = self.user_tasks.get(chat_id)
            if state:
                state["running"] = False
            ga.abort()
            return await self.send_text(chat_id, "⏹️ 正在停止...", **ctx)
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
            return await self.send_text(chat_id, _handle_continue_frontend(ga, cmd), **ctx)
        if op == "/new":
            return await self.send_text(chat_id, _reset_conversation(ga), **ctx)
        return await self.send_text(chat_id, HELP_TEXT, **ctx)

    async def run_agent(self, chat_id, text, turn_dir=None, **ctx):
        """Run the isolated per-chat Discord agent."""
        handle = self._get_agent(chat_id)
        ga = handle.agent
        state = {"running": True}
        self.user_tasks[chat_id] = state
        try:
            await self.send_text(chat_id, "思考中...", **ctx)
            dq = ga.put_task(f"{FILE_HINT}\n\n{text}", source=self.source)
            last_ping = time.time()
            last_step = ""
            step_no = 0
            while state["running"] and not handle.stop_event.is_set():
                try:
                    item = await asyncio.to_thread(dq.get, True, 3)
                except Q.Empty:
                    if ga.is_running and time.time() - last_ping > self.ping_interval:
                        await self.send_text(chat_id, "⏳ 还在处理中，请稍等...", **ctx)
                        last_ping = time.time()
                    continue
                if "next" in item:
                    step = _extract_discord_progress(item.get("next", ""))
                    if step and step != last_step:
                        step_no += 1
                        await self.send_text(chat_id, f"步骤{step_no}：{step}", **ctx)
                        last_step = step
                        last_ping = time.time()
                    continue
                if "done" in item:
                    await self.send_done(chat_id, item.get("done", ""), **ctx)
                    break
            if not state["running"] or handle.stop_event.is_set():
                await self.send_text(chat_id, "⏹️ 已停止", **ctx)
        except Exception as e:
            import traceback
            print(f"[{self.label}] run_agent error: {e}")
            traceback.print_exc()
            await self.send_text(chat_id, f"❌ 错误: {e}", **ctx)
        finally:
            self.user_tasks.pop(chat_id, None)
            _cleanup_turn_dir(turn_dir)

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
                if chat_id in self._stale_channels:
                    self._stale_channels.discard(chat_id)
                    await self.send_text(chat_id, RESTARTED_TEXT)
                return
            self._stale_channels.discard(chat_id)
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
            label = "子区" if normalized in EXIT_THREAD_TEXTS else "频道"
            await self.send_text(chat_id, f"✅ 已退出该{label}，之后除非重新 @ 我，否则不会主动响应。")
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
                return await self.handle_command(chat_id, content)
            finally:
                _cleanup_turn_dir(turn_dir)

        task = asyncio.create_task(self.run_agent(chat_id, content, turn_dir=turn_dir))
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
    needs it to push into a channel: `app.deliver_text(chat_id, text)` scheduled
    on `app.loop` via asyncio.run_coroutine_threadsafe(...).result(timeout)."""
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
