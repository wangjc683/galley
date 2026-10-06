import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Open a web URL in the user's default browser through the opener
 * plugin, the one mechanism external links in Settings share: Buttons
 * call `openUrl` directly, inline anchors call this from `onClick`.
 *
 * Fire-and-forget: a failure is logged, not surfaced, matching the
 * plain anchors this replaced. Callers that own an error slot (Browser
 * Control guide, Agent API docs) await `openUrl` themselves.
 */
export function openExternalUrl(url: string): void {
  void openUrl(url).catch((error: unknown) => {
    console.warn("[open-external] open failed.", url, error);
  });
}
