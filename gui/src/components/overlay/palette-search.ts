/**
 * Whether ⌘K's query (already trimmed and lower-cased) finds a session:
 * a case-insensitive substring of its title, its recap, or the extra
 * words it is found by but never shown with (`keywords`: the main chat
 * is titled 「Galley」, the assistant's name, and stays findable as
 * 主对话 / 助手 / main chat / assistant — lib/assistant.ts). cmdk
 * filters the same text (`paletteSessionValue`), so it never hides a
 * session this picked.
 */
export function paletteSessionMatches(
  query: string,
  title: string,
  preview: string,
  keywords = "",
): boolean {
  return (
    title.toLowerCase().includes(query) ||
    preview.toLowerCase().includes(query) ||
    keywords.toLowerCase().includes(query)
  );
}

/** A session item's cmdk value. */
export function paletteSessionValue(
  title: string,
  preview: string | undefined,
  keywords = "",
): string {
  return keywords
    ? `session ${title} ${keywords} ${preview ?? ""}`
    : `session ${title} ${preview ?? ""}`;
}
