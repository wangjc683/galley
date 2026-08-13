#!/usr/bin/env bash
# bundle-python.sh — download python-build-standalone + install GA deps,
# write a self-contained Python distribution to
# core/python-bundle/python/ ready to be picked up
# by tauri.conf.json's bundle.resources mapping.
#
# Phase 0 (POC) scope: Mac x64 only. Phases 1+ will add mac-arm64,
# win-x64 + CI integration. Output dir is .gitignored — every machine /
# CI run regenerates from scratch.
#
# Usage:
#   ./scripts/bundle-python.sh mac-x64
#
# Idempotent: re-running cleans and rebuilds. Takes ~30s on a warm
# pip cache.

set -euo pipefail

PBS_RELEASE="20260510"
PBS_PYTHON_VERSION="3.11.15"

# Pin GA core dep versions for reproducible bundles. Mirrors the
# constraints in upstream GA's pyproject.toml (>=) but locks to a
# concrete version. Bump together when GA's baseline upgrade workflow
# audits dep versions.
GA_DEPS=(
  "requests==2.34.2"
  "beautifulsoup4==4.14.3"
  "bottle==0.13.4"
  "simple-websocket-server==0.4.4"
  "aiohttp==3.13.5"
  "qrcode[pil]==8.2"
  "pycryptodome==3.23.0"
  "python-dotenv==1.2.1"
  "lark-oapi==1.6.8"
  "python-telegram-bot==22.8"
)

ARCH="${1:-}"
if [[ -z "$ARCH" ]]; then
  echo "Usage: $0 {mac-x64|mac-arm64|win-x64}" >&2
  exit 1
fi

case "$ARCH" in
  mac-x64)   PBS_TRIPLE="x86_64-apple-darwin" ;;
  mac-arm64) PBS_TRIPLE="aarch64-apple-darwin" ;;
  win-x64)   PBS_TRIPLE="x86_64-pc-windows-msvc" ;;
  *) echo "Unknown arch: $ARCH" >&2; exit 1 ;;
esac

PBS_FILE="cpython-${PBS_PYTHON_VERSION}+${PBS_RELEASE}-${PBS_TRIPLE}-install_only_stripped.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/${PBS_FILE}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Single output location — each invocation overwrites. Tauri build is
# per-arch so we only need one arch staged at a time. Re-run the
# script with a different arch to retarget. CI does this per matrix
# entry; locally JC re-bundles when switching between mac-x64 (his
# dev machine) and any cross-compile target.
OUT_DIR="${REPO_ROOT}/core/python-bundle"
CACHE_DIR="${REPO_ROOT}/.cache/pbs"

echo "[bundle-python] arch=${ARCH} triple=${PBS_TRIPLE}"
echo "[bundle-python] output: ${OUT_DIR}/python"

mkdir -p "$CACHE_DIR"
if [[ ! -f "${CACHE_DIR}/${PBS_FILE}" ]]; then
  echo "[bundle-python] downloading PBS..."
  curl -sL -o "${CACHE_DIR}/${PBS_FILE}" "$PBS_URL"
else
  echo "[bundle-python] PBS cached"
fi

# Clean output, extract fresh
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
tar -xzf "${CACHE_DIR}/${PBS_FILE}" -C "$OUT_DIR"

PYTHON_DIR="${OUT_DIR}/python"
if [[ "$ARCH" == "win-x64" ]]; then
  PYTHON_BIN="${PYTHON_DIR}/python.exe"
else
  PYTHON_BIN="${PYTHON_DIR}/bin/python3"
fi

echo "[bundle-python] stripping non-essential stdlib..."
# Remove modules we never use, freeing ~10-15MB per bundle:
#   - test/      CPython's own test suite (~10MB)
#   - tkinter/   GUI toolkit (Galley is Tauri, GA has no Tk surface)
#   - lib-dynload/_tkinter*.so   Mac x64 codesign blocker per
#     python-build-standalone issue #749 (headerpad limitation)
#   - idlelib/, turtledemo/   demo/edu modules
#   - ensurepip/   we don't bootstrap pip at runtime
#   - 2to3/, pydoc helpers   not runtime-required
# Stdlib path differs between Mac (lib/python3.11/) and Win (Lib/).
if [[ "$ARCH" == "win-x64" ]]; then
  STDLIB="${PYTHON_DIR}/Lib"
else
  STDLIB="${PYTHON_DIR}/lib/python3.11"
fi

rm -rf "${STDLIB}/test" \
       "${STDLIB}/tkinter" \
       "${STDLIB}/idlelib" \
       "${STDLIB}/turtledemo" \
       "${STDLIB}/ensurepip"

# Mac x64 codesign blocker: physically remove _tkinter shared object.
# (Even though we removed tkinter/, lib-dynload/ retains the .so on
# pre-strip distributions.) install_only_stripped already drops most,
# but be paranoid.
if [[ "$ARCH" != "win-x64" ]]; then
  find "${STDLIB}/lib-dynload" -name "_tkinter*" -delete 2>/dev/null || true
  rm -f "${PYTHON_DIR}/bin/2to3"* \
        "${PYTHON_DIR}/bin/idle"* \
        "${PYTHON_DIR}/bin/pydoc"*
fi

echo "[bundle-python] installing GA deps to bundle's site-packages..."
"$PYTHON_BIN" -m pip install \
  --no-warn-script-location \
  --no-compile \
  --disable-pip-version-check \
  --quiet \
  "${GA_DEPS[@]}"

# Verify the managed GA import chain works against the bundle. This must
# use Galley's vendored managed-ga/code payload, not the maintainer's
# external ~/Documents/GenericAgent checkout, or a local setup can hide
# missing packaged dependencies.
echo "[bundle-python] verifying bundle..."
MANAGED_GA_PATH="${REPO_ROOT}/managed-ga/code"
if [[ -d "$MANAGED_GA_PATH" ]]; then
  "${REPO_ROOT}/scripts/check-bundled-python-managed-ga.sh" "$PYTHON_BIN" "$MANAGED_GA_PATH"
else
  "$PYTHON_BIN" -c '
import aiohttp, requests, bs4, bottle, dotenv
import simple_websocket_server  # ensure underscore-renamed import works
print("  deps OK")
'
fi

# Final size report — useful when tweaking the strip list.
BUNDLE_SIZE=$(du -sh "$PYTHON_DIR" | awk '{print $1}')
echo "[bundle-python] done. bundle size: ${BUNDLE_SIZE}"
echo "[bundle-python] python bin: ${PYTHON_BIN}"
