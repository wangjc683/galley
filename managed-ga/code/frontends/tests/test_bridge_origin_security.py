"""Origin enforcement for the local Desktop bridge transport."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from aiohttp import WSServerHandshakeError, web
from aiohttp.test_utils import TestClient, TestServer

from frontends.tests.test_bridge_sessions import _mod as bridge


PROTECTED_PATHS = (
    "/status",
    "/memory/export",
    "/memory/import/inspect",
    "/services/capabilities",
    "/upload",
    "/upload/raw",
)


async def _with_client(callback, tmp_path: Path):
    side_effect = tmp_path / "request-reached-handler"

    async def protected_handler(_request):
        side_effect.write_text("reached", encoding="utf-8")
        return web.Response(text="protected-secret")

    async def http_error(_request):
        raise web.HTTPBadRequest(text="bad request")

    async def internal_error(_request):
        raise RuntimeError("secret failure detail")

    app = web.Application(middlewares=[bridge.cors_middleware])
    for path in PROTECTED_PATHS:
        app.router.add_route("*", path, protected_handler)
    app.router.add_get("/ws", bridge.ws_handler)
    app.router.add_get("/http-error", http_error)
    app.router.add_get("/internal-error", internal_error)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        await callback(client, side_effect)
    finally:
        await client.close()


def test_evil_origins_are_rejected_before_sensitive_handlers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("BRIDGE_PORT", "14168")
    monkeypatch.delenv("GA_E2E", raising=False)
    monkeypatch.delenv("VITE_PORT", raising=False)
    evil_origins = (
        "null",
        "https://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:14169",
        "http://localhost:5173.evil.example",
        "http://tauri.localhost.evil.example",
        "tauri://evil",
    )

    async def scenario(client: TestClient, side_effect: Path):
        for origin in evil_origins:
            for path in PROTECTED_PATHS:
                for method in ("GET", "POST", "OPTIONS"):
                    response = await client.request(method, path, headers={"Origin": origin})
                    assert response.status == 403, (origin, method, path, await response.text())
                    assert response.headers.get("Access-Control-Allow-Origin") is None
                    assert "protected-secret" not in await response.text()
        assert not side_effect.exists()

    asyncio.run(_with_client(scenario, tmp_path))


def test_allowed_origins_are_reflected_exactly_without_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("BRIDGE_PORT", "15168")
    monkeypatch.setenv("GA_E2E", "1")
    monkeypatch.setenv("VITE_PORT", "5273")
    allowed = (
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:15168",
        "http://localhost:15168",
        "http://[::1]:15168",
        "http://127.0.0.1:5273",
    )

    async def scenario(client: TestClient, side_effect: Path):
        for origin in allowed:
            response = await client.get("/status", headers={"Origin": origin})
            assert response.status == 200
            assert response.headers["Access-Control-Allow-Origin"] == origin
            assert "origin" in response.headers.get("Vary", "").lower()
            assert "Access-Control-Allow-Credentials" not in response.headers
            assert response.headers["Access-Control-Allow-Origin"] != "*"

            preflight = await client.options("/memory/export", headers={"Origin": origin})
            assert preflight.status == 204
            assert preflight.headers["Access-Control-Allow-Origin"] == origin
        assert side_effect.exists()

    asyncio.run(_with_client(scenario, tmp_path))


def test_no_origin_cli_is_allowed_but_cross_site_navigation_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("GA_E2E", raising=False)

    async def scenario(client: TestClient, side_effect: Path):
        response = await client.get("/status")
        assert response.status == 200
        assert "Access-Control-Allow-Origin" not in response.headers
        assert await response.text() == "protected-secret"

        side_effect.unlink()
        rejected = await client.get(
            "/status", headers={"Sec-Fetch-Site": "cross-site"}
        )
        assert rejected.status == 403
        assert not side_effect.exists()

    asyncio.run(_with_client(scenario, tmp_path))


def test_cross_site_resource_get_is_allowed_for_upload_raw_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Subresource loads (<img>/<video>) from the webview must reach /upload/raw
    even though the bridge origin (127.0.0.1) differs from the app origin
    (tauri.localhost), causing browsers to send Sec-Fetch-Site: cross-site without
    an Origin header. Other paths and non-resource destinations remain blocked."""
    monkeypatch.delenv("GA_E2E", raising=False)

    async def scenario(client: TestClient, side_effect: Path):
        # Real <img> load: cross-site, no Origin, Sec-Fetch-Dest: image → allowed
        response = await client.get(
            "/upload/raw",
            headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "image"},
        )
        assert response.status == 200
        assert await response.text() == "protected-secret"

        # Also OK for video, audio, font
        for dest in ("video", "audio", "font"):
            side_effect.unlink()
            r = await client.get(
                "/upload/raw",
                headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": dest},
            )
            assert r.status == 200

        # But top-level cross-site navigation (Sec-Fetch-Dest: document) → blocked
        side_effect.unlink()
        nav = await client.get(
            "/upload/raw",
            headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "document"},
        )
        assert nav.status == 403
        assert not side_effect.exists()

        # Evil Origin to /upload/raw still rejected (existing coverage)
        for origin in ("http://evil.example", "null"):
            rejected = await client.get("/upload/raw", headers={"Origin": origin})
            assert rejected.status == 403

        # Other protected paths remain cross-site blocked
        for path in ("/status", "/upload", "/services/capabilities"):
            rejected = await client.get(
                path,
                headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "image"},
            )
            assert rejected.status == 403

    asyncio.run(_with_client(scenario, tmp_path))


