import { create } from "zustand";

import { claimChatGptPlanNotice } from "@/lib/chatgpt-plan";
import { createRevocationCheck } from "@/lib/chatgpt-plan-errors";
import {
  getChatGptPlanStatus,
  testManagedModelConnection,
  type ChatGptPlanStatus,
} from "@/lib/managed-models";
import { useManagedModelsStore } from "@/stores/managed-models";

/**
 * Sign in with ChatGPT state the GUI reads in more than one place
 * (.scratch/chatgpt-siwc ticket 04): each ChatGPT provider's plan status
 * (`get_chatgpt_plan_status`: which flow the credential came from,
 * signed in, needs a new sign-in) for the provider card and the composer's
 * plan label, and whether the first sign-in notice is up. The status is
 * Core's; this is a cache, read again after every sign-in and sign-out.
 */
export interface ChatGptPlanStore {
  statusByProvider: Record<string, ChatGptPlanStatus>;
  noticeOpen: boolean;
  /** Reads the provider's status again; the newest read wins. */
  refreshStatus: (providerId: string) => Promise<ChatGptPlanStatus | null>;
  /** Reads it once, when nothing has been read or asked for yet. */
  ensureStatus: (providerId: string) => void;
  /** After a successful sign-in: shows the notice if this machine has
   * never shown it (see `claimChatGptPlanNotice`). */
  requestNotice: () => void;
  closeNotice: () => void;
}

// Per provider, the id of the newest read: an older answer landing late
// must not overwrite a newer one (a read started before a sign-in, say).
const latestRead = new Map<string, number>();
let readSeq = 0;

export const useChatGptPlanStore = create<ChatGptPlanStore>((set, get) => ({
  statusByProvider: {},
  noticeOpen: false,
  refreshStatus: async (providerId) => {
    readSeq += 1;
    const id = readSeq;
    latestRead.set(providerId, id);
    try {
      const status = await getChatGptPlanStatus(providerId);
      if (latestRead.get(providerId) === id) {
        set((state) => ({
          statusByProvider: { ...state.statusByProvider, [providerId]: status },
        }));
      }
      return status;
    } catch (error) {
      console.warn("[chatgpt-plan] status read failed.", error);
      if (latestRead.get(providerId) === id) latestRead.delete(providerId);
      return null;
    }
  },
  ensureStatus: (providerId) => {
    if (
      get().statusByProvider[providerId] !== undefined ||
      latestRead.has(providerId)
    ) {
      return;
    }
    void get().refreshStatus(providerId);
  },
  requestNotice: () => {
    if (claimChatGptPlanNotice()) set({ noticeOpen: true });
  },
  closeNotice: () => set({ noticeOpen: false }),
}));

/** A conversation showed `token_revoked` (ticket 04, PRD ruling 8): one
 * connection test per error so Core notices now, then the store and the
 * plan status are read again. Called with the turn's message id. */
export const checkChatGptRevocation = createRevocationCheck({
  getModels: () => {
    const { providers, models } = useManagedModelsStore.getState();
    return { providers, models };
  },
  test: testManagedModelConnection,
  reload: () => useManagedModelsStore.getState().load(),
  refreshStatus: (providerId) =>
    useChatGptPlanStore.getState().refreshStatus(providerId),
});
