"""Desktop metadata and MR/L4 replay. Never writes conversation bodies."""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path
import re
import zipfile

try:
    from .continue_cmd import _pairs, _parse_native_history, _user_text, extract_ui_messages_text
except ImportError:
    from continue_cmd import _pairs, _parse_native_history, _user_text, extract_ui_messages_text

_HEADER = re.compile(r'^=== Prompt ===\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)', re.M)
_LOG_NAME = re.compile(r'model_responses_[\w-]+\.txt\Z')


def _stamp(value, default=0):
    try:
        value = float(value)
        return value if math.isfinite(value) and 0 <= value <= 253402214400 else default
    except (TypeError, ValueError):
        return default


def preview(value):
    return value.strip()[:256] if isinstance(value, str) else ''


def metadata(item):
    """Bounded text anchors only; legacy message bodies are used but never returned."""
    users = [m for m in item.get('messages', []) if isinstance(m, dict) and m.get('role') == 'user']
    first = users[0] if users else {}
    refs = []
    for ref in item.get('log_refs', []) or []:
        if not isinstance(ref, dict):
            continue
        name = ref.get('name', '')
        refs.append({'name': name if isinstance(name, str) and _LOG_NAME.fullmatch(name) else '',
                     'started_at': _stamp(ref.get('started_at')),
                     'first_message': preview(ref.get('first_message'))})
    return {'storage_version': 2,
            'first_message': preview(item.get('first_message') or first.get('content')),
            'first_message_at': _stamp(item.get('first_message_at'), _stamp(first.get('ts'), _stamp(item.get('created_at')))),
            'log_refs': refs,
            'has_content': bool(item.get('has_content') or users or item.get('llm_history') or refs)}


def legacy_anchors(item):
    """Old Desktop versions could create multiple MR files after restarts."""
    return [{'name': '', 'started_at': _stamp(m.get('ts'), _stamp(item.get('created_at'))),
             'first_message': preview(m.get('content'))}
            for m in item.get('messages', [])
            if isinstance(m, dict) and m.get('role') == 'user' and preview(m.get('content'))]


def _first_time(text):
    m = _HEADER.search(text)
    if m:
        try:
            return dt.datetime.strptime(m[1], '%Y-%m-%d %H:%M:%S').timestamp()
        except (ValueError, OverflowError, OSError):
            pass
    return 0


def _matches(text, ref):
    started = _first_time(text)
    expected = ref.get('started_at', 0)
    if not started or not expected or abs(started - expected) > 300:
        return False
    anchor = preview(ref.get('first_message'))
    if not anchor:
        return False
    pairs = _pairs(text)
    if not pairs:
        return False
    # Native prompts may prepend attachment paths; raw archives contain USER markers.
    prompt = _user_text(pairs[0][0]) or pairs[0][0]
    return anchor in prompt


def resolve(root, ref):
    """MR first, then time/first-message matching in L4. ZIP reads stay in memory."""
    root = Path(root)
    mr = root / 'temp' / 'model_responses'
    name = ref.get('name', '')
    direct = mr / name if name and _LOG_NAME.fullmatch(name) else None
    candidates = ([direct] if direct and direct.is_file() else [])
    candidates += [p for p in mr.glob('model_responses_*.txt') if p != direct]
    for path in candidates:
        try:
            with path.open(encoding='utf-8', errors='replace') as f:
                head = f.read(65536)
                started = _first_time(head)
                if not started or abs(started - ref.get('started_at', 0)) > 300:
                    continue
                text = head + f.read()
            if _matches(text, ref):
                return text, {**ref, 'name': path.name, 'started_at': started}
        except OSError:
            continue
    stamp = ref.get('started_at', 0)
    if not stamp:
        return None
    l4 = root / 'memory' / 'L4_raw_sessions'
    # Month/minute names avoid scanning/decompressing the full archive corpus.
    moment = dt.datetime.fromtimestamp(stamp)
    moments = [moment + dt.timedelta(minutes=i) for i in range(-5, 6)]
    prefixes = {t.strftime('%m%d_%H%M') for t in moments}
    months = {t.strftime('%Y-%m') for t in moments}
    for month in sorted(months):
        archive = l4 / (month + '.zip')
        try:
            with zipfile.ZipFile(archive) as z:
                for member in z.infolist():
                    if Path(member.filename).name[:9] not in prefixes or not member.filename.endswith('.txt'):
                        continue
                    text = z.read(member).decode('utf-8', errors='replace')
                    if _matches(text, ref):
                        return text, {**ref, 'started_at': _first_time(text)}
        except (OSError, zipfile.BadZipFile, RuntimeError):
            continue
    for path in l4.glob('*.txt'):
        if path.name[:9] in prefixes:
            try:
                text = path.read_text(encoding='utf-8', errors='replace')
                if _matches(text, ref):
                    return text, {**ref, 'started_at': _first_time(text)}
            except OSError:
                pass
    return None


