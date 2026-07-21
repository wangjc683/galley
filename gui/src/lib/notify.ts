/**
 * System notifications — the "user isn't looking" channel.
 *
 * Galley hides to the background on window close, and long-running
 * goals / approval waits routinely outlive the user's attention. The
 * in-app toast covers the focused window; this module covers the rest
 * via `tauri-plugin-notification`, gated so it never duplicates the
 * toast and never surprises the user:
 *
 *   pref (sync) → throttle (sync) → window focused? → permission → send
 *
 * Checks are ordered by cost. The throttle is recorded *before* the
 * async checks so a burst of events (GA parallel tool calls each
 * emitting `tool_call_pending`) can't all slip through during the
 * await gaps.
 *
 * Everything is best-effort and never throws: in Vite-only browser
 * dev the Tauri window / plugin APIs reject or throw synchronously,
 * which the outer catch turns into a silent skip.
 *
 * Permission policy: never prompt at startup. The OS prompt appears
 * lazily the first time a notification is actually about to be sent,
 * or when the user flips a notification toggle ON in Settings →
 * General (`ensureNotificationPermission`). On macOS a previously
 * denied app gets an immediate `denied` back without re-prompting, so
 * lazy requests are safe to repeat.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { usePrefsStore } from "@/stores/prefs";

export type SystemNotifyKind = "goalEnd" | "approval" | "replyDone";

/**
 * Reply-done gating: sessions with a GUI-submitted run awaiting its
 * final turn. Set on Composer submit, consumed at the final `turn_end`
 * — so Goal-nudge and CLI/Supervisor-driven runs (which never pass
 * through the GUI submit path) stay silent. Module-level because it
 * never renders: ipc-handlers and useMessageSend are the only readers.
 * Best-effort by design — a GUI restart mid-run drops the flag and
 * skips one notification, same failure mode as the rest of this file.
 */
const replyNotifyPending = new Set<string>();

export function markReplyNotifyPending(sessionId: string): void {
  replyNotifyPending.add(sessionId);
}

/** Returns whether the session had a pending flag, clearing it. */
export function consumeReplyNotifyPending(sessionId: string): boolean {
  return replyNotifyPending.delete(sessionId);
}

/** Drop the flag without notifying (run errored / bridge closed). */
export function clearReplyNotifyPending(sessionId: string): void {
  replyNotifyPending.delete(sessionId);
}

const THROTTLE_WINDOW_MS = 5000;

/** last-sent timestamps per throttleKey. Bounded by active session
 * count in practice — no expiry needed. */
const lastSentAt = new Map<string, number>();

/** Pure throttle predicate, exported for tests. */
export function shouldThrottle(
  lastSent: number | undefined,
  now: number,
  windowMs: number = THROTTLE_WINDOW_MS,
): boolean {
  return lastSent !== undefined && now - lastSent < windowMs;
}

/** Permission check without ever prompting — Settings uses this on
 * mount to pre-fill the "permission missing" hint. */
export async function queryNotificationPermission(): Promise<boolean> {
  try {
    return await isPermissionGranted();
  } catch {
    return false;
  }
}

/** In-flight request cache so concurrent callers (a toggle flip racing
 * a lazy first send) share one OS prompt instead of stacking two. */
let permissionRequest: Promise<boolean> | null = null;

/** Check permission and prompt if never asked. Returns whether
 * notifications are allowed. Never throws. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    if (!permissionRequest) {
      permissionRequest = requestPermission()
        .then((result) => result === "granted")
        .finally(() => {
          permissionRequest = null;
        });
    }
    return await permissionRequest;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget gated system notification. `throttleKey` collapses
 * bursts sharing the key into one notification per 5s window; omit it
 * for events that are naturally sparse (goal terminal states).
 */
export async function sendGatedSystemNotification(
  kind: SystemNotifyKind,
  {
    title,
    body,
    throttleKey,
  }: { title: string; body: string; throttleKey?: string },
): Promise<void> {
  try {
    const prefs = usePrefsStore.getState();
    const enabled =
      kind === "goalEnd"
        ? prefs.notifyOnGoalEnd
        : kind === "approval"
          ? prefs.notifyOnApproval
          : prefs.notifyOnReplyDone;
    if (!enabled) {
      console.debug("[notify] skipped: pref off.", { kind });
      return;
    }
    if (throttleKey) {
      const now = Date.now();
      if (shouldThrottle(lastSentAt.get(throttleKey), now)) {
        console.debug("[notify] skipped: throttled.", { kind, throttleKey });
        return;
      }
      lastSentAt.set(throttleKey, now);
    }
    // Focused window → the in-app toast already covers it. A hidden
    // window reports unfocused, which is exactly the case to notify.
    if (await getCurrentWindow().isFocused()) {
      console.debug("[notify] skipped: window focused.", { kind });
      return;
    }
    if (!(await ensureNotificationPermission())) {
      console.debug("[notify] skipped: permission not granted.", { kind });
      return;
    }
    // Note for dev builds: on macOS, `tauri dev` runs outside an .app
    // bundle, so the OS routes this through the terminal app that
    // launched dev — it only shows if THAT app (iTerm / Terminal /
    // VS Code) has notification permission. Bundled builds notify as
    // Galley normally. https://github.com/tauri-apps/tauri/issues/4965
    console.debug("[notify] sending.", { kind, title });
    sendNotification({ title, body });
  } catch (e) {
    console.debug("[notify] system notification skipped.", e);
  }
}
