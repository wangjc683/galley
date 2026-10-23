import { DEFAULT_RUNTIME_INFO } from "@/stores/defaults";
import type { RuntimeInfo } from "@/types/inspector";

import type { RuntimeSliceCreator } from "./shared";

export interface InfoSlice {
  runtimeInfo: RuntimeInfo;
  patchRuntimeInfo: (patch: Partial<RuntimeInfo>) => void;
}

export const createInfoSlice: RuntimeSliceCreator<InfoSlice> = (set) => ({
  runtimeInfo: DEFAULT_RUNTIME_INFO,

  patchRuntimeInfo: (patch) =>
    set((state) => ({ runtimeInfo: { ...state.runtimeInfo, ...patch } })),
});
