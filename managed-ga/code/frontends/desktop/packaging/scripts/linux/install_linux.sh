#!/usr/bin/env bash
set -euo pipefail

# The desktop AppImage injects PYTHONHOME/PYTHONPATH/LD_LIBRARY_PATH pointing at its own
# read-only mount, which breaks the bundled python ("No module named 'encodings'"). Always
# run with a clean python env so the embedded interpreter uses its own stdlib/libs.
unset PYTHONHOME PYTHONPATH LD_LIBRARY_PATH

# GenericAgent Desktop Linux installer.
# Expected normal location: GenericAgent/frontends/install_linux.sh
# Expected AppImage:        GenericAgent/frontends/GenericAgent.AppImage
#
# Usage:
#   ./install_linux.sh
#   ./install_linux.sh --project-dir /path/to/GenericAgent
#   ./install_linux.sh --mode PrepareOnly|Launch|BridgeOnly
#   ./install_linux.sh --skip-pip-install
#
# What this script does:
#   1. Resolve the GenericAgent project root containing agentmain.py.
#   2. Resolve/create a Python runtime under project .venv unless --no-venv is used.
#   3. Install minimal desktop bridge dependencies unless --skip-pip-install is used.
#   4. Write ~/.ga_desktop_settings.json for the AppImage desktop shell.
#   5. chmod +x GenericAgent.AppImage.
#   6. Create/update desktop and application-menu .desktop launchers.
#   7. By default, do not launch the app; use --mode Launch if desired.

PROJECT_DIR=""
PYTHON_PATH=""
MODE="PrepareOnly"
NO_VENV=0
SKIP_PIP_INSTALL=0
APPIMAGE_PATH=""
WHEEL_DIR=""
EXTRA_PACKAGES=""

log_step() { printf '\n==> %s\n' "$*" >&2; }
log_ok() { printf '[OK] %s\n' "$*" >&2; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '1,28p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir|-p)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      PROJECT_DIR="$2"; shift 2 ;;
    --python-path)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      PYTHON_PATH="$2"; shift 2 ;;
    --mode|-m)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      MODE="$2"; shift 2 ;;
    --appimage)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      APPIMAGE_PATH="$2"; shift 2 ;;
    --no-venv)
      NO_VENV=1; shift ;;
    --skip-pip-install)
      SKIP_PIP_INSTALL=1; shift ;;
    --wheel-dir)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      WHEEL_DIR="$2"; shift 2 ;;
    --extra-packages)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      EXTRA_PACKAGES="$2"; shift 2 ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      fail "Unknown argument: $1" ;;
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
  python3 - "$1" <<'PY'
import os, sys
print(os.path.abspath(os.path.expanduser(sys.argv[1])))
PY
}

has_agentmain() { [[ -f "$1/agentmain.py" ]]; }

find_project_root() {
  local script_root="$1"
  if [[ -n "$PROJECT_DIR" ]]; then
    local p
    p="$(abs_path "$PROJECT_DIR")"
    has_agentmain "$p" || fail "Project dir does not contain agentmain.py: $PROJECT_DIR"
    printf '%s\n' "$p"
    return
  fi

  local candidates=(
    "$script_root/.."
    "$PWD/.."
    "$PWD"
    "$script_root"
    "$script_root/../.."
    "$HOME/GenericAgent"
    "$HOME/GenericAgent_Desktop"
    "$HOME/GenericAgent_Desktop_test"
  )

  local c p
  for c in "${candidates[@]}"; do
    [[ -e "$c" ]] || continue
    p="$(abs_path "$c")"
    if has_agentmain "$p"; then
      printf '%s\n' "$p"
      return
    fi
  done

  fail "Cannot locate GenericAgent project root. Put this script in GenericAgent/frontends or pass --project-dir /path/to/GenericAgent."
}

python_supported() {
  local py="$1"
  "$py" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)
PY
}

python_exe() {
  local py="$1"
  "$py" - <<'PY'
import sys
print(sys.executable)
PY
}

find_python() {
  if [[ -n "$PYTHON_PATH" ]]; then
    python_supported "$PYTHON_PATH" || fail "Specified Python is not supported: $PYTHON_PATH. Need Python >=3.10,<3.14."
    python_exe "$PYTHON_PATH"
    return
  fi

  local py
  for py in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$py" >/dev/null 2>&1 && python_supported "$py"; then
      python_exe "$py"
      return
    fi
  done
  fail "No supported Python found. Install Python 3.10-3.13 or pass --python-path."
}

