import { useMemo } from "react";

import type { TodoItem } from "@/lib/assistant-todo";
import { todosByMessage } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/**
 * The to-dos Galley noted in the main chat's replies, by the reply they
 * hang under (main chat ticket 42), from the one to-do list App keeps
 * current (`useAssistantTodoSync`). `mainChatId` undefined (not the
 * main chat) → an empty map.
 */
export function useTodosByMessage(
  mainChatId: string | undefined,
): Map<string, TodoItem[]> {
  const todo = useAssistantTodoStore((s) => s.todo);
  return useMemo(() => todosByMessage(todo, mainChatId), [todo, mainChatId]);
}
