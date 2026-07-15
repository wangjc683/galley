#!/usr/bin/env bash
# GenericAgent Desktop — portable uninstall (Linux).
#
# Removes everything THIS portable bundle put on the machine, then deletes the
# bundle folder itself:
#   1. Stop the bundle's processes (GUI + bridge/conductor/scheduler python) —
#      only processes whose exe/cmdline live inside this bundle, so a second
#      install on the same machine is left alone.
#   2. Remove the desktop shortcut (GenericAgent.desktop) — only when its Exec
#      points into this bundle.
#   3. Remove ~/.ga_desktop_settings.json (shared settings; other bundles rebuild
#      it on next launch).
#   4. Remove the WebKitGTK data dir (~/.local/share + ~/.cache for the app id).
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
echo "  - delete the desktop shortcut"
echo "  - delete settings (~/.ga_desktop_settings.json)"
echo "  - delete WebView data (~/.local/share/$APP_ID, ~/.cache/$APP_ID)"
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
# Best-effort graceful exit first.
curl -fsS -m 3 -X POST "http://127.0.0.1:14168/services/bridge/exit" >/dev/null 2>&1 || true
sleep 1

# Kill any process whose exe or command line lives inside this bundle — never touch
# a second install (different path). Skip our own uninstall shell and its parent.
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ "$pid" = "$$" ] && continue
  [ "$pid" = "$PPID" ] && continue
  exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
  cl="$( (cat "/proc/$pid/cmdline" 2>/dev/null || true) | tr '\0' ' ')"
  case "$exe $cl" in
    *"$BUNDLE"*) kill -9 "$pid" 2>/dev/null && echo "     killed PID $pid" ;;
  esac
done
echo "[OK] backend stopped"

echo "==> Removing desktop shortcut"
removed_shortcut=0
for f in "$HOME/.local/share/applications/GenericAgent.desktop" \
         "${XDG_DESKTOP_DIR:-$HOME/Desktop}/GenericAgent.desktop" \
         "$HOME/桌面/GenericAgent.desktop"; do
  [ -f "$f" ] || continue
  if grep -qF "$BUNDLE" "$f" 2>/dev/null; then
    rm -f "$f" && { echo "[OK] removed $f"; removed_shortcut=1; }
  else
    echo "     $f points to another bundle; left in place"
  fi
done
[ "$removed_shortcut" = 0 ] && echo "     no desktop shortcut for this bundle found"

echo "==> Removing settings file"
if [ -f "$HOME/.ga_desktop_settings.json" ]; then
  rm -f "$HOME/.ga_desktop_settings.json" && echo "[OK] removed ~/.ga_desktop_settings.json"
else
  echo "     no settings file found"
fi

echo "==> Removing WebView data"
for d in "$HOME/.local/share/$APP_ID" "$HOME/.cache/$APP_ID"; do
  if [ -d "$d" ]; then rm -rf "$d" && echo "[OK] removed $d"; fi
done

echo "==> Removing the bundle folder"
cd /tmp || cd /
if rm -rf "$BUNDLE" 2>/dev/null && [ ! -e "$BUNDLE" ]; then
  echo "[OK] removed $BUNDLE"
else
  # A still-mounted AppImage or busy file can block removal; retry detached after we exit.
  nohup bash -c 'for i in $(seq 1 20); do rm -rf "'"$BUNDLE"'" 2>/dev/null; [ -e "'"$BUNDLE"'" ] || exit 0; sleep 1; done' >/dev/null 2>&1 &
  echo "[OK] bundle folder will be removed after exit: $BUNDLE"
fi

echo
echo "GenericAgent has been uninstalled."
