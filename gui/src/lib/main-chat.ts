import { invoke } from "@tauri-apps/api/core";

import { resolveLanguagePreference } from "@/lib/language";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import type { SessionBriefWire } from "@/stores/sessions/shared";
import { useUiStore } from "@/stores/ui";
import type { Session } from "@/types/session";

/**
 * The main chat (主聊天, `.scratch/main-chat` ticket 02): one permanent
 * conversation on the managed runtime that the desktop opens on; every
 * other session is a side chat (旁聊). Core owns it (Rule 5) — it
 * creates the row on the first ask (`get_or_create_main_chat`), with
 * the AI's greeting in the UI language the ask names (ticket 04c), and
 * refuses the desktop's archive / delete of it. The attached external
 * GA has none, so nothing here runs in that mode (PRD ruling 3).
 */

/** The main chat among `sessions`, if this page knows it. */
export function findMainChat(
  sessions: readonly Session[],
): Session | undefined {
  return sessions.find((session) => session.mainChat);
}

let opening: Promise<boolean> | null = null;

/**
 * Land on the main chat: ask Core for it, put its row in the list,
 * make it the active session and show it. The managed runtime's home —
 * at launch, after a switch to the managed runtime, after its
 * onboarding. Only the in-memory half of opening it: the first send
 * starts the runner, as the empty composer's first message does, so a
 * launch spawns no engine process.
 *
 * Resolves `false` when there is no main chat to land on (the external
 * runtime is active, or Core failed — logged); the caller then lands on
 * the empty composer as before. Concurrent calls share one landing, and
 * a call while the main chat is already on screen changes nothing.
 */
export function openMainChat(): Promise<boolean> {
  opening ??= landOnMainChat().finally(() => {
    opening = null;
  });
  return opening;
}

async function landOnMainChat(): Promise<boolean> {
  const prefs = usePrefsStore.getState();
  if (prefs.activeRuntimeKind !== "managed") return false;
  let brief: SessionBriefWire | undefined;
  try {
    // The UI language picks the greeting a new main chat opens with
    // (ticket 04c); Core falls back to English without it.
    brief = await invoke<SessionBriefWire>("get_or_create_main_chat", {
      language: resolveLanguagePreference(prefs.languagePreference),
    });
  } catch (e) {
    console.warn("[main-chat] get_or_create_main_chat failed.", e);
    return false;
  }
  if (!brief?.id) return false;
  const sessions = useSessionsStore.getState();
  // Core broadcasts a creation (and a restore from the archive); the
  // row may land here first. Both mirrors are idempotent.
  sessions.applyExternalSessionCreated(brief);
  sessions.applyExternalSessionUpdated(brief);
  const ui = useUiStore.getState();
  if (
    ui.screen === "main" &&
    useSessionsStore.getState().activeSessionId === brief.id
  ) {
    return true;
  }
  sessions.setActiveProjectFilter(undefined);
  void sessions.activateSession(brief.id, { ensureRunner: false });
  ui.setScreen("main");
  return true;
}
