# Desktop Runtime

> Maintainer-facing document for packaging, app data, and runtime policy.
> For a general architecture overview, read [architecture](./architecture.md).

This document covers desktop packaging and runtime invariants: Tauri app data,
identifier safety, unsigned releases, bundled Python, and Mac / Windows notes.

## Tauri Identifier

Tauri `identifier` binds Galley's app directories on all supported platforms.
The main SQLite DB follows `tauri-plugin-sql` and lives in the app config
directory:

- macOS: `~/Library/Application Support/{identifier}/`
- Linux: `$XDG_CONFIG_HOME/{identifier}/` or `~/.config/{identifier}/`
- Windows: `%APPDATA%/{identifier}/`

Galley currently uses `app.galley`. SQLite data for sessions, projects,
tool events, prefs, and migrations lives under that identifier-controlled
directory.

Changing the identifier without migration makes user data appear to vanish,
because the app starts reading an empty new directory.

## Identifier Change Rule

Do not change the Tauri identifier unless the same change includes:

1. Rust-side startup migration from old data directory to new data directory.
2. Fallback copy / rename behavior if the new DB is missing but the old DB
   exists.
3. Dogfood using a manually seeded old data directory.
4. Release notes explaining the one-time migration.

Historical lesson: the 2026-05-13 rename from `app.gaworkbench` to `app.galley`
made sessions appear missing during dogfood. The data was not lost; the app was
looking at a new directory.

## Signing Strategy

Pre-v1.0 Galley ships unsigned:

- macOS `.app` / `.dmg` are not codesigned or notarized.
- Windows `.exe` / NSIS installer is not signed with an EV certificate.
- Release notes must explain first-launch friction.

Current decision, 2026-05-18: unsigned is acceptable for the current personal
open-source stage. Re-evaluate before v1.0 or when user scale makes manual
Gatekeeper / SmartScreen bypass too costly.

Expected user flow:

- macOS: right click the app, choose Open, then confirm the Gatekeeper dialog.
- Windows: SmartScreen -> More info -> Run anyway.

Any PR adding `codesign`, `notarytool`, or `signtool.exe` should also update
this policy and [release workflow](./release-workflow.md).

## Auto Update Runtime

Galley checks for app updates on startup and exposes the current update state in
Settings -> About / Runtime. Update delivery is enabled only for builds that
provide both compile-time variables:

- `GALLEY_UPDATER_PUBKEY`: Tauri updater public key embedded in the app.
- `GALLEY_UPDATER_ENDPOINT`: HTTPS URL for the updater manifest.

Current stable endpoint:

```text
https://raw.githubusercontent.com/wangjc683/galley/galley-update-channel/updates/stable/latest.json
```

`updates/beta/latest.json` is kept as a legacy alias for builds compiled before
the stable channel cutover.

Without both values, the app reports that this build is not connected to an
update channel and local development keeps working. This is intentional: Tauri
updater package verification is mandatory and should not be bypassed just
because Galley itself is still unsigned at the OS level.

Update installation is task-protected. If any session is actively running,
Galley may remember that an update is available, but it will not download,
install, or relaunch for that update until the session is idle. This avoids
turning a background maintenance action into a lost-task event.

## Background Mode

Galley runs in Background Mode by default on macOS and Windows. Closing the
main window hides the window; it does not quit the app or shut down Galley Core.
This keeps local socket access alive for the CLI, Supervisor automation, and
external IM / agent frontends while the desktop window is out of the way.

The first time the user closes the window on a device (2026-07-18, replacing
the earlier one-time native info dialog), Galley does not hide. The Rust close
handler keeps the window visible and emits `first-close-requested`; the GUI
renders the in-app FirstCloseDialog asking what closing should mean — "keep
running in background" (primary, recommended) or "quit Galley". The verdict is
reported back via the `resolve_first_close` command, which records the choice,
writes it into the `keep_in_background_on_close` behavior (Settings → General
owns it from then on), and executes the hide or the true-quit path. Dismissing
the dialog (Esc / overlay) cancels the close entirely and asks again next
time. An explicit Settings → General toggle of the same preference also counts
as the choice, so the dialog never asks a user who already decided.

