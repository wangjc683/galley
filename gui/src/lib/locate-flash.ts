/**
 * The located-message wash (`.message-locate-flash` in globals.css): a
 * brand wash that decays, once, to say "here". The 查找聊天记录 jump puts
 * it on the message it lands on (useStickyScroll, ticket 28), and the
 * to-do panel on a row Galley moved or a card's title points at (main
 * chat ticket 87, PRD ruling 131 points 3–5, useTodoPanelFlash). The
 * class carries its own reduced-motion rule (no animation).
 */
export const LOCATE_FLASH_CLASS = "message-locate-flash";

/** How long the wash lasts (matches the CSS keyframes in globals.css —
 * change both together or neither). */
export const LOCATE_FLASH_MS = 1400;
