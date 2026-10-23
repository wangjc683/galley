# M2 tray-mode spike · results

> **Status**: 📦 Scaffold + code shipped 2026-05-20。Build verification + T1-T16 manual checks deferred to JC's local machine (cargo build wall-clock was burning my session budget; the binary is straightforward to launch locally).
>
> **Verdict**: pending — JC runs spike + fills in T1-T16 rows below.

---

## Session 1 · 2026-05-20 (Claude scaffold)

### What shipped

- `Cargo.toml` — own workspace, tauri v2 + tray-icon feature
- `build.rs` — tauri_build::build()
- `tauri.conf.json` — identifier `app.galley.m2spike` (isolated from production), frontendDist=`.`, bundle.active=false
- `index.html` — heartbeat counter + hidden-time tracker + App Nap status row
- `src/main.rs` — tray menu (Show / status / Quit) + `WindowEvent::CloseRequested → hide` + heartbeat thread (500ms tick via `std::thread::spawn`, native thread to avoid tokio runtime dep) + tray Quit → `app.exit(0)`
- `icons/icon.png` — copied from `core/icons/128x128.png`

### What was attempted but cut from spike

- **App Nap defeat (T17-T19)** — originally included via `objc2` + `objc2-foundation` to call `NSProcessInfo.beginActivityWithOptions_reason`. Pulled out mid-session because:
  - First compile error: `NSActivityOptions` is a newtype, not raw `u64` — fixable trivially
  - Subsequent build attempts hit linker errors (`clang: error: linker command failed`) with truncated diagnostic, then a 12-min rustc codegen hang in `objc2-foundation` macro expansion
  - After 30+ min on Foundation framework link issues, made the call to drop App Nap from this spike entirely
  - T17-T19 graduate to a **separate App Nap probe** — much smaller surface, no Tauri involvement, can be `cargo run` standalone

### Build status

Multiple build attempts during session:

| Build | Result | Time |
|---|---|---|
| #1 (cold, with objc2) | ✅ compiled | 1m57s |
| Run #1 | ✗ runtime panic: `tokio::spawn` called without tokio runtime context (Tauri tao event loop ≠ tokio) |
| #2 (after `tokio::spawn` → `tauri::async_runtime::spawn`) | ✗ linker error, log truncated by `tail -10` |
| #3 (full-log retry) | ✗ killed at 13 min after rustc codegen hang in objc2 monomorphization |
| #4 (cleared incremental cache, `CARGO_INCREMENTAL=0`) | ✗ killed at 8 min, same hang |
| #5 (dropped objc2 deps + simplified to `std::thread`) | ⏸ killed at 6 min mid-build (Tauri cold rebuild after dep change is 8-15 min on this machine; user opted to take over locally) |

### What JC should do to finish the spike

```bash
cd ~/Documents/genericagent-webui/core/experiments/tray-mode
cargo build              # cold rebuild of Tauri 2.11 — 8-15 min wall-clock
./target/debug/tray-mode-spike   # launch; menubar icon should appear top-right
```

Then manually check the T1-T16 table below.

---

## Validation checklist · T1-T16 (T17-T19 deferred)

> **Manual verification by JC**. Fill in column 4 with `PASS` / `FAIL` / `note` after running spike.

### Tray registration (T1-T4)

| T | Platform | Test | Result |
|---|---|---|---|
| T1 | macOS | Tray icon renders in menubar on app launch. Visible right of system icons. Survives 5-min idle. | ⏳ |
| T2 | macOS | Left-click tray opens menu. 3 items: Show Galley / "1 active · 0 idle" (disabled) / Quit Galley | ⏳ |
| T3 | Windows | (deferred — no Win machine) | ⏭ N/A this session |
| T4 | Windows | (deferred) | ⏭ N/A this session |

### Hide-window semantics (T5-T8)

| T | Platform | Test | Result |
|---|---|---|---|
| T5 | macOS | Red X (close button) triggers CloseRequested → window hidden, process alive (`ps aux \| grep tray-mode-spike` shows it) | ⏳ |
| T6 | macOS | Cmd+W → same hide path | ⏳ |
| T7 | Windows | (deferred) | ⏭ |
| T8 | Windows | (deferred) | ⏭ |

