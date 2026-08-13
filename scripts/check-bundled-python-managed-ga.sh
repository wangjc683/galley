#!/usr/bin/env bash
# Verify that Galley's bundled Python can import the managed GenericAgent
# payload and the runtime dependencies Galley owns.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PYTHON_DIR="${REPO_ROOT}/core/python-bundle/python"
SOURCE_MANAGED_GA_PATH="${2:-${REPO_ROOT}/managed-ga/code}"
PYTHON_BIN="${1:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x "${DEFAULT_PYTHON_DIR}/bin/python3" ]]; then
    PYTHON_BIN="${DEFAULT_PYTHON_DIR}/bin/python3"
  elif [[ -x "${DEFAULT_PYTHON_DIR}/python.exe" ]]; then
    PYTHON_BIN="${DEFAULT_PYTHON_DIR}/python.exe"
  else
    echo "[bundled-python-managed-ga] missing bundled Python at core/python-bundle/python" >&2
    echo "[bundled-python-managed-ga] run ./scripts/bundle-python.sh {mac-x64|mac-arm64|win-x64} first" >&2
    exit 1
  fi
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "[bundled-python-managed-ga] Python is not executable: ${PYTHON_BIN}" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_MANAGED_GA_PATH" ]]; then
  echo "[bundled-python-managed-ga] missing managed GA payload: ${SOURCE_MANAGED_GA_PATH}" >&2
  exit 1
fi

python_host_path() {
  local path="$1"
  if [[ "$(basename "$PYTHON_BIN")" == "python.exe" ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$path"
  else
    printf '%s\n' "$path"
  fi
}

SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/galley-bundled-python-smoke.XXXXXX")"
cleanup() {
  rm -rf "$SMOKE_ROOT"
}
trap cleanup EXIT

STATE_ROOT="${SMOKE_ROOT}/state"
MANAGED_GA_PATH="${SMOKE_ROOT}/code"
mkdir -p "$STATE_ROOT"
cp -R "$SOURCE_MANAGED_GA_PATH" "$MANAGED_GA_PATH"

VERIFY_GA_PATH="$(python_host_path "$MANAGED_GA_PATH")"
VERIFY_STATE_ROOT="$(python_host_path "$STATE_ROOT")"

echo "[bundled-python-managed-ga] python: ${PYTHON_BIN}"
echo "[bundled-python-managed-ga] managed GA: ${SOURCE_MANAGED_GA_PATH}"

PYTHONDONTWRITEBYTECODE=1 \
GALLEY_GA_STATE_ROOT="$VERIFY_STATE_ROOT" \
GALLEY_VERIFY_GA_PATH="$VERIFY_GA_PATH" \
"$PYTHON_BIN" - <<'PY'
import importlib.util
import os
import sys

sys.path.insert(0, os.environ["GALLEY_VERIFY_GA_PATH"])

import agentmain
import aiohttp
import bottle
import bs4
import dotenv
import lark_oapi
import qrcode
import requests
import simple_websocket_server
import telegram
import TMWebDriver
from Crypto.Cipher import AES
from PIL import Image
from frontends import desktop_bridge

assert callable(getattr(agentmain, "GenericAgent", None))
assert importlib.util.find_spec("frontends.wechatapp") is not None
assert importlib.util.find_spec("frontends.fsapp") is not None
assert importlib.util.find_spec("frontends.tgapp") is not None
assert AES is not None
assert Image is not None
assert aiohttp is not None
assert bottle is not None
assert bs4 is not None
assert desktop_bridge is not None
assert dotenv is not None
assert lark_oapi is not None
assert qrcode is not None
assert requests is not None
assert simple_websocket_server is not None
assert telegram is not None
assert TMWebDriver is not None

print("  managed GA import OK (bundle is bridge-ready)")
PY

echo "[bundled-python-managed-ga] OK"
