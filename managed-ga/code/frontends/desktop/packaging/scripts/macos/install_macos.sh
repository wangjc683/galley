#!/usr/bin/env bash
set -euo pipefail

# GenericAgent Desktop macOS portable installer/preparer.
# Intended bundle layout:
#   GenericAgent-Desktop-macOS/
#     GenericAgent.app
#     runtime/
#       python/ wheels/ install_macos.sh app/
#
# Usage:
#   ./install_macos.sh --python-path /path/to/python3 --project-dir /path/to/runtime/app --wheel-dir /path/to/wheels --mode PrepareOnly
#   ./install_macos.sh --mode BridgeOnly

PROJECT_DIR=""
PYTHON_PATH=""
MODE="PrepareOnly"
NO_VENV=0
SKIP_PIP_INSTALL=0
WHEEL_DIR=""
EXTRA_PACKAGES=""
APP_PATH=""

log_step() { printf '\n==> %s\n' "$*" >&2; }
log_ok() { printf '[OK] %s\n' "$*" >&2; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
progress() { printf 'GAPROGRESS|%s\n' "$1"; }

usage() { sed -n '1,18p' "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir|-p) [[ $# -ge 2 ]] || fail "Missing value for $1"; PROJECT_DIR="$2"; shift 2 ;;
    --python-path) [[ $# -ge 2 ]] || fail "Missing value for $1"; PYTHON_PATH="$2"; shift 2 ;;
    --mode|-m) [[ $# -ge 2 ]] || fail "Missing value for $1"; MODE="$2"; shift 2 ;;
    --app|-a) [[ $# -ge 2 ]] || fail "Missing value for $1"; APP_PATH="$2"; shift 2 ;;
    --no-venv) NO_VENV=1; shift ;;
    --skip-pip-install) SKIP_PIP_INSTALL=1; shift ;;
    --wheel-dir) [[ $# -ge 2 ]] || fail "Missing value for $1"; WHEEL_DIR="$2"; shift 2 ;;
    --extra-packages) [[ $# -ge 2 ]] || fail "Missing value for $1"; EXTRA_PACKAGES="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

case "$MODE" in
  PrepareOnly|Launch|BridgeOnly) ;;
  *) fail "Unsupported --mode '$MODE'. Expected PrepareOnly, Launch, or BridgeOnly." ;;
esac

resolve_script_root() {
  local src="${BASH_SOURCE[0]}"
  while [[ -L "$src" ]]; do
    local dir
    dir="$(cd -P "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    [[ "$src" != /* ]] && src="$dir/$src"
  done
  cd -P "$(dirname "$src")" && pwd
}

abs_path() {
  "$PYTHON_FOR_ABS" - "$1" <<'PY'
import os, sys
print(os.path.abspath(os.path.expanduser(sys.argv[1])))
PY
}

SCRIPT_ROOT="$(resolve_script_root)"
PYTHON_FOR_ABS="${PYTHON_PATH:-python3}"

if [[ -z "$PROJECT_DIR" ]]; then
  for c in "$SCRIPT_ROOT/app" "$SCRIPT_ROOT/../runtime/app" "$SCRIPT_ROOT/.." "$PWD"; do
    if [[ -f "$c/agentmain.py" ]]; then PROJECT_DIR="$c"; break; fi
  done
fi
[[ -n "$PROJECT_DIR" ]] || fail "Cannot resolve project dir; pass --project-dir"
PROJECT_DIR="$(abs_path "$PROJECT_DIR")"
[[ -f "$PROJECT_DIR/agentmain.py" ]] || fail "Project dir does not contain agentmain.py: $PROJECT_DIR"

if [[ -z "$PYTHON_PATH" ]]; then
  if [[ -x "$SCRIPT_ROOT/python/bin/python3" ]]; then PYTHON_PATH="$SCRIPT_ROOT/python/bin/python3"; else PYTHON_PATH="python3"; fi
fi
PYTHON_PATH="$(abs_path "$PYTHON_PATH")"
"$PYTHON_PATH" --version >&2 || fail "Python not runnable: $PYTHON_PATH"

if [[ -z "$WHEEL_DIR" && -d "$SCRIPT_ROOT/wheels" ]]; then WHEEL_DIR="$SCRIPT_ROOT/wheels"; fi
if [[ -n "$WHEEL_DIR" ]]; then WHEEL_DIR="$(abs_path "$WHEEL_DIR")"; fi

venv_python() {
  printf '%s\n' "$PROJECT_DIR/.venv/bin/python"
}

ensure_venv() {
  if [[ "$NO_VENV" == "1" ]]; then return; fi
  local vpy
  vpy="$(venv_python)"
  if [[ ! -x "$vpy" ]]; then
    progress venv
    log_step "Create venv: $PROJECT_DIR/.venv"
    "$PYTHON_PATH" -m venv "$PROJECT_DIR/.venv"
  fi
}

install_deps() {
  local py="$1"
  [[ "$SKIP_PIP_INSTALL" == "1" ]] && return
  progress deps
  log_step "Install desktop bridge dependencies"
  "$py" -m pip install --upgrade pip setuptools wheel
  local pkgs=(
    "requests>=2.28" "beautifulsoup4>=4.12" "bottle>=0.12" "simple-websocket-server>=0.4" "aiohttp>=3.9" psutil
  )
  if [[ -n "$EXTRA_PACKAGES" ]]; then
    # shellcheck disable=SC2206
    pkgs+=( $EXTRA_PACKAGES )
  fi
  if [[ -n "$WHEEL_DIR" && -d "$WHEEL_DIR" ]]; then
    "$py" -m pip install --no-index --find-links "$WHEEL_DIR" "${pkgs[@]}"
  else
    log_warn "No wheel dir supplied; falling back to online pip install"
    "$py" -m pip install "${pkgs[@]}"
  fi
}

ensure_mykey() {
  local mykey="$PROJECT_DIR/mykey.py"
  local tpl="$PROJECT_DIR/mykey_template.py"
  if [[ -f "$mykey" ]]; then
    log_ok "mykey.py exists"
  elif [[ -f "$tpl" ]]; then
    cp "$tpl" "$mykey"
    log_warn "Created mykey.py from mykey_template.py. Please fill API keys before model calls."
  else
    log_warn "mykey.py and mykey_template.py are missing. Model config may need manual setup."
  fi
}

write_settings() {
  local py="$1"
  local settings_path="$HOME/.ga_desktop_settings.json"
  "$py" - "$settings_path" "$py" "$PROJECT_DIR" <<'PY'
import json, pathlib, sys
settings_path, python_path, project_dir = sys.argv[1:4]
pathlib.Path(settings_path).write_text(json.dumps({"python_path": python_path, "project_dir": project_dir}, indent=2), encoding="utf-8")
PY
  log_ok "Wrote desktop settings: $settings_path"
}

start_bridge() {
  local py="$1"
  local bridge="$PROJECT_DIR/frontends/desktop_bridge.py"
  [[ -f "$bridge" ]] || fail "desktop_bridge.py not found: $bridge"
  export PYTHONPATH="$PROJECT_DIR:$PROJECT_DIR/frontends:${PYTHONPATH:-}"
  exec "$py" "$bridge"
}

launch_app() {
  if [[ -n "$APP_PATH" ]]; then
    open "$APP_PATH"
  elif [[ -d "$SCRIPT_ROOT/../GenericAgent.app" ]]; then
    open "$SCRIPT_ROOT/../GenericAgent.app"
  else
    log_warn "GenericAgent.app not found next to runtime; skip launch"
  fi
}

ensure_venv
RUNTIME_PY="$(venv_python)"
if [[ "$NO_VENV" == "1" ]]; then RUNTIME_PY="$PYTHON_PATH"; fi
install_deps "$RUNTIME_PY"
ensure_mykey
write_settings "$RUNTIME_PY"
progress done

case "$MODE" in
  PrepareOnly) log_ok "Prepare complete: $PROJECT_DIR" ;;
  BridgeOnly) start_bridge "$RUNTIME_PY" ;;
  Launch) launch_app ;;
esac
