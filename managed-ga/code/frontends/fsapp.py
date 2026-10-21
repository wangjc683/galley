import argparse, asyncio, importlib.metadata, importlib.util, json, os, queue as Q, re, sys, threading, time, uuid
from pathlib import Path

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)
os.chdir(PROJECT_ROOT)

import traceback
import lark_oapi as lark
from lark_oapi.api.im.v1 import *


def _ensure_dir(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _workspace_root_dir():
    root = os.environ.get("GA_WORKSPACE_ROOT")
    if root:
        return _ensure_dir(Path(root).expanduser().resolve())
    return _ensure_dir(Path(PROJECT_ROOT).resolve())


def _workspace_config_dir(root=None):
    base = Path(root).expanduser().resolve() if root else _workspace_root_dir()
    if base.name == "ga_config":
        return _ensure_dir(base)
    return _ensure_dir(base / "ga_config")


def _load_dict_config(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        if path.suffix == ".py":
            mod_name = f"_fs_mykey_{uuid.uuid4().hex}"
            spec = importlib.util.spec_from_file_location(mod_name, path)
            if not spec or not spec.loader:
                return None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            data = {k: v for k, v in vars(module).items() if not k.startswith("_")}
        else:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception as e:
        print(f"[ERROR] load config failed {path}: {e}")
        return None


def _resolve_mykey_path():
    workspace_root = _workspace_root_dir()
    config_root = _workspace_config_dir(workspace_root)
    candidates = [
        config_root / "mykey.json",
        config_root / "mykey.py",
        workspace_root / "mykey.json",
        workspace_root / "mykey.py",
        Path(PROJECT_ROOT) / "mykey.json",
        Path(PROJECT_ROOT) / "mykey.py",
    ]
    for candidate in candidates:
        if _load_dict_config(candidate):
            return candidate
    return candidates[0]


def _ensure_runtime_paths():
    workspace_root = _workspace_root_dir()
    config_root = _workspace_config_dir(workspace_root)
    os.environ.setdefault("GA_WORKSPACE_ROOT", str(workspace_root))
    os.environ.setdefault("GA_USER_DATA_DIR", str(config_root))
    return str(workspace_root), str(config_root)


_ensure_runtime_paths()
from agentmain import GeneraticAgent
# Galley 0029: the top-level module, as tgapp and dcapp import it.
# galley_im_display imports `chatapp_common` too; a second module object
# under `frontends.chatapp_common` would install /continue, /btw and
# /review on the GA class twice.
import chatapp_common as _common
from chatapp_common import AgentChatMixin, FILE_HINT, split_text
from galley_im_display import (
    answer_body,
    clip,
    extract_ask_user_event,
    final_step_text,
    fold_label,
    one_line,
    step_summary,
    stopped_text,
    tables_to_lists,
    visible_text,
)

# next-suggestion: Galley workbench-composer tag, stripped defensively —
# see the same note in chatapp_common.TAG_PATS.
_TAG_PATS = [r"<" + t + r">.*?</" + t + r">" for t in ("thinking", "summary", "tool_use", "file_content", "next-suggestion")]
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".tiff", ".tif"}
_AUDIO_EXTS = {".opus", ".mp3", ".wav", ".m4a", ".aac"}
_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
_FILE_TYPE_MAP = {
    ".opus": "opus",
    ".mp4": "mp4",
    ".pdf": "pdf",
    ".doc": "doc",
    ".docx": "doc",
    ".xls": "xls",
    ".xlsx": "xls",
    ".ppt": "ppt",
    ".pptx": "ppt",
}
_MSG_TYPE_MAP = {"image": "[image]", "audio": "[audio]", "file": "[file]", "media": "[media]", "sticker": "[sticker]"}

TEMP_DIR = os.environ.get("GALLEY_FEISHU_TEMP_DIR") or os.path.join(PROJECT_ROOT, "temp")
MEDIA_DIR = os.path.join(TEMP_DIR, "feishu_media")
os.makedirs(MEDIA_DIR, exist_ok=True)


_TRUNC_TAIL = 300  # 截断兜底时保留原文尾部字符数
_DEDUP_TTL_SEC = 10 * 60
_DEDUP_MAX = 2000
_DEDUP_LOCK = threading.Lock()
_SEEN_MESSAGES = {}


def _claim_message_once(message_id):
    """Best-effort cross-platform dedup for Feishu reconnect redeliveries."""
    if not message_id:
        return True
    now = time.time()
    with _DEDUP_LOCK:
        expired = [mid for mid, ts in _SEEN_MESSAGES.items() if now - ts > _DEDUP_TTL_SEC]
        for mid in expired:
            _SEEN_MESSAGES.pop(mid, None)
        if len(_SEEN_MESSAGES) > _DEDUP_MAX:
            for mid, _ in sorted(_SEEN_MESSAGES.items(), key=lambda item: item[1])[:len(_SEEN_MESSAGES) - _DEDUP_MAX]:
                _SEEN_MESSAGES.pop(mid, None)
        if message_id in _SEEN_MESSAGES:
            return False
        _SEEN_MESSAGES[message_id] = now
        return True


def _clean(text):
    for pat in _TAG_PATS:
        text = re.sub(pat, "", text or "", flags=re.DOTALL)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _extract_files(text):
    return re.findall(r"\[FILE:([^\]]+)\]", text or "")


def _strip_files(text):
    return re.sub(r"\[FILE:[^\]]+\]", "", text or "").strip()


def _display_text(text):
    cleaned = _strip_files(_clean(text))
    if cleaned:
        return cleaned
    tail = (text or "").strip()[-_TRUNC_TAIL:]
    return "⚠️ 模型输出被截断或为空" + (f"\n…{tail}" if tail else "")


def _to_allowed_set(value):
    if value is None:
        return set()
    if isinstance(value, str):
        value = [value]
    return {str(x).strip() for x in value if str(x).strip()}


def _parse_json(raw):
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _extract_share_card_content(content_json, msg_type):
    parts = []
    if msg_type == "share_chat":
        parts.append(f"[shared chat: {content_json.get('chat_id', '')}]")
    elif msg_type == "share_user":
        parts.append(f"[shared user: {content_json.get('user_id', '')}]")
    elif msg_type == "interactive":
        parts.extend(_extract_interactive_content(content_json))
    elif msg_type == "share_calendar_event":
        parts.append(f"[shared calendar event: {content_json.get('event_key', '')}]")
    elif msg_type == "system":
        parts.append("[system message]")
    elif msg_type == "merge_forward":
        parts.append("[merged forward messages]")
    return "\n".join([p for p in parts if p]).strip() or f"[{msg_type}]"


def _extract_interactive_content(content):
    parts = []
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except Exception:
            return [content] if content.strip() else []
    if not isinstance(content, dict):
        return parts
    title = content.get("title")
    if isinstance(title, dict):
        title_text = title.get("content", "") or title.get("text", "")
        if title_text:
            parts.append(f"title: {title_text}")
    elif isinstance(title, str) and title:
        parts.append(f"title: {title}")
    elements = content.get("elements", [])
    if isinstance(elements, list):
        for row in elements:
            if isinstance(row, dict):
                parts.extend(_extract_element_content(row))
            elif isinstance(row, list):
                for el in row:
                    parts.extend(_extract_element_content(el))
    card = content.get("card", {})
    if card:
        parts.extend(_extract_interactive_content(card))
    header = content.get("header", {})
    if isinstance(header, dict):
        header_title = header.get("title", {})
        if isinstance(header_title, dict):
            header_text = header_title.get("content", "") or header_title.get("text", "")
            if header_text:
                parts.append(f"title: {header_text}")
    return [p for p in parts if p]


def _extract_element_content(element):
    parts = []
    if not isinstance(element, dict):
        return parts
    tag = element.get("tag", "")
    if tag in ("markdown", "lark_md"):
        content = element.get("content", "")
        if content:
            parts.append(content)
    elif tag == "div":
        text = element.get("text", {})
        if isinstance(text, dict):
            text_content = text.get("content", "") or text.get("text", "")
            if text_content:
                parts.append(text_content)
        elif isinstance(text, str) and text:
            parts.append(text)
        for field in element.get("fields", []) or []:
            if isinstance(field, dict):
                field_text = field.get("text", {})
                if isinstance(field_text, dict):
                    content = field_text.get("content", "") or field_text.get("text", "")
                    if content:
                        parts.append(content)
    elif tag == "a":
        href = element.get("href", "")
        text = element.get("text", "")
        if href:
            parts.append(f"link: {href}")
        if text:
            parts.append(text)
    elif tag == "button":
        text = element.get("text", {})
        if isinstance(text, dict):
            content = text.get("content", "") or text.get("text", "")
            if content:
                parts.append(content)
        url = element.get("url", "") or (element.get("multi_url", {}) or {}).get("url", "")
        if url:
            parts.append(f"link: {url}")
    elif tag == "img":
        alt = element.get("alt", {})
        if isinstance(alt, dict):
            parts.append(alt.get("content", "[image]") or "[image]")
        else:
            parts.append("[image]")
    for child in element.get("elements", []) or []:
        parts.extend(_extract_element_content(child))
    for col in element.get("columns", []) or []:
        for child in (col.get("elements", []) if isinstance(col, dict) else []):
            parts.extend(_extract_element_content(child))
    return parts


def _extract_post_content(content_json):
    def _parse_block(block):
        if not isinstance(block, dict) or not isinstance(block.get("content"), list):
            return None, []
        texts, images = [], []
        if block.get("title"):
            texts.append(block.get("title"))
        for row in block["content"]:
            if not isinstance(row, list):
                continue
            for el in row:
                if not isinstance(el, dict):
                    continue
                tag = el.get("tag")
                if tag in ("text", "a"):
                    texts.append(el.get("text", ""))
                elif tag == "at":
                    texts.append(f"@{el.get('user_name', 'user')}")
                elif tag == "img" and el.get("image_key"):
                    images.append(el["image_key"])
        text = " ".join([t for t in texts if t]).strip()
        return text or None, images

    root = content_json
    if isinstance(root, dict) and isinstance(root.get("post"), dict):
        root = root["post"]
    if not isinstance(root, dict):
        return "", []
    if "content" in root:
        text, imgs = _parse_block(root)
        if text or imgs:
            return text or "", imgs
    for key in ("zh_cn", "en_us", "ja_jp"):
        if key in root:
            text, imgs = _parse_block(root[key])
            if text or imgs:
                return text or "", imgs
    for val in root.values():
        if isinstance(val, dict):
            text, imgs = _parse_block(val)
            if text or imgs:
                return text or "", imgs
    return "", []


AGENT_TIMEOUT_SEC = 900

agent = None
agent_error = None
agent_thread = None
client, user_tasks, app = None, {}, None
agent_lock = threading.Lock()
GALLEY_STARTUP_FAILURE_LIMIT = 3
_galley_connected_once = False


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


def _has_galley_reconnect_hooks(cli):
    return hasattr(cli, "on_reconnecting") and hasattr(cli, "on_reconnected")


def _assert_galley_lark_ws_contract(cli):
    missing = [
        name
        for name in ("_connect", "_try_connect")
        if not hasattr(cli, name)
    ]
    if not _has_galley_reconnect_hooks(cli) and not hasattr(cli, "_reconnect"):
        missing.append("_reconnect")
    if missing:
        raise RuntimeError(
            "lark-oapi websocket API changed; Galley Feishu Channel depends on "
            f"lark-oapi websocket hooks/private seams ({', '.join(missing)} missing). "
            "Verify Feishu connection status hooks before upgrading lark-oapi."
        )


def _lark_oapi_version():
    try:
        return importlib.metadata.version("lark-oapi")
    except importlib.metadata.PackageNotFoundError:
        return getattr(lark, "__version__", "unknown")


def _galley_hook_path(cli):
    if _has_galley_reconnect_hooks(cli):
        return "public reconnect hooks + private connect hook"
    return "private connect/reconnect hooks"


class GalleyStatusWsClient(lark.ws.Client):
    async def _connect(self):
        # lark-oapi 1.6.8 exposes reconnect lifecycle hooks, but not a first
        # successful-connect hook. Keep this private seam small and verify it in
        # _assert_galley_lark_ws_contract before starting the client.
        global _galley_connected_once
        was_connected = _galley_connected_once
        await super()._connect()
        if getattr(self, "_conn", None) is not None:
            _galley_connected_once = True
            self._auto_reconnect = True
            if not was_connected:
                _emit_galley_status("running")

    async def _reconnect(self):
        if _has_galley_reconnect_hooks(self):
            await super()._reconnect()
            return
        _emit_galley_status("reconnecting", "Feishu long connection disconnected")
        await super()._reconnect()
        _emit_galley_status("running")

    async def _try_connect(self, cnt):
        # Keep running sessions self-healing: some lark-oapi reconnect failures
        # raise instead of returning False, which would stop the receive task.
        try:
            ok = await super()._try_connect(cnt)
        except Exception as e:
            _emit_galley_status("reconnecting", str(e))
            return False
        if not ok:
            _emit_galley_status("reconnecting", f"Feishu reconnect attempt {cnt + 1} failed")
        return ok


def _teardown_lark_client(cli):
    """在重连前彻底停掉上一个 cli 的连接和 loop task。

    lark ws.Client 没有 stop()。它的 _ping_loop / _receive_message_loop /
    _select 都挂在 lark_oapi.ws.client 的模块级 loop 上，且无法自行退出——
    连接断开后这些 task 仍残留，旧连接变成僵尸继续收消息并在 lark SDK
    内部除零（division by zero）。必须从外部取消 task 并 stop loop。

    主线程在 cli.start() 的 loop.run_until_complete(_select()) 上阻塞，
    所以 loop 此刻是 running 的（卡在 sleep），可以用
    run_coroutine_threadsafe 安排 _disconnect 并 stop loop。
    run_until_complete 在 loop.stop() 后会抛 RuntimeError 退出，调用方
    （main 的 while True）捕获后进下一轮，下一轮前会重建一个干净 loop。
    """
    import lark_oapi.ws.client as wsmod
    lp = wsmod.loop
    # 1. 关闭 websocket（client.py 的 _disconnect 会清 _conn 等状态）。
    try:
        if getattr(cli, "_conn", None) is not None and not lp.is_closed():
            if lp.is_running():
                fut = asyncio.run_coroutine_threadsafe(cli._disconnect(), lp)
                fut.result(timeout=5)
            else:
                lp.run_until_complete(cli._disconnect())
    except Exception:
        pass
    # 2. 取消 loop 上的所有 task（ping_loop / receive_message_loop / select）。
    try:
        if not lp.is_closed():
            tasks = [t for t in asyncio.all_tasks(loop=lp) if not t.done()]
            for t in tasks:
                t.cancel()
            if tasks and not lp.is_running():
                lp.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
    except Exception:
        pass
    # 3. stop loop，让 run_until_complete 退出。
    if not lp.is_closed() and lp.is_running():
        try:
            lp.call_soon_threadsafe(lp.stop)
        except Exception:
            pass
    try:
        if not lp.is_running() and not lp.is_closed():
            lp.close()
    except Exception:
        pass
    # 4. 重建一个干净 loop 赋回 lark 模块，保证下一轮 start() 干净起步。
    new_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(new_loop)
    wsmod.loop = new_loop


def _load_config():
    raw = os.environ.get("GALLEY_FEISHU_CONFIG_JSON")
    if raw is not None:
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                return data, "<galley-managed-feishu-config>", True
        except Exception as e:
            raise RuntimeError(f"load Galley Feishu config failed: {e}") from e
        raise RuntimeError("Galley Feishu config must be a JSON object")
    path = _resolve_mykey_path()
    if not path or not path.exists():
        return {}, str(path or ""), False
    try:
        data = _load_dict_config(path)
        return (data if isinstance(data, dict) else {}), str(path), False
    except Exception as e:
        print(f"[ERROR] load mykey failed {path}: {e}")
        return {}, str(path), False


def _feishu_config():
    cfg, path, managed = _load_config()
    app_id = str(cfg.get("fs_app_id", "") or "").strip()
    app_secret = str(cfg.get("fs_app_secret", "") or "").strip()
    allowed = _to_allowed_set(cfg.get("fs_allowed_users", []))
    bind_code = str(cfg.get("fs_owner_bind_code", "") or "").strip() or None
    if managed:
        # Galley-managed mode: an empty allow-list means "locked, waiting
        # for owner pairing", never public access. The agent drives the
        # owner's machine, so anyone-in-the-org access must be an explicit
        # choice ("*"), not a default.
        public = "*" in allowed
    else:
        public = not allowed or "*" in allowed
    return app_id, app_secret, allowed, public, bind_code, path


APP_ID, APP_SECRET, ALLOWED_USERS, PUBLIC_ACCESS, OWNER_BIND_CODE, CONFIG_PATH = _feishu_config()

GALLEY_OWNER_BIND_ATTEMPT_LIMIT = 10
_owner_bind_attempts = 0


def _handle_owner_bind_message(message, open_id):
    """Locked mode (managed config, no owner bound yet): the only input
    that does anything is the pairing code, sent in a p2p chat. Everything
    else is ignored silently — wrong guesses get no reply, so a guesser
    learns nothing; too many wrong guesses invalidate the code entirely
    (reconnect from Galley issues a new one)."""
    global ALLOWED_USERS, OWNER_BIND_CODE, _owner_bind_attempts
    if not OWNER_BIND_CODE:
        print(f"等待绑定但配对码不可用，忽略消息: {open_id}")
        return
    if getattr(message, "chat_type", "") != "p2p":
        print(f"等待绑定，忽略非私聊消息: {open_id}")
        return
    if message.message_type != "text":
        return
    try:
        text = str((json.loads(message.content or "{}") or {}).get("text", "")).strip()
    except Exception:
        return
    if text != OWNER_BIND_CODE:
        _owner_bind_attempts += 1
        print(f"配对码不匹配 ({_owner_bind_attempts}/{GALLEY_OWNER_BIND_ATTEMPT_LIMIT}): {open_id}")
        if _owner_bind_attempts >= GALLEY_OWNER_BIND_ATTEMPT_LIMIT:
            OWNER_BIND_CODE = None
            _emit_galley_status(
                "running",
                "Feishu owner pairing code invalidated after too many wrong attempts; "
                "reconnect from Galley to issue a new code",
            )
        return
    ALLOWED_USERS = {open_id}
    OWNER_BIND_CODE = None
    _emit_galley_status("running", None, ownerOpenId=open_id)
    send_message(open_id, "✓ 已绑定为 Galley 的使用者，现在只响应你的消息。")
    print(f"已绑定 Galley owner: {open_id}")


def get_agent():
    global agent, agent_error, agent_thread
    with agent_lock:
        if agent is not None:
            return agent
        if agent_error:
            raise RuntimeError(agent_error)
        try:
            agent = GeneraticAgent()
            agent_thread = threading.Thread(target=agent.run, daemon=True)
            agent_thread.start()
            return agent
        except Exception as e:
            agent_error = str(e)
            raise


def create_client():
    return lark.Client.builder().app_id(APP_ID).app_secret(APP_SECRET).log_level(lark.LogLevel.INFO).build()


def _mask_secret(value):
    value = str(value or "")
    if len(value) <= 8:
        return "*" * len(value)
    return value[:4] + "*" * (len(value) - 8) + value[-4:]


def check_config(init_agent=False):
    app_id, app_secret, allowed, public_access, _bind_code, path = _feishu_config()
    result = {
        "config_path": path,
        "app_id": app_id,
        "app_secret": _mask_secret(app_secret),
        "app_secret_present": bool(app_secret),
        "public_access": public_access,
        "allowed_users": sorted(allowed),
        "ready": bool(app_id and app_secret),
    }
    if init_agent:
        try:
            ga = get_agent()
            result["agent_ready"] = True
            result["llm_count"] = len(ga.list_llms()) if hasattr(ga, "list_llms") else 0
            result["current_llm"] = ga.get_llm_name() if getattr(ga, "llmclient", None) else ""
        except Exception as e:
            result["agent_ready"] = False
            result["agent_error"] = str(e)
    return result


def _card_raw(elements):
    return json.dumps({
        "schema": "2.0",
        "config": {"streaming_mode": False, "width_mode": "fill"},
        "body": {"elements": elements},
    }, ensure_ascii=False)


def _card(text):
    return _card_raw([{"tag": "markdown", "content": text}])


def _send_raw(receive_id, payload, msg_type, rtype):
    try:
        body = CreateMessageRequest.builder().receive_id_type(rtype).request_body(
            CreateMessageRequestBody.builder().receive_id(receive_id).msg_type(msg_type).content(payload).build()
        ).build()
        r = client.im.v1.message.create(body)
        if r.success():
            return r.data.message_id if r.data else None
        print(f"发送失败: {r.code}, {r.msg}")
    except Exception as e:
        print(f"[ERROR] send_message failed: {e}")
        traceback.print_exc()
    return None


def _patch_card(message_id, card_json):
    try:
        body = PatchMessageRequest.builder().message_id(message_id).request_body(
            PatchMessageRequestBody.builder().content(card_json).build()
        ).build()
        r = client.im.v1.message.patch(body)
        if not r.success():
            print(f"[ERROR] patch_card 失败: {r.code}, {r.msg}")
        return r.success()
    except Exception as e:
        print(f"[ERROR] patch_card exception: {e}")
        traceback.print_exc()
        return False


def send_message(receive_id, content, msg_type="text", use_card=False, receive_id_type="open_id"):
    if use_card:
        return _send_raw(receive_id, _card(content), "interactive", receive_id_type)
    if msg_type == "text":
        return _send_raw(receive_id, json.dumps({"text": content}, ensure_ascii=False), "text", receive_id_type)
    return _send_raw(receive_id, content, msg_type, receive_id_type)


def update_message(message_id, content):
    return _patch_card(message_id, _card(content))


def _upload_image_sync(file_path):
    try:
        with open(file_path, "rb") as f:
            request = CreateImageRequest.builder().request_body(
                CreateImageRequestBody.builder().image_type("message").image(f).build()
            ).build()
            response = client.im.v1.image.create(request)
            if response.success():
                return response.data.image_key
            print(f"[ERROR] upload image failed: {response.code}, {response.msg}")
    except Exception as e:
        print(f"[ERROR] upload image failed {file_path}: {e}")
    return None


def _upload_file_sync(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    file_type = _FILE_TYPE_MAP.get(ext, "stream")
    file_name = os.path.basename(file_path)
    try:
        with open(file_path, "rb") as f:
            request = CreateFileRequest.builder().request_body(
                CreateFileRequestBody.builder().file_type(file_type).file_name(file_name).file(f).build()
            ).build()
            response = client.im.v1.file.create(request)
            if response.success():
                return response.data.file_key
            print(f"[ERROR] upload file failed: {response.code}, {response.msg}")
    except Exception as e:
        print(f"[ERROR] upload file failed {file_path}: {e}")
    return None


def _download_image_sync(message_id, image_key):
    try:
        request = GetMessageResourceRequest.builder().message_id(message_id).file_key(image_key).type("image").build()
        response = client.im.v1.message_resource.get(request)
        if response.success():
            data = response.file.read() if hasattr(response.file, "read") else response.file
            return data, response.file_name
        print(f"[ERROR] download image failed: {response.code}, {response.msg}")
    except Exception as e:
        print(f"[ERROR] download image failed {image_key}: {e}")
    return None, None


def _download_file_sync(message_id, file_key, resource_type="file"):
    if resource_type == "audio":
        resource_type = "file"
    try:
        request = GetMessageResourceRequest.builder().message_id(message_id).file_key(file_key).type(resource_type).build()
        response = client.im.v1.message_resource.get(request)
        if response.success():
            data = response.file.read() if hasattr(response.file, "read") else response.file
            return data, response.file_name
        print(f"[ERROR] download {resource_type} failed: {response.code}, {response.msg}")
    except Exception as e:
        print(f"[ERROR] download {resource_type} failed {file_key}: {e}")
    return None, None


def _download_and_save_media(msg_type, content_json, message_id):
    data, filename = None, None
    if msg_type == "image":
        image_key = content_json.get("image_key")
        if image_key and message_id:
            data, filename = _download_image_sync(message_id, image_key)
            if not filename:
                filename = f"{image_key[:16]}.jpg"
    elif msg_type in ("audio", "file", "media"):
        file_key = content_json.get("file_key")
        if file_key and message_id:
            data, filename = _download_file_sync(message_id, file_key, msg_type)
            if not filename:
                filename = file_key[:16]
            if msg_type == "audio" and filename and not filename.endswith(".opus"):
                filename = f"{filename}.opus"
    if data and filename:
        file_path = os.path.join(MEDIA_DIR, os.path.basename(filename))
        with open(file_path, "wb") as f:
            f.write(data)
        return file_path, filename
    return None, None


def _describe_media(msg_type, file_path, filename):
    if msg_type == "image":
        return f"[image: {filename}]\n[Image: source: {file_path}]"
    if msg_type == "audio":
        return f"[audio: {filename}]\n[File: source: {file_path}]"
    if msg_type in ("file", "media"):
        return f"[{msg_type}: {filename}]\n[File: source: {file_path}]"
    return f"[{msg_type}]\n[File: source: {file_path}]"


def _send_local_file(receive_id, file_path, receive_id_type="open_id"):
    if not os.path.isfile(file_path):
        send_message(receive_id, f"⚠️ 文件不存在: {file_path}", receive_id_type=receive_id_type)
        return False
    ext = os.path.splitext(file_path)[1].lower()
    if ext in _IMAGE_EXTS:
        image_key = _upload_image_sync(file_path)
        if image_key:
            send_message(receive_id, json.dumps({"image_key": image_key}, ensure_ascii=False), msg_type="image", receive_id_type=receive_id_type)
            return True
    else:
        file_key = _upload_file_sync(file_path)
        if file_key:
            msg_type = "media" if ext in _AUDIO_EXTS or ext in _VIDEO_EXTS else "file"
            send_message(receive_id, json.dumps({"file_key": file_key}, ensure_ascii=False), msg_type=msg_type, receive_id_type=receive_id_type)
            return True
    send_message(receive_id, f"⚠️ 文件发送失败: {os.path.basename(file_path)}", receive_id_type=receive_id_type)
    return False


# Known prompt-echo placeholders: FILE_HINT shows the literal example
# `[FILE:filepath]`, and models repeat it (or a variant) when describing
# their own abilities. Mirrors the guard the WeChat frontend already has.
_FILE_MARKER_PLACEHOLDERS = {"filepath", "<filepath>", "path", "<path>", "file_path", "<file_path>", "..."}


def _send_generated_files(receive_id, raw_text, receive_id_type="open_id"):
    for file_path in dict.fromkeys(_extract_files(raw_text)):
        candidate = file_path.strip()
        if not candidate or candidate.lower() in _FILE_MARKER_PLACEHOLDERS:
            continue
        if not os.path.isfile(candidate) and "/" not in candidate and "\\" not in candidate:
            # A bare word that is not an existing file is prompt echo,
            # not a deliverable — log it instead of messaging the user
            # "文件不存在: filepath" after an otherwise fine reply. Paths
            # with separators still warn: a promised file that is really
            # missing is something the user should hear about.
            print(f"忽略非文件路径的 FILE 标记: {candidate!r}")
            continue
        _send_local_file(receive_id, candidate, receive_id_type)


def _build_user_message(message):
    msg_type = message.message_type
    message_id = message.message_id
    content_json = _parse_json(message.content)
    parts, image_paths = [], []
    if msg_type == "text":
        text = str(content_json.get("text", "") or "").strip()
        if text:
            parts.append(text)
    elif msg_type == "post":
        text, image_keys = _extract_post_content(content_json)
        if text:
            parts.append(text)
        for image_key in image_keys:
            file_path, filename = _download_and_save_media("image", {"image_key": image_key}, message_id)
            if file_path and filename:
                parts.append(_describe_media("image", file_path, filename))
                image_paths.append(file_path)
            else:
                parts.append("[image: download failed]")
    elif msg_type in ("image", "audio", "file", "media"):
        file_path, filename = _download_and_save_media(msg_type, content_json, message_id)
        if file_path and filename:
            parts.append(_describe_media(msg_type, file_path, filename))
            if msg_type == "image":
                image_paths.append(file_path)
        else:
            parts.append(f"[{msg_type}: download failed]")
    elif msg_type in ("share_chat", "share_user", "interactive", "share_calendar_event", "system", "merge_forward"):
        parts.append(_extract_share_card_content(content_json, msg_type))
    else:
        parts.append(_MSG_TYPE_MAP.get(msg_type, f"[{msg_type}]"))
    return "\n".join([p for p in parts if p]).strip(), image_paths


def _fmt_tool_call(tc):
    name = tc.get('tool_name', '?')
    args = {k: v for k, v in (tc.get('args') or {}).items() if not k.startswith('_')}
    return f"- `{name}`({json.dumps(args, ensure_ascii=False)[:200]})"


def _build_step_detail(resp, tool_calls):
    """从 LLM response + tool_calls 组装单步展开详情（纯函数）。"""
    parts = []
    thinking = (getattr(resp, 'thinking', '') or '').strip() if resp else ''
    if thinking:
        parts.append(f"### 💭 Thinking\n{thinking}")
    if tool_calls:
        parts.append("### 🛠 Tool Calls\n" + "\n".join(_fmt_tool_call(tc) for tc in tool_calls))
    content = _display_text((getattr(resp, 'content', '') or '')).strip() if resp else ''
    if content and content != '...':
        parts.append(f"### 📝 Output\n{content}")
    return "\n\n".join(parts)


class _TaskCard:
    """飞书任务卡片：单卡片持续 patch；每步一个独立折叠面板（header 显示 summary，展开看详情）。"""
    _DETAIL_LIMIT = 8000

    def __init__(self, receive_id, rid_type):
        self.rid, self.rtype = receive_id, rid_type
        self.steps = []          # [(summary, detail), ...]
        self.status = "🤔 思考中..."
        self.final = None
        self.msg_id = None
        self.start_fallback_sent = False
        self.final_fallback_sent = False

    def _step_panel(self, idx, summary, detail):
        detail = detail or "_(无输出)_"
        if len(detail) > self._DETAIL_LIMIT:
            detail = detail[:self._DETAIL_LIMIT] + f"\n\n…(已截断,共 {len(detail)} 字符)"
        return {
            "tag": "collapsible_panel", "expanded": False,
            "header": {"title": {"tag": "plain_text", "content": f"Turn {idx} · {summary}"}},
            "elements": [{"tag": "markdown", "content": detail}],
        }

    def _build(self):
        els = [{"tag": "markdown", "content": f"**{self.status}**"}]
        for i, (s, d) in enumerate(self.steps, 1):
            els.append(self._step_panel(i, s, d))
        if self.final:
            els += [{"tag": "hr"}, {"tag": "markdown", "content": self.final}]
        return _card_raw(els)

    def _push(self):
        card = self._build()
        if self.msg_id:
            ok = _patch_card(self.msg_id, card)
        else:
            self.msg_id = _send_raw(self.rid, card, "interactive", self.rtype)
            ok = bool(self.msg_id)
        return ok

    def _fallback_text(self, text, *, final=False):
        attr = "final_fallback_sent" if final else "start_fallback_sent"
        if getattr(self, attr):
            return
        setattr(self, attr, True)
        send_message(self.rid, text, receive_id_type=self.rtype)

    # ── 公开接口 ──

    def start(self):
        if not self._push():
            self._fallback_text("🤔 思考中...")

    def step(self, summary, detail=""):
        self.steps.append((summary, detail))
        self.status = f"⏳ 工作中 · Turn {len(self.steps)}"
        self._push()

    def done(self, text):
        self.status = "✅ 已完成"
        self.final = text or "_(无文本输出)_"
        if not self._push():
            self._fallback_text(_display_text(text), final=True)

    def fail(self, msg):
        self.status = f"❌ {msg}"
        if not self._push():
            self._fallback_text(f"❌ {msg}", final=True)


# True while the Galley reporter (runner/im_reporter.py) is draining its own
# synthetic report turn. The agent loop is serial but tasks can queue: a user
# task registered during a report turn would see _fs_active_task_id already
# pointing at itself and stream the report turn's steps into its card. GA
# doesn't tag turns with a task identity, so the reporter marks its window.
_GALLEY_REPORT_TURN_ACTIVE = False


def _make_task_hook(card, task_id, on_final):
    """飞书任务 hook：每轮 patch 卡片状态；结束触发 on_final(raw) 处理附件。"""
    def hook(ctx):
        try:
            if _GALLEY_REPORT_TURN_ACTIVE:
                return
            parent = getattr(ctx.get("self"), "parent", None)
            if getattr(parent, "_fs_active_task_id", None) != task_id:
                return
            if ctx.get('exit_reason'):
                resp = ctx.get('response')
                raw = resp.content if hasattr(resp, 'content') else str(resp)
                if ctx.get('summary'):
                    detail = _build_step_detail(resp, ctx.get('tool_calls') or [])
                    card.step(ctx['summary'], detail)
                on_final(raw)
            elif ctx.get('summary'):
                detail = _build_step_detail(ctx.get('response'), ctx.get('tool_calls') or [])
                card.step(ctx['summary'], detail)
        except Exception as e:
            print(f"[fs hook] error: {e}")
    return hook


# ── Galley conversation UX (managed patch 0029) ──────────────────────────
# Aligned with Telegram / Discord (.scratch/im-polish/issues/03). While a run
# works, the user's message carries a `Typing` reaction: no push, no change
# in the chat list, no trace once it is removed (2026-10-20 device probe).
# The run then posts exactly one new message, a card: its answer (the
# closing step), with a folded 「过程」 panel from two steps on, or its
# ask_user question; a stopped run posts the stop receipt instead. The
# reaction comes off once that message is out. A message sent while a run
# works queues behind it (one agent, FIFO); only the head run reads its
# display queue. The status card above (_TaskCard / _make_task_hook,
# patches 0009 and 0013) is no longer on the run path.

_TYPING_EMOJI = "Typing"
_POLL_SECONDS = 0.5
_ANSWER_PART_LIMIT = 4000
# Message create caps a card's request body at 30 KB.
_CARD_BYTES_LIMIT = 28 * 1024
_PROCESS_STEP_LINES = 30
_PREVIEW_LIMIT = 100
_ASK_USER_HOOK_KEY = "galley_feishu_ask_user"
_ASK_EVENT_LIMIT = 8
_ASK_QUESTION_LIMIT = 3000
_NO_RUNNING_TASK_TEXT = "当前没有在跑的任务"
_EMPTY_ANSWER_WITH_FILES = "已生成附件"
_PANEL_ICON = {"tag": "standard_icon", "token": "down-small-ccm_outlined", "color": "grey", "size": "16px 16px"}
_TURN_MARKER_LINE_RE = re.compile(r"^\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}[ \t]*$", re.M)
_FILE_MARKER_RE = re.compile(r"\[FILE:([^\]]+)\]")
_FENCE_LINE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
_IMAGE_MD_RE = re.compile(r"!\[([^\]]*)\]\(\s*([^)\s]*)[^)]*\)")
_REPLY_NUMBERS_RE = re.compile(r"\s*\d+(?:\s*[,，、;；\s]\s*\d+)*\s*")
# Card Markdown reads these; plain text inside it goes in as entities.
_MD_ESCAPES = {"<": "&#60;", ">": "&#62;", "*": "&#42;", "_": "&#95;", "`": "&#96;", "~": "&#126;"}
_clock = time.monotonic  # run timing; injectable for tests
_runs_cond = threading.Condition()  # guards _RUNS, _worker and _pending_asks
_RUNS = []  # every registered run, in GA's task order
_worker = None  # reads the head run's display queue while runs are registered
_pending_asks = {}  # chat key -> _PendingAsk waiting for its reply
_ask_lock = threading.Lock()  # ask_user events arrive on the GA worker thread
_ask_events = {}  # display queue of the asking task -> ask_user event


def _take_lead_notice():
    """Galley seam (runner/im_resume.py replaces it): a line for the top of
    the next answer or question, "" when there is none."""
    return ""


def _restore_lead_notice():
    """Galley seam: the message that took the notice never went out."""


# ── text ──


def _file_names(text):
    """[FILE:path] markers shown as file names, nothing else touched: the
    transcript cleaning drops markers, so the names go in before it."""
    return _FILE_MARKER_RE.sub(lambda match: os.path.basename(match.group(1)), text or "")


def _answer_from(step_text, raw):
    """A finished task's answer: its closing step cleaned (dcapp's and
    tgapp's cleaning), else the whole transcript, file names shown."""
    return answer_body(_file_names(step_text), _file_names(raw))


def answer_text(raw):
    """Galley seam (runner/im_reporter.py): the answer of a finished task
    from its whole `done` text alone: the closing step, split on GA's
    `LLM Running (Turn N) ...` marker lines, cleaned as an answer, [FILE:]
    markers shown as file names. "" when nothing visible remains."""
    raw = raw or ""
    markers = list(_TURN_MARKER_LINE_RE.finditer(raw))
    return _answer_from(raw[markers[-1].start():] if markers else raw, raw)


def _image_as_link(match):
    alt, url = match.group(1).strip(), match.group(2)
    if url.startswith(("http://", "https://")):
        return f"[{alt or url}]({url})"
    return alt or os.path.basename(url)


def _rewrite_markdown(text):
    """Source rewrite for card Markdown, which shows headings, quotes,
    rules, lists and code as they are (card JSON 2.0): tables become lists
    (a Markdown component shows at most four, paging after five rows), and
    image syntax, which takes uploaded image keys only, becomes a link.
    Code fences are left alone."""
    out, fence = [], ""
    for line in tables_to_lists(text or "").split("\n"):
        match = _FENCE_LINE_RE.match(line)
        if fence:
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence) and not match.group(2).strip():
                fence = ""
            out.append(line)
            continue
        if match and not (match.group(1)[0] == "`" and "`" in match.group(2)):
            fence = match.group(1)
            out.append(line)
            continue
        out.append(_IMAGE_MD_RE.sub(_image_as_link, line))
    return "\n".join(out)


def _md_text(text):
    """Plain text going into card Markdown, shown as typed."""
    return "".join(_MD_ESCAPES.get(ch, ch) for ch in text or "")


def _preview(text):
    """A card's chat-list preview (`config.summary`): its first line of
    text outside code blocks, Markdown marks dropped."""
    fence = False
    for line in (text or "").splitlines():
        if _FENCE_LINE_RE.match(line):
            fence = not fence
            continue
        if fence:
            continue
        line = re.sub(r"^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+•]\s+)", "", line)
        line = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", line)
        line = one_line(re.sub(r"<[^>]+>|[*_`~]", "", line))
        if line.strip("-=|:· "):
            return clip(line, _PREVIEW_LIMIT)
    return ""


def _process_lines(summaries, steps, seconds, width=0):
    """What the 「过程」 panel shows: `N 步 · 用时 X`, then one `NN 摘要`
    line per step (the last 30), each clipped to `width` when given.
    Platform-neutral: a candidate for galley_im_display."""
    lines = [f"{n:02d} {summaries.get(n, '')}".rstrip() for n in range(1, steps + 1)]
    if width:
        lines = [clip(line, width) for line in lines]
    if len(lines) > _PROCESS_STEP_LINES:
        lines = [f"… 前 {len(lines) - _PROCESS_STEP_LINES} 步略"] + lines[-_PROCESS_STEP_LINES:]
    return [fold_label(steps, seconds), *lines]


# ── cards ──


def _card_json(elements, preview=""):
    config = {"streaming_mode": False, "width_mode": "fill"}
    if preview:
        config["summary"] = {"content": preview}
    return json.dumps({"schema": "2.0", "config": config, "body": {"elements": elements}}, ensure_ascii=False)


def _text_line(text, size="normal"):
    """One line of grey plain text: a component per line, since whether a
    newline breaks plain_text is not documented."""
    return {"tag": "div", "text": {"tag": "plain_text", "content": text, "text_size": size, "text_color": "grey"}}


def _process_panel(lines):
    """The answer's 「过程」 entry: a collapsible panel, folded by default.
    The client opens and closes it: no callback, nothing kept in memory,
    and it still opens after a restart."""
    return {
        "tag": "collapsible_panel",
        "expanded": False,
        "vertical_spacing": "4px",
        "header": {
            "title": {"tag": "plain_text", "content": "过程"},
            "vertical_align": "center",
            "icon": dict(_PANEL_ICON),
            "icon_position": "follow_text",
            "icon_expanded_angle": -180,
        },
        "elements": [_text_line(line) for line in lines],
    }


def _answer_card(body, notice="", process=None):
    elements = [_text_line(notice, "notation")] if notice else []
    elements.append({"tag": "markdown", "content": body})
    if process:
        elements.append(_process_panel(process))
    return _card_json(elements, _preview(body))


def _ask_status(pending, answered):
    steps = pending.carry["steps"]
    if answered:
        return f"已回复 · 已完成 {steps} 步"
    if not pending.event["candidates"]:
        return f"⏸ 等你回复 · 已完成 {steps} 步"
    if pending.event.get("multi"):
        return f"⏸ 可多选，回复序号或文字 · 已完成 {steps} 步"
    return f"⏸ 回复序号或文字 · 已完成 {steps} 步"


def _ask_card(pending, chosen=None):
    """The question card: the asking step's narration, the question, the
    candidates numbered (no buttons: the app takes no card callbacks), and
    how to reply as a small last line. Once answered (`chosen`: the
    candidate indexes, [] for a typed answer) its echo: the chosen ticked,
    the rest grey."""
    elements = [_text_line(pending.notice, "notation")] if pending.notice else []
    if pending.narration:
        elements.append({"tag": "markdown", "content": pending.narration})
    question = clip(pending.event["question"], _ASK_QUESTION_LIMIT)
    items = []
    for i, candidate in enumerate(pending.event["candidates"]):
        label = _md_text(one_line(candidate))
        if chosen is not None:
            label = f"✓ {label}" if i in chosen else f"<font color='grey'>{label}</font>"
        items.append(f"{i + 1}. {label}")
    text = "<br>".join(_md_text(line) for line in question.split("\n"))
    if items:
        text += "\n\n" + "\n".join(items)
    elements.append({"tag": "markdown", "content": text})
    elements.append(_text_line(_ask_status(pending, chosen is not None), "notation"))
    return _card_json(elements, clip(one_line(question), _PREVIEW_LIMIT))


def _ask_plain(pending):
    lines = [f"{i + 1}. {one_line(c)}" for i, c in enumerate(pending.event["candidates"])]
    parts = [pending.notice, pending.narration, pending.event["question"], "\n".join(lines), _ask_status(pending, False)]
    return "\n\n".join(part for part in parts if part)


# ── reactions and strict sends ──


def _add_reaction(message_id, emoji_type=_TYPING_EMOJI):
    """Put a reaction on a message; its reaction_id, or None."""
    try:
        request = CreateMessageReactionRequest.builder().message_id(message_id).request_body(
            CreateMessageReactionRequestBody.builder().reaction_type(
                Emoji.builder().emoji_type(emoji_type).build()
            ).build()
        ).build()
        r = client.im.v1.message_reaction.create(request)
        if r.success():
            return getattr(r.data, "reaction_id", None)
        print(f"[FS typing] add failed: {r.code}, {r.msg}", flush=True)
    except Exception as e:
        print(f"[FS typing] add error: {type(e).__name__}: {e}", flush=True)
    return None


def _delete_reaction(message_id, reaction_id):
    try:
        request = DeleteMessageReactionRequest.builder().message_id(message_id).reaction_id(reaction_id).build()
        r = client.im.v1.message_reaction.delete(request)
        if r.success():
            return True
        print(f"[FS typing] remove failed: {r.code}, {r.msg}", flush=True)
    except Exception as e:
        print(f"[FS typing] remove error: {type(e).__name__}: {e}", flush=True)
    return False


class FeishuSendError(RuntimeError):
    """Feishu refused a message (strict sends only)."""


def _create_message(receive_id, content, msg_type, receive_id_type):
    body = CreateMessageRequest.builder().receive_id_type(receive_id_type).request_body(
        CreateMessageRequestBody.builder().receive_id(receive_id).msg_type(msg_type).content(content).build()
    ).build()
    r = client.im.v1.message.create(body)
    if not r.success():
        raise FeishuSendError(f"Feishu refused the message: {r.code}, {r.msg}")
    return r.data.message_id if r.data else None


def deliver_card(receive_id, card, receive_id_type="open_id"):
    """Galley seam (runner/im_reporter.py): send a card; raises on failure."""
    return _create_message(receive_id, card, "interactive", receive_id_type)


def deliver_text(receive_id, text, receive_id_type="open_id"):
    """Galley seam: send text in 4000-character parts; raises on failure."""
    for part in split_text(text, _ANSWER_PART_LIMIT):
        _create_message(receive_id, json.dumps({"text": part}, ensure_ascii=False), "text", receive_id_type)


def report_cards(title, body, footer):
    """Galley seam (runner/im_reporter.py): a completion report as (card,
    plain text) pairs to send in order: a bold title line naming the
    session, the body (rewritten as answers are) and `footer` as a small
    grey last line, split like answers. The plain text is the fallback for
    a card Feishu refuses."""
    parts = split_text(_rewrite_markdown(body), _ANSWER_PART_LIMIT)
    out = []
    for i, part in enumerate(parts):
        elements, plain = [], []
        if i == 0:
            elements.append({"tag": "markdown", "content": f"**{title}**"})
            plain.append(title)
        elements.append({"tag": "markdown", "content": part})
        plain.append(part)
        if i == len(parts) - 1:
            elements.append(_text_line(footer, "notation"))
            plain.append(footer)
        out.append((_card_json(elements, title if i == 0 else _preview(part)), "\n\n".join(plain)))
    return out


# ── runs ──


class _FsRun:
    """One user message's run: a GA task, plus the ask_user segments it
    continues (their steps and time add up; the wait for the reply does
    not count). States: queued / running / asking / done / stopped / error."""

    def __init__(self, chat_key, rid, rtype, message_id, answers_ask):
        self.chat_key, self.rid, self.rtype = chat_key, rid, rtype
        self.message_id = message_id  # the trigger: Typing goes on it
        self.answers_ask = answers_ask  # takes the chat's pending question once it is the head
        self.echo = None  # (question, chosen) to mark answered once it is the head
        self.state = "queued"
        self.dq = self.error = None
        self.base_steps, self.base_elapsed, self.summaries = 0, 0.0, {}
        self.task_turn = 0  # highest GA turn seen in this run's task
        self.turn_texts = {}
        self.started_at = self.ended_at = None
        self.headed = False
        self.lock = threading.Lock()  # the Typing reaction
        self.typing = "none"  # none / adding / up / ending / down
        self.reaction_id = None

    def adopt(self, carry):
        self.base_steps = int(carry.get("steps") or 0)
        self.base_elapsed = float(carry.get("elapsed") or 0.0)
        self.summaries = dict(carry.get("summaries") or {})

    def total_steps(self):
        return self.base_steps + self.task_turn

    def elapsed(self, now):
        """From the task's first display item: time queued does not count."""
        if self.started_at is None:
            return self.base_elapsed
        return self.base_elapsed + max(0.0, now - self.started_at)

    def carry(self, now):
        return {"steps": self.total_steps(), "elapsed": self.elapsed(now), "summaries": dict(self.summaries)}

    def observe(self, item, now):
        """Fold one display-queue item in (tgapp's _TgRun.observe): step k
        settles when an item for a later turn arrives, `done` settles the
        last one. Returns `done`'s per-step texts."""
        if self.started_at is None:
            self.state, self.started_at = "running", now
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
            self.task_turn = turn
        if "done" in item:
            for k in range(1, self.task_turn + 1):
                self.summaries[self.base_steps + k] = step_summary(self.turn_texts.get(k, ""))
        return outputs


class _PendingAsk:
    """A posted ask_user question waiting for its reply: the chat's next
    plain text message answers it and carries the run's steps and clock on."""

    def __init__(self, event, carry):
        self.event, self.carry = event, carry
        self.notice = self.narration = ""
        self.message_id = None  # the question card, once posted

    def answer(self, text):
        """(what GA gets, candidate indexes to tick) for a typed reply: an
        in-range number picks that candidate, several numbers pick several
        on a multi-select question (joined with 「；」, as Telegram's
        「提交」); anything else goes as typed and ticks nothing.
        Platform-neutral: a candidate for galley_im_display."""
        candidates = self.event["candidates"]
        if candidates and _REPLY_NUMBERS_RE.fullmatch(text or ""):
            picks = [int(n) for n in re.findall(r"\d+", text)]
            chosen = sorted({n - 1 for n in picks})
            if all(1 <= n <= len(candidates) for n in picks) and (len(chosen) == 1 or self.event.get("multi")):
                return "；".join(candidates[i] for i in chosen), chosen
        return text, []


def _install_ask_hook(agent):
    """ask_user events, keyed by the asking task's display queue, so only
    the run owning that task claims one (a completion-reporter turn that
    asks is never claimed)."""
    hooks = getattr(agent, "_turn_end_hooks", None)
    if not isinstance(hooks, dict):
        hooks = {}
        agent._turn_end_hooks = hooks

    def hook(ctx):
        event = extract_ask_user_event(ctx)
        if event is None:
            return
        with _ask_lock:
            _ask_events[getattr(agent, "_current_queue", None)] = event
            while len(_ask_events) > _ASK_EVENT_LIMIT:
                _ask_events.pop(next(iter(_ask_events)))

    hooks[_ASK_USER_HOOK_KEY] = hook


def _take_ask_event(dq):
    with _ask_lock:
        return _ask_events.pop(dq, None) if dq is not None else None


def busy():
    """Galley seam (the completion reporter): a user run is registered, or
    GA is on a task."""
    with _runs_cond:
        if _RUNS:
            return True
    return bool(getattr(globals().get("agent"), "is_running", False))


def _enqueue_run(chat_key, rid, rtype, message_id, text, images=None, answers_ask=False):
    """Register a run and hand its task to GA in one step, so _RUNS and GA's
    task queue keep the same order (called on the event thread, in message
    order). A plain text message answers the chat's pending question: right
    away when it is next in line for it, else once the run is the head (a
    message sent before the question went out is still GA's next input)."""
    global _worker
    agent = get_app().agent
    run = _FsRun(chat_key, rid, rtype, message_id, answers_ask)
    with _runs_cond:
        if answers_ask:
            pending = _pending_asks.get(chat_key)
            if pending is not None and not any(r.chat_key == chat_key and r.answers_ask for r in _RUNS):
                del _pending_asks[chat_key]
                text, chosen = pending.answer(text)
                run.adopt(pending.carry)
                run.echo = (pending, chosen)
                run.answers_ask = False
        prompt = text if text.startswith("/") else f"{FILE_HINT}\n\n{text}"
        _RUNS.append(run)
        try:
            run.dq = agent.put_task(prompt, source="feishu", images=images or None)
        except Exception as e:
            run.error = e
        position = len(_RUNS)
        _runs_cond.notify_all()
        if _worker is None:
            _worker = threading.Thread(target=_work, name="galley-feishu-runs", daemon=True)
            _worker.start()
    print(f"[FS run] queued: position={position} continued={run.base_steps > 0}", flush=True)
    return run


def _head():
    """Under _runs_cond: the run GA is on or gets next (a stopped run stays
    listed only until its receipt is out)."""
    return next((run for run in _RUNS if run.state != "stopped"), None)


def _running_run(agent):
    """Under _runs_cond: the user run GA is working on, or None -- also
    while GA runs a completion-reporter turn or sits between tasks, when
    /stop must abort nothing."""
    if not getattr(agent, "is_running", False):
        return None
    current = getattr(agent, "_current_queue", None)
    return next((run for run in _RUNS if run.dq is current and run.state in ("queued", "running")), None)


def _mark_stopped(run):
    # Under _runs_cond, before anything blocks: the worker then never
    # turns the aborted task's `done` into an answer.
    run.state, run.ended_at = "stopped", _clock()


def _retire(run):
    with _runs_cond:
        if run in _RUNS:
            _RUNS.remove(run)
        _runs_cond.notify_all()


def _work():
    """The worker: one at a time, alive while runs are registered."""
    global _worker
    try:
        while True:
            with _runs_cond:
                run = _head()
                if run is None:
                    if not _RUNS:
                        _worker = None
                        return
                    _runs_cond.wait(_POLL_SECONDS)  # stop receipts on their way
                    continue
            try:
                _advance(run)
            except Exception as e:
                print(f"[FS run error] {type(e).__name__}: {e}", flush=True)
                traceback.print_exc()
                _fail_run(run, e)
    finally:
        with _runs_cond:
            if _worker is threading.current_thread():
                _worker = None  # died unexpectedly: the next run starts a new one


def _take_turn(run):
    """The run became the head: it takes the chat's pending question when
    its message answers it, marks the question answered, and puts Typing on
    its message."""
    with _runs_cond:
        if run.answers_ask:
            run.answers_ask = False
            pending = _pending_asks.pop(run.chat_key, None)
            if pending is not None:
                run.adopt(pending.carry)
                run.echo = (pending, [])
    if run.echo is not None:
        pending, chosen = run.echo
        run.echo = None
        if pending.message_id:
            _patch_card(pending.message_id, _ask_card(pending, chosen))
        print(f"[FS ask_user] answered: chosen={len(chosen)}", flush=True)
    _start_typing(run)


def _start_typing(run):
    with run.lock:
        if run.typing != "none" or not run.message_id:
            return
        run.typing = "adding"
    reaction_id = _add_reaction(run.message_id)
    with run.lock:
        run.reaction_id = reaction_id
        ended = run.typing == "ending"
        run.typing = "up"
    if ended:
        _end_typing(run)


def _end_typing(run):
    """Take the run's Typing down; once only, and never left behind by an
    add still on its way (the adder takes it down then)."""
    with run.lock:
        if run.typing == "adding":
            run.typing = "ending"
            return
        reaction_id, run.reaction_id = run.reaction_id, None
        run.typing = "down"
    if reaction_id:
        _delete_reaction(run.message_id, reaction_id)


def _advance(run):
    """One step of the head run: take its turn the first time, then wait up
    to _POLL_SECONDS for its next display item. No timeout ends a run: only
    its `done` or /stop does."""
    if not run.headed:
        run.headed = True
        _take_turn(run)
    if run.error is not None:
        _fail_run(run, run.error)
        return
    try:
        item = run.dq.get(True, _POLL_SECONDS)
    except Q.Empty:
        return
    if not isinstance(item, dict):
        return
    with _runs_cond:
        if run.state not in ("queued", "running"):
            return  # stopped while the item was on its way
        now = _clock()
        outputs = run.observe(item, now)
        if "done" not in item:
            return
        run.ended_at = now
        steps, seconds = run.total_steps(), run.elapsed(now)
        event = _take_ask_event(run.dq)
        pending = None
        if event is None:
            run.state = "done"
        else:
            run.state = "asking"
            pending = _PendingAsk(event, run.carry(now))
            _pending_asks[run.chat_key] = pending
    raw = str(item.get("done") or "")
    try:
        step_text = final_step_text(raw, outputs)
        if pending is None:
            _post_answer(run, raw, step_text, steps, seconds)
        else:
            _post_ask(run, pending, step_text)
        _send_generated_files(run.rid, raw, run.rtype)
    finally:
        _end_typing(run)
        _retire(run)


def _has_files(raw):
    return any(os.path.isfile(path.strip()) for path in _extract_files(raw))


def _post_answer(run, raw, step_text, steps, seconds):
    """The run's message: the closing step, with the 「过程」 panel on the
    last part from two steps on. Cards that Feishu refuses go as text."""
    body = _answer_from(step_text, raw) or (_EMPTY_ANSWER_WITH_FILES if _has_files(raw) else "")
    parts = split_text(_rewrite_markdown(body), _ANSWER_PART_LIMIT)
    notice = _take_lead_notice()
    for i, part in enumerate(parts):
        head = notice if i == 0 else ""
        process = None
        card = _answer_card(part, head)
        if i == len(parts) - 1 and steps >= 2:
            for width in (0, 60, 24):  # long step lines give way before the answer does
                process = _process_lines(run.summaries, steps, seconds, width)
                card = _answer_card(part, head, process)
                if len(card.encode("utf-8")) <= _CARD_BYTES_LIMIT:
                    break
        if _send_raw(run.rid, card, "interactive", run.rtype):
            continue
        plain = "\n\n".join(text for text in (head, part, "\n".join(process or ())) if text)
        if send_message(run.rid, plain, receive_id_type=run.rtype):
            continue
        if head:
            _restore_lead_notice()
        return
    print(f"[FS run] answered: steps={steps}", flush=True)


def _post_ask(run, pending, step_text):
    """Pause for the owner's reply: the question card (text when Feishu
    refuses it)."""
    pending.narration = _rewrite_markdown(visible_text(_file_names(step_text)))
    pending.notice = _take_lead_notice()
    message_id = _send_raw(run.rid, _ask_card(pending), "interactive", run.rtype)
    if message_id is None and send_message(run.rid, _ask_plain(pending), receive_id_type=run.rtype) is None:
        if pending.notice:
            _restore_lead_notice()
    pending.message_id = message_id
    print(f"[FS ask_user] posted: candidates={len(pending.event['candidates'])}", flush=True)


def _fail_run(run, error):
    """A frontend failure (a GA backend error is part of `done` and shows in
    the answer): one `❌ 出错：…` message."""
    try:
        with _runs_cond:
            if run.state == "stopped":
                return  # its stop receipt is the run's message
            run.state = "error"
        label = fold_label(run.total_steps(), run.elapsed(run.ended_at or _clock()))
        text = f"❌ 出错：{error}"
        send_message(run.rid, f"{label}\n{text}" if label else text, receive_id_type=run.rtype)
    finally:
        _end_typing(run)
        _retire(run)


def _post_stopped(run):
    """The stop receipt `⏹ 已停止 · N 步 · 用时 X`; the run leaves the list
    once it is out."""
    try:
        text = stopped_text(run.total_steps(), run.elapsed(run.ended_at or _clock()))
        send_message(run.rid, text, receive_id_type=run.rtype)
    finally:
        _end_typing(run)
        _retire(run)


# ── commands that end the running run ──


def _stop_command(agent, rid, rtype):
    """/stop stops the running run only: queued runs stay, and its stop
    receipt is the only reply. A reporter turn or nothing at all running:
    「当前没有在跑的任务」, nothing aborted."""
    with _runs_cond:
        run = _running_run(agent)
        if run is not None:
            _mark_stopped(run)
    if run is None:
        send_message(rid, _NO_RUNNING_TASK_TEXT, receive_id_type=rtype)
        return
    agent.abort()
    print("[FS run] stopped by command", flush=True)
    _post_stopped(run)


def _new_command(agent, chat_key, rid, rtype):
    """/new: the running run stops (its receipt first), then the
    conversation resets; queued runs go on in the new context, and the
    chat's pending question is dropped."""
    with _runs_cond:
        run = _running_run(agent)
        if run is not None:
            _mark_stopped(run)
        _pending_asks.pop(chat_key, None)
    try:
        reply = _common._reset_conversation(agent)
    finally:
        if run is not None:
            _post_stopped(run)
    send_message(rid, reply, receive_id_type=rtype)


def _restore_command(agent, chat_key, rid, rtype):
    try:
        restored_info, err = _common.format_restore()
        if err:
            send_message(rid, err, receive_id_type=rtype)
            return
        restored, fname, count = restored_info
        with _runs_cond:
            run = _running_run(agent)
            if run is not None:
                _mark_stopped(run)
            _pending_asks.pop(chat_key, None)
        try:
            agent.abort()
            agent.history.extend(restored)
        finally:
            if run is not None:
                _post_stopped(run)
        send_message(rid, f"✅ 已恢复 {count} 轮对话\n来源: {fname}\n(仅恢复上下文，请输入新问题继续)", receive_id_type=rtype)
    except Exception as e:
        send_message(rid, f"❌ 恢复失败: {e}", receive_id_type=rtype)


def _continue_command(agent, chat_key, rid, rtype, cmd):
    """/continue N aborts GA's task on a valid index only: the run it aborts
    is marked stopped inside that abort, before GA can hand the task's
    `done` to the worker (the WeChat conversation's _stopping_on_abort)."""
    stopped = []
    original, own = agent.abort, "abort" in vars(agent)

    def abort(*args, **kwargs):
        with _runs_cond:
            run = _running_run(agent)
            if run is not None:
                _mark_stopped(run)
                stopped.append(run)
            _pending_asks.pop(chat_key, None)
        return original(*args, **kwargs)

    agent.abort = abort
    try:
        reply = _common._handle_continue_frontend(agent, cmd)
    finally:
        if own:
            agent.abort = original
        else:
            del agent.abort
        for run in stopped:
            _post_stopped(run)
    send_message(rid, reply, receive_id_type=rtype)


class FeishuApp(AgentChatMixin):
    label, source, split_limit = "Feishu", "feishu", 4000

    async def send_text(self, chat_id, content, *, receive_id=None, receive_id_type="open_id", **_):
        rid = receive_id or chat_id
        for part in split_text(content, self.split_limit):
            await asyncio.to_thread(send_message, rid, part, "text", False, receive_id_type)

    async def send_done(self, chat_id, raw_text, *, receive_id=None, receive_id_type="open_id", **_):
        rid = receive_id or chat_id
        text = _display_text(raw_text)
        await asyncio.to_thread(send_message, rid, text, "text", False, receive_id_type)
        await asyncio.to_thread(_send_generated_files, rid, raw_text, receive_id_type)

    async def handle_command(self, chat_id, cmd, **ctx):
        """Galley 0029: /stop, /new, /restore and /continue N know the run
        list; everything else is the mixin's."""
        rid = ctx.get("receive_id") or chat_id
        rtype = ctx.get("receive_id_type") or "open_id"
        parts = (cmd or "").split()
        op = (parts[0] if parts else "").lower()
        if op == "/stop":
            return _stop_command(self.agent, rid, rtype)
        if op == "/new":
            return _new_command(self.agent, chat_id, rid, rtype)
        if op == "/restore":
            return _restore_command(self.agent, chat_id, rid, rtype)
        if op == "/continue" and len(parts) > 1:
            return _continue_command(self.agent, chat_id, rid, rtype, cmd)
        return await super().handle_command(chat_id, cmd, **ctx)

    async def run_agent(self, chat_id, text, *, receive_id=None, receive_id_type="open_id", images=None, message_id=None, **_):
        """Galley 0029: registers a run (the mixin's /review lands here); no
        refusal while another one works."""
        _enqueue_run(chat_id, receive_id or chat_id, receive_id_type, message_id, text, images)


def get_app():
    global app
    if app is None:
        app = FeishuApp(get_agent(), user_tasks)
        _install_ask_hook(app.agent)  # Galley 0029
    return app


def _run_async(coro):
    try:
        asyncio.run(coro)
    except Exception:
        traceback.print_exc()


def handle_message(data):
    try:
        return _handle_message_impl(data)
    except Exception:
        # lark SDK 的 _handle_data_frame 会 catch 异常并只打
        # "err: {e}"（无 traceback），导致除零等错误无法定位。
        # 这里补完整 traceback 到 feishu.log，然后 re-raise 保持
        # lark 的错误处理（返回 500 给服务端触发重投递）。
        print("[handle_message] uncaught exception:", flush=True)
        traceback.print_exc()
        raise


def _handle_message_impl(data):
    event, message, sender = data.event, data.event.message, data.event.sender
    message_id = getattr(message, "message_id", "") or ""
    if not _claim_message_once(message_id):
        print(f"忽略重复飞书消息: {message_id}")
        return
    open_id = sender.sender_id.open_id
    chat_id = message.chat_id
    if not PUBLIC_ACCESS and not ALLOWED_USERS:
        # Locked: no owner bound yet. Nothing reaches the agent until the
        # pairing code arrives in a p2p chat.
        _handle_owner_bind_message(message, open_id)
        return
    if not PUBLIC_ACCESS and open_id not in ALLOWED_USERS:
        print(f"未授权用户: {open_id}")
        return
    user_input, image_paths = _build_user_message(message)
    if not user_input:
        if chat_id:
            send_message(chat_id, f"⚠️ 暂不支持处理此类飞书消息：{message.message_type}", receive_id_type="chat_id")
        else:
            send_message(open_id, f"⚠️ 暂不支持处理此类飞书消息：{message.message_type}")
        return
    print(f"收到消息 [{open_id}] ({message.message_type}, {len(image_paths)} images): {user_input[:200]}")
    receive_id = chat_id or open_id
    receive_id_type = "chat_id" if chat_id else "open_id"
    chat_key = receive_id
    if message.message_type == "text" and user_input.startswith("/"):
        threading.Thread(
            target=_run_async,
            args=(get_app().handle_command(chat_key, user_input, receive_id=receive_id, receive_id_type=receive_id_type, message_id=message_id),),
            daemon=True,
        ).start()
        return
    # Galley 0029: registered here, on the event thread, so GA takes the
    # messages in the order they came. Text answers a pending question; a
    # picture or a file does not.
    get_app()
    _enqueue_run(
        chat_key, receive_id, receive_id_type, message_id, user_input, image_paths,
        answers_ask=message.message_type in ("text", "post") and not image_paths,
    )


def main():
    global client, APP_ID, APP_SECRET, ALLOWED_USERS, PUBLIC_ACCESS, OWNER_BIND_CODE, CONFIG_PATH
    APP_ID, APP_SECRET, ALLOWED_USERS, PUBLIC_ACCESS, OWNER_BIND_CODE, CONFIG_PATH = _feishu_config()
    if not APP_ID or not APP_SECRET:
        message = f"请在 mykey 配置中填写 fs_app_id 和 fs_app_secret\n配置文件: {CONFIG_PATH}"
        print(f"错误: {message}", flush=True)
        _emit_galley_status("error", message)
        return 1
    handler = lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(handle_message).build()
    retry_delay = 5
    startup_failures = 0
    while True:
        cli = None
        try:
            client = create_client()
            cli = GalleyStatusWsClient(
                APP_ID,
                APP_SECRET,
                event_handler=handler,
                log_level=lark.LogLevel.INFO,
                auto_reconnect=False,
            )
            try:
                _assert_galley_lark_ws_contract(cli)
            except RuntimeError as e:
                _emit_galley_status("error", str(e))
                return 1
            if _has_galley_reconnect_hooks(cli):
                cli.on_reconnecting = lambda: _emit_galley_status(
                    "reconnecting",
                    "Feishu long connection disconnected",
                )
                cli.on_reconnected = lambda: _emit_galley_status("running")
            print(
                f"[INFO] lark-oapi={_lark_oapi_version()} "
                f"hookPath={_galley_hook_path(cli)} teardown=module-loop-reset",
                flush=True,
            )
            print("=" * 50 + "\n飞书 Agent 已启动（长连接模式）\n" + f"App ID: {APP_ID}\n配置: {CONFIG_PATH}\n等待消息...\n" + "=" * 50, flush=True)
            cli.start()
            retry_delay = 5
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"[WARN] 飞书长连接断开或启动失败: {e}", flush=True)
            traceback.print_exc()
            if not _galley_connected_once:
                startup_failures += 1
                if startup_failures >= GALLEY_STARTUP_FAILURE_LIMIT:
                    _emit_galley_status("error", str(e))
                    return 1
            _emit_galley_status("reconnecting", str(e))
        finally:
            # 彻底清理上一个 cli 的连接和 loop task，避免僵尸连接残留
            # 导致 division by zero 和消息重复投递。即使 start() 正常退出
            # （不会发生）或 return，teardown 也安全（_conn 为 None 时跳过）。
            if cli is not None:
                _teardown_lark_client(cli)
        print(f"[INFO] {retry_delay}s 后重连飞书长连接...", flush=True)
        time.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, 120)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="A3Agent Feishu frontend")
    parser.add_argument("--check", action="store_true", help="只检查飞书配置，不启动长连接")
    parser.add_argument("--check-agent", action="store_true", help="检查配置并初始化 Agent/LLM")
    args = parser.parse_args()
    if args.check or args.check_agent:
        print(json.dumps(check_config(init_agent=args.check_agent), ensure_ascii=False, indent=2), flush=True)
    else:
        raise SystemExit(main())
