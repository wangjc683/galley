# Windows build checklist

> Status: **fallback / smoke path**. Tracks what's needed to produce a Galley
> `.exe` installer on Windows manually and the smoke tests to run on Win
> release artifacts.
>
> Galley v0.2+ release path is **CI-driven** — see [release-workflow.md](./release-workflow.md). This document is the **fallback / offline build path** and Windows smoke checklist: use it when CI is unavailable, when smoke-testing a CI-produced `.exe`, or when validating a local change on a Win machine before pushing.

## 1 · Prerequisites

Install in this order on a clean Windows 10 / 11 machine. Versions reflect what Galley's tooling expects as of 2026-05.

| # | Tool | Min version | Notes |
|---|---|---|---|
| 1 | **Python** | 3.10+ | Bridge subprocess. Use the installer from python.org; tick "Add python.exe to PATH". |
| 2 | **Node.js** | 20.x LTS | Frontend toolchain. Installer from nodejs.org. |
| 3 | **pnpm** | matches root `packageManager` pin (10.x as of 2026-07) | `corepack enable` after Node installs — corepack reads the `packageManager` field in the repo's root `package.json`, so the version always matches CI. Fallback: `npm install -g pnpm@latest-10`. |
| 4 | **Rust toolchain** | stable 1.78+ | Install via `rustup-init.exe` from rustup.rs. Pick the `x86_64-pc-windows-msvc` host triple (default on Win). |
| 5 | **MSVC Build Tools** | 2022 | Required by Rust for native compilation. Install "Desktop development with C++" workload via Visual Studio Build Tools standalone installer. |
| 6 | **WebView2 Runtime** | Evergreen | Already shipped with Win 11. On Win 10 it's usually present via Edge — verify under Settings → Apps → "Microsoft Edge WebView2 Runtime". The Galley installer also includes a bootstrapper that pulls it if absent (`webviewInstallMode: downloadBootstrapper` in `tauri.conf.json`). |

Verification (PowerShell):

```powershell
python --version           # 3.10+
node --version             # v20+
pnpm --version             # matches the root package.json packageManager pin
rustup --version           # any
cargo --version            # any
```

If `cargo` errors with "missing linker", re-run the MSVC Build Tools installer and ensure the C++ workload is checked.

## 2 · Build

```powershell
git clone https://github.com/wangjc683/galley.git
cd galley
pnpm --dir gui install
pnpm --dir gui tauri build
```

The repo is not a pnpm workspace: a plain `pnpm install` at the repo root
installs nothing for `gui/`, and the build then fails on missing frontend
dependencies. Always install and build through `--dir gui` (the root
`pnpm tauri` script is only a shortcut to the same thing and still needs
`gui/` dependencies installed first).

