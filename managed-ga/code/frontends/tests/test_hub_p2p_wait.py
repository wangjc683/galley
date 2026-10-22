"""Saved PC pairing waits for a phone, but still reacts to signal failure."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

FRONTENDS = Path(__file__).resolve().parents[1]


def test_only_saved_pairing_waits_indefinitely():
    tree = ast.parse((FRONTENDS / 'hub_p2p.py').read_text(encoding='utf-8'))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
    saved = [n for n in calls if isinstance(n.func, ast.Name)
             and n.func.id == 'connect_saved']
    assert len(saved) == 1
    opts = {k.arg: ast.literal_eval(k.value) for k in saved[0].keywords
            if k.arg in ('peer_timeout', 'direct_timeout')}
    assert opts == {'peer_timeout': None, 'direct_timeout': 15}
    invite = [n for n in calls if isinstance(n.func, ast.Attribute)
              and n.func.attr == 'connect']
    assert invite and all(k.arg != 'peer_timeout' for n in invite for k in n.keywords)


def signal_stub():
    # Execute the actual method without importing optional WebRTC dependencies.
    tree = ast.parse((FRONTENDS / 'p2p_ws_client.py').read_text(encoding='utf-8'))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Signal')
    method = next(n for n in cls.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'expect')
    ns = {'asyncio': asyncio}
    exec(compile(ast.Module(body=[method], type_ignores=[]), '<Signal.expect>', 'exec'), ns)
    queues = {}
    obj = SimpleNamespace(queue=lambda kind: queues.setdefault(kind, asyncio.Queue()))
    return obj, ns['expect']


@pytest.mark.parametrize('event', ['peer', 'closed', 'error', 'cancel'])
def test_unlimited_wait_still_exits(event):
    async def run():
        signal, expect = signal_stub()
        task = asyncio.create_task(expect(signal, 'peer', timeout=None))
        await asyncio.sleep(0.02)
        assert not task.done()
        if event == 'cancel':
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            await signal.queue(event).put({'type': event})
            if event == 'peer':
                assert await asyncio.wait_for(task, 1) == {'type': 'peer'}
            else:
                with pytest.raises(ConnectionError):
                    await asyncio.wait_for(task, 1)
        await asyncio.sleep(0)
        assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    asyncio.run(run())


def test_finite_wait_still_times_out():
    async def run():
        signal, expect = signal_stub()
        with pytest.raises(asyncio.TimeoutError):
            await expect(signal, 'peer', timeout=0.01)
    asyncio.run(run())
