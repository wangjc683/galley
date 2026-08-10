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

export type SystemNotifyKind =
  | "goalEnd"
  | "approval"
  | "replyDone"
  | "askUser"
  | "scheduleFailed";

/**
 * Audible register of a notification, so an away user can tell from
 * sound alone whether to come back now ("the agent is blocked on
 * you") or at leisure ("it finished"). Three tones, not five kinds:
 * users distinguish outcomes, not event sources.
 */
export type NotifyTone = "done" | "needsYou" | "alert";

const KIND_TONE: Record<SystemNotifyKind, NotifyTone> = {
  goalEnd: "done",
  replyDone: "done",
  approval: "needsYou",
  askUser: "needsYou",
  scheduleFailed: "alert",
};

/**
 * Per-platform sound names, resolved in the JS layer because the
 * plugin passes the string through verbatim and each OS has its own
 * namespace:
 *
 *   - Windows: `tauri-winrt-notification` `Sound::from_str` names
 *     (ms-winsoundevent set). An unknown name parses to None → the
 *     toast renders `<audio silent="true"/>`, i.e. today's bug.
 *   - macOS: system sound names from /System/Library/Sounds, passed
 *     to UNNotificationSound. Unknown names fall back to silent.
 *   - Linux: freedesktop sound-naming-spec names via the notify-rust
 *     `sound-name` hint; best-effort, theme-dependent.
 *
 * Wrong-platform names never throw — they degrade to the silent
 * status quo — so UA sniffing is safe as the detection mechanism
 * (no plugin-os dependency for three string picks).
 */
const TONE_SOUNDS: Record<string, Record<NotifyTone, string>> = {
  windows: { done: "Default", needsYou: "IM", alert: "Reminder" },
  macos: { done: "Glass", needsYou: "Ping", alert: "Basso" },
  linux: {
    done: "complete",
    needsYou: "message-new-instant",
    alert: "dialog-warning",
  },
};

/** Pure resolver, exported for tests. Unknown platform → undefined
 * (send without sound — the pre-sound behavior). */
export function resolveNotifySound(
  tone: NotifyTone,
  userAgent: string,
): string | undefined {
  const platform = /windows/i.test(userAgent)
    ? "windows"
    : /mac|darwin/i.test(userAgent)
      ? "macos"
      : /linux/i.test(userAgent)
        ? "linux"
        : null;
  return platform ? TONE_SOUNDS[platform][tone] : undefined;
}

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
    tone,
  }: {
    title: string;
    body: string;
    throttleKey?: string;
    /** Override the kind's default tone — e.g. a failed goal is a
     * `goalEnd` event but should sound like an alert, not a "done". */
    tone?: NotifyTone;
  },
): Promise<void> {
  try {
    const prefs = usePrefsStore.getState();
    // scheduleFailed has no pref on purpose: a failed scheduled fire is
    // an error condition, not routine chatter — rare, and always "needs
    // your action". The focus / permission gates below still apply.
    // askUser shares the replyDone pref: both are run-terminus "the
    // agent stopped, look at the session" signals, differing only in
    // register (finished vs asking) — a separate toggle would be
    // Settings noise for a distinction users don't configure apart.
    const enabled =
      kind === "goalEnd"
        ? prefs.notifyOnGoalEnd
        : kind === "approval"
          ? prefs.notifyOnApproval
          : kind === "replyDone" || kind === "askUser"
            ? prefs.notifyOnReplyDone
            : true;
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
    // Sound is attached per-send rather than configured OS-side: both
    // Windows toasts and macOS banners are silent when no sound is
    // given, which doubles as the mute path for the pref.
    const sound = prefs.notifySound
      ? resolveNotifySound(
          tone ?? KIND_TONE[kind],
          // navigator is absent under the node test environment.
          typeof navigator === "undefined" ? "" : navigator.userAgent,
        )
      : undefined;
    sendNotification(sound ? { title, body, sound } : { title, body });
  } catch (e) {
    console.debug("[notify] system notification skipped.", e);
  }
}
