import { useEffect } from "react";

import { moveTodoGlance } from "@/lib/todo-open";

/**
 * A look at the to-do panel follows the main area (main chat ticket 87,
 * PRD ruling 131 point 2): it arrives where a jump out of the panel sent
 * it, and folds once you leave the conversation it is open in — another
 * session, the other screen. `at` is the conversation on screen
 * (`todoConversationKey`). Mounted once, in App.
 */
export function useTodoGlanceFollow(at: string): void {
  useEffect(() => moveTodoGlance(at), [at]);
}
