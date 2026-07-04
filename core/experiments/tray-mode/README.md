# Experiment: Tauri v2 tray + background-mode hide/show

**Status**: 📋 Spec ready · spike not yet run · prereq gate for B4 M1
**Purpose**: 1-day throwaway prototype to validate Tauri v2 tray API + hide-window + WebView keep-alive on macOS 14+ AND Windows 11 before committing 2-3 weeks to B4's menubar daemon work.
**Gate for**: [B4 M2](../../../docs/archive/refactor/B4-cli-bg-artifact.md#m2--tray-spike--background-mode-menubar-daemon-d55-d57) — go/no-go based on this experiment.
**Related**:
- [B4 playbook](../../../docs/archive/refactor/B4-cli-bg-artifact.md) §M2 + risk #1 + G2
- [PRD §13 Background mode](../../../docs/PRD.md#13-background-mode)
- Predecessor pattern: [bridge-owner prototype](../bridge-owner/README.md)
- Tauri v2 tray docs: `tauri::tray::TrayIconBuilder` API surface

## Why we need this prototype

B4 M2 introduces menubar daemon mode — close window → hide (not exit), Cmd+Q → real quit, Galley Core stays alive in menubar so CLI write commands can reach a running socket listener. This is **the highest-risk technical assumption in B4** because:

1. **Tauri v2 tray API is new** (rewrite from v1's `tauri-plugin-system-tray`) and cross-platform behavior reports are mixed
2. **macOS App Nap** can throttle backgrounded Tauri WebView JavaScript by 10-100×, which would make CLI write commands feel "frozen" to the supervisor agent. PRD §13.1 implicitly assumes responsiveness stays — needs validation
3. **WebView keep-alive while window hidden** isn't a documented Tauri guarantee. If Tauri pauses the WebView when no window is visible, the JS-side IPC event listeners (the slice stores) won't process incoming runner events until the window is reopened — meaning state goes stale, and history would re-stream from Rust on every show, wasting CPU
4. **Windows tray differs from macOS menubar** — Tauri abstracts both but reports of Windows-specific quirks (icon disappears, badge not supported, click-to-show stops working after sleep/resume) exist in Tauri v2 GitHub issues
5. **Cross-platform parity matters for v0.2 framing** — if macOS works but Windows tray is broken, we either ship Mac-only v0.2 (mirror v0.1 Mac-only decision) or block B4 on Windows-specific workarounds

This prototype answers these in 1 day **before** committing 2-3 weeks to B4 M2-M3.

## Non-goals

To keep scope tight:

- ❌ Do not integrate with Galley Core / runner_manager / SQLite — spike runs in a standalone Tauri shell
- ❌ Do not implement full menubar menu (just enough items to validate click-to-menu-item callback wiring)
- ❌ Do not implement CLI socket → window action — instead, simulate "CLI writes while window hidden" with a Rust `tokio::spawn` timer that emits a Tauri event every 500ms and a JS-side `listen()` that increments a counter (visible when window is re-shown)
- ❌ Do not pretty-print the WebView UI — a plain HTML page with `<h1>Hidden time: Xs / events received: N</h1>` is enough
- ❌ Do not test tray icon design / branding — use a placeholder icon (gradient PNG or Tauri default)
- ❌ Do not run on macOS 26 (Tahoe) — JC's mac is macOS 14, CI is macos-15; Tahoe behavior gets deferred to post-v0.2 ([B4 O9](../../../docs/archive/refactor/B4-cli-bg-artifact.md#open-decisionsb4-启动前要拍))

This experiment is **throwaway**. Code lives in `core/experiments/tray-mode/` and is not part of the production build (excluded via `[[bin]]` + feature flag, mirror bridge-owner pattern).

## Architecture (under test)

```
                          ┌────────────────────────────┐
                          │  Galley Tauri process      │
                          │  (Rust + WebView)          │
                          │                            │
   macOS menubar icon  ←──┤  TrayIconBuilder          │
   Windows tray icon   ←──┤  ├─ menu (Show/Quit/N idle)│
                          │  ├─ icon update API       │
   click → menu item   ──→│  └─ on_menu_event handler │
                          │                            │
   window red X / Alt+F4  │  WindowEvent::CloseRequested
       → hide   ←─────────┤    → window.hide() +      │
                          │      api.prevent_close()  │
                          │                            │
   tray Quit  → exit  ←───┤  on_menu_event "quit"     │
                          │    → app.exit(0)          │
                          │                            │
   tokio timer       ─────┤  emit("heartbeat", N)     │
   (500ms, simulates CLI) │    every 500ms while alive│
                          │                            │
   WebView JS         ←───┤  listen("heartbeat")      │
                          │    increments counter     │
                          │                            │
   macOS App Nap?     ←───┤  NSProcessInfo            │
                          │    .beginActivity         │
                          │    (Latency-Critical)     │
                          └────────────────────────────┘
```

The spike under test validates: (a) tray icon registration + menu wiring (b) hide-window semantics (c) WebView keep-alive while hidden (d) App Nap defeat (e) true exit via tray Quit. Each is a separate T item below.

## Validation checklist

Each item is **pass / fail / unknown**. Sections grouped by capability. **All must pass for B4 M2 GO** — or each FAIL gets explicit fallback strategy logged.

### Tray registration (T1-T4)

- [ ] **T1 (macOS)**: Tray icon renders in the menubar on app launch. Visible right of system icons (volume, wifi, etc.). Survives 5-minute idle.
- [ ] **T2 (macOS)**: Tray icon **left-click** opens the menu. Menu shows 3 items: "Show Galley", "1 active · 0 idle" (disabled / status display), "Quit Galley".
- [ ] **T3 (Windows)**: Tray icon renders in the system tray (bottom-right notification area). Visible after Windows boot + after wake-from-sleep cycle.
- [ ] **T4 (Windows)**: Tray icon **left-click** opens the menu (or **right-click** if Windows convention dictates — note which one the spike implements + document Tauri default).

### Hide-window semantics (T5-T8)

- [ ] **T5 (macOS)**: Red X (close button) triggers `WindowEvent::CloseRequested`. With `api.prevent_close()` + `window.hide()`, window hides but app process keeps running. Verify `ps aux | grep tray-mode-experiment` still shows the process.
- [ ] **T6 (macOS)**: `Cmd+W` (close keyboard shortcut) follows the same hide path. Hides cleanly.
- [ ] **T7 (Windows)**: Red X (close button) triggers `WindowEvent::CloseRequested`. Window hides, process stays alive. Verify Task Manager shows the process running.
- [ ] **T8 (Windows)**: `Alt+F4` follows same hide path.

### Show-window from tray (T9-T10)

- [ ] **T9 (macOS)**: Tray menu "Show Galley" → `window.show() + window.set_focus()` → window appears AND comes to front (in front of other apps that gained focus during hide). If "show but stays behind other windows" — that's a partial fail, note it.
- [ ] **T10 (Windows)**: Same — tray Show → window in front. (Windows has more aggressive focus-stealing prevention; might need `window.set_always_on_top(true)` momentarily as workaround.)

### Quit (true exit) (T11-T12)

- [ ] **T11 (macOS)**: Tray menu "Quit Galley" → `app.exit(0)` → process truly exits. `ps aux | grep tray-mode-experiment` returns empty within 2s. Dock icon disappears.
- [ ] **T12 (Windows)**: Tray menu "Quit Galley" → process truly exits. Task Manager shows process gone within 2s.

### WebView keep-alive while hidden (T13-T16)

**Critical for B4 — if WebView pauses while hidden, slice stores don't process events and CLI writes become invisible until window re-shown.**

- [ ] **T13 (macOS)**: Hide window. Verify Rust-side `tokio::spawn` timer (500ms tick) keeps firing — log timestamps in Rust side. Backend liveness is the baseline.
- [ ] **T14 (macOS)**: Verify WebView JS-side `listen("heartbeat")` increments its counter while window is hidden. To test this: hide window for 60 seconds, re-show, check counter is 120 (60s × 2 per second), not stuck at 0.
  - **PASS criteria**: counter == expected ±5% (some clock drift is OK; >5% missed means WebView throttled)
  - **FAIL means**: WebView paused — B4 M2 needs workaround (force WebView refresh on show? Re-fetch state from Rust? Both are ugly.)
- [ ] **T15 (Windows)**: Same as T13 — Rust timer fires while hidden.
- [ ] **T16 (Windows)**: Same as T14 — WebView counter increments while hidden.

### macOS App Nap defeat (T17-T19)

App Nap throttles CPU + delays timers for backgrounded apps. Galley needs **Latency-Critical** activity assertion via `NSProcessInfo` to stay responsive.

- [ ] **T17 (macOS only)**: WITHOUT App Nap defeat, hide window for 5 minutes, then trigger a Rust→JS event burst. Measure first-event latency. Document the **un-defeated baseline** (might be 5-30 seconds delay if Nap engaged).
- [ ] **T18 (macOS only)**: WITH App Nap defeat (`NSProcessInfo.beginActivity` with `.userInitiated | .latencyCritical` options held via Rust `objc2-foundation` or `cocoa` crate), repeat T17 measurement. First-event latency should be **< 100ms** consistently (matches active-window baseline).
- [ ] **T19 (macOS only)**: With App Nap defeat active, verify memory growth — `Activity Monitor → Energy` tab should show app as "Preventing Sleep" or similar indicator. Confirm CPU stays low (<2%) during idle 5-minute hidden window (App Nap defeat shouldn't busy-loop).

### Cross-platform parity (T20)

- [ ] **T20**: Same spike binary, same test scenarios, both platforms pass T1-T16 (T17-T19 macOS only). If macOS PASS + Windows FAIL on any of T1-T16 → document specific failure mode + propose Mac-only v0.2 fallback strategy.

## Implementation outline

### Build configuration

Add to `core/Cargo.toml` (alongside the existing bridge-owner experiment):

```toml
[[bin]]
name = "tray-mode-experiment"
path = "experiments/tray-mode/main.rs"
required-features = ["experiments"]
```

Build with: `cargo build --features experiments --bin tray-mode-experiment`. Production build does not include this code.

**Likely new dependencies** (under `experiments` feature):

```toml
[target.'cfg(target_os = "macos")'.dependencies]
# For App Nap defeat. Prefer objc2-foundation (newer, safer) over cocoa.
objc2 = { version = "0.5", optional = true, features = ["foundation"] }
objc2-foundation = { version = "0.2", optional = true }
```

### Files

```
core/experiments/tray-mode/
├── README.md          (this file)
├── main.rs            entry point: Tauri app + tray + heartbeat timer
├── index.html         minimal WebView UI showing counter + status
├── app_nap.rs         macOS App Nap defeat helper (cfg(target_os = "macos"))
├── tests.sh           shell scripts to run validation
└── results.md         (write findings here after experiment)
```

### Pseudo-code outline (`main.rs`)

```rust
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // --- Build tray menu ---
            let show = MenuItem::with_id(app, "show", "Show Galley", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "1 active · 0 idle", false, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Galley", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &status, &separator, &quit])?;

            // --- Register tray icon ---
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // --- Hook window close → hide ---
            let main_window = app.get_webview_window("main").unwrap();
            let w_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w_clone.hide();
                }
            });

            // --- Heartbeat timer (simulates CLI writes while hidden) ---
            let app_handle = app.handle().clone();
            tokio::spawn(async move {
                let mut counter = 0u64;
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    counter += 1;
                    let _ = app_handle.emit("heartbeat", counter);
                    println!("[rust] heartbeat #{} at {:?}", counter, std::time::Instant::now());
                }
            });

            // --- macOS App Nap defeat ---
            #[cfg(target_os = "macos")]
            {
                let _activity = app_nap::begin_latency_critical_activity("Galley CLI responsiveness");
                // _activity is leaked intentionally — lives for app lifetime
                std::mem::forget(_activity);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Pseudo-code outline (`app_nap.rs`)

```rust
#[cfg(target_os = "macos")]
pub fn begin_latency_critical_activity(reason: &str) -> impl Drop {
    use objc2_foundation::{NSProcessInfo, NSString};

    // Options bitmask: NSActivityUserInitiated | NSActivityLatencyCritical
    // = 0x00FFFFFF | 0xFF00000000000000
    const NS_ACTIVITY_USER_INITIATED: u64 = 0x00FFFFFF;
    const NS_ACTIVITY_LATENCY_CRITICAL: u64 = 0xFF00000000000000;
    let options = NS_ACTIVITY_USER_INITIATED | NS_ACTIVITY_LATENCY_CRITICAL;

    let info = NSProcessInfo::processInfo();
    let reason_ns = NSString::from_str(reason);
    let activity = unsafe { info.beginActivityWithOptions_reason(options, &reason_ns) };

    ActivityGuard { activity }
}

struct ActivityGuard {
    activity: objc2::rc::Retained<objc2_foundation::NSObject>,
}

impl Drop for ActivityGuard {
    fn drop(&mut self) {
        let info = objc2_foundation::NSProcessInfo::processInfo();
        unsafe { info.endActivity(&self.activity) };
    }
}
```

### Pseudo-code outline (`index.html`)

```html
<!DOCTYPE html>
<html><body style="font-family:system-ui;padding:24px;">
<h1>Tray-mode spike</h1>
<p>Heartbeat counter: <span id="counter">0</span></p>
<p>Window hidden time: <span id="hidden">0s</span></p>
<p>Last event: <span id="last">never</span></p>
<script>
  const { listen } = window.__TAURI__.event;
  let counter = 0;
  let hiddenSince = null;
  listen("heartbeat", (e) => {
    counter = e.payload;
    document.getElementById("counter").textContent = counter;
    document.getElementById("last").textContent = new Date().toLocaleTimeString();
  });
  // hidden tracker: every 1s, check document.hidden (Page Visibility API)
  setInterval(() => {
    if (document.hidden) {
      if (!hiddenSince) hiddenSince = Date.now();
      const sec = Math.round((Date.now() - hiddenSince) / 1000);
      document.getElementById("hidden").textContent = sec + "s";
    } else {
      hiddenSince = null;
      document.getElementById("hidden").textContent = "0s";
    }
  }, 1000);
</script>
</body></html>
```

### Test commands (`tests.sh`)

```bash
#!/bin/bash
set -euo pipefail

EXPERIMENT_BIN="${EXPERIMENT_BIN:-./target/debug/tray-mode-experiment}"

# T11/T12: process exit on Quit
echo "=== T11/T12: Quit menu → process exit ==="
$EXPERIMENT_BIN &
PID=$!
sleep 3
# In real spike: manually click tray "Quit" via UI. This script just verifies
# the process responds to SIGTERM identical to Quit menu (proxy test).
kill -TERM $PID
sleep 2
if ps -p $PID > /dev/null 2>&1; then
  echo "FAIL: process $PID still alive after Quit"
  exit 1
fi
echo "PASS"

# T14/T16: counter accuracy while hidden
echo "=== T14/T16: WebView keep-alive ==="
# Manual: launch experiment, click red X to hide window, wait 60s, click tray
# "Show", check counter. Expected: counter ≈ 120 (500ms × 60s × 2/s).
# This is fundamentally interactive; document the test as "manual verification
# required" in spike report.

# T17/T18: App Nap latency measurement (macOS only)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "=== T17/T18: App Nap defeat measurement (manual) ==="
  echo "Run experiment, hide window for 5 minutes, then re-show."
  echo "Compare counter delta vs expected (5 min × 2/s = 600)."
  echo "WITHOUT App Nap defeat: counter likely 50-200 (heavily throttled)."
  echo "WITH App Nap defeat: counter should be 600 ± 30."
fi
```

## Go/no-go decision

- **macOS T1-T16 all PASS + T17-T19 confirm App Nap defeated** → **GO for B4 M2 macOS**
- **Windows T1-T16 all PASS** → **GO for B4 M2 Windows**
- **Both platforms PASS** → **GO for full B4 M2** (default plan)
- **macOS GO + Windows FAIL on T3-T16** → propose **Mac-only v0.2 background mode** (mirror v0.1 Mac-only decision). v0.6 budgets Windows tray fix.
- **macOS FAIL on T14 (WebView paused while hidden)** → **NO-GO**. Background mode entire premise breaks if WebView can't process events while hidden. Alternative: stay foreground-only for v0.2, defer background to v0.6. Likely culprits: Tauri default may pause WebView; explore `WebViewBuilder::auto_hide_menu` or alternative flags.
- **macOS FAIL on T18 (App Nap not defeated despite NSProcessInfo)** → investigate. Likely culprits: `beginActivity` not called early enough in app lifecycle; activity object dropped prematurely. Should be fixable with implementation tuning, not a deal-breaker.
- **Either platform FAIL on T1 (tray icon doesn't render)** → **NO-GO**. Tauri v2 tray API itself doesn't work; B4 M2 must wait for upstream Tauri fix or use platform-specific native code (much more work).

## Findings (fill in after running)

> **To be filled in by the experimenter after the prototype runs.** Include:
> - Date of each session, who ran it
> - Per-checklist item status (pass / fail / N/A)
> - Quantitative measurements (App Nap latency before/after, counter accuracy)
> - Surprises / unknowns discovered during the experiment
> - Final go/no-go recommendation
> - If no-go, what would need to change before re-attempting

(empty)

## After-experiment cleanup

If go:

- Move tray + hide-window + App Nap defeat patterns to `core/src/` (B4 M2 first commit)
- Keep `experiments/tray-mode/` and this README as historical reference (mirror bridge-owner pattern)
- Add findings to a new devlog: `docs/devlog/<date>-b4-tray-spike-results.md` (mirror `2026-05-18-prototype-go-for-b1.md`)
- B4 playbook prereq tick: T0 [tray plugin v2 spike] ✓
- Cursor advances to B4 M1 T1.0 (M1 sub-plan)

If no-go:

- Document failures in `results.md`
- Open devlog entry: "B4 tray spike — NO-GO findings + fallback strategy"
- If Mac-only fallback: update B4 playbook to scope Windows tray as v0.6+ deferred work
- If WebView keep-alive fails: re-design B4 M2 to keep window always visible (background mode = minimized + tray Show shortcut only); update PRD §13 accordingly

## Cursor / running notes (append-only per invariant I10)

**Cursor**: B4 prereq gate — spike not yet started. Run on JC mac (macOS 14) + Windows machine (Win11) when available.

### 2026-05-20 · Spec ship

- README spec written (paperwork-only commit).
- Files `main.rs` / `index.html` / `app_nap.rs` / `tests.sh` to be scaffolded when spike actually runs (mirror bridge-owner pattern where scaffold happens in spike session 1).
- **Estimated spike duration**: 1 day (4-6h). Optimistic because:
  - bridge-owner prototype was estimated 2-3 days and ran in single session (~5h)
  - Tray + hide-window mechanics are mostly Tauri-tutorial-level work
  - App Nap defeat is one specific API call wrapped in a Drop guard
  - The risk is **manual verification of cross-platform behavior** — automated tests can't fully cover "did tray icon render visually"
- **Risk if estimate overruns**: Windows machine access (JC borrows). If Windows blocked >1 day → ship spike report with Mac-only findings, plan Mac-only v0.2 contingency.
- **Pre-run TODO**:
  - [ ] Verify `tauri` crate version in `core/Cargo.toml` matches v2 (already v2 per existing code; double-check `TrayIconBuilder` is the correct API path)
  - [ ] Confirm `objc2-foundation` version compatible with existing Rust toolchain
  - [ ] Decide tray icon placeholder — use Galley app icon scaled down, or solid placeholder
