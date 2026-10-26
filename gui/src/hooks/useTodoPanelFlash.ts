import { useEffect, useRef, useState, type RefObject } from "react";

import { LOCATE_FLASH_CLASS, LOCATE_FLASH_MS } from "@/lib/locate-flash";
import {
  TODO_SETTLE_MS,
  todoPanelChanges,
  todoWritesOnTheirWay,
  type TodoHold,
} from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore, type TodoRowRequest } from "@/stores/ui";

/** Room kept around a row scrolled into view: the wash's 6px glow. */
const REVEAL_MARGIN_PX = 8;

/**
 * Rows lighting up in the to-do panel (main chat ticket 87, PRD ruling
 * 131 points 3–5), with the located-message wash (lib/locate-flash.ts):
 *
 * - **What Galley moved**, while the panel is on screen: every fresh list
 *   is compared with the one the panel showed (`todoPanelChanges`; the
 *   list it mounts with is the starting point and lights nothing, and a
 *   panel closed does nothing — nothing is made up for on opening). A
 *   to-do Galley ticked off holds where it stood for `TODO_SETTLE_MS`
 *   first (`held`), as one of yours does. This window's own writes on
 *   their way are never lit.
 * - **A request** (`todoRowRequest`): a card's title, or the panel's one
 *   opening by itself. 已完成 unfolds for a row only there (TodoPanel
 *   passes the request on), then the rows light up and it is cleared. A
 *   memo card's words ask for a row of the 备忘 page the same way (ticket
 *   97, `data-memo-row`); what Galley moves among the memos lights
 *   nothing.
 *
 * Several rows light together; the first in the panel's order is
 * scrolled into view when it is out of it. `list` is the panel's
 * scrolling list. The comparison is a store callback, not render; the
 * DOM is touched a frame after the rows are drawn.
 */
export function useTodoPanelFlash(list: RefObject<HTMLElement | null>): {
  held: readonly TodoHold[];
  request: TodoRowRequest | null;
} {
  const [held, setHeld] = useState<readonly TodoHold[]>([]);
  const [lit, setLit] = useState<{ ids: string[]; nonce: number } | null>(null);
  const request = useUiStore((s) => s.todoRowRequest);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    let nonce = 0;
    const unsubscribe = useAssistantTodoStore.subscribe((state, previous) => {
      if (state.todo === previous.todo || !previous.loaded) return;
      const change = todoPanelChanges(
        previous.todo,
        state.todo,
        todoWritesOnTheirWay(previous, state),
      );
      if (change.held.length > 0) {
        const ids = new Set(change.held.map((hold) => hold.item.id));
        setHeld((current) => [
          ...current.filter((hold) => !ids.has(hold.item.id)),
          ...change.held,
        ]);
        const timer = setTimeout(() => {
          pending.delete(timer);
          setHeld((current) =>
            current.filter((hold) => !change.held.includes(hold)),
          );
        }, TODO_SETTLE_MS);
        pending.add(timer);
      }
      if (change.flash.length > 0) {
        nonce += 1;
        setLit({ ids: change.flash, nonce });
      }
    });
    return () => {
      unsubscribe();
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (!lit) return;
    const frame = requestAnimationFrame(() =>
      flashRows(list.current, lit.ids, timers.current),
    );
    return () => cancelAnimationFrame(frame);
  }, [lit, list]);

  useEffect(() => {
    if (!request) return;
    const frame = requestAnimationFrame(() => {
      flashRows(list.current, request.ids, timers.current);
      useUiStore.getState().clearTodoRowRequest(request.nonce);
    });
    return () => cancelAnimationFrame(frame);
  }, [request, list]);

  return { held, request };
}

/** Light up the rows of `ids` drawn in `list` — the 待办 page's, or the
 * 备忘 page's — the first in the panel's order scrolled into view when it
 * is out of it. */
function flashRows(
  list: HTMLElement | null,
  ids: readonly string[],
  timers: Set<ReturnType<typeof setTimeout>>,
): void {
  if (!list) return;
  const wanted = new Set(ids);
  const rows = Array.from(
    list.querySelectorAll<HTMLElement>("[data-todo-row], [data-memo-row]"),
  ).filter((row) =>
    wanted.has(row.dataset.todoRow ?? row.dataset.memoRow ?? ""),
  );
  if (rows.length === 0) return;
  reveal(list, rows[0]);
  for (const row of rows) {
    // Again on a row still washing: start it over.
    row.classList.remove(LOCATE_FLASH_CLASS);
    void row.offsetWidth;
    row.classList.add(LOCATE_FLASH_CLASS);
    const timer = setTimeout(() => {
      timers.delete(timer);
      row.classList.remove(LOCATE_FLASH_CLASS);
    }, LOCATE_FLASH_MS);
    timers.add(timer);
  }
}

/** Scroll `list` just enough to show `row`, only when it is out of
 * view. */
function reveal(list: HTMLElement, row: HTMLElement): void {
  const view = list.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  if (box.top < view.top) {
    list.scrollTop -= view.top - box.top + REVEAL_MARGIN_PX;
  } else if (box.bottom > view.bottom) {
    list.scrollTop += Math.min(
      box.bottom - view.bottom + REVEAL_MARGIN_PX,
      box.top - view.top - REVEAL_MARGIN_PX,
    );
  }
}
