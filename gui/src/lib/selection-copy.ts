/**
 * Where a text selection gets the floating copy (SelectionCopyToolbar):
 * an assistant answer (`assistant-answer`, MessageAgent), and in the
 * assistant's conversation the user's own bubble too (`user-message`,
 * MessageUser with `align="end"`), which has no hover copy there (main
 * chat PRD ruling 73): its plain text is exactly what a selection
 * copies. A selection gets the toolbar only when it starts and ends
 * inside one such scope.
 */
export const SELECTION_COPY_SCOPE =
  '[data-selection-copy-scope="assistant-answer"], [data-selection-copy-scope="user-message"]';