Artifacts land in `core\target\release\bundle\`:

- `nsis\Galley_<version>_x64-setup.exe` — installer
- `msi\Galley_<version>_x64_en-US.msi` — only if `"msi"` is added to bundle targets (not default)

## 3 · Install + first run

1. Double-click `Galley_<version>_x64-setup.exe`
2. NSIS installer runs in current-user mode (no UAC prompt — see `bundle.windows.nsis.installMode: "currentUser"`)
3. Galley appears in Start Menu under "Galley"
4. First launch: Onboarding flow should appear

## 4 · Smoke test checklist

Items to verify on the Win machine. Hand back to Mac for any failures.

### Window chrome (Y plan)

- [ ] Window opens with **no native title bar** (decorations off worked)
- [ ] Drop shadow visible around window edges (`window-shadows-v2` ran)
- [ ] Win 11: rounded corners (DWM auto-applies; if hard corners, file issue)
- [ ] Top-right shows **three custom buttons**: minimize / maximize / close
- [ ] Each button is 46×44 px and the cluster touches the right edge
- [ ] Hover on min / max → gray fill
- [ ] Hover on close → red fill, icon turns white
- [ ] Click min → window minimizes to taskbar
- [ ] Click max → window maximizes; icon swaps to restore glyph
- [ ] Click again → window restores; icon swaps back
- [ ] Click close → window closes (app may stay in background or fully exit depending on Tauri config)
- [ ] **Double-click TopBar** (anywhere not on a button) → maximize toggle
- [ ] **Drag TopBar** → window moves
- [ ] **Drag TopBar while maximized** → window restores then drags (Win convention)
- [ ] **Resize from any edge** → window resizes (invisible resize handles work)
- [ ] **Click another window** → Galley controls desaturate (focus lost)
- [ ] **Click back on Galley** → controls re-saturate
- [ ] Win + Arrow keys snap window left / right / fullscreen (handled by OS, should just work)

### Keyboard shortcuts

- [ ] **Ctrl+K** opens Command Palette
- [ ] **Ctrl+N** starts a new chat
- [ ] **Ctrl+,** opens Settings
- [ ] Settings → Shortcuts shows `Ctrl+K`-style labels (not `⌘K`)

### Onboarding

- [ ] Welcome screen renders (Newsreader font visible, no fallback to Times New Roman)
- [ ] Window can be resized down to `960x600`; onboarding still shows the primary action
- [ ] StepAttach placeholder reads `C:\Users\YourName\Documents\GenericAgent`
- [ ] "选择" button opens Windows file dialog
- [ ] Path validation runs (red on bad path, green on real GA)
- [ ] External GA path with leading / trailing whitespace is trimmed before validation
- [ ] `~`, `~/`, and `~\` expand to the user home before validation
- [ ] StepHealth checks pass (Python found as `python`, not `python3`)
- [ ] External GA runtime probe imports GA, lists models, and reports a useful error for missing dependencies
- [ ] LLM row copy mentions the real test and one-output-token cap
- [ ] "继续" enters main app

### Bridge / chat

- [ ] Managed GA: first user message reaches GA (no spawn errors)
- [ ] External GA: first user message uses the Python selected by onboarding / runtime probe
- [ ] LLM streaming visible
- [ ] Tool approval modal works (if YOLO mode is off; default is on)
- [ ] Conversation persists after app restart

### Settings / runtime

- [ ] Settings -> Runtime can switch between managed and external GA without losing the other mode's sessions
- [ ] Runtime-switch toast appears bottom-left, stays compact, and does not show "Copy details"
- [ ] Settings close button remains clickable while toasts are visible
- [ ] Error / warning toast still shows diagnostic copy details when traceback or context exists

### Settings -> Models

- [ ] Provider list-model action is labeled as reading the model list when no model exists
- [ ] Existing model rows use an icon-only test action with fast tooltip feedback
- [ ] Saved model test shows low-weight copy: `模型测试最多 1 个输出 token`
- [ ] A provider that cannot list models should not be treated as unusable if a saved model test succeeds

### Channels

- [ ] Managed GA mode shows the TopBar Channels icon between Browser Control and Settings
- [ ] External GA mode hides the TopBar Channels icon and the Settings Channels tab
- [ ] Clicking the TopBar Channels icon opens Settings -> Channels
- [ ] Channels icon has no status dot or unread-message badge
- [ ] Settings sidebar shows `Channels` with Chinese helper `聊天软件`
- [ ] WeChat QR refresh uses a fresh image path and does not show a stale QR code

### Tutorial modal

- [ ] "memory-info" tutorial shows BOTH Mac/Linux and Windows command examples (already OS-agnostic in tutorial content)

### YOLO intro dialog

- [ ] First main view load shows YoloIntroDialog
- [ ] ESC / overlay / X are all suppressed (blocking modal)
- [ ] "知道了" / "改回审批模式" buttons work

## 5 · Known sharp edges

- **Maximize 8px overflow**: Win has a quirk where maximized borderless windows can overflow the screen edge by ~8px. If you see this, it's a `window-shadows-v2` or DWM interaction — Tauri community usually solves with a `--margin: 8px` CSS workaround on the root element. Tracked but unfixed in v0.2.
- **Resize handles too thin to grab**: invisible resize borders default to ~4px. If users complain, increase via Rust `set_inner_size` calculations or use `window-vibrancy` shadow workaround.
- **Snap Layouts hover picker missing**: intentionally not implemented in v0.2 (requires WM_NCHITTEST in Rust). Win 11 users can still snap via Win+Arrow.
- **CopySimple restore icon ambiguity**: the Phosphor `CopySimple` glyph stands in for the "two-overlapping-squares" restore icon. If Win users find it unclear, swap to inline SVG.

## 6 · Hand-back to Mac

After smoke testing:

1. Take screenshots of any visual oddity (especially window chrome edge cases)
2. List failed checkboxes with brief notes
3. Push any bug fixes that need Win-machine cycles to a feature branch
4. Mac-side work resumes on `main`

## 7 · CI path

GitHub Actions is now the primary release path:

- `.github/workflows/check.yml` verifies macOS Apple Silicon, macOS Intel, and Windows x64 before merge / push.
- `.github/workflows/release.yml` builds the three release artifacts and creates a draft GitHub Release.
- `.github/workflows/promote-update-channel.yml` promotes a published, smoke-tested release into the stable update channel (with `beta` kept as a legacy alias for older installed builds).

Keep this checklist for Windows smoke testing and for fallback local builds when CI is unavailable.
