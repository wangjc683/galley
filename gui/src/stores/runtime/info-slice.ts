import { DEFAULT_RUNTIME_INFO } from "@/stores/defaults";
import type { RuntimeInfo } from "@/types/inspector";

import type { RuntimeSliceCreator } from "./shared";

export interface InfoSlice {
  /**
   * Which session currently holds the desktop pet subprocess. Global
   * because the pet is single-instance (one OS-level port). Cleared
   * by `pet_detached` IPC; set by `pet_attached` IPC + this action.
   */
  petAttachedSessionId: string | null;
  runtimeInfo: RuntimeInfo;
  setPetAttachedSession: (sid: string | null) => void;
  patchRuntimeInfo: (patch: Partial<RuntimeInfo>) => void;
}

export const createInfoSlice: RuntimeSliceCreator<InfoSlice> = (set) => ({
  petAttachedSessionId: null,
  runtimeInfo: DEFAULT_RUNTIME_INFO,

  setPetAttachedSession: (sid) => set({ petAttachedSessionId: sid }),

  patchRuntimeInfo: (patch) =>
    set((state) => ({ runtimeInfo: { ...state.runtimeInfo, ...patch } })),
});
