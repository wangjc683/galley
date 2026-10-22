"""Real HubClient websocket transport; isolated GA with no model/API calls."""
import asyncio
import json
import queue
import sys
from types import SimpleNamespace
from pathlib import Path

from test_bridge_sessions import manager, tmp_ga_root, _mod, _make_stub
from frontends import hub


class FakeAgent:
    def __init__(self):
        self.llm_no = 0
        self.is_running = False
        self.intervene = ""
        self.all_outputs = []
        self.llmclient = SimpleNamespace(backend=SimpleNamespace(name="zero", history=[]))

    def run(self):
        pass

    def list_llms(self):
        return [(0, "zero", None), (1, "one", None)]

    def next_llm(self, no):
        self.llm_no = no
        self.llmclient.backend.name = ["zero", "one"][no]

    def put_task(self, text, **kwargs):
        self.q = queue.Queue()
        self.is_running = text == "hold"
        self.all_outputs.append({"input": text, "outputs": ["answer:" + text]})
        if not self.is_running:
            self.q.put({"done": "answer:" + text, "outputs": ["answer:" + text]})
        return self.q

    def abort(self):
        self.is_running = False
        if hasattr(self, "q"):
            self.q.put({"done": "stopped"})


def test_desktop_hub_roundtrip(manager, monkeypatch):
    from websockets.asyncio.server import serve
    monkeypatch.setattr(hub, "serve", lambda: None)
    monkeypatch.setattr(manager, "ensure_ga_import_path", lambda: Path(manager.ga_root))
    monkeypatch.setitem(sys.modules, "agentmain", _make_stub("agentmain", {"GenericAgent": FakeAgent}))
    monkeypatch.setattr(sys.modules["plan_state"], "sync_plan_path_from_text", lambda *a: None, raising=False)

    events = []
    monkeypatch.setattr(_mod.hub, "emit", events.append)

    async def exercise():
        arrivals = asyncio.Queue()
        peers = []

        async def accepted(ws):
            hello = json.loads(await ws.recv())
            replies = asyncio.Queue()
            await arrivals.put((ws, hello, replies))
            async for message in ws:
                await replies.put(json.loads(message))

        async def rpc(peer, op, **kwargs):
            ws, _, replies = peer
            await ws.send(json.dumps({"op": op, "id": 1, **kwargs}))
            return (await asyncio.wait_for(replies.get(), 3))["data"]

        async def wait_for(predicate):
            for _ in range(150):
                if predicate():
                    return
                await asyncio.sleep(.02)
            raise AssertionError("timed out waiting for bridge/GA state")

        async with serve(accepted, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            monkeypatch.setattr(hub, "URL", f"ws://127.0.0.1:{port}/ws")
            sessions = [manager.create_session(), manager.create_session()]
            try:
                for sess in sessions:
                    manager.make_agent(sess)
                    peers.append(await asyncio.wait_for(arrivals.get(), 3))
                assert len({p[1]["name"] for p in peers}) == 2
                assert peers[0][1]["name"] == f"desktop-{sessions[0].id}"
                assert set(peers[0][1]["caps"]) == {"get", "put", "abort", "llm", "inject"}
                assert (await rpc(peers[0], "put_task", text="hello"))["accepted"]
                await wait_for(lambda: not manager._session_has_unfinished_work(sessions[0]))
                assert [m["content"] for m in sessions[0].messages] == ["hello", "answer:hello"]
                assert not sessions[1].messages
                assert (await rpc(peers[0], "get"))["tasks"][0]["input"] == "hello"
                assert (await rpc(peers[0], "seg", i=0, j=0))["content"] == "answer:hello"
                assert (await rpc(peers[0], "llm"))["items"] == ["zero", "one"]
                before = len(events)
                assert (await rpc(peers[0], "llm", no=1))["cur"] == 1
                assert len(events) == before + 1
                assert events[-1]["type"] == "session-state"
                assert events[-1]["sessionId"] == sessions[0].id
                assert events[-1]["status"] == "idle"
                assert events[-1]["state"] == "model"
                assert sessions[0].llm_no == 1
                saved = json.loads((manager._sessions_dir / f"{sessions[0].id}.json").read_text())
                assert saved["llm_no"] == 1
                for invalid in (-1, 2, "1", True):
                    assert (await rpc(peers[0], "llm", no=invalid))["code"] == "badop"
                assert len(events) == before + 1
                assert manager._live_model(sessions[0])["llmNo"] == 1
                assert sessions[1].agent.llm_no == 0
                assert (await rpc(peers[0], "put_task", text="hold"))["accepted"]
                await wait_for(lambda: sessions[0].agent.is_running)
                assert (await rpc(peers[0], "llm", no=0))["code"] == "busy"
                assert sessions[0].agent.llm_no == 1
                assert (await rpc(peers[0], "put_task", text="extra"))["code"] == "busy"
                assert (await rpc(peers[0], "inject", kind="intervene", text="steer"))["ok"]
                assert sessions[0].agent.intervene == "steer"
                await rpc(peers[0], "abort")
                await wait_for(lambda: not manager._session_has_unfinished_work(sessions[0]))
                assert sessions[0].status == "cancelled"
                manager._maintenance_token = "test"
                assert (await rpc(peers[1], "put_task", text="blocked"))["code"] == "busy"
                manager._maintenance_token = None
                assert manager.delete_session(sessions[0].id)
                await asyncio.wait_for(peers[0][0].wait_closed(), 3)
                assert sessions[0].agent._hub._closed
                assert manager._hub_command(sessions[0], "put", "stale")["code"] == "gone"
                assert (await rpc(peers[1], "get"))["nt"] == 0
            finally:
                manager._maintenance_token = None
                for sess in sessions:
                    if sess.agent:
                        sess.agent.abort()
                        sess.agent._hub.close()
                for ws, _, _ in peers:
                    await asyncio.wait_for(ws.wait_closed(), 3)

    asyncio.run(exercise())


def test_closed_hub_never_connects(monkeypatch):
    import websockets
    def unexpected(*args, **kwargs):
        raise AssertionError("closed HubClient must not connect")
    monkeypatch.setattr(websockets, "connect", unexpected)
    client = hub.HubClient("closed")
    client.close()
    asyncio.run(client._loop())


def test_lazy_restore_populates_ga_once(manager, monkeypatch):
    from test_desktop_history import seed_mr, record
    import desktop_history
    seed_mr(Path(manager.ga_root), 'model_responses_lazy.txt')
    meta = record('model_responses_lazy.txt')
    meta.update(id='sess-lazy', title='lazy', cwd=manager.ga_root, llm_no=1)
    sess = manager._session_from_item(meta)
    manager.sessions[sess.id] = sess
    assert sess.agent is None and sess.messages == []
    assert not hasattr(sess, 'llm_history')
    assert manager.snapshot(sess)['loaded'] is False
    connections = []
    monkeypatch.setattr(hub, 'connect', lambda agent, *args, **kw: connections.append(agent))
    monkeypatch.setattr(manager, 'ensure_ga_import_path', lambda: Path(manager.ga_root))
    monkeypatch.setitem(sys.modules, 'agentmain', _make_stub('agentmain', {'GenericAgent': FakeAgent}))
    assert manager.restore_context(sess.id)['restored']
    agent = sess.agent
    assert agent.llm_no == 1
    assert agent.llmclient.backend.history
    assert agent.history
    assert agent.all_outputs[0]['input'] == 'hello'
    assert 'world' in ''.join(agent.all_outputs[0]['outputs'])
    assert sess.messages == desktop_history.display_messages(agent.all_outputs)
    assert connections == [agent]
    assert not manager.restore_context(sess.id)['restored']
    assert connections == [agent] and sess.agent is agent
    assert manager.snapshot(sess)['loaded'] is True


def test_missing_history_never_connects(manager, monkeypatch):
    from test_desktop_history import record
    meta = record('model_responses_missing.txt')
    meta.update(id='sess-missing', title='missing', cwd=manager.ga_root)
    sess = manager._session_from_item(meta)
    manager.sessions[sess.id] = sess
    monkeypatch.setattr(manager, 'ensure_ga_import_path', lambda: Path(manager.ga_root))
    monkeypatch.setitem(sys.modules, 'agentmain', _make_stub('agentmain', {'GenericAgent': FakeAgent}))
    connections = []
    monkeypatch.setattr(hub, 'connect', lambda *a, **kw: connections.append(a))
    import pytest
    with pytest.raises(_mod.web.HTTPNotFound):
        manager.restore_context(sess.id)
    assert sess.agent is None and not connections
    assert sess.id not in manager.sessions


def test_display_cache_is_rebuildable_and_follows_ga(manager):
    sess = manager.create_session()
    sess.agent = FakeAgent()
    sess.agent.all_outputs = [{'input': 'one', 'outputs': ['answer1']}]
    manager._sync_display_cache(sess)
    prefix = sess.messages[0]
    assert [m['content'] for m in sess.messages] == ['one', 'answer1']
    sess.messages[0]['ts'] = 12345
    sess.agent.all_outputs.append({'input': 'two', 'outputs': ['answer2']})
    manager._sync_display_cache(sess)
    assert [m['content'] for m in sess.messages] == ['one', 'answer1', 'two', 'answer2']
    assert sess.messages[0]['ts'] == 12345
    sess.agent.all_outputs.append({'input': 'three', 'outputs': ['answer3']})
    prefix = sess.messages[0]
    manager._sync_display_cache(sess)
    assert sess.messages[0] is prefix
    sess.messages.clear()
    manager._sync_display_cache(sess)
    assert len(sess.messages) == 6
    sess.agent.all_outputs.clear()
    manager._sync_display_cache(sess)
    assert sess.messages == []


def test_new_session_is_not_pending_restore_until_bridge_reload(manager, monkeypatch):
    sess = manager.create_session()
    assert sess.agent is None
    assert manager.snapshot(sess)['loaded'] is True
    def unexpected(*args, **kwargs):
        raise AssertionError('normal session must not enter history restoration')
    monkeypatch.setattr(manager, 'make_agent', unexpected)
    assert manager.restore_context(sess.id)['restored'] is False
    manager.set_session_model(sess.id, 1)
    assert manager.snapshot(sess)['loaded'] is True
    assert 'pending_restore' not in manager._session_dict(sess)
    manager.sessions.clear()
    manager._load_sessions()
    restored = manager.sessions[sess.id]
    assert restored.agent is None
    assert manager.snapshot(restored)['loaded'] is False


def test_new_prompt_initializes_ga_without_restore_path(manager, monkeypatch):
    monkeypatch.setattr(sys.modules['plan_state'], 'sync_plan_path_from_text', lambda *a: None, raising=False)
    sess = manager.create_session()
    monkeypatch.setattr(manager, 'ensure_ga_import_path', lambda: Path(manager.ga_root))
    monkeypatch.setitem(sys.modules, 'agentmain', _make_stub('agentmain', {'GenericAgent': FakeAgent}))
    monkeypatch.setattr(hub, 'connect', lambda *a, **kw: None)
    def unexpected(*args, **kwargs):
        raise AssertionError('new prompt must not enter history restoration')
    monkeypatch.setattr(manager, 'restore_context', unexpected)
    result = manager.submit_prompt(sess.id, 'hello')
    assert result['accepted']
    sess.thread.join(timeout=3)
    assert not sess.thread.is_alive()
    assert sess.agent is not None
    assert manager.snapshot(sess)['loaded'] is True
    assert sess.status == 'idle'
