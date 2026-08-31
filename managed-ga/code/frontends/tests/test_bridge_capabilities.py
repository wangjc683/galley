"""Regression coverage for explicit Desktop bridge capabilities."""
from __future__ import annotations

import asyncio

import pytest
from aiohttp.test_utils import TestClient, TestServer

from frontends.tests.test_bridge_sessions import _mod as bridge


def test_real_aiohttp_routes_expose_data_backup_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bridge.services, "autostart_extras", lambda: None)
    monkeypatch.setattr(bridge.services, "stop_all_extras", lambda: None)

    async def scenario() -> None:
        app = bridge.create_app()
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            inspect_head = await client.head("/memory/import/inspect")
            assert inspect_head.status == 404

            capabilities = await client.get("/services/capabilities")
            assert capabilities.status == 200
            assert await capabilities.json() == {"dataBackup": True}

            routes = {
                (route.method, route.resource.canonical)
                for route in app.router.routes()
            }
            assert ("POST", "/memory/import/inspect") in routes
            assert ("POST", "/memory/import") in routes
            assert ("POST", "/memory/export") in routes
        finally:
            await client.close()

    asyncio.run(scenario())
