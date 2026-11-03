import { useMemo } from "react";

import { sidebarSubtasks, type SidebarSubtasks } from "@/lib/sidebar-subtasks";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import type { Session } from "@/types/session";

/**
 * The subtasks the sidebar lists under Galley's card (main chat ticket
 * 128, PRD ruling 176; lib/sidebar-subtasks.ts): the to-do panel's
 * 「Galley 在办」 read, which `useAssistantTodoSync` keeps current while
 * there is a main chat, matched to `subtasks`, the main chat's
 * unpromoted subtask sessions.
 */
export function useSidebarSubtasks(
  subtasks: readonly Session[],
): SidebarSubtasks {
  const items = useAssistantTodoStore((s) => s.todo.assistant);
  return useMemo(() => sidebarSubtasks(items, subtasks), [items, subtasks]);
}
