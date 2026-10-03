/**
 * Native `title` for an ellipsis-truncated line, but only while the text
 * is actually clipped. Call from `onPointerEnter`: the OS tooltip reads
 * the attribute when it decides to show, so setting / clearing it on
 * entry is enough, and measuring at hover time matches what the user
 * sees — a hovered sidebar row narrows its text (`group-hover:pr-7`
 * makes room for the actions button), so a title that fits at rest can
 * clip under the pointer. Fully visible text gets no attribute, so no
 * ~1s tooltip pops up merely repeating it.
 */
export function syncTruncatedTitle(el: HTMLElement, text: string): void {
  if (el.scrollWidth > el.clientWidth) el.title = text;
  else el.removeAttribute("title");
}
