"""Shared helpers for Galley's managed GenericAgent runtime.

This module is imported only by Galley-owned runner entrypoints. External /
attach mode must keep using the user's GenericAgent config and prompt as-is.
"""
from __future__ import annotations

import json
import os
import queue
import socket
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import Any

GALLEY_RUNTIME_KIND_ENV = "GALLEY_RUNTIME_KIND"
GALLEY_MANAGED_STATE_ROOT_ENV = "GALLEY_GA_STATE_ROOT"
GALLEY_MANAGED_MODEL_CONFIG_ENV = "GALLEY_MANAGED_MODEL_CONFIG_JSON"
GALLEY_MANAGED_MODEL_CONFIG_PATH_ENV = "GALLEY_MANAGED_MODEL_CONFIG_PATH"
GALLEY_RUNTIME_PROMPT_TEXT_ENV = "GALLEY_RUNTIME_PROMPT_TEXT"
# Literal Core leaves in prompt templates whose supervisor identity can
# only be known per agent instance (core/src/managed_prompt.rs).
SUPERVISOR_ID_PLACEHOLDER = "__GALLEY_SUPERVISOR_ID__"
_CREDENTIAL_IPC_TIMEOUT_SECS = 10


def is_managed_runtime() -> bool:
    return os.environ.get(GALLEY_RUNTIME_KIND_ENV) == "managed"


def managed_state_root() -> str | None:
    return os.environ.get(GALLEY_MANAGED_STATE_ROOT_ENV)


def _credential_from_ipc(
    ipc: dict[str, Any],
    api_key_ref: str,
    credential_kind: str,
) -> dict[str, Any]:
    req = (
        json.dumps(
            {
                "token": str(ipc.get("token") or ""),
                "apiKeyRef": api_key_ref,
                "credentialKind": credential_kind,
            },
            ensure_ascii=False,
        ).encode()
        + b"\n"
    )
    kind = str(ipc.get("kind") or "")
    address = str(ipc.get("address") or "")
    try:
        if kind == "unix":
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(_CREDENTIAL_IPC_TIMEOUT_SECS)
                s.connect(address)
                s.sendall(req)
                chunks: list[bytes] = []
                while True:
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    if b"\n" in chunk:
                        break
        elif kind == "windows_named_pipe":
            chunks = [
                _read_windows_named_pipe(address, req, _CREDENTIAL_IPC_TIMEOUT_SECS)
            ]
        else:
            raise RuntimeError(f"unsupported credential IPC kind {kind!r}")
        raw = b"".join(chunks).decode("utf-8").strip()
        if not raw:
            raise RuntimeError("credential IPC returned an empty response")
        data = json.loads(raw)
    except Exception as e:
        raise RuntimeError(f"Galley credential IPC failed: {e}") from e
    if not isinstance(data, dict):
        raise RuntimeError("Galley credential IPC response is not an object.")
    error = data.get("error")
    if isinstance(error, str):
        message = data.get("message")
        detail = f": {message}" if isinstance(message, str) and message else ""
        raise RuntimeError(f"Galley credential IPC rejected request ({error}{detail})")
    return data


def _read_windows_named_pipe(address: str, req: bytes, timeout_secs: float) -> bytes:
    result: queue.Queue[bytes | BaseException] = queue.Queue(maxsize=1)

    def worker() -> None:
        try:
            with open(address, "r+b", buffering=0) as f:
                f.write(req)
                result.put(f.readline())
        except BaseException as e:
            result.put(e)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(timeout_secs)
    if thread.is_alive():
        raise TimeoutError(
            f"credential IPC named pipe timed out after {timeout_secs:g}s"
        )
    try:
        value = result.get_nowait()
    except queue.Empty as e:
        raise RuntimeError("credential IPC named pipe returned no result") from e
    if isinstance(value, BaseException):
        raise value
    return value


