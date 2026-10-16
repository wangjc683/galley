import { useMemo } from "react";

import type { TodoItem } from "@/lib/assistant-todo";
import { todosByMessage } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/**
 * The to-dos Galley noted in the main chat's replies, by the reply they
 * hang under (main chat ticket 42), from every to-do noted in the main
 * chat (ticket 43: done however long ago and cancelled ones too), read
 * with the list App keeps current (`useAssistantTodoSync`). `mainChatId`
 * undefined (not the main chat) → an empty map.
 */
export function useTodosByMessage(
  mainChatId: string | undefined,
): Map<string, TodoItem[]> {
  const noted = useAssistantTodoStore((s) => s.noted);
  return useMemo(() => todosByMessage(noted, mainChatId), [noted, mainChatId]);
}
