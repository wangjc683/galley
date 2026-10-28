import type { TodoItem } from "@/lib/assistant-todo";

/**
 * What the user sees of a scheduled task's words (main chat ticket 105,
 * PRD ruling 151): the first line. The assistant writes its own reminders
 * as a to-do is written, title and notes in one text: the first line is
 * the thing itself, for the user (「该喝水了」), and after a blank line
 * what it will want when the task comes due (what, why, what to do, the
 * names and numbers), which only it reads — Core hands it the whole text
 * then (core/src/subtask_report.rs `due_paragraph`). The manual says so
 * (docs/managed-ga-runtime/galley-assistant-manual/reminders.md).
 *
 * The first line that is not blank, trimmed; words with no line break
 * are the whole of them, so a reminder set before ticket 105 reads as it
 * did.
 */
export function reminderFirstLine(prompt: string): string {
  for (const line of prompt.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * A row's words in the to-do panel (lib/todo-panel.ts `todoRowText`) and
 * what 「说说这件」 quotes (lib/todo-open.ts `quoteTodo`): a task's first
 * line (`reminderFirstLine`), in 「Galley 在办」, 「例行」 and 「已完成」
 * alike; a to-do's title and a subtask's as they are.
 */
export function todoItemWords(item: TodoItem): string {
  return item.kind === "task" ? reminderFirstLine(item.text) : item.text;
}