The choice state is persisted in the `close_to_background_hint_seen` pref (the
key keeps its legacy name, so users who dismissed the old hint are not
re-asked) and read back during Rust `setup` (right after migrations) to arm an
in-process guard before the window can be closed. Seeding in `setup` rather
than at GUI hydrate is deliberate — it keeps the question
at-most-once-per-device even if the user closes the window before the GUI
finishes hydrating. If the webview hasn't registered its event listener yet
(closing within the first moments of the very first launch), the emit is lost
and the window simply stays open; the next close attempt asks again.

Platform behavior:

- macOS: window close and `Cmd+W` hide the main window. The Dock icon remains,
  and a right-side menu bar status item can reopen or hide Galley.
- Windows: the window close button and `Alt+F4` hide Galley to the system tray.
  The tray menu can reopen or hide Galley.

True application exit is explicit:

- The tray / status item exposes `Quit Galley`.
- macOS also exposes `Quit Galley` from the app menu with `Cmd+Q`.
- If any Agent task is running, true quit asks for confirmation before shutting
  down the app and interrupting active work.

The tray / status item provides the small set of actions useful while Galley is
running in the background:

- `Open Galley` / `Hide Galley`: mirror the current simple window state.
- `New Chat`: reopen Galley and start a new conversation.
- `Settings`: reopen Galley and open Settings.
- `Check for Updates...`: reopen Galley to Settings -> About and check the
  update channel.
- `Quit Galley`: explicitly exit the app.

The first version intentionally has no running / approval badge; task state
remains inside the main UI.

## Launch at Login

Settings -> General offers an opt-in "Launch at login" toggle (since
2026-07-17, `tauri-plugin-autostart`). Default is off — nothing is written
until the user enables it.

Mechanism per platform:

- macOS: a LaunchAgent plist under `~/Library/LaunchAgents`. No permission
  prompt; the item is visible and revocable under System Settings -> Login
  Items, and macOS posts its own "login item added" notice.
- Windows: an `HKCU\...\CurrentVersion\Run` value. Current-user scope, no
  admin, survives NSIS `currentUser` updates (the exe path is stable).

The OS is the single source of truth. The GUI reads the plugin's
`isEnabled()` live on every Settings visit and after every toggle; the state
is deliberately **not** mirrored into Galley prefs. Removing the login item
from system settings therefore shows up in Galley as "off" without any
reconciliation logic.

Login launches are silent. The registered login item carries `--autostart`;
the setup hook reads that flag and leaves the main window hidden, so Galley
starts straight into Background Mode (status item / tray, toggle label
"Open Galley") with Galley Core, the local socket, and IM autostart all
live. To support this without a frame flash, the main window is created
hidden (`visible: false` in `tauri.conf.json`) and shown by the setup hook
on every non-`--autostart` launch — any change to that show path must keep
both launch modes working, or normal launches open an invisible window.

Window size / position / maximized / fullscreen persist across launches via
`tauri-plugin-window-state` (since 2026-07-15), saved to
`.window-state.json` in the app config dir on true quit. Two state flags are
deliberately excluded:

- `VISIBLE`: Background Mode hides the window instead of closing. Quitting
  from the tray while hidden must not restore an invisible window on the
  next launch.
- `DECORATIONS`: Windows runs with native decorations off as custom chrome
  (see the setup hook in `core/src/app_setup.rs`); the plugin must not restore a
  stale decorations value over that.

The curated default geometry (1480×920 centered, sidebar at 20%) is
reachable on demand via **Reset to Default Layout** (2026-07-30): the macOS
Window menu, the command palette entry (also the Windows entry point), and
a sidebar-separator double-click — all three run the full reset (the
separator is the one visible entry point, so its gesture carries the whole
command; upgraded from split-only same day). A hover tooltip on the
separator teaches the gesture. All converge on
`gui/src/lib/layout-reset.ts` + the `reset_window_layout` command; golden
constants live in `core/src/app_setup.rs` and must match `tauri.conf.json`.
First launches center via `center: true`, and `fit_window_to_monitor`
snaps the window to a monitor-clamped golden size only when it overflows
the current display (first run on small screens, or restored state after a
monitor swap). A brief same-day launch-amnesia experiment and its reversal
are chronicled in devlog
[2026-07-30-window-geometry-amnesia](./devlog/2026-07-30-window-geometry-amnesia.md).