def managed_model_config_from_env() -> dict[str, Any]:
    """Build GA-style mykey entries from Galley's in-memory model config."""
    raw = os.environ.get(GALLEY_MANAGED_MODEL_CONFIG_ENV)
    if not raw:
        raise RuntimeError("Galley managed model config was not provided.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Galley managed model config is invalid JSON: {e}") from e
    models = data.get("models")
    if not isinstance(models, list) or not models:
        raise RuntimeError("Galley managed model config has no usable models.")

    out: dict[str, Any] = {}
    for idx, model in enumerate(models):
        if not isinstance(model, dict):
            continue
        protocol = str(model.get("protocol") or "").strip().lower()
        if protocol == "anthropic":
            key = f"native_claude_config_{idx}"
        elif protocol == "openai":
            key = f"native_oai_config_{idx}"
        else:
            continue
        auth_kind = str(model.get("authKind") or "api_key").strip().lower()
        api_key = str(model.get("apiKey") or "")
        api_key_ref = str(model.get("apiKeyRef") or "")
        credential_ipc = model.get("credentialIpc")
        if auth_kind == "api_key" and api_key_ref and isinstance(credential_ipc, dict):
            api_key = str(
                _credential_from_ipc(credential_ipc, api_key_ref, "api_key").get("apiKey")
                or ""
            )
        cfg: dict[str, Any] = {
            "name": str(model.get("displayName") or model.get("model") or key),
            "apikey": api_key,
            "apibase": str(model.get("apiBase") or "").rstrip("/"),
            "model": str(model.get("model") or ""),
        }
        advanced = model.get("advancedOptions") or {}
        if isinstance(advanced, dict):
            cfg.update(advanced)
            if "connect_timeout" in advanced and "timeout" not in advanced:
                cfg["timeout"] = advanced["connect_timeout"]
        if auth_kind == "chatgpt_codex_oauth":
            # Single post-merge block: these keys must win over anything
            # in advancedOptions. (This used to exist as two copies, one
            # pre-merge and one post-merge, and they had already drifted.)
            cfg["codex_backend"] = True
            cfg["api_mode"] = "responses"
            cfg["stream"] = True
            cfg["galley_api_key_ref"] = api_key_ref
            if isinstance(credential_ipc, dict):
                cfg["galley_credential_ipc"] = credential_ipc
            if str(cfg.get("reasoning_effort") or "").strip().lower() == "minimal":
                cfg["reasoning_effort"] = "medium"
        # auth_kind "none" is a deliberate no-auth endpoint (e.g. local
        # Ollama): an empty apikey is its real credential — GA sends the
        # auth header unconditionally and such endpoints ignore it.
        if auth_kind != "none" and not cfg["apikey"]:
            continue
        if not cfg["apibase"] or not cfg["model"]:
            continue
        out[key] = cfg
    if not out:
        raise RuntimeError("Galley managed model config has no usable models.")
    return out


def install_managed_mykey_loader() -> None:
    """Patch managed GA's llmcore to read Galley-owned model config."""
    import llmcore  # type: ignore[import-not-found]

    marker = os.environ.get(GALLEY_MANAGED_MODEL_CONFIG_PATH_ENV)
    if not marker:
        raise RuntimeError("managed runtime missing model config marker path")
    marker_path = str(Path(marker).expanduser().resolve())

    def _load_managed_mykeys() -> dict[str, Any]:
        llmcore._mykey_path = marker_path
        return managed_model_config_from_env()

    llmcore._load_mykeys = _load_managed_mykeys
    llmcore._mykey_path = marker_path
    llmcore._mykey_mtime = None


def managed_prompt_profile(
    extra_env_names: Iterable[str] = (),
    supervisor_id: str | None = None,
) -> str:
    """Compose the managed prompt from Galley-injected env text.

    ``supervisor_id`` resolves the deferred identity placeholder Core
    leaves in a prompt *template* (see ``install_managed_prompt_profile``).
    Substitution happens on the composed text, so a prompt without the
    placeholder is returned unchanged.
    """
    prompts = []
    for env_name in (
        GALLEY_RUNTIME_PROMPT_TEXT_ENV,
        *extra_env_names,
    ):
        raw_prompt = os.environ.get(env_name)
        if not raw_prompt:
            raise RuntimeError(f"managed runtime missing {env_name}")
        prompts.append(raw_prompt.strip())
    extra_prompt = "\n\n".join(p for p in prompts if p)
    if not extra_prompt:
        raise RuntimeError("managed prompt profile is empty")
    if supervisor_id:
        extra_prompt = extra_prompt.replace(SUPERVISOR_ID_PLACEHOLDER, supervisor_id)
    return extra_prompt


def install_managed_prompt_profile(
    agent: Any,
    extra_env_names: Iterable[str] = (),
    supervisor_id: str | None = None,
) -> None:
    """Install Galley's managed prompt onto one agent instance.

    Single-context platforms call this once with the prompt Core already
    rendered. Multi-context platforms (Discord: one supervisor context
    per channel) call it once per agent with the prompt *template* env
    name plus that channel's ``supervisor_id`` — the identity binds per
    agent instance here instead of process-wide, because concurrently
    rewriting ``os.environ`` per channel is not an option.
    """
    extra_prompt = managed_prompt_profile(extra_env_names, supervisor_id)

    clients = list(getattr(agent, "llmclients", []) or [])
    if not clients and getattr(agent, "llmclient", None) is not None:
        clients = [agent.llmclient]
    for client in clients:
        backend = getattr(client, "backend", None)
        if backend is not None:
            backend.extra_sys_prompt = "\n\n" + extra_prompt