def test_e2e_origin_requires_explicit_mode_and_a_strict_valid_port(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    async def scenario(client: TestClient, side_effect: Path):
        origin = "http://127.0.0.1:5273"
        response = await client.get("/status", headers={"Origin": origin})
        assert response.status == 403
        assert not side_effect.exists()

    monkeypatch.setenv("GA_E2E", "1")
    for invalid in ("", "0", "65536", "52x73", "5273/path"):
        monkeypatch.setenv("VITE_PORT", invalid)
        asyncio.run(_with_client(scenario, tmp_path))
    monkeypatch.setenv("VITE_PORT", "5273")
    monkeypatch.delenv("GA_E2E")
    asyncio.run(_with_client(scenario, tmp_path))


def test_allowed_origin_headers_cover_http_errors_and_internal_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    origin = "tauri://localhost"

    async def scenario(client: TestClient, _side_effect: Path):
        bad = await client.get("/http-error", headers={"Origin": origin})
        assert bad.status == 400
        assert bad.headers["Access-Control-Allow-Origin"] == origin
        failed = await client.get("/internal-error", headers={"Origin": origin})
        assert failed.status == 500
        assert failed.headers["Access-Control-Allow-Origin"] == origin
        assert "secret failure detail" not in await failed.text()

    asyncio.run(_with_client(scenario, tmp_path))


def test_websocket_evil_origin_fails_before_prepare(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("GA_E2E", raising=False)

    async def scenario(client: TestClient, side_effect: Path):
        with pytest.raises(WSServerHandshakeError) as raised:
            await client.ws_connect("/ws", headers={"Origin": "http://evil.example"})
        assert raised.value.status == 403
        assert not side_effect.exists()

    asyncio.run(_with_client(scenario, tmp_path))


def test_bridge_source_has_no_wildcard_cors_and_checks_ws_before_prepare():
    source = Path(bridge.__file__).read_text(encoding="utf-8")
    assert 'Access-Control-Allow-Origin": "*"' not in source
    assert "cors_headers" not in source
    ws_start = source.index("async def ws_handler")
    ws_end = source.index(
        "# ---------------------------------------------------------------------------\n# Transport layer",
        ws_start,
    )
    ws_source = source[ws_start:ws_end]
    assert ws_source.index("_request_origin_error(request)") < ws_source.index("WebSocketResponse")
    assert ws_source.index("_request_origin_error(request)") < ws_source.index("await ws.prepare(request)")
