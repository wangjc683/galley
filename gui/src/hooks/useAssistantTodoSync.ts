import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { TODO_REFRESH_EVENTS } from "@/lib/assistant-todo";
import { nextTodoRefreshMs } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/** How long the list waits after a Core event before reading again: a
 * burst (a run's turns, a fire and its delivery) reads once. */
const REFRESH_DEBOUNCE_MS = 150;

/** A to-do falling due is read a second after its time, so Core's
 * clock has passed it too. */
const DUE_PAD_MS = 1000;

/** setTimeout's ceiling is ~24.8 days; a day is plenty, midnight reads
 * again anyway. */
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * Keep the assistant's to-do list (stores/assistant-todo.ts) current
 * while there is a main chat (main chat ticket 42): read it, then again
 * on the Core events that change it (`TODO_REFRESH_EVENTS`, debounced),
 * when the day turns (`useDayStamp`: today's group and 「今天 N」 are
 * this machine's days) and when a to-do with a time falls due (it turns
 * overdue then, and Core sends no event for the clock). Mounted once,
 * in App; `enabled` false (the external runtime, no main chat yet)
 * reads nothing.
 */
export function useAssistantTodoSync(enabled: boolean): void {
  const dayStamp = useDayStamp();
  const todo = useAssistantTodoStore((s) => s.todo);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisteners: (() => void)[] = [];
    const soon = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void useAssistantTodoStore.getState().load();
      }, REFRESH_DEBOUNCE_MS);
    };
    for (const event of TODO_REFRESH_EVENTS) {
      void listen(event, soon).then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    }
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      for (const fn of unlisteners) fn();
    };
  }, [enabled]);

  // The first read, and again when the day turns.
  useEffect(() => {
    if (!enabled) return;
    void useAssistantTodoStore.getState().load();
  }, [enabled, dayStamp]);

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const next = nextTodoRefreshMs(todo, now);
    if (next === null) return;
    const id = setTimeout(
      () => void useAssistantTodoStore.getState().load(),
      Math.min(next - now + DUE_PAD_MS, MAX_WAIT_MS),
    );
    return () => clearTimeout(id);
  }, [enabled, todo]);
}
