/**
 * Platform detection for OS-conditional UI:
 *
 *   - Window chrome (Win: custom controls, Mac: traffic-light overlay)
 *   - Keyboard shortcut display labels (⌘K vs Ctrl+K)
 *   - Tutorial / onboarding command examples (zsh vs PowerShell)
 *
 * We read `navigator.userAgent` rather than pulling in
 * `@tauri-apps/plugin-os` because the latter requires a Rust crate,
 * permission entry, and async init — too much ceremony for "is this
 * macOS?". The webview UA is set by the host OS, so the tokens
 * `Macintosh` / `Windows` are authoritative for what the user is
 * running. Detection happens at module load and is constant for the
 * lifetime of the app — there's no scenario where this changes after
 * boot.
 *
 * Behavioural rule: every conditional that reads these flags MUST
 * leave the Mac path byte-identical to current behaviour. Mac is the
 * v0.1 release platform; Windows support is purely additive prep work.
 */
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMac = ua.includes("Macintosh");
export const isWindows = ua.includes("Windows");

export type PlatformName = "mac" | "windows" | "linux";

/**
 * "linux" doubles as the safe fallthrough when UA sniffing matches
 * neither token: no platform-scoped CSS targets it, so an unknown
 * webview simply keeps native scrollbars and chrome.
 */
export const platformName: PlatformName = isMac
  ? "mac"
  : isWindows
    ? "windows"
    : "linux";

/**
 * Expose the platform to CSS as `html[data-platform="…"]` (same
 * mechanism as theme.ts's `root.dataset.theme`). Exists for
 * platform-scoped styling — currently the Windows scrollbar rules in
 * globals.css. Mac must stay byte-identical: no stylesheet rule may
 * match `data-platform="mac"` (see the behavioural rule above).
 */
export function applyPlatformAttribute(): void {
  document.documentElement.dataset.platform = platformName;
}

/**
 * OS-appropriate example path for the GenericAgent install dir.
 * Used as StepAttach / Settings input placeholder, and tutorial
 * markdown ("解压到例如 ..."). Mac value
 * uses tilde shorthand (familiar to macOS / Linux users); Win value
 * is a real Windows path with `YourName` standing in for the user's
 * profile folder.
 */
export const EXAMPLE_GA_PATH = isMac
  ? "~/Documents/GenericAgent"
  : "C:\\Users\\YourName\\Documents\\GenericAgent";

/**
 * True when the given event target should trigger a window-chrome
 * action (e.g. double-click → toggleMaximize). Walks up the DOM:
 *
 *   - returns false if any ancestor is an interactive control
 *     (button / link / input / textarea / select)
 *   - returns false if any ancestor opts out via
 *     data-tauri-drag-region="false"
 *   - returns true only when the path includes at least one element
 *     marked `data-tauri-drag-region` (no value, attribute-only or
 *     attribute="true") — i.e. an area Tauri would already grab for
 *     window dragging
 *
 * Used by Windows custom chrome to decide whether a double-click on
 * TopBar should maximize the window. Mac's "Overlay" titleBarStyle
 * makes the OS handle this natively, so callers always gate with
 * `!isMac` before invoking this helper.
 */
export function isWindowActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  let el: HTMLElement | null = target;
  let sawDragRegion = false;
  while (el) {
    const drag = el.getAttribute("data-tauri-drag-region");
    if (drag === "false") return false;
    if (drag !== null) sawDragRegion = true;
    const tag = el.tagName;
    if (
      tag === "BUTTON" ||
      tag === "A" ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    ) {
      return false;
    }
    el = el.parentElement;
  }
  return sawDragRegion;
}
