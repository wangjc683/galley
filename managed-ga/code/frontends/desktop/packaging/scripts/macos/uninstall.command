#!/usr/bin/env bash
# GenericAgent Desktop — portable uninstall (macOS). Double-clickable in Finder (.command).
#
# Removes everything THIS portable bundle put on the machine, then deletes the
# bundle folder itself:
#   1. Stop the bundle's processes (GUI + bridge/conductor/scheduler python) —
#      only processes whose command line lives inside this bundle.
#   2. Remove the desktop alias (~/Desktop/GenericAgent.app) — only when it links
#      into this bundle.
#   3. Detach only this bundle's path settings while keeping shared preferences.
#   4. Remove the WKWebView data for the app id under ~/Library.
#   5. Delete the bundle folder.
set -u

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
APP_ID="com.genericagent.app"

echo "============================================================"
echo " GenericAgent Desktop - Uninstall"
echo "============================================================"
echo
echo "This will completely remove GenericAgent from this computer:"
echo "  - stop its background services (bridge 14168 / conductor 8900)"
echo "  - delete the desktop alias"
echo "  - detach this bundle from shared desktop settings (preferences are kept)"
echo "  - delete WebView data (~/Library/.../$APP_ID)"
echo "  - delete THIS folder and everything in it:"
echo "      $BUNDLE"
echo
echo "This cannot be undone."
echo
read -r -p "Type Y to uninstall, anything else to cancel: " CONFIRM
case "$CONFIRM" in
  y|Y) ;;
  *) echo; echo "Cancelled. Nothing was changed."; exit 0 ;;
esac

echo
echo "==> Stopping GenericAgent backend services"
RUNTIME_ROOT="$BUNDLE/runtime"
[[ -d "$RUNTIME_ROOT/app" ]] || RUNTIME_ROOT="$BUNDLE/GenericAgent.app/Contents/Resources/runtime"
RUNTIME_PY="$RUNTIME_ROOT/python/bin/python3"
PROJECT_DIR="$RUNTIME_ROOT/app"
SETTINGS_HELPER="$RUNTIME_ROOT/merge_desktop_settings.py"
IDENTITY="$(curl -fsS -m 3 "http://127.0.0.1:14168/services/identity" 2>/dev/null || true)"
if [[ -x "$RUNTIME_PY" && -n "$IDENTITY" ]] && \
   BUNDLE="$BUNDLE" IDENTITY="$IDENTITY" "$RUNTIME_PY" -c \
     'import json, os, pathlib; app=pathlib.Path(json.loads(os.environ["IDENTITY"])["app_dir"]).resolve(); bundle=pathlib.Path(os.environ["BUNDLE"]).resolve(); raise SystemExit(0 if app == bundle or bundle in app.parents else 1)'; then
  curl -fsS -m 3 -X POST "http://127.0.0.1:14168/services/bridge/exit" >/dev/null 2>&1 || true
else
  echo "     bridge listener is not owned by this bundle; left running"
fi
sleep 1

# Kill any process whose command line lives inside this bundle (no /proc on macOS,
# so match on the full argv via ps; -ww disables column truncation so a deep bundle
# path is never cut off). Scoped to the bundle path → other installs untouched.
# Skip our own shell ($$) and its parent (the Terminal-spawned launcher).
selfpid=$$
ps -axww -o pid=,command= 2>/dev/null | while read -r pid cmd; do
  [ "$pid" = "$selfpid" ] && continue
  [ "$pid" = "$PPID" ] && continue
  case "$cmd" in
    *"$BUNDLE"*) kill -9 "$pid" 2>/dev/null && echo "     killed PID $pid" ;;
  esac
done
echo "[OK] backend stopped"

echo "==> Removing desktop alias"
link="$HOME/Desktop/GenericAgent.app"
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    "$BUNDLE"*) rm -f "$link" && echo "[OK] removed $link" ;;
    *) echo "     desktop alias points to another bundle; left in place" ;;
  esac
else
  echo "     no desktop alias found"
fi

echo "==> Detaching bundle paths from shared settings"
if [[ -f "$HOME/.ga_desktop_settings.json" && -x "$RUNTIME_PY" \
      && -f "$SETTINGS_HELPER" && -f "$PROJECT_DIR/frontends/desktop_settings.py" ]]; then
  if "$RUNTIME_PY" "$SETTINGS_HELPER" \
      --settings "$HOME/.ga_desktop_settings.json" \
      --project-dir "$PROJECT_DIR" \
      --remove-bundle "$BUNDLE"; then
    echo "[OK] removed this bundle's path keys; preferences and overrides were kept"
  else
    echo "     settings were invalid or locked; left unchanged"
  fi
else
  echo "     no owned settings paths could be detached"
fi

echo "==> Removing WebView data"
for d in "$HOME/Library/WebKit/$APP_ID" \
         "$HOME/Library/Caches/$APP_ID" \
         "$HOME/Library/Application Support/$APP_ID" \
         "$HOME/Library/HTTPStorages/$APP_ID" \
         "$HOME/Library/Saved Application State/$APP_ID.savedState"; do
  if [ -e "$d" ]; then rm -rf "$d" && echo "[OK] removed $d"; fi
done
rm -f "$HOME/Library/Preferences/$APP_ID.plist" 2>/dev/null || true

echo "==> Removing the bundle folder"
cd /tmp || cd /
if rm -rf "$BUNDLE" 2>/dev/null && [ ! -e "$BUNDLE" ]; then
  echo "[OK] removed $BUNDLE"
else
  nohup bash -c 'for i in $(seq 1 20); do rm -rf "'"$BUNDLE"'" 2>/dev/null; [ -e "'"$BUNDLE"'" ] || exit 0; sleep 1; done' >/dev/null 2>&1 &
  echo "[OK] bundle folder will be removed after exit: $BUNDLE"
fi

echo
echo "GenericAgent has been uninstalled."
