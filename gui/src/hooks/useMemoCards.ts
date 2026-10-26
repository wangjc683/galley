import { useMemo } from "react";

import { memosByMessage, type MemoEventItem } from "@/lib/memo";
import { useMemoStore } from "@/stores/memo";

/**
 * The writes of memos in the main chat's replies, by the reply they hang
 * under (main chat ticket 97): a card each, read with the memos App
 * keeps current (`useMemoSync`). `mainChatId` undefined (not the main
 * chat) → an empty map.
 */
export function useMemosByMessage(
  mainChatId: string | undefined,
): Map<string, MemoEventItem[]> {
  const events = useMemoStore((s) => s.events);
  return useMemo(
    () => memosByMessage(events, mainChatId),
    [events, mainChatId],
  );
}
