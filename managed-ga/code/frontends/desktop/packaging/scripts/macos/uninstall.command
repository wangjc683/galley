#!/usr/bin/env bash
# GenericAgent Desktop — portable uninstall (macOS). Double-clickable in Finder (.command).
#
# Removes everything THIS portable bundle put on the machine, then deletes the
# bundle folder itself:
#   1. Stop the bundle's processes (GUI + bridge/conductor/scheduler python) —
#      only processes whose command line lives inside this bundle.
#   2. Remove the desktop alias (~/Desktop/GenericAgent.app) — only when it links
#      into this bundle.
#   3. Remove ~/.ga_desktop_settings.json (shared settings).
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
echo "  - delete settings (~/.ga_desktop_settings.json)"
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
curl -fsS -m 3 -X POST "http://127.0.0.1:14168/services/bridge/exit" >/dev/null 2>&1 || true
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

echo "==> Removing settings file"
if [ -f "$HOME/.ga_desktop_settings.json" ]; then
  rm -f "$HOME/.ga_desktop_settings.json" && echo "[OK] removed ~/.ga_desktop_settings.json"
else
  echo "     no settings file found"
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