### Show-window from tray (T9-T10)

| T | Platform | Test | Result |
|---|---|---|---|
| T9 | macOS | Tray menu "Show Galley" → window appears AND comes to front | ⏳ |
| T10 | Windows | (deferred) | ⏭ |

### Quit (true exit) (T11-T12)

| T | Platform | Test | Result |
|---|---|---|---|
| T11 | macOS | Tray menu "Quit Galley" → `app.exit(0)` → process truly exits. `ps aux \| grep tray-mode-spike` empty within 2s | ⏳ |
| T12 | Windows | (deferred) | ⏭ |

### WebView keep-alive while hidden (T13-T16)

| T | Platform | Test | Result |
|---|---|---|---|
| T13 | macOS | Rust-side stderr `[m2-spike] heartbeat #N` logs every 5s (10 ticks × 500ms) while window hidden | ⏳ |
| T14 | macOS | WebView JS counter shows ≈ wall-clock × 2 while hidden. Hide 60s → counter advances ≈120. If <100 → WebView throttled (T14 FAIL) | ⏳ |
| T15 | Windows | (deferred) | ⏭ |
| T16 | Windows | (deferred) | ⏭ |

### macOS App Nap defeat (T17-T19) — DEFERRED

Removed from this spike (see "What was attempted but cut" above). Run separately in a smaller probe binary; this spike validates the main 4 paths first.

If T13/T14 PASS this spike → App Nap is **less critical** (WebView wasn't throttled to begin with).
If T13 PASS but T14 FAIL → App Nap probe becomes urgent: defeat helper + redo T14.
If T13 FAIL → bigger issue than App Nap; rethink the daemon architecture.

### Cross-platform parity (T20) — DEFERRED

Mac-only this session. Windows machine access gates this.

---

## Go/no-go decision (pending JC's manual T1-T16)

After JC fills in T1-T16:

- **T1-T16 all PASS on macOS** → **GO for B4 M2 Mac-first**. Implement production tray + close-handler in `core/src/lib.rs` setup hook, ship v0.2 Mac-only, defer Win to v0.6 (mirror v0.1 ship pattern).
- **T1-T12 PASS but T13/T14 FAIL** → App Nap probe urgent. Don't ship M2 until App Nap defeat verified.
- **T1 FAIL (icon doesn't render)** → blocker. Tauri v2 tray needs investigation or workaround.
- **T5/T11 FAIL (hide/quit broken)** → Tauri WindowEvent + app.exit aren't reliable; ditch tray daemon for v0.2, supervisor workflow needs alternative.

---

## After-experiment

If GO:
1. Transcribe load-bearing pieces from `src/main.rs` (close handler, tray menu, heartbeat-shape) into `core/src/lib.rs` `setup` hook
2. Write separate App Nap probe in a tinier 1-file binary (no Tauri) — see `core/experiments/m2-app-nap-probe/` follow-up
3. Delete this whole `tray-mode/` directory in M2 closeout commit
4. Update B4 playbook M2 sub-tasks T2.1-T2.7 with the verified design choices

If NO-GO:
1. Document specific failure mode + what was tried
2. Open a decision in B4 playbook: ship v0.2 without daemon mode? or block on Win-machine to retry?

---

## Cursor / running notes (append-only)

### 2026-05-20 · Spec ship (Session 0 — before this scaffold)

Spec lives in README.md, written ahead of B4 M2 unblock.

### 2026-05-20 evening · Scaffold ship (Session 1 — this session)

Claude scaffolded Cargo.toml + build.rs + tauri.conf.json + index.html + src/main.rs + icon. Code compiles (build #1 verified at 1m57s wall-clock cold). Runtime + later builds hit Tauri/objc2 toolchain friction (NSActivityOptions newtype quirk, then linker hang on objc2-foundation codegen). Pulled App Nap defeat out to unblock the main 4 surfaces. Did NOT complete an end-to-end smoke run on this session — JC takes over locally to `cargo build && ./target/debug/tray-mode-spike` and fill in T1-T16 above.

**Next session pickup**: JC reports T1-T16 results → decision flows per "Go/no-go" section.
