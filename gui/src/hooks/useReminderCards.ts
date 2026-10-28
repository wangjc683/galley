import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";

import { remindersByMessage } from "@/lib/assistant-todo";
import {
  listScheduledTasks,
  SCHEDULED_TASKS_CHANGED_EVENT,
  type ScheduledTask,
} from "@/lib/scheduled-tasks";

/**
 * The list as last read, kept across mounts: MainView mounts afresh on
 * every switch to the main chat (App keys it by session), and a mount
 * that started from nothing re-rendered the whole conversation when the
 * read came back, cards or no cards (ticket 72). With it, a mount draws
 * the cards it had from its first render, and a read that brings the
 * same list sets nothing.
 */
let lastRead: { tasks: ScheduledTask[]; json: string } = {
  tasks: [],
  json: "[]",
};

/** Hears each read as it lands: the tasks before it, null for a mount's
 * first (it says only what is there), and after. */
export type ReminderReadListener = (
  previous: readonly ScheduledTask[] | null,
  next: readonly ScheduledTask[],
) => void;

const readListeners = new Set<ReminderReadListener>();

/**
 * Hear the reads the main chat's reminder cards come from (main chat
 * ticket 101, PRD ruling 147 point 4): the to-do panel's one opening by
 * itself counts Galley's own reminders too (hooks/useFreshCards.ts).
 * They are read only while the main chat is mounted, a mount's first
 * read standing for what was already there — what was made while you
 * were elsewhere is not news on coming back. Returns the unsubscribe.
 */
export function subscribeReminderReads(
  listener: ReminderReadListener,
): () => void {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

/**
 * The reminders the assistant set in the main chat's replies, by the
 * reply they hang under (main chat ticket 37). Reads every task,
 * cancelled ones too (their card says 已取消), and again on Core's
 * `scheduled-tasks:changed` — a cancel, a fire, the run that made one
 * settling its reply. `mainChatId` undefined (not the main chat) → an
 * empty map, nothing read.
 */
export function useRemindersByMessage(
  mainChatId: string | undefined,
): Map<string, ScheduledTask[]> {
  const [tasks, setTasks] = useState<ScheduledTask[]>(() => lastRead.tasks);
  useEffect(() => {
    if (!mainChatId) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    // This mount's first read lands as a starting point (ticket 101).
    let first = true;
    const load = () => {
      listScheduledTasks(true)
        .then((all) => {
          const json = JSON.stringify(all);
          const previous = first ? null : lastRead.tasks;
          if (json !== lastRead.json) lastRead = { tasks: all, json };
          if (cancelled) return;
          first = false;
          setTasks(lastRead.tasks);
          for (const listener of readListeners) {
            listener(previous, lastRead.tasks);
          }
        })
        .catch((e) => console.warn("[reminders] list failed.", e));
    };
    load();
    void listen(SCHEDULED_TASKS_CHANGED_EVENT, load).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [mainChatId]);
  return useMemo(
    () => remindersByMessage(tasks, mainChatId),
    [tasks, mainChatId],
  );
}