def replay(text):
    pairs = _pairs(text)
    native = _parse_native_history(pairs) if pairs else None
    if native is not None:
        return extract_ui_messages_text(text), native
    # Raw logs / stripped L4: replay preserved prose; continuation is semantic.
    messages = []
    for prompt, response in pairs:
        match = re.search(r'^=== USER ===\s*\n(.*?)(?=^=== ASSISTANT ===|\Z)', prompt, re.M | re.S)
        user = match[1].strip() if match else ''
        if user:
            messages.append({'role': 'user', 'content': user})
        if response.strip():
            messages.append({'role': 'assistant', 'content': response.strip()})
    return messages, None


def load(root, item, anchors=None):
    """Return replay and small updated index, or None when every source is gone."""
    meta = metadata(item)
    refs = meta['log_refs'] or anchors or [
        {'name': '', 'started_at': meta['first_message_at'], 'first_message': meta['first_message']}]
    messages, history, found, seen = [], [], [], set()
    semantic = False
    for ref in refs:
        result = resolve(root, ref)
        if result is None:
            continue
        text, located = result
        identity = (located.get('name'), _first_time(text))
        if identity in seen:
            continue
        seen.add(identity)
        ui, native = replay(text)
        if not ui:
            continue
        found.append(located)
        messages.extend({**m, 'ts': located['started_at']} for m in ui)
        if native is None:
            semantic = True
        else:
            history.extend(native)
    if not found and meta['has_content']:
        return None
    if semantic:
        history = [{'role': m['role'], 'content': [{'type': 'text', 'text': m['content']}]} for m in messages]
    for i, message in enumerate(messages, 1):
        message['id'] = i
    meta['log_refs'] = found or meta['log_refs']
    return messages, history or None, meta


def restore_agent(agent, root, item):
    """Restore execution state and outputs together; never publish a half-restored GA."""
    restored = load(root, item)
    if restored is None:
        raise FileNotFoundError("history source no longer exists")
    messages, history, meta = restored
    try:
        from .continue_cmd import _derive_hist_info
    except ImportError:
        from continue_cmd import _derive_hist_info
    backend = agent.llmclient.backend
    if not hasattr(backend, 'history'):
        raise RuntimeError("model backend does not support history restoration")
    outputs = []
    for message in messages:
        if message['role'] == 'user':
            outputs.append({'input': message['content'], 'outputs': [], 'ts': message.get('ts')})
        elif message['role'] == 'assistant' and outputs:
            outputs[-1]['outputs'].extend(message.get('turn_segs') or [message['content']])
    backend.history = list(history or [])
    agent.history = _derive_hist_info(history or [])
    agent.all_outputs = outputs
    return meta


def display_messages(outputs):
    """Disposable desktop projection; the GA output list is authoritative."""
    messages = []
    for task in outputs:
        messages.append({'id': len(messages) + 1, 'role': 'user',
                         'content': task['input'], 'ts': task.get('ts')})
        steps = task.get('outputs') or []
        if steps:
            messages.append({'id': len(messages) + 1, 'role': 'assistant',
                             'content': ''.join(steps), 'turn_segs': list(steps), 'ts': task.get('ts')})
    return messages
