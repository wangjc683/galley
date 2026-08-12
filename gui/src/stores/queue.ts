import { create } from "zustand";

import {
  sessionQueueSnapshot,
  type QueuedMessage,
} from "@/lib/session-queue";

/**
 * Presenter mirror of Core's per-session outbound message queue
 * (galley#19/#20). Core is authoritative; this store only holds the
 * latest snapshot per session, fed by SESSION_QUEUE_CHANGED events
 * (useSessionQueueEvents) plus an on-demand fetch for session switch /
 * app start. No optimistic mutations — every action round-trips
 * through a Core command and comes back as a snapshot event.
 */
interface QueueState {
  bySession: Record<string, QueuedMessage[]>;
  applySnapshot: (sessionId: string, items: QueuedMessage[]) => void;
  /** Fetch the authoritative snapshot (session switch / mount). */
  loadFor: (sessionId: string) => Promise<void>;
}

export const useQueueStore = create<QueueState>()((set) => ({
  bySession: {},
  applySnapshot: (sessionId, items) =>
    set((s) => ({
      bySession: { ...s.bySession, [sessionId]: items },
    })),
  loadFor: async (sessionId) => {
    try {
      const items = await sessionQueueSnapshot(sessionId);
      set((s) => ({
        bySession: { ...s.bySession, [sessionId]: items },
      }));
    } catch (e) {
      // Non-Tauri runtime (Vite-only) or Core hiccup: leave the last
      // known snapshot in place; events will repair it.
      console.warn("[queue] snapshot load failed", e);
    }
  },
}));

/** Queue for one session (empty array when none). */
export function useSessionQueue(sessionId: string | null): QueuedMessage[] {
  return useQueueStore((s) =>
    sessionId ? (s.bySession[sessionId] ?? EMPTY) : EMPTY,
  );
}

const EMPTY: QueuedMessage[] = [];
