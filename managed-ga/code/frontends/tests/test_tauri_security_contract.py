"""Security contracts for the packaged Tauri shell."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent.parent
TAURI_ROOT = ROOT / "frontends" / "desktop" / "src-tauri"


def _json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_production_csp_is_local_and_keeps_required_tauri_ipc_and_services():
    config = _json(TAURI_ROOT / "tauri.conf.json")
    security = config["app"]["security"]
    csp = security["csp"]

    assert isinstance(csp, dict)
    assert csp["object-src"] == "'none'"
    assert csp["base-uri"] == "'self'"
    assert csp["form-action"] == "'none'"
    assert csp["frame-src"] == "'none'"
    assert csp["frame-ancestors"] == "'none'"
    assert "'unsafe-inline'" not in csp["script-src"]
    assert "'unsafe-eval'" not in csp["script-src"]

    connect_sources = set(csp["connect-src"].split())
    assert {
        "'self'",
        "ipc:",
        "http://ipc.localhost",
        "http://127.0.0.1:14168",
        "ws://127.0.0.1:14168",
        "http://127.0.0.1:8900",
        "ws://127.0.0.1:8900",
    } <= connect_sources
    assert not any("*" in source for source in connect_sources)
    assert not any(source.startswith("https://") for source in connect_sources)


def test_global_tauri_remains_only_because_compiled_compatibility_page_uses_it():
    config = _json(TAURI_ROOT / "tauri.conf.json")
    fallback = (ROOT / "frontends" / "desktop" / "dist" / "fallback.html").read_text(
        encoding="utf-8"
    )

    assert config["app"]["withGlobalTauri"] is True
    assert "window.__TAURI__" in fallback


def test_main_and_setup_capabilities_are_window_scoped_without_remote_ipc_access():
    config = _json(TAURI_ROOT / "tauri.conf.json")
    main = _json(TAURI_ROOT / "capabilities" / "default.json")
    setup = _json(TAURI_ROOT / "capabilities" / "setup.json")

    assert config["app"]["security"]["capabilities"] == ["default", "setup"]
    assert main["windows"] == ["main"]
    assert setup["windows"] == ["setup"]
    assert "remote" not in main
    assert "remote" not in setup

    main_permissions = set(main["permissions"])
    setup_permissions = set(setup["permissions"])
    assert "core:default" not in main_permissions
    assert "core:window:default" not in main_permissions
    assert "core:webview:default" not in main_permissions
    assert "opener:default" not in main_permissions
    assert {
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-close",
        "core:window:allow-start-dragging",
        "opener:allow-open-url",
        "opener:allow-default-urls",
        "allow-get-macos-titlebar-metrics",
    } <= main_permissions

    assert {
        "allow-start-bridge-with-config",
        "allow-retry-bootstrap",
        "allow-get-bootstrap-snapshot",
        "allow-get-config",
        "allow-discover-python-for-project",
        "allow-pick-directory",
        "allow-pick-python-interpreter",
    } <= setup_permissions
    assert not setup_permissions.intersection(
        {
            "allow-export-mykey",
            "allow-pick-data-export-path",
            "allow-reveal-in-file-manager",
            "allow-set-ga-source",
            "allow-clear-ga-source",
            "allow-get-macos-titlebar-metrics",
            "opener:allow-open-url",
        }
    )


def test_e2e_config_only_adds_test_driver_and_dynamic_loopback_connectivity():
    e2e = _json(TAURI_ROOT / "tauri.e2e.conf.json")
    security = e2e["app"]["security"]
    capabilities = security["capabilities"]
    assert capabilities[:2] == ["default", "setup"]
    capability = capabilities[2]

    assert capability["identifier"] == "e2e"
    assert capability["permissions"] == ["wdio:default"]

    assert set(security["csp"]) == {"connect-src"}
    connect_sources = set(security["csp"]["connect-src"].split())
    assert {
        "'self'",
        "ipc:",
        "http://ipc.localhost",
        "http://127.0.0.1:*",
        "ws://127.0.0.1:*",
    } <= connect_sources
    assert {source for source in connect_sources if "*" in source} == {
        "http://127.0.0.1:*",
        "ws://127.0.0.1:*",
    }
    assert not any(source.startswith("https://") for source in connect_sources)


def test_native_titlebar_metrics_command_is_main_window_only():
    main = _json(TAURI_ROOT / "capabilities" / "default.json")
    setup = _json(TAURI_ROOT / "capabilities" / "setup.json")
    permissions = (TAURI_ROOT / "permissions" / "bridge-commands.toml").read_text(
        encoding="utf-8"
    )

    assert "allow-get-macos-titlebar-metrics" in main["permissions"]
    assert "allow-get-macos-titlebar-metrics" not in setup["permissions"]
    assert 'identifier = "allow-get-macos-titlebar-metrics"' in permissions
    assert 'commands.allow = ["get_macos_titlebar_metrics"]' in permissions