ensure_venv() {
  local root="$1"
  local base_py="$2"
  if [[ "$NO_VENV" -eq 1 ]]; then
    printf '%s\n' "$base_py"
    return
  fi

  local venv="$root/.venv"
  local vpy="$venv/bin/python"
  if [[ ! -x "$vpy" ]]; then
    # NOTE: ensure_venv's stdout is captured by the caller as the python path
    # (PY="$(ensure_venv ...)"), so progress markers must NOT be printed here —
    # they go on the main-flow stdout instead. Only the venv path goes to stdout.
    log_step "Create virtual environment: $venv"
    "$base_py" -m venv "$venv" || fail "Failed to create venv. On Debian/Ubuntu install python3-venv."
  fi
  python_supported "$vpy" || fail "Venv Python is not supported: $vpy"
  printf '%s\n' "$vpy"
}

install_dependencies() {
  local root="$1"
  local py="$2"
  if [[ "$SKIP_PIP_INSTALL" -eq 1 ]]; then
    log_warn "Skipped pip install because --skip-pip-install was used."
    return
  fi

  printf 'GAPROGRESS|deps\n'
  if [[ -n "$WHEEL_DIR" ]]; then
    # Offline (portable bundle): install from local wheels only, no network, no pip self-upgrade.
    log_step "Install dependencies offline from $WHEEL_DIR"
    # Install deps directly (NOT an editable -e of the source): an editable install bakes the
    # project's absolute path into a .pth. Combined with --no-venv (deps go into the relocatable
    # embedded python) this keeps the portable bundle movable. The bridge adds the source to
    # sys.path itself (ensure_ga_import_path), so no install of the project is needed.
    # shellcheck disable=SC2086
    "$py" -m pip install --no-index --find-links "$WHEEL_DIR" \
      "requests>=2.28" "beautifulsoup4>=4.12" "bottle>=0.12" "simple-websocket-server>=0.4" "aiohttp>=3.9" psutil $EXTRA_PACKAGES \
      || fail "Offline pip install failed (check wheel dir)."
  else
    log_step "Install/refresh minimal Python dependencies"
    "$py" -m pip install --upgrade pip setuptools wheel || fail "pip bootstrap failed."
    # shellcheck disable=SC2086
    "$py" -m pip install -e "$root" psutil $EXTRA_PACKAGES || fail "pip install failed."
  fi
  printf 'GAPROGRESS|done\n'
}

ensure_mykey() {
  local root="$1"
  local mykey="$root/mykey.py"
  local tpl="$root/mykey_template.py"
  if [[ -f "$mykey" ]]; then
    log_ok "mykey.py exists"
  elif [[ -f "$tpl" ]]; then
    cp "$tpl" "$mykey"
    log_warn "Created mykey.py from mykey_template.py. Please fill API keys before model calls."
  else
    log_warn "mykey.py and mykey_template.py are missing. Model config may need manual setup."
  fi
}

write_desktop_settings() {
  local root="$1"
  local py="$2"
  local bridge="$root/frontends/desktop_bridge.py"
  local settings_path="$HOME/.ga_desktop_settings.json"
  [[ -f "$bridge" ]] || fail "desktop_bridge.py not found: $bridge"

  "$py" - "$settings_path" "$py" "$root" "$bridge" <<'PY'
import json, pathlib, sys
settings_path, python_path, project_dir, bridge_script = sys.argv[1:5]
obj = {
    "python_path": python_path,
    "project_dir": project_dir,
    "bridge_script": bridge_script,
}
pathlib.Path(settings_path).write_text(json.dumps(obj, indent=2), encoding="utf-8")
PY
  log_ok "Wrote desktop settings: $settings_path"
}

