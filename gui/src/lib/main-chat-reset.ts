import { invoke } from "@tauri-apps/api/core";

import { dropComposerDraft } from "@/lib/composer-draft";
import { resolveLanguagePreference } from "@/lib/language";
import { findMainChat, openMainChat } from "@/lib/main-chat";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import type { SessionBriefWire } from "@/stores/sessions/shared";
import { useSubtasksStore } from "@/stores/subtasks";
import { useUiStore } from "@/stores/ui";
import type { Session } from "@/types/session";

/**
 * Resetting the main chat from the page (main chat ticket 15, PRD ruling
 * 59). Core does the reset (`reset_main_chat`, Rule 5): it deletes the
 * main chat with its unpromoted subtasks, puts the engine's memory back
 * to the seed, deletes the pre-migration backups, broadcasts the
 * deletions and the new main chat, and hands the new one back. The page
 * then forgets the old sessions wherever it keeps them, takes the new
 * one, closes Settings and lands on it.
 */

export interface ResetFailure {
  /** `running`: a conversation runs (say so; try again after). */
  kind: "running" | "other";
  /** The error as Core sent it, for 复制详情. */
  detail: string;
}

/** Why `reset_main_chat` refused or failed, from its rejection
 * (`{"error": "running" | "not_managed" | "no_main_chat" | "failed",
 * "detail": …}`; anything else is `other`). */
export function resetFailure(error: unknown): ResetFailure {
  const detail =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  try {
    const parsed = JSON.parse(detail) as { error?: unknown } | null;
    if (parsed?.error === "running") return { kind: "running", detail };
  } catch {
    // Not Core's JSON.
  }
  return { kind: "other", detail };
}

/** What a reset deletes, as far as `sessions` knows: the main chat and
 * its subtasks the user never wrote in (archived ones too). */
export function resetSessionIds(sessions: readonly Session[]): string[] {
  const main = findMainChat(sessions);
  if (!main) return [];
  return [
    main.id,
    ...sessions
      .filter((s) => s.parentSessionId === main.id && !s.promoted)
      .map((s) => s.id),
  ];
}

/**
 * Reset the main chat and land on the new one. Rejects with Core's error
 * ({@link resetFailure} reads it) when Core refused or failed; the page
 * is left as it was then (Core's own broadcasts still apply).
 */
export async function resetMainChat(): Promise<void> {
  const doomed = resetSessionIds(useSessionsStore.getState().sessions);
  const brief = await invoke<SessionBriefWire>("reset_main_chat", {
    language: resolveLanguagePreference(
      usePrefsStore.getState().languagePreference,
    ),
  });
  forgetSessions(doomed.filter((id) => id !== brief.id));
  // Core announced it; the row may already be here (idempotent).
  useSessionsStore.getState().applyExternalSessionCreated(brief);
  useUiStore.getState().setSettingsOpen(false);
  await openMainChat();
}

/**
 * Forget deleted sessions everywhere the page keeps them: the list and
 * the active pointer, the conversation, the subtask cards' records and
 * run errors, an unsent draft. Core's `session-deleted-external` covers
 * the first two as well; every step is idempotent.
 */
function forgetSessions(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const sessions = useSessionsStore.getState();
  for (const id of ids) sessions.applyExternalSessionDeleted(id);
  useSubtasksStore.getState().forgetSessions(ids);
  for (const id of ids) dropComposerDraft(id);
}
