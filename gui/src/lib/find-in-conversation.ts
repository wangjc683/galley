import { openConversationScope } from "@/lib/palette-scope";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

/**
 * ⌘F and the title menu's 查找聊天记录 (main chat ticket 28): the palette
 * inside the conversation open in the main area, or ⌘K's toggle when
 * none is. Reads the stores when called, so the key listener never
 * re-binds on a session switch.
 */
export function findInOpenConversation(): void {
  const { screen, settingsOpen, findInConversation } = useUiStore.getState();
  const { activeSessionId, sessions } = useSessionsStore.getState();
  findInConversation(
    openConversationScope({ screen, settingsOpen, activeSessionId, sessions }),
  );
}
