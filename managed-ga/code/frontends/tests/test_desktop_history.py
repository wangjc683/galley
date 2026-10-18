"""Metadata-only persistence and MR -> L4 recovery contract."""
import datetime as dt
import json
from pathlib import Path
import zipfile

from frontends import desktop_history as h
from frontends.data_backup import canonical_session_record

STAMP = dt.datetime(2026, 10, 17, 10, 0).timestamp()


def log_text(user='hello', answer='world', stamp=STAMP):
    moment = dt.datetime.fromtimestamp(stamp).strftime('%Y-%m-%d %H:%M:%S')
    prompt = json.dumps({'role': 'user', 'content': [{'type': 'text', 'text': user}]})
    response = repr([{'type': 'text', 'text': answer}])
    return f'=== Prompt === {moment}\n{prompt}\n=== Response === {moment}\n{response}\n'


def seed_mr(root, name='model_responses_test.txt', **kwargs):
    path = root / 'temp' / 'model_responses' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(log_text(**kwargs), encoding='utf-8')
    return path


def record(name='model_responses_test.txt', user='hello', stamp=STAMP):
    return {'first_message': user, 'first_message_at': stamp, 'has_content': True,
            'log_refs': [{'name': name, 'started_at': stamp, 'first_message': user}]}


def seed_zip(root, text, stamp=STAMP):
    moment = dt.datetime.fromtimestamp(stamp)
    path = root / 'memory' / 'L4_raw_sessions' / (moment.strftime('%Y-%m') + '.zip')
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(moment.strftime('%m%d_%H%M') + '-1017_1001.txt', text)
    return path


def test_canonical_never_persists_bodies():
    data = canonical_session_record({'id': 'sess-test', 'messages': [
        {'role': 'user', 'content': 'x' * 10000, 'ts': STAMP},
        {'role': 'assistant', 'content': 'PRIVATE_BODY', 'turn_segs': ['PRIVATE_BODY']}],
        'llm_history': [{'role': 'user', 'content': 'PRIVATE_HISTORY'}]})
    assert len(data['first_message']) == 256
    assert data['first_message_at'] == STAMP
    assert 'messages' not in data and 'llm_history' not in data
    assert 'PRIVATE' not in json.dumps(data)
    assert len(json.dumps(data)) < 1200


def test_mr_wins_over_archive(tmp_path):
    seed_mr(tmp_path, answer='MR answer')
    seed_zip(tmp_path, log_text(answer='L4 answer'))
    ui, history, meta = h.load(tmp_path, record())
    assert 'MR answer' in ui[-1]['content']
    assert history[-1]['content'][0]['text'] == 'MR answer'
    assert meta['log_refs'][0]['name'] == 'model_responses_test.txt'


def test_l4_zip_replay_never_extracts(tmp_path):
    seed_zip(tmp_path, log_text())
    before = {p for p in tmp_path.rglob('*') if p.is_file()}
    ui, history, _ = h.load(tmp_path, record())
    assert ui[0]['content'] == 'hello'
    assert 'world' in ui[-1]['content']
    assert len(history) == 2
    assert before == {p for p in tmp_path.rglob('*') if p.is_file()}


def test_raw_l4_semantic_recovery(tmp_path):
    text = ('=== Prompt === 2026-10-17 10:00:00\n=== USER ===\nhello\n'
            '=== Response === 2026-10-17 10:00:01\nraw answer\n')
    seed_zip(tmp_path, text)
    ui, history, _ = h.load(tmp_path, record())
    assert ui[-1]['content'] == 'raw answer'
    assert history[0]['content'][0]['text'] == 'hello'


def test_missing_sources_silently_skip_nonempty(tmp_path):
    assert h.load(tmp_path, record()) is None
    assert h.load(tmp_path, {'id': 'empty'})[0] == []


def test_wrong_time_or_first_message_is_not_another_session(tmp_path):
    seed_mr(tmp_path)
    assert h.load(tmp_path, record(user='other')) is None
    assert h.load(tmp_path, record(stamp=STAMP + 3600)) is None


def test_legacy_metadata_discovers_mr(tmp_path):
    seed_mr(tmp_path)
    item = {'messages': [{'role': 'user', 'content': 'hello', 'ts': STAMP}]}
    result = h.load(tmp_path, item, h.legacy_anchors(item))
    assert result[2]['log_refs'][0]['name'] == 'model_responses_test.txt'


def test_multiple_segments_partial_missing_and_dedup(tmp_path):
    seed_mr(tmp_path)
    seed_mr(tmp_path, 'model_responses_next.txt', user='next', stamp=STAMP + 3600)
    item = record()
    item['log_refs'] += record('model_responses_next.txt', 'next', STAMP + 3600)['log_refs']
    item['log_refs'] += record('model_responses_missing.txt', 'gone', STAMP + 7200)['log_refs']
    item['log_refs'].append(item['log_refs'][0])
    ui, history, meta = h.load(tmp_path, item)
    assert [m['content'] for m in ui if m['role'] == 'user'] == ['hello', 'next']
    assert len(history) == 4
    assert len(meta['log_refs']) == 2


def test_corrupt_zip_is_silent(tmp_path):
    path = seed_zip(tmp_path, log_text())
    path.write_bytes(b'not a zip')
    assert h.load(tmp_path, record()) is None


def test_path_traversal_is_not_a_log_reference(tmp_path):
    data = h.metadata(record('../../outside.txt'))
    assert data['log_refs'][0]['name'] == ''
    assert h.load(tmp_path, data) is None


def test_month_boundary_matches_archive(tmp_path):
    stamp = dt.datetime(2026, 10, 1, 0, 0).timestamp()
    seed_zip(tmp_path, log_text(stamp=stamp), stamp)
    assert h.load(tmp_path, record(stamp=stamp - 60)) is not None


def test_missing_file_can_be_recovered_by_metadata(tmp_path):
    seed_mr(tmp_path, 'model_responses_renamed.txt')
    result = h.load(tmp_path, record())
    assert result[2]['log_refs'][0]['name'] == 'model_responses_renamed.txt'


def test_large_history_does_not_grow_persisted_metadata():
    a = {'id': 'sess-test', **record(), 'messages': [{'role': 'user', 'content': 'hello'}]}
    small = canonical_session_record(a, now=STAMP)
    a['messages'].extend({'role': 'assistant', 'content': 'x' * 5000} for _ in range(200))
    a['llm_history'] = [{'role': 'assistant', 'content': 'y' * 100000}]
    assert canonical_session_record(a, now=STAMP) == small
    assert len(json.dumps(small)) < 1200


def test_archive_then_hot_continuation_chain(tmp_path):
    seed_zip(tmp_path, log_text())
    seed_mr(tmp_path, 'model_responses_next.txt', user='next', stamp=STAMP + 3600)
    item = record()
    item['log_refs'] += record('model_responses_next.txt', 'next', STAMP + 3600)['log_refs']
    ui, history, _ = h.load(tmp_path, item)
    assert [m['content'] for m in ui if m['role'] == 'user'] == ['hello', 'next']
    assert len(history) == 4


def test_replay_preserves_native_message_time():
    messages, _ = h.replay(log_text())
    assert [m['ts'] for m in messages] == [STAMP, STAMP]