Since 2026-07-29 the main window runs with `dragDropEnabled: true`: OS
drags arrive through Tauri's native `onDragDropEvent` stream (real
filesystem paths; the composer's only drop intake), and HTML5 drag-and-drop
never fires in the webview — including text / URL drags, which are consumed
with no payload and surfaced as a copy-paste toast. This is an upstream
wry limitation accepted deliberately; the reasoning and source-level
findings live in `.scratch/composer-file-drop/issues/01` (devlog entry
lands when that feature's tracker closes).

Tauri updater signing is separate from macOS codesigning / Windows Authenticode.
The private updater key must stay in release secrets; only the public key is
safe to embed in app builds.

Release builds opt into signed updater artifacts by generating
`core/tauri.updater.generated.conf.json` inside CI. The default
`tauri.conf.json` intentionally does not enable `createUpdaterArtifacts`, so
local Dev and unsigned local builds do not require `TAURI_SIGNING_PRIVATE_KEY`.

The release workflow creates a candidate `latest.json` as a draft Release asset.
After smoke test and publishing the release, run the manual
`promote-update-channel.yml` workflow to update the beta manifest that installed
apps read.

## Bundled Python

Since v0.1.1, Galley release builds embed CPython 3.11.15 plus GenericAgent core
dependencies. Users do not need to configure Python or a venv for normal use.

Runtime policy:

- Managed / bundled GA must be open-and-run from Galley's own Python and
  packaged dependencies. A release that needs the user's Python to start the
  managed runtime is not release-ready.
- Attach / external GA also defaults to Galley's bundled Python in release
  builds. This gives user-owned GenericAgent checkouts the same baseline
  dependencies without letting Galley modify the checkout, venv, PATH, or state.
- External Python is an explicit escape hatch (`gaConfig.useExternalPython =
  true`) for user-added dependencies, unsupported upstream frontends, or users
  who deliberately want their own interpreter.
- Dev mode uses external Python because `$RESOURCE` does not point at the final
  bundle resource directory during `pnpm tauri dev`.

Implementation notes:

- Source: `python-build-standalone` install-only stripped builds.
- Script: `scripts/bundle-python.sh`.
- Output: `core/python-bundle/python/` generated per target arch.
- Tauri resource: `python-bundle/python/` is bundled as `$RESOURCE/python/`.
- Tauri aliases:
  - `python-bundled` for macOS / Linux (`bin/python3`)
  - `python-bundled-win` for Windows (`python.exe`)
- Release gate: `scripts/check-bundled-python-managed-ga.sh` verifies that the
  generated bundle can import `managed-ga/code` and Galley-owned runtime deps.

Bundled GenericAgent core deps are audited during baseline upgrades. See
[GA baseline](./ga-baseline.md).

## Managed GenericAgent Runtime

Managed / bundled GA keeps code and state separate:

- App resources contain `managed-ga/manifest.json`, `managed-ga/code/`, and
  `managed-ga/patches/`.
- Application Support contains `managed-ga-state/` and
  `managed-model-config/`.
- For unsigned release builds, `workbench.db` contains encrypted managed model
  API key payloads plus the local encryption key. Generated runtime config stores
  only `apiKeyRef`, never plaintext API keys.

Galley may replace the managed code payload during an app update, but it must
not overwrite managed state. Startup may create missing state directories only.
Advanced diagnostics can show managed runtime paths, baseline commit, patch
stack status, and generated config presence; diagnostics must never display API
keys.

Backups of Application Support are expected to restore sessions, managed GA
state, non-secret model metadata, and encrypted managed model credentials for
unsigned release builds.

The managed-runtime product and upgrade rules live in
[managed GA runtime](./managed-ga-runtime.md).

Release builds run `node scripts/check-managed-ga-payload.mjs` before packaging.
That gate verifies the Tauri resource mapping, managed GA manifest, prompt
files, patch stack, and absence of generated / local / secret-bearing artifacts
inside `managed-ga/code`.

## Release Artifacts

Current release path:

- macOS Apple Silicon DMG via CI.
- macOS Intel DMG via CI cross-compile path where available, local fallback if
  needed.
- Windows x64 NSIS installer via CI.

The release-day checklist lives in [release / update SOP](./release-update-sop.md).
The detailed release process lives in [release workflow](./release-workflow.md).
Windows manual smoke lives in [windows build checklist](./windows-build-checklist.md).

## Platform Terminology

- `macOS` means the operating system. Use for platform names, system
  requirements, and release titles.
- `Mac` means the hardware family or user device.
- Release title example: `Galley v0.2.0`.