find_appimage() {
  local root="$1"
  local script_root="$2"

  if [[ -n "$APPIMAGE_PATH" ]]; then
    local p
    p="$(abs_path "$APPIMAGE_PATH")"
    [[ -f "$p" ]] || fail "AppImage not found: $APPIMAGE_PATH"
    printf '%s\n' "$p"
    return
  fi

  local candidates=(
    "$script_root/GenericAgent.AppImage"
    "$root/frontends/GenericAgent.AppImage"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then
      printf '%s\n' "$(abs_path "$p")"
      return
    fi
  done

  # Last-resort support for older versioned artifacts, but generated releases should use GenericAgent.AppImage.
  find "$root/frontends" -maxdepth 1 -type f -name '*.AppImage' 2>/dev/null | sort | head -n 1 || true
}

find_icon() {
  local root="$1"
  local candidates=(
    "$root/frontends/desktop/src-tauri/icons/icon.png"
    "$root/frontends/desktop/src-tauri/icons/128x128.png"
    "$root/frontends/desktop/src-tauri/icons/128x128@2x.png"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then
      printf '%s\n' "$p"
      return
    fi
  done
  printf '%s\n' "generic"
}

shell_quote() {
  python3 - "$1" <<'PY'
import shlex, sys
print(shlex.quote(sys.argv[1]))
PY
}

write_desktop_file() {
  local out="$1"
  local root="$2"
  local appimage="$3"
  local icon="$4"
  mkdir -p "$(dirname "$out")"
  cat > "$out" <<EOF
[Desktop Entry]
Type=Application
Name=GenericAgent Desktop
Comment=Launch GenericAgent Desktop
Exec=$(shell_quote "$appimage")
Path=$root
Icon=$icon
Terminal=false
Categories=Utility;Development;
StartupNotify=true
EOF
  chmod +x "$out"
}

install_desktop_launchers() {
  local root="$1"
  local appimage="$2"
  local icon
  icon="$(find_icon "$root")"

  log_step "Install desktop launchers"
  chmod +x "$appimage"

  local menu_dir="$HOME/.local/share/applications"
  local menu_file="$menu_dir/genericagent-desktop.desktop"
  write_desktop_file "$menu_file" "$root" "$appimage" "$icon"
  log_ok "Application menu launcher: $menu_file"

  local desktop_dir=""
  if [[ -d "$HOME/桌面" ]]; then
    desktop_dir="$HOME/桌面"
  elif [[ -d "$HOME/Desktop" ]]; then
    desktop_dir="$HOME/Desktop"
  else
    desktop_dir="$HOME/Desktop"
    mkdir -p "$desktop_dir"
  fi
  local desktop_file="$desktop_dir/GenericAgent Desktop.desktop"
  write_desktop_file "$desktop_file" "$root" "$appimage" "$icon"

  if command -v gio >/dev/null 2>&1; then
    gio set "$desktop_file" metadata::trusted true >/dev/null 2>&1 || true
    gio set "$menu_file" metadata::trusted true >/dev/null 2>&1 || true
  fi
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$menu_dir" >/dev/null 2>&1 || true
  fi

  log_ok "Desktop launcher: $desktop_file"
  log_ok "If your file manager marks the desktop icon as untrusted, right-click it and choose Allow Launching."
}

start_bridge() {
  local root="$1"
  local py="$2"
  local bridge="$root/frontends/desktop_bridge.py"
  [[ -f "$bridge" ]] || fail "desktop_bridge.py not found: $bridge"
  log_step "Start bridge: $bridge"
  export PYTHONPATH="$root:$root/frontends:${PYTHONPATH:-}"
  exec "$py" "$bridge"
}

launch_appimage() {
  local appimage="$1"
  log_step "Launch AppImage"
  nohup "$appimage" >/tmp/genericagent-desktop-appimage.log 2>&1 &
  log_ok "Started: $appimage"
  log_ok "Log: /tmp/genericagent-desktop-appimage.log"
}

SCRIPT_ROOT="$(resolve_script_root)"

log_step "Resolve project root"
ROOT="$(find_project_root "$SCRIPT_ROOT")"
log_ok "Project root: $ROOT"

# Portable self-prepare (offline, --wheel-dir set): the AppImage is already running and
# manages itself, so skip AppImage discovery and desktop-launcher creation.
PORTABLE_PREPARE=0
[[ -n "$WHEEL_DIR" ]] && PORTABLE_PREPARE=1

APPIMAGE=""
if [[ "$PORTABLE_PREPARE" -eq 0 ]]; then
  log_step "Resolve AppImage"
  APPIMAGE="$(find_appimage "$ROOT" "$SCRIPT_ROOT")"
  [[ -n "$APPIMAGE" ]] || fail "GenericAgent.AppImage not found. Put it next to install_linux.sh in GenericAgent/frontends/."
  chmod +x "$APPIMAGE"
  log_ok "AppImage: $APPIMAGE"
fi

log_step "Resolve Python"
BASE_PY="$(find_python)"
log_ok "Base Python: $BASE_PY"

# Progress marker on the real stdout (the Rust shell reads it); must be outside the
# command-substitution that captures ensure_venv's stdout as the python path.
printf 'GAPROGRESS|venv\n'
PY="$(ensure_venv "$ROOT" "$BASE_PY")"
log_ok "Runtime Python: $PY"

install_dependencies "$ROOT" "$PY"
ensure_mykey "$ROOT"
write_desktop_settings "$ROOT" "$PY"
if [[ "$PORTABLE_PREPARE" -eq 0 ]]; then
  install_desktop_launchers "$ROOT" "$APPIMAGE"
fi

case "$MODE" in
  PrepareOnly)
    log_ok "Linux desktop setup finished. Start GenericAgent Desktop from the desktop icon or application menu."
    ;;
  Launch)
    launch_appimage "$APPIMAGE"
    ;;
  BridgeOnly)
    start_bridge "$ROOT" "$PY"
    ;;
esac
