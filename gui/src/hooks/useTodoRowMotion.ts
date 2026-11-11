import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { todoRowsChanged } from "@/lib/todo-row-motion";
import {
  noteTodoRowsBefore,
  playTodoRows,
  takeTodoRowsBefore,
} from "@/lib/todo-row-motion-play";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/**
 * The to-do panel's rows leaving and closing up (main chat PRD ruling 208
 * point 3, ticket 161; the rules in lib/todo-row-motion.ts, the page side
 * in lib/todo-row-motion-play.ts). `list` is the panel's scrolling list;
 * `order` the list the 待办 page draws now (`todoRowOrder`), null on the
 * 备忘 page and before the first read.
 *
 * The page is read where it is seen inside every store write that
 * changes the list or what waits off it — a fresh list from Core, a
 * delete or a skip staged, undone or let go — before React draws it; the
 * one other change of the rows, the flash letting a to-do Galley ticked
 * off go to 已完成, reads it in its own timer (hooks/useTodoPanelFlash.ts).
 * Every commit takes that read; it plays only when the order drawn
 * changed from one the panel showed (`todoRowsChanged`): a write that
 * changes no order, a row opened or folded, 已完成 unfolded (the groups'
 * own state, no commit here), the first read, turning to 备忘 and back
 * (the order is null there) — none plays.
 */
export function useTodoRowMotion(
  list: RefObject<HTMLElement | null>,
  order: string | null,
): void {
  useEffect(
    () =>
      useAssistantTodoStore.subscribe((state, previous) => {
        if (
          state.todo === previous.todo &&
          state.deleting === previous.deleting
        ) {
          return;
        }
        noteTodoRowsBefore(list.current);
      }),
    [list],
  );

  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scroller = list.current;
    const before = scroller ? takeTodoRowsBefore(scroller) : null;
    const previous = shown.current;
    shown.current = order;
    if (scroller && before && todoRowsChanged(previous, order)) {
      playTodoRows(scroller, before);
    }
  });
}
