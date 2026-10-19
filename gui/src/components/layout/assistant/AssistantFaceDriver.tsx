import { useAssistantFaceDriver } from "@/hooks/useAssistantFaceDriver";
import type { Session } from "@/types/session";

/**
 * The assistant's face's one driver (main chat PRD rulings 117–119,
 * tickets 65–67). App mounts it once, in the managed runtime with a main
 * chat: it follows what the assistant is doing and feeds the face on
 * the sidebar's card (stores/assistant-face.ts), the one face that moves
 * (the header's 28px avatar stays still, ruling 119 point 6).
 */
export function AssistantFaceDriver({
  mainChat,
  subtasks,
  open,
}: {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
  /** The main chat itself is the open conversation. */
  open: boolean;
}) {
  useAssistantFaceDriver({ mainChat, subtasks, open });
  return null;
}
